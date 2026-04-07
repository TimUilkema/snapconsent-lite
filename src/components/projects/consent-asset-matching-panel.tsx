"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { PreviewableImage } from "@/components/projects/previewable-image";
import { PhotoLinkReviewDialog } from "@/components/projects/photo-link-review-dialog";

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
  candidateAssetFaceId: string | null;
  candidateFaceRank: number | null;
  thumbnailUrl: string | null;
  thumbnailState?: "ready_derivative" | "transform_fallback" | "processing" | "unavailable";
  previewUrl: string | null;
  previewState?: "ready_derivative" | "transform_fallback" | "processing" | "unavailable";
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
  linkMode: "face" | "asset_fallback";
  assetFaceId: string | null;
  faceRank: number | null;
  detectedFaceCount: number | null;
  linkedFaceCropUrl: string | null;
  thumbnailUrl: string | null;
  thumbnailState?: "ready_derivative" | "transform_fallback" | "processing" | "unavailable";
  previewUrl: string | null;
  previewState?: "ready_derivative" | "transform_fallback" | "processing" | "unavailable";
};

type ReviewAsset = {
  id: string;
  originalFilename: string;
  thumbnailUrl: string | null;
  thumbnailState?: "ready_derivative" | "transform_fallback" | "processing" | "unavailable";
  previewUrl: string | null;
  previewState?: "ready_derivative" | "transform_fallback" | "processing" | "unavailable";
  preferredAssetFaceId?: string | null;
  preferredFaceRank?: number | null;
};

type ListAssetsResponse<T> = {
  assets?: T[];
  page?: number;
  pageSize?: number;
  hasNextPage?: boolean;
  hasPreviousPage?: boolean;
  message?: string;
};

type ReviewSessionSummary = {
  id: string;
  status: "open" | "completed" | "cancelled" | "expired";
  selectedAssetCount: number;
  completedCount: number;
  pendingMaterializationCount: number;
  readyForFaceSelectionCount: number;
  blockedCount: number;
  currentQueueIndex: number | null;
  nextReviewItemId: string | null;
  reusedExistingSession?: boolean;
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

function buildReviewAsset(asset: {
  id: string;
  originalFilename: string;
  thumbnailUrl: string | null;
  thumbnailState?: "ready_derivative" | "transform_fallback" | "processing" | "unavailable";
  previewUrl: string | null;
  previewState?: "ready_derivative" | "transform_fallback" | "processing" | "unavailable";
  candidateAssetFaceId?: string | null;
  candidateFaceRank?: number | null;
  assetFaceId?: string | null;
  faceRank?: number | null;
}): ReviewAsset {
  return {
    id: asset.id,
    originalFilename: asset.originalFilename,
    thumbnailUrl: asset.thumbnailUrl,
    thumbnailState: asset.thumbnailState,
    previewUrl: asset.previewUrl,
    previewState: asset.previewState,
    preferredAssetFaceId: asset.candidateAssetFaceId ?? asset.assetFaceId ?? null,
    preferredFaceRank: asset.candidateFaceRank ?? asset.faceRank ?? null,
  };
}

export function ConsentAssetMatchingPanel({ projectId, consentId }: ConsentAssetMatchingPanelProps) {
  const router = useRouter();

  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [matchableAssets, setMatchableAssets] = useState<MatchableAsset[]>([]);
  const [linkedAssets, setLinkedAssets] = useState<LinkedAsset[]>([]);
  const [activeReviewAsset, setActiveReviewAsset] = useState<ReviewAsset | null>(null);
  const [activeReviewSessionId, setActiveReviewSessionId] = useState<string | null>(null);
  const [currentReviewSession, setCurrentReviewSession] = useState<ReviewSessionSummary | null>(null);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [matchablePage, setMatchablePage] = useState(0);
  const [matchablePageSize, setMatchablePageSize] = useState(20);
  const [hasNextMatchablePage, setHasNextMatchablePage] = useState(false);
  const [hasPreviousMatchablePage, setHasPreviousMatchablePage] = useState(false);
  const [isLoadingMatchable, setIsLoadingMatchable] = useState(false);
  const [isLoadingLinked, setIsLoadingLinked] = useState(false);
  const [isPreparingReview, setIsPreparingReview] = useState(false);
  const [showFilenames, setShowFilenames] = useState(false);
  const [reviewLikelyMatches, setReviewLikelyMatches] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isBusy = isLoadingMatchable || isLoadingLinked || isPreparingReview;

  function getMatchableMode(): MatchableMode {
    return reviewLikelyMatches ? "likely" : "default";
  }

  async function loadMatchableAssets(
    query: string,
    mode: MatchableMode,
    page = matchablePage,
    pageSize = matchablePageSize,
  ) {
    setIsLoadingMatchable(true);
    try {
      const params = new URLSearchParams();
      if (query.trim().length > 0) {
        params.set("q", query.trim());
      }
      params.set("page", String(page));
      params.set("limit", String(pageSize));
      if (mode === "likely") {
        params.set("mode", "likely");
      }

      const response = await fetch(
        `/api/projects/${projectId}/consents/${consentId}/assets/matchable?${params.toString()}`,
        { method: "GET" },
      );
      const payload = (await response.json().catch(() => null)) as ListAssetsResponse<MatchableAsset> | null;

      if (!response.ok || !payload) {
        setError(payload?.message ?? "Unable to load project photos.");
        setMatchableAssets([]);
        setHasNextMatchablePage(false);
        setHasPreviousMatchablePage(page > 0);
        return;
      }

      setMatchableAssets(payload.assets ?? []);
      setMatchablePage(payload.page ?? page);
      setMatchablePageSize(payload.pageSize ?? pageSize);
      setHasNextMatchablePage(payload.hasNextPage === true);
      setHasPreviousMatchablePage(payload.hasPreviousPage === true);
    } catch {
      setError("Unable to load project photos.");
      setMatchableAssets([]);
      setHasNextMatchablePage(false);
      setHasPreviousMatchablePage(page > 0);
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

  async function loadCurrentReviewSession() {
    try {
      const response = await fetch(`/api/projects/${projectId}/consents/${consentId}/review-sessions/current`, {
        method: "GET",
        cache: "no-store",
      });

      if (response.status === 404) {
        setCurrentReviewSession(null);
        return;
      }

      const payload = (await response.json().catch(() => null)) as
        | {
            session?: ReviewSessionSummary;
            message?: string;
          }
        | null;

      if (!response.ok || !payload?.session) {
        setCurrentReviewSession(null);
        return;
      }

      setCurrentReviewSession(payload.session);
    } catch {
      setCurrentReviewSession(null);
    }
  }

  async function refreshPanelData(query: string, mode: MatchableMode, page = matchablePage, pageSize = matchablePageSize) {
    await Promise.all([loadMatchableAssets(query, mode, page, pageSize), loadLinkedAssets(), loadCurrentReviewSession()]);
  }

  async function openPanel() {
    setError(null);
    setSuccess(null);
    setIsOpen(true);
    setMatchablePage(0);
    await refreshPanelData(searchQuery, getMatchableMode(), 0, matchablePageSize);
  }

  function toggleSelectedAsset(assetId: string, checked: boolean) {
    setSelectedAssetIds((current) => {
      if (checked) {
        return current.includes(assetId) ? current : [...current, assetId];
      }

      return current.filter((value) => value !== assetId);
    });
  }

  async function startBulkReview() {
    if (selectedAssetIds.length === 0) {
      setError("Select at least one project photo.");
      return;
    }

    setIsPreparingReview(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await fetch(`/api/projects/${projectId}/consents/${consentId}/review-sessions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          assetIds: selectedAssetIds,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            session?: ReviewSessionSummary;
            message?: string;
          }
        | null;

      if (!response.ok || !payload?.session) {
        setError(payload?.message ?? "Unable to prepare the review queue.");
        return;
      }

      setCurrentReviewSession(payload.session);
      setSelectedAssetIds([]);
      await refreshPanelData(searchQuery, getMatchableMode(), matchablePage, matchablePageSize);

      if (
        payload.session.readyForFaceSelectionCount > 0 ||
        payload.session.pendingMaterializationCount > 0 ||
        payload.session.blockedCount > 0
      ) {
        setActiveReviewAsset(null);
        setActiveReviewSessionId(payload.session.id);
        return;
      }

      setSuccess(`Processed ${payload.session.completedCount} photo assignments without additional face review.`);
      router.refresh();
    } catch {
      setError("Unable to prepare the review queue.");
    } finally {
      setIsPreparingReview(false);
    }
  }

  async function handleReviewSaved() {
    setError(null);
    await refreshPanelData(searchQuery, getMatchableMode(), matchablePage, matchablePageSize);
    router.refresh();
    setSuccess("Updated photo assignment.");
  }

  return (
    <div className="mt-3 rounded-xl border border-zinc-200 bg-white p-3 lg:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={isBusy}
          onClick={() => {
            if (isOpen) {
              setActiveReviewAsset(null);
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
          <div className="space-y-4">
            <section className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold text-zinc-900">
                    {reviewLikelyMatches ? "Review likely matches" : "Review project photos"}
                  </h4>
                  <p className="mt-1 text-xs text-zinc-600">
                    {reviewLikelyMatches
                      ? "Inspect medium-confidence candidates and choose the correct detected face."
                      : "Review uploaded project photos and assign this consent to the correct face when needed."}
                  </p>
                  <p className="mt-2 text-xs text-zinc-500">
                    Upload new project photos in{" "}
                    <a href="#project-assets" className="font-medium text-zinc-700 underline underline-offset-2">
                      Assets
                    </a>
                    . This panel only links photos that already belong to the project.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
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
                        setMatchablePage(0);
                        void loadMatchableAssets(searchQuery, nextReviewMode ? "likely" : "default", 0, matchablePageSize);
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
                  onClick={() => {
                    setMatchablePage(0);
                    void loadMatchableAssets(searchQuery, getMatchableMode(), 0, matchablePageSize);
                  }}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
                >
                  Search
                </button>
                <label className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-800">
                  <span>Page size</span>
                  <select
                    value={matchablePageSize}
                    disabled={isBusy}
                    onChange={(event) => {
                      const nextPageSize = Number(event.target.value);
                      setMatchablePageSize(nextPageSize);
                      setMatchablePage(0);
                      void loadMatchableAssets(searchQuery, getMatchableMode(), 0, nextPageSize);
                    }}
                    className="bg-transparent text-xs text-zinc-900 outline-none"
                  >
                    {[20, 50, 100].map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={isBusy || selectedAssetIds.length === 0}
                  onClick={() => void startBulkReview()}
                  className="rounded-lg bg-zinc-900 px-3 py-2 text-xs font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
                >
                  {isPreparingReview ? "Preparing queue..." : `Review selected (${selectedAssetIds.length})`}
                </button>
              </div>

              {currentReviewSession ? (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-3">
                  <div>
                    <p className="text-xs font-semibold text-zinc-900">Active review queue</p>
                    <p className="mt-1 text-xs text-zinc-600">
                      {currentReviewSession.completedCount} completed, {currentReviewSession.readyForFaceSelectionCount} ready, {currentReviewSession.pendingMaterializationCount} pending.
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => {
                      setActiveReviewAsset(null);
                      setActiveReviewSessionId(currentReviewSession.id);
                    }}
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
                  >
                    Resume queue
                  </button>
                </div>
              ) : null}

              {isLoadingMatchable ? (
                <p className="mt-3 text-xs text-zinc-600">Loading photos...</p>
              ) : matchableAssets.length > 0 ? (
                <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                  {matchableAssets.map((asset) => (
                    <li key={asset.id} className="rounded-xl border border-zinc-200 bg-white p-2.5 shadow-sm">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <label className="inline-flex items-center gap-2 text-xs text-zinc-700">
                            <input
                              type="checkbox"
                              checked={selectedAssetIds.includes(asset.id)}
                              onChange={(event) => toggleSelectedAsset(asset.id, event.target.checked)}
                            />
                            Select for queue
                          </label>
                          {asset.candidateFaceRank !== null ? (
                            <span className="text-[11px] font-medium text-zinc-600">
                              Likely face {asset.candidateFaceRank + 1}
                            </span>
                          ) : null}
                        </div>
                        <div className="relative aspect-square overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100">
                          <PreviewableImage
                            src={asset.thumbnailUrl}
                            previewSrc={asset.previewUrl}
                            alt={asset.originalFilename}
                            className="h-full w-full"
                            imageClassName="h-full w-full object-cover"
                            emptyState={asset.thumbnailState === "processing" ? "processing" : "unavailable"}
                            emptyLabel={
                              asset.thumbnailState === "processing"
                                ? "Display image is still processing"
                                : "Display image is unavailable"
                            }
                          />
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => {
                              setActiveReviewSessionId(null);
                              setActiveReviewAsset(buildReviewAsset(asset));
                            }}
                            className="absolute right-2 top-2 rounded-lg border border-zinc-300 bg-white/95 px-3 py-1.5 text-[11px] font-medium text-zinc-800 shadow-sm hover:bg-white disabled:opacity-60"
                          >
                            {reviewLikelyMatches ? "Review likely match" : "Review photo"}
                          </button>
                        </div>
                        <div className="space-y-1.5">
                          {showFilenames ? (
                            <div className="min-w-0">
                              <p className="truncate text-xs font-medium text-zinc-900">{asset.originalFilename}</p>
                              <p className="text-xs text-zinc-600">{formatBytes(asset.fileSizeBytes)}</p>
                            </div>
                          ) : (
                            <span className="text-xs text-zinc-500">{formatBytes(asset.fileSizeBytes)}</span>
                          )}
                          <div className="flex flex-wrap gap-2 text-[11px]">
                            {reviewLikelyMatches && asset.candidateConfidence !== null ? (
                              <span className="rounded-md bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
                                Confidence {(asset.candidateConfidence * 100).toFixed(1)}%
                              </span>
                            ) : null}
                            {asset.candidateFaceRank !== null ? (
                              <span className="rounded-md bg-blue-100 px-2 py-0.5 font-semibold text-blue-800">
                                Candidate face {asset.candidateFaceRank + 1}
                              </span>
                            ) : null}
                            {asset.isLinked ? (
                              <span className="rounded-md bg-zinc-200 px-2 py-0.5 font-semibold text-zinc-700">
                                Already linked
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-xs text-zinc-600">
                  {reviewLikelyMatches
                    ? "No likely matches found in the configured review confidence band."
                    : "No uploaded photos need review for this consent right now."}
                </p>
              )}

              <div className="mt-3 flex items-center justify-between gap-3 border-t border-zinc-200 pt-3">
                <p className="text-xs text-zinc-600">Page {matchablePage + 1}</p>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={isBusy || !hasPreviousMatchablePage}
                    onClick={() => {
                      const previousPage = Math.max(0, matchablePage - 1);
                      void loadMatchableAssets(searchQuery, getMatchableMode(), previousPage, matchablePageSize);
                    }}
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={isBusy || !hasNextMatchablePage}
                    onClick={() => {
                      void loadMatchableAssets(searchQuery, getMatchableMode(), matchablePage + 1, matchablePageSize);
                    }}
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
                  >
                    Next
                  </button>
                </div>
              </div>
            </section>

            <section className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-sm font-semibold text-zinc-900">Current assignments</h4>
                  <p className="mt-1 text-xs text-zinc-600">
                    Review the current face-level links and zero-face fallbacks for this consent here.
                  </p>
                </div>
              </div>

              {isLoadingLinked ? (
                <p className="mt-3 text-xs text-zinc-600">Loading linked photos...</p>
              ) : linkedAssets.length > 0 ? (
                <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                  {linkedAssets.map((asset) => (
                    <li
                      key={`${asset.id}:${asset.linkMode}:${asset.assetFaceId ?? "fallback"}`}
                      className="rounded-xl border border-zinc-200 bg-white p-2.5 shadow-sm"
                    >
                      <div className="space-y-2">
                        <div className="relative aspect-square overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100">
                          <PreviewableImage
                            src={asset.thumbnailUrl}
                            previewSrc={asset.previewUrl}
                            alt={asset.originalFilename}
                            className="h-full w-full"
                            imageClassName="h-full w-full object-cover"
                            emptyState={asset.thumbnailState === "processing" ? "processing" : "unavailable"}
                            emptyLabel={
                              asset.thumbnailState === "processing"
                                ? "Display image is still processing"
                                : "Display image is unavailable"
                            }
                          />
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => setActiveReviewAsset(buildReviewAsset(asset))}
                            className="absolute right-2 top-2 rounded-lg border border-zinc-300 bg-white/95 px-3 py-1.5 text-[11px] font-medium text-zinc-800 shadow-sm hover:bg-white disabled:opacity-60"
                          >
                            Review link
                          </button>
                        </div>
                        <div className="space-y-1.5">
                          {showFilenames ? (
                            <div className="min-w-0">
                              <p className="truncate text-xs font-medium text-zinc-900">{asset.originalFilename}</p>
                              <p className="text-xs text-zinc-600">{formatBytes(asset.fileSizeBytes)}</p>
                            </div>
                          ) : (
                            <span className="text-xs text-zinc-500">{formatBytes(asset.fileSizeBytes)}</span>
                          )}
                          <div className="flex flex-wrap gap-2 text-[11px]">
                            <span
                              className={`rounded-md px-2 py-0.5 font-semibold ${
                                asset.linkSource === "auto"
                                  ? "bg-blue-100 text-blue-700"
                                  : "bg-zinc-200 text-zinc-700"
                              }`}
                            >
                              {asset.linkSource === "auto" ? "Auto" : "Manual"}
                            </span>
                            {asset.linkMode === "asset_fallback" ? (
                              <span className="rounded-md bg-amber-100 px-2 py-0.5 font-semibold text-amber-800">
                                Zero-face fallback
                              </span>
                            ) : asset.faceRank !== null ? (
                              <span className="rounded-md bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-800">
                                Face {asset.faceRank + 1}
                              </span>
                            ) : null}
                          </div>
                          {asset.linkedFaceCropUrl ? (
                            <div className="flex items-center gap-2 pt-1">
                              <PreviewableImage
                                src={asset.linkedFaceCropUrl}
                                previewSrc={asset.linkedFaceCropUrl}
                                alt={`Linked face ${asset.faceRank !== null ? asset.faceRank + 1 : ""}`}
                                className="h-12 w-12"
                                imageClassName="h-12 w-12 rounded-md border border-zinc-200 object-cover"
                              />
                              <span className="text-[11px] text-zinc-600">Linked face crop</span>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-xs text-zinc-600">No current photo assignments for this consent yet.</p>
              )}
            </section>
          </div>

          {error ? <p className="text-xs text-red-700">{error}</p> : null}
          {success ? <p className="text-xs text-emerald-700">{success}</p> : null}

          {activeReviewAsset || activeReviewSessionId ? (
            <PhotoLinkReviewDialog
              projectId={projectId}
              consentId={consentId}
              asset={activeReviewAsset}
              sessionId={activeReviewSessionId}
              onClose={() => {
                setActiveReviewAsset(null);
                setActiveReviewSessionId(null);
              }}
              onSaved={handleReviewSaved}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
