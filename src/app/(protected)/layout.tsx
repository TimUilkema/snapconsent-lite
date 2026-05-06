import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { LanguageSwitch } from "@/components/i18n/language-switch";
import { ActiveTenantSwitcher } from "@/components/navigation/active-tenant-switcher";
import { ProtectedNav } from "@/components/navigation/protected-nav";
import { HttpError } from "@/lib/http/errors";
import { resolveProfilesAccess } from "@/lib/profiles/profile-access";
import { createClient } from "@/lib/supabase/server";
import { resolveTemplateManagementAccess } from "@/lib/templates/template-service";
import { listCurrentUserTenantMemberships } from "@/lib/tenant/active-tenant";
import { resolveMediaLibraryAccess } from "@/lib/tenant/media-library-custom-role-access";
import {
  hasAnyOrganizationUserAccess,
  resolveOrganizationUserAccess,
} from "@/lib/tenant/organization-user-access";
import { PENDING_ORG_INVITE_COOKIE_NAME } from "@/lib/tenant/tenant-cookies";
import { ensureTenantId } from "@/lib/tenant/resolve-tenant";
import { buildTenantMembershipInvitePath } from "@/lib/url/paths";

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

  if (!user.email_confirmed_at) {
    redirect("/create-account?confirmation=1");
  }

  let showMembers = false;
  let showMediaLibrary = false;
  let showProfiles = false;
  let showTemplates = false;
  let workspaceSetupFailed = false;
  let activeTenantId = "";
  let memberships = [] as Awaited<ReturnType<typeof listCurrentUserTenantMemberships>>;

  try {
    const tenantId = await ensureTenantId(supabase, { authenticatedUserId: user.id });
    const [organizationUserAccess, mediaLibraryAccess, profileAccess, templateAccess] = await Promise.all([
      resolveOrganizationUserAccess({
        supabase,
        tenantId,
        userId: user.id,
      }),
      resolveMediaLibraryAccess({
        supabase,
        tenantId,
        userId: user.id,
      }),
      resolveProfilesAccess(supabase, tenantId, user.id),
      resolveTemplateManagementAccess(supabase, tenantId, user.id),
    ]);
    memberships = await listCurrentUserTenantMemberships(supabase, user.id);
    activeTenantId = tenantId;
    showMembers = hasAnyOrganizationUserAccess(organizationUserAccess);
    showMediaLibrary = mediaLibraryAccess.canAccess;
    showProfiles = profileAccess.canViewProfiles || profileAccess.canManageProfiles;
    showTemplates = templateAccess.canManageTemplates;
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.code === "active_tenant_required") {
        redirect("/select-tenant");
      }

      if (error.code === "pending_org_invite_acceptance_required") {
        const cookieStore = await cookies();
        const inviteToken = cookieStore.get(PENDING_ORG_INVITE_COOKIE_NAME)?.value ?? null;
        if (inviteToken) {
          redirect(buildTenantMembershipInvitePath(inviteToken));
        }
      }

      if (error.code === "organization_setup_required") {
        redirect("/organization/setup");
      }
    }

    workspaceSetupFailed = true;
  }

  if (workspaceSetupFailed) {
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
          <div className="flex flex-wrap items-center">
            <Link href="/projects" className="text-lg font-semibold tracking-tight text-zinc-900">
              {t("appName")}
            </Link>
          </div>

          <ProtectedNav
            showMembers={showMembers}
            showMediaLibrary={showMediaLibrary}
            showProfiles={showProfiles}
            showTemplates={showTemplates}
          />

          <div className="flex flex-wrap items-center gap-3 lg:justify-end">
            <ActiveTenantSwitcher
              memberships={memberships}
              activeTenantId={activeTenantId}
              label={t("workspace")}
              submitLabel={t("switchWorkspace")}
            />
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
