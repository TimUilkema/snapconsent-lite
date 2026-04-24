import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";

export const MEMBERSHIP_ROLES = ["owner", "admin", "reviewer", "photographer"] as const;
export const MANAGEABLE_MEMBERSHIP_ROLES = ["admin", "reviewer", "photographer"] as const;

export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];
export type ManageableMembershipRole = (typeof MANAGEABLE_MEMBERSHIP_ROLES)[number];

export type TenantPermissions = {
  role: MembershipRole;
  canManageMembers: boolean;
  canManageTemplates: boolean;
  canManageProfiles: boolean;
  canCreateProjects: boolean;
  canCaptureProjects: boolean;
  canReviewProjects: boolean;
};

export type ProjectPermissions = TenantPermissions & {
  canCreateOneOffInvites: boolean;
  canCreateRecurringProjectConsentRequests: boolean;
  canUploadAssets: boolean;
  canInitiateConsentUpgradeRequests: boolean;
};

export type ProjectWorkspaceKind = "default" | "photographer";

export type AccessibleProjectWorkspace = {
  id: string;
  tenant_id: string;
  project_id: string;
  workspace_kind: ProjectWorkspaceKind;
  photographer_user_id: string | null;
  name: string;
  created_by: string;
  created_at: string;
  workflow_state: "active" | "handed_off" | "needs_changes" | "validated";
  workflow_state_changed_at: string;
  workflow_state_changed_by: string | null;
  handed_off_at: string | null;
  handed_off_by: string | null;
  validated_at: string | null;
  validated_by: string | null;
  needs_changes_at: string | null;
  needs_changes_by: string | null;
  reopened_at: string | null;
  reopened_by: string | null;
};

export type WorkspacePermissions = ProjectPermissions & {
  projectId: string;
  workspace: AccessibleProjectWorkspace;
  canManageWorkspaces: boolean;
};

export function deriveTenantPermissionsFromRole(role: MembershipRole): TenantPermissions {
  const canManageMembers = role === "owner" || role === "admin";
  const canManageTemplates = canManageMembers;
  const canManageProfiles = canManageMembers;
  const canCreateProjects = role === "owner" || role === "admin";
  const canCaptureProjects = role === "owner" || role === "admin" || role === "photographer";
  const canReviewProjects = role === "owner" || role === "admin" || role === "reviewer";

  return {
    role,
    canManageMembers,
    canManageTemplates,
    canManageProfiles,
    canCreateProjects,
    canCaptureProjects,
    canReviewProjects,
  };
}

export function deriveProjectPermissionsFromRole(role: MembershipRole): ProjectPermissions {
  const tenantPermissions = deriveTenantPermissionsFromRole(role);

  return {
    ...tenantPermissions,
    canCreateOneOffInvites: tenantPermissions.canCaptureProjects,
    canCreateRecurringProjectConsentRequests: tenantPermissions.canCaptureProjects,
    canUploadAssets: tenantPermissions.canCaptureProjects,
    canInitiateConsentUpgradeRequests: tenantPermissions.canReviewProjects,
  };
}

export async function getTenantMembershipRole(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
): Promise<MembershipRole | null> {
  const { data, error } = await supabase
    .from("memberships")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "membership_lookup_failed", "Unable to validate workspace access.");
  }

  return (data?.role as MembershipRole | undefined) ?? null;
}

export async function resolveTenantMembership(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
) {
  const role = await getTenantMembershipRole(supabase, tenantId, userId);
  if (!role) {
    throw new HttpError(403, "no_tenant_membership", "Tenant membership is required.");
  }

  return {
    role,
  };
}

export async function resolveTenantPermissions(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
): Promise<TenantPermissions> {
  const membership = await resolveTenantMembership(supabase, tenantId, userId);
  return deriveTenantPermissionsFromRole(membership.role);
}

export async function resolveProjectPermissions(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
): Promise<ProjectPermissions> {
  const membership = await resolveTenantMembership(supabase, tenantId, userId);
  return deriveProjectPermissionsFromRole(membership.role);
}

async function listProjectWorkspaces(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
) {
  const { data, error } = await supabase
    .from("project_workspaces")
    .select(
      "id, tenant_id, project_id, workspace_kind, photographer_user_id, name, created_by, created_at, workflow_state, workflow_state_changed_at, workflow_state_changed_by, handed_off_at, handed_off_by, validated_at, validated_by, needs_changes_at, needs_changes_by, reopened_at, reopened_by",
    )
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new HttpError(500, "workspace_lookup_failed", "Unable to load project workspaces.");
  }

  return (data as AccessibleProjectWorkspace[] | null) ?? [];
}

export async function resolveAccessibleProjectWorkspaces(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
  projectId: string,
) {
  const membership = await resolveTenantMembership(supabase, tenantId, userId);
  const workspaces = await listProjectWorkspaces(supabase, tenantId, projectId);

  if (membership.role === "photographer") {
    const visibleWorkspaces = workspaces.filter((workspace) => workspace.photographer_user_id === userId);

    if (visibleWorkspaces.length === 0) {
      throw new HttpError(404, "project_not_found", "Project not found.");
    }

    return {
      role: membership.role,
      workspaces: visibleWorkspaces,
    };
  }

  return {
    role: membership.role,
    workspaces,
  };
}

export async function resolveWorkspacePermissions(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
  projectId: string,
  workspaceId: string,
): Promise<WorkspacePermissions> {
  const membership = await resolveTenantMembership(supabase, tenantId, userId);
  const workspaces = await listProjectWorkspaces(supabase, tenantId, projectId);
  const workspace = workspaces.find((candidate) => candidate.id === workspaceId);

  if (!workspace) {
    throw new HttpError(404, "workspace_not_found", "Project workspace not found.");
  }

  if (membership.role === "photographer" && workspace.photographer_user_id !== userId) {
    throw new HttpError(404, "workspace_not_found", "Project workspace not found.");
  }

  const projectPermissions = deriveProjectPermissionsFromRole(membership.role);

  return {
    ...projectPermissions,
    projectId,
    workspace,
    canManageWorkspaces: membership.role === "owner" || membership.role === "admin",
  };
}

export async function assertCanCreateProjectsAction(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
) {
  const permissions = await resolveTenantPermissions(supabase, tenantId, userId);
  if (!permissions.canCreateProjects) {
    throw new HttpError(
      403,
      "project_create_forbidden",
      "Only workspace owners and admins can create projects.",
    );
  }

  return permissions;
}

export async function assertCanManageProjectWorkspacesAction(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
  projectId: string,
) {
  const workspacePermissions = await resolveAccessibleProjectWorkspaces(
    supabase,
    tenantId,
    userId,
    projectId,
  );
  const projectPermissions = deriveProjectPermissionsFromRole(workspacePermissions.role);
  const canManageWorkspaces =
    workspacePermissions.role === "owner" || workspacePermissions.role === "admin";

  if (!canManageWorkspaces) {
    throw new HttpError(
      403,
      "project_workspace_manage_forbidden",
      "Only workspace owners and admins can manage project staffing.",
    );
  }

  return {
    ...projectPermissions,
    canManageWorkspaces,
  };
}

export async function assertCanCaptureProjectAction(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
) {
  const permissions = await resolveProjectPermissions(supabase, tenantId, userId);
  if (!permissions.canCaptureProjects) {
    throw new HttpError(
      403,
      "project_capture_forbidden",
      "Only workspace owners, admins, and photographers can perform capture actions.",
    );
  }

  return permissions;
}

export async function assertCanReviewProjectAction(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
) {
  const permissions = await resolveProjectPermissions(supabase, tenantId, userId);
  if (!permissions.canReviewProjects) {
    throw new HttpError(
      403,
      "project_review_forbidden",
      "Only workspace owners, admins, and reviewers can perform review actions.",
    );
  }

  return permissions;
}

export async function assertCanCaptureWorkspaceAction(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
  projectId: string,
  workspaceId: string,
) {
  const permissions = await resolveWorkspacePermissions(
    supabase,
    tenantId,
    userId,
    projectId,
    workspaceId,
  );

  if (!permissions.canCaptureProjects) {
    throw new HttpError(
      403,
      "workspace_capture_forbidden",
      "Only workspace owners, admins, and assigned photographers can perform capture actions.",
    );
  }

  return permissions;
}

export async function assertCanReviewWorkspaceAction(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
  projectId: string,
  workspaceId: string,
) {
  const permissions = await resolveWorkspacePermissions(
    supabase,
    tenantId,
    userId,
    projectId,
    workspaceId,
  );

  if (!permissions.canReviewProjects) {
    throw new HttpError(
      403,
      "workspace_review_forbidden",
      "Only workspace owners, admins, and reviewers can perform review actions.",
    );
  }

  return permissions;
}
