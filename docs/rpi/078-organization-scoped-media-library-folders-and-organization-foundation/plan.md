# Feature 078 Plan - Organization-scoped Media Library folders and organization foundation

## Inputs and ground truth

Required inputs reviewed in order for this planning phase:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `UNCODEXIFY.md`
5. `docs/rpi/README.md`
6. `docs/rpi/SUMMARY.md`
7. `docs/rpi/078-organization-scoped-media-library-folders-and-organization-foundation/research.md`

Targeted live verification was then limited to plan-critical files:

- `src/app/(protected)/media-library/page.tsx`
- `src/app/(protected)/media-library/[releaseAssetId]/page.tsx`
- `src/app/api/media-library/assets/[releaseAssetId]/download/route.ts`
- `src/lib/project-releases/project-release-service.ts`
- `src/lib/project-releases/types.ts`
- `src/lib/project-releases/media-library-download.ts`
- `src/lib/project-releases/media-library-release-safety.ts`
- `supabase/migrations/20260424130000_074_project_releases_media_library_foundation.sql`
- `supabase/migrations/20260424150000_075_project_correction_re_release_foundation.sql`
- `src/lib/projects/project-workflow-service.ts`
- `src/lib/projects/project-workflow-route-handlers.ts`
- `src/lib/tenant/resolve-tenant.ts`
- `src/lib/tenant/permissions.ts`
- current route-handler mutation patterns under `src/app/api/**`
- relevant Feature 074, 075, and 077 tests
- `messages/en.json`
- `messages/nl.json`

Source-of-truth order used for this plan:

1. Live schema and current code
2. Feature 078 research document
3. Older RPI docs only where they still match live code

## Verified current boundary

Plan-critical live behavior confirmed from current code:

- `listMediaLibraryAssets(...)` still resolves the Media Library to the latest published release per project, not to all historical release rows.
- `getReleaseAssetDetail(...)` still resolves a historical asset by immutable `project_release_assets.id` and validates that its parent release remains published.
- Feature 077 safety badges, usage summaries, overlays, and advisory download confirmation all derive from immutable release snapshot JSON and do not mutate release data.
- `GET /api/media-library/assets/[releaseAssetId]/download` remains a thin route-handler wrapper around authenticated tenant resolution plus `getReleaseAssetDetail(...)`.
- `project_release_assets.id` is immutable per release snapshot row, while `source_asset_id` is the only live lineage key that repeats across release versions.
- correction re-release still publishes fresh `project_releases` and `project_release_assets` rows for v2+, leaving v1 unchanged.
- project finalization still does not depend on Media Library organization metadata; `handleProjectFinalizePost(...)` calls `finalizeProject(...)` and then `ensureProjectReleaseSnapshot(...)`.
- active tenant resolution is still server-side through `resolveTenantId(...)`, using memberships plus the `sc_active_tenant` cookie and rejecting invalid multi-tenant selection with `409 active_tenant_required`.
- reviewer-capable access still means `owner`, `admin`, and `reviewer`; `photographer` remains denied through both permission helpers and release-table RLS.
- current authenticated mutation style still uses route handlers under `src/app/api/**`, server-side auth and tenant derivation, and service or route-handler helpers under `src/lib/**`.

Feature 078 must preserve all of that.

## Scope boundaries

In scope for implementation:

- tenant-scoped Media Library folders
- flat folder create, rename, and archive
- assigning latest released assets to one folder
- moving assets between folders
- removing assets from folders
- all-assets view plus folder-filtered view
- stable Media Library asset identity for release-version carry-forward
- route handlers and services for folder writes
- minimal Media Library UI changes inside the existing page
- English and Dutch copy
- tests for schema, RLS, folder lifecycle, membership behavior, latest-release carry-forward, immutability, and tenant isolation

Out of scope:

- DAM export, sync, status tables, or external DAM identifiers
- nested folders
- multi-folder collections
- user-private folders
- public sharing
- advanced search, tags, custom metadata, or smart folders
- editing release snapshots or review state from Media Library
- changing correction or finalization behavior beyond the minimal stable-identity hook
- making folders required for release publication

## Options considered

### Option 1 - membership points at `project_release_assets.id`

Reject.

Why:

- it binds folder organization to immutable historical rows
- folder assignment made on v1 would not naturally follow v2
- moving or removing would conceptually organize release history rather than current library assets

### Option 2 - membership points directly at `(tenant_id, project_id, source_asset_id)`

Viable fallback, but not preferred.

Why it is smaller:

- no extra stable-identity table is needed
- folder membership can still follow latest release at read time

Why it is not the chosen direction:

- the built-in Media Library still lacks an explicit asset identity of its own
- future DAM handoff and future library-only metadata have no clear seam
- membership rows become the de facto identity layer anyway

### Option 3 - thin stable identity plus folders plus membership table

Chosen.

Why:

- keeps release truth immutable and separate from mutable folder metadata
- lets folder membership follow v2 automatically without mutating old release rows
- gives the Media Library its own bounded stable asset identity without adding DAM concepts
- stays small enough for Feature 078

## Recommendation

Implement Feature 078 with three new tenant-scoped tables:

- `media_library_assets`
- `media_library_folders`
- `media_library_folder_memberships`

This feature will use `Folders` as the user-facing term, keep folders flat and tenant-wide, archive folders instead of hard-deleting them, and keep one active folder membership per stable Media Library asset in the first slice.

The current Media Library list/detail/download behavior stays in place:

- all-assets view still shows latest published release assets only
- folder-filtered view also resolves latest published release assets only
- detail pages remain `/media-library/[releaseAssetId]`
- historical release detail remains direct-id only
- Feature 077 safety context remains fully active in both all-assets and folder-filtered views

## Chosen architecture

### Core model

- `project_releases` and `project_release_assets` remain immutable release truth.
- `media_library_assets` becomes the stable tenant/project/source-asset identity for built-in library organization.
- `media_library_folders` stores mutable tenant-level folder metadata.
- `media_library_folder_memberships` stores current folder assignment for a stable library asset.

### Product rules encoded by the architecture

- folders are organization metadata, not release truth
- folder changes never mutate `project_releases`
- folder changes never mutate `project_release_assets`
- folder changes never mutate source assets, correction state, consent state, review state, or finalization state
- release v2 creates fresh immutable release rows and folder views derive the latest released asset at read time

### First-slice shape

- folders are tenant-wide, not project-scoped and not release-scoped
- folders are flat, not nested
- folders are archived, not hard-deleted
- each stable Media Library asset can belong to at most one active folder
- assets removed from the latest release keep stable identity and membership rows but disappear from normal current folder views

## Exact schema/model plan

### `media_library_assets`

Purpose:

- stable built-in Media Library identity for released photos and videos
- anchors folder membership across release versions

Columns:

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null references public.tenants(id) on delete restrict`
- `project_id uuid not null`
- `source_asset_id uuid not null`
- `created_at timestamptz not null default now()`
- `created_by uuid not null references auth.users(id) on delete restrict`

Constraints:

- foreign key `(project_id, tenant_id)` -> `public.projects(id, tenant_id)` on delete restrict
- foreign key `(source_asset_id, tenant_id, project_id)` -> `public.assets(id, tenant_id, project_id)` on delete restrict
- unique `(tenant_id, project_id, source_asset_id)`
- unique `(id, tenant_id)`

Indexes:

- `media_library_assets_tenant_project_idx` on `(tenant_id, project_id, created_at desc)`
- `media_library_assets_tenant_source_asset_idx` on `(tenant_id, source_asset_id)`

Deliberate non-columns in first slice:

- no `latest_release_id`
- no `latest_release_asset_id`
- no folder column
- no DAM fields
- no mutable review or consent metadata

### `media_library_folders`

Purpose:

- active-tenant folder definitions for built-in Media Library organization

Columns:

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null references public.tenants(id) on delete restrict`
- `name text not null`
- `created_at timestamptz not null default now()`
- `created_by uuid not null references auth.users(id) on delete restrict`
- `updated_at timestamptz not null default now()`
- `updated_by uuid not null references auth.users(id) on delete restrict`
- `archived_at timestamptz null`
- `archived_by uuid null references auth.users(id) on delete restrict`

Constraints:

- unique `(id, tenant_id)`
- check `btrim(name) <> ''`
- check archive shape:
  - both `archived_at` and `archived_by` are null
  - or both are non-null

Folder-name rule:

- active folder names are case-insensitively unique per tenant
- archived names may be reused

Implementation shape:

- partial unique index on `(tenant_id, lower(btrim(name))) where archived_at is null`

Indexes:

- partial unique index described above
- `media_library_folders_tenant_active_idx` on `(tenant_id, updated_at desc) where archived_at is null`

Deferred from first slice:

- `description`
- folder color
- sort position
- unarchive UI

### `media_library_folder_memberships`

Purpose:

- current folder assignment for a stable Media Library asset

Columns:

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null references public.tenants(id) on delete restrict`
- `media_library_asset_id uuid not null`
- `folder_id uuid not null`
- `created_at timestamptz not null default now()`
- `created_by uuid not null references auth.users(id) on delete restrict`
- `updated_at timestamptz not null default now()`
- `updated_by uuid not null references auth.users(id) on delete restrict`

Constraints:

- foreign key `(media_library_asset_id, tenant_id)` -> `public.media_library_assets(id, tenant_id)` on delete restrict
- foreign key `(folder_id, tenant_id)` -> `public.media_library_folders(id, tenant_id)` on delete restrict
- unique `(tenant_id, media_library_asset_id)`

Indexes:

- `media_library_folder_memberships_tenant_folder_idx` on `(tenant_id, folder_id, updated_at desc)`
- `media_library_folder_memberships_tenant_asset_idx` on `(tenant_id, media_library_asset_id)`

Behavioral note:

- archiving a folder does not delete membership rows
- normal folder navigation ignores archived folders and their dormant memberships

## Stable library asset identity plan

Stable identity key:

- `(tenant_id, project_id, source_asset_id)`

Creation timing:

- upsert a `media_library_assets` row during release snapshot creation for every released photo or video asset

Chosen seam:

- inside `ensureProjectReleaseSnapshot(...)`
- after `releaseAssetRows` are built
- before the parent release is marked `published`

Reason for this seam:

- identity rows exist before the release becomes visible for current Media Library reads
- retries stay safe with `on conflict do nothing`
- if release publication later fails, the identity rows are inert because Media Library reads still resolve through published releases only

Idempotency:

- `media_library_assets` upsert uses the unique key `(tenant_id, project_id, source_asset_id)`
- repeated finalize or release-repair attempts are no-op inserts for already indexed assets

Mutable metadata policy:

- `media_library_assets` is intentionally minimal
- it stores stable identity only
- it does not store latest-release pointers or safety metadata

## Latest-release and folder carry-forward plan

### All-assets view

- keep the existing latest-published-release-per-project resolution
- extend the read model to attach:
  - `mediaLibraryAssetId`
  - current active `folderId` if assigned to a non-archived folder
  - current active `folderName` if assigned to a non-archived folder

### Folder-filtered view

- start from the same latest-published-release-per-project asset set
- resolve each latest release asset to `media_library_assets` by `(tenant_id, project_id, source_asset_id)`
- filter those latest assets to the selected non-archived folder membership

### Carry-forward behavior

- if an asset is added to a folder while v1 is current and v2 later publishes with the same `source_asset_id`, the folder view shows the v2 release asset automatically
- historical v1 rows remain unchanged and still open by direct `project_release_assets.id`

### Asset removed from latest release

First-slice behavior:

- keep the `media_library_assets` row
- keep any folder membership row
- do not show the asset in the normal all-assets or folder-filtered current view
- do not add unavailable or historical folder UI in this slice

This preserves organization intent without treating a no-longer-current asset as part of the current library.

## Folder membership model

### One folder per asset

Chosen rule:

- one active folder per stable Media Library asset

Reason:

- matches the user-facing `Folders` term
- keeps add, move, and remove semantics simple
- avoids silently implementing broader collection behavior

### Add semantics

Endpoint uses stable `mediaLibraryAssetIds`.

Behavior:

- asset with no membership -> create membership
- asset already in the target folder -> no-op
- asset already in a different active folder -> conflict

Conflict code:

- `media_library_asset_already_assigned`

### Move semantics

Behavior:

- asset with no membership -> create membership in target folder
- asset already in target folder -> no-op
- asset in another active folder -> update `folder_id`, `updated_at`, and `updated_by`

This keeps move retry-safe and convenient for batch use.

### Remove semantics

Behavior:

- if membership exists for the asset and target folder -> delete membership
- if membership does not exist -> no-op
- if membership exists in another folder -> no-op

### Archived target folder

- add and move into an archived folder return `409 folder_archived`
- remove from an archived folder is not needed in the normal UI and can return `404 folder_not_found` because archived folders are not part of normal routing

### Cross-tenant asset or folder ids

- all reads and writes are filtered by server-derived `tenant_id`
- cross-tenant identifiers resolve as `404`

## Exact API and service plan

### Route handlers

Use route handlers, not server actions.

New routes:

- `POST /api/media-library/folders`
- `PATCH /api/media-library/folders/[folderId]`
- `POST /api/media-library/folders/[folderId]/archive`
- `POST /api/media-library/folders/[folderId]/add-assets`
- `POST /api/media-library/folders/[folderId]/move-assets`
- `POST /api/media-library/folders/[folderId]/remove-assets`

Reason for separate asset-operation endpoints:

- semantics differ in meaningful ways for no-op versus conflict handling
- this matches the current repo preference for explicit route behavior over a generic mutation DSL

### Request shapes

`POST /api/media-library/folders`

```json
{ "name": "Website picks" }
```

`PATCH /api/media-library/folders/[folderId]`

```json
{ "name": "Homepage picks" }
```

`POST /api/media-library/folders/[folderId]/archive`

```json
{}
```

`POST /api/media-library/folders/[folderId]/add-assets`

```json
{ "mediaLibraryAssetIds": ["uuid-1", "uuid-2"] }
```

`POST /api/media-library/folders/[folderId]/move-assets`

```json
{ "mediaLibraryAssetIds": ["uuid-1", "uuid-2"] }
```

`POST /api/media-library/folders/[folderId]/remove-assets`

```json
{ "mediaLibraryAssetIds": ["uuid-1", "uuid-2"] }
```

Client rule:

- client never sends `tenant_id`
- client never sends `project_id`
- asset operations use stable `mediaLibraryAssetIds`, not `releaseAssetId`

### Response shapes

Create folder:

- status `201`
- body:
  - `folder`

Rename and archive:

- status `200`
- body:
  - `folder`
  - `changed`

Asset operations:

- status `200`
- body:
  - `folderId`
  - `requestedCount`
  - `changedCount`
  - `noopCount`

### Error codes

- `401 unauthenticated`
- `403 no_tenant_membership`
- `403 media_library_forbidden`
- `400 invalid_body`
- `400 invalid_folder_name`
- `400 invalid_media_library_asset_ids`
- `404 folder_not_found`
- `404 media_library_asset_not_found`
- `409 folder_name_conflict`
- `409 folder_archived`
- `409 media_library_asset_already_assigned`

### Service locations

Add new bounded modules:

- `src/lib/media-library/media-library-folder-service.ts`
- `src/lib/media-library/media-library-folder-route-handlers.ts`

Extend existing release read service rather than splitting detail logic:

- keep `getReleaseAssetDetail(...)` in `src/lib/project-releases/project-release-service.ts`
- extend list-side reads there or add a sibling read helper in the same area for folder-aware list loading

## RLS and authorization plan

### Permission boundary

Allowed:

- `owner`
- `admin`
- `reviewer`

Denied:

- `photographer`

### SQL helper plan

Keep existing helper:

- `app.current_user_can_access_media_library(tenant_id)`

Add sibling helper:

- `app.current_user_can_manage_media_library(tenant_id)`

Role set stays the same as read access in this first slice. The extra helper makes policy intent explicit for writes without changing the allowed roles.

### Table policies

`media_library_assets`

- `select` for authenticated via `app.current_user_can_access_media_library(tenant_id)`
- `insert` and `update` for `service_role` only

`media_library_folders`

- `select` for authenticated via `app.current_user_can_access_media_library(tenant_id)`
- `insert`, `update`, and `delete` for authenticated via `app.current_user_can_manage_media_library(tenant_id)`

`media_library_folder_memberships`

- `select` for authenticated via `app.current_user_can_access_media_library(tenant_id)`
- `insert`, `update`, and `delete` for authenticated via `app.current_user_can_manage_media_library(tenant_id)`

### Route-authoritative writes

Even with authenticated write policies:

- route handlers still derive tenant server-side
- route handlers still verify reviewer-capable access through current tenant membership
- route handlers still validate folder archived state and payload shape before writing

Chosen write client split:

- use authenticated `createClient()` writes for folders and memberships so RLS is exercised by the app
- use admin or service-role writes only for `media_library_assets` upsert during release creation

## Media Library read/query plan

### Folder-aware page data

Add a page-data loader that returns:

- active folders for the current tenant
- latest Media Library assets for the tenant
- optional current folder filter
- stable `mediaLibraryAssetId`
- current active folder assignment metadata per item

Two safe shapes are acceptable:

- extend `listMediaLibraryAssets(...)` to accept `folderId?: string | null` and return enriched items
- or add `getMediaLibraryPageData(...)` and keep `listMediaLibraryAssets(...)` as a simpler helper under it

Preferred implementation direction:

- add `getMediaLibraryPageData(...)`

Reason:

- current tests already target `listMediaLibraryAssets(...)`
- a page-data helper can compose folder list plus enriched item list without overloading the old helper too aggressively

### Detail page

- keep `getReleaseAssetDetail(...)` unchanged for release-asset identity and immutable snapshot reads
- add optional folder context handling only at the page layer with a query string like `?folderId=...`

### Feature 077 behavior preservation

Folder filtering must not bypass:

- `deriveMediaLibraryReleaseSafety(...)`
- `buildMediaLibraryUsagePermissionSummaries(...)`
- `buildReleasePhotoOverlaySummary(...)`
- `MediaLibraryDownloadButton`

The list item and detail page should continue to render from the same immutable release snapshot row they do today.

## Exact UI plan

### Page structure

Keep one Media Library page at `/media-library`.

Add a normal two-column layout inside the existing page:

- left sidebar or rail for `All assets`, folder list, and folder management
- main content area for the current asset list

Do not add:

- a new dashboard shell
- a DAM-style asset manager
- hero sections
- nested folder UI

### Sidebar behavior

Show:

- `All assets`
- active folders only
- create-folder action
- per-folder rename action
- per-folder archive action

Archived folders:

- not shown in the first-slice sidebar
- no archived-folder management surface in this feature

### Main list behavior

Keep the current card/list layout.

Add:

- checkbox selection per item
- current folder pill or folder name on the card when assigned
- bulk action bar when one or more items are selected

Bulk actions:

- `Add to folder`
- `Move to folder`
- `Remove from folder`

Behavior by view:

- in all-assets view:
  - show `Add to folder`
  - show `Move to folder`
- in a folder-filtered view:
  - show `Move to folder`
  - show `Remove from folder`

### Detail page behavior

Keep:

- `/media-library/[releaseAssetId]`

Use optional query-string folder context for the back link:

- `?folderId=<folderId>`

If the folder is missing or archived, the back link falls back to `/media-library`.

## Exact i18n plan

Reuse the existing `mediaLibrary.*` namespace in `messages/en.json` and `messages/nl.json`.

Add new keys under `mediaLibrary.list`:

- `sidebar.allAssets`
- `sidebar.foldersTitle`
- `sidebar.emptyFolders`
- `sidebar.createFolder`
- `sidebar.renameFolder`
- `sidebar.archiveFolder`
- `sidebar.archiveConfirm`
- `sidebar.currentFolder`
- `selection.count`
- `selection.clear`
- `selection.addToFolder`
- `selection.moveToFolder`
- `selection.removeFromFolder`
- `selection.noFolder`
- `folderForm.nameLabel`
- `folderForm.namePlaceholder`
- `folderForm.createSubmit`
- `folderForm.renameSubmit`
- `folderForm.cancel`
- `folderMessages.created`
- `folderMessages.renamed`
- `folderMessages.archived`
- `folderMessages.assigned`
- `folderMessages.moved`
- `folderMessages.removed`
- `folderErrors.nameRequired`
- `folderErrors.nameConflict`
- `folderErrors.folderArchived`
- `folderErrors.generic`

No translation changes to stored folder names or release snapshot content.

## Release immutability and finalization boundary

### What does not change

- folders are not required for project finalization
- folders are not required for release creation
- folders never mutate `project_releases`
- folders never mutate `project_release_assets`
- folder operations do not reopen correction or affect project workflow state

### Minimal release hook

Add one new helper inside the release snapshot build path:

- `upsertMediaLibraryAssetsForReleaseRows(...)`

Inputs:

- `tenantId`
- `projectId`
- `actorUserId`
- built `releaseAssetRows`

Behavior:

- extract unique `(tenant_id, project_id, source_asset_id)` from release asset rows
- insert missing `media_library_assets` rows with `created_by = actorUserId`
- use conflict-safe no-op upsert

Why this is the smallest safe hook:

- it reuses the existing release seam where assets become released media
- it does not affect release versioning rules
- it remains retry-safe for release repair

## DAM compatibility considerations

Feature 078 deliberately does not add:

- DAM export state
- sync jobs
- external DAM IDs
- DAM delivery status tables

Identifiers that remain explicit after Feature 078:

- `tenant_id`
- `project_id`
- `workspace_id`
- `release_id`
- `project_release_assets.id`
- `source_asset_id`
- `media_library_assets.id`

Future DAM mode can later consume immutable release rows independently of built-in folders:

- releases stay the publication truth
- built-in folders stay optional tenant organization metadata
- a DAM-backed tenant could ignore folders entirely or map stable library identities to DAM objects without changing release snapshot creation

## Security and reliability considerations

### Tenant isolation

- every new table stores `tenant_id`
- every route derives tenant from `resolveTenantId(...)`
- every query scopes to the derived tenant
- composite tenant-aware foreign keys prevent accidental cross-tenant references

### Active tenant switching

- folder list and membership reads always use the active tenant only
- switching active tenant changes the visible folder set and asset assignment set with no cross-tenant leakage

### Retry and no-op expectations

- create folder: unique active-name constraint prevents duplicates
- rename folder: renaming to the current normalized name is a no-op
- archive folder: archiving an already archived folder is a no-op
- add assets: duplicates in the same folder are no-op; existing membership in another folder conflicts
- move assets: repeated move to the same folder is no-op
- remove assets: repeated remove is no-op

### Race cases

Two users add the same asset to the same folder:

- unique membership constraint plus insert-or-ignore semantics resolve to one row

Folder archived while another user adds or moves assets:

- write transaction rechecks active folder state
- result is `409 folder_archived`

Release v2 publishes while a user organizes v1 assets:

- stable identity allows the user action to still target the same library asset
- if the asset remains released in v2, current folder views naturally show v2

Asset removed from latest release by correction:

- stable identity and membership remain
- current views stop showing it

### Audit fields

Use audit fields on folder and membership tables as record history, not ownership boundaries:

- `created_at`, `created_by`
- `updated_at`, `updated_by`
- `archived_at`, `archived_by` on folders

## Edge cases

- empty tenant folder list should still show `All assets` and a simple create-folder affordance
- creating a folder whose name differs only by case from an active folder should fail with `folder_name_conflict`
- archived-folder memberships should behave as dormant and not appear as active folder assignment in current views
- assets created before a local reset do not need compatibility handling; fresh-state validation after `supabase db reset` is sufficient
- direct historical detail URLs remain valid even if the current folder view no longer surfaces that asset
- download warnings remain advisory only; folder views do not change server-side download authorization

## Test plan

### Schema and migration tests

Add tests covering:

- `media_library_assets` unique `(tenant_id, project_id, source_asset_id)`
- `media_library_folders` case-insensitive unique active name per tenant
- folder archive shape constraint
- `media_library_folder_memberships` unique one-folder-per-asset rule
- no DAM fields on the new tables

### RLS tests

Add tests covering:

- reviewer can select folders and memberships
- reviewer can create, rename, archive, add, move, and remove through authenticated client writes
- photographer cannot read or write new folder tables
- cross-tenant folder and membership rows stay invisible

### Release and stable-identity tests

Add tests covering:

- release v1 creation upserts `media_library_assets`
- correction re-release v2 reuses the same `media_library_assets` row for the same `source_asset_id`
- old `project_releases` and `project_release_assets` rows remain unchanged
- stable identities are created for photo and video release assets only

### Service tests

Add tests for new folder service helpers:

- create folder
- rename folder
- archive folder
- add assets to folder
- move assets between folders
- remove assets from folders
- duplicate add idempotency
- repeated move idempotency
- repeated remove idempotency
- archived target folder conflict

### Route tests

Add route-handler tests covering:

- `401` unauthenticated
- `403` photographer denied
- `404` cross-tenant folder not found
- `409` folder name conflict
- `409` archived target folder
- batch operation response counts and no-op behavior

### UI tests

Add tests covering:

- sidebar renders `All assets` plus folder list
- folder filter preserves current list card layout
- selection bar exposes add, move, and remove actions
- detail back link preserves folder query-string context when present
- existing Feature 077 badges and warnings still render in folder-filtered views

### Regression coverage to preserve

Re-run and extend relevant behavior from:

- `tests/feature-074-project-release-media-library.test.ts`
- `tests/feature-074-media-library-download.test.ts`
- `tests/feature-075-project-correction-workflow.test.ts`
- `tests/feature-077-media-library-release-helpers.test.ts`
- `tests/feature-077-media-library-ui.test.ts`

Add explicit Feature 078 regression assertions for:

- owner, admin, reviewer allowed
- photographer denied
- cross-tenant folder isolation
- create, rename, archive folder
- add, move, remove membership
- latest-release folder carry-forward after v2
- old release rows remain immutable
- release asset rows are not mutated by folder organization
- folder archive does not delete released assets
- Feature 077 download warning still works from folder-filtered views
- active tenant switching isolates folders and memberships

## Implementation phases

### Phase 1 - schema and permission foundation

- add migration for `media_library_assets`, `media_library_folders`, `media_library_folder_memberships`
- add SQL helper `app.current_user_can_manage_media_library(...)`
- add RLS policies and indexes
- add migration-focused tests

### Phase 2 - stable identity and read-model foundation

- add stable identity upsert helper inside `ensureProjectReleaseSnapshot(...)`
- add read helpers for folders and folder-aware latest asset resolution
- extend Media Library list-item types with `mediaLibraryAssetId` and current folder assignment
- add release carry-forward and immutability tests

### Phase 3 - folder write APIs and services

- implement folder CRUD service helpers
- implement add, move, and remove membership helpers
- add explicit route handlers under `/api/media-library/folders/**`
- add route and service tests for permissions, idempotency, and conflicts

### Phase 4 - UI and i18n

- add folder sidebar, create/rename/archive affordances, selection state, and bulk actions to the existing Media Library page
- keep detail route unchanged and add optional folder-context back link
- add EN and NL message keys
- add UI regression tests

### Phase 5 - regression validation

- run the relevant Feature 074, 075, 077, and Feature 078 tests together
- verify that folder actions do not mutate release rows
- verify active-tenant isolation and photographer denial remain intact

## Open implementation notes

These are no longer plan-level decisions, but implementation details to keep deliberate:

- normal all-assets and folder-filtered reads should ignore archived folders and dormant archived-folder memberships
- no compatibility or backfill path is planned for arbitrary pre-reset local release data
- `description` is intentionally deferred to keep the first slice bounded

## Concise implementation prompt

Implement Feature 078 by adding tenant-scoped flat `Folders` to the existing Media Library using three new tables: `media_library_assets`, `media_library_folders`, and `media_library_folder_memberships`. Keep `project_releases` and `project_release_assets` immutable. Create or upsert `media_library_assets` during release snapshot creation using the stable key `(tenant_id, project_id, source_asset_id)`, and derive latest release asset resolution at read time. Keep one active folder membership per stable library asset, archive folders instead of hard-deleting them, preserve the existing `/media-library` and `/media-library/[releaseAssetId]` routes, and add minimal sidebar plus bulk-action UI inside the current Media Library page. Route handlers must derive tenant server-side, allow only owner/admin/reviewer, deny photographers, preserve Feature 077 safety and download behavior, and include tests for schema, RLS, folder lifecycle, idempotency, latest-release carry-forward, immutability, and active-tenant isolation.
