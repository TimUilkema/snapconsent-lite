import { HttpError } from "@/lib/http/errors";
import {
  STRUCTURED_FIELD_KEY_PATTERN,
  STRUCTURED_FIELD_VALUES_MAX_BYTES,
} from "@/lib/templates/structured-fields";

export function parseStructuredFieldValues(formData: FormData) {
  const structuredFieldValues = new Map<string, string | string[]>();

  for (const [key, rawValue] of formData.entries()) {
    if (!key.startsWith("structured__")) {
      continue;
    }

    if (typeof rawValue !== "string") {
      throw new HttpError(400, "invalid_structured_fields", "Structured consent values are invalid.");
    }

    const fieldKey = key.slice("structured__".length).trim();
    if (!STRUCTURED_FIELD_KEY_PATTERN.test(fieldKey)) {
      throw new HttpError(400, "invalid_structured_fields", "Structured consent values are invalid.");
    }

    const currentValue = structuredFieldValues.get(fieldKey);
    if (currentValue === undefined) {
      structuredFieldValues.set(fieldKey, rawValue);
      continue;
    }

    if (Array.isArray(currentValue)) {
      currentValue.push(rawValue);
      continue;
    }

    structuredFieldValues.set(fieldKey, [currentValue, rawValue]);
  }

  if (structuredFieldValues.size === 0) {
    return null;
  }

  const payload = Object.fromEntries(structuredFieldValues.entries());
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload)).length;
  if (payloadBytes > STRUCTURED_FIELD_VALUES_MAX_BYTES) {
    throw new HttpError(400, "invalid_structured_fields", "Structured consent values are invalid.");
  }

  return payload;
}
