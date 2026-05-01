import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../src/lib/http/errors";
import { handleCreateProjectConsentUpgradeRequestPost } from "../src/lib/projects/project-consent-upgrade-route-handlers";

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

test("project consent upgrade request route rejects unauthenticated requests", async () => {
  const response = await handleCreateProjectConsentUpgradeRequestPost(
    new Request("http://localhost/api/projects/project-1/consents/consent-1/upgrade-request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "feature067-upgrade-route",
      },
      body: JSON.stringify({
        targetTemplateId: "template-2",
      }),
    }),
    {
      params: Promise.resolve({
        projectId: "project-1",
        consentId: "consent-1",
      }),
    },
    {
      createClient: async () => createUnauthenticatedClient() as never,
      resolveTenantId: async () => "tenant-1",
      loadProjectWorkflowRowForAccess: async () => createActiveProjectWorkflowRow(),
      requireWorkspaceReviewMutationAccessForRow: async () => undefined,
      requireWorkspaceCorrectionConsentIntakeAccessForRow: async () => {
        throw new Error("should not be called");
      },
      createProjectConsentUpgradeRequest: async () => {
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

test("project consent upgrade request route validates request body and forwards payloads", async () => {
  const invalidBodyResponse = await handleCreateProjectConsentUpgradeRequestPost(
    new Request("http://localhost/api/projects/project-1/consents/consent-1/upgrade-request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "feature067-upgrade-invalid",
      },
      body: "{invalid",
    }),
    {
      params: Promise.resolve({
        projectId: "project-1",
        consentId: "consent-1",
      }),
    },
    {
      createClient: async () => createAuthenticatedClient() as never,
      resolveTenantId: async () => "tenant-1",
      loadProjectWorkflowRowForAccess: async () => createActiveProjectWorkflowRow(),
      requireWorkspaceReviewMutationAccessForRow: async () => undefined,
      requireWorkspaceCorrectionConsentIntakeAccessForRow: async () => {
        throw new Error("should not be called");
      },
      createProjectConsentUpgradeRequest: async () => {
        throw new Error("should not be called");
      },
    },
  );

  assert.equal(invalidBodyResponse.status, 400);
  assert.deepEqual(await invalidBodyResponse.json(), {
    error: "invalid_body",
    message: "Invalid request body.",
  });

  const missingTemplateResponse = await handleCreateProjectConsentUpgradeRequestPost(
    new Request("http://localhost/api/projects/project-1/consents/consent-1/upgrade-request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "feature067-upgrade-missing-template",
      },
      body: JSON.stringify({}),
    }),
    {
      params: Promise.resolve({
        projectId: "project-1",
        consentId: "consent-1",
      }),
    },
    {
      createClient: async () => createAuthenticatedClient() as never,
      resolveTenantId: async () => "tenant-1",
      loadProjectWorkflowRowForAccess: async () => createActiveProjectWorkflowRow(),
      requireWorkspaceReviewMutationAccessForRow: async () => undefined,
      requireWorkspaceCorrectionConsentIntakeAccessForRow: async () => {
        throw new Error("should not be called");
      },
      createProjectConsentUpgradeRequest: async () => {
        throw new Error("should not be called");
      },
    },
  );

  assert.equal(missingTemplateResponse.status, 400);

  const response = await handleCreateProjectConsentUpgradeRequestPost(
    new Request("http://localhost/api/projects/project-1/consents/consent-1/upgrade-request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "feature067-upgrade-request",
      },
      body: JSON.stringify({
        targetTemplateId: "template-2",
      }),
    }),
    {
      params: Promise.resolve({
        projectId: "project-1",
        consentId: "consent-1",
      }),
    },
    {
      createClient: async () => createAuthenticatedClient("user-1") as never,
      resolveTenantId: async () => "tenant-1",
      loadProjectWorkflowRowForAccess: async () => createActiveProjectWorkflowRow(),
      requireWorkspaceReviewMutationAccessForRow: async ({ client, tenantId, userId, projectId, consentId }) => {
        assert.equal(tenantId, "tenant-1");
        assert.equal(userId, "user-1");
        assert.equal(projectId, "project-1");
        assert.equal(consentId, "consent-1");
        assert.ok(client);
      },
      requireWorkspaceCorrectionConsentIntakeAccessForRow: async () => {
        throw new Error("should not be called");
      },
      createProjectConsentUpgradeRequest: async (input) => {
        assert.equal(input.tenantId, "tenant-1");
        assert.equal(input.userId, "user-1");
        assert.equal(input.projectId, "project-1");
        assert.equal(input.consentId, "consent-1");
        assert.equal(input.targetTemplateId, "template-2");
        assert.equal(input.idempotencyKey, "feature067-upgrade-request");
        assert.equal(input.correctionProvenance, null);

        return {
          status: 201,
          payload: {
            request: {
              id: "upgrade-1",
              projectId: "project-1",
              priorConsentId: "consent-1",
              subjectId: "subject-1",
              targetTemplateId: "template-2",
              targetTemplateKey: "media-release",
              targetTemplateName: "Media Release",
              targetTemplateVersion: "v2",
              status: "pending",
              inviteId: "invite-2",
              invitePath: "/i/token-2",
              expiresAt: new Date().toISOString(),
            },
          },
        };
      },
    },
  );

  assert.equal(response.status, 201);
  assert.equal((await response.json()).request.id, "upgrade-1");
});

test("project consent upgrade request route returns service-shaped errors", async () => {
  const response = await handleCreateProjectConsentUpgradeRequestPost(
    new Request("http://localhost/api/projects/project-1/consents/consent-1/upgrade-request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "feature067-upgrade-error",
      },
      body: JSON.stringify({
        targetTemplateId: "template-2",
      }),
    }),
    {
      params: Promise.resolve({
        projectId: "project-1",
        consentId: "consent-1",
      }),
    },
    {
      createClient: async () => createAuthenticatedClient("user-1") as never,
      resolveTenantId: async () => "tenant-1",
      loadProjectWorkflowRowForAccess: async () => createActiveProjectWorkflowRow(),
      requireWorkspaceReviewMutationAccessForRow: async () => undefined,
      requireWorkspaceCorrectionConsentIntakeAccessForRow: async () => {
        throw new Error("should not be called");
      },
      createProjectConsentUpgradeRequest: async () => {
        throw new HttpError(
          409,
          "consent_upgrade_template_not_newer",
          "Select a newer published version before requesting updated consent.",
        );
      },
    },
  );

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    error: "consent_upgrade_template_not_newer",
    message: "Select a newer published version before requesting updated consent.",
  });
});

test("project consent upgrade route rejects users without review permission", async () => {
  const response = await handleCreateProjectConsentUpgradeRequestPost(
    new Request("http://localhost/api/projects/project-1/consents/consent-1/upgrade-request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "feature067-upgrade-forbidden",
      },
      body: JSON.stringify({
        targetTemplateId: "template-2",
      }),
    }),
    {
      params: Promise.resolve({
        projectId: "project-1",
        consentId: "consent-1",
      }),
    },
    {
      createClient: async () => createAuthenticatedClient("user-photographer") as never,
      resolveTenantId: async () => "tenant-1",
      loadProjectWorkflowRowForAccess: async () => createActiveProjectWorkflowRow(),
      requireWorkspaceReviewMutationAccessForRow: async () => {
        throw new HttpError(
          403,
          "project_review_forbidden",
          "Only workspace owners, admins, and reviewers can perform review actions.",
        );
      },
      requireWorkspaceCorrectionConsentIntakeAccessForRow: async () => {
        throw new Error("should not be called");
      },
      createProjectConsentUpgradeRequest: async () => {
        throw new Error("should not be called");
      },
    },
  );

  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), {
    error: "project_review_forbidden",
    message: "Only workspace owners, admins, and reviewers can perform review actions.",
  });
});

test("project consent upgrade request route uses correction intake access when finalized correction is open", async () => {
  const response = await handleCreateProjectConsentUpgradeRequestPost(
    new Request("http://localhost/api/projects/project-1/consents/consent-1/upgrade-request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "feature076-upgrade-correction",
      },
      body: JSON.stringify({
        targetTemplateId: "template-2",
      }),
    }),
    {
      params: Promise.resolve({
        projectId: "project-1",
        consentId: "consent-1",
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
      requireWorkspaceReviewMutationAccessForRow: async () => {
        throw new Error("should not be called");
      },
      requireWorkspaceCorrectionConsentIntakeAccessForRow: async ({ tenantId, userId, projectId, consentId }) => {
        assert.equal(tenantId, "tenant-1");
        assert.equal(userId, "user-reviewer");
        assert.equal(projectId, "project-1");
        assert.equal(consentId, "consent-1");
        return {
          project: {
            finalized_at: "2026-04-24T10:00:00.000Z",
            correction_state: "open",
            correction_opened_at: "2026-04-24T11:00:00.000Z",
            correction_source_release_id: "release-1",
          },
        };
      },
      createProjectConsentUpgradeRequest: async (input) => {
        assert.deepEqual(input.correctionProvenance, {
          requestSource: "correction",
          correctionOpenedAtSnapshot: "2026-04-24T11:00:00.000Z",
          correctionSourceReleaseIdSnapshot: "release-1",
        });

        return {
          status: 201,
          payload: {
            request: {
              id: "upgrade-1",
              projectId: "project-1",
            },
          },
        };
      },
    },
  );

  assert.equal(response.status, 201);
});
