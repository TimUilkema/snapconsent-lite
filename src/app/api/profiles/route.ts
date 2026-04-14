import { handleCreateRecurringProfilePost } from "@/lib/profiles/profile-route-handlers";
import { createRecurringProfile } from "@/lib/profiles/profile-directory-service";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

export async function POST(request: Request) {
  return handleCreateRecurringProfilePost(request, {
    createClient,
    resolveTenantId,
    createRecurringProfile,
  });
}
