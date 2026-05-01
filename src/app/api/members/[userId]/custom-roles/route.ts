import { HttpError, jsonError } from "@/lib/http/errors";
import { grantCustomRoleToMember } from "@/lib/tenant/custom-role-assignment-service";
import { requireAuthenticatedTenantContext } from "@/lib/tenant/member-management-route-utils";

type RouteContext = {
  params: Promise<{
    userId: string;
  }>;
};

type GrantCustomRoleBody = {
  roleId?: unknown;
  scopeType?: unknown;
  projectId?: unknown;
  workspaceId?: unknown;
  tenantId?: unknown;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { userId: targetUserId } = await context.params;
    const { supabase, tenantId, user } = await requireAuthenticatedTenantContext();
    const body = (await request.json().catch(() => null)) as GrantCustomRoleBody | null;
    const roleId = typeof body?.roleId === "string" ? body.roleId.trim() : "";
    const scopeType =
      typeof body?.scopeType === "string" ? body.scopeType.trim() : undefined;
    const projectId =
      typeof body?.projectId === "string" ? body.projectId.trim() : null;
    const workspaceId =
      typeof body?.workspaceId === "string" ? body.workspaceId.trim() : null;

    if (!targetUserId || !roleId || body?.tenantId !== undefined) {
      throw new HttpError(400, "invalid_body", "A valid custom role assignment payload is required.");
    }

    const result = await grantCustomRoleToMember({
      supabase,
      tenantId,
      actorUserId: user.id,
      targetUserId,
      roleId,
      scopeType: scopeType as "tenant" | "project" | "workspace" | undefined,
      projectId,
      workspaceId,
    });

    return Response.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return jsonError(error);
  }
}
