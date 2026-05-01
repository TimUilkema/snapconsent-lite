import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import {
  assertCanCreateProjectsAdministrationAction,
  assertCanManageProjectWorkspacesAdministrationAction,
} from "@/lib/projects/project-administration-service";
import {
  resolveEffectiveReviewerAccessForProject,
  resolveEffectiveReviewerAccessForTenant,
  type ReviewAccessSource,
} from "@/lib/tenant/reviewer-access-service";
import { roleHasCapability } from "@/lib/tenant/role-capabilities";
import type { MembershipRole } from "@/lib/tenant/role-capabilities";
import { resolveTenantMembership } from "@/lib/tenant/tenant-membership";

export {
  MANAGEABLE_MEMBERSHIP_ROLES,
  MEMBERSHIP_ROLES,
} from "@/lib/tenant/role-capabilities";
export type {
  ManageableMembershipRole,
  MembershipRole,
  TenantCapability,
} from "@/lib/tenant/role-capabilities";
export {
  getTenantMembershipRole,
  resolveTenantMembership,
} from "@/lib/tenant/tenant-membership";

export type TenantPermissions = {
  role: MembershipRole;
  canManageMembers: boolean;
  canManageTemplates: boolean;
  canManageProfiles: boolean;
  canCreateProjects: boolean;
  canCaptureProjects: boolean;
  canReviewProjects: boolean;
  isReviewerEligible: boolean;
  hasTenantWideReviewAccess: boolean;
};

export type ProjectPermissions = TenantPermissions & {
  canCreateOneOffInvites: boolean;
  canCreateRecurringProjectConsentRequests: boolean;
  canUploadAssets: boolean;
  canInitiateConsentUpgradeRequests: boolean;
  canReviewSelectedProject: boolean;
  reviewAccessSource: ReviewAccessSource;
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
  return {
    role,
    canManageMembers: roleHasCapability(role, "organization_users.manage"),
    canManageTemplates: roleHasCapability(role, "templates.manage"),
    canManageProfiles: roleHasCapability(role, "profiles.manage"),
    canCreateProjects: roleHasCapability(role, "projects.create"),
    canCaptureProjects: roleHasCapability(role, "capture.workspace"),
    canReviewProjects: roleHasCapability(role, "review.workspace"),
    isReviewerEligible: role === "reviewer",
    hasTenantWideReviewAccess: false,
  };
}

export function deriveProjectPermissionsFromRole(role: MembershipRole): ProjectPermissions {
  const tenantPermissions = deriveTenantPermissionsFromRole(role);

  return {
    ...tenantPermissions,
    canCreateOneOffInvites: roleHasCapability(role, "capture.create_one_off_invites"),
    canCreateRecurringProjectConsentRequests: roleHasCapability(
      role,
      "capture.create_recurring_project_consent_requests",
    ),
    canUploadAssets: roleHasCapability(role, "capture.upload_assets"),
    canInitiateConsentUpgradeRequests: roleHasCapability(
      role,
      "review.initiate_consent_upgrade_requests",
    ),
    canReviewSelectedProject: tenantPermissions.canReviewProjects,
    reviewAccessSource:
      tenantPermissions.canReviewProjects && role !== "reviewer" ? "owner_admin" : "none",
  };
}

export async function resolveTenantPermissions(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
): Promise<TenantPermissions> {
  const membership = await resolveTenantMembership(supabase, tenantId, userId);
  const permissions = deriveTenantPermissionsFromRole(membership.role);

  if (membership.role === "owner" || membership.role === "admin") {
    return {
      ...permissions,
      canReviewProjects: true,
      isReviewerEligible: false,
      hasTenantWideReviewAccess: false,
    };
  }

  if (membership.role !== "reviewer") {
    return {
      ...permissions,
      canReviewProjects: false,
      isReviewerEligible: false,
      hasTenantWideReviewAccess: false,
    };
  }

  const reviewerAccess = await resolveEffectiveReviewerAccessForTenant({
    supabase,
    tenantId,
    userId,
  });

  return {
    ...permissions,
    canReviewProjects: reviewerAccess.hasTenantWideReviewAccess,
    isReviewerEligible: true,
    hasTenantWideReviewAccess: reviewerAccess.hasTenantWideReviewAccess,
  };
}

export async function resolveProjectPermissions(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
  projectId?: string,
): Promise<ProjectPermissions> {
  const membership = await resolveTenantMembership(supabase, tenantId, userId);
  const permissions = deriveProjectPermissionsFromRole(membership.role);

  if (membership.role === "owner" || membership.role === "admin") {
    return {
      ...permissions,
      canReviewProjects: true,
      isReviewerEligible: false,
      hasTenantWideReviewAccess: false,
      canInitiateConsentUpgradeRequests: true,
      canReviewSelectedProject: true,
      reviewAccessSource: "owner_admin",
    };
  }

  if (membership.role !== "reviewer") {
    return {
      ...permissions,
      canReviewProjects: false,
      isReviewerEligible: false,
      hasTenantWideReviewAccess: false,
      canInitiateConsentUpgradeRequests: false,
      canReviewSelectedProject: false,
      reviewAccessSource: "none",
    };
  }

  if (!projectId) {
    const reviewerAccess = await resolveEffectiveReviewerAccessForTenant({
      supabase,
      tenantId,
      userId,
    });

    return {
      ...permissions,
      canReviewProjects: reviewerAccess.hasTenantWideReviewAccess,
      isReviewerEligible: true,
      hasTenantWideReviewAccess: reviewerAccess.hasTenantWideReviewAccess,
      canInitiateConsentUpgradeRequests: reviewerAccess.hasTenantWideReviewAccess,
      canReviewSelectedProject: reviewerAccess.hasTenantWideReviewAccess,
      reviewAccessSource: reviewerAccess.hasTenantWideReviewAccess ? "tenant_assignment" : "none",
    };
  }

  const reviewerAccess = await resolveEffectiveReviewerAccessForProject({
    supabase,
    tenantId,
    userId,
    projectId,
  });

  return {
    ...permissions,
    canReviewProjects: reviewerAccess.canReviewProject,
    isReviewerEligible: true,
    hasTenantWideReviewAccess: reviewerAccess.hasTenantWideReviewAccess,
    canInitiateConsentUpgradeRequests: reviewerAccess.canReviewProject,
    canReviewSelectedProject: reviewerAccess.canReviewProject,
    reviewAccessSource: reviewerAccess.reviewAccessSource,
  };
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

  if (membership.role === "reviewer") {
    const reviewerAccess = await resolveEffectiveReviewerAccessForProject({
      supabase,
      tenantId,
      userId,
      projectId,
    });

    if (!reviewerAccess.canReviewProject) {
      throw new HttpError(404, "project_not_found", "Project not found.");
    }
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

  if (membership.role === "reviewer") {
    const reviewerAccess = await resolveEffectiveReviewerAccessForProject({
      supabase,
      tenantId,
      userId,
      projectId,
    });

    if (!reviewerAccess.canReviewProject) {
      throw new HttpError(404, "workspace_not_found", "Project workspace not found.");
    }
  }

  const projectPermissions = await resolveProjectPermissions(supabase, tenantId, userId, projectId);

  return {
    ...projectPermissions,
    projectId,
    workspace,
    canManageWorkspaces: roleHasCapability(membership.role, "project_workspaces.manage"),
  };
}

export async function assertCanCreateProjectsAction(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
) {
  return assertCanCreateProjectsAdministrationAction(supabase, tenantId, userId);
}

export async function assertCanManageProjectWorkspacesAction(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
  projectId: string,
) {
  return assertCanManageProjectWorkspacesAdministrationAction(
    supabase,
    tenantId,
    userId,
    projectId,
  );
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
  projectId: string,
) {
  const permissions = await resolveProjectPermissions(supabase, tenantId, userId, projectId);
  if (!permissions.canReviewSelectedProject) {
    throw new HttpError(
      403,
      "project_review_forbidden",
      "Only workspace owners, admins, and assigned reviewers can perform review actions.",
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

  if (!permissions.canReviewSelectedProject) {
    throw new HttpError(
      403,
      "workspace_review_forbidden",
      "Only workspace owners, admins, and assigned reviewers can perform review actions.",
    );
  }

  return permissions;
}
