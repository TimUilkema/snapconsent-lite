import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import type { TenantCapability } from "@/lib/tenant/role-capabilities";
import { resolveTenantMembership } from "@/lib/tenant/tenant-membership";

export const ENFORCED_TENANT_CUSTOM_ROLE_CAPABILITIES = [
  "media_library.access",
  "media_library.manage_folders",
  "templates.manage",
  "profiles.view",
  "profiles.manage",
  "projects.create",
  "project_workspaces.manage",
  "organization_users.manage",
  "organization_users.invite",
  "organization_users.change_roles",
  "organization_users.remove",
] as const satisfies readonly TenantCapability[];

export type EnforcedTenantCustomRoleCapability =
  (typeof ENFORCED_TENANT_CUSTOM_ROLE_CAPABILITIES)[number];

const ENFORCED_TENANT_CUSTOM_ROLE_CAPABILITY_SET = new Set<string>(
  ENFORCED_TENANT_CUSTOM_ROLE_CAPABILITIES,
);

function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error("Missing Supabase service role configuration.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function assertEnforcedTenantCustomRoleCapability(
  capabilityKey: string,
): asserts capabilityKey is EnforcedTenantCustomRoleCapability {
  if (!ENFORCED_TENANT_CUSTOM_ROLE_CAPABILITY_SET.has(capabilityKey)) {
    throw new HttpError(
      500,
      "tenant_custom_role_capability_not_enforced",
      "This custom role capability is not enforced by the tenant capability helper.",
    );
  }
}

async function loadActiveTenantCustomRoleDefinitionIds(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
}) {
  const { data: assignments, error: assignmentError } = await input.supabase
    .from("role_assignments")
    .select("role_definition_id")
    .eq("tenant_id", input.tenantId)
    .eq("user_id", input.userId)
    .eq("scope_type", "tenant")
    .is("project_id", null)
    .is("workspace_id", null)
    .is("revoked_at", null);

  if (assignmentError) {
    throw new HttpError(
      500,
      "tenant_custom_role_capability_lookup_failed",
      "Unable to load tenant custom role assignments.",
    );
  }

  const roleDefinitionIds = Array.from(
    new Set(((assignments ?? []) as Array<{ role_definition_id: string }>).map((row) => row.role_definition_id)),
  );

  if (roleDefinitionIds.length === 0) {
    return [];
  }

  const { data: roles, error: roleError } = await input.supabase
    .from("role_definitions")
    .select("id")
    .eq("tenant_id", input.tenantId)
    .eq("is_system", false)
    .is("archived_at", null)
    .in("id", roleDefinitionIds);

  if (roleError) {
    throw new HttpError(
      500,
      "tenant_custom_role_capability_lookup_failed",
      "Unable to load tenant custom roles.",
    );
  }

  return ((roles ?? []) as Array<{ id: string }>).map((row) => row.id);
}

export async function userHasAnyTenantCustomRoleCapabilities(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  capabilityKeys: readonly EnforcedTenantCustomRoleCapability[];
  adminSupabase?: SupabaseClient;
}) {
  const requestedKeys = Array.from(new Set(input.capabilityKeys));
  for (const capabilityKey of requestedKeys) {
    assertEnforcedTenantCustomRoleCapability(capabilityKey);
  }

  const result = new Set<EnforcedTenantCustomRoleCapability>();
  if (requestedKeys.length === 0) {
    return result;
  }

  await resolveTenantMembership(input.supabase, input.tenantId, input.userId);

  const admin = input.adminSupabase ?? createServiceRoleClient();
  const roleDefinitionIds = await loadActiveTenantCustomRoleDefinitionIds({
    supabase: admin,
    tenantId: input.tenantId,
    userId: input.userId,
  });

  if (roleDefinitionIds.length === 0) {
    return result;
  }

  const { data, error } = await admin
    .from("role_definition_capabilities")
    .select("capability_key")
    .in("role_definition_id", roleDefinitionIds)
    .in("capability_key", requestedKeys);

  if (error) {
    throw new HttpError(
      500,
      "tenant_custom_role_capability_lookup_failed",
      "Unable to load tenant custom role capabilities.",
    );
  }

  for (const row of (data ?? []) as Array<{ capability_key: EnforcedTenantCustomRoleCapability }>) {
    result.add(row.capability_key);
  }

  return result;
}

export async function userHasTenantCustomRoleCapability(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  capabilityKey: EnforcedTenantCustomRoleCapability;
  adminSupabase?: SupabaseClient;
}) {
  return (
    await userHasAnyTenantCustomRoleCapabilities({
      supabase: input.supabase,
      tenantId: input.tenantId,
      userId: input.userId,
      capabilityKeys: [input.capabilityKey],
      adminSupabase: input.adminSupabase,
    })
  ).has(input.capabilityKey);
}
