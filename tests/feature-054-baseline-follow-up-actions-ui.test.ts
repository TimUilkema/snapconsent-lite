import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import enMessages from "../messages/en.json";
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { RecurringProfileDetailData } from "../src/lib/profiles/profile-directory-service";

type DetailOverrides = {
  access?: Partial<RecurringProfileDetailData["access"]>;
  profile?: Partial<RecurringProfileDetailData["profile"]>;
  baselineConsent?: Partial<RecurringProfileDetailData["baselineConsent"]>;
  requestHistory?: RecurringProfileDetailData["requestHistory"];
  consentHistory?: RecurringProfileDetailData["consentHistory"];
  actions?: Partial<RecurringProfileDetailData["actions"]>;
};

function buildDetailData(overrides: DetailOverrides): RecurringProfileDetailData {
  const base: RecurringProfileDetailData = {
    access: {
      role: "owner",
      canViewProfiles: true,
      canManageProfiles: true,
      ...overrides.access,
    },
    profile: {
      id: randomUUID(),
      fullName: "Jordan Miles",
      email: "jordan@example.com",
      status: "active",
      updatedAt: new Date().toISOString(),
      archivedAt: null,
      profileType: null,
      ...overrides.profile,
    },
    baselineConsent: {
      state: "pending",
      latestActivityAt: new Date().toISOString(),
      latestRequestOutcome: null,
      pendingRequest: {
        id: randomUUID(),
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
      latestRevokedConsent: null,
      latestFollowUpAttempt: null,
      ...overrides.baselineConsent,
    },
    requestHistory: overrides.requestHistory ?? [],
    consentHistory: overrides.consentHistory ?? [],
    actions: {
      canManageBaseline: true,
      canRequestBaselineConsent: false,
      canCopyBaselineLink: true,
      canOpenBaselineLink: true,
      canCancelPendingRequest: true,
      canReplacePendingRequest: true,
      availableBaselineFollowUpAction: "reminder",
      ...overrides.actions,
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

  return base;
}

test("pending profile detail shows Send reminder and latest follow-up status", async () => {
  const { ProfileDetailPanelContent } = await import("../src/components/profiles/profiles-shell");
  const detail = buildDetailData({
    baselineConsent: {
      latestFollowUpAttempt: {
        id: randomUUID(),
        requestId: randomUUID(),
        actionKind: "reminder",
        deliveryMode: "placeholder",
        status: "recorded",
        targetEmail: "jordan@example.com",
        attemptedAt: new Date().toISOString(),
        errorCode: null,
      },
    },
  });

  const markup = renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: "en", messages: enMessages },
      createElement(ProfileDetailPanelContent, {
        detail,
        baselineTemplates: [],
        router: { refresh() {} },
        notice: null,
        onMutated() {},
      }),
    ),
  );

  assert.match(markup, /Send reminder/);
  assert.match(markup, /Latest follow-up/);
  assert.match(markup, /Recorded/);
});

test("missing profile detail shows Send new request and no reminder action", async () => {
  const { ProfileDetailPanelContent } = await import("../src/components/profiles/profiles-shell");
  const detail = buildDetailData({
    baselineConsent: {
      state: "missing",
      pendingRequest: null,
    },
    actions: {
      canCopyBaselineLink: false,
      canOpenBaselineLink: false,
      canCancelPendingRequest: false,
      canReplacePendingRequest: false,
      canRequestBaselineConsent: true,
      availableBaselineFollowUpAction: "new_request",
    },
  });

  const markup = renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: "en", messages: enMessages },
      createElement(ProfileDetailPanelContent, {
        detail,
        baselineTemplates: [
          {
            id: randomUUID(),
            name: "Baseline Consent",
            version: "v1",
            scope: "tenant",
          },
        ],
        router: { refresh() {} },
        notice: null,
        onMutated() {},
      }),
    ),
  );

  assert.match(markup, /Send new request/);
  assert.doesNotMatch(markup, /Send reminder/);
});

test("signed profile detail hides follow-up actions", async () => {
  const { ProfileDetailPanelContent } = await import("../src/components/profiles/profiles-shell");
  const detail = buildDetailData({
    baselineConsent: {
      state: "signed",
      pendingRequest: null,
      activeConsent: {
        id: randomUUID(),
        requestId: randomUUID(),
        signedAt: new Date().toISOString(),
        emailSnapshot: "jordan@example.com",
        fullNameSnapshot: "Jordan Miles",
        templateName: "Baseline Consent",
        templateVersion: "v1",
        structuredSummary: null,
        receiptEmailSentAt: null,
      },
    },
    actions: {
      canCopyBaselineLink: false,
      canOpenBaselineLink: false,
      canCancelPendingRequest: false,
      canReplacePendingRequest: false,
      canRequestBaselineConsent: false,
      availableBaselineFollowUpAction: null,
    },
  });

  const markup = renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: "en", messages: enMessages },
      createElement(ProfileDetailPanelContent, {
        detail,
        baselineTemplates: [],
        router: { refresh() {} },
        notice: null,
        onMutated() {},
      }),
    ),
  );

  assert.doesNotMatch(markup, /Send reminder/);
  assert.doesNotMatch(markup, /Send new request/);
});
