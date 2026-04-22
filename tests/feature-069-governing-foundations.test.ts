import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createStarterFormLayoutDefinition } from "../src/lib/templates/form-layout";
import { createStarterStructuredFieldsDefinition } from "../src/lib/templates/structured-fields";
import { loadProjectRecurringConsentStateByParticipantIds } from "../src/lib/matching/project-face-assignees";
import { getProjectParticipantsPanelData } from "../src/lib/projects/project-participants-service";
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
};

async function createTenantContext(supabase: SupabaseClient): Promise<TenantContext> {
  const owner = await createAuthUserWithRetry(supabase, "feature069-owner");
  const ownerClient = await signInClient(owner.email, owner.password);

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert({
      name: `Feature 069 Tenant ${randomUUID()}`,
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
      name: `Feature 069 Project ${randomUUID()}`,
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
      email: `feature069-${randomUUID()}@example.com`,
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
      template_key: `feature069-template-${randomUUID()}`,
      name: "Project Participant Consent",
      description: null,
      version: "v1",
      version_number: 1,
      status: "published",
      body: "I consent to the project-specific processing described here.",
      structured_fields_definition: structuredFieldsDefinition,
      form_layout_definition: formLayoutDefinition,
      created_by: userId,
    })
    .select("id")
    .single();

  assertNoPostgrestError(error, "insert published template");
  return data.id as string;
}

test("recurring project participant state keeps active consent current while a replacement request is pending", async () => {
  const context = await createTenantContext(adminClient);
  const projectId = await createProject(context.tenantId, context.ownerUserId, context.ownerClient);
  const profileId = await createProfile(context.tenantId, context.ownerUserId, context.ownerClient);
  const templateId = await createPublishedTemplate(context.tenantId, context.ownerUserId, context.ownerClient);

  const { data: participant, error: participantError } = await context.ownerClient
    .from("project_profile_participants")
    .insert({
      tenant_id: context.tenantId,
      project_id: projectId,
      recurring_profile_id: profileId,
      created_by: context.ownerUserId,
    })
    .select("id")
    .single();
  assertNoPostgrestError(participantError, "insert project participant");

  const signedRequestId = randomUUID();
  const { error: signedRequestError } = await adminClient.from("recurring_profile_consent_requests").insert({
    id: signedRequestId,
    tenant_id: context.tenantId,
    profile_id: profileId,
    project_id: projectId,
    consent_kind: "project",
    consent_template_id: templateId,
    profile_name_snapshot: "Jordan Miles",
    profile_email_snapshot: `feature069-signed-${randomUUID()}@example.com`,
    token_hash: `feature069-signed-${randomUUID()}`,
    status: "signed",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    created_by: context.ownerUserId,
  });
  assertNoPostgrestError(signedRequestError, "insert signed project request");

  const { data: activeConsent, error: activeConsentError } = await adminClient
    .from("recurring_profile_consents")
    .insert({
      tenant_id: context.tenantId,
      profile_id: profileId,
      request_id: signedRequestId,
      project_id: projectId,
      consent_kind: "project",
      consent_template_id: templateId,
      profile_name_snapshot: "Jordan Miles",
      profile_email_snapshot: `feature069-active-${randomUUID()}@example.com`,
      consent_text: "Project participant consent text.",
      consent_version: "v1",
      structured_fields_snapshot: {
        schemaVersion: 1,
        templateSnapshot: {
          templateId,
          templateKey: `feature069-template-key-${randomUUID()}`,
          name: "Project Participant Consent",
          version: "v1",
          versionNumber: 1,
        },
        definition: createStarterStructuredFieldsDefinition(),
        values: {},
      },
      face_match_opt_in: true,
    })
    .select("id")
    .single();
  assertNoPostgrestError(activeConsentError, "insert active project consent");

  const pendingRequestId = randomUUID();
  const pendingExpiresAt = new Date(Date.now() + 86_400_000).toISOString();
  const { error: pendingRequestError } = await adminClient.from("recurring_profile_consent_requests").insert({
    id: pendingRequestId,
    tenant_id: context.tenantId,
    profile_id: profileId,
    project_id: projectId,
    consent_kind: "project",
    consent_template_id: templateId,
    profile_name_snapshot: "Jordan Miles",
    profile_email_snapshot: `feature069-pending-${randomUUID()}@example.com`,
    token_hash: `feature069-pending-${randomUUID()}`,
    status: "pending",
    expires_at: pendingExpiresAt,
    created_by: context.ownerUserId,
  });
  assertNoPostgrestError(pendingRequestError, "insert pending project request");

  const consentStateByParticipantId = await loadProjectRecurringConsentStateByParticipantIds({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
    participantIds: [participant.id],
  });

  const consentState = consentStateByParticipantId.get(participant.id);
  assert.equal(consentState?.state, "signed");
  assert.equal(consentState?.activeConsent?.id, activeConsent.id);
  assert.equal(consentState?.pendingRequest?.id, pendingRequestId);

  const panelData = await getProjectParticipantsPanelData({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
  });

  assert.equal(panelData.knownProfiles.length, 1);
  assert.equal(panelData.knownProfiles[0]?.projectConsent.state, "signed");
  assert.equal(panelData.knownProfiles[0]?.projectConsent.activeConsent?.id, activeConsent.id);
  assert.equal(panelData.knownProfiles[0]?.projectConsent.pendingRequest?.id, pendingRequestId);
  assert.equal(panelData.knownProfiles[0]?.actions.canCreateRequest, false);
});

test("recurring project participants with an active consent and no pending request can create an upgrade request", async () => {
  const context = await createTenantContext(adminClient);
  const projectId = await createProject(context.tenantId, context.ownerUserId, context.ownerClient);
  const profileId = await createProfile(context.tenantId, context.ownerUserId, context.ownerClient);
  const templateId = await createPublishedTemplate(context.tenantId, context.ownerUserId, context.ownerClient);

  const { data: participant, error: participantError } = await context.ownerClient
    .from("project_profile_participants")
    .insert({
      tenant_id: context.tenantId,
      project_id: projectId,
      recurring_profile_id: profileId,
      created_by: context.ownerUserId,
    })
    .select("id")
    .single();
  assertNoPostgrestError(participantError, "insert project participant");

  const signedRequestId = randomUUID();
  const { error: signedRequestError } = await adminClient.from("recurring_profile_consent_requests").insert({
    id: signedRequestId,
    tenant_id: context.tenantId,
    profile_id: profileId,
    project_id: projectId,
    consent_kind: "project",
    consent_template_id: templateId,
    profile_name_snapshot: "Jordan Miles",
    profile_email_snapshot: `feature069-active-only-${randomUUID()}@example.com`,
    token_hash: `feature069-active-only-${randomUUID()}`,
    status: "signed",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    created_by: context.ownerUserId,
  });
  assertNoPostgrestError(signedRequestError, "insert signed project request");

  const { error: activeConsentError } = await adminClient
    .from("recurring_profile_consents")
    .insert({
      tenant_id: context.tenantId,
      profile_id: profileId,
      request_id: signedRequestId,
      project_id: projectId,
      consent_kind: "project",
      consent_template_id: templateId,
      profile_name_snapshot: "Jordan Miles",
      profile_email_snapshot: `feature069-active-consent-${randomUUID()}@example.com`,
      consent_text: "Project participant consent text.",
      consent_version: "v1",
      structured_fields_snapshot: {
        schemaVersion: 1,
        templateSnapshot: {
          templateId,
          templateKey: `feature069-template-key-${randomUUID()}`,
          name: "Project Participant Consent",
          version: "v1",
          versionNumber: 1,
        },
        definition: createStarterStructuredFieldsDefinition(),
        values: {},
      },
      face_match_opt_in: true,
    });
  assertNoPostgrestError(activeConsentError, "insert active project consent");

  const panelData = await getProjectParticipantsPanelData({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId,
  });

  assert.equal(panelData.knownProfiles.length, 1);
  assert.equal(panelData.knownProfiles[0]?.participantId, participant.id);
  assert.equal(panelData.knownProfiles[0]?.projectConsent.state, "signed");
  assert.equal(panelData.knownProfiles[0]?.projectConsent.pendingRequest, null);
  assert.equal(panelData.knownProfiles[0]?.actions.canCreateRequest, true);
});
