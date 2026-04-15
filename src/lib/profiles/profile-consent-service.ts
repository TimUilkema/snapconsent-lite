import { randomUUID } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import { getVisiblePublishedTemplateById } from "@/lib/templates/template-service";
import { deriveRecurringProfileConsentToken, hashPublicToken } from "@/lib/tokens/public-token";
import { buildRecurringProfileConsentPath } from "@/lib/url/paths";

import { resolveProfilesAccess } from "./profile-access";

type IdempotencyRow<T> = {
  response_json: T;
};

type CreateBaselineConsentRequestInput = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  profileId: string;
  consentTemplateId: string;
  idempotencyKey: string;
};

type CancelBaselineConsentRequestInput = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  profileId: string;
  requestId: string;
};

type ReplaceBaselineConsentRequestInput = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  profileId: string;
  requestId: string;
  idempotencyKey: string;
};

type CreateBaselineConsentRequestRpcRow = {
  request_id: string;
  tenant_id: string;
  profile_id: string;
  consent_template_id: string;
  status: "pending";
  expires_at: string;
  reused_existing: boolean;
};

type CancelBaselineConsentRequestRpcRow = {
  request_id: string;
  tenant_id: string;
  profile_id: string;
  status: "cancelled";
  updated_at: string;
};

type ReplaceBaselineConsentRequestRpcRow = {
  request_id: string;
  tenant_id: string;
  profile_id: string;
  consent_template_id: string;
  status: "pending";
  expires_at: string;
  profile_email_snapshot: string;
  replaced_request_id: string;
  replaced_status: "superseded";
  replaced_superseded_by_request_id: string;
  replaced_updated_at: string;
};

export type BaselineConsentRequestPayload = {
  request: {
    id: string;
    profileId: string;
    consentTemplateId: string;
    status: "pending";
    expiresAt: string;
    consentPath: string;
  };
};

export type CancelBaselineConsentRequestPayload = {
  request: {
    id: string;
    profileId: string;
    status: "cancelled";
    updatedAt: string;
  };
};

export type ReplaceBaselineConsentRequestPayload = {
  request: {
    id: string;
    profileId: string;
    consentTemplateId: string;
    status: "pending";
    expiresAt: string;
    consentPath: string;
    emailSnapshot: string;
  };
  replacedRequest: {
    id: string;
    status: "superseded";
    supersededByRequestId: string;
    updatedAt: string;
  };
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

function getRecurringRequestExpiryIso() {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);
  return expiresAt.toISOString();
}

function mapCreateBaselineRequestError(error: { code?: string; message?: string } | null): never {
  if (!error) {
    throw new HttpError(
      500,
      "baseline_consent_request_create_failed",
      "Unable to create a baseline consent request.",
    );
  }

  if (error.code === "42501" || error.message === "recurring_profile_management_forbidden") {
    throw new HttpError(
      403,
      "recurring_profile_management_forbidden",
      "Only workspace owners and admins can manage recurring profiles.",
    );
  }

  if (error.code === "P0002" && error.message === "recurring_profile_not_found") {
    throw new HttpError(404, "recurring_profile_not_found", "Recurring profile not found.");
  }

  if (error.code === "P0002" && error.message === "template_not_found") {
    throw new HttpError(404, "template_not_found", "Template not found.");
  }

  if (error.code === "23505" && error.message === "baseline_consent_already_signed") {
    throw new HttpError(
      409,
      "baseline_consent_already_signed",
      "This profile already has an active baseline consent.",
    );
  }

  if (error.code === "23514" && error.message === "recurring_profile_archived") {
    throw new HttpError(
      409,
      "recurring_profile_archived",
      "Archived profiles cannot receive baseline consent requests.",
    );
  }

  if (error.code === "23514" && error.message === "baseline_template_unavailable") {
    throw new HttpError(
      409,
      "baseline_template_unavailable",
      "The selected published template is not available for baseline consent requests.",
    );
  }

  throw new HttpError(
    500,
    "baseline_consent_request_create_failed",
    "Unable to create a baseline consent request.",
  );
}

function mapCancelBaselineRequestError(error: { code?: string; message?: string } | null): never {
  if (!error) {
    throw new HttpError(
      500,
      "baseline_consent_request_cancel_failed",
      "Unable to cancel this baseline consent request.",
    );
  }

  if (error.code === "42501" || error.message === "recurring_profile_management_forbidden") {
    throw new HttpError(
      403,
      "recurring_profile_management_forbidden",
      "Only workspace owners and admins can manage recurring profiles.",
    );
  }

  if (error.code === "P0002" && error.message === "baseline_consent_request_not_found") {
    throw new HttpError(
      404,
      "baseline_consent_request_not_found",
      "Baseline consent request not found.",
    );
  }

  if (
    (error.code === "22023" || error.code === "23514")
    && error.message === "baseline_consent_request_not_pending"
  ) {
    throw new HttpError(
      409,
      "baseline_consent_request_not_pending",
      "This baseline consent request is no longer pending.",
    );
  }

  throw new HttpError(
    500,
    "baseline_consent_request_cancel_failed",
    "Unable to cancel this baseline consent request.",
  );
}

function mapReplaceBaselineRequestError(error: { code?: string; message?: string } | null): never {
  if (!error) {
    throw new HttpError(
      500,
      "baseline_consent_request_replace_failed",
      "Unable to replace this baseline consent request.",
    );
  }

  if (error.code === "42501" || error.message === "recurring_profile_management_forbidden") {
    throw new HttpError(
      403,
      "recurring_profile_management_forbidden",
      "Only workspace owners and admins can manage recurring profiles.",
    );
  }

  if (error.code === "P0002" && error.message === "baseline_consent_request_not_found") {
    throw new HttpError(
      404,
      "baseline_consent_request_not_found",
      "Baseline consent request not found.",
    );
  }

  if (
    (error.code === "22023" || error.code === "23514")
    && error.message === "baseline_consent_request_not_pending"
  ) {
    throw new HttpError(
      409,
      "baseline_consent_request_not_pending",
      "This baseline consent request is no longer pending.",
    );
  }

  if (error.code === "23505" && error.message === "baseline_consent_already_signed") {
    throw new HttpError(
      409,
      "baseline_consent_already_signed",
      "This profile already has an active baseline consent.",
    );
  }

  if (error.code === "23514" && error.message === "recurring_profile_archived") {
    throw new HttpError(
      409,
      "recurring_profile_archived",
      "Archived profiles cannot receive baseline consent requests.",
    );
  }

  throw new HttpError(
    500,
    "baseline_consent_request_replace_failed",
    "Unable to replace this baseline consent request.",
  );
}

export async function createBaselineConsentRequest(input: CreateBaselineConsentRequestInput) {
  await assertProfilesManager(input.supabase, input.tenantId, input.userId);

  const profileId = validateUuid(input.profileId, "recurring_profile_not_found", "Recurring profile not found.");
  const consentTemplateId = validateUuid(input.consentTemplateId, "template_not_found", "Template not found.");
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
  const operation = `create_baseline_recurring_profile_consent_request:${profileId}`;

  const existingPayload = await readIdempotencyPayload<BaselineConsentRequestPayload>(
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

  const template = await getVisiblePublishedTemplateById(input.supabase, input.tenantId, consentTemplateId);
  if (!template) {
    throw new HttpError(
      409,
      "baseline_template_unavailable",
      "The selected published template is not available for baseline consent requests.",
    );
  }

  const requestId = randomUUID();
  const token = deriveRecurringProfileConsentToken({ requestId });
  const expiresAt = getRecurringRequestExpiryIso();

  const { data, error } = await input.supabase.rpc("create_recurring_profile_baseline_request", {
    p_profile_id: profileId,
    p_consent_template_id: template.id,
    p_request_id: requestId,
    p_token_hash: hashPublicToken(token),
    p_expires_at: expiresAt,
  });

  if (error) {
    mapCreateBaselineRequestError(error);
  }

  const row = (data?.[0] as CreateBaselineConsentRequestRpcRow | undefined) ?? null;
  if (!row) {
    throw new HttpError(
      500,
      "baseline_consent_request_create_failed",
      "Unable to create a baseline consent request.",
    );
  }

  const resolvedToken = deriveRecurringProfileConsentToken({ requestId: row.request_id });
  const payload: BaselineConsentRequestPayload = {
    request: {
      id: row.request_id,
      profileId: row.profile_id,
      consentTemplateId: row.consent_template_id,
      status: row.status,
      expiresAt: row.expires_at,
      consentPath: buildRecurringProfileConsentPath(resolvedToken),
    },
  };

  await writeIdempotencyPayload(input.supabase, input.tenantId, input.userId, operation, idempotencyKey, payload);

  return {
    status: row.reused_existing ? 200 : 201,
    payload,
  };
}

export async function cancelBaselineConsentRequest(input: CancelBaselineConsentRequestInput) {
  await assertProfilesManager(input.supabase, input.tenantId, input.userId);

  const profileId = validateUuid(input.profileId, "baseline_consent_request_not_found", "Baseline consent request not found.");
  const requestId = validateUuid(input.requestId, "baseline_consent_request_not_found", "Baseline consent request not found.");

  const { data, error } = await input.supabase.rpc("cancel_recurring_profile_baseline_request", {
    p_profile_id: profileId,
    p_request_id: requestId,
  });

  if (error) {
    mapCancelBaselineRequestError(error);
  }

  const row = (data?.[0] as CancelBaselineConsentRequestRpcRow | undefined) ?? null;
  if (!row) {
    throw new HttpError(
      500,
      "baseline_consent_request_cancel_failed",
      "Unable to cancel this baseline consent request.",
    );
  }

  const payload: CancelBaselineConsentRequestPayload = {
    request: {
      id: row.request_id,
      profileId: row.profile_id,
      status: row.status,
      updatedAt: row.updated_at,
    },
  };

  return {
    status: 200,
    payload,
  };
}

export async function replaceBaselineConsentRequest(input: ReplaceBaselineConsentRequestInput) {
  await assertProfilesManager(input.supabase, input.tenantId, input.userId);

  const profileId = validateUuid(input.profileId, "baseline_consent_request_not_found", "Baseline consent request not found.");
  const requestId = validateUuid(input.requestId, "baseline_consent_request_not_found", "Baseline consent request not found.");
  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
  const operation = `replace_baseline_recurring_profile_consent_request:${requestId}`;

  const existingPayload = await readIdempotencyPayload<ReplaceBaselineConsentRequestPayload>(
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

  const newRequestId = randomUUID();
  const token = deriveRecurringProfileConsentToken({ requestId: newRequestId });
  const expiresAt = getRecurringRequestExpiryIso();

  const { data, error } = await input.supabase.rpc("replace_recurring_profile_baseline_request", {
    p_profile_id: profileId,
    p_request_id: requestId,
    p_new_request_id: newRequestId,
    p_new_token_hash: hashPublicToken(token),
    p_expires_at: expiresAt,
  });

  if (error) {
    mapReplaceBaselineRequestError(error);
  }

  const row = (data?.[0] as ReplaceBaselineConsentRequestRpcRow | undefined) ?? null;
  if (!row) {
    throw new HttpError(
      500,
      "baseline_consent_request_replace_failed",
      "Unable to replace this baseline consent request.",
    );
  }

  const resolvedToken = deriveRecurringProfileConsentToken({ requestId: row.request_id });
  const payload: ReplaceBaselineConsentRequestPayload = {
    request: {
      id: row.request_id,
      profileId: row.profile_id,
      consentTemplateId: row.consent_template_id,
      status: row.status,
      expiresAt: row.expires_at,
      consentPath: buildRecurringProfileConsentPath(resolvedToken),
      emailSnapshot: row.profile_email_snapshot,
    },
    replacedRequest: {
      id: row.replaced_request_id,
      status: row.replaced_status,
      supersededByRequestId: row.replaced_superseded_by_request_id,
      updatedAt: row.replaced_updated_at,
    },
  };

  await writeIdempotencyPayload(input.supabase, input.tenantId, input.userId, operation, idempotencyKey, payload);

  return {
    status: 201,
    payload,
  };
}
