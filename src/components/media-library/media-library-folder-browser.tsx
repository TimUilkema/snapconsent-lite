"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";

import { MediaLibraryDownloadButton } from "@/components/media-library/media-library-download-button";
import { ReleaseSafetyBadges } from "@/components/media-library/release-safety-badges";
import type {
  MediaLibraryFolderSummary,
} from "@/lib/project-releases/project-release-service";
import { deriveMediaLibraryReleaseSafety } from "@/lib/project-releases/media-library-release-safety";

type BrowserItem = {
  id: string;
  mediaLibraryAssetId: string | null;
  detailHref: string;
  downloadHref: string;
  previewUrl: string | null;
  originalFilename: string;
  assetTypeLabel: string;
  projectName: string;
  workspaceName: string;
  releaseVersionLabel: string;
  linkedPeopleLabel: string;
  releaseCreatedLabel: string;
  folderName: string | null;
  requiresDownloadConfirmation: boolean;
  downloadConfirmationMessage: string;
  row: Parameters<typeof deriveMediaLibraryReleaseSafety>[0];
};

type MediaLibraryFolderBrowserViewProps = {
  canManageFolders: boolean;
  items: BrowserItem[];
  folders: MediaLibraryFolderSummary[];
  currentFolderId: string | null;
  currentFolderName: string | null;
  selectedAssetIds: string[];
  createName: string;
  targetFolderId: string;
  busy: boolean;
  onCreateNameChange: (value: string) => void;
  onCreateFolder: () => void;
  onSelectFolder: (folderId: string | null) => void;
  onRenameFolder: (folder: MediaLibraryFolderSummary) => void;
  onArchiveFolder: (folder: MediaLibraryFolderSummary) => void;
  onToggleAsset: (mediaLibraryAssetId: string) => void;
  onClearSelection: () => void;
  onTargetFolderChange: (folderId: string) => void;
  onAddToFolder: () => void;
  onMoveToFolder: () => void;
  onRemoveFromFolder: () => void;
};

async function readJsonError(response: Response) {
  const payload = (await response.json().catch(() => null)) as { message?: string } | null;
  return payload?.message ?? null;
}

export function MediaLibraryFolderBrowserView(props: MediaLibraryFolderBrowserViewProps) {
  const t = useTranslations("mediaLibrary.list");

  return (
    <div className="grid gap-6 lg:grid-cols-[15rem_minmax(0,1fr)]">
      <aside className="content-card rounded-xl p-0">
        <div className="border-b border-zinc-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-zinc-900">{t("sidebar.foldersTitle")}</h2>
        </div>

        <div className="p-2">
          <button
            type="button"
            className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
              props.currentFolderId === null
                ? "bg-zinc-900 text-white"
                : "text-zinc-700 hover:bg-zinc-100"
            }`}
            onClick={() => props.onSelectFolder(null)}
          >
            <span>{t("sidebar.allAssets")}</span>
            <span className="text-xs">{props.items.length}</span>
          </button>

          {props.folders.length === 0 ? (
            <p className="px-3 py-3 text-sm text-zinc-500">{t("sidebar.emptyFolders")}</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {props.folders.map((folder) => (
                <li key={folder.id}>
                  <div
                    className={`flex items-center gap-2 rounded-lg px-3 py-2 ${
                      props.currentFolderId === folder.id ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-100"
                    }`}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left text-sm"
                      onClick={() => props.onSelectFolder(folder.id)}
                    >
                      <span className="block truncate">{folder.name}</span>
                    </button>
                    <span className="text-xs">{folder.assetCount}</span>
                    {props.canManageFolders ? (
                      <>
                        <button
                          type="button"
                          className={`rounded border px-2 py-1 text-xs ${
                            props.currentFolderId === folder.id
                              ? "border-zinc-600 text-white hover:bg-zinc-800"
                              : "border-zinc-300 text-zinc-700 hover:bg-white"
                          }`}
                          onClick={() => props.onRenameFolder(folder)}
                        >
                          {t("sidebar.renameFolder")}
                        </button>
                        <button
                          type="button"
                          className={`rounded border px-2 py-1 text-xs ${
                            props.currentFolderId === folder.id
                              ? "border-zinc-600 text-white hover:bg-zinc-800"
                              : "border-zinc-300 text-zinc-700 hover:bg-white"
                          }`}
                          onClick={() => props.onArchiveFolder(folder)}
                        >
                          {t("sidebar.archiveFolder")}
                        </button>
                      </>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {props.canManageFolders ? (
          <div className="border-t border-zinc-200 px-4 py-4">
            <label className="block text-sm font-medium text-zinc-800" htmlFor="media-library-folder-name">
              {t("folderForm.nameLabel")}
            </label>
            <div className="mt-2 flex gap-2">
              <input
                id="media-library-folder-name"
                type="text"
                value={props.createName}
                onChange={(event) => props.onCreateNameChange(event.target.value)}
                placeholder={t("folderForm.namePlaceholder")}
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
                disabled={props.busy}
              />
              <button
                type="button"
                className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
                onClick={props.onCreateFolder}
                disabled={props.busy}
              >
                {t("folderForm.createSubmit")}
              </button>
            </div>
          </div>
        ) : null}
      </aside>

      <section className="content-card rounded-xl p-5">
        <div className="flex flex-col gap-4 border-b border-zinc-200 pb-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-zinc-900">
                {props.currentFolderName ?? t("sidebar.allAssets")}
              </h2>
              {props.currentFolderName ? (
                <p className="mt-1 text-sm text-zinc-600">{t("sidebar.currentFolder")}</p>
              ) : null}
            </div>
            {props.canManageFolders && props.selectedAssetIds.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-zinc-900">
                  {t("selection.count", { count: props.selectedAssetIds.length })}
                </span>
                <button
                  type="button"
                  className="rounded-lg border border-zinc-300 px-3 py-2 text-zinc-700 hover:bg-zinc-50"
                  onClick={props.onClearSelection}
                  disabled={props.busy}
                >
                  {t("selection.clear")}
                </button>
                <select
                  className="rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900"
                  value={props.targetFolderId}
                  onChange={(event) => props.onTargetFolderChange(event.target.value)}
                  disabled={props.busy}
                >
                  <option value="">{t("selection.noFolder")}</option>
                  {props.folders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="rounded-lg border border-zinc-300 px-3 py-2 text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
                  onClick={props.onAddToFolder}
                  disabled={props.busy || !props.targetFolderId}
                >
                  {t("selection.addToFolder")}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-zinc-300 px-3 py-2 text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
                  onClick={props.onMoveToFolder}
                  disabled={props.busy || !props.targetFolderId}
                >
                  {t("selection.moveToFolder")}
                </button>
                {props.currentFolderId ? (
                  <button
                    type="button"
                    className="rounded-lg border border-zinc-300 px-3 py-2 text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400"
                    onClick={props.onRemoveFromFolder}
                    disabled={props.busy}
                  >
                    {t("selection.removeFromFolder")}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        {props.items.length === 0 ? (
          <p className="pt-4 text-sm text-zinc-600">{t("empty")}</p>
        ) : (
          <ul className="space-y-3 pt-4">
            {props.items.map((item) => {
              const safetySummary = deriveMediaLibraryReleaseSafety(item.row);
              const canSelect = Boolean(item.mediaLibraryAssetId);
              const selected = item.mediaLibraryAssetId
                ? props.selectedAssetIds.includes(item.mediaLibraryAssetId)
                : false;

              return (
                <li key={item.id} className="rounded-xl border border-zinc-200 bg-white p-4">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="flex gap-4">
                      {props.canManageFolders ? (
                        <div className="pt-1">
                          <input
                            type="checkbox"
                            checked={selected}
                            disabled={!canSelect || props.busy}
                            onChange={() => item.mediaLibraryAssetId && props.onToggleAsset(item.mediaLibraryAssetId)}
                            aria-label={item.originalFilename}
                            className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500"
                          />
                        </div>
                      ) : null}

                      <div className="flex h-24 w-24 items-center justify-center overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100">
                        {item.previewUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.previewUrl}
                            alt={item.originalFilename}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="px-2 text-center text-xs text-zinc-500">
                            {t("previewUnavailable")}
                          </span>
                        )}
                      </div>

                      <div className="space-y-2">
                        <div>
                          <Link
                            href={item.detailHref}
                            className="text-base font-medium text-zinc-900 underline underline-offset-4"
                          >
                            {item.originalFilename}
                          </Link>
                          <p className="mt-1 text-sm text-zinc-600">
                            {item.assetTypeLabel} / {item.projectName}
                          </p>
                          <div className="mt-2">
                            <ReleaseSafetyBadges summary={safetySummary} />
                          </div>
                        </div>

                        <dl className="grid gap-x-4 gap-y-1 text-sm text-zinc-600 sm:grid-cols-2">
                          <div>
                            <dt className="font-medium text-zinc-800">{t("labels.workspace")}</dt>
                            <dd>{item.workspaceName}</dd>
                          </div>
                          <div>
                            <dt className="font-medium text-zinc-800">{t("labels.releaseVersion")}</dt>
                            <dd>{item.releaseVersionLabel}</dd>
                          </div>
                          <div>
                            <dt className="font-medium text-zinc-800">{t("labels.linkedPeople")}</dt>
                            <dd>{item.linkedPeopleLabel}</dd>
                          </div>
                          <div>
                            <dt className="font-medium text-zinc-800">{t("labels.releaseCreated")}</dt>
                            <dd>{item.releaseCreatedLabel}</dd>
                          </div>
                          {item.folderName ? (
                            <div>
                              <dt className="font-medium text-zinc-800">{t("sidebar.currentFolder")}</dt>
                              <dd>{item.folderName}</dd>
                            </div>
                          ) : null}
                        </dl>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Link
                        href={item.detailHref}
                        className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
                      >
                        {t("actions.open")}
                      </Link>
                      <MediaLibraryDownloadButton
                        href={item.downloadHref}
                        label={t("actions.download")}
                        className="rounded-lg bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-800"
                        requiresConfirmation={item.requiresDownloadConfirmation}
                        confirmationMessage={item.downloadConfirmationMessage}
                      />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

export function MediaLibraryFolderBrowser({
  canManageFolders,
  items,
  folders,
  currentFolderId,
  currentFolderName,
}: {
  canManageFolders: boolean;
  items: BrowserItem[];
  folders: MediaLibraryFolderSummary[];
  currentFolderId: string | null;
  currentFolderName: string | null;
}) {
  const t = useTranslations("mediaLibrary.list");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [createName, setCreateName] = useState("");
  const [targetFolderId, setTargetFolderId] = useState(currentFolderId ?? "");

  function navigateToFolder(folderId: string | null) {
    router.push(folderId ? `/media-library?folderId=${folderId}` : "/media-library");
  }

  function toggleAsset(mediaLibraryAssetId: string) {
    setSelectedAssetIds((current) =>
      current.includes(mediaLibraryAssetId)
        ? current.filter((value) => value !== mediaLibraryAssetId)
        : [...current, mediaLibraryAssetId],
    );
  }

  async function mutateFolder(url: string, init: RequestInit, successMessage: string) {
    const response = await fetch(url, init);
    if (!response.ok) {
      throw new Error((await readJsonError(response)) ?? t("folderErrors.generic"));
    }

    window.alert(successMessage);
  }

  async function createFolder() {
    if (!createName.trim()) {
      window.alert(t("folderErrors.nameRequired"));
      return;
    }

    setBusy(true);
    try {
      await mutateFolder(
        "/api/media-library/folders",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({ name: createName }),
        },
        t("folderMessages.created"),
      );
      setCreateName("");
      router.refresh();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : t("folderErrors.generic"));
    } finally {
      setBusy(false);
    }
  }

  function renameFolder(folder: MediaLibraryFolderSummary) {
    const nextName = window.prompt(t("sidebar.renameFolder"), folder.name);
    if (nextName === null) {
      return;
    }

    void (async () => {
      setBusy(true);
      try {
        await mutateFolder(
          `/api/media-library/folders/${folder.id}`,
          {
            method: "PATCH",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({ name: nextName }),
          },
          t("folderMessages.renamed"),
        );
        router.refresh();
      } catch (error) {
        window.alert(error instanceof Error ? error.message : t("folderErrors.generic"));
      } finally {
        setBusy(false);
      }
    })();
  }

  function archiveFolder(folder: MediaLibraryFolderSummary) {
    if (!window.confirm(t("sidebar.archiveConfirm", { name: folder.name }))) {
      return;
    }

    void (async () => {
      setBusy(true);
      try {
        await mutateFolder(
          `/api/media-library/folders/${folder.id}/archive`,
          {
            method: "POST",
          },
          t("folderMessages.archived"),
        );
        setSelectedAssetIds([]);
        if (currentFolderId === folder.id) {
          router.push("/media-library");
        } else {
          router.refresh();
        }
      } catch (error) {
        window.alert(error instanceof Error ? error.message : t("folderErrors.generic"));
      } finally {
        setBusy(false);
      }
    })();
  }

  function runBatchAction(pathSuffix: "add-assets" | "move-assets" | "remove-assets", successKey: string) {
    if (selectedAssetIds.length === 0) {
      return;
    }

    const folderId = pathSuffix === "remove-assets" ? currentFolderId : targetFolderId;
    if (!folderId) {
      window.alert(t("folderErrors.generic"));
      return;
    }

    void (async () => {
      setBusy(true);
      try {
        await mutateFolder(
          `/api/media-library/folders/${folderId}/${pathSuffix}`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              mediaLibraryAssetIds: selectedAssetIds,
            }),
          },
          t(successKey),
        );
        setSelectedAssetIds([]);
        router.refresh();
      } catch (error) {
        window.alert(error instanceof Error ? error.message : t("folderErrors.generic"));
      } finally {
        setBusy(false);
      }
    })();
  }

  return (
    <MediaLibraryFolderBrowserView
      canManageFolders={canManageFolders}
      items={items}
      folders={folders}
      currentFolderId={currentFolderId}
      currentFolderName={currentFolderName}
      selectedAssetIds={selectedAssetIds}
      createName={createName}
      targetFolderId={targetFolderId}
      busy={busy}
      onCreateNameChange={setCreateName}
      onCreateFolder={createFolder}
      onSelectFolder={navigateToFolder}
      onRenameFolder={renameFolder}
      onArchiveFolder={archiveFolder}
      onToggleAsset={toggleAsset}
      onClearSelection={() => setSelectedAssetIds([])}
      onTargetFolderChange={setTargetFolderId}
      onAddToFolder={() => runBatchAction("add-assets", "folderMessages.assigned")}
      onMoveToFolder={() => runBatchAction("move-assets", "folderMessages.moved")}
      onRemoveFromFolder={() => runBatchAction("remove-assets", "folderMessages.removed")}
    />
  );
}
