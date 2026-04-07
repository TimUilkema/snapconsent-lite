import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";

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
import { deriveInviteToken } from "../src/lib/tokens/public-token";

type TenantContext = {
  tenantId: string;
  ownerUserId: string;
  photographerUserId: string;
  projectId: string;
};

function parseDotEnvLine(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function loadEnvFromLocalFile() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  const raw = readFileSync(envPath, "utf8");
  const result = new Map<string, string>();

  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const delimiterIndex = trimmed.indexOf("=");
    if (delimiterIndex <= 0) {
      return;
    }

    const key = trimmed.slice(0, delimiterIndex).trim();
    const value = parseDotEnvLine(trimmed.slice(delimiterIndex + 1));
    result.set(key, value);
  });

  return result;
}

function requireEnv(name: string, envFromFile: Map<string, string>) {
  const runtimeValue = process.env[name];
  if (runtimeValue && runtimeValue.trim().length > 0) {
    return runtimeValue.trim();
  }

  const fileValue = envFromFile.get(name);
  if (fileValue && fileValue.trim().length > 0) {
    return fileValue.trim();
  }

  throw new Error(`Missing required environment variable: ${name}`);
}

function assertNoError(error: PostgrestError | null, context: string) {
  if (!error) {
    return;
  }

  assert.fail(`${context}: ${error.code} ${error.message}`);
}

const envFromFile = loadEnvFromLocalFile();
const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL", envFromFile);
const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY", envFromFile);

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

async function createAuthUserWithRetry(supabase: SupabaseClient, label: string) {
  const maxAttempts = 6;
  const baseDelayMs = 300;
  let lastError: { message?: string; code?: string } | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const email = `${label}-${randomUUID()}@example.com`;
    const password = `SnapConsent-${randomUUID()}-A1!`;
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (!error && data.user?.id) {
      return data.user.id;
    }

    lastError = error;
    if (error?.code !== "unexpected_failure" || attempt === maxAttempts) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, baseDelayMs * attempt));
  }

  assert.fail(
    `Unable to create auth user for tests: ${lastError?.code ?? "unknown"} ${lastError?.message ?? "no error message"}`,
  );
}

async function createTenantContext(supabase: SupabaseClient): Promise<TenantContext> {
  const ownerUserId = await createAuthUserWithRetry(supabase, "feature039-owner");
  const photographerUserId = await createAuthUserWithRetry(supabase, "feature039-photographer");

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert({
      name: `Feature 039 Tenant ${randomUUID()}`,
    })
    .select("id")
    .single();
  assertNoError(tenantError, "insert tenant");

  const { error: membershipError } = await supabase.from("memberships").insert([
    {
      tenant_id: tenant.id,
      user_id: ownerUserId,
      role: "owner",
    },
    {
      tenant_id: tenant.id,
      user_id: photographerUserId,
      role: "photographer",
    },
  ]);
  assertNoError(membershipError, "insert memberships");

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({
      tenant_id: tenant.id,
      created_by: ownerUserId,
      name: `Feature 039 Project ${randomUUID()}`,
      description: "Feature 039 template editor integration tests",
      status: "active",
    })
    .select("id")
    .single();
  assertNoError(projectError, "insert project");

  return {
    tenantId: tenant.id,
    ownerUserId,
    photographerUserId,
    projectId: project.id,
  };
}

test("tenant template lifecycle supports create, publish, versioning, archiving, and project defaults", async () => {
  const context = await createTenantContext(admin);

  const created = await createTenantTemplate({
    supabase: admin,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    idempotencyKey: `feature039-create-${randomUUID()}`,
    name: "Campaign Release",
    description: "Initial campaign release template",
    category: "campaign",
    body: "Feature 039 template body version one with enough content to be valid.",
  });

  assert.equal(created.status, 201);
  assert.equal(created.payload.template.status, "draft");
  assert.equal(created.payload.template.version, "v1");

  const updatedDraft = await updateDraftTemplate({
    supabase: admin,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    templateId: created.payload.template.id,
    name: "Campaign Release",
    description: "Updated before first publish",
    category: "campaign",
    body: "Feature 039 published body version one with enough text to satisfy validation.",
  });
  assert.equal(updatedDraft.status, "draft");

  const publishedV1 = await publishTenantTemplate({
    supabase: admin,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    templateId: created.payload.template.id,
  });
  assert.equal(publishedV1.status, "published");
  assert.equal(publishedV1.version, "v1");

  await setProjectDefaultTemplate({
    supabase: admin,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    projectId: context.projectId,
    templateId: publishedV1.id,
  });

  const { data: projectAfterDefault, error: projectAfterDefaultError } = await admin
    .from("projects")
    .select("default_consent_template_id")
    .eq("id", context.projectId)
    .single();
  assertNoError(projectAfterDefaultError, "select project default");
  assert.equal(projectAfterDefault.default_consent_template_id, publishedV1.id);

  const versionTwoDraft = await createTenantTemplateVersion({
    supabase: admin,
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
    supabase: admin,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    idempotencyKey: `feature039-version-two-retry-${randomUUID()}`,
    templateId: publishedV1.id,
  });
  assert.equal(reusedDraft.status, 200);
  assert.equal(reusedDraft.payload.template.id, versionTwoDraft.payload.template.id);
  assert.equal(reusedDraft.payload.reusedExistingDraft, true);

  await updateDraftTemplate({
    supabase: admin,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    templateId: versionTwoDraft.payload.template.id,
    name: "Campaign Release",
    description: "Second published version",
    category: "campaign",
    body: "Feature 039 published body version two with material changes for audit coverage.",
  });

  const publishedV2 = await publishTenantTemplate({
    supabase: admin,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    templateId: versionTwoDraft.payload.template.id,
  });
  assert.equal(publishedV2.status, "published");
  assert.equal(publishedV2.version, "v2");

  const { data: familyRows, error: familyRowsError } = await admin
    .from("consent_templates")
    .select("version, status")
    .eq("tenant_id", context.tenantId)
    .eq("template_key", publishedV2.templateKey)
    .order("version_number", { ascending: true });
  assertNoError(familyRowsError, "select template family rows");
  assert.deepEqual(familyRows, [
    { version: "v1", status: "archived" },
    { version: "v2", status: "published" },
  ]);

  const archivedV2 = await archiveTenantTemplate({
    supabase: admin,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    templateId: publishedV2.id,
  });
  assert.equal(archivedV2.status, "archived");
});

test("photographers cannot manage tenant templates", async () => {
  const context = await createTenantContext(admin);

  await assert.rejects(
    createTenantTemplate({
      supabase: admin,
      tenantId: context.tenantId,
      userId: context.photographerUserId,
      idempotencyKey: `feature039-photographer-${randomUUID()}`,
      name: "Photographer Draft",
      description: null,
      category: "campaign",
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
  const context = await createTenantContext(admin);

  const created = await createTenantTemplate({
    supabase: admin,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    idempotencyKey: `feature039-snapshot-create-${randomUUID()}`,
    name: "Snapshot Template",
    description: "Snapshot compatibility test",
    category: "standard-adult",
    body: "Feature 039 snapshot body version one with enough content to pass validation.",
  });

  const publishedV1 = await publishTenantTemplate({
    supabase: admin,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    templateId: created.payload.template.id,
  });

  const inviteIdempotencyKey = `feature039-invite-${randomUUID()}`;
  const inviteResult = await createInviteWithIdempotency({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    userId: context.ownerUserId,
    idempotencyKey: inviteIdempotencyKey,
    consentTemplateId: publishedV1.id,
  });
  assert.equal(inviteResult.status, 201);

  const consent = await submitConsent({
    supabase: admin,
    token: deriveInviteToken({
      tenantId: context.tenantId,
      projectId: context.projectId,
      idempotencyKey: inviteIdempotencyKey,
    }),
    fullName: "Feature 039 Subject",
    email: `feature039-subject-${randomUUID()}@example.com`,
    faceMatchOptIn: false,
    headshotAssetId: null,
    captureIp: null,
    captureUserAgent: "feature-039-test",
  });

  assert.equal(consent.consentVersion, "v1");
  assert.equal(
    consent.consentText,
    "Feature 039 snapshot body version one with enough content to pass validation.",
  );

  const versionTwoDraft = await createTenantTemplateVersion({
    supabase: admin,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    idempotencyKey: `feature039-snapshot-version-${randomUUID()}`,
    templateId: publishedV1.id,
  });

  await updateDraftTemplate({
    supabase: admin,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    templateId: versionTwoDraft.payload.template.id,
    name: "Snapshot Template",
    description: "Snapshot compatibility test",
    category: "standard-adult",
    body: "Feature 039 snapshot body version two that should not affect the old consent.",
  });

  await publishTenantTemplate({
    supabase: admin,
    tenantId: context.tenantId,
    userId: context.ownerUserId,
    templateId: versionTwoDraft.payload.template.id,
  });

  const { data: consentRow, error: consentRowError } = await admin
    .from("consents")
    .select("consent_text, consent_version")
    .eq("id", consent.consentId)
    .single();
  assertNoError(consentRowError, "select signed consent");
  assert.equal(consentRow.consent_version, "v1");
  assert.equal(
    consentRow.consent_text,
    "Feature 039 snapshot body version one with enough content to pass validation.",
  );
});
