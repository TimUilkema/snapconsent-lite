"use client";

import Link from "next/link";
import { Fragment, FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { ProfileHeadshotPanel } from "@/components/profiles/profile-headshot-panel";
import { createIdempotencyKey } from "@/lib/client/idempotency-key";
import { resolveLocalizedApiError } from "@/lib/i18n/error-message";
import { formatDateTime } from "@/lib/i18n/format";
import type {
  RecurringProfileDetailData,
  RecurringProfilesPageData,
} from "@/lib/profiles/profile-directory-service";

type ProfilesShellProps = {
  data: RecurringProfilesPageData;
};

type ProfilesRouter = Pick<ReturnType<typeof useRouter>, "refresh">;

type ProfilesShellViewProps = ProfilesShellProps & {
  router: ProfilesRouter;
};

type ApiErrorPayload = {
  error?: string;
  message?: string;
} | null;

type BaselineFollowUpApiPayload =
  | {
      followUp?: {
        action?: "reminder" | "new_request";
      };
      error?: string;
      message?: string;
    }
  | null;

type ProfileDetailApiPayload = {
  detail?: RecurringProfileDetailData;
} | ApiErrorPayload;

type DetailMutationNotice = {
  tone: "success";
  message: string;
};

type ProfileArchiveButtonProps = {
  profileId: string;
  router: ProfilesRouter;
};

type ProfileTypeArchiveButtonProps = {
  profileTypeId: string;
  router: ProfilesRouter;
};

type CreateProfileFormProps = {
  profileTypes: RecurringProfilesPageData["profileTypes"];
  router: ProfilesRouter;
};

type ProfileTypeManagerProps = {
  profileTypes: RecurringProfilesPageData["profileTypes"];
  router: ProfilesRouter;
};

type CreateBaselineConsentRequestPanelProps = {
  profileId: string;
  baselineTemplates: RecurringProfilesPageData["baselineTemplates"];
  router: ProfilesRouter;
  onSuccess?: (notice?: DetailMutationNotice) => void;
};

type PendingBaselineRequestPanelProps = {
  profileId: string;
  request:
    | NonNullable<RecurringProfilesPageData["profiles"][number]["baselineConsent"]["pendingRequest"]>
    | NonNullable<RecurringProfileDetailData["baselineConsent"]["pendingRequest"]>;
  router: ProfilesRouter;
  onSuccess?: (notice?: DetailMutationNotice) => void;
  allowCopyOpen?: boolean;
  allowManageRequest?: boolean;
  allowFollowUp?: boolean;
};

type ProfileRowActionsProps = {
  profile: RecurringProfilesPageData["profiles"][number];
  canManageProfiles: boolean;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  router: ProfilesRouter;
};

type ExpandedProfileDetailState =
  | {
      profileId: string;
      status: "loading";
      data: null;
      error: null;
    }
  | {
      profileId: string;
      status: "ready";
      data: RecurringProfileDetailData;
      error: null;
    }
  | {
      profileId: string;
      status: "error";
      data: null;
      error: string;
    };

type ProfileDetailPanelContentProps = {
  detail: RecurringProfileDetailData;
  baselineTemplates: RecurringProfilesPageData["baselineTemplates"];
  router: ProfilesRouter;
  notice: DetailMutationNotice | null;
  onMutated: (notice?: DetailMutationNotice) => void;
};

function ProfileStatusBadge({ archived }: { archived: boolean }) {
  const t = useTranslations("profiles.status");

  return (
    <span
      className={
        archived
          ? "inline-flex rounded-md border border-zinc-300 bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700"
          : "inline-flex rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700"
      }
    >
      {archived ? t("archived") : t("active")}
    </span>
  );
}

function BaselineStatusBadge({
  state,
}: {
  state: RecurringProfilesPageData["profiles"][number]["baselineConsent"]["state"];
}) {
  const t = useTranslations("profiles.baseline.state");

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

function MatchingReadinessBadge({
  state,
}: {
  state: RecurringProfilesPageData["profiles"][number]["matchingReadiness"]["state"];
}) {
  const t = useTranslations("profiles.matching.state");

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

function resolveBrowserShareUrl(path: string) {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  if (typeof window === "undefined") {
    return path;
  }

  return new URL(path, window.location.origin).toString();
}

function ProfileArchiveButton({ profileId, router }: ProfileArchiveButtonProps) {
  const t = useTranslations("profiles");
  const tErrors = useTranslations("errors");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleArchive() {
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/profiles/${profileId}/archive`, {
        method: "POST",
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
    <div className="space-y-1">
      <button
        type="button"
        onClick={handleArchive}
        disabled={isSubmitting}
        className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
      >
        {isSubmitting ? t("actions.archivingProfile") : t("actions.archiveProfile")}
      </button>
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
    </div>
  );
}

function ProfileTypeArchiveButton({ profileTypeId, router }: ProfileTypeArchiveButtonProps) {
  const t = useTranslations("profiles");
  const tErrors = useTranslations("errors");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleArchive() {
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/profile-types/${profileTypeId}/archive`, {
        method: "POST",
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
    <div className="space-y-1">
      <button
        type="button"
        onClick={handleArchive}
        disabled={isSubmitting}
        className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-60"
      >
        {isSubmitting ? t("actions.archivingType") : t("actions.archiveType")}
      </button>
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
    </div>
  );
}

function PendingBaselineRequestPanel({
  profileId,
  request,
  router,
  onSuccess,
  allowCopyOpen = true,
  allowManageRequest = true,
  allowFollowUp = false,
}: PendingBaselineRequestPanelProps) {
  const t = useTranslations("profiles.baseline.pending");
  const tFollowUp = useTranslations("profiles.baseline.followUp");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [activeMutation, setActiveMutation] = useState<"cancel" | "replace" | "followUp" | null>(null);
  const shareUrl = resolveBrowserShareUrl(request.consentPath);

  async function handleCopy() {
    setCopied(false);
    setCopyError(null);

    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      setCopyError(t("copyError"));
    }
  }

  async function handleCancel() {
    setActionError(null);
    setActiveMutation("cancel");

    try {
      const response = await fetch(
        `/api/profiles/${profileId}/baseline-consent-request/${request.id}/cancel`,
        {
          method: "POST",
        },
      );
      const payload = (await response.json().catch(() => null)) as ApiErrorPayload;

      if (!response.ok) {
        setActionError(resolveLocalizedApiError(tErrors, payload, "generic"));
        return;
      }

      router.refresh();
      onSuccess?.();
    } catch {
      setActionError(tErrors("generic"));
    } finally {
      setActiveMutation(null);
    }
  }

  async function handleReplace() {
    setActionError(null);
    setActiveMutation("replace");

    try {
      const response = await fetch(
        `/api/profiles/${profileId}/baseline-consent-request/${request.id}/replace`,
        {
          method: "POST",
          headers: {
            "Idempotency-Key": createIdempotencyKey(),
          },
        },
      );
      const payload = (await response.json().catch(() => null)) as ApiErrorPayload;

      if (!response.ok) {
        setActionError(resolveLocalizedApiError(tErrors, payload, "generic"));
        return;
      }

      router.refresh();
      onSuccess?.();
    } catch {
      setActionError(tErrors("generic"));
    } finally {
      setActiveMutation(null);
    }
  }

  async function handleFollowUp() {
    setActionError(null);
    setActiveMutation("followUp");

    try {
      const response = await fetch(`/api/profiles/${profileId}/baseline-follow-up`, {
        method: "POST",
        headers: {
          "Idempotency-Key": createIdempotencyKey(),
        },
      });
      const payload = (await response.json().catch(() => null)) as BaselineFollowUpApiPayload;

      if (!response.ok) {
        setActionError(resolveLocalizedApiError(tErrors, payload, "generic"));
        return;
      }

      router.refresh();
      onSuccess?.({
        tone: "success",
        message:
          payload?.followUp?.action === "new_request"
            ? tFollowUp("success.newRequest")
            : tFollowUp("success.reminder"),
      });
    } catch {
      setActionError(tErrors("generic"));
    } finally {
      setActiveMutation(null);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <div className="grid gap-2 text-sm text-zinc-700 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{t("emailLabel")}</p>
          <p className="mt-1 break-all">{request.emailSnapshot}</p>
        </div>
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">{t("expiresLabel")}</p>
          <p className="mt-1">{formatDateTime(request.expiresAt, locale)}</p>
        </div>
      </div>
      {allowCopyOpen ? (
        <label className="block text-xs font-medium text-zinc-700">
          <span className="mb-1 block">{t("linkLabel")}</span>
          <input readOnly value={shareUrl} className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2" />
        </label>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {allowCopyOpen ? (
          <>
            <button
              type="button"
              onClick={handleCopy}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              {t("copy")}
            </button>
            <a
              href={shareUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
            >
              {t("open")}
            </a>
          </>
        ) : null}
        {allowFollowUp ? (
          <button
            type="button"
            onClick={handleFollowUp}
            disabled={activeMutation !== null}
            className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
          >
            {activeMutation === "followUp" ? tFollowUp("sendingReminder") : tFollowUp("sendReminder")}
          </button>
        ) : null}
        {allowManageRequest ? (
          <>
            <button
              type="button"
              onClick={handleCancel}
              disabled={activeMutation !== null}
              className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
            >
              {activeMutation === "cancel" ? t("cancelling") : t("cancel")}
            </button>
            <button
              type="button"
              onClick={handleReplace}
              disabled={activeMutation !== null}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
            >
              {activeMutation === "replace" ? t("replacing") : t("replace")}
            </button>
          </>
        ) : null}
      </div>
      {copied ? <p className="text-xs text-emerald-700">{t("copied")}</p> : null}
      {copyError ? <p className="text-xs text-red-700">{copyError}</p> : null}
      {actionError ? <p className="text-xs text-red-700">{actionError}</p> : null}
    </div>
  );
}

function CreateBaselineConsentRequestPanel({
  profileId,
  baselineTemplates,
  router,
  onSuccess,
}: CreateBaselineConsentRequestPanelProps) {
  const t = useTranslations("profiles.baseline.request");
  const tFollowUp = useTranslations("profiles.baseline.followUp");
  const tErrors = useTranslations("errors");
  const [selectedTemplateId, setSelectedTemplateId] = useState(baselineTemplates[0]?.id ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(`/api/profiles/${profileId}/baseline-follow-up`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": createIdempotencyKey(),
        },
        body: JSON.stringify({
          consentTemplateId: selectedTemplateId,
        }),
      });

      const payload = (await response.json().catch(() => null)) as BaselineFollowUpApiPayload;
      if (!response.ok) {
        setError(resolveLocalizedApiError(tErrors, payload, "generic"));
        return;
      }

      router.refresh();
      onSuccess?.({
        tone: "success",
        message:
          payload?.followUp?.action === "reminder"
            ? tFollowUp("success.reminder")
            : tFollowUp("success.newRequest"),
      });
    } catch {
      setError(tErrors("generic"));
    } finally {
      setIsSubmitting(false);
    }
  }

  if (baselineTemplates.length === 0) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
        <p className="text-sm text-zinc-700">{t("emptyTemplates")}</p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <label className="block text-sm text-zinc-800">
        <span className="mb-1 block font-medium">{t("templateLabel")}</span>
        <select
          value={selectedTemplateId}
          onChange={(event) => setSelectedTemplateId(event.target.value)}
          className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2"
        >
          {baselineTemplates.map((template) => (
            <option key={template.id} value={template.id}>
              {template.name} {template.version} - {t(template.scope === "app" ? "scopeStandard" : "scopeOrganization")}
            </option>
          ))}
        </select>
      </label>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <button
        type="submit"
        disabled={isSubmitting || !selectedTemplateId}
        className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
      >
        {isSubmitting ? tFollowUp("sendingNewRequest") : tFollowUp("sendNewRequest")}
      </button>
    </form>
  );
}

function RequestStatusBadge({
  status,
}: {
  status: RecurringProfileDetailData["requestHistory"][number]["status"];
}) {
  const t = useTranslations("profiles.detail.requestHistory.status");

  const className =
    status === "signed"
      ? "inline-flex rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-700"
      : status === "pending"
        ? "inline-flex rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800"
        : status === "expired"
          ? "inline-flex rounded-md border border-zinc-300 bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700"
          : "inline-flex rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700";

  return <span className={className}>{t(status)}</span>;
}

function DetailField({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs font-medium text-zinc-500">{label}</p>
      <div className="mt-1 text-sm text-zinc-800">{value}</div>
    </div>
  );
}

function StructuredSummaryFields({
  summary,
}: {
  summary: RecurringProfileDetailData["consentHistory"][number]["structuredSummary"];
}) {
  const t = useTranslations("profiles.detail");

  if (!summary || (summary.scopeLabels.length === 0 && !summary.durationLabel)) {
    return null;
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {summary.scopeLabels.length > 0 ? (
        <DetailField label={t("scopeLabel")} value={summary.scopeLabels.join(", ")} />
      ) : null}
      {summary.durationLabel ? (
        <DetailField label={t("durationLabel")} value={summary.durationLabel} />
      ) : null}
    </div>
  );
}

function ProfileRowActions({
  profile,
  canManageProfiles,
  isExpanded,
  onToggleExpanded,
  router,
}: ProfileRowActionsProps) {
  const t = useTranslations("profiles");

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={onToggleExpanded}
        className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
        aria-expanded={isExpanded}
      >
        {isExpanded ? t("detail.hideDetails") : t("detail.viewDetails")}
      </button>
      {canManageProfiles && profile.status === "active" ? (
        <ProfileArchiveButton profileId={profile.id} router={router} />
      ) : null}
    </div>
  );
}

export function ProfileDetailPanelContent({
  detail,
  baselineTemplates,
  router,
  notice,
  onMutated,
}: ProfileDetailPanelContentProps) {
  const t = useTranslations("profiles.detail");
  const tBaselineActivity = useTranslations("profiles.baseline.activity");
  const tFollowUp = useTranslations("profiles.baseline.followUp");
  const locale = useLocale();

  function renderBaselineActivity() {
    const activityAt = detail.baselineConsent.latestActivityAt;

    if (detail.baselineConsent.state === "missing") {
      const latestRequestOutcome = detail.baselineConsent.latestRequestOutcome;
      if (latestRequestOutcome) {
        const formatted = formatDateTime(latestRequestOutcome.changedAt, locale);

        if (latestRequestOutcome.status === "cancelled") {
          return tBaselineActivity("latestCancelledAt", { date: formatted });
        }

        if (latestRequestOutcome.status === "superseded") {
          return tBaselineActivity("latestReplacedAt", { date: formatted });
        }

        return tBaselineActivity("latestExpiredAt", { date: formatted });
      }

      return tBaselineActivity("missing");
    }

    if (!activityAt) {
      return tBaselineActivity("unknown");
    }

    const formatted = formatDateTime(activityAt, locale);

    if (detail.baselineConsent.state === "pending") {
      return tBaselineActivity("pendingUntil", { date: formatted });
    }

    if (detail.baselineConsent.state === "signed") {
      return tBaselineActivity("signedAt", { date: formatted });
    }

    return tBaselineActivity("revokedAt", { date: formatted });
  }

  return (
    <div className="grid gap-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 xl:grid-cols-2">
      <section className="rounded-lg border border-zinc-200 bg-white p-4 xl:col-span-2">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div className="space-y-2">
            <h3 className="text-base font-semibold text-zinc-900">{t("currentTitle")}</h3>
            <div className="flex flex-wrap items-center gap-2">
              <BaselineStatusBadge state={detail.baselineConsent.state} />
              <ProfileStatusBadge archived={detail.profile.status === "archived"} />
            </div>
            <p className="text-sm text-zinc-700">{renderBaselineActivity()}</p>
          </div>
          <div className="grid gap-3 text-sm text-zinc-700 sm:grid-cols-2 xl:grid-cols-4">
            <DetailField label={t("nameLabel")} value={detail.profile.fullName} />
            <DetailField label={t("emailLabel")} value={detail.profile.email} />
            <DetailField
              label={t("typeLabel")}
              value={detail.profile.profileType?.label ?? t("noType")}
            />
            <DetailField
              label={t("updatedLabel")}
              value={formatDateTime(detail.profile.updatedAt, locale)}
            />
          </div>
        </div>
        {notice ? (
          <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {notice.message}
          </p>
        ) : null}
        {detail.baselineConsent.latestFollowUpAttempt ? (
          <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
            <h4 className="text-sm font-medium text-zinc-900">{tFollowUp("latestTitle")}</h4>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <DetailField
                label={tFollowUp("actionLabel")}
                value={tFollowUp(`actionLabels.${detail.baselineConsent.latestFollowUpAttempt.actionKind}`)}
              />
              <DetailField
                label={tFollowUp("statusLabel")}
                value={tFollowUp(`statusLabels.${detail.baselineConsent.latestFollowUpAttempt.status}`)}
              />
              <DetailField
                label={tFollowUp("targetEmailLabel")}
                value={detail.baselineConsent.latestFollowUpAttempt.targetEmail}
              />
              <DetailField
                label={tFollowUp("attemptedAtLabel")}
                value={formatDateTime(detail.baselineConsent.latestFollowUpAttempt.attemptedAt, locale)}
              />
            </div>
          </div>
        ) : null}
      </section>

      <ProfileHeadshotPanel
        profileId={detail.profile.id}
        headshotMatching={detail.headshotMatching}
        router={router}
        onMutated={onMutated}
      />

      {detail.baselineConsent.pendingRequest ? (
        <section className="rounded-lg border border-zinc-200 bg-white p-4">
          <div className="mb-3">
            <h3 className="text-base font-semibold text-zinc-900">{t("pendingTitle")}</h3>
          </div>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
            <DetailField
              label={t("templateLabel")}
              value={
                detail.baselineConsent.pendingRequest.templateName
                  ? `${detail.baselineConsent.pendingRequest.templateName} ${detail.baselineConsent.pendingRequest.templateVersion ?? ""}`.trim()
                  : t("unknownValue")
              }
            />
            <DetailField
              label={t("createdAtLabel")}
              value={formatDateTime(detail.baselineConsent.pendingRequest.createdAt, locale)}
            />
            <DetailField
              label={t("expiresAtLabel")}
              value={formatDateTime(detail.baselineConsent.pendingRequest.expiresAt, locale)}
            />
            <DetailField
              label={t("emailLabel")}
              value={detail.baselineConsent.pendingRequest.emailSnapshot}
            />
          </div>
          <PendingBaselineRequestPanel
            profileId={detail.profile.id}
            request={detail.baselineConsent.pendingRequest}
            router={router}
            onSuccess={onMutated}
            allowCopyOpen={detail.actions.canCopyBaselineLink || detail.actions.canOpenBaselineLink}
            allowManageRequest={detail.actions.canCancelPendingRequest || detail.actions.canReplacePendingRequest}
            allowFollowUp={detail.actions.availableBaselineFollowUpAction === "reminder"}
          />
        </section>
      ) : null}

      {!detail.baselineConsent.pendingRequest && detail.baselineConsent.activeConsent ? (
        <section className="rounded-lg border border-zinc-200 bg-white p-4">
          <div className="mb-4">
            <h3 className="text-base font-semibold text-zinc-900">{t("activeConsentTitle")}</h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
            <DetailField
              label={t("templateLabel")}
              value={
                detail.baselineConsent.activeConsent.templateName
                  ? `${detail.baselineConsent.activeConsent.templateName} ${detail.baselineConsent.activeConsent.templateVersion ?? ""}`.trim()
                  : t("unknownValue")
              }
            />
            <DetailField
              label={t("signedAtLabel")}
              value={formatDateTime(detail.baselineConsent.activeConsent.signedAt, locale)}
            />
            <DetailField
              label={t("emailLabel")}
              value={detail.baselineConsent.activeConsent.emailSnapshot}
            />
          </div>
          <div className="mt-4">
            <StructuredSummaryFields summary={detail.baselineConsent.activeConsent.structuredSummary} />
          </div>
        </section>
      ) : null}

      {!detail.baselineConsent.pendingRequest
      && !detail.baselineConsent.activeConsent
      && detail.baselineConsent.latestRevokedConsent ? (
        <section className="rounded-lg border border-zinc-200 bg-white p-4">
          <div className="mb-4">
            <h3 className="text-base font-semibold text-zinc-900">{t("latestRevokedTitle")}</h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
            <DetailField
              label={t("templateLabel")}
              value={
                detail.baselineConsent.latestRevokedConsent.templateName
                  ? `${detail.baselineConsent.latestRevokedConsent.templateName} ${detail.baselineConsent.latestRevokedConsent.templateVersion ?? ""}`.trim()
                  : t("unknownValue")
              }
            />
            <DetailField
              label={t("signedAtLabel")}
              value={formatDateTime(detail.baselineConsent.latestRevokedConsent.signedAt, locale)}
            />
            <DetailField
              label={t("revokedAtLabel")}
              value={formatDateTime(detail.baselineConsent.latestRevokedConsent.revokedAt, locale)}
            />
            <DetailField
              label={t("emailLabel")}
              value={detail.baselineConsent.latestRevokedConsent.emailSnapshot}
            />
          </div>
          <div className="mt-4">
            <StructuredSummaryFields summary={detail.baselineConsent.latestRevokedConsent.structuredSummary} />
          </div>
        </section>
      ) : null}

      {detail.actions.availableBaselineFollowUpAction === "new_request"
      && detail.baselineConsent.state === "missing" ? (
        <section className="rounded-lg border border-zinc-200 bg-white p-4">
          <h3 className="text-base font-semibold text-zinc-900">{t("actionsTitle")}</h3>
          <p className="mt-2 text-sm text-zinc-700">{t("requestHint")}</p>
          <div className="mt-4">
            <CreateBaselineConsentRequestPanel
              profileId={detail.profile.id}
              baselineTemplates={baselineTemplates}
              router={router}
              onSuccess={onMutated}
            />
          </div>
        </section>
      ) : null}

      {detail.actions.availableBaselineFollowUpAction === "new_request"
      && detail.baselineConsent.state === "revoked" ? (
        <section className="rounded-lg border border-zinc-200 bg-white p-4">
          <h3 className="text-base font-semibold text-zinc-900">{t("actionsTitle")}</h3>
          <p className="mt-2 text-sm text-zinc-700">{t("revokedHint")}</p>
          <div className="mt-4">
            <CreateBaselineConsentRequestPanel
              profileId={detail.profile.id}
              baselineTemplates={baselineTemplates}
              router={router}
              onSuccess={onMutated}
            />
          </div>
        </section>
      ) : null}

      {!detail.actions.canManageBaseline ? (
        <section className="rounded-lg border border-zinc-200 bg-white p-4">
          <p className="text-sm text-zinc-700">
            {detail.profile.status === "archived" ? t("archivedReadOnly") : t("readOnly")}
          </p>
        </section>
      ) : null}

      <section className="rounded-lg border border-zinc-200 bg-white p-4 xl:col-span-2">
        <h3 className="text-base font-semibold text-zinc-900">{t("requestHistoryTitle")}</h3>
        {detail.requestHistory.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-600">{t("requestHistoryEmpty")}</p>
        ) : (
          <div className="mt-4 space-y-3">
            {detail.requestHistory.map((request) => (
              <div key={request.id} className="rounded-lg border border-zinc-200 p-3">
                <div className="space-y-1">
                  <RequestStatusBadge status={request.status} />
                  <p className="text-sm font-medium text-zinc-900">
                    {request.templateName
                      ? `${request.templateName} ${request.templateVersion ?? ""}`.trim()
                      : t("unknownValue")}
                  </p>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <DetailField label={t("createdAtLabel")} value={formatDateTime(request.createdAt, locale)} />
                  <DetailField label={t("changedAtLabel")} value={formatDateTime(request.changedAt, locale)} />
                  <DetailField label={t("expiresAtLabel")} value={formatDateTime(request.expiresAt, locale)} />
                  <DetailField label={t("emailLabel")} value={request.emailSnapshot} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function CreateProfileForm({ profileTypes, router }: CreateProfileFormProps) {
  const t = useTranslations("profiles");
  const tErrors = useTranslations("errors");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeProfileTypes = profileTypes.filter((profileType) => profileType.status === "active");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const fullName = String(formData.get("fullName") ?? "");
    const email = String(formData.get("email") ?? "");
    const profileTypeId = String(formData.get("profileTypeId") ?? "").trim();

    try {
      const response = await fetch("/api/profiles", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": createIdempotencyKey(),
        },
        body: JSON.stringify({
          fullName,
          email,
          profileTypeId: profileTypeId || null,
        }),
      });

      const payload = (await response.json().catch(() => null)) as ApiErrorPayload;
      if (!response.ok) {
        setError(resolveLocalizedApiError(tErrors, payload, "generic"));
        return;
      }

      form.reset();
      router.refresh();
    } catch {
      setError(tErrors("generic"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <form id="create-profile" onSubmit={handleSubmit} className="content-card space-y-4 rounded-xl p-5">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900">{t("create.title")}</h2>
        <p className="mt-1 text-sm leading-6 text-zinc-600">{t("create.subtitle")}</p>
      </div>

      <label className="block text-sm text-zinc-800">
        <span className="mb-1 block font-medium">{t("create.fullNameLabel")}</span>
        <input
          name="fullName"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2.5"
          minLength={2}
          maxLength={160}
          required
        />
      </label>

      <label className="block text-sm text-zinc-800">
        <span className="mb-1 block font-medium">{t("create.emailLabel")}</span>
        <input
          name="email"
          type="email"
          className="w-full rounded-lg border border-zinc-300 px-3 py-2.5"
          maxLength={320}
          required
        />
      </label>

      <label className="block text-sm text-zinc-800">
        <span className="mb-1 block font-medium">{t("create.profileTypeLabel")}</span>
        <select name="profileTypeId" className="w-full rounded-lg border border-zinc-300 px-3 py-2.5" defaultValue="">
          <option value="">{t("create.profileTypeOptional")}</option>
          {activeProfileTypes.map((profileType) => (
            <option key={profileType.id} value={profileType.id}>
              {profileType.label}
            </option>
          ))}
        </select>
      </label>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <button
        type="submit"
        disabled={isSubmitting}
        className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
      >
        {isSubmitting ? t("actions.creatingProfile") : t("actions.createProfile")}
      </button>
    </form>
  );
}

function ProfileTypeManager({ profileTypes, router }: ProfileTypeManagerProps) {
  const t = useTranslations("profiles");
  const tErrors = useTranslations("errors");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeProfileTypes = profileTypes.filter((profileType) => profileType.status === "active");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    const form = event.currentTarget;
    const formData = new FormData(form);
    const label = String(formData.get("label") ?? "");

    try {
      const response = await fetch("/api/profile-types", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": createIdempotencyKey(),
        },
        body: JSON.stringify({
          label,
        }),
      });

      const payload = (await response.json().catch(() => null)) as ApiErrorPayload;
      if (!response.ok) {
        setError(resolveLocalizedApiError(tErrors, payload, "generic"));
        return;
      }

      form.reset();
      router.refresh();
    } catch {
      setError(tErrors("generic"));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="content-card space-y-4 rounded-xl p-5">
      <div>
        <h2 className="text-lg font-semibold text-zinc-900">{t("typeManager.title")}</h2>
        <p className="mt-1 text-sm leading-6 text-zinc-600">{t("typeManager.subtitle")}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <label className="block text-sm text-zinc-800">
          <span className="mb-1 block font-medium">{t("typeManager.labelField")}</span>
          <input
            name="label"
            className="w-full rounded-lg border border-zinc-300 px-3 py-2.5"
            minLength={2}
            maxLength={80}
            required
          />
        </label>

        {error ? <p className="text-sm text-red-700">{error}</p> : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-60"
        >
          {isSubmitting ? t("actions.creatingType") : t("actions.createType")}
        </button>
      </form>

      <div className="border-t border-zinc-200 pt-4">
        <h3 className="text-sm font-medium text-zinc-900">{t("typeManager.activeTypesTitle")}</h3>

        {activeProfileTypes.length === 0 ? (
          <p className="mt-3 text-sm text-zinc-600">{t("typeManager.empty")}</p>
        ) : (
          <ul className="mt-3 space-y-3">
            {activeProfileTypes.map((profileType) => (
              <li
                key={profileType.id}
                className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="font-medium text-zinc-900">{profileType.label}</p>
                  <p className="text-sm text-zinc-600">
                    {t("typeManager.assignedCount", { count: profileType.activeProfileCount })}
                  </p>
                </div>
                <ProfileTypeArchiveButton profileTypeId={profileType.id} router={router} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export function ProfilesShellView({ data, router }: ProfilesShellViewProps) {
  const t = useTranslations("profiles");
  const tErrors = useTranslations("errors");
  const locale = useLocale();
  const [expandedProfileId, setExpandedProfileId] = useState<string | null>(null);
  const [detailReloadKey, setDetailReloadKey] = useState(0);
  const [expandedDetail, setExpandedDetail] = useState<ExpandedProfileDetailState | null>(null);
  const [detailMutationNotice, setDetailMutationNotice] = useState<DetailMutationNotice | null>(null);

  const hasAnyProfiles = data.summary.activeProfiles + data.summary.archivedProfiles > 0;
  const hasFilters =
    data.filters.q.length > 0 || data.filters.profileTypeId !== null || data.filters.includeArchived;

  useEffect(() => {
    if (!expandedProfileId) {
      return;
    }

    let cancelled = false;

    async function loadDetail() {
      try {
        const response = await fetch(`/api/profiles/${expandedProfileId}/detail`, {
          method: "GET",
        });
        const payload = (await response.json().catch(() => null)) as ProfileDetailApiPayload;

        if (!response.ok || !payload || !("detail" in payload) || !payload.detail) {
          const error = resolveLocalizedApiError(
            tErrors,
            response.ok ? null : (payload as ApiErrorPayload),
            "generic",
          );
          if (!cancelled) {
            setExpandedDetail({
              profileId: expandedProfileId,
              status: "error",
              data: null,
              error,
            });
          }
          return;
        }

        if (!cancelled) {
          setExpandedDetail({
            profileId: expandedProfileId,
            status: "ready",
            data: payload.detail,
            error: null,
          });
        }
      } catch {
        if (!cancelled) {
          setExpandedDetail({
            profileId: expandedProfileId,
            status: "error",
            data: null,
            error: tErrors("generic"),
          });
        }
      }
    }

    void loadDetail();

    return () => {
      cancelled = true;
    };
  }, [expandedProfileId, detailReloadKey, data, tErrors]);

  function handleToggleExpanded(profileId: string) {
    if (expandedProfileId === profileId) {
      setExpandedProfileId(null);
      setExpandedDetail(null);
      setDetailMutationNotice(null);
      return;
    }

    setExpandedProfileId(profileId);
    setDetailMutationNotice(null);
    setExpandedDetail({
      profileId,
      status: "loading",
      data: null,
      error: null,
    });
  }

  function handleExpandedDetailMutation(notice?: DetailMutationNotice) {
    setDetailMutationNotice(notice ?? null);

    if (expandedProfileId) {
      setExpandedDetail({
        profileId: expandedProfileId,
        status: "loading",
        data: null,
        error: null,
      });
    }
    setDetailReloadKey((current) => current + 1);
  }

  function renderBaselineActivity(profile: RecurringProfilesPageData["profiles"][number]) {
    const activityAt = profile.baselineConsent.latestActivityAt;

    if (profile.baselineConsent.state === "missing") {
      const latestRequestOutcome = profile.baselineConsent.latestRequestOutcome;
      if (latestRequestOutcome) {
        const formatted = formatDateTime(latestRequestOutcome.changedAt, locale);

        if (latestRequestOutcome.status === "cancelled") {
          return t("baseline.activity.latestCancelledAt", { date: formatted });
        }

        if (latestRequestOutcome.status === "superseded") {
          return t("baseline.activity.latestReplacedAt", { date: formatted });
        }

        return t("baseline.activity.latestExpiredAt", { date: formatted });
      }

      return t("baseline.activity.missing");
    }

    if (!activityAt) {
      return t("baseline.activity.unknown");
    }

    const formatted = formatDateTime(activityAt, locale);

    if (profile.baselineConsent.state === "pending") {
      return t("baseline.activity.pendingUntil", { date: formatted });
    }

    if (profile.baselineConsent.state === "signed") {
      return t("baseline.activity.signedAt", { date: formatted });
    }

    return t("baseline.activity.revokedAt", { date: formatted });
  }

  return (
    <div className="space-y-6">
      <section className="app-shell rounded-xl px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-3xl">
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">{t("title")}</h1>
            <p className="mt-2 text-sm leading-6 text-zinc-600">{t("subtitle")}</p>
            <p className="mt-2 text-sm leading-6 text-zinc-600">{t("boundaryNote")}</p>
          </div>

          <div className="flex shrink-0 flex-col items-start gap-2">
            {data.access.canManageProfiles ? (
              <>
                <a
                  href="#create-profile"
                  className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700"
                >
                  {t("actions.createProfile")}
                </a>
                <p className="text-sm text-zinc-600">{t("header.manageHint")}</p>
              </>
            ) : (
              <p className="max-w-xs text-sm leading-6 text-zinc-600">{t("header.readOnlyHint")}</p>
            )}
          </div>
        </div>
      </section>

      {data.access.canManageProfiles ? (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <CreateProfileForm profileTypes={data.profileTypes} router={router} />
          <ProfileTypeManager profileTypes={data.profileTypes} router={router} />
        </section>
      ) : null}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="content-card rounded-xl p-5">
          <p className="text-sm font-medium text-zinc-700">{t("summary.activeProfiles")}</p>
          <p className="mt-3 text-2xl font-semibold text-zinc-900">{data.summary.activeProfiles}</p>
        </div>
        <div className="content-card rounded-xl p-5">
          <p className="text-sm font-medium text-zinc-700">{t("summary.archivedProfiles")}</p>
          <p className="mt-3 text-2xl font-semibold text-zinc-900">{data.summary.archivedProfiles}</p>
        </div>
        <div className="content-card rounded-xl p-5">
          <p className="text-sm font-medium text-zinc-700">{t("summary.profileTypes")}</p>
          <p className="mt-3 text-2xl font-semibold text-zinc-900">{data.summary.activeProfileTypes}</p>
        </div>
        <div className="content-card rounded-xl p-5">
          <p className="text-sm font-medium text-zinc-700">{t("summary.activeWithoutType")}</p>
          <p className="mt-3 text-2xl font-semibold text-zinc-900">{data.summary.activeProfilesWithoutType}</p>
        </div>
      </section>

      <section className="content-card rounded-xl p-5">
        <form action="/profiles" method="get" className="flex flex-col gap-4 lg:flex-row lg:items-end">
          <div className="min-w-0 flex-1">
            <label className="mb-2 block text-sm font-medium text-zinc-700" htmlFor="profiles-search">
              {t("filters.searchLabel")}
            </label>
            <input
              id="profiles-search"
              name="q"
              type="search"
              placeholder={t("filters.searchPlaceholder")}
              defaultValue={data.filters.q}
              className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-3 lg:w-auto">
            <div>
              <label className="mb-2 block text-sm font-medium text-zinc-700" htmlFor="profiles-type-filter">
                {t("filters.typeLabel")}
              </label>
              <select
                id="profiles-type-filter"
                name="type"
                defaultValue={data.filters.profileTypeId ?? ""}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm"
              >
                <option value="">{t("filters.allTypes")}</option>
                {data.profileTypes.map((profileType) => (
                  <option key={profileType.id} value={profileType.id}>
                    {profileType.status === "archived"
                      ? `${profileType.label} (${t("status.archived")})`
                      : profileType.label}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-3 rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
              <input name="includeArchived" type="checkbox" value="1" defaultChecked={data.filters.includeArchived} />
              <span>{t("filters.includeArchived")}</span>
            </label>

            <div className="flex items-center gap-3">
              <button
                type="submit"
                className="rounded-lg border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
              >
                {t("filters.apply")}
              </button>
              {hasFilters ? (
                <Link className="text-sm text-zinc-700 underline" href="/profiles">
                  {t("filters.clear")}
                </Link>
              ) : null}
            </div>
          </div>
        </form>
      </section>

      <section className="content-card overflow-hidden rounded-xl">
        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead className="bg-zinc-50">
              <tr>
                <th scope="col" className="border-b border-zinc-200 px-4 py-3 font-medium text-zinc-700">
                  {t("table.columnName")}
                </th>
                <th scope="col" className="border-b border-zinc-200 px-4 py-3 font-medium text-zinc-700">
                  {t("table.columnType")}
                </th>
                <th scope="col" className="border-b border-zinc-200 px-4 py-3 font-medium text-zinc-700">
                  {t("table.columnEmail")}
                </th>
                <th scope="col" className="border-b border-zinc-200 px-4 py-3 font-medium text-zinc-700">
                  {t("table.columnBaselineConsent")}
                </th>
                <th scope="col" className="border-b border-zinc-200 px-4 py-3 font-medium text-zinc-700">
                  {t("table.columnMatching")}
                </th>
                <th scope="col" className="border-b border-zinc-200 px-4 py-3 font-medium text-zinc-700">
                  {t("table.columnStatus")}
                </th>
                <th scope="col" className="border-b border-zinc-200 px-4 py-3 font-medium text-zinc-700">
                  {t("table.columnUpdated")}
                </th>
                <th scope="col" className="border-b border-zinc-200 px-4 py-3 font-medium text-zinc-700">
                  {t("table.columnActions")}
                </th>
              </tr>
            </thead>
            <tbody>
              {data.profiles.length > 0 ? (
                data.profiles.map((profile) => {
                  const isExpanded = expandedProfileId === profile.id;
                  const detailState =
                    expandedDetail && expandedDetail.profileId === profile.id ? expandedDetail : null;

                  return (
                    <Fragment key={profile.id}>
                      <tr className="align-top">
                        <td className="border-b border-zinc-100 px-4 py-4 text-zinc-900">{profile.fullName}</td>
                        <td className="border-b border-zinc-100 px-4 py-4 text-zinc-700">
                          {profile.profileType ? (
                            <div className="space-y-1">
                              <p>{profile.profileType.label}</p>
                              {profile.profileType.status === "archived" ? (
                                <span className="inline-flex rounded-md border border-zinc-300 bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-700">
                                  {t("table.archivedTypeBadge")}
                                </span>
                              ) : null}
                            </div>
                          ) : (
                            <span className="text-zinc-500">{t("table.noType")}</span>
                          )}
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-4 text-zinc-700">{profile.email}</td>
                        <td className="border-b border-zinc-100 px-4 py-4">
                          <div className="space-y-1">
                            <BaselineStatusBadge state={profile.baselineConsent.state} />
                            <p className="text-xs text-zinc-600">{renderBaselineActivity(profile)}</p>
                          </div>
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-4">
                          <MatchingReadinessBadge state={profile.matchingReadiness.state} />
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-4">
                          <ProfileStatusBadge archived={profile.status === "archived"} />
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-4 text-zinc-700">
                          {formatDateTime(profile.updatedAt, locale)}
                        </td>
                        <td className="border-b border-zinc-100 px-4 py-4">
                          <ProfileRowActions
                            profile={profile}
                            canManageProfiles={data.access.canManageProfiles}
                            isExpanded={isExpanded}
                            onToggleExpanded={() => handleToggleExpanded(profile.id)}
                            router={router}
                          />
                        </td>
                      </tr>
                      {isExpanded ? (
                        <tr>
                          <td colSpan={8} className="border-b border-zinc-100 px-4 py-4">
                            {detailState?.status === "loading" || !detailState ? (
                              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-700">
                                {t("detail.loading")}
                              </div>
                            ) : null}
                            {detailState?.status === "error" ? (
                              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
                                {detailState.error}
                              </div>
                            ) : null}
                            {detailState?.status === "ready" ? (
                              <ProfileDetailPanelContent
                                detail={detailState.data}
                                baselineTemplates={data.baselineTemplates}
                                router={router}
                                notice={detailMutationNotice}
                                onMutated={handleExpandedDetailMutation}
                              />
                            ) : null}
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} className="px-4 py-8">
                    <div className="space-y-3">
                      {hasAnyProfiles ? (
                        <>
                          <h2 className="text-lg font-semibold text-zinc-900">{t("empty.filteredTitle")}</h2>
                          <p className="max-w-3xl text-sm leading-6 text-zinc-600">{t("empty.filteredBody")}</p>
                          {hasFilters ? (
                            <Link className="text-sm text-zinc-700 underline" href="/profiles">
                              {t("filters.clear")}
                            </Link>
                          ) : null}
                        </>
                      ) : (
                        <>
                          <h2 className="text-lg font-semibold text-zinc-900">{t("empty.title")}</h2>
                          <p className="max-w-3xl text-sm leading-6 text-zinc-600">{t("empty.body")}</p>
                          <p className="max-w-3xl text-sm leading-6 text-zinc-600">{t("empty.boundary")}</p>
                          {!data.access.canManageProfiles ? (
                            <p className="text-sm text-zinc-600">{t("empty.readOnlyHint")}</p>
                          ) : null}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function ProfilesShell({ data }: ProfilesShellProps) {
  const router = useRouter();

  return <ProfilesShellView data={data} router={router} />;
}
