import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { mapStructuredSnapshotToFormValues, type PublicConsentInitialValues } from "@/lib/consent/public-consent-prefill";
import { HttpError } from "@/lib/http/errors";
import { enqueueReconcileProjectJob } from "@/lib/matching/auto-match-jobs";
import { enqueueRecurringProjectReplayForProfile } from "@/lib/matching/project-recurring-sources";
import {
  getEffectiveFormLayoutDefinition,
  type ConsentFormLayoutDefinition,
} from "@/lib/templates/form-layout";
import type { StructuredFieldsDefinition, StructuredFieldsSnapshot } from "@/lib/templates/structured-fields";
import { hashPublicToken } from "@/lib/tokens/public-token";

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
  workspaceId: string | null;
  expiresAt: string;
  requestStatus: "pending" | "signed" | "expired" | "superseded" | "cancelled";
  canSign: boolean;
  consentText: string | null;
  consentVersion: string | null;
  templateName: string | null;
  structuredFieldsDefinition: StructuredFieldsDefinition | null;
  formLayoutDefinition: ConsentFormLayoutDefinition;
  upgradeContext: PublicRecurringConsentUpgradeContext | null;
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
  id: string;
  tenant_id: string;
  profile_id: string;
  project_id: string | null;
  workspace_id: string | null;
  consent_kind: "baseline" | "project";
  consent_template_id: string;
  request_source: "normal" | "correction";
  correction_opened_at_snapshot: string | null;
  correction_source_release_id_snapshot: string | null;
};

export type PublicRecurringConsentRequestScope = {
  requestId: string;
  tenantId: string;
  profileId: string;
  projectId: string | null;
  workspaceId: string | null;
  consentKind: "baseline" | "project";
  consentTemplateId: string;
  requestSource: "normal" | "correction";
  correctionOpenedAtSnapshot: string | null;
  correctionSourceReleaseIdSnapshot: string | null;
};

type RecurringProfileRow = {
  full_name: string;
  email: string;
};

type TemplateKeyRow = {
  template_key: string;
};

type ActiveRecurringProjectConsentRow = {
  id: string;
  consent_template_id: string;
  face_match_opt_in: boolean;
  structured_fields_snapshot: StructuredFieldsSnapshot | null;
};

export type PublicRecurringConsentUpgradeContext = {
  priorConsentId: string;
  profileId: string;
  initialValues: PublicConsentInitialValues;
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
    .select(
      "id, tenant_id, profile_id, project_id, workspace_id, consent_kind, consent_template_id, request_source, correction_opened_at_snapshot, correction_source_release_id_snapshot",
    )
    .eq("id", requestId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "recurring_consent_request_lookup_failed", "Unable to load recurring consent request.");
  }

  return (data as RecurringConsentRequestScopeRow | null) ?? null;
}

async function loadRecurringConsentRequestScopeByToken(token: string) {
  const supabase = createServiceRoleClient();
  const { data, error } = await supabase
    .from("recurring_profile_consent_requests")
    .select(
      "id, tenant_id, profile_id, project_id, workspace_id, consent_kind, consent_template_id, request_source, correction_opened_at_snapshot, correction_source_release_id_snapshot",
    )
    .eq("token_hash", hashPublicToken(token))
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "recurring_consent_request_lookup_failed", "Unable to load recurring consent request.");
  }

  return (data as RecurringConsentRequestScopeRow | null) ?? null;
}

export async function resolvePublicRecurringConsentRequestScope(
  token: string,
): Promise<PublicRecurringConsentRequestScope | null> {
  const scope = await loadRecurringConsentRequestScopeByToken(token);
  if (!scope) {
    return null;
  }

  return {
    requestId: scope.id,
    tenantId: scope.tenant_id,
    profileId: scope.profile_id,
    projectId: scope.project_id,
    workspaceId: scope.workspace_id,
    consentKind: scope.consent_kind,
    consentTemplateId: scope.consent_template_id,
    requestSource: scope.request_source === "correction" ? "correction" : "normal",
    correctionOpenedAtSnapshot: scope.correction_opened_at_snapshot,
    correctionSourceReleaseIdSnapshot: scope.correction_source_release_id_snapshot,
  };
}

async function loadTemplateKeyById(
  supabase: SupabaseClient,
  templateId: string,
) {
  const { data, error } = await supabase
    .from("consent_templates")
    .select("template_key")
    .eq("id", templateId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "recurring_consent_request_lookup_failed", "Unable to load recurring consent request.");
  }

  return (data as TemplateKeyRow | null)?.template_key ?? null;
}

async function loadRecurringProjectUpgradeContextForRequest(
  requestScope: RecurringConsentRequestScopeRow,
): Promise<PublicRecurringConsentUpgradeContext | null> {
  if (requestScope.consent_kind !== "project" || !requestScope.project_id) {
    return null;
  }
  if (!requestScope.workspace_id) {
    throw new HttpError(500, "recurring_consent_request_lookup_failed", "Recurring project consent request is missing a workspace assignment.");
  }

  const supabase = createServiceRoleClient();
  const targetTemplateKey = await loadTemplateKeyById(supabase, requestScope.consent_template_id);
  if (!targetTemplateKey) {
    return null;
  }

  const activeConsentQuery = supabase
    .from("recurring_profile_consents")
    .select("id, consent_template_id, face_match_opt_in, structured_fields_snapshot")
    .eq("tenant_id", requestScope.tenant_id)
    .eq("profile_id", requestScope.profile_id)
    .eq("project_id", requestScope.project_id)
    .eq("workspace_id", requestScope.workspace_id)
    .eq("consent_kind", "project")
    .is("revoked_at", null)
    .is("superseded_at", null)
    .order("signed_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);

  const { data: activeConsent, error: activeConsentError } = await activeConsentQuery.maybeSingle();

  if (activeConsentError) {
    throw new HttpError(500, "recurring_consent_request_lookup_failed", "Unable to load recurring consent request.");
  }

  if (!activeConsent) {
    return null;
  }

  const activeTemplateKey = await loadTemplateKeyById(
    supabase,
    (activeConsent as ActiveRecurringProjectConsentRow).consent_template_id,
  );
  const snapshotTemplateKey =
    (activeConsent as ActiveRecurringProjectConsentRow).structured_fields_snapshot?.templateSnapshot?.templateKey
    ?? null;
  if ((activeTemplateKey ?? snapshotTemplateKey) !== targetTemplateKey) {
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from("recurring_profiles")
    .select("full_name, email")
    .eq("tenant_id", requestScope.tenant_id)
    .eq("id", requestScope.profile_id)
    .maybeSingle();

  if (profileError) {
    throw new HttpError(500, "recurring_consent_request_lookup_failed", "Unable to load recurring consent request.");
  }

  if (!profile) {
    return null;
  }

  return {
    priorConsentId: (activeConsent as ActiveRecurringProjectConsentRow).id,
    profileId: requestScope.profile_id,
    initialValues: {
      subjectName: (profile as RecurringProfileRow).full_name ?? "",
      subjectEmail: (profile as RecurringProfileRow).email ?? "",
      faceMatchOptIn: (activeConsent as ActiveRecurringProjectConsentRow).face_match_opt_in === true,
      structuredFieldValues: mapStructuredSnapshotToFormValues(
        (activeConsent as ActiveRecurringProjectConsentRow).structured_fields_snapshot,
      ),
    },
  };
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

  const requestScope = await loadRecurringConsentRequestScopeByToken(token);

  return {
    requestId: row.request_id,
    profileId: row.profile_id,
    profileName: row.profile_name,
    profileEmail: row.profile_email,
    workspaceId: requestScope?.workspace_id ?? null,
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
    upgradeContext: requestScope
      ? await loadRecurringProjectUpgradeContextForRequest(requestScope)
      : null,
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
    console.error("submit_public_recurring_profile_consent failed", {
      code: error.code,
      message: error.message,
      details: error.details,
    });

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
      workspaceId: requestScope.workspace_id,
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
