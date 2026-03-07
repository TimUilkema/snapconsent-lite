import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";

type MatchingScopeInput = {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  consentId: string;
};

type ListMatchableProjectPhotosInput = MatchingScopeInput & {
  query?: string | null;
  limit?: number | null;
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
};

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

function normalizeUniqueAssetIds(assetIds: string[]) {
  return Array.from(
    new Set(
      assetIds
        .filter((assetId) => typeof assetId === "string")
        .map((assetId) => assetId.trim())
        .filter((assetId) => assetId.length > 0),
    ),
  );
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

  let query = input.supabase
    .from("assets")
    .select("id, status, archived_at")
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("asset_type", "photo")
    .in("id", assetIds);

  if (requireUploadedAndNotArchived) {
    query = query.eq("status", "uploaded").is("archived_at", null);
  }

  const { data: assets, error } = await query;

  if (error) {
    throw new HttpError(500, "asset_lookup_failed", "Unable to validate assets.");
  }

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

  const queryText = normalizeQuery(input.query);
  const limit = normalizeListLimit(input.limit);

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
    .limit(limit);

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

  const { data: links, error: linksError } = await input.supabase
    .from("asset_consent_links")
    .select("asset_id")
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("consent_id", input.consentId)
    .in("asset_id", assetIds);

  if (linksError) {
    throw new HttpError(500, "link_lookup_failed", "Unable to load existing matches.");
  }

  const linkedAssetIds = new Set((links ?? []).map((link) => link.asset_id));
  return assetRows
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
    }));
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

  const { data: assets, error: assetsError } = await input.supabase
    .from("assets")
    .select(
      "id, original_filename, status, file_size_bytes, created_at, uploaded_at, archived_at, storage_bucket, storage_path",
    )
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("asset_type", "photo")
    .in("id", linkedAssetIds)
    .order("created_at", { ascending: false });

  if (assetsError) {
    throw new HttpError(500, "asset_lookup_failed", "Unable to load linked photo assets.");
  }

  return (assets ?? []).map((asset) => {
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

  const { error: suppressionDeleteError } = await input.supabase
    .from("asset_consent_link_suppressions")
    .delete()
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("consent_id", input.consentId)
    .in("asset_id", uniqueAssetIds);

  if (suppressionDeleteError) {
    throw new HttpError(500, "link_create_failed", "Unable to clear matching suppression.");
  }

  return { linkedCount: uniqueAssetIds.length };
}

export async function unlinkPhotosFromConsent(input: ModifyConsentPhotoLinksInput) {
  await assertConsentInProject(input);

  const uniqueAssetIds = normalizeUniqueAssetIds(input.assetIds);
  if (uniqueAssetIds.length === 0) {
    return { unlinkedCount: 0 };
  }

  await validatePhotoAssetIdsInProject(input, uniqueAssetIds, false);

  const { error } = await input.supabase
    .from("asset_consent_links")
    .delete()
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("consent_id", input.consentId)
    .in("asset_id", uniqueAssetIds);

  if (error) {
    throw new HttpError(500, "link_delete_failed", "Unable to unlink assets from consent.");
  }

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
