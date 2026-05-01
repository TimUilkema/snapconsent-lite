import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { archiveCustomRole, createCustomRole } from "../src/lib/tenant/custom-role-service";
import {
  grantCustomRoleToMember,
  revokeCustomRoleAssignment,
} from "../src/lib/tenant/custom-role-assignment-service";
import {
  assertEffectiveWorkspaceCapability,
  resolveEffectiveProjectCapabilities,
  resolveEffectiveTenantCapabilities,
  resolveEffectiveWorkspaceCapabilities,
  userHasEffectiveCapability,
} from "../src/lib/tenant/effective-permissions";
import { resolveMediaLibraryAccess } from "../src/lib/tenant/media-library-custom-role-access";
import { resolveOrganizationUserAccess } from "../src/lib/tenant/organization-user-access";
import { resolveProfilesAccess } from "../src/lib/profiles/profile-access";
import { resolveProjectAdministrationAccess } from "../src/lib/projects/project-administration-service";
import { TENANT_CAPABILITIES, type TenantCapability } from "../src/lib/tenant/role-capabilities";
import { resolveTemplateManagementAccess } from "../src/lib/templates/template-service";
import {
  adminClient,
  assertNoPostgrestError,
  createAuthUserWithRetry,
  createPhotographerProjectWorkspace,
  createReviewerRoleAssignment,
  getDefaultProjectWorkspaceId,
  getSystemRoleDefinitionId,
  signInClient,
} from "./helpers/supabase-test-client";

type TestMember = {
  userId: string;
  email: string;
  password: string;
  client: SupabaseClient;
};

type Feature094Context = {
  tenantId: string;
  secondTenantId: string;
  projectId: string;
  secondProjectId: string;
  secondTenantProjectId: string;
  defaultWorkspaceId: string;
  photographerWorkspaceId: string;
  secondProjectWorkspaceId: string;
  secondTenantWorkspaceId: string;
  owner: TestMember;
  admin: TestMember;
  reviewerTenant: TestMember;
  reviewerProject: TestMember;
  reviewerEmpty: TestMember;
  photographer: TestMember;
  customTenant: TestMember;
  customProject: TestMember;
  customWorkspace: TestMember;
  revoked: TestMember;
  archived: TestMember;
  systemAssigned: TestMember;
  crossTenant: TestMember;
  secondOwner: TestMember;
};

async function createSignedMember(label: string): Promise<TestMember> {
  const user = await createAuthUserWithRetry(adminClient, label);
  const client = await signInClient(user.email, user.password);
  return {
    ...user,
    client,
  };
}

async function insertProject(input: {
  tenantId: string;
  createdBy: string;
  name: string;
}) {
  const { data, error } = await adminClient
    .from("projects")
    .insert({
      tenant_id: input.tenantId,
      created_by: input.createdBy,
      name: input.name,
      description: null,
      status: "active",
    })
    .select("id")
    .single();
  assertNoPostgrestError(error, `insert project ${input.name}`);
  assert.ok(data?.id, "project should exist");
  return data.id as string;
}

async function createFeature094Context(): Promise<Feature094Context> {
  const [
    owner,
    admin,
    reviewerTenant,
    reviewerProject,
    reviewerEmpty,
    photographer,
    customTenant,
    customProject,
    customWorkspace,
    revoked,
    archived,
    systemAssigned,
    crossTenant,
    secondOwner,
  ] = await Promise.all([
    createSignedMember("feature094-owner"),
    createSignedMember("feature094-admin"),
    createSignedMember("feature094-reviewer-tenant"),
    createSignedMember("feature094-reviewer-project"),
    createSignedMember("feature094-reviewer-empty"),
    createSignedMember("feature094-photographer"),
    createSignedMember("feature094-custom-tenant"),
    createSignedMember("feature094-custom-project"),
    createSignedMember("feature094-custom-workspace"),
    createSignedMember("feature094-revoked"),
    createSignedMember("feature094-archived"),
    createSignedMember("feature094-system-assigned"),
    createSignedMember("feature094-cross-tenant"),
    createSignedMember("feature094-second-owner"),
  ]);

  const { data: tenant, error: tenantError } = await adminClient
    .from("tenants")
    .insert({ name: `Feature 094 Tenant ${randomUUID()}` })
    .select("id")
    .single();
  assertNoPostgrestError(tenantError, "insert feature 094 tenant");
  assert.ok(tenant?.id);

  const { data: secondTenant, error: secondTenantError } = await adminClient
    .from("tenants")
    .insert({ name: `Feature 094 Second Tenant ${randomUUID()}` })
    .select("id")
    .single();
  assertNoPostgrestError(secondTenantError, "insert feature 094 second tenant");
  assert.ok(secondTenant?.id);

  const { error: membershipError } = await adminClient.from("memberships").insert([
    { tenant_id: tenant.id, user_id: owner.userId, role: "owner" },
    { tenant_id: tenant.id, user_id: admin.userId, role: "admin" },
    { tenant_id: tenant.id, user_id: reviewerTenant.userId, role: "reviewer" },
    { tenant_id: tenant.id, user_id: reviewerProject.userId, role: "reviewer" },
    { tenant_id: tenant.id, user_id: reviewerEmpty.userId, role: "reviewer" },
    { tenant_id: tenant.id, user_id: photographer.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: customTenant.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: customProject.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: customWorkspace.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: revoked.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: archived.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: systemAssigned.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: crossTenant.userId, role: "photographer" },
    { tenant_id: secondTenant.id, user_id: secondOwner.userId, role: "owner" },
    { tenant_id: secondTenant.id, user_id: crossTenant.userId, role: "photographer" },
  ]);
  assertNoPostgrestError(membershipError, "insert feature 094 memberships");

  const projectId = await insertProject({
    tenantId: tenant.id,
    createdBy: owner.userId,
    name: `Feature 094 Project ${randomUUID()}`,
  });
  const secondProjectId = await insertProject({
    tenantId: tenant.id,
    createdBy: owner.userId,
    name: `Feature 094 Second Project ${randomUUID()}`,
  });
  const secondTenantProjectId = await insertProject({
    tenantId: secondTenant.id,
    createdBy: secondOwner.userId,
    name: `Feature 094 Foreign Project ${randomUUID()}`,
  });

  const defaultWorkspaceId = await getDefaultProjectWorkspaceId(adminClient, tenant.id, projectId);
  const secondProjectWorkspaceId = await getDefaultProjectWorkspaceId(
    adminClient,
    tenant.id,
    secondProjectId,
  );
  const secondTenantWorkspaceId = await getDefaultProjectWorkspaceId(
    adminClient,
    secondTenant.id,
    secondTenantProjectId,
  );
  const photographerWorkspaceId = await createPhotographerProjectWorkspace({
    supabase: adminClient,
    tenantId: tenant.id,
    projectId,
    createdBy: owner.userId,
    photographerUserId: photographer.userId,
    name: "Feature 094 photographer workspace",
  });

  await createReviewerRoleAssignment({
    tenantId: tenant.id,
    userId: reviewerTenant.userId,
    createdBy: owner.userId,
  });
  await createReviewerRoleAssignment({
    tenantId: tenant.id,
    userId: reviewerProject.userId,
    createdBy: owner.userId,
    projectId,
  });

  return {
    tenantId: tenant.id,
    secondTenantId: secondTenant.id,
    projectId,
    secondProjectId,
    secondTenantProjectId,
    defaultWorkspaceId,
    photographerWorkspaceId,
    secondProjectWorkspaceId,
    secondTenantWorkspaceId,
    owner,
    admin,
    reviewerTenant,
    reviewerProject,
    reviewerEmpty,
    photographer,
    customTenant,
    customProject,
    customWorkspace,
    revoked,
    archived,
    systemAssigned,
    crossTenant,
    secondOwner,
  };
}

async function createRole(input: {
  context: Feature094Context;
  capabilityKeys: TenantCapability[];
  name?: string;
}) {
  return createCustomRole({
    supabase: input.context.owner.client,
    tenantId: input.context.tenantId,
    userId: input.context.owner.userId,
    body: {
      name: input.name ?? `Feature 094 role ${randomUUID()}`,
      capabilityKeys: input.capabilityKeys,
    },
  });
}

async function grantRole(input: {
  context: Feature094Context;
  target: TestMember;
  capabilityKeys: TenantCapability[];
  scopeType?: "tenant" | "project" | "workspace";
  projectId?: string | null;
  workspaceId?: string | null;
}) {
  const role = await createRole({
    context: input.context,
    capabilityKeys: input.capabilityKeys,
  });
  const grant = await grantCustomRoleToMember({
    supabase: input.context.owner.client,
    tenantId: input.context.tenantId,
    actorUserId: input.context.owner.userId,
    targetUserId: input.target.userId,
    roleId: role.id,
    scopeType: input.scopeType,
    projectId: input.projectId,
    workspaceId: input.workspaceId,
  });
  return { role, grant };
}

async function rpcScopedCustomRoleCapability(input: {
  client: SupabaseClient;
  tenantId: string;
  capabilityKey: TenantCapability;
  projectId?: string | null;
  workspaceId?: string | null;
}) {
  const { data, error } = await input.client.rpc("current_user_has_scoped_custom_role_capability", {
    p_tenant_id: input.tenantId,
    p_capability_key: input.capabilityKey,
    p_project_id: input.projectId ?? null,
    p_workspace_id: input.workspaceId ?? null,
  });
  assertNoPostgrestError(error, `rpc current_user_has_scoped_custom_role_capability ${input.capabilityKey}`);
  return data as boolean;
}

test("feature 094 fixed reviewer and photographer sources follow current semantics", async () => {
  const context = await createFeature094Context();

  const ownerTenant = await resolveEffectiveTenantCapabilities({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    userId: context.owner.userId,
    adminSupabase: adminClient,
  });
  assert.ok(ownerTenant.capabilityKeys.includes("templates.manage"));
  assert.ok(ownerTenant.sources.some((source) => source.sourceType === "fixed_role"));

  const adminProject = await resolveEffectiveProjectCapabilities({
    supabase: context.admin.client,
    tenantId: context.tenantId,
    userId: context.admin.userId,
    projectId: context.projectId,
    adminSupabase: adminClient,
  });
  assert.ok(adminProject.capabilityKeys.includes("workflow.finalize_project"));

  const ownerWorkspace = await resolveEffectiveWorkspaceCapabilities({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    userId: context.owner.userId,
    projectId: context.projectId,
    workspaceId: context.defaultWorkspaceId,
    adminSupabase: adminClient,
  });
  assert.ok(ownerWorkspace.capabilityKeys.includes("capture.upload_assets"));

  const emptyReviewer = await userHasEffectiveCapability({
    supabase: context.reviewerEmpty.client,
    tenantId: context.tenantId,
    userId: context.reviewerEmpty.userId,
    scope: { scopeType: "project", projectId: context.projectId },
    capabilityKey: "review.workspace",
    adminSupabase: adminClient,
  });
  assert.equal(emptyReviewer.allowed, false);
  assert.equal(emptyReviewer.denialReason, "not_granted");

  const tenantReviewerMedia = await userHasEffectiveCapability({
    supabase: context.reviewerTenant.client,
    tenantId: context.tenantId,
    userId: context.reviewerTenant.userId,
    scope: { scopeType: "tenant" },
    capabilityKey: "media_library.access",
    adminSupabase: adminClient,
  });
  assert.equal(tenantReviewerMedia.allowed, true);
  assert.equal(tenantReviewerMedia.sources[0]?.sourceType, "system_reviewer_assignment");

  const projectReviewerMedia = await userHasEffectiveCapability({
    supabase: context.reviewerProject.client,
    tenantId: context.tenantId,
    userId: context.reviewerProject.userId,
    scope: { scopeType: "tenant" },
    capabilityKey: "media_library.access",
    adminSupabase: adminClient,
  });
  assert.equal(projectReviewerMedia.allowed, false);

  const projectReviewerWorkspace = await userHasEffectiveCapability({
    supabase: context.reviewerProject.client,
    tenantId: context.tenantId,
    userId: context.reviewerProject.userId,
    scope: {
      scopeType: "workspace",
      projectId: context.projectId,
      workspaceId: context.defaultWorkspaceId,
    },
    capabilityKey: "review.workspace",
    adminSupabase: adminClient,
  });
  assert.equal(projectReviewerWorkspace.allowed, true);
  assert.equal(projectReviewerWorkspace.sources[0]?.sourceType, "system_reviewer_assignment");

  const wrongProjectReviewer = await userHasEffectiveCapability({
    supabase: context.reviewerProject.client,
    tenantId: context.tenantId,
    userId: context.reviewerProject.userId,
    scope: { scopeType: "project", projectId: context.secondProjectId },
    capabilityKey: "review.workspace",
    adminSupabase: adminClient,
  });
  assert.equal(wrongProjectReviewer.allowed, false);

  const photographerCapture = await assertEffectiveWorkspaceCapability({
    supabase: context.photographer.client,
    tenantId: context.tenantId,
    userId: context.photographer.userId,
    projectId: context.projectId,
    workspaceId: context.photographerWorkspaceId,
    capabilityKey: "capture.upload_assets",
    adminSupabase: adminClient,
  });
  assert.equal(photographerCapture.sources[0]?.sourceType, "photographer_workspace_assignment");

  await assert.rejects(
    assertEffectiveWorkspaceCapability({
      supabase: context.photographer.client,
      tenantId: context.tenantId,
      userId: context.photographer.userId,
      projectId: context.projectId,
      workspaceId: context.defaultWorkspaceId,
      capabilityKey: "capture.upload_assets",
      adminSupabase: adminClient,
    }),
    { code: "effective_capability_forbidden" },
  );
});

test("feature 094 custom role resolver applies tenant project and workspace assignment scope", async () => {
  const context = await createFeature094Context();
  await grantRole({
    context,
    target: context.customTenant,
    capabilityKeys: [
      "templates.manage",
      "project_workspaces.manage",
      "capture.upload_assets",
      "media_library.access",
    ],
  });
  await grantRole({
    context,
    target: context.customProject,
    capabilityKeys: ["review.workspace", "workflow.finalize_project", "templates.manage"],
    scopeType: "project",
    projectId: context.projectId,
  });
  await grantRole({
    context,
    target: context.customWorkspace,
    capabilityKeys: ["capture.upload_assets", "workflow.finalize_project", "templates.manage"],
    scopeType: "workspace",
    projectId: context.projectId,
    workspaceId: context.defaultWorkspaceId,
  });

  const tenantRoleProjectManage = await userHasEffectiveCapability({
    supabase: context.customTenant.client,
    tenantId: context.tenantId,
    userId: context.customTenant.userId,
    scope: { scopeType: "project", projectId: context.projectId },
    capabilityKey: "project_workspaces.manage",
    adminSupabase: adminClient,
  });
  assert.equal(tenantRoleProjectManage.allowed, true);
  assert.equal(tenantRoleProjectManage.sources[0]?.sourceType, "custom_role_assignment");

  const tenantRoleTemplateAtProject = await userHasEffectiveCapability({
    supabase: context.customTenant.client,
    tenantId: context.tenantId,
    userId: context.customTenant.userId,
    scope: { scopeType: "project", projectId: context.projectId },
    capabilityKey: "templates.manage",
    adminSupabase: adminClient,
  });
  assert.equal(tenantRoleTemplateAtProject.allowed, false);
  assert.equal(tenantRoleTemplateAtProject.denialReason, "capability_not_supported_at_scope");

  const tenantRoleCaptureAtProject = await userHasEffectiveCapability({
    supabase: context.customTenant.client,
    tenantId: context.tenantId,
    userId: context.customTenant.userId,
    scope: { scopeType: "project", projectId: context.projectId },
    capabilityKey: "capture.upload_assets",
    adminSupabase: adminClient,
  });
  assert.equal(tenantRoleCaptureAtProject.allowed, false);
  assert.equal(tenantRoleCaptureAtProject.denialReason, "not_granted");

  const projectRoleWorkspaceReview = await userHasEffectiveCapability({
    supabase: context.customProject.client,
    tenantId: context.tenantId,
    userId: context.customProject.userId,
    scope: {
      scopeType: "workspace",
      projectId: context.projectId,
      workspaceId: context.defaultWorkspaceId,
    },
    capabilityKey: "review.workspace",
    adminSupabase: adminClient,
  });
  assert.equal(projectRoleWorkspaceReview.allowed, true);

  const projectRoleWrongProject = await userHasEffectiveCapability({
    supabase: context.customProject.client,
    tenantId: context.tenantId,
    userId: context.customProject.userId,
    scope: { scopeType: "project", projectId: context.secondProjectId },
    capabilityKey: "review.workspace",
    adminSupabase: adminClient,
  });
  assert.equal(projectRoleWrongProject.allowed, false);

  const workspaceRoleCapture = await userHasEffectiveCapability({
    supabase: context.customWorkspace.client,
    tenantId: context.tenantId,
    userId: context.customWorkspace.userId,
    scope: {
      scopeType: "workspace",
      projectId: context.projectId,
      workspaceId: context.defaultWorkspaceId,
    },
    capabilityKey: "capture.upload_assets",
    adminSupabase: adminClient,
  });
  assert.equal(workspaceRoleCapture.allowed, true);

  const workspaceRoleFinalize = await userHasEffectiveCapability({
    supabase: context.customWorkspace.client,
    tenantId: context.tenantId,
    userId: context.customWorkspace.userId,
    scope: {
      scopeType: "workspace",
      projectId: context.projectId,
      workspaceId: context.defaultWorkspaceId,
    },
    capabilityKey: "workflow.finalize_project",
    adminSupabase: adminClient,
  });
  assert.equal(workspaceRoleFinalize.allowed, false);
  assert.equal(workspaceRoleFinalize.denialReason, "capability_not_supported_at_scope");

  const workspaceResolution = await resolveEffectiveWorkspaceCapabilities({
    supabase: context.customWorkspace.client,
    tenantId: context.tenantId,
    userId: context.customWorkspace.userId,
    projectId: context.projectId,
    workspaceId: context.defaultWorkspaceId,
    adminSupabase: adminClient,
  });
  assert.ok(
    workspaceResolution.ignoredCapabilities.some(
      (ignored) => ignored.capabilityKey === "templates.manage",
    ),
  );
  assert.ok(
    workspaceResolution.ignoredCapabilities.some(
      (ignored) => ignored.capabilityKey === "workflow.finalize_project",
    ),
  );
});

test("feature 094 ignores revoked archived system wrong-scope and cross-tenant rows", async () => {
  const context = await createFeature094Context();
  const revokedGrant = await grantRole({
    context,
    target: context.revoked,
    capabilityKeys: ["templates.manage"],
  });
  await revokeCustomRoleAssignment({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    assignmentId: revokedGrant.grant.assignment.assignmentId,
  });

  const archivedGrant = await grantRole({
    context,
    target: context.archived,
    capabilityKeys: ["templates.manage"],
  });
  await archiveCustomRole({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    userId: context.owner.userId,
    roleId: archivedGrant.role.id,
  });

  const systemRoleId = await getSystemRoleDefinitionId("owner");
  const { error: systemAssignmentError } = await adminClient.from("role_assignments").insert({
    tenant_id: context.tenantId,
    user_id: context.systemAssigned.userId,
    role_definition_id: systemRoleId,
    scope_type: "tenant",
    project_id: null,
    workspace_id: null,
    created_by: context.owner.userId,
  });
  assertNoPostgrestError(systemAssignmentError, "insert feature 094 system role assignment");

  const foreignRole = await createCustomRole({
    supabase: context.secondOwner.client,
    tenantId: context.secondTenantId,
    userId: context.secondOwner.userId,
    body: {
      name: `Feature 094 foreign role ${randomUUID()}`,
      capabilityKeys: ["templates.manage"],
    },
  });
  const { error: foreignAssignmentError } = await adminClient.from("role_assignments").insert({
    tenant_id: context.secondTenantId,
    user_id: context.crossTenant.userId,
    role_definition_id: foreignRole.id,
    scope_type: "tenant",
    project_id: null,
    workspace_id: null,
    created_by: context.secondOwner.userId,
  });
  assertNoPostgrestError(foreignAssignmentError, "insert feature 094 foreign assignment");

  for (const member of [context.revoked, context.archived, context.systemAssigned, context.crossTenant]) {
    const check = await userHasEffectiveCapability({
      supabase: member.client,
      tenantId: context.tenantId,
      userId: member.userId,
      scope: { scopeType: "tenant" },
      capabilityKey: "templates.manage",
      adminSupabase: adminClient,
    });
    assert.equal(check.allowed, false, `${member.email} should not have templates.manage`);
  }
});

test("feature 094 SQL scoped custom-role helper matches TypeScript custom-role behavior", async () => {
  const context = await createFeature094Context();
  await grantRole({
    context,
    target: context.customTenant,
    capabilityKeys: ["project_workspaces.manage", "templates.manage", "capture.upload_assets"],
  });
  await grantRole({
    context,
    target: context.customProject,
    capabilityKeys: ["review.workspace", "workflow.finalize_project"],
    scopeType: "project",
    projectId: context.projectId,
  });
  await grantRole({
    context,
    target: context.customWorkspace,
    capabilityKeys: ["capture.upload_assets"],
    scopeType: "workspace",
    projectId: context.projectId,
    workspaceId: context.defaultWorkspaceId,
  });

  const cases: Array<{
    member: TestMember;
    capabilityKey: TenantCapability;
    projectId?: string | null;
    workspaceId?: string | null;
  }> = [
    { member: context.customTenant, capabilityKey: "templates.manage" },
    { member: context.customTenant, capabilityKey: "project_workspaces.manage", projectId: context.projectId },
    { member: context.customTenant, capabilityKey: "capture.upload_assets", projectId: context.projectId },
    { member: context.customProject, capabilityKey: "review.workspace", projectId: context.projectId },
    {
      member: context.customProject,
      capabilityKey: "review.workspace",
      projectId: context.projectId,
      workspaceId: context.defaultWorkspaceId,
    },
    {
      member: context.customProject,
      capabilityKey: "review.workspace",
      projectId: context.secondProjectId,
      workspaceId: context.secondProjectWorkspaceId,
    },
    {
      member: context.customWorkspace,
      capabilityKey: "capture.upload_assets",
      projectId: context.projectId,
      workspaceId: context.defaultWorkspaceId,
    },
    {
      member: context.customWorkspace,
      capabilityKey: "capture.upload_assets",
      projectId: context.projectId,
      workspaceId: context.photographerWorkspaceId,
    },
  ];

  for (const testCase of cases) {
    const scope = testCase.workspaceId
      ? {
          scopeType: "workspace" as const,
          projectId: testCase.projectId!,
          workspaceId: testCase.workspaceId,
        }
      : testCase.projectId
        ? { scopeType: "project" as const, projectId: testCase.projectId }
        : { scopeType: "tenant" as const };
    const tsResult = await userHasEffectiveCapability({
      supabase: testCase.member.client,
      tenantId: context.tenantId,
      userId: testCase.member.userId,
      scope,
      capabilityKey: testCase.capabilityKey,
      adminSupabase: adminClient,
    });
    const sqlResult = await rpcScopedCustomRoleCapability({
      client: testCase.member.client,
      tenantId: context.tenantId,
      capabilityKey: testCase.capabilityKey,
      projectId: testCase.projectId,
      workspaceId: testCase.workspaceId,
    });
    assert.equal(
      sqlResult,
      tsResult.sources.some((source) => source.sourceType === "custom_role_assignment"),
      `${testCase.member.email} ${testCase.capabilityKey}`,
    );
  }
});

test("feature 094 resolver preserves already migrated tenant-only surface behavior", async () => {
  const context = await createFeature094Context();
  await grantRole({
    context,
    target: context.customTenant,
    capabilityKeys: [
      "media_library.access",
      "media_library.manage_folders",
      "templates.manage",
      "profiles.view",
      "profiles.manage",
      "projects.create",
      "project_workspaces.manage",
      "organization_users.manage",
      "organization_users.invite",
      "organization_users.change_roles",
      "organization_users.remove",
    ],
  });

  const tenantResolution = await resolveEffectiveTenantCapabilities({
    supabase: context.customTenant.client,
    tenantId: context.tenantId,
    userId: context.customTenant.userId,
    adminSupabase: adminClient,
  });
  const projectResolution = await resolveEffectiveProjectCapabilities({
    supabase: context.customTenant.client,
    tenantId: context.tenantId,
    userId: context.customTenant.userId,
    projectId: context.projectId,
    adminSupabase: adminClient,
  });

  const media = await resolveMediaLibraryAccess({
    supabase: context.customTenant.client,
    tenantId: context.tenantId,
    userId: context.customTenant.userId,
    adminSupabase: adminClient,
  });
  assert.equal(media.canAccess, tenantResolution.capabilityKeys.includes("media_library.access"));
  assert.equal(media.canManageFolders, tenantResolution.capabilityKeys.includes("media_library.manage_folders"));

  const template = await resolveTemplateManagementAccess(
    context.customTenant.client,
    context.tenantId,
    context.customTenant.userId,
  );
  assert.equal(template.canManageTemplates, tenantResolution.capabilityKeys.includes("templates.manage"));

  const profiles = await resolveProfilesAccess(
    context.customTenant.client,
    context.tenantId,
    context.customTenant.userId,
  );
  assert.equal(profiles.canViewProfiles, tenantResolution.capabilityKeys.includes("profiles.view"));
  assert.equal(profiles.canManageProfiles, tenantResolution.capabilityKeys.includes("profiles.manage"));

  const projectAdmin = await resolveProjectAdministrationAccess({
    supabase: context.customTenant.client,
    tenantId: context.tenantId,
    userId: context.customTenant.userId,
    projectCreatedByUserId: null,
    adminSupabase: adminClient,
  });
  assert.equal(projectAdmin.canCreateProjects, tenantResolution.capabilityKeys.includes("projects.create"));
  assert.equal(
    projectAdmin.canManageProjectWorkspaces,
    projectResolution.capabilityKeys.includes("project_workspaces.manage"),
  );

  const organizationUsers = await resolveOrganizationUserAccess({
    supabase: context.customTenant.client,
    tenantId: context.tenantId,
    userId: context.customTenant.userId,
    adminSupabase: adminClient,
  });
  assert.equal(
    organizationUsers.canViewOrganizationUsers,
    tenantResolution.capabilityKeys.includes("organization_users.manage"),
  );
  assert.equal(
    organizationUsers.canInviteOrganizationUsers,
    tenantResolution.capabilityKeys.includes("organization_users.invite"),
  );
  assert.equal(
    organizationUsers.canChangeOrganizationUserRoles,
    tenantResolution.capabilityKeys.includes("organization_users.change_roles"),
  );
  assert.equal(
    organizationUsers.canRemoveOrganizationUsers,
    tenantResolution.capabilityKeys.includes("organization_users.remove"),
  );
});

test("feature 094 does not introduce role administration capabilities", () => {
  for (const forbiddenCapability of [
    "custom_roles.manage",
    "custom_roles.assign",
    "reviewer_access.manage",
    "roles.manage",
    "roles.assign",
  ]) {
    assert.equal(
      TENANT_CAPABILITIES.includes(forbiddenCapability as TenantCapability),
      false,
      `${forbiddenCapability} must stay out of the capability catalog`,
    );
  }
});
