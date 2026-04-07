import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { TemplateDetailClient } from "@/components/templates/template-detail-client";
import { createClient } from "@/lib/supabase/server";
import {
  getTemplateForManagement,
  resolveTemplateManagementAccess,
} from "@/lib/templates/template-service";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteProps = {
  params: Promise<{
    templateId: string;
  }>;
};

export default async function TemplateDetailPage({ params }: RouteProps) {
  const t = await getTranslations("templates.detail");
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

  const { templateId } = await params;
  let template;
  try {
    template = await getTemplateForManagement(supabase, tenantId, user.id, templateId);
  } catch {
    notFound();
  }

  return (
    <div className="space-y-6">
      <section className="app-shell rounded-xl px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-600">
          <Link href="/templates" className="font-medium text-zinc-700 underline underline-offset-4">
            {t("breadcrumbTemplates")}
          </Link>
          <span>/</span>
          <span>{template.name}</span>
        </div>
      </section>

      <TemplateDetailClient template={template} />
    </div>
  );
}
