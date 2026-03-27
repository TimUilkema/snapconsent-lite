import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import { getAutoMatchConfidenceThreshold } from "@/lib/matching/auto-match-config";
import { runChunkedMutation, runChunkedRead } from "@/lib/supabase/safe-in-filter";

type MatchingScopeInput = {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  consentId: string;
};

type ListMatchableProjectPhotosInput = MatchingScopeInput & {
  query?: string | null;
  limit?: number | null;
  mode?: MatchablePhotosMode;
};

type ModifyConsentPhotoLinksInput = MatchingScopeInput & {
  assetIds: string[];
};

type MatchablePhotoRow = {
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
};

export const MATCHABLE_PHOTOS_MODES = ["default", "likely"] as const;
export type MatchablePhotosMode = (typeof MATCHABLE_PHOTOS_MODES)[number];

type LinkedPhotoRow = {
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
};

const DEFAULT_LIMIT = 40;
const MAX_LIMIT = 100;
const MAX_REQUEST_ASSET_IDS = 100;
const LIKELY_REVIEW_MIN_CONFIDENCE = 0.25;

function normalizeUniqueAssetIds(assetIds: string[]) {
  const unique = Array.from(
    new Set(
      assetIds
        .filter((assetId) => typeof assetId === "string")
        .map((assetId) => assetId.trim())
        .filter((assetId) => assetId.length > 0),
    ),
  );
  if (unique.length > MAX_REQUEST_ASSET_IDS) {
    throw new HttpError(400, "invalid_asset_ids_too_large", "Too many asset IDs were provided.");
  }
  return unique;
}

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

export async function assertConsentInProject(input: MatchingScopeInput) {
  const { data: consent, error } = await input.supabase
    .from("consents")
    .select("id, revoked_at")
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

  return consent;
}

async function validatePhotoAssetIdsInProject(
  input: MatchingScopeInput,
  assetIds: string[],
  requireUploadedAndNotArchived: boolean,
) {
  if (assetIds.length === 0) {
    return [];
  }

  const assets = await runChunkedRead(assetIds, async (assetIdChunk) => {
    let query = input.supabase
      .from("assets")
      .select("id, status, archived_at")
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .eq("asset_type", "photo")
      // safe-in-filter: consent asset validation is request-bounded and chunked by shared helper.
      .in("id", assetIdChunk);

    if (requireUploadedAndNotArchived) {
      query = query.eq("status", "uploaded").is("archived_at", null);
    }

    const { data, error } = await query;

    if (error) {
      throw new HttpError(500, "asset_lookup_failed", "Unable to validate assets.");
    }

    return (data ?? []) as Array<{ id: string; status: string; archived_at: string | null }>;
  });

  const foundAssetIds = new Set((assets ?? []).map((asset) => asset.id));
  const missingAssetIds = assetIds.filter((assetId) => !foundAssetIds.has(assetId));
  if (missingAssetIds.length > 0) {
    throw new HttpError(400, "invalid_asset_ids", "One or more asset IDs are invalid.");
  }

  return assets ?? [];
}

export async function listMatchableProjectPhotosForConsent(
  input: ListMatchableProjectPhotosInput,
): Promise<MatchablePhotoRow[]> {
  await assertConsentInProject(input);

  const mode = normalizeMatchablePhotosMode(input.mode);
  if (mode === "likely") {
    return listLikelyMatchableProjectPhotosForConsent(input);
  }

  return listDefaultMatchableProjectPhotosForConsent(input);
}

async function listDefaultMatchableProjectPhotosForConsent(
  input: ListMatchableProjectPhotosInput,
): Promise<MatchablePhotoRow[]> {
  const queryText = normalizeQuery(input.query);
  const limit = Number.isFinite(input.limit) && input.limit !== null && input.limit !== undefined
    ? normalizeListLimit(input.limit)
    : null;

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
    .order("created_at", { ascending: false });

  if (queryText) {
    query = query.ilike("original_filename", `%${queryText}%`);
  }

  const { data: assets, error: assetsError } = await query;

  if (assetsError) {
    throw new HttpError(500, "asset_lookup_failed", "Unable to load matchable assets.");
  }

  const assetRows = assets ?? [];
  const assetIds = assetRows.map((asset) => asset.id);
  if (assetIds.length === 0) {
    return [];
  }

  const links = await runChunkedRead(assetIds, async (assetIdChunk) => {
    // safe-in-filter: default matching list follow-up reads are page-bounded and chunked by shared helper.
    const { data, error } = await input.supabase
      .from("asset_consent_links")
      .select("asset_id")
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .eq("consent_id", input.consentId)
      .in("asset_id", assetIdChunk);

    if (error) {
      throw new HttpError(500, "link_lookup_failed", "Unable to load existing matches.");
    }

    return (data ?? []) as Array<{ asset_id: string }>;
  });

  const linkedAssetIds = new Set((links ?? []).map((link) => link.asset_id));
  const unlinkedAssets = assetRows
    .filter((asset) => !linkedAssetIds.has(asset.id))
    .map((asset) => ({
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
      candidate_confidence: null,
      candidate_last_scored_at: null,
      candidate_matcher_version: null,
    }));

  return limit === null ? unlinkedAssets : unlinkedAssets.slice(0, limit);
}

type LikelyCandidateRow = {
  asset_id: string;
  confidence: number | string;
  matcher_version: string | null;
  last_scored_at: string;
};

async function listLikelyMatchableProjectPhotosForConsent(
  input: ListMatchableProjectPhotosInput,
): Promise<MatchablePhotoRow[]> {
  const limit = normalizeListLimit(input.limit);
  const queryText = normalizeQuery(input.query);
  const confidenceThreshold = getAutoMatchConfidenceThreshold();
  const reviewMinConfidence = Math.min(LIKELY_REVIEW_MIN_CONFIDENCE, confidenceThreshold);
  if (reviewMinConfidence >= confidenceThreshold) {
    return [];
  }

  const candidateFetchLimit = Math.min(MAX_LIMIT * 3, limit * 3);
  const { data: candidates, error: candidatesError } = await input.supabase
    .from("asset_consent_match_candidates")
    .select("asset_id, confidence, matcher_version, last_scored_at")
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("consent_id", input.consentId)
    .gte("confidence", reviewMinConfidence)
    .lt("confidence", confidenceThreshold)
    .order("confidence", { ascending: false })
    .order("last_scored_at", { ascending: false })
    .limit(candidateFetchLimit);

  if (candidatesError) {
    throw new HttpError(500, "match_candidate_lookup_failed", "Unable to load likely-match candidates.");
  }

  const candidateRows = ((candidates as LikelyCandidateRow[] | null) ?? [])
    .map((candidate) => ({
      ...candidate,
      confidence: Number(candidate.confidence),
    }))
    .filter(
      (candidate) =>
        Number.isFinite(candidate.confidence) &&
        candidate.confidence >= reviewMinConfidence &&
        candidate.confidence < confidenceThreshold,
    );
  if (candidateRows.length === 0) {
    return [];
  }

  const candidateByAssetId = new Map(candidateRows.map((candidate) => [candidate.asset_id, candidate]));
  const candidateAssetIds = candidateRows.map((candidate) => candidate.asset_id);

  const assets = await runChunkedRead(candidateAssetIds, async (candidateAssetIdChunk) => {
    let assetsQuery = input.supabase
      .from("assets")
      .select(
        "id, original_filename, status, file_size_bytes, created_at, uploaded_at, archived_at, storage_bucket, storage_path",
      )
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .eq("asset_type", "photo")
      .eq("status", "uploaded")
      .is("archived_at", null)
      // safe-in-filter: likely-candidate asset fetch is candidate-bounded and chunked by shared helper.
      .in("id", candidateAssetIdChunk);

    if (queryText) {
      assetsQuery = assetsQuery.ilike("original_filename", `%${queryText}%`);
    }

    const { data, error } = await assetsQuery;
    if (error) {
      throw new HttpError(500, "asset_lookup_failed", "Unable to load likely-match assets.");
    }

    return (data ?? []) as MatchablePhotoRow[];
  });

  const assetRows = assets ?? [];
  const assetIds = assetRows.map((asset) => asset.id);
  if (assetIds.length === 0) {
    return [];
  }

  const links = await runChunkedRead(assetIds, async (assetIdChunk) => {
    // safe-in-filter: likely-candidate link lookup is candidate-bounded and chunked by shared helper.
    const { data, error } = await input.supabase
      .from("asset_consent_links")
      .select("asset_id")
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .eq("consent_id", input.consentId)
      .in("asset_id", assetIdChunk);
    if (error) {
      throw new HttpError(500, "link_lookup_failed", "Unable to load existing matches.");
    }
    return (data ?? []) as Array<{ asset_id: string }>;
  });

  const suppressionRows = await runChunkedRead(assetIds, async (assetIdChunk) => {
    // safe-in-filter: likely-candidate suppression lookup is candidate-bounded and chunked by shared helper.
    const { data, error } = await input.supabase
      .from("asset_consent_link_suppressions")
      .select("asset_id")
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .eq("consent_id", input.consentId)
      .in("asset_id", assetIdChunk);
    if (error) {
      throw new HttpError(500, "link_lookup_failed", "Unable to load matching suppressions.");
    }
    return (data ?? []) as Array<{ asset_id: string }>;
  });

  const linkedAssetIds = new Set((links ?? []).map((link) => link.asset_id));
  const suppressedAssetIds = new Set((suppressionRows ?? []).map((row) => row.asset_id));

  return assetRows
    .filter((asset) => !linkedAssetIds.has(asset.id))
    .filter((asset) => !suppressedAssetIds.has(asset.id))
    .map((asset) => ({
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
      candidate_confidence: candidateByAssetId.get(asset.id)?.confidence ?? null,
      candidate_last_scored_at: candidateByAssetId.get(asset.id)?.last_scored_at ?? null,
      candidate_matcher_version: candidateByAssetId.get(asset.id)?.matcher_version ?? null,
    }))
    .sort((left, right) => {
      const rightScore = right.candidate_confidence ?? -1;
      const leftScore = left.candidate_confidence ?? -1;
      if (rightScore !== leftScore) {
        return rightScore - leftScore;
      }

      return right.created_at.localeCompare(left.created_at);
    })
    .slice(0, limit);
}

export async function listLinkedPhotosForConsent(
  input: MatchingScopeInput,
): Promise<LinkedPhotoRow[]> {
  await assertConsentInProject(input);

  const { data: links, error: linksError } = await input.supabase
    .from("asset_consent_links")
    .select("asset_id, created_at, link_source, match_confidence, matched_at, reviewed_at, reviewed_by")
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("consent_id", input.consentId);

  if (linksError) {
    throw new HttpError(500, "link_lookup_failed", "Unable to load linked assets.");
  }

  const linkRows = links ?? [];
  if (linkRows.length === 0) {
    return [];
  }

  const linkedAssetIds = Array.from(new Set(linkRows.map((link) => link.asset_id)));
  const linkDataByAssetId = new Map(linkRows.map((link) => [link.asset_id, link]));

  const assets = await runChunkedRead(linkedAssetIds, async (assetIdChunk) => {
    // safe-in-filter: linked-photo lookup can be large and is chunked by shared helper.
    const { data, error } = await input.supabase
      .from("assets")
      .select(
        "id, original_filename, status, file_size_bytes, created_at, uploaded_at, archived_at, storage_bucket, storage_path",
      )
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .eq("asset_type", "photo")
      // safe-in-filter: linked-photo asset reads are request-bounded and chunked by shared helper.
      .in("id", assetIdChunk)
      .order("created_at", { ascending: false });

    if (error) {
      throw new HttpError(500, "asset_lookup_failed", "Unable to load linked photo assets.");
    }

    return (data ?? []) as LinkedPhotoRow[];
  });

  return (assets ?? [])
    .sort((left, right) => right.created_at.localeCompare(left.created_at))
    .map((asset) => {
    const linkData = linkDataByAssetId.get(asset.id);
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
      link_created_at: linkData?.created_at ?? asset.created_at,
      link_source: linkData?.link_source === "auto" ? "auto" : "manual",
      match_confidence: linkData?.match_confidence ?? null,
      matched_at: linkData?.matched_at ?? null,
      reviewed_at: linkData?.reviewed_at ?? null,
      reviewed_by: linkData?.reviewed_by ?? null,
    };
  });
}

export async function linkPhotosToConsent(input: ModifyConsentPhotoLinksInput) {
  await assertConsentInProject(input);

  const uniqueAssetIds = normalizeUniqueAssetIds(input.assetIds);
  if (uniqueAssetIds.length === 0) {
    return { linkedCount: 0 };
  }

  await validatePhotoAssetIdsInProject(input, uniqueAssetIds, true);

  const rows = uniqueAssetIds.map((assetId) => ({
    asset_id: assetId,
    consent_id: input.consentId,
    tenant_id: input.tenantId,
    project_id: input.projectId,
    link_source: "manual",
    match_confidence: null,
    matched_at: null,
    reviewed_at: null,
    reviewed_by: null,
    matcher_version: null,
  }));

  const { error } = await input.supabase.from("asset_consent_links").upsert(rows, {
    onConflict: "asset_id,consent_id",
  });

  if (error) {
    throw new HttpError(500, "link_create_failed", "Unable to link assets to consent.");
  }

  await runChunkedMutation(uniqueAssetIds, async (assetIdChunk) => {
    // safe-in-filter: manual link suppression cleanup is request-bounded and chunked by shared helper.
    const { error: suppressionDeleteError } = await input.supabase
      .from("asset_consent_link_suppressions")
      .delete()
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .eq("consent_id", input.consentId)
      // safe-in-filter: suppression cleanup is request-bounded and chunked by shared helper.
      .in("asset_id", assetIdChunk);

    if (suppressionDeleteError) {
      throw new HttpError(500, "link_create_failed", "Unable to clear matching suppression.");
    }
  });

  return { linkedCount: uniqueAssetIds.length };
}

export async function clearConsentPhotoSuppressions(input: MatchingScopeInput) {
  await assertConsentInProject(input);

  const { error } = await input.supabase
    .from("asset_consent_link_suppressions")
    .delete()
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("consent_id", input.consentId);

  if (error) {
    throw new HttpError(500, "link_delete_failed", "Unable to clear matching suppressions.");
  }
}

export async function unlinkPhotosFromConsent(input: ModifyConsentPhotoLinksInput) {
  await assertConsentInProject(input);

  const uniqueAssetIds = normalizeUniqueAssetIds(input.assetIds);
  if (uniqueAssetIds.length === 0) {
    return { unlinkedCount: 0 };
  }

  await validatePhotoAssetIdsInProject(input, uniqueAssetIds, false);

  await runChunkedMutation(uniqueAssetIds, async (assetIdChunk) => {
    // safe-in-filter: manual unlink delete is request-bounded and chunked by shared helper.
    const { error } = await input.supabase
      .from("asset_consent_links")
      .delete()
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .eq("consent_id", input.consentId)
      .in("asset_id", assetIdChunk);

    if (error) {
      throw new HttpError(500, "link_delete_failed", "Unable to unlink assets from consent.");
    }
  });

  const suppressionRows = uniqueAssetIds.map((assetId) => ({
    asset_id: assetId,
    consent_id: input.consentId,
    tenant_id: input.tenantId,
    project_id: input.projectId,
    reason: "manual_unlink",
  }));

  const { error: suppressionUpsertError } = await input.supabase
    .from("asset_consent_link_suppressions")
    .upsert(suppressionRows, {
      onConflict: "asset_id,consent_id",
    });

  if (suppressionUpsertError) {
    throw new HttpError(500, "link_delete_failed", "Unable to persist matching suppression.");
  }

  return { unlinkedCount: uniqueAssetIds.length };
}
