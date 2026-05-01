import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { HttpError } from "../src/lib/http/errors";
import { ensureProjectReleaseSnapshot } from "../src/lib/project-releases/project-release-service";
import {
  applyWorkspaceWorkflowTransition,
  assertWorkspaceCorrectionReviewMutationAllowed,
  finalizeProject,
  getProjectWorkflowSummary,
  reopenWorkspaceForCorrection,
  startProjectCorrection,
} from "../src/lib/projects/project-workflow-service";
import {
  adminClient,
  assertNoPostgrestError,
  createAuthUserWithRetry,
  createPhotographerProjectWorkspace,
  getDefaultProjectWorkspaceId,
} from "./helpers/supabase-test-client";

type CorrectionWorkflowContext = {
  tenantId: string;
  projectId: string;
  defaultWorkspaceId: string;
  secondWorkspaceId: string;
  ownerUserId: string;
  reviewerUserId: string;
  photographerUserId: string;
};

async function createCorrectionWorkflowContext(): Promise<CorrectionWorkflowContext> {
  const owner = await createAuthUserWithRetry(adminClient, "feature075-owner");
  const reviewer = await createAuthUserWithRetry(adminClient, "feature075-reviewer");
  const photographer = await createAuthUserWithRetry(adminClient, "feature075-photographer");

  const { data: tenant, error: tenantError } = await adminClient
    .from("tenants")
    .insert({
      name: `Feature 075 Tenant ${randomUUID()}`,
    })
    .select("id")
    .single();
  assertNoPostgrestError(tenantError, "insert feature 075 tenant");
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
  assertNoPostgrestError(membershipError, "insert feature 075 memberships");

  const { data: project, error: projectError } = await adminClient
    .from("projects")
    .insert({
      tenant_id: tenant.id,
      created_by: owner.userId,
      name: "Feature 075 Correction Project",
      description: "Feature 075 correction workflow integration test project",
      status: "active",
    })
    .select("id")
    .single();
  assertNoPostgrestError(projectError, "insert feature 075 project");
  assert.ok(project);

  const defaultWorkspaceId = await getDefaultProjectWorkspaceId(adminClient, tenant.id, project.id);
  const secondWorkspaceId = await createPhotographerProjectWorkspace({
    supabase: adminClient,
    tenantId: tenant.id,
    projectId: project.id,
    createdBy: owner.userId,
    photographerUserId: photographer.userId,
    name: "Feature 075 Second Workspace",
  });

  return {
    tenantId: tenant.id,
    projectId: project.id,
    defaultWorkspaceId,
    secondWorkspaceId,
    ownerUserId: owner.userId,
    reviewerUserId: reviewer.userId,
    photographerUserId: photographer.userId,
  };
}

async function createProjectPhotoAsset(input: {
  context: CorrectionWorkflowContext;
  workspaceId: string;
  originalFilename: string;
}) {
  const assetId = randomUUID();
  const { error } = await adminClient.from("assets").insert({
    id: assetId,
    tenant_id: input.context.tenantId,
    project_id: input.context.projectId,
    workspace_id: input.workspaceId,
    created_by: input.context.ownerUserId,
    storage_bucket: "project-assets",
    storage_path:
      `tenant/${input.context.tenantId}/project/${input.context.projectId}/asset/${assetId}/${input.originalFilename}`,
    original_filename: input.originalFilename,
    content_type: "video/mp4",
    file_size_bytes: 4096,
    asset_type: "video",
    status: "uploaded",
    uploaded_at: new Date().toISOString(),
  });
  assertNoPostgrestError(error, "insert feature 075 release asset");
  return assetId;
}

async function handoffAndValidateWorkspace(input: {
  context: CorrectionWorkflowContext;
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

test("feature 075 correction start requires an existing published baseline release and blocks finalize until a workspace is reopened", async () => {
  const context = await createCorrectionWorkflowContext();
  await createProjectPhotoAsset({
    context,
    workspaceId: context.defaultWorkspaceId,
    originalFilename: "correction-baseline.jpg",
  });

  for (const workspaceId of [context.defaultWorkspaceId, context.secondWorkspaceId]) {
    await handoffAndValidateWorkspace({ context, workspaceId });
  }

  await finalizeProject({
    supabase: adminClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    projectId: context.projectId,
  });

  await assert.rejects(
    startProjectCorrection({
      supabase: adminClient,
      tenantId: context.tenantId,
      userId: context.reviewerUserId,
      projectId: context.projectId,
    }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 409);
      assert.equal(error.code, "project_correction_release_missing");
      return true;
    },
  );

  const firstRelease = await ensureProjectReleaseSnapshot({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    actorUserId: context.reviewerUserId,
  });
  assert.equal(firstRelease.releaseVersion, 1);

  const correction = await startProjectCorrection({
    supabase: adminClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    projectId: context.projectId,
    reason: "Fix reviewed links",
  });
  assert.equal(correction.changed, true);
  assert.equal(correction.projectWorkflow.workflowState, "correction_open");
  assert.equal(correction.projectWorkflow.correctionState, "open");
  assert.equal(correction.projectWorkflow.correctionReason, "Fix reviewed links");
  assert.equal(correction.projectWorkflow.hasCorrectionReopenedWorkspaces, false);

  const correctionRetry = await startProjectCorrection({
    supabase: adminClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    projectId: context.projectId,
  });
  assert.equal(correctionRetry.changed, false);
  assert.equal(correctionRetry.projectWorkflow.correctionState, "open");

  await assert.rejects(
    finalizeProject({
      supabase: adminClient,
      tenantId: context.tenantId,
      userId: context.reviewerUserId,
      projectId: context.projectId,
    }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 409);
      assert.equal(error.code, "project_correction_no_reopened_workspaces");
      return true;
    },
  );
});

test("feature 075 correction revalidation reuses validate and corrected finalization publishes v2 without mutating v1", async () => {
  const context = await createCorrectionWorkflowContext();
  const sourceAssetId = await createProjectPhotoAsset({
    context,
    workspaceId: context.defaultWorkspaceId,
    originalFilename: "correction-release.jpg",
  });

  for (const workspaceId of [context.defaultWorkspaceId, context.secondWorkspaceId]) {
    await handoffAndValidateWorkspace({ context, workspaceId });
  }

  const initialFinalize = await finalizeProject({
    supabase: adminClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    projectId: context.projectId,
  });
  assert.equal(initialFinalize.projectWorkflow.workflowState, "finalized");

  const firstRelease = await ensureProjectReleaseSnapshot({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    actorUserId: context.reviewerUserId,
  });
  assert.equal(firstRelease.releaseVersion, 1);

  const { data: firstReleaseAssets, error: firstReleaseAssetsError } = await adminClient
    .from("project_release_assets")
    .select("id, release_id, source_asset_id")
    .eq("tenant_id", context.tenantId)
    .eq("release_id", firstRelease.id);
  assertNoPostgrestError(firstReleaseAssetsError, "select feature 075 first release assets");
  assert.equal(firstReleaseAssets?.length, 1);
  const firstReleaseAssetId = firstReleaseAssets?.[0]?.id ?? null;
  assert.ok(firstReleaseAssetId);

  await startProjectCorrection({
    supabase: adminClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    projectId: context.projectId,
  });

  const reopen = await reopenWorkspaceForCorrection({
    supabase: adminClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    projectId: context.projectId,
    workspaceId: context.defaultWorkspaceId,
  });
  assert.equal(reopen.changed, true);
  assert.equal(reopen.workspace.workflow_state, "handed_off");
  assert.equal(reopen.projectWorkflow.hasCorrectionReopenedWorkspaces, true);
  assert.equal(reopen.projectWorkflow.workflowState, "correction_open");

  await assert.rejects(
    Promise.resolve().then(() =>
      assertWorkspaceCorrectionReviewMutationAllowed({
        project: {
          id: context.projectId,
          status: "active",
          finalized_at: initialFinalize.projectWorkflow.finalizedAt,
          finalized_by: context.reviewerUserId,
          correction_state: "none",
          correction_opened_at: null,
          correction_opened_by: null,
          correction_source_release_id: null,
          correction_reason: null,
        },
        workspace: {
          workflow_state: "validated",
        },
      }),
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 409);
      assert.equal(error.code, "project_finalized");
      return true;
    },
  );

  assert.doesNotThrow(() =>
    assertWorkspaceCorrectionReviewMutationAllowed({
      project: {
        id: context.projectId,
        status: "active",
        finalized_at: initialFinalize.projectWorkflow.finalizedAt,
        finalized_by: context.reviewerUserId,
        correction_state: "open",
        correction_opened_at: reopen.projectWorkflow.correctionOpenedAt,
        correction_opened_by: reopen.projectWorkflow.correctionOpenedBy,
        correction_source_release_id: reopen.projectWorkflow.correctionSourceReleaseId,
        correction_reason: null,
      },
      workspace: {
        workflow_state: "handed_off",
      },
    }),
  );

  const validateCorrection = await applyWorkspaceWorkflowTransition({
    supabase: adminClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    projectId: context.projectId,
    workspaceId: context.defaultWorkspaceId,
    action: "validate",
  });
  assert.equal(validateCorrection.changed, true);
  assert.equal(validateCorrection.workspace.workflow_state, "validated");
  assert.equal(validateCorrection.projectWorkflow.workflowState, "correction_ready_to_finalize");

  const correctedFinalize = await finalizeProject({
    supabase: adminClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    projectId: context.projectId,
  });
  assert.equal(correctedFinalize.changed, true);
  assert.equal(correctedFinalize.projectWorkflow.workflowState, "finalized");
  assert.equal(correctedFinalize.projectWorkflow.correctionState, "none");
  assert.equal(correctedFinalize.projectWorkflow.hasCorrectionReopenedWorkspaces, false);
  assert.ok(correctedFinalize.projectWorkflow.finalizedAt);
  assert.notEqual(correctedFinalize.projectWorkflow.finalizedAt, initialFinalize.projectWorkflow.finalizedAt);

  const secondRelease = await ensureProjectReleaseSnapshot({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    actorUserId: context.reviewerUserId,
  });
  assert.equal(secondRelease.releaseVersion, 2);
  assert.notEqual(secondRelease.id, firstRelease.id);

  const summaryAfterCorrection = await getProjectWorkflowSummary({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
  });
  assert.equal(summaryAfterCorrection.workflowState, "finalized");
  assert.equal(summaryAfterCorrection.correctionState, "none");
  assert.equal(summaryAfterCorrection.hasCorrectionReopenedWorkspaces, false);

  const { data: releaseRows, error: releaseRowsError } = await adminClient
    .from("project_releases")
    .select("id, release_version, status")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .order("release_version", { ascending: true });
  assertNoPostgrestError(releaseRowsError, "select feature 075 release rows");
  assert.deepEqual(
    (releaseRows ?? []).map((row) => row.release_version),
    [1, 2],
  );
  assert.ok((releaseRows ?? []).every((row) => row.status === "published"));

  const { data: secondReleaseAssets, error: secondReleaseAssetsError } = await adminClient
    .from("project_release_assets")
    .select("release_id, source_asset_id")
    .eq("tenant_id", context.tenantId)
    .eq("release_id", secondRelease.id);
  assertNoPostgrestError(secondReleaseAssetsError, "select feature 075 second release assets");
  assert.equal(secondReleaseAssets?.length, 1);
  assert.equal(secondReleaseAssets?.[0]?.source_asset_id, sourceAssetId);

  const { data: firstReleaseAssetsAfter, error: firstReleaseAssetsAfterError } = await adminClient
    .from("project_release_assets")
    .select("id, release_id, source_asset_id")
    .eq("tenant_id", context.tenantId)
    .eq("release_id", firstRelease.id);
  assertNoPostgrestError(firstReleaseAssetsAfterError, "reselect feature 075 first release assets");
  assert.equal(firstReleaseAssetsAfter?.length, 1);
  assert.equal(firstReleaseAssetsAfter?.[0]?.id, firstReleaseAssetId);
  assert.equal(firstReleaseAssetsAfter?.[0]?.source_asset_id, sourceAssetId);
});
