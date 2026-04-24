import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  getAssetUploadMaxFileSizeBytes,
  isAcceptedAssetUpload,
  type AssetUploadType,
} from "@/lib/assets/asset-upload-policy";
import { HttpError } from "@/lib/http/errors";
import { runChunkedRead } from "@/lib/supabase/safe-in-filter";

const STORAGE_BUCKET = "project-assets";
const DEFAULT_HEADSHOT_RETENTION_DAYS = 90;
const MAX_REQUEST_CONSENT_IDS = 50;

export type AssetType = AssetUploadType;

type CreateAssetInput = {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
  workspaceId?: string | null;
  userId: string;
  idempotencyKey: string;
  originalFilename: string;
  contentType: string;
  fileSizeBytes: number;
  consentIds: string[];
  contentHash?: string | null;
  contentHashAlgo?: string | null;
  assetType?: string | null;
  duplicatePolicy: "upload_anyway" | "overwrite" | "ignore";
  projectAccessValidated?: boolean;
};

type IdempotencyPayload = {
  assetId: string;
  storagePath: string;
  storageBucket: string;
};

type CreateAssetPayload =
  | {
      skipUpload: true;
      duplicate: true;
    }
  | {
      assetId: string;
      storageBucket: string;
      storagePath: string;
      signedUrl: string;
    };

type CreateAssetResult = {
  status: number;
  payload: CreateAssetPayload;
};

function sanitizeFilename(filename: string) {
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_");
  const trimmed = sanitized.replace(/^_+|_+$/g, "");
  if (!trimmed) {
    return "upload";
  }
  return trimmed.length > 120 ? trimmed.slice(0, 120) : trimmed;
}

function normalizeConsentIds(consentIds: string[]) {
  const unique = Array.from(new Set(consentIds.map((consentId) => String(consentId ?? "").trim()).filter(Boolean)));
  if (unique.length > MAX_REQUEST_CONSENT_IDS) {
    throw new HttpError(400, "invalid_consent_ids_too_large", "Too many consent IDs were provided.");
  }
  return unique;
}

async function validateConsents(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  workspaceId: string | null | undefined,
  consentIds: string[],
) {
  if (consentIds.length === 0) {
    return;
  }

  const data = await runChunkedRead(consentIds, async (consentIdChunk) => {
    // safe-in-filter: asset consent validation is request-bounded and chunked by shared helper.
    const query = supabase
      .from("consents")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .in("id", consentIdChunk);

    if (workspaceId) {
      query.eq("workspace_id", workspaceId);
    }

    const { data: rows, error } = await query;

    if (error) {
      throw new HttpError(500, "consent_lookup_failed", "Unable to validate consent links.");
    }

    return (rows ?? []) as Array<{ id: string }>;
  });

  const found = new Set((data ?? []).map((row) => row.id));
  const missing = consentIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new HttpError(400, "invalid_consent_ids", "One or more consent IDs are invalid.");
  }
}

export async function ensureProjectAccess(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
) {
  const { data, error } = await supabase
    .from("projects")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("id", projectId)
    .maybeSingle();

  if (error) {
    throw new HttpError(500, "project_lookup_failed", "Unable to load project.");
  }

  if (!data) {
    throw new HttpError(404, "project_not_found", "Project not found.");
  }
}

function validateFileMetadata(
  assetType: AssetType,
  originalFilename: string,
  contentType: string,
  fileSizeBytes: number,
) {
  if (!originalFilename || originalFilename.length > 255) {
    throw new HttpError(400, "invalid_filename", "File name is required.");
  }

  if (!isAcceptedAssetUpload(assetType, contentType, originalFilename)) {
    throw new HttpError(400, "invalid_content_type", "Unsupported file type.");
  }

  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
    throw new HttpError(400, "invalid_file_size", "File size is required.");
  }

  if (fileSizeBytes > getAssetUploadMaxFileSizeBytes(assetType)) {
    throw new HttpError(400, "file_too_large", "File is too large.");
  }
}

function normalizeContentHash(value: string | null | undefined) {
  const trimmed = String(value ?? "").trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  if (!/^[a-f0-9]{64}$/.test(trimmed)) {
    throw new HttpError(400, "invalid_content_hash", "Invalid content hash.");
  }
  return trimmed;
}

function normalizeDuplicatePolicy(value: string) {
  if (value === "upload_anyway" || value === "overwrite" || value === "ignore") {
    return value;
  }
  throw new HttpError(400, "invalid_duplicate_policy", "Invalid duplicate policy.");
}

function normalizeAssetType(value: string | null | undefined): AssetType {
  if (value === "headshot") {
    return "headshot";
  }

  if (value === "video") {
    return "video";
  }

  if (!value || value === "photo") {
    return "photo";
  }

  throw new HttpError(400, "invalid_asset_type", "Invalid asset type.");
}

function getHeadshotRetentionDays() {
  const raw = String(process.env.HEADSHOT_RETENTION_DAYS ?? "").trim();
  if (!raw) {
    return DEFAULT_HEADSHOT_RETENTION_DAYS;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > 3650) {
    return DEFAULT_HEADSHOT_RETENTION_DAYS;
  }

  return Math.floor(parsed);
}

function getRetentionExpiresAt(assetType: AssetType) {
  if (assetType !== "headshot") {
    return null;
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + getHeadshotRetentionDays());
  return expiresAt.toISOString();
}

function createStorageAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new HttpError(500, "supabase_admin_not_configured", "Missing Supabase service role configuration.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function createAssetWithIdempotency(
  input: CreateAssetInput,
): Promise<CreateAssetResult> {
  const workspaceId = input.workspaceId?.trim() || null;
  const consentIds = normalizeConsentIds(input.consentIds);
  const assetType = normalizeAssetType(input.assetType ?? "photo");
  validateFileMetadata(assetType, input.originalFilename, input.contentType, input.fileSizeBytes);
  if (!input.projectAccessValidated) {
    await ensureProjectAccess(input.supabase, input.tenantId, input.projectId);
  }
  await validateConsents(
    input.supabase,
    input.tenantId,
    input.projectId,
    workspaceId,
    consentIds,
  );

  const contentHash = normalizeContentHash(input.contentHash ?? null);
  const duplicatePolicy = normalizeDuplicatePolicy(input.duplicatePolicy);
  if (contentHash && input.contentHashAlgo && input.contentHashAlgo !== "sha256") {
    throw new HttpError(400, "invalid_hash_algo", "Unsupported content hash algorithm.");
  }

  const operation = workspaceId
    ? `create_project_asset:${input.projectId}:${workspaceId}`
    : `create_project_asset:${input.projectId}`;
  const admin = createStorageAdminClient();

  const { data: existingIdempotency, error: idempotencyReadError } = await input.supabase
    .from("idempotency_keys")
    .select("response_json")
    .eq("tenant_id", input.tenantId)
    .eq("operation", operation)
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();

  if (idempotencyReadError) {
    throw new HttpError(500, "idempotency_lookup_failed", "Unable to create asset right now.");
  }

  if (existingIdempotency?.response_json) {
    const payload = existingIdempotency.response_json as IdempotencyPayload;
    let assetQuery = input.supabase
      .from("assets")
      .select("id, storage_path, storage_bucket, asset_type")
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .eq("id", payload.assetId);

    if (workspaceId) {
      assetQuery = assetQuery.eq("workspace_id", workspaceId);
    }

    const { data: asset } = await assetQuery.maybeSingle();

    if (!asset) {
      throw new HttpError(409, "idempotency_mismatch", "Unable to reuse asset request.");
    }

    if (asset.asset_type !== assetType) {
      throw new HttpError(409, "idempotency_mismatch", "Unable to reuse asset request.");
    }

    const { data: signedData, error: signedError } = await admin.storage
      .from(payload.storageBucket)
      .createSignedUploadUrl(payload.storagePath);

    if (signedError || !signedData?.signedUrl) {
      throw new HttpError(500, "signed_url_failed", "Unable to create upload URL.");
    }

    return {
      status: 200,
      payload: {
        assetId: asset.id,
        storageBucket: payload.storageBucket,
        storagePath: payload.storagePath,
        signedUrl: signedData.signedUrl,
      },
    };
  }

  if (assetType !== "video" && contentHash && duplicatePolicy !== "upload_anyway") {
    let duplicateQuery = input.supabase
      .from("assets")
      .select("id")
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .eq("asset_type", assetType)
      .eq("content_hash", contentHash)
      .limit(1);

    if (workspaceId) {
      duplicateQuery = duplicateQuery.eq("workspace_id", workspaceId);
    }

    const { data: duplicates, error: duplicateError } = await duplicateQuery;

    if (duplicateError) {
      throw new HttpError(500, "duplicate_lookup_failed", "Unable to check for duplicates.");
    }

    const hasDuplicate = (duplicates ?? []).length > 0;
    if (hasDuplicate && duplicatePolicy === "ignore") {
      return {
        status: 200,
        payload: {
          skipUpload: true,
          duplicate: true,
        },
      };
    }

    if (hasDuplicate && duplicatePolicy === "overwrite") {
      const now = new Date().toISOString();
      let archiveQuery = input.supabase
        .from("assets")
        .update({ status: "archived", archived_at: now })
        .eq("tenant_id", input.tenantId)
        .eq("project_id", input.projectId)
        .eq("asset_type", assetType)
        .eq("content_hash", contentHash)
        .neq("status", "archived");

      if (workspaceId) {
        archiveQuery = archiveQuery.eq("workspace_id", workspaceId);
      }

      const { error: archiveError } = await archiveQuery;

      if (archiveError) {
        throw new HttpError(500, "duplicate_archive_failed", "Unable to archive duplicates.");
      }
    }
  }

  const assetId = crypto.randomUUID();
  const safeName = sanitizeFilename(input.originalFilename);
  const storagePath = `tenant/${input.tenantId}/project/${input.projectId}/asset/${assetId}/${safeName}`;
  const retentionExpiresAt = getRetentionExpiresAt(assetType);

  const assetInsert = {
    id: assetId,
    tenant_id: input.tenantId,
    project_id: input.projectId,
    ...(workspaceId ? { workspace_id: workspaceId } : {}),
    created_by: input.userId,
    storage_bucket: STORAGE_BUCKET,
    storage_path: storagePath,
    original_filename: input.originalFilename,
    content_type: input.contentType,
    file_size_bytes: input.fileSizeBytes,
    content_hash: contentHash,
    content_hash_algo: contentHash ? (input.contentHashAlgo ?? "sha256") : null,
    asset_type: assetType,
    retention_expires_at: retentionExpiresAt,
    status: "pending",
  };

  const { data: asset, error: assetError } = await input.supabase
    .from("assets")
    .insert(assetInsert)
    .select("id")
    .single();

  if (assetError || !asset) {
    throw new HttpError(500, "asset_create_failed", "Unable to create asset.");
  }

  const idempotencyPayload: IdempotencyPayload = {
    assetId: asset.id,
    storagePath,
    storageBucket: STORAGE_BUCKET,
  };

  const { error: idempotencyWriteError } = await input.supabase.from("idempotency_keys").upsert(
    {
      tenant_id: input.tenantId,
      operation,
      idempotency_key: input.idempotencyKey,
      response_json: idempotencyPayload,
      created_by: input.userId,
    },
    {
      onConflict: "tenant_id,operation,idempotency_key",
      ignoreDuplicates: true,
    },
  );

  if (idempotencyWriteError) {
    throw new HttpError(500, "idempotency_write_failed", "Unable to persist asset idempotency.");
  }

  const { data: signedData, error: signedError } = await admin.storage
    .from(STORAGE_BUCKET)
    .createSignedUploadUrl(storagePath);

  if (signedError || !signedData?.signedUrl) {
    throw new HttpError(500, "signed_url_failed", "Unable to create upload URL.");
  }

  return {
    status: 201,
    payload: {
      assetId: asset.id,
      storageBucket: STORAGE_BUCKET,
      storagePath,
      signedUrl: signedData.signedUrl,
    },
  };
}
