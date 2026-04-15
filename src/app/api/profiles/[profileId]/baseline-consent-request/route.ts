import { handleCreateBaselineConsentRequestPost } from "@/lib/profiles/profile-route-handlers";
import { createBaselineConsentRequest } from "@/lib/profiles/profile-consent-service";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    profileId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  return handleCreateBaselineConsentRequestPost(request, context, {
    createClient,
    resolveTenantId,
    createBaselineConsentRequest,
  });
}
