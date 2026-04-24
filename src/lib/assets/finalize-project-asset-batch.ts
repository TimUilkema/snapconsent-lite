import type { SupabaseClient } from "@supabase/supabase-js";

import { ensureProjectAccess } from "@/lib/assets/create-asset";
import { finalizeAsset } from "@/lib/assets/finalize-asset";
import { queueProjectAssetPostFinalizeProcessing } from "@/lib/assets/post-finalize-processing";
import { HttpError } from "@/lib/http/errors";
import type {
  ProjectUploadFinalizeItemInput,
  ProjectUploadFinalizeItemResult,
} from "@/lib/uploads/project-upload-types";

export const MAX_PROJECT_UPLOAD_FINALIZE_ITEMS = 50;

type FinalizeProjectAssetBatchInput = {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  workspaceId?: string | null;
  items: ProjectUploadFinalizeItemInput[];
};

function normalizeItems(items: ProjectUploadFinalizeItemInput[]) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, "invalid_batch_items", "At least one upload item is required.");
  }
  if (items.length > MAX_PROJECT_UPLOAD_FINALIZE_ITEMS) {
    throw new HttpError(400, "batch_items_too_large", "Too many upload items were provided.");
  }

  return items.map((item) => ({
    clientItemId: String(item.clientItemId ?? "").trim(),
    assetId: String(item.assetId ?? "").trim(),
  }));
}

function invalidItemResult(clientItemId: string, code: string, message: string): ProjectUploadFinalizeItemResult {
  return {
    clientItemId,
    status: "error",
    code,
    message,
  };
}

export async function finalizeProjectAssetBatch(
  input: FinalizeProjectAssetBatchInput,
): Promise<ProjectUploadFinalizeItemResult[]> {
  const items = normalizeItems(input.items);
  await ensureProjectAccess(input.supabase, input.tenantId, input.projectId);

  const results: ProjectUploadFinalizeItemResult[] = [];
  for (const item of items) {
    if (!item.clientItemId) {
      results.push(invalidItemResult("", "invalid_client_item_id", "Client item ID is required."));
      continue;
    }
    if (!item.assetId) {
      results.push(invalidItemResult(item.clientItemId, "invalid_asset_id", "Asset ID is required."));
      continue;
    }

    try {
      const finalized = await finalizeAsset({
        supabase: input.supabase,
        tenantId: input.tenantId,
        projectId: input.projectId,
        workspaceId: input.workspaceId ?? null,
        assetId: item.assetId,
        consentIds: [],
      });

      await queueProjectAssetPostFinalizeProcessing({
        supabase: input.supabase,
        tenantId: input.tenantId,
        projectId: input.projectId,
        workspaceId: input.workspaceId ?? null,
        assetId: finalized.assetId,
        assetType: finalized.assetType,
        consentIds: [],
        source: "photo_finalize_batch",
      });

      results.push({
        clientItemId: item.clientItemId,
        status: "finalized",
        assetId: finalized.assetId,
      });
    } catch (error) {
      if (error instanceof HttpError) {
        results.push(invalidItemResult(item.clientItemId, error.code, error.message));
        continue;
      }
      results.push(
        invalidItemResult(item.clientItemId, "asset_finalize_failed", "Unable to finalize upload item."),
      );
    }
  }

  return results;
}
