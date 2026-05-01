import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentType, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import enMessages from "../messages/en.json";
import { DelegatedMemberManagementPanelView } from "../src/components/members/delegated-member-management-panel";
import {
  getOrganizationUserDirectoryData,
  type OrganizationUserDirectoryMemberRecord,
  removeTenantMember,
  updateTenantMemberRole,
} from "../src/lib/tenant/member-management-service";
import { resolveOrganizationUserAccess } from "../src/lib/tenant/organization-user-access";
import { resolveTenantPermissions, type ManageableMembershipRole } from "../src/lib/tenant/permissions";
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
import { resolveProfilesAccess } from "../src/lib/profiles/profile-access";
import { resolveTemplateManagementAccess } from "../src/lib/templates/template-service";
import {
  adminClient,
  assertNoPostgrestError,
  createAuthUserWithRetry,
  createReviewerRoleAssignment,
  getDefaultProjectWorkspaceId,
  signInClient,
} from "./helpers/supabase-test-client";

type TestMember = {
  userId: string;
  email: string;
  password: string;
  client: SupabaseClient;
};

type Feature089Context = {
  tenantId: string;
  secondTenantId: string;
  projectId: string;
  defaultWorkspaceId: string;
  owner: TestMember;
  admin: TestMember;
  changer: TestMember;
  remover: TestMember;
  both: TestMember;
  manageOnly: TestMember;
  inviteOnly: TestMember;
  revoked: TestMember;
  archived: TestMember;
  scoped: TestMember;
  crossTenant: TestMember;
  reviewerTarget: TestMember;
  photographerTarget: TestMember;
  adminTarget: TestMember;
  secondOwner: TestMember;
};

const TestNextIntlClientProvider = NextIntlClientProvider as ComponentType<{
  locale: string;
  messages: typeof enMessages;
  children?: ReactNode;
}>;

function toDelegatedMemberRoleMap(members: OrganizationUserDirectoryMemberRecord[]) {
  return Object.fromEntries(
    members
      .filter((member) => member.role !== "owner")
      .map((member) => [member.userId, member.role as ManageableMembershipRole]),
  );
}

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

async function createFeature089Context(): Promise<Feature089Context> {
  const [
    owner,
    admin,
    changer,
    remover,
    both,
    manageOnly,
    inviteOnly,
    revoked,
    archived,
    scoped,
    crossTenant,
    reviewerTarget,
    photographerTarget,
    adminTarget,
    secondOwner,
  ] = await Promise.all([
    createSignedMember("feature089-owner"),
    createSignedMember("feature089-admin"),
    createSignedMember("feature089-changer"),
    createSignedMember("feature089-remover"),
    createSignedMember("feature089-both"),
    createSignedMember("feature089-manage-only"),
    createSignedMember("feature089-invite-only"),
    createSignedMember("feature089-revoked"),
    createSignedMember("feature089-archived"),
    createSignedMember("feature089-scoped"),
    createSignedMember("feature089-cross-tenant"),
    createSignedMember("feature089-reviewer-target"),
    createSignedMember("feature089-photographer-target"),
    createSignedMember("feature089-admin-target"),
    createSignedMember("feature089-second-owner"),
  ]);

  const { data: tenant, error: tenantError } = await adminClient
    .from("tenants")
    .insert({ name: `Feature 089 Tenant ${randomUUID()}` })
    .select("id")
    .single();
  assertNoPostgrestError(tenantError, "insert feature 089 tenant");
  assert.ok(tenant?.id);

  const { data: secondTenant, error: secondTenantError } = await adminClient
    .from("tenants")
    .insert({ name: `Feature 089 Second Tenant ${randomUUID()}` })
    .select("id")
    .single();
  assertNoPostgrestError(secondTenantError, "insert feature 089 second tenant");
  assert.ok(secondTenant?.id);

  const { error: membershipError } = await adminClient.from("memberships").insert([
    { tenant_id: tenant.id, user_id: owner.userId, role: "owner" },
    { tenant_id: tenant.id, user_id: admin.userId, role: "admin" },
    { tenant_id: tenant.id, user_id: changer.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: remover.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: both.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: manageOnly.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: inviteOnly.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: revoked.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: archived.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: scoped.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: crossTenant.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: reviewerTarget.userId, role: "reviewer" },
    { tenant_id: tenant.id, user_id: photographerTarget.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: adminTarget.userId, role: "admin" },
    { tenant_id: secondTenant.id, user_id: secondOwner.userId, role: "owner" },
    { tenant_id: secondTenant.id, user_id: crossTenant.userId, role: "photographer" },
  ]);
  assertNoPostgrestError(membershipError, "insert feature 089 memberships");

  const { data: project, error: projectError } = await adminClient
    .from("projects")
    .insert({
      tenant_id: tenant.id,
      created_by: owner.userId,
      name: `Feature 089 Project ${randomUUID()}`,
      description: null,
      status: "active",
    })
    .select("id")
    .single();
  assertNoPostgrestError(projectError, "insert feature 089 project");
  assert.ok(project?.id);

  const defaultWorkspaceId = await getDefaultProjectWorkspaceId(adminClient, tenant.id, project.id);

  return {
    tenantId: tenant.id,
    secondTenantId: secondTenant.id,
    projectId: project.id,
    defaultWorkspaceId,
    owner,
    admin,
    changer,
    remover,
    both,
    manageOnly,
    inviteOnly,
    revoked,
    archived,
    scoped,
    crossTenant,
    reviewerTarget,
    photographerTarget,
    adminTarget,
    secondOwner,
  };
}

async function createAndGrantRole(input: {
  context: Feature089Context;
  target: TestMember;
  capabilityKeys: string[];
}) {
  const role = await createCustomRole({
    supabase: input.context.owner.client,
    tenantId: input.context.tenantId,
    userId: input.context.owner.userId,
    body: {
      name: `Feature 089 role ${randomUUID()}`,
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
  context: Feature089Context;
  target: TestMember;
  capabilityKeys: string[];
  scopeType: "project" | "workspace";
}) {
  const role = await createCustomRole({
    supabase: input.context.owner.client,
    tenantId: input.context.tenantId,
    userId: input.context.owner.userId,
    body: {
      name: `Feature 089 scoped ${randomUUID()}`,
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
  assertNoPostgrestError(error, "insert feature 089 scoped assignment");
}

test("feature 089 resolves target-sensitive organization-user role-change and removal capabilities", async () => {
  const context = await createFeature089Context();
  await createAndGrantRole({
    context,
    target: context.changer,
    capabilityKeys: ["organization_users.change_roles"],
  });
  await createAndGrantRole({
    context,
    target: context.remover,
    capabilityKeys: ["organization_users.remove"],
  });

  const changerAccess = await resolveOrganizationUserAccess({
    supabase: context.changer.client,
    tenantId: context.tenantId,
    userId: context.changer.userId,
  });
  assert.equal(changerAccess.canViewOrganizationUsers, true);
  assert.equal(changerAccess.canChangeOrganizationUserRoles, true);
  assert.equal(changerAccess.canRemoveOrganizationUsers, false);

  const removerAccess = await resolveOrganizationUserAccess({
    supabase: context.remover.client,
    tenantId: context.tenantId,
    userId: context.remover.userId,
  });
  assert.equal(removerAccess.canViewOrganizationUsers, true);
  assert.equal(removerAccess.canChangeOrganizationUserRoles, false);
  assert.equal(removerAccess.canRemoveOrganizationUsers, true);

  assert.equal(
    await rpcBoolean(context.changer.client, "current_user_can_manage_members", {
      p_tenant_id: context.tenantId,
    }),
    false,
  );
  assert.equal(
    await rpcBoolean(context.changer.client, "current_user_can_change_organization_user_role", {
      p_tenant_id: context.tenantId,
      p_target_user_id: context.reviewerTarget.userId,
      p_next_role: "photographer",
    }),
    true,
  );
  assert.equal(
    await rpcBoolean(context.changer.client, "current_user_can_change_organization_user_role", {
      p_tenant_id: context.tenantId,
      p_target_user_id: context.photographerTarget.userId,
      p_next_role: "reviewer",
    }),
    true,
  );
  assert.equal(
    await rpcBoolean(context.changer.client, "current_user_can_change_organization_user_role", {
      p_tenant_id: context.tenantId,
      p_target_user_id: context.adminTarget.userId,
      p_next_role: "reviewer",
    }),
    false,
  );
  assert.equal(
    await rpcBoolean(context.changer.client, "current_user_can_change_organization_user_role", {
      p_tenant_id: context.tenantId,
      p_target_user_id: context.changer.userId,
      p_next_role: "reviewer",
    }),
    false,
  );
  assert.equal(
    await rpcBoolean(context.changer.client, "current_user_can_change_organization_user_role", {
      p_tenant_id: context.tenantId,
      p_target_user_id: context.reviewerTarget.userId,
      p_next_role: "admin",
    }),
    false,
  );

  assert.equal(
    await rpcBoolean(context.remover.client, "current_user_can_remove_organization_user", {
      p_tenant_id: context.tenantId,
      p_target_user_id: context.reviewerTarget.userId,
    }),
    true,
  );
  assert.equal(
    await rpcBoolean(context.remover.client, "current_user_can_remove_organization_user", {
      p_tenant_id: context.tenantId,
      p_target_user_id: context.adminTarget.userId,
    }),
    false,
  );
  assert.equal(
    await rpcBoolean(context.remover.client, "current_user_can_remove_organization_user", {
      p_tenant_id: context.tenantId,
      p_target_user_id: context.remover.userId,
    }),
    false,
  );
});

test("feature 089 service role changes enforce target restrictions and preserve reviewer cleanup", async () => {
  const context = await createFeature089Context();
  await createAndGrantRole({
    context,
    target: context.changer,
    capabilityKeys: ["organization_users.change_roles"],
  });
  const reviewerAssignmentId = await createReviewerRoleAssignment({
    tenantId: context.tenantId,
    userId: context.reviewerTarget.userId,
    createdBy: context.owner.userId,
  });

  const changedReviewer = await updateTenantMemberRole({
    supabase: context.changer.client,
    tenantId: context.tenantId,
    userId: context.changer.userId,
    targetUserId: context.reviewerTarget.userId,
    role: "photographer",
  });
  assert.equal(changedReviewer.role, "photographer");

  const { data: revokedAssignment, error: revokedLookupError } = await adminClient
    .from("role_assignments")
    .select("revoked_at, revoked_by")
    .eq("id", reviewerAssignmentId)
    .single();
  assertNoPostgrestError(revokedLookupError, "select revoked reviewer assignment");
  assert.ok(revokedAssignment?.revoked_at);
  assert.equal(revokedAssignment?.revoked_by, context.changer.userId);

  const changedPhotographer = await updateTenantMemberRole({
    supabase: context.changer.client,
    tenantId: context.tenantId,
    userId: context.changer.userId,
    targetUserId: context.photographerTarget.userId,
    role: "reviewer",
  });
  assert.equal(changedPhotographer.role, "reviewer");

  const { data: photographerAssignments, error: photographerAssignmentError } = await adminClient
    .from("role_assignments")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .eq("user_id", context.photographerTarget.userId)
    .is("revoked_at", null);
  assertNoPostgrestError(photographerAssignmentError, "select photographer reviewer assignments");
  assert.deepEqual(photographerAssignments, []);

  await assert.rejects(
    updateTenantMemberRole({
      supabase: context.changer.client,
      tenantId: context.tenantId,
      userId: context.changer.userId,
      targetUserId: context.adminTarget.userId,
      role: "reviewer",
    }),
    { code: "organization_user_target_forbidden" },
  );
  await assert.rejects(
    updateTenantMemberRole({
      supabase: context.changer.client,
      tenantId: context.tenantId,
      userId: context.changer.userId,
      targetUserId: context.owner.userId,
      role: "reviewer",
    }),
    { code: "organization_user_target_forbidden" },
  );
  await assert.rejects(
    updateTenantMemberRole({
      supabase: context.changer.client,
      tenantId: context.tenantId,
      userId: context.changer.userId,
      targetUserId: context.changer.userId,
      role: "reviewer",
    }),
    { code: "organization_user_self_target_forbidden" },
  );
  await assert.rejects(
    updateTenantMemberRole({
      supabase: context.changer.client,
      tenantId: context.tenantId,
      userId: context.changer.userId,
      targetUserId: context.reviewerTarget.userId,
      role: "admin",
    }),
    { code: "invalid_membership_role" },
  );
});

test("feature 089 service removals enforce target restrictions and preserve membership cascades", async () => {
  const context = await createFeature089Context();
  await createAndGrantRole({
    context,
    target: context.remover,
    capabilityKeys: ["organization_users.remove"],
  });
  const customRole = await createAndGrantRole({
    context,
    target: context.photographerTarget,
    capabilityKeys: ["projects.create"],
  });
  await grantCustomRoleToMember({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.photographerTarget.userId,
    roleId: customRole.id,
  });
  const reviewerAssignmentId = await createReviewerRoleAssignment({
    tenantId: context.tenantId,
    userId: context.reviewerTarget.userId,
    createdBy: context.owner.userId,
  });

  await removeTenantMember({
    supabase: context.remover.client,
    tenantId: context.tenantId,
    userId: context.remover.userId,
    targetUserId: context.photographerTarget.userId,
  });
  const { data: removedCustomAssignments, error: removedCustomAssignmentsError } = await adminClient
    .from("role_assignments")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .eq("user_id", context.photographerTarget.userId);
  assertNoPostgrestError(removedCustomAssignmentsError, "select cascaded custom role assignments");
  assert.deepEqual(removedCustomAssignments, []);

  await removeTenantMember({
    supabase: context.remover.client,
    tenantId: context.tenantId,
    userId: context.remover.userId,
    targetUserId: context.reviewerTarget.userId,
  });
  const { data: removedReviewerAssignment, error: removedReviewerAssignmentError } = await adminClient
    .from("role_assignments")
    .select("id")
    .eq("id", reviewerAssignmentId)
    .maybeSingle();
  assertNoPostgrestError(removedReviewerAssignmentError, "select cascaded reviewer assignment");
  assert.equal(removedReviewerAssignment, null);

  await assert.rejects(
    removeTenantMember({
      supabase: context.remover.client,
      tenantId: context.tenantId,
      userId: context.remover.userId,
      targetUserId: context.adminTarget.userId,
    }),
    { code: "organization_user_target_forbidden" },
  );
  await assert.rejects(
    removeTenantMember({
      supabase: context.remover.client,
      tenantId: context.tenantId,
      userId: context.remover.userId,
      targetUserId: context.owner.userId,
    }),
    { code: "organization_user_target_forbidden" },
  );
  await assert.rejects(
    removeTenantMember({
      supabase: context.remover.client,
      tenantId: context.tenantId,
      userId: context.remover.userId,
      targetUserId: context.remover.userId,
    }),
    { code: "organization_user_self_target_forbidden" },
  );
});

test("feature 089 denies revoked archived cross-tenant project-scoped and workspace-scoped assignments", async () => {
  const context = await createFeature089Context();
  const revokedRole = await createAndGrantRole({
    context,
    target: context.revoked,
    capabilityKeys: ["organization_users.change_roles", "organization_users.remove"],
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
    capabilityKeys: ["organization_users.change_roles", "organization_users.remove"],
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
    capabilityKeys: ["organization_users.change_roles", "organization_users.remove"],
    scopeType: "project",
  });
  await createScopedAssignment({
    context,
    target: context.scoped,
    capabilityKeys: ["organization_users.change_roles", "organization_users.remove"],
    scopeType: "workspace",
  });

  const crossTenantRole = await createCustomRole({
    supabase: context.secondOwner.client,
    tenantId: context.secondTenantId,
    userId: context.secondOwner.userId,
    body: {
      name: `Feature 089 cross tenant ${randomUUID()}`,
      capabilityKeys: ["organization_users.change_roles", "organization_users.remove"],
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
    assert.equal(access.canViewOrganizationUsers, false);
    assert.equal(access.canChangeOrganizationUserRoles, false);
    assert.equal(access.canRemoveOrganizationUsers, false);
    assert.equal(
      await rpcBoolean(member.client, "current_user_can_change_organization_user_role", {
        p_tenant_id: context.tenantId,
        p_target_user_id: context.reviewerTarget.userId,
        p_next_role: "photographer",
      }),
      false,
    );
    assert.equal(
      await rpcBoolean(member.client, "current_user_can_remove_organization_user", {
        p_tenant_id: context.tenantId,
        p_target_user_id: context.reviewerTarget.userId,
      }),
      false,
    );
  }
});

test("feature 089 does not expand role editor assignment reviewer access or unrelated capabilities", async () => {
  const context = await createFeature089Context();
  await createAndGrantRole({
    context,
    target: context.both,
    capabilityKeys: ["organization_users.change_roles", "organization_users.remove"],
  });

  await assert.rejects(
    listRoleEditorData({
      supabase: context.both.client,
      tenantId: context.tenantId,
      userId: context.both.userId,
    }),
    { code: "tenant_member_management_forbidden" },
  );
  await assert.rejects(
    resolveCustomRoleAssignmentSummary({
      supabase: context.both.client,
      tenantId: context.tenantId,
      userId: context.both.userId,
    }),
    { code: "tenant_member_management_forbidden" },
  );
  await assert.rejects(
    listReviewerAccessSummary({
      supabase: context.both.client,
      tenantId: context.tenantId,
      userId: context.both.userId,
    }),
    { code: "tenant_member_management_forbidden" },
  );

  const permissions = await resolveTenantPermissions(context.both.client, context.tenantId, context.both.userId);
  assert.equal(permissions.canManageMembers, false);
  assert.equal(permissions.canCreateProjects, false);

  await assert.rejects(
    assertCanCreateProjectsAction(context.both.client, context.tenantId, context.both.userId),
    { code: "project_create_forbidden" },
  );
  await assert.rejects(
    assertCanManageProjectWorkspacesAction(
      context.both.client,
      context.tenantId,
      context.both.userId,
      context.projectId,
    ),
  );
  await assert.rejects(
    assertCanCaptureWorkspaceAction(
      context.both.client,
      context.tenantId,
      context.both.userId,
      context.projectId,
      context.defaultWorkspaceId,
    ),
  );
  await assert.rejects(
    assertCanReviewProjectAction(
      context.both.client,
      context.tenantId,
      context.both.userId,
      context.projectId,
    ),
    { code: "project_review_forbidden" },
  );
  await assert.rejects(
    authorizeMediaLibraryAccess({
      supabase: context.both.client,
      tenantId: context.tenantId,
      userId: context.both.userId,
    }),
    { code: "media_library_forbidden" },
  );

  const templateAccess = await resolveTemplateManagementAccess(
    context.both.client,
    context.tenantId,
    context.both.userId,
  );
  assert.equal(templateAccess.canManageTemplates, false);
  const profileAccess = await resolveProfilesAccess(context.both.client, context.tenantId, context.both.userId);
  assert.equal(profileAccess.canManageProfiles, false);
});

test("feature 089 reduced delegated data and UI expose only row-level safe controls", async () => {
  const context = await createFeature089Context();
  await createAndGrantRole({
    context,
    target: context.both,
    capabilityKeys: ["organization_users.change_roles", "organization_users.remove"],
  });

  const data = await getOrganizationUserDirectoryData({
    supabase: context.both.client,
    tenantId: context.tenantId,
    userId: context.both.userId,
  });
  assert.equal("roleEditor" in data, false);
  assert.equal("assignableCustomRoles" in data, false);
  assert.equal("customRoleAssignments" in data, false);
  assert.equal("reviewerAccess" in data, false);

  const ownerRow = data.members.find((member) => member.userId === context.owner.userId);
  const adminRow = data.members.find((member) => member.userId === context.adminTarget.userId);
  const selfRow = data.members.find((member) => member.userId === context.both.userId);
  const reviewerRow = data.members.find((member) => member.userId === context.reviewerTarget.userId);
  const photographerRow = data.members.find((member) => member.userId === context.photographerTarget.userId);
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

  const markup = renderToStaticMarkup(
    createElement(
      TestNextIntlClientProvider,
      { locale: "en", messages: enMessages },
      createElement(DelegatedMemberManagementPanelView, {
        data,
        statusMessage: null,
        isPending: false,
        inviteEmail: "",
        inviteRole: "reviewer",
        inviteRoles: {},
        memberRoles: toDelegatedMemberRoleMap(data.members),
        onInviteEmailChange() {},
        onInviteRoleChange() {},
        onSubmitInvite() {},
        onPendingInviteRoleChange() {},
        onResendInvite() {},
        onRevokeInvite() {},
        onMemberRoleChange() {},
        onUpdateMemberRole() {},
        onRemoveMember() {},
      }),
    ),
  );
  assert.match(markup, /Save role/);
  assert.match(markup, /Remove/);
  assert.match(markup, /Owner/);
  assert.match(markup, /Admin/);
});
