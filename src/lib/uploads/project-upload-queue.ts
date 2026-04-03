import {
  type ProjectUploadFinalizeItemResult,
  type ProjectUploadItem,
  type ProjectUploadManifest,
  type ProjectUploadPrepareItemResult,
  type ProjectUploadQueueState,
} from "@/lib/uploads/project-upload-types";

function nowIso() {
  return new Date().toISOString();
}

export function isAuthBlockedStatus(status: number) {
  return status === 401 || status === 403;
}

export function setProjectUploadQueueState(
  manifest: ProjectUploadManifest,
  queueState: ProjectUploadQueueState,
): ProjectUploadManifest {
  return {
    ...manifest,
    queueState,
    updatedAt: nowIso(),
  };
}

export function applyPrepareResults(
  manifest: ProjectUploadManifest,
  results: ProjectUploadPrepareItemResult[],
): ProjectUploadManifest {
  const resultMap = new Map(results.map((result) => [result.clientItemId, result] as const));
  const timestamp = nowIso();
  return {
    ...manifest,
    updatedAt: timestamp,
    items: manifest.items.map((item) => {
      const result = resultMap.get(item.clientItemId);
      if (!result) {
        return item;
      }

      if (result.status === "ready") {
        return {
          ...item,
          assetId: result.assetId,
          storageBucket: result.storageBucket,
          storagePath: result.storagePath,
          status: "prepared" as const,
          uploadedBytes: 0,
          attemptCount: item.attemptCount + 1,
          lastErrorCode: null,
          lastErrorMessage: null,
          updatedAt: timestamp,
        };
      }

      if (result.status === "skipped_duplicate") {
        return {
          ...item,
          isDuplicate: true,
          status: "skipped_duplicate" as const,
          uploadedBytes: item.fileSizeBytes,
          lastErrorCode: null,
          lastErrorMessage: null,
          updatedAt: timestamp,
        };
      }

      return {
        ...item,
        status: "failed" as const,
        lastErrorCode: result.code,
        lastErrorMessage: result.message,
        attemptCount: item.attemptCount + 1,
        updatedAt: timestamp,
      };
    }),
  };
}

export function applyFinalizeResults(
  manifest: ProjectUploadManifest,
  results: ProjectUploadFinalizeItemResult[],
): ProjectUploadManifest {
  const resultMap = new Map(results.map((result) => [result.clientItemId, result] as const));
  const timestamp = nowIso();
  return {
    ...manifest,
    updatedAt: timestamp,
    items: manifest.items.map((item) => {
      const result = resultMap.get(item.clientItemId);
      if (!result) {
        return item;
      }

      if (result.status === "finalized") {
        return {
          ...item,
          status: "finalized" as const,
          uploadedBytes: item.fileSizeBytes,
          lastErrorCode: null,
          lastErrorMessage: null,
          updatedAt: timestamp,
        };
      }

      return {
        ...item,
        status: "failed" as const,
        lastErrorCode: result.code,
        lastErrorMessage: result.message,
        updatedAt: timestamp,
      };
    }),
  };
}

export function markProjectUploadItemBlockedAuth(
  item: ProjectUploadItem,
  message = "Your session expired. Sign in again to continue this upload.",
): ProjectUploadItem {
  return {
    ...item,
    status: "blocked_auth",
    lastErrorCode: "auth_required",
    lastErrorMessage: message,
    updatedAt: nowIso(),
  };
}

export function markProjectUploadManifestBlockedAuth(
  manifest: ProjectUploadManifest,
  targetIds?: string[],
): ProjectUploadManifest {
  const targetSet = targetIds ? new Set(targetIds) : null;
  return {
    ...manifest,
    queueState: "blocked_auth",
    updatedAt: nowIso(),
    items: manifest.items.map((item) => {
      if (targetSet && !targetSet.has(item.clientItemId)) {
        return item;
      }
      if (item.status === "finalized" || item.status === "skipped_duplicate") {
        return item;
      }
      return markProjectUploadItemBlockedAuth(item);
    }),
  };
}

export async function mapWithConcurrency<T, TResult>(
  values: T[],
  concurrency: number,
  mapper: (value: T, index: number) => Promise<TResult>,
) {
  const normalizedConcurrency = Math.max(1, Math.floor(concurrency));
  const results = new Array<TResult>(values.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < values.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(values[currentIndex], currentIndex);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(normalizedConcurrency, values.length) }, () => worker()),
  );

  return results;
}

export function chunkProjectUploadItems<T>(values: T[], size: number) {
  const chunkSize = Math.max(1, Math.floor(size));
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    result.push(values.slice(index, index + chunkSize));
  }
  return result;
}
