import { createClient } from "@/lib/supabase/server";
import { HttpError, jsonError } from "@/lib/http/errors";
import {
  getTemplateForManagement,
  updateDraftTemplate,
} from "@/lib/templates/template-service";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    templateId: string;
  }>;
};

type UpdateTemplateBody = {
  name?: string;
  description?: string | null;
  body?: string;
  structuredFieldsDefinition?: unknown;
  formLayoutDefinition?: unknown;
};

export async function GET(_request: Request, context: RouteContext) {
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
    const template = await getTemplateForManagement(supabase, tenantId, user.id, templateId);
    return Response.json({ template }, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}

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

    const body = (await request.json().catch(() => null)) as UpdateTemplateBody | null;
    if (!body) {
      throw new HttpError(400, "invalid_body", "Invalid request body.");
    }

    const { templateId } = await context.params;
    const template = await updateDraftTemplate({
      supabase,
      tenantId,
      userId: user.id,
      templateId,
      name: String(body.name ?? ""),
      description:
        typeof body.description === "string" || body.description === null ? body.description ?? null : null,
      body: String(body.body ?? ""),
      structuredFieldsDefinition: body.structuredFieldsDefinition,
      formLayoutDefinition: body.formLayoutDefinition,
    });

    return Response.json({ template }, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
