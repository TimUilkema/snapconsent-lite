import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";

import { finalizeAsset } from "../src/lib/assets/finalize-asset";
import { submitConsent } from "../src/lib/consent/submit-consent";
import {
  buildConsentHeadshotReadyDedupeKey,
  buildPhotoUploadedDedupeKey,
  enqueueConsentHeadshotReadyJob,
  enqueuePhotoUploadedJob,
} from "../src/lib/matching/auto-match-jobs";
import { runAutoMatchReconcile } from "../src/lib/matching/auto-match-reconcile";
import {
  shouldEnqueueConsentHeadshotReadyOnSubmit,
  shouldEnqueuePhotoUploadedOnFinalize,
} from "../src/lib/matching/auto-match-trigger-conditions";
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
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
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

function hashSha256(text: string) {
  return createHash("sha256").update(text).digest("hex");
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
  let lastError: { message?: string; code?: string; status?: number } | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const email = `feature010-${randomUUID()}@example.com`;
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
      name: `Feature 010 Tenant ${randomUUID()}`,
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
      name: `Feature 010 Project ${randomUUID()}`,
      description: "Feature 010 queue wiring integration tests",
      status: "active",
    })
    .select("id")
    .single();
  assertNoError(projectError, "insert project");

  const templateKey = `feature010-template-${randomUUID()}`;
  const { data: template, error: templateError } = await supabase
    .from("consent_templates")
    .insert({
      template_key: templateKey,
      version: "v1",
      body: "Feature 010 template body",
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
  const token = `invite-${randomUUID()}`;
  const tokenHash = hashSha256(token);

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
    status: "pending" | "uploaded";
    retentionDays?: number;
  },
) {
  const nowIso = new Date().toISOString();
  const uploadedAt = options.status === "uploaded" ? nowIso : null;
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
      asset_type: options.assetType,
      retention_expires_at: retentionExpiresAt,
    })
    .select("id")
    .single();
  assertNoError(error, "insert asset");
  return asset.id;
}

async function createOptedInConsentWithHeadshot(supabase: SupabaseClient, context: ProjectContext) {
  const invite = await createInviteToken(supabase, context);
  const headshotAssetId = await createAsset(supabase, context, {
    assetType: "headshot",
    status: "uploaded",
    retentionDays: 30,
  });

  const consent = await submitConsent({
    supabase,
    token: invite.token,
    fullName: "Feature 010 Subject",
    email: `subject-${randomUUID()}@example.com`,
    faceMatchOptIn: true,
    headshotAssetId,
    captureIp: null,
    captureUserAgent: "feature-010-test",
  });

  return {
    consent,
    inviteToken: invite.token,
    headshotAssetId,
  };
}

async function getProjectJobs(supabase: SupabaseClient, tenantId: string, projectId: string) {
  const { data, error } = await supabase
    .from("face_match_jobs")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId);
  assertNoError(error, "select project jobs");
  return data ?? [];
}

test("photo finalize path enqueues photo_uploaded job", async () => {
  const context = await createProjectContext(admin);
  const photoAssetId = await createAsset(admin, context, {
    assetType: "photo",
    status: "pending",
  });

  const finalized = await finalizeAsset({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    consentIds: [],
  });
  assert.equal(finalized.assetType, "photo");
  assert.equal(shouldEnqueuePhotoUploadedOnFinalize(finalized.assetType), true);

  const enqueueResult = await enqueuePhotoUploadedJob({
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: finalized.assetId,
    payload: { source: "test-photo-finalize" },
    supabase: admin,
  });
  assert.equal(enqueueResult.enqueued, true);

  const dedupeKey = buildPhotoUploadedDedupeKey(finalized.assetId);
  const { data: jobs, error } = await admin
    .from("face_match_jobs")
    .select("job_type, scope_asset_id, dedupe_key")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("dedupe_key", dedupeKey);
  assertNoError(error, "select photo job");
  assert.equal((jobs ?? []).length, 1);
  assert.equal(jobs?.[0]?.job_type, "photo_uploaded");
  assert.equal(jobs?.[0]?.scope_asset_id, finalized.assetId);
});

test("consent submit enqueue conditions: opted-in non-duplicate enqueues, duplicate/no-opt-in/no-headshot do not", async () => {
  const context = await createProjectContext(admin);
  const optedIn = await createOptedInConsentWithHeadshot(admin, context);

  assert.equal(
    shouldEnqueueConsentHeadshotReadyOnSubmit({
      duplicate: optedIn.consent.duplicate,
      faceMatchOptIn: true,
      headshotAssetId: optedIn.headshotAssetId,
    }),
    true,
  );

  const firstEnqueue = await enqueueConsentHeadshotReadyJob({
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: optedIn.consent.consentId,
    headshotAssetId: optedIn.headshotAssetId,
    payload: { source: "test-consent-submit" },
    supabase: admin,
  });
  assert.equal(firstEnqueue.enqueued, true);

  const duplicate = await submitConsent({
    supabase: admin,
    token: optedIn.inviteToken,
    fullName: "Feature 010 Subject Duplicate",
    email: `duplicate-${randomUUID()}@example.com`,
    faceMatchOptIn: true,
    headshotAssetId: optedIn.headshotAssetId,
    captureIp: null,
    captureUserAgent: "feature-010-test",
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(
    shouldEnqueueConsentHeadshotReadyOnSubmit({
      duplicate: duplicate.duplicate,
      faceMatchOptIn: true,
      headshotAssetId: optedIn.headshotAssetId,
    }),
    false,
  );
  assert.equal(
    shouldEnqueueConsentHeadshotReadyOnSubmit({
      duplicate: false,
      faceMatchOptIn: false,
      headshotAssetId: optedIn.headshotAssetId,
    }),
    false,
  );
  assert.equal(
    shouldEnqueueConsentHeadshotReadyOnSubmit({
      duplicate: false,
      faceMatchOptIn: true,
      headshotAssetId: null,
    }),
    false,
  );

  const dedupeKey = buildConsentHeadshotReadyDedupeKey(
    optedIn.consent.consentId,
    optedIn.headshotAssetId,
  );
  const { data: jobs, error } = await admin
    .from("face_match_jobs")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("dedupe_key", dedupeKey);
  assertNoError(error, "select consent submit jobs");
  assert.equal((jobs ?? []).length, 1);
});

test("headshot replacement path enqueues consent_headshot_ready job", async () => {
  const context = await createProjectContext(admin);
  const optedIn = await createOptedInConsentWithHeadshot(admin, context);
  const replacementHeadshotAssetId = await createAsset(admin, context, {
    assetType: "headshot",
    status: "uploaded",
    retentionDays: 30,
  });

  const { error: removeOldLinksError } = await admin
    .from("asset_consent_links")
    .delete()
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("consent_id", optedIn.consent.consentId)
    .eq("asset_id", optedIn.headshotAssetId);
  assertNoError(removeOldLinksError, "delete old headshot link");

  const { error: createNewLinkError } = await admin.from("asset_consent_links").upsert(
    {
      asset_id: replacementHeadshotAssetId,
      consent_id: optedIn.consent.consentId,
      tenant_id: context.tenantId,
      project_id: context.projectId,
      link_source: "manual",
      match_confidence: null,
      matched_at: null,
      reviewed_at: null,
      reviewed_by: null,
      matcher_version: null,
    },
    {
      onConflict: "asset_id,consent_id",
    },
  );
  assertNoError(createNewLinkError, "create replacement headshot link");

  const enqueueResult = await enqueueConsentHeadshotReadyJob({
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: optedIn.consent.consentId,
    headshotAssetId: replacementHeadshotAssetId,
    payload: { source: "test-headshot-replace" },
    supabase: admin,
  });
  assert.equal(enqueueResult.enqueued, true);

  const dedupeKey = buildConsentHeadshotReadyDedupeKey(
    optedIn.consent.consentId,
    replacementHeadshotAssetId,
  );
  const { data: jobs, error } = await admin
    .from("face_match_jobs")
    .select("job_type, scope_consent_id, dedupe_key")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("dedupe_key", dedupeKey);
  assertNoError(error, "select replacement job");
  assert.equal((jobs ?? []).length, 1);
  assert.equal(jobs?.[0]?.job_type, "consent_headshot_ready");
  assert.equal(jobs?.[0]?.scope_consent_id, optedIn.consent.consentId);
});

test("reconcile backfills missing jobs", async () => {
  const context = await createProjectContext(admin);
  await createOptedInConsentWithHeadshot(admin, context);
  await createAsset(admin, context, {
    assetType: "photo",
    status: "uploaded",
  });

  const beforeJobs = await getProjectJobs(admin, context.tenantId, context.projectId);
  assert.equal(beforeJobs.length, 0);

  const reconcileResult = await runAutoMatchReconcile({
    lookbackMinutes: 24 * 60,
    batchSize: 100,
    supabase: admin,
  });
  assert.ok(reconcileResult.enqueued >= 1);

  const afterJobs = await getProjectJobs(admin, context.tenantId, context.projectId);
  const jobTypes = new Set(afterJobs.map((job) => job.job_type));
  assert.ok(jobTypes.has("photo_uploaded"));
  assert.ok(jobTypes.has("consent_headshot_ready"));
});

test("stub matcher worker processes queued jobs without creating auto links", async () => {
  const context = await createProjectContext(admin);
  const optedIn = await createOptedInConsentWithHeadshot(admin, context);
  const photoAssetId = await createAsset(admin, context, {
    assetType: "photo",
    status: "uploaded",
  });

  await enqueuePhotoUploadedJob({
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    payload: { source: "test-worker-photo" },
    supabase: admin,
  });
  await enqueueConsentHeadshotReadyJob({
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: optedIn.consent.consentId,
    headshotAssetId: optedIn.headshotAssetId,
    payload: { source: "test-worker-consent" },
    supabase: admin,
  });

  const workerResult = await runAutoMatchWorker({
    workerId: `feature-010-worker-${randomUUID()}`,
    batchSize: 20,
    supabase: admin,
  });
  assert.ok(workerResult.claimed >= 2);
  assert.equal(workerResult.dead, 0);

  const jobs = await getProjectJobs(admin, context.tenantId, context.projectId);
  assert.ok(jobs.every((job) => job.status === "succeeded"));

  const { count: autoLinkCount, error: autoLinkError } = await admin
    .from("asset_consent_links")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("link_source", "auto");
  assertNoError(autoLinkError, "count auto links");
  assert.equal(autoLinkCount ?? 0, 0);
});
