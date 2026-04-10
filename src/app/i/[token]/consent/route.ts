import { markReceiptSent, submitConsent } from "@/lib/consent/submit-consent";
import { validateConsentBaseFields } from "@/lib/consent/validate-consent-base-fields";
import { sendConsentReceiptEmail } from "@/lib/email/send-receipt";
import { HttpError } from "@/lib/http/errors";
import { getPhotoFanoutBoundary } from "@/lib/matching/auto-match-fanout-continuations";
import { enqueueConsentHeadshotReadyJob } from "@/lib/matching/auto-match-jobs";
import { shouldEnqueueConsentHeadshotReadyOnSubmit } from "@/lib/matching/auto-match-trigger-conditions";
import { redirectRelative } from "@/lib/http/redirect-relative";
import { createClient } from "@/lib/supabase/server";
import {
  STRUCTURED_FIELD_KEY_PATTERN,
  STRUCTURED_FIELD_VALUES_MAX_BYTES,
} from "@/lib/templates/structured-fields";
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

function parseStructuredFieldValues(formData: FormData) {
  const structuredFieldValues = new Map<string, string | string[]>();

  for (const [key, rawValue] of formData.entries()) {
    if (!key.startsWith("structured__")) {
      continue;
    }

    if (typeof rawValue !== "string") {
      throw new HttpError(400, "invalid_structured_fields", "Structured consent values are invalid.");
    }

    const fieldKey = key.slice("structured__".length).trim();
    if (!STRUCTURED_FIELD_KEY_PATTERN.test(fieldKey)) {
      throw new HttpError(400, "invalid_structured_fields", "Structured consent values are invalid.");
    }

    const currentValue = structuredFieldValues.get(fieldKey);
    if (currentValue === undefined) {
      structuredFieldValues.set(fieldKey, rawValue);
      continue;
    }

    if (Array.isArray(currentValue)) {
      currentValue.push(rawValue);
      continue;
    }

    structuredFieldValues.set(fieldKey, [currentValue, rawValue]);
  }

  if (structuredFieldValues.size === 0) {
    return null;
  }

  const payload = Object.fromEntries(structuredFieldValues.entries());
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload)).length;
  if (payloadBytes > STRUCTURED_FIELD_VALUES_MAX_BYTES) {
    throw new HttpError(400, "invalid_structured_fields", "Structured consent values are invalid.");
  }

  return payload;
}

export async function POST(request: Request, context: RouteContext) {
  const { token } = await context.params;
  const formData = await request.formData();

  const fullName = String(formData.get("full_name") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase();
  const consentAcknowledged = String(formData.get("consent_acknowledged") ?? "") === "1";
  const faceMatchOptIn = String(formData.get("face_match_opt_in") ?? "") === "1";
  const headshotAssetIdValue = String(formData.get("headshot_asset_id") ?? "").trim();
  const headshotAssetId = headshotAssetIdValue.length > 0 ? headshotAssetIdValue : null;
  let structuredFieldValues: Record<string, unknown> | null = null;

  const baseFieldValidation = validateConsentBaseFields({
    subjectName: fullName,
    subjectEmail: email,
    consentAcknowledged,
    faceMatchOptIn,
    hasHeadshot: Boolean(headshotAssetId),
  });

  if (baseFieldValidation.fieldErrors.face_match_section) {
    return redirectWithStatus(request, token, { error: "headshot_required" });
  }

  if (
    baseFieldValidation.fieldErrors.subject_name ||
    baseFieldValidation.fieldErrors.subject_email ||
    baseFieldValidation.fieldErrors.consent_acknowledged
  ) {
    return redirectWithStatus(request, token, { error: "invalid" });
  }

  try {
    structuredFieldValues = parseStructuredFieldValues(formData);
  } catch (error) {
    if (error instanceof HttpError) {
      return redirectWithStatus(request, token, { error: "invalid" });
    }
    throw error;
  }

  try {
    const supabase = await createClient();
    const consent = await submitConsent({
      supabase,
      token,
      fullName: baseFieldValidation.normalizedSubjectName,
      email: baseFieldValidation.normalizedSubjectEmail,
      faceMatchOptIn,
      headshotAssetId,
      structuredFieldValues,
      captureIp: parseIpAddress(request),
      captureUserAgent: request.headers.get("user-agent"),
    });

    if (
      shouldEnqueueConsentHeadshotReadyOnSubmit({
        duplicate: consent.duplicate,
        faceMatchOptIn,
        headshotAssetId,
      })
    ) {
      try {
        const boundary = await getPhotoFanoutBoundary(supabase, consent.tenantId, consent.projectId);
        await enqueueConsentHeadshotReadyJob({
          tenantId: consent.tenantId,
          projectId: consent.projectId,
          consentId: consent.consentId,
          headshotAssetId,
          payload: {
            source: "consent_submit",
            headshotAssetId,
            boundarySnapshotAt: boundary.boundarySnapshotAt,
            boundaryPhotoUploadedAt: boundary.boundaryPhotoUploadedAt,
            boundaryPhotoAssetId: boundary.boundaryPhotoAssetId,
          },
        });
      } catch {
        // Primary consent submission must still succeed; reconcile backfills missed jobs.
      }
    }

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
        if (error.code === "headshot_invalid") {
          return redirectWithStatus(request, token, { error: "headshot_required" });
        }

        return redirectWithStatus(request, token, { error: "invalid" });
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
