import { handleWorkspaceWorkflowTransitionPost } from "@/lib/projects/project-workflow-route-handlers";
import { applyWorkspaceWorkflowTransition } from "@/lib/projects/project-workflow-service";
import { requireWorkspaceCaptureAccessForRequest, requireWorkspaceReviewAccessForRequest } from "@/lib/projects/project-workspace-request";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    projectId: string;
    workspaceId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  return handleWorkspaceWorkflowTransitionPost(request, context, "needs_changes", {
    createClient,
    createAdminClient,
    resolveTenantId,
    requireWorkspaceCaptureAccessForRequest,
    requireWorkspaceReviewAccessForRequest,
    applyWorkspaceWorkflowTransition,
  });
}
