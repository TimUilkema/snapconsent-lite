import type { ProjectAssetUploadType } from "@/lib/assets/asset-upload-policy";

export const PROJECT_UPLOAD_MANIFEST_VERSION = 2;

export const PROJECT_UPLOAD_PREFLIGHT_BATCH_SIZE = 250;
export const PROJECT_UPLOAD_PREPARE_BATCH_SIZE = 50;
export const PROJECT_UPLOAD_FINALIZE_BATCH_SIZE = 50;
export const PROJECT_UPLOAD_PUT_CONCURRENCY = 4;
export const PROJECT_UPLOAD_HASH_CONCURRENCY = 2;
export const PROJECT_VIDEO_UPLOAD_PREPARE_BATCH_SIZE = 10;
export const PROJECT_VIDEO_UPLOAD_FINALIZE_BATCH_SIZE = 10;
export const PROJECT_VIDEO_UPLOAD_PUT_CONCURRENCY = 1;
export const PROJECT_VIDEO_UPLOAD_HASH_CONCURRENCY = 1;

export type DuplicatePolicy = "upload_anyway" | "overwrite" | "ignore";

export type ProjectUploadQueueState =
  | "idle"
  | "preflighting"
  | "awaiting_policy"
  | "running"
  | "paused"
  | "blocked_auth"
  | "recoverable"
  | "completed";

export type ProjectUploadItemStatus =
  | "selected"
  | "needs_hash"
  | "ready_to_prepare"
  | "prepared"
  | "uploading"
  | "uploaded"
  | "finalizing"
  | "finalized"
  | "skipped_duplicate"
  | "failed"
  | "needs_file"
  | "blocked_auth";

export type FileFingerprint = {
  name: string;
  size: number;
  lastModified: number;
  contentType: string;
};

export type ProjectUploadItem = {
  clientItemId: string;
  assetType: ProjectAssetUploadType;
  idempotencyKey: string;
  originalFilename: string;
  contentType: string;
  fileSizeBytes: number;
  lastModified: number;
  selectionFingerprint: FileFingerprint;
  contentHash: string | null;
  contentHashAlgo: "sha256" | null;
  needsHash: boolean;
  isDuplicate: boolean;
  hashStatus: "pending" | "ready" | "unavailable" | "not_needed";
  assetId: string | null;
  storageBucket: string | null;
  storagePath: string | null;
  status: ProjectUploadItemStatus;
  attemptCount: number;
  uploadedBytes: number;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  updatedAt: string;
};

export type ProjectUploadManifest = {
  version: number;
  projectId: string;
  queueState: ProjectUploadQueueState;
  duplicatePolicy: DuplicatePolicy;
  items: ProjectUploadItem[];
  createdAt: string;
  updatedAt: string;
};

export type ProjectUploadPrepareItemInput = {
  clientItemId: string;
  idempotencyKey: string;
  originalFilename: string;
  contentType: string;
  fileSizeBytes: number;
  contentHash?: string | null;
  contentHashAlgo?: "sha256" | null;
};

export type ProjectUploadPrepareItemResult =
  | {
      clientItemId: string;
      status: "ready";
      assetId: string;
      storageBucket: string;
      storagePath: string;
      signedUrl: string;
    }
  | {
      clientItemId: string;
      status: "skipped_duplicate";
      duplicate: true;
    }
  | {
      clientItemId: string;
      status: "error";
      code: string;
      message: string;
    };

export type ProjectUploadFinalizeItemInput = {
  clientItemId: string;
  assetId: string;
};

export type ProjectUploadFinalizeItemResult =
  | {
      clientItemId: string;
      status: "finalized";
      assetId: string;
    }
  | {
      clientItemId: string;
      status: "error";
      code: string;
      message: string;
    };

export type ProjectUploadStorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};
