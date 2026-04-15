import { handleReplaceBaselineConsentRequestPost } from "@/lib/profiles/profile-route-handlers";
import { replaceBaselineConsentRequest } from "@/lib/profiles/profile-consent-service";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    profileId: string;
    requestId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  return handleReplaceBaselineConsentRequestPost(request, context, {
    createClient,
    resolveTenantId,
    replaceBaselineConsentRequest,
  });
}
