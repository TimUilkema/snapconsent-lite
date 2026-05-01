import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import { listCapabilities } from "@/lib/tenant/role-assignment-foundation";
import {
  CAPABILITY_GROUPS,
  CAPABILITY_LABEL_KEYS,
  TENANT_CAPABILITIES,
  type MembershipRole,
  type TenantCapability,
} from "@/lib/tenant/role-capabilities";
import { resolveTenantPermissions } from "@/lib/tenant/permissions";

const ROLE_DEFINITION_SELECT =
  "id, tenant_id, slug, name, description, is_system, system_role_key, created_at, created_by, updated_at, updated_by, archived_at, archived_by";
const MAX_ROLE_NAME_LENGTH = 120;
const MAX_ROLE_DESCRIPTION_LENGTH = 500;

type RoleDefinitionRow = {
  id: string;
  tenant_id: string | null;
  slug: string;
  name: string;
  description: string | null;
  is_system: boolean;
  system_role_key: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
  archived_at: string | null;
  archived_by: string | null;
};

type RoleCapabilityRow = {
  role_definition_id: string;
  capability_key: string;
};

type SupabaseErrorLike = {
  code?: string;
  message?: string;
};

export type RoleEditorCapability = {
  key: TenantCapability;
  groupKey: string;
  labelKey: string;
};

export type RoleEditorRole = {
  id: string;
  kind: "system" | "custom";
  slug: string;
  name: string;
  description: string | null;
  archivedAt: string | null;
  capabilityKeys: TenantCapability[];
  canEdit: boolean;
  canArchive: boolean;
  systemRoleKey: MembershipRole | null;
};

export type RoleEditorData = {
  capabilities: RoleEditorCapability[];
  systemRoles: RoleEditorRole[];
  customRoles: RoleEditorRole[];
};

export type CustomRoleInput = {
  name: unknown;
  description?: unknown;
  capabilityKeys: unknown;
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

async function assertTenantMemberManager(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
}) {
  // Custom role definition administration remains fixed owner/admin-only; tenant custom-role capabilities are operational, not role-admin grants.
  const permissions = await resolveTenantPermissions(input.supabase, input.tenantId, input.userId);
  if (!permissions.canManageMembers) {
    throw new HttpError(
      403,
      "tenant_member_management_forbidden",
      "Only workspace owners and admins can manage custom roles.",
    );
  }

  return permissions;
}

function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeCustomRoleName(value: unknown) {
  const name = normalizeWhitespace(typeof value === "string" ? value : "");
  if (!name || name.length > MAX_ROLE_NAME_LENGTH) {
    throw new HttpError(400, "invalid_role_name", "Enter a custom role name up to 120 characters.");
  }

  return name;
}

export function normalizeCustomRoleDescription(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }

  const description = normalizeWhitespace(typeof value === "string" ? value : String(value));
  if (!description) {
    return null;
  }

  if (description.length > MAX_ROLE_DESCRIPTION_LENGTH) {
    throw new HttpError(
      400,
      "invalid_role_description",
      "Enter a custom role description up to 500 characters.",
    );
  }

  return description;
}

function normalizeNameForCompare(value: string) {
  return normalizeWhitespace(value).toLowerCase();
}

function slugBaseFromName(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "role";
}

export function generateCustomRoleSlug(input: {
  name: string;
  activeSlugs: readonly string[];
}) {
  const base = slugBaseFromName(input.name);
  const taken = new Set(input.activeSlugs.map((slug) => slug.toLowerCase()));
  if (!taken.has(base)) {
    return base;
  }

  for (let index = 2; index < 10000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }

  throw new HttpError(409, "role_name_conflict", "A custom role with this name already exists.");
}

function isTenantCapability(value: string): value is TenantCapability {
  return (TENANT_CAPABILITIES as readonly string[]).includes(value);
}

function assertSameStringSet(actual: readonly string[], expected: readonly string[]) {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  if (
    actualSorted.length !== expectedSorted.length
    || actualSorted.some((value, index) => value !== expectedSorted[index])
  ) {
    throw new HttpError(
      500,
      "role_capability_catalog_database_drift",
      "Role capability catalog does not match database seeds.",
    );
  }
}

export async function validateCustomRoleCapabilityKeys(input: {
  supabase: SupabaseClient;
  capabilityKeys: unknown;
}) {
  if (!Array.isArray(input.capabilityKeys)) {
    throw new HttpError(400, "invalid_body", "Capability keys must be an array.");
  }

  if (input.capabilityKeys.length === 0) {
    throw new HttpError(400, "empty_capability_set", "Select at least one capability.");
  }

  const capabilityKeys = input.capabilityKeys.map((value) => String(value));
  const unique = new Set(capabilityKeys);
  if (unique.size !== capabilityKeys.length) {
    throw new HttpError(400, "duplicate_capability_key", "Capability keys must be unique.");
  }

  const databaseCapabilities = await listCapabilities(input.supabase);
  assertSameStringSet(databaseCapabilities, TENANT_CAPABILITIES);

  const allowedCapabilities = new Set(databaseCapabilities);
  const invalidKey = capabilityKeys.find(
    (capabilityKey) => !allowedCapabilities.has(capabilityKey) || !isTenantCapability(capabilityKey),
  );
  if (invalidKey) {
    throw new HttpError(400, "invalid_capability_key", "One or more selected capabilities are not valid.");
  }

  return capabilityKeys as TenantCapability[];
}

function mapRole(row: RoleDefinitionRow, capabilityKeys: TenantCapability[]): RoleEditorRole {
  return {
    id: row.id,
    kind: row.is_system ? "system" : "custom",
    slug: row.slug,
    name: row.name,
    description: row.description,
    archivedAt: row.archived_at,
    capabilityKeys,
    canEdit: !row.is_system && !row.archived_at,
    canArchive: !row.is_system && !row.archived_at,
    systemRoleKey: (row.system_role_key as MembershipRole | null) ?? null,
  };
}

function buildCapabilityMetadata(): RoleEditorCapability[] {
  return CAPABILITY_GROUPS.flatMap((group) =>
    group.capabilities.map((capability) => ({
      key: capability,
      groupKey: group.key,
      labelKey: CAPABILITY_LABEL_KEYS[capability],
    })),
  );
}

async function loadCapabilityMap(supabase: SupabaseClient, roleIds: string[]) {
  if (roleIds.length === 0) {
    return new Map<string, TenantCapability[]>();
  }

  const { data, error } = await supabase
    .from("role_definition_capabilities")
    .select("role_definition_id, capability_key")
    .in("role_definition_id", roleIds)
    .order("capability_key", { ascending: true });

  if (error) {
    throw new HttpError(500, "role_capability_lookup_failed", "Unable to load role capabilities.");
  }

  const capabilityMap = new Map<string, TenantCapability[]>();
  for (const row of (data ?? []) as RoleCapabilityRow[]) {
    if (!isTenantCapability(row.capability_key)) {
      throw new HttpError(
        500,
        "role_capability_catalog_database_drift",
        "Role capability catalog does not match database seeds.",
      );
    }
    capabilityMap.set(row.role_definition_id, [
      ...(capabilityMap.get(row.role_definition_id) ?? []),
      row.capability_key,
    ]);
  }

  return capabilityMap;
}

async function listActiveCustomRoleRows(supabase: SupabaseClient, tenantId: string) {
  const { data, error } = await supabase
    .from("role_definitions")
    .select(ROLE_DEFINITION_SELECT)
    .eq("tenant_id", tenantId)
    .eq("is_system", false)
    .is("archived_at", null)
    .order("created_at", { ascending: false });

  if (error) {
    throw new HttpError(500, "role_definition_lookup_failed", "Unable to load role definitions.");
  }

  return (data ?? []) as RoleDefinitionRow[];
}

async function listCustomRoleRows(input: {
  supabase: SupabaseClient;
  tenantId: string;
  includeArchived?: boolean;
}) {
  let query = input.supabase
    .from("role_definitions")
    .select(ROLE_DEFINITION_SELECT)
    .eq("tenant_id", input.tenantId)
    .eq("is_system", false);

  if (!input.includeArchived) {
    query = query.is("archived_at", null);
  }

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {
    throw new HttpError(500, "role_definition_lookup_failed", "Unable to load role definitions.");
  }

  return (data ?? []) as RoleDefinitionRow[];
}

async function listSystemRoleRows(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("role_definitions")
    .select(ROLE_DEFINITION_SELECT)
    .eq("is_system", true)
    .order("system_role_key", { ascending: true });

  if (error) {
    throw new HttpError(500, "role_definition_lookup_failed", "Unable to load role definitions.");
  }

  return (data ?? []) as RoleDefinitionRow[];
}

export async function listRoleEditorData(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  includeArchived?: boolean;
}): Promise<RoleEditorData> {
  await assertTenantMemberManager(input);

  const databaseCapabilities = await listCapabilities(input.supabase);
  assertSameStringSet(databaseCapabilities, TENANT_CAPABILITIES);

  const [systemRows, customRows] = await Promise.all([
    listSystemRoleRows(input.supabase),
    listCustomRoleRows({
      supabase: input.supabase,
      tenantId: input.tenantId,
      includeArchived: input.includeArchived,
    }),
  ]);
  const allRows = [...systemRows, ...customRows];
  const capabilityMap = await loadCapabilityMap(
    input.supabase,
    allRows.map((row) => row.id),
  );

  return {
    capabilities: buildCapabilityMetadata(),
    systemRoles: systemRows.map((row) => mapRole(row, capabilityMap.get(row.id) ?? [])),
    customRoles: customRows.map((row) => mapRole(row, capabilityMap.get(row.id) ?? [])),
  };
}

function mapRpcError(error: SupabaseErrorLike | null | undefined): HttpError {
  if (!error) {
    return new HttpError(500, "role_definition_write_failed", "Unable to update custom role.");
  }

  if (error.code === "23505") {
    return new HttpError(409, "role_name_conflict", "A custom role with this name already exists.");
  }

  const message = error.message ?? "";
  if (message.includes("tenant_member_management_forbidden")) {
    return new HttpError(
      403,
      "tenant_member_management_forbidden",
      "Only workspace owners and admins can manage custom roles.",
    );
  }
  if (message.includes("invalid_role_name")) {
    return new HttpError(400, "invalid_role_name", "Enter a custom role name up to 120 characters.");
  }
  if (message.includes("invalid_role_description")) {
    return new HttpError(
      400,
      "invalid_role_description",
      "Enter a custom role description up to 500 characters.",
    );
  }
  if (message.includes("invalid_capability_key")) {
    return new HttpError(400, "invalid_capability_key", "One or more selected capabilities are not valid.");
  }
  if (message.includes("duplicate_capability_key")) {
    return new HttpError(400, "duplicate_capability_key", "Capability keys must be unique.");
  }
  if (message.includes("empty_capability_set")) {
    return new HttpError(400, "empty_capability_set", "Select at least one capability.");
  }
  if (message.includes("role_archived")) {
    return new HttpError(409, "role_archived", "Archived custom roles cannot be edited.");
  }
  if (message.includes("system_role_immutable")) {
    return new HttpError(403, "system_role_immutable", "System roles cannot be changed.");
  }
  if (message.includes("role_not_found")) {
    return new HttpError(404, "role_not_found", "Custom role not found.");
  }

  return new HttpError(500, "role_definition_write_failed", "Unable to update custom role.");
}

async function assertRoleMutable(input: {
  supabase: SupabaseClient;
  tenantId: string;
  roleId: string;
  allowArchived?: boolean;
}) {
  const { data, error } = await input.supabase
    .from("role_definitions")
    .select(ROLE_DEFINITION_SELECT)
    .eq("id", input.roleId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "role_definition_lookup_failed", "Unable to load role definitions.");
  }

  const role = (data as RoleDefinitionRow | null) ?? null;
  if (!role) {
    throw new HttpError(404, "role_not_found", "Custom role not found.");
  }

  if (role.is_system) {
    throw new HttpError(403, "system_role_immutable", "System roles cannot be changed.");
  }

  if (role.tenant_id !== input.tenantId) {
    throw new HttpError(404, "role_not_found", "Custom role not found.");
  }

  if (!input.allowArchived && role.archived_at) {
    throw new HttpError(409, "role_archived", "Archived custom roles cannot be edited.");
  }

  return role;
}

async function loadRoleForResponse(input: {
  supabase: SupabaseClient;
  tenantId: string;
  roleId: string;
  includeArchived?: boolean;
}) {
  const { data, error } = await input.supabase
    .from("role_definitions")
    .select(ROLE_DEFINITION_SELECT)
    .eq("id", input.roleId)
    .eq("tenant_id", input.tenantId)
    .eq("is_system", false)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "role_definition_lookup_failed", "Unable to load role definitions.");
  }

  const row = (data as RoleDefinitionRow | null) ?? null;
  if (!row || (!input.includeArchived && row.archived_at)) {
    throw new HttpError(404, "role_not_found", "Custom role not found.");
  }

  const capabilityMap = await loadCapabilityMap(input.supabase, [row.id]);
  return mapRole(row, capabilityMap.get(row.id) ?? []);
}

async function assertNoActiveNameConflict(input: {
  supabase: SupabaseClient;
  tenantId: string;
  name: string;
  exceptRoleId?: string;
}) {
  const activeRows = await listActiveCustomRoleRows(input.supabase, input.tenantId);
  const normalizedName = normalizeNameForCompare(input.name);
  const conflict = activeRows.find(
    (row) => row.id !== input.exceptRoleId && normalizeNameForCompare(row.name) === normalizedName,
  );

  if (conflict) {
    throw new HttpError(409, "role_name_conflict", "A custom role with this name already exists.");
  }

  return activeRows;
}

function normalizeCustomRoleInput(input: CustomRoleInput) {
  return {
    name: normalizeCustomRoleName(input.name),
    description: normalizeCustomRoleDescription(input.description),
  };
}

export async function createCustomRole(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  body: CustomRoleInput;
}) {
  await assertTenantMemberManager(input);

  const normalized = normalizeCustomRoleInput(input.body);
  const capabilityKeys = await validateCustomRoleCapabilityKeys({
    supabase: input.supabase,
    capabilityKeys: input.body.capabilityKeys,
  });
  const activeRows = await assertNoActiveNameConflict({
    supabase: input.supabase,
    tenantId: input.tenantId,
    name: normalized.name,
  });
  const slug = generateCustomRoleSlug({
    name: normalized.name,
    activeSlugs: activeRows.map((row) => row.slug),
  });

  const admin = createServiceRoleClient();
  const { data, error } = await admin.rpc("create_tenant_custom_role_with_capabilities", {
    p_tenant_id: input.tenantId,
    p_actor_user_id: input.userId,
    p_slug: slug,
    p_name: normalized.name,
    p_description: normalized.description,
    p_capability_keys: capabilityKeys,
  });

  if (error || !data) {
    throw mapRpcError(error);
  }

  return loadRoleForResponse({
    supabase: admin,
    tenantId: input.tenantId,
    roleId: data as string,
  });
}

export async function updateCustomRole(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  roleId: string;
  body: CustomRoleInput;
}) {
  await assertTenantMemberManager(input);
  const admin = createServiceRoleClient();
  await assertRoleMutable({
    supabase: admin,
    tenantId: input.tenantId,
    roleId: input.roleId,
  });

  const normalized = normalizeCustomRoleInput(input.body);
  const capabilityKeys = await validateCustomRoleCapabilityKeys({
    supabase: input.supabase,
    capabilityKeys: input.body.capabilityKeys,
  });
  await assertNoActiveNameConflict({
    supabase: admin,
    tenantId: input.tenantId,
    name: normalized.name,
    exceptRoleId: input.roleId,
  });

  const { data, error } = await admin.rpc("update_tenant_custom_role_with_capabilities", {
    p_tenant_id: input.tenantId,
    p_role_definition_id: input.roleId,
    p_actor_user_id: input.userId,
    p_name: normalized.name,
    p_description: normalized.description,
    p_capability_keys: capabilityKeys,
  });

  if (error || !data) {
    throw mapRpcError(error);
  }

  return loadRoleForResponse({
    supabase: admin,
    tenantId: input.tenantId,
    roleId: data as string,
  });
}

export async function archiveCustomRole(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  roleId: string;
}) {
  await assertTenantMemberManager(input);
  const admin = createServiceRoleClient();
  await assertRoleMutable({
    supabase: admin,
    tenantId: input.tenantId,
    roleId: input.roleId,
    allowArchived: true,
  });

  const { data, error } = await admin.rpc("archive_tenant_custom_role", {
    p_tenant_id: input.tenantId,
    p_role_definition_id: input.roleId,
    p_actor_user_id: input.userId,
  });

  if (error) {
    throw mapRpcError(error);
  }

  return {
    role: await loadRoleForResponse({
      supabase: admin,
      tenantId: input.tenantId,
      roleId: input.roleId,
      includeArchived: true,
    }),
    changed: Boolean(data),
  };
}
