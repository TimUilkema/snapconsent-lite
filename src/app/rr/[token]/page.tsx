import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { LanguageSwitch } from "@/components/i18n/language-switch";
import { getPublicRecurringRevokeToken } from "@/lib/recurring-consent/revoke-recurring-profile-consent";
import { createClient } from "@/lib/supabase/server";

type RecurringRevokePageProps = {
  params: Promise<{
    token: string;
  }>;
  searchParams: Promise<{
    status?: string;
    error?: string;
  }>;
};

type Notice = {
  tone: "success" | "neutral" | "error";
  text: string;
};

function getMessage(
  status: string | undefined,
  error: string | undefined,
  tokenStatus: "available" | "revoked" | "expired" | null,
  t: Awaited<ReturnType<typeof getTranslations>>,
): Notice | null {
  if (status === "revoked") {
    return { tone: "success", text: t("messages.revoked") };
  }

  if (status === "already" || tokenStatus === "revoked") {
    return { tone: "neutral", text: t("messages.already") };
  }

  if (error === "invalid" || tokenStatus === null) {
    return { tone: "error", text: t("messages.invalid") };
  }

  if (error === "expired" || tokenStatus === "expired") {
    return { tone: "error", text: t("messages.expired") };
  }

  return null;
}

export default async function RecurringRevokePage({ params, searchParams }: RecurringRevokePageProps) {
  const t = await getTranslations("publicRecurringRevoke");
  const { token } = await params;
  const resolvedSearchParams = await searchParams;
  const supabase = await createClient();
  const revokeToken = await getPublicRecurringRevokeToken(supabase, token);
  const message = getMessage(
    resolvedSearchParams.status,
    resolvedSearchParams.error,
    revokeToken?.status ?? null,
    t,
  );

  return (
    <main className="page-frame flex min-h-screen py-8 sm:py-10">
      <section className="app-shell flex w-full flex-col gap-4 rounded-xl px-5 py-6 sm:px-7 sm:py-7">
        <div className="flex justify-end">
          <LanguageSwitch />
        </div>

        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">{t("title")}</h1>
        <p className="text-sm text-zinc-700">{t("subtitle")}</p>
        {revokeToken ? (
          <p className="text-sm text-zinc-600">
            {t("profileLabel", {
              name: revokeToken.profileName,
              email: revokeToken.profileEmail,
            })}
          </p>
        ) : null}

        {message ? (
          <p
            className={`rounded-lg px-3 py-2 text-sm ${
              message.tone === "success"
                ? "border border-green-200 bg-green-50 text-green-700"
                : message.tone === "error"
                  ? "border border-red-200 bg-red-50 text-red-700"
                  : "border border-zinc-200 bg-zinc-50 text-zinc-700"
            }`}
          >
            {message.text}
          </p>
        ) : null}

        {revokeToken?.status === "available" ? (
          <form
            action={`/rr/${token}/revoke`}
            method="post"
            className="content-card space-y-3 rounded-xl p-4"
          >
            <label className="block text-sm">
              <span className="mb-1 block font-medium">{t("reasonLabel")}</span>
              <textarea
                name="reason"
                className="w-full rounded-lg border border-zinc-300 bg-white px-3 py-2"
                rows={3}
                maxLength={300}
              />
            </label>
            <button
              type="submit"
              className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-700"
            >
              {t("submit")}
            </button>
          </form>
        ) : null}

        <Link href="/" className="text-sm text-zinc-700 underline">
          {t("backToHome")}
        </Link>
      </section>
    </main>
  );
}
