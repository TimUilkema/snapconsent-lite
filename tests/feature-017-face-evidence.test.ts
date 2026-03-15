import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";

import { submitConsent } from "../src/lib/consent/submit-consent";
import { HttpError } from "../src/lib/http/errors";
import { enqueueConsentHeadshotReadyJob } from "../src/lib/matching/auto-match-jobs";
import type { AutoMatcher, AutoMatcherFaceEvidence, AutoMatcherProviderMetadata } from "../src/lib/matching/auto-matcher";
import { linkPhotosToConsent } from "../src/lib/matching/consent-photo-matching";
import { runAutoMatchWorker } from "../src/lib/matching/auto-match-worker";

type ProjectContext = {
  tenantId: string;
  projectId: string;
  userId: string;
  consentTemplateId: string;
};

type MatcherSpec = {
  confidence: number;
  faces?: AutoMatcherFaceEvidence[];
  providerMetadata?: AutoMatcherProviderMetadata;
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
    const email = `feature017-${randomUUID()}@example.com`;
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
      name: `Feature 017 Tenant ${randomUUID()}`,
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
      name: `Feature 017 Project ${randomUUID()}`,
      description: "Feature 017 face evidence tests",
      status: "active",
    })
    .select("id")
    .single();
  assertNoError(projectError, "insert project");

  const templateKey = `feature017-template-${randomUUID()}`;
  const { data: template, error: templateError } = await supabase
    .from("consent_templates")
    .insert({
      template_key: templateKey,
      version: "v1",
      body: "Feature 017 template body",
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
  const token = `feature017-invite-${randomUUID()}`;
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

async function createOptedInConsentWithHeadshot(supabase: SupabaseClient, context: ProjectContext) {
  const token = await createInviteToken(supabase, context);
  const headshotAssetId = await createAsset(supabase, context, {
    assetType: "headshot",
    status: "uploaded",
    retentionDays: 30,
  });

  const consent = await submitConsent({
    supabase,
    token,
    fullName: "Feature 017 Subject",
    email: `subject-${randomUUID()}@example.com`,
    faceMatchOptIn: true,
    headshotAssetId,
    captureIp: null,
    captureUserAgent: "feature-017-test",
  });

  return {
    consentId: consent.consentId,
    headshotAssetId,
  };
}

function matcherFromSpecByAssetId(specByAssetId: Record<string, MatcherSpec>): AutoMatcher {
  return {
    version: "feature-017-test-matcher",
    async match(input) {
      return input.candidates.map((candidate) => {
        const spec = specByAssetId[candidate.assetId] ?? { confidence: 0 };
        return {
          assetId: candidate.assetId,
          consentId: candidate.consentId,
          confidence: spec.confidence,
          faces: spec.faces,
          providerMetadata: spec.providerMetadata,
        };
      });
    },
  };
}

function buildFace(similarity: number, providerFaceIndex: number): AutoMatcherFaceEvidence {
  return {
    similarity,
    providerFaceIndex,
    sourceFaceBox: {
      xMin: 10,
      yMin: 20,
      xMax: 110,
      yMax: 220,
      probability: 1,
    },
    targetFaceBox: {
      xMin: 30 + providerFaceIndex,
      yMin: 40 + providerFaceIndex,
      xMax: 130 + providerFaceIndex,
      yMax: 240 + providerFaceIndex,
      probability: 0.95,
    },
    sourceEmbedding: [0.01, 0.02, 0.03],
    targetEmbedding: [0.11 + providerFaceIndex, 0.22 + providerFaceIndex, 0.33 + providerFaceIndex],
  };
}

async function getFaceEvidenceRowsByJobId(supabase: SupabaseClient, jobId: string) {
  const { data, error } = await supabase
    .from("asset_consent_match_result_faces")
    .select("asset_id, consent_id, face_rank, provider, provider_mode, similarity")
    .eq("job_id", jobId)
    .order("asset_id", { ascending: true })
    .order("face_rank", { ascending: true });
  assertNoError(error, "select face evidence rows");
  return data ?? [];
}

async function getResultRowsByJobId(supabase: SupabaseClient, jobId: string) {
  const { data, error } = await supabase
    .from("asset_consent_match_results")
    .select("asset_id, consent_id, decision")
    .eq("job_id", jobId);
  assertNoError(error, "select result rows");
  return data ?? [];
}

test("face evidence persists only for consent-linked decisions in bounded parent result set", async () => {
  const context = await createProjectContext(admin);
  const consent = await createOptedInConsentWithHeadshot(admin, context);

  const autoPhotoId = await createAsset(admin, context, { assetType: "photo", status: "uploaded" });
  const candidatePhotoId = await createAsset(admin, context, { assetType: "photo", status: "uploaded" });
  const manualPhotoId = await createAsset(admin, context, { assetType: "photo", status: "uploaded" });

  await linkPhotosToConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    assetIds: [manualPhotoId],
  });

  const enqueue = await enqueueConsentHeadshotReadyJob({
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    headshotAssetId: consent.headshotAssetId,
    payload: { source: "feature-017-scope" },
    supabase: admin,
  });

  const providerMetadata: AutoMatcherProviderMetadata = {
    provider: "feature017-provider",
    providerMode: "verification",
    providerPluginVersions: {
      detector: "v1",
    },
  };

  await runAutoMatchWorker({
    workerId: `feature-017-worker-${randomUUID()}`,
    batchSize: 10,
    confidenceThreshold: 0.92,
    reviewMinConfidence: 0.3,
    persistResults: true,
    persistFaceEvidence: true,
    matcher: matcherFromSpecByAssetId({
      [autoPhotoId]: {
        confidence: 0.98,
        faces: [buildFace(0.98, 0), buildFace(0.94, 1)],
        providerMetadata,
      },
      [candidatePhotoId]: {
        confidence: 0.55,
        faces: [buildFace(0.55, 0)],
        providerMetadata,
      },
      [manualPhotoId]: {
        confidence: 0.99,
        faces: [buildFace(0.99, 0)],
        providerMetadata,
      },
    }),
    supabase: admin,
  });

  const resultRows = await getResultRowsByJobId(admin, enqueue.jobId);
  assert.equal(resultRows.length, 3);
  const decisionsByAssetId = new Map(resultRows.map((row) => [row.asset_id, row.decision]));
  assert.equal(decisionsByAssetId.get(autoPhotoId), "auto_link_upserted");
  assert.equal(decisionsByAssetId.get(candidatePhotoId), "candidate_upserted");
  assert.equal(decisionsByAssetId.get(manualPhotoId), "skipped_manual");

  const faceRows = await getFaceEvidenceRowsByJobId(admin, enqueue.jobId);
  assert.equal(faceRows.length, 3);
  assert.deepEqual(
    Array.from(new Set(faceRows.map((row) => row.asset_id))).sort(),
    [autoPhotoId, manualPhotoId].sort(),
  );
  assert.ok(faceRows.every((row) => row.provider === "feature017-provider"));
  assert.ok(faceRows.every((row) => row.provider_mode === "verification"));
});

test("face evidence replay is idempotent and stale face ranks are removed", async () => {
  const context = await createProjectContext(admin);
  const consent = await createOptedInConsentWithHeadshot(admin, context);
  const photoId = await createAsset(admin, context, { assetType: "photo", status: "uploaded" });

  const enqueue = await enqueueConsentHeadshotReadyJob({
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    headshotAssetId: consent.headshotAssetId,
    payload: { source: "feature-017-idempotent" },
    supabase: admin,
  });

  let faceCount = 2;
  const matcher: AutoMatcher = {
    version: "feature-017-idempotent-matcher",
    async match(input) {
      return input.candidates.map((candidate) => ({
        assetId: candidate.assetId,
        consentId: candidate.consentId,
        confidence: 0.97,
        faces: Array.from({ length: faceCount }).map((_, index) => buildFace(0.97 - index * 0.01, index)),
        providerMetadata: {
          provider: "feature017-provider",
          providerMode: "verification",
        },
      }));
    },
  };

  await runAutoMatchWorker({
    workerId: `feature-017-worker-${randomUUID()}`,
    batchSize: 10,
    confidenceThreshold: 0.92,
    reviewMinConfidence: 0.3,
    persistResults: true,
    persistFaceEvidence: true,
    matcher,
    supabase: admin,
  });

  const firstRows = await getFaceEvidenceRowsByJobId(admin, enqueue.jobId);
  assert.equal(firstRows.length, 2);
  assert.deepEqual(firstRows.map((row) => row.face_rank), [0, 1]);

  const { error: resetJobError } = await admin
    .from("face_match_jobs")
    .update({
      status: "queued",
      run_after: new Date().toISOString(),
      locked_at: null,
      locked_by: null,
      completed_at: null,
    })
    .eq("id", enqueue.jobId);
  assertNoError(resetJobError, "reset job for replay");

  faceCount = 1;

  await runAutoMatchWorker({
    workerId: `feature-017-worker-${randomUUID()}`,
    batchSize: 10,
    confidenceThreshold: 0.92,
    reviewMinConfidence: 0.3,
    persistResults: true,
    persistFaceEvidence: true,
    matcher,
    supabase: admin,
  });

  const replayRows = await getFaceEvidenceRowsByJobId(admin, enqueue.jobId);
  assert.equal(replayRows.length, 1);
  assert.deepEqual(replayRows.map((row) => row.face_rank), [0]);
  assert.equal(replayRows[0]?.asset_id, photoId);
});

test("persistFaceEvidence requires persistResults", async () => {
  await assert.rejects(
    () =>
      runAutoMatchWorker({
        workerId: `feature-017-worker-${randomUUID()}`,
        persistResults: false,
        persistFaceEvidence: true,
        // Guard is evaluated before claim, so a stub client is enough here.
        supabase: {} as SupabaseClient,
      }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.code, "face_match_invalid_config");
      return true;
    },
  );
});
