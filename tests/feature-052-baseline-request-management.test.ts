import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "../src/lib/http/errors";
import { listRecurringProfilesPageData } from "../src/lib/profiles/profile-directory-service";
import {
  cancelBaselineConsentRequest,
  createBaselineConsentRequest,
  replaceBaselineConsentRequest,
} from "../src/lib/profiles/profile-consent-service";
import { getPublicRecurringConsentRequest } from "../src/lib/recurring-consent/public-recurring-consent";
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
  const owner = await createAuthUserWithRetry(supabase, "feature052-owner");
  const photographer = await createAuthUserWithRetry(supabase, "feature052-photographer");
  const ownerClient = await signInClient(owner.email, owner.password);
  const photographerClient = await signInClient(photographer.email, photographer.password);

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert({
      name: `Feature 052 Tenant ${randomUUID()}`,
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
      template_key: `feature052-template-${randomUUID()}`,
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

test("cancel baseline request is idempotent and makes the old token unavailable", async () => {
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
    idempotencyKey: `feature052-cancel-create-${randomUUID()}`,
  });
  const token = created.payload.request.consentPath.split("/").pop() ?? "";

  const cancelled = await cancelBaselineConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
    requestId: created.payload.request.id,
  });
  assert.equal(cancelled.status, 200);
  assert.equal(cancelled.payload.request.status, "cancelled");

  const replayed = await cancelBaselineConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
    requestId: created.payload.request.id,
  });
  assert.equal(replayed.status, 200);
  assert.equal(replayed.payload.request.id, created.payload.request.id);

  const { data: cancelledRow, error: cancelledRowError } = await context.ownerClient
    .from("recurring_profile_consent_requests")
    .select("status")
    .eq("tenant_id", context.tenantId)
    .eq("id", created.payload.request.id)
    .single();
  assertNoPostgrestError(cancelledRowError, "select cancelled request");
  assert.equal(cancelledRow.status, "cancelled");

  const publicRequest = await getPublicRecurringConsentRequest(anonClient, token);
  assert.ok(publicRequest);
  assert.equal(publicRequest.requestStatus, "cancelled");
  assert.equal(publicRequest.canSign, false);

  const pageData = await listRecurringProfilesPageData({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    includeArchived: true,
  });
  const cancelledProfile = pageData.profiles.find((profile) => profile.id === profileId);
  assert.equal(cancelledProfile?.baselineConsent.state, "missing");
  assert.equal(cancelledProfile?.baselineConsent.latestRequestOutcome?.status, "cancelled");
});

test("replace baseline request supersedes the old token, creates a new pending request, and replays idempotently", async () => {
  const context = await createTenantContext(adminClient);
  const anonClient = createAnonClient();
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
    idempotencyKey: `feature052-replace-create-${randomUUID()}`,
  });
  const oldToken = created.payload.request.consentPath.split("/").pop() ?? "";
  const replaceIdempotencyKey = `feature052-replace-${randomUUID()}`;

  const replaced = await replaceBaselineConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
    requestId: created.payload.request.id,
    idempotencyKey: replaceIdempotencyKey,
  });
  assert.equal(replaced.status, 201);
  assert.notEqual(replaced.payload.request.id, created.payload.request.id);
  assert.notEqual(replaced.payload.request.consentPath, created.payload.request.consentPath);
  assert.equal(replaced.payload.request.consentTemplateId, templateId);
  assert.equal(replaced.payload.request.emailSnapshot, "riley@example.com");
  assert.equal(replaced.payload.replacedRequest.id, created.payload.request.id);
  assert.equal(replaced.payload.replacedRequest.status, "superseded");
  assert.equal(replaced.payload.replacedRequest.supersededByRequestId, replaced.payload.request.id);

  const replayed = await replaceBaselineConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
    requestId: created.payload.request.id,
    idempotencyKey: replaceIdempotencyKey,
  });
  assert.equal(replayed.status, 200);
  assert.equal(replayed.payload.request.id, replaced.payload.request.id);
  assert.equal(replayed.payload.request.consentPath, replaced.payload.request.consentPath);

  const { data: replacedRows, error: replacedRowsError } = await context.ownerClient
    .from("recurring_profile_consent_requests")
    .select("id, status, consent_template_id, profile_email_snapshot, superseded_by_request_id")
    .eq("tenant_id", context.tenantId)
    .eq("profile_id", profileId)
    .order("created_at", { ascending: true });
  assertNoPostgrestError(replacedRowsError, "select replaced request rows");
  assert.equal(replacedRows?.length, 2);
  assert.equal(replacedRows?.[0]?.id, created.payload.request.id);
  assert.equal(replacedRows?.[0]?.status, "superseded");
  assert.equal(replacedRows?.[0]?.superseded_by_request_id, replaced.payload.request.id);
  assert.equal(replacedRows?.[1]?.id, replaced.payload.request.id);
  assert.equal(replacedRows?.[1]?.status, "pending");
  assert.equal(replacedRows?.[1]?.consent_template_id, templateId);
  assert.equal(replacedRows?.[1]?.profile_email_snapshot, "riley@example.com");

  const oldPublicRequest = await getPublicRecurringConsentRequest(anonClient, oldToken);
  assert.ok(oldPublicRequest);
  assert.equal(oldPublicRequest.requestStatus, "superseded");
  assert.equal(oldPublicRequest.canSign, false);

  const newToken = replaced.payload.request.consentPath.split("/").pop() ?? "";
  const newPublicRequest = await getPublicRecurringConsentRequest(anonClient, newToken);
  assert.ok(newPublicRequest);
  assert.equal(newPublicRequest.requestStatus, "pending");
  assert.equal(newPublicRequest.canSign, true);

  await assert.rejects(
    cancelBaselineConsentRequest({
      supabase: context.ownerClient,
      tenantId: context.tenantId,
      userId: context.ownerUserId,
      profileId,
      requestId: created.payload.request.id,
    }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 409);
      assert.equal(error.code, "baseline_consent_request_not_pending");
      return true;
    },
  );
});

test("profiles page data surfaces pending request metadata and latest cancelled, superseded, and expired outcomes", async () => {
  const context = await createTenantContext(adminClient);
  const templateId = await createPublishedTemplate(context.tenantId, context.ownerUserId, context.ownerClient);
  const pendingProfileId = await createProfile(context.tenantId, context.ownerUserId, context.ownerClient, {
    fullName: "Pending Profile",
    email: "pending@example.com",
  });
  const cancelledProfileId = await createProfile(context.tenantId, context.ownerUserId, context.ownerClient, {
    fullName: "Cancelled Profile",
    email: "cancelled@example.com",
  });
  const supersededProfileId = await createProfile(context.tenantId, context.ownerUserId, context.ownerClient, {
    fullName: "Superseded Profile",
    email: "superseded@example.com",
  });
  const expiredProfileId = await createProfile(context.tenantId, context.ownerUserId, context.ownerClient, {
    fullName: "Expired Profile",
    email: "expired@example.com",
  });

  const pendingRequest = await createBaselineConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId: pendingProfileId,
    consentTemplateId: templateId,
    idempotencyKey: `feature052-pending-${randomUUID()}`,
  });
  const cancelledRequest = await createBaselineConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId: cancelledProfileId,
    consentTemplateId: templateId,
    idempotencyKey: `feature052-cancelled-${randomUUID()}`,
  });
  const supersededRequest = await createBaselineConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId: supersededProfileId,
    consentTemplateId: templateId,
    idempotencyKey: `feature052-superseded-${randomUUID()}`,
  });
  const expiredRequest = await createBaselineConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId: expiredProfileId,
    consentTemplateId: templateId,
    idempotencyKey: `feature052-expired-${randomUUID()}`,
  });

  await cancelBaselineConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId: cancelledProfileId,
    requestId: cancelledRequest.payload.request.id,
  });

  const { error: supersededError } = await adminClient
    .from("recurring_profile_consent_requests")
    .update({
      status: "superseded",
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", context.tenantId)
    .eq("id", supersededRequest.payload.request.id);
  assertNoPostgrestError(supersededError, "update superseded request");

  const expiredAt = new Date(Date.now() - 60_000).toISOString();
  const { error: expiredError } = await adminClient
    .from("recurring_profile_consent_requests")
    .update({
      expires_at: expiredAt,
    })
    .eq("tenant_id", context.tenantId)
    .eq("id", expiredRequest.payload.request.id);
  assertNoPostgrestError(expiredError, "update expired request");

  const pageData = await listRecurringProfilesPageData({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    includeArchived: true,
  });
  const profilesById = new Map(pageData.profiles.map((profile) => [profile.id, profile]));

  assert.equal(profilesById.get(pendingProfileId)?.baselineConsent.state, "pending");
  assert.equal(
    profilesById.get(pendingProfileId)?.baselineConsent.pendingRequest?.id,
    pendingRequest.payload.request.id,
  );
  assert.equal(
    profilesById.get(pendingProfileId)?.baselineConsent.pendingRequest?.emailSnapshot,
    "pending@example.com",
  );

  assert.equal(profilesById.get(cancelledProfileId)?.baselineConsent.state, "missing");
  assert.equal(
    profilesById.get(cancelledProfileId)?.baselineConsent.latestRequestOutcome?.status,
    "cancelled",
  );

  assert.equal(profilesById.get(supersededProfileId)?.baselineConsent.state, "missing");
  assert.equal(
    profilesById.get(supersededProfileId)?.baselineConsent.latestRequestOutcome?.status,
    "superseded",
  );

  assert.equal(profilesById.get(expiredProfileId)?.baselineConsent.state, "missing");
  assert.equal(profilesById.get(expiredProfileId)?.baselineConsent.latestRequestOutcome?.status, "expired");
});
