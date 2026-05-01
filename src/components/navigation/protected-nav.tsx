"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

export const PROTECTED_NAV_ITEMS = [
  { href: "/dashboard", key: "dashboard" },
  { href: "/projects", key: "projects" },
  { href: "/media-library", key: "mediaLibrary" },
  { href: "/members", key: "members" },
  { href: "/profiles", key: "profiles" },
  { href: "/templates", key: "templates" },
] as const;

export type ProtectedNavStrings = {
  ariaPrimary: string;
} & Record<(typeof PROTECTED_NAV_ITEMS)[number]["key"], string>;

export function isProtectedNavActivePath(pathname: string, href: string) {
  if (
    href === "/projects"
    || href === "/media-library"
    || href === "/members"
    || href === "/profiles"
    || href === "/templates"
  ) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return pathname === href;
}

type ProtectedNavViewProps = {
  pathname: string;
  strings: ProtectedNavStrings;
  showMembers?: boolean;
  showMediaLibrary?: boolean;
  showProfiles?: boolean;
  showTemplates?: boolean;
};

export function ProtectedNavView({
  pathname,
  strings,
  showMembers = false,
  showMediaLibrary = false,
  showProfiles = false,
  showTemplates = false,
}: ProtectedNavViewProps) {
  const items = PROTECTED_NAV_ITEMS.filter((item) => {
    if (!showMembers && item.href === "/members") {
      return false;
    }

    if (!showMediaLibrary && item.href === "/media-library") {
      return false;
    }

    if (!showProfiles && item.href === "/profiles") {
      return false;
    }

    if (!showTemplates && item.href === "/templates") {
      return false;
    }

    return true;
  });

  return (
    <nav aria-label={strings.ariaPrimary} className="flex flex-wrap items-center gap-2">
      {items.map((item) => {
        const active = isProtectedNavActivePath(pathname, item.href);

        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              active
                ? "border border-zinc-300 bg-zinc-900 text-white"
                : "border border-transparent text-zinc-700 hover:border-zinc-200 hover:bg-white"
            }`}
          >
            {strings[item.key]}
          </Link>
        );
      })}
    </nav>
  );
}

type ProtectedNavProps = {
  showMembers?: boolean;
  showMediaLibrary?: boolean;
  showProfiles?: boolean;
  showTemplates?: boolean;
};

export function ProtectedNav({
  showMembers = false,
  showMediaLibrary = false,
  showProfiles = false,
  showTemplates = false,
}: ProtectedNavProps) {
  const pathname = usePathname();
  const t = useTranslations("nav");

  return (
    <ProtectedNavView
      pathname={pathname}
      strings={{
        ariaPrimary: t("ariaPrimary"),
        dashboard: t("dashboard"),
        projects: t("projects"),
        mediaLibrary: t("mediaLibrary"),
        members: t("members"),
        profiles: t("profiles"),
        templates: t("templates"),
      }}
      showMembers={showMembers}
      showMediaLibrary={showMediaLibrary}
      showProfiles={showProfiles}
      showTemplates={showTemplates}
    />
  );
}
