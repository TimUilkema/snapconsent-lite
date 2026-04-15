import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import JSZip from "jszip";

import {
  assignAssetExportFilenames,
  assignConsentExportFilenames,
  buildProjectFolderName,
} from "../src/lib/project-export/naming";
import {
  buildPreparedProjectExport,
  PROJECT_EXPORT_MAX_ASSET_COUNT,
  PROJECT_EXPORT_MAX_TOTAL_BYTES,
  type LoadedProjectExportRecords,
} from "../src/lib/project-export/project-export";
import { createProjectExportResponse } from "../src/lib/project-export/response";
import { HttpError } from "../src/lib/http/errors";
import { getAutoMatchMaterializerVersion } from "../src/lib/matching/auto-match-config";
import {
  adminClient,
  assertNoPostgrestError,
  createAnonClient,
  createAuthUserWithRetry,
  signInClient,
} from "./helpers/supabase-test-client";

type IntegrationContext = {
  tenantId: string;
  projectId: string;
  ownerUserId: string;
  photographerUserId: string;
  consentTemplateId: string;
  photographerClient: Awaited<ReturnType<typeof signInClient>>;
  outsiderClient: Awaited<ReturnType<typeof signInClient>>;
};

function createBaseRecords(): LoadedProjectExportRecords {
  return {
    assets: [
      {
        id: "asset-1",
        originalFilename: "DSC001.jpg",
        contentType: "image/jpeg",
        fileSizeBytes: 1024,
        uploadedAt: "2026-04-07T12:00:00Z",
        createdAt: "2026-04-07T11:00:00Z",
        storageBucket: "project-assets",
        storagePath: "tenant/t1/project/p1/asset/asset-1/DSC001.jpg",
      },
      {
        id: "asset-2",
        originalFilename: "DSC001.jpg",
        contentType: "image/jpeg",
        fileSizeBytes: 2048,
        uploadedAt: "2026-04-07T12:05:00Z",
        createdAt: "2026-04-07T11:05:00Z",
        storageBucket: "project-assets",
        storagePath: "tenant/t1/project/p1/asset/asset-2/DSC001.jpg",
      },
      {
        id: "asset-3",
        originalFilename: "###",
        contentType: "image/png",
        fileSizeBytes: 512,
        uploadedAt: "2026-04-07T12:10:00Z",
        createdAt: "2026-04-07T11:10:00Z",
        storageBucket: "project-assets",
        storagePath: "tenant/t1/project/p1/asset/asset-3/upload.png",
      },
    ],
    consents: [
      {
        id: "consent-1",
        subjectId: "subject-1",
        inviteId: "invite-1",
        signedAt: "2026-04-07T12:20:00Z",
        createdAt: "2026-04-07T12:20:00Z",
        consentText: "Signed text 1",
        consentVersion: "v1",
        faceMatchOptIn: true,
        revokedAt: null,
        revokeReason: null,
        structuredFieldsSnapshot: {
          schemaVersion: 1,
          values: {
            scope: {
              valueType: "checkbox_list",
              selectedOptionKeys: ["published_media"],
            },
          },
        },
        subjectFullName: "Tim Uilkema",
        subjectEmail: "tim@example.com",
      },
      {
        id: "consent-2",
        subjectId: "subject-2",
        inviteId: "invite-2",
        signedAt: "2026-04-07T12:30:00Z",
        createdAt: "2026-04-07T12:30:00Z",
        consentText: "Signed text 2",
        consentVersion: "v2",
        faceMatchOptIn: false,
        revokedAt: "2026-04-08T12:00:00Z",
        revokeReason: "subject request",
        structuredFieldsSnapshot: null,
        subjectFullName: "Tim Uilkema",
        subjectEmail: "tim+revoked@example.com",
      },
      {
        id: "consent-3",
        subjectId: "subject-3",
        inviteId: null,
        signedAt: "2026-04-07T12:40:00Z",
        createdAt: "2026-04-07T12:40:00Z",
        consentText: "Signed text 3",
        consentVersion: "v1",
        faceMatchOptIn: true,
        revokedAt: null,
        revokeReason: null,
        structuredFieldsSnapshot: null,
        subjectFullName: null,
        subjectEmail: null,
      },
    ],
    materializations: [
      {
        id: "mat-1",
        assetId: "asset-1",
        materializerVersion: "materializer-v1",
        provider: "test-provider",
        providerMode: "detection",
        faceCount: 2,
        sourceImageWidth: 6000,
        sourceImageHeight: 4000,
        sourceCoordinateSpace: "oriented_original",
      },
      {
        id: "mat-2",
        assetId: "asset-2",
        materializerVersion: "materializer-v1",
        provider: "test-provider",
        providerMode: "detection",
        faceCount: 0,
        sourceImageWidth: 5000,
        sourceImageHeight: 3000,
        sourceCoordinateSpace: "oriented_original",
      },
    ],
    faces: [
      {
        id: "face-1",
        assetId: "asset-1",
        materializationId: "mat-1",
        faceRank: 0,
        detectionProbability: 0.99,
        faceBox: {
          x_min: 10,
          y_min: 20,
          x_max: 30,
          y_max: 40,
          probability: 0.99,
        },
        faceBoxNormalized: {
          x_min: 0.1,
          y_min: 0.2,
          x_max: 0.3,
          y_max: 0.4,
          probability: 0.99,
        },
      },
      {
        id: "face-2",
        assetId: "asset-1",
        materializationId: "mat-1",
        faceRank: 1,
        detectionProbability: 0.88,
        faceBox: {
          x_min: 50,
          y_min: 60,
          x_max: 70,
          y_max: 80,
          probability: 0.88,
        },
        faceBoxNormalized: {
          x_min: 0.5,
          y_min: 0.6,
          x_max: 0.7,
          y_max: 0.8,
          probability: 0.88,
        },
      },
    ],
    faceLinks: [
      {
        assetId: "asset-1",
        projectFaceAssigneeId: "assignee-consent-1",
        identityKind: "project_consent",
        consentId: "consent-1",
        recurringProfileConsentId: null,
        projectProfileParticipantId: null,
        profileId: null,
        displayName: "Tim Uilkema",
        email: "tim@example.com",
        currentStatus: "active",
        assetFaceId: "face-1",
        assetMaterializationId: "mat-1",
        linkSource: "manual",
        matchConfidence: null,
      },
    ],
    fallbackLinks: [
      {
        assetId: "asset-2",
        consentId: "consent-2",
      },
    ],
  };
}

async function createIntegrationContext(): Promise<IntegrationContext> {
  const owner = await createAuthUserWithRetry(adminClient, "feature043-owner");
  const photographer = await createAuthUserWithRetry(adminClient, "feature043-photographer");
  const outsider = await createAuthUserWithRetry(adminClient, "feature043-outsider");
  const photographerClient = await signInClient(photographer.email, photographer.password);
  const outsiderClient = await signInClient(outsider.email, outsider.password);

  const { data: tenant, error: tenantError } = await adminClient
    .from("tenants")
    .insert({
      name: `Feature 043 Tenant ${randomUUID()}`,
    })
    .select("id")
    .single();
  assertNoPostgrestError(tenantError, "insert feature 043 tenant");
  assert.ok(tenant);

  const { error: membershipError } = await adminClient.from("memberships").insert([
    {
      tenant_id: tenant.id,
      user_id: owner.userId,
      role: "owner",
    },
    {
      tenant_id: tenant.id,
      user_id: photographer.userId,
      role: "photographer",
    },
  ]);
  assertNoPostgrestError(membershipError, "insert feature 043 memberships");

  const { data: outsiderTenant, error: outsiderTenantError } = await adminClient
    .from("tenants")
    .insert({
      name: `Feature 043 Outsider Tenant ${randomUUID()}`,
    })
    .select("id")
    .single();
  assertNoPostgrestError(outsiderTenantError, "insert feature 043 outsider tenant");
  assert.ok(outsiderTenant);

  const { error: outsiderMembershipError } = await adminClient.from("memberships").insert({
    tenant_id: outsiderTenant.id,
    user_id: outsider.userId,
    role: "photographer",
  });
  assertNoPostgrestError(outsiderMembershipError, "insert feature 043 outsider membership");

  const { data: project, error: projectError } = await adminClient
    .from("projects")
    .insert({
      tenant_id: tenant.id,
      created_by: owner.userId,
      name: "Feature 043 Export Project",
      description: "Feature 043 export integration test project",
      status: "active",
    })
    .select("id")
    .single();
  assertNoPostgrestError(projectError, "insert feature 043 project");
  assert.ok(project);

  const { data: consentTemplate, error: consentTemplateError } = await adminClient
    .from("consent_templates")
    .insert({
      tenant_id: tenant.id,
      template_key: `feature043-template-${randomUUID()}`,
      name: "Feature 043 Template",
      description: "Feature 043 export test template",
      version: "v1",
      version_number: 1,
      status: "published",
      body: "Feature 043 consent template body with enough content to satisfy validation.",
      created_by: owner.userId,
    })
    .select("id")
    .single();
  assertNoPostgrestError(consentTemplateError, "insert feature 043 consent template");
  assert.ok(consentTemplate);

  return {
    tenantId: tenant.id,
    projectId: project.id,
    ownerUserId: owner.userId,
    photographerUserId: photographer.userId,
    consentTemplateId: consentTemplate.id,
    photographerClient,
    outsiderClient,
  };
}

async function createInvite(input: {
  context: IntegrationContext;
}) {
  const { data, error } = await adminClient
    .from("subject_invites")
    .insert({
      tenant_id: input.context.tenantId,
      project_id: input.context.projectId,
      created_by: input.context.ownerUserId,
      token_hash: randomUUID().replaceAll("-", "").padEnd(64, "0").slice(0, 64),
      status: "active",
      max_uses: 1,
      consent_template_id: input.context.consentTemplateId,
    })
    .select("id")
    .single();
  assertNoPostgrestError(error, "insert feature 043 invite");
  assert.ok(data);
  return data.id as string;
}

async function createPhotoAsset(input: {
  context: IntegrationContext;
  filename: string;
  contentType?: string;
  fileContents?: Buffer;
  uploadObject?: boolean;
}) {
  const assetId = randomUUID();
  const safeFilename = input.filename.replace(/[^A-Za-z0-9._-]/g, "_") || "upload";
  const storagePath = `tenant/${input.context.tenantId}/project/${input.context.projectId}/asset/${assetId}/${safeFilename}`;
  const fileContents = input.fileContents ?? Buffer.from(`feature-043-${assetId}`);
  const contentType = input.contentType ?? "image/jpeg";

  const { error: assetError } = await adminClient.from("assets").insert({
    id: assetId,
    tenant_id: input.context.tenantId,
    project_id: input.context.projectId,
    created_by: input.context.ownerUserId,
    storage_bucket: "project-assets",
    storage_path: storagePath,
    original_filename: input.filename,
    content_type: contentType,
    file_size_bytes: fileContents.length,
    content_hash: randomUUID().replaceAll("-", "").padEnd(64, "0").slice(0, 64),
    content_hash_algo: "sha256",
    asset_type: "photo",
    status: "uploaded",
    uploaded_at: new Date().toISOString(),
  });
  assertNoPostgrestError(assetError, "insert feature 043 photo asset");

  if (input.uploadObject !== false) {
    const { error: uploadError } = await adminClient.storage
      .from("project-assets")
      .upload(storagePath, fileContents, {
        contentType,
        upsert: true,
      });
    assert.equal(uploadError, null);
  }

  return {
    assetId,
    storagePath,
    fileContents,
  };
}

async function createSubjectAndConsent(input: {
  context: IntegrationContext;
  fullName: string | null;
  email: string | null;
  consentText: string;
  consentVersion: string;
  faceMatchOptIn: boolean;
  revokedAt?: string | null;
  revokeReason?: string | null;
  structuredFieldsSnapshot?: Record<string, unknown> | null;
}) {
  const inviteId = await createInvite({
    context: input.context,
  });
  const signedAt = input.revokedAt
    ? new Date(new Date(input.revokedAt).getTime() - 60_000).toISOString()
    : new Date().toISOString();
  const normalizedEmail = input.email ?? `feature043-${randomUUID()}@example.com`;
  const { data: subject, error: subjectError } = await adminClient
    .from("subjects")
    .insert({
      tenant_id: input.context.tenantId,
      project_id: input.context.projectId,
      email: normalizedEmail,
      full_name: input.fullName ?? "Unknown Subject",
    })
    .select("id")
    .single();
  assertNoPostgrestError(subjectError, "insert feature 043 subject");
  assert.ok(subject);

  const consentId = randomUUID();
  const { error: consentError } = await adminClient.from("consents").insert({
    id: consentId,
    tenant_id: input.context.tenantId,
    project_id: input.context.projectId,
    subject_id: subject.id,
    invite_id: inviteId,
    consent_text: input.consentText,
    consent_version: input.consentVersion,
    signed_at: signedAt,
    revoked_at: input.revokedAt ?? null,
    revoke_reason: input.revokeReason ?? null,
    face_match_opt_in: input.faceMatchOptIn,
    structured_fields_snapshot: input.structuredFieldsSnapshot ?? null,
  });
  assertNoPostgrestError(consentError, "insert feature 043 consent");

  if (input.fullName === null || input.email === null) {
    const { error: subjectUpdateError } = await adminClient
      .from("subjects")
      .update({
        full_name: input.fullName,
        email: input.email,
      })
      .eq("id", subject.id);
    assertNoPostgrestError(subjectUpdateError, "update feature 043 nullable subject");
  }

  return {
    consentId,
    subjectId: subject.id,
    inviteId,
  };
}

async function createMaterialization(input: {
  context: IntegrationContext;
  assetId: string;
  faceCount: number;
  sourceImageWidth?: number | null;
  sourceImageHeight?: number | null;
}) {
  const materializationId = randomUUID();
  const { error } = await adminClient.from("asset_face_materializations").insert({
    id: materializationId,
    tenant_id: input.context.tenantId,
    project_id: input.context.projectId,
    asset_id: input.assetId,
    asset_type: "photo",
    source_content_hash: null,
    source_content_hash_algo: null,
    source_uploaded_at: new Date().toISOString(),
    materializer_version: getAutoMatchMaterializerVersion(),
    provider: "test-provider",
    provider_mode: "detection",
    provider_plugin_versions: {},
    face_count: input.faceCount,
    usable_for_compare: true,
    unusable_reason: null,
    source_image_width: input.sourceImageWidth ?? 6000,
    source_image_height: input.sourceImageHeight ?? 4000,
    source_coordinate_space: "oriented_original",
    materialized_at: new Date().toISOString(),
  });
  assertNoPostgrestError(error, "insert feature 043 materialization");

  return materializationId;
}

async function createFace(input: {
  context: IntegrationContext;
  assetId: string;
  materializationId: string;
  faceRank: number;
}) {
  const faceId = randomUUID();
  const { error } = await adminClient.from("asset_face_materialization_faces").insert({
    id: faceId,
    tenant_id: input.context.tenantId,
    project_id: input.context.projectId,
    asset_id: input.assetId,
    materialization_id: input.materializationId,
    face_rank: input.faceRank,
    provider_face_index: input.faceRank,
    detection_probability: 0.99,
    face_box: {
      x_min: input.faceRank * 10,
      y_min: input.faceRank * 20,
      x_max: input.faceRank * 10 + 100,
      y_max: input.faceRank * 20 + 120,
      probability: 0.99,
    },
    face_box_normalized: {
      x_min: 0.1 * (input.faceRank + 1),
      y_min: 0.2,
      x_max: 0.3,
      y_max: 0.4,
      probability: 0.99,
    },
    embedding: [0.1, 0.2, 0.3],
  });
  assertNoPostgrestError(error, "insert feature 043 face");

  return faceId;
}

async function createFaceLink(input: {
  context: IntegrationContext;
  assetId: string;
  materializationId: string;
  assetFaceId: string;
  consentId: string;
  linkSource?: "manual" | "auto";
  matchConfidence?: number | null;
}) {
  const { error } = await adminClient.from("asset_face_consent_links").insert({
    asset_face_id: input.assetFaceId,
    asset_materialization_id: input.materializationId,
    asset_id: input.assetId,
    consent_id: input.consentId,
    tenant_id: input.context.tenantId,
    project_id: input.context.projectId,
    link_source: input.linkSource ?? "manual",
    match_confidence: input.matchConfidence ?? null,
    matched_at: input.matchConfidence ? new Date().toISOString() : null,
    reviewed_at: null,
    reviewed_by: null,
    matcher_version: null,
  });
  assertNoPostgrestError(error, "insert feature 043 face link");
}

async function createFallbackLink(input: {
  context: IntegrationContext;
  assetId: string;
  consentId: string;
}) {
  const { error } = await adminClient.from("asset_consent_manual_photo_fallbacks").insert({
    asset_id: input.assetId,
    consent_id: input.consentId,
    tenant_id: input.context.tenantId,
    project_id: input.context.projectId,
    created_by: input.context.ownerUserId,
  });
  assertNoPostgrestError(error, "insert feature 043 fallback link");
}

async function createLegacyPhotoLink(input: {
  context: IntegrationContext;
  assetId: string;
  consentId: string;
}) {
  const { error } = await adminClient.from("asset_consent_links").upsert(
    {
      asset_id: input.assetId,
      consent_id: input.consentId,
      tenant_id: input.context.tenantId,
      project_id: input.context.projectId,
      link_source: "manual",
      match_confidence: null,
      matched_at: null,
      reviewed_at: null,
      reviewed_by: null,
      matcher_version: null,
    },
    { onConflict: "asset_id,consent_id" },
  );
  assertNoPostgrestError(error, "insert feature 043 legacy link");
}

async function loadZipFromResponse(response: Response) {
  assert.equal(response.status, 200);
  const zipBuffer = Buffer.from(await response.arrayBuffer());
  return JSZip.loadAsync(zipBuffer);
}

test("feature 043 naming helpers sanitize and resolve collisions deterministically", () => {
  assert.equal(buildProjectFolderName("  ", "project-12345678"), "project_project1");

  const assetNames = assignAssetExportFilenames([
    { id: "asset-1", originalFilename: "DSC001.jpg" },
    { id: "asset-2", originalFilename: "DSC001.jpg" },
    { id: "asset-3", originalFilename: "###" },
  ]);

  assert.deepEqual(assetNames, [
    {
      assetId: "asset-1",
      exportedFilename: "DSC001.jpg",
      metadataFilename: "DSC001_metadata.json",
    },
    {
      assetId: "asset-2",
      exportedFilename: "DSC001__asset_asset2.jpg",
      metadataFilename: "DSC001__asset_asset2_metadata.json",
    },
    {
      assetId: "asset-3",
      exportedFilename: "asset_asset3",
      metadataFilename: "asset_asset3_metadata.json",
    },
  ]);

  const consentNames = assignConsentExportFilenames([
    { id: "consent-1", fullName: "Tim Uilkema", email: "tim@example.com" },
    { id: "consent-2", fullName: "Tim Uilkema", email: "other@example.com" },
    { id: "consent-3", fullName: null, email: null },
  ]);

  assert.deepEqual(consentNames, [
    {
      consentId: "consent-1",
      exportedFilename: "Tim_Uilkema.json",
    },
    {
      consentId: "consent-2",
      exportedFilename: "Tim_Uilkema__consent_consent2.json",
    },
    {
      consentId: "consent-3",
      exportedFilename: "consent_consent3.json",
    },
  ]);
});

test("feature 043 prepared export keeps canonical face links, fallback links, and empty cases separate", () => {
  const prepared = buildPreparedProjectExport({
    projectId: "project-1",
    projectName: "Simple Export Project",
    records: createBaseRecords(),
  });

  assert.equal(prepared.projectFolderName, "Simple_Export_Project");
  assert.equal(prepared.downloadFilename, "Simple_Export_Project.zip");
  assert.equal(prepared.assetCount, 3);
  assert.equal(prepared.totalAssetBytes, 3584);
  assert.equal(prepared.assets.length, 3);
  assert.equal(prepared.consents.length, 3);

  const assetOne = prepared.assets.find((asset) => asset.assetId === "asset-1");
  assert.ok(assetOne);
  assert.equal(assetOne.exportedFilename, "DSC001.jpg");
  assert.equal(assetOne.metadata.metadataFilename, "DSC001_metadata.json");
  assert.equal(assetOne.metadata.materialization?.faceCount, 2);
  assert.equal(assetOne.metadata.detectedFaces.length, 2);
  assert.equal(assetOne.metadata.detectedFaces[0]?.linkedProjectFaceAssigneeId, "assignee-consent-1");
  assert.equal(assetOne.metadata.detectedFaces[0]?.linkedIdentityKind, "project_consent");
  assert.equal(assetOne.metadata.detectedFaces[0]?.linkedConsentId, "consent-1");
  assert.equal(assetOne.metadata.detectedFaces[0]?.linkSource, "manual");
  assert.equal(assetOne.metadata.detectedFaces[1]?.linkedConsentId, null);
  assert.deepEqual(assetOne.metadata.linkedConsents, [
    {
      consentId: "consent-1",
      subjectId: "subject-1",
      fullName: "Tim Uilkema",
      email: "tim@example.com",
      currentStatus: "active",
      revokedAt: null,
      revokeReason: null,
      linkMode: "face",
      linkSource: "manual",
      assetFaceId: "face-1",
      faceRank: 0,
      matchConfidence: null,
    },
  ]);
  assert.deepEqual(assetOne.metadata.linkedAssignees, [
    {
      projectFaceAssigneeId: "assignee-consent-1",
      identityKind: "project_consent",
      consentId: "consent-1",
      recurringProfileConsentId: null,
      projectProfileParticipantId: null,
      profileId: null,
      displayName: "Tim Uilkema",
      email: "tim@example.com",
      currentStatus: "active",
      linkMode: "face",
      linkSource: "manual",
      assetFaceId: "face-1",
      faceRank: 0,
      matchConfidence: null,
    },
  ]);

  const assetTwo = prepared.assets.find((asset) => asset.assetId === "asset-2");
  assert.ok(assetTwo);
  assert.equal(assetTwo.metadata.materialization?.faceCount, 0);
  assert.deepEqual(assetTwo.metadata.detectedFaces, []);
  assert.deepEqual(assetTwo.metadata.linkedConsents, [
    {
      consentId: "consent-2",
      subjectId: "subject-2",
      fullName: "Tim Uilkema",
      email: "tim+revoked@example.com",
      currentStatus: "revoked",
      revokedAt: "2026-04-08T12:00:00Z",
      revokeReason: "subject request",
      linkMode: "asset_fallback",
      linkSource: "manual",
      assetFaceId: null,
      faceRank: null,
      matchConfidence: null,
    },
  ]);
  assert.deepEqual(assetTwo.metadata.linkedAssignees, [
    {
      projectFaceAssigneeId: "fallback:consent-2",
      identityKind: "project_consent",
      consentId: "consent-2",
      recurringProfileConsentId: null,
      projectProfileParticipantId: null,
      profileId: null,
      displayName: "Tim Uilkema",
      email: "tim+revoked@example.com",
      currentStatus: "revoked",
      linkMode: "asset_fallback",
      linkSource: "manual",
      assetFaceId: null,
      faceRank: null,
      matchConfidence: null,
    },
  ]);

  const assetThree = prepared.assets.find((asset) => asset.assetId === "asset-3");
  assert.ok(assetThree);
  assert.equal(assetThree.metadata.materialization, null);
  assert.deepEqual(assetThree.metadata.detectedFaces, []);
  assert.deepEqual(assetThree.metadata.linkedConsents, []);
  assert.deepEqual(assetThree.metadata.linkedAssignees, []);

  const revokedConsent = prepared.consents.find((consent) => consent.consentId === "consent-2");
  assert.ok(revokedConsent);
  assert.equal(revokedConsent.data.currentStatus.state, "revoked");
  assert.equal(revokedConsent.data.signedSnapshot.structuredFieldsSnapshot, null);
  assert.deepEqual(revokedConsent.data.linkedAssets, [
    {
      assetId: "asset-2",
      originalFilename: "DSC001.jpg",
      exportedFilename: "DSC001__asset_asset2.jpg",
      linkMode: "asset_fallback",
      linkSource: "manual",
      assetFaceId: null,
      faceRank: null,
      matchConfidence: null,
    },
  ]);

  const unlinkedConsent = prepared.consents.find((consent) => consent.consentId === "consent-3");
  assert.ok(unlinkedConsent);
  assert.deepEqual(unlinkedConsent.data.linkedAssets, []);
});

test("feature 043 prepared export enforces synchronous guardrails", () => {
  const overCount = createBaseRecords();
  overCount.assets = Array.from({ length: PROJECT_EXPORT_MAX_ASSET_COUNT + 1 }, (_, index) => ({
    id: `asset-${index}`,
    originalFilename: `asset-${index}.jpg`,
    contentType: "image/jpeg",
    fileSizeBytes: 1,
    uploadedAt: "2026-04-07T12:00:00Z",
    createdAt: "2026-04-07T11:00:00Z",
    storageBucket: "project-assets",
    storagePath: `tenant/t1/project/p1/asset/${index}/asset.jpg`,
  }));
  overCount.materializations = [];
  overCount.faces = [];
  overCount.faceLinks = [];
  overCount.fallbackLinks = [];

  assert.throws(
    () =>
      buildPreparedProjectExport({
        projectId: "project-1",
        projectName: "Guardrail Project",
        records: overCount,
      }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 413);
      assert.equal(error.code, "project_export_too_large");
      return true;
    },
  );

  const overBytes = createBaseRecords();
  overBytes.assets = [
    {
      id: "asset-big",
      originalFilename: "big.jpg",
      contentType: "image/jpeg",
      fileSizeBytes: PROJECT_EXPORT_MAX_TOTAL_BYTES + 1,
      uploadedAt: "2026-04-07T12:00:00Z",
      createdAt: "2026-04-07T11:00:00Z",
      storageBucket: "project-assets",
      storagePath: "tenant/t1/project/p1/asset/big/big.jpg",
    },
  ];
  overBytes.materializations = [];
  overBytes.faces = [];
  overBytes.faceLinks = [];
  overBytes.fallbackLinks = [];

  assert.throws(
    () =>
      buildPreparedProjectExport({
        projectId: "project-1",
        projectName: "Guardrail Project",
        records: overBytes,
      }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 413);
      assert.equal(error.code, "project_export_too_large");
      return true;
    },
  );
});

test("feature 043 prepared export fails when an exported asset row has no original storage coordinates", () => {
  const records = createBaseRecords();
  records.assets[0] = {
    ...records.assets[0],
    storageBucket: null,
  };

  assert.throws(
    () =>
      buildPreparedProjectExport({
        projectId: "project-1",
        projectName: "Broken Export Project",
        records,
      }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 500);
      assert.equal(error.code, "project_export_asset_missing");
      return true;
    },
  );
});

test("feature 043 export response requires authentication and tenant membership", async () => {
  const context = await createIntegrationContext();
  const noMembershipUser = await createAuthUserWithRetry(adminClient, "feature043-no-membership");
  const noMembershipClient = await signInClient(noMembershipUser.email, noMembershipUser.password);

  await assert.rejects(
    createProjectExportResponse({
      authSupabase: createAnonClient(),
      adminSupabase: adminClient,
      projectId: context.projectId,
    }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 401);
      assert.equal(error.code, "unauthenticated");
      return true;
    },
  );

  await assert.rejects(
    createProjectExportResponse({
      authSupabase: noMembershipClient,
      adminSupabase: adminClient,
      projectId: context.projectId,
    }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 403);
      assert.equal(error.code, "no_tenant_membership");
      return true;
    },
  );
});

test("feature 043 export response hides projects outside the caller tenant scope", async () => {
  const context = await createIntegrationContext();

  await assert.rejects(
    createProjectExportResponse({
      authSupabase: context.outsiderClient,
      adminSupabase: adminClient,
      projectId: context.projectId,
    }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 404);
      assert.equal(error.code, "project_not_found");
      return true;
    },
  );
});

test("feature 043 photographer members can download a ZIP with original assets, sidecars, consents, and canonical current links only", async () => {
  const context = await createIntegrationContext();
  const assetOne = await createPhotoAsset({
    context,
    filename: "DSC001.jpg",
    fileContents: Buffer.from("asset-one-original"),
  });
  const assetTwo = await createPhotoAsset({
    context,
    filename: "DSC001.jpg",
    fileContents: Buffer.from("asset-two-original"),
  });
  const assetThree = await createPhotoAsset({
    context,
    filename: "Group Photo.png",
    contentType: "image/png",
    fileContents: Buffer.from("asset-three-original"),
  });

  const activeConsent = await createSubjectAndConsent({
    context,
    fullName: "Tim Uilkema",
    email: "tim@example.com",
    consentText: "Signed active consent text",
    consentVersion: "v1",
    faceMatchOptIn: true,
    structuredFieldsSnapshot: {
      schemaVersion: 1,
      values: {
        scope: {
          valueType: "checkbox_list",
          selectedOptionKeys: ["published_media"],
        },
      },
    },
  });
  const revokedConsent = await createSubjectAndConsent({
    context,
    fullName: "Revoked Subject",
    email: "revoked@example.com",
    consentText: "Signed revoked consent text",
    consentVersion: "v2",
    faceMatchOptIn: false,
    revokedAt: "2026-04-08T12:00:00Z",
    revokeReason: "subject request",
  });
  const unlinkedConsent = await createSubjectAndConsent({
    context,
    fullName: "Unlinked Subject",
    email: "unlinked@example.com",
    consentText: "Signed unlinked consent text",
    consentVersion: "v1",
    faceMatchOptIn: true,
  });
  const legacyOnlyConsent = await createSubjectAndConsent({
    context,
    fullName: "Legacy Link Subject",
    email: "legacy@example.com",
    consentText: "Signed legacy consent text",
    consentVersion: "v1",
    faceMatchOptIn: true,
  });

  const materializationOne = await createMaterialization({
    context,
    assetId: assetOne.assetId,
    faceCount: 2,
  });
  const faceOne = await createFace({
    context,
    assetId: assetOne.assetId,
    materializationId: materializationOne,
    faceRank: 0,
  });
  await createFace({
    context,
    assetId: assetOne.assetId,
    materializationId: materializationOne,
    faceRank: 1,
  });

  await createMaterialization({
    context,
    assetId: assetTwo.assetId,
    faceCount: 0,
  });

  await createFaceLink({
    context,
    assetId: assetOne.assetId,
    materializationId: materializationOne,
    assetFaceId: faceOne,
    consentId: activeConsent.consentId,
    linkSource: "manual",
  });
  await createFallbackLink({
    context,
    assetId: assetTwo.assetId,
    consentId: revokedConsent.consentId,
  });
  await createLegacyPhotoLink({
    context,
    assetId: assetOne.assetId,
    consentId: legacyOnlyConsent.consentId,
  });

  const response = await createProjectExportResponse({
    authSupabase: context.photographerClient,
    adminSupabase: adminClient,
    projectId: context.projectId,
  });

  assert.equal(response.headers.get("content-type"), "application/zip");
  assert.match(response.headers.get("content-disposition") ?? "", /attachment; filename="Feature_043_Export_Project\.zip"/);

  const zip = await loadZipFromResponse(response);
  const entryNames = Object.keys(zip.files).sort();
  assert.ok(entryNames.includes("Feature_043_Export_Project/assets/"));
  assert.ok(entryNames.includes("Feature_043_Export_Project/consent_forms/"));

  const exportedAssetOne = await zip.file("Feature_043_Export_Project/assets/DSC001.jpg")?.async("nodebuffer");
  assert.ok(exportedAssetOne);
  assert.deepEqual(exportedAssetOne, assetOne.fileContents);

  const exportedAssetTwo = await zip
    .file("Feature_043_Export_Project/assets/DSC001__asset_" + assetTwo.assetId.replace(/-/g, "").slice(0, 8) + ".jpg")
    ?.async("nodebuffer");
  assert.ok(exportedAssetTwo);
  assert.deepEqual(exportedAssetTwo, assetTwo.fileContents);

  const exportedAssetThree = await zip.file("Feature_043_Export_Project/assets/Group_Photo.png")?.async("nodebuffer");
  assert.ok(exportedAssetThree);
  assert.deepEqual(exportedAssetThree, assetThree.fileContents);

  const assetMetadataByAssetId = new Map<string, Record<string, unknown>>();
  for (const entryName of entryNames.filter((name) => name.includes("/assets/") && name.endsWith("_metadata.json"))) {
    const file = zip.file(entryName);
    assert.ok(file);
    const parsed = JSON.parse(await file.async("string")) as Record<string, unknown>;
    assetMetadataByAssetId.set(String(parsed.assetId), parsed);
  }

  assert.equal(assetMetadataByAssetId.size, 3);

  const assetOneMetadata = assetMetadataByAssetId.get(assetOne.assetId);
  assert.ok(assetOneMetadata);
  assert.equal(assetOneMetadata.originalFilename, "DSC001.jpg");
  assert.equal((assetOneMetadata.materialization as { faceCount?: number }).faceCount, 2);
  assert.equal((assetOneMetadata.detectedFaces as Array<{ linkedConsentId: string | null }>).length, 2);
  assert.equal((assetOneMetadata.detectedFaces as Array<{ linkedConsentId: string | null }>)[0]?.linkedConsentId, activeConsent.consentId);
  assert.deepEqual(
    (assetOneMetadata.linkedConsents as Array<{ consentId: string }>).map((link) => link.consentId),
    [activeConsent.consentId],
  );

  const assetTwoMetadata = assetMetadataByAssetId.get(assetTwo.assetId);
  assert.ok(assetTwoMetadata);
  assert.deepEqual((assetTwoMetadata.detectedFaces as unknown[]), []);
  assert.equal(
    (assetTwoMetadata.linkedConsents as Array<{ currentStatus: string; linkMode: string }>)[0]?.currentStatus,
    "revoked",
  );
  assert.equal(
    (assetTwoMetadata.linkedConsents as Array<{ currentStatus: string; linkMode: string }>)[0]?.linkMode,
    "asset_fallback",
  );

  const assetThreeMetadata = assetMetadataByAssetId.get(assetThree.assetId);
  assert.ok(assetThreeMetadata);
  assert.equal(assetThreeMetadata.materialization, null);
  assert.deepEqual((assetThreeMetadata.linkedConsents as unknown[]), []);

  const consentJsonById = new Map<string, Record<string, unknown>>();
  for (const entryName of entryNames.filter((name) => name.includes("/consent_forms/") && name.endsWith(".json"))) {
    const file = zip.file(entryName);
    assert.ok(file);
    const parsed = JSON.parse(await file.async("string")) as Record<string, unknown>;
    consentJsonById.set(String(parsed.consentId), parsed);
  }

  assert.equal(consentJsonById.size, 4);

  const activeConsentJson = consentJsonById.get(activeConsent.consentId);
  assert.ok(activeConsentJson);
  assert.equal(
    ((activeConsentJson.signedSnapshot as Record<string, unknown>).structuredFieldsSnapshot as Record<string, unknown>).schemaVersion,
    1,
  );
  assert.deepEqual(
    (activeConsentJson.linkedAssets as Array<{ assetId: string }>).map((asset) => asset.assetId),
    [assetOne.assetId],
  );

  const revokedConsentJson = consentJsonById.get(revokedConsent.consentId);
  assert.ok(revokedConsentJson);
  assert.equal((revokedConsentJson.currentStatus as { state?: string }).state, "revoked");
  assert.equal((revokedConsentJson.linkedAssets as Array<{ assetId: string }>)[0]?.assetId, assetTwo.assetId);

  const unlinkedConsentJson = consentJsonById.get(unlinkedConsent.consentId);
  assert.ok(unlinkedConsentJson);
  assert.deepEqual(unlinkedConsentJson.linkedAssets, []);

  const legacyOnlyConsentJson = consentJsonById.get(legacyOnlyConsent.consentId);
  assert.ok(legacyOnlyConsentJson);
  assert.deepEqual(legacyOnlyConsentJson.linkedAssets, []);
});

test("feature 043 export response enforces synchronous guardrails before ZIP streaming starts", async () => {
  const context = await createIntegrationContext();

  for (let index = 0; index < PROJECT_EXPORT_MAX_ASSET_COUNT + 1; index += 1) {
    await createPhotoAsset({
      context,
      filename: `asset-${index}.jpg`,
      uploadObject: false,
    });
  }

  await assert.rejects(
    createProjectExportResponse({
      authSupabase: context.photographerClient,
      adminSupabase: adminClient,
      projectId: context.projectId,
    }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 413);
      assert.equal(error.code, "project_export_too_large");
      return true;
    },
  );
});

test("feature 043 export response aborts the streamed ZIP when an original storage object is missing", async () => {
  const context = await createIntegrationContext();
  await createPhotoAsset({
    context,
    filename: "missing-object.jpg",
    uploadObject: false,
  });

  const response = await createProjectExportResponse({
    authSupabase: context.photographerClient,
    adminSupabase: adminClient,
    projectId: context.projectId,
  });

  await assert.rejects(
    response.arrayBuffer(),
    () => true,
  );
});
