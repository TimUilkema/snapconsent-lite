import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import { getReleaseAssetDetail } from "@/lib/project-releases/project-release-service";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type ResolveTenantIdFn = typeof import("@/lib/tenant/resolve-tenant").resolveTenantId;
type GetReleaseAssetDetailFn =
  typeof import("@/lib/project-releases/project-release-service").getReleaseAssetDetail;

type OriginalAssetMode = "download" | "open";

export async function createMediaLibraryOriginalAssetResponse(
  input: {
    authSupabase: SupabaseClient;
    adminSupabase: SupabaseClient;
    releaseAssetId: string;
    mode: OriginalAssetMode;
  },
  dependencies: {
    resolveTenantId: ResolveTenantIdFn;
    getReleaseAssetDetail: GetReleaseAssetDetailFn;
  } = {
    resolveTenantId,
    getReleaseAssetDetail,
  },
) {
  const {
    data: { user },
  } = await input.authSupabase.auth.getUser();

  if (!user) {
    throw new HttpError(401, "unauthenticated", "Authentication required.");
  }

  const tenantId = await dependencies.resolveTenantId(input.authSupabase);
  if (!tenantId) {
    throw new HttpError(403, "no_tenant_membership", "Tenant membership is required.");
  }

  const detail = await dependencies.getReleaseAssetDetail({
    supabase: input.authSupabase,
    tenantId,
    userId: user.id,
    releaseAssetId: input.releaseAssetId,
  });

  const bucket = detail.row.original_storage_bucket;
  const path = detail.row.original_storage_path;
  if (!bucket || !path) {
    throw new HttpError(
      409,
      "release_asset_source_missing",
      "The released source asset is no longer available.",
    );
  }

  const storage = input.adminSupabase.storage.from(bucket);
  const { data, error } = input.mode === "download"
    ? await storage.createSignedUrl(path, 120, {
        download: detail.row.original_filename || "media-library-original",
      })
    : await storage.createSignedUrl(path, 120);
  if (error || !data?.signedUrl) {
    throw new HttpError(
      409,
      "release_asset_source_missing",
      "The released source asset is no longer available.",
    );
  }

  return Response.redirect(data.signedUrl, 302);
}

export async function createMediaLibraryAssetDownloadResponse(
  input: {
    authSupabase: SupabaseClient;
    adminSupabase: SupabaseClient;
    releaseAssetId: string;
  },
  dependencies?: {
    resolveTenantId: ResolveTenantIdFn;
    getReleaseAssetDetail: GetReleaseAssetDetailFn;
  },
) {
  return createMediaLibraryOriginalAssetResponse(
    {
      ...input,
      mode: "download",
    },
    dependencies,
  );
}

export async function createMediaLibraryAssetOpenResponse(
  input: {
    authSupabase: SupabaseClient;
    adminSupabase: SupabaseClient;
    releaseAssetId: string;
  },
  dependencies?: {
    resolveTenantId: ResolveTenantIdFn;
    getReleaseAssetDetail: GetReleaseAssetDetailFn;
  },
) {
  return createMediaLibraryOriginalAssetResponse(
    {
      ...input,
      mode: "open",
    },
    dependencies,
  );
}
