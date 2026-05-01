import { HttpError, jsonError } from "@/lib/http/errors";
import {
  grantProjectReviewerAccess,
  listProjectReviewerAssignments,
} from "@/lib/tenant/reviewer-access-service";
import { requireAuthenticatedTenantContext } from "@/lib/tenant/member-management-route-utils";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

type GrantProjectReviewerAccessBody = {
  userId?: string;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    const { supabase, tenantId, user } = await requireAuthenticatedTenantContext();
    const data = await listProjectReviewerAssignments({
      supabase,
      tenantId,
      userId: user.id,
      projectId,
    });

    return Response.json(data, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { projectId } = await context.params;
    const { supabase, tenantId, user } = await requireAuthenticatedTenantContext();
    const body = (await request.json().catch(() => null)) as GrantProjectReviewerAccessBody | null;
    const targetUserId = String(body?.userId ?? "").trim();
    if (!targetUserId) {
      throw new HttpError(400, "invalid_body", "A reviewer user id is required.");
    }

    const result = await grantProjectReviewerAccess({
      supabase,
      tenantId,
      actorUserId: user.id,
      targetUserId,
      projectId,
    });

    return Response.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return jsonError(error);
  }
}
