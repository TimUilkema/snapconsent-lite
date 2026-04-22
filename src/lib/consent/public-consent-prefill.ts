import type { StructuredFieldValue, StructuredFieldsSnapshot } from "@/lib/templates/structured-fields";

export type PublicConsentInitialValues = {
  subjectName: string;
  subjectEmail: string;
  faceMatchOptIn: boolean;
  structuredFieldValues: Record<string, string | string[] | null | undefined>;
};

function toFormValue(value: StructuredFieldValue) {
  if (value.valueType === "checkbox_list") {
    return value.selectedOptionKeys;
  }

  if (value.valueType === "single_select") {
    return value.selectedOptionKey ?? undefined;
  }

  return value.text ?? undefined;
}

export function mapStructuredSnapshotToFormValues(
  snapshot: StructuredFieldsSnapshot | null | undefined,
): PublicConsentInitialValues["structuredFieldValues"] {
  if (!snapshot?.values) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(snapshot.values).map(([fieldKey, value]) => [fieldKey, toFormValue(value)]),
  );
}
