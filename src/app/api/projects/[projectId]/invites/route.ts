import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { HttpError, jsonError } from "@/lib/http/errors";
import { createInviteWithIdempotency } from "@/lib/idempotency/invite-idempotency";
import { buildCorrectionRequestProvenance } from "@/lib/projects/project-workflow-service";
import {
  loadProjectWorkflowRowForAccess,
  requireWorkspaceCaptureMutationAccessForRequest,
  requireWorkspaceCorrectionConsentIntakeAccessForRequest,
} from "@/lib/projects/project-workspace-request";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    projectId: string;
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
    const { projectId } = await context.params;
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
    if (idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      throw new HttpError(400, "invalid_idempotency_key", "Idempotency-Key header is required.");
    }

    const body = await request.json().catch(() => null);
    const requestedTemplateId =
      typeof (body as { consentTemplateId?: unknown } | null)?.consentTemplateId === "string"
        ? String((body as { consentTemplateId?: unknown }).consentTemplateId).trim()
        : "";
    const requestedWorkspaceId =
      typeof (body as { workspaceId?: unknown } | null)?.workspaceId === "string"
        ? String((body as { workspaceId?: unknown }).workspaceId).trim()
        : "";
    const projectWorkflow = await loadProjectWorkflowRowForAccess(supabase, tenantId, projectId);
    const correctionAccess = projectWorkflow.finalized_at !== null && projectWorkflow.correction_state === "open"
      ? await requireWorkspaceCorrectionConsentIntakeAccessForRequest({
          supabase,
          tenantId,
          userId: user.id,
          projectId,
          requestedWorkspaceId,
        })
      : null;
    const normalAccess = correctionAccess
      ? null
      : await requireWorkspaceCaptureMutationAccessForRequest({
          supabase,
          tenantId,
          userId: user.id,
          projectId,
          requestedWorkspaceId,
          capabilityKey: "capture.create_one_off_invites",
        });
    const workspace = correctionAccess?.workspace ?? normalAccess?.workspace;
    if (!workspace) {
      throw new HttpError(500, "workspace_lookup_failed", "Unable to load project workspace.");
    }

    const { data: project, error: projectError } = await supabase
      .from("projects")
      .select("id, default_consent_template_id")
      .eq("id", projectId)
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (projectError) {
      throw new HttpError(500, "project_lookup_failed", "Unable to load project.");
    }

    if (!project) {
      throw new HttpError(404, "project_not_found", "Project not found.");
    }

    let consentTemplateId = requestedTemplateId;

    if (!consentTemplateId) {
      if (project.default_consent_template_id) {
        const defaultTemplate = await getVisiblePublishedTemplateById(
          supabase,
          tenantId,
          project.default_consent_template_id,
        );
        if (!defaultTemplate) {
          throw new HttpError(
            409,
            "default_template_unavailable",
            "The project default template is no longer available. Choose another published template.",
          );
        }

        consentTemplateId = defaultTemplate.id;
      } else {
        throw new HttpError(
          400,
          "template_required",
          "Select a consent template before creating an invite.",
        );
      }
    }

    const result = await createInviteWithIdempotency({
      supabase: createAdminClient(),
      tenantId,
      projectId,
      workspaceId: workspace.id,
      userId: user.id,
      idempotencyKey,
      consentTemplateId,
      correctionProvenance: correctionAccess ? buildCorrectionRequestProvenance(correctionAccess.project) : null,
    });

    return Response.json(result.payload, { status: result.status });
  } catch (error) {
    return jsonError(error);
  }
}
