"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

import { InviteSharePanel } from "@/components/projects/invite-actions";
import { createIdempotencyKey } from "@/lib/client/idempotency-key";
import { resolveLocalizedApiError } from "@/lib/i18n/error-message";
import { formatDateTime } from "@/lib/i18n/format";

type ConsentTemplateOption = {
  id: string;
  name: string;
  version: string;
  versionNumber: number;
  templateKey: string;
  scope: "app" | "tenant";
};

type PendingUpgradeRequest = {
  id: string;
  targetTemplateId: string;
  targetTemplateName: string;
  targetTemplateVersion: string;
  invitePath: string;
  expiresAt: string | null;
} | null;

type ApiErrorPayload = {
  error?: string;
  message?: string;
} | null;

type OneOffConsentUpgradeFormProps = {
  projectId: string;
  consentId: string;
  currentTemplateId: string | null;
  currentTemplateKey: string | null;
  currentTemplateVersionNumber: number | null;
  templates: ConsentTemplateOption[];
  initialPendingRequest?: PendingUpgradeRequest;
};

function isUsableTemplateOption(
  template: ConsentTemplateOption,
  currentTemplateId: string | null,
  currentTemplateKey: string | null,
  currentTemplateVersionNumber: number | null,
) {
  if (!currentTemplateKey || currentTemplateVersionNumber === null) {
    return false;
  }

  if (template.templateKey !== currentTemplateKey) {
    return false;
  }

  if (currentTemplateId && template.id === currentTemplateId) {
    return false;
  }

  return template.versionNumber > currentTemplateVersionNumber;
}

export function OneOffConsentUpgradeForm({
  projectId,
  consentId,
  currentTemplateId,
  currentTemplateKey,
  currentTemplateVersionNumber,
  templates,
  initialPendingRequest = null,
}: OneOffConsentUpgradeFormProps) {
  const t = useTranslations("projects.detail.upgradeRequest");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingRequest, setPendingRequest] = useState<PendingUpgradeRequest>(initialPendingRequest);

  const eligibleTemplates = useMemo(
    () =>
      templates.filter((template) =>
        isUsableTemplateOption(template, currentTemplateId, currentTemplateKey, currentTemplateVersionNumber),
      ),
    [currentTemplateId, currentTemplateKey, currentTemplateVersionNumber, templates],
  );

  const [selectedTemplateId, setSelectedTemplateId] = useState(
    initialPendingRequest?.targetTemplateId ?? eligibleTemplates[0]?.id ?? "",
  );

  useEffect(() => {
    setSelectedTemplateId((current) => {
      if (current && eligibleTemplates.some((template) => template.id === current)) {
        return current;
      }

      return initialPendingRequest?.targetTemplateId ?? eligibleTemplates[0]?.id ?? "";
    });
  }, [eligibleTemplates, initialPendingRequest?.targetTemplateId]);

  const selectedTemplate = eligibleTemplates.find((template) => template.id === selectedTemplateId) ?? null;
  const pendingExpiresLabel = pendingRequest?.expiresAt
    ? formatDateTime(pendingRequest.expiresAt, locale)
    : t("noExpiry");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTemplateId) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/projects/${projectId}/consents/${consentId}/upgrade-request`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": createIdempotencyKey(),
        },
        body: JSON.stringify({
          targetTemplateId: selectedTemplateId,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | ({
            request?: {
              id: string;
              targetTemplateId: string;
              targetTemplateName: string;
              targetTemplateVersion: string;
              invitePath: string;
              expiresAt: string | null;
            };
          } & ApiErrorPayload)
        | null;

      if (!response.ok || !payload?.request?.invitePath) {
        setError(resolveLocalizedApiError(tErrors, payload, "generic"));
        return;
      }

      setPendingRequest({
        id: payload.request.id,
        targetTemplateId: payload.request.targetTemplateId,
        targetTemplateName: payload.request.targetTemplateName,
        targetTemplateVersion: payload.request.targetTemplateVersion,
        invitePath: payload.request.invitePath,
        expiresAt: payload.request.expiresAt ?? null,
      });
    } catch {
      setError(tErrors("generic"));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (!currentTemplateKey || currentTemplateVersionNumber === null) {
    return (
      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4">
        <p className="text-sm text-zinc-700">{t("unavailable")}</p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
      <div>
        <h4 className="text-sm font-semibold text-zinc-900">{t("title")}</h4>
        <p className="mt-1 text-sm text-zinc-600">{t("subtitle")}</p>
      </div>

      {pendingRequest ? (
        <div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3 text-sm text-zinc-700">
          <p className="font-medium text-zinc-900">
            {t("pendingTemplateLine", {
              name: pendingRequest.targetTemplateName,
              version: pendingRequest.targetTemplateVersion,
            })}
          </p>
          <p>{t("pendingExpiry", { date: pendingExpiresLabel })}</p>
          <InviteSharePanel invitePath={pendingRequest.invitePath} defaultShowUrl />
        </div>
      ) : null}

      {eligibleTemplates.length > 0 ? (
        <form onSubmit={handleSubmit} className="space-y-3">
          <label className="block text-sm text-zinc-800">
            <span className="mb-1 block font-medium">{t("templateLabel")}</span>
            <select
              className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5"
              value={selectedTemplateId}
              onChange={(event) => setSelectedTemplateId(event.target.value)}
              disabled={isSubmitting}
            >
              <option value="">{t("selectTemplatePlaceholder")}</option>
              {eligibleTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name} {template.version} -{" "}
                  {template.scope === "app" ? t("scopeStandard") : t("scopeOrganization")}
                </option>
              ))}
            </select>
          </label>

          {selectedTemplate ? (
            <p className="text-sm text-zinc-600">
              {t("selectedTemplateHint", {
                name: selectedTemplate.name,
                version: selectedTemplate.version,
              })}
            </p>
          ) : null}

          {error ? <p className="text-sm text-red-700">{error}</p> : null}

          <button
            type="submit"
            disabled={isSubmitting || !selectedTemplateId}
            className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
          >
            {isSubmitting ? t("submitting") : pendingRequest ? t("replaceSubmit") : t("submit")}
          </button>
        </form>
      ) : (
        <p className="text-sm text-zinc-700">{t("empty")}</p>
      )}
    </div>
  );
}
