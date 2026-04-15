import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import { listVisibleTemplatesForTenant } from "@/lib/templates/template-service";
import {
  getStructuredOptionLabel,
  type StructuredFieldsSnapshot,
} from "@/lib/templates/structured-fields";
import { deriveRecurringProfileConsentToken } from "@/lib/tokens/public-token";
import { buildRecurringProfileConsentPath } from "@/lib/url/paths";

import {
  deriveRecurringProfileMatchingReadiness,
  getRecurringProfileHeadshotDetail,
  getRecurringProfileHeadshotSignedPreviewUrl,
  type RecurringProfileHeadshotDetail,
  type RecurringProfileMatchingReadiness,
} from "./profile-headshot-service";
import { resolveProfilesAccess, type ProfilesAccess } from "./profile-access";

type RecurringProfileStatus = "active" | "archived";
type RecurringProfileTypeStatus = "active" | "archived";

type RecurringProfileTypeRow = {
  id: string;
  tenant_id: string;
  label: string;
  normalized_label: string;
  status: RecurringProfileTypeStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

type RecurringProfileRow = {
  id: string;
  tenant_id: string;
  profile_type_id: string | null;
  full_name: string;
  email: string;
  normalized_email: string;
  status: RecurringProfileStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
};

type RecurringProfileConsentRequestRow = {
  id: string;
  tenant_id: string;
  profile_id: string;
  consent_kind: "baseline";
  consent_template_id: string;
  profile_email_snapshot: string;
  status: "pending" | "signed" | "expired" | "superseded" | "cancelled";
  expires_at: string;
  created_at: string;
  updated_at: string;
  superseded_by_request_id: string | null;
};

type RecurringProfileConsentRow = {
  id: string;
  tenant_id: string;
  profile_id: string;
  consent_kind: "baseline";
  signed_at: string;
  revoked_at: string | null;
  created_at: string;
};

type RecurringProfileConsentRequestDetailRow = {
  id: string;
  tenant_id: string;
  profile_id: string;
  consent_kind: "baseline";
  consent_template_id: string;
  profile_name_snapshot: string;
  profile_email_snapshot: string;
  status: "pending" | "signed" | "expired" | "superseded" | "cancelled";
  expires_at: string;
  created_at: string;
  updated_at: string;
  superseded_by_request_id: string | null;
};

type RecurringProfileConsentDetailRow = {
  id: string;
  tenant_id: string;
  profile_id: string;
  request_id: string;
  consent_kind: "baseline";
  consent_template_id: string;
  profile_name_snapshot: string;
  profile_email_snapshot: string;
  consent_version: string;
  structured_fields_snapshot: StructuredFieldsSnapshot | null;
  signed_at: string;
  revoked_at: string | null;
  revoke_reason: string | null;
  receipt_email_sent_at: string | null;
  created_at: string;
};

type RecurringProfileConsentRequestDeliveryAttemptRow = {
  id: string;
  tenant_id: string;
  profile_id: string;
  request_id: string;
  action_kind: "reminder" | "new_request";
  delivery_mode: "placeholder";
  status: "recorded" | "failed";
  target_email: string;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
};

type ConsentTemplateLookupRow = {
  id: string;
  tenant_id: string | null;
  name: string;
  version: string;
  status: "draft" | "published" | "archived";
};

type IdempotencyRow<T> = {
  response_json: T;
};

type CreateRecurringProfilePayload = {
  profile: RecurringProfileListItem;
};

type CreateRecurringProfileTypePayload = {
  profileType: RecurringProfileTypeSummary;
};

export type RecurringProfileTypeSummary = {
  id: string;
  label: string;
  status: RecurringProfileTypeStatus;
  updatedAt: string;
  archivedAt: string | null;
  activeProfileCount: number;
};

export type RecurringProfileListItem = {
  id: string;
  fullName: string;
  email: string;
  status: RecurringProfileStatus;
  updatedAt: string;
  archivedAt: string | null;
  profileType: {
    id: string;
    label: string;
    status: RecurringProfileTypeStatus;
    archivedAt: string | null;
  } | null;
  baselineConsent: {
    state: "missing" | "pending" | "signed" | "revoked";
    pendingRequest: {
      id: string;
      expiresAt: string;
      consentPath: string;
      emailSnapshot: string;
      updatedAt: string;
    } | null;
    latestActivityAt: string | null;
    latestRequestOutcome: {
      status: "cancelled" | "superseded" | "expired";
      changedAt: string;
    } | null;
  };
  matchingReadiness: RecurringProfileMatchingReadiness;
};

export type BaselineConsentTemplateOption = {
  id: string;
  name: string;
  version: string;
  scope: "app" | "tenant";
};

export type RecurringProfilesSummary = {
  activeProfiles: number;
  archivedProfiles: number;
  activeProfileTypes: number;
  activeProfilesWithoutType: number;
};

export type RecurringProfilesFilters = {
  q: string;
  profileTypeId: string | null;
  includeArchived: boolean;
};

export type RecurringProfilesPageData = {
  access: ProfilesAccess;
  summary: RecurringProfilesSummary;
  filters: RecurringProfilesFilters;
  baselineTemplates: BaselineConsentTemplateOption[];
  profileTypes: RecurringProfileTypeSummary[];
  profiles: RecurringProfileListItem[];
};

export type RecurringProfileStructuredSummary = {
  scopeLabels: string[];
  durationLabel: string | null;
};

export type RecurringProfileDetailData = {
  access: ProfilesAccess;
  profile: {
    id: string;
    fullName: string;
    email: string;
    status: RecurringProfileStatus;
    updatedAt: string;
    archivedAt: string | null;
    profileType: {
      id: string;
      label: string;
      status: RecurringProfileTypeStatus;
      archivedAt: string | null;
    } | null;
  };
  baselineConsent: RecurringProfileListItem["baselineConsent"] & {
    pendingRequest: (RecurringProfileListItem["baselineConsent"]["pendingRequest"] & {
      fullNameSnapshot: string;
      templateName: string | null;
      templateVersion: string | null;
      createdAt: string;
    }) | null;
    activeConsent: {
      id: string;
      requestId: string;
      signedAt: string;
      emailSnapshot: string;
      fullNameSnapshot: string;
      templateName: string | null;
      templateVersion: string | null;
      structuredSummary: RecurringProfileStructuredSummary | null;
      receiptEmailSentAt: string | null;
    } | null;
    latestRevokedConsent: {
      id: string;
      requestId: string;
      signedAt: string;
      revokedAt: string;
      revokeReason: string | null;
      emailSnapshot: string;
      fullNameSnapshot: string;
      templateName: string | null;
      templateVersion: string | null;
      structuredSummary: RecurringProfileStructuredSummary | null;
      receiptEmailSentAt: string | null;
    } | null;
    latestFollowUpAttempt?: {
      id: string;
      requestId: string;
      actionKind: "reminder" | "new_request";
      deliveryMode: "placeholder";
      status: "recorded" | "failed";
      targetEmail: string;
      attemptedAt: string;
      errorCode: string | null;
    } | null;
  };
  requestHistory: Array<{
    id: string;
    status: "pending" | "signed" | "expired" | "superseded" | "cancelled";
    createdAt: string;
    expiresAt: string;
    changedAt: string;
    emailSnapshot: string;
    fullNameSnapshot: string;
    templateName: string | null;
    templateVersion: string | null;
    supersededByRequestId: string | null;
  }>;
  consentHistory: Array<{
    id: string;
    requestId: string;
    signedAt: string;
    revokedAt: string | null;
    revokeReason: string | null;
    emailSnapshot: string;
    fullNameSnapshot: string;
    templateName: string | null;
    templateVersion: string | null;
    structuredSummary: RecurringProfileStructuredSummary | null;
    receiptEmailSentAt: string | null;
  }>;
  actions: {
    canManageBaseline: boolean;
    canRequestBaselineConsent: boolean;
    canCopyBaselineLink: boolean;
    canOpenBaselineLink: boolean;
    canCancelPendingRequest: boolean;
    canReplacePendingRequest: boolean;
    availableBaselineFollowUpAction?: "reminder" | "new_request" | null;
  };
  headshotMatching: RecurringProfileHeadshotDetail & {
    previewUrl: string | null;
    actions: {
      canManage: boolean;
      canUpload: boolean;
      canReplace: boolean;
      canSelectFace: boolean;
    };
  };
};

type ListRecurringProfilesPageDataInput = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  q?: string | null;
  profileTypeId?: string | null;
  includeArchived?: boolean;
};

type GetRecurringProfileDetailDataInput = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  profileId: string;
};

type CreateRecurringProfileInput = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  idempotencyKey: string;
  fullName: string;
  email: string;
  profileTypeId?: string | null;
};

type CreateRecurringProfileResult = {
  status: number;
  payload: CreateRecurringProfilePayload;
};

type ArchiveRecurringProfileInput = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  profileId: string;
};

type CreateRecurringProfileTypeInput = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  idempotencyKey: string;
  label: string;
};

type CreateRecurringProfileTypeResult = {
  status: number;
  payload: CreateRecurringProfileTypePayload;
};

type ArchiveRecurringProfileTypeInput = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  profileTypeId: string;
};

const RECURRING_PROFILE_SELECT =
  "id, tenant_id, profile_type_id, full_name, email, normalized_email, status, created_by, created_at, updated_at, archived_at";

const RECURRING_PROFILE_TYPE_SELECT =
  "id, tenant_id, label, normalized_label, status, created_by, created_at, updated_at, archived_at";

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function normalizeSearchQuery(value: string | null | undefined) {
  const normalized = normalizeWhitespace(value ?? "");
  if (normalized.length === 0) {
    return "";
  }

  return normalized.slice(0, 120);
}

function normalizeProfileName(value: string) {
  return normalizeWhitespace(value);
}

function normalizeProfileTypeLabel(value: string) {
  return normalizeWhitespace(value);
}

function normalizeProfileEmail(value: string) {
  return value.trim().toLowerCase();
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validateIdempotencyKey(value: string) {
  const normalized = value.trim();
  if (normalized.length < 8 || normalized.length > 200) {
    throw new HttpError(400, "invalid_idempotency_key", "Idempotency-Key header is required.");
  }

  return normalized;
}

function validateProfileName(value: string) {
  const normalized = normalizeProfileName(value);
  if (normalized.length < 2 || normalized.length > 160) {
    throw new HttpError(400, "invalid_profile_name", "Profile name must be between 2 and 160 characters.");
  }

  return normalized;
}

function validateProfileEmail(value: string) {
  const trimmed = value.trim();
  if (trimmed.length < 5 || trimmed.length > 320 || !isValidEmail(trimmed)) {
    throw new HttpError(400, "invalid_profile_email", "A valid email address is required.");
  }

  return {
    email: trimmed,
    normalizedEmail: normalizeProfileEmail(trimmed),
  };
}

function validateProfileTypeLabel(value: string) {
  const normalized = normalizeProfileTypeLabel(value);
  if (normalized.length < 2 || normalized.length > 80) {
    throw new HttpError(
      400,
      "invalid_profile_type_label",
      "Profile type labels must be between 2 and 80 characters.",
    );
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

  return access;
}

function mapRecurringProfileType(row: RecurringProfileTypeRow, activeProfileCount: number): RecurringProfileTypeSummary {
  return {
    id: row.id,
    label: row.label,
    status: row.status,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    activeProfileCount,
  };
}

function mapRecurringProfile(
  row: RecurringProfileRow,
  profileType: RecurringProfileTypeRow | null,
  baselineConsent: RecurringProfileListItem["baselineConsent"],
  matchingReadiness: RecurringProfileMatchingReadiness,
): RecurringProfileListItem {
  return {
    id: row.id,
    fullName: row.full_name,
    email: row.email,
    status: row.status,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    profileType: profileType
      ? {
          id: profileType.id,
          label: profileType.label,
          status: profileType.status,
          archivedAt: profileType.archived_at,
        }
      : null,
    baselineConsent,
    matchingReadiness,
  };
}

function buildRecurringProfileStructuredSummary(
  snapshot: StructuredFieldsSnapshot | null,
): RecurringProfileStructuredSummary | null {
  if (!snapshot) {
    return null;
  }

  const scopeValue = snapshot.values.scope;
  const durationValue = snapshot.values.duration;

  const scopeLabels =
    scopeValue?.valueType === "checkbox_list"
      ? scopeValue.selectedOptionKeys
          .map((optionKey) => getStructuredOptionLabel(snapshot.definition.builtInFields.scope, optionKey))
          .filter((value): value is string => Boolean(value))
      : [];
  const durationLabel =
    durationValue?.valueType === "single_select" && durationValue.selectedOptionKey
      ? getStructuredOptionLabel(
          snapshot.definition.builtInFields.duration,
          durationValue.selectedOptionKey,
        )
      : null;

  if (scopeLabels.length === 0 && !durationLabel) {
    return null;
  }

  return {
    scopeLabels,
    durationLabel,
  };
}

async function listTemplatesByIds(
  supabase: SupabaseClient,
  tenantId: string,
  templateIds: string[],
): Promise<Map<string, ConsentTemplateLookupRow>> {
  const uniqueTemplateIds = Array.from(new Set(templateIds.filter((templateId) => isUuid(templateId))));
  if (uniqueTemplateIds.length === 0) {
    return new Map();
  }

  const [appTemplatesResult, tenantTemplatesResult] = await Promise.all([
    supabase
      .from("consent_templates")
      .select("id, tenant_id, name, version, status")
      .is("tenant_id", null)
      .in("id", uniqueTemplateIds),
    supabase
      .from("consent_templates")
      .select("id, tenant_id, name, version, status")
      .eq("tenant_id", tenantId)
      .in("id", uniqueTemplateIds),
  ]);

  if (appTemplatesResult.error || tenantTemplatesResult.error) {
    throw new HttpError(500, "template_lookup_failed", "Unable to load consent template details.");
  }

  const templateRows = [
    ...((appTemplatesResult.data as ConsentTemplateLookupRow[] | null) ?? []),
    ...((tenantTemplatesResult.data as ConsentTemplateLookupRow[] | null) ?? []),
  ];

  return new Map(templateRows.map((row) => [row.id, row]));
}

function deriveBaselineConsentSummary(
  profileId: string,
  requestRows: RecurringProfileConsentRequestRow[],
  consentRows: RecurringProfileConsentRow[],
): RecurringProfileListItem["baselineConsent"] {
  const terminalRequestOutcome =
    requestRows
      .map((row) => {
        if (row.status === "pending" && new Date(row.expires_at).getTime() <= Date.now()) {
          return {
            status: "expired" as const,
            changedAt: row.expires_at,
          };
        }

        if (row.status === "expired" || row.status === "cancelled" || row.status === "superseded") {
          return {
            status: row.status,
            changedAt: row.updated_at,
          };
        }

        return null;
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)
      .sort((a, b) => new Date(b.changedAt).getTime() - new Date(a.changedAt).getTime())[0] ?? null;
  const activePendingRequest =
    requestRows
      .filter((row) => row.status === "pending" && new Date(row.expires_at).getTime() > Date.now())
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0] ?? null;
  const activeSignedConsent =
    consentRows
      .filter((row) => row.revoked_at === null)
      .sort((a, b) => new Date(b.signed_at).getTime() - new Date(a.signed_at).getTime())[0] ?? null;
  const latestRevokedConsent =
    consentRows
      .filter((row) => row.revoked_at !== null)
      .sort(
        (a, b) =>
          new Date(b.revoked_at ?? b.signed_at).getTime() - new Date(a.revoked_at ?? a.signed_at).getTime(),
      )[0] ?? null;

  if (activeSignedConsent) {
    return {
      state: "signed",
      pendingRequest: null,
      latestActivityAt: activeSignedConsent.signed_at,
      latestRequestOutcome: null,
    };
  }

  if (activePendingRequest) {
    const token = deriveRecurringProfileConsentToken({ requestId: activePendingRequest.id });
    return {
      state: "pending",
      pendingRequest: {
        id: activePendingRequest.id,
        expiresAt: activePendingRequest.expires_at,
        consentPath: buildRecurringProfileConsentPath(token),
        emailSnapshot: activePendingRequest.profile_email_snapshot,
        updatedAt: activePendingRequest.updated_at,
      },
      latestActivityAt: activePendingRequest.expires_at,
      latestRequestOutcome: null,
    };
  }

  if (latestRevokedConsent) {
    return {
      state: "revoked",
      pendingRequest: null,
      latestActivityAt: latestRevokedConsent.revoked_at,
      latestRequestOutcome: null,
    };
  }

  return {
    state: "missing",
    pendingRequest: null,
    latestActivityAt: null,
    latestRequestOutcome: terminalRequestOutcome,
  };
}

function createMissingBaselineConsentSummary(): RecurringProfileListItem["baselineConsent"] {
  return {
    state: "missing",
    pendingRequest: null,
    latestActivityAt: null,
    latestRequestOutcome: null,
  };
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

async function getRecurringProfileTypeRowById(
  supabase: SupabaseClient,
  tenantId: string,
  profileTypeId: string,
): Promise<RecurringProfileTypeRow | null> {
  const { data, error } = await supabase
    .from("recurring_profile_types")
    .select(RECURRING_PROFILE_TYPE_SELECT)
    .eq("tenant_id", tenantId)
    .eq("id", profileTypeId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "recurring_profile_type_lookup_failed", "Unable to load recurring profile type.");
  }

  return (data as RecurringProfileTypeRow | null) ?? null;
}

async function getRecurringProfileRowById(
  supabase: SupabaseClient,
  tenantId: string,
  profileId: string,
): Promise<RecurringProfileRow | null> {
  const { data, error } = await supabase
    .from("recurring_profiles")
    .select(RECURRING_PROFILE_SELECT)
    .eq("tenant_id", tenantId)
    .eq("id", profileId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "recurring_profile_lookup_failed", "Unable to load recurring profile.");
  }

  return (data as RecurringProfileRow | null) ?? null;
}

function mapRecurringProfileMutationError(error: PostgrestError | null): never {
  if (!error) {
    throw new HttpError(500, "recurring_profile_mutation_failed", "Recurring profile mutation failed.");
  }

  if (error.code === "42501" || error.message === "recurring_profile_management_forbidden") {
    throw new HttpError(
      403,
      "recurring_profile_management_forbidden",
      "Only workspace owners and admins can manage recurring profiles.",
    );
  }

  if (error.code === "23505") {
    throw new HttpError(409, "recurring_profile_email_conflict", "An active profile already exists for this email.");
  }

  if (error.code === "23514" && error.message === "invalid_profile_name") {
    throw new HttpError(400, "invalid_profile_name", "Profile name must be between 2 and 160 characters.");
  }

  if (error.code === "23514" && error.message === "invalid_profile_email") {
    throw new HttpError(400, "invalid_profile_email", "A valid email address is required.");
  }

  if (error.code === "23503") {
    throw new HttpError(404, "recurring_profile_type_not_found", "Recurring profile type not found.");
  }

  throw new HttpError(500, "recurring_profile_mutation_failed", "Recurring profile mutation failed.");
}

function mapRecurringProfileTypeMutationError(error: PostgrestError | null): never {
  if (!error) {
    throw new HttpError(500, "recurring_profile_type_mutation_failed", "Recurring profile type mutation failed.");
  }

  if (error.code === "42501" || error.message === "recurring_profile_management_forbidden") {
    throw new HttpError(
      403,
      "recurring_profile_management_forbidden",
      "Only workspace owners and admins can manage recurring profiles.",
    );
  }

  if (error.code === "23505") {
    throw new HttpError(
      409,
      "recurring_profile_type_conflict",
      "An active recurring profile type already exists with this label.",
    );
  }

  if (error.code === "23514" && error.message === "invalid_profile_type_label") {
    throw new HttpError(
      400,
      "invalid_profile_type_label",
      "Profile type labels must be between 2 and 80 characters.",
    );
  }

  throw new HttpError(
    500,
    "recurring_profile_type_mutation_failed",
    "Recurring profile type mutation failed.",
  );
}

export async function listRecurringProfilesPageData(
  input: ListRecurringProfilesPageDataInput,
): Promise<RecurringProfilesPageData> {
  const access = await resolveProfilesAccess(input.supabase, input.tenantId, input.userId);
  const normalizedQuery = normalizeSearchQuery(input.q);

  const [
    { data: profileTypeData, error: profileTypeError },
    { data: profileData, error: profileError },
    { data: requestData, error: requestError },
    { data: consentData, error: consentError },
    baselineTemplates,
  ] =
    await Promise.all([
      input.supabase
        .from("recurring_profile_types")
        .select(RECURRING_PROFILE_TYPE_SELECT)
        .eq("tenant_id", input.tenantId)
        .order("label", { ascending: true }),
      input.supabase
        .from("recurring_profiles")
        .select(RECURRING_PROFILE_SELECT)
        .eq("tenant_id", input.tenantId)
        .order("updated_at", { ascending: false }),
      input.supabase
        .from("recurring_profile_consent_requests")
        .select(
          "id, tenant_id, profile_id, consent_kind, consent_template_id, profile_email_snapshot, status, expires_at, created_at, updated_at, superseded_by_request_id",
        )
        .eq("tenant_id", input.tenantId)
        .eq("consent_kind", "baseline"),
      input.supabase
        .from("recurring_profile_consents")
        .select("id, tenant_id, profile_id, consent_kind, signed_at, revoked_at, created_at")
        .eq("tenant_id", input.tenantId)
        .eq("consent_kind", "baseline"),
      access.canManageProfiles
        ? listVisibleTemplatesForTenant(input.supabase, input.tenantId)
        : Promise.resolve([]),
    ]);

  if (profileTypeError) {
    throw new HttpError(500, "recurring_profile_type_list_failed", "Unable to load recurring profile types.");
  }

  if (profileError) {
    throw new HttpError(500, "recurring_profile_list_failed", "Unable to load recurring profiles.");
  }
  if (requestError) {
    throw new HttpError(
      500,
      "recurring_profile_consent_request_list_failed",
      "Unable to load recurring baseline consent requests.",
    );
  }
  if (consentError) {
    throw new HttpError(500, "recurring_profile_consent_list_failed", "Unable to load recurring baseline consents.");
  }

  const profileTypes = ((profileTypeData as RecurringProfileTypeRow[] | null) ?? []).slice();
  const profiles = ((profileData as RecurringProfileRow[] | null) ?? []).slice();
  const requestRows = ((requestData as RecurringProfileConsentRequestRow[] | null) ?? []).slice();
  const consentRows = ((consentData as RecurringProfileConsentRow[] | null) ?? []).slice();

  const profileTypeMap = new Map(profileTypes.map((profileType) => [profileType.id, profileType]));
  const requestRowsByProfileId = new Map<string, RecurringProfileConsentRequestRow[]>();
  const consentRowsByProfileId = new Map<string, RecurringProfileConsentRow[]>();
  const activeProfileCountByTypeId = new Map<string, number>();

  for (const profile of profiles) {
    if (profile.status !== "active" || !profile.profile_type_id) {
      continue;
    }

    activeProfileCountByTypeId.set(
      profile.profile_type_id,
      (activeProfileCountByTypeId.get(profile.profile_type_id) ?? 0) + 1,
    );
  }

  for (const requestRow of requestRows) {
    const current = requestRowsByProfileId.get(requestRow.profile_id) ?? [];
    current.push(requestRow);
    requestRowsByProfileId.set(requestRow.profile_id, current);
  }

  for (const consentRow of consentRows) {
    const current = consentRowsByProfileId.get(consentRow.profile_id) ?? [];
    current.push(consentRow);
    consentRowsByProfileId.set(consentRow.profile_id, current);
  }

  const resolvedProfileTypeId =
    input.profileTypeId && isUuid(input.profileTypeId) && profileTypeMap.has(input.profileTypeId)
      ? input.profileTypeId
      : null;

  const visibleProfiles = profiles
    .filter((profile) => input.includeArchived || profile.status === "active")
    .filter((profile) => !resolvedProfileTypeId || profile.profile_type_id === resolvedProfileTypeId)
    .filter((profile) => {
      if (normalizedQuery.length === 0) {
        return true;
      }

      const haystacks = [profile.full_name.toLowerCase(), profile.email.toLowerCase()];
      return haystacks.some((value) => value.includes(normalizedQuery.toLowerCase()));
    });

  const matchingReadinessByProfileId = new Map(
    await Promise.all(
      visibleProfiles.map(async (profile) => [
        profile.id,
        await deriveRecurringProfileMatchingReadiness({
          supabase: input.supabase,
          tenantId: input.tenantId,
          profileId: profile.id,
        }),
      ]),
    ),
  );

  const visibleProfileItems = visibleProfiles.map((profile) =>
    mapRecurringProfile(
      profile,
      profileTypeMap.get(profile.profile_type_id ?? "") ?? null,
      deriveBaselineConsentSummary(
        profile.id,
        requestRowsByProfileId.get(profile.id) ?? [],
        consentRowsByProfileId.get(profile.id) ?? [],
      ),
      matchingReadinessByProfileId.get(profile.id) ?? {
        state: "blocked_no_opt_in",
        authorized: false,
        currentHeadshotId: null,
        selectionFaceId: null,
        selectionStatus: null,
        materializationStatus: null,
      },
    ),
  );

  return {
    access,
    summary: {
      activeProfiles: profiles.filter((profile) => profile.status === "active").length,
      archivedProfiles: profiles.filter((profile) => profile.status === "archived").length,
      activeProfileTypes: profileTypes.filter((profileType) => profileType.status === "active").length,
      activeProfilesWithoutType: profiles.filter(
        (profile) => profile.status === "active" && profile.profile_type_id === null,
      ).length,
    },
    filters: {
      q: normalizedQuery,
      profileTypeId: resolvedProfileTypeId,
      includeArchived: Boolean(input.includeArchived),
    },
    baselineTemplates: baselineTemplates.map((template) => ({
      id: template.id,
      name: template.name,
      version: template.version,
      scope: template.scope,
    })),
    profileTypes: profileTypes.map((profileType) =>
      mapRecurringProfileType(profileType, activeProfileCountByTypeId.get(profileType.id) ?? 0),
    ),
    profiles: visibleProfileItems,
  };
}

export async function getRecurringProfileDetailPanelData(
  input: GetRecurringProfileDetailDataInput,
): Promise<RecurringProfileDetailData> {
  const access = await resolveProfilesAccess(input.supabase, input.tenantId, input.userId);
  if (!access.canViewProfiles) {
    throw new HttpError(403, "recurring_profile_view_forbidden", "You do not have access to recurring profiles.");
  }

  if (!isUuid(input.profileId)) {
    throw new HttpError(404, "recurring_profile_not_found", "Recurring profile not found.");
  }

  const profile = await getRecurringProfileRowById(input.supabase, input.tenantId, input.profileId);
  if (!profile) {
    throw new HttpError(404, "recurring_profile_not_found", "Recurring profile not found.");
  }

  const [profileType, requestRowsResult, consentRowsResult, latestFollowUpAttemptResult] = await Promise.all([
    profile.profile_type_id
      ? getRecurringProfileTypeRowById(input.supabase, input.tenantId, profile.profile_type_id)
      : Promise.resolve(null),
    input.supabase
      .from("recurring_profile_consent_requests")
      .select(
        "id, tenant_id, profile_id, consent_kind, consent_template_id, profile_name_snapshot, profile_email_snapshot, status, expires_at, created_at, updated_at, superseded_by_request_id",
      )
      .eq("tenant_id", input.tenantId)
      .eq("profile_id", input.profileId)
      .eq("consent_kind", "baseline")
      .order("created_at", { ascending: false })
      .limit(20),
    input.supabase
      .from("recurring_profile_consents")
      .select(
        "id, tenant_id, profile_id, request_id, consent_kind, consent_template_id, profile_name_snapshot, profile_email_snapshot, consent_version, structured_fields_snapshot, signed_at, revoked_at, revoke_reason, receipt_email_sent_at, created_at",
      )
      .eq("tenant_id", input.tenantId)
      .eq("profile_id", input.profileId)
      .eq("consent_kind", "baseline")
      .order("signed_at", { ascending: false })
      .limit(20),
    input.supabase
      .from("recurring_profile_consent_request_delivery_attempts")
      .select(
        "id, tenant_id, profile_id, request_id, action_kind, delivery_mode, status, target_email, error_code, error_message, created_at",
      )
      .eq("tenant_id", input.tenantId)
      .eq("profile_id", input.profileId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (requestRowsResult.error) {
    throw new HttpError(
      500,
      "recurring_profile_consent_request_list_failed",
      "Unable to load recurring baseline consent requests.",
    );
  }

  if (consentRowsResult.error) {
    throw new HttpError(500, "recurring_profile_consent_list_failed", "Unable to load recurring baseline consents.");
  }
  if (latestFollowUpAttemptResult.error) {
    throw new HttpError(
      500,
      "recurring_profile_follow_up_attempt_list_failed",
      "Unable to load recurring baseline follow-up attempts.",
    );
  }

  const requestRows = ((requestRowsResult.data as RecurringProfileConsentRequestDetailRow[] | null) ?? []).slice();
  const consentRows = ((consentRowsResult.data as RecurringProfileConsentDetailRow[] | null) ?? []).slice();
  const latestFollowUpAttempt =
    (latestFollowUpAttemptResult.data as RecurringProfileConsentRequestDeliveryAttemptRow | null) ?? null;
  const baselineSummary = deriveBaselineConsentSummary(profile.id, requestRows, consentRows);
  const templateMap = await listTemplatesByIds(
    input.supabase,
    input.tenantId,
    [
      ...requestRows.map((row) => row.consent_template_id),
      ...consentRows.map((row) => row.consent_template_id),
    ],
  );
  const consentByRequestId = new Map(consentRows.map((row) => [row.request_id, row]));
  const activePendingRequest =
    requestRows.find((row) => row.status === "pending" && new Date(row.expires_at).getTime() > Date.now()) ?? null;
  const activeSignedConsent = consentRows.find((row) => row.revoked_at === null) ?? null;
  const latestRevokedConsent = consentRows.find((row) => row.revoked_at !== null) ?? null;
  const pendingToken = activePendingRequest
    ? deriveRecurringProfileConsentToken({ requestId: activePendingRequest.id })
    : null;
  const canManageBaseline = access.canManageProfiles && profile.status === "active";
  const availableBaselineFollowUpAction =
    !canManageBaseline || activeSignedConsent
      ? null
      : activePendingRequest
        ? "reminder"
        : baselineSummary.state === "missing" || baselineSummary.state === "revoked"
          ? "new_request"
          : null;
  const headshotMatching = await getRecurringProfileHeadshotDetail({
    supabase: input.supabase,
    tenantId: input.tenantId,
    profileId: input.profileId,
  });
  const headshotPreviewUrl = await getRecurringProfileHeadshotSignedPreviewUrl({
    supabase: input.supabase,
    headshot: headshotMatching.currentHeadshot,
  });
  const canManageHeadshot = access.canManageProfiles && profile.status === "active";

  return {
    access,
    profile: {
      id: profile.id,
      fullName: profile.full_name,
      email: profile.email,
      status: profile.status,
      updatedAt: profile.updated_at,
      archivedAt: profile.archived_at,
      profileType: profileType
        ? {
            id: profileType.id,
            label: profileType.label,
            status: profileType.status,
            archivedAt: profileType.archived_at,
          }
        : null,
    },
    baselineConsent: {
      ...baselineSummary,
      pendingRequest:
        activePendingRequest && pendingToken
          ? {
              id: activePendingRequest.id,
              expiresAt: activePendingRequest.expires_at,
              consentPath: buildRecurringProfileConsentPath(pendingToken),
              emailSnapshot: activePendingRequest.profile_email_snapshot,
              updatedAt: activePendingRequest.updated_at,
              fullNameSnapshot: activePendingRequest.profile_name_snapshot,
              templateName: templateMap.get(activePendingRequest.consent_template_id)?.name ?? null,
              templateVersion: templateMap.get(activePendingRequest.consent_template_id)?.version ?? null,
              createdAt: activePendingRequest.created_at,
            }
          : null,
      activeConsent: activeSignedConsent
        ? {
            id: activeSignedConsent.id,
            requestId: activeSignedConsent.request_id,
            signedAt: activeSignedConsent.signed_at,
            emailSnapshot: activeSignedConsent.profile_email_snapshot,
            fullNameSnapshot: activeSignedConsent.profile_name_snapshot,
            templateName: templateMap.get(activeSignedConsent.consent_template_id)?.name ?? null,
            templateVersion:
              templateMap.get(activeSignedConsent.consent_template_id)?.version ?? activeSignedConsent.consent_version,
            structuredSummary: buildRecurringProfileStructuredSummary(
              activeSignedConsent.structured_fields_snapshot,
            ),
            receiptEmailSentAt: activeSignedConsent.receipt_email_sent_at,
          }
        : null,
      latestRevokedConsent:
        latestRevokedConsent && latestRevokedConsent.revoked_at
          ? {
              id: latestRevokedConsent.id,
              requestId: latestRevokedConsent.request_id,
              signedAt: latestRevokedConsent.signed_at,
              revokedAt: latestRevokedConsent.revoked_at,
              revokeReason: latestRevokedConsent.revoke_reason,
              emailSnapshot: latestRevokedConsent.profile_email_snapshot,
              fullNameSnapshot: latestRevokedConsent.profile_name_snapshot,
              templateName: templateMap.get(latestRevokedConsent.consent_template_id)?.name ?? null,
              templateVersion:
                templateMap.get(latestRevokedConsent.consent_template_id)?.version
                ?? latestRevokedConsent.consent_version,
              structuredSummary: buildRecurringProfileStructuredSummary(
                latestRevokedConsent.structured_fields_snapshot,
              ),
              receiptEmailSentAt: latestRevokedConsent.receipt_email_sent_at,
            }
          : null,
      latestFollowUpAttempt: latestFollowUpAttempt
        ? {
            id: latestFollowUpAttempt.id,
            requestId: latestFollowUpAttempt.request_id,
            actionKind: latestFollowUpAttempt.action_kind,
            deliveryMode: latestFollowUpAttempt.delivery_mode,
            status: latestFollowUpAttempt.status,
            targetEmail: latestFollowUpAttempt.target_email,
            attemptedAt: latestFollowUpAttempt.created_at,
            errorCode: latestFollowUpAttempt.error_code,
          }
        : null,
    },
    requestHistory: requestRows.map((row) => {
      const matchingConsent = consentByRequestId.get(row.id) ?? null;
      const changedAt =
        row.status === "signed" && matchingConsent
          ? matchingConsent.signed_at
          : row.status === "expired" || (row.status === "pending" && new Date(row.expires_at).getTime() <= Date.now())
            ? row.expires_at
            : row.updated_at;

      return {
        id: row.id,
        status:
          row.status === "pending" && new Date(row.expires_at).getTime() <= Date.now() ? "expired" : row.status,
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        changedAt,
        emailSnapshot: row.profile_email_snapshot,
        fullNameSnapshot: row.profile_name_snapshot,
        templateName: templateMap.get(row.consent_template_id)?.name ?? null,
        templateVersion: templateMap.get(row.consent_template_id)?.version ?? null,
        supersededByRequestId: row.superseded_by_request_id,
      };
    }),
    consentHistory: consentRows.map((row) => ({
      id: row.id,
      requestId: row.request_id,
      signedAt: row.signed_at,
      revokedAt: row.revoked_at,
      revokeReason: row.revoke_reason,
      emailSnapshot: row.profile_email_snapshot,
      fullNameSnapshot: row.profile_name_snapshot,
      templateName: templateMap.get(row.consent_template_id)?.name ?? null,
      templateVersion: templateMap.get(row.consent_template_id)?.version ?? row.consent_version,
      structuredSummary: buildRecurringProfileStructuredSummary(row.structured_fields_snapshot),
      receiptEmailSentAt: row.receipt_email_sent_at,
    })),
    actions: {
      canManageBaseline,
      canRequestBaselineConsent:
        canManageBaseline && (baselineSummary.state === "missing" || baselineSummary.state === "revoked"),
      canCopyBaselineLink: Boolean(activePendingRequest),
      canOpenBaselineLink: Boolean(activePendingRequest),
      canCancelPendingRequest: canManageBaseline && Boolean(activePendingRequest),
      canReplacePendingRequest: canManageBaseline && Boolean(activePendingRequest),
      availableBaselineFollowUpAction,
    },
    headshotMatching: {
      ...headshotMatching,
      previewUrl: headshotPreviewUrl,
      actions: {
        canManage: canManageHeadshot,
        canUpload: canManageHeadshot && headshotMatching.readiness.authorized,
        canReplace:
          canManageHeadshot
          && headshotMatching.readiness.authorized
          && Boolean(headshotMatching.currentHeadshot),
        canSelectFace:
          canManageHeadshot
          && headshotMatching.readiness.authorized
          && headshotMatching.readiness.state === "needs_face_selection"
          && headshotMatching.candidateFaces.length > 0,
      },
    },
  };
}

export async function createRecurringProfile(
  input: CreateRecurringProfileInput,
): Promise<CreateRecurringProfileResult> {
  await assertProfilesManager(input.supabase, input.tenantId, input.userId);

  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
  const operation = "create_recurring_profile";
  const existingPayload = await readIdempotencyPayload<CreateRecurringProfilePayload>(
    input.supabase,
    input.tenantId,
    operation,
    idempotencyKey,
  );

  if (existingPayload) {
    return { status: 200, payload: existingPayload };
  }

  const fullName = validateProfileName(input.fullName);
  const { email, normalizedEmail } = validateProfileEmail(input.email);

  let profileType: RecurringProfileTypeRow | null = null;
  if (input.profileTypeId) {
    if (!isUuid(input.profileTypeId)) {
      throw new HttpError(400, "invalid_input", "Profile type selection is invalid.");
    }

    profileType = await getRecurringProfileTypeRowById(input.supabase, input.tenantId, input.profileTypeId);
    if (!profileType || profileType.status !== "active") {
      throw new HttpError(404, "recurring_profile_type_not_found", "Recurring profile type not found.");
    }
  }

  const { data: duplicateProfile, error: duplicateProfileError } = await input.supabase
    .from("recurring_profiles")
    .select("id")
    .eq("tenant_id", input.tenantId)
    .eq("normalized_email", normalizedEmail)
    .eq("status", "active")
    .maybeSingle();

  if (duplicateProfileError) {
    throw new HttpError(500, "recurring_profile_lookup_failed", "Unable to validate recurring profile email.");
  }

  if (duplicateProfile) {
    throw new HttpError(409, "recurring_profile_email_conflict", "An active profile already exists for this email.");
  }

  const { data, error } = await input.supabase
    .from("recurring_profiles")
    .insert({
      tenant_id: input.tenantId,
      profile_type_id: profileType?.id ?? null,
      full_name: fullName,
      email,
      status: "active",
      created_by: input.userId,
    })
    .select(RECURRING_PROFILE_SELECT)
    .single();

  if (error || !data) {
    mapRecurringProfileMutationError(error);
  }

  const payload = {
    profile: mapRecurringProfile(data as RecurringProfileRow, profileType, createMissingBaselineConsentSummary()),
  };

  await writeIdempotencyPayload(input.supabase, input.tenantId, input.userId, operation, idempotencyKey, payload);

  return {
    status: 201,
    payload,
  };
}

export async function archiveRecurringProfile(input: ArchiveRecurringProfileInput): Promise<RecurringProfileListItem> {
  await assertProfilesManager(input.supabase, input.tenantId, input.userId);

  if (!isUuid(input.profileId)) {
    throw new HttpError(404, "recurring_profile_not_found", "Recurring profile not found.");
  }

  const existingProfile = await getRecurringProfileRowById(input.supabase, input.tenantId, input.profileId);
  if (!existingProfile) {
    throw new HttpError(404, "recurring_profile_not_found", "Recurring profile not found.");
  }

  const existingProfileType = existingProfile.profile_type_id
    ? await getRecurringProfileTypeRowById(input.supabase, input.tenantId, existingProfile.profile_type_id)
    : null;

  if (existingProfile.status === "archived") {
    return mapRecurringProfile(existingProfile, existingProfileType, createMissingBaselineConsentSummary());
  }

  const { data, error } = await input.supabase
    .from("recurring_profiles")
    .update({
      status: "archived",
    })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.profileId)
    .eq("status", "active")
    .select(RECURRING_PROFILE_SELECT)
    .maybeSingle();

  if (error) {
    mapRecurringProfileMutationError(error);
  }

  if (data) {
    return mapRecurringProfile(data as RecurringProfileRow, existingProfileType, createMissingBaselineConsentSummary());
  }

  const archivedProfile = await getRecurringProfileRowById(input.supabase, input.tenantId, input.profileId);
  if (!archivedProfile) {
    throw new HttpError(404, "recurring_profile_not_found", "Recurring profile not found.");
  }

  return mapRecurringProfile(archivedProfile, existingProfileType, createMissingBaselineConsentSummary());
}

export async function createRecurringProfileType(
  input: CreateRecurringProfileTypeInput,
): Promise<CreateRecurringProfileTypeResult> {
  await assertProfilesManager(input.supabase, input.tenantId, input.userId);

  const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
  const operation = "create_recurring_profile_type";
  const existingPayload = await readIdempotencyPayload<CreateRecurringProfileTypePayload>(
    input.supabase,
    input.tenantId,
    operation,
    idempotencyKey,
  );

  if (existingPayload) {
    return { status: 200, payload: existingPayload };
  }

  const label = validateProfileTypeLabel(input.label);
  const normalizedLabel = normalizeProfileTypeLabel(label).toLowerCase();

  const { data: duplicateType, error: duplicateTypeError } = await input.supabase
    .from("recurring_profile_types")
    .select("id")
    .eq("tenant_id", input.tenantId)
    .eq("normalized_label", normalizedLabel)
    .eq("status", "active")
    .maybeSingle();

  if (duplicateTypeError) {
    throw new HttpError(500, "recurring_profile_type_lookup_failed", "Unable to validate recurring profile type.");
  }

  if (duplicateType) {
    throw new HttpError(
      409,
      "recurring_profile_type_conflict",
      "An active recurring profile type already exists with this label.",
    );
  }

  const { data, error } = await input.supabase
    .from("recurring_profile_types")
    .insert({
      tenant_id: input.tenantId,
      label,
      status: "active",
      created_by: input.userId,
    })
    .select(RECURRING_PROFILE_TYPE_SELECT)
    .single();

  if (error || !data) {
    mapRecurringProfileTypeMutationError(error);
  }

  const payload = {
    profileType: mapRecurringProfileType(data as RecurringProfileTypeRow, 0),
  };

  await writeIdempotencyPayload(input.supabase, input.tenantId, input.userId, operation, idempotencyKey, payload);

  return {
    status: 201,
    payload,
  };
}

export async function archiveRecurringProfileType(
  input: ArchiveRecurringProfileTypeInput,
): Promise<RecurringProfileTypeSummary> {
  await assertProfilesManager(input.supabase, input.tenantId, input.userId);

  if (!isUuid(input.profileTypeId)) {
    throw new HttpError(404, "recurring_profile_type_not_found", "Recurring profile type not found.");
  }

  const existingType = await getRecurringProfileTypeRowById(input.supabase, input.tenantId, input.profileTypeId);
  if (!existingType) {
    throw new HttpError(404, "recurring_profile_type_not_found", "Recurring profile type not found.");
  }

  const { count: activeProfileCount, error: countError } = await input.supabase
    .from("recurring_profiles")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", input.tenantId)
    .eq("profile_type_id", input.profileTypeId)
    .eq("status", "active");

  if (countError) {
    throw new HttpError(500, "recurring_profile_list_failed", "Unable to load recurring profiles.");
  }

  if (existingType.status === "archived") {
    return mapRecurringProfileType(existingType, activeProfileCount ?? 0);
  }

  const { data, error } = await input.supabase
    .from("recurring_profile_types")
    .update({
      status: "archived",
    })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.profileTypeId)
    .eq("status", "active")
    .select(RECURRING_PROFILE_TYPE_SELECT)
    .maybeSingle();

  if (error) {
    mapRecurringProfileTypeMutationError(error);
  }

  if (data) {
    return mapRecurringProfileType(data as RecurringProfileTypeRow, activeProfileCount ?? 0);
  }

  const archivedType = await getRecurringProfileTypeRowById(input.supabase, input.tenantId, input.profileTypeId);
  if (!archivedType) {
    throw new HttpError(404, "recurring_profile_type_not_found", "Recurring profile type not found.");
  }

  return mapRecurringProfileType(archivedType, activeProfileCount ?? 0);
}
