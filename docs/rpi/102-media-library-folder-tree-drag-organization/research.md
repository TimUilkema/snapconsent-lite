# Feature 102 Research - Media Library Folder Tree and Drag-and-Drop Organization

## Status

Research only. No application code, migrations, tests, UI behavior, or i18n messages were changed.

## Inputs reviewed

Required project inputs reviewed in order:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `docs/rpi/SUMMARY.md` because root `SUMMARY.md` is not present
5. `docs/rpi/PROMPTS.md` because root `PROMPTS.md` is not present
6. `docs/rpi/README.md`
7. `UNCODEXIFY.md`

Relevant prior RPI docs reviewed:

- `docs/rpi/074-project-release-package-and-media-library-placeholder/research.md`
- `docs/rpi/074-project-release-package-and-media-library-placeholder/plan.md`
- `docs/rpi/077-media-library-asset-safety-and-release-detail-review-context/research.md`
- `docs/rpi/077-media-library-asset-safety-and-release-detail-review-context/plan.md`
- `docs/rpi/078-organization-scoped-media-library-folders-and-organization-foundation/research.md`
- `docs/rpi/078-organization-scoped-media-library-folders-and-organization-foundation/plan.md`
- `docs/rpi/085-custom-role-media-library-enforcement/research.md`
- `docs/rpi/085-custom-role-media-library-enforcement/plan.md`
- `docs/rpi/097-project-zip-export-cleanup/research.md`
- `docs/rpi/097-project-zip-export-cleanup/plan.md`
- `docs/rpi/101-media-library-browse-ux-refresh/research.md`
- `docs/rpi/101-media-library-browse-ux-refresh/plan.md`

Requested prior doc drift:

- The requested `docs/rpi/100-media-library-ui-ux-refresh/research.md` path does not exist in this checkout.
- The same research content exists as `docs/rpi/101-media-library-browse-ux-refresh/research.md`; it still has the title "Feature 100 Research - Media Library UI/UX Refresh".
- `docs/rpi/101-media-library-browse-ux-refresh/plan.md` explains that Feature 100 numbering was occupied by account and organization onboarding work.

Live implementation inspected as source of truth:

- Pages:
  - `src/app/(protected)/media-library/page.tsx`
  - `src/app/(protected)/media-library/[releaseAssetId]/page.tsx`
- Components:
  - `src/components/media-library/media-library-folder-browser.tsx`
  - `src/components/media-library/media-library-download-button.tsx`
  - `src/components/media-library/release-safety-badges.tsx`
  - `src/components/media-library/release-safety-banner.tsx`
  - `src/components/media-library/release-usage-permissions.tsx`
  - `src/components/media-library/released-photo-preview.tsx`
  - `src/components/media-library/released-photo-review-surface.tsx`
- Routes:
  - `src/app/api/media-library/assets/[releaseAssetId]/download/route.ts`
  - `src/app/api/media-library/assets/[releaseAssetId]/open/route.ts`
  - `src/app/api/media-library/folders/route.ts`
  - `src/app/api/media-library/folders/[folderId]/route.ts`
  - `src/app/api/media-library/folders/[folderId]/archive/route.ts`
  - `src/app/api/media-library/folders/[folderId]/add-assets/route.ts`
  - `src/app/api/media-library/folders/[folderId]/move-assets/route.ts`
  - `src/app/api/media-library/folders/[folderId]/remove-assets/route.ts`
- Services and helpers:
  - `src/lib/project-releases/project-release-service.ts`
  - `src/lib/project-releases/media-library-download.ts`
  - `src/lib/project-releases/media-library-release-safety.ts`
  - `src/lib/project-releases/media-library-release-overlays.ts`
  - `src/lib/media-library/media-library-folder-service.ts`
  - `src/lib/media-library/media-library-folder-route-handlers.ts`
  - `src/lib/tenant/media-library-custom-role-access.ts`
  - `src/lib/assets/sign-asset-thumbnails.ts`
  - `src/lib/assets/sign-asset-playback.ts`
- Migrations:
  - `supabase/migrations/20260424130000_074_project_releases_media_library_foundation.sql`
  - `supabase/migrations/20260425120000_078_media_library_folders_foundation.sql`
  - `supabase/migrations/20260430150000_085_media_library_custom_role_enforcement.sql`
- Tests:
  - `tests/feature-074-media-library-download.test.ts`
  - `tests/feature-074-project-release-media-library.test.ts`
  - `tests/feature-077-media-library-release-helpers.test.ts`
  - `tests/feature-077-media-library-ui.test.ts`
  - `tests/feature-078-media-library-folders.test.ts`
  - `tests/feature-078-media-library-folder-routes.test.ts`
  - `tests/feature-078-media-library-ui.test.ts`
  - `tests/feature-085-custom-role-media-library-enforcement.test.ts`
  - `tests/feature-101-media-library-browse-ux.test.ts`
- i18n:
  - `messages/en.json`
  - `messages/nl.json`
- Dependency and DnD usage:
  - `package.json`
  - current `@dnd-kit` imports under `src/components/templates/`

Source-of-truth rule used:

- Live code, migrations, and tests are authoritative.
- Prior RPI docs explain intent and history but are not treated as proof of current behavior.

## Verified Feature 101 implementation status

Feature 101 is partially implemented in the current worktree and appears as uncommitted live code. Treat it as source of truth for this research because it is present in the workspace.

Implemented and live:

- Media Library page accepts URL query state for `folderId`, `page`, `limit`, and `view`.
- `view` supports `grid` and `list`, defaulting to grid.
- `normalizeMediaLibraryPaginationInput` accepts page sizes `24`, `48`, and `96`, defaults to `24`, and clamps invalid page values to `1`.
- `getMediaLibraryPageData` returns pagination metadata.
- The server page signs preview URLs only for `pageData.items`, not every enriched item.
- Photo list/grid thumbnails now use `fallback: "transform"` instead of original fallback.
- Video thumbnails still use `fallback: "none"`.
- The list UI has grid cards and list rows.
- Folder creation is compact: one input plus a plus icon button.
- Folder rename is inline, not `window.prompt`.
- Folder archive still uses `window.confirm`.
- Folder rename/archive use icon buttons with accessible labels.
- Download and open original are split:
  - `GET /api/media-library/assets/[releaseAssetId]/download`
  - `GET /api/media-library/assets/[releaseAssetId]/open`
  - download signs storage URLs with the Supabase `download` option.
  - open signs storage URLs without the download option.
- Selection remains checkbox based, page local, and available only when `canManageFolders` is true.
- UI includes selected count, `Select all on page`, `Clear selection`, target folder select, `Add to folder`, `Move to folder`, and folder-context `Remove from folder`.

Implemented with limitations:

- Pagination avoids preview-signing all assets, but `getMediaLibraryPageData` still calls `listMediaLibraryAssets`, which loads all latest-release assets, enriches all stable identities and memberships, filters all folder items in memory, and only then slices the requested page. This is a scale limitation for large tenants but is not a blocker for Feature 102's folder hierarchy research.
- Detail back-link context preserves `folderId` only. It does not preserve `page`, `limit`, or `view`.
- Feature 101 tests are narrow. `tests/feature-101-media-library-browse-ux.test.ts` currently covers pagination input normalization only, not full page data, grid/list rendering, open route rendering, or selection behavior.

Not implemented:

- Flat asset drag-to-folder was skipped. There is no `@dnd-kit` import in `src/components/media-library/media-library-folder-browser.tsx`.
- There are no Media Library draggable asset cards or rows.
- There are no Media Library folder droppable targets.
- There is no drag handle for Media Library assets.
- There is no folder drag/drop.
- There is no nested folder schema or UI.
- There is no marquee draw-over selection.

Current user gesture for moving assets:

- Users select asset checkboxes on the current page.
- Users choose a folder from a select control.
- Users click `Move to folder`.
- Inside a selected folder, users can click `Remove from folder`.

Code paths already ready for flat asset drag-to-folder:

- Every rendered list/grid item receives a stable `mediaLibraryAssetId`.
- Existing `POST /api/media-library/folders/[folderId]/move-assets` accepts `mediaLibraryAssetIds`.
- `moveMediaLibraryAssetsToFolder` is usable for one asset or selected sets and is retry-safe for repeated moves to the same target folder.
- Folder rows already exist in the sidebar and can become DnD drop targets in a future UI pass.

## Verified current Media Library folder and asset behavior

Media Library is a released-snapshot consumption surface:

- List reads latest published `project_releases` per project and their `project_release_assets`.
- Detail reads by immutable `project_release_assets.id`.
- Historical release asset details remain available by direct ID when the parent release is published.
- Release snapshots are not mutated by browsing, folder actions, open, or download.
- Project ZIP export has been removed and should not be restored.

Stable library identities:

- `media_library_assets` stores one stable identity per `(tenant_id, project_id, source_asset_id)`.
- `ensureProjectReleaseSnapshot` upserts stable identities when a release is published.
- Folder membership targets stable `media_library_assets.id`, not `project_release_assets.id`.
- This lets folder organization carry forward from release v1 to v2 when the same source asset remains in the latest release.

Folders:

- `media_library_folders` are tenant-scoped, flat, active-or-archived folders.
- Active folders are returned alphabetically by `name`.
- There is no `parent_folder_id`, path, depth, closure table, sort position, or tree metadata.
- Active folder names are unique per tenant by a partial unique index on `(tenant_id, lower(btrim(name))) where archived_at is null`.
- Archived folder names can be reused.

Membership:

- `media_library_folder_memberships` points a stable Media Library asset to one folder.
- Unique `(tenant_id, media_library_asset_id)` enforces one active membership row per stable asset.
- Assets outside folders have no membership row.
- Archiving a folder does not delete memberships.
- Page data ignores archived folders. Memberships under archived folders become dormant and the asset appears unfiled in the all-assets view.

Browsing:

- Opening a flat folder shows direct assets assigned to that folder only.
- All-assets view shows all latest-release assets.
- Folder counts count current latest-release assets directly assigned to active folders.
- There is no descendant concept today.

## Current schema involved

### `project_releases`

Current columns from migration `20260424130000_074_project_releases_media_library_foundation.sql`:

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null`
- `project_id uuid not null`
- `release_version integer not null`
- `status text not null default 'building'`
- `created_by uuid not null`
- `created_at timestamptz not null default now()`
- `source_project_finalized_at timestamptz not null`
- `source_project_finalized_by uuid not null`
- `snapshot_created_at timestamptz null`
- `project_snapshot jsonb not null`

Relevant constraints and indexes:

- FK `(project_id, tenant_id)` to `projects`.
- Unique `(id, tenant_id, project_id)`.
- Unique `(tenant_id, project_id, release_version)`.
- Unique `(tenant_id, project_id, source_project_finalized_at)`.
- Status check: `building` or `published`.
- Snapshot shape checks.
- RLS select through `app.current_user_can_access_media_library(tenant_id)`.
- Authenticated clients do not have write policies.

Feature 102 must not mutate this table.

### `project_release_assets`

Current columns:

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null`
- `release_id uuid not null`
- `project_id uuid not null`
- `workspace_id uuid not null`
- `source_asset_id uuid not null`
- `asset_type text not null`
- `original_filename text not null`
- `original_storage_bucket text not null`
- `original_storage_path text not null`
- `content_type text null`
- `file_size_bytes bigint not null`
- `uploaded_at timestamptz null`
- `created_at timestamptz not null default now()`
- `asset_metadata_snapshot jsonb not null`
- `workspace_snapshot jsonb not null`
- `consent_snapshot jsonb not null`
- `link_snapshot jsonb not null`
- `review_snapshot jsonb not null`
- `scope_snapshot jsonb not null`

Relevant constraints and indexes:

- Tenant-scoped FKs to release, project, workspace, and source asset.
- Unique `(release_id, source_asset_id)`.
- `asset_type in ('photo', 'video')`.
- File size and JSON shape checks.
- Indexes by tenant/release, tenant/project/workspace, tenant/asset type, and tenant/source asset.
- RLS select through `app.current_user_can_access_media_library(tenant_id)`.
- Authenticated clients do not have write policies.

Feature 102 must not mutate this table.

### `media_library_assets`

Current columns:

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null`
- `project_id uuid not null`
- `source_asset_id uuid not null`
- `created_at timestamptz not null default now()`
- `created_by uuid not null`

Relevant constraints and indexes:

- FK `(project_id, tenant_id)` to `projects`.
- FK `(source_asset_id, tenant_id, project_id)` to `assets`.
- Unique `(id, tenant_id)`.
- Unique `(tenant_id, project_id, source_asset_id)`.
- Index `(tenant_id, project_id, created_at desc)`.
- Index `(tenant_id, source_asset_id)`.
- RLS select through Media Library access.
- Service-role insert/update only in normal app behavior.

Feature 102 should continue to target this stable identity for asset moves.

### `media_library_folders`

Current columns:

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null`
- `name text not null`
- `created_at timestamptz not null default now()`
- `created_by uuid not null`
- `updated_at timestamptz not null default now()`
- `updated_by uuid not null`
- `archived_at timestamptz null`
- `archived_by uuid null`

Relevant constraints and indexes:

- Unique `(id, tenant_id)`.
- Check `btrim(name) <> ''`.
- Archive shape check: both archive fields null or both non-null.
- Partial active-name unique index on `(tenant_id, lower(btrim(name))) where archived_at is null`.
- Active folder index `(tenant_id, updated_at desc) where archived_at is null`.
- RLS select through Media Library access.
- RLS insert/update/delete through Media Library folder management.

There is no parent/child folder support.

### `media_library_folder_memberships`

Current columns:

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null`
- `media_library_asset_id uuid not null`
- `folder_id uuid not null`
- `created_at timestamptz not null default now()`
- `created_by uuid not null`
- `updated_at timestamptz not null default now()`
- `updated_by uuid not null`

Relevant constraints and indexes:

- FK `(media_library_asset_id, tenant_id)` to `media_library_assets`.
- FK `(folder_id, tenant_id)` to `media_library_folders`.
- Unique `(tenant_id, media_library_asset_id)`.
- Index `(tenant_id, folder_id, updated_at desc)`.
- Index `(tenant_id, media_library_asset_id)`.
- RLS select through Media Library access.
- RLS insert/update/delete through Media Library folder management.

Feature 102 should not rewrite memberships when a folder's parent changes. Folder moves should carry contained assets by hierarchy.

## Current routes and services involved

Read and browse:

- `getMediaLibraryPageData` in `src/lib/project-releases/project-release-service.ts`
  - authorizes access.
  - loads latest-release assets.
  - loads active folders.
  - validates selected active `folderId`.
  - enriches items with stable `mediaLibraryAssetId`, active `folderId`, and active `folderName`.
  - returns page-local items and pagination metadata.
- `getReleaseAssetDetail` in the same service
  - authorizes access.
  - loads one release asset by `(tenant_id, id)`.
  - verifies parent release is `published`.

Original access:

- `GET /api/media-library/assets/[releaseAssetId]/open`
- `GET /api/media-library/assets/[releaseAssetId]/download`
- Both call `createMediaLibraryOriginalAssetResponse`, which authenticates, resolves tenant server-side, loads release asset detail, and signs the original storage object after authorization.

Folder management routes:

- `POST /api/media-library/folders` creates a folder.
- `PATCH /api/media-library/folders/[folderId]` renames a folder.
- `POST /api/media-library/folders/[folderId]/archive` archives a folder.
- `POST /api/media-library/folders/[folderId]/add-assets` adds assets only when they are unassigned or already in that folder.
- `POST /api/media-library/folders/[folderId]/move-assets` moves assets into that folder, creating missing memberships or updating existing memberships.
- `POST /api/media-library/folders/[folderId]/remove-assets` removes memberships for selected assets in that folder.

Shared folder route behavior:

- `media-library-folder-route-handlers.ts` authenticates with the server Supabase client.
- It derives tenant through `resolveTenantId`.
- It never accepts `tenant_id` from the request body.
- It parses request JSON and shapes errors with `jsonError`.

Folder service behavior:

- Reads/writes are in `media-library-folder-service.ts`.
- Folder mutations call `authorizeMediaLibraryFolderManagement`.
- Folder list/read helpers call `authorizeMediaLibraryAccess`.
- Writes use an authenticated client for folder creation and service-role client for rename/archive/membership operations after explicit authorization.
- Folder target validation uses server-derived tenant and rejects archived folders.

Existing asset move idempotency:

- Repeating `move-assets` to the same folder returns no-op counts for assets already in that folder.
- Assets without membership are inserted.
- Assets in another folder are updated.
- Empty asset ID sets are rejected with `400 invalid_media_library_asset_ids`.
- Cross-tenant or missing stable asset IDs are rejected as `404 media_library_asset_not_found`.
- Archived target folders are rejected as `409 folder_archived`.
- Concurrent moves are effectively last writer wins because there is no expected-current-folder precondition.

Missing for Feature 102:

- No route/service exists for moving a folder under another folder or to root.
- No route/service exists for reading a nested folder path.
- No route/service exists for resolving descendant folders.
- No route/service exists for archiving with nested-folder awareness.

## Current authorization and tenant-scope boundaries

Media Library read access requires one of:

- fixed owner/admin membership;
- fixed reviewer membership with tenant-wide reviewer access;
- tenant-scoped custom role assignment with `media_library.access`.

Media Library folder management requires one of:

- fixed owner/admin membership;
- fixed reviewer membership with tenant-wide reviewer access;
- tenant-scoped custom role assignment with `media_library.manage_folders`.

Important current boundaries:

- `media_library.manage_folders` alone does not grant list/detail/download access.
- Current page UI only exposes folder controls after page data loads, so visible UI management currently implies read access plus management in practice.
- Project-scoped reviewer assignment does not grant Media Library access.
- Project/workspace-scoped custom-role assignments do not grant Media Library access.
- Folder routes derive tenant server-side and never accept `tenant_id`.
- RLS helper functions include custom role access/manage logic.
- Service-role writes happen only after explicit TypeScript authorization and tenant validation.

Feature 102 authorization mapping:

- Viewing tree and browsing folder contents: `media_library.access`.
- Dragging or batch-moving assets into a folder: `media_library.manage_folders`.
- Moving a folder under another folder or to root: `media_library.manage_folders`.
- Renaming folders: `media_library.manage_folders`.
- Archiving folders with or without children: `media_library.manage_folders`.
- Download/open original: unchanged, `media_library.access`.

Feature 102 must preserve that project reviewer access and project/workspace operational custom roles do not accidentally grant Media Library access.

## Current page and component structure

`src/app/(protected)/media-library/page.tsx`:

- Server component.
- Resolves locale, translations, auth user, and active tenant.
- Calls `getMediaLibraryPageData`.
- Parses `view`.
- Signs thumbnail preview URLs for returned page items.
- Builds item props for `MediaLibraryFolderBrowser`.

`src/components/media-library/media-library-folder-browser.tsx`:

- Client component.
- Contains both `MediaLibraryFolderBrowser` stateful container and `MediaLibraryFolderBrowserView`.
- Renders folder sidebar, compact folder create UI, inline rename, archive icon action, page header, view toggle, pagination controls, selection toolbar, grid cards, list rows, and open/download actions.
- Stores selection in `selectedAssetIds` as stable `mediaLibraryAssetId` strings.
- Resets selection on folder, page, limit, or view changes.
- Prunes selection to current page item IDs after refresh.
- No drag/drop state exists.

`src/app/(protected)/media-library/[releaseAssetId]/page.tsx`:

- Server component.
- Reads detail by immutable release asset ID.
- Signs preview/playback URLs.
- Validates optional `folderId` only for the back link.
- Back link currently preserves `folderId` only.

UI pieces to reuse for Feature 102:

- Existing folder sidebar shell.
- Existing page-local checkbox selection and batch move fallback.
- Existing `move-assets` route.
- Existing create, rename, archive controls, but tree rows will need indentation and a move-to-root affordance.
- Existing grid/list item models with stable `mediaLibraryAssetId`.
- Existing Media Library open/download safety confirmation.

Patterns not to disrupt:

- Grid/list and pagination URL state.
- Page-local selection semantics.
- Feature 077 safety badges and download warnings.
- Read-only release snapshot detail behavior.
- Compact, functional UI style.

## Current drag/drop support and dependencies

Installed dependencies:

- `@dnd-kit/core`
- `@dnd-kit/sortable`
- `@dnd-kit/utilities`

Current app usage:

- Template form layout editor uses `DndContext`, `PointerSensor`, `KeyboardSensor`, sortable keyboard coordinates, `useSortable`, explicit drag handles, and activation distance.
- Template structured fields editor uses the same family of sortable patterns.

Current Media Library usage:

- None. No `@dnd-kit` import exists in Media Library components.
- No draggable asset handle exists.
- No folder drop target exists.

Reusable pattern:

- Use explicit drag handles with `aria-label` and `title`.
- Use `PointerSensor` activation distance to avoid accidental drags.
- Use `KeyboardSensor` where sortable semantics are appropriate.

Feature 102 DnD should not simply copy sortable lists for all behavior:

- Asset drag-to-folder is not sortable. Use `@dnd-kit/core` `useDraggable` and `useDroppable`.
- Folder drag-to-folder changes parent, not order. It can also use draggable/droppable primitives rather than sortable ordering.
- If manual tree order is deferred, `@dnd-kit/sortable` is not needed for folder tree movement.

Recommended DnD gesture:

- Use explicit drag handles on asset cards/rows plus allow whole-card dragging only if it proves non-conflicting in implementation.
- Keep detail links and checkboxes click-safe.
- Folder rows should expose a visible drop state and an accessible label.
- A dedicated root drop target or per-folder overflow action should support moving a folder back to root.
- Checkbox/batch move remains the keyboard/touch fallback.

## Folder hierarchy data model options

### Option A - Nullable `parent_folder_id` adjacency list

Shape:

- Add nullable `parent_folder_id` to `media_library_folders`.
- `null` means root.
- FK `(parent_folder_id, tenant_id)` references `media_library_folders(id, tenant_id)`.
- Active folder name uniqueness moves from tenant-wide to sibling-level.

Pros:

- Smallest robust persisted hierarchy model.
- Easy to render a full tree after loading all active folders for a tenant.
- Folder move is a single parent pointer update.
- Moving a folder carries child folders and contained assets by hierarchy without touching memberships or releases.
- Fits expected folder volume for a tenant Media Library.
- Easy to reason about with current flat-folder table.

Cons:

- Cycle prevention is not automatic with a plain FK.
- Descendant queries require recursive CTEs.
- Sibling-level uniqueness requires a new index shape and care around `null` parent values.
- Archive and direct URL validation must account for archived ancestors.

### Option B - Materialized path

Shape:

- Store a path, for example ancestor IDs or slugs, on each folder.

Pros:

- Efficient descendant/path queries.
- Breadcrumbs can be read directly.

Cons:

- Moving a folder requires rewriting path values on all descendants.
- Harder to keep retry-safe under concurrent moves.
- More migration and testing complexity than current expected scale justifies.
- Path strings can become another source of tenant or name-collision bugs.

### Option C - Closure table

Shape:

- Add `media_library_folder_closure` rows for every ancestor/descendant pair.

Pros:

- Strong query model for descendants, ancestors, subtree counts, and cycle prevention.
- Scales better for very deep or heavily queried trees.

Cons:

- Larger schema and service surface.
- Moving a subtree requires deleting/inserting many closure rows.
- More RLS and migration tests.
- Likely overbuilt for first nested-folder version.

### Option D - Keep folders flat and fake hierarchy in UI

Shape:

- Encode hierarchy in names or client-only state.

Pros:

- No migration.

Cons:

- Does not support real folder movement.
- Breaks URLs, server validation, authorization, and drag/drop correctness.
- Cannot prevent cycles because no real hierarchy exists.
- Misrepresents product state.

### Recommendation

Use Option A: nullable `parent_folder_id` adjacency list.

Recommended first schema direction:

- Add `parent_folder_id uuid null` to `media_library_folders`.
- Add tenant-scoped FK `(parent_folder_id, tenant_id)` to `media_library_folders(id, tenant_id)`.
- Add check `parent_folder_id is null or parent_folder_id <> id`.
- Replace tenant-wide active-name uniqueness with sibling-level active-name uniqueness:
  - root siblings: unique `(tenant_id, lower(btrim(name))) where archived_at is null and parent_folder_id is null`.
  - child siblings: unique `(tenant_id, parent_folder_id, lower(btrim(name))) where archived_at is null and parent_folder_id is not null`.
- Add index `(tenant_id, parent_folder_id, lower(btrim(name))) where archived_at is null`.
- Keep manual ordering out of scope.

Why this is the smallest robust model:

- It matches the current table and product intent.
- It avoids rewriting release snapshots or memberships.
- It is easy to load all active folders and build a tree client-side for first version.
- It leaves materialized paths or closure table as future performance upgrades if folder volume grows.

## Cycle-prevention and server validation options

Required validations:

- Target parent must belong to the same tenant.
- Target parent must be active.
- Folder being moved must belong to the same tenant.
- Folder being moved must be active.
- Folder cannot move under itself.
- Folder cannot move under one of its descendants.
- Moving to the current parent is idempotent.
- Sibling name conflict under the target parent must be detected.

Validation placement options:

### TypeScript service only

Pros:

- Simple to implement.
- Fits current service style.

Cons:

- Hard to make atomic because Supabase/PostgREST route code cannot easily wrap recursive validation and update in one transaction.
- Race-prone under concurrent folder moves.
- Does not protect direct DB writes or future route additions.

### SQL RPC

Pros:

- Can validate target, check descendants via recursive CTE, check sibling name conflict, and update parent in one database transaction.
- Can be called after TypeScript authorization with service-role client.
- Strong fit for current service-role-after-authorization pattern.
- Easier to test for concurrency and cycle prevention than a multi-step TS update.

Cons:

- Adds SQL function surface.
- Requires careful tenant-scoped parameters and no reliance on client-provided tenant.

### Database trigger

Pros:

- Enforces cycle prevention for any update path.
- Good backstop.

Cons:

- Trigger alone does not shape product-specific HTTP errors well.
- Still need service validation for target archived/not found and sibling conflicts.
- Can be harder to test and debug than an explicit RPC.

### SQL RPC plus lightweight TypeScript checks

Pros:

- Best combination of app-level error shaping and DB atomicity.
- Keeps route/service explicit.
- Preserves tenant and authorization invariants.

Cons:

- Slightly more implementation than TypeScript only.

Recommendation:

- Add a database RPC for folder move atomicity and cycle prevention.
- Call it from a TypeScript route/service after `authorizeMediaLibraryFolderManagement`.
- Use service-role client for the RPC after auth and tenant validation, or authenticated RPC only if RLS semantics are carefully designed and tested.
- Keep TypeScript body validation and error mapping in route handlers.
- Add a trigger or check as a backstop only if the plan phase decides direct authenticated folder updates remain exposed enough to warrant it. Current route/service code already uses service-role for folder updates after authorization, so an RPC is the most important first control.

Recommended RPC contract:

- Name example: `app.move_media_library_folder`.
- Inputs:
  - `p_tenant_id uuid`
  - `p_folder_id uuid`
  - `p_parent_folder_id uuid default null`
  - `p_actor_user_id uuid`
- Output:
  - folder row summary plus `changed boolean`, or a structured code.
- It should not infer tenant from request body. The route passes server-derived tenant.
- It should use recursive CTE to reject descendant targets.
- It should update `parent_folder_id`, `updated_at`, and `updated_by`.

Concurrent moves:

- If two moves race, the RPC should re-read current rows inside the database operation.
- Last successful move can be accepted for first version unless the plan chooses optimistic concurrency.
- Name conflicts caused by concurrent rename/move should return `409 folder_name_conflict`.
- Moving to already-current parent returns `changed: false`.

## Folder tree read model

Recommended first version:

- Load all active folders for the tenant in one query.
- Build a tree in TypeScript/client component by `parent_folder_id`.
- Sort siblings alphabetically by normalized name.
- Exclude archived folders from normal tree.
- Treat folders with archived ancestors as not browseable even if their own `archived_at` is null.

Why load all active folders:

- Current folders are tenant organization metadata, not large per-file rows.
- Expected folder volume is much smaller than asset volume.
- Full load simplifies tree rendering, breadcrumbs, drop target validation, and root movement.
- Lazy-loading children adds more route complexity before scale proves it is needed.

Counts:

- First version should keep direct asset counts only.
- Descendant aggregate counts are useful but can become expensive and ambiguous.
- If counts are displayed in the tree, label/behavior should imply direct current assets in that folder.
- Descendant counts should be deferred unless the plan phase finds a cheap recursive CTE that does not complicate pagination.

Archived folders:

- Do not show archived folders as active tree nodes.
- Do not allow archived folders as drop targets.
- Direct URL access to archived folder or folder with archived ancestor should return not found or redirect to all assets.

## Asset browsing semantics for nested folders

Options:

- Direct assets only: opening a folder shows assets directly assigned to that folder.
- Direct plus descendants: opening a folder shows the entire subtree.
- Toggle between direct and descendants.

Recommendation:

- Use direct assets only for Feature 102.

Reasons:

- Current membership model assigns an asset to exactly one folder.
- Direct-only is easiest to explain with page-local selection and batch move semantics.
- Direct-only keeps pagination totals stable and avoids recursive asset reads in the first nested version.
- A subtree toggle can be added later if user demand is clear.

Interaction with pagination:

- Selection remains page-local.
- Changing folder resets page to `1`.
- Dragging selected assets moves only selected current-page stable IDs.
- Moving assets out of the currently viewed folder should clear/prune selection and refresh page data.

Interaction with folder moves:

- Moving a folder changes where that folder appears in the tree.
- It should not rewrite asset memberships inside that folder.
- If the currently viewed folder is moved, keep `folderId` selected and show the same direct assets; breadcrumbs/tree path update after refresh.

## Moving assets into nested folders

Existing `move-assets` can work unchanged if the target folder is nested, with one condition:

- `loadActiveFolderById` and related folder reads must remain tenant-scoped and must reject archived folders or folders hidden by archived ancestors if that archive model is chosen.

Route body can remain:

```json
{ "mediaLibraryAssetIds": ["uuid-1", "uuid-2"] }
```

Needed UI behavior:

- Asset drag starts with a stable `mediaLibraryAssetId`.
- If dragged asset is currently selected, move the full selected set.
- If dragged asset is not selected, move only that asset.
- Drop calls `POST /api/media-library/folders/[targetFolderId]/move-assets`.
- No-op drop to the current folder should be ignored or return success with no-op counts.
- On success, clear selection and refresh.
- On failure, keep selection and show an inline error.

Keyboard/touch fallback:

- Existing checkbox selection plus `Move to folder` must remain.
- The target folder select should be able to include nested folders, likely with path labels or indentation in option text.

## Moving folders

Needed route:

- `POST /api/media-library/folders/[folderId]/move`

Recommended request body:

```json
{ "parentFolderId": "uuid-or-null" }
```

Representation:

- `parentFolderId: null` means move to root.
- Do not overload an empty string as root in the API.
- Client never sends tenant id.

Recommended response:

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

Recommended errors:

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
- `409 folder_move_conflict` for rare concurrent update conflicts not covered by name/cycle codes

Idempotency:

- Moving a folder to its current parent should return `changed: false`.
- Retrying the same move after success should return `changed: false`.

Move-to-root UX:

- Provide a visible root drop target such as `All assets` or a dedicated `Root` target in the tree header.
- Also provide a folder overflow/menu action or dialog fallback so touch and keyboard users can move a folder to root.

## Breadcrumb and tree UX options

Options:

- Tree highlighting only.
- Breadcrumb/path header only.
- Both tree highlighting and a compact path header.

Recommendation:

- Use both tree highlighting and a compact breadcrumb/path header for the first nested version.

Reasons:

- Tree highlighting helps orientation during drag/drop.
- Breadcrumb/path header helps when the tree is scrolled, collapsed in mobile, or not visible.
- A path header also improves detail back behavior.

Detail back behavior:

- Preserve `folderId`, `page`, `limit`, and `view` where applicable.
- Current detail preserves only `folderId`.
- Feature 102 should improve this when modifying navigation context, but it should not redesign detail routing.

Breadcrumb derivation:

- Derive breadcrumbs from the loaded active folder tree on the server/page data.
- Do not trust client-only tree state as authority for path validation.

## Folder archive semantics for nested folders

Current flat behavior:

- Archive sets `archived_at` and `archived_by` on the folder.
- Membership rows remain.
- Archived folders disappear from normal navigation.
- Assets assigned to archived folders appear unfiled in all-assets page enrichment because archived memberships are ignored.

Nested options:

1. Archive only selected folder and visually hide descendants because the parent is hidden.
2. Cascade archive descendants by writing `archived_at` on every descendant.
3. Prevent archive when a folder has child folders.
4. Require explicit confirmation that mentions descendants, then archive only selected folder or cascade.

Recommendation:

- First nested version should archive only the selected folder, not cascade, and visually hide its descendants by treating archived ancestors as inactive.
- The confirmation copy should mention that child folders and contained assets will be hidden from the active tree while release snapshots and memberships are not deleted.

Why:

- It is closest to current archive semantics.
- It avoids destructive subtree writes.
- It preserves child folder records and memberships for future restore/admin tooling.
- It keeps release snapshots immutable.

Required server behavior:

- Active tree reads should exclude folders with archived ancestors.
- Browsing a descendant of an archived parent by direct URL should reject or redirect to all assets.
- Drop targets must exclude folders with archived ancestors.

Open plan decision:

- Because there is no restore UI today, the plan phase should decide whether to prevent archiving a folder with child folders until restore semantics exist. If product wants the safest operator experience over non-destructive implementation, prevention is reasonable.

## Folder name uniqueness for nested folders

Current rule:

- Active folder names are tenant-wide unique, case-insensitive after trim.

Nested options:

- Keep tenant-wide unique active names.
- Allow same names under different parents with sibling-level uniqueness.

Recommendation:

- Use sibling-level uniqueness for a Google Drive-like hierarchy.

Reasons:

- Users expect repeated names like `Final`, `Social`, or `Website` under different parents.
- Tenant-wide uniqueness becomes artificial once the tree communicates path.
- Sibling-level uniqueness is still safe and avoids ambiguity within a parent.

Migration considerations:

- Existing active names are tenant-wide unique, so they already satisfy sibling-level uniqueness.
- Add separate partial unique indexes for root siblings and child siblings.
- Rename and move both need to validate conflicts because moving a folder can create a sibling conflict without changing the folder name.

## Tree ordering

Current flat ordering:

- Active folders are ordered by `name` ascending in page data.

Options:

- Alphabetical siblings.
- Updated order.
- Created order.
- Manual sort order.

Recommendation:

- Keep alphabetical sibling order for Feature 102.

Reasons:

- It matches current behavior.
- It avoids adding sort-position schema.
- It keeps folder drag/drop meaning strictly "move parent", not "reorder".
- Manual order can be a later feature if users need it.

## Asset drag-to-folder feasibility

Feasible now with no schema change.

Implementation requirements:

- Add DnD wiring to `MediaLibraryFolderBrowser`.
- Add a drag handle to grid cards and list rows.
- Encode drag data with:
  - dragged `mediaLibraryAssetId`
  - whether the asset is selected
  - selected asset IDs at drag start
- Folder tree rows become drop targets.
- On drop, choose:
  - selected IDs if dragged item is in selected set;
  - otherwise only dragged asset ID.
- Call existing `move-assets`.
- Preserve existing checkbox batch move fallback.

Risks:

- Whole-card drag can conflict with opening detail, toggling checkbox, and text selection.
- Dragging selected assets across page-local selection is fine, but cross-page selection is out of scope.
- Folder archived during drag should be rejected server-side and refreshed client-side.

Recommended affordance:

- Use an explicit grip/handle icon on every asset card/row for folder managers.
- Consider making the thumbnail/card also draggable only after the handle pattern is proven.
- Add localized labels such as `Drag asset`, `Drag selected assets`, and drop target labels.

## Folder drag-to-folder feasibility

Feasible only after adding a real hierarchy model and folder move route.

Implementation requirements:

- Add `parent_folder_id` model.
- Load active folders as a tree.
- Add folder drag handles.
- Add folder row droppable targets.
- Add root drop target.
- On drop, call folder move route.
- Reject invalid moves client-side for immediate feedback when possible, but always enforce server-side.

Invalid targets:

- self;
- descendants;
- archived folders;
- folders hidden by archived ancestors;
- cross-tenant folders.

Keyboard/touch fallback:

- Folder row overflow action should include `Move to...`.
- Dialog/select should list possible parent folders, excluding self and descendants.
- Include `Root` as an option.

## Accessibility and mobile/touch considerations

Current fallback:

- Asset movement already has checkbox selection plus target folder select and action buttons.

Needed fallback additions:

- Folder movement should not rely only on drag/drop.
- Add a keyboard/touch accessible `Move folder` action.
- The move dialog/select should expose a path-aware list of valid parent folders plus root.
- Drop targets should have accessible names, for example "Move to Website / Final".
- Drag handles need accessible labels.
- Announce selected-set drag count visually and via accessible text where practical.

Mobile:

- Tree may need to collapse above the asset list.
- Touch users should be able to use checkboxes and folder move menus without precision dragging.
- Avoid requiring drag-over hover states for critical information.

Marquee selection:

- Keep full marquee draw-over selection deferred.
- Existing checkbox selection is the right first accessibility baseline.
- Drag/drop and marquee would compete for pointer gestures; adding both in one feature is unnecessary.

## Security and reliability considerations

Security invariants:

- Do not accept `tenant_id` from the client.
- Every read/write filters by server-derived tenant.
- Folder hierarchy moves must target `media_library_folders`, not release tables.
- Asset moves must target `media_library_assets`, not `project_release_assets`.
- No release snapshot mutation.
- No consent, matching, review, workflow, RBAC, reviewer access, photographer assignment, or public token behavior changes.

Reliability:

- Asset move retries are already safe for same target.
- Folder move retries should be safe for same parent.
- Concurrent asset moves are last-writer-wins today; keep unless plan chooses expected-current-folder checks.
- Concurrent folder moves should be atomic through SQL RPC.
- Sibling-name conflicts caused by concurrent rename/move should return `409`.
- Stale client trees should refresh after write errors.
- Page changes during drag should cancel or ignore the drag operation.

Failure modes to handle:

- Folder archived during asset drag.
- Folder moved during asset drag.
- Folder target becomes descendant due to concurrent move.
- Selected assets moved by another user.
- Selected assets no longer on current page after refresh.
- Current viewed folder moved to a new parent.
- Current viewed folder or an ancestor archived.
- Detail back link points to a now-archived or moved folder.

## i18n considerations

Existing `mediaLibrary.list` keys cover flat folders, pagination, view, selection, errors, and open/download actions.

Likely new English and Dutch key groups:

- Folder tree:
  - `mediaLibrary.list.sidebar.root`
  - `mediaLibrary.list.sidebar.expandFolder`
  - `mediaLibrary.list.sidebar.collapseFolder`
  - `mediaLibrary.list.sidebar.folderPath`
- Drag handles:
  - `mediaLibrary.list.drag.assetHandle`
  - `mediaLibrary.list.drag.selectedAssetsHandle`
  - `mediaLibrary.list.drag.folderHandle`
- Drop targets:
  - `mediaLibrary.list.drop.moveAssetsToFolder`
  - `mediaLibrary.list.drop.moveFolderToFolder`
  - `mediaLibrary.list.drop.moveFolderToRoot`
  - `mediaLibrary.list.drop.invalidTarget`
- Folder move:
  - `mediaLibrary.list.folderForm.moveFolder`
  - `mediaLibrary.list.folderForm.parentFolderLabel`
  - `mediaLibrary.list.folderForm.rootOption`
  - `mediaLibrary.list.folderMessages.folderMoved`
- Breadcrumbs:
  - `mediaLibrary.list.breadcrumb.root`
  - `mediaLibrary.detail.backToFolder`
- Errors:
  - `folderMoveIntoSelf`
  - `folderMoveIntoDescendant`
  - `folderNameConflict`
  - `targetFolderArchived`
  - `folderMoveConflict`
- Archive confirmation with children:
  - `mediaLibrary.list.sidebar.archiveConfirmWithChildren`

All new user-facing copy must be added to both `messages/en.json` and `messages/nl.json`.

Note:

- Existing message files already contain visible encoding artifacts in `pagination.pageStatus`. Feature 102 should avoid introducing new encoding artifacts and should use clean UTF-8.

## Testing considerations

Existing relevant coverage:

- Feature 074 tests cover release creation, latest published list, historical detail access, photographer denial, and download/open route behavior.
- Feature 077 tests cover safety helper/UI behavior.
- Feature 078 tests cover stable identities, folder lifecycle, route handler auth/body parsing, membership add/move/remove idempotency, carry-forward to v2, tenant isolation, archived flat folders, and UI rendering.
- Feature 085 tests cover custom-role Media Library access/manage enforcement.
- Feature 101 tests cover only pagination input normalization.

Needed migration tests:

- `parent_folder_id` column and tenant-scoped FK.
- Root sibling active-name uniqueness.
- Child sibling active-name uniqueness.
- Same names allowed under different parents.
- Self-parent check.
- RLS still permits reads/writes only through Media Library access/manage helpers.
- `supabase db reset` applies cleanly.

Needed service/RPC tests:

- Move folder under another folder.
- Move folder to root.
- Repeated move to same parent is no-op.
- Move into self rejected.
- Move into descendant rejected.
- Cross-tenant folder/target rejected.
- Archived folder and archived target rejected.
- Sibling name conflict on move rejected.
- Moving a folder does not mutate memberships or release rows.
- Current descendant path updates after parent move.
- Concurrent move/name conflict behavior if testable.

Needed route tests:

- `401` unauthenticated.
- `403` no tenant/member or no folder management.
- `404` folder not found.
- `404` target not found.
- `409` folder archived.
- `409` target archived.
- `409` move into self.
- `409` move into descendant.
- `409` name conflict.
- `200 changed false` for idempotent move.

Needed read-model tests:

- Tree returns nested active folders sorted alphabetically.
- Archived folders and descendants hidden from active tree if visual-hide semantics are chosen.
- Breadcrumb/path for nested folder.
- Opening nested folder shows direct assets only.
- Folder counts are direct counts.
- Detail back link preserves nested folder context, and ideally page/limit/view.

Needed UI tests:

- Tree indentation renders.
- Current folder is highlighted.
- Breadcrumb/path header renders.
- Asset drag handle appears for folder managers only.
- Asset drag selected-set logic sends selected IDs.
- Dragging unselected asset sends only dragged ID.
- Folder drop target and root drop target call correct routes.
- Invalid folder drop targets are not offered or show disabled state.
- Folder move fallback renders for keyboard/touch users.
- Access-only users do not see drag/move controls.
- Existing Feature 077 badges and open/download actions still render.

Needed i18n tests:

- English and Dutch message trees have matching new keys.

Validation:

- `supabase db reset` should be part of implementation validation because Feature 102 likely needs a migration.
- Run targeted Feature 074, 077, 078, 085, 101, and new 102 tests.
- Run `npm test` and `npm run lint` before completion.

## Recommended bounded direction for Feature 102

Feature 102 is suitable for one larger RPI implementation cycle if kept to these boundaries:

In scope:

- Add real nested folders with nullable `parent_folder_id`.
- Switch active folder name uniqueness to sibling-level.
- Load and render an active folder tree.
- Add breadcrumbs/path header for nested folders.
- Keep asset browsing direct-folder-only.
- Add asset drag-to-folder using existing `move-assets`.
- Add selected-asset drag behavior using page-local selection.
- Add folder drag-to-folder and move-to-root.
- Add a keyboard/touch folder move fallback.
- Preserve existing checkbox batch move fallback.
- Preserve grid/list, pagination, open/download, safety badges, and detail pages.
- Preserve `media_library.access` and `media_library.manage_folders`.
- Use SQL RPC or equivalent DB-side atomic validation for folder move cycle prevention.
- Do not mutate release snapshot tables.

Recommended implementation sequence:

1. Schema and SQL move validation foundation.
2. Folder read model, tree building, breadcrumbs, and sibling name semantics.
3. Folder move route/service and keyboard/touch fallback.
4. Asset drag-to-folder with selected-set semantics.
5. Folder drag-to-folder plus root drop target.
6. Tests and regression pass.

## Explicit deferred items

Defer:

- Full marquee draw-over selection.
- Cross-page persistent selection.
- Batch download/export.
- DAM sync or external DAM mapping.
- Media Library asset delete/archive.
- Manual folder ordering.
- Descendant aggregate folder counts.
- Recursive "show all descendants" asset browsing toggle.
- Restore archived folders UI.
- Per-folder permissions.
- Generic file-manager abstraction.
- Project ZIP export restoration.
- Consent, matching, review, project workflow, RBAC, reviewer access, photographer assignment, and public token changes.

## Open decisions for the plan phase

1. Should nested folder archive be "archive selected folder and hide descendants visually" or "prevent archive when active child folders exist" until restore UI exists?
2. Should direct URL access to a descendant of an archived folder return `404`, redirect to all assets, or show a controlled archived-context message?
3. Should folder tree counts show direct assets only with no descendant counts, or omit counts until descendant semantics are designed?
4. Should a maximum folder depth be enforced for usability and cycle-query safety?
5. Should the folder move RPC be service-role only after TypeScript authorization, or exposed as authenticated RPC with RLS checks?
6. Should folder move conflicts use last-writer-wins except name/cycle errors, or include optimistic concurrency with `updated_at`?
7. Should the asset card/row support whole-item dragging in addition to an explicit drag handle?
8. Should drag overlays show the number of selected assets being moved?
9. Should moving assets to the currently viewed folder show a no-op status or silently do nothing?
10. Should detail back links preserve `page`, `limit`, and `view` in addition to `folderId`?
11. How should path labels be shown in a compact target-folder select for batch and keyboard folder moves?
12. Should `Add to folder` remain visible once a Drive-like hierarchy and drag movement exist, or should the UI simplify toward `Move to folder` only?
