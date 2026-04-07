import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { LanguageSwitch } from "@/components/i18n/language-switch";
import { createClient } from "@/lib/supabase/server";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const t = await getTranslations("login");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  const resolvedSearchParams = await searchParams;
  const errorCode = resolvedSearchParams.error;
  const errorMessage = errorCode
    ? ({
        invalid_credentials: t("errors.invalidCredentials"),
        invalid_input: t("errors.invalidInput"),
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

        <form action="/auth/login" method="post" className="mt-6 space-y-4">
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

        <Link className="mt-6 text-sm text-zinc-700 underline" href="/">
          {t("backToHome")}
        </Link>
      </section>
    </main>
  );
}
