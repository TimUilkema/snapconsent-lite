"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";

import { ReleasedPhotoPreview } from "@/components/media-library/released-photo-preview";
import { ReleaseUsagePermissions } from "@/components/media-library/release-usage-permissions";
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

function getOwnerStripSummary(
  owner: MediaLibraryUsagePermissionOwnerSummary,
  t: ReturnType<typeof useTranslations>,
) {
  if (owner.exactFaceLinks.length === 1) {
    return t("ownerStrip.singleFace", {
      face: owner.exactFaceLinks[0]!.faceRank + 1,
    });
  }

  return t("ownerStrip.multipleFaces", {
    count: owner.exactFaceLinks.length,
  });
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
  const exactFaceOwners = useMemo(
    () => owners.filter((owner) => owner.exactFaceLinks.length > 0),
    [owners],
  );
  const initialOwnerId =
    exactFaceOwners[0]?.projectFaceAssigneeId
    ?? owners[0]?.projectFaceAssigneeId
    ?? null;
  const [selectedOwnerId, setSelectedOwnerId] = useState<string | null>(initialOwnerId);
  const snapshotNotes = useMemo(
    () => buildSnapshotNotes({ overlaySummary, owners, t }),
    [overlaySummary, owners, t],
  );

  return (
    <section className="content-card rounded-xl p-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(24rem,0.85fr)]">
        <div className="space-y-4">
          <ReleasedPhotoPreview
            src={src}
            alt={alt}
            faces={overlaySummary.visibleFaces}
            selectedOwnerId={selectedOwnerId}
            onSelectOwnerId={setSelectedOwnerId}
          />

          {exactFaceOwners.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {exactFaceOwners.map((owner) => {
                const isSelected = owner.projectFaceAssigneeId === selectedOwnerId;
                return (
                  <button
                    key={owner.projectFaceAssigneeId}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setSelectedOwnerId(owner.projectFaceAssigneeId)}
                    className={`rounded-full border px-3 py-2 text-left transition-colors ${
                      isSelected
                        ? "border-zinc-900 bg-zinc-900 text-white shadow-sm"
                        : "border-zinc-200 bg-white text-zinc-900 hover:border-zinc-300 hover:bg-zinc-50"
                    }`}
                  >
                    <span className="block text-sm font-medium">
                      {owner.displayName ?? owner.email ?? t("unknownOwner")}
                    </span>
                    <span className={`block text-xs ${isSelected ? "text-zinc-300" : "text-zinc-500"}`}>
                      {getOwnerStripSummary(owner, t)}
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
            selectedOwnerId={selectedOwnerId}
            onSelectOwnerId={setSelectedOwnerId}
          />
        </div>
      </div>
    </section>
  );
}
