import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../src/lib/http/errors";
import { createMediaLibraryAssetDownloadResponse } from "../src/lib/project-releases/media-library-download";

function createAuthClient(userId: string | null) {
  return {
    auth: {
      getUser: async () => ({
        data: {
          user: userId ? { id: userId } : null,
        },
      }),
    },
  };
}

function createAdminStorageClient(result: { signedUrl?: string | null; error?: { message: string } | null }) {
  return {
    storage: {
      from: (bucket: string) => ({
        createSignedUrl: async (path: string, ttlSeconds: number) => {
          assert.equal(bucket, "project-assets");
          assert.equal(path, "tenant/t1/project/p1/asset/a1/file.jpg");
          assert.equal(ttlSeconds, 120);
          return {
            data: result.signedUrl ? { signedUrl: result.signedUrl } : null,
            error: result.error ?? null,
          };
        },
      }),
    },
  };
}

test("feature 074 media download requires authentication", async () => {
  await assert.rejects(
    createMediaLibraryAssetDownloadResponse(
      {
        authSupabase: createAuthClient(null) as never,
        adminSupabase: createAdminStorageClient({ signedUrl: "https://example.com/signed" }) as never,
        releaseAssetId: "release-asset-1",
      },
      {
        resolveTenantId: async () => "tenant-1",
        getReleaseAssetDetail: async () => {
          throw new Error("should not be called");
        },
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 401);
      assert.equal(error.code, "unauthenticated");
      return true;
    },
  );
});

test("feature 074 media download surfaces reviewer-only access failures", async () => {
  await assert.rejects(
    createMediaLibraryAssetDownloadResponse(
      {
        authSupabase: createAuthClient("user-photographer") as never,
        adminSupabase: createAdminStorageClient({ signedUrl: "https://example.com/signed" }) as never,
        releaseAssetId: "release-asset-1",
      },
      {
        resolveTenantId: async () => "tenant-1",
        getReleaseAssetDetail: async () => {
          throw new HttpError(
            403,
            "media_library_forbidden",
            "Only owners, admins, and reviewers can access the Media Library.",
          );
        },
      },
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 403);
      assert.equal(error.code, "media_library_forbidden");
      return true;
    },
  );
});

test("feature 074 media download returns a signed redirect for authorized release assets", async () => {
  const response = await createMediaLibraryAssetDownloadResponse(
    {
      authSupabase: createAuthClient("user-reviewer") as never,
      adminSupabase: createAdminStorageClient({ signedUrl: "https://example.com/signed-download" }) as never,
      releaseAssetId: "release-asset-1",
    },
    {
      resolveTenantId: async () => "tenant-1",
      getReleaseAssetDetail: async () => ({
        row: {
          original_storage_bucket: "project-assets",
          original_storage_path: "tenant/t1/project/p1/asset/a1/file.jpg",
        },
      }),
    } as never,
  );

  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://example.com/signed-download");
});

test("feature 074 media download reports missing source objects explicitly", async () => {
  await assert.rejects(
    createMediaLibraryAssetDownloadResponse(
      {
        authSupabase: createAuthClient("user-reviewer") as never,
        adminSupabase: createAdminStorageClient({ error: { message: "not found" } }) as never,
        releaseAssetId: "release-asset-1",
      },
      {
        resolveTenantId: async () => "tenant-1",
        getReleaseAssetDetail: async () => ({
          row: {
            original_storage_bucket: "project-assets",
            original_storage_path: "tenant/t1/project/p1/asset/a1/file.jpg",
          },
        }),
      } as never,
    ),
    (error: unknown) => {
      assert.ok(error instanceof HttpError);
      assert.equal(error.status, 409);
      assert.equal(error.code, "release_asset_source_missing");
      return true;
    },
  );
});
