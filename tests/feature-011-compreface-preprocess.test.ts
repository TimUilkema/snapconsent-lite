import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";

import type { AutoMatcherCandidate } from "../src/lib/matching/auto-matcher";
import { MatcherProviderError } from "../src/lib/matching/provider-errors";
import {
  COMPREFACE_MAX_IMAGE_BYTES,
  createCompreFaceAutoMatcher,
} from "../src/lib/matching/providers/compreface";

type FakeStorageStats = {
  downloadCalls: number;
  uploadCalls: number;
  removeCalls: number;
};

function createJsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function createFakeSupabase(
  contentByPath: Record<string, Buffer>,
  stats: FakeStorageStats,
) {
  const client = {
    storage: {
      from(bucket: string) {
        return {
          async download(storagePath: string) {
            stats.downloadCalls += 1;
            const key = `${bucket}:${storagePath}`;
            const content = contentByPath[key];
            if (!content) {
              return {
                data: null,
                error: { message: "not_found" },
              };
            }

            return {
              data: new Blob([content], { type: "image/jpeg" }),
              error: null,
            };
          },
          async upload() {
            stats.uploadCalls += 1;
            return {
              data: null,
              error: null,
            };
          },
          async remove() {
            stats.removeCalls += 1;
            return {
              data: null,
              error: null,
            };
          },
        };
      },
    },
  };

  return client as unknown as SupabaseClient;
}

function decodeBase64Image(value: unknown) {
  return Buffer.from(String(value ?? ""), "base64");
}

function createCandidate() {
  return {
    assetId: "photo-asset-id",
    consentId: "consent-id",
    photo: {
      storageBucket: "project-assets",
      storagePath: "photo.jpg",
    },
    headshot: {
      storageBucket: "project-assets",
      storagePath: "headshot.jpg",
    },
  } satisfies AutoMatcherCandidate;
}

async function createSmallJpegBuffer() {
  return sharp({
    create: {
      width: 240,
      height: 240,
      channels: 3,
      background: { r: 120, g: 80, b: 50 },
    },
  })
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function createLargeImageBufferOver5mb() {
  const width = 2600;
  const height = 2600;
  const channels = 3;
  const raw = Buffer.alloc(width * height * channels);
  for (let index = 0; index < raw.length; index += 1) {
    raw[index] = index % 251;
  }

  const largePng = await sharp(raw, { raw: { width, height, channels } })
    .png({ compressionLevel: 0 })
    .toBuffer();

  assert.ok(largePng.length > COMPREFACE_MAX_IMAGE_BYTES);
  return largePng;
}

function withMatcherEnv() {
  process.env.COMPREFACE_BASE_URL = "http://compreface.local";
  process.env.COMPREFACE_API_KEY = "test-key";
  process.env.AUTO_MATCH_PROVIDER_TIMEOUT_MS = "3000";

  return () => {
    delete process.env.COMPREFACE_BASE_URL;
    delete process.env.COMPREFACE_API_KEY;
    delete process.env.AUTO_MATCH_PROVIDER_TIMEOUT_MS;
  };
}

test("under-limit supported images are sent without unnecessary preprocessing", async () => {
  const clearEnv = withMatcherEnv();
  const sourceImage = await createSmallJpegBuffer();
  assert.ok(sourceImage.length < COMPREFACE_MAX_IMAGE_BYTES);

  const stats: FakeStorageStats = { downloadCalls: 0, uploadCalls: 0, removeCalls: 0 };
  const supabase = createFakeSupabase(
    {
      "project-assets:headshot.jpg": sourceImage,
      "project-assets:photo.jpg": sourceImage,
    },
    stats,
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body ?? "{}")) as {
      source_image: string;
      target_image: string;
    };

    const sourcePayload = decodeBase64Image(payload.source_image);
    const targetPayload = decodeBase64Image(payload.target_image);
    assert.deepEqual(sourcePayload, sourceImage);
    assert.deepEqual(targetPayload, sourceImage);

    return createJsonResponse({
      result: [
        {
          face_matches: [{ similarity: 0.84 }],
        },
      ],
    });
  };

  try {
    const matcher = createCompreFaceAutoMatcher();
    const matches = await matcher.match({
      tenantId: "tenant-id",
      projectId: "project-id",
      jobType: "photo_uploaded",
      candidates: [createCandidate()],
      supabase,
    });

    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.confidence, 0.84);
    assert.equal(stats.downloadCalls, 2);
    assert.equal(stats.uploadCalls, 0);
    assert.equal(stats.removeCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    clearEnv();
  }
});

test("over-limit images are resized/compressed in memory before CompreFace upload", async () => {
  const clearEnv = withMatcherEnv();
  const largeImage = await createLargeImageBufferOver5mb();

  const stats: FakeStorageStats = { downloadCalls: 0, uploadCalls: 0, removeCalls: 0 };
  const supabase = createFakeSupabase(
    {
      "project-assets:headshot.jpg": largeImage,
      "project-assets:photo.jpg": largeImage,
    },
    stats,
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const payload = JSON.parse(String(init?.body ?? "{}")) as {
      source_image: string;
      target_image: string;
    };

    const sourcePayload = decodeBase64Image(payload.source_image);
    const targetPayload = decodeBase64Image(payload.target_image);

    assert.ok(sourcePayload.length <= COMPREFACE_MAX_IMAGE_BYTES);
    assert.ok(targetPayload.length <= COMPREFACE_MAX_IMAGE_BYTES);
    assert.notDeepEqual(sourcePayload, largeImage);
    assert.notDeepEqual(targetPayload, largeImage);

    const sourceMeta = await sharp(sourcePayload).metadata();
    const targetMeta = await sharp(targetPayload).metadata();
    assert.equal(sourceMeta.format, "jpeg");
    assert.equal(targetMeta.format, "jpeg");
    assert.ok(Math.max(sourceMeta.width ?? 0, sourceMeta.height ?? 0) <= 1280);
    assert.ok(Math.max(targetMeta.width ?? 0, targetMeta.height ?? 0) <= 1920);

    return createJsonResponse({
      result: [
        {
          face_matches: [{ similarity: 0.91 }],
        },
      ],
    });
  };

  try {
    const matcher = createCompreFaceAutoMatcher();
    const matches = await matcher.match({
      tenantId: "tenant-id",
      projectId: "project-id",
      jobType: "consent_headshot_ready",
      candidates: [createCandidate()],
      supabase,
    });

    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.confidence, 0.91);
    assert.equal(stats.downloadCalls, 2);
    assert.equal(stats.uploadCalls, 0);
    assert.equal(stats.removeCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    clearEnv();
  }
});

test("invalid image preprocessing failures surface as non-retryable provider errors", async () => {
  const clearEnv = withMatcherEnv();

  const stats: FakeStorageStats = { downloadCalls: 0, uploadCalls: 0, removeCalls: 0 };
  const supabase = createFakeSupabase(
    {
      "project-assets:headshot.jpg": Buffer.from("not-an-image"),
      "project-assets:photo.jpg": Buffer.from("not-an-image"),
    },
    stats,
  );

  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    return createJsonResponse({});
  };

  try {
    const matcher = createCompreFaceAutoMatcher();
    await assert.rejects(
      () =>
        matcher.match({
          tenantId: "tenant-id",
          projectId: "project-id",
          jobType: "photo_uploaded",
          candidates: [createCandidate()],
          supabase,
        }),
      (error: unknown) => {
        assert.ok(error instanceof MatcherProviderError);
        assert.equal(error.code, "compreface_image_preprocess_failed");
        assert.equal(error.retryable, false);
        return true;
      },
    );
    assert.equal(fetchCalled, false);
  } finally {
    globalThis.fetch = originalFetch;
    clearEnv();
  }
});

test("verification service not found is treated as non-retryable provider error", async () => {
  const clearEnv = withMatcherEnv();
  const sourceImage = await createSmallJpegBuffer();
  const stats: FakeStorageStats = { downloadCalls: 0, uploadCalls: 0, removeCalls: 0 };
  const supabase = createFakeSupabase(
    {
      "project-assets:headshot.jpg": sourceImage,
      "project-assets:photo.jpg": sourceImage,
    },
    stats,
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    createJsonResponse(
      {
        message: "Verification service with API Key ... not found",
        code: 10,
      },
      404,
    );

  try {
    const matcher = createCompreFaceAutoMatcher();
    await assert.rejects(
      () =>
        matcher.match({
          tenantId: "tenant-id",
          projectId: "project-id",
          jobType: "photo_uploaded",
          candidates: [createCandidate()],
          supabase,
        }),
      (error: unknown) => {
        assert.ok(error instanceof MatcherProviderError);
        assert.equal(error.code, "verification_service_not_found");
        assert.equal(error.retryable, false);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
    clearEnv();
  }
});

test("422 verify responses are treated as no-face/no-match confidence zero", async () => {
  const clearEnv = withMatcherEnv();
  const sourceImage = await createSmallJpegBuffer();
  const stats: FakeStorageStats = { downloadCalls: 0, uploadCalls: 0, removeCalls: 0 };
  const supabase = createFakeSupabase(
    {
      "project-assets:headshot.jpg": sourceImage,
      "project-assets:photo.jpg": sourceImage,
    },
    stats,
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    createJsonResponse(
      {
        message: "No face detected",
      },
      422,
    );

  try {
    const matcher = createCompreFaceAutoMatcher();
    const matches = await matcher.match({
      tenantId: "tenant-id",
      projectId: "project-id",
      jobType: "photo_uploaded",
      candidates: [createCandidate()],
      supabase,
    });

    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.confidence, 0);
  } finally {
    globalThis.fetch = originalFetch;
    clearEnv();
  }
});

test("400 no-face verify responses are treated as no-match confidence zero", async () => {
  const clearEnv = withMatcherEnv();
  const sourceImage = await createSmallJpegBuffer();
  const stats: FakeStorageStats = { downloadCalls: 0, uploadCalls: 0, removeCalls: 0 };
  const supabase = createFakeSupabase(
    {
      "project-assets:headshot.jpg": sourceImage,
      "project-assets:photo.jpg": sourceImage,
    },
    stats,
  );

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    createJsonResponse(
      {
        message: "No face is found in the given image",
      },
      400,
    );

  try {
    const matcher = createCompreFaceAutoMatcher();
    const matches = await matcher.match({
      tenantId: "tenant-id",
      projectId: "project-id",
      jobType: "photo_uploaded",
      candidates: [createCandidate()],
      supabase,
    });

    assert.equal(matches.length, 1);
    assert.equal(matches[0]?.confidence, 0);
  } finally {
    globalThis.fetch = originalFetch;
    clearEnv();
  }
});
