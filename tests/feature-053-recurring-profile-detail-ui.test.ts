import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import enMessages from "../messages/en.json";
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type {
  RecurringProfileDetailData,
  RecurringProfilesPageData,
} from "../src/lib/profiles/profile-directory-service";

function buildPageData(canManageProfiles: boolean): RecurringProfilesPageData {
  return {
    access: {
      role: canManageProfiles ? "owner" : "photographer",
      canViewProfiles: true,
      canManageProfiles,
    },
    summary: {
      activeProfiles: 1,
      archivedProfiles: 0,
      activeProfileTypes: 1,
      activeProfilesWithoutType: 0,
    },
    filters: {
      q: "",
      profileTypeId: null,
      includeArchived: false,
    },
    baselineTemplates: [
      {
        id: randomUUID(),
        name: "Baseline Consent",
        version: "v1",
        scope: "tenant",
      },
    ],
    profileTypes: [
      {
        id: randomUUID(),
        label: "Volunteer",
        status: "active",
        updatedAt: new Date().toISOString(),
        archivedAt: null,
        activeProfileCount: 1,
      },
    ],
    profiles: [
      {
        id: randomUUID(),
        fullName: "Jordan Miles",
        email: "jordan@example.com",
        status: "active",
        updatedAt: new Date().toISOString(),
        archivedAt: null,
        profileType: {
          id: randomUUID(),
          label: "Volunteer",
          status: "active",
          archivedAt: null,
        },
        baselineConsent: {
          state: "pending",
          pendingRequest: {
            id: randomUUID(),
            expiresAt: new Date().toISOString(),
            consentPath: "/rp/example-token",
            emailSnapshot: "jordan@example.com",
            updatedAt: new Date().toISOString(),
          },
          latestActivityAt: new Date().toISOString(),
          latestRequestOutcome: null,
        },
        matchingReadiness: {
          state: "needs_face_selection",
          authorized: true,
          currentHeadshotId: randomUUID(),
          selectionFaceId: null,
          selectionStatus: "needs_face_selection",
          materializationStatus: "completed",
        },
      },
    ],
  };
}

function buildDetailData(): RecurringProfileDetailData {
  const requestId = randomUUID();
  const consentId = randomUUID();

  return {
    access: {
      role: "owner",
      canViewProfiles: true,
      canManageProfiles: true,
    },
    profile: {
      id: randomUUID(),
      fullName: "Jordan Miles",
      email: "jordan@example.com",
      status: "active",
      updatedAt: new Date().toISOString(),
      archivedAt: null,
      profileType: {
        id: randomUUID(),
        label: "Volunteer",
        status: "active",
        archivedAt: null,
      },
    },
    baselineConsent: {
      state: "pending",
      latestActivityAt: new Date().toISOString(),
      latestRequestOutcome: null,
      pendingRequest: {
        id: requestId,
        expiresAt: new Date().toISOString(),
        consentPath: "/rp/example-token",
        emailSnapshot: "jordan@example.com",
        updatedAt: new Date().toISOString(),
        fullNameSnapshot: "Jordan Miles",
        templateName: "Baseline Consent",
        templateVersion: "v1",
        createdAt: new Date().toISOString(),
      },
      activeConsent: null,
      latestRevokedConsent: {
        id: consentId,
        requestId: randomUUID(),
        signedAt: new Date().toISOString(),
        revokedAt: new Date().toISOString(),
        revokeReason: "No longer needed",
        emailSnapshot: "jordan@example.com",
        fullNameSnapshot: "Jordan Miles",
        templateName: "Baseline Consent",
        templateVersion: "v1",
        structuredSummary: {
          scopeLabels: ["Photos"],
          durationLabel: "1 year",
        },
        receiptEmailSentAt: new Date().toISOString(),
      },
      latestFollowUpAttempt: {
        id: randomUUID(),
        requestId,
        actionKind: "reminder",
        deliveryMode: "placeholder",
        status: "recorded",
        targetEmail: "jordan@example.com",
        attemptedAt: new Date().toISOString(),
        errorCode: null,
      },
    },
    requestHistory: [
      {
        id: requestId,
        status: "pending",
        createdAt: new Date().toISOString(),
        expiresAt: new Date().toISOString(),
        changedAt: new Date().toISOString(),
        emailSnapshot: "jordan@example.com",
        fullNameSnapshot: "Jordan Miles",
        templateName: "Baseline Consent",
        templateVersion: "v1",
        supersededByRequestId: null,
      },
      {
        id: randomUUID(),
        status: "signed",
        createdAt: new Date().toISOString(),
        expiresAt: new Date().toISOString(),
        changedAt: new Date().toISOString(),
        emailSnapshot: "jordan@example.com",
        fullNameSnapshot: "Jordan Miles",
        templateName: "Baseline Consent",
        templateVersion: "v1",
        supersededByRequestId: null,
      },
    ],
    consentHistory: [
      {
        id: consentId,
        requestId: randomUUID(),
        signedAt: new Date().toISOString(),
        revokedAt: new Date().toISOString(),
        revokeReason: "No longer needed",
        emailSnapshot: "jordan@example.com",
        fullNameSnapshot: "Jordan Miles",
        templateName: "Baseline Consent",
        templateVersion: "v1",
        structuredSummary: {
          scopeLabels: ["Photos"],
          durationLabel: "1 year",
        },
        receiptEmailSentAt: new Date().toISOString(),
      },
    ],
    actions: {
      canManageBaseline: true,
      canRequestBaselineConsent: false,
      canCopyBaselineLink: true,
      canOpenBaselineLink: true,
      canCancelPendingRequest: true,
      canReplacePendingRequest: true,
      availableBaselineFollowUpAction: "reminder",
    },
    headshotMatching: {
      currentHeadshot: null,
      currentMaterialization: null,
      candidateFaces: [],
      readiness: {
        state: "missing_headshot",
        authorized: true,
        currentHeadshotId: null,
        selectionFaceId: null,
        selectionStatus: null,
        materializationStatus: null,
      },
      previewUrl: null,
      actions: {
        canManage: true,
        canUpload: true,
        canReplace: false,
        canSelectFace: false,
      },
    },
  };
}

test("profiles shell keeps collapsed rows summary-focused and exposes a detail toggle", async () => {
  const { ProfilesShellView } = await import("../src/components/profiles/profiles-shell");
  const router = {
    refresh() {},
  };

  const markup = renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: "en", messages: enMessages },
      createElement(ProfilesShellView, { data: buildPageData(true), router }),
    ),
  );

  assert.match(markup, /View details/);
  assert.match(markup, /Archive profile/);
  assert.match(markup, /Matching/);
  assert.doesNotMatch(markup, /Copy baseline link/);
  assert.doesNotMatch(markup, /Cancel request/);
  assert.doesNotMatch(markup, /Replace request/);
});

test("expanded profile detail panel renders current summary, pending actions, and separate history sections", async () => {
  const { ProfileDetailPanelContent } = await import("../src/components/profiles/profiles-shell");
  const router = {
    refresh() {},
  };

  const markup = renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: "en", messages: enMessages },
      createElement(ProfileDetailPanelContent, {
        detail: buildDetailData(),
        baselineTemplates: [
          {
            id: randomUUID(),
            name: "Baseline Consent",
            version: "v1",
            scope: "tenant",
          },
        ],
        router,
        notice: null,
        onMutated() {},
      }),
    ),
  );

  assert.match(markup, /Current standard declaration/);
  assert.match(markup, /Matching headshot/);
  assert.match(markup, /Current pending request/);
  assert.match(markup, /Request history/);
  assert.match(markup, /Latest follow-up/);
  assert.match(markup, /Send reminder/);
  assert.match(markup, /Cancel request/);
  assert.match(markup, /Replace request/);
  assert.doesNotMatch(markup, /Baseline consent history/);
  assert.doesNotMatch(markup, /Latest follow-up recorded in placeholder mode/);
  assert.doesNotMatch(markup, /Receipt sent/);
});
