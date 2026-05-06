import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { LanguageSwitch } from "@/components/i18n/language-switch";
import { createClient } from "@/lib/supabase/server";
import { listCurrentUserTenantMemberships } from "@/lib/tenant/active-tenant";
import { getUsablePendingOrgInvitePath } from "@/lib/tenant/pending-org-invite";
import { PENDING_ORG_INVITE_COOKIE_NAME } from "@/lib/tenant/tenant-cookies";

type CreateAccountPageProps = {
  searchParams: Promise<{
    auth_error?: string;
    confirmation?: string;
  }>;
};

function getAuthErrorMessage(
  t: Awaited<ReturnType<typeof getTranslations>>,
  errorCode: string | undefined,
) {
  if (!errorCode) {
    return null;
  }

  return (
    {
      invalid_input: t("errors.invalidInput"),
      account_exists: t("errors.accountExists"),
      weak_password: t("errors.weakPassword"),
      sign_up_failed: t("errors.signUpFailed"),
    }[errorCode] ?? t("errors.fallback")
  );
}

export default async function CreateAccountPage({ searchParams }: CreateAccountPageProps) {
  const t = await getTranslations("createAccount");
  const resolvedSearchParams = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user?.email_confirmed_at) {
    const cookieStore = await cookies();
    const pendingInviteToken = cookieStore.get(PENDING_ORG_INVITE_COOKIE_NAME)?.value;
    const pendingInvitePath = await getUsablePendingOrgInvitePath(supabase, pendingInviteToken);
    if (pendingInvitePath) {
      redirect(pendingInvitePath);
    }

    const memberships = await listCurrentUserTenantMemberships(supabase, user.id);
    if (memberships.length === 0) {
      redirect("/organization/setup");
    }
    if (memberships.length === 1) {
      redirect("/projects");
    }
    redirect("/select-tenant");
  }

  const errorMessage = getAuthErrorMessage(t, resolvedSearchParams.auth_error);
  const showCheckEmail = resolvedSearchParams.confirmation === "1" || !!user;

  return (
    <main className="page-frame flex min-h-screen items-center justify-center py-8 sm:py-10">
      <section className="app-shell w-full max-w-md rounded-2xl px-6 py-8 sm:px-8">
        <div className="mb-6 flex justify-end">
          <LanguageSwitch />
        </div>

        {showCheckEmail ? (
          <>
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">
              {t("checkEmailTitle")}
            </h1>
            <p className="mt-3 text-sm leading-6 text-zinc-600">
              {user ? t("checkEmailSignedInBody") : t("checkEmailBody")}
            </p>
            {user ? (
              <form action="/auth/logout" method="post" className="mt-6">
                <button
                  className="w-full rounded-lg bg-zinc-900 px-4 py-3 text-sm font-medium text-white hover:bg-zinc-800"
                  type="submit"
                >
                  {t("signOut")}
                </button>
              </form>
            ) : (
              <Link
                className="mt-6 inline-flex w-full items-center justify-center rounded-lg bg-zinc-900 px-4 py-3 text-sm font-medium text-white hover:bg-zinc-800"
                href="/login"
              >
                {t("backToLogin")}
              </Link>
            )}
          </>
        ) : (
          <>
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">{t("title")}</h1>
            <p className="mt-2 text-sm leading-6 text-zinc-600">{t("subtitle")}</p>

            {errorMessage ? (
              <p className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {errorMessage}
              </p>
            ) : null}

            <form action="/auth/sign-up" method="post" className="mt-6 space-y-4">
              <input type="hidden" name="next" value="/dashboard" />
              <input type="hidden" name="confirmation_redirect" value="/create-account" />
              <input type="hidden" name="error_redirect" value="/create-account" />
              <label className="block text-sm">
                <span className="mb-1 block font-medium">{t("emailLabel")}</span>
                <input
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 shadow-sm outline-none focus:border-zinc-400"
                  type="email"
                  name="email"
                  autoComplete="email"
                  required
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block font-medium">{t("passwordLabel")}</span>
                <input
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 shadow-sm outline-none focus:border-zinc-400"
                  type="password"
                  name="password"
                  autoComplete="new-password"
                  required
                />
              </label>
              <button
                className="w-full rounded-lg bg-zinc-900 px-4 py-3 text-sm font-medium text-white hover:bg-zinc-800"
                type="submit"
              >
                {t("submit")}
              </button>
            </form>

            <Link className="mt-6 inline-block text-sm text-zinc-700 underline" href="/login">
              {t("backToLogin")}
            </Link>
          </>
        )}
      </section>
    </main>
  );
}
