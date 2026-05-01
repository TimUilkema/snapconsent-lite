import { HttpError, jsonError } from "@/lib/http/errors";
import { revokeCustomRoleFromMember } from "@/lib/tenant/custom-role-assignment-service";
import { requireAuthenticatedTenantContext } from "@/lib/tenant/member-management-route-utils";

type RouteContext = {
  params: Promise<{
    userId: string;
    roleId: string;
  }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { userId: targetUserId, roleId } = await context.params;
    const { supabase, tenantId, user } = await requireAuthenticatedTenantContext();

    if (!targetUserId || !roleId) {
      throw new HttpError(400, "invalid_body", "A valid custom role assignment target is required.");
    }

    const result = await revokeCustomRoleFromMember({
      supabase,
      tenantId,
      actorUserId: user.id,
      targetUserId,
      roleId,
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
