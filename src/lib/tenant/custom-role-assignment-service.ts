import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import {
  getRoleScopeEffect,
  type RoleAssignmentScopeType,
} from "@/lib/tenant/custom-role-scope-effects";
import { resolveTenantPermissions } from "@/lib/tenant/permissions";
import {
  TENANT_CAPABILITIES,
  type MembershipRole,
  type TenantCapability,
} from "@/lib/tenant/role-capabilities";

const ROLE_DEFINITION_SELECT =
  "id, tenant_id, slug, name, description, is_system, system_role_key, archived_at";
const ROLE_ASSIGNMENT_SELECT =
  "id, tenant_id, user_id, role_definition_id, scope_type, project_id, workspace_id, created_at, created_by, revoked_at, revoked_by";
const PROJECT_TARGET_SELECT = "id, name, status, finalized_at, created_at";
const WORKSPACE_TARGET_SELECT =
  "id, tenant_id, project_id, workspace_kind, name, workflow_state, created_at";

type MembershipRow = {
  tenant_id: string;
  user_id: string;
  role: MembershipRole;
};

type RoleDefinitionRow = {
  id: string;
  tenant_id: string | null;
  slug: string;
  name: string;
  description: string | null;
  is_system: boolean;
  system_role_key: string | null;
  archived_at: string | null;
};

type RoleCapabilityRow = {
  role_definition_id: string;
  capability_key: string;
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

type ProjectTargetRow = {
  id: string;
  name: string;
  status: string;
  finalized_at: string | null;
  created_at: string;
};

type WorkspaceTargetRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  workspace_kind: "default" | "photographer";
  name: string;
  workflow_state: "active" | "handed_off" | "needs_changes" | "validated";
  created_at: string;
};

type NormalizedAssignmentScope = {
  scopeType: RoleAssignmentScopeType;
  projectId: string | null;
  workspaceId: string | null;
};

type AssignmentTargetLabels = {
  projectName: string | null;
  workspaceName: string | null;
};

export type CustomRoleAssignmentScopeInput = {
  scopeType?: RoleAssignmentScopeType | null;
  projectId?: string | null;
  workspaceId?: string | null;
};

export type AssignableCustomRole = {
  roleId: string;
  name: string;
  description: string | null;
  capabilityKeys: TenantCapability[];
  archivedAt: string | null;
};

export type CustomRoleAssignmentRecord = {
  assignmentId: string;
  tenantId: string;
  userId: string;
  roleId: string;
  scopeType: RoleAssignmentScopeType;
  projectId: string | null;
  projectName: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  createdAt: string;
  createdBy: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  role: AssignableCustomRole;
  effectiveCapabilityKeys: TenantCapability[];
  ignoredCapabilityKeys: TenantCapability[];
  hasScopeWarnings: boolean;
};

export type MemberCustomRoleAssignmentSummary = {
  userId: string;
  assignments: CustomRoleAssignmentRecord[];
};

export type CustomRoleAssignmentTargetWorkspace = {
  workspaceId: string;
  projectId: string;
  name: string;
  workspaceKind: "default" | "photographer";
  workflowState: "active" | "handed_off" | "needs_changes" | "validated";
};

export type CustomRoleAssignmentTargetProject = {
  projectId: string;
  name: string;
  status: string;
  finalizedAt: string | null;
  workspaces: CustomRoleAssignmentTargetWorkspace[];
};

export type CustomRoleAssignmentTargetData = {
  projects: CustomRoleAssignmentTargetProject[];
};

export type CustomRoleAssignmentListResult = {
  assignableRoles: AssignableCustomRole[];
  members: MemberCustomRoleAssignmentSummary[];
  targets: CustomRoleAssignmentTargetData;
};

export type GrantCustomRoleResult = {
  assignment: CustomRoleAssignmentRecord;
  created: boolean;
};

export type RevokeCustomRoleResult = {
  assignment: CustomRoleAssignmentRecord | null;
  revoked: boolean;
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

function isTenantCapability(value: string): value is TenantCapability {
  return (TENANT_CAPABILITIES as readonly string[]).includes(value);
}

function isUniqueViolation(error: { code?: string } | null | undefined) {
  return error?.code === "23505";
}

function normalizeId(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeAssignmentScope(input: CustomRoleAssignmentScopeInput): NormalizedAssignmentScope {
  const scopeType = input.scopeType ?? "tenant";
  const projectId = normalizeId(input.projectId);
  const workspaceId = normalizeId(input.workspaceId);

  if (scopeType !== "tenant" && scopeType !== "project" && scopeType !== "workspace") {
    throw new HttpError(400, "invalid_assignment_scope", "Select a valid custom role assignment scope.");
  }

  if (scopeType === "tenant") {
    if (projectId || workspaceId) {
      throw new HttpError(400, "invalid_assignment_scope", "Tenant-scoped assignments cannot include project or workspace targets.");
    }

    return {
      scopeType,
      projectId: null,
      workspaceId: null,
    };
  }

  if (scopeType === "project") {
    if (!projectId || workspaceId) {
      throw new HttpError(400, "invalid_assignment_scope", "Project-scoped assignments require one project target.");
    }

    return {
      scopeType,
      projectId,
      workspaceId: null,
    };
  }

  if (!projectId || !workspaceId) {
    throw new HttpError(400, "invalid_assignment_scope", "Workspace-scoped assignments require project and workspace targets.");
  }

  return {
    scopeType,
    projectId,
    workspaceId,
  };
}

async function assertTenantMemberManager(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
}) {
  // Role assignment administration stays fixed owner/admin-only; operational custom roles must not authorize it.
  const permissions = await resolveTenantPermissions(input.supabase, input.tenantId, input.userId);
  if (!permissions.canManageMembers) {
    throw new HttpError(
      403,
      "tenant_member_management_forbidden",
      "Only workspace owners and admins can manage custom role assignments.",
    );
  }

  return permissions;
}

async function loadMembership(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
}) {
  const { data, error } = await input.supabase
    .from("memberships")
    .select("tenant_id, user_id, role")
    .eq("tenant_id", input.tenantId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "tenant_member_lookup_failed", "Unable to load workspace member.");
  }

  return (data as MembershipRow | null) ?? null;
}

async function assertCurrentTenantMember(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
}) {
  const membership = await loadMembership(input);
  if (!membership) {
    throw new HttpError(404, "member_not_found", "Member not found.");
  }

  return membership;
}

async function loadRoleDefinitionById(supabase: SupabaseClient, roleId: string) {
  const { data, error } = await supabase
    .from("role_definitions")
    .select(ROLE_DEFINITION_SELECT)
    .eq("id", roleId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "role_definition_lookup_failed", "Unable to load custom role.");
  }

  return (data as RoleDefinitionRow | null) ?? null;
}

function assertCustomRoleForGrant(role: RoleDefinitionRow | null, tenantId: string) {
  if (!role) {
    throw new HttpError(404, "custom_role_not_found", "Custom role not found.");
  }

  if (role.is_system) {
    throw new HttpError(
      403,
      "system_role_assignment_forbidden",
      "System roles cannot be assigned through this workflow.",
    );
  }

  if (role.tenant_id !== tenantId) {
    throw new HttpError(404, "custom_role_not_found", "Custom role not found.");
  }

  if (role.archived_at) {
    throw new HttpError(409, "custom_role_archived", "Archived custom roles cannot be assigned.");
  }

  return role;
}

function assertCustomRoleForRevoke(role: RoleDefinitionRow | null, tenantId: string) {
  if (!role) {
    throw new HttpError(404, "custom_role_assignment_not_found", "Custom role assignment not found.");
  }

  if (role.is_system) {
    throw new HttpError(
      403,
      "system_role_assignment_forbidden",
      "System roles cannot be revoked through this workflow.",
    );
  }

  if (role.tenant_id !== tenantId) {
    throw new HttpError(404, "custom_role_assignment_not_found", "Custom role assignment not found.");
  }

  return role;
}

async function loadCapabilityMap(supabase: SupabaseClient, roleIds: string[]) {
  const uniqueRoleIds = Array.from(new Set(roleIds));
  if (uniqueRoleIds.length === 0) {
    return new Map<string, TenantCapability[]>();
  }

  const { data, error } = await supabase
    .from("role_definition_capabilities")
    .select("role_definition_id, capability_key")
    .in("role_definition_id", uniqueRoleIds)
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

function mapRole(row: RoleDefinitionRow, capabilityKeys: TenantCapability[]): AssignableCustomRole {
  return {
    roleId: row.id,
    name: row.name,
    description: row.description,
    capabilityKeys,
    archivedAt: row.archived_at,
  };
}

function mapAssignment(input: {
  row: RoleAssignmentRow;
  role: AssignableCustomRole;
  labels?: AssignmentTargetLabels | null;
}): CustomRoleAssignmentRecord {
  const scopeEffect = getRoleScopeEffect(input.role.capabilityKeys, input.row.scope_type);

  return {
    assignmentId: input.row.id,
    tenantId: input.row.tenant_id,
    userId: input.row.user_id,
    roleId: input.row.role_definition_id,
    scopeType: input.row.scope_type,
    projectId: input.row.project_id,
    projectName: input.labels?.projectName ?? null,
    workspaceId: input.row.workspace_id,
    workspaceName: input.labels?.workspaceName ?? null,
    createdAt: input.row.created_at,
    createdBy: input.row.created_by,
    revokedAt: input.row.revoked_at,
    revokedBy: input.row.revoked_by,
    role: input.role,
    effectiveCapabilityKeys: scopeEffect.effectiveCapabilityKeys,
    ignoredCapabilityKeys: scopeEffect.ignoredCapabilityKeys,
    hasScopeWarnings: scopeEffect.hasScopeWarnings,
  };
}

async function loadCustomRoleMap(input: {
  supabase: SupabaseClient;
  tenantId: string;
  roleIds: string[];
  activeOnly?: boolean;
}) {
  const uniqueRoleIds = Array.from(new Set(input.roleIds));
  if (uniqueRoleIds.length === 0) {
    return new Map<string, AssignableCustomRole>();
  }

  let query = input.supabase
    .from("role_definitions")
    .select(ROLE_DEFINITION_SELECT)
    .eq("tenant_id", input.tenantId)
    .eq("is_system", false)
    .in("id", uniqueRoleIds);

  if (input.activeOnly) {
    query = query.is("archived_at", null);
  }

  const { data, error } = await query;
  if (error) {
    throw new HttpError(500, "role_definition_lookup_failed", "Unable to load custom roles.");
  }

  const rows = (data ?? []) as RoleDefinitionRow[];
  const capabilityMap = await loadCapabilityMap(
    input.supabase,
    rows.map((row) => row.id),
  );

  return new Map(rows.map((row) => [row.id, mapRole(row, capabilityMap.get(row.id) ?? [])] as const));
}

async function loadProjectForAssignment(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
}) {
  const { data, error } = await input.supabase
    .from("projects")
    .select(PROJECT_TARGET_SELECT)
    .eq("tenant_id", input.tenantId)
    .eq("id", input.projectId)
    .neq("status", "archived")
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "project_lookup_failed", "Unable to load assignment project.");
  }

  if (!data) {
    throw new HttpError(404, "assignment_project_not_found", "Project not found.");
  }

  return data as ProjectTargetRow;
}

async function loadWorkspaceForAssignment(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  workspaceId: string;
}) {
  const { data, error } = await input.supabase
    .from("project_workspaces")
    .select(WORKSPACE_TARGET_SELECT)
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("id", input.workspaceId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "workspace_lookup_failed", "Unable to load assignment workspace.");
  }

  if (!data) {
    throw new HttpError(404, "assignment_workspace_not_found", "Workspace not found.");
  }

  return data as WorkspaceTargetRow;
}

async function validateAssignmentScope(input: {
  supabase: SupabaseClient;
  tenantId: string;
  scope: NormalizedAssignmentScope;
}): Promise<AssignmentTargetLabels> {
  if (input.scope.scopeType === "tenant") {
    return {
      projectName: null,
      workspaceName: null,
    };
  }

  const project = await loadProjectForAssignment({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.scope.projectId!,
  });

  if (input.scope.scopeType === "project") {
    return {
      projectName: project.name,
      workspaceName: null,
    };
  }

  const workspace = await loadWorkspaceForAssignment({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.scope.projectId!,
    workspaceId: input.scope.workspaceId!,
  });

  return {
    projectName: project.name,
    workspaceName: workspace.name,
  };
}

async function findActiveAssignment(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  roleId: string;
  scope: NormalizedAssignmentScope;
}) {
  let query = input.supabase
    .from("role_assignments")
    .select(ROLE_ASSIGNMENT_SELECT)
    .eq("tenant_id", input.tenantId)
    .eq("user_id", input.userId)
    .eq("role_definition_id", input.roleId)
    .eq("scope_type", input.scope.scopeType)
    .is("revoked_at", null);

  if (input.scope.projectId) {
    query = query.eq("project_id", input.scope.projectId);
  } else {
    query = query.is("project_id", null);
  }

  if (input.scope.workspaceId) {
    query = query.eq("workspace_id", input.scope.workspaceId);
  } else {
    query = query.is("workspace_id", null);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    throw new HttpError(
      500,
      "custom_role_assignment_lookup_failed",
      "Unable to load custom role assignment.",
    );
  }

  return (data as RoleAssignmentRow | null) ?? null;
}

async function loadTargetLabelMap(input: {
  supabase: SupabaseClient;
  tenantId: string;
  assignments: RoleAssignmentRow[];
}) {
  const projectIds = Array.from(new Set(input.assignments
    .map((assignment) => assignment.project_id)
    .filter((projectId): projectId is string => Boolean(projectId))));
  const workspaceIds = Array.from(new Set(input.assignments
    .map((assignment) => assignment.workspace_id)
    .filter((workspaceId): workspaceId is string => Boolean(workspaceId))));
  const projectMap = new Map<string, ProjectTargetRow>();
  const workspaceMap = new Map<string, WorkspaceTargetRow>();

  if (projectIds.length > 0) {
    const { data, error } = await input.supabase
      .from("projects")
      .select(PROJECT_TARGET_SELECT)
      .eq("tenant_id", input.tenantId)
      .in("id", projectIds);

    if (error) {
      throw new HttpError(500, "project_lookup_failed", "Unable to load assignment projects.");
    }

    for (const row of (data ?? []) as ProjectTargetRow[]) {
      projectMap.set(row.id, row);
    }
  }

  if (workspaceIds.length > 0) {
    const { data, error } = await input.supabase
      .from("project_workspaces")
      .select(WORKSPACE_TARGET_SELECT)
      .eq("tenant_id", input.tenantId)
      .in("id", workspaceIds);

    if (error) {
      throw new HttpError(500, "workspace_lookup_failed", "Unable to load assignment workspaces.");
    }

    for (const row of (data ?? []) as WorkspaceTargetRow[]) {
      workspaceMap.set(row.id, row);
    }
  }

  return new Map(input.assignments.map((assignment) => {
    const project = assignment.project_id ? projectMap.get(assignment.project_id) : null;
    const workspace = assignment.workspace_id ? workspaceMap.get(assignment.workspace_id) : null;
    return [
      assignment.id,
      {
        projectName: project?.name ?? null,
        workspaceName: workspace?.name ?? null,
      },
    ] as const;
  }));
}

async function mapAssignmentWithRole(input: {
  supabase: SupabaseClient;
  tenantId: string;
  assignment: RoleAssignmentRow;
}) {
  const roleMap = await loadCustomRoleMap({
    supabase: input.supabase,
    tenantId: input.tenantId,
    roleIds: [input.assignment.role_definition_id],
  });
  const role = roleMap.get(input.assignment.role_definition_id);

  if (!role) {
    throw new HttpError(
      500,
      "custom_role_assignment_lookup_failed",
      "Unable to load custom role assignment.",
    );
  }

  const labelMap = await loadTargetLabelMap({
    supabase: input.supabase,
    tenantId: input.tenantId,
    assignments: [input.assignment],
  });

  return mapAssignment({
    row: input.assignment,
    role,
    labels: labelMap.get(input.assignment.id),
  });
}

export async function listAssignableCustomRoles(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
}): Promise<AssignableCustomRole[]> {
  await assertTenantMemberManager(input);

  const { data, error } = await input.supabase
    .from("role_definitions")
    .select(ROLE_DEFINITION_SELECT)
    .eq("tenant_id", input.tenantId)
    .eq("is_system", false)
    .is("archived_at", null)
    .order("name", { ascending: true });

  if (error) {
    throw new HttpError(500, "role_definition_lookup_failed", "Unable to load custom roles.");
  }

  const rows = (data ?? []) as RoleDefinitionRow[];
  const capabilityMap = await loadCapabilityMap(
    input.supabase,
    rows.map((row) => row.id),
  );

  return rows.map((row) => mapRole(row, capabilityMap.get(row.id) ?? []));
}

export async function listCustomRoleAssignmentTargets(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
}): Promise<CustomRoleAssignmentTargetData> {
  await assertTenantMemberManager(input);

  const { data: projectRows, error: projectError } = await input.supabase
    .from("projects")
    .select(PROJECT_TARGET_SELECT)
    .eq("tenant_id", input.tenantId)
    .neq("status", "archived")
    .order("created_at", { ascending: false });

  if (projectError) {
    throw new HttpError(500, "project_lookup_failed", "Unable to load assignment projects.");
  }

  const projects = (projectRows ?? []) as ProjectTargetRow[];
  const projectIds = projects.map((project) => project.id);
  const workspacesByProjectId = new Map<string, CustomRoleAssignmentTargetWorkspace[]>();

  if (projectIds.length > 0) {
    const { data: workspaceRows, error: workspaceError } = await input.supabase
      .from("project_workspaces")
      .select(WORKSPACE_TARGET_SELECT)
      .eq("tenant_id", input.tenantId)
      .in("project_id", projectIds)
      .order("created_at", { ascending: true });

    if (workspaceError) {
      throw new HttpError(500, "workspace_lookup_failed", "Unable to load assignment workspaces.");
    }

    for (const workspace of (workspaceRows ?? []) as WorkspaceTargetRow[]) {
      const list = workspacesByProjectId.get(workspace.project_id) ?? [];
      list.push({
        workspaceId: workspace.id,
        projectId: workspace.project_id,
        name: workspace.name,
        workspaceKind: workspace.workspace_kind,
        workflowState: workspace.workflow_state,
      });
      workspacesByProjectId.set(workspace.project_id, list);
    }
  }

  return {
    projects: projects.map((project) => ({
      projectId: project.id,
      name: project.name,
      status: project.status,
      finalizedAt: project.finalized_at,
      workspaces: workspacesByProjectId.get(project.id) ?? [],
    })),
  };
}

export async function listCustomRoleAssignmentsForMembers(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  includeRevoked?: boolean;
}): Promise<MemberCustomRoleAssignmentSummary[]> {
  await assertTenantMemberManager(input);

  let query = input.supabase
    .from("role_assignments")
    .select(ROLE_ASSIGNMENT_SELECT)
    .eq("tenant_id", input.tenantId);

  if (!input.includeRevoked) {
    query = query.is("revoked_at", null);
  }

  const { data, error } = await query.order("created_at", { ascending: true });
  if (error) {
    throw new HttpError(
      500,
      "custom_role_assignment_lookup_failed",
      "Unable to load custom role assignments.",
    );
  }

  const assignmentRows = (data ?? []) as RoleAssignmentRow[];
  const roleMap = await loadCustomRoleMap({
    supabase: input.supabase,
    tenantId: input.tenantId,
    roleIds: assignmentRows.map((row) => row.role_definition_id),
  });
  const labelMap = await loadTargetLabelMap({
    supabase: input.supabase,
    tenantId: input.tenantId,
    assignments: assignmentRows,
  });

  const summaryByUserId = new Map<string, MemberCustomRoleAssignmentSummary>();
  for (const row of assignmentRows) {
    const role = roleMap.get(row.role_definition_id);
    if (!role) {
      continue;
    }

    const summary = summaryByUserId.get(row.user_id) ?? {
      userId: row.user_id,
      assignments: [],
    };
    summary.assignments.push(mapAssignment({
      row,
      role,
      labels: labelMap.get(row.id),
    }));
    summaryByUserId.set(row.user_id, summary);
  }

  return Array.from(summaryByUserId.values());
}

export async function resolveCustomRoleAssignmentSummary(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  includeRevoked?: boolean;
}): Promise<CustomRoleAssignmentListResult> {
  const [assignableRoles, members, targets] = await Promise.all([
    listAssignableCustomRoles(input),
    listCustomRoleAssignmentsForMembers(input),
    listCustomRoleAssignmentTargets(input),
  ]);

  return {
    assignableRoles,
    members,
    targets,
  };
}

export async function grantCustomRoleToMember(input: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  targetUserId: string;
  roleId: string;
  scopeType?: RoleAssignmentScopeType | null;
  projectId?: string | null;
  workspaceId?: string | null;
}): Promise<GrantCustomRoleResult> {
  const hasExplicitScope = input.scopeType !== undefined && input.scopeType !== null;
  const scope = normalizeAssignmentScope(input);
  await assertTenantMemberManager({
    supabase: input.supabase,
    tenantId: input.tenantId,
    userId: input.actorUserId,
  });
  await assertCurrentTenantMember({
    supabase: input.supabase,
    tenantId: input.tenantId,
    userId: input.targetUserId,
  });
  const roleRow = assertCustomRoleForGrant(await loadRoleDefinitionById(input.supabase, input.roleId), input.tenantId);
  const roleCapabilityMap = await loadCapabilityMap(input.supabase, [roleRow.id]);
  const role = mapRole(roleRow, roleCapabilityMap.get(roleRow.id) ?? []);
  const scopeEffect = getRoleScopeEffect(role.capabilityKeys, scope.scopeType);

  if (scopeEffect.hasZeroEffectiveCapabilities && (hasExplicitScope || scope.scopeType !== "tenant")) {
    throw new HttpError(
      409,
      "custom_role_assignment_no_effective_capabilities",
      "This custom role has no capabilities that apply at the selected scope.",
    );
  }

  await validateAssignmentScope({
    supabase: input.supabase,
    tenantId: input.tenantId,
    scope,
  });

  const admin = createServiceRoleClient();
  const existing = await findActiveAssignment({
    supabase: admin,
    tenantId: input.tenantId,
    userId: input.targetUserId,
    roleId: input.roleId,
    scope,
  });

  if (existing) {
    return {
      assignment: await mapAssignmentWithRole({
        supabase: admin,
        tenantId: input.tenantId,
        assignment: existing,
      }),
      created: false,
    };
  }

  const { data, error } = await admin
    .from("role_assignments")
    .insert({
      tenant_id: input.tenantId,
      user_id: input.targetUserId,
      role_definition_id: input.roleId,
      scope_type: scope.scopeType,
      project_id: scope.projectId,
      workspace_id: scope.workspaceId,
      created_by: input.actorUserId,
    })
    .select(ROLE_ASSIGNMENT_SELECT)
    .single();

  if (isUniqueViolation(error)) {
    const raced = await findActiveAssignment({
      supabase: admin,
      tenantId: input.tenantId,
      userId: input.targetUserId,
      roleId: input.roleId,
      scope,
    });
    if (raced) {
      return {
        assignment: await mapAssignmentWithRole({
          supabase: admin,
          tenantId: input.tenantId,
          assignment: raced,
        }),
        created: false,
      };
    }
  }

  if (error || !data) {
    throw new HttpError(
      409,
      "custom_role_assignment_conflict",
      "Unable to create custom role assignment.",
    );
  }

  return {
    assignment: await mapAssignmentWithRole({
      supabase: admin,
      tenantId: input.tenantId,
      assignment: data as RoleAssignmentRow,
    }),
    created: true,
  };
}

async function loadAssignmentById(input: {
  supabase: SupabaseClient;
  tenantId: string;
  assignmentId: string;
}) {
  const { data, error } = await input.supabase
    .from("role_assignments")
    .select(ROLE_ASSIGNMENT_SELECT)
    .eq("tenant_id", input.tenantId)
    .eq("id", input.assignmentId)
    .maybeSingle();

  if (error) {
    throw new HttpError(
      500,
      "custom_role_assignment_lookup_failed",
      "Unable to load custom role assignment.",
    );
  }

  return (data as RoleAssignmentRow | null) ?? null;
}

export async function revokeCustomRoleAssignment(input: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  assignmentId: string;
}): Promise<RevokeCustomRoleResult> {
  await assertTenantMemberManager({
    supabase: input.supabase,
    tenantId: input.tenantId,
    userId: input.actorUserId,
  });

  const admin = createServiceRoleClient();
  const existing = await loadAssignmentById({
    supabase: admin,
    tenantId: input.tenantId,
    assignmentId: input.assignmentId,
  });

  if (!existing) {
    throw new HttpError(404, "custom_role_assignment_not_found", "Custom role assignment not found.");
  }

  assertCustomRoleForRevoke(await loadRoleDefinitionById(admin, existing.role_definition_id), input.tenantId);

  if (existing.revoked_at) {
    return {
      assignment: await mapAssignmentWithRole({
        supabase: admin,
        tenantId: input.tenantId,
        assignment: existing,
      }),
      revoked: false,
    };
  }

  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("role_assignments")
    .update({
      revoked_at: now,
      revoked_by: input.actorUserId,
    })
    .eq("id", existing.id)
    .is("revoked_at", null)
    .select(ROLE_ASSIGNMENT_SELECT)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "custom_role_assignment_revoke_failed", "Unable to revoke custom role assignment.");
  }

  if (!data) {
    const raced = await loadAssignmentById({
      supabase: admin,
      tenantId: input.tenantId,
      assignmentId: input.assignmentId,
    });
    return {
      assignment: raced
        ? await mapAssignmentWithRole({
            supabase: admin,
            tenantId: input.tenantId,
            assignment: raced,
          })
        : null,
      revoked: false,
    };
  }

  return {
    assignment: await mapAssignmentWithRole({
      supabase: admin,
      tenantId: input.tenantId,
      assignment: data as RoleAssignmentRow,
    }),
    revoked: true,
  };
}

export async function revokeCustomRoleFromMember(input: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  targetUserId: string;
  roleId: string;
}): Promise<RevokeCustomRoleResult> {
  await assertTenantMemberManager({
    supabase: input.supabase,
    tenantId: input.tenantId,
    userId: input.actorUserId,
  });
  await assertCurrentTenantMember({
    supabase: input.supabase,
    tenantId: input.tenantId,
    userId: input.targetUserId,
  });
  assertCustomRoleForRevoke(await loadRoleDefinitionById(input.supabase, input.roleId), input.tenantId);

  const admin = createServiceRoleClient();
  const existing = await findActiveAssignment({
    supabase: admin,
    tenantId: input.tenantId,
    userId: input.targetUserId,
    roleId: input.roleId,
    scope: {
      scopeType: "tenant",
      projectId: null,
      workspaceId: null,
    },
  });

  if (!existing) {
    return {
      assignment: null,
      revoked: false,
    };
  }

  // Compatibility path for the old tenant-only route; scoped UI revokes by assignment id.
  return revokeCustomRoleAssignment({
    supabase: input.supabase,
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    assignmentId: existing.id,
  });
}
