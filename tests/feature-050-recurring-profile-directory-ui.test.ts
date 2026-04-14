import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import enMessages from "../messages/en.json";
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { RecurringProfilesPageData } from "../src/lib/profiles/profile-directory-service";

function buildPageData(canManageProfiles: boolean): RecurringProfilesPageData {
  return {
    access: {
      role: canManageProfiles ? "owner" : "photographer",
      canViewProfiles: true,
      canManageProfiles,
    },
    summary: {
      activeProfiles: 2,
      archivedProfiles: 1,
      activeProfileTypes: 2,
      activeProfilesWithoutType: 1,
    },
    filters: {
      q: "",
      profileTypeId: null,
      includeArchived: false,
    },
    profileTypes: [
      {
        id: randomUUID(),
        label: "Volunteer",
        status: "active",
        updatedAt: new Date().toISOString(),
        archivedAt: null,
        activeProfileCount: 1,
      },
      {
        id: randomUUID(),
        label: "Board",
        status: "archived",
        updatedAt: new Date().toISOString(),
        archivedAt: new Date().toISOString(),
        activeProfileCount: 0,
      },
    ],
    profiles: [
      {
        id: randomUUID(),
        fullName: "Jordan Miles",
        email: "jordan@example.com",
        status: "active",
        updatedAt: new Date().toISOString(),
        archivedAt: null,
        profileType: {
          id: randomUUID(),
          label: "Volunteer",
          status: "active",
          archivedAt: null,
        },
      },
      {
        id: randomUUID(),
        fullName: "Alex Rivera",
        email: "alex@example.com",
        status: "archived",
        updatedAt: new Date().toISOString(),
        archivedAt: new Date().toISOString(),
        profileType: {
          id: randomUUID(),
          label: "Board",
          status: "archived",
          archivedAt: new Date().toISOString(),
        },
      },
    ],
  };
}

test("profiles directory shell renders manage and read-only states with translated copy", async () => {
  const { ProfilesShellView } = await import("../src/components/profiles/profiles-shell");
  const router = {
    refresh() {},
  };

  const manageMarkup = renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: "en", messages: enMessages },
      createElement(ProfilesShellView, { data: buildPageData(true), router }),
    ),
  );

  assert.match(manageMarkup, /Create profile/);
  assert.match(manageMarkup, /Profile types/);
  assert.match(manageMarkup, /Active profiles/);
  assert.match(manageMarkup, /No type/);
  assert.match(manageMarkup, /Type archived/);
  assert.match(manageMarkup, /Deferred follow-up work/);
  assert.match(manageMarkup, /Request baseline consent/);

  const readOnlyMarkup = renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: "en", messages: enMessages },
      createElement(ProfilesShellView, { data: buildPageData(false), router }),
    ),
  );

  assert.match(readOnlyMarkup, /only workspace owners and admins can change it/);
  assert.doesNotMatch(readOnlyMarkup, /Create profile/);
  assert.doesNotMatch(readOnlyMarkup, /New profile type/);
  assert.doesNotMatch(readOnlyMarkup, /Active profile types/);
  assert.match(readOnlyMarkup, /Deferred follow-up work/);
});
