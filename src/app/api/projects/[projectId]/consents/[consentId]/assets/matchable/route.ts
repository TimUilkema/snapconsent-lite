import { headers } from "next/headers";

import { signThumbnailUrlsForAssets } from "@/lib/assets/sign-asset-thumbnails";
import { HttpError, jsonError } from "@/lib/http/errors";
import { listMatchableProjectPhotosForConsent } from "@/lib/matching/consent-photo-matching";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";
import { resolveLoopbackStorageUrlForHostHeader } from "@/lib/url/resolve-loopback-storage-url";

type RouteContext = {
  params: Promise<{
    projectId: string;
    consentId: string;
  }>;
};

function parseLimit(searchParams: URLSearchParams) {
  const raw = searchParams.get("limit");
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.floor(parsed);
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      throw new HttpError(401, "unauthenticated", "Authentication required.");
    }

    const tenantId = await resolveTenantId(supabase);
    if (!tenantId) {
      throw new HttpError(403, "no_tenant_membership", "Tenant membership is required.");
    }

    const { projectId, consentId } = await context.params;
    const url = new URL(request.url);
    const assets = await listMatchableProjectPhotosForConsent({
      supabase,
      tenantId,
      projectId,
      consentId,
      query: url.searchParams.get("q"),
      limit: parseLimit(url.searchParams),
    });

    const requestHeaders = await headers();
    const requestHostHeader = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");

    const thumbnailMap = await signThumbnailUrlsForAssets(supabase, assets);

    return Response.json(
      {
        assets: assets.map((asset) => {
          const signedUrl = thumbnailMap.get(asset.id) ?? null;
          return {
            id: asset.id,
            originalFilename: asset.original_filename,
            status: asset.status,
            fileSizeBytes: asset.file_size_bytes,
            createdAt: asset.created_at,
            uploadedAt: asset.uploaded_at,
            isLinked: asset.isLinked,
            thumbnailUrl: signedUrl
              ? resolveLoopbackStorageUrlForHostHeader(signedUrl, requestHostHeader)
              : null,
          };
        }),
      },
      { status: 200 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
