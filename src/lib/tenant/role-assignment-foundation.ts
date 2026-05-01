import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import {
  MEMBERSHIP_ROLES,
  ROLE_CAPABILITIES,
  TENANT_CAPABILITIES,
  type MembershipRole,
  type TenantCapability,
} from "@/lib/tenant/role-capabilities";

export type RoleDefinitionRecord = {
  id: string;
  tenantId: string | null;
  slug: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  systemRoleKey: MembershipRole | null;
  createdAt: string;
  createdBy: string | null;
  updatedAt: string;
  updatedBy: string | null;
  archivedAt: string | null;
  archivedBy: string | null;
};

export type RoleDefinitionWithCapabilities = RoleDefinitionRecord & {
  capabilities: string[];
};

export type RoleAssignmentScopeType = "tenant" | "project" | "workspace";

export type RoleAssignmentRecord = {
  id: string;
  tenantId: string;
  userId: string;
  roleDefinitionId: string;
  scopeType: RoleAssignmentScopeType;
  projectId: string | null;
  workspaceId: string | null;
  createdAt: string;
  createdBy: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
};

export type ResolvedDurableRoleAssignment = RoleAssignmentRecord & {
  roleDefinition: RoleDefinitionRecord;
  capabilities: string[];
};

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

type RoleAssignmentRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  role_definition_id: string;
  scope_type: RoleAssignmentScopeType;
  project_id: string | null;
  workspace_id: string | null;
  created_at: string;
  created_by: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
};

function mapRoleDefinition(row: RoleDefinitionRow): RoleDefinitionRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    isSystem: row.is_system,
    systemRoleKey: (row.system_role_key as MembershipRole | null) ?? null,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    archivedAt: row.archived_at,
    archivedBy: row.archived_by,
  };
}

function mapRoleAssignment(row: RoleAssignmentRow): RoleAssignmentRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    roleDefinitionId: row.role_definition_id,
    scopeType: row.scope_type,
    projectId: row.project_id,
    workspaceId: row.workspace_id,
    createdAt: row.created_at,
    createdBy: row.created_by,
    revokedAt: row.revoked_at,
    revokedBy: row.revoked_by,
  };
}

function sorted(values: readonly string[]) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function assertSameStringSet(actual: readonly string[], expected: readonly string[], code: string) {
  const actualSorted = sorted(actual);
  const expectedSorted = sorted(expected);

  if (actualSorted.length !== expectedSorted.length) {
    throw new HttpError(500, code, "Role capability catalog does not match database seeds.");
  }

  actualSorted.forEach((value, index) => {
    if (value !== expectedSorted[index]) {
      throw new HttpError(500, code, "Role capability catalog does not match database seeds.");
    }
  });
}

export async function listCapabilities(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase.from("capabilities").select("key").order("key");

  if (error) {
    throw new HttpError(500, "role_capability_lookup_failed", "Unable to load role capabilities.");
  }

  return ((data ?? []) as { key: string }[]).map((row) => row.key);
}

export async function listSystemRoleDefinitions(
  supabase: SupabaseClient,
): Promise<RoleDefinitionRecord[]> {
  const { data, error } = await supabase
    .from("role_definitions")
    .select(
      "id, tenant_id, slug, name, description, is_system, system_role_key, created_at, created_by, updated_at, updated_by, archived_at, archived_by",
    )
    .eq("is_system", true)
    .order("system_role_key", { ascending: true });

  if (error) {
    throw new HttpError(500, "role_definition_lookup_failed", "Unable to load role definitions.");
  }

  return ((data ?? []) as RoleDefinitionRow[]).map(mapRoleDefinition);
}

export async function listRoleDefinitionsForTenant(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<RoleDefinitionRecord[]> {
  const systemRoles = await listSystemRoleDefinitions(supabase);
  const { data, error } = await supabase
    .from("role_definitions")
    .select(
      "id, tenant_id, slug, name, description, is_system, system_role_key, created_at, created_by, updated_at, updated_by, archived_at, archived_by",
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new HttpError(500, "role_definition_lookup_failed", "Unable to load role definitions.");
  }

  return [...systemRoles, ...((data ?? []) as RoleDefinitionRow[]).map(mapRoleDefinition)];
}

async function loadCapabilitiesForRoleDefinition(
  supabase: SupabaseClient,
  roleDefinitionId: string,
) {
  const { data, error } = await supabase
    .from("role_definition_capabilities")
    .select("capability_key")
    .eq("role_definition_id", roleDefinitionId)
    .order("capability_key");

  if (error) {
    throw new HttpError(500, "role_capability_lookup_failed", "Unable to load role capabilities.");
  }

  return ((data ?? []) as { capability_key: string }[]).map((row) => row.capability_key);
}

export async function loadRoleDefinitionWithCapabilities(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    roleDefinitionId: string;
  },
): Promise<RoleDefinitionWithCapabilities | null> {
  const { data, error } = await supabase
    .from("role_definitions")
    .select(
      "id, tenant_id, slug, name, description, is_system, system_role_key, created_at, created_by, updated_at, updated_by, archived_at, archived_by",
    )
    .eq("id", input.roleDefinitionId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "role_definition_lookup_failed", "Unable to load role definitions.");
  }

  if (!data) {
    return null;
  }

  const roleDefinition = mapRoleDefinition(data as RoleDefinitionRow);
  if (!roleDefinition.isSystem && roleDefinition.tenantId !== input.tenantId) {
    return null;
  }

  return {
    ...roleDefinition,
    capabilities: await loadCapabilitiesForRoleDefinition(supabase, roleDefinition.id),
  };
}

async function listRoleAssignments(
  supabase: SupabaseClient,
  tenantId: string,
) {
  const { data, error } = await supabase
    .from("role_assignments")
    .select(
      "id, tenant_id, user_id, role_definition_id, scope_type, project_id, workspace_id, created_at, created_by, revoked_at, revoked_by",
    )
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new HttpError(500, "role_assignment_lookup_failed", "Unable to load role assignments.");
  }

  return ((data ?? []) as RoleAssignmentRow[]).map(mapRoleAssignment);
}

export async function listRoleAssignmentsForUser(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
): Promise<RoleAssignmentRecord[]> {
  const assignments = await listRoleAssignments(supabase, tenantId);
  return assignments.filter((assignment) => assignment.userId === userId);
}

export async function listRoleAssignmentsForProject(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
): Promise<RoleAssignmentRecord[]> {
  const assignments = await listRoleAssignments(supabase, tenantId);
  return assignments.filter((assignment) => assignment.projectId === projectId);
}

export async function listRoleAssignmentsForWorkspace(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  workspaceId: string,
): Promise<RoleAssignmentRecord[]> {
  const assignments = await listRoleAssignments(supabase, tenantId);
  return assignments.filter(
    (assignment) => assignment.projectId === projectId && assignment.workspaceId === workspaceId,
  );
}

export async function resolveDurableRoleAssignments(
  supabase: SupabaseClient,
  input: {
    tenantId: string;
    userId: string;
    projectId?: string | null;
    workspaceId?: string | null;
  },
): Promise<ResolvedDurableRoleAssignment[]> {
  // Non-enforcing: Feature 081 reads durable assignments for future migration and tests only.
  const assignments = (await listRoleAssignmentsForUser(supabase, input.tenantId, input.userId)).filter(
    (assignment) => {
      if (assignment.revokedAt) {
        return false;
      }

      if (assignment.scopeType === "tenant") {
        return true;
      }

      if (assignment.scopeType === "project") {
        return !!input.projectId && assignment.projectId === input.projectId;
      }

      return (
        !!input.projectId
        && !!input.workspaceId
        && assignment.projectId === input.projectId
        && assignment.workspaceId === input.workspaceId
      );
    },
  );

  if (assignments.length === 0) {
    return [];
  }

  const roleDefinitionIds = [...new Set(assignments.map((assignment) => assignment.roleDefinitionId))];
  const roleDefinitions = new Map<string, RoleDefinitionRecord>();
  const roleCapabilities = new Map<string, string[]>();

  for (const roleDefinitionId of roleDefinitionIds) {
    const roleDefinition = await loadRoleDefinitionWithCapabilities(supabase, {
      tenantId: input.tenantId,
      roleDefinitionId,
    });

    if (roleDefinition) {
      roleDefinitions.set(roleDefinition.id, roleDefinition);
      roleCapabilities.set(roleDefinition.id, roleDefinition.capabilities);
    }
  }

  return assignments.flatMap((assignment) => {
    const roleDefinition = roleDefinitions.get(assignment.roleDefinitionId);
    if (!roleDefinition) {
      return [];
    }

    return [
      {
        ...assignment,
        roleDefinition,
        capabilities: roleCapabilities.get(assignment.roleDefinitionId) ?? [],
      },
    ];
  });
}

export async function assertRoleCapabilityCatalogMatchesDatabase(supabase: SupabaseClient) {
  // The database seed is intentionally locked to the Feature 080 TypeScript capability catalog.
  const databaseCapabilities = await listCapabilities(supabase);
  assertSameStringSet(
    databaseCapabilities,
    TENANT_CAPABILITIES,
    "role_capability_catalog_database_drift",
  );

  const systemRoles = await listSystemRoleDefinitions(supabase);
  assertSameStringSet(
    systemRoles.map((role) => role.systemRoleKey).filter((role): role is MembershipRole => !!role),
    MEMBERSHIP_ROLES,
    "role_definition_database_drift",
  );

  for (const role of MEMBERSHIP_ROLES) {
    const roleDefinition = systemRoles.find((candidate) => candidate.systemRoleKey === role);
    if (!roleDefinition) {
      throw new HttpError(
        500,
        "role_definition_database_drift",
        "Role capability catalog does not match database seeds.",
      );
    }

    const databaseRoleCapabilities = await loadCapabilitiesForRoleDefinition(
      supabase,
      roleDefinition.id,
    );
    assertSameStringSet(
      databaseRoleCapabilities,
      ROLE_CAPABILITIES[role] satisfies readonly TenantCapability[],
      "role_capability_mapping_database_drift",
    );
  }
}
