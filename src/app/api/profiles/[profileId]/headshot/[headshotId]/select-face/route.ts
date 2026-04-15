import { handleSelectRecurringProfileHeadshotFacePost } from "@/lib/profiles/profile-route-handlers";
import { selectRecurringProfileHeadshotFace } from "@/lib/profiles/profile-headshot-service";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    profileId: string;
    headshotId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  return handleSelectRecurringProfileHeadshotFacePost(request, context, {
    createClient,
    resolveTenantId,
    selectRecurringProfileHeadshotFace,
  });
}
