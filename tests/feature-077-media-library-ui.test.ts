import assert from "node:assert/strict";
import test from "node:test";

import enMessages from "../messages/en.json";
import { MediaLibraryDownloadButton, shouldContinueMediaLibraryDownload } from "../src/components/media-library/media-library-download-button";
import { ReleasedPhotoReviewSurface } from "../src/components/media-library/released-photo-review-surface";
import { ReleaseSafetyBadges } from "../src/components/media-library/release-safety-badges";
import { ReleaseSafetyBanner } from "../src/components/media-library/release-safety-banner";
import { ReleaseUsagePermissions } from "../src/components/media-library/release-usage-permissions";
import type { ReleasePhotoOverlaySummary } from "../src/lib/project-releases/media-library-release-overlays";
import type {
  MediaLibraryReleaseSafetySummary,
  MediaLibraryUsagePermissionOwnerSummary,
} from "../src/lib/project-releases/media-library-release-safety";
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

function renderWithMessages(node: React.ReactNode) {
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: "en", messages: enMessages },
      node,
    ),
  );
}

function createSafetySummary(
  overrides: Partial<MediaLibraryReleaseSafetySummary> = {},
): MediaLibraryReleaseSafetySummary {
  return {
    blockedFaceCount: 0,
    hiddenFaceCount: 0,
    suppressedFaceCount: 0,
    manualFaceCount: 0,
    revokedLinkedOwnerCount: 0,
    nonGrantedEffectiveScopeCount: 0,
    hasBlockedFaces: false,
    hasHiddenFaces: false,
    hasSuppressedFaces: false,
    hasManualFaces: false,
    hasRevokedLinkedOwners: false,
    hasNonGrantedEffectiveScopes: false,
    hasRestrictedState: false,
    hasLowLevelReviewContext: false,
    requiresDownloadConfirmation: false,
    primaryState: "clear",
    badges: [],
    ...overrides,
  };
}

test("feature 077 list safety badges render blocked and manual without restricted or hidden badges", () => {
  const markup = renderWithMessages(
    createElement(ReleaseSafetyBadges, {
      summary: createSafetySummary({
        hasBlockedFaces: true,
        hasRestrictedState: true,
        hasManualFaces: true,
        badges: ["blocked", "manual"],
      }),
    }),
  );

  assert.match(markup, /Blocked/);
  assert.match(markup, /Manual/);
  assert.doesNotMatch(markup, /Restricted/);
  assert.doesNotMatch(markup, /Hidden/);
});

test("feature 077 detail banner renders only for blocked or restricted state", () => {
  const blockedMarkup = renderWithMessages(
    createElement(ReleaseSafetyBanner, {
      summary: createSafetySummary({
        blockedFaceCount: 2,
        hasBlockedFaces: true,
        requiresDownloadConfirmation: true,
        primaryState: "blocked",
      }),
    }),
  );
  const hiddenOnlyMarkup = renderWithMessages(
    createElement(ReleaseSafetyBanner, {
      summary: createSafetySummary({
        hiddenFaceCount: 2,
        hasHiddenFaces: true,
        hasLowLevelReviewContext: true,
      }),
    }),
  );

  assert.match(blockedMarkup, /Blocked faces are present in this release snapshot/);
  assert.match(blockedMarkup, /2 blocked faces/);
  assert.equal(hiddenOnlyMarkup, "");
});

test("feature 077 usage permissions render neutral face columns and final scope result", () => {
  const owners: MediaLibraryUsagePermissionOwnerSummary[] = [
    {
      projectFaceAssigneeId: "assignee-1",
      displayName: "Jordan Jones",
      email: "jordan@example.com",
      identityKind: "project_consent",
      currentStatus: "active",
      effectiveScopes: [
        {
          templateKey: "usage",
          scopeKey: "social",
          label: "Social",
          status: "granted",
          governingSourceKind: "project_consent",
        },
        {
          templateKey: "usage",
          scopeKey: "print",
          label: "Print",
          status: "not_granted",
          governingSourceKind: "project_consent",
        },
      ],
      effectiveScopeCount: 2,
      nonGrantedEffectiveScopeCount: 1,
      hasNonGrantedEffectiveScopes: true,
      hasRestrictedState: true,
      exactFaceLinks: [
        {
          assetFaceId: "face-3",
          materializationId: "materialization-1",
          faceRank: 2,
          projectFaceAssigneeId: "assignee-1",
          identityKind: "project_consent",
          consentId: "consent-1",
          recurringProfileConsentId: null,
          projectProfileParticipantId: "participant-1",
          profileId: "profile-1",
          linkSource: "manual",
          matchConfidence: null,
        },
      ],
      hasWholeAssetLink: true,
      hasFallbackLink: true,
    },
  ];

  const markup = renderWithMessages(
    createElement(ReleaseUsagePermissions, {
      owners,
      faces: [
        {
          assetFaceId: "face-3",
          faceRank: 2,
          faceSource: "detector",
          faceBoxNormalized: {
            x_min: 0.2,
            y_min: 0.15,
            x_max: 0.42,
            y_max: 0.54,
          },
          linkedOwner: owners[0] ?? null,
          exactFaceLink: owners[0]?.exactFaceLinks[0] ?? null,
          isHidden: false,
          isBlocked: false,
          isSuppressed: false,
          isManual: false,
          visualState: "linked_manual",
          showInOverlay: true,
          overlayTone: "manual",
        },
      ],
      selectedColumnId: "face:face-3",
      onSelectColumnId: () => {},
    }),
  );

  assert.match(markup, /Face 3/);
  assert.match(markup, /Manual link/);
  assert.match(markup, /Social/);
  assert.match(markup, /Granted/);
  assert.match(markup, /Usable/);
  assert.match(markup, /Print/);
  assert.match(markup, /Not granted/);
  assert.match(markup, /Blocked/);
  assert.doesNotMatch(markup, /Jordan Jones/);
  assert.doesNotMatch(markup, /jordan@example.com/);
  assert.doesNotMatch(markup, /Signed scopes/);
});

test("feature 077 released photo review surface uses linked-owner focus instead of review-context copy", () => {
  const owners: MediaLibraryUsagePermissionOwnerSummary[] = [
    {
      projectFaceAssigneeId: "assignee-1",
      displayName: "Jordan Jones",
      email: "jordan@example.com",
      identityKind: "project_consent",
      currentStatus: "active",
      effectiveScopes: [
        {
          templateKey: "usage",
          scopeKey: "social",
          label: "Social",
          status: "granted",
          governingSourceKind: "project_consent",
        },
      ],
      effectiveScopeCount: 1,
      nonGrantedEffectiveScopeCount: 0,
      hasNonGrantedEffectiveScopes: false,
      hasRestrictedState: false,
      exactFaceLinks: [
        {
          assetFaceId: "face-3",
          materializationId: "materialization-1",
          faceRank: 2,
          projectFaceAssigneeId: "assignee-1",
          identityKind: "project_consent",
          consentId: "consent-1",
          recurringProfileConsentId: null,
          projectProfileParticipantId: "participant-1",
          profileId: "profile-1",
          linkSource: "manual",
          matchConfidence: null,
        },
      ],
      hasWholeAssetLink: false,
      hasFallbackLink: false,
    },
  ];
  const overlaySummary: ReleasePhotoOverlaySummary = {
    faces: [
      {
        assetFaceId: "face-3",
        faceRank: 2,
        faceSource: "detector",
        faceBoxNormalized: {
          x_min: 0.2,
          y_min: 0.15,
          x_max: 0.42,
          y_max: 0.54,
        },
        linkedOwner: owners[0] ?? null,
        exactFaceLink: owners[0]?.exactFaceLinks[0] ?? null,
        isHidden: false,
        isBlocked: false,
        isSuppressed: false,
        isManual: false,
        visualState: "linked_manual",
        showInOverlay: true,
        overlayTone: "manual",
      },
    ],
    visibleFaces: [
      {
        assetFaceId: "face-3",
        faceRank: 2,
        faceSource: "detector",
        faceBoxNormalized: {
          x_min: 0.2,
          y_min: 0.15,
          x_max: 0.42,
          y_max: 0.54,
        },
        linkedOwner: owners[0] ?? null,
        exactFaceLink: owners[0]?.exactFaceLinks[0] ?? null,
        isHidden: false,
        isBlocked: false,
        isSuppressed: false,
        isManual: false,
        visualState: "linked_manual",
        showInOverlay: true,
        overlayTone: "manual",
      },
    ],
    omittedHiddenFaceCount: 1,
    missingGeometryFaceCount: 0,
  };

  const markup = renderWithMessages(
    createElement(ReleasedPhotoReviewSurface, {
      src: "https://example.com/release-photo.jpg",
      alt: "release-photo.jpg",
      overlaySummary,
      owners,
    }),
  );

  assert.match(markup, /Face 3/);
  assert.match(markup, /Manual link/);
  assert.match(markup, /Usage permissions/);
  assert.match(markup, /hidden face is omitted from the released preview overlay/i);
  assert.doesNotMatch(markup, /Jordan Jones/);
  assert.doesNotMatch(markup, /jordan@example.com/);
  assert.doesNotMatch(markup, /Release review context/);
  assert.doesNotMatch(markup, /Snapshot notes/);
  assert.doesNotMatch(markup, /Released asset preview/);
});

test("feature 077 advisory download confirmation only gates blocked or restricted state", () => {
  let confirmCalls = 0;

  assert.equal(
    shouldContinueMediaLibraryDownload({
      requiresConfirmation: false,
      confirmationMessage: "unused",
      confirmImpl: () => {
        confirmCalls += 1;
        return false;
      },
    }),
    true,
  );
  assert.equal(confirmCalls, 0);

  assert.equal(
    shouldContinueMediaLibraryDownload({
      requiresConfirmation: true,
      confirmationMessage: "restricted asset",
      confirmImpl: () => {
        confirmCalls += 1;
        return false;
      },
    }),
    false,
  );
  assert.equal(confirmCalls, 1);

  assert.equal(
    shouldContinueMediaLibraryDownload({
      requiresConfirmation: true,
      confirmationMessage: "restricted asset",
      confirmImpl: () => {
        confirmCalls += 1;
        return true;
      },
    }),
    true,
  );
  assert.equal(confirmCalls, 2);
});

test("feature 077 download button still renders a direct link", () => {
  const markup = renderWithMessages(
    createElement(MediaLibraryDownloadButton, {
      href: "/api/media-library/assets/release-asset-1/download",
      label: "Download original",
      className: "download-button",
      requiresConfirmation: true,
      confirmationMessage: "restricted asset",
    }),
  );

  assert.match(markup, /href="\/api\/media-library\/assets\/release-asset-1\/download"/);
  assert.match(markup, /Download original/);
});
