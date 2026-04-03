import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";

import { getAutoMatchMaterializerVersion } from "../src/lib/matching/auto-match-config";
import { getProjectMatchingProgress } from "../src/lib/matching/project-matching-progress";

type ProjectContext = {
  tenantId: string;
  projectId: string;
  userId: string;
};

function parseDotEnvLine(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function loadEnvFromLocalFile() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  const raw = readFileSync(envPath, "utf8");
  const result = new Map<string, string>();

  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const delimiterIndex = trimmed.indexOf("=");
    if (delimiterIndex <= 0) {
      return;
    }

    const key = trimmed.slice(0, delimiterIndex).trim();
    const value = parseDotEnvLine(trimmed.slice(delimiterIndex + 1));
    result.set(key, value);
  });

  return result;
}

function requireEnv(name: string, envFromFile: Map<string, string>) {
  const runtimeValue = process.env[name];
  if (runtimeValue && runtimeValue.trim().length > 0) {
    return runtimeValue.trim();
  }

  const fileValue = envFromFile.get(name);
  if (fileValue && fileValue.trim().length > 0) {
    return fileValue.trim();
  }

  throw new Error(`Missing required environment variable: ${name}`);
}

function assertNoError(error: PostgrestError | null, context: string) {
  if (!error) {
    return;
  }

  assert.fail(`${context}: ${error.code} ${error.message}`);
}

const envFromFile = loadEnvFromLocalFile();
const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL", envFromFile);
const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY", envFromFile);

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

function withPipelineMode(mode: "materialized_apply") {
  const original = process.env.AUTO_MATCH_PIPELINE_MODE;
  process.env.AUTO_MATCH_PIPELINE_MODE = mode;

  return () => {
    if (typeof original === "undefined") {
      delete process.env.AUTO_MATCH_PIPELINE_MODE;
    } else {
      process.env.AUTO_MATCH_PIPELINE_MODE = original;
    }
  };
}

async function createAuthUserWithRetry(supabase: SupabaseClient) {
  const maxAttempts = 6;
  let lastError: { message?: string; code?: string } | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const email = `feature021-${randomUUID()}@example.com`;
    const password = `SnapConsent-${randomUUID()}-A1!`;
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (!error && data.user?.id) {
      return data.user.id;
    }

    lastError = error;
    if (error?.code !== "unexpected_failure" || attempt === maxAttempts) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
  }

  assert.fail(
    `Unable to create auth user for tests: ${lastError?.code ?? "unknown"} ${lastError?.message ?? "no error message"}`,
  );
}

async function createProjectContext(supabase: SupabaseClient): Promise<ProjectContext> {
  const userId = await createAuthUserWithRetry(supabase);

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert({ name: `Feature 021 Tenant ${randomUUID()}` })
    .select("id")
    .single();
  assertNoError(tenantError, "insert tenant");

  const { error: membershipError } = await supabase.from("memberships").insert({
    tenant_id: tenant.id,
    user_id: userId,
    role: "owner",
  });
  assertNoError(membershipError, "insert membership");

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({
      tenant_id: tenant.id,
      created_by: userId,
      name: `Feature 021 Project ${randomUUID()}`,
      description: "Feature 021 matching progress tests",
      status: "active",
    })
    .select("id")
    .single();
  assertNoError(projectError, "insert project");

  return {
    tenantId: tenant.id,
    projectId: project.id,
    userId,
  };
}

async function createPhotoAsset(supabase: SupabaseClient, context: ProjectContext) {
  const nowIso = new Date().toISOString();
  const { data: asset, error } = await supabase
    .from("assets")
    .insert({
      tenant_id: context.tenantId,
      project_id: context.projectId,
      created_by: context.userId,
      storage_bucket: "project-assets",
      storage_path: `tenant/${context.tenantId}/project/${context.projectId}/asset/${randomUUID()}/test.jpg`,
      original_filename: `photo-${randomUUID()}.jpg`,
      content_type: "image/jpeg",
      file_size_bytes: 2048,
      status: "uploaded",
      uploaded_at: nowIso,
      asset_type: "photo",
    })
    .select("id")
    .single();
  assertNoError(error, "insert photo asset");
  return asset.id;
}

async function createPhotoAssets(supabase: SupabaseClient, context: ProjectContext, count: number) {
  if (count <= 0) {
    return [] as string[];
  }

  const nowIso = new Date().toISOString();
  const rows = Array.from({ length: count }, () => ({
    tenant_id: context.tenantId,
    project_id: context.projectId,
    created_by: context.userId,
    storage_bucket: "project-assets",
    storage_path: `tenant/${context.tenantId}/project/${context.projectId}/asset/${randomUUID()}/test.jpg`,
    original_filename: `photo-${randomUUID()}.jpg`,
    content_type: "image/jpeg",
    file_size_bytes: 2048,
    status: "uploaded",
    uploaded_at: nowIso,
    asset_type: "photo",
  }));

  const { data, error } = await supabase.from("assets").insert(rows).select("id");
  assertNoError(error, "insert photo assets");
  return ((data ?? []) as Array<{ id: string }>).map((row) => row.id);
}

test("materialized pipeline progress counts current photo materializations and active jobs", async () => {
  const restorePipelineMode = withPipelineMode("materialized_apply");

  try {
    const context = await createProjectContext(admin);
    const firstPhotoId = await createPhotoAsset(admin, context);
    const secondPhotoId = await createPhotoAsset(admin, context);
    const thirdPhotoId = await createPhotoAsset(admin, context);

    const materializerVersion = getAutoMatchMaterializerVersion();
    const { error: materializationError } = await admin.from("asset_face_materializations").insert([
      {
        tenant_id: context.tenantId,
        project_id: context.projectId,
        asset_id: firstPhotoId,
        asset_type: "photo",
        materializer_version: materializerVersion,
        provider: "test-provider",
        provider_mode: "detection",
        provider_plugin_versions: null,
        face_count: 1,
        usable_for_compare: true,
      },
      {
        tenant_id: context.tenantId,
        project_id: context.projectId,
        asset_id: secondPhotoId,
        asset_type: "photo",
        materializer_version: materializerVersion,
        provider: "test-provider",
        provider_mode: "detection",
        provider_plugin_versions: null,
        face_count: 0,
        usable_for_compare: true,
      },
    ]);
    assertNoError(materializationError, "insert photo materializations");

    const { error: jobError } = await admin.from("face_match_jobs").insert({
      tenant_id: context.tenantId,
      project_id: context.projectId,
      scope_asset_id: thirdPhotoId,
      job_type: "materialize_asset_faces",
      dedupe_key: `feature021:materialize:${thirdPhotoId}`,
      status: "queued",
    });
    assertNoError(jobError, "insert queued materialize job");

    const progress = await getProjectMatchingProgress(admin, context.tenantId, context.projectId);
    assert.equal(progress.totalImages, 3);
    assert.equal(progress.processedImages, 2);
    assert.equal(progress.progressPercent, 67);
    assert.equal(progress.isMatchingInProgress, true);
    assert.equal(progress.hasDegradedMatchingState, false);
  } finally {
    restorePipelineMode();
  }
});

test("materialized pipeline progress handles large projects without URI-length fanout", async () => {
  const restorePipelineMode = withPipelineMode("materialized_apply");

  try {
    const context = await createProjectContext(admin);
    const photoIds = await createPhotoAssets(admin, context, 360);
    const materializerVersion = getAutoMatchMaterializerVersion();

    const { error: materializationError } = await admin.from("asset_face_materializations").insert(
      photoIds.slice(0, 240).map((assetId) => ({
        tenant_id: context.tenantId,
        project_id: context.projectId,
        asset_id: assetId,
        asset_type: "photo",
        materializer_version: materializerVersion,
        provider: "test-provider",
        provider_mode: "detection",
        provider_plugin_versions: null,
        face_count: 1,
        usable_for_compare: true,
      })),
    );
    assertNoError(materializationError, "insert large photo materializations");

    const { error: jobError } = await admin.from("face_match_jobs").insert({
      tenant_id: context.tenantId,
      project_id: context.projectId,
      scope_asset_id: photoIds[240],
      job_type: "materialize_asset_faces",
      dedupe_key: `feature021:large-materialized:${photoIds[240]}`,
      status: "queued",
    });
    assertNoError(jobError, "insert queued materialize job");

    const progress = await getProjectMatchingProgress(admin, context.tenantId, context.projectId);
    assert.equal(progress.totalImages, 360);
    assert.equal(progress.processedImages, 240);
    assert.equal(progress.progressPercent, 67);
    assert.equal(progress.isMatchingInProgress, true);
    assert.equal(progress.hasDegradedMatchingState, false);
  } finally {
    restorePipelineMode();
  }
});

test("materialized pipeline progress ignores stale processing jobs but counts valid leases as active", async () => {
  const restorePipelineMode = withPipelineMode("materialized_apply");

  try {
    const staleContext = await createProjectContext(admin);
    const stalePhotoId = await createPhotoAsset(admin, staleContext);
    const staleIso = new Date(Date.now() - 5 * 60_000).toISOString();

    const { error: staleJobError } = await admin.from("face_match_jobs").insert({
      tenant_id: staleContext.tenantId,
      project_id: staleContext.projectId,
      scope_asset_id: stalePhotoId,
      job_type: "materialize_asset_faces",
      dedupe_key: `feature021:stale:${stalePhotoId}`,
      status: "processing",
      locked_by: "feature021-stale-worker",
      locked_at: staleIso,
      started_at: staleIso,
      lease_expires_at: staleIso,
    });
    assertNoError(staleJobError, "insert stale processing job");

    const staleProgress = await getProjectMatchingProgress(admin, staleContext.tenantId, staleContext.projectId);
    assert.equal(staleProgress.totalImages, 1);
    assert.equal(staleProgress.processedImages, 0);
    assert.equal(staleProgress.isMatchingInProgress, false);
    assert.equal(staleProgress.hasDegradedMatchingState, false);

    const activeContext = await createProjectContext(admin);
    const activePhotoId = await createPhotoAsset(admin, activeContext);
    const futureIso = new Date(Date.now() + 5 * 60_000).toISOString();

    const { error: activeJobError } = await admin.from("face_match_jobs").insert({
      tenant_id: activeContext.tenantId,
      project_id: activeContext.projectId,
      scope_asset_id: activePhotoId,
      job_type: "materialize_asset_faces",
      dedupe_key: `feature021:active:${activePhotoId}`,
      status: "processing",
      locked_by: "feature021-active-worker",
      locked_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      lease_expires_at: futureIso,
    });
    assertNoError(activeJobError, "insert active processing job");

    const activeProgress = await getProjectMatchingProgress(admin, activeContext.tenantId, activeContext.projectId);
    assert.equal(activeProgress.totalImages, 1);
    assert.equal(activeProgress.processedImages, 0);
    assert.equal(activeProgress.isMatchingInProgress, true);
    assert.equal(activeProgress.hasDegradedMatchingState, false);
  } finally {
    restorePipelineMode();
  }
});

test("materialized pipeline progress exposes degraded queued continuations", async () => {
  const restorePipelineMode = withPipelineMode("materialized_apply");

  try {
    const context = await createProjectContext(admin);
    const photoId = await createPhotoAsset(admin, context);
    const materializerVersion = getAutoMatchMaterializerVersion();

    const { data: materialization, error: materializationError } = await admin
      .from("asset_face_materializations")
      .insert({
        tenant_id: context.tenantId,
        project_id: context.projectId,
        asset_id: photoId,
        asset_type: "photo",
        materializer_version: materializerVersion,
        provider: "test-provider",
        provider_mode: "detection",
        provider_plugin_versions: null,
        face_count: 1,
        usable_for_compare: true,
      })
      .select("id")
      .single();
    assertNoError(materializationError, "insert continuation materialization");

    const { error: continuationError } = await admin.from("face_match_fanout_continuations").insert({
      tenant_id: context.tenantId,
      project_id: context.projectId,
      direction: "photo_to_headshots",
      source_asset_id: photoId,
      source_materialization_id: materialization.id,
      source_materializer_version: materializerVersion,
      compare_version: "feature021-progress",
      boundary_snapshot_at: new Date().toISOString(),
      dispatch_mode: "normal",
      status: "queued",
      attempt_count: 6,
      max_attempts: 50,
      run_after: new Date(Date.now() + 60_000).toISOString(),
      last_error_code: "face_match_enqueue_failed",
      last_error_message: "queued retry",
      last_error_at: new Date().toISOString(),
    });
    assertNoError(continuationError, "insert degraded continuation");

    const progress = await getProjectMatchingProgress(admin, context.tenantId, context.projectId);
    assert.equal(progress.totalImages, 1);
    assert.equal(progress.processedImages, 1);
    assert.equal(progress.isMatchingInProgress, true);
    assert.equal(progress.hasDegradedMatchingState, true);
  } finally {
    restorePipelineMode();
  }
});

test("materialized pipeline progress exposes dead continuations as degraded without active work", async () => {
  const restorePipelineMode = withPipelineMode("materialized_apply");

  try {
    const context = await createProjectContext(admin);
    const photoId = await createPhotoAsset(admin, context);
    const materializerVersion = getAutoMatchMaterializerVersion();

    const { data: materialization, error: materializationError } = await admin
      .from("asset_face_materializations")
      .insert({
        tenant_id: context.tenantId,
        project_id: context.projectId,
        asset_id: photoId,
        asset_type: "photo",
        materializer_version: materializerVersion,
        provider: "test-provider",
        provider_mode: "detection",
        provider_plugin_versions: null,
        face_count: 1,
        usable_for_compare: true,
      })
      .select("id")
      .single();
    assertNoError(materializationError, "insert dead continuation materialization");

    const { error: continuationError } = await admin.from("face_match_fanout_continuations").insert({
      tenant_id: context.tenantId,
      project_id: context.projectId,
      direction: "photo_to_headshots",
      source_asset_id: photoId,
      source_materialization_id: materialization.id,
      source_materializer_version: materializerVersion,
      compare_version: "feature021-progress-dead",
      boundary_snapshot_at: new Date().toISOString(),
      dispatch_mode: "normal",
      status: "dead",
      attempt_count: 50,
      max_attempts: 50,
      run_after: new Date().toISOString(),
      completed_at: new Date().toISOString(),
      last_error_code: "face_match_fanout_invariant_failed",
      last_error_message: "dead continuation",
      last_error_at: new Date().toISOString(),
    });
    assertNoError(continuationError, "insert dead continuation");

    const progress = await getProjectMatchingProgress(admin, context.tenantId, context.projectId);
    assert.equal(progress.totalImages, 1);
    assert.equal(progress.processedImages, 1);
    assert.equal(progress.isMatchingInProgress, false);
    assert.equal(progress.hasDegradedMatchingState, true);
  } finally {
    restorePipelineMode();
  }
});


test("project progress returns zeroes for projects without uploaded photos", async () => {
  const restorePipelineMode = withPipelineMode("materialized_apply");

  try {
    const context = await createProjectContext(admin);
    const progress = await getProjectMatchingProgress(admin, context.tenantId, context.projectId);
    assert.equal(progress.totalImages, 0);
    assert.equal(progress.processedImages, 0);
    assert.equal(progress.progressPercent, 0);
    assert.equal(progress.isMatchingInProgress, false);
    assert.equal(progress.hasDegradedMatchingState, false);
  } finally {
    restorePipelineMode();
  }
});
