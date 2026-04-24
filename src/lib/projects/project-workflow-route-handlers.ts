import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError, jsonError } from "@/lib/http/errors";

type ApplyWorkspaceWorkflowTransitionFn =
  typeof import("@/lib/projects/project-workflow-service").applyWorkspaceWorkflowTransition;
type FinalizeProjectFn = typeof import("@/lib/projects/project-workflow-service").finalizeProject;
type RequireWorkspaceCaptureAccessForRequestFn =
  typeof import("@/lib/projects/project-workspace-request").requireWorkspaceCaptureAccessForRequest;
type RequireWorkspaceReviewAccessForRequestFn =
  typeof import("@/lib/projects/project-workspace-request").requireWorkspaceReviewAccessForRequest;
type ResolveAccessibleProjectWorkspacesFn =
  typeof import("@/lib/tenant/permissions").resolveAccessibleProjectWorkspaces;
type AssertCanReviewProjectActionFn =
  typeof import("@/lib/tenant/permissions").assertCanReviewProjectAction;

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
  resolveAccessibleProjectWorkspaces: ResolveAccessibleProjectWorkspacesFn;
  assertCanReviewProjectAction: AssertCanReviewProjectActionFn;
  finalizeProject: FinalizeProjectFn;
};

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
      });
    } else {
      await dependencies.requireWorkspaceReviewAccessForRequest({
        supabase,
        tenantId,
        userId: user.id,
        projectId,
        requestedWorkspaceId: workspaceId,
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
    await dependencies.resolveAccessibleProjectWorkspaces(supabase, tenantId, user.id, projectId);
    await dependencies.assertCanReviewProjectAction(supabase, tenantId, user.id);

    const result = await dependencies.finalizeProject({
      supabase: dependencies.createAdminClient(),
      tenantId,
      userId: user.id,
      projectId,
    });

    return Response.json(
      {
        changed: result.changed,
        projectWorkflow: result.projectWorkflow,
      },
      { status: 200 },
    );
  } catch (error) {
    return jsonError(error);
  }
}
