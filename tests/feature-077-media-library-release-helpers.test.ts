import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMediaLibraryUsagePermissionSummaries,
  deriveMediaLibraryReleaseSafety,
} from "../src/lib/project-releases/media-library-release-safety";
import { buildMediaLibraryUsagePermissionTable } from "../src/lib/project-releases/media-library-usage-permission-table";
import { buildReleasePhotoOverlaySummary } from "../src/lib/project-releases/media-library-release-overlays";
import type { ProjectReleaseAssetRow } from "../src/lib/project-releases/types";

function createReleaseAssetRow(
  overrides: Partial<ProjectReleaseAssetRow> & {
    consent_snapshot?: Partial<ProjectReleaseAssetRow["consent_snapshot"]>;
    link_snapshot?: Partial<ProjectReleaseAssetRow["link_snapshot"]>;
    review_snapshot?: Partial<ProjectReleaseAssetRow["review_snapshot"]>;
    scope_snapshot?: Partial<ProjectReleaseAssetRow["scope_snapshot"]>;
    asset_metadata_snapshot?: Partial<ProjectReleaseAssetRow["asset_metadata_snapshot"]>;
  } = {},
): ProjectReleaseAssetRow {
  const {
    consent_snapshot,
    link_snapshot,
    review_snapshot,
    scope_snapshot,
    asset_metadata_snapshot,
    ...rowOverrides
  } = overrides;

  return {
    id: "release-asset-1",
    tenant_id: "tenant-1",
    release_id: "release-1",
    project_id: "project-1",
    workspace_id: "workspace-1",
    source_asset_id: "asset-1",
    asset_type: "photo",
    original_filename: "released-photo.jpg",
    original_storage_bucket: "project-assets",
    original_storage_path: "tenant/t1/project/p1/asset/a1/released-photo.jpg",
    content_type: "image/jpeg",
    file_size_bytes: 2048,
    uploaded_at: "2026-04-25T10:00:00.000Z",
    created_at: "2026-04-25T10:05:00.000Z",
    asset_metadata_snapshot: {
      schemaVersion: 1,
      sourceAsset: {
        assetId: "asset-1",
        assetType: "photo",
        originalFilename: "released-photo.jpg",
        contentType: "image/jpeg",
        fileSizeBytes: 2048,
        uploadedAt: "2026-04-25T10:00:00.000Z",
        storageBucket: "project-assets",
        storagePath: "tenant/t1/project/p1/asset/a1/released-photo.jpg",
      },
      photoMaterialization: {
        materializationId: "materialization-1",
        materializerVersion: "v1",
        provider: "test-provider",
        providerMode: "detection",
        faceCount: 4,
        sourceImageWidth: 1000,
        sourceImageHeight: 500,
        sourceCoordinateSpace: "oriented_original",
      },
      ...asset_metadata_snapshot,
    },
    workspace_snapshot: {
      schemaVersion: 1,
      project: {
        id: "project-1",
        name: "Project 1",
        status: "active",
        finalizedAt: "2026-04-25T09:00:00.000Z",
        finalizedBy: "user-1",
      },
      workspace: {
        id: "workspace-1",
        name: "Main workspace",
        workspaceKind: "default",
      },
      release: {
        releaseId: "release-1",
        releaseVersion: 1,
        createdAt: "2026-04-25T10:05:00.000Z",
        snapshotCreatedAt: "2026-04-25T10:05:00.000Z",
      },
    },
    consent_snapshot: {
      schemaVersion: 1,
      linkedOwners: [],
      linkedPeopleCount: 0,
      ...consent_snapshot,
    },
    link_snapshot: {
      schemaVersion: 1,
      exactFaceLinks: [],
      wholeAssetLinks: [],
      fallbackLinks: [],
      ...link_snapshot,
    },
    review_snapshot: {
      schemaVersion: 1,
      faces: [],
      hiddenFaces: [],
      blockedFaces: [],
      faceLinkSuppressions: [],
      assigneeLinkSuppressions: [],
      manualFaces: [],
      ...review_snapshot,
    },
    scope_snapshot: {
      schemaVersion: 1,
      owners: [],
      ...scope_snapshot,
    },
    ...rowOverrides,
  };
}

test("feature 077 release safety treats blocked and restricted as advisory confirmation state", () => {
  const row = createReleaseAssetRow({
    consent_snapshot: {
      linkedOwners: [
        {
          projectFaceAssigneeId: "assignee-1",
          identityKind: "project_consent",
          consentId: "consent-1",
          recurringProfileConsentId: null,
          projectProfileParticipantId: null,
          profileId: null,
          displayName: "Alex Active",
          email: "alex@example.com",
          currentStatus: "active",
          signedAt: "2026-04-24T10:00:00.000Z",
          consentVersion: "v1",
          faceMatchOptIn: true,
        },
        {
          projectFaceAssigneeId: "assignee-2",
          identityKind: "project_consent",
          consentId: "consent-2",
          recurringProfileConsentId: null,
          projectProfileParticipantId: null,
          profileId: null,
          displayName: "Riley Revoked",
          email: "riley@example.com",
          currentStatus: "revoked",
          signedAt: "2026-04-24T10:00:00.000Z",
          consentVersion: "v1",
          faceMatchOptIn: true,
        },
      ],
      linkedPeopleCount: 2,
    },
    review_snapshot: {
      faces: [
        {
          assetFaceId: "face-1",
          materializationId: "materialization-1",
          faceRank: 0,
          faceSource: "manual",
          detectionProbability: null,
          faceBox: { x_min: 100, y_min: 50, x_max: 240, y_max: 230 },
          faceBoxNormalized: null,
        },
        {
          assetFaceId: "face-2",
          materializationId: "materialization-1",
          faceRank: 1,
          faceSource: "detector",
          detectionProbability: 0.98,
          faceBox: { x_min: 300, y_min: 60, x_max: 420, y_max: 220 },
          faceBoxNormalized: { x_min: 0.3, y_min: 0.12, x_max: 0.42, y_max: 0.44 },
        },
      ],
      blockedFaces: [{ assetFaceId: "face-2", blockedAt: "2026-04-25T10:10:00.000Z", reason: "no_consent" }],
      hiddenFaces: [{ assetFaceId: "face-1", hiddenAt: "2026-04-25T10:11:00.000Z" }],
      faceLinkSuppressions: [{ assetFaceId: "face-1", projectFaceAssigneeId: "assignee-1" }],
      assigneeLinkSuppressions: [{ assetFaceId: "face-2", projectFaceAssigneeId: "assignee-2" }],
      manualFaces: [{ assetFaceId: "face-1", faceRank: 0 }],
    },
    scope_snapshot: {
      owners: [
        {
          projectFaceAssigneeId: "assignee-1",
          identityKind: "project_consent",
          consentId: "consent-1",
          recurringProfileConsentId: null,
          projectProfileParticipantId: null,
          effectiveScopes: [
            {
              templateKey: "usage",
              scopeKey: "web",
              label: "Website",
              status: "granted",
              governingSourceKind: "project_consent",
            },
          ],
          signedScopes: [],
        },
        {
          projectFaceAssigneeId: "assignee-2",
          identityKind: "project_consent",
          consentId: "consent-2",
          recurringProfileConsentId: null,
          projectProfileParticipantId: null,
          effectiveScopes: [
            {
              templateKey: "usage",
              scopeKey: "print",
              label: "Print",
              status: "not_collected",
              governingSourceKind: "project_consent",
            },
          ],
          signedScopes: [],
        },
      ],
    },
  });

  const summary = deriveMediaLibraryReleaseSafety(row);

  assert.equal(summary.blockedFaceCount, 1);
  assert.equal(summary.hiddenFaceCount, 1);
  assert.equal(summary.suppressedFaceCount, 2);
  assert.equal(summary.manualFaceCount, 1);
  assert.equal(summary.revokedLinkedOwnerCount, 1);
  assert.equal(summary.nonGrantedEffectiveScopeCount, 1);
  assert.equal(summary.hasBlockedFaces, true);
  assert.equal(summary.hasRestrictedState, true);
  assert.equal(summary.hasLowLevelReviewContext, true);
  assert.equal(summary.requiresDownloadConfirmation, true);
  assert.equal(summary.primaryState, "blocked");
  assert.deepEqual(summary.badges, ["blocked", "manual"]);
});

test("feature 077 release safety does not promote non-granted scopes into a list restricted badge", () => {
  const row = createReleaseAssetRow({
    scope_snapshot: {
      owners: [
        {
          projectFaceAssigneeId: "assignee-1",
          identityKind: "project_consent",
          consentId: "consent-1",
          recurringProfileConsentId: null,
          projectProfileParticipantId: null,
          effectiveScopes: [
            {
              templateKey: "usage",
              scopeKey: "print",
              label: "Print",
              status: "not_granted",
              governingSourceKind: "project_consent",
            },
          ],
          signedScopes: [],
        },
      ],
    },
  });

  const summary = deriveMediaLibraryReleaseSafety(row);

  assert.equal(summary.hasRestrictedState, true);
  assert.equal(summary.hasNonGrantedEffectiveScopes, true);
  assert.equal(summary.requiresDownloadConfirmation, true);
  assert.equal(summary.primaryState, "restricted");
  assert.deepEqual(summary.badges, []);
});

test("feature 077 hidden, suppressed, and manual-only state stays low-level context", () => {
  const hiddenOnly = createReleaseAssetRow({
    review_snapshot: {
      faces: [
        {
          assetFaceId: "face-1",
          materializationId: "materialization-1",
          faceRank: 0,
          faceSource: "detector",
          detectionProbability: 0.92,
          faceBox: { x_min: 100, y_min: 60, x_max: 240, y_max: 200 },
          faceBoxNormalized: { x_min: 0.1, y_min: 0.12, x_max: 0.24, y_max: 0.4 },
        },
      ],
      hiddenFaces: [{ assetFaceId: "face-1", hiddenAt: "2026-04-25T10:11:00.000Z" }],
      faceLinkSuppressions: [{ assetFaceId: "face-1", projectFaceAssigneeId: "assignee-1" }],
      manualFaces: [],
    },
  });
  const manualOnly = createReleaseAssetRow({
    review_snapshot: {
      faces: [
        {
          assetFaceId: "face-2",
          materializationId: "materialization-1",
          faceRank: 1,
          faceSource: "manual",
          detectionProbability: null,
          faceBox: { x_min: 200, y_min: 50, x_max: 260, y_max: 150 },
          faceBoxNormalized: { x_min: 0.2, y_min: 0.1, x_max: 0.26, y_max: 0.3 },
        },
      ],
      manualFaces: [{ assetFaceId: "face-2", faceRank: 1 }],
    },
  });

  const hiddenSummary = deriveMediaLibraryReleaseSafety(hiddenOnly);
  const manualSummary = deriveMediaLibraryReleaseSafety(manualOnly);

  assert.equal(hiddenSummary.hasRestrictedState, false);
  assert.equal(hiddenSummary.requiresDownloadConfirmation, false);
  assert.deepEqual(hiddenSummary.badges, []);
  assert.equal(hiddenSummary.hasLowLevelReviewContext, true);

  assert.equal(manualSummary.hasRestrictedState, false);
  assert.equal(manualSummary.requiresDownloadConfirmation, false);
  assert.deepEqual(manualSummary.badges, ["manual"]);
  assert.equal(manualSummary.hasLowLevelReviewContext, true);
});

test("feature 077 usage permissions join exact-face links to linked owners and effective scopes", () => {
  const row = createReleaseAssetRow({
    consent_snapshot: {
      linkedOwners: [
        {
          projectFaceAssigneeId: "assignee-1",
          identityKind: "project_consent",
          consentId: "consent-1",
          recurringProfileConsentId: null,
          projectProfileParticipantId: "participant-1",
          profileId: "profile-1",
          displayName: "Jordan Jones",
          email: "jordan@example.com",
          currentStatus: "active",
          signedAt: "2026-04-24T10:00:00.000Z",
          consentVersion: "v1",
          faceMatchOptIn: true,
        },
      ],
      linkedPeopleCount: 1,
    },
    link_snapshot: {
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
      wholeAssetLinks: [
        {
          projectFaceAssigneeId: "assignee-1",
          identityKind: "project_consent",
          consentId: "consent-1",
          recurringProfileConsentId: null,
          projectProfileParticipantId: "participant-1",
          profileId: "profile-1",
          linkSource: "manual",
        },
      ],
      fallbackLinks: [{ consentId: "consent-1", projectFaceAssigneeId: "assignee-1" }],
    },
    scope_snapshot: {
      owners: [
        {
          projectFaceAssigneeId: "assignee-1",
          identityKind: "project_consent",
          consentId: "consent-1",
          recurringProfileConsentId: null,
          projectProfileParticipantId: "participant-1",
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
          signedScopes: [],
        },
      ],
    },
  });

  const owners = buildMediaLibraryUsagePermissionSummaries(row);

  assert.equal(owners.length, 1);
  assert.equal(owners[0]?.displayName, "Jordan Jones");
  assert.equal(owners[0]?.effectiveScopeCount, 2);
  assert.equal(owners[0]?.nonGrantedEffectiveScopeCount, 1);
  assert.equal(owners[0]?.hasRestrictedState, true);
  assert.equal(owners[0]?.exactFaceLinks.length, 1);
  assert.equal(owners[0]?.exactFaceLinks[0]?.assetFaceId, "face-3");
  assert.equal(owners[0]?.hasWholeAssetLink, true);
  assert.equal(owners[0]?.hasFallbackLink, true);
});

test("feature 077 usage permission table aggregates released scope state by neutral face column", () => {
  const row = createReleaseAssetRow({
    consent_snapshot: {
      linkedOwners: [
        {
          projectFaceAssigneeId: "assignee-1",
          identityKind: "project_consent",
          consentId: "consent-1",
          recurringProfileConsentId: null,
          projectProfileParticipantId: null,
          profileId: null,
          displayName: "Jordan Jones",
          email: "jordan@example.com",
          currentStatus: "active",
          signedAt: "2026-04-24T10:00:00.000Z",
          consentVersion: "v1",
          faceMatchOptIn: true,
        },
        {
          projectFaceAssigneeId: "assignee-2",
          identityKind: "project_consent",
          consentId: "consent-2",
          recurringProfileConsentId: null,
          projectProfileParticipantId: null,
          profileId: null,
          displayName: "Riley Revoked",
          email: "riley@example.com",
          currentStatus: "revoked",
          signedAt: "2026-04-24T10:00:00.000Z",
          consentVersion: "v1",
          faceMatchOptIn: true,
        },
      ],
      linkedPeopleCount: 2,
    },
    link_snapshot: {
      exactFaceLinks: [
        {
          assetFaceId: "face-1",
          materializationId: "materialization-1",
          faceRank: 0,
          projectFaceAssigneeId: "assignee-1",
          identityKind: "project_consent",
          consentId: "consent-1",
          recurringProfileConsentId: null,
          projectProfileParticipantId: null,
          profileId: null,
          linkSource: "auto",
          matchConfidence: 0.97,
        },
        {
          assetFaceId: "face-2",
          materializationId: "materialization-1",
          faceRank: 1,
          projectFaceAssigneeId: "assignee-2",
          identityKind: "project_consent",
          consentId: "consent-2",
          recurringProfileConsentId: null,
          projectProfileParticipantId: null,
          profileId: null,
          linkSource: "manual",
          matchConfidence: null,
        },
      ],
    },
    review_snapshot: {
      faces: [
        {
          assetFaceId: "face-1",
          materializationId: "materialization-1",
          faceRank: 0,
          faceSource: "detector",
          detectionProbability: 0.97,
          faceBox: { x_min: 10, y_min: 10, x_max: 40, y_max: 40 },
          faceBoxNormalized: { x_min: 0.1, y_min: 0.1, x_max: 0.4, y_max: 0.4 },
        },
        {
          assetFaceId: "face-2",
          materializationId: "materialization-1",
          faceRank: 1,
          faceSource: "detector",
          detectionProbability: 0.92,
          faceBox: { x_min: 50, y_min: 10, x_max: 80, y_max: 40 },
          faceBoxNormalized: { x_min: 0.5, y_min: 0.1, x_max: 0.8, y_max: 0.4 },
        },
      ],
    },
    scope_snapshot: {
      owners: [
        {
          projectFaceAssigneeId: "assignee-1",
          identityKind: "project_consent",
          consentId: "consent-1",
          recurringProfileConsentId: null,
          projectProfileParticipantId: null,
          effectiveScopes: [
            {
              templateKey: "usage",
              scopeKey: "website",
              label: "Website",
              status: "granted",
              governingSourceKind: "project_consent",
            },
          ],
          signedScopes: [],
        },
        {
          projectFaceAssigneeId: "assignee-2",
          identityKind: "project_consent",
          consentId: "consent-2",
          recurringProfileConsentId: null,
          projectProfileParticipantId: null,
          effectiveScopes: [
            {
              templateKey: "usage",
              scopeKey: "website",
              label: "Website",
              status: "granted",
              governingSourceKind: "project_consent",
            },
          ],
          signedScopes: [],
        },
      ],
    },
  });
  const owners = buildMediaLibraryUsagePermissionSummaries(row);
  const faces = buildReleasePhotoOverlaySummary(row).visibleFaces;

  const table = buildMediaLibraryUsagePermissionTable({ owners, faces });

  assert.deepEqual(table.columns.map((column) => column.id), ["face:face-1", "face:face-2"]);
  assert.deepEqual(table.columns.map((column) => column.faceRank), [0, 1]);
  assert.equal(table.rows.length, 1);
  assert.deepEqual(table.rows[0]?.cells.map((cell) => cell.status), ["granted", "revoked"]);
  assert.equal(table.rows[0]?.finalStatus, "blocked");
});

test("feature 077 release overlays omit hidden faces and normalize raw geometry from snapshots only", () => {
  const row = createReleaseAssetRow({
    review_snapshot: {
      faces: [
        {
          assetFaceId: "face-visible-blocked",
          materializationId: "materialization-1",
          faceRank: 0,
          faceSource: "detector",
          detectionProbability: 0.99,
          faceBox: { x_min: 100, y_min: 50, x_max: 240, y_max: 230 },
          faceBoxNormalized: null,
        },
        {
          assetFaceId: "face-hidden",
          materializationId: "materialization-1",
          faceRank: 1,
          faceSource: "detector",
          detectionProbability: 0.95,
          faceBox: { x_min: 260, y_min: 40, x_max: 380, y_max: 200 },
          faceBoxNormalized: { x_min: 0.26, y_min: 0.08, x_max: 0.38, y_max: 0.4 },
        },
        {
          assetFaceId: "face-manual",
          materializationId: "materialization-1",
          faceRank: 2,
          faceSource: "manual",
          detectionProbability: null,
          faceBox: { xMin: 500, yMin: 100, xMax: 640, yMax: 250 },
          faceBoxNormalized: null,
        },
        {
          assetFaceId: "face-missing-geometry",
          materializationId: "materialization-1",
          faceRank: 3,
          faceSource: "detector",
          detectionProbability: 0.8,
          faceBox: { bad: true },
          faceBoxNormalized: null,
        },
      ],
      blockedFaces: [
        {
          assetFaceId: "face-visible-blocked",
          blockedAt: "2026-04-25T10:10:00.000Z",
          reason: "no_consent",
        },
      ],
      hiddenFaces: [{ assetFaceId: "face-hidden", hiddenAt: "2026-04-25T10:11:00.000Z" }],
      manualFaces: [{ assetFaceId: "face-manual", faceRank: 2 }],
      faceLinkSuppressions: [{ assetFaceId: "face-hidden", projectFaceAssigneeId: "assignee-1" }],
    },
  });

  const summary = buildReleasePhotoOverlaySummary(row);
  const visibleFaceIds = summary.visibleFaces.map((face) => face.assetFaceId);
  const blockedFace = summary.faces.find((face) => face.assetFaceId === "face-visible-blocked") ?? null;
  const manualFace = summary.faces.find((face) => face.assetFaceId === "face-manual") ?? null;
  const hiddenFace = summary.faces.find((face) => face.assetFaceId === "face-hidden") ?? null;

  assert.deepEqual(visibleFaceIds, ["face-visible-blocked", "face-manual"]);
  assert.equal(summary.omittedHiddenFaceCount, 1);
  assert.equal(summary.missingGeometryFaceCount, 1);
  assert.equal(blockedFace?.overlayTone, "blocked");
  assert.deepEqual(blockedFace?.faceBoxNormalized, {
    x_min: 0.1,
    y_min: 0.1,
    x_max: 0.24,
    y_max: 0.46,
  });
  assert.equal(manualFace?.overlayTone, "manual");
  assert.deepEqual(manualFace?.faceBoxNormalized, {
    x_min: 0.5,
    y_min: 0.2,
    x_max: 0.64,
    y_max: 0.5,
  });
  assert.equal(hiddenFace?.showInOverlay, false);
  assert.equal(hiddenFace?.visualState, "hidden");
});
