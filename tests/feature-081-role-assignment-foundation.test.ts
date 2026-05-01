import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { authorizeMediaLibraryAccess } from "../src/lib/project-releases/project-release-service";
import {
  assertCanCaptureWorkspaceAction,
  assertCanReviewWorkspaceAction,
} from "../src/lib/tenant/permissions";
import {
  ROLE_CAPABILITIES,
  TENANT_CAPABILITIES,
  type MembershipRole,
} from "../src/lib/tenant/role-capabilities";
import {
  assertRoleCapabilityCatalogMatchesDatabase,
  listCapabilities,
  listRoleDefinitionsForTenant,
  listSystemRoleDefinitions,
  resolveDurableRoleAssignments,
} from "../src/lib/tenant/role-assignment-foundation";
import {
  adminClient,
  assertNoPostgrestError,
  createAuthUserWithRetry,
  createPhotographerProjectWorkspace,
  getDefaultProjectWorkspaceId,
  signInClient,
} from "./helpers/supabase-test-client";

type Feature081Context = {
  tenantId: string;
  secondTenantId: string;
  projectId: string;
  secondProjectId: string;
  defaultWorkspaceId: string;
  photographerWorkspaceId: string;
  secondProjectDefaultWorkspaceId: string;
  ownerUserId: string;
  reviewerUserId: string;
  photographerUserId: string;
  outsiderUserId: string;
  photographerClient: SupabaseClient;
};

type RoleDefinitionRow = {
  id: string;
  tenant_id: string | null;
  slug: string;
  name: string;
  is_system: boolean;
  system_role_key: MembershipRole | null;
};

async function getSystemRoleId(role: MembershipRole) {
  const { data, error } = await adminClient
    .from("role_definitions")
    .select("id")
    .eq("is_system", true)
    .eq("system_role_key", role)
    .single();

  assertNoPostgrestError(error, `select system role ${role}`);
  assert.ok(data?.id, `system role ${role} should exist`);
  return data.id as string;
}

async function createFeature081Context(): Promise<Feature081Context> {
  const owner = await createAuthUserWithRetry(adminClient, "feature081-owner");
  const admin = await createAuthUserWithRetry(adminClient, "feature081-admin");
  const reviewer = await createAuthUserWithRetry(adminClient, "feature081-reviewer");
  const photographer = await createAuthUserWithRetry(adminClient, "feature081-photographer");
  const secondOwner = await createAuthUserWithRetry(adminClient, "feature081-second-owner");
  const outsider = await createAuthUserWithRetry(adminClient, "feature081-outsider");
  const photographerClient = await signInClient(photographer.email, photographer.password);

  const { data: tenant, error: tenantError } = await adminClient
    .from("tenants")
    .insert({ name: `Feature 081 Tenant ${randomUUID()}` })
    .select("id")
    .single();
  assertNoPostgrestError(tenantError, "insert feature 081 tenant");

  const { data: secondTenant, error: secondTenantError } = await adminClient
    .from("tenants")
    .insert({ name: `Feature 081 Second Tenant ${randomUUID()}` })
    .select("id")
    .single();
  assertNoPostgrestError(secondTenantError, "insert feature 081 second tenant");

  const { error: membershipError } = await adminClient.from("memberships").insert([
    { tenant_id: tenant.id, user_id: owner.userId, role: "owner" },
    { tenant_id: tenant.id, user_id: admin.userId, role: "admin" },
    { tenant_id: tenant.id, user_id: reviewer.userId, role: "reviewer" },
    { tenant_id: tenant.id, user_id: photographer.userId, role: "photographer" },
    { tenant_id: secondTenant.id, user_id: secondOwner.userId, role: "owner" },
  ]);
  assertNoPostgrestError(membershipError, "insert feature 081 memberships");

  const { data: project, error: projectError } = await adminClient
    .from("projects")
    .insert({
      tenant_id: tenant.id,
      created_by: owner.userId,
      name: `Feature 081 Project ${randomUUID()}`,
      description: null,
    })
    .select("id")
    .single();
  assertNoPostgrestError(projectError, "insert feature 081 project");

  const { data: secondProject, error: secondProjectError } = await adminClient
    .from("projects")
    .insert({
      tenant_id: tenant.id,
      created_by: owner.userId,
      name: `Feature 081 Hidden Project ${randomUUID()}`,
      description: null,
    })
    .select("id")
    .single();
  assertNoPostgrestError(secondProjectError, "insert feature 081 hidden project");

  const defaultWorkspaceId = await getDefaultProjectWorkspaceId(
    adminClient,
    tenant.id,
    project.id,
  );
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
    name: "Feature 081 photographer workspace",
  });

  return {
    tenantId: tenant.id,
    secondTenantId: secondTenant.id,
    projectId: project.id,
    secondProjectId: secondProject.id,
    defaultWorkspaceId,
    photographerWorkspaceId,
    secondProjectDefaultWorkspaceId,
    ownerUserId: owner.userId,
    reviewerUserId: reviewer.userId,
    photographerUserId: photographer.userId,
    outsiderUserId: outsider.userId,
    photographerClient,
  };
}

async function createTenantRole(input: {
  tenantId: string;
  actorUserId: string;
  slug?: string;
  name?: string;
  archived?: boolean;
}) {
  const archivedAt = input.archived ? new Date().toISOString() : null;
  const { data, error } = await adminClient
    .from("role_definitions")
    .insert({
      tenant_id: input.tenantId,
      slug: input.slug ?? `custom-${randomUUID()}`,
      name: input.name ?? `Custom ${randomUUID()}`,
      description: null,
      is_system: false,
      system_role_key: null,
      created_by: input.actorUserId,
      updated_by: input.actorUserId,
      archived_at: archivedAt,
      archived_by: input.archived ? input.actorUserId : null,
    })
    .select("id")
    .single();

  assertNoPostgrestError(error, "insert tenant role definition");
  assert.ok(data?.id, "tenant role definition should exist");
  return data.id as string;
}

test("feature 081 seeds database capabilities and system mappings matching the TypeScript catalog", async () => {
  await assertRoleCapabilityCatalogMatchesDatabase(adminClient);

  const capabilities = await listCapabilities(adminClient);
  assert.deepEqual(new Set(capabilities), new Set(TENANT_CAPABILITIES));

  const { data: roleRows, error: roleError } = await adminClient
    .from("role_definitions")
    .select("id, tenant_id, slug, name, is_system, system_role_key")
    .eq("is_system", true);
  assertNoPostgrestError(roleError, "select system roles");

  const roles = (roleRows ?? []) as RoleDefinitionRow[];
  assert.deepEqual(
    new Set(roles.map((role) => role.system_role_key)),
    new Set(["owner", "admin", "reviewer", "photographer"]),
  );
  assert.ok(roles.every((role) => role.tenant_id === null));
  assert.ok(roles.every((role) => role.is_system));

  for (const role of Object.keys(ROLE_CAPABILITIES) as MembershipRole[]) {
    const roleDefinitionId = roles.find((row) => row.system_role_key === role)?.id;
    assert.ok(roleDefinitionId, `system role ${role} should exist`);

    const { data: mappingRows, error: mappingError } = await adminClient
      .from("role_definition_capabilities")
      .select("capability_key")
      .eq("role_definition_id", roleDefinitionId);
    assertNoPostgrestError(mappingError, `select mappings for ${role}`);

    assert.deepEqual(
      new Set(((mappingRows ?? []) as { capability_key: string }[]).map((row) => row.capability_key)),
      new Set(ROLE_CAPABILITIES[role]),
    );
  }
});

test("feature 081 role definition constraints preserve system and tenant role shapes", async () => {
  const context = await createFeature081Context();

  const { error: invalidSystemTenantError } = await adminClient.from("role_definitions").insert({
    tenant_id: context.tenantId,
    slug: `bad-system-${randomUUID()}`,
    name: "Bad System",
    is_system: true,
    system_role_key: "owner",
  });
  assert.ok(invalidSystemTenantError, "system roles cannot carry tenant ids");

  const { error: invalidSystemKeyError } = await adminClient.from("role_definitions").insert({
    slug: `bad-system-key-${randomUUID()}`,
    name: "Bad System Key",
    is_system: true,
    system_role_key: "billing",
  });
  assert.ok(invalidSystemKeyError, "system role keys are limited to fixed roles");

  const { error: missingActorError } = await adminClient.from("role_definitions").insert({
    tenant_id: context.tenantId,
    slug: `missing-actor-${randomUUID()}`,
    name: "Missing Actor",
    is_system: false,
    system_role_key: null,
  });
  assert.ok(missingActorError, "tenant roles require created_by and updated_by");

  const slug = `tenant-role-${randomUUID()}`;
  await createTenantRole({
    tenantId: context.tenantId,
    actorUserId: context.ownerUserId,
    slug,
    name: `Tenant Role ${randomUUID()}`,
  });

  const { error: duplicateSlugError } = await adminClient.from("role_definitions").insert({
    tenant_id: context.tenantId,
    slug,
    name: `Duplicate Slug ${randomUUID()}`,
    is_system: false,
    system_role_key: null,
    created_by: context.ownerUserId,
    updated_by: context.ownerUserId,
  });
  assert.ok(duplicateSlugError, "active tenant role slugs must be unique per tenant");

  await createTenantRole({
    tenantId: context.tenantId,
    actorUserId: context.ownerUserId,
    slug,
    name: `Archived Duplicate ${randomUUID()}`,
    archived: true,
  });
});

test("feature 081 role assignment constraints enforce scope, tenant, project, workspace, and membership boundaries", async () => {
  const context = await createFeature081Context();
  const reviewerRoleId = await getSystemRoleId("reviewer");

  const { error: tenantScopeProjectError } = await adminClient.from("role_assignments").insert({
    tenant_id: context.tenantId,
    user_id: context.reviewerUserId,
    role_definition_id: reviewerRoleId,
    scope_type: "tenant",
    project_id: context.projectId,
  });
  assert.ok(tenantScopeProjectError, "tenant scope cannot include project ids");

  const { error: projectMissingProjectError } = await adminClient.from("role_assignments").insert({
    tenant_id: context.tenantId,
    user_id: context.reviewerUserId,
    role_definition_id: reviewerRoleId,
    scope_type: "project",
  });
  assert.ok(projectMissingProjectError, "project scope requires project id");

  const { error: workspaceMissingWorkspaceError } = await adminClient.from("role_assignments").insert({
    tenant_id: context.tenantId,
    user_id: context.reviewerUserId,
    role_definition_id: reviewerRoleId,
    scope_type: "workspace",
    project_id: context.projectId,
  });
  assert.ok(workspaceMissingWorkspaceError, "workspace scope requires workspace id");

  const { error: workspaceWrongProjectError } = await adminClient.from("role_assignments").insert({
    tenant_id: context.tenantId,
    user_id: context.reviewerUserId,
    role_definition_id: reviewerRoleId,
    scope_type: "workspace",
    project_id: context.secondProjectId,
    workspace_id: context.photographerWorkspaceId,
  });
  assert.ok(workspaceWrongProjectError, "workspace scope cannot point to a workspace from another project");

  const { error: projectCrossTenantError } = await adminClient.from("role_assignments").insert({
    tenant_id: context.secondTenantId,
    user_id: context.reviewerUserId,
    role_definition_id: reviewerRoleId,
    scope_type: "project",
    project_id: context.projectId,
  });
  assert.ok(projectCrossTenantError, "project scope cannot cross tenant boundaries");

  const { error: missingMembershipError } = await adminClient.from("role_assignments").insert({
    tenant_id: context.tenantId,
    user_id: context.outsiderUserId,
    role_definition_id: reviewerRoleId,
    scope_type: "tenant",
  });
  assert.ok(missingMembershipError, "assignment requires tenant membership");

  const secondTenantRoleId = await createTenantRole({
    tenantId: context.secondTenantId,
    actorUserId: context.ownerUserId,
    slug: `second-tenant-role-${randomUUID()}`,
    name: `Second Tenant Role ${randomUUID()}`,
  });
  const { error: otherTenantRoleError } = await adminClient.from("role_assignments").insert({
    tenant_id: context.tenantId,
    user_id: context.reviewerUserId,
    role_definition_id: secondTenantRoleId,
    scope_type: "tenant",
  });
  assert.ok(otherTenantRoleError, "assignment cannot reference another tenant custom role");

  const archivedRoleId = await createTenantRole({
    tenantId: context.tenantId,
    actorUserId: context.ownerUserId,
    slug: `archived-role-${randomUUID()}`,
    name: `Archived Role ${randomUUID()}`,
    archived: true,
  });
  const { error: archivedRoleError } = await adminClient.from("role_assignments").insert({
    tenant_id: context.tenantId,
    user_id: context.reviewerUserId,
    role_definition_id: archivedRoleId,
    scope_type: "tenant",
  });
  assert.ok(archivedRoleError, "active assignment cannot reference archived role");
});

test("feature 081 active assignment uniqueness, revocation, durable resolution, and membership cleanup work", async () => {
  const context = await createFeature081Context();
  const reviewerRoleId = await getSystemRoleId("reviewer");

  const { data: assignment, error: assignmentError } = await adminClient
    .from("role_assignments")
    .insert({
      tenant_id: context.tenantId,
      user_id: context.reviewerUserId,
      role_definition_id: reviewerRoleId,
      scope_type: "project",
      project_id: context.projectId,
      created_by: context.ownerUserId,
    })
    .select("id")
    .single();
  assertNoPostgrestError(assignmentError, "insert project role assignment");

  const { error: duplicateActiveError } = await adminClient.from("role_assignments").insert({
    tenant_id: context.tenantId,
    user_id: context.reviewerUserId,
    role_definition_id: reviewerRoleId,
    scope_type: "project",
    project_id: context.projectId,
    created_by: context.ownerUserId,
  });
  assert.ok(duplicateActiveError, "duplicate active assignments are prevented");

  const resolvedBeforeRevoke = await resolveDurableRoleAssignments(adminClient, {
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    projectId: context.projectId,
  });
  assert.equal(resolvedBeforeRevoke.length, 1);
  assert.deepEqual(new Set(resolvedBeforeRevoke[0]!.capabilities), new Set(ROLE_CAPABILITIES.reviewer));

  const revokedAt = new Date().toISOString();
  const { error: revokeError } = await adminClient
    .from("role_assignments")
    .update({
      revoked_at: revokedAt,
      revoked_by: context.ownerUserId,
    })
    .eq("id", assignment.id);
  assertNoPostgrestError(revokeError, "revoke role assignment");

  const { error: replacementError } = await adminClient.from("role_assignments").insert({
    tenant_id: context.tenantId,
    user_id: context.reviewerUserId,
    role_definition_id: reviewerRoleId,
    scope_type: "project",
    project_id: context.projectId,
    created_by: context.ownerUserId,
  });
  assertNoPostgrestError(replacementError, "insert replacement active assignment");

  const { data: assignmentRows, error: assignmentRowsError } = await adminClient
    .from("role_assignments")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .eq("user_id", context.reviewerUserId)
    .eq("role_definition_id", reviewerRoleId)
    .eq("project_id", context.projectId);
  assertNoPostgrestError(assignmentRowsError, "select role assignments");
  assert.equal(assignmentRows?.length, 2);

  const photographerRoleId = await getSystemRoleId("photographer");
  const { data: cleanupAssignment, error: cleanupInsertError } = await adminClient
    .from("role_assignments")
    .insert({
      tenant_id: context.tenantId,
      user_id: context.photographerUserId,
      role_definition_id: photographerRoleId,
      scope_type: "workspace",
      project_id: context.projectId,
      workspace_id: context.photographerWorkspaceId,
      created_by: context.ownerUserId,
    })
    .select("id")
    .single();
  assertNoPostgrestError(cleanupInsertError, "insert cleanup role assignment");

  const { error: membershipDeleteError } = await adminClient
    .from("memberships")
    .delete()
    .eq("tenant_id", context.tenantId)
    .eq("user_id", context.photographerUserId);
  assertNoPostgrestError(membershipDeleteError, "delete photographer membership");

  const { data: cleanedRows, error: cleanedRowsError } = await adminClient
    .from("role_assignments")
    .select("id")
    .eq("id", cleanupAssignment.id);
  assertNoPostgrestError(cleanedRowsError, "select cleaned role assignment");
  assert.equal(cleanedRows?.length ?? 0, 0);
});

test("feature 081 durable assignments do not change current live access enforcement", async () => {
  const context = await createFeature081Context();
  const reviewerRoleId = await getSystemRoleId("reviewer");
  const photographerRoleId = await getSystemRoleId("photographer");

  const { error: reviewerWorkspaceAssignmentError } = await adminClient.from("role_assignments").insert({
    tenant_id: context.tenantId,
    user_id: context.photographerUserId,
    role_definition_id: reviewerRoleId,
    scope_type: "workspace",
    project_id: context.projectId,
    workspace_id: context.photographerWorkspaceId,
    created_by: context.ownerUserId,
  });
  assertNoPostgrestError(reviewerWorkspaceAssignmentError, "insert durable reviewer assignment");

  await assert.rejects(
    assertCanReviewWorkspaceAction(
      adminClient,
      context.tenantId,
      context.photographerUserId,
      context.projectId,
      context.photographerWorkspaceId,
    ),
    { code: "workspace_review_forbidden" },
  );

  const { error: photographerWorkspaceAssignmentError } = await adminClient.from("role_assignments").insert({
    tenant_id: context.tenantId,
    user_id: context.reviewerUserId,
    role_definition_id: photographerRoleId,
    scope_type: "workspace",
    project_id: context.projectId,
    workspace_id: context.defaultWorkspaceId,
    created_by: context.ownerUserId,
  });
  assertNoPostgrestError(photographerWorkspaceAssignmentError, "insert durable photographer assignment");

  await assert.rejects(
    assertCanCaptureWorkspaceAction(
      adminClient,
      context.tenantId,
      context.reviewerUserId,
      context.projectId,
      context.defaultWorkspaceId,
    ),
    { code: "workspace_not_found" },
  );

  await assert.rejects(
    authorizeMediaLibraryAccess({
      supabase: adminClient,
      tenantId: context.tenantId,
      userId: context.photographerUserId,
    }),
    { code: "media_library_forbidden" },
  );

  const { error: hiddenProjectAssignmentError } = await adminClient.from("role_assignments").insert({
    tenant_id: context.tenantId,
    user_id: context.photographerUserId,
    role_definition_id: reviewerRoleId,
    scope_type: "project",
    project_id: context.secondProjectId,
    created_by: context.ownerUserId,
  });
  assertNoPostgrestError(hiddenProjectAssignmentError, "insert hidden project durable assignment");

  const { data: visibleProjects, error: visibleProjectsError } = await context.photographerClient
    .from("projects")
    .select("id")
    .eq("id", context.secondProjectId);
  assertNoPostgrestError(visibleProjectsError, "select hidden project as photographer");
  assert.equal(visibleProjects?.length ?? 0, 0);

  const { error: hiddenWorkspaceAssignmentError } = await adminClient.from("role_assignments").insert({
    tenant_id: context.tenantId,
    user_id: context.photographerUserId,
    role_definition_id: reviewerRoleId,
    scope_type: "workspace",
    project_id: context.secondProjectId,
    workspace_id: context.secondProjectDefaultWorkspaceId,
    created_by: context.ownerUserId,
  });
  assertNoPostgrestError(hiddenWorkspaceAssignmentError, "insert hidden workspace durable assignment");

  const { data: visibleWorkspaces, error: visibleWorkspacesError } = await context.photographerClient
    .from("project_workspaces")
    .select("id")
    .eq("id", context.secondProjectDefaultWorkspaceId);
  assertNoPostgrestError(visibleWorkspacesError, "select hidden workspace as photographer");
  assert.equal(visibleWorkspaces?.length ?? 0, 0);
});

test("feature 081 read helpers return system and tenant-visible durable records without enforcing them", async () => {
  const context = await createFeature081Context();
  const customRoleId = await createTenantRole({
    tenantId: context.tenantId,
    actorUserId: context.ownerUserId,
    slug: `helper-role-${randomUUID()}`,
    name: `Helper Role ${randomUUID()}`,
  });

  const systemRoles = await listSystemRoleDefinitions(adminClient);
  assert.deepEqual(
    new Set(systemRoles.map((role) => role.systemRoleKey)),
    new Set(["owner", "admin", "reviewer", "photographer"]),
  );

  const tenantRoles = await listRoleDefinitionsForTenant(adminClient, context.tenantId);
  assert.ok(tenantRoles.some((role) => role.id === customRoleId));
  assert.ok(tenantRoles.some((role) => role.systemRoleKey === "owner"));
});
