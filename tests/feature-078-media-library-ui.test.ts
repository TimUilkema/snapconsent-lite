import assert from "node:assert/strict";
import test from "node:test";

import enMessages from "../messages/en.json";
import {
  formatMediaLibraryListProjectName,
  MediaLibraryFolderBrowserView,
} from "../src/components/media-library/media-library-folder-browser";
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
    assetType: "photo" as const,
    assetTypeLabel: "Photo",
    projectName: "Spring campaign v2",
    releaseVersion: 2,
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

function createBrowserProps(
  overrides: Partial<Parameters<typeof MediaLibraryFolderBrowserView>[0]> = {},
): Parameters<typeof MediaLibraryFolderBrowserView>[0] {
  const folderOne = {
    id: "folder-1",
    name: "Website picks",
    parentFolderId: null,
    assetCount: 1,
    depth: 0,
    path: [{ id: "folder-1", name: "Website picks" }],
    pathLabel: "Website picks",
    descendantIds: [],
  };
  return {
    items: [createBrowserItem()],
    folders: [
      {
        ...folderOne,
        children: [],
      },
    ],
    folderOptions: [folderOne],
    selectedFolderPath: folderOne.path,
    currentFolderId: "folder-1",
    currentFolderName: "Website picks",
    canManageFolders: true,
    pagination: {
      page: 1,
      limit: 24,
      totalCount: 1,
      totalPages: 1,
      hasPreviousPage: false,
      hasNextPage: false,
    },
    viewMode: "list",
    selectedAssetIds: [],
    createName: "",
    createError: null,
    folderActionError: null,
    statusMessage: null,
    targetFolderId: "",
    busy: false,
    editingFolderId: null,
    editingFolderName: "",
    editingFolderError: null,
    movingFolderId: null,
    moveFolderParentId: "",
    moveFolderError: null,
    onCreateNameChange() {},
    onCreateFolder() {},
    onCreateKeyDown() {},
    onSelectFolder() {},
    onStartRenameFolder() {},
    onRenameFolderNameChange() {},
    onSaveRenameFolder() {},
    onCancelRenameFolder() {},
    onRenameKeyDown() {},
    onArchiveFolder() {},
    onStartMoveFolder() {},
    onMoveFolderParentChange() {},
    onSubmitMoveFolder() {},
    onCancelMoveFolder() {},
    onToggleAsset() {},
    onSelectAllPage() {},
    onClearSelection() {},
    onTargetFolderChange() {},
    onAddToFolder() {},
    onMoveToFolder() {},
    onRemoveFromFolder() {},
    onMoveDraggedAssetsToFolder() {},
    onMoveDraggedFolder() {},
    onChangeView() {},
    onChangePage() {},
    onChangeLimit() {},
    ...overrides,
  };
}

test("feature 078 Media Library folder browser renders sidebar folders, current folder labels, and folder-aware detail links", () => {
  const markup = renderWithMessages(
    createElement(MediaLibraryFolderBrowserView, createBrowserProps()),
  );

  assert.match(markup, /Folders/);
  assert.match(markup, /All assets/);
  assert.match(markup, /Website picks/);
  assert.match(markup, /Current folder/);
  assert.match(markup, /href="\/media-library\/release-asset-1\?folderId=folder-1"/);
  assert.match(markup, /aria-label="Open"/);
  assert.match(markup, /href="\/api\/media-library\/assets\/release-asset-1\/download"/);
  assert.match(markup, /aria-label="Download original"/);
  assert.doesNotMatch(markup, /href="\/api\/media-library\/assets\/release-asset-1\/open"/);
  assert.match(markup, /aria-label="Rename Website picks"/);
  assert.match(markup, /aria-label="Archive Website picks"/);
});

test("feature 078 Media Library asset cards use accessible type icons and clean project labels", () => {
  const listMarkup = renderWithMessages(
    createElement(MediaLibraryFolderBrowserView, createBrowserProps()),
  );
  const gridMarkup = renderWithMessages(
    createElement(MediaLibraryFolderBrowserView, createBrowserProps({
      viewMode: "grid",
      items: [
        createBrowserItem({
          id: "release-asset-video",
          mediaLibraryAssetId: "media-library-asset-video",
          originalFilename: "released-video.mp4",
          assetType: "video",
          assetTypeLabel: "Video",
          projectName: "Wintersport v2",
          releaseVersion: 2,
          previewUrl: null,
        }),
      ],
    })),
  );

  assert.equal(formatMediaLibraryListProjectName("Wintersport v2", 2), "Wintersport");
  assert.match(listMarkup, /aria-label="Photo"/);
  assert.match(listMarkup, /Spring campaign/);
  assert.doesNotMatch(listMarkup, /Spring campaign v2/);
  assert.doesNotMatch(listMarkup, />Photo</);
  assert.doesNotMatch(listMarkup, /Workspace/);
  assert.doesNotMatch(listMarkup, /Release version/);
  assert.doesNotMatch(listMarkup, /Open original/);

  assert.match(gridMarkup, /aria-label="Video"/);
  assert.match(gridMarkup, /Wintersport/);
  assert.doesNotMatch(gridMarkup, /Wintersport v2/);
  assert.doesNotMatch(gridMarkup, />Video</);
});

test("feature 078 Media Library folder browser renders selection actions without changing Feature 077 direct download links", () => {
  const markup = renderWithMessages(
    createElement(MediaLibraryFolderBrowserView, createBrowserProps({
      folders: [
        {
          id: "folder-1",
          name: "Website picks",
          parentFolderId: null,
          assetCount: 1,
          depth: 0,
          path: [{ id: "folder-1", name: "Website picks" }],
          pathLabel: "Website picks",
          descendantIds: [],
          children: [],
        },
        {
          id: "folder-2",
          name: "Homepage",
          parentFolderId: null,
          assetCount: 0,
          depth: 0,
          path: [{ id: "folder-2", name: "Homepage" }],
          pathLabel: "Homepage",
          descendantIds: [],
          children: [],
        },
      ],
      folderOptions: [
        {
          id: "folder-1",
          name: "Website picks",
          parentFolderId: null,
          assetCount: 1,
          depth: 0,
          path: [{ id: "folder-1", name: "Website picks" }],
          pathLabel: "Website picks",
          descendantIds: [],
        },
        {
          id: "folder-2",
          name: "Homepage",
          parentFolderId: null,
          assetCount: 0,
          depth: 0,
          path: [{ id: "folder-2", name: "Homepage" }],
          pathLabel: "Homepage",
          descendantIds: [],
        },
      ],
      selectedAssetIds: ["media-library-asset-1"],
      targetFolderId: "folder-2",
    })),
  );

  assert.match(markup, /1 asset selected/);
  assert.match(markup, /Select all on page/);
  assert.match(markup, /Add to folder/);
  assert.match(markup, /Move to folder/);
  assert.match(markup, /Remove from folder/);
  assert.match(markup, /option value="folder-2" selected="">Homepage/);
  assert.match(markup, /href="\/api\/media-library\/assets\/release-asset-1\/download"/);
  assert.doesNotMatch(markup, /href="\/api\/media-library\/assets\/release-asset-1\/open"/);
});

test("feature 085 Media Library folder browser hides folder management controls for access-only users", () => {
  const markup = renderWithMessages(
    createElement(MediaLibraryFolderBrowserView, createBrowserProps({
      canManageFolders: false,
      selectedAssetIds: ["media-library-asset-1"],
    })),
  );

  assert.match(markup, /Website picks/);
  assert.match(markup, /href="\/media-library\/release-asset-1\?folderId=folder-1"/);
  assert.match(markup, /href="\/api\/media-library\/assets\/release-asset-1\/download"/);
  assert.doesNotMatch(markup, /aria-label="Create folder"/);
  assert.doesNotMatch(markup, /aria-label="Rename Website picks"/);
  assert.doesNotMatch(markup, /aria-label="Archive Website picks"/);
  assert.doesNotMatch(markup, /1 asset selected/);
  assert.doesNotMatch(markup, /Add to folder/);
  assert.doesNotMatch(markup, /Move to folder/);
  assert.doesNotMatch(markup, /Remove from folder/);
});
