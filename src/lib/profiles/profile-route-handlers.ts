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
