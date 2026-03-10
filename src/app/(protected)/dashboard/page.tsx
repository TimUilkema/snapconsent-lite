import Link from "next/link";

import { createClient } from "@/lib/supabase/server";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type ProjectRow = {
  id: string;
  name: string;
  status: string;
  created_at: string;
};

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const tenantId = await resolveTenantId(supabase);

  let recentProjects: ProjectRow[] = [];
  if (tenantId) {
    const { data } = await supabase
      .from("projects")
      .select("id, name, status, created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(5);

    recentProjects = (data as ProjectRow[] | null) ?? [];
  }

  return (
    <div className="space-y-6">
      <section className="app-shell rounded-2xl px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">Dashboard</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600">
              Manage projects, send consent invites, and review linked photos from one workspace.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/projects"
              className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800"
            >
              Open projects
            </Link>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.7fr)]">
        <section className="content-card rounded-2xl p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-zinc-900">Recent projects</h2>
            <Link href="/projects" className="text-sm font-medium text-zinc-700 underline underline-offset-4">
              View all
            </Link>
          </div>

          {recentProjects.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-600">No projects yet. Create one to start sending invites.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {recentProjects.map((project) => (
                <li key={project.id} className="rounded-xl border border-zinc-200 bg-white p-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-medium text-zinc-900">{project.name}</p>
                      <p className="mt-1 text-sm text-zinc-600">
                        {project.status} · Created {new Date(project.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <Link
                      href={`/projects/${project.id}`}
                      className="text-sm font-medium text-zinc-700 underline underline-offset-4"
                    >
                      Open project
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <aside className="content-card rounded-2xl p-5">
          <h2 className="text-lg font-semibold text-zinc-900">Account</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="rounded-xl border border-zinc-200 bg-white p-3">
              <dt className="text-zinc-500">Email</dt>
              <dd className="mt-1 font-medium text-zinc-900">{user?.email ?? "unknown"}</dd>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-white p-3">
              <dt className="text-zinc-500">User ID</dt>
              <dd className="mt-1 break-all font-medium text-zinc-900">{user?.id ?? "unknown"}</dd>
            </div>
          </dl>

          <p className="mt-4 text-sm text-zinc-600">
            Consent operations stay tenant-scoped and protected by the server session.
          </p>
        </aside>
      </div>
    </div>
  );
}
