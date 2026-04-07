"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { resolveLocalizedApiError } from "@/lib/i18n/error-message";

type CreateProjectResponse = {
  projectId: string;
};

export function CreateProjectForm() {
  const t = useTranslations("projects.create");
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

    try {
      const response = await fetch("/api/projects", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          description: description || null,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string; message?: string }
          | null;
        setError(resolveLocalizedApiError(tErrors, payload, "generic"));
        return;
      }

      const payload = (await response.json()) as CreateProjectResponse;
      router.push(`/projects/${payload.projectId}`);
      router.refresh();
    } catch {
      setError(tErrors("generic"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="content-card space-y-4 rounded-2xl p-5">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900">{t("title")}</h2>
        <p className="mt-1 text-sm text-zinc-600">{t("subtitle")}</p>
      </div>
      <label className="block text-sm text-zinc-800">
        <span className="mb-1 block font-medium">{t("nameLabel")}</span>
        <input
          type="text"
          name="name"
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5"
          minLength={2}
          maxLength={120}
          required
        />
      </label>
      <label className="block text-sm text-zinc-800">
        <span className="mb-1 block font-medium">{t("descriptionLabel")}</span>
        <textarea
          name="description"
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5"
          rows={3}
          maxLength={500}
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
