import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import { runChunkedRead } from "@/lib/supabase/safe-in-filter";

const MAX_REQUEST_CONSENT_IDS = 50;

type FinalizeAssetInput = {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  assetId: string;
  consentIds: string[];
  expectedAssetType?: "photo" | "headshot" | null;
};

export type FinalizedAsset = {
  assetId: string;
  assetType: "photo" | "headshot";
};

function normalizeConsentIds(consentIds: string[]) {
  const unique = Array.from(new Set(consentIds.map((consentId) => String(consentId ?? "").trim()).filter(Boolean)));
  if (unique.length > MAX_REQUEST_CONSENT_IDS) {
    throw new HttpError(400, "invalid_consent_ids_too_large", "Too many consent IDs were provided.");
  }
  return unique;
}

async function validateConsents(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  consentIds: string[],
) {
  if (consentIds.length === 0) {
    return;
  }

  const data = await runChunkedRead(consentIds, async (consentIdChunk) => {
    // safe-in-filter: finalize consent validation is request-bounded and chunked by shared helper.
    const { data: rows, error } = await supabase
      .from("consents")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .in("id", consentIdChunk);

    if (error) {
      throw new HttpError(500, "consent_lookup_failed", "Unable to validate consent links.");
    }

    return (rows ?? []) as Array<{ id: string }>;
  });

  const found = new Set((data ?? []).map((row) => row.id));
  const missing = consentIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new HttpError(400, "invalid_consent_ids", "One or more consent IDs are invalid.");
  }
}

export async function finalizeAsset(input: FinalizeAssetInput): Promise<FinalizedAsset> {
  input.consentIds = normalizeConsentIds(input.consentIds);
  const { data: asset, error: assetError } = await input.supabase
    .from("assets")
    .select("id, asset_type")
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("id", input.assetId)
    .maybeSingle();

  if (assetError) {
    throw new HttpError(500, "asset_lookup_failed", "Unable to load asset.");
  }

  if (!asset) {
    throw new HttpError(404, "asset_not_found", "Asset not found.");
  }

  if (input.expectedAssetType && asset.asset_type !== input.expectedAssetType) {
    throw new HttpError(400, "invalid_asset_type", "Asset type is not allowed.");
  }

  await validateConsents(input.supabase, input.tenantId, input.projectId, input.consentIds);

  const now = new Date().toISOString();
  const { error: updateError } = await input.supabase
    .from("assets")
    .update({ status: "uploaded", uploaded_at: now })
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("id", input.assetId);

  if (updateError) {
    throw new HttpError(500, "asset_finalize_failed", "Unable to finalize asset.");
  }

  if (input.consentIds.length > 0 && asset.asset_type === "headshot") {
    const rows = input.consentIds.map((consentId) => ({
      asset_id: input.assetId,
      consent_id: consentId,
      tenant_id: input.tenantId,
      project_id: input.projectId,
      link_source: "manual",
      match_confidence: null,
      matched_at: null,
      reviewed_at: null,
      reviewed_by: null,
      matcher_version: null,
    }));

    const { error: linkError } = await input.supabase.from("asset_consent_links").upsert(rows, {
      onConflict: "asset_id,consent_id",
    });

    if (linkError) {
      throw new HttpError(500, "asset_link_failed", "Unable to link asset to consents.");
    }
  }

  return {
    assetId: asset.id,
    assetType: asset.asset_type,
  };
}
