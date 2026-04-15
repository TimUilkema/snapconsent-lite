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

type CreateRecurringProfileBody = {
  fullName?: string;
  email?: string;
  profileTypeId?: string | null;
};

type CreateRecurringProfileHeadshotBody = {
  originalFilename?: string;
  contentType?: string;
  fileSizeBytes?: number;
  contentHash?: string | null;
  contentHashAlgo?: string | null;
};

type SelectRecurringProfileHeadshotFaceBody = {
  faceId?: string;
};

type CreateBaselineConsentRequestBody = {
  consentTemplateId?: string;
};

type BaselineFollowUpBody = {
  consentTemplateId?: string | null;
};

type CreateRecurringProfileTypeBody = {
  label?: string;
};

type CreateRecurringProfileDependencies = {
  createClient: () => Promise<AuthenticatedRouteClient>;
  resolveTenantId: (client: AuthenticatedRouteClient) => Promise<string | null>;
  createRecurringProfile: (input: {
    supabase: AuthenticatedRouteClient;
    tenantId: string;
    userId: string;
    idempotencyKey: string;
    fullName: string;
    email: string;
    profileTypeId?: string | null;
  }) => Promise<{
    status: number;
    payload: unknown;
  }>;
};

type CreateRecurringProfileHeadshotDependencies = {
  createClient: () => Promise<AuthenticatedRouteClient>;
  resolveTenantId: (client: AuthenticatedRouteClient) => Promise<string | null>;
  createRecurringProfileHeadshotUpload: (input: {
    supabase: AuthenticatedRouteClient;
    tenantId: string;
    userId: string;
    profileId: string;
    idempotencyKey: string;
    originalFilename: string;
    contentType: string;
    fileSizeBytes: number;
    contentHash?: string | null;
    contentHashAlgo?: string | null;
  }) => Promise<{
    status: number;
    payload: unknown;
  }>;
};

type ArchiveRecurringProfileDependencies = {
  createClient: () => Promise<AuthenticatedRouteClient>;
  resolveTenantId: (client: AuthenticatedRouteClient) => Promise<string | null>;
  archiveRecurringProfile: (input: {
    supabase: AuthenticatedRouteClient;
    tenantId: string;
    userId: string;
    profileId: string;
  }) => Promise<unknown>;
};

type GetRecurringProfileDetailDependencies = {
  createClient: () => Promise<AuthenticatedRouteClient>;
  resolveTenantId: (client: AuthenticatedRouteClient) => Promise<string | null>;
  getRecurringProfileDetailPanelData: (input: {
    supabase: AuthenticatedRouteClient;
    tenantId: string;
    userId: string;
    profileId: string;
  }) => Promise<unknown>;
};

type FinalizeRecurringProfileHeadshotDependencies = {
  createClient: () => Promise<AuthenticatedRouteClient>;
  resolveTenantId: (client: AuthenticatedRouteClient) => Promise<string | null>;
  finalizeRecurringProfileHeadshotUpload: (input: {
    supabase: AuthenticatedRouteClient;
    tenantId: string;
    userId: string;
    profileId: string;
    headshotId: string;
  }) => Promise<unknown>;
};

type SelectRecurringProfileHeadshotFaceDependencies = {
  createClient: () => Promise<AuthenticatedRouteClient>;
  resolveTenantId: (client: AuthenticatedRouteClient) => Promise<string | null>;
  selectRecurringProfileHeadshotFace: (input: {
    supabase: AuthenticatedRouteClient;
    tenantId: string;
    userId: string;
    profileId: string;
    headshotId: string;
    faceId: string;
  }) => Promise<unknown>;
};

type CreateBaselineConsentRequestDependencies = {
  createClient: () => Promise<AuthenticatedRouteClient>;
  resolveTenantId: (client: AuthenticatedRouteClient) => Promise<string | null>;
  createBaselineConsentRequest: (input: {
    supabase: AuthenticatedRouteClient;
    tenantId: string;
    userId: string;
    profileId: string;
    consentTemplateId: string;
    idempotencyKey: string;
  }) => Promise<{
    status: number;
    payload: unknown;
  }>;
};

type CancelBaselineConsentRequestDependencies = {
  createClient: () => Promise<AuthenticatedRouteClient>;
  resolveTenantId: (client: AuthenticatedRouteClient) => Promise<string | null>;
  cancelBaselineConsentRequest: (input: {
    supabase: AuthenticatedRouteClient;
    tenantId: string;
    userId: string;
    profileId: string;
    requestId: string;
  }) => Promise<{
    status: number;
    payload: unknown;
  }>;
};

type ReplaceBaselineConsentRequestDependencies = {
  createClient: () => Promise<AuthenticatedRouteClient>;
  resolveTenantId: (client: AuthenticatedRouteClient) => Promise<string | null>;
  replaceBaselineConsentRequest: (input: {
    supabase: AuthenticatedRouteClient;
    tenantId: string;
    userId: string;
    profileId: string;
    requestId: string;
    idempotencyKey: string;
  }) => Promise<{
    status: number;
    payload: unknown;
  }>;
};

type BaselineFollowUpDependencies = {
  createClient: () => Promise<AuthenticatedRouteClient>;
  resolveTenantId: (client: AuthenticatedRouteClient) => Promise<string | null>;
  sendBaselineFollowUp: (input: {
    supabase: AuthenticatedRouteClient;
    tenantId: string;
    userId: string;
    profileId: string;
    idempotencyKey: string;
    consentTemplateId?: string | null;
  }) => Promise<{
    status: number;
    payload: unknown;
  }>;
};

type CreateRecurringProfileTypeDependencies = {
  createClient: () => Promise<AuthenticatedRouteClient>;
  resolveTenantId: (client: AuthenticatedRouteClient) => Promise<string | null>;
  createRecurringProfileType: (input: {
    supabase: AuthenticatedRouteClient;
    tenantId: string;
    userId: string;
    idempotencyKey: string;
    label: string;
  }) => Promise<{
    status: number;
    payload: unknown;
  }>;
};

type ArchiveRecurringProfileTypeDependencies = {
  createClient: () => Promise<AuthenticatedRouteClient>;
  resolveTenantId: (client: AuthenticatedRouteClient) => Promise<string | null>;
  archiveRecurringProfileType: (input: {
    supabase: AuthenticatedRouteClient;
    tenantId: string;
    userId: string;
    profileTypeId: string;
  }) => Promise<unknown>;
};

type ArchiveRecurringProfileRouteContext = {
  params: Promise<{
    profileId: string;
  }>;
};

type RecurringProfileHeadshotRouteContext = {
  params: Promise<{
    profileId: string;
    headshotId: string;
  }>;
};

type BaselineConsentRequestRouteContext = {
  params: Promise<{
    profileId: string;
    requestId: string;
  }>;
};

type ArchiveRecurringProfileTypeRouteContext = {
  params: Promise<{
    profileTypeId: string;
  }>;
};

export async function handleCreateRecurringProfilePost(
  request: Request,
  dependencies: CreateRecurringProfileDependencies,
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

    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
    const body = (await request.json().catch(() => null)) as CreateRecurringProfileBody | null;
    if (!body) {
      throw new HttpError(400, "invalid_body", "Invalid request body.");
    }

    const result = await dependencies.createRecurringProfile({
      supabase,
      tenantId,
      userId: user.id,
      idempotencyKey,
      fullName: String(body.fullName ?? ""),
      email: String(body.email ?? ""),
      profileTypeId: typeof body.profileTypeId === "string" ? body.profileTypeId : null,
    });

    return Response.json(result.payload, { status: result.status });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleCreateRecurringProfileHeadshotPost(
  request: Request,
  context: ArchiveRecurringProfileRouteContext,
  dependencies: CreateRecurringProfileHeadshotDependencies,
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

    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
    const body = (await request.json().catch(() => null)) as CreateRecurringProfileHeadshotBody | null;
    if (!body) {
      throw new HttpError(400, "invalid_body", "Invalid request body.");
    }

    const { profileId } = await context.params;
    const result = await dependencies.createRecurringProfileHeadshotUpload({
      supabase,
      tenantId,
      userId: user.id,
      profileId,
      idempotencyKey,
      originalFilename: String(body.originalFilename ?? ""),
      contentType: String(body.contentType ?? ""),
      fileSizeBytes: Number(body.fileSizeBytes ?? 0),
      contentHash: typeof body.contentHash === "string" ? body.contentHash : null,
      contentHashAlgo: typeof body.contentHashAlgo === "string" ? body.contentHashAlgo : null,
    });

    return Response.json(result.payload, { status: result.status });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleArchiveRecurringProfilePost(
  _request: Request,
  context: ArchiveRecurringProfileRouteContext,
  dependencies: ArchiveRecurringProfileDependencies,
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

    const { profileId } = await context.params;
    const profile = await dependencies.archiveRecurringProfile({
      supabase,
      tenantId,
      userId: user.id,
      profileId,
    });

    return Response.json({ profile }, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleGetRecurringProfileDetail(
  _request: Request,
  context: ArchiveRecurringProfileRouteContext,
  dependencies: GetRecurringProfileDetailDependencies,
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

    const { profileId } = await context.params;
    const detail = await dependencies.getRecurringProfileDetailPanelData({
      supabase,
      tenantId,
      userId: user.id,
      profileId,
    });

    return Response.json({ detail }, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleFinalizeRecurringProfileHeadshotPost(
  _request: Request,
  context: RecurringProfileHeadshotRouteContext,
  dependencies: FinalizeRecurringProfileHeadshotDependencies,
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

    const { profileId, headshotId } = await context.params;
    const result = await dependencies.finalizeRecurringProfileHeadshotUpload({
      supabase,
      tenantId,
      userId: user.id,
      profileId,
      headshotId,
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    console.error("[profiles][headshot] finalize route failed", {
      error:
        error instanceof HttpError
          ? {
              status: error.status,
              code: error.code,
              message: error.message,
            }
          : String(error),
    });
    return jsonError(error);
  }
}

export async function handleSelectRecurringProfileHeadshotFacePost(
  request: Request,
  context: RecurringProfileHeadshotRouteContext,
  dependencies: SelectRecurringProfileHeadshotFaceDependencies,
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

    const body = (await request.json().catch(() => null)) as SelectRecurringProfileHeadshotFaceBody | null;
    if (!body) {
      throw new HttpError(400, "invalid_body", "Invalid request body.");
    }

    const { profileId, headshotId } = await context.params;
    const result = await dependencies.selectRecurringProfileHeadshotFace({
      supabase,
      tenantId,
      userId: user.id,
      profileId,
      headshotId,
      faceId: String(body.faceId ?? ""),
    });

    return Response.json({ readiness: result }, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleCreateBaselineConsentRequestPost(
  request: Request,
  context: ArchiveRecurringProfileRouteContext,
  dependencies: CreateBaselineConsentRequestDependencies,
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

    const body = (await request.json().catch(() => null)) as CreateBaselineConsentRequestBody | null;
    if (!body) {
      throw new HttpError(400, "invalid_body", "Invalid request body.");
    }

    const { profileId } = await context.params;
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
    const result = await dependencies.createBaselineConsentRequest({
      supabase,
      tenantId,
      userId: user.id,
      profileId,
      consentTemplateId: String(body.consentTemplateId ?? ""),
      idempotencyKey,
    });

    return Response.json(result.payload, { status: result.status });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleCancelBaselineConsentRequestPost(
  _request: Request,
  context: BaselineConsentRequestRouteContext,
  dependencies: CancelBaselineConsentRequestDependencies,
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

    const { profileId, requestId } = await context.params;
    const result = await dependencies.cancelBaselineConsentRequest({
      supabase,
      tenantId,
      userId: user.id,
      profileId,
      requestId,
    });

    return Response.json(result.payload, { status: result.status });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleReplaceBaselineConsentRequestPost(
  request: Request,
  context: BaselineConsentRequestRouteContext,
  dependencies: ReplaceBaselineConsentRequestDependencies,
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

    const { profileId, requestId } = await context.params;
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
    const result = await dependencies.replaceBaselineConsentRequest({
      supabase,
      tenantId,
      userId: user.id,
      profileId,
      requestId,
      idempotencyKey,
    });

    return Response.json(result.payload, { status: result.status });
  } catch (error) {
    return jsonError(error);
  }
}

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

export async function handleBaselineFollowUpPost(
  request: Request,
  context: ArchiveRecurringProfileRouteContext,
  dependencies: BaselineFollowUpDependencies,
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
    })) as BaselineFollowUpBody | null;

    const { profileId } = await context.params;
    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
    const result = await dependencies.sendBaselineFollowUp({
      supabase,
      tenantId,
      userId: user.id,
      profileId,
      idempotencyKey,
      consentTemplateId: typeof body?.consentTemplateId === "string" ? body.consentTemplateId : null,
    });

    return Response.json(result.payload, { status: result.status });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleCreateRecurringProfileTypePost(
  request: Request,
  dependencies: CreateRecurringProfileTypeDependencies,
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

    const idempotencyKey = request.headers.get("Idempotency-Key")?.trim() ?? "";
    const body = (await request.json().catch(() => null)) as CreateRecurringProfileTypeBody | null;
    if (!body) {
      throw new HttpError(400, "invalid_body", "Invalid request body.");
    }

    const result = await dependencies.createRecurringProfileType({
      supabase,
      tenantId,
      userId: user.id,
      idempotencyKey,
      label: String(body.label ?? ""),
    });

    return Response.json(result.payload, { status: result.status });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleArchiveRecurringProfileTypePost(
  _request: Request,
  context: ArchiveRecurringProfileTypeRouteContext,
  dependencies: ArchiveRecurringProfileTypeDependencies,
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

    const { profileTypeId } = await context.params;
    const profileType = await dependencies.archiveRecurringProfileType({
      supabase,
      tenantId,
      userId: user.id,
      profileTypeId,
    });

    return Response.json({ profileType }, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
