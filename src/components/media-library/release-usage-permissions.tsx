"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import {
  buildMediaLibraryUsagePermissionTable,
  type MediaLibraryUsagePermissionCellStatus,
  type MediaLibraryUsagePermissionColumn,
} from "@/lib/project-releases/media-library-usage-permission-table";
import type { ReleasePhotoFaceContext } from "@/lib/project-releases/media-library-release-overlays";
import type { MediaLibraryUsagePermissionOwnerSummary } from "@/lib/project-releases/media-library-release-safety";

function statusTone(status: MediaLibraryUsagePermissionCellStatus | "final_granted" | "final_blocked") {
  switch (status) {
    case "granted":
    case "final_granted":
      return "border-emerald-200 bg-emerald-50 text-emerald-800";
    case "revoked":
    case "blocked":
    case "final_blocked":
      return "border-red-200 bg-red-50 text-red-800";
    case "not_collected":
      return "border-amber-200 bg-amber-50 text-amber-800";
    case "not_granted":
    case "not_available":
    default:
      return "border-zinc-200 bg-zinc-50 text-zinc-700";
  }
}

function renderStatusIcon(status: MediaLibraryUsagePermissionCellStatus | "final_granted" | "final_blocked") {
  if (status === "granted" || status === "final_granted") {
    return (
      <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="m3.5 8 2.5 2.5 6-6" />
      </svg>
    );
  }

  if (status === "not_collected" || status === "not_available") {
    return <span className="text-[10px] font-bold">?</span>;
  }

  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 4l8 8" />
      <path d="M12 4 4 12" />
    </svg>
  );
}

function renderFaceIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 20a6 6 0 0 0-12 0" />
      <circle cx="12" cy="10" r="4" />
    </svg>
  );
}

function getColumnLabel(
  column: MediaLibraryUsagePermissionColumn,
  t: ReturnType<typeof useTranslations>,
) {
  if (column.kind === "face" && column.faceRank !== null) {
    return t("faceLabel", { face: column.faceRank + 1 });
  }

  return t("usagePermissions.assetLinkColumn");
}

function getColumnContext(
  column: MediaLibraryUsagePermissionColumn,
  t: ReturnType<typeof useTranslations>,
) {
  if (column.isBlocked) {
    return t("overlay.stateBlocked");
  }

  if (column.linkSource === "manual") {
    return t("context.linkSourceManual");
  }

  if (column.linkSource === "auto") {
    return t("context.linkSourceAuto");
  }

  return t("usagePermissions.noLinkedConsent");
}

function getCellLabel(status: MediaLibraryUsagePermissionCellStatus, t: ReturnType<typeof useTranslations>) {
  if (status === "blocked") {
    return t("usagePermissions.blockedNoConsent");
  }

  if (status === "not_available") {
    return t("usagePermissions.notAvailable");
  }

  return t(`scopeStatuses.${status}`);
}

export function ReleaseUsagePermissions({
  owners,
  faces,
  selectedColumnId = null,
  hoveredColumnId = null,
  onSelectColumnId,
  onHoverColumnId,
}: {
  owners: MediaLibraryUsagePermissionOwnerSummary[];
  faces?: ReleasePhotoFaceContext[];
  selectedColumnId?: string | null;
  hoveredColumnId?: string | null;
  onSelectColumnId?: (columnId: string | null) => void;
  onHoverColumnId?: (columnId: string | null) => void;
}) {
  const t = useTranslations("mediaLibrary.detail");
  const table = useMemo(
    () => buildMediaLibraryUsagePermissionTable({ owners, faces }),
    [owners, faces],
  );
  const activeColumnId = hoveredColumnId ?? selectedColumnId;

  if (owners.length === 0 && table.columns.length === 0) {
    return <p className="text-sm text-zinc-600">{t("empty.usagePermissions")}</p>;
  }

  if (table.rows.length === 0) {
    return <p className="text-sm text-zinc-600">{t("empty.effectiveScopes")}</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white">
      <table className="min-w-full border-separate border-spacing-0 text-sm">
        <thead className="bg-zinc-50 text-left text-zinc-700">
          <tr>
            <th scope="col" className="border-b border-zinc-200 px-3 py-3 font-medium text-zinc-900">
              {t("usagePermissions.scopeColumn")}
            </th>
            {table.columns.map((column) => {
              const isActive = activeColumnId === column.id;
              return (
                <th
                  id={`usage-column-${column.id}`}
                  key={column.id}
                  scope="col"
                  className={`border-b border-l border-zinc-200 px-2 py-2 align-top transition-colors ${
                    isActive ? "bg-zinc-100" : "bg-zinc-50"
                  }`}
                  onMouseEnter={() => onHoverColumnId?.(column.id)}
                  onMouseLeave={() => onHoverColumnId?.(null)}
                >
                  <button
                    id={column.kind === "face" && column.assetFaceId ? `release-face-${column.assetFaceId}` : undefined}
                    type="button"
                    className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-2 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-1 ${
                      isActive
                        ? "border-zinc-400 bg-white text-zinc-950"
                        : "border-transparent text-zinc-800 hover:border-zinc-200 hover:bg-white"
                    }`}
                    aria-pressed={selectedColumnId === column.id}
                    onClick={() => onSelectColumnId?.(selectedColumnId === column.id ? null : column.id)}
                    onFocus={() => onHoverColumnId?.(column.id)}
                    onBlur={() => onHoverColumnId?.(null)}
                    title={getColumnLabel(column, t)}
                  >
                    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-700">
                      {renderFaceIcon()}
                    </span>
                    <span className="min-w-0">
                      <span className="block whitespace-nowrap font-medium">{getColumnLabel(column, t)}</span>
                      <span className="block whitespace-nowrap text-xs font-normal text-zinc-500">
                        {getColumnContext(column, t)}
                      </span>
                    </span>
                  </button>
                </th>
              );
            })}
            <th scope="col" className="border-b border-l border-zinc-200 px-3 py-3 font-medium text-zinc-900">
              {t("usagePermissions.finalColumn")}
            </th>
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr key={row.id} className="transition-colors hover:bg-zinc-50">
              <th scope="row" className="border-b border-zinc-100 px-3 py-3 text-left font-medium text-zinc-900">
                {row.label}
              </th>
              {row.cells.map((cell) => {
                const isActive = activeColumnId === cell.columnId;
                return (
                  <td
                    key={cell.columnId}
                    className={`border-b border-l border-zinc-100 px-3 py-3 transition-colors ${
                      isActive ? "bg-zinc-50" : ""
                    }`}
                    onMouseEnter={() => onHoverColumnId?.(cell.columnId)}
                    onMouseLeave={() => onHoverColumnId?.(null)}
                  >
                    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium ${statusTone(cell.status)}`}>
                      {renderStatusIcon(cell.status)}
                      {getCellLabel(cell.status, t)}
                    </span>
                  </td>
                );
              })}
              <td className="border-b border-l border-zinc-100 px-3 py-3">
                <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-semibold ${
                  row.finalStatus === "granted" ? statusTone("final_granted") : statusTone("final_blocked")
                }`}>
                  {renderStatusIcon(row.finalStatus === "granted" ? "final_granted" : "final_blocked")}
                  {row.finalStatus === "granted"
                    ? t("usagePermissions.finalGranted")
                    : t("usagePermissions.finalBlocked")}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
