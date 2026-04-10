import {
  getStructuredFieldsInOrder,
  type StructuredFieldDefinition,
  type StructuredFieldsDefinition,
} from "@/lib/templates/structured-fields";

type PublicStructuredFieldsSectionProps = {
  definition: StructuredFieldsDefinition;
  strings: {
    title: string;
    subtitle: string;
    requiredField: string;
    selectPlaceholder: string;
    emptySelectionOption: string;
  };
};

function renderStructuredFieldInput(
  field: StructuredFieldDefinition,
  strings: PublicStructuredFieldsSectionProps["strings"],
) {
  const inputName = `structured__${field.fieldKey}`;
  const options = field.options ?? [];

  if (field.fieldType === "checkbox_list") {
    return (
      <div className="space-y-2">
        {options.map((option) => {
          const optionId = `structured-${field.fieldKey}-${option.optionKey}`;

          return (
            <label
              key={option.optionKey}
              htmlFor={optionId}
              className="flex items-start gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-800"
            >
              <input id={optionId} type="checkbox" name={inputName} value={option.optionKey} />
              <span>{option.label}</span>
            </label>
          );
        })}
      </div>
    );
  }

  if (field.fieldType === "single_select") {
    return (
      <select
        id={`structured-${field.fieldKey}`}
        name={inputName}
        className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900"
        required={field.required}
        defaultValue=""
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
    );
  }

  return (
    <input
      id={`structured-${field.fieldKey}`}
      type="text"
      name={inputName}
      className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-900"
      required={field.required}
      maxLength={field.maxLength ?? undefined}
      placeholder={field.placeholder ?? undefined}
    />
  );
}

export function PublicStructuredFieldsSection({
  definition,
  strings,
}: PublicStructuredFieldsSectionProps) {
  const structuredFields = getStructuredFieldsInOrder(definition);

  if (structuredFields.length === 0) {
    return null;
  }

  return (
    <section className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <div>
        <p className="text-sm font-medium text-zinc-900">{strings.title}</p>
        <p className="mt-1 text-xs text-zinc-600">{strings.subtitle}</p>
      </div>
      {structuredFields.map((field) => (
        <fieldset key={field.fieldKey} className="space-y-2">
          <div className="flex items-center gap-2">
            <legend className="text-sm font-medium text-zinc-900">{field.label}</legend>
            {field.required ? (
              <span className="text-xs font-medium text-zinc-600">{strings.requiredField}</span>
            ) : null}
          </div>
          {"helpText" in field && field.helpText ? (
            <p className="text-xs text-zinc-600">{field.helpText}</p>
          ) : null}
          {renderStructuredFieldInput(field, strings)}
        </fieldset>
      ))}
    </section>
  );
}
