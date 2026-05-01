import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { getAutoMatchMaterializerVersion } from "../src/lib/matching/auto-match-config";
import {
  handleProjectCorrectionAssetBatchFinalizePost,
  handleProjectCorrectionAssetBatchPreparePost,
  handleProjectCorrectionAssetPreflightPost,
} from "../src/lib/assets/project-correction-asset-route-handlers";
import { finalizeProjectAssetBatch } from "../src/lib/assets/finalize-project-asset-batch";
import { prepareProjectAssetBatch } from "../src/lib/assets/prepare-project-asset-batch";
import { HttpError } from "../src/lib/http/errors";
import { ensureProjectReleaseSnapshot } from "../src/lib/project-releases/project-release-service";
import {
  applyWorkspaceWorkflowTransition,
  finalizeProject,
  getProjectWorkflowSummary,
  reopenWorkspaceForCorrection,
  startProjectCorrection,
} from "../src/lib/projects/project-workflow-service";
import { requireWorkspaceCorrectionMediaIntakeAccessForRequest } from "../src/lib/projects/project-workspace-request";
import {
  adminClient,
  assertNoPostgrestError,
  createAuthUserWithRetry,
  createPhotographerProjectWorkspace,
  createReviewerRoleAssignment,
  getDefaultProjectWorkspaceId,
  signInClient,
} from "./helpers/supabase-test-client";

type RoleClient = Awaited<ReturnType<typeof signInClient>>;

type Feature079Context = {
  tenantId: string;
  secondTenantId: string;
  projectId: string;
  secondProjectId: string;
  defaultWorkspaceId: string;
  photographerWorkspaceId: string;
  secondDefaultWorkspaceId: string;
  ownerUserId: string;
  adminUserId: string;
  reviewerUserId: string;
  photographerUserId: string;
  secondReviewerUserId: string;
  ownerClient: RoleClient;
  adminRoleClient: RoleClient;
  reviewerClient: RoleClient;
  photographerClient: RoleClient;
  secondReviewerClient: RoleClient;
};

async function createFeature079Context(): Promise<Feature079Context> {
  const owner = await createAuthUserWithRetry(adminClient, "feature079-owner");
  const adminRole = await createAuthUserWithRetry(adminClient, "feature079-admin");
  const reviewer = await createAuthUserWithRetry(adminClient, "feature079-reviewer");
  const photographer = await createAuthUserWithRetry(adminClient, "feature079-photographer");
  const secondReviewer = await createAuthUserWithRetry(adminClient, "feature079-reviewer-b");
  const ownerClient = await signInClient(owner.email, owner.password);
  const adminRoleClient = await signInClient(adminRole.email, adminRole.password);
  const reviewerClient = await signInClient(reviewer.email, reviewer.password);
  const photographerClient = await signInClient(photographer.email, photographer.password);
  const secondReviewerClient = await signInClient(secondReviewer.email, secondReviewer.password);

  const { data: tenant, error: tenantError } = await adminClient
    .from("tenants")
    .insert({ name: `Feature 079 Tenant ${randomUUID()}` })
    .select("id")
    .single();
  assertNoPostgrestError(tenantError, "insert feature 079 tenant");
  assert.ok(tenant);

  const { data: secondTenant, error: secondTenantError } = await adminClient
    .from("tenants")
    .insert({ name: `Feature 079 Tenant B ${randomUUID()}` })
    .select("id")
    .single();
  assertNoPostgrestError(secondTenantError, "insert feature 079 second tenant");
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
      user_id: secondReviewer.userId,
      role: "reviewer",
    },
  ]);
  assertNoPostgrestError(membershipError, "insert feature 079 memberships");

  const { data: project, error: projectError } = await adminClient
    .from("projects")
    .insert({
      tenant_id: tenant.id,
      created_by: owner.userId,
      name: "Feature 079 Project",
      description: "Feature 079 correction media intake project",
      status: "active",
    })
    .select("id")
    .single();
  assertNoPostgrestError(projectError, "insert feature 079 project");
  assert.ok(project);

  const { data: secondProject, error: secondProjectError } = await adminClient
    .from("projects")
    .insert({
      tenant_id: secondTenant.id,
      created_by: secondReviewer.userId,
      name: "Feature 079 Project B",
      description: "Feature 079 second tenant project",
      status: "active",
    })
    .select("id")
    .single();
  assertNoPostgrestError(secondProjectError, "insert feature 079 second project");
  assert.ok(secondProject);

  const defaultWorkspaceId = await getDefaultProjectWorkspaceId(adminClient, tenant.id, project.id);
  const secondDefaultWorkspaceId = await getDefaultProjectWorkspaceId(adminClient, secondTenant.id, secondProject.id);
  const photographerWorkspaceId = await createPhotographerProjectWorkspace({
    supabase: adminClient,
    tenantId: tenant.id,
    projectId: project.id,
    createdBy: owner.userId,
    photographerUserId: photographer.userId,
    name: "Feature 079 Photographer Workspace",
  });
  await createReviewerRoleAssignment({
    tenantId: tenant.id,
    userId: reviewer.userId,
    createdBy: owner.userId,
  });
  await createReviewerRoleAssignment({
    tenantId: secondTenant.id,
    userId: secondReviewer.userId,
    createdBy: secondReviewer.userId,
  });

  return {
    tenantId: tenant.id,
    secondTenantId: secondTenant.id,
    projectId: project.id,
    secondProjectId: secondProject.id,
    defaultWorkspaceId,
    photographerWorkspaceId,
    secondDefaultWorkspaceId,
    ownerUserId: owner.userId,
    adminUserId: adminRole.userId,
    reviewerUserId: reviewer.userId,
    photographerUserId: photographer.userId,
    secondReviewerUserId: secondReviewer.userId,
    ownerClient,
    adminRoleClient,
    reviewerClient,
    photographerClient,
    secondReviewerClient,
  };
}

async function createUploadedProjectAsset(input: {
  tenantId: string;
  projectId: string;
  workspaceId: string;
  createdBy: string;
  assetType: "photo" | "video";
  originalFilename: string;
}) {
  const assetId = randomUUID();
  const contentType = input.assetType === "video" ? "video/mp4" : "image/jpeg";
  const { error } = await adminClient.from("assets").insert({
    id: assetId,
    tenant_id: input.tenantId,
    project_id: input.projectId,
    workspace_id: input.workspaceId,
    created_by: input.createdBy,
    storage_bucket: "project-assets",
    storage_path: `tenant/${input.tenantId}/project/${input.projectId}/asset/${assetId}/${input.originalFilename}`,
    original_filename: input.originalFilename,
    content_type: contentType,
    file_size_bytes: input.assetType === "video" ? 4096 : 2048,
    asset_type: input.assetType,
    status: "uploaded",
    uploaded_at: new Date().toISOString(),
  });
  assertNoPostgrestError(error, "insert feature 079 project asset");
  return assetId;
}

async function handoffAndValidateWorkspace(input: {
  context: Feature079Context;
  workspaceId: string;
}) {
  await applyWorkspaceWorkflowTransition({
    supabase: adminClient,
    tenantId: input.context.tenantId,
    userId: input.context.photographerUserId,
    projectId: input.context.projectId,
    workspaceId: input.workspaceId,
    action: "handoff",
  });
  await applyWorkspaceWorkflowTransition({
    supabase: adminClient,
    tenantId: input.context.tenantId,
    userId: input.context.reviewerUserId,
    projectId: input.context.projectId,
    workspaceId: input.workspaceId,
    action: "validate",
  });
}

async function finalizeBaselineAndOpenCorrection(input: {
  context: Feature079Context;
  reopenWorkspaceIds?: string[];
}) {
  await createUploadedProjectAsset({
    tenantId: input.context.tenantId,
    projectId: input.context.projectId,
    workspaceId: input.context.defaultWorkspaceId,
    createdBy: input.context.ownerUserId,
    assetType: "video",
    originalFilename: "baseline-video.mp4",
  });

  for (const workspaceId of [input.context.defaultWorkspaceId, input.context.photographerWorkspaceId]) {
    await handoffAndValidateWorkspace({
      context: input.context,
      workspaceId,
    });
  }

  await finalizeProject({
    supabase: adminClient,
    tenantId: input.context.tenantId,
    userId: input.context.reviewerUserId,
    projectId: input.context.projectId,
  });

  const firstRelease = await ensureProjectReleaseSnapshot({
    supabase: adminClient,
    tenantId: input.context.tenantId,
    projectId: input.context.projectId,
    actorUserId: input.context.reviewerUserId,
  });

  await startProjectCorrection({
    supabase: adminClient,
    tenantId: input.context.tenantId,
    userId: input.context.reviewerUserId,
    projectId: input.context.projectId,
    reason: "Add correction media",
  });

  for (const workspaceId of input.reopenWorkspaceIds ?? []) {
    await reopenWorkspaceForCorrection({
      supabase: adminClient,
      tenantId: input.context.tenantId,
      userId: input.context.reviewerUserId,
      projectId: input.context.projectId,
      workspaceId,
    });
  }

  return firstRelease;
}

async function callCorrectionPreflight(input: {
  client: RoleClient | {
    auth: {
      getUser: () => Promise<{ data: { user: { id: string } | null } }>;
    };
  };
  tenantId: string;
  projectId: string;
  workspaceId: string;
  assetType: string;
  files: Array<{
    name: string;
    size: number;
    contentType: string;
    contentHash?: string | null;
  }>;
}) {
  return handleProjectCorrectionAssetPreflightPost(
    new Request(`http://localhost/api/projects/${input.projectId}/correction/assets/preflight`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: input.workspaceId,
        assetType: input.assetType,
        files: input.files,
      }),
    }),
    {
      params: Promise.resolve({
        projectId: input.projectId,
      }),
    },
    {
      createClient: async () => input.client as never,
      resolveTenantId: async () => input.tenantId,
      requireWorkspaceCorrectionMediaIntakeAccessForRequest,
    },
  );
}

async function callCorrectionPrepare(input: {
  client: RoleClient;
  tenantId: string;
  projectId: string;
  workspaceId: string;
  assetType: string;
  duplicatePolicy?: "upload_anyway" | "overwrite" | "ignore";
  items: Array<{
    clientItemId: string;
    idempotencyKey: string;
    originalFilename: string;
    contentType: string;
    fileSizeBytes: number;
    contentHash?: string | null;
    contentHashAlgo?: "sha256" | null;
  }>;
}) {
  return handleProjectCorrectionAssetBatchPreparePost(
    new Request(`http://localhost/api/projects/${input.projectId}/correction/assets/batch/prepare`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: input.workspaceId,
        assetType: input.assetType,
        duplicatePolicy: input.duplicatePolicy ?? "upload_anyway",
        items: input.items,
      }),
    }),
    {
      params: Promise.resolve({
        projectId: input.projectId,
      }),
    },
    {
      createClient: async () => input.client as never,
      createAdminClient: () => adminClient as never,
      resolveTenantId: async () => input.tenantId,
      requireWorkspaceCorrectionMediaIntakeAccessForRequest,
      prepareProjectAssetBatch,
    },
  );
}

async function callCorrectionFinalize(input: {
  client: RoleClient;
  tenantId: string;
  projectId: string;
  workspaceId: string;
  items: Array<{
    clientItemId: string;
    assetId: string;
  }>;
}) {
  return handleProjectCorrectionAssetBatchFinalizePost(
    new Request(`http://localhost/api/projects/${input.projectId}/correction/assets/batch/finalize`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        workspaceId: input.workspaceId,
        items: input.items,
      }),
    }),
    {
      params: Promise.resolve({
        projectId: input.projectId,
      }),
    },
    {
      createClient: async () => input.client as never,
      createAdminClient: () => adminClient as never,
      resolveTenantId: async () => input.tenantId,
      requireWorkspaceCorrectionMediaIntakeAccessForRequest,
      finalizeProjectAssetBatch,
    },
  );
}

async function markPhotoProcessingResolved(input: {
  context: Feature079Context;
  assetId: string;
  workspaceId: string;
}) {
  const materializationId = randomUUID();
  const { error: materializationError } = await adminClient.from("asset_face_materializations").insert({
    id: materializationId,
    tenant_id: input.context.tenantId,
    project_id: input.context.projectId,
    workspace_id: input.workspaceId,
    asset_id: input.assetId,
    asset_type: "photo",
    source_content_hash: null,
    source_content_hash_algo: null,
    source_uploaded_at: new Date().toISOString(),
    materializer_version: getAutoMatchMaterializerVersion(),
    provider: "test-provider",
    provider_mode: "detection",
    provider_plugin_versions: {},
    face_count: 0,
    usable_for_compare: true,
    unusable_reason: null,
    source_image_width: 6000,
    source_image_height: 4000,
    source_coordinate_space: "oriented_original",
    materialized_at: new Date().toISOString(),
  });
  assertNoPostgrestError(materializationError, "insert feature 079 materialization");

  const { error: jobUpdateError } = await adminClient
    .from("face_match_jobs")
    .update({
      status: "succeeded",
      locked_at: null,
      lease_expires_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", input.context.tenantId)
    .eq("project_id", input.context.projectId)
    .eq("scope_asset_id", input.assetId)
    .eq("job_type", "photo_uploaded");
  assertNoPostgrestError(jobUpdateError, "update feature 079 photo_uploaded jobs");
}

function createUnauthenticatedClient() {
  return {
    auth: {
      getUser: async () => ({
        data: {
          user: null,
        },
      }),
    },
  };
}

test("feature 079 correction preflight allows owner admin reviewer, denies photographers, and rejects unauthenticated requests", async () => {
  const context = await createFeature079Context();
  await finalizeBaselineAndOpenCorrection({
    context,
    reopenWorkspaceIds: [context.defaultWorkspaceId, context.photographerWorkspaceId],
  });

  for (const client of [context.ownerClient, context.adminRoleClient, context.reviewerClient]) {
    const response = await callCorrectionPreflight({
      client,
      tenantId: context.tenantId,
      projectId: context.projectId,
      workspaceId: context.defaultWorkspaceId,
      assetType: "photo",
      files: [
        {
          name: "allowed.jpg",
          size: 2048,
          contentType: "image/jpeg",
          contentHash: null,
        },
      ],
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      candidateSizes: [],
      duplicateHashes: [],
    });
  }

  const photographerDenied = await callCorrectionPreflight({
    client: context.photographerClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    workspaceId: context.photographerWorkspaceId,
    assetType: "photo",
    files: [
      {
        name: "denied.jpg",
        size: 2048,
        contentType: "image/jpeg",
        contentHash: null,
      },
    ],
  });
  assert.equal(photographerDenied.status, 403);
  assert.deepEqual(await photographerDenied.json(), {
    error: "workspace_media_intake_forbidden",
    message: "Only workspace owners, admins, and reviewers can add correction media.",
  });

  const unauthenticated = await callCorrectionPreflight({
    client: createUnauthenticatedClient(),
    tenantId: context.tenantId,
    projectId: context.projectId,
    workspaceId: context.defaultWorkspaceId,
    assetType: "photo",
    files: [
      {
        name: "unauthenticated.jpg",
        size: 2048,
        contentType: "image/jpeg",
        contentHash: null,
      },
    ],
  });
  assert.equal(unauthenticated.status, 401);
  assert.deepEqual(await unauthenticated.json(), {
    error: "unauthenticated",
    message: "Authentication required.",
  });
});

test("feature 079 correction preflight stays blocked when correction is closed, workspace is not reopened, workspace is revalidated, or scope is wrong", async () => {
  const finalizedContext = await createFeature079Context();
  await finalizeBaselineAndOpenCorrection({
    context: finalizedContext,
    reopenWorkspaceIds: [],
  });

  const correctionClosed = await createFeature079Context();
  await createUploadedProjectAsset({
    tenantId: correctionClosed.tenantId,
    projectId: correctionClosed.projectId,
    workspaceId: correctionClosed.defaultWorkspaceId,
    createdBy: correctionClosed.ownerUserId,
    assetType: "video",
    originalFilename: "baseline.mp4",
  });
  for (const workspaceId of [correctionClosed.defaultWorkspaceId, correctionClosed.photographerWorkspaceId]) {
    await handoffAndValidateWorkspace({
      context: correctionClosed,
      workspaceId,
    });
  }
  await finalizeProject({
    supabase: adminClient,
    tenantId: correctionClosed.tenantId,
    userId: correctionClosed.reviewerUserId,
    projectId: correctionClosed.projectId,
  });
  await ensureProjectReleaseSnapshot({
    supabase: adminClient,
    tenantId: correctionClosed.tenantId,
    projectId: correctionClosed.projectId,
    actorUserId: correctionClosed.reviewerUserId,
  });

  const closedResponse = await callCorrectionPreflight({
    client: correctionClosed.reviewerClient,
    tenantId: correctionClosed.tenantId,
    projectId: correctionClosed.projectId,
    workspaceId: correctionClosed.defaultWorkspaceId,
    assetType: "photo",
    files: [{ name: "closed.jpg", size: 2048, contentType: "image/jpeg", contentHash: null }],
  });
  assert.equal(closedResponse.status, 409);
  assert.deepEqual(await closedResponse.json(), {
    error: "project_finalized",
    message: "Finalized projects are read-only.",
  });

  const notReopenedResponse = await callCorrectionPreflight({
    client: finalizedContext.reviewerClient,
    tenantId: finalizedContext.tenantId,
    projectId: finalizedContext.projectId,
    workspaceId: finalizedContext.defaultWorkspaceId,
    assetType: "photo",
    files: [{ name: "locked.jpg", size: 2048, contentType: "image/jpeg", contentHash: null }],
  });
  assert.equal(notReopenedResponse.status, 409);
  assert.deepEqual(await notReopenedResponse.json(), {
    error: "workspace_correction_media_locked",
    message: "This workspace is not accepting correction media uploads.",
  });

  const revalidatedContext = await createFeature079Context();
  await finalizeBaselineAndOpenCorrection({
    context: revalidatedContext,
    reopenWorkspaceIds: [revalidatedContext.defaultWorkspaceId],
  });
  await applyWorkspaceWorkflowTransition({
    supabase: adminClient,
    tenantId: revalidatedContext.tenantId,
    userId: revalidatedContext.reviewerUserId,
    projectId: revalidatedContext.projectId,
    workspaceId: revalidatedContext.defaultWorkspaceId,
    action: "validate",
  });
  const revalidatedResponse = await callCorrectionPreflight({
    client: revalidatedContext.reviewerClient,
    tenantId: revalidatedContext.tenantId,
    projectId: revalidatedContext.projectId,
    workspaceId: revalidatedContext.defaultWorkspaceId,
    assetType: "photo",
    files: [{ name: "revalidated.jpg", size: 2048, contentType: "image/jpeg", contentHash: null }],
  });
  assert.equal(revalidatedResponse.status, 409);
  assert.deepEqual(await revalidatedResponse.json(), {
    error: "workspace_correction_media_locked",
    message: "This workspace is not accepting correction media uploads.",
  });

  const crossWorkspaceResponse = await callCorrectionPreflight({
    client: finalizedContext.photographerClient,
    tenantId: finalizedContext.tenantId,
    projectId: finalizedContext.projectId,
    workspaceId: finalizedContext.defaultWorkspaceId,
    assetType: "photo",
    files: [{ name: "wrong-workspace.jpg", size: 2048, contentType: "image/jpeg", contentHash: null }],
  });
  assert.equal(crossWorkspaceResponse.status, 404);

  const crossTenantResponse = await callCorrectionPreflight({
    client: finalizedContext.secondReviewerClient,
    tenantId: finalizedContext.secondTenantId,
    projectId: finalizedContext.projectId,
    workspaceId: finalizedContext.defaultWorkspaceId,
    assetType: "photo",
    files: [{ name: "wrong-tenant.jpg", size: 2048, contentType: "image/jpeg", contentHash: null }],
  });
  assert.equal(crossTenantResponse.status, 404);
});

test("feature 079 correction prepare/finalize supports photos and videos, rejects headshots, preserves idempotency, and enqueues post-finalize work", async () => {
  const context = await createFeature079Context();
  await finalizeBaselineAndOpenCorrection({
    context,
    reopenWorkspaceIds: [context.defaultWorkspaceId],
  });

  const headshotResponse = await callCorrectionPrepare({
    client: context.reviewerClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    workspaceId: context.defaultWorkspaceId,
    assetType: "headshot",
    items: [
      {
        clientItemId: "headshot-1",
        idempotencyKey: `feature079-headshot-${randomUUID()}`,
        originalFilename: "headshot.png",
        contentType: "image/png",
        fileSizeBytes: 1024,
        contentHash: null,
        contentHashAlgo: null,
      },
    ],
  });
  assert.equal(headshotResponse.status, 400);
  assert.deepEqual(await headshotResponse.json(), {
    error: "invalid_asset_type",
    message: "Invalid asset type.",
  });

  const photoIdempotencyKey = `feature079-photo-${randomUUID()}`;
  const firstPhotoPrepare = await callCorrectionPrepare({
    client: context.reviewerClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    workspaceId: context.defaultWorkspaceId,
    assetType: "photo",
    duplicatePolicy: "upload_anyway",
    items: [
      {
        clientItemId: "photo-1",
        idempotencyKey: photoIdempotencyKey,
        originalFilename: "correction-photo.jpg",
        contentType: "image/jpeg",
        fileSizeBytes: 2048,
        contentHash: "a".repeat(64),
        contentHashAlgo: "sha256",
      },
    ],
  });
  const secondPhotoPrepare = await callCorrectionPrepare({
    client: context.reviewerClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    workspaceId: context.defaultWorkspaceId,
    assetType: "photo",
    duplicatePolicy: "upload_anyway",
    items: [
      {
        clientItemId: "photo-1",
        idempotencyKey: photoIdempotencyKey,
        originalFilename: "correction-photo.jpg",
        contentType: "image/jpeg",
        fileSizeBytes: 2048,
        contentHash: "a".repeat(64),
        contentHashAlgo: "sha256",
      },
    ],
  });
  assert.equal(firstPhotoPrepare.status, 200);
  assert.equal(secondPhotoPrepare.status, 200);

  const firstPhotoPayload = await firstPhotoPrepare.json();
  const secondPhotoPayload = await secondPhotoPrepare.json();
  assert.equal(firstPhotoPayload.items[0]?.status, "ready");
  assert.equal(secondPhotoPayload.items[0]?.status, "ready");
  assert.equal(firstPhotoPayload.items[0]?.assetId, secondPhotoPayload.items[0]?.assetId);

  const photoAssetId = String(firstPhotoPayload.items[0]?.assetId ?? "");
  assert.ok(photoAssetId);

  const photoFinalize = await callCorrectionFinalize({
    client: context.reviewerClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    workspaceId: context.defaultWorkspaceId,
    items: [
      {
        clientItemId: "photo-1",
        assetId: photoAssetId,
      },
    ],
  });
  assert.equal(photoFinalize.status, 200);
  const photoFinalizePayload = await photoFinalize.json();
  assert.equal(photoFinalizePayload.items[0]?.status, "finalized");

  const { data: photoAssetRow, error: photoAssetError } = await adminClient
    .from("assets")
    .select("status")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("id", photoAssetId)
    .maybeSingle();
  assertNoPostgrestError(photoAssetError, "select feature 079 photo asset");
  assert.equal(photoAssetRow?.status, "uploaded");

  const { data: photoDerivatives, error: photoDerivativesError } = await adminClient
    .from("asset_image_derivatives")
    .select("derivative_kind, status")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("asset_id", photoAssetId)
    .order("derivative_kind", { ascending: true });
  assertNoPostgrestError(photoDerivativesError, "select feature 079 photo derivatives");
  assert.deepEqual(
    (photoDerivatives ?? []).map((row) => [row.derivative_kind, row.status]),
    [
      ["preview", "pending"],
      ["thumbnail", "pending"],
    ],
  );

  const { data: photoJobs, error: photoJobsError } = await adminClient
    .from("face_match_jobs")
    .select("job_type, status")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("scope_asset_id", photoAssetId)
    .eq("job_type", "photo_uploaded");
  assertNoPostgrestError(photoJobsError, "select feature 079 photo jobs");
  assert.equal(photoJobs?.length, 1);
  assert.equal(photoJobs?.[0]?.status, "queued");

  const videoPrepare = await callCorrectionPrepare({
    client: context.reviewerClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    workspaceId: context.defaultWorkspaceId,
    assetType: "video",
    duplicatePolicy: "ignore",
    items: [
      {
        clientItemId: "video-1",
        idempotencyKey: `feature079-video-${randomUUID()}`,
        originalFilename: "correction-video.mp4",
        contentType: "video/mp4",
        fileSizeBytes: 4096,
        contentHash: "b".repeat(64),
        contentHashAlgo: "sha256",
      },
      {
        clientItemId: "video-2",
        idempotencyKey: `feature079-video-${randomUUID()}`,
        originalFilename: "correction-video-duplicate.mp4",
        contentType: "video/mp4",
        fileSizeBytes: 4096,
        contentHash: "b".repeat(64),
        contentHashAlgo: "sha256",
      },
    ],
  });
  assert.equal(videoPrepare.status, 200);
  const videoPreparePayload = await videoPrepare.json();
  assert.equal(videoPreparePayload.items[0]?.status, "ready");
  assert.equal(videoPreparePayload.items[1]?.status, "ready");

  const videoAssetId = String(videoPreparePayload.items[0]?.assetId ?? "");
  assert.ok(videoAssetId);

  const videoFinalize = await callCorrectionFinalize({
    client: context.reviewerClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    workspaceId: context.defaultWorkspaceId,
    items: [
      {
        clientItemId: "video-1",
        assetId: videoAssetId,
      },
    ],
  });
  assert.equal(videoFinalize.status, 200);

  const { data: videoDerivatives, error: videoDerivativesError } = await adminClient
    .from("asset_image_derivatives")
    .select("derivative_kind, status")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("asset_id", videoAssetId)
    .order("derivative_kind", { ascending: true });
  assertNoPostgrestError(videoDerivativesError, "select feature 079 video derivatives");
  assert.deepEqual(
    (videoDerivatives ?? []).map((row) => [row.derivative_kind, row.status]),
    [
      ["preview", "pending"],
      ["thumbnail", "pending"],
    ],
  );

  const { data: videoJobs, error: videoJobsError } = await adminClient
    .from("face_match_jobs")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("scope_asset_id", videoAssetId);
  assertNoPostgrestError(videoJobsError, "select feature 079 video jobs");
  assert.equal(videoJobs?.length ?? 0, 0);
});

test("feature 079 pending media rows block validation and uploaded correction photos stay blocked until existing processing resolves", async () => {
  const pendingContext = await createFeature079Context();
  await finalizeBaselineAndOpenCorrection({
    context: pendingContext,
    reopenWorkspaceIds: [pendingContext.defaultWorkspaceId],
  });

  const pendingPrepare = await callCorrectionPrepare({
    client: pendingContext.reviewerClient,
    tenantId: pendingContext.tenantId,
    projectId: pendingContext.projectId,
    workspaceId: pendingContext.defaultWorkspaceId,
    assetType: "video",
    items: [
      {
        clientItemId: "pending-video",
        idempotencyKey: `feature079-pending-video-${randomUUID()}`,
        originalFilename: "pending-video.mp4",
        contentType: "video/mp4",
        fileSizeBytes: 4096,
        contentHash: null,
        contentHashAlgo: null,
      },
    ],
  });
  assert.equal(pendingPrepare.status, 200);

  const pendingSummary = await getProjectWorkflowSummary({
    supabase: adminClient,
    tenantId: pendingContext.tenantId,
    projectId: pendingContext.projectId,
  });
  const pendingWorkspaceSummary = pendingSummary.workspaces.find(
    (workspace) => workspace.workspaceId === pendingContext.defaultWorkspaceId,
  );
  assert.equal(pendingWorkspaceSummary?.blockers.pendingAssetCount, 1);

  await assert.rejects(
    applyWorkspaceWorkflowTransition({
      supabase: adminClient,
      tenantId: pendingContext.tenantId,
      userId: pendingContext.reviewerUserId,
      projectId: pendingContext.projectId,
      workspaceId: pendingContext.defaultWorkspaceId,
      action: "validate",
    }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 409);
      assert.equal(error.code, "workspace_validation_blocked");
      return true;
    },
  );

  const uploadedPhotoContext = await createFeature079Context();
  await finalizeBaselineAndOpenCorrection({
    context: uploadedPhotoContext,
    reopenWorkspaceIds: [uploadedPhotoContext.defaultWorkspaceId],
  });

  const photoPrepare = await callCorrectionPrepare({
    client: uploadedPhotoContext.reviewerClient,
    tenantId: uploadedPhotoContext.tenantId,
    projectId: uploadedPhotoContext.projectId,
    workspaceId: uploadedPhotoContext.defaultWorkspaceId,
    assetType: "photo",
    items: [
      {
        clientItemId: "uploaded-photo",
        idempotencyKey: `feature079-uploaded-photo-${randomUUID()}`,
        originalFilename: "uploaded-photo.jpg",
        contentType: "image/jpeg",
        fileSizeBytes: 2048,
        contentHash: "c".repeat(64),
        contentHashAlgo: "sha256",
      },
    ],
  });
  const photoPreparePayload = await photoPrepare.json();
  const uploadedPhotoAssetId = String(photoPreparePayload.items[0]?.assetId ?? "");
  assert.ok(uploadedPhotoAssetId);

  const photoFinalize = await callCorrectionFinalize({
    client: uploadedPhotoContext.reviewerClient,
    tenantId: uploadedPhotoContext.tenantId,
    projectId: uploadedPhotoContext.projectId,
    workspaceId: uploadedPhotoContext.defaultWorkspaceId,
    items: [
      {
        clientItemId: "uploaded-photo",
        assetId: uploadedPhotoAssetId,
      },
    ],
  });
  assert.equal(photoFinalize.status, 200);

  await assert.rejects(
    applyWorkspaceWorkflowTransition({
      supabase: adminClient,
      tenantId: uploadedPhotoContext.tenantId,
      userId: uploadedPhotoContext.reviewerUserId,
      projectId: uploadedPhotoContext.projectId,
      workspaceId: uploadedPhotoContext.defaultWorkspaceId,
      action: "validate",
    }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 409);
      assert.equal(error.code, "workspace_validation_blocked");
      return true;
    },
  );

  await markPhotoProcessingResolved({
    context: uploadedPhotoContext,
    assetId: uploadedPhotoAssetId,
    workspaceId: uploadedPhotoContext.defaultWorkspaceId,
  });

  const validated = await applyWorkspaceWorkflowTransition({
    supabase: adminClient,
    tenantId: uploadedPhotoContext.tenantId,
    userId: uploadedPhotoContext.reviewerUserId,
    projectId: uploadedPhotoContext.projectId,
    workspaceId: uploadedPhotoContext.defaultWorkspaceId,
    action: "validate",
  });
  assert.equal(validated.changed, true);
  assert.equal(validated.workspace.workflow_state, "validated");
});

test("feature 079 corrected finalization includes new photo and video assets in v2 while v1 stays immutable and new Media Library identities have no folder membership", async () => {
  const context = await createFeature079Context();
  const firstRelease = await finalizeBaselineAndOpenCorrection({
    context,
    reopenWorkspaceIds: [context.defaultWorkspaceId],
  });

  const { data: firstReleaseAssetsBefore, error: firstReleaseAssetsBeforeError } = await adminClient
    .from("project_release_assets")
    .select("id, source_asset_id")
    .eq("tenant_id", context.tenantId)
    .eq("release_id", firstRelease.id)
    .order("source_asset_id", { ascending: true });
  assertNoPostgrestError(firstReleaseAssetsBeforeError, "select feature 079 v1 assets before correction");
  const firstReleaseAssetIds = (firstReleaseAssetsBefore ?? []).map((row) => row.id);
  assert.equal(firstReleaseAssetsBefore?.length, 1);

  const photoPrepare = await callCorrectionPrepare({
    client: context.reviewerClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    workspaceId: context.defaultWorkspaceId,
    assetType: "photo",
    items: [
      {
        clientItemId: "release-photo",
        idempotencyKey: `feature079-release-photo-${randomUUID()}`,
        originalFilename: "release-photo.jpg",
        contentType: "image/jpeg",
        fileSizeBytes: 2048,
        contentHash: "d".repeat(64),
        contentHashAlgo: "sha256",
      },
    ],
  });
  const photoPreparePayload = await photoPrepare.json();
  const correctionPhotoAssetId = String(photoPreparePayload.items[0]?.assetId ?? "");
  assert.ok(correctionPhotoAssetId);

  const videoPrepare = await callCorrectionPrepare({
    client: context.reviewerClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    workspaceId: context.defaultWorkspaceId,
    assetType: "video",
    items: [
      {
        clientItemId: "release-video",
        idempotencyKey: `feature079-release-video-${randomUUID()}`,
        originalFilename: "release-video.mp4",
        contentType: "video/mp4",
        fileSizeBytes: 4096,
        contentHash: null,
        contentHashAlgo: null,
      },
    ],
  });
  const videoPreparePayload = await videoPrepare.json();
  const correctionVideoAssetId = String(videoPreparePayload.items[0]?.assetId ?? "");
  assert.ok(correctionVideoAssetId);

  const photoFinalize = await callCorrectionFinalize({
    client: context.reviewerClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    workspaceId: context.defaultWorkspaceId,
    items: [
      {
        clientItemId: "release-photo",
        assetId: correctionPhotoAssetId,
      },
    ],
  });
  assert.equal(photoFinalize.status, 200);

  const videoFinalize = await callCorrectionFinalize({
    client: context.reviewerClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    workspaceId: context.defaultWorkspaceId,
    items: [
      {
        clientItemId: "release-video",
        assetId: correctionVideoAssetId,
      },
    ],
  });
  assert.equal(videoFinalize.status, 200);

  await markPhotoProcessingResolved({
    context,
    assetId: correctionPhotoAssetId,
    workspaceId: context.defaultWorkspaceId,
  });

  const validated = await applyWorkspaceWorkflowTransition({
    supabase: adminClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    projectId: context.projectId,
    workspaceId: context.defaultWorkspaceId,
    action: "validate",
  });
  assert.equal(validated.workspace.workflow_state, "validated");

  const correctedFinalize = await finalizeProject({
    supabase: adminClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    projectId: context.projectId,
  });
  assert.equal(correctedFinalize.changed, true);
  assert.equal(correctedFinalize.projectWorkflow.workflowState, "finalized");

  const secondRelease = await ensureProjectReleaseSnapshot({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    actorUserId: context.reviewerUserId,
  });
  assert.equal(secondRelease.releaseVersion, 2);
  assert.notEqual(secondRelease.id, firstRelease.id);

  const { data: secondReleaseAssets, error: secondReleaseAssetsError } = await adminClient
    .from("project_release_assets")
    .select("source_asset_id, asset_type")
    .eq("tenant_id", context.tenantId)
    .eq("release_id", secondRelease.id)
    .order("source_asset_id", { ascending: true });
  assertNoPostgrestError(secondReleaseAssetsError, "select feature 079 v2 assets");
  assert.deepEqual(
    (secondReleaseAssets ?? []).map((row) => row.source_asset_id).sort(),
    [
      String(firstReleaseAssetsBefore?.[0]?.source_asset_id ?? ""),
      correctionPhotoAssetId,
      correctionVideoAssetId,
    ].sort(),
  );
  assert.deepEqual(
    (secondReleaseAssets ?? []).map((row) => row.asset_type).sort(),
    ["photo", "video", "video"],
  );

  const { data: firstReleaseAssetsAfter, error: firstReleaseAssetsAfterError } = await adminClient
    .from("project_release_assets")
    .select("id, source_asset_id")
    .eq("tenant_id", context.tenantId)
    .eq("release_id", firstRelease.id)
    .order("source_asset_id", { ascending: true });
  assertNoPostgrestError(firstReleaseAssetsAfterError, "select feature 079 v1 assets after correction");
  assert.deepEqual(
    (firstReleaseAssetsAfter ?? []).map((row) => row.id),
    firstReleaseAssetIds,
  );
  assert.deepEqual(firstReleaseAssetsAfter, firstReleaseAssetsBefore);

  const { data: mediaLibraryRows, error: mediaLibraryRowsError } = await adminClient
    .from("media_library_assets")
    .select("id, source_asset_id")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .in("source_asset_id", [correctionPhotoAssetId, correctionVideoAssetId]);
  assertNoPostgrestError(mediaLibraryRowsError, "select feature 079 media library assets");
  assert.equal(mediaLibraryRows?.length, 2);

  const stableAssetIds = (mediaLibraryRows ?? []).map((row) => row.id);
  const { data: memberships, error: membershipsError } = await adminClient
    .from("media_library_folder_memberships")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .in("media_library_asset_id", stableAssetIds);
  assertNoPostgrestError(membershipsError, "select feature 079 folder memberships");
  assert.equal(memberships?.length ?? 0, 0);
});
