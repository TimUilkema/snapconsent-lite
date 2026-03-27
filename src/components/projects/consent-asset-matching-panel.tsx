"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { createIdempotencyKey } from "@/lib/client/idempotency-key";
import { PreviewableImage } from "@/components/projects/previewable-image";
import { resolveSignedUploadUrlForBrowser } from "@/lib/client/storage-signed-url";

type ConsentAssetMatchingPanelProps = {
  projectId: string;
  consentId: string;
};

type MatchableMode = "default" | "likely";

type MatchableAsset = {
  id: string;
  originalFilename: string;
  status: string;
  fileSizeBytes: number;
  createdAt: string;
  uploadedAt: string | null;
  isLinked: boolean;
  candidateConfidence: number | null;
  candidateLastScoredAt: string | null;
  candidateMatcherVersion: string | null;
  thumbnailUrl: string | null;
  previewUrl: string | null;
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
  previewUrl: string | null;
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
  const [showFilenames, setShowFilenames] = useState(false);
  const [reviewLikelyMatches, setReviewLikelyMatches] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isBusy = isLoadingMatchable || isLoadingLinked || isUploading || isSavingLinks;

  function getMatchableMode(): MatchableMode {
    return reviewLikelyMatches ? "likely" : "default";
  }

  async function loadMatchableAssets(query: string, mode: MatchableMode) {
    setIsLoadingMatchable(true);
    try {
      const params = new URLSearchParams();
      if (query.trim().length > 0) {
        params.set("q", query.trim());
      }
      if (mode === "likely") {
        params.set("mode", "likely");
        params.set("limit", "50");
      }

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

  async function refreshPanelData(query: string, mode: MatchableMode) {
    await Promise.all([loadMatchableAssets(query, mode), loadLinkedAssets()]);
  }

  async function openPanel() {
    setError(null);
    setSuccess(null);
    setIsOpen(true);
    await refreshPanelData(searchQuery, getMatchableMode());
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

        if (!("signedUrl" in createPayload) || !("assetId" in createPayload)) {
          setError("Unable to prepare upload.");
          return;
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

      await refreshPanelData(searchQuery, getMatchableMode());
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

      await refreshPanelData(searchQuery, getMatchableMode());
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
      await refreshPanelData(searchQuery, getMatchableMode());
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
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
        >
          {isOpen ? "Close matching" : "Match assets"}
        </button>
      </div>

      {isOpen ? (
        <div className="mt-3 space-y-4">
          <section className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-semibold text-zinc-900">Upload new photos (auto-link)</h4>
              <button
                type="button"
                disabled={isBusy}
                onClick={() => fileInputRef.current?.click()}
                className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
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

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)]">
            <section className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold text-zinc-900">
                    {reviewLikelyMatches ? "Review likely matches" : "Link existing uploaded photos"}
                  </h4>
                  <p className="mt-1 text-xs text-zinc-600">
                    {reviewLikelyMatches
                      ? "Review medium-confidence candidates and link the correct photos."
                      : "Select unlinked project photos to connect them to this consent."}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={isBusy || selectedAssetIds.length === 0}
                    onClick={() => void linkSelectedAssets()}
                    className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
                  >
                    Link selected
                  </button>
                  <button
                    type="button"
                    disabled={isBusy || selectedAssetIds.length === 0}
                    onClick={() => void unlinkAssets(selectedAssetIds)}
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
                  >
                    Unlink selected
                  </button>
                  <label className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-800">
                    <input
                      type="checkbox"
                      checked={showFilenames}
                      onChange={(event) => setShowFilenames(event.target.checked)}
                    />
                    Show filenames
                  </label>
                  <label className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-800">
                    <input
                      type="checkbox"
                      checked={reviewLikelyMatches}
                      onChange={(event) => {
                        const nextReviewMode = event.target.checked;
                        setReviewLikelyMatches(nextReviewMode);
                        setSelectedAssetIds([]);
                        void loadMatchableAssets(searchQuery, nextReviewMode ? "likely" : "default");
                      }}
                    />
                    Review likely matches
                  </label>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search by filename"
                  className="w-full max-w-sm rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs text-zinc-900"
                />
                <button
                  type="button"
                  disabled={isBusy}
                  onClick={() => void loadMatchableAssets(searchQuery, getMatchableMode())}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
                >
                  Search
                </button>
              </div>

              {isLoadingMatchable ? (
                <p className="mt-3 text-xs text-zinc-600">Loading photos...</p>
              ) : matchableAssets.length > 0 ? (
                <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                  {matchableAssets.map((asset) => {
                    const isSelected = selectedAssetIds.includes(asset.id);
                    return (
                      <li key={asset.id} className="rounded-xl border border-zinc-200 bg-white p-2 shadow-sm">
                        <div className="space-y-2">
                          <div className="relative aspect-square overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100">
                            <PreviewableImage
                              src={asset.thumbnailUrl}
                              previewSrc={asset.previewUrl}
                              alt={asset.originalFilename}
                              className="h-full w-full"
                              imageClassName="h-full w-full object-cover"
                            />
                            <label className="absolute left-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-md border border-zinc-300 bg-white/95 shadow-sm">
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
                            </label>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            {showFilenames ? (
                              <div className="min-w-0">
                                <p className="truncate text-xs font-medium text-zinc-900">{asset.originalFilename}</p>
                                <p className="text-xs text-zinc-600">{formatBytes(asset.fileSizeBytes)}</p>
                                {reviewLikelyMatches && asset.candidateConfidence !== null ? (
                                  <p className="text-[11px] font-semibold text-amber-700">
                                    Confidence {(asset.candidateConfidence * 100).toFixed(1)}%
                                  </p>
                                ) : null}
                              </div>
                            ) : (
                              <div className="flex flex-col">
                                <span className="text-xs text-zinc-500">{formatBytes(asset.fileSizeBytes)}</span>
                                {reviewLikelyMatches && asset.candidateConfidence !== null ? (
                                  <span className="text-[11px] font-semibold text-amber-700">
                                    Confidence {(asset.candidateConfidence * 100).toFixed(1)}%
                                  </span>
                                ) : null}
                              </div>
                            )}
                            {isSelected ? (
                              <span className="rounded-md bg-zinc-900 px-2 py-0.5 text-[10px] font-semibold text-white">
                                Selected
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="mt-3 text-xs text-zinc-600">
                  {reviewLikelyMatches
                    ? "No likely matches found in the configured review confidence band."
                    : "No unlinked uploaded photos found for this project."}
                </p>
              )}
            </section>

            <section className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-zinc-900">Linked photos</h4>
                  <p className="mt-1 text-xs text-zinc-600">
                    Photos already connected to this consent can be reviewed or removed here.
                  </p>
                </div>
              </div>

              {isLoadingLinked ? (
                <p className="mt-3 text-xs text-zinc-600">Loading linked photos...</p>
              ) : linkedAssets.length > 0 ? (
                <ul className="mt-3 grid gap-3 sm:grid-cols-2">
                  {linkedAssets.map((asset) => (
                    <li
                      key={asset.id}
                      className="rounded-xl border border-zinc-200 bg-white p-2 shadow-sm"
                    >
                      <div className="space-y-2">
                        <div className="relative aspect-square overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100">
                          <PreviewableImage
                            src={asset.thumbnailUrl}
                            previewSrc={asset.previewUrl}
                            alt={asset.originalFilename}
                            className="h-full w-full"
                            imageClassName="h-full w-full object-cover"
                          />
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void unlinkAssets([asset.id])}
                            className="absolute right-2 top-2 rounded-lg border border-zinc-300 bg-white/95 px-3 py-1.5 text-[11px] font-medium text-zinc-800 shadow-sm hover:bg-white disabled:opacity-60"
                          >
                            Unlink
                          </button>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          {showFilenames ? (
                            <div className="min-w-0">
                              <p className="truncate text-xs font-medium text-zinc-900">{asset.originalFilename}</p>
                              <p className="text-xs text-zinc-600">{formatBytes(asset.fileSizeBytes)}</p>
                            </div>
                          ) : (
                            <span className="text-xs text-zinc-500">{formatBytes(asset.fileSizeBytes)}</span>
                          )}
                          <span
                            className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-semibold ${
                              asset.linkSource === "auto"
                                ? "bg-blue-100 text-blue-700"
                                : "bg-zinc-200 text-zinc-700"
                            }`}
                          >
                            {asset.linkSource === "auto" ? "Auto" : "Manual"}
                          </span>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-xs text-zinc-600">No linked photos for this consent yet.</p>
              )}
            </section>
          </div>

          {error ? <p className="text-xs text-red-700">{error}</p> : null}
          {success ? <p className="text-xs text-emerald-700">{success}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
