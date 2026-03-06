import { markReceiptSent, submitConsent } from "@/lib/consent/submit-consent";
import { sendConsentReceiptEmail } from "@/lib/email/send-receipt";
import { HttpError } from "@/lib/http/errors";
import { redirectRelative } from "@/lib/http/redirect-relative";
import { createClient } from "@/lib/supabase/server";
import { buildExternalUrl } from "@/lib/url/external-origin";
import { buildInvitePath, buildRevokePath } from "@/lib/url/paths";

type RouteContext = {
  params: Promise<{
    token: string;
  }>;
};

function redirectWithStatus(
  request: Request,
  token: string,
  params: Record<string, string>,
  status = 303,
) {
  const searchParams = new URLSearchParams(params);
  const basePath = buildInvitePath(token);
  const pathWithQuery = searchParams.size > 0 ? `${basePath}?${searchParams.toString()}` : basePath;
  return redirectRelative(request, pathWithQuery, status);
}

function parseIpAddress(request: Request) {
  const value = request.headers.get("x-forwarded-for");
  if (!value) {
    return null;
  }

  return value.split(",")[0]?.trim() ?? null;
}

export async function POST(request: Request, context: RouteContext) {
  const { token } = await context.params;
  const formData = await request.formData();

  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const faceMatchOptIn = String(formData.get("face_match_opt_in") ?? "") === "1";
  const headshotAssetIdValue = String(formData.get("headshot_asset_id") ?? "").trim();
  const headshotAssetId = headshotAssetIdValue.length > 0 ? headshotAssetIdValue : null;

  if (fullName.length < 2 || !email || !email.includes("@")) {
    return redirectWithStatus(request, token, { error: "invalid" });
  }

  if (faceMatchOptIn && !headshotAssetId) {
    return redirectWithStatus(request, token, { error: "headshot_required" });
  }

  try {
    const supabase = await createClient();
    const consent = await submitConsent({
      supabase,
      token,
      fullName,
      email,
      faceMatchOptIn,
      headshotAssetId,
      captureIp: parseIpAddress(request),
      captureUserAgent: request.headers.get("user-agent"),
    });

    let receiptQueued = false;

    if (!consent.duplicate && consent.revokeToken) {
      try {
        const revokeUrl = buildExternalUrl(buildRevokePath(consent.revokeToken));
        await sendConsentReceiptEmail({
          subjectName: consent.subjectName,
          subjectEmail: consent.subjectEmail,
          projectName: consent.projectName,
          signedAtIso: consent.signedAt,
          consentText: consent.consentText,
          consentVersion: consent.consentVersion,
          revokeUrl,
        });

        await markReceiptSent(supabase, consent.consentId, consent.revokeToken);
      } catch {
        receiptQueued = true;
      }
    }

    return redirectWithStatus(request, token, {
      success: "1",
      duplicate: consent.duplicate ? "1" : "0",
      receipt: receiptQueued ? "queued" : "sent",
    });
  } catch (error) {
    if (error instanceof HttpError) {
      if (error.status === 404) {
        return redirectWithStatus(request, token, { error: "invalid" });
      }

      if (error.status === 410) {
        return redirectWithStatus(request, token, { error: "expired" });
      }

      if (error.status === 400) {
        return redirectWithStatus(request, token, { error: "headshot_required" });
      }

      if (error.status === 409) {
        return redirectWithStatus(request, token, { duplicate: "1" });
      }

      if (error.status === 500) {
        return redirectWithStatus(request, token, { error: "server" });
      }
    }

    return redirectWithStatus(request, token, { error: "unavailable" });
  }
}
