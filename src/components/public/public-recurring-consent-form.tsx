"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";

import { ConsentFormLayoutRenderer } from "@/components/consent/consent-form-layout-renderer";
import type { ConsentFormLayoutDefinition } from "@/lib/templates/form-layout";
import type { StructuredFieldsDefinition } from "@/lib/templates/structured-fields";

type PublicRecurringConsentFormProps = {
  token: string;
  profileName: string;
  profileEmail: string;
  consentText: string | null;
  structuredFieldsDefinition: StructuredFieldsDefinition | null;
  formLayoutDefinition: ConsentFormLayoutDefinition;
};

export function PublicRecurringConsentForm({
  token,
  profileName,
  profileEmail,
  consentText,
  structuredFieldsDefinition,
  formLayoutDefinition,
}: PublicRecurringConsentFormProps) {
  const t = useTranslations("publicRecurringConsent.form");
  const [subjectName, setSubjectName] = useState(profileName);
  const [subjectEmail, setSubjectEmail] = useState(profileEmail);
  const [consentAcknowledged, setConsentAcknowledged] = useState(false);
  const [faceMatchOptIn, setFaceMatchOptIn] = useState(false);
  const [structuredFieldValues, setStructuredFieldValues] = useState<
    Record<string, string | string[] | null | undefined>
  >({});
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      action={`/rp/${token}/consent`}
      method="post"
      className="content-card space-y-5 rounded-xl p-4 sm:p-5"
      onSubmit={(event) => {
        if (!consentAcknowledged) {
          event.preventDefault();
          setError(t("errors.consentAcknowledgementRequired"));
        }
      }}
    >
      <ConsentFormLayoutRenderer
        consentText={consentText}
        formLayoutDefinition={formLayoutDefinition}
        structuredFieldsDefinition={structuredFieldsDefinition}
        strings={{
          fullNameLabel: t("fullNameLabel"),
          emailLabel: t("emailLabel"),
          scopeLabel: t("scopeLabel"),
          durationLabel: t("durationLabel"),
          requiredField: t("requiredField"),
          selectPlaceholder: t("selectPlaceholder"),
          emptySelectionOption: t("emptySelectionOption"),
          emptyCheckboxOptionLabel: t("emptyCheckboxOptionLabel"),
          faceMatchOptIn: t("faceMatchOptIn"),
          headshotRequiredTitle: t("headshotLaterTitle"),
          headshotRequiredBody: t("headshotLaterBody"),
          consentTextHeading: t("consentTextTitle"),
          consentTextUnavailable: t("consentTextUnavailable"),
          consentAcknowledgementLabel: t("consentAcknowledgementLabel"),
        }}
        values={{
          subjectName,
          subjectEmail,
          consentAcknowledged,
          faceMatchOptIn,
          structuredFieldValues,
        }}
        onSubjectNameChange={(value) => {
          setSubjectName(value);
          setError(null);
        }}
        onSubjectEmailChange={(value) => {
          setSubjectEmail(value);
          setError(null);
        }}
        onConsentAcknowledgedChange={(value) => {
          setConsentAcknowledged(value);
          setError(null);
        }}
        onFaceMatchOptInChange={(value) => {
          setFaceMatchOptIn(value);
          setError(null);
        }}
        onStructuredFieldChange={(fieldKey, value) => {
          setStructuredFieldValues((current) => ({
            ...current,
            [fieldKey]: value,
          }));
          setError(null);
        }}
      />

      <input type="hidden" name="face_match_opt_in" value={faceMatchOptIn ? "1" : "0"} />

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <button
        type="submit"
        className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700"
      >
        {t("submit")}
      </button>
    </form>
  );
}
