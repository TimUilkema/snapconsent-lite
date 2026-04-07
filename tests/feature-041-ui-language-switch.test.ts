import assert from "node:assert/strict";
import test from "node:test";

import { POST as setLocalePost } from "@/app/api/ui/locale/route";
import { resolveUiLocale } from "@/lib/i18n/config";
import { resolveLocalizedApiError } from "@/lib/i18n/error-message";

test("ui locale resolution defaults to nl for missing or invalid values", () => {
  assert.equal(resolveUiLocale(undefined), "nl");
  assert.equal(resolveUiLocale(null), "nl");
  assert.equal(resolveUiLocale(""), "nl");
  assert.equal(resolveUiLocale("de"), "nl");
  assert.equal(resolveUiLocale("nl"), "nl");
  assert.equal(resolveUiLocale("en"), "en");
});

test("locale API route sets cookie for valid locale", async () => {
  const request = new Request("http://localhost/api/ui/locale", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locale: "en" }),
  });

  const response = await setLocalePost(request);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie") ?? "", /ui_locale=en/);
});

test("locale API route rejects invalid locale", async () => {
  const request = new Request("http://localhost/api/ui/locale", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ locale: "de" }),
  });

  const response = await setLocalePost(request);
  assert.equal(response.status, 400);
});

test("localized api error prefers error code mapping and falls back to generic", () => {
  const fakeT = Object.assign(
    (key: string) =>
      ({
        "codes.invalid_input": "Translated invalid input",
        generic: "Translated generic",
      })[key] ?? key,
    {
      has: (key: string) => key === "codes.invalid_input",
    },
  );

  assert.equal(
    resolveLocalizedApiError(fakeT, { error: "invalid_input", message: "raw" }, "generic"),
    "Translated invalid input",
  );
  assert.equal(
    resolveLocalizedApiError(fakeT, { error: "not_mapped", message: "raw" }, "generic"),
    "Translated generic",
  );
  assert.equal(resolveLocalizedApiError(fakeT, null, "generic"), "Translated generic");
});
