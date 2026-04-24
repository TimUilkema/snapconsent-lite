import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
type ConsentSubmitInput = {
  supabase: SupabaseClient;
  token: string;
  fullName: string;
  email: string;
  faceMatchOptIn: boolean;
  headshotAssetId: string | null;
  structuredFieldValues: Record<string, unknown> | null;
  captureIp: string | null;
  captureUserAgent: string | null;
};

type ConsentSubmitResult = {
  consentId: string;
  duplicate: boolean;
  revokeToken: string | null;
  subjectEmail: string;
  subjectName: string;
  projectName: string;
  signedAt: string;
  tenantId: string;
  projectId: string;
  consentText: string;
  consentVersion: string;
};

export async function submitConsent(input: ConsentSubmitInput): Promise<ConsentSubmitResult> {
  const { data, error } = await input.supabase.rpc("submit_public_consent", {
    p_token: input.token,
    p_full_name: input.fullName,
    p_email: input.email,
    p_capture_ip: input.captureIp,
    p_capture_user_agent: input.captureUserAgent,
    p_face_match_opt_in: input.faceMatchOptIn,
    p_headshot_asset_id: input.headshotAssetId,
    p_structured_field_values: input.structuredFieldValues,
  });

  if (error) {
    console.error("submit_public_consent failed", {
      code: error.code,
      message: error.message,
      details: error.details,
    });

    if (error.code === "P0002") {
      throw new HttpError(404, "invite_not_found", "Invite is invalid.");
    }

    if (error.code === "22023") {
      throw new HttpError(410, "invite_unavailable", "Invite is no longer available.");
    }

    if (error.code === "23505" && error.message === "subject_email_in_use") {
      throw new HttpError(400, "subject_email_in_use", "This email is already used by another project subject.");
    }

    if (error.code === "23505") {
      throw new HttpError(409, "invite_duplicate", "Invite already submitted.");
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
      ].includes(error.message ?? "")
    ) {
      throw new HttpError(400, "invalid_structured_fields", "Structured consent values are invalid.");
    }

    if (error.code === "23514") {
      throw new HttpError(400, "headshot_invalid", "A valid headshot is required for facial matching.");
    }

    throw new HttpError(500, "consent_submit_failed", "Unable to submit consent.");
  }

  const row = data?.[0];

  if (!row) {
    throw new HttpError(500, "consent_submit_failed", "Unable to submit consent.");
  }

  if (!row.duplicate) {
    let consentRow:
      | {
          id: string;
          tenant_id: string;
          project_id: string;
          subject_id: string;
          workspace_id?: string | null;
        }
      | null = null;

    const consentLookup = await input.supabase
      .from("consents")
      .select("id, tenant_id, project_id, subject_id, workspace_id")
      .eq("id", row.consent_id)
      .maybeSingle();

    if (consentLookup.error || !consentLookup.data) {
      throw new HttpError(500, "consent_submit_failed", "Unable to submit consent.");
    }

    consentRow = consentLookup.data as typeof consentRow;
    const workspaceId = String(consentRow.workspace_id ?? "").trim();
    if (!workspaceId) {
      throw new HttpError(500, "consent_submit_failed", "Unable to submit consent.");
    }

    const { error: subjectWorkspaceError } = await input.supabase
      .from("subjects")
      .update({ workspace_id: workspaceId })
      .eq("tenant_id", consentRow.tenant_id)
      .eq("project_id", consentRow.project_id)
      .eq("id", consentRow.subject_id);

    if (subjectWorkspaceError) {
      throw new HttpError(500, "consent_submit_failed", "Unable to submit consent.");
    }

    const { error: linkWorkspaceError } = await input.supabase
      .from("asset_consent_links")
      .update({ workspace_id: workspaceId })
      .eq("tenant_id", consentRow.tenant_id)
      .eq("project_id", consentRow.project_id)
      .eq("consent_id", row.consent_id);

    if (linkWorkspaceError) {
      throw new HttpError(500, "consent_submit_failed", "Unable to submit consent.");
    }
  }

  return {
    consentId: row.consent_id,
    duplicate: row.duplicate,
    revokeToken: row.revoke_token,
    subjectEmail: row.subject_email,
    subjectName: row.subject_name,
    projectName: row.project_name,
    signedAt: row.signed_at,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    consentText: row.consent_text,
    consentVersion: row.consent_version,
  };
}

export async function markReceiptSent(
  supabase: SupabaseClient,
  consentId: string,
  revokeToken: string,
): Promise<void> {
  const { data, error } = await supabase.rpc("mark_consent_receipt_sent", {
    p_consent_id: consentId,
    p_revoke_token: revokeToken,
  });

  if (error || !data) {
    throw new HttpError(500, "receipt_mark_failed", "Unable to mark receipt status.");
  }
}
