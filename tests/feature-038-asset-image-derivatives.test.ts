import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import ffmpegStatic from "ffmpeg-static";
import sharp from "sharp";

import {
  getAcceptedImageUploadAcceptValue,
  isAcceptedImageUpload,
} from "../src/lib/assets/asset-image-policy";
import { runAssetImageDerivativeRepair } from "../src/lib/assets/asset-image-derivative-repair";
import {
  type AssetDerivativeClaimRow,
  type AssetImageDerivativeRow,
  loadAssetImageDerivativesForAssetIds,
  queueAssetImageDerivativesForAssetIds,
} from "../src/lib/assets/asset-image-derivatives";
import {
  processClaimedVideoDerivativeGroup,
  resolveAssetFfmpegPath,
  runAssetImageDerivativeWorker,
} from "../src/lib/assets/asset-image-derivative-worker";
import { queueProjectAssetPostFinalizeProcessing } from "../src/lib/assets/post-finalize-processing";
import {
  resolveSignedAssetDisplayUrlsForAssets,
  signThumbnailUrlsForAssets,
} from "../src/lib/assets/sign-asset-thumbnails";

const execFileAsync = promisify(execFile);

type ProjectContext = {
  tenantId: string;
  projectId: string;
  userId: string;
  email: string;
  password: string;
};

function parseDotEnvLine(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function loadEnvFromLocalFile() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  const raw = readFileSync(envPath, "utf8");
  const result = new Map<string, string>();

  raw.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      return;
    }

    const delimiterIndex = trimmed.indexOf("=");
    if (delimiterIndex <= 0) {
      return;
    }

    const key = trimmed.slice(0, delimiterIndex).trim();
    const value = parseDotEnvLine(trimmed.slice(delimiterIndex + 1));
    result.set(key, value);
  });

  return result;
}

function requireEnv(name: string, envFromFile: Map<string, string>) {
  const runtimeValue = process.env[name];
  if (runtimeValue && runtimeValue.trim().length > 0) {
    return runtimeValue.trim();
  }

  const fileValue = envFromFile.get(name);
  if (fileValue && fileValue.trim().length > 0) {
    return fileValue.trim();
  }

  throw new Error(`Missing required environment variable: ${name}`);
}

function assertNoError(error: PostgrestError | null, context: string) {
  if (!error) {
    return;
  }

  assert.fail(`${context}: ${error.code} ${error.message}`);
}

const envFromFile = loadEnvFromLocalFile();
const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL", envFromFile);
const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY", envFromFile);
const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", envFromFile);

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

function getFfmpegPath() {
  const configuredPath = String(process.env.ASSET_FFMPEG_PATH ?? "").trim();
  if (configuredPath) {
    return configuredPath;
  }

  const staticPath = String(ffmpegStatic ?? "").trim();
  return staticPath || null;
}

async function createAuthUserWithRetry(supabase: SupabaseClient) {
  const maxAttempts = 6;
  let lastError: { message?: string; code?: string } | null = null;
  const email = `feature038-${randomUUID()}@example.com`;
  const password = `SnapConsent-${randomUUID()}-A1!`;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (!error && data.user?.id) {
      return {
        userId: data.user.id,
        email,
        password,
      };
    }

    lastError = error;
    if (error?.code !== "unexpected_failure" || attempt === maxAttempts) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, attempt * 300));
  }

  assert.fail(
    `Unable to create auth user for tests: ${lastError?.code ?? "unknown"} ${lastError?.message ?? "fetch failed"}`,
  );
}

async function createProjectContext(supabase: SupabaseClient): Promise<ProjectContext> {
  const user = await createAuthUserWithRetry(supabase);

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert({
      name: `Feature 038 Tenant ${randomUUID()}`,
    })
    .select("id")
    .single();
  assertNoError(tenantError, "insert tenant");

  const { error: membershipError } = await supabase.from("memberships").insert({
    tenant_id: tenant.id,
    user_id: user.userId,
    role: "owner",
  });
  assertNoError(membershipError, "insert membership");

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({
      tenant_id: tenant.id,
      created_by: user.userId,
      name: `Feature 038 Project ${randomUUID()}`,
      description: "Feature 038 derivative tests",
      status: "active",
    })
    .select("id")
    .single();
  assertNoError(projectError, "insert project");

  return {
    tenantId: tenant.id as string,
    projectId: project.id as string,
    userId: user.userId,
    email: user.email,
    password: user.password,
  };
}

async function createRequestScopedClient(context: ProjectContext) {
  const client = createClient(supabaseUrl, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  const { error } = await client.auth.signInWithPassword({
    email: context.email,
    password: context.password,
  });

  assert.equal(error, null, `sign in request-scoped client: ${error?.message ?? ""}`);
  return client;
}

async function createUploadedPhotoAsset(
  supabase: SupabaseClient,
  context: ProjectContext,
  options?: {
    filename?: string;
    contentType?: string;
    buffer?: Buffer;
  },
) {
  const assetId = randomUUID();
  const originalFilename = options?.filename ?? `feature038-${randomUUID()}.png`;
  const storagePath = `tenant/${context.tenantId}/project/${context.projectId}/asset/${assetId}/${originalFilename}`;
  const contentType = options?.contentType ?? "image/png";
  const buffer =
    options?.buffer ??
    (await sharp({
      create: {
        width: 2400,
        height: 1600,
        channels: 4,
        background: { r: 24, g: 120, b: 96, alpha: 1 },
      },
    })
      .png()
      .toBuffer());

  const { error: uploadError } = await supabase.storage
    .from("project-assets")
    .upload(storagePath, buffer, {
      contentType,
      upsert: true,
    });
  assert.equal(uploadError, null, `upload original asset: ${uploadError?.message ?? ""}`);

  const uploadedAt = new Date().toISOString();
  const { error: assetError } = await supabase
    .from("assets")
    .insert({
      id: assetId,
      tenant_id: context.tenantId,
      project_id: context.projectId,
      created_by: context.userId,
      storage_bucket: "project-assets",
      storage_path: storagePath,
      original_filename: originalFilename,
      content_type: contentType,
      file_size_bytes: buffer.length,
      asset_type: "photo",
      status: "uploaded",
      uploaded_at: uploadedAt,
    });
  assertNoError(assetError, "insert uploaded photo asset");

  return {
    assetId,
    originalFilename,
    storagePath,
    contentType,
    buffer,
  };
}

async function createSampleVideoBuffer() {
  const ffmpegPath = getFfmpegPath();
  assert.ok(ffmpegPath, "ffmpeg path is required for video derivative tests");

  const tempDir = await mkdtemp(path.join(tmpdir(), "feature038-video-"));
  const outputPath = path.join(tempDir, "sample.mp4");

  try {
    await execFileAsync(
      ffmpegPath,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-f",
        "lavfi",
        "-i",
        "testsrc=size=960x540:rate=24:duration=2",
        "-pix_fmt",
        "yuv420p",
        "-c:v",
        "mpeg4",
        outputPath,
      ],
      {
        windowsHide: true,
      },
    );

    return await readFile(outputPath);
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function createUploadedVideoAsset(
  supabase: SupabaseClient,
  context: ProjectContext,
  options?: {
    filename?: string;
    contentType?: string;
    buffer?: Buffer;
  },
) {
  const assetId = randomUUID();
  const originalFilename = options?.filename ?? `feature038-${randomUUID()}.mp4`;
  const storagePath = `tenant/${context.tenantId}/project/${context.projectId}/asset/${assetId}/${originalFilename}`;
  const contentType = options?.contentType ?? "video/mp4";
  const buffer = options?.buffer ?? (await createSampleVideoBuffer());

  const { error: uploadError } = await supabase.storage
    .from("project-assets")
    .upload(storagePath, buffer, {
      contentType,
      upsert: true,
    });
  assert.equal(uploadError, null, `upload original video asset: ${uploadError?.message ?? ""}`);

  const uploadedAt = new Date().toISOString();
  const { error: assetError } = await supabase
    .from("assets")
    .insert({
      id: assetId,
      tenant_id: context.tenantId,
      project_id: context.projectId,
      created_by: context.userId,
      storage_bucket: "project-assets",
      storage_path: storagePath,
      original_filename: originalFilename,
      content_type: contentType,
      file_size_bytes: buffer.length,
      asset_type: "video",
      status: "uploaded",
      uploaded_at: uploadedAt,
    });
  assertNoError(assetError, "insert uploaded video asset");

  return {
    assetId,
    originalFilename,
    storagePath,
    contentType,
    buffer,
  };
}

async function drainAssetDerivativeWorkerUntil(
  context: ProjectContext,
  assetId: string,
  predicate: (
    derivatives: Awaited<ReturnType<typeof loadAssetImageDerivativesForAssetIds>>,
  ) => boolean,
  failureMessage: string,
) {
  const maxAttempts = 8;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    await runAssetImageDerivativeWorker({
      workerId: `feature038-drain:${randomUUID()}`,
      batchSize: 100,
    });

    const derivatives = await loadAssetImageDerivativesForAssetIds(
      admin,
      context.tenantId,
      context.projectId,
      [assetId],
    );
    if (predicate(derivatives)) {
      return derivatives;
    }
  }

  assert.fail(failureMessage);
}

async function drainAssetDerivativeWorkerUntilReady(context: ProjectContext, assetId: string) {
  return drainAssetDerivativeWorkerUntil(
    context,
    assetId,
    (derivatives) => {
      const thumbnail = derivatives.get(`${assetId}:thumbnail`);
      const preview = derivatives.get(`${assetId}:preview`);
      return thumbnail?.status === "ready" && preview?.status === "ready";
    },
    `Derivative worker did not finish asset ${assetId}`,
  );
}

async function drainAssetDerivativeWorkerUntilDead(context: ProjectContext, assetId: string) {
  return drainAssetDerivativeWorkerUntil(
    context,
    assetId,
    (derivatives) => {
      const thumbnail = derivatives.get(`${assetId}:thumbnail`);
      const preview = derivatives.get(`${assetId}:preview`);
      return thumbnail?.status === "dead" && preview?.status === "dead";
    },
    `Derivative worker did not dead-letter asset ${assetId}`,
  );
}

function createClaimedDerivativeRow(input: {
  assetId?: string;
  derivativeId?: string;
  derivativeKind: "thumbnail" | "preview";
}): AssetDerivativeClaimRow {
  const assetId = input.assetId ?? randomUUID();
  return {
    derivative_id: input.derivativeId ?? randomUUID(),
    tenant_id: "tenant-test",
    project_id: "project-test",
    asset_id: assetId,
    derivative_kind: input.derivativeKind,
    derivative_version: "asset-derivative-v1",
    storage_bucket: "asset-image-derivatives",
    storage_path: `tenant/tenant-test/project/project-test/asset/${assetId}/derivative/asset-derivative-v1/${input.derivativeKind}.jpg`,
    content_type: "image/jpeg",
    file_size_bytes: null,
    width: null,
    height: null,
    status: "processing",
    attempt_count: 1,
    max_attempts: 5,
    run_after: new Date().toISOString(),
    locked_at: new Date().toISOString(),
    locked_by: "test-worker",
    lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
    generated_at: null,
    failed_at: null,
    last_error_code: null,
    last_error_message: null,
    last_error_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

test("shared image upload policy accepts the feature 038 formats", () => {
  const acceptValue = getAcceptedImageUploadAcceptValue();
  assert.match(acceptValue, /image\/avif/);
  assert.match(acceptValue, /image\/tiff/);
  assert.match(acceptValue, /\.tiff/);

  assert.equal(isAcceptedImageUpload("image/avif", "photo.avif"), true);
  assert.equal(isAcceptedImageUpload("image/tiff", "scan.tiff"), true);
  assert.equal(isAcceptedImageUpload("", "scan.tif"), true);
  assert.equal(isAcceptedImageUpload("application/pdf", "document.pdf"), false);
});

test("video derivative worker resolves a usable ffmpeg path at runtime", async () => {
  const resolvedPath = await resolveAssetFfmpegPath();

  assert.ok(resolvedPath);
  assert.equal(resolvedPath, getFfmpegPath());
});

test("processClaimedVideoDerivativeGroup reuses source download and frame extraction for sibling video rows", async () => {
  const assetId = randomUUID();
  const thumbnailRow = createClaimedDerivativeRow({
    assetId,
    derivativeKind: "thumbnail",
  });
  const previewRow = createClaimedDerivativeRow({
    assetId,
    derivativeKind: "preview",
  });

  let downloadCount = 0;
  let extractCount = 0;
  const renderedKinds: string[] = [];
  const uploadedDerivativeIds: string[] = [];
  const completedDerivativeIds: string[] = [];

  const outcomes = await processClaimedVideoDerivativeGroup({
    supabase: {} as never,
    rows: [thumbnailRow, previewRow],
    sourceAsset: {
      id: assetId,
      status: "uploaded",
      asset_type: "video",
      storage_bucket: "project-assets",
      storage_path: "tenant/tenant-test/project/project-test/asset/source.mp4",
    },
    dependencies: {
      loadDerivativeRowsForAsset: async () => new Map<string, AssetImageDerivativeRow>(),
      downloadAssetBuffer: async () => {
        downloadCount += 1;
        return Buffer.from("video-source");
      },
      extractSharedVideoFrameBuffer: async () => {
        extractCount += 1;
        return Buffer.from("frame-buffer");
      },
      renderImageDerivativeBuffer: async (_sourceBuffer, derivativeKind) => {
        renderedKinds.push(derivativeKind);
        return {
          buffer: Buffer.from(`rendered-${derivativeKind}`),
          width: derivativeKind === "preview" ? 1536 : 480,
          height: derivativeKind === "preview" ? 864 : 270,
        };
      },
      uploadDerivativeBuffer: async (_supabase, row) => {
        uploadedDerivativeIds.push(row.derivative_id);
        return null;
      },
      completeAssetImageDerivative: async ({ derivativeId }) => {
        completedDerivativeIds.push(derivativeId);
      },
      failAssetImageDerivative: async () => {
        assert.fail("video sibling happy path should not fail a derivative row");
      },
    },
  });

  assert.deepEqual(outcomes, ["succeeded", "succeeded"]);
  assert.equal(downloadCount, 1);
  assert.equal(extractCount, 1);
  assert.deepEqual(renderedKinds, ["thumbnail", "preview"]);
  assert.deepEqual(uploadedDerivativeIds, [thumbnailRow.derivative_id, previewRow.derivative_id]);
  assert.deepEqual(completedDerivativeIds, [thumbnailRow.derivative_id, previewRow.derivative_id]);
});

test("processClaimedVideoDerivativeGroup allows partial sibling success after shared frame extraction", async () => {
  const assetId = randomUUID();
  const thumbnailRow = createClaimedDerivativeRow({
    assetId,
    derivativeKind: "thumbnail",
  });
  const previewRow = createClaimedDerivativeRow({
    assetId,
    derivativeKind: "preview",
  });

  const completedDerivativeIds: string[] = [];
  const failedDerivativeIds: Array<{ derivativeId: string; retryable: boolean | undefined }> = [];

  const outcomes = await processClaimedVideoDerivativeGroup({
    supabase: {} as never,
    rows: [thumbnailRow, previewRow],
    sourceAsset: {
      id: assetId,
      status: "uploaded",
      asset_type: "video",
      storage_bucket: "project-assets",
      storage_path: "tenant/tenant-test/project/project-test/asset/source.mp4",
    },
    dependencies: {
      loadDerivativeRowsForAsset: async () => new Map<string, AssetImageDerivativeRow>(),
      downloadAssetBuffer: async () => Buffer.from("video-source"),
      extractSharedVideoFrameBuffer: async () => Buffer.from("frame-buffer"),
      renderImageDerivativeBuffer: async (_sourceBuffer, derivativeKind) => ({
        buffer: Buffer.from(`rendered-${derivativeKind}`),
        width: derivativeKind === "preview" ? 1536 : 480,
        height: derivativeKind === "preview" ? 864 : 270,
      }),
      uploadDerivativeBuffer: async (_supabase, row) => (
        row.derivative_kind === "preview" ? new Error("preview upload failed") : null
      ),
      completeAssetImageDerivative: async ({ derivativeId }) => {
        completedDerivativeIds.push(derivativeId);
      },
      failAssetImageDerivative: async ({ derivativeId, retryable }) => {
        failedDerivativeIds.push({ derivativeId, retryable });
      },
    },
  });

  assert.deepEqual(outcomes, ["succeeded", "retried"]);
  assert.deepEqual(completedDerivativeIds, [thumbnailRow.derivative_id]);
  assert.deepEqual(failedDerivativeIds, [{
    derivativeId: previewRow.derivative_id,
    retryable: true,
  }]);
});

test("asset derivative worker generates stored thumbnail and preview variants and signed URLs prefer them", async () => {
  const context = await createProjectContext(admin);
  const uploadedAsset = await createUploadedPhotoAsset(admin, context);

  const queueResult = await queueAssetImageDerivativesForAssetIds({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetIds: [uploadedAsset.assetId],
  });
  assert.equal(queueResult.queued, 2);

  const workerResult = await runAssetImageDerivativeWorker({
    workerId: `feature038-worker:${randomUUID()}`,
    batchSize: 100,
  });
  assert.equal(workerResult.claimed >= 2, true);
  assert.equal(workerResult.succeeded >= 2, true);

  await drainAssetDerivativeWorkerUntilReady(context, uploadedAsset.assetId);

  const derivatives = await loadAssetImageDerivativesForAssetIds(
    admin,
    context.tenantId,
    context.projectId,
    [uploadedAsset.assetId],
  );
  assert.equal(derivatives.size, 2);

  const thumbnail = derivatives.get(`${uploadedAsset.assetId}:thumbnail`);
  const preview = derivatives.get(`${uploadedAsset.assetId}:preview`);
  assert.equal(thumbnail?.status, "ready");
  assert.equal(preview?.status, "ready");
  assert.equal(thumbnail?.storage_bucket, "asset-image-derivatives");
  assert.equal(preview?.storage_bucket, "asset-image-derivatives");

  const { data: previewBlob, error: previewDownloadError } = await admin.storage
    .from(String(preview?.storage_bucket))
    .download(String(preview?.storage_path));
  assert.equal(previewDownloadError, null, `download preview derivative: ${previewDownloadError?.message ?? ""}`);
  assert.ok(previewBlob);
  const previewBuffer = Buffer.from(await previewBlob.arrayBuffer());
  const previewMetadata = await sharp(previewBuffer).metadata();
  assert.equal(previewMetadata.format, "jpeg");
  assert.ok((previewMetadata.width ?? 0) <= 1536);
  assert.ok((previewMetadata.height ?? 0) <= 1536);

  const urlMap = await signThumbnailUrlsForAssets(null, [
    {
      id: uploadedAsset.assetId,
      status: "uploaded",
      storage_bucket: "project-assets",
      storage_path: uploadedAsset.storagePath,
    },
  ], {
    tenantId: context.tenantId,
    projectId: context.projectId,
    use: "preview",
    fallback: "original",
  });
  const signedUrl = urlMap.get(uploadedAsset.assetId) ?? "";
  assert.match(signedUrl, /asset-image-derivatives/);
});

test("request-scoped post-finalize processing still queues derivative rows through service-owned writes", async () => {
  const context = await createProjectContext(admin);
  const requestScopedClient = await createRequestScopedClient(context);
  const uploadedAsset = await createUploadedPhotoAsset(admin, context, {
    filename: "request-scoped.jpg",
    contentType: "image/jpeg",
  });

  await queueProjectAssetPostFinalizeProcessing({
    supabase: requestScopedClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: uploadedAsset.assetId,
    assetType: "photo",
    consentIds: [],
    source: "photo_finalize",
  });

  const derivatives = await loadAssetImageDerivativesForAssetIds(
    admin,
    context.tenantId,
    context.projectId,
    [uploadedAsset.assetId],
  );

  assert.equal(derivatives.size, 2);
  assert.equal(derivatives.get(`${uploadedAsset.assetId}:thumbnail`)?.status, "pending");
  assert.equal(derivatives.get(`${uploadedAsset.assetId}:preview`)?.status, "pending");
});

test("request-scoped post-finalize processing also queues a photo_uploaded matching job", async () => {
  const context = await createProjectContext(admin);
  const requestScopedClient = await createRequestScopedClient(context);
  const uploadedAsset = await createUploadedPhotoAsset(admin, context, {
    filename: "request-scoped-matching.jpg",
    contentType: "image/jpeg",
  });

  await queueProjectAssetPostFinalizeProcessing({
    supabase: requestScopedClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: uploadedAsset.assetId,
    assetType: "photo",
    consentIds: [],
    source: "photo_finalize",
  });

  const { data: jobRow, error: jobError } = await admin
    .from("face_match_jobs")
    .select("job_type, status, payload")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("scope_asset_id", uploadedAsset.assetId)
    .eq("job_type", "photo_uploaded")
    .maybeSingle();
  assertNoError(jobError, "select queued photo_uploaded job");

  assert.equal(jobRow?.job_type, "photo_uploaded");
  assert.equal(jobRow?.status, "queued");
  assert.match(String((jobRow?.payload as { source?: string } | null)?.source ?? ""), /^photo_finalize$/);
});

test("request-scoped post-finalize processing also queues poster rows for uploaded videos", async () => {
  const context = await createProjectContext(admin);
  const requestScopedClient = await createRequestScopedClient(context);
  const uploadedAsset = await createUploadedVideoAsset(admin, context, {
    filename: "request-scoped-video.mp4",
  });

  await queueProjectAssetPostFinalizeProcessing({
    supabase: requestScopedClient,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: uploadedAsset.assetId,
    assetType: "video",
    consentIds: [],
    source: "photo_finalize",
  });

  const derivatives = await loadAssetImageDerivativesForAssetIds(
    admin,
    context.tenantId,
    context.projectId,
    [uploadedAsset.assetId],
  );

  assert.equal(derivatives.size, 2);
  assert.equal(derivatives.get(`${uploadedAsset.assetId}:thumbnail`)?.status, "pending");
  assert.equal(derivatives.get(`${uploadedAsset.assetId}:preview`)?.status, "pending");
});

test("asset signing falls back to bounded transforms when no derivatives exist yet", async () => {
  const context = await createProjectContext(admin);
  const uploadedAsset = await createUploadedPhotoAsset(admin, context, {
    filename: "fallback-test.jpg",
    contentType: "image/jpeg",
    buffer: await sharp({
      create: {
        width: 1200,
        height: 800,
        channels: 3,
        background: { r: 180, g: 150, b: 60 },
      },
    })
      .jpeg()
      .toBuffer(),
  });

  const urlMap = await resolveSignedAssetDisplayUrlsForAssets(null, [
    {
      id: uploadedAsset.assetId,
      status: "uploaded",
      storage_bucket: "project-assets",
      storage_path: uploadedAsset.storagePath,
    },
  ], {
    tenantId: context.tenantId,
    projectId: context.projectId,
    use: "thumbnail",
    fallback: "transform",
  });

  const signed = urlMap.get(uploadedAsset.assetId);
  assert.equal(signed?.state, "transform_fallback");
  assert.match(String(signed?.url ?? ""), /project-assets/);
  assert.match(String(signed?.url ?? ""), /\/render\/image\/sign\//);
  assert.doesNotMatch(String(signed?.url ?? ""), /asset-image-derivatives/);
});

test("asset derivative worker generates stored poster thumbnail and preview variants for video assets", async () => {
  const context = await createProjectContext(admin);
  const uploadedAsset = await createUploadedVideoAsset(admin, context);

  const queueResult = await queueAssetImageDerivativesForAssetIds({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetIds: [uploadedAsset.assetId],
  });
  assert.equal(queueResult.queued, 2);

  const workerResult = await runAssetImageDerivativeWorker({
    workerId: `feature038-video-worker:${randomUUID()}`,
    batchSize: 100,
  });
  assert.equal(workerResult.claimed >= 2, true);
  assert.equal(workerResult.succeeded >= 2, true);

  await drainAssetDerivativeWorkerUntilReady(context, uploadedAsset.assetId);

  const derivatives = await loadAssetImageDerivativesForAssetIds(
    admin,
    context.tenantId,
    context.projectId,
    [uploadedAsset.assetId],
  );
  const thumbnail = derivatives.get(`${uploadedAsset.assetId}:thumbnail`);
  const preview = derivatives.get(`${uploadedAsset.assetId}:preview`);

  assert.equal(thumbnail?.status, "ready");
  assert.equal(preview?.status, "ready");
  assert.equal(thumbnail?.storage_bucket, "asset-image-derivatives");
  assert.equal(preview?.storage_bucket, "asset-image-derivatives");

  const { data: previewBlob, error: previewDownloadError } = await admin.storage
    .from(String(preview?.storage_bucket))
    .download(String(preview?.storage_path));
  assert.equal(previewDownloadError, null, `download video preview derivative: ${previewDownloadError?.message ?? ""}`);
  assert.ok(previewBlob);
  const previewBuffer = Buffer.from(await previewBlob.arrayBuffer());
  const previewMetadata = await sharp(previewBuffer).metadata();
  assert.equal(previewMetadata.format, "jpeg");
  assert.ok((previewMetadata.width ?? 0) <= 1536);
  assert.ok((previewMetadata.height ?? 0) <= 1536);
});

test("asset derivative repair queues missing legacy derivatives without disturbing ready rows", async () => {
  const context = await createProjectContext(admin);
  const missingAsset = await createUploadedPhotoAsset(admin, context, {
    filename: "repair-missing.jpg",
    contentType: "image/jpeg",
  });
  const readyAsset = await createUploadedPhotoAsset(admin, context, {
    filename: "repair-ready.jpg",
    contentType: "image/jpeg",
  });
  const missingVideoAsset = await createUploadedVideoAsset(admin, context, {
    filename: "repair-missing-video.mp4",
  });
  const readyVideoAsset = await createUploadedVideoAsset(admin, context, {
    filename: "repair-ready-video.mp4",
  });

  await queueAssetImageDerivativesForAssetIds({
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetIds: [readyAsset.assetId, readyVideoAsset.assetId],
  });
  await drainAssetDerivativeWorkerUntilReady(context, readyAsset.assetId);
  await drainAssetDerivativeWorkerUntilReady(context, readyVideoAsset.assetId);

  const repair = await runAssetImageDerivativeRepair({
    tenantId: context.tenantId,
    projectId: context.projectId,
    limit: 50,
  });

  assert.equal(repair.scannedAssets >= 4, true);
  assert.equal(repair.missingCurrentAssets >= 2, true);
  assert.equal(repair.queuedAssets >= 2, true);

  const derivatives = await loadAssetImageDerivativesForAssetIds(
    admin,
    context.tenantId,
    context.projectId,
    [missingAsset.assetId, readyAsset.assetId, missingVideoAsset.assetId, readyVideoAsset.assetId],
  );
  assert.equal(derivatives.get(`${missingAsset.assetId}:thumbnail`)?.status, "pending");
  assert.equal(derivatives.get(`${missingAsset.assetId}:preview`)?.status, "pending");
  assert.equal(derivatives.get(`${readyAsset.assetId}:thumbnail`)?.status, "ready");
  assert.equal(derivatives.get(`${readyAsset.assetId}:preview`)?.status, "ready");
  assert.equal(derivatives.get(`${missingVideoAsset.assetId}:thumbnail`)?.status, "pending");
  assert.equal(derivatives.get(`${missingVideoAsset.assetId}:preview`)?.status, "pending");
  assert.equal(derivatives.get(`${readyVideoAsset.assetId}:thumbnail`)?.status, "ready");
  assert.equal(derivatives.get(`${readyVideoAsset.assetId}:preview`)?.status, "ready");
});

test("asset derivative repair requeues a missing video sibling without regenerating the ready sibling", async () => {
  const context = await createProjectContext(admin);
  const uploadedAsset = await createUploadedVideoAsset(admin, context, {
    filename: "repair-single-video-sibling.mp4",
  });

  await queueAssetImageDerivativesForAssetIds({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetIds: [uploadedAsset.assetId],
  });
  await drainAssetDerivativeWorkerUntilReady(context, uploadedAsset.assetId);

  const initialDerivatives = await loadAssetImageDerivativesForAssetIds(
    admin,
    context.tenantId,
    context.projectId,
    [uploadedAsset.assetId],
  );
  const initialPreview = initialDerivatives.get(`${uploadedAsset.assetId}:preview`);
  assert.equal(initialPreview?.status, "ready");
  assert.ok(initialPreview?.generated_at);

  const { error: deleteError } = await admin
    .from("asset_image_derivatives")
    .delete()
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("asset_id", uploadedAsset.assetId)
    .eq("derivative_kind", "thumbnail");
  assertNoError(deleteError, "delete ready video thumbnail derivative row");

  const repair = await runAssetImageDerivativeRepair({
    tenantId: context.tenantId,
    projectId: context.projectId,
    limit: 20,
  });
  assert.equal(repair.queuedDerivatives >= 1, true);

  const repairedPendingDerivatives = await loadAssetImageDerivativesForAssetIds(
    admin,
    context.tenantId,
    context.projectId,
    [uploadedAsset.assetId],
  );
  assert.equal(repairedPendingDerivatives.get(`${uploadedAsset.assetId}:thumbnail`)?.status, "pending");
  assert.equal(repairedPendingDerivatives.get(`${uploadedAsset.assetId}:preview`)?.status, "ready");
  assert.equal(
    repairedPendingDerivatives.get(`${uploadedAsset.assetId}:preview`)?.generated_at,
    initialPreview?.generated_at,
  );

  await drainAssetDerivativeWorkerUntilReady(context, uploadedAsset.assetId);

  const repairedReadyDerivatives = await loadAssetImageDerivativesForAssetIds(
    admin,
    context.tenantId,
    context.projectId,
    [uploadedAsset.assetId],
  );
  assert.equal(repairedReadyDerivatives.get(`${uploadedAsset.assetId}:thumbnail`)?.status, "ready");
  assert.equal(repairedReadyDerivatives.get(`${uploadedAsset.assetId}:preview`)?.status, "ready");
  assert.equal(
    repairedReadyDerivatives.get(`${uploadedAsset.assetId}:preview`)?.generated_at,
    initialPreview?.generated_at,
  );
});

test("invalid video poster generation dead-letters derivative rows without changing upload availability", async () => {
  const context = await createProjectContext(admin);
  const uploadedAsset = await createUploadedVideoAsset(admin, context, {
    filename: "invalid-video.mp4",
    buffer: Buffer.from("not-a-real-video"),
  });

  const queueResult = await queueAssetImageDerivativesForAssetIds({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetIds: [uploadedAsset.assetId],
  });
  assert.equal(queueResult.queued, 2);

  await drainAssetDerivativeWorkerUntilDead(context, uploadedAsset.assetId);

  const derivatives = await loadAssetImageDerivativesForAssetIds(
    admin,
    context.tenantId,
    context.projectId,
    [uploadedAsset.assetId],
  );
  assert.equal(derivatives.get(`${uploadedAsset.assetId}:thumbnail`)?.status, "dead");
  assert.equal(derivatives.get(`${uploadedAsset.assetId}:preview`)?.status, "dead");

  const { data: assetRow, error: assetError } = await admin
    .from("assets")
    .select("status")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("id", uploadedAsset.assetId)
    .maybeSingle();
  assertNoError(assetError, "select uploaded invalid video asset");
  assert.equal(assetRow?.status, "uploaded");
});
