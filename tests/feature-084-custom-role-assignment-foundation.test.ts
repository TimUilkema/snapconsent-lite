import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import enMessages from "../messages/en.json";
import { MemberManagementPanelView } from "../src/components/members/member-management-panel";
import { authorizeMediaLibraryAccess } from "../src/lib/project-releases/project-release-service";
import {
  archiveCustomRole,
  createCustomRole,
} from "../src/lib/tenant/custom-role-service";
import {
  grantCustomRoleToMember,
  listAssignableCustomRoles,
  listCustomRoleAssignmentsForMembers,
  resolveCustomRoleAssignmentSummary,
  revokeCustomRoleFromMember,
  type AssignableCustomRole,
  type CustomRoleAssignmentRecord,
} from "../src/lib/tenant/custom-role-assignment-service";
import {
  assertCanCaptureWorkspaceAction,
  assertCanCreateProjectsAction,
  assertCanManageProjectWorkspacesAction,
  resolveTenantPermissions,
} from "../src/lib/tenant/permissions";
import { authorizeMediaLibraryFolderManagement } from "../src/lib/tenant/media-library-custom-role-access";
import { grantTenantWideReviewerAccess } from "../src/lib/tenant/reviewer-access-service";
import type { TenantMemberManagementData } from "../src/lib/tenant/member-management-service";
import {
  adminClient,
  assertNoPostgrestError,
  createAuthUserWithRetry,
  createPhotographerProjectWorkspace,
  getDefaultProjectWorkspaceId,
  signInClient,
} from "./helpers/supabase-test-client";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentType } from "react";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

type Feature084Context = {
  tenantId: string;
  secondTenantId: string;
  projectId: string;
  defaultWorkspaceId: string;
  photographerWorkspaceId: string;
  ownerUserId: string;
  adminUserId: string;
  reviewerUserId: string;
  photographerUserId: string;
  secondOwnerUserId: string;
  outsiderUserId: string;
  ownerClient: SupabaseClient;
  adminClient: SupabaseClient;
  reviewerClient: SupabaseClient;
  photographerClient: SupabaseClient;
  secondOwnerClient: SupabaseClient;
};

const TestNextIntlClientProvider = NextIntlClientProvider as ComponentType<{
  locale: string;
  messages: typeof enMessages;
  children?: ReactNode;
}>;

async function createFeature084Context(): Promise<Feature084Context> {
  const owner = await createAuthUserWithRetry(adminClient, "feature084-owner");
  const admin = await createAuthUserWithRetry(adminClient, "feature084-admin");
  const reviewer = await createAuthUserWithRetry(adminClient, "feature084-reviewer");
  const photographer = await createAuthUserWithRetry(adminClient, "feature084-photographer");
  const secondOwner = await createAuthUserWithRetry(adminClient, "feature084-second-owner");
  const outsider = await createAuthUserWithRetry(adminClient, "feature084-outsider");

  const ownerClient = await signInClient(owner.email, owner.password);
  const adminSignedInClient = await signInClient(admin.email, admin.password);
  const reviewerClient = await signInClient(reviewer.email, reviewer.password);
  const photographerClient = await signInClient(photographer.email, photographer.password);
  const secondOwnerClient = await signInClient(secondOwner.email, secondOwner.password);

  const { data: tenant, error: tenantError } = await adminClient
    .from("tenants")
    .insert({ name: `Feature 084 Tenant ${randomUUID()}` })
    .select("id")
    .single();
  assertNoPostgrestError(tenantError, "insert feature 084 tenant");
  assert.ok(tenant?.id, "feature 084 tenant should exist");

  const { data: secondTenant, error: secondTenantError } = await adminClient
    .from("tenants")
    .insert({ name: `Feature 084 Second Tenant ${randomUUID()}` })
    .select("id")
    .single();
  assertNoPostgrestError(secondTenantError, "insert feature 084 second tenant");
  assert.ok(secondTenant?.id, "feature 084 second tenant should exist");

  const { error: membershipError } = await adminClient.from("memberships").insert([
    { tenant_id: tenant.id, user_id: owner.userId, role: "owner" },
    { tenant_id: tenant.id, user_id: admin.userId, role: "admin" },
    { tenant_id: tenant.id, user_id: reviewer.userId, role: "reviewer" },
    { tenant_id: tenant.id, user_id: photographer.userId, role: "photographer" },
    { tenant_id: secondTenant.id, user_id: secondOwner.userId, role: "owner" },
  ]);
  assertNoPostgrestError(membershipError, "insert feature 084 memberships");

  const { data: project, error: projectError } = await adminClient
    .from("projects")
    .insert({
      tenant_id: tenant.id,
      created_by: owner.userId,
      name: `Feature 084 Project ${randomUUID()}`,
      description: null,
    })
    .select("id")
    .single();
  assertNoPostgrestError(projectError, "insert feature 084 project");
  assert.ok(project?.id, "feature 084 project should exist");

  const defaultWorkspaceId = await getDefaultProjectWorkspaceId(adminClient, tenant.id, project.id);
  const photographerWorkspaceId = await createPhotographerProjectWorkspace({
    supabase: adminClient,
    tenantId: tenant.id,
    projectId: project.id,
    createdBy: owner.userId,
    photographerUserId: photographer.userId,
    name: "Feature 084 photographer workspace",
  });

  return {
    tenantId: tenant.id,
    secondTenantId: secondTenant.id,
    projectId: project.id,
    defaultWorkspaceId,
    photographerWorkspaceId,
    ownerUserId: owner.userId,
    adminUserId: admin.userId,
    reviewerUserId: reviewer.userId,
    photographerUserId: photographer.userId,
    secondOwnerUserId: secondOwner.userId,
    outsiderUserId: outsider.userId,
    ownerClient,
    adminClient: adminSignedInClient,
    reviewerClient,
    photographerClient,
    secondOwnerClient,
  };
}

async function getSystemReviewerRoleId() {
  const { data, error } = await adminClient
    .from("role_definitions")
    .select("id")
    .eq("is_system", true)
    .eq("system_role_key", "reviewer")
    .single();

  assertNoPostgrestError(error, "select system reviewer role");
  assert.ok(data?.id, "system reviewer role should exist");
  return data.id as string;
}

async function rpcBoolean(client: SupabaseClient, fn: string, args: Record<string, string>) {
  const { data, error } = await client.rpc(fn, args);
  assertNoPostgrestError(error, `rpc ${fn}`);
  return data as boolean;
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

test("feature 084 owner and admin can list, assign, revoke, re-add, and stack tenant custom roles", async () => {
  const context = await createFeature084Context();
  const reviewerRole = await createCustomRole({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    body: {
      name: `Client reviewer ${randomUUID()}`,
      capabilityKeys: ["review.workspace"],
    },
  });
  const mediaRole = await createCustomRole({
    supabase: context.adminClient,
    tenantId: context.tenantId,
    userId: context.adminUserId,
    body: {
      name: `Media organizer ${randomUUID()}`,
      capabilityKeys: ["media_library.access"],
    },
  });

  const assignable = await listAssignableCustomRoles({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
  });
  assert.ok(assignable.some((role) => role.roleId === reviewerRole.id));
  assert.ok(assignable.every((role) => !role.archivedAt));

  const firstGrant = await grantCustomRoleToMember({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    actorUserId: context.ownerUserId,
    targetUserId: context.reviewerUserId,
    roleId: reviewerRole.id,
  });
  assert.equal(firstGrant.created, true);
  assert.equal(firstGrant.assignment.scopeType, "tenant");
  assert.equal(firstGrant.assignment.roleId, reviewerRole.id);

  const duplicateGrant = await grantCustomRoleToMember({
    supabase: context.adminClient,
    tenantId: context.tenantId,
    actorUserId: context.adminUserId,
    targetUserId: context.reviewerUserId,
    roleId: reviewerRole.id,
  });
  assert.equal(duplicateGrant.created, false);
  assert.equal(duplicateGrant.assignment.assignmentId, firstGrant.assignment.assignmentId);

  const secondRoleGrant = await grantCustomRoleToMember({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    actorUserId: context.ownerUserId,
    targetUserId: context.reviewerUserId,
    roleId: mediaRole.id,
  });
  assert.equal(secondRoleGrant.created, true);

  const summaries = await listCustomRoleAssignmentsForMembers({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
  });
  const reviewerSummary = summaries.find((summary) => summary.userId === context.reviewerUserId);
  assert.equal(reviewerSummary?.assignments.length, 2);

  const firstRevoke = await revokeCustomRoleFromMember({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    actorUserId: context.ownerUserId,
    targetUserId: context.reviewerUserId,
    roleId: reviewerRole.id,
  });
  assert.equal(firstRevoke.revoked, true);
  assert.ok(firstRevoke.assignment?.revokedAt);
  assert.equal(firstRevoke.assignment?.revokedBy, context.ownerUserId);

  const duplicateRevoke = await revokeCustomRoleFromMember({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    actorUserId: context.ownerUserId,
    targetUserId: context.reviewerUserId,
    roleId: reviewerRole.id,
  });
  assert.equal(duplicateRevoke.revoked, false);
  assert.equal(duplicateRevoke.assignment, null);

  const replacementGrant = await grantCustomRoleToMember({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    actorUserId: context.ownerUserId,
    targetUserId: context.reviewerUserId,
    roleId: reviewerRole.id,
  });
  assert.equal(replacementGrant.created, true);
  assert.notEqual(replacementGrant.assignment.assignmentId, firstGrant.assignment.assignmentId);
});

test("feature 084 rejects non-manager, system, archived, cross-tenant, and non-member assignments", async () => {
  const context = await createFeature084Context();
  const role = await createCustomRole({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    body: {
      name: `Assignable ${randomUUID()}`,
      capabilityKeys: ["review.workspace"],
    },
  });
  const archivedRole = await createCustomRole({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    body: {
      name: `Archived ${randomUUID()}`,
      capabilityKeys: ["media_library.access"],
    },
  });
  await archiveCustomRole({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    roleId: archivedRole.id,
  });
  const foreignRole = await createCustomRole({
    supabase: context.secondOwnerClient,
    tenantId: context.secondTenantId,
    userId: context.secondOwnerUserId,
    body: {
      name: `Foreign ${randomUUID()}`,
      capabilityKeys: ["review.workspace"],
    },
  });
  const systemReviewerRoleId = await getSystemReviewerRoleId();

  await assert.rejects(
    grantCustomRoleToMember({
      supabase: context.reviewerClient,
      tenantId: context.tenantId,
      actorUserId: context.reviewerUserId,
      targetUserId: context.reviewerUserId,
      roleId: role.id,
    }),
    { code: "tenant_member_management_forbidden" },
  );

  await assert.rejects(
    grantCustomRoleToMember({
      supabase: context.ownerClient,
      tenantId: context.tenantId,
      actorUserId: context.ownerUserId,
      targetUserId: context.reviewerUserId,
      roleId: systemReviewerRoleId,
    }),
    { code: "system_role_assignment_forbidden" },
  );

  await assert.rejects(
    grantCustomRoleToMember({
      supabase: context.ownerClient,
      tenantId: context.tenantId,
      actorUserId: context.ownerUserId,
      targetUserId: context.reviewerUserId,
      roleId: archivedRole.id,
    }),
    { code: "custom_role_archived" },
  );

  await assert.rejects(
    grantCustomRoleToMember({
      supabase: context.ownerClient,
      tenantId: context.tenantId,
      actorUserId: context.ownerUserId,
      targetUserId: context.reviewerUserId,
      roleId: foreignRole.id,
    }),
    { code: "custom_role_not_found" },
  );

  await assert.rejects(
    grantCustomRoleToMember({
      supabase: context.ownerClient,
      tenantId: context.tenantId,
      actorUserId: context.ownerUserId,
      targetUserId: context.outsiderUserId,
      roleId: role.id,
    }),
    { code: "member_not_found" },
  );
});

test("feature 084 member removal cascades assignments and fixed role changes leave custom assignments intact", async () => {
  const context = await createFeature084Context();
  const role = await createCustomRole({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    body: {
      name: `Lifecycle ${randomUUID()}`,
      capabilityKeys: ["projects.create"],
    },
  });

  const reviewerGrant = await grantCustomRoleToMember({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    actorUserId: context.ownerUserId,
    targetUserId: context.reviewerUserId,
    roleId: role.id,
  });
  assert.equal(reviewerGrant.created, true);

  const { error: fixedRoleUpdateError } = await adminClient
    .from("memberships")
    .update({ role: "photographer" })
    .eq("tenant_id", context.tenantId)
    .eq("user_id", context.reviewerUserId);
  assertNoPostgrestError(fixedRoleUpdateError, "update fixed role");

  const { data: assignmentAfterRoleChange, error: roleChangeLookupError } = await adminClient
    .from("role_assignments")
    .select("id")
    .eq("id", reviewerGrant.assignment.assignmentId)
    .is("revoked_at", null)
    .maybeSingle();
  assertNoPostgrestError(roleChangeLookupError, "select assignment after fixed role change");
  assert.equal(assignmentAfterRoleChange?.id, reviewerGrant.assignment.assignmentId);

  const photographerGrant = await grantCustomRoleToMember({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    actorUserId: context.ownerUserId,
    targetUserId: context.photographerUserId,
    roleId: role.id,
  });
  assert.equal(photographerGrant.created, true);

  const { error: removeMembershipError } = await adminClient
    .from("memberships")
    .delete()
    .eq("tenant_id", context.tenantId)
    .eq("user_id", context.photographerUserId);
  assertNoPostgrestError(removeMembershipError, "remove photographer membership");

  const { data: removedAssignments, error: removedAssignmentsError } = await adminClient
    .from("role_assignments")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .eq("user_id", context.photographerUserId);
  assertNoPostgrestError(removedAssignmentsError, "select cascaded assignments");
  assert.deepEqual(removedAssignments, []);
});

test("feature 084 archived assigned roles remain visible and revokable", async () => {
  const context = await createFeature084Context();
  const role = await createCustomRole({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    body: {
      name: `Archive after assign ${randomUUID()}`,
      capabilityKeys: ["media_library.access"],
    },
  });
  await grantCustomRoleToMember({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    actorUserId: context.ownerUserId,
    targetUserId: context.reviewerUserId,
    roleId: role.id,
  });
  await archiveCustomRole({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    roleId: role.id,
  });

  const summary = await resolveCustomRoleAssignmentSummary({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
  });
  assert.equal(summary.assignableRoles.some((candidate) => candidate.roleId === role.id), false);
  const reviewerSummary = summary.members.find((member) => member.userId === context.reviewerUserId);
  assert.equal(reviewerSummary?.assignments[0]?.role.archivedAt !== null, true);

  const revokeResult = await revokeCustomRoleFromMember({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    actorUserId: context.ownerUserId,
    targetUserId: context.reviewerUserId,
    roleId: role.id,
  });
  assert.equal(revokeResult.revoked, true);
});

test("feature 084 custom role assignments enforce only shipped custom-role slices and preserve non-expansion", async () => {
  const context = await createFeature084Context();
  const broadRole = await createCustomRole({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    body: {
      name: `Broad custom role ${randomUUID()}`,
      capabilityKeys: [
        "review.workspace",
        "capture.upload_assets",
        "media_library.access",
        "organization_users.manage",
        "projects.create",
      ],
    },
  });
  const workspaceRole = await createCustomRole({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    body: {
      name: `Workspace custom role ${randomUUID()}`,
      capabilityKeys: ["project_workspaces.manage"],
    },
  });
  await grantCustomRoleToMember({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    actorUserId: context.ownerUserId,
    targetUserId: context.reviewerUserId,
    roleId: broadRole.id,
  });
  await grantCustomRoleToMember({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    actorUserId: context.ownerUserId,
    targetUserId: context.photographerUserId,
    roleId: workspaceRole.id,
  });

  assert.equal(
    await rpcBoolean(context.reviewerClient, "current_user_can_review_project_workspace", {
      p_tenant_id: context.tenantId,
      p_project_id: context.projectId,
      p_workspace_id: context.defaultWorkspaceId,
    }),
    false,
  );
  assert.equal(
    await rpcBoolean(context.reviewerClient, "current_user_can_capture_project", {
      p_tenant_id: context.tenantId,
      p_project_id: context.projectId,
    }),
    false,
  );
  assert.equal(
    await rpcBoolean(context.reviewerClient, "current_user_can_access_media_library", {
      p_tenant_id: context.tenantId,
    }),
    true,
  );
  assert.equal(
    await rpcBoolean(context.reviewerClient, "current_user_can_manage_media_library", {
      p_tenant_id: context.tenantId,
    }),
    false,
  );
  assert.equal(
    await rpcBoolean(context.reviewerClient, "current_user_can_manage_members", {
      p_tenant_id: context.tenantId,
    }),
    false,
  );
  assert.equal(
    await rpcBoolean(context.reviewerClient, "current_user_can_create_projects", {
      p_tenant_id: context.tenantId,
    }),
    true,
  );

  const reviewerPermissions = await resolveTenantPermissions(
    context.reviewerClient,
    context.tenantId,
    context.reviewerUserId,
  );
  assert.equal(reviewerPermissions.canReviewProjects, false);
  assert.equal(reviewerPermissions.canManageMembers, false);
  assert.equal(reviewerPermissions.canCreateProjects, false);

  await assertCanCreateProjectsAction(context.reviewerClient, context.tenantId, context.reviewerUserId);
  await authorizeMediaLibraryAccess({
    supabase: context.reviewerClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
  });
  await assert.rejects(
    authorizeMediaLibraryFolderManagement({
      supabase: context.reviewerClient,
      tenantId: context.tenantId,
      userId: context.reviewerUserId,
    }),
    { code: "media_library_forbidden" },
  );
  await assert.rejects(
    assertCanCaptureWorkspaceAction(
      context.reviewerClient,
      context.tenantId,
      context.reviewerUserId,
      context.projectId,
      context.defaultWorkspaceId,
    ),
  );
  await assertCanManageProjectWorkspacesAction(
    context.photographerClient,
    context.tenantId,
    context.photographerUserId,
    context.projectId,
  );

  await grantTenantWideReviewerAccess({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    actorUserId: context.ownerUserId,
    targetUserId: context.reviewerUserId,
  });
  assert.equal(
    await rpcBoolean(context.reviewerClient, "current_user_can_review_project_workspace", {
      p_tenant_id: context.tenantId,
      p_project_id: context.projectId,
      p_workspace_id: context.defaultWorkspaceId,
    }),
    true,
  );
});

test("feature 084 Members UI renders assignment labels and active assignment controls", () => {
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
      showAdvancedRoleSettings: true,
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

  assert.match(markup, /Custom roles/);
  assert.match(markup, /Client reviewer/);
  assert.match(markup, /Client reviewer is archived and no longer assignable\./);
  assert.match(markup, /Media organizer/);
  assert.match(markup, /Assign role/);
  assert.doesNotMatch(markup, /Assignment history/);
});
