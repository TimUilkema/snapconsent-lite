import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import {
  resolveEffectiveProjectCapabilities,
  resolveEffectiveWorkspaceCapabilities,
} from "@/lib/tenant/effective-permissions";
import {
  resolveTenantMembership,
  type AccessibleProjectWorkspace,
} from "@/lib/tenant/permissions";
import type { TenantCapability } from "@/lib/tenant/role-capabilities";

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

const WORKSPACE_OPERATIONAL_CAPABILITIES: TenantCapability[] = [
  "capture.workspace",
  "capture.create_one_off_invites",
  "capture.create_recurring_project_consent_requests",
  "capture.upload_assets",
  "review.workspace",
  "review.initiate_consent_upgrade_requests",
  "workflow.reopen_workspace_for_correction",
  "correction.review",
  "correction.consent_intake",
  "correction.media_intake",
];

const PROJECT_WORKFLOW_VISIBILITY_CAPABILITIES: TenantCapability[] = [
  "workflow.finalize_project",
  "workflow.start_project_correction",
];

function createServiceRoleClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new HttpError(500, "supabase_admin_unavailable", "Supabase admin client is not configured.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

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
  const membership = await resolveTenantMembership(supabase, tenantId, userId);
  const adminSupabase = createServiceRoleClient();
  const { data, error } = await adminSupabase
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

  const allWorkspaces = (data as AccessibleProjectWorkspace[] | null) ?? [];
  const projectCapabilities = await resolveEffectiveProjectCapabilities({
    supabase,
    adminSupabase,
    tenantId,
    userId,
    projectId,
  });
  const projectCapabilitySet = new Set(projectCapabilities.capabilityKeys);
  const grantsProjectWorkflowVisibility = PROJECT_WORKFLOW_VISIBILITY_CAPABILITIES.some((capability) =>
    projectCapabilitySet.has(capability),
  );
  const visibleWorkspaces: AccessibleProjectWorkspace[] = [];

  for (const workspace of allWorkspaces) {
    if (grantsProjectWorkflowVisibility) {
      visibleWorkspaces.push(workspace);
      continue;
    }

    const workspaceCapabilities = await resolveEffectiveWorkspaceCapabilities({
      supabase,
      adminSupabase,
      tenantId,
      userId,
      projectId,
      workspaceId: workspace.id,
    });
    const workspaceCapabilitySet = new Set(workspaceCapabilities.capabilityKeys);
    const grantsWorkspaceAccess = WORKSPACE_OPERATIONAL_CAPABILITIES.some((capability) =>
      workspaceCapabilitySet.has(capability),
    );

    if (grantsWorkspaceAccess) {
      visibleWorkspaces.push(workspace);
    }
  }

  if (visibleWorkspaces.length === 0 && !grantsProjectWorkflowVisibility) {
    throw new HttpError(404, "project_not_found", "Project not found.");
  }

  return {
    role: membership.role,
    workspaces: visibleWorkspaces,
  };
}

export async function resolveProjectWorkspaceSelection(
  input: ResolveProjectWorkspaceSelectionInput,
): Promise<ProjectWorkspaceSelection> {
  const { role, workspaces } = await listVisibleProjectWorkspaces(
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
