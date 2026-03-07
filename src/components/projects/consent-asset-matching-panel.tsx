"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { createIdempotencyKey } from "@/lib/client/idempotency-key";
import { resolveSignedUploadUrlForBrowser } from "@/lib/client/storage-signed-url";

type ConsentAssetMatchingPanelProps = {
  projectId: string;
  consentId: string;
};

type MatchableAsset = {
  id: string;
  originalFilename: string;
  status: string;
  fileSizeBytes: number;
  createdAt: string;
  uploadedAt: string | null;
  isLinked: boolean;
  thumbnailUrl: string | null;
};

type LinkedAsset = {
  id: string;
  originalFilename: string;
  status: string;
  fileSizeBytes: number;
  createdAt: string;
  uploadedAt: string | null;
  archivedAt: string | null;
  linkCreatedAt: string;
  linkSource: "manual" | "auto";
  matchConfidence: number | null;
  matchedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  thumbnailUrl: string | null;
};

type ListAssetsResponse<T> = {
  assets?: T[];
  message?: string;
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

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

async function uploadFileToSignedUrl(file: File, signedUrl: string) {
  const response = await fetch(resolveSignedUploadUrlForBrowser(signedUrl), {
    method: "PUT",
    headers: {
      "Content-Type": file.type || "application/octet-stream",
    },
    body: file,
  });

  if (!response.ok) {
    throw new Error("upload_failed");
  }
}

export function ConsentAssetMatchingPanel({ projectId, consentId }: ConsentAssetMatchingPanelProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [matchableAssets, setMatchableAssets] = useState<MatchableAsset[]>([]);
  const [linkedAssets, setLinkedAssets] = useState<LinkedAsset[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [isLoadingMatchable, setIsLoadingMatchable] = useState(false);
  const [isLoadingLinked, setIsLoadingLinked] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isSavingLinks, setIsSavingLinks] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isBusy = isLoadingMatchable || isLoadingLinked || isUploading || isSavingLinks;

  async function loadMatchableAssets(query: string) {
    setIsLoadingMatchable(true);
    try {
      const params = new URLSearchParams();
      if (query.trim().length > 0) {
        params.set("q", query.trim());
      }
      params.set("limit", "50");

      const response = await fetch(
        `/api/projects/${projectId}/consents/${consentId}/assets/matchable?${params.toString()}`,
        { method: "GET" },
      );
      const payload = (await response.json().catch(() => null)) as ListAssetsResponse<MatchableAsset> | null;

      if (!response.ok || !payload) {
        setError(payload?.message ?? "Unable to load project photos.");
        setMatchableAssets([]);
        return;
      }

      setMatchableAssets(payload.assets ?? []);
    } catch {
      setError("Unable to load project photos.");
      setMatchableAssets([]);
    } finally {
      setIsLoadingMatchable(false);
    }
  }

  async function loadLinkedAssets() {
    setIsLoadingLinked(true);
    try {
      const response = await fetch(`/api/projects/${projectId}/consents/${consentId}/assets/links`, {
        method: "GET",
      });
      const payload = (await response.json().catch(() => null)) as ListAssetsResponse<LinkedAsset> | null;

      if (!response.ok || !payload) {
        setError(payload?.message ?? "Unable to load linked photos.");
        setLinkedAssets([]);
        return;
      }

      setLinkedAssets(payload.assets ?? []);
    } catch {
      setError("Unable to load linked photos.");
      setLinkedAssets([]);
    } finally {
      setIsLoadingLinked(false);
    }
  }

  async function refreshPanelData(query: string) {
    await Promise.all([loadMatchableAssets(query), loadLinkedAssets()]);
  }

  async function openPanel() {
    setError(null);
    setSuccess(null);
    setIsOpen(true);
    await refreshPanelData(searchQuery);
  }

  async function handleUploadNewPhotos(files: File[]) {
    if (files.length === 0) {
      return;
    }

    setError(null);
    setSuccess(null);
    setIsUploading(true);

    try {
      let uploadedCount = 0;
      for (const file of files) {
        const createResponse = await fetch(`/api/projects/${projectId}/assets`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": createIdempotencyKey(),
          },
          body: JSON.stringify({
            originalFilename: file.name,
            contentType: file.type,
            fileSizeBytes: file.size,
            assetType: "photo",
            consentIds: [consentId],
            duplicatePolicy: "upload_anyway",
          }),
        });

        const createPayload = (await createResponse.json().catch(() => null)) as
          | (CreateAssetResponse & { message?: string })
          | null;

        if (!createResponse.ok || !createPayload) {
          setError(createPayload?.message ?? "Unable to prepare upload.");
          return;
        }

        if ("skipUpload" in createPayload && createPayload.skipUpload) {
          continue;
        }

        await uploadFileToSignedUrl(file, createPayload.signedUrl);

        const finalizeResponse = await fetch(
          `/api/projects/${projectId}/assets/${createPayload.assetId}/finalize`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              consentIds: [consentId],
            }),
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

      await refreshPanelData(searchQuery);
      router.refresh();
      setSuccess(
        uploadedCount > 0
          ? `Uploaded and linked ${uploadedCount} photo${uploadedCount === 1 ? "" : "s"}.`
          : "No new photos were uploaded.",
      );
    } catch {
      setError("Unable to upload and link photos right now.");
    } finally {
      setIsUploading(false);
    }
  }

  async function linkSelectedAssets() {
    if (selectedAssetIds.length === 0) {
      setError("Select one or more photos to link.");
      return;
    }

    setError(null);
    setSuccess(null);
    setIsSavingLinks(true);

    try {
      const response = await fetch(`/api/projects/${projectId}/consents/${consentId}/assets/links`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ assetIds: selectedAssetIds }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { message?: string; linkedCount?: number }
        | null;

      if (!response.ok || !payload) {
        setError(payload?.message ?? "Unable to link selected photos.");
        return;
      }

      await refreshPanelData(searchQuery);
      router.refresh();
      setSuccess(`Linked ${payload.linkedCount ?? selectedAssetIds.length} photo(s).`);
    } catch {
      setError("Unable to link selected photos.");
    } finally {
      setIsSavingLinks(false);
    }
  }

  async function unlinkAssets(assetIds: string[]) {
    if (assetIds.length === 0) {
      return;
    }

    setError(null);
    setSuccess(null);
    setIsSavingLinks(true);

    try {
      const response = await fetch(`/api/projects/${projectId}/consents/${consentId}/assets/links`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ assetIds }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { message?: string; unlinkedCount?: number }
        | null;

      if (!response.ok || !payload) {
        setError(payload?.message ?? "Unable to unlink selected photos.");
        return;
      }

      setSelectedAssetIds((current) => current.filter((assetId) => !assetIds.includes(assetId)));
      await refreshPanelData(searchQuery);
      router.refresh();
      setSuccess(`Unlinked ${payload.unlinkedCount ?? assetIds.length} photo(s).`);
    } catch {
      setError("Unable to unlink selected photos.");
    } finally {
      setIsSavingLinks(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={isBusy}
          onClick={() => {
            if (isOpen) {
              setIsOpen(false);
              return;
            }
            void openPanel();
          }}
          className="rounded-full border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
        >
          {isOpen ? "Close matching" : "Match assets"}
        </button>
      </div>

      {isOpen ? (
        <div className="mt-3 space-y-4">
          <section className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-zinc-900">Upload new photos (auto-link)</h4>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => fileInputRef.current?.click()}
                className="rounded-full bg-zinc-900 px-3 py-2 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
              >
                {isUploading ? "Uploading..." : "Upload photos"}
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              className="hidden"
              disabled={isBusy}
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = "";
                void handleUploadNewPhotos(files);
              }}
            />
            <p className="text-xs text-zinc-600">
              Uploaded photos from this action are finalized and linked to this consent automatically.
            </p>
          </section>

          <section className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-zinc-900">Link existing uploaded photos</h4>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={isBusy || selectedAssetIds.length === 0}
                  onClick={() => void linkSelectedAssets()}
                  className="rounded-full bg-zinc-900 px-3 py-2 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
                >
                  Link selected
                </button>
                <button
                  type="button"
                  disabled={isBusy || selectedAssetIds.length === 0}
                  onClick={() => void unlinkAssets(selectedAssetIds)}
                  className="rounded-full border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
                >
                  Unlink selected
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search by filename"
                className="w-full max-w-sm rounded border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-900"
              />
              <button
                type="button"
                disabled={isBusy}
                onClick={() => void loadMatchableAssets(searchQuery)}
                className="rounded-full border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
              >
                Search
              </button>
            </div>

            {isLoadingMatchable ? (
              <p className="text-xs text-zinc-600">Loading photos...</p>
            ) : matchableAssets.length > 0 ? (
              <ul className="space-y-2">
                {matchableAssets.map((asset) => {
                  const isSelected = selectedAssetIds.includes(asset.id);
                  return (
                    <li key={asset.id} className="rounded border border-zinc-200 bg-white p-2">
                      <label className="flex items-start gap-2">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(event) => {
                            setSelectedAssetIds((current) => {
                              if (event.target.checked) {
                                return current.includes(asset.id) ? current : [...current, asset.id];
                              }
                              return current.filter((assetId) => assetId !== asset.id);
                            });
                          }}
                        />
                        <div className="flex min-w-0 flex-1 gap-2">
                          <div className="h-12 w-12 shrink-0 overflow-hidden rounded border border-zinc-200 bg-zinc-100">
                            {asset.thumbnailUrl ? (
                              <img
                                src={asset.thumbnailUrl}
                                alt={asset.originalFilename}
                                loading="lazy"
                                className="h-full w-full object-cover"
                              />
                            ) : null}
                          </div>
                          <div className="min-w-0">
                            <p className="truncate text-xs font-medium text-zinc-900">{asset.originalFilename}</p>
                            <p className="text-xs text-zinc-600">{formatBytes(asset.fileSizeBytes)}</p>
                          </div>
                        </div>
                      </label>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-xs text-zinc-600">No unlinked uploaded photos found for this project.</p>
            )}
          </section>

          <section className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
            <h4 className="text-sm font-semibold text-zinc-900">Linked photos</h4>
            {isLoadingLinked ? (
              <p className="text-xs text-zinc-600">Loading linked photos...</p>
            ) : linkedAssets.length > 0 ? (
              <ul className="space-y-2">
                {linkedAssets.map((asset) => (
                  <li key={asset.id} className="flex items-center justify-between gap-2 rounded border border-zinc-200 bg-white p-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="h-12 w-12 shrink-0 overflow-hidden rounded border border-zinc-200 bg-zinc-100">
                        {asset.thumbnailUrl ? (
                          <img
                            src={asset.thumbnailUrl}
                            alt={asset.originalFilename}
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        ) : null}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-zinc-900">{asset.originalFilename}</p>
                        <p className="text-xs text-zinc-600">
                          Linked at {new Date(asset.linkCreatedAt).toLocaleString()}
                        </p>
                        <p className="mt-1">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                              asset.linkSource === "auto"
                                ? "bg-blue-100 text-blue-700"
                                : "bg-zinc-200 text-zinc-700"
                            }`}
                          >
                            {asset.linkSource === "auto" ? "Auto" : "Manual"}
                          </span>
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void unlinkAssets([asset.id])}
                      className="rounded-full border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
                    >
                      Unlink
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-zinc-600">No linked photos for this consent yet.</p>
            )}
          </section>

          {error ? <p className="text-xs text-red-700">{error}</p> : null}
          {success ? <p className="text-xs text-emerald-700">{success}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
