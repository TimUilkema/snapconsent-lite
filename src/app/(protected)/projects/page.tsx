import Link from "next/link";

import { CreateProjectForm } from "@/components/projects/create-project-form";
import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type ProjectRow = {
  id: string;
  name: string;
  status: string;
  created_at: string;
};

export default async function ProjectsPage() {
  const supabase = await createClient();
  const tenantId = await resolveTenantId(supabase);

  let projects: ProjectRow[] = [];
  if (tenantId) {
    const { data } = await supabase
      .from("projects")
      .select("id, name, status, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false });

    projects = (data as ProjectRow[] | null) ?? [];
  }

  return (
    <div className="space-y-6">
      <section className="app-shell rounded-2xl px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">Projects</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
              Organize photographers, invite subjects, and manage linked project photos from one place.
            </p>
          </div>
          <Link
            href="/dashboard"
            className="text-sm font-medium text-zinc-700 underline underline-offset-4"
          >
            Back to dashboard
          </Link>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(320px,0.75fr)_minmax(0,1.25fr)]">
        <div>
          <CreateProjectForm />
        </div>

        <section className="content-card rounded-2xl p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-zinc-900">Existing projects</h2>
              <p className="mt-1 text-sm text-zinc-600">
                {projects.length} project{projects.length === 1 ? "" : "s"} in this workspace
              </p>
            </div>
          </div>

          {projects.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-600">No projects yet.</p>
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
                        {project.status} · {new Date(project.created_at).toLocaleString()}
                      </p>
                    </div>
                    <Link
                      href={`/projects/${project.id}`}
                      className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
                    >
                      Open project
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
