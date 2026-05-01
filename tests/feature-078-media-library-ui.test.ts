import assert from "node:assert/strict";
import test from "node:test";

import enMessages from "../messages/en.json";
import { MediaLibraryFolderBrowserView } from "../src/components/media-library/media-library-folder-browser";
import { NextIntlClientProvider } from "next-intl";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

function renderWithMessages(node: React.ReactNode) {
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: "en", messages: enMessages },
      node,
    ),
  );
}

function createBrowserItem(overrides: Partial<Parameters<typeof MediaLibraryFolderBrowserView>[0]["items"][number]> = {}) {
  return {
    id: "release-asset-1",
    mediaLibraryAssetId: "media-library-asset-1",
    detailHref: "/media-library/release-asset-1?folderId=folder-1",
    downloadHref: "/api/media-library/assets/release-asset-1/download",
    previewUrl: "https://example.com/preview.jpg",
    originalFilename: "released-photo.jpg",
    assetTypeLabel: "Photo",
    projectName: "Spring campaign",
    workspaceName: "Main workspace",
    releaseVersionLabel: "Release v2",
    linkedPeopleLabel: "1 linked person",
    releaseCreatedLabel: "Apr 25, 2026, 10:00",
    folderName: "Website picks",
    requiresDownloadConfirmation: true,
    downloadConfirmationMessage: "restricted asset",
    row: {
      consent_snapshot: {
        linkedOwners: [],
        linkedPeopleCount: 0,
      },
      review_snapshot: {
        faces: [],
        hiddenFaces: [],
        blockedFaces: [],
        faceLinkSuppressions: [],
        assigneeLinkSuppressions: [],
        manualFaces: [],
      },
      scope_snapshot: {
        owners: [],
      },
    },
    ...overrides,
  };
}

test("feature 078 Media Library folder browser renders sidebar folders, current folder labels, and folder-aware detail links", () => {
  const markup = renderWithMessages(
    createElement(MediaLibraryFolderBrowserView, {
      items: [createBrowserItem()],
      folders: [
        {
          id: "folder-1",
          name: "Website picks",
          assetCount: 1,
        },
      ],
      currentFolderId: "folder-1",
      currentFolderName: "Website picks",
      canManageFolders: true,
      selectedAssetIds: [],
      createName: "",
      targetFolderId: "",
      busy: false,
      onCreateNameChange() {},
      onCreateFolder() {},
      onSelectFolder() {},
      onRenameFolder() {},
      onArchiveFolder() {},
      onToggleAsset() {},
      onClearSelection() {},
      onTargetFolderChange() {},
      onAddToFolder() {},
      onMoveToFolder() {},
      onRemoveFromFolder() {},
    }),
  );

  assert.match(markup, /Folders/);
  assert.match(markup, /All assets/);
  assert.match(markup, /Website picks/);
  assert.match(markup, /Current folder/);
  assert.match(markup, /href="\/media-library\/release-asset-1\?folderId=folder-1"/);
  assert.match(markup, /href="\/api\/media-library\/assets\/release-asset-1\/download"/);
});

test("feature 078 Media Library folder browser renders selection actions without changing Feature 077 direct download links", () => {
  const markup = renderWithMessages(
    createElement(MediaLibraryFolderBrowserView, {
      items: [createBrowserItem()],
      folders: [
        {
          id: "folder-1",
          name: "Website picks",
          assetCount: 1,
        },
        {
          id: "folder-2",
          name: "Homepage",
          assetCount: 0,
        },
      ],
      currentFolderId: "folder-1",
      currentFolderName: "Website picks",
      canManageFolders: true,
      selectedAssetIds: ["media-library-asset-1"],
      createName: "",
      targetFolderId: "folder-2",
      busy: false,
      onCreateNameChange() {},
      onCreateFolder() {},
      onSelectFolder() {},
      onRenameFolder() {},
      onArchiveFolder() {},
      onToggleAsset() {},
      onClearSelection() {},
      onTargetFolderChange() {},
      onAddToFolder() {},
      onMoveToFolder() {},
      onRemoveFromFolder() {},
    }),
  );

  assert.match(markup, /1 asset selected/);
  assert.match(markup, /Add to folder/);
  assert.match(markup, /Move to folder/);
  assert.match(markup, /Remove from folder/);
  assert.match(markup, /option value="folder-2" selected="">Homepage/);
  assert.match(markup, /href="\/api\/media-library\/assets\/release-asset-1\/download"/);
});

test("feature 085 Media Library folder browser hides folder management controls for access-only users", () => {
  const markup = renderWithMessages(
    createElement(MediaLibraryFolderBrowserView, {
      items: [createBrowserItem()],
      folders: [
        {
          id: "folder-1",
          name: "Website picks",
          assetCount: 1,
        },
      ],
      currentFolderId: "folder-1",
      currentFolderName: "Website picks",
      canManageFolders: false,
      selectedAssetIds: ["media-library-asset-1"],
      createName: "",
      targetFolderId: "",
      busy: false,
      onCreateNameChange() {},
      onCreateFolder() {},
      onSelectFolder() {},
      onRenameFolder() {},
      onArchiveFolder() {},
      onToggleAsset() {},
      onClearSelection() {},
      onTargetFolderChange() {},
      onAddToFolder() {},
      onMoveToFolder() {},
      onRemoveFromFolder() {},
    }),
  );

  assert.match(markup, /Website picks/);
  assert.match(markup, /href="\/media-library\/release-asset-1\?folderId=folder-1"/);
  assert.match(markup, /href="\/api\/media-library\/assets\/release-asset-1\/download"/);
  assert.doesNotMatch(markup, /Create folder/);
  assert.doesNotMatch(markup, /Rename/);
  assert.doesNotMatch(markup, /Archive/);
  assert.doesNotMatch(markup, /1 asset selected/);
  assert.doesNotMatch(markup, /Add to folder/);
  assert.doesNotMatch(markup, /Move to folder/);
  assert.doesNotMatch(markup, /Remove from folder/);
});
