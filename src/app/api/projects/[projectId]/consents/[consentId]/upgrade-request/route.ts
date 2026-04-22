import { createClient } from "@/lib/supabase/server";
import { createProjectConsentUpgradeRequest } from "@/lib/projects/project-consent-upgrade-service";
import { handleCreateProjectConsentUpgradeRequestPost } from "@/lib/projects/project-consent-upgrade-route-handlers";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    projectId: string;
    consentId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  return handleCreateProjectConsentUpgradeRequestPost(request, context, {
    createClient,
    resolveTenantId,
    createProjectConsentUpgradeRequest,
  });
}
