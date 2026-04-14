import { handleArchiveRecurringProfileTypePost } from "@/lib/profiles/profile-route-handlers";
import { archiveRecurringProfileType } from "@/lib/profiles/profile-directory-service";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    profileTypeId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  return handleArchiveRecurringProfileTypePost(request, context, {
    createClient,
    resolveTenantId,
    archiveRecurringProfileType,
  });
}
