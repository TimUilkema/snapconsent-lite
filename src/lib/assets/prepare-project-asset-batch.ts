import type { SupabaseClient } from "@supabase/supabase-js";

import { createAssetWithIdempotency, ensureProjectAccess } from "@/lib/assets/create-asset";
import { HttpError } from "@/lib/http/errors";
import type {
  ProjectUploadPrepareItemInput,
  ProjectUploadPrepareItemResult,
} from "@/lib/uploads/project-upload-types";

export const MAX_PROJECT_UPLOAD_PREPARE_ITEMS = 50;

type PrepareProjectAssetBatchInput = {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  workspaceId?: string | null;
  userId: string;
  assetType: "photo" | "video";
  duplicatePolicy: "upload_anyway" | "overwrite" | "ignore";
  items: ProjectUploadPrepareItemInput[];
};

function normalizeBatchContentHash(value: string | null) {
  const trimmed = String(value ?? "").trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(trimmed) ? trimmed : null;
}

function normalizeItems(items: ProjectUploadPrepareItemInput[]) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new HttpError(400, "invalid_batch_items", "At least one upload item is required.");
  }
  if (items.length > MAX_PROJECT_UPLOAD_PREPARE_ITEMS) {
    throw new HttpError(400, "batch_items_too_large", "Too many upload items were provided.");
  }

  return items.map((item) => ({
    clientItemId: String(item.clientItemId ?? "").trim(),
    idempotencyKey: String(item.idempotencyKey ?? "").trim(),
    originalFilename: String(item.originalFilename ?? "").trim(),
    contentType: String(item.contentType ?? "").trim(),
    fileSizeBytes: Number(item.fileSizeBytes ?? 0),
    contentHash: typeof item.contentHash === "string" ? item.contentHash.trim() : null,
    contentHashAlgo: item.contentHashAlgo === "sha256" ? "sha256" : null,
  }));
}

function invalidItemResult(clientItemId: string, code: string, message: string): ProjectUploadPrepareItemResult {
  return {
    clientItemId,
    status: "error",
    code,
    message,
  };
}

export async function prepareProjectAssetBatch(
  input: PrepareProjectAssetBatchInput,
): Promise<ProjectUploadPrepareItemResult[]> {
  const items = normalizeItems(input.items);
  await ensureProjectAccess(input.supabase, input.tenantId, input.projectId);

  const results: ProjectUploadPrepareItemResult[] = [];
  const requestDuplicateHashes = new Set<string>();
  const shouldApplyDuplicateSuppression =
    input.assetType === "photo" && input.duplicatePolicy !== "upload_anyway";
  for (const item of items) {
    if (!item.clientItemId) {
      results.push(invalidItemResult("", "invalid_client_item_id", "Client item ID is required."));
      continue;
    }
    if (item.idempotencyKey.length < 8 || item.idempotencyKey.length > 200) {
      results.push(
        invalidItemResult(
          item.clientItemId,
          "invalid_idempotency_key",
          "Idempotency key is required for each upload item.",
        ),
      );
      continue;
    }

    const normalizedContentHash = normalizeBatchContentHash(item.contentHash);
    if (
      normalizedContentHash &&
      shouldApplyDuplicateSuppression &&
      requestDuplicateHashes.has(normalizedContentHash)
    ) {
      results.push({
        clientItemId: item.clientItemId,
        status: "skipped_duplicate",
        duplicate: true,
      });
      continue;
    }

    if (normalizedContentHash && shouldApplyDuplicateSuppression) {
      requestDuplicateHashes.add(normalizedContentHash);
    }

    try {
      const result = await createAssetWithIdempotency({
        supabase: input.supabase,
        tenantId: input.tenantId,
        projectId: input.projectId,
        workspaceId: input.workspaceId ?? null,
        userId: input.userId,
        idempotencyKey: item.idempotencyKey,
        originalFilename: item.originalFilename,
        contentType: item.contentType,
        fileSizeBytes: item.fileSizeBytes,
        consentIds: [],
        contentHash: normalizedContentHash,
        contentHashAlgo: item.contentHashAlgo,
        assetType: input.assetType,
        duplicatePolicy: input.duplicatePolicy,
        projectAccessValidated: true,
      });

      if ("skipUpload" in result.payload && result.payload.skipUpload) {
        results.push({
          clientItemId: item.clientItemId,
          status: "skipped_duplicate",
          duplicate: true,
        });
        continue;
      }
      if (!("assetId" in result.payload)) {
        results.push(
          invalidItemResult(item.clientItemId, "asset_create_failed", "Unable to prepare upload item."),
        );
        continue;
      }

      results.push({
        clientItemId: item.clientItemId,
        status: "ready",
        assetId: result.payload.assetId,
        storageBucket: result.payload.storageBucket,
        storagePath: result.payload.storagePath,
        signedUrl: result.payload.signedUrl,
      });
    } catch (error) {
      if (error instanceof HttpError) {
        results.push(invalidItemResult(item.clientItemId, error.code, error.message));
        continue;
      }
      results.push(
        invalidItemResult(item.clientItemId, "asset_create_failed", "Unable to prepare upload item."),
      );
    }
  }

  return results;
}
