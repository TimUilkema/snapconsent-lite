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
import { type AutoMatcher } from "../src/lib/matching/auto-matcher";
import {
  clearConsentPhotoSuppressions,
  linkPhotosToConsent,
  unlinkPhotosFromConsent,
} from "../src/lib/matching/consent-photo-matching";
import { runAutoMatchWorker } from "../src/lib/matching/auto-match-worker";
import { MatcherProviderError } from "../src/lib/matching/provider-errors";

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
    const email = `feature011-${randomUUID()}@example.com`;
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
      name: `Feature 011 Tenant ${randomUUID()}`,
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
      name: `Feature 011 Project ${randomUUID()}`,
      description: "Feature 011 matcher integration tests",
      status: "active",
    })
    .select("id")
    .single();
  assertNoError(projectError, "insert project");

  const templateKey = `feature011-template-${randomUUID()}`;
  const { data: template, error: templateError } = await supabase
    .from("consent_templates")
    .insert({
      template_key: templateKey,
      version: "v1",
      body: "Feature 011 template body",
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
  const token = `feature011-invite-${randomUUID()}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");

  const { data: invite, error: inviteError } = await supabase
    .from("subject_invites")
    .insert({
      tenant_id: context.tenantId,
      project_id: context.projectId,
      created_by: context.userId,
      token_hash: tokenHash,
      status: "active",
      max_uses: 1,
      consent_template_id: context.consentTemplateId,
    })
    .select("id")
    .single();
  assertNoError(inviteError, "insert invite");

  return {
    inviteId: invite.id,
    token,
  };
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

async function createConsent(
  supabase: SupabaseClient,
  context: ProjectContext,
  options: {
    faceMatchOptIn: boolean;
    headshotAssetId?: string | null;
  },
) {
  const invite = await createInviteToken(supabase, context);
  const consent = await submitConsent({
    supabase,
    token: invite.token,
    fullName: "Feature 011 Subject",
    email: `subject-${randomUUID()}@example.com`,
    faceMatchOptIn: options.faceMatchOptIn,
    headshotAssetId: options.headshotAssetId ?? null,
    captureIp: null,
    captureUserAgent: "feature-011-test",
  });

  return {
    consent,
    inviteToken: invite.token,
  };
}

async function createOptedInConsentWithHeadshot(supabase: SupabaseClient, context: ProjectContext) {
  const headshotAssetId = await createAsset(supabase, context, {
    assetType: "headshot",
    status: "uploaded",
    retentionDays: 30,
  });
  const consentResult = await createConsent(supabase, context, {
    faceMatchOptIn: true,
    headshotAssetId,
  });

  return {
    consentId: consentResult.consent.consentId,
    headshotAssetId,
  };
}

function matcherWithConfidence(confidence: number): AutoMatcher {
  return {
    version: "test-matcher",
    async match(input) {
      return input.candidates.map((candidate) => ({
        assetId: candidate.assetId,
        consentId: candidate.consentId,
        confidence,
      }));
    },
  };
}

async function getPhotoConsentLink(
  supabase: SupabaseClient,
  context: ProjectContext,
  photoAssetId: string,
  consentId: string,
) {
  const { data, error } = await supabase
    .from("asset_consent_links")
    .select("asset_id, consent_id, link_source, match_confidence, matched_at, matcher_version")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("asset_id", photoAssetId)
    .eq("consent_id", consentId)
    .maybeSingle();
  assertNoError(error, "select photo consent link");
  return data;
}

test("photo_uploaded creates auto links for multiple consents when confidence >= threshold", async () => {
  const context = await createProjectContext(admin);
  const photoAssetId = await createAsset(admin, context, {
    assetType: "photo",
    status: "uploaded",
  });
  const firstConsent = await createOptedInConsentWithHeadshot(admin, context);
  const secondConsent = await createOptedInConsentWithHeadshot(admin, context);

  const enqueueResult = await enqueuePhotoUploadedJob({
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    payload: { source: "feature-011-test" },
    supabase: admin,
  });
  assert.equal(enqueueResult.enqueued, true);

  const workerResult = await runAutoMatchWorker({
    workerId: `feature-011-worker-${randomUUID()}`,
    batchSize: 10,
    confidenceThreshold: 0.92,
    matcher: matcherWithConfidence(0.97),
    supabase: admin,
  });
  assert.equal(workerResult.dead, 0);
  assert.ok(workerResult.succeeded >= 1);

  const firstLink = await getPhotoConsentLink(admin, context, photoAssetId, firstConsent.consentId);
  const secondLink = await getPhotoConsentLink(admin, context, photoAssetId, secondConsent.consentId);
  assert.equal(firstLink?.link_source, "auto");
  assert.equal(secondLink?.link_source, "auto");
});

test("below-threshold match removes stale auto link", async () => {
  const context = await createProjectContext(admin);
  const photoAssetId = await createAsset(admin, context, {
    assetType: "photo",
    status: "uploaded",
  });
  const consent = await createOptedInConsentWithHeadshot(admin, context);

  const { error: seedLinkError } = await admin.from("asset_consent_links").upsert(
    {
      asset_id: photoAssetId,
      consent_id: consent.consentId,
      tenant_id: context.tenantId,
      project_id: context.projectId,
      link_source: "auto",
      match_confidence: 0.98,
      matched_at: new Date().toISOString(),
      matcher_version: "seed",
    },
    { onConflict: "asset_id,consent_id" },
  );
  assertNoError(seedLinkError, "seed auto link");

  await enqueueConsentHeadshotReadyJob({
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    headshotAssetId: consent.headshotAssetId,
    payload: { source: "feature-011-test" },
    supabase: admin,
  });

  await runAutoMatchWorker({
    workerId: `feature-011-worker-${randomUUID()}`,
    batchSize: 10,
    confidenceThreshold: 0.92,
    matcher: matcherWithConfidence(0.11),
    supabase: admin,
  });

  const link = await getPhotoConsentLink(admin, context, photoAssetId, consent.consentId);
  assert.equal(link, null);
});

test("manual link provenance is preserved even when matcher returns high confidence", async () => {
  const context = await createProjectContext(admin);
  const photoAssetId = await createAsset(admin, context, {
    assetType: "photo",
    status: "uploaded",
  });
  const consent = await createOptedInConsentWithHeadshot(admin, context);

  const { error: seedManualError } = await admin.from("asset_consent_links").upsert(
    {
      asset_id: photoAssetId,
      consent_id: consent.consentId,
      tenant_id: context.tenantId,
      project_id: context.projectId,
      link_source: "manual",
      match_confidence: null,
      matched_at: null,
      matcher_version: null,
    },
    { onConflict: "asset_id,consent_id" },
  );
  assertNoError(seedManualError, "seed manual link");

  await enqueueConsentHeadshotReadyJob({
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    headshotAssetId: consent.headshotAssetId,
    payload: { source: "feature-011-test" },
    supabase: admin,
  });

  await runAutoMatchWorker({
    workerId: `feature-011-worker-${randomUUID()}`,
    batchSize: 10,
    confidenceThreshold: 0.92,
    matcher: matcherWithConfidence(0.99),
    supabase: admin,
  });

  const link = await getPhotoConsentLink(admin, context, photoAssetId, consent.consentId);
  assert.equal(link?.link_source, "manual");
});

test("manual unlink creates suppression and blocks future auto recreation", async () => {
  const context = await createProjectContext(admin);
  const photoAssetId = await createAsset(admin, context, {
    assetType: "photo",
    status: "uploaded",
  });
  const consent = await createOptedInConsentWithHeadshot(admin, context);

  await linkPhotosToConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    assetIds: [photoAssetId],
  });
  await unlinkPhotosFromConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    assetIds: [photoAssetId],
  });

  const { data: suppression, error: suppressionError } = await admin
    .from("asset_consent_link_suppressions")
    .select("asset_id, consent_id")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("asset_id", photoAssetId)
    .eq("consent_id", consent.consentId)
    .maybeSingle();
  assertNoError(suppressionError, "select suppression");
  assert.ok(suppression);

  await enqueueConsentHeadshotReadyJob({
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    headshotAssetId: consent.headshotAssetId,
    payload: { source: "feature-011-test" },
    supabase: admin,
  });

  await runAutoMatchWorker({
    workerId: `feature-011-worker-${randomUUID()}`,
    batchSize: 10,
    confidenceThreshold: 0.92,
    matcher: matcherWithConfidence(0.99),
    supabase: admin,
  });

  const link = await getPhotoConsentLink(admin, context, photoAssetId, consent.consentId);
  assert.equal(link, null);
});

test("headshot replacement reset clears suppressions and allows auto recreation again", async () => {
  const context = await createProjectContext(admin);
  const photoAssetId = await createAsset(admin, context, {
    assetType: "photo",
    status: "uploaded",
  });
  const consent = await createOptedInConsentWithHeadshot(admin, context);

  await linkPhotosToConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    assetIds: [photoAssetId],
  });
  await unlinkPhotosFromConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    assetIds: [photoAssetId],
  });

  const { data: suppressionBefore, error: suppressionBeforeError } = await admin
    .from("asset_consent_link_suppressions")
    .select("asset_id")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("consent_id", consent.consentId)
    .eq("asset_id", photoAssetId)
    .maybeSingle();
  assertNoError(suppressionBeforeError, "select suppression before reset");
  assert.ok(suppressionBefore);

  await clearConsentPhotoSuppressions({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
  });

  const { data: suppressionAfter, error: suppressionAfterError } = await admin
    .from("asset_consent_link_suppressions")
    .select("asset_id")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("consent_id", consent.consentId)
    .eq("asset_id", photoAssetId)
    .maybeSingle();
  assertNoError(suppressionAfterError, "select suppression after reset");
  assert.equal(suppressionAfter, null);

  await enqueueConsentHeadshotReadyJob({
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    headshotAssetId: consent.headshotAssetId,
    payload: { source: "feature-015-test" },
    supabase: admin,
  });

  await runAutoMatchWorker({
    workerId: `feature-015-worker-${randomUUID()}`,
    batchSize: 10,
    confidenceThreshold: 0.92,
    matcher: matcherWithConfidence(0.99),
    supabase: admin,
  });

  const link = await getPhotoConsentLink(admin, context, photoAssetId, consent.consentId);
  assert.equal(link?.link_source, "auto");
});

test("retryable provider failures are retried", async () => {
  const context = await createProjectContext(admin);
  const photoAssetId = await createAsset(admin, context, {
    assetType: "photo",
    status: "uploaded",
  });
  await createOptedInConsentWithHeadshot(admin, context);

  const enqueueResult = await enqueuePhotoUploadedJob({
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    payload: { source: "feature-011-test" },
    supabase: admin,
  });

  const retryableMatcher: AutoMatcher = {
    version: "retryable-test",
    async match() {
      throw new MatcherProviderError("provider_timeout", "simulated timeout", true);
    },
  };

  const workerResult = await runAutoMatchWorker({
    workerId: `feature-011-worker-${randomUUID()}`,
    batchSize: 10,
    matcher: retryableMatcher,
    supabase: admin,
  });
  assert.equal(workerResult.retried, 1);
  assert.equal(workerResult.dead, 0);

  const { data: job, error: jobError } = await admin
    .from("face_match_jobs")
    .select("status, attempt_count")
    .eq("id", enqueueResult.jobId)
    .maybeSingle();
  assertNoError(jobError, "select retried job");
  assert.equal(job?.status, "queued");
  assert.equal(job?.attempt_count, 1);
});

test("non-retryable provider failures move jobs to dead", async () => {
  const context = await createProjectContext(admin);
  const photoAssetId = await createAsset(admin, context, {
    assetType: "photo",
    status: "uploaded",
  });
  const consent = await createOptedInConsentWithHeadshot(admin, context);

  const enqueueResult = await enqueuePhotoUploadedJob({
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    payload: { source: "feature-011-test" },
    supabase: admin,
  });

  const fatalMatcher: AutoMatcher = {
    version: "fatal-test",
    async match() {
      throw new MatcherProviderError("provider_bad_request", "simulated invalid image", false);
    },
  };

  const workerResult = await runAutoMatchWorker({
    workerId: `feature-011-worker-${randomUUID()}`,
    batchSize: 10,
    matcher: fatalMatcher,
    supabase: admin,
  });
  assert.equal(workerResult.dead, 1);

  const { data: job, error: jobError } = await admin
    .from("face_match_jobs")
    .select("status, attempt_count")
    .eq("id", enqueueResult.jobId)
    .maybeSingle();
  assertNoError(jobError, "select dead job");
  assert.equal(job?.status, "dead");
  assert.equal(job?.attempt_count, 1);

  // Ensure the setup remains valid and matcher was not bypassed due ineligibility.
  const link = await getPhotoConsentLink(admin, context, photoAssetId, consent.consentId);
  assert.equal(link, null);
});

test("ineligible records (revoked consent, opt-out consent, archived photo) are skipped and produce no auto links", async () => {
  const context = await createProjectContext(admin);
  const archivedPhotoId = await createAsset(admin, context, {
    assetType: "photo",
    status: "archived",
  });
  const optedIn = await createOptedInConsentWithHeadshot(admin, context);
  const optOut = await createConsent(admin, context, {
    faceMatchOptIn: false,
    headshotAssetId: null,
  });

  const { error: revokeError } = await admin
    .from("consents")
    .update({ revoked_at: new Date().toISOString() })
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("id", optedIn.consentId);
  assertNoError(revokeError, "revoke consent");

  await enqueueConsentHeadshotReadyJob({
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: optedIn.consentId,
    headshotAssetId: optedIn.headshotAssetId,
    payload: { source: "feature-011-test-revoked" },
    supabase: admin,
  });
  await enqueueConsentHeadshotReadyJob({
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: optOut.consent.consentId,
    headshotAssetId: null,
    payload: { source: "feature-011-test-optout" },
    supabase: admin,
  });
  await enqueuePhotoUploadedJob({
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: archivedPhotoId,
    payload: { source: "feature-011-test-archived-photo" },
    supabase: admin,
  });

  let matcherCallCount = 0;
  const matcher: AutoMatcher = {
    version: "ineligible-test",
    async match() {
      matcherCallCount += 1;
      return [];
    },
  };

  const workerResult = await runAutoMatchWorker({
    workerId: `feature-011-worker-${randomUUID()}`,
    batchSize: 10,
    matcher,
    supabase: admin,
  });

  assert.equal(workerResult.skippedIneligible, 3);
  assert.equal(matcherCallCount, 0);
});
