import { jsonError } from "@/lib/http/errors";
import { requireAuthenticatedTenantContext } from "@/lib/tenant/member-management-route-utils";
import { getMemberEffectiveAccessSummary } from "@/lib/tenant/member-effective-access-service";

type RouteContext = {
  params: Promise<{
    userId: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { userId: targetUserId } = await context.params;
    const { supabase, tenantId, user } = await requireAuthenticatedTenantContext();
    const summary = await getMemberEffectiveAccessSummary({
      supabase,
      tenantId,
      actorUserId: user.id,
      targetUserId,
    });

    return Response.json({ summary }, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
