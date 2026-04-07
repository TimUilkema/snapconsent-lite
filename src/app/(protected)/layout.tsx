import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { LanguageSwitch } from "@/components/i18n/language-switch";
import { ProtectedNav } from "@/components/navigation/protected-nav";
import { createClient } from "@/lib/supabase/server";
import { ensureTenantId } from "@/lib/tenant/resolve-tenant";

type ProtectedLayoutProps = {
  children: React.ReactNode;
};

export default async function ProtectedLayout({ children }: ProtectedLayoutProps) {
  const t = await getTranslations("layout");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  try {
    await ensureTenantId(supabase);
  } catch {
    return (
      <main className="page-frame flex min-h-screen flex-col gap-4 py-10">
        <h1 className="text-2xl font-semibold">{t("workspaceSetupIssueTitle")}</h1>
        <p className="text-sm text-zinc-700">
          {t("workspaceSetupIssueBody")}
        </p>
        <p className="text-sm text-zinc-700">
          {t("workspaceSetupIssueSupport")}
        </p>
        <Link className="text-sm underline" href="/login">
          {t("backToLogin")}
        </Link>
      </main>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-200/80 bg-white/85 backdrop-blur-sm">
        <div className="page-frame flex flex-col gap-4 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/projects" className="text-lg font-semibold tracking-tight text-zinc-900">
              {t("appName")}
            </Link>
            <span className="hidden text-sm text-zinc-400 sm:inline">/</span>
            <span className="text-sm text-zinc-600">{t("workspace")}</span>
          </div>

          <ProtectedNav />

          <div className="flex flex-wrap items-center gap-3 lg:justify-end">
            <LanguageSwitch />
            <span className="text-sm text-zinc-600">{user.email ?? t("signedIn")}</span>
            <form action="/auth/logout" method="post">
              <button
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
                type="submit"
              >
                {t("signOut")}
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="page-frame py-6 sm:py-8">{children}</div>
    </div>
  );
}
