"use client";

import { startTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { type UiLocale, UI_LOCALES } from "@/lib/i18n/config";

type LanguageSwitchProps = {
  className?: string;
};

const LANGUAGE_LABELS: Record<UiLocale, string> = {
  en: "EN",
  nl: "NL",
};

export function LanguageSwitch({ className = "" }: LanguageSwitchProps) {
  const locale = useLocale() as UiLocale;
  const router = useRouter();
  const t = useTranslations("common.languageSwitch");
  const [isPending, setIsPending] = useState(false);

  async function setLocale(nextLocale: UiLocale) {
    if (nextLocale === locale || isPending) {
      return;
    }

    setIsPending(true);
    try {
      const response = await fetch("/api/ui/locale", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ locale: nextLocale }),
      });

      if (!response.ok) {
        return;
      }

      startTransition(() => {
        router.refresh();
      });
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="text-sm text-zinc-600">{t("label")}</span>
      <div
        role="group"
        aria-label={t("ariaLabel")}
        className="inline-flex rounded-lg border border-zinc-300 bg-white p-0.5"
      >
        {UI_LOCALES.map((option) => {
          const active = option === locale;
          return (
            <button
              key={option}
              type="button"
              onClick={() => void setLocale(option)}
              disabled={isPending || active}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                active
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-700 hover:bg-zinc-100"
              }`}
              aria-pressed={active}
            >
              {LANGUAGE_LABELS[option]}
            </button>
          );
        })}
      </div>
    </div>
  );
}
