import { createClient } from "@/lib/supabase/server";
import { HttpError, jsonError } from "@/lib/http/errors";
import { createTenantTemplateVersion } from "@/lib/templates/template-service";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    templateId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
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

    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
    if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      throw new HttpError(400, "invalid_idempotency_key", "Idempotency-Key header is required.");
    }

    const { templateId } = await context.params;
    const result = await createTenantTemplateVersion({
      supabase,
      tenantId,
      userId: user.id,
      idempotencyKey,
      templateId,
    });

    return Response.json(result.payload, { status: result.status });
  } catch (error) {
    return jsonError(error);
  }
}
