import { HttpError, jsonError } from "@/lib/http/errors";

type AuthenticatedRouteClient = {
  auth: {
    getUser(): Promise<{
      data: {
        user: {
          id: string;
        } | null;
      };
    }>;
  };
};

type AddProjectProfileParticipantBody = {
  recurringProfileId?: string;
  workspaceId?: string;
};

type CreateProjectProfileConsentRequestBody = {
  consentTemplateId?: string | null;
  workspaceId?: string;
};

type ProjectParticipantRouteContext = {
  params: Promise<{
    projectId: string;
    participantId: string;
  }>;
};

type ProjectRouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

type AddProjectProfileParticipantDependencies = {
  createClient: () => Promise<AuthenticatedRouteClient>;
  resolveTenantId: (client: AuthenticatedRouteClient) => Promise<string | null>;
  requireWorkspaceCaptureMutationAccessForRequest: (input: {
    supabase: AuthenticatedRouteClient;
    tenantId: string;
    userId: string;
    projectId: string;
    requestedWorkspaceId?: string | null;
  }) => Promise<unknown>;
  addProjectProfileParticipant: (input: {
    supabase: AuthenticatedRouteClient;
    tenantId: string;
    userId: string;
    projectId: string;
    workspaceId: string;
    recurringProfileId: string;
  }) => Promise<{
    status: number;
    payload: unknown;
  }>;
};

type CreateProjectProfileConsentRequestDependencies = {
  createClient: () => Promise<AuthenticatedRouteClient>;
  resolveTenantId: (client: AuthenticatedRouteClient) => Promise<string | null>;
  requireWorkspaceCaptureMutationAccessForRequest: (input: {
    supabase: AuthenticatedRouteClient;
    tenantId: string;
    userId: string;
    projectId: string;
    requestedWorkspaceId?: string | null;
  }) => Promise<unknown>;
  createProjectProfileConsentRequest: (input: {
    supabase: AuthenticatedRouteClient;
    tenantId: string;
    userId: string;
    projectId: string;
    workspaceId: string;
    participantId: string;
    consentTemplateId?: string | null;
    idempotencyKey: string;
  }) => Promise<{
    status: number;
    payload: unknown;
  }>;
};

async function parseOptionalJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  const raw = await request.text();
  if (raw.trim().length === 0) {
    return null;
  }

  const body = JSON.parse(raw) as unknown;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "invalid_body", "Invalid request body.");
  }

  return body as Record<string, unknown>;
}

export async function handleAddProjectProfileParticipantPost(
  request: Request,
  context: ProjectRouteContext,
  dependencies: AddProjectProfileParticipantDependencies,
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
    const body = (await request.json().catch(() => null)) as AddProjectProfileParticipantBody | null;
    if (!body) {
      throw new HttpError(400, "invalid_body", "Invalid request body.");
    }

    const { projectId } = await context.params;
    const workspaceId = String(body.workspaceId ?? "").trim();
    if (!workspaceId) {
      throw new HttpError(400, "workspace_required", "Project workspace is required.");
    }
    await dependencies.requireWorkspaceCaptureMutationAccessForRequest({
      supabase,
      tenantId,
      userId: user.id,
      projectId,
      requestedWorkspaceId: workspaceId,
    });
    const result = await dependencies.addProjectProfileParticipant({
      supabase,
      tenantId,
      userId: user.id,
      projectId,
      workspaceId,
      recurringProfileId: String(body.recurringProfileId ?? ""),
    });

    return Response.json(result.payload, { status: result.status });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleCreateProjectProfileConsentRequestPost(
  request: Request,
  context: ProjectParticipantRouteContext,
  dependencies: CreateProjectProfileConsentRequestDependencies,
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
    const body = (await parseOptionalJsonBody(request).catch((error) => {
      if (error instanceof SyntaxError) {
        throw new HttpError(400, "invalid_body", "Invalid request body.");
      }

      throw error;
    })) as CreateProjectProfileConsentRequestBody | null;

    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
    const { projectId, participantId } = await context.params;
    const workspaceId = String(body?.workspaceId ?? "").trim();
    if (!workspaceId) {
      throw new HttpError(400, "workspace_required", "Project workspace is required.");
    }
    await dependencies.requireWorkspaceCaptureMutationAccessForRequest({
      supabase,
      tenantId,
      userId: user.id,
      projectId,
      requestedWorkspaceId: workspaceId,
    });
    const result = await dependencies.createProjectProfileConsentRequest({
      supabase,
      tenantId,
      userId: user.id,
      projectId,
      workspaceId,
      participantId,
      consentTemplateId: typeof body?.consentTemplateId === "string" ? body.consentTemplateId : null,
      idempotencyKey,
    });

    return Response.json(result.payload, { status: result.status });
  } catch (error) {
    return jsonError(error);
  }
}
