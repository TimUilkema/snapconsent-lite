"use client";

import { useState, type CSSProperties, type KeyboardEvent } from "react";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

import {
  STRUCTURED_CUSTOM_FIELDS_MAX_COUNT,
  STRUCTURED_DURATION_OPTIONS_MAX_COUNT,
  STRUCTURED_FIELD_OPTIONS_MAX_COUNT,
  STRUCTURED_SCOPE_OPTIONS_MAX_COUNT,
  STRUCTURED_TEXT_INPUT_DEFAULT_MAX_LENGTH,
  type StructuredCustomFieldDefinition,
  type StructuredCustomFieldType,
  type StructuredFieldOption,
  type StructuredFieldsDefinition,
} from "@/lib/templates/structured-fields";

type TemplateStructuredFieldsEditorProps = {
  definition: StructuredFieldsDefinition | null;
  readOnly: boolean;
  onChange: (nextDefinition: StructuredFieldsDefinition) => void;
  strings: {
    title: string;
    subtitle: string;
    legacyMessage: string;
    builtInFieldsTitle: string;
    scopeFieldTitle: string;
    scopeFieldDescription: string;
    scopeEmpty: string;
    addScopeOption: string;
    addDurationOption: string;
    addOption: string;
    durationFieldTitle: string;
    durationFieldDescription: string;
    customFieldsTitle: string;
    customFieldsEmpty: string;
    addSingleSelectField: string;
    addCheckboxListField: string;
    addTextInputField: string;
    fieldLabelField: string;
    fieldTypeField: string;
    helpTextField: string;
    placeholderField: string;
    requiredFieldLabel: string;
    requiredValue: string;
    optionalValue: string;
    optionsField: string;
    optionLabelField: string;
    dragHandle: string;
    removeOption: string;
    removeField: string;
    typeSingleSelect: string;
    typeCheckboxList: string;
    typeTextInput: string;
  };
};

function reindexOptions(options: StructuredFieldOption[]) {
  return options.map((option, index) => ({
    ...option,
    orderIndex: index,
  }));
}

function reindexCustomFields(customFields: StructuredCustomFieldDefinition[]) {
  return customFields.map((field, index) => ({
    ...field,
    orderIndex: index,
    options: field.options ? reindexOptions(field.options) : null,
  }));
}

function buildUniqueKey(seed: string, existingKeys: Set<string>, fallbackPrefix: string) {
  const normalizedSeed = seed
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");

  let base = normalizedSeed;
  if (!base || !/^[a-z]/.test(base)) {
    base = fallbackPrefix;
  }
  if (base.length < 2) {
    base = `${fallbackPrefix}_field`;
  }
  if (base.length > 64) {
    base = base.slice(0, 64);
  }

  let candidate = base;
  let counter = 2;
  while (existingKeys.has(candidate)) {
    const suffix = `_${counter}`;
    candidate = `${base.slice(0, Math.max(2, 64 - suffix.length))}${suffix}`;
    counter += 1;
  }

  return candidate;
}

function updateDefinition(
  definition: StructuredFieldsDefinition,
  updater: (current: StructuredFieldsDefinition) => StructuredFieldsDefinition,
) {
  const nextDefinition = updater({
    ...definition,
    builtInFields: {
      scope: {
        ...definition.builtInFields.scope,
        options: reindexOptions(definition.builtInFields.scope.options),
      },
      duration: {
        ...definition.builtInFields.duration,
        options: reindexOptions(definition.builtInFields.duration.options),
      },
    },
    customFields: reindexCustomFields(definition.customFields),
  });

  return {
    ...nextDefinition,
    builtInFields: {
      scope: {
        ...nextDefinition.builtInFields.scope,
        options: reindexOptions(nextDefinition.builtInFields.scope.options),
      },
      duration: {
        ...nextDefinition.builtInFields.duration,
        options: reindexOptions(nextDefinition.builtInFields.duration.options),
      },
    },
    customFields: reindexCustomFields(nextDefinition.customFields),
  };
}

function DragHandleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 fill-current">
      <circle cx="5" cy="3" r="1.25" />
      <circle cx="5" cy="8" r="1.25" />
      <circle cx="5" cy="13" r="1.25" />
      <circle cx="11" cy="3" r="1.25" />
      <circle cx="11" cy="8" r="1.25" />
      <circle cx="11" cy="13" r="1.25" />
    </svg>
  );
}

function buildOptionKey(label: string, options: StructuredFieldOption[]) {
  const existingKeys = new Set(options.map((option) => option.optionKey));
  return buildUniqueKey(label || `option_${options.length + 1}`, existingKeys, "option");
}

function SortableOptionRow({
  option,
  readOnly,
  dragLabel,
  removeLabel,
  onChange,
  onRemove,
}: {
  option: StructuredFieldOption;
  readOnly: boolean;
  dragLabel: string;
  removeLabel: string;
  onChange: (label: string) => void;
  onRemove: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: option.optionKey,
    disabled: readOnly,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li ref={setNodeRef} style={style} className="flex items-center gap-2">
      <button
        type="button"
        className="rounded-md border border-zinc-300 p-2 text-zinc-600 disabled:opacity-50"
        aria-label={dragLabel}
        title={dragLabel}
        disabled={readOnly}
        {...attributes}
        {...listeners}
      >
        <DragHandleIcon />
      </button>
      <div className="flex min-w-0 flex-1 items-center rounded-xl border border-zinc-300 bg-white px-3 py-2.5">
        <input
          value={option.label}
          onChange={(event) => onChange(event.target.value)}
          className="min-w-0 flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400"
          maxLength={120}
          disabled={readOnly}
          placeholder=""
        />
      </div>
      {!readOnly ? (
        <button
          type="button"
          onClick={onRemove}
          className="flex h-10 w-10 items-center justify-center rounded-xl border border-zinc-300 bg-white text-zinc-600 hover:bg-zinc-100"
          aria-label={removeLabel}
          title={removeLabel}
        >
          <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 stroke-current" fill="none">
            <path d="M4 4l8 8M12 4l-8 8" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      ) : null}
    </li>
  );
}

function NewOptionRow({
  value,
  placeholder,
  disabled,
  onChange,
  onCommit,
}: {
  value: string;
  placeholder: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onCommit: () => void;
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      onCommit();
    }
  }

  return (
    <div className="flex items-center gap-2">
      <div className="h-10 w-10" />
      <div className="flex min-w-0 flex-1 items-center rounded-xl border border-dashed border-zinc-300 bg-white/70 px-3 py-2.5">
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={onCommit}
          onKeyDown={handleKeyDown}
          className="min-w-0 flex-1 bg-transparent text-sm text-zinc-900 outline-none placeholder:text-zinc-400"
          maxLength={120}
          disabled={disabled}
          placeholder={placeholder}
        />
      </div>
      <div className="h-10 w-10" />
    </div>
  );
}

function OptionsEditor({
  options,
  readOnly,
  maxOptions,
  dndContextId,
  onChange,
  placeholder,
  emptyButtonLabel,
  dragLabel,
  removeOption,
}: {
  options: StructuredFieldOption[];
  readOnly: boolean;
  maxOptions: number;
  dndContextId: string;
  onChange: (nextOptions: StructuredFieldOption[]) => void;
  placeholder: string;
  emptyButtonLabel: string;
  dragLabel: string;
  removeOption: string;
}) {
  const [newOptionLabel, setNewOptionLabel] = useState("");
  const [isCreatingFirstOption, setIsCreatingFirstOption] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const canAddOption = !readOnly && options.length < maxOptions;

  function updateOption(index: number, label: string) {
    onChange(
      options.map((option, optionIndex) =>
        optionIndex === index
          ? {
              ...option,
              label,
            }
          : option,
      ),
    );
  }

  function removeOptionAt(index: number) {
    onChange(options.filter((_, optionIndex) => optionIndex !== index));
  }

  function commitNewOption() {
    const nextLabel = newOptionLabel.trim();
    if (!nextLabel || !canAddOption) {
      setNewOptionLabel(nextLabel);
      return;
    }

    onChange([
      ...options,
      {
        optionKey: buildOptionKey(nextLabel, options),
        label: nextLabel,
        orderIndex: options.length,
      },
    ]);
    setNewOptionLabel("");
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    const activeIndex = options.findIndex((option) => option.optionKey === active.id);
    const overIndex = options.findIndex((option) => option.optionKey === over.id);
    if (activeIndex === -1 || overIndex === -1) {
      return;
    }

    onChange(arrayMove(options, activeIndex, overIndex));
  }

  return (
    <div className="space-y-2">
      {options.length === 0 && !readOnly && !isCreatingFirstOption ? (
        <NewOptionRow
          value={newOptionLabel}
          placeholder={emptyButtonLabel}
          disabled={!canAddOption}
          onChange={setNewOptionLabel}
          onCommit={() => {
            if (!newOptionLabel.trim()) {
              return;
            }

            commitNewOption();
          }}
        />
      ) : null}
      <DndContext
        id={dndContextId}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={options.map((option) => option.optionKey)} strategy={verticalListSortingStrategy}>
          <ol className="space-y-2">
            {options.map((option, index) => (
              <SortableOptionRow
                key={option.optionKey}
                option={option}
                readOnly={readOnly}
                dragLabel={dragLabel}
                removeLabel={removeOption}
                onChange={(label) => updateOption(index, label)}
                onRemove={() => removeOptionAt(index)}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
      {!readOnly && (options.length > 0 || isCreatingFirstOption) ? (
        <NewOptionRow
          value={newOptionLabel}
          placeholder={placeholder}
          disabled={!canAddOption}
          onChange={setNewOptionLabel}
          onCommit={() => {
            if (!newOptionLabel.trim()) {
              setIsCreatingFirstOption(false);
              return;
            }

            commitNewOption();
            setIsCreatingFirstOption(false);
          }}
        />
      ) : null}
    </div>
  );
}

export function TemplateStructuredFieldsEditor({
  definition,
  readOnly,
  onChange,
  strings,
}: TemplateStructuredFieldsEditorProps) {
  if (!definition) {
    return (
      <section className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900">{strings.title}</h2>
          <p className="mt-1 text-sm text-zinc-600">{strings.subtitle}</p>
        </div>
        <p className="text-sm text-zinc-700">{strings.legacyMessage}</p>
      </section>
    );
  }

  function patchScopeOptions(nextOptions: StructuredFieldOption[]) {
    onChange(
      updateDefinition(definition, (current) => ({
        ...current,
        builtInFields: {
          ...current.builtInFields,
          scope: {
            ...current.builtInFields.scope,
            options: reindexOptions(nextOptions),
          },
        },
      })),
    );
  }

  function patchDurationOptions(nextOptions: StructuredFieldOption[]) {
    onChange(
      updateDefinition(definition, (current) => ({
        ...current,
        builtInFields: {
          ...current.builtInFields,
          duration: {
            ...current.builtInFields.duration,
            options: reindexOptions(nextOptions),
          },
        },
      })),
    );
  }

  function patchCustomField(
    index: number,
    updater: (field: StructuredCustomFieldDefinition) => StructuredCustomFieldDefinition,
  ) {
    onChange(
      updateDefinition(definition, (current) => ({
        ...current,
        customFields: current.customFields.map((field, fieldIndex) =>
          fieldIndex === index ? updater(field) : field,
        ),
      })),
    );
  }

  function addCustomField(fieldType: StructuredCustomFieldType) {
    const existingKeys = new Set([
      "scope",
      "duration",
      ...definition.customFields.map((field) => field.fieldKey),
    ]);
    const nextIndex = definition.customFields.length + 1;

    const nextField: StructuredCustomFieldDefinition = {
      fieldKey: buildUniqueKey(`field_${nextIndex}`, existingKeys, "field"),
      fieldType,
      label:
        fieldType === "single_select"
          ? `Dropdown ${nextIndex}`
          : fieldType === "checkbox_list"
            ? `Checkbox list ${nextIndex}`
            : `Text field ${nextIndex}`,
      required: false,
      orderIndex: definition.customFields.length,
      helpText: null,
      placeholder: null,
      maxLength: fieldType === "text_input" ? STRUCTURED_TEXT_INPUT_DEFAULT_MAX_LENGTH : null,
      options: fieldType === "text_input" ? null : [],
    };

    onChange(
      updateDefinition(definition, (current) => ({
        ...current,
        customFields: [...current.customFields, nextField],
      })),
    );
  }

  function removeCustomField(index: number) {
    onChange(
      updateDefinition(definition, (current) => ({
        ...current,
        customFields: current.customFields.filter((_, fieldIndex) => fieldIndex !== index),
      })),
    );
  }

  const canAddCustomField =
    !readOnly && definition.customFields.length < STRUCTURED_CUSTOM_FIELDS_MAX_COUNT;
  const canAddScopeOption =
    !readOnly && definition.builtInFields.scope.options.length < STRUCTURED_SCOPE_OPTIONS_MAX_COUNT;
  const canAddDurationOption =
    !readOnly &&
    definition.builtInFields.duration.options.length < STRUCTURED_DURATION_OPTIONS_MAX_COUNT;

  return (
    <section className="space-y-4 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900">{strings.title}</h2>
        {strings.subtitle ? <p className="mt-1 text-sm text-zinc-600">{strings.subtitle}</p> : null}
      </div>

      <div className="space-y-4 rounded-xl border border-zinc-200 bg-white p-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">{strings.builtInFieldsTitle}</h3>
        </div>

        <section className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium text-zinc-900">{strings.scopeFieldTitle}</h4>
            <span className="text-xs font-medium text-zinc-600">{strings.requiredValue}</span>
          </div>
          {strings.scopeFieldDescription ? (
            <p className="text-sm text-zinc-600">{strings.scopeFieldDescription}</p>
          ) : null}
          <OptionsEditor
            options={definition.builtInFields.scope.options}
            readOnly={readOnly}
            maxOptions={STRUCTURED_SCOPE_OPTIONS_MAX_COUNT}
            dndContextId="structured-options-scope"
            onChange={patchScopeOptions}
            placeholder={strings.addScopeOption}
            emptyButtonLabel={strings.addScopeOption}
            dragLabel={strings.dragHandle}
            removeOption={strings.removeOption}
          />
          {!readOnly && !canAddScopeOption ? (
            <p className="text-xs text-zinc-600">
              {STRUCTURED_SCOPE_OPTIONS_MAX_COUNT} / {STRUCTURED_SCOPE_OPTIONS_MAX_COUNT}
            </p>
          ) : null}
        </section>

        <section className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-medium text-zinc-900">{strings.durationFieldTitle}</h4>
            <span className="text-xs font-medium text-zinc-600">{strings.requiredValue}</span>
          </div>
          {strings.durationFieldDescription ? (
            <p className="text-sm text-zinc-600">{strings.durationFieldDescription}</p>
          ) : null}
          <OptionsEditor
            options={definition.builtInFields.duration.options}
            readOnly={readOnly}
            maxOptions={STRUCTURED_DURATION_OPTIONS_MAX_COUNT}
            dndContextId="structured-options-duration"
            onChange={patchDurationOptions}
            placeholder={strings.addDurationOption}
            emptyButtonLabel={strings.addDurationOption}
            dragLabel={strings.dragHandle}
            removeOption={strings.removeOption}
          />
          {!readOnly && !canAddDurationOption ? (
            <p className="text-xs text-zinc-600">
              {STRUCTURED_DURATION_OPTIONS_MAX_COUNT} / {STRUCTURED_DURATION_OPTIONS_MAX_COUNT}
            </p>
          ) : null}
        </section>
      </div>

      <div className="space-y-4 rounded-xl border border-zinc-200 bg-white p-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">{strings.customFieldsTitle}</h3>
          {definition.customFields.length === 0 && strings.customFieldsEmpty ? (
            <p className="mt-1 text-sm text-zinc-600">{strings.customFieldsEmpty}</p>
          ) : null}
        </div>

        {definition.customFields.map((field, index) => (
          <section key={`${field.fieldKey}-${index}`} className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-start">
              <label className="block text-sm text-zinc-800">
                <input
                  aria-label={strings.fieldLabelField}
                  value={field.label}
                  onChange={(event) => patchCustomField(index, (current) => ({ ...current, label: event.target.value }))}
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5"
                  maxLength={120}
                  disabled={readOnly}
                  placeholder={strings.fieldLabelField}
                />
              </label>
              <label className="block text-sm text-zinc-800">
                <select
                  aria-label={strings.fieldTypeField}
                  value={field.fieldType}
                  onChange={(event) =>
                    patchCustomField(index, (current) => {
                      const nextType = event.target.value as StructuredCustomFieldType;
                      return {
                        ...current,
                        fieldType: nextType,
                        options: nextType === "text_input" ? null : current.options ?? [],
                        placeholder: nextType === "text_input" ? current.placeholder : null,
                        maxLength:
                          nextType === "text_input"
                            ? current.maxLength ?? STRUCTURED_TEXT_INPUT_DEFAULT_MAX_LENGTH
                            : null,
                      };
                    })
                  }
                  className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5"
                  disabled={readOnly}
                >
                  <option value="single_select">{strings.typeSingleSelect}</option>
                  <option value="checkbox_list">{strings.typeCheckboxList}</option>
                  <option value="text_input">{strings.typeTextInput}</option>
                </select>
              </label>
              {!readOnly ? (
                <button
                  type="button"
                  onClick={() => removeCustomField(index)}
                  className="flex h-10 w-10 self-center items-center justify-center rounded-lg border border-zinc-300 bg-white text-zinc-950 hover:bg-zinc-100 sm:self-end"
                  aria-label={strings.removeField}
                  title={strings.removeField}
                >
                  <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 stroke-current" fill="none">
                    <path d="M3.75 4.5h8.5" strokeWidth="1.5" strokeLinecap="round" />
                    <path
                      d="M5.25 4.5v7.25c0 .41.34.75.75.75h4c.41 0 .75-.34.75-.75V4.5"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                    />
                    <path d="M6.25 4.5V3.75c0-.41.34-.75.75-.75h2c.41 0 .75.34.75.75v.75" strokeWidth="1.5" />
                  </svg>
                </button>
              ) : null}
            </div>

            <label className="flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-2.5 text-sm text-zinc-800">
              <input
                type="checkbox"
                checked={field.required}
                onChange={(event) =>
                  patchCustomField(index, (current) => ({ ...current, required: event.target.checked }))
                }
                disabled={readOnly}
              />
              <span>{strings.requiredFieldLabel}</span>
            </label>

            <label className="block text-sm text-zinc-800">
              <span className="mb-1 block font-medium">{strings.helpTextField}</span>
              <textarea
                value={field.helpText ?? ""}
                onChange={(event) =>
                  patchCustomField(index, (current) => ({
                    ...current,
                    helpText: event.target.value.trim() ? event.target.value : null,
                  }))
                }
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5"
                rows={2}
                maxLength={280}
                disabled={readOnly}
              />
            </label>

            {field.fieldType === "text_input" ? (
              <div>
                <label className="block text-sm text-zinc-800">
                  <span className="mb-1 block font-medium">{strings.placeholderField}</span>
                  <input
                    value={field.placeholder ?? ""}
                    onChange={(event) =>
                      patchCustomField(index, (current) => ({
                        ...current,
                        placeholder: event.target.value.trim() ? event.target.value : null,
                      }))
                    }
                    className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5"
                    maxLength={120}
                    disabled={readOnly}
                  />
                </label>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-sm font-medium text-zinc-900">{strings.optionsField}</p>
                <OptionsEditor
                  options={field.options ?? []}
                  readOnly={readOnly}
                  maxOptions={STRUCTURED_FIELD_OPTIONS_MAX_COUNT}
                  dndContextId={`structured-options-${field.fieldKey}`}
                  onChange={(nextOptions) =>
                    patchCustomField(index, (current) => ({
                      ...current,
                      options: reindexOptions(nextOptions),
                    }))
                  }
                  placeholder={strings.addOption}
                  emptyButtonLabel={strings.addOption}
                  dragLabel={strings.dragHandle}
                  removeOption={strings.removeOption}
                />
              </div>
            )}
          </section>
        ))}

        {!readOnly ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => addCustomField("single_select")}
              disabled={!canAddCustomField}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-100 disabled:opacity-60"
            >
              {strings.addSingleSelectField}
            </button>
            <button
              type="button"
              onClick={() => addCustomField("checkbox_list")}
              disabled={!canAddCustomField}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-100 disabled:opacity-60"
            >
              {strings.addCheckboxListField}
            </button>
            <button
              type="button"
              onClick={() => addCustomField("text_input")}
              disabled={!canAddCustomField}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-100 disabled:opacity-60"
            >
              {strings.addTextInputField}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
