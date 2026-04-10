import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import sharp from "sharp";

import { signFaceDerivativeUrl } from "../src/lib/assets/sign-face-derivatives";
import {
  AssetPreviewConsentPanel,
  AssetPreviewLinkedPeopleStrip,
} from "../src/components/projects/project-asset-preview-lightbox";
import { submitConsent } from "../src/lib/consent/submit-consent";
import {
  getAssetPreviewLinkCandidates,
  getAssetPreviewLinkedFaces,
} from "../src/lib/matching/asset-preview-linking";
import type { AutoMatcher, AutoMatcherMaterializedFace } from "../src/lib/matching/auto-matcher";
import { getAutoMatchMaterializerVersion } from "../src/lib/matching/auto-match-config";
import { ensureAssetFaceMaterialization } from "../src/lib/matching/face-materialization";
import { manualLinkPhotoToConsent } from "../src/lib/matching/photo-face-linking";
import type { StructuredFieldsSnapshot } from "../src/lib/templates/structured-fields";

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
      email: `feature044-${randomUUID()}@example.com`,
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
      name: `Feature 044 Tenant ${randomUUID()}`,
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
      name: `Feature 044 Project ${randomUUID()}`,
      description: "Feature 044 test project",
      status: "active",
    })
    .select("id")
    .single();
  assertNoError(projectError, "insert project");

  const { data: template, error: templateError } = await supabase
    .from("consent_templates")
    .insert({
      template_key: `feature044-template-${randomUUID()}`,
      name: "Feature 044 Template",
      version: "v1",
      version_number: 1,
      body: "Feature 044 template body",
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
  assertNoError(error, "insert asset");
  return asset.id as string;
}

async function createInviteToken(supabase: SupabaseClient, context: ProjectContext) {
  const token = `feature044-invite-${randomUUID()}`;
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
    fullName: "Feature 044 Subject",
    email: `feature044-subject-${randomUUID()}@example.com`,
    faceMatchOptIn: true,
    headshotAssetId,
    captureIp: null,
    captureUserAgent: "feature-044-test",
  });

  return {
    consentId: consent.consentId,
    headshotAssetId,
  };
}

async function createReviewCropBuffer() {
  return sharp({
    create: {
      width: 96,
      height: 96,
      channels: 3,
      background: { r: 130, g: 90, b: 60 },
    },
  })
    .webp({ quality: 82 })
    .toBuffer();
}

function createFaceMaterializationMatcher(facesByAssetId: Record<string, TestFace[]>): AutoMatcher {
  return {
    version: "feature-044-materialization-test",
    async match() {
      assert.fail("raw match should not run in feature 044 tests");
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
      assert.fail("embedding compare should not run in feature 044 tests");
    },
  };
}

async function materializeAsset(context: ProjectContext, assetId: string, faces: TestFace[]) {
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

async function updateConsentPreviewFields(
  context: ProjectContext,
  consentId: string,
  input: {
    structuredSnapshot?: StructuredFieldsSnapshot | null;
    consentVersion?: string;
    revoked?: boolean;
  },
) {
  const { error } = await admin
    .from("consents")
    .update({
      structured_fields_snapshot: input.structuredSnapshot ?? null,
      consent_version: input.consentVersion ?? "v1",
      revoked_at: input.revoked ? new Date().toISOString() : null,
    })
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("id", consentId);
  assertNoError(error, "update consent preview fields");
}

function createStructuredSnapshot(): StructuredFieldsSnapshot {
  return {
    schemaVersion: 1,
    templateSnapshot: {
      templateId: "template-1",
      templateKey: "feature-044-template",
      name: "Feature 044 Template",
      version: "v2",
      versionNumber: 2,
    },
    definition: {
      schemaVersion: 1,
      builtInFields: {
        scope: {
          fieldKey: "scope",
          fieldType: "checkbox_list",
          label: "Scope",
          required: true,
          orderIndex: 0,
          options: [
            { optionKey: "web", label: "Website", orderIndex: 0 },
            { optionKey: "social", label: "Social", orderIndex: 1 },
          ],
        },
        duration: {
          fieldKey: "duration",
          fieldType: "single_select",
          label: "Duration",
          required: true,
          orderIndex: 1,
          options: [
            { optionKey: "one_year", label: "1 year", orderIndex: 0 },
            { optionKey: "two_years", label: "2 years", orderIndex: 1 },
          ],
        },
      },
      customFields: [
        {
          fieldKey: "territory",
          fieldType: "text_input",
          label: "Territory",
          required: false,
          orderIndex: 0,
          helpText: null,
          placeholder: null,
          maxLength: 200,
          options: null,
        },
      ],
    },
    values: {
      scope: {
        valueType: "checkbox_list",
        selectedOptionKeys: ["web", "social"],
      },
      duration: {
        valueType: "single_select",
        selectedOptionKey: "two_years",
      },
      territory: {
        valueType: "text_input",
        text: "EU and UK",
      },
    },
  };
}

test("asset preview linked faces expose exact linked face crops and bounded consent summary data", async () => {
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
  await updateConsentPreviewFields(context, consent.consentId, {
    structuredSnapshot: createStructuredSnapshot(),
    consentVersion: "v2",
    revoked: true,
  });

  const preview = await getAssetPreviewLinkedFaces({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    requestHostHeader: "localhost",
  });

  assert.equal(preview.assetId, photoAssetId);
  assert.equal(preview.linkedFaces.length, 1);
  assert.equal(preview.linkedFaces[0]?.assetFaceId, targetFaceId);
  assert.equal(preview.linkedFaces[0]?.faceRank, 0);
  assert.equal(preview.linkedFaces[0]?.linkSource, "manual");
  assert.equal(preview.linkedFaces[0]?.matchConfidence, null);
  assert.match(String(preview.linkedFaces[0]?.faceThumbnailUrl), /asset-face-derivatives/);
  assert.equal("headshotThumbnailUrl" in (preview.linkedFaces[0]?.consent ?? {}), true);
  assert.equal("headshotPreviewUrl" in (preview.linkedFaces[0]?.consent ?? {}), true);
  assert.equal(preview.linkedFaces[0]?.consent.status, "revoked");
  assert.equal(preview.linkedFaces[0]?.consent.consentVersion, "v2");
  assert.equal(preview.linkedFaces[0]?.consent.faceMatchOptIn, true);
  assert.match(String(preview.linkedFaces[0]?.consent.goToConsentHref), new RegExp(`openConsentId=${consent.consentId}`));
  assert.deepEqual(preview.linkedFaces[0]?.consent.structuredSnapshotSummary, [
    "Scope: Website, Social",
    "Duration: 2 years",
    "Territory: EU and UK",
  ]);

  const signedFaceUrl = await signFaceDerivativeUrl({
    asset_face_id: targetFaceId,
    derivative_kind: "review_square_256",
    storage_bucket: "asset-face-derivatives",
    storage_path: "feature-044-placeholder.webp",
  });
  assert.ok(typeof signedFaceUrl === "string" || signedFaceUrl === null);
});

test("asset preview link candidates stay project-scoped, exclude revoked consents, and expose current asset links", async () => {
  const context = await createProjectContext(admin);
  const photoAssetId = await createAsset(admin, context, { assetType: "photo" });
  const consentA = await createOptedInConsentWithHeadshot(admin, context);
  const consentB = await createOptedInConsentWithHeadshot(admin, context);
  const consentRevoked = await createOptedInConsentWithHeadshot(admin, context);
  const photo = await materializeAsset(context, photoAssetId, [{ faceRank: 0 }, { faceRank: 1 }]);

  await manualLinkPhotoToConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consentA.consentId,
    actorUserId: context.userId,
    assetId: photoAssetId,
    assetFaceId: photo.faces[0]?.id ?? null,
    mode: "face",
  });
  await manualLinkPhotoToConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: consentB.consentId,
    actorUserId: context.userId,
    assetId: photoAssetId,
    assetFaceId: photo.faces[1]?.id ?? null,
    mode: "face",
  });
  await updateConsentPreviewFields(context, consentRevoked.consentId, {
    revoked: true,
  });

  const candidates = await getAssetPreviewLinkCandidates({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: photoAssetId,
    requestHostHeader: "localhost",
  });

  const candidateIds = new Set(candidates.candidates.map((candidate) => candidate.consentId));
  assert.ok(candidateIds.has(consentA.consentId));
  assert.ok(candidateIds.has(consentB.consentId));
  assert.equal(candidateIds.has(consentRevoked.consentId), false);

  const candidateA = candidates.candidates.find((candidate) => candidate.consentId === consentA.consentId) ?? null;
  const candidateB = candidates.candidates.find((candidate) => candidate.consentId === consentB.consentId) ?? null;
  assert.ok(candidateA);
  assert.ok(candidateB);
  assert.equal(candidateA?.currentAssetLink?.assetFaceId, photo.faces[0]?.id ?? null);
  assert.equal(candidateA?.currentAssetLink?.faceRank, 0);
  assert.equal(candidateB?.currentAssetLink?.assetFaceId, photo.faces[1]?.id ?? null);
  assert.equal(candidateB?.currentAssetLink?.faceRank, 1);
  assert.equal("headshotThumbnailUrl" in (candidateA ?? {}), true);
});

test("linked people strip renders linked cards and selection state without altering overlay data requirements", () => {
  const markup = renderToStaticMarkup(
    createElement(AssetPreviewLinkedPeopleStrip, {
      linkedFaces: [
        {
          assetFaceId: "face-1",
          faceRank: 0,
          faceBoxNormalized: {
            x_min: 0.1,
            y_min: 0.2,
            x_max: 0.3,
            y_max: 0.4,
          },
          faceThumbnailUrl: "https://example.com/face-1.webp",
          linkSource: "manual",
          matchConfidence: null,
          consent: {
            consentId: "consent-1",
            fullName: "Jane Doe",
            email: "jane@example.com",
            status: "active",
            signedAt: "2026-04-01T10:00:00.000Z",
            consentVersion: "v2",
            faceMatchOptIn: true,
            structuredSnapshotSummary: ["Scope: Website"],
            headshotThumbnailUrl: null,
            headshotPreviewUrl: null,
            goToConsentHref: "/projects/project-1?openConsentId=consent-1#consent-consent-1",
          },
        },
      ],
      hoveredLinkedFaceId: null,
      selectedLinkedFaceId: "face-1",
      isLoading: false,
      errorMessage: null,
      emptyLabel: "No linked people",
      autoLinkLabel: "Auto",
      manualLinkLabel: "Handmatig",
      onHoverChange: () => {},
      onSelect: () => {},
    }),
  );

  assert.match(markup, /Jane Doe/);
  assert.match(markup, /Handmatig/);
  assert.doesNotMatch(markup, /99%/);
  assert.doesNotMatch(markup, /jane@example\.com/);
  assert.match(markup, /face-1\.webp/);
});

test("consent panel renders placeholder and selected linked-face summary states", () => {
  const placeholderMarkup = renderToStaticMarkup(
    createElement(AssetPreviewConsentPanel, {
      linkedFace: null,
      locale: "en",
      placeholderLabel: "Select a linked face",
      goToConsentLabel: "Go to consent form",
      signedLabel: "Signed",
      consentSummaryLabel: "Consent summary",
      headshotLabel: "Headshot",
      noEmailLabel: "No email",
      unknownValueLabel: "Unknown",
      activeLabel: "Active",
      revokedLabel: "Revoked",
      autoLinkLabel: "Auto",
      manualLinkLabel: "Handmatig",
      removeLinkLabel: "Remove link",
      changePersonLabel: "Change person",
      changePersonCloseLabel: "Close picker",
      saveChangeLabel: "Save person change",
      currentLabel: "Current",
      linkedToFaceLabel: (face: number) => `Linked to Face ${face}`,
      pickerLoadingLabel: "Loading people...",
      pickerEmptyLabel: "No candidates",
      removeLinkErrorLabel: "Removing link...",
      changePersonErrorLabel: "Saving change...",
      moveWarningLabel: (face: number) => `Moves from Face ${face}`,
      isSaving: false,
      actionError: null,
      isChangePersonOpen: false,
      isLoadingCandidates: false,
      candidates: [],
      selectedReplacementConsentId: null,
      onRemoveLink: () => {},
      onToggleChangePerson: () => {},
      onSelectReplacement: () => {},
      onSaveChange: () => {},
    }),
  );

  assert.match(placeholderMarkup, /Select a linked face/);

  const selectedMarkup = renderToStaticMarkup(
    createElement(AssetPreviewConsentPanel, {
      linkedFace: {
        assetFaceId: "face-1",
        faceRank: 0,
        faceBoxNormalized: {
          x_min: 0.1,
          y_min: 0.2,
          x_max: 0.3,
          y_max: 0.4,
        },
        faceThumbnailUrl: "https://example.com/face-1.webp",
        linkSource: "manual",
        matchConfidence: null,
        consent: {
          consentId: "consent-1",
          fullName: "Jane Doe",
          email: "jane@example.com",
          status: "revoked",
          signedAt: "2026-04-01T10:00:00.000Z",
          consentVersion: "v2",
          faceMatchOptIn: true,
          structuredSnapshotSummary: ["Scope: Website"],
          headshotThumbnailUrl: "https://example.com/headshot.webp",
          headshotPreviewUrl: "https://example.com/headshot-preview.webp",
          goToConsentHref: "/projects/project-1?openConsentId=consent-1#consent-consent-1",
        },
      },
      locale: "en",
      placeholderLabel: "Select a linked face",
      goToConsentLabel: "Go to consent form",
      signedLabel: "Signed",
      consentSummaryLabel: "Consent summary",
      headshotLabel: "Headshot",
      noEmailLabel: "No email",
      unknownValueLabel: "Unknown",
      activeLabel: "Active",
      revokedLabel: "Revoked",
      autoLinkLabel: "Auto",
      manualLinkLabel: "Handmatig",
      removeLinkLabel: "Remove link",
      changePersonLabel: "Change person",
      changePersonCloseLabel: "Close picker",
      saveChangeLabel: "Save person change",
      currentLabel: "Current",
      linkedToFaceLabel: (face: number) => `Linked to Face ${face}`,
      pickerLoadingLabel: "Loading people...",
      pickerEmptyLabel: "No candidates",
      removeLinkErrorLabel: "Removing link...",
      changePersonErrorLabel: "Saving change...",
      moveWarningLabel: (face: number) => `Moves from Face ${face}`,
      isSaving: false,
      actionError: null,
      isChangePersonOpen: false,
      isLoadingCandidates: false,
      candidates: [],
      selectedReplacementConsentId: null,
      onRemoveLink: () => {},
      onToggleChangePerson: () => {},
      onSelectReplacement: () => {},
      onSaveChange: () => {},
    }),
  );

  assert.match(selectedMarkup, /Jane Doe/);
  assert.match(selectedMarkup, /Revoked/);
  assert.match(selectedMarkup, /Go to consent form/);
  assert.match(selectedMarkup, /Remove link/);
  assert.match(selectedMarkup, /Change person/);
  assert.doesNotMatch(selectedMarkup, /Consent version/);
  assert.doesNotMatch(selectedMarkup, /Face match opt-in/);
});

test("change person picker rows show names without email lines", () => {
  const markup = renderToStaticMarkup(
    createElement(AssetPreviewConsentPanel, {
      linkedFace: {
        assetFaceId: "face-1",
        faceRank: 0,
        faceBoxNormalized: {
          x_min: 0.1,
          y_min: 0.2,
          x_max: 0.3,
          y_max: 0.4,
        },
        faceThumbnailUrl: "https://example.com/face-1.webp",
        linkSource: "manual",
        matchConfidence: null,
        consent: {
          consentId: "consent-1",
          fullName: "Jane Doe",
          email: "jane@example.com",
          status: "active",
          signedAt: "2026-04-01T10:00:00.000Z",
          consentVersion: "v2",
          faceMatchOptIn: true,
          structuredSnapshotSummary: null,
          headshotThumbnailUrl: null,
          headshotPreviewUrl: null,
          goToConsentHref: "/projects/project-1?openConsentId=consent-1#consent-consent-1",
        },
      },
      locale: "en",
      placeholderLabel: "Select a linked face",
      goToConsentLabel: "Go to consent form",
      signedLabel: "Signed",
      consentSummaryLabel: "Consent summary",
      headshotLabel: "Headshot",
      noEmailLabel: "No email",
      unknownValueLabel: "Unknown",
      activeLabel: "Active",
      revokedLabel: "Revoked",
      autoLinkLabel: "Auto",
      manualLinkLabel: "Handmatig",
      removeLinkLabel: "Remove link",
      changePersonLabel: "Change person",
      changePersonCloseLabel: "Close picker",
      saveChangeLabel: "Save person change",
      currentLabel: "Current",
      linkedToFaceLabel: (face: number) => `Linked to Face ${face}`,
      pickerLoadingLabel: "Loading people...",
      pickerEmptyLabel: "No candidates",
      removeLinkErrorLabel: "Removing link...",
      changePersonErrorLabel: "Saving change...",
      moveWarningLabel: (face: number) => `Moves from Face ${face}`,
      isSaving: false,
      actionError: null,
      isChangePersonOpen: true,
      isLoadingCandidates: false,
      candidates: [
        {
          consentId: "consent-2",
          fullName: "Kim Example",
          email: "kim@example.com",
          headshotThumbnailUrl: "https://example.com/headshot.webp",
          currentAssetLink: null,
        },
      ],
      selectedReplacementConsentId: "consent-2",
      onRemoveLink: () => {},
      onToggleChangePerson: () => {},
      onSelectReplacement: () => {},
      onSaveChange: () => {},
    }),
  );

  assert.match(markup, /Kim Example/);
  assert.doesNotMatch(markup, /kim@example\.com/);
});
