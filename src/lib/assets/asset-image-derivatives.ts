import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@supabase/supabase-js";

import { runChunkedRead } from "@/lib/supabase/safe-in-filter";

export const ASSET_IMAGE_DERIVATIVE_BUCKET = "asset-image-derivatives";
const ASSET_IMAGE_DERIVATIVE_VERSION = "asset-derivative-v1";
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_WORKER_CONCURRENCY = 1;
const MAX_WORKER_CONCURRENCY = 6;
const DEFAULT_JOB_LEASE_SECONDS = 900;
const MIN_JOB_LEASE_SECONDS = 60;
const MAX_JOB_LEASE_SECONDS = 3600;

export const ASSET_IMAGE_DERIVATIVE_KINDS = ["thumbnail", "preview"] as const;

export type AssetImageDerivativeKind = (typeof ASSET_IMAGE_DERIVATIVE_KINDS)[number];
export type AssetImageDerivativeStatus = "pending" | "processing" | "ready" | "dead";

export type AssetImageDerivativeRow = {
  id: string;
  tenant_id: string;
  project_id: string;
  asset_id: string;
  derivative_kind: AssetImageDerivativeKind;
  derivative_version: string;
  storage_bucket: string;
  storage_path: string;
  content_type: string;
  file_size_bytes: number | null;
  width: number | null;
  height: number | null;
  status: AssetImageDerivativeStatus;
  attempt_count: number;
  max_attempts: number;
  run_after: string;
  locked_at: string | null;
  locked_by: string | null;
  lease_expires_at: string | null;
  generated_at: string | null;
  failed_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  last_error_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AssetDerivativeClaimRow = {
  derivative_id: string;
  tenant_id: string;
  project_id: string;
  asset_id: string;
  derivative_kind: AssetImageDerivativeKind;
  derivative_version: string;
  storage_bucket: string;
  storage_path: string;
  content_type: string;
  file_size_bytes: number | null;
  width: number | null;
  height: number | null;
  status: "processing";
  attempt_count: number;
  max_attempts: number;
  run_after: string;
  locked_at: string | null;
  locked_by: string | null;
  lease_expires_at: string | null;
  generated_at: string | null;
  failed_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  last_error_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AssetUrlSignableAsset = {
  id: string;
  status: string;
  storage_bucket: string | null;
  storage_path: string | null;
};

export type AssetUrlUse = "thumbnail" | "preview";
export type AssetDisplayUrlState =
  | "ready_derivative"
  | "transform_fallback"
  | "processing"
  | "unavailable";

export type AssetImageDerivativeQueueSummary = Record<AssetImageDerivativeStatus, number>;

export type AssetDerivativeSpec = {
  derivativeKind: AssetImageDerivativeKind;
  contentType: "image/jpeg";
  extension: "jpg";
  width: number;
  height: number;
  quality: number;
};

function normalizeAssetIds(assetIds: string[]) {
  return Array.from(new Set(assetIds.map((assetId) => String(assetId ?? "").trim()).filter(Boolean)));
}

function getInternalSupabaseClient(supabase?: SupabaseClient) {
  return supabase ?? createAdminClient();
}

function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error("Missing Supabase service role configuration.");
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function parseBoundedNumber(raw: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(raw ?? "");
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(min, Math.min(max, parsed));
}

export function getAssetImageDerivativeVersion() {
  return ASSET_IMAGE_DERIVATIVE_VERSION;
}

export function getAssetImageDerivativeWorkerConcurrency() {
  return Math.floor(
    parseBoundedNumber(
      process.env.ASSET_IMAGE_DERIVATIVE_WORKER_CONCURRENCY,
      DEFAULT_WORKER_CONCURRENCY,
      1,
      MAX_WORKER_CONCURRENCY,
    ),
  );
}

export function getAssetImageDerivativeJobLeaseSeconds() {
  return Math.floor(
    parseBoundedNumber(
      process.env.ASSET_IMAGE_DERIVATIVE_JOB_LEASE_SECONDS,
      DEFAULT_JOB_LEASE_SECONDS,
      MIN_JOB_LEASE_SECONDS,
      MAX_JOB_LEASE_SECONDS,
    ),
  );
}

export function getAssetImageDerivativeSpec(use: AssetUrlUse): AssetDerivativeSpec {
  if (use === "preview") {
    return {
      derivativeKind: "preview",
      contentType: "image/jpeg",
      extension: "jpg",
      width: 1536,
      height: 1536,
      quality: 85,
    };
  }

  return {
    derivativeKind: "thumbnail",
    contentType: "image/jpeg",
    extension: "jpg",
    width: 480,
    height: 480,
    quality: 76,
  };
}

export function buildAssetImageDerivativeStoragePath(input: {
  tenantId: string;
  projectId: string;
  assetId: string;
  derivativeKind: AssetImageDerivativeKind;
  derivativeVersion?: string | null;
}) {
  const derivativeVersion = input.derivativeVersion ?? ASSET_IMAGE_DERIVATIVE_VERSION;
  const spec = getAssetImageDerivativeSpec(
    input.derivativeKind === "preview" ? "preview" : "thumbnail",
  );
  return `tenant/${input.tenantId}/project/${input.projectId}/asset/${input.assetId}/derivative/${derivativeVersion}/${input.derivativeKind}.${spec.extension}`;
}

export function isCurrentAssetImageDerivative(row: AssetImageDerivativeRow | null | undefined) {
  return Boolean(row) && row?.derivative_version === ASSET_IMAGE_DERIVATIVE_VERSION;
}

export function getAssetImageDerivativeRowForUse(
  derivatives: Map<string, AssetImageDerivativeRow>,
  assetId: string,
  use: AssetUrlUse,
) {
  const spec = getAssetImageDerivativeSpec(use);
  return derivatives.get(`${assetId}:${spec.derivativeKind}`) ?? null;
}

export function getAssetDisplayFallbackState(
  derivative: AssetImageDerivativeRow | null | undefined,
): AssetDisplayUrlState {
  if (derivative?.status === "pending" || derivative?.status === "processing") {
    return "processing";
  }

  return "unavailable";
}

export function assetNeedsCurrentImageDerivative(
  derivatives: Map<string, AssetImageDerivativeRow>,
  assetId: string,
) {
  return ASSET_IMAGE_DERIVATIVE_KINDS.some((derivativeKind) => {
    const row = derivatives.get(`${assetId}:${derivativeKind}`) ?? null;
    return !row || row.derivative_version !== ASSET_IMAGE_DERIVATIVE_VERSION || row.status === "dead";
  });
}

export async function loadAssetImageDerivativesForAssetIds(
  supabase: SupabaseClient,
  tenantId: string,
  projectId: string,
  assetIds: string[],
) {
  const normalizedAssetIds = normalizeAssetIds(assetIds);
  if (normalizedAssetIds.length === 0) {
    return new Map<string, AssetImageDerivativeRow>();
  }

  const rows = await runChunkedRead(normalizedAssetIds, async (assetIdChunk) => {
    const { data, error } = await supabase
      .from("asset_image_derivatives")
      .select(
        "id, tenant_id, project_id, asset_id, derivative_kind, derivative_version, storage_bucket, storage_path, content_type, file_size_bytes, width, height, status, attempt_count, max_attempts, run_after, locked_at, locked_by, lease_expires_at, generated_at, failed_at, last_error_code, last_error_message, last_error_at, created_at, updated_at",
      )
      .eq("tenant_id", tenantId)
      .eq("project_id", projectId)
      .in("asset_id", assetIdChunk);

    if (error) {
      throw error;
    }

    return (data ?? []) as AssetImageDerivativeRow[];
  });

  return new Map(
    rows.map((row) => [`${row.asset_id}:${row.derivative_kind}`, row] as const),
  );
}

export async function queueAssetImageDerivativesForAssetIds(input: {
  supabase?: SupabaseClient;
  tenantId: string;
  projectId: string;
  assetIds: string[];
}) {
  const assetIds = normalizeAssetIds(input.assetIds);
  if (assetIds.length === 0) {
    return { queued: 0, queuedAssetCount: 0 };
  }

  const supabase = createAdminClient();
  const now = new Date().toISOString();
  const existingByKey = await loadAssetImageDerivativesForAssetIds(
    supabase,
    input.tenantId,
    input.projectId,
    assetIds,
  );
  const rowsToUpsert: Array<Record<string, unknown>> = [];

  for (const assetId of assetIds) {
    for (const derivativeKind of ASSET_IMAGE_DERIVATIVE_KINDS) {
      const existing = existingByKey.get(`${assetId}:${derivativeKind}`) ?? null;
      const shouldQueue =
        !existing
        || existing.derivative_version !== ASSET_IMAGE_DERIVATIVE_VERSION
        || existing.status === "dead";

      if (!shouldQueue) {
        continue;
      }

      const use = derivativeKind === "preview" ? "preview" : "thumbnail";
      const spec = getAssetImageDerivativeSpec(use);
      rowsToUpsert.push({
        tenant_id: input.tenantId,
        project_id: input.projectId,
        asset_id: assetId,
        derivative_kind: derivativeKind,
        derivative_version: ASSET_IMAGE_DERIVATIVE_VERSION,
        storage_bucket: ASSET_IMAGE_DERIVATIVE_BUCKET,
        storage_path: buildAssetImageDerivativeStoragePath({
          tenantId: input.tenantId,
          projectId: input.projectId,
          assetId,
          derivativeKind,
          derivativeVersion: ASSET_IMAGE_DERIVATIVE_VERSION,
        }),
        content_type: spec.contentType,
        file_size_bytes: null,
        width: null,
        height: null,
        status: "pending",
        attempt_count: 0,
        max_attempts: DEFAULT_MAX_ATTEMPTS,
        run_after: now,
        locked_at: null,
        locked_by: null,
        lease_expires_at: null,
        generated_at: null,
        failed_at: null,
        last_error_code: null,
        last_error_message: null,
        last_error_at: null,
        updated_at: now,
      });
    }
  }

  if (rowsToUpsert.length === 0) {
    return { queued: 0, queuedAssetCount: 0 };
  }

  const { error } = await supabase
    .from("asset_image_derivatives")
    .upsert(rowsToUpsert, {
      onConflict: "tenant_id,project_id,asset_id,derivative_kind",
    });

  if (error) {
    throw error;
  }

  return {
    queued: rowsToUpsert.length,
    queuedAssetCount: new Set(rowsToUpsert.map((row) => String(row.asset_id ?? ""))).size,
  };
}

type QueueSummaryFilter = {
  tenantId?: string | null;
  projectId?: string | null;
};

async function countDerivativesByStatus(
  supabase: SupabaseClient,
  status: AssetImageDerivativeStatus,
  filter?: QueueSummaryFilter,
) {
  let query = supabase
    .from("asset_image_derivatives")
    .select("id", { count: "exact", head: true })
    .eq("status", status);

  if (filter?.tenantId) {
    query = query.eq("tenant_id", filter.tenantId);
  }

  if (filter?.projectId) {
    query = query.eq("project_id", filter.projectId);
  }

  const { count, error } = await query;
  if (error) {
    throw error;
  }

  return count ?? 0;
}

export async function getAssetImageDerivativeQueueSummary(
  input?: {
    supabase?: SupabaseClient;
    tenantId?: string | null;
    projectId?: string | null;
  },
): Promise<AssetImageDerivativeQueueSummary> {
  const supabase = getInternalSupabaseClient(input?.supabase);
  const filter = {
    tenantId: input?.tenantId ?? null,
    projectId: input?.projectId ?? null,
  };

  const [pending, processing, ready, dead] = await Promise.all([
    countDerivativesByStatus(supabase, "pending", filter),
    countDerivativesByStatus(supabase, "processing", filter),
    countDerivativesByStatus(supabase, "ready", filter),
    countDerivativesByStatus(supabase, "dead", filter),
  ]);

  return {
    pending,
    processing,
    ready,
    dead,
  };
}

export async function claimAssetImageDerivatives(input: {
  supabase: SupabaseClient;
  workerId: string;
  batchSize: number;
}) {
  const { data, error } = await input.supabase.rpc("claim_asset_image_derivatives", {
    p_locked_by: String(input.workerId).trim(),
    p_batch_size: Math.max(1, Math.floor(input.batchSize)),
    p_lease_seconds: getAssetImageDerivativeJobLeaseSeconds(),
  });

  if (error) {
    throw error;
  }

  return ((data ?? []) as AssetDerivativeClaimRow[]);
}

export async function failAssetImageDerivative(input: {
  supabase: SupabaseClient;
  derivativeId: string;
  errorCode?: string | null;
  errorMessage?: string | null;
  retryable?: boolean;
  retryDelaySeconds?: number | null;
}) {
  const { error } = await input.supabase.rpc("fail_asset_image_derivative", {
    p_derivative_id: input.derivativeId,
    p_error_code: input.errorCode ?? null,
    p_error_message: input.errorMessage ?? null,
    p_retryable: input.retryable ?? true,
    p_retry_delay_seconds: input.retryDelaySeconds ?? null,
  });

  if (error) {
    throw error;
  }
}

export async function completeAssetImageDerivative(input: {
  supabase: SupabaseClient;
  derivativeId: string;
  fileSizeBytes: number;
  width: number;
  height: number;
}) {
  const now = new Date().toISOString();
  const { error } = await input.supabase
    .from("asset_image_derivatives")
    .update({
      status: "ready",
      file_size_bytes: input.fileSizeBytes,
      width: input.width,
      height: input.height,
      locked_at: null,
      locked_by: null,
      lease_expires_at: null,
      generated_at: now,
      failed_at: null,
      last_error_code: null,
      last_error_message: null,
      last_error_at: null,
      updated_at: now,
    })
    .eq("id", input.derivativeId)
    .eq("status", "processing");

  if (error) {
    throw error;
  }
}
