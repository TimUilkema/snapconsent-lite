import type { SupabaseClient } from "@supabase/supabase-js";

import { validateConsentBaseFields } from "@/lib/consent/validate-consent-base-fields";
import {
  FormLayoutError,
  normalizeFormLayoutDefinition,
} from "@/lib/templates/form-layout";
import {
  normalizeStructuredFieldsDefinition,
  StructuredFieldsError,
  validateStructuredFieldInputValues,
} from "@/lib/templates/structured-fields";

type TemplatePreviewValidationInput = {
  supabase: SupabaseClient;
  structuredFieldsDefinition: unknown;
  formLayoutDefinition: unknown;
  previewValues?: {
    subjectName?: string | null;
    subjectEmail?: string | null;
    consentAcknowledged?: boolean;
    faceMatchOptIn?: boolean;
    hasMockHeadshot?: boolean;
    structuredFieldValues?: Record<string, unknown> | null;
  };
};

export type TemplatePreviewValidationResult = {
  valid: boolean;
  configurationErrors: string[];
  fieldErrors: Record<string, string>;
};

function asCode(error: unknown) {
  if (error instanceof StructuredFieldsError || error instanceof FormLayoutError) {
    return error.code;
  }

  return "invalid_preview_configuration";
}

export async function validateTemplatePreview(
  input: TemplatePreviewValidationInput,
): Promise<TemplatePreviewValidationResult> {
  const configurationErrors: string[] = [];
  let normalizedStructuredFieldsDefinition = null;

  try {
    normalizedStructuredFieldsDefinition =
      input.structuredFieldsDefinition === null
        ? null
        : normalizeStructuredFieldsDefinition(input.structuredFieldsDefinition, {
            requireScopeOptions: false,
          });
  } catch (error) {
    configurationErrors.push(asCode(error));
  }

  if (configurationErrors.length === 0) {
    try {
      normalizeFormLayoutDefinition(
        input.formLayoutDefinition,
        normalizedStructuredFieldsDefinition,
      );
    } catch (error) {
      configurationErrors.push(asCode(error));
    }
  }

  if (configurationErrors.length > 0) {
    return {
      valid: false,
      configurationErrors,
      fieldErrors: {},
    };
  }

  const previewValues = input.previewValues ?? {};
  const baseFieldValidation = validateConsentBaseFields({
    subjectName: previewValues.subjectName,
    subjectEmail: previewValues.subjectEmail,
    consentAcknowledged: previewValues.consentAcknowledged === true,
    faceMatchOptIn: previewValues.faceMatchOptIn === true,
    hasHeadshot: previewValues.hasMockHeadshot === true,
  });
  const fieldErrors: Record<string, string> = {
    ...baseFieldValidation.fieldErrors,
  };

  const structuredFieldValidation = normalizedStructuredFieldsDefinition
    ? validateStructuredFieldInputValues(
        normalizedStructuredFieldsDefinition,
        previewValues.structuredFieldValues,
      )
    : {
        normalizedValues: {},
        fieldErrors: {},
      };

  Object.assign(fieldErrors, structuredFieldValidation.fieldErrors);

  if (
    normalizedStructuredFieldsDefinition &&
    Object.keys(structuredFieldValidation.fieldErrors).length === 0
  ) {
    const { error } = await input.supabase.rpc("preview_validate_structured_field_values", {
      p_definition: normalizedStructuredFieldsDefinition,
      p_values: structuredFieldValidation.normalizedValues,
    });

    if (error) {
      configurationErrors.push(error.message ?? "structured_validation_failed");
    }
  }

  return {
    valid: configurationErrors.length === 0 && Object.keys(fieldErrors).length === 0,
    configurationErrors,
    fieldErrors,
  };
}
