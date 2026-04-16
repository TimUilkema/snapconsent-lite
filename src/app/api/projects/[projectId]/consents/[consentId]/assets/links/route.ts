import { headers } from "next/headers";

import { signFaceDerivativeUrls } from "@/lib/assets/sign-face-derivatives";
import { resolveSignedAssetDisplayUrlsForAssets } from "@/lib/assets/sign-asset-thumbnails";
import { HttpError, jsonError } from "@/lib/http/errors";
import { loadFaceImageDerivativesForFaceIds } from "@/lib/matching/face-materialization";
import {
  listLinkedPhotosForConsent,
  manualLinkPhotoToConsent,
  manualUnlinkPhotoFromConsent,
} from "@/lib/matching/consent-photo-matching";
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

type ModifyLinksBody = {
  assetId?: string;
  assetFaceId?: string;
  mode?: "face" | "asset_fallback";
  forceReplace?: boolean;
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
  return {
    supabase: createAdminClient(),
    tenantId,
    projectId,
    consentId,
    userId: user.id,
  };
}

function parseLinkBody(body: ModifyLinksBody | null) {
  return {
    assetId: String(body?.assetId ?? "").trim(),
    assetFaceId: String(body?.assetFaceId ?? "").trim() || null,
    mode: body?.mode === "face" || body?.mode === "asset_fallback" ? body.mode : "face",
    forceReplace: body?.forceReplace === true,
  };
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
    const thumbnailMap = await resolveSignedAssetDisplayUrlsForAssets(supabase, assets, {
      tenantId,
      projectId,
      use: "thumbnail",
      fallback: "original",
      enqueueMissingDerivative: true,
    });
    const previewMap = await resolveSignedAssetDisplayUrlsForAssets(supabase, assets, {
      tenantId,
      projectId,
      use: "preview",
      fallback: "original",
    });
    const linkedFaceIds = assets.map((asset) => asset.asset_face_id).filter((value): value is string => Boolean(value));
    const faceDerivativeRows = await loadFaceImageDerivativesForFaceIds(
      supabase,
      tenantId,
      projectId,
      linkedFaceIds,
    );
    const linkedFaceCropMap = await signFaceDerivativeUrls(Array.from(faceDerivativeRows.values()));

    return Response.json(
      {
        assets: assets.map((asset) => {
          const thumbnail = thumbnailMap.get(asset.id) ?? { url: null, state: "unavailable" as const };
          const preview = previewMap.get(asset.id) ?? { url: null, state: "unavailable" as const };
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
            linkMode: asset.link_mode,
            assetFaceId: asset.asset_face_id,
            faceRank: asset.face_rank,
            detectedFaceCount: asset.detected_face_count,
            linkedFaceCropUrl:
              asset.asset_face_id && linkedFaceCropMap.get(asset.asset_face_id)
                ? resolveLoopbackStorageUrlForHostHeader(
                    linkedFaceCropMap.get(asset.asset_face_id) ?? "",
                    requestHostHeader,
                  )
                : null,
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
      },
      { status: 200 },
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { supabase, tenantId, projectId, consentId, userId } = await requireAuthAndScope(context);
    const body = (await request.json().catch(() => null)) as ModifyLinksBody | null;
    const parsed = parseLinkBody(body);
    if (!parsed.assetId) {
      throw new HttpError(400, "invalid_body", "Asset ID is required.");
    }

    const result = await manualLinkPhotoToConsent({
      supabase,
      tenantId,
      projectId,
      consentId,
      actorUserId: userId,
      assetId: parsed.assetId,
      assetFaceId: parsed.assetFaceId,
      mode: parsed.mode,
      forceReplace: parsed.forceReplace,
    });

    if (result.kind === "manual_conflict") {
      return Response.json(
        {
          ok: false,
          error: "manual_conflict",
          message: "This face is already manually assigned to another consent.",
          canForceReplace: result.canForceReplace,
          currentAssignee: result.currentAssignee,
        },
        { status: 409 },
      );
    }

    return Response.json(
      {
        ok: true,
        linked: true,
        mode: result.mode,
        assetFaceId: result.assetFaceId,
        replacedConsentId: "replacedConsentId" in result ? result.replacedConsentId : null,
      },
      { status: 200 },
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { supabase, tenantId, projectId, consentId, userId } = await requireAuthAndScope(context);
    const body = (await request.json().catch(() => null)) as ModifyLinksBody | null;
    const parsed = parseLinkBody(body);
    if (!parsed.assetId) {
      throw new HttpError(400, "invalid_body", "Asset ID is required.");
    }

    const result = await manualUnlinkPhotoFromConsent({
      supabase,
      tenantId,
      projectId,
      consentId,
      actorUserId: userId,
      assetId: parsed.assetId,
      assetFaceId: parsed.assetFaceId,
      mode: parsed.mode,
    });

    return Response.json(
      {
        ok: true,
        unlinked: true,
        mode: result.mode,
        assetFaceId: result.assetFaceId,
      },
      { status: 200 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
