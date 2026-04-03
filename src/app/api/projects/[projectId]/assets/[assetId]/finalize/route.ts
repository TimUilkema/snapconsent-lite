import { finalizeAsset } from "@/lib/assets/finalize-asset";
import { HttpError, jsonError } from "@/lib/http/errors";
import { getCurrentConsentHeadshotFanoutBoundary } from "@/lib/matching/auto-match-fanout-continuations";
import { enqueuePhotoUploadedJob } from "@/lib/matching/auto-match-jobs";
import { shouldEnqueuePhotoUploadedOnFinalize } from "@/lib/matching/auto-match-trigger-conditions";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    projectId: string;
    assetId: string;
  }>;
};

type FinalizeAssetBody = {
  consentIds?: string[];
};

export async function POST(request: Request, context: RouteContext) {
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

    const { projectId, assetId } = await context.params;
    const body = (await request.json().catch(() => null)) as FinalizeAssetBody | null;
    const consentIds = Array.isArray(body?.consentIds)
      ? Array.from(
          new Set(
            body.consentIds
              .filter((id) => typeof id === "string")
              .map((id) => id.trim())
              .filter((id) => id.length > 0),
          ),
        )
      : [];

    const finalizedAsset = await finalizeAsset({
      supabase,
      tenantId,
      projectId,
      assetId,
      consentIds,
    });

    if (shouldEnqueuePhotoUploadedOnFinalize(finalizedAsset.assetType)) {
      try {
        const boundary = await getCurrentConsentHeadshotFanoutBoundary(supabase, tenantId, projectId);
        await enqueuePhotoUploadedJob({
          tenantId,
          projectId,
          assetId: finalizedAsset.assetId,
          payload: {
            source: "photo_finalize",
            consent_ids: consentIds,
            boundarySnapshotAt: boundary.boundarySnapshotAt,
            boundaryConsentCreatedAt: boundary.boundaryConsentCreatedAt,
            boundaryConsentId: boundary.boundaryConsentId,
          },
        });
      } catch {
        // Primary upload flow must still succeed; reconcile backfills missed jobs.
      }
    }

    return Response.json({ ok: true }, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
