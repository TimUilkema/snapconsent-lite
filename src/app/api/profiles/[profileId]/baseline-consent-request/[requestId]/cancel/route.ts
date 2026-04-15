import { handleCancelBaselineConsentRequestPost } from "@/lib/profiles/profile-route-handlers";
import { cancelBaselineConsentRequest } from "@/lib/profiles/profile-consent-service";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    profileId: string;
    requestId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  return handleCancelBaselineConsentRequestPost(request, context, {
    createClient,
    resolveTenantId,
    cancelBaselineConsentRequest,
  });
}
