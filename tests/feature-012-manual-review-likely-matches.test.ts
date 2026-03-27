import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";

import { submitConsent } from "../src/lib/consent/submit-consent";
import {
  linkPhotosToConsent,
  listMatchableProjectPhotosForConsent,
} from "../src/lib/matching/consent-photo-matching";

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
    const email = `feature012-${randomUUID()}@example.com`;
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
      name: `Feature 012 Tenant ${randomUUID()}`,
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
      name: `Feature 012 Project ${randomUUID()}`,
      description: "Feature 012 likely-match review tests",
      status: "active",
    })
    .select("id")
    .single();
  assertNoError(projectError, "insert project");

  const templateKey = `feature012-template-${randomUUID()}`;
  const { data: template, error: templateError } = await supabase
    .from("consent_templates")
    .insert({
      template_key: templateKey,
      version: "v1",
      body: "Feature 012 template body",
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
  const token = `feature012-invite-${randomUUID()}`;
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
    filenamePrefix?: string;
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
      original_filename: `${options.filenamePrefix ?? options.assetType}-${randomUUID()}.jpg`,
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
    fullName: "Feature 012 Subject",
    email: `subject-${randomUUID()}@example.com`,
    faceMatchOptIn: true,
    headshotAssetId,
    captureIp: null,
    captureUserAgent: "feature-012-test",
  });

  return {
    consentId: consent.consentId,
    headshotAssetId,
  };
}


test("likely mode returns confidence-sorted unlinked candidates in the 0.25-to-threshold band", async () => {
  const originalThreshold = process.env.AUTO_MATCH_CONFIDENCE_THRESHOLD;
  process.env.AUTO_MATCH_CONFIDENCE_THRESHOLD = "0.90";

  try {
    const context = await createProjectContext(admin);
    const consent = await createOptedInConsentWithHeadshot(admin, context);

    const linkedPhotoId = await createAsset(admin, context, {
      assetType: "photo",
      status: "uploaded",
      filenamePrefix: "linked",
    });
    const highPhotoId = await createAsset(admin, context, {
      assetType: "photo",
      status: "uploaded",
      filenamePrefix: "high",
    });
    const mediumPhotoId = await createAsset(admin, context, {
      assetType: "photo",
      status: "uploaded",
      filenamePrefix: "medium",
    });
    const suppressedPhotoId = await createAsset(admin, context, {
      assetType: "photo",
      status: "uploaded",
      filenamePrefix: "suppressed",
    });
    const belowBandPhotoId = await createAsset(admin, context, {
      assetType: "photo",
      status: "uploaded",
      filenamePrefix: "below-band",
    });

    await linkPhotosToConsent({
      supabase: admin,
      tenantId: context.tenantId,
      projectId: context.projectId,
      consentId: consent.consentId,
      assetIds: [linkedPhotoId],
    });

    const candidateRows = [
      { assetId: linkedPhotoId, confidence: 0.88 },
      { assetId: highPhotoId, confidence: 0.75 },
      { assetId: mediumPhotoId, confidence: 0.67 },
      { assetId: suppressedPhotoId, confidence: 0.65 },
      { assetId: belowBandPhotoId, confidence: 0.55 },
    ].map((row) => ({
      asset_id: row.assetId,
      consent_id: consent.consentId,
      tenant_id: context.tenantId,
      project_id: context.projectId,
      confidence: row.confidence,
      matcher_version: "seed",
      source_job_type: "photo_uploaded",
      last_scored_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    const { error: seedCandidatesError } = await admin
      .from("asset_consent_match_candidates")
      .upsert(candidateRows, { onConflict: "asset_id,consent_id" });
    assertNoError(seedCandidatesError, "seed likely candidates");

    const { error: suppressionError } = await admin.from("asset_consent_link_suppressions").upsert(
      {
        asset_id: suppressedPhotoId,
        consent_id: consent.consentId,
        tenant_id: context.tenantId,
        project_id: context.projectId,
        reason: "manual_unlink",
      },
      { onConflict: "asset_id,consent_id" },
    );
    assertNoError(suppressionError, "seed suppression");

    const likelyAssets = await listMatchableProjectPhotosForConsent({
      supabase: admin,
      tenantId: context.tenantId,
      projectId: context.projectId,
      consentId: consent.consentId,
      mode: "likely",
      limit: 20,
    });

    assert.deepEqual(
      likelyAssets.map((asset) => asset.id),
      [highPhotoId, mediumPhotoId, belowBandPhotoId],
    );
    assert.deepEqual(
      likelyAssets.map((asset) => asset.candidate_confidence),
      [0.75, 0.67, 0.55],
    );
  } finally {
    if (originalThreshold === undefined) {
      delete process.env.AUTO_MATCH_CONFIDENCE_THRESHOLD;
    } else {
      process.env.AUTO_MATCH_CONFIDENCE_THRESHOLD = originalThreshold;
    }
  }
});

test("default mode applies limit after excluding already-linked photos", async () => {
  const context = await createProjectContext(admin);
  const consent = await createOptedInConsentWithHeadshot(admin, context);

  const newestLinkedPhotoId = await createAsset(admin, context, {
    assetType: "photo",
    status: "uploaded",
    filenamePrefix: "newest-linked",
  });
  const olderLinkedPhotoId = await createAsset(admin, context, {
    assetType: "photo",
    status: "uploaded",
    filenamePrefix: "older-linked",
  });
  const firstUnlinkedPhotoId = await createAsset(admin, context, {
    assetType: "photo",
    status: "uploaded",
    filenamePrefix: "first-unlinked",
  });
  const secondUnlinkedPhotoId = await createAsset(admin, context, {
    assetType: "photo",
    status: "uploaded",
    filenamePrefix: "second-unlinked",
  });

  await linkPhotosToConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    assetIds: [newestLinkedPhotoId, olderLinkedPhotoId],
  });

  const assets = await listMatchableProjectPhotosForConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    mode: "default",
    limit: 2,
  });

  assert.equal(assets.length, 2);
  assert.deepEqual(
    new Set(assets.map((asset) => asset.id)),
    new Set([firstUnlinkedPhotoId, secondUnlinkedPhotoId]),
  );
});

test("likely mode uses a 0.25 default review-band minimum when unset", async () => {
  const originalReviewMin = process.env.AUTO_MATCH_REVIEW_MIN_CONFIDENCE;
  const originalThreshold = process.env.AUTO_MATCH_CONFIDENCE_THRESHOLD;
  delete process.env.AUTO_MATCH_REVIEW_MIN_CONFIDENCE;
  process.env.AUTO_MATCH_CONFIDENCE_THRESHOLD = "0.90";

  try {
    const context = await createProjectContext(admin);
    const consent = await createOptedInConsentWithHeadshot(admin, context);

    const inBandHighPhotoId = await createAsset(admin, context, {
      assetType: "photo",
      status: "uploaded",
      filenamePrefix: "in-band-high",
    });
    const inBandLowPhotoId = await createAsset(admin, context, {
      assetType: "photo",
      status: "uploaded",
      filenamePrefix: "in-band-low",
    });
    const belowBandPhotoId = await createAsset(admin, context, {
      assetType: "photo",
      status: "uploaded",
      filenamePrefix: "below-band-default",
    });

    const candidateRows = [
      { assetId: inBandHighPhotoId, confidence: 0.28 },
      { assetId: inBandLowPhotoId, confidence: 0.26 },
      { assetId: belowBandPhotoId, confidence: 0.24 },
    ].map((row) => ({
      asset_id: row.assetId,
      consent_id: consent.consentId,
      tenant_id: context.tenantId,
      project_id: context.projectId,
      confidence: row.confidence,
      matcher_version: "seed",
      source_job_type: "photo_uploaded",
      last_scored_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    const { error: seedCandidatesError } = await admin
      .from("asset_consent_match_candidates")
      .upsert(candidateRows, { onConflict: "asset_id,consent_id" });
    assertNoError(seedCandidatesError, "seed default-band likely candidates");

    const likelyAssets = await listMatchableProjectPhotosForConsent({
      supabase: admin,
      tenantId: context.tenantId,
      projectId: context.projectId,
      consentId: consent.consentId,
      mode: "likely",
      limit: 20,
    });

    assert.deepEqual(
      likelyAssets.map((asset) => asset.id),
      [inBandHighPhotoId, inBandLowPhotoId],
    );
    assert.deepEqual(
      likelyAssets.map((asset) => asset.candidate_confidence),
      [0.28, 0.26],
    );
  } finally {
    if (originalReviewMin === undefined) {
      delete process.env.AUTO_MATCH_REVIEW_MIN_CONFIDENCE;
    } else {
      process.env.AUTO_MATCH_REVIEW_MIN_CONFIDENCE = originalReviewMin;
    }

    if (originalThreshold === undefined) {
      delete process.env.AUTO_MATCH_CONFIDENCE_THRESHOLD;
    } else {
      process.env.AUTO_MATCH_CONFIDENCE_THRESHOLD = originalThreshold;
    }
  }
});
