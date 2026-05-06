import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { LanguageSwitch } from "@/components/i18n/language-switch";
import { createClient } from "@/lib/supabase/server";
import { listCurrentUserTenantMemberships } from "@/lib/tenant/active-tenant";
import { getUsablePendingOrgInvitePath } from "@/lib/tenant/pending-org-invite";
import { ACTIVE_TENANT_COOKIE_NAME, PENDING_ORG_INVITE_COOKIE_NAME } from "@/lib/tenant/tenant-cookies";

type SelectTenantPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

function formatRoleLabel(
  role: "owner" | "admin" | "reviewer" | "photographer",
  t: Awaited<ReturnType<typeof getTranslations>>,
) {
  switch (role) {
    case "owner":
      return t("roles.owner");
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

export default async function SelectTenantPage({ searchParams }: SelectTenantPageProps) {
  const t = await getTranslations("activeTenant");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=%2Fselect-tenant");
  }

  if (!user.email_confirmed_at) {
    redirect("/create-account?confirmation=1");
  }

  const cookieStore = await cookies();
  const pendingOrgInviteToken = cookieStore.get(PENDING_ORG_INVITE_COOKIE_NAME)?.value ?? null;
  const activeTenantCookie = cookieStore.get(ACTIVE_TENANT_COOKIE_NAME)?.value ?? null;
  const memberships = await listCurrentUserTenantMemberships(supabase, user.id);
  const resolvedSearchParams = await searchParams;
  const invalidSelection = resolvedSearchParams.error === "invalid_selection";

  if (memberships.length === 0) {
    const pendingInvitePath = await getUsablePendingOrgInvitePath(supabase, pendingOrgInviteToken);
    if (pendingInvitePath) {
      redirect(pendingInvitePath);
    }

    redirect("/organization/setup");
  }

  if (memberships.length === 1) {
    redirect("/projects");
  }

  if (activeTenantCookie && memberships.some((membership) => membership.tenantId === activeTenantCookie)) {
    redirect("/projects");
  }

  return (
    <main className="page-frame flex min-h-screen items-center py-8 sm:py-10">
      <section className="app-shell mx-auto w-full max-w-3xl rounded-xl px-6 py-7 sm:px-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-zinc-900">{t("title")}</p>
            <p className="mt-1 text-sm text-zinc-600">{t("subtitle")}</p>
          </div>
          <LanguageSwitch />
        </div>

        {invalidSelection ? (
          <p className="mb-5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {t("errors.invalidSelection")}
          </p>
        ) : null}

        <div className="space-y-4">
          {memberships.map((membership) => (
            <section
              key={membership.tenantId}
              className="rounded-lg border border-zinc-200 bg-white px-4 py-4 sm:flex sm:items-center sm:justify-between sm:gap-4"
            >
              <div className="space-y-1">
                <p className="text-base font-semibold text-zinc-900">{membership.tenantName}</p>
                <p className="text-sm text-zinc-600">
                  {t("roleLabel", { role: formatRoleLabel(membership.role, t) })}
                </p>
              </div>
              <form action="/api/tenants/active" method="post" className="mt-4 sm:mt-0">
                <input type="hidden" name="tenant_id" value={membership.tenantId} />
                <input type="hidden" name="next" value="/projects" />
                <input type="hidden" name="error_redirect" value="/select-tenant" />
                <button
                  type="submit"
                  className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800"
                >
                  {t("choose")}
                </button>
              </form>
            </section>
          ))}
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-4">
          <span className="text-sm text-zinc-600">{user.email ?? t("signedInFallback")}</span>
          <form action="/auth/logout" method="post">
            <button type="submit" className="text-sm text-zinc-700 underline">
              {t("signOut")}
            </button>
          </form>
          <Link href="/" className="text-sm text-zinc-700 underline">
            {t("backToHome")}
          </Link>
        </div>
      </section>
    </main>
  );
}
