"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { ReleasedPhotoPreview } from "@/components/media-library/released-photo-preview";
import { ReleaseUsagePermissions } from "@/components/media-library/release-usage-permissions";
import { buildMediaLibraryUsagePermissionTable } from "@/lib/project-releases/media-library-usage-permission-table";
import type { ReleasePhotoOverlaySummary } from "@/lib/project-releases/media-library-release-overlays";
import type { MediaLibraryUsagePermissionOwnerSummary } from "@/lib/project-releases/media-library-release-safety";

function buildSnapshotNotes(input: {
  overlaySummary: ReleasePhotoOverlaySummary;
  owners: MediaLibraryUsagePermissionOwnerSummary[];
  t: ReturnType<typeof useTranslations>;
}) {
  const notes: string[] = [];

  if (input.overlaySummary.omittedHiddenFaceCount > 0) {
    notes.push(
      input.t("snapshotNotes.hiddenFacesOmitted", {
        count: input.overlaySummary.omittedHiddenFaceCount,
      }),
    );
  }

  if (input.overlaySummary.missingGeometryFaceCount > 0) {
    notes.push(
      input.t("snapshotNotes.geometryUnavailable", {
        count: input.overlaySummary.missingGeometryFaceCount,
      }),
    );
  }

  const wholeAssetOwnerCount = input.owners.filter((owner) => owner.hasWholeAssetLink).length;
  if (wholeAssetOwnerCount > 0) {
    notes.push(
      input.t("snapshotNotes.wholeAssetLinks", {
        count: wholeAssetOwnerCount,
      }),
    );
  }

  const fallbackOwnerCount = input.owners.filter((owner) => owner.hasFallbackLink).length;
  if (fallbackOwnerCount > 0) {
    notes.push(
      input.t("snapshotNotes.fallbackLinks", {
        count: fallbackOwnerCount,
      }),
    );
  }

  return notes;
}

export function ReleasedPhotoReviewSurface({
  src,
  alt,
  overlaySummary,
  owners,
}: {
  src: string;
  alt: string;
  overlaySummary: ReleasePhotoOverlaySummary;
  owners: MediaLibraryUsagePermissionOwnerSummary[];
}) {
  const t = useTranslations("mediaLibrary.detail");
  const permissionTable = useMemo(
    () => buildMediaLibraryUsagePermissionTable({ owners, faces: overlaySummary.visibleFaces }),
    [overlaySummary.visibleFaces, owners],
  );
  const faceColumns = useMemo(
    () => permissionTable.columns.filter((column) => column.kind === "face" && column.assetFaceId),
    [permissionTable.columns],
  );
  const initialColumnId =
    faceColumns[0]?.id
    ?? permissionTable.columns[0]?.id
    ?? null;
  const [selectedColumnId, setSelectedColumnId] = useState<string | null>(initialColumnId);
  const [hoveredColumnId, setHoveredColumnId] = useState<string | null>(null);
  const snapshotNotes = useMemo(
    () => buildSnapshotNotes({ overlaySummary, owners, t }),
    [overlaySummary, owners, t],
  );
  const selectedColumn = permissionTable.columns.find((column) => column.id === selectedColumnId) ?? null;
  const hoveredColumn = permissionTable.columns.find((column) => column.id === hoveredColumnId) ?? null;
  const selectedFaceId = selectedColumn?.assetFaceId ?? null;
  const hoveredFaceId = hoveredColumn?.assetFaceId ?? null;
  const faceColumnByAssetFaceId = useMemo(
    () => new Map(faceColumns.map((column) => [column.assetFaceId, column] as const)),
    [faceColumns],
  );

  return (
    <section className="content-card rounded-xl p-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(24rem,0.85fr)]">
        <div className="space-y-4">
          <ReleasedPhotoPreview
            src={src}
            alt={alt}
            faces={overlaySummary.visibleFaces}
            selectedFaceId={selectedFaceId}
            hoveredFaceId={hoveredFaceId}
            onSelectFaceId={(faceId) => {
              const column = faceId ? faceColumnByAssetFaceId.get(faceId) ?? null : null;
              setSelectedColumnId(column?.id ?? null);
            }}
            onHoverFaceId={(faceId) => {
              const column = faceId ? faceColumnByAssetFaceId.get(faceId) ?? null : null;
              setHoveredColumnId(column?.id ?? null);
            }}
          />

          {faceColumns.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {faceColumns.map((column) => {
                const isSelected = column.id === selectedColumnId;
                const faceNumber = (column.faceRank ?? 0) + 1;
                return (
                  <button
                    key={column.id}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setSelectedColumnId(isSelected ? null : column.id)}
                    onMouseEnter={() => setHoveredColumnId(column.id)}
                    onMouseLeave={() => setHoveredColumnId(null)}
                    onFocus={() => setHoveredColumnId(column.id)}
                    onBlur={() => setHoveredColumnId(null)}
                    className={`rounded-lg border px-3 py-2 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-1 ${
                      isSelected
                        ? "border-zinc-400 bg-zinc-100 text-zinc-950"
                        : "border-zinc-200 bg-white text-zinc-900 hover:border-zinc-300 hover:bg-zinc-50"
                    }`}
                  >
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 20a6 6 0 0 0-12 0" />
                        <circle cx="12" cy="10" r="4" />
                      </svg>
                      {t("faceLabel", { face: faceNumber })}
                    </span>
                    <span className="mt-1 block text-xs text-zinc-500">
                      {column.isBlocked
                        ? t("overlay.stateBlocked")
                        : column.linkSource === "manual"
                          ? t("context.linkSourceManual")
                          : column.linkSource === "auto"
                            ? t("context.linkSourceAuto")
                            : t("usagePermissions.noLinkedConsent")}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {snapshotNotes.length > 0 ? (
            <ul className="flex flex-wrap gap-2 text-xs text-zinc-600">
                {snapshotNotes.map((note) => (
                  <li key={note} className="rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1.5">
                    {note}
                  </li>
                ))}
              </ul>
          ) : null}
        </div>

        <div className="space-y-4">
          <h2 className="text-lg font-semibold text-zinc-900">{t("sections.usagePermissions")}</h2>

          <ReleaseUsagePermissions
            owners={owners}
            faces={overlaySummary.visibleFaces}
            selectedColumnId={selectedColumnId}
            hoveredColumnId={hoveredColumnId}
            onSelectColumnId={setSelectedColumnId}
            onHoverColumnId={setHoveredColumnId}
          />
        </div>
      </div>
    </section>
  );
}
