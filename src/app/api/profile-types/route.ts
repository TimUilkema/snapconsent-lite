import { handleCreateRecurringProfileTypePost } from "@/lib/profiles/profile-route-handlers";
import { createRecurringProfileType } from "@/lib/profiles/profile-directory-service";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

export async function POST(request: Request) {
  return handleCreateRecurringProfileTypePost(request, {
    createClient,
    resolveTenantId,
    createRecurringProfileType,
  });
}
