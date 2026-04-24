import { HttpError, jsonError } from "@/lib/http/errors";
import { prepareFaceReviewSession } from "@/lib/matching/face-review-sessions";
import { loadWorkspaceScopedRow, requireWorkspaceReviewMutationAccessForRow } from "@/lib/projects/project-workspace-request";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    projectId: string;
    consentId: string;
  }>;
};

type PrepareReviewSessionBody = {
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
  const consentRow = await loadWorkspaceScopedRow({
    supabase,
    tenantId,
    projectId,
    table: "consents",
    rowId: consentId,
    notFoundCode: "consent_not_found",
    notFoundMessage: "Consent not found.",
  });
  await requireWorkspaceReviewMutationAccessForRow({
    supabase,
    tenantId,
    userId: user.id,
    projectId,
    table: "consents",
    rowId: consentId,
    notFoundCode: "consent_not_found",
    notFoundMessage: "Consent not found.",
  });

  return {
    supabase: createAdminClient(),
    tenantId,
    projectId,
    consentId,
    workspaceId: consentRow.workspace_id,
    userId: user.id,
  };
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { supabase, tenantId, projectId, consentId, workspaceId, userId } = await requireAuthAndScope(context);
    const body = (await request.json().catch(() => null)) as PrepareReviewSessionBody | null;
    const result = await prepareFaceReviewSession({
      supabase,
      tenantId,
      projectId,
      consentId,
      workspaceId,
      actorUserId: userId,
      assetIds: Array.isArray(body?.assetIds) ? body.assetIds : [],
    });

    return Response.json(
      {
        session: result.session,
      },
      { status: 200 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
