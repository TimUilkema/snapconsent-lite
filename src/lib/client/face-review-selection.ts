type SelectableFace = {
  assetFaceId: string;
  faceRank?: number | null;
  status: "current" | "occupied_manual" | "occupied_auto" | "suppressed" | "available";
  isCurrentConsentFace: boolean;
};

type InitialFaceSelectionOptions = {
  preferredAssetFaceId?: string | null;
  preferredFaceRank?: number | null;
};

function normalizePreferredFaceRank(value: number | null | undefined) {
  return Number.isInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

export function getInitialSelectedFaceId(
  faces: SelectableFace[],
  options?: InitialFaceSelectionOptions,
) {
  if (faces.length === 0) {
    return null;
  }

  const preferredAssetFaceId = options?.preferredAssetFaceId?.trim() ?? null;
  if (preferredAssetFaceId) {
    const preferredFace = faces.find((face) => face.assetFaceId === preferredAssetFaceId) ?? null;
    if (preferredFace) {
      return preferredFace.assetFaceId;
    }
  }

  const preferredFaceRank = normalizePreferredFaceRank(options?.preferredFaceRank);
  if (preferredFaceRank !== null) {
    const preferredFace = faces.find((face) => face.faceRank === preferredFaceRank) ?? null;
    if (preferredFace) {
      return preferredFace.assetFaceId;
    }
  }

  return (
    faces.find((face) => face.isCurrentConsentFace)?.assetFaceId ??
    faces.find((face) => face.status === "available")?.assetFaceId ??
    faces[0]?.assetFaceId ??
    null
  );
}
