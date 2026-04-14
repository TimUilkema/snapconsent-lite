import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";

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
  profileTypes: RecurringProfileTypeSummary[];
  profiles: RecurringProfileListItem[];
};

type ListRecurringProfilesPageDataInput = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  q?: string | null;
  profileTypeId?: string | null;
  includeArchived?: boolean;
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

  const [{ data: profileTypeData, error: profileTypeError }, { data: profileData, error: profileError }] =
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
    ]);

  if (profileTypeError) {
    throw new HttpError(500, "recurring_profile_type_list_failed", "Unable to load recurring profile types.");
  }

  if (profileError) {
    throw new HttpError(500, "recurring_profile_list_failed", "Unable to load recurring profiles.");
  }

  const profileTypes = ((profileTypeData as RecurringProfileTypeRow[] | null) ?? []).slice();
  const profiles = ((profileData as RecurringProfileRow[] | null) ?? []).slice();

  const profileTypeMap = new Map(profileTypes.map((profileType) => [profileType.id, profileType]));
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
    })
    .map((profile) => mapRecurringProfile(profile, profileTypeMap.get(profile.profile_type_id ?? "") ?? null));

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
    profileTypes: profileTypes.map((profileType) =>
      mapRecurringProfileType(profileType, activeProfileCountByTypeId.get(profileType.id) ?? 0),
    ),
    profiles: visibleProfiles,
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
    profile: mapRecurringProfile(data as RecurringProfileRow, profileType),
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
    return mapRecurringProfile(existingProfile, existingProfileType);
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
    return mapRecurringProfile(data as RecurringProfileRow, existingProfileType);
  }

  const archivedProfile = await getRecurringProfileRowById(input.supabase, input.tenantId, input.profileId);
  if (!archivedProfile) {
    throw new HttpError(404, "recurring_profile_not_found", "Recurring profile not found.");
  }

  return mapRecurringProfile(archivedProfile, existingProfileType);
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
