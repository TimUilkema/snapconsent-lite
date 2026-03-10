import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";

import { submitConsent } from "../src/lib/consent/submit-consent";
import {
  enqueueConsentHeadshotReadyJob,
  enqueuePhotoUploadedJob,
} from "../src/lib/matching/auto-match-jobs";
import type { AutoMatcher } from "../src/lib/matching/auto-matcher";
import { linkPhotosToConsent, unlinkPhotosFromConsent } from "../src/lib/matching/consent-photo-matching";
import { runAutoMatchWorker } from "../src/lib/matching/auto-match-worker";

type ProjectContext = {
  tenantId: string;
  projectId: string;
  userId: string;
  consentTemplateId: string;
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
    const email = `feature013-${randomUUID()}@example.com`;
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
      name: `Feature 013 Tenant ${randomUUID()}`,
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
      name: `Feature 013 Project ${randomUUID()}`,
      description: "Feature 013 observability tests",
      status: "active",
    })
    .select("id")
    .single();
  assertNoError(projectError, "insert project");

  const templateKey = `feature013-template-${randomUUID()}`;
  const { data: template, error: templateError } = await supabase
    .from("consent_templates")
    .insert({
      template_key: templateKey,
      version: "v1",
      body: "Feature 013 template body",
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
  const token = `feature013-invite-${randomUUID()}`;
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
    fullName: "Feature 013 Subject",
    email: `subject-${randomUUID()}@example.com`,
    faceMatchOptIn: true,
    headshotAssetId,
    captureIp: null,
    captureUserAgent: "feature-013-test",
  });

  return {
    consentId: consent.consentId,
    headshotAssetId,
  };
}

function matcherFromConfidenceMap(confidenceByAssetId: Record<string, number>): AutoMatcher {
  return {
    version: "feature-013-test-matcher",
    async match(input) {
      return input.candidates.map((candidate) => ({
        assetId: candidate.assetId,
        consentId: candidate.consentId,
        confidence: confidenceByAssetId[candidate.assetId] ?? 0,
      }));
    },
  };
}

async function getResultRowsByJobId(supabase: SupabaseClient, jobId: string) {
  const { data, error } = await supabase
    .from("asset_consent_match_results")
    .select("asset_id, consent_id, decision, confidence, matcher_version, auto_threshold, review_min_confidence")
    .eq("job_id", jobId);
  assertNoError(error, "select match results");
  return data ?? [];
}

test("disabled result persistence writes no match result rows", async () => {
  const context = await createProjectContext(admin);
  const consent = await createOptedInConsentWithHeadshot(admin, context);
  const photoAssetId = await createAsset(admin, context, {
    assetType: "photo",
    status: "uploaded",
  });

  const enqueue = await enqueuePhotoUploadedJob({
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    payload: { source: "feature-013-disabled" },
    supabase: admin,
  });

  await runAutoMatchWorker({
    workerId: `feature-013-worker-${randomUUID()}`,
    batchSize: 10,
    confidenceThreshold: 0.92,
    reviewMinConfidence: 0.3,
    persistResults: false,
    matcher: matcherFromConfidenceMap({
      [photoAssetId]: 0.7,
    }),
    supabase: admin,
  });

  const rows = await getResultRowsByJobId(admin, enqueue.jobId);
  assert.equal(rows.length, 0);

  const { data: link, error: linkError } = await admin
    .from("asset_consent_links")
    .select("asset_id")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("asset_id", photoAssetId)
    .eq("consent_id", consent.consentId)
    .maybeSingle();
  assertNoError(linkError, "select link");
  assert.equal(link, null);
});

test("enabled result persistence records decision classes and is idempotent on same job replay", async () => {
  const context = await createProjectContext(admin);
  const consent = await createOptedInConsentWithHeadshot(admin, context);

  const autoPhotoId = await createAsset(admin, context, { assetType: "photo", status: "uploaded" });
  const candidatePhotoId = await createAsset(admin, context, { assetType: "photo", status: "uploaded" });
  const belowBandPhotoId = await createAsset(admin, context, { assetType: "photo", status: "uploaded" });
  const manualPhotoId = await createAsset(admin, context, { assetType: "photo", status: "uploaded" });
  const suppressedPhotoId = await createAsset(admin, context, { assetType: "photo", status: "uploaded" });

  await linkPhotosToConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    assetIds: [manualPhotoId, suppressedPhotoId],
  });
  await unlinkPhotosFromConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    assetIds: [suppressedPhotoId],
  });

  const enqueue = await enqueueConsentHeadshotReadyJob({
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    headshotAssetId: consent.headshotAssetId,
    payload: { source: "feature-013-decisions" },
    supabase: admin,
  });

  const confidenceByAssetId: Record<string, number> = {
    [autoPhotoId]: 0.96,
    [candidatePhotoId]: 0.5,
    [belowBandPhotoId]: 0.11,
    [manualPhotoId]: 0.99,
    [suppressedPhotoId]: 0.99,
  };

  await runAutoMatchWorker({
    workerId: `feature-013-worker-${randomUUID()}`,
    batchSize: 10,
    confidenceThreshold: 0.92,
    reviewMinConfidence: 0.3,
    persistResults: true,
    matcher: matcherFromConfidenceMap(confidenceByAssetId),
    supabase: admin,
  });

  const rows = await getResultRowsByJobId(admin, enqueue.jobId);
  assert.equal(rows.length, 5);

  const decisionByAssetId = new Map(rows.map((row) => [row.asset_id, row.decision]));
  assert.equal(decisionByAssetId.get(autoPhotoId), "auto_link_upserted");
  assert.equal(decisionByAssetId.get(candidatePhotoId), "candidate_upserted");
  assert.equal(decisionByAssetId.get(belowBandPhotoId), "below_review_band");
  assert.equal(decisionByAssetId.get(manualPhotoId), "skipped_manual");
  assert.equal(decisionByAssetId.get(suppressedPhotoId), "skipped_suppressed");

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

  await runAutoMatchWorker({
    workerId: `feature-013-worker-${randomUUID()}`,
    batchSize: 10,
    confidenceThreshold: 0.92,
    reviewMinConfidence: 0.3,
    persistResults: true,
    matcher: matcherFromConfidenceMap(confidenceByAssetId),
    supabase: admin,
  });

  const replayRows = await getResultRowsByJobId(admin, enqueue.jobId);
  assert.equal(replayRows.length, 5);
});

test("results max-per-job cap is applied deterministically", async () => {
  const context = await createProjectContext(admin);
  const consent = await createOptedInConsentWithHeadshot(admin, context);

  const photoA = await createAsset(admin, context, { assetType: "photo", status: "uploaded" });
  const photoB = await createAsset(admin, context, { assetType: "photo", status: "uploaded" });
  const photoC = await createAsset(admin, context, { assetType: "photo", status: "uploaded" });

  const enqueue = await enqueueConsentHeadshotReadyJob({
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    headshotAssetId: consent.headshotAssetId,
    payload: { source: "feature-013-cap" },
    supabase: admin,
  });

  await runAutoMatchWorker({
    workerId: `feature-013-worker-${randomUUID()}`,
    batchSize: 10,
    confidenceThreshold: 0.92,
    reviewMinConfidence: 0.3,
    persistResults: true,
    resultsMaxPerJob: 2,
    matcher: matcherFromConfidenceMap({
      [photoA]: 0.85,
      [photoB]: 0.77,
      [photoC]: 0.66,
    }),
    supabase: admin,
  });

  const rows = await getResultRowsByJobId(admin, enqueue.jobId);
  assert.equal(rows.length, 2);
});
