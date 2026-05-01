import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "../src/lib/http/errors";
import {
  handleProjectCorrectionStartPost,
  handleProjectFinalizePost,
} from "../src/lib/projects/project-workflow-route-handlers";
import { requireWorkspaceOperationalReadAccessForRequest } from "../src/lib/projects/project-workspace-request";
import { grantCustomRoleToMember } from "../src/lib/tenant/custom-role-assignment-service";
import { createCustomRole } from "../src/lib/tenant/custom-role-service";
import { getMemberEffectiveAccessSummary } from "../src/lib/tenant/member-effective-access-service";
import { grantProjectReviewerAccess } from "../src/lib/tenant/reviewer-access-service";
import type { TenantCapability } from "../src/lib/tenant/role-capabilities";
import {
  adminClient,
  assertNoPostgrestError,
  createAuthUserWithRetry,
  createPhotographerProjectWorkspace,
  signInClient,
} from "./helpers/supabase-test-client";

type TestMember = {
  userId: string;
  email: string;
  password: string;
  client: SupabaseClient;
};

type Feature096Context = {
  tenantId: string;
  projectId: string;
  workspaceId: string;
  owner: TestMember;
  reviewer: TestMember;
  photographer: TestMember;
  uploadOnly: TestMember;
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

async function createFeature096Context(): Promise<Feature096Context> {
  const [owner, reviewer, photographer, uploadOnly, finalizeOnly] = await Promise.all([
    createSignedMember("feature096-owner"),
    createSignedMember("feature096-reviewer"),
    createSignedMember("feature096-photographer"),
    createSignedMember("feature096-upload-only"),
    createSignedMember("feature096-finalize-only"),
  ]);

  const { data: tenant, error: tenantError } = await adminClient
    .from("tenants")
    .insert({ name: `Feature 096 Tenant ${randomUUID()}` })
    .select("id")
    .single();
  assertNoPostgrestError(tenantError, "insert feature 096 tenant");
  assert.ok(tenant?.id);

  const { error: membershipError } = await adminClient.from("memberships").insert([
    { tenant_id: tenant.id, user_id: owner.userId, role: "owner" },
    { tenant_id: tenant.id, user_id: reviewer.userId, role: "reviewer" },
    { tenant_id: tenant.id, user_id: photographer.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: uploadOnly.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: finalizeOnly.userId, role: "photographer" },
  ]);
  assertNoPostgrestError(membershipError, "insert feature 096 memberships");

  const { data: project, error: projectError } = await adminClient
    .from("projects")
    .insert({
      tenant_id: tenant.id,
      created_by: owner.userId,
      name: `Feature 096 Project ${randomUUID()}`,
      description: null,
      status: "active",
    })
    .select("id")
    .single();
  assertNoPostgrestError(projectError, "insert feature 096 project");
  assert.ok(project?.id);

  const workspaceId = await createPhotographerProjectWorkspace({
    supabase: adminClient,
    tenantId: tenant.id,
    projectId: project.id,
    createdBy: owner.userId,
    photographerUserId: photographer.userId,
    name: "Feature 096 photographer workspace",
  });

  return {
    tenantId: tenant.id,
    projectId: project.id,
    workspaceId,
    owner,
    reviewer,
    photographer,
    uploadOnly,
    finalizeOnly,
  };
}

async function grantRole(input: {
  context: Feature096Context;
  target: TestMember;
  capabilityKeys: TenantCapability[];
  scopeType: "project" | "workspace" | "tenant";
}) {
  const role = await createCustomRole({
    supabase: input.context.owner.client,
    tenantId: input.context.tenantId,
    userId: input.context.owner.userId,
    body: {
      name: `Feature 096 role ${randomUUID()}`,
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

  return role;
}

function assertHttpErrorCode(error: unknown, code: string) {
  assert.ok(error instanceof HttpError, "expected HttpError");
  assert.equal(error.code, code);
  return true;
}

test("feature 096 operational reads use effective workspace capabilities without granting project workflow-only access", async () => {
  const context = await createFeature096Context();
  await grantRole({
    context,
    target: context.uploadOnly,
    capabilityKeys: ["capture.upload_assets"],
    scopeType: "workspace",
  });
  await grantRole({
    context,
    target: context.finalizeOnly,
    capabilityKeys: ["workflow.finalize_project"],
    scopeType: "project",
  });

  const allowed = await requireWorkspaceOperationalReadAccessForRequest({
    supabase: context.uploadOnly.client,
    tenantId: context.tenantId,
    userId: context.uploadOnly.userId,
    projectId: context.projectId,
    requestedWorkspaceId: context.workspaceId,
  });
  assert.equal(allowed.workspace.id, context.workspaceId);

  await assert.rejects(
    () =>
      requireWorkspaceOperationalReadAccessForRequest({
        supabase: context.finalizeOnly.client,
        tenantId: context.tenantId,
        userId: context.finalizeOnly.userId,
        projectId: context.projectId,
        requestedWorkspaceId: context.workspaceId,
      }),
    (error) => assertHttpErrorCode(error, "workspace_read_forbidden"),
  );
});

test("feature 096 effective access summary is owner/admin-only and explains current sources", async () => {
  const context = await createFeature096Context();
  const customRole = await grantRole({
    context,
    target: context.photographer,
    capabilityKeys: ["review.workspace"],
    scopeType: "workspace",
  });
  await grantProjectReviewerAccess({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.reviewer.userId,
    projectId: context.projectId,
  });

  const photographerSummary = await getMemberEffectiveAccessSummary({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.photographer.userId,
  });
  assert.equal(photographerSummary.fixedRole, "photographer");
  assert.equal(photographerSummary.photographerWorkspaceAssignments.length, 1);
  assert.equal(photographerSummary.customRoleAssignments.length, 1);
  assert.equal(photographerSummary.customRoleAssignments[0].roleId, customRole.id);
  assert.ok(
    photographerSummary.effectiveScopes.some((scope) =>
      scope.scopeType === "workspace"
      && scope.capabilityGroups.some((group) => group.capabilityKeys.includes("capture.upload_assets"))
      && scope.capabilityGroups.some((group) => group.capabilityKeys.includes("review.workspace")),
    ),
  );

  const reviewerSummary = await getMemberEffectiveAccessSummary({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.reviewer.userId,
  });
  assert.equal(reviewerSummary.reviewerAccess?.projectAssignments.length, 1);
  assert.ok(
    reviewerSummary.effectiveScopes.some((scope) =>
      scope.scopeType === "project"
      && scope.capabilityGroups.some((group) => group.capabilityKeys.includes("workflow.finalize_project")),
    ),
  );

  await assert.rejects(
    () =>
      getMemberEffectiveAccessSummary({
        supabase: context.photographer.client,
        tenantId: context.tenantId,
        actorUserId: context.photographer.userId,
        targetUserId: context.reviewer.userId,
      }),
    (error) => assertHttpErrorCode(error, "tenant_member_management_forbidden"),
  );
});

test("feature 096 project workflow handlers require effective project capability dependencies", async () => {
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
});
