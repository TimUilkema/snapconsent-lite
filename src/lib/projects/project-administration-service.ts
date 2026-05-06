import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import { loadAuthUserEmailMap } from "@/lib/supabase/auth-user-email-map";
import { roleHasCapability, type MembershipRole } from "@/lib/tenant/role-capabilities";
import {
  userHasAnyTenantCustomRoleCapabilities,
  userHasTenantCustomRoleCapability,
} from "@/lib/tenant/tenant-custom-role-capabilities";
import { resolveTenantMembership } from "@/lib/tenant/tenant-membership";

export type ProjectAdministrationAccess = {
  role: MembershipRole;
  canCreateProjects: boolean;
  canManageProjectWorkspaces: boolean;
  canViewProjectAdministration: boolean;
};

export type ProjectAdministrationProjectRow = {
  id: string;
  name: string;
  status: string;
  created_at: string;
};

export type ProjectAdministrationWorkspaceRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  workspace_kind: "default" | "photographer";
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

export type AssignableProjectPhotographer = {
  userId: string;
  email: string;
};

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

export async function resolveProjectAdministrationAccess(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  projectCreatedByUserId?: string | null;
  adminSupabase?: SupabaseClient;
}): Promise<ProjectAdministrationAccess> {
  const membership = await resolveTenantMembership(input.supabase, input.tenantId, input.userId);
  const fixedCanCreateProjects = roleHasCapability(membership.role, "projects.create");
  const fixedCanManageProjectWorkspaces = roleHasCapability(
    membership.role,
    "project_workspaces.manage",
  );

  const customCapabilities =
    fixedCanCreateProjects && fixedCanManageProjectWorkspaces
      ? new Set<"projects.create" | "project_workspaces.manage">()
      : await userHasAnyTenantCustomRoleCapabilities({
          supabase: input.supabase,
          tenantId: input.tenantId,
          userId: input.userId,
          capabilityKeys: ["projects.create", "project_workspaces.manage"],
          adminSupabase: input.adminSupabase,
        });

  const canCreateProjects =
    fixedCanCreateProjects || customCapabilities.has("projects.create");
  const canManageProjectWorkspaces =
    fixedCanManageProjectWorkspaces || customCapabilities.has("project_workspaces.manage");
  const canViewProjectAdministration =
    canManageProjectWorkspaces
    || (
      canCreateProjects
      && typeof input.projectCreatedByUserId === "string"
      && input.projectCreatedByUserId === input.userId
    );

  return {
    role: membership.role,
    canCreateProjects,
    canManageProjectWorkspaces,
    canViewProjectAdministration,
  };
}

export async function assertCanCreateProjectsAdministrationAction(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
) {
  const access = await resolveProjectAdministrationAccess({ supabase, tenantId, userId });
  if (!access.canCreateProjects) {
    throw new HttpError(
      403,
      "project_create_forbidden",
      "Only workspace owners, admins, and project creators can create projects.",
    );
  }

  return access;
}

export async function assertCanManageProjectWorkspacesAdministrationAction(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
  projectId: string,
) {
  const { data: project, error } = await supabase
    .from("projects")
    .select("id, created_by")
    .eq("tenant_id", tenantId)
    .eq("id", projectId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "project_lookup_failed", "Unable to load project.");
  }

  if (!project) {
    throw new HttpError(404, "project_not_found", "Project not found.");
  }

  const access = await resolveProjectAdministrationAccess({
    supabase,
    tenantId,
    userId,
    projectCreatedByUserId: (project as { created_by: string | null }).created_by,
  });
  if (!access.canManageProjectWorkspaces) {
    throw new HttpError(
      403,
      "project_workspace_manage_forbidden",
      "Only workspace owners, admins, and workspace managers can manage project staffing.",
    );
  }

  return access;
}

export async function listProjectAdministrationProjects(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
}) {
  const access = await resolveProjectAdministrationAccess(input);

  if (access.canManageProjectWorkspaces) {
    const { data, error } = await input.supabase
      .from("projects")
      .select("id, name, status, created_at")
      .eq("tenant_id", input.tenantId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new HttpError(500, "project_lookup_failed", "Unable to load projects.");
    }

    return {
      access,
      projects: (data as ProjectAdministrationProjectRow[] | null) ?? [],
    };
  }

  if (access.canCreateProjects) {
    const { data, error } = await input.supabase
      .from("projects")
      .select("id, name, status, created_at")
      .eq("tenant_id", input.tenantId)
      .eq("created_by", input.userId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new HttpError(500, "project_lookup_failed", "Unable to load projects.");
    }

    return {
      access,
      projects: (data as ProjectAdministrationProjectRow[] | null) ?? [],
    };
  }

  return {
    access,
    projects: [],
  };
}

export async function listProjectAdministrationWorkspaces(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  projectId: string;
}) {
  await assertCanManageProjectWorkspacesAdministrationAction(
    input.supabase,
    input.tenantId,
    input.userId,
    input.projectId,
  );

  const { data, error } = await input.supabase
    .from("project_workspaces")
    .select(
      "id, tenant_id, project_id, workspace_kind, photographer_user_id, name, created_by, created_at, workflow_state, workflow_state_changed_at, workflow_state_changed_by, handed_off_at, handed_off_by, validated_at, validated_by, needs_changes_at, needs_changes_by, reopened_at, reopened_by",
    )
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new HttpError(500, "workspace_lookup_failed", "Unable to load project workspaces.");
  }

  return (data as ProjectAdministrationWorkspaceRow[] | null) ?? [];
}

export async function listAssignablePhotographersForProjectAdministration(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  projectId: string;
  adminSupabase?: SupabaseClient;
}): Promise<AssignableProjectPhotographer[]> {
  await assertCanManageProjectWorkspacesAdministrationAction(
    input.supabase,
    input.tenantId,
    input.userId,
    input.projectId,
  );

  const admin = input.adminSupabase ?? createServiceRoleClient();
  const { data: photographerMemberships, error: photographerMembershipsError } = await admin
    .from("memberships")
    .select("user_id")
    .eq("tenant_id", input.tenantId)
    .eq("role", "photographer")
    .order("created_at", { ascending: true });

  if (photographerMembershipsError) {
    throw new HttpError(500, "photographer_lookup_failed", "Unable to load photographers.");
  }

  const photographerUserIds = ((photographerMemberships ?? []) as Array<{ user_id: string }>).map(
    (membership) => membership.user_id,
  );
  if (photographerUserIds.length === 0) {
    return [];
  }

  const emailByUserId = await loadAuthUserEmailMap(admin, photographerUserIds, {
    errorCode: "photographer_lookup_failed",
    errorMessage: "Unable to load photographers.",
  });

  return photographerUserIds.map((photographerUserId) => ({
    userId: photographerUserId,
    email: emailByUserId.get(photographerUserId) ?? "unknown@email",
  }));
}

export async function userHasProjectAdministrationCapability(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  capabilityKey: "projects.create" | "project_workspaces.manage";
}) {
  return userHasTenantCustomRoleCapability({
    supabase: input.supabase,
    tenantId: input.tenantId,
    userId: input.userId,
    capabilityKey: input.capabilityKey,
  });
}
