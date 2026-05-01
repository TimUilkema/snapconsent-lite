import { jsonError } from "@/lib/http/errors";
import {
  grantTenantWideReviewerAccess,
  revokeTenantWideReviewerAccess,
} from "@/lib/tenant/reviewer-access-service";
import { requireAuthenticatedTenantContext } from "@/lib/tenant/member-management-route-utils";

type RouteContext = {
  params: Promise<{
    userId: string;
  }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const { userId: targetUserId } = await context.params;
    const { supabase, tenantId, user } = await requireAuthenticatedTenantContext();
    const result = await grantTenantWideReviewerAccess({
      supabase,
      tenantId,
      actorUserId: user.id,
      targetUserId,
    });

    return Response.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { userId: targetUserId } = await context.params;
    const { supabase, tenantId, user } = await requireAuthenticatedTenantContext();
    const result = await revokeTenantWideReviewerAccess({
      supabase,
      tenantId,
      actorUserId: user.id,
      targetUserId,
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
