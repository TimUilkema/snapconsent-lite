import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { HttpError } from "../src/lib/http/errors";
import {
  archiveMediaLibraryFolder,
  createMediaLibraryFolder,
  getActiveMediaLibraryFolder,
  moveMediaLibraryAssetsToFolder,
  addMediaLibraryAssetsToFolder,
  removeMediaLibraryAssetsFromFolder,
  renameMediaLibraryFolder,
} from "../src/lib/media-library/media-library-folder-service";
import {
  ensureProjectReleaseSnapshot,
  getMediaLibraryPageData,
  getReleaseAssetDetail,
} from "../src/lib/project-releases/project-release-service";
import {
  adminClient,
  assertNoPostgrestError,
  createAuthUserWithRetry,
  createReviewerRoleAssignment,
  getDefaultProjectWorkspaceId,
  signInClient,
} from "./helpers/supabase-test-client";

type Feature078Context = {
  tenantId: string;
  secondTenantId: string;
  projectId: string;
  secondProjectId: string;
  defaultWorkspaceId: string;
  secondDefaultWorkspaceId: string;
  ownerUserId: string;
  adminUserId: string;
  reviewerUserId: string;
  photographerUserId: string;
  ownerClient: Awaited<ReturnType<typeof signInClient>>;
  adminRoleClient: Awaited<ReturnType<typeof signInClient>>;
  reviewerClient: Awaited<ReturnType<typeof signInClient>>;
  photographerClient: Awaited<ReturnType<typeof signInClient>>;
};

async function createFeature078Context(): Promise<Feature078Context> {
  const owner = await createAuthUserWithRetry(adminClient, "feature078-owner");
  const adminRole = await createAuthUserWithRetry(adminClient, "feature078-admin");
  const reviewer = await createAuthUserWithRetry(adminClient, "feature078-reviewer");
  const photographer = await createAuthUserWithRetry(adminClient, "feature078-photographer");
  const ownerClient = await signInClient(owner.email, owner.password);
  const adminRoleClient = await signInClient(adminRole.email, adminRole.password);
  const reviewerClient = await signInClient(reviewer.email, reviewer.password);
  const photographerClient = await signInClient(photographer.email, photographer.password);

  const { data: tenant, error: tenantError } = await adminClient
    .from("tenants")
    .insert({ name: `Feature 078 Tenant ${randomUUID()}` })
    .select("id")
    .single();
  assertNoPostgrestError(tenantError, "insert feature 078 tenant");
  assert.ok(tenant);

  const { data: secondTenant, error: secondTenantError } = await adminClient
    .from("tenants")
    .insert({ name: `Feature 078 Tenant B ${randomUUID()}` })
    .select("id")
    .single();
  assertNoPostgrestError(secondTenantError, "insert feature 078 second tenant");
  assert.ok(secondTenant);

  const { error: membershipError } = await adminClient.from("memberships").insert([
    {
      tenant_id: tenant.id,
      user_id: owner.userId,
      role: "owner",
    },
    {
      tenant_id: tenant.id,
      user_id: adminRole.userId,
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
    {
      tenant_id: secondTenant.id,
      user_id: owner.userId,
      role: "owner",
    },
    {
      tenant_id: secondTenant.id,
      user_id: reviewer.userId,
      role: "reviewer",
    },
  ]);
  assertNoPostgrestError(membershipError, "insert feature 078 memberships");

  const { data: project, error: projectError } = await adminClient
    .from("projects")
    .insert({
      tenant_id: tenant.id,
      created_by: owner.userId,
      name: "Feature 078 Project",
      description: "Feature 078 project",
      status: "active",
    })
    .select("id")
    .single();
  assertNoPostgrestError(projectError, "insert feature 078 project");
  assert.ok(project);

  const { data: secondProject, error: secondProjectError } = await adminClient
    .from("projects")
    .insert({
      tenant_id: secondTenant.id,
      created_by: owner.userId,
      name: "Feature 078 Project B",
      description: "Feature 078 project B",
      status: "active",
    })
    .select("id")
    .single();
  assertNoPostgrestError(secondProjectError, "insert feature 078 second project");
  assert.ok(secondProject);

  const defaultWorkspaceId = await getDefaultProjectWorkspaceId(adminClient, tenant.id, project.id);
  const secondDefaultWorkspaceId = await getDefaultProjectWorkspaceId(adminClient, secondTenant.id, secondProject.id);
  await createReviewerRoleAssignment({
    tenantId: tenant.id,
    userId: reviewer.userId,
    createdBy: owner.userId,
  });
  await createReviewerRoleAssignment({
    tenantId: secondTenant.id,
    userId: reviewer.userId,
    createdBy: owner.userId,
  });

  return {
    tenantId: tenant.id,
    secondTenantId: secondTenant.id,
    projectId: project.id,
    secondProjectId: secondProject.id,
    defaultWorkspaceId,
    secondDefaultWorkspaceId,
    ownerUserId: owner.userId,
    adminUserId: adminRole.userId,
    reviewerUserId: reviewer.userId,
    photographerUserId: photographer.userId,
    ownerClient,
    adminRoleClient,
    reviewerClient,
    photographerClient,
  };
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
  assertNoPostgrestError(error, "insert feature 078 asset");
  return assetId;
}

async function finalizeProjectRecord(input: {
  tenantId: string;
  projectId: string;
  finalizedBy: string;
}) {
  const finalizedAt = new Date().toISOString();
  const { error } = await adminClient
    .from("projects")
    .update({
      finalized_at: finalizedAt,
      finalized_by: input.finalizedBy,
    })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.projectId);
  assertNoPostgrestError(error, "finalize feature 078 project directly");
  return finalizedAt;
}

async function getStableMediaLibraryAssetId(input: {
  tenantId: string;
  projectId: string;
  sourceAssetId: string;
}) {
  const { data, error } = await adminClient
    .from("media_library_assets")
    .select("id")
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("source_asset_id", input.sourceAssetId)
    .maybeSingle();
  assertNoPostgrestError(error, "select feature 078 media_library_assets row");
  assert.ok(data?.id);
  return data.id as string;
}

test("feature 078 release publication creates stable Media Library asset identities and folder RLS allows owner admin reviewer while denying photographers", async () => {
  const context = await createFeature078Context();
  const sourceAssetId = await createProjectAsset({
    tenantId: context.tenantId,
    projectId: context.projectId,
    workspaceId: context.defaultWorkspaceId,
    createdBy: context.ownerUserId,
    originalFilename: "release-photo.jpg",
  });
  await finalizeProjectRecord({
    tenantId: context.tenantId,
    projectId: context.projectId,
    finalizedBy: context.reviewerUserId,
  });

  await ensureProjectReleaseSnapshot({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    actorUserId: context.reviewerUserId,
  });

  const stableAssetId = await getStableMediaLibraryAssetId({
    tenantId: context.tenantId,
    projectId: context.projectId,
    sourceAssetId,
  });
  assert.ok(stableAssetId);

  for (const [client, userId, name] of [
    [context.ownerClient, context.ownerUserId, "Owner folder"],
    [context.adminRoleClient, context.adminUserId, "Admin folder"],
    [context.reviewerClient, context.reviewerUserId, "Reviewer folder"],
  ] as const) {
    const { data, error } = await client
      .from("media_library_folders")
      .insert({
        tenant_id: context.tenantId,
        name,
        created_by: userId,
        updated_by: userId,
      })
      .select("id")
      .single();
    assertNoPostgrestError(error, `insert feature 078 folder via ${name}`);
    assert.ok(data?.id);
  }

  const { error: photographerFolderError } = await context.photographerClient
    .from("media_library_folders")
    .insert({
      tenant_id: context.tenantId,
      name: "Photographer folder",
      created_by: context.photographerUserId,
      updated_by: context.photographerUserId,
    });
  assert.ok(photographerFolderError);

  const { error: reviewerAssetWriteError } = await context.reviewerClient
    .from("media_library_assets")
    .insert({
      tenant_id: context.tenantId,
      project_id: context.projectId,
      source_asset_id: sourceAssetId,
      created_by: context.reviewerUserId,
    });
  assert.ok(reviewerAssetWriteError);
});

test("feature 078 folder services support create rename archive add move remove and idempotent retries without mutating release rows", async () => {
  const context = await createFeature078Context();
  const sourceAssetId = await createProjectAsset({
    tenantId: context.tenantId,
    projectId: context.projectId,
    workspaceId: context.defaultWorkspaceId,
    createdBy: context.ownerUserId,
    originalFilename: "service-photo.jpg",
  });
  await finalizeProjectRecord({
    tenantId: context.tenantId,
    projectId: context.projectId,
    finalizedBy: context.reviewerUserId,
  });
  const release = await ensureProjectReleaseSnapshot({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    actorUserId: context.reviewerUserId,
  });
  assert.equal(release.releaseVersion, 1);

  const stableAssetId = await getStableMediaLibraryAssetId({
    tenantId: context.tenantId,
    projectId: context.projectId,
    sourceAssetId,
  });
  const { data: releaseAssetRowsBefore, error: releaseAssetRowsBeforeError } = await adminClient
    .from("project_release_assets")
    .select("id, release_id, source_asset_id")
    .eq("tenant_id", context.tenantId)
    .eq("release_id", release.id);
  assertNoPostgrestError(releaseAssetRowsBeforeError, "select feature 078 release assets before folder ops");

  const firstFolder = await createMediaLibraryFolder({
    supabase: context.reviewerClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    name: "Website picks",
  });
  const renameNoop = await renameMediaLibraryFolder({
    supabase: context.reviewerClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    folderId: firstFolder.id,
    name: " website picks ",
  });
  assert.equal(renameNoop.changed, false);

  const rename = await renameMediaLibraryFolder({
    supabase: context.reviewerClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    folderId: firstFolder.id,
    name: "Homepage picks",
  });
  assert.equal(rename.changed, true);
  assert.equal(rename.folder.name, "Homepage picks");

  const addResult = await addMediaLibraryAssetsToFolder({
    supabase: context.reviewerClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    folderId: firstFolder.id,
    mediaLibraryAssetIds: [stableAssetId],
  });
  assert.equal(addResult.changedCount, 1);
  assert.equal(addResult.noopCount, 0);

  const duplicateAdd = await addMediaLibraryAssetsToFolder({
    supabase: context.reviewerClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    folderId: firstFolder.id,
    mediaLibraryAssetIds: [stableAssetId],
  });
  assert.equal(duplicateAdd.changedCount, 0);
  assert.equal(duplicateAdd.noopCount, 1);

  const secondFolder = await createMediaLibraryFolder({
    supabase: context.reviewerClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    name: "Social picks",
  });

  await assert.rejects(
    addMediaLibraryAssetsToFolder({
      supabase: context.reviewerClient,
      tenantId: context.tenantId,
      userId: context.reviewerUserId,
      folderId: secondFolder.id,
      mediaLibraryAssetIds: [stableAssetId],
    }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 409);
      assert.equal(error.code, "media_library_asset_already_assigned");
      return true;
    },
  );

  const moveResult = await moveMediaLibraryAssetsToFolder({
    supabase: context.reviewerClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    folderId: secondFolder.id,
    mediaLibraryAssetIds: [stableAssetId],
  });
  assert.equal(moveResult.changedCount, 1);
  assert.equal(moveResult.noopCount, 0);

  const repeatedMove = await moveMediaLibraryAssetsToFolder({
    supabase: context.reviewerClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    folderId: secondFolder.id,
    mediaLibraryAssetIds: [stableAssetId],
  });
  assert.equal(repeatedMove.changedCount, 0);
  assert.equal(repeatedMove.noopCount, 1);

  const removeResult = await removeMediaLibraryAssetsFromFolder({
    supabase: context.reviewerClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    folderId: secondFolder.id,
    mediaLibraryAssetIds: [stableAssetId],
  });
  assert.equal(removeResult.changedCount, 1);
  assert.equal(removeResult.noopCount, 0);

  const repeatedRemove = await removeMediaLibraryAssetsFromFolder({
    supabase: context.reviewerClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    folderId: secondFolder.id,
    mediaLibraryAssetIds: [stableAssetId],
  });
  assert.equal(repeatedRemove.changedCount, 0);
  assert.equal(repeatedRemove.noopCount, 1);

  const archived = await archiveMediaLibraryFolder({
    supabase: context.reviewerClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    folderId: firstFolder.id,
  });
  assert.equal(archived.changed, true);
  assert.ok(archived.folder.archivedAt);

  const pageDataAfterArchive = await getMediaLibraryPageData({
    supabase: context.reviewerClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
  });
  assert.ok(!pageDataAfterArchive.folders.some((folder) => folder.id === firstFolder.id));

  const { data: releaseAssetRowsAfter, error: releaseAssetRowsAfterError } = await adminClient
    .from("project_release_assets")
    .select("id, release_id, source_asset_id")
    .eq("tenant_id", context.tenantId)
    .eq("release_id", release.id);
  assertNoPostgrestError(releaseAssetRowsAfterError, "select feature 078 release assets after folder ops");
  assert.deepEqual(releaseAssetRowsAfter, releaseAssetRowsBefore);
});

test("feature 078 folder membership carries forward to the latest release version while historical release detail remains available", async () => {
  const context = await createFeature078Context();
  const sourceAssetId = await createProjectAsset({
    tenantId: context.tenantId,
    projectId: context.projectId,
    workspaceId: context.defaultWorkspaceId,
    createdBy: context.ownerUserId,
    originalFilename: "carry-forward-photo.jpg",
  });

  await finalizeProjectRecord({
    tenantId: context.tenantId,
    projectId: context.projectId,
    finalizedBy: context.reviewerUserId,
  });
  const firstRelease = await ensureProjectReleaseSnapshot({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    actorUserId: context.reviewerUserId,
  });
  const { data: firstReleaseAssets, error: firstReleaseAssetsError } = await adminClient
    .from("project_release_assets")
    .select("id, source_asset_id")
    .eq("tenant_id", context.tenantId)
    .eq("release_id", firstRelease.id);
  assertNoPostgrestError(firstReleaseAssetsError, "select feature 078 first release assets");
  assert.equal(firstReleaseAssets?.length, 1);
  const firstReleaseAssetId = firstReleaseAssets?.[0]?.id ?? "";

  const stableAssetId = await getStableMediaLibraryAssetId({
    tenantId: context.tenantId,
    projectId: context.projectId,
    sourceAssetId,
  });
  const folder = await createMediaLibraryFolder({
    supabase: context.reviewerClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    name: "Website picks",
  });
  await addMediaLibraryAssetsToFolder({
    supabase: context.reviewerClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    folderId: folder.id,
    mediaLibraryAssetIds: [stableAssetId],
  });

  await finalizeProjectRecord({
    tenantId: context.tenantId,
    projectId: context.projectId,
    finalizedBy: context.reviewerUserId,
  });
  const secondRelease = await ensureProjectReleaseSnapshot({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    actorUserId: context.reviewerUserId,
  });
  assert.equal(secondRelease.releaseVersion, 2);

  const { data: stableAssets, error: stableAssetsError } = await adminClient
    .from("media_library_assets")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("source_asset_id", sourceAssetId);
  assertNoPostgrestError(stableAssetsError, "select feature 078 stable assets after v2");
  assert.equal(stableAssets?.length, 1);
  assert.equal(stableAssets?.[0]?.id, stableAssetId);

  const folderPageData = await getMediaLibraryPageData({
    supabase: context.reviewerClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    folderId: folder.id,
  });
  assert.equal(folderPageData.items.length, 1);
  assert.equal(folderPageData.items[0]?.mediaLibraryAssetId, stableAssetId);
  assert.equal(folderPageData.items[0]?.row.release_id, secondRelease.id);
  assert.equal(folderPageData.items[0]?.releaseVersion, 2);

  const historicalDetail = await getReleaseAssetDetail({
    supabase: context.reviewerClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    releaseAssetId: firstReleaseAssetId,
  });
  assert.equal(historicalDetail.releaseVersion, 1);
  assert.equal(historicalDetail.row.release_id, firstRelease.id);
});

test("feature 078 Media Library page data stays tenant scoped and archived folders disappear from navigation", async () => {
  const context = await createFeature078Context();
  const tenantOneAssetId = await createProjectAsset({
    tenantId: context.tenantId,
    projectId: context.projectId,
    workspaceId: context.defaultWorkspaceId,
    createdBy: context.ownerUserId,
    originalFilename: "tenant-one.jpg",
  });
  const tenantTwoAssetId = await createProjectAsset({
    tenantId: context.secondTenantId,
    projectId: context.secondProjectId,
    workspaceId: context.secondDefaultWorkspaceId,
    createdBy: context.ownerUserId,
    originalFilename: "tenant-two.jpg",
  });

  await finalizeProjectRecord({
    tenantId: context.tenantId,
    projectId: context.projectId,
    finalizedBy: context.reviewerUserId,
  });
  await finalizeProjectRecord({
    tenantId: context.secondTenantId,
    projectId: context.secondProjectId,
    finalizedBy: context.ownerUserId,
  });

  await ensureProjectReleaseSnapshot({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    actorUserId: context.reviewerUserId,
  });
  await ensureProjectReleaseSnapshot({
    supabase: adminClient,
    tenantId: context.secondTenantId,
    projectId: context.secondProjectId,
    actorUserId: context.ownerUserId,
  });

  const tenantOneStableAssetId = await getStableMediaLibraryAssetId({
    tenantId: context.tenantId,
    projectId: context.projectId,
    sourceAssetId: tenantOneAssetId,
  });
  await getStableMediaLibraryAssetId({
    tenantId: context.secondTenantId,
    projectId: context.secondProjectId,
    sourceAssetId: tenantTwoAssetId,
  });

  const tenantOneFolder = await createMediaLibraryFolder({
    supabase: context.reviewerClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    name: "Tenant one folder",
  });
  const tenantTwoFolder = await createMediaLibraryFolder({
    supabase: context.reviewerClient,
    tenantId: context.secondTenantId,
    userId: context.reviewerUserId,
    name: "Tenant two folder",
  });
  await addMediaLibraryAssetsToFolder({
    supabase: context.reviewerClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    folderId: tenantOneFolder.id,
    mediaLibraryAssetIds: [tenantOneStableAssetId],
  });

  const tenantOnePageData = await getMediaLibraryPageData({
    supabase: context.reviewerClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
  });
  const tenantTwoPageData = await getMediaLibraryPageData({
    supabase: context.reviewerClient,
    tenantId: context.secondTenantId,
    userId: context.reviewerUserId,
  });

  assert.ok(tenantOnePageData.folders.some((folder) => folder.id === tenantOneFolder.id));
  assert.ok(!tenantOnePageData.folders.some((folder) => folder.id === tenantTwoFolder.id));
  assert.ok(tenantTwoPageData.folders.some((folder) => folder.id === tenantTwoFolder.id));
  assert.ok(!tenantTwoPageData.folders.some((folder) => folder.id === tenantOneFolder.id));

  await assert.rejects(
    getActiveMediaLibraryFolder({
      supabase: context.reviewerClient,
      tenantId: context.secondTenantId,
      userId: context.reviewerUserId,
      folderId: tenantOneFolder.id,
    }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 404);
      assert.equal(error.code, "folder_not_found");
      return true;
    },
  );

  await archiveMediaLibraryFolder({
    supabase: context.reviewerClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    folderId: tenantOneFolder.id,
  });
  const archivedPageData = await getMediaLibraryPageData({
    supabase: context.reviewerClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
  });
  assert.ok(!archivedPageData.folders.some((folder) => folder.id === tenantOneFolder.id));
  assert.equal(archivedPageData.items[0]?.folderName ?? null, null);
});
