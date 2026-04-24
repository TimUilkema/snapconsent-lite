import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import {
  assertProjectWorkflowMutable,
  assertWorkspaceCaptureMutationAllowed,
  assertWorkspaceReviewMutationAllowed,
} from "@/lib/projects/project-workflow-service";
import { resolveProjectWorkspaceSelection } from "@/lib/projects/project-workspaces-service";
import {
  assertCanCaptureWorkspaceAction,
  assertCanReviewWorkspaceAction,
  type AccessibleProjectWorkspace,
  type WorkspacePermissions,
} from "@/lib/tenant/permissions";

type ResolveWorkspaceSelectionInput = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  projectId: string;
  requestedWorkspaceId?: string | null;
};

type WorkspaceScopedTable =
  | "assets"
  | "consents"
  | "face_review_session_items"
  | "face_review_sessions"
  | "project_consent_upgrade_requests"
  | "project_profile_participants"
  | "recurring_profile_consent_requests"
  | "recurring_profile_consents"
  | "subject_invites";

type WorkspaceScopedRowLookupInput = {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  table: WorkspaceScopedTable;
  rowId: string;
  rowIdColumn?: string;
  notFoundCode: string;
  notFoundMessage: string;
};

type WorkspaceScopedRow = {
  id: string;
  workspace_id: string;
};

export function normalizeRequestedWorkspaceId(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

export function readRequestedWorkspaceIdFromUrl(request: Request) {
  return normalizeRequestedWorkspaceId(new URL(request.url).searchParams.get("workspaceId"));
}

export async function resolveSelectedWorkspaceForRequest(
  input: ResolveWorkspaceSelectionInput,
): Promise<AccessibleProjectWorkspace> {
  const selection = await resolveProjectWorkspaceSelection({
    supabase: input.supabase,
    tenantId: input.tenantId,
    projectId: input.projectId,
    userId: input.userId,
    requestedWorkspaceId: input.requestedWorkspaceId,
  });

  if (selection.requiresExplicitSelection || !selection.selectedWorkspace) {
    throw new HttpError(
      400,
      "workspace_required",
      "Select a project workspace before continuing.",
    );
  }

  return selection.selectedWorkspace;
}

export async function requireWorkspaceCaptureAccessForRequest(
  input: ResolveWorkspaceSelectionInput,
) {
  const workspace = await resolveSelectedWorkspaceForRequest(input);
  const permissions = await assertCanCaptureWorkspaceAction(
    input.supabase,
    input.tenantId,
    input.userId,
    input.projectId,
    workspace.id,
  );

  return {
    workspace,
    permissions,
  };
}

export async function requireWorkspaceReviewAccessForRequest(
  input: ResolveWorkspaceSelectionInput,
) {
  const workspace = await resolveSelectedWorkspaceForRequest(input);
  const permissions = await assertCanReviewWorkspaceAction(
    input.supabase,
    input.tenantId,
    input.userId,
    input.projectId,
    workspace.id,
  );

  return {
    workspace,
    permissions,
  };
}

export async function requireWorkspaceCaptureMutationAccessForRequest(
  input: ResolveWorkspaceSelectionInput,
) {
  const access = await requireWorkspaceCaptureAccessForRequest(input);
  const project = await assertProjectWorkflowMutable(input.supabase, input.tenantId, input.projectId);
  assertWorkspaceCaptureMutationAllowed({
    project,
    workspace: access.workspace,
  });

  return {
    ...access,
    project,
  };
}

export async function requireWorkspaceReviewMutationAccessForRequest(
  input: ResolveWorkspaceSelectionInput,
) {
  const access = await requireWorkspaceReviewAccessForRequest(input);
  const project = await assertProjectWorkflowMutable(input.supabase, input.tenantId, input.projectId);
  assertWorkspaceReviewMutationAllowed({
    project,
    workspace: access.workspace,
  });

  return {
    ...access,
    project,
  };
}

export async function loadWorkspaceScopedRow(
  input: WorkspaceScopedRowLookupInput,
): Promise<WorkspaceScopedRow> {
  const { data, error } = await input.supabase
    .from(input.table)
    .select(`${input.rowIdColumn ?? "id"}, workspace_id`)
    .eq("tenant_id", input.tenantId)
    .eq("project_id", input.projectId)
    .eq(input.rowIdColumn ?? "id", input.rowId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "workspace_scope_lookup_failed", "Unable to validate workspace access.");
  }

  if (!data) {
    throw new HttpError(404, input.notFoundCode, input.notFoundMessage);
  }

  const workspaceId = normalizeRequestedWorkspaceId(
    (data as Record<string, unknown>).workspace_id,
  );
  if (!workspaceId) {
    throw new HttpError(
      409,
      "workspace_scope_missing",
      "This project record is missing a workspace assignment.",
    );
  }

  return {
    id: String((data as Record<string, unknown>)[input.rowIdColumn ?? "id"] ?? input.rowId),
    workspace_id: workspaceId,
  };
}

export function assertWorkspaceScopedRowMatchesWorkspace(
  row: WorkspaceScopedRow,
  workspaceId: string,
  notFoundCode: string,
  notFoundMessage: string,
) {
  if (row.workspace_id !== workspaceId) {
    throw new HttpError(404, notFoundCode, notFoundMessage);
  }
}

export async function requireWorkspaceCaptureAccessForRow(
  input: WorkspaceScopedRowLookupInput & {
    userId: string;
  },
): Promise<WorkspacePermissions> {
  const row = await loadWorkspaceScopedRow(input);
  return assertCanCaptureWorkspaceAction(
    input.supabase,
    input.tenantId,
    input.userId,
    input.projectId,
    row.workspace_id,
  );
}

export async function requireWorkspaceReviewAccessForRow(
  input: WorkspaceScopedRowLookupInput & {
    userId: string;
  },
): Promise<WorkspacePermissions> {
  const row = await loadWorkspaceScopedRow(input);
  return assertCanReviewWorkspaceAction(
    input.supabase,
    input.tenantId,
    input.userId,
    input.projectId,
    row.workspace_id,
  );
}

export async function requireWorkspaceCaptureMutationAccessForRow(
  input: WorkspaceScopedRowLookupInput & {
    userId: string;
  },
) {
  const row = await loadWorkspaceScopedRow(input);
  const permissions = await assertCanCaptureWorkspaceAction(
    input.supabase,
    input.tenantId,
    input.userId,
    input.projectId,
    row.workspace_id,
  );
  const project = await assertProjectWorkflowMutable(input.supabase, input.tenantId, input.projectId);
  assertWorkspaceCaptureMutationAllowed({
    project,
    workspace: permissions.workspace,
  });

  return {
    permissions,
    project,
    row,
  };
}

export async function requireWorkspaceReviewMutationAccessForRow(
  input: WorkspaceScopedRowLookupInput & {
    userId: string;
    allowValidated?: boolean;
  },
) {
  const row = await loadWorkspaceScopedRow(input);
  const permissions = await assertCanReviewWorkspaceAction(
    input.supabase,
    input.tenantId,
    input.userId,
    input.projectId,
    row.workspace_id,
  );
  const project = await assertProjectWorkflowMutable(input.supabase, input.tenantId, input.projectId);
  assertWorkspaceReviewMutationAllowed({
    project,
    workspace: permissions.workspace,
    allowValidated: input.allowValidated,
  });

  return {
    permissions,
    project,
    row,
  };
}
