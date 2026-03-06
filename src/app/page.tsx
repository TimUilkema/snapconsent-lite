export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl items-center px-4 py-8 sm:px-6 sm:py-12">
      <section className="app-shell w-full rounded-[28px] px-6 py-10 sm:px-10 sm:py-12">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-700">
          SnapConsent Lite
        </p>
        <h1 className="mt-3 text-4xl font-semibold tracking-tight text-zinc-900 sm:text-5xl">
          Clean photo consent flows for projects and invites.
        </h1>
        <p className="mt-4 max-w-2xl text-sm leading-6 text-zinc-600 sm:text-base">
          Manage invite links, collect signed consent, and keep project assets organized in one
          place.
        </p>

        <div className="mt-8 flex flex-col gap-3 text-sm sm:flex-row">
          <a
            className="inline-flex items-center justify-center rounded-full bg-zinc-900 px-5 py-3 font-medium text-white hover:bg-zinc-800"
            href="/login"
          >
          Go to Login
          </a>
          <a
            className="inline-flex items-center justify-center rounded-full border border-zinc-300 bg-white px-5 py-3 font-medium text-zinc-800 hover:bg-zinc-50"
            href="/dashboard"
          >
          Go to Protected Dashboard
          </a>
        </div>
      </section>
    </main>
  );
}
