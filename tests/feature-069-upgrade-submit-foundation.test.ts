import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { submitConsent } from "../src/lib/consent/submit-consent";
import { createInviteWithIdempotency } from "../src/lib/idempotency/invite-idempotency";
import { getAutoMatchMaterializerVersion } from "../src/lib/matching/auto-match-config";
import { ensureProjectConsentFaceAssignee } from "../src/lib/matching/project-face-assignees";
import { createProjectConsentUpgradeRequest } from "../src/lib/projects/project-consent-upgrade-service";
import { addProjectProfileParticipant, createProjectProfileConsentRequest } from "../src/lib/projects/project-participants-service";
import { submitRecurringProfileConsent } from "../src/lib/recurring-consent/public-recurring-consent";
import {
  createTenantTemplate,
  createTenantTemplateVersion,
  publishTenantTemplate,
  updateDraftTemplate,
} from "../src/lib/templates/template-service";
import {
  createStarterStructuredFieldsDefinition,
  type StructuredFieldsDefinition,
} from "../src/lib/templates/structured-fields";
import { deriveInviteToken } from "../src/lib/tokens/public-token";
import {
  adminClient,
  assertNoPostgrestError,
  createAuthUserWithRetry,
  signInClient,
} from "./helpers/supabase-test-client";

type TenantContext = {
  tenantId: string;
  ownerUserId: string;
  ownerClient: SupabaseClient;
  projectId: string;
};

function buildStructuredDefinition(extraScopeKey?: string): StructuredFieldsDefinition {
  const starter = createStarterStructuredFieldsDefinition();
  const scopeOptions = [
    {
      optionKey: "email",
      label: "Email",
      orderIndex: 0,
    },
    {
      optionKey: "social_media",
      label: "Social media",
      orderIndex: 1,
    },
  ];

  if (extraScopeKey) {
    scopeOptions.push({
      optionKey: extraScopeKey,
      label: extraScopeKey === "linkedin" ? "LinkedIn" : extraScopeKey,
      orderIndex: scopeOptions.length,
    });
  }

  return {
    ...starter,
    builtInFields: {
      ...starter.builtInFields,
      scope: {
        ...starter.builtInFields.scope,
        options: scopeOptions,
      },
    },
  };
}

async function createTenantContext(supabase: SupabaseClient): Promise<TenantContext> {
  const owner = await createAuthUserWithRetry(supabase, "feature069-submit-owner");
  const ownerClient = await signInClient(owner.email, owner.password);

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert({
      name: `Feature 069 Submit Tenant ${randomUUID()}`,
    })
    .select("id")
    .single();
  assertNoPostgrestError(tenantError, "insert tenant");

  const { error: membershipError } = await supabase.from("memberships").insert({
    tenant_id: tenant.id,
    user_id: owner.userId,
    role: "owner",
  });
  assertNoPostgrestError(membershipError, "insert membership");

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({
      tenant_id: tenant.id,
      created_by: owner.userId,
      name: `Feature 069 Submit Project ${randomUUID()}`,
      description: "Consent upgrade submit tests",
      status: "active",
    })
    .select("id")
    .single();
  assertNoPostgrestError(projectError, "insert project");

  return {
    tenantId: tenant.id,
    ownerUserId: owner.userId,
    ownerClient,
    projectId: project.id,
  };
}

async function publishStructuredTemplateVersion(
  context: TenantContext,
  name: string,
  definition: StructuredFieldsDefinition,
) {
  const created = await createTenantTemplate({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    idempotencyKey: `feature069-template-${randomUUID()}`,
    name,
    description: null,
    body: "This is a sufficiently long consent body for upgrade submit testing.",
  });

  await updateDraftTemplate({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    templateId: created.payload.template.id,
    name,
    description: null,
    body: "This is a sufficiently long consent body for upgrade submit testing.",
    structuredFieldsDefinition: definition,
  });

  return publishTenantTemplate({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    templateId: created.payload.template.id,
  });
}

async function publishNextTemplateVersion(
  context: TenantContext,
  priorTemplateId: string,
  definition: StructuredFieldsDefinition,
) {
  const version = await createTenantTemplateVersion({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    idempotencyKey: `feature069-template-version-${randomUUID()}`,
    templateId: priorTemplateId,
  });

  await updateDraftTemplate({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    templateId: version.payload.template.id,
    name: version.payload.template.name,
    description: null,
    body: "This is a sufficiently long consent body for upgrade submit testing.",
    structuredFieldsDefinition: definition,
  });

  return publishTenantTemplate({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    templateId: version.payload.template.id,
  });
}

async function createRecurringProfile(context: TenantContext) {
  const { data, error } = await context.ownerClient
    .from("recurring_profiles")
    .insert({
      tenant_id: context.tenantId,
      full_name: "Jordan Miles",
      email: `feature069-recurring-${randomUUID()}@example.com`,
      status: "active",
      created_by: context.ownerUserId,
    })
    .select("id")
    .single();
  assertNoPostgrestError(error, "insert recurring profile");
  return data.id as string;
}

async function createUploadedPhotoAsset(context: TenantContext) {
  const uploadedAt = new Date().toISOString();
  const { data, error } = await context.ownerClient
    .from("assets")
    .insert({
      tenant_id: context.tenantId,
      project_id: context.projectId,
      created_by: context.ownerUserId,
      storage_bucket: "project-assets",
      storage_path: `tenant/${context.tenantId}/project/${context.projectId}/asset/${randomUUID()}/photo.jpg`,
      original_filename: `feature069-${randomUUID()}.jpg`,
      content_type: "image/jpeg",
      file_size_bytes: 4096,
      content_hash: randomUUID().replaceAll("-", "").padEnd(64, "0").slice(0, 64),
      content_hash_algo: "sha256",
      asset_type: "photo",
      status: "uploaded",
      uploaded_at: uploadedAt,
    })
    .select("id")
    .single();
  assertNoPostgrestError(error, "insert uploaded photo asset");
  return data.id as string;
}

async function createPhotoMaterialization(context: TenantContext, assetId: string) {
  const materializedAt = new Date().toISOString();
  const { data: materialization, error: materializationError } = await adminClient
    .from("asset_face_materializations")
    .insert({
      tenant_id: context.tenantId,
      project_id: context.projectId,
      asset_id: assetId,
      asset_type: "photo",
      source_content_hash: `feature069-${randomUUID()}`,
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

  const { data: face, error: faceError } = await adminClient
    .from("asset_face_materialization_faces")
    .insert({
      tenant_id: context.tenantId,
      project_id: context.projectId,
      asset_id: assetId,
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

  return {
    materializationId: materialization.id as string,
    faceId: face.id as string,
  };
}

function tokenFromInvitePath(path: string) {
  return path.replace(/^\/i\//, "");
}

function tokenFromRecurringPath(path: string) {
  return path.replace(/^\/rp\//, "");
}

test("one-off upgrade submit keeps the same subject, updates owner fields, and supersedes the prior consent only after signing", async () => {
  const context = await createTenantContext(adminClient);
  const v1 = await publishStructuredTemplateVersion(context, "Media Release", buildStructuredDefinition());

  const initialInviteIdempotencyKey = `feature069-initial-invite-${randomUUID()}`;
  await createInviteWithIdempotency({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    userId: context.ownerUserId,
    idempotencyKey: initialInviteIdempotencyKey,
    consentTemplateId: v1.id,
  });

  const initialToken = deriveInviteToken({
    tenantId: context.tenantId,
    projectId: context.projectId,
    idempotencyKey: initialInviteIdempotencyKey,
  });

  const initialSubmission = await submitConsent({
    supabase: adminClient,
    token: initialToken,
    fullName: "Jordan Miles",
    email: "jordan@example.com",
    faceMatchOptIn: false,
    headshotAssetId: null,
    structuredFieldValues: {
      scope: ["email"],
      duration: "one_year",
    },
    captureIp: null,
    captureUserAgent: "feature069-one-off-initial",
  });

  const photoAssetId = await createUploadedPhotoAsset(context);
  const photoMaterialization = await createPhotoMaterialization(context, photoAssetId);
  const assignee = await ensureProjectConsentFaceAssignee({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    consentId: initialSubmission.consentId,
  });

  const { error: faceLinkError } = await adminClient.from("asset_face_consent_links").insert({
    asset_face_id: photoMaterialization.faceId,
    asset_materialization_id: photoMaterialization.materializationId,
    asset_id: photoAssetId,
    project_face_assignee_id: assignee.id,
    consent_id: initialSubmission.consentId,
    tenant_id: context.tenantId,
    project_id: context.projectId,
    link_source: "manual",
    match_confidence: null,
    matched_at: null,
    reviewed_at: null,
    reviewed_by: null,
    matcher_version: null,
  });
  assertNoPostgrestError(faceLinkError, "insert prior face link");

  const { error: fallbackError } = await adminClient.from("asset_consent_manual_photo_fallbacks").insert({
    asset_id: photoAssetId,
    consent_id: initialSubmission.consentId,
    tenant_id: context.tenantId,
    project_id: context.projectId,
    created_by: context.ownerUserId,
  });
  assertNoPostgrestError(fallbackError, "insert prior fallback");

  const { error: suppressionError } = await adminClient
    .from("asset_consent_manual_photo_fallback_suppressions")
    .insert({
      asset_id: photoAssetId,
      consent_id: initialSubmission.consentId,
      tenant_id: context.tenantId,
      project_id: context.projectId,
      reason: "manual_unlink",
      created_by: context.ownerUserId,
    });
  assertNoPostgrestError(suppressionError, "insert prior suppression");

  const v2 = await publishNextTemplateVersion(context, v1.id, buildStructuredDefinition("linkedin"));
  const upgradeCreate = await createProjectConsentUpgradeRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    projectId: context.projectId,
    consentId: initialSubmission.consentId,
    targetTemplateId: v2.id,
    idempotencyKey: `feature069-one-off-upgrade-${randomUUID()}`,
  });
  assert.equal(upgradeCreate.status, 201);

  const { data: priorBeforeSign, error: priorBeforeSignError } = await adminClient
    .from("consents")
    .select("id, superseded_at")
    .eq("tenant_id", context.tenantId)
    .eq("id", initialSubmission.consentId)
    .maybeSingle();
  assertNoPostgrestError(priorBeforeSignError, "select prior consent before sign");
  assert.equal(priorBeforeSign?.superseded_at, null);

  const upgradedSubmission = await submitConsent({
    supabase: adminClient,
    token: tokenFromInvitePath(upgradeCreate.payload.request.invitePath),
    fullName: "Jordan Miles Updated",
    email: "jordan.updated@example.com",
    faceMatchOptIn: false,
    headshotAssetId: null,
    structuredFieldValues: {
      scope: ["email", "linkedin"],
      duration: "one_year",
    },
    captureIp: null,
    captureUserAgent: "feature069-one-off-upgrade",
  });

  const { data: consentRows, error: consentRowsError } = await adminClient
    .from("consents")
    .select("id, subject_id, superseded_at, superseded_by_consent_id")
    .eq("tenant_id", context.tenantId)
    .in("id", [initialSubmission.consentId, upgradedSubmission.consentId])
    .order("created_at", { ascending: true });
  assertNoPostgrestError(consentRowsError, "select upgraded one-off consents");
  assert.equal(consentRows?.length, 2);
  assert.equal(consentRows?.[0]?.subject_id, consentRows?.[1]?.subject_id);
  assert.ok(consentRows?.[0]?.superseded_at);
  assert.equal(consentRows?.[0]?.superseded_by_consent_id, upgradedSubmission.consentId);
  assert.equal(consentRows?.[1]?.superseded_at, null);

  const { data: subjectRow, error: subjectRowError } = await adminClient
    .from("subjects")
    .select("id, full_name, email")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("id", consentRows?.[1]?.subject_id ?? "")
    .maybeSingle();
  assertNoPostgrestError(subjectRowError, "select updated subject");
  assert.equal(subjectRow?.full_name, "Jordan Miles Updated");
  assert.equal(subjectRow?.email, "jordan.updated@example.com");

  const { data: assigneeRow, error: assigneeRowError } = await adminClient
    .from("project_face_assignees")
    .select("id, consent_id")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("id", assignee.id)
    .maybeSingle();
  assertNoPostgrestError(assigneeRowError, "select carried-forward assignee");
  assert.equal(assigneeRow?.consent_id, upgradedSubmission.consentId);

  const { data: faceLinkRow, error: faceLinkRowError } = await adminClient
    .from("asset_face_consent_links")
    .select("project_face_assignee_id, consent_id")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("asset_face_id", photoMaterialization.faceId)
    .maybeSingle();
  assertNoPostgrestError(faceLinkRowError, "select carried-forward face link");
  assert.equal(faceLinkRow?.project_face_assignee_id, assignee.id);
  assert.equal(faceLinkRow?.consent_id, upgradedSubmission.consentId);

  const { data: fallbackRows, error: fallbackRowsError } = await adminClient
    .from("asset_consent_manual_photo_fallbacks")
    .select("consent_id")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("asset_id", photoAssetId);
  assertNoPostgrestError(fallbackRowsError, "select carried-forward fallbacks");
  assert.deepEqual((fallbackRows ?? []).map((row) => row.consent_id), [upgradedSubmission.consentId]);

  const { data: suppressionRows, error: suppressionRowsError } = await adminClient
    .from("asset_consent_manual_photo_fallback_suppressions")
    .select("consent_id")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("asset_id", photoAssetId);
  assertNoPostgrestError(suppressionRowsError, "select carried-forward suppressions");
  assert.deepEqual((suppressionRows ?? []).map((row) => row.consent_id), [upgradedSubmission.consentId]);

  const { data: upgradeRequest, error: upgradeRequestError } = await adminClient
    .from("project_consent_upgrade_requests")
    .select("status, completed_consent_id")
    .eq("tenant_id", context.tenantId)
    .eq("id", upgradeCreate.payload.request.id)
    .maybeSingle();
  assertNoPostgrestError(upgradeRequestError, "select completed one-off upgrade request");
  assert.equal(upgradeRequest?.status, "signed");
  assert.equal(upgradeRequest?.completed_consent_id, upgradedSubmission.consentId);
});

test("recurring project upgrades allow replacement requests while the old consent stays current until the new sign succeeds", async () => {
  const context = await createTenantContext(adminClient);
  const v1 = await publishStructuredTemplateVersion(context, "Project Participant Consent", buildStructuredDefinition());
  const profileId = await createRecurringProfile(context);
  const participant = await addProjectProfileParticipant({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    projectId: context.projectId,
    recurringProfileId: profileId,
  });

  const initialRequest = await createProjectProfileConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    projectId: context.projectId,
    participantId: participant.payload.participant.id,
    consentTemplateId: v1.id,
    idempotencyKey: `feature069-recurring-initial-${randomUUID()}`,
  });
  assert.equal(initialRequest.status, 201);

  const initialSubmission = await submitRecurringProfileConsent({
    supabase: adminClient,
    token: tokenFromRecurringPath(initialRequest.payload.request.consentPath),
    fullName: "Jordan Miles",
    email: "recurring.jordan@example.com",
    faceMatchOptIn: false,
    structuredFieldValues: {
      scope: ["email"],
      duration: "one_year",
    },
    captureIp: null,
    captureUserAgent: "feature069-recurring-initial",
  });

  const v2 = await publishNextTemplateVersion(context, v1.id, buildStructuredDefinition("linkedin"));
  const upgradeRequest = await createProjectProfileConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    projectId: context.projectId,
    participantId: participant.payload.participant.id,
    consentTemplateId: v2.id,
    idempotencyKey: `feature069-recurring-upgrade-${randomUUID()}`,
  });
  assert.equal(upgradeRequest.status, 201);

  const { data: priorBeforeSign, error: priorBeforeSignError } = await adminClient
    .from("recurring_profile_consents")
    .select("id, superseded_at")
    .eq("tenant_id", context.tenantId)
    .eq("id", initialSubmission.consentId)
    .maybeSingle();
  assertNoPostgrestError(priorBeforeSignError, "select prior recurring consent before sign");
  assert.equal(priorBeforeSign?.superseded_at, null);

  const upgradedSubmission = await submitRecurringProfileConsent({
    supabase: adminClient,
    token: tokenFromRecurringPath(upgradeRequest.payload.request.consentPath),
    fullName: "Jordan Miles Updated",
    email: "recurring.jordan.updated@example.com",
    faceMatchOptIn: false,
    structuredFieldValues: {
      scope: ["email", "linkedin"],
      duration: "one_year",
    },
    captureIp: null,
    captureUserAgent: "feature069-recurring-upgrade",
  });

  const { data: recurringConsents, error: recurringConsentsError } = await adminClient
    .from("recurring_profile_consents")
    .select("id, profile_id, profile_name_snapshot, profile_email_snapshot, superseded_at, superseded_by_consent_id")
    .eq("tenant_id", context.tenantId)
    .in("id", [initialSubmission.consentId, upgradedSubmission.consentId])
    .order("created_at", { ascending: true });
  assertNoPostgrestError(recurringConsentsError, "select recurring upgrade consents");
  assert.equal(recurringConsents?.length, 2);
  assert.equal(recurringConsents?.[0]?.profile_id, recurringConsents?.[1]?.profile_id);
  assert.ok(recurringConsents?.[0]?.superseded_at);
  assert.equal(recurringConsents?.[0]?.superseded_by_consent_id, upgradedSubmission.consentId);
  assert.equal(recurringConsents?.[1]?.superseded_at, null);
  assert.equal(recurringConsents?.[1]?.profile_name_snapshot, "Jordan Miles Updated");
  assert.equal(recurringConsents?.[1]?.profile_email_snapshot, "recurring.jordan.updated@example.com");

  const { data: profileRow, error: profileRowError } = await adminClient
    .from("recurring_profiles")
    .select("id, full_name, email")
    .eq("tenant_id", context.tenantId)
    .eq("id", profileId)
    .maybeSingle();
  assertNoPostgrestError(profileRowError, "select updated recurring profile");
  assert.equal(profileRow?.full_name, "Jordan Miles Updated");
  assert.equal(profileRow?.email, "recurring.jordan.updated@example.com");
});
