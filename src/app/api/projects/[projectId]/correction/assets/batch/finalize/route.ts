import { finalizeProjectAssetBatch } from "@/lib/assets/finalize-project-asset-batch";
import { handleProjectCorrectionAssetBatchFinalizePost } from "@/lib/assets/project-correction-asset-route-handlers";
import { requireWorkspaceCorrectionMediaIntakeAccessForRequest } from "@/lib/projects/project-workspace-request";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  return handleProjectCorrectionAssetBatchFinalizePost(request, context, {
    createClient,
    createAdminClient,
    resolveTenantId,
    requireWorkspaceCorrectionMediaIntakeAccessForRequest,
    finalizeProjectAssetBatch,
  });
}
