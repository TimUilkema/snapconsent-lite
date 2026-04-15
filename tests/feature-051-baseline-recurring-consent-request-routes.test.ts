import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../src/lib/http/errors";
import { handleCreateBaselineConsentRequestPost } from "../src/lib/profiles/profile-route-handlers";

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

test("create baseline consent request route rejects unauthenticated requests", async () => {
  const response = await handleCreateBaselineConsentRequestPost(
    new Request("http://localhost/api/profiles/profile-1/baseline-consent-request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        consentTemplateId: "template-1",
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
      createBaselineConsentRequest: async () => {
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

test("create baseline consent request route validates request bodies and forwards service payloads", async () => {
  const invalidResponse = await handleCreateBaselineConsentRequestPost(
    new Request("http://localhost/api/profiles/profile-1/baseline-consent-request", {
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
      createBaselineConsentRequest: async () => {
        throw new Error("should not be called");
      },
    },
  );

  assert.equal(invalidResponse.status, 400);
  assert.deepEqual(await invalidResponse.json(), {
    error: "invalid_body",
    message: "Invalid request body.",
  });

  const successResponse = await handleCreateBaselineConsentRequestPost(
    new Request("http://localhost/api/profiles/profile-1/baseline-consent-request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "feature051-route-request",
      },
      body: JSON.stringify({
        consentTemplateId: "template-1",
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
      createBaselineConsentRequest: async (input) => {
        assert.equal(input.tenantId, "tenant-1");
        assert.equal(input.userId, "user-1");
        assert.equal(input.profileId, "profile-1");
        assert.equal(input.consentTemplateId, "template-1");
        assert.equal(input.idempotencyKey, "feature051-route-request");

        return {
          status: 201,
          payload: {
            request: {
              id: "request-1",
              profileId: "profile-1",
              consentTemplateId: "template-1",
              status: "pending",
              expiresAt: new Date().toISOString(),
              consentPath: "/rp/token",
            },
          },
        };
      },
    },
  );

  assert.equal(successResponse.status, 201);
  assert.equal((await successResponse.json()).request.id, "request-1");
});

test("create baseline consent request route returns service-shaped errors", async () => {
  const response = await handleCreateBaselineConsentRequestPost(
    new Request("http://localhost/api/profiles/profile-1/baseline-consent-request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "feature051-route-error",
      },
      body: JSON.stringify({
        consentTemplateId: "template-1",
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
      createBaselineConsentRequest: async () => {
        throw new HttpError(
          409,
          "baseline_consent_already_signed",
          "This profile already has an active baseline consent.",
        );
      },
    },
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "baseline_consent_already_signed",
    message: "This profile already has an active baseline consent.",
  });
});
