import { createClient } from "@/lib/supabase/server";
import { handleSetActiveTenantPost } from "@/lib/tenant/active-tenant-route-handler";

export async function POST(request: Request) {
  return handleSetActiveTenantPost(request, {
    createClient,
  });
}
