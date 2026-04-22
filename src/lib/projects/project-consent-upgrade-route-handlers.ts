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

type CreateProjectConsentUpgradeRequestBody = {
  targetTemplateId?: string | null;
};

type ProjectConsentUpgradeRouteContext = {
  params: Promise<{
    projectId: string;
    consentId: string;
  }>;
};

type CreateProjectConsentUpgradeRequestDependencies = {
  createClient: () => Promise<AuthenticatedRouteClient>;
  resolveTenantId: (client: AuthenticatedRouteClient) => Promise<string | null>;
  createProjectConsentUpgradeRequest: (input: {
    supabase: AuthenticatedRouteClient;
    tenantId: string;
    userId: string;
    projectId: string;
    consentId: string;
    targetTemplateId: string;
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

export async function handleCreateProjectConsentUpgradeRequestPost(
  request: Request,
  context: ProjectConsentUpgradeRouteContext,
  dependencies: CreateProjectConsentUpgradeRequestDependencies,
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
    })) as CreateProjectConsentUpgradeRequestBody | null;

    if (typeof body?.targetTemplateId !== "string" || body.targetTemplateId.trim().length === 0) {
      throw new HttpError(400, "invalid_body", "Invalid request body.");
    }

    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
    const { projectId, consentId } = await context.params;
    const result = await dependencies.createProjectConsentUpgradeRequest({
      supabase,
      tenantId,
      userId: user.id,
      projectId,
      consentId,
      targetTemplateId: body.targetTemplateId,
      idempotencyKey,
    });

    return Response.json(result.payload, { status: result.status });
  } catch (error) {
    return jsonError(error);
  }
}
