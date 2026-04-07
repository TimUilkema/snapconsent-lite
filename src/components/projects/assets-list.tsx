"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { PreviewableImage } from "@/components/projects/previewable-image";
import { resolveLocalizedApiError } from "@/lib/i18n/error-message";
import { formatDate } from "@/lib/i18n/format";

type AssetRow = {
  id: string;
  originalFilename: string;
  status: string;
  fileSizeBytes: number;
  createdAt: string;
  uploadedAt: string | null;
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
    consentId: string;
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

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

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

function getConsentLabel(overlay: NonNullable<AssetRow["linkedFaceOverlays"]>[number]) {
  return overlay.fullName || overlay.email || `Consent ${overlay.consentId}`;
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
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedQuery, setLoadedQuery] = useState("");
  const [loadedConsentFilterKey, setLoadedConsentFilterKey] = useState("");
  const [selectedConsentIds, setSelectedConsentIds] = useState<string[]>([]);
  const [people, setPeople] = useState<AssetsResponse["people"]>([]);

  const selectedConsentFilterKey = useMemo(
    () => [...selectedConsentIds].sort((a, b) => a.localeCompare(b)).join(","),
    [selectedConsentIds],
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setOffset(0);
      setSearchQuery(queryInput.trim());
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [queryInput]);

  useEffect(() => {
    const controller = new AbortController();

    const canServeLocally =
      loadedQuery === searchQuery &&
      loadedConsentFilterKey === selectedConsentFilterKey &&
      offset === 0 &&
      totalCount > 0 &&
      assets.length === totalCount &&
      totalCount <= limit;

    if (canServeLocally) {
      setIsLoading(false);
      return () => controller.abort();
    }

    async function loadAssets() {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (searchQuery.length > 0) {
          params.set("q", searchQuery);
        }
        selectedConsentIds.forEach((consentId) => params.append("consentId", consentId));
        params.set("sort", sort);
        params.set("limit", String(limit));
        params.set("offset", String(offset));

        const response = await fetch(`/api/projects/${projectId}/assets?${params.toString()}`, {
          method: "GET",
          signal: controller.signal,
        });
        const payload = (await response.json().catch(() => null)) as AssetsResponse | null;

        if (!response.ok || !payload) {
          setError(resolveLocalizedApiError(tErrors, payload, "generic"));
          setAssets([]);
          setTotalCount(0);
          return;
        }

        setAssets(payload.assets ?? []);
        setTotalCount(payload.totalCount ?? 0);
        setPeople(payload.people ?? []);
        setLoadedQuery(searchQuery);
        setLoadedConsentFilterKey(selectedConsentFilterKey);
      } catch (loadError) {
        if ((loadError as { name?: string })?.name === "AbortError") {
          return;
        }
        setError(tErrors("generic"));
        setAssets([]);
        setTotalCount(0);
      } finally {
        setIsLoading(false);
      }
    }

    void loadAssets();

    return () => controller.abort();
  }, [
    assets.length,
    limit,
    loadedConsentFilterKey,
    loadedQuery,
    offset,
    projectId,
    searchQuery,
    selectedConsentFilterKey,
    selectedConsentIds,
    sort,
    tErrors,
    totalCount,
  ]);

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
            <p className="text-xs text-zinc-600">
              {t("filterHelp")}
            </p>
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
          {sortedAssets.map((asset) => (
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
                    asset.thumbnailState === "processing"
                      ? t("processingDisplay")
                      : t("unavailableDisplay")
                  }
                  previewFaceOverlays={(asset.linkedFaceOverlays ?? []).map((overlay) => ({
                    id: `${overlay.assetFaceId}:${overlay.consentId}`,
                    href: buildConsentHref(projectId, overlay.consentId),
                    label: getConsentLabel(overlay),
                    faceBoxNormalized: overlay.faceBoxNormalized,
                    headshotThumbnailUrl: overlay.headshotThumbnailUrl,
                  }))}
                />
              </div>
              <p className="truncate text-sm font-medium text-zinc-900" title={asset.originalFilename}>
                {asset.originalFilename}
              </p>
              <p className="mt-1 text-xs text-zinc-600">{formatBytes(asset.fileSizeBytes)}</p>
              <p className="mt-1 text-xs text-zinc-600">
                {t("addedOn", { date: formatDate(asset.createdAt, locale) })}
              </p>
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
          <span className="text-xs text-zinc-600">
            {t("pageOf", { page: currentPage, total: pageCount })}
          </span>
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
    </div>
  );
}
