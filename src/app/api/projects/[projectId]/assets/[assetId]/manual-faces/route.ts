import { HttpError, jsonError } from "@/lib/http/errors";
import { createManualAssetFace } from "@/lib/matching/manual-asset-faces";
import { loadWorkspaceScopedRow, requireWorkspaceReviewMutationAccessForRow } from "@/lib/projects/project-workspace-request";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    projectId: string;
    assetId: string;
  }>;
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
    const body = (await request.json().catch(() => null)) as {
      faceBoxNormalized?: {
        x_min?: unknown;
        y_min?: unknown;
        x_max?: unknown;
        y_max?: unknown;
      } | null;
    } | null;

    if (!body?.faceBoxNormalized) {
      throw new HttpError(400, "invalid_body", "Invalid manual face request body.");
    }

    const { projectId, assetId } = await context.params;
    await loadWorkspaceScopedRow({
      supabase,
      tenantId,
      projectId,
      table: "assets",
      rowId: assetId,
      notFoundCode: "asset_not_found",
      notFoundMessage: "Asset not found.",
    });
    await requireWorkspaceReviewMutationAccessForRow({
      supabase,
      tenantId,
      userId: user.id,
      projectId,
      table: "assets",
      rowId: assetId,
      notFoundCode: "asset_not_found",
      notFoundMessage: "Asset not found.",
    });

    const result = await createManualAssetFace({
      supabase: createAdminClient(),
      tenantId,
      projectId,
      assetId,
      actorUserId: user.id,
      faceBoxNormalized: {
        x_min: Number(body.faceBoxNormalized.x_min),
        y_min: Number(body.faceBoxNormalized.y_min),
        x_max: Number(body.faceBoxNormalized.x_max),
        y_max: Number(body.faceBoxNormalized.y_max),
      },
    });

    return Response.json(
      {
        ok: true,
        created: result.created,
        assetId: result.assetId,
        materializationId: result.materializationId,
        assetFaceId: result.assetFaceId,
        faceRank: result.faceRank,
        faceSource: result.faceSource,
      },
      { status: 200 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
