import { HttpError, jsonError } from "@/lib/http/errors";
import { createClient } from "@/lib/supabase/server";
import {
  getTemplateForManagement,
  resolveTemplateManagementAccess,
} from "@/lib/templates/template-service";
import { validateTemplatePreview } from "@/lib/templates/template-preview-validation";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    templateId: string;
  }>;
};

type PreviewValidateBody = {
  structuredFieldsDefinition?: unknown;
  formLayoutDefinition?: unknown;
  previewValues?: {
    subjectName?: string | null;
    subjectEmail?: string | null;
    faceMatchOptIn?: boolean;
    hasMockHeadshot?: boolean;
    structuredFieldValues?: Record<string, unknown> | null;
  };
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

    const body = (await request.json().catch(() => null)) as PreviewValidateBody | null;
    if (!body) {
      throw new HttpError(400, "invalid_body", "Invalid request body.");
    }

    const { templateId } = await context.params;
    const access = await resolveTemplateManagementAccess(supabase, tenantId, user.id);
    if (!access.canManageTemplates) {
      throw new HttpError(403, "template_management_forbidden", "Only workspace owners and admins can manage templates.");
    }

    await getTemplateForManagement(supabase, tenantId, user.id, templateId);

    const result = await validateTemplatePreview({
      supabase,
      structuredFieldsDefinition: body.structuredFieldsDefinition,
      formLayoutDefinition: body.formLayoutDefinition,
      previewValues: body.previewValues,
    });

    return Response.json(
      result,
      { status: 200 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
