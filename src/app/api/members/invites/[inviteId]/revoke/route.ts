import { jsonError } from "@/lib/http/errors";
import { requireAuthenticatedTenantContext } from "@/lib/tenant/member-management-route-utils";
import { revokeTenantMemberInvite } from "@/lib/tenant/member-management-service";

type RouteContext = {
  params: Promise<{
    inviteId: string;
  }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { inviteId } = await context.params;
    const { supabase, tenantId, user } = await requireAuthenticatedTenantContext();
    const result = await revokeTenantMemberInvite({
      supabase,
      tenantId,
      userId: user.id,
      inviteId,
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
