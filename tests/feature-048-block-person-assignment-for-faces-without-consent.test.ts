import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";

import { submitConsent } from "../src/lib/consent/submit-consent";
import { getAssetPreviewFaces } from "../src/lib/matching/asset-preview-linking";
import {
  blockAssetFace,
  clearBlockedAssetFace,
  loadCurrentBlockedFacesForAsset,
  hideAssetFace,
  listMatchableProjectPhotosForConsent,
  manualLinkPhotoToConsent,
  reconcilePhotoFaceCanonicalStateForAsset,
} from "../src/lib/matching/consent-photo-matching";
import type { AutoMatcher, AutoMatcherMaterializedFace } from "../src/lib/matching/auto-matcher";
import {
  getAutoMatchCompareVersion,
  getAutoMatchConfidenceThreshold,
  getAutoMatchMaterializerVersion,
} from "../src/lib/matching/auto-match-config";
import { ensureAssetFaceMaterialization } from "../src/lib/matching/face-materialization";

type ProjectContext = {
  tenantId: string;
  projectId: string;
  userId: string;
  consentTemplateId: string;
};

type ConsentContext = {
  consentId: string;
  headshotAssetId: string;
};

type TestFace = {
  faceRank: number;
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

function createMaterializationOnlyMatcher(facesByAssetId: Record<string, TestFace[]>): AutoMatcher {
  return {
    version: "feature-048-materialize-test",
    async match() {
      assert.fail("raw matcher path should not be used in feature 048 tests");
    },
    async materializeAssetFaces(input) {
      const faces = (facesByAssetId[input.assetId] ?? []).map((face) => ({
        faceRank: face.faceRank,
        providerFaceIndex: face.faceRank,
        detectionProbability: 0.99,
        faceBox: {
          xMin: 50 + face.faceRank * 40,
          yMin: 60 + face.faceRank * 50,
          xMax: 150 + face.faceRank * 40,
          yMax: 210 + face.faceRank * 50,
          probability: 0.99,
        },
        embedding: [0.9 - face.faceRank * 0.01, face.faceRank],
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
      assert.fail("embedding compare should not run in feature 048 tests");
    },
  };
}

async function createAuthUserWithRetry(supabase: SupabaseClient) {
  const maxAttempts = 6;
  let lastError: { message?: string; code?: string } | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: `feature048-${randomUUID()}@example.com`,
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

  assert.fail(
    `Unable to create auth user for tests: ${lastError?.code ?? "unknown"} ${lastError?.message ?? "fetch failed"}`,
  );
}

async function createProjectContext(supabase: SupabaseClient): Promise<ProjectContext> {
  const userId = await createAuthUserWithRetry(supabase);

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert({
      name: `Feature 048 Tenant ${randomUUID()}`,
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
      name: `Feature 048 Project ${randomUUID()}`,
      description: "Feature 048 test project",
      status: "active",
    })
    .select("id")
    .single();
  assertNoError(projectError, "insert project");

  const { data: template, error: templateError } = await supabase
    .from("consent_templates")
    .insert({
      template_key: `feature048-template-${randomUUID()}`,
      name: "Feature 048 Template",
      version: "v1",
      version_number: 1,
      body: "Feature 048 template body",
      status: "published",
      created_by: userId,
    })
    .select("id")
    .single();
  assertNoError(templateError, "insert consent template");

  return {
    tenantId: tenant.id as string,
    projectId: project.id as string,
    userId,
    consentTemplateId: template.id as string,
  };
}

async function createAsset(
  supabase: SupabaseClient,
  context: ProjectContext,
  options: {
    assetType: "photo" | "headshot";
  },
) {
  const uploadedAt = new Date().toISOString();
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
      status: "uploaded",
      uploaded_at: uploadedAt,
      asset_type: options.assetType,
      retention_expires_at:
        options.assetType === "headshot"
          ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
          : null,
    })
    .select("id")
    .single();
  assertNoError(error, "insert asset");

  return asset.id as string;
}

async function materializePhotoAsset(
  supabase: SupabaseClient,
  context: ProjectContext,
  assetId: string,
  faces: TestFace[],
) {
  const matcher = createMaterializationOnlyMatcher({
    [assetId]: faces,
  });

  return ensureAssetFaceMaterialization({
    supabase,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId,
    matcher,
    forceRematerialize: true,
    materializerVersion: getAutoMatchMaterializerVersion(),
  });
}

async function createInviteToken(supabase: SupabaseClient, context: ProjectContext) {
  const token = `feature048-invite-${randomUUID()}`;
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

async function createOptedInConsentWithHeadshot(
  supabase: SupabaseClient,
  context: ProjectContext,
): Promise<ConsentContext> {
  const token = await createInviteToken(supabase, context);
  const headshotAssetId = await createAsset(supabase, context, {
    assetType: "headshot",
  });

  const consent = await submitConsent({
    supabase,
    token,
    fullName: "Feature 048 Subject",
    email: `feature048-subject-${randomUUID()}@example.com`,
    faceMatchOptIn: true,
    headshotAssetId,
    captureIp: null,
    captureUserAgent: "feature-048-test",
  });

  return {
    consentId: consent.consentId,
    headshotAssetId,
  };
}

async function getFaceLinks(context: ProjectContext, assetId: string) {
  const { data, error } = await admin
    .from("asset_face_consent_links")
    .select("asset_face_id, consent_id, link_source")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("asset_id", assetId);
  assertNoError(error, "get face links");
  return (data ?? []) as Array<{
    asset_face_id: string;
    consent_id: string;
    link_source: "manual" | "auto";
  }>;
}

async function getFaceSuppressions(context: ProjectContext, assetId: string) {
  const { data: assignees, error: assigneeError } = await admin
    .from("project_face_assignees")
    .select("id, consent_id")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("assignee_kind", "project_consent");
  assertNoError(assigneeError, "get suppression assignees");
  const consentIdByAssigneeId = new Map(
    ((assignees ?? []) as Array<{ id: string; consent_id: string | null }>)
      .filter((row) => typeof row.consent_id === "string" && row.consent_id.length > 0)
      .map((row) => [row.id, row.consent_id as string] as const),
  );

  const { data, error } = await admin
    .from("asset_face_assignee_link_suppressions")
    .select("asset_face_id, project_face_assignee_id, reason")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("asset_id", assetId);
  assertNoError(error, "get face suppressions");
  return ((data ?? []) as Array<{
    asset_face_id: string;
    project_face_assignee_id: string;
    reason: "manual_unlink" | "manual_replace";
  }>)
    .map((row) => ({
      asset_face_id: row.asset_face_id,
      consent_id: consentIdByAssigneeId.get(row.project_face_assignee_id) ?? "",
      reason: row.reason,
    }))
    .filter((row) => row.consent_id.length > 0);
}

async function seedCompareRow(input: {
  context: ProjectContext;
  consentId: string;
  assetId: string;
  headshotMaterializationId: string;
  headshotFaceId: string | null;
  assetMaterializationId: string;
  winningAssetFaceId: string | null;
  winningAssetFaceRank: number | null;
  winningSimilarity: number;
  targetFaceCount: number;
}) {
  const { error } = await admin.from("asset_consent_face_compares").upsert(
    {
      tenant_id: input.context.tenantId,
      project_id: input.context.projectId,
      asset_id: input.assetId,
      consent_id: input.consentId,
      headshot_materialization_id: input.headshotMaterializationId,
      asset_materialization_id: input.assetMaterializationId,
      headshot_face_id: input.headshotFaceId,
      winning_asset_face_id: input.winningAssetFaceId,
      winning_asset_face_rank: input.winningAssetFaceRank,
      winning_similarity: input.winningSimilarity,
      compare_status: "matched",
      compare_version: getAutoMatchCompareVersion(),
      provider: "test-provider",
      provider_mode: "verification_embeddings",
      provider_plugin_versions: {
        calculator: "embedding-test",
      },
      target_face_count: input.targetFaceCount,
      compared_at: new Date().toISOString(),
    },
    {
      onConflict:
        "tenant_id,project_id,consent_id,asset_id,headshot_materialization_id,asset_materialization_id,compare_version",
    },
  );
  assertNoError(error, "seed compare row");
}

async function seedLikelyCandidateRow(input: {
  context: ProjectContext;
  consentId: string;
  assetId: string;
  winningAssetFaceId: string;
  winningAssetFaceRank: number;
  confidence: number;
}) {
  const { error } = await admin.from("asset_consent_match_candidates").upsert(
    {
      tenant_id: input.context.tenantId,
      project_id: input.context.projectId,
      asset_id: input.assetId,
      consent_id: input.consentId,
      confidence: input.confidence,
      matcher_version: getAutoMatchCompareVersion(),
      source_job_type: "reconcile_project",
      last_scored_at: new Date().toISOString(),
      winning_asset_face_id: input.winningAssetFaceId,
      winning_asset_face_rank: input.winningAssetFaceRank,
    },
    {
      onConflict: "asset_id,consent_id",
    },
  );
  assertNoError(error, "seed likely candidate row");
}

test("blocked-face helpers create active state, are idempotent, and clear state", async () => {
  const context = await createProjectContext(admin);
  const assetId = await createAsset(admin, context, { assetType: "photo" });
  const materialized = await materializePhotoAsset(admin, context, assetId, [{ faceRank: 0 }]);
  const assetFaceId = materialized.faces[0]?.id;
  assert.ok(assetFaceId, "expected a current face");

  const firstBlock = await blockAssetFace({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId,
    assetFaceId,
    actorUserId: context.userId,
  });

  assert.equal(firstBlock.kind, "blocked");
  assert.equal(firstBlock.assetFaceId, assetFaceId);
  assert.equal(firstBlock.removedConsentId, null);
  assert.equal(firstBlock.removedLinkSource, null);

  const activeBlockedRows = await loadCurrentBlockedFacesForAsset({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId,
  });

  assert.equal(activeBlockedRows.length, 1);
  assert.equal(activeBlockedRows[0]?.asset_face_id, assetFaceId);
  assert.equal(activeBlockedRows[0]?.reason, "no_consent");
  assert.equal(activeBlockedRows[0]?.cleared_at, null);

  const secondBlock = await blockAssetFace({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId,
    assetFaceId,
    actorUserId: context.userId,
  });

  assert.equal(secondBlock.kind, "already_blocked");

  const clearResult = await clearBlockedAssetFace({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId,
    assetFaceId,
    actorUserId: context.userId,
  });

  assert.equal(clearResult.kind, "cleared");

  const afterClearRows = await loadCurrentBlockedFacesForAsset({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId,
  });
  assert.equal(afterClearRows.length, 0);

  const clearAgain = await clearBlockedAssetFace({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId,
    assetFaceId,
    actorUserId: context.userId,
  });

  assert.equal(clearAgain.kind, "already_cleared");
});

test("blocked-face schema enforces the bounded reason set", async () => {
  const context = await createProjectContext(admin);
  const assetId = await createAsset(admin, context, { assetType: "photo" });
  const materialized = await materializePhotoAsset(admin, context, assetId, [{ faceRank: 0 }]);
  const assetFaceId = materialized.faces[0]?.id;
  assert.ok(assetFaceId, "expected a current face");

  const { error } = await admin.from("asset_face_block_states").insert({
    asset_face_id: assetFaceId,
    asset_materialization_id: materialized.materialization.id,
    asset_id: assetId,
    tenant_id: context.tenantId,
    project_id: context.projectId,
    reason: "something_else",
    blocked_by: context.userId,
  });

  assert.ok(error, "expected invalid block reason to fail");
  assert.equal(error?.code, "23514");
});

test("blocking a manually linked face removes the link and records manual_replace suppression", async () => {
  const context = await createProjectContext(admin);
  const photoAssetId = await createAsset(admin, context, { assetType: "photo" });
  const consent = await createOptedInConsentWithHeadshot(admin, context);
  const photo = await materializePhotoAsset(admin, context, photoAssetId, [{ faceRank: 0 }]);
  const targetFaceId = photo.faces[0]?.id ?? null;
  assert.ok(targetFaceId);

  await manualLinkPhotoToConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    actorUserId: context.userId,
    assetId: photoAssetId,
    assetFaceId: targetFaceId,
    mode: "face",
  });

  const blockResult = await blockAssetFace({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    assetFaceId: targetFaceId,
    actorUserId: context.userId,
  });

  assert.equal(blockResult.kind, "blocked");
  assert.equal(blockResult.removedConsentId, consent.consentId);
  assert.equal(blockResult.removedLinkSource, "manual");
  assert.equal((await getFaceLinks(context, photoAssetId)).length, 0);

  const suppressions = await getFaceSuppressions(context, photoAssetId);
  assert.equal(suppressions.length, 1);
  assert.equal(suppressions[0]?.asset_face_id, targetFaceId);
  assert.equal(suppressions[0]?.consent_id, consent.consentId);
  assert.equal(suppressions[0]?.reason, "manual_replace");
});

test("manual linking to a blocked face clears the block before saving the new link", async () => {
  const context = await createProjectContext(admin);
  const photoAssetId = await createAsset(admin, context, { assetType: "photo" });
  const consent = await createOptedInConsentWithHeadshot(admin, context);
  const photo = await materializePhotoAsset(admin, context, photoAssetId, [{ faceRank: 0 }]);
  const targetFaceId = photo.faces[0]?.id ?? null;
  assert.ok(targetFaceId);

  await blockAssetFace({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    assetFaceId: targetFaceId,
    actorUserId: context.userId,
  });
  assert.equal(
    (
      await loadCurrentBlockedFacesForAsset({
        supabase: admin,
        tenantId: context.tenantId,
        projectId: context.projectId,
        assetId: photoAssetId,
      })
    ).length,
    1,
  );

  const linkResult = await manualLinkPhotoToConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    actorUserId: context.userId,
    assetId: photoAssetId,
    assetFaceId: targetFaceId,
    mode: "face",
  });

  assert.equal(linkResult.kind, "linked");
  assert.equal(linkResult.assetFaceId, targetFaceId);
  assert.equal((await loadCurrentBlockedFacesForAsset({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
  })).length, 0);

  const links = await getFaceLinks(context, photoAssetId);
  assert.equal(links.length, 1);
  assert.equal(links[0]?.asset_face_id, targetFaceId);
  assert.equal(links[0]?.consent_id, consent.consentId);
  assert.equal(links[0]?.link_source, "manual");
});

test("hiding a blocked face requires clearing the block first", async () => {
  const context = await createProjectContext(admin);
  const photoAssetId = await createAsset(admin, context, { assetType: "photo" });
  const photo = await materializePhotoAsset(admin, context, photoAssetId, [{ faceRank: 0 }]);
  const targetFaceId = photo.faces[0]?.id ?? null;
  assert.ok(targetFaceId);

  await blockAssetFace({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    assetFaceId: targetFaceId,
    actorUserId: context.userId,
  });

  await assert.rejects(
    () =>
      hideAssetFace({
        supabase: admin,
        tenantId: context.tenantId,
        projectId: context.projectId,
        assetId: photoAssetId,
        assetFaceId: targetFaceId,
        actorUserId: context.userId,
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      return "code" in error && error.code === "blocked_face_clear_required";
    },
  );
});

test("blocking a hidden face requires restoring the face first", async () => {
  const context = await createProjectContext(admin);
  const photoAssetId = await createAsset(admin, context, { assetType: "photo" });
  const photo = await materializePhotoAsset(admin, context, photoAssetId, [{ faceRank: 0 }]);
  const targetFaceId = photo.faces[0]?.id ?? null;
  assert.ok(targetFaceId);

  await hideAssetFace({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    assetFaceId: targetFaceId,
    actorUserId: context.userId,
  });

  await assert.rejects(
    () =>
      blockAssetFace({
        supabase: admin,
        tenantId: context.tenantId,
        projectId: context.projectId,
        assetId: photoAssetId,
        assetFaceId: targetFaceId,
        actorUserId: context.userId,
      }),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      return "code" in error && error.code === "hidden_face_restore_required";
    },
  );
});

test("blocking an auto-linked face removes the auto link and keeps the blocked face out of later auto reconciliation", async () => {
  const context = await createProjectContext(admin);
  const photoAssetId = await createAsset(admin, context, { assetType: "photo" });
  const consent = await createOptedInConsentWithHeadshot(admin, context);
  const photo = await materializePhotoAsset(admin, context, photoAssetId, [{ faceRank: 0 }]);
  const headshot = await materializePhotoAsset(admin, context, consent.headshotAssetId, [{ faceRank: 0 }]);
  const photoFaceId = photo.faces[0]?.id ?? null;
  const headshotFaceId = headshot.faces[0]?.id ?? null;
  assert.ok(photoFaceId);
  assert.ok(headshotFaceId);

  await seedCompareRow({
    context,
    consentId: consent.consentId,
    assetId: photoAssetId,
    headshotMaterializationId: headshot.materialization.id,
    headshotFaceId,
    assetMaterializationId: photo.materialization.id,
    winningAssetFaceId: photoFaceId,
    winningAssetFaceRank: 0,
    winningSimilarity: Math.max(getAutoMatchConfidenceThreshold() + 0.05, 0.8),
    targetFaceCount: 1,
  });

  await reconcilePhotoFaceCanonicalStateForAsset({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
  });

  let links = await getFaceLinks(context, photoAssetId);
  assert.equal(links.length, 1);
  assert.equal(links[0]?.link_source, "auto");

  const blockResult = await blockAssetFace({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    assetFaceId: photoFaceId,
    actorUserId: context.userId,
  });
  assert.equal(blockResult.removedLinkSource, "auto");
  assert.equal((await getFaceLinks(context, photoAssetId)).length, 0);

  await reconcilePhotoFaceCanonicalStateForAsset({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
  });

  links = await getFaceLinks(context, photoAssetId);
  assert.equal(links.length, 0);
  assert.equal((await loadCurrentBlockedFacesForAsset({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
  })).length, 1);
});

test("blocked faces are excluded from likely-match asset surfacing", async () => {
  const context = await createProjectContext(admin);
  const photoAssetId = await createAsset(admin, context, { assetType: "photo" });
  const consent = await createOptedInConsentWithHeadshot(admin, context);
  const photo = await materializePhotoAsset(admin, context, photoAssetId, [{ faceRank: 0 }]);
  const targetFaceId = photo.faces[0]?.id ?? null;
  assert.ok(targetFaceId);

  const threshold = getAutoMatchConfidenceThreshold();
  await seedLikelyCandidateRow({
    context,
    consentId: consent.consentId,
    assetId: photoAssetId,
    winningAssetFaceId: targetFaceId,
    winningAssetFaceRank: 0,
    confidence: Math.max(0.26, Math.min(threshold - 0.01, 0.4)),
  });

  const beforeBlock = await listMatchableProjectPhotosForConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    mode: "likely",
  });
  assert.equal(beforeBlock.assets.length, 1);
  assert.equal(beforeBlock.assets[0]?.id, photoAssetId);

  await blockAssetFace({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    assetFaceId: targetFaceId,
    actorUserId: context.userId,
  });

  const afterBlock = await listMatchableProjectPhotosForConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    mode: "likely",
  });
  assert.equal(afterBlock.assets.length, 0);
});

test("preview faces expose blocked state while keeping the blocked face visible", async () => {
  const context = await createProjectContext(admin);
  const photoAssetId = await createAsset(admin, context, { assetType: "photo" });
  const photo = await materializePhotoAsset(admin, context, photoAssetId, [{ faceRank: 0 }, { faceRank: 1 }]);
  const blockedFaceId = photo.faces[0]?.id ?? null;
  const visibleFaceId = photo.faces[1]?.id ?? null;
  assert.ok(blockedFaceId);
  assert.ok(visibleFaceId);

  await blockAssetFace({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    assetFaceId: blockedFaceId,
    actorUserId: context.userId,
  });

  const preview = await getAssetPreviewFaces({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    requestHostHeader: "localhost",
  });

  assert.equal(preview.detectedFaceCount, 2);
  assert.equal(preview.faces.length, 2);
  const blockedFace = preview.faces.find((face) => face.assetFaceId === blockedFaceId) ?? null;
  const unlinkedFace = preview.faces.find((face) => face.assetFaceId === visibleFaceId) ?? null;
  assert.ok(blockedFace);
  assert.ok(unlinkedFace);
  assert.equal(blockedFace?.faceState, "blocked");
  assert.equal(blockedFace?.blockedReason, "no_consent");
  assert.ok(blockedFace?.blockedAt);
  assert.equal(blockedFace?.currentLink, null);
  assert.equal(unlinkedFace?.faceState, "unlinked");
});
