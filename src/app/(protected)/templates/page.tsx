import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { TemplateCreateForm } from "@/components/templates/template-create-form";
import { TemplateStatusBadge } from "@/components/templates/template-status-badge";
import { formatDateTime } from "@/lib/i18n/format";
import { createClient } from "@/lib/supabase/server";
import {
  listManageableTemplatesForTenant,
  resolveTemplateManagementAccess,
} from "@/lib/templates/template-service";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

export default async function TemplatesPage() {
  const locale = await getLocale();
  const t = await getTranslations("templates.list");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const tenantId = await resolveTenantId(supabase);
  if (!tenantId) {
    redirect("/projects");
  }

  const access = await resolveTemplateManagementAccess(supabase, tenantId, user.id);
  if (!access.canManageTemplates) {
    redirect("/projects");
  }

  const tenantTemplates = await listManageableTemplatesForTenant(supabase, tenantId, user.id);

  return (
    <div className="space-y-6">
      <section className="app-shell rounded-xl px-5 py-5 sm:px-6">
        <div>
          <h1 className="text-3xl font-semibold text-zinc-900">{t("title")}</h1>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <section className="content-card space-y-4 rounded-xl p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-zinc-900">{t("orgTemplatesTitle")}</h2>
              <p className="mt-1 text-sm text-zinc-600">{t("orgTemplatesSubtitle")}</p>
            </div>
          </div>

          {tenantTemplates.length === 0 ? (
            <p className="text-sm text-zinc-600">{t("orgTemplatesEmpty")}</p>
          ) : (
            <ul className="space-y-3">
              {tenantTemplates.map((template) => (
                <li key={template.id} className="rounded-lg border border-zinc-200 bg-white p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <Link
                          href={`/templates/${template.id}`}
                          className="text-base font-medium text-zinc-900 underline underline-offset-4"
                        >
                          {template.name}
                        </Link>
                        <TemplateStatusBadge status={template.status} />
                      </div>
                      <p className="text-sm text-zinc-600">
                        {template.version}
                      </p>
                    </div>
                    <p className="text-sm text-zinc-600">
                      {t("updatedOn", { date: formatDateTime(template.updatedAt, locale) })}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div>
          <TemplateCreateForm />
        </div>
      </div>
    </div>
  );
}
