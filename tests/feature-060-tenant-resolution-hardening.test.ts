import assert from "node:assert/strict";
import test from "node:test";

import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "../src/lib/http/errors";
import { ensureTenantId, resolveTenantId } from "../src/lib/tenant/resolve-tenant";

type RpcResponse = {
  data: string | null;
  error: PostgrestError | null;
};

type MembershipResponse = {
  memberships: Array<{
    tenant_id: string;
    created_at: string;
  }>;
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
  authenticatedUserId?: string | null;
  ensuredTenantResponses?: RpcResponse[];
  userResponses?: UserResponse[];
  membershipResponses?: MembershipResponse[];
  cookies?: {
    activeTenantId?: string | null;
    pendingOrgInviteToken?: string | null;
  };
}) {
  const ensuredTenantResponses = input?.ensuredTenantResponses ?? [{ data: null, error: null }];
  const userResponses = input?.userResponses ?? [{ data: { user: { id: "user-1" } }, error: null }];
  const membershipResponses = input?.membershipResponses ?? [
    {
      memberships: [{ tenant_id: "tenant-1", created_at: "2026-04-22T08:00:00.000Z" }],
      error: null,
    },
  ];
  const stats = {
    membershipCalls: 0,
    ensuredTenantCalls: 0,
    getUserCalls: 0,
    loadCookieCalls: 0,
    pendingInviteValidationCalls: 0,
    membershipUserIds: [] as string[],
  };

  function takeResponse<T>(responses: T[], index: number) {
    return responses[Math.min(index, responses.length - 1)]!;
  }

  const supabase = {
    async rpc(name: string) {
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

  const trustedAuthenticatedUserId = input?.authenticatedUserId === undefined
    ? "user-1"
    : input.authenticatedUserId;
  const dependencies = {
    ...(trustedAuthenticatedUserId ? { authenticatedUserId: trustedAuthenticatedUserId } : {}),
    async loadMemberships(_supabase: SupabaseClient, authenticatedUserId: string) {
      stats.membershipUserIds.push(authenticatedUserId);
      const response = takeResponse(membershipResponses, stats.membershipCalls);
      stats.membershipCalls += 1;
      return response;
    },
    async loadEnsuredTenantId() {
      const response = takeResponse(ensuredTenantResponses, stats.ensuredTenantCalls);
      stats.ensuredTenantCalls += 1;
      return {
        tenantId: response.data,
        error: response.error,
      };
    },
    async loadAuthenticatedUserId() {
      const response = takeResponse(userResponses, stats.getUserCalls);
      stats.getUserCalls += 1;
      return !response.error && response.data.user ? response.data.user.id : null;
    },
    async loadTenantCookies() {
      stats.loadCookieCalls += 1;
      return {
        activeTenantId: input?.cookies?.activeTenantId ?? null,
        pendingOrgInviteToken: input?.cookies?.pendingOrgInviteToken ?? null,
      };
    },
    async validatePendingOrgInviteToken(_supabase: SupabaseClient, token: string) {
      stats.pendingInviteValidationCalls += 1;
      return token !== "stale-join-token";
    },
  };

  return {
    supabase,
    dependencies,
    stats,
  };
}

test("resolveTenantId returns the only membership without requiring an active tenant cookie", async () => {
  const { supabase, dependencies, stats } = createSupabaseDouble({
    membershipResponses: [
      {
        memberships: [{ tenant_id: "tenant-current", created_at: "2026-04-22T08:00:00.000Z" }],
        error: null,
      },
    ],
  });

  const tenantId = await resolveTenantId(supabase, dependencies);

  assert.equal(tenantId, "tenant-current");
  assert.equal(stats.membershipCalls, 1);
  assert.deepEqual(stats.membershipUserIds, ["user-1"]);
  assert.equal(stats.ensuredTenantCalls, 0);
  assert.equal(stats.getUserCalls, 0);
});

test("resolveTenantId passes trusted authenticated user id into membership lookup without calling auth.getUser", async () => {
  const { supabase, dependencies, stats } = createSupabaseDouble({
    authenticatedUserId: "user-trusted",
    membershipResponses: [
      {
        memberships: [{ tenant_id: "tenant-current", created_at: "2026-04-22T08:00:00.000Z" }],
        error: null,
      },
    ],
  });

  const tenantId = await resolveTenantId(supabase, dependencies);

  assert.equal(tenantId, "tenant-current");
  assert.deepEqual(stats.membershipUserIds, ["user-trusted"]);
  assert.equal(stats.getUserCalls, 0);
});

test("resolveTenantId derives authenticated user id when no trusted id is provided", async () => {
  const { supabase, dependencies, stats } = createSupabaseDouble({
    authenticatedUserId: null,
    userResponses: [{ data: { user: { id: "user-derived" } }, error: null }],
    membershipResponses: [
      {
        memberships: [{ tenant_id: "tenant-current", created_at: "2026-04-22T08:00:00.000Z" }],
        error: null,
      },
    ],
  });

  const tenantId = await resolveTenantId(supabase, dependencies);

  assert.equal(tenantId, "tenant-current");
  assert.deepEqual(stats.membershipUserIds, ["user-derived"]);
  assert.equal(stats.getUserCalls, 1);
});

test("resolveTenantId uses the active tenant cookie when a user belongs to multiple workspaces", async () => {
  const { supabase, dependencies } = createSupabaseDouble({
    membershipResponses: [
      {
        memberships: [
          { tenant_id: "tenant-a", created_at: "2026-04-22T08:00:00.000Z" },
          { tenant_id: "tenant-b", created_at: "2026-04-22T08:05:00.000Z" },
        ],
        error: null,
      },
    ],
    cookies: {
      activeTenantId: "tenant-b",
    },
  });

  const tenantId = await resolveTenantId(supabase, dependencies);

  assert.equal(tenantId, "tenant-b");
});

test("resolveTenantId requires explicit tenant selection when a user has multiple memberships and no valid cookie", async () => {
  const { supabase, dependencies } = createSupabaseDouble({
    membershipResponses: [
      {
        memberships: [
          { tenant_id: "tenant-a", created_at: "2026-04-22T08:00:00.000Z" },
          { tenant_id: "tenant-b", created_at: "2026-04-22T08:05:00.000Z" },
        ],
        error: null,
      },
    ],
  });

  await assert.rejects(
    () => resolveTenantId(supabase, dependencies),
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === 409 &&
      error.code === "active_tenant_required",
  );
});

test("resolveTenantId ignores stale active tenant cookie for a single current-user membership", async () => {
  const { supabase, dependencies } = createSupabaseDouble({
    membershipResponses: [
      {
        memberships: [{ tenant_id: "tenant-current", created_at: "2026-04-22T08:00:00.000Z" }],
        error: null,
      },
    ],
    cookies: {
      activeTenantId: "tenant-stale",
    },
  });

  const tenantId = await resolveTenantId(supabase, dependencies);

  assert.equal(tenantId, "tenant-current");
});

test("resolveTenantId routes authenticated users with no memberships to organization setup", async () => {
  const { supabase, dependencies, stats } = createSupabaseDouble({
    membershipResponses: [
      { memberships: [], error: null },
    ],
    ensuredTenantResponses: [{ data: "tenant-bootstrapped", error: null }],
  });

  await assert.rejects(
    () => resolveTenantId(supabase, dependencies),
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === 409 &&
      error.code === "organization_setup_required",
  );

  assert.equal(stats.membershipCalls, 1);
  assert.equal(stats.ensuredTenantCalls, 0);
});

test("resolveTenantId can still use explicit bootstrap recovery for no-membership users", async () => {
  const { supabase, dependencies, stats } = createSupabaseDouble({
    membershipResponses: [
      { memberships: [], error: null },
    ],
    ensuredTenantResponses: [{ data: "tenant-bootstrapped", error: null }],
  });

  const tenantId = await resolveTenantId(supabase, {
    ...dependencies,
    missingMembershipBehavior: "bootstrap",
  });

  assert.equal(tenantId, "tenant-bootstrapped");
  assert.equal(stats.membershipCalls, 1);
  assert.equal(stats.ensuredTenantCalls, 1);
});

test("resolveTenantId blocks bootstrap when an invited onboarding cookie is present", async () => {
  const { supabase, dependencies, stats } = createSupabaseDouble({
    membershipResponses: [
      { memberships: [], error: null },
    ],
    cookies: {
      pendingOrgInviteToken: "join-token-1",
    },
  });

  await assert.rejects(
    () => resolveTenantId(supabase, dependencies),
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === 409 &&
      error.code === "pending_org_invite_acceptance_required",
  );

  assert.equal(stats.ensuredTenantCalls, 0);
  assert.equal(stats.pendingInviteValidationCalls, 1);
});

test("resolveTenantId ignores a stale invited onboarding cookie when the invite is no longer usable", async () => {
  const { supabase, dependencies, stats } = createSupabaseDouble({
    membershipResponses: [
      { memberships: [], error: null },
    ],
    cookies: {
      pendingOrgInviteToken: "stale-join-token",
    },
  });

  await assert.rejects(
    () => resolveTenantId(supabase, dependencies),
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === 409 &&
      error.code === "organization_setup_required",
  );

  assert.equal(stats.ensuredTenantCalls, 0);
  assert.equal(stats.pendingInviteValidationCalls, 1);
});

test("resolveTenantId retries membership lookup after a failed bootstrap attempt", async () => {
  const { supabase, dependencies, stats } = createSupabaseDouble({
    membershipResponses: [
      { memberships: [], error: createPostgrestError("initial membership lookup failed") },
      {
        memberships: [{ tenant_id: "tenant-retry", created_at: "2026-04-22T08:00:00.000Z" }],
        error: null,
      },
    ],
    ensuredTenantResponses: [{ data: null, error: createPostgrestError("bootstrap still warming") }],
  });

  const tenantId = await resolveTenantId(supabase, {
    ...dependencies,
    missingMembershipBehavior: "bootstrap",
  });

  assert.equal(tenantId, "tenant-retry");
  assert.equal(stats.membershipCalls, 2);
  assert.equal(stats.ensuredTenantCalls, 1);
});

test("resolveTenantId returns null instead of throwing when the user is no longer authenticated", async () => {
  const { supabase, dependencies, stats } = createSupabaseDouble({
    authenticatedUserId: null,
    membershipResponses: [
      { memberships: [], error: createPostgrestError("membership lookup failed") },
      { memberships: [], error: createPostgrestError("membership retry failed") },
    ],
    ensuredTenantResponses: [{ data: null, error: createPostgrestError("bootstrap failed", "42501") }],
    userResponses: [{ data: { user: null }, error: null }],
  });

  const tenantId = await resolveTenantId(supabase, dependencies);

  assert.equal(tenantId, null);
  assert.equal(stats.membershipCalls, 0);
  assert.equal(stats.ensuredTenantCalls, 0);
  assert.equal(stats.getUserCalls, 1);
});

test("resolveTenantId still throws a 500 when an authenticated user cannot resolve a tenant after recovery", async () => {
  const { supabase, dependencies } = createSupabaseDouble({
    membershipResponses: [
      { memberships: [], error: createPostgrestError("membership lookup failed") },
      { memberships: [], error: createPostgrestError("membership retry failed") },
    ],
    ensuredTenantResponses: [{ data: null, error: createPostgrestError("bootstrap failed") }],
    userResponses: [{ data: { user: { id: "user-1" } }, error: null }],
  });

  await assert.rejects(
    () => resolveTenantId(supabase, dependencies),
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === 500 &&
      error.code === "tenant_lookup_failed",
  );
});

test("ensureTenantId propagates active-tenant-required failures for multi-workspace users", async () => {
  const { supabase, dependencies } = createSupabaseDouble({
    membershipResponses: [
      {
        memberships: [
          { tenant_id: "tenant-a", created_at: "2026-04-22T08:00:00.000Z" },
          { tenant_id: "tenant-b", created_at: "2026-04-22T08:05:00.000Z" },
        ],
        error: null,
      },
    ],
  });

  await assert.rejects(
    () => ensureTenantId(supabase, dependencies),
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === 409 &&
      error.code === "active_tenant_required",
  );
});
