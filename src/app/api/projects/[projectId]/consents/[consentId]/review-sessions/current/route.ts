import { headers } from "next/headers";

import { HttpError, jsonError } from "@/lib/http/errors";
import { serializeFaceReviewSessionResponse } from "@/lib/matching/face-review-response";
import { getCurrentFaceReviewSession } from "@/lib/matching/face-review-sessions";
import { loadWorkspaceScopedRow, requireWorkspaceReviewAccessForRow } from "@/lib/projects/project-workspace-request";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    projectId: string;
    consentId: string;
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

  return {
    supabase: createAdminClient(),
    tenantId,
    projectId,
    consentId,
    workspaceId: consentRow.workspace_id,
    userId: user.id,
  };
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { supabase, tenantId, projectId, consentId, workspaceId, userId } = await requireAuthAndScope(context);
    const readModel = await getCurrentFaceReviewSession({
      supabase,
      tenantId,
      projectId,
      consentId,
      workspaceId,
      actorUserId: userId,
    });
    const requestHeaders = await headers();
    const requestHostHeader = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");

    return Response.json(await serializeFaceReviewSessionResponse(readModel, tenantId, projectId, requestHostHeader), {
      status: 200,
      headers: {
        "Cache-Control": "no-store, max-age=0",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
