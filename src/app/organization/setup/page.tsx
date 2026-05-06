import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { LanguageSwitch } from "@/components/i18n/language-switch";
import { createClient } from "@/lib/supabase/server";
import { listCurrentUserTenantMemberships } from "@/lib/tenant/active-tenant";
import { DEFAULT_FIRST_ORGANIZATION_NAME } from "@/lib/tenant/first-organization";
import { getUsablePendingOrgInvitePath } from "@/lib/tenant/pending-org-invite";
import { PENDING_ORG_INVITE_COOKIE_NAME } from "@/lib/tenant/tenant-cookies";

type OrganizationSetupPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

function getSetupErrorMessage(
  t: Awaited<ReturnType<typeof getTranslations>>,
  errorCode: string | undefined,
) {
  if (!errorCode) {
    return null;
  }

  return (
    {
      invalid_organization_name: t("errors.invalidName"),
      missing_organization_name: t("errors.missingName"),
      unauthenticated: t("errors.unauthenticated"),
      organization_setup_failed: t("errors.setupFailed"),
    }[errorCode] ?? t("errors.fallback")
  );
}

export default async function OrganizationSetupPage({ searchParams }: OrganizationSetupPageProps) {
  const t = await getTranslations("organizationSetup");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=%2Forganization%2Fsetup");
  }

  if (!user.email_confirmed_at) {
    redirect("/create-account?confirmation=1");
  }

  const cookieStore = await cookies();
  const pendingInviteToken = cookieStore.get(PENDING_ORG_INVITE_COOKIE_NAME)?.value;
  const pendingInvitePath = await getUsablePendingOrgInvitePath(supabase, pendingInviteToken);
  if (pendingInvitePath) {
    redirect(pendingInvitePath);
  }

  const memberships = await listCurrentUserTenantMemberships(supabase, user.id);
  if (memberships.length === 1) {
    redirect("/projects");
  }
  if (memberships.length > 1) {
    redirect("/select-tenant");
  }

  const resolvedSearchParams = await searchParams;
  const errorMessage = getSetupErrorMessage(t, resolvedSearchParams.error);

  return (
    <main className="page-frame flex min-h-screen items-center justify-center py-8 sm:py-10">
      <section className="app-shell w-full max-w-lg rounded-2xl px-6 py-8 sm:px-8">
        <div className="mb-6 flex justify-end">
          <LanguageSwitch />
        </div>
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">{t("title")}</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600">{t("helper")}</p>

        {errorMessage ? (
          <p className="mt-5 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorMessage}
          </p>
        ) : null}

        <form action="/organization/setup/create" method="post" className="mt-6 space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">{t("nameLabel")}</span>
            <input
              className="w-full rounded-lg border border-zinc-300 px-3 py-2.5 shadow-sm outline-none focus:border-zinc-400"
              type="text"
              name="organization_name"
              autoComplete="organization"
              maxLength={120}
              placeholder={DEFAULT_FIRST_ORGANIZATION_NAME}
            />
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <button
              className="rounded-lg bg-zinc-900 px-4 py-3 text-sm font-medium text-white hover:bg-zinc-800"
              type="submit"
              name="intent"
              value="custom"
            >
              {t("create")}
            </button>
            <button
              className="rounded-lg border border-zinc-300 bg-white px-4 py-3 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
              type="submit"
              name="intent"
              value="default"
            >
              {t("continueDefault")}
            </button>
          </div>
        </form>

        <div className="mt-6 flex flex-wrap gap-3 text-sm">
          <span className="text-zinc-600">{user.email ?? t("signedInFallback")}</span>
          <form action="/auth/logout" method="post">
            <button type="submit" className="text-zinc-700 underline">
              {t("signOut")}
            </button>
          </form>
          <Link className="text-zinc-700 underline" href="/">
            {t("backToHome")}
          </Link>
        </div>
      </section>
    </main>
  );
}
