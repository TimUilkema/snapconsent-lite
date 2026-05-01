import { HttpError, jsonError } from "@/lib/http/errors";
import { revokeCustomRoleAssignment } from "@/lib/tenant/custom-role-assignment-service";
import { requireAuthenticatedTenantContext } from "@/lib/tenant/member-management-route-utils";

type RouteContext = {
  params: Promise<{
    assignmentId: string;
  }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { assignmentId } = await context.params;
    const { supabase, tenantId, user } = await requireAuthenticatedTenantContext();

    if (!assignmentId) {
      throw new HttpError(400, "invalid_body", "A valid custom role assignment target is required.");
    }

    const result = await revokeCustomRoleAssignment({
      supabase,
      tenantId,
      actorUserId: user.id,
      assignmentId,
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
