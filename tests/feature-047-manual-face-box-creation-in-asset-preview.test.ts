import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";

import {
  buildNormalizedFaceBoxFromPreviewPoints,
  getConstrainedPreviewDrawPoint,
  getPreviewSceneImageRect,
} from "../src/components/projects/previewable-image";
import { submitConsent } from "../src/lib/consent/submit-consent";
import { getAssetPreviewFaceCandidates, getAssetPreviewFaces } from "../src/lib/matching/asset-preview-linking";
import type { AutoMatcher, AutoMatcherMaterializedFace } from "../src/lib/matching/auto-matcher";
import { getAutoMatchCompareVersion, getAutoMatchMaterializerVersion } from "../src/lib/matching/auto-match-config";
import { ensureMaterializedFaceCompare } from "../src/lib/matching/materialized-face-compare";
import { createManualAssetFace } from "../src/lib/matching/manual-asset-faces";
import {
  ensureAssetFaceMaterialization,
  loadCurrentAssetFaceMaterialization,
} from "../src/lib/matching/face-materialization";
import {
  hideAssetFace,
  manualLinkPhotoToConsent,
  reconcilePhotoFaceCanonicalStateForAsset,
  restoreHiddenAssetFace,
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
  embeddingBase?: number;
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
      email: `feature047-${randomUUID()}@example.com`,
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
      name: `Feature 047 Tenant ${randomUUID()}`,
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
      name: `Feature 047 Project ${randomUUID()}`,
      description: "Feature 047 test project",
      status: "active",
    })
    .select("id")
    .single();
  assertNoError(projectError, "insert project");

  const { data: template, error: templateError } = await supabase
    .from("consent_templates")
    .insert({
      template_key: `feature047-template-${randomUUID()}`,
      name: "Feature 047 Template",
      version: "v1",
      version_number: 1,
      body: "Feature 047 template body",
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
    status?: "uploaded" | "pending";
    uploadSource?: boolean;
  },
) {
  const uploadedAt = options.status === "pending" ? null : new Date().toISOString();
  const storagePath = `tenant/${context.tenantId}/project/${context.projectId}/asset/${randomUUID()}/test.jpg`;
  const { data: asset, error } = await supabase
    .from("assets")
    .insert({
      tenant_id: context.tenantId,
      project_id: context.projectId,
      created_by: context.userId,
      storage_bucket: "project-assets",
      storage_path: storagePath,
      original_filename: `${options.assetType}-${randomUUID()}.jpg`,
      content_type: "image/jpeg",
      file_size_bytes: 2048,
      content_hash: randomUUID().replaceAll("-", ""),
      content_hash_algo: "sha256",
      status: options.status ?? "uploaded",
      uploaded_at: uploadedAt,
      asset_type: options.assetType,
      retention_expires_at:
        options.assetType === "headshot"
          ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
          : null,
    })
    .select("id, storage_path")
    .single();
  assertNoError(error, "insert asset");

  if (options.uploadSource ?? false) {
    await uploadTestImage(storagePath);
  }

  return asset.id as string;
}

async function uploadTestImage(storagePath: string) {
  const buffer = await sharp({
    create: {
      width: 1200,
      height: 800,
      channels: 3,
      background: { r: 160, g: 110, b: 70 },
    },
  })
    .jpeg({ quality: 88 })
    .toBuffer();

  const { error } = await admin.storage.from("project-assets").upload(storagePath, buffer, {
    contentType: "image/jpeg",
    upsert: true,
  });
  assertNoError(error, "upload test image");
}

async function createInviteToken(supabase: SupabaseClient, context: ProjectContext) {
  const token = `feature047-invite-${randomUUID()}`;
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
    uploadSource: false,
  });

  const consent = await submitConsent({
    supabase,
    token,
    fullName: "Feature 047 Subject",
    email: `feature047-subject-${randomUUID()}@example.com`,
    faceMatchOptIn: true,
    headshotAssetId,
    captureIp: null,
    captureUserAgent: "feature-047-test",
  });

  return {
    consentId: consent.consentId,
    headshotAssetId,
  };
}

function createMaterializationMatcher(
  facesByAssetId: Record<string, TestFace[]>,
  options?: {
    onCompareEmbeddings?: (input: { sourceEmbedding: number[]; targetEmbeddings: number[][] }) => number[];
  },
): AutoMatcher {
  return {
    version: "feature-047-materialize-test",
    async match() {
      assert.fail("raw matcher path should not run in feature 047 tests");
    },
    async materializeAssetFaces(input) {
      const sourceImage = {
        width: 1200,
        height: 800,
        coordinateSpace: "oriented_original" as const,
      };

      const faces = (facesByAssetId[input.assetId] ?? []).map((face) => {
        const xMin = 80 + face.faceRank * 180;
        const yMin = 100 + face.faceRank * 80;
        const xMax = xMin + 180;
        const yMax = yMin + 220;

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
          embedding: [face.embeddingBase ?? 0.6 + face.faceRank * 0.1, face.faceRank + 0.01],
        } satisfies AutoMatcherMaterializedFace;
      });

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
    async compareEmbeddings(input) {
      if (!options?.onCompareEmbeddings) {
        assert.fail("embedding compare should not run in this feature 047 test");
      }

      return {
        targetSimilarities: options.onCompareEmbeddings(input),
        providerMetadata: {
          provider: "test-provider",
          providerMode: "verification_embeddings",
          providerPluginVersions: {
            calculator: "embedding-test",
          },
        },
      };
    },
  };
}

async function materializeAsset(
  context: ProjectContext,
  assetId: string,
  faces: TestFace[],
  options?: {
    forceRematerialize?: boolean;
    matcherFacesByAssetId?: Record<string, TestFace[]>;
  },
) {
  const matcher = createMaterializationMatcher(options?.matcherFacesByAssetId ?? { [assetId]: faces });
  const current = await ensureAssetFaceMaterialization({
    supabase: admin,
    matcher,
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

async function getCurrentPhoto(context: ProjectContext, assetId: string) {
  const current = await loadCurrentAssetFaceMaterialization(
    admin,
    context.tenantId,
    context.projectId,
    assetId,
    getAutoMatchMaterializerVersion(),
    { includeFaces: true },
  );

  if (!current) {
    assert.fail(`Expected current materialization for asset ${assetId}`);
  }

  return current;
}

test("manual face creation persists coordinates, appends rank, and reuses preview candidate flows", async () => {
  const context = await createProjectContext(admin);
  const photoAssetId = await createAsset(admin, context, {
    assetType: "photo",
    uploadSource: true,
  });
  const consent = await createOptedInConsentWithHeadshot(admin, context);
  const photo = await materializeAsset(context, photoAssetId, [{ faceRank: 0 }]);

  const created = await createManualAssetFace({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    actorUserId: context.userId,
    faceBoxNormalized: {
      x_min: 0.55,
      y_min: 0.18,
      x_max: 0.72,
      y_max: 0.46,
    },
  });

  assert.equal(created.created, true);
  assert.equal(created.faceSource, "manual");
  assert.equal(created.faceRank, 1);

  const current = await getCurrentPhoto(context, photoAssetId);
  const manualFace = current.faces.find((face) => face.id === created.assetFaceId) ?? null;
  assert.ok(manualFace);
  assert.equal(manualFace?.face_source, "manual");
  assert.equal(manualFace?.face_rank, 1);
  assert.equal(manualFace?.created_by, context.userId);
  assert.equal(manualFace?.embedding, null);
  assert.deepEqual(manualFace?.face_box_normalized, {
    x_min: 0.55,
    y_min: 0.18,
    x_max: 0.72,
    y_max: 0.46,
    probability: null,
  });
  assert.deepEqual(manualFace?.face_box, {
    x_min: 660,
    y_min: 144,
    x_max: 864,
    y_max: 368,
    probability: null,
  });

  const preview = await getAssetPreviewFaces({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    requestHostHeader: "localhost",
  });
  const previewManualFace = preview.faces.find((face) => face.assetFaceId === created.assetFaceId) ?? null;
  assert.ok(previewManualFace);
  assert.equal(previewManualFace?.faceSource, "manual");
  assert.equal(previewManualFace?.faceState, "unlinked");
  assert.equal(typeof previewManualFace?.faceThumbnailUrl, "string");

  const candidates = await getAssetPreviewFaceCandidates({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    assetFaceId: created.assetFaceId,
    requestHostHeader: "localhost",
  });
  assert.equal(candidates.assetFaceId, created.assetFaceId);
  assert.equal(candidates.candidates[0]?.consentId, consent.consentId);
  assert.equal(candidates.candidates[0]?.scoreSource, "unscored");
  assert.equal(candidates.candidates[0]?.rank, null);
  assert.equal(photo.faces[0]?.id !== created.assetFaceId, true);
});

test("manual faces on zero-detector assets can still be linked manually", async () => {
  const context = await createProjectContext(admin);
  const photoAssetId = await createAsset(admin, context, {
    assetType: "photo",
    uploadSource: true,
  });
  const consent = await createOptedInConsentWithHeadshot(admin, context);
  const photo = await materializeAsset(context, photoAssetId, []);

  assert.equal(photo.materialization.face_count, 0);
  assert.equal(photo.faces.length, 0);

  const created = await createManualAssetFace({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    actorUserId: context.userId,
    faceBoxNormalized: {
      x_min: 0.41,
      y_min: 0.14,
      x_max: 0.6,
      y_max: 0.42,
    },
  });

  const result = await manualLinkPhotoToConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    consentId: consent.consentId,
    actorUserId: context.userId,
    mode: "face",
    assetFaceId: created.assetFaceId,
  });

  assert.equal(result.kind, "linked");
  assert.equal(result.mode, "face");
  assert.equal(result.assetFaceId, created.assetFaceId);

  const preview = await getAssetPreviewFaces({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    requestHostHeader: "localhost",
  });
  assert.equal(preview.faces.find((face) => face.assetFaceId === created.assetFaceId)?.faceState, "linked_manual");
});

test("manual face creation dedupes exact boxes and rejects high-overlap duplicates", async () => {
  const context = await createProjectContext(admin);
  const photoAssetId = await createAsset(admin, context, {
    assetType: "photo",
    uploadSource: true,
  });
  await materializeAsset(context, photoAssetId, []);

  const first = await createManualAssetFace({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    actorUserId: context.userId,
    faceBoxNormalized: {
      x_min: 0.2,
      y_min: 0.2,
      x_max: 0.4,
      y_max: 0.4,
    },
  });

  const duplicate = await createManualAssetFace({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    actorUserId: context.userId,
    faceBoxNormalized: {
      x_min: 0.2,
      y_min: 0.2,
      x_max: 0.4,
      y_max: 0.4,
    },
  });

  assert.equal(first.assetFaceId, duplicate.assetFaceId);
  assert.equal(duplicate.created, false);

  await assert.rejects(
    () =>
      createManualAssetFace({
        supabase: admin,
        tenantId: context.tenantId,
        projectId: context.projectId,
        assetId: photoAssetId,
        actorUserId: context.userId,
        faceBoxNormalized: {
          x_min: 0.205,
          y_min: 0.205,
          x_max: 0.405,
          y_max: 0.405,
        },
      }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "manual_face_overlaps_existing_face",
  );

  const current = await getCurrentPhoto(context, photoAssetId);
  assert.equal(current.faces.length, 1);
});

test("manual face creation succeeds without a thumbnail and manual faces can be hidden and restored", async () => {
  const context = await createProjectContext(admin);
  const photoAssetId = await createAsset(admin, context, {
    assetType: "photo",
    uploadSource: false,
  });
  await materializeAsset(context, photoAssetId, []);

  const created = await createManualAssetFace({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    actorUserId: context.userId,
    faceBoxNormalized: {
      x_min: 0.3,
      y_min: 0.15,
      x_max: 0.47,
      y_max: 0.39,
    },
  });

  const beforeHide = await getAssetPreviewFaces({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    requestHostHeader: "localhost",
  });
  assert.equal(
    beforeHide.faces.find((face) => face.assetFaceId === created.assetFaceId)?.faceThumbnailUrl,
    null,
  );

  await hideAssetFace({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    assetFaceId: created.assetFaceId,
    actorUserId: context.userId,
  });

  const hiddenPreview = await getAssetPreviewFaces({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    requestHostHeader: "localhost",
  });
  assert.equal(hiddenPreview.faces.find((face) => face.assetFaceId === created.assetFaceId)?.faceState, "hidden");

  await restoreHiddenAssetFace({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    assetFaceId: created.assetFaceId,
    actorUserId: context.userId,
  });

  const restoredPreview = await getAssetPreviewFaces({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    requestHostHeader: "localhost",
  });
  assert.equal(restoredPreview.faces.find((face) => face.assetFaceId === created.assetFaceId)?.faceState, "unlinked");
});

test("manual faces survive rematerialization and stay appended after detector faces", async () => {
  const context = await createProjectContext(admin);
  const photoAssetId = await createAsset(admin, context, {
    assetType: "photo",
    uploadSource: true,
  });
  await materializeAsset(context, photoAssetId, [{ faceRank: 0 }, { faceRank: 1 }]);

  const manualFace = await createManualAssetFace({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    actorUserId: context.userId,
    faceBoxNormalized: {
      x_min: 0.62,
      y_min: 0.24,
      x_max: 0.8,
      y_max: 0.53,
    },
  });

  const rematerialized = await materializeAsset(
    context,
    photoAssetId,
    [{ faceRank: 0 }],
    {
      forceRematerialize: true,
      matcherFacesByAssetId: {
        [photoAssetId]: [{ faceRank: 0 }],
      },
    },
  );

  assert.equal(rematerialized.faces.length, 2);
  const preservedManualFace = rematerialized.faces.find((face) => face.id === manualFace.assetFaceId) ?? null;
  assert.ok(preservedManualFace);
  assert.equal(preservedManualFace?.face_source, "manual");
  assert.equal(preservedManualFace?.face_rank, 1);
});

test("manual faces stay out of compare scores and auto reconciliation", async () => {
  const context = await createProjectContext(admin);
  const photoAssetId = await createAsset(admin, context, {
    assetType: "photo",
    uploadSource: true,
  });
  const photo = await materializeAsset(context, photoAssetId, [{ faceRank: 0, embeddingBase: 0.41 }]);
  const detectorFaceId = photo.faces[0]?.id ?? null;
  assert.ok(detectorFaceId);

  const manualFace = await createManualAssetFace({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    actorUserId: context.userId,
    faceBoxNormalized: {
      x_min: 0.55,
      y_min: 0.16,
      x_max: 0.74,
      y_max: 0.44,
    },
  });

  const compareConsent = await createOptedInConsentWithHeadshot(admin, context);
  const compareHeadshot = await materializeAsset(context, compareConsent.headshotAssetId, [{ faceRank: 0, embeddingBase: 0.52 }]);
  const secondConsent = await createOptedInConsentWithHeadshot(admin, context);
  const secondHeadshot = await materializeAsset(context, secondConsent.headshotAssetId, [{ faceRank: 0, embeddingBase: 0.61 }]);

  let comparedTargetFaceCount = 0;
  const compareResult = await ensureMaterializedFaceCompare({
    supabase: admin,
    matcher: createMaterializationMatcher(
      {
        [compareConsent.headshotAssetId]: [{ faceRank: 0, embeddingBase: 0.52 }],
        [photoAssetId]: [{ faceRank: 0, embeddingBase: 0.41 }],
      },
      {
        onCompareEmbeddings(input) {
          comparedTargetFaceCount = input.targetEmbeddings.length;
          return input.targetEmbeddings.map(() => 0.88);
        },
      },
    ),
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: compareConsent.consentId,
    assetId: photoAssetId,
    headshotMaterializationId: compareHeadshot.materialization.id,
    assetMaterializationId: photo.materialization.id,
  });

  assert.equal(comparedTargetFaceCount, 1);
  assert.equal(compareResult.compare.target_face_count, 1);
  assert.equal(compareResult.compare.winning_asset_face_id, detectorFaceId);

  const { data: compareScoreRows, error: compareScoreError } = await admin
    .from("asset_consent_face_compare_scores")
    .select("asset_face_id")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("asset_id", photoAssetId)
    .eq("consent_id", compareConsent.consentId);
  assertNoError(compareScoreError, "select compare score rows");
  assert.deepEqual((compareScoreRows ?? []).map((row) => row.asset_face_id), [detectorFaceId]);

  const { error: manualCompareError } = await admin.from("asset_consent_face_compares").upsert(
    {
      tenant_id: context.tenantId,
      project_id: context.projectId,
      asset_id: photoAssetId,
      consent_id: secondConsent.consentId,
      headshot_materialization_id: secondHeadshot.materialization.id,
      asset_materialization_id: photo.materialization.id,
      headshot_face_id: secondHeadshot.faces[0]?.id ?? null,
      winning_asset_face_id: manualFace.assetFaceId,
      winning_asset_face_rank: manualFace.faceRank,
      winning_similarity: 0.96,
      compare_status: "matched",
      compare_version: getAutoMatchCompareVersion(),
      provider: "test-provider",
      provider_mode: "verification_embeddings",
      provider_plugin_versions: {
        calculator: "embedding-test",
      },
      target_face_count: 1,
      compared_at: new Date().toISOString(),
    },
    {
      onConflict:
        "tenant_id,project_id,consent_id,asset_id,headshot_materialization_id,asset_materialization_id,compare_version",
    },
  );
  assertNoError(manualCompareError, "insert manual compare row");

  await reconcilePhotoFaceCanonicalStateForAsset({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
  });

  const { data: faceLinks, error: faceLinksError } = await admin
    .from("asset_face_consent_links")
    .select("consent_id, asset_face_id, link_source")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("asset_id", photoAssetId);
  assertNoError(faceLinksError, "select face links");
  assert.equal((faceLinks ?? []).some((row) => row.consent_id === secondConsent.consentId), false);
});

test("draw helpers clamp to the contained image rect and normalize from image space only", () => {
  const frameSize = { width: 1000, height: 800 };
  const imageSize = { width: 800, height: 400 };
  const imageRect = getPreviewSceneImageRect(frameSize, imageSize);
  assert.deepEqual(imageRect, {
    left: 0,
    top: 150,
    width: 1000,
    height: 500,
  });

  const graySpacePoint = getConstrainedPreviewDrawPoint({
    clientX: 500,
    clientY: 60,
    frameRect: { left: 0, top: 0 } as DOMRect,
    frameSize,
    imageRect,
    zoom: 1,
    pan: { x: 0, y: 0 },
  });
  assert.equal(graySpacePoint?.isInsideImage, false);
  assert.equal(graySpacePoint?.point.y, 150);

  const transformedPoint = getConstrainedPreviewDrawPoint({
    clientX: 180,
    clientY: 160,
    frameRect: { left: 0, top: 0 } as DOMRect,
    frameSize,
    imageRect,
    zoom: 2,
    pan: { x: 80, y: -40 },
  });
  assert.equal(Math.round(transformedPoint?.point.x ?? 0), 300);
  assert.equal(Math.round(transformedPoint?.point.y ?? 0), 300);
  assert.equal(transformedPoint?.isInsideImage, true);

  const normalizedFaceBox = buildNormalizedFaceBoxFromPreviewPoints(
    { x: 100, y: 200 },
    { x: 300, y: 500 },
    imageRect,
  );
  assert.deepEqual(normalizedFaceBox, {
    x_min: 0.1,
    y_min: 0.1,
    x_max: 0.3,
    y_max: 0.7,
  });
});
