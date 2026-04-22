import assert from "node:assert/strict";
import test from "node:test";

import enMessages from "../messages/en.json";
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

test("one-off consent upgrade form renders pending invite share details and newer template options", async () => {
  const { OneOffConsentUpgradeForm } = await import(
    "../src/components/projects/one-off-consent-upgrade-form"
  );

  const markup = renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: "en", messages: enMessages },
      createElement(OneOffConsentUpgradeForm, {
        projectId: "project-1",
        consentId: "consent-1",
        currentTemplateId: "template-v1",
        currentTemplateKey: "media-release",
        currentTemplateVersionNumber: 1,
        templates: [
          {
            id: "template-v1",
            name: "Media Release",
            version: "v1",
            versionNumber: 1,
            templateKey: "media-release",
            scope: "tenant",
          },
          {
            id: "template-v2",
            name: "Media Release",
            version: "v2",
            versionNumber: 2,
            templateKey: "media-release",
            scope: "tenant",
          },
        ],
        initialPendingRequest: {
          id: "upgrade-1",
          targetTemplateId: "template-v2",
          targetTemplateName: "Media Release",
          targetTemplateVersion: "v2",
          invitePath: "/i/upgrade-token",
          expiresAt: "2026-04-30T12:00:00.000Z",
        },
      }),
    ),
  );

  assert.match(markup, /Request updated consent/);
  assert.match(markup, /Pending update: Media Release v2/);
  assert.match(markup, /upgrade-token/);
  assert.match(markup, /Create updated consent link|Replace pending link/);
  assert.match(markup, /Media Release v2 - Organization/);
});
