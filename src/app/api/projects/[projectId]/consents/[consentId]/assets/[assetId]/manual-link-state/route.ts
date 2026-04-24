import { headers } from "next/headers";

import { HttpError, jsonError } from "@/lib/http/errors";
import { serializeManualPhotoLinkStateResponse } from "@/lib/matching/face-review-response";
import { getManualPhotoLinkState } from "@/lib/matching/consent-photo-matching";
import {
  assertWorkspaceScopedRowMatchesWorkspace,
  loadWorkspaceScopedRow,
  requireWorkspaceReviewAccessForRow,
} from "@/lib/projects/project-workspace-request";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    projectId: string;
    consentId: string;
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
    const { projectId, consentId, assetId } = await context.params;
    const consentRow = await loadWorkspaceScopedRow({
      supabase,
      tenantId,
      projectId,
      table: "consents",
      rowId: consentId,
      notFoundCode: "consent_not_found",
      notFoundMessage: "Consent not found.",
    });
    await requireWorkspaceReviewAccessForRow({
      supabase,
      tenantId,
      userId: user.id,
      projectId,
      table: "consents",
      rowId: consentId,
      notFoundCode: "consent_not_found",
      notFoundMessage: "Consent not found.",
    });
    const assetRow = await loadWorkspaceScopedRow({
      supabase,
      tenantId,
      projectId,
      table: "assets",
      rowId: assetId,
      notFoundCode: "asset_not_found",
      notFoundMessage: "Asset not found.",
    });
    assertWorkspaceScopedRowMatchesWorkspace(assetRow, consentRow.workspace_id, "asset_not_found", "Asset not found.");
    const admin = createAdminClient();
    const state = await getManualPhotoLinkState({
      supabase: admin,
      tenantId,
      projectId,
      consentId,
      workspaceId: consentRow.workspace_id,
      assetId,
    });
    const requestHeaders = await headers();
    const requestHostHeader = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");

    return Response.json(
      await serializeManualPhotoLinkStateResponse({
        supabase: admin,
        tenantId,
        projectId,
        state,
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
