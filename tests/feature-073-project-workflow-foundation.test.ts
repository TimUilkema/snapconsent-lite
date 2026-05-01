import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { HttpError } from "../src/lib/http/errors";
import {
  applyWorkspaceWorkflowTransition,
  assertWorkspacePublicSubmissionAllowed,
  finalizeProject,
  getProjectWorkflowSummary,
} from "../src/lib/projects/project-workflow-service";
import {
  adminClient,
  assertNoPostgrestError,
  createAuthUserWithRetry,
  createPhotographerProjectWorkspace,
  createReviewerRoleAssignment,
  getDefaultProjectWorkspaceId,
} from "./helpers/supabase-test-client";

type WorkflowIntegrationContext = {
  tenantId: string;
  projectId: string;
  defaultWorkspaceId: string;
  secondWorkspaceId: string;
  ownerUserId: string;
  reviewerUserId: string;
  photographerUserId: string;
};

async function createWorkflowContext(): Promise<WorkflowIntegrationContext> {
  const owner = await createAuthUserWithRetry(adminClient, "feature073-owner");
  const reviewer = await createAuthUserWithRetry(adminClient, "feature073-reviewer");
  const photographer = await createAuthUserWithRetry(adminClient, "feature073-photographer");

  const { data: tenant, error: tenantError } = await adminClient
    .from("tenants")
    .insert({
      name: `Feature 073 Tenant ${randomUUID()}`,
    })
    .select("id")
    .single();
  assertNoPostgrestError(tenantError, "insert feature 073 tenant");
  assert.ok(tenant);

  const { error: membershipError } = await adminClient.from("memberships").insert([
    {
      tenant_id: tenant.id,
      user_id: owner.userId,
      role: "owner",
    },
    {
      tenant_id: tenant.id,
      user_id: reviewer.userId,
      role: "reviewer",
    },
    {
      tenant_id: tenant.id,
      user_id: photographer.userId,
      role: "photographer",
    },
  ]);
  assertNoPostgrestError(membershipError, "insert feature 073 memberships");

  const { data: project, error: projectError } = await adminClient
    .from("projects")
    .insert({
      tenant_id: tenant.id,
      created_by: owner.userId,
      name: "Feature 073 Workflow Project",
      description: "Feature 073 workflow integration test project",
      status: "active",
    })
    .select("id")
    .single();
  assertNoPostgrestError(projectError, "insert feature 073 project");
  assert.ok(project);

  const defaultWorkspaceId = await getDefaultProjectWorkspaceId(adminClient, tenant.id, project.id);
  const secondWorkspaceId = await createPhotographerProjectWorkspace({
    supabase: adminClient,
    tenantId: tenant.id,
    projectId: project.id,
    createdBy: owner.userId,
    photographerUserId: photographer.userId,
    name: "South hall capture",
  });
  await createReviewerRoleAssignment({
    tenantId: tenant.id,
    userId: reviewer.userId,
    createdBy: owner.userId,
  });

  return {
    tenantId: tenant.id,
    projectId: project.id,
    defaultWorkspaceId,
    secondWorkspaceId,
    ownerUserId: owner.userId,
    reviewerUserId: reviewer.userId,
    photographerUserId: photographer.userId,
  };
}

test("feature 073 workflow service applies transitions, derives readiness, and keeps public submissions open only until validation", async () => {
  const context = await createWorkflowContext();

  const initialSummary = await getProjectWorkflowSummary({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
  });
  assert.equal(initialSummary.workflowState, "active");
  assert.equal(initialSummary.totalWorkspaceCount, 2);
  assert.equal(initialSummary.validatedWorkspaceCount, 0);

  const handedOff = await applyWorkspaceWorkflowTransition({
    supabase: adminClient,
    tenantId: context.tenantId,
    userId: context.photographerUserId,
    projectId: context.projectId,
    workspaceId: context.defaultWorkspaceId,
    action: "handoff",
  });
  assert.equal(handedOff.changed, true);
  assert.equal(handedOff.workspace.workflow_state, "handed_off");

  const handoffRetry = await applyWorkspaceWorkflowTransition({
    supabase: adminClient,
    tenantId: context.tenantId,
    userId: context.photographerUserId,
    projectId: context.projectId,
    workspaceId: context.defaultWorkspaceId,
    action: "handoff",
  });
  assert.equal(handoffRetry.changed, false);
  assert.equal(handoffRetry.workspace.workflow_state, "handed_off");

  const publicSubmissionAllowed = await assertWorkspacePublicSubmissionAllowed(
    adminClient,
    context.tenantId,
    context.projectId,
    context.defaultWorkspaceId,
  );
  assert.equal(publicSubmissionAllowed.workspace.workflow_state, "handed_off");

  const validated = await applyWorkspaceWorkflowTransition({
    supabase: adminClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    projectId: context.projectId,
    workspaceId: context.defaultWorkspaceId,
    action: "validate",
  });
  assert.equal(validated.changed, true);
  assert.equal(validated.workspace.workflow_state, "validated");

  await assert.rejects(
    assertWorkspacePublicSubmissionAllowed(
      adminClient,
      context.tenantId,
      context.projectId,
      context.defaultWorkspaceId,
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 409);
      assert.equal(error.code, "workspace_not_accepting_submissions");
      return true;
    },
  );
});

test("feature 073 finalization is stored explicitly, idempotent, and closes public submissions", async () => {
  const context = await createWorkflowContext();

  for (const workspaceId of [context.defaultWorkspaceId, context.secondWorkspaceId]) {
    await applyWorkspaceWorkflowTransition({
      supabase: adminClient,
      tenantId: context.tenantId,
      userId: context.photographerUserId,
      projectId: context.projectId,
      workspaceId,
      action: "handoff",
    });
    await applyWorkspaceWorkflowTransition({
      supabase: adminClient,
      tenantId: context.tenantId,
      userId: context.reviewerUserId,
      projectId: context.projectId,
      workspaceId,
      action: "validate",
    });
  }

  const finalized = await finalizeProject({
    supabase: adminClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    projectId: context.projectId,
  });
  assert.equal(finalized.changed, true);
  assert.equal(finalized.projectWorkflow.workflowState, "finalized");
  assert.ok(finalized.projectWorkflow.finalizedAt);

  const finalizeRetry = await finalizeProject({
    supabase: adminClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    projectId: context.projectId,
  });
  assert.equal(finalizeRetry.changed, false);
  assert.equal(finalizeRetry.projectWorkflow.workflowState, "finalized");

  await assert.rejects(
    assertWorkspacePublicSubmissionAllowed(
      adminClient,
      context.tenantId,
      context.projectId,
      context.defaultWorkspaceId,
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 409);
      assert.equal(error.code, "project_finalized");
      return true;
    },
  );
});

test("feature 073 schema pair checks reject partial workflow actor timestamps", async () => {
  const context = await createWorkflowContext();

  const { error } = await adminClient
    .from("project_workspaces")
    .update({
      handed_off_at: new Date().toISOString(),
      handed_off_by: null,
    })
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("id", context.defaultWorkspaceId);

  assert.ok(error);
  assert.match(error.message, /handed_off/i);
});
