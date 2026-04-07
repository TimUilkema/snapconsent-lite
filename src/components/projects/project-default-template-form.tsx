"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { resolveLocalizedApiError } from "@/lib/i18n/error-message";

type ProjectTemplateOption = {
  id: string;
  name: string;
  version: string;
  scope: "app" | "tenant";
};

type ProjectDefaultTemplateFormProps = {
  projectId: string;
  templates: ProjectTemplateOption[];
  defaultTemplateId: string | null;
  warning?: string | null;
};

export function ProjectDefaultTemplateForm({
  projectId,
  templates,
  defaultTemplateId,
  warning,
}: ProjectDefaultTemplateFormProps) {
  const t = useTranslations("projects.defaultTemplate");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [selectedTemplateId, setSelectedTemplateId] = useState(defaultTemplateId ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasSelection = useMemo(() => selectedTemplateId.length > 0, [selectedTemplateId]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/projects/${projectId}/default-template`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          defaultConsentTemplateId: hasSelection ? selectedTemplateId : null,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string; message?: string }
        | null;
      if (!response.ok) {
        setError(resolveLocalizedApiError(tErrors, payload, "generic"));
        return;
      }

      router.refresh();
    } catch {
      setError(tErrors("generic"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="content-card space-y-3 rounded-xl p-4">
      <div>
        <h2 className="text-base font-semibold text-zinc-900">{t("title")}</h2>
        <p className="mt-1 text-sm text-zinc-600">{t("subtitle")}</p>
      </div>

      {warning ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {warning}
        </p>
      ) : null}

      <label className="block text-sm text-zinc-800">
        <span className="mb-1 block font-medium">{t("label")}</span>
        <select
          className="w-full rounded-lg border border-zinc-300 px-3 py-2.5"
          value={selectedTemplateId}
          onChange={(event) => setSelectedTemplateId(event.target.value)}
        >
          <option value="">{t("noneOption")}</option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name} {template.version} -{" "}
              {template.scope === "app" ? t("scopeStandard") : t("scopeOrganization")}
            </option>
          ))}
        </select>
      </label>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
      >
        {isSubmitting ? t("saving") : t("submit")}
      </button>
    </form>
  );
}
