import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../src/lib/http/errors";
import {
  handleProjectFinalizePost,
  handleProjectCorrectionStartPost,
  handleWorkspaceCorrectionReopenPost,
  handleWorkspaceWorkflowTransitionPost,
} from "../src/lib/projects/project-workflow-route-handlers";

function createAuthenticatedClient(userId = "user-1") {
  return {
    auth: {
      getUser: async () => ({
        data: {
          user: {
            id: userId,
          },
        },
      }),
    },
  };
}

function createUnauthenticatedClient() {
  return {
    auth: {
      getUser: async () => ({
        data: {
          user: null,
        },
      }),
    },
  };
}

function createProjectWorkflowSummary(overrides: Partial<{
  projectId: string;
  status: "active" | "archived";
  finalizedAt: string | null;
  finalizedBy: string | null;
  workflowState:
    | "active"
    | "ready_to_finalize"
    | "finalized"
    | "correction_open"
    | "correction_ready_to_finalize";
  correctionState: "none" | "open";
  correctionOpenedAt: string | null;
  correctionOpenedBy: string | null;
  correctionSourceReleaseId: string | null;
  correctionReason: string | null;
  hasCorrectionReopenedWorkspaces: boolean;
  totalWorkspaceCount: number;
  validatedWorkspaceCount: number;
  allWorkspacesValidated: boolean;
  hasValidationBlockers: boolean;
}> = {}) {
  return {
    projectId: overrides.projectId ?? "project-1",
    status: overrides.status ?? "active",
    finalizedAt: overrides.finalizedAt ?? null,
    finalizedBy: overrides.finalizedBy ?? null,
    workflowState: overrides.workflowState ?? "active",
    correctionState: overrides.correctionState ?? "none",
    correctionOpenedAt: overrides.correctionOpenedAt ?? null,
    correctionOpenedBy: overrides.correctionOpenedBy ?? null,
    correctionSourceReleaseId: overrides.correctionSourceReleaseId ?? null,
    correctionReason: overrides.correctionReason ?? null,
    hasCorrectionReopenedWorkspaces: overrides.hasCorrectionReopenedWorkspaces ?? false,
    totalWorkspaceCount: overrides.totalWorkspaceCount ?? 1,
    validatedWorkspaceCount: overrides.validatedWorkspaceCount ?? 0,
    allWorkspacesValidated: overrides.allWorkspacesValidated ?? false,
    hasValidationBlockers: overrides.hasValidationBlockers ?? true,
    workspaces: [],
  };
}

test("workspace workflow transition route rejects unauthenticated requests", async () => {
  const response = await handleWorkspaceWorkflowTransitionPost(
    new Request("http://localhost/api/projects/project-1/workspaces/workspace-1/handoff", {
      method: "POST",
    }),
    {
      params: Promise.resolve({
        projectId: "project-1",
        workspaceId: "workspace-1",
      }),
    },
    "handoff",
    {
      createClient: async () => createUnauthenticatedClient() as never,
      createAdminClient: () => ({}) as never,
      resolveTenantId: async () => "tenant-1",
      requireWorkspaceCaptureAccessForRequest: async () => undefined,
      requireWorkspaceReviewAccessForRequest: async () => undefined,
      applyWorkspaceWorkflowTransition: async () => {
        throw new Error("should not be called");
      },
    },
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: "unauthenticated",
    message: "Authentication required.",
  });
});

test("workspace workflow transition route uses capture access for handoff and returns service payloads", async () => {
  let captureAccessChecked = false;
  let reviewAccessChecked = false;

  const response = await handleWorkspaceWorkflowTransitionPost(
    new Request("http://localhost/api/projects/project-1/workspaces/workspace-1/handoff", {
      method: "POST",
    }),
    {
      params: Promise.resolve({
        projectId: "project-1",
        workspaceId: "workspace-1",
      }),
    },
    "handoff",
    {
      createClient: async () => createAuthenticatedClient("user-capture") as never,
      createAdminClient: () => ({ admin: true }) as never,
      resolveTenantId: async () => "tenant-1",
      requireWorkspaceCaptureAccessForRequest: async ({ tenantId, userId, projectId, requestedWorkspaceId }) => {
        captureAccessChecked = true;
        assert.equal(tenantId, "tenant-1");
        assert.equal(userId, "user-capture");
        assert.equal(projectId, "project-1");
        assert.equal(requestedWorkspaceId, "workspace-1");
      },
      requireWorkspaceReviewAccessForRequest: async () => {
        reviewAccessChecked = true;
      },
      applyWorkspaceWorkflowTransition: async (input) => {
        assert.equal(input.tenantId, "tenant-1");
        assert.equal(input.userId, "user-capture");
        assert.equal(input.projectId, "project-1");
        assert.equal(input.workspaceId, "workspace-1");
        assert.equal(input.action, "handoff");

        return {
          changed: true,
          workspace: {
            id: "workspace-1",
            tenant_id: "tenant-1",
            project_id: "project-1",
            workspace_kind: "default",
            photographer_user_id: null,
            name: "Main workspace",
            created_by: "owner-1",
            created_at: new Date().toISOString(),
            workflow_state: "handed_off",
            workflow_state_changed_at: new Date().toISOString(),
            workflow_state_changed_by: "user-capture",
            handed_off_at: new Date().toISOString(),
            handed_off_by: "user-capture",
            validated_at: null,
            validated_by: null,
            needs_changes_at: null,
            needs_changes_by: null,
            reopened_at: null,
            reopened_by: null,
          },
          projectWorkflow: createProjectWorkflowSummary(),
        };
      },
    },
  );

  assert.equal(captureAccessChecked, true);
  assert.equal(reviewAccessChecked, false);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).workspace.workflow_state, "handed_off");
});

test("workspace workflow transition route uses review access for validation", async () => {
  let captureAccessChecked = false;
  let reviewAccessChecked = false;

  const response = await handleWorkspaceWorkflowTransitionPost(
    new Request("http://localhost/api/projects/project-1/workspaces/workspace-1/validate", {
      method: "POST",
    }),
    {
      params: Promise.resolve({
        projectId: "project-1",
        workspaceId: "workspace-1",
      }),
    },
    "validate",
    {
      createClient: async () => createAuthenticatedClient("user-reviewer") as never,
      createAdminClient: () => ({ admin: true }) as never,
      resolveTenantId: async () => "tenant-1",
      requireWorkspaceCaptureAccessForRequest: async () => {
        captureAccessChecked = true;
      },
      requireWorkspaceReviewAccessForRequest: async ({ tenantId, userId, projectId, requestedWorkspaceId }) => {
        reviewAccessChecked = true;
        assert.equal(tenantId, "tenant-1");
        assert.equal(userId, "user-reviewer");
        assert.equal(projectId, "project-1");
        assert.equal(requestedWorkspaceId, "workspace-1");
      },
      applyWorkspaceWorkflowTransition: async () => ({
        changed: false,
        workspace: {
          id: "workspace-1",
          tenant_id: "tenant-1",
          project_id: "project-1",
          workspace_kind: "default",
          photographer_user_id: null,
          name: "Main workspace",
          created_by: "owner-1",
          created_at: new Date().toISOString(),
          workflow_state: "validated",
          workflow_state_changed_at: new Date().toISOString(),
          workflow_state_changed_by: "user-reviewer",
          handed_off_at: new Date().toISOString(),
          handed_off_by: "user-capture",
          validated_at: new Date().toISOString(),
          validated_by: "user-reviewer",
          needs_changes_at: null,
          needs_changes_by: null,
          reopened_at: null,
          reopened_by: null,
        },
        projectWorkflow: createProjectWorkflowSummary({
          workflowState: "ready_to_finalize",
          validatedWorkspaceCount: 1,
          totalWorkspaceCount: 1,
          allWorkspacesValidated: true,
          hasValidationBlockers: false,
        }),
      }),
    },
  );

  assert.equal(captureAccessChecked, false);
  assert.equal(reviewAccessChecked, true);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).changed, false);
});

test("workspace workflow transition route serializes permission failures", async () => {
  const response = await handleWorkspaceWorkflowTransitionPost(
    new Request("http://localhost/api/projects/project-1/workspaces/workspace-1/reopen", {
      method: "POST",
    }),
    {
      params: Promise.resolve({
        projectId: "project-1",
        workspaceId: "workspace-1",
      }),
    },
    "reopen",
    {
      createClient: async () => createAuthenticatedClient("user-reviewer") as never,
      createAdminClient: () => ({ admin: true }) as never,
      resolveTenantId: async () => "tenant-1",
      requireWorkspaceCaptureAccessForRequest: async () => undefined,
      requireWorkspaceReviewAccessForRequest: async () => {
        throw new HttpError(403, "project_review_forbidden", "Review permission is required.");
      },
      applyWorkspaceWorkflowTransition: async () => {
        throw new Error("should not be called");
      },
    },
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "project_review_forbidden",
    message: "Review permission is required.",
  });
});

test("project finalize route checks effective project permission and returns service payloads", async () => {
  let effectiveChecked = false;
  let releaseEnsured = false;

  const response = await handleProjectFinalizePost(
    new Request("http://localhost/api/projects/project-1/finalize", {
      method: "POST",
    }),
    {
      params: Promise.resolve({
        projectId: "project-1",
      }),
    },
    {
      createClient: async () => createAuthenticatedClient("user-reviewer") as never,
      createAdminClient: () => ({ admin: true }) as never,
      resolveTenantId: async () => "tenant-1",
      assertEffectiveProjectCapability: async ({ tenantId, userId, projectId, capabilityKey }) => {
        effectiveChecked = true;
        assert.equal(tenantId, "tenant-1");
        assert.equal(userId, "user-reviewer");
        assert.equal(projectId, "project-1");
        assert.equal(capabilityKey, "workflow.finalize_project");
        return { allowed: true } as never;
      },
      finalizeProject: async (input) => {
        assert.equal(input.tenantId, "tenant-1");
        assert.equal(input.userId, "user-reviewer");
        assert.equal(input.projectId, "project-1");
        return {
          changed: true,
          projectWorkflow: createProjectWorkflowSummary({
            finalizedAt: new Date().toISOString(),
            finalizedBy: "user-reviewer",
            workflowState: "finalized",
            totalWorkspaceCount: 2,
            validatedWorkspaceCount: 2,
            allWorkspacesValidated: true,
            hasValidationBlockers: false,
          }),
        };
      },
      ensureProjectReleaseSnapshot: async (input) => {
        releaseEnsured = true;
        assert.equal(input.tenantId, "tenant-1");
        assert.equal(input.actorUserId, "user-reviewer");
        assert.equal(input.projectId, "project-1");
        return {
          id: "release-1",
          releaseVersion: 1,
          status: "published",
          assetCount: 2,
          createdAt: new Date().toISOString(),
          snapshotCreatedAt: new Date().toISOString(),
        };
      },
      buildReleaseSnapshotRepairWarning: () => ({
        release: {
          id: null,
          releaseVersion: 1,
          status: "missing" as const,
          assetCount: 0,
          createdAt: null,
          snapshotCreatedAt: null,
        },
        warnings: [],
      }),
    },
  );

  assert.equal(effectiveChecked, true);
  assert.equal(releaseEnsured, true);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.projectWorkflow.workflowState, "finalized");
  assert.equal(payload.release.status, "published");
  assert.deepEqual(payload.warnings, []);
});

test("project finalize route returns a repair warning when release snapshot creation fails after finalization", async () => {
  const finalizedAt = new Date().toISOString();
  const response = await handleProjectFinalizePost(
    new Request("http://localhost/api/projects/project-1/finalize", {
      method: "POST",
    }),
    {
      params: Promise.resolve({
        projectId: "project-1",
      }),
    },
    {
      createClient: async () => createAuthenticatedClient("user-reviewer") as never,
      createAdminClient: () => ({ admin: true }) as never,
      resolveTenantId: async () => "tenant-1",
      assertEffectiveProjectCapability: async () => ({ allowed: true }) as never,
      finalizeProject: async () => ({
        changed: false,
        projectWorkflow: createProjectWorkflowSummary({
          finalizedAt,
          finalizedBy: "user-reviewer",
          workflowState: "finalized",
          totalWorkspaceCount: 2,
          validatedWorkspaceCount: 2,
          allWorkspacesValidated: true,
          hasValidationBlockers: false,
        }),
      }),
      ensureProjectReleaseSnapshot: async () => {
        throw new HttpError(500, "project_release_write_failed", "boom");
      },
      buildReleaseSnapshotRepairWarning: () => ({
        release: {
          id: null,
          releaseVersion: 1,
          status: "missing" as const,
          assetCount: 0,
          createdAt: null,
          snapshotCreatedAt: null,
        },
        warnings: [
          {
            code: "release_snapshot_pending_repair",
            message:
              "Project finalized, but the release snapshot is not available yet. Retry finalization to repair it.",
          },
        ],
      }),
    },
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.changed, false);
  assert.equal(payload.projectWorkflow.workflowState, "finalized");
  assert.equal(payload.projectWorkflow.finalizedAt, finalizedAt);
  assert.equal(payload.release.status, "missing");
  assert.equal(payload.release.id, null);
  assert.equal(payload.warnings[0]?.code, "release_snapshot_pending_repair");
});

test("project correction start route checks effective project permission and returns correction metadata", async () => {
  let effectiveChecked = false;

  const response = await handleProjectCorrectionStartPost(
    new Request("http://localhost/api/projects/project-1/correction/start", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        reason: "Fix wrong exact-face links",
      }),
    }),
    {
      params: Promise.resolve({
        projectId: "project-1",
      }),
    },
    {
      createClient: async () => createAuthenticatedClient("user-reviewer") as never,
      createAdminClient: () => ({ admin: true }) as never,
      resolveTenantId: async () => "tenant-1",
      assertEffectiveProjectCapability: async ({ tenantId, userId, projectId, capabilityKey }) => {
        effectiveChecked = true;
        assert.equal(tenantId, "tenant-1");
        assert.equal(userId, "user-reviewer");
        assert.equal(projectId, "project-1");
        assert.equal(capabilityKey, "workflow.start_project_correction");
        return { allowed: true } as never;
      },
      startProjectCorrection: async (input) => {
        assert.equal(input.tenantId, "tenant-1");
        assert.equal(input.userId, "user-reviewer");
        assert.equal(input.projectId, "project-1");
        assert.equal(input.reason, "Fix wrong exact-face links");

        return {
          changed: true,
          projectWorkflow: createProjectWorkflowSummary({
            finalizedAt: "2026-04-24T10:00:00.000Z",
            finalizedBy: "user-reviewer",
            workflowState: "correction_open",
            correctionState: "open",
            correctionOpenedAt: "2026-04-24T11:00:00.000Z",
            correctionOpenedBy: "user-reviewer",
            correctionSourceReleaseId: "release-1",
            correctionReason: "Fix wrong exact-face links",
            totalWorkspaceCount: 2,
            validatedWorkspaceCount: 2,
            allWorkspacesValidated: true,
            hasValidationBlockers: false,
          }),
        };
      },
    },
  );

  assert.equal(effectiveChecked, true);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.changed, true);
  assert.equal(payload.projectWorkflow.workflowState, "correction_open");
  assert.equal(payload.correction.state, "open");
  assert.equal(payload.correction.sourceReleaseId, "release-1");
  assert.equal(payload.correction.reason, "Fix wrong exact-face links");
});

test("project correction start route rejects invalid json bodies", async () => {
  const response = await handleProjectCorrectionStartPost(
    new Request("http://localhost/api/projects/project-1/correction/start", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: "{",
    }),
    {
      params: Promise.resolve({
        projectId: "project-1",
      }),
    },
    {
      createClient: async () => createAuthenticatedClient("user-reviewer") as never,
      createAdminClient: () => ({ admin: true }) as never,
      resolveTenantId: async () => "tenant-1",
      assertEffectiveProjectCapability: async () => ({ allowed: true }) as never,
      startProjectCorrection: async () => {
        throw new Error("should not be called");
      },
    },
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "invalid_body",
    message: "Invalid request body.",
  });
});

test("workspace correction reopen route checks review access and returns service payloads", async () => {
  let reviewAccessChecked = false;

  const response = await handleWorkspaceCorrectionReopenPost(
    new Request("http://localhost/api/projects/project-1/workspaces/workspace-1/correction-reopen", {
      method: "POST",
    }),
    {
      params: Promise.resolve({
        projectId: "project-1",
        workspaceId: "workspace-1",
      }),
    },
    {
      createClient: async () => createAuthenticatedClient("user-reviewer") as never,
      createAdminClient: () => ({ admin: true }) as never,
      resolveTenantId: async () => "tenant-1",
      requireWorkspaceReviewAccessForRequest: async ({ tenantId, userId, projectId, requestedWorkspaceId }) => {
        reviewAccessChecked = true;
        assert.equal(tenantId, "tenant-1");
        assert.equal(userId, "user-reviewer");
        assert.equal(projectId, "project-1");
        assert.equal(requestedWorkspaceId, "workspace-1");
      },
      reopenWorkspaceForCorrection: async (input) => {
        assert.equal(input.tenantId, "tenant-1");
        assert.equal(input.userId, "user-reviewer");
        assert.equal(input.projectId, "project-1");
        assert.equal(input.workspaceId, "workspace-1");

        return {
          changed: true,
          workspace: {
            id: "workspace-1",
            tenant_id: "tenant-1",
            project_id: "project-1",
            workspace_kind: "default",
            photographer_user_id: null,
            name: "Main workspace",
            created_by: "owner-1",
            created_at: new Date().toISOString(),
            workflow_state: "handed_off",
            workflow_state_changed_at: "2026-04-24T11:05:00.000Z",
            workflow_state_changed_by: "user-reviewer",
            handed_off_at: "2026-04-24T10:00:00.000Z",
            handed_off_by: "user-capture",
            validated_at: "2026-04-24T10:30:00.000Z",
            validated_by: "user-reviewer",
            needs_changes_at: null,
            needs_changes_by: null,
            reopened_at: "2026-04-24T11:05:00.000Z",
            reopened_by: "user-reviewer",
          },
          projectWorkflow: createProjectWorkflowSummary({
            finalizedAt: "2026-04-24T10:00:00.000Z",
            finalizedBy: "user-reviewer",
            workflowState: "correction_open",
            correctionState: "open",
            correctionOpenedAt: "2026-04-24T11:00:00.000Z",
            correctionOpenedBy: "user-reviewer",
            correctionSourceReleaseId: "release-1",
            hasCorrectionReopenedWorkspaces: true,
            totalWorkspaceCount: 2,
            validatedWorkspaceCount: 1,
            allWorkspacesValidated: false,
            hasValidationBlockers: true,
          }),
        };
      },
    },
  );

  assert.equal(reviewAccessChecked, true);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.changed, true);
  assert.equal(payload.workspace.workflow_state, "handed_off");
  assert.equal(payload.projectWorkflow.hasCorrectionReopenedWorkspaces, true);
});
