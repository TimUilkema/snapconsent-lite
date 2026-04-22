import { resolveProjectAssetUploadType } from "@/lib/assets/asset-upload-policy";
import { createIdempotencyKey } from "@/lib/client/idempotency-key";

import {
  type DuplicatePolicy,
  type FileFingerprint,
  PROJECT_UPLOAD_MANIFEST_VERSION,
  type ProjectUploadItem,
  type ProjectUploadItemStatus,
  type ProjectUploadManifest,
  type ProjectUploadStorageLike,
} from "@/lib/uploads/project-upload-types";

function nowIso() {
  return new Date().toISOString();
}

export function getProjectUploadManifestStorageKey(projectId: string) {
  return `snapconsent:project-upload:${projectId}`;
}

export function createFileFingerprint(file: Pick<File, "name" | "size" | "lastModified" | "type">): FileFingerprint {
  return {
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    contentType: file.type || "application/octet-stream",
  };
}

export function fingerprintMatches(
  left: FileFingerprint,
  right: Pick<FileFingerprint, "name" | "size" | "lastModified" | "contentType">,
) {
  return (
    left.name === right.name &&
    left.size === right.size &&
    left.lastModified === right.lastModified &&
    left.contentType === right.contentType
  );
}

export function createProjectUploadItem(file: Pick<File, "name" | "size" | "lastModified" | "type">): ProjectUploadItem {
  const timestamp = nowIso();
  const assetType = resolveProjectAssetUploadType(file.type, file.name) ?? "photo";
  return {
    clientItemId: crypto.randomUUID(),
    assetType,
    idempotencyKey: createIdempotencyKey(),
    originalFilename: file.name,
    contentType: file.type || "application/octet-stream",
    fileSizeBytes: file.size,
    lastModified: file.lastModified,
    selectionFingerprint: createFileFingerprint(file),
    contentHash: null,
    contentHashAlgo: null,
    needsHash: false,
    isDuplicate: false,
    hashStatus: "pending",
    assetId: null,
    storageBucket: null,
    storagePath: null,
    status: "selected",
    attemptCount: 0,
    uploadedBytes: 0,
    lastErrorCode: null,
    lastErrorMessage: null,
    updatedAt: timestamp,
  };
}

export function createProjectUploadManifest(
  projectId: string,
  items: ProjectUploadItem[],
  duplicatePolicy: DuplicatePolicy = "upload_anyway",
): ProjectUploadManifest {
  const timestamp = nowIso();
  return {
    version: PROJECT_UPLOAD_MANIFEST_VERSION,
    projectId,
    queueState: "idle",
    duplicatePolicy,
    items,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function updateManifestItem(
  manifest: ProjectUploadManifest,
  clientItemId: string,
  patch: Partial<ProjectUploadItem>,
): ProjectUploadManifest {
  const timestamp = nowIso();
  return {
    ...manifest,
    updatedAt: timestamp,
    items: manifest.items.map((item) =>
      item.clientItemId === clientItemId
        ? {
            ...item,
            ...patch,
            updatedAt: timestamp,
          }
        : item,
    ),
  };
}

export function replaceManifestItems(
  manifest: ProjectUploadManifest,
  items: ProjectUploadItem[],
  queueState: ProjectUploadManifest["queueState"] = manifest.queueState,
): ProjectUploadManifest {
  return {
    ...manifest,
    queueState,
    items,
    updatedAt: nowIso(),
  };
}

export function saveProjectUploadManifest(storage: ProjectUploadStorageLike, manifest: ProjectUploadManifest) {
  storage.setItem(getProjectUploadManifestStorageKey(manifest.projectId), JSON.stringify(manifest));
}

export function clearProjectUploadManifest(storage: ProjectUploadStorageLike, projectId: string) {
  storage.removeItem(getProjectUploadManifestStorageKey(projectId));
}

export function loadProjectUploadManifest(
  storage: ProjectUploadStorageLike,
  projectId: string,
): ProjectUploadManifest | null {
  const raw = storage.getItem(getProjectUploadManifestStorageKey(projectId));
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as ProjectUploadManifest;
    if (!parsed || parsed.version !== PROJECT_UPLOAD_MANIFEST_VERSION || parsed.projectId !== projectId) {
      return null;
    }
    if (!Array.isArray(parsed.items)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function hasUnfinishedProjectUploadItems(manifest: ProjectUploadManifest) {
  return manifest.items.some((item) => !isTerminalProjectUploadStatus(item.status));
}

export function isTerminalProjectUploadStatus(status: ProjectUploadItemStatus) {
  return status === "finalized" || status === "skipped_duplicate";
}

export function recoverProjectUploadManifest(manifest: ProjectUploadManifest): ProjectUploadManifest {
  const timestamp = nowIso();
  const recoveredItems = manifest.items.map((item) => {
    if (item.status === "finalized" || item.status === "skipped_duplicate") {
      return item;
    }

    if (item.status === "uploaded" || item.status === "finalizing") {
      return {
        ...item,
        status: "uploaded" as const,
        uploadedBytes: item.fileSizeBytes,
        updatedAt: timestamp,
      };
    }

    return {
      ...item,
      status: "needs_file" as const,
      uploadedBytes: 0,
      lastErrorCode: item.lastErrorCode ?? "reselect_file_required",
      lastErrorMessage: item.lastErrorMessage ?? "Select the original file again to continue this upload.",
      updatedAt: timestamp,
    };
  });

  return {
    ...manifest,
    queueState: hasUnfinishedProjectUploadItems({ ...manifest, items: recoveredItems }) ? "recoverable" : "completed",
    items: recoveredItems,
    updatedAt: timestamp,
  };
}

export function attachFilesToManifest(
  manifest: ProjectUploadManifest,
  files: Array<Pick<File, "name" | "size" | "lastModified" | "type">>,
) {
  const matched = new Map<string, number>();
  const nextItems = manifest.items.map((item) => {
    if (item.status !== "needs_file") {
      return item;
    }

    const matchIndex = files.findIndex((file, index) => {
      if (matched.has(String(index))) {
        return false;
      }
      return fingerprintMatches(item.selectionFingerprint, createFileFingerprint(file));
    });

    if (matchIndex === -1) {
      return item;
    }

    matched.set(String(matchIndex), matchIndex);
    const nextStatus = item.assetId ? ("ready_to_prepare" as const) : ("selected" as const);
    return {
      ...item,
      status: nextStatus,
      lastErrorCode: null,
      lastErrorMessage: null,
      updatedAt: nowIso(),
    };
  });

  return replaceManifestItems(manifest, nextItems, "idle");
}

export function summarizeProjectUploadManifest(manifest: ProjectUploadManifest) {
  let totalBytes = 0;
  let completedBytes = 0;
  let finalizedCount = 0;
  let failedCount = 0;
  let needsFileCount = 0;

  manifest.items.forEach((item) => {
    totalBytes += item.fileSizeBytes;
    if (item.status === "finalized" || item.status === "skipped_duplicate") {
      completedBytes += item.fileSizeBytes;
    } else if (item.status === "uploaded" || item.status === "finalizing") {
      completedBytes += item.fileSizeBytes;
    } else {
      completedBytes += Math.min(item.uploadedBytes, item.fileSizeBytes);
    }

    if (item.status === "finalized" || item.status === "skipped_duplicate") {
      finalizedCount += 1;
    }
    if (item.status === "failed" || item.status === "blocked_auth") {
      failedCount += 1;
    }
    if (item.status === "needs_file") {
      needsFileCount += 1;
    }
  });

  const progressPercent = totalBytes > 0 ? Math.round((completedBytes / totalBytes) * 100) : 0;
  return {
    totalBytes,
    completedBytes,
    progressPercent,
    finalizedCount,
    failedCount,
    needsFileCount,
  };
}
