import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";

import { submitConsent } from "../src/lib/consent/submit-consent";
import {
  getAssetPreviewFaceCandidates,
  getAssetPreviewFaces,
} from "../src/lib/matching/asset-preview-linking";
import {
  hideAssetFace,
  listLinkedFaceOverlaysForAssetIds,
  listMatchableProjectPhotosForConsent,
  listPhotoConsentAssignmentsForAssetIds,
  loadCurrentHiddenFacesForAsset,
  manualLinkPhotoToConsent,
  reconcilePhotoFaceCanonicalStateForAsset,
  restoreHiddenAssetFace,
} from "../src/lib/matching/consent-photo-matching";
import {
  getAutoMatchCompareVersion,
  getAutoMatchConfidenceThreshold,
  getAutoMatchMaterializerVersion,
} from "../src/lib/matching/auto-match-config";
import type { AutoMatcher, AutoMatcherMaterializedFace } from "../src/lib/matching/auto-matcher";
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
    version: "feature-045-materialize-test",
    async match() {
      assert.fail("raw matcher path should not be used in feature 045 tests");
    },
    async materializeAssetFaces(input) {
      const faces = (facesByAssetId[input.assetId] ?? []).map((face) => ({
        faceRank: face.faceRank,
        providerFaceIndex: face.faceRank,
        detectionProbability: 0.99,
        faceBox: {
          xMin: 40 + face.faceRank * 60,
          yMin: 50 + face.faceRank * 80,
          xMax: 140 + face.faceRank * 60,
          yMax: 190 + face.faceRank * 80,
          probability: 0.99,
        },
        embedding: [0.91 - face.faceRank * 0.01, face.faceRank],
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
      assert.fail("embedding compare should not run in feature 045 tests");
    },
  };
}

async function createAuthUserWithRetry(supabase: SupabaseClient) {
  const maxAttempts = 6;
  let lastError: { message?: string; code?: string } | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: `feature045-${randomUUID()}@example.com`,
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
      name: `Feature 045 Tenant ${randomUUID()}`,
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
      name: `Feature 045 Project ${randomUUID()}`,
      description: "Feature 045 test project",
      status: "active",
    })
    .select("id")
    .single();
  assertNoError(projectError, "insert project");

  const { data: template, error: templateError } = await supabase
    .from("consent_templates")
    .insert({
      template_key: `feature045-template-${randomUUID()}`,
      name: "Feature 045 Template",
      version: "v1",
      version_number: 1,
      body: "Feature 045 template body",
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
    retentionDays?: number;
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
        options.assetType === "headshot" && options.retentionDays
          ? new Date(Date.now() + options.retentionDays * 24 * 60 * 60 * 1000).toISOString()
          : null,
    })
    .select("id")
    .single();
  assertNoError(error, "insert asset");
  return asset.id as string;
}

async function createInviteToken(supabase: SupabaseClient, context: ProjectContext) {
  const token = `feature045-invite-${randomUUID()}`;
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
    retentionDays: 30,
  });

  const consent = await submitConsent({
    supabase,
    token,
    fullName: "Feature 045 Subject",
    email: `feature045-subject-${randomUUID()}@example.com`,
    faceMatchOptIn: true,
    headshotAssetId,
    captureIp: null,
    captureUserAgent: "feature-045-test",
  });

  return {
    consentId: consent.consentId,
    headshotAssetId,
  };
}

async function materializeAsset(
  context: ProjectContext,
  assetId: string,
  faces: TestFace[],
  options?: { forceRematerialize?: boolean },
) {
  const current = await ensureAssetFaceMaterialization({
    supabase: admin,
    matcher: createMaterializationOnlyMatcher({
      [assetId]: faces,
    }),
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId,
    materializerVersion: getAutoMatchMaterializerVersion(),
    includeFaces: true,
    forceRematerialize: options?.forceRematerialize ?? false,
  });

  if (!current) {
    assert.fail(`Expected materialization for asset ${assetId}`);
  }

  return current;
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

async function seedCompareFaceScoreRow(input: {
  context: ProjectContext;
  consentId: string;
  assetId: string;
  headshotMaterializationId: string;
  assetMaterializationId: string;
  assetFaceId: string;
  assetFaceRank: number;
  similarity: number;
}) {
  const { error } = await admin.from("asset_consent_face_compare_scores").upsert(
    {
      tenant_id: input.context.tenantId,
      project_id: input.context.projectId,
      asset_id: input.assetId,
      consent_id: input.consentId,
      headshot_materialization_id: input.headshotMaterializationId,
      asset_materialization_id: input.assetMaterializationId,
      asset_face_id: input.assetFaceId,
      asset_face_rank: input.assetFaceRank,
      similarity: input.similarity,
      compare_version: getAutoMatchCompareVersion(),
      provider: "test-provider",
      provider_mode: "verification_embeddings",
      provider_plugin_versions: {
        calculator: "embedding-test",
      },
      compared_at: new Date().toISOString(),
    },
    {
      onConflict:
        "tenant_id,project_id,consent_id,asset_id,headshot_materialization_id,asset_materialization_id,asset_face_id,compare_version",
    },
  );
  assertNoError(error, "seed compare face score row");
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

async function insertHiddenFaceRow(input: {
  context: ProjectContext;
  assetId: string;
  assetMaterializationId: string;
  assetFaceId: string;
}) {
  const { error } = await admin.from("asset_face_hidden_states").insert({
    asset_face_id: input.assetFaceId,
    asset_materialization_id: input.assetMaterializationId,
    asset_id: input.assetId,
    tenant_id: input.context.tenantId,
    project_id: input.context.projectId,
    reason: "manual_hide",
    hidden_by: input.context.userId,
  });
  assertNoError(error, "insert hidden face row");
}

test("hide and restore remove active exact links and keep restored faces unlinked", async () => {
  const context = await createProjectContext(admin);
  const photoAssetId = await createAsset(admin, context, { assetType: "photo" });
  const consent = await createOptedInConsentWithHeadshot(admin, context);
  const photo = await materializeAsset(context, photoAssetId, [{ faceRank: 0 }, { faceRank: 1 }]);
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

  const hideResult = await hideAssetFace({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    assetFaceId: targetFaceId,
    actorUserId: context.userId,
  });

  assert.equal(hideResult.kind, "hidden");
  assert.equal(hideResult.removedConsentId, consent.consentId);
  assert.equal(hideResult.removedLinkSource, "manual");
  assert.equal((await getFaceLinks(context, photoAssetId)).length, 0);

  const suppressions = await getFaceSuppressions(context, photoAssetId);
  assert.equal(suppressions.length, 1);
  assert.equal(suppressions[0]?.asset_face_id, targetFaceId);
  assert.equal(suppressions[0]?.consent_id, consent.consentId);
  assert.equal(suppressions[0]?.reason, "manual_unlink");

  const hiddenRows = await loadCurrentHiddenFacesForAsset({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
  });
  assert.equal(hiddenRows.length, 1);
  assert.equal(hiddenRows[0]?.asset_face_id, targetFaceId);

  const assignmentsAfterHide = await listPhotoConsentAssignmentsForAssetIds({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetIds: [photoAssetId],
  });
  assert.equal(assignmentsAfterHide.length, 0);
  assert.equal(
    (
      await listLinkedFaceOverlaysForAssetIds({
        supabase: admin,
        tenantId: context.tenantId,
        projectId: context.projectId,
        assetIds: [photoAssetId],
      })
    ).length,
    0,
  );

  const restoreResult = await restoreHiddenAssetFace({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    assetFaceId: targetFaceId,
    actorUserId: context.userId,
  });
  assert.equal(restoreResult.kind, "restored");
  assert.equal((await loadCurrentHiddenFacesForAsset({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
  })).length, 0);
  assert.equal((await getFaceLinks(context, photoAssetId)).length, 0);

  const secondRestore = await restoreHiddenAssetFace({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    assetFaceId: targetFaceId,
    actorUserId: context.userId,
  });
  assert.equal(secondRestore.kind, "already_restored");
});

test("assignment and overlay helpers exclude hidden faces from active asset summaries", async () => {
  const context = await createProjectContext(admin);
  const photoAssetId = await createAsset(admin, context, { assetType: "photo" });
  const consent = await createOptedInConsentWithHeadshot(admin, context);
  const photo = await materializeAsset(context, photoAssetId, [{ faceRank: 0 }]);
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

  await insertHiddenFaceRow({
    context,
    assetId: photoAssetId,
    assetMaterializationId: photo.materialization.id,
    assetFaceId: targetFaceId,
  });

  const assignments = await listPhotoConsentAssignmentsForAssetIds({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetIds: [photoAssetId],
  });
  assert.equal(assignments.length, 0);

  const overlays = await listLinkedFaceOverlaysForAssetIds({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetIds: [photoAssetId],
  });
  assert.equal(overlays.length, 0);
});

test("preview faces response includes linked, unlinked, and hidden detected faces with active summary counts", async () => {
  const context = await createProjectContext(admin);
  const photoAssetId = await createAsset(admin, context, { assetType: "photo" });
  const manualConsent = await createOptedInConsentWithHeadshot(admin, context);
  const autoConsent = await createOptedInConsentWithHeadshot(admin, context);
  const photo = await materializeAsset(context, photoAssetId, [
    { faceRank: 0 },
    { faceRank: 1 },
    { faceRank: 2 },
    { faceRank: 3 },
  ]);
  const autoHeadshot = await materializeAsset(context, autoConsent.headshotAssetId, [{ faceRank: 0 }]);

  const manualFaceId = photo.faces[0]?.id ?? null;
  const autoFaceId = photo.faces[1]?.id ?? null;
  const hiddenFaceId = photo.faces[2]?.id ?? null;
  const unlinkedFaceId = photo.faces[3]?.id ?? null;
  const autoHeadshotFaceId = autoHeadshot.faces[0]?.id ?? null;
  assert.ok(manualFaceId);
  assert.ok(autoFaceId);
  assert.ok(hiddenFaceId);
  assert.ok(unlinkedFaceId);
  assert.ok(autoHeadshotFaceId);

  await manualLinkPhotoToConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: manualConsent.consentId,
    actorUserId: context.userId,
    assetId: photoAssetId,
    assetFaceId: manualFaceId,
    mode: "face",
  });
  await seedCompareRow({
    context,
    consentId: autoConsent.consentId,
    assetId: photoAssetId,
    headshotMaterializationId: autoHeadshot.materialization.id,
    headshotFaceId: autoHeadshotFaceId,
    assetMaterializationId: photo.materialization.id,
    winningAssetFaceId: autoFaceId,
    winningAssetFaceRank: 1,
    winningSimilarity: Math.max(getAutoMatchConfidenceThreshold() + 0.05, 0.8),
    targetFaceCount: 4,
  });
  await reconcilePhotoFaceCanonicalStateForAsset({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
  });
  await hideAssetFace({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    assetFaceId: hiddenFaceId,
    actorUserId: context.userId,
  });

  const preview = await getAssetPreviewFaces({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    requestHostHeader: "localhost",
  });

  assert.equal(preview.materializationId, photo.materialization.id);
  assert.equal(preview.detectedFaceCount, 4);
  assert.equal(preview.activeLinkedFaceCount, 2);
  assert.equal(preview.hiddenFaceCount, 1);
  assert.equal(preview.faces.length, 4);

  const faceById = new Map(preview.faces.map((face) => [face.assetFaceId, face] as const));
  assert.equal(faceById.get(manualFaceId)?.faceState, "linked_manual");
  assert.equal(faceById.get(manualFaceId)?.currentLink?.consentId, manualConsent.consentId);
  assert.equal(faceById.get(autoFaceId)?.faceState, "linked_auto");
  assert.equal(faceById.get(autoFaceId)?.currentLink?.consentId, autoConsent.consentId);
  assert.equal(faceById.get(hiddenFaceId)?.faceState, "hidden");
  assert.equal(faceById.get(hiddenFaceId)?.currentLink, null);
  assert.ok(faceById.get(hiddenFaceId)?.hiddenAt);
  assert.equal(faceById.get(unlinkedFaceId)?.faceState, "unlinked");
  assert.equal(faceById.get(unlinkedFaceId)?.currentLink, null);
});

test("preview face candidates rank compare rows first, likely rows second, and append unscored active consents", async () => {
  const context = await createProjectContext(admin);
  const photoAssetId = await createAsset(admin, context, { assetType: "photo" });
  const compareConsent = await createOptedInConsentWithHeadshot(admin, context);
  const likelyConsent = await createOptedInConsentWithHeadshot(admin, context);
  const fallbackConsent = await createOptedInConsentWithHeadshot(admin, context);
  const linkedConsent = await createOptedInConsentWithHeadshot(admin, context);
  const photo = await materializeAsset(context, photoAssetId, [{ faceRank: 0 }, { faceRank: 1 }]);
  const compareHeadshot = await materializeAsset(context, compareConsent.headshotAssetId, [{ faceRank: 0 }]);
  const fallbackHeadshot = await materializeAsset(context, fallbackConsent.headshotAssetId, [{ faceRank: 0 }]);
  const linkedHeadshot = await materializeAsset(context, linkedConsent.headshotAssetId, [{ faceRank: 0 }]);

  const selectedFaceId = photo.faces[0]?.id ?? null;
  const linkedFaceId = photo.faces[1]?.id ?? null;
  const compareHeadshotFaceId = compareHeadshot.faces[0]?.id ?? null;
  assert.ok(selectedFaceId);
  assert.ok(linkedFaceId);
  assert.ok(compareHeadshotFaceId);

  await manualLinkPhotoToConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: linkedConsent.consentId,
    actorUserId: context.userId,
    assetId: photoAssetId,
    assetFaceId: linkedFaceId,
    mode: "face",
  });
  await seedCompareRow({
    context,
    consentId: compareConsent.consentId,
    assetId: photoAssetId,
    headshotMaterializationId: compareHeadshot.materialization.id,
    headshotFaceId: compareHeadshotFaceId,
    assetMaterializationId: photo.materialization.id,
    winningAssetFaceId: selectedFaceId,
    winningAssetFaceRank: 0,
    winningSimilarity: 0.91,
    targetFaceCount: 2,
  });
  await seedCompareFaceScoreRow({
    context,
    consentId: linkedConsent.consentId,
    assetId: photoAssetId,
    headshotMaterializationId: linkedHeadshot.materialization.id,
    assetMaterializationId: photo.materialization.id,
    assetFaceId: selectedFaceId,
    assetFaceRank: 0,
    similarity: 0.67,
  });
  await seedCompareFaceScoreRow({
    context,
    consentId: fallbackConsent.consentId,
    assetId: photoAssetId,
    headshotMaterializationId: fallbackHeadshot.materialization.id,
    assetMaterializationId: photo.materialization.id,
    assetFaceId: selectedFaceId,
    assetFaceRank: 0,
    similarity: 0.22,
  });
  await seedLikelyCandidateRow({
    context,
    consentId: likelyConsent.consentId,
    assetId: photoAssetId,
    winningAssetFaceId: selectedFaceId,
    winningAssetFaceRank: 0,
    confidence: 0.43,
  });

  const candidates = await getAssetPreviewFaceCandidates({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    assetFaceId: selectedFaceId,
    requestHostHeader: "localhost",
  });

  assert.equal(candidates.assetId, photoAssetId);
  assert.equal(candidates.materializationId, photo.materialization.id);
  assert.equal(candidates.assetFaceId, selectedFaceId);
  assert.equal(candidates.candidates[0]?.consentId, compareConsent.consentId);
  assert.equal(candidates.candidates[0]?.scoreSource, "current_compare");
  assert.equal(candidates.candidates[0]?.rank, 1);
  assert.equal(candidates.candidates[0]?.similarityScore, 0.91);
  assert.equal(candidates.candidates[1]?.consentId, linkedConsent.consentId);
  assert.equal(candidates.candidates[1]?.scoreSource, "current_compare");
  assert.equal(candidates.candidates[1]?.rank, 2);
  assert.equal(candidates.candidates[1]?.similarityScore, 0.67);
  assert.equal(candidates.candidates[2]?.consentId, likelyConsent.consentId);
  assert.equal(candidates.candidates[2]?.scoreSource, "likely_candidate");
  assert.equal(candidates.candidates[2]?.rank, 3);
  assert.equal(candidates.candidates[2]?.similarityScore, 0.43);

  const linkedCandidate = candidates.candidates.find((candidate) => candidate.consentId === linkedConsent.consentId) ?? null;
  const fallbackCandidate = candidates.candidates.find((candidate) => candidate.consentId === fallbackConsent.consentId) ?? null;
  assert.ok(linkedCandidate);
  assert.ok(fallbackCandidate);
  assert.equal(linkedCandidate?.scoreSource, "current_compare");
  assert.equal(linkedCandidate?.rank, 2);
  assert.equal(linkedCandidate?.similarityScore, 0.67);
  assert.equal(linkedCandidate?.currentAssetLink?.assetFaceId, linkedFaceId);
  assert.equal(fallbackCandidate?.scoreSource, "current_compare");
  assert.equal(fallbackCandidate?.rank, 4);
  assert.equal(fallbackCandidate?.similarityScore, 0.22);
});

test("hidden faces are excluded from likely-match asset surfacing", async () => {
  const context = await createProjectContext(admin);
  const photoAssetId = await createAsset(admin, context, { assetType: "photo" });
  const consent = await createOptedInConsentWithHeadshot(admin, context);
  const photo = await materializeAsset(context, photoAssetId, [{ faceRank: 0 }]);
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

  const beforeHide = await listMatchableProjectPhotosForConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    mode: "likely",
  });
  assert.equal(beforeHide.assets.length, 1);
  assert.equal(beforeHide.assets[0]?.id, photoAssetId);

  await hideAssetFace({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    assetFaceId: targetFaceId,
    actorUserId: context.userId,
  });

  const afterHide = await listMatchableProjectPhotosForConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    mode: "likely",
  });
  assert.equal(afterHide.assets.length, 0);
});

test("hidden faces stay excluded from auto reconciliation after an auto winner is hidden", async () => {
  const context = await createProjectContext(admin);
  const photoAssetId = await createAsset(admin, context, { assetType: "photo" });
  const consent = await createOptedInConsentWithHeadshot(admin, context);
  const photo = await materializeAsset(context, photoAssetId, [{ faceRank: 0 }]);
  const headshot = await materializeAsset(context, consent.headshotAssetId, [{ faceRank: 0 }]);
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
  assert.equal((await getFaceLinks(context, photoAssetId)).length, 1);
  assert.equal((await getFaceLinks(context, photoAssetId))[0]?.link_source, "auto");

  const hideResult = await hideAssetFace({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    assetFaceId: photoFaceId,
    actorUserId: context.userId,
  });
  assert.equal(hideResult.removedLinkSource, "auto");
  assert.equal((await getFaceLinks(context, photoAssetId)).length, 0);

  await reconcilePhotoFaceCanonicalStateForAsset({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
  });
  assert.equal((await getFaceLinks(context, photoAssetId)).length, 0);
  assert.equal(
    (
      await loadCurrentHiddenFacesForAsset({
        supabase: admin,
        tenantId: context.tenantId,
        projectId: context.projectId,
        assetId: photoAssetId,
      })
    ).length,
    1,
  );
});
