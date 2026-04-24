"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { PreviewableImage } from "@/components/projects/previewable-image";
import { ProjectAssetPreviewLightbox } from "@/components/projects/project-asset-preview-lightbox";
import { resolveLocalizedApiError } from "@/lib/i18n/error-message";
import { formatDate } from "@/lib/i18n/format";

type AssetRow = {
  id: string;
  assetType: "photo" | "video";
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
  playbackUrl?: string | null;
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
  reviewStatus?: "pending" | "needs_review" | "blocked" | "resolved" | null;
  unresolvedFaceCount?: number;
  blockedFaceCount?: number;
  firstNeedsReviewFaceId?: string | null;
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
  scopeFilters?: ScopeFilterOption[];
  reviewSummary?: {
    totalAssetCount: number;
    needsReviewAssetCount: number;
    pendingAssetCount: number;
    blockedAssetCount: number;
    resolvedAssetCount: number;
  };
  message?: string;
};

type AssetSortOption =
  | "created_at_desc"
  | "created_at_asc"
  | "file_size_desc"
  | "file_size_asc"
  | "needs_review_first";

type AssetReviewFilter = "all" | "needs_review" | "blocked" | "resolved";

type AssetScopeFilterStatus = "granted" | "not_granted" | "revoked" | "not_collected";

type ScopeFilterOption = {
  templateKey: string;
  templateLabel: string;
  scopes: Array<{
    scopeKey: string;
    label: string;
    orderIndex: number;
  }>;
};

type AssetsListProps = {
  projectId: string;
  workspaceId: string;
};

type AssetPageCacheEntry = {
  assets: AssetRow[];
  scopeFilters: ScopeFilterOption[];
  reviewSummary: NonNullable<AssetsResponse["reviewSummary"]>;
  fetchedAt: number;
};

type AssetPageCache = Record<number, AssetPageCacheEntry>;

type LoadedAssetPagePayload = {
  assets: AssetRow[];
  totalCount: number;
  people: NonNullable<AssetsResponse["people"]>;
  scopeFilters: ScopeFilterOption[];
  reviewSummary: NonNullable<AssetsResponse["reviewSummary"]>;
};

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
const ASSET_PAGE_CACHE_TTL_MS = 90_000;
const EMPTY_REVIEW_SUMMARY = {
  totalAssetCount: 0,
  needsReviewAssetCount: 0,
  pendingAssetCount: 0,
  blockedAssetCount: 0,
  resolvedAssetCount: 0,
} as const;

export function getAssetPageOffset(globalIndex: number, limit: number) {
  if (limit <= 0 || globalIndex <= 0) {
    return 0;
  }

  return Math.floor(globalIndex / limit) * limit;
}

export function isAssetPageCacheFresh(fetchedAt: number, now = Date.now()) {
  return now - fetchedAt < ASSET_PAGE_CACHE_TTL_MS;
}

export function getInitialSelectedFaceIdForReview(
  reviewFilter: AssetReviewFilter,
  asset: Pick<AssetRow, "firstNeedsReviewFaceId">,
) {
  return reviewFilter === "needs_review" ? asset.firstNeedsReviewFaceId ?? null : null;
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

function getReviewStatusClasses(status: NonNullable<AssetRow["reviewStatus"]>) {
  switch (status) {
    case "pending":
      return "border-slate-300 bg-slate-100 text-slate-700";
    case "needs_review":
      return "border-rose-200 bg-rose-50 text-rose-800";
    case "blocked":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "resolved":
    default:
      return "border-zinc-300 bg-zinc-100 text-zinc-700";
  }
}

export function isPreviewableAssetType(assetType: AssetRow["assetType"]) {
  return assetType === "photo" || assetType === "video";
}

function isPreviewableAsset(asset: Pick<AssetRow, "assetType">) {
  return isPreviewableAssetType(asset.assetType);
}

function isImageAsset(asset: Pick<AssetRow, "assetType">) {
  return asset.assetType === "photo";
}

export function VideoAssetPlaceholder({
  label,
}: {
  label: string;
}) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-zinc-100 text-zinc-600">
      <div className="flex flex-col items-center gap-2">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-8 w-8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3.5" y="5.5" width="13" height="13" rx="2" />
          <path d="m16.5 10 4-2.5v9L16.5 14" />
        </svg>
        <span className="text-xs font-medium">{label}</span>
      </div>
    </div>
  );
}

export function PreviewableVideoPoster({
  src,
  alt,
  emptyLabel,
  onOpenPreview,
  openLabel,
}: {
  src: string | null;
  alt: string;
  emptyLabel: string;
  onOpenPreview: () => void;
  openLabel: string;
}) {
  const [failedImageSrc, setFailedImageSrc] = useState<string | null>(null);

  if (!src || failedImageSrc === src) {
    return (
      <button
        type="button"
        onClick={onOpenPreview}
        className="block h-full w-full cursor-pointer"
        aria-label={openLabel}
      >
        <VideoAssetPlaceholder label={emptyLabel} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onOpenPreview}
      className="group relative block h-full w-full cursor-pointer overflow-hidden bg-zinc-100"
      aria-label={openLabel}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        className="h-full w-full object-contain"
        onError={() => setFailedImageSrc(src)}
      />
      <span className="pointer-events-none absolute inset-0 bg-zinc-950/0 transition-colors group-hover:bg-zinc-950/15" />
      <span className="pointer-events-none absolute right-2 top-2 inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/90 text-zinc-900 shadow-sm">
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="h-4 w-4"
          fill="currentColor"
        >
          <path d="M8 6.5v11l9-5.5Z" />
        </svg>
      </span>
    </button>
  );
}

function buildConsentHref(projectId: string, workspaceId: string, consentId: string) {
  const params = new URLSearchParams({
    workspaceId,
    openConsentId: consentId,
  });
  return `/projects/${projectId}?${params.toString()}#consent-${consentId}`;
}

function buildOverlayHref(
  projectId: string,
  workspaceId: string,
  overlay: NonNullable<AssetRow["linkedFaceOverlays"]>[number],
) {
  return overlay.consentId
    ? buildConsentHref(projectId, workspaceId, overlay.consentId)
    : `/projects/${projectId}?${new URLSearchParams({ workspaceId }).toString()}`;
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
  workspaceId: string,
  asset: AssetRow,
  t: ReturnType<typeof useTranslations>,
) {
  return (asset.linkedFaceOverlays ?? []).map((overlay) => ({
    id: `${overlay.assetFaceId}:${overlay.projectFaceAssigneeId}`,
    href: buildOverlayHref(projectId, workspaceId, overlay),
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

export function AssetsList({ projectId, workspaceId }: AssetsListProps) {
  const locale = useLocale();
  const t = useTranslations("projects.assetsList");
  const tErrors = useTranslations("errors");
  const [queryInput, setQueryInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sort, setSort] = useState<AssetSortOption>("created_at_desc");
  const [reviewFilter, setReviewFilter] = useState<AssetReviewFilter>("all");
  const [limit, setLimit] = useState<number>(20);
  const [offset, setOffset] = useState<number>(0);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [assetPages, setAssetPages] = useState<AssetPageCache>({});
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedConsentIds, setSelectedConsentIds] = useState<string[]>([]);
  const [scopeFilters, setScopeFilters] = useState<ScopeFilterOption[]>([]);
  const [selectedScopeTemplateKey, setSelectedScopeTemplateKey] = useState("");
  const [selectedScopeKey, setSelectedScopeKey] = useState("");
  const [selectedScopeStatus, setSelectedScopeStatus] = useState<AssetScopeFilterStatus>("granted");
  const [selectedAssetGlobalIndex, setSelectedAssetGlobalIndex] = useState<number | null>(null);
  const [people, setPeople] = useState<AssetsResponse["people"]>([]);
  const [reviewSummary, setReviewSummary] = useState<NonNullable<AssetsResponse["reviewSummary"]>>(EMPTY_REVIEW_SUMMARY);
  const [pendingListRefreshOnClose, setPendingListRefreshOnClose] = useState(false);

  const selectedConsentFilterKey = useMemo(
    () => [...selectedConsentIds].sort((a, b) => a.localeCompare(b)).join(","),
    [selectedConsentIds],
  );
  const selectedScopeFilterKey = useMemo(
    () =>
      selectedScopeTemplateKey && selectedScopeKey
        ? `${selectedScopeTemplateKey}:${selectedScopeKey}:${selectedScopeStatus}`
        : "",
    [selectedScopeKey, selectedScopeStatus, selectedScopeTemplateKey],
  );

  const queryCacheKey = useMemo(
    () => `${searchQuery}::${selectedConsentFilterKey}::${selectedScopeFilterKey}::${reviewFilter}::${sort}::${limit}`,
    [limit, reviewFilter, searchQuery, selectedConsentFilterKey, selectedScopeFilterKey, sort],
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
    setReviewSummary(EMPTY_REVIEW_SUMMARY);
    setPendingListRefreshOnClose(false);
  }, [queryCacheKey]);

  const selectedScopeFamily = useMemo(
    () => scopeFilters.find((family) => family.templateKey === selectedScopeTemplateKey) ?? null,
    [scopeFilters, selectedScopeTemplateKey],
  );

  useEffect(() => {
    if (!selectedScopeTemplateKey) {
      if (selectedScopeKey) {
        setSelectedScopeKey("");
      }
      return;
    }

    if (!selectedScopeFamily) {
      setSelectedScopeTemplateKey("");
      setSelectedScopeKey("");
      return;
    }

    if (!selectedScopeKey) {
      return;
    }

    if (!selectedScopeFamily.scopes.some((scope) => scope.scopeKey === selectedScopeKey)) {
      setSelectedScopeKey("");
    }
  }, [selectedScopeFamily, selectedScopeKey, selectedScopeTemplateKey]);

  const fetchAssetsPage = useCallback(
    async (pageOffset: number, signal?: AbortSignal) => {
      const params = new URLSearchParams();
      if (searchQuery.length > 0) {
        params.set("q", searchQuery);
      }
      params.set("workspaceId", workspaceId);
      selectedConsentIds.forEach((consentId) => params.append("consentId", consentId));
      if (selectedScopeTemplateKey && selectedScopeKey) {
        params.set("scopeTemplateKey", selectedScopeTemplateKey);
        params.set("scopeKey", selectedScopeKey);
        params.set("scopeStatus", selectedScopeStatus);
      }
      params.set("review", reviewFilter);
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
    [
      limit,
      projectId,
      reviewFilter,
      searchQuery,
      selectedConsentIds,
      selectedScopeKey,
      selectedScopeStatus,
      selectedScopeTemplateKey,
      sort,
      tErrors,
      workspaceId,
    ],
  );

  const ensurePageLoaded = useCallback(
    async (
      pageOffset: number,
      signal?: AbortSignal,
      options?: { forceRefresh?: boolean },
    ): Promise<LoadedAssetPagePayload> => {
      const cachedEntry = assetPages[pageOffset];
      if (cachedEntry && !options?.forceRefresh && isAssetPageCacheFresh(cachedEntry.fetchedAt)) {
        return {
          assets: cachedEntry.assets,
          totalCount,
          people: (people ?? []) as NonNullable<AssetsResponse["people"]>,
          scopeFilters: cachedEntry.scopeFilters,
          reviewSummary: cachedEntry.reviewSummary,
        };
      }

      const payload = await fetchAssetsPage(pageOffset, signal);
      const pageAssets = payload.assets ?? [];
      const nextReviewSummary = payload.reviewSummary ?? EMPTY_REVIEW_SUMMARY;
      setAssetPages((current) => {
        const currentEntry = current[pageOffset];
        if (currentEntry && !options?.forceRefresh && isAssetPageCacheFresh(currentEntry.fetchedAt)) {
          return current;
        }

        return {
          ...current,
          [pageOffset]: {
            assets: pageAssets,
            scopeFilters: payload.scopeFilters ?? [],
            reviewSummary: nextReviewSummary,
            fetchedAt: Date.now(),
          },
        };
      });
      setTotalCount(payload.totalCount ?? 0);
      setPeople(payload.people ?? []);
      setScopeFilters(payload.scopeFilters ?? []);
      setReviewSummary(nextReviewSummary);
      return {
        assets: pageAssets,
        totalCount: payload.totalCount ?? 0,
        people: (payload.people ?? []) as NonNullable<AssetsResponse["people"]>,
        scopeFilters: payload.scopeFilters ?? [],
        reviewSummary: nextReviewSummary,
      };
    },
    [assetPages, fetchAssetsPage, people, totalCount],
  );

  useEffect(() => {
    const controller = new AbortController();
    const cachedPage = assetPages[offset];

    if (cachedPage && isAssetPageCacheFresh(cachedPage.fetchedAt)) {
      setAssets(cachedPage.assets);
      setScopeFilters(cachedPage.scopeFilters);
      setReviewSummary(cachedPage.reviewSummary);
      setIsLoading(false);
      return () => controller.abort();
    }

    async function loadAssets() {
      setIsLoading(true);
      setError(null);
      try {
        const payload = await ensurePageLoaded(offset, controller.signal, {
          forceRefresh: Boolean(cachedPage),
        });
        if (payload.totalCount === 0 && offset > 0) {
          setOffset(0);
          return;
        }

        if (payload.totalCount > 0 && offset >= payload.totalCount) {
          setOffset(getAssetPageOffset(payload.totalCount - 1, limit));
          return;
        }

        setAssets(payload.assets);
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
  }, [assetPages, ensurePageLoaded, limit, offset, tErrors]);

  const sortOptions: Array<{ value: AssetSortOption; label: string }> = [
    { value: "needs_review_first", label: t("sortNeedsReviewFirst") },
    { value: "created_at_desc", label: t("sortNewest") },
    { value: "created_at_asc", label: t("sortOldest") },
    { value: "file_size_desc", label: t("sortLargest") },
    { value: "file_size_asc", label: t("sortSmallest") },
  ];

  const reviewFilters: Array<{
    value: AssetReviewFilter;
    label: string;
    count: number;
  }> = [
    { value: "all", label: t("reviewFilterAll"), count: reviewSummary.totalAssetCount },
    { value: "needs_review", label: t("reviewFilterNeedsReview"), count: reviewSummary.needsReviewAssetCount },
    { value: "blocked", label: t("reviewFilterBlocked"), count: reviewSummary.blockedAssetCount },
    { value: "resolved", label: t("reviewFilterResolved"), count: reviewSummary.resolvedAssetCount },
  ];

  const reviewSummaryItems = [
    { label: t("reviewSummaryAll"), count: reviewSummary.totalAssetCount },
    { label: t("reviewSummaryNeedsReview"), count: reviewSummary.needsReviewAssetCount },
    { label: t("reviewSummaryPending"), count: reviewSummary.pendingAssetCount },
    { label: t("reviewSummaryBlocked"), count: reviewSummary.blockedAssetCount },
    { label: t("reviewSummaryResolved"), count: reviewSummary.resolvedAssetCount },
  ];
  const scopeStatusOptions: Array<{ value: AssetScopeFilterStatus; label: string }> = [
    { value: "granted", label: t("previewScopeStatusGranted") },
    { value: "not_granted", label: t("previewScopeStatusNotGranted") },
    { value: "revoked", label: t("previewScopeStatusRevoked") },
    { value: "not_collected", label: t("previewScopeStatusNotCollected") },
  ];

  const emptyStateLabel = useMemo(() => {
    switch (reviewFilter) {
      case "needs_review":
        return t("emptyNeedsReview");
      case "blocked":
        return t("emptyBlocked");
      case "resolved":
        return t("emptyResolved");
      case "all":
      default:
        return t("empty");
    }
  }, [reviewFilter, t]);

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

    setPendingListRefreshOnClose(true);
  }, [selectedAssetGlobalIndex]);

  const navigateToAdjacentAsset = useCallback(
    async (direction: -1 | 1) => {
      if (selectedAssetGlobalIndex === null) {
        return;
      }

      await navigateToAssetIndex(selectedAssetGlobalIndex + direction);
    },
    [navigateToAssetIndex, selectedAssetGlobalIndex],
  );

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

  const handleLightboxClose = useCallback(() => {
    setSelectedAssetGlobalIndex(null);

    if (!pendingListRefreshOnClose) {
      return;
    }

    setPendingListRefreshOnClose(false);
    setAssetPages({});
  }, [pendingListRefreshOnClose]);

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
          <span>{t("assetCount", { count: totalCount })}</span>
          <span>{buildPageSummary(offset, limit, totalCount, t)}</span>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {reviewFilters.map((filter) => {
            const isActive = reviewFilter === filter.value;
            return (
              <button
                key={filter.value}
                type="button"
                onClick={() => {
                  setOffset(0);
                  setReviewFilter(filter.value);
                }}
                className={
                  isActive
                    ? "rounded-md border border-zinc-900 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white"
                    : "rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
                }
              >
                {filter.label} ({filter.count})
              </button>
            );
          })}
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
          {reviewSummaryItems.map((item) => (
            <div key={item.label} className="rounded-lg border border-zinc-200 px-3 py-2">
              <p className="text-xs text-zinc-600">{item.label}</p>
              <p className="mt-1 text-base font-semibold text-zinc-900">{item.count}</p>
            </div>
          ))}
        </div>
      </div>

      {scopeFilters.length > 0 ? (
        <details className="rounded-xl border border-zinc-200 bg-white p-3">
          <summary className="cursor-pointer text-sm font-medium text-zinc-900">{t("filterByScope")}</summary>
          <div className="mt-3 grid gap-3 lg:grid-cols-3">
            <label className="space-y-1 text-xs text-zinc-600">
              <span>{t("filterScopeFamilyLabel")}</span>
              <select
                value={selectedScopeTemplateKey}
                onChange={(event) => {
                  setOffset(0);
                  setSelectedScopeTemplateKey(event.target.value);
                  setSelectedScopeKey("");
                  setSelectedScopeStatus("granted");
                }}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900"
              >
                <option value="">{t("filterScopeFamilyPlaceholder")}</option>
                {scopeFilters.map((family) => (
                  <option key={family.templateKey} value={family.templateKey}>
                    {family.templateLabel}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs text-zinc-600">
              <span>{t("filterScopeLabel")}</span>
              <select
                value={selectedScopeKey}
                disabled={!selectedScopeFamily}
                onChange={(event) => {
                  setOffset(0);
                  setSelectedScopeKey(event.target.value);
                }}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 disabled:opacity-60"
              >
                <option value="">{t("filterScopePlaceholder")}</option>
                {(selectedScopeFamily?.scopes ?? []).map((scope) => (
                  <option key={scope.scopeKey} value={scope.scopeKey}>
                    {scope.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-xs text-zinc-600">
              <span>{t("filterScopeStatusLabel")}</span>
              <select
                value={selectedScopeStatus}
                disabled={!selectedScopeKey}
                onChange={(event) => {
                  setOffset(0);
                  setSelectedScopeStatus(event.target.value as AssetScopeFilterStatus);
                }}
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 disabled:opacity-60"
              >
                {scopeStatusOptions.map((status) => (
                  <option key={status.value} value={status.value}>
                    {status.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-xs text-zinc-600">{t("filterScopeHelp")}</p>
            {selectedScopeTemplateKey || selectedScopeKey ? (
              <button
                type="button"
                onClick={() => {
                  setOffset(0);
                  setSelectedScopeTemplateKey("");
                  setSelectedScopeKey("");
                  setSelectedScopeStatus("granted");
                }}
                className="rounded-lg border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              >
                {t("clearFilter")}
              </button>
            ) : null}
          </div>
        </details>
      ) : null}

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
      ) : assets.length === 0 ? (
        <p className="text-sm text-zinc-600">{emptyStateLabel}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 text-sm md:grid-cols-3 lg:grid-cols-4">
          {assets.map((asset, assetIndex) => (
            <li key={asset.id} className="rounded-xl border border-zinc-200 bg-white p-3 shadow-sm">
              <div className="mb-2 aspect-square w-full overflow-hidden rounded bg-zinc-100">
                {isImageAsset(asset) ? (
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
                    previewFaceOverlays={buildAssetPreviewFaceOverlays(projectId, workspaceId, asset, t)}
                    onOpenPreview={() => {
                      void navigateToAssetIndex(offset + assetIndex);
                    }}
                  />
                ) : (
                  <PreviewableVideoPoster
                    src={asset.thumbnailUrl ?? null}
                    alt={asset.originalFilename}
                    emptyLabel={
                      asset.thumbnailState === "processing"
                        ? t("videoPosterProcessing")
                        : t("videoPosterUnavailable")
                    }
                    openLabel={t("videoPreviewOpen", { filename: asset.originalFilename })}
                    onOpenPreview={() => {
                      void navigateToAssetIndex(offset + assetIndex);
                    }}
                  />
                )}
              </div>
              <p className="truncate text-sm font-medium text-zinc-900" title={asset.originalFilename}>
                {asset.originalFilename}
              </p>
              {isImageAsset(asset) ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <span
                    className={`inline-flex rounded-md border px-2 py-1 text-[11px] font-medium ${getReviewStatusClasses(asset.reviewStatus ?? "resolved")}`}
                  >
                    {t(
                      asset.reviewStatus === "pending"
                        ? "reviewStatusPending"
                        : asset.reviewStatus === "needs_review"
                        ? "reviewStatusNeedsReview"
                        : asset.reviewStatus === "blocked"
                          ? "reviewStatusBlocked"
                          : "reviewStatusResolved",
                    )}
                  </span>
                  {(asset.unresolvedFaceCount ?? 0) > 0 ? (
                    <span className="inline-flex rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-700">
                      {t("reviewUnresolvedCount", { count: asset.unresolvedFaceCount ?? 0 })}
                    </span>
                  ) : null}
                  {(asset.blockedFaceCount ?? 0) > 0 ? (
                    <span className="inline-flex rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-700">
                      {t("reviewBlockedCount", { count: asset.blockedFaceCount ?? 0 })}
                    </span>
                  ) : null}
                </div>
              ) : (
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="inline-flex rounded-md border border-zinc-300 bg-zinc-100 px-2 py-1 text-[11px] font-medium text-zinc-700">
                    {t("videoBadge")}
                  </span>
                </div>
              )}
              <p className="mt-1 text-xs text-zinc-600">{formatBytes(asset.fileSizeBytes)}</p>
              <p className="mt-1 text-xs text-zinc-600">{t("addedOn", { date: formatDate(asset.createdAt, locale) })}</p>
              {isImageAsset(asset) ? (
                <p className="mt-1 text-xs text-zinc-600">
                  {t("linkedConsents", { count: asset.linkedConsentCount ?? 0 })}
                </p>
              ) : null}
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

      {selectedAsset && isPreviewableAsset(selectedAsset) ? (
        <ProjectAssetPreviewLightbox
          key={`${selectedAsset.id}:${selectedAssetGlobalIndex}`}
          projectId={projectId}
          asset={
            selectedAsset.assetType === "photo"
              ? {
                  id: selectedAsset.id,
                  assetType: "photo" as const,
                  originalFilename: selectedAsset.originalFilename,
                  previewUrl: selectedAsset.previewUrl ?? selectedAsset.thumbnailUrl ?? null,
                  thumbnailUrl: selectedAsset.thumbnailUrl ?? null,
                  previewState: selectedAsset.previewState,
                  initialPreviewFaceOverlays: buildAssetPreviewFaceOverlays(
                    projectId,
                    workspaceId,
                    selectedAsset,
                    t,
                  ),
                }
              : {
                  id: selectedAsset.id,
                  assetType: "video" as const,
                  originalFilename: selectedAsset.originalFilename,
                  playbackUrl: selectedAsset.playbackUrl ?? null,
                  previewUrl: selectedAsset.previewUrl ?? selectedAsset.thumbnailUrl ?? null,
                  thumbnailUrl: selectedAsset.thumbnailUrl ?? null,
                  previewState: selectedAsset.previewState,
                }
          }
          initialSelectedFaceId={
            selectedAsset.assetType === "photo"
              ? getInitialSelectedFaceIdForReview(reviewFilter, selectedAsset)
              : null
          }
          open
          onClose={handleLightboxClose}
          onPrevious={
            selectedAssetGlobalIndex !== null && selectedAssetGlobalIndex > 0
              ? () => {
                  void navigateToAdjacentAsset(-1);
                }
              : null
          }
          onNext={
            selectedAssetGlobalIndex !== null && selectedAssetGlobalIndex < totalCount - 1
              ? () => {
                  void navigateToAdjacentAsset(1);
                }
              : null
          }
          canPrevious={selectedAssetGlobalIndex !== null && selectedAssetGlobalIndex > 0}
          canNext={selectedAssetGlobalIndex !== null && selectedAssetGlobalIndex < totalCount - 1}
          previousLabel={selectedAsset.assetType === "photo" ? t("previewPrevious") : t("videoPreviewPrevious")}
          nextLabel={selectedAsset.assetType === "photo" ? t("previewNext") : t("videoPreviewNext")}
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
              ? selectedAsset.assetType === "photo"
                ? t("previewCounter", { current: selectedAssetGlobalIndex + 1, total: totalCount })
                : t("videoPreviewCounter", { current: selectedAssetGlobalIndex + 1, total: totalCount })
              : null
          }
          preloadSrcs={[
            previousAsset?.previewUrl ?? previousAsset?.thumbnailUrl ?? previousAsset?.playbackUrl ?? "",
            nextAsset?.previewUrl ?? nextAsset?.thumbnailUrl ?? nextAsset?.playbackUrl ?? "",
          ]}
        />
      ) : null}
    </div>
  );
}
