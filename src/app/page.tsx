export default function Home() {
  return (
    <main className="page-frame flex min-h-screen items-center py-8 sm:py-12">
      <section className="app-shell w-full rounded-2xl px-6 py-8 sm:px-8 sm:py-10">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] lg:items-start">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight text-zinc-900 sm:text-5xl">
              SnapConsent Lite
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-7 text-zinc-600 sm:text-base">
              Consent collection, project invites, and photo linking for teams that need a clear workflow
              instead of a patchwork of folders and links.
            </p>
          </div>

          <div className="grid gap-4">
            <div className="content-card rounded-2xl p-5">
              <p className="text-sm font-medium text-zinc-900">Open the app</p>
              <p className="mt-1 text-sm leading-6 text-zinc-600">
                Sign in to manage projects, invites, assets, and linked consents.
              </p>
              <div className="mt-4 flex flex-col gap-2">
                <a
                  className="inline-flex items-center justify-center rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white hover:bg-zinc-800"
                  href="/login"
                >
                  Sign in
                </a>
                <a
                  className="inline-flex items-center justify-center rounded-lg border border-zinc-300 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
                  href="/dashboard"
                >
                  Open dashboard
                </a>
              </div>
            </div>

            <div className="rounded-2xl border border-zinc-200 bg-white/80 p-5">
              <p className="text-sm font-medium text-zinc-900">Current scope</p>
              <p className="mt-2 text-sm leading-6 text-zinc-600">
                This build focuses on projects, consent invites, subject headshots, manual photo linking,
                and internal face-matching workflows.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
