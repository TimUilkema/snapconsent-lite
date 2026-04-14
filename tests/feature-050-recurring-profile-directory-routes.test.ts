import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { HttpError } from "../src/lib/http/errors";
import {
  handleArchiveRecurringProfilePost,
  handleArchiveRecurringProfileTypePost,
  handleCreateRecurringProfilePost,
  handleCreateRecurringProfileTypePost,
} from "../src/lib/profiles/profile-route-handlers";

function createAuthenticatedClient(userId = randomUUID()) {
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

test("create recurring profile route rejects unauthenticated requests", async () => {
  const response = await handleCreateRecurringProfilePost(
    new Request("http://localhost/api/profiles", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        fullName: "Alex Rivera",
        email: "alex@example.com",
      }),
    }),
    {
      createClient: async () => createUnauthenticatedClient() as never,
      resolveTenantId: async () => "tenant-1",
      createRecurringProfile: async () => {
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

test("create recurring profile route validates request bodies and forwards service payloads", async () => {
  const invalidResponse = await handleCreateRecurringProfilePost(
    new Request("http://localhost/api/profiles", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: "{invalid",
    }),
    {
      createClient: async () => createAuthenticatedClient() as never,
      resolveTenantId: async () => "tenant-1",
      createRecurringProfile: async () => {
        throw new Error("should not be called");
      },
    },
  );

  assert.equal(invalidResponse.status, 400);
  assert.deepEqual(await invalidResponse.json(), {
    error: "invalid_body",
    message: "Invalid request body.",
  });

  let capturedIdempotencyKey = "";
  const successResponse = await handleCreateRecurringProfilePost(
    new Request("http://localhost/api/profiles", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "feature050-route-profile",
      },
      body: JSON.stringify({
        fullName: "Jordan Miles",
        email: "jordan@example.com",
        profileTypeId: "type-1",
      }),
    }),
    {
      createClient: async () => createAuthenticatedClient("user-1") as never,
      resolveTenantId: async () => "tenant-1",
      createRecurringProfile: async (input) => {
        capturedIdempotencyKey = input.idempotencyKey;
        assert.equal(input.tenantId, "tenant-1");
        assert.equal(input.userId, "user-1");
        assert.equal(input.fullName, "Jordan Miles");
        assert.equal(input.email, "jordan@example.com");
        assert.equal(input.profileTypeId, "type-1");

        return {
          status: 201,
          payload: {
            profile: {
              id: "profile-1",
              fullName: "Jordan Miles",
              email: "jordan@example.com",
              status: "active",
              updatedAt: new Date().toISOString(),
              archivedAt: null,
              profileType: null,
            },
          },
        };
      },
    },
  );

  assert.equal(capturedIdempotencyKey, "feature050-route-profile");
  assert.equal(successResponse.status, 201);
  assert.equal((await successResponse.json()).profile.id, "profile-1");
});

test("create recurring profile type route and archive routes shape success and service errors", async () => {
  const createTypeResponse = await handleCreateRecurringProfileTypePost(
    new Request("http://localhost/api/profile-types", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "feature050-route-type",
      },
      body: JSON.stringify({
        label: "Volunteer",
      }),
    }),
    {
      createClient: async () => createAuthenticatedClient("user-2") as never,
      resolveTenantId: async () => "tenant-2",
      createRecurringProfileType: async (input) => {
        assert.equal(input.idempotencyKey, "feature050-route-type");
        assert.equal(input.label, "Volunteer");
        return {
          status: 201,
          payload: {
            profileType: {
              id: "type-1",
              label: "Volunteer",
              status: "active",
              updatedAt: new Date().toISOString(),
              archivedAt: null,
              activeProfileCount: 0,
            },
          },
        };
      },
    },
  );

  assert.equal(createTypeResponse.status, 201);
  assert.equal((await createTypeResponse.json()).profileType.id, "type-1");

  const archiveProfileResponse = await handleArchiveRecurringProfilePost(
    new Request("http://localhost/api/profiles/profile-1/archive", {
      method: "POST",
    }),
    {
      params: Promise.resolve({
        profileId: "profile-1",
      }),
    },
    {
      createClient: async () => createAuthenticatedClient("user-3") as never,
      resolveTenantId: async () => "tenant-3",
      archiveRecurringProfile: async (input) => {
        assert.equal(input.profileId, "profile-1");
        return {
          id: "profile-1",
          fullName: "Alex Rivera",
          email: "alex@example.com",
          status: "archived",
          updatedAt: new Date().toISOString(),
          archivedAt: new Date().toISOString(),
          profileType: null,
        };
      },
    },
  );

  assert.equal(archiveProfileResponse.status, 200);
  assert.equal((await archiveProfileResponse.json()).profile.status, "archived");

  const archiveTypeResponse = await handleArchiveRecurringProfileTypePost(
    new Request("http://localhost/api/profile-types/type-1/archive", {
      method: "POST",
    }),
    {
      params: Promise.resolve({
        profileTypeId: "type-1",
      }),
    },
    {
      createClient: async () => createAuthenticatedClient("user-4") as never,
      resolveTenantId: async () => "tenant-4",
      archiveRecurringProfileType: async () => {
        throw new HttpError(
          403,
          "recurring_profile_management_forbidden",
          "Only workspace owners and admins can manage recurring profiles.",
        );
      },
    },
  );

  assert.equal(archiveTypeResponse.status, 403);
  assert.deepEqual(await archiveTypeResponse.json(), {
    error: "recurring_profile_management_forbidden",
    message: "Only workspace owners and admins can manage recurring profiles.",
  });
});
