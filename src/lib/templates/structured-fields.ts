export const STRUCTURED_FIELDS_SCHEMA_VERSION = 1 as const;
export const STRUCTURED_FIELDS_DEFINITION_MAX_BYTES = 32768;
export const STRUCTURED_FIELD_VALUES_MAX_BYTES = 8192;
export const STRUCTURED_CUSTOM_FIELDS_MAX_COUNT = 12;
export const STRUCTURED_SCOPE_OPTIONS_MAX_COUNT = 20;
export const STRUCTURED_DURATION_OPTIONS_MAX_COUNT = 20;
export const STRUCTURED_FIELD_OPTIONS_MAX_COUNT = 20;
export const STRUCTURED_FIELD_LABEL_MAX_LENGTH = 120;
export const STRUCTURED_OPTION_LABEL_MAX_LENGTH = 120;
export const STRUCTURED_HELP_TEXT_MAX_LENGTH = 280;
export const STRUCTURED_PLACEHOLDER_MAX_LENGTH = 120;
export const STRUCTURED_TEXT_INPUT_DEFAULT_MAX_LENGTH = 200;
export const STRUCTURED_TEXT_INPUT_MAX_LENGTH_LIMIT = 500;

export const STRUCTURED_FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]{1,63}$/;

export const STRUCTURED_DURATION_OPTIONS = [
  {
    optionKey: "one_year",
    label: "1 year",
    orderIndex: 0,
  },
  {
    optionKey: "two_years",
    label: "2 years",
    orderIndex: 1,
  },
  {
    optionKey: "three_years",
    label: "3 years",
    orderIndex: 2,
  },
] as const;

export type StructuredFieldOption = {
  optionKey: string;
  label: string;
  orderIndex: number;
};

export type StructuredCustomFieldType = "single_select" | "checkbox_list" | "text_input";
export type StructuredFieldType = StructuredCustomFieldType;

export type StructuredScopeFieldDefinition = {
  fieldKey: "scope";
  fieldType: "checkbox_list";
  label: "Scope";
  required: true;
  orderIndex: 0;
  options: StructuredFieldOption[];
};

export type StructuredDurationFieldDefinition = {
  fieldKey: "duration";
  fieldType: "single_select";
  label: "Duration";
  required: true;
  orderIndex: 1;
  options: StructuredFieldOption[];
};

export type StructuredCustomFieldDefinition = {
  fieldKey: string;
  fieldType: StructuredCustomFieldType;
  label: string;
  required: boolean;
  orderIndex: number;
  helpText: string | null;
  placeholder: string | null;
  maxLength: number | null;
  options: StructuredFieldOption[] | null;
};

export type StructuredFieldDefinition =
  | StructuredScopeFieldDefinition
  | StructuredDurationFieldDefinition
  | StructuredCustomFieldDefinition;

export type StructuredFieldsDefinition = {
  schemaVersion: typeof STRUCTURED_FIELDS_SCHEMA_VERSION;
  builtInFields: {
    scope: StructuredScopeFieldDefinition;
    duration: StructuredDurationFieldDefinition;
  };
  customFields: StructuredCustomFieldDefinition[];
};

export type StructuredCheckboxValue = {
  valueType: "checkbox_list";
  selectedOptionKeys: string[];
};

export type StructuredSingleSelectValue = {
  valueType: "single_select";
  selectedOptionKey: string | null;
};

export type StructuredTextInputValue = {
  valueType: "text_input";
  text: string | null;
};

export type StructuredFieldValue =
  | StructuredCheckboxValue
  | StructuredSingleSelectValue
  | StructuredTextInputValue;

export type StructuredFieldValues = Record<string, StructuredFieldValue>;
export type StructuredFieldInputValues = Record<string, unknown>;

export type StructuredFieldsSnapshot = {
  schemaVersion: typeof STRUCTURED_FIELDS_SCHEMA_VERSION;
  templateSnapshot: {
    templateId: string;
    templateKey: string;
    name: string;
    version: string;
    versionNumber: number;
  };
  definition: StructuredFieldsDefinition;
  values: StructuredFieldValues;
};

type NormalizeDefinitionOptions = {
  requireScopeOptions: boolean;
};

function textByteLength(value: unknown) {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

function throwStructuredFieldsError(code: string, message = code): never {
  throw new StructuredFieldsError(code, message);
}

function assertStructuredByteLength(value: unknown, maxBytes: number, code: string) {
  if (textByteLength(value) > maxBytes) {
    throwStructuredFieldsError(code);
  }
}

function asObject(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throwStructuredFieldsError("invalid_structured_fields_definition");
  }

  return value as Record<string, unknown>;
}

function normalizeStringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeOptionalStringValue(value: unknown) {
  const normalized = normalizeStringValue(value);
  return normalized.length > 0 ? normalized : null;
}

function normalizeRequiredLabel(value: unknown) {
  const normalized = normalizeStringValue(value);
  if (!normalized || normalized.length > STRUCTURED_FIELD_LABEL_MAX_LENGTH) {
    throwStructuredFieldsError("invalid_structured_fields_definition");
  }

  return normalized;
}

function normalizeOptionLabel(value: unknown) {
  const normalized = normalizeStringValue(value);
  if (!normalized || normalized.length > STRUCTURED_OPTION_LABEL_MAX_LENGTH) {
    throwStructuredFieldsError("invalid_structured_fields_definition");
  }

  return normalized;
}

function normalizeFieldKey(value: unknown) {
  const normalized = normalizeStringValue(value);
  if (!STRUCTURED_FIELD_KEY_PATTERN.test(normalized)) {
    throwStructuredFieldsError("invalid_structured_fields_definition");
  }

  return normalized;
}

function normalizeOptions(value: unknown, maxCount: number, allowEmpty: boolean) {
  if (!Array.isArray(value)) {
    throwStructuredFieldsError("invalid_structured_fields_definition");
  }

  if (value.length > maxCount) {
    throwStructuredFieldsError("invalid_structured_fields_definition");
  }

  if (!allowEmpty && value.length === 0) {
    throwStructuredFieldsError("invalid_structured_fields_definition");
  }

  const seenOptionKeys = new Set<string>();

  return value.map((item, index) => {
    const option = asObject(item);
    const optionKey = normalizeFieldKey(option.optionKey);
    if (seenOptionKeys.has(optionKey)) {
      throwStructuredFieldsError("duplicate_structured_option_key");
    }
    seenOptionKeys.add(optionKey);

    return {
      optionKey,
      label: normalizeOptionLabel(option.label),
      orderIndex: index,
    } satisfies StructuredFieldOption;
  });
}

function normalizeHelpText(value: unknown) {
  const normalized = normalizeOptionalStringValue(value);
  if (normalized && normalized.length > STRUCTURED_HELP_TEXT_MAX_LENGTH) {
    throwStructuredFieldsError("invalid_structured_fields_definition");
  }

  return normalized;
}

function normalizePlaceholder(value: unknown) {
  const normalized = normalizeOptionalStringValue(value);
  if (normalized && normalized.length > STRUCTURED_PLACEHOLDER_MAX_LENGTH) {
    throwStructuredFieldsError("invalid_structured_fields_definition");
  }

  return normalized;
}

function normalizeTextInputMaxLength(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return STRUCTURED_TEXT_INPUT_DEFAULT_MAX_LENGTH;
  }

  if (typeof value !== "number" || !Number.isInteger(value)) {
    throwStructuredFieldsError("invalid_structured_text_limits");
  }

  if (value < 1 || value > STRUCTURED_TEXT_INPUT_MAX_LENGTH_LIMIT) {
    throwStructuredFieldsError("invalid_structured_text_limits");
  }

  return value;
}

function normalizeRequiredBoolean(value: unknown) {
  if (value === undefined) {
    return false;
  }

  if (typeof value !== "boolean") {
    throwStructuredFieldsError("invalid_structured_fields_definition");
  }

  return value;
}

function createDurationFieldDefinition(
  options: StructuredFieldOption[] = STRUCTURED_DURATION_OPTIONS.map((option) => ({ ...option })),
): StructuredDurationFieldDefinition {
  return {
    fieldKey: "duration",
    fieldType: "single_select",
    label: "Duration",
    required: true,
    orderIndex: 1,
    options,
  };
}

export function createStarterStructuredFieldsDefinition(): StructuredFieldsDefinition {
  return {
    schemaVersion: STRUCTURED_FIELDS_SCHEMA_VERSION,
    builtInFields: {
      scope: {
        fieldKey: "scope",
        fieldType: "checkbox_list",
        label: "Scope",
        required: true,
        orderIndex: 0,
        options: [],
      },
      duration: createDurationFieldDefinition(),
    },
    customFields: [],
  };
}

export function normalizeStructuredFieldsDefinition(
  input: unknown,
  options: NormalizeDefinitionOptions,
): StructuredFieldsDefinition {
  assertStructuredByteLength(
    input,
    STRUCTURED_FIELDS_DEFINITION_MAX_BYTES,
    "structured_fields_payload_too_large",
  );

  const definition = asObject(input);
  if (definition.schemaVersion !== STRUCTURED_FIELDS_SCHEMA_VERSION) {
    throwStructuredFieldsError("invalid_structured_fields_definition");
  }

  const builtInFields = asObject(definition.builtInFields);
  const scopeField = asObject(builtInFields.scope);
  const durationField = asObject(builtInFields.duration);
  const scopeOptions = normalizeOptions(
    scopeField.options,
    STRUCTURED_SCOPE_OPTIONS_MAX_COUNT,
    true,
  );
  const durationOptions = normalizeOptions(
    durationField.options,
    STRUCTURED_DURATION_OPTIONS_MAX_COUNT,
    false,
  );

  if (options.requireScopeOptions && scopeOptions.length === 0) {
    throwStructuredFieldsError("structured_scope_required");
  }

  const customFieldsInput = definition.customFields ?? [];
  if (!Array.isArray(customFieldsInput)) {
    throwStructuredFieldsError("invalid_structured_fields_definition");
  }

  if (customFieldsInput.length > STRUCTURED_CUSTOM_FIELDS_MAX_COUNT) {
    throwStructuredFieldsError("invalid_structured_fields_definition");
  }

  const seenFieldKeys = new Set<string>(["scope", "duration"]);
  const customFields = customFieldsInput.map((item, index) => {
    const field = asObject(item);
    const fieldKey = normalizeFieldKey(field.fieldKey);
    if (seenFieldKeys.has(fieldKey)) {
      throwStructuredFieldsError(
        fieldKey === "scope" || fieldKey === "duration"
          ? "invalid_structured_fields_definition"
          : "duplicate_structured_field_key",
      );
    }
    seenFieldKeys.add(fieldKey);

    const fieldType = field.fieldType;
    if (fieldType !== "single_select" && fieldType !== "checkbox_list" && fieldType !== "text_input") {
      throwStructuredFieldsError("invalid_structured_fields_definition");
    }

    const normalizedField: StructuredCustomFieldDefinition = {
      fieldKey,
      fieldType,
      label: normalizeRequiredLabel(field.label),
      required: normalizeRequiredBoolean(field.required),
      orderIndex: index,
      helpText: normalizeHelpText(field.helpText),
      placeholder: null,
      maxLength: null,
      options: null,
    };

    if (fieldType === "text_input") {
      normalizedField.placeholder = normalizePlaceholder(field.placeholder);
      normalizedField.maxLength = normalizeTextInputMaxLength(field.maxLength);
      if (field.options !== undefined && field.options !== null) {
        throwStructuredFieldsError("invalid_structured_fields_definition");
      }
    } else {
      if (field.placeholder !== undefined && field.placeholder !== null) {
        throwStructuredFieldsError("invalid_structured_text_limits");
      }
      if (field.maxLength !== undefined && field.maxLength !== null) {
        throwStructuredFieldsError("invalid_structured_text_limits");
      }

      normalizedField.options = normalizeOptions(
        field.options,
        STRUCTURED_FIELD_OPTIONS_MAX_COUNT,
        false,
      );
    }

    return normalizedField;
  });

  return {
    schemaVersion: STRUCTURED_FIELDS_SCHEMA_VERSION,
    builtInFields: {
      scope: {
        fieldKey: "scope",
        fieldType: "checkbox_list",
        label: "Scope",
        required: true,
        orderIndex: 0,
        options: scopeOptions,
      },
      duration: createDurationFieldDefinition(durationOptions),
    },
    customFields,
  };
}

export function getStructuredFieldsInOrder(definition: StructuredFieldsDefinition) {
  return [
    definition.builtInFields.scope,
    definition.builtInFields.duration,
    ...definition.customFields,
  ] satisfies StructuredFieldDefinition[];
}

export function getStructuredFieldByKey(
  definition: StructuredFieldsDefinition,
  fieldKey: string,
) {
  return getStructuredFieldsInOrder(definition).find((field) => field.fieldKey === fieldKey) ?? null;
}

export function getStructuredOptionLabel(
  field: StructuredFieldDefinition,
  optionKey: string,
) {
  if (!field.options) {
    return null;
  }

  return field.options.find((option) => option.optionKey === optionKey)?.label ?? null;
}

export function validateStructuredFieldInputValues(
  definition: StructuredFieldsDefinition,
  input: StructuredFieldInputValues | null | undefined,
) {
  assertStructuredByteLength(
    input ?? {},
    STRUCTURED_FIELD_VALUES_MAX_BYTES,
    "payload_too_large",
  );

  if (input !== null && input !== undefined && (typeof input !== "object" || Array.isArray(input))) {
    throwStructuredFieldsError("invalid_structured_fields");
  }

  const fieldErrors: Record<string, string> = {};
  const normalizedValues: Record<string, string | string[] | null> = {};
  const rawValues = (input ?? {}) as Record<string, unknown>;

  for (const field of getStructuredFieldsInOrder(definition)) {
    const rawValue = rawValues[field.fieldKey];

    if (field.fieldType === "checkbox_list") {
      const optionKeys = new Set((field.options ?? []).map((option) => option.optionKey));
      const selectedOptionKeys: string[] = [];

      if (rawValue === null || rawValue === undefined || rawValue === "") {
        // Leave empty for optional checkbox lists.
      } else if (typeof rawValue === "string") {
        const normalized = rawValue.trim();
        if (!normalized || !optionKeys.has(normalized)) {
          fieldErrors[field.fieldKey] = "invalid";
        } else {
          selectedOptionKeys.push(normalized);
        }
      } else if (Array.isArray(rawValue)) {
        for (const entry of rawValue) {
          if (typeof entry !== "string") {
            fieldErrors[field.fieldKey] = "invalid";
            break;
          }

          const normalized = entry.trim();
          if (!normalized || !optionKeys.has(normalized)) {
            fieldErrors[field.fieldKey] = "invalid";
            break;
          }

          if (!selectedOptionKeys.includes(normalized)) {
            selectedOptionKeys.push(normalized);
          }
        }
      } else {
        fieldErrors[field.fieldKey] = "invalid";
      }

      if (!fieldErrors[field.fieldKey] && field.required && selectedOptionKeys.length === 0) {
        fieldErrors[field.fieldKey] = "required";
      }

      normalizedValues[field.fieldKey] = selectedOptionKeys;
      continue;
    }

    if (field.fieldType === "single_select") {
      let selectedOptionKey: string | null = null;
      if (rawValue === null || rawValue === undefined || rawValue === "") {
        selectedOptionKey = null;
      } else if (typeof rawValue === "string") {
        const normalized = rawValue.trim();
        if (!normalized) {
          selectedOptionKey = null;
        } else if (!(field.options ?? []).some((option) => option.optionKey === normalized)) {
          fieldErrors[field.fieldKey] = "invalid";
        } else {
          selectedOptionKey = normalized;
        }
      } else {
        fieldErrors[field.fieldKey] = "invalid";
      }

      if (!fieldErrors[field.fieldKey] && field.required && !selectedOptionKey) {
        fieldErrors[field.fieldKey] = "required";
      }

      normalizedValues[field.fieldKey] = selectedOptionKey;
      continue;
    }

    let textValue: string | null = null;
    if (rawValue === null || rawValue === undefined || rawValue === "") {
      textValue = null;
    } else if (typeof rawValue === "string") {
      const normalized = rawValue.trim();
      textValue = normalized.length > 0 ? normalized : null;
      if (textValue && textValue.length > (field.maxLength ?? STRUCTURED_TEXT_INPUT_DEFAULT_MAX_LENGTH)) {
        fieldErrors[field.fieldKey] = "invalid";
      }
    } else {
      fieldErrors[field.fieldKey] = "invalid";
    }

    if (!fieldErrors[field.fieldKey] && field.required && !textValue) {
      fieldErrors[field.fieldKey] = "required";
    }

    normalizedValues[field.fieldKey] = textValue;
  }

  return {
    normalizedValues,
    fieldErrors,
  };
}

export class StructuredFieldsError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}
