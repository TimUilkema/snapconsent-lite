import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError, jsonError } from "@/lib/http/errors";
import type { TenantCapability } from "@/lib/tenant/role-capabilities";

type ApplyWorkspaceWorkflowTransitionFn =
  typeof import("@/lib/projects/project-workflow-service").applyWorkspaceWorkflowTransition;
type FinalizeProjectFn = typeof import("@/lib/projects/project-workflow-service").finalizeProject;
type StartProjectCorrectionFn =
  typeof import("@/lib/projects/project-workflow-service").startProjectCorrection;
type ReopenWorkspaceForCorrectionFn =
  typeof import("@/lib/projects/project-workflow-service").reopenWorkspaceForCorrection;
type EnsureProjectReleaseSnapshotFn =
  typeof import("@/lib/project-releases/project-release-service").ensureProjectReleaseSnapshot;
type BuildReleaseSnapshotRepairWarningFn =
  typeof import("@/lib/project-releases/project-release-service").buildReleaseSnapshotRepairWarning;
type RequireWorkspaceCaptureAccessForRequestFn =
  typeof import("@/lib/projects/project-workspace-request").requireWorkspaceCaptureAccessForRequest;
type RequireWorkspaceReviewAccessForRequestFn =
  typeof import("@/lib/projects/project-workspace-request").requireWorkspaceReviewAccessForRequest;
type AssertEffectiveProjectCapabilityFn =
  typeof import("@/lib/tenant/effective-permissions").assertEffectiveProjectCapability;

type AuthenticatedRouteClient = SupabaseClient;

type WorkspaceWorkflowRouteContext = {
  params: Promise<{
    projectId: string;
    workspaceId: string;
  }>;
};

type ProjectWorkflowRouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

type WorkspaceWorkflowAction = Parameters<ApplyWorkspaceWorkflowTransitionFn>[0]["action"];

type WorkspaceWorkflowTransitionDependencies = {
  createClient: () => Promise<AuthenticatedRouteClient>;
  createAdminClient: () => SupabaseClient;
  resolveTenantId: (client: AuthenticatedRouteClient) => Promise<string | null>;
  requireWorkspaceCaptureAccessForRequest: RequireWorkspaceCaptureAccessForRequestFn;
  requireWorkspaceReviewAccessForRequest: RequireWorkspaceReviewAccessForRequestFn;
  applyWorkspaceWorkflowTransition: ApplyWorkspaceWorkflowTransitionFn;
};

type ProjectFinalizeDependencies = {
  createClient: () => Promise<AuthenticatedRouteClient>;
  createAdminClient: () => SupabaseClient;
  resolveTenantId: (client: AuthenticatedRouteClient) => Promise<string | null>;
  assertEffectiveProjectCapability: AssertEffectiveProjectCapabilityFn;
  finalizeProject: FinalizeProjectFn;
  ensureProjectReleaseSnapshot: EnsureProjectReleaseSnapshotFn;
  buildReleaseSnapshotRepairWarning: BuildReleaseSnapshotRepairWarningFn;
};

type ProjectCorrectionStartDependencies = {
  createClient: () => Promise<AuthenticatedRouteClient>;
  createAdminClient: () => SupabaseClient;
  resolveTenantId: (client: AuthenticatedRouteClient) => Promise<string | null>;
  assertEffectiveProjectCapability: AssertEffectiveProjectCapabilityFn;
  startProjectCorrection: StartProjectCorrectionFn;
};

type WorkspaceCorrectionReopenDependencies = {
  createClient: () => Promise<AuthenticatedRouteClient>;
  createAdminClient: () => SupabaseClient;
  resolveTenantId: (client: AuthenticatedRouteClient) => Promise<string | null>;
  requireWorkspaceReviewAccessForRequest: RequireWorkspaceReviewAccessForRequestFn;
  reopenWorkspaceForCorrection: ReopenWorkspaceForCorrectionFn;
};

type StartProjectCorrectionBody = {
  reason?: string | null;
};

async function assertProjectWorkflowCapability(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  projectId: string;
  capabilityKey: TenantCapability;
  assertEffectiveProjectCapability: AssertEffectiveProjectCapabilityFn;
}) {
  try {
    return await input.assertEffectiveProjectCapability({
      supabase: input.supabase,
      tenantId: input.tenantId,
      userId: input.userId,
      projectId: input.projectId,
      capabilityKey: input.capabilityKey,
    });
  } catch (error) {
    if (
      error instanceof HttpError &&
      (error.code === "effective_capability_forbidden" ||
        error.code === "effective_capability_scope_forbidden")
    ) {
      throw new HttpError(
        403,
        "project_review_forbidden",
        "Only workspace owners, admins, and assigned reviewers can perform review actions.",
      );
    }

    throw error;
  }
}

export async function handleWorkspaceWorkflowTransitionPost(
  _request: Request,
  context: WorkspaceWorkflowRouteContext,
  action: WorkspaceWorkflowAction,
  dependencies: WorkspaceWorkflowTransitionDependencies,
) {
  try {
    const supabase = await dependencies.createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      throw new HttpError(401, "unauthenticated", "Authentication required.");
    }

    const tenantId = await dependencies.resolveTenantId(supabase);
    if (!tenantId) {
      throw new HttpError(403, "no_tenant_membership", "Tenant membership is required.");
    }

    const { projectId, workspaceId } = await context.params;

    if (action === "handoff") {
      await dependencies.requireWorkspaceCaptureAccessForRequest({
        supabase,
        tenantId,
        userId: user.id,
        projectId,
        requestedWorkspaceId: workspaceId,
        capabilityKey: "capture.workspace",
      });
    } else {
      await dependencies.requireWorkspaceReviewAccessForRequest({
        supabase,
        tenantId,
        userId: user.id,
        projectId,
        requestedWorkspaceId: workspaceId,
        capabilityKey: "review.workspace",
      });
    }

    const result = await dependencies.applyWorkspaceWorkflowTransition({
      supabase: dependencies.createAdminClient(),
      tenantId,
      userId: user.id,
      projectId,
      workspaceId,
      action,
    });

    return Response.json(
      {
        workspace: result.workspace,
        changed: result.changed,
        projectWorkflow: result.projectWorkflow,
      },
      { status: 200 },
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleProjectFinalizePost(
  _request: Request,
  context: ProjectWorkflowRouteContext,
  dependencies: ProjectFinalizeDependencies,
) {
  try {
    const supabase = await dependencies.createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      throw new HttpError(401, "unauthenticated", "Authentication required.");
    }

    const tenantId = await dependencies.resolveTenantId(supabase);
    if (!tenantId) {
      throw new HttpError(403, "no_tenant_membership", "Tenant membership is required.");
    }

    const { projectId } = await context.params;
    await assertProjectWorkflowCapability({
      supabase,
      tenantId,
      userId: user.id,
      projectId,
      capabilityKey: "workflow.finalize_project",
      assertEffectiveProjectCapability: dependencies.assertEffectiveProjectCapability,
    });

    const result = await dependencies.finalizeProject({
      supabase: dependencies.createAdminClient(),
      tenantId,
      userId: user.id,
      projectId,
    });

    try {
      const release = await dependencies.ensureProjectReleaseSnapshot({
        supabase: dependencies.createAdminClient(),
        tenantId,
        projectId,
        actorUserId: user.id,
      });

      return Response.json(
        {
          changed: result.changed,
          projectWorkflow: result.projectWorkflow,
          release,
          warnings: [],
        },
        { status: 200 },
      );
    } catch {
      const repairWarning = dependencies.buildReleaseSnapshotRepairWarning();
      return Response.json(
        {
          changed: result.changed,
          projectWorkflow: result.projectWorkflow,
          release: repairWarning.release,
          warnings: repairWarning.warnings,
        },
        { status: 200 },
      );
    }
  } catch (error) {
    return jsonError(error);
  }
}

async function parseOptionalProjectCorrectionBody(
  request: Request,
): Promise<StartProjectCorrectionBody | null> {
  const raw = await request.text();
  if (raw.trim().length === 0) {
    return null;
  }

  const body = JSON.parse(raw) as unknown;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "invalid_body", "Invalid request body.");
  }

  return body as StartProjectCorrectionBody;
}

export async function handleProjectCorrectionStartPost(
  request: Request,
  context: ProjectWorkflowRouteContext,
  dependencies: ProjectCorrectionStartDependencies,
) {
  try {
    const supabase = await dependencies.createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      throw new HttpError(401, "unauthenticated", "Authentication required.");
    }

    const tenantId = await dependencies.resolveTenantId(supabase);
    if (!tenantId) {
      throw new HttpError(403, "no_tenant_membership", "Tenant membership is required.");
    }

    const body = (await parseOptionalProjectCorrectionBody(request).catch((error) => {
      if (error instanceof SyntaxError) {
        throw new HttpError(400, "invalid_body", "Invalid request body.");
      }

      throw error;
    })) as StartProjectCorrectionBody | null;

    const { projectId } = await context.params;
    await assertProjectWorkflowCapability({
      supabase,
      tenantId,
      userId: user.id,
      projectId,
      capabilityKey: "workflow.start_project_correction",
      assertEffectiveProjectCapability: dependencies.assertEffectiveProjectCapability,
    });

    const result = await dependencies.startProjectCorrection({
      supabase: dependencies.createAdminClient(),
      tenantId,
      userId: user.id,
      projectId,
      reason: typeof body?.reason === "string" ? body.reason : null,
    });

    return Response.json(
      {
        changed: result.changed,
        projectWorkflow: result.projectWorkflow,
        correction: {
          state: result.projectWorkflow.correctionState,
          openedAt: result.projectWorkflow.correctionOpenedAt,
          openedBy: result.projectWorkflow.correctionOpenedBy,
          sourceReleaseId: result.projectWorkflow.correctionSourceReleaseId,
          reason: result.projectWorkflow.correctionReason,
        },
      },
      { status: 200 },
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleWorkspaceCorrectionReopenPost(
  _request: Request,
  context: WorkspaceWorkflowRouteContext,
  dependencies: WorkspaceCorrectionReopenDependencies,
) {
  try {
    const supabase = await dependencies.createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      throw new HttpError(401, "unauthenticated", "Authentication required.");
    }

    const tenantId = await dependencies.resolveTenantId(supabase);
    if (!tenantId) {
      throw new HttpError(403, "no_tenant_membership", "Tenant membership is required.");
    }

    const { projectId, workspaceId } = await context.params;
    await dependencies.requireWorkspaceReviewAccessForRequest({
      supabase,
      tenantId,
      userId: user.id,
      projectId,
      requestedWorkspaceId: workspaceId,
      capabilityKey: "workflow.reopen_workspace_for_correction",
    });

    const result = await dependencies.reopenWorkspaceForCorrection({
      supabase: dependencies.createAdminClient(),
      tenantId,
      userId: user.id,
      projectId,
      workspaceId,
    });

    return Response.json(
      {
        changed: result.changed,
        workspace: result.workspace,
        projectWorkflow: result.projectWorkflow,
      },
      { status: 200 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
