import assert from "node:assert/strict";
import test from "node:test";

import { getInitialSelectedFaceIdForReview } from "../src/components/projects/assets-list";
import {
  buildProjectAssetReviewSummary,
  filterProjectAssetsByReview,
  sortProjectAssetsForList,
  type ProjectAssetReviewListEntry as ProjectAssetListEntry,
} from "../src/lib/projects/project-asset-review-list";
import {
  buildPendingAssetReviewSummary,
  deriveAssetReviewSummaryForFaces,
} from "../src/lib/matching/asset-preview-linking";

function createAssetEntry(
  id: string,
  reviewStatus: ProjectAssetListEntry["review"]["reviewStatus"],
  createdAt: string,
  fileSizeBytes: number,
): ProjectAssetListEntry {
  return {
    asset: {
      id,
      created_at: createdAt,
      file_size_bytes: fileSizeBytes,
    },
    review: {
      assetId: id,
      reviewStatus,
      unresolvedFaceCount: reviewStatus === "needs_review" ? 1 : 0,
      blockedFaceCount: reviewStatus === "blocked" ? 1 : 0,
      firstNeedsReviewFaceId: reviewStatus === "needs_review" ? `${id}-face-1` : null,
    },
  };
}

test("feature 060 review derivation counts only unlinked faces as unresolved and keeps blocked separate", () => {
  const summary = deriveAssetReviewSummaryForFaces({
    assetId: "asset-1",
    faceIdsInRankOrder: ["face-hidden", "face-blocked", "face-linked", "face-unlinked"],
    hiddenFaceIds: new Set(["face-hidden"]),
    blockedFaceIds: new Set(["face-blocked"]),
    linkedFaceIds: new Set(["face-linked"]),
  });

  assert.equal(summary.reviewStatus, "needs_review");
  assert.equal(summary.unresolvedFaceCount, 1);
  assert.equal(summary.blockedFaceCount, 1);
  assert.equal(summary.firstNeedsReviewFaceId, "face-unlinked");
});

test("feature 060 review derivation treats linked and hidden faces as resolved and blocked-only assets as blocked", () => {
  const blockedOnly = deriveAssetReviewSummaryForFaces({
    assetId: "asset-blocked",
    faceIdsInRankOrder: ["face-blocked", "face-hidden"],
    hiddenFaceIds: new Set(["face-hidden"]),
    blockedFaceIds: new Set(["face-blocked"]),
    linkedFaceIds: new Set(),
  });
  assert.equal(blockedOnly.reviewStatus, "blocked");
  assert.equal(blockedOnly.unresolvedFaceCount, 0);
  assert.equal(blockedOnly.blockedFaceCount, 1);
  assert.equal(blockedOnly.firstNeedsReviewFaceId, null);

  const fullyResolved = deriveAssetReviewSummaryForFaces({
    assetId: "asset-resolved",
    faceIdsInRankOrder: ["face-linked", "face-hidden"],
    hiddenFaceIds: new Set(["face-hidden"]),
    blockedFaceIds: new Set(),
    linkedFaceIds: new Set(["face-linked"]),
  });
  assert.equal(fullyResolved.reviewStatus, "resolved");
  assert.equal(fullyResolved.unresolvedFaceCount, 0);
  assert.equal(fullyResolved.blockedFaceCount, 0);
  assert.equal(fullyResolved.firstNeedsReviewFaceId, null);

  const zeroFace = deriveAssetReviewSummaryForFaces({
    assetId: "asset-zero",
    faceIdsInRankOrder: [],
    hiddenFaceIds: new Set(),
    blockedFaceIds: new Set(),
    linkedFaceIds: new Set(),
  });
  assert.equal(zeroFace.reviewStatus, "resolved");
  assert.equal(zeroFace.unresolvedFaceCount, 0);
  assert.equal(zeroFace.blockedFaceCount, 0);
});

test("feature 060 keeps non-materialized assets pending instead of resolved", () => {
  assert.deepEqual(buildPendingAssetReviewSummary("asset-pending"), {
    assetId: "asset-pending",
    reviewStatus: "pending",
    unresolvedFaceCount: 0,
    blockedFaceCount: 0,
    firstNeedsReviewFaceId: null,
  });
});

test("feature 060 review summary counts and strict filters stay mutually exclusive", () => {
  const entries = [
    createAssetEntry("asset-needs-review", "needs_review", "2026-04-20T12:00:00.000Z", 20),
    {
      asset: {
        id: "asset-pending",
        created_at: "2026-04-20T11:30:00.000Z",
        file_size_bytes: 15,
      },
      review: buildPendingAssetReviewSummary("asset-pending"),
    },
    createAssetEntry("asset-blocked", "blocked", "2026-04-20T11:00:00.000Z", 10),
    createAssetEntry("asset-resolved", "resolved", "2026-04-20T10:00:00.000Z", 30),
    createAssetEntry("asset-needs-review-2", "needs_review", "2026-04-20T09:00:00.000Z", 40),
  ];

  assert.deepEqual(buildProjectAssetReviewSummary(entries), {
    totalAssetCount: 5,
    needsReviewAssetCount: 2,
    pendingAssetCount: 1,
    blockedAssetCount: 1,
    resolvedAssetCount: 1,
  });

  assert.deepEqual(
    filterProjectAssetsByReview(entries, "all").map((entry) => entry.asset.id),
    ["asset-needs-review", "asset-pending", "asset-blocked", "asset-resolved", "asset-needs-review-2"],
  );
  assert.deepEqual(
    filterProjectAssetsByReview(entries, "needs_review").map((entry) => entry.asset.id),
    ["asset-needs-review", "asset-needs-review-2"],
  );
  assert.deepEqual(
    filterProjectAssetsByReview(entries, "blocked").map((entry) => entry.asset.id),
    ["asset-blocked"],
  );
  assert.deepEqual(
    filterProjectAssetsByReview(entries, "resolved").map((entry) => entry.asset.id),
    ["asset-resolved"],
  );
});

test("feature 060 needs-review-first sorting prioritizes bucket order, then newest first", () => {
  const entries = [
    createAssetEntry("resolved-new", "resolved", "2026-04-20T14:00:00.000Z", 100),
    {
      asset: {
        id: "pending-between",
        created_at: "2026-04-20T13:30:00.000Z",
        file_size_bytes: 95,
      },
      review: buildPendingAssetReviewSummary("pending-between"),
    },
    createAssetEntry("blocked-mid", "blocked", "2026-04-20T13:00:00.000Z", 90),
    createAssetEntry("needs-review-old", "needs_review", "2026-04-20T12:00:00.000Z", 80),
    createAssetEntry("needs-review-new", "needs_review", "2026-04-20T15:00:00.000Z", 70),
  ];

  assert.deepEqual(
    sortProjectAssetsForList(entries, "needs_review_first").map((entry) => entry.asset.id),
    ["needs-review-new", "needs-review-old", "blocked-mid", "pending-between", "resolved-new"],
  );
});

test("feature 060 preselects the first unresolved face only from needs-review context", () => {
  assert.equal(
    getInitialSelectedFaceIdForReview("needs_review", {
      firstNeedsReviewFaceId: "asset-face-1",
    }),
    "asset-face-1",
  );
  assert.equal(
    getInitialSelectedFaceIdForReview("all", {
      firstNeedsReviewFaceId: "asset-face-1",
    }),
    null,
  );
  assert.equal(
    getInitialSelectedFaceIdForReview("blocked", {
      firstNeedsReviewFaceId: "asset-face-1",
    }),
    null,
  );
  assert.equal(
    getInitialSelectedFaceIdForReview("resolved", {
      firstNeedsReviewFaceId: "asset-face-1",
    }),
    null,
  );
});
