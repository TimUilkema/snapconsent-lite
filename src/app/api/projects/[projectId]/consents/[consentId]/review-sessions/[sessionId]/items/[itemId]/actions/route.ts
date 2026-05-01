import { HttpError, jsonError } from "@/lib/http/errors";
import { applyFaceReviewSessionItemAction } from "@/lib/matching/face-review-sessions";
import {
  assertWorkspaceScopedRowMatchesWorkspace,
  loadWorkspaceScopedRow,
  requireWorkspaceCorrectionReviewMutationAccessForRow,
} from "@/lib/projects/project-workspace-request";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    projectId: string;
    consentId: string;
    sessionId: string;
    itemId: string;
  }>;
};

type ActionBody = {
  action?: "link_face" | "suppress_face";
  assetFaceId?: string;
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
  const { projectId, consentId, sessionId, itemId } = await context.params;
  const consentRow = await loadWorkspaceScopedRow({
    supabase,
    tenantId,
    projectId,
    table: "consents",
    rowId: consentId,
    notFoundCode: "consent_not_found",
    notFoundMessage: "Consent not found.",
  });
  await requireWorkspaceCorrectionReviewMutationAccessForRow({
    supabase,
    tenantId,
    userId: user.id,
    projectId,
    table: "consents",
    rowId: consentId,
    notFoundCode: "consent_not_found",
    notFoundMessage: "Consent not found.",
  });
  const sessionRow = await loadWorkspaceScopedRow({
    supabase,
    tenantId,
    projectId,
    table: "face_review_sessions",
    rowId: sessionId,
    notFoundCode: "review_session_not_found",
    notFoundMessage: "Review session not found.",
  });
  const itemRow = await loadWorkspaceScopedRow({
    supabase,
    tenantId,
    projectId,
    table: "face_review_session_items",
    rowId: itemId,
    notFoundCode: "review_session_not_found",
    notFoundMessage: "Review session item not found.",
  });
  assertWorkspaceScopedRowMatchesWorkspace(
    sessionRow,
    consentRow.workspace_id,
    "review_session_not_found",
    "Review session not found.",
  );
  assertWorkspaceScopedRowMatchesWorkspace(
    itemRow,
    consentRow.workspace_id,
    "review_session_not_found",
    "Review session item not found.",
  );

  return {
    supabase: createAdminClient(),
    tenantId,
    projectId,
    consentId,
    workspaceId: consentRow.workspace_id,
    sessionId,
    itemId,
    userId: user.id,
  };
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { supabase, tenantId, projectId, consentId, workspaceId, sessionId, itemId, userId } = await requireAuthAndScope(context);
    const body = (await request.json().catch(() => null)) as ActionBody | null;
    const action = body?.action === "suppress_face" ? "suppress_face" : body?.action === "link_face" ? "link_face" : null;
    if (!action) {
      throw new HttpError(400, "invalid_body", "A valid review action is required.");
    }

    const result = await applyFaceReviewSessionItemAction({
      supabase,
      tenantId,
      projectId,
      consentId,
      workspaceId,
      actorUserId: userId,
      sessionId,
      itemId,
      action,
      assetFaceId: String(body?.assetFaceId ?? "").trim() || null,
      forceReplace: body?.forceReplace === true,
    });

    return Response.json(
      {
        ok: true,
        item: result.item,
        session: result.session,
      },
      { status: 200 },
    );
  } catch (error) {
    if (
      error instanceof HttpError &&
      error.code === "manual_conflict" &&
      typeof (error as { canForceReplace?: unknown }).canForceReplace === "boolean"
    ) {
      const conflictError = error as HttpError & {
        canForceReplace: boolean;
        currentAssignee?: {
          consentId: string;
          fullName: string | null;
          email: string | null;
          linkSource: "manual" | "auto";
        } | null;
      };

      return Response.json(
        {
          ok: false,
          error: "manual_conflict",
          message: conflictError.message,
          canForceReplace: conflictError.canForceReplace,
          currentAssignee: conflictError.currentAssignee ?? null,
        },
        { status: 409 },
      );
    }

    return jsonError(error);
  }
}
