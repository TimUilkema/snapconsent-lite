import { HttpError, jsonError } from "@/lib/http/errors";
import { getProjectMatchingProgress } from "@/lib/matching/project-matching-progress";
import { resolveSelectedWorkspaceForRequest } from "@/lib/projects/project-workspace-request";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { resolveWorkspacePermissions } from "@/lib/tenant/permissions";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

async function requireAuthAndScope(context: RouteContext) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    throw new HttpError(401, "unauthenticated", "Authentication required.");
  }

  const tenantId = await resolveTenantId(supabase);
  if (!tenantId) {
    throw new HttpError(403, "no_tenant_membership", "Tenant membership is required.");
  }

  const { projectId } = await context.params;

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (projectError) {
    throw new HttpError(500, "project_lookup_failed", "Unable to load project.");
  }

  if (!project) {
    throw new HttpError(404, "project_not_found", "Project not found.");
  }

  return { supabase, tenantId, projectId, userId: user.id };
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId, projectId, userId, supabase } = await requireAuthAndScope(context);
    const workspace = await resolveSelectedWorkspaceForRequest({
      supabase,
      tenantId,
      userId,
      projectId,
      requestedWorkspaceId: new URL(request.url).searchParams.get("workspaceId"),
    });
    const permissions = await resolveWorkspacePermissions(
      supabase,
      tenantId,
      userId,
      projectId,
      workspace.id,
    );

    if (!permissions.canCaptureProjects && !permissions.canReviewProjects) {
      throw new HttpError(403, "workspace_read_forbidden", "Project workspace access is forbidden.");
    }

    const progress = await getProjectMatchingProgress(createAdminClient(), tenantId, projectId, workspace.id);
    return Response.json(progress, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
