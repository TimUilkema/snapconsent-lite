import {
  getStructuredFieldsInOrder,
  getStructuredOptionLabel,
  type StructuredFieldDefinition,
  type StructuredFieldValue,
  type StructuredFieldsSnapshot,
} from "@/lib/templates/structured-fields";

type ConsentStructuredSnapshotProps = {
  snapshot: StructuredFieldsSnapshot;
  strings: {
    title: string;
    noneValue: string;
  };
};

function formatStructuredFieldValue(
  field: StructuredFieldDefinition,
  value: StructuredFieldValue | undefined,
  noneValue: string,
) {
  if (!value) {
    return noneValue;
  }

  if (value.valueType === "checkbox_list") {
    const selectedLabels = value.selectedOptionKeys
      .map((optionKey) => getStructuredOptionLabel(field, optionKey))
      .filter((label): label is string => Boolean(label));

    return selectedLabels.length > 0 ? selectedLabels.join(", ") : noneValue;
  }

  if (value.valueType === "single_select") {
    if (!value.selectedOptionKey) {
      return noneValue;
    }

    return getStructuredOptionLabel(field, value.selectedOptionKey) ?? noneValue;
  }

  return value.text ?? noneValue;
}

export function ConsentStructuredSnapshot({
  snapshot,
  strings,
}: ConsentStructuredSnapshotProps) {
  const fields = getStructuredFieldsInOrder(snapshot.definition);

  if (fields.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
      <h3 className="text-sm font-medium text-zinc-900">{strings.title}</h3>
      <dl className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) => (
          <div key={field.fieldKey} className="rounded-xl border border-zinc-200 bg-white p-3">
            <dt className="text-sm text-zinc-500">{field.label}</dt>
            <dd className="mt-1 text-sm font-medium text-zinc-900">
              {formatStructuredFieldValue(field, snapshot.values[field.fieldKey], strings.noneValue)}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
