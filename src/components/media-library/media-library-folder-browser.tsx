"use client";

import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";

import { MediaLibraryDownloadButton } from "@/components/media-library/media-library-download-button";
import { ReleaseSafetyBadges } from "@/components/media-library/release-safety-badges";
import type {
  MediaLibraryFolderOption,
  MediaLibraryFolderPathSegment,
  MediaLibraryFolderSummary,
  MediaLibraryFolderTreeNode,
  MediaLibraryPagination,
} from "@/lib/project-releases/project-release-service";
import { deriveMediaLibraryReleaseSafety } from "@/lib/project-releases/media-library-release-safety";

type MediaLibraryViewMode = "grid" | "list";

type BrowserItem = {
  id: string;
  mediaLibraryAssetId: string | null;
  detailHref: string;
  downloadHref: string;
  previewUrl: string | null;
  originalFilename: string;
  assetType: "photo" | "video";
  assetTypeLabel: string;
  projectName: string;
  releaseVersion: number;
  linkedPeopleLabel: string;
  releaseCreatedLabel: string;
  folderName: string | null;
  requiresDownloadConfirmation: boolean;
  downloadConfirmationMessage: string;
  row: Parameters<typeof deriveMediaLibraryReleaseSafety>[0];
};

type MediaLibraryDragData =
  | { type: "asset"; mediaLibraryAssetId: string }
  | { type: "folder"; folderId: string };

type MediaLibraryDropData =
  | { type: "folder-target"; folderId: string }
  | { type: "folder-root-target" };

type MediaLibraryFolderBrowserViewProps = {
  canManageFolders: boolean;
  items: BrowserItem[];
  folders: MediaLibraryFolderTreeNode[];
  folderOptions: MediaLibraryFolderOption[];
  selectedFolderPath: MediaLibraryFolderPathSegment[];
  currentFolderId: string | null;
  currentFolderName: string | null;
  pagination: MediaLibraryPagination;
  viewMode: MediaLibraryViewMode;
  selectedAssetIds: string[];
  createName: string;
  createError: string | null;
  folderActionError: string | null;
  statusMessage: string | null;
  targetFolderId: string;
  busy: boolean;
  editingFolderId: string | null;
  editingFolderName: string;
  editingFolderError: string | null;
  movingFolderId: string | null;
  moveFolderParentId: string;
  moveFolderError: string | null;
  onCreateNameChange: (value: string) => void;
  onCreateFolder: () => void;
  onCreateKeyDown: (key: string) => void;
  onSelectFolder: (folderId: string | null) => void;
  onStartRenameFolder: (folder: MediaLibraryFolderSummary) => void;
  onRenameFolderNameChange: (value: string) => void;
  onSaveRenameFolder: (folder: MediaLibraryFolderSummary) => void;
  onCancelRenameFolder: () => void;
  onRenameKeyDown: (key: string, folder: MediaLibraryFolderSummary) => void;
  onArchiveFolder: (folder: MediaLibraryFolderTreeNode) => void;
  onStartMoveFolder: (folder: MediaLibraryFolderOption) => void;
  onMoveFolderParentChange: (folderId: string) => void;
  onSubmitMoveFolder: (folder: MediaLibraryFolderOption) => void;
  onCancelMoveFolder: () => void;
  onToggleAsset: (mediaLibraryAssetId: string) => void;
  onSelectAllPage: () => void;
  onClearSelection: () => void;
  onTargetFolderChange: (folderId: string) => void;
  onAddToFolder: () => void;
  onMoveToFolder: () => void;
  onRemoveFromFolder: () => void;
  onMoveDraggedAssetsToFolder: (mediaLibraryAssetId: string, folderId: string) => void;
  onMoveDraggedFolder: (folderId: string, parentFolderId: string | null) => void;
  onChangeView: (viewMode: MediaLibraryViewMode) => void;
  onChangePage: (page: number) => void;
  onChangeLimit: (limit: number) => void;
};

export function formatMediaLibraryListProjectName(projectName: string, releaseVersion: number) {
  return projectName.replace(new RegExp(`\\s+v${releaseVersion}$`, "i"), "");
}

async function readJsonError(response: Response) {
  const payload = (await response.json().catch(() => null)) as { message?: string } | null;
  return payload?.message ?? null;
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 20 20" fill="none">
      <path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function PencilIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 20 20" fill="none">
      <path d="m5 14.5 1-3.7 7.7-7.7a1.6 1.6 0 0 1 2.2 2.2L8.2 13l-3.2 1.5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="m12.5 4.4 3.1 3.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function ArchiveIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 20 20" fill="none">
      <path d="M4 6.5h12M5 6.5v8.2c0 .7.6 1.3 1.3 1.3h7.4c.7 0 1.3-.6 1.3-1.3V6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M6 3.8h8l1 2.7H5l1-2.7ZM8 10h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function GridIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 20 20" fill="none">
      <path d="M4 4h5v5H4V4Zm7 0h5v5h-5V4ZM4 11h5v5H4v-5Zm7 0h5v5h-5v-5Z" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function ListIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 20 20" fill="none">
      <path d="M7 5h9M7 10h9M7 15h9M4 5h.01M4 10h.01M4 15h.01" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function ImageIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 20 20" fill="none">
      <path d="M5 4.5h10A1.5 1.5 0 0 1 16.5 6v8A1.5 1.5 0 0 1 15 15.5H5A1.5 1.5 0 0 1 3.5 14V6A1.5 1.5 0 0 1 5 4.5Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="m4 13 3.1-3.1a1.1 1.1 0 0 1 1.6 0l1.1 1.1 1.8-1.8a1.1 1.1 0 0 1 1.6 0L16 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12.7 7.2h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 20 20" fill="none">
      <path d="M4.8 6h7.4A1.8 1.8 0 0 1 14 7.8v4.4a1.8 1.8 0 0 1-1.8 1.8H4.8A1.8 1.8 0 0 1 3 12.2V7.8A1.8 1.8 0 0 1 4.8 6Z" stroke="currentColor" strokeWidth="1.5" />
      <path d="m14 8.6 2.3-1.2a.5.5 0 0 1 .7.4v4.4a.5.5 0 0 1-.7.4L14 11.4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ArrowRightIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 20 20" fill="none">
      <path d="M4 10h11M11 5.5 15.5 10 11 14.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 20 20" fill="none">
      <path d="M10 3.5v8M6.7 8.3 10 11.6l3.3-3.3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4.5 13.5v1.2c0 1 .8 1.8 1.8 1.8h7.4c1 0 1.8-.8 1.8-1.8v-1.2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function AssetTypeIcon({ item }: { item: BrowserItem }) {
  return (
    <span
      role="img"
      aria-label={item.assetTypeLabel}
      title={item.assetTypeLabel}
      className="inline-flex h-7 w-7 items-center justify-center rounded border border-zinc-200 text-zinc-600"
    >
      {item.assetType === "video" ? <VideoIcon /> : <ImageIcon />}
    </span>
  );
}

function GripIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 20 20" fill="none">
      <path d="M7 5h.01M13 5h.01M7 10h.01M13 10h.01M7 15h.01M13 15h.01" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

function MoveIcon() {
  return (
    <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 20 20" fill="none">
      <path d="M10 3v14M3 10h14M6.5 6.5 3 10l3.5 3.5M13.5 6.5 17 10l-3.5 3.5M6.5 6.5 10 3l3.5 3.5M6.5 13.5 10 17l3.5-3.5" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AssetThumbnail({ item }: { item: BrowserItem }) {
  const t = useTranslations("mediaLibrary.list");

  return (
    <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100">
      {item.previewUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.previewUrl} alt={item.originalFilename} className="h-full w-full object-cover" />
      ) : (
        <span className="px-2 text-center text-xs text-zinc-500">{t("previewUnavailable")}</span>
      )}
    </div>
  );
}

function FolderActionButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-8 w-8 items-center justify-center rounded border text-xs disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? "border-zinc-600 text-white hover:bg-zinc-800"
          : "border-zinc-300 text-zinc-700 hover:bg-white"
      }`}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function DragHandle({
  id,
  data,
  label,
  disabled,
}: {
  id: string;
  data: MediaLibraryDragData;
  label: string;
  disabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id,
    data,
    disabled,
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      aria-label={label}
      title={label}
      className={`inline-flex h-8 w-8 items-center justify-center rounded border border-zinc-300 text-zinc-600 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 ${
        isDragging ? "bg-zinc-100" : "bg-white"
      }`}
      disabled={disabled}
      {...attributes}
      {...listeners}
    >
      <GripIcon />
    </button>
  );
}

function RootFolderDropTarget({
  activeDrag,
  canManageFolders,
}: {
  activeDrag: MediaLibraryDragData | null;
  canManageFolders: boolean;
}) {
  const t = useTranslations("mediaLibrary.list");
  const enabled = canManageFolders && activeDrag?.type === "folder";
  const { isOver, setNodeRef } = useDroppable({
    id: "folder-root-target",
    data: { type: "folder-root-target" } satisfies MediaLibraryDropData,
    disabled: !enabled,
  });

  if (!enabled) {
    return null;
  }

  return (
    <div
      ref={setNodeRef}
      className={`mt-2 rounded border border-dashed px-3 py-2 text-sm ${
        isOver ? "border-zinc-700 bg-zinc-100 text-zinc-900" : "border-zinc-300 text-zinc-600"
      }`}
    >
      {t("sidebar.rootDropTarget")}
    </div>
  );
}

function AssetActions({ item }: { item: BrowserItem }) {
  const t = useTranslations("mediaLibrary.list");

  return (
    <div className="mt-auto flex justify-end gap-2 self-end">
      <Link
        href={item.detailHref}
        aria-label={t("actions.openDetail")}
        title={t("actions.openDetail")}
        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50"
      >
        <ArrowRightIcon />
      </Link>
      <MediaLibraryDownloadButton
        href={item.downloadHref}
        label={t("actions.download")}
        className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-900 text-white hover:bg-zinc-800"
        requiresConfirmation={item.requiresDownloadConfirmation}
        confirmationMessage={item.downloadConfirmationMessage}
      >
        <DownloadIcon />
      </MediaLibraryDownloadButton>
    </div>
  );
}

function AssetMetadata({ item, compact = false }: { item: BrowserItem; compact?: boolean }) {
  const t = useTranslations("mediaLibrary.list");

  return (
    <dl className={`grid gap-x-4 gap-y-1 text-sm text-zinc-600 ${compact ? "" : "sm:grid-cols-2"}`}>
      {!compact ? (
        <>
          <div>
            <dt className="font-medium text-zinc-800">{t("labels.linkedPeople")}</dt>
            <dd>{item.linkedPeopleLabel}</dd>
          </div>
          <div>
            <dt className="font-medium text-zinc-800">{t("labels.releaseCreated")}</dt>
            <dd>{item.releaseCreatedLabel}</dd>
          </div>
        </>
      ) : null}
      {item.folderName ? (
        <div>
          <dt className="font-medium text-zinc-800">{t("sidebar.currentFolder")}</dt>
          <dd>{item.folderName}</dd>
        </div>
      ) : null}
    </dl>
  );
}

function AssetCheckbox({
  item,
  checked,
  disabled,
  onToggle,
}: {
  item: BrowserItem;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={onToggle}
      aria-label={item.originalFilename}
      className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-500"
    />
  );
}

function FolderMovePanel({
  folder,
  options,
  parentId,
  error,
  busy,
  onParentChange,
  onSubmit,
  onCancel,
}: {
  folder: MediaLibraryFolderOption;
  options: MediaLibraryFolderOption[];
  parentId: string;
  error: string | null;
  busy: boolean;
  onParentChange: (folderId: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("mediaLibrary.list");
  const invalidParentIds = new Set([folder.id, ...folder.descendantIds]);
  const parentOptions = options.filter((option) => !invalidParentIds.has(option.id));

  return (
    <div className="mt-2 space-y-2 rounded border border-zinc-200 bg-white p-2 text-zinc-900">
      <label className="block text-xs font-medium text-zinc-700" htmlFor={`move-folder-${folder.id}`}>
        {t("folderForm.parentFolderLabel")}
      </label>
      <select
        id={`move-folder-${folder.id}`}
        className="w-full rounded border border-zinc-300 px-2 py-1 text-sm"
        value={parentId}
        onChange={(event) => onParentChange(event.target.value)}
        disabled={busy}
      >
        <option value="">{t("folderForm.rootOption")}</option>
        {parentOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {option.pathLabel}
          </option>
        ))}
      </select>
      {error ? <p className="text-xs text-red-700">{error}</p> : null}
      <div className="flex gap-2">
        <button
          type="button"
          className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
          onClick={onSubmit}
          disabled={busy}
        >
          {t("folderForm.moveSubmit")}
        </button>
        <button
          type="button"
          className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          onClick={onCancel}
          disabled={busy}
        >
          {t("folderForm.moveCancel")}
        </button>
      </div>
    </div>
  );
}

function FolderTreeItem({
  folder,
  props,
  activeDrag,
}: {
  folder: MediaLibraryFolderTreeNode;
  props: MediaLibraryFolderBrowserViewProps;
  activeDrag: MediaLibraryDragData | null;
}) {
  const t = useTranslations("mediaLibrary.list");
  const active = props.currentFolderId === folder.id;
  const editing = props.editingFolderId === folder.id;
  const moving = props.movingFolderId === folder.id;
  const activeDraggedFolder = activeDrag?.type === "folder"
    ? props.folderOptions.find((option) => option.id === activeDrag.folderId) ?? null
    : null;
  const invalidFolderTarget = activeDrag?.type === "folder"
    && (activeDrag.folderId === folder.id || (activeDraggedFolder?.descendantIds.includes(folder.id) ?? false));
  const { isOver, setNodeRef } = useDroppable({
    id: `folder-target:${folder.id}`,
    data: { type: "folder-target", folderId: folder.id } satisfies MediaLibraryDropData,
    disabled: !props.canManageFolders || invalidFolderTarget,
  });

  return (
    <li>
      <div
        ref={setNodeRef}
        className={`rounded-lg px-2 py-2 ${
          active ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-100"
        } ${isOver ? "ring-2 ring-zinc-500" : ""} ${invalidFolderTarget ? "opacity-60" : ""}`}
        style={{ marginLeft: `${folder.depth * 14}px` }}
      >
        {editing ? (
          <div className="space-y-2">
            <input
              type="text"
              value={props.editingFolderName}
              onChange={(event) => props.onRenameFolderNameChange(event.target.value)}
              onKeyDown={(event) => props.onRenameKeyDown(event.key, folder)}
              aria-label={t("folderForm.renameNameAriaLabel")}
              className="w-full rounded-lg border border-zinc-300 px-2 py-1 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
              disabled={props.busy}
            />
            {props.editingFolderError ? (
              <p className={active ? "text-xs text-zinc-200" : "text-xs text-red-700"}>
                {props.editingFolderError}
              </p>
            ) : null}
            <div className="flex gap-2">
              <button type="button" className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50" onClick={() => props.onSaveRenameFolder(folder)} disabled={props.busy}>
                {t("folderForm.renameSubmit")}
              </button>
              <button type="button" className={active ? "rounded border border-zinc-600 px-2 py-1 text-xs text-white hover:bg-zinc-800" : "rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:bg-white"} onClick={props.onCancelRenameFolder} disabled={props.busy}>
                {t("folderForm.cancel")}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-2">
              {props.canManageFolders ? (
                <DragHandle
                  id={`folder:${folder.id}`}
                  data={{ type: "folder", folderId: folder.id }}
                  label={t("drag.folderHandle", { name: folder.name })}
                  disabled={props.busy}
                />
              ) : null}
              <button type="button" className="min-w-0 flex-1 text-left text-sm" onClick={() => props.onSelectFolder(folder.id)}>
                <span className="block truncate">{folder.name}</span>
              </button>
              <span className="text-xs">{folder.assetCount}</span>
              {props.canManageFolders ? (
                <>
                  <FolderActionButton label={t("sidebar.moveFolderAriaLabel", { name: folder.name })} active={active} disabled={props.busy} onClick={() => props.onStartMoveFolder(folder)}>
                    <MoveIcon />
                  </FolderActionButton>
                  <FolderActionButton label={t("sidebar.renameFolderAriaLabel", { name: folder.name })} active={active} disabled={props.busy} onClick={() => props.onStartRenameFolder(folder)}>
                    <PencilIcon />
                  </FolderActionButton>
                  <FolderActionButton label={t("sidebar.archiveFolderAriaLabel", { name: folder.name })} active={active} disabled={props.busy} onClick={() => props.onArchiveFolder(folder)}>
                    <ArchiveIcon />
                  </FolderActionButton>
                </>
              ) : null}
            </div>
            {moving ? (
              <FolderMovePanel
                folder={folder}
                options={props.folderOptions}
                parentId={props.moveFolderParentId}
                error={props.moveFolderError}
                busy={props.busy}
                onParentChange={props.onMoveFolderParentChange}
                onSubmit={() => props.onSubmitMoveFolder(folder)}
                onCancel={props.onCancelMoveFolder}
              />
            ) : null}
          </>
        )}
      </div>
      {folder.children.length > 0 ? (
        <ul className="mt-1 space-y-1">
          {folder.children.map((child) => (
            <FolderTreeItem key={child.id} folder={child} props={props} activeDrag={activeDrag} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function Breadcrumbs({ path, onSelectFolder }: {
  path: MediaLibraryFolderPathSegment[];
  onSelectFolder: (folderId: string | null) => void;
}) {
  const t = useTranslations("mediaLibrary.list");
  if (path.length === 0) {
    return null;
  }

  return (
    <nav className="flex flex-wrap items-center gap-1 text-sm text-zinc-600" aria-label={t("sidebar.currentPath")}>
      <button type="button" className="font-medium text-zinc-700 underline underline-offset-4" onClick={() => onSelectFolder(null)}>
        {t("breadcrumb.root")}
      </button>
      {path.map((segment, index) => {
        const isLast = index === path.length - 1;
        return (
          <span key={segment.id} className="flex items-center gap-1">
            <span>/</span>
            {isLast ? (
              <span className="text-zinc-900">{segment.name}</span>
            ) : (
              <button type="button" className="font-medium text-zinc-700 underline underline-offset-4" onClick={() => onSelectFolder(segment.id)}>
                {segment.name}
              </button>
            )}
          </span>
        );
      })}
    </nav>
  );
}

function AssetDragHandle({ item, selected }: { item: BrowserItem; selected: boolean }) {
  const t = useTranslations("mediaLibrary.list");
  if (!item.mediaLibraryAssetId) {
    return null;
  }
  return (
    <DragHandle
      id={`asset:${item.mediaLibraryAssetId}`}
      data={{ type: "asset", mediaLibraryAssetId: item.mediaLibraryAssetId }}
      label={selected ? t("drag.selectedAssetsHandle") : t("drag.assetHandle", { name: item.originalFilename })}
      disabled={false}
    />
  );
}

export function MediaLibraryFolderBrowserView(props: MediaLibraryFolderBrowserViewProps) {
  const t = useTranslations("mediaLibrary.list");
  const [activeDrag, setActiveDrag] = useState<MediaLibraryDragData | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const selectableAssetIds = props.items
    .map((item) => item.mediaLibraryAssetId)
    .filter((value): value is string => Boolean(value));
  const activeDraggedItem = activeDrag?.type === "asset"
    ? props.items.find((item) => item.mediaLibraryAssetId === activeDrag.mediaLibraryAssetId) ?? null
    : null;
  const activeDraggedFolder = activeDrag?.type === "folder"
    ? props.folderOptions.find((folder) => folder.id === activeDrag.folderId) ?? null
    : null;

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current as MediaLibraryDragData | undefined;
    setActiveDrag(data ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const activeData = event.active.data.current as MediaLibraryDragData | undefined;
    const overData = event.over?.data.current as MediaLibraryDropData | undefined;
    setActiveDrag(null);

    if (!activeData || !overData) {
      return;
    }

    if (activeData.type === "asset" && overData.type === "folder-target") {
      props.onMoveDraggedAssetsToFolder(activeData.mediaLibraryAssetId, overData.folderId);
      return;
    }

    if (activeData.type === "folder") {
      if (overData.type === "folder-root-target") {
        props.onMoveDraggedFolder(activeData.folderId, null);
      }
      if (overData.type === "folder-target") {
        const target = props.folderOptions.find((folder) => folder.id === overData.folderId) ?? null;
        const draggedFolder = props.folderOptions.find((folder) => folder.id === activeData.folderId) ?? null;
        if (
          target
          && draggedFolder
          && activeData.folderId !== target.id
          && !draggedFolder.descendantIds.includes(target.id)
        ) {
          props.onMoveDraggedFolder(activeData.folderId, target.id);
        }
      }
    }
  }

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd} onDragCancel={() => setActiveDrag(null)}>
      <div className="grid gap-6 lg:grid-cols-[19rem_minmax(0,1fr)]">
        <aside className="content-card rounded-xl p-0">
          <div className="border-b border-zinc-200 px-4 py-3">
            <h2 className="text-sm font-semibold text-zinc-900">{t("sidebar.foldersTitle")}</h2>
          </div>

          <div className="p-2">
            <button
              type="button"
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                props.currentFolderId === null ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-100"
              }`}
              onClick={() => props.onSelectFolder(null)}
            >
              <span>{t("sidebar.allAssets")}</span>
              <span className="text-xs">{props.pagination.totalCount}</span>
            </button>
            <RootFolderDropTarget activeDrag={activeDrag} canManageFolders={props.canManageFolders} />

            {props.folders.length === 0 ? (
              <p className="px-3 py-3 text-sm text-zinc-500">{t("sidebar.emptyFolders")}</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {props.folders.map((folder) => (
                  <FolderTreeItem key={folder.id} folder={folder} props={props} activeDrag={activeDrag} />
                ))}
              </ul>
            )}
          </div>

          {props.canManageFolders ? (
            <div className="border-t border-zinc-200 px-4 py-4">
              <div className="flex gap-2">
                <input
                  id="media-library-folder-name"
                  type="text"
                  value={props.createName}
                  onChange={(event) => props.onCreateNameChange(event.target.value)}
                  onKeyDown={(event) => props.onCreateKeyDown(event.key)}
                  aria-label={t("folderForm.createAriaLabel")}
                  placeholder={t("folderForm.createPlaceholder")}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"
                  disabled={props.busy}
                />
                <button type="button" aria-label={t("folderForm.createSubmitAriaLabel")} title={t("folderForm.createSubmitAriaLabel")} className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-900 text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-400" onClick={props.onCreateFolder} disabled={props.busy}>
                  <PlusIcon />
                </button>
              </div>
              {props.createError ? <p className="mt-2 text-sm text-red-700">{props.createError}</p> : null}
            </div>
          ) : null}
        </aside>

        <section className="content-card rounded-xl p-5">
          <div className="flex flex-col gap-4 border-b border-zinc-200 pb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <Breadcrumbs path={props.selectedFolderPath} onSelectFolder={props.onSelectFolder} />
                <h2 className="mt-1 text-lg font-semibold text-zinc-900">
                  {props.currentFolderName ?? t("sidebar.allAssets")}
                </h2>
                <p className="mt-1 text-sm text-zinc-600">
                  {t("pagination.pageStatus", {
                    page: props.pagination.page,
                    totalPages: props.pagination.totalPages,
                    totalCount: props.pagination.totalCount,
                  })}
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-lg border border-zinc-300 bg-white p-1">
                  <button type="button" aria-label={t("view.gridAriaLabel")} className={`inline-flex h-8 w-8 items-center justify-center rounded-md ${props.viewMode === "grid" ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-100"}`} onClick={() => props.onChangeView("grid")}>
                    <GridIcon />
                  </button>
                  <button type="button" aria-label={t("view.listAriaLabel")} className={`inline-flex h-8 w-8 items-center justify-center rounded-md ${props.viewMode === "list" ? "bg-zinc-900 text-white" : "text-zinc-700 hover:bg-zinc-100"}`} onClick={() => props.onChangeView("list")}>
                    <ListIcon />
                  </button>
                </div>

                <label className="sr-only" htmlFor="media-library-page-size">{t("pagination.pageSizeLabel")}</label>
                <select id="media-library-page-size" className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-900" value={props.pagination.limit} onChange={(event) => props.onChangeLimit(Number(event.target.value))}>
                  {[24, 48, 96].map((value) => (
                    <option key={value} value={value}>{t("pagination.pageSizeValue", { count: value })}</option>
                  ))}
                </select>

                <button type="button" className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400" onClick={() => props.onChangePage(props.pagination.page - 1)} disabled={!props.pagination.hasPreviousPage}>
                  {t("pagination.previous")}
                </button>
                <button type="button" className="rounded-lg border border-zinc-300 px-3 py-2 text-sm text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400" onClick={() => props.onChangePage(props.pagination.page + 1)} disabled={!props.pagination.hasNextPage}>
                  {t("pagination.next")}
                </button>
              </div>
            </div>

            {props.canManageFolders && selectableAssetIds.length > 0 ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <button type="button" className="rounded-lg border border-zinc-300 px-3 py-2 text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400" onClick={props.onSelectAllPage} disabled={props.busy}>
                  {t("selection.selectAllOnPage")}
                </button>
                {props.selectedAssetIds.length > 0 ? (
                  <>
                    <span className="font-medium text-zinc-900">{t("selection.count", { count: props.selectedAssetIds.length })}</span>
                    <button type="button" className="rounded-lg border border-zinc-300 px-3 py-2 text-zinc-700 hover:bg-zinc-50" onClick={props.onClearSelection} disabled={props.busy}>
                      {t("selection.clearSelection")}
                    </button>
                    <select className="rounded-lg border border-zinc-300 px-3 py-2 text-zinc-900" value={props.targetFolderId} onChange={(event) => props.onTargetFolderChange(event.target.value)} disabled={props.busy}>
                      <option value="">{t("selection.noFolder")}</option>
                      {props.folderOptions.map((folder) => (
                        <option key={folder.id} value={folder.id}>{folder.pathLabel}</option>
                      ))}
                    </select>
                    <button type="button" className="rounded-lg border border-zinc-300 px-3 py-2 text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400" onClick={props.onAddToFolder} disabled={props.busy || !props.targetFolderId}>
                      {t("selection.addToFolder")}
                    </button>
                    <button type="button" className="rounded-lg border border-zinc-300 px-3 py-2 text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400" onClick={props.onMoveToFolder} disabled={props.busy || !props.targetFolderId}>
                      {t("selection.moveToFolder")}
                    </button>
                    {props.currentFolderId ? (
                      <button type="button" className="rounded-lg border border-zinc-300 px-3 py-2 text-zinc-700 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:text-zinc-400" onClick={props.onRemoveFromFolder} disabled={props.busy}>
                        {t("selection.removeFromFolder")}
                      </button>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}

            {props.statusMessage ? <p className="text-sm text-zinc-600">{props.statusMessage}</p> : null}
            {props.folderActionError ? <p className="text-sm text-red-700">{props.folderActionError}</p> : null}
          </div>

          {props.items.length === 0 ? (
            <p className="pt-4 text-sm text-zinc-600">{t("empty")}</p>
          ) : props.viewMode === "grid" ? (
            <ul className="grid gap-4 pt-4 sm:grid-cols-2 xl:grid-cols-3">
              {props.items.map((item) => {
                const safetySummary = deriveMediaLibraryReleaseSafety(item.row);
                const canSelect = Boolean(item.mediaLibraryAssetId);
                const selected = item.mediaLibraryAssetId ? props.selectedAssetIds.includes(item.mediaLibraryAssetId) : false;
                const projectName = formatMediaLibraryListProjectName(item.projectName, item.releaseVersion);

                return (
                  <li key={item.id} className="flex h-full flex-col rounded-lg border border-zinc-200 bg-white p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {props.canManageFolders ? (
                          <AssetCheckbox item={item} checked={selected} disabled={!canSelect || props.busy} onToggle={() => item.mediaLibraryAssetId && props.onToggleAsset(item.mediaLibraryAssetId)} />
                        ) : null}
                        {props.canManageFolders && item.mediaLibraryAssetId ? <AssetDragHandle item={item} selected={selected} /> : null}
                      </div>
                      <AssetTypeIcon item={item} />
                    </div>
                    <div className="mt-3"><AssetThumbnail item={item} /></div>
                    <div className="mt-3 flex flex-1 flex-col space-y-3">
                      <div>
                        <Link href={item.detailHref} className="block truncate text-sm font-medium text-zinc-900 underline underline-offset-4">{item.originalFilename}</Link>
                        <p className="mt-1 truncate text-sm text-zinc-600">{projectName}</p>
                      </div>
                      <ReleaseSafetyBadges summary={safetySummary} />
                      <AssetMetadata item={item} compact />
                      <AssetActions item={item} />
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <ul className="space-y-3 pt-4">
              {props.items.map((item) => {
                const safetySummary = deriveMediaLibraryReleaseSafety(item.row);
                const canSelect = Boolean(item.mediaLibraryAssetId);
                const selected = item.mediaLibraryAssetId ? props.selectedAssetIds.includes(item.mediaLibraryAssetId) : false;
                const projectName = formatMediaLibraryListProjectName(item.projectName, item.releaseVersion);

                return (
                  <li key={item.id} className="rounded-lg border border-zinc-200 bg-white p-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-stretch lg:justify-between">
                      <div className="flex gap-4">
                        {props.canManageFolders ? (
                          <div className="flex flex-col gap-2 pt-1">
                            <AssetCheckbox item={item} checked={selected} disabled={!canSelect || props.busy} onToggle={() => item.mediaLibraryAssetId && props.onToggleAsset(item.mediaLibraryAssetId)} />
                            {item.mediaLibraryAssetId ? <AssetDragHandle item={item} selected={selected} /> : null}
                          </div>
                        ) : null}

                        <div className="h-24 w-24 shrink-0"><AssetThumbnail item={item} /></div>

                        <div className="space-y-2">
                          <div>
                            <Link href={item.detailHref} className="text-base font-medium text-zinc-900 underline underline-offset-4">{item.originalFilename}</Link>
                            <div className="mt-1 flex items-center gap-2 text-sm text-zinc-600">
                              <AssetTypeIcon item={item} />
                              <span>{projectName}</span>
                            </div>
                            <div className="mt-2"><ReleaseSafetyBadges summary={safetySummary} /></div>
                          </div>
                          <AssetMetadata item={item} />
                        </div>
                      </div>
                      <AssetActions item={item} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      <DragOverlay>
        {activeDrag?.type === "asset" ? (
          <div className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm">
            {props.selectedAssetIds.includes(activeDrag.mediaLibraryAssetId)
              ? t("drag.selectedAssetsOverlay", { count: props.selectedAssetIds.length })
              : t("drag.assetOverlay", { name: activeDraggedItem?.originalFilename ?? "" })}
          </div>
        ) : null}
        {activeDrag?.type === "folder" ? (
          <div className="rounded border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm">
            {t("drag.folderOverlay", { name: activeDraggedFolder?.name ?? "" })}
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export function MediaLibraryFolderBrowser({
  canManageFolders,
  items,
  folders,
  folderOptions,
  selectedFolderPath,
  currentFolderId,
  currentFolderName,
  pagination,
  viewMode,
}: {
  canManageFolders: boolean;
  items: BrowserItem[];
  folders: MediaLibraryFolderTreeNode[];
  folderOptions: MediaLibraryFolderOption[];
  selectedFolderPath: MediaLibraryFolderPathSegment[];
  currentFolderId: string | null;
  currentFolderName: string | null;
  pagination: MediaLibraryPagination;
  viewMode: MediaLibraryViewMode;
}) {
  const t = useTranslations("mediaLibrary.list");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [createName, setCreateName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [folderActionError, setFolderActionError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [targetFolderId, setTargetFolderId] = useState(currentFolderId ?? "");
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [editingFolderName, setEditingFolderName] = useState("");
  const [editingFolderError, setEditingFolderError] = useState<string | null>(null);
  const [movingFolderId, setMovingFolderId] = useState<string | null>(null);
  const [moveFolderParentId, setMoveFolderParentId] = useState("");
  const [moveFolderError, setMoveFolderError] = useState<string | null>(null);
  const pageAssetIds = useMemo(
    () => items.map((item) => item.mediaLibraryAssetId).filter((value): value is string => Boolean(value)),
    [items],
  );
  const folderOptionById = useMemo(
    () => new Map(folderOptions.map((folder) => [folder.id, folder] as const)),
    [folderOptions],
  );

  useEffect(() => {
    setSelectedAssetIds([]);
    setTargetFolderId(currentFolderId ?? "");
    setFolderActionError(null);
    setStatusMessage(null);
  }, [currentFolderId, pagination.page, pagination.limit, viewMode]);

  useEffect(() => {
    setSelectedAssetIds((current) => current.filter((id) => pageAssetIds.includes(id)));
  }, [pageAssetIds]);

  function buildListHref(input: {
    folderId?: string | null;
    page?: number;
    limit?: number;
    view?: MediaLibraryViewMode;
  }) {
    const params = new URLSearchParams();
    const folderId = input.folderId === undefined ? currentFolderId : input.folderId;
    const page = input.page ?? pagination.page;
    const limit = input.limit ?? pagination.limit;
    const view = input.view ?? viewMode;

    if (folderId) {
      params.set("folderId", folderId);
    }
    if (page > 1) {
      params.set("page", String(page));
    }
    if (limit !== 24) {
      params.set("limit", String(limit));
    }
    if (view !== "grid") {
      params.set("view", view);
    }

    const query = params.toString();
    return query ? `/media-library?${query}` : "/media-library";
  }

  function navigateToFolder(folderId: string | null) {
    router.push(buildListHref({ folderId, page: 1 }));
  }

  function toggleAsset(mediaLibraryAssetId: string) {
    setSelectedAssetIds((current) =>
      current.includes(mediaLibraryAssetId)
        ? current.filter((value) => value !== mediaLibraryAssetId)
        : [...current, mediaLibraryAssetId],
    );
  }

  function selectAllPage() {
    setSelectedAssetIds(pageAssetIds);
  }

  async function mutateFolder(url: string, init: RequestInit) {
    const response = await fetch(url, init);
    if (!response.ok) {
      throw new Error((await readJsonError(response)) ?? t("folderErrors.generic"));
    }
    return (await response.json().catch(() => null)) as unknown;
  }

  async function createFolder() {
    if (!createName.trim()) {
      setCreateError(t("folderErrors.nameRequired"));
      return;
    }

    setBusy(true);
    setCreateError(null);
    setFolderActionError(null);
    setStatusMessage(null);
    try {
      await mutateFolder("/api/media-library/folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: createName }),
      });
      setCreateName("");
      setStatusMessage(t("folderMessages.created"));
      router.refresh();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : t("folderErrors.generic"));
    } finally {
      setBusy(false);
    }
  }

  function startRenameFolder(folder: MediaLibraryFolderSummary) {
    setEditingFolderId(folder.id);
    setEditingFolderName(folder.name);
    setEditingFolderError(null);
    setFolderActionError(null);
  }

  async function saveRenameFolder(folder: MediaLibraryFolderSummary) {
    if (!editingFolderName.trim()) {
      setEditingFolderError(t("folderErrors.renameRequired"));
      return;
    }

    setBusy(true);
    setEditingFolderError(null);
    setFolderActionError(null);
    setStatusMessage(null);
    try {
      await mutateFolder(`/api/media-library/folders/${folder.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: editingFolderName }),
      });
      setEditingFolderId(null);
      setEditingFolderName("");
      setStatusMessage(t("folderMessages.renamed"));
      router.refresh();
    } catch (error) {
      setEditingFolderError(error instanceof Error ? error.message : t("folderErrors.generic"));
    } finally {
      setBusy(false);
    }
  }

  function cancelRenameFolder() {
    setEditingFolderId(null);
    setEditingFolderName("");
    setEditingFolderError(null);
  }

  function archiveFolder(folder: MediaLibraryFolderTreeNode) {
    const confirmKey = folder.descendantIds.length > 0 ? "sidebar.archiveConfirmWithChildren" : "sidebar.archiveConfirm";
    if (!window.confirm(t(confirmKey, { name: folder.name, count: folder.descendantIds.length }))) {
      return;
    }

    void (async () => {
      setBusy(true);
      setFolderActionError(null);
      setStatusMessage(null);
      try {
        await mutateFolder(`/api/media-library/folders/${folder.id}/archive`, { method: "POST" });
        setSelectedAssetIds([]);
        setStatusMessage(t("folderMessages.archived"));
        if (currentFolderId === folder.id || folder.descendantIds.includes(currentFolderId ?? "")) {
          router.push(buildListHref({ folderId: null, page: 1 }));
        } else {
          router.refresh();
        }
      } catch (error) {
        setFolderActionError(error instanceof Error ? error.message : t("folderErrors.generic"));
      } finally {
        setBusy(false);
      }
    })();
  }

  function startMoveFolder(folder: MediaLibraryFolderOption) {
    setMovingFolderId(folder.id);
    setMoveFolderParentId(folder.parentFolderId ?? "");
    setMoveFolderError(null);
    setFolderActionError(null);
  }

  async function moveFolder(folderId: string, parentFolderId: string | null, source: "dialog" | "drag") {
    const folder = folderOptionById.get(folderId) ?? null;
    if (folder && folder.parentFolderId === parentFolderId) {
      setStatusMessage(t("folderMessages.folderMoveNoop"));
      setMovingFolderId(null);
      setMoveFolderError(null);
      return;
    }

    setBusy(true);
    setFolderActionError(null);
    setMoveFolderError(null);
    setStatusMessage(null);
    try {
      const result = await mutateFolder(`/api/media-library/folders/${folderId}/move`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ parentFolderId }),
      }) as { changed?: boolean } | null;
      setMovingFolderId(null);
      setStatusMessage(result?.changed === false ? t("folderMessages.folderMoveNoop") : t("folderMessages.folderMoved"));
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : t("folderErrors.moveConflict");
      if (source === "dialog") {
        setMoveFolderError(message);
      } else {
        setFolderActionError(message);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  function runBatchAction(pathSuffix: "add-assets" | "move-assets" | "remove-assets", successKey: string) {
    if (selectedAssetIds.length === 0) {
      return;
    }

    const folderId = pathSuffix === "remove-assets" ? currentFolderId : targetFolderId;
    if (!folderId) {
      setFolderActionError(t("folderErrors.generic"));
      return;
    }

    void (async () => {
      setBusy(true);
      setFolderActionError(null);
      setStatusMessage(null);
      try {
        await mutateFolder(`/api/media-library/folders/${folderId}/${pathSuffix}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mediaLibraryAssetIds: selectedAssetIds }),
        });
        setSelectedAssetIds([]);
        setStatusMessage(t(successKey));
        router.refresh();
      } catch (error) {
        setFolderActionError(error instanceof Error ? error.message : t("folderErrors.generic"));
      } finally {
        setBusy(false);
      }
    })();
  }

  function moveDraggedAssetsToFolder(mediaLibraryAssetId: string, folderId: string) {
    const assetIds = selectedAssetIds.includes(mediaLibraryAssetId) ? selectedAssetIds : [mediaLibraryAssetId];
    if (currentFolderId === folderId) {
      setStatusMessage(t("folderMessages.assetsMoveNoop"));
      return;
    }

    void (async () => {
      setBusy(true);
      setFolderActionError(null);
      setStatusMessage(null);
      try {
        await mutateFolder(`/api/media-library/folders/${folderId}/move-assets`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mediaLibraryAssetIds: assetIds }),
        });
        setSelectedAssetIds([]);
        setStatusMessage(t("folderMessages.moved"));
        router.refresh();
      } catch (error) {
        setFolderActionError(error instanceof Error ? error.message : t("folderErrors.generic"));
        router.refresh();
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
      folderOptions={folderOptions}
      selectedFolderPath={selectedFolderPath}
      currentFolderId={currentFolderId}
      currentFolderName={currentFolderName}
      pagination={pagination}
      viewMode={viewMode}
      selectedAssetIds={selectedAssetIds}
      createName={createName}
      createError={createError}
      folderActionError={folderActionError}
      statusMessage={statusMessage}
      targetFolderId={targetFolderId}
      busy={busy}
      editingFolderId={editingFolderId}
      editingFolderName={editingFolderName}
      editingFolderError={editingFolderError}
      movingFolderId={movingFolderId}
      moveFolderParentId={moveFolderParentId}
      moveFolderError={moveFolderError}
      onCreateNameChange={(value) => {
        setCreateName(value);
        setCreateError(null);
      }}
      onCreateFolder={createFolder}
      onCreateKeyDown={(key) => {
        if (key === "Enter") {
          void createFolder();
        }
        if (key === "Escape") {
          setCreateName("");
          setCreateError(null);
        }
      }}
      onSelectFolder={navigateToFolder}
      onStartRenameFolder={startRenameFolder}
      onRenameFolderNameChange={(value) => {
        setEditingFolderName(value);
        setEditingFolderError(null);
      }}
      onSaveRenameFolder={(folder) => {
        void saveRenameFolder(folder);
      }}
      onCancelRenameFolder={cancelRenameFolder}
      onRenameKeyDown={(key, folder) => {
        if (key === "Enter") {
          void saveRenameFolder(folder);
        }
        if (key === "Escape") {
          cancelRenameFolder();
        }
      }}
      onArchiveFolder={archiveFolder}
      onStartMoveFolder={startMoveFolder}
      onMoveFolderParentChange={(value) => {
        setMoveFolderParentId(value);
        setMoveFolderError(null);
      }}
      onSubmitMoveFolder={(folder) => {
        void moveFolder(folder.id, moveFolderParentId || null, "dialog");
      }}
      onCancelMoveFolder={() => {
        setMovingFolderId(null);
        setMoveFolderError(null);
      }}
      onToggleAsset={toggleAsset}
      onSelectAllPage={selectAllPage}
      onClearSelection={() => setSelectedAssetIds([])}
      onTargetFolderChange={setTargetFolderId}
      onAddToFolder={() => runBatchAction("add-assets", "folderMessages.assigned")}
      onMoveToFolder={() => runBatchAction("move-assets", "folderMessages.moved")}
      onRemoveFromFolder={() => runBatchAction("remove-assets", "folderMessages.removed")}
      onMoveDraggedAssetsToFolder={moveDraggedAssetsToFolder}
      onMoveDraggedFolder={(folderId, parentFolderId) => {
        void moveFolder(folderId, parentFolderId, "drag");
      }}
      onChangeView={(nextView) => router.push(buildListHref({ view: nextView }))}
      onChangePage={(page) => router.push(buildListHref({ page }))}
      onChangeLimit={(limit) => router.push(buildListHref({ limit, page: 1 }))}
    />
  );
}
