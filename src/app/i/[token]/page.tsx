import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";

import { LanguageSwitch } from "@/components/i18n/language-switch";
import { PublicConsentForm } from "@/components/public/public-consent-form";
import { formatDateTime } from "@/lib/i18n/format";
import { createClient } from "@/lib/supabase/server";

type InvitePageProps = {
  params: Promise<{
    token: string;
  }>;
  searchParams: Promise<{
    error?: string;
    success?: string;
    duplicate?: string;
    receipt?: string;
  }>;
};

type InviteView = {
  invite_id: string;
  project_id: string;
  project_name: string;
  expires_at: string | null;
  status: string;
  can_sign: boolean;
  consent_text: string | null;
  consent_version: string | null;
};

function mapError(error: string | undefined, t: Awaited<ReturnType<typeof getTranslations>>) {
  if (!error) {
    return null;
  }

  switch (error) {
    case "invalid":
      return t("errors.invalid");
    case "expired":
      return t("errors.expired");
    case "unavailable":
      return t("errors.unavailable");
    case "server":
      return t("errors.server");
    case "headshot_required":
      return t("errors.headshot_required");
    default:
      return t("errors.fallback");
  }
}

export default async function PublicInvitePage({ params, searchParams }: InvitePageProps) {
  const locale = await getLocale();
  const t = await getTranslations("publicInvite");
  const { token } = await params;
  const resolvedSearchParams = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_public_invite", { p_token: token });
  const invite = (data?.[0] as InviteView | undefined) ?? null;

  const errorMessage = mapError(resolvedSearchParams.error, t);
  const showSuccess = resolvedSearchParams.success === "1";
  const showDuplicate = resolvedSearchParams.duplicate === "1";
  const receiptStatus = resolvedSearchParams.receipt;

  return (
    <main className="page-frame flex min-h-screen flex-col py-8 sm:py-10">
      <section className="app-shell flex w-full flex-col gap-4 rounded-2xl px-5 py-6 sm:px-7 sm:py-7">
        <div className="flex justify-end">
          <LanguageSwitch />
        </div>
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">{t("title")}</h1>
          {invite ? (
            <p className="text-sm text-zinc-700">
              {t("projectLine", { projectName: invite.project_name, status: invite.status })}
              {invite.expires_at ? ` · ${t("expiresOn", { date: formatDateTime(invite.expires_at, locale) })}` : ""}
            </p>
          ) : (
            <p className="text-sm text-zinc-700">{t("lookupLabel")}</p>
          )}
        </div>

        {errorMessage ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorMessage}
          </p>
        ) : null}
        {showSuccess ? (
          <p className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
            {t("success")}
          </p>
        ) : null}
        {showDuplicate ? (
          <p className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
            {t("duplicate")}
          </p>
        ) : null}
        {receiptStatus === "queued" ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            {t("receiptQueued")}
          </p>
        ) : null}

        {invite?.can_sign ? (
          <PublicConsentForm
            token={token}
            consentText={invite.consent_text}
            consentVersion={invite.consent_version}
          />
        ) : (
          <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
            {t("cannotSubmit")}
          </p>
        )}

        <Link href="/" className="text-sm text-zinc-700 underline">
          {t("backToHome")}
        </Link>
      </section>
    </main>
  );
}
