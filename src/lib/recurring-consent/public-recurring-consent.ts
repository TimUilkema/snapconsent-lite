import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import { enqueueReconcileProjectJob } from "@/lib/matching/auto-match-jobs";
import { enqueueRecurringProjectReplayForProfile } from "@/lib/matching/project-recurring-sources";
import {
  getEffectiveFormLayoutDefinition,
  type ConsentFormLayoutDefinition,
} from "@/lib/templates/form-layout";
import type { StructuredFieldsDefinition } from "@/lib/templates/structured-fields";

type PublicRecurringConsentRequestRpcRow = {
  request_id: string;
  profile_id: string;
  profile_name: string;
  profile_email: string;
  expires_at: string;
  request_status: "pending" | "signed" | "expired" | "superseded" | "cancelled";
  can_sign: boolean;
  consent_text: string | null;
  consent_version: string | null;
  template_name: string | null;
  structured_fields_definition: StructuredFieldsDefinition | null;
  form_layout_definition: ConsentFormLayoutDefinition | null;
};

type SubmitRecurringConsentInput = {
  supabase: SupabaseClient;
  token: string;
  fullName: string;
  email: string;
  faceMatchOptIn?: boolean;
  structuredFieldValues: Record<string, unknown> | null;
  captureIp: string | null;
  captureUserAgent: string | null;
};

export type PublicRecurringConsentRequest = {
  requestId: string;
  profileId: string;
  profileName: string;
  profileEmail: string;
  expiresAt: string;
  requestStatus: "pending" | "signed" | "expired" | "superseded" | "cancelled";
  canSign: boolean;
  consentText: string | null;
  consentVersion: string | null;
  templateName: string | null;
  structuredFieldsDefinition: StructuredFieldsDefinition | null;
  formLayoutDefinition: ConsentFormLayoutDefinition;
};

export type SubmitRecurringConsentResult = {
  consentId: string;
  duplicate: boolean;
  revokeToken: string | null;
  profileEmail: string;
  profileName: string;
  signedAt: string;
  tenantId: string;
  requestId: string;
  consentText: string;
  consentVersion: string;
};

type RecurringConsentRequestScopeRow = {
  profile_id: string;
  project_id: string | null;
  consent_kind: "baseline" | "project";
};

function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new HttpError(500, "supabase_admin_not_configured", "Missing Supabase service role configuration.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

async function loadRecurringConsentRequestScope(requestId: string) {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("recurring_profile_consent_requests")
    .select("profile_id, project_id, consent_kind")
    .eq("id", requestId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "recurring_consent_request_lookup_failed", "Unable to load recurring consent request.");
  }

  return (data as RecurringConsentRequestScopeRow | null) ?? null;
}

export async function getPublicRecurringConsentRequest(
  supabase: SupabaseClient,
  token: string,
): Promise<PublicRecurringConsentRequest | null> {
  const { data, error } = await supabase.rpc("get_public_recurring_profile_consent_request", {
    p_token: token,
  });

  if (error) {
    throw new HttpError(500, "recurring_consent_request_lookup_failed", "Unable to load recurring consent request.");
  }

  const row = (data?.[0] as PublicRecurringConsentRequestRpcRow | undefined) ?? null;
  if (!row) {
    return null;
  }

  return {
    requestId: row.request_id,
    profileId: row.profile_id,
    profileName: row.profile_name,
    profileEmail: row.profile_email,
    expiresAt: row.expires_at,
    requestStatus: row.request_status,
    canSign: row.can_sign,
    consentText: row.consent_text,
    consentVersion: row.consent_version,
    templateName: row.template_name,
    structuredFieldsDefinition: row.structured_fields_definition,
    formLayoutDefinition: getEffectiveFormLayoutDefinition(
      row.form_layout_definition,
      row.structured_fields_definition,
    ),
  };
}

export async function submitRecurringProfileConsent(
  input: SubmitRecurringConsentInput,
): Promise<SubmitRecurringConsentResult> {
  const { data, error } = await input.supabase.rpc("submit_public_recurring_profile_consent", {
    p_token: input.token,
    p_full_name: input.fullName,
    p_email: input.email,
    p_capture_ip: input.captureIp,
    p_capture_user_agent: input.captureUserAgent,
    p_structured_field_values: input.structuredFieldValues,
    p_face_match_opt_in: input.faceMatchOptIn ?? false,
  });

  if (error) {
    if (error.code === "P0002") {
      throw new HttpError(404, "recurring_consent_request_not_found", "Recurring consent request is invalid.");
    }

    if (error.code === "22023") {
      throw new HttpError(
        410,
        "recurring_consent_request_unavailable",
        "Recurring consent request is no longer available.",
      );
    }

    if (
      error.code === "22001" ||
      error.code === "54000" ||
      error.code === "22P02" ||
      [
        "invalid_structured_fields",
        "structured_field_required",
        "invalid_structured_field_value",
        "unknown_structured_field",
        "payload_too_large",
        "invalid_profile_name",
        "invalid_profile_email",
      ].includes(error.message ?? "")
    ) {
      throw new HttpError(400, "invalid_structured_fields", "Structured consent values are invalid.");
    }

    throw new HttpError(500, "recurring_consent_submit_failed", "Unable to submit recurring consent.");
  }

  const row = data?.[0];
  if (!row) {
    throw new HttpError(500, "recurring_consent_submit_failed", "Unable to submit recurring consent.");
  }

  const requestScope = await loadRecurringConsentRequestScope(row.request_id);
  if (requestScope?.consent_kind === "baseline" && input.faceMatchOptIn === true) {
    await enqueueRecurringProjectReplayForProfile(undefined, {
      tenantId: row.tenant_id,
      profileId: requestScope.profile_id,
      reason: "baseline_recurring_consent_opt_in_granted",
    });
  } else if (
    requestScope?.consent_kind === "project"
    && requestScope.project_id
    && input.faceMatchOptIn === true
    && row.duplicate !== true
  ) {
    await enqueueReconcileProjectJob({
      tenantId: row.tenant_id,
      projectId: requestScope.project_id,
      windowKey: `project_recurring_consent:${requestScope.profile_id}`,
      payload: {
        replayKind: "project_recurring_consent",
        profileId: requestScope.profile_id,
        consentId: row.consent_id,
        reason: "project_recurring_consent_opt_in_granted",
      },
      mode: "repair_requeue",
      requeueReason: "project_recurring_consent_opt_in_granted",
    });
  }

  return {
    consentId: row.consent_id,
    duplicate: row.duplicate,
    revokeToken: row.revoke_token,
    profileEmail: row.profile_email,
    profileName: row.profile_name,
    signedAt: row.signed_at,
    tenantId: row.tenant_id,
    requestId: row.request_id,
    consentText: row.consent_text,
    consentVersion: row.consent_version,
  };
}

export async function markRecurringConsentReceiptSent(
  supabase: SupabaseClient,
  consentId: string,
  revokeToken: string,
) {
  const { data, error } = await supabase.rpc("mark_recurring_profile_consent_receipt_sent", {
    p_consent_id: consentId,
    p_revoke_token: revokeToken,
  });

  if (error || !data) {
    throw new HttpError(500, "recurring_receipt_mark_failed", "Unable to mark recurring receipt status.");
  }
}
