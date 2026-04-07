import { signFaceDerivativeUrls } from "@/lib/assets/sign-face-derivatives";
import { resolveSignedAssetDisplayUrlsForAssets } from "@/lib/assets/sign-asset-thumbnails";
import { loadFaceImageDerivativesForFaceIds } from "@/lib/matching/face-materialization";
import type {
  FaceReviewSessionItemReadModel,
  FaceReviewSessionReadModel,
} from "@/lib/matching/face-review-sessions";
import type { ManualPhotoLinkState } from "@/lib/matching/photo-face-linking";
import { resolveLoopbackStorageUrlForHostHeader } from "@/lib/url/resolve-loopback-storage-url";
import type { SupabaseClient } from "@supabase/supabase-js";

type ReviewAssetForSigning = {
  id: string;
  status: string;
  storage_bucket: string | null;
  storage_path: string | null;
};

export async function serializeFaceReviewSessionResponse(
  readModel: FaceReviewSessionReadModel,
  tenantId: string,
  projectId: string,
  requestHostHeader: string | null | undefined,
) {
  const uniqueAssets = new Map<string, ReviewAssetForSigning>();
  const derivatives = new Map<string, NonNullable<FaceReviewSessionItemReadModel["faces"][number]["cropDerivative"]>>();

  readModel.items.forEach((item) => {
    uniqueAssets.set(item.assetId, {
      id: item.assetId,
      status: item.asset.status,
      storage_bucket: item.asset.storageBucket,
      storage_path: item.asset.storagePath,
    });
    item.faces.forEach((face) => {
      if (face.cropDerivative) {
        derivatives.set(face.assetFaceId, face.cropDerivative);
      }
    });
  });

  const assets = Array.from(uniqueAssets.values());
  const thumbnailMap = await resolveSignedAssetDisplayUrlsForAssets(null, assets, {
    tenantId,
    projectId,
    use: "thumbnail",
    fallback: "transform",
    enqueueMissingDerivative: true,
  });
  const previewMap = await resolveSignedAssetDisplayUrlsForAssets(null, assets, {
    tenantId,
    projectId,
    use: "preview",
    fallback: "transform",
  });
  const derivativeMap = await signFaceDerivativeUrls(Array.from(derivatives.values()));

  return {
    session: readModel.session,
    items: readModel.items.map((item) => ({
      id: item.id,
      assetId: item.assetId,
      position: item.position,
      status: item.status,
      completionKind: item.completionKind,
      blockCode: item.blockCode,
      preparedMaterializationId: item.preparedMaterializationId,
      detectedFaceCount: item.detectedFaceCount,
      wasRematerialized: item.wasRematerialized,
      asset: {
        originalFilename: item.asset.originalFilename,
        thumbnailUrl: thumbnailMap.get(item.assetId)?.url
          ? resolveLoopbackStorageUrlForHostHeader(thumbnailMap.get(item.assetId)?.url ?? "", requestHostHeader)
          : null,
        thumbnailState: thumbnailMap.get(item.assetId)?.state ?? "unavailable",
        previewUrl: previewMap.get(item.assetId)?.url
          ? resolveLoopbackStorageUrlForHostHeader(previewMap.get(item.assetId)?.url ?? "", requestHostHeader)
          : null,
        previewState: previewMap.get(item.assetId)?.state ?? "unavailable",
      },
      faces: item.faces.map((face) => ({
        assetFaceId: face.assetFaceId,
        faceRank: face.faceRank,
        faceBoxNormalized: face.faceBoxNormalized,
        matchConfidence: face.matchConfidence,
        cropUrl: derivativeMap.get(face.assetFaceId)
          ? resolveLoopbackStorageUrlForHostHeader(derivativeMap.get(face.assetFaceId) ?? "", requestHostHeader)
          : null,
        status: face.status,
        currentAssignee: face.currentAssignee,
        isCurrentConsentFace: face.isCurrentConsentFace,
        isSuppressedForConsent: face.isSuppressedForConsent,
      })),
    })),
  };
}

export async function serializeManualPhotoLinkStateResponse(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  state: ManualPhotoLinkState;
  requestHostHeader: string | null | undefined;
}) {
  const derivatives = await loadFaceImageDerivativesForFaceIds(
    input.supabase,
    input.tenantId,
    input.projectId,
    input.state.faces.map((face) => face.assetFaceId),
  );
  const derivativeMap = await signFaceDerivativeUrls(Array.from(derivatives.values()));

  return {
    materializationStatus: input.state.materializationStatus,
    assetId: input.state.assetId,
    materializationId: input.state.materializationId,
    detectedFaceCount: input.state.detectedFaceCount,
    faces: input.state.faces.map((face) => ({
      assetFaceId: face.assetFaceId,
      faceRank: face.faceRank,
      faceBox: face.faceBox,
      faceBoxNormalized: face.faceBoxNormalized,
      matchConfidence: face.matchConfidence,
      cropUrl: derivativeMap.get(face.assetFaceId)
        ? resolveLoopbackStorageUrlForHostHeader(derivativeMap.get(face.assetFaceId) ?? "", input.requestHostHeader)
        : null,
      status: face.status,
      currentAssignee: face.currentAssignee,
      isSuppressedForConsent: face.isSuppressedForConsent,
      isCurrentConsentFace: face.isCurrentConsentFace,
    })),
    fallbackAllowed: input.state.fallbackAllowed,
    currentConsentLink: input.state.currentConsentLink,
  };
}
