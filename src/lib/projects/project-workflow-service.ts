import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import { getAssetReviewSummaries } from "@/lib/matching/asset-preview-linking";
import { getProjectMatchingProgress } from "@/lib/matching/project-matching-progress";
import type { AccessibleProjectWorkspace } from "@/lib/tenant/permissions";

export const WORKSPACE_WORKFLOW_STATES = [
  "active",
  "handed_off",
  "needs_changes",
  "validated",
] as const;

export const PROJECT_WORKFLOW_STATES = ["active", "ready_to_finalize", "finalized"] as const;

export type WorkspaceWorkflowState = (typeof WORKSPACE_WORKFLOW_STATES)[number];
export type ProjectWorkflowState = (typeof PROJECT_WORKFLOW_STATES)[number];

type ProjectWorkflowRow = {
  id: string;
  status: "active" | "archived";
  finalized_at: string | null;
  finalized_by: string | null;
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
    .select("id, status, finalized_at, finalized_by")
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
  const [matchingProgress, assetRowsResult, activeInviteCount, pendingRecurringRequestCount, pendingUpgradeCount] =
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

  return {
    projectId: project.id,
    status: project.status,
    finalizedAt: project.finalized_at,
    finalizedBy: project.finalized_by,
    workflowState: isProjectFinalized(project)
      ? "finalized"
      : allWorkspacesValidated && !hasValidationBlockers
        ? "ready_to_finalize"
        : "active",
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
  const project = await assertProjectWorkflowMutable(input.supabase, input.tenantId, input.projectId);
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

    if (isProjectFinalized(currentProject)) {
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

  if (isProjectFinalized(project)) {
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

  if (projectWorkflow.workflowState !== "ready_to_finalize") {
    throw new HttpError(409, "project_finalize_blocked", "The project is not ready to finalize.");
  }

  const finalizedAt = new Date().toISOString();
  const { data: finalizedProject, error: finalizeError } = await input.supabase
    .from("projects")
    .update({
      finalized_at: finalizedAt,
      finalized_by: input.userId,
    })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.projectId)
    .eq("status", "active")
    .is("finalized_at", null)
    .select("id, status, finalized_at, finalized_by")
    .maybeSingle();

  if (finalizeError) {
    throw new HttpError(500, "project_finalize_failed", "Unable to finalize the project.");
  }

  if (!finalizedProject) {
    const currentProject = await loadProjectWorkflowRow(input.supabase, input.tenantId, input.projectId);
    if (isProjectFinalized(currentProject)) {
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
