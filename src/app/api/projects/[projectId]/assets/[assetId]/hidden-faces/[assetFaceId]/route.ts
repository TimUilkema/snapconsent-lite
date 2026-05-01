import { HttpError, jsonError } from "@/lib/http/errors";
import { hideAssetFace, restoreHiddenAssetFace } from "@/lib/matching/photo-face-linking";
import { loadWorkspaceScopedRow, requireWorkspaceCorrectionReviewMutationAccessForRow } from "@/lib/projects/project-workspace-request";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    projectId: string;
    assetId: string;
    assetFaceId: string;
  }>;
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
  const { projectId, assetId, assetFaceId } = await context.params;
  const assetRow = await loadWorkspaceScopedRow({
    supabase,
    tenantId,
    projectId,
    table: "assets",
    rowId: assetId,
    notFoundCode: "asset_not_found",
    notFoundMessage: "Asset not found.",
  });
  await requireWorkspaceCorrectionReviewMutationAccessForRow({
    supabase,
    tenantId,
    userId: user.id,
    projectId,
    table: "assets",
    rowId: assetId,
    notFoundCode: "asset_not_found",
    notFoundMessage: "Asset not found.",
  });
  return {
    supabase: createAdminClient(),
    tenantId,
    projectId,
    assetId,
    assetFaceId,
    workspaceId: assetRow.workspace_id,
    userId: user.id,
  };
}

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { supabase, tenantId, projectId, assetId, assetFaceId, workspaceId, userId } =
      await requireAuthAndScope(context);
    const result = await hideAssetFace({
      supabase,
      tenantId,
      projectId,
      workspaceId,
      assetId,
      assetFaceId,
      actorUserId: userId,
    });

    return Response.json(
      {
        ok: true,
        hidden: true,
        kind: result.kind,
        assetFaceId: result.assetFaceId,
        removedConsentId: result.removedConsentId,
        removedLinkSource: result.removedLinkSource,
      },
      { status: 200 },
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { supabase, tenantId, projectId, assetId, assetFaceId, workspaceId, userId } =
      await requireAuthAndScope(context);
    const result = await restoreHiddenAssetFace({
      supabase,
      tenantId,
      projectId,
      workspaceId,
      assetId,
      assetFaceId,
      actorUserId: userId,
    });

    return Response.json(
      {
        ok: true,
        restored: true,
        kind: result.kind,
        assetFaceId: result.assetFaceId,
      },
      { status: 200 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
