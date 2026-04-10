"use client";

import { FormEvent, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { InviteSharePanel } from "@/components/projects/invite-actions";
import { createIdempotencyKey } from "@/lib/client/idempotency-key";
import { resolveLocalizedApiError } from "@/lib/i18n/error-message";
import { formatDateTime } from "@/lib/i18n/format";

type CreateInviteResponse = {
  inviteId: string;
  invitePath?: string;
  inviteUrl?: string;
  expiresAt: string | null;
};

type CreateInviteFormProps = {
  projectId: string;
  templates: ConsentTemplateOption[];
  defaultTemplateId: string | null;
  warning?: string | null;
};

type ConsentTemplateOption = {
  id: string;
  name: string;
  version: string;
  scope: "app" | "tenant";
};

type InvitePayload = {
  inviteId: string;
  invitePath: string;
  expiresAt: string | null;
};

function normalizeInvitePath(payload: CreateInviteResponse | null) {
  if (!payload) {
    return null;
  }

  if (typeof payload.invitePath === "string" && payload.invitePath.startsWith("/")) {
    return payload.invitePath;
  }

  if (typeof payload.inviteUrl === "string" && payload.inviteUrl.length > 0) {
    try {
      const parsed = new URL(payload.inviteUrl);
      if (parsed.pathname.startsWith("/")) {
        return `${parsed.pathname}${parsed.search}`;
      }
    } catch {
      return null;
    }
  }

  return null;
}

export function CreateInviteForm({
  projectId,
  templates,
  defaultTemplateId,
  warning,
}: CreateInviteFormProps) {
  const locale = useLocale();
  const t = useTranslations("projects.invites");
  const tErrors = useTranslations("errors");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [payload, setPayload] = useState<InvitePayload | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState(defaultTemplateId ?? "");
  const expiresAtLabel = useMemo(() => {
    if (!payload?.expiresAt) {
      return t("noExpiry");
    }

    return formatDateTime(payload.expiresAt, locale);
  }, [locale, payload?.expiresAt, t]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      if (!selectedTemplateId) {
        setError(t("selectTemplateError"));
        setIsSubmitting(false);
        return;
      }

      const idempotencyKey = createIdempotencyKey();
      const response = await fetch(`/api/projects/${projectId}/invites`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ consentTemplateId: selectedTemplateId }),
      });

      const responsePayload = (await response.json().catch(() => null)) as
        | (CreateInviteResponse & { error?: string; message?: string })
        | null;
      const invitePath = normalizeInvitePath(responsePayload);

      if (!response.ok || !responsePayload?.inviteId || !invitePath) {
        setError(resolveLocalizedApiError(tErrors, responsePayload, "generic"));
        return;
      }

      setPayload({
        inviteId: responsePayload.inviteId,
        invitePath,
        expiresAt: responsePayload.expiresAt ?? null,
      });
    } catch {
      setError(tErrors("generic"));
    } finally {
      setIsSubmitting(false);
    }
  }

  const hasTemplates = templates.length > 0;

  return (
    <section className="content-card space-y-4 rounded-2xl p-5">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900">{t("title")}</h2>
        <p className="mt-1 text-sm text-zinc-600">{t("subtitle")}</p>
      </div>
      <form onSubmit={handleSubmit} className="space-y-3">
        {warning ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {warning}
          </p>
        ) : null}
        <label className="block text-sm text-zinc-800">
          <span className="mb-1 block font-medium">{t("templateLabel")}</span>
          <select
            className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5"
            value={selectedTemplateId}
            onChange={(event) => setSelectedTemplateId(event.target.value)}
            disabled={!hasTemplates}
          >
            <option value="">{t("selectTemplatePlaceholder")}</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name} {template.version} -{" "}
                {template.scope === "app" ? t("templateScopeStandard") : t("templateScopeOrganization")}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={isSubmitting || !hasTemplates || !selectedTemplateId}
          className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
        >
          {isSubmitting ? t("creating") : t("submit")}
        </button>
      </form>
      {!hasTemplates ? (
        <p className="text-sm text-red-700">{t("noTemplatesAvailable")}</p>
      ) : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {payload ? (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm">
          <p>
            <span className="font-medium">{t("inviteIdLabel")}</span> {payload.inviteId}
          </p>
          <p className="mt-1">
            <span className="font-medium">{t("expiresLabel")}</span> {expiresAtLabel}
          </p>
          <InviteSharePanel invitePath={payload.invitePath} defaultShowQr />
        </div>
      ) : null}
    </section>
  );
}
