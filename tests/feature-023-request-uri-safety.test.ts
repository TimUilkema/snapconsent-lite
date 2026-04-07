import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "../src/lib/http/errors";
import { normalizePostgrestError } from "../src/lib/http/postgrest-error";
import { createAssetWithIdempotency } from "../src/lib/assets/create-asset";
import { finalizeAsset } from "../src/lib/assets/finalize-asset";
import { normalizeSubjectRelation } from "../src/lib/assets/normalize-subject-relation";
import { linkPhotosToConsent, unlinkPhotosFromConsent } from "../src/lib/matching/consent-photo-matching";
import { runChunkedMutation, runChunkedRead } from "../src/lib/supabase/safe-in-filter";
import { submitConsent } from "../src/lib/consent/submit-consent";

type ProjectContext = {
  tenantId: string;
  projectId: string;
  userId: string;
  consentTemplateId: string;
};

function parseDotEnvLine(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
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

async function createAuthUserWithRetry(supabase: SupabaseClient) {
  const maxAttempts = 6;
  let lastError: { message?: string; code?: string } | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const email = `feature023-${randomUUID()}@example.com`;
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

    await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
  }

  assert.fail(
    `Unable to create auth user for tests: ${lastError?.code ?? "unknown"} ${lastError?.message ?? "no error message"}`,
  );
}

async function createProjectContext(supabase: SupabaseClient): Promise<ProjectContext> {
  const userId = await createAuthUserWithRetry(supabase);

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert({ name: `Feature 023 Tenant ${randomUUID()}` })
    .select("id")
    .single();
  assertNoError(tenantError, "insert tenant");

  const { error: membershipError } = await supabase.from("memberships").insert({
    tenant_id: tenant.id,
    user_id: userId,
    role: "owner",
  });
  assertNoError(membershipError, "insert membership");

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({
      tenant_id: tenant.id,
      created_by: userId,
      name: `Feature 023 Project ${randomUUID()}`,
      description: "Feature 023 request-uri safety tests",
      status: "active",
    })
    .select("id")
    .single();
  assertNoError(projectError, "insert project");

  const { data: template, error: templateError } = await supabase
    .from("consent_templates")
    .insert({
      template_key: `feature023-template-${randomUUID()}`,
      name: "Feature 023 Template",
      version: "v1",
      version_number: 1,
      body: "Feature 023 template body",
      status: "published",
      created_by: userId,
    })
    .select("id")
    .single();
  assertNoError(templateError, "insert consent template");

  return {
    tenantId: tenant.id,
    projectId: project.id,
    userId,
    consentTemplateId: template.id,
  };
}

async function createInviteToken(supabase: SupabaseClient, context: ProjectContext) {
  const token = `feature023-invite-${randomUUID()}`;
  const tokenHash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)).then((digest) =>
    Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join(""),
  );

  const { error: inviteError } = await supabase.from("subject_invites").insert({
    tenant_id: context.tenantId,
    project_id: context.projectId,
    created_by: context.userId,
    token_hash: tokenHash,
    status: "active",
    max_uses: 1,
    consent_template_id: context.consentTemplateId,
  });
  assertNoError(inviteError, "insert invite");
  return token;
}

async function createConsent(supabase: SupabaseClient, context: ProjectContext) {
  const token = await createInviteToken(supabase, context);
  const consent = await submitConsent({
    supabase,
    token,
    fullName: "Feature 023 Subject",
    email: `subject-${randomUUID()}@example.com`,
    faceMatchOptIn: false,
    captureIp: null,
    captureUserAgent: "feature-023-test",
  });

  return consent.consentId;
}

test("normalizePostgrestError maps code-less 414 errors to a stable internal code", () => {
  const normalized = normalizePostgrestError({
    message: "URI too long",
    details: "Request-URI Too Large",
  });

  assert.equal(normalized.code, "request_uri_too_large");
  assert.equal(normalized.httpStatus, 414);
  assert.equal(normalized.message, "URI too long");
});

test("runChunkedRead merges chunk results and runChunkedMutation fails closed", async () => {
  const readResult = await runChunkedRead([1, 2, 2, 3, 4], async (chunk) => chunk.map((value) => value * 10), 2);
  assert.deepEqual(readResult, [10, 20, 30, 40]);

  const executedChunks: string[] = [];
  await assert.rejects(
    async () => {
      await runChunkedMutation(
        [1, 2, 3, 4, 5],
        async (chunk) => {
          executedChunks.push(chunk.join(","));
          if (chunk.includes(3)) {
            throw new Error("boom");
          }
        },
        2,
      );
    },
    /boom/,
  );
  assert.deepEqual(executedChunks, ["1,2", "3,4"]);
});

test("normalizeSubjectRelation preserves object and array subject relations for people labels", () => {
  assert.deepEqual(normalizeSubjectRelation(null), null);
  assert.deepEqual(normalizeSubjectRelation([]), null);
  assert.deepEqual(
    normalizeSubjectRelation({
      email: "person@example.com",
      full_name: "Person Name",
    }),
    {
      email: "person@example.com",
      full_name: "Person Name",
    },
  );
  assert.deepEqual(
    normalizeSubjectRelation([
      {
        email: "array@example.com",
        full_name: "Array Person",
      },
    ]),
    {
      email: "array@example.com",
      full_name: "Array Person",
    },
  );
});

test("createAssetWithIdempotency rejects oversized consent arrays", async () => {
  await assert.rejects(
    async () => {
      await createAssetWithIdempotency({
        supabase: {} as SupabaseClient,
        tenantId: randomUUID(),
        projectId: randomUUID(),
        userId: randomUUID(),
        idempotencyKey: randomUUID(),
        originalFilename: "test.jpg",
        contentType: "image/jpeg",
        fileSizeBytes: 2048,
        consentIds: Array.from({ length: 51 }, () => randomUUID()),
        duplicatePolicy: "upload_anyway",
      });
    },
    (error: unknown) => error instanceof HttpError && error.code === "invalid_consent_ids_too_large",
  );
});

test("finalizeAsset rejects oversized consent arrays", async () => {
  await assert.rejects(
    async () => {
      await finalizeAsset({
        supabase: {} as SupabaseClient,
        tenantId: randomUUID(),
        projectId: randomUUID(),
        assetId: randomUUID(),
        consentIds: Array.from({ length: 51 }, () => randomUUID()),
      });
    },
    (error: unknown) => error instanceof HttpError && error.code === "invalid_consent_ids_too_large",
  );
});

test("manual link and unlink reject oversized asset arrays", async () => {
  const context = await createProjectContext(admin);
  const consentId = await createConsent(admin, context);
  const oversizedAssetIds = Array.from({ length: 101 }, () => randomUUID());

  await assert.rejects(
    async () => {
      await linkPhotosToConsent({
        supabase: admin,
        tenantId: context.tenantId,
        projectId: context.projectId,
        consentId,
        assetIds: oversizedAssetIds,
      });
    },
    (error: unknown) => error instanceof HttpError && error.code === "invalid_asset_ids_too_large",
  );

  await assert.rejects(
    async () => {
      await unlinkPhotosFromConsent({
        supabase: admin,
        tenantId: context.tenantId,
        projectId: context.projectId,
        consentId,
        assetIds: oversizedAssetIds,
      });
    },
    (error: unknown) => error instanceof HttpError && error.code === "invalid_asset_ids_too_large",
  );
});
