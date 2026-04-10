"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { TemplateConsentPreview } from "@/components/templates/template-consent-preview";
import { TemplateFormLayoutEditor } from "@/components/templates/template-form-layout-editor";
import { TemplateStructuredFieldsEditor } from "@/components/templates/template-structured-fields-editor";
import { TemplateStatusBadge } from "@/components/templates/template-status-badge";
import { createIdempotencyKey } from "@/lib/client/idempotency-key";
import { resolveLocalizedApiError } from "@/lib/i18n/error-message";
import { formatDateTime } from "@/lib/i18n/format";
import { reconcileFormLayoutDefinition } from "@/lib/templates/form-layout";
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

function getEditableStructuredDefinition(template: TemplateDetail) {
  if (template.structuredFieldsDefinition) {
    return template.structuredFieldsDefinition;
  }

  return template.canEdit ? createStarterStructuredFieldsDefinition() : null;
}

export function TemplateDetailClient({ template }: TemplateDetailClientProps) {
  const locale = useLocale();
  const t = useTranslations("templates.detail");
  const tInvite = useTranslations("publicInvite");
  const tPublic = useTranslations("publicInvite.form");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const editableStructuredDefinition = getEditableStructuredDefinition(template);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isCreatingVersion, setIsCreatingVersion] = useState(false);
  const [name, setName] = useState(template.name);
  const [body, setBody] = useState(template.body);
  const [structuredFieldsDefinition, setStructuredFieldsDefinition] = useState(editableStructuredDefinition);
  const [formLayoutDefinition, setFormLayoutDefinition] = useState(template.formLayoutDefinition);

  useEffect(() => {
    setName(template.name);
    setBody(template.body);
    setStructuredFieldsDefinition(editableStructuredDefinition);
    setFormLayoutDefinition(template.formLayoutDefinition);
  }, [
    template.id,
    template.updatedAt,
    template.name,
    template.body,
    template.formLayoutDefinition,
    editableStructuredDefinition,
  ]);

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

      if (mode === "version" && payload?.template?.id) {
        router.push(`/templates/${payload.template.id}`);
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

  return (
    <div className="space-y-6">
      <section className="content-card space-y-4 rounded-xl p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-zinc-900">{template.name}</h1>
            <p className="mt-1 text-sm text-zinc-600">
              {template.scope === "app" ? t("scopeApp") : t("scopeOrganization")} - {template.version}
            </p>
          </div>
          <TemplateStatusBadge status={template.status} />
        </div>

        <dl className="grid gap-3 text-sm sm:grid-cols-2">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
            <dt className="text-zinc-500">{t("updatedLabel")}</dt>
            <dd className="mt-1 font-medium text-zinc-900">{formatDateTime(template.updatedAt, locale)}</dd>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
            <dt className="text-zinc-500">{t("publishedLabel")}</dt>
            <dd className="mt-1 font-medium text-zinc-900">
              {template.publishedAt ? formatDateTime(template.publishedAt, locale) : t("notPublished")}
            </dd>
          </div>
        </dl>
      </section>

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
              maxLengthField: t("structuredMaxLengthField"),
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

          <TemplateFormLayoutEditor
            definition={formLayoutDefinition}
            structuredFieldsDefinition={structuredFieldsDefinition}
            readOnly={readOnly}
            onChange={setFormLayoutDefinition}
            strings={{
              title: t("layoutTitle"),
              subtitle: t("layoutSubtitle"),
              allowFaceMatchLabel: t("layoutAllowFaceMatch"),
              systemBadge: t("layoutBadgeSystem"),
              builtInBadge: t("layoutBadgeBuiltIn"),
              customBadge: t("layoutBadgeCustom"),
              dragHandle: t("layoutDragHandle"),
              subjectNameLabel: t("layoutSubjectName"),
              subjectEmailLabel: t("layoutSubjectEmail"),
              scopeLabel: t("layoutScope"),
              durationLabel: t("layoutDuration"),
              faceMatchLabel: t("layoutFaceMatch"),
              consentTextLabel: t("layoutConsentText"),
            }}
          />

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
