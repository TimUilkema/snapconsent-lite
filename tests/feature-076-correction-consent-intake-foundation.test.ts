import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createInviteWithIdempotency } from "../src/lib/idempotency/invite-idempotency";
import {
  assertWorkspaceCorrectionPublicSubmissionAllowed,
  buildCorrectionRequestProvenance,
  finalizeProject,
  reopenWorkspaceForCorrection,
  startProjectCorrection,
} from "../src/lib/projects/project-workflow-service";
import {
  addProjectProfileParticipant,
  createProjectProfileConsentRequest,
} from "../src/lib/projects/project-participants-service";
import { ensureProjectReleaseSnapshot } from "../src/lib/project-releases/project-release-service";
import { createStarterFormLayoutDefinition } from "../src/lib/templates/form-layout";
import { createStarterStructuredFieldsDefinition } from "../src/lib/templates/structured-fields";
import {
  adminClient,
  assertNoPostgrestError,
  createAuthUserWithRetry,
  createReviewerRoleAssignment,
  getDefaultProjectWorkspaceId,
  signInClient,
} from "./helpers/supabase-test-client";

type CorrectionIntakeContext = {
  tenantId: string;
  ownerUserId: string;
  reviewerUserId: string;
  ownerClient: SupabaseClient;
  reviewerClient: SupabaseClient;
  projectId: string;
  workspaceId: string;
  templateId: string;
};

async function createPublishedTemplate(
  client: SupabaseClient,
  tenantId: string,
  userId: string,
  label: string,
) {
  const structuredFieldsDefinition = createStarterStructuredFieldsDefinition();
  structuredFieldsDefinition.builtInFields.scope.options = [
    {
      optionKey: "photos",
      label: "Photos",
      orderIndex: 0,
    },
  ];

  const { data, error } = await client
    .from("consent_templates")
    .insert({
      tenant_id: tenantId,
      template_key: `${label}-${randomUUID()}`,
      name: `${label} Template`,
      description: null,
      version: "v1",
      version_number: 1,
      status: "published",
      body: "I consent to the project-specific processing described here.",
      structured_fields_definition: structuredFieldsDefinition,
      form_layout_definition: createStarterFormLayoutDefinition(structuredFieldsDefinition),
      created_by: userId,
    })
    .select("id")
    .single();
  assertNoPostgrestError(error, "insert feature 076 published template");
  return data.id as string;
}

async function createCorrectionIntakeContext(): Promise<CorrectionIntakeContext> {
  const owner = await createAuthUserWithRetry(adminClient, "feature076-owner");
  const reviewer = await createAuthUserWithRetry(adminClient, "feature076-reviewer");
  const ownerClient = await signInClient(owner.email, owner.password);
  const reviewerClient = await signInClient(reviewer.email, reviewer.password);

  const { data: tenant, error: tenantError } = await adminClient
    .from("tenants")
    .insert({
      name: `Feature 076 Intake Tenant ${randomUUID()}`,
    })
    .select("id")
    .single();
  assertNoPostgrestError(tenantError, "insert feature 076 tenant");

  const { error: membershipError } = await adminClient.from("memberships").insert([
    {
      tenant_id: tenant.id,
      user_id: owner.userId,
      role: "owner",
    },
    {
      tenant_id: tenant.id,
      user_id: reviewer.userId,
      role: "reviewer",
    },
  ]);
  assertNoPostgrestError(membershipError, "insert feature 076 memberships");

  const { data: project, error: projectError } = await adminClient
    .from("projects")
    .insert({
      tenant_id: tenant.id,
      created_by: owner.userId,
      name: "Feature 076 Correction Intake Project",
      description: null,
      status: "active",
    })
    .select("id")
    .single();
  assertNoPostgrestError(projectError, "insert feature 076 project");

  const workspaceId = await getDefaultProjectWorkspaceId(adminClient, tenant.id, project.id);
  await createReviewerRoleAssignment({
    tenantId: tenant.id,
    userId: reviewer.userId,
    createdBy: owner.userId,
  });
  const templateId = await createPublishedTemplate(ownerClient, tenant.id, owner.userId, "feature076");

  return {
    tenantId: tenant.id,
    ownerUserId: owner.userId,
    reviewerUserId: reviewer.userId,
    ownerClient,
    reviewerClient,
    projectId: project.id,
    workspaceId,
    templateId,
  };
}

async function openCorrectionCycle(context: CorrectionIntakeContext) {
  const handedOff = new Date().toISOString();
  const validated = new Date(Date.now() + 1_000).toISOString();
  const { error: handoffError } = await adminClient
    .from("project_workspaces")
    .update({
      workflow_state: "handed_off",
      workflow_state_changed_at: handedOff,
      workflow_state_changed_by: context.ownerUserId,
      handed_off_at: handedOff,
      handed_off_by: context.ownerUserId,
    })
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("id", context.workspaceId);
  assertNoPostgrestError(handoffError, "handoff default workspace");

  const { error: validateError } = await adminClient
    .from("project_workspaces")
    .update({
      workflow_state: "validated",
      workflow_state_changed_at: validated,
      workflow_state_changed_by: context.reviewerUserId,
      validated_at: validated,
      validated_by: context.reviewerUserId,
    })
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("id", context.workspaceId);
  assertNoPostgrestError(validateError, "validate default workspace");

  await finalizeProject({
    supabase: adminClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    projectId: context.projectId,
  });
  await ensureProjectReleaseSnapshot({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    actorUserId: context.reviewerUserId,
  });
  await startProjectCorrection({
    supabase: adminClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    projectId: context.projectId,
    reason: "Fix consent issues",
  });
  await reopenWorkspaceForCorrection({
    supabase: adminClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    projectId: context.projectId,
    workspaceId: context.workspaceId,
  });

  const { data: project, error: projectError } = await adminClient
    .from("projects")
    .select("finalized_at, correction_state, correction_opened_at, correction_source_release_id")
    .eq("tenant_id", context.tenantId)
    .eq("id", context.projectId)
    .single();
  assertNoPostgrestError(projectError, "select correction project");

  return buildCorrectionRequestProvenance(project);
}

test("correction invite creation uses cycle-scoped idempotency and the public gate only allows correction rows", async () => {
  const context = await createCorrectionIntakeContext();
  const sharedIdempotencyKey = `feature076-shared-${randomUUID()}`;

  const normalInvite = await createInviteWithIdempotency({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    workspaceId: context.workspaceId,
    userId: context.ownerUserId,
    idempotencyKey: sharedIdempotencyKey,
    consentTemplateId: context.templateId,
  });

  const { error: revokeNormalInviteError } = await adminClient
    .from("subject_invites")
    .update({ status: "revoked" })
    .eq("tenant_id", context.tenantId)
    .eq("id", normalInvite.payload.inviteId);
  assertNoPostgrestError(revokeNormalInviteError, "revoke normal invite for finalization");

  const correctionProvenance = await openCorrectionCycle(context);

  const correctionInvite = await createInviteWithIdempotency({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    workspaceId: context.workspaceId,
    userId: context.reviewerUserId,
    idempotencyKey: sharedIdempotencyKey,
    consentTemplateId: context.templateId,
    correctionProvenance,
  });

  assert.notEqual(correctionInvite.payload.inviteId, normalInvite.payload.inviteId);

  const { data: storedInvite, error: storedInviteError } = await adminClient
    .from("subject_invites")
    .select("request_source, correction_opened_at_snapshot, correction_source_release_id_snapshot")
    .eq("tenant_id", context.tenantId)
    .eq("id", correctionInvite.payload.inviteId)
    .single();
  assertNoPostgrestError(storedInviteError, "select correction invite provenance");
  assert.equal(storedInvite.request_source, "correction");
  assert.equal(
    storedInvite.correction_source_release_id_snapshot,
    correctionProvenance.correctionSourceReleaseIdSnapshot,
  );

  await assert.rejects(
    assertWorkspaceCorrectionPublicSubmissionAllowed(
      adminClient,
      context.tenantId,
      context.projectId,
      context.workspaceId,
      {
        requestSource: "normal",
        correctionOpenedAtSnapshot: null,
        correctionSourceReleaseIdSnapshot: null,
      },
    ),
    (error: unknown) =>
      error instanceof Error
      && "code" in error
      && (error as { code?: string }).code === "project_finalized",
  );

  await assert.doesNotReject(
    assertWorkspaceCorrectionPublicSubmissionAllowed(
      adminClient,
      context.tenantId,
      context.projectId,
      context.workspaceId,
      correctionProvenance,
    ),
  );
});

test("correction recurring project consent requests are marked with correction provenance", async () => {
  const context = await createCorrectionIntakeContext();
  const correctionProvenance = await openCorrectionCycle(context);

  const { data: profile, error: profileError } = await context.ownerClient
    .from("recurring_profiles")
    .insert({
      tenant_id: context.tenantId,
      full_name: "Jordan Miles",
      email: `feature076-recurring-${randomUUID()}@example.com`,
      status: "active",
      created_by: context.ownerUserId,
    })
    .select("id")
    .single();
  assertNoPostgrestError(profileError, "insert feature 076 recurring profile");

  const participant = await addProjectProfileParticipant({
    supabase: adminClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    projectId: context.projectId,
    workspaceId: context.workspaceId,
    recurringProfileId: profile.id,
  });

  const request = await createProjectProfileConsentRequest({
    supabase: context.reviewerClient,
    tenantId: context.tenantId,
    userId: context.reviewerUserId,
    projectId: context.projectId,
    workspaceId: context.workspaceId,
    participantId: participant.payload.participant.id,
    consentTemplateId: context.templateId,
    idempotencyKey: `feature076-recurring-request-${randomUUID()}`,
    correctionProvenance,
  });

  const { data: storedRequest, error: storedRequestError } = await adminClient
    .from("recurring_profile_consent_requests")
    .select("request_source, correction_opened_at_snapshot, correction_source_release_id_snapshot")
    .eq("tenant_id", context.tenantId)
    .eq("id", request.payload.request.id)
    .single();
  assertNoPostgrestError(storedRequestError, "select correction recurring request provenance");
  assert.equal(storedRequest.request_source, "correction");
  assert.equal(
    storedRequest.correction_source_release_id_snapshot,
    correctionProvenance.correctionSourceReleaseIdSnapshot,
  );

  await assert.doesNotReject(
    assertWorkspaceCorrectionPublicSubmissionAllowed(
      adminClient,
      context.tenantId,
      context.projectId,
      context.workspaceId,
      correctionProvenance,
    ),
  );
});
