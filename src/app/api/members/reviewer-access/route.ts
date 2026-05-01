import { jsonError } from "@/lib/http/errors";
import { listReviewerAccessSummary } from "@/lib/tenant/reviewer-access-service";
import { requireAuthenticatedTenantContext } from "@/lib/tenant/member-management-route-utils";

export async function GET() {
  try {
    const { supabase, tenantId, user } = await requireAuthenticatedTenantContext();
    const data = await listReviewerAccessSummary({
      supabase,
      tenantId,
      userId: user.id,
    });

    return Response.json(data, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
