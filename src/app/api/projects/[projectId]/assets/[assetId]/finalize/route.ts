import { finalizeAsset } from "@/lib/assets/finalize-asset";
import { queueProjectAssetPostFinalizeProcessing } from "@/lib/assets/post-finalize-processing";
import { HttpError, jsonError } from "@/lib/http/errors";
import { loadWorkspaceScopedRow, requireWorkspaceCaptureMutationAccessForRow } from "@/lib/projects/project-workspace-request";
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

    const assetRow = await loadWorkspaceScopedRow({
      supabase,
      tenantId,
      projectId,
      table: "assets",
      rowId: assetId,
      notFoundCode: "asset_not_found",
      notFoundMessage: "Asset not found.",
    });
    await requireWorkspaceCaptureMutationAccessForRow({
      supabase,
      tenantId,
      projectId,
      table: "assets",
      rowId: assetId,
      userId: user.id,
      notFoundCode: "asset_not_found",
      notFoundMessage: "Asset not found.",
      capabilityKey: "capture.upload_assets",
    });

    const finalizedAsset = await finalizeAsset({
      supabase,
      tenantId,
      projectId,
      workspaceId: assetRow.workspace_id,
      assetId,
      consentIds,
    });

    await queueProjectAssetPostFinalizeProcessing({
        supabase,
        tenantId,
        projectId,
        workspaceId: assetRow.workspace_id,
        assetId: finalizedAsset.assetId,
      assetType: finalizedAsset.assetType,
      consentIds,
      source: "photo_finalize",
    });

    return Response.json({ ok: true }, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
