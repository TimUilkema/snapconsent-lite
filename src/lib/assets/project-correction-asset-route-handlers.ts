import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError, jsonError } from "@/lib/http/errors";
import { SAFE_IN_FILTER_CHUNK_SIZE, chunkValues } from "@/lib/supabase/safe-in-filter";
import type { ProjectUploadFinalizeItemInput, ProjectUploadPrepareItemInput } from "@/lib/uploads/project-upload-types";

type AuthenticatedRouteClient = SupabaseClient;
type RequireWorkspaceCorrectionMediaIntakeAccessForRequestFn =
  typeof import("@/lib/projects/project-workspace-request").requireWorkspaceCorrectionMediaIntakeAccessForRequest;
type PrepareProjectAssetBatchFn =
  typeof import("@/lib/assets/prepare-project-asset-batch").prepareProjectAssetBatch;
type FinalizeProjectAssetBatchFn =
  typeof import("@/lib/assets/finalize-project-asset-batch").finalizeProjectAssetBatch;

type ProjectRouteContext = {
  params: Promise<{
    projectId: string;
  }>;
};

type PreflightFile = {
  name?: string;
  size?: number;
  contentType?: string;
  contentHash?: string;
};

type PreflightBody = {
  workspaceId?: string;
  assetType?: string;
  files?: PreflightFile[];
};

type PrepareBatchBody = {
  workspaceId?: string;
  assetType?: string;
  duplicatePolicy?: string;
  items?: ProjectUploadPrepareItemInput[];
};

type FinalizeBatchBody = {
  workspaceId?: string;
  items?: ProjectUploadFinalizeItemInput[];
};

type PreflightDependencies = {
  createClient: () => Promise<AuthenticatedRouteClient>;
  resolveTenantId: (client: AuthenticatedRouteClient) => Promise<string | null>;
  requireWorkspaceCorrectionMediaIntakeAccessForRequest: RequireWorkspaceCorrectionMediaIntakeAccessForRequestFn;
};

type PrepareDependencies = PreflightDependencies & {
  createAdminClient: () => SupabaseClient;
  prepareProjectAssetBatch: PrepareProjectAssetBatchFn;
};

type FinalizeDependencies = PreflightDependencies & {
  createAdminClient: () => SupabaseClient;
  finalizeProjectAssetBatch: FinalizeProjectAssetBatchFn;
};

const MAX_PREFLIGHT_FILES = 2000;

function normalizeAssetType(value: unknown): "photo" | "video" {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized || normalized === "photo") {
    return "photo";
  }

  if (normalized === "video") {
    return "video";
  }

  throw new HttpError(400, "invalid_asset_type", "Invalid asset type.");
}

function normalizeSize(value: unknown): number | null {
  const size = Number(value ?? 0);
  if (!Number.isFinite(size) || size <= 0) {
    return null;
  }

  return Math.floor(size);
}

function normalizeContentHash(value: unknown): string | null {
  const trimmed = String(value ?? "").trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  if (!/^[a-f0-9]{64}$/.test(trimmed)) {
    return null;
  }

  return trimmed;
}

function parseDuplicatePolicy(value: unknown): "upload_anyway" | "overwrite" | "ignore" {
  if (value === "overwrite" || value === "ignore") {
    return value;
  }

  return "upload_anyway";
}

export async function handleProjectCorrectionAssetPreflightPost(
  request: Request,
  context: ProjectRouteContext,
  dependencies: PreflightDependencies,
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
    const body = (await request.json().catch(() => null)) as PreflightBody | null;
    if (!body) {
      throw new HttpError(400, "invalid_body", "Invalid request body.");
    }

    const { workspace } = await dependencies.requireWorkspaceCorrectionMediaIntakeAccessForRequest({
      supabase,
      tenantId,
      userId: user.id,
      projectId,
      requestedWorkspaceId: body.workspaceId,
    });
    const assetType = normalizeAssetType(body.assetType);
    const files = Array.isArray(body.files) ? body.files : [];
    if (files.length === 0) {
      throw new HttpError(400, "invalid_files", "At least one file is required.");
    }
    if (files.length > MAX_PREFLIGHT_FILES) {
      throw new HttpError(400, "files_too_large", "Too many files were provided.");
    }

    const sizes = files
      .map((file) => normalizeSize(file.size))
      .filter((size): size is number => size !== null);
    const uniqueSizes = Array.from(new Set(sizes));

    let candidateSizes: number[] = [];
    if (uniqueSizes.length > 0) {
      const foundSizes = new Set<number>();
      const sizeChunks = chunkValues(uniqueSizes, SAFE_IN_FILTER_CHUNK_SIZE);
      for (const sizeChunk of sizeChunks) {
        const { data, error } = await supabase
          .from("assets")
          .select("file_size_bytes")
          .eq("tenant_id", tenantId)
          .eq("project_id", projectId)
          .eq("workspace_id", workspace.id)
          .eq("asset_type", assetType)
          .in("file_size_bytes", sizeChunk);

        if (error) {
          throw new HttpError(500, "asset_size_lookup_failed", "Unable to preflight assets.");
        }

        (data ?? [])
          .map((row) => Number(row.file_size_bytes))
          .filter((size) => Number.isFinite(size) && size > 0)
          .forEach((size) => foundSizes.add(size));
      }

      candidateSizes = Array.from(foundSizes);
    }

    const hashes = files
      .map((file) => normalizeContentHash(file.contentHash))
      .filter((hash): hash is string => hash !== null);
    const uniqueHashes = Array.from(new Set(hashes));

    let duplicateHashes: string[] = [];
    if (uniqueHashes.length > 0) {
      const foundHashes = new Set<string>();
      const hashChunks = chunkValues(uniqueHashes, SAFE_IN_FILTER_CHUNK_SIZE);
      for (const hashChunk of hashChunks) {
        const { data, error } = await supabase
          .from("assets")
          .select("content_hash")
          .eq("tenant_id", tenantId)
          .eq("project_id", projectId)
          .eq("workspace_id", workspace.id)
          .eq("asset_type", assetType)
          .in("content_hash", hashChunk);

        if (error) {
          throw new HttpError(500, "asset_hash_lookup_failed", "Unable to preflight assets.");
        }

        (data ?? [])
          .map((row) => normalizeContentHash(row.content_hash))
          .filter((hash): hash is string => hash !== null)
          .forEach((hash) => foundHashes.add(hash));
      }

      duplicateHashes = Array.from(foundHashes);
    }

    return Response.json({ candidateSizes, duplicateHashes }, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleProjectCorrectionAssetBatchPreparePost(
  request: Request,
  context: ProjectRouteContext,
  dependencies: PrepareDependencies,
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
    const body = (await request.json().catch(() => null)) as PrepareBatchBody | null;
    if (!body) {
      throw new HttpError(400, "invalid_body", "Invalid request body.");
    }

    const { workspace } = await dependencies.requireWorkspaceCorrectionMediaIntakeAccessForRequest({
      supabase,
      tenantId,
      userId: user.id,
      projectId,
      requestedWorkspaceId: body.workspaceId,
    });
    const assetType = normalizeAssetType(body.assetType);

    const results = await dependencies.prepareProjectAssetBatch({
      supabase: dependencies.createAdminClient(),
      tenantId,
      projectId,
      workspaceId: workspace.id,
      userId: user.id,
      assetType,
      duplicatePolicy: parseDuplicatePolicy(body.duplicatePolicy),
      items: Array.isArray(body.items) ? body.items : [],
    });

    return Response.json({ items: results }, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleProjectCorrectionAssetBatchFinalizePost(
  request: Request,
  context: ProjectRouteContext,
  dependencies: FinalizeDependencies,
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
    const body = (await request.json().catch(() => null)) as FinalizeBatchBody | null;
    if (!body) {
      throw new HttpError(400, "invalid_body", "Invalid request body.");
    }

    const { workspace } = await dependencies.requireWorkspaceCorrectionMediaIntakeAccessForRequest({
      supabase,
      tenantId,
      userId: user.id,
      projectId,
      requestedWorkspaceId: body.workspaceId,
    });

    const results = await dependencies.finalizeProjectAssetBatch({
      supabase: dependencies.createAdminClient(),
      tenantId,
      projectId,
      workspaceId: workspace.id,
      items: Array.isArray(body.items) ? body.items : [],
    });

    return Response.json({ items: results }, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
