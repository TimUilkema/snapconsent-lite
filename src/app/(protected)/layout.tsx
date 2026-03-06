import Link from "next/link";
import { redirect } from "next/navigation";

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
      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col gap-4 px-6 py-10">
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

  return children;
}
