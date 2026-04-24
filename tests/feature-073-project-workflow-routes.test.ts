import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../src/lib/http/errors";
import {
  handleProjectFinalizePost,
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
          projectWorkflow: {
            projectId: "project-1",
            status: "active",
            finalizedAt: null,
            finalizedBy: null,
            workflowState: "active",
            totalWorkspaceCount: 1,
            validatedWorkspaceCount: 0,
            allWorkspacesValidated: false,
            hasValidationBlockers: true,
            workspaces: [],
          },
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
        projectWorkflow: {
          projectId: "project-1",
          status: "active",
          finalizedAt: null,
          finalizedBy: null,
          workflowState: "ready_to_finalize",
          totalWorkspaceCount: 1,
          validatedWorkspaceCount: 1,
          allWorkspacesValidated: true,
          hasValidationBlockers: false,
          workspaces: [],
        },
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

test("project finalize route resolves scope, checks review permission, and returns service payloads", async () => {
  let scopeChecked = false;
  let reviewChecked = false;

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
      resolveAccessibleProjectWorkspaces: async (_client, tenantId, userId, projectId) => {
        scopeChecked = true;
        assert.equal(tenantId, "tenant-1");
        assert.equal(userId, "user-reviewer");
        assert.equal(projectId, "project-1");
        return [];
      },
      assertCanReviewProjectAction: async (_client, tenantId, userId) => {
        reviewChecked = true;
        assert.equal(tenantId, "tenant-1");
        assert.equal(userId, "user-reviewer");
      },
      finalizeProject: async (input) => {
        assert.equal(input.tenantId, "tenant-1");
        assert.equal(input.userId, "user-reviewer");
        assert.equal(input.projectId, "project-1");
        return {
          changed: true,
          projectWorkflow: {
            projectId: "project-1",
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
        };
      },
    },
  );

  assert.equal(scopeChecked, true);
  assert.equal(reviewChecked, true);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).projectWorkflow.workflowState, "finalized");
});
