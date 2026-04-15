"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { createIdempotencyKey } from "@/lib/client/idempotency-key";
import { resolveLocalizedApiError } from "@/lib/i18n/error-message";
import { formatDateTime } from "@/lib/i18n/format";
import type { ProjectParticipantsPanelData } from "@/lib/projects/project-participants-service";

type ConsentTemplateOption = {
  id: string;
  name: string;
  version: string;
  scope: "app" | "tenant";
};

type ProjectParticipantsRouter = Pick<ReturnType<typeof useRouter>, "refresh">;

type ProjectParticipantsPanelProps = {
  projectId: string;
  data: ProjectParticipantsPanelData;
  templates: ConsentTemplateOption[];
  defaultTemplateId: string | null;
  defaultTemplateWarning?: string | null;
};

type ProjectParticipantsPanelViewProps = ProjectParticipantsPanelProps & {
  router: ProjectParticipantsRouter;
};

type ApiErrorPayload = {
  error?: string;
  message?: string;
} | null;

function resolveBrowserShareUrl(path: string) {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  if (typeof window === "undefined") {
    return path;
  }

  return new URL(path, window.location.origin).toString();
}

function ConsentStateBadge({
  state,
  tone = "primary",
}: {
  state: "missing" | "pending" | "signed" | "revoked";
  tone?: "primary" | "secondary";
}) {
  const tProject = useTranslations("projects.participants.projectState");
  const tBaseline = useTranslations("projects.participants.baselineState");
  const t = tone === "primary" ? tProject : tBaseline;

  const className =
    state === "signed"
      ? "inline-flex rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700"
      : state === "pending"
        ? "inline-flex rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800"
        : state === "revoked"
          ? "inline-flex rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700"
          : "inline-flex rounded-md border border-zinc-300 bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700";

  return <span className={className}>{t(state)}</span>;
}

function MatchSourceReadinessBadge({
  state,
}: {
  state: ProjectParticipantsPanelData["knownProfiles"][number]["matchingReadiness"]["state"];
}) {
  const t = useTranslations("projects.participants.matchSourceState");

  const className =
    state === "ready"
      ? "inline-flex rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700"
      : state === "materializing" || state === "needs_face_selection"
        ? "inline-flex rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800"
        : state === "blocked_no_opt_in" || state === "missing_headshot"
          ? "inline-flex rounded-md border border-zinc-300 bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700"
          : "inline-flex rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700";

  return <span className={className}>{t(state)}</span>;
}

function AddProjectProfileParticipantForm({
  projectId,
  availableProfiles,
  router,
}: {
  projectId: string;
  availableProfiles: ProjectParticipantsPanelData["availableProfiles"];
  router: ProjectParticipantsRouter;
}) {
  const t = useTranslations("projects.participants.addExistingProfile");
  const tErrors = useTranslations("errors");
  const [selectedProfileId, setSelectedProfileId] = useState(availableProfiles[0]?.id ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedProfileId((current) => {
      if (current && availableProfiles.some((profile) => profile.id === current)) {
        return current;
      }

      return availableProfiles[0]?.id ?? "";
    });
  }, [availableProfiles]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProfileId) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/projects/${projectId}/profile-participants`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          recurringProfileId: selectedProfileId,
        }),
      });

      const payload = (await response.json().catch(() => null)) as ApiErrorPayload;
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
    <form onSubmit={handleSubmit} className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-4">
      <div>
        <h4 className="text-sm font-semibold text-zinc-900">{t("title")}</h4>
        <p className="mt-1 text-sm text-zinc-600">{t("subtitle")}</p>
      </div>

      <label className="block text-sm text-zinc-800">
        <span className="mb-1 block font-medium">{t("label")}</span>
        <select
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5"
          value={selectedProfileId}
          onChange={(event) => setSelectedProfileId(event.target.value)}
          disabled={availableProfiles.length === 0 || isSubmitting}
        >
          {availableProfiles.length === 0 ? (
            <option value="">{t("empty")}</option>
          ) : null}
          {availableProfiles.map((profile) => (
            <option key={profile.id} value={profile.id}>
              {profile.fullName} ({profile.email})
              {profile.profileTypeLabel ? ` - ${profile.profileTypeLabel}` : ""}
            </option>
          ))}
        </select>
      </label>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <button
        type="submit"
        disabled={isSubmitting || !selectedProfileId}
        className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
      >
        {isSubmitting ? t("submitting") : t("submit")}
      </button>
    </form>
  );
}

function ProjectProfileParticipantActions({
  projectId,
  participant,
  templates,
  defaultTemplateId,
  router,
}: {
  projectId: string;
  participant: ProjectParticipantsPanelData["knownProfiles"][number];
  templates: ConsentTemplateOption[];
  defaultTemplateId: string | null;
  router: ProjectParticipantsRouter;
}) {
  const locale = useLocale();
  const t = useTranslations("projects.participants.request");
  const tErrors = useTranslations("errors");
  const [selectedTemplateId, setSelectedTemplateId] = useState(defaultTemplateId ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedTemplateId((current) => {
      if (current && templates.some((template) => template.id === current)) {
        return current;
      }

      return defaultTemplateId ?? "";
    });
  }, [defaultTemplateId, templates]);

  const pendingRequest = participant.projectConsent.pendingRequest;

  async function handleCopy() {
    if (!pendingRequest) {
      return;
    }

    setCopied(false);
    setCopyError(null);

    try {
      await navigator.clipboard.writeText(resolveBrowserShareUrl(pendingRequest.consentPath));
      setCopied(true);
    } catch {
      setCopyError(t("copyError"));
    }
  }

  async function handleCreateRequest() {
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(
        `/api/projects/${projectId}/profile-participants/${participant.participantId}/consent-request`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": createIdempotencyKey(),
          },
          body: JSON.stringify({
            consentTemplateId: selectedTemplateId || null,
          }),
        },
      );

      const payload = (await response.json().catch(() => null)) as ApiErrorPayload;
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

  if (pendingRequest) {
    const shareUrl = resolveBrowserShareUrl(pendingRequest.consentPath);

    return (
      <div className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
        <div className="grid gap-2 text-sm text-zinc-700 sm:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{t("expiresLabel")}</p>
            <p className="mt-1">{formatDateTime(pendingRequest.expiresAt, locale)}</p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{t("emailLabel")}</p>
            <p className="mt-1 break-all">{pendingRequest.emailSnapshot}</p>
          </div>
        </div>
        <label className="block text-xs font-medium text-zinc-700">
          <span className="mb-1 block">{t("linkLabel")}</span>
          <input readOnly value={shareUrl} className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2" />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-100"
          >
            {t("copy")}
          </button>
          <a
            href={shareUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-100"
          >
            {t("open")}
          </a>
        </div>
        {copied ? <p className="text-sm text-emerald-700">{t("copied")}</p> : null}
        {copyError ? <p className="text-sm text-red-700">{copyError}</p> : null}
      </div>
    );
  }

  if (!participant.actions.canCreateRequest) {
    return null;
  }

  const hasTemplates = templates.length > 0;
  const canSubmit = hasTemplates && selectedTemplateId.length > 0 && !isSubmitting;

  return (
    <div className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <label className="block text-sm text-zinc-800">
        <span className="mb-1 block font-medium">{t("templateLabel")}</span>
        <select
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2.5"
          value={selectedTemplateId}
          onChange={(event) => setSelectedTemplateId(event.target.value)}
          disabled={!hasTemplates || isSubmitting}
        >
          <option value="">{t("selectTemplatePlaceholder")}</option>
          {templates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name} {template.version} -{" "}
              {template.scope === "app" ? t("scopeStandard") : t("scopeOrganization")}
            </option>
          ))}
        </select>
      </label>

      {!hasTemplates ? <p className="text-sm text-red-700">{t("emptyTemplates")}</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <button
        type="button"
        onClick={handleCreateRequest}
        disabled={!canSubmit}
        className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
      >
        {isSubmitting ? t("submitting") : t("submit")}
      </button>
    </div>
  );
}

function renderProjectConsentActivity(
  participant: ProjectParticipantsPanelData["knownProfiles"][number],
  locale: string,
  t: (key: string, values?: Record<string, string>) => string,
) {
  if (participant.projectConsent.state === "pending" && participant.projectConsent.pendingRequest) {
    return t("pendingUntil", { date: formatDateTime(participant.projectConsent.pendingRequest.expiresAt, locale) });
  }

  if (participant.projectConsent.state === "signed" && participant.projectConsent.activeConsent) {
    return t("signedAt", { date: formatDateTime(participant.projectConsent.activeConsent.signedAt, locale) });
  }

  if (participant.projectConsent.state === "revoked" && participant.projectConsent.latestRevokedConsent) {
    return t("revokedAt", { date: formatDateTime(participant.projectConsent.latestRevokedConsent.revokedAt, locale) });
  }

  return t("missing");
}

export function ProjectParticipantsPanelView({
  projectId,
  data,
  templates,
  defaultTemplateId,
  defaultTemplateWarning,
  router,
}: ProjectParticipantsPanelViewProps) {
  const locale = useLocale();
  const t = useTranslations("projects.participants");

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold text-zinc-900">{t("knownProfilesTitle")}</h3>
        <p className="mt-1 text-sm text-zinc-600">{t("knownProfilesSubtitle")}</p>
      </div>

      {defaultTemplateWarning ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {defaultTemplateWarning}
        </p>
      ) : null}

      <AddProjectProfileParticipantForm
        projectId={projectId}
        availableProfiles={data.availableProfiles}
        router={router}
      />

      {data.knownProfiles.length === 0 ? (
        <p className="text-sm text-zinc-600">{t("knownProfilesEmpty")}</p>
      ) : (
        <ul className="space-y-3">
          {data.knownProfiles.map((participant) => (
            <li key={participant.participantId} className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-2">
                    <div>
                      <p className="font-medium text-zinc-900">{participant.profile.fullName}</p>
                      <p className="text-sm text-zinc-700">{participant.profile.email}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <ConsentStateBadge state={participant.projectConsent.state} />
                      <span className="inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-medium text-zinc-700">
                        <span>{t("baselineLabel")}</span>
                        <ConsentStateBadge state={participant.baselineConsentState} tone="secondary" />
                      </span>
                      <span className="inline-flex items-center gap-2 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-medium text-zinc-700">
                        <span>{t("matchSourceLabel")}</span>
                        <MatchSourceReadinessBadge state={participant.matchingReadiness.state} />
                      </span>
                      {participant.profile.status === "archived" ? (
                        <span className="inline-flex rounded-md border border-zinc-300 bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700">
                          {t("archivedProfile")}
                        </span>
                      ) : null}
                      {participant.profile.profileType ? (
                        <span className="inline-flex rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-medium text-zinc-700">
                          {participant.profile.profileType.label}
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm text-zinc-700">
                      {renderProjectConsentActivity(participant, locale, t)}
                    </p>
                  </div>

                  <div className="grid gap-3 text-sm text-zinc-700 sm:grid-cols-2 lg:min-w-[18rem]">
                    <div className="rounded-lg bg-zinc-50 p-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{t("participantAddedLabel")}</p>
                      <p className="mt-1">{formatDateTime(participant.createdAt, locale)}</p>
                    </div>
                    <div className="rounded-lg bg-zinc-50 p-3">
                      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{t("latestProjectStatusLabel")}</p>
                      <p className="mt-1">{participant.projectConsent.state === "missing" ? t("noRequestYet") : renderProjectConsentActivity(participant, locale, t)}</p>
                    </div>
                  </div>
                </div>

                <p className="text-sm text-zinc-700">
                  {t(`matchSourceDescription.${participant.matchingReadiness.state}`)}
                </p>

                {participant.projectConsent.pendingRequest?.template ? (
                  <p className="text-sm text-zinc-700">
                    {t("templateLine", {
                      name: participant.projectConsent.pendingRequest.template.name,
                      version: participant.projectConsent.pendingRequest.template.version,
                    })}
                  </p>
                ) : null}
                {!participant.projectConsent.pendingRequest && participant.projectConsent.activeConsent?.template ? (
                  <p className="text-sm text-zinc-700">
                    {t("templateLine", {
                      name: participant.projectConsent.activeConsent.template.name,
                      version: participant.projectConsent.activeConsent.template.version,
                    })}
                  </p>
                ) : null}
                {!participant.projectConsent.pendingRequest && !participant.projectConsent.activeConsent && participant.projectConsent.latestRevokedConsent?.template ? (
                  <p className="text-sm text-zinc-700">
                    {t("templateLine", {
                      name: participant.projectConsent.latestRevokedConsent.template.name,
                      version: participant.projectConsent.latestRevokedConsent.template.version,
                    })}
                  </p>
                ) : null}

                {participant.profile.status === "archived" ? (
                  <p className="text-sm text-zinc-600">{t("archivedProfileHelper")}</p>
                ) : null}

                <ProjectProfileParticipantActions
                  projectId={projectId}
                  participant={participant}
                  templates={templates}
                  defaultTemplateId={defaultTemplateId}
                  router={router}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ProjectParticipantsPanel(props: ProjectParticipantsPanelProps) {
  const router = useRouter();

  return <ProjectParticipantsPanelView {...props} router={router} />;
}
