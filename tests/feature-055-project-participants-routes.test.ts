import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../src/lib/http/errors";
import {
  handleAddProjectProfileParticipantPost,
  handleCreateProjectProfileConsentRequestPost,
} from "../src/lib/projects/project-participants-route-handlers";

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

test("add project profile participant route rejects unauthenticated requests", async () => {
  const response = await handleAddProjectProfileParticipantPost(
    new Request("http://localhost/api/projects/project-1/profile-participants", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recurringProfileId: "profile-1",
      }),
    }),
    {
      params: Promise.resolve({
        projectId: "project-1",
      }),
    },
    {
      createClient: async () => createUnauthenticatedClient() as never,
      resolveTenantId: async () => "tenant-1",
      addProjectProfileParticipant: async () => {
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

test("add project profile participant route validates bodies and forwards payloads", async () => {
  const invalidResponse = await handleAddProjectProfileParticipantPost(
    new Request("http://localhost/api/projects/project-1/profile-participants", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: "{invalid",
    }),
    {
      params: Promise.resolve({
        projectId: "project-1",
      }),
    },
    {
      createClient: async () => createAuthenticatedClient() as never,
      resolveTenantId: async () => "tenant-1",
      addProjectProfileParticipant: async () => {
        throw new Error("should not be called");
      },
    },
  );

  assert.equal(invalidResponse.status, 400);
  assert.deepEqual(await invalidResponse.json(), {
    error: "invalid_body",
    message: "Invalid request body.",
  });

  const successResponse = await handleAddProjectProfileParticipantPost(
    new Request("http://localhost/api/projects/project-1/profile-participants", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recurringProfileId: "profile-1",
      }),
    }),
    {
      params: Promise.resolve({
        projectId: "project-1",
      }),
    },
    {
      createClient: async () => createAuthenticatedClient("user-1") as never,
      resolveTenantId: async () => "tenant-1",
      addProjectProfileParticipant: async (input) => {
        assert.equal(input.tenantId, "tenant-1");
        assert.equal(input.userId, "user-1");
        assert.equal(input.projectId, "project-1");
        assert.equal(input.recurringProfileId, "profile-1");

        return {
          status: 201,
          payload: {
            participant: {
              id: "participant-1",
              projectId: "project-1",
              profileId: "profile-1",
              profileName: "Jordan Miles",
              profileEmail: "jordan@example.com",
              profileStatus: "active",
              createdAt: new Date().toISOString(),
            },
          },
        };
      },
    },
  );

  assert.equal(successResponse.status, 201);
  assert.equal((await successResponse.json()).participant.id, "participant-1");
});

test("project participant consent request route accepts empty bodies and forwards template overrides", async () => {
  const emptyBodyResponse = await handleCreateProjectProfileConsentRequestPost(
    new Request("http://localhost/api/projects/project-1/profile-participants/participant-1/consent-request", {
      method: "POST",
      headers: {
        "Idempotency-Key": "feature055-project-request",
      },
    }),
    {
      params: Promise.resolve({
        projectId: "project-1",
        participantId: "participant-1",
      }),
    },
    {
      createClient: async () => createAuthenticatedClient("user-1") as never,
      resolveTenantId: async () => "tenant-1",
      createProjectProfileConsentRequest: async (input) => {
        assert.equal(input.tenantId, "tenant-1");
        assert.equal(input.userId, "user-1");
        assert.equal(input.projectId, "project-1");
        assert.equal(input.participantId, "participant-1");
        assert.equal(input.idempotencyKey, "feature055-project-request");
        assert.equal(input.consentTemplateId, null);

        return {
          status: 201,
          payload: {
            request: {
              id: "request-1",
              participantId: "participant-1",
              profileId: "profile-1",
              projectId: "project-1",
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

  assert.equal(emptyBodyResponse.status, 201);

  const bodyResponse = await handleCreateProjectProfileConsentRequestPost(
    new Request("http://localhost/api/projects/project-1/profile-participants/participant-1/consent-request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "feature055-project-request-template",
      },
      body: JSON.stringify({
        consentTemplateId: "template-2",
      }),
    }),
    {
      params: Promise.resolve({
        projectId: "project-1",
        participantId: "participant-1",
      }),
    },
    {
      createClient: async () => createAuthenticatedClient("user-2") as never,
      resolveTenantId: async () => "tenant-1",
      createProjectProfileConsentRequest: async (input) => {
        assert.equal(input.userId, "user-2");
        assert.equal(input.idempotencyKey, "feature055-project-request-template");
        assert.equal(input.consentTemplateId, "template-2");

        return {
          status: 200,
          payload: {
            request: {
              id: "request-2",
              participantId: "participant-1",
              profileId: "profile-1",
              projectId: "project-1",
              consentTemplateId: "template-2",
              status: "pending",
              expiresAt: new Date().toISOString(),
              consentPath: "/rp/token-2",
            },
          },
        };
      },
    },
  );

  assert.equal(bodyResponse.status, 200);
  assert.equal((await bodyResponse.json()).request.id, "request-2");
});

test("project participant consent request route returns service-shaped errors", async () => {
  const response = await handleCreateProjectProfileConsentRequestPost(
    new Request("http://localhost/api/projects/project-1/profile-participants/participant-1/consent-request", {
      method: "POST",
      headers: {
        "Idempotency-Key": "feature055-project-request-error",
      },
    }),
    {
      params: Promise.resolve({
        projectId: "project-1",
        participantId: "participant-1",
      }),
    },
    {
      createClient: async () => createAuthenticatedClient("user-1") as never,
      resolveTenantId: async () => "tenant-1",
      createProjectProfileConsentRequest: async () => {
        throw new HttpError(
          409,
          "project_consent_already_signed",
          "This profile already has an active project consent.",
        );
      },
    },
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "project_consent_already_signed",
    message: "This profile already has an active project consent.",
  });
});
