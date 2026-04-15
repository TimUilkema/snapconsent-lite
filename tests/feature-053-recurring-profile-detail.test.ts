import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getRecurringProfileDetailPanelData } from "../src/lib/profiles/profile-directory-service";
import { createBaselineConsentRequest } from "../src/lib/profiles/profile-consent-service";
import {
  submitRecurringProfileConsent,
} from "../src/lib/recurring-consent/public-recurring-consent";
import { revokeRecurringProfileConsentByToken } from "../src/lib/recurring-consent/revoke-recurring-profile-consent";
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
  const owner = await createAuthUserWithRetry(supabase, "feature053-owner");
  const photographer = await createAuthUserWithRetry(supabase, "feature053-photographer");
  const ownerClient = await signInClient(owner.email, owner.password);
  const photographerClient = await signInClient(photographer.email, photographer.password);

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert({
      name: `Feature 053 Tenant ${randomUUID()}`,
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
    {
      optionKey: "social",
      label: "Social",
      orderIndex: 1,
    },
  ];

  const formLayoutDefinition = createStarterFormLayoutDefinition(structuredFieldsDefinition);
  const { data, error } = await client
    .from("consent_templates")
    .insert({
      tenant_id: tenantId,
      template_key: `feature053-template-${randomUUID()}`,
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

test("recurring profile detail data returns current summary, request history, consent history, and structured snapshot labels", async () => {
  const context = await createTenantContext(adminClient);
  const anonClient = createAnonClient();
  const profileId = await createProfile(context.tenantId, context.ownerUserId, context.ownerClient, {
    fullName: "Jordan Miles",
    email: "jordan@example.com",
  });
  const templateId = await createPublishedTemplate(context.tenantId, context.ownerUserId, context.ownerClient);

  const signedRequest = await createBaselineConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
    consentTemplateId: templateId,
    idempotencyKey: `feature053-signed-${randomUUID()}`,
  });
  const signedToken = signedRequest.payload.request.consentPath.split("/").pop() ?? "";
  const signedConsent = await submitRecurringProfileConsent({
    supabase: anonClient,
    token: signedToken,
    fullName: "Jordan Miles",
    email: "jordan@example.com",
    structuredFieldValues: {
      scope: ["photos", "social"],
      duration: "one_year",
    },
    captureIp: "127.0.0.1",
    captureUserAgent: "feature053-test",
  });
  await revokeRecurringProfileConsentByToken(anonClient, signedConsent.revokeToken ?? "", "No longer needed");

  const cancelledRequest = await createBaselineConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
    consentTemplateId: templateId,
    idempotencyKey: `feature053-cancelled-${randomUUID()}`,
  });
  const { error: cancelError } = await context.ownerClient.rpc("cancel_recurring_profile_baseline_request", {
    p_profile_id: profileId,
    p_request_id: cancelledRequest.payload.request.id,
  });
  assertNoPostgrestError(cancelError, "cancel recurring baseline request");

  const pendingRequest = await createBaselineConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
    consentTemplateId: templateId,
    idempotencyKey: `feature053-pending-${randomUUID()}`,
  });

  const detail = await getRecurringProfileDetailPanelData({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
  });

  assert.equal(detail.profile.id, profileId);
  assert.equal(detail.baselineConsent.state, "pending");
  assert.equal(detail.baselineConsent.pendingRequest?.id, pendingRequest.payload.request.id);
  assert.equal(detail.baselineConsent.pendingRequest?.templateName, "Baseline Consent");
  assert.equal(detail.baselineConsent.activeConsent, null);
  assert.ok(detail.baselineConsent.latestRevokedConsent);
  assert.equal(detail.baselineConsent.latestRevokedConsent?.emailSnapshot, "jordan@example.com");
  assert.equal(detail.baselineConsent.latestRevokedConsent?.templateVersion, "v1");
  assert.deepEqual(detail.baselineConsent.latestRevokedConsent?.structuredSummary?.scopeLabels, [
    "Photos",
    "Social",
  ]);
  assert.equal(detail.baselineConsent.latestRevokedConsent?.structuredSummary?.durationLabel, "1 year");

  assert.equal(detail.requestHistory.length, 3);
  assert.deepEqual(
    detail.requestHistory.map((request) => request.status),
    ["pending", "cancelled", "signed"],
  );
  assert.equal(detail.requestHistory[0]?.id, pendingRequest.payload.request.id);
  assert.equal(detail.requestHistory[2]?.templateName, "Baseline Consent");

  assert.equal(detail.consentHistory.length, 1);
  assert.equal(detail.consentHistory[0]?.requestId, signedRequest.payload.request.id);
  assert.ok(detail.consentHistory[0]?.revokedAt);
  assert.deepEqual(detail.consentHistory[0]?.structuredSummary?.scopeLabels, ["Photos", "Social"]);

  assert.equal(detail.actions.canManageBaseline, true);
  assert.equal(detail.actions.canRequestBaselineConsent, false);
  assert.equal(detail.actions.canCancelPendingRequest, true);
  assert.equal(detail.actions.canReplacePendingRequest, true);
});

test("recurring profile detail data allows read-only inspection but disables actions for photographers and archived profiles", async () => {
  const context = await createTenantContext(adminClient);
  const profileId = await createProfile(context.tenantId, context.ownerUserId, context.ownerClient, {
    fullName: "Alex Rivera",
    email: "alex@example.com",
  });

  const { error: archiveError } = await context.ownerClient
    .from("recurring_profiles")
    .update({
      status: "archived",
    })
    .eq("tenant_id", context.tenantId)
    .eq("id", profileId);
  assertNoPostgrestError(archiveError, "archive recurring profile");

  const ownerDetail = await getRecurringProfileDetailPanelData({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
  });
  assert.equal(ownerDetail.profile.status, "archived");
  assert.equal(ownerDetail.actions.canManageBaseline, false);
  assert.equal(ownerDetail.actions.canRequestBaselineConsent, false);

  const photographerDetail = await getRecurringProfileDetailPanelData({
    supabase: context.photographerClient,
    tenantId: context.tenantId,
    userId: context.photographerUserId,
    profileId,
  });
  assert.equal(photographerDetail.access.canManageProfiles, false);
  assert.equal(photographerDetail.actions.canManageBaseline, false);
  assert.equal(photographerDetail.requestHistory.length, 0);
  assert.equal(photographerDetail.consentHistory.length, 0);
});

test("recurring profile detail data exposes recurring headshot readiness when baseline matching opt-in is active", async () => {
  const context = await createTenantContext(adminClient);
  const anonClient = createAnonClient();
  const profileId = await createProfile(context.tenantId, context.ownerUserId, context.ownerClient, {
    fullName: "Sam Carter",
    email: "sam@example.com",
  });
  const templateId = await createPublishedTemplate(context.tenantId, context.ownerUserId, context.ownerClient);

  const request = await createBaselineConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
    consentTemplateId: templateId,
    idempotencyKey: `feature053-headshot-${randomUUID()}`,
  });
  const token = request.payload.request.consentPath.split("/").pop() ?? "";

  await submitRecurringProfileConsent({
    supabase: anonClient,
    token,
    fullName: "Sam Carter",
    email: "sam@example.com",
    structuredFieldValues: {
      scope: ["photos"],
      duration: "one_year",
    },
    faceMatchOptIn: true,
    captureIp: "127.0.0.1",
    captureUserAgent: "feature053-headshot-test",
  });

  const detail = await getRecurringProfileDetailPanelData({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
  });

  assert.equal(detail.baselineConsent.state, "signed");
  assert.equal(detail.headshotMatching.readiness.state, "missing_headshot");
  assert.equal(detail.headshotMatching.actions.canManage, true);
  assert.equal(detail.headshotMatching.actions.canUpload, true);
  assert.equal(detail.headshotMatching.previewUrl, null);
});
