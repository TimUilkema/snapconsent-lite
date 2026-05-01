"use client";

import { useTranslations } from "next-intl";

import type { MediaLibraryReleaseSafetySummary } from "@/lib/project-releases/media-library-release-safety";

export function ReleaseSafetyBanner({
  summary,
}: {
  summary: MediaLibraryReleaseSafetySummary;
}) {
  const t = useTranslations("mediaLibrary.detail.safetyBanner");

  if (summary.primaryState === "clear") {
    return null;
  }

  const key =
    summary.hasBlockedFaces && summary.hasRestrictedState
      ? "blockedRestricted"
      : summary.hasBlockedFaces
        ? "blocked"
        : "restricted";

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-950">
      <h2 className="text-sm font-semibold">{t(`${key}.title`)}</h2>
      <p className="mt-1 leading-6 text-amber-900">{t(`${key}.body`)}</p>
      <ul className="mt-3 flex flex-wrap gap-2 text-xs font-medium text-amber-900">
        {summary.hasBlockedFaces ? (
          <li className="rounded-full border border-amber-300 bg-white px-2.5 py-1">
            {t("stats.blockedFaces", { count: summary.blockedFaceCount })}
          </li>
        ) : null}
        {summary.hasRevokedLinkedOwners ? (
          <li className="rounded-full border border-amber-300 bg-white px-2.5 py-1">
            {t("stats.revokedOwners", { count: summary.revokedLinkedOwnerCount })}
          </li>
        ) : null}
        {summary.hasNonGrantedEffectiveScopes ? (
          <li className="rounded-full border border-amber-300 bg-white px-2.5 py-1">
            {t("stats.restrictedScopes", { count: summary.nonGrantedEffectiveScopeCount })}
          </li>
        ) : null}
      </ul>
    </section>
  );
}
