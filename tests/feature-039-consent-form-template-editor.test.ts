import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { submitConsent } from "../src/lib/consent/submit-consent";
import { HttpError } from "../src/lib/http/errors";
import { createInviteWithIdempotency } from "../src/lib/idempotency/invite-idempotency";
import {
  archiveTenantTemplate,
  createTenantTemplate,
  createTenantTemplateVersion,
  publishTenantTemplate,
  setProjectDefaultTemplate,
  updateDraftTemplate,
} from "../src/lib/templates/template-service";
import { createStarterStructuredFieldsDefinition } from "../src/lib/templates/structured-fields";
import { deriveInviteToken } from "../src/lib/tokens/public-token";
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
  photographerUserId: string;
  photographerClient: SupabaseClient;
  projectId: string;
};

function withScopeOption(optionLabel = "Published media", optionKey = "published_media") {
  const definition = createStarterStructuredFieldsDefinition();
  return {
    ...definition,
    builtInFields: {
      ...definition.builtInFields,
      scope: {
        ...definition.builtInFields.scope,
        options: [
          {
            optionKey,
            label: optionLabel,
            orderIndex: 0,
          },
        ],
      },
    },
  };
}

async function createTenantContext(supabase: SupabaseClient): Promise<TenantContext> {
  const owner = await createAuthUserWithRetry(supabase, "feature039-owner");
  const photographer = await createAuthUserWithRetry(supabase, "feature039-photographer");
  const ownerClient = await signInClient(owner.email, owner.password);
  const photographerClient = await signInClient(photographer.email, photographer.password);

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert({
      name: `Feature 039 Tenant ${randomUUID()}`,
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

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({
      tenant_id: tenant.id,
      created_by: owner.userId,
      name: `Feature 039 Project ${randomUUID()}`,
      description: "Feature 039 template editor integration tests",
      status: "active",
    })
    .select("id")
    .single();
  assertNoPostgrestError(projectError, "insert project");

  return {
    tenantId: tenant.id,
    ownerUserId: owner.userId,
    ownerClient,
    photographerUserId: photographer.userId,
    photographerClient,
    projectId: project.id,
  };
}

test("tenant template lifecycle supports create, publish, versioning, archiving, and project defaults", async () => {
  const context = await createTenantContext(adminClient);

  const created = await createTenantTemplate({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    idempotencyKey: `feature039-create-${randomUUID()}`,
    name: "Campaign Release",
    description: "Initial campaign release template",
    body: "Feature 039 template body version one with enough content to be valid.",
  });

  assert.equal(created.status, 201);
  assert.equal(created.payload.template.status, "draft");
  assert.equal(created.payload.template.version, "v1");

  const updatedDraft = await updateDraftTemplate({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    templateId: created.payload.template.id,
    name: "Campaign Release",
    description: "Updated before first publish",
    body: "Feature 039 published body version one with enough text to satisfy validation.",
    structuredFieldsDefinition: withScopeOption(),
  });
  assert.equal(updatedDraft.status, "draft");

  const publishedV1 = await publishTenantTemplate({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    templateId: created.payload.template.id,
  });
  assert.equal(publishedV1.status, "published");
  assert.equal(publishedV1.version, "v1");

  await setProjectDefaultTemplate({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    projectId: context.projectId,
    templateId: publishedV1.id,
  });

  const { data: projectAfterDefault, error: projectAfterDefaultError } = await adminClient
    .from("projects")
    .select("default_consent_template_id")
    .eq("id", context.projectId)
    .single();
  assertNoPostgrestError(projectAfterDefaultError, "select project default");
  assert.equal(projectAfterDefault.default_consent_template_id, publishedV1.id);

  const versionTwoDraft = await createTenantTemplateVersion({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    idempotencyKey: `feature039-version-two-${randomUUID()}`,
    templateId: publishedV1.id,
  });
  assert.equal(versionTwoDraft.status, 201);
  assert.equal(versionTwoDraft.payload.template.status, "draft");
  assert.equal(versionTwoDraft.payload.template.version, "v2");
  assert.equal(versionTwoDraft.payload.reusedExistingDraft, false);

  const reusedDraft = await createTenantTemplateVersion({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    idempotencyKey: `feature039-version-two-retry-${randomUUID()}`,
    templateId: publishedV1.id,
  });
  assert.equal(reusedDraft.status, 200);
  assert.equal(reusedDraft.payload.template.id, versionTwoDraft.payload.template.id);
  assert.equal(reusedDraft.payload.reusedExistingDraft, true);

  await updateDraftTemplate({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    templateId: versionTwoDraft.payload.template.id,
    name: "Campaign Release",
    description: "Second published version",
    body: "Feature 039 published body version two with material changes for audit coverage.",
    structuredFieldsDefinition: withScopeOption("Published media", "published_media"),
  });

  const publishedV2 = await publishTenantTemplate({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    templateId: versionTwoDraft.payload.template.id,
  });
  assert.equal(publishedV2.status, "published");
  assert.equal(publishedV2.version, "v2");

  const { data: familyRows, error: familyRowsError } = await adminClient
    .from("consent_templates")
    .select("version, status")
    .eq("tenant_id", context.tenantId)
    .eq("template_key", publishedV2.templateKey)
    .order("version_number", { ascending: true });
  assertNoPostgrestError(familyRowsError, "select template family rows");
  assert.deepEqual(familyRows, [
    { version: "v1", status: "archived" },
    { version: "v2", status: "published" },
  ]);

  const archivedV2 = await archiveTenantTemplate({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    templateId: publishedV2.id,
  });
  assert.equal(archivedV2.status, "archived");
});

test("photographers cannot manage tenant templates", async () => {
  const context = await createTenantContext(adminClient);

  await assert.rejects(
    createTenantTemplate({
      supabase: context.photographerClient,
      tenantId: context.tenantId,
      userId: context.photographerUserId,
      idempotencyKey: `feature039-photographer-${randomUUID()}`,
      name: "Photographer Draft",
      description: null,
      body: "Feature 039 photographer body that should be blocked by permissions.",
    }),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 403);
      assert.equal(error.code, "template_management_forbidden");
      return true;
    },
  );
});

test("signed consents keep the published template snapshot after newer versions are published", async () => {
  const context = await createTenantContext(adminClient);

  const created = await createTenantTemplate({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    idempotencyKey: `feature039-snapshot-create-${randomUUID()}`,
    name: "Snapshot Template",
    description: "Snapshot compatibility test",
    body: "Feature 039 snapshot body version one with enough content to pass validation.",
  });

  await updateDraftTemplate({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    templateId: created.payload.template.id,
    name: "Snapshot Template",
    description: "Snapshot compatibility test",
    body: "Feature 039 snapshot body version one with enough content to pass validation.",
    structuredFieldsDefinition: withScopeOption(),
  });

  const publishedV1 = await publishTenantTemplate({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    templateId: created.payload.template.id,
  });

  const inviteIdempotencyKey = `feature039-invite-${randomUUID()}`;
  const inviteResult = await createInviteWithIdempotency({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    userId: context.ownerUserId,
    idempotencyKey: inviteIdempotencyKey,
    consentTemplateId: publishedV1.id,
  });
  assert.equal(inviteResult.status, 201);

  const consent = await submitConsent({
    supabase: context.ownerClient,
    token: deriveInviteToken({
      tenantId: context.tenantId,
      projectId: context.projectId,
      idempotencyKey: inviteIdempotencyKey,
    }),
    fullName: "Feature 039 Subject",
    email: `feature039-subject-${randomUUID()}@example.com`,
    faceMatchOptIn: false,
    headshotAssetId: null,
    structuredFieldValues: {
      scope: ["published_media"],
      duration: "one_year",
    },
    captureIp: null,
    captureUserAgent: "feature-039-test",
  });

  assert.equal(consent.consentVersion, "v1");
  assert.equal(
    consent.consentText,
    "Feature 039 snapshot body version one with enough content to pass validation.",
  );

  const versionTwoDraft = await createTenantTemplateVersion({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    idempotencyKey: `feature039-snapshot-version-${randomUUID()}`,
    templateId: publishedV1.id,
  });

  await updateDraftTemplate({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    templateId: versionTwoDraft.payload.template.id,
    name: "Snapshot Template",
    description: "Snapshot compatibility test",
    body: "Feature 039 snapshot body version two that should not affect the old consent.",
    structuredFieldsDefinition: withScopeOption("Website", "website"),
  });

  await publishTenantTemplate({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    templateId: versionTwoDraft.payload.template.id,
  });

  const { data: consentRow, error: consentRowError } = await adminClient
    .from("consents")
    .select("consent_text, consent_version")
    .eq("id", consent.consentId)
    .single();
  assertNoPostgrestError(consentRowError, "select signed consent");
  assert.equal(consentRow.consent_version, "v1");
  assert.equal(
    consentRow.consent_text,
    "Feature 039 snapshot body version one with enough content to pass validation.",
  );
});
