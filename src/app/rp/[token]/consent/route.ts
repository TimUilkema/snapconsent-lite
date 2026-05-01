import { parseStructuredFieldValues } from "@/lib/consent/parse-structured-field-values";
import { validateConsentBaseFields } from "@/lib/consent/validate-consent-base-fields";
import { sendRecurringConsentReceiptEmail } from "@/lib/email/send-receipt";
import { HttpError } from "@/lib/http/errors";
import { redirectRelative } from "@/lib/http/redirect-relative";
import {
  assertWorkspaceCorrectionPublicSubmissionAllowed,
  assertWorkspacePublicSubmissionAllowed,
} from "@/lib/projects/project-workflow-service";
import {
  markRecurringConsentReceiptSent,
  resolvePublicRecurringConsentRequestScope,
  submitRecurringProfileConsent,
} from "@/lib/recurring-consent/public-recurring-consent";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { buildExternalUrl } from "@/lib/url/external-origin";
import { buildRecurringProfileConsentPath, buildRecurringProfileRevokePath } from "@/lib/url/paths";

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
  const basePath = buildRecurringProfileConsentPath(token);
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
  const consentAcknowledged = String(formData.get("consent_acknowledged") ?? "") === "1";
  const faceMatchOptIn = String(formData.get("face_match_opt_in") ?? "") === "1";
  let structuredFieldValues: Record<string, unknown> | null = null;

  const baseFieldValidation = validateConsentBaseFields({
    subjectName: fullName,
    subjectEmail: email,
    consentAcknowledged,
    faceMatchOptIn,
    hasHeadshot: false,
    requireHeadshotWhenOptedIn: false,
  });

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
    const requestScope = await resolvePublicRecurringConsentRequestScope(token);
    if (requestScope?.consentKind === "project" && requestScope.projectId && requestScope.workspaceId) {
      const adminSupabase = createAdminClient();
      try {
        await assertWorkspacePublicSubmissionAllowed(
          adminSupabase,
          requestScope.tenantId,
          requestScope.projectId,
          requestScope.workspaceId,
        );
      } catch (error) {
        if (!(error instanceof HttpError) || error.code !== "project_finalized") {
          throw error;
        }

        await assertWorkspaceCorrectionPublicSubmissionAllowed(
          adminSupabase,
          requestScope.tenantId,
          requestScope.projectId,
          requestScope.workspaceId,
          {
            requestSource: requestScope.requestSource,
            correctionOpenedAtSnapshot: requestScope.correctionOpenedAtSnapshot,
            correctionSourceReleaseIdSnapshot: requestScope.correctionSourceReleaseIdSnapshot,
          },
        );
      }
    }
    const consent = await submitRecurringProfileConsent({
      supabase,
      token,
      fullName: baseFieldValidation.normalizedSubjectName,
      email: baseFieldValidation.normalizedSubjectEmail,
      faceMatchOptIn,
      structuredFieldValues,
      captureIp: parseIpAddress(request),
      captureUserAgent: request.headers.get("user-agent"),
    });

    let receiptQueued = false;

    if (!consent.duplicate && consent.revokeToken) {
      try {
        const adminSupabase = createAdminClient();
        const { data: tenant, error: tenantError } = await adminSupabase
          .from("tenants")
          .select("name")
          .eq("id", consent.tenantId)
          .maybeSingle();

        if (tenantError) {
          throw tenantError;
        }

        await sendRecurringConsentReceiptEmail({
          subjectName: consent.profileName,
          subjectEmail: consent.profileEmail,
          tenantLabel: tenant?.name ?? "your organization",
          signedAtIso: consent.signedAt,
          consentText: consent.consentText,
          consentVersion: consent.consentVersion,
          revokeUrl: buildExternalUrl(buildRecurringProfileRevokePath(consent.revokeToken)),
        });

        await markRecurringConsentReceiptSent(supabase, consent.consentId, consent.revokeToken);
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
        return redirectWithStatus(request, token, { error: "invalid" });
      }

      if (error.status === 409) {
        if (error.code === "workspace_not_accepting_submissions" || error.code === "project_finalized") {
          return redirectWithStatus(request, token, { error: "unavailable" });
        }

        return redirectWithStatus(request, token, { duplicate: "1" });
      }
    }

    return redirectWithStatus(request, token, { error: "server" });
  }
}
