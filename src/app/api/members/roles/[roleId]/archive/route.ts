import { HttpError, jsonError } from "@/lib/http/errors";
import { archiveCustomRole } from "@/lib/tenant/custom-role-service";
import { requireAuthenticatedTenantContext } from "@/lib/tenant/member-management-route-utils";

type RouteContext = {
  params: Promise<{
    roleId: string;
  }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { roleId } = await context.params;
    const { supabase, tenantId, user } = await requireAuthenticatedTenantContext();

    if (!roleId) {
      throw new HttpError(400, "invalid_body", "A valid custom role id is required.");
    }

    const result = await archiveCustomRole({
      supabase,
      tenantId,
      userId: user.id,
      roleId,
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
