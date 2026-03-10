import Link from "next/link";

import { PublicConsentForm } from "@/components/public/public-consent-form";
import { createClient } from "@/lib/supabase/server";

type InvitePageProps = {
  params: Promise<{
    token: string;
  }>;
  searchParams: Promise<{
    error?: string;
    success?: string;
    duplicate?: string;
    receipt?: string;
  }>;
};

type InviteView = {
  invite_id: string;
  project_id: string;
  project_name: string;
  expires_at: string | null;
  status: string;
  can_sign: boolean;
  consent_text: string | null;
  consent_version: string | null;
};

function renderErrorMessage(error?: string) {
  if (!error) {
    return null;
  }

  switch (error) {
    case "invalid":
      return "This invite link is invalid.";
    case "expired":
      return "This invite link has expired.";
    case "unavailable":
      return "This invite has already been used.";
    case "server":
      return "Unable to submit consent right now. Please try again.";
    case "headshot_required":
      return "Facial matching requires a valid uploaded headshot before consent submission.";
    default:
      return "Unable to process this invite.";
  }
}

export default async function PublicInvitePage({ params, searchParams }: InvitePageProps) {
  const { token } = await params;
  const resolvedSearchParams = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.rpc("get_public_invite", { p_token: token });
  const invite = (data?.[0] as InviteView | undefined) ?? null;

  const errorMessage = renderErrorMessage(resolvedSearchParams.error);
  const showSuccess = resolvedSearchParams.success === "1";
  const showDuplicate = resolvedSearchParams.duplicate === "1";
  const receiptStatus = resolvedSearchParams.receipt;

  return (
    <main className="page-frame flex min-h-screen flex-col py-8 sm:py-10">
      <section className="app-shell flex w-full flex-col gap-4 rounded-2xl px-5 py-6 sm:px-7 sm:py-7">
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Consent form</h1>
          {invite ? (
            <p className="text-sm text-zinc-700">
              Project: {invite.project_name} · Invite status: {invite.status}
            </p>
          ) : (
            <p className="text-sm text-zinc-700">Invite lookup</p>
          )}
        </div>

        {errorMessage ? (
          <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorMessage}
          </p>
        ) : null}
        {showSuccess ? (
          <p className="rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
            Consent submitted successfully.
          </p>
        ) : null}
        {showDuplicate ? (
          <p className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
            This invite was already submitted.
          </p>
        ) : null}
        {receiptStatus === "queued" ? (
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            Consent saved. Receipt email will be retried.
          </p>
        ) : null}

        {invite?.can_sign ? (
          <PublicConsentForm
            token={token}
            consentText={invite.consent_text}
            consentVersion={invite.consent_version}
          />
        ) : (
          <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
            This invite cannot accept new submissions.
          </p>
        )}

        <Link href="/" className="text-sm text-zinc-700 underline">
          Return to home
        </Link>
      </section>
    </main>
  );
}
