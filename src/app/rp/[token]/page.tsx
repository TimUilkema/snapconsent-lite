import Link from "next/link";
import { getTranslations } from "next-intl/server";

import { LanguageSwitch } from "@/components/i18n/language-switch";
import { PublicRecurringConsentForm } from "@/components/public/public-recurring-consent-form";
import { getPublicRecurringConsentRequest } from "@/lib/recurring-consent/public-recurring-consent";
import { createClient } from "@/lib/supabase/server";

type RecurringConsentPageProps = {
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

function getStatusMessage(
  requestStatus: "pending" | "signed" | "expired" | "superseded" | "cancelled" | null,
  t: Awaited<ReturnType<typeof getTranslations>>,
) {
  if (requestStatus === "signed") {
    return t("messages.signed");
  }

  if (requestStatus === "expired") {
    return t("messages.expired");
  }

  if (requestStatus === "cancelled" || requestStatus === "superseded") {
    return t("messages.unavailable");
  }

  return null;
}

function mapError(error: string | undefined, t: Awaited<ReturnType<typeof getTranslations>>) {
  if (!error) {
    return null;
  }

  switch (error) {
    case "invalid":
      return t("errors.invalid");
    case "expired":
      return t("errors.expired");
    case "unavailable":
      return t("errors.unavailable");
    case "server":
      return t("errors.server");
    default:
      return t("errors.fallback");
  }
}

export default async function PublicRecurringConsentPage({
  params,
  searchParams,
}: RecurringConsentPageProps) {
  const t = await getTranslations("publicRecurringConsent");
  const { token } = await params;
  const resolvedSearchParams = await searchParams;
  const supabase = await createClient();
  const request = await getPublicRecurringConsentRequest(supabase, token);

  const errorMessage = mapError(resolvedSearchParams.error, t);
  const showSuccess = resolvedSearchParams.success === "1";
  const showDuplicate = resolvedSearchParams.duplicate === "1";
  const receiptStatus = resolvedSearchParams.receipt;
  const statusMessage = getStatusMessage(request?.requestStatus ?? null, t);

  return (
    <main className="page-frame flex min-h-screen flex-col py-8 sm:py-10">
      <section className="app-shell flex w-full flex-col gap-4 rounded-xl px-5 py-6 sm:px-7 sm:py-7">
        <div className="flex justify-end">
          <LanguageSwitch />
        </div>

        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">{t("title")}</h1>
          {request?.templateName ? <p className="text-sm text-zinc-700">{request.templateName}</p> : null}
          {request ? (
            <p className="text-sm text-zinc-600">
              {t("profileLabel", {
                name: request.profileName,
                email: request.profileEmail,
              })}
            </p>
          ) : null}
        </div>

        {errorMessage ? (
          <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {errorMessage}
          </p>
        ) : null}
        {showSuccess ? (
          <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
            {t("success")}
          </p>
        ) : null}
        {showDuplicate ? (
          <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
            {t("duplicate")}
          </p>
        ) : null}
        {receiptStatus === "queued" ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            {t("receiptQueued")}
          </p>
        ) : null}
        {!showSuccess && !errorMessage && statusMessage ? (
          <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
            {statusMessage}
          </p>
        ) : null}

        {request?.canSign ? (
          <PublicRecurringConsentForm
            token={token}
            profileName={request.profileName}
            profileEmail={request.profileEmail}
            consentText={request.consentText}
            structuredFieldsDefinition={request.structuredFieldsDefinition}
            formLayoutDefinition={request.formLayoutDefinition}
          />
        ) : (
          <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
            {request ? statusMessage ?? t("cannotSubmit") : t("errors.invalid")}
          </p>
        )}

        <Link href="/" className="text-sm text-zinc-700 underline">
          {t("backToHome")}
        </Link>
      </section>
    </main>
  );
}
