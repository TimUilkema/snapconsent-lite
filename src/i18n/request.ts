import { cookies } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import {
  DEFAULT_UI_LOCALE,
  type UiLocale,
  UI_LOCALE_COOKIE_NAME,
  resolveUiLocale,
} from "@/lib/i18n/config";

const MESSAGE_LOADERS: Record<UiLocale, () => Promise<Record<string, unknown>>> = {
  en: async () => (await import("../../messages/en.json")).default,
  nl: async () => (await import("../../messages/nl.json")).default,
};

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const locale = resolveUiLocale(cookieStore.get(UI_LOCALE_COOKIE_NAME)?.value);
  const messages = await (MESSAGE_LOADERS[locale] ?? MESSAGE_LOADERS[DEFAULT_UI_LOCALE])();

  return {
    locale,
    messages,
  };
});
