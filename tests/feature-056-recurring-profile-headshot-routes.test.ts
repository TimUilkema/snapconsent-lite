import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../src/lib/http/errors";
import {
  handleCreateRecurringProfileHeadshotPost,
  handleFinalizeRecurringProfileHeadshotPost,
  handleSelectRecurringProfileHeadshotFacePost,
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

test("recurring profile headshot create route requires auth and validates request bodies", async () => {
  const unauthenticatedResponse = await handleCreateRecurringProfileHeadshotPost(
    new Request("http://localhost/api/profiles/profile-1/headshot", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        originalFilename: "portrait.jpg",
        contentType: "image/jpeg",
        fileSizeBytes: 1234,
      }),
    }),
    {
      params: Promise.resolve({
        profileId: "profile-1",
      }),
    },
    {
      createClient: async () => createUnauthenticatedClient() as never,
      resolveTenantId: async () => "tenant-1",
      createRecurringProfileHeadshotUpload: async () => {
        throw new Error("should not be called");
      },
    },
  );

  assert.equal(unauthenticatedResponse.status, 401);
  assert.deepEqual(await unauthenticatedResponse.json(), {
    error: "unauthenticated",
    message: "Authentication required.",
  });

  const invalidBodyResponse = await handleCreateRecurringProfileHeadshotPost(
    new Request("http://localhost/api/profiles/profile-1/headshot", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: "{invalid",
    }),
    {
      params: Promise.resolve({
        profileId: "profile-1",
      }),
    },
    {
      createClient: async () => createAuthenticatedClient() as never,
      resolveTenantId: async () => "tenant-1",
      createRecurringProfileHeadshotUpload: async () => {
        throw new Error("should not be called");
      },
    },
  );

  assert.equal(invalidBodyResponse.status, 400);
  assert.deepEqual(await invalidBodyResponse.json(), {
    error: "invalid_body",
    message: "Invalid request body.",
  });
});

test("recurring profile headshot routes forward tenant, user, params, and service payloads", async () => {
  const createResponse = await handleCreateRecurringProfileHeadshotPost(
    new Request("http://localhost/api/profiles/profile-1/headshot", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "feature056-headshot-create",
      },
      body: JSON.stringify({
        originalFilename: "portrait.jpg",
        contentType: "image/jpeg",
        fileSizeBytes: 1234,
      }),
    }),
    {
      params: Promise.resolve({
        profileId: "profile-1",
      }),
    },
    {
      createClient: async () => createAuthenticatedClient("user-1") as never,
      resolveTenantId: async () => "tenant-1",
      createRecurringProfileHeadshotUpload: async (input) => {
        assert.equal(input.tenantId, "tenant-1");
        assert.equal(input.userId, "user-1");
        assert.equal(input.profileId, "profile-1");
        assert.equal(input.idempotencyKey, "feature056-headshot-create");
        assert.equal(input.originalFilename, "portrait.jpg");
        assert.equal(input.contentType, "image/jpeg");
        assert.equal(input.fileSizeBytes, 1234);

        return {
          status: 201,
          payload: {
            headshotId: "headshot-1",
            signedUrl: "https://example.test/upload",
          },
        };
      },
    },
  );

  assert.equal(createResponse.status, 201);
  assert.equal((await createResponse.json()).headshotId, "headshot-1");

  const finalizeResponse = await handleFinalizeRecurringProfileHeadshotPost(
    new Request("http://localhost/api/profiles/profile-1/headshot/headshot-1/finalize", {
      method: "POST",
    }),
    {
      params: Promise.resolve({
        profileId: "profile-1",
        headshotId: "headshot-1",
      }),
    },
    {
      createClient: async () => createAuthenticatedClient("user-2") as never,
      resolveTenantId: async () => "tenant-2",
      finalizeRecurringProfileHeadshotUpload: async (input) => {
        assert.equal(input.tenantId, "tenant-2");
        assert.equal(input.userId, "user-2");
        assert.equal(input.profileId, "profile-1");
        assert.equal(input.headshotId, "headshot-1");

        return {
          materializationDeferred: true,
        };
      },
    },
  );

  assert.equal(finalizeResponse.status, 200);
  assert.equal((await finalizeResponse.json()).materializationDeferred, true);

  const selectFaceResponse = await handleSelectRecurringProfileHeadshotFacePost(
    new Request("http://localhost/api/profiles/profile-1/headshot/headshot-1/select-face", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        faceId: "face-1",
      }),
    }),
    {
      params: Promise.resolve({
        profileId: "profile-1",
        headshotId: "headshot-1",
      }),
    },
    {
      createClient: async () => createAuthenticatedClient("user-3") as never,
      resolveTenantId: async () => "tenant-3",
      selectRecurringProfileHeadshotFace: async (input) => {
        assert.equal(input.tenantId, "tenant-3");
        assert.equal(input.userId, "user-3");
        assert.equal(input.profileId, "profile-1");
        assert.equal(input.headshotId, "headshot-1");
        assert.equal(input.faceId, "face-1");

        return {
          state: "ready",
        };
      },
    },
  );

  assert.equal(selectFaceResponse.status, 200);
  assert.equal((await selectFaceResponse.json()).readiness.state, "ready");
});

test("recurring profile headshot finalize and select routes serialize service errors", async () => {
  const finalizeResponse = await handleFinalizeRecurringProfileHeadshotPost(
    new Request("http://localhost/api/profiles/profile-1/headshot/headshot-1/finalize", {
      method: "POST",
    }),
    {
      params: Promise.resolve({
        profileId: "profile-1",
        headshotId: "headshot-1",
      }),
    },
    {
      createClient: async () => createAuthenticatedClient() as never,
      resolveTenantId: async () => "tenant-1",
      finalizeRecurringProfileHeadshotUpload: async () => {
        throw new HttpError(
          409,
          "recurring_profile_face_match_not_opted_in",
          "Recurring profile headshots require active matching authorization.",
        );
      },
    },
  );

  assert.equal(finalizeResponse.status, 409);
  assert.deepEqual(await finalizeResponse.json(), {
    error: "recurring_profile_face_match_not_opted_in",
    message: "Recurring profile headshots require active matching authorization.",
  });

  const selectResponse = await handleSelectRecurringProfileHeadshotFacePost(
    new Request("http://localhost/api/profiles/profile-1/headshot/headshot-1/select-face", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        faceId: "face-1",
      }),
    }),
    {
      params: Promise.resolve({
        profileId: "profile-1",
        headshotId: "headshot-1",
      }),
    },
    {
      createClient: async () => createAuthenticatedClient() as never,
      resolveTenantId: async () => "tenant-1",
      selectRecurringProfileHeadshotFace: async () => {
        throw new HttpError(
          404,
          "recurring_profile_headshot_face_not_found",
          "Recurring profile face not found.",
        );
      },
    },
  );

  assert.equal(selectResponse.status, 404);
  assert.deepEqual(await selectResponse.json(), {
    error: "recurring_profile_headshot_face_not_found",
    message: "Recurring profile face not found.",
  });
});
