"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { TemplateConsentPreview } from "@/components/templates/template-consent-preview";
import { TemplateStructuredFieldsEditor } from "@/components/templates/template-structured-fields-editor";
import { createIdempotencyKey } from "@/lib/client/idempotency-key";
import { resolveLocalizedApiError } from "@/lib/i18n/error-message";
import { reconcileFormLayoutDefinition, type ConsentFormLayoutDefinition } from "@/lib/templates/form-layout";
import { createStarterStructuredFieldsDefinition } from "@/lib/templates/structured-fields";
import type { TemplateDetail } from "@/lib/templates/template-service";

type TemplateDetailClientProps = {
  template: TemplateDetail;
};

type TemplateActionResponse = {
  template?: {
    id: string;
  };
  error?: string;
  message?: string;
};

type PersistedTemplateEditorDraft = {
  version: 1;
  templateId: string;
  sourceUpdatedAt: string;
  name: string;
  body: string;
  structuredFieldsDefinition: TemplateDetail["structuredFieldsDefinition"];
  formLayoutDefinition: TemplateDetail["formLayoutDefinition"];
};

function getTemplateEditorDraftStorageKey(templateId: string) {
  return `template-editor-draft:${templateId}`;
}

function parsePersistedTemplateEditorDraft(rawValue: string | null): PersistedTemplateEditorDraft | null {
  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as Partial<PersistedTemplateEditorDraft> | null;
    if (
      !parsed ||
      parsed.version !== 1 ||
      typeof parsed.templateId !== "string" ||
      typeof parsed.sourceUpdatedAt !== "string" ||
      typeof parsed.name !== "string" ||
      typeof parsed.body !== "string" ||
      !("structuredFieldsDefinition" in parsed) ||
      !("formLayoutDefinition" in parsed)
    ) {
      return null;
    }

    return parsed as PersistedTemplateEditorDraft;
  } catch {
    return null;
  }
}

function getEditableStructuredDefinition(template: TemplateDetail) {
  if (template.structuredFieldsDefinition) {
    return template.structuredFieldsDefinition;
  }

  return template.canEdit ? createStarterStructuredFieldsDefinition() : null;
}

function isFaceMatchEnabled(definition: ConsentFormLayoutDefinition) {
  return definition.blocks.some(
    (block) => block.kind === "system" && block.key === "face_match_section",
  );
}

function setFaceMatchEnabled(
  definition: ConsentFormLayoutDefinition,
  enabled: boolean,
): ConsentFormLayoutDefinition {
  if (enabled) {
    if (isFaceMatchEnabled(definition)) {
      return definition;
    }

    const consentTextIndex = definition.blocks.findIndex(
      (block) => block.kind === "system" && block.key === "consent_text",
    );
    const nextBlocks = [...definition.blocks];
    const insertionIndex = consentTextIndex === -1 ? nextBlocks.length : consentTextIndex;
    nextBlocks.splice(insertionIndex, 0, { kind: "system", key: "face_match_section" });

    return {
      schemaVersion: definition.schemaVersion,
      blocks: nextBlocks,
    };
  }

  return {
    schemaVersion: definition.schemaVersion,
    blocks: definition.blocks.filter(
      (block) => !(block.kind === "system" && block.key === "face_match_section"),
    ),
  };
}

export function TemplateDetailClient({ template }: TemplateDetailClientProps) {
  const t = useTranslations("templates.detail");
  const tInvite = useTranslations("publicInvite");
  const tPublic = useTranslations("publicInvite.form");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const editableStructuredDefinition = useMemo(() => getEditableStructuredDefinition(template), [template]);
  const draftStorageKey = getTemplateEditorDraftStorageKey(template.id);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isCreatingVersion, setIsCreatingVersion] = useState(false);
  const [hasLoadedPersistedDraft, setHasLoadedPersistedDraft] = useState(false);
  const [name, setName] = useState(template.name);
  const [body, setBody] = useState(template.body);
  const [structuredFieldsDefinition, setStructuredFieldsDefinition] = useState(editableStructuredDefinition);
  const [formLayoutDefinition, setFormLayoutDefinition] = useState(template.formLayoutDefinition);

  useEffect(() => {
    if (!template.canEdit || typeof window === "undefined") {
      setName(template.name);
      setBody(template.body);
      setStructuredFieldsDefinition(editableStructuredDefinition);
      setFormLayoutDefinition(template.formLayoutDefinition);
      setHasLoadedPersistedDraft(true);
      return;
    }

    const persistedDraft = parsePersistedTemplateEditorDraft(window.localStorage.getItem(draftStorageKey));
    if (
      persistedDraft &&
      persistedDraft.templateId === template.id &&
      persistedDraft.sourceUpdatedAt === template.updatedAt
    ) {
      setName(persistedDraft.name);
      setBody(persistedDraft.body);
      setStructuredFieldsDefinition(persistedDraft.structuredFieldsDefinition);
      setFormLayoutDefinition(persistedDraft.formLayoutDefinition);
      setHasLoadedPersistedDraft(true);
      return;
    }

    if (persistedDraft) {
      window.localStorage.removeItem(draftStorageKey);
    }

    setName(template.name);
    setBody(template.body);
    setStructuredFieldsDefinition(editableStructuredDefinition);
    setFormLayoutDefinition(template.formLayoutDefinition);
    setHasLoadedPersistedDraft(true);
  }, [
    draftStorageKey,
    template.id,
    template.canEdit,
    template.updatedAt,
    template.name,
    template.body,
    template.formLayoutDefinition,
    editableStructuredDefinition,
  ]);

  useEffect(() => {
    if (!template.canEdit || !hasLoadedPersistedDraft || typeof window === "undefined") {
      return;
    }

    const persistedDraft: PersistedTemplateEditorDraft = {
      version: 1,
      templateId: template.id,
      sourceUpdatedAt: template.updatedAt,
      name,
      body,
      structuredFieldsDefinition,
      formLayoutDefinition,
    };

    window.localStorage.setItem(draftStorageKey, JSON.stringify(persistedDraft));
  }, [
    body,
    draftStorageKey,
    formLayoutDefinition,
    hasLoadedPersistedDraft,
    name,
    structuredFieldsDefinition,
    template.canEdit,
    template.id,
    template.updatedAt,
  ]);

  function clearPersistedDraft() {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.removeItem(draftStorageKey);
  }

  async function saveDraft() {
    setError(null);
    setIsSaving(true);

    try {
      const response = await fetch(`/api/templates/${template.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: name.trim(),
          body: body.trim(),
          structuredFieldsDefinition,
          formLayoutDefinition,
        }),
      });

      const payload = (await response.json().catch(() => null)) as TemplateActionResponse | null;
      if (!response.ok) {
        setError(resolveLocalizedApiError(tErrors, payload, "generic"));
        return;
      }

      clearPersistedDraft();
      router.refresh();
    } catch {
      setError(tErrors("generic"));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await saveDraft();
  }

  async function postAction(path: string, mode: "publish" | "archive" | "version") {
    setError(null);

    if (mode === "publish") {
      setIsPublishing(true);
    }
    if (mode === "archive") {
      setIsArchiving(true);
    }
    if (mode === "version") {
      setIsCreatingVersion(true);
    }

    try {
      const headers: Record<string, string> = {};
      if (mode === "version") {
        headers["Idempotency-Key"] = createIdempotencyKey();
      }

      const response = await fetch(path, {
        method: "POST",
        headers,
      });

      const payload = (await response.json().catch(() => null)) as TemplateActionResponse | null;
      if (!response.ok) {
        setError(resolveLocalizedApiError(tErrors, payload, "generic"));
        return;
      }

      clearPersistedDraft();

      if (mode === "version" && payload?.template?.id) {
        router.push(`/templates/${payload.template.id}`);
        return;
      }

      router.refresh();
    } catch {
      setError(tErrors("generic"));
    } finally {
      setIsPublishing(false);
      setIsArchiving(false);
      setIsCreatingVersion(false);
    }
  }

  const readOnly = !template.canEdit;
  const faceMatchEnabled = isFaceMatchEnabled(formLayoutDefinition);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)] xl:items-start">
        <form onSubmit={handleSave} className="content-card space-y-4 rounded-xl p-5">
          <label className="block text-sm text-zinc-800">
            <span className="mb-1 block font-medium">{t("nameField")}</span>
            <input
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2.5"
              disabled={readOnly}
            />
          </label>

          <label className="block text-sm text-zinc-800">
            <span className="mb-1 block font-medium">{t("bodyField")}</span>
            <textarea
              name="body"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              className="min-h-56 w-full rounded-lg border border-zinc-300 px-3 py-2.5"
              rows={14}
              disabled={readOnly}
            />
          </label>

          <TemplateStructuredFieldsEditor
            definition={structuredFieldsDefinition}
            readOnly={readOnly}
            onChange={(nextDefinition) => {
              setFormLayoutDefinition((currentLayoutDefinition) =>
                reconcileFormLayoutDefinition(
                  currentLayoutDefinition,
                  structuredFieldsDefinition,
                  nextDefinition,
                ),
              );
              setStructuredFieldsDefinition(nextDefinition);
            }}
            strings={{
              title: t("structuredFieldsTitle"),
              subtitle: t("structuredFieldsSubtitle"),
              legacyMessage: t("structuredFieldsLegacy"),
              builtInFieldsTitle: t("builtInFieldsTitle"),
              scopeFieldTitle: t("scopeFieldTitle"),
              scopeFieldDescription: t("scopeFieldDescription"),
              scopeEmpty: t("scopeFieldEmpty"),
              addScopeOption: t("addScopeOption"),
              addDurationOption: t("addDurationOption"),
              addOption: t("addOption"),
              durationFieldTitle: t("durationFieldTitle"),
              durationFieldDescription: t("durationFieldDescription"),
              customFieldsTitle: t("customFieldsTitle"),
              customFieldsEmpty: t("customFieldsEmpty"),
              addSingleSelectField: t("addSingleSelectField"),
              addCheckboxListField: t("addCheckboxListField"),
              addTextInputField: t("addTextInputField"),
              fieldLabelField: t("structuredFieldLabelField"),
              fieldTypeField: t("structuredFieldTypeField"),
              helpTextField: t("structuredHelpTextField"),
              placeholderField: t("structuredPlaceholderField"),
              requiredFieldLabel: t("structuredRequiredField"),
              requiredValue: t("requiredValue"),
              optionalValue: t("optionalValue"),
              optionsField: t("structuredOptionsField"),
              optionLabelField: t("structuredOptionLabelField"),
              dragHandle: t("layoutDragHandle"),
              removeOption: t("removeOption"),
              removeField: t("removeField"),
              typeSingleSelect: t("typeSingleSelect"),
              typeCheckboxList: t("typeCheckboxList"),
              typeTextInput: t("typeTextInput"),
            }}
          />

          <label className="flex items-center gap-2 rounded-lg border border-zinc-300 bg-white px-3 py-3 text-sm text-zinc-800">
            <input
              type="checkbox"
              checked={faceMatchEnabled}
              disabled={readOnly}
              onChange={(event) =>
                setFormLayoutDefinition((current) =>
                  setFaceMatchEnabled(current, event.target.checked),
                )
              }
            />
            <span>{t("layoutAllowFaceMatch")}</span>
          </label>

          {error ? <p className="text-sm text-red-700">{error}</p> : null}

          <div className="flex flex-wrap gap-2">
            {template.canPublish ? (
              <button
                type="button"
                disabled={isSaving || isPublishing || isArchiving || isCreatingVersion}
                onClick={() => void postAction(`/api/templates/${template.id}/publish`, "publish")}
                className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
              >
                {isPublishing ? t("publishing") : t("publish")}
              </button>
            ) : null}
            {template.canCreateVersion ? (
              <button
                type="button"
                disabled={isSaving || isPublishing || isArchiving || isCreatingVersion}
                onClick={() => void postAction(`/api/templates/${template.id}/versions`, "version")}
                className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
              >
                {isCreatingVersion ? t("creatingVersion") : t("createVersion")}
              </button>
            ) : null}
          </div>
        </form>

        <div className="xl:sticky xl:top-6 xl:self-start">
          <TemplateConsentPreview
            templateId={template.id}
            templateName={name.trim() || template.name}
            consentText={body}
            structuredFieldsDefinition={structuredFieldsDefinition}
            formLayoutDefinition={formLayoutDefinition}
            strings={{
              title: t("previewTitle"),
              formTitle: tInvite("title"),
              formSubtitle: name.trim() || template.name,
              fullNameLabel: tPublic("fullNameLabel"),
              emailLabel: tPublic("emailLabel"),
              scopeLabel: tPublic("scopeLabel"),
              durationLabel: tPublic("durationLabel"),
              requiredField: tPublic("requiredField"),
              selectPlaceholder: tPublic("selectPlaceholder"),
              emptySelectionOption: tPublic("emptySelectionOption"),
              emptyCheckboxOptionLabel: tPublic("emptyCheckboxOptionLabel"),
              faceMatchOptIn: tPublic("faceMatchOptIn"),
              headshotRequiredTitle: tPublic("headshotRequiredTitle"),
              headshotRequiredBody: tPublic("headshotRequiredBody"),
              consentTextHeading: tPublic("consentTextTitle"),
              consentTextUnavailable: tPublic("consentTextUnavailable"),
              consentAcknowledgementLabel: tPublic("consentAcknowledgementLabel"),
              mockHeadshotLabel: t("previewMockHeadshot"),
              validateButton: t("previewValidate"),
              validatingButton: t("previewValidating"),
              saveButton: t("saveButton"),
              saveAriaLabel: t("saveButton"),
              archiveAriaLabel: t("archive"),
              dragHandle: t("layoutDragHandle"),
              validState: t("previewValid"),
              invalidState: t("previewInvalid"),
              configurationErrorTitle: t("previewConfigurationErrorTitle"),
              fieldErrorRequired: t("previewFieldErrorRequired"),
              fieldErrorInvalid: t("previewFieldErrorInvalid"),
              fieldErrorHeadshotRequired: t("previewFieldErrorHeadshotRequired"),
              subjectNameLabel: t("layoutSubjectName"),
              subjectEmailLabel: t("layoutSubjectEmail"),
              scopeLabel: t("layoutScope"),
              durationLabel: t("layoutDuration"),
              faceMatchLabel: t("layoutFaceMatch"),
              consentTextLabel: t("layoutConsentText"),
            }}
            canEdit={template.canEdit}
            canArchive={template.canArchive}
            isSaving={isSaving}
            isArchiving={isArchiving}
            onSave={() => void saveDraft()}
            onArchive={() => void postAction(`/api/templates/${template.id}/archive`, "archive")}
            onLayoutChange={setFormLayoutDefinition}
          />
        </div>
      </div>
    </div>
  );
}
