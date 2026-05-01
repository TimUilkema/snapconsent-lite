import { handleProjectCorrectionStartPost } from "@/lib/projects/project-workflow-route-handlers";
import { startProjectCorrection } from "@/lib/projects/project-workflow-service";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { assertEffectiveProjectCapability } from "@/lib/tenant/effective-permissions";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  return handleProjectCorrectionStartPost(request, context, {
    createClient,
    createAdminClient,
    resolveTenantId,
    assertEffectiveProjectCapability,
    startProjectCorrection,
  });
}
