"use client";

import { useTranslations } from "next-intl";

import type { MediaLibraryUsagePermissionOwnerSummary } from "@/lib/project-releases/media-library-release-safety";

function buildOwnerContextItems(
  owner: MediaLibraryUsagePermissionOwnerSummary,
  t: ReturnType<typeof useTranslations>,
) {
  const items: string[] = [];

  items.push(
    ...owner.exactFaceLinks.map((link) =>
      t("context.faceLink", {
        face: link.faceRank + 1,
        source: link.linkSource === "manual" ? t("context.linkSourceManual") : t("context.linkSourceAuto"),
      }),
    ),
  );

  if (owner.hasWholeAssetLink) {
    items.push(t("context.wholeAssetLink"));
  }

  if (owner.hasFallbackLink) {
    items.push(t("context.fallbackLink"));
  }

  return items;
}

function getScopeStatusClasses(
  status: MediaLibraryUsagePermissionOwnerSummary["effectiveScopes"][number]["status"],
) {
  switch (status) {
    case "granted":
      return {
        box: "border-emerald-600 bg-emerald-600 text-white",
        row: "border-emerald-200 bg-emerald-50/80",
        status: "text-emerald-800",
      };
    case "revoked":
      return {
        box: "border-red-600 bg-red-600 text-white",
        row: "border-red-200 bg-red-50/80",
        status: "text-red-800",
      };
    case "not_collected":
      return {
        box: "border-amber-500 bg-amber-50 text-amber-700",
        row: "border-amber-200 bg-amber-50/80",
        status: "text-amber-800",
      };
    case "not_granted":
    default:
      return {
        box: "border-zinc-400 bg-white text-zinc-500",
        row: "border-zinc-200 bg-zinc-50/80",
        status: "text-zinc-700",
      };
  }
}

function getSelectedScopeRowClasses(
  status: MediaLibraryUsagePermissionOwnerSummary["effectiveScopes"][number]["status"],
) {
  switch (status) {
    case "granted":
      return "border-emerald-500/35 bg-emerald-500/12";
    case "revoked":
      return "border-red-500/35 bg-red-500/12";
    case "not_collected":
      return "border-amber-500/35 bg-amber-500/12";
    case "not_granted":
    default:
      return "border-white/15 bg-white/8";
  }
}

function renderScopeIndicator(
  status: MediaLibraryUsagePermissionOwnerSummary["effectiveScopes"][number]["status"],
) {
  if (status === "granted") {
    return (
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="m3.5 8 2.5 2.5 6-6" />
      </svg>
    );
  }

  if (status === "revoked") {
    return (
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M4 4l8 8" />
        <path d="M12 4 4 12" />
      </svg>
    );
  }

  if (status === "not_collected") {
    return <span className="text-[10px] font-bold">?</span>;
  }

  return null;
}

export function ReleaseUsagePermissions({
  owners,
  selectedOwnerId = null,
  onSelectOwnerId,
}: {
  owners: MediaLibraryUsagePermissionOwnerSummary[];
  selectedOwnerId?: string | null;
  onSelectOwnerId?: (ownerId: string) => void;
}) {
  const t = useTranslations("mediaLibrary.detail");

  if (owners.length === 0) {
    return <p className="text-sm text-zinc-600">{t("empty.usagePermissions")}</p>;
  }

  return (
    <div className="space-y-4">
      {owners.map((owner) => {
        const contextItems = buildOwnerContextItems(owner, t);
        const isSelected = selectedOwnerId === owner.projectFaceAssigneeId;
        const Container = onSelectOwnerId ? "button" : "div";

        return (
          <Container
            id={`usage-owner-${owner.projectFaceAssigneeId}`}
            key={owner.projectFaceAssigneeId}
            {...(onSelectOwnerId
              ? {
                  type: "button" as const,
                  onClick: () => onSelectOwnerId(owner.projectFaceAssigneeId),
                  "aria-pressed": isSelected,
                }
              : {})}
            data-selected={isSelected ? "true" : "false"}
            className={`block w-full rounded-[22px] border p-4 text-left transition-colors ${
              isSelected
                ? "border-zinc-900 bg-zinc-900 text-white shadow-[0_18px_40px_rgba(15,23,42,0.18)]"
                : "border-zinc-200 bg-white text-zinc-900 hover:border-zinc-300"
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">
                  {owner.displayName ?? t("unknownOwner")}
                </p>
                <p className={`mt-1 text-sm ${isSelected ? "text-zinc-300" : "text-zinc-600"}`}>
                  {owner.email ?? t("noEmail")}
                </p>
                <p className={`mt-1 text-sm ${isSelected ? "text-zinc-300" : "text-zinc-600"}`}>
                  {owner.currentStatus ? t(`ownerStatuses.${owner.currentStatus}`) : t("ownerStatuses.active")}
                  {owner.identityKind ? ` / ${t(`ownerKinds.${owner.identityKind}`)}` : ""}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {owner.hasRestrictedState ? (
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${
                      isSelected
                        ? "border-white/25 bg-white/10 text-white"
                        : "border-amber-200 bg-amber-50 text-amber-800"
                    }`}
                  >
                    {t("usagePermissions.restricted")}
                  </span>
                ) : null}
                {isSelected ? (
                  <span className="inline-flex items-center rounded-full border border-white/25 bg-white/10 px-2.5 py-1 text-xs font-medium text-white">
                    {t("usagePermissions.selected")}
                  </span>
                ) : null}
              </div>
            </div>

            {contextItems.length > 0 ? (
              <ul className="mt-3 flex flex-wrap gap-2 text-xs">
                {contextItems.map((item) => (
                  <li
                    key={item}
                    className={`rounded-full border px-2.5 py-1 ${
                      isSelected
                        ? "border-white/20 bg-white/10 text-zinc-100"
                        : "border-zinc-200 bg-zinc-50 text-zinc-700"
                    }`}
                  >
                    {item}
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="mt-4 space-y-2">
              {owner.effectiveScopes.length === 0 ? (
                <p className={`text-sm ${isSelected ? "text-zinc-300" : "text-zinc-600"}`}>
                  {t("empty.effectiveScopes")}
                </p>
              ) : (
                owner.effectiveScopes.map((scope) => {
                  const classes = getScopeStatusClasses(scope.status);

                  return (
                    <div
                      key={`${scope.templateKey}:${scope.scopeKey}`}
                      className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2 ${
                        isSelected
                          ? getSelectedScopeRowClasses(scope.status)
                          : classes.row
                      }`}
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${classes.box}`}
                        >
                          {renderScopeIndicator(scope.status)}
                        </span>
                        <span className={`min-w-0 text-sm font-medium ${isSelected ? "text-white" : "text-zinc-900"}`}>
                          {scope.label}
                        </span>
                      </div>
                      <span className={`shrink-0 text-xs font-medium ${isSelected ? "text-zinc-200" : classes.status}`}>
                        {t(`scopeStatuses.${scope.status}`)}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </Container>
        );
      })}
    </div>
  );
}
