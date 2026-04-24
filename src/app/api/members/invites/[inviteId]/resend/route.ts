import { HttpError, jsonError } from "@/lib/http/errors";
import { requireAuthenticatedTenantContext } from "@/lib/tenant/member-management-route-utils";
import { resendTenantMemberInvite } from "@/lib/tenant/member-management-service";
import { MANAGEABLE_MEMBERSHIP_ROLES, type ManageableMembershipRole } from "@/lib/tenant/permissions";

type RouteContext = {
  params: Promise<{
    inviteId: string;
  }>;
};

type ResendTenantInviteBody = {
  role?: string | null;
};

function isManageableRole(value: string): value is ManageableMembershipRole {
  return MANAGEABLE_MEMBERSHIP_ROLES.includes(value as ManageableMembershipRole);
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { inviteId } = await context.params;
    const { supabase, tenantId, user } = await requireAuthenticatedTenantContext();
    const body = (await request.json().catch(() => null)) as ResendTenantInviteBody | null;
    const requestedRole = String(body?.role ?? "").trim();

    if (requestedRole && !isManageableRole(requestedRole)) {
      throw new HttpError(400, "invalid_body", "A valid invite role is required.");
    }

    const result = await resendTenantMemberInvite({
      supabase,
      tenantId,
      userId: user.id,
      inviterEmail: user.email ?? "",
      inviteId,
      role: requestedRole ? requestedRole : null,
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
