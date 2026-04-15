"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { PreviewableImage } from "@/components/projects/previewable-image";
import { ProjectAssetPreviewLightbox } from "@/components/projects/project-asset-preview-lightbox";
import { resolveLocalizedApiError } from "@/lib/i18n/error-message";
import { formatDate } from "@/lib/i18n/format";

type AssetRow = {
  id: string;
  originalFilename: string;
  status: string;
  fileSizeBytes: number;
  createdAt: string;
  uploadedAt: string | null;
  originalWidth?: number | null;
  originalHeight?: number | null;
  thumbnailUrl?: string | null;
  thumbnailState?: "ready_derivative" | "transform_fallback" | "processing" | "unavailable";
  previewUrl?: string | null;
  previewState?: "ready_derivative" | "transform_fallback" | "processing" | "unavailable";
  linkedConsentCount?: number;
  linkedPeople?: Array<{
    consentId: string;
    fullName: string | null;
    email: string | null;
  }>;
  linkedFaceOverlays?: Array<{
    assetFaceId: string;
    projectFaceAssigneeId: string;
    identityKind: "project_consent" | "project_recurring_consent";
    consentId: string | null;
    projectProfileParticipantId: string | null;
    fullName: string | null;
    email: string | null;
    headshotThumbnailUrl: string | null;
    faceRank: number;
    faceBoxNormalized: Record<string, number | null> | null;
    linkSource: "manual" | "auto";
    matchConfidence: number | null;
  }>;
};

type AssetsResponse = {
  assets?: AssetRow[];
  totalCount?: number;
  people?: Array<{
    consentId: string;
    fullName: string | null;
    email: string | null;
    label: string;
  }>;
  message?: string;
};

type AssetSortOption = "created_at_desc" | "created_at_asc" | "file_size_desc" | "file_size_asc";

type AssetsListProps = {
  projectId: string;
};

type AssetPageCacheEntry = {
  assets: AssetRow[];
  fetchedAt: number;
};

type AssetPageCache = Record<number, AssetPageCacheEntry>;

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
const ASSET_PAGE_CACHE_TTL_MS = 90_000;

export function getAssetPageOffset(globalIndex: number, limit: number) {
  if (limit <= 0 || globalIndex <= 0) {
    return 0;
  }

  return Math.floor(globalIndex / limit) * limit;
}

export function isAssetPageCacheFresh(fetchedAt: number, now = Date.now()) {
  return now - fetchedAt < ASSET_PAGE_CACHE_TTL_MS;
}

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

function buildPageSummary(
  offset: number,
  limit: number,
  totalCount: number,
  t: ReturnType<typeof useTranslations>,
) {
  if (totalCount === 0) {
    return t("showingZero");
  }

  const start = offset + 1;
  const end = Math.min(offset + limit, totalCount);
  return t("showingRange", { start, end, total: totalCount });
}

function buildConsentHref(projectId: string, consentId: string) {
  const params = new URLSearchParams({ openConsentId: consentId });
  return `/projects/${projectId}?${params.toString()}#consent-${consentId}`;
}

function buildOverlayHref(
  projectId: string,
  overlay: NonNullable<AssetRow["linkedFaceOverlays"]>[number],
) {
  return overlay.consentId ? buildConsentHref(projectId, overlay.consentId) : `/projects/${projectId}`;
}

function getOverlayLabel(overlay: NonNullable<AssetRow["linkedFaceOverlays"]>[number]) {
  if (overlay.fullName || overlay.email) {
    return overlay.fullName || overlay.email || "";
  }

  if (overlay.consentId) {
    return `Consent ${overlay.consentId}`;
  }

  if (overlay.projectProfileParticipantId) {
    return `Recurring participant ${overlay.projectProfileParticipantId}`;
  }

  return "Recurring participant";
}

function getOverlayLinkSourceLabel(
  linkSource: NonNullable<AssetRow["linkedFaceOverlays"]>[number]["linkSource"],
  t: ReturnType<typeof useTranslations>,
) {
  return linkSource === "manual" ? t("previewLinkSourceManual") : t("previewLinkSourceAuto");
}

function buildAssetPreviewFaceOverlays(
  projectId: string,
  asset: AssetRow,
  t: ReturnType<typeof useTranslations>,
) {
  return (asset.linkedFaceOverlays ?? []).map((overlay) => ({
    id: `${overlay.assetFaceId}:${overlay.projectFaceAssigneeId}`,
    href: buildOverlayHref(projectId, overlay),
    label: getOverlayLabel(overlay),
    faceBoxNormalized: overlay.faceBoxNormalized,
    headshotThumbnailUrl: overlay.headshotThumbnailUrl,
    matchConfidence: overlay.matchConfidence,
    linkSource: overlay.linkSource,
    linkSourceLabel: getOverlayLinkSourceLabel(overlay.linkSource, t),
  }));
}

function buildAssetPreviewMetadata(
  asset: AssetRow,
  locale: string,
  t: ReturnType<typeof useTranslations>,
) {
  const parts: string[] = [];

  if (Number.isFinite(asset.originalWidth) && Number.isFinite(asset.originalHeight)) {
    const originalWidth = asset.originalWidth as number;
    const originalHeight = asset.originalHeight as number;
    parts.push(
      t("previewOriginalSize", {
        width: originalWidth,
        height: originalHeight,
      }),
    );
  }

  const addedAt = asset.uploadedAt ?? asset.createdAt;
  if (addedAt) {
    parts.push(
      t("previewAddedDate", {
        date: formatDate(addedAt, locale),
      }),
    );
  }

  return parts.join(" · ");
}

export function AssetsList({ projectId }: AssetsListProps) {
  const locale = useLocale();
  const t = useTranslations("projects.assetsList");
  const tErrors = useTranslations("errors");
  const [queryInput, setQueryInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sort, setSort] = useState<AssetSortOption>("created_at_desc");
  const [limit, setLimit] = useState<number>(20);
  const [offset, setOffset] = useState<number>(0);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [assetPages, setAssetPages] = useState<AssetPageCache>({});
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedConsentIds, setSelectedConsentIds] = useState<string[]>([]);
  const [selectedAssetGlobalIndex, setSelectedAssetGlobalIndex] = useState<number | null>(null);
  const [people, setPeople] = useState<AssetsResponse["people"]>([]);

  const selectedConsentFilterKey = useMemo(
    () => [...selectedConsentIds].sort((a, b) => a.localeCompare(b)).join(","),
    [selectedConsentIds],
  );

  const queryCacheKey = useMemo(
    () => `${searchQuery}::${selectedConsentFilterKey}::${sort}::${limit}`,
    [limit, searchQuery, selectedConsentFilterKey, sort],
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setOffset(0);
      setSearchQuery(queryInput.trim());
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [queryInput]);

  useEffect(() => {
    setAssetPages({});
    setAssets([]);
    setTotalCount(0);
    setError(null);
    setSelectedAssetGlobalIndex(null);
  }, [queryCacheKey]);

  const fetchAssetsPage = useCallback(
    async (pageOffset: number, signal?: AbortSignal) => {
      const params = new URLSearchParams();
      if (searchQuery.length > 0) {
        params.set("q", searchQuery);
      }
      selectedConsentIds.forEach((consentId) => params.append("consentId", consentId));
      params.set("sort", sort);
      params.set("limit", String(limit));
      params.set("offset", String(pageOffset));

      const response = await fetch(`/api/projects/${projectId}/assets?${params.toString()}`, {
        method: "GET",
        signal,
      });
      const payload = (await response.json().catch(() => null)) as AssetsResponse | null;

      if (!response.ok || !payload) {
        throw new Error(resolveLocalizedApiError(tErrors, payload, "generic"));
      }

      return payload;
    },
    [limit, projectId, searchQuery, selectedConsentIds, sort, tErrors],
  );

  const ensurePageLoaded = useCallback(
    async (pageOffset: number, signal?: AbortSignal, options?: { forceRefresh?: boolean }) => {
      const cachedEntry = assetPages[pageOffset];
      if (cachedEntry && !options?.forceRefresh && isAssetPageCacheFresh(cachedEntry.fetchedAt)) {
        return cachedEntry.assets;
      }

      const payload = await fetchAssetsPage(pageOffset, signal);
      const pageAssets = payload.assets ?? [];
      setAssetPages((current) => {
        const currentEntry = current[pageOffset];
        if (currentEntry && !options?.forceRefresh && isAssetPageCacheFresh(currentEntry.fetchedAt)) {
          return current;
        }

        return {
          ...current,
          [pageOffset]: {
            assets: pageAssets,
            fetchedAt: Date.now(),
          },
        };
      });
      setTotalCount(payload.totalCount ?? 0);
      setPeople(payload.people ?? []);
      return pageAssets;
    },
    [assetPages, fetchAssetsPage],
  );

  useEffect(() => {
    const controller = new AbortController();
    const cachedPage = assetPages[offset];

    if (cachedPage && isAssetPageCacheFresh(cachedPage.fetchedAt)) {
      setAssets(cachedPage.assets);
      setIsLoading(false);
      return () => controller.abort();
    }

    async function loadAssets() {
      setIsLoading(true);
      setError(null);
      try {
        const pageAssets = await ensurePageLoaded(offset, controller.signal, {
          forceRefresh: Boolean(cachedPage),
        });
        setAssets(pageAssets);
      } catch (loadError) {
        if ((loadError as { name?: string })?.name === "AbortError") {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : tErrors("generic"));
        setAssets([]);
        setTotalCount(0);
      } finally {
        setIsLoading(false);
      }
    }

    void loadAssets();

    return () => controller.abort();
  }, [assetPages, ensurePageLoaded, offset, tErrors]);

  const sortOptions: Array<{ value: AssetSortOption; label: string }> = [
    { value: "created_at_desc", label: t("sortNewest") },
    { value: "created_at_asc", label: t("sortOldest") },
    { value: "file_size_desc", label: t("sortLargest") },
    { value: "file_size_asc", label: t("sortSmallest") },
  ];

  const sortedAssets = useMemo(() => {
    if (assets.length <= 1) {
      return assets;
    }

    const copy = [...assets];
    switch (sort) {
      case "created_at_asc":
        return copy.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
      case "file_size_desc":
        return copy.sort((a, b) => b.fileSizeBytes - a.fileSizeBytes);
      case "file_size_asc":
        return copy.sort((a, b) => a.fileSizeBytes - b.fileSizeBytes);
      case "created_at_desc":
      default:
        return copy.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    }
  }, [assets, sort]);

  const pageCount = useMemo(() => Math.max(1, Math.ceil(totalCount / limit)), [limit, totalCount]);
  const currentPage = useMemo(() => Math.floor(offset / limit) + 1, [limit, offset]);

  const selectedAssetPageOffset =
    selectedAssetGlobalIndex === null ? null : getAssetPageOffset(selectedAssetGlobalIndex, limit);
  const selectedAssetPage =
    selectedAssetPageOffset === null ? null : assetPages[selectedAssetPageOffset]?.assets ?? null;
  const selectedAssetPageIndex =
    selectedAssetGlobalIndex === null ? -1 : selectedAssetGlobalIndex - getAssetPageOffset(selectedAssetGlobalIndex, limit);
  const selectedAsset =
    selectedAssetPage && selectedAssetPageIndex >= 0 && selectedAssetPageIndex < selectedAssetPage.length
      ? selectedAssetPage[selectedAssetPageIndex]
      : null;
  const previousAssetGlobalIndex =
    selectedAssetGlobalIndex !== null && selectedAssetGlobalIndex > 0 ? selectedAssetGlobalIndex - 1 : null;
  const nextAssetGlobalIndex =
    selectedAssetGlobalIndex !== null && selectedAssetGlobalIndex < totalCount - 1 ? selectedAssetGlobalIndex + 1 : null;
  const previousAssetPageOffset =
    previousAssetGlobalIndex === null ? null : getAssetPageOffset(previousAssetGlobalIndex, limit);
  const nextAssetPageOffset =
    nextAssetGlobalIndex === null ? null : getAssetPageOffset(nextAssetGlobalIndex, limit);
  const previousAsset =
    previousAssetGlobalIndex !== null && previousAssetPageOffset !== null
      ? assetPages[previousAssetPageOffset]?.assets?.[previousAssetGlobalIndex - previousAssetPageOffset] ?? null
      : null;
  const nextAsset =
    nextAssetGlobalIndex !== null && nextAssetPageOffset !== null
      ? assetPages[nextAssetPageOffset]?.assets?.[nextAssetGlobalIndex - nextAssetPageOffset] ?? null
      : null;

  const navigateToAssetIndex = useCallback(
    async (nextIndex: number) => {
      if (nextIndex < 0 || nextIndex >= totalCount) {
        return;
      }

      const nextOffset = getAssetPageOffset(nextIndex, limit);
      setError(null);

      const cachedEntry = assetPages[nextOffset];
      if (!cachedEntry || !isAssetPageCacheFresh(cachedEntry.fetchedAt)) {
        try {
          await ensurePageLoaded(nextOffset, undefined, {
            forceRefresh: Boolean(cachedEntry),
          });
        } catch (loadError) {
          setError(loadError instanceof Error ? loadError.message : tErrors("generic"));
          return;
        }
      }

      setOffset(nextOffset);
      setSelectedAssetGlobalIndex(nextIndex);
    },
    [assetPages, ensurePageLoaded, limit, tErrors, totalCount],
  );

  const refreshSelectedAssetData = useCallback(async () => {
    if (selectedAssetGlobalIndex === null) {
      return;
    }

    const selectedPageOffset = getAssetPageOffset(selectedAssetGlobalIndex, limit);
    const refreshedAssets = await ensurePageLoaded(selectedPageOffset, undefined, {
      forceRefresh: true,
    });

    if (offset === selectedPageOffset) {
      setAssets(refreshedAssets);
    }
  }, [ensurePageLoaded, limit, offset, selectedAssetGlobalIndex]);

  useEffect(() => {
    if (selectedAssetGlobalIndex === null) {
      return;
    }

    const controller = new AbortController();
    const candidateOffsets = [previousAssetPageOffset, nextAssetPageOffset].filter(
      (value): value is number => value !== null,
    );

    candidateOffsets.forEach((candidateOffset) => {
      const cachedEntry = assetPages[candidateOffset];
      if (cachedEntry && isAssetPageCacheFresh(cachedEntry.fetchedAt)) {
        return;
      }

      void ensurePageLoaded(candidateOffset, controller.signal, {
        forceRefresh: Boolean(cachedEntry),
      }).catch(() => {});
    });

    return () => controller.abort();
  }, [assetPages, ensurePageLoaded, nextAssetPageOffset, previousAssetPageOffset, selectedAssetGlobalIndex]);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-zinc-200 bg-white p-4">
        <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_220px_160px]">
          <input
            type="text"
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
            placeholder={t("searchPlaceholder")}
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900"
          />
          <select
            value={sort}
            onChange={(event) => {
              setOffset(0);
              setSort(event.target.value as AssetSortOption);
            }}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900"
          >
            {sortOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <select
            value={limit}
            onChange={(event) => {
              setOffset(0);
              setLimit(Number(event.target.value));
            }}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900"
          >
            {PAGE_SIZE_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {t("showCount", { count: option })}
              </option>
            ))}
          </select>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-600">
          <span>{t("photoCount", { count: totalCount })}</span>
          <span>{buildPageSummary(offset, limit, totalCount, t)}</span>
        </div>
      </div>

      {people && people.length > 0 ? (
        <details className="rounded-xl border border-zinc-200 bg-white p-3">
          <summary className="cursor-pointer text-sm font-medium text-zinc-900">{t("filterByPeople")}</summary>
          <div className="mt-2 space-y-2">
            <p className="text-xs text-zinc-600">{t("filterHelp")}</p>
            <div className="max-h-40 space-y-1 overflow-auto">
              {people.map((person) => (
                <label key={person.consentId} className="flex items-center gap-2 text-xs text-zinc-700">
                  <input
                    type="checkbox"
                    checked={selectedConsentIds.includes(person.consentId)}
                    onChange={(event) => {
                      setOffset(0);
                      setSelectedConsentIds((current) => {
                        if (event.target.checked) {
                          return current.includes(person.consentId) ? current : [...current, person.consentId];
                        }
                        return current.filter((consentId) => consentId !== person.consentId);
                      });
                    }}
                  />
                  <span>{person.label}</span>
                </label>
              ))}
            </div>
            {selectedConsentIds.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  setOffset(0);
                  setSelectedConsentIds([]);
                }}
                className="rounded-lg border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              >
                {t("clearFilter")}
              </button>
            ) : null}
          </div>
        </details>
      ) : null}

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {isLoading ? (
        <p className="text-sm text-zinc-600">{t("loading")}</p>
      ) : sortedAssets.length === 0 ? (
        <p className="text-sm text-zinc-600">{t("empty")}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3 lg:grid-cols-4">
          {sortedAssets.map((asset, assetIndex) => (
            <li key={asset.id} className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
              <div className="mb-2 aspect-square w-full overflow-hidden rounded bg-zinc-100">
                <PreviewableImage
                  src={asset.thumbnailUrl ?? null}
                  previewSrc={asset.previewUrl ?? null}
                  alt={asset.originalFilename}
                  className="h-full w-full"
                  imageClassName="h-full w-full object-contain"
                  emptyState={asset.thumbnailState === "processing" ? "processing" : "unavailable"}
                  emptyLabel={
                    asset.thumbnailState === "processing" ? t("processingDisplay") : t("unavailableDisplay")
                  }
                    previewFaceOverlays={buildAssetPreviewFaceOverlays(projectId, asset, t)}
                  onOpenPreview={() => {
                    void navigateToAssetIndex(offset + assetIndex);
                  }}
                />
              </div>
              <p className="truncate text-sm font-medium text-zinc-900" title={asset.originalFilename}>
                {asset.originalFilename}
              </p>
              <p className="mt-1 text-xs text-zinc-600">{formatBytes(asset.fileSizeBytes)}</p>
              <p className="mt-1 text-xs text-zinc-600">{t("addedOn", { date: formatDate(asset.createdAt, locale) })}</p>
              <p className="mt-1 text-xs text-zinc-600">
                {t("linkedConsents", { count: asset.linkedConsentCount ?? 0 })}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-white p-3 text-sm">
        <span className="text-xs text-zinc-600">{buildPageSummary(offset, limit, totalCount, t)}</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={isLoading || offset === 0}
            onClick={() => setOffset((current) => Math.max(0, current - limit))}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
          >
            {t("previous")}
          </button>
          <span className="text-xs text-zinc-600">{t("pageOf", { page: currentPage, total: pageCount })}</span>
          <button
            type="button"
            disabled={isLoading || offset + limit >= totalCount}
            onClick={() => setOffset((current) => current + limit)}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
          >
            {t("next")}
          </button>
        </div>
      </div>

      {selectedAsset ? (
        <ProjectAssetPreviewLightbox
          key={`${selectedAsset.id}:${selectedAssetGlobalIndex}`}
          projectId={projectId}
          asset={{
            id: selectedAsset.id,
            originalFilename: selectedAsset.originalFilename,
            previewUrl: selectedAsset.previewUrl ?? selectedAsset.thumbnailUrl ?? null,
            thumbnailUrl: selectedAsset.thumbnailUrl ?? null,
            previewState: selectedAsset.previewState,
            initialPreviewFaceOverlays: buildAssetPreviewFaceOverlays(projectId, selectedAsset, t),
          }}
          open
          onClose={() => setSelectedAssetGlobalIndex(null)}
          onPrevious={
            selectedAssetGlobalIndex !== null && selectedAssetGlobalIndex > 0
              ? () => {
                  void navigateToAssetIndex(selectedAssetGlobalIndex - 1);
                }
              : null
          }
          onNext={
            selectedAssetGlobalIndex !== null && selectedAssetGlobalIndex < totalCount - 1
              ? () => {
                  void navigateToAssetIndex(selectedAssetGlobalIndex + 1);
                }
              : null
          }
          canPrevious={selectedAssetGlobalIndex !== null && selectedAssetGlobalIndex > 0}
          canNext={selectedAssetGlobalIndex !== null && selectedAssetGlobalIndex < totalCount - 1}
          previousLabel={t("previewPrevious")}
          nextLabel={t("previewNext")}
          closeLabel={t("previewClose")}
          zoomInLabel={t("previewZoomIn")}
          zoomOutLabel={t("previewZoomOut")}
          zoomResetLabel={t("previewZoomReset")}
          zoomInputLabel={t("previewZoomInputLabel")}
          zoomInputHint={t("previewZoomInputHint")}
          onRefreshAssetData={refreshSelectedAssetData}
          metadataLabel={buildAssetPreviewMetadata(selectedAsset, locale, t) || null}
          counterLabel={
            selectedAssetGlobalIndex !== null
              ? t("previewCounter", { current: selectedAssetGlobalIndex + 1, total: totalCount })
              : null
          }
          preloadSrcs={[
            previousAsset?.previewUrl ?? previousAsset?.thumbnailUrl ?? "",
            nextAsset?.previewUrl ?? nextAsset?.thumbnailUrl ?? "",
          ]}
        />
      ) : null}
    </div>
  );
}
