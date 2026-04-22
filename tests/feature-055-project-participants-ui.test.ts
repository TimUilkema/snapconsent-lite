import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import enMessages from "../messages/en.json";
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { ProjectParticipantsPanelData } from "../src/lib/projects/project-participants-service";

function buildParticipantsData(): ProjectParticipantsPanelData {
  return {
    availableProfiles: [
      {
        id: randomUUID(),
        fullName: "Casey Jordan",
        email: "casey@example.com",
        profileTypeLabel: "Volunteer",
      },
    ],
    knownProfiles: [
      {
        participantId: randomUUID(),
        projectId: randomUUID(),
        createdAt: new Date().toISOString(),
        profile: {
          id: randomUUID(),
          fullName: "Jordan Miles",
          email: "jordan@example.com",
          status: "active",
          archivedAt: null,
          profileType: {
            id: randomUUID(),
            label: "Employee",
            status: "active",
            archivedAt: null,
          },
        },
        baselineConsentState: "signed",
        matchingReadiness: {
          state: "ready",
          authorized: true,
          currentHeadshotId: randomUUID(),
          selectionFaceId: randomUUID(),
          selectionStatus: "auto_selected",
          materializationStatus: "completed",
        },
        projectConsent: {
          state: "signed",
          latestActivityAt: new Date().toISOString(),
          pendingRequest: {
            id: randomUUID(),
            expiresAt: new Date().toISOString(),
            emailSnapshot: "jordan@example.com",
            template: {
              id: randomUUID(),
              name: "Project Consent",
              version: "v2",
            },
            consentPath: "/rp/project-token",
          },
          activeConsent: {
            id: randomUUID(),
            signedAt: new Date().toISOString(),
            emailSnapshot: "jordan@example.com",
            fullNameSnapshot: "Jordan Miles",
            template: {
              id: randomUUID(),
              name: "Project Consent",
              version: "v1",
            },
          },
          latestRevokedConsent: null,
        },
        actions: {
          canCreateRequest: false,
          canCopyLink: true,
          canOpenLink: true,
        },
      },
      {
        participantId: randomUUID(),
        projectId: randomUUID(),
        createdAt: new Date().toISOString(),
        profile: {
          id: randomUUID(),
          fullName: "Riley Harper",
          email: "riley@example.com",
          status: "archived",
          archivedAt: new Date().toISOString(),
          profileType: null,
        },
        baselineConsentState: "missing",
        matchingReadiness: {
          state: "missing_headshot",
          authorized: true,
          currentHeadshotId: null,
          selectionFaceId: null,
          selectionStatus: null,
          materializationStatus: null,
        },
        projectConsent: {
          state: "revoked",
          latestActivityAt: new Date().toISOString(),
          pendingRequest: null,
          activeConsent: null,
          latestRevokedConsent: {
            id: randomUUID(),
            signedAt: new Date().toISOString(),
            revokedAt: new Date().toISOString(),
            emailSnapshot: "riley@example.com",
            fullNameSnapshot: "Riley Harper",
            template: {
              id: randomUUID(),
              name: "Project Consent",
              version: "v1",
            },
          },
        },
        actions: {
          canCreateRequest: false,
          canCopyLink: false,
          canOpenLink: false,
        },
      },
    ],
  };
}

test("project participants panel renders known profiles, baseline context, and pending project link actions", async () => {
  const { ProjectParticipantsPanelView } = await import(
    "../src/components/projects/project-participants-panel"
  );
  const data = buildParticipantsData();

  const markup = renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: "en", messages: enMessages },
      createElement(ProjectParticipantsPanelView, {
        projectId: randomUUID(),
        data,
        templates: [
          {
            id: randomUUID(),
            name: "Project Consent",
            version: "v2",
            scope: "tenant",
          },
        ],
        defaultTemplateId: randomUUID(),
        defaultTemplateWarning: null,
        profileHeadshotUrls: {
          [data.knownProfiles[0]!.profile.id]: {
            thumbnailUrl: "https://example.com/headshot-thumb.jpg",
            previewUrl: "https://example.com/headshot-preview.jpg",
          },
        },
        router: { refresh() {} },
      }),
    ),
  );

  assert.match(markup, /Profiles/);
  assert.match(markup, /Add existing profile/);
  assert.match(markup, /Copy link/);
  assert.match(markup, /Open link/);
  assert.match(markup, /Archived profile/);
  assert.match(markup, /Project Consent v1/);
  assert.match(markup, /Signed /);
  assert.match(markup, /Headshot of Jordan Miles/);
  assert.doesNotMatch(markup, /Match source/);
  assert.doesNotMatch(markup, /Added to project/);
  assert.doesNotMatch(markup, /Project consent status/);
  assert.doesNotMatch(markup, /This participant has a ready recurring profile match source\./);
});

test("project participants panel renders request creation controls when project consent is missing", async () => {
  const { ProjectParticipantsPanelView } = await import(
    "../src/components/projects/project-participants-panel"
  );

  const data: ProjectParticipantsPanelData = {
    availableProfiles: [],
    knownProfiles: [
      {
        participantId: randomUUID(),
        projectId: randomUUID(),
        createdAt: new Date().toISOString(),
        profile: {
          id: randomUUID(),
          fullName: "Morgan Lee",
          email: "morgan@example.com",
          status: "active",
          archivedAt: null,
          profileType: null,
        },
        baselineConsentState: "pending",
        matchingReadiness: {
          state: "materializing",
          authorized: true,
          currentHeadshotId: randomUUID(),
          selectionFaceId: null,
          selectionStatus: "pending_materialization",
          materializationStatus: "pending",
        },
        projectConsent: {
          state: "missing",
          latestActivityAt: null,
          pendingRequest: null,
          activeConsent: null,
          latestRevokedConsent: null,
        },
        actions: {
          canCreateRequest: true,
          canCopyLink: false,
          canOpenLink: false,
        },
      },
    ],
  };

  const markup = renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: "en", messages: enMessages },
      createElement(ProjectParticipantsPanelView, {
        projectId: randomUUID(),
        data,
        templates: [
          {
            id: randomUUID(),
            name: "Project Consent",
            version: "v3",
            scope: "app",
          },
        ],
        defaultTemplateId: null,
        defaultTemplateWarning: "Default unavailable",
        router: { refresh() {} },
      }),
    ),
  );

  assert.match(markup, /Default unavailable/);
  assert.match(markup, /Create project request/);
  assert.match(markup, /Select a template/);
  assert.match(markup, /No project consent request yet/);
});
