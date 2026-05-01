"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import {
  getAcceptedProjectAssetUploadAcceptValue,
  getAssetUploadMaxFileSizeBytes,
  resolveProjectAssetUploadType,
  type ProjectAssetUploadType,
} from "@/lib/assets/asset-upload-policy";
import { resolveSignedUploadUrlForBrowser } from "@/lib/client/storage-signed-url";
import {
  clearProjectUploadManifest,
  createFileFingerprint,
  createProjectUploadItem,
  createProjectUploadManifest,
  fingerprintMatches,
  getProjectUploadManifestStorageKey,
  hasUnfinishedProjectUploadItems,
  isTerminalProjectUploadStatus,
  loadProjectUploadManifest,
  recoverProjectUploadManifest,
  replaceManifestItems,
  saveProjectUploadManifest,
  summarizeProjectUploadManifest,
  updateManifestItem,
} from "@/lib/uploads/project-upload-manifest";
import {
  applyFinalizeResults,
  applyPrepareResults,
  chunkProjectUploadItems,
  getProjectUploadFinalizeBatchSizeForAssetType,
  getProjectUploadHashConcurrencyForAssetType,
  getProjectUploadPrepareBatchSizeForAssetType,
  getProjectUploadPutConcurrencyForAssetType,
  groupProjectUploadItemsByAssetType,
  isAuthBlockedStatus,
  mapWithConcurrency,
  markProjectUploadManifestBlockedAuth,
  setProjectUploadQueueState,
} from "@/lib/uploads/project-upload-queue";
import {
  collectDuplicateContentHashes,
  hashProjectUploadFile,
  shouldCheckProjectUploadDuplicates,
} from "@/lib/uploads/project-upload-duplicate-detection";
import type {
  DuplicatePolicy,
  ProjectUploadFinalizeItemResult,
  ProjectUploadManifest,
  ProjectUploadPrepareItemResult,
  ProjectUploadStorageLike,
} from "@/lib/uploads/project-upload-types";
import {
  PROJECT_UPLOAD_PREFLIGHT_BATCH_SIZE,
} from "@/lib/uploads/project-upload-types";

type AssetsUploadFormProps = {
  projectId: string;
  workspaceId: string;
  mode?: "capture" | "correction";
};

type PreflightResponse = {
  candidateSizes: number[];
  duplicateHashes: string[];
};

type BatchPrepareResponse = {
  items?: ProjectUploadPrepareItemResult[];
  message?: string;
};

type BatchFinalizeResponse = {
  items?: ProjectUploadFinalizeItemResult[];
  message?: string;
};

type UploadFailure = Error & {
  status?: number | null;
  code?: string;
};

type SelectedFileValidation = {
  acceptedItems: Array<{
    file: File;
    assetType: ProjectAssetUploadType;
  }>;
  rejectedCount: number;
  rejectedItems: Array<{
    filename: string;
    reason: "unsupported_type" | "file_too_large";
  }>;
};

function getBrowserStorage(): ProjectUploadStorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage;
}

function uploadWithProgress(file: File, signedUrl: string, onProgress: (loaded: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", resolveSignedUploadUrlForBrowser(signedUrl));
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(event.loaded);
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
        return;
      }

      const error = new Error("upload_failed") as UploadFailure;
      error.code = xhr.status >= 400 && xhr.status < 500 ? "signed_url_invalid" : "upload_failed";
      error.status = xhr.status;
      reject(error);
    };
    xhr.onerror = () => {
      const error = new Error("upload_failed") as UploadFailure;
      error.code = "upload_failed";
      error.status = null;
      reject(error);
    };
    xhr.send(file);
  });
}

function validateSelectedFiles(selectedFiles: File[]): SelectedFileValidation {
  const acceptedItems: SelectedFileValidation["acceptedItems"] = [];
  const rejectedItems: SelectedFileValidation["rejectedItems"] = [];
  let rejectedCount = 0;

  selectedFiles.forEach((file) => {
    const assetType = resolveProjectAssetUploadType(file.type, file.name);
    if (!assetType) {
      rejectedCount += 1;
      rejectedItems.push({
        filename: file.name,
        reason: "unsupported_type",
      });
      return;
    }

    if (file.size > getAssetUploadMaxFileSizeBytes(assetType)) {
      rejectedCount += 1;
      rejectedItems.push({
        filename: file.name,
        reason: "file_too_large",
      });
      return;
    }

    acceptedItems.push({ file, assetType });
  });

  return {
    acceptedItems,
    rejectedCount,
    rejectedItems,
  };
}

export function AssetsUploadForm({
  projectId,
  workspaceId,
  mode = "capture",
}: AssetsUploadFormProps) {
  const router = useRouter();
  const t = useTranslations("projects.assetsUploadForm");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const manifestRef = useRef<ProjectUploadManifest | null>(null);
  const fileBindingsRef = useRef(new Map<string, File>());
  const signedUrlRef = useRef(new Map<string, string>());
  const runningRef = useRef(false);
  const pausedRef = useRef(false);
  const storageRef = useRef<ProjectUploadStorageLike | null>(null);

  const [manifest, setManifestState] = useState<ProjectUploadManifest | null>(null);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [duplicatePolicy, setDuplicatePolicy] = useState<DuplicatePolicy>("upload_anyway");
  const manifestScopeKey = `${projectId}:${workspaceId}:${mode}`;
  const endpointBase =
    mode === "correction"
      ? `/api/projects/${projectId}/correction/assets`
      : `/api/projects/${projectId}/assets`;

  const acceptValue = useMemo(() => getAcceptedProjectAssetUploadAcceptValue(), []);

  function setManifest(next: ProjectUploadManifest | null) {
    manifestRef.current = next;
    setManifestState(next);
  }

  function updateManifest(updater: (current: ProjectUploadManifest) => ProjectUploadManifest) {
    const current = manifestRef.current ?? createProjectUploadManifest(manifestScopeKey, []);
    const next = updater(current);
    setManifest(next);
    return next;
  }

  function clearFileInput() {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function clearCurrentQueue(clearMessages = false) {
    fileBindingsRef.current.clear();
    signedUrlRef.current.clear();
    setManifest(null);
    const storage = storageRef.current;
    if (storage) {
      clearProjectUploadManifest(storage, manifestScopeKey);
    }
    clearFileInput();
    if (clearMessages) {
      setError(null);
      setWarning(null);
      setSuccess(null);
    }
  }

  function applyManifestAndFiles(nextManifest: ProjectUploadManifest) {
    const activeIds = new Set(nextManifest.items.map((item) => item.clientItemId));
    Array.from(fileBindingsRef.current.keys()).forEach((clientItemId) => {
      if (!activeIds.has(clientItemId)) {
        fileBindingsRef.current.delete(clientItemId);
      }
    });
    Array.from(signedUrlRef.current.keys()).forEach((clientItemId) => {
      if (!activeIds.has(clientItemId)) {
        signedUrlRef.current.delete(clientItemId);
      }
    });
    setManifest(nextManifest);
  }

  function pickNextAssetTypeItems(items: ProjectUploadManifest["items"]) {
    const groupedItems = groupProjectUploadItemsByAssetType(items);
    if (groupedItems.photo.length > 0) {
      return {
        assetType: "photo" as const,
        items: groupedItems.photo,
      };
    }

    if (groupedItems.video.length > 0) {
      return {
        assetType: "video" as const,
        items: groupedItems.video,
      };
    }

    return null;
  }

  async function preflightForItems(
    assetType: ProjectAssetUploadType,
    targetIds: string[],
    includeHashes: boolean,
  ): Promise<PreflightResponse> {
    const current = manifestRef.current;
    if (!current) {
      return { candidateSizes: [], duplicateHashes: [] };
    }

    const targetSet = new Set(targetIds);
    const targetItems = current.items.filter((item) => targetSet.has(item.clientItemId));
    const response = await fetch(`${endpointBase}/preflight`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        assetType,
        files: targetItems.map((item) => ({
          name: item.originalFilename,
          size: item.fileSizeBytes,
          contentType: item.contentType,
          contentHash: includeHashes ? item.contentHash : null,
        })),
      }),
    });

    const payload = (await response.json().catch(() => null)) as PreflightResponse | null;
    if (!response.ok || !payload) {
      throw new Error("preflight_failed");
    }
    return payload;
  }

  async function prepareSelectedItemsForQueue(targetIds: string[], pauseForDuplicates = true) {
    const current = manifestRef.current;
    if (!current || targetIds.length === 0) {
      return false;
    }

    const targetSet = new Set(targetIds);
    const newItems = current.items.filter((item) => targetSet.has(item.clientItemId) && !item.assetId);
    if (newItems.length === 0) {
      return true;
    }

    const photoItems = newItems.filter((item) => shouldCheckProjectUploadDuplicates(item.assetType));
    const hasPhotoDuplicateChecks = photoItems.length > 0;

    setIsPreparing(hasPhotoDuplicateChecks);
    setError(null);
    setWarning(null);

    try {
      updateManifest((manifestValue) =>
        replaceManifestItems(
          manifestValue,
          manifestValue.items.map((item) => {
            if (!targetSet.has(item.clientItemId) || item.assetId) {
              return item;
            }

            const shouldCheckDuplicates = shouldCheckProjectUploadDuplicates(item.assetType);
            return {
              ...item,
              contentHash: shouldCheckDuplicates ? item.contentHash : null,
              contentHashAlgo: shouldCheckDuplicates ? item.contentHashAlgo : null,
              needsHash: shouldCheckDuplicates,
              hashStatus: shouldCheckDuplicates ? "pending" : "not_needed",
              isDuplicate: false,
              status: shouldCheckDuplicates ? "needs_hash" : "ready_to_prepare",
              updatedAt: new Date().toISOString(),
            };
          }),
          hasPhotoDuplicateChecks ? "preflighting" : "idle",
        ),
      );

      if (!hasPhotoDuplicateChecks) {
        return true;
      }

      const hashTargetItems = (manifestRef.current?.items ?? []).filter(
        (item) =>
          targetSet.has(item.clientItemId) &&
          !item.assetId &&
          shouldCheckProjectUploadDuplicates(item.assetType),
      );

      let hashUnavailableCount = 0;
      await mapWithConcurrency(
        hashTargetItems,
        getProjectUploadHashConcurrencyForAssetType("photo"),
        async (item) => {
          const file = fileBindingsRef.current.get(item.clientItemId);
          const contentHash = file ? await hashProjectUploadFile(file) : null;
          if (!contentHash) {
            hashUnavailableCount += 1;
          }

          updateManifest((manifestValue) =>
            updateManifestItem(manifestValue, item.clientItemId, {
              contentHash,
              contentHashAlgo: contentHash ? "sha256" : null,
              needsHash: true,
              hashStatus: contentHash ? "ready" : "unavailable",
              status: "ready_to_prepare",
            }),
          );
          return null;
        },
      );

      const duplicateHashesFromDb = new Set<string>();
      const photoTargetIds = hashTargetItems.map((item) => item.clientItemId);
      const targetChunks = chunkProjectUploadItems(photoTargetIds, PROJECT_UPLOAD_PREFLIGHT_BATCH_SIZE);
      for (const chunkIds of targetChunks) {
        const duplicatePreflight = await preflightForItems("photo", chunkIds, true);
        (duplicatePreflight.duplicateHashes ?? []).forEach((contentHash) =>
          duplicateHashesFromDb.add(contentHash),
        );
      }

      const hashedTargetItems = (manifestRef.current?.items ?? []).filter(
        (item) =>
          targetSet.has(item.clientItemId) &&
          !item.assetId &&
          shouldCheckProjectUploadDuplicates(item.assetType),
      );
      const duplicateHashesInRequest = collectDuplicateContentHashes(hashedTargetItems);

      const nextManifest = updateManifest((manifestValue) =>
        replaceManifestItems(
          manifestValue,
          manifestValue.items.map((item) => {
            if (!targetSet.has(item.clientItemId) || item.assetId) {
              return item;
            }
            const normalizedHash = item.contentHash?.trim().toLowerCase() ?? null;
            return {
              ...item,
              isDuplicate: normalizedHash
                ? duplicateHashesFromDb.has(normalizedHash) || duplicateHashesInRequest.has(normalizedHash)
                : false,
              updatedAt: new Date().toISOString(),
            };
          }),
          "idle",
        ),
      );

      const duplicateCount = nextManifest.items.filter(
        (item) => targetSet.has(item.clientItemId) && item.isDuplicate,
      ).length;

      if (duplicateCount > 0 && pauseForDuplicates) {
        updateManifest((manifestValue) =>
          setProjectUploadQueueState(
            {
              ...manifestValue,
              duplicatePolicy,
            },
            "awaiting_policy",
          ),
        );
        return false;
      }

      if (hashUnavailableCount > 0) {
        setWarning(t("hashUnavailableWarning"));
      }

      return true;
    } catch {
      setError(t("prepareError"));
      return false;
    } finally {
      setIsPreparing(false);
    }
  }

  async function runPrepareBatch(itemsToPrepare: ProjectUploadManifest["items"]) {
    const assetType = itemsToPrepare[0]?.assetType ?? "photo";
    const response = await fetch(`${endpointBase}/batch/prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        assetType,
        duplicatePolicy,
        items: itemsToPrepare.map((item) => ({
          clientItemId: item.clientItemId,
          idempotencyKey: item.idempotencyKey,
          originalFilename: item.originalFilename,
          contentType: item.contentType,
          fileSizeBytes: item.fileSizeBytes,
          contentHash: item.contentHash,
          contentHashAlgo: item.contentHashAlgo,
        })),
      }),
    });

    if (isAuthBlockedStatus(response.status)) {
      updateManifest((manifestValue) => markProjectUploadManifestBlockedAuth(manifestValue));
      setError(t("authExpired"));
      return false;
    }

    const payload = (await response.json().catch(() => null)) as BatchPrepareResponse | null;
    if (!response.ok || !payload?.items) {
      updateManifest((manifestValue) =>
        replaceManifestItems(
          manifestValue,
          manifestValue.items.map((item) =>
            itemsToPrepare.some((candidate) => candidate.clientItemId === item.clientItemId)
              ? {
                  ...item,
                  status: "failed",
                  lastErrorCode: "batch_prepare_failed",
                  lastErrorMessage: payload?.message ?? t("prepareItemError"),
                  updatedAt: new Date().toISOString(),
                }
              : item,
          ),
          "recoverable",
        ),
      );
      setError(payload?.message ?? t("prepareError"));
      return false;
    }

    payload.items.forEach((item) => {
      if (item.status === "ready") {
        signedUrlRef.current.set(item.clientItemId, item.signedUrl);
      } else {
        signedUrlRef.current.delete(item.clientItemId);
      }
    });
    applyManifestAndFiles(
      applyPrepareResults(
        manifestRef.current ?? createProjectUploadManifest(manifestScopeKey, []),
        payload.items,
      ),
    );
    return true;
  }

  async function runUploadBatch(itemsToUpload: ProjectUploadManifest["items"]) {
    const assetType = itemsToUpload[0]?.assetType ?? "photo";
    await mapWithConcurrency(
      itemsToUpload,
      getProjectUploadPutConcurrencyForAssetType(assetType),
      async (item) => {
      const file = fileBindingsRef.current.get(item.clientItemId);
      const signedUrl = signedUrlRef.current.get(item.clientItemId);

      if (!file) {
        updateManifest((manifestValue) =>
          updateManifestItem(manifestValue, item.clientItemId, {
            status: "needs_file",
            lastErrorCode: "reselect_file_required",
            lastErrorMessage: t("reselectFileRequired"),
          }),
        );
        return;
      }

      if (!signedUrl) {
        updateManifest((manifestValue) =>
          updateManifestItem(manifestValue, item.clientItemId, {
            status: "ready_to_prepare",
            lastErrorCode: "signed_url_missing",
            lastErrorMessage: t("signedUrlExpired"),
          }),
        );
        return;
      }

      updateManifest((manifestValue) =>
        updateManifestItem(manifestValue, item.clientItemId, {
          status: "uploading",
          lastErrorCode: null,
          lastErrorMessage: null,
        }),
      );

      try {
        await uploadWithProgress(file, signedUrl, (loaded) => {
          updateManifest((manifestValue) =>
            updateManifestItem(manifestValue, item.clientItemId, {
              uploadedBytes: loaded,
            }),
          );
        });

        signedUrlRef.current.delete(item.clientItemId);
        updateManifest((manifestValue) =>
          updateManifestItem(manifestValue, item.clientItemId, {
            status: "uploaded",
            uploadedBytes: item.fileSizeBytes,
          }),
        );
      } catch (error) {
        const uploadError = error as UploadFailure;
        signedUrlRef.current.delete(item.clientItemId);

        if (
          uploadError.code === "signed_url_invalid" &&
          typeof uploadError.status === "number" &&
          uploadError.status >= 400 &&
          uploadError.status < 500
        ) {
          updateManifest((manifestValue) =>
            updateManifestItem(manifestValue, item.clientItemId, {
              status: "ready_to_prepare",
              uploadedBytes: 0,
              lastErrorCode: "signed_url_invalid",
              lastErrorMessage: t("signedUrlExpired"),
            }),
          );
          return;
        }

        updateManifest((manifestValue) =>
          updateManifestItem(manifestValue, item.clientItemId, {
            status: "failed",
            uploadedBytes: 0,
            lastErrorCode: "upload_failed",
            lastErrorMessage: t("uploadFailed"),
          }),
        );
      }
    },
    );
  }

  async function runFinalizeBatch(itemsToFinalize: ProjectUploadManifest["items"]) {
    const response = await fetch(`${endpointBase}/batch/finalize`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceId,
        items: itemsToFinalize
          .filter((item) => item.assetId)
          .map((item) => ({
            clientItemId: item.clientItemId,
            assetId: item.assetId,
          })),
      }),
    });

    if (isAuthBlockedStatus(response.status)) {
      updateManifest((manifestValue) => markProjectUploadManifestBlockedAuth(manifestValue));
      setError(t("authExpired"));
      return false;
    }

    const payload = (await response.json().catch(() => null)) as BatchFinalizeResponse | null;
    if (!response.ok || !payload?.items) {
      updateManifest((manifestValue) =>
        replaceManifestItems(
          manifestValue,
          manifestValue.items.map((item) =>
            itemsToFinalize.some((candidate) => candidate.clientItemId === item.clientItemId)
              ? {
                  ...item,
                  status: "failed",
                  lastErrorCode: "batch_finalize_failed",
                  lastErrorMessage: payload?.message ?? t("finalizeItemError"),
                  updatedAt: new Date().toISOString(),
                }
              : item,
          ),
          "recoverable",
        ),
      );
      setError(payload?.message ?? t("finalizeError"));
      return false;
    }

    applyManifestAndFiles(
      applyFinalizeResults(
        manifestRef.current ?? createProjectUploadManifest(manifestScopeKey, []),
        payload.items,
      ),
    );
    return true;
  }

  async function startQueue() {
    if (runningRef.current) {
      return;
    }

    const current = manifestRef.current;
    if (!current) {
      return;
    }

    runningRef.current = true;
    pausedRef.current = false;
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);
    updateManifest((manifestValue) => setProjectUploadQueueState(manifestValue, "running"));

    try {
      while (manifestRef.current) {
        const loopManifest = manifestRef.current;
        if (!loopManifest) {
          break;
        }
        if (pausedRef.current) {
          applyManifestAndFiles(setProjectUploadQueueState(loopManifest, "paused"));
          break;
        }
        if (loopManifest.queueState === "blocked_auth") {
          break;
        }

        const nextUploadedGroup = pickNextAssetTypeItems(
          loopManifest.items.filter((item) => item.status === "uploaded"),
        );
        if (nextUploadedGroup) {
          const finalizeChunks = chunkProjectUploadItems(
            nextUploadedGroup.items,
            getProjectUploadFinalizeBatchSizeForAssetType(nextUploadedGroup.assetType),
          );
          const finalized = await runFinalizeBatch(finalizeChunks[0] ?? []);
          if (!finalized) {
            break;
          }
          continue;
        }

        const nextPreparedGroup = pickNextAssetTypeItems(
          loopManifest.items.filter(
            (item) => item.status === "prepared" && fileBindingsRef.current.has(item.clientItemId),
          ),
        );
        if (nextPreparedGroup) {
          await runUploadBatch(
            nextPreparedGroup.items.slice(
              0,
              getProjectUploadPutConcurrencyForAssetType(nextPreparedGroup.assetType),
            ),
          );
          continue;
        }

        const readyItems = loopManifest.items.filter((item) => item.status === "ready_to_prepare");
        if (readyItems.length > 0) {
          const missingFileIds = readyItems
            .filter((item) => !fileBindingsRef.current.has(item.clientItemId))
            .map((item) => item.clientItemId);
          if (missingFileIds.length > 0) {
            updateManifest((manifestValue) =>
              replaceManifestItems(
                manifestValue,
                manifestValue.items.map((item) =>
                  missingFileIds.includes(item.clientItemId)
                    ? {
                        ...item,
                        status: "needs_file",
                        lastErrorCode: "reselect_file_required",
                        lastErrorMessage: t("reselectFileRequired"),
                        updatedAt: new Date().toISOString(),
                      }
                    : item,
                ),
                "recoverable",
              ),
            );
          }

          const nextReadyGroup = pickNextAssetTypeItems(
            readyItems.filter((item) => fileBindingsRef.current.has(item.clientItemId)),
          );
          if (nextReadyGroup) {
            const prepareChunks = chunkProjectUploadItems(
              nextReadyGroup.items,
              getProjectUploadPrepareBatchSizeForAssetType(nextReadyGroup.assetType),
            );
            const prepared = await runPrepareBatch(prepareChunks[0] ?? []);
            if (!prepared) {
              break;
            }
            continue;
          }
        }

        break;
      }

      const nextManifest = manifestRef.current;
      if (!nextManifest) {
        return;
      }

      if (nextManifest.queueState === "blocked_auth") {
        return;
      }
      if (pausedRef.current) {
        applyManifestAndFiles(setProjectUploadQueueState(nextManifest, "paused"));
        return;
      }

      if (nextManifest.items.every((item) => isTerminalProjectUploadStatus(item.status))) {
        const uploadedCount = nextManifest.items.filter((item) => item.status === "finalized").length;
        const skippedCount = nextManifest.items.filter((item) => item.status === "skipped_duplicate").length;
        clearCurrentQueue();
        setSuccess(
          skippedCount > 0
            ? t("uploadCompleteWithSkipped", {
                uploadedCount,
                skippedCount,
              })
            : t("uploadComplete", {
                uploadedCount,
              }),
        );
        router.refresh();
        return;
      }

      applyManifestAndFiles(setProjectUploadQueueState(nextManifest, "recoverable"));
    } finally {
      runningRef.current = false;
      setIsSubmitting(false);
    }
  }

  async function handleFileSelection(selectedFiles: File[]) {
    if (selectedFiles.length === 0) {
      return;
    }

    setError(null);
    setWarning(null);
    setSuccess(null);

    const validatedSelection = validateSelectedFiles(selectedFiles);
    if (validatedSelection.rejectedCount > 0) {
      const firstRejected = validatedSelection.rejectedItems[0] ?? null;
      setWarning(
        firstRejected
          ? firstRejected.reason === "file_too_large"
            ? t("fileTooLargeWarning", { filename: firstRejected.filename })
            : t("unsupportedTypeWarning", { filename: firstRejected.filename })
          : t("filesSkippedWarning", { count: validatedSelection.rejectedCount }),
      );
    }
    if (validatedSelection.acceptedItems.length === 0) {
      return;
    }

    const current = manifestRef.current;
    const workingItems = current ? [...current.items] : [];
    const selectedByIndex = new Set<number>();
    const acceptedFiles = validatedSelection.acceptedItems.map((entry) => entry.file);
    const acceptedAssetTypeByFingerprint = new Map(
      validatedSelection.acceptedItems.map((entry) => [
        JSON.stringify(createFileFingerprint(entry.file)),
        entry.assetType,
      ] as const),
    );
    const recoveryMatches = current
      ? current.items.filter((item) => item.status === "needs_file" || item.status === "blocked_auth" || item.status === "failed")
      : [];

    recoveryMatches.forEach((item) => {
      const fileIndex = acceptedFiles.findIndex((file, index) => {
        if (selectedByIndex.has(index)) {
          return false;
        }
        return fingerprintMatches(item.selectionFingerprint, createFileFingerprint(file));
      });

      if (fileIndex === -1) {
        return;
      }

      selectedByIndex.add(fileIndex);
      fileBindingsRef.current.set(item.clientItemId, acceptedFiles[fileIndex]);
      const nextStatus = item.assetId ? "ready_to_prepare" : "selected";
      const itemIndex = workingItems.findIndex((candidate) => candidate.clientItemId === item.clientItemId);
      if (itemIndex >= 0) {
        workingItems[itemIndex] = {
          ...workingItems[itemIndex],
          status: nextStatus,
          uploadedBytes: 0,
          lastErrorCode: null,
          lastErrorMessage: null,
          updatedAt: new Date().toISOString(),
        };
      }
    });

    acceptedFiles.forEach((file, index) => {
      if (selectedByIndex.has(index)) {
        return;
      }
      const item = createProjectUploadItem(file);
      const inferredAssetType =
        acceptedAssetTypeByFingerprint.get(JSON.stringify(item.selectionFingerprint)) ?? item.assetType;
      fileBindingsRef.current.set(item.clientItemId, file);
      workingItems.push({
        ...item,
        assetType: inferredAssetType,
      });
    });

    const nextManifest = createProjectUploadManifest(
      manifestScopeKey,
      workingItems,
      current?.duplicatePolicy ?? duplicatePolicy,
    );
    applyManifestAndFiles(nextManifest);

    const shouldContinue = await prepareSelectedItemsForQueue(
      nextManifest.items
        .filter((item) => item.status === "selected" || item.status === "ready_to_prepare")
        .map((item) => item.clientItemId),
    );

    if (shouldContinue) {
      await startQueue();
    }
  }

  async function continueWithDuplicatePolicy() {
    const current = manifestRef.current;
    if (!current) {
      return;
    }

    const nextManifest = replaceManifestItems(
      {
        ...current,
        duplicatePolicy,
      },
      current.items.map((item) => {
        if (!item.isDuplicate || item.assetId) {
          return item;
        }

        return {
          ...item,
          status: "ready_to_prepare" as const,
          updatedAt: new Date().toISOString(),
        };
      }),
      "idle",
    );

    applyManifestAndFiles(nextManifest);
    const remainingSelectedIds = nextManifest.items
      .filter((item) => item.status === "selected")
      .map((item) => item.clientItemId);
    if (remainingSelectedIds.length > 0) {
      const preparedRemaining = await prepareSelectedItemsForQueue(remainingSelectedIds, false);
      if (!preparedRemaining) {
        return;
      }
    }
    await startQueue();
  }

  function pauseQueue() {
    pausedRef.current = true;
  }

  async function resumeQueue() {
    pausedRef.current = false;
    const current = manifestRef.current;
    if (!current) {
      return;
    }
    applyManifestAndFiles(setProjectUploadQueueState(current, "idle"));
    await startQueue();
  }

  function retryFailedItems() {
    const current = manifestRef.current;
    if (!current) {
      return;
    }

    const nextManifest = replaceManifestItems(
      current,
      current.items.map((item) => {
        if (item.status === "failed" || item.status === "blocked_auth") {
          const nextStatus =
            item.uploadedBytes >= item.fileSizeBytes
              ? "uploaded"
              : item.assetId
                ? "ready_to_prepare"
                : "selected";
          const nextUploadedBytes = nextStatus === "uploaded" ? item.fileSizeBytes : 0;
          return {
            ...item,
            status: nextStatus,
            uploadedBytes: nextUploadedBytes,
            lastErrorCode: null,
            lastErrorMessage: null,
            updatedAt: new Date().toISOString(),
          };
        }
        return item;
      }),
      "idle",
    );
    applyManifestAndFiles(nextManifest);
    void startQueue();
  }

  useEffect(() => {
    storageRef.current = getBrowserStorage();
    const storage = storageRef.current;
    if (!storage) {
      return;
    }

    const loaded = loadProjectUploadManifest(storage, manifestScopeKey);
    if (!loaded) {
      return;
    }

    const recovered = recoverProjectUploadManifest(loaded);
    manifestRef.current = recovered;
    setManifestState(recovered);
    setDuplicatePolicy(recovered.duplicatePolicy);
    if (hasUnfinishedProjectUploadItems(recovered)) {
      setWarning(t("recoveredUploadWarning"));
    }
  }, [manifestScopeKey, t]);

  useEffect(() => {
    const storage = storageRef.current;
    if (!storage) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      if (manifest && manifest.items.length > 0) {
        saveProjectUploadManifest(storage, manifest);
      } else {
        storage.removeItem(getProjectUploadManifestStorageKey(manifestScopeKey));
      }
    }, 150);

    return () => window.clearTimeout(timeoutId);
  }, [manifest, manifestScopeKey]);

  const isBusy = isPreparing || isSubmitting;
  const duplicateCount =
    manifest?.items.filter((item) => item.isDuplicate && !isTerminalProjectUploadStatus(item.status)).length ?? 0;
  const summary = manifest ? summarizeProjectUploadManifest(manifest) : null;
  const needsPolicyChoice = manifest?.queueState === "awaiting_policy" && duplicateCount > 0;
  const needsFileCount = manifest?.items.filter((item) => item.status === "needs_file").length ?? 0;
  const failedCount =
    manifest?.items.filter((item) => item.status === "failed" || item.status === "blocked_auth").length ?? 0;
  const queueCount = manifest?.items.filter((item) => !isTerminalProjectUploadStatus(item.status)).length ?? 0;
  const queueStateLabel = manifest ? t(`queueStateValue.${manifest.queueState}`) : null;

  return (
    <form className="space-y-3">
      <label className="block text-sm">
        <span className="mb-1 block font-medium">{t("label")}</span>
        <input
          type="file"
          accept={acceptValue}
          multiple
          ref={fileInputRef}
          disabled={isBusy}
          onChange={(event) => {
            const selected = Array.from(event.target.files ?? []);
            void handleFileSelection(selected);
          }}
          className="block w-full text-sm"
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isBusy}
          className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
        >
          {needsFileCount > 0 ? t("selectFilesToContinue") : t("uploadAssets")}
        </button>

        {manifest && manifest.queueState === "running" ? (
          <button
            type="button"
            onClick={pauseQueue}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-white"
          >
            {t("pause")}
          </button>
        ) : null}

        {manifest && (manifest.queueState === "paused" || manifest.queueState === "recoverable") ? (
          <button
            type="button"
            onClick={() => void resumeQueue()}
            disabled={isBusy}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-white disabled:opacity-60"
          >
            {t("resume")}
          </button>
        ) : null}

        {failedCount > 0 ? (
          <button
            type="button"
            onClick={retryFailedItems}
            disabled={isBusy}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-white disabled:opacity-60"
          >
            {t("retryFailed")}
          </button>
        ) : null}

        {manifest ? (
          <button
            type="button"
            onClick={() => clearCurrentQueue(true)}
            disabled={isBusy}
            className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-white disabled:opacity-60"
          >
            {t("clearQueue")}
          </button>
        ) : null}
      </div>

      {manifest ? (
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-700">
          <p>
            {t("queueSummary", {
              queueCount,
              failedCount,
              needsFileCount,
            })}
          </p>
          <p className="text-xs text-zinc-500">{t("queueState", { state: queueStateLabel ?? manifest.queueState })}</p>
        </div>
      ) : null}

      {needsPolicyChoice ? (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm">
          <p className="font-medium">{t("duplicatesDetectedTitle")}</p>
          <p className="text-xs text-zinc-600">
            {t("duplicatesDetectedBody", {
              duplicateCount,
              totalCount: manifest?.items.length ?? 0,
            })}
          </p>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="duplicatePolicy"
              checked={duplicatePolicy === "upload_anyway"}
              onChange={() => setDuplicatePolicy("upload_anyway")}
            />
            <span>{t("duplicatePolicyUploadAnyway")}</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="duplicatePolicy"
              checked={duplicatePolicy === "overwrite"}
              onChange={() => setDuplicatePolicy("overwrite")}
            />
            <span>{t("duplicatePolicyOverwrite")}</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="duplicatePolicy"
              checked={duplicatePolicy === "ignore"}
              onChange={() => setDuplicatePolicy("ignore")}
            />
            <span>{t("duplicatePolicyIgnore")}</span>
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => void continueWithDuplicatePolicy()}
              className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
            >
              {t("continueUpload")}
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => clearCurrentQueue(true)}
              className="rounded-lg border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-white disabled:opacity-60"
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      ) : null}

      <p className="text-sm text-zinc-600">
        {t("headshotsManagedNote")}
      </p>
      {mode === "correction" ? (
        <p className="text-sm text-zinc-600">
          {t("correctionNotice")}
        </p>
      ) : null}

      {isPreparing ? <p className="text-xs text-zinc-600">{t("checkingDuplicates")}</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {warning ? <p className="text-sm text-amber-700">{warning}</p> : null}
      {success ? <p className="text-sm text-emerald-700">{success}</p> : null}
      {summary ? (
        <div className="space-y-1">
          <div className="h-2 w-full overflow-hidden rounded bg-zinc-200">
            <div
              className="h-full bg-zinc-900 transition-[width]"
              style={{ width: `${summary.progressPercent}%` }}
            />
          </div>
          <p className="text-xs text-zinc-600">{summary.progressPercent}%</p>
        </div>
      ) : null}
    </form>
  );
}
