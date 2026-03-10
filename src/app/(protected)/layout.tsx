import Link from "next/link";
import { redirect } from "next/navigation";

import { ProtectedNav } from "@/components/navigation/protected-nav";
import { createClient } from "@/lib/supabase/server";
import { ensureTenantId } from "@/lib/tenant/resolve-tenant";

type ProtectedLayoutProps = {
  children: React.ReactNode;
};

export default async function ProtectedLayout({ children }: ProtectedLayoutProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  try {
    await ensureTenantId(supabase);
  } catch {
    return (
      <main className="page-frame flex min-h-screen flex-col gap-4 py-10">
        <h1 className="text-2xl font-semibold">Workspace setup issue</h1>
        <p className="text-sm text-zinc-700">
          Unable to set up your workspace membership. Sign out and sign in again, then retry.
        </p>
        <p className="text-sm text-zinc-700">
          If it keeps failing, contact support with your account email and request tenant bootstrap.
        </p>
        <Link className="text-sm underline" href="/login">
          Back to login
        </Link>
      </main>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-200/80 bg-white/85 backdrop-blur-sm">
        <div className="page-frame flex flex-col gap-4 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <Link href="/projects" className="text-lg font-semibold tracking-tight text-zinc-900">
              SnapConsent Lite
            </Link>
            <span className="hidden text-sm text-zinc-400 sm:inline">/</span>
            <span className="text-sm text-zinc-600">Workspace</span>
          </div>

          <ProtectedNav />

          <div className="flex flex-wrap items-center gap-3 lg:justify-end">
            <span className="text-sm text-zinc-600">{user.email ?? "Signed in"}</span>
            <form action="/auth/logout" method="post">
              <button
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
                type="submit"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <div className="page-frame py-6 sm:py-8">{children}</div>
    </div>
  );
}
