import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError, jsonError } from "@/lib/http/errors";

type FolderRouteContext = {
  params: Promise<{
    folderId: string;
  }>;
};

type CreateFolderDependencies = {
  createClient: () => Promise<SupabaseClient>;
  resolveTenantId: (client: SupabaseClient) => Promise<string | null>;
  createMediaLibraryFolder: typeof import("@/lib/media-library/media-library-folder-service").createMediaLibraryFolder;
};

type RenameFolderDependencies = {
  createClient: () => Promise<SupabaseClient>;
  resolveTenantId: (client: SupabaseClient) => Promise<string | null>;
  renameMediaLibraryFolder: typeof import("@/lib/media-library/media-library-folder-service").renameMediaLibraryFolder;
};

type ArchiveFolderDependencies = {
  createClient: () => Promise<SupabaseClient>;
  resolveTenantId: (client: SupabaseClient) => Promise<string | null>;
  archiveMediaLibraryFolder: typeof import("@/lib/media-library/media-library-folder-service").archiveMediaLibraryFolder;
};

type MoveFolderDependencies = {
  createClient: () => Promise<SupabaseClient>;
  resolveTenantId: (client: SupabaseClient) => Promise<string | null>;
  moveMediaLibraryFolder: typeof import("@/lib/media-library/media-library-folder-service").moveMediaLibraryFolder;
};

type FolderAssetMutationDependencies = {
  createClient: () => Promise<SupabaseClient>;
  resolveTenantId: (client: SupabaseClient) => Promise<string | null>;
  mutateFolderAssets: (input: {
    supabase: SupabaseClient;
    tenantId: string;
    userId: string;
    folderId: string;
    mediaLibraryAssetIds: string[];
  }) => Promise<{
    folderId: string;
    requestedCount: number;
    changedCount: number;
    noopCount: number;
  }>;
};

type FolderNameBody = {
  name?: string;
};

type FolderMoveBody = {
  parentFolderId?: string | null;
};

type FolderAssetBody = {
  mediaLibraryAssetIds?: string[];
};

async function requireAuthenticatedTenantContext(
  createClient: () => Promise<SupabaseClient>,
  resolveTenantId: (client: SupabaseClient) => Promise<string | null>,
) {
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

  return {
    supabase,
    tenantId,
    userId: user.id,
  };
}

async function parseJsonBody<T>(request: Request) {
  const body = (await request.json().catch(() => null)) as T | null;
  if (!body) {
    throw new HttpError(400, "invalid_body", "Invalid request body.");
  }

  return body;
}

export async function handleCreateMediaLibraryFolderPost(
  request: Request,
  dependencies: CreateFolderDependencies,
) {
  try {
    const { supabase, tenantId, userId } = await requireAuthenticatedTenantContext(
      dependencies.createClient,
      dependencies.resolveTenantId,
    );
    const body = await parseJsonBody<FolderNameBody>(request);

    const folder = await dependencies.createMediaLibraryFolder({
      supabase,
      tenantId,
      userId,
      name: String(body.name ?? ""),
    });

    return Response.json({ folder }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleRenameMediaLibraryFolderPatch(
  request: Request,
  context: FolderRouteContext,
  dependencies: RenameFolderDependencies,
) {
  try {
    const { supabase, tenantId, userId } = await requireAuthenticatedTenantContext(
      dependencies.createClient,
      dependencies.resolveTenantId,
    );
    const body = await parseJsonBody<FolderNameBody>(request);
    const { folderId } = await context.params;

    const result = await dependencies.renameMediaLibraryFolder({
      supabase,
      tenantId,
      userId,
      folderId,
      name: String(body.name ?? ""),
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleArchiveMediaLibraryFolderPost(
  _request: Request,
  context: FolderRouteContext,
  dependencies: ArchiveFolderDependencies,
) {
  try {
    const { supabase, tenantId, userId } = await requireAuthenticatedTenantContext(
      dependencies.createClient,
      dependencies.resolveTenantId,
    );
    const { folderId } = await context.params;

    const result = await dependencies.archiveMediaLibraryFolder({
      supabase,
      tenantId,
      userId,
      folderId,
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleMoveMediaLibraryFolderPost(
  request: Request,
  context: FolderRouteContext,
  dependencies: MoveFolderDependencies,
) {
  try {
    const { supabase, tenantId, userId } = await requireAuthenticatedTenantContext(
      dependencies.createClient,
      dependencies.resolveTenantId,
    );
    const body = await parseJsonBody<FolderMoveBody>(request);
    const { folderId } = await context.params;

    if (!Object.prototype.hasOwnProperty.call(body, "parentFolderId")) {
      throw new HttpError(400, "invalid_parent_folder_id", "Select a valid parent folder.");
    }
    if (
      body.parentFolderId !== null
      && (typeof body.parentFolderId !== "string" || body.parentFolderId.trim().length === 0)
    ) {
      throw new HttpError(400, "invalid_parent_folder_id", "Select a valid parent folder.");
    }

    const result = await dependencies.moveMediaLibraryFolder({
      supabase,
      tenantId,
      userId,
      folderId,
      parentFolderId: body.parentFolderId === null ? null : body.parentFolderId.trim(),
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}

async function handleFolderAssetMutationPost(
  request: Request,
  context: FolderRouteContext,
  dependencies: FolderAssetMutationDependencies,
) {
  try {
    const { supabase, tenantId, userId } = await requireAuthenticatedTenantContext(
      dependencies.createClient,
      dependencies.resolveTenantId,
    );
    const body = await parseJsonBody<FolderAssetBody>(request);
    const { folderId } = await context.params;

    if (!Array.isArray(body.mediaLibraryAssetIds)) {
      throw new HttpError(
        400,
        "invalid_media_library_asset_ids",
        "Select at least one Media Library asset.",
      );
    }

    const result = await dependencies.mutateFolderAssets({
      supabase,
      tenantId,
      userId,
      folderId,
      mediaLibraryAssetIds: body.mediaLibraryAssetIds.map((value) => String(value)),
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function handleAddMediaLibraryAssetsToFolderPost(
  request: Request,
  context: FolderRouteContext,
  dependencies: FolderAssetMutationDependencies,
) {
  return handleFolderAssetMutationPost(request, context, dependencies);
}

export async function handleMoveMediaLibraryAssetsToFolderPost(
  request: Request,
  context: FolderRouteContext,
  dependencies: FolderAssetMutationDependencies,
) {
  return handleFolderAssetMutationPost(request, context, dependencies);
}

export async function handleRemoveMediaLibraryAssetsFromFolderPost(
  request: Request,
  context: FolderRouteContext,
  dependencies: FolderAssetMutationDependencies,
) {
  return handleFolderAssetMutationPost(request, context, dependencies);
}
