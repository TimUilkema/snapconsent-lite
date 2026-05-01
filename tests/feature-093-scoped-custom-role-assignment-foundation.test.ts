import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import enMessages from "../messages/en.json";
import { MemberManagementPanelView } from "../src/components/members/member-management-panel";
import {
  assertCapabilityScopeMatrixComplete,
  getCapabilityScopeSupport,
  getRoleScopeEffect,
} from "../src/lib/tenant/custom-role-scope-effects";
import {
  createCustomRole,
} from "../src/lib/tenant/custom-role-service";
import {
  grantCustomRoleToMember,
  listCustomRoleAssignmentTargets,
  listCustomRoleAssignmentsForMembers,
  resolveCustomRoleAssignmentSummary,
  revokeCustomRoleAssignment,
  revokeCustomRoleFromMember,
  type AssignableCustomRole,
  type CustomRoleAssignmentRecord,
} from "../src/lib/tenant/custom-role-assignment-service";
import {
  getOrganizationUserDirectoryData,
  type TenantMemberManagementData,
} from "../src/lib/tenant/member-management-service";
import {
  TENANT_CAPABILITIES,
  type TenantCapability,
} from "../src/lib/tenant/role-capabilities";
import {
  adminClient,
  assertNoPostgrestError,
  createAuthUserWithRetry,
  createPhotographerProjectWorkspace,
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

type Feature093Context = {
  tenantId: string;
  secondTenantId: string;
  projectId: string;
  secondProjectId: string;
  archivedProjectId: string;
  secondTenantProjectId: string;
  defaultWorkspaceId: string;
  photographerWorkspaceId: string;
  secondProjectWorkspaceId: string;
  secondTenantWorkspaceId: string;
  owner: TestMember;
  admin: TestMember;
  delegated: TestMember;
  operational: TestMember;
  reviewerTarget: TestMember;
  photographerTarget: TestMember;
  outsider: TestMember;
  secondOwner: TestMember;
};

const TestNextIntlClientProvider = NextIntlClientProvider as ComponentType<{
  locale: string;
  messages: typeof enMessages;
  children?: ReactNode;
}>;

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
  status?: "active" | "archived";
}) {
  const { data, error } = await adminClient
    .from("projects")
    .insert({
      tenant_id: input.tenantId,
      created_by: input.createdBy,
      name: input.name,
      description: null,
      status: input.status ?? "active",
    })
    .select("id")
    .single();
  assertNoPostgrestError(error, `insert project ${input.name}`);
  assert.ok(data?.id, "project should exist");
  return data.id as string;
}

async function createFeature093Context(): Promise<Feature093Context> {
  const [
    owner,
    admin,
    delegated,
    operational,
    reviewerTarget,
    photographerTarget,
    outsider,
    secondOwner,
  ] = await Promise.all([
    createSignedMember("feature093-owner"),
    createSignedMember("feature093-admin"),
    createSignedMember("feature093-delegated"),
    createSignedMember("feature093-operational"),
    createSignedMember("feature093-reviewer-target"),
    createSignedMember("feature093-photographer-target"),
    createSignedMember("feature093-outsider"),
    createSignedMember("feature093-second-owner"),
  ]);

  const { data: tenant, error: tenantError } = await adminClient
    .from("tenants")
    .insert({ name: `Feature 093 Tenant ${randomUUID()}` })
    .select("id")
    .single();
  assertNoPostgrestError(tenantError, "insert feature 093 tenant");
  assert.ok(tenant?.id);

  const { data: secondTenant, error: secondTenantError } = await adminClient
    .from("tenants")
    .insert({ name: `Feature 093 Second Tenant ${randomUUID()}` })
    .select("id")
    .single();
  assertNoPostgrestError(secondTenantError, "insert feature 093 second tenant");
  assert.ok(secondTenant?.id);

  const { error: membershipError } = await adminClient.from("memberships").insert([
    { tenant_id: tenant.id, user_id: owner.userId, role: "owner" },
    { tenant_id: tenant.id, user_id: admin.userId, role: "admin" },
    { tenant_id: tenant.id, user_id: delegated.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: operational.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: reviewerTarget.userId, role: "reviewer" },
    { tenant_id: tenant.id, user_id: photographerTarget.userId, role: "photographer" },
    { tenant_id: secondTenant.id, user_id: secondOwner.userId, role: "owner" },
  ]);
  assertNoPostgrestError(membershipError, "insert feature 093 memberships");

  const projectId = await insertProject({
    tenantId: tenant.id,
    createdBy: owner.userId,
    name: `Feature 093 Project ${randomUUID()}`,
  });
  const secondProjectId = await insertProject({
    tenantId: tenant.id,
    createdBy: owner.userId,
    name: `Feature 093 Second Project ${randomUUID()}`,
  });
  const archivedProjectId = await insertProject({
    tenantId: tenant.id,
    createdBy: owner.userId,
    name: `Feature 093 Archived Project ${randomUUID()}`,
    status: "archived",
  });
  const secondTenantProjectId = await insertProject({
    tenantId: secondTenant.id,
    createdBy: secondOwner.userId,
    name: `Feature 093 Foreign Project ${randomUUID()}`,
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
    photographerUserId: photographerTarget.userId,
    name: "Feature 093 photographer workspace",
  });

  return {
    tenantId: tenant.id,
    secondTenantId: secondTenant.id,
    projectId,
    secondProjectId,
    archivedProjectId,
    secondTenantProjectId,
    defaultWorkspaceId,
    photographerWorkspaceId,
    secondProjectWorkspaceId,
    secondTenantWorkspaceId,
    owner,
    admin,
    delegated,
    operational,
    reviewerTarget,
    photographerTarget,
    outsider,
    secondOwner,
  };
}

async function createRole(input: {
  context: Feature093Context;
  name?: string;
  capabilityKeys: TenantCapability[];
}) {
  return createCustomRole({
    supabase: input.context.owner.client,
    tenantId: input.context.tenantId,
    userId: input.context.owner.userId,
    body: {
      name: input.name ?? `Feature 093 role ${randomUUID()}`,
      capabilityKeys: input.capabilityKeys,
    },
  });
}

async function createAndGrantOperationalRole(input: {
  context: Feature093Context;
  target: TestMember;
  capabilityKeys: TenantCapability[];
}) {
  const role = await createRole({
    context: input.context,
    capabilityKeys: input.capabilityKeys,
  });
  await grantCustomRoleToMember({
    supabase: input.context.owner.client,
    tenantId: input.context.tenantId,
    actorUserId: input.context.owner.userId,
    targetUserId: input.target.userId,
    roleId: role.id,
  });
  return role;
}

function renderWithMessages(node: ReactNode) {
  return renderToStaticMarkup(
    createElement(
      TestNextIntlClientProvider,
      { locale: "en", messages: enMessages },
      node,
    ),
  );
}

function createPanelData(input: {
  memberUserId: string;
  assignment: CustomRoleAssignmentRecord;
  assignableRole: AssignableCustomRole;
  projectId: string;
  workspaceId: string;
}): TenantMemberManagementData {
  return {
    members: [
      {
        userId: input.memberUserId,
        email: "member@example.com",
        role: "reviewer",
        createdAt: new Date("2026-05-01T10:00:00.000Z").toISOString(),
        canEdit: true,
      },
    ],
    pendingInvites: [],
    reviewerAccess: [
      {
        userId: input.memberUserId,
        email: "member@example.com",
        role: "reviewer",
        tenantWideAccess: {
          active: false,
          assignmentId: null,
          grantedAt: null,
        },
        projectAssignments: [],
      },
    ],
    roleEditor: {
      capabilities: [],
      systemRoles: [],
      customRoles: [],
    },
    assignableCustomRoles: [input.assignableRole],
    customRoleAssignments: [
      {
        userId: input.memberUserId,
        assignments: [input.assignment],
      },
    ],
    customRoleAssignmentTargets: {
      projects: [
        {
          projectId: input.projectId,
          name: "Spring portraits",
          status: "active",
          finalizedAt: null,
          workspaces: [
            {
              workspaceId: input.workspaceId,
              projectId: input.projectId,
              name: "Studio A",
              workspaceKind: "default",
              workflowState: "active",
            },
          ],
        },
      ],
    },
  };
}

test("feature 093 scope-effect helper follows the Feature 092 matrix", () => {
  assert.equal(assertCapabilityScopeMatrixComplete(), true);
  for (const capability of TENANT_CAPABILITIES) {
    assert.ok(getCapabilityScopeSupport(capability));
  }

  assert.equal(getCapabilityScopeSupport("projects.create").tenant, "yes");
  assert.equal(getCapabilityScopeSupport("projects.create").project, "not_applicable");
  assert.equal(getCapabilityScopeSupport("project_workspaces.manage").project, "yes");
  assert.equal(getCapabilityScopeSupport("project_workspaces.manage").workspace, "no");

  assert.deepEqual(
    getRoleScopeEffect(["templates.manage", "capture.upload_assets"], "workspace"),
    {
      scopeType: "workspace",
      effectiveCapabilityKeys: ["capture.upload_assets"],
      ignoredCapabilityKeys: ["templates.manage"],
      hasScopeWarnings: true,
      hasZeroEffectiveCapabilities: false,
    },
  );
  assert.equal(
    getRoleScopeEffect(["templates.manage"], "workspace").hasZeroEffectiveCapabilities,
    true,
  );
  assert.deepEqual(
    getRoleScopeEffect(["workflow.finalize_project"], "project").effectiveCapabilityKeys,
    ["workflow.finalize_project"],
  );
  assert.deepEqual(
    getRoleScopeEffect(["workflow.finalize_project"], "workspace").ignoredCapabilityKeys,
    ["workflow.finalize_project"],
  );
});

test("feature 093 owner admin can grant tenant project and workspace custom role assignments idempotently", async () => {
  const context = await createFeature093Context();
  const role = await createRole({
    context,
    capabilityKeys: ["project_workspaces.manage", "review.workspace"],
  });

  const tenantGrant = await grantCustomRoleToMember({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.reviewerTarget.userId,
    roleId: role.id,
  });
  assert.equal(tenantGrant.created, true);
  assert.equal(tenantGrant.assignment.scopeType, "tenant");
  assert.deepEqual(tenantGrant.assignment.effectiveCapabilityKeys, ["project_workspaces.manage"]);
  assert.deepEqual(tenantGrant.assignment.ignoredCapabilityKeys, ["review.workspace"]);

  const duplicateTenantGrant = await grantCustomRoleToMember({
    supabase: context.admin.client,
    tenantId: context.tenantId,
    actorUserId: context.admin.userId,
    targetUserId: context.reviewerTarget.userId,
    roleId: role.id,
  });
  assert.equal(duplicateTenantGrant.created, false);
  assert.equal(duplicateTenantGrant.assignment.assignmentId, tenantGrant.assignment.assignmentId);

  const projectGrant = await grantCustomRoleToMember({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.reviewerTarget.userId,
    roleId: role.id,
    scopeType: "project",
    projectId: context.projectId,
  });
  assert.equal(projectGrant.created, true);
  assert.equal(projectGrant.assignment.scopeType, "project");
  assert.equal(projectGrant.assignment.projectId, context.projectId);
  assert.ok(projectGrant.assignment.projectName);
  assert.notEqual(projectGrant.assignment.assignmentId, tenantGrant.assignment.assignmentId);

  const secondProjectGrant = await grantCustomRoleToMember({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.reviewerTarget.userId,
    roleId: role.id,
    scopeType: "project",
    projectId: context.secondProjectId,
  });
  assert.equal(secondProjectGrant.created, true);
  assert.notEqual(secondProjectGrant.assignment.assignmentId, projectGrant.assignment.assignmentId);

  const workspaceRole = await createRole({
    context,
    capabilityKeys: ["review.workspace"],
  });
  const workspaceGrant = await grantCustomRoleToMember({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.reviewerTarget.userId,
    roleId: workspaceRole.id,
    scopeType: "workspace",
    projectId: context.projectId,
    workspaceId: context.defaultWorkspaceId,
  });
  assert.equal(workspaceGrant.created, true);
  assert.equal(workspaceGrant.assignment.scopeType, "workspace");
  assert.equal(workspaceGrant.assignment.workspaceId, context.defaultWorkspaceId);
  assert.ok(workspaceGrant.assignment.workspaceName);

  const secondWorkspaceGrant = await grantCustomRoleToMember({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.reviewerTarget.userId,
    roleId: workspaceRole.id,
    scopeType: "workspace",
    projectId: context.projectId,
    workspaceId: context.photographerWorkspaceId,
  });
  assert.equal(secondWorkspaceGrant.created, true);
  assert.notEqual(secondWorkspaceGrant.assignment.assignmentId, workspaceGrant.assignment.assignmentId);

  const summaries = await listCustomRoleAssignmentsForMembers({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    userId: context.owner.userId,
  });
  const targetSummary = summaries.find((summary) => summary.userId === context.reviewerTarget.userId);
  assert.equal(targetSummary?.assignments.length, 5);
});

test("feature 093 rejects invalid scoped grants and zero-effective assignments", async () => {
  const context = await createFeature093Context();
  const tenantOnlyRole = await createRole({
    context,
    capabilityKeys: ["templates.manage"],
  });
  const workspaceRole = await createRole({
    context,
    capabilityKeys: ["review.workspace"],
  });
  const systemReviewerRoleId = await getSystemRoleDefinitionId("reviewer");

  await assert.rejects(
    grantCustomRoleToMember({
      supabase: context.owner.client,
      tenantId: context.tenantId,
      actorUserId: context.owner.userId,
      targetUserId: context.reviewerTarget.userId,
      roleId: tenantOnlyRole.id,
      scopeType: "workspace",
      projectId: context.projectId,
      workspaceId: context.defaultWorkspaceId,
    }),
    { code: "custom_role_assignment_no_effective_capabilities" },
  );

  await assert.rejects(
    grantCustomRoleToMember({
      supabase: context.owner.client,
      tenantId: context.tenantId,
      actorUserId: context.owner.userId,
      targetUserId: context.reviewerTarget.userId,
      roleId: workspaceRole.id,
      scopeType: "workspace",
      projectId: context.secondProjectId,
      workspaceId: context.defaultWorkspaceId,
    }),
    { code: "assignment_workspace_not_found" },
  );
  await assert.rejects(
    grantCustomRoleToMember({
      supabase: context.owner.client,
      tenantId: context.tenantId,
      actorUserId: context.owner.userId,
      targetUserId: context.reviewerTarget.userId,
      roleId: workspaceRole.id,
      scopeType: "project",
      projectId: context.secondTenantProjectId,
    }),
    { code: "assignment_project_not_found" },
  );
  await assert.rejects(
    grantCustomRoleToMember({
      supabase: context.owner.client,
      tenantId: context.tenantId,
      actorUserId: context.owner.userId,
      targetUserId: context.reviewerTarget.userId,
      roleId: workspaceRole.id,
      scopeType: "workspace",
      projectId: context.projectId,
      workspaceId: context.secondTenantWorkspaceId,
    }),
    { code: "assignment_workspace_not_found" },
  );
  await assert.rejects(
    grantCustomRoleToMember({
      supabase: context.owner.client,
      tenantId: context.tenantId,
      actorUserId: context.owner.userId,
      targetUserId: context.reviewerTarget.userId,
      roleId: workspaceRole.id,
      scopeType: "project",
      projectId: context.archivedProjectId,
    }),
    { code: "assignment_project_not_found" },
  );
  await assert.rejects(
    grantCustomRoleToMember({
      supabase: context.owner.client,
      tenantId: context.tenantId,
      actorUserId: context.owner.userId,
      targetUserId: context.reviewerTarget.userId,
      roleId: systemReviewerRoleId,
      scopeType: "project",
      projectId: context.projectId,
    }),
    { code: "system_role_assignment_forbidden" },
  );
  await assert.rejects(
    grantCustomRoleToMember({
      supabase: context.owner.client,
      tenantId: context.tenantId,
      actorUserId: context.owner.userId,
      targetUserId: context.outsider.userId,
      roleId: workspaceRole.id,
      scopeType: "project",
      projectId: context.projectId,
    }),
    { code: "member_not_found" },
  );
});

test("feature 093 assignment-id revoke is exact and idempotent while tenant revoke remains compatible", async () => {
  const context = await createFeature093Context();
  const role = await createRole({
    context,
    capabilityKeys: ["project_workspaces.manage", "review.workspace"],
  });
  const tenantGrant = await grantCustomRoleToMember({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.reviewerTarget.userId,
    roleId: role.id,
  });
  const projectGrant = await grantCustomRoleToMember({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.reviewerTarget.userId,
    roleId: role.id,
    scopeType: "project",
    projectId: context.projectId,
  });

  const revokeProject = await revokeCustomRoleAssignment({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    assignmentId: projectGrant.assignment.assignmentId,
  });
  assert.equal(revokeProject.revoked, true);
  assert.equal(revokeProject.assignment?.assignmentId, projectGrant.assignment.assignmentId);

  const repeatProjectRevoke = await revokeCustomRoleAssignment({
    supabase: context.admin.client,
    tenantId: context.tenantId,
    actorUserId: context.admin.userId,
    assignmentId: projectGrant.assignment.assignmentId,
  });
  assert.equal(repeatProjectRevoke.revoked, false);
  assert.equal(repeatProjectRevoke.assignment?.assignmentId, projectGrant.assignment.assignmentId);

  const activeAfterProjectRevoke = await listCustomRoleAssignmentsForMembers({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    userId: context.owner.userId,
  });
  const targetSummary = activeAfterProjectRevoke.find((summary) => summary.userId === context.reviewerTarget.userId);
  assert.deepEqual(
    targetSummary?.assignments.map((assignment) => assignment.assignmentId),
    [tenantGrant.assignment.assignmentId],
  );

  const legacyTenantRevoke = await revokeCustomRoleFromMember({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.reviewerTarget.userId,
    roleId: role.id,
  });
  assert.equal(legacyTenantRevoke.revoked, true);
  assert.equal(legacyTenantRevoke.assignment?.assignmentId, tenantGrant.assignment.assignmentId);

  const history = await listCustomRoleAssignmentsForMembers({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    userId: context.owner.userId,
    includeRevoked: true,
  });
  assert.equal(
    history.find((summary) => summary.userId === context.reviewerTarget.userId)?.assignments.length,
    2,
  );
});

test("feature 093 role administration stays owner admin only and direct writes stay denied", async () => {
  const context = await createFeature093Context();
  const role = await createRole({
    context,
    capabilityKeys: ["review.workspace"],
  });
  await createAndGrantOperationalRole({
    context,
    target: context.delegated,
    capabilityKeys: [
      "organization_users.manage",
      "organization_users.invite",
      "organization_users.change_roles",
      "organization_users.remove",
    ],
  });
  await createAndGrantOperationalRole({
    context,
    target: context.operational,
    capabilityKeys: ["projects.create", "project_workspaces.manage"],
  });

  for (const actor of [context.delegated, context.operational]) {
    await assert.rejects(
      resolveCustomRoleAssignmentSummary({
        supabase: actor.client,
        tenantId: context.tenantId,
        userId: actor.userId,
      }),
      { code: "tenant_member_management_forbidden" },
    );
    await assert.rejects(
      grantCustomRoleToMember({
        supabase: actor.client,
        tenantId: context.tenantId,
        actorUserId: actor.userId,
        targetUserId: context.reviewerTarget.userId,
        roleId: role.id,
        scopeType: "project",
        projectId: context.projectId,
      }),
      { code: "tenant_member_management_forbidden" },
    );
  }

  const delegatedData = await getOrganizationUserDirectoryData({
    supabase: context.delegated.client,
    tenantId: context.tenantId,
    userId: context.delegated.userId,
  });
  assert.equal("customRoleAssignmentTargets" in delegatedData, false);
  assert.equal("customRoleAssignments" in delegatedData, false);

  const directInsert = await context.delegated.client
    .from("role_assignments")
    .insert({
      tenant_id: context.tenantId,
      user_id: context.reviewerTarget.userId,
      role_definition_id: role.id,
      scope_type: "project",
      project_id: context.projectId,
      workspace_id: null,
      created_by: context.delegated.userId,
    })
    .select("id");
  assert.ok(directInsert.error || !directInsert.data?.length, "direct assignment insert should be denied");
});

test("feature 093 assignment targets include active projects and group workspaces", async () => {
  const context = await createFeature093Context();
  const targets = await listCustomRoleAssignmentTargets({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    userId: context.owner.userId,
  });

  assert.ok(targets.projects.some((project) => project.projectId === context.projectId));
  assert.ok(targets.projects.some((project) => project.projectId === context.secondProjectId));
  assert.equal(targets.projects.some((project) => project.projectId === context.archivedProjectId), false);
  const project = targets.projects.find((candidate) => candidate.projectId === context.projectId);
  assert.ok(project?.workspaces.some((workspace) => workspace.workspaceId === context.defaultWorkspaceId));
  assert.ok(project?.workspaces.some((workspace) => workspace.workspaceId === context.photographerWorkspaceId));

  await assert.rejects(
    listCustomRoleAssignmentTargets({
      supabase: context.delegated.client,
      tenantId: context.tenantId,
      userId: context.delegated.userId,
    }),
    { code: "tenant_member_management_forbidden" },
  );
});

test("feature 093 Members UI renders scope labels, target pickers, and mixed-scope warnings", () => {
  const memberUserId = randomUUID();
  const role: AssignableCustomRole = {
    roleId: randomUUID(),
    name: "Mixed workspace role",
    description: null,
    capabilityKeys: ["templates.manage", "capture.upload_assets"],
    archivedAt: null,
  };
  const assignment: CustomRoleAssignmentRecord = {
    assignmentId: randomUUID(),
    tenantId: randomUUID(),
    userId: memberUserId,
    roleId: role.roleId,
    scopeType: "workspace",
    projectId: randomUUID(),
    projectName: "Spring portraits",
    workspaceId: randomUUID(),
    workspaceName: "Studio A",
    createdAt: new Date("2026-05-01T10:00:00.000Z").toISOString(),
    createdBy: randomUUID(),
    revokedAt: null,
    revokedBy: null,
    role,
    effectiveCapabilityKeys: ["capture.upload_assets"],
    ignoredCapabilityKeys: ["templates.manage"],
    hasScopeWarnings: true,
  };
  const markup = renderWithMessages(
    createElement(MemberManagementPanelView, {
      data: createPanelData({
        memberUserId,
        assignment,
        assignableRole: role,
        projectId: assignment.projectId!,
        workspaceId: assignment.workspaceId!,
      }),
      statusMessage: null,
      isPending: false,
      inviteEmail: "",
      inviteRole: "photographer",
      memberRoles: { [memberUserId]: "reviewer" },
      customRoleSelections: {
        [memberUserId]: {
          roleId: role.roleId,
          scopeType: "workspace",
          projectId: assignment.projectId!,
          workspaceId: assignment.workspaceId!,
        },
      },
      inviteRoles: {},
      onInviteEmailChange() {},
      onInviteRoleChange() {},
      onSubmitInvite() {},
      onMemberRoleChange() {},
      onUpdateMemberRole() {},
      onRemoveMember() {},
      onGrantTenantWideReviewerAccess() {},
      onRevokeTenantWideReviewerAccess() {},
      onCustomRoleSelectionChange() {},
      onAssignCustomRole() {},
      onRevokeCustomRole() {},
      onPendingInviteRoleChange() {},
      onResendInvite() {},
      onRevokeInvite() {},
      onRefreshRoles() {},
    }),
  );

  assert.match(markup, /Workspace/);
  assert.match(markup, /Spring portraits \/ Studio A/);
  assert.match(markup, /Select a project/);
  assert.match(markup, /Select a workspace/);
  assert.match(markup, /Some role capabilities do not apply at this scope/);
  assert.match(markup, /Applies here:/);
  assert.match(markup, /Ignored here:/);
});
