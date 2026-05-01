import type { NormalizedFaceBox } from "@/lib/client/face-overlay";
import type { ProjectReleaseAssetRow } from "@/lib/project-releases/types";

import { buildMediaLibraryUsagePermissionSummaries, collectSuppressedFaceIds } from "@/lib/project-releases/media-library-release-safety";

export type ReleasePhotoFaceVisualState =
  | "blocked"
  | "linked_manual"
  | "linked_auto"
  | "manual_unlinked"
  | "unlinked"
  | "hidden";

export type ReleasePhotoFaceContext = {
  assetFaceId: string;
  faceRank: number;
  faceSource: "detector" | "manual";
  faceBoxNormalized: NormalizedFaceBox;
  linkedOwner: ReturnType<typeof buildMediaLibraryUsagePermissionSummaries>[number] | null;
  exactFaceLink: ProjectReleaseAssetRow["link_snapshot"]["exactFaceLinks"][number] | null;
  isHidden: boolean;
  isBlocked: boolean;
  isSuppressed: boolean;
  isManual: boolean;
  visualState: ReleasePhotoFaceVisualState;
  showInOverlay: boolean;
  overlayTone: "blocked" | "manual" | "auto" | "unlinked" | null;
};

export type ReleasePhotoOverlaySummary = {
  faces: ReleasePhotoFaceContext[];
  visibleFaces: ReleasePhotoFaceContext[];
  omittedHiddenFaceCount: number;
  missingGeometryFaceCount: number;
};

function toFiniteNumber(value: unknown) {
  const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function parseNormalizedFaceBox(
  faceBox: Record<string, unknown> | null,
): NormalizedFaceBox {
  if (!faceBox) {
    return null;
  }

  const xMin = toFiniteNumber(faceBox.x_min);
  const yMin = toFiniteNumber(faceBox.y_min);
  const xMax = toFiniteNumber(faceBox.x_max);
  const yMax = toFiniteNumber(faceBox.y_max);

  if (xMin === null || yMin === null || xMax === null || yMax === null || xMin >= xMax || yMin >= yMax) {
    return null;
  }

  return {
    x_min: Math.max(0, Math.min(1, xMin)),
    y_min: Math.max(0, Math.min(1, yMin)),
    x_max: Math.max(0, Math.min(1, xMax)),
    y_max: Math.max(0, Math.min(1, yMax)),
  };
}

function normalizeRawFaceBox(input: {
  faceBox: Record<string, unknown>;
  sourceImageWidth: number | null;
  sourceImageHeight: number | null;
}): NormalizedFaceBox {
  const sourceImageWidth = input.sourceImageWidth;
  const sourceImageHeight = input.sourceImageHeight;
  if (!sourceImageWidth || !sourceImageHeight || sourceImageWidth <= 0 || sourceImageHeight <= 0) {
    return null;
  }

  const rawXMin = toFiniteNumber(input.faceBox.x_min ?? input.faceBox.xMin);
  const rawYMin = toFiniteNumber(input.faceBox.y_min ?? input.faceBox.yMin);
  const rawXMax = toFiniteNumber(input.faceBox.x_max ?? input.faceBox.xMax);
  const rawYMax = toFiniteNumber(input.faceBox.y_max ?? input.faceBox.yMax);

  if (
    rawXMin === null
    || rawYMin === null
    || rawXMax === null
    || rawYMax === null
    || rawXMin >= rawXMax
    || rawYMin >= rawYMax
  ) {
    return null;
  }

  return parseNormalizedFaceBox({
    x_min: rawXMin / sourceImageWidth,
    y_min: rawYMin / sourceImageHeight,
    x_max: rawXMax / sourceImageWidth,
    y_max: rawYMax / sourceImageHeight,
  });
}

function resolveFaceBoxNormalized(
  row: Pick<ProjectReleaseAssetRow, "asset_metadata_snapshot">,
  face: ProjectReleaseAssetRow["review_snapshot"]["faces"][number],
) {
  const normalized = parseNormalizedFaceBox(face.faceBoxNormalized);
  if (normalized) {
    return normalized;
  }

  return normalizeRawFaceBox({
    faceBox: face.faceBox,
    sourceImageWidth: row.asset_metadata_snapshot.photoMaterialization?.sourceImageWidth ?? null,
    sourceImageHeight: row.asset_metadata_snapshot.photoMaterialization?.sourceImageHeight ?? null,
  });
}

function getFaceVisualState(input: {
  isHidden: boolean;
  isBlocked: boolean;
  exactFaceLink: ProjectReleaseAssetRow["link_snapshot"]["exactFaceLinks"][number] | null;
  isManual: boolean;
}): ReleasePhotoFaceVisualState {
  if (input.isHidden) {
    return "hidden";
  }

  if (input.isBlocked) {
    return "blocked";
  }

  if (input.exactFaceLink?.linkSource === "manual") {
    return "linked_manual";
  }

  if (input.exactFaceLink?.linkSource === "auto") {
    return "linked_auto";
  }

  if (input.isManual) {
    return "manual_unlinked";
  }

  return "unlinked";
}

function getOverlayTone(visualState: ReleasePhotoFaceVisualState) {
  switch (visualState) {
    case "blocked":
      return "blocked";
    case "linked_manual":
    case "manual_unlinked":
      return "manual";
    case "linked_auto":
      return "auto";
    case "unlinked":
      return "unlinked";
    case "hidden":
      return null;
    default:
      return null;
  }
}

export function buildReleasePhotoOverlaySummary(
  row: Pick<ProjectReleaseAssetRow, "asset_metadata_snapshot" | "consent_snapshot" | "link_snapshot" | "review_snapshot" | "scope_snapshot">,
): ReleasePhotoOverlaySummary {
  const hiddenFaceIds = new Set(row.review_snapshot.hiddenFaces.map((face) => face.assetFaceId));
  const blockedFaceIds = new Set(row.review_snapshot.blockedFaces.map((face) => face.assetFaceId));
  const manualFaceIds = new Set(row.review_snapshot.manualFaces.map((face) => face.assetFaceId));
  const suppressedFaceIds = new Set(collectSuppressedFaceIds(row.review_snapshot));
  const exactFaceLinkByFaceId = new Map(
    row.link_snapshot.exactFaceLinks.map((link) => [link.assetFaceId, link] as const),
  );
  const usageOwnerByAssigneeId = new Map(
    buildMediaLibraryUsagePermissionSummaries(row).map((owner) => [owner.projectFaceAssigneeId, owner] as const),
  );

  let missingGeometryFaceCount = 0;
  const faces = [...row.review_snapshot.faces]
    .sort((left, right) => left.faceRank - right.faceRank)
    .map((face) => {
      const exactFaceLink = exactFaceLinkByFaceId.get(face.assetFaceId) ?? null;
      const linkedOwner = exactFaceLink
        ? usageOwnerByAssigneeId.get(exactFaceLink.projectFaceAssigneeId) ?? null
        : null;
      const isManual = manualFaceIds.has(face.assetFaceId) || face.faceSource === "manual";
      const visualState = getFaceVisualState({
        isHidden: hiddenFaceIds.has(face.assetFaceId),
        isBlocked: blockedFaceIds.has(face.assetFaceId),
        exactFaceLink,
        isManual,
      });
      const faceBoxNormalized = resolveFaceBoxNormalized(row, face);
      const showInOverlay = visualState !== "hidden" && Boolean(faceBoxNormalized);

      if (visualState !== "hidden" && !faceBoxNormalized) {
        missingGeometryFaceCount += 1;
      }

      return {
        assetFaceId: face.assetFaceId,
        faceRank: face.faceRank,
        faceSource: face.faceSource,
        faceBoxNormalized,
        linkedOwner,
        exactFaceLink,
        isHidden: hiddenFaceIds.has(face.assetFaceId),
        isBlocked: blockedFaceIds.has(face.assetFaceId),
        isSuppressed: suppressedFaceIds.has(face.assetFaceId),
        isManual,
        visualState,
        showInOverlay,
        overlayTone: getOverlayTone(visualState),
      } satisfies ReleasePhotoFaceContext;
    });

  return {
    faces,
    visibleFaces: faces.filter((face) => face.showInOverlay),
    omittedHiddenFaceCount: faces.filter((face) => face.visualState === "hidden").length,
    missingGeometryFaceCount,
  };
}
