export function shouldEnqueuePhotoUploadedOnFinalize(assetType: "photo" | "headshot") {
  return assetType === "photo";
}

type ConsentSubmitEnqueueConditionInput = {
  duplicate: boolean;
  faceMatchOptIn: boolean;
  headshotAssetId: string | null;
};

export function shouldEnqueueConsentHeadshotReadyOnSubmit(
  input: ConsentSubmitEnqueueConditionInput,
) {
  const hasHeadshotAssetId = String(input.headshotAssetId ?? "").trim().length > 0;
  return !input.duplicate && input.faceMatchOptIn && hasHeadshotAssetId;
}
