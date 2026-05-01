import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import { getAssetReviewSummaries } from "@/lib/matching/asset-preview-linking";
import { getProjectMatchingProgress } from "@/lib/matching/project-matching-progress";
import { loadPublishedProjectReleaseByFinalizedAt } from "@/lib/project-releases/project-release-service";
import type { AccessibleProjectWorkspace } from "@/lib/tenant/permissions";

export const WORKSPACE_WORKFLOW_STATES = [
  "active",
  "handed_off",
  "needs_changes",
  "validated",
] as const;

export const PROJECT_CORRECTION_STATES = ["none", "open"] as const;
export const PROJECT_WORKFLOW_STATES = [
  "active",
  "ready_to_finalize",
  "finalized",
  "correction_open",
  "correction_ready_to_finalize",
] as const;

export type ProjectCorrectionState = (typeof PROJECT_CORRECTION_STATES)[number];
export type WorkspaceWorkflowState = (typeof WORKSPACE_WORKFLOW_STATES)[number];
export type ProjectWorkflowState = (typeof PROJECT_WORKFLOW_STATES)[number];

type ProjectWorkflowRow = {
  id: string;
  status: "active" | "archived";
  finalized_at: string | null;
  finalized_by: string | null;
  correction_state: ProjectCorrectionState;
  correction_opened_at: string | null;
  correction_opened_by: string | null;
  correction_source_release_id: string | null;
  correction_reason: string | null;
};

type ProjectWorkflowTransitionAction = "handoff" | "validate" | "needs_changes" | "reopen";

type WorkspaceValidationBlockers = {
  matchingInProgress: boolean;
  degradedMatchingState: boolean;
  pendingAssetCount: number;
  needsReviewAssetCount: number;
  activeInviteCount: number;
  pendingRecurringConsentRequestCount: number;
  pendingConsentUpgradeRequestCount: number;
};

export type CorrectionRequestProvenance = {
  requestSource: "correction";
  correctionOpenedAtSnapshot: string;
  correctionSourceReleaseIdSnapshot: string;
};

export type WorkspaceWorkflowSummary = {
  workspaceId: string;
  workflowState: WorkspaceWorkflowState;
  blockers: WorkspaceValidationBlockers;
  isReadyForValidation: boolean;
};

export type ProjectWorkflowSummary = {
  projectId: string;
  status: "active" | "archived";
  finalizedAt: string | null;
  finalizedBy: string | null;
  workflowState: ProjectWorkflowState;
  correctionState: ProjectCorrectionState;
  correctionOpenedAt: string | null;
  correctionOpenedBy: string | null;
  correctionSourceReleaseId: string | null;
  correctionReason: string | null;
  hasCorrectionReopenedWorkspaces: boolean;
  totalWorkspaceCount: number;
  validatedWorkspaceCount: number;
  allWorkspacesValidated: boolean;
  hasValidationBlockers: boolean;
  workspaces: WorkspaceWorkflowSummary[];
};

type GetProjectWorkflowSummaryInput = {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  workspaces?: AccessibleProjectWorkspace[];
};

type GetWorkspaceWorkflowSummaryInput = {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  workspace: AccessibleProjectWorkspace;
};

type ApplyWorkspaceWorkflowTransitionInput = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  projectId: string;
  workspaceId: string;
  action: ProjectWorkflowTransitionAction;
};

type FinalizeProjectInput = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  projectId: string;
};

type StartProjectCorrectionInput = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  projectId: string;
  reason?: string | null;
};

type ReopenWorkspaceForCorrectionInput = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  projectId: string;
  workspaceId: string;
};

type WorkspaceWorkflowRow = AccessibleProjectWorkspace;

type UpdateWorkspaceValues = {
  workflow_state: WorkspaceWorkflowState;
  workflow_state_changed_at: string;
  workflow_state_changed_by: string;
  handed_off_at?: string;
  handed_off_by?: string;
  validated_at?: string;
  validated_by?: string;
  needs_changes_at?: string;
  needs_changes_by?: string;
  reopened_at?: string;
  reopened_by?: string;
};

const WORKSPACE_WORKFLOW_SELECT =
  "id, tenant_id, project_id, workspace_kind, photographer_user_id, name, created_by, created_at, workflow_state, workflow_state_changed_at, workflow_state_changed_by, handed_off_at, handed_off_by, validated_at, validated_by, needs_changes_at, needs_changes_by, reopened_at, reopened_by";

const WORKSPACE_CAPTURE_MUTATION_STATES = new Set<WorkspaceWorkflowState>(["active", "needs_changes"]);
const WORKSPACE_REVIEW_MUTATION_STATES = new Set<WorkspaceWorkflowState>(["handed_off", "needs_changes"]);
const WORKSPACE_PUBLIC_SUBMISSION_STATES = new Set<WorkspaceWorkflowState>([
  "active",
  "handed_off",
  "needs_changes",
]);

function isWorkspaceWorkflowState(value: string): value is WorkspaceWorkflowState {
  return WORKSPACE_WORKFLOW_STATES.includes(value as WorkspaceWorkflowState);
}

function isProjectArchived(project: ProjectWorkflowRow) {
  return project.status !== "active";
}

function isProjectFinalized(project: ProjectWorkflowRow) {
  return project.finalized_at !== null;
}

function isWorkspaceCorrectionReopenedForCurrentCycle(input: {
  project: Pick<ProjectWorkflowRow, "correction_opened_at">;
  workspace: Pick<AccessibleProjectWorkspace, "workflow_state" | "reopened_at">;
}) {
  return (
    input.workspace.workflow_state === "handed_off"
    && input.project.correction_opened_at !== null
    && input.workspace.reopened_at !== null
    && input.workspace.reopened_at >= input.project.correction_opened_at
  );
}

export function isProjectCorrectionOpen(project: Pick<ProjectWorkflowRow, "correction_state">) {
  return project.correction_state === "open";
}

export function assertProjectCorrectionOpen(project: ProjectWorkflowRow) {
  if (!isProjectCorrectionOpen(project)) {
    throw new HttpError(409, "project_correction_not_open", "Project correction is not open.");
  }
}

function countBlockers(blockers: WorkspaceValidationBlockers) {
  return (
    Number(blockers.matchingInProgress) +
    Number(blockers.degradedMatchingState) +
    blockers.pendingAssetCount +
    blockers.needsReviewAssetCount +
    blockers.activeInviteCount +
    blockers.pendingRecurringConsentRequestCount +
    blockers.pendingConsentUpgradeRequestCount
  );
}

async function loadProjectWorkflowRow(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
): Promise<ProjectWorkflowRow> {
  const { data, error } = await supabase
    .from("projects")
    .select(
      "id, status, finalized_at, finalized_by, correction_state, correction_opened_at, correction_opened_by, correction_source_release_id, correction_reason",
    )
    .eq("tenant_id", tenantId)
    .eq("id", projectId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "project_lookup_failed", "Unable to load project.");
  }

  if (!data) {
    throw new HttpError(404, "project_not_found", "Project not found.");
  }

  return data as ProjectWorkflowRow;
}

async function loadWorkspaceWorkflowRow(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  workspaceId: string,
): Promise<WorkspaceWorkflowRow> {
  const { data, error } = await supabase
    .from("project_workspaces")
    .select(WORKSPACE_WORKFLOW_SELECT)
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("id", workspaceId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "workspace_lookup_failed", "Unable to load project workspace.");
  }

  if (!data) {
    throw new HttpError(404, "workspace_not_found", "Project workspace not found.");
  }

  return data as WorkspaceWorkflowRow;
}

async function listProjectWorkflowWorkspaces(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
): Promise<WorkspaceWorkflowRow[]> {
  const { data, error } = await supabase
    .from("project_workspaces")
    .select(WORKSPACE_WORKFLOW_SELECT)
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new HttpError(500, "workspace_lookup_failed", "Unable to load project workspaces.");
  }

  return (data as WorkspaceWorkflowRow[] | null) ?? [];
}

async function countRows(
  query: Promise<{
    count: number | null;
    error: unknown | null;
  }>,
): Promise<number> {
  const { count, error } = await query;
  if (error) {
    throw new HttpError(500, "workflow_blocker_lookup_failed", "Unable to validate workflow readiness.");
  }

  return count ?? 0;
}

function getRetryOutcomeForTransitionAction(
  action: ProjectWorkflowTransitionAction,
  workspace: WorkspaceWorkflowRow,
) {
  switch (action) {
    case "handoff":
      return workspace.workflow_state === "handed_off";
    case "validate":
      return workspace.workflow_state === "validated";
    case "needs_changes":
      return (
        workspace.workflow_state === "needs_changes"
        && workspace.needs_changes_at !== null
        && workspace.workflow_state_changed_at === workspace.needs_changes_at
        && workspace.workflow_state_changed_at !== workspace.reopened_at
      );
    case "reopen":
      return (
        workspace.workflow_state === "needs_changes"
        && workspace.reopened_at !== null
        && workspace.workflow_state_changed_at === workspace.reopened_at
      );
    default:
      return false;
  }
}

function getTransitionDefinition(action: ProjectWorkflowTransitionAction) {
  switch (action) {
    case "handoff":
      return {
        allowedFrom: ["active", "needs_changes"] as WorkspaceWorkflowState[],
        targetState: "handed_off" as WorkspaceWorkflowState,
      };
    case "validate":
      return {
        allowedFrom: ["handed_off"] as WorkspaceWorkflowState[],
        targetState: "validated" as WorkspaceWorkflowState,
      };
    case "needs_changes":
      return {
        allowedFrom: ["handed_off"] as WorkspaceWorkflowState[],
        targetState: "needs_changes" as WorkspaceWorkflowState,
      };
    case "reopen":
      return {
        allowedFrom: ["validated"] as WorkspaceWorkflowState[],
        targetState: "needs_changes" as WorkspaceWorkflowState,
      };
    default:
      throw new HttpError(500, "workflow_transition_invalid", "Unable to process the workflow transition.");
  }
}

function buildTransitionUpdate(
  action: ProjectWorkflowTransitionAction,
  userId: string,
): UpdateWorkspaceValues {
  const now = new Date().toISOString();

  switch (action) {
    case "handoff":
      return {
        workflow_state: "handed_off",
        workflow_state_changed_at: now,
        workflow_state_changed_by: userId,
        handed_off_at: now,
        handed_off_by: userId,
      };
    case "validate":
      return {
        workflow_state: "validated",
        workflow_state_changed_at: now,
        workflow_state_changed_by: userId,
        validated_at: now,
        validated_by: userId,
      };
    case "needs_changes":
      return {
        workflow_state: "needs_changes",
        workflow_state_changed_at: now,
        workflow_state_changed_by: userId,
        needs_changes_at: now,
        needs_changes_by: userId,
      };
    case "reopen":
      return {
        workflow_state: "needs_changes",
        workflow_state_changed_at: now,
        workflow_state_changed_by: userId,
        needs_changes_at: now,
        needs_changes_by: userId,
        reopened_at: now,
        reopened_by: userId,
      };
    default:
      throw new HttpError(500, "workflow_transition_invalid", "Unable to process the workflow transition.");
  }
}

export async function getWorkspaceWorkflowSummary(
  input: GetWorkspaceWorkflowSummaryInput,
): Promise<WorkspaceWorkflowSummary> {
  const [
    matchingProgress,
    assetRowsResult,
    pendingMediaCount,
    activeInviteCount,
    pendingRecurringRequestCount,
    pendingUpgradeCount,
  ] =
    await Promise.all([
      getProjectMatchingProgress(input.supabase, input.tenantId, input.projectId, input.workspace.id),
      input.supabase
        .from("assets")
        .select("id")
        .eq("tenant_id", input.tenantId)
        .eq("project_id", input.projectId)
        .eq("workspace_id", input.workspace.id)
        .eq("asset_type", "photo")
        .eq("status", "uploaded")
        .is("archived_at", null),
      countRows(
        input.supabase
          .from("assets")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", input.tenantId)
          .eq("project_id", input.projectId)
          .eq("workspace_id", input.workspace.id)
          .in("asset_type", ["photo", "video"])
          .eq("status", "pending")
          .is("archived_at", null),
      ),
      countRows(
        input.supabase
          .from("subject_invites")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", input.tenantId)
          .eq("project_id", input.projectId)
          .eq("workspace_id", input.workspace.id)
          .eq("status", "active"),
      ),
      countRows(
        input.supabase
          .from("recurring_profile_consent_requests")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", input.tenantId)
          .eq("project_id", input.projectId)
          .eq("workspace_id", input.workspace.id)
          .eq("status", "pending"),
      ),
      countRows(
        input.supabase
          .from("project_consent_upgrade_requests")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", input.tenantId)
          .eq("project_id", input.projectId)
          .eq("workspace_id", input.workspace.id)
          .eq("status", "pending"),
      ),
    ]);

  if (assetRowsResult.error) {
    throw new HttpError(500, "workflow_blocker_lookup_failed", "Unable to validate workflow readiness.");
  }

  const assetIds = ((assetRowsResult.data as Array<{ id: string }> | null) ?? []).map((asset) => asset.id);
  const reviewSummaryByAssetId = await getAssetReviewSummaries({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
    workspaceId: input.workspace.id,
    assetIds,
  });

  let pendingAssetCount = 0;
  let needsReviewAssetCount = 0;
  for (const reviewSummary of reviewSummaryByAssetId.values()) {
    if (reviewSummary.reviewStatus === "pending") {
      pendingAssetCount += 1;
      continue;
    }

    if (reviewSummary.reviewStatus === "needs_review") {
      needsReviewAssetCount += 1;
    }
  }
  pendingAssetCount += pendingMediaCount;

  const blockers: WorkspaceValidationBlockers = {
    matchingInProgress: matchingProgress.isMatchingInProgress,
    degradedMatchingState: matchingProgress.hasDegradedMatchingState,
    pendingAssetCount,
    needsReviewAssetCount,
    activeInviteCount,
    pendingRecurringConsentRequestCount: pendingRecurringRequestCount,
    pendingConsentUpgradeRequestCount: pendingUpgradeCount,
  };

  return {
    workspaceId: input.workspace.id,
    workflowState: input.workspace.workflow_state,
    blockers,
    isReadyForValidation: countBlockers(blockers) === 0,
  };
}

export async function getProjectWorkflowSummary(
  input: GetProjectWorkflowSummaryInput,
): Promise<ProjectWorkflowSummary> {
  const [project, workspaces] = await Promise.all([
    loadProjectWorkflowRow(input.supabase, input.tenantId, input.projectId),
    input.workspaces ? Promise.resolve(input.workspaces) : listProjectWorkflowWorkspaces(input.supabase, input.tenantId, input.projectId),
  ]);

  const workspaceSummaries = await Promise.all(
    workspaces.map((workspace) =>
      getWorkspaceWorkflowSummary({
        supabase: input.supabase,
        tenantId: input.tenantId,
        projectId: input.projectId,
        workspace,
      }),
    ),
  );

  const validatedWorkspaceCount = workspaceSummaries.filter(
    (workspaceSummary) => workspaceSummary.workflowState === "validated",
  ).length;
  const allWorkspacesValidated = workspaceSummaries.length > 0 && validatedWorkspaceCount === workspaceSummaries.length;
  const hasValidationBlockers = workspaceSummaries.some((workspaceSummary) => !workspaceSummary.isReadyForValidation);
  const hasCorrectionReopenedWorkspaces = isProjectCorrectionOpen(project)
    && project.correction_opened_at !== null
    && workspaces.some(
      (workspace) =>
        workspace.reopened_at !== null
        && workspace.reopened_at >= project.correction_opened_at!,
    );

  return {
    projectId: project.id,
    status: project.status,
    finalizedAt: project.finalized_at,
    finalizedBy: project.finalized_by,
    workflowState: isProjectFinalized(project)
      ? isProjectCorrectionOpen(project)
        ? allWorkspacesValidated && !hasValidationBlockers && hasCorrectionReopenedWorkspaces
          ? "correction_ready_to_finalize"
          : "correction_open"
        : "finalized"
      : allWorkspacesValidated && !hasValidationBlockers
        ? "ready_to_finalize"
        : "active",
    correctionState: project.correction_state,
    correctionOpenedAt: project.correction_opened_at,
    correctionOpenedBy: project.correction_opened_by,
    correctionSourceReleaseId: project.correction_source_release_id,
    correctionReason: project.correction_reason,
    hasCorrectionReopenedWorkspaces,
    totalWorkspaceCount: workspaceSummaries.length,
    validatedWorkspaceCount,
    allWorkspacesValidated,
    hasValidationBlockers,
    workspaces: workspaceSummaries,
  };
}

export async function assertProjectWorkflowMutable(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
): Promise<ProjectWorkflowRow> {
  const project = await loadProjectWorkflowRow(supabase, tenantId, projectId);

  if (isProjectArchived(project)) {
    throw new HttpError(409, "project_archived", "Archived projects do not accept workflow changes.");
  }

  if (isProjectFinalized(project)) {
    throw new HttpError(409, "project_finalized", "Finalized projects are read-only.");
  }

  return project;
}

export function assertWorkspaceCaptureMutationAllowed(input: {
  project: ProjectWorkflowRow;
  workspace: Pick<AccessibleProjectWorkspace, "workflow_state">;
}) {
  if (isProjectArchived(input.project)) {
    throw new HttpError(409, "project_archived", "Archived projects do not accept capture changes.");
  }

  if (isProjectFinalized(input.project)) {
    throw new HttpError(409, "project_finalized", "Finalized projects are read-only.");
  }

  if (!WORKSPACE_CAPTURE_MUTATION_STATES.has(input.workspace.workflow_state)) {
    throw new HttpError(
      409,
      "workspace_capture_locked",
      "This workspace is not accepting authenticated capture changes.",
    );
  }
}

export function assertWorkspaceReviewMutationAllowed(input: {
  project: ProjectWorkflowRow;
  workspace: Pick<AccessibleProjectWorkspace, "workflow_state">;
  allowValidated?: boolean;
}) {
  if (isProjectArchived(input.project)) {
    throw new HttpError(409, "project_archived", "Archived projects do not accept review changes.");
  }

  if (isProjectFinalized(input.project)) {
    throw new HttpError(409, "project_finalized", "Finalized projects are read-only.");
  }

  if (
    input.allowValidated === true
    && input.workspace.workflow_state === "validated"
  ) {
    return;
  }

  if (!WORKSPACE_REVIEW_MUTATION_STATES.has(input.workspace.workflow_state)) {
    throw new HttpError(
      409,
      "workspace_review_locked",
      "This workspace is not accepting review changes.",
    );
  }
}

export function assertWorkspaceCorrectionReviewMutationAllowed(input: {
  project: ProjectWorkflowRow;
  workspace: Pick<AccessibleProjectWorkspace, "workflow_state">;
}) {
  if (isProjectArchived(input.project)) {
    throw new HttpError(409, "project_archived", "Archived projects do not accept review changes.");
  }

  if (!isProjectFinalized(input.project)) {
    assertWorkspaceReviewMutationAllowed({
      project: input.project,
      workspace: input.workspace,
    });
    return;
  }

  if (!isProjectCorrectionOpen(input.project)) {
    throw new HttpError(409, "project_finalized", "Finalized projects are read-only.");
  }

  if (input.workspace.workflow_state !== "handed_off") {
    throw new HttpError(
      409,
      "workspace_review_locked",
      "This workspace is not accepting review changes.",
    );
  }
}

export function assertWorkspaceCorrectionConsentIntakeAllowed(input: {
  project: ProjectWorkflowRow;
  workspace: Pick<AccessibleProjectWorkspace, "workflow_state" | "reopened_at">;
}) {
  if (isProjectArchived(input.project)) {
    throw new HttpError(409, "project_archived", "Archived projects do not accept consent intake changes.");
  }

  if (!isProjectFinalized(input.project)) {
    throw new HttpError(409, "project_not_finalized", "Correction consent intake requires a finalized project.");
  }

  if (!isProjectCorrectionOpen(input.project)) {
    throw new HttpError(409, "project_finalized", "Finalized projects are read-only.");
  }

  if (!isWorkspaceCorrectionReopenedForCurrentCycle(input)) {
    throw new HttpError(
      409,
      "workspace_correction_consent_locked",
      "This workspace is not accepting correction consent intake.",
    );
  }
}

export function assertWorkspaceCorrectionMediaIntakeAllowed(input: {
  project: ProjectWorkflowRow;
  workspace: Pick<AccessibleProjectWorkspace, "workflow_state" | "reopened_at">;
}) {
  if (isProjectArchived(input.project)) {
    throw new HttpError(409, "project_archived", "Archived projects do not accept media intake changes.");
  }

  if (!isProjectFinalized(input.project)) {
    throw new HttpError(409, "project_not_finalized", "Correction media intake requires a finalized project.");
  }

  if (!isProjectCorrectionOpen(input.project)) {
    throw new HttpError(409, "project_finalized", "Finalized projects are read-only.");
  }

  if (!isWorkspaceCorrectionReopenedForCurrentCycle(input)) {
    throw new HttpError(
      409,
      "workspace_correction_media_locked",
      "This workspace is not accepting correction media uploads.",
    );
  }
}

export function buildCorrectionRequestProvenance(
  project: Pick<ProjectWorkflowRow, "finalized_at" | "correction_state" | "correction_opened_at" | "correction_source_release_id">,
): CorrectionRequestProvenance {
  if (
    !isProjectFinalized(project as ProjectWorkflowRow)
    || !isProjectCorrectionOpen(project)
    || !project.correction_opened_at
    || !project.correction_source_release_id
  ) {
    throw new HttpError(409, "project_finalized", "Finalized projects are read-only.");
  }

  return {
    requestSource: "correction",
    correctionOpenedAtSnapshot: project.correction_opened_at,
    correctionSourceReleaseIdSnapshot: project.correction_source_release_id,
  };
}

export function assertCorrectionRequestProvenanceMatchesActiveCycle(input: {
  project: Pick<ProjectWorkflowRow, "finalized_at" | "correction_state" | "correction_opened_at" | "correction_source_release_id">;
  provenance: {
    requestSource: "normal" | "correction";
    correctionOpenedAtSnapshot: string | null;
    correctionSourceReleaseIdSnapshot: string | null;
  };
}) {
  const expectedProvenance = buildCorrectionRequestProvenance(input.project);
  if (
    input.provenance.requestSource !== "correction"
    || input.provenance.correctionOpenedAtSnapshot !== expectedProvenance.correctionOpenedAtSnapshot
    || input.provenance.correctionSourceReleaseIdSnapshot !== expectedProvenance.correctionSourceReleaseIdSnapshot
  ) {
    throw new HttpError(409, "project_finalized", "Finalized projects are read-only.");
  }
}

export async function assertWorkspaceCorrectionPublicSubmissionAllowed(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  workspaceId: string,
  provenance: {
    requestSource: "normal" | "correction";
    correctionOpenedAtSnapshot: string | null;
    correctionSourceReleaseIdSnapshot: string | null;
  },
): Promise<{
  project: ProjectWorkflowRow;
  workspace: WorkspaceWorkflowRow;
}> {
  const [project, workspace] = await Promise.all([
    loadProjectWorkflowRow(supabase, tenantId, projectId),
    loadWorkspaceWorkflowRow(supabase, tenantId, projectId, workspaceId),
  ]);

  if (isProjectArchived(project)) {
    throw new HttpError(409, "workspace_not_accepting_submissions", "This workspace is no longer accepting submissions.");
  }

  assertWorkspaceCorrectionConsentIntakeAllowed({
    project,
    workspace,
  });
  assertCorrectionRequestProvenanceMatchesActiveCycle({
    project,
    provenance,
  });

  return {
    project,
    workspace,
  };
}

export async function assertWorkspacePublicSubmissionAllowed(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  workspaceId: string,
): Promise<{
  project: ProjectWorkflowRow;
  workspace: WorkspaceWorkflowRow;
}> {
  const [project, workspace] = await Promise.all([
    loadProjectWorkflowRow(supabase, tenantId, projectId),
    loadWorkspaceWorkflowRow(supabase, tenantId, projectId, workspaceId),
  ]);

  if (isProjectArchived(project)) {
    throw new HttpError(409, "workspace_not_accepting_submissions", "This workspace is no longer accepting submissions.");
  }

  if (isProjectFinalized(project)) {
    throw new HttpError(409, "project_finalized", "This project is finalized.");
  }

  if (!WORKSPACE_PUBLIC_SUBMISSION_STATES.has(workspace.workflow_state)) {
    throw new HttpError(409, "workspace_not_accepting_submissions", "This workspace is no longer accepting submissions.");
  }

  return {
    project,
    workspace,
  };
}

export async function applyWorkspaceWorkflowTransition(
  input: ApplyWorkspaceWorkflowTransitionInput,
): Promise<{
  workspace: WorkspaceWorkflowRow;
  projectWorkflow: ProjectWorkflowSummary;
  changed: boolean;
}> {
  const project = await loadProjectWorkflowRow(input.supabase, input.tenantId, input.projectId);
  if (isProjectArchived(project)) {
    throw new HttpError(409, "project_archived", "Archived projects do not accept workflow changes.");
  }

  if (
    isProjectFinalized(project)
    && !(input.action === "validate" && isProjectCorrectionOpen(project))
  ) {
    throw new HttpError(409, "project_finalized", "Finalized projects are read-only.");
  }

  const workspace = await loadWorkspaceWorkflowRow(
    input.supabase,
    input.tenantId,
    input.projectId,
    input.workspaceId,
  );

  if (!isWorkspaceWorkflowState(workspace.workflow_state)) {
    throw new HttpError(409, "workspace_workflow_invalid", "This workspace has an invalid workflow state.");
  }

  const transition = getTransitionDefinition(input.action);

  if (!transition.allowedFrom.includes(workspace.workflow_state)) {
    if (getRetryOutcomeForTransitionAction(input.action, workspace)) {
      return {
        workspace,
        projectWorkflow: await getProjectWorkflowSummary({
          supabase: input.supabase,
          tenantId: input.tenantId,
          projectId: input.projectId,
        }),
        changed: false,
      };
    }

    throw new HttpError(409, "workspace_transition_conflict", "This workflow transition is not allowed from the current workspace state.");
  }

  if (input.action === "validate") {
    const workspaceWorkflow = await getWorkspaceWorkflowSummary({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
      workspace,
    });

    if (!workspaceWorkflow.isReadyForValidation) {
      throw new HttpError(409, "workspace_validation_blocked", "The workspace still has unresolved validation blockers.");
    }
  }

  const updateValues = buildTransitionUpdate(input.action, input.userId);
  const { data: updatedWorkspace, error: updateError } = await input.supabase
    .from("project_workspaces")
    .update(updateValues)
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("id", input.workspaceId)
    .in("workflow_state", transition.allowedFrom)
    .select(WORKSPACE_WORKFLOW_SELECT)
    .maybeSingle();

  if (updateError) {
    throw new HttpError(500, "workspace_transition_failed", "Unable to update the workspace workflow state.");
  }

  if (!updatedWorkspace) {
    const currentWorkspace = await loadWorkspaceWorkflowRow(
      input.supabase,
      input.tenantId,
      input.projectId,
      input.workspaceId,
    );
    const currentProject = await loadProjectWorkflowRow(input.supabase, input.tenantId, input.projectId);

    if (getRetryOutcomeForTransitionAction(input.action, currentWorkspace)) {
      return {
        workspace: currentWorkspace,
        projectWorkflow: await getProjectWorkflowSummary({
          supabase: input.supabase,
          tenantId: input.tenantId,
          projectId: input.projectId,
        }),
        changed: false,
      };
    }

    if (isProjectArchived(currentProject)) {
      throw new HttpError(409, "project_archived", "Archived projects do not accept workflow changes.");
    }

    if (
      isProjectFinalized(currentProject)
      && !(input.action === "validate" && isProjectCorrectionOpen(currentProject))
    ) {
      throw new HttpError(409, "project_finalized", "Finalized projects are read-only.");
    }

    throw new HttpError(409, "workspace_transition_conflict", "This workflow transition conflicted with another update.");
  }

  return {
    workspace: updatedWorkspace as WorkspaceWorkflowRow,
    projectWorkflow: await getProjectWorkflowSummary({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
    }),
    changed: true,
  };
}

export async function startProjectCorrection(
  input: StartProjectCorrectionInput,
): Promise<{
  projectWorkflow: ProjectWorkflowSummary;
  changed: boolean;
}> {
  const project = await loadProjectWorkflowRow(input.supabase, input.tenantId, input.projectId);

  if (isProjectArchived(project)) {
    throw new HttpError(409, "project_archived", "Archived projects do not accept workflow changes.");
  }

  if (!isProjectFinalized(project)) {
    throw new HttpError(
      409,
      "project_correction_not_finalized",
      "Project correction can only start after finalization.",
    );
  }

  const publishedRelease = await loadPublishedProjectReleaseByFinalizedAt({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
    finalizedAt: project.finalized_at as string,
  });

  if (!publishedRelease) {
    throw new HttpError(
      409,
      "project_correction_release_missing",
      "The current published release is missing. Retry finalization to repair it before starting correction.",
    );
  }

  if (isProjectCorrectionOpen(project)) {
    return {
      projectWorkflow: await getProjectWorkflowSummary({
        supabase: input.supabase,
        tenantId: input.tenantId,
        projectId: input.projectId,
      }),
      changed: false,
    };
  }

  const correctionReason = input.reason?.trim() ? input.reason.trim() : null;
  const correctionOpenedAt = new Date().toISOString();
  const { data: updatedProject, error: updateError } = await input.supabase
    .from("projects")
    .update({
      correction_state: "open",
      correction_opened_at: correctionOpenedAt,
      correction_opened_by: input.userId,
      correction_source_release_id: publishedRelease.id,
      correction_reason: correctionReason,
    })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.projectId)
    .eq("status", "active")
    .eq("correction_state", "none")
    .not("finalized_at", "is", null)
    .select("id")
    .maybeSingle();

  if (updateError) {
    throw new HttpError(500, "project_correction_start_failed", "Unable to start project correction.");
  }

  if (!updatedProject) {
    const currentProject = await loadProjectWorkflowRow(input.supabase, input.tenantId, input.projectId);
    if (isProjectArchived(currentProject)) {
      throw new HttpError(409, "project_archived", "Archived projects do not accept workflow changes.");
    }

    if (isProjectCorrectionOpen(currentProject)) {
      return {
        projectWorkflow: await getProjectWorkflowSummary({
          supabase: input.supabase,
          tenantId: input.tenantId,
          projectId: input.projectId,
        }),
        changed: false,
      };
    }

    throw new HttpError(
      409,
      "project_correction_conflict",
      "Project correction conflicted with another update.",
    );
  }

  return {
    projectWorkflow: await getProjectWorkflowSummary({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
    }),
    changed: true,
  };
}

export async function reopenWorkspaceForCorrection(
  input: ReopenWorkspaceForCorrectionInput,
): Promise<{
  workspace: WorkspaceWorkflowRow;
  projectWorkflow: ProjectWorkflowSummary;
  changed: boolean;
}> {
  const project = await loadProjectWorkflowRow(input.supabase, input.tenantId, input.projectId);

  if (isProjectArchived(project)) {
    throw new HttpError(409, "project_archived", "Archived projects do not accept workflow changes.");
  }

  if (!isProjectFinalized(project)) {
    throw new HttpError(409, "project_not_finalized", "Project correction requires a finalized project.");
  }

  assertProjectCorrectionOpen(project);

  const workspace = await loadWorkspaceWorkflowRow(
    input.supabase,
    input.tenantId,
    input.projectId,
    input.workspaceId,
  );

  if (!isWorkspaceWorkflowState(workspace.workflow_state)) {
    throw new HttpError(409, "workspace_workflow_invalid", "This workspace has an invalid workflow state.");
  }

  if (
    workspace.workflow_state === "handed_off"
    && workspace.reopened_at !== null
    && project.correction_opened_at !== null
    && workspace.reopened_at >= project.correction_opened_at
    && workspace.workflow_state_changed_at === workspace.reopened_at
  ) {
    return {
      workspace,
      projectWorkflow: await getProjectWorkflowSummary({
        supabase: input.supabase,
        tenantId: input.tenantId,
        projectId: input.projectId,
      }),
      changed: false,
    };
  }

  if (workspace.workflow_state !== "validated") {
    throw new HttpError(
      409,
      "workspace_correction_reopen_conflict",
      "Only validated workspaces can be reopened for correction.",
    );
  }

  const reopenedAt = new Date().toISOString();
  const { data: updatedWorkspace, error: updateError } = await input.supabase
    .from("project_workspaces")
    .update({
      workflow_state: "handed_off",
      workflow_state_changed_at: reopenedAt,
      workflow_state_changed_by: input.userId,
      reopened_at: reopenedAt,
      reopened_by: input.userId,
    })
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("id", input.workspaceId)
    .eq("workflow_state", "validated")
    .select(WORKSPACE_WORKFLOW_SELECT)
    .maybeSingle();

  if (updateError) {
    throw new HttpError(
      500,
      "workspace_correction_reopen_failed",
      "Unable to reopen the workspace for correction.",
    );
  }

  if (!updatedWorkspace) {
    const currentWorkspace = await loadWorkspaceWorkflowRow(
      input.supabase,
      input.tenantId,
      input.projectId,
      input.workspaceId,
    );
    const currentProject = await loadProjectWorkflowRow(input.supabase, input.tenantId, input.projectId);

    if (
      currentWorkspace.workflow_state === "handed_off"
      && currentWorkspace.reopened_at !== null
      && currentProject.correction_opened_at !== null
      && currentWorkspace.reopened_at >= currentProject.correction_opened_at
      && currentWorkspace.workflow_state_changed_at === currentWorkspace.reopened_at
    ) {
      return {
        workspace: currentWorkspace,
        projectWorkflow: await getProjectWorkflowSummary({
          supabase: input.supabase,
          tenantId: input.tenantId,
          projectId: input.projectId,
        }),
        changed: false,
      };
    }

    if (isProjectArchived(currentProject)) {
      throw new HttpError(409, "project_archived", "Archived projects do not accept workflow changes.");
    }

    if (!isProjectCorrectionOpen(currentProject)) {
      throw new HttpError(409, "project_correction_not_open", "Project correction is not open.");
    }

    throw new HttpError(
      409,
      "workspace_correction_reopen_conflict",
      "Workspace correction reopen conflicted with another update.",
    );
  }

  return {
    workspace: updatedWorkspace as WorkspaceWorkflowRow,
    projectWorkflow: await getProjectWorkflowSummary({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
    }),
    changed: true,
  };
}

export async function finalizeProject(
  input: FinalizeProjectInput,
): Promise<{
  projectWorkflow: ProjectWorkflowSummary;
  changed: boolean;
}> {
  const project = await loadProjectWorkflowRow(input.supabase, input.tenantId, input.projectId);

  if (isProjectArchived(project)) {
    throw new HttpError(409, "project_archived", "Archived projects cannot be finalized.");
  }

  if (isProjectFinalized(project) && !isProjectCorrectionOpen(project)) {
    return {
      projectWorkflow: await getProjectWorkflowSummary({
        supabase: input.supabase,
        tenantId: input.tenantId,
        projectId: input.projectId,
      }),
      changed: false,
    };
  }

  const projectWorkflow = await getProjectWorkflowSummary({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
  });

  const expectedWorkflowState = isProjectFinalized(project)
    ? "correction_ready_to_finalize"
    : "ready_to_finalize";

  if (
    isProjectFinalized(project)
    && isProjectCorrectionOpen(project)
    && !projectWorkflow.hasCorrectionReopenedWorkspaces
  ) {
    throw new HttpError(
      409,
      "project_correction_no_reopened_workspaces",
      "Reopen at least one workspace before finalizing project correction.",
    );
  }

  if (projectWorkflow.workflowState !== expectedWorkflowState) {
    throw new HttpError(409, "project_finalize_blocked", "The project is not ready to finalize.");
  }

  const finalizedAt = new Date().toISOString();
  const projectUpdate = isProjectFinalized(project)
    ? {
        finalized_at: finalizedAt,
        finalized_by: input.userId,
        correction_state: "none" as const,
        correction_opened_at: null,
        correction_opened_by: null,
        correction_source_release_id: null,
        correction_reason: null,
      }
    : {
        finalized_at: finalizedAt,
        finalized_by: input.userId,
      };
  let finalizeQuery = input.supabase
    .from("projects")
    .update(projectUpdate)
    .eq("tenant_id", input.tenantId)
    .eq("id", input.projectId)
    .eq("status", "active");

  finalizeQuery = isProjectFinalized(project)
    ? finalizeQuery
      .eq("finalized_at", project.finalized_at as string)
      .eq("correction_state", "open")
    : finalizeQuery.is("finalized_at", null);

  const { data: finalizedProject, error: finalizeError } = await finalizeQuery
    .select(
      "id, status, finalized_at, finalized_by, correction_state, correction_opened_at, correction_opened_by, correction_source_release_id, correction_reason",
    )
    .maybeSingle();

  if (finalizeError) {
    throw new HttpError(500, "project_finalize_failed", "Unable to finalize the project.");
  }

  if (!finalizedProject) {
    const currentProject = await loadProjectWorkflowRow(input.supabase, input.tenantId, input.projectId);
    if (
      isProjectFinalized(currentProject)
      && (
        (!isProjectCorrectionOpen(project) && !isProjectCorrectionOpen(currentProject))
        || (
          isProjectCorrectionOpen(project)
          && !isProjectCorrectionOpen(currentProject)
          && currentProject.finalized_at !== project.finalized_at
        )
      )
    ) {
      return {
        projectWorkflow: await getProjectWorkflowSummary({
          supabase: input.supabase,
          tenantId: input.tenantId,
          projectId: input.projectId,
        }),
        changed: false,
      };
    }

    if (isProjectArchived(currentProject)) {
      throw new HttpError(409, "project_archived", "Archived projects cannot be finalized.");
    }

    throw new HttpError(409, "project_finalize_conflict", "Project finalization conflicted with another update.");
  }

  return {
    projectWorkflow: await getProjectWorkflowSummary({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId,
    }),
    changed: true,
  };
}
