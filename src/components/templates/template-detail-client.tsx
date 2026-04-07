"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { TemplateStatusBadge } from "@/components/templates/template-status-badge";
import { createIdempotencyKey } from "@/lib/client/idempotency-key";
import { resolveLocalizedApiError } from "@/lib/i18n/error-message";
import { formatDateTime } from "@/lib/i18n/format";
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

export function TemplateDetailClient({ template }: TemplateDetailClientProps) {
  const locale = useLocale();
  const t = useTranslations("templates.detail");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isArchiving, setIsArchiving] = useState(false);
  const [isCreatingVersion, setIsCreatingVersion] = useState(false);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSaving(true);

    const formData = new FormData(event.currentTarget);

    try {
      const response = await fetch(`/api/templates/${template.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: String(formData.get("name") ?? "").trim(),
          description: String(formData.get("description") ?? "").trim() || null,
          category: String(formData.get("category") ?? "").trim() || null,
          body: String(formData.get("body") ?? "").trim(),
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

        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
            <dt className="text-zinc-500">{t("categoryLabel")}</dt>
            <dd className="mt-1 font-medium text-zinc-900">{template.category ?? t("uncategorized")}</dd>
          </div>
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

      <form onSubmit={handleSave} className="content-card space-y-4 rounded-xl p-5">
        <label className="block text-sm text-zinc-800">
          <span className="mb-1 block font-medium">{t("nameField")}</span>
          <input
            name="name"
            defaultValue={template.name}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2.5"
            disabled={readOnly}
          />
        </label>

        <label className="block text-sm text-zinc-800">
          <span className="mb-1 block font-medium">{t("categoryField")}</span>
          <input
            name="category"
            defaultValue={template.category ?? ""}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2.5"
            disabled={readOnly}
          />
        </label>

        <label className="block text-sm text-zinc-800">
          <span className="mb-1 block font-medium">{t("descriptionField")}</span>
          <textarea
            name="description"
            defaultValue={template.description ?? ""}
            className="w-full rounded-lg border border-zinc-300 px-3 py-2.5"
            rows={3}
            disabled={readOnly}
          />
        </label>

        <label className="block text-sm text-zinc-800">
          <span className="mb-1 block font-medium">{t("bodyField")}</span>
          <textarea
            name="body"
            defaultValue={template.body}
            className="min-h-56 w-full rounded-lg border border-zinc-300 px-3 py-2.5"
            rows={14}
            disabled={readOnly}
          />
        </label>

        {error ? <p className="text-sm text-red-700">{error}</p> : null}

        <div className="flex flex-wrap gap-2">
          {template.canEdit ? (
            <button
              type="submit"
              disabled={isSaving || isPublishing || isArchiving || isCreatingVersion}
              className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
            >
              {isSaving ? t("saving") : t("saveDraft")}
            </button>
          ) : null}
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
          {template.canArchive ? (
            <button
              type="button"
              disabled={isSaving || isPublishing || isArchiving || isCreatingVersion}
              onClick={() => void postAction(`/api/templates/${template.id}/archive`, "archive")}
              className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
            >
              {isArchiving ? t("archiving") : t("archive")}
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
    </div>
  );
}
