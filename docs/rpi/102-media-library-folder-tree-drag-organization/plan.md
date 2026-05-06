# Feature 102 Plan - Media Library Folder Tree and Drag-and-Drop Organization

## Title and feature ID

Feature 102: Media Library Folder Tree and Drag-and-Drop Organization.

This is the RPI plan phase. Do not implement application code, migrations, tests, UI behavior, or i18n changes in this phase.

## Inputs and ground truth

Required inputs read:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `docs/rpi/SUMMARY.md` because root `SUMMARY.md` is not present
5. `docs/rpi/PROMPTS.md` because root `PROMPTS.md` is not present
6. `docs/rpi/README.md`
7. `UNCODEXIFY.md`
8. `docs/rpi/102-media-library-folder-tree-drag-organization/research.md`

Targeted live verification checked:

- `supabase/migrations/20260425120000_078_media_library_folders_foundation.sql`
- `src/lib/project-releases/project-release-service.ts`
- `src/lib/media-library/media-library-folder-service.ts`
- `src/lib/media-library/media-library-folder-route-handlers.ts`
- `src/lib/tenant/media-library-custom-role-access.ts`
- `src/components/media-library/media-library-folder-browser.tsx`
- `src/app/(protected)/media-library/page.tsx`
- `src/app/(protected)/media-library/[releaseAssetId]/page.tsx`
- `messages/en.json`
- `package.json`
- current Media Library API route/test/migration names

Source of truth:

- Live code, migrations, and tests override RPI docs.
- `research.md` is the primary synthesized input for this plan.
- Prior RPI docs remain context only.

## Research summary

Feature 101 is present in the worktree and added pagination, grid/list browsing, page-local checkbox selection, compact folder controls, open/download split behavior, safer page-only thumbnail signing, inline folder rename, and batch asset add/move/remove controls.

Feature 101 did not implement Media Library drag/drop. There are no Media Library `@dnd-kit` imports, asset drag handles, folder drop targets, or folder drag handles. `@dnd-kit/core`, `@dnd-kit/sortable`, and `@dnd-kit/utilities` are installed and are currently used only in template components.

Current Media Library folders are flat. `media_library_folders` has no `parent_folder_id`; active folder names are tenant-wide unique through `media_library_folders_tenant_active_name_unique_idx`; active folders are loaded alphabetically. Folder membership targets stable `media_library_assets.id`, not release asset IDs, and `media_library_folder_memberships` keeps one folder membership per stable asset.

Current asset movement is already mostly ready for drag/drop. `POST /api/media-library/folders/[folderId]/move-assets` accepts `mediaLibraryAssetIds`, validates tenant-scoped stable assets, rejects archived target folders, inserts missing memberships, updates existing memberships, and treats repeat moves to the same folder as no-op counts.

## Chosen scope

In scope for Feature 102:

- Add persisted nested folders through `media_library_folders.parent_folder_id`.
- Replace tenant-wide active folder-name uniqueness with sibling-level active uniqueness.
- Load and render active folders as an alphabetically sorted tree.
- Hide folders whose ancestor is archived from the active tree.
- Keep folder browsing direct-folder-only.
- Keep all-assets browsing as all latest-release assets.
- Add a compact breadcrumb/path header for selected folders.
- Highlight the current folder in the tree.
- Preserve `folderId`, `page`, `limit`, and `view` in list/detail navigation where practical.
- Add a database-side atomic folder move operation.
- Add `POST /api/media-library/folders/[folderId]/move`.
- Add asset drag handles and folder drop targets for folder managers.
- Dragging a selected asset moves the page-local selected set.
- Dragging an unselected asset moves only that asset.
- Add folder drag handles, folder drop targets, and a move-to-root target/control.
- Add keyboard/touch fallback for moving folders.
- Keep existing checkbox batch asset movement as the asset fallback.
- Extend existing i18n structure with English and Dutch messages.
- Add tests for schema, SQL/RPC validation, services, routes, UI, i18n, and Feature 101 regressions.

## Explicit deferred items

Out of scope:

- Full marquee draw-over selection.
- Cross-page persistent selection.
- Batch download/export.
- DAM sync or external DAM mapping.
- Media Library asset delete/archive.
- Manual folder ordering.
- Descendant aggregate folder counts.
- Recursive "show all descendant assets" browsing.
- Restore archived folders UI.
- Per-folder permissions.
- Generic file-manager abstraction.
- Project ZIP export restoration.
- Consent, matching, review, project workflow, RBAC, reviewer access, photographer assignment, or public token behavior changes.

## Chosen architecture

Use the existing Media Library architecture and add the smallest durable hierarchy layer:

- Data model: nullable adjacency-list `parent_folder_id` on `media_library_folders`.
- Browse model: direct folder membership only.
- Tree read model: load active folder rows for the tenant, build a visible active tree server-side, and pass a tree plus path metadata into the client component.
- Asset organization: continue using `media_library_assets` and `media_library_folder_memberships`.
- Folder moves: update only `media_library_folders.parent_folder_id`; do not rewrite memberships.
- Cycle prevention: authoritative database-side move function called by service-role client after TypeScript authorization.
- UI: extend `MediaLibraryFolderBrowser` rather than introducing a broad generic file-manager abstraction.
- Drag/drop: use `@dnd-kit/core` for cross-target drag/drop; keep existing buttons and selects as accessible fallbacks.

Release snapshot tables remain immutable and view-only. Do not mutate `project_releases` or `project_release_assets` for folder organization.

## Exact schema and migration plan

Create one migration, suggested name:

`supabase/migrations/20260505120000_102_media_library_folder_tree_drag_organization.sql`

Migration steps:

1. Add `parent_folder_id uuid null` to `public.media_library_folders`.
2. Add a tenant-scoped parent FK:

   ```sql
   alter table public.media_library_folders
     add constraint media_library_folders_parent_scope_fk
     foreign key (parent_folder_id, tenant_id)
     references public.media_library_folders(id, tenant_id)
     on delete restrict;
   ```

3. Add self-parent prevention:

   ```sql
   alter table public.media_library_folders
     add constraint media_library_folders_not_self_parent_check
     check (parent_folder_id is null or parent_folder_id <> id);
   ```

4. Drop the existing tenant-wide active-name unique index:

   ```sql
   drop index if exists public.media_library_folders_tenant_active_name_unique_idx;
   ```

5. Add root sibling active-name uniqueness:

   ```sql
   create unique index media_library_folders_tenant_root_active_name_unique_idx
     on public.media_library_folders (tenant_id, lower(btrim(name)))
     where archived_at is null and parent_folder_id is null;
   ```

6. Add child sibling active-name uniqueness:

   ```sql
   create unique index media_library_folders_tenant_parent_active_name_unique_idx
     on public.media_library_folders (tenant_id, parent_folder_id, lower(btrim(name)))
     where archived_at is null and parent_folder_id is not null;
   ```

7. Add tree loading and sibling conflict indexes:

   ```sql
   create index media_library_folders_tenant_parent_active_name_idx
     on public.media_library_folders (tenant_id, parent_folder_id, lower(btrim(name)), id)
     where archived_at is null;

   create index media_library_folders_tenant_parent_idx
     on public.media_library_folders (tenant_id, parent_folder_id, id);
   ```

8. Keep the existing `media_library_folders_tenant_active_idx` unless later query plans prove it is redundant.
9. Add the folder move SQL function described below.
10. Revoke broad public access to the function and grant execute to `service_role`. The app route should call it through the service-role client only after explicit authorization.

Clean reset behavior:

- Existing local data is flat and already tenant-wide unique, so it satisfies the new sibling-level indexes.
- `supabase db reset` must apply the full migration sequence cleanly.

## Exact folder tree/read model plan

Extend `MediaLibraryFolderRow` in `project-release-service.ts` and folder service types with `parent_folder_id`.

Replace flat folder summaries with tree-aware types:

```ts
export type MediaLibraryFolderSummary = {
  id: string;
  name: string;
  parentFolderId: string | null;
  assetCount: number;
};

export type MediaLibraryFolderTreeNode = MediaLibraryFolderSummary & {
  depth: number;
  path: Array<{ id: string; name: string }>;
  children: MediaLibraryFolderTreeNode[];
};
```

`MediaLibraryPageData` should include:

- `folders`: visible tree nodes.
- `folderOptions`: flattened visible tree, pre-order, for selects and dialogs.
- `selectedFolderPath`: array of `{ id, name }`.
- `selectedFolder`: current folder summary or `null`.
- existing `items`, `selectedFolderId`, `canManageFolders`, and `pagination`.

Tree loading:

- Query active folder rows: `tenant_id = input.tenantId` and `archived_at is null`.
- Include `id`, `tenant_id`, `name`, `parent_folder_id`, and archive fields needed for validation.
- Sort siblings by normalized display name using database order plus deterministic TypeScript sorting by `name.localeCompare(..., { sensitivity: "base" })`, then `id` as tie-breaker.
- Build a map of active folder IDs.
- Attach only folders whose ancestor chain reaches root through active parents.
- If a folder has an archived or missing ancestor, omit it and its descendants from the visible active tree.

Counts:

- Keep direct asset counts only.
- Do not add descendant aggregate counts in Feature 102.
- Compute counts from current latest-release stable assets and visible active memberships, as the current flat code does.

Archived ancestor behavior:

- Active tree excludes archived folders.
- Active tree also excludes active descendants of archived folders.
- Drop target lists and parent selectors use only visible active folders.
- Direct browsing of a folder with an archived ancestor is rejected with `404 folder_not_found`.

## Exact nested browse semantics

Folder browse:

- `folderId` means direct assets assigned to that exact folder only.
- It does not include child folder assets.

All-assets browse:

- Keep showing all latest published release assets for the tenant.
- Assets whose membership points to an archived or hidden folder should appear without an active folder assignment in all-assets enrichment.

Pagination and selection:

- Keep page sizes `24`, `48`, and `96`.
- Folder changes reset page to `1`.
- Page changes, page-size changes, folder changes, and view changes clear page-local selection.
- Moving selected assets clears selection and refreshes.
- Moving assets out of the current folder may reduce the current page count; after refresh, selection remains empty and pagination clamps as it does today.

## Exact folder move RPC/database plan

Add a database-side operation:

`app.move_media_library_folder(p_tenant_id uuid, p_folder_id uuid, p_parent_folder_id uuid, p_actor_user_id uuid)`

The route will pass `p_tenant_id` and `p_actor_user_id` from server context, never from the client.

Return shape:

```sql
returns table (
  ok boolean,
  error_code text,
  folder_id uuid,
  parent_folder_id uuid,
  name text,
  updated_at timestamptz,
  updated_by uuid,
  changed boolean
)
```

Validation order:

1. Load and lock the source folder for `p_tenant_id` and `p_folder_id`.
2. If missing, return `folder_not_found`.
3. If source `archived_at is not null`, return `folder_archived`.
4. If the source has any archived ancestor, return `folder_archived`.
5. If `p_parent_folder_id = p_folder_id`, return `folder_move_into_self`.
6. If target parent is non-null, load and lock it in the same tenant.
7. If target missing, return `target_folder_not_found`.
8. If target `archived_at is not null` or has an archived ancestor, return `target_folder_archived`.
9. Use a recursive CTE over all tenant folders, not only active folders, to detect whether target is in the source subtree. If yes, return `folder_move_into_descendant`.
10. Check active sibling name conflict under the requested parent using `lower(btrim(name))`. If a different active folder already has the same normalized name under that parent, return `folder_name_conflict`.
11. If `parent_folder_id is not distinct from p_parent_folder_id`, return success with `changed = false`.
12. Update `parent_folder_id`, `updated_at = now()`, and `updated_by = p_actor_user_id`.
13. Return success with `changed = true`.

Concurrency:

- Lock source and target rows with `for update`.
- Use the sibling unique indexes as the final concurrency guard.
- If a concurrent rename/move causes unique violation, map it to `folder_name_conflict`.
- No optimistic `updated_at` precondition is required in Feature 102; folder move is idempotent for repeated moves to the same parent.

Function exposure:

- Keep the function in `app` schema.
- Use service-role client after TypeScript authorization.
- Revoke from `public`.
- Grant execute to `service_role`.
- Do not expose a client-callable authenticated RPC in this feature.

## Exact route/API plan

Add:

`src/app/api/media-library/folders/[folderId]/move/route.ts`

Route handler:

- Export `POST`.
- Reuse `createClient` and `resolveTenantId`.
- Use a new shared handler in `media-library-folder-route-handlers.ts`.
- Require authenticated user and resolved tenant.
- Parse JSON body.
- Do not accept or read `tenant_id`.

Request body:

```json
{
  "parentFolderId": "uuid-or-null"
}
```

Rules:

- `parentFolderId: null` means root.
- Missing `parentFolderId` is invalid.
- Empty string is invalid.
- Non-string, non-null values are invalid.

Response body:

```json
{
  "folder": {
    "id": "uuid",
    "name": "Folder name",
    "parentFolderId": "uuid-or-null",
    "updatedAt": "timestamp",
    "updatedBy": "uuid"
  },
  "changed": true
}
```

Error mapping:

- `401 unauthenticated`
- `403 no_tenant_membership`
- `403 media_library_forbidden`
- `400 invalid_body`
- `400 invalid_parent_folder_id`
- `404 folder_not_found`
- `404 target_folder_not_found`
- `409 folder_archived`
- `409 target_folder_archived`
- `409 folder_move_into_self`
- `409 folder_move_into_descendant`
- `409 folder_name_conflict`
- `409 folder_move_conflict`
- `500 media_library_write_failed`

Existing routes:

- Keep `POST /api/media-library/folders`.
- Keep `PATCH /api/media-library/folders/[folderId]`.
- Keep `POST /api/media-library/folders/[folderId]/archive`.
- Keep `POST /api/media-library/folders/[folderId]/add-assets`.
- Keep `POST /api/media-library/folders/[folderId]/move-assets`.
- Keep `POST /api/media-library/folders/[folderId]/remove-assets`.

## Exact service/helper plan

Update `media-library-folder-service.ts`:

- Add `parent_folder_id` to row types.
- Add `parentFolderId` to public folder record types.
- Add `createServiceRoleClient` reuse for the move operation.
- Add `moveMediaLibraryFolder(input)` calling the SQL function after `authorizeMediaLibraryFolderManagement`.
- Map RPC `error_code` values to `HttpError`.
- Map PostgreSQL unique violations from the RPC to `409 folder_name_conflict`.
- Update `loadActiveFolderById` semantics or add `loadVisibleActiveFolderById` so mutations reject folders hidden by archived ancestors where required.
- Update `createMediaLibraryFolder` to create root folders for Feature 102. Creating child folders is out of scope unless the implementation adds parent selection in the create UI as a small extension; if it does, the route must validate parent through the same visible-active logic.
- Update `renameMediaLibraryFolder` to rely on sibling unique indexes and return the same `folder_name_conflict` code.
- Update `archiveMediaLibraryFolder` to archive only the selected folder and leave descendants/memberships untouched.
- Update asset membership operations to reject targets hidden by archived ancestors, not only targets whose own `archived_at` is set.

Update `project-release-service.ts`:

- Load `parent_folder_id`.
- Build visible folder tree and flattened folder options.
- Validate requested `folderId` against visible folders only.
- Build selected folder breadcrumbs from server-derived visible tree.
- Filter folder browsing direct-only.
- Enrich asset folder metadata only from visible active folder memberships.

Update `media-library-folder-route-handlers.ts`:

- Add dependency type for `moveMediaLibraryFolder`.
- Add `FolderMoveBody`.
- Add `handleMoveMediaLibraryFolderPost`.
- Keep shared auth/tenant parsing behavior.

## Exact UI/state plan

Keep `MediaLibraryFolderBrowser` as the main client component, but it can be split into small local subcomponents inside the same file if readability requires it.

Props should change from flat folders to:

- `folderTree`
- `folderOptions`
- `selectedFolderPath`
- existing `currentFolderId`, `currentFolderName`, `items`, `pagination`, `viewMode`, `canManageFolders`

State:

- Keep `selectedAssetIds` page-local.
- Keep `targetFolderId` for batch asset movement.
- Add folder move fallback state:
  - `movingFolderId`
  - `moveFolderParentId`
  - `moveFolderError`
- Add drag/drop state as needed:
  - active drag item type
  - active selected asset count
  - pending drop target

Folder tree:

- Render all visible active folders expanded in Feature 102.
- Use indentation from `depth`.
- Highlight current folder.
- Show direct counts only.
- Keep `All assets` as the top browse control.
- Add a clear root move target/control for folder dragging. This may be a small `Root` drop target in the folder section visible during folder dragging, plus a persistent `Move to root` option in the fallback dialog.

Batch asset target selector:

- Continue using the existing select control.
- Populate it from `folderOptions`.
- Labels should be path-aware, for example `Parent / Child`.
- Keep `selection.noFolder` placeholder.

No broad visual redesign:

- Preserve Feature 101 compact controls, grid/list layout, pagination, safety badges, open/download controls, and selection behavior.
- Keep UI normal and restrained per `UNCODEXIFY.md`.

## Exact drag/drop plan

Use `@dnd-kit/core`.

Sensors:

- Pointer sensor with a small activation distance, for example 6 px, to avoid accidental drags while clicking cards, rows, links, or checkboxes.
- Optional keyboard sensor may be added for DnD library completeness, but keyboard/touch movement must not rely on DnD alone.

Drag item data:

```ts
type MediaLibraryDragData =
  | { type: "asset"; mediaLibraryAssetId: string }
  | { type: "folder"; folderId: string };

type MediaLibraryDropData =
  | { type: "folder-target"; folderId: string }
  | { type: "folder-root-target" };
```

Asset dragging:

- Show an explicit grip/drag handle on each grid card and list row for users with `canManageFolders`.
- Do not make checkbox, detail link, open/download buttons, or form controls drag handles.
- Dragging a selected asset moves `selectedAssetIds`.
- Dragging an unselected asset moves only that asset.
- Dropping asset data on a folder target calls existing `move-assets`.
- Dropping asset data on the current folder should be treated as a no-op success and should not show an error.
- Do not implement asset drop to root in Feature 102; current `Remove from folder` remains the root/unfile fallback inside a folder view.

Folder dragging:

- Show an explicit folder drag handle for folder managers.
- Folder rows are droppable folder targets when the target is not self and not a descendant.
- A root drop target accepts folder drags and calls move with `parentFolderId: null`.
- Client-side invalid target checks are for feedback only. Server validation is authoritative.
- Moving a folder should not change memberships.
- If the currently viewed folder is moved, keep the same `folderId` selected and refresh so breadcrumbs/tree update.

Drag overlay:

- Add a simple overlay label:
  - one asset filename for single asset drag;
  - selected asset count for selected-set drag;
  - folder name for folder drag.

After successful drops:

- Clear selected assets for asset moves.
- Refresh route data.
- Show localized status message.

After failed drops:

- Keep selection.
- Show localized error.
- Refresh if the error suggests stale tree state, archived target, or conflict.

## Exact keyboard/touch fallback plan

Asset fallback:

- Preserve existing checkbox selection.
- Preserve `Select all on page`, `Clear selection`, target folder select, `Add to folder`, `Move to folder`, and folder-context `Remove from folder`.
- Update target folder labels to show nested paths.

Folder fallback:

- Add a `Move folder` action in each folder row for users with `canManageFolders`.
- The action opens a compact dialog or inline panel with:
  - current folder name;
  - parent folder selector;
  - `Root` option;
  - all visible folders except the folder itself and descendants;
  - `Move` and `Cancel` buttons.
- Submitting calls `POST /api/media-library/folders/[folderId]/move`.
- Moving to the existing parent returns success with `changed: false`.
- Touch users must be able to move folders entirely through this control.

## Exact archive behavior

Choose the research preferred behavior:

- Archive only the selected folder.
- Do not cascade `archived_at` to descendants.
- Do not delete folder records.
- Do not delete or rewrite folder memberships.
- Hide descendants from the active tree because their ancestor is archived.
- Reject direct browsing and drop targeting for descendants of archived folders.
- If the currently viewed folder or one of its ancestors is archived, redirect or navigate back to all assets after the write and let direct URL access return `404`.

UI confirmation:

- If the loaded tree shows descendants, use confirmation copy that says child folders and contained assets will be hidden from the active tree, not deleted.
- If there are no descendants, use the current simpler archive confirmation.

This choice is safer than cascade because it avoids destructive subtree writes. It is more useful than preventing archive with children because the operation stays non-destructive and future restore/admin tooling can recover the subtree.

## Exact rename/name-conflict behavior

Rename:

- Keep `PATCH /api/media-library/folders/[folderId]`.
- Normalize names with the existing `trim` plus whitespace collapse behavior.
- Empty names return `400 invalid_folder_name`.
- Same normalized name on the same folder returns `changed: false`.
- Active sibling conflicts return `409 folder_name_conflict`.
- Same names under different parents are allowed.
- Rename should reject archived folders and folders hidden by archived ancestors.

Create:

- Existing create route creates root folders.
- Root active sibling conflicts return `409 folder_name_conflict`.
- Child folder creation is deferred unless implementation chooses a small "new folder under current folder" extension; if included, it must use the same parent validation and sibling uniqueness.

Move:

- Moving a folder can create a sibling conflict even when the name does not change.
- The move RPC returns `folder_name_conflict` for this case.

## Exact breadcrumb/navigation plan

List page:

- Render a compact breadcrumb/path header above the asset list when a folder is selected.
- Root label should be `All assets`.
- Ancestor breadcrumb links navigate to that folder with `page=1` and current `limit` and `view`.
- Current folder is rendered as current text.
- Tree highlight and breadcrumb should agree.

URL query behavior:

- `folderId` selects a folder.
- `page` remains pagination state.
- `limit` remains page-size state.
- `view` remains grid/list state.
- Changing `folderId` resets `page` to 1 and clears selection.
- Changing `limit` resets `page` to 1 and clears selection.
- Changing `view` preserves folder and page where practical but still clears selection, matching current behavior.

Detail page:

- Extend detail search params to accept `folderId`, `page`, `limit`, and `view`.
- List item `detailHref` should include those params.
- Detail back link should validate any `folderId` through visible-active folder lookup.
- If valid, back link returns to `/media-library` with the preserved params.
- If folder is invalid, archived, or hidden by archived ancestor, back link falls back to `/media-library`.

Moving current folder:

- Keep the same `folderId` selected.
- Refresh after move so the new path appears.

## Security and authorization considerations

Required authorization:

- Viewing folder tree and folder contents: `media_library.access`.
- Opening/downloading originals: unchanged `media_library.access`.
- Creating folders: `media_library.manage_folders`.
- Renaming folders: `media_library.manage_folders`.
- Archiving folders: `media_library.manage_folders`.
- Moving assets into folders by batch or drag/drop: `media_library.manage_folders`.
- Moving selected assets: `media_library.manage_folders`.
- Moving folders under another folder or root: `media_library.manage_folders`.

Tenant boundaries:

- Never accept `tenant_id` from the client.
- Routes derive tenant through `resolveTenantId`.
- Every query filters by server-derived tenant.
- Parent folder FK is tenant-scoped.
- Move RPC receives tenant from the server route, not from the request body.
- Service-role writes happen only after explicit TypeScript authorization.

Permission boundaries:

- Project reviewer assignments must not grant Media Library access.
- Project/workspace custom roles must not grant Media Library access.
- Existing tenant-scope custom role capabilities remain the only custom-role path for `media_library.access` and `media_library.manage_folders`.

Snapshot boundaries:

- Do not mutate `project_releases`.
- Do not mutate `project_release_assets`.
- Do not reinterpret release snapshot evidence through folder state.
- Folder organization remains a Media Library concern using stable asset identities.

## Edge cases and race conditions

Asset move retries:

- Repeating `move-assets` to the same target remains no-op success for assets already there.

Folder move retries:

- Repeating the same parent move returns `changed: false`.

Concurrent folder moves:

- SQL function locks source/target rows and uses unique indexes.
- Last writer wins except invalid cycle, archived target/source, hidden ancestor, or sibling conflict.

Concurrent rename/move:

- Unique index violations map to `folder_name_conflict`.
- UI should refresh after conflict.

Stale client tree:

- Client may think a target is valid when it was moved or archived.
- Server rejects; client shows error and refreshes.

Archived during drag:

- Asset drop onto archived/hidden target returns `folder_archived` or `target_folder_archived`.
- Folder drag with archived source/target returns corresponding conflict.

Moving into descendant:

- Client prevents obvious descendant drops based on loaded tree.
- RPC prevents all descendant moves authoritatively.

Moving selected assets from current page:

- Dragging a selected item moves only current page selected IDs.
- Cross-page selection remains out of scope.

Page changes during drag:

- Navigating folders/pages should cancel the drag by unmounting or resetting DnD state.

Current viewed folder archived:

- Archive success redirects to all assets.
- Direct URL to archived or hidden descendant returns 404.

Folder moved while viewing:

- Keep selected folder ID and refresh path.

No-op moves:

- Asset drop to current folder succeeds silently or with a subdued "already in folder" status.
- Folder move to same parent returns `changed: false`.

## i18n plan

Extend both `messages/en.json` and `messages/nl.json` under existing `mediaLibrary.list` and `mediaLibrary.detail` structures.

Suggested keys:

- `mediaLibrary.list.sidebar.rootDropTarget`
- `mediaLibrary.list.sidebar.moveFolderAriaLabel`
- `mediaLibrary.list.sidebar.archiveConfirmWithChildren`
- `mediaLibrary.list.sidebar.currentPath`
- `mediaLibrary.list.breadcrumb.root`
- `mediaLibrary.list.drag.assetHandle`
- `mediaLibrary.list.drag.selectedAssetsHandle`
- `mediaLibrary.list.drag.folderHandle`
- `mediaLibrary.list.drag.assetOverlay`
- `mediaLibrary.list.drag.selectedAssetsOverlay`
- `mediaLibrary.list.drag.folderOverlay`
- `mediaLibrary.list.drop.moveAssetsToFolder`
- `mediaLibrary.list.drop.moveFolderToFolder`
- `mediaLibrary.list.drop.moveFolderToRoot`
- `mediaLibrary.list.drop.invalidTarget`
- `mediaLibrary.list.folderForm.moveFolder`
- `mediaLibrary.list.folderForm.parentFolderLabel`
- `mediaLibrary.list.folderForm.rootOption`
- `mediaLibrary.list.folderForm.moveSubmit`
- `mediaLibrary.list.folderForm.moveCancel`
- `mediaLibrary.list.folderMessages.folderMoved`
- `mediaLibrary.list.folderMessages.folderMoveNoop`
- `mediaLibrary.list.folderErrors.targetFolderArchived`
- `mediaLibrary.list.folderErrors.moveIntoSelf`
- `mediaLibrary.list.folderErrors.moveIntoDescendant`
- `mediaLibrary.list.folderErrors.moveConflict`
- `mediaLibrary.list.folderErrors.targetNotFound`
- `mediaLibrary.detail.backToFolder`

Implementation must avoid introducing encoding artifacts. Use clean UTF-8 and keep English and Dutch key parity.

## Test plan

Migration and SQL tests:

- `parent_folder_id` column exists.
- Tenant-scoped parent FK rejects cross-tenant parent.
- Self-parent check rejects `parent_folder_id = id`.
- Root active sibling names are unique case-insensitively after trim.
- Child active sibling names are unique case-insensitively after trim.
- Same names are allowed under different parents.
- Existing flat folders apply cleanly from `supabase db reset`.
- Move RPC succeeds for move under parent.
- Move RPC succeeds for move to root.
- Move RPC returns `changed: false` for idempotent repeat.
- Move RPC rejects self, descendant, archived source, archived target, hidden ancestor target, missing target, cross-tenant target, and sibling conflicts.

Service tests:

- `getMediaLibraryPageData` returns nested visible tree sorted alphabetically.
- Selected folder path is derived correctly.
- Folders with archived ancestors are hidden.
- Direct browsing into hidden descendants returns `folder_not_found`.
- Nested folder browsing returns direct assets only.
- Folder counts are direct-only.
- Asset moves into nested folders continue using stable `media_library_assets`.
- Folder moves do not mutate memberships or release tables.
- Rename conflict is sibling-level.
- Archive hides descendants without cascading archive fields.

Route tests:

- `POST /api/media-library/folders/[folderId]/move` returns expected auth errors.
- Invalid body and invalid parent values return `400`.
- Missing source/target return `404`.
- Archived source/target return `409`.
- Self/descendant moves return `409`.
- Name conflict returns `409`.
- Idempotent move returns `200` with `changed: false`.
- Service-role path is used only after authorization.

UI tests:

- Tree indentation renders nested folders.
- Current folder is highlighted.
- Breadcrumb/path header renders and links to ancestors.
- Folder selector uses path-aware labels.
- Asset drag handles render only for folder managers.
- Folder drag handles render only for folder managers.
- Access-only users do not see drag/move/manage controls.
- Dragging selected asset calls move-assets with selected IDs.
- Dragging unselected asset calls move-assets with only that ID.
- Folder drag to folder calls move route with target parent ID.
- Folder drag to root calls move route with `parentFolderId: null`.
- Invalid folder drop targets are disabled or ignored.
- Folder move fallback dialog/select renders valid parent options and root.
- Existing Feature 101 pagination, grid/list, open/download, and selection controls still render.

i18n tests:

- English and Dutch message trees have matching new keys.

Validation commands during implementation:

- `supabase db reset`
- targeted new 102 tests
- existing Feature 074, 077, 078, 085, and 101 tests
- `npm test`
- `npm run lint`

## Implementation phases

1. Schema and RPC foundation
   - Add `parent_folder_id`, constraints, indexes, sibling uniqueness, and move RPC.
   - Add migration/RPC tests first.

2. Service and read model
   - Add tree types, visible tree builder, folder path derivation, hidden ancestor handling, direct-only nested browsing, and sibling rename semantics.
   - Add service tests.

3. Route layer
   - Add folder move route and shared route handler.
   - Update route tests for auth, body parsing, error mapping, and idempotency.

4. Navigation and non-DnD UI
   - Render nested tree, direct counts, breadcrumbs, path-aware folder selectors, and folder move fallback.
   - Preserve existing Feature 101 controls.

5. Asset drag/drop
   - Add DnD context, asset handles, folder drop targets, selected-set behavior, status/error handling, and refresh behavior.

6. Folder drag/drop
   - Add folder handles, valid target logic, root drop target, drag overlay, and move route integration.

7. i18n and regression pass
   - Add English/Dutch messages.
   - Add UI/i18n tests.
   - Run targeted and full validation.

## Scope boundaries

Feature 102 is one larger but bounded implementation cycle if it stays within the architecture above. The implementation should not use this work to optimize the whole Media Library query pipeline, redesign the detail page, add cross-page selection, or add generic file-manager infrastructure.

Any implementation deviation should be documented in the final implementation report and kept smaller than the planned feature boundary.

## Concise implementation prompt

Implement Feature 102 by following `docs/rpi/102-media-library-folder-tree-drag-organization/plan.md` as the implementation contract.

Before coding, read:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/102-media-library-folder-tree-drag-organization/plan.md`

Keep deviations minimal. Do not mutate `project_releases` or `project_release_assets` for folder organization. Keep nested folder browsing direct-folder-only. Use server-derived tenant context only. Require `media_library.access` for browsing/open/download and `media_library.manage_folders` for folder and membership mutations.

Implement in phases:

1. Schema, sibling uniqueness, and SQL folder move RPC with tests.
2. Service/read model updates for visible folder tree, breadcrumbs, hidden archived ancestors, and direct-only nested browsing.
3. Folder move route and route tests.
4. Nested tree, breadcrumbs, path-aware selectors, and folder move fallback UI.
5. Asset drag-to-folder and selected-asset drag behavior using existing `move-assets`.
6. Folder drag-to-folder and move-to-root behavior using the new move route.
7. English/Dutch i18n, UI tests, and regression validation.

After each phase, run the relevant tests and fix failures before continuing. At the end, report what changed, any deviations from the plan, and the validation commands with results.
