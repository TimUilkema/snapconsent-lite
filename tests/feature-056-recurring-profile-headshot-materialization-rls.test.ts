import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { getAutoMatchMaterializerVersion } from "../src/lib/matching/auto-match-config";
import {
  adminClient,
  assertNoPostgrestError,
  createAuthUserWithRetry,
  signInClient,
} from "./helpers/supabase-test-client";

async function createTenantContext() {
  const owner = await createAuthUserWithRetry(adminClient, "feature056-headshot-rls-owner");
  const ownerClient = await signInClient(owner.email, owner.password);

  const { data: tenant, error: tenantError } = await adminClient
    .from("tenants")
    .insert({
      name: `Feature 056 Headshot RLS ${randomUUID()}`,
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
    tenantId: tenant.id as string,
    ownerUserId: owner.userId,
    ownerClient,
  };
}

async function createProfile(input: {
  tenantId: string;
  userId: string;
  client: Awaited<ReturnType<typeof signInClient>>;
}) {
  const { data, error } = await input.client
    .from("recurring_profiles")
    .insert({
      tenant_id: input.tenantId,
      full_name: "Riley Headshot",
      email: `feature056-headshot-rls-${randomUUID()}@example.com`,
      status: "active",
      created_by: input.userId,
    })
    .select("id")
    .single();

  assertNoPostgrestError(error, "insert recurring profile");
  return data.id as string;
}

async function createUploadedHeadshot(input: {
  tenantId: string;
  profileId: string;
  userId: string;
  client: Awaited<ReturnType<typeof signInClient>>;
}) {
  const headshotId = randomUUID();
  const nowIso = new Date().toISOString();
  const { error } = await input.client.from("recurring_profile_headshots").insert({
    id: headshotId,
    tenant_id: input.tenantId,
    profile_id: input.profileId,
    storage_bucket: "recurring-profile-headshots",
    storage_path: `tenant/${input.tenantId}/profile/${input.profileId}/headshot/${headshotId}/portrait.jpg`,
    original_filename: "portrait.jpg",
    content_type: "image/jpeg",
    file_size_bytes: 2048,
    upload_status: "uploaded",
    uploaded_at: nowIso,
    materialization_status: "pending",
    selection_status: "pending_materialization",
    created_by: input.userId,
  });
  assertNoPostgrestError(error, "insert recurring headshot");
  return headshotId;
}

test("authenticated recurring-profile managers can persist recurring headshot materialization rows, faces, and repair jobs", async () => {
  const context = await createTenantContext();
  const profileId = await createProfile({
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    client: context.ownerClient,
  });
  const headshotId = await createUploadedHeadshot({
    tenantId: context.tenantId,
    profileId,
    userId: context.ownerUserId,
    client: context.ownerClient,
  });

  const materializedAt = new Date().toISOString();
  const { data: materialization, error: materializationError } = await context.ownerClient
    .from("recurring_profile_headshot_materializations")
    .insert({
      tenant_id: context.tenantId,
      headshot_id: headshotId,
      materialization_version: getAutoMatchMaterializerVersion(),
      provider: "test-provider",
      provider_mode: "detection",
      provider_plugin_versions: { detector: "test" },
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
  assertNoPostgrestError(materializationError, "insert recurring materialization");

  const { error: upsertMaterializationError } = await context.ownerClient
    .from("recurring_profile_headshot_materializations")
    .upsert(
      {
        tenant_id: context.tenantId,
        headshot_id: headshotId,
        materialization_version: getAutoMatchMaterializerVersion(),
        provider: "test-provider",
        provider_mode: "detection",
        provider_plugin_versions: { detector: "test-v2" },
        face_count: 2,
        usable_for_compare: true,
        unusable_reason: null,
        source_image_width: 1200,
        source_image_height: 1600,
        source_coordinate_space: "oriented_original",
        materialized_at: new Date(Date.now() + 1_000).toISOString(),
      },
      {
        onConflict: "tenant_id,headshot_id,materialization_version",
      },
    );
  assertNoPostgrestError(upsertMaterializationError, "upsert recurring materialization");

  const faceId = randomUUID();
  const { error: faceInsertError } = await context.ownerClient
    .from("recurring_profile_headshot_materialization_faces")
    .insert({
      id: faceId,
      tenant_id: context.tenantId,
      materialization_id: materialization.id,
      face_rank: 0,
      provider_face_index: 0,
      detection_probability: 0.99,
      face_box: {
        x_min: 10,
        y_min: 20,
        x_max: 210,
        y_max: 320,
        probability: 0.99,
      },
      face_box_normalized: {
        x_min: 0.01,
        y_min: 0.02,
        x_max: 0.21,
        y_max: 0.32,
        probability: 0.99,
      },
      embedding: [0.1, 0.2, 0.3],
    });
  assertNoPostgrestError(faceInsertError, "insert recurring materialization face");

  const { error: faceDeleteError } = await context.ownerClient
    .from("recurring_profile_headshot_materialization_faces")
    .delete()
    .eq("tenant_id", context.tenantId)
    .eq("materialization_id", materialization.id);
  assertNoPostgrestError(faceDeleteError, "delete recurring materialization faces");

  const { error: repairInsertError } = await context.ownerClient
    .from("recurring_profile_headshot_repair_jobs")
    .insert({
      tenant_id: context.tenantId,
      profile_id: profileId,
      headshot_id: headshotId,
      dedupe_key: `feature056-headshot-rls:${headshotId}`,
      status: "queued",
      attempt_count: 0,
      max_attempts: 5,
      run_after: new Date().toISOString(),
    });
  assertNoPostgrestError(repairInsertError, "insert recurring headshot repair job");

  const { data: repairJobs, error: repairSelectError } = await adminClient
    .from("recurring_profile_headshot_repair_jobs")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .eq("headshot_id", headshotId);
  assertNoPostgrestError(repairSelectError, "select recurring headshot repair jobs");
  assert.equal(repairJobs?.length ?? 0, 1);
});

test("activate_recurring_profile_headshot_upload rpc activates the pending headshot and supersedes the previous uploaded headshot", async () => {
  const context = await createTenantContext();
  const profileId = await createProfile({
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    client: context.ownerClient,
  });

  const previousHeadshotId = randomUUID();
  const pendingHeadshotId = randomUUID();
  const previousUploadedAt = new Date(Date.now() - 10_000).toISOString();

  const { error: previousHeadshotError } = await context.ownerClient.from("recurring_profile_headshots").insert({
    id: previousHeadshotId,
    tenant_id: context.tenantId,
    profile_id: profileId,
    storage_bucket: "recurring-profile-headshots",
    storage_path: `tenant/${context.tenantId}/profile/${profileId}/headshot/${previousHeadshotId}/previous.jpg`,
    original_filename: "previous.jpg",
    content_type: "image/jpeg",
    file_size_bytes: 1024,
    upload_status: "uploaded",
    uploaded_at: previousUploadedAt,
    materialization_status: "pending",
    selection_status: "pending_materialization",
    created_by: context.ownerUserId,
  });
  assertNoPostgrestError(previousHeadshotError, "insert previous uploaded headshot");

  const { error: pendingHeadshotError } = await context.ownerClient.from("recurring_profile_headshots").insert({
    id: pendingHeadshotId,
    tenant_id: context.tenantId,
    profile_id: profileId,
    storage_bucket: "recurring-profile-headshots",
    storage_path: `tenant/${context.tenantId}/profile/${profileId}/headshot/${pendingHeadshotId}/pending.jpg`,
    original_filename: "pending.jpg",
    content_type: "image/jpeg",
    file_size_bytes: 1024,
    upload_status: "pending",
    uploaded_at: null,
    materialization_status: "pending",
    selection_status: "pending_materialization",
    created_by: context.ownerUserId,
  });
  assertNoPostgrestError(pendingHeadshotError, "insert pending headshot");

  const { data: activationRows, error: activationError } = await context.ownerClient.rpc(
    "activate_recurring_profile_headshot_upload",
    {
      p_headshot_id: pendingHeadshotId,
    },
  );
  assertNoPostgrestError(activationError, "activate recurring headshot upload rpc");

  const activationRow = ((activationRows as Array<{
    headshot_id: string;
    tenant_id: string;
    profile_id: string;
    uploaded_at: string;
    superseded_headshot_id: string | null;
  }> | null) ?? [])[0] ?? null;
  assert.ok(activationRow);
  assert.equal(activationRow?.headshot_id, pendingHeadshotId);
  assert.equal(activationRow?.tenant_id, context.tenantId);
  assert.equal(activationRow?.profile_id, profileId);
  assert.equal(activationRow?.superseded_headshot_id, previousHeadshotId);
  assert.ok(activationRow?.uploaded_at);

  const { data: headshots, error: headshotsError } = await adminClient
    .from("recurring_profile_headshots")
    .select("id, upload_status, uploaded_at, superseded_at")
    .eq("tenant_id", context.tenantId)
    .eq("profile_id", profileId)
    .in("id", [previousHeadshotId, pendingHeadshotId]);
  assertNoPostgrestError(headshotsError, "select activated headshots");

  const previousHeadshot = headshots?.find((row) => row.id === previousHeadshotId) ?? null;
  const activatedHeadshot = headshots?.find((row) => row.id === pendingHeadshotId) ?? null;
  assert.equal(previousHeadshot?.upload_status, "uploaded");
  assert.ok(previousHeadshot?.superseded_at);
  assert.equal(activatedHeadshot?.upload_status, "uploaded");
  assert.equal(activatedHeadshot?.superseded_at, null);
  assert.ok(activatedHeadshot?.uploaded_at);
});
