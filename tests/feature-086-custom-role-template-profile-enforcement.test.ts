import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { ProtectedNavView, type ProtectedNavStrings } from "../src/components/navigation/protected-nav";
import { HttpError } from "../src/lib/http/errors";
import {
  archiveRecurringProfile,
  createRecurringProfile,
  createRecurringProfileType,
  listRecurringProfilesPageData,
} from "../src/lib/profiles/profile-directory-service";
import { resolveProfilesAccess } from "../src/lib/profiles/profile-access";
import { resolveMediaLibraryAccess } from "../src/lib/tenant/media-library-custom-role-access";
import { resolveTenantPermissions } from "../src/lib/tenant/permissions";
import {
  archiveCustomRole,
  createCustomRole,
} from "../src/lib/tenant/custom-role-service";
import {
  grantCustomRoleToMember,
  revokeCustomRoleFromMember,
} from "../src/lib/tenant/custom-role-assignment-service";
import { userHasTenantCustomRoleCapability } from "../src/lib/tenant/tenant-custom-role-capabilities";
import { createStarterStructuredFieldsDefinition } from "../src/lib/templates/structured-fields";
import {
  archiveTenantTemplate,
  createTenantTemplate,
  createTenantTemplateVersion,
  publishTenantTemplate,
  resolveTemplateManagementAccess,
  setProjectDefaultTemplate,
  updateDraftTemplate,
} from "../src/lib/templates/template-service";
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

type Feature086Context = {
  tenantId: string;
  secondTenantId: string;
  projectId: string;
  defaultWorkspaceId: string;
  owner: TestMember;
  templateUser: TestMember;
  profileViewUser: TestMember;
  profileManageUser: TestMember;
  noCapabilityUser: TestMember;
  revokedUser: TestMember;
  archivedUser: TestMember;
  scopedUser: TestMember;
  crossTenantUser: TestMember;
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

function withScopeOption(optionLabel = "Published media", optionKey = "published_media") {
  const definition = createStarterStructuredFieldsDefinition();
  return {
    ...definition,
    builtInFields: {
      ...definition.builtInFields,
      scope: {
        ...definition.builtInFields.scope,
        options: [
          {
            optionKey,
            label: optionLabel,
            orderIndex: 0,
          },
        ],
      },
    },
  };
}

async function createFeature086Context(): Promise<Feature086Context> {
  const [
    owner,
    templateUser,
    profileViewUser,
    profileManageUser,
    noCapabilityUser,
    revokedUser,
    archivedUser,
    scopedUser,
    crossTenantUser,
    secondOwner,
  ] = await Promise.all([
    createSignedMember("feature086-owner"),
    createSignedMember("feature086-template"),
    createSignedMember("feature086-profile-view"),
    createSignedMember("feature086-profile-manage"),
    createSignedMember("feature086-no-capability"),
    createSignedMember("feature086-revoked"),
    createSignedMember("feature086-archived"),
    createSignedMember("feature086-scoped"),
    createSignedMember("feature086-cross-tenant"),
    createSignedMember("feature086-second-owner"),
  ]);

  const { data: tenant, error: tenantError } = await adminClient
    .from("tenants")
    .insert({ name: `Feature 086 Tenant ${randomUUID()}` })
    .select("id")
    .single();
  assertNoPostgrestError(tenantError, "insert feature 086 tenant");
  assert.ok(tenant?.id);

  const { data: secondTenant, error: secondTenantError } = await adminClient
    .from("tenants")
    .insert({ name: `Feature 086 Second Tenant ${randomUUID()}` })
    .select("id")
    .single();
  assertNoPostgrestError(secondTenantError, "insert feature 086 second tenant");
  assert.ok(secondTenant?.id);

  const { error: membershipError } = await adminClient.from("memberships").insert([
    { tenant_id: tenant.id, user_id: owner.userId, role: "owner" },
    { tenant_id: tenant.id, user_id: templateUser.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: profileViewUser.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: profileManageUser.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: noCapabilityUser.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: revokedUser.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: archivedUser.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: scopedUser.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: crossTenantUser.userId, role: "photographer" },
    { tenant_id: secondTenant.id, user_id: secondOwner.userId, role: "owner" },
    { tenant_id: secondTenant.id, user_id: crossTenantUser.userId, role: "photographer" },
  ]);
  assertNoPostgrestError(membershipError, "insert feature 086 memberships");

  const { data: project, error: projectError } = await adminClient
    .from("projects")
    .insert({
      tenant_id: tenant.id,
      created_by: owner.userId,
      name: `Feature 086 Project ${randomUUID()}`,
      description: null,
      status: "active",
    })
    .select("id")
    .single();
  assertNoPostgrestError(projectError, "insert feature 086 project");
  assert.ok(project?.id);

  const defaultWorkspaceId = await getDefaultProjectWorkspaceId(adminClient, tenant.id, project.id);

  return {
    tenantId: tenant.id,
    secondTenantId: secondTenant.id,
    projectId: project.id,
    defaultWorkspaceId,
    owner,
    templateUser,
    profileViewUser,
    profileManageUser,
    noCapabilityUser,
    revokedUser,
    archivedUser,
    scopedUser,
    crossTenantUser,
    secondOwner,
  };
}

test("feature 086 custom roles enforce template management and preserve non-expansion", async () => {
  const context = await createFeature086Context();
  const templateRole = await createCustomRole({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    userId: context.owner.userId,
    body: {
      name: `Template manager ${randomUUID()}`,
      capabilityKeys: ["templates.manage"],
    },
  });
  const noCapabilityRole = await createCustomRole({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    userId: context.owner.userId,
    body: {
      name: `No template capability ${randomUUID()}`,
      capabilityKeys: ["review.workspace"],
    },
  });
  const archivedRole = await createCustomRole({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    userId: context.owner.userId,
    body: {
      name: `Archived template manager ${randomUUID()}`,
      capabilityKeys: ["templates.manage"],
    },
  });
  const secondTenantTemplateRole = await createCustomRole({
    supabase: context.secondOwner.client,
    tenantId: context.secondTenantId,
    userId: context.secondOwner.userId,
    body: {
      name: `Second tenant template manager ${randomUUID()}`,
      capabilityKeys: ["templates.manage"],
    },
  });

  await grantCustomRoleToMember({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.templateUser.userId,
    roleId: templateRole.id,
  });
  await grantCustomRoleToMember({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.noCapabilityUser.userId,
    roleId: noCapabilityRole.id,
  });
  await grantCustomRoleToMember({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.revokedUser.userId,
    roleId: templateRole.id,
  });
  await revokeCustomRoleFromMember({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.revokedUser.userId,
    roleId: templateRole.id,
  });
  await grantCustomRoleToMember({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.archivedUser.userId,
    roleId: archivedRole.id,
  });
  await archiveCustomRole({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    userId: context.owner.userId,
    roleId: archivedRole.id,
  });
  await grantCustomRoleToMember({
    supabase: context.secondOwner.client,
    tenantId: context.secondTenantId,
    actorUserId: context.secondOwner.userId,
    targetUserId: context.crossTenantUser.userId,
    roleId: secondTenantTemplateRole.id,
  });
  const { error: scopedAssignmentError } = await adminClient.from("role_assignments").insert([
    {
      tenant_id: context.tenantId,
      user_id: context.scopedUser.userId,
      role_definition_id: templateRole.id,
      scope_type: "project",
      project_id: context.projectId,
      workspace_id: null,
      created_by: context.owner.userId,
    },
    {
      tenant_id: context.tenantId,
      user_id: context.scopedUser.userId,
      role_definition_id: templateRole.id,
      scope_type: "workspace",
      project_id: context.projectId,
      workspace_id: context.defaultWorkspaceId,
      created_by: context.owner.userId,
    },
  ]);
  assertNoPostgrestError(scopedAssignmentError, "insert feature 086 scoped template assignments");

  assert.equal(
    (await resolveTemplateManagementAccess(context.templateUser.client, context.tenantId, context.templateUser.userId))
      .canManageTemplates,
    true,
  );
  assert.equal(
    await userHasTenantCustomRoleCapability({
      supabase: context.templateUser.client,
      tenantId: context.tenantId,
      userId: context.templateUser.userId,
      capabilityKey: "templates.manage",
    }),
    true,
  );
  for (const member of [
    context.noCapabilityUser,
    context.revokedUser,
    context.archivedUser,
    context.scopedUser,
    context.crossTenantUser,
  ]) {
    assert.equal(
      (await resolveTemplateManagementAccess(member.client, context.tenantId, member.userId)).canManageTemplates,
      false,
    );
  }

  const created = await createTenantTemplate({
    supabase: context.templateUser.client,
    tenantId: context.tenantId,
    userId: context.templateUser.userId,
    idempotencyKey: `feature086-template-${randomUUID()}`,
    name: "Feature 086 Template",
    description: null,
    body: "Feature 086 template body with enough content to satisfy validation.",
  });
  assert.equal(created.status, 201);
  const updated = await updateDraftTemplate({
    supabase: context.templateUser.client,
    tenantId: context.tenantId,
    userId: context.templateUser.userId,
    templateId: created.payload.template.id,
    name: "Feature 086 Template",
    description: null,
    body: "Feature 086 updated template body with enough content for publishing.",
    structuredFieldsDefinition: withScopeOption(),
  });
  assert.equal(updated.status, "draft");
  const published = await publishTenantTemplate({
    supabase: context.templateUser.client,
    tenantId: context.tenantId,
    userId: context.templateUser.userId,
    templateId: updated.id,
  });
  assert.equal(published.status, "published");
  await setProjectDefaultTemplate({
    supabase: context.templateUser.client,
    tenantId: context.tenantId,
    userId: context.templateUser.userId,
    projectId: context.projectId,
    templateId: published.id,
  });
  const version = await createTenantTemplateVersion({
    supabase: context.templateUser.client,
    tenantId: context.tenantId,
    userId: context.templateUser.userId,
    idempotencyKey: `feature086-template-version-${randomUUID()}`,
    templateId: published.id,
  });
  assert.equal(version.payload.template.status, "draft");
  const archived = await archiveTenantTemplate({
    supabase: context.templateUser.client,
    tenantId: context.tenantId,
    userId: context.templateUser.userId,
    templateId: published.id,
  });
  assert.equal(archived.status, "archived");

  await assert.rejects(
    createTenantTemplate({
      supabase: context.noCapabilityUser.client,
      tenantId: context.tenantId,
      userId: context.noCapabilityUser.userId,
      idempotencyKey: `feature086-denied-template-${randomUUID()}`,
      name: "Denied Template",
      description: null,
      body: "Feature 086 denied template body with enough content.",
    }),
    { code: "template_management_forbidden" },
  );

  const mediaAccess = await resolveMediaLibraryAccess({
    supabase: context.templateUser.client,
    tenantId: context.tenantId,
    userId: context.templateUser.userId,
  });
  assert.equal(mediaAccess.canAccess, false);
  assert.equal(mediaAccess.canManageFolders, false);
  const permissions = await resolveTenantPermissions(
    context.templateUser.client,
    context.tenantId,
    context.templateUser.userId,
  );
  assert.equal(permissions.canCreateProjects, false);
  assert.equal(permissions.canManageMembers, false);
  assert.equal(permissions.canReviewProjects, false);
});

test("feature 086 custom roles enforce profile view/manage with manage implying view", async () => {
  const context = await createFeature086Context();
  const profileViewRole = await createCustomRole({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    userId: context.owner.userId,
    body: {
      name: `Profile viewer ${randomUUID()}`,
      capabilityKeys: ["profiles.view"],
    },
  });
  const profileManageRole = await createCustomRole({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    userId: context.owner.userId,
    body: {
      name: `Profile manager ${randomUUID()}`,
      capabilityKeys: ["profiles.manage"],
    },
  });
  await grantCustomRoleToMember({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.profileViewUser.userId,
    roleId: profileViewRole.id,
  });
  await grantCustomRoleToMember({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.profileManageUser.userId,
    roleId: profileManageRole.id,
  });

  const createdType = await createRecurringProfileType({
    supabase: context.profileManageUser.client,
    tenantId: context.tenantId,
    userId: context.profileManageUser.userId,
    idempotencyKey: `feature086-profile-type-${randomUUID()}`,
    label: "Feature 086 Type",
  });
  assert.equal(createdType.status, 201);
  const createdProfile = await createRecurringProfile({
    supabase: context.profileManageUser.client,
    tenantId: context.tenantId,
    userId: context.profileManageUser.userId,
    idempotencyKey: `feature086-profile-${randomUUID()}`,
    fullName: "Feature 086 Person",
    email: `feature086-${randomUUID()}@example.com`,
    profileTypeId: createdType.payload.profileType.id,
  });
  assert.equal(createdProfile.status, 201);

  const manageAccess = await resolveProfilesAccess(
    context.profileManageUser.client,
    context.tenantId,
    context.profileManageUser.userId,
  );
  assert.equal(manageAccess.canManageProfiles, true);
  assert.equal(manageAccess.canViewProfiles, true);
  const viewAccess = await resolveProfilesAccess(
    context.profileViewUser.client,
    context.tenantId,
    context.profileViewUser.userId,
  );
  assert.equal(viewAccess.canViewProfiles, true);
  assert.equal(viewAccess.canManageProfiles, false);
  assert.equal(
    await userHasTenantCustomRoleCapability({
      supabase: context.profileViewUser.client,
      tenantId: context.tenantId,
      userId: context.profileViewUser.userId,
      capabilityKey: "profiles.view",
    }),
    true,
  );

  const viewOnlyPage = await listRecurringProfilesPageData({
    supabase: context.profileViewUser.client,
    tenantId: context.tenantId,
    userId: context.profileViewUser.userId,
    includeArchived: true,
  });
  assert.equal(viewOnlyPage.profiles.length, 1);
  assert.equal(viewOnlyPage.access.canManageProfiles, false);
  assert.equal(viewOnlyPage.baselineTemplates.length, 0);

  const managerPage = await listRecurringProfilesPageData({
    supabase: context.profileManageUser.client,
    tenantId: context.tenantId,
    userId: context.profileManageUser.userId,
    includeArchived: true,
  });
  assert.equal(managerPage.profiles.length, 1);
  assert.equal(managerPage.access.canManageProfiles, true);

  await assert.rejects(
    createRecurringProfile({
      supabase: context.profileViewUser.client,
      tenantId: context.tenantId,
      userId: context.profileViewUser.userId,
      idempotencyKey: `feature086-profile-view-denied-${randomUUID()}`,
      fullName: "Blocked Profile",
      email: `blocked-${randomUUID()}@example.com`,
      profileTypeId: null,
    }),
    { code: "recurring_profile_management_forbidden" },
  );
  const archived = await archiveRecurringProfile({
    supabase: context.profileManageUser.client,
    tenantId: context.tenantId,
    userId: context.profileManageUser.userId,
    profileId: createdProfile.payload.profile.id,
  });
  assert.equal(archived.status, "archived");

  const mediaAccess = await resolveMediaLibraryAccess({
    supabase: context.profileManageUser.client,
    tenantId: context.tenantId,
    userId: context.profileManageUser.userId,
  });
  assert.equal(mediaAccess.canAccess, false);
  assert.equal(mediaAccess.canManageFolders, false);
});

test("feature 086 protected nav hides and shows Templates and Profiles by surface access", () => {
  const hidden = renderToStaticMarkup(createElement(ProtectedNavView, {
    pathname: "/projects",
    strings: navStrings,
    showMediaLibrary: false,
    showMembers: false,
    showProfiles: false,
    showTemplates: false,
  }));
  assert.doesNotMatch(hidden, /Profiles/);
  assert.doesNotMatch(hidden, /Templates/);

  const visible = renderToStaticMarkup(createElement(ProtectedNavView, {
    pathname: "/profiles",
    strings: navStrings,
    showMediaLibrary: false,
    showMembers: false,
    showProfiles: true,
    showTemplates: true,
  }));
  assert.match(visible, /Profiles/);
  assert.match(visible, /Templates/);
});

test("feature 086 profile page data rejects users without tenant membership", async () => {
  const context = await createFeature086Context();
  const outsider = await createSignedMember("feature086-outsider");

  await assert.rejects(
    listRecurringProfilesPageData({
      supabase: outsider.client,
      tenantId: context.tenantId,
      userId: outsider.userId,
      includeArchived: true,
    }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 403);
      return true;
    },
  );
});
