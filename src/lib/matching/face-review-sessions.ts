import { createHash, randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import {
  enqueueMaterializeAssetFacesJob,
  type EnqueueFaceMatchJobResult,
  type RepairFaceMatchJobResult,
} from "@/lib/matching/auto-match-jobs";
import { getAutoMatchMaterializerVersion } from "@/lib/matching/auto-match-config";
import { getAutoMatcher, type AutoMatcher } from "@/lib/matching/auto-matcher";
import { loadProjectFaceAssigneeRowsByIds } from "@/lib/matching/project-face-assignees";
import {
  assertConsentInProject,
  deriveManualPhotoLinkFaceStatus,
  loadCurrentConsentFaceConfidenceByAssetFaceKey,
  manualLinkPhotoToConsent,
  manualUnlinkPhotoFromConsent,
} from "@/lib/matching/photo-face-linking";
import {
  ensureAssetFaceMaterialization,
  loadCurrentAssetFaceMaterialization,
  loadFaceImageDerivativesForFaceIds,
  type AssetFaceImageDerivativeRow,
  type AssetFaceMaterializationFaceRow,
  type AssetFaceMaterializationRow,
} from "@/lib/matching/face-materialization";
import { runChunkedRead } from "@/lib/supabase/safe-in-filter";

const MAX_REVIEW_SESSION_ASSET_IDS = 100;
const SESSION_TTL_MILLIS = 1000 * 60 * 60 * 12;
const PENDING_DIRECT_MATERIALIZATION_GRACE_MILLIS = 5000;
const MAX_DIRECT_MATERIALIZATIONS_PER_SESSION_READ = 1;

type MatchingScopeInput = {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  consentId: string;
  workspaceId?: string | null;
  actorUserId: string;
  matcher?: AutoMatcher;
};

type PrepareFaceReviewSessionInput = MatchingScopeInput & {
  assetIds: string[];
};

type FaceReviewSessionActionInput = MatchingScopeInput & {
  sessionId: string;
  itemId: string;
  action: "link_face" | "suppress_face";
  assetFaceId?: string | null;
  forceReplace?: boolean;
};

type FaceReviewSessionLookupInput = MatchingScopeInput & {
  sessionId: string;
};

type ReviewableAssetRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  asset_type: string;
  original_filename: string;
  status: string;
  uploaded_at: string | null;
  archived_at: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  created_at: string;
};

type CurrentMaterializationFace = AssetFaceMaterializationFaceRow & {
  face_box: Record<string, number | null>;
  face_box_normalized: Record<string, number | null> | null;
};

type FaceLinkRow = {
  asset_face_id: string;
  asset_materialization_id: string;
  asset_id: string;
  project_face_assignee_id: string;
  consent_id: string | null;
  tenant_id: string;
  project_id: string;
  link_source: "manual" | "auto";
  match_confidence: number | null;
  matched_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  matcher_version: string | null;
  created_at: string;
  updated_at: string;
};

type FaceSuppressionRow = {
  asset_face_id: string;
  asset_materialization_id: string;
  asset_id: string;
  project_face_assignee_id: string;
  tenant_id: string;
  project_id: string;
  reason: "manual_unlink" | "manual_replace";
  created_at: string;
  created_by: string | null;
};

type ManualFallbackRow = {
  asset_id: string;
  consent_id: string;
  tenant_id: string;
  project_id: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type ConsentSummary = {
  consentId: string;
  fullName: string | null;
  email: string | null;
};

type FaceReviewSessionRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  workspace_id: string | null;
  consent_id: string;
  created_by: string;
  selection_hash: string;
  status: "open" | "completed" | "cancelled" | "expired";
  selected_asset_count: number;
  expires_at: string;
  last_accessed_at: string;
  created_at: string;
  updated_at: string;
};

type FaceReviewSessionItemRow = {
  id: string;
  session_id: string;
  tenant_id: string;
  project_id: string;
  workspace_id: string | null;
  consent_id: string;
  asset_id: string;
  position: number;
  status: "pending_materialization" | "ready_for_face_selection" | "completed" | "blocked";
  completion_kind: "linked_face" | "linked_fallback" | "suppressed_face" | null;
  block_code: "consent_revoked" | "manual_conflict" | "asset_unavailable" | "materialization_failed" | null;
  prepared_materialization_id: string | null;
  selected_asset_face_id: string | null;
  detected_face_count: number | null;
  last_reconciled_at: string;
  created_at: string;
  updated_at: string;
};

type FaceReviewFaceReadModel = {
  assetFaceId: string;
  faceRank: number;
  faceBoxNormalized: Record<string, number | null> | null;
  matchConfidence: number | null;
  cropDerivative: AssetFaceImageDerivativeRow | null;
  status: "current" | "occupied_manual" | "occupied_auto" | "suppressed" | "available";
  currentAssignee: {
    consentId: string | null;
    fullName: string | null;
    email: string | null;
    linkSource: "manual" | "auto";
  } | null;
  isCurrentConsentFace: boolean;
  isSuppressedForConsent: boolean;
};

export type FaceReviewSessionItemReadModel = {
  id: string;
  assetId: string;
  position: number;
  status: FaceReviewSessionItemRow["status"];
  completionKind: FaceReviewSessionItemRow["completion_kind"];
  blockCode: FaceReviewSessionItemRow["block_code"];
  preparedMaterializationId: string | null;
  detectedFaceCount: number | null;
  wasRematerialized: boolean;
  asset: {
    originalFilename: string;
    status: string;
    storageBucket: string | null;
    storagePath: string | null;
  };
  faces: FaceReviewFaceReadModel[];
};

export type FaceReviewSessionSummary = {
  id: string;
  status: "open" | "completed" | "cancelled" | "expired";
  selectedAssetCount: number;
  completedCount: number;
  pendingMaterializationCount: number;
  readyForFaceSelectionCount: number;
  blockedCount: number;
  currentQueueIndex: number | null;
  nextReviewItemId: string | null;
  reusedExistingSession?: boolean;
};

export type FaceReviewSessionReadModel = {
  session: FaceReviewSessionSummary;
  items: FaceReviewSessionItemReadModel[];
};

type ReviewSessionPrepareResult = {
  session: FaceReviewSessionSummary;
};

function normalizeUniqueAssetIds(assetIds: string[]) {
  const unique = Array.from(
    new Set(
      assetIds
        .filter((assetId) => typeof assetId === "string")
        .map((assetId) => assetId.trim())
        .filter((assetId) => assetId.length > 0),
    ),
  );

  if (unique.length === 0) {
    throw new HttpError(400, "invalid_asset_ids", "Select at least one project photo.");
  }

  if (unique.length > MAX_REVIEW_SESSION_ASSET_IDS) {
    throw new HttpError(400, "invalid_asset_ids", "Too many project photos were selected.");
  }

  return unique.sort((left, right) => left.localeCompare(right));
}

function buildSelectionHash(assetIds: string[]) {
  return createHash("sha256").update(assetIds.join(","), "utf8").digest("hex");
}

function getSessionExpiryIso(now = Date.now()) {
  return new Date(now + SESSION_TTL_MILLIS).toISOString();
}

function normalizeCurrentMaterializationFaces(rows: AssetFaceMaterializationFaceRow[]) {
  return rows.map((row) => ({
    ...row,
    face_box: row.face_box as Record<string, number | null>,
    face_box_normalized: (row.face_box_normalized as Record<string, number | null> | null) ?? null,
  }));
}

async function loadConsentSummaries(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  consentIds: string[],
) {
  if (consentIds.length === 0) {
    return new Map<string, ConsentSummary>();
  }

  const rows = await runChunkedRead(consentIds, async (consentIdChunk) => {
    const { data, error } = await supabase
      .from("consents")
      .select("id, subjects(email, full_name)")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .in("id", consentIdChunk);

    if (error) {
      throw new HttpError(500, "consent_lookup_failed", "Unable to load consent details.");
    }

    return (data ?? []) as Array<{
      id: string;
      subjects:
        | {
            email: string | null;
            full_name: string | null;
          }
        | Array<{
            email: string | null;
            full_name: string | null;
          }>
        | null;
    }>;
  });

  return new Map(
    rows.map((row) => {
      const subject = Array.isArray(row.subjects) ? (row.subjects[0] ?? null) : row.subjects;
      return [
        row.id,
        {
          consentId: row.id,
          fullName: subject?.full_name?.trim() ?? null,
          email: subject?.email?.trim() ?? null,
        } satisfies ConsentSummary,
      ];
    }),
  );
}

async function loadReviewableAssetsMap(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  workspaceId: string | null | undefined,
  assetIds: string[],
) {
  if (assetIds.length === 0) {
    return new Map<string, ReviewableAssetRow>();
  }

  const rows = await runChunkedRead(assetIds, async (assetIdChunk) => {
    let query = supabase
      .from("assets")
      .select(
        "id, tenant_id, project_id, asset_type, original_filename, status, uploaded_at, archived_at, storage_bucket, storage_path, created_at",
      )
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .in("id", assetIdChunk);

    if (workspaceId) {
      query = query.eq("workspace_id", workspaceId);
    }

    const { data, error } = await query;

    if (error) {
      throw new HttpError(500, "review_asset_lookup_failed", "Unable to load review assets.");
    }

    return ((data ?? []) as ReviewableAssetRow[]).filter((row) => row.asset_type === "photo");
  });

  return new Map(rows.map((row) => [row.id, row]));
}

async function loadCurrentPhotoMaterializationMap(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  workspaceId: string | null | undefined,
  assetIds: string[],
) {
  if (assetIds.length === 0) {
    return new Map<string, AssetFaceMaterializationRow>();
  }

  const version = getAutoMatchMaterializerVersion();
  const rows = await runChunkedRead(assetIds, async (assetIdChunk) => {
    let query = supabase
      .from("asset_face_materializations")
      .select(
        "id, tenant_id, project_id, asset_id, asset_type, source_content_hash, source_content_hash_algo, source_uploaded_at, materializer_version, provider, provider_mode, provider_plugin_versions, face_count, usable_for_compare, unusable_reason, source_image_width, source_image_height, source_coordinate_space, materialized_at, created_at",
      )
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .eq("asset_type", "photo")
      .eq("materializer_version", version)
      .in("asset_id", assetIdChunk);

    if (workspaceId) {
      query = query.eq("workspace_id", workspaceId);
    }

    const { data, error } = await query;

    if (error) {
      throw new HttpError(500, "photo_materialization_lookup_failed", "Unable to load photo materializations.");
    }

    return (data ?? []) as AssetFaceMaterializationRow[];
  });

  return new Map(rows.map((row) => [row.asset_id, row]));
}

async function loadMaterializationFacesMap(
  supabase: SupabaseClient,
  materializationIds: string[],
) {
  if (materializationIds.length === 0) {
    return new Map<string, CurrentMaterializationFace[]>();
  }

  const rows = await runChunkedRead(materializationIds, async (materializationIdChunk) => {
    const { data, error } = await supabase
      .from("asset_face_materialization_faces")
      .select(
        "id, tenant_id, project_id, asset_id, materialization_id, face_rank, provider_face_index, detection_probability, face_box, face_box_normalized, embedding, face_source, created_by, created_at",
      )
      .in("materialization_id", materializationIdChunk)
      .order("face_rank", { ascending: true });

    if (error) {
      throw new HttpError(500, "photo_materialization_faces_lookup_failed", "Unable to load photo faces.");
    }

    return (data ?? []) as AssetFaceMaterializationFaceRow[];
  });

  const map = new Map<string, CurrentMaterializationFace[]>();
  for (const row of rows) {
    const current = map.get(row.materialization_id) ?? [];
    current.push({
      ...row,
      face_box: row.face_box as Record<string, number | null>,
      face_box_normalized: (row.face_box_normalized as Record<string, number | null> | null) ?? null,
    });
    map.set(row.materialization_id, current);
  }

  return map;
}

async function loadCurrentFaceLinksForAssets(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  workspaceId: string | null | undefined,
  assetIds: string[],
) {
  if (assetIds.length === 0) {
    return [] as FaceLinkRow[];
  }

  const rows = await runChunkedRead(assetIds, async (assetIdChunk) => {
    let query = supabase
      .from("asset_face_consent_links")
      .select(
        "asset_face_id, asset_materialization_id, asset_id, project_face_assignee_id, consent_id, tenant_id, project_id, workspace_id, link_source, match_confidence, matched_at, reviewed_at, reviewed_by, matcher_version, created_at, updated_at",
      )
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .in("asset_id", assetIdChunk);

    if (workspaceId) {
      query = query.eq("workspace_id", workspaceId);
    }

    const { data, error } = await query;

    if (error) {
      throw new HttpError(500, "photo_face_link_lookup_failed", "Unable to load current photo face links.");
    }

    return (data ?? []) as FaceLinkRow[];
  });

  return rows;
}

async function loadCurrentFaceSuppressionsForAssets(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  workspaceId: string | null | undefined,
  assetIds: string[],
) {
  if (assetIds.length === 0) {
    return [] as FaceSuppressionRow[];
  }

  const rows = await runChunkedRead(assetIds, async (assetIdChunk) => {
    let query = supabase
      .from("asset_face_assignee_link_suppressions")
      .select(
        "asset_face_id, asset_materialization_id, asset_id, project_face_assignee_id, tenant_id, project_id, workspace_id, reason, created_at, created_by",
      )
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .in("asset_id", assetIdChunk);

    if (workspaceId) {
      query = query.eq("workspace_id", workspaceId);
    }

    const { data, error } = await query;

    if (error) {
      throw new HttpError(500, "photo_face_suppression_lookup_failed", "Unable to load face suppressions.");
    }

    return (data ?? []) as FaceSuppressionRow[];
  });

  return rows;
}

async function loadManualFallbacksForAssets(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  workspaceId: string | null | undefined,
  assetIds: string[],
) {
  if (assetIds.length === 0) {
    return [] as ManualFallbackRow[];
  }

  const rows = await runChunkedRead(assetIds, async (assetIdChunk) => {
    const { data, error } = await supabase
      .from("asset_consent_manual_photo_fallbacks")
      .select("asset_id, consent_id, tenant_id, project_id, workspace_id, created_by, created_at, updated_at")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .in("asset_id", assetIdChunk);

    if (error) {
      throw new HttpError(500, "photo_fallback_lookup_failed", "Unable to load photo fallbacks.");
    }

    return (data ?? []) as ManualFallbackRow[];
  });

  return rows;
}

async function expireStaleOpenSessionsForConsent(input: MatchingScopeInput) {
  const nowIso = new Date().toISOString();
  let query = input.supabase
    .from("face_review_sessions")
    .update({
      status: "expired",
      updated_at: nowIso,
    })
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("consent_id", input.consentId)
    .eq("created_by", input.actorUserId)
    .eq("status", "open")
    .lt("expires_at", nowIso);

  if (input.workspaceId) {
    query = query.eq("workspace_id", input.workspaceId);
  }

  const { error } = await query;

  if (error) {
    throw new HttpError(500, "review_session_write_failed", "Unable to update expired review sessions.");
  }
}

async function loadOpenSessionForConsent(input: MatchingScopeInput) {
  const nowIso = new Date().toISOString();
  let query = input.supabase
    .from("face_review_sessions")
    .select(
      "id, tenant_id, project_id, workspace_id, consent_id, created_by, selection_hash, status, selected_asset_count, expires_at, last_accessed_at, created_at, updated_at",
    )
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("consent_id", input.consentId)
    .eq("created_by", input.actorUserId)
    .eq("status", "open")
    .gte("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(1);

  if (input.workspaceId) {
    query = query.eq("workspace_id", input.workspaceId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new HttpError(500, "review_session_lookup_failed", "Unable to load the current review session.");
  }

  return (data as FaceReviewSessionRow | null) ?? null;
}

async function cancelOtherOpenSessions(
  input: MatchingScopeInput,
  keepSessionId: string | null,
) {
  const nowIso = new Date().toISOString();
  let query = input.supabase
    .from("face_review_sessions")
    .update({
      status: "cancelled",
      updated_at: nowIso,
    })
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("consent_id", input.consentId)
    .eq("created_by", input.actorUserId)
    .eq("status", "open");

  if (input.workspaceId) {
    query = query.eq("workspace_id", input.workspaceId);
  }

  if (keepSessionId) {
    query = query.neq("id", keepSessionId);
  }

  const { error } = await query;
  if (error) {
    throw new HttpError(500, "review_session_write_failed", "Unable to update the review session.");
  }
}

async function loadSessionById(input: FaceReviewSessionLookupInput) {
  let query = input.supabase
    .from("face_review_sessions")
    .select(
      "id, tenant_id, project_id, workspace_id, consent_id, created_by, selection_hash, status, selected_asset_count, expires_at, last_accessed_at, created_at, updated_at",
    )
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("consent_id", input.consentId)
    .eq("created_by", input.actorUserId)
    .eq("id", input.sessionId);

  if (input.workspaceId) {
    query = query.eq("workspace_id", input.workspaceId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new HttpError(500, "review_session_lookup_failed", "Unable to load the review session.");
  }

  const row = (data as FaceReviewSessionRow | null) ?? null;
  if (!row) {
    throw new HttpError(404, "review_session_not_found", "Review session not found.");
  }

  return row;
}

async function loadSessionItems(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  workspaceId: string | null | undefined,
  consentId: string,
  sessionId: string,
) {
  let query = supabase
    .from("face_review_session_items")
    .select(
      "id, session_id, tenant_id, project_id, workspace_id, consent_id, asset_id, position, status, completion_kind, block_code, prepared_materialization_id, selected_asset_face_id, detected_face_count, last_reconciled_at, created_at, updated_at",
    )
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("consent_id", consentId)
    .eq("session_id", sessionId);

  if (workspaceId) {
    query = query.eq("workspace_id", workspaceId);
  }

  const { data, error } = await query.order("position", { ascending: true });

  if (error) {
    throw new HttpError(500, "review_session_lookup_failed", "Unable to load review session items.");
  }

  return ((data ?? []) as FaceReviewSessionItemRow[]) ?? [];
}

function getPendingMaterializationStatus(
  result: RepairFaceMatchJobResult | EnqueueFaceMatchJobResult,
): "queued" | "processing" {
  if (("alreadyProcessing" in result && result.alreadyProcessing) || result.status === "processing") {
    return "processing";
  }

  return "queued";
}

async function enqueueBulkMaterialization(
  input: MatchingScopeInput & {
    assetId: string;
  },
) {
  return enqueueMaterializeAssetFacesJob({
    tenantId: input.tenantId,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    assetId: input.assetId,
    materializerVersion: getAutoMatchMaterializerVersion(),
    mode: "repair_requeue",
    requeueReason: "review_session_prepare",
    payload: {
      repairRequested: true,
      source: "face_review_session",
    },
    supabase: input.supabase,
  });
}

function shouldAttemptDirectMaterialization(item: FaceReviewSessionItemRow) {
  if (item.status !== "pending_materialization") {
    return false;
  }

  const createdAtMillis = Date.parse(item.created_at);
  if (!Number.isFinite(createdAtMillis)) {
    return false;
  }

  return Date.now() - createdAtMillis >= PENDING_DIRECT_MATERIALIZATION_GRACE_MILLIS;
}

async function attemptDirectReviewSessionMaterialization(
  input: MatchingScopeInput & {
    assetId: string;
  },
) {
  try {
    const ensured = await ensureAssetFaceMaterialization({
      supabase: input.supabase,
      matcher: input.matcher ?? getAutoMatcher(),
      tenantId: input.tenantId,
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      assetId: input.assetId,
      materializerVersion: getAutoMatchMaterializerVersion(),
      includeFaces: true,
    });

    if (!ensured) {
      return null;
    }

    return {
      materialization: ensured.materialization,
      faces: normalizeCurrentMaterializationFaces(ensured.faces),
    };
  } catch (error) {
    console.warn("[matching][face-review-session] direct_materialization_failed", {
      assetId: input.assetId,
      projectId: input.projectId,
      consentId: input.consentId,
      message: error instanceof Error ? error.message : "unknown error",
    });
    return null;
  }
}

async function upsertSessionItem(
  supabase: SupabaseClient,
  row: Partial<FaceReviewSessionItemRow> &
    Pick<
      FaceReviewSessionItemRow,
      "id" | "session_id" | "tenant_id" | "project_id" | "workspace_id" | "consent_id" | "asset_id" | "position" | "status"
    >,
) {
  const nowIso = new Date().toISOString();
  const payload = {
    ...row,
    updated_at: nowIso,
    last_reconciled_at: nowIso,
  };
  const { error } = await supabase.from("face_review_session_items").upsert(payload, {
    onConflict: "id",
  });

  if (error) {
    throw new HttpError(500, "review_session_write_failed", "Unable to update the review session.");
  }
}

async function classifyAssetForSession(
  input: MatchingScopeInput & {
    assetId: string;
    asset: ReviewableAssetRow | null;
    materialization: AssetFaceMaterializationRow | null;
  },
): Promise<
  Omit<
    FaceReviewSessionItemRow,
    | "id"
    | "session_id"
    | "tenant_id"
    | "project_id"
    | "consent_id"
    | "asset_id"
    | "position"
    | "created_at"
    | "updated_at"
    | "last_reconciled_at"
  >
> {
  if (!input.asset || input.asset.status !== "uploaded" || input.asset.archived_at) {
    return {
      status: "blocked",
      completion_kind: null,
      block_code: "asset_unavailable",
      prepared_materialization_id: null,
      selected_asset_face_id: null,
      detected_face_count: null,
    };
  }

  if (!input.materialization) {
    try {
      const queueResult = await enqueueBulkMaterialization(input);
      void getPendingMaterializationStatus(queueResult);
      return {
        status: "pending_materialization",
        completion_kind: null,
        block_code: null,
        prepared_materialization_id: null,
        selected_asset_face_id: null,
        detected_face_count: null,
      };
    } catch {
      return {
        status: "blocked",
        completion_kind: null,
        block_code: "materialization_failed",
        prepared_materialization_id: null,
        selected_asset_face_id: null,
        detected_face_count: null,
      };
    }
  }

  if (input.materialization.face_count <= 0) {
    await manualLinkPhotoToConsent({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
      consentId: input.consentId,
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      assetId: input.assetId,
      mode: "asset_fallback",
    });

    return {
      status: "completed",
      completion_kind: "linked_fallback",
      block_code: null,
      prepared_materialization_id: input.materialization.id,
      selected_asset_face_id: null,
      detected_face_count: 0,
    };
  }

  if (input.materialization.face_count === 1) {
    const result = await manualLinkPhotoToConsent({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
      consentId: input.consentId,
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      assetId: input.assetId,
      mode: "face",
    });

    if (result.kind === "manual_conflict") {
      return {
        status: "blocked",
        completion_kind: null,
        block_code: "manual_conflict",
        prepared_materialization_id: input.materialization.id,
        selected_asset_face_id: null,
        detected_face_count: 1,
      };
    }

    return {
      status: "completed",
      completion_kind: "linked_face",
      block_code: null,
      prepared_materialization_id: input.materialization.id,
      selected_asset_face_id: result.assetFaceId,
      detected_face_count: 1,
    };
  }

  return {
    status: "ready_for_face_selection",
    completion_kind: null,
    block_code: null,
    prepared_materialization_id: input.materialization.id,
    selected_asset_face_id: null,
    detected_face_count: input.materialization.face_count,
  };
}

function buildSessionSummary(session: FaceReviewSessionRow, items: FaceReviewSessionItemRow[]): FaceReviewSessionSummary {
  const completedCount = items.filter((item) => item.status === "completed").length;
  const pendingMaterializationCount = items.filter((item) => item.status === "pending_materialization").length;
  const readyItems = items.filter((item) => item.status === "ready_for_face_selection");
  const blockedCount = items.filter((item) => item.status === "blocked").length;
  const nextReviewItem = readyItems[0] ?? null;
  const currentQueueIndex = nextReviewItem ? readyItems.findIndex((item) => item.id === nextReviewItem.id) + 1 : null;

  return {
    id: session.id,
    status: session.status,
    selectedAssetCount: session.selected_asset_count,
    completedCount,
    pendingMaterializationCount,
    readyForFaceSelectionCount: readyItems.length,
    blockedCount,
    currentQueueIndex,
    nextReviewItemId: nextReviewItem?.id ?? null,
  };
}

async function touchSession(
  supabase: SupabaseClient,
  sessionId: string,
  keepStatus: FaceReviewSessionRow["status"],
) {
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("face_review_sessions")
    .update({
      status: keepStatus,
      last_accessed_at: nowIso,
      expires_at: keepStatus === "open" ? getSessionExpiryIso() : nowIso,
      updated_at: nowIso,
    })
    .eq("id", sessionId);

  if (error) {
    throw new HttpError(500, "review_session_write_failed", "Unable to update the review session.");
  }
}

async function setSessionStatus(
  supabase: SupabaseClient,
  sessionId: string,
  status: FaceReviewSessionRow["status"],
) {
  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("face_review_sessions")
    .update({
      status,
      last_accessed_at: nowIso,
      expires_at: nowIso,
      updated_at: nowIso,
    })
    .eq("id", sessionId);

  if (error) {
    throw new HttpError(500, "review_session_write_failed", "Unable to update the review session.");
  }
}

async function reconcileSessionState(input: MatchingScopeInput & { session: FaceReviewSessionRow }) {
  const items = await loadSessionItems(
    input.supabase,
    input.tenantId,
    input.projectId,
    input.workspaceId,
    input.consentId,
    input.session.id,
  );
  const rematerializedItemIds = new Set<string>();
  const consent = await assertConsentInProject(input);
  let remainingDirectMaterializationBudget = MAX_DIRECT_MATERIALIZATIONS_PER_SESSION_READ;

  for (const item of items) {
    if (item.status === "completed" || item.status === "blocked") {
      continue;
    }

    if (consent.revoked_at) {
      await upsertSessionItem(input.supabase, {
        id: item.id,
        session_id: item.session_id,
        tenant_id: item.tenant_id,
        project_id: item.project_id,
        consent_id: item.consent_id,
        asset_id: item.asset_id,
        position: item.position,
        status: "blocked",
        completion_kind: null,
        block_code: "consent_revoked",
        prepared_materialization_id: item.prepared_materialization_id,
        selected_asset_face_id: null,
        detected_face_count: item.detected_face_count,
      });
      continue;
    }

    const assetMap = await loadReviewableAssetsMap(
      input.supabase,
      input.tenantId,
      input.projectId,
      input.workspaceId,
      [item.asset_id],
    );
    const asset = assetMap.get(item.asset_id) ?? null;
    const current = await loadCurrentAssetFaceMaterialization(
      input.supabase,
      input.tenantId,
      input.projectId,
      item.asset_id,
      getAutoMatchMaterializerVersion(),
      { includeFaces: false },
    );

    if (!current) {
      if (
        remainingDirectMaterializationBudget > 0 &&
        shouldAttemptDirectMaterialization(item)
      ) {
        const directlyMaterialized = await attemptDirectReviewSessionMaterialization({
          ...input,
          assetId: item.asset_id,
        });

        if (directlyMaterialized) {
          remainingDirectMaterializationBudget -= 1;

          const classification = await classifyAssetForSession({
            ...input,
            assetId: item.asset_id,
            asset,
            materialization: directlyMaterialized.materialization,
          });

          await upsertSessionItem(input.supabase, {
            id: item.id,
            session_id: item.session_id,
            tenant_id: item.tenant_id,
            project_id: item.project_id,
            consent_id: item.consent_id,
            asset_id: item.asset_id,
            position: item.position,
            status: classification.status,
            completion_kind: classification.completion_kind,
            block_code: classification.block_code,
            prepared_materialization_id: classification.prepared_materialization_id,
            selected_asset_face_id: classification.selected_asset_face_id,
            detected_face_count: classification.detected_face_count,
          });
          continue;
        }
      }

      try {
        await enqueueBulkMaterialization({
          ...input,
          assetId: item.asset_id,
        });
      } catch {
        await upsertSessionItem(input.supabase, {
          id: item.id,
          session_id: item.session_id,
          tenant_id: item.tenant_id,
          project_id: item.project_id,
          consent_id: item.consent_id,
          asset_id: item.asset_id,
          position: item.position,
          status: "blocked",
          completion_kind: null,
          block_code: "materialization_failed",
          prepared_materialization_id: null,
          selected_asset_face_id: null,
          detected_face_count: null,
        });
        continue;
      }

      await upsertSessionItem(input.supabase, {
        id: item.id,
        session_id: item.session_id,
        tenant_id: item.tenant_id,
        project_id: item.project_id,
        consent_id: item.consent_id,
        asset_id: item.asset_id,
        position: item.position,
        status: "pending_materialization",
        completion_kind: null,
        block_code: null,
        prepared_materialization_id: null,
        selected_asset_face_id: null,
        detected_face_count: null,
      });
      continue;
    }

    const lastReconciledMillis = Date.parse(item.last_reconciled_at);
    const currentMaterializedMillis = Date.parse(current.materialization.materialized_at);
    const materializedAfterItem =
      Number.isFinite(lastReconciledMillis) &&
      Number.isFinite(currentMaterializedMillis) &&
      currentMaterializedMillis > lastReconciledMillis;
    const faceCountChanged =
      item.detected_face_count !== null && item.detected_face_count !== current.materialization.face_count;

    if (
      (item.prepared_materialization_id && item.prepared_materialization_id !== current.materialization.id) ||
      materializedAfterItem ||
      faceCountChanged
    ) {
      rematerializedItemIds.add(item.id);
    }

    const classification = await classifyAssetForSession({
      ...input,
      assetId: item.asset_id,
      asset,
      materialization: current.materialization,
    });

    await upsertSessionItem(input.supabase, {
      id: item.id,
      session_id: item.session_id,
      tenant_id: item.tenant_id,
      project_id: item.project_id,
      consent_id: item.consent_id,
      asset_id: item.asset_id,
      position: item.position,
      status: classification.status,
      completion_kind: classification.completion_kind,
      block_code: classification.block_code,
      prepared_materialization_id: classification.prepared_materialization_id,
      selected_asset_face_id: classification.selected_asset_face_id,
      detected_face_count: classification.detected_face_count,
    });
  }

  const refreshedItems = await loadSessionItems(
    input.supabase,
    input.tenantId,
    input.projectId,
    input.workspaceId,
    input.consentId,
    input.session.id,
  );

  const nextStatus = refreshedItems.every((item) => item.status === "completed" || item.status === "blocked")
    ? "completed"
    : input.session.status;

  if (nextStatus !== input.session.status) {
    await setSessionStatus(input.supabase, input.session.id, nextStatus);
  } else {
    await touchSession(input.supabase, input.session.id, input.session.status);
  }

  const refreshedSession = await loadSessionById({
    ...input,
    sessionId: input.session.id,
  });

  return {
    session: refreshedSession,
    items: refreshedItems,
    rematerializedItemIds,
  };
}

async function buildSessionReadModel(
  input: MatchingScopeInput & {
    session: FaceReviewSessionRow;
    items: FaceReviewSessionItemRow[];
    rematerializedItemIds?: Set<string>;
  },
) {
  const assetIds = Array.from(new Set(input.items.map((item) => item.asset_id)));
  const assets = await loadReviewableAssetsMap(
    input.supabase,
    input.tenantId,
    input.projectId,
    input.workspaceId,
    assetIds,
  );
  const materializations = await loadCurrentPhotoMaterializationMap(
    input.supabase,
    input.tenantId,
    input.projectId,
    input.workspaceId,
    assetIds,
  );
  const facesByMaterializationId = await loadMaterializationFacesMap(
    input.supabase,
    Array.from(new Set(Array.from(materializations.values()).map((row) => row.id))),
  );
  const faceLinks = await loadCurrentFaceLinksForAssets(
    input.supabase,
    input.tenantId,
    input.projectId,
    input.workspaceId,
    assetIds,
  );
  const faceSuppressions = await loadCurrentFaceSuppressionsForAssets(
    input.supabase,
    input.tenantId,
    input.projectId,
    input.workspaceId,
    assetIds,
  );
  const fallbacks = await loadManualFallbacksForAssets(
    input.supabase,
    input.tenantId,
    input.projectId,
    input.workspaceId,
    assetIds,
  );
  const faceIds = Array.from(new Set(faceLinks.map((row) => row.asset_face_id)));
  input.items.forEach((item) => {
    const materialization = materializations.get(item.asset_id);
    const faces = materialization ? facesByMaterializationId.get(materialization.id) ?? [] : [];
    faces.forEach((face) => faceIds.push(face.id));
  });
  const derivatives = await loadFaceImageDerivativesForFaceIds(
    input.supabase,
    input.tenantId,
    input.projectId,
    Array.from(new Set(faceIds)),
  );
  const consentSummaries = await loadConsentSummaries(
    input.supabase,
    input.tenantId,
    input.projectId,
    Array.from(
      new Set(faceLinks.map((row) => row.consent_id).filter((value): value is string => Boolean(value))),
    ),
  );
  const assigneeRowsById = await loadProjectFaceAssigneeRowsByIds({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
    assigneeIds: Array.from(new Set(faceSuppressions.map((row) => row.project_face_assignee_id))),
  });
  const currentMaterializationIdByAssetId = new Map(
    Array.from(materializations.entries()).map(([assetId, materialization]) => [assetId, materialization.id]),
  );
  const faceConfidenceByAssetFaceKey = await loadCurrentConsentFaceConfidenceByAssetFaceKey({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
    consentId: input.consentId,
    workspaceId: input.workspaceId,
    assetIds,
    currentMaterializationIdByAssetId,
  });
  const faceLinksByFaceId = new Map(faceLinks.map((row) => [row.asset_face_id, row]));
  const currentConsentFaceByAssetId = new Map(
    faceLinks
      .filter((row) => row.consent_id === input.consentId)
      .map((row) => [row.asset_id, row.asset_face_id]),
  );
  const fallbackAssetIds = new Set(
    fallbacks.filter((row) => row.consent_id === input.consentId).map((row) => row.asset_id),
  );
  const suppressionKeySet = new Set(
    faceSuppressions
      .filter((row) => (assigneeRowsById.get(row.project_face_assignee_id)?.consent_id ?? null) === input.consentId)
      .map((row) => `${row.asset_face_id}:${input.consentId}`),
  );

  const items = input.items.map((item) => {
    const asset = assets.get(item.asset_id) ?? null;
    const materialization = materializations.get(item.asset_id) ?? null;
    const faces = materialization ? facesByMaterializationId.get(materialization.id) ?? [] : [];
    const currentConsentFaceId = currentConsentFaceByAssetId.get(item.asset_id) ?? null;

    return {
      id: item.id,
      assetId: item.asset_id,
      position: item.position,
      status: item.status,
      completionKind:
        item.completion_kind ??
        (fallbackAssetIds.has(item.asset_id) && item.status === "completed" ? "linked_fallback" : null),
      blockCode: item.block_code,
      preparedMaterializationId: item.prepared_materialization_id,
      detectedFaceCount: item.detected_face_count,
      wasRematerialized: input.rematerializedItemIds?.has(item.id) ?? false,
      asset: {
        originalFilename: asset?.original_filename ?? "Unavailable asset",
        status: asset?.status ?? "missing",
        storageBucket: asset?.storage_bucket ?? null,
        storagePath: asset?.storage_path ?? null,
      },
      faces: faces.map((face) => {
        const assignee = faceLinksByFaceId.get(face.id) ?? null;
        const summary = assignee?.consent_id ? consentSummaries.get(assignee.consent_id) : undefined;
        const isSuppressedForConsent = suppressionKeySet.has(`${face.id}:${input.consentId}`);
        const isCurrentConsentFace = currentConsentFaceId === face.id;
        return {
          assetFaceId: face.id,
          faceRank: face.face_rank,
          faceBoxNormalized: face.face_box_normalized,
          matchConfidence:
            faceConfidenceByAssetFaceKey.get(`${item.asset_id}:${face.id}`) ??
            assignee?.match_confidence ??
            null,
          cropDerivative: derivatives.get(face.id) ?? null,
          status: deriveManualPhotoLinkFaceStatus({
            currentAssignee: assignee,
            isSuppressedForConsent,
            isCurrentConsentFace,
          }),
          currentAssignee: assignee
            ? {
                consentId: assignee.consent_id,
                fullName: summary?.fullName ?? null,
                email: summary?.email ?? null,
                linkSource: assignee.link_source,
              }
            : null,
          isCurrentConsentFace,
          isSuppressedForConsent,
        };
      }),
    };
  });

  return {
    session: buildSessionSummary(input.session, input.items),
    items,
  };
}

async function createSessionAndItems(
  input: PrepareFaceReviewSessionInput & {
    selectionHash: string;
    assetIds: string[];
  },
) {
  const nowIso = new Date().toISOString();
  const sessionId = randomUUID();
  const expiresAt = getSessionExpiryIso();

  const { error: sessionInsertError } = await input.supabase.from("face_review_sessions").insert({
    id: sessionId,
    tenant_id: input.tenantId,
    project_id: input.projectId,
    workspace_id: input.workspaceId ?? null,
    consent_id: input.consentId,
    created_by: input.actorUserId,
    selection_hash: input.selectionHash,
    status: "open",
    selected_asset_count: input.assetIds.length,
    expires_at: expiresAt,
    last_accessed_at: nowIso,
    created_at: nowIso,
    updated_at: nowIso,
  });

  if (sessionInsertError) {
    throw new HttpError(500, "review_session_write_failed", "Unable to create the review session.");
  }

  const assetMap = await loadReviewableAssetsMap(
    input.supabase,
    input.tenantId,
    input.projectId,
    input.workspaceId,
    input.assetIds,
  );
  const materializations = await loadCurrentPhotoMaterializationMap(
    input.supabase,
    input.tenantId,
    input.projectId,
    input.workspaceId,
    input.assetIds,
  );

  const itemRows: Array<Record<string, unknown>> = [];
  for (const [position, assetId] of input.assetIds.entries()) {
    const asset = assetMap.get(assetId) ?? null;
    const classification = await classifyAssetForSession({
      ...input,
      assetId,
      asset,
      materialization: materializations.get(assetId) ?? null,
    });

    itemRows.push({
      id: randomUUID(),
      session_id: sessionId,
      tenant_id: input.tenantId,
      project_id: input.projectId,
      workspace_id: input.workspaceId ?? null,
      consent_id: input.consentId,
      asset_id: assetId,
      position,
      status: classification.status,
      completion_kind: classification.completion_kind,
      block_code: classification.block_code,
      prepared_materialization_id: classification.prepared_materialization_id,
      selected_asset_face_id: classification.selected_asset_face_id,
      detected_face_count: classification.detected_face_count,
      last_reconciled_at: nowIso,
      created_at: nowIso,
      updated_at: nowIso,
    });
  }

  if (itemRows.length > 0) {
    const { error: itemInsertError } = await input.supabase.from("face_review_session_items").insert(itemRows);
    if (itemInsertError) {
      throw new HttpError(500, "review_session_write_failed", "Unable to create review session items.");
    }
  }

  return sessionId;
}

export async function prepareFaceReviewSession(input: PrepareFaceReviewSessionInput): Promise<ReviewSessionPrepareResult> {
  await assertConsentInProject(input, { requireNotRevoked: true });
  const assetIds = normalizeUniqueAssetIds(input.assetIds);
  const selectionHash = buildSelectionHash(assetIds);

  await expireStaleOpenSessionsForConsent(input);
  const existing = await loadOpenSessionForConsent(input);
  if (existing?.selection_hash === selectionHash) {
    const readModel = await getFaceReviewSession({
      ...input,
      sessionId: existing.id,
    });
    return {
      session: {
        ...readModel.session,
        reusedExistingSession: true,
      },
    };
  }

  if (existing) {
    await cancelOtherOpenSessions(input, null);
  }

  const sessionId = await createSessionAndItems({
    ...input,
    assetIds,
    selectionHash,
  });
  const readModel = await getFaceReviewSession({
    ...input,
    sessionId,
  });
  return {
    session: {
      ...readModel.session,
      reusedExistingSession: false,
    },
  };
}

export async function getCurrentFaceReviewSession(input: MatchingScopeInput): Promise<FaceReviewSessionReadModel> {
  await expireStaleOpenSessionsForConsent(input);
  const session = await loadOpenSessionForConsent(input);
  if (!session) {
    throw new HttpError(404, "review_session_not_found", "No active review session exists.");
  }

  return getFaceReviewSession({
    ...input,
    sessionId: session.id,
  });
}

export async function getFaceReviewSession(input: FaceReviewSessionLookupInput): Promise<FaceReviewSessionReadModel> {
  await assertConsentInProject(input);
  const session = await loadSessionById(input);
  if (session.status === "expired" || (session.status === "open" && Date.parse(session.expires_at) <= Date.now())) {
    if (session.status === "open") {
      await setSessionStatus(input.supabase, session.id, "expired");
    }
    throw new HttpError(409, "review_session_expired", "This review session has expired.");
  }

  const reconciled =
    session.status === "open"
      ? await reconcileSessionState({
          ...input,
          session,
        })
      : {
          session,
          items: await loadSessionItems(
            input.supabase,
            input.tenantId,
            input.projectId,
            input.workspaceId,
            input.consentId,
            session.id,
          ),
          rematerializedItemIds: new Set<string>(),
        };

  return buildSessionReadModel({
    ...input,
    session: reconciled.session,
    items: reconciled.items,
    rematerializedItemIds: reconciled.rematerializedItemIds,
  });
}

function blockCodeToMessage(blockCode: FaceReviewSessionItemRow["block_code"]) {
  switch (blockCode) {
    case "consent_revoked":
      return "Revoked consents cannot be linked to photos.";
    case "manual_conflict":
      return "This face is already manually assigned to another consent.";
    case "asset_unavailable":
      return "This asset is no longer available for review.";
    case "materialization_failed":
      return "Face materialization could not be prepared for this photo yet.";
    default:
      return "This review item cannot be changed.";
  }
}

export async function applyFaceReviewSessionItemAction(
  input: FaceReviewSessionActionInput,
): Promise<{
  item: Pick<FaceReviewSessionItemReadModel, "id" | "status" | "completionKind">;
  session: Pick<
    FaceReviewSessionSummary,
    "nextReviewItemId" | "completedCount" | "readyForFaceSelectionCount" | "pendingMaterializationCount"
  >;
}> {
  const readModel = await getFaceReviewSession({
    ...input,
    sessionId: input.sessionId,
  });
  if (readModel.session.status !== "open") {
    throw new HttpError(409, "review_session_expired", "This review session is no longer active.");
  }

  const targetItem = readModel.items.find((item) => item.id === input.itemId) ?? null;
  if (!targetItem) {
    throw new HttpError(404, "review_session_not_found", "Review session item not found.");
  }

  if (targetItem.status === "completed") {
    return {
      item: {
        id: targetItem.id,
        status: targetItem.status,
        completionKind: targetItem.completionKind,
      },
      session: {
        nextReviewItemId: readModel.session.nextReviewItemId,
        completedCount: readModel.session.completedCount,
        readyForFaceSelectionCount: readModel.session.readyForFaceSelectionCount,
        pendingMaterializationCount: readModel.session.pendingMaterializationCount,
      },
    };
  }

  if (targetItem.status === "blocked") {
    throw new HttpError(409, targetItem.blockCode ?? "review_item_blocked", blockCodeToMessage(targetItem.blockCode));
  }

  if (targetItem.status === "pending_materialization") {
    throw new HttpError(
      409,
      "photo_materialization_pending",
      "Photo face materialization is still pending for this photo.",
    );
  }

  await assertConsentInProject(input, { requireNotRevoked: true });

  if (input.action === "suppress_face") {
    await manualUnlinkPhotoFromConsent({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
      consentId: input.consentId,
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      assetId: targetItem.assetId,
      assetFaceId: input.assetFaceId ?? null,
      mode: "face",
    });
  } else {
    const result = await manualLinkPhotoToConsent({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
      consentId: input.consentId,
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      assetId: targetItem.assetId,
      assetFaceId: input.assetFaceId ?? null,
      mode: "face",
      forceReplace: input.forceReplace === true,
    });

    if (result.kind === "manual_conflict") {
      throw Object.assign(
        new HttpError(409, "manual_conflict", "This face is already manually assigned to another consent."),
        {
          currentAssignee: result.currentAssignee,
          canForceReplace: result.canForceReplace,
        },
      );
    }
  }

  const current = await loadCurrentAssetFaceMaterialization(
    input.supabase,
    input.tenantId,
    input.projectId,
    targetItem.assetId,
    getAutoMatchMaterializerVersion(),
    { includeFaces: true },
  );

  await upsertSessionItem(input.supabase, {
    id: targetItem.id,
    session_id: input.sessionId,
    tenant_id: input.tenantId,
    project_id: input.projectId,
    consent_id: input.consentId,
    asset_id: targetItem.assetId,
    position: targetItem.position,
    status: "completed",
    completion_kind: input.action === "suppress_face" ? "suppressed_face" : "linked_face",
    block_code: null,
    prepared_materialization_id: current?.materialization.id ?? targetItem.preparedMaterializationId,
    selected_asset_face_id: input.assetFaceId ?? null,
    detected_face_count: current?.materialization.face_count ?? targetItem.detectedFaceCount,
  });

  const refreshed = await getFaceReviewSession({
    ...input,
    sessionId: input.sessionId,
  });
  const refreshedItem = refreshed.items.find((item) => item.id === input.itemId);
  if (!refreshedItem) {
    throw new HttpError(500, "review_session_lookup_failed", "Unable to refresh the review session item.");
  }

  return {
    item: {
      id: refreshedItem.id,
      status: refreshedItem.status,
      completionKind: refreshedItem.completionKind,
    },
    session: {
      nextReviewItemId: refreshed.session.nextReviewItemId,
      completedCount: refreshed.session.completedCount,
      readyForFaceSelectionCount: refreshed.session.readyForFaceSelectionCount,
      pendingMaterializationCount: refreshed.session.pendingMaterializationCount,
    },
  };
}
