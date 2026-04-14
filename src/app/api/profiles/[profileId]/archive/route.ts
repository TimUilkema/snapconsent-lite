import { handleArchiveRecurringProfilePost } from "@/lib/profiles/profile-route-handlers";
import { archiveRecurringProfile } from "@/lib/profiles/profile-directory-service";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    profileId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  return handleArchiveRecurringProfilePost(request, context, {
    createClient,
    resolveTenantId,
    archiveRecurringProfile,
  });
}
