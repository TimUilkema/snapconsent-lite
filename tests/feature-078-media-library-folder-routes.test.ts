import assert from "node:assert/strict";
import test from "node:test";

import { handleAddMediaLibraryAssetsToFolderPost, handleArchiveMediaLibraryFolderPost, handleCreateMediaLibraryFolderPost, handleRenameMediaLibraryFolderPatch } from "../src/lib/media-library/media-library-folder-route-handlers";

function createAuthenticatedClient(userId = "user-1") {
  return {
    auth: {
      getUser: async () => ({
        data: {
          user: {
            id: userId,
          },
        },
      }),
    },
  };
}

function createUnauthenticatedClient() {
  return {
    auth: {
      getUser: async () => ({
        data: {
          user: null,
        },
      }),
    },
  };
}

test("feature 078 create folder route rejects unauthenticated requests", async () => {
  const response = await handleCreateMediaLibraryFolderPost(
    new Request("http://localhost/api/media-library/folders", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "Website" }),
    }),
    {
      createClient: async () => createUnauthenticatedClient() as never,
      resolveTenantId: async () => "tenant-1",
      createMediaLibraryFolder: async () => {
        throw new Error("should not be called");
      },
    },
  );

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), {
    error: "unauthenticated",
    message: "Authentication required.",
  });
});

test("feature 078 rename folder route resolves tenant and returns service payloads", async () => {
  const response = await handleRenameMediaLibraryFolderPatch(
    new Request("http://localhost/api/media-library/folders/folder-1", {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "Homepage" }),
    }),
    {
      params: Promise.resolve({
        folderId: "folder-1",
      }),
    },
    {
      createClient: async () => createAuthenticatedClient("user-reviewer") as never,
      resolveTenantId: async () => "tenant-1",
      renameMediaLibraryFolder: async (input) => {
        assert.equal(input.tenantId, "tenant-1");
        assert.equal(input.userId, "user-reviewer");
        assert.equal(input.folderId, "folder-1");
        assert.equal(input.name, "Homepage");

        return {
          changed: true,
          folder: {
            id: "folder-1",
            name: "Homepage",
            createdAt: new Date().toISOString(),
            createdBy: "user-reviewer",
            updatedAt: new Date().toISOString(),
            updatedBy: "user-reviewer",
            archivedAt: null,
            archivedBy: null,
          },
        };
      },
    },
  );

  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.changed, true);
  assert.equal(payload.folder.name, "Homepage");
});

test("feature 078 archive folder route serializes folder conflicts", async () => {
  const response = await handleArchiveMediaLibraryFolderPost(
    new Request("http://localhost/api/media-library/folders/folder-1/archive", {
      method: "POST",
    }),
    {
      params: Promise.resolve({
        folderId: "folder-1",
      }),
    },
    {
      createClient: async () => createAuthenticatedClient("user-reviewer") as never,
      resolveTenantId: async () => "tenant-1",
      archiveMediaLibraryFolder: async () => {
        throw new Error("boom");
      },
    },
  );

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), {
    error: "internal_error",
    message: "An unexpected error occurred.",
  });
});

test("feature 078 add-assets route validates mediaLibraryAssetIds and forwards the batch payload", async () => {
  const invalidResponse = await handleAddMediaLibraryAssetsToFolderPost(
    new Request("http://localhost/api/media-library/folders/folder-1/add-assets", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ mediaLibraryAssetIds: "asset-1" }),
    }),
    {
      params: Promise.resolve({
        folderId: "folder-1",
      }),
    },
    {
      createClient: async () => createAuthenticatedClient("user-reviewer") as never,
      resolveTenantId: async () => "tenant-1",
      mutateFolderAssets: async () => {
        throw new Error("should not be called");
      },
    },
  );

  assert.equal(invalidResponse.status, 400);
  assert.deepEqual(await invalidResponse.json(), {
    error: "invalid_media_library_asset_ids",
    message: "Select at least one Media Library asset.",
  });

  const successResponse = await handleAddMediaLibraryAssetsToFolderPost(
    new Request("http://localhost/api/media-library/folders/folder-1/add-assets", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ mediaLibraryAssetIds: ["asset-1", "asset-2"] }),
    }),
    {
      params: Promise.resolve({
        folderId: "folder-1",
      }),
    },
    {
      createClient: async () => createAuthenticatedClient("user-reviewer") as never,
      resolveTenantId: async () => "tenant-1",
      mutateFolderAssets: async (input) => {
        assert.equal(input.tenantId, "tenant-1");
        assert.equal(input.userId, "user-reviewer");
        assert.equal(input.folderId, "folder-1");
        assert.deepEqual(input.mediaLibraryAssetIds, ["asset-1", "asset-2"]);

        return {
          folderId: "folder-1",
          requestedCount: 2,
          changedCount: 1,
          noopCount: 1,
        };
      },
    },
  );

  assert.equal(successResponse.status, 200);
  assert.deepEqual(await successResponse.json(), {
    folderId: "folder-1",
    requestedCount: 2,
    changedCount: 1,
    noopCount: 1,
  });
});
