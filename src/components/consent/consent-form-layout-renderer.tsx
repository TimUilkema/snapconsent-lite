"use client";

import type { ReactNode } from "react";

import type { ConsentFormLayoutBlock, ConsentFormLayoutDefinition } from "@/lib/templates/form-layout";

import {
  ConsentFormBlockRenderer,
  type ConsentFormRendererErrors,
  type ConsentFormRendererStrings,
  type ConsentFormRendererValues,
} from "@/components/consent/consent-form-block-renderer";
import type { StructuredFieldsDefinition } from "@/lib/templates/structured-fields";

type ConsentFormLayoutRendererProps = {
  consentText: string | null;
  formLayoutDefinition: ConsentFormLayoutDefinition;
  structuredFieldsDefinition: StructuredFieldsDefinition | null;
  strings: ConsentFormRendererStrings;
  values: ConsentFormRendererValues;
  errors?: ConsentFormRendererErrors;
  subjectNameInputName?: string;
  subjectEmailInputName?: string;
  structuredInputNamePrefix?: string;
  disabled?: boolean;
  onSubjectNameChange?: (value: string) => void;
  onSubjectEmailChange?: (value: string) => void;
  onConsentAcknowledgedChange?: (value: boolean) => void;
  onStructuredFieldChange?: (fieldKey: string, value: string | string[] | null) => void;
  onFaceMatchOptInChange?: (value: boolean) => void;
  faceMatchDetails?: ReactNode;
  consentAcknowledgementInputName?: string;
};

function getBlockId(block: ConsentFormLayoutBlock) {
  if (block.kind === "custom_field") {
    return `custom_field:${block.fieldKey}`;
  }

  return `${block.kind}:${block.key}`;
}

export function ConsentTextBlock({
  consentText,
  strings,
  values,
  errors,
  disabled,
  consentAcknowledgementInputName = "consent_acknowledged",
  onConsentAcknowledgedChange,
}: {
  consentText: string | null;
  strings: ConsentFormRendererStrings;
  values: ConsentFormRendererValues;
  errors?: ConsentFormRendererErrors;
  disabled?: boolean;
  consentAcknowledgementInputName?: string;
  onConsentAcknowledgedChange?: (value: boolean) => void;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-800">
      <p className="font-medium">{strings.consentTextHeading}</p>
      <p className="mt-2">{consentText ?? strings.consentTextUnavailable}</p>
      <div className="mt-4 rounded-lg border border-zinc-200 bg-white px-3 py-3 text-sm text-zinc-800">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            name={consentAcknowledgementInputName}
            value="1"
            required
            checked={values.consentAcknowledged}
            disabled={disabled}
            onChange={(event) => onConsentAcknowledgedChange?.(event.target.checked)}
          />
          <span>{strings.consentAcknowledgementLabel}</span>
        </label>
        {errors?.consent_acknowledged ? (
          <p className="mt-1 text-xs font-medium text-red-700">{errors.consent_acknowledged}</p>
        ) : null}
      </div>
    </div>
  );
}

export function ConsentFormLayoutRenderer({
  consentText,
  formLayoutDefinition,
  structuredFieldsDefinition,
  strings,
  values,
  errors,
  subjectNameInputName,
  subjectEmailInputName,
  structuredInputNamePrefix,
  disabled,
  onSubjectNameChange,
  onSubjectEmailChange,
  onConsentAcknowledgedChange,
  onStructuredFieldChange,
  onFaceMatchOptInChange,
  faceMatchDetails,
  consentAcknowledgementInputName = "consent_acknowledged",
}: ConsentFormLayoutRendererProps) {
  return (
    <>
      {formLayoutDefinition.blocks.map((block) => {
        if (block.kind === "system" && block.key === "consent_text") {
          return (
            <ConsentTextBlock
              key={getBlockId(block)}
              consentText={consentText}
              strings={strings}
              values={values}
              errors={errors}
              disabled={disabled}
              consentAcknowledgementInputName={consentAcknowledgementInputName}
              onConsentAcknowledgedChange={onConsentAcknowledgedChange}
            />
          );
        }

        return (
          <ConsentFormBlockRenderer
            key={getBlockId(block)}
            block={block}
            structuredFieldsDefinition={structuredFieldsDefinition}
            strings={strings}
            values={values}
            errors={errors}
            subjectNameInputName={subjectNameInputName}
            subjectEmailInputName={subjectEmailInputName}
            structuredInputNamePrefix={structuredInputNamePrefix}
            disabled={disabled}
            onSubjectNameChange={onSubjectNameChange}
            onSubjectEmailChange={onSubjectEmailChange}
            onStructuredFieldChange={onStructuredFieldChange}
            onFaceMatchOptInChange={onFaceMatchOptInChange}
            faceMatchDetails={faceMatchDetails}
          />
        );
      })}
    </>
  );
}
