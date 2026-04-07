import { HttpError, jsonError } from "@/lib/http/errors";
import { applyFaceReviewSessionItemAction } from "@/lib/matching/face-review-sessions";
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
  return {
    supabase: createAdminClient(),
    tenantId,
    projectId,
    consentId,
    sessionId,
    itemId,
    userId: user.id,
  };
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { supabase, tenantId, projectId, consentId, sessionId, itemId, userId } = await requireAuthAndScope(context);
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
