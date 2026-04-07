"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { createIdempotencyKey } from "@/lib/client/idempotency-key";
import { resolveLocalizedApiError } from "@/lib/i18n/error-message";

type CreateTemplateResponse = {
  template?: {
    id: string;
  };
  message?: string;
};

export function TemplateCreateForm() {
  const t = useTranslations("templates.create");
  const tErrors = useTranslations("errors");
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const category = String(formData.get("category") ?? "").trim();
    const body = String(formData.get("body") ?? "").trim();

    try {
      const response = await fetch("/api/templates", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": createIdempotencyKey(),
        },
        body: JSON.stringify({
          name,
          description: description || null,
          category: category || null,
          body,
        }),
      });

      const payload = (await response.json().catch(() => null)) as CreateTemplateResponse | null;
      if (!response.ok || !payload?.template?.id) {
        setError(resolveLocalizedApiError(tErrors, payload, "generic"));
        return;
      }

      router.push(`/templates/${payload.template.id}`);
      router.refresh();
    } catch {
      setError(tErrors("generic"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="content-card space-y-4 rounded-xl p-5">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900">{t("title")}</h2>
        <p className="mt-1 text-sm text-zinc-600">{t("subtitle")}</p>
      </div>

      <label className="block text-sm text-zinc-800">
        <span className="mb-1 block font-medium">{t("nameLabel")}</span>
        <input
          name="name"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2.5"
          minLength={2}
          maxLength={120}
          required
        />
      </label>

      <label className="block text-sm text-zinc-800">
        <span className="mb-1 block font-medium">{t("categoryLabel")}</span>
        <input
          name="category"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2.5"
          maxLength={80}
          placeholder={t("categoryPlaceholder")}
        />
      </label>

      <label className="block text-sm text-zinc-800">
        <span className="mb-1 block font-medium">{t("descriptionLabel")}</span>
        <textarea
          name="description"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2.5"
          rows={3}
          maxLength={500}
        />
      </label>

      <label className="block text-sm text-zinc-800">
        <span className="mb-1 block font-medium">{t("bodyLabel")}</span>
        <textarea
          name="body"
          className="min-h-48 w-full rounded-lg border border-zinc-300 px-3 py-2.5"
          rows={10}
          required
        />
      </label>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
      >
        {isSubmitting ? t("creating") : t("submit")}
      </button>
    </form>
  );
}
