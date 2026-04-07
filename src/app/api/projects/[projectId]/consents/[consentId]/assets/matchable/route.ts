import { headers } from "next/headers";

import { resolveSignedAssetDisplayUrlsForAssets } from "@/lib/assets/sign-asset-thumbnails";
import { HttpError, jsonError } from "@/lib/http/errors";
import { listMatchableProjectPhotosForConsent } from "@/lib/matching/consent-photo-matching";
import { createAdminClient } from "@/lib/supabase/admin";
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

function parsePage(searchParams: URLSearchParams) {
  const raw = searchParams.get("page");
  if (!raw) {
    return null;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return Math.floor(parsed);
}

function parseMode(searchParams: URLSearchParams) {
  const mode = String(searchParams.get("mode") ?? "").trim().toLowerCase();
  if (mode === "likely") {
    return "likely";
  }

  return "default";
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
    const result = await listMatchableProjectPhotosForConsent({
      supabase: createAdminClient(),
      tenantId,
      projectId,
      consentId,
      query: url.searchParams.get("q"),
      limit: parseLimit(url.searchParams),
      page: parsePage(url.searchParams),
      mode: parseMode(url.searchParams),
    });

    const requestHeaders = await headers();
    const requestHostHeader = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");

    const thumbnailMap = await resolveSignedAssetDisplayUrlsForAssets(supabase, result.assets, {
      tenantId,
      projectId,
      use: "thumbnail",
      fallback: "transform",
      enqueueMissingDerivative: true,
    });
    const previewMap = await resolveSignedAssetDisplayUrlsForAssets(supabase, result.assets, {
      tenantId,
      projectId,
      use: "preview",
      fallback: "transform",
    });

    return Response.json(
      {
        assets: result.assets.map((asset) => {
          const thumbnail = thumbnailMap.get(asset.id) ?? { url: null, state: "unavailable" as const };
          const preview = previewMap.get(asset.id) ?? { url: null, state: "unavailable" as const };
          return {
            id: asset.id,
            originalFilename: asset.original_filename,
            status: asset.status,
            fileSizeBytes: asset.file_size_bytes,
            createdAt: asset.created_at,
            uploadedAt: asset.uploaded_at,
            isLinked: asset.isLinked,
            candidateConfidence: asset.candidate_confidence,
            candidateLastScoredAt: asset.candidate_last_scored_at,
            candidateMatcherVersion: asset.candidate_matcher_version,
            candidateAssetFaceId: asset.candidate_asset_face_id,
            candidateFaceRank: asset.candidate_face_rank,
            thumbnailUrl: thumbnail.url
              ? resolveLoopbackStorageUrlForHostHeader(thumbnail.url, requestHostHeader)
              : null,
            thumbnailState: thumbnail.state,
            previewUrl: preview.url
              ? resolveLoopbackStorageUrlForHostHeader(preview.url, requestHostHeader)
              : null,
            previewState: preview.state,
          };
        }),
        page: result.page,
        pageSize: result.pageSize,
        hasNextPage: result.hasNextPage,
        hasPreviousPage: result.hasPreviousPage,
      },
      { status: 200 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
