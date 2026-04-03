import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";

import { submitConsent } from "../src/lib/consent/submit-consent";
import { HttpError } from "../src/lib/http/errors";
import {
  enqueueCompareMaterializedPairJob,
  enqueueConsentHeadshotReadyJob,
  enqueueMaterializeAssetFacesJob,
  enqueuePhotoUploadedJob,
} from "../src/lib/matching/auto-match-jobs";
import type { AutoMatcher, AutoMatcherMaterializedFace } from "../src/lib/matching/auto-matcher";
import { getAutoMatchCompareVersion, getAutoMatchMaterializerVersion } from "../src/lib/matching/auto-match-config";
import { runProjectMatchingRepair } from "../src/lib/matching/auto-match-repair";
import { runAutoMatchWorker } from "../src/lib/matching/auto-match-worker";
import {
  __setFaceMaterializationTestHooks,
  ensureAssetFaceMaterialization,
  loadEligibleConsentHeadshotMaterializations,
  loadEligiblePhotoMaterializations,
} from "../src/lib/matching/face-materialization";

type ProjectContext = {
  tenantId: string;
  projectId: string;
  userId: string;
  consentTemplateId: string;
};

type TestFace = {
  faceRank: number;
  providerFaceIndex?: number | null;
  detectionProbability?: number | null;
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

async function createAuthUserWithRetry(supabase: SupabaseClient) {
  const maxAttempts = 6;
  const baseDelayMs = 300;
  let lastError: { message?: string; code?: string } | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const email = `feature019-${randomUUID()}@example.com`;
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
    const isTransient = error?.code === "unexpected_failure";
    if (!isTransient || attempt === maxAttempts) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
  }

  assert.fail(
    `Unable to create auth user for tests: ${lastError?.code ?? "unknown"} ${lastError?.message ?? "no error message"}`,
  );
}

async function createProjectContext(supabase: SupabaseClient): Promise<ProjectContext> {
  const userId = await createAuthUserWithRetry(supabase);

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert({
      name: `Feature 019 Tenant ${randomUUID()}`,
    })
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
      name: `Feature 019 Project ${randomUUID()}`,
      description: "Feature 019 materialized pipeline tests",
      status: "active",
    })
    .select("id")
    .single();
  assertNoError(projectError, "insert project");

  const templateKey = `feature019-template-${randomUUID()}`;
  const { data: template, error: templateError } = await supabase
    .from("consent_templates")
    .insert({
      template_key: templateKey,
      version: "v1",
      body: "Feature 019 template body",
      status: "active",
      created_by: userId,
    })
    .select("id")
    .single();
  assertNoError(templateError, "insert consent template");

  return {
    tenantId: tenant.id,
    projectId: project.id,
    userId,
    consentTemplateId: template.id,
  };
}

async function createInviteToken(supabase: SupabaseClient, context: ProjectContext) {
  const token = `feature019-invite-${randomUUID()}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const { error: inviteError } = await supabase.from("subject_invites").insert({
    tenant_id: context.tenantId,
    project_id: context.projectId,
    created_by: context.userId,
    token_hash: tokenHash,
    status: "active",
    max_uses: 1,
    consent_template_id: context.consentTemplateId,
  });
  assertNoError(inviteError, "insert invite");
  return token;
}

async function createAsset(
  supabase: SupabaseClient,
  context: ProjectContext,
  options: {
    assetType: "photo" | "headshot";
    status: "pending" | "uploaded" | "archived";
    retentionDays?: number;
  },
) {
  const nowIso = new Date().toISOString();
  const uploadedAt = options.status === "uploaded" ? nowIso : null;
  const archivedAt = options.status === "archived" ? nowIso : null;
  const retentionExpiresAt =
    options.assetType === "headshot" && options.retentionDays
      ? new Date(Date.now() + options.retentionDays * 24 * 60 * 60 * 1000).toISOString()
      : null;

  const { data: asset, error } = await supabase
    .from("assets")
    .insert({
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
      status: options.status,
      uploaded_at: uploadedAt,
      archived_at: archivedAt,
      asset_type: options.assetType,
      retention_expires_at: retentionExpiresAt,
    })
    .select("id")
    .single();
  assertNoError(error, "insert asset");
  return asset.id;
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
      status: "uploaded",
      retentionDays: 30,
    }));

  const consent = await submitConsent({
    supabase,
    token,
    fullName: "Feature 019 Subject",
    email: `subject-${randomUUID()}@example.com`,
    faceMatchOptIn: true,
    headshotAssetId: resolvedHeadshotAssetId,
    captureIp: null,
    captureUserAgent: "feature-019-test",
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

function createMaterializedMatcher(
  facesByAssetId: Record<string, TestFace[]>,
  counters?: {
    materializeCallsByAssetId: Map<string, number>;
    compareCalls: { count: number };
  },
): AutoMatcher {
  return {
    version: "feature-019-materialized-test",
    async match() {
      assert.fail("raw matcher path should not be used in materialized pipeline tests");
    },
    async materializeAssetFaces(input) {
      counters?.materializeCallsByAssetId.set(
        input.assetId,
        (counters.materializeCallsByAssetId.get(input.assetId) ?? 0) + 1,
      );

      const faces = (facesByAssetId[input.assetId] ?? []).map((face) => ({
        faceRank: face.faceRank,
        providerFaceIndex: face.providerFaceIndex ?? face.faceRank,
        detectionProbability: face.detectionProbability ?? 0.99,
        faceBox: {
          xMin: face.faceRank * 10,
          yMin: face.faceRank * 10,
          xMax: face.faceRank * 10 + 50,
          yMax: face.faceRank * 10 + 60,
          probability: face.detectionProbability ?? 0.99,
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
      if (counters) {
        counters.compareCalls.count += 1;
      }
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

async function drainMatchingQueue(
  matcher: AutoMatcher,
  options?: {
    persistResults?: boolean;
    persistFaceEvidence?: boolean;
  },
) {
  let iterations = 0;
  let totalClaimed = 0;

  while (iterations < 10) {
    const result = await runAutoMatchWorker({
      workerId: `feature-019-worker-${randomUUID()}`,
      batchSize: 50,
      confidenceThreshold: 0.92,
      reviewMinConfidence: 0.3,
      persistResults: options?.persistResults ?? true,
      persistFaceEvidence: options?.persistFaceEvidence ?? true,
      matcher,
      supabase: admin,
    });

    totalClaimed += result.claimed;
    iterations += 1;

    if (result.claimed === 0) {
      return {
        iterations,
        totalClaimed,
      };
    }
  }

  assert.fail("Matching queue did not drain within 10 worker iterations");
}

async function runWorkerOnce(
  matcher: AutoMatcher,
  options?: {
    persistResults?: boolean;
    persistFaceEvidence?: boolean;
  },
) {
  return runAutoMatchWorker({
    workerId: `feature-019-worker-${randomUUID()}`,
    batchSize: 50,
    confidenceThreshold: 0.92,
    reviewMinConfidence: 0.3,
    persistResults: options?.persistResults ?? true,
    persistFaceEvidence: options?.persistFaceEvidence ?? true,
    matcher,
    supabase: admin,
  });
}

async function countRows(
  table: string,
  filters: Array<[column: string, value: string]>,
) {
  let query = admin.from(table).select("*", { count: "exact", head: true });
  for (const [column, value] of filters) {
    query = query.eq(column, value);
  }

  const { count, error } = await query;
  assertNoError(error, `count rows from ${table}`);
  return count ?? 0;
}

async function getCompareRows(context: ProjectContext) {
  const { data, error } = await admin
    .from("asset_consent_face_compares")
    .select(
      "asset_id, consent_id, winning_asset_face_id, winning_asset_face_rank, winning_similarity, compare_status, headshot_face_id, target_face_count",
    )
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .order("consent_id", { ascending: true });
  assertNoError(error, "select face compares");
  return data ?? [];
}

async function getPhotoConsentLink(
  context: ProjectContext,
  photoAssetId: string,
  consentId: string,
) {
  const { data, error } = await admin
    .from("asset_consent_links")
    .select("asset_id, consent_id, link_source, match_confidence")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("asset_id", photoAssetId)
    .eq("consent_id", consentId)
    .maybeSingle();
  assertNoError(error, "select photo consent link");
  return data;
}

async function getMaterializationIdForAsset(context: ProjectContext, assetId: string) {
  const { data, error } = await admin
    .from("asset_face_materializations")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("asset_id", assetId)
    .eq("materializer_version", getAutoMatchMaterializerVersion())
    .single();
  assertNoError(error, "select asset materialization");
  return data.id as string;
}

async function deleteQueuedCompareJobs(context: ProjectContext) {
  const { error } = await admin
    .from("face_match_jobs")
    .delete()
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("job_type", "compare_materialized_pair");
  assertNoError(error, "delete queued compare jobs");
}

async function enqueueMaterializeJob(
  context: ProjectContext,
  assetId: string,
  mode?: "enqueue" | "repair_requeue",
) {
  return enqueueMaterializeAssetFacesJob({
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId,
    materializerVersion: getAutoMatchMaterializerVersion(),
    mode,
    requeueReason: mode === "repair_requeue" ? `feature019_replay:${assetId}` : undefined,
    supabase: admin,
  });
}

test("materialized_apply dedupes compare work across both trigger directions and persists the winning face", async () => {
  const restorePipelineMode = withPipelineMode("materialized_apply");

  try {
    const context = await createProjectContext(admin);
    const photoAssetId = await createAsset(admin, context, {
      assetType: "photo",
      status: "uploaded",
    });
    const consent = await createOptedInConsentWithHeadshot(admin, context);

    const counters = {
      materializeCallsByAssetId: new Map<string, number>(),
      compareCalls: { count: 0 },
    };
    const matcher = createMaterializedMatcher(
      {
        [consent.headshotAssetId]: [{ faceRank: 0, similarity: 0.13 }],
        [photoAssetId]: [
          { faceRank: 0, similarity: 0.44 },
          { faceRank: 1, similarity: 0.97 },
        ],
      },
      counters,
    );

    await enqueuePhotoUploadedJob({
      tenantId: context.tenantId,
      projectId: context.projectId,
      assetId: photoAssetId,
      supabase: admin,
    });
    await enqueueConsentHeadshotReadyJob({
      tenantId: context.tenantId,
      projectId: context.projectId,
      consentId: consent.consentId,
      headshotAssetId: consent.headshotAssetId,
      supabase: admin,
    });

    await drainMatchingQueue(matcher);

    assert.equal(counters.materializeCallsByAssetId.get(photoAssetId), 1);
    assert.equal(counters.materializeCallsByAssetId.get(consent.headshotAssetId), 1);
    assert.equal(counters.compareCalls.count, 1);

    assert.equal(
      await countRows("asset_face_materializations", [
        ["tenant_id", context.tenantId],
        ["project_id", context.projectId],
      ]),
      2,
    );
    assert.equal(
      await countRows("asset_consent_face_compares", [
        ["tenant_id", context.tenantId],
        ["project_id", context.projectId],
      ]),
      1,
    );
    assert.equal(
      await countRows("face_match_jobs", [
        ["tenant_id", context.tenantId],
        ["project_id", context.projectId],
        ["job_type", "compare_materialized_pair"],
      ]),
      1,
    );

    const compares = await getCompareRows(context);
    assert.equal(compares.length, 1);
    assert.equal(compares[0]?.compare_status, "matched");
    assert.equal(compares[0]?.winning_asset_face_rank, 1);
    assert.equal(compares[0]?.winning_similarity, 0.97);
    assert.ok(compares[0]?.winning_asset_face_id);
    assert.ok(compares[0]?.headshot_face_id);

    const link = await getPhotoConsentLink(context, photoAssetId, consent.consentId);
    assert.equal(link?.link_source, "auto");
    assert.equal(link?.match_confidence, 0.97);

    const { data: faceEvidenceRows, error: faceEvidenceError } = await admin
      .from("asset_consent_match_result_faces")
      .select("face_rank, provider_face_index, similarity")
      .eq("tenant_id", context.tenantId)
      .eq("project_id", context.projectId)
      .eq("asset_id", photoAssetId)
      .eq("consent_id", consent.consentId);
    assertNoError(faceEvidenceError, "select face evidence rows");
    assert.equal(faceEvidenceRows?.length ?? 0, 1);
    assert.equal(faceEvidenceRows?.[0]?.face_rank, 0);
    assert.equal(faceEvidenceRows?.[0]?.provider_face_index, 1);
    assert.equal(faceEvidenceRows?.[0]?.similarity, 0.97);
  } finally {
    restorePipelineMode();
  }
});

test("materialized_apply persists source_unusable compares for multi-face headshots without calling embedding compare", async () => {
  const restorePipelineMode = withPipelineMode("materialized_apply");

  try {
    const context = await createProjectContext(admin);
    const photoAssetId = await createAsset(admin, context, {
      assetType: "photo",
      status: "uploaded",
    });
    const consent = await createOptedInConsentWithHeadshot(admin, context);

    const counters = {
      materializeCallsByAssetId: new Map<string, number>(),
      compareCalls: { count: 0 },
    };
    const matcher = createMaterializedMatcher(
      {
        [consent.headshotAssetId]: [
          { faceRank: 0, similarity: 0.31 },
          { faceRank: 1, similarity: 0.29 },
        ],
        [photoAssetId]: [{ faceRank: 0, similarity: 0.96 }],
      },
      counters,
    );

    await enqueuePhotoUploadedJob({
      tenantId: context.tenantId,
      projectId: context.projectId,
      assetId: photoAssetId,
      supabase: admin,
    });
    await enqueueConsentHeadshotReadyJob({
      tenantId: context.tenantId,
      projectId: context.projectId,
      consentId: consent.consentId,
      headshotAssetId: consent.headshotAssetId,
      supabase: admin,
    });

    await drainMatchingQueue(matcher);

    assert.equal(counters.compareCalls.count, 0);

    const compares = await getCompareRows(context);
    assert.equal(compares.length, 1);
    assert.equal(compares[0]?.compare_status, "source_unusable");
    assert.equal(compares[0]?.winning_asset_face_id, null);
    assert.equal(compares[0]?.winning_asset_face_rank, null);
    assert.equal(compares[0]?.winning_similarity, 0);

    const link = await getPhotoConsentLink(context, photoAssetId, consent.consentId);
    assert.equal(link, null);
  } finally {
    restorePipelineMode();
  }
});

test("materialized_apply stores enough face identity to allow later face exclusivity without enforcing it yet", async () => {
  const restorePipelineMode = withPipelineMode("materialized_apply");

  try {
    const context = await createProjectContext(admin);
    const photoAssetId = await createAsset(admin, context, {
      assetType: "photo",
      status: "uploaded",
    });
    const firstConsent = await createOptedInConsentWithHeadshot(admin, context);
    const secondConsent = await createOptedInConsentWithHeadshot(admin, context);

    const matcher = createMaterializedMatcher({
      [firstConsent.headshotAssetId]: [{ faceRank: 0, similarity: 0.17 }],
      [secondConsent.headshotAssetId]: [{ faceRank: 0, similarity: 0.18 }],
      [photoAssetId]: [{ faceRank: 0, similarity: 0.96 }],
    });

    await enqueuePhotoUploadedJob({
      tenantId: context.tenantId,
      projectId: context.projectId,
      assetId: photoAssetId,
      supabase: admin,
    });
    await enqueueConsentHeadshotReadyJob({
      tenantId: context.tenantId,
      projectId: context.projectId,
      consentId: firstConsent.consentId,
      headshotAssetId: firstConsent.headshotAssetId,
      supabase: admin,
    });
    await enqueueConsentHeadshotReadyJob({
      tenantId: context.tenantId,
      projectId: context.projectId,
      consentId: secondConsent.consentId,
      headshotAssetId: secondConsent.headshotAssetId,
      supabase: admin,
    });

    await drainMatchingQueue(matcher);

    const compares = await getCompareRows(context);
    assert.equal(compares.length, 2);
    assert.equal(compares[0]?.winning_asset_face_id, compares[1]?.winning_asset_face_id);
    assert.ok(compares[0]?.winning_asset_face_id);

    const firstLink = await getPhotoConsentLink(context, photoAssetId, firstConsent.consentId);
    const secondLink = await getPhotoConsentLink(context, photoAssetId, secondConsent.consentId);
    assert.equal(firstLink?.link_source, "auto");
    assert.equal(secondLink?.link_source, "auto");
  } finally {
    restorePipelineMode();
  }
});

test("materialize_asset_faces avoids post-write face rereads in orchestration mode and still fans out compares", async () => {
  const restorePipelineMode = withPipelineMode("materialized_apply");

  try {
    const context = await createProjectContext(admin);
    const photoAssetId = await createAsset(admin, context, {
      assetType: "photo",
      status: "uploaded",
    });
    const consent = await createOptedInConsentWithHeadshot(admin, context);

    const matcher = createMaterializedMatcher({
      [consent.headshotAssetId]: [{ faceRank: 0, similarity: 0.16 }],
      [photoAssetId]: [{ faceRank: 0, similarity: 0.98 }],
    });

    const attemptedPostWriteFaceReads: Array<string> = [];
    __setFaceMaterializationTestHooks({
      beforeRead({ source, materializationId }) {
        if (source === "ensure_post_write_faces") {
          attemptedPostWriteFaceReads.push(materializationId ?? "unknown");
          throw new Error("orchestration should not reread faces after a successful write");
        }
      },
    });

    await enqueuePhotoUploadedJob({
      tenantId: context.tenantId,
      projectId: context.projectId,
      assetId: photoAssetId,
      supabase: admin,
    });
    await enqueueConsentHeadshotReadyJob({
      tenantId: context.tenantId,
      projectId: context.projectId,
      consentId: consent.consentId,
      headshotAssetId: consent.headshotAssetId,
      supabase: admin,
    });

    await drainMatchingQueue(matcher);

    assert.equal(attemptedPostWriteFaceReads.length, 0);
    assert.equal(
      await countRows("asset_consent_face_compares", [
        ["tenant_id", context.tenantId],
        ["project_id", context.projectId],
      ]),
      1,
    );

    const link = await getPhotoConsentLink(context, photoAssetId, consent.consentId);
    assert.equal(link?.link_source, "auto");
    assert.equal(link?.match_confidence, 0.98);
  } finally {
    __setFaceMaterializationTestHooks(null);
    restorePipelineMode();
  }
});

test("headshot-side fan-out loader avoids rereading existing photo faces when orchestration only needs materialization headers", async () => {
  const restorePipelineMode = withPipelineMode("materialized_apply");

  try {
    const context = await createProjectContext(admin);
    const photoAssetId = await createAsset(admin, context, {
      assetType: "photo",
      status: "uploaded",
    });
    const consent = await createOptedInConsentWithHeadshot(admin, context);

    const matcher = createMaterializedMatcher({
      [consent.headshotAssetId]: [{ faceRank: 0, similarity: 0.26 }],
      [photoAssetId]: [{ faceRank: 0, similarity: 0.94 }],
    });

    const materializedPhoto = await ensureAssetFaceMaterialization({
      supabase: admin,
      matcher,
      tenantId: context.tenantId,
      projectId: context.projectId,
      assetId: photoAssetId,
      materializerVersion: getAutoMatchMaterializerVersion(),
      includeFaces: false,
    });
    assert.ok(materializedPhoto);

    let attemptedCurrentFaceReads = 0;
    __setFaceMaterializationTestHooks({
      beforeRead({ source }) {
        if (source === "current_asset_faces" || source === "current_asset_materialization") {
          attemptedCurrentFaceReads += 1;
          throw new Error("headshot fan-out should not reread existing photo materialization rows");
        }
      },
    });

    const photoMaterializations = await loadEligiblePhotoMaterializations(
      admin,
      context.tenantId,
      context.projectId,
      10,
      getAutoMatchMaterializerVersion(),
      { includeFaces: false },
    );

    assert.equal(attemptedCurrentFaceReads, 0);
    assert.equal(photoMaterializations.length, 1);
    assert.equal(photoMaterializations[0]?.assetId, photoAssetId);
    assert.equal(photoMaterializations[0]?.faces.length, 0);
    assert.equal(photoMaterializations[0]?.facesLoaded, false);
  } finally {
    __setFaceMaterializationTestHooks(null);
    restorePipelineMode();
  }
});

test("photo-side fan-out loader avoids rereading existing headshot faces when orchestration only needs materialization headers", async () => {
  const restorePipelineMode = withPipelineMode("materialized_apply");

  try {
    const context = await createProjectContext(admin);
    const photoAssetId = await createAsset(admin, context, {
      assetType: "photo",
      status: "uploaded",
    });
    const consent = await createOptedInConsentWithHeadshot(admin, context);

    const matcher = createMaterializedMatcher({
      [consent.headshotAssetId]: [{ faceRank: 0, similarity: 0.27 }],
      [photoAssetId]: [{ faceRank: 0, similarity: 0.95 }],
    });

    const materializedHeadshot = await ensureAssetFaceMaterialization({
      supabase: admin,
      matcher,
      tenantId: context.tenantId,
      projectId: context.projectId,
      assetId: consent.headshotAssetId,
      materializerVersion: getAutoMatchMaterializerVersion(),
      includeFaces: false,
    });
    assert.ok(materializedHeadshot);

    let attemptedCurrentFaceReads = 0;
    __setFaceMaterializationTestHooks({
      beforeRead({ source }) {
        if (source === "current_asset_faces" || source === "current_asset_materialization") {
          attemptedCurrentFaceReads += 1;
          throw new Error("photo fan-out should not reread existing headshot materialization rows");
        }
      },
    });

    const headshotMaterializations = await loadEligibleConsentHeadshotMaterializations(
      admin,
      context.tenantId,
      context.projectId,
      10,
      getAutoMatchMaterializerVersion(),
      { includeFaces: false },
    );

    assert.equal(attemptedCurrentFaceReads, 0);
    assert.equal(headshotMaterializations.length, 1);
    assert.equal(headshotMaterializations[0]?.consentId, consent.consentId);
    assert.equal(headshotMaterializations[0]?.headshotAssetId, consent.headshotAssetId);
    assert.equal(headshotMaterializations[0]?.faces.length, 0);
    assert.equal(headshotMaterializations[0]?.facesLoaded, false);
  } finally {
    __setFaceMaterializationTestHooks(null);
    restorePipelineMode();
  }
});

test("headshot-side materialize replay re-derives missing compare fan-out from durable state without duplicate candidates or observability rows", async () => {
  const restorePipelineMode = withPipelineMode("materialized_apply");

  try {
    const context = await createProjectContext(admin);
    const photoAssetId = await createAsset(admin, context, {
      assetType: "photo",
      status: "uploaded",
    });
    const consent = await createOptedInConsentWithHeadshot(admin, context);

    const matcher = createMaterializedMatcher({
      [consent.headshotAssetId]: [{ faceRank: 0, similarity: 0.22 }],
      [photoAssetId]: [{ faceRank: 0, similarity: 0.54 }],
    });

    await enqueueMaterializeJob(context, photoAssetId);
    await runWorkerOnce(matcher);

    await enqueueMaterializeJob(context, consent.headshotAssetId);
    const firstHeadshotRun = await runWorkerOnce(matcher, {
      persistResults: true,
      persistFaceEvidence: true,
    });
    assert.equal(firstHeadshotRun.succeeded, 1);

    await deleteQueuedCompareJobs(context);
    assert.equal(
      await countRows("asset_consent_face_compares", [
        ["tenant_id", context.tenantId],
        ["project_id", context.projectId],
      ]),
      0,
    );

    let failedExistingReadAttempts = 0;
    __setFaceMaterializationTestHooks({
      beforeRead({ source, assetId, attempt }) {
        if (
          source === "ensure_existing_materialization" &&
          assetId === consent.headshotAssetId &&
          attempt === 1
        ) {
          failedExistingReadAttempts += 1;
          throw new HttpError(500, "face_materialization_lookup_failed", "feature019 retry existing headshot");
        }
      },
    });

    const replayResult = await enqueueMaterializeJob(context, consent.headshotAssetId, "repair_requeue");
    assert.equal(replayResult.requeued, true);

    const replayRun = await runWorkerOnce(matcher, {
      persistResults: true,
      persistFaceEvidence: true,
    });
    assert.equal(replayRun.succeeded, 1);
    assert.equal(failedExistingReadAttempts, 1);

    await drainMatchingQueue(matcher, {
      persistResults: true,
      persistFaceEvidence: true,
    });

    assert.equal(
      await countRows("asset_consent_face_compares", [
        ["tenant_id", context.tenantId],
        ["project_id", context.projectId],
      ]),
      1,
    );
    assert.equal(
      await countRows("asset_consent_match_candidates", [
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
    assert.equal(
      await countRows("asset_consent_match_results", [
        ["tenant_id", context.tenantId],
        ["project_id", context.projectId],
      ]),
      1,
    );
    assert.equal(
      await countRows("asset_consent_match_result_faces", [
        ["tenant_id", context.tenantId],
        ["project_id", context.projectId],
      ]),
      0,
    );
  } finally {
    __setFaceMaterializationTestHooks(null);
    restorePipelineMode();
  }
});

test("photo-side materialize replay re-derives missing compare fan-out from durable state without duplicate compares or canonical writes", async () => {
  const restorePipelineMode = withPipelineMode("materialized_apply");

  try {
    const context = await createProjectContext(admin);
    const photoAssetId = await createAsset(admin, context, {
      assetType: "photo",
      status: "uploaded",
    });
    const consent = await createOptedInConsentWithHeadshot(admin, context);

    const matcher = createMaterializedMatcher({
      [consent.headshotAssetId]: [{ faceRank: 0, similarity: 0.19 }],
      [photoAssetId]: [{ faceRank: 0, similarity: 0.98 }],
    });

    await enqueueMaterializeJob(context, consent.headshotAssetId);
    await runWorkerOnce(matcher);

    await enqueueMaterializeJob(context, photoAssetId);
    const firstPhotoRun = await runWorkerOnce(matcher, {
      persistResults: true,
      persistFaceEvidence: true,
    });
    assert.equal(firstPhotoRun.succeeded, 1);

    await deleteQueuedCompareJobs(context);
    assert.equal(
      await countRows("asset_consent_face_compares", [
        ["tenant_id", context.tenantId],
        ["project_id", context.projectId],
      ]),
      0,
    );

    let failedExistingReadAttempts = 0;
    __setFaceMaterializationTestHooks({
      beforeRead({ source, assetId, attempt }) {
        if (
          source === "ensure_existing_materialization" &&
          assetId === photoAssetId &&
          attempt === 1
        ) {
          failedExistingReadAttempts += 1;
          throw new HttpError(500, "face_materialization_lookup_failed", "feature019 retry existing photo");
        }
      },
    });

    const replayResult = await enqueueMaterializeJob(context, photoAssetId, "repair_requeue");
    assert.equal(replayResult.requeued, true);

    const replayRun = await runWorkerOnce(matcher, {
      persistResults: true,
      persistFaceEvidence: true,
    });
    assert.equal(replayRun.succeeded, 1);
    assert.equal(failedExistingReadAttempts, 1);

    await drainMatchingQueue(matcher, {
      persistResults: true,
      persistFaceEvidence: true,
    });

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
      1,
    );
    assert.equal(
      await countRows("asset_consent_match_candidates", [
        ["tenant_id", context.tenantId],
        ["project_id", context.projectId],
      ]),
      0,
    );
    assert.equal(
      await countRows("asset_consent_match_results", [
        ["tenant_id", context.tenantId],
        ["project_id", context.projectId],
      ]),
      1,
    );
    assert.equal(
      await countRows("asset_consent_match_result_faces", [
        ["tenant_id", context.tenantId],
        ["project_id", context.projectId],
      ]),
      1,
    );
  } finally {
    __setFaceMaterializationTestHooks(null);
    restorePipelineMode();
  }
});

test("project repair recovers partial orchestration when materializations exist but compare fan-out is missing", async () => {
  const restorePipelineMode = withPipelineMode("materialized_apply");

  try {
    const context = await createProjectContext(admin);
    const photoAssetId = await createAsset(admin, context, {
      assetType: "photo",
      status: "uploaded",
    });
    const consent = await createOptedInConsentWithHeadshot(admin, context);

    const counters = {
      materializeCallsByAssetId: new Map<string, number>(),
      compareCalls: { count: 0 },
    };
    const matcher = createMaterializedMatcher(
      {
        [consent.headshotAssetId]: [{ faceRank: 0, similarity: 0.11 }],
        [photoAssetId]: [{ faceRank: 0, similarity: 0.96 }],
      },
      counters,
    );

    await enqueuePhotoUploadedJob({
      tenantId: context.tenantId,
      projectId: context.projectId,
      assetId: photoAssetId,
      supabase: admin,
    });
    await enqueueConsentHeadshotReadyJob({
      tenantId: context.tenantId,
      projectId: context.projectId,
      consentId: consent.consentId,
      headshotAssetId: consent.headshotAssetId,
      supabase: admin,
    });

    const firstRun = await runWorkerOnce(matcher);
    const secondRun = await runWorkerOnce(matcher);
    assert.equal(firstRun.claimed > 0, true);
    assert.equal(secondRun.claimed > 0, true);
    assert.equal(counters.compareCalls.count, 0);

    const { error: deleteCompareJobsError } = await admin
      .from("face_match_jobs")
      .delete()
      .eq("tenant_id", context.tenantId)
      .eq("project_id", context.projectId)
      .eq("job_type", "compare_materialized_pair");
    assertNoError(deleteCompareJobsError, "delete compare jobs");

    assert.equal(
      await countRows("asset_face_materializations", [
        ["tenant_id", context.tenantId],
        ["project_id", context.projectId],
      ]),
      2,
    );
    assert.equal(
      await countRows("face_match_jobs", [
        ["tenant_id", context.tenantId],
        ["project_id", context.projectId],
        ["job_type", "compare_materialized_pair"],
      ]),
      0,
    );

    const repairResult = await runProjectMatchingRepair({
      projectId: context.projectId,
      batchSize: 50,
      reason: "feature019_missing_compare_fanout",
      supabase: admin,
    });
    assert.ok(repairResult.enqueued + repairResult.requeued >= 2);

    await drainMatchingQueue(matcher);

    assert.equal(counters.compareCalls.count, 1);
    assert.equal(
      await countRows("asset_consent_face_compares", [
        ["tenant_id", context.tenantId],
        ["project_id", context.projectId],
      ]),
      1,
    );

    const link = await getPhotoConsentLink(context, photoAssetId, consent.consentId);
    assert.equal(link?.link_source, "auto");
    assert.equal(link?.match_confidence, 0.96);
  } finally {
    restorePipelineMode();
  }
});

test("project repair recovers photos-first consent-later matching without duplicating compare state", async () => {
  const restorePipelineMode = withPipelineMode("materialized_apply");

  try {
    const context = await createProjectContext(admin);
    const photoAssetIds = await Promise.all(
      Array.from({ length: 3 }, () =>
        createAsset(admin, context, {
          assetType: "photo",
          status: "uploaded",
        }),
      ),
    );

    const facesByAssetId: Record<string, TestFace[]> = Object.fromEntries(
      photoAssetIds.map((assetId, index) => [assetId, [{ faceRank: 0, similarity: 0.93 + index * 0.01 }]]),
    );
    const matcher = createMaterializedMatcher(facesByAssetId);

    for (const assetId of photoAssetIds) {
      await enqueuePhotoUploadedJob({
        tenantId: context.tenantId,
        projectId: context.projectId,
        assetId,
        supabase: admin,
      });
    }

    await drainMatchingQueue(matcher);

    assert.equal(
      await countRows("asset_face_materializations", [
        ["tenant_id", context.tenantId],
        ["project_id", context.projectId],
      ]),
      3,
    );
    assert.equal(
      await countRows("asset_consent_face_compares", [
        ["tenant_id", context.tenantId],
        ["project_id", context.projectId],
      ]),
      0,
    );

    const consent = await createOptedInConsentWithHeadshot(admin, context);
    facesByAssetId[consent.headshotAssetId] = [{ faceRank: 0, similarity: 0.21 }];

    const repairResult = await runProjectMatchingRepair({
      projectId: context.projectId,
      batchSize: 50,
      reason: "feature019_photos_first",
      supabase: admin,
    });
    assert.ok(repairResult.enqueued + repairResult.requeued >= 4);

    await drainMatchingQueue(matcher);

    assert.equal(
      await countRows("asset_consent_face_compares", [
        ["tenant_id", context.tenantId],
        ["project_id", context.projectId],
      ]),
      3,
    );

    for (const assetId of photoAssetIds) {
      const link = await getPhotoConsentLink(context, assetId, consent.consentId);
      assert.equal(link?.link_source, "auto");
    }
  } finally {
    restorePipelineMode();
  }
});

test("repair requeue of an existing compare job replays safely without duplicating canonical links", async () => {
  const restorePipelineMode = withPipelineMode("materialized_apply");

  try {
    const context = await createProjectContext(admin);
    const photoAssetId = await createAsset(admin, context, {
      assetType: "photo",
      status: "uploaded",
    });
    const consent = await createOptedInConsentWithHeadshot(admin, context);

    const matcher = createMaterializedMatcher({
      [consent.headshotAssetId]: [{ faceRank: 0, similarity: 0.12 }],
      [photoAssetId]: [{ faceRank: 0, similarity: 0.98 }],
    });

    await enqueuePhotoUploadedJob({
      tenantId: context.tenantId,
      projectId: context.projectId,
      assetId: photoAssetId,
      supabase: admin,
    });
    await enqueueConsentHeadshotReadyJob({
      tenantId: context.tenantId,
      projectId: context.projectId,
      consentId: consent.consentId,
      headshotAssetId: consent.headshotAssetId,
      supabase: admin,
    });

    await drainMatchingQueue(matcher);

    const headshotMaterializationId = await getMaterializationIdForAsset(context, consent.headshotAssetId);
    const photoMaterializationId = await getMaterializationIdForAsset(context, photoAssetId);
    const replayResult = await enqueueCompareMaterializedPairJob({
      tenantId: context.tenantId,
      projectId: context.projectId,
      consentId: consent.consentId,
      assetId: photoAssetId,
      headshotMaterializationId,
      assetMaterializationId: photoMaterializationId,
      compareVersion: getAutoMatchCompareVersion(),
      mode: "repair_requeue",
      requeueReason: "feature019_compare_replay",
      payload: {
        repairRequested: true,
      },
      supabase: admin,
    });
    assert.equal(replayResult.requeued, true);

    await drainMatchingQueue(matcher);

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
      1,
    );

    const link = await getPhotoConsentLink(context, photoAssetId, consent.consentId);
    assert.equal(link?.link_source, "auto");
    assert.equal(link?.match_confidence, 0.98);
  } finally {
    restorePipelineMode();
  }
});
