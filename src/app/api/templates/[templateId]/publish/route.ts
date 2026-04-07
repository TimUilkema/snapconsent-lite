import { createClient } from "@/lib/supabase/server";
import { HttpError, jsonError } from "@/lib/http/errors";
import { publishTenantTemplate } from "@/lib/templates/template-service";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    templateId: string;
  }>;
};

export async function POST(_request: Request, context: RouteContext) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      throw new HttpError(401, "unauthenticated", "Authentication required.");
    }

    const tenantId = await resolveTenantId(supabase);
    if (!tenantId) {
      throw new HttpError(403, "no_tenant_membership", "Tenant membership is required.");
    }

    const { templateId } = await context.params;
    const template = await publishTenantTemplate({
      supabase,
      tenantId,
      userId: user.id,
      templateId,
    });

    return Response.json({ template }, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
