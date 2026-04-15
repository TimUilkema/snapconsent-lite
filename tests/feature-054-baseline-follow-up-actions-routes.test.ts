import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../src/lib/http/errors";
import { handleBaselineFollowUpPost } from "../src/lib/profiles/profile-route-handlers";

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

test("baseline follow-up route rejects unauthenticated requests", async () => {
  const response = await handleBaselineFollowUpPost(
    new Request("http://localhost/api/profiles/profile-1/baseline-follow-up", {
      method: "POST",
    }),
    {
      params: Promise.resolve({
        profileId: "profile-1",
      }),
    },
    {
      createClient: async () => createUnauthenticatedClient() as never,
      resolveTenantId: async () => "tenant-1",
      sendBaselineFollowUp: async () => {
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

test("baseline follow-up route accepts empty bodies and forwards template selection when provided", async () => {
  const emptyBodyResponse = await handleBaselineFollowUpPost(
    new Request("http://localhost/api/profiles/profile-1/baseline-follow-up", {
      method: "POST",
      headers: {
        "Idempotency-Key": "feature054-route-reminder",
      },
    }),
    {
      params: Promise.resolve({
        profileId: "profile-1",
      }),
    },
    {
      createClient: async () => createAuthenticatedClient("user-1") as never,
      resolveTenantId: async () => "tenant-1",
      sendBaselineFollowUp: async (input) => {
        assert.equal(input.tenantId, "tenant-1");
        assert.equal(input.userId, "user-1");
        assert.equal(input.profileId, "profile-1");
        assert.equal(input.idempotencyKey, "feature054-route-reminder");
        assert.equal(input.consentTemplateId, null);

        return {
          status: 200,
          payload: {
            followUp: {
              action: "reminder",
            },
          },
        };
      },
    },
  );

  assert.equal(emptyBodyResponse.status, 200);

  const bodyResponse = await handleBaselineFollowUpPost(
    new Request("http://localhost/api/profiles/profile-1/baseline-follow-up", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "feature054-route-new-request",
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
      createClient: async () => createAuthenticatedClient("user-2") as never,
      resolveTenantId: async () => "tenant-1",
      sendBaselineFollowUp: async (input) => {
        assert.equal(input.userId, "user-2");
        assert.equal(input.idempotencyKey, "feature054-route-new-request");
        assert.equal(input.consentTemplateId, "template-1");

        return {
          status: 201,
          payload: {
            followUp: {
              action: "new_request",
            },
          },
        };
      },
    },
  );

  assert.equal(bodyResponse.status, 201);
  assert.equal((await bodyResponse.json()).followUp.action, "new_request");
});

test("baseline follow-up route validates malformed JSON bodies", async () => {
  const response = await handleBaselineFollowUpPost(
    new Request("http://localhost/api/profiles/profile-1/baseline-follow-up", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "feature054-route-invalid-body",
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
      sendBaselineFollowUp: async () => {
        throw new Error("should not be called");
      },
    },
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "invalid_body",
    message: "Invalid request body.",
  });
});

test("baseline follow-up route returns service-shaped errors", async () => {
  const response = await handleBaselineFollowUpPost(
    new Request("http://localhost/api/profiles/profile-1/baseline-follow-up", {
      method: "POST",
      headers: {
        "Idempotency-Key": "feature054-route-error",
      },
    }),
    {
      params: Promise.resolve({
        profileId: "profile-1",
      }),
    },
    {
      createClient: async () => createAuthenticatedClient("user-1") as never,
      resolveTenantId: async () => "tenant-1",
      sendBaselineFollowUp: async () => {
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
