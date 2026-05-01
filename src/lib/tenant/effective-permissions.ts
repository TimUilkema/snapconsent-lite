import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import {
  getCapabilityScopeSupport,
  type CapabilityScopeSupportValue,
  type RoleAssignmentScopeType,
} from "@/lib/tenant/custom-role-scope-effects";
import {
  getCapabilitiesForRole,
  TENANT_CAPABILITIES,
  type MembershipRole,
  type TenantCapability,
} from "@/lib/tenant/role-capabilities";
import { resolveTenantMembership } from "@/lib/tenant/tenant-membership";

export type EffectivePermissionScope =
  | { scopeType: "tenant" }
  | { scopeType: "project"; projectId: string }
  | { scopeType: "workspace"; projectId: string; workspaceId: string };

export type ResolveEffectiveCapabilitiesInput = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  scope: EffectivePermissionScope;
  capabilityKey?: TenantCapability;
  adminSupabase?: SupabaseClient;
};

export type EffectiveCapabilityCheckInput = ResolveEffectiveCapabilitiesInput & {
  capabilityKey: TenantCapability;
};

export type EffectiveCapabilityDenialReason =
  | "no_tenant_membership"
  | "project_not_found"
  | "workspace_not_found"
  | "capability_not_supported_at_scope"
  | "not_granted"
  | "lookup_failed";

export type FixedRoleCapabilitySource = {
  sourceType: "fixed_role";
  role: MembershipRole;
  capabilityKeys: TenantCapability[];
};

export type SystemReviewerAssignmentCapabilitySource = {
  sourceType: "system_reviewer_assignment";
  assignmentId: string;
  assignmentScopeType: "tenant" | "project";
  projectId: string | null;
  capabilityKeys: TenantCapability[];
};

export type PhotographerWorkspaceAssignmentCapabilitySource = {
  sourceType: "photographer_workspace_assignment";
  projectId: string;
  workspaceId: string;
  workspaceName: string | null;
  capabilityKeys: TenantCapability[];
};

export type CustomRoleAssignmentCapabilitySource = {
  sourceType: "custom_role_assignment";
  assignmentId: string;
  roleId: string;
  roleName: string;
  roleDescription: string | null;
  assignmentScopeType: RoleAssignmentScopeType;
  projectId: string | null;
  workspaceId: string | null;
  capabilityKeys: TenantCapability[];
  ignoredCapabilityKeys: TenantCapability[];
};

export type EffectiveCapabilitySource =
  | FixedRoleCapabilitySource
  | SystemReviewerAssignmentCapabilitySource
  | PhotographerWorkspaceAssignmentCapabilitySource
  | CustomRoleAssignmentCapabilitySource;

export type IgnoredEffectiveCapability = {
  sourceType: "custom_role_assignment";
  assignmentId: string;
  roleId: string;
  roleName: string;
  assignmentScopeType: RoleAssignmentScopeType;
  projectId: string | null;
  workspaceId: string | null;
  capabilityKey: TenantCapability;
  assignmentScopeSupport: CapabilityScopeSupportValue;
  requestedScopeSupport: CapabilityScopeSupportValue;
  reason:
    | "assignment_scope_not_effective"
    | "requested_scope_not_supported"
    | "wrong_project"
    | "wrong_workspace";
};

export type EffectiveCapabilitiesResolution = {
  tenantId: string;
  userId: string;
  membershipRole: MembershipRole;
  scope: EffectivePermissionScope;
  capabilityKeys: TenantCapability[];
  sources: EffectiveCapabilitySource[];
  ignoredCapabilities: IgnoredEffectiveCapability[];
};

export type EffectiveCapabilityCheck = {
  allowed: boolean;
  tenantId: string;
  userId: string;
  scope: EffectivePermissionScope;
  capabilityKey: TenantCapability;
  sources: EffectiveCapabilitySource[];
  denialReason: EffectiveCapabilityDenialReason | null;
};

type ProjectRow = {
  id: string;
};

type WorkspaceRow = {
  id: string;
  name: string | null;
  photographer_user_id: string | null;
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

type RoleDefinitionRow = {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  system_role_key: MembershipRole | null;
  archived_at: string | null;
};

type RoleCapabilityRow = {
  role_definition_id: string;
  capability_key: TenantCapability;
};

type ResolutionContext = {
  admin: SupabaseClient;
  tenantId: string;
  userId: string;
  membershipRole: MembershipRole;
  scope: EffectivePermissionScope;
  workspace: WorkspaceRow | null;
};

const TENANT_CAPABILITY_ORDER = new Map<TenantCapability, number>(
  TENANT_CAPABILITIES.map((capability, index) => [capability, index]),
);

const FIXED_REVIEWER_DIRECT_CAPABILITIES = ["profiles.view"] as const satisfies readonly TenantCapability[];
const FIXED_PHOTOGRAPHER_DIRECT_CAPABILITIES = ["profiles.view"] as const satisfies readonly TenantCapability[];

const PROJECT_REVIEWER_CAPABILITIES = [
  "review.workspace",
  "review.initiate_consent_upgrade_requests",
  "workflow.finalize_project",
  "workflow.start_project_correction",
  "workflow.reopen_workspace_for_correction",
  "correction.review",
  "correction.consent_intake",
  "correction.media_intake",
] as const satisfies readonly TenantCapability[];

const WORKSPACE_REVIEWER_CAPABILITIES = [
  "review.workspace",
  "review.initiate_consent_upgrade_requests",
  "workflow.reopen_workspace_for_correction",
  "correction.review",
  "correction.consent_intake",
  "correction.media_intake",
] as const satisfies readonly TenantCapability[];

const TENANT_REVIEWER_CAPABILITIES = [
  "media_library.access",
  "media_library.manage_folders",
] as const satisfies readonly TenantCapability[];

const WORKSPACE_CAPTURE_CAPABILITIES = [
  "capture.workspace",
  "capture.create_one_off_invites",
  "capture.create_recurring_project_consent_requests",
  "capture.upload_assets",
] as const satisfies readonly TenantCapability[];

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

function sortCapabilities(capabilityKeys: Iterable<TenantCapability>) {
  return Array.from(new Set(capabilityKeys)).sort(
    (a, b) => (TENANT_CAPABILITY_ORDER.get(a) ?? 999) - (TENANT_CAPABILITY_ORDER.get(b) ?? 999),
  );
}

function sourceHasCapability(source: EffectiveCapabilitySource, capabilityKey: TenantCapability) {
  return source.capabilityKeys.includes(capabilityKey);
}

function requestedScopeSupport(scope: EffectivePermissionScope, capabilityKey: TenantCapability) {
  return getCapabilityScopeSupport(capabilityKey)[scope.scopeType];
}

function isRequestedScopeUnsupported(scope: EffectivePermissionScope, capabilityKey: TenantCapability) {
  const support = requestedScopeSupport(scope, capabilityKey);
  return support === "no" || support === "not_applicable";
}

async function validateScope(input: {
  admin: SupabaseClient;
  tenantId: string;
  scope: EffectivePermissionScope;
}) {
  if (input.scope.scopeType === "tenant") {
    return { workspace: null };
  }

  const { data: project, error: projectError } = await input.admin
    .from("projects")
    .select("id")
    .eq("tenant_id", input.tenantId)
    .eq("id", input.scope.projectId)
    .maybeSingle();

  if (projectError) {
    throw new HttpError(500, "project_lookup_failed", "Unable to load project.");
  }

  if (!(project as ProjectRow | null)) {
    throw new HttpError(404, "project_not_found", "Project not found.");
  }

  if (input.scope.scopeType === "project") {
    return { workspace: null };
  }

  const { data: workspace, error: workspaceError } = await input.admin
    .from("project_workspaces")
    .select("id, name, photographer_user_id")
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.scope.projectId)
    .eq("id", input.scope.workspaceId)
    .maybeSingle();

  if (workspaceError) {
    throw new HttpError(500, "workspace_lookup_failed", "Unable to load project workspace.");
  }

  if (!workspace) {
    throw new HttpError(404, "workspace_not_found", "Project workspace not found.");
  }

  return { workspace: workspace as WorkspaceRow };
}

function resolveFixedRoleSource(input: {
  membershipRole: MembershipRole;
  scope: EffectivePermissionScope;
}): FixedRoleCapabilitySource | null {
  let candidateCapabilities: readonly TenantCapability[];

  if (input.membershipRole === "owner" || input.membershipRole === "admin") {
    candidateCapabilities = getCapabilitiesForRole(input.membershipRole);
  } else if (input.membershipRole === "reviewer") {
    candidateCapabilities = FIXED_REVIEWER_DIRECT_CAPABILITIES;
  } else {
    candidateCapabilities = FIXED_PHOTOGRAPHER_DIRECT_CAPABILITIES;
  }

  const capabilityKeys = sortCapabilities(
    candidateCapabilities.filter(
      (capabilityKey) => getCapabilityScopeSupport(capabilityKey)[input.scope.scopeType] === "yes",
    ),
  );

  if (capabilityKeys.length === 0) {
    return null;
  }

  return {
    sourceType: "fixed_role",
    role: input.membershipRole,
    capabilityKeys,
  };
}

async function loadSystemRoleDefinitionId(input: {
  admin: SupabaseClient;
  systemRoleKey: MembershipRole;
}) {
  const { data, error } = await input.admin
    .from("role_definitions")
    .select("id")
    .eq("is_system", true)
    .eq("system_role_key", input.systemRoleKey)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "effective_permission_lookup_failed", "Unable to load system role definition.");
  }

  const row = data as { id: string } | null;
  if (!row) {
    throw new HttpError(500, "effective_permission_lookup_failed", "System role definition is missing.");
  }

  return row.id;
}

async function resolveReviewerSources(
  context: ResolutionContext,
): Promise<SystemReviewerAssignmentCapabilitySource[]> {
  if (context.membershipRole !== "reviewer") {
    return [];
  }

  const roleDefinitionId = await loadSystemRoleDefinitionId({
    admin: context.admin,
    systemRoleKey: "reviewer",
  });

  const { data, error } = await context.admin
    .from("role_assignments")
    .select("id, tenant_id, user_id, role_definition_id, scope_type, project_id, workspace_id, created_at, created_by, revoked_at, revoked_by")
    .eq("tenant_id", context.tenantId)
    .eq("user_id", context.userId)
    .eq("role_definition_id", roleDefinitionId)
    .is("revoked_at", null)
    .in("scope_type", ["tenant", "project"])
    .order("created_at", { ascending: true });

  if (error) {
    throw new HttpError(500, "effective_permission_lookup_failed", "Unable to load reviewer assignments.");
  }

  const sources: SystemReviewerAssignmentCapabilitySource[] = [];
  for (const assignment of (data ?? []) as RoleAssignmentRow[]) {
    if (assignment.scope_type === "workspace") {
      continue;
    }

    let capabilityKeys: TenantCapability[] = [];
    if (context.scope.scopeType === "tenant") {
      if (assignment.scope_type === "tenant") {
        capabilityKeys = [...TENANT_REVIEWER_CAPABILITIES];
      }
    } else if (context.scope.scopeType === "project") {
      if (
        assignment.scope_type === "tenant"
        || (assignment.scope_type === "project" && assignment.project_id === context.scope.projectId)
      ) {
        capabilityKeys = [...PROJECT_REVIEWER_CAPABILITIES];
      }
    } else if (
      assignment.scope_type === "tenant"
      || (assignment.scope_type === "project" && assignment.project_id === context.scope.projectId)
    ) {
      capabilityKeys = [...WORKSPACE_REVIEWER_CAPABILITIES];
    }

    if (capabilityKeys.length > 0) {
      sources.push({
        sourceType: "system_reviewer_assignment",
        assignmentId: assignment.id,
        assignmentScopeType: assignment.scope_type,
        projectId: assignment.project_id,
        capabilityKeys: sortCapabilities(capabilityKeys),
      });
    }
  }

  return sources;
}

function resolvePhotographerSource(context: ResolutionContext): PhotographerWorkspaceAssignmentCapabilitySource | null {
  if (
    context.membershipRole !== "photographer"
    || context.scope.scopeType !== "workspace"
    || !context.workspace
    || context.workspace.photographer_user_id !== context.userId
  ) {
    return null;
  }

  return {
    sourceType: "photographer_workspace_assignment",
    projectId: context.scope.projectId,
    workspaceId: context.scope.workspaceId,
    workspaceName: context.workspace.name,
    capabilityKeys: sortCapabilities(WORKSPACE_CAPTURE_CAPABILITIES),
  };
}

function customAssignmentGrantReason(input: {
  assignment: RoleAssignmentRow;
  capabilityKey: TenantCapability;
  scope: EffectivePermissionScope;
}) {
  const support = getCapabilityScopeSupport(input.capabilityKey);
  const requested = support[input.scope.scopeType];
  const assignmentSupport = support[input.assignment.scope_type];

  if (requested !== "yes") {
    return {
      grants: false,
      reason: "requested_scope_not_supported" as const,
      assignmentScopeSupport: assignmentSupport,
      requestedScopeSupport: requested,
    };
  }

  if (input.scope.scopeType === "tenant") {
    return {
      grants: input.assignment.scope_type === "tenant" && assignmentSupport === "yes",
      reason: "assignment_scope_not_effective" as const,
      assignmentScopeSupport: assignmentSupport,
      requestedScopeSupport: requested,
    };
  }

  if (input.scope.scopeType === "project") {
    if (input.assignment.scope_type === "tenant") {
      return {
        grants: assignmentSupport === "yes",
        reason: "assignment_scope_not_effective" as const,
        assignmentScopeSupport: assignmentSupport,
        requestedScopeSupport: requested,
      };
    }

    if (input.assignment.scope_type === "project") {
      const matchesProject = input.assignment.project_id === input.scope.projectId;
      return {
        grants: matchesProject && assignmentSupport === "yes",
        reason: matchesProject ? "assignment_scope_not_effective" as const : "wrong_project" as const,
        assignmentScopeSupport: assignmentSupport,
        requestedScopeSupport: requested,
      };
    }

    return {
      grants: false,
      reason: input.assignment.project_id === input.scope.projectId
        ? "assignment_scope_not_effective" as const
        : "wrong_project" as const,
      assignmentScopeSupport: assignmentSupport,
      requestedScopeSupport: requested,
    };
  }

  if (input.assignment.scope_type === "tenant") {
    return {
      grants: assignmentSupport === "yes",
      reason: "assignment_scope_not_effective" as const,
      assignmentScopeSupport: assignmentSupport,
      requestedScopeSupport: requested,
    };
  }

  if (input.assignment.scope_type === "project") {
    const matchesProject = input.assignment.project_id === input.scope.projectId;
    return {
      grants: matchesProject && requested === "yes",
      reason: matchesProject ? "assignment_scope_not_effective" as const : "wrong_project" as const,
      assignmentScopeSupport: assignmentSupport,
      requestedScopeSupport: requested,
    };
  }

  const matchesProject = input.assignment.project_id === input.scope.projectId;
  const matchesWorkspace = input.assignment.workspace_id === input.scope.workspaceId;
  return {
    grants: matchesProject && matchesWorkspace && assignmentSupport === "yes",
    reason: !matchesProject
      ? "wrong_project" as const
      : matchesWorkspace
        ? "assignment_scope_not_effective" as const
        : "wrong_workspace" as const,
    assignmentScopeSupport: assignmentSupport,
    requestedScopeSupport: requested,
  };
}

async function resolveCustomRoleSources(context: ResolutionContext): Promise<{
  sources: CustomRoleAssignmentCapabilitySource[];
  ignoredCapabilities: IgnoredEffectiveCapability[];
}> {
  const { data: assignmentData, error: assignmentError } = await context.admin
    .from("role_assignments")
    .select("id, tenant_id, user_id, role_definition_id, scope_type, project_id, workspace_id, created_at, created_by, revoked_at, revoked_by")
    .eq("tenant_id", context.tenantId)
    .eq("user_id", context.userId)
    .is("revoked_at", null)
    .order("created_at", { ascending: true });

  if (assignmentError) {
    throw new HttpError(500, "effective_permission_lookup_failed", "Unable to load custom role assignments.");
  }

  const assignments = (assignmentData ?? []) as RoleAssignmentRow[];
  const roleIds = Array.from(new Set(assignments.map((assignment) => assignment.role_definition_id)));
  if (roleIds.length === 0) {
    return { sources: [], ignoredCapabilities: [] };
  }

  const { data: roleData, error: roleError } = await context.admin
    .from("role_definitions")
    .select("id, name, description, is_system, system_role_key, archived_at")
    .eq("tenant_id", context.tenantId)
    .eq("is_system", false)
    .is("archived_at", null)
    .in("id", roleIds);

  if (roleError) {
    throw new HttpError(500, "effective_permission_lookup_failed", "Unable to load custom role definitions.");
  }

  const rolesById = new Map<string, RoleDefinitionRow>(
    ((roleData ?? []) as RoleDefinitionRow[]).map((role) => [role.id, role]),
  );
  const customRoleIds = Array.from(rolesById.keys());
  if (customRoleIds.length === 0) {
    return { sources: [], ignoredCapabilities: [] };
  }

  const { data: capabilityData, error: capabilityError } = await context.admin
    .from("role_definition_capabilities")
    .select("role_definition_id, capability_key")
    .in("role_definition_id", customRoleIds);

  if (capabilityError) {
    throw new HttpError(500, "effective_permission_lookup_failed", "Unable to load custom role capabilities.");
  }

  const capabilitiesByRoleId = new Map<string, TenantCapability[]>();
  for (const row of (capabilityData ?? []) as RoleCapabilityRow[]) {
    const current = capabilitiesByRoleId.get(row.role_definition_id) ?? [];
    current.push(row.capability_key);
    capabilitiesByRoleId.set(row.role_definition_id, current);
  }

  const sources: CustomRoleAssignmentCapabilitySource[] = [];
  const ignoredCapabilities: IgnoredEffectiveCapability[] = [];

  for (const assignment of assignments) {
    const role = rolesById.get(assignment.role_definition_id);
    if (!role) {
      continue;
    }

    const granted: TenantCapability[] = [];
    const ignored: TenantCapability[] = [];

    for (const capabilityKey of sortCapabilities(capabilitiesByRoleId.get(role.id) ?? [])) {
      const result = customAssignmentGrantReason({
        assignment,
        capabilityKey,
        scope: context.scope,
      });

      if (result.grants) {
        granted.push(capabilityKey);
      } else {
        ignored.push(capabilityKey);
        ignoredCapabilities.push({
          sourceType: "custom_role_assignment",
          assignmentId: assignment.id,
          roleId: role.id,
          roleName: role.name,
          assignmentScopeType: assignment.scope_type,
          projectId: assignment.project_id,
          workspaceId: assignment.workspace_id,
          capabilityKey,
          assignmentScopeSupport: result.assignmentScopeSupport,
          requestedScopeSupport: result.requestedScopeSupport,
          reason: result.reason,
        });
      }
    }

    if (granted.length > 0) {
      sources.push({
        sourceType: "custom_role_assignment",
        assignmentId: assignment.id,
        roleId: role.id,
        roleName: role.name,
        roleDescription: role.description,
        assignmentScopeType: assignment.scope_type,
        projectId: assignment.project_id,
        workspaceId: assignment.workspace_id,
        capabilityKeys: sortCapabilities(granted),
        ignoredCapabilityKeys: sortCapabilities(ignored),
      });
    }
  }

  return {
    sources,
    ignoredCapabilities,
  };
}

export async function resolveEffectiveCapabilities(
  input: ResolveEffectiveCapabilitiesInput,
): Promise<EffectiveCapabilitiesResolution> {
  const membership = await resolveTenantMembership(input.supabase, input.tenantId, input.userId);
  const admin = input.adminSupabase ?? createServiceRoleClient();
  const { workspace } = await validateScope({
    admin,
    tenantId: input.tenantId,
    scope: input.scope,
  });
  const context: ResolutionContext = {
    admin,
    tenantId: input.tenantId,
    userId: input.userId,
    membershipRole: membership.role,
    scope: input.scope,
    workspace,
  };

  const sources: EffectiveCapabilitySource[] = [];
  const fixedRoleSource = resolveFixedRoleSource({
    membershipRole: membership.role,
    scope: input.scope,
  });
  if (fixedRoleSource) {
    sources.push(fixedRoleSource);
  }

  sources.push(...await resolveReviewerSources(context));

  const photographerSource = resolvePhotographerSource(context);
  if (photographerSource) {
    sources.push(photographerSource);
  }

  const customRoleResolution = await resolveCustomRoleSources(context);
  sources.push(...customRoleResolution.sources);

  return {
    tenantId: input.tenantId,
    userId: input.userId,
    membershipRole: membership.role,
    scope: input.scope,
    capabilityKeys: sortCapabilities(sources.flatMap((source) => source.capabilityKeys)),
    sources,
    ignoredCapabilities: customRoleResolution.ignoredCapabilities,
  };
}

export async function userHasEffectiveCapability(
  input: EffectiveCapabilityCheckInput,
): Promise<EffectiveCapabilityCheck> {
  const resolution = await resolveEffectiveCapabilities(input);

  if (isRequestedScopeUnsupported(input.scope, input.capabilityKey)) {
    return {
      allowed: false,
      tenantId: input.tenantId,
      userId: input.userId,
      scope: input.scope,
      capabilityKey: input.capabilityKey,
      sources: [],
      denialReason: "capability_not_supported_at_scope",
    };
  }

  const sources = resolution.sources.filter((source) => sourceHasCapability(source, input.capabilityKey));
  return {
    allowed: sources.length > 0,
    tenantId: input.tenantId,
    userId: input.userId,
    scope: input.scope,
    capabilityKey: input.capabilityKey,
    sources,
    denialReason: sources.length > 0 ? null : "not_granted",
  };
}

export async function assertEffectiveCapability(input: EffectiveCapabilityCheckInput) {
  const check = await userHasEffectiveCapability(input);
  if (check.allowed) {
    return check;
  }

  if (check.denialReason === "capability_not_supported_at_scope") {
    throw new HttpError(
      403,
      "effective_capability_scope_forbidden",
      "This capability is not supported at the requested scope.",
    );
  }

  throw new HttpError(403, "effective_capability_forbidden", "The requested capability is not granted.");
}

export async function resolveEffectiveTenantCapabilities(input: Omit<ResolveEffectiveCapabilitiesInput, "scope">) {
  return resolveEffectiveCapabilities({
    ...input,
    scope: { scopeType: "tenant" },
  });
}

export async function resolveEffectiveProjectCapabilities(
  input: Omit<ResolveEffectiveCapabilitiesInput, "scope"> & { projectId: string },
) {
  return resolveEffectiveCapabilities({
    ...input,
    scope: { scopeType: "project", projectId: input.projectId },
  });
}

export async function resolveEffectiveWorkspaceCapabilities(
  input: Omit<ResolveEffectiveCapabilitiesInput, "scope"> & {
    projectId: string;
    workspaceId: string;
  },
) {
  return resolveEffectiveCapabilities({
    ...input,
    scope: {
      scopeType: "workspace",
      projectId: input.projectId,
      workspaceId: input.workspaceId,
    },
  });
}

export async function assertEffectiveTenantCapability(
  input: Omit<EffectiveCapabilityCheckInput, "scope">,
) {
  return assertEffectiveCapability({
    ...input,
    scope: { scopeType: "tenant" },
  });
}

export async function assertEffectiveProjectCapability(
  input: Omit<EffectiveCapabilityCheckInput, "scope"> & { projectId: string },
) {
  return assertEffectiveCapability({
    ...input,
    scope: { scopeType: "project", projectId: input.projectId },
  });
}

export async function assertEffectiveWorkspaceCapability(
  input: Omit<EffectiveCapabilityCheckInput, "scope"> & {
    projectId: string;
    workspaceId: string;
  },
) {
  return assertEffectiveCapability({
    ...input,
    scope: {
      scopeType: "workspace",
      projectId: input.projectId,
      workspaceId: input.workspaceId,
    },
  });
}
