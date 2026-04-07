import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { TemplateCreateForm } from "@/components/templates/template-create-form";
import { TemplateStatusBadge } from "@/components/templates/template-status-badge";
import { formatDateTime } from "@/lib/i18n/format";
import { createClient } from "@/lib/supabase/server";
import {
  listManageableTemplatesForTenant,
  listVisibleTemplatesForTenant,
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

  const [tenantTemplates, visibleTemplates] = await Promise.all([
    listManageableTemplatesForTenant(supabase, tenantId, user.id),
    listVisibleTemplatesForTenant(supabase, tenantId),
  ]);

  const appTemplates = visibleTemplates.filter((template) => template.scope === "app");

  return (
    <div className="space-y-6">
      <section className="app-shell rounded-xl px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold text-zinc-900">{t("title")}</h1>
          <p className="text-sm leading-6 text-zinc-600">{t("subtitle")}</p>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
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
                        {template.category ? ` - ${template.category}` : ""}
                      </p>
                      {template.description ? (
                        <p className="text-sm text-zinc-700">{template.description}</p>
                      ) : null}
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

        <div className="space-y-6">
          <TemplateCreateForm />

          <section className="content-card space-y-4 rounded-xl p-5">
            <div>
              <h2 className="text-lg font-semibold text-zinc-900">{t("appTemplatesTitle")}</h2>
              <p className="mt-1 text-sm text-zinc-600">{t("appTemplatesSubtitle")}</p>
            </div>

            {appTemplates.length === 0 ? (
              <p className="text-sm text-zinc-600">{t("appTemplatesEmpty")}</p>
            ) : (
              <ul className="space-y-3">
                {appTemplates.map((template) => (
                  <li key={template.id} className="rounded-lg border border-zinc-200 bg-white p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium text-zinc-900">{template.name}</p>
                        <p className="text-sm text-zinc-600">
                          {template.version}
                          {template.category ? ` - ${template.category}` : ""}
                        </p>
                      </div>
                      <TemplateStatusBadge status={template.status} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
