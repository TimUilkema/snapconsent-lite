import assert from "node:assert/strict";
import test from "node:test";

import { handleSetActiveTenantPost } from "../src/lib/tenant/active-tenant-route-handler";

function createAuthenticatedClient(userId = "user-1") {
  return {
    auth: {
      getUser: async () => ({
        data: {
          user: {
            id: userId,
          },
        },
      }),
    },
  };
}

function createUnauthenticatedClient() {
  return {
    auth: {
      getUser: async () => ({
        data: {
          user: null,
        },
      }),
    },
  };
}

test("active tenant route redirects unauthenticated users to login", async () => {
  const request = new Request("http://localhost/api/tenants/active", {
    method: "POST",
    body: new URLSearchParams({
      tenant_id: "tenant-1",
      error_redirect: "/select-tenant",
    }),
  });

  const response = await handleSetActiveTenantPost(request, {
    createClient: async () => createUnauthenticatedClient() as never,
  });

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/login?next=%2Fselect-tenant");
});

test("active tenant route rejects workspace selections the user does not belong to", async () => {
  const request = new Request("http://localhost/api/tenants/active", {
    method: "POST",
    body: new URLSearchParams({
      tenant_id: "tenant-2",
      error_redirect: "/select-tenant",
      next: "/projects",
    }),
  });

  const response = await handleSetActiveTenantPost(request, {
    createClient: async () => createAuthenticatedClient("user-1") as never,
    currentUserHasTenantMembership: async (_supabase, userId, tenantId) => {
      assert.equal(userId, "user-1");
      assert.equal(tenantId, "tenant-2");
      return false;
    },
  });

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/select-tenant?error=invalid_selection");
});

test("active tenant route sets the cookie for valid workspace selections", async () => {
  const request = new Request("http://localhost/api/tenants/active", {
    method: "POST",
    body: new URLSearchParams({
      tenant_id: "tenant-3",
      error_redirect: "/select-tenant",
      next: "/projects",
    }),
  });

  const response = await handleSetActiveTenantPost(request, {
    createClient: async () => createAuthenticatedClient("user-9") as never,
    currentUserHasTenantMembership: async (_supabase, userId, tenantId) => {
      assert.equal(userId, "user-9");
      assert.equal(tenantId, "tenant-3");
      return true;
    },
  });

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/projects");
  assert.match(response.headers.get("set-cookie") ?? "", /sc_active_tenant=tenant-3/);
});
