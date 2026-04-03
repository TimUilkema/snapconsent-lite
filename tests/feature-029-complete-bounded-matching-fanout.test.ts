import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";

import { submitConsent } from "../src/lib/consent/submit-consent";
import { HttpError } from "../src/lib/http/errors";
import {
  __setFanoutContinuationTestHooks,
  FACE_MATCH_FANOUT_CONTINUATION_MAX_ATTEMPTS,
  getCurrentConsentHeadshotFanoutBoundary,
  getPhotoFanoutBoundary,
} from "../src/lib/matching/auto-match-fanout-continuations";
import {
  enqueueCompareMaterializedPairJob,
  enqueueConsentHeadshotReadyJob,
  enqueueMaterializeAssetFacesJob,
  enqueuePhotoUploadedJob,
} from "../src/lib/matching/auto-match-jobs";
import type { AutoMatcher, AutoMatcherMaterializedFace } from "../src/lib/matching/auto-matcher";
import { getAutoMatchCompareVersion, getAutoMatchMaterializerVersion } from "../src/lib/matching/auto-match-config";
import { ensureAssetFaceMaterialization } from "../src/lib/matching/face-materialization";
import { ensureMaterializedFaceCompare } from "../src/lib/matching/materialized-face-compare";
import { getProjectMatchingProgress } from "../src/lib/matching/project-matching-progress";
import { runAutoMatchWorker } from "../src/lib/matching/auto-match-worker";

type ProjectContext = {
  tenantId: string;
  projectId: string;
  userId: string;
  consentTemplateId: string;
};

type TestFace = {
  faceRank: number;
  similarity: number;
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

    result.set(trimmed.slice(0, delimiterIndex).trim(), parseDotEnvLine(trimmed.slice(delimiterIndex + 1)));
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

async function createAuthUserWithRetry(supabase: SupabaseClient) {
  const maxAttempts = 6;
  let lastError: { message?: string; code?: string } | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: `feature029-${randomUUID()}@example.com`,
      password: `SnapConsent-${randomUUID()}-A1!`,
      email_confirm: true,
    });

    if (!error && data.user?.id) {
      return data.user.id;
    }

    lastError = error;
    if (error?.code !== "unexpected_failure" || attempt === maxAttempts) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, attempt * 300));
  }

  assert.fail(`Unable to create auth user for tests: ${lastError?.code ?? "unknown"} ${lastError?.message ?? "fetch failed"}`);
}

async function createProjectContext(supabase: SupabaseClient): Promise<ProjectContext> {
  const userId = await createAuthUserWithRetry(supabase);

  const { data: tenant, error: tenantError } = await supabase.from("tenants").insert({
    name: `Feature 029 Tenant ${randomUUID()}`,
  }).select("id").single();
  assertNoError(tenantError, "insert tenant");

  const { error: membershipError } = await supabase.from("memberships").insert({
    tenant_id: tenant.id,
    user_id: userId,
    role: "owner",
  });
  assertNoError(membershipError, "insert membership");

  const { data: project, error: projectError } = await supabase.from("projects").insert({
    tenant_id: tenant.id,
    created_by: userId,
    name: `Feature 029 Project ${randomUUID()}`,
    description: "Feature 029 bounded fan-out tests",
    status: "active",
  }).select("id").single();
  assertNoError(projectError, "insert project");

  const templateKey = `feature029-template-${randomUUID()}`;
  const { data: template, error: templateError } = await supabase.from("consent_templates").insert({
    template_key: templateKey,
    version: "v1",
    body: "Feature 029 template body",
    status: "active",
    created_by: userId,
  }).select("id").single();
  assertNoError(templateError, "insert consent template");

  return {
    tenantId: tenant.id,
    projectId: project.id,
    userId,
    consentTemplateId: template.id,
  };
}

async function createInviteToken(supabase: SupabaseClient, context: ProjectContext) {
  const token = `feature029-invite-${randomUUID()}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const { error } = await supabase.from("subject_invites").insert({
    tenant_id: context.tenantId,
    project_id: context.projectId,
    created_by: context.userId,
    token_hash: tokenHash,
    status: "active",
    max_uses: 1,
    consent_template_id: context.consentTemplateId,
  });
  assertNoError(error, "insert invite");
  return token;
}

async function createAsset(
  supabase: SupabaseClient,
  context: ProjectContext,
  options: {
    assetType: "photo" | "headshot";
    retentionDays?: number;
  },
) {
  const nowIso = new Date().toISOString();
  const { data, error } = await supabase.from("assets").insert({
    tenant_id: context.tenantId,
    project_id: context.projectId,
    created_by: context.userId,
    storage_bucket: "project-assets",
    storage_path: `tenant/${context.tenantId}/project/${context.projectId}/asset/${randomUUID()}/test.jpg`,
    original_filename: `${options.assetType}-${randomUUID()}.jpg`,
    content_type: "image/jpeg",
    file_size_bytes: 2048,
    content_hash: randomUUID().replaceAll("-", ""),
    content_hash_algo: "sha256",
    status: "uploaded",
    uploaded_at: nowIso,
    asset_type: options.assetType,
    retention_expires_at:
      options.assetType === "headshot" && options.retentionDays
        ? new Date(Date.now() + options.retentionDays * 24 * 60 * 60 * 1000).toISOString()
        : null,
  }).select("id").single();
  assertNoError(error, "insert asset");
  return data.id as string;
}

async function createOptedInConsentWithHeadshot(
  supabase: SupabaseClient,
  context: ProjectContext,
  headshotAssetId?: string,
) {
  const token = await createInviteToken(supabase, context);
  const resolvedHeadshotAssetId =
    headshotAssetId ??
    (await createAsset(supabase, context, {
      assetType: "headshot",
      retentionDays: 30,
    }));

  const consent = await submitConsent({
    supabase,
    token,
    fullName: "Feature 029 Subject",
    email: `subject-${randomUUID()}@example.com`,
    faceMatchOptIn: true,
    headshotAssetId: resolvedHeadshotAssetId,
    captureIp: null,
    captureUserAgent: "feature-029-test",
  });

  return {
    consentId: consent.consentId,
    headshotAssetId: resolvedHeadshotAssetId,
  };
}

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

function createMaterializedMatcher(facesByAssetId: Record<string, TestFace[]>): AutoMatcher {
  return {
    version: "feature-029-materialized-test",
    async match() {
      assert.fail("raw matcher path should not be used in Feature 029 tests");
    },
    async materializeAssetFaces(input) {
      const faces = (facesByAssetId[input.assetId] ?? []).map((face) => ({
        faceRank: face.faceRank,
        providerFaceIndex: face.faceRank,
        detectionProbability: 0.99,
        faceBox: {
          xMin: face.faceRank * 10,
          yMin: face.faceRank * 10,
          xMax: face.faceRank * 10 + 40,
          yMax: face.faceRank * 10 + 50,
          probability: 0.99,
        },
        embedding: [face.similarity, face.faceRank],
      })) satisfies AutoMatcherMaterializedFace[];

      return {
        faces,
        providerMetadata: {
          provider: "test-provider",
          providerMode: "detection",
          providerPluginVersions: {
            detector: "retinaface-test",
            calculator: "embedding-test",
          },
        },
      };
    },
    async compareEmbeddings(input) {
      return {
        targetSimilarities: input.targetEmbeddings.map((embedding) => Number(embedding[0] ?? 0)),
        providerMetadata: {
          provider: "test-provider",
          providerMode: "verification_embeddings",
          providerPluginVersions: {
            calculator: "embedding-test",
          },
        },
      };
    },
  };
}

async function runWorkerOnce(
  matcher: AutoMatcher,
  maxComparisonsPerJob = 2,
) {
  return runAutoMatchWorker({
    workerId: `feature-029-worker-${randomUUID()}`,
    batchSize: 20,
    confidenceThreshold: 0.92,
    reviewMinConfidence: 0.3,
    persistResults: true,
    persistFaceEvidence: true,
    matcher,
    maxComparisonsPerJob,
    supabase: admin,
  });
}

async function drainMatchingQueue(
  matcher: AutoMatcher,
  maxComparisonsPerJob = 2,
) {
  let iterations = 0;
  let totalClaimed = 0;

  while (iterations < 20) {
    const result = await runWorkerOnce(matcher, maxComparisonsPerJob);
    iterations += 1;
    totalClaimed += result.claimed;
    if (result.claimed === 0) {
      return { iterations, totalClaimed };
    }
  }

  assert.fail("Feature 029 queue did not drain within 20 iterations");
}

async function countRows(table: string, filters: Array<[column: string, value: string]>) {
  let query = admin.from(table).select("*", { count: "exact", head: true });
  for (const [column, value] of filters) {
    query = query.eq(column, value);
  }

  const { count, error } = await query;
  assertNoError(error, `count ${table}`);
  return count ?? 0;
}

async function getContinuationStatuses(context: ProjectContext, consentId?: string) {
  let query = admin
    .from("face_match_fanout_continuations")
    .select("direction, status, source_consent_id, source_asset_id")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId);

  if (consentId) {
    query = query.eq("source_consent_id", consentId);
  }

  const { data, error } = await query;
  assertNoError(error, "select continuations");
  return data ?? [];
}

type FanoutContinuationStateRow = {
  id: string;
  status: string;
  attempt_count: number;
  max_attempts: number;
  last_error_code: string | null;
  cursor_sort_at: string | null;
  cursor_asset_id: string | null;
  cursor_consent_id: string | null;
  run_after: string;
  source_asset_id: string;
  source_consent_id: string | null;
};

async function getFanoutContinuationRows(
  context: ProjectContext,
  sourceConsentId?: string,
) {
  let query = admin
    .from("face_match_fanout_continuations")
    .select(
      "id, status, attempt_count, max_attempts, last_error_code, cursor_sort_at, cursor_asset_id, cursor_consent_id, run_after, source_asset_id, source_consent_id",
    )
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .order("created_at", { ascending: true });

  if (sourceConsentId) {
    query = query.eq("source_consent_id", sourceConsentId);
  }

  const { data, error } = await query;
  assertNoError(error, "select continuation state");
  return ((data ?? []) as FanoutContinuationStateRow[]) ?? [];
}

async function setQueuedJobsRunAfter(
  context: ProjectContext,
  jobType: "compare_materialized_pair" | "materialize_asset_faces",
  runAfter: string,
) {
  const { error } = await admin
    .from("face_match_jobs")
    .update({ run_after: runAfter })
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("job_type", jobType)
    .eq("status", "queued");
  assertNoError(error, `defer ${jobType} jobs`);
}

async function setQueuedContinuationsRunAfter(
  context: ProjectContext,
  runAfter: string,
  sourceConsentId?: string,
) {
  let query = admin
    .from("face_match_fanout_continuations")
    .update({ run_after: runAfter })
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("status", "queued");

  if (sourceConsentId) {
    query = query.eq("source_consent_id", sourceConsentId);
  }

  const { error } = await query;
  assertNoError(error, "defer queued continuations");
}

async function getFaceMatchJobs(
  context: ProjectContext,
  jobType: "compare_materialized_pair" | "materialize_asset_faces",
) {
  const { data, error } = await admin
    .from("face_match_jobs")
    .select("id, status, requeue_count, attempt_count, run_after")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("job_type", jobType)
    .order("created_at", { ascending: true });
  assertNoError(error, `select ${jobType} jobs`);
  return (data ?? []) as Array<{
    id: string;
    status: string;
    requeue_count: number;
    attempt_count: number;
    run_after: string;
  }>;
}

async function replaceConsentHeadshot(
  context: ProjectContext,
  consentId: string,
  oldHeadshotAssetId: string,
  newHeadshotAssetId: string,
) {
  const { error: deleteError } = await admin
    .from("asset_consent_links")
    .delete()
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("consent_id", consentId)
    .eq("asset_id", oldHeadshotAssetId);
  assertNoError(deleteError, "delete old headshot link");

  const { error: insertError } = await admin.from("asset_consent_links").upsert(
    {
      asset_id: newHeadshotAssetId,
      consent_id: consentId,
      tenant_id: context.tenantId,
      project_id: context.projectId,
      link_source: "manual",
      match_confidence: null,
      matched_at: null,
      reviewed_at: null,
      reviewed_by: null,
      matcher_version: null,
    },
    { onConflict: "asset_id,consent_id" },
  );
  assertNoError(insertError, "insert replacement headshot link");
}

async function enqueueHeadshotReadyWithBoundary(context: ProjectContext, consentId: string, headshotAssetId: string, source: string) {
  const boundary = await getPhotoFanoutBoundary(admin, context.tenantId, context.projectId);
  await enqueueConsentHeadshotReadyJob({
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId,
    headshotAssetId,
    payload: {
      source,
      headshotAssetId,
      boundarySnapshotAt: boundary.boundarySnapshotAt,
      boundaryPhotoUploadedAt: boundary.boundaryPhotoUploadedAt,
      boundaryPhotoAssetId: boundary.boundaryPhotoAssetId,
    },
    supabase: admin,
  });
}

test("photo-side bounded continuation reaches all in-boundary consent headshots across multiple worker runs without re-comparing existing versioned pairs", async () => {
  const restorePipelineMode = withPipelineMode("materialized_apply");

  try {
    const context = await createProjectContext(admin);
    const photoAssetId = await createAsset(admin, context, { assetType: "photo" });
    const consents = await Promise.all(
      Array.from({ length: 5 }, async (_, index) => {
        const headshotAssetId = await createAsset(admin, context, {
          assetType: "headshot",
          retentionDays: 30,
        });
        return {
          ...(await createOptedInConsentWithHeadshot(admin, context, headshotAssetId)),
          similarity: 0.9 + index * 0.01,
        };
      }),
    );

    const matcher = createMaterializedMatcher({
      [photoAssetId]: [{ faceRank: 0, similarity: 0.98 }],
      ...Object.fromEntries(consents.map((row) => [row.headshotAssetId, [{ faceRank: 0, similarity: row.similarity }]])),
    });

    const photoMaterialization = await ensureAssetFaceMaterialization({
      supabase: admin,
      matcher,
      tenantId: context.tenantId,
      projectId: context.projectId,
      assetId: photoAssetId,
      materializerVersion: getAutoMatchMaterializerVersion(),
      includeFaces: false,
    });
    assert.ok(photoMaterialization);

    for (const consent of consents) {
      await ensureAssetFaceMaterialization({
        supabase: admin,
        matcher,
        tenantId: context.tenantId,
        projectId: context.projectId,
        assetId: consent.headshotAssetId,
        materializerVersion: getAutoMatchMaterializerVersion(),
        includeFaces: false,
      });
    }

    await ensureMaterializedFaceCompare({
      supabase: admin,
      matcher,
      tenantId: context.tenantId,
      projectId: context.projectId,
      consentId: consents[0]!.consentId,
      assetId: photoAssetId,
      headshotMaterializationId: (
        await ensureAssetFaceMaterialization({
          supabase: admin,
          matcher,
          tenantId: context.tenantId,
          projectId: context.projectId,
          assetId: consents[0]!.headshotAssetId,
          materializerVersion: getAutoMatchMaterializerVersion(),
          includeFaces: false,
        })
      )!.materialization.id,
      assetMaterializationId: photoMaterialization!.materialization.id,
      compareVersion: getAutoMatchCompareVersion(),
    });

    const boundary = await getCurrentConsentHeadshotFanoutBoundary(admin, context.tenantId, context.projectId);
    await enqueuePhotoUploadedJob({
      tenantId: context.tenantId,
      projectId: context.projectId,
      assetId: photoAssetId,
      payload: {
        source: "feature029_photo_multibatch",
        boundarySnapshotAt: boundary.boundarySnapshotAt,
        boundaryConsentCreatedAt: boundary.boundaryConsentCreatedAt,
        boundaryConsentId: boundary.boundaryConsentId,
      },
      supabase: admin,
    });

    const drain = await drainMatchingQueue(matcher, 2);
    assert.ok(drain.iterations > 2);
    assert.equal(
      await countRows("asset_consent_face_compares", [
        ["tenant_id", context.tenantId],
        ["project_id", context.projectId],
      ]),
      5,
    );
  } finally {
    restorePipelineMode();
  }
});

test("headshot-side bounded continuation reaches all in-boundary photos across multiple worker runs", async () => {
  const restorePipelineMode = withPipelineMode("materialized_apply");

  try {
    const context = await createProjectContext(admin);
    const photoAssetIds = await Promise.all(
      Array.from({ length: 5 }, () => createAsset(admin, context, { assetType: "photo" })),
    );
    const consent = await createOptedInConsentWithHeadshot(admin, context);

    const matcher = createMaterializedMatcher({
      [consent.headshotAssetId]: [{ faceRank: 0, similarity: 0.2 }],
      ...Object.fromEntries(photoAssetIds.map((assetId, index) => [assetId, [{ faceRank: 0, similarity: 0.93 + index * 0.01 }]])),
    });

    for (const photoAssetId of photoAssetIds) {
      await ensureAssetFaceMaterialization({
        supabase: admin,
        matcher,
        tenantId: context.tenantId,
        projectId: context.projectId,
        assetId: photoAssetId,
        materializerVersion: getAutoMatchMaterializerVersion(),
        includeFaces: false,
      });
    }

    const boundary = await getPhotoFanoutBoundary(admin, context.tenantId, context.projectId);
    await enqueueConsentHeadshotReadyJob({
      tenantId: context.tenantId,
      projectId: context.projectId,
      consentId: consent.consentId,
      headshotAssetId: consent.headshotAssetId,
      payload: {
        source: "feature029_headshot_multibatch",
        headshotAssetId: consent.headshotAssetId,
        boundarySnapshotAt: boundary.boundarySnapshotAt,
        boundaryPhotoUploadedAt: boundary.boundaryPhotoUploadedAt,
        boundaryPhotoAssetId: boundary.boundaryPhotoAssetId,
      },
      supabase: admin,
    });

    const drain = await drainMatchingQueue(matcher, 2);
    assert.ok(drain.iterations > 2);
    assert.equal(
      await countRows("asset_consent_face_compares", [
        ["tenant_id", context.tenantId],
        ["project_id", context.projectId],
      ]),
      5,
    );
  } finally {
    restorePipelineMode();
  }
});

test("continuation batches are crash-safe and recover without duplicate compare rows", async () => {
  const restorePipelineMode = withPipelineMode("materialized_apply");

  try {
    const context = await createProjectContext(admin);
    const photoAssetIds = await Promise.all(
      Array.from({ length: 3 }, () => createAsset(admin, context, { assetType: "photo" })),
    );
    const consent = await createOptedInConsentWithHeadshot(admin, context);

    const matcher = createMaterializedMatcher({
      [consent.headshotAssetId]: [{ faceRank: 0, similarity: 0.24 }],
      ...Object.fromEntries(photoAssetIds.map((assetId, index) => [assetId, [{ faceRank: 0, similarity: 0.94 + index * 0.01 }]])),
    });

    for (const photoAssetId of photoAssetIds) {
      await ensureAssetFaceMaterialization({
        supabase: admin,
        matcher,
        tenantId: context.tenantId,
        projectId: context.projectId,
        assetId: photoAssetId,
        materializerVersion: getAutoMatchMaterializerVersion(),
        includeFaces: false,
      });
    }

    const boundary = await getPhotoFanoutBoundary(admin, context.tenantId, context.projectId);
    await enqueueConsentHeadshotReadyJob({
      tenantId: context.tenantId,
      projectId: context.projectId,
      consentId: consent.consentId,
      headshotAssetId: consent.headshotAssetId,
      payload: {
        source: "feature029_crash_recovery",
        headshotAssetId: consent.headshotAssetId,
        boundarySnapshotAt: boundary.boundarySnapshotAt,
        boundaryPhotoUploadedAt: boundary.boundaryPhotoUploadedAt,
        boundaryPhotoAssetId: boundary.boundaryPhotoAssetId,
      },
      supabase: admin,
    });

    let injectedFailure = false;
    __setFanoutContinuationTestHooks({
      beforeBatchFinalize() {
        if (!injectedFailure) {
          injectedFailure = true;
          throw new Error("feature029 injected crash before cursor advance");
        }
      },
    });

    await runWorkerOnce(matcher, 2);
    await runWorkerOnce(matcher, 2);
    __setFanoutContinuationTestHooks(null);

    await drainMatchingQueue(matcher, 2);
    assert.equal(
      await countRows("asset_consent_face_compares", [
        ["tenant_id", context.tenantId],
        ["project_id", context.projectId],
      ]),
      3,
    );
  } finally {
    __setFanoutContinuationTestHooks(null);
    restorePipelineMode();
  }
});

test("headshot replacement supersedes the old continuation and creates a new valid backfill", async () => {
  const restorePipelineMode = withPipelineMode("materialized_apply");

  try {
    const context = await createProjectContext(admin);
    const photoAssetIds = await Promise.all(
      Array.from({ length: 4 }, () => createAsset(admin, context, { assetType: "photo" })),
    );
    const consent = await createOptedInConsentWithHeadshot(admin, context);
    const replacementHeadshotAssetId = await createAsset(admin, context, {
      assetType: "headshot",
      retentionDays: 30,
    });

    const matcher = createMaterializedMatcher({
      [consent.headshotAssetId]: [{ faceRank: 0, similarity: 0.18 }],
      [replacementHeadshotAssetId]: [{ faceRank: 0, similarity: 0.17 }],
      ...Object.fromEntries(photoAssetIds.map((assetId, index) => [assetId, [{ faceRank: 0, similarity: 0.95 + index * 0.01 }]])),
    });

    for (const photoAssetId of photoAssetIds) {
      await ensureAssetFaceMaterialization({
        supabase: admin,
        matcher,
        tenantId: context.tenantId,
        projectId: context.projectId,
        assetId: photoAssetId,
        materializerVersion: getAutoMatchMaterializerVersion(),
        includeFaces: false,
      });
    }

    const originalBoundary = await getPhotoFanoutBoundary(admin, context.tenantId, context.projectId);
    await enqueueConsentHeadshotReadyJob({
      tenantId: context.tenantId,
      projectId: context.projectId,
      consentId: consent.consentId,
      headshotAssetId: consent.headshotAssetId,
      payload: {
        source: "feature029_original_headshot",
        headshotAssetId: consent.headshotAssetId,
        boundarySnapshotAt: originalBoundary.boundarySnapshotAt,
        boundaryPhotoUploadedAt: originalBoundary.boundaryPhotoUploadedAt,
        boundaryPhotoAssetId: originalBoundary.boundaryPhotoAssetId,
      },
      supabase: admin,
    });

    await runWorkerOnce(matcher, 2);
    await runWorkerOnce(matcher, 2);

    await replaceConsentHeadshot(context, consent.consentId, consent.headshotAssetId, replacementHeadshotAssetId);

    const replacementBoundary = await getPhotoFanoutBoundary(admin, context.tenantId, context.projectId);
    await enqueueConsentHeadshotReadyJob({
      tenantId: context.tenantId,
      projectId: context.projectId,
      consentId: consent.consentId,
      headshotAssetId: replacementHeadshotAssetId,
      payload: {
        source: "feature029_replacement_headshot",
        headshotAssetId: replacementHeadshotAssetId,
        boundarySnapshotAt: replacementBoundary.boundarySnapshotAt,
        boundaryPhotoUploadedAt: replacementBoundary.boundaryPhotoUploadedAt,
        boundaryPhotoAssetId: replacementBoundary.boundaryPhotoAssetId,
      },
      supabase: admin,
    });

    await drainMatchingQueue(matcher, 2);

    const statuses = await getContinuationStatuses(context, consent.consentId);
    assert.ok(statuses.some((row) => row.status === "superseded"));
    assert.ok(statuses.some((row) => row.status === "completed" && row.source_asset_id === replacementHeadshotAssetId));
  } finally {
    restorePipelineMode();
  }
});

test("revoked consent blocks canonical apply for already-enqueued compare work", async () => {
  const restorePipelineMode = withPipelineMode("materialized_apply");

  try {
    const context = await createProjectContext(admin);
    const photoAssetId = await createAsset(admin, context, { assetType: "photo" });
    const consent = await createOptedInConsentWithHeadshot(admin, context);

    const matcher = createMaterializedMatcher({
      [consent.headshotAssetId]: [{ faceRank: 0, similarity: 0.13 }],
      [photoAssetId]: [{ faceRank: 0, similarity: 0.99 }],
    });

    const photoMaterialization = await ensureAssetFaceMaterialization({
      supabase: admin,
      matcher,
      tenantId: context.tenantId,
      projectId: context.projectId,
      assetId: photoAssetId,
      materializerVersion: getAutoMatchMaterializerVersion(),
      includeFaces: false,
    });
    const headshotMaterialization = await ensureAssetFaceMaterialization({
      supabase: admin,
      matcher,
      tenantId: context.tenantId,
      projectId: context.projectId,
      assetId: consent.headshotAssetId,
      materializerVersion: getAutoMatchMaterializerVersion(),
      includeFaces: false,
    });
    assert.ok(photoMaterialization && headshotMaterialization);

    await enqueueCompareMaterializedPairJob({
      tenantId: context.tenantId,
      projectId: context.projectId,
      consentId: consent.consentId,
      assetId: photoAssetId,
      headshotMaterializationId: headshotMaterialization!.materialization.id,
      assetMaterializationId: photoMaterialization!.materialization.id,
      compareVersion: getAutoMatchCompareVersion(),
      payload: {
        source: "feature029_revoked_compare",
      },
      supabase: admin,
    });

    const { error: revokeError } = await admin
      .from("consents")
      .update({ revoked_at: new Date().toISOString() })
      .eq("tenant_id", context.tenantId)
      .eq("project_id", context.projectId)
      .eq("id", consent.consentId);
    assertNoError(revokeError, "revoke consent");

    await drainMatchingQueue(matcher, 2);

    assert.equal(
      await countRows("asset_consent_face_compares", [
        ["tenant_id", context.tenantId],
        ["project_id", context.projectId],
      ]),
      1,
    );
    assert.equal(
      await countRows("asset_consent_links", [
        ["tenant_id", context.tenantId],
        ["project_id", context.projectId],
        ["asset_id", photoAssetId],
        ["consent_id", consent.consentId],
      ]),
      0,
    );
  } finally {
    restorePipelineMode();
  }
});

test("progress stays active while continuations are still draining after all photos are materialized", async () => {
  const restorePipelineMode = withPipelineMode("materialized_apply");

  try {
    const context = await createProjectContext(admin);
    const photoAssetIds = await Promise.all(
      Array.from({ length: 4 }, () => createAsset(admin, context, { assetType: "photo" })),
    );
    const consent = await createOptedInConsentWithHeadshot(admin, context);

    const matcher = createMaterializedMatcher({
      [consent.headshotAssetId]: [{ faceRank: 0, similarity: 0.19 }],
      ...Object.fromEntries(photoAssetIds.map((assetId, index) => [assetId, [{ faceRank: 0, similarity: 0.92 + index * 0.01 }]])),
    });

    for (const photoAssetId of photoAssetIds) {
      await ensureAssetFaceMaterialization({
        supabase: admin,
        matcher,
        tenantId: context.tenantId,
        projectId: context.projectId,
        assetId: photoAssetId,
        materializerVersion: getAutoMatchMaterializerVersion(),
        includeFaces: false,
      });
    }

    const boundary = await getPhotoFanoutBoundary(admin, context.tenantId, context.projectId);
    await enqueueConsentHeadshotReadyJob({
      tenantId: context.tenantId,
      projectId: context.projectId,
      consentId: consent.consentId,
      headshotAssetId: consent.headshotAssetId,
      payload: {
        source: "feature029_progress",
        headshotAssetId: consent.headshotAssetId,
        boundarySnapshotAt: boundary.boundarySnapshotAt,
        boundaryPhotoUploadedAt: boundary.boundaryPhotoUploadedAt,
        boundaryPhotoAssetId: boundary.boundaryPhotoAssetId,
      },
      supabase: admin,
    });

    await runWorkerOnce(matcher, 2);
    await runWorkerOnce(matcher, 2);

    const progress = await getProjectMatchingProgress(admin, context.tenantId, context.projectId);
    assert.equal(progress.totalImages, 4);
    assert.equal(progress.processedImages, 4);
    assert.equal(progress.isMatchingInProgress, true);
    assert.equal(progress.hasDegradedMatchingState, false);
  } finally {
    restorePipelineMode();
  }
});

test("continuations retry mid-batch enqueue failures past the old threshold without cursor loss and complete without repair", async () => {
  const restorePipelineMode = withPipelineMode("materialized_apply");

  try {
    const context = await createProjectContext(admin);
    const photoAssetIds = await Promise.all(
      Array.from({ length: 7 }, () => createAsset(admin, context, { assetType: "photo" })),
    );
    const consent = await createOptedInConsentWithHeadshot(admin, context);

    const matcher = createMaterializedMatcher({
      [consent.headshotAssetId]: [{ faceRank: 0, similarity: 0.21 }],
      ...Object.fromEntries(photoAssetIds.map((assetId, index) => [assetId, [{ faceRank: 0, similarity: 0.95 + index * 0.01 }]])),
    });

    for (const photoAssetId of photoAssetIds) {
      await ensureAssetFaceMaterialization({
        supabase: admin,
        matcher,
        tenantId: context.tenantId,
        projectId: context.projectId,
        assetId: photoAssetId,
        materializerVersion: getAutoMatchMaterializerVersion(),
        includeFaces: false,
      });
    }

    const headshotMaterialization = await ensureAssetFaceMaterialization({
      supabase: admin,
      matcher,
      tenantId: context.tenantId,
      projectId: context.projectId,
      assetId: consent.headshotAssetId,
      materializerVersion: getAutoMatchMaterializerVersion(),
      includeFaces: false,
    });
    assert.ok(headshotMaterialization);

    const boundary = await getPhotoFanoutBoundary(admin, context.tenantId, context.projectId);
    const { data: enqueueRows, error: enqueueError } = await admin.rpc("enqueue_face_match_fanout_continuation", {
      p_tenant_id: context.tenantId,
      p_project_id: context.projectId,
      p_direction: "headshot_to_photos",
      p_source_asset_id: consent.headshotAssetId,
      p_source_consent_id: consent.consentId,
      p_source_materialization_id: headshotMaterialization!.materialization.id,
      p_source_materializer_version: getAutoMatchMaterializerVersion(),
      p_compare_version: getAutoMatchCompareVersion(),
      p_boundary_snapshot_at: boundary.boundarySnapshotAt,
      p_boundary_sort_at: boundary.boundaryPhotoUploadedAt,
      p_boundary_asset_id: boundary.boundaryPhotoAssetId,
      p_boundary_consent_id: null,
      p_dispatch_mode: "normal",
      p_max_attempts: FACE_MATCH_FANOUT_CONTINUATION_MAX_ATTEMPTS,
      p_run_after: null,
      p_reset_terminal: false,
    });
    assertNoError(enqueueError, "enqueue retry test continuation");
    const continuationId = (enqueueRows?.[0] as { continuation_id: string } | undefined)?.continuation_id ?? null;
    assert.ok(continuationId);

    let injectedFailures = 0;
    __setFanoutContinuationTestHooks({
      beforeDownstreamSchedule({ continuationId: hookedContinuationId, kind, scheduledCount }) {
        if (hookedContinuationId === continuationId && kind === "compare" && scheduledCount >= 1 && injectedFailures < 6) {
          injectedFailures += 1;
          throw new HttpError(500, "face_match_enqueue_failed", "feature030 injected enqueue failure");
        }
      },
    });

    await runWorkerOnce(matcher, 3);

    const initialRetry = (await getFanoutContinuationRows(context, consent.consentId))[0];
    assert.ok(initialRetry);
    assert.equal(initialRetry.status, "queued");
    assert.equal(initialRetry.attempt_count, 1);
    assert.equal(initialRetry.max_attempts, FACE_MATCH_FANOUT_CONTINUATION_MAX_ATTEMPTS);
    assert.equal(initialRetry.last_error_code, "face_match_enqueue_failed");

    for (let attempt = 2; attempt <= 6; attempt += 1) {
      await setQueuedJobsRunAfter(
        context,
        "compare_materialized_pair",
        new Date(Date.now() + 5 * 60_000).toISOString(),
      );
      await setQueuedContinuationsRunAfter(context, new Date().toISOString(), consent.consentId);
      await runWorkerOnce(matcher, 3);

      const continuation = (await getFanoutContinuationRows(context, consent.consentId))[0];
      assert.ok(continuation);
      assert.equal(continuation.status, "queued");
      assert.equal(continuation.attempt_count, attempt);
      assert.equal(continuation.max_attempts, FACE_MATCH_FANOUT_CONTINUATION_MAX_ATTEMPTS);
      assert.equal(continuation.last_error_code, "face_match_enqueue_failed");
      assert.equal(continuation.cursor_sort_at, null);
      assert.equal(continuation.cursor_asset_id, null);
      assert.equal(continuation.cursor_consent_id, null);
      assert.equal(
        await countRows("face_match_jobs", [
          ["tenant_id", context.tenantId],
          ["project_id", context.projectId],
          ["job_type", "compare_materialized_pair"],
        ]),
        1,
      );
    }

    const degradedProgress = await getProjectMatchingProgress(admin, context.tenantId, context.projectId);
    assert.equal(degradedProgress.isMatchingInProgress, true);
    assert.equal(degradedProgress.hasDegradedMatchingState, true);

    __setFanoutContinuationTestHooks(null);
    await setQueuedJobsRunAfter(context, "compare_materialized_pair", new Date().toISOString());
    await setQueuedContinuationsRunAfter(context, new Date().toISOString(), consent.consentId);
    await drainMatchingQueue(matcher, 3);

    const completedContinuation = (await getFanoutContinuationRows(context, consent.consentId))[0];
    assert.ok(completedContinuation);
    assert.equal(completedContinuation.status, "completed");
    assert.equal(
      await countRows("asset_consent_face_compares", [
        ["tenant_id", context.tenantId],
        ["project_id", context.projectId],
      ]),
      7,
    );
  } finally {
    __setFanoutContinuationTestHooks(null);
    restorePipelineMode();
  }
});

test("continuations dead-letter only after the high retry budget is exhausted", async () => {
  const restorePipelineMode = withPipelineMode("materialized_apply");

  try {
    const context = await createProjectContext(admin);
    const photoAssetIds = await Promise.all(
      Array.from({ length: 2 }, () => createAsset(admin, context, { assetType: "photo" })),
    );
    const consent = await createOptedInConsentWithHeadshot(admin, context);

    const matcher = createMaterializedMatcher({
      [consent.headshotAssetId]: [{ faceRank: 0, similarity: 0.22 }],
      ...Object.fromEntries(photoAssetIds.map((assetId, index) => [assetId, [{ faceRank: 0, similarity: 0.97 + index * 0.01 }]])),
    });

    for (const photoAssetId of photoAssetIds) {
      await ensureAssetFaceMaterialization({
        supabase: admin,
        matcher,
        tenantId: context.tenantId,
        projectId: context.projectId,
        assetId: photoAssetId,
        materializerVersion: getAutoMatchMaterializerVersion(),
        includeFaces: false,
      });
    }

    const headshotMaterialization = await ensureAssetFaceMaterialization({
      supabase: admin,
      matcher,
      tenantId: context.tenantId,
      projectId: context.projectId,
      assetId: consent.headshotAssetId,
      materializerVersion: getAutoMatchMaterializerVersion(),
      includeFaces: false,
    });
    assert.ok(headshotMaterialization);

    const boundary = await getPhotoFanoutBoundary(admin, context.tenantId, context.projectId);
    const { data: enqueueRows, error: enqueueError } = await admin.rpc("enqueue_face_match_fanout_continuation", {
      p_tenant_id: context.tenantId,
      p_project_id: context.projectId,
      p_direction: "headshot_to_photos",
      p_source_asset_id: consent.headshotAssetId,
      p_source_consent_id: consent.consentId,
      p_source_materialization_id: headshotMaterialization!.materialization.id,
      p_source_materializer_version: getAutoMatchMaterializerVersion(),
      p_compare_version: getAutoMatchCompareVersion(),
      p_boundary_snapshot_at: boundary.boundarySnapshotAt,
      p_boundary_sort_at: boundary.boundaryPhotoUploadedAt,
      p_boundary_asset_id: boundary.boundaryPhotoAssetId,
      p_boundary_consent_id: null,
      p_dispatch_mode: "normal",
      p_max_attempts: FACE_MATCH_FANOUT_CONTINUATION_MAX_ATTEMPTS,
      p_run_after: null,
      p_reset_terminal: false,
    });
    assertNoError(enqueueError, "enqueue retry-budget continuation");
    const continuationId = (enqueueRows?.[0] as { continuation_id: string } | undefined)?.continuation_id ?? null;
    assert.ok(continuationId);

    __setFanoutContinuationTestHooks({
      beforeDownstreamSchedule({ continuationId: hookedContinuationId, kind, scheduledCount }) {
        if (hookedContinuationId === continuationId && kind === "compare" && scheduledCount >= 1) {
          throw new HttpError(500, "face_match_enqueue_failed", "feature030 exhaust retry budget");
        }
      },
    });

    await runWorkerOnce(matcher, 2);

    const initialRetry = (await getFanoutContinuationRows(context, consent.consentId))[0];
    assert.ok(initialRetry);
    assert.equal(initialRetry.status, "queued");
    assert.equal(initialRetry.attempt_count, 1);
    assert.equal(initialRetry.max_attempts, FACE_MATCH_FANOUT_CONTINUATION_MAX_ATTEMPTS);

    for (let attempt = 2; attempt <= FACE_MATCH_FANOUT_CONTINUATION_MAX_ATTEMPTS; attempt += 1) {
      await setQueuedJobsRunAfter(
        context,
        "compare_materialized_pair",
        new Date(Date.now() + 5 * 60_000).toISOString(),
      );
      await setQueuedContinuationsRunAfter(context, new Date().toISOString(), consent.consentId);
      await runWorkerOnce(matcher, 2);

      const continuation = (await getFanoutContinuationRows(context, consent.consentId))[0];
      assert.ok(continuation);
      if (attempt < FACE_MATCH_FANOUT_CONTINUATION_MAX_ATTEMPTS) {
        assert.equal(continuation.status, "queued");
      } else {
        assert.equal(continuation.status, "dead");
      }
    }

    const exhaustedContinuation = (await getFanoutContinuationRows(context, consent.consentId))[0];
    assert.ok(exhaustedContinuation);
    assert.equal(exhaustedContinuation.status, "dead");
    assert.equal(exhaustedContinuation.attempt_count, FACE_MATCH_FANOUT_CONTINUATION_MAX_ATTEMPTS);
    assert.equal(exhaustedContinuation.max_attempts, FACE_MATCH_FANOUT_CONTINUATION_MAX_ATTEMPTS);
    assert.equal(exhaustedContinuation.last_error_code, "face_match_enqueue_failed");
  } finally {
    __setFanoutContinuationTestHooks(null);
    restorePipelineMode();
  }
});

test("same-source orchestration resets legacy retryable dead continuations", async () => {
  const restorePipelineMode = withPipelineMode("materialized_apply");

  try {
    const context = await createProjectContext(admin);
    const photoAssetId = await createAsset(admin, context, { assetType: "photo" });
    const consent = await createOptedInConsentWithHeadshot(admin, context);
    const matcher = createMaterializedMatcher({
      [photoAssetId]: [{ faceRank: 0, similarity: 0.99 }],
      [consent.headshotAssetId]: [{ faceRank: 0, similarity: 0.24 }],
    });

    const headshotMaterialization = await ensureAssetFaceMaterialization({
      supabase: admin,
      matcher,
      tenantId: context.tenantId,
      projectId: context.projectId,
      assetId: consent.headshotAssetId,
      materializerVersion: getAutoMatchMaterializerVersion(),
      includeFaces: false,
    });
    assert.ok(headshotMaterialization);

    const initialBoundary = await getPhotoFanoutBoundary(admin, context.tenantId, context.projectId);
    const { error: enqueueError } = await admin.rpc("enqueue_face_match_fanout_continuation", {
      p_tenant_id: context.tenantId,
      p_project_id: context.projectId,
      p_direction: "headshot_to_photos",
      p_source_asset_id: consent.headshotAssetId,
      p_source_consent_id: consent.consentId,
      p_source_materialization_id: headshotMaterialization!.materialization.id,
      p_source_materializer_version: getAutoMatchMaterializerVersion(),
      p_compare_version: getAutoMatchCompareVersion(),
      p_boundary_snapshot_at: initialBoundary.boundarySnapshotAt,
      p_boundary_sort_at: initialBoundary.boundaryPhotoUploadedAt,
      p_boundary_asset_id: initialBoundary.boundaryPhotoAssetId,
      p_boundary_consent_id: null,
      p_dispatch_mode: "normal",
      p_max_attempts: FACE_MATCH_FANOUT_CONTINUATION_MAX_ATTEMPTS,
      p_run_after: null,
      p_reset_terminal: false,
    });
    assertNoError(enqueueError, "enqueue same-source continuation");

    const existingContinuation = (await getFanoutContinuationRows(context, consent.consentId))[0];
    assert.ok(existingContinuation);

    const { error: deadError } = await admin
      .from("face_match_fanout_continuations")
      .update({
        status: "dead",
        attempt_count: 5,
        max_attempts: 5,
        completed_at: new Date().toISOString(),
        last_error_code: "face_match_enqueue_failed",
        last_error_message: "legacy dead continuation",
        last_error_at: new Date().toISOString(),
      })
      .eq("id", existingContinuation.id);
    assertNoError(deadError, "mark continuation dead");

    const replayBoundary = await getPhotoFanoutBoundary(admin, context.tenantId, context.projectId);
    const { error: replayError } = await admin.rpc("enqueue_face_match_fanout_continuation", {
      p_tenant_id: context.tenantId,
      p_project_id: context.projectId,
      p_direction: "headshot_to_photos",
      p_source_asset_id: consent.headshotAssetId,
      p_source_consent_id: consent.consentId,
      p_source_materialization_id: headshotMaterialization!.materialization.id,
      p_source_materializer_version: getAutoMatchMaterializerVersion(),
      p_compare_version: getAutoMatchCompareVersion(),
      p_boundary_snapshot_at: replayBoundary.boundarySnapshotAt,
      p_boundary_sort_at: replayBoundary.boundaryPhotoUploadedAt,
      p_boundary_asset_id: replayBoundary.boundaryPhotoAssetId,
      p_boundary_consent_id: null,
      p_dispatch_mode: "normal",
      p_max_attempts: FACE_MATCH_FANOUT_CONTINUATION_MAX_ATTEMPTS,
      p_run_after: null,
      p_reset_terminal: false,
    });
    assertNoError(replayError, "replay same-source continuation");

    const resetContinuation = (await getFanoutContinuationRows(context, consent.consentId))[0];
    assert.ok(resetContinuation);
    assert.equal(resetContinuation.id, existingContinuation.id);
    assert.equal(resetContinuation.status, "queued");
    assert.equal(resetContinuation.attempt_count, 0);
    assert.equal(resetContinuation.max_attempts, FACE_MATCH_FANOUT_CONTINUATION_MAX_ATTEMPTS);
    assert.equal(resetContinuation.last_error_code, null);
  } finally {
    restorePipelineMode();
  }
});

test("terminal deduped compare jobs are requeued instead of silently skipping missing compare work", async () => {
  const restorePipelineMode = withPipelineMode("materialized_apply");

  try {
    const context = await createProjectContext(admin);
    const photoAssetId = await createAsset(admin, context, { assetType: "photo" });
    const consent = await createOptedInConsentWithHeadshot(admin, context);
    const matcher = createMaterializedMatcher({
      [photoAssetId]: [{ faceRank: 0, similarity: 0.96 }],
      [consent.headshotAssetId]: [{ faceRank: 0, similarity: 0.23 }],
    });

    const photoMaterialization = await ensureAssetFaceMaterialization({
      supabase: admin,
      matcher,
      tenantId: context.tenantId,
      projectId: context.projectId,
      assetId: photoAssetId,
      materializerVersion: getAutoMatchMaterializerVersion(),
      includeFaces: false,
    });
    const headshotMaterialization = await ensureAssetFaceMaterialization({
      supabase: admin,
      matcher,
      tenantId: context.tenantId,
      projectId: context.projectId,
      assetId: consent.headshotAssetId,
      materializerVersion: getAutoMatchMaterializerVersion(),
      includeFaces: false,
    });
    assert.ok(photoMaterialization && headshotMaterialization);

    const compareJob = await enqueueCompareMaterializedPairJob({
      tenantId: context.tenantId,
      projectId: context.projectId,
      consentId: consent.consentId,
      assetId: photoAssetId,
      headshotMaterializationId: headshotMaterialization!.materialization.id,
      assetMaterializationId: photoMaterialization!.materialization.id,
      compareVersion: getAutoMatchCompareVersion(),
      payload: {
        source: "feature030_terminal_compare_job",
      },
      supabase: admin,
    });

    const { error: deadJobError } = await admin
      .from("face_match_jobs")
      .update({
        status: "dead",
        completed_at: new Date().toISOString(),
        last_error_code: "feature030_dead_compare_job",
      })
      .eq("id", compareJob.jobId);
    assertNoError(deadJobError, "mark compare job dead");

    await enqueueHeadshotReadyWithBoundary(
      context,
      consent.consentId,
      consent.headshotAssetId,
      "feature030_compare_dedupe",
    );
    await runWorkerOnce(matcher, 2);
    await runWorkerOnce(matcher, 2);
    await runWorkerOnce(matcher, 2);

    const compareJobs = await getFaceMatchJobs(context, "compare_materialized_pair");
    assert.equal(compareJobs.length, 1);
    assert.equal(compareJobs[0]!.status, "queued");
    assert.ok(compareJobs[0]!.requeue_count >= 1);

    await drainMatchingQueue(matcher, 2);
    assert.equal(
      await countRows("asset_consent_face_compares", [
        ["tenant_id", context.tenantId],
        ["project_id", context.projectId],
      ]),
      1,
    );
  } finally {
    restorePipelineMode();
  }
});

test("terminal deduped materialize jobs are requeued instead of silently skipping missing materialization work", async () => {
  const restorePipelineMode = withPipelineMode("materialized_apply");

  try {
    const context = await createProjectContext(admin);
    const photoAssetId = await createAsset(admin, context, { assetType: "photo" });
    const consent = await createOptedInConsentWithHeadshot(admin, context);
    const matcher = createMaterializedMatcher({
      [photoAssetId]: [{ faceRank: 0, similarity: 0.97 }],
      [consent.headshotAssetId]: [{ faceRank: 0, similarity: 0.25 }],
    });

    const headshotMaterialization = await ensureAssetFaceMaterialization({
      supabase: admin,
      matcher,
      tenantId: context.tenantId,
      projectId: context.projectId,
      assetId: consent.headshotAssetId,
      materializerVersion: getAutoMatchMaterializerVersion(),
      includeFaces: false,
    });
    assert.ok(headshotMaterialization);

    const materializeJob = await enqueueMaterializeAssetFacesJob({
      tenantId: context.tenantId,
      projectId: context.projectId,
      assetId: photoAssetId,
      materializerVersion: getAutoMatchMaterializerVersion(),
      payload: {
        source: "feature030_terminal_materialize_job",
      },
      supabase: admin,
    });

    const { error: deadJobError } = await admin
      .from("face_match_jobs")
      .update({
        status: "dead",
        completed_at: new Date().toISOString(),
        last_error_code: "feature030_dead_materialize_job",
      })
      .eq("id", materializeJob.jobId);
    assertNoError(deadJobError, "mark materialize job dead");

    await enqueueHeadshotReadyWithBoundary(
      context,
      consent.consentId,
      consent.headshotAssetId,
      "feature030_materialize_dedupe",
    );
    await runWorkerOnce(matcher, 2);
    await runWorkerOnce(matcher, 2);
    await runWorkerOnce(matcher, 2);

    const { data: materializeJobs, error: materializeJobsError } = await admin
      .from("face_match_jobs")
      .select("status, requeue_count")
      .eq("tenant_id", context.tenantId)
      .eq("project_id", context.projectId)
      .eq("job_type", "materialize_asset_faces")
      .eq("scope_asset_id", photoAssetId);
    assertNoError(materializeJobsError, "select photo materialize jobs");
    assert.equal(materializeJobs?.length ?? 0, 1);
    assert.equal(materializeJobs?.[0]?.status, "queued");
    assert.ok((materializeJobs?.[0]?.requeue_count ?? 0) >= 1);

    await drainMatchingQueue(matcher, 2);
    assert.equal(
      await countRows("asset_consent_face_compares", [
        ["tenant_id", context.tenantId],
        ["project_id", context.projectId],
      ]),
      1,
    );
  } finally {
    restorePipelineMode();
  }
});

test("nonretryable continuation invariants dead-letter and surface degraded progress", async () => {
  const restorePipelineMode = withPipelineMode("materialized_apply");

  try {
    const context = await createProjectContext(admin);
    const photoAssetId = await createAsset(admin, context, { assetType: "photo" });
    const consent = await createOptedInConsentWithHeadshot(admin, context);
    const matcher = createMaterializedMatcher({
      [photoAssetId]: [{ faceRank: 0, similarity: 0.98 }],
      [consent.headshotAssetId]: [{ faceRank: 0, similarity: 0.27 }],
    });

    await ensureAssetFaceMaterialization({
      supabase: admin,
      matcher,
      tenantId: context.tenantId,
      projectId: context.projectId,
      assetId: photoAssetId,
      materializerVersion: getAutoMatchMaterializerVersion(),
      includeFaces: false,
    });
    const headshotMaterialization = await ensureAssetFaceMaterialization({
      supabase: admin,
      matcher,
      tenantId: context.tenantId,
      projectId: context.projectId,
      assetId: consent.headshotAssetId,
      materializerVersion: getAutoMatchMaterializerVersion(),
      includeFaces: false,
    });
    assert.ok(headshotMaterialization);

    await enqueueHeadshotReadyWithBoundary(
      context,
      consent.consentId,
      consent.headshotAssetId,
      "feature030_nonretryable_invariant",
    );
    await runWorkerOnce(matcher, 2);
    await runWorkerOnce(matcher, 2);

    __setFanoutContinuationTestHooks({
      beforeDownstreamSchedule() {
        throw new HttpError(409, "feature030_nonretryable_invariant", "nonretryable continuation invariant");
      },
    });

    await runWorkerOnce(matcher, 2);

    const continuation = (await getFanoutContinuationRows(context, consent.consentId))[0];
    assert.ok(continuation);
    assert.equal(continuation.status, "dead");
    assert.equal(continuation.attempt_count, 1);
    assert.equal(continuation.last_error_code, "feature030_nonretryable_invariant");

    const progress = await getProjectMatchingProgress(admin, context.tenantId, context.projectId);
    assert.equal(progress.isMatchingInProgress, false);
    assert.equal(progress.hasDegradedMatchingState, true);
  } finally {
    __setFanoutContinuationTestHooks(null);
    restorePipelineMode();
  }
});
