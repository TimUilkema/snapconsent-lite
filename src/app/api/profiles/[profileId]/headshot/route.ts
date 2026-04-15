import { handleCreateRecurringProfileHeadshotPost } from "@/lib/profiles/profile-route-handlers";
import { createRecurringProfileHeadshotUpload } from "@/lib/profiles/profile-headshot-service";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    profileId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  return handleCreateRecurringProfileHeadshotPost(request, context, {
    createClient,
    resolveTenantId,
    createRecurringProfileHeadshotUpload,
  });
}
