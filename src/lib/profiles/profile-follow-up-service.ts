import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import { deriveRecurringProfileConsentToken } from "@/lib/tokens/public-token";
import { buildRecurringProfileConsentPath } from "@/lib/url/paths";

import { createBaselineConsentRequest } from "./profile-consent-service";
import {
  dispatchPlaceholderBaselineFollowUp,
  type BaselineFollowUpActionKind,
} from "./profile-follow-up-delivery";
import { resolveProfilesAccess } from "./profile-access";

type IdempotencyRow<T> = {
  response_json: T;
};

type RecurringProfileRow = {
  id: string;
  tenant_id: string;
  status: "active" | "archived";
};

type RecurringProfileConsentRequestRow = {
  id: string;
  tenant_id: string;
  profile_id: string;
  consent_template_id: string;
  profile_email_snapshot: string;
  status: "pending" | "signed" | "expired" | "superseded" | "cancelled";
  expires_at: string;
  created_at: string;
  updated_at: string;
};

type RecurringProfileConsentRow = {
  id: string;
  tenant_id: string;
  profile_id: string;
  revoked_at: string | null;
};

type DeliveryAttemptRow = {
  id: string;
  request_id: string;
  action_kind: "reminder" | "new_request";
  delivery_mode: "placeholder";
  status: "recorded" | "failed";
  target_email: string;
  error_code: string | null;
  created_at: string;
};

type FollowUpRequestSummary = {
  id: string;
  profileId: string;
  consentTemplateId: string;
  status: "pending";
  expiresAt: string;
  consentPath: string;
  emailSnapshot: string;
};

export type BaselineFollowUpPayload = {
  followUp: {
    action: BaselineFollowUpActionKind;
    deliveryMode: "placeholder";
    deliveryStatus: "recorded" | "failed";
    request: FollowUpRequestSummary;
    deliveryAttempt: {
      id: string;
      requestId: string;
      actionKind: "reminder" | "new_request";
      deliveryMode: "placeholder";
      status: "recorded" | "failed";
      targetEmail: string;
      attemptedAt: string;
      errorCode: string | null;
    };
  };
};

type SendBaselineFollowUpInput = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  profileId: string;
  idempotencyKey: string;
  consentTemplateId?: string | null;
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validateIdempotencyKey(value: string) {
  const normalized = value.trim();
  if (normalized.length < 8 || normalized.length > 200) {
    throw new HttpError(400, "invalid_idempotency_key", "Idempotency-Key header is required.");
  }

  return normalized;
}

function validateUuid(value: string, code: string, message: string) {
  const normalized = value.trim();
  if (!isUuid(normalized)) {
    throw new HttpError(404, code, message);
  }

  return normalized;
}

function normalizeOptionalUuid(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized) {
    return null;
  }

  if (!isUuid(normalized)) {
    throw new HttpError(404, "template_not_found", "Template not found.");
  }

  return normalized;
}

async function assertProfilesManager(supabase: SupabaseClient, tenantId: string, userId: string) {
  const access = await resolveProfilesAccess(supabase, tenantId, userId);
  if (!access.canManageProfiles) {
    throw new HttpError(
      403,
      "recurring_profile_management_forbidden",
      "Only workspace owners and admins can manage recurring profiles.",
    );
  }
}

async function readIdempotencyPayload<T>(
  supabase: SupabaseClient,
  tenantId: string,
  operation: string,
  idempotencyKey: string,
): Promise<T | null> {
  const { data, error } = await supabase
    .from("idempotency_keys")
    .select("response_json")
    .eq("tenant_id", tenantId)
    .eq("operation", operation)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "idempotency_lookup_failed", "Unable to process this request right now.");
  }

  return ((data as IdempotencyRow<T> | null)?.response_json ?? null) as T | null;
}

async function writeIdempotencyPayload(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
  operation: string,
  idempotencyKey: string,
  payload: unknown,
) {
  const { error } = await supabase.from("idempotency_keys").upsert(
    {
      tenant_id: tenantId,
      operation,
      idempotency_key: idempotencyKey,
      response_json: payload,
      created_by: userId,
    },
    {
      onConflict: "tenant_id,operation,idempotency_key",
      ignoreDuplicates: true,
    },
  );

  if (error) {
    throw new HttpError(500, "idempotency_write_failed", "Unable to persist request state.");
  }
}

async function getRecurringProfileRowById(
  supabase: SupabaseClient,
  tenantId: string,
  profileId: string,
): Promise<RecurringProfileRow | null> {
  const { data, error } = await supabase
    .from("recurring_profiles")
    .select("id, tenant_id, status")
    .eq("tenant_id", tenantId)
    .eq("id", profileId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "recurring_profile_lookup_failed", "Unable to load recurring profile.");
  }

  return (data as RecurringProfileRow | null) ?? null;
}

async function listBaselineRequestRows(
  supabase: SupabaseClient,
  tenantId: string,
  profileId: string,
): Promise<RecurringProfileConsentRequestRow[]> {
  const { data, error } = await supabase
    .from("recurring_profile_consent_requests")
    .select(
      "id, tenant_id, profile_id, consent_template_id, profile_email_snapshot, status, expires_at, created_at, updated_at",
    )
    .eq("tenant_id", tenantId)
    .eq("profile_id", profileId)
    .eq("consent_kind", "baseline")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    throw new HttpError(
      500,
      "recurring_profile_consent_request_list_failed",
      "Unable to load recurring baseline consent requests.",
    );
  }

  return ((data as RecurringProfileConsentRequestRow[] | null) ?? []).slice();
}

async function listBaselineConsentRows(
  supabase: SupabaseClient,
  tenantId: string,
  profileId: string,
): Promise<RecurringProfileConsentRow[]> {
  const { data, error } = await supabase
    .from("recurring_profile_consents")
    .select("id, tenant_id, profile_id, revoked_at")
    .eq("tenant_id", tenantId)
    .eq("profile_id", profileId)
    .eq("consent_kind", "baseline")
    .order("signed_at", { ascending: false })
    .limit(20);

  if (error) {
    throw new HttpError(500, "recurring_profile_consent_list_failed", "Unable to load recurring baseline consents.");
  }

  return ((data as RecurringProfileConsentRow[] | null) ?? []).slice();
}

async function getRequestRowById(
  supabase: SupabaseClient,
  tenantId: string,
  requestId: string,
): Promise<RecurringProfileConsentRequestRow | null> {
  const { data, error } = await supabase
    .from("recurring_profile_consent_requests")
    .select(
      "id, tenant_id, profile_id, consent_template_id, profile_email_snapshot, status, expires_at, created_at, updated_at",
    )
    .eq("tenant_id", tenantId)
    .eq("id", requestId)
    .maybeSingle();

  if (error) {
    throw new HttpError(
      500,
      "recurring_profile_consent_request_lookup_failed",
      "Unable to load recurring baseline consent request.",
    );
  }

  return (data as RecurringProfileConsentRequestRow | null) ?? null;
}

async function expireStalePendingRequests(
  supabase: SupabaseClient,
  tenantId: string,
  profileId: string,
) {
  const { error } = await supabase
    .from("recurring_profile_consent_requests")
    .update({
      status: "expired",
    })
    .eq("tenant_id", tenantId)
    .eq("profile_id", profileId)
    .eq("consent_kind", "baseline")
    .eq("status", "pending")
    .lte("expires_at", new Date().toISOString());

  if (error) {
    throw new HttpError(
      500,
      "baseline_follow_up_failed",
      "Unable to resolve the current baseline consent request.",
    );
  }
}

function buildFollowUpRequestSummary(requestRow: RecurringProfileConsentRequestRow): FollowUpRequestSummary {
  const token = deriveRecurringProfileConsentToken({ requestId: requestRow.id });

  return {
    id: requestRow.id,
    profileId: requestRow.profile_id,
    consentTemplateId: requestRow.consent_template_id,
    status: "pending",
    expiresAt: requestRow.expires_at,
    consentPath: buildRecurringProfileConsentPath(token),
    emailSnapshot: requestRow.profile_email_snapshot,
  };
}

async function createDeliveryAttempt(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
  profileId: string,
  request: FollowUpRequestSummary,
  actionKind: BaselineFollowUpActionKind,
): Promise<DeliveryAttemptRow> {
  const delivery = await dispatchPlaceholderBaselineFollowUp({
    actionKind,
    request: {
      id: request.id,
      profileId: request.profileId,
      consentPath: request.consentPath,
      emailSnapshot: request.emailSnapshot,
    },
  });

  const { data, error } = await supabase
    .from("recurring_profile_consent_request_delivery_attempts")
    .insert({
      tenant_id: tenantId,
      profile_id: profileId,
      request_id: request.id,
      action_kind: actionKind,
      delivery_mode: delivery.deliveryMode,
      status: delivery.status,
      target_email: request.emailSnapshot,
      created_by: userId,
    })
    .select("id, request_id, action_kind, delivery_mode, status, target_email, error_code, created_at")
    .single();

  if (error || !data) {
    throw new HttpError(
      500,
      "baseline_follow_up_delivery_record_failed",
      "Unable to record this baseline follow-up attempt.",
    );
  }

  return data as DeliveryAttemptRow;
}

function buildFollowUpPayload(
  action: BaselineFollowUpActionKind,
  request: FollowUpRequestSummary,
  deliveryAttempt: DeliveryAttemptRow,
): BaselineFollowUpPayload {
  return {
    followUp: {
      action,
      deliveryMode: deliveryAttempt.delivery_mode,
      deliveryStatus: deliveryAttempt.status,
      request,
      deliveryAttempt: {
        id: deliveryAttempt.id,
        requestId: deliveryAttempt.request_id,
        actionKind: deliveryAttempt.action_kind,
        deliveryMode: deliveryAttempt.delivery_mode,
        status: deliveryAttempt.status,
        targetEmail: deliveryAttempt.target_email,
        attemptedAt: deliveryAttempt.created_at,
        errorCode: deliveryAttempt.error_code,
      },
    },
  };
}

export async function sendBaselineFollowUp(input: SendBaselineFollowUpInput) {
  await assertProfilesManager(input.supabase, input.tenantId, input.userId);

  const profileId = validateUuid(input.profileId, "recurring_profile_not_found", "Recurring profile not found.");
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
  const consentTemplateId = normalizeOptionalUuid(input.consentTemplateId);
  const operation = `baseline_follow_up_recurring_profile_consent_request:${profileId}`;

  const existingPayload = await readIdempotencyPayload<BaselineFollowUpPayload>(
    input.supabase,
    input.tenantId,
    operation,
    idempotencyKey,
  );

  if (existingPayload) {
    return {
      status: 200,
      payload: existingPayload,
    };
  }

  const profile = await getRecurringProfileRowById(input.supabase, input.tenantId, profileId);
  if (!profile) {
    throw new HttpError(404, "recurring_profile_not_found", "Recurring profile not found.");
  }

  if (profile.status === "archived") {
    throw new HttpError(
      409,
      "recurring_profile_archived",
      "Archived profiles cannot receive baseline consent requests.",
    );
  }

  const [requestRows, consentRows] = await Promise.all([
    listBaselineRequestRows(input.supabase, input.tenantId, profileId),
    listBaselineConsentRows(input.supabase, input.tenantId, profileId),
  ]);

  const activeSignedConsent = consentRows.find((row) => row.revoked_at === null) ?? null;
  if (activeSignedConsent) {
    throw new HttpError(
      409,
      "baseline_consent_already_signed",
      "This profile already has an active baseline consent.",
    );
  }

  const activePendingRequest =
    requestRows.find((row) => row.status === "pending" && new Date(row.expires_at).getTime() > Date.now()) ?? null;
  const latestRequestBeforeFollowUp = requestRows[0] ?? null;

  let action: BaselineFollowUpActionKind = "reminder";
  let request: FollowUpRequestSummary;
  let status = 200;

  if (activePendingRequest) {
    request = buildFollowUpRequestSummary(activePendingRequest);
  } else {
    await expireStalePendingRequests(input.supabase, input.tenantId, profileId);

    const fallbackTemplateId = consentTemplateId ?? requestRows[0]?.consent_template_id ?? null;
    if (!fallbackTemplateId) {
      throw new HttpError(
        400,
        "baseline_follow_up_template_required",
        "A published template is required to send a new baseline request.",
      );
    }

    const created = await createBaselineConsentRequest({
      supabase: input.supabase,
      tenantId: input.tenantId,
      userId: input.userId,
      profileId,
      consentTemplateId: fallbackTemplateId,
      idempotencyKey,
    });

    const createdRequest = await getRequestRowById(
      input.supabase,
      input.tenantId,
      created.payload.request.id,
    );

    if (!createdRequest || createdRequest.status !== "pending") {
      throw new HttpError(
        500,
        "baseline_follow_up_failed",
        "Unable to resolve the current baseline consent request.",
      );
    }

    if (latestRequestBeforeFollowUp && latestRequestBeforeFollowUp.id === createdRequest.id) {
      const latestWasValidPending =
        latestRequestBeforeFollowUp.status === "pending"
        && new Date(latestRequestBeforeFollowUp.expires_at).getTime() > Date.now();

      if (!latestWasValidPending) {
        throw new HttpError(
          500,
          "baseline_follow_up_failed",
          "Unable to resolve the current baseline consent request.",
        );
      }
    }

    const createdDifferentRequest =
      latestRequestBeforeFollowUp !== null && createdRequest.id !== latestRequestBeforeFollowUp.id;

    if (
      latestRequestBeforeFollowUp
      && latestRequestBeforeFollowUp.status === "pending"
      && new Date(latestRequestBeforeFollowUp.expires_at).getTime() <= Date.now()
      && latestRequestBeforeFollowUp.id === createdRequest.id
    ) {
      throw new HttpError(
        500,
        "baseline_follow_up_failed",
        "Unable to resolve the current baseline consent request.",
      );
    }

    request = buildFollowUpRequestSummary(createdRequest);
    if (created.status === 201 || createdDifferentRequest) {
      action = "new_request";
      status = 201;
    } else {
      action = "reminder";
      status = 200;
    }
  }

  const deliveryAttempt = await createDeliveryAttempt(
    input.supabase,
    input.tenantId,
    input.userId,
    profileId,
    request,
    action,
  );

  const payload = buildFollowUpPayload(action, request, deliveryAttempt);
  await writeIdempotencyPayload(input.supabase, input.tenantId, input.userId, operation, idempotencyKey, payload);

  return {
    status,
    payload,
  };
}
