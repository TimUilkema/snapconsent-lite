export const UI_LOCALES = ["nl", "en"] as const;

export type UiLocale = (typeof UI_LOCALES)[number];

export const DEFAULT_UI_LOCALE: UiLocale = "nl";

export const UI_LOCALE_COOKIE_NAME = "ui_locale";

export function isUiLocale(value: string | null | undefined): value is UiLocale {
  if (!value) {
    return false;
  }

  return (UI_LOCALES as readonly string[]).includes(value);
}

export function resolveUiLocale(value: string | null | undefined): UiLocale {
  return isUiLocale(value) ? value : DEFAULT_UI_LOCALE;
}
