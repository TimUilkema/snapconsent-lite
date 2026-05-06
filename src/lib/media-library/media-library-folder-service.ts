import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import {
  authorizeMediaLibraryAccess,
  authorizeMediaLibraryFolderManagement,
} from "@/lib/tenant/media-library-custom-role-access";

type MediaLibraryFolderRow = {
  id: string;
  tenant_id: string;
  name: string;
  parent_folder_id: string | null;
  created_at: string;
  created_by: string;
  updated_at: string;
  updated_by: string;
  archived_at: string | null;
  archived_by: string | null;
};

type MediaLibraryAssetRow = {
  id: string;
  tenant_id: string;
};

type MediaLibraryFolderMembershipRow = {
  id: string;
  tenant_id: string;
  media_library_asset_id: string;
  folder_id: string;
};

export type MediaLibraryFolderRecord = {
  id: string;
  name: string;
  parentFolderId: string | null;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  archivedAt: string | null;
  archivedBy: string | null;
};

export type MediaLibraryFolderBatchResult = {
  folderId: string;
  requestedCount: number;
  changedCount: number;
  noopCount: number;
};

type MediaLibraryFolderMoveRpcRow = {
  ok: boolean;
  error_code: string | null;
  folder_id: string | null;
  parent_folder_id: string | null;
  name: string | null;
  updated_at: string | null;
  updated_by: string | null;
  changed: boolean;
};

function isUniqueViolation(error: { code?: string } | null | undefined) {
  return error?.code === "23505";
}

function createServiceRoleClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new HttpError(500, "server_configuration_error", "Supabase service credentials are not configured.");
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function mapFolderRecord(row: MediaLibraryFolderRow): MediaLibraryFolderRecord {
  return {
    id: row.id,
    name: row.name,
    parentFolderId: row.parent_folder_id,
    createdAt: row.created_at,
    createdBy: row.created_by,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
    archivedAt: row.archived_at,
    archivedBy: row.archived_by,
  };
}

function normalizeFolderName(name: string) {
  return name.trim().replace(/\s+/g, " ");
}

function normalizeMediaLibraryAssetIds(mediaLibraryAssetIds: string[]) {
  return Array.from(
    new Set(
      mediaLibraryAssetIds
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  );
}

async function loadFolderById(input: {
  supabase: SupabaseClient;
  tenantId: string;
  folderId: string;
}) {
  const { data, error } = await input.supabase
    .from("media_library_folders")
    .select("id, tenant_id, name, parent_folder_id, created_at, created_by, updated_at, updated_by, archived_at, archived_by")
    .eq("tenant_id", input.tenantId)
    .eq("id", input.folderId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "media_library_write_failed", "Unable to load the Media Library folder.");
  }

  const folder = (data as MediaLibraryFolderRow | null) ?? null;
  if (!folder) {
    throw new HttpError(404, "folder_not_found", "Folder not found.");
  }

  return folder;
}

async function folderHasArchivedAncestor(input: {
  supabase: SupabaseClient;
  tenantId: string;
  folder: Pick<MediaLibraryFolderRow, "id" | "parent_folder_id">;
}) {
  const visited = new Set<string>([input.folder.id]);
  let parentFolderId = input.folder.parent_folder_id;

  while (parentFolderId) {
    if (visited.has(parentFolderId)) {
      return true;
    }
    visited.add(parentFolderId);

    const { data, error } = await input.supabase
      .from("media_library_folders")
      .select("id, tenant_id, parent_folder_id, archived_at")
      .eq("tenant_id", input.tenantId)
      .eq("id", parentFolderId)
      .maybeSingle();

    if (error) {
      throw new HttpError(500, "media_library_lookup_failed", "Unable to load Media Library folder ancestors.");
    }

    const parent = (data as Pick<MediaLibraryFolderRow, "id" | "tenant_id" | "parent_folder_id" | "archived_at"> | null) ?? null;
    if (!parent || parent.archived_at) {
      return true;
    }

    parentFolderId = parent.parent_folder_id;
  }

  return false;
}

async function loadActiveFolderById(input: {
  supabase: SupabaseClient;
  tenantId: string;
  folderId: string;
}) {
  const folder = await loadFolderById(input);
  if (folder.archived_at) {
    throw new HttpError(409, "folder_archived", "Archived folders cannot be changed.");
  }
  if (await folderHasArchivedAncestor({ ...input, folder })) {
    throw new HttpError(409, "folder_archived", "Archived folders cannot be changed.");
  }

  return folder;
}

function mapFolderMoveRpcError(errorCode: string | null | undefined) {
  switch (errorCode) {
    case "folder_not_found":
      return new HttpError(404, "folder_not_found", "Folder not found.");
    case "target_folder_not_found":
      return new HttpError(404, "target_folder_not_found", "Target folder not found.");
    case "folder_archived":
      return new HttpError(409, "folder_archived", "Archived folders cannot be changed.");
    case "target_folder_archived":
      return new HttpError(409, "target_folder_archived", "Target folder is archived.");
    case "folder_move_into_self":
      return new HttpError(409, "folder_move_into_self", "A folder cannot be moved into itself.");
    case "folder_move_into_descendant":
      return new HttpError(409, "folder_move_into_descendant", "A folder cannot be moved into one of its child folders.");
    case "folder_name_conflict":
      return new HttpError(409, "folder_name_conflict", "An active folder already uses that name in this location.");
    default:
      return new HttpError(409, "folder_move_conflict", "Unable to move the Media Library folder.");
  }
}

async function loadMediaLibraryAssetsById(input: {
  supabase: SupabaseClient;
  tenantId: string;
  mediaLibraryAssetIds: string[];
}) {
  const { data, error } = await input.supabase
    .from("media_library_assets")
    .select("id, tenant_id")
    .eq("tenant_id", input.tenantId)
    .in("id", input.mediaLibraryAssetIds);

  if (error) {
    throw new HttpError(
      500,
      "media_library_write_failed",
      "Unable to load Media Library asset identities.",
    );
  }

  const rows = (data ?? []) as MediaLibraryAssetRow[];
  if (rows.length !== input.mediaLibraryAssetIds.length) {
    throw new HttpError(404, "media_library_asset_not_found", "Media Library asset not found.");
  }

  return rows;
}

async function loadMembershipsByAssetId(input: {
  supabase: SupabaseClient;
  tenantId: string;
  mediaLibraryAssetIds: string[];
}) {
  if (input.mediaLibraryAssetIds.length === 0) {
    return new Map<string, MediaLibraryFolderMembershipRow>();
  }

  const { data, error } = await input.supabase
    .from("media_library_folder_memberships")
    .select("id, tenant_id, media_library_asset_id, folder_id")
    .eq("tenant_id", input.tenantId)
    .in("media_library_asset_id", input.mediaLibraryAssetIds);

  if (error) {
    throw new HttpError(
      500,
      "media_library_write_failed",
      "Unable to load Media Library folder memberships.",
    );
  }

  return new Map(
    ((data ?? []) as MediaLibraryFolderMembershipRow[]).map((row) => [row.media_library_asset_id, row] as const),
  );
}

export async function listActiveMediaLibraryFolders(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
}) {
  await authorizeMediaLibraryAccess(input);

  const { data, error } = await input.supabase
    .from("media_library_folders")
    .select("id, tenant_id, name, parent_folder_id, created_at, created_by, updated_at, updated_by, archived_at, archived_by")
    .eq("tenant_id", input.tenantId)
    .is("archived_at", null)
    .order("name", { ascending: true });

  if (error) {
    throw new HttpError(500, "media_library_lookup_failed", "Unable to load Media Library folders.");
  }

  const rows = (data ?? []) as MediaLibraryFolderRow[];
  const rowById = new Map(rows.map((row) => [row.id, row] as const));
  return rows
    .filter((row) => {
      let parentFolderId = row.parent_folder_id;
      const visited = new Set<string>([row.id]);
      while (parentFolderId) {
        if (visited.has(parentFolderId)) {
          return false;
        }
        visited.add(parentFolderId);
        const parent = rowById.get(parentFolderId) ?? null;
        if (!parent) {
          return false;
        }
        parentFolderId = parent.parent_folder_id;
      }
      return true;
    })
    .map(mapFolderRecord);
}

export async function getActiveMediaLibraryFolder(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  folderId: string;
}) {
  await authorizeMediaLibraryAccess(input);
  return mapFolderRecord(
    await loadActiveFolderById({
      supabase: input.supabase,
      tenantId: input.tenantId,
      folderId: input.folderId,
    }),
  );
}

export async function createMediaLibraryFolder(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  name: string;
}) {
  await authorizeMediaLibraryFolderManagement(input);

  const normalizedName = normalizeFolderName(input.name);
  if (!normalizedName) {
    throw new HttpError(400, "invalid_folder_name", "Folder name is required.");
  }

  const adminSupabase = createServiceRoleClient();
  const now = new Date().toISOString();
  const { data, error } = await adminSupabase
    .from("media_library_folders")
    .insert({
      tenant_id: input.tenantId,
      name: normalizedName,
      created_by: input.userId,
      updated_by: input.userId,
      updated_at: now,
    })
    .select("id, tenant_id, name, parent_folder_id, created_at, created_by, updated_at, updated_by, archived_at, archived_by")
    .single();

  if (isUniqueViolation(error)) {
    throw new HttpError(409, "folder_name_conflict", "An active folder already uses that name.");
  }

  if (error) {
    throw new HttpError(500, "media_library_write_failed", "Unable to create the Media Library folder.");
  }

  return mapFolderRecord(data as MediaLibraryFolderRow);
}

export async function renameMediaLibraryFolder(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  folderId: string;
  name: string;
}) {
  await authorizeMediaLibraryFolderManagement(input);

  const adminSupabase = createServiceRoleClient();
  const folder = await loadActiveFolderById({
    supabase: adminSupabase,
    tenantId: input.tenantId,
    folderId: input.folderId,
  });
  const normalizedName = normalizeFolderName(input.name);
  if (!normalizedName) {
    throw new HttpError(400, "invalid_folder_name", "Folder name is required.");
  }

  if (normalizeFolderName(folder.name).toLowerCase() === normalizedName.toLowerCase()) {
    return {
      folder: mapFolderRecord(folder),
      changed: false,
    };
  }

  const now = new Date().toISOString();
  const { error } = await adminSupabase
    .from("media_library_folders")
    .update({
      name: normalizedName,
      updated_at: now,
      updated_by: input.userId,
    })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.folderId)
    .is("archived_at", null);

  if (isUniqueViolation(error)) {
    throw new HttpError(409, "folder_name_conflict", "An active folder already uses that name.");
  }

  if (error) {
    throw new HttpError(500, "media_library_write_failed", "Unable to rename the Media Library folder.");
  }

  return {
    folder: mapFolderRecord(
      await loadActiveFolderById({
        supabase: adminSupabase,
        tenantId: input.tenantId,
        folderId: input.folderId,
      }),
    ),
    changed: true,
  };
}

export async function archiveMediaLibraryFolder(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  folderId: string;
}) {
  await authorizeMediaLibraryFolderManagement(input);

  const adminSupabase = createServiceRoleClient();
  const folder = await loadFolderById({
    supabase: adminSupabase,
    tenantId: input.tenantId,
    folderId: input.folderId,
  });
  if (folder.archived_at) {
    return {
      folder: mapFolderRecord(folder),
      changed: false,
    };
  }

  const archivedAt = new Date().toISOString();
  const { error } = await adminSupabase
    .from("media_library_folders")
    .update({
      archived_at: archivedAt,
      archived_by: input.userId,
      updated_at: archivedAt,
      updated_by: input.userId,
    })
    .eq("tenant_id", input.tenantId)
    .eq("id", input.folderId)
    .is("archived_at", null);

  if (error) {
    throw new HttpError(500, "media_library_write_failed", "Unable to archive the Media Library folder.");
  }

  return {
    folder: mapFolderRecord(
      await loadFolderById({
        supabase: adminSupabase,
        tenantId: input.tenantId,
        folderId: input.folderId,
      }),
    ),
    changed: true,
  };
}

export async function moveMediaLibraryFolder(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  folderId: string;
  parentFolderId: string | null;
}) {
  await authorizeMediaLibraryFolderManagement(input);

  const normalizedParentFolderId = input.parentFolderId?.trim() ? input.parentFolderId.trim() : null;
  const adminSupabase = createServiceRoleClient();
  const { data, error } = await adminSupabase.rpc("move_media_library_folder", {
    p_tenant_id: input.tenantId,
    p_folder_id: input.folderId,
    p_parent_folder_id: normalizedParentFolderId,
    p_actor_user_id: input.userId,
  });

  if (isUniqueViolation(error)) {
    throw new HttpError(409, "folder_name_conflict", "An active folder already uses that name in this location.");
  }

  if (error) {
    throw new HttpError(500, "media_library_write_failed", "Unable to move the Media Library folder.");
  }

  const rows = (data ?? []) as MediaLibraryFolderMoveRpcRow[];
  const result = rows[0] ?? null;
  if (!result) {
    throw new HttpError(500, "media_library_write_failed", "Unable to move the Media Library folder.");
  }

  if (!result.ok) {
    throw mapFolderMoveRpcError(result.error_code);
  }

  if (!result.folder_id || !result.name || !result.updated_at || !result.updated_by) {
    throw new HttpError(500, "media_library_write_failed", "Unable to move the Media Library folder.");
  }

  return {
    folder: {
      id: result.folder_id,
      name: result.name,
      parentFolderId: result.parent_folder_id,
      updatedAt: result.updated_at,
      updatedBy: result.updated_by,
    },
    changed: result.changed,
  };
}

export async function addMediaLibraryAssetsToFolder(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  folderId: string;
  mediaLibraryAssetIds: string[];
}) {
  await authorizeMediaLibraryFolderManagement(input);

  const adminSupabase = createServiceRoleClient();
  const folder = await loadActiveFolderById({
    supabase: adminSupabase,
    tenantId: input.tenantId,
    folderId: input.folderId,
  });
  const assetIds = normalizeMediaLibraryAssetIds(input.mediaLibraryAssetIds);
  if (assetIds.length === 0) {
    throw new HttpError(400, "invalid_media_library_asset_ids", "Select at least one Media Library asset.");
  }

  await loadMediaLibraryAssetsById({
    supabase: adminSupabase,
    tenantId: input.tenantId,
    mediaLibraryAssetIds: assetIds,
  });

  const existingMemberships = await loadMembershipsByAssetId({
    supabase: adminSupabase,
    tenantId: input.tenantId,
    mediaLibraryAssetIds: assetIds,
  });

  for (const assetId of assetIds) {
    const membership = existingMemberships.get(assetId) ?? null;
    if (membership && membership.folder_id !== folder.id) {
      throw new HttpError(
        409,
        "media_library_asset_already_assigned",
        "A selected Media Library asset already belongs to another folder.",
      );
    }
  }

  const missingAssetIds = assetIds.filter((assetId) => !existingMemberships.has(assetId));
  if (missingAssetIds.length > 0) {
    const now = new Date().toISOString();
    const { error } = await adminSupabase
      .from("media_library_folder_memberships")
      .upsert(
        missingAssetIds.map((assetId) => ({
          tenant_id: input.tenantId,
          media_library_asset_id: assetId,
          folder_id: folder.id,
          created_by: input.userId,
          updated_by: input.userId,
          updated_at: now,
        })),
        {
          onConflict: "tenant_id,media_library_asset_id",
          ignoreDuplicates: true,
        },
      );

    if (error) {
      throw new HttpError(
        500,
        "media_library_write_failed",
        "Unable to assign Media Library assets to the folder.",
      );
    }

    const membershipsAfterInsert = await loadMembershipsByAssetId({
      supabase: adminSupabase,
      tenantId: input.tenantId,
      mediaLibraryAssetIds: assetIds,
    });
    for (const assetId of assetIds) {
      const membership = membershipsAfterInsert.get(assetId) ?? null;
      if (!membership || membership.folder_id !== folder.id) {
        throw new HttpError(
          409,
          "media_library_asset_already_assigned",
          "A selected Media Library asset already belongs to another folder.",
        );
      }
    }
  }

  return {
    folderId: folder.id,
    requestedCount: assetIds.length,
    changedCount: missingAssetIds.length,
    noopCount: assetIds.length - missingAssetIds.length,
  } satisfies MediaLibraryFolderBatchResult;
}

export async function moveMediaLibraryAssetsToFolder(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  folderId: string;
  mediaLibraryAssetIds: string[];
}) {
  await authorizeMediaLibraryFolderManagement(input);

  const adminSupabase = createServiceRoleClient();
  const folder = await loadActiveFolderById({
    supabase: adminSupabase,
    tenantId: input.tenantId,
    folderId: input.folderId,
  });
  const assetIds = normalizeMediaLibraryAssetIds(input.mediaLibraryAssetIds);
  if (assetIds.length === 0) {
    throw new HttpError(400, "invalid_media_library_asset_ids", "Select at least one Media Library asset.");
  }

  await loadMediaLibraryAssetsById({
    supabase: adminSupabase,
    tenantId: input.tenantId,
    mediaLibraryAssetIds: assetIds,
  });

  const initialMemberships = await loadMembershipsByAssetId({
    supabase: adminSupabase,
    tenantId: input.tenantId,
    mediaLibraryAssetIds: assetIds,
  });
  const missingAssetIds = assetIds.filter((assetId) => !initialMemberships.has(assetId));

  if (missingAssetIds.length > 0) {
    const now = new Date().toISOString();
    const { error } = await adminSupabase
      .from("media_library_folder_memberships")
      .upsert(
        missingAssetIds.map((assetId) => ({
          tenant_id: input.tenantId,
          media_library_asset_id: assetId,
          folder_id: folder.id,
          created_by: input.userId,
          updated_by: input.userId,
          updated_at: now,
        })),
        {
          onConflict: "tenant_id,media_library_asset_id",
          ignoreDuplicates: true,
        },
      );

    if (error) {
      throw new HttpError(
        500,
        "media_library_write_failed",
        "Unable to move Media Library assets into the folder.",
      );
    }
  }

  const membershipsAfterInsert = await loadMembershipsByAssetId({
    supabase: adminSupabase,
    tenantId: input.tenantId,
    mediaLibraryAssetIds: assetIds,
  });
  const assetIdsToMove = assetIds.filter((assetId) => {
    const membership = membershipsAfterInsert.get(assetId) ?? null;
    return membership && membership.folder_id !== folder.id;
  });

  if (assetIdsToMove.length > 0) {
    const now = new Date().toISOString();
    const { error } = await adminSupabase
      .from("media_library_folder_memberships")
      .update({
        folder_id: folder.id,
        updated_at: now,
        updated_by: input.userId,
      })
      .eq("tenant_id", input.tenantId)
      .in("media_library_asset_id", assetIdsToMove);

    if (error) {
      throw new HttpError(
        500,
        "media_library_write_failed",
        "Unable to move Media Library assets into the folder.",
      );
    }
  }

  return {
    folderId: folder.id,
    requestedCount: assetIds.length,
    changedCount: missingAssetIds.length + assetIdsToMove.length,
    noopCount: assetIds.length - missingAssetIds.length - assetIdsToMove.length,
  } satisfies MediaLibraryFolderBatchResult;
}

export async function removeMediaLibraryAssetsFromFolder(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  folderId: string;
  mediaLibraryAssetIds: string[];
}) {
  await authorizeMediaLibraryFolderManagement(input);

  const adminSupabase = createServiceRoleClient();
  await loadActiveFolderById({
    supabase: adminSupabase,
    tenantId: input.tenantId,
    folderId: input.folderId,
  });
  const assetIds = normalizeMediaLibraryAssetIds(input.mediaLibraryAssetIds);
  if (assetIds.length === 0) {
    throw new HttpError(400, "invalid_media_library_asset_ids", "Select at least one Media Library asset.");
  }

  await loadMediaLibraryAssetsById({
    supabase: adminSupabase,
    tenantId: input.tenantId,
    mediaLibraryAssetIds: assetIds,
  });

  const memberships = await loadMembershipsByAssetId({
    supabase: adminSupabase,
    tenantId: input.tenantId,
    mediaLibraryAssetIds: assetIds,
  });
  const membershipIdsToDelete = assetIds
    .map((assetId) => memberships.get(assetId) ?? null)
    .filter((membership): membership is MediaLibraryFolderMembershipRow => Boolean(membership && membership.folder_id === input.folderId))
    .map((membership) => membership.id);

  if (membershipIdsToDelete.length > 0) {
    const { error } = await adminSupabase
      .from("media_library_folder_memberships")
      .delete()
      .eq("tenant_id", input.tenantId)
      .in("id", membershipIdsToDelete);

    if (error) {
      throw new HttpError(
        500,
        "media_library_write_failed",
        "Unable to remove Media Library assets from the folder.",
      );
    }
  }

  return {
    folderId: input.folderId,
    requestedCount: assetIds.length,
    changedCount: membershipIdsToDelete.length,
    noopCount: assetIds.length - membershipIdsToDelete.length,
  } satisfies MediaLibraryFolderBatchResult;
}
