import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import {
  resolveAccessibleProjectWorkspaces,
  resolveTenantMembership,
  type AccessibleProjectWorkspace,
} from "@/lib/tenant/permissions";

type CreatePhotographerWorkspaceInput = {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  createdByUserId: string;
  photographerUserId: string;
  name: string;
};

type ResolveProjectWorkspaceSelectionInput = {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  userId: string;
  requestedWorkspaceId?: string | null;
};

type ProjectWorkspaceSelection = {
  role: Awaited<ReturnType<typeof resolveTenantMembership>>["role"];
  workspaces: AccessibleProjectWorkspace[];
  selectedWorkspace: AccessibleProjectWorkspace | null;
  requiresExplicitSelection: boolean;
};

function normalizeWorkspaceName(value: string) {
  const normalized = value.trim();
  if (normalized.length < 2 || normalized.length > 120) {
    throw new HttpError(
      400,
      "invalid_workspace_name",
      "Workspace name must be between 2 and 120 characters.",
    );
  }

  return normalized;
}

export async function listVisibleProjectWorkspaces(
  supabase: SupabaseClient,
  tenantId: string,
  userId: string,
  projectId: string,
) {
  return resolveAccessibleProjectWorkspaces(supabase, tenantId, userId, projectId);
}

export async function resolveProjectWorkspaceSelection(
  input: ResolveProjectWorkspaceSelectionInput,
): Promise<ProjectWorkspaceSelection> {
  const { role, workspaces } = await resolveAccessibleProjectWorkspaces(
    input.supabase,
    input.tenantId,
    input.userId,
    input.projectId,
  );
  const requestedWorkspaceId = String(input.requestedWorkspaceId ?? "").trim();

  if (requestedWorkspaceId) {
    const selectedWorkspace =
      workspaces.find((workspace) => workspace.id === requestedWorkspaceId) ?? null;

    if (!selectedWorkspace) {
      throw new HttpError(404, "workspace_not_found", "Project workspace not found.");
    }

    return {
      role,
      workspaces,
      selectedWorkspace,
      requiresExplicitSelection: false,
    };
  }

  if (workspaces.length <= 1) {
    return {
      role,
      workspaces,
      selectedWorkspace: workspaces[0] ?? null,
      requiresExplicitSelection: false,
    };
  }

  return {
    role,
    workspaces,
    selectedWorkspace: null,
    requiresExplicitSelection: true,
  };
}

export async function createPhotographerWorkspace(
  input: CreatePhotographerWorkspaceInput,
) {
  const name = normalizeWorkspaceName(input.name);

  const { data: existingWorkspace, error: existingWorkspaceError } = await input.supabase
    .from("project_workspaces")
    .select(
      "id, tenant_id, project_id, workspace_kind, photographer_user_id, name, created_by, created_at, workflow_state, workflow_state_changed_at, workflow_state_changed_by, handed_off_at, handed_off_by, validated_at, validated_by, needs_changes_at, needs_changes_by, reopened_at, reopened_by",
    )
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("photographer_user_id", input.photographerUserId)
    .maybeSingle();

  if (existingWorkspaceError) {
    throw new HttpError(500, "workspace_lookup_failed", "Unable to load project workspaces.");
  }

  if (existingWorkspace) {
    return existingWorkspace as AccessibleProjectWorkspace;
  }

  const { data: createdWorkspace, error: createError } = await input.supabase
    .from("project_workspaces")
    .insert({
      tenant_id: input.tenantId,
      project_id: input.projectId,
      workspace_kind: "photographer",
      photographer_user_id: input.photographerUserId,
      name,
      created_by: input.createdByUserId,
    })
    .select(
      "id, tenant_id, project_id, workspace_kind, photographer_user_id, name, created_by, created_at, workflow_state, workflow_state_changed_at, workflow_state_changed_by, handed_off_at, handed_off_by, validated_at, validated_by, needs_changes_at, needs_changes_by, reopened_at, reopened_by",
    )
    .single();

  if (!createError && createdWorkspace) {
    return createdWorkspace as AccessibleProjectWorkspace;
  }

  const { data: conflictWorkspace, error: conflictLookupError } = await input.supabase
    .from("project_workspaces")
    .select(
      "id, tenant_id, project_id, workspace_kind, photographer_user_id, name, created_by, created_at, workflow_state, workflow_state_changed_at, workflow_state_changed_by, handed_off_at, handed_off_by, validated_at, validated_by, needs_changes_at, needs_changes_by, reopened_at, reopened_by",
    )
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq("photographer_user_id", input.photographerUserId)
    .maybeSingle();

  if (conflictLookupError) {
    throw new HttpError(500, "workspace_create_failed", "Unable to create project workspace.");
  }

  if (!conflictWorkspace) {
    throw new HttpError(500, "workspace_create_failed", "Unable to create project workspace.");
  }

  return conflictWorkspace as AccessibleProjectWorkspace;
}
