import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PreviewableVideoPoster } from "../src/components/projects/assets-list";
import { AssetPreviewWholeAssetStrip } from "../src/components/projects/project-photo-asset-preview-lightbox";
import { signVideoPlaybackUrlsForAssets } from "../src/lib/assets/sign-asset-playback";
import { HttpError } from "../src/lib/http/errors";
import {
  getAssetPreviewFaces,
  getAssetPreviewWholeAssetCandidates,
  getAssetPreviewWholeAssetLinks,
} from "../src/lib/matching/asset-preview-linking";
import { manualLinkWholeAssetToConsent } from "../src/lib/matching/whole-asset-linking";
import { createStarterFormLayoutDefinition } from "../src/lib/templates/form-layout";
import { createStarterStructuredFieldsDefinition } from "../src/lib/templates/structured-fields";

type ProjectContext = {
  tenantId: string;
  projectId: string;
  userId: string;
  ownerClient: SupabaseClient;
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
    const email = `feature063-${randomUUID()}@example.com`;
    const password = `SnapConsent-${randomUUID()}-A1!`;
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (!error && data.user?.id) {
      return {
        userId: data.user.id,
        email,
        password,
      };
    }

    lastError = error;
    if (error?.code !== "unexpected_failure" || attempt === maxAttempts) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
  }

  assert.fail(
    `Unable to create auth user for tests: ${lastError?.code ?? "unknown"} ${lastError?.message ?? "no error message"}`,
  );
}

async function createProjectContext(supabase: SupabaseClient): Promise<ProjectContext> {
  const user = await createAuthUserWithRetry(supabase);
  const ownerClient = createClient(supabaseUrl, requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", envFromFile), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  const { error: signInError } = await ownerClient.auth.signInWithPassword({
    email: user.email,
    password: user.password,
  });
  assert.equal(signInError, null, `sign in owner client: ${signInError?.message ?? ""}`);

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert({ name: `Feature 063 Tenant ${randomUUID()}` })
    .select("id")
    .single();
  assertNoError(tenantError, "insert tenant");

  const { error: membershipError } = await supabase.from("memberships").insert({
    tenant_id: tenant.id,
    user_id: user.userId,
    role: "owner",
  });
  assertNoError(membershipError, "insert membership");

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({
      tenant_id: tenant.id,
      created_by: user.userId,
      name: `Feature 063 Project ${randomUUID()}`,
      description: "Feature 063 preview tests",
      status: "active",
    })
    .select("id")
    .single();
  assertNoError(projectError, "insert project");

  return {
    tenantId: tenant.id,
    projectId: project.id,
    userId: user.userId,
    ownerClient,
  };
}

async function createUploadedVideoAsset(
  supabase: SupabaseClient,
  context: ProjectContext,
) {
  const assetId = randomUUID();
  const originalFilename = `feature063-${randomUUID()}.mp4`;
  const storagePath = `tenant/${context.tenantId}/project/${context.projectId}/asset/${assetId}/${originalFilename}`;
  const buffer = Buffer.from("feature063-video-bytes");

  const { error: uploadError } = await supabase.storage
    .from("project-assets")
    .upload(storagePath, buffer, {
      contentType: "video/mp4",
      upsert: true,
    });
  assert.equal(uploadError, null, `upload original video asset: ${uploadError?.message ?? ""}`);

  const { error: assetError } = await supabase
    .from("assets")
    .insert({
      id: assetId,
      tenant_id: context.tenantId,
      project_id: context.projectId,
      created_by: context.userId,
      storage_bucket: "project-assets",
      storage_path: storagePath,
      original_filename: originalFilename,
      content_type: "video/mp4",
      file_size_bytes: buffer.length,
      asset_type: "video",
      status: "uploaded",
      uploaded_at: new Date().toISOString(),
    });
  assertNoError(assetError, "insert uploaded video asset");

  return {
    assetId,
    storagePath,
  };
}

async function createProjectConsent(
  supabase: SupabaseClient,
  context: ProjectContext,
  consentTemplateId: string,
) {
  const { data: invite, error: inviteError } = await supabase
    .from("subject_invites")
    .insert({
      tenant_id: context.tenantId,
      project_id: context.projectId,
      created_by: context.userId,
      token_hash: randomUUID().replaceAll("-", "").padEnd(64, "0").slice(0, 64),
      status: "active",
      max_uses: 1,
      consent_template_id: consentTemplateId,
    })
    .select("id")
    .single();
  assertNoError(inviteError, "insert feature 063 invite");
  assert.ok(invite);

  const { data: subject, error: subjectError } = await supabase
    .from("subjects")
    .insert({
      tenant_id: context.tenantId,
      project_id: context.projectId,
      email: `feature063-consent-${randomUUID()}@example.com`,
      full_name: "Feature 063 Subject",
    })
    .select("id")
    .single();
  assertNoError(subjectError, "insert feature 063 subject");
  assert.ok(subject);

  const consentId = randomUUID();
  const { error: consentError } = await supabase.from("consents").insert({
    id: consentId,
    tenant_id: context.tenantId,
    project_id: context.projectId,
    subject_id: subject.id,
    invite_id: invite.id,
    consent_text: "Feature 063 consent text",
    consent_version: "v1",
    signed_at: new Date().toISOString(),
    revoked_at: null,
    revoke_reason: null,
    face_match_opt_in: true,
    structured_fields_snapshot: null,
  });
  assertNoError(consentError, "insert feature 063 consent");
  return consentId;
}

async function createPublishedTemplate(context: ProjectContext) {
  const structuredFieldsDefinition = createStarterStructuredFieldsDefinition();
  structuredFieldsDefinition.builtInFields.scope.options = [
    {
      optionKey: "photos",
      label: "Photos",
      orderIndex: 0,
    },
  ];
  const formLayoutDefinition = createStarterFormLayoutDefinition(structuredFieldsDefinition);
  const { data, error } = await context.ownerClient
    .from("consent_templates")
    .insert({
      tenant_id: context.tenantId,
      template_key: `feature063-template-${randomUUID()}`,
      name: "Feature 063 Consent",
      description: null,
      version: "v1",
      version_number: 1,
      status: "published",
      body: "I consent to media usage.",
      structured_fields_definition: structuredFieldsDefinition,
      form_layout_definition: formLayoutDefinition,
      created_by: context.userId,
    })
    .select("id")
    .single();
  assertNoError(error, "insert consent template");
  assert.ok(data);
  return data.id as string;
}

test("PreviewableVideoPoster swaps between poster image and placeholder fallback", () => {
  const readyMarkup = renderToStaticMarkup(
    createElement(PreviewableVideoPoster, {
      src: "https://example.com/poster.jpg",
      alt: "Ready video",
      emptyLabel: "Poster unavailable",
      openLabel: "Open video",
      onOpenPreview: () => {},
    }),
  );
  assert.match(readyMarkup, /img/);
  assert.match(readyMarkup, /poster\.jpg/);

  const fallbackMarkup = renderToStaticMarkup(
    createElement(PreviewableVideoPoster, {
      src: null,
      alt: "Pending video",
      emptyLabel: "Poster unavailable",
      openLabel: "Open video",
      onOpenPreview: () => {},
    }),
  );
  assert.match(fallbackMarkup, /Poster unavailable/);
  assert.match(fallbackMarkup, /svg/);
});

test("signVideoPlaybackUrlsForAssets signs original private video objects", async () => {
  const context = await createProjectContext(admin);
  const uploadedAsset = await createUploadedVideoAsset(admin, context);

  const signedMap = await signVideoPlaybackUrlsForAssets([
    {
      id: uploadedAsset.assetId,
      status: "uploaded",
      storage_bucket: "project-assets",
      storage_path: uploadedAsset.storagePath,
    },
  ]);

  const signedUrl = signedMap.get(uploadedAsset.assetId) ?? "";
  assert.match(signedUrl, /project-assets/);
  assert.match(signedUrl, /token=/);
});

test("photo preview APIs reject video assets at the photo-only boundary", async () => {
  const context = await createProjectContext(admin);
  const uploadedAsset = await createUploadedVideoAsset(admin, context);

  await assert.rejects(
    async () => {
      await getAssetPreviewFaces({
        supabase: admin,
        tenantId: context.tenantId,
        projectId: context.projectId,
        assetId: uploadedAsset.assetId,
        requestHostHeader: null,
      });
    },
    (error: unknown) => error instanceof HttpError && error.code === "asset_not_found",
  );
});

test("video whole-asset preview helpers return current links and reusable candidates", async () => {
  const context = await createProjectContext(admin);
  const uploadedAsset = await createUploadedVideoAsset(admin, context);
  const consentTemplateId = await createPublishedTemplate(context);
  const consentId = await createProjectConsent(admin, context, consentTemplateId);

  const linkResult = await manualLinkWholeAssetToConsent({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: uploadedAsset.assetId,
    consentId,
    actorUserId: context.userId,
  });
  assert.equal(linkResult.kind, "linked");

  const wholeAssetLinks = await getAssetPreviewWholeAssetLinks({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: uploadedAsset.assetId,
    requestHostHeader: null,
  });
  assert.equal(wholeAssetLinks.wholeAssetLinkCount, 1);
  assert.equal(wholeAssetLinks.wholeAssetLinks[0]?.consent?.consentId, consentId);
  assert.equal(wholeAssetLinks.wholeAssetLinks[0]?.ownerState, "active");

  const wholeAssetCandidates = await getAssetPreviewWholeAssetCandidates({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: uploadedAsset.assetId,
    requestHostHeader: null,
  });
  const linkedCandidate = wholeAssetCandidates.candidates.find((candidate) => candidate.consentId === consentId);
  assert.ok(linkedCandidate);
  assert.ok(linkedCandidate?.currentWholeAssetLink);
  assert.equal(linkedCandidate?.currentExactFaceLink, null);
});

test("shared whole-asset strip renders current linked owners for video preview reuse", () => {
  const markup = renderToStaticMarkup(
    createElement(AssetPreviewWholeAssetStrip, {
      wholeAssetLinks: [
        {
          projectFaceAssigneeId: "assignee-1",
          identityKind: "project_consent",
          linkMode: "whole_asset",
          linkSource: "manual",
          matchConfidence: null,
          displayName: "Feature 063 Subject",
          email: "subject@example.com",
          ownerState: "active",
          consent: {
            consentId: "consent-1",
            fullName: "Feature 063 Subject",
            email: "subject@example.com",
            status: "active",
            signedAt: new Date().toISOString(),
            consentVersion: "v1",
            faceMatchOptIn: true,
            structuredSnapshotSummary: null,
            headshotThumbnailUrl: null,
            headshotPreviewUrl: null,
            goToConsentHref: "/projects/project/consents/consent-1",
            scopeStates: [],
          },
          recurring: null,
        },
      ],
      selectedWholeAssetAssigneeId: "assignee-1",
      isLoading: false,
      errorMessage: null,
      titleLabel: "Linked to entire asset",
      emptyLabel: "Empty",
      loadingLabel: "Loading",
      unknownPersonLabel: "Unknown",
      manualLinkLabel: "Whole asset",
      onSelect: () => {},
    }),
  );

  assert.match(markup, /Feature 063 Subject/);
  assert.match(markup, /Whole asset/);
});
