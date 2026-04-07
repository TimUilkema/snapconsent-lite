import type { SupabaseClient } from "@supabase/supabase-js";

import { queueAssetImageDerivativesForAssetIds } from "@/lib/assets/asset-image-derivatives";
import { getCurrentConsentHeadshotFanoutBoundary } from "@/lib/matching/auto-match-fanout-continuations";
import { enqueuePhotoUploadedJob } from "@/lib/matching/auto-match-jobs";
import { shouldEnqueuePhotoUploadedOnFinalize } from "@/lib/matching/auto-match-trigger-conditions";

type QueueProjectAssetPostFinalizeProcessingInput = {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  assetId: string;
  assetType: "photo" | "headshot";
  consentIds: string[];
  source: "photo_finalize" | "photo_finalize_batch";
};

export async function queueProjectAssetPostFinalizeProcessing(
  input: QueueProjectAssetPostFinalizeProcessingInput,
) {
  if (input.assetType === "photo") {
    try {
      await queueAssetImageDerivativesForAssetIds({
        tenantId: input.tenantId,
        projectId: input.projectId,
        assetIds: [input.assetId],
      });
    } catch (error) {
      console.error("[assets][post-finalize] derivative_enqueue_failed", {
        tenantId: input.tenantId,
        projectId: input.projectId,
        assetId: input.assetId,
        source: input.source,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (!shouldEnqueuePhotoUploadedOnFinalize(input.assetType)) {
    return;
  }

  try {
    const boundary = await getCurrentConsentHeadshotFanoutBoundary(
      input.supabase,
      input.tenantId,
      input.projectId,
    );
    await enqueuePhotoUploadedJob({
      tenantId: input.tenantId,
      projectId: input.projectId,
      assetId: input.assetId,
      payload: {
        source: input.source,
        consent_ids: input.consentIds,
        boundarySnapshotAt: boundary.boundarySnapshotAt,
        boundaryConsentCreatedAt: boundary.boundaryConsentCreatedAt,
        boundaryConsentId: boundary.boundaryConsentId,
      },
    });
  } catch {
    // Primary finalize flow must still succeed; reconcile backfills missed jobs.
  }
}
