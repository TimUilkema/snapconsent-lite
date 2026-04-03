import { HttpError, jsonError } from "@/lib/http/errors";
import { getProjectMatchingProgress } from "@/lib/matching/project-matching-progress";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
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

  return { supabase, tenantId, projectId };
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { tenantId, projectId } = await requireAuthAndScope(context);
    const progress = await getProjectMatchingProgress(createAdminClient(), tenantId, projectId);
    return Response.json(progress, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
