import { jsonError } from "@/lib/http/errors";
import { resolveCustomRoleAssignmentSummary } from "@/lib/tenant/custom-role-assignment-service";
import { requireAuthenticatedTenantContext } from "@/lib/tenant/member-management-route-utils";

export async function GET(request: Request) {
  try {
    const { supabase, tenantId, user } = await requireAuthenticatedTenantContext();
    const url = new URL(request.url);
    const data = await resolveCustomRoleAssignmentSummary({
      supabase,
      tenantId,
      userId: user.id,
      includeRevoked: url.searchParams.get("includeRevoked") === "1",
    });

    return Response.json(data, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
