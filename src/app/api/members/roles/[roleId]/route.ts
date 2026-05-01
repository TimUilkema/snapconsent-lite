import { HttpError, jsonError } from "@/lib/http/errors";
import { updateCustomRole, type CustomRoleInput } from "@/lib/tenant/custom-role-service";
import { requireAuthenticatedTenantContext } from "@/lib/tenant/member-management-route-utils";

type RouteContext = {
  params: Promise<{
    roleId: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { roleId } = await context.params;
    const { supabase, tenantId, user } = await requireAuthenticatedTenantContext();
    const body = (await request.json().catch(() => null)) as CustomRoleInput | null;

    if (!roleId || !body || typeof body !== "object") {
      throw new HttpError(400, "invalid_body", "A valid custom role payload is required.");
    }

    const role = await updateCustomRole({
      supabase,
      tenantId,
      userId: user.id,
      roleId,
      body,
    });

    return Response.json({ role }, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
