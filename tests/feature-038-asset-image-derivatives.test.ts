import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";

import {
  getAcceptedImageUploadAcceptValue,
  isAcceptedImageUpload,
} from "../src/lib/assets/asset-image-policy";
import { runAssetImageDerivativeRepair } from "../src/lib/assets/asset-image-derivative-repair";
import {
  loadAssetImageDerivativesForAssetIds,
  queueAssetImageDerivativesForAssetIds,
} from "../src/lib/assets/asset-image-derivatives";
import { runAssetImageDerivativeWorker } from "../src/lib/assets/asset-image-derivative-worker";
import { queueProjectAssetPostFinalizeProcessing } from "../src/lib/assets/post-finalize-processing";
import {
  resolveSignedAssetDisplayUrlsForAssets,
  signThumbnailUrlsForAssets,
} from "../src/lib/assets/sign-asset-thumbnails";

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

async function drainAssetDerivativeWorkerUntilReady(context: ProjectContext, assetId: string) {
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
    const thumbnail = derivatives.get(`${assetId}:thumbnail`);
    const preview = derivatives.get(`${assetId}:preview`);
    if (thumbnail?.status === "ready" && preview?.status === "ready") {
      return derivatives;
    }
  }

  assert.fail(`Derivative worker did not finish asset ${assetId}`);
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

  await queueAssetImageDerivativesForAssetIds({
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetIds: [readyAsset.assetId],
  });
  await drainAssetDerivativeWorkerUntilReady(context, readyAsset.assetId);

  const repair = await runAssetImageDerivativeRepair({
    tenantId: context.tenantId,
    projectId: context.projectId,
    limit: 50,
  });

  assert.equal(repair.scannedAssets >= 2, true);
  assert.equal(repair.missingCurrentAssets >= 1, true);
  assert.equal(repair.queuedAssets >= 1, true);

  const derivatives = await loadAssetImageDerivativesForAssetIds(
    admin,
    context.tenantId,
    context.projectId,
    [missingAsset.assetId, readyAsset.assetId],
  );
  assert.equal(derivatives.get(`${missingAsset.assetId}:thumbnail`)?.status, "pending");
  assert.equal(derivatives.get(`${missingAsset.assetId}:preview`)?.status, "pending");
  assert.equal(derivatives.get(`${readyAsset.assetId}:thumbnail`)?.status, "ready");
  assert.equal(derivatives.get(`${readyAsset.assetId}:preview`)?.status, "ready");
});
