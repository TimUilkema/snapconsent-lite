import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";

import { submitConsent } from "../src/lib/consent/submit-consent";
import { getAutoMatchMaterializerVersion } from "../src/lib/matching/auto-match-config";
import { listMatchableProjectPhotosForConsent } from "../src/lib/matching/consent-photo-matching";
import type { AutoMatcher, AutoMatcherMaterializedFace } from "../src/lib/matching/auto-matcher";
import { ensureAssetFaceMaterialization } from "../src/lib/matching/face-materialization";

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
      name: "Feature 012 Template",
      version: "v1",
      version_number: 1,
      body: "Feature 012 template body",
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

function createMaterializationOnlyMatcher(facesByAssetId: Record<string, number>): AutoMatcher {
  return {
    version: "feature-012-materialize-test",
    async match() {
      assert.fail("raw matcher path should not be used in feature 012 tests");
    },
    async materializeAssetFaces(input) {
      const faceCount = Math.max(0, facesByAssetId[input.assetId] ?? 1);
      const faces = Array.from({ length: faceCount }, (_, faceRank) => ({
        faceRank,
        providerFaceIndex: faceRank,
        detectionProbability: 0.99,
        faceBox: {
          xMin: faceRank * 10,
          yMin: faceRank * 10,
          xMax: faceRank * 10 + 40,
          yMax: faceRank * 10 + 50,
          probability: 0.99,
        },
        embedding: [0.9 - faceRank * 0.01, faceRank],
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
    async compareEmbeddings() {
      assert.fail("embedding compare should not run in feature 012 tests");
    },
  };
}

async function materializePhotoFaces(
  supabase: SupabaseClient,
  context: ProjectContext,
  assetId: string,
  faceCount = 1,
) {
  const matcher = createMaterializationOnlyMatcher({
    [assetId]: faceCount,
  });
  const current = await ensureAssetFaceMaterialization({
    supabase,
    matcher,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId,
    materializerVersion: getAutoMatchMaterializerVersion(),
    includeFaces: true,
  });
  assert.ok(current);
  return current;
}

async function seedCurrentManualFaceLink(
  supabase: SupabaseClient,
  context: ProjectContext,
  assetId: string,
  consentId: string,
) {
  const current = await materializePhotoFaces(supabase, context, assetId, 1);
  const face = current!.faces[0];
  assert.ok(face);

  const { error } = await supabase.from("asset_face_consent_links").upsert(
    {
      asset_face_id: face.id,
      asset_materialization_id: current!.materialization.id,
      asset_id: assetId,
      consent_id: consentId,
      tenant_id: context.tenantId,
      project_id: context.projectId,
      link_source: "manual",
      match_confidence: null,
      matched_at: null,
      reviewed_at: new Date().toISOString(),
      reviewed_by: context.userId,
      matcher_version: null,
    },
    { onConflict: "asset_face_id" },
  );
  assertNoError(error, "seed current manual face link");

  return {
    materializationId: current!.materialization.id,
    assetFaceId: face.id,
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

    const linkedFace = await seedCurrentManualFaceLink(admin, context, linkedPhotoId, consent.consentId);
    const highFace = await materializePhotoFaces(admin, context, highPhotoId, 1);
    const mediumFace = await materializePhotoFaces(admin, context, mediumPhotoId, 1);
    const suppressedFace = await materializePhotoFaces(admin, context, suppressedPhotoId, 1);
    const belowBandFace = await materializePhotoFaces(admin, context, belowBandPhotoId, 1);

    const candidateRows = [
      {
        assetId: linkedPhotoId,
        confidence: 0.88,
        assetFaceId: linkedFace.assetFaceId,
        faceRank: 0,
      },
      {
        assetId: highPhotoId,
        confidence: 0.75,
        assetFaceId: highFace!.faces[0]!.id,
        faceRank: 0,
      },
      {
        assetId: mediumPhotoId,
        confidence: 0.67,
        assetFaceId: mediumFace!.faces[0]!.id,
        faceRank: 0,
      },
      {
        assetId: suppressedPhotoId,
        confidence: 0.65,
        assetFaceId: suppressedFace!.faces[0]!.id,
        faceRank: 0,
      },
      {
        assetId: belowBandPhotoId,
        confidence: 0.55,
        assetFaceId: belowBandFace!.faces[0]!.id,
        faceRank: 0,
      },
    ].map((row) => ({
      asset_id: row.assetId,
      consent_id: consent.consentId,
      tenant_id: context.tenantId,
      project_id: context.projectId,
      confidence: row.confidence,
      matcher_version: "seed",
      source_job_type: "photo_uploaded",
      winning_asset_face_id: row.assetFaceId,
      winning_asset_face_rank: row.faceRank,
      last_scored_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }));

    const { error: seedCandidatesError } = await admin
      .from("asset_consent_match_candidates")
      .upsert(candidateRows, { onConflict: "asset_id,consent_id" });
    assertNoError(seedCandidatesError, "seed likely candidates");

    const { error: suppressionError } = await admin.from("asset_face_consent_link_suppressions").upsert(
      {
        asset_face_id: suppressedFace!.faces[0]!.id,
        asset_materialization_id: suppressedFace!.materialization.id,
        asset_id: suppressedPhotoId,
        consent_id: consent.consentId,
        tenant_id: context.tenantId,
        project_id: context.projectId,
        reason: "manual_unlink",
        created_by: context.userId,
      },
      { onConflict: "asset_face_id,consent_id" },
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

    assert.equal(likelyAssets.page, 0);
    assert.equal(likelyAssets.pageSize, 20);
    assert.equal(likelyAssets.hasNextPage, false);
    assert.equal(likelyAssets.hasPreviousPage, false);
    assert.deepEqual(
      likelyAssets.assets.map((asset) => asset.id),
      [highPhotoId, mediumPhotoId, belowBandPhotoId],
    );
    assert.deepEqual(
      likelyAssets.assets.map((asset) => asset.candidate_confidence),
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

test("default mode paginates after excluding already-linked photos", async () => {
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
  const thirdUnlinkedPhotoId = await createAsset(admin, context, {
    assetType: "photo",
    status: "uploaded",
    filenamePrefix: "third-unlinked",
  });

  await seedCurrentManualFaceLink(admin, context, newestLinkedPhotoId, consent.consentId);
  await seedCurrentManualFaceLink(admin, context, olderLinkedPhotoId, consent.consentId);

  const firstPage = await listMatchableProjectPhotosForConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    mode: "default",
    limit: 2,
    page: 0,
  });
  const secondPage = await listMatchableProjectPhotosForConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    mode: "default",
    limit: 2,
    page: 1,
  });

  assert.equal(firstPage.assets.length, 2);
  assert.equal(firstPage.hasPreviousPage, false);
  assert.equal(firstPage.hasNextPage, true);
  assert.ok(firstPage.assets.every((asset) => asset.id !== newestLinkedPhotoId && asset.id !== olderLinkedPhotoId));
  assert.equal(secondPage.assets.length, 1);
  assert.ok(secondPage.assets.every((asset) => asset.id !== newestLinkedPhotoId && asset.id !== olderLinkedPhotoId));
  assert.equal(secondPage.hasPreviousPage, true);
  assert.equal(secondPage.hasNextPage, false);
  assert.equal(
    firstPage.assets.some((asset) => secondPage.assets.some((nextAsset) => nextAsset.id === asset.id)),
    false,
  );
  assert.deepEqual(
    new Set([...firstPage.assets, ...secondPage.assets].map((asset) => asset.id)),
    new Set([firstUnlinkedPhotoId, secondUnlinkedPhotoId, thirdUnlinkedPhotoId]),
  );
});

test("likely mode paginates across ranked candidates after filtering invalid rows", async () => {
  const originalThreshold = process.env.AUTO_MATCH_CONFIDENCE_THRESHOLD;
  process.env.AUTO_MATCH_CONFIDENCE_THRESHOLD = "0.90";

  try {
    const context = await createProjectContext(admin);
    const consent = await createOptedInConsentWithHeadshot(admin, context);

    const highPhotoId = await createAsset(admin, context, {
      assetType: "photo",
      status: "uploaded",
      filenamePrefix: "likely-high",
    });
    const mediumPhotoId = await createAsset(admin, context, {
      assetType: "photo",
      status: "uploaded",
      filenamePrefix: "likely-medium",
    });
    const lowPhotoId = await createAsset(admin, context, {
      assetType: "photo",
      status: "uploaded",
      filenamePrefix: "likely-low",
    });

    const highFace = await materializePhotoFaces(admin, context, highPhotoId, 1);
    const mediumFace = await materializePhotoFaces(admin, context, mediumPhotoId, 1);
    const lowFace = await materializePhotoFaces(admin, context, lowPhotoId, 1);

    const { error: seedCandidatesError } = await admin
      .from("asset_consent_match_candidates")
      .upsert(
        [
          {
            asset_id: highPhotoId,
            consent_id: consent.consentId,
            tenant_id: context.tenantId,
            project_id: context.projectId,
            confidence: 0.79,
            matcher_version: "seed",
            source_job_type: "photo_uploaded",
            winning_asset_face_id: highFace!.faces[0]!.id,
            winning_asset_face_rank: 0,
            last_scored_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          {
            asset_id: mediumPhotoId,
            consent_id: consent.consentId,
            tenant_id: context.tenantId,
            project_id: context.projectId,
            confidence: 0.68,
            matcher_version: "seed",
            source_job_type: "photo_uploaded",
            winning_asset_face_id: mediumFace!.faces[0]!.id,
            winning_asset_face_rank: 0,
            last_scored_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          {
            asset_id: lowPhotoId,
            consent_id: consent.consentId,
            tenant_id: context.tenantId,
            project_id: context.projectId,
            confidence: 0.51,
            matcher_version: "seed",
            source_job_type: "photo_uploaded",
            winning_asset_face_id: lowFace!.faces[0]!.id,
            winning_asset_face_rank: 0,
            last_scored_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ],
        { onConflict: "asset_id,consent_id" },
      );
    assertNoError(seedCandidatesError, "seed paged likely candidates");

    const firstPage = await listMatchableProjectPhotosForConsent({
      supabase: admin,
      tenantId: context.tenantId,
      projectId: context.projectId,
      consentId: consent.consentId,
      mode: "likely",
      limit: 2,
      page: 0,
    });
    const secondPage = await listMatchableProjectPhotosForConsent({
      supabase: admin,
      tenantId: context.tenantId,
      projectId: context.projectId,
      consentId: consent.consentId,
      mode: "likely",
      limit: 2,
      page: 1,
    });

    assert.deepEqual(
      firstPage.assets.map((asset) => asset.id),
      [highPhotoId, mediumPhotoId],
    );
    assert.equal(firstPage.hasPreviousPage, false);
    assert.equal(firstPage.hasNextPage, true);
    assert.deepEqual(
      secondPage.assets.map((asset) => asset.id),
      [lowPhotoId],
    );
    assert.equal(secondPage.hasPreviousPage, true);
    assert.equal(secondPage.hasNextPage, false);
  } finally {
    if (originalThreshold === undefined) {
      delete process.env.AUTO_MATCH_CONFIDENCE_THRESHOLD;
    } else {
      process.env.AUTO_MATCH_CONFIDENCE_THRESHOLD = originalThreshold;
    }
  }
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

    const inBandHighFace = await materializePhotoFaces(admin, context, inBandHighPhotoId, 1);
    const inBandLowFace = await materializePhotoFaces(admin, context, inBandLowPhotoId, 1);
    const belowBandFace = await materializePhotoFaces(admin, context, belowBandPhotoId, 1);

    const candidateRows = [
      {
        assetId: inBandHighPhotoId,
        confidence: 0.28,
        assetFaceId: inBandHighFace!.faces[0]!.id,
        faceRank: 0,
      },
      {
        assetId: inBandLowPhotoId,
        confidence: 0.26,
        assetFaceId: inBandLowFace!.faces[0]!.id,
        faceRank: 0,
      },
      {
        assetId: belowBandPhotoId,
        confidence: 0.24,
        assetFaceId: belowBandFace!.faces[0]!.id,
        faceRank: 0,
      },
    ].map((row) => ({
      asset_id: row.assetId,
      consent_id: consent.consentId,
      tenant_id: context.tenantId,
      project_id: context.projectId,
      confidence: row.confidence,
      matcher_version: "seed",
      source_job_type: "photo_uploaded",
      winning_asset_face_id: row.assetFaceId,
      winning_asset_face_rank: row.faceRank,
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
      likelyAssets.assets.map((asset) => asset.id),
      [inBandHighPhotoId, inBandLowPhotoId],
    );
    assert.deepEqual(
      likelyAssets.assets.map((asset) => asset.candidate_confidence),
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
