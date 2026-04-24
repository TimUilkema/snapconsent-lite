import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "../src/lib/http/errors";
import { listRecurringProfilesPageData } from "../src/lib/profiles/profile-directory-service";
import { createBaselineConsentRequest } from "../src/lib/profiles/profile-consent-service";
import {
  getPublicRecurringConsentRequest,
  submitRecurringProfileConsent,
} from "../src/lib/recurring-consent/public-recurring-consent";
import {
  getPublicRecurringRevokeToken,
  revokeRecurringProfileConsentByToken,
} from "../src/lib/recurring-consent/revoke-recurring-profile-consent";
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
  const owner = await createAuthUserWithRetry(supabase, "feature051-owner");
  const photographer = await createAuthUserWithRetry(supabase, "feature051-photographer");
  const ownerClient = await signInClient(owner.email, owner.password);
  const photographerClient = await signInClient(photographer.email, photographer.password);

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert({
      name: `Feature 051 Tenant ${randomUUID()}`,
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
      template_key: `feature051-template-${randomUUID()}`,
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

async function signBaselineConsentForProfile(
  context: TenantContext,
  anonClient: SupabaseClient,
  profileId: string,
  templateId: string,
) {
  const { data: profile, error: profileError } = await context.ownerClient
    .from("recurring_profiles")
    .select("full_name, email")
    .eq("tenant_id", context.tenantId)
    .eq("id", profileId)
    .single();
  assertNoPostgrestError(profileError, "select recurring profile for baseline sign");

  const created = await createBaselineConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
    consentTemplateId: templateId,
    idempotencyKey: `feature051-sign-profile-${randomUUID()}`,
  });
  const token = created.payload.request.consentPath.split("/").pop() ?? "";

  return submitRecurringProfileConsent({
    supabase: anonClient,
    token,
    fullName: profile.full_name,
    email: profile.email,
    structuredFieldValues: {
      scope: ["photos"],
      duration: "one_year",
    },
    captureIp: "127.0.0.1",
    captureUserAgent: "feature051-test",
  });
}

test("baseline recurring consent request service creates, replays idempotently, and cancels on profile archive", async () => {
  const context = await createTenantContext(adminClient);
  const profileId = await createProfile(context.tenantId, context.ownerUserId, context.ownerClient);
  const templateId = await createPublishedTemplate(context.tenantId, context.ownerUserId, context.ownerClient);
  const idempotencyKey = `feature051-request-${randomUUID()}`;

  const created = await createBaselineConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
    consentTemplateId: templateId,
    idempotencyKey,
  });

  assert.equal(created.status, 201);
  assert.equal(created.payload.request.profileId, profileId);
  assert.equal(created.payload.request.consentTemplateId, templateId);
  assert.equal(created.payload.request.status, "pending");
  assert.match(created.payload.request.consentPath, /^\/rp\/[a-f0-9]{64}$/);

  const replayed = await createBaselineConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
    consentTemplateId: templateId,
    idempotencyKey,
  });

  assert.equal(replayed.status, 200);
  assert.equal(replayed.payload.request.id, created.payload.request.id);
  assert.equal(replayed.payload.request.consentPath, created.payload.request.consentPath);

  const { data: requestRow, error: requestError } = await context.ownerClient
    .from("recurring_profile_consent_requests")
    .select("id, status, profile_name_snapshot, profile_email_snapshot")
    .eq("tenant_id", context.tenantId)
    .eq("id", created.payload.request.id)
    .single();
  assertNoPostgrestError(requestError, "select recurring profile consent request");
  assert.equal(requestRow.status, "pending");
  assert.equal(requestRow.profile_name_snapshot, "Jordan Miles");
  assert.equal(requestRow.profile_email_snapshot, "jordan@example.com");

  const { error: archiveError } = await context.ownerClient
    .from("recurring_profiles")
    .update({
      status: "archived",
    })
    .eq("tenant_id", context.tenantId)
    .eq("id", profileId);
  assertNoPostgrestError(archiveError, "archive recurring profile");

  const { data: cancelledRequest, error: cancelledRequestError } = await context.ownerClient
    .from("recurring_profile_consent_requests")
    .select("status")
    .eq("tenant_id", context.tenantId)
    .eq("id", created.payload.request.id)
    .single();
  assertNoPostgrestError(cancelledRequestError, "select cancelled recurring profile consent request");
  assert.equal(cancelledRequest.status, "cancelled");
});

test("photographer cannot create baseline recurring consent requests", async () => {
  const context = await createTenantContext(adminClient);
  const profileId = await createProfile(context.tenantId, context.ownerUserId, context.ownerClient);
  const templateId = await createPublishedTemplate(context.tenantId, context.ownerUserId, context.ownerClient);

  await assert.rejects(
    createBaselineConsentRequest({
      supabase: context.photographerClient,
      tenantId: context.tenantId,
      userId: context.photographerUserId,
      profileId,
      consentTemplateId: templateId,
      idempotencyKey: `feature051-photographer-${randomUUID()}`,
    }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 403);
      assert.equal(error.code, "recurring_profile_management_forbidden");
      return true;
    },
  );
});

test("public recurring consent request lookup and submit create an immutable signed record and handle duplicates", async () => {
  const context = await createTenantContext(adminClient);
  const anonClient = createAnonClient();
  const profileId = await createProfile(context.tenantId, context.ownerUserId, context.ownerClient);
  const templateId = await createPublishedTemplate(context.tenantId, context.ownerUserId, context.ownerClient);
  const created = await createBaselineConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
    consentTemplateId: templateId,
    idempotencyKey: `feature051-sign-${randomUUID()}`,
  });
  const token = created.payload.request.consentPath.split("/").pop() ?? "";

  const publicRequest = await getPublicRecurringConsentRequest(anonClient, token);
  assert.ok(publicRequest);
  assert.equal(publicRequest.profileName, "Jordan Miles");
  assert.equal(publicRequest.profileEmail, "jordan@example.com");
  assert.equal(publicRequest.requestStatus, "pending");
  assert.equal(publicRequest.canSign, true);
  assert.ok(
    publicRequest.formLayoutDefinition.blocks.some(
      (block) => block.kind === "system" && block.key === "face_match_section",
    ),
  );

  const signed = await submitRecurringProfileConsent({
    supabase: anonClient,
    token,
    fullName: "Jordan Miles",
    email: "jordan@example.com",
    structuredFieldValues: {
      scope: ["photos"],
      duration: "one_year",
    },
    captureIp: "127.0.0.1",
    captureUserAgent: "feature051-test",
  });

  assert.equal(signed.duplicate, false);
  assert.ok(signed.revokeToken);

  const duplicate = await submitRecurringProfileConsent({
    supabase: anonClient,
    token,
    fullName: "Jordan Miles",
    email: "jordan@example.com",
    structuredFieldValues: {
      scope: ["photos"],
      duration: "one_year",
    },
    captureIp: "127.0.0.1",
    captureUserAgent: "feature051-test",
  });

  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.consentId, signed.consentId);

  const { data: signedRow, error: signedRowError } = await context.ownerClient
    .from("recurring_profile_consents")
    .select("request_id, consent_text, consent_version, structured_fields_snapshot, revoked_at")
    .eq("tenant_id", context.tenantId)
    .eq("id", signed.consentId)
    .single();
  assertNoPostgrestError(signedRowError, "select recurring profile consent");
  assert.equal(signedRow.request_id, created.payload.request.id);
  assert.equal(signedRow.revoked_at, null);
  assert.equal(signedRow.structured_fields_snapshot.values.scope.selectedOptionKeys[0], "photos");
  assert.equal(signedRow.structured_fields_snapshot.values.duration.selectedOptionKey, "one_year");

  const { data: signedRequest, error: signedRequestError } = await context.ownerClient
    .from("recurring_profile_consent_requests")
    .select("status")
    .eq("tenant_id", context.tenantId)
    .eq("id", created.payload.request.id)
    .single();
  assertNoPostgrestError(signedRequestError, "select signed recurring request");
  assert.equal(signedRequest.status, "signed");
});

test("public recurring revoke lookup and submit revoke the signed recurring consent idempotently", async () => {
  const context = await createTenantContext(adminClient);
  const anonClient = createAnonClient();
  const profileId = await createProfile(context.tenantId, context.ownerUserId, context.ownerClient);
  const templateId = await createPublishedTemplate(context.tenantId, context.ownerUserId, context.ownerClient);
  const created = await createBaselineConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
    consentTemplateId: templateId,
    idempotencyKey: `feature051-revoke-${randomUUID()}`,
  });
  const token = created.payload.request.consentPath.split("/").pop() ?? "";
  const signed = await submitRecurringProfileConsent({
    supabase: anonClient,
    token,
    fullName: "Jordan Miles",
    email: "jordan@example.com",
    structuredFieldValues: {
      scope: ["photos"],
      duration: "one_year",
    },
    captureIp: "127.0.0.1",
    captureUserAgent: "feature051-test",
  });

  assert.ok(signed.revokeToken);

  const revokeContext = await getPublicRecurringRevokeToken(anonClient, signed.revokeToken ?? "");
  assert.ok(revokeContext);
  assert.equal(revokeContext.status, "available");

  const revoked = await revokeRecurringProfileConsentByToken(
    anonClient,
    signed.revokeToken ?? "",
    "No longer needed",
  );
  assert.equal(revoked.revoked, true);
  assert.equal(revoked.alreadyRevoked, false);

  const duplicateRevoke = await revokeRecurringProfileConsentByToken(
    anonClient,
    signed.revokeToken ?? "",
    "Repeated",
  );
  assert.equal(duplicateRevoke.alreadyRevoked, true);

  const { data: revokedConsent, error: revokedConsentError } = await context.ownerClient
    .from("recurring_profile_consents")
    .select("revoked_at, revoke_reason")
    .eq("tenant_id", context.tenantId)
    .eq("id", signed.consentId)
    .single();
  assertNoPostgrestError(revokedConsentError, "select revoked recurring consent");
  assert.ok(revokedConsent.revoked_at);
  assert.equal(revokedConsent.revoke_reason, "No longer needed");
});

test("profiles page data derives missing, pending, signed, and revoked baseline states", async () => {
  const context = await createTenantContext(adminClient);
  const anonClient = createAnonClient();
  const templateId = await createPublishedTemplate(context.tenantId, context.ownerUserId, context.ownerClient);
  const missingProfileId = await createProfile(context.tenantId, context.ownerUserId, context.ownerClient, {
    fullName: "Missing Profile",
    email: "missing@example.com",
  });
  const pendingProfileId = await createProfile(context.tenantId, context.ownerUserId, context.ownerClient, {
    fullName: "Pending Profile",
    email: "pending@example.com",
  });
  const signedProfileId = await createProfile(context.tenantId, context.ownerUserId, context.ownerClient, {
    fullName: "Signed Profile",
    email: "signed@example.com",
  });
  const revokedProfileId = await createProfile(context.tenantId, context.ownerUserId, context.ownerClient, {
    fullName: "Revoked Profile",
    email: "revoked@example.com",
  });

  const pendingRequest = await createBaselineConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId: pendingProfileId,
    consentTemplateId: templateId,
    idempotencyKey: `feature051-pending-${randomUUID()}`,
  });
  await signBaselineConsentForProfile(context, anonClient, signedProfileId, templateId);
  const revokedSigned = await signBaselineConsentForProfile(context, anonClient, revokedProfileId, templateId);
  await revokeRecurringProfileConsentByToken(anonClient, revokedSigned.revokeToken ?? "", "No longer needed");

  const pageData = await listRecurringProfilesPageData({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    includeArchived: true,
  });

  const stateByProfileId = new Map(pageData.profiles.map((profile) => [profile.id, profile.baselineConsent]));
  assert.equal(stateByProfileId.get(missingProfileId)?.state, "missing");
  assert.equal(stateByProfileId.get(pendingProfileId)?.state, "pending");
  assert.equal(stateByProfileId.get(signedProfileId)?.state, "signed");
  assert.equal(stateByProfileId.get(revokedProfileId)?.state, "revoked");
  assert.equal(
    stateByProfileId.get(pendingProfileId)?.pendingRequest?.id,
    pendingRequest.payload.request.id,
  );
  assert.ok(stateByProfileId.get(pendingProfileId)?.pendingRequest?.consentPath.startsWith("/rp/"));
  assert.ok(pageData.baselineTemplates.some((template) => template.id === templateId));
});
