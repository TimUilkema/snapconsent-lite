import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";

import {
  claimAssetImageDerivatives,
  completeAssetImageDerivative,
  failAssetImageDerivative,
  getAssetImageDerivativeJobLeaseSeconds,
  getAssetImageDerivativeSpec,
  getAssetImageDerivativeWorkerConcurrency,
  type AssetDerivativeClaimRow,
} from "@/lib/assets/asset-image-derivatives";
type AssetSourceRow = {
  id: string;
  status: string;
  asset_type: string;
  storage_bucket: string | null;
  storage_path: string | null;
};

type RunAssetImageDerivativeWorkerInput = {
  workerId: string;
  batchSize: number;
};

export type RunAssetImageDerivativeWorkerResult = {
  claimed: number;
  workerConcurrency: number;
  succeeded: number;
  retried: number;
  dead: number;
};

function createServiceRoleClient() {
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

function normalizeWorkerConcurrency(claimedRowCount: number) {
  if (claimedRowCount <= 1) {
    return claimedRowCount;
  }

  return Math.min(getAssetImageDerivativeWorkerConcurrency(), claimedRowCount);
}

async function downloadAssetBuffer(
  supabase: SupabaseClient,
  asset: AssetSourceRow,
) {
  if (!asset.storage_bucket || !asset.storage_path) {
    return null;
  }

  const { data, error } = await supabase.storage
    .from(asset.storage_bucket)
    .download(asset.storage_path);

  if (error || !data) {
    return null;
  }

  const arrayBuffer = await data.arrayBuffer();
  if (arrayBuffer.byteLength === 0) {
    return null;
  }

  return Buffer.from(arrayBuffer);
}

async function renderDerivativeBuffer(sourceBuffer: Buffer, derivativeKind: AssetDerivativeClaimRow["derivative_kind"]) {
  const spec = getAssetImageDerivativeSpec(derivativeKind === "preview" ? "preview" : "thumbnail");

  const pipeline = sharp(sourceBuffer, { failOn: "error" })
    .rotate()
    .resize({
      width: spec.width,
      height: spec.height,
      fit: "inside",
      withoutEnlargement: true,
    })
    .flatten({ background: "#ffffff" })
    .jpeg({
      quality: spec.quality,
      mozjpeg: true,
    });

  const buffer = await pipeline.toBuffer();
  const metadata = await sharp(buffer, { failOn: "error" }).metadata();
  return {
    buffer,
    width: metadata.width ?? spec.width,
    height: metadata.height ?? spec.height,
  };
}

async function loadAssetSourceRow(
  supabase: SupabaseClient,
  row: AssetDerivativeClaimRow,
) {
  const { data, error } = await supabase
    .from("assets")
    .select("id, status, asset_type, storage_bucket, storage_path")
    .eq("tenant_id", row.tenant_id)
    .eq("project_id", row.project_id)
    .eq("id", row.asset_id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as AssetSourceRow | null) ?? null;
}

async function processDerivativeRow(
  supabase: SupabaseClient,
  row: AssetDerivativeClaimRow,
) {
  const sourceAsset = await loadAssetSourceRow(supabase, row);
  if (!sourceAsset || sourceAsset.status !== "uploaded") {
    await failAssetImageDerivative({
      supabase,
      derivativeId: row.derivative_id,
      errorCode: "asset_unavailable",
      errorMessage: "Original asset is unavailable for derivative generation.",
      retryable: false,
    });
    return "dead" as const;
  }

  const sourceBuffer = await downloadAssetBuffer(supabase, sourceAsset);
  if (!sourceBuffer) {
    await failAssetImageDerivative({
      supabase,
      derivativeId: row.derivative_id,
      errorCode: "asset_download_failed",
      errorMessage: "Unable to download the original asset for derivative generation.",
      retryable: true,
    });
    return "retried" as const;
  }

  let derivativeBuffer: Buffer;
  let width: number;
  let height: number;

  try {
    const rendered = await renderDerivativeBuffer(sourceBuffer, row.derivative_kind);
    derivativeBuffer = rendered.buffer;
    width = rendered.width;
    height = rendered.height;
  } catch {
    await failAssetImageDerivative({
      supabase,
      derivativeId: row.derivative_id,
      errorCode: "asset_derivative_render_failed",
      errorMessage: "Unable to render the asset derivative from the original image.",
      retryable: false,
    });
    return "dead" as const;
  }

  const { error: uploadError } = await supabase.storage
    .from(row.storage_bucket)
    .upload(row.storage_path, derivativeBuffer, {
      contentType: row.content_type,
      upsert: true,
    });

  if (uploadError) {
    await failAssetImageDerivative({
      supabase,
      derivativeId: row.derivative_id,
      errorCode: "asset_derivative_upload_failed",
      errorMessage: "Unable to store the generated asset derivative.",
      retryable: true,
    });
    return "retried" as const;
  }

  await completeAssetImageDerivative({
    supabase,
    derivativeId: row.derivative_id,
    fileSizeBytes: derivativeBuffer.length,
    width,
    height,
  });
  return "succeeded" as const;
}

export async function runAssetImageDerivativeWorker(
  input: RunAssetImageDerivativeWorkerInput,
): Promise<RunAssetImageDerivativeWorkerResult> {
  const workerId = String(input.workerId ?? "").trim();
  if (!workerId) {
    throw new Error("Asset image derivative worker ID is required.");
  }

  const supabase = createServiceRoleClient();
  const claimedRows = await claimAssetImageDerivatives({
    supabase,
    workerId,
    batchSize: Math.max(1, Math.floor(input.batchSize)),
  });

  const workerConcurrency = normalizeWorkerConcurrency(claimedRows.length);
  const counters: RunAssetImageDerivativeWorkerResult = {
    claimed: claimedRows.length,
    workerConcurrency,
    succeeded: 0,
    retried: 0,
    dead: 0,
  };

  if (claimedRows.length === 0 || workerConcurrency === 0) {
    return counters;
  }

  let index = 0;

  async function runWorker() {
    while (index < claimedRows.length) {
      const currentIndex = index;
      index += 1;
      const row = claimedRows[currentIndex];
      if (!row) {
        continue;
      }

      const outcome = await processDerivativeRow(supabase, row);
      if (outcome === "succeeded") {
        counters.succeeded += 1;
      } else if (outcome === "retried") {
        counters.retried += 1;
      } else {
        counters.dead += 1;
      }
    }
  }

  await Promise.all(Array.from({ length: workerConcurrency }, () => runWorker()));
  return counters;
}

export function getAssetImageDerivativeWorkerLeaseSeconds() {
  return getAssetImageDerivativeJobLeaseSeconds();
}
