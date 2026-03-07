import { headers } from "next/headers";

import { signThumbnailUrlsForAssets } from "@/lib/assets/sign-asset-thumbnails";
import { HttpError, jsonError } from "@/lib/http/errors";
import {
  linkPhotosToConsent,
  listLinkedPhotosForConsent,
  unlinkPhotosFromConsent,
} from "@/lib/matching/consent-photo-matching";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";
import { resolveLoopbackStorageUrlForHostHeader } from "@/lib/url/resolve-loopback-storage-url";

type RouteContext = {
  params: Promise<{
    projectId: string;
    consentId: string;
  }>;
};

type ModifyLinksBody = {
  assetIds?: string[];
};

async function requireAuthAndScope(context: RouteContext) {
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
  return { supabase, tenantId, projectId, consentId };
}

function parseAssetIdsFromBody(body: ModifyLinksBody | null) {
  return Array.isArray(body?.assetIds)
    ? body.assetIds.filter((assetId) => typeof assetId === "string").map((assetId) => assetId.trim())
    : [];
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { supabase, tenantId, projectId, consentId } = await requireAuthAndScope(context);

    const assets = await listLinkedPhotosForConsent({
      supabase,
      tenantId,
      projectId,
      consentId,
    });

    const requestHeaders = await headers();
    const requestHostHeader = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
    const thumbnailMap = await signThumbnailUrlsForAssets(supabase, assets, {
      width: 240,
      height: 240,
    });

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
            archivedAt: asset.archived_at,
            linkCreatedAt: asset.link_created_at,
            linkSource: asset.link_source,
            matchConfidence: asset.match_confidence,
            matchedAt: asset.matched_at,
            reviewedAt: asset.reviewed_at,
            reviewedBy: asset.reviewed_by,
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

export async function POST(request: Request, context: RouteContext) {
  try {
    const { supabase, tenantId, projectId, consentId } = await requireAuthAndScope(context);
    const body = (await request.json().catch(() => null)) as ModifyLinksBody | null;
    const assetIds = parseAssetIdsFromBody(body);

    const result = await linkPhotosToConsent({
      supabase,
      tenantId,
      projectId,
      consentId,
      assetIds,
    });

    return Response.json({ ok: true, linkedCount: result.linkedCount }, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { supabase, tenantId, projectId, consentId } = await requireAuthAndScope(context);
    const body = (await request.json().catch(() => null)) as ModifyLinksBody | null;
    const assetIds = parseAssetIdsFromBody(body);

    const result = await unlinkPhotosFromConsent({
      supabase,
      tenantId,
      projectId,
      consentId,
      assetIds,
    });

    return Response.json({ ok: true, unlinkedCount: result.unlinkedCount }, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
