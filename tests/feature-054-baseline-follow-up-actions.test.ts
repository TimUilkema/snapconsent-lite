import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "../src/lib/http/errors";
import { createBaselineConsentRequest } from "../src/lib/profiles/profile-consent-service";
import { getRecurringProfileDetailPanelData } from "../src/lib/profiles/profile-directory-service";
import { sendBaselineFollowUp } from "../src/lib/profiles/profile-follow-up-service";
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

type TenantContext = {
  tenantId: string;
  ownerUserId: string;
  photographerUserId: string;
  ownerClient: SupabaseClient;
  photographerClient: SupabaseClient;
};

async function createTenantContext(supabase: SupabaseClient): Promise<TenantContext> {
  const owner = await createAuthUserWithRetry(supabase, "feature054-owner");
  const photographer = await createAuthUserWithRetry(supabase, "feature054-photographer");
  const ownerClient = await signInClient(owner.email, owner.password);
  const photographerClient = await signInClient(photographer.email, photographer.password);

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert({
      name: `Feature 054 Tenant ${randomUUID()}`,
    })
    .select("id")
    .single();
  assertNoPostgrestError(tenantError, "insert tenant");

  const { error: membershipError } = await supabase.from("memberships").insert([
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
  assertNoPostgrestError(membershipError, "insert memberships");

  return {
    tenantId: tenant.id,
    ownerUserId: owner.userId,
    photographerUserId: photographer.userId,
    ownerClient,
    photographerClient,
  };
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
      template_key: `feature054-template-${randomUUID()}`,
      name: "Baseline Consent",
      description: null,
      version: "v1",
      version_number: 1,
      status: "published",
      body: "I consent to the baseline recurring processing described here.",
      structured_fields_definition: structuredFieldsDefinition,
      form_layout_definition: formLayoutDefinition,
      created_by: userId,
    })
    .select("id")
    .single();

  assertNoPostgrestError(error, "insert published template");
  return data.id as string;
}

async function createProfile(
  tenantId: string,
  userId: string,
  client: SupabaseClient,
  overrides?: { fullName?: string; email?: string },
) {
  const { data, error } = await client
    .from("recurring_profiles")
    .insert({
      tenant_id: tenantId,
      full_name: overrides?.fullName ?? "Jordan Miles",
      email: overrides?.email ?? "jordan@example.com",
      status: "active",
      created_by: userId,
    })
    .select("id")
    .single();

  assertNoPostgrestError(error, "insert recurring profile");
  return data.id as string;
}

test("follow-up reuses an active pending request as a reminder and records one placeholder attempt idempotently", async () => {
  const context = await createTenantContext(adminClient);
  const profileId = await createProfile(context.tenantId, context.ownerUserId, context.ownerClient);
  const templateId = await createPublishedTemplate(context.tenantId, context.ownerUserId, context.ownerClient);
  const created = await createBaselineConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
    consentTemplateId: templateId,
    idempotencyKey: `feature054-reminder-create-${randomUUID()}`,
  });
  const followUpIdempotencyKey = `feature054-reminder-${randomUUID()}`;

  const reminder = await sendBaselineFollowUp({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
    idempotencyKey: followUpIdempotencyKey,
  });

  assert.equal(reminder.status, 200);
  assert.equal(reminder.payload.followUp.action, "reminder");
  assert.equal(reminder.payload.followUp.request.id, created.payload.request.id);
  assert.equal(reminder.payload.followUp.request.emailSnapshot, "jordan@example.com");
  assert.equal(reminder.payload.followUp.deliveryMode, "placeholder");
  assert.equal(reminder.payload.followUp.deliveryStatus, "recorded");

  const replayed = await sendBaselineFollowUp({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
    idempotencyKey: followUpIdempotencyKey,
  });
  assert.equal(replayed.status, 200);
  assert.equal(replayed.payload.followUp.deliveryAttempt.id, reminder.payload.followUp.deliveryAttempt.id);

  const { data: attemptRows, error: attemptRowsError } = await context.ownerClient
    .from("recurring_profile_consent_request_delivery_attempts")
    .select("id, action_kind, request_id, target_email")
    .eq("tenant_id", context.tenantId)
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false });
  assertNoPostgrestError(attemptRowsError, "select follow-up attempts");
  assert.equal(attemptRows?.length, 1);
  assert.equal(attemptRows?.[0]?.action_kind, "reminder");
  assert.equal(attemptRows?.[0]?.request_id, created.payload.request.id);
  assert.equal(attemptRows?.[0]?.target_email, "jordan@example.com");

  const detail = await getRecurringProfileDetailPanelData({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
  });
  assert.equal(detail.actions.availableBaselineFollowUpAction, "reminder");
  assert.equal(detail.baselineConsent.latestFollowUpAttempt?.actionKind, "reminder");
  assert.equal(detail.baselineConsent.latestFollowUpAttempt?.requestId, created.payload.request.id);
});

test("follow-up creates a new request when the latest pending request has expired and records a new_request attempt", async () => {
  const context = await createTenantContext(adminClient);
  const profileId = await createProfile(context.tenantId, context.ownerUserId, context.ownerClient, {
    fullName: "Riley Harper",
    email: "riley@example.com",
  });
  const templateId = await createPublishedTemplate(context.tenantId, context.ownerUserId, context.ownerClient);
  const created = await createBaselineConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
    consentTemplateId: templateId,
    idempotencyKey: `feature054-expired-create-${randomUUID()}`,
  });

  const expiredAt = new Date(Date.now() - 60_000).toISOString();
  const { error: expireError } = await adminClient
    .from("recurring_profile_consent_requests")
    .update({
      expires_at: expiredAt,
    })
    .eq("tenant_id", context.tenantId)
    .eq("id", created.payload.request.id);
  assertNoPostgrestError(expireError, "expire pending request");

  const followUp = await sendBaselineFollowUp({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
    idempotencyKey: `feature054-new-request-${randomUUID()}`,
  });

  assert.equal(followUp.status, 201);
  assert.equal(followUp.payload.followUp.action, "new_request");
  assert.notEqual(followUp.payload.followUp.request.id, created.payload.request.id);
  assert.equal(followUp.payload.followUp.deliveryAttempt.actionKind, "new_request");

  const { data: requestRows, error: requestRowsError } = await context.ownerClient
    .from("recurring_profile_consent_requests")
    .select("id, status")
    .eq("tenant_id", context.tenantId)
    .eq("profile_id", profileId)
    .order("created_at", { ascending: true });
  assertNoPostgrestError(requestRowsError, "select request rows after follow-up");
  assert.equal(requestRows?.length, 2);
  assert.equal(requestRows?.[0]?.id, created.payload.request.id);
  assert.equal(requestRows?.[0]?.status, "expired");
  assert.equal(requestRows?.[1]?.id, followUp.payload.followUp.request.id);
  assert.equal(requestRows?.[1]?.status, "pending");

  const detail = await getRecurringProfileDetailPanelData({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
  });
  assert.equal(detail.baselineConsent.state, "pending");
  assert.equal(detail.actions.availableBaselineFollowUpAction, "reminder");
  assert.equal(detail.baselineConsent.latestFollowUpAttempt?.actionKind, "new_request");
  assert.equal(detail.baselineConsent.latestFollowUpAttempt?.requestId, followUp.payload.followUp.request.id);
});

test("follow-up is blocked when the profile already has an active signed baseline consent", async () => {
  const context = await createTenantContext(adminClient);
  const anonClient = createAnonClient();
  const profileId = await createProfile(context.tenantId, context.ownerUserId, context.ownerClient, {
    fullName: "Alex Rivera",
    email: "alex@example.com",
  });
  const templateId = await createPublishedTemplate(context.tenantId, context.ownerUserId, context.ownerClient);
  const created = await createBaselineConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
    consentTemplateId: templateId,
    idempotencyKey: `feature054-signed-create-${randomUUID()}`,
  });
  const token = created.payload.request.consentPath.split("/").pop() ?? "";

  await submitRecurringProfileConsent({
    supabase: anonClient,
    token,
    fullName: "Alex Rivera",
    email: "alex@example.com",
    structuredFieldValues: {
      scope: ["photos"],
      duration: "one_year",
    },
    captureIp: "127.0.0.1",
    captureUserAgent: "feature054-test",
  });

  await assert.rejects(
    sendBaselineFollowUp({
      supabase: context.ownerClient,
      tenantId: context.tenantId,
      userId: context.ownerUserId,
      profileId,
      idempotencyKey: `feature054-signed-follow-up-${randomUUID()}`,
    }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 409);
      assert.equal(error.code, "baseline_consent_already_signed");
      return true;
    },
  );
});
