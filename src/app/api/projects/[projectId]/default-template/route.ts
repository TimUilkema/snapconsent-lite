import { createClient } from "@/lib/supabase/server";
import { HttpError, jsonError } from "@/lib/http/errors";
import { setProjectDefaultTemplate } from "@/lib/templates/template-service";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

type UpdateProjectDefaultBody = {
  defaultConsentTemplateId?: string | null;
};

export async function PATCH(request: Request, context: RouteContext) {
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

    const body = (await request.json().catch(() => null)) as UpdateProjectDefaultBody | null;
    if (!body) {
      throw new HttpError(400, "invalid_body", "Invalid request body.");
    }

    const templateIdValue = body.defaultConsentTemplateId;
    const templateId =
      typeof templateIdValue === "string" && templateIdValue.trim().length > 0
        ? templateIdValue.trim()
        : null;

    const { projectId } = await context.params;
    await setProjectDefaultTemplate({
      supabase,
      tenantId,
      userId: user.id,
      projectId,
      templateId,
    });

    return Response.json({ ok: true, defaultConsentTemplateId: templateId }, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
