import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";

import { submitConsent } from "../src/lib/consent/submit-consent";
import { getInitialSelectedFaceId } from "../src/lib/client/face-review-selection";
import { getContainedImageRect, getFaceOverlayStyle } from "../src/lib/client/face-overlay";
import { signFaceDerivativeUrl } from "../src/lib/assets/sign-face-derivatives";
import type { AutoMatcher, AutoMatcherMaterializedFace } from "../src/lib/matching/auto-matcher";
import { getAutoMatchCompareVersion, getAutoMatchMaterializerVersion } from "../src/lib/matching/auto-match-config";
import { serializeFaceReviewSessionResponse } from "../src/lib/matching/face-review-response";
import {
  applyFaceReviewSessionItemAction,
  getCurrentFaceReviewSession,
  getFaceReviewSession,
  prepareFaceReviewSession,
} from "../src/lib/matching/face-review-sessions";
import { ensureAssetFaceMaterialization } from "../src/lib/matching/face-materialization";
import {
  getManualPhotoLinkState,
  listLinkedFaceOverlaysForAssetIds,
  manualLinkPhotoToConsent,
} from "../src/lib/matching/photo-face-linking";

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

async function createAuthUserWithRetry(supabase: SupabaseClient) {
  const maxAttempts = 6;
  let lastError: { message?: string; code?: string } | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: `feature032-${randomUUID()}@example.com`,
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
      name: `Feature 032 Tenant ${randomUUID()}`,
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
      name: `Feature 032 Project ${randomUUID()}`,
      description: "Feature 032 test project",
      status: "active",
    })
    .select("id")
    .single();
  assertNoError(projectError, "insert project");

  const { data: template, error: templateError } = await supabase
    .from("consent_templates")
    .insert({
      template_key: `feature032-template-${randomUUID()}`,
      name: "Feature 032 Template",
      version: "v1",
      version_number: 1,
      body: "Feature 032 template body",
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
  options?: {
    assetType?: "photo" | "headshot";
    retentionDays?: number;
  },
) {
  const uploadedAt = new Date().toISOString();
  const assetType = options?.assetType ?? "photo";
  const { data: asset, error } = await supabase
    .from("assets")
    .insert({
      tenant_id: context.tenantId,
      project_id: context.projectId,
      created_by: context.userId,
      storage_bucket: "project-assets",
      storage_path: `tenant/${context.tenantId}/project/${context.projectId}/asset/${randomUUID()}/test.jpg`,
      original_filename: `${assetType}-${randomUUID()}.jpg`,
      content_type: "image/jpeg",
      file_size_bytes: 2048,
      content_hash: randomUUID().replaceAll("-", ""),
      content_hash_algo: "sha256",
      asset_type: assetType,
      status: "uploaded",
      uploaded_at: uploadedAt,
      retention_expires_at:
        assetType === "headshot" && options?.retentionDays
          ? new Date(Date.now() + options.retentionDays * 24 * 60 * 60 * 1000).toISOString()
          : null,
    })
    .select("id")
    .single();
  assertNoError(error, "insert photo asset");
  return asset.id as string;
}

async function createInviteToken(supabase: SupabaseClient, context: ProjectContext) {
  const token = `feature032-invite-${randomUUID()}`;
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
  headshotAssetId?: string,
): Promise<ConsentContext> {
  const token = await createInviteToken(supabase, context);
  const resolvedHeadshotAssetId =
    headshotAssetId ??
    (await createAsset(supabase, context, {
      assetType: "headshot",
      retentionDays: 30,
    }));

  const consent = await submitConsent({
    supabase,
    token,
    fullName: "Feature 032 Subject",
    email: `feature032-subject-${randomUUID()}@example.com`,
    faceMatchOptIn: true,
    headshotAssetId: resolvedHeadshotAssetId,
    captureIp: null,
    captureUserAgent: "feature-032-test",
  });

  return {
    consentId: consent.consentId,
    headshotAssetId: resolvedHeadshotAssetId,
  };
}

async function createReviewCropBuffer() {
  return sharp({
    create: {
      width: 96,
      height: 96,
      channels: 3,
      background: { r: 120, g: 80, b: 40 },
    },
  })
    .webp({ quality: 82 })
    .toBuffer();
}

function createMaterializationMatcher(): AutoMatcher {
  return {
    version: "feature-032-materialization-test",
    async match() {
      assert.fail("raw match should not run in feature 032 tests");
    },
    async materializeAssetFaces() {
      const reviewCrop = await createReviewCropBuffer();
      return {
        sourceImage: {
          width: 1200,
          height: 800,
          coordinateSpace: "oriented_original",
        },
        faces: [
          {
            faceRank: 0,
            providerFaceIndex: 0,
            detectionProbability: 0.98,
            faceBox: {
              xMin: 100,
              yMin: 50,
              xMax: 400,
              yMax: 350,
              probability: 0.98,
            },
            normalizedFaceBox: {
              xMin: 100 / 1200,
              yMin: 50 / 800,
              xMax: 400 / 1200,
              yMax: 350 / 800,
              probability: 0.98,
            },
            reviewCrop: {
              derivativeKind: "review_square_256",
              contentType: "image/webp",
              data: reviewCrop,
              width: 256,
              height: 256,
            },
            embedding: [0.12, 0.34, 0.56],
          },
        ] satisfies AutoMatcherMaterializedFace[],
        providerMetadata: {
          provider: "test-provider",
          providerMode: "detection",
          providerPluginVersions: {
            detector: "retinaface-test",
          },
        },
      };
    },
    async compareEmbeddings() {
      assert.fail("embedding compare should not run in feature 032 tests");
    },
  };
}

function createFaceMaterializationMatcher(facesByAssetId: Record<string, TestFace[]>): AutoMatcher {
  return {
    version: "feature-032-face-session-test",
    async match() {
      assert.fail("raw match should not run in feature 032 tests");
    },
    async materializeAssetFaces(input) {
      const sourceImage = {
        width: 1200,
        height: 800,
        coordinateSpace: "oriented_original" as const,
      };
      const faces = await Promise.all(
        (facesByAssetId[input.assetId] ?? []).map(async (face) => {
          const xMin = 80 + face.faceRank * 220;
          const yMin = 60 + face.faceRank * 90;
          const xMax = xMin + 220;
          const yMax = yMin + 240;
          return {
            faceRank: face.faceRank,
            providerFaceIndex: face.faceRank,
            detectionProbability: 0.99,
            faceBox: {
              xMin,
              yMin,
              xMax,
              yMax,
              probability: 0.99,
            },
            normalizedFaceBox: {
              xMin: xMin / sourceImage.width,
              yMin: yMin / sourceImage.height,
              xMax: xMax / sourceImage.width,
              yMax: yMax / sourceImage.height,
              probability: 0.99,
            },
            reviewCrop: {
              derivativeKind: "review_square_256" as const,
              contentType: "image/webp",
              data: await createReviewCropBuffer(),
              width: 256,
              height: 256,
            },
            embedding: [0.7, face.faceRank + 0.1],
          } satisfies AutoMatcherMaterializedFace;
        }),
      );

      return {
        sourceImage,
        faces,
        providerMetadata: {
          provider: "test-provider",
          providerMode: "detection",
          providerPluginVersions: {
            detector: "retinaface-test",
          },
        },
      };
    },
    async compareEmbeddings() {
      assert.fail("embedding compare should not run in feature 032 tests");
    },
  };
}

async function materializeAsset(
  context: ProjectContext,
  assetId: string,
  faces: TestFace[],
) {
  const current = await ensureAssetFaceMaterialization({
    supabase: admin,
    matcher: createFaceMaterializationMatcher({
      [assetId]: faces,
    }),
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId,
    materializerVersion: getAutoMatchMaterializerVersion(),
    includeFaces: true,
  });

  if (!current) {
    assert.fail(`Expected materialization for asset ${assetId}`);
  }

  return current;
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

test("materialization persists normalized face boxes and signs persisted review crop derivatives", async () => {
  const context = await createProjectContext(admin);
  const assetId = await createAsset(admin, context);

  const ensured = await ensureAssetFaceMaterialization({
    supabase: admin,
    matcher: createMaterializationMatcher(),
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId,
    includeFaces: true,
  });

  assert.ok(ensured);
  assert.equal(ensured?.materialization.source_image_width, 1200);
  assert.equal(ensured?.materialization.source_image_height, 800);
  assert.equal(ensured?.materialization.source_coordinate_space, "oriented_original");
  assert.equal(ensured?.faces.length, 1);

  const face = ensured?.faces[0];
  assert.ok(face?.face_box_normalized);
  assert.deepEqual(face?.face_box_normalized, {
    x_min: 100 / 1200,
    y_min: 50 / 800,
    x_max: 400 / 1200,
    y_max: 350 / 800,
    probability: 0.98,
  });

  const { data: derivatives, error: derivativeError } = await admin
    .from("asset_face_image_derivatives")
    .select("asset_face_id, derivative_kind, storage_bucket, storage_path, width, height")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("asset_id", assetId);
  assertNoError(derivativeError, "select face derivatives");
  assert.equal(derivatives?.length ?? 0, 1);
  assert.equal(derivatives?.[0]?.asset_face_id, face?.id);
  assert.equal(derivatives?.[0]?.derivative_kind, "review_square_256");
  assert.equal(derivatives?.[0]?.storage_bucket, "asset-face-derivatives");
  assert.equal(derivatives?.[0]?.width, 256);
  assert.equal(derivatives?.[0]?.height, 256);

  const signedUrl = await signFaceDerivativeUrl({
    asset_face_id: derivatives?.[0]?.asset_face_id as string,
    derivative_kind: "review_square_256",
    storage_bucket: derivatives?.[0]?.storage_bucket as string,
    storage_path: derivatives?.[0]?.storage_path as string,
  });

  assert.ok(signedUrl);
  assert.match(String(signedUrl), /asset-face-derivatives/);
});

test("prepare review session classifies zero-face, one-face, and multi-face assets and reuses the same session", async () => {
  const context = await createProjectContext(admin);
  const consent = await createOptedInConsentWithHeadshot(admin, context);
  const zeroFaceAssetId = await createAsset(admin, context);
  const oneFaceAssetId = await createAsset(admin, context);
  const multiFaceAssetId = await createAsset(admin, context);

  await materializeAsset(context, zeroFaceAssetId, []);
  const oneFace = await materializeAsset(context, oneFaceAssetId, [{ faceRank: 0 }]);
  const multiFace = await materializeAsset(context, multiFaceAssetId, [{ faceRank: 0 }, { faceRank: 1 }]);

  const prepared = await prepareFaceReviewSession({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    actorUserId: context.userId,
    assetIds: [multiFaceAssetId, zeroFaceAssetId, oneFaceAssetId],
  });

  assert.equal(prepared.session.selectedAssetCount, 3);
  assert.equal(prepared.session.completedCount, 2);
  assert.equal(prepared.session.pendingMaterializationCount, 0);
  assert.equal(prepared.session.readyForFaceSelectionCount, 1);
  assert.equal(prepared.session.blockedCount, 0);
  assert.equal(prepared.session.reusedExistingSession, false);

  const currentSession = await getCurrentFaceReviewSession({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    actorUserId: context.userId,
  });

  assert.equal(currentSession.session.id, prepared.session.id);
  assert.equal(currentSession.items.length, 3);

  const zeroFaceItem = currentSession.items.find((item) => item.assetId === zeroFaceAssetId) ?? null;
  const oneFaceItem = currentSession.items.find((item) => item.assetId === oneFaceAssetId) ?? null;
  const multiFaceItem = currentSession.items.find((item) => item.assetId === multiFaceAssetId) ?? null;

  assert.equal(zeroFaceItem?.status, "completed");
  assert.equal(zeroFaceItem?.completionKind, "linked_fallback");
  assert.equal(oneFaceItem?.status, "completed");
  assert.equal(oneFaceItem?.completionKind, "linked_face");
  assert.equal(oneFaceItem?.faces.length, 1);
  assert.equal(oneFaceItem?.faces[0]?.isCurrentConsentFace, true);
  assert.equal(multiFaceItem?.status, "ready_for_face_selection");
  assert.equal(multiFaceItem?.preparedMaterializationId, multiFace.materialization.id);
  assert.equal(multiFaceItem?.faces.length, 2);
  assert.equal(multiFaceItem?.faces[0]?.cropDerivative?.derivative_kind, "review_square_256");
  assert.equal(currentSession.session.nextReviewItemId, multiFaceItem?.id ?? null);
  assert.equal(oneFace.materialization.face_count, 1);

  const reused = await prepareFaceReviewSession({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    actorUserId: context.userId,
    assetIds: [zeroFaceAssetId, oneFaceAssetId, multiFaceAssetId],
  });

  assert.equal(reused.session.id, prepared.session.id);
  assert.equal(reused.session.reusedExistingSession, true);
});

test("pending review session items reconcile to ready after materialization exists", async () => {
  const context = await createProjectContext(admin);
  const consent = await createOptedInConsentWithHeadshot(admin, context);
  const multiFaceAssetId = await createAsset(admin, context);

  const prepared = await prepareFaceReviewSession({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    actorUserId: context.userId,
    assetIds: [multiFaceAssetId],
  });

  assert.equal(prepared.session.pendingMaterializationCount, 1);
  assert.equal(prepared.session.readyForFaceSelectionCount, 0);

  await materializeAsset(context, multiFaceAssetId, [{ faceRank: 0 }, { faceRank: 1 }]);

  const reconciled = await getFaceReviewSession({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    actorUserId: context.userId,
    sessionId: prepared.session.id,
  });

  assert.equal(reconciled.session.pendingMaterializationCount, 0);
  assert.equal(reconciled.session.readyForFaceSelectionCount, 1);
  assert.equal(reconciled.items[0]?.status, "ready_for_face_selection");
  assert.equal(reconciled.items[0]?.faces.length, 2);
});

test("pending review session items fall back to direct materialization when no worker drains the queue", async () => {
  const context = await createProjectContext(admin);
  const consent = await createOptedInConsentWithHeadshot(admin, context);
  const multiFaceAssetId = await createAsset(admin, context);
  const matcher = createFaceMaterializationMatcher({
    [multiFaceAssetId]: [{ faceRank: 0 }, { faceRank: 1 }],
  });

  const prepared = await prepareFaceReviewSession({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    actorUserId: context.userId,
    assetIds: [multiFaceAssetId],
  });

  assert.equal(prepared.session.pendingMaterializationCount, 1);

  const staleAt = new Date(Date.now() - 30_000).toISOString();
  const { error: staleItemError } = await admin
    .from("face_review_session_items")
    .update({
      created_at: staleAt,
      updated_at: staleAt,
      last_reconciled_at: staleAt,
    })
    .eq("session_id", prepared.session.id)
    .eq("asset_id", multiFaceAssetId);
  assertNoError(staleItemError, "age review session item");

  const reconciled = await getFaceReviewSession({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    actorUserId: context.userId,
    sessionId: prepared.session.id,
    matcher,
  });

  assert.equal(reconciled.session.pendingMaterializationCount, 0);
  assert.equal(reconciled.session.readyForFaceSelectionCount, 1);
  assert.equal(reconciled.items[0]?.status, "ready_for_face_selection");
  assert.equal(reconciled.items[0]?.faces.length, 2);
});

test("session item actions surface manual conflicts and allow force replace", async () => {
  const context = await createProjectContext(admin);
  const consentA = await createOptedInConsentWithHeadshot(admin, context);
  const consentB = await createOptedInConsentWithHeadshot(admin, context);
  const multiFaceAssetId = await createAsset(admin, context);
  const materialized = await materializeAsset(context, multiFaceAssetId, [{ faceRank: 0 }, { faceRank: 1 }]);
  const targetFaceId = materialized.faces[0]?.id;
  assert.ok(targetFaceId);

  await manualLinkPhotoToConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consentA.consentId,
    actorUserId: context.userId,
    assetId: multiFaceAssetId,
    assetFaceId: targetFaceId,
    mode: "face",
  });

  const prepared = await prepareFaceReviewSession({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consentB.consentId,
    actorUserId: context.userId,
    assetIds: [multiFaceAssetId],
  });

  const session = await getFaceReviewSession({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consentB.consentId,
    actorUserId: context.userId,
    sessionId: prepared.session.id,
  });

  const item = session.items[0];
  assert.ok(item);
  assert.equal(item.status, "ready_for_face_selection");
  assert.equal(item.faces[0]?.status, "occupied_manual");

  await assert.rejects(
    () =>
      applyFaceReviewSessionItemAction({
        supabase: admin,
        tenantId: context.tenantId,
        projectId: context.projectId,
        consentId: consentB.consentId,
        actorUserId: context.userId,
        sessionId: prepared.session.id,
        itemId: item.id,
        action: "link_face",
        assetFaceId: targetFaceId,
      }),
    (error: unknown) => error instanceof Error && "code" in error && (error as { code?: string }).code === "manual_conflict",
  );

  const forced = await applyFaceReviewSessionItemAction({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consentB.consentId,
    actorUserId: context.userId,
    sessionId: prepared.session.id,
    itemId: item.id,
    action: "link_face",
    assetFaceId: targetFaceId,
    forceReplace: true,
  });

  assert.equal(forced.item.status, "completed");
  assert.equal(forced.item.completionKind, "linked_face");
  assert.equal(forced.session.readyForFaceSelectionCount, 0);

  const refreshed = await getFaceReviewSession({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consentB.consentId,
    actorUserId: context.userId,
    sessionId: prepared.session.id,
  });
  assert.equal(refreshed.items[0]?.status, "completed");
  assert.equal(refreshed.items[0]?.faces[0]?.isCurrentConsentFace, true);
  assert.equal(refreshed.items[0]?.faces[0]?.currentAssignee?.consentId, consentB.consentId);
});

test("session read serialization includes signed crop URLs for review faces", async () => {
  const context = await createProjectContext(admin);
  const consent = await createOptedInConsentWithHeadshot(admin, context);
  const multiFaceAssetId = await createAsset(admin, context);

  await materializeAsset(context, multiFaceAssetId, [{ faceRank: 0 }, { faceRank: 1 }]);
  await prepareFaceReviewSession({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    actorUserId: context.userId,
    assetIds: [multiFaceAssetId],
  });

  const session = await getCurrentFaceReviewSession({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    actorUserId: context.userId,
  });
  const serialized = await serializeFaceReviewSessionResponse(
    session,
    context.tenantId,
    context.projectId,
    "localhost",
  );

  assert.equal(serialized.items.length, 1);
  assert.equal(serialized.items[0]?.faces.length, 2);
  assert.match(String(serialized.items[0]?.faces[0]?.cropUrl), /asset-face-derivatives/);
});

test("manual review and queue reads expose current consent confidence on the winning face", async () => {
  const context = await createProjectContext(admin);
  const consent = await createOptedInConsentWithHeadshot(admin, context);
  const multiFaceAssetId = await createAsset(admin, context);

  const headshot = await materializeAsset(context, consent.headshotAssetId, [{ faceRank: 0 }]);
  const multiFace = await materializeAsset(context, multiFaceAssetId, [{ faceRank: 0 }, { faceRank: 1 }]);

  await seedCompareRow({
    context,
    consentId: consent.consentId,
    assetId: multiFaceAssetId,
    headshotMaterializationId: headshot.materialization.id,
    headshotFaceId: headshot.faces[0]?.id ?? null,
    assetMaterializationId: multiFace.materialization.id,
    winningAssetFaceId: multiFace.faces[1]?.id ?? null,
    winningAssetFaceRank: 1,
    winningSimilarity: 0.8732,
    targetFaceCount: multiFace.faces.length,
  });

  const manualState = await getManualPhotoLinkState({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    assetId: multiFaceAssetId,
  });

  assert.equal(manualState.faces[0]?.matchConfidence ?? null, null);
  assert.equal(manualState.faces[1]?.matchConfidence, 0.8732);

  await prepareFaceReviewSession({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    actorUserId: context.userId,
    assetIds: [multiFaceAssetId],
  });

  const session = await getCurrentFaceReviewSession({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    actorUserId: context.userId,
  });

  assert.equal(session.items[0]?.faces[0]?.matchConfidence ?? null, null);
  assert.equal(session.items[0]?.faces[1]?.matchConfidence, 0.8732);
});

test("linked face overlay rows expose current face geometry and link metadata", async () => {
  const context = await createProjectContext(admin);
  const consent = await createOptedInConsentWithHeadshot(admin, context);
  const multiFaceAssetId = await createAsset(admin, context);
  const materialized = await materializeAsset(context, multiFaceAssetId, [{ faceRank: 0 }, { faceRank: 1 }]);
  const targetFaceId = materialized.faces[0]?.id ?? null;
  assert.ok(targetFaceId);

  await manualLinkPhotoToConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    actorUserId: context.userId,
    assetId: multiFaceAssetId,
    assetFaceId: targetFaceId,
    mode: "face",
  });

  const overlays = await listLinkedFaceOverlaysForAssetIds({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetIds: [multiFaceAssetId],
  });

  assert.equal(overlays.length, 1);
  assert.equal(overlays[0]?.assetId, multiFaceAssetId);
  assert.equal(overlays[0]?.consentId, consent.consentId);
  assert.equal(overlays[0]?.assetFaceId, targetFaceId);
  assert.equal(overlays[0]?.faceRank, 0);
  assert.deepEqual(overlays[0]?.faceBoxNormalized, materialized.faces[0]?.face_box_normalized ?? null);
  assert.equal(overlays[0]?.linkSource, "manual");
  assert.equal(overlays[0]?.matchConfidence ?? null, null);
});

test("overlay utilities place normalized face boxes inside the contained image bounds", () => {
  const imageRect = getContainedImageRect({ width: 800, height: 600 }, { width: 1200, height: 800 });
  assert.ok(imageRect);
  assert.equal(imageRect?.left, 0);
  assert.equal(imageRect?.width, 800);
  assert.ok(Math.abs((imageRect?.top ?? 0) - 33.33333333333333) < 0.001);
  assert.ok(Math.abs((imageRect?.height ?? 0) - 533.3333333333334) < 0.001);

  const style = getFaceOverlayStyle(
    {
      x_min: 0.1,
      y_min: 0.25,
      x_max: 0.3,
      y_max: 0.5,
    },
    { width: 800, height: 600 },
    { width: 1200, height: 800 },
  );

  assert.deepEqual(style, {
    left: "80px",
    top: "166.66666666666666px",
    width: "160px",
    height: "133.33333333333334px",
  });
});

test("initial face selection prefers the provided candidate face before generic fallback", () => {
  const faces = [
    {
      assetFaceId: "face-a",
      faceRank: 0,
      status: "available" as const,
      isCurrentConsentFace: false,
    },
    {
      assetFaceId: "face-b",
      faceRank: 1,
      status: "available" as const,
      isCurrentConsentFace: false,
    },
    {
      assetFaceId: "face-c",
      faceRank: 2,
      status: "occupied_manual" as const,
      isCurrentConsentFace: false,
    },
  ];

  assert.equal(
    getInitialSelectedFaceId(faces, {
      preferredAssetFaceId: "face-b",
      preferredFaceRank: 1,
    }),
    "face-b",
  );
  assert.equal(
    getInitialSelectedFaceId(faces, {
      preferredAssetFaceId: "missing-face",
      preferredFaceRank: 1,
    }),
    "face-b",
  );
  assert.equal(getInitialSelectedFaceId(faces), "face-a");
});

test("session read flags rematerialized multi-face items after the asset is refreshed", async () => {
  const context = await createProjectContext(admin);
  const consent = await createOptedInConsentWithHeadshot(admin, context);
  const multiFaceAssetId = await createAsset(admin, context);

  const firstMaterialization = await materializeAsset(context, multiFaceAssetId, [{ faceRank: 0 }, { faceRank: 1 }]);
  const prepared = await prepareFaceReviewSession({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    actorUserId: context.userId,
    assetIds: [multiFaceAssetId],
  });

  await new Promise((resolve) => setTimeout(resolve, 20));
  const rematerializedAt = new Date(Date.now() + 1000).toISOString();
  const { error: materializationUpdateError } = await admin
    .from("asset_face_materializations")
    .update({
      face_count: 3,
      materialized_at: rematerializedAt,
    })
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("id", firstMaterialization.materialization.id);
  assertNoError(materializationUpdateError, "update materialization for rematerialization");

  const { error: insertedFaceError } = await admin.from("asset_face_materialization_faces").insert({
    tenant_id: context.tenantId,
    project_id: context.projectId,
    asset_id: multiFaceAssetId,
    materialization_id: firstMaterialization.materialization.id,
    face_rank: 2,
    provider_face_index: 2,
    detection_probability: 0.99,
    face_box: {
      x_min: 520,
      y_min: 240,
      x_max: 760,
      y_max: 520,
      probability: 0.99,
    },
    face_box_normalized: {
      x_min: 520 / 1200,
      y_min: 240 / 800,
      x_max: 760 / 1200,
      y_max: 520 / 800,
      probability: 0.99,
    },
    embedding: [0.7, 2.1],
  });
  assertNoError(insertedFaceError, "insert rematerialized face");

  const readModel = await getFaceReviewSession({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consent.consentId,
    actorUserId: context.userId,
    sessionId: prepared.session.id,
  });

  assert.equal(readModel.items[0]?.status, "ready_for_face_selection");
  assert.equal(readModel.items[0]?.wasRematerialized, true);
  assert.equal(readModel.items[0]?.detectedFaceCount, 3);
  assert.equal(readModel.items[0]?.faces.length, 3);
  assert.equal(readModel.items[0]?.preparedMaterializationId, firstMaterialization.materialization.id);
});
