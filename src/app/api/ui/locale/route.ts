import { NextResponse } from "next/server";

import {
  type UiLocale,
  UI_LOCALE_COOKIE_NAME,
  isUiLocale,
} from "@/lib/i18n/config";

type LocaleRequestBody = {
  locale?: string;
};

function parseLocale(value: unknown): UiLocale | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return isUiLocale(normalized) ? normalized : null;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as LocaleRequestBody | null;
  const locale = parseLocale(body?.locale);

  if (!locale) {
    return NextResponse.json(
      {
        error: "invalid_locale",
        message: "Invalid locale.",
      },
      { status: 400 },
    );
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(UI_LOCALE_COOKIE_NAME, locale, {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  return response;
}
