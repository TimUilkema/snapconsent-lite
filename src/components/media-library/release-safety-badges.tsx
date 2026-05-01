"use client";

import { useTranslations } from "next-intl";

import type { MediaLibraryReleaseSafetySummary } from "@/lib/project-releases/media-library-release-safety";

const BADGE_STYLES: Record<NonNullable<MediaLibraryReleaseSafetySummary["badges"][number]>, string> = {
  blocked: "border-red-200 bg-red-50 text-red-800",
  restricted: "border-amber-200 bg-amber-50 text-amber-800",
  manual: "border-sky-200 bg-sky-50 text-sky-800",
};

export function ReleaseSafetyBadges({
  summary,
}: {
  summary: MediaLibraryReleaseSafetySummary;
}) {
  const t = useTranslations("mediaLibrary.shared.badges");

  if (summary.badges.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {summary.badges.map((badge) => (
        <span
          key={badge}
          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${BADGE_STYLES[badge]}`}
        >
          {t(badge)}
        </span>
      ))}
    </div>
  );
}
