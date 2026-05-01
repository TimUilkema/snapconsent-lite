import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createOrRefreshTenantMembershipInvite,
  refreshTenantMembershipInvite,
  revokeTenantMembershipInvite,
} from "../src/lib/tenant/membership-invites";
import {
  createTenantMemberInvite,
  getOrganizationUserDirectoryData,
  getTenantMemberManagementData,
  removeTenantMember,
  updateTenantMemberRole,
} from "../src/lib/tenant/member-management-service";
import { resolveOrganizationUserAccess } from "../src/lib/tenant/organization-user-access";
import { resolveTenantPermissions } from "../src/lib/tenant/permissions";
import {
  archiveCustomRole,
  createCustomRole,
  listRoleEditorData,
} from "../src/lib/tenant/custom-role-service";
import {
  grantCustomRoleToMember,
  resolveCustomRoleAssignmentSummary,
  revokeCustomRoleFromMember,
} from "../src/lib/tenant/custom-role-assignment-service";
import { listReviewerAccessSummary } from "../src/lib/tenant/reviewer-access-service";
import {
  assertCanCaptureWorkspaceAction,
  assertCanCreateProjectsAction,
  assertCanManageProjectWorkspacesAction,
  assertCanReviewProjectAction,
} from "../src/lib/tenant/permissions";
import { authorizeMediaLibraryAccess } from "../src/lib/tenant/media-library-custom-role-access";
import { resolveTemplateManagementAccess } from "../src/lib/templates/template-service";
import { resolveProfilesAccess } from "../src/lib/profiles/profile-access";
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

type Feature088Context = {
  tenantId: string;
  secondTenantId: string;
  projectId: string;
  defaultWorkspaceId: string;
  owner: TestMember;
  admin: TestMember;
  manager: TestMember;
  inviter: TestMember;
  both: TestMember;
  noCapability: TestMember;
  revoked: TestMember;
  archived: TestMember;
  scoped: TestMember;
  crossTenant: TestMember;
  changeRolesOnly: TestMember;
  removeOnly: TestMember;
  otherInviter: TestMember;
  target: TestMember;
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

async function rpcBoolean(client: SupabaseClient, fn: string, args: Record<string, string | null>) {
  const { data, error } = await client.rpc(fn, args);
  assertNoPostgrestError(error, `rpc ${fn}`);
  return data as boolean;
}

async function createFeature088Context(): Promise<Feature088Context> {
  const [
    owner,
    admin,
    manager,
    inviter,
    both,
    noCapability,
    revoked,
    archived,
    scoped,
    crossTenant,
    changeRolesOnly,
    removeOnly,
    otherInviter,
    target,
    secondOwner,
  ] = await Promise.all([
    createSignedMember("feature088-owner"),
    createSignedMember("feature088-admin"),
    createSignedMember("feature088-manager"),
    createSignedMember("feature088-inviter"),
    createSignedMember("feature088-both"),
    createSignedMember("feature088-no-capability"),
    createSignedMember("feature088-revoked"),
    createSignedMember("feature088-archived"),
    createSignedMember("feature088-scoped"),
    createSignedMember("feature088-cross-tenant"),
    createSignedMember("feature088-change-roles"),
    createSignedMember("feature088-remove"),
    createSignedMember("feature088-other-inviter"),
    createSignedMember("feature088-target"),
    createSignedMember("feature088-second-owner"),
  ]);

  const { data: tenant, error: tenantError } = await adminClient
    .from("tenants")
    .insert({ name: `Feature 088 Tenant ${randomUUID()}` })
    .select("id")
    .single();
  assertNoPostgrestError(tenantError, "insert feature 088 tenant");
  assert.ok(tenant?.id);

  const { data: secondTenant, error: secondTenantError } = await adminClient
    .from("tenants")
    .insert({ name: `Feature 088 Second Tenant ${randomUUID()}` })
    .select("id")
    .single();
  assertNoPostgrestError(secondTenantError, "insert feature 088 second tenant");
  assert.ok(secondTenant?.id);

  const { error: membershipError } = await adminClient.from("memberships").insert([
    { tenant_id: tenant.id, user_id: owner.userId, role: "owner" },
    { tenant_id: tenant.id, user_id: admin.userId, role: "admin" },
    { tenant_id: tenant.id, user_id: manager.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: inviter.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: both.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: noCapability.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: revoked.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: archived.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: scoped.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: crossTenant.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: changeRolesOnly.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: removeOnly.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: otherInviter.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: target.userId, role: "photographer" },
    { tenant_id: secondTenant.id, user_id: secondOwner.userId, role: "owner" },
    { tenant_id: secondTenant.id, user_id: crossTenant.userId, role: "photographer" },
  ]);
  assertNoPostgrestError(membershipError, "insert feature 088 memberships");

  const { data: project, error: projectError } = await adminClient
    .from("projects")
    .insert({
      tenant_id: tenant.id,
      created_by: owner.userId,
      name: `Feature 088 Project ${randomUUID()}`,
      description: null,
      status: "active",
    })
    .select("id")
    .single();
  assertNoPostgrestError(projectError, "insert feature 088 project");
  assert.ok(project?.id);

  const defaultWorkspaceId = await getDefaultProjectWorkspaceId(adminClient, tenant.id, project.id);

  return {
    tenantId: tenant.id,
    secondTenantId: secondTenant.id,
    projectId: project.id,
    defaultWorkspaceId,
    owner,
    admin,
    manager,
    inviter,
    both,
    noCapability,
    revoked,
    archived,
    scoped,
    crossTenant,
    changeRolesOnly,
    removeOnly,
    otherInviter,
    target,
    secondOwner,
  };
}

async function createAndGrantRole(input: {
  context: Feature088Context;
  target: TestMember;
  capabilityKeys: string[];
}) {
  const role = await createCustomRole({
    supabase: input.context.owner.client,
    tenantId: input.context.tenantId,
    userId: input.context.owner.userId,
    body: {
      name: `Feature 088 role ${randomUUID()}`,
      capabilityKeys: input.capabilityKeys,
    },
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

async function createScopedAssignment(input: {
  context: Feature088Context;
  target: TestMember;
  capabilityKeys: string[];
  scopeType: "project" | "workspace";
}) {
  const role = await createCustomRole({
    supabase: input.context.owner.client,
    tenantId: input.context.tenantId,
    userId: input.context.owner.userId,
    body: {
      name: `Feature 088 scoped ${randomUUID()}`,
      capabilityKeys: input.capabilityKeys,
    },
  });

  const { error } = await adminClient.from("role_assignments").insert({
    tenant_id: input.context.tenantId,
    user_id: input.target.userId,
    role_definition_id: role.id,
    scope_type: input.scopeType,
    project_id: input.context.projectId,
    workspace_id: input.scopeType === "workspace" ? input.context.defaultWorkspaceId : null,
    created_by: input.context.owner.userId,
  });
  assertNoPostgrestError(error, "insert feature 088 scoped assignment");
}

test("feature 088 resolves organization-user custom roles and SQL helpers without broadening member management", async () => {
  const context = await createFeature088Context();
  await createAndGrantRole({
    context,
    target: context.manager,
    capabilityKeys: ["organization_users.manage"],
  });
  await createAndGrantRole({
    context,
    target: context.inviter,
    capabilityKeys: ["organization_users.invite"],
  });
  await createAndGrantRole({
    context,
    target: context.both,
    capabilityKeys: ["organization_users.manage", "organization_users.invite"],
  });
  await createAndGrantRole({
    context,
    target: context.noCapability,
    capabilityKeys: ["media_library.access"],
  });

  const managerAccess = await resolveOrganizationUserAccess({
    supabase: context.manager.client,
    tenantId: context.tenantId,
    userId: context.manager.userId,
  });
  assert.equal(managerAccess.canViewOrganizationUsers, true);
  assert.equal(managerAccess.canInviteOrganizationUsers, false);
  assert.equal(managerAccess.canChangeOrganizationUserRoles, false);
  assert.equal(managerAccess.canRemoveOrganizationUsers, false);

  const inviterAccess = await resolveOrganizationUserAccess({
    supabase: context.inviter.client,
    tenantId: context.tenantId,
    userId: context.inviter.userId,
  });
  assert.equal(inviterAccess.canViewOrganizationUsers, false);
  assert.equal(inviterAccess.canInviteOrganizationUsers, true);
  assert.deepEqual(inviterAccess.allowedInviteRoles, ["reviewer", "photographer"]);

  const bothAccess = await resolveOrganizationUserAccess({
    supabase: context.both.client,
    tenantId: context.tenantId,
    userId: context.both.userId,
  });
  assert.equal(bothAccess.canViewOrganizationUsers, true);
  assert.equal(bothAccess.canInviteOrganizationUsers, true);

  assert.equal(
    await rpcBoolean(context.manager.client, "current_user_can_view_organization_users", {
      p_tenant_id: context.tenantId,
    }),
    true,
  );
  assert.equal(
    await rpcBoolean(context.manager.client, "current_user_can_invite_organization_users", {
      p_tenant_id: context.tenantId,
      p_target_role: "reviewer",
    }),
    false,
  );
  assert.equal(
    await rpcBoolean(context.inviter.client, "current_user_can_invite_organization_users", {
      p_tenant_id: context.tenantId,
      p_target_role: "reviewer",
    }),
    true,
  );
  assert.equal(
    await rpcBoolean(context.inviter.client, "current_user_can_invite_organization_users", {
      p_tenant_id: context.tenantId,
      p_target_role: "admin",
    }),
    false,
  );

  const fixedPermissions = await resolveTenantPermissions(
    context.manager.client,
    context.tenantId,
    context.manager.userId,
  );
  assert.equal(fixedPermissions.canManageMembers, false);
  assert.equal(
    await rpcBoolean(context.manager.client, "current_user_can_manage_members", {
      p_tenant_id: context.tenantId,
    }),
    false,
  );
  await assert.rejects(
    getTenantMemberManagementData({
      supabase: context.manager.client,
      tenantId: context.tenantId,
      userId: context.manager.userId,
    }),
    { code: "tenant_member_management_forbidden" },
  );
});

test("feature 088 denies revoked archived cross-tenant project-scoped and workspace-scoped organization-user assignments", async () => {
  const context = await createFeature088Context();
  const revokedRole = await createAndGrantRole({
    context,
    target: context.revoked,
    capabilityKeys: ["organization_users.manage", "organization_users.invite"],
  });
  await revokeCustomRoleFromMember({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.revoked.userId,
    roleId: revokedRole.id,
  });
  await createAndGrantRole({
    context,
    target: context.archived,
    capabilityKeys: ["organization_users.manage", "organization_users.invite"],
  }).then((role) =>
    archiveCustomRole({
      supabase: context.owner.client,
      tenantId: context.tenantId,
      userId: context.owner.userId,
      roleId: role.id,
    }),
  );
  await createScopedAssignment({
    context,
    target: context.scoped,
    capabilityKeys: ["organization_users.manage", "organization_users.invite"],
    scopeType: "project",
  });
  await createScopedAssignment({
    context,
    target: context.scoped,
    capabilityKeys: ["organization_users.manage", "organization_users.invite"],
    scopeType: "workspace",
  });
  const crossTenantRole = await createCustomRole({
    supabase: context.secondOwner.client,
    tenantId: context.secondTenantId,
    userId: context.secondOwner.userId,
    body: {
      name: `Feature 088 cross tenant ${randomUUID()}`,
      capabilityKeys: ["organization_users.manage", "organization_users.invite"],
    },
  });
  await grantCustomRoleToMember({
    supabase: context.secondOwner.client,
    tenantId: context.secondTenantId,
    actorUserId: context.secondOwner.userId,
    targetUserId: context.crossTenant.userId,
    roleId: crossTenantRole.id,
  });

  for (const member of [context.revoked, context.archived, context.scoped, context.crossTenant]) {
    const access = await resolveOrganizationUserAccess({
      supabase: member.client,
      tenantId: context.tenantId,
      userId: member.userId,
    });
    assert.equal(access.canViewOrganizationUsers, false, `${member.email} should not view users`);
    assert.equal(access.canInviteOrganizationUsers, false, `${member.email} should not invite users`);
    assert.equal(
      await rpcBoolean(member.client, "current_user_can_view_organization_users", {
        p_tenant_id: context.tenantId,
      }),
      false,
    );
    assert.equal(
      await rpcBoolean(member.client, "current_user_can_invite_organization_users", {
        p_tenant_id: context.tenantId,
        p_target_role: "reviewer",
      }),
      false,
    );
  }
});

test("feature 088 reduced directory data omits privileged member-management sections", async () => {
  const context = await createFeature088Context();
  await createAndGrantRole({
    context,
    target: context.manager,
    capabilityKeys: ["organization_users.manage"],
  });
  await createAndGrantRole({
    context,
    target: context.inviter,
    capabilityKeys: ["organization_users.invite"],
  });
  await createAndGrantRole({
    context,
    target: context.both,
    capabilityKeys: ["organization_users.manage", "organization_users.invite"],
  });

  const adminInvite = await createOrRefreshTenantMembershipInvite(context.admin.client, {
    tenantId: context.tenantId,
    email: `feature088-admin-invite-${randomUUID()}@example.com`,
    role: "admin",
  });
  const ownInvite = await createOrRefreshTenantMembershipInvite(context.inviter.client, {
    tenantId: context.tenantId,
    email: `feature088-own-invite-${randomUUID()}@example.com`,
    role: "reviewer",
  });

  const managerData = await getOrganizationUserDirectoryData({
    supabase: context.manager.client,
    tenantId: context.tenantId,
    userId: context.manager.userId,
  });
  assert.equal(managerData.access.canViewOrganizationUsers, true);
  assert.equal(managerData.members.length, 14);
  assert.ok(managerData.members.some((member) => member.role === "owner"));
  assert.ok(managerData.pendingInvites.some((invite) => invite.inviteId === adminInvite.inviteId));
  assert.equal(
    managerData.pendingInvites.find((invite) => invite.inviteId === adminInvite.inviteId)?.canRevoke,
    false,
  );
  assert.equal("roleEditor" in managerData, false);
  assert.equal("customRoleAssignments" in managerData, false);
  assert.equal("reviewerAccess" in managerData, false);

  const inviterData = await getOrganizationUserDirectoryData({
    supabase: context.inviter.client,
    tenantId: context.tenantId,
    userId: context.inviter.userId,
  });
  assert.equal(inviterData.access.canViewOrganizationUsers, false);
  assert.equal(inviterData.access.canInviteOrganizationUsers, true);
  assert.equal(inviterData.members.length, 0);
  assert.equal(inviterData.pendingInvites.length, 1);
  assert.equal(inviterData.pendingInvites[0]?.inviteId, ownInvite.inviteId);
  assert.equal(inviterData.pendingInvites[0]?.canResend, true);
  assert.deepEqual(inviterData.pendingInvites[0]?.allowedRoleOptions, ["reviewer", "photographer"]);

  const bothData = await getOrganizationUserDirectoryData({
    supabase: context.both.client,
    tenantId: context.tenantId,
    userId: context.both.userId,
  });
  assert.equal(bothData.access.canViewOrganizationUsers, true);
  assert.equal(bothData.access.canInviteOrganizationUsers, true);
  assert.ok(bothData.pendingInvites.some((invite) => invite.inviteId === adminInvite.inviteId));
});

test("feature 088 delegated invite users can manage only their own non-admin pending invites", async () => {
  const context = await createFeature088Context();
  await createAndGrantRole({
    context,
    target: context.inviter,
    capabilityKeys: ["organization_users.invite"],
  });
  await createAndGrantRole({
    context,
    target: context.otherInviter,
    capabilityKeys: ["organization_users.invite"],
  });

  const reviewerInvite = await createTenantMemberInvite({
    supabase: context.inviter.client,
    tenantId: context.tenantId,
    userId: context.inviter.userId,
    inviterEmail: context.inviter.email,
    email: `feature088-reviewer-${randomUUID()}@example.com`,
    role: "reviewer",
  });
  assert.equal(reviewerInvite.outcome, "invited");
  assert.equal(reviewerInvite.role, "reviewer");

  const photographerInvite = await createTenantMemberInvite({
    supabase: context.inviter.client,
    tenantId: context.tenantId,
    userId: context.inviter.userId,
    inviterEmail: context.inviter.email,
    email: `feature088-photographer-${randomUUID()}@example.com`,
    role: "photographer",
  });
  assert.equal(photographerInvite.role, "photographer");

  await assert.rejects(
    createTenantMemberInvite({
      supabase: context.inviter.client,
      tenantId: context.tenantId,
      userId: context.inviter.userId,
      inviterEmail: context.inviter.email,
      email: `feature088-admin-denied-${randomUUID()}@example.com`,
      role: "admin",
    }),
    { code: "organization_user_invite_forbidden" },
  );

  const resent = await refreshTenantMembershipInvite(context.inviter.client, {
    inviteId: reviewerInvite.inviteId!,
    role: "photographer",
  });
  assert.equal(resent.outcome, "resent");
  assert.equal(resent.role, "photographer");
  assert.notEqual(resent.inviteToken, reviewerInvite.inviteToken);

  const adminInvite = await createOrRefreshTenantMembershipInvite(context.admin.client, {
    tenantId: context.tenantId,
    email: `feature088-admin-pending-${randomUUID()}@example.com`,
    role: "admin",
  });
  const otherInvite = await createOrRefreshTenantMembershipInvite(context.otherInviter.client, {
    tenantId: context.tenantId,
    email: `feature088-other-pending-${randomUUID()}@example.com`,
    role: "reviewer",
  });

  await assert.rejects(
    refreshTenantMembershipInvite(context.inviter.client, {
      inviteId: adminInvite.inviteId!,
      role: "reviewer",
    }),
    { code: "tenant_membership_invite_forbidden" },
  );
  await assert.rejects(
    refreshTenantMembershipInvite(context.inviter.client, {
      inviteId: otherInvite.inviteId!,
      role: "reviewer",
    }),
    { code: "tenant_membership_invite_forbidden" },
  );

  const revoked = await revokeTenantMembershipInvite(context.inviter.client, photographerInvite.inviteId!);
  assert.equal(revoked.outcome, "revoked");
  await assert.rejects(
    revokeTenantMembershipInvite(context.inviter.client, adminInvite.inviteId!),
    { code: "tenant_membership_invite_forbidden" },
  );
});

test("feature 088 preserves non-expansion around delegated organization-user slices", async () => {
  const context = await createFeature088Context();
  await createAndGrantRole({
    context,
    target: context.manager,
    capabilityKeys: ["organization_users.manage"],
  });
  await createAndGrantRole({
    context,
    target: context.inviter,
    capabilityKeys: ["organization_users.invite"],
  });
  await createAndGrantRole({
    context,
    target: context.changeRolesOnly,
    capabilityKeys: ["organization_users.change_roles"],
  });
  await createAndGrantRole({
    context,
    target: context.removeOnly,
    capabilityKeys: ["organization_users.remove"],
  });

  for (const member of [context.manager, context.inviter]) {
    await assert.rejects(
      updateTenantMemberRole({
        supabase: member.client,
        tenantId: context.tenantId,
        userId: member.userId,
        targetUserId: context.target.userId,
        role: "reviewer",
      }),
      { code: "organization_user_role_change_forbidden" },
    );
    await assert.rejects(
      removeTenantMember({
        supabase: member.client,
        tenantId: context.tenantId,
        userId: member.userId,
        targetUserId: context.target.userId,
      }),
      { code: "organization_user_remove_forbidden" },
    );
  }

  for (const member of [context.manager, context.inviter, context.changeRolesOnly, context.removeOnly]) {
    await assert.rejects(
      listRoleEditorData({
        supabase: member.client,
        tenantId: context.tenantId,
        userId: member.userId,
      }),
      { code: "tenant_member_management_forbidden" },
    );
    await assert.rejects(
      resolveCustomRoleAssignmentSummary({
        supabase: member.client,
        tenantId: context.tenantId,
        userId: member.userId,
      }),
      { code: "tenant_member_management_forbidden" },
    );
    await assert.rejects(
      listReviewerAccessSummary({
        supabase: member.client,
        tenantId: context.tenantId,
        userId: member.userId,
      }),
      { code: "tenant_member_management_forbidden" },
    );
  }

  await assert.rejects(
    assertCanCreateProjectsAction(context.manager.client, context.tenantId, context.manager.userId),
    { code: "project_create_forbidden" },
  );
  await assert.rejects(
    assertCanManageProjectWorkspacesAction(
      context.manager.client,
      context.tenantId,
      context.manager.userId,
      context.projectId,
    ),
  );
  await assert.rejects(
    assertCanCaptureWorkspaceAction(
      context.manager.client,
      context.tenantId,
      context.manager.userId,
      context.projectId,
      context.defaultWorkspaceId,
    ),
  );
  await assert.rejects(
    assertCanReviewProjectAction(
      context.manager.client,
      context.tenantId,
      context.manager.userId,
      context.projectId,
    ),
    { code: "project_review_forbidden" },
  );
  await assert.rejects(
    authorizeMediaLibraryAccess({
      supabase: context.manager.client,
      tenantId: context.tenantId,
      userId: context.manager.userId,
    }),
    { code: "media_library_forbidden" },
  );

  const templateAccess = await resolveTemplateManagementAccess(
    context.manager.client,
    context.tenantId,
    context.manager.userId,
  );
  assert.equal(templateAccess.canManageTemplates, false);
  const profileAccess = await resolveProfilesAccess(
    context.manager.client,
    context.tenantId,
    context.manager.userId,
  );
  assert.equal(profileAccess.canViewProfiles, true);
  assert.equal(profileAccess.canManageProfiles, false);
});
