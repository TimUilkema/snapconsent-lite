import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { HttpError } from "../src/lib/http/errors";
import {
  ensureProjectReleaseSnapshot,
  getReleaseAssetDetail,
  listMediaLibraryAssets,
} from "../src/lib/project-releases/project-release-service";
import {
  adminClient,
  assertNoPostgrestError,
  createAuthUserWithRetry,
  createPhotographerProjectWorkspace,
  createReviewerRoleAssignment,
  getDefaultProjectWorkspaceId,
  signInClient,
} from "./helpers/supabase-test-client";

type ReleaseTestContext = {
  tenantId: string;
  projectId: string;
  defaultWorkspaceId: string;
  secondWorkspaceId: string;
  ownerUserId: string;
  reviewerUserId: string;
  photographerUserId: string;
  reviewerClient: Awaited<ReturnType<typeof signInClient>>;
  photographerClient: Awaited<ReturnType<typeof signInClient>>;
};

async function createReleaseContext(): Promise<ReleaseTestContext> {
  const owner = await createAuthUserWithRetry(adminClient, "feature074-owner");
  const reviewer = await createAuthUserWithRetry(adminClient, "feature074-reviewer");
  const photographer = await createAuthUserWithRetry(adminClient, "feature074-photographer");
  const reviewerClient = await signInClient(reviewer.email, reviewer.password);
  const photographerClient = await signInClient(photographer.email, photographer.password);

  const { data: tenant, error: tenantError } = await adminClient
    .from("tenants")
    .insert({
      name: `Feature 074 Tenant ${randomUUID()}`,
    })
    .select("id")
    .single();
  assertNoPostgrestError(tenantError, "insert feature 074 tenant");
  assert.ok(tenant);

  const { error: membershipError } = await adminClient.from("memberships").insert([
    {
      tenant_id: tenant.id,
      user_id: owner.userId,
      role: "owner",
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
  assertNoPostgrestError(membershipError, "insert feature 074 memberships");

  const { data: project, error: projectError } = await adminClient
    .from("projects")
    .insert({
      tenant_id: tenant.id,
      created_by: owner.userId,
      name: "Feature 074 Release Project",
      description: "Feature 074 release snapshot integration test project",
      status: "active",
    })
    .select("id")
    .single();
  assertNoPostgrestError(projectError, "insert feature 074 project");
  assert.ok(project);

  const defaultWorkspaceId = await getDefaultProjectWorkspaceId(adminClient, tenant.id, project.id);
  const secondWorkspaceId = await createPhotographerProjectWorkspace({
    supabase: adminClient,
    tenantId: tenant.id,
    projectId: project.id,
    createdBy: owner.userId,
    photographerUserId: photographer.userId,
    name: "Feature 074 Second Workspace",
  });
  await createReviewerRoleAssignment({
    tenantId: tenant.id,
    userId: reviewer.userId,
    createdBy: owner.userId,
  });

  return {
    tenantId: tenant.id,
    projectId: project.id,
    defaultWorkspaceId,
    secondWorkspaceId,
    ownerUserId: owner.userId,
    reviewerUserId: reviewer.userId,
    photographerUserId: photographer.userId,
    reviewerClient,
    photographerClient,
  };
}

async function finalizeProjectRecord(context: ReleaseTestContext, finalizedBy = context.reviewerUserId) {
  const finalizedAt = new Date().toISOString();
  const { error } = await adminClient
    .from("projects")
    .update({
      finalized_at: finalizedAt,
      finalized_by: finalizedBy,
    })
    .eq("tenant_id", context.tenantId)
    .eq("id", context.projectId);
  assertNoPostgrestError(error, "finalize feature 074 project directly");
  return finalizedAt;
}

async function createProjectAsset(input: {
  context: ReleaseTestContext;
  workspaceId: string;
  assetType: "photo" | "video" | "headshot";
  originalFilename: string;
}) {
  const assetId = randomUUID();
  const storagePath =
    `tenant/${input.context.tenantId}/project/${input.context.projectId}/asset/${assetId}/${input.originalFilename}`;
  const contentType =
    input.assetType === "video"
      ? "video/mp4"
      : input.assetType === "headshot"
        ? "image/png"
        : "image/jpeg";

  const { error } = await adminClient.from("assets").insert({
    id: assetId,
    tenant_id: input.context.tenantId,
    project_id: input.context.projectId,
    workspace_id: input.workspaceId,
    created_by: input.context.ownerUserId,
    storage_bucket: "project-assets",
    storage_path: storagePath,
    original_filename: input.originalFilename,
    content_type: contentType,
    file_size_bytes: input.assetType === "video" ? 4096 : 2048,
    asset_type: input.assetType,
    status: "uploaded",
    uploaded_at: new Date().toISOString(),
  });
  assertNoPostgrestError(error, "insert feature 074 asset");

  return {
    assetId,
    storagePath,
    assetType: input.assetType,
  };
}

test("feature 074 release creation is rejected before finalization", async () => {
  const context = await createReleaseContext();

  await assert.rejects(
    ensureProjectReleaseSnapshot({
      supabase: adminClient,
      tenantId: context.tenantId,
      projectId: context.projectId,
      actorUserId: context.reviewerUserId,
    }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 409);
      assert.equal(error.code, "project_release_not_finalized");
      return true;
    },
  );
});

test("feature 074 release snapshot is created once, starts at v1, includes photos and videos, and excludes headshots", async () => {
  const context = await createReleaseContext();
  const photo = await createProjectAsset({
    context,
    workspaceId: context.defaultWorkspaceId,
    assetType: "photo",
    originalFilename: "release-photo.jpg",
  });
  const video = await createProjectAsset({
    context,
    workspaceId: context.secondWorkspaceId,
    assetType: "video",
    originalFilename: "release-video.mp4",
  });
  await createProjectAsset({
    context,
    workspaceId: context.defaultWorkspaceId,
    assetType: "headshot",
    originalFilename: "release-headshot.png",
  });

  await finalizeProjectRecord(context);

  const firstRelease = await ensureProjectReleaseSnapshot({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    actorUserId: context.reviewerUserId,
  });
  const secondRelease = await ensureProjectReleaseSnapshot({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    actorUserId: context.reviewerUserId,
  });

  assert.equal(firstRelease.status, "published");
  assert.equal(firstRelease.releaseVersion, 1);
  assert.equal(firstRelease.assetCount, 2);
  assert.equal(secondRelease.id, firstRelease.id);
  assert.equal(secondRelease.snapshotCreatedAt, firstRelease.snapshotCreatedAt);

  const { data: releaseRows, error: releaseRowsError } = await adminClient
    .from("project_releases")
    .select("id, release_version, status, project_snapshot")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId);
  assertNoPostgrestError(releaseRowsError, "select feature 074 release rows");
  assert.equal(releaseRows?.length, 1);
  assert.equal(releaseRows?.[0]?.release_version, 1);
  assert.equal(releaseRows?.[0]?.status, "published");
  assert.equal((releaseRows?.[0]?.project_snapshot as { assetCounts?: { total?: number } } | null)?.assetCounts?.total, 2);

  const { data: releaseAssets, error: releaseAssetsError } = await adminClient
    .from("project_release_assets")
    .select("source_asset_id, asset_type, workspace_id, original_storage_path")
    .eq("tenant_id", context.tenantId)
    .eq("release_id", firstRelease.id)
    .order("asset_type", { ascending: true });
  assertNoPostgrestError(releaseAssetsError, "select feature 074 release assets");
  assert.deepEqual(
    (releaseAssets ?? []).map((row) => row.source_asset_id).sort(),
    [photo.assetId, video.assetId].sort(),
  );
  assert.deepEqual(
    (releaseAssets ?? []).map((row) => row.asset_type).sort(),
    ["photo", "video"],
  );

  const { data: sourceAssets, error: sourceAssetsError } = await adminClient
    .from("assets")
    .select("id, storage_path")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .in("id", [photo.assetId, video.assetId]);
  assertNoPostgrestError(sourceAssetsError, "select feature 074 source assets");
  assert.deepEqual(
    (sourceAssets ?? []).map((row) => row.id).sort(),
    [photo.assetId, video.assetId].sort(),
  );
  assert.ok((sourceAssets ?? []).some((row) => row.storage_path === photo.storagePath));
  assert.ok((sourceAssets ?? []).some((row) => row.storage_path === video.storagePath));
});

test("feature 074 existing building releases are repaired in place on retry", async () => {
  const context = await createReleaseContext();
  const photo = await createProjectAsset({
    context,
    workspaceId: context.defaultWorkspaceId,
    assetType: "photo",
    originalFilename: "repair-photo.jpg",
  });
  const finalizedAt = await finalizeProjectRecord(context);
  const releaseId = randomUUID();

  const { error: releaseInsertError } = await adminClient.from("project_releases").insert({
    id: releaseId,
    tenant_id: context.tenantId,
    project_id: context.projectId,
    release_version: 1,
    status: "building",
    created_by: context.reviewerUserId,
    source_project_finalized_at: finalizedAt,
    source_project_finalized_by: context.reviewerUserId,
    project_snapshot: {
      schemaVersion: 1,
      repair: true,
    },
  });
  assertNoPostgrestError(releaseInsertError, "insert feature 074 building release");

  const { error: releaseAssetInsertError } = await adminClient.from("project_release_assets").insert({
    tenant_id: context.tenantId,
    release_id: releaseId,
    project_id: context.projectId,
    workspace_id: context.defaultWorkspaceId,
    source_asset_id: photo.assetId,
    asset_type: "photo",
    original_filename: "stale-row.jpg",
    original_storage_bucket: "project-assets",
    original_storage_path: "stale/path.jpg",
    content_type: "image/jpeg",
    file_size_bytes: 123,
    uploaded_at: new Date().toISOString(),
    asset_metadata_snapshot: { stale: true },
    workspace_snapshot: { stale: true },
    consent_snapshot: { stale: true },
    link_snapshot: { stale: true },
    review_snapshot: { stale: true },
    scope_snapshot: { stale: true },
  });
  assertNoPostgrestError(releaseAssetInsertError, "insert feature 074 stale release asset");

  const repairedRelease = await ensureProjectReleaseSnapshot({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    actorUserId: context.reviewerUserId,
  });

  assert.equal(repairedRelease.id, releaseId);
  assert.equal(repairedRelease.status, "published");
  assert.equal(repairedRelease.assetCount, 1);

  const { data: repairedReleaseRows, error: repairedReleaseRowsError } = await adminClient
    .from("project_releases")
    .select("id, status, snapshot_created_at")
    .eq("id", releaseId)
    .maybeSingle();
  assertNoPostgrestError(repairedReleaseRowsError, "select repaired release");
  assert.equal(repairedReleaseRows?.status, "published");
  assert.ok(repairedReleaseRows?.snapshot_created_at);

  const { data: repairedAssets, error: repairedAssetsError } = await adminClient
    .from("project_release_assets")
    .select("source_asset_id, original_filename")
    .eq("release_id", releaseId);
  assertNoPostgrestError(repairedAssetsError, "select repaired release assets");
  assert.equal(repairedAssets?.length, 1);
  assert.equal(repairedAssets?.[0]?.source_asset_id, photo.assetId);
  assert.equal(repairedAssets?.[0]?.original_filename, "repair-photo.jpg");
});

test("feature 074 zero-asset finalized projects still publish a parent release", async () => {
  const context = await createReleaseContext();
  await finalizeProjectRecord(context);

  const release = await ensureProjectReleaseSnapshot({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    actorUserId: context.reviewerUserId,
  });

  assert.equal(release.status, "published");
  assert.equal(release.assetCount, 0);
});

test("feature 074 Media Library reads allow reviewers and block photographers", async () => {
  const context = await createReleaseContext();
  await createProjectAsset({
    context,
    workspaceId: context.defaultWorkspaceId,
    assetType: "photo",
    originalFilename: "media-library-photo.jpg",
  });
  await finalizeProjectRecord(context);
  const release = await ensureProjectReleaseSnapshot({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    actorUserId: context.reviewerUserId,
  });

  const reviewerItems = await listMediaLibraryAssets({
    supabase: context.reviewerClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
  });
  assert.equal(reviewerItems.length, 1);
  assert.equal(reviewerItems[0]?.releaseVersion, 1);
  assert.equal(reviewerItems[0]?.row.workspace_snapshot.release.releaseId, release.id);

  const detail = await getReleaseAssetDetail({
    supabase: context.reviewerClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    releaseAssetId: reviewerItems[0]?.row.id ?? "",
  });
  assert.equal(detail.row.original_filename, "media-library-photo.jpg");

  await assert.rejects(
    listMediaLibraryAssets({
      supabase: context.photographerClient,
      tenantId: context.tenantId,
      userId: context.photographerUserId,
    }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 403);
      assert.equal(error.code, "media_library_forbidden");
      return true;
    },
  );
});

test("feature 075 correction re-release creates v2 and Media Library defaults to the latest published release per project", async () => {
  const context = await createReleaseContext();
  const photo = await createProjectAsset({
    context,
    workspaceId: context.defaultWorkspaceId,
    assetType: "photo",
    originalFilename: "re-release-photo.jpg",
  });

  const firstFinalizedAt = await finalizeProjectRecord(context);
  const firstRelease = await ensureProjectReleaseSnapshot({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    actorUserId: context.reviewerUserId,
  });

  const { data: firstReleaseAssets, error: firstReleaseAssetsError } = await adminClient
    .from("project_release_assets")
    .select("id, release_id, source_asset_id")
    .eq("tenant_id", context.tenantId)
    .eq("release_id", firstRelease.id);
  assertNoPostgrestError(firstReleaseAssetsError, "select first release assets");
  assert.equal(firstReleaseAssets?.length, 1);
  const firstReleaseAssetId = firstReleaseAssets?.[0]?.id ?? null;
  assert.ok(firstReleaseAssetId);

  const secondFinalizedAt = await finalizeProjectRecord(context);
  assert.notEqual(secondFinalizedAt, firstFinalizedAt);

  const secondRelease = await ensureProjectReleaseSnapshot({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    actorUserId: context.reviewerUserId,
  });

  assert.equal(firstRelease.releaseVersion, 1);
  assert.equal(secondRelease.releaseVersion, 2);
  assert.notEqual(secondRelease.id, firstRelease.id);

  const { data: releaseRows, error: releaseRowsError } = await adminClient
    .from("project_releases")
    .select("id, release_version, source_project_finalized_at, status")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .order("release_version", { ascending: true });
  assertNoPostgrestError(releaseRowsError, "select v1 and v2 release rows");
  assert.deepEqual(
    (releaseRows ?? []).map((row) => row.release_version),
    [1, 2],
  );
  assert.deepEqual(
    (releaseRows ?? []).map((row) => new Date(row.source_project_finalized_at).toISOString()),
    [firstFinalizedAt, secondFinalizedAt].map((value) => new Date(value).toISOString()),
  );
  assert.ok((releaseRows ?? []).every((row) => row.status === "published"));

  const reviewerItems = await listMediaLibraryAssets({
    supabase: context.reviewerClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
  });
  assert.equal(reviewerItems.length, 1);
  assert.equal(reviewerItems[0]?.releaseVersion, 2);
  assert.equal(reviewerItems[0]?.row.release_id, secondRelease.id);
  assert.equal(reviewerItems[0]?.row.source_asset_id, photo.assetId);

  const latestDetail = await getReleaseAssetDetail({
    supabase: context.reviewerClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    releaseAssetId: reviewerItems[0]?.row.id ?? "",
  });
  assert.equal(latestDetail.releaseVersion, 2);
  assert.equal(latestDetail.row.release_id, secondRelease.id);

  const historicalDetail = await getReleaseAssetDetail({
    supabase: context.reviewerClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    releaseAssetId: firstReleaseAssetId ?? "",
  });
  assert.equal(historicalDetail.releaseVersion, 1);
  assert.equal(historicalDetail.row.release_id, firstRelease.id);

  const { data: firstReleaseAssetRowsAfter, error: firstReleaseAssetRowsAfterError } = await adminClient
    .from("project_release_assets")
    .select("id, release_id, source_asset_id")
    .eq("tenant_id", context.tenantId)
    .eq("release_id", firstRelease.id);
  assertNoPostgrestError(firstReleaseAssetRowsAfterError, "reselect historical release assets");
  assert.equal(firstReleaseAssetRowsAfter?.length, 1);
  assert.equal(firstReleaseAssetRowsAfter?.[0]?.id, firstReleaseAssetId);
  assert.equal(firstReleaseAssetRowsAfter?.[0]?.source_asset_id, photo.assetId);
});
