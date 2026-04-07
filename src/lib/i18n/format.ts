import { type UiLocale, resolveUiLocale } from "@/lib/i18n/config";

function normalizeLocale(locale: string | null | undefined): UiLocale {
  return resolveUiLocale(locale);
}

export function formatDateTime(value: string | Date, locale: string | null | undefined) {
  return new Intl.DateTimeFormat(normalizeLocale(locale), {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatDate(value: string | Date, locale: string | null | undefined) {
  return new Intl.DateTimeFormat(normalizeLocale(locale), {
    dateStyle: "medium",
  }).format(new Date(value));
}
