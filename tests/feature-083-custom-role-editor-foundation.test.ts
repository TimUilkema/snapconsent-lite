import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { authorizeMediaLibraryAccess } from "../src/lib/project-releases/project-release-service";
import {
  archiveCustomRole,
  createCustomRole,
  listRoleEditorData,
  updateCustomRole,
} from "../src/lib/tenant/custom-role-service";
import {
  ROLE_CAPABILITIES,
  TENANT_CAPABILITIES,
  type MembershipRole,
  type TenantCapability,
} from "../src/lib/tenant/role-capabilities";
import {
  adminClient,
  assertNoPostgrestError,
  createAuthUserWithRetry,
  getDefaultProjectWorkspaceId,
  signInClient,
} from "./helpers/supabase-test-client";

type Feature083Context = {
  tenantId: string;
  secondTenantId: string;
  projectId: string;
  defaultWorkspaceId: string;
  ownerUserId: string;
  adminUserId: string;
  reviewerUserId: string;
  secondOwnerUserId: string;
  ownerClient: SupabaseClient;
  adminClient: SupabaseClient;
  reviewerClient: SupabaseClient;
  secondOwnerClient: SupabaseClient;
};

async function createFeature083Context(): Promise<Feature083Context> {
  const owner = await createAuthUserWithRetry(adminClient, "feature083-owner");
  const admin = await createAuthUserWithRetry(adminClient, "feature083-admin");
  const reviewer = await createAuthUserWithRetry(adminClient, "feature083-reviewer");
  const secondOwner = await createAuthUserWithRetry(adminClient, "feature083-second-owner");

  const ownerClient = await signInClient(owner.email, owner.password);
  const adminSignedInClient = await signInClient(admin.email, admin.password);
  const reviewerClient = await signInClient(reviewer.email, reviewer.password);
  const secondOwnerClient = await signInClient(secondOwner.email, secondOwner.password);

  const { data: tenant, error: tenantError } = await adminClient
    .from("tenants")
    .insert({ name: `Feature 083 Tenant ${randomUUID()}` })
    .select("id")
    .single();
  assertNoPostgrestError(tenantError, "insert feature 083 tenant");
  assert.ok(tenant?.id, "feature 083 tenant should exist");

  const { data: secondTenant, error: secondTenantError } = await adminClient
    .from("tenants")
    .insert({ name: `Feature 083 Second Tenant ${randomUUID()}` })
    .select("id")
    .single();
  assertNoPostgrestError(secondTenantError, "insert feature 083 second tenant");
  assert.ok(secondTenant?.id, "feature 083 second tenant should exist");

  const { error: membershipError } = await adminClient.from("memberships").insert([
    { tenant_id: tenant.id, user_id: owner.userId, role: "owner" },
    { tenant_id: tenant.id, user_id: admin.userId, role: "admin" },
    { tenant_id: tenant.id, user_id: reviewer.userId, role: "reviewer" },
    { tenant_id: secondTenant.id, user_id: secondOwner.userId, role: "owner" },
  ]);
  assertNoPostgrestError(membershipError, "insert feature 083 memberships");

  const { data: project, error: projectError } = await adminClient
    .from("projects")
    .insert({
      tenant_id: tenant.id,
      created_by: owner.userId,
      name: `Feature 083 Project ${randomUUID()}`,
      description: null,
    })
    .select("id")
    .single();
  assertNoPostgrestError(projectError, "insert feature 083 project");
  assert.ok(project?.id, "feature 083 project should exist");

  const defaultWorkspaceId = await getDefaultProjectWorkspaceId(adminClient, tenant.id, project.id);

  return {
    tenantId: tenant.id,
    secondTenantId: secondTenant.id,
    projectId: project.id,
    defaultWorkspaceId,
    ownerUserId: owner.userId,
    adminUserId: admin.userId,
    reviewerUserId: reviewer.userId,
    secondOwnerUserId: secondOwner.userId,
    ownerClient,
    adminClient: adminSignedInClient,
    reviewerClient,
    secondOwnerClient,
  };
}

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

async function rpcBoolean(client: SupabaseClient, fn: string, args: Record<string, string>) {
  const { data, error } = await client.rpc(fn, args);
  assertNoPostgrestError(error, `rpc ${fn}`);
  return data as boolean;
}

async function assignCustomRole(input: {
  tenantId: string;
  userId: string;
  roleDefinitionId: string;
  createdBy: string;
  projectId?: string | null;
}) {
  const { error } = await adminClient.from("role_assignments").insert({
    tenant_id: input.tenantId,
    user_id: input.userId,
    role_definition_id: input.roleDefinitionId,
    scope_type: input.projectId ? "project" : "tenant",
    project_id: input.projectId ?? null,
    workspace_id: null,
    created_by: input.createdBy,
  });
  assertNoPostgrestError(error, "insert custom role assignment");
}

test("feature 083 owners and admins can list system roles and tenant custom roles", async () => {
  const context = await createFeature083Context();
  const role = await createCustomRole({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    body: {
      name: "Project Lead",
      description: "Coordinates project review.",
      capabilityKeys: ["review.workspace", "workflow.finalize_project"],
    },
  });

  const ownerData = await listRoleEditorData({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
  });
  assert.deepEqual(
    new Set(ownerData.systemRoles.map((systemRole) => systemRole.systemRoleKey)),
    new Set(["owner", "admin", "reviewer", "photographer"]),
  );
  assert.equal(ownerData.systemRoles.every((systemRole) => !systemRole.canEdit), true);
  assert.ok(ownerData.customRoles.some((customRole) => customRole.id === role.id));

  const adminData = await listRoleEditorData({
    supabase: context.adminClient,
    tenantId: context.tenantId,
    userId: context.adminUserId,
  });
  assert.ok(adminData.customRoles.some((customRole) => customRole.id === role.id));
  assert.deepEqual(new Set(adminData.capabilities.map((capability) => capability.key)), new Set(TENANT_CAPABILITIES));
});

test("feature 083 create, update, and archive custom roles with full capability replacement", async () => {
  const context = await createFeature083Context();
  const created = await createCustomRole({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    body: {
      name: "Media Library Manager",
      description: "Handles release assets.",
      capabilityKeys: ["media_library.access", "media_library.manage_folders"],
    },
  });

  assert.equal(created.kind, "custom");
  assert.equal(created.slug, "media-library-manager");
  assert.equal(created.canEdit, true);
  assert.deepEqual(
    new Set(created.capabilityKeys),
    new Set<TenantCapability>(["media_library.access", "media_library.manage_folders"]),
  );

  const updated = await updateCustomRole({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    roleId: created.id,
    body: {
      name: "Project Lead",
      description: "",
      capabilityKeys: ["project_workspaces.manage", "workflow.finalize_project"],
    },
  });
  assert.equal(updated.slug, "media-library-manager");
  assert.equal(updated.name, "Project Lead");
  assert.equal(updated.description, null);
  assert.deepEqual(
    new Set(updated.capabilityKeys),
    new Set<TenantCapability>(["project_workspaces.manage", "workflow.finalize_project"]),
  );

  const archived = await archiveCustomRole({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    roleId: created.id,
  });
  assert.equal(archived.changed, true);
  assert.ok(archived.role.archivedAt);
  assert.deepEqual(
    new Set(archived.role.capabilityKeys),
    new Set<TenantCapability>(["project_workspaces.manage", "workflow.finalize_project"]),
  );

  const duplicateArchive = await archiveCustomRole({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    roleId: created.id,
  });
  assert.equal(duplicateArchive.changed, false);
});

test("feature 083 validates non-manager, capability, duplicate, archived, system, and tenant boundaries", async () => {
  const context = await createFeature083Context();
  const role = await createCustomRole({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    body: {
      name: "Client Reviewer",
      capabilityKeys: ["review.workspace"],
    },
  });

  await assert.rejects(
    createCustomRole({
      supabase: context.reviewerClient,
      tenantId: context.tenantId,
      userId: context.reviewerUserId,
      body: {
        name: "Reviewer Owned Role",
        capabilityKeys: ["profiles.view"],
      },
    }),
    { code: "tenant_member_management_forbidden" },
  );

  await assert.rejects(
    createCustomRole({
      supabase: context.ownerClient,
      tenantId: context.tenantId,
      userId: context.ownerUserId,
      body: {
        name: "Unknown Capability",
        capabilityKeys: ["not.real"],
      },
    }),
    { code: "invalid_capability_key" },
  );

  await assert.rejects(
    createCustomRole({
      supabase: context.ownerClient,
      tenantId: context.tenantId,
      userId: context.ownerUserId,
      body: {
        name: "Duplicate Capability",
        capabilityKeys: ["profiles.view", "profiles.view"],
      },
    }),
    { code: "duplicate_capability_key" },
  );

  await assert.rejects(
    createCustomRole({
      supabase: context.ownerClient,
      tenantId: context.tenantId,
      userId: context.ownerUserId,
      body: {
        name: "Empty Role",
        capabilityKeys: [],
      },
    }),
    { code: "empty_capability_set" },
  );

  await assert.rejects(
    createCustomRole({
      supabase: context.ownerClient,
      tenantId: context.tenantId,
      userId: context.ownerUserId,
      body: {
        name: " client  reviewer ",
        capabilityKeys: ["profiles.view"],
      },
    }),
    { code: "role_name_conflict" },
  );

  await assert.rejects(
    updateCustomRole({
      supabase: context.secondOwnerClient,
      tenantId: context.secondTenantId,
      userId: context.secondOwnerUserId,
      roleId: role.id,
      body: {
        name: "Cross Tenant Update",
        capabilityKeys: ["profiles.view"],
      },
    }),
    { code: "role_not_found" },
  );

  const systemReviewerRoleId = await getSystemRoleId("reviewer");
  await assert.rejects(
    updateCustomRole({
      supabase: context.ownerClient,
      tenantId: context.tenantId,
      userId: context.ownerUserId,
      roleId: systemReviewerRoleId,
      body: {
        name: "Edited Reviewer",
        capabilityKeys: ["profiles.view"],
      },
    }),
    { code: "system_role_immutable" },
  );
  await assert.rejects(
    archiveCustomRole({
      supabase: context.ownerClient,
      tenantId: context.tenantId,
      userId: context.ownerUserId,
      roleId: systemReviewerRoleId,
    }),
    { code: "system_role_immutable" },
  );

  await archiveCustomRole({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    roleId: role.id,
  });
  await assert.rejects(
    updateCustomRole({
      supabase: context.ownerClient,
      tenantId: context.tenantId,
      userId: context.ownerUserId,
      roleId: role.id,
      body: {
        name: "Archived Edit",
        capabilityKeys: ["profiles.view"],
      },
    }),
    { code: "role_archived" },
  );
});

test("feature 083 archived custom role names and slugs can be reused", async () => {
  const context = await createFeature083Context();
  const first = await createCustomRole({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    body: {
      name: "Consent Coordinator",
      capabilityKeys: ["profiles.view", "capture.create_one_off_invites"],
    },
  });

  await archiveCustomRole({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    roleId: first.id,
  });

  const replacement = await createCustomRole({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    body: {
      name: "Consent Coordinator",
      capabilityKeys: ["profiles.view"],
    },
  });

  assert.notEqual(replacement.id, first.id);
  assert.equal(replacement.slug, first.slug);
  assert.equal(replacement.name, first.name);
});

test("feature 083 custom roles affect operational review but not media library enforcement", async () => {
  const context = await createFeature083Context();
  const customRole = await createCustomRole({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    body: {
      name: "Limited Reviewer",
      capabilityKeys: ["review.workspace", "media_library.access"],
    },
  });

  await assignCustomRole({
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    roleDefinitionId: customRole.id,
    createdBy: context.ownerUserId,
    projectId: context.projectId,
  });

  assert.equal(
    await rpcBoolean(context.reviewerClient, "current_user_can_review_project_workspace", {
      p_tenant_id: context.tenantId,
      p_project_id: context.projectId,
      p_workspace_id: context.defaultWorkspaceId,
    }),
    true,
  );
  assert.equal(
    await rpcBoolean(context.reviewerClient, "current_user_can_access_media_library", {
      p_tenant_id: context.tenantId,
    }),
    false,
  );
  await assert.rejects(
    authorizeMediaLibraryAccess({
      supabase: context.reviewerClient,
      tenantId: context.tenantId,
      userId: context.reviewerUserId,
    }),
    { code: "media_library_forbidden" },
  );

  const systemReviewerRoleId = await getSystemRoleId("reviewer");
  assert.deepEqual(new Set(ROLE_CAPABILITIES.reviewer), new Set(await listSystemReviewerCapabilities(systemReviewerRoleId)));
});

async function listSystemReviewerCapabilities(roleDefinitionId: string) {
  const { data, error } = await adminClient
    .from("role_definition_capabilities")
    .select("capability_key")
    .eq("role_definition_id", roleDefinitionId);

  assertNoPostgrestError(error, "select system reviewer capabilities");
  return ((data ?? []) as { capability_key: TenantCapability }[]).map((row) => row.capability_key);
}
