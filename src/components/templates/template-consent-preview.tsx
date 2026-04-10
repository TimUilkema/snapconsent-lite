"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

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

import { ConsentFormBlockRenderer } from "@/components/consent/consent-form-block-renderer";
import { ConsentTextBlock } from "@/components/consent/consent-form-layout-renderer";
import {
  getFormLayoutBlockId,
  type ConsentFormLayoutBlock,
  type ConsentFormLayoutDefinition,
} from "@/lib/templates/form-layout";
import {
  getStructuredFieldByKey,
  type StructuredFieldsDefinition,
} from "@/lib/templates/structured-fields";

type TemplateConsentPreviewStrings = {
  title: string;
  formTitle: string;
  formSubtitle: string;
  fullNameLabel: string;
  emailLabel: string;
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
  mockHeadshotLabel: string;
  validateButton: string;
  validatingButton: string;
  saveButton: string;
  saveAriaLabel: string;
  archiveAriaLabel: string;
  dragHandle: string;
  validState: string;
  invalidState: string;
  configurationErrorTitle: string;
  fieldErrorRequired: string;
  fieldErrorInvalid: string;
  fieldErrorHeadshotRequired: string;
  subjectNameLabel: string;
  subjectEmailLabel: string;
  scopeLabel: string;
  durationLabel: string;
  faceMatchLabel: string;
  consentTextLabel: string;
};

type TemplateConsentPreviewProps = {
  templateId: string;
  templateName: string;
  consentText: string;
  structuredFieldsDefinition: StructuredFieldsDefinition | null;
  formLayoutDefinition: ConsentFormLayoutDefinition;
  strings: TemplateConsentPreviewStrings;
  canEdit: boolean;
  canArchive: boolean;
  isSaving: boolean;
  isArchiving: boolean;
  onSave: () => void;
  onArchive: () => void;
  onLayoutChange: (definition: ConsentFormLayoutDefinition) => void;
};

type PreviewResponse = {
  valid: boolean;
  configurationErrors: string[];
  fieldErrors: Record<string, string>;
};

function toUserFacingError(code: string, strings: TemplateConsentPreviewStrings) {
  switch (code) {
    case "required":
      return strings.fieldErrorRequired;
    case "invalid":
      return strings.fieldErrorInvalid;
    case "headshot_required":
      return strings.fieldErrorHeadshotRequired;
    default:
      return code;
  }
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

function SaveIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 stroke-current" fill="none">
      <path d="M3 2.75h8l2.25 2.25v8.25H2.75V2.75H3z" strokeWidth="1.25" />
      <path d="M5 2.75h4v3H5z" strokeWidth="1.25" />
      <path d="M5 10.25h6" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

function ArchiveIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="h-4 w-4 stroke-current" fill="none">
      <path d="M2.75 4.25h10.5v8.5H2.75z" strokeWidth="1.25" />
      <path d="M2 2.75h12v2H2z" strokeWidth="1.25" />
      <path d="M6 7.75h4" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

function getBlockLabel(
  block: ConsentFormLayoutBlock,
  structuredFieldsDefinition: StructuredFieldsDefinition | null,
  strings: TemplateConsentPreviewStrings,
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

function getHandleLayoutMode(
  block: ConsentFormLayoutBlock,
  structuredFieldsDefinition: StructuredFieldsDefinition | null,
) {
  if (block.kind === "system") {
    if (block.key === "face_match_section" || block.key === "consent_text") {
      return "stretch";
    }

    return "subject_input";
  }

  if (!structuredFieldsDefinition) {
    return "field_input";
  }

  const field = getStructuredFieldByKey(
    structuredFieldsDefinition,
    block.kind === "custom_field" ? block.fieldKey : block.key,
  );

  if (!field) {
    return "field_input";
  }

  return "field_input";
}

function SortablePreviewRailItem({
  block,
  structuredFieldsDefinition,
  strings,
  disabled,
  layoutMode,
}: {
  block: ConsentFormLayoutBlock;
  structuredFieldsDefinition: StructuredFieldsDefinition | null;
  strings: TemplateConsentPreviewStrings;
  disabled: boolean;
  layoutMode: "subject_input" | "field_input" | "stretch";
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: getFormLayoutBlockId(block),
    disabled,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={
        layoutMode === "stretch"
          ? "flex h-full items-stretch"
          : layoutMode === "subject_input"
            ? "flex items-start pt-6"
            : "flex items-start pt-7"
      }
    >
      <button
        type="button"
        className={[
          "flex w-full items-center justify-center rounded-xl border border-zinc-300 bg-white p-2 text-zinc-600 hover:bg-zinc-100 disabled:opacity-50",
          layoutMode === "stretch" ? "h-full min-h-[56px]" : "h-11",
        ].join(" ")}
        aria-label={`${strings.dragHandle}: ${getBlockLabel(block, structuredFieldsDefinition, strings)}`}
        title={getBlockLabel(block, structuredFieldsDefinition, strings)}
        disabled={disabled}
        {...attributes}
        {...listeners}
      >
        <DragHandleIcon />
      </button>
    </div>
  );
}

function PreviewBlockRow({
  block,
  consentText,
  structuredFieldsDefinition,
  strings,
  values,
  errors,
  disabled,
  onSubjectNameChange,
  onSubjectEmailChange,
  onConsentAcknowledgedChange,
  onStructuredFieldChange,
  onFaceMatchOptInChange,
  faceMatchDetails,
}: {
  block: ConsentFormLayoutBlock;
  consentText: string;
  structuredFieldsDefinition: StructuredFieldsDefinition | null;
  strings: TemplateConsentPreviewStrings;
  values: {
    subjectName: string;
    subjectEmail: string;
    consentAcknowledged: boolean;
    faceMatchOptIn: boolean;
    structuredFieldValues: Record<string, string | string[] | null | undefined>;
  };
  errors: Record<string, string>;
  disabled: boolean;
  onSubjectNameChange: (value: string) => void;
  onSubjectEmailChange: (value: string) => void;
  onConsentAcknowledgedChange: (value: boolean) => void;
  onStructuredFieldChange: (fieldKey: string, value: string | string[] | null) => void;
  onFaceMatchOptInChange: (value: boolean) => void;
  faceMatchDetails: ReactNode;
}) {
  const mappedErrors = Object.fromEntries(
    Object.entries(errors).map(([fieldKey, code]) => [fieldKey, toUserFacingError(code, strings)]),
  );
  const layoutMode = getHandleLayoutMode(block, structuredFieldsDefinition);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_36px] items-start gap-2">
      <div className="min-w-0">
        {block.kind === "system" && block.key === "consent_text" ? (
          <ConsentTextBlock
            consentText={consentText}
            strings={{
              fullNameLabel: strings.fullNameLabel,
              emailLabel: strings.emailLabel,
              scopeLabel: strings.scopeLabel,
              durationLabel: strings.durationLabel,
              requiredField: strings.requiredField,
              selectPlaceholder: strings.selectPlaceholder,
              emptySelectionOption: strings.emptySelectionOption,
              emptyCheckboxOptionLabel: strings.emptyCheckboxOptionLabel,
              faceMatchOptIn: strings.faceMatchOptIn,
              headshotRequiredTitle: strings.headshotRequiredTitle,
              headshotRequiredBody: strings.headshotRequiredBody,
              consentTextHeading: strings.consentTextHeading,
              consentTextUnavailable: strings.consentTextUnavailable,
              consentAcknowledgementLabel: strings.consentAcknowledgementLabel,
            }}
            values={values}
            errors={mappedErrors}
            disabled={disabled}
            onConsentAcknowledgedChange={onConsentAcknowledgedChange}
          />
        ) : (
          <ConsentFormBlockRenderer
            block={block}
            structuredFieldsDefinition={structuredFieldsDefinition}
            strings={{
              fullNameLabel: strings.fullNameLabel,
              emailLabel: strings.emailLabel,
              scopeLabel: strings.scopeLabel,
              durationLabel: strings.durationLabel,
              requiredField: strings.requiredField,
              selectPlaceholder: strings.selectPlaceholder,
              emptySelectionOption: strings.emptySelectionOption,
              emptyCheckboxOptionLabel: strings.emptyCheckboxOptionLabel,
              faceMatchOptIn: strings.faceMatchOptIn,
              headshotRequiredTitle: strings.headshotRequiredTitle,
              headshotRequiredBody: strings.headshotRequiredBody,
              consentTextHeading: strings.consentTextHeading,
              consentTextUnavailable: strings.consentTextUnavailable,
              consentAcknowledgementLabel: strings.consentAcknowledgementLabel,
            }}
            values={values}
            errors={mappedErrors}
            onSubjectNameChange={onSubjectNameChange}
            onSubjectEmailChange={onSubjectEmailChange}
            onStructuredFieldChange={onStructuredFieldChange}
            onFaceMatchOptInChange={onFaceMatchOptInChange}
            faceMatchDetails={faceMatchDetails}
          />
        )}
      </div>
      <SortablePreviewRailItem
        block={block}
        structuredFieldsDefinition={structuredFieldsDefinition}
        strings={strings}
        disabled={disabled}
        layoutMode={layoutMode}
      />
    </div>
  );
}

export function TemplateConsentPreview({
  templateId,
  templateName,
  consentText,
  structuredFieldsDefinition,
  formLayoutDefinition,
  strings,
  canEdit,
  canArchive,
  isSaving,
  isArchiving,
  onSave,
  onArchive,
  onLayoutChange,
}: TemplateConsentPreviewProps) {
  const [subjectName, setSubjectName] = useState("");
  const [subjectEmail, setSubjectEmail] = useState("");
  const [consentAcknowledged, setConsentAcknowledged] = useState(false);
  const [faceMatchOptIn, setFaceMatchOptIn] = useState(false);
  const [hasMockHeadshot, setHasMockHeadshot] = useState(false);
  const [structuredFieldValues, setStructuredFieldValues] = useState<
    Record<string, string | string[] | null | undefined>
  >({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [configurationErrors, setConfigurationErrors] = useState<string[]>([]);
  const [isValidating, setIsValidating] = useState(false);
  const [isValid, setIsValid] = useState<boolean | null>(null);
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

  useEffect(() => {
    const validFieldKeys = new Set<string>();
    if (structuredFieldsDefinition) {
      structuredFieldsDefinition.customFields.forEach((field) => validFieldKeys.add(field.fieldKey));
      validFieldKeys.add("scope");
      validFieldKeys.add("duration");
    }

    setStructuredFieldValues((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([fieldKey]) => validFieldKeys.has(fieldKey)),
      ),
    );
    setFieldErrors((current) =>
      Object.fromEntries(
        Object.entries(current).filter(([fieldKey]) => {
          if (
            fieldKey === "subject_name" ||
            fieldKey === "subject_email" ||
            fieldKey === "consent_acknowledged" ||
            fieldKey === "face_match_section"
          ) {
            return true;
          }

          return validFieldKeys.has(fieldKey);
        }),
      ),
    );
  }, [structuredFieldsDefinition]);

  async function handleValidate() {
    setIsValidating(true);
    setConfigurationErrors([]);

    try {
      const response = await fetch(`/api/templates/${templateId}/preview-validate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          structuredFieldsDefinition,
          formLayoutDefinition,
          previewValues: {
            subjectName,
            subjectEmail,
            consentAcknowledged,
            faceMatchOptIn,
            hasMockHeadshot,
            structuredFieldValues,
          },
        }),
      });

      const payload = (await response.json().catch(() => null)) as PreviewResponse | null;
      if (!response.ok || !payload) {
        setIsValid(false);
        setConfigurationErrors(["preview_validation_failed"]);
        return;
      }

      setIsValid(payload.valid);
      setConfigurationErrors(payload.configurationErrors);
      setFieldErrors(payload.fieldErrors);
    } catch {
      setIsValid(false);
      setConfigurationErrors(["preview_validation_failed"]);
    } finally {
      setIsValidating(false);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) {
      return;
    }

    const activeIndex = formLayoutDefinition.blocks.findIndex(
      (block) => getFormLayoutBlockId(block) === active.id,
    );
    const overIndex = formLayoutDefinition.blocks.findIndex(
      (block) => getFormLayoutBlockId(block) === over.id,
    );
    if (activeIndex === -1 || overIndex === -1) {
      return;
    }

    onLayoutChange({
      schemaVersion: formLayoutDefinition.schemaVersion,
      blocks: arrayMove(formLayoutDefinition.blocks, activeIndex, overIndex),
    });
  }

  return (
    <section className="space-y-4 rounded-xl border border-zinc-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-900">{strings.title}</h2>
        </div>
        <div className="flex items-center gap-2">
          {canArchive ? (
            <button
              type="button"
              onClick={onArchive}
              disabled={isArchiving || isSaving || isValidating}
              className="flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 disabled:opacity-60"
              aria-label={strings.archiveAriaLabel}
              title={strings.archiveAriaLabel}
            >
              <ArchiveIcon />
            </button>
          ) : null}
          {isValid === null ? null : (
            <p
              className={[
                "rounded-full px-2.5 py-1 text-xs font-medium",
                isValid ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800",
              ].join(" ")}
            >
              {isValid ? strings.validState : strings.invalidState}
            </p>
          )}
        </div>
      </div>

      {configurationErrors.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <p className="font-medium">{strings.configurationErrorTitle}</p>
          <ul className="mt-2 space-y-1">
            {configurationErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
        <div className="space-y-4">
          <div className="flex flex-col gap-2">
            <h3 className="text-2xl font-semibold tracking-tight text-zinc-900">{strings.formTitle}</h3>
            <p className="text-sm text-zinc-700">{strings.formSubtitle || templateName}</p>
          </div>

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext
              items={formLayoutDefinition.blocks.map(getFormLayoutBlockId)}
              strategy={verticalListSortingStrategy}
            >
              <div className="content-card space-y-3 rounded-2xl p-4 sm:p-5">
                {formLayoutDefinition.blocks.map((block) => (
                  <PreviewBlockRow
                    key={getFormLayoutBlockId(block)}
                    block={block}
                    consentText={consentText}
                    structuredFieldsDefinition={structuredFieldsDefinition}
                    strings={strings}
                    values={{
                      subjectName,
                      subjectEmail,
                      consentAcknowledged,
                      faceMatchOptIn,
                      structuredFieldValues,
                    }}
                    errors={fieldErrors}
                    disabled={!canEdit}
                    onSubjectNameChange={(value) => {
                      setSubjectName(value);
                      setFieldErrors((current) => {
                        const next = { ...current };
                        delete next.subject_name;
                        return next;
                      });
                    }}
                    onSubjectEmailChange={(value) => {
                      setSubjectEmail(value);
                      setFieldErrors((current) => {
                        const next = { ...current };
                        delete next.subject_email;
                        return next;
                      });
                    }}
                    onConsentAcknowledgedChange={(value) => {
                      setConsentAcknowledged(value);
                      setFieldErrors((current) => {
                        const next = { ...current };
                        delete next.consent_acknowledged;
                        return next;
                      });
                    }}
                    onStructuredFieldChange={(fieldKey, value) => {
                      setStructuredFieldValues((current) => ({
                        ...current,
                        [fieldKey]: value,
                      }));
                      setFieldErrors((current) => {
                        const next = { ...current };
                        delete next[fieldKey];
                        return next;
                      });
                    }}
                    onFaceMatchOptInChange={(value) => {
                      setFaceMatchOptIn(value);
                      if (!value) {
                        setHasMockHeadshot(false);
                      }
                      setFieldErrors((current) => {
                        const next = { ...current };
                        delete next.face_match_section;
                        return next;
                      });
                    }}
                    faceMatchDetails={
                      <label className="flex items-center gap-2 text-xs text-zinc-800">
                        <input
                          type="checkbox"
                          checked={hasMockHeadshot}
                          onChange={(event) => {
                            setHasMockHeadshot(event.target.checked);
                            setFieldErrors((current) => {
                              const next = { ...current };
                              delete next.face_match_section;
                              return next;
                            });
                          }}
                        />
                        <span>{strings.mockHeadshotLabel}</span>
                      </label>
                    }
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => void handleValidate()}
          disabled={isValidating || isSaving || isArchiving}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
        >
          {isValidating ? strings.validatingButton : strings.validateButton}
        </button>
        {canEdit ? (
          <button
            type="button"
            onClick={onSave}
            disabled={isSaving || isValidating || isArchiving}
            className="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
          >
            <SaveIcon />
            <span>{strings.saveButton}</span>
          </button>
        ) : null}
      </div>
    </section>
  );
}
