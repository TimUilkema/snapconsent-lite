"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

export const PROTECTED_NAV_ITEMS = [
  { href: "/dashboard", key: "dashboard" },
  { href: "/projects", key: "projects" },
  { href: "/profiles", key: "profiles" },
  { href: "/templates", key: "templates" },
] as const;

export type ProtectedNavStrings = {
  ariaPrimary: string;
} & Record<(typeof PROTECTED_NAV_ITEMS)[number]["key"], string>;

export function isProtectedNavActivePath(pathname: string, href: string) {
  if (href === "/projects" || href === "/profiles" || href === "/templates") {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return pathname === href;
}

type ProtectedNavViewProps = {
  pathname: string;
  strings: ProtectedNavStrings;
};

export function ProtectedNavView({ pathname, strings }: ProtectedNavViewProps) {
  return (
    <nav aria-label={strings.ariaPrimary} className="flex flex-wrap items-center gap-2">
      {PROTECTED_NAV_ITEMS.map((item) => {
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

export function ProtectedNav() {
  const pathname = usePathname();
  const t = useTranslations("nav");

  return (
    <ProtectedNavView
      pathname={pathname}
      strings={{
        ariaPrimary: t("ariaPrimary"),
        dashboard: t("dashboard"),
        projects: t("projects"),
        profiles: t("profiles"),
        templates: t("templates"),
      }}
    />
  );
}
