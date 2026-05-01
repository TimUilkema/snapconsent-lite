import { handleAddProjectProfileParticipantPost } from "@/lib/projects/project-participants-route-handlers";
import { addProjectProfileParticipant } from "@/lib/projects/project-participants-service";
import {
  loadProjectWorkflowRowForAccess,
  requireWorkspaceCaptureMutationAccessForRequest,
  requireWorkspaceCorrectionConsentIntakeAccessForRequest,
} from "@/lib/projects/project-workspace-request";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  return handleAddProjectProfileParticipantPost(request, context, {
    createClient,
    resolveTenantId,
    loadProjectWorkflowRowForAccess,
    requireWorkspaceCaptureMutationAccessForRequest,
    requireWorkspaceCorrectionConsentIntakeAccessForRequest,
    addProjectProfileParticipant: (input) =>
      addProjectProfileParticipant({
        ...input,
        supabase: createAdminClient(),
      }),
  });
}
