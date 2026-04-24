import { HttpError, jsonError } from "@/lib/http/errors";
import { createTenantMemberInvite } from "@/lib/tenant/member-management-service";
import { requireAuthenticatedTenantContext } from "@/lib/tenant/member-management-route-utils";
import { MANAGEABLE_MEMBERSHIP_ROLES, type ManageableMembershipRole } from "@/lib/tenant/permissions";

type CreateTenantInviteBody = {
  email?: string;
  role?: string;
};

function isManageableRole(value: string): value is ManageableMembershipRole {
  return MANAGEABLE_MEMBERSHIP_ROLES.includes(value as ManageableMembershipRole);
}

export async function POST(request: Request) {
  try {
    const { supabase, tenantId, user } = await requireAuthenticatedTenantContext();
    const body = (await request.json().catch(() => null)) as CreateTenantInviteBody | null;
    const email = String(body?.email ?? "").trim();
    const role = String(body?.role ?? "").trim();

    if (!email || !isManageableRole(role)) {
      throw new HttpError(400, "invalid_body", "A valid invite email and role are required.");
    }

    const result = await createTenantMemberInvite({
      supabase,
      tenantId,
      userId: user.id,
      inviterEmail: user.email ?? "",
      email,
      role,
    });

    return Response.json(result, {
      status: result.outcome === "already_member" ? 200 : 201,
    });
  } catch (error) {
    return jsonError(error);
  }
}
