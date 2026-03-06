import Link from "next/link";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
  }>;
};

const ERROR_MESSAGES: Record<string, string> = {
  invalid_credentials: "Invalid email or password.",
  invalid_input: "Enter both email and password.",
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect("/dashboard");
  }

  const resolvedSearchParams = await searchParams;
  const errorCode = resolvedSearchParams.error;
  const errorMessage = errorCode ? ERROR_MESSAGES[errorCode] ?? "Unable to sign in." : null;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl items-center justify-center px-4 py-8 sm:px-6 sm:py-10">
      <section className="app-shell w-full max-w-md rounded-[28px] px-6 py-8 sm:px-8">
        <h1 className="text-3xl font-semibold tracking-tight text-zinc-900">Sign in</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600">Use your Supabase email and password.</p>

        {errorMessage ? (
          <p className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorMessage}
          </p>
        ) : null}

        <form action="/auth/login" method="post" className="mt-6 space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Email</span>
            <input
              className="w-full rounded-xl border border-zinc-300 px-3 py-2.5 shadow-sm outline-none focus:border-zinc-400"
              type="email"
              name="email"
              autoComplete="email"
              required
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Password</span>
            <input
              className="w-full rounded-xl border border-zinc-300 px-3 py-2.5 shadow-sm outline-none focus:border-zinc-400"
              type="password"
              name="password"
              autoComplete="current-password"
              required
            />
          </label>
          <button
            className="w-full rounded-full bg-zinc-900 px-4 py-3 text-sm font-medium text-white hover:bg-zinc-800"
            type="submit"
          >
            Sign in
          </button>
        </form>

        <Link className="mt-6 text-sm text-zinc-700 underline" href="/">
          Back to home
        </Link>
      </section>
    </main>
  );
}
