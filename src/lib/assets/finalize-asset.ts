import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";

type FinalizeAssetInput = {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  assetId: string;
  consentIds: string[];
  expectedAssetType?: "photo" | "headshot" | null;
};

async function validateConsents(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  consentIds: string[],
) {
  if (consentIds.length === 0) {
    return;
  }

  const { data, error } = await supabase
    .from("consents")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .in("id", consentIds);

  if (error) {
    throw new HttpError(500, "consent_lookup_failed", "Unable to validate consent links.");
  }

  const found = new Set((data ?? []).map((row) => row.id));
  const missing = consentIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new HttpError(400, "invalid_consent_ids", "One or more consent IDs are invalid.");
  }
}

export async function finalizeAsset(input: FinalizeAssetInput) {
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

  if (input.consentIds.length > 0) {
    const rows = input.consentIds.map((consentId) => ({
      asset_id: input.assetId,
      consent_id: consentId,
      tenant_id: input.tenantId,
      project_id: input.projectId,
    }));

    const { error: linkError } = await input.supabase.from("asset_consent_links").upsert(rows, {
      onConflict: "asset_id,consent_id",
      ignoreDuplicates: true,
    });

    if (linkError) {
      throw new HttpError(500, "asset_link_failed", "Unable to link asset to consents.");
    }
  }
}
