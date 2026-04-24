import { headers } from "next/headers";

import { HttpError, jsonError } from "@/lib/http/errors";
import { getAssetPreviewFaces } from "@/lib/matching/asset-preview-linking";
import { loadWorkspaceScopedRow, requireWorkspaceReviewAccessForRow } from "@/lib/projects/project-workspace-request";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    projectId: string;
    assetId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
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
    const assetRow = await loadWorkspaceScopedRow({
      supabase,
      tenantId,
      projectId,
      table: "assets",
      rowId: assetId,
      notFoundCode: "asset_not_found",
      notFoundMessage: "Asset not found.",
    });
    await requireWorkspaceReviewAccessForRow({
      supabase,
      tenantId,
      userId: user.id,
      projectId,
      table: "assets",
      rowId: assetId,
      notFoundCode: "asset_not_found",
      notFoundMessage: "Asset not found.",
    });

    const requestHeaders = await headers();
    const requestHostHeader = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");

    return Response.json(
      await getAssetPreviewFaces({
        supabase: createAdminClient(),
        tenantId,
        projectId,
        assetId,
        workspaceId: assetRow.workspace_id,
        requestHostHeader,
      }),
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, max-age=0",
        },
      },
    );
  } catch (error) {
    return jsonError(error);
  }
}
