import { handleProjectCorrectionAssetPreflightPost } from "@/lib/assets/project-correction-asset-route-handlers";
import { requireWorkspaceCorrectionMediaIntakeAccessForRequest } from "@/lib/projects/project-workspace-request";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  return handleProjectCorrectionAssetPreflightPost(request, context, {
    createClient,
    resolveTenantId,
    requireWorkspaceCorrectionMediaIntakeAccessForRequest,
  });
}
