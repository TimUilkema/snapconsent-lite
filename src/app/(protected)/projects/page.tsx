import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";

import { CreateProjectForm } from "@/components/projects/create-project-form";
import { formatDateTime } from "@/lib/i18n/format";
import {
  listProjectAdministrationProjects,
  type ProjectAdministrationAccess,
} from "@/lib/projects/project-administration-service";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantPermissions } from "@/lib/tenant/permissions";
import { resolveEffectiveReviewerAccessForTenant } from "@/lib/tenant/reviewer-access-service";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type ProjectRow = {
  id: string;
  name: string;
  status: string;
  created_at: string;
};

export default async function ProjectsPage() {
  const locale = await getLocale();
  const t = await getTranslations("projects.list");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const tenantId = await resolveTenantId(supabase);
  const permissions = tenantId
    ? await resolveTenantPermissions(supabase, tenantId, user.id)
    : null;
  const projectAdministration = tenantId
    ? await listProjectAdministrationProjects({ supabase, tenantId, userId: user.id })
    : null;
  const projectAdministrationAccess: ProjectAdministrationAccess | null =
    projectAdministration?.access ?? null;

  let projects: ProjectRow[] = [];
  if (tenantId) {
    if (permissions?.role === "photographer") {
      const { data: assignedWorkspaces } = await supabase
        .from("project_workspaces")
        .select("project_id")
        .eq("tenant_id", tenantId)
        .eq("photographer_user_id", user.id);

      const visibleProjectIds = Array.from(
        new Set(
          ((assignedWorkspaces ?? []) as Array<{ project_id: string }>).map((workspace) => workspace.project_id),
        ),
      );

      if (visibleProjectIds.length > 0) {
        const { data } = await supabase
          .from("projects")
          .select("id, name, status, created_at")
          .eq("tenant_id", tenantId)
          .in("id", visibleProjectIds)
          .order("created_at", { ascending: false });

        projects = (data as ProjectRow[] | null) ?? [];
      }
    } else if (permissions?.role === "reviewer" && !permissions.hasTenantWideReviewAccess) {
      const reviewerAccess = await resolveEffectiveReviewerAccessForTenant({
        supabase,
        tenantId,
        userId: user.id,
      });
      const visibleProjectIds = reviewerAccess.projectIds;

      if (visibleProjectIds.length > 0) {
        const { data } = await supabase
          .from("projects")
          .select("id, name, status, created_at")
          .eq("tenant_id", tenantId)
          .in("id", visibleProjectIds)
          .order("created_at", { ascending: false });

        projects = (data as ProjectRow[] | null) ?? [];
      }
    } else {
      const { data } = await supabase
        .from("projects")
        .select("id, name, status, created_at")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false });

      projects = (data as ProjectRow[] | null) ?? [];
    }

    if (projectAdministration?.projects.length) {
      const projectById = new Map(projects.map((project) => [project.id, project]));
      projectAdministration.projects.forEach((project) => {
        projectById.set(project.id, project);
      });
      projects = Array.from(projectById.values()).sort(
        (left, right) =>
          new Date(right.created_at).getTime() - new Date(left.created_at).getTime(),
      );
    }
  }

  return (
    <div className="space-y-6">
      <section className="app-shell rounded-2xl px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">{t("title")}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">{t("subtitle")}</p>
          </div>
          <Link
            href="/dashboard"
            className="text-sm font-medium text-zinc-700 underline underline-offset-4"
          >
            {t("backToDashboard")}
          </Link>
        </div>
      </section>

      <div
        className={
          projectAdministrationAccess?.canCreateProjects
            ? "grid gap-6 xl:grid-cols-[minmax(320px,0.75fr)_minmax(0,1.25fr)]"
            : "grid gap-6"
        }
      >
        {projectAdministrationAccess?.canCreateProjects ? (
          <div>
            <CreateProjectForm />
          </div>
        ) : null}

        <section className="content-card rounded-2xl p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-zinc-900">{t("existingTitle")}</h2>
              <p className="mt-1 text-sm text-zinc-600">
                {t("projectCount", { count: projects.length })}
              </p>
            </div>
          </div>

          {projects.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-600">{t("empty")}</p>
          ) : (
            <ul className="mt-4 space-y-3 text-sm">
              {projects.map((project) => (
                <li key={project.id} className="rounded-xl border border-zinc-200 bg-white p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <Link
                        className="text-base font-medium text-zinc-900 underline underline-offset-4"
                        href={`/projects/${project.id}`}
                      >
                        {project.name}
                      </Link>
                      <p className="mt-1 text-zinc-600">
                        {project.status} · {formatDateTime(project.created_at, locale)}
                      </p>
                    </div>
                    <Link
                      href={`/projects/${project.id}`}
                      className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
                    >
                      {t("openProject")}
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
