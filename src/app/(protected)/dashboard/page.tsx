import Link from "next/link";

import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
      <section className="app-shell w-full rounded-[28px] px-6 py-8 sm:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">Dashboard</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600">
          This route is protected by server-side auth.
        </p>

        <div className="mt-6 rounded-2xl border border-zinc-200 bg-zinc-50/80 p-4 text-sm">
          <p>
            <span className="font-medium">User ID:</span> {user?.id ?? "unknown"}
          </p>
          <p className="mt-2">
            <span className="font-medium">Email:</span> {user?.email ?? "unknown"}
          </p>
        </div>

        <form action="/auth/logout" method="post" className="mt-6">
          <button
            className="rounded-full bg-zinc-900 px-4 py-3 text-sm font-medium text-white hover:bg-zinc-800"
            type="submit"
          >
            Sign out
          </button>
        </form>

        <Link className="mt-6 text-sm text-zinc-700 underline" href="/projects">
          Go to projects
        </Link>
        <Link className="mt-3 text-sm text-zinc-700 underline" href="/">
          Back to home
        </Link>
      </section>
    </main>
  );
}
