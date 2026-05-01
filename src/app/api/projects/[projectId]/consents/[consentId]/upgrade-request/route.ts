import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createProjectConsentUpgradeRequest } from "@/lib/projects/project-consent-upgrade-service";
import { handleCreateProjectConsentUpgradeRequestPost } from "@/lib/projects/project-consent-upgrade-route-handlers";
import {
  loadProjectWorkflowRowForAccess,
  requireWorkspaceCorrectionConsentIntakeAccessForRow,
  requireWorkspaceReviewMutationAccessForRow,
} from "@/lib/projects/project-workspace-request";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    projectId: string;
    consentId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  return handleCreateProjectConsentUpgradeRequestPost(request, context, {
    createClient,
    resolveTenantId,
    loadProjectWorkflowRowForAccess,
    requireWorkspaceReviewMutationAccessForRow: ({ client, tenantId, userId, projectId, consentId }) =>
      requireWorkspaceReviewMutationAccessForRow({
        supabase: client,
        tenantId,
        userId,
        projectId,
        table: "consents",
        rowId: consentId,
        notFoundCode: "consent_not_found",
        notFoundMessage: "Consent not found.",
        capabilityKey: "review.initiate_consent_upgrade_requests",
      }),
    requireWorkspaceCorrectionConsentIntakeAccessForRow: ({ client, tenantId, userId, projectId, consentId }) =>
      requireWorkspaceCorrectionConsentIntakeAccessForRow({
        supabase: client,
        tenantId,
        userId,
        projectId,
        table: "consents",
        rowId: consentId,
        notFoundCode: "consent_not_found",
        notFoundMessage: "Consent not found.",
      }),
    createProjectConsentUpgradeRequest: (input) =>
      createProjectConsentUpgradeRequest({
        ...input,
        supabase: createAdminClient(),
      }),
  });
}
