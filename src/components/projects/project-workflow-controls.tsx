"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { resolveLocalizedApiError } from "@/lib/i18n/error-message";
import { formatDateTime } from "@/lib/i18n/format";
import type {
  ProjectWorkflowSummary,
  WorkspaceWorkflowState,
  WorkspaceWorkflowSummary,
} from "@/lib/projects/project-workflow-service";

type WorkspaceWorkflowCard = {
  id: string;
  name: string;
  workflow_state: WorkspaceWorkflowState;
  workflow_state_changed_at: string;
  handed_off_at: string | null;
  validated_at: string | null;
  needs_changes_at: string | null;
  reopened_at: string | null;
};

type WorkspaceAction = "handoff" | "validate" | "needs_changes" | "reopen";
type WorkflowAction = WorkspaceAction | "finalize" | "start_correction";
type WorkflowTranslations = ReturnType<typeof useTranslations>;

type ProjectWorkflowControlsProps = {
  projectId: string;
  projectStatus: "active" | "archived";
  canHandoffWorkspace: boolean;
  canReviewWorkspace: boolean;
  canValidateCorrectionWorkspace: boolean;
  canFinalizeProject: boolean;
  canStartProjectCorrection: boolean;
  canReopenWorkspaceForCorrection: boolean;
  selectedWorkspace: WorkspaceWorkflowCard | null;
  selectedWorkspaceSummary: WorkspaceWorkflowSummary | null;
  projectWorkflow: ProjectWorkflowSummary;
};

type ProjectWorkflowControlsViewProps = ProjectWorkflowControlsProps & {
  busyAction: WorkflowAction | null;
  error: string | null;
  onWorkspaceAction: (action: WorkspaceAction) => void;
  onFinalize: () => void;
  onStartCorrection: () => void;
};

function getWorkspaceStateTone(state: WorkspaceWorkflowState) {
  switch (state) {
    case "handed_off":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "needs_changes":
      return "border-red-200 bg-red-50 text-red-700";
    case "validated":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "active":
    default:
      return "border-zinc-300 bg-zinc-100 text-zinc-700";
  }
}

function getProjectStateTone(state: ProjectWorkflowSummary["workflowState"]) {
  switch (state) {
    case "ready_to_finalize":
    case "correction_ready_to_finalize":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "correction_open":
      return "border-sky-200 bg-sky-50 text-sky-800";
    case "finalized":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "active":
    default:
      return "border-zinc-300 bg-zinc-100 text-zinc-700";
  }
}

function getWorkspaceStateLabel(
  state: WorkspaceWorkflowState,
  t: WorkflowTranslations,
) {
  switch (state) {
    case "handed_off":
      return t("workspaceStates.handed_off");
    case "needs_changes":
      return t("workspaceStates.needs_changes");
    case "validated":
      return t("workspaceStates.validated");
    case "active":
    default:
      return t("workspaceStates.active");
  }
}

function getProjectStateLabel(
  state: ProjectWorkflowSummary["workflowState"],
  t: WorkflowTranslations,
) {
  switch (state) {
    case "ready_to_finalize":
      return t("projectStates.ready_to_finalize");
    case "correction_open":
      return t("projectStates.correction_open");
    case "correction_ready_to_finalize":
      return t("projectStates.correction_ready_to_finalize");
    case "finalized":
      return t("projectStates.finalized");
    case "active":
    default:
      return t("projectStates.active");
  }
}

function buildWorkspaceBlockers(
  summary: WorkspaceWorkflowSummary | null,
  t: WorkflowTranslations,
) {
  if (!summary) {
    return [];
  }

  const items: string[] = [];
  if (summary.blockers.matchingInProgress) {
    items.push(t("blockers.matchingInProgress"));
  }
  if (summary.blockers.degradedMatchingState) {
    items.push(t("blockers.degradedMatchingState"));
  }
  if (summary.blockers.pendingAssetCount > 0) {
    items.push(t("blockers.pendingAssets", { count: summary.blockers.pendingAssetCount }));
  }
  if (summary.blockers.needsReviewAssetCount > 0) {
    items.push(t("blockers.needsReviewAssets", { count: summary.blockers.needsReviewAssetCount }));
  }
  if (summary.blockers.activeInviteCount > 0) {
    items.push(t("blockers.activeInvites", { count: summary.blockers.activeInviteCount }));
  }
  if (summary.blockers.pendingRecurringConsentRequestCount > 0) {
    items.push(
      t("blockers.pendingRecurringRequests", {
        count: summary.blockers.pendingRecurringConsentRequestCount,
      }),
    );
  }
  if (summary.blockers.pendingConsentUpgradeRequestCount > 0) {
    items.push(
      t("blockers.pendingUpgradeRequests", {
        count: summary.blockers.pendingConsentUpgradeRequestCount,
      }),
    );
  }
  return items;
}

function getWorkspaceLockMessage(
  input: {
    projectStatus: "active" | "archived";
    projectWorkflow: ProjectWorkflowSummary;
    selectedWorkspace: WorkspaceWorkflowCard | null;
    canHandoffWorkspace: boolean;
    canReviewWorkspace: boolean;
    canValidateCorrectionWorkspace: boolean;
  },
  t: WorkflowTranslations,
) {
  if (input.projectStatus !== "active") {
    return t("projectArchivedReadOnly");
  }

  if (input.projectWorkflow.correctionState === "open") {
    if (
      input.selectedWorkspace?.workflow_state === "validated" &&
      input.canValidateCorrectionWorkspace
    ) {
      return t("reviewLockedCorrectionValidated");
    }

    if (input.canHandoffWorkspace) {
      return t("projectCorrectionCaptureLocked");
    }

    return null;
  }

  if (input.projectWorkflow.workflowState === "finalized") {
    return t("projectFinalizedReadOnly");
  }

  if (input.selectedWorkspace?.workflow_state === "validated" && input.canReviewWorkspace) {
    return t("reviewLockedValidated");
  }

  if (input.selectedWorkspace?.workflow_state === "validated" && input.canHandoffWorkspace) {
    return t("captureLockedValidated");
  }

  if (input.selectedWorkspace?.workflow_state === "handed_off" && input.canHandoffWorkspace) {
    return t("captureLockedHandedOff");
  }

  return null;
}

export function ProjectWorkflowControlsView({
  projectStatus,
  canHandoffWorkspace,
  canReviewWorkspace,
  canValidateCorrectionWorkspace,
  canFinalizeProject,
  canStartProjectCorrection,
  canReopenWorkspaceForCorrection,
  selectedWorkspace,
  selectedWorkspaceSummary,
  projectWorkflow,
  busyAction,
  error,
  onWorkspaceAction,
  onFinalize,
  onStartCorrection,
}: ProjectWorkflowControlsViewProps) {
  const locale = useLocale();
  const t = useTranslations("projects.detail.workflow");

  const blockers = useMemo(
    () => buildWorkspaceBlockers(selectedWorkspaceSummary, t),
    [selectedWorkspaceSummary, t],
  );
  const correctionOpen = projectWorkflow.correctionState === "open";
  const projectMutationsOpen = projectStatus === "active" && projectWorkflow.workflowState !== "finalized";
  const lockMessage = getWorkspaceLockMessage(
    {
      projectStatus,
      projectWorkflow,
      selectedWorkspace,
      canHandoffWorkspace,
      canReviewWorkspace,
      canValidateCorrectionWorkspace,
    },
    t,
  );
  const canValidateWorkspace = correctionOpen
    ? canValidateCorrectionWorkspace
    : canReviewWorkspace;
  const canNeedsChangesWorkspace = !correctionOpen && canReviewWorkspace;
  const canReopenWorkspace = correctionOpen
    ? canReopenWorkspaceForCorrection
    : canReviewWorkspace;

  return (
    <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.8fr)]">
        <div className="space-y-3">
          <div>
            <p className="text-sm font-semibold text-zinc-900">{t("workspaceTitle")}</p>
            {selectedWorkspace ? (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className="text-sm text-zinc-700">{selectedWorkspace.name}</span>
                <span
                  className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium ${getWorkspaceStateTone(selectedWorkspace.workflow_state)}`}
                >
                  {getWorkspaceStateLabel(selectedWorkspace.workflow_state, t)}
                </span>
              </div>
            ) : (
              <p className="mt-2 text-sm text-zinc-600">{t("workspaceUnavailable")}</p>
            )}
            {selectedWorkspace ? (
              <p className="mt-2 text-sm text-zinc-600">
                {correctionOpen && selectedWorkspace.workflow_state === "handed_off" && selectedWorkspace.reopened_at
                  ? t("workspaceCorrectionReopenedAt", {
                      date: formatDateTime(selectedWorkspace.reopened_at, locale),
                    })
                  : selectedWorkspace.workflow_state === "validated" && selectedWorkspace.validated_at
                  ? t("workspaceValidatedAt", {
                      date: formatDateTime(selectedWorkspace.validated_at, locale),
                    })
                  : selectedWorkspace.workflow_state === "handed_off" && selectedWorkspace.handed_off_at
                    ? t("workspaceHandedOffAt", {
                        date: formatDateTime(selectedWorkspace.handed_off_at, locale),
                      })
                    : selectedWorkspace.workflow_state === "needs_changes" && selectedWorkspace.workflow_state_changed_at
                      ? t("workspaceNeedsChangesAt", {
                          date: formatDateTime(selectedWorkspace.workflow_state_changed_at, locale),
                        })
                      : t("workspaceActiveHelper")}
              </p>
            ) : null}
          </div>

          {selectedWorkspace && blockers.length > 0 && selectedWorkspace.workflow_state === "handed_off" ? (
            <div className="rounded-lg border border-zinc-200 bg-white px-3 py-3">
              <p className="text-sm font-medium text-zinc-900">{t("blockersTitle")}</p>
              <ul className="mt-2 space-y-1 text-sm text-zinc-700">
                {blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {selectedWorkspace ? (
            <div className="flex flex-wrap gap-2">
              {projectMutationsOpen
              && !correctionOpen
              && canHandoffWorkspace
              && (selectedWorkspace.workflow_state === "active" || selectedWorkspace.workflow_state === "needs_changes") ? (
                <button
                  type="button"
                  onClick={() => onWorkspaceAction("handoff")}
                  disabled={busyAction !== null}
                  className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
                >
                  {busyAction === "handoff" ? t("actions.handoffPending") : t("actions.handoff")}
                </button>
                ) : null}
              {projectMutationsOpen && canValidateWorkspace && selectedWorkspace.workflow_state === "handed_off" ? (
                <>
                  <button
                    type="button"
                    onClick={() => onWorkspaceAction("validate")}
                    disabled={busyAction !== null}
                    className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
                  >
                    {busyAction === "validate" ? t("actions.validatePending") : t("actions.validate")}
                  </button>
                  {canNeedsChangesWorkspace ? (
                    <button
                      type="button"
                      onClick={() => onWorkspaceAction("needs_changes")}
                      disabled={busyAction !== null}
                      className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-100 disabled:opacity-60"
                    >
                      {busyAction === "needs_changes"
                        ? t("actions.needsChangesPending")
                        : t("actions.needsChanges")}
                    </button>
                  ) : null}
                </>
              ) : null}
              {projectMutationsOpen && canReopenWorkspace && selectedWorkspace.workflow_state === "validated" ? (
                <button
                  type="button"
                  onClick={() => onWorkspaceAction("reopen")}
                  disabled={busyAction !== null}
                  className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-100 disabled:opacity-60"
                >
                  {busyAction === "reopen"
                    ? correctionOpen
                      ? t("actions.reopenForCorrectionPending")
                      : t("actions.reopenPending")
                    : correctionOpen
                      ? t("actions.reopenForCorrection")
                      : t("actions.reopen")}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border border-zinc-200 bg-white px-3 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-semibold text-zinc-900">{t("projectTitle")}</p>
            <span
              className={`inline-flex rounded-md border px-2 py-1 text-xs font-medium ${getProjectStateTone(projectWorkflow.workflowState)}`}
            >
              {getProjectStateLabel(projectWorkflow.workflowState, t)}
            </span>
          </div>
          <p className="mt-2 text-sm text-zinc-600">
            {correctionOpen
              ? t("projectCorrectionProgress", {
                  validated: projectWorkflow.validatedWorkspaceCount,
                  total: projectWorkflow.totalWorkspaceCount,
                })
              : t("projectProgress", {
                  validated: projectWorkflow.validatedWorkspaceCount,
                  total: projectWorkflow.totalWorkspaceCount,
                })}
          </p>
          {correctionOpen && projectWorkflow.correctionOpenedAt ? (
            <>
              <p className="mt-2 text-sm text-zinc-600">
                {t("projectCorrectionOpenedAt", {
                  date: formatDateTime(projectWorkflow.correctionOpenedAt, locale),
                })}
              </p>
              <p className="mt-2 text-sm text-zinc-600">
                {projectWorkflow.workflowState === "correction_ready_to_finalize"
                  ? t("projectCorrectionReadyHelper")
                  : t("projectCorrectionOpenHelper")}
              </p>
            </>
          ) : projectWorkflow.finalizedAt ? (
            <p className="mt-2 text-sm text-zinc-600">
              {t("projectFinalizedAt", {
                date: formatDateTime(projectWorkflow.finalizedAt, locale),
              })}
            </p>
          ) : projectWorkflow.workflowState === "ready_to_finalize" ? (
            <p className="mt-2 text-sm text-zinc-600">{t("projectReadyHelper")}</p>
          ) : (
            <p className="mt-2 text-sm text-zinc-600">{t("projectActiveHelper")}</p>
          )}

          {projectStatus === "active" && canStartProjectCorrection && projectWorkflow.workflowState === "finalized" ? (
            <button
              type="button"
              onClick={onStartCorrection}
              disabled={busyAction !== null}
              className="mt-3 rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-100 disabled:opacity-60"
            >
              {busyAction === "start_correction" ? t("actions.startCorrectionPending") : t("actions.startCorrection")}
            </button>
          ) : null}

          {projectMutationsOpen
          && canFinalizeProject
          && (projectWorkflow.workflowState === "ready_to_finalize"
            || projectWorkflow.workflowState === "correction_ready_to_finalize") ? (
            <button
              type="button"
              onClick={onFinalize}
              disabled={busyAction !== null}
              className="mt-3 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-60"
            >
              {busyAction === "finalize"
                ? correctionOpen
                  ? t("actions.finalizeCorrectionPending")
                  : t("actions.finalizePending")
                : correctionOpen
                  ? t("actions.finalizeCorrection")
                  : t("actions.finalize")}
            </button>
          ) : null}
        </div>
      </div>

      {lockMessage ? <p className="text-sm text-zinc-700">{lockMessage}</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}

export function ProjectWorkflowControls(props: ProjectWorkflowControlsProps) {
  const router = useRouter();
  const tErrors = useTranslations("errors");
  const [busyAction, setBusyAction] = useState<WorkflowAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runAction(action: WorkflowAction, path: string) {
    setBusyAction(action);
    setError(null);

    try {
      const response = await fetch(path, {
        method: "POST",
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            error?: string;
            message?: string;
          }
        | null;

      if (!response.ok) {
        setError(resolveLocalizedApiError(tErrors, payload, "generic"));
        return;
      }

      router.refresh();
    } catch {
      setError(tErrors("generic"));
    } finally {
      setBusyAction(null);
    }
  }

  function handleWorkspaceAction(action: WorkspaceAction) {
    if (!props.selectedWorkspace) {
      return;
    }

    const workspaceActionPath =
      action === "reopen" && props.projectWorkflow.correctionState === "open"
        ? "correction-reopen"
        : action === "needs_changes"
          ? "needs-changes"
          : action;

    void runAction(
      action,
      `/api/projects/${props.projectId}/workspaces/${props.selectedWorkspace.id}/${workspaceActionPath}`,
    );
  }

  function handleFinalize() {
    void runAction("finalize", `/api/projects/${props.projectId}/finalize`);
  }

  function handleStartCorrection() {
    void runAction("start_correction", `/api/projects/${props.projectId}/correction/start`);
  }

  return (
    <ProjectWorkflowControlsView
      {...props}
      busyAction={busyAction}
      error={error}
      onWorkspaceAction={handleWorkspaceAction}
      onFinalize={handleFinalize}
      onStartCorrection={handleStartCorrection}
    />
  );
}
