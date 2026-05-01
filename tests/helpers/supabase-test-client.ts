import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  createClient,
  type AuthError,
  type PostgrestError,
  type SupabaseClient,
} from "@supabase/supabase-js";

type CreatedAuthUser = {
  userId: string;
  email: string;
  password: string;
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

export function assertNoPostgrestError(error: PostgrestError | null, context: string) {
  if (!error) {
    return;
  }

  assert.fail(`${context}: ${error.code} ${error.message}`);
}

export function assertNoAuthError(error: AuthError | null, context: string) {
  if (!error) {
    return;
  }

  assert.fail(`${context}: ${error.code ?? "auth_error"} ${error.message}`);
}

const envFromFile = loadEnvFromLocalFile();
const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL", envFromFile);
const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY", envFromFile);
const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", envFromFile);

export const adminClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

export function createAnonClient() {
  return createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function signInClient(email: string, password: string) {
  const client = createAnonClient();
  const { error } = await client.auth.signInWithPassword({
    email,
    password,
  });
  assertNoAuthError(error, "sign in test client");
  return client;
}

export async function createAuthUserWithRetry(
  supabase: SupabaseClient,
  label: string,
): Promise<CreatedAuthUser> {
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
      return {
        userId: data.user.id,
        email,
        password,
      };
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

export async function getDefaultProjectWorkspaceId(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
) {
  const { data, error } = await supabase
    .from("project_workspaces")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .eq("workspace_kind", "default")
    .maybeSingle();
  assertNoPostgrestError(error, "select default project workspace");
  assert.ok(data?.id, "default project workspace should exist");
  return data.id as string;
}

export async function createPhotographerProjectWorkspace(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  createdBy: string;
  photographerUserId: string;
  name?: string;
}) {
  const { data, error } = await input.supabase
    .from("project_workspaces")
    .insert({
      tenant_id: input.tenantId,
      project_id: input.projectId,
      workspace_kind: "photographer",
      photographer_user_id: input.photographerUserId,
      name: input.name ?? "Photographer workspace",
      created_by: input.createdBy,
    })
    .select("id")
    .single();
  assertNoPostgrestError(error, "insert photographer project workspace");
  assert.ok(data?.id, "photographer project workspace should exist");
  return data.id as string;
}

export async function getSystemRoleDefinitionId(role: "owner" | "admin" | "reviewer" | "photographer") {
  const { data, error } = await adminClient
    .from("role_definitions")
    .select("id")
    .eq("is_system", true)
    .eq("system_role_key", role)
    .single();

  assertNoPostgrestError(error, `select system role ${role}`);
  assert.ok(data?.id, `system role ${role} should exist`);
  return data.id as string;
}

export async function createReviewerRoleAssignment(input: {
  tenantId: string;
  userId: string;
  createdBy: string;
  projectId?: string | null;
}) {
  const roleDefinitionId = await getSystemRoleDefinitionId("reviewer");
  const { data, error } = await adminClient
    .from("role_assignments")
    .insert({
      tenant_id: input.tenantId,
      user_id: input.userId,
      role_definition_id: roleDefinitionId,
      scope_type: input.projectId ? "project" : "tenant",
      project_id: input.projectId ?? null,
      workspace_id: null,
      created_by: input.createdBy,
    })
    .select("id")
    .single();

  assertNoPostgrestError(error, "insert reviewer role assignment");
  assert.ok(data?.id, "reviewer role assignment should exist");
  return data.id as string;
}
