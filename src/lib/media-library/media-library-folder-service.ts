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
    .select("id, tenant_id, name, created_at, created_by, updated_at, updated_by, archived_at, archived_by")
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

async function loadActiveFolderById(input: {
  supabase: SupabaseClient;
  tenantId: string;
  folderId: string;
}) {
  const folder = await loadFolderById(input);
  if (folder.archived_at) {
    throw new HttpError(409, "folder_archived", "Archived folders cannot be changed.");
  }

  return folder;
}

async function loadActiveFolderByName(input: {
  supabase: SupabaseClient;
  tenantId: string;
  name: string;
}) {
  const { data, error } = await input.supabase
    .from("media_library_folders")
    .select("id, tenant_id, name, created_at, created_by, updated_at, updated_by, archived_at, archived_by")
    .eq("tenant_id", input.tenantId)
    .eq("name", input.name)
    .is("archived_at", null)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "media_library_write_failed", "Unable to load the Media Library folder.");
  }

  const folder = (data as MediaLibraryFolderRow | null) ?? null;
  if (!folder) {
    throw new HttpError(500, "media_library_write_failed", "Unable to load the Media Library folder.");
  }

  return folder;
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
    .select("id, tenant_id, name, created_at, created_by, updated_at, updated_by, archived_at, archived_by")
    .eq("tenant_id", input.tenantId)
    .is("archived_at", null)
    .order("name", { ascending: true });

  if (error) {
    throw new HttpError(500, "media_library_lookup_failed", "Unable to load Media Library folders.");
  }

  return ((data ?? []) as MediaLibraryFolderRow[]).map(mapFolderRecord);
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
  const { error } = await input.supabase
    .from("media_library_folders")
    .insert({
      tenant_id: input.tenantId,
      name: normalizedName,
      created_by: input.userId,
      updated_by: input.userId,
      updated_at: now,
    });

  if (isUniqueViolation(error)) {
    throw new HttpError(409, "folder_name_conflict", "An active folder already uses that name.");
  }

  if (error) {
    throw new HttpError(500, "media_library_write_failed", "Unable to create the Media Library folder.");
  }

  return mapFolderRecord(
    await loadActiveFolderByName({
      supabase: adminSupabase,
      tenantId: input.tenantId,
      name: normalizedName,
    }),
  );
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
