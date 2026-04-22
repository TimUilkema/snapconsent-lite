import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { createClient, type PostgrestError, type SupabaseClient } from "@supabase/supabase-js";

import { createAssetWithIdempotency } from "../src/lib/assets/create-asset";
import {
  finalizeProjectAssetBatch,
  MAX_PROJECT_UPLOAD_FINALIZE_ITEMS,
} from "../src/lib/assets/finalize-project-asset-batch";
import { finalizeAsset } from "../src/lib/assets/finalize-asset";
import {
  MAX_PROJECT_UPLOAD_PREPARE_ITEMS,
  prepareProjectAssetBatch,
} from "../src/lib/assets/prepare-project-asset-batch";
import { buildPhotoUploadedDedupeKey } from "../src/lib/matching/auto-match-jobs";
import {
  clearProjectUploadManifest,
  createProjectUploadItem,
  createProjectUploadManifest,
  hasUnfinishedProjectUploadItems,
  loadProjectUploadManifest,
  recoverProjectUploadManifest,
  saveProjectUploadManifest,
} from "../src/lib/uploads/project-upload-manifest";
import {
  collectDuplicateContentHashes,
  hashProjectUploadFile,
} from "../src/lib/uploads/project-upload-duplicate-detection";
import { chunkProjectUploadItems, markProjectUploadManifestBlockedAuth } from "../src/lib/uploads/project-upload-queue";
import { PROJECT_UPLOAD_PREFLIGHT_BATCH_SIZE } from "../src/lib/uploads/project-upload-types";
import type { ProjectUploadStorageLike } from "../src/lib/uploads/project-upload-types";

type ProjectContext = {
  tenantId: string;
  projectId: string;
  userId: string;
};

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

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

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

async function createAuthUserWithRetry(supabase: SupabaseClient) {
  const maxAttempts = 6;
  let lastError: { message?: string; code?: string } | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const email = `feature024-${randomUUID()}@example.com`;
    const password = `SnapConsent-${randomUUID()}-A1!`;
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (!error && data.user?.id) {
      return data.user.id;
    }

    lastError = error;
    if (error?.code !== "unexpected_failure" || attempt === maxAttempts) {
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
  }

  assert.fail(
    `Unable to create auth user for tests: ${lastError?.code ?? "unknown"} ${lastError?.message ?? "no error message"}`,
  );
}

async function createProjectContext(supabase: SupabaseClient): Promise<ProjectContext> {
  const userId = await createAuthUserWithRetry(supabase);

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .insert({ name: `Feature 024 Tenant ${randomUUID()}` })
    .select("id")
    .single();
  assertNoError(tenantError, "insert tenant");

  const { error: membershipError } = await supabase.from("memberships").insert({
    tenant_id: tenant.id,
    user_id: userId,
    role: "owner",
  });
  assertNoError(membershipError, "insert membership");

  const { data: project, error: projectError } = await supabase
    .from("projects")
    .insert({
      tenant_id: tenant.id,
      created_by: userId,
      name: `Feature 024 Project ${randomUUID()}`,
      description: "Feature 024 upload tests",
      status: "active",
    })
    .select("id")
    .single();
  assertNoError(projectError, "insert project");

  return {
    tenantId: tenant.id,
    projectId: project.id,
    userId,
  };
}

function createMemoryStorage(): ProjectUploadStorageLike {
  const store = new Map<string, string>();
  return {
    getItem(key) {
      return store.get(key) ?? null;
    },
    setItem(key, value) {
      store.set(key, value);
    },
    removeItem(key) {
      store.delete(key);
    },
  };
}

test("prepareProjectAssetBatch rejects oversized batch requests", async () => {
  await assert.rejects(
    async () => {
      await prepareProjectAssetBatch({
        supabase: {} as SupabaseClient,
        tenantId: randomUUID(),
        projectId: randomUUID(),
        userId: randomUUID(),
        assetType: "photo",
        duplicatePolicy: "upload_anyway",
        items: Array.from({ length: MAX_PROJECT_UPLOAD_PREPARE_ITEMS + 1 }, (_, index) => ({
          clientItemId: `item-${index}`,
          idempotencyKey: `idempotency-${index}-${randomUUID()}`,
          originalFilename: `file-${index}.jpg`,
          contentType: "image/jpeg",
          fileSizeBytes: 1024,
        })),
      });
    },
    /Too many upload items/,
  );
});

test("finalizeProjectAssetBatch rejects oversized batch requests", async () => {
  await assert.rejects(
    async () => {
      await finalizeProjectAssetBatch({
        supabase: {} as SupabaseClient,
        tenantId: randomUUID(),
        projectId: randomUUID(),
        items: Array.from({ length: MAX_PROJECT_UPLOAD_FINALIZE_ITEMS + 1 }, (_, index) => ({
          clientItemId: `item-${index}`,
          assetId: randomUUID(),
        })),
      });
    },
    /Too many upload items/,
  );
});

test("prepareProjectAssetBatch reuses the same asset on idempotent retry", async () => {
  const context = await createProjectContext(admin);
  const item = {
    clientItemId: "item-1",
    idempotencyKey: `feature024-prepare-${randomUUID()}`,
    originalFilename: "example.jpg",
    contentType: "image/jpeg",
    fileSizeBytes: 2048,
    contentHash: null,
    contentHashAlgo: null,
  } as const;

  const first = await prepareProjectAssetBatch({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    userId: context.userId,
    assetType: "photo",
    duplicatePolicy: "upload_anyway",
    items: [item],
  });
  const second = await prepareProjectAssetBatch({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    userId: context.userId,
    assetType: "photo",
    duplicatePolicy: "upload_anyway",
    items: [item],
  });

  assert.equal(first[0]?.status, "ready");
  assert.equal(second[0]?.status, "ready");
  if (first[0]?.status !== "ready" || second[0]?.status !== "ready") {
    assert.fail("prepare batch did not return ready results");
  }
  assert.equal(first[0].assetId, second[0].assetId);

  const { data: assets, error: assetsError } = await admin
    .from("assets")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId);
  assertNoError(assetsError, "select assets");
  assert.equal((assets ?? []).length, 1);
});

test("hashProjectUploadFile hashes every selected file and same-size non-duplicates remain distinct", async () => {
  const duplicateLeft = new File(["alexandra"], "duplicate-left.jpg", { type: "image/jpeg" });
  const duplicateRight = new File(["alexandra"], "duplicate-right.jpg", { type: "image/jpeg" });
  const sameSizeDifferent = new File(["bradpitt!"], "same-size-different.jpg", { type: "image/jpeg" });

  const duplicateLeftHash = await hashProjectUploadFile(duplicateLeft);
  const duplicateRightHash = await hashProjectUploadFile(duplicateRight);
  const differentHash = await hashProjectUploadFile(sameSizeDifferent);

  assert.equal(duplicateLeftHash?.length, 64);
  assert.equal(duplicateRightHash?.length, 64);
  assert.equal(differentHash?.length, 64);
  assert.equal(duplicateLeftHash, duplicateRightHash);
  assert.notEqual(duplicateLeftHash, differentHash);

  const duplicateHashes = collectDuplicateContentHashes([
    { contentHash: duplicateLeftHash },
    { contentHash: duplicateRightHash },
    { contentHash: differentHash },
  ]);

  assert.deepEqual(Array.from(duplicateHashes), [duplicateLeftHash]);
});

test("prepareProjectAssetBatch skips later same-request duplicates for ignore by request order", async () => {
  const context = await createProjectContext(admin);
  const firstIdempotencyKey = `feature024-ignore-first-${randomUUID()}`;
  const secondIdempotencyKey = `feature024-ignore-second-${randomUUID()}`;

  const results = await prepareProjectAssetBatch({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    userId: context.userId,
    assetType: "photo",
    duplicatePolicy: "ignore",
    items: [
      {
        clientItemId: "first",
        idempotencyKey: firstIdempotencyKey,
        originalFilename: "first.jpg",
        contentType: "image/jpeg",
        fileSizeBytes: 2048,
        contentHash: HASH_A,
        contentHashAlgo: "sha256",
      },
      {
        clientItemId: "second",
        idempotencyKey: secondIdempotencyKey,
        originalFilename: "second.jpg",
        contentType: "image/jpeg",
        fileSizeBytes: 2048,
        contentHash: HASH_A,
        contentHashAlgo: "sha256",
      },
    ],
  });

  assert.equal(results[0]?.status, "ready");
  assert.deepEqual(results[1], {
    clientItemId: "second",
    status: "skipped_duplicate",
    duplicate: true,
  });

  const { data: assets, error } = await admin
    .from("assets")
    .select("id, content_hash")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId);
  assertNoError(error, "select ignore duplicate assets");
  assert.equal((assets ?? []).length, 1);
  assert.equal(assets?.[0]?.content_hash, HASH_A);
});

test("prepareProjectAssetBatch allows same-request duplicates for upload_anyway", async () => {
  const context = await createProjectContext(admin);

  const results = await prepareProjectAssetBatch({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    userId: context.userId,
    assetType: "photo",
    duplicatePolicy: "upload_anyway",
    items: [
      {
        clientItemId: "first",
        idempotencyKey: `feature024-anyway-first-${randomUUID()}`,
        originalFilename: "first.jpg",
        contentType: "image/jpeg",
        fileSizeBytes: 2048,
        contentHash: HASH_A,
        contentHashAlgo: "sha256",
      },
      {
        clientItemId: "second",
        idempotencyKey: `feature024-anyway-second-${randomUUID()}`,
        originalFilename: "second.jpg",
        contentType: "image/jpeg",
        fileSizeBytes: 2048,
        contentHash: HASH_A,
        contentHashAlgo: "sha256",
      },
    ],
  });

  assert.equal(results[0]?.status, "ready");
  assert.equal(results[1]?.status, "ready");

  const { data: assets, error } = await admin
    .from("assets")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("content_hash", HASH_A);
  assertNoError(error, "select upload_anyway duplicate assets");
  assert.equal((assets ?? []).length, 2);
});

test("prepareProjectAssetBatch skips later same-request duplicates for overwrite in this cycle", async () => {
  const context = await createProjectContext(admin);

  const results = await prepareProjectAssetBatch({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    userId: context.userId,
    assetType: "photo",
    duplicatePolicy: "overwrite",
    items: [
      {
        clientItemId: "first",
        idempotencyKey: `feature024-overwrite-first-${randomUUID()}`,
        originalFilename: "first.jpg",
        contentType: "image/jpeg",
        fileSizeBytes: 2048,
        contentHash: HASH_B,
        contentHashAlgo: "sha256",
      },
      {
        clientItemId: "second",
        idempotencyKey: `feature024-overwrite-second-${randomUUID()}`,
        originalFilename: "second.jpg",
        contentType: "image/jpeg",
        fileSizeBytes: 2048,
        contentHash: HASH_B,
        contentHashAlgo: "sha256",
      },
    ],
  });

  assert.equal(results[0]?.status, "ready");
  assert.deepEqual(results[1], {
    clientItemId: "second",
    status: "skipped_duplicate",
    duplicate: true,
  });
});

test("prepareProjectAssetBatch keeps same-request same-size non-duplicates ready", async () => {
  const context = await createProjectContext(admin);

  const results = await prepareProjectAssetBatch({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    userId: context.userId,
    assetType: "photo",
    duplicatePolicy: "ignore",
    items: [
      {
        clientItemId: "first",
        idempotencyKey: `feature024-distinct-first-${randomUUID()}`,
        originalFilename: "first.jpg",
        contentType: "image/jpeg",
        fileSizeBytes: 4096,
        contentHash: HASH_A,
        contentHashAlgo: "sha256",
      },
      {
        clientItemId: "second",
        idempotencyKey: `feature024-distinct-second-${randomUUID()}`,
        originalFilename: "second.jpg",
        contentType: "image/jpeg",
        fileSizeBytes: 4096,
        contentHash: HASH_B,
        contentHashAlgo: "sha256",
      },
    ],
  });

  assert.equal(results[0]?.status, "ready");
  assert.equal(results[1]?.status, "ready");
});

test("prepareProjectAssetBatch allows video items without content hashes under ignore", async () => {
  const context = await createProjectContext(admin);

  const results = await prepareProjectAssetBatch({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    userId: context.userId,
    assetType: "video",
    duplicatePolicy: "ignore",
    items: [
      {
        clientItemId: "first-video",
        idempotencyKey: `feature024-video-null-first-${randomUUID()}`,
        originalFilename: "first.mp4",
        contentType: "video/mp4",
        fileSizeBytes: 4096,
        contentHash: null,
        contentHashAlgo: null,
      },
      {
        clientItemId: "second-video",
        idempotencyKey: `feature024-video-null-second-${randomUUID()}`,
        originalFilename: "second.mp4",
        contentType: "video/mp4",
        fileSizeBytes: 4096,
        contentHash: null,
        contentHashAlgo: null,
      },
    ],
  });

  assert.equal(results[0]?.status, "ready");
  assert.equal(results[1]?.status, "ready");
});

test("prepareProjectAssetBatch does not skip video duplicates when hashes are present", async () => {
  const context = await createProjectContext(admin);

  const results = await prepareProjectAssetBatch({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    userId: context.userId,
    assetType: "video",
    duplicatePolicy: "ignore",
    items: [
      {
        clientItemId: "first-video",
        idempotencyKey: `feature024-video-hash-first-${randomUUID()}`,
        originalFilename: "first.mp4",
        contentType: "video/mp4",
        fileSizeBytes: 4096,
        contentHash: HASH_A,
        contentHashAlgo: "sha256",
      },
      {
        clientItemId: "second-video",
        idempotencyKey: `feature024-video-hash-second-${randomUUID()}`,
        originalFilename: "second.mp4",
        contentType: "video/mp4",
        fileSizeBytes: 4096,
        contentHash: HASH_A,
        contentHashAlgo: "sha256",
      },
    ],
  });

  assert.equal(results[0]?.status, "ready");
  assert.equal(results[1]?.status, "ready");

  const { data: assets, error } = await admin
    .from("assets")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("asset_type", "video")
    .eq("content_hash", HASH_A);
  assertNoError(error, "select video duplicate assets");
  assert.equal((assets ?? []).length, 2);
});

test("prepareProjectAssetBatch skips duplicates against existing DB assets", async () => {
  const context = await createProjectContext(admin);

  const existing = await createAssetWithIdempotency({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    userId: context.userId,
    idempotencyKey: `feature024-existing-${randomUUID()}`,
    originalFilename: "existing.jpg",
    contentType: "image/jpeg",
    fileSizeBytes: 1024,
    consentIds: [],
    contentHash: HASH_A,
    contentHashAlgo: "sha256",
    duplicatePolicy: "upload_anyway",
  });
  assert.equal(existing.status, 201);

  const [result] = await prepareProjectAssetBatch({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    userId: context.userId,
    assetType: "photo",
    duplicatePolicy: "ignore",
    items: [
      {
        clientItemId: "duplicate",
        idempotencyKey: `feature024-existing-duplicate-${randomUUID()}`,
        originalFilename: "duplicate.jpg",
        contentType: "image/jpeg",
        fileSizeBytes: 1024,
        contentHash: HASH_A,
        contentHashAlgo: "sha256",
      },
    ],
  });

  assert.deepEqual(result, {
    clientItemId: "duplicate",
    status: "skipped_duplicate",
    duplicate: true,
  });
});

test("prepareProjectAssetBatch skips duplicates against existing pending rows with hashes", async () => {
  const context = await createProjectContext(admin);

  const pending = await createAssetWithIdempotency({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    userId: context.userId,
    idempotencyKey: `feature024-pending-${randomUUID()}`,
    originalFilename: "pending.jpg",
    contentType: "image/jpeg",
    fileSizeBytes: 1024,
    consentIds: [],
    contentHash: HASH_C,
    contentHashAlgo: "sha256",
    duplicatePolicy: "upload_anyway",
  });
  assert.equal(pending.status, 201);

  const [result] = await prepareProjectAssetBatch({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    userId: context.userId,
    assetType: "photo",
    duplicatePolicy: "ignore",
    items: [
      {
        clientItemId: "duplicate",
        idempotencyKey: `feature024-pending-duplicate-${randomUUID()}`,
        originalFilename: "duplicate.jpg",
        contentType: "image/jpeg",
        fileSizeBytes: 1024,
        contentHash: HASH_C,
        contentHashAlgo: "sha256",
      },
    ],
  });

  assert.deepEqual(result, {
    clientItemId: "duplicate",
    status: "skipped_duplicate",
    duplicate: true,
  });
});

test("prepareProjectAssetBatch remains retry-safe with same-request duplicates", async () => {
  const context = await createProjectContext(admin);
  const firstItem = {
    clientItemId: "first",
    idempotencyKey: `feature024-retry-first-${randomUUID()}`,
    originalFilename: "first.jpg",
    contentType: "image/jpeg",
    fileSizeBytes: 2048,
    contentHash: HASH_A,
    contentHashAlgo: "sha256" as const,
  };
  const secondItem = {
    clientItemId: "second",
    idempotencyKey: `feature024-retry-second-${randomUUID()}`,
    originalFilename: "second.jpg",
    contentType: "image/jpeg",
    fileSizeBytes: 2048,
    contentHash: HASH_A,
    contentHashAlgo: "sha256" as const,
  };

  const firstRun = await prepareProjectAssetBatch({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    userId: context.userId,
    assetType: "photo",
    duplicatePolicy: "ignore",
    items: [firstItem, secondItem],
  });
  const secondRun = await prepareProjectAssetBatch({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    userId: context.userId,
    assetType: "photo",
    duplicatePolicy: "ignore",
    items: [firstItem, secondItem],
  });

  assert.equal(firstRun[0]?.status, "ready");
  assert.equal(secondRun[0]?.status, "ready");
  assert.deepEqual(firstRun[1], {
    clientItemId: "second",
    status: "skipped_duplicate",
    duplicate: true,
  });
  assert.deepEqual(secondRun[1], {
    clientItemId: "second",
    status: "skipped_duplicate",
    duplicate: true,
  });

  if (firstRun[0]?.status !== "ready" || secondRun[0]?.status !== "ready") {
    assert.fail("expected ready results for surviving batch item");
  }

  assert.equal(firstRun[0].assetId, secondRun[0].assetId);

  const { data: assets, error } = await admin
    .from("assets")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("content_hash", HASH_A);
  assertNoError(error, "select retry-safe duplicate assets");
  assert.equal((assets ?? []).length, 1);
});

test("finalizeProjectAssetBatch is retry-safe and matching enqueue remains deduped", async () => {
  const context = await createProjectContext(admin);
  const item = {
    clientItemId: "item-1",
    idempotencyKey: `feature024-finalize-${randomUUID()}`,
    originalFilename: "queued.jpg",
    contentType: "image/jpeg",
    fileSizeBytes: 4096,
    contentHash: null,
    contentHashAlgo: null,
  } as const;

  const [prepared] = await prepareProjectAssetBatch({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    userId: context.userId,
    assetType: "photo",
    duplicatePolicy: "upload_anyway",
    items: [item],
  });

  assert.equal(prepared?.status, "ready");
  if (!prepared || prepared.status !== "ready") {
    assert.fail("prepare batch did not return a ready result");
  }

  const firstFinalize = await finalizeProjectAssetBatch({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    items: [{ clientItemId: item.clientItemId, assetId: prepared.assetId }],
  });
  const secondFinalize = await finalizeProjectAssetBatch({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    items: [{ clientItemId: item.clientItemId, assetId: prepared.assetId }],
  });

  assert.equal(firstFinalize[0]?.status, "finalized");
  assert.equal(secondFinalize[0]?.status, "finalized");

  const { data: assetRow, error: assetError } = await admin
    .from("assets")
    .select("status, uploaded_at")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("id", prepared.assetId)
    .maybeSingle();
  assertNoError(assetError, "select finalized asset");
  assert.equal(assetRow?.status, "uploaded");
  assert.ok(assetRow?.uploaded_at);

  const dedupeKey = buildPhotoUploadedDedupeKey(prepared.assetId);
  const { data: jobs, error: jobsError } = await admin
    .from("face_match_jobs")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId)
    .eq("dedupe_key", dedupeKey);
  assertNoError(jobsError, "select face match jobs");
  assert.equal((jobs ?? []).length, 1);
});

test("single-item create/finalize helpers still work for unchanged upload flows", async () => {
  const context = await createProjectContext(admin);
  const idempotencyKey = `feature024-single-${randomUUID()}`;

  const created = await createAssetWithIdempotency({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    userId: context.userId,
    idempotencyKey,
    originalFilename: "single.jpg",
    contentType: "image/jpeg",
    fileSizeBytes: 1024,
    consentIds: [],
    duplicatePolicy: "upload_anyway",
  });

  assert.equal(created.status, 201);
  if ("skipUpload" in created.payload) {
    assert.fail("single-item create unexpectedly skipped upload");
  }

  const finalized = await finalizeAsset({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: created.payload.assetId,
    consentIds: [],
  });

  assert.equal(finalized.assetId, created.payload.assetId);
  assert.equal(finalized.assetType, "photo");
});

test("single-item video create/finalize helpers remain retry-safe without photo matching enqueue", async () => {
  const context = await createProjectContext(admin);
  const idempotencyKey = `feature024-video-single-${randomUUID()}`;

  const created = await createAssetWithIdempotency({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    userId: context.userId,
    idempotencyKey,
    originalFilename: "single.mp4",
    contentType: "video/mp4",
    fileSizeBytes: 1024,
    consentIds: [],
    assetType: "video",
    duplicatePolicy: "upload_anyway",
  });

  assert.equal(created.status, 201);
  if ("skipUpload" in created.payload) {
    assert.fail("single-item video create unexpectedly skipped upload");
  }

  const finalized = await finalizeAsset({
    supabase: admin,
    tenantId: context.tenantId,
    projectId: context.projectId,
    assetId: created.payload.assetId,
    consentIds: [],
  });

  assert.equal(finalized.assetId, created.payload.assetId);
  assert.equal(finalized.assetType, "video");

  const { data: jobs, error: jobsError } = await admin
    .from("face_match_jobs")
    .select("id")
    .eq("tenant_id", context.tenantId)
    .eq("project_id", context.projectId);
  assertNoError(jobsError, "select video face match jobs");
  assert.equal((jobs ?? []).length, 0);
});

test("project upload manifest round-trips through storage and recovers unfinished items", () => {
  const storage = createMemoryStorage();
  const projectId = randomUUID();
  const selected = createProjectUploadItem({
    name: "selected.jpg",
    size: 111,
    lastModified: 1,
    type: "image/jpeg",
  });
  const uploaded = {
    ...createProjectUploadItem({
      name: "uploaded.jpg",
      size: 222,
      lastModified: 2,
      type: "image/jpeg",
    }),
    assetId: randomUUID(),
    status: "uploaded" as const,
    uploadedBytes: 222,
  };

  const manifest = createProjectUploadManifest(projectId, [selected, uploaded]);
  saveProjectUploadManifest(storage, manifest);

  const loaded = loadProjectUploadManifest(storage, projectId);
  assert.ok(loaded);
  assert.equal(hasUnfinishedProjectUploadItems(loaded!), true);

  const recovered = recoverProjectUploadManifest(loaded!);
  const recoveredSelected = recovered.items.find((item) => item.clientItemId === selected.clientItemId);
  const recoveredUploaded = recovered.items.find((item) => item.clientItemId === uploaded.clientItemId);

  assert.equal(recovered.queueState, "recoverable");
  assert.equal(recoveredSelected?.status, "needs_file");
  assert.equal(recoveredUploaded?.status, "uploaded");

  clearProjectUploadManifest(storage, projectId);
  assert.equal(loadProjectUploadManifest(storage, projectId), null);
});

test("auth-blocked manifest state preserves finished items and blocks unfinished ones", () => {
  const projectId = randomUUID();
  const finalized = {
    ...createProjectUploadItem({
      name: "done.jpg",
      size: 200,
      lastModified: 1,
      type: "image/jpeg",
    }),
    status: "finalized" as const,
  };
  const pending = {
    ...createProjectUploadItem({
      name: "pending.jpg",
      size: 300,
      lastModified: 2,
      type: "image/jpeg",
    }),
    status: "prepared" as const,
  };

  const blocked = markProjectUploadManifestBlockedAuth(
    createProjectUploadManifest(projectId, [finalized, pending]),
  );

  assert.equal(blocked.queueState, "blocked_auth");
  assert.equal(blocked.items[0]?.status, "finalized");
  assert.equal(blocked.items[1]?.status, "blocked_auth");
});

test("large selections are chunked into bounded preflight slices", () => {
  const values = Array.from({ length: 2000 }, (_, index) => index + 1);
  const chunks = chunkProjectUploadItems(values, PROJECT_UPLOAD_PREFLIGHT_BATCH_SIZE);

  assert.equal(chunks.length, 8);
  assert.deepEqual(chunks[0], values.slice(0, PROJECT_UPLOAD_PREFLIGHT_BATCH_SIZE));
  assert.deepEqual(chunks.at(-1), values.slice(1750));
});
