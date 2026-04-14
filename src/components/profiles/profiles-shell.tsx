"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";

import { createIdempotencyKey } from "@/lib/client/idempotency-key";
import { resolveLocalizedApiError } from "@/lib/i18n/error-message";
import { formatDateTime } from "@/lib/i18n/format";
import type { RecurringProfilesPageData } from "@/lib/profiles/profile-directory-service";

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

function DisabledButton({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      disabled
      aria-disabled="true"
      className={`rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-500 opacity-70 ${className}`.trim()}
    >
      {children}
    </button>
  );
}

function StatusBadge({ archived }: { archived: boolean }) {
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
  const locale = useLocale();

  const hasAnyProfiles = data.summary.activeProfiles + data.summary.archivedProfiles > 0;
  const hasFilters =
    data.filters.q.length > 0 || data.filters.profileTypeId !== null || data.filters.includeArchived;

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
                data.profiles.map((profile) => (
                  <tr key={profile.id} className="align-top">
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
                      <StatusBadge archived={profile.status === "archived"} />
                    </td>
                    <td className="border-b border-zinc-100 px-4 py-4 text-zinc-700">
                      {formatDateTime(profile.updatedAt, locale)}
                    </td>
                    <td className="border-b border-zinc-100 px-4 py-4">
                      {data.access.canManageProfiles && profile.status === "active" ? (
                        <ProfileArchiveButton profileId={profile.id} router={router} />
                      ) : (
                        <span className="text-zinc-400">{t("table.noActions")}</span>
                      )}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={6} className="px-4 py-8">
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

      <section className="content-card rounded-xl p-5">
        <h2 className="text-lg font-semibold text-zinc-900">{t("deferred.title")}</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">{t("deferred.body")}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <DisabledButton>{t("actions.requestBaselineConsent")}</DisabledButton>
          <DisabledButton>{t("actions.sendReminder")}</DisabledButton>
          <DisabledButton>{t("actions.requestExtraConsent")}</DisabledButton>
          <DisabledButton>{t("actions.importProfiles")}</DisabledButton>
          <DisabledButton>{t("actions.syncDirectory")}</DisabledButton>
        </div>
      </section>
    </div>
  );
}

export function ProfilesShell({ data }: ProfilesShellProps) {
  const router = useRouter();

  return <ProfilesShellView data={data} router={router} />;
}
