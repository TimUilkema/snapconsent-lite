import { handleCreateProjectProfileConsentRequestPost } from "@/lib/projects/project-participants-route-handlers";
import { createProjectProfileConsentRequest } from "@/lib/projects/project-participants-service";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    projectId: string;
    participantId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  return handleCreateProjectProfileConsentRequestPost(request, context, {
    createClient,
    resolveTenantId,
    createProjectProfileConsentRequest,
  });
}
