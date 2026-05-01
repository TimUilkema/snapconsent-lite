import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { ProtectedNavView, type ProtectedNavStrings } from "../src/components/navigation/protected-nav";
import { HttpError } from "../src/lib/http/errors";
import {
  listAssignablePhotographersForProjectAdministration,
  listProjectAdministrationProjects,
  listProjectAdministrationWorkspaces,
  resolveProjectAdministrationAccess,
} from "../src/lib/projects/project-administration-service";
import {
  assertCanCaptureWorkspaceAction,
  assertCanCreateProjectsAction,
  assertCanManageProjectWorkspacesAction,
  assertCanReviewProjectAction,
  resolveTenantPermissions,
} from "../src/lib/tenant/permissions";
import {
  archiveCustomRole,
  createCustomRole,
} from "../src/lib/tenant/custom-role-service";
import {
  grantCustomRoleToMember,
  revokeCustomRoleFromMember,
} from "../src/lib/tenant/custom-role-assignment-service";
import { authorizeMediaLibraryAccess } from "../src/lib/tenant/media-library-custom-role-access";
import { resolveTemplateManagementAccess } from "../src/lib/templates/template-service";
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

type Feature087Context = {
  tenantId: string;
  secondTenantId: string;
  projectId: string;
  defaultWorkspaceId: string;
  owner: TestMember;
  admin: TestMember;
  creator: TestMember;
  workspaceManager: TestMember;
  noCapability: TestMember;
  revoked: TestMember;
  archived: TestMember;
  scoped: TestMember;
  crossTenant: TestMember;
  photographer: TestMember;
  reviewer: TestMember;
  secondOwner: TestMember;
};

const navStrings: ProtectedNavStrings = {
  ariaPrimary: "Primary",
  dashboard: "Dashboard",
  projects: "Projects",
  mediaLibrary: "Media Library",
  members: "Members",
  profiles: "Profiles",
  templates: "Templates",
};

async function createSignedMember(label: string): Promise<TestMember> {
  const user = await createAuthUserWithRetry(adminClient, label);
  const client = await signInClient(user.email, user.password);
  return {
    ...user,
    client,
  };
}

async function rpcBoolean(client: SupabaseClient, fn: string, args: Record<string, string>) {
  const { data, error } = await client.rpc(fn, args);
  assertNoPostgrestError(error, `rpc ${fn}`);
  return data as boolean;
}

async function createFeature087Context(): Promise<Feature087Context> {
  const [
    owner,
    admin,
    creator,
    workspaceManager,
    noCapability,
    revoked,
    archived,
    scoped,
    crossTenant,
    photographer,
    reviewer,
    secondOwner,
  ] = await Promise.all([
    createSignedMember("feature087-owner"),
    createSignedMember("feature087-admin"),
    createSignedMember("feature087-creator"),
    createSignedMember("feature087-workspace-manager"),
    createSignedMember("feature087-no-capability"),
    createSignedMember("feature087-revoked"),
    createSignedMember("feature087-archived"),
    createSignedMember("feature087-scoped"),
    createSignedMember("feature087-cross-tenant"),
    createSignedMember("feature087-photographer"),
    createSignedMember("feature087-reviewer"),
    createSignedMember("feature087-second-owner"),
  ]);

  const { data: tenant, error: tenantError } = await adminClient
    .from("tenants")
    .insert({ name: `Feature 087 Tenant ${randomUUID()}` })
    .select("id")
    .single();
  assertNoPostgrestError(tenantError, "insert feature 087 tenant");
  assert.ok(tenant?.id);

  const { data: secondTenant, error: secondTenantError } = await adminClient
    .from("tenants")
    .insert({ name: `Feature 087 Second Tenant ${randomUUID()}` })
    .select("id")
    .single();
  assertNoPostgrestError(secondTenantError, "insert feature 087 second tenant");
  assert.ok(secondTenant?.id);

  const { error: membershipError } = await adminClient.from("memberships").insert([
    { tenant_id: tenant.id, user_id: owner.userId, role: "owner" },
    { tenant_id: tenant.id, user_id: admin.userId, role: "admin" },
    { tenant_id: tenant.id, user_id: creator.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: workspaceManager.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: noCapability.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: revoked.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: archived.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: scoped.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: crossTenant.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: photographer.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: reviewer.userId, role: "reviewer" },
    { tenant_id: secondTenant.id, user_id: secondOwner.userId, role: "owner" },
    { tenant_id: secondTenant.id, user_id: crossTenant.userId, role: "photographer" },
  ]);
  assertNoPostgrestError(membershipError, "insert feature 087 memberships");

  const { data: project, error: projectError } = await adminClient
    .from("projects")
    .insert({
      tenant_id: tenant.id,
      created_by: owner.userId,
      name: `Feature 087 Project ${randomUUID()}`,
      description: null,
      status: "active",
    })
    .select("id")
    .single();
  assertNoPostgrestError(projectError, "insert feature 087 project");
  assert.ok(project?.id);

  const defaultWorkspaceId = await getDefaultProjectWorkspaceId(adminClient, tenant.id, project.id);

  return {
    tenantId: tenant.id,
    secondTenantId: secondTenant.id,
    projectId: project.id,
    defaultWorkspaceId,
    owner,
    admin,
    creator,
    workspaceManager,
    noCapability,
    revoked,
    archived,
    scoped,
    crossTenant,
    photographer,
    reviewer,
    secondOwner,
  };
}

async function createAndGrantRole(input: {
  context: Feature087Context;
  target: TestMember;
  capabilityKeys: string[];
}) {
  const role = await createCustomRole({
    supabase: input.context.owner.client,
    tenantId: input.context.tenantId,
    userId: input.context.owner.userId,
    body: {
      name: `Feature 087 role ${randomUUID()}`,
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
  context: Feature087Context;
  target: TestMember;
  capabilityKey: "projects.create" | "project_workspaces.manage";
  scopeType: "project" | "workspace";
}) {
  const role = await createCustomRole({
    supabase: input.context.owner.client,
    tenantId: input.context.tenantId,
    userId: input.context.owner.userId,
    body: {
      name: `Feature 087 scoped ${randomUUID()}`,
      capabilityKeys: [input.capabilityKey],
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
  assertNoPostgrestError(error, "insert feature 087 scoped role assignment");

  return role;
}

async function assertProjectInsertDenied(input: {
  client: SupabaseClient;
  tenantId: string;
  userId: string;
}) {
  const { data, error } = await input.client
    .from("projects")
    .insert({
      tenant_id: input.tenantId,
      created_by: input.userId,
      name: `Denied Project ${randomUUID()}`,
      description: null,
    })
    .select("id");

  assert.ok(error || !data?.length, "project insert should be denied by RLS");
}

async function assertProjectWorkspaceInsertDenied(input: {
  client: SupabaseClient;
  tenantId: string;
  projectId: string;
  userId: string;
  photographerUserId: string;
}) {
  const { data, error } = await input.client
    .from("project_workspaces")
    .insert({
      tenant_id: input.tenantId,
      project_id: input.projectId,
      workspace_kind: "photographer",
      photographer_user_id: input.photographerUserId,
      name: `Denied Workspace ${randomUUID()}`,
      created_by: input.userId,
    })
    .select("id");

  assert.ok(error || !data?.length, "project workspace insert should be denied by RLS");
}

function isWorkspaceManageDenied(error: unknown) {
  return (
    error instanceof HttpError
    && (
      error.code === "project_workspace_manage_forbidden"
      || error.code === "project_not_found"
    )
  );
}

test("feature 087 enforces projects.create for active tenant-scoped custom roles only", async () => {
  const context = await createFeature087Context();
  await createAndGrantRole({
    context,
    target: context.creator,
    capabilityKeys: ["projects.create"],
  });
  await createAndGrantRole({
    context,
    target: context.noCapability,
    capabilityKeys: ["media_library.access"],
  });

  await assertCanCreateProjectsAction(context.owner.client, context.tenantId, context.owner.userId);
  await assertCanCreateProjectsAction(context.admin.client, context.tenantId, context.admin.userId);
  await assertCanCreateProjectsAction(context.creator.client, context.tenantId, context.creator.userId);
  await assert.rejects(
    assertCanCreateProjectsAction(context.noCapability.client, context.tenantId, context.noCapability.userId),
    { code: "project_create_forbidden" },
  );

  assert.equal(
    await rpcBoolean(context.creator.client, "current_user_can_create_projects", {
      p_tenant_id: context.tenantId,
    }),
    true,
  );
  assert.equal(
    await rpcBoolean(context.noCapability.client, "current_user_can_create_projects", {
      p_tenant_id: context.tenantId,
    }),
    false,
  );

  const { data: createdProject, error: createProjectError } = await context.creator.client
    .from("projects")
    .insert({
      tenant_id: context.tenantId,
      created_by: context.creator.userId,
      name: `Custom Creator Project ${randomUUID()}`,
      description: null,
    })
    .select("id, created_by")
    .single();
  assertNoPostgrestError(createProjectError, "custom projects.create RLS insert");
  assert.equal(createdProject?.created_by, context.creator.userId);

  await assertProjectInsertDenied({
    client: context.noCapability.client,
    tenantId: context.tenantId,
    userId: context.noCapability.userId,
  });

  const access = await resolveProjectAdministrationAccess({
    supabase: context.creator.client,
    tenantId: context.tenantId,
    userId: context.creator.userId,
    projectCreatedByUserId: context.creator.userId,
  });
  assert.equal(access.canCreateProjects, true);
  assert.equal(access.canManageProjectWorkspaces, false);
  assert.equal(access.canViewProjectAdministration, true);

  const projectList = await listProjectAdministrationProjects({
    supabase: context.creator.client,
    tenantId: context.tenantId,
    userId: context.creator.userId,
  });
  assert.ok(projectList.projects.some((project) => project.id === createdProject?.id));
  assert.ok(!projectList.projects.some((project) => project.id === context.projectId));

  const fixedPermissions = await resolveTenantPermissions(
    context.creator.client,
    context.tenantId,
    context.creator.userId,
  );
  assert.equal(fixedPermissions.canCreateProjects, false, "tenant permissions remain fixed-role derived");

  await assert.rejects(
    assertCanManageProjectWorkspacesAction(
      context.creator.client,
      context.tenantId,
      context.creator.userId,
      context.projectId,
    ),
    isWorkspaceManageDenied,
  );
  await assert.rejects(
    assertCanCaptureWorkspaceAction(
      context.creator.client,
      context.tenantId,
      context.creator.userId,
      context.projectId,
      context.defaultWorkspaceId,
    ),
  );
  await assert.rejects(
    assertCanReviewProjectAction(
      context.creator.client,
      context.tenantId,
      context.creator.userId,
      context.projectId,
    ),
    { code: "project_review_forbidden" },
  );
  await assert.rejects(
    authorizeMediaLibraryAccess({
      supabase: context.creator.client,
      tenantId: context.tenantId,
      userId: context.creator.userId,
    }),
    { code: "media_library_forbidden" },
  );

  const templateAccess = await resolveTemplateManagementAccess(
    context.creator.client,
    context.tenantId,
    context.creator.userId,
  );
  assert.equal(templateAccess.canManageTemplates, false);
});

test("feature 087 enforces project_workspaces.manage without granting operational or reviewer-access rights", async () => {
  const context = await createFeature087Context();
  await createAndGrantRole({
    context,
    target: context.workspaceManager,
    capabilityKeys: ["project_workspaces.manage"],
  });

  await assertCanManageProjectWorkspacesAction(
    context.workspaceManager.client,
    context.tenantId,
    context.workspaceManager.userId,
    context.projectId,
  );
  assert.equal(
    await rpcBoolean(context.workspaceManager.client, "current_user_can_view_project_administration", {
      p_tenant_id: context.tenantId,
      p_project_id: context.projectId,
    }),
    true,
  );

  const workspaces = await listProjectAdministrationWorkspaces({
    supabase: context.workspaceManager.client,
    tenantId: context.tenantId,
    userId: context.workspaceManager.userId,
    projectId: context.projectId,
  });
  assert.ok(workspaces.some((workspace) => workspace.id === context.defaultWorkspaceId));

  const assignablePhotographers = await listAssignablePhotographersForProjectAdministration({
    supabase: context.workspaceManager.client,
    tenantId: context.tenantId,
    userId: context.workspaceManager.userId,
    projectId: context.projectId,
    adminSupabase: adminClient,
  });
  assert.ok(assignablePhotographers.some((member) => member.userId === context.photographer.userId));

  const { data: workspace, error: workspaceError } = await context.workspaceManager.client
    .from("project_workspaces")
    .insert({
      tenant_id: context.tenantId,
      project_id: context.projectId,
      workspace_kind: "photographer",
      photographer_user_id: context.photographer.userId,
      name: `Managed Workspace ${randomUUID()}`,
      created_by: context.workspaceManager.userId,
    })
    .select("id")
    .single();
  assertNoPostgrestError(workspaceError, "custom workspace manager RLS insert");
  assert.ok(workspace?.id);

  await assert.rejects(
    assertCanCreateProjectsAction(
      context.workspaceManager.client,
      context.tenantId,
      context.workspaceManager.userId,
    ),
    { code: "project_create_forbidden" },
  );
  await assertProjectWorkspaceInsertDenied({
    client: context.noCapability.client,
    tenantId: context.tenantId,
    projectId: context.projectId,
    userId: context.noCapability.userId,
    photographerUserId: context.photographer.userId,
  });

  assert.equal(
    await rpcBoolean(context.workspaceManager.client, "current_user_can_access_project", {
      p_tenant_id: context.tenantId,
      p_project_id: context.projectId,
    }),
    false,
    "project-administration read does not broaden operational project access helper",
  );
  assert.equal(
    await rpcBoolean(context.workspaceManager.client, "current_user_can_access_project_workspace", {
      p_tenant_id: context.tenantId,
      p_project_id: context.projectId,
      p_workspace_id: context.defaultWorkspaceId,
    }),
    false,
    "project-administration read does not broaden operational workspace access helper",
  );
  assert.equal(
    await rpcBoolean(context.workspaceManager.client, "current_user_can_capture_project", {
      p_tenant_id: context.tenantId,
      p_project_id: context.projectId,
    }),
    false,
  );
  assert.equal(
    await rpcBoolean(context.workspaceManager.client, "current_user_can_review_project", {
      p_tenant_id: context.tenantId,
      p_project_id: context.projectId,
    }),
    false,
  );
  assert.equal(
    await rpcBoolean(context.workspaceManager.client, "current_user_can_manage_members", {
      p_tenant_id: context.tenantId,
    }),
    false,
  );
  await assert.rejects(
    authorizeMediaLibraryAccess({
      supabase: context.workspaceManager.client,
      tenantId: context.tenantId,
      userId: context.workspaceManager.userId,
    }),
    { code: "media_library_forbidden" },
  );
});

test("feature 087 denies revoked archived cross-tenant project-scoped and workspace-scoped assignments", async () => {
  const context = await createFeature087Context();
  const revokedCreateRole = await createAndGrantRole({
    context,
    target: context.revoked,
    capabilityKeys: ["projects.create"],
  });
  await createAndGrantRole({
    context,
    target: context.archived,
    capabilityKeys: ["project_workspaces.manage"],
  }).then((role) =>
    archiveCustomRole({
      supabase: context.owner.client,
      tenantId: context.tenantId,
      userId: context.owner.userId,
      roleId: role.id,
    }),
  );
  await revokeCustomRoleFromMember({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.revoked.userId,
    roleId: revokedCreateRole.id,
  });
  await createScopedAssignment({
    context,
    target: context.scoped,
    capabilityKey: "projects.create",
    scopeType: "project",
  });
  await createScopedAssignment({
    context,
    target: context.scoped,
    capabilityKey: "project_workspaces.manage",
    scopeType: "workspace",
  });

  const crossTenantRole = await createCustomRole({
    supabase: context.secondOwner.client,
    tenantId: context.secondTenantId,
    userId: context.secondOwner.userId,
    body: {
      name: `Feature 087 cross tenant ${randomUUID()}`,
      capabilityKeys: ["projects.create", "project_workspaces.manage"],
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
    assert.equal(
      await rpcBoolean(member.client, "current_user_can_create_projects", {
        p_tenant_id: context.tenantId,
      }),
      false,
      `${member.email} should not create projects`,
    );
    assert.equal(
      await rpcBoolean(member.client, "current_user_can_view_project_administration", {
        p_tenant_id: context.tenantId,
        p_project_id: context.projectId,
      }),
      false,
      `${member.email} should not manage project workspaces`,
    );
    await assert.rejects(
      assertCanCreateProjectsAction(member.client, context.tenantId, member.userId),
      { code: "project_create_forbidden" },
    );
    await assert.rejects(
      assertCanManageProjectWorkspacesAction(
        member.client,
        context.tenantId,
        member.userId,
        context.projectId,
      ),
      isWorkspaceManageDenied,
    );
    await assertProjectInsertDenied({
      client: member.client,
      tenantId: context.tenantId,
      userId: member.userId,
    });
    await assertProjectWorkspaceInsertDenied({
      client: member.client,
      tenantId: context.tenantId,
      projectId: context.projectId,
      userId: member.userId,
      photographerUserId: context.photographer.userId,
    });
  }
});

test("feature 087 project-administration UI gates do not expose Members navigation", () => {
  const html = renderToStaticMarkup(
    createElement(ProtectedNavView, {
      pathname: "/projects",
      strings: navStrings,
      showMembers: false,
      showMediaLibrary: false,
      showProfiles: false,
      showTemplates: false,
    }),
  );

  assert.match(html, /Projects/);
  assert.doesNotMatch(html, /Members/);
  assert.doesNotMatch(html, /Media Library/);
  assert.doesNotMatch(html, /Templates/);
  assert.doesNotMatch(html, /Profiles/);
});
