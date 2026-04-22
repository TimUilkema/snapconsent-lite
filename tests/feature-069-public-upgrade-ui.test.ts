import assert from "node:assert/strict";
import test from "node:test";

import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import enMessages from "../messages/en.json";
import { createStarterFormLayoutDefinition } from "../src/lib/templates/form-layout";
import { createStarterStructuredFieldsDefinition } from "../src/lib/templates/structured-fields";

function buildStructuredDefinition() {
  const definition = createStarterStructuredFieldsDefinition();
  definition.builtInFields.scope.options = [
    {
      optionKey: "email",
      label: "Email",
      orderIndex: 0,
    },
    {
      optionKey: "linkedin",
      label: "LinkedIn",
      orderIndex: 1,
    },
  ];

  return definition;
}

test("one-off public upgrade form prefills prior answers and leaves new acknowledgement unchecked", async () => {
  const { PublicConsentForm } = await import("../src/components/public/public-consent-form");
  const structuredFieldsDefinition = buildStructuredDefinition();
  const markup = renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: "en", messages: enMessages },
      createElement(PublicConsentForm, {
        token: "upgrade-token",
        consentText: "Consent text",
        structuredFieldsDefinition,
        formLayoutDefinition: createStarterFormLayoutDefinition(structuredFieldsDefinition),
        initialValues: {
          subjectName: "Jordan Miles",
          subjectEmail: "jordan@example.com",
          faceMatchOptIn: true,
          structuredFieldValues: {
            scope: ["email"],
            duration: "one_year",
          },
        },
        upgradeMode: true,
      }),
    ),
  );

  assert.match(markup, /name="full_name"[^>]*value="Jordan Miles"/);
  assert.match(markup, /name="email"[^>]*value="jordan@example.com"/);
  assert.match(markup, /<input type="checkbox" name="structured__scope" checked="" value="email"\/>/);
  assert.doesNotMatch(markup, /<input type="checkbox" name="structured__scope" checked="" value="linkedin"\/>/);
  assert.match(markup, /<option value="one_year" selected="">1 year<\/option>/);
  assert.match(markup, /I consent to facial matching/);
  assert.doesNotMatch(markup, /name="consent_acknowledged"[^>]*checked=""/);
});

test("recurring public project upgrade form prefills prior answers and keeps acknowledgement unchecked", async () => {
  const { PublicRecurringConsentForm } = await import("../src/components/public/public-recurring-consent-form");
  const structuredFieldsDefinition = buildStructuredDefinition();
  const markup = renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: "en", messages: enMessages },
      createElement(PublicRecurringConsentForm, {
        token: "recurring-upgrade-token",
        profileName: "Ignored Name",
        profileEmail: "ignored@example.com",
        consentText: "Recurring consent text",
        structuredFieldsDefinition,
        formLayoutDefinition: createStarterFormLayoutDefinition(structuredFieldsDefinition),
        initialValues: {
          subjectName: "Jordan Miles",
          subjectEmail: "jordan@example.com",
          faceMatchOptIn: false,
          structuredFieldValues: {
            scope: ["email"],
            duration: "one_year",
          },
        },
        upgradeMode: true,
      }),
    ),
  );

  assert.match(markup, /name="full_name"[^>]*value="Jordan Miles"/);
  assert.match(markup, /name="email"[^>]*value="jordan@example.com"/);
  assert.match(markup, /<input type="checkbox" name="structured__scope" checked="" value="email"\/>/);
  assert.doesNotMatch(markup, /<input type="checkbox" name="structured__scope" checked="" value="linkedin"\/>/);
  assert.match(markup, /<option value="one_year" selected="">1 year<\/option>/);
  assert.doesNotMatch(markup, /name="consent_acknowledged"[^>]*checked=""/);
});
