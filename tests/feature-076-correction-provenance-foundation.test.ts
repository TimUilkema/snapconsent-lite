import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createStarterFormLayoutDefinition } from "../src/lib/templates/form-layout";
import { createStarterStructuredFieldsDefinition } from "../src/lib/templates/structured-fields";
import {
  adminClient,
  assertNoPostgrestError,
  createAuthUserWithRetry,
  getDefaultProjectWorkspaceId,
  signInClient,
} from "./helpers/supabase-test-client";

type CorrectionProvenanceContext = {
  tenantId: string;
  ownerUserId: string;
  projectId: string;
  workspaceId: string;
  templateId: string;
  profileId: string;
  releaseId: string;
  correctionOpenedAt: string;
};

function assertSameInstant(actual: string | null, expected: string) {
  assert.ok(actual, "expected timestamp");
  assert.equal(new Date(actual).toISOString(), new Date(expected).toISOString());
}

async function createCorrectionProvenanceContext(): Promise<CorrectionProvenanceContext> {
  const owner = await createAuthUserWithRetry(adminClient, "feature076-provenance-owner");
  const ownerClient = await signInClient(owner.email, owner.password);

  const { data: tenant, error: tenantError } = await adminClient
    .from("tenants")
    .insert({
      name: `Feature 076 Provenance Tenant ${randomUUID()}`,
    })
    .select("id")
    .single();
  assertNoPostgrestError(tenantError, "insert feature 076 provenance tenant");

  const { error: membershipError } = await adminClient.from("memberships").insert({
    tenant_id: tenant.id,
    user_id: owner.userId,
    role: "owner",
  });
  assertNoPostgrestError(membershipError, "insert feature 076 provenance membership");

  const finalizedAt = new Date().toISOString();
  const correctionOpenedAt = new Date(Date.now() + 1000).toISOString();

  const { data: project, error: projectError } = await adminClient
    .from("projects")
    .insert({
      tenant_id: tenant.id,
      created_by: owner.userId,
      name: "Feature 076 Provenance Project",
      description: "Feature 076 provenance foundation test project",
      status: "active",
      finalized_at: finalizedAt,
      finalized_by: owner.userId,
    })
    .select("id")
    .single();
  assertNoPostgrestError(projectError, "insert feature 076 provenance project");

  const workspaceId = await getDefaultProjectWorkspaceId(adminClient, tenant.id, project.id);

  const structuredFieldsDefinition = createStarterStructuredFieldsDefinition();
  structuredFieldsDefinition.builtInFields.scope.options = [
    {
      optionKey: "photos",
      label: "Photos",
      orderIndex: 0,
    },
  ];
  const formLayoutDefinition = createStarterFormLayoutDefinition(structuredFieldsDefinition);
  const { data: template, error: templateError } = await ownerClient
    .from("consent_templates")
    .insert({
      tenant_id: tenant.id,
      template_key: `feature076-provenance-template-${randomUUID()}`,
      name: "Feature 076 Provenance Template",
      description: null,
      version: "v1",
      version_number: 1,
      status: "published",
      body: "This is a sufficiently long consent body for provenance testing.",
      structured_fields_definition: structuredFieldsDefinition,
      form_layout_definition: formLayoutDefinition,
      created_by: owner.userId,
    })
    .select("id")
    .single();
  assertNoPostgrestError(templateError, "insert feature 076 provenance template");

  const { data: profile, error: profileError } = await ownerClient
    .from("recurring_profiles")
    .insert({
      tenant_id: tenant.id,
      full_name: "Jordan Miles",
      email: `feature076-provenance-${randomUUID()}@example.com`,
      status: "active",
      created_by: owner.userId,
    })
    .select("id")
    .single();
  assertNoPostgrestError(profileError, "insert feature 076 provenance profile");

  const { data: release, error: releaseError } = await adminClient
    .from("project_releases")
    .insert({
      tenant_id: tenant.id,
      project_id: project.id,
      release_version: 1,
      status: "published",
      created_by: owner.userId,
      source_project_finalized_at: finalizedAt,
      source_project_finalized_by: owner.userId,
      snapshot_created_at: finalizedAt,
      project_snapshot: {},
    })
    .select("id")
    .single();
  assertNoPostgrestError(releaseError, "insert feature 076 provenance release");

  return {
    tenantId: tenant.id,
    ownerUserId: owner.userId,
    projectId: project.id,
    workspaceId,
    templateId: template.id,
    profileId: profile.id,
    releaseId: release.id,
    correctionOpenedAt,
  };
}

test("feature 076 provenance columns default normal rows and enforce correction provenance on subject invites", async () => {
  const context = await createCorrectionProvenanceContext();

  const { data: normalInvite, error: normalInviteError } = await adminClient
    .from("subject_invites")
    .insert({
      tenant_id: context.tenantId,
      project_id: context.projectId,
      workspace_id: context.workspaceId,
      created_by: context.ownerUserId,
      token_hash: randomUUID().replaceAll("-", ""),
      status: "active",
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      max_uses: 1,
      consent_template_id: context.templateId,
    })
    .select("request_source, correction_opened_at_snapshot, correction_source_release_id_snapshot")
    .single();
  assertNoPostgrestError(normalInviteError, "insert normal subject invite");
  assert.equal(normalInvite.request_source, "normal");
  assert.equal(normalInvite.correction_opened_at_snapshot, null);
  assert.equal(normalInvite.correction_source_release_id_snapshot, null);

  const { error: invalidCorrectionInviteError } = await adminClient
    .from("subject_invites")
    .insert({
      tenant_id: context.tenantId,
      project_id: context.projectId,
      workspace_id: context.workspaceId,
      created_by: context.ownerUserId,
      token_hash: randomUUID().replaceAll("-", ""),
      status: "active",
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      max_uses: 1,
      consent_template_id: context.templateId,
      request_source: "correction",
    });

  assert.ok(invalidCorrectionInviteError);
  assert.equal(invalidCorrectionInviteError.code, "23514");

  const { data: correctionInvite, error: correctionInviteError } = await adminClient
    .from("subject_invites")
    .insert({
      tenant_id: context.tenantId,
      project_id: context.projectId,
      workspace_id: context.workspaceId,
      created_by: context.ownerUserId,
      token_hash: randomUUID().replaceAll("-", ""),
      status: "active",
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      max_uses: 1,
      consent_template_id: context.templateId,
      request_source: "correction",
      correction_opened_at_snapshot: context.correctionOpenedAt,
      correction_source_release_id_snapshot: context.releaseId,
    })
    .select("request_source, correction_opened_at_snapshot, correction_source_release_id_snapshot")
    .single();
  assertNoPostgrestError(correctionInviteError, "insert correction subject invite");
  assert.equal(correctionInvite.request_source, "correction");
  assertSameInstant(correctionInvite.correction_opened_at_snapshot, context.correctionOpenedAt);
  assert.equal(correctionInvite.correction_source_release_id_snapshot, context.releaseId);
});

test("feature 076 recurring request provenance defaults to normal and restricts correction provenance to project requests", async () => {
  const context = await createCorrectionProvenanceContext();

  const { data: baselineRequest, error: baselineRequestError } = await adminClient
    .from("recurring_profile_consent_requests")
    .insert({
      id: randomUUID(),
      tenant_id: context.tenantId,
      profile_id: context.profileId,
      consent_kind: "baseline",
      consent_template_id: context.templateId,
      profile_name_snapshot: "Jordan Miles",
      profile_email_snapshot: `feature076-baseline-${randomUUID()}@example.com`,
      token_hash: randomUUID().replaceAll("-", ""),
      status: "pending",
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      created_by: context.ownerUserId,
    })
    .select("request_source, correction_opened_at_snapshot, correction_source_release_id_snapshot")
    .single();
  assertNoPostgrestError(baselineRequestError, "insert baseline recurring request");
  assert.equal(baselineRequest.request_source, "normal");
  assert.equal(baselineRequest.correction_opened_at_snapshot, null);
  assert.equal(baselineRequest.correction_source_release_id_snapshot, null);

  const { error: invalidBaselineCorrectionError } = await adminClient
    .from("recurring_profile_consent_requests")
    .insert({
      id: randomUUID(),
      tenant_id: context.tenantId,
      profile_id: context.profileId,
      consent_kind: "baseline",
      consent_template_id: context.templateId,
      profile_name_snapshot: "Jordan Miles",
      profile_email_snapshot: `feature076-invalid-baseline-${randomUUID()}@example.com`,
      token_hash: randomUUID().replaceAll("-", ""),
      status: "pending",
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      created_by: context.ownerUserId,
      request_source: "correction",
      correction_opened_at_snapshot: context.correctionOpenedAt,
      correction_source_release_id_snapshot: context.releaseId,
    });

  assert.ok(invalidBaselineCorrectionError);
  assert.equal(invalidBaselineCorrectionError.code, "23514");

  const { error: invalidProjectCorrectionShapeError } = await adminClient
    .from("recurring_profile_consent_requests")
    .insert({
      id: randomUUID(),
      tenant_id: context.tenantId,
      profile_id: context.profileId,
      project_id: context.projectId,
      workspace_id: context.workspaceId,
      consent_kind: "project",
      consent_template_id: context.templateId,
      profile_name_snapshot: "Jordan Miles",
      profile_email_snapshot: `feature076-invalid-project-${randomUUID()}@example.com`,
      token_hash: randomUUID().replaceAll("-", ""),
      status: "pending",
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      created_by: context.ownerUserId,
      request_source: "correction",
    });

  assert.ok(invalidProjectCorrectionShapeError);
  assert.equal(invalidProjectCorrectionShapeError.code, "23514");

  const { data: correctionProjectRequest, error: correctionProjectRequestError } = await adminClient
    .from("recurring_profile_consent_requests")
    .insert({
      id: randomUUID(),
      tenant_id: context.tenantId,
      profile_id: context.profileId,
      project_id: context.projectId,
      workspace_id: context.workspaceId,
      consent_kind: "project",
      consent_template_id: context.templateId,
      profile_name_snapshot: "Jordan Miles",
      profile_email_snapshot: `feature076-project-${randomUUID()}@example.com`,
      token_hash: randomUUID().replaceAll("-", ""),
      status: "pending",
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      created_by: context.ownerUserId,
      request_source: "correction",
      correction_opened_at_snapshot: context.correctionOpenedAt,
      correction_source_release_id_snapshot: context.releaseId,
    })
    .select("request_source, correction_opened_at_snapshot, correction_source_release_id_snapshot")
    .single();
  assertNoPostgrestError(correctionProjectRequestError, "insert correction recurring project request");
  assert.equal(correctionProjectRequest.request_source, "correction");
  assertSameInstant(correctionProjectRequest.correction_opened_at_snapshot, context.correctionOpenedAt);
  assert.equal(correctionProjectRequest.correction_source_release_id_snapshot, context.releaseId);
});
