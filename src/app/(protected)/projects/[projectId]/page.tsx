import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";

import { AssetsList } from "@/components/projects/assets-list";
import { AssetsUploadForm } from "@/components/projects/assets-upload-form";
import { ConsentAssetMatchingPanel } from "@/components/projects/consent-asset-matching-panel";
import { ConsentHeadshotReplaceControl } from "@/components/projects/consent-headshot-replace-control";
import { ConsentStructuredSnapshot } from "@/components/projects/consent-structured-snapshot";
import { CreateInviteForm } from "@/components/projects/create-invite-form";
import { OneOffConsentUpgradeForm } from "@/components/projects/one-off-consent-upgrade-form";
import { PreviewableImage } from "@/components/projects/previewable-image";
import { ProjectParticipantsPanel } from "@/components/projects/project-participants-panel";
import { ProjectMatchingProgress } from "@/components/projects/project-matching-progress";
import { ProjectReviewerAccessPanel } from "@/components/projects/project-reviewer-access-panel";
import { ProjectWorkflowControls } from "@/components/projects/project-workflow-controls";
import { ProjectWorkspaceStaffingForm } from "@/components/projects/project-workspace-staffing-form";
import { InviteActions } from "@/components/projects/invite-actions";
import { signThumbnailUrlsForAssets } from "@/lib/assets/sign-asset-thumbnails";
import { HttpError } from "@/lib/http/errors";
import { formatDateTime } from "@/lib/i18n/format";
import { loadCurrentProjectConsentHeadshots } from "@/lib/matching/face-materialization";
import { getProjectMatchingProgress } from "@/lib/matching/project-matching-progress";
import { filterCurrentOneOffInviteRows } from "@/lib/projects/current-one-off-consent";
import {
  listAssignablePhotographersForProjectAdministration,
  listProjectAdministrationWorkspaces,
  resolveProjectAdministrationAccess,
} from "@/lib/projects/project-administration-service";
import { getProjectWorkflowSummary } from "@/lib/projects/project-workflow-service";
import { getProjectParticipantsPanelData } from "@/lib/projects/project-participants-service";
import { resolveProjectWorkspaceSelection } from "@/lib/projects/project-workspaces-service";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { listVisibleTemplatesForTenant } from "@/lib/templates/template-service";
import type { StructuredFieldsSnapshot } from "@/lib/templates/structured-fields";
import {
  resolveEffectiveProjectCapabilities,
  resolveEffectiveWorkspaceCapabilities,
} from "@/lib/tenant/effective-permissions";
import { resolveProjectPermissions } from "@/lib/tenant/permissions";
import { listProjectReviewerAssignments } from "@/lib/tenant/reviewer-access-service";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";
import { deriveInviteToken } from "@/lib/tokens/public-token";
import { resolveLoopbackStorageUrlForHostHeader } from "@/lib/url/resolve-loopback-storage-url";
import { buildInvitePath } from "@/lib/url/paths";

type RouteProps = {
  params: Promise<{
    projectId: string;
  }>;
  searchParams: Promise<{
    openConsentId?: string;
    workspaceId?: string;
  }>;
};

type InviteRow = {
  id: string;
  status: string;
  expires_at: string | null;
  used_count: number;
  max_uses: number;
  created_at: string;
  request_source: "normal" | "correction";
  correction_opened_at_snapshot: string | null;
  correction_source_release_id_snapshot: string | null;
  consent_template?: {
    id: string;
    template_key: string;
    name: string;
    version: string;
    version_number: number;
  } | null;
  consents?: Array<{
    id: string;
    signed_at: string;
    superseded_at: string | null;
    consent_text: string;
    consent_version: string;
    structured_fields_snapshot: StructuredFieldsSnapshot | null;
    face_match_opt_in: boolean;
    subjects?: {
      email: string;
      full_name: string;
    } | null;
  }> | null;
};

type RawInviteRow = {
  id: string;
  status: string;
  expires_at: string | null;
  used_count: number;
  max_uses: number;
  created_at: string;
  request_source: "normal" | "correction";
  correction_opened_at_snapshot: string | null;
  correction_source_release_id_snapshot: string | null;
  consent_template?:
    | {
        id: string;
        template_key: string;
        name: string;
        version: string;
        version_number: number;
      }
    | Array<{
        id: string;
        template_key: string;
        name: string;
        version: string;
        version_number: number;
      }>
    | null;
  consents?: Array<{
    id: string;
    signed_at: string;
    superseded_at: string | null;
    consent_text: string;
    consent_version: string;
    structured_fields_snapshot: StructuredFieldsSnapshot | null;
    face_match_opt_in: boolean;
    subjects?:
      | {
          email: string;
          full_name: string;
        }
      | Array<{
          email: string;
          full_name: string;
        }>
      | null;
  }> | null;
};

function firstRelation<T>(value: T | T[] | null | undefined) {
  if (Array.isArray(value)) {
    return value[0] ?? null;
  }

  return value ?? null;
}

type ConsentTemplateOption = {
  id: string;
  name: string;
  version: string;
  versionNumber: number;
  templateKey: string;
  scope: "app" | "tenant";
};

type PendingUpgradeRequestRow = {
  id: string;
  prior_consent_id: string;
  target_template_id: string;
  invite_id: string | null;
  target_template?:
    | {
        id: string;
        name: string;
        version: string;
      }
    | Array<{
        id: string;
        name: string;
        version: string;
      }>
    | null;
  invite?:
    | {
        id: string;
        status: string;
        expires_at: string | null;
        used_count: number;
        max_uses: number;
        request_source: "normal" | "correction";
        correction_opened_at_snapshot: string | null;
        correction_source_release_id_snapshot: string | null;
      }
    | Array<{
        id: string;
        status: string;
        expires_at: string | null;
        used_count: number;
        max_uses: number;
        request_source: "normal" | "correction";
        correction_opened_at_snapshot: string | null;
        correction_source_release_id_snapshot: string | null;
      }>
    | null;
};

type InviteIdempotencyResponse = {
  inviteId?: string;
  invitePath?: string;
};

type HeadshotAssetRow = {
  id: string;
  status: string;
  storage_bucket: string | null;
  storage_path: string | null;
};

type RecurringProfileHeadshotPreviewRow = {
  profile_id: string;
  storage_bucket: string | null;
  storage_path: string | null;
  created_at: string;
};

function buildProjectWorkspaceHref(
  projectId: string,
  workspaceId: string,
  openConsentId?: string | null,
) {
  const params = new URLSearchParams({
    workspaceId,
  });
  if (openConsentId) {
    params.set("openConsentId", openConsentId);
  }

  return `/projects/${projectId}?${params.toString()}`;
}

function getWorkspaceWorkflowBadgeTone(state: string, isSelected: boolean) {
  if (state === "handed_off") {
    return isSelected
      ? "border border-amber-300 bg-amber-100 text-amber-900"
      : "border border-amber-200 bg-amber-50 text-amber-800";
  }

  if (state === "needs_changes") {
    return isSelected
      ? "border border-red-300 bg-red-100 text-red-800"
      : "border border-red-200 bg-red-50 text-red-700";
  }

  if (state === "validated") {
    return isSelected
      ? "border border-emerald-300 bg-emerald-100 text-emerald-800"
      : "border border-emerald-200 bg-emerald-50 text-emerald-700";
  }

  return isSelected
    ? "border border-zinc-700 bg-zinc-800 text-zinc-100"
    : "border border-zinc-300 bg-zinc-100 text-zinc-700";
}

function isWorkspaceCorrectionReopenedForActiveCycle(input: {
  correctionOpenedAt: string | null;
  correctionOpen: boolean;
  selectedWorkspace:
    | {
        workflow_state: string;
        reopened_at: string | null;
      }
    | null;
}) {
  return Boolean(
    input.correctionOpen
      && input.selectedWorkspace?.workflow_state === "handed_off"
      && input.selectedWorkspace.reopened_at
      && input.correctionOpenedAt
      && input.selectedWorkspace.reopened_at >= input.correctionOpenedAt,
  );
}

function isInviteFromActiveCorrectionCycle(
  invite: Pick<
    InviteRow,
    "request_source" | "correction_opened_at_snapshot" | "correction_source_release_id_snapshot"
  >,
  projectWorkflow: Pick<
    Awaited<ReturnType<typeof getProjectWorkflowSummary>>,
    "correctionState" | "correctionOpenedAt" | "correctionSourceReleaseId"
  >,
) {
  return (
    projectWorkflow.correctionState === "open"
    && invite.request_source === "correction"
    && invite.correction_opened_at_snapshot !== null
    && invite.correction_opened_at_snapshot === projectWorkflow.correctionOpenedAt
    && invite.correction_source_release_id_snapshot !== null
    && invite.correction_source_release_id_snapshot === projectWorkflow.correctionSourceReleaseId
  );
}

function derivePendingUpgradeInvitePath(
  tenantId: string,
  projectId: string,
  upgradeRequestId: string,
  invite:
    | {
        request_source: "normal" | "correction";
        correction_opened_at_snapshot: string | null;
        correction_source_release_id_snapshot: string | null;
      }
    | null,
) {
  const correctionOperationSuffix =
    invite?.request_source === "correction"
    && invite.correction_opened_at_snapshot
    && invite.correction_source_release_id_snapshot
      ? `:correction:${invite.correction_source_release_id_snapshot}:${invite.correction_opened_at_snapshot}`
      : "";

  return buildInvitePath(
    deriveInviteToken({
      tenantId,
      projectId,
      idempotencyKey: `${upgradeRequestId}${correctionOperationSuffix}`,
    }),
  );
}

export default async function ProjectDashboardPage({ params, searchParams }: RouteProps) {
  const locale = await getLocale();
  const t = await getTranslations("projects.detail");
  const { projectId } = await params;
  const resolvedSearchParams = await searchParams;
  const openConsentId = String(resolvedSearchParams.openConsentId ?? "").trim();
  const requestedWorkspaceId = String(resolvedSearchParams.workspaceId ?? "").trim();
  const requestHeaders = await headers();
  const requestHostHeader = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const supabase = await createClient();
  const adminSupabase = createAdminClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const tenantId = await resolveTenantId(supabase);
  if (!tenantId) {
    redirect("/projects");
  }

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, description, status, created_at, created_by, finalized_at, finalized_by")
    .eq("id", projectId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!project) {
    notFound();
  }
  const projectAdministrationAccess = await resolveProjectAdministrationAccess({
    supabase,
    tenantId,
    userId: user.id,
    projectCreatedByUserId: project.created_by,
  });
  const projectPermissions = await resolveProjectPermissions(supabase, tenantId, user.id, project.id);

  let workspaceSelection: Awaited<ReturnType<typeof resolveProjectWorkspaceSelection>>;
  try {
    workspaceSelection = await resolveProjectWorkspaceSelection({
      supabase,
      tenantId,
      projectId: project.id,
      userId: user.id,
      requestedWorkspaceId,
    });
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) {
      if (!projectAdministrationAccess.canViewProjectAdministration) {
        notFound();
      }

      const administrationWorkspaces = projectAdministrationAccess.canManageProjectWorkspaces
        ? await listProjectAdministrationWorkspaces({
            supabase,
            tenantId,
            userId: user.id,
            projectId: project.id,
          })
        : [];
      const staffingMutationsAllowed = Boolean(
        projectAdministrationAccess.canManageProjectWorkspaces
          && project.status === "active"
          && !project.finalized_at,
      );
      const assignablePhotographers = staffingMutationsAllowed
        ? await listAssignablePhotographersForProjectAdministration({
            supabase,
            tenantId,
            userId: user.id,
            projectId: project.id,
            adminSupabase,
          })
        : [];

      return (
        <div className="space-y-6">
          <section className="app-shell rounded-2xl px-5 py-5 sm:px-6">
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-600">
                <Link href="/projects" className="font-medium text-zinc-700 underline underline-offset-4">
                  {t("breadcrumbProjects")}
                </Link>
                <span>/</span>
                <span>{project.name}</span>
              </div>

              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">{project.name}</h1>
                <p className="mt-2 text-sm leading-6 text-zinc-600">{t("subtitle")}</p>
                {project.description ? (
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-800">{project.description}</p>
                ) : null}
              </div>
            </div>
          </section>

          <section className="content-card rounded-2xl p-5">
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
              <div className="space-y-4">
                <div className="rounded-xl border border-zinc-200 bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    {t("workspaceSectionLabel")}
                  </p>
                  {administrationWorkspaces.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {administrationWorkspaces.map((workspace) => (
                        <span
                          key={workspace.id}
                          className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800"
                        >
                          <span>{workspace.name}</span>
                          <span
                            className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium ${getWorkspaceWorkflowBadgeTone(
                              workspace.workflow_state,
                              false,
                            )}`}
                          >
                            {t(`workflow.workspaceStates.${workspace.workflow_state}`)}
                          </span>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-zinc-600">{t("workspaceNoneAssigned")}</p>
                  )}
                </div>

                {staffingMutationsAllowed ? (
                  <ProjectWorkspaceStaffingForm
                    projectId={project.id}
                    photographers={assignablePhotographers}
                    existingWorkspaces={administrationWorkspaces.map((workspace) => ({
                      id: workspace.id,
                      photographerUserId: workspace.photographer_user_id,
                      name: workspace.name,
                    }))}
                  />
                ) : projectAdministrationAccess.canManageProjectWorkspaces ? (
                  <p className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
                    {project.finalized_at
                      ? t("workflow.staffingLockedFinalized")
                      : t("workflow.projectArchivedReadOnly")}
                  </p>
                ) : null}
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <div className="rounded-xl border border-zinc-200 bg-white p-3">
                  <p className="text-sm text-zinc-500">{t("statsStatus")}</p>
                  <p className="mt-1 font-medium text-zinc-900">{project.status}</p>
                </div>
                <div className="rounded-xl border border-zinc-200 bg-white p-3">
                  <p className="text-sm text-zinc-500">{t("statsCreated")}</p>
                  <p className="mt-1 font-medium text-zinc-900">
                    {formatDateTime(project.created_at, locale)}
                  </p>
                </div>
              </div>
            </div>
          </section>
        </div>
      );
    }

    throw error;
  }
  if (workspaceSelection.requiresExplicitSelection && workspaceSelection.workspaces[0]) {
    redirect(
      buildProjectWorkspaceHref(
        project.id,
        workspaceSelection.workspaces[0].id,
        openConsentId || null,
      ),
    );
  }

  const selectedWorkspace = workspaceSelection.selectedWorkspace;
  if (!selectedWorkspace && workspaceSelection.workspaces.length > 0) {
    notFound();
  }
  const projectWorkflow = await getProjectWorkflowSummary({
    supabase: adminSupabase,
    tenantId,
    projectId: project.id,
    workspaces: workspaceSelection.workspaces,
  });
  const selectedWorkspaceWorkflow =
    projectWorkflow.workspaces.find((workspace) => workspace.workspaceId === selectedWorkspace?.id) ?? null;
  const correctionOpen = projectWorkflow.correctionState === "open";
  const correctionWorkspaceReopenedForCurrentCycle = isWorkspaceCorrectionReopenedForActiveCycle({
    correctionOpenedAt: projectWorkflow.correctionOpenedAt,
    correctionOpen,
    selectedWorkspace,
  });
  const projectEffectiveCapabilities = await resolveEffectiveProjectCapabilities({
    supabase,
    adminSupabase,
    tenantId,
    userId: user.id,
    projectId: project.id,
  });
  const projectCapabilitySet = new Set(projectEffectiveCapabilities.capabilityKeys);
  const workspaceEffectiveCapabilities = selectedWorkspace
    ? await resolveEffectiveWorkspaceCapabilities({
        supabase,
        adminSupabase,
        tenantId,
        userId: user.id,
        projectId: project.id,
        workspaceId: selectedWorkspace.id,
      })
    : null;
  const workspaceCapabilitySet = new Set(workspaceEffectiveCapabilities?.capabilityKeys ?? []);
  const canOpenCaptureWorkspace = workspaceCapabilitySet.has("capture.workspace");
  const canCreateOneOffInvites = workspaceCapabilitySet.has("capture.create_one_off_invites");
  const canCreateRecurringProjectConsentRequests = workspaceCapabilitySet.has(
    "capture.create_recurring_project_consent_requests",
  );
  const canUploadAssets = workspaceCapabilitySet.has("capture.upload_assets");
  const canOpenReviewWorkspace = workspaceCapabilitySet.has("review.workspace");
  const canInitiateConsentUpgradeRequests = workspaceCapabilitySet.has(
    "review.initiate_consent_upgrade_requests",
  );
  const canFinalizeProject = projectCapabilitySet.has("workflow.finalize_project");
  const canStartProjectCorrection = projectCapabilitySet.has("workflow.start_project_correction");
  const canReopenWorkspaceForCorrection = workspaceCapabilitySet.has(
    "workflow.reopen_workspace_for_correction",
  );
  const canCorrectionReview = workspaceCapabilitySet.has("correction.review");
  const canCorrectionConsentIntake = workspaceCapabilitySet.has("correction.consent_intake");
  const canCorrectionMediaIntake = workspaceCapabilitySet.has("correction.media_intake");
  const normalCaptureStateOpen = Boolean(
    selectedWorkspace
      && project.status === "active"
      && !project.finalized_at
      && (selectedWorkspace.workflow_state === "active" || selectedWorkspace.workflow_state === "needs_changes"),
  );
  const normalReviewStateOpen = Boolean(
    selectedWorkspace
      && project.status === "active"
      && !correctionOpen
      && !project.finalized_at
      && (selectedWorkspace.workflow_state === "handed_off" || selectedWorkspace.workflow_state === "needs_changes"),
  );
  const inviteMutationsAllowed = canCreateOneOffInvites && normalCaptureStateOpen;
  const recurringConsentMutationsAllowed =
    canCreateRecurringProjectConsentRequests && normalCaptureStateOpen;
  const assetUploadAllowed = canUploadAssets && normalCaptureStateOpen;
  const correctionMediaIntakeAllowed = Boolean(
    canCorrectionMediaIntake && correctionWorkspaceReopenedForCurrentCycle,
  );
  const correctionConsentMutationsAllowed = Boolean(
    canCorrectionConsentIntake && correctionWorkspaceReopenedForCurrentCycle,
  );
  const correctionReviewMutationsAllowed = Boolean(
    canCorrectionReview
      && selectedWorkspace
      && project.status === "active"
      && correctionOpen
      && selectedWorkspace.workflow_state === "handed_off",
  );
  const captureMutationsAllowed = inviteMutationsAllowed
    || recurringConsentMutationsAllowed
    || assetUploadAllowed;
  const reviewSafeMutationsAllowed = Boolean(
    correctionOpen ? correctionReviewMutationsAllowed : canOpenReviewWorkspace && normalReviewStateOpen,
  );
  const reviewConsentFlowMutationsAllowed = Boolean(
    correctionOpen
      ? correctionConsentMutationsAllowed
      : canInitiateConsentUpgradeRequests && normalReviewStateOpen,
  );
  const headshotReplacementAllowed = Boolean(
    !correctionOpen && canOpenReviewWorkspace && normalReviewStateOpen,
  );
  const consentIntakeActionsAllowed =
    recurringConsentMutationsAllowed || correctionConsentMutationsAllowed;
  const canShowCaptureLockedNotice = canOpenCaptureWorkspace
    || canCreateOneOffInvites
    || canCreateRecurringProjectConsentRequests
    || canUploadAssets;
  const canShowReviewLockedNotice = canOpenReviewWorkspace || canCorrectionReview;
  const canManageProjectStaffing = projectAdministrationAccess.canManageProjectWorkspaces;
  const staffingMutationsAllowed = Boolean(
    canManageProjectStaffing && project.status === "active" && !project.finalized_at,
  );
  const correctionConsentNotice = correctionConsentMutationsAllowed
    ? t("workflow.projectCorrectionConsentIntakeHelper")
    : null;

  const templates = await listVisibleTemplatesForTenant(supabase, tenantId);
  const participantPanelData = selectedWorkspace
    ? await getProjectParticipantsPanelData({
        supabase,
        tenantId,
        projectId: project.id,
        workspaceId: selectedWorkspace.id,
      })
    : {
        knownProfiles: [],
        availableProfiles: [],
      };
  const recurringProfileHeadshotUrls: Record<
    string,
    {
      thumbnailUrl: string | null;
      previewUrl: string | null;
    }
  > = {};

  const templateOptions: ConsentTemplateOption[] = templates.map((template) => ({
    id: template.id,
    name: template.name,
    version: template.version,
    versionNumber: template.versionNumber,
    templateKey: template.templateKey,
    scope: template.scope,
  }));

  let assignablePhotographers: Array<{ userId: string; email: string }> = [];
  let projectReviewerAccessData: Awaited<ReturnType<typeof listProjectReviewerAssignments>> | null = null;
  if (projectPermissions.canManageMembers) {
    projectReviewerAccessData = await listProjectReviewerAssignments({
      supabase,
      tenantId,
      userId: user.id,
      projectId: project.id,
    });
  }

  if (canManageProjectStaffing) {
    assignablePhotographers = await listAssignablePhotographersForProjectAdministration({
      supabase,
      tenantId,
      userId: user.id,
      projectId: project.id,
      adminSupabase,
    });
  }

  const { data: invites } = selectedWorkspace
    ? await supabase
        .from("subject_invites")
        .select(
          "id, status, expires_at, used_count, max_uses, created_at, request_source, correction_opened_at_snapshot, correction_source_release_id_snapshot, consent_template:consent_templates(id, template_key, name, version, version_number), consents(id, signed_at, superseded_at, consent_text, consent_version, structured_fields_snapshot, face_match_opt_in, subjects(email, full_name))",
        )
        .eq("project_id", project.id)
        .eq("workspace_id", selectedWorkspace.id)
        .eq("tenant_id", tenantId)
        .neq("status", "revoked")
        .order("created_at", { ascending: false })
    : { data: [] };

  const inviteRows: InviteRow[] = ((invites as RawInviteRow[] | null) ?? []).map((invite) => ({
    id: invite.id,
    status: invite.status,
    expires_at: invite.expires_at,
    used_count: invite.used_count,
    max_uses: invite.max_uses,
    created_at: invite.created_at,
    request_source: invite.request_source,
    correction_opened_at_snapshot: invite.correction_opened_at_snapshot,
    correction_source_release_id_snapshot: invite.correction_source_release_id_snapshot,
    consent_template: firstRelation(invite.consent_template),
    consents: Array.isArray(invite.consents)
      ? invite.consents.map((consent) => ({
          id: consent.id,
          signed_at: consent.signed_at,
          superseded_at: consent.superseded_at,
          consent_text: consent.consent_text,
          consent_version: consent.consent_version,
          structured_fields_snapshot: consent.structured_fields_snapshot,
          face_match_opt_in: consent.face_match_opt_in,
          subjects: firstRelation(consent.subjects),
        }))
      : null,
  }));
  const currentInviteRows = filterCurrentOneOffInviteRows(inviteRows);

  const signedConsentIds = currentInviteRows
    .flatMap((invite) => invite.consents?.map((consent) => consent.id) ?? [])
    .filter((consentId) => consentId.length > 0);

  const pendingUpgradeRequestMap = new Map<
    string,
    {
      id: string;
      targetTemplateId: string;
      targetTemplateName: string;
      targetTemplateVersion: string;
      invitePath: string;
      expiresAt: string | null;
    }
  >();

  if (signedConsentIds.length > 0) {
    const { data: pendingUpgradeRequests } = await supabase
      .from("project_consent_upgrade_requests")
      .select(
        "id, prior_consent_id, target_template_id, invite_id, target_template:consent_templates(id, name, version), invite:subject_invites(id, status, expires_at, used_count, max_uses, request_source, correction_opened_at_snapshot, correction_source_release_id_snapshot)",
      )
      .eq("tenant_id", tenantId)
      .eq("project_id", project.id)
      .eq("workspace_id", selectedWorkspace?.id ?? "")
      .eq("status", "pending")
      .in("prior_consent_id", signedConsentIds);

    ((pendingUpgradeRequests as PendingUpgradeRequestRow[] | null) ?? []).forEach((request) => {
      const invite = firstRelation(request.invite);
      const targetTemplate = firstRelation(request.target_template);
      if (
        !invite
        || invite.status !== "active"
        || invite.used_count >= invite.max_uses
        || !targetTemplate
      ) {
        return;
      }

      pendingUpgradeRequestMap.set(request.prior_consent_id, {
        id: request.id,
        targetTemplateId: request.target_template_id,
        targetTemplateName: targetTemplate.name,
        targetTemplateVersion: targetTemplate.version,
        invitePath: derivePendingUpgradeInvitePath(tenantId, project.id, request.id, invite),
        expiresAt: invite.expires_at ?? null,
      });
    });
  }

  const inviteOperation = selectedWorkspace
    ? `create_project_invite:${project.id}:${selectedWorkspace.id}`
    : `create_project_invite:${project.id}`;
  const inviteOperations = [
    inviteOperation,
    ...(correctionOpen && projectWorkflow.correctionOpenedAt && projectWorkflow.correctionSourceReleaseId
      ? [
          `${inviteOperation}:correction:${projectWorkflow.correctionSourceReleaseId}:${projectWorkflow.correctionOpenedAt}`,
        ]
      : []),
  ];
  const { data: idempotencyRows } = await supabase
    .from("idempotency_keys")
    .select("idempotency_key, operation, response_json")
    .eq("tenant_id", tenantId)
    .in("operation", inviteOperations);

  const invitePathMap = new Map<string, string>();
  (idempotencyRows ?? []).forEach((row) => {
    const payload = (row.response_json as InviteIdempotencyResponse | null) ?? null;
    const inviteId = payload?.inviteId;
    if (!inviteId || !row.idempotency_key) {
      return;
    }

    if (typeof payload?.invitePath === "string" && payload.invitePath.startsWith("/")) {
      invitePathMap.set(inviteId, payload.invitePath);
      return;
    }

    if (row.operation === inviteOperation) {
      invitePathMap.set(
        inviteId,
        buildInvitePath(
          deriveInviteToken({
            tenantId,
            projectId: project.id,
            idempotencyKey: row.idempotency_key,
          }),
        ),
      );
    }
  });

  const consentCount = selectedWorkspace
    ? (
        await supabase
          .from("consents")
          .select("*", { count: "exact", head: true })
          .eq("project_id", project.id)
          .eq("workspace_id", selectedWorkspace.id)
          .eq("tenant_id", tenantId)
      ).count
    : 0;

  const inviteCount = currentInviteRows.length;
  const matchingProgress = selectedWorkspace
    ? await getProjectMatchingProgress(adminSupabase, tenantId, project.id, selectedWorkspace.id)
    : {
        totalImages: 0,
        processedImages: 0,
        progressPercent: 0,
        isMatchingInProgress: false,
        hasDegradedMatchingState: false,
      };
  const recurringProfileIds = participantPanelData.knownProfiles.map((participant) => participant.profile.id);

  if (recurringProfileIds.length > 0) {
    const { data: recurringHeadshots } = await adminSupabase
      .from("recurring_profile_headshots")
      .select("profile_id, storage_bucket, storage_path, created_at")
      .eq("tenant_id", tenantId)
      .in("profile_id", recurringProfileIds)
      .eq("upload_status", "uploaded")
      .is("superseded_at", null)
      .order("created_at", { ascending: false });

    const currentRecurringHeadshots = new Map<string, RecurringProfileHeadshotPreviewRow>();
    ((recurringHeadshots as RecurringProfileHeadshotPreviewRow[] | null) ?? []).forEach((headshot) => {
      if (!headshot.storage_bucket || !headshot.storage_path || currentRecurringHeadshots.has(headshot.profile_id)) {
        return;
      }

      currentRecurringHeadshots.set(headshot.profile_id, headshot);
    });

    await Promise.all(
      Array.from(currentRecurringHeadshots.values()).map(async (headshot) => {
        const { data } = await adminSupabase.storage
          .from(headshot.storage_bucket ?? "")
          .createSignedUrl(headshot.storage_path ?? "", 60 * 60);
        const signedUrl = data?.signedUrl ?? null;
        const resolvedUrl = signedUrl
          ? resolveLoopbackStorageUrlForHostHeader(signedUrl, requestHostHeader)
          : null;

        recurringProfileHeadshotUrls[headshot.profile_id] = {
          thumbnailUrl: resolvedUrl,
          previewUrl: resolvedUrl,
        };
      }),
    );
  }

  const currentHeadshots = selectedWorkspace
    ? await loadCurrentProjectConsentHeadshots(
        adminSupabase,
        tenantId,
        project.id,
        selectedWorkspace.id,
        {
          optInOnly: true,
          notRevokedOnly: false,
          limit: null,
        },
      )
    : [];

  const consentHeadshotLinkMap = new Map<string, string>();
  const consentHeadshotAssetMap = new Map<string, HeadshotAssetRow>();
  const consentHeadshotThumbnailMap = new Map<string, string | null>();

  if (currentHeadshots.length > 0) {
    const { data: headshotAssets } = await supabase
      .from("assets")
      .select("id, status, storage_bucket, storage_path")
      .eq("tenant_id", tenantId)
      .eq("project_id", project.id)
      .eq("workspace_id", selectedWorkspace?.id ?? "")
      .eq("asset_type", "headshot")
      .eq("status", "uploaded")
      .is("archived_at", null);

    const headshotRows = (headshotAssets as HeadshotAssetRow[] | null) ?? [];
    const headshotAssetIds = headshotRows.map((asset) => asset.id);
    const headshotAssetIdSet = new Set(headshotAssetIds);
    const headshotAssetMap = new Map<string, HeadshotAssetRow>(
      headshotRows.map((asset) => [asset.id, asset]),
    );

    if (headshotAssetIds.length > 0) {
      currentHeadshots.forEach((headshot) => {
        if (!headshotAssetIdSet.has(headshot.headshotAssetId)) {
          return;
        }

        consentHeadshotLinkMap.set(headshot.consentId, headshot.headshotAssetId);
        const linkedHeadshotAsset = headshotAssetMap.get(headshot.headshotAssetId);
        if (linkedHeadshotAsset) {
          consentHeadshotAssetMap.set(headshot.consentId, linkedHeadshotAsset);
        }
      });

      const uniqueHeadshotAssets = Array.from(
        new Map(
          Array.from(consentHeadshotAssetMap.values()).map((asset) => [asset.id, asset]),
        ).values(),
      );
      const headshotThumbnailUrls = await signThumbnailUrlsForAssets(supabase, uniqueHeadshotAssets, {
        width: 240,
        height: 240,
      });
      const headshotPreviewUrls = await signThumbnailUrlsForAssets(supabase, uniqueHeadshotAssets, {
        width: 960,
        quality: 85,
        resize: "contain",
      });

      consentHeadshotAssetMap.forEach((headshotAsset, consentId) => {
        const signedUrl = headshotThumbnailUrls.get(headshotAsset.id) ?? null;
        consentHeadshotThumbnailMap.set(
          consentId,
          signedUrl
            ? resolveLoopbackStorageUrlForHostHeader(signedUrl, requestHostHeader)
            : null,
        );
        const previewSignedUrl = headshotPreviewUrls.get(headshotAsset.id) ?? null;
        if (previewSignedUrl) {
          consentHeadshotThumbnailMap.set(
            `${consentId}:preview`,
            resolveLoopbackStorageUrlForHostHeader(previewSignedUrl, requestHostHeader),
          );
        }
      });
    }
  }

  return (
    <div className="space-y-6">
      <section className="app-shell rounded-2xl px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-600">
              <Link href="/projects" className="font-medium text-zinc-700 underline underline-offset-4">
                {t("breadcrumbProjects")}
              </Link>
              <span>/</span>
              <span>{project.name}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <nav className="flex flex-wrap gap-2" aria-label={t("projectSectionsAria")}>
                <a
                  href="#project-participants"
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
                >
                  {t("sectionParticipants")}
                </a>
                <a
                  href="#project-assets"
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
                >
                  {t("sectionAssets")}
                </a>
              </nav>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.65fr)]">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">{project.name}</h1>
              <p className="mt-2 text-sm leading-6 text-zinc-600">
                {t("subtitle")}
              </p>
              {project.description ? (
                <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-800">{project.description}</p>
              ) : null}
              <div className="mt-4 space-y-3">
                <div className="rounded-xl border border-zinc-200 bg-white p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                    {t("workspaceSectionLabel")}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {workspaceSelection.workspaces.map((workspace) => {
                      const isSelected = selectedWorkspace?.id === workspace.id;
                      return (
                        <Link
                          key={workspace.id}
                          href={buildProjectWorkspaceHref(project.id, workspace.id, openConsentId || null)}
                          className={
                            isSelected
                              ? "inline-flex items-center gap-2 rounded-lg border border-zinc-900 bg-zinc-900 px-3 py-2 text-sm font-medium text-white"
                              : "inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
                          }
                        >
                          <span>{workspace.name}</span>
                          <span
                            className={`inline-flex rounded-md px-2 py-0.5 text-[11px] font-medium ${getWorkspaceWorkflowBadgeTone(
                              workspace.workflow_state,
                              isSelected,
                            )}`}
                          >
                            {t(`workflow.workspaceStates.${workspace.workflow_state}`)}
                          </span>
                        </Link>
                      );
                    })}
                  </div>
                  {selectedWorkspace ? (
                    <p className="mt-3 text-sm text-zinc-600">
                      {t("workspaceSelected", { name: selectedWorkspace.name })}
                    </p>
                  ) : (
                    <p className="mt-3 text-sm text-zinc-600">{t("workspaceNoneAssigned")}</p>
                  )}
                </div>

                {selectedWorkspace ? (
                  <ProjectWorkflowControls
                    projectId={project.id}
                    projectStatus={project.status}
                    canHandoffWorkspace={canOpenCaptureWorkspace}
                    canReviewWorkspace={canOpenReviewWorkspace}
                    canValidateCorrectionWorkspace={canCorrectionReview}
                    canFinalizeProject={canFinalizeProject}
                    canStartProjectCorrection={canStartProjectCorrection}
                    canReopenWorkspaceForCorrection={canReopenWorkspaceForCorrection}
                    selectedWorkspace={{
                      id: selectedWorkspace.id,
                      name: selectedWorkspace.name,
                      workflow_state: selectedWorkspace.workflow_state,
                      workflow_state_changed_at: selectedWorkspace.workflow_state_changed_at,
                      handed_off_at: selectedWorkspace.handed_off_at,
                      validated_at: selectedWorkspace.validated_at,
                      needs_changes_at: selectedWorkspace.needs_changes_at,
                      reopened_at: selectedWorkspace.reopened_at,
                    }}
                    selectedWorkspaceSummary={selectedWorkspaceWorkflow}
                    projectWorkflow={projectWorkflow}
                  />
                ) : null}

                {staffingMutationsAllowed ? (
                  <ProjectWorkspaceStaffingForm
                    projectId={project.id}
                    photographers={assignablePhotographers}
                    existingWorkspaces={workspaceSelection.workspaces.map((workspace) => ({
                      id: workspace.id,
                      photographerUserId: workspace.photographer_user_id,
                      name: workspace.name,
                    }))}
                  />
                ) : canManageProjectStaffing ? (
                  <p className="rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-700">
                    {project.finalized_at
                      ? t("workflow.staffingLockedFinalized")
                      : t("workflow.projectArchivedReadOnly")}
                  </p>
                ) : null}

                {projectReviewerAccessData ? (
                  <ProjectReviewerAccessPanel
                    projectId={project.id}
                    data={projectReviewerAccessData}
                  />
                ) : null}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              <div className="rounded-xl border border-zinc-200 bg-white p-3">
                <p className="text-sm text-zinc-500">{t("statsStatus")}</p>
                <p className="mt-1 font-medium text-zinc-900">
                  {t(`workflow.projectStates.${projectWorkflow.workflowState}`)}
                </p>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white p-3">
                <p className="text-sm text-zinc-500">{t("statsInvites")}</p>
                <p className="mt-1 font-medium text-zinc-900">{inviteCount}</p>
              </div>
              <div className="rounded-xl border border-zinc-200 bg-white p-3">
                <p className="text-sm text-zinc-500">{t("statsSignedConsents")}</p>
                <p className="mt-1 font-medium text-zinc-900">{consentCount ?? 0}</p>
              </div>
            </div>
          </div>

          {selectedWorkspace ? (
            <ProjectMatchingProgress
              projectId={project.id}
              workspaceId={selectedWorkspace.id}
              initialProgress={matchingProgress}
            />
          ) : null}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <section id="project-participants" className="section-anchor content-card space-y-6 rounded-2xl p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="text-lg font-semibold text-zinc-900">{t("participantsTitle")}</h2>
            </div>
          </div>
          {selectedWorkspace ? (
            <ProjectParticipantsPanel
              projectId={project.id}
              workspaceId={selectedWorkspace.id}
              data={participantPanelData}
              templates={templateOptions}
              defaultTemplateId={null}
              defaultTemplateWarning={correctionConsentNotice}
              allowConsentActions={
                canCreateRecurringProjectConsentRequests || correctionConsentMutationsAllowed
              }
              allowConsentMutations={consentIntakeActionsAllowed}
              profileHeadshotUrls={recurringProfileHeadshotUrls}
            />
          ) : (
            <p className="text-sm text-zinc-600">{t("workspaceNoData")}</p>
          )}
          {selectedWorkspace && canShowCaptureLockedNotice && !captureMutationsAllowed ? (
            <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
              {correctionOpen
                ? t("workflow.projectCorrectionCaptureLocked")
                : project.finalized_at
                ? t("workflow.projectFinalizedReadOnly")
                : selectedWorkspace.workflow_state === "validated"
                  ? t("workflow.captureLockedValidated")
                  : selectedWorkspace.workflow_state === "handed_off"
                    ? t("workflow.captureLockedHandedOff")
                    : t("workflow.projectArchivedReadOnly")}
            </p>
          ) : null}
          {selectedWorkspace && canShowReviewLockedNotice && !reviewSafeMutationsAllowed && selectedWorkspace.workflow_state === "validated" ? (
            <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
              {correctionOpen ? t("workflow.reviewLockedCorrectionValidated") : t("workflow.reviewLockedValidated")}
            </p>
          ) : null}

          {selectedWorkspace ? (
          <div className="space-y-4 border-t border-zinc-200 pt-6">
            <div>
              <h3 className="text-base font-semibold text-zinc-900">{t("oneOffParticipantsTitle")}</h3>
              {correctionConsentNotice ? (
                <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {correctionConsentNotice}
                </p>
              ) : null}
            </div>
            {currentInviteRows.length ? (
              <ul className="space-y-2 text-sm">
                {currentInviteRows.map((invite) => (
                  <li key={invite.id} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
                    <div className="flex flex-col gap-2">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          {invite.consents?.[0] ? (
                            <>
                              <p className="font-medium text-zinc-900">
                                {invite.consents[0].subjects?.full_name ?? t("unknownSubject")}
                              </p>
                              <p className="text-zinc-700">
                                {invite.consents[0].subjects?.email ?? t("unknownEmail")}
                              </p>
                            </>
                          ) : null}
                          <p className="text-zinc-700">
                            {t("templateLabel")}{" "}
                            {invite.consent_template
                              ? `${invite.consent_template.name} ${invite.consent_template.version}`
                              : t("unknownValue")}
                          </p>
                          <p className="text-zinc-700">
                            {t("inviteUsageLine", {
                              status: invite.status,
                              usedCount: invite.used_count,
                              maxUses: invite.max_uses,
                            })}
                          </p>
                          <p className="text-zinc-700">
                            {t("expiresLabel")}{" "}
                            {invite.expires_at ? formatDateTime(invite.expires_at, locale) : t("noneValue")}
                          </p>
                        </div>
                        {invite.consents?.[0] && consentHeadshotLinkMap.has(invite.consents[0].id) ? (
                          <div className="h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100">
                            <PreviewableImage
                              src={consentHeadshotThumbnailMap.get(invite.consents[0].id) ?? null}
                              previewSrc={consentHeadshotThumbnailMap.get(`${invite.consents[0].id}:preview`) ?? null}
                              alt={t("headshotAlt", {
                                fullName: invite.consents[0].subjects?.full_name ?? t("subjectFallback"),
                              })}
                              className="h-full w-full"
                              imageClassName="h-full w-full object-cover"
                              lightboxChrome="floating"
                            />
                          </div>
                        ) : null}
                      </div>
                      {canCreateOneOffInvites || correctionConsentMutationsAllowed ? (
                        <InviteActions
                          inviteId={invite.id}
                          projectId={project.id}
                          workspaceId={selectedWorkspace.id}
                          invitePath={invitePathMap.get(invite.id) ?? null}
                          isShareable={
                            invite.status === "active"
                            && invite.used_count === 0
                            && (
                              !correctionOpen
                              || isInviteFromActiveCorrectionCycle(invite, projectWorkflow)
                            )
                          }
                          isRevokable={
                            invite.status === "active"
                            && invite.used_count === 0
                            && (
                              inviteMutationsAllowed
                              || (
                                correctionConsentMutationsAllowed
                                && isInviteFromActiveCorrectionCycle(invite, projectWorkflow)
                              )
                            )
                          }
                        />
                      ) : null}
                      {invite.used_count > 0 && invite.consents?.[0] ? (
                        <details
                          id={`consent-${invite.consents[0].id}`}
                          open={invite.consents[0].id === openConsentId}
                          className="rounded-xl border border-zinc-200 bg-zinc-50 p-3"
                        >
                          <summary className="cursor-pointer text-sm font-medium text-zinc-900">
                            {t("viewConsentDetails")}
                          </summary>
                          <div className="mt-3 space-y-4 text-sm text-zinc-700">
                            {(() => {
                              const consent = invite.consents?.[0];
                              const hasLinkedHeadshot = consent
                                ? consentHeadshotLinkMap.has(consent.id)
                                : false;
                              const headshotThumbnailUrl = consent
                                ? consentHeadshotThumbnailMap.get(consent.id) ?? null
                                : null;
                              const headshotPreviewUrl = consent
                                ? consentHeadshotThumbnailMap.get(`${consent.id}:preview`) ?? null
                                : null;
                              return (
                                <>
                                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] lg:items-stretch">
                                    <section className="flex h-full flex-col gap-4 rounded-xl border border-zinc-200 bg-white p-4">
                                      <div className="grid gap-3 sm:grid-cols-2">
                                        <div className="rounded-xl bg-zinc-50 p-3">
                                          <p className="text-sm text-zinc-500">
                                            {t("subjectNameLabel")}
                                          </p>
                                          <p className="mt-1 text-sm font-medium text-zinc-900">
                                            {consent?.subjects?.full_name ?? t("unknownValue")}
                                          </p>
                                        </div>
                                        <div className="rounded-xl bg-zinc-50 p-3">
                                          <p className="text-sm text-zinc-500">
                                            {t("subjectEmailLabel")}
                                          </p>
                                          <p className="mt-1 text-sm font-medium text-zinc-900">
                                            {consent?.subjects?.email ?? t("unknownValue")}
                                          </p>
                                        </div>
                                        <div className="rounded-xl bg-zinc-50 p-3">
                                          <p className="text-sm text-zinc-500">
                                            {t("signedAtLabel")}
                                          </p>
                                          <p className="mt-1 text-sm font-medium text-zinc-900">
                                            {consent?.signed_at
                                              ? formatDateTime(consent.signed_at, locale)
                                              : t("unknownValue")}
                                          </p>
                                        </div>
                                        <div className="rounded-xl bg-zinc-50 p-3">
                                          <p className="text-sm text-zinc-500">
                                            {t("consentVersionLabel")}
                                          </p>
                                          <p className="mt-1 text-sm font-medium text-zinc-900">
                                            {consent?.consent_version ?? t("unknownValue")}
                                          </p>
                                        </div>
                                      </div>

                                      <div className="flex flex-1 flex-col rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                                        <p className="text-sm text-zinc-500">
                                          {t("consentTextLabel")}
                                        </p>
                                        <p className="mt-2 flex-1 whitespace-pre-line leading-6 text-zinc-800">
                                          {consent?.consent_text ?? t("unknownValue")}
                                        </p>
                                      </div>

                                      {consent?.structured_fields_snapshot ? (
                                        <ConsentStructuredSnapshot
                                          snapshot={consent.structured_fields_snapshot}
                                          strings={{
                                            title: t("structuredValuesTitle"),
                                            noneValue: t("noneValue"),
                                          }}
                                        />
                                      ) : (
                                        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                                          <p className="text-sm text-zinc-500">
                                            {t("structuredValuesTitle")}
                                          </p>
                                          <p className="mt-2 text-sm text-zinc-800">
                                            {t("structuredValuesLegacy")}
                                          </p>
                                        </div>
                                      )}

                                      {reviewConsentFlowMutationsAllowed && consent && invite.consent_template ? (
                                        <OneOffConsentUpgradeForm
                                          projectId={project.id}
                                          consentId={consent.id}
                                          currentTemplateId={invite.consent_template.id}
                                          currentTemplateKey={invite.consent_template.template_key}
                                          currentTemplateVersionNumber={invite.consent_template.version_number}
                                          templates={templateOptions}
                                          initialPendingRequest={
                                            pendingUpgradeRequestMap.get(consent.id) ?? null
                                          }
                                        />
                                      ) : null}
                                    </section>

                                    <section className="space-y-4 rounded-xl border border-zinc-200 bg-white p-4">
                                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                                        <div className="rounded-xl bg-zinc-50 p-3">
                                          <p className="text-sm text-zinc-500">
                                            {t("facialMatchingLabel")}
                                          </p>
                                          <p className="mt-1 text-sm font-medium text-zinc-900">
                                            {consent?.face_match_opt_in ? t("enabledValue") : t("disabledValue")}
                                          </p>
                                        </div>
                                        <div className="rounded-xl bg-zinc-50 p-3">
                                          <p className="text-sm text-zinc-500">
                                            {t("headshotStatusLabel")}
                                          </p>
                                          <p className="mt-1 text-sm font-medium text-zinc-900">
                                            {consent?.face_match_opt_in
                                              ? hasLinkedHeadshot
                                                ? t("headshotLinked")
                                                : t("headshotMissing")
                                              : t("notApplicableValue")}
                                          </p>
                                        </div>
                                      </div>

                                      {consent?.face_match_opt_in && hasLinkedHeadshot ? (
                                        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
                                          <p className="text-sm text-zinc-500">
                                            {t("headshotPreviewLabel")}
                                          </p>
                                          <div className="mt-3 h-32 w-32 overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100">
                                            <PreviewableImage
                                              src={headshotThumbnailUrl}
                                              previewSrc={headshotPreviewUrl}
                                              alt={t("headshotAlt", {
                                                fullName: consent?.subjects?.full_name ?? t("subjectFallback"),
                                              })}
                                              className="h-full w-full"
                                              imageClassName="h-full w-full object-cover"
                                              lightboxChrome="floating"
                                            />
                                          </div>
                                        </div>
                                      ) : null}

                                      {headshotReplacementAllowed && consent?.face_match_opt_in && hasLinkedHeadshot ? (
                                        <ConsentHeadshotReplaceControl
                                          projectId={project.id}
                                          consentId={consent.id}
                                        />
                                      ) : null}
                                    </section>
                                  </div>

                                  {reviewSafeMutationsAllowed && consent ? (
                                    <ConsentAssetMatchingPanel
                                      projectId={project.id}
                                      consentId={consent.id}
                                      workspaceId={selectedWorkspace.id}
                                    />
                                  ) : null}
                                </>
                              );
                            })()}
                          </div>
                        </details>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-zinc-600">{t("noInvitesYet")}</p>
            )}
          </div>
          ) : null}
        </section>

        {(inviteMutationsAllowed || correctionConsentMutationsAllowed) && selectedWorkspace ? (
          <aside>
            <CreateInviteForm
              projectId={project.id}
              workspaceId={selectedWorkspace.id}
              templates={templateOptions}
              defaultTemplateId={null}
              warning={correctionConsentNotice}
            />
          </aside>
        ) : null}
      </div>

      <section id="project-assets" className="section-anchor content-card space-y-4 rounded-2xl p-5">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">{t("assetsTitle")}</h2>
            <p className="mt-1 text-sm text-zinc-600">
              {t("assetsSubtitle")}
            </p>
          </div>
        </div>
        {selectedWorkspace && canUploadAssets && !assetUploadAllowed && !correctionMediaIntakeAllowed ? (
          <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
            {correctionOpen
              ? t("workflow.projectCorrectionCaptureLocked")
              : project.finalized_at
              ? t("workflow.projectFinalizedReadOnly")
              : selectedWorkspace.workflow_state === "validated"
                ? t("workflow.captureLockedValidated")
                : selectedWorkspace.workflow_state === "handed_off"
                  ? t("workflow.captureLockedHandedOff")
                  : t("workflow.projectArchivedReadOnly")}
          </p>
        ) : null}
        {(assetUploadAllowed || correctionMediaIntakeAllowed) && selectedWorkspace ? (
          <AssetsUploadForm
            projectId={project.id}
            workspaceId={selectedWorkspace.id}
            mode={correctionMediaIntakeAllowed && !assetUploadAllowed ? "correction" : "capture"}
          />
        ) : null}
        {selectedWorkspace && canShowReviewLockedNotice && !reviewSafeMutationsAllowed && selectedWorkspace.workflow_state === "validated" ? (
          <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
            {correctionOpen ? t("workflow.reviewLockedCorrectionValidated") : t("workflow.reviewLockedValidated")}
          </p>
        ) : null}
        {selectedWorkspace ? (
          <AssetsList projectId={project.id} workspaceId={selectedWorkspace.id} />
        ) : (
          <p className="text-sm text-zinc-600">{t("workspaceNoData")}</p>
        )}
      </section>
    </div>
  );
}
