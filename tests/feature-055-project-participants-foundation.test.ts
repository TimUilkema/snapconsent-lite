import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import { runProjectConsentScopeRepair } from "../src/lib/consent/project-consent-scope-repair";
import { loadProjectConsentScopeStatesByParticipantIds } from "../src/lib/consent/project-consent-scope-state";
import { createBaselineConsentRequest } from "../src/lib/profiles/profile-consent-service";
import { createProjectProfileConsentRequest } from "../src/lib/projects/project-participants-service";
import {
  getPublicRecurringConsentRequest,
  submitRecurringProfileConsent,
} from "../src/lib/recurring-consent/public-recurring-consent";
import {
  getPublicRecurringRevokeToken,
  revokeRecurringProfileConsentByToken,
} from "../src/lib/recurring-consent/revoke-recurring-profile-consent";
import { HttpError } from "../src/lib/http/errors";
import { createStarterFormLayoutDefinition } from "../src/lib/templates/form-layout";
import { createStarterStructuredFieldsDefinition } from "../src/lib/templates/structured-fields";
import {
  adminClient,
  assertNoPostgrestError,
  createPhotographerProjectWorkspace,
  createAnonClient,
  createAuthUserWithRetry,
  getDefaultProjectWorkspaceId,
  signInClient,
} from "./helpers/supabase-test-client";

type TenantContext = {
  tenantId: string;
  ownerUserId: string;
  photographerUserId: string;
  ownerClient: SupabaseClient;
  photographerClient: SupabaseClient;
};

type ProjectScope = {
  projectId: string;
  defaultWorkspaceId: string;
  photographerWorkspaceId: string;
};

async function createTenantContext(supabase: SupabaseClient): Promise<TenantContext> {
  const owner = await createAuthUserWithRetry(supabase, "feature055-owner");
  const photographer = await createAuthUserWithRetry(supabase, "feature055-photographer");
  const ownerClient = await signInClient(owner.email, owner.password);
  const photographerClient = await signInClient(photographer.email, photographer.password);

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert({
      name: `Feature 055 Tenant ${randomUUID()}`,
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

async function createProject(
  tenantId: string,
  ownerUserId: string,
  photographerUserId: string,
): Promise<ProjectScope> {
  const { data, error } = await adminClient
    .from("projects")
    .insert({
      tenant_id: tenantId,
      created_by: ownerUserId,
      name: `Feature 055 Project ${randomUUID()}`,
      description: null,
      status: "active",
    })
    .select("id")
    .single();

  assertNoPostgrestError(error, "insert project");
  const defaultWorkspaceId = await getDefaultProjectWorkspaceId(adminClient, tenantId, data.id);
  const photographerWorkspaceId = await createPhotographerProjectWorkspace({
    supabase: adminClient,
    tenantId,
    projectId: data.id,
    createdBy: ownerUserId,
    photographerUserId,
    name: "Feature 055 Photographer workspace",
  });

  return {
    projectId: data.id as string,
    defaultWorkspaceId,
    photographerWorkspaceId,
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
      template_key: `feature055-template-${randomUUID()}`,
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

async function listReconcileJobs(tenantId: string, projectId: string) {
  const { data, error } = await adminClient
    .from("face_match_jobs")
    .select("id, dedupe_key, payload, status")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("job_type", "reconcile_project")
    .order("created_at", { ascending: true });
  assertNoPostgrestError(error, "select reconcile jobs");
  return (data ?? []) as Array<{
    id: string;
    dedupe_key: string;
    payload: Record<string, unknown> | null;
    status: string;
  }>;
}

function assertPostgrestConstraint(
  error: PostgrestError | null,
  code: string,
  context: string,
) {
  assert.ok(error, `${context}: expected a PostgrestError`);
  assert.equal(error.code, code, `${context}: unexpected error code`);
}

test("project profile participants are tenant-scoped, member-insertable, and unique per project/profile", async () => {
  const context = await createTenantContext(adminClient);
  const project = await createProject(
    context.tenantId,
    context.ownerUserId,
    context.photographerUserId,
    context.ownerClient,
  );
  const projectId = project.projectId;
  const profileId = await createProfile(context.tenantId, context.ownerUserId, context.ownerClient);

  const { data: insertedParticipant, error: insertError } = await context.photographerClient
    .from("project_profile_participants")
    .insert({
      tenant_id: context.tenantId,
      project_id: projectId,
      workspace_id: project.photographerWorkspaceId,
      recurring_profile_id: profileId,
      created_by: context.photographerUserId,
    })
    .select("id, tenant_id, project_id, workspace_id, recurring_profile_id, created_by")
    .single();

  assertNoPostgrestError(insertError, "insert project profile participant");
  assert.equal(insertedParticipant.tenant_id, context.tenantId);
  assert.equal(insertedParticipant.project_id, projectId);
  assert.equal(insertedParticipant.workspace_id, project.photographerWorkspaceId);
  assert.equal(insertedParticipant.recurring_profile_id, profileId);
  assert.equal(insertedParticipant.created_by, context.photographerUserId);

  const { error: duplicateError } = await context.ownerClient.from("project_profile_participants").insert({
    tenant_id: context.tenantId,
    project_id: projectId,
    workspace_id: project.photographerWorkspaceId,
    recurring_profile_id: profileId,
    created_by: context.ownerUserId,
  });
  assertPostgrestConstraint(duplicateError, "23505", "duplicate project profile participant");
});

test("recurring consent schema distinguishes baseline vs project context and scopes project uniqueness per project", async () => {
  const context = await createTenantContext(adminClient);
  const project = await createProject(
    context.tenantId,
    context.ownerUserId,
    context.photographerUserId,
    context.ownerClient,
  );
  const secondProject = await createProject(
    context.tenantId,
    context.ownerUserId,
    context.photographerUserId,
    context.ownerClient,
  );
  const projectId = project.projectId;
  const secondProjectId = secondProject.projectId;
  const profileId = await createProfile(context.tenantId, context.ownerUserId, context.ownerClient);
  const templateId = await createPublishedTemplate(context.tenantId, context.ownerUserId, context.ownerClient);

  const { data: baselineRequest, error: baselineRequestError } = await adminClient
    .from("recurring_profile_consent_requests")
    .insert({
      id: randomUUID(),
      tenant_id: context.tenantId,
      profile_id: profileId,
      project_id: null,
      consent_kind: "baseline",
      consent_template_id: templateId,
      profile_name_snapshot: "Jordan Miles",
      profile_email_snapshot: `baseline-${randomUUID()}@example.com`,
      token_hash: `baseline-${randomUUID()}`,
      status: "signed",
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      created_by: context.ownerUserId,
    })
    .select("id")
    .single();
  assertNoPostgrestError(baselineRequestError, "insert baseline request");

  const { error: invalidBaselineError } = await adminClient.from("recurring_profile_consent_requests").insert({
    id: randomUUID(),
    tenant_id: context.tenantId,
    profile_id: profileId,
    project_id: projectId,
    consent_kind: "baseline",
    consent_template_id: templateId,
    profile_name_snapshot: "Jordan Miles",
    profile_email_snapshot: `invalid-baseline-${randomUUID()}@example.com`,
    token_hash: `invalid-baseline-${randomUUID()}`,
    status: "pending",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    created_by: context.ownerUserId,
  });
  assertPostgrestConstraint(invalidBaselineError, "23514", "baseline request with project_id");

  const { error: invalidProjectError } = await adminClient.from("recurring_profile_consent_requests").insert({
    id: randomUUID(),
    tenant_id: context.tenantId,
    profile_id: profileId,
    project_id: null,
    consent_kind: "project",
    consent_template_id: templateId,
    profile_name_snapshot: "Jordan Miles",
    profile_email_snapshot: `invalid-project-${randomUUID()}@example.com`,
    token_hash: `invalid-project-${randomUUID()}`,
    status: "pending",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    created_by: context.ownerUserId,
  });
  assertPostgrestConstraint(invalidProjectError, "23514", "project request without project_id");

  const projectRequestId = randomUUID();
  const { error: projectRequestError } = await adminClient.from("recurring_profile_consent_requests").insert({
    id: projectRequestId,
    tenant_id: context.tenantId,
    profile_id: profileId,
    project_id: projectId,
    workspace_id: project.photographerWorkspaceId,
    consent_kind: "project",
    consent_template_id: templateId,
    profile_name_snapshot: "Jordan Miles",
    profile_email_snapshot: `project-${randomUUID()}@example.com`,
    token_hash: `project-${randomUUID()}`,
    status: "pending",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    created_by: context.ownerUserId,
  });
  assertNoPostgrestError(projectRequestError, "insert project request");

  const { error: duplicateProjectPendingError } = await adminClient.from("recurring_profile_consent_requests").insert({
    id: randomUUID(),
    tenant_id: context.tenantId,
    profile_id: profileId,
    project_id: projectId,
    workspace_id: project.photographerWorkspaceId,
    consent_kind: "project",
    consent_template_id: templateId,
    profile_name_snapshot: "Jordan Miles",
    profile_email_snapshot: `project-duplicate-${randomUUID()}@example.com`,
    token_hash: `project-duplicate-${randomUUID()}`,
    status: "pending",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    created_by: context.ownerUserId,
  });
  assertPostgrestConstraint(duplicateProjectPendingError, "23505", "duplicate pending project request");

  const secondProjectRequestId = randomUUID();
  const { error: secondProjectRequestError } = await adminClient.from("recurring_profile_consent_requests").insert({
    id: secondProjectRequestId,
    tenant_id: context.tenantId,
    profile_id: profileId,
    project_id: secondProjectId,
    workspace_id: secondProject.photographerWorkspaceId,
    consent_kind: "project",
    consent_template_id: templateId,
    profile_name_snapshot: "Jordan Miles",
    profile_email_snapshot: `project-second-${randomUUID()}@example.com`,
    token_hash: `project-second-${randomUUID()}`,
    status: "signed",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    created_by: context.ownerUserId,
  });
  assertNoPostgrestError(secondProjectRequestError, "insert second project request");

  const { error: firstProjectConsentError } = await adminClient.from("recurring_profile_consents").insert({
    tenant_id: context.tenantId,
    profile_id: profileId,
    request_id: projectRequestId,
    project_id: projectId,
    workspace_id: project.photographerWorkspaceId,
    consent_kind: "project",
    consent_template_id: templateId,
    profile_name_snapshot: "Jordan Miles",
    profile_email_snapshot: `project-consent-${randomUUID()}@example.com`,
    consent_text: "Project-specific consent text",
    consent_version: "v1",
    structured_fields_snapshot: {
      schemaVersion: 1,
      templateSnapshot: {
        templateId,
        templateKey: "feature055-template",
        name: "Project Participant Consent",
        version: "v1",
        versionNumber: 1,
      },
      definition: createStarterStructuredFieldsDefinition(),
      values: {},
    },
  });
  assertNoPostgrestError(firstProjectConsentError, "insert project consent");

  const { error: secondProjectConsentError } = await adminClient.from("recurring_profile_consents").insert({
    tenant_id: context.tenantId,
    profile_id: profileId,
    request_id: secondProjectRequestId,
    project_id: secondProjectId,
    workspace_id: secondProject.photographerWorkspaceId,
    consent_kind: "project",
    consent_template_id: templateId,
    profile_name_snapshot: "Jordan Miles",
    profile_email_snapshot: `project-consent-second-${randomUUID()}@example.com`,
    consent_text: "Project-specific consent text",
    consent_version: "v1",
    structured_fields_snapshot: {
      schemaVersion: 1,
      templateSnapshot: {
        templateId,
        templateKey: "feature055-template",
        name: "Project Participant Consent",
        version: "v1",
        versionNumber: 1,
      },
      definition: createStarterStructuredFieldsDefinition(),
      values: {},
    },
  });
  assertNoPostgrestError(secondProjectConsentError, "insert second project consent");

  const { error: invalidProjectConsentError } = await adminClient.from("recurring_profile_consents").insert({
    tenant_id: context.tenantId,
    profile_id: profileId,
    request_id: baselineRequest.id,
    project_id: projectId,
    consent_kind: "baseline",
    consent_template_id: templateId,
    profile_name_snapshot: "Jordan Miles",
    profile_email_snapshot: `invalid-consent-${randomUUID()}@example.com`,
    consent_text: "Baseline consent text",
    consent_version: "v1",
    structured_fields_snapshot: {
      schemaVersion: 1,
      templateSnapshot: {
        templateId,
        templateKey: "feature055-template",
        name: "Project Participant Consent",
        version: "v1",
        versionNumber: 1,
      },
      definition: createStarterStructuredFieldsDefinition(),
      values: {},
    },
  });
  assertPostgrestConstraint(invalidProjectConsentError, "23514", "baseline consent with project_id");
});

test("project recurring public consent flow signs and revokes project context without affecting baseline consent", async () => {
  const context = await createTenantContext(adminClient);
  const anonClient = createAnonClient();
  const project = await createProject(
    context.tenantId,
    context.ownerUserId,
    context.photographerUserId,
    context.ownerClient,
  );
  const projectId = project.projectId;
  const profileId = await createProfile(context.tenantId, context.ownerUserId, context.ownerClient);
  const templateId = await createPublishedTemplate(context.tenantId, context.ownerUserId, context.ownerClient);

  const baselineRequest = await createBaselineConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
    consentTemplateId: templateId,
    idempotencyKey: `feature055-baseline-${randomUUID()}`,
  });
  const baselineToken = baselineRequest.payload.request.consentPath.split("/").pop() ?? "";
  const baselineSigned = await submitRecurringProfileConsent({
    supabase: anonClient,
    token: baselineToken,
    fullName: "Jordan Miles",
    email: "jordan@example.com",
    structuredFieldValues: {
      scope: ["photos"],
      duration: "one_year",
    },
    captureIp: "127.0.0.1",
    captureUserAgent: "feature055-baseline-test",
  });

  const { data: participantRow, error: participantError } = await context.ownerClient
    .from("project_profile_participants")
    .insert({
      tenant_id: context.tenantId,
      project_id: projectId,
      workspace_id: project.photographerWorkspaceId,
      recurring_profile_id: profileId,
      created_by: context.ownerUserId,
    })
    .select("id")
    .single();
  assertNoPostgrestError(participantError, "insert project profile participant");

  const createdProjectRequest = await createProjectProfileConsentRequest({
    supabase: context.photographerClient,
    tenantId: context.tenantId,
    userId: context.photographerUserId,
    projectId,
    workspaceId: project.photographerWorkspaceId,
    participantId: participantRow.id,
    consentTemplateId: templateId,
    idempotencyKey: `feature055-project-${randomUUID()}`,
  });

  assert.equal(createdProjectRequest.status, 201);
  assert.equal(createdProjectRequest.payload.request.projectId, projectId);
  assert.equal(createdProjectRequest.payload.request.profileId, profileId);

  const projectToken = createdProjectRequest.payload.request.consentPath.split("/").pop() ?? "";
  const publicProjectRequest = await getPublicRecurringConsentRequest(anonClient, projectToken);
  assert.ok(publicProjectRequest);
  assert.equal(publicProjectRequest.requestStatus, "pending");
  assert.equal(publicProjectRequest.canSign, true);
  assert.equal(publicProjectRequest.workspaceId, project.photographerWorkspaceId);

  const projectSigned = await submitRecurringProfileConsent({
    supabase: anonClient,
    token: projectToken,
    fullName: "Jordan Miles",
    email: "jordan@example.com",
    structuredFieldValues: {
      scope: ["photos"],
      duration: "one_year",
    },
    captureIp: "127.0.0.1",
    captureUserAgent: "feature055-project-test",
  });

  assert.equal(projectSigned.duplicate, false);
  assert.ok(projectSigned.revokeToken);

  const { data: projectConsent, error: projectConsentError } = await context.ownerClient
    .from("recurring_profile_consents")
    .select("project_id, workspace_id, consent_kind, revoked_at")
    .eq("tenant_id", context.tenantId)
    .eq("id", projectSigned.consentId)
    .single();
  assertNoPostgrestError(projectConsentError, "select signed project recurring consent");
  assert.equal(projectConsent.project_id, projectId);
  assert.equal(projectConsent.workspace_id, project.photographerWorkspaceId);
  assert.equal(projectConsent.consent_kind, "project");
  assert.equal(projectConsent.revoked_at, null);

  const { data: baselineProjectionRows, error: baselineProjectionError } = await context.ownerClient
    .from("project_consent_scope_signed_projections")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .eq("recurring_profile_consent_id", baselineSigned.consentId);
  assertNoPostgrestError(baselineProjectionError, "select baseline recurring scope projections");
  assert.equal(baselineProjectionRows?.length ?? 0, 0);

  const { data: projectProjectionRows, error: projectProjectionError } = await context.ownerClient
    .from("project_consent_scope_signed_projections")
    .select("owner_kind, source_kind, project_profile_participant_id, scope_option_key, granted")
    .eq("tenant_id", context.tenantId)
    .eq("recurring_profile_consent_id", projectSigned.consentId)
    .order("scope_order_index", { ascending: true });
  assertNoPostgrestError(projectProjectionError, "select project recurring scope projections");
  assert.deepEqual(
    projectProjectionRows?.map((row) => ({
      owner_kind: row.owner_kind,
      source_kind: row.source_kind,
      project_profile_participant_id: row.project_profile_participant_id,
      scope_option_key: row.scope_option_key,
      granted: row.granted,
    })),
    [
      {
        owner_kind: "project_participant",
        source_kind: "project_recurring_consent",
        project_profile_participant_id: participantRow.id,
        scope_option_key: "photos",
        granted: true,
      },
    ],
  );

  const revokeContext = await getPublicRecurringRevokeToken(anonClient, projectSigned.revokeToken ?? "");
  assert.ok(revokeContext);
  assert.equal(revokeContext.status, "available");

  const revoked = await revokeRecurringProfileConsentByToken(
    anonClient,
    projectSigned.revokeToken ?? "",
    "Project complete",
  );
  assert.equal(revoked.revoked, true);
  assert.equal(revoked.alreadyRevoked, false);

  const { data: baselineConsentRow, error: baselineConsentError } = await context.ownerClient
    .from("recurring_profile_consents")
    .select("consent_kind, revoked_at")
    .eq("tenant_id", context.tenantId)
    .eq("id", baselineSigned.consentId)
    .single();
  assertNoPostgrestError(baselineConsentError, "select baseline recurring consent after project revoke");
  assert.equal(baselineConsentRow.consent_kind, "baseline");
  assert.equal(baselineConsentRow.revoked_at, null);
});

test("project recurring consent sign and revoke enqueue reconcile_project replay only when project auto eligibility changes", async () => {
  const context = await createTenantContext(adminClient);
  const project = await createProject(
    context.tenantId,
    context.ownerUserId,
    context.photographerUserId,
    context.ownerClient,
  );
  const projectId = project.projectId;
  const profileId = await createProfile(context.tenantId, context.ownerUserId, context.ownerClient);
  const templateId = await createPublishedTemplate(context.tenantId, context.ownerUserId, context.ownerClient);
  const anonClient = createAnonClient();

  const baselineRequest = await createBaselineConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    profileId,
    consentTemplateId: templateId,
    idempotencyKey: `feature055-project-replay-baseline-${randomUUID()}`,
  });
  const baselineToken = baselineRequest.payload.request.consentPath.split("/").pop() ?? "";
  await submitRecurringProfileConsent({
    supabase: anonClient,
    token: baselineToken,
    fullName: "Jordan Miles",
    email: "jordan+project-replay@example.com",
    structuredFieldValues: {
      scope: ["photos"],
      duration: "one_year",
    },
    captureIp: "127.0.0.1",
    captureUserAgent: "feature055-project-replay-baseline",
  });

  const { data: participantRow, error: participantError } = await context.ownerClient
    .from("project_profile_participants")
    .insert({
      tenant_id: context.tenantId,
      project_id: projectId,
      workspace_id: project.photographerWorkspaceId,
      recurring_profile_id: profileId,
      created_by: context.ownerUserId,
    })
    .select("id")
    .single();
  assertNoPostgrestError(participantError, "insert project replay participant");

  const projectRequest = await createProjectProfileConsentRequest({
    supabase: context.photographerClient,
    tenantId: context.tenantId,
    userId: context.photographerUserId,
    projectId,
    workspaceId: project.photographerWorkspaceId,
    participantId: participantRow.id,
    consentTemplateId: templateId,
    idempotencyKey: `feature055-project-replay-${randomUUID()}`,
  });
  const projectToken = projectRequest.payload.request.consentPath.split("/").pop() ?? "";

  const { error: clearJobError } = await adminClient
    .from("face_match_jobs")
    .delete()
    .eq("tenant_id", context.tenantId)
    .eq("project_id", projectId)
    .eq("job_type", "reconcile_project");
  assertNoPostgrestError(clearJobError, "clear reconcile jobs before project consent replay");

  const signed = await submitRecurringProfileConsent({
    supabase: anonClient,
    token: projectToken,
    fullName: "Jordan Miles",
    email: "jordan+project-replay@example.com",
    faceMatchOptIn: true,
    structuredFieldValues: {
      scope: ["photos"],
      duration: "one_year",
    },
    captureIp: "127.0.0.1",
    captureUserAgent: "feature055-project-replay-sign",
  });
  assert.equal(signed.duplicate, false);

  const signReplayJobs = await listReconcileJobs(context.tenantId, projectId);
  assert.equal(signReplayJobs.length, 1);
  assert.equal(signReplayJobs[0]?.payload?.replayKind, "project_recurring_consent");
  assert.equal(signReplayJobs[0]?.payload?.reason, "project_recurring_consent_opt_in_granted");
  assert.equal(signReplayJobs[0]?.status, "queued");

  const { error: clearAfterSignError } = await adminClient
    .from("face_match_jobs")
    .delete()
    .eq("tenant_id", context.tenantId)
    .eq("project_id", projectId)
    .eq("job_type", "reconcile_project");
  assertNoPostgrestError(clearAfterSignError, "clear reconcile jobs after project consent sign");

  const revoked = await revokeRecurringProfileConsentByToken(
    anonClient,
    signed.revokeToken ?? "",
    "Project complete",
  );
  assert.equal(revoked.revoked, true);
  assert.equal(revoked.alreadyRevoked, false);

  const revokeReplayJobs = await listReconcileJobs(context.tenantId, projectId);
  assert.equal(revokeReplayJobs.length, 1);
  assert.equal(revokeReplayJobs[0]?.payload?.replayKind, "project_recurring_consent");
  assert.equal(revokeReplayJobs[0]?.payload?.reason, "project_recurring_consent_revoked");
  assert.equal(revokeReplayJobs[0]?.status, "queued");
});

test("project participant scope state helper falls back from signed snapshot when projections are missing", async () => {
  const context = await createTenantContext(adminClient);
  const project = await createProject(
    context.tenantId,
    context.ownerUserId,
    context.photographerUserId,
    context.ownerClient,
  );
  const projectId = project.projectId;
  const profileId = await createProfile(context.tenantId, context.ownerUserId, context.ownerClient);
  const templateId = await createPublishedTemplate(context.tenantId, context.ownerUserId, context.ownerClient);
  const anonClient = createAnonClient();

  const { data: participantRow, error: participantError } = await context.ownerClient
    .from("project_profile_participants")
    .insert({
      tenant_id: context.tenantId,
      project_id: projectId,
      workspace_id: project.photographerWorkspaceId,
      recurring_profile_id: profileId,
      created_by: context.ownerUserId,
    })
    .select("id")
    .single();
  assertNoPostgrestError(participantError, "insert project participant for scope helper");

  const projectRequest = await createProjectProfileConsentRequest({
    supabase: context.photographerClient,
    tenantId: context.tenantId,
    userId: context.photographerUserId,
    projectId,
    workspaceId: project.photographerWorkspaceId,
    participantId: participantRow.id,
    consentTemplateId: templateId,
    idempotencyKey: `feature055-scope-helper-${randomUUID()}`,
  });
  const projectToken = projectRequest.payload.request.consentPath.split("/").pop() ?? "";

  const signed = await submitRecurringProfileConsent({
    supabase: anonClient,
    token: projectToken,
    fullName: "Jordan Miles",
    email: "jordan+scope-helper@example.com",
    structuredFieldValues: {
      scope: ["photos"],
      duration: "one_year",
    },
    captureIp: "127.0.0.1",
    captureUserAgent: "feature055-scope-helper",
  });

  const { error: deleteProjectionError } = await adminClient
    .from("project_consent_scope_signed_projections")
    .delete()
    .eq("tenant_id", context.tenantId)
    .eq("recurring_profile_consent_id", signed.consentId);
  assertNoPostgrestError(deleteProjectionError, "delete recurring scope projections to force fallback");

  const statesByParticipantId = await loadProjectConsentScopeStatesByParticipantIds({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    projectId,
    participantIds: [participantRow.id],
  });

  assert.deepEqual(
    statesByParticipantId.get(participantRow.id)?.map((row) => ({
      scopeOptionKey: row.scopeOptionKey,
      effectiveStatus: row.effectiveStatus,
      signedValueGranted: row.signedValueGranted,
      derivedFrom: row.derivedFrom,
      governingRecurringProfileConsentId: row.governingRecurringProfileConsentId,
    })),
    [
      {
        scopeOptionKey: "photos",
        effectiveStatus: "granted",
        signedValueGranted: true,
        derivedFrom: "snapshot_fallback",
        governingRecurringProfileConsentId: signed.consentId,
      },
    ],
  );
});

test("project recurring consent scope repair backfills missing recurring projections and reruns idempotently", async () => {
  const context = await createTenantContext(adminClient);
  const project = await createProject(
    context.tenantId,
    context.ownerUserId,
    context.photographerUserId,
    context.ownerClient,
  );
  const projectId = project.projectId;
  const profileId = await createProfile(context.tenantId, context.ownerUserId, context.ownerClient);
  const templateId = await createPublishedTemplate(context.tenantId, context.ownerUserId, context.ownerClient);
  const anonClient = createAnonClient();

  const { data: participantRow, error: participantError } = await context.ownerClient
    .from("project_profile_participants")
    .insert({
      tenant_id: context.tenantId,
      project_id: projectId,
      workspace_id: project.photographerWorkspaceId,
      recurring_profile_id: profileId,
      created_by: context.ownerUserId,
    })
    .select("id")
    .single();
  assertNoPostgrestError(participantError, "insert project participant for recurring repair");

  const projectRequest = await createProjectProfileConsentRequest({
    supabase: context.photographerClient,
    tenantId: context.tenantId,
    userId: context.photographerUserId,
    projectId,
    workspaceId: project.photographerWorkspaceId,
    participantId: participantRow.id,
    consentTemplateId: templateId,
    idempotencyKey: `feature055-recurring-repair-${randomUUID()}`,
  });
  const projectToken = projectRequest.payload.request.consentPath.split("/").pop() ?? "";

  const signed = await submitRecurringProfileConsent({
    supabase: anonClient,
    token: projectToken,
    fullName: "Jordan Miles",
    email: "jordan+repair@example.com",
    structuredFieldValues: {
      scope: ["photos"],
      duration: "one_year",
    },
    captureIp: "127.0.0.1",
    captureUserAgent: "feature055-recurring-repair",
  });

  const { error: deleteProjectionError } = await adminClient
    .from("project_consent_scope_signed_projections")
    .delete()
    .eq("tenant_id", context.tenantId)
    .eq("recurring_profile_consent_id", signed.consentId);
  assertNoPostgrestError(deleteProjectionError, "delete recurring repair projections");

  const repaired = await runProjectConsentScopeRepair({
    projectId,
    batchSize: 10,
    supabase: adminClient,
  });
  assert.equal(repaired.scannedRecurringConsents, 1);
  assert.equal(repaired.repairedRecurringConsents, 1);
  assert.equal(repaired.insertedRecurringProjectionRows, 1);

  const rerun = await runProjectConsentScopeRepair({
    projectId,
    batchSize: 10,
    supabase: adminClient,
  });
  assert.equal(rerun.scannedRecurringConsents, 0);
  assert.equal(rerun.repairedRecurringConsents, 0);
  assert.equal(rerun.insertedRecurringProjectionRows, 0);

  const { count: restoredProjectionCount, error: restoredProjectionError } = await adminClient
    .from("project_consent_scope_signed_projections")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", context.tenantId)
    .eq("recurring_profile_consent_id", signed.consentId);
  assertNoPostgrestError(restoredProjectionError, "count restored recurring repair projections");
  assert.equal(restoredProjectionCount, 1);
});

test("superseded recurring consents no longer count as active for request creation or uniqueness", async () => {
  const context = await createTenantContext(adminClient);
  const project = await createProject(
    context.tenantId,
    context.ownerUserId,
    context.photographerUserId,
    context.ownerClient,
  );
  const projectId = project.projectId;
  const profileId = await createProfile(context.tenantId, context.ownerUserId, context.ownerClient);
  const templateId = await createPublishedTemplate(context.tenantId, context.ownerUserId, context.ownerClient);

  const { data: participantRow, error: participantError } = await context.ownerClient
    .from("project_profile_participants")
    .insert({
      tenant_id: context.tenantId,
      project_id: projectId,
      workspace_id: project.photographerWorkspaceId,
      recurring_profile_id: profileId,
      created_by: context.ownerUserId,
    })
    .select("id")
    .single();
  assertNoPostgrestError(participantError, "insert project participant for supersedence test");

  const firstRequestId = randomUUID();
  const { error: firstRequestError } = await adminClient.from("recurring_profile_consent_requests").insert({
    id: firstRequestId,
    tenant_id: context.tenantId,
    profile_id: profileId,
    project_id: projectId,
    workspace_id: project.photographerWorkspaceId,
    consent_kind: "project",
    consent_template_id: templateId,
    profile_name_snapshot: "Jordan Miles",
    profile_email_snapshot: `superseded-project-${randomUUID()}@example.com`,
    token_hash: `superseded-project-${randomUUID()}`,
    status: "signed",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    created_by: context.ownerUserId,
  });
  assertNoPostgrestError(firstRequestError, "insert first signed project request");

  const { data: firstConsent, error: firstConsentError } = await adminClient
    .from("recurring_profile_consents")
    .insert({
      tenant_id: context.tenantId,
      profile_id: profileId,
      request_id: firstRequestId,
      project_id: projectId,
      workspace_id: project.photographerWorkspaceId,
      consent_kind: "project",
      consent_template_id: templateId,
      profile_name_snapshot: "Jordan Miles",
      profile_email_snapshot: `superseded-project-consent-${randomUUID()}@example.com`,
      consent_text: "Project-specific consent text",
      consent_version: "v1",
      structured_fields_snapshot: {
        schemaVersion: 1,
        templateSnapshot: {
          templateId,
          templateKey: "feature055-template",
          name: "Project Participant Consent",
          version: "v1",
          versionNumber: 1,
        },
        definition: createStarterStructuredFieldsDefinition(),
        values: {},
      },
    })
    .select("id")
    .single();
  assertNoPostgrestError(firstConsentError, "insert first active project consent");

  const createdWhileActive = await createProjectProfileConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    projectId,
    workspaceId: project.photographerWorkspaceId,
    participantId: participantRow.id,
    consentTemplateId: templateId,
    idempotencyKey: `feature055-active-block-${randomUUID()}`,
  }).catch((error) => error);

  assert.ok(createdWhileActive instanceof HttpError);
  assert.equal(createdWhileActive.status, 409);
  assert.equal(createdWhileActive.code, "project_consent_already_signed");

  const nowIso = new Date().toISOString();
  const { error: supersedeError } = await adminClient
    .from("recurring_profile_consents")
    .update({
      superseded_at: nowIso,
    })
    .eq("id", firstConsent.id)
    .eq("tenant_id", context.tenantId);
  assertNoPostgrestError(supersedeError, "supersede first project consent");

  const createdAfterSupersede = await createProjectProfileConsentRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    projectId,
    workspaceId: project.photographerWorkspaceId,
    participantId: participantRow.id,
    consentTemplateId: templateId,
    idempotencyKey: `feature055-superseded-allow-${randomUUID()}`,
  });

  assert.equal(createdAfterSupersede.status, 201);

  const secondRequestId = randomUUID();
  const { error: secondRequestError } = await adminClient.from("recurring_profile_consent_requests").insert({
    id: secondRequestId,
    tenant_id: context.tenantId,
    profile_id: profileId,
    project_id: projectId,
    workspace_id: project.photographerWorkspaceId,
    consent_kind: "project",
    consent_template_id: templateId,
    profile_name_snapshot: "Jordan Miles",
    profile_email_snapshot: `superseded-project-second-${randomUUID()}@example.com`,
    token_hash: `superseded-project-second-${randomUUID()}`,
    status: "signed",
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    created_by: context.ownerUserId,
  });
  assertNoPostgrestError(secondRequestError, "insert second signed project request");

  const { error: secondConsentError } = await adminClient.from("recurring_profile_consents").insert({
    tenant_id: context.tenantId,
    profile_id: profileId,
    request_id: secondRequestId,
    project_id: projectId,
    workspace_id: project.photographerWorkspaceId,
    consent_kind: "project",
    consent_template_id: templateId,
    profile_name_snapshot: "Jordan Miles",
    profile_email_snapshot: `superseded-project-consent-second-${randomUUID()}@example.com`,
    consent_text: "Project-specific consent text",
    consent_version: "v1",
    structured_fields_snapshot: {
      schemaVersion: 1,
      templateSnapshot: {
        templateId,
        templateKey: "feature055-template",
        name: "Project Participant Consent",
        version: "v1",
        versionNumber: 1,
      },
      definition: createStarterStructuredFieldsDefinition(),
      values: {},
    },
  });
  assertNoPostgrestError(secondConsentError, "insert second project consent after supersede");
});
