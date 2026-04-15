import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../src/lib/http/errors";
import {
  handleCancelBaselineConsentRequestPost,
  handleReplaceBaselineConsentRequestPost,
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

test("cancel baseline consent request route rejects unauthenticated requests", async () => {
  const response = await handleCancelBaselineConsentRequestPost(
    new Request("http://localhost/api/profiles/profile-1/baseline-consent-request/request-1/cancel", {
      method: "POST",
    }),
    {
      params: Promise.resolve({
        profileId: "profile-1",
        requestId: "request-1",
      }),
    },
    {
      createClient: async () => createUnauthenticatedClient() as never,
      resolveTenantId: async () => "tenant-1",
      cancelBaselineConsentRequest: async () => {
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

test("cancel baseline consent request route forwards params and payloads", async () => {
  const response = await handleCancelBaselineConsentRequestPost(
    new Request("http://localhost/api/profiles/profile-1/baseline-consent-request/request-1/cancel", {
      method: "POST",
    }),
    {
      params: Promise.resolve({
        profileId: "profile-1",
        requestId: "request-1",
      }),
    },
    {
      createClient: async () => createAuthenticatedClient("user-1") as never,
      resolveTenantId: async () => "tenant-1",
      cancelBaselineConsentRequest: async (input) => {
        assert.equal(input.tenantId, "tenant-1");
        assert.equal(input.userId, "user-1");
        assert.equal(input.profileId, "profile-1");
        assert.equal(input.requestId, "request-1");

        return {
          status: 200,
          payload: {
            request: {
              id: "request-1",
              profileId: "profile-1",
              status: "cancelled",
              updatedAt: new Date().toISOString(),
            },
          },
        };
      },
    },
  );

  assert.equal(response.status, 200);
  assert.equal((await response.json()).request.status, "cancelled");
});

test("replace baseline consent request route validates idempotency via service and forwards payloads", async () => {
  const invalidResponse = await handleReplaceBaselineConsentRequestPost(
    new Request("http://localhost/api/profiles/profile-1/baseline-consent-request/request-1/replace", {
      method: "POST",
    }),
    {
      params: Promise.resolve({
        profileId: "profile-1",
        requestId: "request-1",
      }),
    },
    {
      createClient: async () => createAuthenticatedClient("user-1") as never,
      resolveTenantId: async () => "tenant-1",
      replaceBaselineConsentRequest: async (input) => {
        assert.equal(input.idempotencyKey, "");
        throw new HttpError(400, "invalid_idempotency_key", "Idempotency-Key header is required.");
      },
    },
  );

  assert.equal(invalidResponse.status, 400);
  assert.deepEqual(await invalidResponse.json(), {
    error: "invalid_idempotency_key",
    message: "Idempotency-Key header is required.",
  });

  const successResponse = await handleReplaceBaselineConsentRequestPost(
    new Request("http://localhost/api/profiles/profile-1/baseline-consent-request/request-1/replace", {
      method: "POST",
      headers: {
        "Idempotency-Key": "feature052-route-replace",
      },
    }),
    {
      params: Promise.resolve({
        profileId: "profile-1",
        requestId: "request-1",
      }),
    },
    {
      createClient: async () => createAuthenticatedClient("user-1") as never,
      resolveTenantId: async () => "tenant-1",
      replaceBaselineConsentRequest: async (input) => {
        assert.equal(input.tenantId, "tenant-1");
        assert.equal(input.userId, "user-1");
        assert.equal(input.profileId, "profile-1");
        assert.equal(input.requestId, "request-1");
        assert.equal(input.idempotencyKey, "feature052-route-replace");

        return {
          status: 201,
          payload: {
            request: {
              id: "request-2",
              profileId: "profile-1",
              consentTemplateId: "template-1",
              status: "pending",
              expiresAt: new Date().toISOString(),
              consentPath: "/rp/replaced-token",
              emailSnapshot: "person@example.com",
            },
            replacedRequest: {
              id: "request-1",
              status: "superseded",
              supersededByRequestId: "request-2",
              updatedAt: new Date().toISOString(),
            },
          },
        };
      },
    },
  );

  assert.equal(successResponse.status, 201);
  assert.equal((await successResponse.json()).request.id, "request-2");
});
