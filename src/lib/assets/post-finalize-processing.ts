import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { queueAssetImageDerivativesForAssetIds } from "@/lib/assets/asset-image-derivatives";
import { HttpError } from "@/lib/http/errors";
import { getCurrentConsentHeadshotFanoutBoundary } from "@/lib/matching/auto-match-fanout-continuations";
import { enqueuePhotoUploadedJob } from "@/lib/matching/auto-match-jobs";
import { getCurrentProjectRecurringSourceBoundary } from "@/lib/matching/project-recurring-sources";
import { shouldEnqueuePhotoUploadedOnFinalize } from "@/lib/matching/auto-match-trigger-conditions";

type QueueProjectAssetPostFinalizeProcessingInput = {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  workspaceId?: string | null;
  assetId: string;
  assetType: "photo" | "headshot" | "video";
  consentIds: string[];
  source: "photo_finalize" | "photo_finalize_batch";
};

function createMatchingAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new HttpError(500, "supabase_admin_not_configured", "Missing Supabase service role configuration.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function queueProjectAssetPostFinalizeProcessing(
  input: QueueProjectAssetPostFinalizeProcessingInput,
) {
  if (input.assetType === "photo" || input.assetType === "video") {
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
    const matchingSupabase = createMatchingAdminClient();
    const boundary = await getCurrentConsentHeadshotFanoutBoundary(
      matchingSupabase,
      input.tenantId,
      input.projectId,
      input.workspaceId ?? null,
    );
    const recurringBoundary = await getCurrentProjectRecurringSourceBoundary(matchingSupabase, {
      tenantId: input.tenantId,
      projectId: input.projectId,
      workspaceId: input.workspaceId ?? null,
    });
    await enqueuePhotoUploadedJob({
      tenantId: input.tenantId,
      projectId: input.projectId,
      workspaceId: input.workspaceId ?? null,
      assetId: input.assetId,
      payload: {
        workspaceId: input.workspaceId ?? null,
        source: input.source,
        consent_ids: input.consentIds,
        boundarySnapshotAt: boundary.boundarySnapshotAt,
        boundaryConsentCreatedAt: boundary.boundaryConsentCreatedAt,
        boundaryConsentId: boundary.boundaryConsentId,
        recurringBoundarySnapshotAt: recurringBoundary.boundarySnapshotAt,
        recurringBoundaryParticipantCreatedAt: recurringBoundary.boundaryParticipantCreatedAt,
        recurringBoundaryParticipantId: recurringBoundary.boundaryProjectProfileParticipantId,
      },
      supabase: matchingSupabase,
    });
  } catch (error) {
    console.error("[assets][post-finalize] matching_enqueue_failed", {
      tenantId: input.tenantId,
      projectId: input.projectId,
      assetId: input.assetId,
      assetType: input.assetType,
      source: input.source,
      message: error instanceof Error ? error.message : String(error),
    });
    // Primary finalize flow must still succeed; reconcile backfills missed jobs.
  }
}
