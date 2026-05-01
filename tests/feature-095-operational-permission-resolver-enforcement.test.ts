import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "../src/lib/http/errors";
import {
  handleProjectCorrectionStartPost,
  handleProjectFinalizePost,
  handleWorkspaceCorrectionReopenPost,
} from "../src/lib/projects/project-workflow-route-handlers";
import {
  requireWorkspaceCaptureMutationAccessForRequest,
  requireWorkspaceCorrectionReviewMutationAccessForRequest,
} from "../src/lib/projects/project-workspace-request";
import { createCustomRole } from "../src/lib/tenant/custom-role-service";
import { grantCustomRoleToMember } from "../src/lib/tenant/custom-role-assignment-service";
import { resolveMediaLibraryAccess } from "../src/lib/tenant/media-library-custom-role-access";
import type { TenantCapability } from "../src/lib/tenant/role-capabilities";
import {
  adminClient,
  assertNoPostgrestError,
  createAuthUserWithRetry,
  getDefaultProjectWorkspaceId,
  signInClient,
} from "./helpers/supabase-test-client";

type TestMember = {
  userId: string;
  email: string;
  password: string;
  client: SupabaseClient;
};

type Feature095Context = {
  tenantId: string;
  projectId: string;
  workspaceId: string;
  owner: TestMember;
  uploadOnly: TestMember;
  captureWorkspaceOnly: TestMember;
  reviewWorkspaceOnly: TestMember;
  correctionReviewOnly: TestMember;
  finalizeOnly: TestMember;
};

async function createSignedMember(label: string): Promise<TestMember> {
  const user = await createAuthUserWithRetry(adminClient, label);
  const client = await signInClient(user.email, user.password);
  return {
    ...user,
    client,
  };
}

async function createFeature095Context(): Promise<Feature095Context> {
  const [
    owner,
    uploadOnly,
    captureWorkspaceOnly,
    reviewWorkspaceOnly,
    correctionReviewOnly,
    finalizeOnly,
  ] = await Promise.all([
    createSignedMember("feature095-owner"),
    createSignedMember("feature095-upload-only"),
    createSignedMember("feature095-capture-workspace-only"),
    createSignedMember("feature095-review-workspace-only"),
    createSignedMember("feature095-correction-review-only"),
    createSignedMember("feature095-finalize-only"),
  ]);

  const { data: tenant, error: tenantError } = await adminClient
    .from("tenants")
    .insert({ name: `Feature 095 Tenant ${randomUUID()}` })
    .select("id")
    .single();
  assertNoPostgrestError(tenantError, "insert feature 095 tenant");
  assert.ok(tenant?.id);

  const { error: membershipError } = await adminClient.from("memberships").insert([
    { tenant_id: tenant.id, user_id: owner.userId, role: "owner" },
    { tenant_id: tenant.id, user_id: uploadOnly.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: captureWorkspaceOnly.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: reviewWorkspaceOnly.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: correctionReviewOnly.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: finalizeOnly.userId, role: "photographer" },
  ]);
  assertNoPostgrestError(membershipError, "insert feature 095 memberships");

  const { data: project, error: projectError } = await adminClient
    .from("projects")
    .insert({
      tenant_id: tenant.id,
      created_by: owner.userId,
      name: `Feature 095 Project ${randomUUID()}`,
      description: null,
      status: "active",
    })
    .select("id")
    .single();
  assertNoPostgrestError(projectError, "insert feature 095 project");
  assert.ok(project?.id);

  const workspaceId = await getDefaultProjectWorkspaceId(adminClient, tenant.id, project.id);

  return {
    tenantId: tenant.id,
    projectId: project.id,
    workspaceId,
    owner,
    uploadOnly,
    captureWorkspaceOnly,
    reviewWorkspaceOnly,
    correctionReviewOnly,
    finalizeOnly,
  };
}

async function grantRole(input: {
  context: Feature095Context;
  target: TestMember;
  capabilityKeys: TenantCapability[];
  scopeType: "project" | "workspace" | "tenant";
}) {
  const role = await createCustomRole({
    supabase: input.context.owner.client,
    tenantId: input.context.tenantId,
    userId: input.context.owner.userId,
    body: {
      name: `Feature 095 role ${randomUUID()}`,
      capabilityKeys: input.capabilityKeys,
    },
  });

  await grantCustomRoleToMember({
    supabase: input.context.owner.client,
    tenantId: input.context.tenantId,
    actorUserId: input.context.owner.userId,
    targetUserId: input.target.userId,
    roleId: role.id,
    scopeType: input.scopeType,
    projectId: input.scopeType === "tenant" ? null : input.context.projectId,
    workspaceId: input.scopeType === "workspace" ? input.context.workspaceId : null,
  });
}

function assertHttpErrorCode(error: unknown, code: string) {
  assert.ok(error instanceof HttpError, "expected HttpError");
  assert.equal(error.code, code);
  return true;
}

test("feature 095 capture upload uses the specific effective capability and preserves workflow state checks", async () => {
  const context = await createFeature095Context();
  await grantRole({
    context,
    target: context.uploadOnly,
    capabilityKeys: ["capture.upload_assets"],
    scopeType: "workspace",
  });
  await grantRole({
    context,
    target: context.captureWorkspaceOnly,
    capabilityKeys: ["capture.workspace"],
    scopeType: "workspace",
  });

  const allowedAccess = await requireWorkspaceCaptureMutationAccessForRequest({
    supabase: context.uploadOnly.client,
    tenantId: context.tenantId,
    userId: context.uploadOnly.userId,
    projectId: context.projectId,
    requestedWorkspaceId: context.workspaceId,
    capabilityKey: "capture.upload_assets",
  });
  assert.equal(allowedAccess.workspace.id, context.workspaceId);

  await assert.rejects(
    () =>
      requireWorkspaceCaptureMutationAccessForRequest({
        supabase: context.captureWorkspaceOnly.client,
        tenantId: context.tenantId,
        userId: context.captureWorkspaceOnly.userId,
        projectId: context.projectId,
        requestedWorkspaceId: context.workspaceId,
        capabilityKey: "capture.upload_assets",
      }),
    (error) => assertHttpErrorCode(error, "workspace_capture_forbidden"),
  );

  const { error: finalizeError } = await adminClient
    .from("projects")
    .update({
      finalized_at: new Date().toISOString(),
      finalized_by: context.owner.userId,
    })
    .eq("tenant_id", context.tenantId)
    .eq("id", context.projectId);
  assertNoPostgrestError(finalizeError, "finalize feature 095 project for state check");

  await assert.rejects(
    () =>
      requireWorkspaceCaptureMutationAccessForRequest({
        supabase: context.uploadOnly.client,
        tenantId: context.tenantId,
        userId: context.uploadOnly.userId,
        projectId: context.projectId,
        requestedWorkspaceId: context.workspaceId,
        capabilityKey: "capture.upload_assets",
      }),
    (error) => assertHttpErrorCode(error, "project_finalized"),
  );
});

test("feature 095 correction review requires correction capability after finalization", async () => {
  const context = await createFeature095Context();
  await grantRole({
    context,
    target: context.reviewWorkspaceOnly,
    capabilityKeys: ["review.workspace"],
    scopeType: "workspace",
  });
  await grantRole({
    context,
    target: context.correctionReviewOnly,
    capabilityKeys: ["correction.review"],
    scopeType: "workspace",
  });

  const now = new Date().toISOString();
  const { data: release, error: releaseError } = await adminClient
    .from("project_releases")
    .insert({
      tenant_id: context.tenantId,
      project_id: context.projectId,
      release_version: 1,
      status: "published",
      created_by: context.owner.userId,
      source_project_finalized_at: now,
      source_project_finalized_by: context.owner.userId,
      snapshot_created_at: now,
      project_snapshot: {},
    })
    .select("id")
    .single();
  assertNoPostgrestError(releaseError, "insert feature 095 correction source release");
  assert.ok(release?.id);

  const { error: projectError } = await adminClient
    .from("projects")
    .update({
      finalized_at: now,
      finalized_by: context.owner.userId,
      correction_state: "open",
      correction_opened_at: now,
      correction_opened_by: context.owner.userId,
      correction_source_release_id: release.id,
    })
    .eq("tenant_id", context.tenantId)
    .eq("id", context.projectId);
  assertNoPostgrestError(projectError, "open feature 095 correction");

  const { error: workspaceError } = await adminClient
    .from("project_workspaces")
    .update({
      workflow_state: "handed_off",
      workflow_state_changed_at: now,
      workflow_state_changed_by: context.owner.userId,
      handed_off_at: now,
      handed_off_by: context.owner.userId,
    })
    .eq("tenant_id", context.tenantId)
    .eq("id", context.workspaceId);
  assertNoPostgrestError(workspaceError, "handoff feature 095 workspace for correction review");

  await assert.rejects(
    () =>
      requireWorkspaceCorrectionReviewMutationAccessForRequest({
        supabase: context.reviewWorkspaceOnly.client,
        tenantId: context.tenantId,
        userId: context.reviewWorkspaceOnly.userId,
        projectId: context.projectId,
        requestedWorkspaceId: context.workspaceId,
      }),
    (error) => assertHttpErrorCode(error, "workspace_review_forbidden"),
  );

  const allowedAccess = await requireWorkspaceCorrectionReviewMutationAccessForRequest({
    supabase: context.correctionReviewOnly.client,
    tenantId: context.tenantId,
    userId: context.correctionReviewOnly.userId,
    projectId: context.projectId,
    requestedWorkspaceId: context.workspaceId,
  });
  assert.equal(allowedAccess.workspace.id, context.workspaceId);
});

test("feature 095 workflow route handlers pass project and workspace workflow capabilities", async () => {
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: "workflow-user" } } }),
    },
  };

  let finalizeCapability: TenantCapability | null = null;
  const finalizeResponse = await handleProjectFinalizePost(
    new Request("http://localhost/api/projects/project-1/finalize", { method: "POST" }),
    { params: Promise.resolve({ projectId: "project-1" }) },
    {
      createClient: async () => client as never,
      createAdminClient: () => ({}) as never,
      resolveTenantId: async () => "tenant-1",
      assertEffectiveProjectCapability: async (input) => {
        finalizeCapability = input.capabilityKey;
        assert.equal(input.projectId, "project-1");
        return { allowed: true } as never;
      },
      finalizeProject: async () => ({
        changed: true,
        projectWorkflow: { workflowState: "finalized" },
      }) as never,
      ensureProjectReleaseSnapshot: async () => ({ id: "release-1" }) as never,
      buildReleaseSnapshotRepairWarning: () => ({ release: null as never, warnings: [] }),
    },
  );
  assert.equal(finalizeResponse.status, 200);
  assert.equal(finalizeCapability, "workflow.finalize_project");

  let correctionStartCapability: TenantCapability | null = null;
  const correctionStartResponse = await handleProjectCorrectionStartPost(
    new Request("http://localhost/api/projects/project-1/correction/start", { method: "POST" }),
    { params: Promise.resolve({ projectId: "project-1" }) },
    {
      createClient: async () => client as never,
      createAdminClient: () => ({}) as never,
      resolveTenantId: async () => "tenant-1",
      assertEffectiveProjectCapability: async (input) => {
        correctionStartCapability = input.capabilityKey;
        assert.equal(input.projectId, "project-1");
        return { allowed: true } as never;
      },
      startProjectCorrection: async () => ({
        changed: true,
        projectWorkflow: {
          correctionState: "open",
          correctionOpenedAt: "2026-05-01T12:00:00.000Z",
          correctionOpenedBy: "workflow-user",
          correctionSourceReleaseId: "release-1",
          correctionReason: null,
        },
      }) as never,
    },
  );
  assert.equal(correctionStartResponse.status, 200);
  assert.equal(correctionStartCapability, "workflow.start_project_correction");

  let reopenCapability: TenantCapability | null = null;
  const reopenResponse = await handleWorkspaceCorrectionReopenPost(
    new Request("http://localhost/api/projects/project-1/workspaces/workspace-1/correction-reopen", {
      method: "POST",
    }),
    { params: Promise.resolve({ projectId: "project-1", workspaceId: "workspace-1" }) },
    {
      createClient: async () => client as never,
      createAdminClient: () => ({}) as never,
      resolveTenantId: async () => "tenant-1",
      requireWorkspaceReviewAccessForRequest: async (input) => {
        reopenCapability = input.capabilityKey ?? null;
        assert.equal(input.requestedWorkspaceId, "workspace-1");
        return undefined as never;
      },
      reopenWorkspaceForCorrection: async () => ({
        changed: true,
        workspace: { id: "workspace-1" },
        projectWorkflow: { workflowState: "correction_open" },
      }) as never,
    },
  );
  assert.equal(reopenResponse.status, 200);
  assert.equal(reopenCapability, "workflow.reopen_workspace_for_correction");
});

test("feature 095 project operational custom roles do not grant Media Library access", async () => {
  const context = await createFeature095Context();
  await grantRole({
    context,
    target: context.finalizeOnly,
    capabilityKeys: ["workflow.finalize_project"],
    scopeType: "project",
  });

  const access = await resolveMediaLibraryAccess({
    supabase: context.finalizeOnly.client,
    tenantId: context.tenantId,
    userId: context.finalizeOnly.userId,
  });
  assert.equal(access.canAccess, false);
  assert.equal(access.canManageFolders, false);
});
