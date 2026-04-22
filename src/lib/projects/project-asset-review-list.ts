export type ProjectAssetReviewStatus = "needs_review" | "blocked" | "resolved";

export type ProjectAssetReviewFilter = "all" | "needs_review" | "blocked" | "resolved";

export type ProjectAssetListSort =
  | "created_at_desc"
  | "created_at_asc"
  | "file_size_desc"
  | "file_size_asc"
  | "needs_review_first";

export type ProjectAssetReviewListEntry = {
  asset: {
    id: string;
    created_at: string;
    file_size_bytes: number;
  };
  review: {
    assetId: string;
    reviewStatus: ProjectAssetReviewStatus;
    unresolvedFaceCount: number;
    blockedFaceCount: number;
    firstNeedsReviewFaceId: string | null;
  };
};

export function buildProjectAssetReviewSummary(entries: ProjectAssetReviewListEntry[]) {
  return {
    totalAssetCount: entries.length,
    needsReviewAssetCount: entries.filter((entry) => entry.review.reviewStatus === "needs_review").length,
    blockedAssetCount: entries.filter((entry) => entry.review.reviewStatus === "blocked").length,
    resolvedAssetCount: entries.filter((entry) => entry.review.reviewStatus === "resolved").length,
  };
}

export function filterProjectAssetsByReview(
  entries: ProjectAssetReviewListEntry[],
  reviewFilter: ProjectAssetReviewFilter,
) {
  if (reviewFilter === "all") {
    return entries;
  }

  return entries.filter((entry) => entry.review.reviewStatus === reviewFilter);
}

export function sortProjectAssetsForList(
  entries: ProjectAssetReviewListEntry[],
  sort: ProjectAssetListSort,
) {
  const reviewStatusOrder: Record<ProjectAssetReviewStatus, number> = {
    needs_review: 0,
    blocked: 1,
    resolved: 2,
  };

  return entries.slice().sort((left, right) => {
    if (sort === "needs_review_first") {
      const statusOrderDifference =
        reviewStatusOrder[left.review.reviewStatus] - reviewStatusOrder[right.review.reviewStatus];
      if (statusOrderDifference !== 0) {
        return statusOrderDifference;
      }
    }

    switch (sort) {
      case "created_at_asc": {
        const createdDifference =
          new Date(left.asset.created_at).getTime() - new Date(right.asset.created_at).getTime();
        if (createdDifference !== 0) {
          return createdDifference;
        }
        break;
      }
      case "file_size_desc": {
        const sizeDifference = right.asset.file_size_bytes - left.asset.file_size_bytes;
        if (sizeDifference !== 0) {
          return sizeDifference;
        }

        const createdDifference =
          new Date(right.asset.created_at).getTime() - new Date(left.asset.created_at).getTime();
        if (createdDifference !== 0) {
          return createdDifference;
        }
        break;
      }
      case "file_size_asc": {
        const sizeDifference = left.asset.file_size_bytes - right.asset.file_size_bytes;
        if (sizeDifference !== 0) {
          return sizeDifference;
        }

        const createdDifference =
          new Date(right.asset.created_at).getTime() - new Date(left.asset.created_at).getTime();
        if (createdDifference !== 0) {
          return createdDifference;
        }
        break;
      }
      case "needs_review_first":
      case "created_at_desc":
      default: {
        const createdDifference =
          new Date(right.asset.created_at).getTime() - new Date(left.asset.created_at).getTime();
        if (createdDifference !== 0) {
          return createdDifference;
        }
        break;
      }
    }

    return left.asset.id.localeCompare(right.asset.id);
  });
}
