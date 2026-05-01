import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  addMediaLibraryAssetsToFolder,
  archiveMediaLibraryFolder,
  createMediaLibraryFolder,
  listActiveMediaLibraryFolders,
  moveMediaLibraryAssetsToFolder,
  removeMediaLibraryAssetsFromFolder,
  renameMediaLibraryFolder,
} from "../src/lib/media-library/media-library-folder-service";
import { createMediaLibraryAssetDownloadResponse } from "../src/lib/project-releases/media-library-download";
import {
  ensureProjectReleaseSnapshot,
  getMediaLibraryPageData,
  getReleaseAssetDetail,
} from "../src/lib/project-releases/project-release-service";
import {
  archiveCustomRole,
  createCustomRole,
} from "../src/lib/tenant/custom-role-service";
import {
  grantCustomRoleToMember,
  revokeCustomRoleFromMember,
} from "../src/lib/tenant/custom-role-assignment-service";
import {
  authorizeMediaLibraryAccess,
  authorizeMediaLibraryFolderManagement,
  resolveMediaLibraryAccess,
} from "../src/lib/tenant/media-library-custom-role-access";
import { resolveTenantPermissions } from "../src/lib/tenant/permissions";
import {
  grantProjectReviewerAccess,
  grantTenantWideReviewerAccess,
} from "../src/lib/tenant/reviewer-access-service";
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

type Feature085Context = {
  tenantId: string;
  secondTenantId: string;
  projectId: string;
  defaultWorkspaceId: string;
  sourceAssetId: string;
  stableAssetId: string;
  releaseAssetId: string;
  owner: TestMember;
  admin: TestMember;
  tenantReviewer: TestMember;
  projectReviewer: TestMember;
  accessUser: TestMember;
  manageUser: TestMember;
  noMediaUser: TestMember;
  revokedUser: TestMember;
  archivedUser: TestMember;
  scopedUser: TestMember;
  crossTenantUser: TestMember;
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

async function rpcBoolean(client: SupabaseClient, fn: string, args: Record<string, string>) {
  const { data, error } = await client.rpc(fn, args);
  assertNoPostgrestError(error, `rpc ${fn}`);
  return data as boolean;
}

async function createProjectAsset(input: {
  tenantId: string;
  projectId: string;
  workspaceId: string;
  createdBy: string;
  originalFilename: string;
}) {
  const assetId = randomUUID();
  const { error } = await adminClient.from("assets").insert({
    id: assetId,
    tenant_id: input.tenantId,
    project_id: input.projectId,
    workspace_id: input.workspaceId,
    created_by: input.createdBy,
    storage_bucket: "project-assets",
    storage_path: `tenant/${input.tenantId}/project/${input.projectId}/asset/${assetId}/${input.originalFilename}`,
    original_filename: input.originalFilename,
    content_type: "image/jpeg",
    file_size_bytes: 2048,
    asset_type: "photo",
    status: "uploaded",
    uploaded_at: new Date().toISOString(),
  });
  assertNoPostgrestError(error, "insert feature 085 asset");
  return assetId;
}

async function finalizeProjectRecord(input: {
  tenantId: string;
  projectId: string;
  finalizedBy: string;
}) {
  const { error } = await adminClient
    .from("projects")
    .update({
      finalized_at: new Date().toISOString(),
      finalized_by: input.finalizedBy,
    })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.projectId);
  assertNoPostgrestError(error, "finalize feature 085 project directly");
}

async function createFeature085Context(): Promise<Feature085Context> {
  const [
    owner,
    admin,
    tenantReviewer,
    projectReviewer,
    accessUser,
    manageUser,
    noMediaUser,
    revokedUser,
    archivedUser,
    scopedUser,
    crossTenantUser,
    secondOwner,
  ] = await Promise.all([
    createSignedMember("feature085-owner"),
    createSignedMember("feature085-admin"),
    createSignedMember("feature085-tenant-reviewer"),
    createSignedMember("feature085-project-reviewer"),
    createSignedMember("feature085-access"),
    createSignedMember("feature085-manage"),
    createSignedMember("feature085-no-media"),
    createSignedMember("feature085-revoked"),
    createSignedMember("feature085-archived"),
    createSignedMember("feature085-scoped"),
    createSignedMember("feature085-cross-tenant"),
    createSignedMember("feature085-second-owner"),
  ]);

  const { data: tenant, error: tenantError } = await adminClient
    .from("tenants")
    .insert({ name: `Feature 085 Tenant ${randomUUID()}` })
    .select("id")
    .single();
  assertNoPostgrestError(tenantError, "insert feature 085 tenant");
  assert.ok(tenant?.id);

  const { data: secondTenant, error: secondTenantError } = await adminClient
    .from("tenants")
    .insert({ name: `Feature 085 Second Tenant ${randomUUID()}` })
    .select("id")
    .single();
  assertNoPostgrestError(secondTenantError, "insert feature 085 second tenant");
  assert.ok(secondTenant?.id);

  const { error: membershipError } = await adminClient.from("memberships").insert([
    { tenant_id: tenant.id, user_id: owner.userId, role: "owner" },
    { tenant_id: tenant.id, user_id: admin.userId, role: "admin" },
    { tenant_id: tenant.id, user_id: tenantReviewer.userId, role: "reviewer" },
    { tenant_id: tenant.id, user_id: projectReviewer.userId, role: "reviewer" },
    { tenant_id: tenant.id, user_id: accessUser.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: manageUser.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: noMediaUser.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: revokedUser.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: archivedUser.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: scopedUser.userId, role: "photographer" },
    { tenant_id: tenant.id, user_id: crossTenantUser.userId, role: "photographer" },
    { tenant_id: secondTenant.id, user_id: secondOwner.userId, role: "owner" },
    { tenant_id: secondTenant.id, user_id: crossTenantUser.userId, role: "photographer" },
  ]);
  assertNoPostgrestError(membershipError, "insert feature 085 memberships");

  const { data: project, error: projectError } = await adminClient
    .from("projects")
    .insert({
      tenant_id: tenant.id,
      created_by: owner.userId,
      name: `Feature 085 Project ${randomUUID()}`,
      description: null,
      status: "active",
    })
    .select("id")
    .single();
  assertNoPostgrestError(projectError, "insert feature 085 project");
  assert.ok(project?.id);

  const defaultWorkspaceId = await getDefaultProjectWorkspaceId(adminClient, tenant.id, project.id);
  const sourceAssetId = await createProjectAsset({
    tenantId: tenant.id,
    projectId: project.id,
    workspaceId: defaultWorkspaceId,
    createdBy: owner.userId,
    originalFilename: "feature-085-release-photo.jpg",
  });
  await finalizeProjectRecord({
    tenantId: tenant.id,
    projectId: project.id,
    finalizedBy: owner.userId,
  });
  await ensureProjectReleaseSnapshot({
    supabase: adminClient,
    tenantId: tenant.id,
    projectId: project.id,
    actorUserId: owner.userId,
  });

  const { data: mediaAsset, error: mediaAssetError } = await adminClient
    .from("media_library_assets")
    .select("id")
    .eq("tenant_id", tenant.id)
    .eq("project_id", project.id)
    .eq("source_asset_id", sourceAssetId)
    .single();
  assertNoPostgrestError(mediaAssetError, "select feature 085 stable Media Library asset");
  assert.ok(mediaAsset?.id);

  const { data: releaseAsset, error: releaseAssetError } = await adminClient
    .from("project_release_assets")
    .select("id")
    .eq("tenant_id", tenant.id)
    .eq("project_id", project.id)
    .eq("source_asset_id", sourceAssetId)
    .single();
  assertNoPostgrestError(releaseAssetError, "select feature 085 release asset");
  assert.ok(releaseAsset?.id);

  return {
    tenantId: tenant.id,
    secondTenantId: secondTenant.id,
    projectId: project.id,
    defaultWorkspaceId,
    sourceAssetId,
    stableAssetId: mediaAsset.id as string,
    releaseAssetId: releaseAsset.id as string,
    owner,
    admin,
    tenantReviewer,
    projectReviewer,
    accessUser,
    manageUser,
    noMediaUser,
    revokedUser,
    archivedUser,
    scopedUser,
    crossTenantUser,
    secondOwner,
  };
}

async function assertSqlAccess(input: {
  context: Feature085Context;
  member: TestMember;
  canAccess: boolean;
  canManage: boolean;
  tenantId?: string;
}) {
  const tenantId = input.tenantId ?? input.context.tenantId;
  assert.equal(
    await rpcBoolean(input.member.client, "current_user_can_access_media_library", {
      p_tenant_id: tenantId,
    }),
    input.canAccess,
  );
  assert.equal(
    await rpcBoolean(input.member.client, "current_user_can_manage_media_library", {
      p_tenant_id: tenantId,
    }),
    input.canManage,
  );
}

test("feature 085 Media Library SQL helpers and TypeScript authorizers enforce custom roles narrowly", async () => {
  const context = await createFeature085Context();
  const accessRole = await createCustomRole({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    userId: context.owner.userId,
    body: {
      name: `Media access ${randomUUID()}`,
      capabilityKeys: ["media_library.access"],
    },
  });
  const manageRole = await createCustomRole({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    userId: context.owner.userId,
    body: {
      name: `Media folder manager ${randomUUID()}`,
      capabilityKeys: ["media_library.manage_folders"],
    },
  });
  const noMediaRole = await createCustomRole({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    userId: context.owner.userId,
    body: {
      name: `Non media role ${randomUUID()}`,
      capabilityKeys: ["review.workspace"],
    },
  });
  const archivedAccessRole = await createCustomRole({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    userId: context.owner.userId,
    body: {
      name: `Archived media access ${randomUUID()}`,
      capabilityKeys: ["media_library.access"],
    },
  });
  const secondTenantAccessRole = await createCustomRole({
    supabase: context.secondOwner.client,
    tenantId: context.secondTenantId,
    userId: context.secondOwner.userId,
    body: {
      name: `Second tenant media access ${randomUUID()}`,
      capabilityKeys: ["media_library.access"],
    },
  });

  await grantCustomRoleToMember({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.accessUser.userId,
    roleId: accessRole.id,
  });
  await grantCustomRoleToMember({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.manageUser.userId,
    roleId: manageRole.id,
  });
  await grantCustomRoleToMember({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.noMediaUser.userId,
    roleId: noMediaRole.id,
  });
  await grantCustomRoleToMember({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.revokedUser.userId,
    roleId: accessRole.id,
  });
  await revokeCustomRoleFromMember({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.revokedUser.userId,
    roleId: accessRole.id,
  });
  await grantCustomRoleToMember({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.archivedUser.userId,
    roleId: archivedAccessRole.id,
  });
  await archiveCustomRole({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    userId: context.owner.userId,
    roleId: archivedAccessRole.id,
  });
  await grantCustomRoleToMember({
    supabase: context.secondOwner.client,
    tenantId: context.secondTenantId,
    actorUserId: context.secondOwner.userId,
    targetUserId: context.crossTenantUser.userId,
    roleId: secondTenantAccessRole.id,
  });
  const { error: scopedAssignmentError } = await adminClient.from("role_assignments").insert([
    {
      tenant_id: context.tenantId,
      user_id: context.scopedUser.userId,
      role_definition_id: accessRole.id,
      scope_type: "project",
      project_id: context.projectId,
      workspace_id: null,
      created_by: context.owner.userId,
    },
    {
      tenant_id: context.tenantId,
      user_id: context.scopedUser.userId,
      role_definition_id: manageRole.id,
      scope_type: "workspace",
      project_id: context.projectId,
      workspace_id: context.defaultWorkspaceId,
      created_by: context.owner.userId,
    },
  ]);
  assertNoPostgrestError(scopedAssignmentError, "insert feature 085 scoped custom role assignments");
  await grantTenantWideReviewerAccess({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.tenantReviewer.userId,
  });
  await grantProjectReviewerAccess({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.projectReviewer.userId,
    projectId: context.projectId,
  });

  await assertSqlAccess({ context, member: context.owner, canAccess: true, canManage: true });
  await assertSqlAccess({ context, member: context.admin, canAccess: true, canManage: true });
  await assertSqlAccess({ context, member: context.tenantReviewer, canAccess: true, canManage: true });
  await assertSqlAccess({ context, member: context.projectReviewer, canAccess: false, canManage: false });
  await assertSqlAccess({ context, member: context.accessUser, canAccess: true, canManage: false });
  await assertSqlAccess({ context, member: context.manageUser, canAccess: false, canManage: true });
  await assertSqlAccess({ context, member: context.noMediaUser, canAccess: false, canManage: false });
  await assertSqlAccess({ context, member: context.revokedUser, canAccess: false, canManage: false });
  await assertSqlAccess({ context, member: context.archivedUser, canAccess: false, canManage: false });
  await assertSqlAccess({ context, member: context.scopedUser, canAccess: false, canManage: false });
  await assertSqlAccess({ context, member: context.crossTenantUser, canAccess: false, canManage: false });
  await assertSqlAccess({
    context,
    member: context.crossTenantUser,
    tenantId: context.secondTenantId,
    canAccess: true,
    canManage: false,
  });

  const accessResolution = await resolveMediaLibraryAccess({
    supabase: context.accessUser.client,
    tenantId: context.tenantId,
    userId: context.accessUser.userId,
  });
  assert.equal(accessResolution.canAccess, true);
  assert.equal(accessResolution.canManageFolders, false);
  assert.equal(accessResolution.accessSource, "custom_role");

  const manageResolution = await resolveMediaLibraryAccess({
    supabase: context.manageUser.client,
    tenantId: context.tenantId,
    userId: context.manageUser.userId,
  });
  assert.equal(manageResolution.canAccess, false);
  assert.equal(manageResolution.canManageFolders, true);
  assert.equal(manageResolution.manageSource, "custom_role");

  await authorizeMediaLibraryAccess({
    supabase: context.accessUser.client,
    tenantId: context.tenantId,
    userId: context.accessUser.userId,
  });
  await authorizeMediaLibraryFolderManagement({
    supabase: context.manageUser.client,
    tenantId: context.tenantId,
    userId: context.manageUser.userId,
  });
  await assert.rejects(
    authorizeMediaLibraryAccess({
      supabase: context.manageUser.client,
      tenantId: context.tenantId,
      userId: context.manageUser.userId,
    }),
    { code: "media_library_forbidden" },
  );
  await assert.rejects(
    authorizeMediaLibraryFolderManagement({
      supabase: context.accessUser.client,
      tenantId: context.tenantId,
      userId: context.accessUser.userId,
    }),
    { code: "media_library_forbidden" },
  );

  const pageData = await getMediaLibraryPageData({
    supabase: context.accessUser.client,
    tenantId: context.tenantId,
    userId: context.accessUser.userId,
  });
  assert.equal(pageData.canManageFolders, false);
  assert.equal(pageData.items.length, 1);
  const detail = await getReleaseAssetDetail({
    supabase: context.accessUser.client,
    tenantId: context.tenantId,
    userId: context.accessUser.userId,
    releaseAssetId: context.releaseAssetId,
  });
  assert.equal(detail.row.id, context.releaseAssetId);
  await assert.rejects(
    createMediaLibraryAssetDownloadResponse(
      {
        authSupabase: context.accessUser.client,
        adminSupabase: adminClient,
        releaseAssetId: context.releaseAssetId,
      },
      {
        resolveTenantId: async () => context.tenantId,
        getReleaseAssetDetail,
      },
    ),
    { code: "release_asset_source_missing" },
  );

  await assert.rejects(
    getMediaLibraryPageData({
      supabase: context.manageUser.client,
      tenantId: context.tenantId,
      userId: context.manageUser.userId,
    }),
    { code: "media_library_forbidden" },
  );
  await assert.rejects(
    getReleaseAssetDetail({
      supabase: context.manageUser.client,
      tenantId: context.tenantId,
      userId: context.manageUser.userId,
      releaseAssetId: context.releaseAssetId,
    }),
    { code: "media_library_forbidden" },
  );
  await assert.rejects(
    createMediaLibraryAssetDownloadResponse(
      {
        authSupabase: context.manageUser.client,
        adminSupabase: adminClient,
        releaseAssetId: context.releaseAssetId,
      },
      {
        resolveTenantId: async () => context.tenantId,
        getReleaseAssetDetail,
      },
    ),
    { code: "media_library_forbidden" },
  );

  const permissions = await resolveTenantPermissions(
    context.accessUser.client,
    context.tenantId,
    context.accessUser.userId,
  );
  assert.equal(permissions.canReviewProjects, false);
  assert.equal(
    await rpcBoolean(context.accessUser.client, "current_user_can_capture_project", {
      p_tenant_id: context.tenantId,
      p_project_id: context.projectId,
    }),
    false,
  );
});

test("feature 085 folder management requires manage_folders and keeps access-only users read-only", async () => {
  const context = await createFeature085Context();
  const accessRole = await createCustomRole({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    userId: context.owner.userId,
    body: {
      name: `Folder access ${randomUUID()}`,
      capabilityKeys: ["media_library.access"],
    },
  });
  const manageRole = await createCustomRole({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    userId: context.owner.userId,
    body: {
      name: `Folder manager ${randomUUID()}`,
      capabilityKeys: ["media_library.manage_folders"],
    },
  });
  await grantCustomRoleToMember({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.accessUser.userId,
    roleId: accessRole.id,
  });
  await grantCustomRoleToMember({
    supabase: context.owner.client,
    tenantId: context.tenantId,
    actorUserId: context.owner.userId,
    targetUserId: context.manageUser.userId,
    roleId: manageRole.id,
  });

  const { error: directManageFolderError } = await context.manageUser.client
    .from("media_library_folders")
    .insert({
      tenant_id: context.tenantId,
      name: `Direct manager folder ${randomUUID()}`,
      created_by: context.manageUser.userId,
      updated_by: context.manageUser.userId,
    });
  assertNoPostgrestError(directManageFolderError, "insert folder through manage custom role RLS");

  const { error: accessOnlyFolderWriteError } = await context.accessUser.client
    .from("media_library_folders")
    .insert({
      tenant_id: context.tenantId,
      name: `Access-only folder ${randomUUID()}`,
      created_by: context.accessUser.userId,
      updated_by: context.accessUser.userId,
    });
  assert.ok(accessOnlyFolderWriteError, "access-only user should not write folders through RLS");

  await assert.rejects(
    createMediaLibraryFolder({
      supabase: context.accessUser.client,
      tenantId: context.tenantId,
      userId: context.accessUser.userId,
      name: "Access-only service folder",
    }),
    { code: "media_library_forbidden" },
  );
  await assert.rejects(
    listActiveMediaLibraryFolders({
      supabase: context.manageUser.client,
      tenantId: context.tenantId,
      userId: context.manageUser.userId,
    }),
    { code: "media_library_forbidden" },
  );

  const firstFolder = await createMediaLibraryFolder({
    supabase: context.manageUser.client,
    tenantId: context.tenantId,
    userId: context.manageUser.userId,
    name: "Feature 085 first folder",
  });
  const rename = await renameMediaLibraryFolder({
    supabase: context.manageUser.client,
    tenantId: context.tenantId,
    userId: context.manageUser.userId,
    folderId: firstFolder.id,
    name: "Feature 085 renamed folder",
  });
  assert.equal(rename.changed, true);
  assert.equal(rename.folder.name, "Feature 085 renamed folder");

  const addResult = await addMediaLibraryAssetsToFolder({
    supabase: context.manageUser.client,
    tenantId: context.tenantId,
    userId: context.manageUser.userId,
    folderId: firstFolder.id,
    mediaLibraryAssetIds: [context.stableAssetId],
  });
  assert.equal(addResult.changedCount, 1);

  const secondFolder = await createMediaLibraryFolder({
    supabase: context.manageUser.client,
    tenantId: context.tenantId,
    userId: context.manageUser.userId,
    name: "Feature 085 second folder",
  });
  const moveResult = await moveMediaLibraryAssetsToFolder({
    supabase: context.manageUser.client,
    tenantId: context.tenantId,
    userId: context.manageUser.userId,
    folderId: secondFolder.id,
    mediaLibraryAssetIds: [context.stableAssetId],
  });
  assert.equal(moveResult.changedCount, 1);

  const removeResult = await removeMediaLibraryAssetsFromFolder({
    supabase: context.manageUser.client,
    tenantId: context.tenantId,
    userId: context.manageUser.userId,
    folderId: secondFolder.id,
    mediaLibraryAssetIds: [context.stableAssetId],
  });
  assert.equal(removeResult.changedCount, 1);

  const archived = await archiveMediaLibraryFolder({
    supabase: context.manageUser.client,
    tenantId: context.tenantId,
    userId: context.manageUser.userId,
    folderId: firstFolder.id,
  });
  assert.equal(archived.changed, true);
  assert.ok(archived.folder.archivedAt);
});
