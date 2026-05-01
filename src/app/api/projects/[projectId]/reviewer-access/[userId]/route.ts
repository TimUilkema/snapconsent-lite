import { jsonError } from "@/lib/http/errors";
import { revokeProjectReviewerAccess } from "@/lib/tenant/reviewer-access-service";
import { requireAuthenticatedTenantContext } from "@/lib/tenant/member-management-route-utils";

type RouteContext = {
  params: Promise<{
    projectId: string;
    userId: string;
  }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { projectId, userId: targetUserId } = await context.params;
    const { supabase, tenantId, user } = await requireAuthenticatedTenantContext();
    const result = await revokeProjectReviewerAccess({
      supabase,
      tenantId,
      actorUserId: user.id,
      targetUserId,
      projectId,
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
