import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { LanguageSwitch } from "@/components/i18n/language-switch";
import { createClient } from "@/lib/supabase/server";
import { listCurrentUserTenantMemberships } from "@/lib/tenant/active-tenant";
import { getUsablePendingOrgInvitePath } from "@/lib/tenant/pending-org-invite";
import { PENDING_ORG_INVITE_COOKIE_NAME } from "@/lib/tenant/tenant-cookies";

type LoginPageProps = {
  searchParams: Promise<{
    confirmed?: string;
    confirmation?: string;
    error?: string;
    next?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const t = await getTranslations("login");
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

  const resolvedSearchParams = await searchParams;
  const errorCode = resolvedSearchParams.error;
  const next = resolvedSearchParams.next;
  const infoMessage = user
    ? t("signedInUnconfirmed")
    : resolvedSearchParams.confirmed === "1"
      ? t("confirmed")
      : resolvedSearchParams.confirmation === "1"
        ? t("confirmationRequired")
        : null;
  const errorMessage = errorCode
    ? ({
        invalid_credentials: t("errors.invalidCredentials"),
        invalid_input: t("errors.invalidInput"),
        account_exists: t("errors.accountExists"),
        weak_password: t("errors.weakPassword"),
        sign_up_failed: t("errors.signUpFailed"),
      }[errorCode] ?? t("errors.fallback"))
    : null;

  return (
    <main className="page-frame flex min-h-screen items-center justify-center py-8 sm:py-10">
      <section className="app-shell w-full max-w-md rounded-2xl px-6 py-8 sm:px-8">
        <div className="mb-6 flex justify-end">
          <LanguageSwitch />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">{t("title")}</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600">{t("subtitle")}</p>

        {errorMessage ? (
          <p className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorMessage}
          </p>
        ) : null}

        {infoMessage ? (
          <p className="mt-4 rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {infoMessage}
          </p>
        ) : null}

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
          <form action="/auth/login" method="post" className="mt-6 space-y-4">
            {typeof next === "string" && next.startsWith("/") ? <input type="hidden" name="next" value={next} /> : null}
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
                autoComplete="current-password"
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
        )}

        <div className="mt-6 flex flex-wrap gap-3 text-sm">
          <Link className="text-zinc-700 underline" href="/">
            {t("backToHome")}
          </Link>
          <Link className="text-zinc-700 underline" href="/create-account">
            {t("createAccount")}
          </Link>
        </div>
      </section>
    </main>
  );
}
