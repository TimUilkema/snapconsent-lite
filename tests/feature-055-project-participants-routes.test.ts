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

function createActiveProjectWorkflowRow() {
  return {
    finalized_at: null,
    correction_state: "none" as const,
    correction_opened_at: null,
    correction_source_release_id: null,
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
        workspaceId: "workspace-1",
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
      loadProjectWorkflowRowForAccess: async () => createActiveProjectWorkflowRow(),
      requireWorkspaceCaptureMutationAccessForRequest: async () => undefined,
      requireWorkspaceCorrectionConsentIntakeAccessForRequest: async () => {
        throw new Error("should not be called");
      },
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
      loadProjectWorkflowRowForAccess: async () => createActiveProjectWorkflowRow(),
      requireWorkspaceCaptureMutationAccessForRequest: async () => undefined,
      requireWorkspaceCorrectionConsentIntakeAccessForRequest: async () => {
        throw new Error("should not be called");
      },
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
        workspaceId: "workspace-1",
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
      loadProjectWorkflowRowForAccess: async () => createActiveProjectWorkflowRow(),
      requireWorkspaceCaptureMutationAccessForRequest: async ({
        supabase: client,
        tenantId,
        userId,
        projectId,
        requestedWorkspaceId: workspaceId,
      }) => {
        assert.equal(tenantId, "tenant-1");
        assert.equal(userId, "user-1");
        assert.equal(projectId, "project-1");
        assert.equal(workspaceId, "workspace-1");
        assert.ok(client);
      },
      requireWorkspaceCorrectionConsentIntakeAccessForRequest: async () => {
        throw new Error("should not be called");
      },
      addProjectProfileParticipant: async (input) => {
        assert.equal(input.tenantId, "tenant-1");
        assert.equal(input.userId, "user-1");
        assert.equal(input.projectId, "project-1");
        assert.equal(input.workspaceId, "workspace-1");
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
        "Content-Type": "application/json",
        "Idempotency-Key": "feature055-project-request",
      },
      body: JSON.stringify({
        workspaceId: "workspace-1",
      }),
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
      loadProjectWorkflowRowForAccess: async () => createActiveProjectWorkflowRow(),
      requireWorkspaceCaptureMutationAccessForRequest: async () => undefined,
      requireWorkspaceCorrectionConsentIntakeAccessForRequest: async () => {
        throw new Error("should not be called");
      },
      createProjectProfileConsentRequest: async (input) => {
        assert.equal(input.tenantId, "tenant-1");
        assert.equal(input.userId, "user-1");
        assert.equal(input.projectId, "project-1");
        assert.equal(input.workspaceId, "workspace-1");
        assert.equal(input.participantId, "participant-1");
        assert.equal(input.idempotencyKey, "feature055-project-request");
        assert.equal(input.consentTemplateId, null);
        assert.equal(input.correctionProvenance, null);

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
        workspaceId: "workspace-1",
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
      loadProjectWorkflowRowForAccess: async () => createActiveProjectWorkflowRow(),
      requireWorkspaceCaptureMutationAccessForRequest: async () => undefined,
      requireWorkspaceCorrectionConsentIntakeAccessForRequest: async () => {
        throw new Error("should not be called");
      },
      createProjectProfileConsentRequest: async (input) => {
        assert.equal(input.userId, "user-2");
        assert.equal(input.workspaceId, "workspace-1");
        assert.equal(input.idempotencyKey, "feature055-project-request-template");
        assert.equal(input.consentTemplateId, "template-2");
        assert.equal(input.correctionProvenance, null);

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
        "Content-Type": "application/json",
        "Idempotency-Key": "feature055-project-request-error",
      },
      body: JSON.stringify({
        workspaceId: "workspace-1",
      }),
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
      loadProjectWorkflowRowForAccess: async () => createActiveProjectWorkflowRow(),
      requireWorkspaceCaptureMutationAccessForRequest: async () => undefined,
      requireWorkspaceCorrectionConsentIntakeAccessForRequest: async () => {
        throw new Error("should not be called");
      },
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

test("project participant routes reject users without capture permission", async () => {
  const addResponse = await handleAddProjectProfileParticipantPost(
    new Request("http://localhost/api/projects/project-1/profile-participants", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recurringProfileId: "profile-1",
        workspaceId: "workspace-1",
      }),
    }),
    {
      params: Promise.resolve({
        projectId: "project-1",
      }),
    },
    {
      createClient: async () => createAuthenticatedClient("user-reviewer") as never,
      resolveTenantId: async () => "tenant-1",
      loadProjectWorkflowRowForAccess: async () => createActiveProjectWorkflowRow(),
      requireWorkspaceCaptureMutationAccessForRequest: async () => {
        throw new HttpError(
          403,
          "workspace_capture_forbidden",
          "Only workspace owners, admins, and assigned photographers can perform capture actions.",
        );
      },
      requireWorkspaceCorrectionConsentIntakeAccessForRequest: async () => {
        throw new Error("should not be called");
      },
      addProjectProfileParticipant: async () => {
        throw new Error("should not be called");
      },
    },
  );

  assert.equal(addResponse.status, 403);
  assert.deepEqual(await addResponse.json(), {
    error: "workspace_capture_forbidden",
    message: "Only workspace owners, admins, and assigned photographers can perform capture actions.",
  });

  const requestResponse = await handleCreateProjectProfileConsentRequestPost(
    new Request("http://localhost/api/projects/project-1/profile-participants/participant-1/consent-request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "feature055-project-request-forbidden",
      },
      body: JSON.stringify({
        workspaceId: "workspace-1",
      }),
    }),
    {
      params: Promise.resolve({
        projectId: "project-1",
        participantId: "participant-1",
      }),
    },
    {
      createClient: async () => createAuthenticatedClient("user-reviewer") as never,
      resolveTenantId: async () => "tenant-1",
      loadProjectWorkflowRowForAccess: async () => createActiveProjectWorkflowRow(),
      requireWorkspaceCaptureMutationAccessForRequest: async () => {
        throw new HttpError(
          403,
          "workspace_capture_forbidden",
          "Only workspace owners, admins, and assigned photographers can perform capture actions.",
        );
      },
      requireWorkspaceCorrectionConsentIntakeAccessForRequest: async () => {
        throw new Error("should not be called");
      },
      createProjectProfileConsentRequest: async () => {
        throw new Error("should not be called");
      },
    },
  );

  assert.equal(requestResponse.status, 403);
  assert.deepEqual(await requestResponse.json(), {
    error: "workspace_capture_forbidden",
    message: "Only workspace owners, admins, and assigned photographers can perform capture actions.",
  });
});

test("add participant route uses correction intake access when finalized correction is open", async () => {
  const response = await handleAddProjectProfileParticipantPost(
    new Request("http://localhost/api/projects/project-1/profile-participants", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recurringProfileId: "profile-1",
        workspaceId: "workspace-1",
      }),
    }),
    {
      params: Promise.resolve({
        projectId: "project-1",
      }),
    },
    {
      createClient: async () => createAuthenticatedClient("user-reviewer") as never,
      resolveTenantId: async () => "tenant-1",
      loadProjectWorkflowRowForAccess: async () => ({
        finalized_at: "2026-04-24T10:00:00.000Z",
        correction_state: "open",
        correction_opened_at: "2026-04-24T11:00:00.000Z",
        correction_source_release_id: "release-1",
      }),
      requireWorkspaceCaptureMutationAccessForRequest: async () => {
        throw new Error("should not be called");
      },
      requireWorkspaceCorrectionConsentIntakeAccessForRequest: async ({ tenantId, userId, projectId, requestedWorkspaceId }) => {
        assert.equal(tenantId, "tenant-1");
        assert.equal(userId, "user-reviewer");
        assert.equal(projectId, "project-1");
        assert.equal(requestedWorkspaceId, "workspace-1");
      },
      addProjectProfileParticipant: async () => ({
        status: 201,
        payload: {
          participant: {
            id: "participant-1",
          },
        },
      }),
    },
  );

  assert.equal(response.status, 201);
});

test("project participant consent request route uses correction intake access and forwards correction provenance", async () => {
  const response = await handleCreateProjectProfileConsentRequestPost(
    new Request("http://localhost/api/projects/project-1/profile-participants/participant-1/consent-request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "feature076-project-request-correction",
      },
      body: JSON.stringify({
        workspaceId: "workspace-1",
      }),
    }),
    {
      params: Promise.resolve({
        projectId: "project-1",
        participantId: "participant-1",
      }),
    },
    {
      createClient: async () => createAuthenticatedClient("user-reviewer") as never,
      resolveTenantId: async () => "tenant-1",
      loadProjectWorkflowRowForAccess: async () => ({
        finalized_at: "2026-04-24T10:00:00.000Z",
        correction_state: "open",
        correction_opened_at: "2026-04-24T11:00:00.000Z",
        correction_source_release_id: "release-1",
      }),
      requireWorkspaceCaptureMutationAccessForRequest: async () => {
        throw new Error("should not be called");
      },
      requireWorkspaceCorrectionConsentIntakeAccessForRequest: async ({ tenantId, userId, projectId, requestedWorkspaceId }) => {
        assert.equal(tenantId, "tenant-1");
        assert.equal(userId, "user-reviewer");
        assert.equal(projectId, "project-1");
        assert.equal(requestedWorkspaceId, "workspace-1");
        return {
          project: {
            finalized_at: "2026-04-24T10:00:00.000Z",
            correction_state: "open",
            correction_opened_at: "2026-04-24T11:00:00.000Z",
            correction_source_release_id: "release-1",
          },
        };
      },
      createProjectProfileConsentRequest: async (input) => {
        assert.deepEqual(input.correctionProvenance, {
          requestSource: "correction",
          correctionOpenedAtSnapshot: "2026-04-24T11:00:00.000Z",
          correctionSourceReleaseIdSnapshot: "release-1",
        });

        return {
          status: 201,
          payload: {
            request: {
              id: "request-1",
            },
          },
        };
      },
    },
  );

  assert.equal(response.status, 201);
});
