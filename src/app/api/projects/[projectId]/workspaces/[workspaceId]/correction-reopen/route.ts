import {
  handleWorkspaceCorrectionReopenPost,
} from "@/lib/projects/project-workflow-route-handlers";
import { reopenWorkspaceForCorrection } from "@/lib/projects/project-workflow-service";
import { requireWorkspaceReviewAccessForRequest } from "@/lib/projects/project-workspace-request";
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
  return handleWorkspaceCorrectionReopenPost(request, context, {
    createClient,
    createAdminClient,
    resolveTenantId,
    requireWorkspaceReviewAccessForRequest,
    reopenWorkspaceForCorrection,
  });
}
