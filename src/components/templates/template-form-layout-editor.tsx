"use client";

import type { CSSProperties } from "react";

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
  getFormLayoutBlockId,
  type ConsentFormLayoutBlock,
  type ConsentFormLayoutDefinition,
} from "@/lib/templates/form-layout";
import type { StructuredFieldsDefinition } from "@/lib/templates/structured-fields";

type TemplateFormLayoutEditorStrings = {
  title: string;
  subtitle: string;
  allowFaceMatchLabel: string;
  systemBadge: string;
  builtInBadge: string;
  customBadge: string;
  dragHandle: string;
  subjectNameLabel: string;
  subjectEmailLabel: string;
  scopeLabel: string;
  durationLabel: string;
  faceMatchLabel: string;
  consentTextLabel: string;
};

type TemplateFormLayoutEditorProps = {
  definition: ConsentFormLayoutDefinition;
  structuredFieldsDefinition: StructuredFieldsDefinition | null;
  readOnly: boolean;
  onChange: (definition: ConsentFormLayoutDefinition) => void;
  strings: TemplateFormLayoutEditorStrings;
};

function getBlockLabel(
  block: ConsentFormLayoutBlock,
  structuredFieldsDefinition: StructuredFieldsDefinition | null,
  strings: TemplateFormLayoutEditorStrings,
) {
  if (block.kind === "system") {
    switch (block.key) {
      case "subject_name":
        return strings.subjectNameLabel;
      case "subject_email":
        return strings.subjectEmailLabel;
      case "face_match_section":
        return strings.faceMatchLabel;
      case "consent_text":
        return strings.consentTextLabel;
      default:
        return block.key;
    }
  }

  if (block.kind === "built_in") {
    return block.key === "scope" ? strings.scopeLabel : strings.durationLabel;
  }

  return (
    structuredFieldsDefinition?.customFields.find((field) => field.fieldKey === block.fieldKey)?.label ??
    block.fieldKey
  );
}

function getBlockBadge(block: ConsentFormLayoutBlock, strings: TemplateFormLayoutEditorStrings) {
  if (block.kind === "system") {
    return strings.systemBadge;
  }

  if (block.kind === "built_in") {
    return strings.builtInBadge;
  }

  return strings.customBadge;
}

function SortableBlockRow({
  block,
  structuredFieldsDefinition,
  strings,
  readOnly,
}: {
  block: ConsentFormLayoutBlock;
  structuredFieldsDefinition: StructuredFieldsDefinition | null;
  strings: TemplateFormLayoutEditorStrings;
  readOnly: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: getFormLayoutBlockId(block),
    disabled: readOnly,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className="flex items-center justify-between gap-3 rounded-lg border border-zinc-200 bg-white px-3 py-3 text-sm"
    >
      <div className="min-w-0">
        <p className="font-medium text-zinc-900">{getBlockLabel(block, structuredFieldsDefinition, strings)}</p>
        <p className="text-xs text-zinc-500">{getBlockBadge(block, strings)}</p>
      </div>
      <button
        type="button"
        className="rounded-md border border-zinc-300 p-2 text-zinc-700 disabled:opacity-50"
        aria-label={strings.dragHandle}
        title={strings.dragHandle}
        disabled={readOnly}
        {...attributes}
        {...listeners}
      >
        <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 fill-current">
          <circle cx="5" cy="3" r="1.25" />
          <circle cx="5" cy="8" r="1.25" />
          <circle cx="5" cy="13" r="1.25" />
          <circle cx="11" cy="3" r="1.25" />
          <circle cx="11" cy="8" r="1.25" />
          <circle cx="11" cy="13" r="1.25" />
        </svg>
      </button>
    </li>
  );
}

export function TemplateFormLayoutEditor({
  definition,
  structuredFieldsDefinition,
  readOnly,
  onChange,
  strings,
}: TemplateFormLayoutEditorProps) {
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

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    const activeIndex = definition.blocks.findIndex((block) => getFormLayoutBlockId(block) === active.id);
    const overIndex = definition.blocks.findIndex((block) => getFormLayoutBlockId(block) === over.id);
    if (activeIndex === -1 || overIndex === -1) {
      return;
    }

    onChange({
      schemaVersion: definition.schemaVersion,
      blocks: arrayMove(definition.blocks, activeIndex, overIndex),
    });
  }

  const faceMatchEnabled = definition.blocks.some(
    (block) => block.kind === "system" && block.key === "face_match_section",
  );

  function handleFaceMatchToggle(enabled: boolean) {
    const faceMatchBlock = { kind: "system", key: "face_match_section" } as const;

    if (enabled) {
      const consentTextIndex = definition.blocks.findIndex(
        (block) => block.kind === "system" && block.key === "consent_text",
      );
      const nextBlocks = [...definition.blocks];
      const insertionIndex = consentTextIndex === -1 ? nextBlocks.length : consentTextIndex;
      nextBlocks.splice(insertionIndex, 0, faceMatchBlock);

      onChange({
        schemaVersion: definition.schemaVersion,
        blocks: nextBlocks,
      });
      return;
    }

    onChange({
      schemaVersion: definition.schemaVersion,
      blocks: definition.blocks.filter(
        (block) => !(block.kind === "system" && block.key === "face_match_section"),
      ),
    });
  }

  return (
    <section className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
      <div>
        <h2 className="text-sm font-semibold text-zinc-900">{strings.title}</h2>
        <p className="mt-1 text-xs text-zinc-600">{strings.subtitle}</p>
      </div>

      <label className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-3 text-sm text-zinc-800">
        <input
          type="checkbox"
          checked={faceMatchEnabled}
          disabled={readOnly}
          onChange={(event) => handleFaceMatchToggle(event.target.checked)}
        />
        <span>{strings.allowFaceMatchLabel}</span>
      </label>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext
          items={definition.blocks.map(getFormLayoutBlockId)}
          strategy={verticalListSortingStrategy}
        >
          <ol className="space-y-2">
            {definition.blocks.map((block) => (
              <SortableBlockRow
                key={getFormLayoutBlockId(block)}
                block={block}
                structuredFieldsDefinition={structuredFieldsDefinition}
                strings={strings}
                readOnly={readOnly}
              />
            ))}
          </ol>
        </SortableContext>
      </DndContext>
    </section>
  );
}
