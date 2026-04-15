import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import { createBaselineConsentRequest } from "../src/lib/profiles/profile-consent-service";
import {
  deriveRecurringProfileMatchingReadiness,
} from "../src/lib/profiles/profile-headshot-service";
import { addProjectProfileParticipant } from "../src/lib/projects/project-participants-service";
import {
  getPublicRecurringRevokeToken,
  revokeRecurringProfileConsentByToken,
} from "../src/lib/recurring-consent/revoke-recurring-profile-consent";
import { submitRecurringProfileConsent } from "../src/lib/recurring-consent/public-recurring-consent";
import { createStarterFormLayoutDefinition } from "../src/lib/templates/form-layout";
import { createStarterStructuredFieldsDefinition } from "../src/lib/templates/structured-fields";
import { getAutoMatchMaterializerVersion } from "../src/lib/matching/auto-match-config";
import { enqueueCompareRecurringProfileMaterializedPairJob } from "../src/lib/matching/auto-match-jobs";
import { runAutoMatchWorker } from "../src/lib/matching/auto-match-worker";
import { resolveReadyProjectRecurringSource } from "../src/lib/matching/project-recurring-sources";
import {
  adminClient,
  assertNoPostgrestError,
  createAnonClient,
  createAuthUserWithRetry,
  signInClient,
} from "./helpers/supabase-test-client";

type TenantContext = {
  tenantId: string;
  ownerUserId: string;
  ownerClient: SupabaseClient;
};

function assertPostgrestConstraint(
  error: PostgrestError | null,
  code: string,
  context: string,
) {
  assert.ok(error, `${context}: expected a PostgrestError`);
  assert.equal(error.code, code, `${context}: unexpected error code`);
}

async function createTenantContext(): Promise<TenantContext> {
  const owner = await createAuthUserWithRetry(adminClient, "feature057-owner");
  const ownerClient = await signInClient(owner.email, owner.password);

  const { data: tenant, error: tenantError } = await adminClient
    .from("tenants")
    .insert({
      name: `Feature 057 Tenant ${randomUUID()}`,
    })
    .select("id")
    .single();
  assertNoPostgrestError(tenantError, "insert tenant");

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
  const { data, error } = await client
    .from("projects")
    .insert({
      tenant_id: tenantId,
      created_by: userId,
      name: `Feature 057 Project ${randomUUID()}`,
      description: null,
      status: "active",
    })
    .select("id")
    .single();

  assertNoPostgrestError(error, "insert project");
  return data.id as string;
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
      template_key: `feature057-template-${randomUUID()}`,
      name: "Feature 057 Consent",
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
  return data.id as string;
}

async function createReadyRecurringHeadshot(input: {
  tenantId: string;
  userId: string;
  profileId: string;
  supabase: SupabaseClient;
}) {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const materializedAtIso = new Date(now + 1_000).toISOString();
  const headshotId = randomUUID();
  const faceId = randomUUID();

  const { error: headshotError } = await adminClient.from("recurring_profile_headshots").insert({
    id: headshotId,
    tenant_id: input.tenantId,
    profile_id: input.profileId,
    storage_bucket: "recurring-profile-headshots",
    storage_path: `tenant/${input.tenantId}/profile/${input.profileId}/headshot/${headshotId}/test.jpg`,
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
      original_filename: "feature057-photo.jpg",
      content_type: "image/jpeg",
      file_size_bytes: 2048,
      status: "uploaded",
      uploaded_at: uploadedAt,
      created_by: input.userId,
    })
    .select("id, uploaded_at")
    .single();

  assertNoPostgrestError(error, "insert photo asset");
  return {
    assetId: data.id as string,
    uploadedAt: data.uploaded_at as string,
  };
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
      source_content_hash: `feature057-${randomUUID()}`,
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

  return {
    materializationId: materialization.id as string,
    faceId: face.id as string,
  };
}

async function listReconcileJobs(tenantId: string, projectId: string) {
  const { data, error } = await adminClient
    .from("face_match_jobs")
    .select("id, dedupe_key, status, payload, requeue_count")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("job_type", "reconcile_project")
    .order("created_at", { ascending: true });
  assertNoPostgrestError(error, "select reconcile jobs");
  return (data ?? []) as Array<{
    id: string;
    dedupe_key: string;
    status: string;
    payload: Record<string, unknown> | null;
    requeue_count: number;
  }>;
}

async function listRecurringFanoutContinuations(tenantId: string, projectId: string) {
  const { data, error } = await adminClient
    .from("face_match_fanout_continuations")
    .select(
      "id, direction, status, source_project_profile_participant_id, source_profile_id, source_headshot_id, source_selection_face_id, source_materialization_id, boundary_asset_id",
    )
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("direction", "recurring_profile_to_photos")
    .order("created_at", { ascending: true });
  assertNoPostgrestError(error, "select recurring fanout continuations");
  return (data ?? []) as Array<{
    id: string;
    direction: string;
    status: string;
    source_project_profile_participant_id: string | null;
    source_profile_id: string | null;
    source_headshot_id: string | null;
    source_selection_face_id: string | null;
    source_materialization_id: string | null;
    boundary_asset_id: string | null;
  }>;
}

async function listRecurringCompareRows(tenantId: string, projectId: string, assetId: string) {
  const { data, error } = await adminClient
    .from("asset_project_profile_face_compares")
    .select(
      "project_profile_participant_id, profile_id, asset_id, recurring_headshot_id, recurring_headshot_materialization_id, recurring_selection_face_id, asset_materialization_id, winning_asset_face_id, winning_similarity, compare_status",
    )
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("asset_id", assetId);
  assertNoPostgrestError(error, "select recurring compare rows");
  return data ?? [];
}

async function listRecurringCompareScoreRows(tenantId: string, projectId: string, assetId: string) {
  const { data, error } = await adminClient
    .from("asset_project_profile_face_compare_scores")
    .select("project_profile_participant_id, asset_id, asset_face_id, similarity")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("asset_id", assetId);
  assertNoPostgrestError(error, "select recurring compare score rows");
  return data ?? [];
}

async function runWorkerUntil(input: {
  workerIdPrefix: string;
  predicate: () => Promise<boolean>;
  batchSize?: number;
  matcher?: {
    version: string;
    match?: (...args: never[]) => Promise<unknown>;
    compareEmbeddings?: (input: { sourceEmbedding: number[]; targetEmbeddings: number[][] }) => Promise<{
      targetSimilarities: number[];
      providerMetadata: {
        provider: string;
        providerMode: string;
        providerPluginVersions: Record<string, unknown> | null;
      };
    }>;
  };
  maxRuns?: number;
}) {
  const maxRuns = input.maxRuns ?? 12;
  for (let attempt = 0; attempt < maxRuns; attempt += 1) {
    if (await input.predicate()) {
      return;
    }

    await runAutoMatchWorker({
      supabase: adminClient,
      workerId: `${input.workerIdPrefix}-${attempt}-${randomUUID()}`,
      batchSize: input.batchSize ?? 10,
      matcher: input.matcher,
    });
  }

  assert.ok(await input.predicate(), `${input.workerIdPrefix} did not satisfy its completion predicate`);
}

test("resolveReadyProjectRecurringSource returns the current ready source and addProjectProfileParticipant enqueues replay", async () => {
  const context = await createTenantContext();
  const projectId = await createProject(context.tenantId, context.ownerUserId, context.ownerClient);
  const profileId = await createProfile(context.tenantId, context.ownerUserId, context.ownerClient);
  const templateId = await createPublishedTemplate(context.tenantId, context.ownerUserId, context.ownerClient);
  const anonClient = createAnonClient();

  const baselineRequest = await createBaselineConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
    consentTemplateId: templateId,
    idempotencyKey: `feature057-baseline-${randomUUID()}`,
  });
  const baselineToken = baselineRequest.payload.request.consentPath.split("/").pop() ?? "";
  await submitRecurringProfileConsent({
    supabase: anonClient,
    token: baselineToken,
    fullName: "Jordan Miles",
    email: `feature057-${randomUUID()}@example.com`,
    faceMatchOptIn: true,
    structuredFieldValues: {
      scope: ["photos"],
      duration: "one_year",
    },
    captureIp: "127.0.0.1",
    captureUserAgent: "feature057-ready-source",
  });

  const readyHeadshot = await createReadyRecurringHeadshot({
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
    supabase: context.ownerClient,
  });

  const readiness = await deriveRecurringProfileMatchingReadiness({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    profileId,
  });
  assert.equal(readiness.state, "ready");
  assert.equal(readiness.currentHeadshotId, readyHeadshot.headshotId);
  assert.equal(readiness.selectionFaceId, readyHeadshot.faceId);

  const result = await addProjectProfileParticipant({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    projectId,
    recurringProfileId: profileId,
  });

  assert.equal(result.status, 201);

  const resolvedSource = await resolveReadyProjectRecurringSource(context.ownerClient, {
    tenantId: context.tenantId,
    projectId,
    projectProfileParticipantId: result.payload.participant.id,
  });
  assert.ok(resolvedSource);
  assert.equal(resolvedSource?.profileId, profileId);
  assert.equal(resolvedSource?.projectProfileParticipantId, result.payload.participant.id);
  assert.equal(resolvedSource?.recurringHeadshotId, readyHeadshot.headshotId);
  assert.equal(resolvedSource?.recurringHeadshotMaterializationId, readyHeadshot.materializationId);
  assert.equal(resolvedSource?.selectionFaceId, readyHeadshot.faceId);

  const reconcileJobs = await listReconcileJobs(context.tenantId, projectId);
  assert.equal(reconcileJobs.length, 1);
  assert.equal(reconcileJobs[0]?.status, "queued");
  assert.equal(
    reconcileJobs[0]?.dedupe_key,
    `reconcile_project:${projectId.toLowerCase()}:recurring_profile_participant:${result.payload.participant.id.toLowerCase()}`,
  );
  assert.equal(reconcileJobs[0]?.payload?.replayKind, "recurring_profile_source");
  assert.equal(reconcileJobs[0]?.payload?.projectProfileParticipantId, result.payload.participant.id);
  assert.equal(reconcileJobs[0]?.payload?.profileId, profileId);

  const duplicate = await addProjectProfileParticipant({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    projectId,
    recurringProfileId: profileId,
  });
  assert.equal(duplicate.status, 200);

  const { data: participants, error: participantsError } = await context.ownerClient
    .from("project_profile_participants")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", projectId)
    .eq("recurring_profile_id", profileId);
  assertNoPostgrestError(participantsError, "select project profile participants");
  assert.equal(participants?.length ?? 0, 1);
});

test("baseline recurring consent submit and revoke requeue replay for existing project participants", async () => {
  const context = await createTenantContext();
  const projectId = await createProject(context.tenantId, context.ownerUserId, context.ownerClient);
  const profileId = await createProfile(context.tenantId, context.ownerUserId, context.ownerClient);
  const templateId = await createPublishedTemplate(context.tenantId, context.ownerUserId, context.ownerClient);
  const anonClient = createAnonClient();

  await createReadyRecurringHeadshot({
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
    supabase: context.ownerClient,
  });

  const participantResult = await addProjectProfileParticipant({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    projectId,
    recurringProfileId: profileId,
  });
  assert.equal(participantResult.status, 201);

  let reconcileJobs = await listReconcileJobs(context.tenantId, projectId);
  assert.equal(reconcileJobs.length, 0);

  const baselineRequest = await createBaselineConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
    consentTemplateId: templateId,
    idempotencyKey: `feature057-submit-${randomUUID()}`,
  });
  const baselineToken = baselineRequest.payload.request.consentPath.split("/").pop() ?? "";
  const signed = await submitRecurringProfileConsent({
    supabase: anonClient,
    token: baselineToken,
    fullName: "Jordan Miles",
    email: `feature057-submit-${randomUUID()}@example.com`,
    faceMatchOptIn: true,
    structuredFieldValues: {
      scope: ["photos"],
      duration: "one_year",
    },
    captureIp: "127.0.0.1",
    captureUserAgent: "feature057-submit",
  });

  reconcileJobs = await listReconcileJobs(context.tenantId, projectId);
  assert.equal(reconcileJobs.length, 1);
  assert.equal(reconcileJobs[0]?.payload?.reason, "baseline_recurring_consent_opt_in_granted");

  const { error: deleteJobsError } = await adminClient
    .from("face_match_jobs")
    .delete()
    .eq("tenant_id", context.tenantId)
    .eq("project_id", projectId)
    .eq("job_type", "reconcile_project");
  assertNoPostgrestError(deleteJobsError, "delete reconcile jobs");

  const revokeContext = await getPublicRecurringRevokeToken(anonClient, signed.revokeToken ?? "");
  assert.ok(revokeContext);
  assert.equal(revokeContext?.status, "available");

  const revoked = await revokeRecurringProfileConsentByToken(
    anonClient,
    signed.revokeToken ?? "",
    "Feature 057 revoke",
  );
  assert.equal(revoked.revoked, true);
  assert.equal(revoked.alreadyRevoked, false);

  reconcileJobs = await listReconcileJobs(context.tenantId, projectId);
  assert.equal(reconcileJobs.length, 1);
  assert.equal(reconcileJobs[0]?.payload?.reason, "baseline_recurring_consent_revoked");
});

test("project profile participants remain unique per project/profile in feature 057 flow", async () => {
  const context = await createTenantContext();
  const projectId = await createProject(context.tenantId, context.ownerUserId, context.ownerClient);
  const profileId = await createProfile(context.tenantId, context.ownerUserId, context.ownerClient);

  const { error: firstInsertError } = await context.ownerClient.from("project_profile_participants").insert({
    tenant_id: context.tenantId,
    project_id: projectId,
    recurring_profile_id: profileId,
    created_by: context.ownerUserId,
  });
  assertNoPostgrestError(firstInsertError, "insert project profile participant");

  const { error: duplicateError } = await context.ownerClient.from("project_profile_participants").insert({
    tenant_id: context.tenantId,
    project_id: projectId,
    recurring_profile_id: profileId,
    created_by: context.ownerUserId,
  });
  assertPostgrestConstraint(duplicateError, "23505", "duplicate project profile participant");
});

test("participant-scoped recurring replay creates recurring-profile fanout continuations for existing project photos", async () => {
  const context = await createTenantContext();
  const projectId = await createProject(context.tenantId, context.ownerUserId, context.ownerClient);
  const profileId = await createProfile(context.tenantId, context.ownerUserId, context.ownerClient);
  const templateId = await createPublishedTemplate(context.tenantId, context.ownerUserId, context.ownerClient);
  const anonClient = createAnonClient();
  const photo = await createUploadedPhotoAsset({
    tenantId: context.tenantId,
    projectId,
    userId: context.ownerUserId,
    client: context.ownerClient,
  });

  const baselineRequest = await createBaselineConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
    consentTemplateId: templateId,
    idempotencyKey: `feature057-replay-${randomUUID()}`,
  });
  const baselineToken = baselineRequest.payload.request.consentPath.split("/").pop() ?? "";
  await submitRecurringProfileConsent({
    supabase: anonClient,
    token: baselineToken,
    fullName: "Jordan Miles",
    email: `feature057-replay-${randomUUID()}@example.com`,
    faceMatchOptIn: true,
    structuredFieldValues: {
      scope: ["photos"],
      duration: "one_year",
    },
    captureIp: "127.0.0.1",
    captureUserAgent: "feature057-replay",
  });

  const readyHeadshot = await createReadyRecurringHeadshot({
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
    supabase: context.ownerClient,
  });
  const participant = await addProjectProfileParticipant({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    projectId,
    recurringProfileId: profileId,
  });

  const reconcileJobs = await listReconcileJobs(context.tenantId, projectId);
  assert.equal(reconcileJobs.length, 1);

  await runWorkerUntil({
    workerIdPrefix: "feature057-replay-worker",
    batchSize: 10,
    maxRuns: 20,
    predicate: async () => {
      const continuations = await listRecurringFanoutContinuations(context.tenantId, projectId);
      if (continuations.length > 0) {
        return true;
      }

      const compareRows = await listRecurringCompareRows(context.tenantId, projectId, photo.assetId);
      return compareRows.length > 0;
    },
  });

  const continuations = await listRecurringFanoutContinuations(context.tenantId, projectId);
  if (continuations.length > 0) {
    assert.equal(continuations[0]?.status, "queued");
    assert.equal(continuations[0]?.source_project_profile_participant_id, participant.payload.participant.id);
    assert.equal(continuations[0]?.source_profile_id, profileId);
    assert.equal(continuations[0]?.source_headshot_id, readyHeadshot.headshotId);
    assert.equal(continuations[0]?.source_selection_face_id, readyHeadshot.faceId);
    assert.equal(continuations[0]?.source_materialization_id, readyHeadshot.materializationId);
    assert.equal(continuations[0]?.boundary_asset_id, photo.assetId);
  } else {
    const compareRows = await listRecurringCompareRows(context.tenantId, projectId, photo.assetId);
    assert.equal(compareRows.length, 1);
    assert.equal(compareRows[0]?.project_profile_participant_id, participant.payload.participant.id);
    assert.equal(compareRows[0]?.profile_id, profileId);
    assert.equal(compareRows[0]?.recurring_headshot_id, readyHeadshot.headshotId);
    assert.equal(compareRows[0]?.recurring_headshot_materialization_id, readyHeadshot.materializationId);
    assert.equal(compareRows[0]?.recurring_selection_face_id, readyHeadshot.faceId);
  }
});

test("recurring materialized compare jobs persist project-profile evidence without creating consent ownership rows", async () => {
  const context = await createTenantContext();
  const projectId = await createProject(context.tenantId, context.ownerUserId, context.ownerClient);
  const profileId = await createProfile(context.tenantId, context.ownerUserId, context.ownerClient);
  const templateId = await createPublishedTemplate(context.tenantId, context.ownerUserId, context.ownerClient);
  const anonClient = createAnonClient();
  const photo = await createUploadedPhotoAsset({
    tenantId: context.tenantId,
    projectId,
    userId: context.ownerUserId,
    client: context.ownerClient,
  });
  const photoMaterialization = await createPhotoMaterialization({
    tenantId: context.tenantId,
    projectId,
    assetId: photo.assetId,
  });

  const baselineRequest = await createBaselineConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
    consentTemplateId: templateId,
    idempotencyKey: `feature057-compare-${randomUUID()}`,
  });
  const baselineToken = baselineRequest.payload.request.consentPath.split("/").pop() ?? "";
  await submitRecurringProfileConsent({
    supabase: anonClient,
    token: baselineToken,
    fullName: "Jordan Miles",
    email: `feature057-compare-${randomUUID()}@example.com`,
    faceMatchOptIn: true,
    structuredFieldValues: {
      scope: ["photos"],
      duration: "one_year",
    },
    captureIp: "127.0.0.1",
    captureUserAgent: "feature057-compare",
  });

  const readyHeadshot = await createReadyRecurringHeadshot({
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
    supabase: context.ownerClient,
  });
  const participant = await addProjectProfileParticipant({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    projectId,
    recurringProfileId: profileId,
  });

  const { error: deleteReplayJobsError } = await adminClient
    .from("face_match_jobs")
    .delete()
    .eq("tenant_id", context.tenantId)
    .eq("project_id", projectId);
  assertNoPostgrestError(deleteReplayJobsError, "delete recurring replay jobs");

  await enqueueCompareRecurringProfileMaterializedPairJob({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
    projectProfileParticipantId: participant.payload.participant.id,
    profileId,
    recurringHeadshotId: readyHeadshot.headshotId,
    recurringHeadshotMaterializationId: readyHeadshot.materializationId,
    recurringSelectionFaceId: readyHeadshot.faceId,
    assetId: photo.assetId,
    assetMaterializationId: photoMaterialization.materializationId,
    compareVersion: "feature057",
  });

  const matcher = {
    version: "feature057-matcher",
    async match() {
      return [];
    },
    async compareEmbeddings(input: { sourceEmbedding: number[]; targetEmbeddings: number[][] }) {
      assert.deepEqual(input.sourceEmbedding, [0.1, 0.2, 0.3]);
      assert.equal(input.targetEmbeddings.length, 1);
      return {
        targetSimilarities: [0.97],
        providerMetadata: {
          provider: "feature057-matcher",
          providerMode: "verification_embeddings",
          providerPluginVersions: null,
        },
      };
    },
  };

  await runWorkerUntil({
    workerIdPrefix: "feature057-compare-worker",
    batchSize: 10,
    matcher,
    predicate: async () => {
      const rows = await listRecurringCompareRows(context.tenantId, projectId, photo.assetId);
      return rows.length > 0;
    },
  });

  const compareRows = await listRecurringCompareRows(context.tenantId, projectId, photo.assetId);
  assert.equal(compareRows.length, 1);
  assert.equal(compareRows[0]?.project_profile_participant_id, participant.payload.participant.id);
  assert.equal(compareRows[0]?.profile_id, profileId);
  assert.equal(compareRows[0]?.recurring_headshot_id, readyHeadshot.headshotId);
  assert.equal(compareRows[0]?.recurring_headshot_materialization_id, readyHeadshot.materializationId);
  assert.equal(compareRows[0]?.recurring_selection_face_id, readyHeadshot.faceId);
  assert.equal(compareRows[0]?.asset_materialization_id, photoMaterialization.materializationId);
  assert.equal(compareRows[0]?.winning_asset_face_id, photoMaterialization.faceId);
  assert.equal(compareRows[0]?.compare_status, "matched");

  const scoreRows = await listRecurringCompareScoreRows(context.tenantId, projectId, photo.assetId);
  assert.equal(scoreRows.length, 1);
  assert.equal(scoreRows[0]?.project_profile_participant_id, participant.payload.participant.id);
  assert.equal(scoreRows[0]?.asset_face_id, photoMaterialization.faceId);

  const { data: consentLinks, error: consentLinksError } = await adminClient
    .from("asset_face_consent_links")
    .select("asset_face_id, consent_id")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", projectId)
    .eq("asset_id", photo.assetId);
  assertNoPostgrestError(consentLinksError, "select consent links");
  assert.equal(consentLinks?.length ?? 0, 0);

  const { data: consentCandidates, error: consentCandidatesError } = await adminClient
    .from("asset_consent_match_candidates")
    .select("asset_id")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", projectId)
    .eq("asset_id", photo.assetId);
  assertNoPostgrestError(consentCandidatesError, "select consent candidates");
  assert.equal(consentCandidates?.length ?? 0, 0);
});
