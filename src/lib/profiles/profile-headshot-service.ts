import { randomUUID } from "node:crypto";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { isAcceptedImageUpload } from "@/lib/assets/asset-image-policy";
import { HttpError } from "@/lib/http/errors";
import { normalizePostgrestError } from "@/lib/http/postgrest-error";
import { getAutoMatchMaterializerVersion } from "@/lib/matching/auto-match-config";
import { getAutoMatcher, type AutoMatcherFaceBox, type AutoMatcherMaterializedFace } from "@/lib/matching/auto-matcher";
import { materializeFacesForStorageObject } from "@/lib/matching/face-materialization";
import {
  enqueueRecurringProjectReplayForProfile,
  shouldReplayRecurringProfileReadinessChange,
} from "@/lib/matching/project-recurring-sources";
import { resolveProfilesAccess } from "@/lib/profiles/profile-access";
import {
  RECURRING_PROFILE_MIN_FACE_AREA_RATIO,
  RECURRING_PROFILE_MIN_FACE_CONFIDENCE,
} from "@/lib/profiles/profile-headshot-thresholds";

const RECURRING_PROFILE_HEADSHOT_BUCKET = "recurring-profile-headshots";
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const REPAIR_JOB_MAX_ATTEMPTS = 5;
const MATERIALIZER_VERSION = getAutoMatchMaterializerVersion();

type RecurringProfileRow = {
  id: string;
  tenant_id: string;
  status: "active" | "archived";
};

type RecurringProfileBaselineConsentRow = {
  id: string;
  tenant_id: string;
  profile_id: string;
  consent_kind: "baseline" | "project";
  face_match_opt_in: boolean;
  revoked_at: string | null;
  signed_at: string;
};

export type RecurringProfileHeadshotRow = {
  id: string;
  tenant_id: string;
  profile_id: string;
  storage_bucket: string;
  storage_path: string;
  original_filename: string;
  content_type: string;
  file_size_bytes: number;
  content_hash: string | null;
  content_hash_algo: string | null;
  upload_status: "pending" | "uploaded" | "failed";
  uploaded_at: string | null;
  materialization_status: "pending" | "completed" | "repair_queued" | "failed";
  materialized_at: string | null;
  selection_face_id: string | null;
  selection_status:
    | "pending_materialization"
    | "auto_selected"
    | "manual_selected"
    | "needs_face_selection"
    | "no_face_detected"
    | "unusable_headshot";
  selection_reason: string | null;
  superseded_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type RecurringProfileHeadshotMaterializationRow = {
  id: string;
  tenant_id: string;
  headshot_id: string;
  materialization_version: string;
  provider: string;
  provider_mode: string;
  provider_plugin_versions: Record<string, unknown> | null;
  face_count: number;
  usable_for_compare: boolean;
  unusable_reason: string | null;
  source_image_width: number | null;
  source_image_height: number | null;
  source_coordinate_space: string;
  materialized_at: string;
  created_at: string;
};

export type RecurringProfileHeadshotMaterializationFaceRow = {
  id: string;
  tenant_id: string;
  materialization_id: string;
  face_rank: number;
  provider_face_index: number | null;
  detection_probability: number | null;
  face_box: Record<string, unknown>;
  face_box_normalized: Record<string, unknown> | null;
  embedding: number[];
  created_at: string;
};

export type RecurringProfileMatchingReadinessState =
  | "blocked_no_opt_in"
  | "missing_headshot"
  | "materializing"
  | "no_face_detected"
  | "needs_face_selection"
  | "unusable_headshot"
  | "ready";

export type RecurringProfileHeadshotFaceCandidate = {
  id: string;
  faceRank: number;
  detectionProbability: number;
  faceBox: AutoMatcherFaceBox;
  normalizedFaceBox: AutoMatcherFaceBox | null;
  areaRatio: number;
  centerDistance: number;
  isSelected: boolean;
};

export type RecurringProfileMatchingReadiness = {
  state: RecurringProfileMatchingReadinessState;
  authorized: boolean;
  currentHeadshotId: string | null;
  selectionFaceId: string | null;
  selectionStatus: RecurringProfileHeadshotRow["selection_status"] | null;
  materializationStatus: RecurringProfileHeadshotRow["materialization_status"] | null;
};

export type RecurringProfileHeadshotDetail = {
  currentHeadshot: RecurringProfileHeadshotRow | null;
  currentMaterialization: RecurringProfileHeadshotMaterializationRow | null;
  candidateFaces: RecurringProfileHeadshotFaceCandidate[];
  readiness: RecurringProfileMatchingReadiness;
};

type CreateRecurringProfileHeadshotUploadInput = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  profileId: string;
  idempotencyKey: string;
  originalFilename: string;
  contentType: string;
  fileSizeBytes: number;
  contentHash?: string | null;
  contentHashAlgo?: string | null;
};

type CreateRecurringProfileHeadshotUploadResult = {
  status: number;
  payload: {
    headshotId: string;
    storageBucket: string;
    storagePath: string;
    signedUrl: string;
  };
};

type FinalizeRecurringProfileHeadshotInput = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  profileId: string;
  headshotId: string;
};

type SelectRecurringProfileHeadshotFaceInput = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  profileId: string;
  headshotId: string;
  faceId: string;
};

type ProcessRecurringProfileHeadshotRepairJobsInput = {
  supabase: SupabaseClient;
  lockedBy: string;
  batchSize?: number;
};

type RepairJobClaimRow = {
  job_id: string;
  tenant_id: string;
  profile_id: string;
  headshot_id: string;
  dedupe_key: string;
  status: "queued" | "processing" | "succeeded" | "dead";
  attempt_count: number;
  max_attempts: number;
  run_after: string;
  locked_at: string | null;
  locked_by: string | null;
  lock_token: string;
  lease_expires_at: string | null;
  completed_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  last_error_at: string | null;
  created_at: string;
  updated_at: string;
};

type ActivateHeadshotRpcRow = {
  headshot_id: string;
  tenant_id: string;
  profile_id: string;
  uploaded_at: string;
  superseded_headshot_id: string | null;
};

type IdempotencyPayload = {
  headshotId: string;
  storageBucket: string;
  storagePath: string;
};

type FaceCandidateMetrics = RecurringProfileHeadshotFaceCandidate & {
  rawAreaRatio: number;
};

function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new HttpError(500, "supabase_admin_not_configured", "Missing Supabase service role configuration.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function normalizeIdempotencyKey(value: string) {
  const normalized = value.trim();
  if (normalized.length < 8 || normalized.length > 200) {
    throw new HttpError(400, "invalid_idempotency_key", "Idempotency-Key header is required.");
  }

  return normalized;
}

function sanitizeFilename(filename: string) {
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_");
  const trimmed = sanitized.replace(/^_+|_+$/g, "");
  if (!trimmed) {
    return "headshot";
  }

  return trimmed.length > 120 ? trimmed.slice(0, 120) : trimmed;
}

function normalizeContentHash(value: string | null | undefined) {
  const trimmed = String(value ?? "").trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  if (!/^[a-f0-9]{64}$/.test(trimmed)) {
    throw new HttpError(400, "invalid_content_hash", "Invalid content hash.");
  }

  return trimmed;
}

function validateImageMetadata(input: {
  originalFilename: string;
  contentType: string;
  fileSizeBytes: number;
}) {
  if (!input.originalFilename || input.originalFilename.length > 255) {
    throw new HttpError(400, "invalid_filename", "File name is required.");
  }

  if (!isAcceptedImageUpload(input.contentType, input.originalFilename)) {
    throw new HttpError(400, "invalid_content_type", "Unsupported file type.");
  }

  if (!Number.isFinite(input.fileSizeBytes) || input.fileSizeBytes <= 0) {
    throw new HttpError(400, "invalid_file_size", "File size is required.");
  }

  if (input.fileSizeBytes > MAX_FILE_SIZE_BYTES) {
    throw new HttpError(400, "file_too_large", "File is too large.");
  }
}

function buildRecurringProfileHeadshotStoragePath(input: {
  tenantId: string;
  profileId: string;
  headshotId: string;
  originalFilename: string;
}) {
  return `tenant/${input.tenantId}/profile/${input.profileId}/headshot/${input.headshotId}/${sanitizeFilename(input.originalFilename)}`;
}

function parseFaceBox(value: Record<string, unknown> | null | undefined) {
  if (!value) {
    return null;
  }

  const xMin = Number(value.x_min);
  const yMin = Number(value.y_min);
  const xMax = Number(value.x_max);
  const yMax = Number(value.y_max);
  const probability = Number(value.probability);
  if (!Number.isFinite(xMin) || !Number.isFinite(yMin) || !Number.isFinite(xMax) || !Number.isFinite(yMax)) {
    return null;
  }

  return {
    xMin,
    yMin,
    xMax,
    yMax,
    probability: Number.isFinite(probability) ? probability : null,
  } satisfies AutoMatcherFaceBox;
}

function calculateFaceAreaRatio(
  faceBox: AutoMatcherFaceBox | null,
  normalizedFaceBox: AutoMatcherFaceBox | null,
  sourceWidth: number | null,
  sourceHeight: number | null,
) {
  const preferredBox = normalizedFaceBox ?? faceBox;
  if (!preferredBox) {
    return 0;
  }

  if (normalizedFaceBox) {
    const width = Math.max(0, normalizedFaceBox.xMax - normalizedFaceBox.xMin);
    const height = Math.max(0, normalizedFaceBox.yMax - normalizedFaceBox.yMin);
    return width * height;
  }

  if (!sourceWidth || !sourceHeight) {
    return 0;
  }

  const width = Math.max(0, preferredBox.xMax - preferredBox.xMin);
  const height = Math.max(0, preferredBox.yMax - preferredBox.yMin);
  return (width * height) / (sourceWidth * sourceHeight);
}

function calculateFaceCenterDistance(
  faceBox: AutoMatcherFaceBox | null,
  normalizedFaceBox: AutoMatcherFaceBox | null,
  sourceWidth: number | null,
  sourceHeight: number | null,
) {
  const preferredBox = normalizedFaceBox ?? faceBox;
  if (!preferredBox) {
    return Number.POSITIVE_INFINITY;
  }

  let xCenter: number;
  let yCenter: number;

  if (normalizedFaceBox) {
    xCenter = (normalizedFaceBox.xMin + normalizedFaceBox.xMax) / 2;
    yCenter = (normalizedFaceBox.yMin + normalizedFaceBox.yMax) / 2;
  } else if (sourceWidth && sourceHeight) {
    xCenter = ((preferredBox.xMin + preferredBox.xMax) / 2) / sourceWidth;
    yCenter = ((preferredBox.yMin + preferredBox.yMax) / 2) / sourceHeight;
  } else {
    return Number.POSITIVE_INFINITY;
  }

  return Math.sqrt(Math.pow(xCenter - 0.5, 2) + Math.pow(yCenter - 0.5, 2));
}

function createHeadshotUsability(faces: AutoMatcherMaterializedFace[]) {
  if (faces.length === 0) {
    return {
      usableForCompare: false,
      unusableReason: "no_face",
    };
  }

  const hasEmbeddings = faces.every((face) => Array.isArray(face.embedding) && face.embedding.length > 0);
  if (!hasEmbeddings) {
    return {
      usableForCompare: false,
      unusableReason: "embedding_missing",
    };
  }

  return {
    usableForCompare: true,
    unusableReason: null,
  };
}

function normalizeMaterializedFaceBox(face: AutoMatcherMaterializedFace) {
  return {
    x_min: face.faceBox.xMin,
    y_min: face.faceBox.yMin,
    x_max: face.faceBox.xMax,
    y_max: face.faceBox.yMax,
    probability: face.faceBox.probability ?? null,
  };
}

function normalizeMaterializedNormalizedFaceBox(face: AutoMatcherMaterializedFace) {
  if (!face.normalizedFaceBox) {
    return null;
  }

  return {
    x_min: face.normalizedFaceBox.xMin,
    y_min: face.normalizedFaceBox.yMin,
    x_max: face.normalizedFaceBox.xMax,
    y_max: face.normalizedFaceBox.yMax,
    probability: face.normalizedFaceBox.probability ?? null,
  };
}

function toFaceCandidateMetrics(input: {
  face: RecurringProfileHeadshotMaterializationFaceRow;
  selectedFaceId: string | null;
  sourceWidth: number | null;
  sourceHeight: number | null;
}): FaceCandidateMetrics | null {
  const faceBox = parseFaceBox(input.face.face_box);
  const normalizedFaceBox = parseFaceBox(input.face.face_box_normalized);
  if (!faceBox) {
    return null;
  }

  const areaRatio = calculateFaceAreaRatio(faceBox, normalizedFaceBox, input.sourceWidth, input.sourceHeight);
  const centerDistance = calculateFaceCenterDistance(
    faceBox,
    normalizedFaceBox,
    input.sourceWidth,
    input.sourceHeight,
  );

  return {
    id: input.face.id,
    faceRank: input.face.face_rank,
    detectionProbability: Number(input.face.detection_probability ?? 0),
    faceBox,
    normalizedFaceBox,
    areaRatio,
    rawAreaRatio: areaRatio,
    centerDistance,
    isSelected: input.selectedFaceId === input.face.id,
  };
}

function compareFaceCandidates(left: FaceCandidateMetrics, right: FaceCandidateMetrics) {
  if (right.rawAreaRatio !== left.rawAreaRatio) {
    return right.rawAreaRatio - left.rawAreaRatio;
  }

  if (left.centerDistance !== right.centerDistance) {
    return left.centerDistance - right.centerDistance;
  }

  if (right.detectionProbability !== left.detectionProbability) {
    return right.detectionProbability - left.detectionProbability;
  }

  return left.faceRank - right.faceRank;
}

export function rankRecurringProfileHeadshotFaces(input: {
  faces: RecurringProfileHeadshotMaterializationFaceRow[];
  selectedFaceId?: string | null;
  sourceWidth: number | null;
  sourceHeight: number | null;
}) {
  return input.faces
    .map((face) =>
      toFaceCandidateMetrics({
        face,
        selectedFaceId: input.selectedFaceId ?? null,
        sourceWidth: input.sourceWidth,
        sourceHeight: input.sourceHeight,
      }),
    )
    .filter((candidate): candidate is FaceCandidateMetrics => Boolean(candidate))
    .sort(compareFaceCandidates);
}

export function selectRecurringProfileCanonicalFace(input: {
  faces: RecurringProfileHeadshotMaterializationFaceRow[];
  sourceWidth: number | null;
  sourceHeight: number | null;
}) {
  const rankedFaces = rankRecurringProfileHeadshotFaces({
    faces: input.faces,
    sourceWidth: input.sourceWidth,
    sourceHeight: input.sourceHeight,
  });

  if (rankedFaces.length === 0) {
    return {
      selectionFaceId: null,
      selectionStatus: "no_face_detected" as const,
      selectionReason: "no_face_detected",
      candidateFaces: rankedFaces,
    };
  }

  const top = rankedFaces[0] ?? null;
  if (!top) {
    return {
      selectionFaceId: null,
      selectionStatus: "no_face_detected" as const,
      selectionReason: "no_face_detected",
      candidateFaces: rankedFaces,
    };
  }

  const meetsMinimum =
    top.detectionProbability >= RECURRING_PROFILE_MIN_FACE_CONFIDENCE
    && top.areaRatio >= RECURRING_PROFILE_MIN_FACE_AREA_RATIO;
  if (rankedFaces.length === 1) {
    if (!meetsMinimum) {
      return {
        selectionFaceId: null,
        selectionStatus: "unusable_headshot" as const,
        selectionReason: "single_face_below_threshold",
        candidateFaces: rankedFaces,
      };
    }

    return {
      selectionFaceId: top.id,
      selectionStatus: "auto_selected" as const,
      selectionReason: "single_face_clear",
      candidateFaces: rankedFaces,
    };
  }

  if (!meetsMinimum) {
    return {
      selectionFaceId: null,
      selectionStatus: "needs_face_selection" as const,
      selectionReason: "multiple_faces_low_quality",
      candidateFaces: rankedFaces,
    };
  }

  return {
    selectionFaceId: null,
    selectionStatus: "needs_face_selection" as const,
    selectionReason: "multiple_faces_require_manual_selection",
    candidateFaces: rankedFaces,
  };
}

async function assertManageProfileHeadshots(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
) {
  const access = await resolveProfilesAccess(supabase, tenantId, userId);
  if (!access.canManageProfiles) {
    throw new HttpError(
      403,
      "recurring_profile_management_forbidden",
      "Only workspace owners and admins can manage recurring profiles.",
    );
  }
}

async function loadRecurringProfile(
  supabase: SupabaseClient,
  tenantId: string,
  profileId: string,
) {
  const { data, error } = await supabase
    .from("recurring_profiles")
    .select("id, tenant_id, status")
    .eq("tenant_id", tenantId)
    .eq("id", profileId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "recurring_profile_lookup_failed", "Unable to load recurring profile.");
  }

  return (data as RecurringProfileRow | null) ?? null;
}

async function loadActiveBaselineMatchConsent(
  supabase: SupabaseClient,
  tenantId: string,
  profileId: string,
) {
  const { data, error } = await supabase
    .from("recurring_profile_consents")
    .select("id, tenant_id, profile_id, consent_kind, face_match_opt_in, revoked_at, signed_at")
    .eq("tenant_id", tenantId)
    .eq("profile_id", profileId)
    .eq("consent_kind", "baseline")
    .is("revoked_at", null)
    .order("signed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "recurring_profile_consent_lookup_failed", "Unable to load recurring consent state.");
  }

  return (data as RecurringProfileBaselineConsentRow | null) ?? null;
}

export async function getActiveRecurringProfileMatchAuthorization(
  supabase: SupabaseClient,
  tenantId: string,
  profileId: string,
) {
  const consent = await loadActiveBaselineMatchConsent(supabase, tenantId, profileId);
  if (!consent || !consent.face_match_opt_in) {
    return null;
  }

  return consent;
}

async function loadCurrentUploadedHeadshot(
  supabase: SupabaseClient,
  tenantId: string,
  profileId: string,
) {
  const { data, error } = await supabase
    .from("recurring_profile_headshots")
    .select("id, tenant_id, profile_id, storage_bucket, storage_path, original_filename, content_type, file_size_bytes, content_hash, content_hash_algo, upload_status, uploaded_at, materialization_status, materialized_at, selection_face_id, selection_status, selection_reason, superseded_at, created_by, created_at, updated_at")
    .eq("tenant_id", tenantId)
    .eq("profile_id", profileId)
    .is("superseded_at", null)
    .eq("upload_status", "uploaded")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "recurring_profile_headshot_lookup_failed", "Unable to load recurring profile headshot.");
  }

  return (data as RecurringProfileHeadshotRow | null) ?? null;
}

async function activateRecurringProfileHeadshotUploadDirect(input: {
  supabase: SupabaseClient;
  tenantId: string;
  profileId: string;
  headshot: RecurringProfileHeadshotRow;
}): Promise<ActivateHeadshotRpcRow> {
  const nowIso = new Date().toISOString();
  const previousHeadshot = await loadCurrentUploadedHeadshot(input.supabase, input.tenantId, input.profileId);

  if (previousHeadshot && previousHeadshot.id !== input.headshot.id) {
    const { error: supersedeError } = await input.supabase
      .from("recurring_profile_headshots")
      .update({
        superseded_at: nowIso,
      })
      .eq("tenant_id", input.tenantId)
      .eq("profile_id", input.profileId)
      .eq("id", previousHeadshot.id)
      .eq("upload_status", "uploaded")
      .is("superseded_at", null);

    if (supersedeError) {
      throw new HttpError(
        500,
        "recurring_profile_headshot_finalize_failed",
        "Unable to activate recurring profile headshot upload.",
      );
    }
  }

  const uploadedAt = input.headshot.uploaded_at ?? nowIso;
  const { data: activatedHeadshot, error: activateError } = await input.supabase
    .from("recurring_profile_headshots")
    .update({
      upload_status: "uploaded",
      uploaded_at: uploadedAt,
      superseded_at: null,
    })
    .eq("tenant_id", input.tenantId)
    .eq("profile_id", input.profileId)
    .eq("id", input.headshot.id)
    .select("id, tenant_id, profile_id, uploaded_at")
    .maybeSingle();

  if (activateError || !activatedHeadshot) {
    const refreshedHeadshot = await loadHeadshotById(
      input.supabase,
      input.tenantId,
      input.profileId,
      input.headshot.id,
    );
    if (refreshedHeadshot?.upload_status === "uploaded" && refreshedHeadshot.superseded_at === null) {
      return {
        headshot_id: refreshedHeadshot.id,
        tenant_id: refreshedHeadshot.tenant_id,
        profile_id: refreshedHeadshot.profile_id,
        uploaded_at: refreshedHeadshot.uploaded_at ?? uploadedAt,
        superseded_headshot_id: previousHeadshot?.id ?? null,
      } satisfies ActivateHeadshotRpcRow;
    }

    throw new HttpError(
      500,
      "recurring_profile_headshot_finalize_failed",
      "Unable to activate recurring profile headshot upload.",
    );
  }

  return {
    headshot_id: activatedHeadshot.id,
    tenant_id: activatedHeadshot.tenant_id,
    profile_id: activatedHeadshot.profile_id,
    uploaded_at: activatedHeadshot.uploaded_at ?? uploadedAt,
    superseded_headshot_id: previousHeadshot?.id ?? null,
  } satisfies ActivateHeadshotRpcRow;
}

async function loadHeadshotById(
  supabase: SupabaseClient,
  tenantId: string,
  profileId: string,
  headshotId: string,
) {
  const { data, error } = await supabase
    .from("recurring_profile_headshots")
    .select("id, tenant_id, profile_id, storage_bucket, storage_path, original_filename, content_type, file_size_bytes, content_hash, content_hash_algo, upload_status, uploaded_at, materialization_status, materialized_at, selection_face_id, selection_status, selection_reason, superseded_at, created_by, created_at, updated_at")
    .eq("tenant_id", tenantId)
    .eq("profile_id", profileId)
    .eq("id", headshotId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "recurring_profile_headshot_lookup_failed", "Unable to load recurring profile headshot.");
  }

  return (data as RecurringProfileHeadshotRow | null) ?? null;
}

async function loadHeadshotMaterialization(
  supabase: SupabaseClient,
  tenantId: string,
  headshotId: string,
) {
  const { data, error } = await supabase
    .from("recurring_profile_headshot_materializations")
    .select("id, tenant_id, headshot_id, materialization_version, provider, provider_mode, provider_plugin_versions, face_count, usable_for_compare, unusable_reason, source_image_width, source_image_height, source_coordinate_space, materialized_at, created_at")
    .eq("tenant_id", tenantId)
    .eq("headshot_id", headshotId)
    .eq("materialization_version", MATERIALIZER_VERSION)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "recurring_profile_headshot_materialization_lookup_failed", "Unable to load profile headshot materialization.");
  }

  return (data as RecurringProfileHeadshotMaterializationRow | null) ?? null;
}

async function loadHeadshotMaterializationFaces(
  supabase: SupabaseClient,
  materializationId: string,
) {
  const { data, error } = await supabase
    .from("recurring_profile_headshot_materialization_faces")
    .select("id, tenant_id, materialization_id, face_rank, provider_face_index, detection_probability, face_box, face_box_normalized, embedding, created_at")
    .eq("materialization_id", materializationId)
    .order("face_rank", { ascending: true });

  if (error) {
    throw new HttpError(500, "recurring_profile_headshot_faces_lookup_failed", "Unable to load profile headshot faces.");
  }

  return (data as RecurringProfileHeadshotMaterializationFaceRow[] | null) ?? [];
}

async function updateHeadshotSelection(
  supabase: SupabaseClient,
  tenantId: string,
  headshotId: string,
  update: Partial<
    Pick<
      RecurringProfileHeadshotRow,
      "selection_face_id" | "selection_status" | "selection_reason" | "materialization_status" | "materialized_at"
    >
  >,
) {
  const { error } = await supabase
    .from("recurring_profile_headshots")
    .update(update)
    .eq("tenant_id", tenantId)
    .eq("id", headshotId);

  if (error) {
    throw new HttpError(500, "recurring_profile_headshot_update_failed", "Unable to update recurring profile headshot.");
  }
}

function buildRepairDedupeKey(headshotId: string, materializerVersion: string) {
  return `materialize_recurring_profile_headshot:${headshotId}:${materializerVersion}`;
}

export function buildRecurringProfileHeadshotRepairDedupeKey(headshotId: string) {
  return buildRepairDedupeKey(headshotId, MATERIALIZER_VERSION);
}

export async function enqueueRecurringProfileHeadshotRepairJob(input: {
  supabase: SupabaseClient;
  tenantId: string;
  profileId: string;
  headshotId: string;
}) {
  const payload = {
    tenant_id: input.tenantId,
    profile_id: input.profileId,
    headshot_id: input.headshotId,
    dedupe_key: buildRepairDedupeKey(input.headshotId, MATERIALIZER_VERSION),
    status: "queued",
    attempt_count: 0,
    max_attempts: REPAIR_JOB_MAX_ATTEMPTS,
    run_after: new Date().toISOString(),
  };

  const { error } = await input.supabase.from("recurring_profile_headshot_repair_jobs").upsert(payload, {
    onConflict: "tenant_id,dedupe_key",
    ignoreDuplicates: true,
  });

  if (error) {
    throw new HttpError(
      500,
      "recurring_profile_headshot_repair_enqueue_failed",
      "Unable to enqueue recurring profile headshot repair.",
    );
  }
}

export async function deriveRecurringProfileMatchingReadiness(input: {
  supabase: SupabaseClient;
  tenantId: string;
  profileId: string;
}) {
  const authorization = await loadActiveBaselineMatchConsent(input.supabase, input.tenantId, input.profileId);
  if (!authorization?.face_match_opt_in) {
    return {
      state: "blocked_no_opt_in",
      authorized: false,
      currentHeadshotId: null,
      selectionFaceId: null,
      selectionStatus: null,
      materializationStatus: null,
    } satisfies RecurringProfileMatchingReadiness;
  }

  const currentHeadshot = await loadCurrentUploadedHeadshot(input.supabase, input.tenantId, input.profileId);
  if (!currentHeadshot) {
    return {
      state: "missing_headshot",
      authorized: true,
      currentHeadshotId: null,
      selectionFaceId: null,
      selectionStatus: null,
      materializationStatus: null,
    } satisfies RecurringProfileMatchingReadiness;
  }

  if (currentHeadshot.materialization_status === "pending" || currentHeadshot.materialization_status === "repair_queued") {
    return {
      state: "materializing",
      authorized: true,
      currentHeadshotId: currentHeadshot.id,
      selectionFaceId: currentHeadshot.selection_face_id,
      selectionStatus: currentHeadshot.selection_status,
      materializationStatus: currentHeadshot.materialization_status,
    } satisfies RecurringProfileMatchingReadiness;
  }

  if (currentHeadshot.selection_status === "no_face_detected") {
    return {
      state: "no_face_detected",
      authorized: true,
      currentHeadshotId: currentHeadshot.id,
      selectionFaceId: null,
      selectionStatus: currentHeadshot.selection_status,
      materializationStatus: currentHeadshot.materialization_status,
    } satisfies RecurringProfileMatchingReadiness;
  }

  if (currentHeadshot.selection_status === "needs_face_selection") {
    return {
      state: "needs_face_selection",
      authorized: true,
      currentHeadshotId: currentHeadshot.id,
      selectionFaceId: null,
      selectionStatus: currentHeadshot.selection_status,
      materializationStatus: currentHeadshot.materialization_status,
    } satisfies RecurringProfileMatchingReadiness;
  }

  if (currentHeadshot.selection_status === "unusable_headshot") {
    return {
      state: "unusable_headshot",
      authorized: true,
      currentHeadshotId: currentHeadshot.id,
      selectionFaceId: null,
      selectionStatus: currentHeadshot.selection_status,
      materializationStatus: currentHeadshot.materialization_status,
    } satisfies RecurringProfileMatchingReadiness;
  }

  const materialization = await loadHeadshotMaterialization(input.supabase, input.tenantId, currentHeadshot.id);
  if (
    materialization
    && materialization.usable_for_compare
    && currentHeadshot.selection_face_id
    && (currentHeadshot.selection_status === "auto_selected" || currentHeadshot.selection_status === "manual_selected")
  ) {
    return {
      state: "ready",
      authorized: true,
      currentHeadshotId: currentHeadshot.id,
      selectionFaceId: currentHeadshot.selection_face_id,
      selectionStatus: currentHeadshot.selection_status,
      materializationStatus: currentHeadshot.materialization_status,
    } satisfies RecurringProfileMatchingReadiness;
  }

  return {
    state: "materializing",
    authorized: true,
    currentHeadshotId: currentHeadshot.id,
    selectionFaceId: currentHeadshot.selection_face_id,
    selectionStatus: currentHeadshot.selection_status,
    materializationStatus: currentHeadshot.materialization_status,
  } satisfies RecurringProfileMatchingReadiness;
}

async function enqueueRecurringProjectReplayIfNeeded(input: {
  supabase: SupabaseClient;
  tenantId: string;
  profileId: string;
  before: RecurringProfileMatchingReadiness;
  after: RecurringProfileMatchingReadiness;
  reason: string;
}) {
  if (!shouldReplayRecurringProfileReadinessChange(input.before, input.after)) {
    return;
  }

  await enqueueRecurringProjectReplayForProfile(input.supabase, {
    tenantId: input.tenantId,
    profileId: input.profileId,
    reason: input.reason,
  });
}

async function persistRecurringProfileHeadshotMaterialization(input: {
  supabase: SupabaseClient;
  tenantId: string;
  headshot: RecurringProfileHeadshotRow;
  forceRematerialize?: boolean;
}) {
  const existingMaterialization = await loadHeadshotMaterialization(input.supabase, input.tenantId, input.headshot.id);
  if (existingMaterialization && !input.forceRematerialize) {
    const faces = await loadHeadshotMaterializationFaces(input.supabase, existingMaterialization.id);
    return {
      materialization: existingMaterialization,
      faces,
    };
  }

  const matcher = getAutoMatcher();
  const providerResult = await materializeFacesForStorageObject({
    supabase: input.supabase,
    matcher,
    tenantId: input.tenantId,
    projectId: null,
    assetId: input.headshot.id,
    assetType: "headshot",
    storage: {
      storageBucket: input.headshot.storage_bucket,
      storagePath: input.headshot.storage_path,
    },
  });
  const usability = createHeadshotUsability(providerResult.faces);
  const nowIso = new Date().toISOString();

  const { data: materialization, error: materializationError } = await input.supabase
    .from("recurring_profile_headshot_materializations")
    .upsert(
      {
        tenant_id: input.tenantId,
        headshot_id: input.headshot.id,
        materialization_version: MATERIALIZER_VERSION,
        provider: providerResult.providerMetadata.provider,
        provider_mode: providerResult.providerMetadata.providerMode,
        provider_plugin_versions: providerResult.providerMetadata.providerPluginVersions ?? null,
        face_count: providerResult.faces.length,
        usable_for_compare: usability.usableForCompare,
        unusable_reason: usability.unusableReason,
        source_image_width: providerResult.sourceImage?.width ?? null,
        source_image_height: providerResult.sourceImage?.height ?? null,
        source_coordinate_space: providerResult.sourceImage?.coordinateSpace ?? "oriented_original",
        materialized_at: nowIso,
      },
      {
        onConflict: "tenant_id,headshot_id,materialization_version",
      },
    )
    .select("id, tenant_id, headshot_id, materialization_version, provider, provider_mode, provider_plugin_versions, face_count, usable_for_compare, unusable_reason, source_image_width, source_image_height, source_coordinate_space, materialized_at, created_at")
    .single();

  if (materializationError || !materialization) {
    throw new HttpError(
      500,
      "recurring_profile_headshot_materialization_write_failed",
      "Unable to persist profile headshot materialization.",
    );
  }

  const { error: deleteFacesError } = await input.supabase
    .from("recurring_profile_headshot_materialization_faces")
    .delete()
    .eq("tenant_id", input.tenantId)
    .eq("materialization_id", materialization.id);

  if (deleteFacesError) {
    throw new HttpError(
      500,
      "recurring_profile_headshot_materialization_write_failed",
      "Unable to replace profile headshot faces.",
    );
  }

  if (providerResult.faces.length > 0) {
    const faceRows = providerResult.faces.map((face) => ({
      tenant_id: input.tenantId,
      materialization_id: materialization.id,
      face_rank: face.faceRank,
      provider_face_index: face.providerFaceIndex ?? null,
      detection_probability: face.detectionProbability ?? null,
      face_box: normalizeMaterializedFaceBox(face),
      face_box_normalized: normalizeMaterializedNormalizedFaceBox(face),
      embedding: face.embedding,
    }));

    const { error: facesError } = await input.supabase
      .from("recurring_profile_headshot_materialization_faces")
      .insert(faceRows);

    if (facesError) {
      throw new HttpError(
        500,
        "recurring_profile_headshot_materialization_write_failed",
        "Unable to persist profile headshot faces.",
      );
    }
  }

  const faces = await loadHeadshotMaterializationFaces(input.supabase, materialization.id);
  return {
    materialization: materialization as RecurringProfileHeadshotMaterializationRow,
    faces,
  };
}

async function applyHeadshotSelectionFromMaterialization(input: {
  supabase: SupabaseClient;
  tenantId: string;
  headshotId: string;
  materialization: RecurringProfileHeadshotMaterializationRow;
  faces: RecurringProfileHeadshotMaterializationFaceRow[];
}) {
  const selection = selectRecurringProfileCanonicalFace({
    faces: input.faces,
    sourceWidth: input.materialization.source_image_width,
    sourceHeight: input.materialization.source_image_height,
  });

  await updateHeadshotSelection(input.supabase, input.tenantId, input.headshotId, {
    selection_face_id: selection.selectionFaceId,
    selection_status: selection.selectionStatus,
    selection_reason: selection.selectionReason,
    materialization_status: "completed",
    materialized_at: input.materialization.materialized_at,
  });

  return selection;
}

export async function ensureRecurringProfileHeadshotMaterialization(input: {
  supabase: SupabaseClient;
  tenantId: string;
  profileId: string;
  headshotId: string;
  forceRematerialize?: boolean;
}) {
  const headshot = await loadHeadshotById(input.supabase, input.tenantId, input.profileId, input.headshotId);
  if (!headshot || headshot.upload_status !== "uploaded") {
    throw new HttpError(404, "recurring_profile_headshot_not_found", "Recurring profile headshot not found.");
  }

  const adminSupabase = createServiceRoleClient();

  const persisted = await persistRecurringProfileHeadshotMaterialization({
    supabase: adminSupabase,
    tenantId: input.tenantId,
    headshot,
    forceRematerialize: input.forceRematerialize,
  });

  const selection = await applyHeadshotSelectionFromMaterialization({
    supabase: adminSupabase,
    tenantId: input.tenantId,
    headshotId: headshot.id,
    materialization: persisted.materialization,
    faces: persisted.faces,
  });

  return {
    headshot,
    materialization: persisted.materialization,
    faces: persisted.faces,
    selection,
  };
}

export async function createRecurringProfileHeadshotUpload(
  input: CreateRecurringProfileHeadshotUploadInput,
): Promise<CreateRecurringProfileHeadshotUploadResult> {
  await assertManageProfileHeadshots(input.supabase, input.tenantId, input.userId);
  validateImageMetadata({
    originalFilename: input.originalFilename,
    contentType: input.contentType,
    fileSizeBytes: input.fileSizeBytes,
  });

  const idempotencyKey = normalizeIdempotencyKey(input.idempotencyKey);
  const profile = await loadRecurringProfile(input.supabase, input.tenantId, input.profileId);
  if (!profile) {
    throw new HttpError(404, "recurring_profile_not_found", "Recurring profile not found.");
  }

  if (profile.status !== "active") {
    throw new HttpError(409, "recurring_profile_archived", "Archived profiles cannot receive recurring headshots.");
  }

  const authorization = await getActiveRecurringProfileMatchAuthorization(
    input.supabase,
    input.tenantId,
    input.profileId,
  );
  if (!authorization) {
    throw new HttpError(
      409,
      "recurring_profile_face_match_not_opted_in",
      "Recurring profile headshots require active matching authorization.",
    );
  }

  const operation = `create_recurring_profile_headshot:${input.profileId}`;
  const { data: existingIdempotency, error: idempotencyError } = await input.supabase
    .from("idempotency_keys")
    .select("response_json")
    .eq("tenant_id", input.tenantId)
    .eq("operation", operation)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (idempotencyError) {
    throw new HttpError(500, "idempotency_lookup_failed", "Unable to create recurring headshot right now.");
  }

  const storageAdmin = createServiceRoleClient();
  if (existingIdempotency?.response_json) {
    const payload = existingIdempotency.response_json as IdempotencyPayload;
    const existingHeadshot = await loadHeadshotById(input.supabase, input.tenantId, input.profileId, payload.headshotId);
    if (!existingHeadshot) {
      throw new HttpError(409, "idempotency_mismatch", "Unable to reuse recurring headshot upload request.");
    }

    const { data: signedData, error: signedError } = await storageAdmin.storage
      .from(payload.storageBucket)
      .createSignedUploadUrl(payload.storagePath);

    if (signedError || !signedData?.signedUrl) {
      throw new HttpError(500, "signed_url_failed", "Unable to create upload URL.");
    }

    return {
      status: 200,
      payload: {
        headshotId: existingHeadshot.id,
        storageBucket: payload.storageBucket,
        storagePath: payload.storagePath,
        signedUrl: signedData.signedUrl,
      },
    };
  }

  const headshotId = randomUUID();
  const storagePath = buildRecurringProfileHeadshotStoragePath({
    tenantId: input.tenantId,
    profileId: input.profileId,
    headshotId,
    originalFilename: input.originalFilename,
  });

  const { error: insertError } = await input.supabase.from("recurring_profile_headshots").insert({
    id: headshotId,
    tenant_id: input.tenantId,
    profile_id: input.profileId,
    storage_bucket: RECURRING_PROFILE_HEADSHOT_BUCKET,
    storage_path: storagePath,
    original_filename: input.originalFilename,
    content_type: input.contentType,
    file_size_bytes: input.fileSizeBytes,
    content_hash: normalizeContentHash(input.contentHash ?? null),
    content_hash_algo: input.contentHashAlgo ?? null,
    upload_status: "pending",
    materialization_status: "pending",
    selection_status: "pending_materialization",
    created_by: input.userId,
  });

  if (insertError) {
    throw new HttpError(500, "recurring_profile_headshot_create_failed", "Unable to create recurring profile headshot.");
  }

  const { data: signedData, error: signedError } = await storageAdmin.storage
    .from(RECURRING_PROFILE_HEADSHOT_BUCKET)
    .createSignedUploadUrl(storagePath);

  if (signedError || !signedData?.signedUrl) {
    throw new HttpError(500, "signed_url_failed", "Unable to create upload URL.");
  }

  const responsePayload = {
    headshotId,
    storageBucket: RECURRING_PROFILE_HEADSHOT_BUCKET,
    storagePath,
  };

  const { error: writeIdempotencyError } = await input.supabase.from("idempotency_keys").upsert(
    {
      tenant_id: input.tenantId,
      operation,
      idempotency_key: idempotencyKey,
      response_json: responsePayload,
      created_by: input.userId,
    },
    {
      onConflict: "tenant_id,operation,idempotency_key",
      ignoreDuplicates: true,
    },
  );

  if (writeIdempotencyError) {
    throw new HttpError(500, "idempotency_write_failed", "Unable to persist upload request state.");
  }

  return {
    status: 201,
    payload: {
      ...responsePayload,
      signedUrl: signedData.signedUrl,
    },
  };
}

export async function finalizeRecurringProfileHeadshotUpload(input: FinalizeRecurringProfileHeadshotInput) {
  await assertManageProfileHeadshots(input.supabase, input.tenantId, input.userId);
  const adminSupabase = createServiceRoleClient();

  const profile = await loadRecurringProfile(adminSupabase, input.tenantId, input.profileId);
  if (!profile) {
    throw new HttpError(404, "recurring_profile_not_found", "Recurring profile not found.");
  }

  const authorization = await getActiveRecurringProfileMatchAuthorization(
    adminSupabase,
    input.tenantId,
    input.profileId,
  );
  if (!authorization) {
    throw new HttpError(
      409,
      "recurring_profile_face_match_not_opted_in",
      "Recurring profile headshots require active matching authorization.",
    );
  }

  const headshot = await loadHeadshotById(adminSupabase, input.tenantId, input.profileId, input.headshotId);
  if (!headshot) {
    throw new HttpError(404, "recurring_profile_headshot_not_found", "Recurring profile headshot not found.");
  }

  const readinessBefore = await deriveRecurringProfileMatchingReadiness({
    supabase: adminSupabase,
    tenantId: input.tenantId,
    profileId: input.profileId,
  });

  if (headshot.upload_status === "uploaded" && headshot.superseded_at === null) {
    const readiness = await deriveRecurringProfileMatchingReadiness({
      supabase: adminSupabase,
      tenantId: input.tenantId,
      profileId: input.profileId,
    });
    await enqueueRecurringProjectReplayIfNeeded({
      supabase: adminSupabase,
      tenantId: input.tenantId,
      profileId: input.profileId,
      before: readinessBefore,
      after: readiness,
      reason: "recurring_headshot_finalize_existing",
    });

    return {
      headshot,
      readiness,
      materializationDeferred: false,
    };
  }

  const { data: activationRows, error: activationError } = await adminSupabase.rpc(
    "activate_recurring_profile_headshot_upload",
    {
      p_headshot_id: input.headshotId,
    },
  );

  let activationRow = ((activationRows as ActivateHeadshotRpcRow[] | null) ?? [])[0] ?? null;
  if (activationError || !activationRow) {
    console.warn("[profiles][headshot] falling back to direct headshot activation", {
      tenantId: input.tenantId,
      profileId: input.profileId,
      headshotId: input.headshotId,
      reason: activationError
        ? normalizePostgrestError(activationError, "recurring_profile_headshot_finalize_failed")
        : "empty_rpc_result",
    });
    activationRow = await activateRecurringProfileHeadshotUploadDirect({
      supabase: adminSupabase,
      tenantId: input.tenantId,
      profileId: input.profileId,
      headshot,
    });
  }

  let materializationDeferred = false;
  try {
    await ensureRecurringProfileHeadshotMaterialization({
      supabase: adminSupabase,
      tenantId: input.tenantId,
      profileId: input.profileId,
      headshotId: input.headshotId,
      forceRematerialize: true,
    });
  } catch (error) {
    console.error("[profiles][headshot] direct recurring headshot materialization failed", {
      tenantId: input.tenantId,
      profileId: input.profileId,
      headshotId: input.headshotId,
      error: error instanceof Error ? error.message : String(error),
    });
    materializationDeferred = true;
    await updateHeadshotSelection(adminSupabase, input.tenantId, input.headshotId, {
      materialization_status: "repair_queued",
      selection_face_id: null,
      selection_status: "pending_materialization",
      selection_reason: "repair_queued_after_direct_failure",
      materialized_at: null,
    });
    await enqueueRecurringProfileHeadshotRepairJob({
      supabase: adminSupabase,
      tenantId: input.tenantId,
      profileId: input.profileId,
      headshotId: input.headshotId,
    });
  }

  const readiness = await deriveRecurringProfileMatchingReadiness({
    supabase: adminSupabase,
    tenantId: input.tenantId,
    profileId: input.profileId,
  });
  await enqueueRecurringProjectReplayIfNeeded({
    supabase: adminSupabase,
    tenantId: input.tenantId,
    profileId: input.profileId,
    before: readinessBefore,
    after: readiness,
    reason: materializationDeferred ? "recurring_headshot_finalize_repair_queued" : "recurring_headshot_finalize",
  });
  const refreshedHeadshot = await loadHeadshotById(adminSupabase, input.tenantId, input.profileId, input.headshotId);

  return {
    headshot: refreshedHeadshot,
    readiness,
    materializationDeferred,
  };
}

export async function selectRecurringProfileHeadshotFace(input: SelectRecurringProfileHeadshotFaceInput) {
  await assertManageProfileHeadshots(input.supabase, input.tenantId, input.userId);

  const authorization = await getActiveRecurringProfileMatchAuthorization(
    input.supabase,
    input.tenantId,
    input.profileId,
  );
  if (!authorization) {
    throw new HttpError(
      409,
      "recurring_profile_face_match_not_opted_in",
      "Recurring profile headshots require active matching authorization.",
    );
  }

  const headshot = await loadHeadshotById(input.supabase, input.tenantId, input.profileId, input.headshotId);
  if (!headshot || headshot.superseded_at || headshot.upload_status !== "uploaded") {
    throw new HttpError(404, "recurring_profile_headshot_not_found", "Recurring profile headshot not found.");
  }

  const materialization = await loadHeadshotMaterialization(input.supabase, input.tenantId, headshot.id);
  if (!materialization) {
    throw new HttpError(
      409,
      "recurring_profile_headshot_not_materialized",
      "Recurring profile headshot is not ready for face selection.",
    );
  }

  const faces = await loadHeadshotMaterializationFaces(input.supabase, materialization.id);
  if (!faces.some((face) => face.id === input.faceId)) {
    throw new HttpError(404, "recurring_profile_headshot_face_not_found", "Recurring profile face not found.");
  }

  const readinessBefore = await deriveRecurringProfileMatchingReadiness({
    supabase: input.supabase,
    tenantId: input.tenantId,
    profileId: input.profileId,
  });

  await updateHeadshotSelection(input.supabase, input.tenantId, headshot.id, {
    selection_face_id: input.faceId,
    selection_status: "manual_selected",
    selection_reason: "manual_override",
    materialization_status: "completed",
    materialized_at: materialization.materialized_at,
  });

  const readiness = await deriveRecurringProfileMatchingReadiness({
    supabase: input.supabase,
    tenantId: input.tenantId,
    profileId: input.profileId,
  });
  await enqueueRecurringProjectReplayIfNeeded({
    supabase: input.supabase,
    tenantId: input.tenantId,
    profileId: input.profileId,
    before: readinessBefore,
    after: readiness,
    reason: "recurring_headshot_face_selected",
  });

  return readiness;
}

export async function getRecurringProfileHeadshotDetail(input: {
  supabase: SupabaseClient;
  tenantId: string;
  profileId: string;
}) {
  const currentHeadshot = await loadCurrentUploadedHeadshot(input.supabase, input.tenantId, input.profileId);
  const readiness = await deriveRecurringProfileMatchingReadiness({
    supabase: input.supabase,
    tenantId: input.tenantId,
    profileId: input.profileId,
  });

  if (!currentHeadshot) {
    return {
      currentHeadshot: null,
      currentMaterialization: null,
      candidateFaces: [],
      readiness,
    } satisfies RecurringProfileHeadshotDetail;
  }

  const currentMaterialization = await loadHeadshotMaterialization(input.supabase, input.tenantId, currentHeadshot.id);
  const candidateFaces = currentMaterialization
    ? rankRecurringProfileHeadshotFaces({
        faces: await loadHeadshotMaterializationFaces(input.supabase, currentMaterialization.id),
        selectedFaceId: currentHeadshot.selection_face_id,
        sourceWidth: currentMaterialization.source_image_width,
        sourceHeight: currentMaterialization.source_image_height,
      })
    : [];

  return {
    currentHeadshot,
    currentMaterialization,
    candidateFaces,
    readiness,
  } satisfies RecurringProfileHeadshotDetail;
}

export async function processRecurringProfileHeadshotRepairJobs(
  input: ProcessRecurringProfileHeadshotRepairJobsInput,
) {
  const { data, error } = await input.supabase.rpc("claim_recurring_profile_headshot_repair_jobs", {
    p_locked_by: input.lockedBy,
    p_batch_size: input.batchSize ?? 10,
    p_lease_seconds: 900,
  });

  if (error) {
    throw new HttpError(
      500,
      "recurring_profile_headshot_repair_claim_failed",
      "Unable to claim recurring profile headshot repair jobs.",
    );
  }

  const jobs = ((data as RepairJobClaimRow[] | null) ?? []);
  for (const job of jobs) {
    try {
      const readinessBefore = await deriveRecurringProfileMatchingReadiness({
        supabase: input.supabase,
        tenantId: job.tenant_id,
        profileId: job.profile_id,
      });

      await ensureRecurringProfileHeadshotMaterialization({
        supabase: input.supabase,
        tenantId: job.tenant_id,
        profileId: job.profile_id,
        headshotId: job.headshot_id,
        forceRematerialize: true,
      });

      await input.supabase.rpc("complete_recurring_profile_headshot_repair_job", {
        p_job_id: job.job_id,
        p_lock_token: job.lock_token,
      });

      const readinessAfter = await deriveRecurringProfileMatchingReadiness({
        supabase: input.supabase,
        tenantId: job.tenant_id,
        profileId: job.profile_id,
      });
      await enqueueRecurringProjectReplayIfNeeded({
        supabase: input.supabase,
        tenantId: job.tenant_id,
        profileId: job.profile_id,
        before: readinessBefore,
        after: readinessAfter,
        reason: "recurring_headshot_repair_completed",
      });
    } catch (error) {
      const errorCode = error instanceof HttpError ? error.code : "recurring_profile_headshot_repair_failed";
      const errorMessage =
        error instanceof Error ? error.message : "Unable to repair recurring profile headshot materialization.";

      await input.supabase.rpc("fail_recurring_profile_headshot_repair_job", {
        p_job_id: job.job_id,
        p_lock_token: job.lock_token,
        p_error_code: errorCode,
        p_error_message: errorMessage,
        p_retryable: true,
        p_retry_delay_seconds: null,
      });
    }
  }

  return {
    processedCount: jobs.length,
  };
}

export async function getRecurringProfileHeadshotSignedPreviewUrl(input: {
  supabase: SupabaseClient;
  headshot: RecurringProfileHeadshotRow | null;
  expiresInSeconds?: number;
}) {
  if (!input.headshot) {
    return null;
  }

  const { data, error } = await input.supabase.storage
    .from(input.headshot.storage_bucket)
    .createSignedUrl(input.headshot.storage_path, input.expiresInSeconds ?? 60 * 60);

  if (error || !data?.signedUrl) {
    return null;
  }

  return data.signedUrl;
}
