import assert from "node:assert/strict";
import test from "node:test";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "../src/lib/http/errors";
import { ensureTenantId, resolveTenantId } from "../src/lib/tenant/resolve-tenant";

type RpcResponse = {
  data: string | null;
  error: PostgrestError | null;
};

type UserResponse = {
  data: {
    user: { id: string } | null;
  };
  error: Error | null;
};

function createPostgrestError(message: string, code = "XX000"): PostgrestError {
  return {
    message,
    code,
    details: "",
    hint: "",
  };
}

function createSupabaseDouble(input?: {
  currentTenantResponses?: RpcResponse[];
  ensuredTenantResponses?: RpcResponse[];
  userResponses?: UserResponse[];
}) {
  const currentTenantResponses = input?.currentTenantResponses ?? [{ data: "tenant-1", error: null }];
  const ensuredTenantResponses = input?.ensuredTenantResponses ?? [{ data: null, error: null }];
  const userResponses = input?.userResponses ?? [{ data: { user: { id: "user-1" } }, error: null }];
  const stats = {
    currentTenantCalls: 0,
    ensuredTenantCalls: 0,
    getUserCalls: 0,
  };

  function takeResponse<T>(responses: T[], index: number) {
    return responses[Math.min(index, responses.length - 1)]!;
  }

  const supabase = {
    async rpc(name: string) {
      if (name === "current_tenant_id") {
        const response = takeResponse(currentTenantResponses, stats.currentTenantCalls);
        stats.currentTenantCalls += 1;
        return response;
      }

      if (name === "ensure_tenant_for_current_user") {
        const response = takeResponse(ensuredTenantResponses, stats.ensuredTenantCalls);
        stats.ensuredTenantCalls += 1;
        return response;
      }

      throw new Error(`Unexpected rpc call: ${name}`);
    },
    auth: {
      async getUser() {
        const response = takeResponse(userResponses, stats.getUserCalls);
        stats.getUserCalls += 1;
        return response;
      },
    },
  } as unknown as SupabaseClient;

  return {
    supabase,
    stats,
  };
}

test("resolveTenantId returns the current tenant without bootstrap when lookup succeeds", async () => {
  const { supabase, stats } = createSupabaseDouble({
    currentTenantResponses: [{ data: "tenant-current", error: null }],
  });

  const tenantId = await resolveTenantId(supabase);

  assert.equal(tenantId, "tenant-current");
  assert.equal(stats.currentTenantCalls, 1);
  assert.equal(stats.ensuredTenantCalls, 0);
  assert.equal(stats.getUserCalls, 0);
});

test("resolveTenantId falls back to ensure_tenant_for_current_user after a transient lookup error", async () => {
  const { supabase, stats } = createSupabaseDouble({
    currentTenantResponses: [{ data: null, error: createPostgrestError("transient current_tenant_id failure") }],
    ensuredTenantResponses: [{ data: "tenant-bootstrapped", error: null }],
  });

  const tenantId = await resolveTenantId(supabase);

  assert.equal(tenantId, "tenant-bootstrapped");
  assert.equal(stats.currentTenantCalls, 1);
  assert.equal(stats.ensuredTenantCalls, 1);
  assert.equal(stats.getUserCalls, 0);
});

test("resolveTenantId falls back to bootstrap when the first lookup returns null for an authenticated user", async () => {
  const { supabase } = createSupabaseDouble({
    currentTenantResponses: [{ data: null, error: null }],
    ensuredTenantResponses: [{ data: "tenant-created", error: null }],
  });

  const tenantId = await resolveTenantId(supabase);

  assert.equal(tenantId, "tenant-created");
});

test("resolveTenantId retries the current tenant lookup after a failed bootstrap attempt", async () => {
  const { supabase, stats } = createSupabaseDouble({
    currentTenantResponses: [
      { data: null, error: createPostgrestError("first lookup failed") },
      { data: "tenant-retry", error: null },
    ],
    ensuredTenantResponses: [{ data: null, error: createPostgrestError("bootstrap still warming") }],
  });

  const tenantId = await resolveTenantId(supabase);

  assert.equal(tenantId, "tenant-retry");
  assert.equal(stats.currentTenantCalls, 2);
  assert.equal(stats.ensuredTenantCalls, 1);
  assert.equal(stats.getUserCalls, 0);
});

test("resolveTenantId returns null instead of throwing when the user is no longer authenticated", async () => {
  const { supabase, stats } = createSupabaseDouble({
    currentTenantResponses: [{ data: null, error: createPostgrestError("unauthenticated") }],
    ensuredTenantResponses: [{ data: null, error: createPostgrestError("unauthenticated", "42501") }],
    userResponses: [{ data: { user: null }, error: null }],
  });

  const tenantId = await resolveTenantId(supabase);

  assert.equal(tenantId, null);
  assert.equal(stats.currentTenantCalls, 2);
  assert.equal(stats.ensuredTenantCalls, 1);
  assert.equal(stats.getUserCalls, 1);
});

test("resolveTenantId still throws a 500 when an authenticated user cannot resolve a tenant after recovery", async () => {
  const { supabase } = createSupabaseDouble({
    currentTenantResponses: [
      { data: null, error: createPostgrestError("current lookup failed") },
      { data: null, error: createPostgrestError("current retry failed") },
    ],
    ensuredTenantResponses: [{ data: null, error: createPostgrestError("bootstrap failed") }],
    userResponses: [{ data: { user: { id: "user-1" } }, error: null }],
  });

  await assert.rejects(
    () => resolveTenantId(supabase),
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === 500 &&
      error.code === "tenant_lookup_failed",
  );
});

test("ensureTenantId throws a bootstrap error when recovery confirms the request is unauthenticated", async () => {
  const { supabase } = createSupabaseDouble({
    currentTenantResponses: [{ data: null, error: createPostgrestError("unauthenticated", "42501") }],
    ensuredTenantResponses: [{ data: null, error: createPostgrestError("unauthenticated", "42501") }],
    userResponses: [{ data: { user: null }, error: null }],
  });

  await assert.rejects(
    () => ensureTenantId(supabase),
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === 403 &&
      error.code === "tenant_bootstrap_failed",
  );
});
