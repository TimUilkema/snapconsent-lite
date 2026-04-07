import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { LanguageSwitch } from "@/components/i18n/language-switch";

type RevokePageProps = {
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
  t: Awaited<ReturnType<typeof getTranslations>>,
): Notice | null {
  if (status === "revoked") {
    return { tone: "success", text: t("messages.revoked") };
  }

  if (status === "already") {
    return { tone: "neutral", text: t("messages.already") };
  }

  if (error === "invalid") {
    return { tone: "error", text: t("messages.invalid") };
  }

  if (error === "expired") {
    return { tone: "error", text: t("messages.expired") };
  }

  return null;
}

export default async function RevokePage({ params, searchParams }: RevokePageProps) {
  const t = await getTranslations("publicRevoke");
  const { token } = await params;
  const resolvedSearchParams = await searchParams;
  const message = getMessage(resolvedSearchParams.status, resolvedSearchParams.error, t);

  return (
    <main className="page-frame flex min-h-screen py-8 sm:py-10">
      <section className="app-shell flex w-full flex-col gap-4 rounded-2xl px-5 py-6 sm:px-7 sm:py-7">
        <div className="flex justify-end">
          <LanguageSwitch />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">{t("title")}</h1>
        <p className="text-sm text-zinc-700">{t("subtitle")}</p>

        {message ? (
          <p
            className={`rounded-xl px-3 py-2 text-sm ${
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

        <form
          action={`/r/${token}/revoke`}
          method="post"
          className="content-card space-y-3 rounded-2xl p-4"
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

        <Link href="/" className="text-sm text-zinc-700 underline">
          {t("backToHome")}
        </Link>
      </section>
    </main>
  );
}
