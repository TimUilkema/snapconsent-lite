"use client";

import type { ReactNode } from "react";

import type { ConsentFormLayoutBlock } from "@/lib/templates/form-layout";
import {
  getStructuredFieldByKey,
  type StructuredFieldDefinition,
  type StructuredFieldsDefinition,
} from "@/lib/templates/structured-fields";

export type ConsentFormRendererStrings = {
  fullNameLabel: string;
  emailLabel: string;
  scopeLabel: string;
  durationLabel: string;
  requiredField: string;
  selectPlaceholder: string;
  emptySelectionOption: string;
  emptyCheckboxOptionLabel: string;
  faceMatchOptIn: string;
  headshotRequiredTitle: string;
  headshotRequiredBody: string;
  consentTextHeading: string;
  consentTextUnavailable: string;
  consentAcknowledgementLabel: string;
};

export type ConsentFormRendererValues = {
  subjectName: string;
  subjectEmail: string;
  consentAcknowledged: boolean;
  faceMatchOptIn: boolean;
  structuredFieldValues: Record<string, string | string[] | null | undefined>;
};

export type ConsentFormRendererErrors = Partial<Record<string, string | null | undefined>>;

type ConsentFormBlockRendererProps = {
  block: ConsentFormLayoutBlock;
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
  onStructuredFieldChange?: (fieldKey: string, value: string | string[] | null) => void;
  onFaceMatchOptInChange?: (value: boolean) => void;
  faceMatchDetails?: ReactNode;
};

function inputClassName(hasError: boolean) {
  return [
    "w-full rounded-lg border bg-white px-3 py-2.5 text-sm text-zinc-900",
    hasError ? "border-red-400 focus:border-red-500" : "border-zinc-300",
  ].join(" ");
}

function checkboxCardClassName(hasError: boolean) {
  return [
    "flex items-start gap-2 rounded-lg border bg-white px-3 py-2 text-sm text-zinc-800",
    hasError ? "border-red-300" : "border-zinc-200",
  ].join(" ");
}

function getStructuredValue(
  field: StructuredFieldDefinition,
  values: ConsentFormRendererValues["structuredFieldValues"],
) {
  const rawValue = values[field.fieldKey];

  if (field.fieldType === "checkbox_list") {
    return Array.isArray(rawValue) ? rawValue : [];
  }

  if (typeof rawValue === "string") {
    return rawValue;
  }

  return "";
}

function renderError(error: string | null | undefined) {
  if (!error) {
    return null;
  }

  return <p className="text-xs font-medium text-red-700">{error}</p>;
}

function StructuredFieldBlock({
  field,
  label,
  strings,
  value,
  error,
  disabled,
  inputNamePrefix,
  onChange,
}: {
  field: StructuredFieldDefinition;
  label: string;
  strings: ConsentFormRendererStrings;
  value: string | string[];
  error: string | null | undefined;
  disabled: boolean;
  inputNamePrefix: string;
  onChange?: (value: string | string[] | null) => void;
}) {
  const inputName = `${inputNamePrefix}${field.fieldKey}`;
  const options = field.options ?? [];

  return (
    <fieldset className="space-y-2">
      <div className="flex items-center gap-2">
        <legend className="text-sm font-medium text-zinc-900">{label}</legend>
        {field.required ? (
          <span className="text-xs font-medium text-zinc-600">{strings.requiredField}</span>
        ) : null}
      </div>
      {"helpText" in field && field.helpText ? <p className="text-xs text-zinc-600">{field.helpText}</p> : null}

      {field.fieldType === "checkbox_list" ? (
        <div className="space-y-2">
          {options.length === 0 ? (
            <label className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-400">
              <input type="checkbox" disabled />
              <span>{strings.emptyCheckboxOptionLabel}</span>
            </label>
          ) : null}
          {options.map((option) => {
            const selectedOptionKeys = Array.isArray(value) ? value : [];
            const checked = selectedOptionKeys.includes(option.optionKey);

            return (
              <label
                key={option.optionKey}
                className={checkboxCardClassName(Boolean(error))}
              >
                <input
                  type="checkbox"
                  name={inputName}
                  value={option.optionKey}
                  checked={checked}
                  disabled={disabled}
                  onChange={(event) => {
                    if (!onChange) {
                      return;
                    }

                    const nextValue = event.target.checked
                      ? [...selectedOptionKeys, option.optionKey]
                      : selectedOptionKeys.filter((item) => item !== option.optionKey);
                    onChange(nextValue);
                  }}
                />
                <span>{option.label}</span>
              </label>
            );
          })}
        </div>
      ) : null}

      {field.fieldType === "single_select" ? (
        <select
          name={inputName}
          className={inputClassName(Boolean(error))}
          required={field.required}
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          onChange={(event) => onChange?.(event.target.value || null)}
        >
          <option value="" disabled={field.required}>
            {field.required ? strings.selectPlaceholder : strings.emptySelectionOption}
          </option>
          {options.map((option) => (
            <option key={option.optionKey} value={option.optionKey}>
              {option.label}
            </option>
          ))}
        </select>
      ) : null}

      {field.fieldType === "text_input" ? (
        <input
          type="text"
          name={inputName}
          className={inputClassName(Boolean(error))}
          required={field.required}
          maxLength={field.maxLength ?? undefined}
          placeholder={field.placeholder ?? undefined}
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          onChange={(event) => onChange?.(event.target.value)}
        />
      ) : null}

      {renderError(error)}
    </fieldset>
  );
}

export function ConsentFormBlockRenderer({
  block,
  structuredFieldsDefinition,
  strings,
  values,
  errors,
  subjectNameInputName = "full_name",
  subjectEmailInputName = "email",
  structuredInputNamePrefix = "structured__",
  disabled = false,
  onSubjectNameChange,
  onSubjectEmailChange,
  onStructuredFieldChange,
  onFaceMatchOptInChange,
  faceMatchDetails,
}: ConsentFormBlockRendererProps) {
  if (block.kind === "system") {
    if (block.key === "subject_name") {
      const error = errors?.subject_name;

      return (
        <label className="block text-sm text-zinc-800">
          <span className="mb-1 flex items-center gap-2 font-medium">
            <span>{strings.fullNameLabel}</span>
            <span className="text-xs font-medium text-zinc-600">{strings.requiredField}</span>
          </span>
          <input
            name={subjectNameInputName}
            className={inputClassName(Boolean(error))}
            minLength={2}
            maxLength={160}
            required
            value={values.subjectName}
            disabled={disabled}
            onChange={(event) => onSubjectNameChange?.(event.target.value)}
          />
          {renderError(error)}
        </label>
      );
    }

    if (block.key === "subject_email") {
      const error = errors?.subject_email;

      return (
        <label className="block text-sm text-zinc-800">
          <span className="mb-1 flex items-center gap-2 font-medium">
            <span>{strings.emailLabel}</span>
            <span className="text-xs font-medium text-zinc-600">{strings.requiredField}</span>
          </span>
          <input
            name={subjectEmailInputName}
            type="email"
            className={inputClassName(Boolean(error))}
            required
            value={values.subjectEmail}
            disabled={disabled}
            onChange={(event) => onSubjectEmailChange?.(event.target.value)}
          />
          {renderError(error)}
        </label>
      );
    }

    if (block.key === "face_match_section") {
      const error = errors?.face_match_section;

      return (
        <div className="space-y-3">
          <label className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm text-zinc-800">
            <input
              type="checkbox"
              checked={values.faceMatchOptIn}
              disabled={disabled}
              onChange={(event) => onFaceMatchOptInChange?.(event.target.checked)}
            />
            <span>{strings.faceMatchOptIn}</span>
          </label>

          {values.faceMatchOptIn ? (
            <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-zinc-800">
              <p className="font-medium">{strings.headshotRequiredTitle}</p>
              <p className="text-xs text-zinc-700">{strings.headshotRequiredBody}</p>
              {faceMatchDetails}
              {renderError(error)}
            </div>
          ) : null}
        </div>
      );
    }

    if (block.key === "consent_text") {
      return null;
    }
  }

  const fieldKey = block.kind === "custom_field" ? block.fieldKey : block.key;
  if (!structuredFieldsDefinition) {
    return null;
  }

  const field = getStructuredFieldByKey(structuredFieldsDefinition, fieldKey);
  if (!field) {
    return null;
  }

  return (
    <StructuredFieldBlock
      field={field}
      label={
        field.fieldKey === "scope"
          ? strings.scopeLabel
          : field.fieldKey === "duration"
            ? strings.durationLabel
            : field.label
      }
      strings={strings}
      value={getStructuredValue(field, values.structuredFieldValues)}
      error={errors?.[field.fieldKey]}
      disabled={disabled}
      inputNamePrefix={structuredInputNamePrefix}
      onChange={(value) => onStructuredFieldChange?.(field.fieldKey, value)}
    />
  );
}
