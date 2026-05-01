import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { authorizeMediaLibraryAccess } from "../src/lib/project-releases/project-release-service";
import {
  assertCanCaptureWorkspaceAction,
  assertCanReviewWorkspaceAction,
  resolveProjectPermissions,
  resolveTenantPermissions,
} from "../src/lib/tenant/permissions";
import {
  grantProjectReviewerAccess,
  grantTenantWideReviewerAccess,
  revokeProjectReviewerAccess,
  revokeTenantWideReviewerAccess,
} from "../src/lib/tenant/reviewer-access-service";
import {
  adminClient,
  assertNoPostgrestError,
  createAuthUserWithRetry,
  createPhotographerProjectWorkspace,
  getDefaultProjectWorkspaceId,
  signInClient,
} from "./helpers/supabase-test-client";

type Feature082Context = {
  tenantId: string;
  secondTenantId: string;
  projectId: string;
  secondProjectId: string;
  foreignProjectId: string;
  defaultWorkspaceId: string;
  secondProjectDefaultWorkspaceId: string;
  photographerWorkspaceId: string;
  ownerUserId: string;
  reviewerTenantUserId: string;
  reviewerProjectUserId: string;
  reviewerEmptyUserId: string;
  photographerUserId: string;
  ownerClient: SupabaseClient;
  reviewerTenantClient: SupabaseClient;
  reviewerProjectClient: SupabaseClient;
  reviewerEmptyClient: SupabaseClient;
  photographerClient: SupabaseClient;
};

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

async function createFeature082Context(): Promise<Feature082Context> {
  const owner = await createAuthUserWithRetry(adminClient, "feature082-owner");
  const reviewerTenant = await createAuthUserWithRetry(adminClient, "feature082-reviewer-tenant");
  const reviewerProject = await createAuthUserWithRetry(adminClient, "feature082-reviewer-project");
  const reviewerEmpty = await createAuthUserWithRetry(adminClient, "feature082-reviewer-empty");
  const photographer = await createAuthUserWithRetry(adminClient, "feature082-photographer");
  const foreignOwner = await createAuthUserWithRetry(adminClient, "feature082-foreign-owner");

  const ownerClient = await signInClient(owner.email, owner.password);
  const reviewerTenantClient = await signInClient(reviewerTenant.email, reviewerTenant.password);
  const reviewerProjectClient = await signInClient(reviewerProject.email, reviewerProject.password);
  const reviewerEmptyClient = await signInClient(reviewerEmpty.email, reviewerEmpty.password);
  const photographerClient = await signInClient(photographer.email, photographer.password);

  const { data: tenant, error: tenantError } = await adminClient
    .from("tenants")
    .insert({ name: `Feature 082 Tenant ${randomUUID()}` })
    .select("id")
    .single();
  assertNoPostgrestError(tenantError, "insert feature 082 tenant");

  const { data: secondTenant, error: secondTenantError } = await adminClient
    .from("tenants")
    .insert({ name: `Feature 082 Foreign Tenant ${randomUUID()}` })
    .select("id")
    .single();
  assertNoPostgrestError(secondTenantError, "insert feature 082 foreign tenant");

  const { error: membershipError } = await adminClient.from("memberships").insert([
    { tenant_id: tenant.id, user_id: owner.userId, role: "owner" },
    { tenant_id: tenant.id, user_id: reviewerTenant.userId, role: "reviewer" },
    { tenant_id: tenant.id, user_id: reviewerProject.userId, role: "reviewer" },
    { tenant_id: tenant.id, user_id: reviewerEmpty.userId, role: "reviewer" },
    { tenant_id: tenant.id, user_id: photographer.userId, role: "photographer" },
    { tenant_id: secondTenant.id, user_id: foreignOwner.userId, role: "owner" },
  ]);
  assertNoPostgrestError(membershipError, "insert feature 082 memberships");

  const { data: project, error: projectError } = await adminClient
    .from("projects")
    .insert({
      tenant_id: tenant.id,
      created_by: owner.userId,
      name: `Feature 082 Project ${randomUUID()}`,
      description: null,
    })
    .select("id")
    .single();
  assertNoPostgrestError(projectError, "insert feature 082 project");

  const { data: secondProject, error: secondProjectError } = await adminClient
    .from("projects")
    .insert({
      tenant_id: tenant.id,
      created_by: owner.userId,
      name: `Feature 082 Other Project ${randomUUID()}`,
      description: null,
    })
    .select("id")
    .single();
  assertNoPostgrestError(secondProjectError, "insert feature 082 second project");

  const { data: foreignProject, error: foreignProjectError } = await adminClient
    .from("projects")
    .insert({
      tenant_id: secondTenant.id,
      created_by: foreignOwner.userId,
      name: `Feature 082 Foreign Project ${randomUUID()}`,
      description: null,
    })
    .select("id")
    .single();
  assertNoPostgrestError(foreignProjectError, "insert feature 082 foreign project");

  const defaultWorkspaceId = await getDefaultProjectWorkspaceId(adminClient, tenant.id, project.id);
  const secondProjectDefaultWorkspaceId = await getDefaultProjectWorkspaceId(
    adminClient,
    tenant.id,
    secondProject.id,
  );
  const photographerWorkspaceId = await createPhotographerProjectWorkspace({
    supabase: adminClient,
    tenantId: tenant.id,
    projectId: project.id,
    createdBy: owner.userId,
    photographerUserId: photographer.userId,
    name: "Feature 082 photographer workspace",
  });

  const reviewerRoleId = await getSystemReviewerRoleId();
  const { error: assignmentError } = await adminClient.from("role_assignments").insert([
    {
      tenant_id: tenant.id,
      user_id: reviewerTenant.userId,
      role_definition_id: reviewerRoleId,
      scope_type: "tenant",
      created_by: owner.userId,
    },
    {
      tenant_id: tenant.id,
      user_id: reviewerProject.userId,
      role_definition_id: reviewerRoleId,
      scope_type: "project",
      project_id: project.id,
      created_by: owner.userId,
    },
  ]);
  assertNoPostgrestError(assignmentError, "insert feature 082 reviewer assignments");

  return {
    tenantId: tenant.id,
    secondTenantId: secondTenant.id,
    projectId: project.id,
    secondProjectId: secondProject.id,
    foreignProjectId: foreignProject.id,
    defaultWorkspaceId,
    secondProjectDefaultWorkspaceId,
    photographerWorkspaceId,
    ownerUserId: owner.userId,
    reviewerTenantUserId: reviewerTenant.userId,
    reviewerProjectUserId: reviewerProject.userId,
    reviewerEmptyUserId: reviewerEmpty.userId,
    photographerUserId: photographer.userId,
    ownerClient,
    reviewerTenantClient,
    reviewerProjectClient,
    reviewerEmptyClient,
    photographerClient,
  };
}

async function rpcBoolean(client: SupabaseClient, fn: string, args: Record<string, string>) {
  const { data, error } = await client.rpc(fn, args);
  assertNoPostgrestError(error, `rpc ${fn}`);
  return data as boolean;
}

test("feature 082 SQL helpers enforce tenant-wide, project-scoped, and unassigned reviewer access", async () => {
  const context = await createFeature082Context();

  assert.equal(
    await rpcBoolean(context.reviewerTenantClient, "current_user_can_access_project", {
      p_tenant_id: context.tenantId,
      p_project_id: context.secondProjectId,
    }),
    true,
  );
  assert.equal(
    await rpcBoolean(context.reviewerTenantClient, "current_user_can_access_media_library", {
      p_tenant_id: context.tenantId,
    }),
    true,
  );

  assert.equal(
    await rpcBoolean(context.reviewerProjectClient, "current_user_can_access_project", {
      p_tenant_id: context.tenantId,
      p_project_id: context.projectId,
    }),
    true,
  );
  assert.equal(
    await rpcBoolean(context.reviewerProjectClient, "current_user_can_review_project_workspace", {
      p_tenant_id: context.tenantId,
      p_project_id: context.projectId,
      p_workspace_id: context.defaultWorkspaceId,
    }),
    true,
  );
  assert.equal(
    await rpcBoolean(context.reviewerProjectClient, "current_user_can_access_project", {
      p_tenant_id: context.tenantId,
      p_project_id: context.secondProjectId,
    }),
    false,
  );
  assert.equal(
    await rpcBoolean(context.reviewerProjectClient, "current_user_can_access_media_library", {
      p_tenant_id: context.tenantId,
    }),
    false,
  );

  assert.equal(
    await rpcBoolean(context.reviewerEmptyClient, "current_user_can_review_project", {
      p_tenant_id: context.tenantId,
      p_project_id: context.projectId,
    }),
    false,
  );
  assert.equal(
    await rpcBoolean(context.photographerClient, "current_user_can_access_project_workspace", {
      p_tenant_id: context.tenantId,
      p_project_id: context.projectId,
      p_workspace_id: context.photographerWorkspaceId,
    }),
    true,
  );
  assert.equal(
    await rpcBoolean(context.photographerClient, "current_user_can_review_project_workspace", {
      p_tenant_id: context.tenantId,
      p_project_id: context.projectId,
      p_workspace_id: context.photographerWorkspaceId,
    }),
    false,
  );
});

test("feature 082 TypeScript helpers match reviewer assignment enforcement", async () => {
  const context = await createFeature082Context();

  const tenantReviewerTenantPermissions = await resolveTenantPermissions(
    adminClient,
    context.tenantId,
    context.reviewerTenantUserId,
  );
  assert.equal(tenantReviewerTenantPermissions.isReviewerEligible, true);
  assert.equal(tenantReviewerTenantPermissions.hasTenantWideReviewAccess, true);

  const emptyReviewerPermissions = await resolveTenantPermissions(
    adminClient,
    context.tenantId,
    context.reviewerEmptyUserId,
  );
  assert.equal(emptyReviewerPermissions.isReviewerEligible, true);
  assert.equal(emptyReviewerPermissions.canReviewProjects, false);

  const projectPermissions = await resolveProjectPermissions(
    context.reviewerProjectClient,
    context.tenantId,
    context.reviewerProjectUserId,
    context.projectId,
  );
  assert.equal(projectPermissions.canReviewSelectedProject, true);
  assert.equal(projectPermissions.reviewAccessSource, "project_assignment");
  assert.equal(projectPermissions.canCaptureProjects, false);

  const unassignedProjectPermissions = await resolveProjectPermissions(
    context.reviewerProjectClient,
    context.tenantId,
    context.reviewerProjectUserId,
    context.secondProjectId,
  );
  assert.equal(unassignedProjectPermissions.canReviewSelectedProject, false);

  await assertCanReviewWorkspaceAction(
    context.reviewerProjectClient,
    context.tenantId,
    context.reviewerProjectUserId,
    context.projectId,
    context.defaultWorkspaceId,
  );
  await assert.rejects(
    assertCanReviewWorkspaceAction(
      context.reviewerProjectClient,
      context.tenantId,
      context.reviewerProjectUserId,
      context.secondProjectId,
      context.secondProjectDefaultWorkspaceId,
    ),
    { code: "workspace_not_found" },
  );
  await assert.rejects(
    assertCanCaptureWorkspaceAction(
      context.reviewerProjectClient,
      context.tenantId,
      context.reviewerProjectUserId,
      context.projectId,
      context.defaultWorkspaceId,
    ),
    { code: "workspace_capture_forbidden" },
  );

  await authorizeMediaLibraryAccess({
    supabase: context.reviewerTenantClient,
    tenantId: context.tenantId,
    userId: context.reviewerTenantUserId,
  });
  await assert.rejects(
    authorizeMediaLibraryAccess({
      supabase: context.reviewerProjectClient,
      tenantId: context.tenantId,
      userId: context.reviewerProjectUserId,
    }),
    { code: "media_library_forbidden" },
  );
});

test("feature 082 reviewer access service writes are manager-only, role-gated, idempotent, and tenant-scoped", async () => {
  const context = await createFeature082Context();

  const firstTenantGrant = await grantTenantWideReviewerAccess({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    actorUserId: context.ownerUserId,
    targetUserId: context.reviewerEmptyUserId,
  });
  assert.equal(firstTenantGrant.created, true);

  const duplicateTenantGrant = await grantTenantWideReviewerAccess({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    actorUserId: context.ownerUserId,
    targetUserId: context.reviewerEmptyUserId,
  });
  assert.equal(duplicateTenantGrant.created, false);
  assert.equal(duplicateTenantGrant.assignment.assignmentId, firstTenantGrant.assignment.assignmentId);

  const firstTenantRevoke = await revokeTenantWideReviewerAccess({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    actorUserId: context.ownerUserId,
    targetUserId: context.reviewerEmptyUserId,
  });
  assert.equal(firstTenantRevoke.revoked, true);

  const duplicateTenantRevoke = await revokeTenantWideReviewerAccess({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    actorUserId: context.ownerUserId,
    targetUserId: context.reviewerEmptyUserId,
  });
  assert.equal(duplicateTenantRevoke.revoked, false);

  const replacementTenantGrant = await grantTenantWideReviewerAccess({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    actorUserId: context.ownerUserId,
    targetUserId: context.reviewerEmptyUserId,
  });
  assert.equal(replacementTenantGrant.created, true);
  assert.notEqual(
    replacementTenantGrant.assignment.assignmentId,
    firstTenantGrant.assignment.assignmentId,
  );

  const projectGrant = await grantProjectReviewerAccess({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    actorUserId: context.ownerUserId,
    targetUserId: context.reviewerEmptyUserId,
    projectId: context.secondProjectId,
  });
  assert.equal(projectGrant.created, true);

  const projectRevoke = await revokeProjectReviewerAccess({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    actorUserId: context.ownerUserId,
    targetUserId: context.reviewerEmptyUserId,
    projectId: context.secondProjectId,
  });
  assert.equal(projectRevoke.revoked, true);

  await assert.rejects(
    grantProjectReviewerAccess({
      supabase: context.reviewerEmptyClient,
      tenantId: context.tenantId,
      actorUserId: context.reviewerEmptyUserId,
      targetUserId: context.reviewerEmptyUserId,
      projectId: context.projectId,
    }),
    { code: "tenant_member_management_forbidden" },
  );

  await assert.rejects(
    grantTenantWideReviewerAccess({
      supabase: context.ownerClient,
      tenantId: context.tenantId,
      actorUserId: context.ownerUserId,
      targetUserId: context.photographerUserId,
    }),
    { code: "reviewer_access_target_not_reviewer" },
  );

  await assert.rejects(
    grantProjectReviewerAccess({
      supabase: context.ownerClient,
      tenantId: context.tenantId,
      actorUserId: context.ownerUserId,
      targetUserId: context.reviewerEmptyUserId,
      projectId: context.foreignProjectId,
    }),
    { code: "project_not_found" },
  );
});
