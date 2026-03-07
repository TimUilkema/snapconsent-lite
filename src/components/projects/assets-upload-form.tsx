"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { createIdempotencyKey } from "@/lib/client/idempotency-key";
import { resolveSignedUploadUrlForBrowser } from "@/lib/client/storage-signed-url";

type AssetsUploadFormProps = {
  projectId: string;
};

type DuplicatePolicy = "upload_anyway" | "overwrite" | "ignore";

type PreparedFile = {
  file: File;
  contentHash?: string;
  isDuplicate: boolean;
};

type CreateAssetResponse =
  | {
      skipUpload: true;
      duplicate: true;
    }
  | {
      assetId: string;
      signedUrl: string;
      storageBucket: string;
      storagePath: string;
    };

type PreflightResponse = {
  candidateSizes: number[];
  duplicateHashes: string[];
};

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function AssetsUploadForm({ projectId }: AssetsUploadFormProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [preparedFiles, setPreparedFiles] = useState<PreparedFile[]>([]);
  const [isPreparing, setIsPreparing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [assetType] = useState<"photo">("photo");
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [needsPolicyChoice, setNeedsPolicyChoice] = useState(false);
  const [duplicatePolicy, setDuplicatePolicy] = useState<DuplicatePolicy>("upload_anyway");

  const acceptValue = useMemo(() => ACCEPTED_TYPES.join(","), []);

  function clearFileInput() {
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
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
        } else {
          reject(new Error("upload_failed"));
        }
      };
      xhr.onerror = () => reject(new Error("upload_failed"));
      xhr.send(file);
    });
  }

  async function hashFile(file: File) {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
      return null;
    }

    try {
      const buffer = await file.arrayBuffer();
      const digest = await subtle.digest("SHA-256", buffer);
      return Array.from(new Uint8Array(digest))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("");
    } catch {
      return null;
    }
  }

  async function preflight(filesToCheck: File[], hashesByIndex?: Map<number, string>) {
    const response = await fetch(`/api/projects/${projectId}/assets/preflight`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assetType,
        files: filesToCheck.map((file, index) => ({
          name: file.name,
          size: file.size,
          contentType: file.type,
          contentHash: hashesByIndex?.get(index) ?? null,
        })),
      }),
    });

    const payload = (await response.json().catch(() => null)) as PreflightResponse | null;
    if (!response.ok || !payload) {
      throw new Error("preflight_failed");
    }

    return payload;
  }

  async function prepareFiles(nextFiles: File[]) {
    setError(null);
    setWarning(null);
    setSuccess(null);
    setProgressPercent(0);
    setProgressLabel(null);
    setPreparedFiles([]);
    setNeedsPolicyChoice(false);

    if (nextFiles.length === 0) {
      setError("Select one or more images to upload.");
      return;
    }

    setIsPreparing(true);

    try {
      const hashesByIndex = new Map<number, string>();
      let hashUnavailable = false;

      for (let index = 0; index < nextFiles.length; index += 1) {
        const file = nextFiles[index];
        const hash = await hashFile(file);
        if (!hash) {
          hashUnavailable = true;
          continue;
        }

        hashesByIndex.set(index, hash);
      }

      const hashPayload = await preflight(nextFiles, hashesByIndex.size > 0 ? hashesByIndex : undefined);
      const duplicateHashes = new Set(hashPayload.duplicateHashes ?? []);

      const prepared = nextFiles.map((file, index) => {
        const contentHash = hashesByIndex.get(index);
        const isDuplicate = contentHash ? duplicateHashes.has(contentHash) : false;
        return { file, contentHash, isDuplicate };
      });

      setPreparedFiles(prepared);
      if (hashUnavailable) {
        setWarning(
          "Hash-based duplicate checks are unavailable on this connection. Upload continues, but some duplicates may be missed.",
        );
      }

      if (prepared.some((entry) => entry.isDuplicate)) {
        setNeedsPolicyChoice(true);
        setDuplicatePolicy("upload_anyway");
        return;
      }

      await uploadPreparedFiles(prepared, "upload_anyway");
    } catch {
      setError("Unable to prepare uploads right now.");
    } finally {
      setIsPreparing(false);
    }
  }

  async function uploadPreparedFiles(nextPrepared: PreparedFile[], policy: DuplicatePolicy) {
    setError(null);
    setWarning(null);
    setSuccess(null);
    setProgressPercent(0);
    setProgressLabel(null);

    if (nextPrepared.length === 0) {
      setError("Select one or more images to upload.");
      return;
    }

    setIsSubmitting(true);

    try {
      const totalBytes = nextPrepared.reduce((sum, entry) => sum + entry.file.size, 0);
      let completedBytes = 0;
      let uploadedCount = 0;
      let skippedCount = 0;

      for (const entry of nextPrepared) {
        if (policy === "ignore" && entry.isDuplicate) {
          completedBytes += entry.file.size;
          skippedCount += 1;
          const percent =
            totalBytes > 0 ? Math.round((completedBytes / totalBytes) * 100) : 0;
          setProgressPercent(percent);
          continue;
        }

        const idempotencyKey = createIdempotencyKey();
        const createResponse = await fetch(`/api/projects/${projectId}/assets`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({
            originalFilename: entry.file.name,
            contentType: entry.file.type,
            fileSizeBytes: entry.file.size,
            consentIds: [],
            contentHash: entry.contentHash,
            contentHashAlgo: entry.contentHash ? "sha256" : null,
            assetType,
            duplicatePolicy: policy,
          }),
        });

        const createPayload = (await createResponse.json().catch(() => null)) as
          | (CreateAssetResponse & { message?: string })
          | null;

        if (!createResponse.ok || !createPayload) {
          setError(createPayload?.message ?? "Unable to create asset upload.");
          return;
        }

        if ("skipUpload" in createPayload && createPayload.skipUpload) {
          completedBytes += entry.file.size;
          skippedCount += 1;
          const percent =
            totalBytes > 0 ? Math.round((completedBytes / totalBytes) * 100) : 0;
          setProgressPercent(percent);
          continue;
        }

        setProgressLabel(`Uploading ${entry.file.name}`);
        await uploadWithProgress(entry.file, createPayload.signedUrl, (loaded) => {
          const percent =
            totalBytes > 0 ? Math.round(((completedBytes + loaded) / totalBytes) * 100) : 0;
          setProgressPercent(percent);
        });

        completedBytes += entry.file.size;

        const finalizeResponse = await fetch(
          `/api/projects/${projectId}/assets/${createPayload.assetId}/finalize`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ consentIds: [] }),
          },
        );

        if (!finalizeResponse.ok) {
          const finalizePayload = (await finalizeResponse.json().catch(() => null)) as
            | { message?: string }
            | null;
          setError(finalizePayload?.message ?? "Unable to finalize upload.");
          return;
        }

        uploadedCount += 1;
      }

      setProgressLabel(null);
      setProgressPercent(100);
      if (skippedCount > 0) {
        setSuccess(`Upload complete (${uploadedCount} uploaded, ${skippedCount} skipped).`);
      } else {
        setSuccess(`Upload complete (${uploadedCount}).`);
      }
      setFiles([]);
      clearFileInput();
      setPreparedFiles([]);
      setNeedsPolicyChoice(false);
      router.refresh();
    } catch {
      setError("Unable to upload asset right now.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const isBusy = isPreparing || isSubmitting;
  const duplicateCount = preparedFiles.filter((entry) => entry.isDuplicate).length;

  return (
    <form className="space-y-3">
      <label className="block text-sm">
        <span className="mb-1 block font-medium">Upload project photos</span>
        <input
          type="file"
          accept={acceptValue}
          multiple
          ref={fileInputRef}
          disabled={isBusy}
          onChange={(event) => {
            const selected = Array.from(event.target.files ?? []);
            setFiles(selected);
            prepareFiles(selected);
          }}
          className="block w-full text-sm"
        />
      </label>
      {files.length > 0 ? (
        <p className="text-sm text-zinc-600">
          Selected: {files.length} file{files.length === 1 ? "" : "s"}
        </p>
      ) : (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isBusy}
          className="rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
        >
          Upload images
        </button>
      )}

      {needsPolicyChoice ? (
        <div className="space-y-2 rounded border border-amber-200 bg-amber-50 p-3 text-sm">
          <p className="font-medium">Duplicates detected for this batch.</p>
          <p className="text-xs text-zinc-600">
            {duplicateCount} duplicate file{duplicateCount === 1 ? "" : "s"} out of{" "}
            {preparedFiles.length} total.
          </p>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="duplicatePolicy"
              checked={duplicatePolicy === "upload_anyway"}
              onChange={() => setDuplicatePolicy("upload_anyway")}
            />
            <span>Upload anyway</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="duplicatePolicy"
              checked={duplicatePolicy === "overwrite"}
              onChange={() => setDuplicatePolicy("overwrite")}
            />
            <span>Overwrite duplicates (archive existing)</span>
          </label>
          <label className="flex items-center gap-2">
            <input
              type="radio"
              name="duplicatePolicy"
              checked={duplicatePolicy === "ignore"}
              onChange={() => setDuplicatePolicy("ignore")}
            />
            <span>Ignore duplicates</span>
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={isBusy}
              onClick={() => uploadPreparedFiles(preparedFiles, duplicatePolicy)}
              className="rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
            >
              Continue upload
            </button>
            <button
              type="button"
              disabled={isBusy}
              onClick={() => {
                setFiles([]);
                clearFileInput();
                setPreparedFiles([]);
                setNeedsPolicyChoice(false);
              }}
              className="rounded border border-zinc-300 px-3 py-2 text-sm font-medium text-zinc-700 hover:bg-white disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <p className="text-sm text-zinc-600">
        Headshots are managed per consent record in the invite consent details.
      </p>

      {isPreparing ? <p className="text-xs text-zinc-600">Checking for duplicates...</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {warning ? <p className="text-sm text-amber-700">{warning}</p> : null}
      {success ? <p className="text-sm text-emerald-700">{success}</p> : null}
      {isSubmitting ? (
        <div className="space-y-1">
          {progressLabel ? <p className="text-xs text-zinc-600">{progressLabel}</p> : null}
          <div className="h-2 w-full overflow-hidden rounded bg-zinc-200">
            <div
              className="h-full bg-zinc-900 transition-[width]"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <p className="text-xs text-zinc-600">{progressPercent}%</p>
        </div>
      ) : null}
    </form>
  );
}
