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
  archiveCustomRole,
  createCustomRole,
  listRoleEditorData,
  updateCustomRole,
} from "../src/lib/tenant/custom-role-service";
import {
  grantCustomRoleToMember,
  resolveCustomRoleAssignmentSummary,
  revokeCustomRoleFromMember,
  type AssignableCustomRole,
  type CustomRoleAssignmentRecord,
} from "../src/lib/tenant/custom-role-assignment-service";
import {
  getOrganizationUserDirectoryData,
  getTenantMemberManagementData,
  type TenantMemberManagementData,
} from "../src/lib/tenant/member-management-service";
import {
  listCapabilities,
} from "../src/lib/tenant/role-assignment-foundation";
import {
  TENANT_CAPABILITIES,
  type TenantCapability,
} from "../src/lib/tenant/role-capabilities";
import {
  ENFORCED_TENANT_CUSTOM_ROLE_CAPABILITIES,
} from "../src/lib/tenant/tenant-custom-role-capabilities";
import {
  grantProjectReviewerAccess,
  grantTenantWideReviewerAccess,
  listProjectReviewerAssignments,
  listReviewerAccessSummary,
  revokeProjectReviewerAccess,
  revokeTenantWideReviewerAccess,
} from "../src/lib/tenant/reviewer-access-service";
import {
  adminClient,
  assertNoPostgrestError,
  createAuthUserWithRetry,
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

type Feature091Context = {
  tenantId: string;
  secondTenantId: string;
  projectId: string;
  defaultWorkspaceId: string;
  owner: TestMember;
  admin: TestMember;
  delegated: TestMember;
  operational: TestMember;
  reviewerTarget: TestMember;
  photographerTarget: TestMember;
  adminTarget: TestMember;
  secondOwner: TestMember;
};

const ROLE_ADMIN_CAPABILITY_KEYS = [
  "custom_roles.manage",
  "custom_roles.assign",
  "reviewer_access.manage",
  "roles.manage",
  "roles.assign",
] as const;

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

async function createFeature091Context(): Promise<Feature091Context> {
  const [
    owner,
    admin,
    delegated,
    operational,
    reviewerTarget,
    photographerTarget,
    adminTarget,
    secondOwner,
  ] = await Promise.all([
    createSignedMember("feature091-owner"),
    createSignedMember("feature091-admin"),
    createSignedMember("feature091-delegated"),
    createSignedMember("feature091-operational"),
    createSignedMember("feature091-reviewer-target"),
    createSignedMember("feature091-photographer-target"),
    createSignedMember("feature091-admin-target"),
    createSignedMember("feature091-second-owner"),
  ]);

  const { data: tenant, error: tenantError } = await adminClient
    .from("tenants")
    .insert({ name: `Feature 091 Tenant ${randomUUID()}` })
    .select("id")
    .single();
  assertNoPostgrestError(tenantError, "insert feature 091 tenant");
  assert.ok(tenant?.id, "feature 091 tenant should exist");

  const { data: secondTenant, error: secondTenantError } = await adminClient
    .from("tenants")
    .insert({ name: `Feature 091 Second Tenant ${randomUUID()}` })
    .select("id")
    .single();
  assertNoPostgrestError(secondTenantError, "insert feature 091 second tenant");
  assert.ok(secondTenant?.id, "feature 091 second tenant should exist");

  const { error: membershipError } = await adminClient.from("memberships").insert([
    { tenant_id: tenant.id, user_id: owner.userId, role: "owner" },
    { tenant_id: tenant.id, user_id: admin.userId, role: "admin" },
    { tenant_id: tenant.id, user_id: delegated.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: operational.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: reviewerTarget.userId, role: "reviewer" },
    { tenant_id: tenant.id, user_id: photographerTarget.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: adminTarget.userId, role: "admin" },
    { tenant_id: secondTenant.id, user_id: secondOwner.userId, role: "owner" },
  ]);
  assertNoPostgrestError(membershipError, "insert feature 091 memberships");

  const { data: project, error: projectError } = await adminClient
    .from("projects")
    .insert({
      tenant_id: tenant.id,
      created_by: owner.userId,
      name: `Feature 091 Project ${randomUUID()}`,
      description: null,
      status: "active",
    })
    .select("id")
    .single();
  assertNoPostgrestError(projectError, "insert feature 091 project");
  assert.ok(project?.id, "feature 091 project should exist");

  const defaultWorkspaceId = await getDefaultProjectWorkspaceId(adminClient, tenant.id, project.id);

  return {
    tenantId: tenant.id,
    secondTenantId: secondTenant.id,
    projectId: project.id,
    defaultWorkspaceId,
    owner,
    admin,
    delegated,
    operational,
    reviewerTarget,
    photographerTarget,
    adminTarget,
    secondOwner,
  };
}

async function createAndGrantCustomRole(input: {
  context: Feature091Context;
  target: TestMember;
  capabilityKeys: TenantCapability[];
}) {
  const role = await createCustomRole({
    supabase: input.context.owner.client,
    tenantId: input.context.tenantId,
    userId: input.context.owner.userId,
    body: {
      name: `Feature 091 role ${randomUUID()}`,
      capabilityKeys: input.capabilityKeys,
    },
  });

  const grant = await grantCustomRoleToMember({
    supabase: input.context.owner.client,
    tenantId: input.context.tenantId,
    actorUserId: input.context.owner.userId,
    targetUserId: input.target.userId,
    roleId: role.id,
  });

  return {
    role,
    grant,
  };
}

function assertForbiddenRoleAdministration(promise: Promise<unknown>) {
  return assert.rejects(promise, { code: "tenant_member_management_forbidden" });
}

function assertNoRoleAdministrationFields(data: object) {
  assert.equal("roleEditor" in data, false);
  assert.equal("assignableCustomRoles" in data, false);
  assert.equal("customRoleAssignments" in data, false);
  assert.equal("reviewerAccess" in data, false);
}

function assertDirectWriteDenied(input: {
  data: unknown[] | null;
  error: { code?: string; message?: string } | null;
  context: string;
}) {
  assert.ok(input.error || !input.data?.length, `${input.context} should be denied`);
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
  assignedRole: AssignableCustomRole;
  assignment: CustomRoleAssignmentRecord;
  assignableRole: AssignableCustomRole;
}): TenantMemberManagementData {
  return {
    members: [
      {
        userId: input.memberUserId,
        email: "member@example.com",
        role: "reviewer",
        createdAt: new Date("2026-04-30T10:00:00.000Z").toISOString(),
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
    assignableCustomRoles: [input.assignedRole, input.assignableRole],
    customRoleAssignments: [
      {
        userId: input.memberUserId,
        assignments: [input.assignment],
      },
    ],
    customRoleAssignmentTargets: {
      projects: [],
    },
  };
}

test("feature 091 does not define role administration capability keys", async () => {
  const tenantCapabilities = new Set<string>(TENANT_CAPABILITIES);
  const enforcedCapabilities = new Set<string>(ENFORCED_TENANT_CUSTOM_ROLE_CAPABILITIES);
  const databaseCapabilities = new Set<string>(await listCapabilities(adminClient));

  for (const capabilityKey of ROLE_ADMIN_CAPABILITY_KEYS) {
    assert.equal(tenantCapabilities.has(capabilityKey), false, `${capabilityKey} should not be cataloged`);
    assert.equal(enforcedCapabilities.has(capabilityKey), false, `${capabilityKey} should not be enforceable`);
    assert.equal(databaseCapabilities.has(capabilityKey), false, `${capabilityKey} should not be seeded`);
  }
});

test("feature 091 preserves owner admin role administration", async () => {
  const context = await createFeature091Context();
  const created = await createCustomRole({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    userId: context.owner.userId,
    body: {
      name: `Feature 091 editable ${randomUUID()}`,
      capabilityKeys: ["media_library.access"],
    },
  });

  const roleEditorData = await listRoleEditorData({
    supabase: context.admin.client,
    tenantId: context.tenantId,
    userId: context.admin.userId,
  });
  assert.ok(roleEditorData.customRoles.some((role) => role.id === created.id));

  const updated = await updateCustomRole({
    supabase: context.admin.client,
    tenantId: context.tenantId,
    userId: context.admin.userId,
    roleId: created.id,
    body: {
      name: "Feature 091 updated role",
      capabilityKeys: ["media_library.access", "media_library.manage_folders"],
    },
  });
  assert.deepEqual(
    new Set(updated.capabilityKeys),
    new Set<TenantCapability>(["media_library.access", "media_library.manage_folders"]),
  );

  const assignableRole = await createCustomRole({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    userId: context.owner.userId,
    body: {
      name: `Feature 091 assignable ${randomUUID()}`,
      capabilityKeys: ["projects.create"],
    },
  });

  const summary = await resolveCustomRoleAssignmentSummary({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    userId: context.owner.userId,
  });
  assert.ok(summary.assignableRoles.some((role) => role.roleId === assignableRole.id));

  const firstGrant = await grantCustomRoleToMember({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.photographerTarget.userId,
    roleId: assignableRole.id,
  });
  assert.equal(firstGrant.created, true);

  const duplicateGrant = await grantCustomRoleToMember({
    supabase: context.admin.client,
    tenantId: context.tenantId,
    actorUserId: context.admin.userId,
    targetUserId: context.photographerTarget.userId,
    roleId: assignableRole.id,
  });
  assert.equal(duplicateGrant.created, false);
  assert.equal(duplicateGrant.assignment.assignmentId, firstGrant.assignment.assignmentId);

  const firstRevoke = await revokeCustomRoleFromMember({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.photographerTarget.userId,
    roleId: assignableRole.id,
  });
  assert.equal(firstRevoke.revoked, true);

  const duplicateRevoke = await revokeCustomRoleFromMember({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.photographerTarget.userId,
    roleId: assignableRole.id,
  });
  assert.equal(duplicateRevoke.revoked, false);

  const tenantGrant = await grantTenantWideReviewerAccess({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.reviewerTarget.userId,
  });
  assert.equal(tenantGrant.created, true);

  const duplicateTenantGrant = await grantTenantWideReviewerAccess({
    supabase: context.admin.client,
    tenantId: context.tenantId,
    actorUserId: context.admin.userId,
    targetUserId: context.reviewerTarget.userId,
  });
  assert.equal(duplicateTenantGrant.created, false);
  assert.equal(duplicateTenantGrant.assignment.assignmentId, tenantGrant.assignment.assignmentId);

  const tenantRevoke = await revokeTenantWideReviewerAccess({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.reviewerTarget.userId,
  });
  assert.equal(tenantRevoke.revoked, true);

  const duplicateTenantRevoke = await revokeTenantWideReviewerAccess({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.reviewerTarget.userId,
  });
  assert.equal(duplicateTenantRevoke.revoked, false);

  const projectGrant = await grantProjectReviewerAccess({
    supabase: context.admin.client,
    tenantId: context.tenantId,
    actorUserId: context.admin.userId,
    targetUserId: context.reviewerTarget.userId,
    projectId: context.projectId,
  });
  assert.equal(projectGrant.created, true);

  const projectData = await listProjectReviewerAssignments({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    userId: context.owner.userId,
    projectId: context.projectId,
  });
  assert.ok(projectData.assignments.some((assignment) => assignment.userId === context.reviewerTarget.userId));

  const projectRevoke = await revokeProjectReviewerAccess({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.reviewerTarget.userId,
    projectId: context.projectId,
  });
  assert.equal(projectRevoke.revoked, true);

  const archived = await archiveCustomRole({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    userId: context.owner.userId,
    roleId: created.id,
  });
  assert.equal(archived.changed, true);
});

test("feature 091 denies role administration to delegated organization user managers", async () => {
  const context = await createFeature091Context();
  const { role } = await createAndGrantCustomRole({
    context,
    target: context.delegated,
    capabilityKeys: [
      "organization_users.manage",
      "organization_users.invite",
      "organization_users.change_roles",
      "organization_users.remove",
    ],
  });

  await assertForbiddenRoleAdministration(listRoleEditorData({
    supabase: context.delegated.client,
    tenantId: context.tenantId,
    userId: context.delegated.userId,
  }));
  await assertForbiddenRoleAdministration(createCustomRole({
    supabase: context.delegated.client,
    tenantId: context.tenantId,
    userId: context.delegated.userId,
    body: {
      name: `Feature 091 forbidden ${randomUUID()}`,
      capabilityKeys: ["media_library.access"],
    },
  }));
  await assertForbiddenRoleAdministration(updateCustomRole({
    supabase: context.delegated.client,
    tenantId: context.tenantId,
    userId: context.delegated.userId,
    roleId: role.id,
    body: {
      name: "Feature 091 forbidden update",
      capabilityKeys: ["media_library.access"],
    },
  }));
  await assertForbiddenRoleAdministration(archiveCustomRole({
    supabase: context.delegated.client,
    tenantId: context.tenantId,
    userId: context.delegated.userId,
    roleId: role.id,
  }));
  await assertForbiddenRoleAdministration(resolveCustomRoleAssignmentSummary({
    supabase: context.delegated.client,
    tenantId: context.tenantId,
    userId: context.delegated.userId,
  }));
  await assertForbiddenRoleAdministration(grantCustomRoleToMember({
    supabase: context.delegated.client,
    tenantId: context.tenantId,
    actorUserId: context.delegated.userId,
    targetUserId: context.photographerTarget.userId,
    roleId: role.id,
  }));
  await assertForbiddenRoleAdministration(revokeCustomRoleFromMember({
    supabase: context.delegated.client,
    tenantId: context.tenantId,
    actorUserId: context.delegated.userId,
    targetUserId: context.delegated.userId,
    roleId: role.id,
  }));
  await assertForbiddenRoleAdministration(listReviewerAccessSummary({
    supabase: context.delegated.client,
    tenantId: context.tenantId,
    userId: context.delegated.userId,
  }));
  await assertForbiddenRoleAdministration(grantTenantWideReviewerAccess({
    supabase: context.delegated.client,
    tenantId: context.tenantId,
    actorUserId: context.delegated.userId,
    targetUserId: context.reviewerTarget.userId,
  }));
  await assertForbiddenRoleAdministration(revokeTenantWideReviewerAccess({
    supabase: context.delegated.client,
    tenantId: context.tenantId,
    actorUserId: context.delegated.userId,
    targetUserId: context.reviewerTarget.userId,
  }));
  await assertForbiddenRoleAdministration(listProjectReviewerAssignments({
    supabase: context.delegated.client,
    tenantId: context.tenantId,
    userId: context.delegated.userId,
    projectId: context.projectId,
  }));
  await assertForbiddenRoleAdministration(grantProjectReviewerAccess({
    supabase: context.delegated.client,
    tenantId: context.tenantId,
    actorUserId: context.delegated.userId,
    targetUserId: context.reviewerTarget.userId,
    projectId: context.projectId,
  }));
  await assertForbiddenRoleAdministration(revokeProjectReviewerAccess({
    supabase: context.delegated.client,
    tenantId: context.tenantId,
    actorUserId: context.delegated.userId,
    targetUserId: context.reviewerTarget.userId,
    projectId: context.projectId,
  }));
});

test("feature 091 operational custom roles do not imply role administration", async () => {
  const context = await createFeature091Context();
  const { role } = await createAndGrantCustomRole({
    context,
    target: context.operational,
    capabilityKeys: ["projects.create", "project_workspaces.manage", "media_library.access"],
  });

  await assertForbiddenRoleAdministration(listRoleEditorData({
    supabase: context.operational.client,
    tenantId: context.tenantId,
    userId: context.operational.userId,
  }));
  await assertForbiddenRoleAdministration(resolveCustomRoleAssignmentSummary({
    supabase: context.operational.client,
    tenantId: context.tenantId,
    userId: context.operational.userId,
  }));
  await assertForbiddenRoleAdministration(grantCustomRoleToMember({
    supabase: context.operational.client,
    tenantId: context.tenantId,
    actorUserId: context.operational.userId,
    targetUserId: context.reviewerTarget.userId,
    roleId: role.id,
  }));
  await assertForbiddenRoleAdministration(listReviewerAccessSummary({
    supabase: context.operational.client,
    tenantId: context.tenantId,
    userId: context.operational.userId,
  }));
  await assertForbiddenRoleAdministration(grantProjectReviewerAccess({
    supabase: context.operational.client,
    tenantId: context.tenantId,
    actorUserId: context.operational.userId,
    targetUserId: context.reviewerTarget.userId,
    projectId: context.projectId,
  }));
});

test("feature 091 delegated directory omits privileged role administration data", async () => {
  const context = await createFeature091Context();
  await createAndGrantCustomRole({
    context,
    target: context.delegated,
    capabilityKeys: [
      "organization_users.manage",
      "organization_users.invite",
      "organization_users.change_roles",
      "organization_users.remove",
    ],
  });

  const delegatedData = await getOrganizationUserDirectoryData({
    supabase: context.delegated.client,
    tenantId: context.tenantId,
    userId: context.delegated.userId,
  });
  assertNoRoleAdministrationFields(delegatedData);

  const ownerRow = delegatedData.members.find((member) => member.userId === context.owner.userId);
  const adminRow = delegatedData.members.find((member) => member.userId === context.adminTarget.userId);
  const selfRow = delegatedData.members.find((member) => member.userId === context.delegated.userId);
  const reviewerRow = delegatedData.members.find((member) => member.userId === context.reviewerTarget.userId);
  const photographerRow = delegatedData.members.find((member) => member.userId === context.photographerTarget.userId);
  assert.equal(ownerRow?.canChangeRole, false);
  assert.equal(ownerRow?.canRemove, false);
  assert.equal(adminRow?.canChangeRole, false);
  assert.equal(adminRow?.canRemove, false);
  assert.equal(selfRow?.canChangeRole, false);
  assert.equal(selfRow?.canRemove, false);
  assert.equal(reviewerRow?.canChangeRole, true);
  assert.deepEqual(reviewerRow?.allowedRoleOptions, ["reviewer", "photographer"]);
  assert.equal(reviewerRow?.canRemove, true);
  assert.equal(photographerRow?.canChangeRole, true);
  assert.deepEqual(photographerRow?.allowedRoleOptions, ["reviewer", "photographer"]);
  assert.equal(photographerRow?.canRemove, true);

  const ownerData = await getTenantMemberManagementData({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    userId: context.owner.userId,
  });
  assert.ok("roleEditor" in ownerData);
  assert.ok("assignableCustomRoles" in ownerData);
  assert.ok("customRoleAssignments" in ownerData);
  assert.ok("reviewerAccess" in ownerData);
});

test("feature 091 authenticated delegated users cannot write role administration tables directly", async () => {
  const context = await createFeature091Context();
  const { role, grant } = await createAndGrantCustomRole({
    context,
    target: context.delegated,
    capabilityKeys: [
      "organization_users.manage",
      "organization_users.invite",
      "organization_users.change_roles",
      "organization_users.remove",
    ],
  });
  const reviewerRoleDefinitionId = await getSystemRoleDefinitionId("reviewer");

  const { data: ownAssignments, error: ownAssignmentsError } = await context.delegated.client
    .from("role_assignments")
    .select("id")
    .eq("id", grant.assignment.assignmentId);
  assertNoPostgrestError(ownAssignmentsError, "select own role assignment");
  assert.equal(ownAssignments?.[0]?.id, grant.assignment.assignmentId);

  const roleInsert = await context.delegated.client
    .from("role_definitions")
    .insert({
      tenant_id: context.tenantId,
      slug: `feature-091-direct-${randomUUID()}`,
      name: "Feature 091 direct role",
      description: null,
      is_system: false,
      created_by: context.delegated.userId,
    })
    .select("id");
  assertDirectWriteDenied({ ...roleInsert, context: "direct role definition insert" });

  const roleUpdate = await context.delegated.client
    .from("role_definitions")
    .update({ name: "Feature 091 direct update" })
    .eq("id", role.id)
    .select("id");
  assertDirectWriteDenied({ ...roleUpdate, context: "direct role definition update" });

  const capabilityInsert = await context.delegated.client
    .from("role_definition_capabilities")
    .insert({
      role_definition_id: role.id,
      capability_key: "media_library.access",
    })
    .select("role_definition_id");
  assertDirectWriteDenied({ ...capabilityInsert, context: "direct role capability insert" });

  const capabilityDelete = await context.delegated.client
    .from("role_definition_capabilities")
    .delete()
    .eq("role_definition_id", role.id)
    .eq("capability_key", "organization_users.manage")
    .select("role_definition_id");
  assertDirectWriteDenied({ ...capabilityDelete, context: "direct role capability delete" });

  const assignmentInsert = await context.delegated.client
    .from("role_assignments")
    .insert({
      tenant_id: context.tenantId,
      user_id: context.reviewerTarget.userId,
      role_definition_id: reviewerRoleDefinitionId,
      scope_type: "tenant",
      project_id: null,
      workspace_id: null,
      created_by: context.delegated.userId,
    })
    .select("id");
  assertDirectWriteDenied({ ...assignmentInsert, context: "direct role assignment insert" });

  const assignmentUpdate = await context.delegated.client
    .from("role_assignments")
    .update({
      revoked_at: new Date().toISOString(),
      revoked_by: context.delegated.userId,
    })
    .eq("id", grant.assignment.assignmentId)
    .select("id");
  assertDirectWriteDenied({ ...assignmentUpdate, context: "direct role assignment update" });

  const assignmentDelete = await context.delegated.client
    .from("role_assignments")
    .delete()
    .eq("id", grant.assignment.assignmentId)
    .select("id");
  assertDirectWriteDenied({ ...assignmentDelete, context: "direct role assignment delete" });
});

test("feature 091 Members UI copy distinguishes permission bundles from role administration", () => {
  const memberUserId = randomUUID();
  const assignedRole: AssignableCustomRole = {
    roleId: randomUUID(),
    name: "Client reviewer",
    description: null,
    capabilityKeys: ["review.workspace"],
    archivedAt: new Date("2026-04-30T11:00:00.000Z").toISOString(),
  };
  const assignableRole: AssignableCustomRole = {
    roleId: randomUUID(),
    name: "Media organizer",
    description: null,
    capabilityKeys: ["media_library.access"],
    archivedAt: null,
  };
  const assignment: CustomRoleAssignmentRecord = {
    assignmentId: randomUUID(),
    tenantId: randomUUID(),
    userId: memberUserId,
    roleId: assignedRole.roleId,
    scopeType: "tenant",
    projectId: null,
    projectName: null,
    workspaceId: null,
    workspaceName: null,
    createdAt: new Date("2026-04-30T10:00:00.000Z").toISOString(),
    createdBy: randomUUID(),
    revokedAt: null,
    revokedBy: null,
    role: assignedRole,
    effectiveCapabilityKeys: ["review.workspace"],
    ignoredCapabilityKeys: [],
    hasScopeWarnings: false,
  };

  const markup = renderWithMessages(
    createElement(MemberManagementPanelView, {
      data: createPanelData({
        memberUserId,
        assignedRole,
        assignment,
        assignableRole,
      }),
      statusMessage: null,
      isPending: false,
      inviteEmail: "",
      inviteRole: "photographer",
      memberRoles: { [memberUserId]: "reviewer" },
      customRoleSelections: {
        [memberUserId]: {
          roleId: assignableRole.roleId,
          scopeType: "tenant",
          projectId: "",
          workspaceId: "",
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

  assert.match(markup, /Custom roles define reusable permission bundles/);
  assert.match(markup, /Owners and admins manage role definitions and assignments/);
  assert.match(markup, /Custom roles grant access only in areas where custom-role enforcement has shipped/);
  assert.match(markup, /Role assignment remains owner\/admin-only/);
  assert.doesNotMatch(markup, /Broad enforcement will be added in later feature slices/);
});
