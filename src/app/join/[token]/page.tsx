import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { LanguageSwitch } from "@/components/i18n/language-switch";
import { createClient } from "@/lib/supabase/server";
import { getPublicTenantMembershipInvite } from "@/lib/tenant/membership-invites";

type JoinInvitePageProps = {
  params: Promise<{
    token: string;
  }>;
  searchParams: Promise<{
    auth_error?: string;
    auth_mode?: string;
    confirmation?: string;
    error?: string;
  }>;
};

function formatRoleLabel(
  role: "admin" | "reviewer" | "photographer",
  t: Awaited<ReturnType<typeof getTranslations>>,
) {
  switch (role) {
    case "admin":
      return t("roles.admin");
    case "reviewer":
      return t("roles.reviewer");
    case "photographer":
      return t("roles.photographer");
    default:
      return role;
  }
}

function mapInviteError(error: string | undefined, t: Awaited<ReturnType<typeof getTranslations>>) {
  switch (error) {
    case "invalid":
      return t("errors.invalid");
    case "expired":
      return t("errors.expired");
    case "revoked":
      return t("errors.revoked");
    case "mismatch":
      return t("errors.mismatch");
    case "signin_required":
      return t("errors.signInRequired");
    case "server":
      return t("errors.server");
    default:
      return null;
  }
}

function mapAuthError(error: string | undefined, t: Awaited<ReturnType<typeof getTranslations>>) {
  switch (error) {
    case "invalid_credentials":
      return t("authErrors.invalidCredentials");
    case "invalid_input":
      return t("authErrors.invalidInput");
    case "account_exists":
      return t("authErrors.accountExists");
    case "weak_password":
      return t("authErrors.weakPassword");
    case "sign_up_failed":
      return t("authErrors.signUpFailed");
    default:
      return null;
  }
}

export default async function JoinInvitePage({ params, searchParams }: JoinInvitePageProps) {
  const { token } = await params;
  const resolvedSearchParams = await searchParams;
  const t = await getTranslations("tenantMembershipInvite");
  const supabase = await createClient();
  const invite = await getPublicTenantMembershipInvite(supabase, token);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const inviteError = mapInviteError(resolvedSearchParams.error, t);
  const authError = mapAuthError(resolvedSearchParams.auth_error, t);
  const authMode = resolvedSearchParams.auth_mode === "signup" ? "signup" : "signin";
  const confirmationRequired = resolvedSearchParams.confirmation === "1";
  const signedInEmail = user?.email?.trim().toLowerCase() ?? null;
  const invitedEmail = invite?.email.trim().toLowerCase() ?? null;
  const emailMatches = signedInEmail && invitedEmail ? signedInEmail === invitedEmail : false;

  return (
    <main className="page-frame flex min-h-screen items-center py-8 sm:py-10">
      <section className="app-shell mx-auto w-full max-w-2xl rounded-xl px-6 py-7 sm:px-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-zinc-900">{t("title")}</p>
            <p className="mt-1 text-sm text-zinc-600">{t("subtitle")}</p>
          </div>
          <LanguageSwitch />
        </div>

        {!invite ? (
          <div className="space-y-4">
            <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {t("errors.invalid")}
            </p>
            <Link href="/" className="text-sm text-zinc-700 underline">
              {t("backToHome")}
            </Link>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-4 sm:grid-cols-2">
              <div>
                <p className="text-sm font-medium text-zinc-700">{t("labels.organization")}</p>
                <p className="mt-1 text-sm text-zinc-900">{invite.tenantName}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-zinc-700">{t("labels.role")}</p>
                <p className="mt-1 text-sm text-zinc-900">{formatRoleLabel(invite.role, t)}</p>
              </div>
              <div className="sm:col-span-2">
                <p className="text-sm font-medium text-zinc-700">{t("labels.email")}</p>
                <p className="mt-1 text-sm text-zinc-900">{invite.email}</p>
              </div>
            </div>

            {inviteError ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {inviteError}
              </p>
            ) : null}
            {authError ? (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {authError}
              </p>
            ) : null}
            {confirmationRequired ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                {t("confirmationRequired")}
              </p>
            ) : null}

            {invite.status !== "pending" || !invite.canAccept ? (
              <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
                {invite.status === "accepted"
                  ? t("states.accepted")
                  : invite.status === "revoked"
                    ? t("states.revoked")
                    : t("states.expired")}
              </p>
            ) : user ? (
              emailMatches ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-4">
                    <p className="text-sm font-medium text-green-900">{t("signedInAs", { email: user.email ?? invite.email })}</p>
                    <p className="mt-1 text-sm text-green-800">{t("readyToJoin")}</p>
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <form action={`/join/${token}/accept`} method="post">
                      <button
                        type="submit"
                        className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800"
                      >
                        {t("accept")}
                      </button>
                    </form>
                    <form action="/auth/logout" method="post">
                      <button
                        type="submit"
                        className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
                      >
                        {t("signOut")}
                      </button>
                    </form>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-4">
                    <p className="text-sm font-medium text-red-900">{t("signedInAs", { email: user.email ?? t("unknownEmail") })}</p>
                    <p className="mt-1 text-sm text-red-800">{t("wrongEmailBody", { invitedEmail: invite.email })}</p>
                  </div>
                  <form action="/auth/logout" method="post">
                    <button
                      type="submit"
                      className="rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
                    >
                      {t("signOutAndRetry")}
                    </button>
                  </form>
                </div>
              )
            ) : (
              <div className="grid gap-6 lg:grid-cols-2">
                <section className="rounded-lg border border-zinc-200 px-4 py-4">
                  <p className="text-sm font-medium text-zinc-900">{t("signInTitle")}</p>
                  <p className="mt-1 text-sm text-zinc-600">{t("signInBody")}</p>
                  <form action="/auth/login" method="post" className="mt-4 space-y-4">
                    <input type="hidden" name="email" value={invite.email} />
                    <input type="hidden" name="next" value={`/join/${token}`} />
                    <input type="hidden" name="error_redirect" value={`/join/${token}`} />
                    <input type="hidden" name="pending_org_invite_token" value={token} />
                    <div>
                      <label className="mb-1 block text-sm font-medium text-zinc-800" htmlFor="join-signin-email">
                        {t("labels.email")}
                      </label>
                      <input
                        id="join-signin-email"
                        type="email"
                        value={invite.email}
                        disabled
                        className="w-full rounded-lg border border-zinc-300 bg-zinc-100 px-3 py-2.5 text-sm text-zinc-700"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-zinc-800" htmlFor="join-signin-password">
                        {t("labels.password")}
                      </label>
                      <input
                        id="join-signin-password"
                        name="password"
                        type="password"
                        autoComplete="current-password"
                        required
                        className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-zinc-400"
                      />
                    </div>
                    <button
                      type="submit"
                      className={`rounded-lg px-4 py-2.5 text-sm font-medium ${
                        authMode === "signin"
                          ? "bg-zinc-900 text-white hover:bg-zinc-800"
                          : "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50"
                      }`}
                    >
                      {t("signInSubmit")}
                    </button>
                  </form>
                </section>

                <section className="rounded-lg border border-zinc-200 px-4 py-4">
                  <p className="text-sm font-medium text-zinc-900">{t("signUpTitle")}</p>
                  <p className="mt-1 text-sm text-zinc-600">{t("signUpBody")}</p>
                  <form action="/auth/sign-up" method="post" className="mt-4 space-y-4">
                    <input type="hidden" name="email" value={invite.email} />
                    <input type="hidden" name="next" value={`/join/${token}`} />
                    <input type="hidden" name="error_redirect" value={`/join/${token}`} />
                    <input type="hidden" name="pending_org_invite_token" value={token} />
                    <div>
                      <label className="mb-1 block text-sm font-medium text-zinc-800" htmlFor="join-signup-email">
                        {t("labels.email")}
                      </label>
                      <input
                        id="join-signup-email"
                        type="email"
                        value={invite.email}
                        disabled
                        className="w-full rounded-lg border border-zinc-300 bg-zinc-100 px-3 py-2.5 text-sm text-zinc-700"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-zinc-800" htmlFor="join-signup-password">
                        {t("labels.password")}
                      </label>
                      <input
                        id="join-signup-password"
                        name="password"
                        type="password"
                        autoComplete="new-password"
                        required
                        className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 text-sm text-zinc-900 outline-none focus:border-zinc-400"
                      />
                    </div>
                    <button
                      type="submit"
                      className={`rounded-lg px-4 py-2.5 text-sm font-medium ${
                        authMode === "signup"
                          ? "bg-zinc-900 text-white hover:bg-zinc-800"
                          : "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50"
                      }`}
                    >
                      {t("signUpSubmit")}
                    </button>
                  </form>
                </section>
              </div>
            )}

            <Link href="/" className="text-sm text-zinc-700 underline">
              {t("backToHome")}
            </Link>
          </div>
        )}
      </section>
    </main>
  );
}
