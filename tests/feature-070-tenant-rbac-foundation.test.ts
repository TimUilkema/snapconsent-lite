import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  deriveProjectPermissionsFromRole,
  deriveTenantPermissionsFromRole,
} from "../src/lib/tenant/permissions";
import {
  acceptTenantMembershipInvite,
  createOrRefreshTenantMembershipInvite,
  getPublicTenantMembershipInvite,
  revokeTenantMembershipInvite,
} from "../src/lib/tenant/membership-invites";
import {
  getTenantMemberManagementData,
  removeTenantMember,
  updateTenantMemberRole,
} from "../src/lib/tenant/member-management-service";
import {
  adminClient,
  assertNoPostgrestError,
  createAnonClient,
  createAuthUserWithRetry,
  signInClient,
} from "./helpers/supabase-test-client";

type TenantRoleContext = {
  tenantId: string;
  projectId: string;
  ownerUserId: string;
  adminUserId: string;
  reviewerUserId: string;
  photographerUserId: string;
  ownerClient: SupabaseClient;
  adminUserClient: SupabaseClient;
  reviewerClient: SupabaseClient;
  photographerClient: SupabaseClient;
};

type MembershipInviteContext = {
  tenantId: string;
  adminUserClient: SupabaseClient;
  adminEmail: string;
};

type MemberManagementContext = {
  tenantId: string;
  adminUserClient: SupabaseClient;
  reviewerClient: SupabaseClient;
  photographerUserId: string;
};

async function createTenantRoleContext(supabase: SupabaseClient): Promise<TenantRoleContext> {
  const owner = await createAuthUserWithRetry(supabase, "feature070-owner");
  const admin = await createAuthUserWithRetry(supabase, "feature070-admin");
  const reviewer = await createAuthUserWithRetry(supabase, "feature070-reviewer");
  const photographer = await createAuthUserWithRetry(supabase, "feature070-photographer");

  const ownerClient = await signInClient(owner.email, owner.password);
  const adminUserClient = await signInClient(admin.email, admin.password);
  const reviewerClient = await signInClient(reviewer.email, reviewer.password);
  const photographerClient = await signInClient(photographer.email, photographer.password);

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert({
      name: `Feature 070 Tenant ${randomUUID()}`,
    })
    .select("id")
    .single();
  assertNoPostgrestError(tenantError, "insert tenant");

  const { error: membershipError } = await supabase.from("memberships").insert([
    {
      tenant_id: tenant.id,
      user_id: owner.userId,
      role: "owner",
    },
    {
      tenant_id: tenant.id,
      user_id: admin.userId,
      role: "admin",
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
  assertNoPostgrestError(membershipError, "insert memberships");

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({
      tenant_id: tenant.id,
      created_by: owner.userId,
      name: `Feature 070 Project ${randomUUID()}`,
      description: null,
    })
    .select("id")
    .single();
  assertNoPostgrestError(projectError, "insert project");

  return {
    tenantId: tenant.id,
    projectId: project.id,
    ownerUserId: owner.userId,
    adminUserId: admin.userId,
    reviewerUserId: reviewer.userId,
    photographerUserId: photographer.userId,
    ownerClient,
    adminUserClient,
    reviewerClient,
    photographerClient,
  };
}

async function createMembershipInviteContext(supabase: SupabaseClient): Promise<MembershipInviteContext> {
  const owner = await createAuthUserWithRetry(supabase, "feature070-invite-owner");
  const admin = await createAuthUserWithRetry(supabase, "feature070-invite-admin");
  const adminUserClient = await signInClient(admin.email, admin.password);

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert({
      name: `Feature 070 Invite Tenant ${randomUUID()}`,
    })
    .select("id")
    .single();
  assertNoPostgrestError(tenantError, "insert tenant");

  const { error: membershipError } = await supabase.from("memberships").insert([
    {
      tenant_id: tenant.id,
      user_id: owner.userId,
      role: "owner",
    },
    {
      tenant_id: tenant.id,
      user_id: admin.userId,
      role: "admin",
    },
  ]);
  assertNoPostgrestError(membershipError, "insert memberships");

  return {
    tenantId: tenant.id,
    adminUserClient,
    adminEmail: admin.email,
  };
}

async function createMemberManagementContext(supabase: SupabaseClient): Promise<MemberManagementContext> {
  const owner = await createAuthUserWithRetry(supabase, "feature070-members-owner");
  const admin = await createAuthUserWithRetry(supabase, "feature070-members-admin");
  const reviewer = await createAuthUserWithRetry(supabase, "feature070-members-reviewer");
  const photographer = await createAuthUserWithRetry(supabase, "feature070-members-photographer");
  const adminUserClient = await signInClient(admin.email, admin.password);
  const reviewerClient = await signInClient(reviewer.email, reviewer.password);

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert({
      name: `Feature 070 Members Tenant ${randomUUID()}`,
    })
    .select("id")
    .single();
  assertNoPostgrestError(tenantError, "insert tenant");

  const { error: membershipError } = await supabase.from("memberships").insert([
    {
      tenant_id: tenant.id,
      user_id: owner.userId,
      role: "owner",
    },
    {
      tenant_id: tenant.id,
      user_id: admin.userId,
      role: "admin",
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
  assertNoPostgrestError(membershipError, "insert memberships");

  return {
    tenantId: tenant.id,
    adminUserClient,
    reviewerClient,
    photographerUserId: photographer.userId,
  };
}

test("tenant permission mapping distinguishes manager, capture, and review roles", () => {
  assert.deepEqual(deriveTenantPermissionsFromRole("owner"), {
    role: "owner",
    canManageMembers: true,
    canManageTemplates: true,
    canManageProfiles: true,
    canCreateProjects: true,
    canCaptureProjects: true,
    canReviewProjects: true,
    isReviewerEligible: false,
    hasTenantWideReviewAccess: false,
  });

  assert.deepEqual(deriveTenantPermissionsFromRole("reviewer"), {
    role: "reviewer",
    canManageMembers: false,
    canManageTemplates: false,
    canManageProfiles: false,
    canCreateProjects: false,
    canCaptureProjects: false,
    canReviewProjects: true,
    isReviewerEligible: true,
    hasTenantWideReviewAccess: false,
  });

  assert.deepEqual(deriveProjectPermissionsFromRole("photographer"), {
    role: "photographer",
    canManageMembers: false,
    canManageTemplates: false,
    canManageProfiles: false,
    canCreateProjects: false,
    canCaptureProjects: true,
    canReviewProjects: false,
    isReviewerEligible: false,
    hasTenantWideReviewAccess: false,
    canCreateOneOffInvites: true,
    canCreateRecurringProjectConsentRequests: true,
    canUploadAssets: true,
    canInitiateConsentUpgradeRequests: false,
    canReviewSelectedProject: false,
    reviewAccessSource: "none",
  });
});

test("reviewer role is accepted in memberships and SQL permission helpers expose assignment-gated boundaries", async () => {
  const context = await createTenantRoleContext(adminClient);

  const { data: ownerCanCreate } = await context.ownerClient.rpc("current_user_can_create_projects", {
    p_tenant_id: context.tenantId,
  });
  assert.equal(ownerCanCreate, true);

  const { data: adminCanManage } = await context.adminUserClient.rpc("current_user_can_manage_members", {
    p_tenant_id: context.tenantId,
  });
  assert.equal(adminCanManage, true);

  const { data: reviewerRole } = await context.reviewerClient.rpc("current_user_membership_role", {
    p_tenant_id: context.tenantId,
  });
  assert.equal(reviewerRole, "reviewer");

  const { data: reviewerCanCreate } = await context.reviewerClient.rpc("current_user_can_create_projects", {
    p_tenant_id: context.tenantId,
  });
  assert.equal(reviewerCanCreate, false);

  const { data: reviewerCanReview } = await context.reviewerClient.rpc("current_user_can_review_project", {
    p_tenant_id: context.tenantId,
    p_project_id: context.projectId,
  });
  assert.equal(reviewerCanReview, false);

  const { data: reviewerCanCapture } = await context.reviewerClient.rpc("current_user_can_capture_project", {
    p_tenant_id: context.tenantId,
    p_project_id: context.projectId,
  });
  assert.equal(reviewerCanCapture, false);

  const { data: photographerCanCreate } = await context.photographerClient.rpc("current_user_can_create_projects", {
    p_tenant_id: context.tenantId,
  });
  assert.equal(photographerCanCreate, false);

  const { data: photographerCanCapture } = await context.photographerClient.rpc("current_user_can_capture_project", {
    p_tenant_id: context.tenantId,
    p_project_id: context.projectId,
  });
  assert.equal(photographerCanCapture, false);

  const { data: photographerCanReview } = await context.photographerClient.rpc("current_user_can_review_project", {
    p_tenant_id: context.tenantId,
    p_project_id: context.projectId,
  });
  assert.equal(photographerCanReview, false);
});

test("owner and admin authenticated clients can create projects and manage workspaces while reviewer and photographer remain blocked", async () => {
  const context = await createTenantRoleContext(adminClient);

  const { data: ownerProject, error: ownerProjectError } = await context.ownerClient
    .from("projects")
    .insert({
      tenant_id: context.tenantId,
      created_by: context.ownerUserId,
      name: `Feature 070 Owner Project ${randomUUID()}`,
      description: null,
    })
    .select("id")
    .single();
  assertNoPostgrestError(ownerProjectError, "owner inserts project through authenticated client");
  assert.ok(ownerProject?.id);

  const { data: ownerDefaultWorkspace, error: ownerDefaultWorkspaceError } = await adminClient
    .from("project_workspaces")
    .select("id, workspace_kind")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", ownerProject.id)
    .eq("workspace_kind", "default")
    .maybeSingle();
  assertNoPostgrestError(
    ownerDefaultWorkspaceError,
    "default workspace exists after owner project creation",
  );
  assert.equal(ownerDefaultWorkspace?.workspace_kind, "default");

  const { data: adminProject, error: adminProjectError } = await context.adminUserClient
    .from("projects")
    .insert({
      tenant_id: context.tenantId,
      created_by: context.adminUserId,
      name: `Feature 070 Admin Project ${randomUUID()}`,
      description: null,
    })
    .select("id")
    .single();
  assertNoPostgrestError(adminProjectError, "admin inserts project through authenticated client");
  assert.ok(adminProject?.id);

  const { data: staffedWorkspace, error: staffedWorkspaceError } = await context.ownerClient
    .from("project_workspaces")
    .insert({
      tenant_id: context.tenantId,
      project_id: context.projectId,
      workspace_kind: "photographer",
      photographer_user_id: context.photographerUserId,
      name: "Feature 070 Photographer Workspace",
      created_by: context.ownerUserId,
    })
    .select("id, workspace_kind, photographer_user_id")
    .single();
  assertNoPostgrestError(
    staffedWorkspaceError,
    "owner inserts photographer workspace through authenticated client",
  );
  assert.equal(staffedWorkspace?.workspace_kind, "photographer");
  assert.equal(staffedWorkspace?.photographer_user_id, context.photographerUserId);

  const { data: photographerCanCaptureAssigned } = await context.photographerClient.rpc(
    "current_user_can_capture_project",
    {
      p_tenant_id: context.tenantId,
      p_project_id: context.projectId,
    },
  );
  assert.equal(photographerCanCaptureAssigned, true);

  const { error: reviewerProjectError } = await context.reviewerClient
    .from("projects")
    .insert({
      tenant_id: context.tenantId,
      created_by: context.reviewerUserId,
      name: `Feature 070 Reviewer Project ${randomUUID()}`,
      description: null,
    })
    .select("id")
    .single();
  assert.ok(reviewerProjectError);
  assert.equal(reviewerProjectError.code, "42501");

  const { error: photographerProjectError } = await context.photographerClient
    .from("projects")
    .insert({
      tenant_id: context.tenantId,
      created_by: context.photographerUserId,
      name: `Feature 070 Photographer Project ${randomUUID()}`,
      description: null,
    })
    .select("id")
    .single();
  assert.ok(photographerProjectError);
  assert.equal(photographerProjectError.code, "42501");

  const { error: reviewerWorkspaceError } = await context.reviewerClient
    .from("project_workspaces")
    .insert({
      tenant_id: context.tenantId,
      project_id: context.projectId,
      workspace_kind: "photographer",
      photographer_user_id: context.reviewerUserId,
      name: "Feature 070 Reviewer Workspace",
      created_by: context.reviewerUserId,
    })
    .select("id")
    .single();
  assert.ok(reviewerWorkspaceError);
  assert.equal(reviewerWorkspaceError.code, "42501");
});

test("membership invite create-or-refresh reuses the pending row and acceptance reuses an existing account by email", async () => {
  const context = await createMembershipInviteContext(adminClient);
  const existingInvitee = await createAuthUserWithRetry(adminClient, "feature070-existing-invitee");
  const existingInviteeClient = await signInClient(existingInvitee.email, existingInvitee.password);

  const firstInvite = await createOrRefreshTenantMembershipInvite(context.adminUserClient, {
    tenantId: context.tenantId,
    email: existingInvitee.email,
    role: "reviewer",
  });

  assert.equal(firstInvite.outcome, "invited");
  assert.notEqual(firstInvite.inviteId, null);
  assert.notEqual(firstInvite.inviteToken, null);

  const publicInvite = await getPublicTenantMembershipInvite(createAnonClient(), firstInvite.inviteToken!);
  assert.equal(publicInvite?.tenantId, context.tenantId);
  assert.equal(publicInvite?.role, "reviewer");
  assert.equal(publicInvite?.canAccept, true);

  const refreshedInvite = await createOrRefreshTenantMembershipInvite(context.adminUserClient, {
    tenantId: context.tenantId,
    email: existingInvitee.email,
    role: "photographer",
  });

  assert.equal(refreshedInvite.outcome, "invited");
  assert.equal(refreshedInvite.inviteId, firstInvite.inviteId);
  assert.equal(refreshedInvite.role, "photographer");
  assert.notEqual(refreshedInvite.inviteToken, firstInvite.inviteToken);

  const accepted = await acceptTenantMembershipInvite(existingInviteeClient, refreshedInvite.inviteToken!);
  assert.equal(accepted.outcome, "accepted");
  assert.equal(accepted.role, "photographer");

  const repeatedAccept = await acceptTenantMembershipInvite(existingInviteeClient, refreshedInvite.inviteToken!);
  assert.equal(repeatedAccept.outcome, "already_member");

  const { data: membership, error: membershipError } = await adminClient
    .from("memberships")
    .select("role")
    .eq("tenant_id", context.tenantId)
    .eq("user_id", existingInvitee.userId)
    .single();
  assertNoPostgrestError(membershipError, "select accepted membership");
  assert.equal(membership.role, "photographer");

  const alreadyMemberResult = await createOrRefreshTenantMembershipInvite(context.adminUserClient, {
    tenantId: context.tenantId,
    email: existingInvitee.email,
    role: "reviewer",
  });
  assert.equal(alreadyMemberResult.outcome, "already_member");
  assert.equal(alreadyMemberResult.inviteId, null);
});

test("membership invite acceptance rejects wrong-email users and revoked invites", async () => {
  const context = await createMembershipInviteContext(adminClient);
  const invitedUser = await createAuthUserWithRetry(adminClient, "feature070-invite-target");
  const wrongUser = await createAuthUserWithRetry(adminClient, "feature070-invite-wrong-user");
  const invitedUserClient = await signInClient(invitedUser.email, invitedUser.password);
  const wrongUserClient = await signInClient(wrongUser.email, wrongUser.password);

  const pendingInvite = await createOrRefreshTenantMembershipInvite(context.adminUserClient, {
    tenantId: context.tenantId,
    email: invitedUser.email,
    role: "reviewer",
  });

  await assert.rejects(
    () => acceptTenantMembershipInvite(wrongUserClient, pendingInvite.inviteToken!),
    (error: unknown) => error instanceof Error && "code" in error && (error as { code?: string }).code === "invite_email_mismatch",
  );

  const revokedInvite = await createOrRefreshTenantMembershipInvite(context.adminUserClient, {
    tenantId: context.tenantId,
    email: invitedUser.email,
    role: "reviewer",
  });
  assert.equal(revokedInvite.inviteId, pendingInvite.inviteId);

  const revokeResult = await revokeTenantMembershipInvite(context.adminUserClient, revokedInvite.inviteId!);
  assert.equal(revokeResult.outcome, "revoked");
  assert.equal(revokeResult.status, "revoked");

  await assert.rejects(
    () => acceptTenantMembershipInvite(invitedUserClient, revokedInvite.inviteToken!),
    (error: unknown) => error instanceof Error && "code" in error && (error as { code?: string }).code === "tenant_membership_invite_revoked",
  );
});

test("member management data lists members and pending invites for admins only", async () => {
  const context = await createMemberManagementContext(adminClient);
  const adminUserId = (await context.adminUserClient.auth.getUser()).data.user!.id;
  const reviewerUserId = (await context.reviewerClient.auth.getUser()).data.user!.id;
  const pendingInvite = await createOrRefreshTenantMembershipInvite(context.adminUserClient, {
    tenantId: context.tenantId,
    email: `feature070-pending-${randomUUID()}@example.com`,
    role: "reviewer",
  });

  const adminData = await getTenantMemberManagementData({
    supabase: context.adminUserClient,
    tenantId: context.tenantId,
    userId: adminUserId,
  });

  assert.equal(adminData.members.length, 4);
  assert.equal(adminData.pendingInvites.length, 1);
  assert.equal(adminData.pendingInvites[0]?.inviteId, pendingInvite.inviteId);
  assert.equal(adminData.members[0]?.role, "owner");

  await assert.rejects(
    () =>
      getTenantMemberManagementData({
        supabase: context.reviewerClient,
        tenantId: context.tenantId,
        userId: reviewerUserId,
      }),
    (error: unknown) =>
      error instanceof Error && "code" in error && (error as { code?: string }).code === "tenant_member_management_forbidden",
  );
});

test("admins can update and remove non-owner memberships through the member management service", async () => {
  const context = await createMemberManagementContext(adminClient);
  const adminUserId = (await context.adminUserClient.auth.getUser()).data.user!.id;

  const updatedMember = await updateTenantMemberRole({
    supabase: context.adminUserClient,
    tenantId: context.tenantId,
    userId: adminUserId,
    targetUserId: context.photographerUserId,
    role: "reviewer",
  });
  assert.equal(updatedMember.role, "reviewer");

  const { data: reviewerMembership, error: reviewerMembershipError } = await adminClient
    .from("memberships")
    .select("role")
    .eq("tenant_id", context.tenantId)
    .eq("user_id", context.photographerUserId)
    .single();
  assertNoPostgrestError(reviewerMembershipError, "select updated membership");
  assert.equal(reviewerMembership.role, "reviewer");

  await removeTenantMember({
    supabase: context.adminUserClient,
    tenantId: context.tenantId,
    userId: adminUserId,
    targetUserId: context.photographerUserId,
  });

  const { data: removedMembership, error: removedMembershipError } = await adminClient
    .from("memberships")
    .select("user_id")
    .eq("tenant_id", context.tenantId)
    .eq("user_id", context.photographerUserId)
    .maybeSingle();
  assertNoPostgrestError(removedMembershipError, "select removed membership");
  assert.equal(removedMembership, null);
});
