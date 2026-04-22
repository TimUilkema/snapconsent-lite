import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getAutoMatchMaterializerVersion } from "../src/lib/matching/auto-match-config";
import {
  getAssetPreviewFaceCandidates,
  getAssetPreviewFaces,
  getAssetPreviewWholeAssetLinks,
  getAssetPreviewWholeAssetCandidates,
} from "../src/lib/matching/asset-preview-linking";
import {
  loadProjectConsentScopeFilterFamilies,
  resolveProjectAssetIdsByConsentScopeFilter,
} from "../src/lib/consent/project-consent-scope-filter";
import type { AutoMatcher } from "../src/lib/matching/auto-matcher";
import {
  blockAssetFace,
  manualLinkPhotoToRecurringProjectParticipant,
  manualUnlinkPhotoFaceAssignment,
} from "../src/lib/matching/consent-photo-matching";
import { ensureRecurringProfileMaterializedFaceCompare } from "../src/lib/matching/recurring-materialized-face-compare";
import { buildPreparedProjectExport, loadProjectExportRecords } from "../src/lib/project-export/project-export";
import { createBaselineConsentRequest } from "../src/lib/profiles/profile-consent-service";
import { createProjectProfileConsentRequest, addProjectProfileParticipant } from "../src/lib/projects/project-participants-service";
import {
  getPublicRecurringRevokeToken,
  revokeRecurringProfileConsentByToken,
} from "../src/lib/recurring-consent/revoke-recurring-profile-consent";
import { submitRecurringProfileConsent } from "../src/lib/recurring-consent/public-recurring-consent";
import { createStarterFormLayoutDefinition } from "../src/lib/templates/form-layout";
import { createStarterStructuredFieldsDefinition } from "../src/lib/templates/structured-fields";
import {
  adminClient,
  assertNoPostgrestError,
  createAnonClient,
  createAuthUserWithRetry,
  signInClient,
} from "./helpers/supabase-test-client";
import {
  loadCurrentWholeAssetLinksForAsset,
  manualLinkWholeAssetToConsent,
  manualLinkWholeAssetToRecurringProjectParticipant,
  manualUnlinkWholeAssetFromConsent,
  manualUnlinkWholeAssetFromRecurringProjectParticipant,
} from "../src/lib/matching/whole-asset-linking";

type TenantContext = {
  tenantId: string;
  ownerUserId: string;
  ownerClient: SupabaseClient;
};

function tokenFromConsentPath(consentPath: string) {
  return consentPath.split("/").pop() ?? "";
}

function createRecurringCompareMatcher(similarity: number): AutoMatcher {
  return {
    version: "feature-058-compare-test",
    async match() {
      assert.fail("candidate matching is not used in feature 058 tests");
    },
    async compareEmbeddings(input) {
      return {
        targetSimilarities: input.targetEmbeddings.map(() => similarity),
        providerMetadata: {
          provider: "feature-058-test",
          providerMode: "verification_embeddings",
          providerPluginVersions: null,
        },
      };
    },
  };
}

async function createTenantContext(): Promise<TenantContext> {
  const owner = await createAuthUserWithRetry(adminClient, "feature058-owner");
  const ownerClient = await signInClient(owner.email, owner.password);

  const { data: tenant, error: tenantError } = await adminClient
    .from("tenants")
    .insert({
      name: `Feature 058 Tenant ${randomUUID()}`,
    })
    .select("id")
    .single();
  assertNoPostgrestError(tenantError, "insert tenant");
  assert.ok(tenant);

  const { error: membershipError } = await adminClient.from("memberships").insert({
    tenant_id: tenant.id,
    user_id: owner.userId,
    role: "owner",
  });
  assertNoPostgrestError(membershipError, "insert membership");

  return {
    tenantId: tenant.id,
    ownerUserId: owner.userId,
    ownerClient,
  };
}

async function createProject(tenantId: string, userId: string, client: SupabaseClient) {
  const name = `Feature 058 Project ${randomUUID()}`;
  const { data, error } = await client
    .from("projects")
    .insert({
      tenant_id: tenantId,
      created_by: userId,
      name,
      description: null,
      status: "active",
    })
    .select("id")
    .single();

  assertNoPostgrestError(error, "insert project");
  assert.ok(data);
  return {
    projectId: data.id as string,
    projectName: name,
  };
}

async function createProfile(tenantId: string, userId: string, client: SupabaseClient) {
  const { data, error } = await client
    .from("recurring_profiles")
    .insert({
      tenant_id: tenantId,
      full_name: "Jordan Miles",
      email: `jordan-${randomUUID()}@example.com`,
      status: "active",
      created_by: userId,
    })
    .select("id")
    .single();

  assertNoPostgrestError(error, "insert recurring profile");
  assert.ok(data);
  return data.id as string;
}

async function createPublishedTemplate(tenantId: string, userId: string, client: SupabaseClient) {
  const structuredFieldsDefinition = createStarterStructuredFieldsDefinition();
  structuredFieldsDefinition.builtInFields.scope.options = [
    {
      optionKey: "photos",
      label: "Photos",
      orderIndex: 0,
    },
  ];
  const formLayoutDefinition = createStarterFormLayoutDefinition(structuredFieldsDefinition);
  const { data, error } = await client
    .from("consent_templates")
    .insert({
      tenant_id: tenantId,
      template_key: `feature058-template-${randomUUID()}`,
      name: "Feature 058 Consent",
      description: null,
      version: "v1",
      version_number: 1,
      status: "published",
      body: "I consent to the recurring profile processing described here.",
      structured_fields_definition: structuredFieldsDefinition,
      form_layout_definition: formLayoutDefinition,
      created_by: userId,
    })
    .select("id")
    .single();

  assertNoPostgrestError(error, "insert published template");
  assert.ok(data);
  return data.id as string;
}

async function createReadyRecurringHeadshot(input: {
  tenantId: string;
  userId: string;
  profileId: string;
}) {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const materializedAtIso = new Date(now + 1_000).toISOString();
  const headshotId = randomUUID();
  const faceId = randomUUID();
  const storageBucket = "recurring-profile-headshots";
  const storagePath = `tenant/${input.tenantId}/profile/${input.profileId}/headshot/${headshotId}/test.jpg`;

  const { error: uploadError } = await adminClient.storage
    .from(storageBucket)
    .upload(storagePath, Buffer.from("feature058-recurring-headshot"), {
      contentType: "image/jpeg",
      upsert: true,
    });
  assert.equal(uploadError, null);

  const { error: headshotError } = await adminClient.from("recurring_profile_headshots").insert({
    id: headshotId,
    tenant_id: input.tenantId,
    profile_id: input.profileId,
    storage_bucket: storageBucket,
    storage_path: storagePath,
    original_filename: "test.jpg",
    content_type: "image/jpeg",
    file_size_bytes: 1024,
    upload_status: "uploaded",
    uploaded_at: nowIso,
    materialization_status: "completed",
    materialized_at: materializedAtIso,
    selection_status: "manual_selected",
    selection_reason: "manual_override",
    created_by: input.userId,
    created_at: nowIso,
    updated_at: nowIso,
  });
  assertNoPostgrestError(headshotError, "insert recurring headshot");

  const { data: materialization, error: materializationError } = await adminClient
    .from("recurring_profile_headshot_materializations")
    .insert({
      tenant_id: input.tenantId,
      headshot_id: headshotId,
      materialization_version: getAutoMatchMaterializerVersion(),
      provider: "test-provider",
      provider_mode: "detection",
      provider_plugin_versions: {
        detector: "test",
      },
      face_count: 1,
      usable_for_compare: true,
      unusable_reason: null,
      source_image_width: 1200,
      source_image_height: 1600,
      source_coordinate_space: "oriented_original",
      materialized_at: materializedAtIso,
    })
    .select("id")
    .single();
  assertNoPostgrestError(materializationError, "insert recurring materialization");
  assert.ok(materialization);

  const { error: faceError } = await adminClient.from("recurring_profile_headshot_materialization_faces").insert({
    id: faceId,
    tenant_id: input.tenantId,
    materialization_id: materialization.id,
    face_rank: 0,
    provider_face_index: 0,
    detection_probability: 0.98,
    face_box: {
      x_min: 100,
      y_min: 100,
      x_max: 700,
      y_max: 1100,
      probability: 0.98,
    },
    face_box_normalized: {
      x_min: 0.1,
      y_min: 0.1,
      x_max: 0.6,
      y_max: 0.8,
      probability: 0.98,
    },
    embedding: [0.1, 0.2, 0.3],
  });
  assertNoPostgrestError(faceError, "insert recurring materialization face");

  const { error: selectError } = await adminClient
    .from("recurring_profile_headshots")
    .update({
      selection_face_id: faceId,
    })
    .eq("tenant_id", input.tenantId)
    .eq("id", headshotId);
  assertNoPostgrestError(selectError, "update recurring headshot selection");

  return {
    headshotId,
    materializationId: materialization.id as string,
    faceId,
  };
}

async function createUploadedPhotoAsset(input: {
  tenantId: string;
  projectId: string;
  userId: string;
  client: SupabaseClient;
}) {
  const uploadedAt = new Date().toISOString();
  const { data, error } = await input.client
    .from("assets")
    .insert({
      tenant_id: input.tenantId,
      project_id: input.projectId,
      asset_type: "photo",
      storage_bucket: "project-assets",
      storage_path: `tenant/${input.tenantId}/project/${input.projectId}/photo/${randomUUID()}.jpg`,
      original_filename: "feature058-photo.jpg",
      content_type: "image/jpeg",
      file_size_bytes: 2048,
      status: "uploaded",
      uploaded_at: uploadedAt,
      created_by: input.userId,
    })
    .select("id")
    .single();

  assertNoPostgrestError(error, "insert photo asset");
  assert.ok(data);
  return data.id as string;
}

async function createUploadedVideoAsset(input: {
  tenantId: string;
  projectId: string;
  userId: string;
  client: SupabaseClient;
}) {
  const uploadedAt = new Date().toISOString();
  const { data, error } = await input.client
    .from("assets")
    .insert({
      tenant_id: input.tenantId,
      project_id: input.projectId,
      asset_type: "video",
      storage_bucket: "project-assets",
      storage_path: `tenant/${input.tenantId}/project/${input.projectId}/video/${randomUUID()}.mp4`,
      original_filename: "feature064-video.mp4",
      content_type: "video/mp4",
      file_size_bytes: 4096,
      status: "uploaded",
      uploaded_at: uploadedAt,
      created_by: input.userId,
    })
    .select("id")
    .single();

  assertNoPostgrestError(error, "insert video asset");
  assert.ok(data);
  return data.id as string;
}

async function createProjectConsent(input: {
  tenantId: string;
  projectId: string;
  ownerUserId: string;
  consentTemplateId: string;
  fullName: string;
  email: string;
}) {
  const { data: invite, error: inviteError } = await adminClient
    .from("subject_invites")
    .insert({
      tenant_id: input.tenantId,
      project_id: input.projectId,
      created_by: input.ownerUserId,
      token_hash: randomUUID().replaceAll("-", "").padEnd(64, "0").slice(0, 64),
      status: "active",
      max_uses: 1,
      consent_template_id: input.consentTemplateId,
    })
    .select("id")
    .single();
  assertNoPostgrestError(inviteError, "insert project consent invite");
  assert.ok(invite);

  const { data: subject, error: subjectError } = await adminClient
    .from("subjects")
    .insert({
      tenant_id: input.tenantId,
      project_id: input.projectId,
      email: input.email,
      full_name: input.fullName,
    })
    .select("id")
    .single();
  assertNoPostgrestError(subjectError, "insert project consent subject");
  assert.ok(subject);

  const consentId = randomUUID();
  const { error: consentError } = await adminClient.from("consents").insert({
    id: consentId,
    tenant_id: input.tenantId,
    project_id: input.projectId,
    subject_id: subject.id,
    invite_id: invite.id,
    consent_text: "I consent to project media usage.",
    consent_version: "v1",
    signed_at: new Date().toISOString(),
    revoked_at: null,
    revoke_reason: null,
    face_match_opt_in: true,
    structured_fields_snapshot: null,
  });
  assertNoPostgrestError(consentError, "insert project consent");

  return consentId;
}

async function createPhotoMaterialization(input: {
  tenantId: string;
  projectId: string;
  assetId: string;
}) {
  const materializedAt = new Date().toISOString();
  const { data: materialization, error: materializationError } = await adminClient
    .from("asset_face_materializations")
    .insert({
      tenant_id: input.tenantId,
      project_id: input.projectId,
      asset_id: input.assetId,
      asset_type: "photo",
      source_content_hash: `feature058-${randomUUID()}`,
      source_content_hash_algo: "sha256",
      source_uploaded_at: materializedAt,
      materializer_version: getAutoMatchMaterializerVersion(),
      provider: "test-provider",
      provider_mode: "detection",
      provider_plugin_versions: {
        detector: "test",
      },
      face_count: 1,
      usable_for_compare: true,
      unusable_reason: null,
      source_image_width: 1200,
      source_image_height: 1600,
      source_coordinate_space: "oriented_original",
      materialized_at: materializedAt,
    })
    .select("id")
    .single();
  assertNoPostgrestError(materializationError, "insert photo materialization");
  assert.ok(materialization);

  const { data: face, error: faceError } = await adminClient
    .from("asset_face_materialization_faces")
    .insert({
      tenant_id: input.tenantId,
      project_id: input.projectId,
      asset_id: input.assetId,
      materialization_id: materialization.id,
      face_rank: 0,
      provider_face_index: 0,
      detection_probability: 0.99,
      face_box: {
        x_min: 80,
        y_min: 120,
        x_max: 620,
        y_max: 980,
        probability: 0.99,
      },
      face_box_normalized: {
        x_min: 0.08,
        y_min: 0.12,
        x_max: 0.52,
        y_max: 0.61,
        probability: 0.99,
      },
      embedding: [0.1, 0.2, 0.3],
      face_source: "detector",
    })
    .select("id")
    .single();
  assertNoPostgrestError(faceError, "insert photo materialization face");
  assert.ok(face);

  return {
    materializationId: materialization.id as string,
    faceId: face.id as string,
  };
}

async function loadCurrentFaceLink(input: {
  tenantId: string;
  projectId: string;
  assetFaceId: string;
}) {
  const { data, error } = await adminClient
    .from("asset_face_consent_links")
    .select("project_face_assignee_id, consent_id, link_source")
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("asset_face_id", input.assetFaceId)
    .maybeSingle();
  assertNoPostgrestError(error, "load current face link");
  return data as { project_face_assignee_id: string; consent_id: string | null; link_source: "manual" | "auto" } | null;
}

async function loadFaceSuppressions(input: {
  tenantId: string;
  projectId: string;
  assetFaceId: string;
}) {
  const { data, error } = await adminClient
    .from("asset_face_assignee_link_suppressions")
    .select("asset_face_id")
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("asset_face_id", input.assetFaceId);
  assertNoPostgrestError(error, "load face suppressions");
  return (data ?? []) as Array<{ asset_face_id: string }>;
}

test("feature 058 bridges project-scoped recurring evidence into visible candidates, canonical assignment, and export metadata", async () => {
  const context = await createTenantContext();
  const anonClient = createAnonClient();
  const { projectId, projectName } = await createProject(context.tenantId, context.ownerUserId, context.ownerClient);
  const templateId = await createPublishedTemplate(context.tenantId, context.ownerUserId, context.ownerClient);
  const profileId = await createProfile(context.tenantId, context.ownerUserId, context.ownerClient);
  const photoAssetId = await createUploadedPhotoAsset({
    tenantId: context.tenantId,
    projectId,
    userId: context.ownerUserId,
    client: context.ownerClient,
  });
  const photoMaterialization = await createPhotoMaterialization({
    tenantId: context.tenantId,
    projectId,
    assetId: photoAssetId,
  });

  const baselineRequest = await createBaselineConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
    consentTemplateId: templateId,
    idempotencyKey: `feature058-baseline-${randomUUID()}`,
  });
  await submitRecurringProfileConsent({
    supabase: anonClient,
    token: tokenFromConsentPath(baselineRequest.payload.request.consentPath),
    fullName: "Jordan Miles",
    email: `feature058-baseline-${randomUUID()}@example.com`,
    faceMatchOptIn: true,
    structuredFieldValues: {
      scope: ["photos"],
      duration: "one_year",
    },
    captureIp: "127.0.0.1",
    captureUserAgent: "feature058-baseline",
  });

  const readyHeadshot = await createReadyRecurringHeadshot({
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
  });
  const participant = await addProjectProfileParticipant({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    projectId,
    recurringProfileId: profileId,
  });
  const participantId = participant.payload.participant.id;

  await ensureRecurringProfileMaterializedFaceCompare({
    supabase: adminClient,
    matcher: createRecurringCompareMatcher(0.97),
    tenantId: context.tenantId,
    projectId,
    projectProfileParticipantId: participantId,
    profileId,
    assetId: photoAssetId,
    recurringHeadshotId: readyHeadshot.headshotId,
    recurringHeadshotMaterializationId: readyHeadshot.materializationId,
    recurringSelectionFaceId: readyHeadshot.faceId,
    assetMaterializationId: photoMaterialization.materializationId,
  });

  const missingCandidates = await getAssetPreviewFaceCandidates({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
    assetId: photoAssetId,
    assetFaceId: photoMaterialization.faceId,
  });
  const missingRecurringCandidate = missingCandidates.candidates.find(
    (candidate) => candidate.projectProfileParticipantId === participantId,
  );
  assert.ok(missingRecurringCandidate);
  assert.equal(missingRecurringCandidate.identityKind, "recurring_profile_match");
  assert.equal(missingRecurringCandidate.assignable, false);
  assert.equal(missingRecurringCandidate.assignmentBlockedReason, "project_consent_missing");
  assert.equal(missingRecurringCandidate.projectConsentState, "missing");

  const pendingRequest = await createProjectProfileConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    projectId,
    participantId,
    consentTemplateId: templateId,
    idempotencyKey: `feature058-project-${randomUUID()}`,
  });
  const pendingCandidates = await getAssetPreviewFaceCandidates({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
    assetId: photoAssetId,
    assetFaceId: photoMaterialization.faceId,
  });
  const pendingRecurringCandidate = pendingCandidates.candidates.find(
    (candidate) => candidate.projectProfileParticipantId === participantId,
  );
  assert.ok(pendingRecurringCandidate);
  assert.equal(pendingRecurringCandidate.assignable, false);
  assert.equal(pendingRecurringCandidate.assignmentBlockedReason, "project_consent_pending");
  assert.equal(pendingRecurringCandidate.projectConsentState, "pending");

  const signedProjectConsent = await submitRecurringProfileConsent({
    supabase: anonClient,
    token: tokenFromConsentPath(pendingRequest.payload.request.consentPath),
    fullName: "Jordan Miles",
    email: `feature058-project-${randomUUID()}@example.com`,
    faceMatchOptIn: true,
    structuredFieldValues: {
      scope: ["photos"],
      duration: "one_year",
    },
    captureIp: "127.0.0.1",
    captureUserAgent: "feature058-project",
  });
  const unscoredProfileId = await createProfile(context.tenantId, context.ownerUserId, context.ownerClient);
  await createReadyRecurringHeadshot({
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId: unscoredProfileId,
  });
  const unscoredParticipant = await addProjectProfileParticipant({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    projectId,
    recurringProfileId: unscoredProfileId,
  });
  const unscoredParticipantId = unscoredParticipant.payload.participant.id;
  const unscoredRequest = await createProjectProfileConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    projectId,
    participantId: unscoredParticipantId,
    consentTemplateId: templateId,
    idempotencyKey: `feature058-project-unscored-${randomUUID()}`,
  });
  await submitRecurringProfileConsent({
    supabase: anonClient,
    token: tokenFromConsentPath(unscoredRequest.payload.request.consentPath),
    fullName: "Taylor Rivers",
    email: `feature058-project-unscored-${randomUUID()}@example.com`,
    faceMatchOptIn: true,
    structuredFieldValues: {
      scope: ["photos"],
      duration: "one_year",
    },
    captureIp: "127.0.0.1",
    captureUserAgent: "feature058-project-unscored",
  });

  const signedCandidates = await getAssetPreviewFaceCandidates({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
    assetId: photoAssetId,
    assetFaceId: photoMaterialization.faceId,
  });
  const signedRecurringCandidate = signedCandidates.candidates.find(
    (candidate) => candidate.projectProfileParticipantId === participantId,
  );
  assert.ok(signedRecurringCandidate);
  assert.equal(signedRecurringCandidate.assignable, true);
  assert.equal(signedRecurringCandidate.assignmentBlockedReason, null);
  assert.equal(signedRecurringCandidate.projectConsentState, "signed");
  assert.equal(typeof signedRecurringCandidate.headshotThumbnailUrl, "string");
  const unscoredRecurringCandidate = signedCandidates.candidates.find(
    (candidate) => candidate.projectProfileParticipantId === unscoredParticipantId,
  );
  assert.ok(unscoredRecurringCandidate);
  assert.equal(unscoredRecurringCandidate.assignable, true);
  assert.equal(unscoredRecurringCandidate.projectConsentState, "signed");
  assert.equal(unscoredRecurringCandidate.scoreSource, "unscored");
  assert.equal(unscoredRecurringCandidate.similarityScore, null);
  assert.equal(typeof unscoredRecurringCandidate.headshotThumbnailUrl, "string");

  const blockedResult = await blockAssetFace({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
    assetId: photoAssetId,
    assetFaceId: photoMaterialization.faceId,
    actorUserId: context.ownerUserId,
  });
  assert.equal(blockedResult.kind, "blocked");

  const linkResult = await manualLinkPhotoToRecurringProjectParticipant({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
    assetId: photoAssetId,
    assetFaceId: photoMaterialization.faceId,
    projectProfileParticipantId: participantId,
    actorUserId: context.ownerUserId,
  });
  assert.equal(linkResult.kind, "linked");
  assert.equal(linkResult.mode, "face");

  const linkedFaceRow = await loadCurrentFaceLink({
    tenantId: context.tenantId,
    projectId,
    assetFaceId: photoMaterialization.faceId,
  });
  assert.ok(linkedFaceRow);
  assert.equal(typeof linkedFaceRow.project_face_assignee_id, "string");
  assert.equal(linkedFaceRow.consent_id, null);
  assert.equal(linkedFaceRow.link_source, "manual");

  const duplicateLinkResult = await manualLinkPhotoToRecurringProjectParticipant({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
    assetId: photoAssetId,
    assetFaceId: photoMaterialization.faceId,
    projectProfileParticipantId: participantId,
    actorUserId: context.ownerUserId,
  });
  assert.equal(duplicateLinkResult.kind, "already_linked");

  const linkedPreview = await getAssetPreviewFaces({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
    assetId: photoAssetId,
  });
  const linkedFace = linkedPreview.faces.find((face) => face.assetFaceId === photoMaterialization.faceId) ?? null;
  assert.ok(linkedFace);
  assert.equal(linkedFace.faceState, "linked_manual");
  assert.ok(linkedFace.currentLink);
  assert.equal(linkedFace.currentLink.identityKind, "project_recurring_consent");
  assert.equal(linkedFace.currentLink.consentId, null);
  assert.equal(linkedFace.currentLink.projectProfileParticipantId, participantId);
  assert.equal(linkedFace.currentLink.ownerState, "active");
  assert.equal(linkedFace.currentLink.recurring?.projectConsentState, "signed");
  assert.equal(typeof linkedFace.currentLink.recurring?.headshotThumbnailUrl, "string");

  const exportRecords = await loadProjectExportRecords({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
  });
  const preparedExport = buildPreparedProjectExport({
    projectId,
    projectName,
    records: exportRecords,
  });
  const exportedAsset = preparedExport.assets.find((asset) => asset.assetId === photoAssetId);
  assert.ok(exportedAsset);
  assert.equal(exportedAsset.metadata.detectedFaces[0]?.linkedIdentityKind, "project_recurring_consent");
  assert.equal(exportedAsset.metadata.detectedFaces[0]?.linkedConsentId, null);
  assert.equal(typeof exportedAsset.metadata.detectedFaces[0]?.linkedProjectFaceAssigneeId, "string");
  assert.equal(exportedAsset.metadata.linkedConsents.length, 0);
  assert.ok(
    exportedAsset.metadata.linkedAssignees.some(
      (assignee) =>
        assignee.identityKind === "project_recurring_consent"
        && assignee.projectProfileParticipantId === participantId
        && assignee.assetFaceId === photoMaterialization.faceId,
    ),
  );
  assert.ok(
    exportedAsset.metadata.linkedOwnerScopeStates.some(
      (scopeState) =>
        scopeState.identityKind === "project_recurring_consent"
        && scopeState.projectProfileParticipantId === participantId
        && scopeState.effectiveScopes.some((effectiveScope) => effectiveScope.scopeKey === "photos" && effectiveScope.status === "granted"),
    ),
  );

  const revokeContext = await getPublicRecurringRevokeToken(anonClient, signedProjectConsent.revokeToken ?? "");
  assert.ok(revokeContext);
  assert.equal(revokeContext?.status, "available");
  const revoked = await revokeRecurringProfileConsentByToken(
    anonClient,
    signedProjectConsent.revokeToken ?? "",
    "Feature 058 revoke",
  );
  assert.equal(revoked.revoked, true);
  assert.equal(revoked.alreadyRevoked, false);

  const revokedCandidates = await getAssetPreviewFaceCandidates({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
    assetId: photoAssetId,
    assetFaceId: photoMaterialization.faceId,
  });
  const revokedRecurringCandidate = revokedCandidates.candidates.find(
    (candidate) => candidate.projectProfileParticipantId === participantId,
  );
  assert.ok(revokedRecurringCandidate);
  assert.equal(revokedRecurringCandidate.assignable, false);
  assert.equal(revokedRecurringCandidate.assignmentBlockedReason, "project_consent_revoked");
  assert.equal(revokedRecurringCandidate.projectConsentState, "revoked");

  const revokedPreview = await getAssetPreviewFaces({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
    assetId: photoAssetId,
  });
  const revokedFace = revokedPreview.faces.find((face) => face.assetFaceId === photoMaterialization.faceId) ?? null;
  assert.ok(revokedFace?.currentLink);
  assert.equal(revokedFace.currentLink.ownerState, "revoked");
  assert.equal(revokedFace.currentLink.recurring?.projectConsentState, "revoked");

  const unlinkResult = await manualUnlinkPhotoFaceAssignment({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
    assetId: photoAssetId,
    assetFaceId: photoMaterialization.faceId,
    actorUserId: context.ownerUserId,
  });
  assert.equal(unlinkResult.kind, "unlinked");

  const suppressions = await loadFaceSuppressions({
    tenantId: context.tenantId,
    projectId,
    assetFaceId: photoMaterialization.faceId,
  });
  assert.equal(suppressions.length, 1);
});

test("feature 061 recurring whole-asset links export as whole_asset and are superseded by later exact-face links", async () => {
  const context = await createTenantContext();
  const anonClient = createAnonClient();
  const { projectId, projectName } = await createProject(context.tenantId, context.ownerUserId, context.ownerClient);
  const templateId = await createPublishedTemplate(context.tenantId, context.ownerUserId, context.ownerClient);
  const profileId = await createProfile(context.tenantId, context.ownerUserId, context.ownerClient);
  const photoAssetId = await createUploadedPhotoAsset({
    tenantId: context.tenantId,
    projectId,
    userId: context.ownerUserId,
    client: context.ownerClient,
  });
  const photoMaterialization = await createPhotoMaterialization({
    tenantId: context.tenantId,
    projectId,
    assetId: photoAssetId,
  });

  const baselineRequest = await createBaselineConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
    consentTemplateId: templateId,
    idempotencyKey: `feature061-recurring-baseline-${randomUUID()}`,
  });
  await submitRecurringProfileConsent({
    supabase: anonClient,
    token: tokenFromConsentPath(baselineRequest.payload.request.consentPath),
    fullName: "Jordan Miles",
    email: `feature061-recurring-baseline-${randomUUID()}@example.com`,
    faceMatchOptIn: true,
    structuredFieldValues: {
      scope: ["photos"],
      duration: "one_year",
    },
    captureIp: "127.0.0.1",
    captureUserAgent: "feature061-recurring-baseline",
  });

  await createReadyRecurringHeadshot({
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
  });
  const participant = await addProjectProfileParticipant({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    projectId,
    recurringProfileId: profileId,
  });
  const participantId = participant.payload.participant.id;

  const projectConsentRequest = await createProjectProfileConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    projectId,
    participantId,
    consentTemplateId: templateId,
    idempotencyKey: `feature061-recurring-project-${randomUUID()}`,
  });
  await submitRecurringProfileConsent({
    supabase: anonClient,
    token: tokenFromConsentPath(projectConsentRequest.payload.request.consentPath),
    fullName: "Jordan Miles",
    email: `feature061-recurring-project-${randomUUID()}@example.com`,
    faceMatchOptIn: true,
    structuredFieldValues: {
      scope: ["photos"],
      duration: "one_year",
    },
    captureIp: "127.0.0.1",
    captureUserAgent: "feature061-recurring-project",
  });

  const linkResult = await manualLinkWholeAssetToRecurringProjectParticipant({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
    assetId: photoAssetId,
    projectProfileParticipantId: participantId,
    actorUserId: context.ownerUserId,
  });
  assert.equal(linkResult.kind, "linked");

  const linkedWholeAssetRows = await loadCurrentWholeAssetLinksForAsset({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
    assetId: photoAssetId,
  });
  assert.equal(linkedWholeAssetRows.length, 1);
  assert.equal(linkedWholeAssetRows[0]?.project_profile_participant_id, participantId);

  const linkedPreview = await getAssetPreviewFaces({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
    assetId: photoAssetId,
  });
  assert.equal(linkedPreview.wholeAssetLinkCount, 1);
  assert.equal(linkedPreview.wholeAssetLinks[0]?.recurring?.projectProfileParticipantId, participantId);

  const wholeAssetCandidates = await getAssetPreviewWholeAssetCandidates({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
    assetId: photoAssetId,
  });
  const recurringCandidate = wholeAssetCandidates.candidates.find(
    (candidate) => candidate.projectProfileParticipantId === participantId,
  );
  assert.ok(recurringCandidate?.currentWholeAssetLink);
  assert.equal(recurringCandidate?.currentExactFaceLink, null);

  const exportRecords = await loadProjectExportRecords({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
  });
  const preparedWholeAssetExport = buildPreparedProjectExport({
    projectId,
    projectName,
    records: exportRecords,
  });
  const wholeAssetExport = preparedWholeAssetExport.assets.find((asset) => asset.assetId === photoAssetId);
  assert.ok(wholeAssetExport);
  assert.ok(
    wholeAssetExport.metadata.linkedAssignees.some(
      (assignee) =>
        assignee.projectProfileParticipantId === participantId &&
        assignee.linkMode === "whole_asset" &&
        assignee.assetFaceId === null,
    ),
  );
  assert.ok(
    wholeAssetExport.metadata.linkedOwnerScopeStates.some(
      (scopeState) =>
        scopeState.projectProfileParticipantId === participantId
        && scopeState.effectiveScopes.some((effectiveScope) => effectiveScope.scopeKey === "photos" && effectiveScope.status === "granted"),
    ),
  );

  const unlinkResult = await manualUnlinkWholeAssetFromRecurringProjectParticipant({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
    assetId: photoAssetId,
    projectProfileParticipantId: participantId,
  });
  assert.equal(unlinkResult.kind, "unlinked");

  const clearedWholeAssetRows = await loadCurrentWholeAssetLinksForAsset({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
    assetId: photoAssetId,
  });
  assert.equal(clearedWholeAssetRows.length, 0);

  const relinkResult = await manualLinkWholeAssetToRecurringProjectParticipant({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
    assetId: photoAssetId,
    projectProfileParticipantId: participantId,
    actorUserId: context.ownerUserId,
  });
  assert.equal(relinkResult.kind, "linked");

  const exactFaceLinkResult = await manualLinkPhotoToRecurringProjectParticipant({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
    assetId: photoAssetId,
    assetFaceId: photoMaterialization.faceId,
    projectProfileParticipantId: participantId,
    actorUserId: context.ownerUserId,
  });
  assert.equal(exactFaceLinkResult.kind, "linked");

  const supersededWholeAssetRows = await loadCurrentWholeAssetLinksForAsset({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
    assetId: photoAssetId,
  });
  assert.equal(supersededWholeAssetRows.length, 0);

  const exactPreview = await getAssetPreviewFaces({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
    assetId: photoAssetId,
  });
  assert.equal(exactPreview.wholeAssetLinkCount, 0);
  const exactFace = exactPreview.faces.find((face) => face.assetFaceId === photoMaterialization.faceId) ?? null;
  assert.ok(exactFace?.currentLink);
  assert.equal(exactFace.currentLink.projectProfileParticipantId, participantId);

  const exactExportRecords = await loadProjectExportRecords({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
  });
  const preparedExactExport = buildPreparedProjectExport({
    projectId,
    projectName,
    records: exactExportRecords,
  });
  const exactExport = preparedExactExport.assets.find((asset) => asset.assetId === photoAssetId);
  assert.ok(exactExport);
  assert.equal(
    exactExport.metadata.linkedAssignees.some((assignee) => assignee.linkMode === "whole_asset"),
    false,
  );
  assert.ok(
    exactExport.metadata.linkedAssignees.some(
      (assignee) =>
        assignee.projectProfileParticipantId === participantId &&
        assignee.linkMode === "face" &&
        assignee.assetFaceId === photoMaterialization.faceId,
    ),
  );
});

test("feature 067 recurring project assignees participate in asset scope filtering", async () => {
  const context = await createTenantContext();
  const anonClient = createAnonClient();
  const { projectId } = await createProject(context.tenantId, context.ownerUserId, context.ownerClient);
  const templateId = await createPublishedTemplate(context.tenantId, context.ownerUserId, context.ownerClient);
  const profileId = await createProfile(context.tenantId, context.ownerUserId, context.ownerClient);
  const photoAssetId = await createUploadedPhotoAsset({
    tenantId: context.tenantId,
    projectId,
    userId: context.ownerUserId,
    client: context.ownerClient,
  });

  const participant = await addProjectProfileParticipant({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    projectId,
    recurringProfileId: profileId,
  });
  const participantId = participant.payload.participant.id;
  const projectConsentRequest = await createProjectProfileConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    projectId,
    participantId,
    consentTemplateId: templateId,
    idempotencyKey: `feature067-project-${randomUUID()}`,
  });
  await submitRecurringProfileConsent({
    supabase: anonClient,
    token: tokenFromConsentPath(projectConsentRequest.payload.request.consentPath),
    fullName: "Jordan Miles",
    email: `feature067-project-${randomUUID()}@example.com`,
    faceMatchOptIn: true,
    structuredFieldValues: {
      scope: ["photos"],
      duration: "one_year",
    },
    captureIp: "127.0.0.1",
    captureUserAgent: "feature067-project",
  });
  await manualLinkWholeAssetToRecurringProjectParticipant({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
    assetId: photoAssetId,
    projectProfileParticipantId: participantId,
    actorUserId: context.ownerUserId,
  });

  const scopeFamilies = await loadProjectConsentScopeFilterFamilies({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
  });
  assert.equal(scopeFamilies.length, 1);
  const scopeFamily = scopeFamilies[0] ?? null;
  assert.ok(scopeFamily);
  assert.deepEqual(scopeFamily?.scopes.map((scope) => scope.scopeKey), ["photos"]);

  const matchedAssetIds = await resolveProjectAssetIdsByConsentScopeFilter({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
    assetIds: [photoAssetId],
    scopeTemplateKey: scopeFamily?.templateKey ?? "",
    scopeKey: "photos",
    scopeStatus: "granted",
  });
  assert.deepEqual(matchedAssetIds, [photoAssetId]);
});

test("feature 064 whole-asset video links support one-off and recurring assignees, idempotency, and revoked owners", async () => {
  const context = await createTenantContext();
  const anonClient = createAnonClient();
  const { projectId } = await createProject(context.tenantId, context.ownerUserId, context.ownerClient);
  const templateId = await createPublishedTemplate(context.tenantId, context.ownerUserId, context.ownerClient);
  const profileId = await createProfile(context.tenantId, context.ownerUserId, context.ownerClient);
  const videoAssetId = await createUploadedVideoAsset({
    tenantId: context.tenantId,
    projectId,
    userId: context.ownerUserId,
    client: context.ownerClient,
  });
  const consentId = await createProjectConsent({
    tenantId: context.tenantId,
    projectId,
    ownerUserId: context.ownerUserId,
    consentTemplateId: templateId,
    fullName: "Alex Rivera",
    email: `feature064-oneoff-${randomUUID()}@example.com`,
  });

  const baselineRequest = await createBaselineConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
    consentTemplateId: templateId,
    idempotencyKey: `feature064-recurring-baseline-${randomUUID()}`,
  });
  await submitRecurringProfileConsent({
    supabase: anonClient,
    token: tokenFromConsentPath(baselineRequest.payload.request.consentPath),
    fullName: "Jordan Miles",
    email: `feature064-recurring-baseline-${randomUUID()}@example.com`,
    faceMatchOptIn: true,
    structuredFieldValues: {
      scope: ["photos"],
      duration: "one_year",
    },
    captureIp: "127.0.0.1",
    captureUserAgent: "feature064-recurring-baseline",
  });

  await createReadyRecurringHeadshot({
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
  });
  const participant = await addProjectProfileParticipant({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    projectId,
    recurringProfileId: profileId,
  });
  const participantId = participant.payload.participant.id;

  const projectConsentRequest = await createProjectProfileConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    projectId,
    participantId,
    consentTemplateId: templateId,
    idempotencyKey: `feature064-recurring-project-${randomUUID()}`,
  });
  await submitRecurringProfileConsent({
    supabase: anonClient,
    token: tokenFromConsentPath(projectConsentRequest.payload.request.consentPath),
    fullName: "Jordan Miles",
    email: `feature064-recurring-project-${randomUUID()}@example.com`,
    faceMatchOptIn: true,
    structuredFieldValues: {
      scope: ["photos"],
      duration: "one_year",
    },
    captureIp: "127.0.0.1",
    captureUserAgent: "feature064-recurring-project",
  });

  const oneOffLinkResult = await manualLinkWholeAssetToConsent({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
    assetId: videoAssetId,
    consentId,
    actorUserId: context.ownerUserId,
  });
  assert.equal(oneOffLinkResult.kind, "linked");

  const duplicateOneOffLinkResult = await manualLinkWholeAssetToConsent({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
    assetId: videoAssetId,
    consentId,
    actorUserId: context.ownerUserId,
  });
  assert.equal(duplicateOneOffLinkResult.kind, "already_linked");

  const recurringLinkResult = await manualLinkWholeAssetToRecurringProjectParticipant({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
    assetId: videoAssetId,
    projectProfileParticipantId: participantId,
    actorUserId: context.ownerUserId,
  });
  assert.equal(recurringLinkResult.kind, "linked");

  const duplicateRecurringLinkResult = await manualLinkWholeAssetToRecurringProjectParticipant({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
    assetId: videoAssetId,
    projectProfileParticipantId: participantId,
    actorUserId: context.ownerUserId,
  });
  assert.equal(duplicateRecurringLinkResult.kind, "already_linked");

  const currentRows = await loadCurrentWholeAssetLinksForAsset({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
    assetId: videoAssetId,
  });
  assert.equal(currentRows.length, 2);

  const linkedPreview = await getAssetPreviewWholeAssetLinks({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
    assetId: videoAssetId,
  });
  assert.equal(linkedPreview.wholeAssetLinkCount, 2);
  assert.ok(linkedPreview.wholeAssetLinks.some((link) => link.consent?.consentId === consentId));
  assert.ok(
    linkedPreview.wholeAssetLinks.some(
      (link) => link.recurring?.projectProfileParticipantId === participantId,
    ),
  );

  const wholeAssetCandidates = await getAssetPreviewWholeAssetCandidates({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
    assetId: videoAssetId,
  });
  const oneOffCandidate = wholeAssetCandidates.candidates.find((candidate) => candidate.consentId === consentId);
  assert.ok(oneOffCandidate?.currentWholeAssetLink);
  assert.equal(oneOffCandidate?.currentExactFaceLink, null);

  const recurringCandidate = wholeAssetCandidates.candidates.find(
    (candidate) => candidate.projectProfileParticipantId === participantId,
  );
  assert.ok(recurringCandidate?.currentWholeAssetLink);
  assert.equal(recurringCandidate?.currentExactFaceLink, null);

  const revokedAt = new Date().toISOString();
  const { error: revokeConsentError } = await adminClient
    .from("consents")
    .update({
      revoked_at: revokedAt,
      revoke_reason: "feature064-test",
    })
    .eq("id", consentId);
  assertNoPostgrestError(revokeConsentError, "revoke video whole-asset consent");

  const revokedPreview = await getAssetPreviewWholeAssetLinks({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
    assetId: videoAssetId,
  });
  const revokedLink = revokedPreview.wholeAssetLinks.find((link) => link.consent?.consentId === consentId) ?? null;
  assert.ok(revokedLink);
  assert.equal(revokedLink?.ownerState, "revoked");
  assert.equal(revokedLink?.consent?.status, "revoked");

  const unlinkOneOffResult = await manualUnlinkWholeAssetFromConsent({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
    assetId: videoAssetId,
    consentId,
    actorUserId: context.ownerUserId,
  });
  assert.equal(unlinkOneOffResult.kind, "unlinked");

  const duplicateUnlinkOneOffResult = await manualUnlinkWholeAssetFromConsent({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
    assetId: videoAssetId,
    consentId,
    actorUserId: context.ownerUserId,
  });
  assert.equal(duplicateUnlinkOneOffResult.kind, "already_unlinked");

  const unlinkRecurringResult = await manualUnlinkWholeAssetFromRecurringProjectParticipant({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
    assetId: videoAssetId,
    projectProfileParticipantId: participantId,
    actorUserId: context.ownerUserId,
  });
  assert.equal(unlinkRecurringResult.kind, "unlinked");

  const duplicateUnlinkRecurringResult = await manualUnlinkWholeAssetFromRecurringProjectParticipant({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
    assetId: videoAssetId,
    projectProfileParticipantId: participantId,
    actorUserId: context.ownerUserId,
  });
  assert.equal(duplicateUnlinkRecurringResult.kind, "already_unlinked");

  const clearedRows = await loadCurrentWholeAssetLinksForAsset({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
    assetId: videoAssetId,
  });
  assert.equal(clearedRows.length, 0);
});
