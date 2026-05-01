import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import {
  assertProjectWorkflowMutable,
  assertWorkspaceCorrectionConsentIntakeAllowed,
  assertWorkspaceCorrectionMediaIntakeAllowed,
  assertWorkspaceCorrectionReviewMutationAllowed,
  assertWorkspaceCaptureMutationAllowed,
  assertWorkspaceReviewMutationAllowed,
} from "@/lib/projects/project-workflow-service";
import { resolveProjectWorkspaceSelection } from "@/lib/projects/project-workspaces-service";
import {
  assertEffectiveWorkspaceCapability,
  resolveEffectiveWorkspaceCapabilities,
  type EffectiveCapabilityCheck,
} from "@/lib/tenant/effective-permissions";
import {
  type AccessibleProjectWorkspace,
  resolveTenantPermissions,
  type WorkspacePermissions,
} from "@/lib/tenant/permissions";
import type { TenantCapability } from "@/lib/tenant/role-capabilities";

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

type WorkspaceCapabilityInput = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  projectId: string;
  workspaceId: string;
  capabilityKey: TenantCapability;
  errorCode: string;
  errorMessage: string;
};

const WORKSPACE_OPERATIONAL_READ_CAPABILITIES: TenantCapability[] = [
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

function isCaptureCapability(capabilityKey: TenantCapability) {
  return capabilityKey.startsWith("capture.");
}

function isReviewLikeCapability(capabilityKey: TenantCapability) {
  return (
    capabilityKey.startsWith("review.") ||
    capabilityKey.startsWith("workflow.") ||
    capabilityKey.startsWith("correction.")
  );
}

function rewriteEffectiveCapabilityDenial(error: unknown, code: string, message: string): never {
  if (
    error instanceof HttpError &&
    (error.code === "effective_capability_forbidden" ||
      error.code === "effective_capability_scope_forbidden")
  ) {
    throw new HttpError(403, code, message);
  }

  throw error;
}

async function buildWorkspacePermissionsForCapability(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  projectId: string;
  workspace: AccessibleProjectWorkspace;
  capabilityKey: TenantCapability;
}): Promise<WorkspacePermissions> {
  const tenantPermissions = await resolveTenantPermissions(
    input.supabase,
    input.tenantId,
    input.userId,
  );
  const grantsCapture = isCaptureCapability(input.capabilityKey);
  const grantsReviewLike = isReviewLikeCapability(input.capabilityKey);

  return {
    ...tenantPermissions,
    canCaptureProjects: tenantPermissions.canCaptureProjects || grantsCapture,
    canReviewProjects: tenantPermissions.canReviewProjects || grantsReviewLike,
    canCreateOneOffInvites:
      input.capabilityKey === "capture.create_one_off_invites" ||
      tenantPermissions.canCaptureProjects,
    canCreateRecurringProjectConsentRequests:
      input.capabilityKey === "capture.create_recurring_project_consent_requests" ||
      tenantPermissions.canCaptureProjects,
    canUploadAssets:
      input.capabilityKey === "capture.upload_assets" || tenantPermissions.canCaptureProjects,
    canInitiateConsentUpgradeRequests:
      input.capabilityKey === "review.initiate_consent_upgrade_requests" || grantsReviewLike,
    canReviewSelectedProject: tenantPermissions.canReviewProjects || grantsReviewLike,
    reviewAccessSource:
      tenantPermissions.canReviewProjects || grantsReviewLike ? "owner_admin" : "none",
    projectId: input.projectId,
    workspace: input.workspace,
    canManageWorkspaces: false,
  };
}

async function requireWorkspaceCapability(
  input: WorkspaceCapabilityInput,
): Promise<EffectiveCapabilityCheck> {
  try {
    return await assertEffectiveWorkspaceCapability({
      supabase: input.supabase,
      tenantId: input.tenantId,
      userId: input.userId,
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      capabilityKey: input.capabilityKey,
    });
  } catch (error) {
    rewriteEffectiveCapabilityDenial(error, input.errorCode, input.errorMessage);
  }
}

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

export async function requireWorkspaceOperationalReadAccessForRequest(
  input: ResolveWorkspaceSelectionInput,
) {
  const workspace = await resolveSelectedWorkspaceForRequest(input);
  const capabilities = await resolveEffectiveWorkspaceCapabilities({
    supabase: input.supabase,
    tenantId: input.tenantId,
    userId: input.userId,
    projectId: input.projectId,
    workspaceId: workspace.id,
  });
  const effectiveCapabilityKeys = new Set(capabilities.capabilityKeys);
  const canReadOperationalWorkspace = WORKSPACE_OPERATIONAL_READ_CAPABILITIES.some((capabilityKey) =>
    effectiveCapabilityKeys.has(capabilityKey),
  );

  if (!canReadOperationalWorkspace) {
    throw new HttpError(403, "workspace_read_forbidden", "Project workspace access is forbidden.");
  }

  return {
    workspace,
    capabilities,
  };
}

export async function requireWorkspaceCaptureAccessForRequest(
  input: ResolveWorkspaceSelectionInput & {
    capabilityKey?: TenantCapability;
  },
) {
  const workspace = await resolveSelectedWorkspaceForRequest(input);
  const capabilityKey = input.capabilityKey ?? "capture.workspace";
  await requireWorkspaceCapability({
    ...input,
    workspaceId: workspace.id,
    capabilityKey,
    errorCode: "workspace_capture_forbidden",
    errorMessage:
      "Only workspace owners, admins, and assigned photographers can perform capture actions.",
  });
  const permissions = await buildWorkspacePermissionsForCapability({
    ...input,
    workspace,
    capabilityKey,
  });

  return {
    workspace,
    permissions,
  };
}

export async function requireWorkspaceReviewAccessForRequest(
  input: ResolveWorkspaceSelectionInput & {
    capabilityKey?: TenantCapability;
  },
) {
  const workspace = await resolveSelectedWorkspaceForRequest(input);
  const capabilityKey = input.capabilityKey ?? "review.workspace";
  await requireWorkspaceCapability({
    ...input,
    workspaceId: workspace.id,
    capabilityKey,
    errorCode: "workspace_review_forbidden",
    errorMessage:
      "Only workspace owners, admins, and assigned reviewers can perform review actions.",
  });
  const permissions = await buildWorkspacePermissionsForCapability({
    ...input,
    workspace,
    capabilityKey,
  });

  return {
    workspace,
    permissions,
  };
}

export async function requireWorkspaceCaptureMutationAccessForRequest(
  input: ResolveWorkspaceSelectionInput & {
    capabilityKey?: TenantCapability;
  },
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
  input: ResolveWorkspaceSelectionInput & {
    capabilityKey?: TenantCapability;
  },
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
    capabilityKey?: TenantCapability;
  },
): Promise<WorkspacePermissions> {
  const row = await loadWorkspaceScopedRow(input);
  const capabilityKey = input.capabilityKey ?? "capture.workspace";
  await requireWorkspaceCapability({
    ...input,
    workspaceId: row.workspace_id,
    capabilityKey,
    errorCode: "workspace_capture_forbidden",
    errorMessage:
      "Only workspace owners, admins, and assigned photographers can perform capture actions.",
  });
  const workspace = await resolveSelectedWorkspaceForRequest({
    ...input,
    requestedWorkspaceId: row.workspace_id,
  });
  return buildWorkspacePermissionsForCapability({
    ...input,
    workspace,
    capabilityKey,
  });
}

export async function requireWorkspaceReviewAccessForRow(
  input: WorkspaceScopedRowLookupInput & {
    userId: string;
    capabilityKey?: TenantCapability;
  },
): Promise<WorkspacePermissions> {
  const row = await loadWorkspaceScopedRow(input);
  const capabilityKey = input.capabilityKey ?? "review.workspace";
  await requireWorkspaceCapability({
    ...input,
    workspaceId: row.workspace_id,
    capabilityKey,
    errorCode: "workspace_review_forbidden",
    errorMessage:
      "Only workspace owners, admins, and assigned reviewers can perform review actions.",
  });
  const workspace = await resolveSelectedWorkspaceForRequest({
    ...input,
    requestedWorkspaceId: row.workspace_id,
  });
  return buildWorkspacePermissionsForCapability({
    ...input,
    workspace,
    capabilityKey,
  });
}

export async function requireWorkspaceCaptureMutationAccessForRow(
  input: WorkspaceScopedRowLookupInput & {
    userId: string;
    capabilityKey?: TenantCapability;
  },
) {
  const row = await loadWorkspaceScopedRow(input);
  const permissions = await requireWorkspaceCaptureAccessForRow({
    ...input,
    rowId: input.rowId,
  });
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
    capabilityKey?: TenantCapability;
  },
) {
  const row = await loadWorkspaceScopedRow(input);
  const permissions = await requireWorkspaceReviewAccessForRow({
    ...input,
    rowId: input.rowId,
  });
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

export async function requireWorkspaceCorrectionReviewMutationAccessForRequest(
  input: ResolveWorkspaceSelectionInput,
) {
  const project = await loadProjectWorkflowRowForCorrection(input.supabase, input.tenantId, input.projectId);
  const access = await requireWorkspaceReviewAccessForRequest({
    ...input,
    capabilityKey: project.finalized_at ? "correction.review" : "review.workspace",
  });
  assertWorkspaceCorrectionReviewMutationAllowed({
    project,
    workspace: access.workspace,
  });

  return {
    ...access,
    project,
  };
}

export async function requireWorkspaceCorrectionReviewMutationAccessForRow(
  input: WorkspaceScopedRowLookupInput & {
    userId: string;
  },
) {
  const row = await loadWorkspaceScopedRow(input);
  const project = await loadProjectWorkflowRowForCorrection(input.supabase, input.tenantId, input.projectId);
  const permissions = await requireWorkspaceReviewAccessForRow({
    ...input,
    capabilityKey: project.finalized_at ? "correction.review" : "review.workspace",
  });
  assertWorkspaceCorrectionReviewMutationAllowed({
    project,
    workspace: permissions.workspace,
  });

  return {
    permissions,
    project,
    row,
  };
}

async function loadProjectWorkflowRowForCorrection(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
) {
  const project = await supabase
    .from("projects")
    .select(
      "id, status, finalized_at, finalized_by, correction_state, correction_opened_at, correction_opened_by, correction_source_release_id, correction_reason",
    )
    .eq("tenant_id", tenantId)
    .eq("id", projectId)
    .maybeSingle();

  if (project.error) {
    throw new HttpError(500, "project_lookup_failed", "Unable to load project.");
  }

  if (!project.data) {
    throw new HttpError(404, "project_not_found", "Project not found.");
  }

  return project.data;
}

export async function loadProjectWorkflowRowForAccess(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
) {
  return loadProjectWorkflowRowForCorrection(supabase, tenantId, projectId);
}

export async function requireWorkspaceCorrectionConsentIntakeAccessForRequest(
  input: ResolveWorkspaceSelectionInput,
) {
  const access = await requireWorkspaceReviewAccessForRequest({
    ...input,
    capabilityKey: "correction.consent_intake",
  });
  const project = await loadProjectWorkflowRowForCorrection(input.supabase, input.tenantId, input.projectId);
  assertWorkspaceCorrectionConsentIntakeAllowed({
    project,
    workspace: access.workspace,
  });

  return {
    ...access,
    project,
  };
}

export async function requireWorkspaceCorrectionConsentIntakeAccessForRow(
  input: WorkspaceScopedRowLookupInput & {
    userId: string;
  },
) {
  const row = await loadWorkspaceScopedRow(input);
  const permissions = await requireWorkspaceReviewAccessForRow({
    ...input,
    capabilityKey: "correction.consent_intake",
  });
  const project = await loadProjectWorkflowRowForCorrection(input.supabase, input.tenantId, input.projectId);
  assertWorkspaceCorrectionConsentIntakeAllowed({
    project,
    workspace: permissions.workspace,
  });

  return {
    permissions,
    project,
    row,
  };
}

export async function requireWorkspaceCorrectionMediaIntakeAccessForRequest(
  input: ResolveWorkspaceSelectionInput,
) {
  const workspace = await resolveSelectedWorkspaceForRequest(input);
  const capabilityKey = "correction.media_intake";
  await requireWorkspaceCapability({
    ...input,
    workspaceId: workspace.id,
    capabilityKey,
    errorCode: "workspace_media_intake_forbidden",
    errorMessage: "Only workspace owners, admins, and reviewers can add correction media.",
  });
  const permissions = await buildWorkspacePermissionsForCapability({
    ...input,
    workspace,
    capabilityKey,
  });

  const project = await loadProjectWorkflowRowForCorrection(input.supabase, input.tenantId, input.projectId);
  // Correction media intake intentionally stays reviewer-scoped so finalized capture stays closed.
  assertWorkspaceCorrectionMediaIntakeAllowed({
    project,
    workspace: permissions.workspace,
  });

  return {
    workspace,
    permissions,
    project,
  };
}

export async function requireWorkspaceCorrectionMediaIntakeAccessForRow(
  input: WorkspaceScopedRowLookupInput & {
    userId: string;
  },
) {
  const row = await loadWorkspaceScopedRow(input);
  const capabilityKey = "correction.media_intake";
  await requireWorkspaceCapability({
    ...input,
    workspaceId: row.workspace_id,
    capabilityKey,
    errorCode: "workspace_media_intake_forbidden",
    errorMessage: "Only workspace owners, admins, and reviewers can add correction media.",
  });
  const workspace = await resolveSelectedWorkspaceForRequest({
    ...input,
    requestedWorkspaceId: row.workspace_id,
  });
  const permissions = await buildWorkspacePermissionsForCapability({
    ...input,
    workspace,
    capabilityKey,
  });

  const project = await loadProjectWorkflowRowForCorrection(input.supabase, input.tenantId, input.projectId);
  // Row-scoped correction media writes use the same narrow reviewer-capable boundary as request-scoped routes.
  assertWorkspaceCorrectionMediaIntakeAllowed({
    project,
    workspace: permissions.workspace,
  });

  return {
    permissions,
    project,
    row,
  };
}
