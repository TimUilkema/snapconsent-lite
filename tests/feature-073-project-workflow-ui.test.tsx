import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import enMessages from "../messages/en.json";
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ProjectWorkflowControlsView } from "../src/components/projects/project-workflow-controls";

function createWorkspaceSummary(overrides: Partial<{
  workflowState: "active" | "handed_off" | "needs_changes" | "validated";
  isReadyForValidation: boolean;
  matchingInProgress: boolean;
  degradedMatchingState: boolean;
  pendingAssetCount: number;
  needsReviewAssetCount: number;
  activeInviteCount: number;
  pendingRecurringConsentRequestCount: number;
  pendingConsentUpgradeRequestCount: number;
}> = {}) {
  return {
    workspaceId: randomUUID(),
    workflowState: overrides.workflowState ?? "active",
    isReadyForValidation: overrides.isReadyForValidation ?? true,
    blockers: {
      matchingInProgress: overrides.matchingInProgress ?? false,
      degradedMatchingState: overrides.degradedMatchingState ?? false,
      pendingAssetCount: overrides.pendingAssetCount ?? 0,
      needsReviewAssetCount: overrides.needsReviewAssetCount ?? 0,
      activeInviteCount: overrides.activeInviteCount ?? 0,
      pendingRecurringConsentRequestCount: overrides.pendingRecurringConsentRequestCount ?? 0,
      pendingConsentUpgradeRequestCount: overrides.pendingConsentUpgradeRequestCount ?? 0,
    },
  };
}

function renderWorkflowView(overrides: Partial<Parameters<typeof ProjectWorkflowControlsView>[0]> = {}) {
  const selectedWorkspace = overrides.selectedWorkspace ?? {
    id: randomUUID(),
    name: "North hall",
    workflow_state: "handed_off" as const,
    workflow_state_changed_at: new Date().toISOString(),
    handed_off_at: new Date().toISOString(),
    validated_at: null,
    needs_changes_at: null,
    reopened_at: null,
  };
  const selectedWorkspaceSummary = overrides.selectedWorkspaceSummary ?? createWorkspaceSummary({
    workflowState: selectedWorkspace.workflow_state,
    isReadyForValidation: false,
    matchingInProgress: true,
    needsReviewAssetCount: 2,
    activeInviteCount: 1,
  });
  const projectWorkflow = overrides.projectWorkflow ?? {
    projectId: randomUUID(),
    status: "active" as const,
    finalizedAt: null,
    finalizedBy: null,
    workflowState: "active" as const,
    totalWorkspaceCount: 2,
    validatedWorkspaceCount: 1,
    allWorkspacesValidated: false,
    hasValidationBlockers: true,
    workspaces: [selectedWorkspaceSummary],
  };

  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: "en", messages: enMessages },
      createElement(ProjectWorkflowControlsView, {
        projectId: randomUUID(),
        projectStatus: "active",
        canCaptureProjects: true,
        canReviewProjects: true,
        selectedWorkspace,
        selectedWorkspaceSummary,
        projectWorkflow,
        busyAction: null,
        error: null,
        onWorkspaceAction() {},
        onFinalize() {},
        ...overrides,
      }),
    ),
  );
}

test("workflow view renders handoff blocker details and review actions for a handed-off workspace", () => {
  const markup = renderWorkflowView();

  assert.match(markup, /Workspace workflow/);
  assert.match(markup, /North hall/);
  assert.match(markup, /Handed off/);
  assert.match(markup, /Validation blockers/);
  assert.match(markup, /Matching is still in progress\./);
  assert.match(markup, /2 photos still need review\./);
  assert.match(markup, /1 one-off invite is still active\./);
  assert.match(markup, /Mark validated/);
  assert.match(markup, /Needs changes/);
});

test("workflow view renders finalize action only when the project is ready", () => {
  const markup = renderWorkflowView({
    selectedWorkspace: {
      id: randomUUID(),
      name: "North hall",
      workflow_state: "validated",
      workflow_state_changed_at: new Date().toISOString(),
      handed_off_at: new Date().toISOString(),
      validated_at: new Date().toISOString(),
      needs_changes_at: null,
      reopened_at: null,
    },
    selectedWorkspaceSummary: createWorkspaceSummary({
      workflowState: "validated",
      isReadyForValidation: true,
    }),
    projectWorkflow: {
      projectId: randomUUID(),
      status: "active",
      finalizedAt: null,
      finalizedBy: null,
      workflowState: "ready_to_finalize",
      totalWorkspaceCount: 2,
      validatedWorkspaceCount: 2,
      allWorkspacesValidated: true,
      hasValidationBlockers: false,
      workspaces: [],
    },
  });

  assert.match(markup, /Ready to finalize/);
  assert.match(markup, /2 of 2 workspaces validated/);
  assert.match(markup, /Finalize project/);
  assert.doesNotMatch(markup, /Validation blockers/);
});

test("workflow view renders finalized read-only messaging", () => {
  const markup = renderWorkflowView({
    canCaptureProjects: true,
    canReviewProjects: true,
    selectedWorkspace: {
      id: randomUUID(),
      name: "North hall",
      workflow_state: "validated",
      workflow_state_changed_at: new Date().toISOString(),
      handed_off_at: new Date().toISOString(),
      validated_at: new Date().toISOString(),
      needs_changes_at: null,
      reopened_at: null,
    },
    selectedWorkspaceSummary: createWorkspaceSummary({
      workflowState: "validated",
      isReadyForValidation: true,
    }),
    projectWorkflow: {
      projectId: randomUUID(),
      status: "active",
      finalizedAt: new Date().toISOString(),
      finalizedBy: "user-reviewer",
      workflowState: "finalized",
      totalWorkspaceCount: 2,
      validatedWorkspaceCount: 2,
      allWorkspacesValidated: true,
      hasValidationBlockers: false,
      workspaces: [],
    },
  });

  assert.match(markup, /Finalized/);
  assert.match(markup, /This project is finalized\. Capture, review, staffing, and template changes are read-only\./);
  assert.doesNotMatch(markup, /Finalize project/);
});
