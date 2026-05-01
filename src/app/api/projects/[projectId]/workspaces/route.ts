import { HttpError, jsonError } from "@/lib/http/errors";
import { assertProjectWorkflowMutable } from "@/lib/projects/project-workflow-service";
import { listProjectAdministrationWorkspaces } from "@/lib/projects/project-administration-service";
import {
  createPhotographerWorkspace,
  listVisibleProjectWorkspaces,
} from "@/lib/projects/project-workspaces-service";
import { createClient } from "@/lib/supabase/server";
import { assertCanManageProjectWorkspacesAction } from "@/lib/tenant/permissions";
import { resolveTenantId } from "@/lib/tenant/resolve-tenant";

type RouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

type CreateWorkspaceBody = {
  photographerUserId?: string;
  name?: string;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      throw new HttpError(401, "unauthenticated", "Authentication required.");
    }

    const tenantId = await resolveTenantId(supabase);
    if (!tenantId) {
      throw new HttpError(403, "no_tenant_membership", "Tenant membership is required.");
    }

    const { projectId } = await context.params;
    let result: Awaited<ReturnType<typeof listVisibleProjectWorkspaces>>;
    try {
      result = await listVisibleProjectWorkspaces(supabase, tenantId, user.id, projectId);
    } catch (error) {
      if (!(error instanceof HttpError && error.status === 404)) {
        throw error;
      }

      const workspaces = await listProjectAdministrationWorkspaces({
        supabase,
        tenantId,
        userId: user.id,
        projectId,
      });
      result = {
        role: (await assertCanManageProjectWorkspacesAction(supabase, tenantId, user.id, projectId)).role,
        workspaces,
      };
    }

    return Response.json(
      {
        role: result.role,
        workspaces: result.workspaces,
      },
      { status: 200 },
    );
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      throw new HttpError(401, "unauthenticated", "Authentication required.");
    }

    const tenantId = await resolveTenantId(supabase);
    if (!tenantId) {
      throw new HttpError(403, "no_tenant_membership", "Tenant membership is required.");
    }

    const { projectId } = await context.params;
    await assertCanManageProjectWorkspacesAction(supabase, tenantId, user.id, projectId);
    await assertProjectWorkflowMutable(supabase, tenantId, projectId);

    const body = (await request.json().catch(() => null)) as CreateWorkspaceBody | null;
    const photographerUserId = String(body?.photographerUserId ?? "").trim();
    const name = String(body?.name ?? "").trim();

    if (!photographerUserId) {
      throw new HttpError(
        400,
        "photographer_required",
        "A photographer is required to create a project workspace.",
      );
    }

    if (!name) {
      throw new HttpError(
        400,
        "workspace_name_required",
        "A project workspace name is required.",
      );
    }

    const workspace = await createPhotographerWorkspace({
      supabase,
      tenantId,
      projectId,
      photographerUserId,
      name,
      createdByUserId: user.id,
    });

    return Response.json({ workspace }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
