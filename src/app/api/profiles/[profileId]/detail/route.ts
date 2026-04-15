import { handleGetRecurringProfileDetail } from "@/lib/profiles/profile-route-handlers";
import { getRecurringProfileDetailPanelData } from "@/lib/profiles/profile-directory-service";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    profileId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  return handleGetRecurringProfileDetail(request, context, {
    createClient,
    resolveTenantId,
    getRecurringProfileDetailPanelData,
  });
}
