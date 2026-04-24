import { HttpError, jsonError } from "@/lib/http/errors";
import { requireAuthenticatedTenantContext } from "@/lib/tenant/member-management-route-utils";
import { removeTenantMember, updateTenantMemberRole } from "@/lib/tenant/member-management-service";
import { MANAGEABLE_MEMBERSHIP_ROLES, type ManageableMembershipRole } from "@/lib/tenant/permissions";

type RouteContext = {
  params: Promise<{
    userId: string;
  }>;
};

type UpdateTenantMemberBody = {
  role?: string;
};

function isManageableRole(value: string): value is ManageableMembershipRole {
  return MANAGEABLE_MEMBERSHIP_ROLES.includes(value as ManageableMembershipRole);
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { userId: targetUserId } = await context.params;
    const { supabase, tenantId, user } = await requireAuthenticatedTenantContext();
    const body = (await request.json().catch(() => null)) as UpdateTenantMemberBody | null;
    const role = String(body?.role ?? "").trim();

    if (!isManageableRole(role)) {
      throw new HttpError(400, "invalid_body", "A valid membership role is required.");
    }

    const member = await updateTenantMemberRole({
      supabase,
      tenantId,
      userId: user.id,
      targetUserId,
      role,
    });

    return Response.json({ member }, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { userId: targetUserId } = await context.params;
    const { supabase, tenantId, user } = await requireAuthenticatedTenantContext();

    await removeTenantMember({
      supabase,
      tenantId,
      userId: user.id,
      targetUserId,
    });

    return Response.json({ ok: true }, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
