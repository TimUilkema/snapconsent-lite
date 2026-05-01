import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import type { MembershipRole } from "@/lib/tenant/role-capabilities";

type MembershipRow = {
  tenant_id: string;
  user_id: string;
  role: MembershipRole;
  created_at?: string;
};

type RoleDefinitionRow = {
  id: string;
};

type RoleAssignmentRow = {
  id: string;
  tenant_id: string;
  user_id: string;
  role_definition_id: string;
  scope_type: "tenant" | "project" | "workspace";
  project_id: string | null;
  workspace_id: string | null;
  created_at: string;
  created_by: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
};

type ProjectRow = {
  id: string;
  name: string;
};

export type ReviewAccessSource = "owner_admin" | "tenant_assignment" | "project_assignment" | "none";

export type ReviewerAccessAssignment = {
  assignmentId: string;
  tenantId: string;
  userId: string;
  scopeType: "tenant" | "project";
  projectId: string | null;
  createdAt: string;
  createdBy: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
};

export type ReviewerAccessSummary = {
  userId: string;
  email: string;
  role: "reviewer";
  tenantWideAccess: {
    active: boolean;
    assignmentId: string | null;
    grantedAt: string | null;
  };
  projectAssignments: Array<{
    assignmentId: string;
    projectId: string;
    projectName: string;
    grantedAt: string;
  }>;
};

export type ProjectReviewerAccessData = {
  projectId: string;
  assignments: Array<{
    assignmentId: string;
    userId: string;
    email: string;
    grantedAt: string;
  }>;
  eligibleReviewers: Array<{
    userId: string;
    email: string;
    hasProjectAccess: boolean;
    hasTenantWideAccess: boolean;
  }>;
};

export type EffectiveReviewerTenantAccess = {
  isReviewerEligible: boolean;
  hasTenantWideReviewAccess: boolean;
  projectIds: string[];
};

export type EffectiveReviewerProjectAccess = EffectiveReviewerTenantAccess & {
  canReviewProject: boolean;
  reviewAccessSource: Exclude<ReviewAccessSource, "owner_admin">;
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

function mapAssignment(row: RoleAssignmentRow): ReviewerAccessAssignment {
  return {
    assignmentId: row.id,
    tenantId: row.tenant_id,
    userId: row.user_id,
    scopeType: row.scope_type === "tenant" ? "tenant" : "project",
    projectId: row.project_id,
    createdAt: row.created_at,
    createdBy: row.created_by,
    revokedAt: row.revoked_at,
    revokedBy: row.revoked_by,
  };
}

function isUniqueViolation(error: { code?: string } | null | undefined) {
  return error?.code === "23505";
}

async function loadSystemReviewerRoleDefinitionId(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("role_definitions")
    .select("id")
    .eq("is_system", true)
    .eq("system_role_key", "reviewer")
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "reviewer_role_lookup_failed", "Unable to load the reviewer role definition.");
  }

  const row = (data as RoleDefinitionRow | null) ?? null;
  if (!row) {
    throw new HttpError(500, "reviewer_role_missing", "Reviewer role definition is missing.");
  }

  return row.id;
}

async function loadMembership(input: {
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
    throw new HttpError(500, "tenant_member_lookup_failed", "Unable to load tenant membership.");
  }

  return (data as MembershipRow | null) ?? null;
}

async function assertTenantMemberManager(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
}) {
  // Reviewer access administration is separate from custom-role assignment and remains fixed owner/admin-only.
  const membership = await loadMembership(input);
  if (!membership || (membership.role !== "owner" && membership.role !== "admin")) {
    throw new HttpError(
      403,
      "tenant_member_management_forbidden",
      "Only workspace owners and admins can manage members.",
    );
  }

  return membership;
}

async function loadReviewerMember(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
}) {
  const membership = await loadMembership(input);
  if (!membership) {
    throw new HttpError(404, "member_not_found", "Member not found.");
  }

  if (membership.role !== "reviewer") {
    throw new HttpError(
      409,
      "reviewer_access_target_not_reviewer",
      "Reviewer access can only be assigned to reviewer members.",
    );
  }

  return membership;
}

async function assertProjectInTenant(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
}) {
  const { data, error } = await input.supabase
    .from("projects")
    .select("id, name")
    .eq("tenant_id", input.tenantId)
    .eq("id", input.projectId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "project_lookup_failed", "Unable to load project.");
  }

  const project = (data as ProjectRow | null) ?? null;
  if (!project) {
    throw new HttpError(404, "project_not_found", "Project not found.");
  }

  return project;
}

async function loadUserEmailMap(userIds: string[]) {
  const uniqueUserIds = Array.from(new Set(userIds));
  if (uniqueUserIds.length === 0) {
    return new Map<string, string>();
  }

  const admin = createServiceRoleClient();
  const { data, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });

  if (error) {
    throw new HttpError(500, "tenant_member_lookup_failed", "Unable to load workspace members.");
  }

  const wantedUserIds = new Set(uniqueUserIds);
  const emailByUserId = new Map<string, string>();
  data.users.forEach((user) => {
    if (wantedUserIds.has(user.id)) {
      emailByUserId.set(user.id, user.email?.trim().toLowerCase() ?? "unknown@email");
    }
  });

  return emailByUserId;
}

async function listActiveReviewerAssignments(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId?: string;
  projectId?: string;
}) {
  const roleDefinitionId = await loadSystemReviewerRoleDefinitionId(input.supabase);
  let query = input.supabase
    .from("role_assignments")
    .select("id, tenant_id, user_id, role_definition_id, scope_type, project_id, workspace_id, created_at, created_by, revoked_at, revoked_by")
    .eq("tenant_id", input.tenantId)
    .eq("role_definition_id", roleDefinitionId)
    .is("revoked_at", null);

  if (input.userId) {
    query = query.eq("user_id", input.userId);
  }

  if (input.projectId) {
    query = query.eq("scope_type", "project").eq("project_id", input.projectId);
  } else {
    query = query.in("scope_type", ["tenant", "project"]);
  }

  const { data, error } = await query.order("created_at", { ascending: true });

  if (error) {
    throw new HttpError(500, "reviewer_access_lookup_failed", "Unable to load reviewer access assignments.");
  }

  return (data ?? []) as RoleAssignmentRow[];
}

async function loadProjectNames(input: {
  supabase: SupabaseClient;
  tenantId: string;
  projectIds: string[];
}) {
  const projectIds = Array.from(new Set(input.projectIds.filter(Boolean)));
  if (projectIds.length === 0) {
    return new Map<string, string>();
  }

  const { data, error } = await input.supabase
    .from("projects")
    .select("id, name")
    .eq("tenant_id", input.tenantId)
    .in("id", projectIds);

  if (error) {
    throw new HttpError(500, "project_lookup_failed", "Unable to load projects.");
  }

  return new Map(((data ?? []) as ProjectRow[]).map((project) => [project.id, project.name] as const));
}

export async function resolveEffectiveReviewerAccessForTenant(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
}): Promise<EffectiveReviewerTenantAccess> {
  const membership = await loadMembership(input);
  if (!membership || membership.role !== "reviewer") {
    return {
      isReviewerEligible: membership?.role === "reviewer",
      hasTenantWideReviewAccess: false,
      projectIds: [],
    };
  }

  // Assignment rows are authorization inputs. Authenticated users do not get broad
  // role_assignment reads through RLS, so server-side permission resolution reads
  // them with the service role after membership has been validated above.
  const assignments = await listActiveReviewerAssignments({
    supabase: createServiceRoleClient(),
    tenantId: input.tenantId,
    userId: input.userId,
  });
  return {
    isReviewerEligible: true,
    hasTenantWideReviewAccess: assignments.some((assignment) => assignment.scope_type === "tenant"),
    projectIds: assignments
      .filter((assignment) => assignment.scope_type === "project" && assignment.project_id)
      .map((assignment) => assignment.project_id as string),
  };
}

export async function resolveEffectiveReviewerAccessForProject(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  projectId: string;
}): Promise<EffectiveReviewerProjectAccess> {
  const tenantAccess = await resolveEffectiveReviewerAccessForTenant(input);
  const hasProjectAccess = tenantAccess.projectIds.includes(input.projectId);
  const reviewAccessSource = tenantAccess.hasTenantWideReviewAccess
    ? "tenant_assignment"
    : hasProjectAccess
      ? "project_assignment"
      : "none";

  return {
    ...tenantAccess,
    canReviewProject: reviewAccessSource !== "none",
    reviewAccessSource,
  };
}

export async function listReviewerAccessSummary(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
}) {
  await assertTenantMemberManager(input);

  const { data, error } = await input.supabase
    .from("memberships")
    .select("tenant_id, user_id, role, created_at")
    .eq("tenant_id", input.tenantId)
    .eq("role", "reviewer")
    .order("created_at", { ascending: true });

  if (error) {
    throw new HttpError(500, "tenant_member_lookup_failed", "Unable to load reviewer members.");
  }

  const reviewers = (data ?? []) as MembershipRow[];
  const assignments = await listActiveReviewerAssignments({
    supabase: input.supabase,
    tenantId: input.tenantId,
  });
  const emailByUserId = await loadUserEmailMap(reviewers.map((reviewer) => reviewer.user_id));
  const projectNameById = await loadProjectNames({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectIds: assignments
      .map((assignment) => assignment.project_id)
      .filter((projectId): projectId is string => Boolean(projectId)),
  });

  return {
    reviewers: reviewers.map((reviewer) => {
      const reviewerAssignments = assignments.filter((assignment) => assignment.user_id === reviewer.user_id);
      const tenantAssignment =
        reviewerAssignments.find((assignment) => assignment.scope_type === "tenant") ?? null;

      return {
        userId: reviewer.user_id,
        email: emailByUserId.get(reviewer.user_id) ?? "unknown@email",
        role: "reviewer",
        tenantWideAccess: {
          active: Boolean(tenantAssignment),
          assignmentId: tenantAssignment?.id ?? null,
          grantedAt: tenantAssignment?.created_at ?? null,
        },
        projectAssignments: reviewerAssignments
          .filter((assignment) => assignment.scope_type === "project" && assignment.project_id)
          .map((assignment) => ({
            assignmentId: assignment.id,
            projectId: assignment.project_id as string,
            projectName: projectNameById.get(assignment.project_id as string) ?? "Unknown project",
            grantedAt: assignment.created_at,
          })),
      } satisfies ReviewerAccessSummary;
    }),
  };
}

export async function listProjectReviewerAssignments(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  projectId: string;
}): Promise<ProjectReviewerAccessData> {
  await assertTenantMemberManager(input);
  await assertProjectInTenant(input);

  const { data, error } = await input.supabase
    .from("memberships")
    .select("tenant_id, user_id, role, created_at")
    .eq("tenant_id", input.tenantId)
    .eq("role", "reviewer")
    .order("created_at", { ascending: true });

  if (error) {
    throw new HttpError(500, "tenant_member_lookup_failed", "Unable to load reviewer members.");
  }

  const reviewers = (data ?? []) as MembershipRow[];
  const allAssignments = await listActiveReviewerAssignments({
    supabase: input.supabase,
    tenantId: input.tenantId,
  });
  const projectAssignments = allAssignments.filter(
    (assignment) => assignment.scope_type === "project" && assignment.project_id === input.projectId,
  );
  const tenantWideUserIds = new Set(
    allAssignments
      .filter((assignment) => assignment.scope_type === "tenant")
      .map((assignment) => assignment.user_id),
  );
  const projectUserIds = new Set(projectAssignments.map((assignment) => assignment.user_id));
  const emailByUserId = await loadUserEmailMap(reviewers.map((reviewer) => reviewer.user_id));

  return {
    projectId: input.projectId,
    assignments: projectAssignments.map((assignment) => ({
      assignmentId: assignment.id,
      userId: assignment.user_id,
      email: emailByUserId.get(assignment.user_id) ?? "unknown@email",
      grantedAt: assignment.created_at,
    })),
    eligibleReviewers: reviewers.map((reviewer) => ({
      userId: reviewer.user_id,
      email: emailByUserId.get(reviewer.user_id) ?? "unknown@email",
      hasProjectAccess: projectUserIds.has(reviewer.user_id),
      hasTenantWideAccess: tenantWideUserIds.has(reviewer.user_id),
    })),
  };
}

async function findActiveAssignment(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  roleDefinitionId: string;
  scopeType: "tenant" | "project";
  projectId?: string | null;
}) {
  let query = input.supabase
    .from("role_assignments")
    .select("id, tenant_id, user_id, role_definition_id, scope_type, project_id, workspace_id, created_at, created_by, revoked_at, revoked_by")
    .eq("tenant_id", input.tenantId)
    .eq("user_id", input.userId)
    .eq("role_definition_id", input.roleDefinitionId)
    .eq("scope_type", input.scopeType)
    .is("revoked_at", null);

  if (input.scopeType === "project") {
    query = query.eq("project_id", input.projectId);
  } else {
    query = query.is("project_id", null);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw new HttpError(500, "reviewer_access_lookup_failed", "Unable to load reviewer access assignment.");
  }

  return (data as RoleAssignmentRow | null) ?? null;
}

async function grantReviewerAccess(input: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  targetUserId: string;
  scopeType: "tenant" | "project";
  projectId?: string | null;
}) {
  await assertTenantMemberManager({
    supabase: input.supabase,
    tenantId: input.tenantId,
    userId: input.actorUserId,
  });
  await loadReviewerMember({
    supabase: input.supabase,
    tenantId: input.tenantId,
    userId: input.targetUserId,
  });

  if (input.scopeType === "project") {
    await assertProjectInTenant({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId ?? "",
    });
  }

  const admin = createServiceRoleClient();
  const roleDefinitionId = await loadSystemReviewerRoleDefinitionId(admin);
  const existing = await findActiveAssignment({
    supabase: admin,
    tenantId: input.tenantId,
    userId: input.targetUserId,
    roleDefinitionId,
    scopeType: input.scopeType,
    projectId: input.projectId ?? null,
  });

  if (existing) {
    return {
      assignment: mapAssignment(existing),
      created: false,
    };
  }

  const { data, error } = await admin
    .from("role_assignments")
    .insert({
      tenant_id: input.tenantId,
      user_id: input.targetUserId,
      role_definition_id: roleDefinitionId,
      scope_type: input.scopeType,
      project_id: input.scopeType === "project" ? input.projectId : null,
      workspace_id: null,
      created_by: input.actorUserId,
    })
    .select("id, tenant_id, user_id, role_definition_id, scope_type, project_id, workspace_id, created_at, created_by, revoked_at, revoked_by")
    .single();

  if (isUniqueViolation(error)) {
    const raced = await findActiveAssignment({
      supabase: admin,
      tenantId: input.tenantId,
      userId: input.targetUserId,
      roleDefinitionId,
      scopeType: input.scopeType,
      projectId: input.projectId ?? null,
    });
    if (raced) {
      return {
        assignment: mapAssignment(raced),
        created: false,
      };
    }
  }

  if (error || !data) {
    throw new HttpError(
      409,
      "reviewer_access_assignment_conflict",
      "Unable to create reviewer access assignment.",
    );
  }

  return {
    assignment: mapAssignment(data as RoleAssignmentRow),
    created: true,
  };
}

async function revokeReviewerAccess(input: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  targetUserId: string;
  scopeType: "tenant" | "project";
  projectId?: string | null;
}) {
  await assertTenantMemberManager({
    supabase: input.supabase,
    tenantId: input.tenantId,
    userId: input.actorUserId,
  });
  await loadReviewerMember({
    supabase: input.supabase,
    tenantId: input.tenantId,
    userId: input.targetUserId,
  });

  if (input.scopeType === "project") {
    await assertProjectInTenant({
      supabase: input.supabase,
      tenantId: input.tenantId,
      projectId: input.projectId ?? "",
    });
  }

  const admin = createServiceRoleClient();
  const roleDefinitionId = await loadSystemReviewerRoleDefinitionId(admin);
  const existing = await findActiveAssignment({
    supabase: admin,
    tenantId: input.tenantId,
    userId: input.targetUserId,
    roleDefinitionId,
    scopeType: input.scopeType,
    projectId: input.projectId ?? null,
  });

  if (!existing) {
    return {
      ok: true,
      revoked: false,
    };
  }

  const now = new Date().toISOString();
  const { error } = await admin
    .from("role_assignments")
    .update({
      revoked_at: now,
      revoked_by: input.actorUserId,
    })
    .eq("id", existing.id)
    .is("revoked_at", null);

  if (error) {
    throw new HttpError(500, "reviewer_access_revoke_failed", "Unable to revoke reviewer access.");
  }

  return {
    ok: true,
    revoked: true,
  };
}

export async function grantTenantWideReviewerAccess(input: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  targetUserId: string;
}) {
  return grantReviewerAccess({
    ...input,
    scopeType: "tenant",
  });
}

export async function revokeTenantWideReviewerAccess(input: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  targetUserId: string;
}) {
  return revokeReviewerAccess({
    ...input,
    scopeType: "tenant",
  });
}

export async function grantProjectReviewerAccess(input: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  targetUserId: string;
  projectId: string;
}) {
  return grantReviewerAccess({
    ...input,
    scopeType: "project",
  });
}

export async function revokeProjectReviewerAccess(input: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  targetUserId: string;
  projectId: string;
}) {
  return revokeReviewerAccess({
    ...input,
    scopeType: "project",
  });
}

export async function revokeActiveReviewerAssignmentsForMember(input: {
  tenantId: string;
  actorUserId: string;
  targetUserId: string;
}) {
  const admin = createServiceRoleClient();
  const roleDefinitionId = await loadSystemReviewerRoleDefinitionId(admin);
  const now = new Date().toISOString();
  const { error } = await admin
    .from("role_assignments")
    .update({
      revoked_at: now,
      revoked_by: input.actorUserId,
    })
    .eq("tenant_id", input.tenantId)
    .eq("user_id", input.targetUserId)
    .eq("role_definition_id", roleDefinitionId)
    .is("revoked_at", null);

  if (error) {
    throw new HttpError(500, "reviewer_access_revoke_failed", "Unable to revoke reviewer access.");
  }
}
