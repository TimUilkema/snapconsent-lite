import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import {
  type CustomRoleAssignmentRecord,
  resolveCustomRoleAssignmentSummary,
} from "@/lib/tenant/custom-role-assignment-service";
import {
  type EffectiveCapabilitiesResolution,
  type EffectiveCapabilitySource,
  type EffectivePermissionScope,
  type IgnoredEffectiveCapability,
  resolveEffectiveCapabilities,
} from "@/lib/tenant/effective-permissions";
import { resolveTenantPermissions } from "@/lib/tenant/permissions";
import {
  listReviewerAccessSummary,
  type ReviewerAccessSummary,
} from "@/lib/tenant/reviewer-access-service";
import {
  CAPABILITY_GROUPS,
  type MembershipRole,
  type TenantCapability,
} from "@/lib/tenant/role-capabilities";

type MembershipRow = {
  tenant_id: string;
  user_id: string;
  role: MembershipRole;
  created_at: string;
};

type ProjectWorkspaceRow = {
  id: string;
  project_id: string;
  name: string | null;
};

type ProjectRow = {
  id: string;
  name: string;
};

export type MemberEffectiveAccessSourceSummary = {
  sourceType: EffectiveCapabilitySource["sourceType"];
  role?: MembershipRole;
  assignmentId?: string;
  assignmentScopeType?: "tenant" | "project" | "workspace";
  roleId?: string;
  roleName?: string;
  projectId?: string | null;
  projectName?: string | null;
  workspaceId?: string | null;
  workspaceName?: string | null;
};

export type MemberEffectiveAccessCapabilityGroup = {
  groupKey: string;
  capabilityKeys: TenantCapability[];
  sources: MemberEffectiveAccessSourceSummary[];
};

export type MemberEffectiveAccessScopeSummary = {
  scopeType: EffectivePermissionScope["scopeType"];
  projectId: string | null;
  projectName: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  capabilityGroups: MemberEffectiveAccessCapabilityGroup[];
};

export type MemberEffectiveAccessIgnoredCapabilitySummary = Pick<
  IgnoredEffectiveCapability,
  "assignmentId" | "roleId" | "roleName" | "assignmentScopeType" | "projectId" | "workspaceId" | "capabilityKey" | "reason"
> & {
  projectName: string | null;
  workspaceName: string | null;
};

export type MemberEffectiveAccessSummary = {
  userId: string;
  email: string;
  fixedRole: MembershipRole;
  customRoleAssignments: CustomRoleAssignmentRecord[];
  reviewerAccess: ReviewerAccessSummary | null;
  photographerWorkspaceAssignments: Array<{
    projectId: string;
    projectName: string | null;
    workspaceId: string;
    workspaceName: string | null;
  }>;
  effectiveScopes: MemberEffectiveAccessScopeSummary[];
  ignoredCapabilities: MemberEffectiveAccessIgnoredCapabilitySummary[];
  warnings: string[];
};

type ScopeCandidate = {
  scope: EffectivePermissionScope;
  projectName: string | null;
  workspaceName: string | null;
};

const CAPABILITY_GROUP_BY_KEY = new Map<TenantCapability, string>(
  CAPABILITY_GROUPS.flatMap((group) =>
    group.capabilities.map((capabilityKey) => [capabilityKey, group.key] as const),
  ),
);

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

async function assertOwnerAdminEffectiveAccessViewer(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
}) {
  // Effective access explanations expose authorization source metadata and stay fixed owner/admin-only.
  const permissions = await resolveTenantPermissions(input.supabase, input.tenantId, input.userId);
  if (!permissions.canManageMembers) {
    throw new HttpError(
      403,
      "tenant_member_management_forbidden",
      "Only workspace owners and admins can inspect effective access.",
    );
  }
}

async function loadMember(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
}) {
  const { data, error } = await input.supabase
    .from("memberships")
    .select("tenant_id, user_id, role, created_at")
    .eq("tenant_id", input.tenantId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "tenant_member_lookup_failed", "Unable to load workspace member.");
  }

  const row = (data as MembershipRow | null) ?? null;
  if (!row) {
    throw new HttpError(404, "member_not_found", "Member not found.");
  }

  return row;
}

async function loadUserEmail(admin: SupabaseClient, userId: string) {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error) {
    throw new HttpError(500, "tenant_member_lookup_failed", "Unable to load workspace member.");
  }

  return data.user?.email?.trim().toLowerCase() ?? "unknown@email";
}

async function loadPhotographerWorkspaceAssignments(input: {
  admin: SupabaseClient;
  tenantId: string;
  userId: string;
}) {
  const { data: workspaceRows, error: workspaceError } = await input.admin
    .from("project_workspaces")
    .select("id, project_id, name")
    .eq("tenant_id", input.tenantId)
    .eq("photographer_user_id", input.userId)
    .order("created_at", { ascending: true });

  if (workspaceError) {
    throw new HttpError(500, "workspace_lookup_failed", "Unable to load photographer workspace assignments.");
  }

  const workspaces = (workspaceRows ?? []) as ProjectWorkspaceRow[];
  const projectIds = Array.from(new Set(workspaces.map((workspace) => workspace.project_id)));
  const projectNameById = new Map<string, string>();

  if (projectIds.length > 0) {
    const { data: projectRows, error: projectError } = await input.admin
      .from("projects")
      .select("id, name")
      .eq("tenant_id", input.tenantId)
      .in("id", projectIds);

    if (projectError) {
      throw new HttpError(500, "project_lookup_failed", "Unable to load photographer assignment projects.");
    }

    for (const project of (projectRows ?? []) as ProjectRow[]) {
      projectNameById.set(project.id, project.name);
    }
  }

  return workspaces.map((workspace) => ({
    projectId: workspace.project_id,
    projectName: projectNameById.get(workspace.project_id) ?? null,
    workspaceId: workspace.id,
    workspaceName: workspace.name,
  }));
}

function scopeKey(scope: EffectivePermissionScope) {
  if (scope.scopeType === "tenant") {
    return "tenant";
  }

  if (scope.scopeType === "project") {
    return `project:${scope.projectId}`;
  }

  return `workspace:${scope.projectId}:${scope.workspaceId}`;
}

function addScopeCandidate(
  candidates: Map<string, ScopeCandidate>,
  candidate: ScopeCandidate,
) {
  candidates.set(scopeKey(candidate.scope), candidate);
}

function buildScopeCandidates(input: {
  customRoleAssignments: CustomRoleAssignmentRecord[];
  reviewerAccess: ReviewerAccessSummary | null;
  photographerWorkspaceAssignments: MemberEffectiveAccessSummary["photographerWorkspaceAssignments"];
}) {
  const candidates = new Map<string, ScopeCandidate>();
  addScopeCandidate(candidates, {
    scope: { scopeType: "tenant" },
    projectName: null,
    workspaceName: null,
  });

  for (const assignment of input.customRoleAssignments) {
    if (assignment.scopeType === "project" && assignment.projectId) {
      addScopeCandidate(candidates, {
        scope: { scopeType: "project", projectId: assignment.projectId },
        projectName: assignment.projectName,
        workspaceName: null,
      });
    }

    if (assignment.scopeType === "workspace" && assignment.projectId && assignment.workspaceId) {
      addScopeCandidate(candidates, {
        scope: {
          scopeType: "workspace",
          projectId: assignment.projectId,
          workspaceId: assignment.workspaceId,
        },
        projectName: assignment.projectName,
        workspaceName: assignment.workspaceName,
      });
    }
  }

  for (const assignment of input.reviewerAccess?.projectAssignments ?? []) {
    addScopeCandidate(candidates, {
      scope: { scopeType: "project", projectId: assignment.projectId },
      projectName: assignment.projectName,
      workspaceName: null,
    });
  }

  for (const assignment of input.photographerWorkspaceAssignments) {
    addScopeCandidate(candidates, {
      scope: {
        scopeType: "workspace",
        projectId: assignment.projectId,
        workspaceId: assignment.workspaceId,
      },
      projectName: assignment.projectName,
      workspaceName: assignment.workspaceName,
    });
  }

  return Array.from(candidates.values());
}

function sourceSummaryKey(source: MemberEffectiveAccessSourceSummary) {
  return [
    source.sourceType,
    source.role ?? "",
    source.assignmentId ?? "",
    source.projectId ?? "",
    source.workspaceId ?? "",
  ].join(":");
}

function summarizeSource(input: {
  source: EffectiveCapabilitySource;
  customRoleAssignmentById: Map<string, CustomRoleAssignmentRecord>;
  reviewerAccess: ReviewerAccessSummary | null;
  photographerWorkspaceById: Map<string, MemberEffectiveAccessSummary["photographerWorkspaceAssignments"][number]>;
}): MemberEffectiveAccessSourceSummary {
  const { source } = input;
  if (source.sourceType === "fixed_role") {
    return {
      sourceType: "fixed_role",
      role: source.role,
    };
  }

  if (source.sourceType === "system_reviewer_assignment") {
    const projectAssignment = input.reviewerAccess?.projectAssignments.find(
      (assignment) => assignment.assignmentId === source.assignmentId,
    );
    return {
      sourceType: "system_reviewer_assignment",
      assignmentId: source.assignmentId,
      assignmentScopeType: source.assignmentScopeType,
      projectId: source.projectId,
      projectName: projectAssignment?.projectName ?? null,
      workspaceId: null,
      workspaceName: null,
    };
  }

  if (source.sourceType === "photographer_workspace_assignment") {
    const workspaceAssignment = input.photographerWorkspaceById.get(source.workspaceId);
    return {
      sourceType: "photographer_workspace_assignment",
      projectId: source.projectId,
      projectName: workspaceAssignment?.projectName ?? null,
      workspaceId: source.workspaceId,
      workspaceName: source.workspaceName ?? workspaceAssignment?.workspaceName ?? null,
    };
  }

  const assignment = input.customRoleAssignmentById.get(source.assignmentId);
  return {
    sourceType: "custom_role_assignment",
    assignmentId: source.assignmentId,
    assignmentScopeType: source.assignmentScopeType,
    roleId: source.roleId,
    roleName: source.roleName,
    projectId: source.projectId,
    projectName: assignment?.projectName ?? null,
    workspaceId: source.workspaceId,
    workspaceName: assignment?.workspaceName ?? null,
  };
}

function summarizeResolution(input: {
  candidate: ScopeCandidate;
  resolution: EffectiveCapabilitiesResolution;
  customRoleAssignmentById: Map<string, CustomRoleAssignmentRecord>;
  reviewerAccess: ReviewerAccessSummary | null;
  photographerWorkspaceById: Map<string, MemberEffectiveAccessSummary["photographerWorkspaceAssignments"][number]>;
}): MemberEffectiveAccessScopeSummary {
  const capabilityKeysByGroup = new Map<string, TenantCapability[]>();
  for (const capabilityKey of input.resolution.capabilityKeys) {
    const groupKey = CAPABILITY_GROUP_BY_KEY.get(capabilityKey) ?? "other";
    capabilityKeysByGroup.set(groupKey, [...(capabilityKeysByGroup.get(groupKey) ?? []), capabilityKey]);
  }

  const capabilityGroups = Array.from(capabilityKeysByGroup.entries()).map(([groupKey, capabilityKeys]) => {
    const sourceByKey = new Map<string, MemberEffectiveAccessSourceSummary>();
    for (const source of input.resolution.sources) {
      if (!source.capabilityKeys.some((capabilityKey) => capabilityKeys.includes(capabilityKey))) {
        continue;
      }

      const summary = summarizeSource({
        source,
        customRoleAssignmentById: input.customRoleAssignmentById,
        reviewerAccess: input.reviewerAccess,
        photographerWorkspaceById: input.photographerWorkspaceById,
      });
      sourceByKey.set(sourceSummaryKey(summary), summary);
    }

    return {
      groupKey,
      capabilityKeys,
      sources: Array.from(sourceByKey.values()),
    };
  });

  const { scope } = input.candidate;
  return {
    scopeType: scope.scopeType,
    projectId: scope.scopeType === "tenant" ? null : scope.projectId,
    projectName: input.candidate.projectName,
    workspaceId: scope.scopeType === "workspace" ? scope.workspaceId : null,
    workspaceName: input.candidate.workspaceName,
    capabilityGroups,
  };
}

function summarizeIgnoredCapabilities(input: {
  resolutions: EffectiveCapabilitiesResolution[];
  customRoleAssignmentById: Map<string, CustomRoleAssignmentRecord>;
}) {
  const ignoredByKey = new Map<string, MemberEffectiveAccessIgnoredCapabilitySummary>();
  for (const resolution of input.resolutions) {
    for (const ignored of resolution.ignoredCapabilities) {
      const key = [
        ignored.assignmentId,
        ignored.capabilityKey,
        ignored.reason,
        ignored.projectId ?? "",
        ignored.workspaceId ?? "",
      ].join(":");
      const assignment = input.customRoleAssignmentById.get(ignored.assignmentId);
      ignoredByKey.set(key, {
        assignmentId: ignored.assignmentId,
        roleId: ignored.roleId,
        roleName: ignored.roleName,
        assignmentScopeType: ignored.assignmentScopeType,
        projectId: ignored.projectId,
        projectName: assignment?.projectName ?? null,
        workspaceId: ignored.workspaceId,
        workspaceName: assignment?.workspaceName ?? null,
        capabilityKey: ignored.capabilityKey,
        reason: ignored.reason,
      });
    }
  }

  return Array.from(ignoredByKey.values());
}

function buildWarnings(input: {
  fixedRole: MembershipRole;
  reviewerAccess: ReviewerAccessSummary | null;
  ignoredCapabilities: MemberEffectiveAccessIgnoredCapabilitySummary[];
}) {
  const warnings: string[] = [];
  if (input.fixedRole === "owner" || input.fixedRole === "admin") {
    warnings.push("fixed_owner_admin_broad_access");
  }

  if (input.reviewerAccess?.tenantWideAccess.active) {
    warnings.push("tenant_wide_reviewer_access_summarized");
  }

  if (input.ignoredCapabilities.length > 0) {
    warnings.push("ignored_capabilities_present");
  }

  return warnings;
}

export async function getMemberEffectiveAccessSummary(input: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  targetUserId: string;
}): Promise<MemberEffectiveAccessSummary> {
  await assertOwnerAdminEffectiveAccessViewer({
    supabase: input.supabase,
    tenantId: input.tenantId,
    userId: input.actorUserId,
  });

  const admin = createServiceRoleClient();
  const [membership, email, customRoleAssignmentSummary, reviewerAccessSummary, photographerWorkspaceAssignments] =
    await Promise.all([
      loadMember({
        supabase: admin,
        tenantId: input.tenantId,
        userId: input.targetUserId,
      }),
      loadUserEmail(admin, input.targetUserId),
      resolveCustomRoleAssignmentSummary({
        supabase: input.supabase,
        tenantId: input.tenantId,
        userId: input.actorUserId,
      }),
      listReviewerAccessSummary({
        supabase: input.supabase,
        tenantId: input.tenantId,
        userId: input.actorUserId,
      }),
      loadPhotographerWorkspaceAssignments({
        admin,
        tenantId: input.tenantId,
        userId: input.targetUserId,
      }),
    ]);

  const customRoleAssignments =
    customRoleAssignmentSummary.members.find((member) => member.userId === input.targetUserId)?.assignments ?? [];
  const reviewerAccess =
    reviewerAccessSummary.reviewers.find((reviewer) => reviewer.userId === input.targetUserId) ?? null;
  const customRoleAssignmentById = new Map(
    customRoleAssignments.map((assignment) => [assignment.assignmentId, assignment] as const),
  );
  const photographerWorkspaceById = new Map(
    photographerWorkspaceAssignments.map((assignment) => [assignment.workspaceId, assignment] as const),
  );
  const scopeCandidates = buildScopeCandidates({
    customRoleAssignments,
    reviewerAccess,
    photographerWorkspaceAssignments,
  });

  const resolutions = await Promise.all(
    scopeCandidates.map((candidate) =>
      resolveEffectiveCapabilities({
        supabase: admin,
        adminSupabase: admin,
        tenantId: input.tenantId,
        userId: input.targetUserId,
        scope: candidate.scope,
      }),
    ),
  );
  const effectiveScopes = scopeCandidates.map((candidate, index) =>
    summarizeResolution({
      candidate,
      resolution: resolutions[index],
      customRoleAssignmentById,
      reviewerAccess,
      photographerWorkspaceById,
    }),
  );
  const ignoredCapabilities = summarizeIgnoredCapabilities({
    resolutions,
    customRoleAssignmentById,
  });

  return {
    userId: input.targetUserId,
    email,
    fixedRole: membership.role,
    customRoleAssignments,
    reviewerAccess,
    photographerWorkspaceAssignments,
    effectiveScopes,
    ignoredCapabilities,
    warnings: buildWarnings({
      fixedRole: membership.role,
      reviewerAccess,
      ignoredCapabilities,
    }),
  };
}
