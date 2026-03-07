import type { SupabaseClient } from "@supabase/supabase-js";

import { HttpError } from "@/lib/http/errors";
import { createAdminClient } from "@/lib/supabase/admin";

const STORAGE_BUCKET = "project-assets";
const SIGNED_URL_TTL_SECONDS = 60;
const MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024;
const DEFAULT_HEADSHOT_RETENTION_DAYS = 90;
const ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export type AssetType = "photo" | "headshot";

type CreateAssetInput = {
  supabase: SupabaseClient;
  tenantId: string;
  projectId: string;
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

async function validateConsents(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  consentIds: string[],
) {
  if (consentIds.length === 0) {
    return;
  }

  const { data, error } = await supabase
    .from("consents")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("project_id", projectId)
    .in("id", consentIds);

  if (error) {
    throw new HttpError(500, "consent_lookup_failed", "Unable to validate consent links.");
  }

  const found = new Set((data ?? []).map((row) => row.id));
  const missing = consentIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new HttpError(400, "invalid_consent_ids", "One or more consent IDs are invalid.");
  }
}

async function ensureProjectAccess(
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
  originalFilename: string,
  contentType: string,
  fileSizeBytes: number,
) {
  if (!originalFilename || originalFilename.length > 255) {
    throw new HttpError(400, "invalid_filename", "File name is required.");
  }

  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new HttpError(400, "invalid_content_type", "Unsupported file type.");
  }

  if (!Number.isFinite(fileSizeBytes) || fileSizeBytes <= 0) {
    throw new HttpError(400, "invalid_file_size", "File size is required.");
  }

  if (fileSizeBytes > MAX_FILE_SIZE_BYTES) {
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

export async function createAssetWithIdempotency(
  input: CreateAssetInput,
): Promise<CreateAssetResult> {
  input.consentIds = Array.from(new Set(input.consentIds));
  validateFileMetadata(input.originalFilename, input.contentType, input.fileSizeBytes);
  await ensureProjectAccess(input.supabase, input.tenantId, input.projectId);
  await validateConsents(input.supabase, input.tenantId, input.projectId, input.consentIds);

  const assetType = normalizeAssetType(input.assetType ?? "photo");
  const contentHash = normalizeContentHash(input.contentHash ?? null);
  const duplicatePolicy = normalizeDuplicatePolicy(input.duplicatePolicy);
  if (contentHash && input.contentHashAlgo && input.contentHashAlgo !== "sha256") {
    throw new HttpError(400, "invalid_hash_algo", "Unsupported content hash algorithm.");
  }

  const operation = `create_project_asset:${input.projectId}`;
  const admin = createAdminClient();

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
    const { data: asset } = await input.supabase
      .from("assets")
      .select("id, storage_path, storage_bucket, asset_type")
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .eq("id", payload.assetId)
      .maybeSingle();

    if (!asset) {
      throw new HttpError(409, "idempotency_mismatch", "Unable to reuse asset request.");
    }

    if (asset.asset_type !== assetType) {
      throw new HttpError(409, "idempotency_mismatch", "Unable to reuse asset request.");
    }

    const { data: signedData, error: signedError } = await admin.storage
      .from(payload.storageBucket)
      .createSignedUploadUrl(payload.storagePath, SIGNED_URL_TTL_SECONDS);

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

  if (contentHash && duplicatePolicy !== "upload_anyway") {
    const { data: duplicates, error: duplicateError } = await input.supabase
      .from("assets")
      .select("id")
      .eq("tenant_id", input.tenantId)
      .eq("project_id", input.projectId)
      .eq("asset_type", assetType)
      .eq("content_hash", contentHash)
      .limit(1);

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
      const { error: archiveError } = await input.supabase
        .from("assets")
        .update({ status: "archived", archived_at: now })
        .eq("tenant_id", input.tenantId)
        .eq("project_id", input.projectId)
        .eq("asset_type", assetType)
        .eq("content_hash", contentHash)
        .neq("status", "archived");

      if (archiveError) {
        throw new HttpError(500, "duplicate_archive_failed", "Unable to archive duplicates.");
      }
    }
  }

  const assetId = crypto.randomUUID();
  const safeName = sanitizeFilename(input.originalFilename);
  const storagePath = `tenant/${input.tenantId}/project/${input.projectId}/asset/${assetId}/${safeName}`;
  const retentionExpiresAt = getRetentionExpiresAt(assetType);

  const { data: asset, error: assetError } = await input.supabase
    .from("assets")
    .insert({
      id: assetId,
      tenant_id: input.tenantId,
      project_id: input.projectId,
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
    })
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
    .createSignedUploadUrl(storagePath, SIGNED_URL_TTL_SECONDS);

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
