import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import { submitConsent } from "../src/lib/consent/submit-consent";
import { createInviteWithIdempotency } from "../src/lib/idempotency/invite-idempotency";
import { createProjectConsentUpgradeRequest } from "../src/lib/projects/project-consent-upgrade-service";
import {
  createTenantTemplate,
  createTenantTemplateVersion,
  publishTenantTemplate,
  updateDraftTemplate,
} from "../src/lib/templates/template-service";
import {
  createStarterStructuredFieldsDefinition,
  type StructuredFieldsDefinition,
} from "../src/lib/templates/structured-fields";
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
  projectId: string;
};

function buildStructuredDefinition(extraScopeKey?: string): StructuredFieldsDefinition {
  const starter = createStarterStructuredFieldsDefinition();
  const scopeOptions = [
    {
      optionKey: "email",
      label: "Email",
      orderIndex: 0,
    },
    {
      optionKey: "social_media",
      label: "Social media",
      orderIndex: 1,
    },
  ];

  if (extraScopeKey) {
    scopeOptions.push({
      optionKey: extraScopeKey,
      label: extraScopeKey === "linkedin" ? "LinkedIn" : extraScopeKey,
      orderIndex: scopeOptions.length,
    });
  }

  return {
    ...starter,
    builtInFields: {
      ...starter.builtInFields,
      scope: {
        ...starter.builtInFields.scope,
        options: scopeOptions,
      },
    },
  };
}

async function createTenantContext(supabase: SupabaseClient): Promise<TenantContext> {
  let owner: Awaited<ReturnType<typeof createAuthUserWithRetry>> | null = null;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      owner = await createAuthUserWithRetry(supabase, "feature067-owner");
      break;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }

  if (!owner) {
    throw lastError instanceof Error ? lastError : new Error("Unable to create feature 067 auth user.");
  }

  const ownerClient = await signInClient(owner.email, owner.password);

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert({
      name: `Feature 067 Tenant ${randomUUID()}`,
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

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({
      tenant_id: tenant.id,
      created_by: owner.userId,
      name: `Feature 067 Project ${randomUUID()}`,
      description: "Consent upgrade foundation tests",
      status: "active",
    })
    .select("id")
    .single();
  assertNoPostgrestError(projectError, "insert project");

  return {
    tenantId: tenant.id,
    ownerUserId: owner.userId,
    ownerClient,
    projectId: project.id,
  };
}

async function publishStructuredTemplateVersion(
  context: TenantContext,
  name: string,
  definition: StructuredFieldsDefinition,
) {
  const created = await createTenantTemplate({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    idempotencyKey: `feature067-template-${randomUUID()}`,
    name,
    description: null,
    body: "This is a sufficiently long consent body for upgrade testing.",
  });

  await updateDraftTemplate({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    templateId: created.payload.template.id,
    name,
    description: null,
    body: "This is a sufficiently long consent body for upgrade testing.",
    structuredFieldsDefinition: definition,
  });

  const published = await publishTenantTemplate({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    templateId: created.payload.template.id,
  });

  return published;
}

async function publishNextTemplateVersion(
  context: TenantContext,
  priorTemplateId: string,
  definition: StructuredFieldsDefinition,
) {
  const version = await createTenantTemplateVersion({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    idempotencyKey: `feature067-template-version-${randomUUID()}`,
    templateId: priorTemplateId,
  });

  await updateDraftTemplate({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    templateId: version.payload.template.id,
    name: version.payload.template.name,
    description: null,
    body: "This is a sufficiently long consent body for upgrade testing.",
    structuredFieldsDefinition: definition,
  });

  const published = await publishTenantTemplate({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    templateId: version.payload.template.id,
  });

  return published;
}

test("one-off consent upgrade request reuses standard invite transport and marks completion on new signing", async () => {
  const context = await createTenantContext(adminClient);
  const v1 = await publishStructuredTemplateVersion(context, "Media Release", buildStructuredDefinition());

  const initialInviteIdempotencyKey = `feature067-initial-invite-${randomUUID()}`;
  await createInviteWithIdempotency({
    supabase: adminClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    userId: context.ownerUserId,
    idempotencyKey: initialInviteIdempotencyKey,
    consentTemplateId: v1.id,
  });

  const initialToken = deriveInviteToken({
    tenantId: context.tenantId,
    projectId: context.projectId,
    idempotencyKey: initialInviteIdempotencyKey,
  });

  const initialSubmission = await submitConsent({
    supabase: adminClient,
    token: initialToken,
    fullName: "Jordan Miles",
    email: "jordan@example.com",
    faceMatchOptIn: false,
    headshotAssetId: null,
    structuredFieldValues: {
      scope: ["email"],
      duration: "one_year",
    },
    captureIp: null,
    captureUserAgent: "feature067-test",
  });

  const v2 = await publishNextTemplateVersion(context, v1.id, buildStructuredDefinition("linkedin"));

  const upgradeCreate = await createProjectConsentUpgradeRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    projectId: context.projectId,
    consentId: initialSubmission.consentId,
    targetTemplateId: v2.id,
    idempotencyKey: `feature067-upgrade-${randomUUID()}`,
  });

  assert.equal(upgradeCreate.status, 201);
  assert.match(upgradeCreate.payload.request.invitePath, /^\/i\//);
  assert.equal(upgradeCreate.payload.request.targetTemplateId, v2.id);
  assert.equal(upgradeCreate.payload.request.targetTemplateKey, v2.templateKey);

  const replayCreate = await createProjectConsentUpgradeRequest({
    supabase: context.ownerClient,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    projectId: context.projectId,
    consentId: initialSubmission.consentId,
    targetTemplateId: v2.id,
    idempotencyKey: `feature067-upgrade-replay-${randomUUID()}`,
  });

  assert.equal(replayCreate.status, 200);
  assert.equal(replayCreate.payload.request.id, upgradeCreate.payload.request.id);
  assert.equal(replayCreate.payload.request.invitePath, upgradeCreate.payload.request.invitePath);

  const upgradeToken = upgradeCreate.payload.request.invitePath.replace(/^\/i\//, "");
  const upgradedSubmission = await submitConsent({
    supabase: adminClient,
    token: upgradeToken,
    fullName: "Jordan Miles",
    email: "jordan@example.com",
    faceMatchOptIn: false,
    headshotAssetId: null,
    structuredFieldValues: {
      scope: ["email", "linkedin"],
      duration: "one_year",
    },
    captureIp: null,
    captureUserAgent: "feature067-test-upgrade",
  });

  assert.notEqual(upgradedSubmission.consentId, initialSubmission.consentId);

  const { data: upgradeRequest, error: upgradeRequestError } = await adminClient
    .from("project_consent_upgrade_requests")
    .select("id, status, prior_consent_id, completed_consent_id, invite_id")
    .eq("tenant_id", context.tenantId)
    .eq("id", upgradeCreate.payload.request.id)
    .maybeSingle();
  assertNoPostgrestError(upgradeRequestError, "select signed upgrade request");
  assert.equal(upgradeRequest?.status, "signed");
  assert.equal(upgradeRequest?.prior_consent_id, initialSubmission.consentId);
  assert.equal(upgradeRequest?.completed_consent_id, upgradedSubmission.consentId);

  const { data: subjectConsents, error: subjectConsentsError } = await adminClient
    .from("consents")
    .select("id, subject_id")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .in("id", [initialSubmission.consentId, upgradedSubmission.consentId]);
  assertNoPostgrestError(subjectConsentsError, "select subject consents");
  assert.equal(subjectConsents?.length, 2);
  assert.equal(subjectConsents?.[0]?.subject_id, subjectConsents?.[1]?.subject_id);
});
