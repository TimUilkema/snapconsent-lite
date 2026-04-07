"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

const NAV_ITEMS = [
  { href: "/dashboard", key: "dashboard" },
  { href: "/projects", key: "projects" },
  { href: "/templates", key: "templates" },
] as const;

function isActivePath(pathname: string, href: string) {
  if (href === "/projects" || href === "/templates") {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return pathname === href;
}

export function ProtectedNav() {
  const pathname = usePathname();
  const t = useTranslations("nav");

  return (
    <nav aria-label={t("ariaPrimary")} className="flex flex-wrap items-center gap-2">
      {NAV_ITEMS.map((item) => {
        const active = isActivePath(pathname, item.href);

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
            {t(item.key)}
          </Link>
        );
      })}
    </nav>
  );
}
