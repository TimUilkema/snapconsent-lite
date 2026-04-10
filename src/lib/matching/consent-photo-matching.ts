import type { SupabaseClient } from "@supabase/supabase-js";

export {
  assertConsentInProject,
  clearConsentAutoPhotoFaceLinks,
  clearConsentPhotoSuppressions,
  getManualPhotoLinkState,
  hideAssetFace,
  listLinkedFaceOverlaysForAssetIds,
  listLinkedPhotosForConsent,
  listMatchableProjectPhotosForConsent,
  loadCurrentHiddenFacesForAsset,
  listPhotoConsentAssignmentsForAssetIds,
  manualLinkPhotoToConsent,
  manualUnlinkPhotoFromConsent,
  MATCHABLE_PHOTOS_MODES,
  reconcilePhotoFaceCanonicalStateForAsset,
  restoreHiddenAssetFace,
} from "@/lib/matching/photo-face-linking";
export type {
  AssetLinkedFaceOverlayRow,
  HideAssetFaceResult,
  LinkedPhotoRow,
  MatchablePhotoPage,
  ManualPhotoLinkMode,
  ManualPhotoLinkResult,
  ManualPhotoLinkState,
  ManualPhotoUnlinkResult,
  MatchablePhotoRow,
  MatchablePhotosMode,
  PhotoConsentAssignment,
  RestoreHiddenAssetFaceResult,
} from "@/lib/matching/photo-face-linking";
import { HttpError } from "@/lib/http/errors";
import {
  manualLinkPhotoToConsent,
  manualUnlinkPhotoFromConsent,
} from "@/lib/matching/photo-face-linking";

type MatchingScopeInput = {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  consentId: string;
  actorUserId?: string | null;
};

type ModifyConsentPhotoLinksInput = MatchingScopeInput & {
  assetIds: string[];
};

const MAX_REQUEST_ASSET_IDS = 100;

function normalizeUniqueAssetIds(assetIds: string[]) {
  const unique = Array.from(
    new Set(
      assetIds
        .filter((assetId) => typeof assetId === "string")
        .map((assetId) => assetId.trim())
        .filter((assetId) => assetId.length > 0),
    ),
  );

  if (unique.length > MAX_REQUEST_ASSET_IDS) {
    throw new HttpError(400, "invalid_asset_ids_too_large", "Too many asset IDs were provided.");
  }

  return unique;
}

export async function linkPhotosToConsent(input: ModifyConsentPhotoLinksInput) {
  const assetIds = normalizeUniqueAssetIds(input.assetIds);
  for (const assetId of assetIds) {
    await manualLinkPhotoToConsent({
      ...input,
      assetId,
      mode: "auto",
    });
  }

  return {
    linkedCount: assetIds.length,
  };
}

export async function unlinkPhotosFromConsent(input: ModifyConsentPhotoLinksInput) {
  const assetIds = normalizeUniqueAssetIds(input.assetIds);
  for (const assetId of assetIds) {
    await manualUnlinkPhotoFromConsent({
      ...input,
      assetId,
      mode: "auto",
    });
  }

  return {
    unlinkedCount: assetIds.length,
  };
}
