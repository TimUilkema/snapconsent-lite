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
  type RepairFaceMatchJobResult,
} from "../src/lib/matching/auto-match-jobs";
import { runAutoMatchReconcile } from "../src/lib/matching/auto-match-reconcile";
import {
  shouldEnqueueConsentHeadshotReadyOnSubmit,
  shouldEnqueuePhotoUploadedOnFinalize,
} from "../src/lib/matching/auto-match-trigger-conditions";

process.env.AUTO_MATCH_PIPELINE_MODE = "materialized_apply";

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
      name: "Feature 010 Template",
      version: "v1",
      version_number: 1,
      body: "Feature 010 template body",
      status: "published",
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

function assertRepairResultShape(result: RepairFaceMatchJobResult) {
  assert.equal(typeof result.enqueued, "boolean");
  assert.equal(typeof result.requeued, "boolean");
  assert.equal(typeof result.alreadyProcessing, "boolean");
  assert.equal(typeof result.alreadyQueued, "boolean");
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
  assert.ok(reconcileResult.enqueued + reconcileResult.requeued >= 1);

  const afterJobs = await getProjectJobs(admin, context.tenantId, context.projectId);
  const jobTypes = new Set(afterJobs.map((job) => job.job_type));
  assert.ok(jobTypes.has("photo_uploaded"));
  assert.ok(jobTypes.has("consent_headshot_ready"));
});

test("stale processing jobs are reclaimed with a new lock token and stale workers cannot finalize them", async () => {
  const context = await createProjectContext(admin);
  const photoAssetId = await createAsset(admin, context, {
    assetType: "photo",
    status: "uploaded",
  });

  const initialJob = await enqueuePhotoUploadedJob({
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    supabase: admin,
  });
  assert.equal(initialJob.enqueued, true);

  const { data: firstClaim, error: firstClaimError } = await admin.rpc("claim_face_match_jobs", {
    p_locked_by: "feature010-worker-a",
    p_batch_size: 200,
    p_lease_seconds: 60,
  });
  assertNoError(firstClaimError, "claim first worker");
  const firstClaimedJob = (firstClaim ?? []).find((row) => row.job_id === initialJob.jobId);
  assert.ok(firstClaimedJob);
  assert.equal(firstClaimedJob?.reclaimed, false);
  assert.ok(firstClaimedJob?.lock_token);

  const staleAt = new Date(Date.now() - 60_000).toISOString();
  const { error: staleUpdateError } = await admin
    .from("face_match_jobs")
    .update({
      lease_expires_at: staleAt,
      locked_at: staleAt,
      updated_at: staleAt,
    })
    .eq("id", firstClaimedJob?.job_id ?? "");
  assertNoError(staleUpdateError, "expire first lease");

  const { data: secondClaim, error: secondClaimError } = await admin.rpc("claim_face_match_jobs", {
    p_locked_by: "feature010-worker-b",
    p_batch_size: 200,
    p_lease_seconds: 60,
  });
  assertNoError(secondClaimError, "claim second worker");
  const secondClaimedJob = (secondClaim ?? []).find((row) => row.job_id === initialJob.jobId);
  assert.ok(secondClaimedJob);
  assert.equal(secondClaimedJob?.reclaimed, true);
  assert.notEqual(secondClaimedJob?.lock_token, firstClaimedJob?.lock_token);

  const { data: lostComplete, error: lostCompleteError } = await admin.rpc("complete_face_match_job", {
    p_job_id: firstClaimedJob?.job_id ?? "",
    p_lock_token: firstClaimedJob?.lock_token ?? "",
  });
  assertNoError(lostCompleteError, "complete old lease");
  assert.equal(lostComplete?.[0]?.outcome, "lost_lease");

  const { data: lostFail, error: lostFailError } = await admin.rpc("fail_face_match_job", {
    p_job_id: firstClaimedJob?.job_id ?? "",
    p_lock_token: firstClaimedJob?.lock_token ?? "",
    p_error_code: "feature010_stale_worker",
    p_error_message: "stale worker",
    p_retryable: true,
    p_retry_delay_seconds: 15,
  });
  assertNoError(lostFailError, "fail old lease");
  assert.equal(lostFail?.[0]?.outcome, "lost_lease");

  const { data: finalComplete, error: finalCompleteError } = await admin.rpc("complete_face_match_job", {
    p_job_id: secondClaimedJob?.job_id ?? "",
    p_lock_token: secondClaimedJob?.lock_token ?? "",
  });
  assertNoError(finalCompleteError, "complete current lease");
  assert.equal(finalComplete?.[0]?.outcome, "completed");

  const { data: finalJob, error: finalJobError } = await admin
    .from("face_match_jobs")
    .select("status, reclaim_count, lock_token")
    .eq("id", secondClaimedJob?.job_id ?? "")
    .single();
  assertNoError(finalJobError, "select reclaimed job");
  assert.equal(finalJob.status, "succeeded");
  assert.equal(finalJob.reclaim_count, 1);
  assert.equal(finalJob.lock_token, null);
});

test("repair requeue preserves active processing rows and can reset terminal rows while normal enqueue remains deduped", async () => {
  const context = await createProjectContext(admin);
  const photoAssetId = await createAsset(admin, context, {
    assetType: "photo",
    status: "uploaded",
  });

  const firstEnqueue = await enqueuePhotoUploadedJob({
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    supabase: admin,
  });
  assert.equal(firstEnqueue.enqueued, true);

  const dedupedEnqueue = await enqueuePhotoUploadedJob({
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    supabase: admin,
  });
  assert.equal(dedupedEnqueue.enqueued, false);

  const { error: markSucceededError } = await admin
    .from("face_match_jobs")
    .update({
      status: "succeeded",
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", firstEnqueue.jobId);
  assertNoError(markSucceededError, "mark photo job succeeded");

  const stillDeduped = await enqueuePhotoUploadedJob({
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    supabase: admin,
  });
  assert.equal(stillDeduped.enqueued, false);

  const repaired = await enqueuePhotoUploadedJob({
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    mode: "repair_requeue",
    requeueReason: "feature010_terminal_repair",
    supabase: admin,
  });
  assertRepairResultShape(repaired);
  assert.equal(repaired.requeued, true);
  assert.equal(repaired.status, "queued");

  const { data: claimed, error: claimedError } = await admin.rpc("claim_face_match_jobs", {
    p_locked_by: "feature010-active-worker",
    p_batch_size: 200,
    p_lease_seconds: 600,
  });
  assertNoError(claimedError, "claim repaired row");
  const claimedJob = (claimed ?? []).find((row) => row.job_id === firstEnqueue.jobId);
  assert.ok(claimedJob);

  const activeRepair = await enqueuePhotoUploadedJob({
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    mode: "repair_requeue",
    requeueReason: "feature010_active_processing_repair",
    supabase: admin,
  });
  assertRepairResultShape(activeRepair);
  assert.equal(activeRepair.alreadyProcessing, true);

  const { data: repairedRow, error: repairedRowError } = await admin
    .from("face_match_jobs")
    .select("status, requeue_count, locked_by, last_requeue_reason")
    .eq("id", firstEnqueue.jobId)
    .single();
  assertNoError(repairedRowError, "select repaired row");
  assert.equal(repairedRow.status, "processing");
  assert.equal(repairedRow.locked_by, "feature010-active-worker");
  assert.equal(repairedRow.requeue_count, 1);
  assert.equal(repairedRow.last_requeue_reason, "feature010_terminal_repair");
});

test("reconcile can repair recent deduped intake rows without broadening its scan scope", async () => {
  const context = await createProjectContext(admin);
  const photoAssetId = await createAsset(admin, context, {
    assetType: "photo",
    status: "uploaded",
  });

  const firstEnqueue = await enqueuePhotoUploadedJob({
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    supabase: admin,
  });
  assert.equal(firstEnqueue.enqueued, true);

  const { error: deadError } = await admin
    .from("face_match_jobs")
    .update({
      status: "dead",
      attempt_count: 5,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", firstEnqueue.jobId);
  assertNoError(deadError, "mark reconcile job dead");

  const reconcileResult = await runAutoMatchReconcile({
    lookbackMinutes: 24 * 60,
    batchSize: 100,
    supabase: admin,
  });
  assert.ok(reconcileResult.requeued >= 1);

  const { data: repairedRow, error: repairedRowError } = await admin
    .from("face_match_jobs")
    .select("status, attempt_count, requeue_count, last_requeue_reason")
    .eq("id", firstEnqueue.jobId)
    .single();
  assertNoError(repairedRowError, "select reconcile repaired row");
  assert.equal(repairedRow.status, "queued");
  assert.equal(repairedRow.attempt_count, 0);
  assert.equal(repairedRow.requeue_count, 1);
  assert.equal(repairedRow.last_requeue_reason, "reconcile_recent_photo");
});
