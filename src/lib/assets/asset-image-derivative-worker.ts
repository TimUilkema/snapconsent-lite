import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";

import {
  claimAssetImageDerivatives,
  completeAssetImageDerivative,
  failAssetImageDerivative,
  getAssetImageDerivativeJobLeaseSeconds,
  getAssetImageDerivativeSpec,
  getAssetImageDerivativeWorkerConcurrency,
  loadAssetImageDerivativesForAssetIds,
  type AssetDerivativeClaimRow,
  type AssetImageDerivativeRow,
} from "@/lib/assets/asset-image-derivatives";

const execFileAsync = promisify(execFile);
const runtimeRequire = createRequire(import.meta.url);
const VIDEO_POSTER_TIMESTAMPS_SECONDS = [1, 0] as const;

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

type DerivativeRenderError = {
  errorCode: string;
  errorMessage: string;
  retryable: boolean;
};

type RenderedDerivativeBuffer = {
  buffer: Buffer;
  width: number;
  height: number;
};

type DerivativeOutcome = "succeeded" | "retried" | "dead";

type ClaimedDerivativeTask = {
  rows: AssetDerivativeClaimRow[];
};

export type AssetImageDerivativeWorkerDependencies = {
  loadAssetSourceRow: (
    supabase: SupabaseClient,
    row: AssetDerivativeClaimRow,
  ) => Promise<AssetSourceRow | null>;
  loadDerivativeRowsForAsset: (
    supabase: SupabaseClient,
    row: AssetDerivativeClaimRow,
  ) => Promise<Map<string, AssetImageDerivativeRow>>;
  downloadAssetBuffer: (
    supabase: SupabaseClient,
    asset: AssetSourceRow,
  ) => Promise<Buffer | null>;
  extractSharedVideoFrameBuffer: (sourceBuffer: Buffer) => Promise<Buffer>;
  renderImageDerivativeBuffer: (
    sourceBuffer: Buffer,
    derivativeKind: AssetDerivativeClaimRow["derivative_kind"],
  ) => Promise<RenderedDerivativeBuffer>;
  uploadDerivativeBuffer: (
    supabase: SupabaseClient,
    row: AssetDerivativeClaimRow,
    derivativeBuffer: Buffer,
  ) => Promise<Error | null>;
  completeAssetImageDerivative: typeof completeAssetImageDerivative;
  failAssetImageDerivative: typeof failAssetImageDerivative;
};

export type ProcessClaimedVideoDerivativeGroupInput = {
  supabase: SupabaseClient;
  rows: AssetDerivativeClaimRow[];
  sourceAsset?: AssetSourceRow | null;
  dependencies?: Partial<AssetImageDerivativeWorkerDependencies>;
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

export async function resolveAssetFfmpegPath() {
  const configuredPath = String(process.env.ASSET_FFMPEG_PATH ?? "").trim();
  if (configuredPath) {
    try {
      await access(configuredPath);
      return configuredPath;
    } catch {
      return configuredPath;
    }
  }

  try {
    const staticPath = runtimeRequire("ffmpeg-static");
    const normalizedPath = typeof staticPath === "string" ? staticPath.trim() : "";
    if (normalizedPath) {
      return normalizedPath;
    }
  } catch {
    return null;
  }

  return null;
}

function buildDerivativeRenderError(
  errorCode: string,
  errorMessage: string,
  retryable: boolean,
): DerivativeRenderError {
  return {
    errorCode,
    errorMessage,
    retryable,
  };
}

function normalizeDerivativeRenderError(
  error: unknown,
  fallbackErrorCode: string,
  fallbackErrorMessage: string,
  fallbackRetryable: boolean,
) {
  if (
    error
    && typeof error === "object"
    && "errorCode" in error
    && "errorMessage" in error
    && "retryable" in error
  ) {
    return error as DerivativeRenderError;
  }

  return buildDerivativeRenderError(
    fallbackErrorCode,
    fallbackErrorMessage,
    fallbackRetryable,
  );
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

async function renderImageDerivativeBuffer(
  sourceBuffer: Buffer,
  derivativeKind: AssetDerivativeClaimRow["derivative_kind"],
) {
  const spec = getAssetImageDerivativeSpec(
    derivativeKind === "preview" ? "preview" : "thumbnail",
  );

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

async function extractVideoFrameBuffer(inputPath: string, timestampSeconds: number) {
  const ffmpegPath = await resolveAssetFfmpegPath();
  if (!ffmpegPath) {
    throw buildDerivativeRenderError(
      "asset_derivative_tool_unavailable",
      "Ffmpeg is not configured for video poster generation.",
      false,
    );
  }

  const outputPath = path.join(
    path.dirname(inputPath),
    `frame-${String(timestampSeconds).replace(".", "_")}.png`,
  );

  try {
    await execFileAsync(
      ffmpegPath,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-ss",
        timestampSeconds.toFixed(1),
        "-i",
        inputPath,
        "-frames:v",
        "1",
        "-update",
        "1",
        outputPath,
      ],
      {
        windowsHide: true,
      },
    );
  } catch (error) {
    const stderr =
      error && typeof error === "object" && "stderr" in error
        ? String((error as { stderr?: string }).stderr ?? "").trim()
        : "";
    const message = error instanceof Error ? error.message.trim() : "";
    throw buildDerivativeRenderError(
      "asset_derivative_render_failed",
      stderr || message || "Unable to extract a poster frame from the original video.",
      false,
    );
  }

  try {
    const outputBuffer = await readFile(outputPath);
    if (outputBuffer.byteLength === 0) {
      throw new Error("empty_frame_buffer");
    }

    return outputBuffer;
  } catch {
    throw buildDerivativeRenderError(
      "asset_derivative_render_failed",
      "Unable to read the generated poster frame.",
      false,
    );
  }
}

async function extractSharedVideoFrameBuffer(sourceBuffer: Buffer) {
  let tempDir: string | null = null;

  try {
    tempDir = await mkdtemp(path.join(tmpdir(), "asset-derivative-"));
    const inputPath = path.join(tempDir, "source-video");
    await writeFile(inputPath, sourceBuffer);

    let lastError: DerivativeRenderError | null = null;

    for (const timestampSeconds of VIDEO_POSTER_TIMESTAMPS_SECONDS) {
      try {
        return await extractVideoFrameBuffer(inputPath, timestampSeconds);
      } catch (error) {
        lastError = normalizeDerivativeRenderError(
          error,
          "asset_derivative_render_failed",
          "Unable to extract a poster frame from the original video.",
          false,
        );
      }
    }

    throw lastError ?? buildDerivativeRenderError(
      "asset_derivative_render_failed",
      "Unable to render the asset derivative from the original video.",
      false,
    );
  } catch (error) {
    if (
      error
      && typeof error === "object"
      && "errorCode" in error
      && "errorMessage" in error
      && "retryable" in error
    ) {
      throw error;
    }

    throw buildDerivativeRenderError(
      "asset_derivative_temp_file_failed",
      "Unable to prepare temporary files for video poster generation.",
      true,
    );
  } finally {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
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

async function loadDerivativeRowsForAsset(
  supabase: SupabaseClient,
  row: AssetDerivativeClaimRow,
) {
  return loadAssetImageDerivativesForAssetIds(
    supabase,
    row.tenant_id,
    row.project_id,
    [row.asset_id],
  );
}

async function uploadDerivativeBuffer(
  supabase: SupabaseClient,
  row: AssetDerivativeClaimRow,
  derivativeBuffer: Buffer,
) {
  const { error } = await supabase.storage
    .from(row.storage_bucket)
    .upload(row.storage_path, derivativeBuffer, {
      contentType: row.content_type,
      upsert: true,
    });

  return error ?? null;
}

function getAssetTaskKey(row: AssetDerivativeClaimRow) {
  return `${row.tenant_id}:${row.project_id}:${row.asset_id}`;
}

function createWorkerDependencies(
  overrides?: Partial<AssetImageDerivativeWorkerDependencies>,
): AssetImageDerivativeWorkerDependencies {
  return {
    loadAssetSourceRow,
    loadDerivativeRowsForAsset,
    downloadAssetBuffer,
    extractSharedVideoFrameBuffer,
    renderImageDerivativeBuffer,
    uploadDerivativeBuffer,
    completeAssetImageDerivative,
    failAssetImageDerivative,
    ...overrides,
  };
}

async function failDerivativeRows(
  dependencies: AssetImageDerivativeWorkerDependencies,
  supabase: SupabaseClient,
  rows: AssetDerivativeClaimRow[],
  errorCode: string,
  errorMessage: string,
  retryable: boolean,
) {
  for (const row of rows) {
    await dependencies.failAssetImageDerivative({
      supabase,
      derivativeId: row.derivative_id,
      errorCode,
      errorMessage,
      retryable,
    });
  }
}

async function processPhotoDerivativeRow(input: {
  supabase: SupabaseClient;
  row: AssetDerivativeClaimRow;
  sourceAsset?: AssetSourceRow | null;
  dependencies?: Partial<AssetImageDerivativeWorkerDependencies>;
}): Promise<DerivativeOutcome> {
  const dependencies = createWorkerDependencies(input.dependencies);
  const sourceAsset =
    input.sourceAsset ?? await dependencies.loadAssetSourceRow(input.supabase, input.row);

  if (!sourceAsset || sourceAsset.status !== "uploaded") {
    await dependencies.failAssetImageDerivative({
      supabase: input.supabase,
      derivativeId: input.row.derivative_id,
      errorCode: "asset_unavailable",
      errorMessage: "Original asset is unavailable for derivative generation.",
      retryable: false,
    });
    return "dead";
  }

  const sourceBuffer = await dependencies.downloadAssetBuffer(input.supabase, sourceAsset);
  if (!sourceBuffer) {
    await dependencies.failAssetImageDerivative({
      supabase: input.supabase,
      derivativeId: input.row.derivative_id,
      errorCode: "asset_download_failed",
      errorMessage: "Unable to download the original asset for derivative generation.",
      retryable: true,
    });
    return "retried";
  }

  let rendered: RenderedDerivativeBuffer;

  try {
    rendered = await dependencies.renderImageDerivativeBuffer(
      sourceBuffer,
      input.row.derivative_kind,
    );
  } catch (error) {
    const normalizedError = normalizeDerivativeRenderError(
      error,
      "asset_derivative_render_failed",
      "Unable to render the asset derivative from the original image.",
      false,
    );
    await dependencies.failAssetImageDerivative({
      supabase: input.supabase,
      derivativeId: input.row.derivative_id,
      errorCode: normalizedError.errorCode,
      errorMessage: normalizedError.errorMessage,
      retryable: normalizedError.retryable,
    });
    return normalizedError.retryable ? "retried" : "dead";
  }

  const uploadError = await dependencies.uploadDerivativeBuffer(
    input.supabase,
    input.row,
    rendered.buffer,
  );

  if (uploadError) {
    await dependencies.failAssetImageDerivative({
      supabase: input.supabase,
      derivativeId: input.row.derivative_id,
      errorCode: "asset_derivative_upload_failed",
      errorMessage: "Unable to store the generated asset derivative.",
      retryable: true,
    });
    return "retried";
  }

  await dependencies.completeAssetImageDerivative({
    supabase: input.supabase,
    derivativeId: input.row.derivative_id,
    fileSizeBytes: rendered.buffer.length,
    width: rendered.width,
    height: rendered.height,
  });
  return "succeeded";
}

export async function processClaimedVideoDerivativeGroup(
  input: ProcessClaimedVideoDerivativeGroupInput,
): Promise<DerivativeOutcome[]> {
  const dependencies = createWorkerDependencies(input.dependencies);
  const rows = input.rows.filter(Boolean);
  if (rows.length === 0) {
    return [];
  }

  const representativeRow = rows[0];
  const outcomeByDerivativeId = new Map<string, DerivativeOutcome>();
  const sourceAsset =
    input.sourceAsset ?? await dependencies.loadAssetSourceRow(input.supabase, representativeRow);

  if (
    !sourceAsset
    || sourceAsset.status !== "uploaded"
    || sourceAsset.asset_type !== "video"
  ) {
    await failDerivativeRows(
      dependencies,
      input.supabase,
      rows,
      "asset_unavailable",
      "Original asset is unavailable for derivative generation.",
      false,
    );
    return rows.map(() => "dead");
  }

  const currentDerivativeRows = await dependencies.loadDerivativeRowsForAsset(
    input.supabase,
    representativeRow,
  );
  const rowsToProcess = rows.filter((row) => {
    const currentRow = currentDerivativeRows.get(`${row.asset_id}:${row.derivative_kind}`);
    if (currentRow?.status === "ready") {
      outcomeByDerivativeId.set(row.derivative_id, "succeeded");
      return false;
    }

    return true;
  });

  if (rowsToProcess.length === 0) {
    return rows.map((row) => outcomeByDerivativeId.get(row.derivative_id) ?? "succeeded");
  }

  const sourceBuffer = await dependencies.downloadAssetBuffer(input.supabase, sourceAsset);
  if (!sourceBuffer) {
    await failDerivativeRows(
      dependencies,
      input.supabase,
      rowsToProcess,
      "asset_download_failed",
      "Unable to download the original asset for derivative generation.",
      true,
    );
    rowsToProcess.forEach((row) => outcomeByDerivativeId.set(row.derivative_id, "retried"));
    return rows.map((row) => outcomeByDerivativeId.get(row.derivative_id) ?? "retried");
  }

  let frameBuffer: Buffer;

  try {
    frameBuffer = await dependencies.extractSharedVideoFrameBuffer(sourceBuffer);
  } catch (error) {
    const normalizedError = normalizeDerivativeRenderError(
      error,
      "asset_derivative_render_failed",
      "Unable to render the asset derivative from the original video.",
      false,
    );
    await failDerivativeRows(
      dependencies,
      input.supabase,
      rowsToProcess,
      normalizedError.errorCode,
      normalizedError.errorMessage,
      normalizedError.retryable,
    );
    const outcome = normalizedError.retryable ? "retried" : "dead";
    rowsToProcess.forEach((row) => outcomeByDerivativeId.set(row.derivative_id, outcome));
    return rows.map((row) => outcomeByDerivativeId.get(row.derivative_id) ?? outcome);
  }

  for (const row of rowsToProcess) {
    try {
      const rendered = await dependencies.renderImageDerivativeBuffer(
        frameBuffer,
        row.derivative_kind,
      );
      const uploadError = await dependencies.uploadDerivativeBuffer(
        input.supabase,
        row,
        rendered.buffer,
      );

      if (uploadError) {
        await dependencies.failAssetImageDerivative({
          supabase: input.supabase,
          derivativeId: row.derivative_id,
          errorCode: "asset_derivative_upload_failed",
          errorMessage: "Unable to store the generated asset derivative.",
          retryable: true,
        });
        outcomeByDerivativeId.set(row.derivative_id, "retried");
        continue;
      }

      await dependencies.completeAssetImageDerivative({
        supabase: input.supabase,
        derivativeId: row.derivative_id,
        fileSizeBytes: rendered.buffer.length,
        width: rendered.width,
        height: rendered.height,
      });
      outcomeByDerivativeId.set(row.derivative_id, "succeeded");
    } catch (error) {
      const normalizedError = normalizeDerivativeRenderError(
        error,
        "asset_derivative_render_failed",
        "Unable to render the asset derivative from the original video.",
        false,
      );
      await dependencies.failAssetImageDerivative({
        supabase: input.supabase,
        derivativeId: row.derivative_id,
        errorCode: normalizedError.errorCode,
        errorMessage: normalizedError.errorMessage,
        retryable: normalizedError.retryable,
      });
      outcomeByDerivativeId.set(
        row.derivative_id,
        normalizedError.retryable ? "retried" : "dead",
      );
    }
  }

  return rows.map((row) => outcomeByDerivativeId.get(row.derivative_id) ?? "succeeded");
}

function buildClaimedDerivativeTasks(rows: AssetDerivativeClaimRow[]) {
  const groupedRows = new Map<string, ClaimedDerivativeTask>();

  for (const row of rows) {
    const taskKey = getAssetTaskKey(row);
    const currentTask = groupedRows.get(taskKey) ?? { rows: [] };
    currentTask.rows.push(row);
    groupedRows.set(taskKey, currentTask);
  }

  return Array.from(groupedRows.values());
}

async function processClaimedDerivativeTask(
  supabase: SupabaseClient,
  task: ClaimedDerivativeTask,
) {
  const dependencies = createWorkerDependencies();
  const representativeRow = task.rows[0];
  const sourceAsset = await dependencies.loadAssetSourceRow(supabase, representativeRow);

  if (sourceAsset?.asset_type === "video") {
    return processClaimedVideoDerivativeGroup({
      supabase,
      rows: task.rows,
      sourceAsset,
      dependencies,
    });
  }

  const outcomes: DerivativeOutcome[] = [];
  for (const row of task.rows) {
    outcomes.push(await processPhotoDerivativeRow({
      supabase,
      row,
      sourceAsset,
      dependencies,
    }));
  }

  return outcomes;
}

function applyOutcomesToCounters(
  counters: RunAssetImageDerivativeWorkerResult,
  outcomes: DerivativeOutcome[],
) {
  for (const outcome of outcomes) {
    if (outcome === "succeeded") {
      counters.succeeded += 1;
    } else if (outcome === "retried") {
      counters.retried += 1;
    } else {
      counters.dead += 1;
    }
  }
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

  const tasks = buildClaimedDerivativeTasks(claimedRows);
  let index = 0;

  async function runWorker() {
    while (index < tasks.length) {
      const currentIndex = index;
      index += 1;
      const task = tasks[currentIndex];
      if (!task) {
        continue;
      }

      const outcomes = await processClaimedDerivativeTask(supabase, task);
      applyOutcomesToCounters(counters, outcomes);
    }
  }

  await Promise.all(Array.from({ length: workerConcurrency }, () => runWorker()));
  return counters;
}

export function getAssetImageDerivativeWorkerLeaseSeconds() {
  return getAssetImageDerivativeJobLeaseSeconds();
}
