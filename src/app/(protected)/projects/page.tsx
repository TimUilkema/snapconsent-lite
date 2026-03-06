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
    <main className="mx-auto flex min-h-screen w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <section className="app-shell flex w-full flex-col gap-6 rounded-[28px] px-6 py-8 sm:px-8">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">Projects</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600">
            Create a project and generate subject invite URLs.
          </p>
        </div>

        <CreateProjectForm />

        <section className="space-y-3 rounded-2xl border border-zinc-200 bg-white/70 p-4">
          <h2 className="text-sm font-semibold">Existing Projects</h2>
          {projects.length === 0 ? (
            <p className="text-sm text-zinc-600">No projects yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {projects.map((project) => (
                <li
                  key={project.id}
                  className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm"
                >
                  <Link
                    className="font-medium text-zinc-900 underline"
                    href={`/projects/${project.id}`}
                  >
                    {project.name}
                  </Link>
                  <p className="mt-1 text-zinc-600">
                    {project.status} - {new Date(project.created_at).toLocaleString()}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </section>
    </main>
  );
}
