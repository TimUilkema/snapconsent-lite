import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import {
  getAutoMatchCompareVersion,
  getAutoMatchConfidenceThreshold,
  getAutoMatchMaterializerVersion,
} from "@/lib/matching/auto-match-config";
import {
  enqueueMaterializeAssetFacesJob,
  type RepairFaceMatchJobResult,
} from "@/lib/matching/auto-match-jobs";
import { getAutoMatcher, type AutoMatcher } from "@/lib/matching/auto-matcher";
import {
  ensureAssetFaceMaterialization,
  loadCurrentAssetFaceMaterialization,
  shouldForceRematerializeCurrentMaterialization,
  type AssetFaceMaterializationFaceRow,
  type AssetFaceMaterializationRow,
} from "@/lib/matching/face-materialization";
import { runChunkedRead } from "@/lib/supabase/safe-in-filter";

type MatchingScopeInput = {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  consentId: string;
  actorUserId?: string | null;
};

type ListMatchableProjectPhotosInput = MatchingScopeInput & {
  query?: string | null;
  limit?: number | null;
  page?: number | null;
  mode?: MatchablePhotosMode;
};

type PhotoAssetInput = MatchingScopeInput & {
  assetId: string;
  matcher?: AutoMatcher;
};

type ManualPhotoLinkInput = PhotoAssetInput & {
  assetFaceId?: string | null;
  mode?: ManualPhotoLinkMode;
  forceReplace?: boolean;
};

type ManualPhotoUnlinkInput = PhotoAssetInput & {
  assetFaceId?: string | null;
  mode?: ManualPhotoLinkMode;
};

type ConsentRow = {
  id: string;
  revoked_at: string | null;
  face_match_opt_in: boolean;
};

type PhotoAssetRow = {
  id: string;
  original_filename: string;
  status: string;
  file_size_bytes: number;
  created_at: string;
  uploaded_at: string | null;
  archived_at: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
};

type CurrentMaterializationFace = AssetFaceMaterializationFaceRow & {
  face_box: Record<string, number | null>;
  face_box_normalized: Record<string, number | null> | null;
};

type FaceLinkRow = {
  asset_face_id: string;
  asset_materialization_id: string;
  asset_id: string;
  consent_id: string;
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
  consent_id: string;
  tenant_id: string;
  project_id: string;
  reason: "manual_unlink" | "manual_replace";
  created_at: string;
  created_by: string | null;
};

type HiddenFaceRow = {
  id: string;
  asset_face_id: string;
  asset_materialization_id: string;
  asset_id: string;
  tenant_id: string;
  project_id: string;
  reason: "manual_hide";
  hidden_at: string;
  hidden_by: string | null;
  restored_at: string | null;
  restored_by: string | null;
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

type ManualFallbackSuppressionRow = {
  asset_id: string;
  consent_id: string;
  tenant_id: string;
  project_id: string;
  reason: "manual_unlink";
  created_at: string;
  created_by: string | null;
};

type MatchCandidateRow = {
  asset_id: string;
  consent_id: string;
  confidence: number | string;
  matcher_version: string | null;
  last_scored_at: string;
  winning_asset_face_id: string | null;
  winning_asset_face_rank: number | null;
};

type CompareRow = {
  asset_id: string;
  consent_id: string;
  headshot_materialization_id: string;
  asset_materialization_id: string;
  winning_asset_face_id: string | null;
  winning_asset_face_rank: number | null;
  winning_similarity: number | string;
  compare_status: string;
  compare_version: string;
};

type ConsentSummary = {
  consentId: string;
  fullName: string | null;
  email: string | null;
};

type ResolvedPhotoState = {
  asset: PhotoAssetRow;
  materialization: AssetFaceMaterializationRow | null;
  faces: CurrentMaterializationFace[];
  hiddenFaceIds: Set<string>;
};

export type PhotoConsentAssignment = {
  assetId: string;
  consentId: string;
};

export type MatchablePhotoRow = {
  id: string;
  original_filename: string;
  status: string;
  file_size_bytes: number;
  created_at: string;
  uploaded_at: string | null;
  archived_at: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  isLinked: boolean;
  candidate_confidence: number | null;
  candidate_last_scored_at: string | null;
  candidate_matcher_version: string | null;
  candidate_asset_face_id: string | null;
  candidate_face_rank: number | null;
};

export type MatchablePhotoPage = {
  assets: MatchablePhotoRow[];
  page: number;
  pageSize: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
};

export type LinkedPhotoRow = {
  id: string;
  original_filename: string;
  status: string;
  file_size_bytes: number;
  created_at: string;
  uploaded_at: string | null;
  archived_at: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
  link_created_at: string;
  link_source: "manual" | "auto";
  match_confidence: number | null;
  matched_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  link_mode: "face" | "asset_fallback";
  asset_face_id: string | null;
  face_rank: number | null;
  detected_face_count: number | null;
};

export type ManualPhotoLinkMode = "auto" | "face" | "asset_fallback";

export type ManualPhotoLinkConflict = {
  kind: "manual_conflict";
  canForceReplace: boolean;
  currentAssignee: {
    consentId: string;
    fullName: string | null;
    email: string | null;
    linkSource: "manual" | "auto";
  } | null;
};

export type ManualPhotoLinkResult =
  | {
      kind: "linked";
      mode: "face" | "asset_fallback";
      replacedConsentId: string | null;
      assetFaceId: string | null;
    }
  | {
      kind: "already_linked";
      mode: "face" | "asset_fallback";
      assetFaceId: string | null;
    }
  | ManualPhotoLinkConflict;

export type ManualPhotoUnlinkResult = {
  kind: "unlinked";
  mode: "face" | "asset_fallback";
  assetFaceId: string | null;
};

export type HideAssetFaceResult = {
  kind: "hidden" | "already_hidden";
  assetFaceId: string;
  removedConsentId: string | null;
  removedLinkSource: "manual" | "auto" | null;
};

export type RestoreHiddenAssetFaceResult = {
  kind: "restored" | "already_restored";
  assetFaceId: string;
};

export type ManualPhotoLinkState = {
  materializationStatus: "ready" | "queued" | "processing";
  assetId: string;
  materializationId: string | null;
  detectedFaceCount: number;
  faces: Array<{
    assetFaceId: string;
    faceRank: number;
    faceBox: Record<string, number | null>;
    faceBoxNormalized: Record<string, number | null> | null;
    matchConfidence: number | null;
    status: "current" | "occupied_manual" | "occupied_auto" | "suppressed" | "available";
    currentAssignee: {
      consentId: string;
      fullName: string | null;
      email: string | null;
      linkSource: "manual" | "auto";
    } | null;
    isSuppressedForConsent: boolean;
    isCurrentConsentFace: boolean;
  }>;
  fallbackAllowed: boolean;
  currentConsentLink:
    | {
        mode: "face";
        linkSource: "manual" | "auto";
        assetFaceId: string;
        faceRank: number | null;
      }
    | {
        mode: "asset_fallback";
        linkSource: "manual";
      }
    | null;
};

export type AssetLinkedFaceOverlayRow = {
  assetId: string;
  assetFaceId: string;
  consentId: string;
  faceRank: number;
  faceBoxNormalized: Record<string, number | null> | null;
  linkSource: "manual" | "auto";
  matchConfidence: number | null;
};

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const LIKELY_REVIEW_MIN_CONFIDENCE = 0.25;
const DEFAULT_MATCHABLE_BATCH_SIZE = 60;

export const MATCHABLE_PHOTOS_MODES = ["default", "likely"] as const;
export type MatchablePhotosMode = (typeof MATCHABLE_PHOTOS_MODES)[number];

function normalizeListLimit(value: number | null | undefined) {
  if (!Number.isFinite(value) || value === null || value === undefined) {
    return DEFAULT_LIMIT;
  }

  const bounded = Math.floor(value);
  if (bounded <= 0) {
    return DEFAULT_LIMIT;
  }

  return Math.min(bounded, MAX_LIMIT);
}

function normalizeListPage(value: number | null | undefined) {
  if (!Number.isFinite(value) || value === null || value === undefined) {
    return 0;
  }

  const normalized = Math.floor(value);
  return normalized >= 0 ? normalized : 0;
}

function normalizeQuery(value: string | null | undefined) {
  const trimmed = String(value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeMatchablePhotosMode(value: MatchablePhotosMode | string | null | undefined): MatchablePhotosMode {
  if (String(value ?? "").trim().toLowerCase() === "likely") {
    return "likely";
  }

  return "default";
}

function normalizeManualMode(value: ManualPhotoLinkMode | string | null | undefined): ManualPhotoLinkMode {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "face" || normalized === "asset_fallback") {
    return normalized;
  }

  return "auto";
}

function toNumericConfidence(value: number | string | null | undefined) {
  const numeric = Number(value ?? NaN);
  return Number.isFinite(numeric) ? numeric : null;
}

function buildPairKey(assetId: string, consentId: string) {
  return `${assetId}:${consentId}`;
}

function toMatchablePhotoRow(asset: PhotoAssetRow, candidate?: {
  confidence: number;
  lastScoredAt: string;
  matcherVersion: string | null;
  assetFaceId: string;
  faceRank: number | null;
}): MatchablePhotoRow {
  return {
    id: asset.id,
    original_filename: asset.original_filename,
    status: asset.status,
    file_size_bytes: asset.file_size_bytes,
    created_at: asset.created_at,
    uploaded_at: asset.uploaded_at,
    archived_at: asset.archived_at,
    storage_bucket: asset.storage_bucket,
    storage_path: asset.storage_path,
    isLinked: false,
    candidate_confidence: candidate?.confidence ?? null,
    candidate_last_scored_at: candidate?.lastScoredAt ?? null,
    candidate_matcher_version: candidate?.matcherVersion ?? null,
    candidate_asset_face_id: candidate?.assetFaceId ?? null,
    candidate_face_rank: candidate?.faceRank ?? null,
  };
}

function buildMatchablePageResult(
  rows: MatchablePhotoRow[],
  page: number,
  pageSize: number,
): MatchablePhotoPage {
  const hasNextPage = rows.length > pageSize;
  return {
    assets: hasNextPage ? rows.slice(0, pageSize) : rows,
    page,
    pageSize,
    hasNextPage,
    hasPreviousPage: page > 0,
  };
}

async function resolveLikelyCandidateBatch(
  input: MatchingScopeInput,
  candidateRows: Array<MatchCandidateRow & { confidence: number }>,
) {
  if (candidateRows.length === 0) {
    return [] as MatchablePhotoRow[];
  }

  const candidateAssetIds = Array.from(new Set(candidateRows.map((row) => row.asset_id)));
  const assets = await runChunkedRead(candidateAssetIds, async (assetIdChunk) => {
    const { data, error } = await input.supabase
      .from("assets")
      .select(
        "id, original_filename, status, file_size_bytes, created_at, uploaded_at, archived_at, storage_bucket, storage_path",
      )
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .eq("asset_type", "photo")
      .eq("status", "uploaded")
      .is("archived_at", null)
      .in("id", assetIdChunk);

    if (error) {
      throw new HttpError(500, "asset_lookup_failed", "Unable to load likely-match assets.");
    }

    return (data ?? []) as PhotoAssetRow[];
  });

  const assetRows = assets ?? [];
  if (assetRows.length === 0) {
    return [] as MatchablePhotoRow[];
  }

  const assetById = new Map(assetRows.map((row) => [row.id, row]));
  const { materializations, facesByMaterializationId } = await loadCurrentPhotoStateMap(
    input.supabase,
    input.tenantId,
    input.projectId,
    assetRows.map((row) => row.id),
  );
  const hiddenFaces = await loadCurrentHiddenFacesForAssets(
    input.supabase,
    input.tenantId,
    input.projectId,
    assetRows.map((row) => row.id),
    new Map(Array.from(materializations.entries()).map(([assetId, materialization]) => [assetId, materialization.id])),
  );
  const links = await loadCurrentFaceLinksForAssets(
    input.supabase,
    input.tenantId,
    input.projectId,
    assetRows.map((row) => row.id),
  );
  const suppressions = await loadCurrentFaceSuppressionsForAssets(
    input.supabase,
    input.tenantId,
    input.projectId,
    assetRows.map((row) => row.id),
  );
  const fallbacks = await loadFallbackRowsForAssets(
    input.supabase,
    input.tenantId,
    input.projectId,
    assetRows.map((row) => row.id),
  );
  const hiddenFaceIds = new Set(hiddenFaces.map((row) => row.asset_face_id));

  const linkedPairs = new Set<string>();
  links.forEach((row) => {
    const materialization = materializations.get(row.asset_id);
    if (!materialization || materialization.id !== row.asset_materialization_id) {
      return;
    }
    if (hiddenFaceIds.has(row.asset_face_id)) {
      return;
    }

    linkedPairs.add(buildPairKey(row.asset_id, row.consent_id));
  });
  fallbacks.forEach((row) => {
    const materialization = materializations.get(row.asset_id);
    if (!materialization || materialization.face_count !== 0) {
      return;
    }

    linkedPairs.add(buildPairKey(row.asset_id, row.consent_id));
  });

  const suppressionPairs = new Set<string>();
  suppressions.forEach((row) => {
    const materialization = materializations.get(row.asset_id);
    if (!materialization || materialization.id !== row.asset_materialization_id) {
      return;
    }

    suppressionPairs.add(`${row.asset_face_id}:${row.consent_id}`);
  });

  return candidateRows
    .map((candidate) => {
      const asset = assetById.get(candidate.asset_id);
      const materialization = materializations.get(candidate.asset_id);
      if (!asset || !materialization) {
        return null;
      }

      const faces = facesByMaterializationId.get(materialization.id) ?? [];
      const winningFace = faces.find((face) => face.id === candidate.winning_asset_face_id) ?? null;
      if (!winningFace) {
        return null;
      }

      if (hiddenFaceIds.has(winningFace.id)) {
        return null;
      }

      if (linkedPairs.has(buildPairKey(candidate.asset_id, candidate.consent_id))) {
        return null;
      }

      if (suppressionPairs.has(`${winningFace.id}:${candidate.consent_id}`)) {
        return null;
      }

      return toMatchablePhotoRow(asset, {
        confidence: candidate.confidence,
        lastScoredAt: candidate.last_scored_at,
        matcherVersion: candidate.matcher_version,
        assetFaceId: winningFace.id,
        faceRank: winningFace.face_rank,
      });
    })
    .filter((row): row is MatchablePhotoRow => row !== null)
    .sort((left, right) => {
      const rightScore = right.candidate_confidence ?? -1;
      const leftScore = left.candidate_confidence ?? -1;
      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }

      return right.created_at.localeCompare(left.created_at);
    });
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

async function loadCurrentPhotoMaterializationMap(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  assetIds: string[],
) {
  if (assetIds.length === 0) {
    return new Map<string, AssetFaceMaterializationRow>();
  }

  const version = getAutoMatchMaterializerVersion();
  const rows = await runChunkedRead(assetIds, async (assetIdChunk) => {
    const { data, error } = await supabase
      .from("asset_face_materializations")
      .select(
        "id, tenant_id, project_id, asset_id, asset_type, source_content_hash, source_content_hash_algo, source_uploaded_at, materializer_version, provider, provider_mode, provider_plugin_versions, face_count, usable_for_compare, unusable_reason, source_image_width, source_image_height, source_coordinate_space, materialized_at, created_at",
      )
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .eq("asset_type", "photo")
      .eq("materializer_version", version)
      .in("asset_id", assetIdChunk);

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
      .select("id, tenant_id, project_id, asset_id, materialization_id, face_rank, provider_face_index, detection_probability, face_box, face_box_normalized, embedding, created_at")
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

async function loadCurrentPhotoStateMap(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  assetIds: string[],
) {
  const materializations = await loadCurrentPhotoMaterializationMap(supabase, tenantId, projectId, assetIds);
  const facesByMaterializationId = await loadMaterializationFacesMap(
    supabase,
    Array.from(new Set(Array.from(materializations.values()).map((row) => row.id))),
  );

  return {
    materializations,
    facesByMaterializationId,
  };
}

async function loadCurrentFaceLinksForAssets(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  assetIds: string[],
) {
  if (assetIds.length === 0) {
    return [] as FaceLinkRow[];
  }

  const rows = await runChunkedRead(assetIds, async (assetIdChunk) => {
    const { data, error } = await supabase
      .from("asset_face_consent_links")
      .select(
        "asset_face_id, asset_materialization_id, asset_id, consent_id, tenant_id, project_id, link_source, match_confidence, matched_at, reviewed_at, reviewed_by, matcher_version, created_at, updated_at",
      )
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .in("asset_id", assetIdChunk);

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
  assetIds: string[],
) {
  if (assetIds.length === 0) {
    return [] as FaceSuppressionRow[];
  }

  const rows = await runChunkedRead(assetIds, async (assetIdChunk) => {
    const { data, error } = await supabase
      .from("asset_face_consent_link_suppressions")
      .select(
        "asset_face_id, asset_materialization_id, asset_id, consent_id, tenant_id, project_id, reason, created_at, created_by",
      )
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .in("asset_id", assetIdChunk);

    if (error) {
      throw new HttpError(500, "photo_face_suppression_lookup_failed", "Unable to load face suppressions.");
    }

    return (data ?? []) as FaceSuppressionRow[];
  });

  return rows;
}

async function loadActiveHiddenFaceRowsForAssets(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  assetIds: string[],
) {
  if (assetIds.length === 0) {
    return [] as HiddenFaceRow[];
  }

  const rows = await runChunkedRead(assetIds, async (assetIdChunk) => {
    const { data, error } = await supabase
      .from("asset_face_hidden_states")
      .select(
        "id, asset_face_id, asset_materialization_id, asset_id, tenant_id, project_id, reason, hidden_at, hidden_by, restored_at, restored_by",
      )
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .in("asset_id", assetIdChunk)
      .is("restored_at", null);

    if (error) {
      throw new HttpError(500, "hidden_face_lookup_failed", "Unable to load hidden face state.");
    }

    return (data ?? []) as HiddenFaceRow[];
  });

  return rows;
}

async function markHiddenFaceRowsInactive(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  hiddenStateIds: string[],
) {
  if (hiddenStateIds.length === 0) {
    return;
  }

  const nowIso = new Date().toISOString();
  const { error } = await supabase
    .from("asset_face_hidden_states")
    .update({
      restored_at: nowIso,
      restored_by: null,
    })
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .is("restored_at", null)
    .in("id", hiddenStateIds);

  if (error) {
    throw new HttpError(500, "hidden_face_write_failed", "Unable to clear stale hidden face state.");
  }
}

async function loadCurrentHiddenFacesForAssets(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  assetIds: string[],
  currentMaterializationIdByAssetId: Map<string, string>,
) {
  const rows = await loadActiveHiddenFaceRowsForAssets(supabase, tenantId, projectId, assetIds);
  if (rows.length === 0) {
    return [] as HiddenFaceRow[];
  }

  const activeRows: HiddenFaceRow[] = [];
  const staleHiddenStateIds: string[] = [];
  for (const row of rows) {
    if (currentMaterializationIdByAssetId.get(row.asset_id) === row.asset_materialization_id) {
      activeRows.push(row);
      continue;
    }

    staleHiddenStateIds.push(row.id);
  }

  await markHiddenFaceRowsInactive(supabase, tenantId, projectId, staleHiddenStateIds);
  return activeRows;
}

async function loadFallbackRowsForAssets(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  assetIds: string[],
) {
  if (assetIds.length === 0) {
    return [] as ManualFallbackRow[];
  }

  const rows = await runChunkedRead(assetIds, async (assetIdChunk) => {
    const { data, error } = await supabase
      .from("asset_consent_manual_photo_fallbacks")
      .select("asset_id, consent_id, tenant_id, project_id, created_by, created_at, updated_at")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .in("asset_id", assetIdChunk);

    if (error) {
      throw new HttpError(500, "photo_fallback_lookup_failed", "Unable to load zero-face photo fallbacks.");
    }

    return (data ?? []) as ManualFallbackRow[];
  });

  return rows;
}

async function loadCurrentHeadshotMaterializationIds(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  consentIds: string[],
) {
  if (consentIds.length === 0) {
    return new Map<string, string>();
  }

  const nowIso = new Date().toISOString();
  const headshotLinks = await runChunkedRead(consentIds, async (consentIdChunk) => {
    const { data, error } = await supabase
      .from("asset_consent_links")
      .select("asset_id, consent_id")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .in("consent_id", consentIdChunk);

    if (error) {
      throw new HttpError(500, "headshot_link_lookup_failed", "Unable to load consent headshots.");
    }

    return (data ?? []) as Array<{ asset_id: string; consent_id: string }>;
  });

  const assetIds = Array.from(new Set(headshotLinks.map((row) => row.asset_id)));
  if (assetIds.length === 0) {
    return new Map<string, string>();
  }

  const headshots = await runChunkedRead(assetIds, async (assetIdChunk) => {
    const { data, error } = await supabase
      .from("assets")
      .select("id, uploaded_at")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .eq("asset_type", "headshot")
      .eq("status", "uploaded")
      .is("archived_at", null)
      .or(`retention_expires_at.is.null,retention_expires_at.gt.${nowIso}`)
      .in("id", assetIdChunk);

    if (error) {
      throw new HttpError(500, "headshot_asset_lookup_failed", "Unable to validate consent headshots.");
    }

    return (data ?? []) as Array<{ id: string; uploaded_at: string | null }>;
  });

  const headshotById = new Map(headshots.map((row) => [row.id, row]));
  const currentHeadshotAssetIdByConsentId = new Map<string, string>();
  for (const row of headshotLinks) {
    const headshot = headshotById.get(row.asset_id);
    if (!headshot) {
      continue;
    }

    const currentAssetId = currentHeadshotAssetIdByConsentId.get(row.consent_id);
    if (!currentAssetId) {
      currentHeadshotAssetIdByConsentId.set(row.consent_id, row.asset_id);
      continue;
    }

    const currentHeadshot = headshotById.get(currentAssetId);
    if ((headshot.uploaded_at ?? "") > (currentHeadshot?.uploaded_at ?? "")) {
      currentHeadshotAssetIdByConsentId.set(row.consent_id, row.asset_id);
    }
  }

  const currentHeadshotAssetIds = Array.from(new Set(Array.from(currentHeadshotAssetIdByConsentId.values())));
  const materializerVersion = getAutoMatchMaterializerVersion();
  const materializations = await runChunkedRead(currentHeadshotAssetIds, async (assetIdChunk) => {
    const { data, error } = await supabase
      .from("asset_face_materializations")
      .select("asset_id, id")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .eq("asset_type", "headshot")
      .eq("materializer_version", materializerVersion)
      .in("asset_id", assetIdChunk);

    if (error) {
      throw new HttpError(500, "headshot_materialization_lookup_failed", "Unable to load headshot materializations.");
    }

    return (data ?? []) as Array<{ asset_id: string; id: string }>;
  });

  const materializationIdByAssetId = new Map(materializations.map((row) => [row.asset_id, row.id]));
  const map = new Map<string, string>();
  currentHeadshotAssetIdByConsentId.forEach((assetId, consentId) => {
    const materializationId = materializationIdByAssetId.get(assetId);
    if (materializationId) {
      map.set(consentId, materializationId);
    }
  });

  return map;
}

async function loadCurrentCompareRowsForAssets(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  assetIds: string[],
) {
  if (assetIds.length === 0) {
    return [] as CompareRow[];
  }

  const rows = await runChunkedRead(assetIds, async (assetIdChunk) => {
    const { data, error } = await supabase
      .from("asset_consent_face_compares")
      .select(
        "asset_id, consent_id, headshot_materialization_id, asset_materialization_id, winning_asset_face_id, winning_asset_face_rank, winning_similarity, compare_status, compare_version",
      )
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .eq("compare_version", getAutoMatchCompareVersion())
      .in("asset_id", assetIdChunk);

    if (error) {
      throw new HttpError(500, "photo_face_compare_lookup_failed", "Unable to load current compare rows.");
    }

    return (data ?? []) as CompareRow[];
  });

  return rows;
}

async function loadCurrentCompareRowsForAsset(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  assetId: string,
) {
  return loadCurrentCompareRowsForAssets(supabase, tenantId, projectId, [assetId]);
}

async function deleteCandidatePair(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  assetId: string,
  consentId: string,
) {
  const { error } = await supabase
    .from("asset_consent_match_candidates")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("asset_id", assetId)
    .eq("consent_id", consentId);

  if (error) {
    throw new HttpError(500, "candidate_delete_failed", "Unable to remove likely-match candidate.");
  }
}

async function validatePhotoAssetInProject(
  input: MatchingScopeInput,
  assetId: string,
  requireUploadedAndNotArchived: boolean,
) {
  let query = input.supabase
    .from("assets")
    .select(
      "id, original_filename, status, file_size_bytes, created_at, uploaded_at, archived_at, storage_bucket, storage_path",
    )
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("asset_type", "photo")
    .eq("id", assetId);

  if (requireUploadedAndNotArchived) {
    query = query.eq("status", "uploaded").is("archived_at", null);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new HttpError(500, "asset_lookup_failed", "Unable to validate photo asset.");
  }

  if (!data) {
    throw new HttpError(400, "invalid_asset_id", "The selected photo is invalid.");
  }

  return data as PhotoAssetRow;
}

export async function assertConsentInProject(input: MatchingScopeInput, options?: { requireNotRevoked?: boolean }) {
  const { data: consent, error } = await input.supabase
    .from("consents")
    .select("id, revoked_at, face_match_opt_in")
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("id", input.consentId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "consent_lookup_failed", "Unable to load consent.");
  }

  if (!consent) {
    throw new HttpError(404, "consent_not_found", "Consent not found.");
  }

  if (options?.requireNotRevoked && consent.revoked_at) {
    throw new HttpError(409, "consent_revoked", "Revoked consents cannot receive new photo assignments.");
  }

  return consent as ConsentRow;
}

async function cleanupCurrentPhotoStateForAsset(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  assetId: string,
  materialization: AssetFaceMaterializationRow | null,
) {
  if (!materialization) {
    const hiddenRows = await loadActiveHiddenFaceRowsForAssets(supabase, tenantId, projectId, [assetId]);
    await markHiddenFaceRowsInactive(
      supabase,
      tenantId,
      projectId,
      hiddenRows.map((row) => row.id),
    );
    return;
  }

  const { error: staleLinkDeleteError } = await supabase
    .from("asset_face_consent_links")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("asset_id", assetId)
    .neq("asset_materialization_id", materialization.id);

  if (staleLinkDeleteError) {
    throw new HttpError(500, "photo_face_link_cleanup_failed", "Unable to clean stale face links.");
  }

  const { error: staleSuppressionDeleteError } = await supabase
    .from("asset_face_consent_link_suppressions")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("asset_id", assetId)
    .neq("asset_materialization_id", materialization.id);

  if (staleSuppressionDeleteError) {
    throw new HttpError(500, "photo_face_link_cleanup_failed", "Unable to clean stale face suppressions.");
  }

  const hiddenRows = await loadActiveHiddenFaceRowsForAssets(supabase, tenantId, projectId, [assetId]);
  await markHiddenFaceRowsInactive(
    supabase,
    tenantId,
    projectId,
    hiddenRows
      .filter((row) => row.asset_materialization_id !== materialization.id)
      .map((row) => row.id),
  );

  if (materialization.face_count > 0) {
    const { error: fallbackDeleteError } = await supabase
      .from("asset_consent_manual_photo_fallbacks")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .eq("asset_id", assetId);

    if (fallbackDeleteError) {
      throw new HttpError(500, "photo_face_link_cleanup_failed", "Unable to clean zero-face fallback rows.");
    }

    const { error: fallbackSuppressionDeleteError } = await supabase
      .from("asset_consent_manual_photo_fallback_suppressions")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .eq("asset_id", assetId);

    if (fallbackSuppressionDeleteError) {
      throw new HttpError(
        500,
        "photo_face_link_cleanup_failed",
        "Unable to clean zero-face fallback suppressions.",
      );
    }
  } else {
    const { error: faceLinkDeleteError } = await supabase
      .from("asset_face_consent_links")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .eq("asset_id", assetId);

    if (faceLinkDeleteError) {
      throw new HttpError(500, "photo_face_link_cleanup_failed", "Unable to clear face-link rows for zero-face photos.");
    }

    const { error: faceSuppressionDeleteError } = await supabase
      .from("asset_face_consent_link_suppressions")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .eq("asset_id", assetId);

    if (faceSuppressionDeleteError) {
      throw new HttpError(
        500,
        "photo_face_link_cleanup_failed",
        "Unable to clear face suppressions for zero-face photos.",
      );
    }
  }
}

async function resolvePhotoState(input: PhotoAssetInput) {
  const asset = await validatePhotoAssetInProject(input, input.assetId, true);
  const current = await loadCurrentAssetFaceMaterialization(
    input.supabase,
    input.tenantId,
    input.projectId,
    input.assetId,
    getAutoMatchMaterializerVersion(),
    { includeFaces: true },
  );

  await cleanupCurrentPhotoStateForAsset(
    input.supabase,
    input.tenantId,
    input.projectId,
    input.assetId,
    current?.materialization ?? null,
  );

  return {
    asset,
    materialization: current?.materialization ?? null,
    faces: (current?.faces ?? []).map((row) => ({
      ...row,
      face_box: row.face_box as Record<string, number | null>,
    })),
    hiddenFaceIds: new Set(
      (
        await loadCurrentHiddenFacesForAssets(
          input.supabase,
          input.tenantId,
          input.projectId,
          [input.assetId],
          new Map(current?.materialization ? [[input.assetId, current.materialization.id]] : []),
        )
      ).map((row) => row.asset_face_id),
    ),
  } satisfies ResolvedPhotoState;
}

function resolveRequestedFace(
  mode: ManualPhotoLinkMode,
  faces: CurrentMaterializationFace[],
  hiddenFaceIds: Set<string>,
  assetFaceId: string | null | undefined,
) {
  const activeFaces = faces.filter((face) => !hiddenFaceIds.has(face.id));

  if (mode === "asset_fallback") {
    return {
      resolvedMode: "asset_fallback" as const,
      resolvedFace: null,
    };
  }

  if (activeFaces.length === 0) {
    throw new HttpError(409, "photo_zero_faces_only_fallback", "No detected faces are available for this photo.");
  }

  if (assetFaceId) {
    if (hiddenFaceIds.has(assetFaceId)) {
      throw new HttpError(409, "hidden_face_restore_required", "Restore the hidden face before linking it.");
    }

    const face = activeFaces.find((row) => row.id === assetFaceId) ?? null;
    if (!face) {
      throw new HttpError(400, "invalid_asset_face_id", "The selected face is invalid.");
    }

    return {
      resolvedMode: "face" as const,
      resolvedFace: face,
    };
  }

  if (activeFaces.length === 1) {
    return {
      resolvedMode: "face" as const,
      resolvedFace: activeFaces[0] ?? null,
    };
  }

  throw new HttpError(
    409,
    "asset_face_selection_required",
    "Select a specific detected face before linking this photo.",
  );
}

async function loadCurrentAssignmentsForAsset(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  assetId: string,
  materializationId: string | null,
) {
  const faceLinksQuery = materializationId
    ? supabase
        .from("asset_face_consent_links")
        .select(
          "asset_face_id, asset_materialization_id, asset_id, consent_id, tenant_id, project_id, link_source, match_confidence, matched_at, reviewed_at, reviewed_by, matcher_version, created_at, updated_at",
        )
        .eq("tenant_id", tenantId)
        .eq("project_id", projectId)
        .eq("asset_id", assetId)
        .eq("asset_materialization_id", materializationId)
    : null;

  const faceLinksResult = faceLinksQuery ? await faceLinksQuery : { data: [], error: null };
  if (faceLinksResult.error) {
    throw new HttpError(500, "photo_face_link_lookup_failed", "Unable to load current face assignments.");
  }

  const suppressionsQuery = materializationId
    ? supabase
        .from("asset_face_consent_link_suppressions")
        .select(
          "asset_face_id, asset_materialization_id, asset_id, consent_id, tenant_id, project_id, reason, created_at, created_by",
        )
        .eq("tenant_id", tenantId)
        .eq("project_id", projectId)
        .eq("asset_id", assetId)
        .eq("asset_materialization_id", materializationId)
    : null;

  const suppressionsResult = suppressionsQuery ? await suppressionsQuery : { data: [], error: null };
  if (suppressionsResult.error) {
    throw new HttpError(500, "photo_face_suppression_lookup_failed", "Unable to load face suppressions.");
  }

  const { data: fallbacks, error: fallbackError } = await supabase
    .from("asset_consent_manual_photo_fallbacks")
    .select("asset_id, consent_id, tenant_id, project_id, created_by, created_at, updated_at")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("asset_id", assetId);

  if (fallbackError) {
    throw new HttpError(500, "photo_fallback_lookup_failed", "Unable to load zero-face fallbacks.");
  }

  const { data: fallbackSuppressions, error: fallbackSuppressionError } = await supabase
    .from("asset_consent_manual_photo_fallback_suppressions")
    .select("asset_id, consent_id, tenant_id, project_id, reason, created_at, created_by")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("asset_id", assetId);

  if (fallbackSuppressionError) {
    throw new HttpError(
      500,
      "photo_fallback_suppression_lookup_failed",
      "Unable to load zero-face fallback suppressions.",
    );
  }

  return {
    faceLinks: (faceLinksResult.data ?? []) as FaceLinkRow[],
    suppressions: (suppressionsResult.data ?? []) as FaceSuppressionRow[],
    fallbacks: (fallbacks ?? []) as ManualFallbackRow[],
    fallbackSuppressions: (fallbackSuppressions ?? []) as ManualFallbackSuppressionRow[],
  };
}

async function loadCurrentFaceAssignmentForAssetFace(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  assetId: string;
  assetFaceId: string;
  materializationId: string;
}) {
  const { data, error } = await input.supabase
    .from("asset_face_consent_links")
    .select(
      "asset_face_id, asset_materialization_id, asset_id, consent_id, tenant_id, project_id, link_source, match_confidence, matched_at, reviewed_at, reviewed_by, matcher_version, created_at, updated_at",
    )
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("asset_id", input.assetId)
    .eq("asset_materialization_id", input.materializationId)
    .eq("asset_face_id", input.assetFaceId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "photo_face_link_lookup_failed", "Unable to load the current face assignment.");
  }

  return (data as FaceLinkRow | null) ?? null;
}

async function unlinkCurrentExactFaceAssignmentWithSuppression(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  assetId: string;
  materializationId: string;
  assetFaceId: string;
  actorUserId?: string | null;
}) {
  const currentAssignment = await loadCurrentFaceAssignmentForAssetFace(input);
  if (!currentAssignment) {
    return null;
  }

  const { error: deleteError } = await input.supabase
    .from("asset_face_consent_links")
    .delete()
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("asset_face_id", input.assetFaceId)
    .eq("consent_id", currentAssignment.consent_id);

  if (deleteError) {
    throw new HttpError(500, "photo_face_link_write_failed", "Unable to unlink the selected face.");
  }

  await upsertFaceSuppression(input.supabase, {
    tenantId: input.tenantId,
    projectId: input.projectId,
    assetId: input.assetId,
    materializationId: input.materializationId,
    assetFaceId: input.assetFaceId,
    consentId: currentAssignment.consent_id,
    actorUserId: input.actorUserId,
    reason: "manual_unlink",
  });
  await deleteCandidatePair(
    input.supabase,
    input.tenantId,
    input.projectId,
    input.assetId,
    currentAssignment.consent_id,
  );

  return currentAssignment;
}

async function clearFallbackRowsForConsent(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  assetId: string,
  consentId: string,
) {
  const { error: fallbackDeleteError } = await supabase
    .from("asset_consent_manual_photo_fallbacks")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("asset_id", assetId)
    .eq("consent_id", consentId);

  if (fallbackDeleteError) {
    throw new HttpError(500, "photo_fallback_write_failed", "Unable to update zero-face fallback state.");
  }

  const { error: fallbackSuppressionDeleteError } = await supabase
    .from("asset_consent_manual_photo_fallback_suppressions")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("asset_id", assetId)
    .eq("consent_id", consentId);

  if (fallbackSuppressionDeleteError) {
    throw new HttpError(500, "photo_fallback_write_failed", "Unable to update zero-face fallback state.");
  }
}

async function upsertFaceSuppression(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    projectId: string;
    assetId: string;
    materializationId: string;
    assetFaceId: string;
    consentId: string;
    actorUserId?: string | null;
    reason: "manual_unlink" | "manual_replace";
  },
) {
  const { error } = await supabase.from("asset_face_consent_link_suppressions").upsert(
    {
      asset_face_id: input.assetFaceId,
      asset_materialization_id: input.materializationId,
      asset_id: input.assetId,
      consent_id: input.consentId,
      tenant_id: input.tenantId,
      project_id: input.projectId,
      reason: input.reason,
      created_by: input.actorUserId ?? null,
    },
    { onConflict: "asset_face_id,consent_id" },
  );

  if (error) {
    throw new HttpError(500, "photo_face_suppression_write_failed", "Unable to persist face suppression.");
  }
}

async function deleteFaceSuppression(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    projectId: string;
    assetFaceId: string;
    consentId: string;
  },
) {
  const { error } = await supabase
    .from("asset_face_consent_link_suppressions")
    .delete()
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("asset_face_id", input.assetFaceId)
    .eq("consent_id", input.consentId);

  if (error) {
    throw new HttpError(500, "photo_face_suppression_write_failed", "Unable to update face suppression.");
  }
}

export async function loadCurrentHiddenFacesForAsset(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  assetId: string;
}) {
  const state = await resolvePhotoState({
    ...input,
    consentId: "",
  });

  if (!state.materialization) {
    return [] as HiddenFaceRow[];
  }

  return loadCurrentHiddenFacesForAssets(
    input.supabase,
    input.tenantId,
    input.projectId,
    [input.assetId],
    new Map([[input.assetId, state.materialization.id]]),
  );
}

export async function hideAssetFace(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  assetId: string;
  assetFaceId: string;
  actorUserId?: string | null;
}): Promise<HideAssetFaceResult> {
  const state = await resolvePhotoState({
    ...input,
    consentId: "",
  });

  if (!state.materialization) {
    throw new HttpError(409, "photo_materialization_pending", "Photo face materialization is still pending for this photo.");
  }

  const targetFace = state.faces.find((face) => face.id === input.assetFaceId) ?? null;
  if (!targetFace) {
    throw new HttpError(400, "invalid_asset_face_id", "The selected face is invalid.");
  }

  const removedAssignment = await unlinkCurrentExactFaceAssignmentWithSuppression({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
    assetId: input.assetId,
    materializationId: state.materialization.id,
    assetFaceId: input.assetFaceId,
    actorUserId: input.actorUserId,
  });

  let hiddenKind: HideAssetFaceResult["kind"] = "hidden";
  const insertPayload = {
    asset_face_id: input.assetFaceId,
    asset_materialization_id: state.materialization.id,
    asset_id: input.assetId,
    tenant_id: input.tenantId,
    project_id: input.projectId,
    reason: "manual_hide" as const,
    hidden_by: input.actorUserId ?? null,
  };
  const { error: insertError } = await input.supabase.from("asset_face_hidden_states").insert(insertPayload);
  if (insertError) {
    if (insertError.code !== "23505") {
      throw new HttpError(500, "hidden_face_write_failed", "Unable to hide the selected face.");
    }

    hiddenKind = "already_hidden";
  }

  if (removedAssignment?.link_source === "auto") {
    await reconcilePhotoFaceCanonicalStateForAsset({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
      assetId: input.assetId,
    });
  }

  return {
    kind: hiddenKind,
    assetFaceId: input.assetFaceId,
    removedConsentId: removedAssignment?.consent_id ?? null,
    removedLinkSource: removedAssignment?.link_source ?? null,
  };
}

export async function restoreHiddenAssetFace(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  assetId: string;
  assetFaceId: string;
  actorUserId?: string | null;
}): Promise<RestoreHiddenAssetFaceResult> {
  const state = await resolvePhotoState({
    ...input,
    consentId: "",
  });

  if (!state.materialization) {
    throw new HttpError(409, "photo_materialization_pending", "Photo face materialization is still pending for this photo.");
  }

  const targetFace = state.faces.find((face) => face.id === input.assetFaceId) ?? null;
  if (!targetFace) {
    throw new HttpError(400, "invalid_asset_face_id", "The selected face is invalid.");
  }

  const nowIso = new Date().toISOString();
  const { data, error } = await input.supabase
    .from("asset_face_hidden_states")
    .update({
      restored_at: nowIso,
      restored_by: input.actorUserId ?? null,
    })
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("asset_id", input.assetId)
    .eq("asset_materialization_id", state.materialization.id)
    .eq("asset_face_id", input.assetFaceId)
    .is("restored_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "hidden_face_write_failed", "Unable to restore the selected face.");
  }

  return {
    kind: data ? "restored" : "already_restored",
    assetFaceId: input.assetFaceId,
  };
}

async function loadConsentStateMap(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  consentIds: string[],
) {
  if (consentIds.length === 0) {
    return new Map<string, ConsentRow>();
  }

  const rows = await runChunkedRead(consentIds, async (consentIdChunk) => {
    const { data, error } = await supabase
      .from("consents")
      .select("id, revoked_at, face_match_opt_in")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .in("id", consentIdChunk);

    if (error) {
      throw new HttpError(500, "consent_lookup_failed", "Unable to load consent state.");
    }

    return (data ?? []) as ConsentRow[];
  });

  return new Map(rows.map((row) => [row.id, row]));
}

export async function listPhotoConsentAssignmentsForAssetIds(
  input: {
    supabase: SupabaseClient;
    tenantId: string;
    projectId: string;
    assetIds: string[];
  },
) {
  const uniqueAssetIds = Array.from(new Set(input.assetIds));
  if (uniqueAssetIds.length === 0) {
    return [] as PhotoConsentAssignment[];
  }

  const { materializations } = await loadCurrentPhotoStateMap(
    input.supabase,
    input.tenantId,
    input.projectId,
    uniqueAssetIds,
  );
  const hiddenFaces = await loadCurrentHiddenFacesForAssets(
    input.supabase,
    input.tenantId,
    input.projectId,
    uniqueAssetIds,
    new Map(Array.from(materializations.entries()).map(([assetId, materialization]) => [assetId, materialization.id])),
  );
  const currentLinks = await loadCurrentFaceLinksForAssets(
    input.supabase,
    input.tenantId,
    input.projectId,
    uniqueAssetIds,
  );
  const fallbacks = await loadFallbackRowsForAssets(input.supabase, input.tenantId, input.projectId, uniqueAssetIds);
  const hiddenFaceIds = new Set(hiddenFaces.map((row) => row.asset_face_id));

  const assignments = new Map<string, PhotoConsentAssignment>();
  currentLinks.forEach((row) => {
    const materialization = materializations.get(row.asset_id);
    if (!materialization || materialization.id !== row.asset_materialization_id) {
      return;
    }
    if (hiddenFaceIds.has(row.asset_face_id)) {
      return;
    }
    assignments.set(buildPairKey(row.asset_id, row.consent_id), {
      assetId: row.asset_id,
      consentId: row.consent_id,
    });
  });

  fallbacks.forEach((row) => {
    const materialization = materializations.get(row.asset_id);
    if (!materialization || materialization.face_count !== 0) {
      return;
    }
    assignments.set(buildPairKey(row.asset_id, row.consent_id), {
      assetId: row.asset_id,
      consentId: row.consent_id,
    });
  });

  return Array.from(assignments.values());
}

export async function listLinkedFaceOverlaysForAssetIds(
  input: {
    supabase: SupabaseClient;
    tenantId: string;
    projectId: string;
    assetIds: string[];
  },
): Promise<AssetLinkedFaceOverlayRow[]> {
  const uniqueAssetIds = Array.from(new Set(input.assetIds));
  if (uniqueAssetIds.length === 0) {
    return [];
  }

  const { materializations, facesByMaterializationId } = await loadCurrentPhotoStateMap(
    input.supabase,
    input.tenantId,
    input.projectId,
    uniqueAssetIds,
  );
  const hiddenFaces = await loadCurrentHiddenFacesForAssets(
    input.supabase,
    input.tenantId,
    input.projectId,
    uniqueAssetIds,
    new Map(Array.from(materializations.entries()).map(([assetId, materialization]) => [assetId, materialization.id])),
  );
  const currentLinks = await loadCurrentFaceLinksForAssets(
    input.supabase,
    input.tenantId,
    input.projectId,
    uniqueAssetIds,
  );
  const hiddenFaceIds = new Set(hiddenFaces.map((row) => row.asset_face_id));

  const overlays: AssetLinkedFaceOverlayRow[] = [];
  currentLinks.forEach((row) => {
    const materialization = materializations.get(row.asset_id);
    if (!materialization || materialization.id !== row.asset_materialization_id) {
      return;
    }
    if (hiddenFaceIds.has(row.asset_face_id)) {
      return;
    }

    const face = (facesByMaterializationId.get(materialization.id) ?? []).find(
      (candidate) => candidate.id === row.asset_face_id,
    );
    if (!face) {
      return;
    }

    overlays.push({
      assetId: row.asset_id,
      assetFaceId: row.asset_face_id,
      consentId: row.consent_id,
      faceRank: face.face_rank,
      faceBoxNormalized: face.face_box_normalized,
      linkSource: row.link_source,
      matchConfidence: row.match_confidence,
    });
  });

  return overlays;
}

export async function listMatchableProjectPhotosForConsent(
  input: ListMatchableProjectPhotosInput,
): Promise<MatchablePhotoPage> {
  await assertConsentInProject(input);

  const mode = normalizeMatchablePhotosMode(input.mode);
  const pageSize = normalizeListLimit(input.limit);
  const page = normalizeListPage(input.page);
  const skipCount = page * pageSize;
  if (mode === "likely") {
    const queryText = normalizeQuery(input.query);
    const confidenceThreshold = getAutoMatchConfidenceThreshold();
    const reviewMinConfidence = Math.min(LIKELY_REVIEW_MIN_CONFIDENCE, confidenceThreshold);
    if (reviewMinConfidence >= confidenceThreshold) {
      return buildMatchablePageResult([], page, pageSize);
    }

    const candidateFetchLimit = Math.min(MAX_LIMIT * 3, Math.max(pageSize * 3, DEFAULT_MATCHABLE_BATCH_SIZE));
    const collected: MatchablePhotoRow[] = [];
    let filteredOffset = 0;
    let candidateOffset = 0;

    while (collected.length <= pageSize) {
      const query = input.supabase
        .from("asset_consent_match_candidates")
        .select(
          "asset_id, consent_id, confidence, matcher_version, last_scored_at, winning_asset_face_id, winning_asset_face_rank",
        )
        .eq("tenant_id", input.tenantId)
        .eq("project_id", input.projectId)
        .eq("consent_id", input.consentId)
        .gte("confidence", reviewMinConfidence)
        .lt("confidence", confidenceThreshold)
        .order("confidence", { ascending: false })
        .order("last_scored_at", { ascending: false })
        .range(candidateOffset, candidateOffset + candidateFetchLimit - 1);

      const { data: candidates, error: candidateError } = await query;
      if (candidateError) {
        throw new HttpError(500, "match_candidate_lookup_failed", "Unable to load likely-match candidates.");
      }

      const candidateRows = ((candidates ?? []) as MatchCandidateRow[])
        .map((row) => ({
          ...row,
          confidence: Number(row.confidence),
        }))
        .filter((row) => Number.isFinite(row.confidence))
        .filter((row) => row.winning_asset_face_id);

      if (candidateRows.length === 0) {
        break;
      }

      const resolvedRows = await resolveLikelyCandidateBatch(
        {
          supabase: input.supabase,
          tenantId: input.tenantId,
          projectId: input.projectId,
          consentId: input.consentId,
        },
        candidateRows,
      );

      const filteredRows = queryText
        ? resolvedRows.filter((row) => row.original_filename.toLowerCase().includes(queryText.toLowerCase()))
        : resolvedRows;

      for (const row of filteredRows) {
        if (filteredOffset < skipCount) {
          filteredOffset += 1;
          continue;
        }

        collected.push(row);
        if (collected.length > pageSize) {
          break;
        }
      }

      candidateOffset += candidateRows.length;
      if (candidateRows.length < candidateFetchLimit) {
        break;
      }
    }

    return buildMatchablePageResult(collected, page, pageSize);
  }

  const queryText = normalizeQuery(input.query);
  const assetBatchSize = Math.min(MAX_LIMIT * 3, Math.max(pageSize * 2, DEFAULT_MATCHABLE_BATCH_SIZE));
  const collected: MatchablePhotoRow[] = [];
  let filteredOffset = 0;
  let assetOffset = 0;

  while (collected.length <= pageSize) {
    let query = input.supabase
      .from("assets")
      .select(
        "id, original_filename, status, file_size_bytes, created_at, uploaded_at, archived_at, storage_bucket, storage_path",
      )
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .eq("asset_type", "photo")
      .eq("status", "uploaded")
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .range(assetOffset, assetOffset + assetBatchSize - 1);

    if (queryText) {
      query = query.ilike("original_filename", `%${queryText}%`);
    }

    const { data: assets, error: assetsError } = await query;
    if (assetsError) {
      throw new HttpError(500, "asset_lookup_failed", "Unable to load matchable assets.");
    }

    const assetRows = (assets ?? []) as PhotoAssetRow[];
    if (assetRows.length === 0) {
      break;
    }

    const assetIds = assetRows.map((row) => row.id);
    const { materializations } = await loadCurrentPhotoStateMap(
      input.supabase,
      input.tenantId,
      input.projectId,
      assetIds,
    );
    const hiddenFaces = await loadCurrentHiddenFacesForAssets(
      input.supabase,
      input.tenantId,
      input.projectId,
      assetIds,
      new Map(Array.from(materializations.entries()).map(([assetId, materialization]) => [assetId, materialization.id])),
    );
    const faceLinks = await loadCurrentFaceLinksForAssets(input.supabase, input.tenantId, input.projectId, assetIds);
    const fallbacks = await loadFallbackRowsForAssets(input.supabase, input.tenantId, input.projectId, assetIds);
    const hiddenFaceIds = new Set(hiddenFaces.map((row) => row.asset_face_id));

    const linkedAssetIds = new Set<string>();
    faceLinks.forEach((row) => {
      const materialization = materializations.get(row.asset_id);
      if (!materialization || materialization.id !== row.asset_materialization_id) {
        return;
      }
      if (hiddenFaceIds.has(row.asset_face_id)) {
        return;
      }

      if (row.consent_id === input.consentId) {
        linkedAssetIds.add(row.asset_id);
      }
    });

    fallbacks.forEach((row) => {
      const materialization = materializations.get(row.asset_id);
      if (!materialization || materialization.face_count !== 0) {
        return;
      }

      if (row.consent_id === input.consentId) {
        linkedAssetIds.add(row.asset_id);
      }
    });

    const unlinkedAssets = assetRows
      .filter((asset) => !linkedAssetIds.has(asset.id))
      .map((asset) => toMatchablePhotoRow(asset));

    for (const asset of unlinkedAssets) {
      if (filteredOffset < skipCount) {
        filteredOffset += 1;
        continue;
      }

      collected.push(asset);
      if (collected.length > pageSize) {
        break;
      }
    }

    assetOffset += assetRows.length;
    if (assetRows.length < assetBatchSize) {
      break;
    }
  }

  return buildMatchablePageResult(collected, page, pageSize);
}

export async function listLinkedPhotosForConsent(
  input: MatchingScopeInput,
): Promise<LinkedPhotoRow[]> {
  await assertConsentInProject(input);

  const currentLinks = await runChunkedRead([input.consentId], async (consentIdChunk) => {
    const { data, error } = await input.supabase
      .from("asset_face_consent_links")
      .select(
        "asset_face_id, asset_materialization_id, asset_id, consent_id, tenant_id, project_id, link_source, match_confidence, matched_at, reviewed_at, reviewed_by, matcher_version, created_at, updated_at",
      )
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .in("consent_id", consentIdChunk);

    if (error) {
      throw new HttpError(500, "photo_face_link_lookup_failed", "Unable to load linked photos.");
    }

    return (data ?? []) as FaceLinkRow[];
  });

  const fallbacks = await runChunkedRead([input.consentId], async (consentIdChunk) => {
    const { data, error } = await input.supabase
      .from("asset_consent_manual_photo_fallbacks")
      .select("asset_id, consent_id, tenant_id, project_id, created_by, created_at, updated_at")
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .in("consent_id", consentIdChunk);

    if (error) {
      throw new HttpError(500, "photo_fallback_lookup_failed", "Unable to load linked photos.");
    }

    return (data ?? []) as ManualFallbackRow[];
  });

  const assetIds = Array.from(
    new Set([
      ...currentLinks.map((row) => row.asset_id),
      ...fallbacks.map((row) => row.asset_id),
    ]),
  );
  if (assetIds.length === 0) {
    return [];
  }

  const assets = await runChunkedRead(assetIds, async (assetIdChunk) => {
    const { data, error } = await input.supabase
      .from("assets")
      .select(
        "id, original_filename, status, file_size_bytes, created_at, uploaded_at, archived_at, storage_bucket, storage_path",
      )
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .eq("asset_type", "photo")
      .in("id", assetIdChunk)
      .order("created_at", { ascending: false });

    if (error) {
      throw new HttpError(500, "asset_lookup_failed", "Unable to load linked photo assets.");
    }

    return (data ?? []) as PhotoAssetRow[];
  });

  const assetById = new Map(assets.map((row) => [row.id, row]));
  const { materializations, facesByMaterializationId } = await loadCurrentPhotoStateMap(
    input.supabase,
    input.tenantId,
    input.projectId,
    assetIds,
  );
  const hiddenFaces = await loadCurrentHiddenFacesForAssets(
    input.supabase,
    input.tenantId,
    input.projectId,
    assetIds,
    new Map(Array.from(materializations.entries()).map(([assetId, materialization]) => [assetId, materialization.id])),
  );
  const hiddenFaceIds = new Set(hiddenFaces.map((row) => row.asset_face_id));

  const rows: LinkedPhotoRow[] = [];
  currentLinks.forEach((row) => {
    if (hiddenFaceIds.has(row.asset_face_id)) {
      return;
    }

    const asset = assetById.get(row.asset_id);
    const materialization = materializations.get(row.asset_id);
    const face = materialization
      ? (facesByMaterializationId.get(materialization.id) ?? []).find((candidate) => candidate.id === row.asset_face_id) ?? null
      : null;

    if (!asset || !materialization || materialization.id !== row.asset_materialization_id || !face) {
      return;
    }

    rows.push({
      id: asset.id,
      original_filename: asset.original_filename,
      status: asset.status,
      file_size_bytes: asset.file_size_bytes,
      created_at: asset.created_at,
      uploaded_at: asset.uploaded_at,
      archived_at: asset.archived_at,
      storage_bucket: asset.storage_bucket,
      storage_path: asset.storage_path,
      link_created_at: row.created_at,
      link_source: row.link_source,
      match_confidence: row.match_confidence,
      matched_at: row.matched_at,
      reviewed_at: row.reviewed_at,
      reviewed_by: row.reviewed_by,
      link_mode: "face",
      asset_face_id: row.asset_face_id,
      face_rank: face.face_rank,
      detected_face_count: materialization.face_count,
    });
  });

  fallbacks.forEach((row) => {
    const asset = assetById.get(row.asset_id);
    const materialization = materializations.get(row.asset_id);
    if (!asset || !materialization || materialization.face_count !== 0) {
      return;
    }

    rows.push({
      id: asset.id,
      original_filename: asset.original_filename,
      status: asset.status,
      file_size_bytes: asset.file_size_bytes,
      created_at: asset.created_at,
      uploaded_at: asset.uploaded_at,
      archived_at: asset.archived_at,
      storage_bucket: asset.storage_bucket,
      storage_path: asset.storage_path,
      link_created_at: row.created_at,
      link_source: "manual",
      match_confidence: null,
      matched_at: null,
      reviewed_at: null,
      reviewed_by: row.created_by,
      link_mode: "asset_fallback",
      asset_face_id: null,
      face_rank: null,
      detected_face_count: materialization.face_count,
    });
  });

  return rows.sort((left, right) => right.created_at.localeCompare(left.created_at));
}

function getPendingMaterializationStatus(result: RepairFaceMatchJobResult): "queued" | "processing" {
  if (result.alreadyProcessing || result.status === "processing") {
    return "processing";
  }

  return "queued";
}

function normalizeCurrentMaterializationFaces(rows: AssetFaceMaterializationFaceRow[]) {
  return rows.map((row) => ({
    ...row,
    face_box: row.face_box as Record<string, number | null>,
    face_box_normalized: (row.face_box_normalized as Record<string, number | null> | null) ?? null,
  }));
}

export function deriveManualPhotoLinkFaceStatus(input: {
  currentAssignee: FaceLinkRow | null;
  isSuppressedForConsent: boolean;
  isCurrentConsentFace: boolean;
}): ManualPhotoLinkState["faces"][number]["status"] {
  if (input.isCurrentConsentFace) {
    return "current";
  }

  if (input.isSuppressedForConsent) {
    return "suppressed";
  }

  if (!input.currentAssignee) {
    return "available";
  }

  return input.currentAssignee.link_source === "manual" ? "occupied_manual" : "occupied_auto";
}

export async function loadCurrentConsentFaceConfidenceByAssetFaceKey(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  consentId: string;
  assetIds: string[];
  currentMaterializationIdByAssetId: Map<string, string>;
}) {
  const uniqueAssetIds = Array.from(new Set(input.assetIds));
  if (uniqueAssetIds.length === 0) {
    return new Map<string, number>();
  }

  const currentHeadshotMaterializationId = (
    await loadCurrentHeadshotMaterializationIds(
      input.supabase,
      input.tenantId,
      input.projectId,
      [input.consentId],
    )
  ).get(input.consentId);

  if (!currentHeadshotMaterializationId) {
    return new Map<string, number>();
  }

  const compares = await loadCurrentCompareRowsForAssets(
    input.supabase,
    input.tenantId,
    input.projectId,
    uniqueAssetIds,
  );
  const confidenceByAssetFaceKey = new Map<string, number>();

  for (const compare of compares) {
    const confidence = toNumericConfidence(compare.winning_similarity);
    if (
      compare.consent_id !== input.consentId ||
      compare.compare_status !== "matched" ||
      !compare.winning_asset_face_id ||
      confidence === null
    ) {
      continue;
    }

    if (compare.headshot_materialization_id !== currentHeadshotMaterializationId) {
      continue;
    }

    if (input.currentMaterializationIdByAssetId.get(compare.asset_id) !== compare.asset_materialization_id) {
      continue;
    }

    confidenceByAssetFaceKey.set(buildPairKey(compare.asset_id, compare.winning_asset_face_id), confidence);
  }

  return confidenceByAssetFaceKey;
}

async function attemptDirectManualPhotoMaterialization(
  input: PhotoAssetInput & {
    forceRematerialize?: boolean;
  },
) {
  try {
    const ensured = await ensureAssetFaceMaterialization({
      supabase: input.supabase,
      matcher: input.matcher ?? getAutoMatcher(),
      tenantId: input.tenantId,
      projectId: input.projectId,
      assetId: input.assetId,
      materializerVersion: getAutoMatchMaterializerVersion(),
      includeFaces: true,
      forceRematerialize: input.forceRematerialize ?? false,
    });

    if (!ensured) {
      return null;
    }

    return {
      materialization: ensured.materialization,
      faces: normalizeCurrentMaterializationFaces(ensured.faces),
    };
  } catch (error) {
    console.warn("[matching][manual-link-state] direct_materialization_failed", {
      assetId: input.assetId,
      projectId: input.projectId,
      consentId: input.consentId,
      message: error instanceof Error ? error.message : "unknown error",
    });
    return null;
  }
}

async function buildReadyManualPhotoLinkState(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  consentId: string;
  consent: ConsentRow;
  asset: PhotoAssetRow;
  current: {
    materialization: AssetFaceMaterializationRow;
    faces: CurrentMaterializationFace[];
  };
}): Promise<ManualPhotoLinkState> {
  await cleanupCurrentPhotoStateForAsset(
    input.supabase,
    input.tenantId,
    input.projectId,
    input.asset.id,
    input.current.materialization,
  );

  const assignments = await loadCurrentAssignmentsForAsset(
    input.supabase,
    input.tenantId,
    input.projectId,
    input.asset.id,
    input.current.materialization.id,
  );
  const hiddenFaceIds = new Set(
    (
      await loadCurrentHiddenFacesForAssets(
        input.supabase,
        input.tenantId,
        input.projectId,
        [input.asset.id],
        new Map([[input.asset.id, input.current.materialization.id]]),
      )
    ).map((row) => row.asset_face_id),
  );
  const faceLinksByFaceId = new Map(assignments.faceLinks.map((row) => [row.asset_face_id, row]));
  const suppressionByFaceKey = new Set(assignments.suppressions.map((row) => `${row.asset_face_id}:${row.consent_id}`));
  const consentSummaries = await loadConsentSummaries(
    input.supabase,
    input.tenantId,
    input.projectId,
    assignments.faceLinks.map((row) => row.consent_id),
  );
  const faceConfidenceByAssetFaceKey = await loadCurrentConsentFaceConfidenceByAssetFaceKey({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
    consentId: input.consentId,
    assetIds: [input.asset.id],
    currentMaterializationIdByAssetId: new Map([[input.asset.id, input.current.materialization.id]]),
  });

  const currentConsentFaceLink = assignments.faceLinks.find((row) => row.consent_id === input.consentId) ?? null;
  const currentConsentFallback =
    input.current.materialization.face_count === 0
      ? assignments.fallbacks.find((row) => row.consent_id === input.consentId) ?? null
      : null;

  return {
    materializationStatus: "ready",
    assetId: input.asset.id,
    materializationId: input.current.materialization.id,
    detectedFaceCount: input.current.materialization.face_count,
    faces: input.current.faces.filter((face) => !hiddenFaceIds.has(face.id)).map((face) => {
      const assignee = faceLinksByFaceId.get(face.id) ?? null;
      const summary = assignee ? consentSummaries.get(assignee.consent_id) : undefined;
      const isSuppressedForConsent = suppressionByFaceKey.has(`${face.id}:${input.consentId}`);
      const isCurrentConsentFace = currentConsentFaceLink?.asset_face_id === face.id;
      return {
        assetFaceId: face.id,
        faceRank: face.face_rank,
        faceBox: face.face_box,
        faceBoxNormalized: face.face_box_normalized,
        matchConfidence:
          faceConfidenceByAssetFaceKey.get(buildPairKey(input.asset.id, face.id)) ??
          assignee?.match_confidence ??
          null,
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
        isSuppressedForConsent,
        isCurrentConsentFace,
      };
    }),
    fallbackAllowed: input.current.materialization.face_count === 0 && !input.consent.revoked_at,
    currentConsentLink: currentConsentFaceLink
      ? {
          mode: "face",
          linkSource: currentConsentFaceLink.link_source,
          assetFaceId: currentConsentFaceLink.asset_face_id,
          faceRank:
            input.current.faces.find((face) => face.id === currentConsentFaceLink.asset_face_id)?.face_rank ?? null,
        }
      : currentConsentFallback
        ? {
            mode: "asset_fallback",
            linkSource: "manual",
          }
        : null,
  };
}

export async function getManualPhotoLinkState(input: PhotoAssetInput): Promise<ManualPhotoLinkState> {
  const consent = await assertConsentInProject(input, { requireNotRevoked: true });
  const asset = await validatePhotoAssetInProject(input, input.assetId, true);
  let current = await loadCurrentAssetFaceMaterialization(
    input.supabase,
    input.tenantId,
    input.projectId,
    input.assetId,
    getAutoMatchMaterializerVersion(),
    { includeFaces: true },
  );

  if (current && shouldForceRematerializeCurrentMaterialization(current.materialization)) {
    const repairedCurrent = await attemptDirectManualPhotoMaterialization({
      ...input,
      forceRematerialize: true,
    });

    if (repairedCurrent) {
      current = {
        materialization: repairedCurrent.materialization,
        faces: repairedCurrent.faces,
        facesLoaded: true,
      };
    }
  }

  if (!current) {
    const directlyMaterialized = await attemptDirectManualPhotoMaterialization(input);
    if (directlyMaterialized) {
      return buildReadyManualPhotoLinkState({
        supabase: input.supabase,
        tenantId: input.tenantId,
        projectId: input.projectId,
        consentId: input.consentId,
        consent,
        asset,
        current: directlyMaterialized,
      });
    }

    const queueResult = await enqueueMaterializeAssetFacesJob({
      tenantId: input.tenantId,
      projectId: input.projectId,
      assetId: asset.id,
      materializerVersion: getAutoMatchMaterializerVersion(),
      mode: "repair_requeue",
      requeueReason: "manual_link_state",
      payload: {
        repairRequested: true,
        source: "manual_link_state",
      },
      supabase: input.supabase,
    });

    const refreshedCurrent = await loadCurrentAssetFaceMaterialization(
      input.supabase,
      input.tenantId,
      input.projectId,
      input.assetId,
      getAutoMatchMaterializerVersion(),
      { includeFaces: true },
    );

    if (refreshedCurrent) {
      return buildReadyManualPhotoLinkState({
        supabase: input.supabase,
        tenantId: input.tenantId,
        projectId: input.projectId,
        consentId: input.consentId,
        consent,
        asset,
        current: {
          materialization: refreshedCurrent.materialization,
          faces: normalizeCurrentMaterializationFaces(refreshedCurrent.faces),
        },
      });
    }

    return {
      materializationStatus: getPendingMaterializationStatus(queueResult),
      assetId: asset.id,
      materializationId: null,
      detectedFaceCount: 0,
      faces: [],
      fallbackAllowed: false,
      currentConsentLink: null,
    };
  }

  return buildReadyManualPhotoLinkState({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
    consentId: input.consentId,
    consent,
    asset,
    current: {
      materialization: current.materialization,
      faces: normalizeCurrentMaterializationFaces(current.faces),
    },
  });
}

export async function manualLinkPhotoToConsent(input: ManualPhotoLinkInput): Promise<ManualPhotoLinkResult> {
  await assertConsentInProject(input, { requireNotRevoked: true });
  const state = await resolvePhotoState(input);
  const assignments = await loadCurrentAssignmentsForAsset(
    input.supabase,
    input.tenantId,
    input.projectId,
    input.assetId,
    state.materialization?.id ?? null,
  );
  const requested = resolveRequestedFace(
    normalizeManualMode(input.mode),
    state.faces,
    state.hiddenFaceIds,
    input.assetFaceId,
  );

  if (requested.resolvedMode === "asset_fallback") {
    if (!state.materialization) {
      throw new HttpError(
        409,
        "photo_materialization_pending",
        "Photo face materialization is still pending for this photo.",
      );
    }

    if (state.materialization.face_count > 0) {
      throw new HttpError(
        409,
        "photo_face_selection_required",
        "Detected faces exist for this photo. Select a specific face instead.",
      );
    }

    const alreadyLinked = assignments.fallbacks.find((row) => row.consent_id === input.consentId) ?? null;
    if (alreadyLinked) {
      return {
        kind: "already_linked",
        mode: "asset_fallback",
        assetFaceId: null,
      };
    }

    const { error: upsertError } = await input.supabase.from("asset_consent_manual_photo_fallbacks").upsert(
      {
        asset_id: input.assetId,
        consent_id: input.consentId,
        tenant_id: input.tenantId,
        project_id: input.projectId,
        created_by: input.actorUserId ?? null,
      },
      { onConflict: "asset_id,consent_id" },
    );

    if (upsertError) {
      throw new HttpError(500, "photo_fallback_write_failed", "Unable to link the photo fallback.");
    }

    const { error: suppressionDeleteError } = await input.supabase
      .from("asset_consent_manual_photo_fallback_suppressions")
      .delete()
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .eq("asset_id", input.assetId)
      .eq("consent_id", input.consentId);

    if (suppressionDeleteError) {
      throw new HttpError(500, "photo_fallback_write_failed", "Unable to update photo fallback suppression.");
    }

    await deleteCandidatePair(input.supabase, input.tenantId, input.projectId, input.assetId, input.consentId);

    return {
      kind: "linked",
      mode: "asset_fallback",
      replacedConsentId: null,
      assetFaceId: null,
    };
  }

  if (!state.materialization || !requested.resolvedFace) {
    throw new HttpError(
      409,
      "photo_materialization_pending",
      "Photo face materialization is still pending for this photo.",
    );
  }

  if (state.materialization.face_count <= 0) {
    throw new HttpError(409, "photo_zero_faces_only_fallback", "No detected faces are available for this photo.");
  }

  const faceLinksByFaceId = new Map(assignments.faceLinks.map((row) => [row.asset_face_id, row]));
  const faceLinksByConsentId = new Map(assignments.faceLinks.map((row) => [row.consent_id, row]));
  const currentFaceAssignee = faceLinksByFaceId.get(requested.resolvedFace.id) ?? null;
  const currentConsentFace = faceLinksByConsentId.get(input.consentId) ?? null;

  if (
    currentFaceAssignee &&
    currentFaceAssignee.consent_id !== input.consentId &&
    currentFaceAssignee.link_source === "manual" &&
    !input.forceReplace
  ) {
    const consentSummaries = await loadConsentSummaries(
      input.supabase,
      input.tenantId,
      input.projectId,
      [currentFaceAssignee.consent_id],
    );
    const currentAssigneeSummary = consentSummaries.get(currentFaceAssignee.consent_id);
    return {
      kind: "manual_conflict",
      canForceReplace: true,
      currentAssignee: {
        consentId: currentFaceAssignee.consent_id,
        fullName: currentAssigneeSummary?.fullName ?? null,
        email: currentAssigneeSummary?.email ?? null,
        linkSource: currentFaceAssignee.link_source,
      },
    };
  }

  if (currentFaceAssignee?.consent_id === input.consentId && currentFaceAssignee.link_source === "manual") {
    await deleteFaceSuppression(input.supabase, {
      tenantId: input.tenantId,
      projectId: input.projectId,
      assetFaceId: requested.resolvedFace.id,
      consentId: input.consentId,
    });
    await clearFallbackRowsForConsent(input.supabase, input.tenantId, input.projectId, input.assetId, input.consentId);
    return {
      kind: "already_linked",
      mode: "face",
      assetFaceId: requested.resolvedFace.id,
    };
  }

  let replacedConsentId: string | null = null;
  if (currentFaceAssignee && currentFaceAssignee.consent_id !== input.consentId) {
    const { error: deleteCurrentFaceError } = await input.supabase
      .from("asset_face_consent_links")
      .delete()
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .eq("asset_face_id", requested.resolvedFace.id)
      .eq("consent_id", currentFaceAssignee.consent_id);

    if (deleteCurrentFaceError) {
      throw new HttpError(500, "photo_face_link_write_failed", "Unable to replace the current face assignee.");
    }

    await upsertFaceSuppression(input.supabase, {
      tenantId: input.tenantId,
      projectId: input.projectId,
      assetId: input.assetId,
      materializationId: state.materialization.id,
      assetFaceId: requested.resolvedFace.id,
      consentId: currentFaceAssignee.consent_id,
      actorUserId: input.actorUserId,
      reason: "manual_replace",
    });
    replacedConsentId = currentFaceAssignee.consent_id;
  }

  if (currentConsentFace && currentConsentFace.asset_face_id !== requested.resolvedFace.id) {
    const { error: deletePriorConsentFaceError } = await input.supabase
      .from("asset_face_consent_links")
      .delete()
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .eq("asset_face_id", currentConsentFace.asset_face_id)
      .eq("consent_id", input.consentId);

    if (deletePriorConsentFaceError) {
      throw new HttpError(500, "photo_face_link_write_failed", "Unable to move the current face assignment.");
    }

    await upsertFaceSuppression(input.supabase, {
      tenantId: input.tenantId,
      projectId: input.projectId,
      assetId: input.assetId,
      materializationId: state.materialization.id,
      assetFaceId: currentConsentFace.asset_face_id,
      consentId: input.consentId,
      actorUserId: input.actorUserId,
      reason: "manual_replace",
    });
  }

  const nowIso = new Date().toISOString();
  const { error: upsertError } = await input.supabase.from("asset_face_consent_links").upsert(
    {
      asset_face_id: requested.resolvedFace.id,
      asset_materialization_id: state.materialization.id,
      asset_id: input.assetId,
      consent_id: input.consentId,
      tenant_id: input.tenantId,
      project_id: input.projectId,
      link_source: "manual",
      match_confidence: null,
      matched_at: null,
      reviewed_at: nowIso,
      reviewed_by: input.actorUserId ?? null,
      matcher_version: null,
      updated_at: nowIso,
    },
    { onConflict: "asset_face_id" },
  );

  if (upsertError) {
    throw new HttpError(500, "photo_face_link_write_failed", "Unable to link the selected face.");
  }

  await deleteFaceSuppression(input.supabase, {
    tenantId: input.tenantId,
    projectId: input.projectId,
    assetFaceId: requested.resolvedFace.id,
    consentId: input.consentId,
  });
  await clearFallbackRowsForConsent(input.supabase, input.tenantId, input.projectId, input.assetId, input.consentId);
  await deleteCandidatePair(input.supabase, input.tenantId, input.projectId, input.assetId, input.consentId);
  await reconcilePhotoFaceCanonicalStateForAsset({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
    assetId: input.assetId,
  });

  return {
    kind: "linked",
    mode: "face",
    replacedConsentId,
    assetFaceId: requested.resolvedFace.id,
  };
}

export async function manualUnlinkPhotoFromConsent(input: ManualPhotoUnlinkInput): Promise<ManualPhotoUnlinkResult> {
  await assertConsentInProject(input, { requireNotRevoked: true });
  const state = await resolvePhotoState(input);
  const requested = resolveRequestedFace(
    normalizeManualMode(input.mode),
    state.faces,
    state.hiddenFaceIds,
    input.assetFaceId,
  );

  if (requested.resolvedMode === "asset_fallback") {
    if (!state.materialization) {
      throw new HttpError(
        409,
        "photo_materialization_pending",
        "Photo face materialization is still pending for this photo.",
      );
    }

    if (state.materialization.face_count > 0) {
      throw new HttpError(
        409,
        "photo_face_selection_required",
        "Detected faces exist for this photo. Select a specific face to unlink.",
      );
    }

    const { error: deleteError } = await input.supabase
      .from("asset_consent_manual_photo_fallbacks")
      .delete()
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .eq("asset_id", input.assetId)
      .eq("consent_id", input.consentId);

    if (deleteError) {
      throw new HttpError(500, "photo_fallback_write_failed", "Unable to unlink the zero-face fallback.");
    }

    const { error: suppressionUpsertError } = await input.supabase
      .from("asset_consent_manual_photo_fallback_suppressions")
      .upsert(
        {
          asset_id: input.assetId,
          consent_id: input.consentId,
          tenant_id: input.tenantId,
          project_id: input.projectId,
          reason: "manual_unlink",
          created_by: input.actorUserId ?? null,
        },
        { onConflict: "asset_id,consent_id" },
      );

    if (suppressionUpsertError) {
      throw new HttpError(500, "photo_fallback_write_failed", "Unable to persist the zero-face fallback suppression.");
    }

    await deleteCandidatePair(input.supabase, input.tenantId, input.projectId, input.assetId, input.consentId);
    return {
      kind: "unlinked",
      mode: "asset_fallback",
      assetFaceId: null,
    };
  }

  if (!state.materialization || !requested.resolvedFace) {
    throw new HttpError(
      409,
      "photo_materialization_pending",
      "Photo face materialization is still pending for this photo.",
    );
  }

  const currentAssignment = await loadCurrentFaceAssignmentForAssetFace({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
    assetId: input.assetId,
    assetFaceId: requested.resolvedFace.id,
    materializationId: state.materialization.id,
  });

  if (currentAssignment?.consent_id === input.consentId) {
    await unlinkCurrentExactFaceAssignmentWithSuppression({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
      assetId: input.assetId,
      materializationId: state.materialization.id,
      assetFaceId: requested.resolvedFace.id,
      actorUserId: input.actorUserId,
    });
  } else {
    await upsertFaceSuppression(input.supabase, {
      tenantId: input.tenantId,
      projectId: input.projectId,
      assetId: input.assetId,
      materializationId: state.materialization.id,
      assetFaceId: requested.resolvedFace.id,
      consentId: input.consentId,
      actorUserId: input.actorUserId,
      reason: "manual_unlink",
    });
    await deleteCandidatePair(input.supabase, input.tenantId, input.projectId, input.assetId, input.consentId);
  }
  await reconcilePhotoFaceCanonicalStateForAsset({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
    assetId: input.assetId,
  });

  return {
    kind: "unlinked",
    mode: "face",
    assetFaceId: requested.resolvedFace.id,
  };
}

export async function clearConsentPhotoSuppressions(input: MatchingScopeInput) {
  await assertConsentInProject(input);

  const { error: faceSuppressionDeleteError } = await input.supabase
    .from("asset_face_consent_link_suppressions")
    .delete()
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("consent_id", input.consentId);

  if (faceSuppressionDeleteError) {
    throw new HttpError(500, "photo_face_suppression_delete_failed", "Unable to clear face suppressions.");
  }

  const { error: fallbackSuppressionDeleteError } = await input.supabase
    .from("asset_consent_manual_photo_fallback_suppressions")
    .delete()
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("consent_id", input.consentId);

  if (fallbackSuppressionDeleteError) {
    throw new HttpError(
      500,
      "photo_face_suppression_delete_failed",
      "Unable to clear zero-face fallback suppressions.",
    );
  }
}

export async function clearConsentAutoPhotoFaceLinks(input: MatchingScopeInput) {
  await assertConsentInProject(input);

  const { error } = await input.supabase
    .from("asset_face_consent_links")
    .delete()
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("consent_id", input.consentId)
    .eq("link_source", "auto");

  if (error) {
    throw new HttpError(500, "photo_face_link_delete_failed", "Unable to clear auto face links.");
  }
}

export async function reconcilePhotoFaceCanonicalStateForAsset(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  assetId: string;
}) {
  const current = await loadCurrentAssetFaceMaterialization(
    input.supabase,
    input.tenantId,
    input.projectId,
    input.assetId,
    getAutoMatchMaterializerVersion(),
    { includeFaces: true },
  );

  if (!current) {
    return {
      faceCount: 0,
      autoWinners: 0,
    };
  }

  await cleanupCurrentPhotoStateForAsset(
    input.supabase,
    input.tenantId,
    input.projectId,
    input.assetId,
    current.materialization,
  );

  if (current.materialization.face_count <= 0) {
    return {
      faceCount: 0,
      autoWinners: 0,
    };
  }

  const currentAssignments = await loadCurrentAssignmentsForAsset(
    input.supabase,
    input.tenantId,
    input.projectId,
    input.assetId,
    current.materialization.id,
  );
  const hiddenFaceIds = new Set(
    (
      await loadCurrentHiddenFacesForAssets(
        input.supabase,
        input.tenantId,
        input.projectId,
        [input.assetId],
        new Map([[input.assetId, current.materialization.id]]),
      )
    ).map((row) => row.asset_face_id),
  );
  const manualByFaceId = new Map(
    currentAssignments.faceLinks
      .filter((row) => row.link_source === "manual")
      .map((row) => [row.asset_face_id, row]),
  );
  const autoByFaceId = new Map(
    currentAssignments.faceLinks
      .filter((row) => row.link_source === "auto")
      .map((row) => [row.asset_face_id, row]),
  );
  const manualConsentIds = new Set(
    currentAssignments.faceLinks.filter((row) => row.link_source === "manual").map((row) => row.consent_id),
  );
  const suppressions = new Set(
    currentAssignments.suppressions.map((row) => `${row.asset_face_id}:${row.consent_id}`),
  );

  const compares = await loadCurrentCompareRowsForAsset(input.supabase, input.tenantId, input.projectId, input.assetId);
  const consentStateIds = Array.from(
    new Set([
      ...compares.map((row) => row.consent_id),
      ...currentAssignments.faceLinks
        .filter((row) => row.link_source === "auto")
        .map((row) => row.consent_id),
    ]),
  );
  const consentStateById = await loadConsentStateMap(input.supabase, input.tenantId, input.projectId, consentStateIds);
  const currentHeadshotMaterializationIdByConsentId = await loadCurrentHeadshotMaterializationIds(
    input.supabase,
    input.tenantId,
    input.projectId,
    consentStateIds,
  );
  const faceIds = new Set(current.faces.map((face) => face.id));
  const confidenceThreshold = getAutoMatchConfidenceThreshold();

  const contendersByFaceId = new Map<string, Array<{ consentId: string; confidence: number }>>();
  for (const compare of compares) {
    const consentState = consentStateById.get(compare.consent_id);
    const confidence = toNumericConfidence(compare.winning_similarity);
    if (!consentState || !compare.winning_asset_face_id || confidence === null) {
      continue;
    }

    if (consentState.revoked_at || !consentState.face_match_opt_in) {
      continue;
    }

    if (compare.compare_status !== "matched") {
      continue;
    }

    if (compare.asset_materialization_id !== current.materialization.id) {
      continue;
    }

    if (currentHeadshotMaterializationIdByConsentId.get(compare.consent_id) !== compare.headshot_materialization_id) {
      continue;
    }

    if (!faceIds.has(compare.winning_asset_face_id)) {
      continue;
    }

    if (hiddenFaceIds.has(compare.winning_asset_face_id)) {
      continue;
    }

    if (confidence < confidenceThreshold) {
      continue;
    }

    if (manualConsentIds.has(compare.consent_id)) {
      continue;
    }

    if (suppressions.has(`${compare.winning_asset_face_id}:${compare.consent_id}`)) {
      continue;
    }

    const existing = contendersByFaceId.get(compare.winning_asset_face_id) ?? [];
    existing.push({
      consentId: compare.consent_id,
      confidence,
    });
    contendersByFaceId.set(compare.winning_asset_face_id, existing);
  }

  const desiredAutoRows = new Map<string, { consentId: string; confidence: number }>();
  for (const face of current.faces) {
    if (hiddenFaceIds.has(face.id)) {
      continue;
    }

    if (manualByFaceId.has(face.id)) {
      continue;
    }

    const contenders = contendersByFaceId.get(face.id) ?? [];
    if (contenders.length === 0) {
      continue;
    }

    contenders.sort((left, right) => {
      if (right.confidence !== left.confidence) {
        return right.confidence - left.confidence;
      }

      return left.consentId.localeCompare(right.consentId);
    });

    const winner = contenders[0] ?? null;
    if (!winner) {
      continue;
    }

    desiredAutoRows.set(face.id, winner);
  }

  const nowIso = new Date().toISOString();
  const upserts = Array.from(desiredAutoRows.entries()).map(([assetFaceId, winner]) => ({
    asset_face_id: assetFaceId,
    asset_materialization_id: current.materialization.id,
    asset_id: input.assetId,
    consent_id: winner.consentId,
    tenant_id: input.tenantId,
    project_id: input.projectId,
    link_source: "auto",
    match_confidence: winner.confidence,
    matched_at: nowIso,
    reviewed_at: null,
    reviewed_by: null,
    matcher_version: getAutoMatchCompareVersion(),
    updated_at: nowIso,
  }));

  if (upserts.length > 0) {
    const { error } = await input.supabase.from("asset_face_consent_links").upsert(upserts, {
      onConflict: "asset_face_id",
    });

    if (error) {
      throw new HttpError(500, "photo_face_link_write_failed", "Unable to reconcile auto face links.");
    }
  }

  for (const [assetFaceId, existing] of autoByFaceId.entries()) {
    const desired = desiredAutoRows.get(assetFaceId);
    const existingConsentState = consentStateById.get(existing.consent_id) ?? null;
    const preserveHistoricalAutoRow = Boolean(
      existingConsentState && (existingConsentState.revoked_at || !existingConsentState.face_match_opt_in),
    );

    if (preserveHistoricalAutoRow) {
      continue;
    }

    if (hiddenFaceIds.has(assetFaceId) || manualByFaceId.has(assetFaceId) || !desired || desired.consentId !== existing.consent_id) {
      const { error } = await input.supabase
        .from("asset_face_consent_links")
        .delete()
        .eq("tenant_id", input.tenantId)
        .eq("project_id", input.projectId)
        .eq("asset_face_id", assetFaceId)
        .eq("consent_id", existing.consent_id)
        .eq("link_source", "auto");

      if (error) {
        throw new HttpError(500, "photo_face_link_delete_failed", "Unable to remove stale auto face links.");
      }
    }
  }

  for (const winner of desiredAutoRows.values()) {
    await deleteCandidatePair(input.supabase, input.tenantId, input.projectId, input.assetId, winner.consentId);
  }

  return {
    faceCount: current.materialization.face_count,
    autoWinners: desiredAutoRows.size,
  };
}
