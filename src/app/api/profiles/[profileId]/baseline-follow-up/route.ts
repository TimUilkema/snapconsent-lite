import { handleBaselineFollowUpPost } from "@/lib/profiles/profile-route-handlers";
import { sendBaselineFollowUp } from "@/lib/profiles/profile-follow-up-service";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    profileId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  return handleBaselineFollowUpPost(request, context, {
    createClient,
    resolveTenantId,
    sendBaselineFollowUp,
  });
}
