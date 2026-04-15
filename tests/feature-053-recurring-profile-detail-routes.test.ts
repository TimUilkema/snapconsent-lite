import assert from "node:assert/strict";
import test from "node:test";

import {
  handleGetRecurringProfileDetail,
} from "../src/lib/profiles/profile-route-handlers";

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

test("recurring profile detail route rejects unauthenticated requests", async () => {
  const response = await handleGetRecurringProfileDetail(
    new Request("http://localhost/api/profiles/profile-1/detail", {
      method: "GET",
    }),
    {
      params: Promise.resolve({
        profileId: "profile-1",
      }),
    },
    {
      createClient: async () => createUnauthenticatedClient() as never,
      resolveTenantId: async () => "tenant-1",
      getRecurringProfileDetailPanelData: async () => {
        throw new Error("should not be called");
      },
    },
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: "unauthenticated",
    message: "Authentication required.",
  });
});

test("recurring profile detail route forwards params and payloads", async () => {
  const response = await handleGetRecurringProfileDetail(
    new Request("http://localhost/api/profiles/profile-1/detail", {
      method: "GET",
    }),
    {
      params: Promise.resolve({
        profileId: "profile-1",
      }),
    },
    {
      createClient: async () => createAuthenticatedClient("user-1") as never,
      resolveTenantId: async () => "tenant-1",
      getRecurringProfileDetailPanelData: async (input) => {
        assert.equal(input.tenantId, "tenant-1");
        assert.equal(input.userId, "user-1");
        assert.equal(input.profileId, "profile-1");

        return {
          profile: {
            id: "profile-1",
            fullName: "Jordan Miles",
          },
        };
      },
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    detail: {
      profile: {
        id: "profile-1",
        fullName: "Jordan Miles",
      },
    },
  });
});
