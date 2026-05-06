# Feature 100 Research - Media Library UI/UX Refresh

## Status

Research only. No application code, migrations, tests, or UI behavior were changed.

## Inputs reviewed

Required top-level inputs:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/SUMMARY.md`
- `docs/rpi/PROMPTS.md`
- `docs/rpi/README.md`
- `UNCODEXIFY.md`

Missing requested root inputs:

- Root `SUMMARY.md` was not present. The available summary is `docs/rpi/SUMMARY.md`.
- Root `PROMPTS.md` was not present. The available prompt guide is `docs/rpi/PROMPTS.md`.

Prior RPI docs reviewed as context:

- `docs/rpi/074-project-release-package-and-media-library-placeholder/`
- `docs/rpi/077-media-library-asset-safety-and-release-detail-review-context/`
- `docs/rpi/078-organization-scoped-media-library-folders-and-organization-foundation/`
- `docs/rpi/079-project-correction-media-intake-and-release-asset-additions/`
- `docs/rpi/085-custom-role-media-library-enforcement/`
- `docs/rpi/096-permission-cleanup-and-effective-access-ui/`
- `docs/rpi/097-project-zip-export-cleanup/`
- `docs/rpi/008-asset-thumbnails/`
- `docs/rpi/038-original-image-ingest-and-display-derivatives/`
- `docs/rpi/040-asset-display-derivatives-reliability/`
- `docs/rpi/062-video-upload-foundation/`
- `docs/rpi/063-video-asset-preview-playback-and-thumbnails/`
- `docs/rpi/063a-video-poster-thumbnail-performance-investigation/`

Live implementation inspected:

- Protected pages:
  - `src/app/(protected)/media-library/page.tsx`
  - `src/app/(protected)/media-library/[releaseAssetId]/page.tsx`
- Media Library components:
  - `src/components/media-library/media-library-folder-browser.tsx`
  - `src/components/media-library/media-library-download-button.tsx`
  - `src/components/media-library/released-photo-preview.tsx`
  - `src/components/media-library/released-photo-review-surface.tsx`
  - `src/components/media-library/release-safety-badges.tsx`
  - `src/components/media-library/release-safety-banner.tsx`
  - `src/components/media-library/release-usage-permissions.tsx`
- API routes:
  - `src/app/api/media-library/assets/[releaseAssetId]/download/route.ts`
  - `src/app/api/media-library/folders/route.ts`
  - `src/app/api/media-library/folders/[folderId]/route.ts`
  - `src/app/api/media-library/folders/[folderId]/archive/route.ts`
  - `src/app/api/media-library/folders/[folderId]/add-assets/route.ts`
  - `src/app/api/media-library/folders/[folderId]/move-assets/route.ts`
  - `src/app/api/media-library/folders/[folderId]/remove-assets/route.ts`
- Services and helpers:
  - `src/lib/project-releases/project-release-service.ts`
  - `src/lib/project-releases/media-library-download.ts`
  - `src/lib/media-library/media-library-folder-service.ts`
  - `src/lib/media-library/media-library-folder-route-handlers.ts`
  - `src/lib/tenant/media-library-custom-role-access.ts`
  - `src/lib/assets/sign-asset-thumbnails.ts`
  - `src/lib/assets/sign-asset-playback.ts`
  - `src/lib/assets/asset-image-derivatives.ts`
- Migrations:
  - `supabase/migrations/20260424130000_074_project_releases_media_library_foundation.sql`
  - `supabase/migrations/20260425120000_078_media_library_folders_foundation.sql`
  - `supabase/migrations/20260430130000_082_reviewer_access_assignment_enforcement.sql`
  - `supabase/migrations/20260430150000_085_media_library_custom_role_enforcement.sql`
  - `supabase/migrations/20260501130000_094_scoped_custom_role_capability_helper.sql`
  - `supabase/migrations/20260407133000_038_asset_image_derivative_pipeline.sql`
- Tests:
  - `tests/feature-074-media-library-download.test.ts`
  - `tests/feature-074-project-release-media-library.test.ts`
  - `tests/feature-077-media-library-release-helpers.test.ts`
  - `tests/feature-077-media-library-ui.test.ts`
  - `tests/feature-078-media-library-folders.test.ts`
  - `tests/feature-078-media-library-folder-routes.test.ts`
  - `tests/feature-078-media-library-ui.test.ts`
  - `tests/feature-085-custom-role-media-library-enforcement.test.ts`
  - `tests/feature-038-asset-image-derivatives.test.ts`
  - `tests/feature-063-video-asset-preview-playback-and-thumbnails.test.ts`
- i18n:
  - `messages/en.json`
  - `messages/nl.json`
- Dependencies:
  - `package.json`
  - `node_modules/@supabase/storage-js` type/runtime docs for signed URL `download` option

## Verified current Media Library behavior

The protected Media Library is a released-snapshot consumption surface, not a live project asset surface. The list page calls `getMediaLibraryPageData`, which ultimately reads latest published `project_releases` per project and their `project_release_assets`. Detail pages call `getReleaseAssetDetail` by released asset ID.

Release snapshots remain immutable. Folder organization uses stable rows in `media_library_assets`, `media_library_folders`, and `media_library_folder_memberships`; folder changes do not update `project_release_assets` or release snapshots.

The list page currently renders:

- a header section with title and explanatory subtitle;
- a folder sidebar;
- a create-folder form for users with folder management permission;
- a single row/list-style asset list;
- per-asset checkbox selection when folder management is allowed;
- per-asset `Open` and `Download original` actions.

The detail page currently renders:

- back link to the list, optionally preserving `folderId`;
- release safety warning/banner where relevant;
- release asset metadata;
- `Download original` action;
- photo preview with release-snapshot face overlays and linked owner focus;
- video playback using a signed original video playback URL and poster preview if available;
- usage permission summaries.

Folders are shown as a flat list. There is no nested tree, no `parent_folder_id`, and no drag/drop folder interactions.

Assets are shown as list rows. There is no grid/list switch and no Media Library pagination today.

Existing selection is checkbox-based and client-side only:

- `selectedAssetIds` stores stable `media_library_assets.id` values in local React state.
- Selection controls are hidden unless `canManageFolders` is true.
- Batch actions are `Add to folder`, `Move to folder`, `Remove from folder`, and `Clear`.
- Selection resets after successful mutations and when the component remounts; it is not persisted in URL or database.

## Current pages and components

List page:

- `src/app/(protected)/media-library/page.tsx`
  - resolves auth user and active tenant server-side;
  - calls `getMediaLibraryPageData`;
  - signs one preview URL per returned item;
  - passes a client-side item model into `MediaLibraryFolderBrowser`.

Detail page:

- `src/app/(protected)/media-library/[releaseAssetId]/page.tsx`
  - resolves auth user and active tenant server-side;
  - calls `getReleaseAssetDetail`;
  - signs a display preview;
  - signs video original playback URL for videos;
  - validates optional `folderId` for the back link.

Folder/list client component:

- `src/components/media-library/media-library-folder-browser.tsx`
  - owns all folder UI state and mutation fetches;
  - uses `window.alert`, `window.confirm`, and `window.prompt`;
  - has no drag/drop state;
  - has no pagination state;
  - has no view-mode state;
  - has no marquee state;
  - uses text buttons for folder rename/archive and asset open/download.

Download button:

- `src/components/media-library/media-library-download-button.tsx`
  - renders a direct `Link`;
  - only gates advisory confirmation in `onClick`;
  - does not set an HTML `download` attribute;
  - does not distinguish open-original from download behavior.

Photo preview:

- `released-photo-preview.tsx` uses `PreviewableImage` with the same signed preview URL for inline and expanded image preview.

Current UI state split:

- Server-derived: auth, tenant, Media Library authorization, folder summaries, current folder, release asset rows, stable asset identity, preview URLs.
- Client-side: create folder input, selected asset IDs, target folder select, busy flag, folder mutation prompt/confirm state.
- URL-derived: only `folderId` on the list and detail back-link context.

## Current routes and services

Media Library download/open:

- `GET /api/media-library/assets/[releaseAssetId]/download`
- Route delegates to `createMediaLibraryAssetDownloadResponse`.
- Service authenticates user, resolves tenant server-side, calls `getReleaseAssetDetail`, signs original source storage object with a service-role storage client, and returns `Response.redirect(signedUrl, 302)`.

Folder routes:

- `POST /api/media-library/folders`
  - create folder
- `PATCH /api/media-library/folders/[folderId]`
  - rename folder
- `POST /api/media-library/folders/[folderId]/archive`
  - soft archive folder
- `POST /api/media-library/folders/[folderId]/add-assets`
  - add selected stable assets when they do not already belong to another folder
- `POST /api/media-library/folders/[folderId]/move-assets`
  - move selected stable assets into target folder, creating missing memberships or updating existing memberships
- `POST /api/media-library/folders/[folderId]/remove-assets`
  - delete memberships for selected stable assets currently in the folder

Services:

- `project-release-service.ts`
  - release snapshot creation;
  - stable Media Library asset identity upsert;
  - Media Library list/detail read models;
  - folder enrichment for page data.
- `media-library-folder-service.ts`
  - folder create/rename/archive;
  - batch add/move/remove memberships;
  - explicit Media Library folder authorization;
  - service-role writes after authorization.
- `media-library-folder-route-handlers.ts`
  - shared route auth/body parsing/error shaping.
- `media-library-custom-role-access.ts`
  - TypeScript Media Library authorization and source explanation.

There are existing asset move routes for batch membership updates, but no route that accepts a released asset ID directly and moves it. Drag/drop can call the existing stable-asset move route if the UI has the `mediaLibraryAssetId`; otherwise the route shape would need to resolve release asset IDs to stable asset IDs server-side.

There are no current routes for nested folders or moving folders.

There is no Media Library list API route; the list is loaded by a server component via service functions.

## Current database schema and constraints

Release tables:

- `project_releases`
  - tenant/project scoped;
  - versioned by `(tenant_id, project_id, release_version)`;
  - unique by finalized timestamp;
  - statuses `building` and `published`;
  - immutable-style release snapshot JSON after publication.
- `project_release_assets`
  - tenant/project/workspace/release scoped;
  - one row per released source asset per release;
  - snapshots metadata, workspace, consent, links, review, and scope state;
  - `asset_type` is `photo` or `video`;
  - original storage bucket/path are required.

Stable Media Library identity:

- `media_library_assets`
  - one stable identity per `(tenant_id, project_id, source_asset_id)`;
  - no `archived_at`;
  - no folder fields;
  - created during release snapshot publication.

Folders:

- `media_library_folders`
  - tenant scoped;
  - `name`;
  - created/updated audit fields;
  - `archived_at` and `archived_by` soft-archive fields;
  - active folder names are unique per tenant by `lower(btrim(name))`;
  - no `parent_folder_id`;
  - no path, depth, order, or tree metadata.

Folder memberships:

- `media_library_folder_memberships`
  - tenant scoped;
  - points to stable `media_library_assets`;
  - points to `media_library_folders`;
  - unique `(tenant_id, media_library_asset_id)`.

Important consequences:

- The current model supports flat folders only.
- A stable Media Library asset can belong to at most one folder.
- Assets outside a folder have no membership row.
- Archiving a folder does not delete membership rows. The page loader ignores memberships whose folder is archived by resolving only active folders; archived-folder items appear as unfiled in all-assets view.
- Folder movement into another folder is not representable without an additive migration.
- Dragging an asset into a folder maps cleanly onto `moveMediaLibraryAssetsToFolder`.
- Dragging a folder into another folder requires a new folder hierarchy model.

## Current authorization model

Media Library read access is enforced both in TypeScript and RLS.

Read access requires one of:

- owner/admin fixed role;
- reviewer with tenant-wide reviewer access;
- tenant-scope custom role with `media_library.access`.

Folder management requires one of:

- owner/admin fixed role;
- reviewer with tenant-wide reviewer access;
- tenant-scope custom role with `media_library.manage_folders`.

Important verified details:

- Project-specific reviewer access does not grant Media Library access.
- Project/workspace-scoped custom-role assignments do not grant Media Library access.
- `media_library.manage_folders` alone does not imply read access in TypeScript tests: a manage-only user can pass folder management authorization but cannot load page data or detail.
- Current UI only gets `canManageFolders` after `getMediaLibraryPageData` succeeds, so visible folder management currently implies read access in practice.
- Routes derive tenant from session via `resolveTenantId`; they do not accept `tenant_id` from the client.
- Folder service writes use service-role clients after explicit authorization and tenant validation.
- RLS helper functions are updated by Feature 085 to include custom Media Library capabilities.

Permission implications for Feature 100:

- View mode and pagination require only `media_library.access`.
- Asset drag-to-folder and batch move require `media_library.manage_folders`.
- Folder create/rename/archive/move/nesting require `media_library.manage_folders`.
- Open original and download should require `media_library.access`.
- If batch download is ever added, it should be a new release/Media Library delivery feature, not a restored project ZIP export path.

## Thumbnail and preview behavior

Media Library list:

- `page.tsx` calls `resolveSignedAssetDisplayUrl` with `use: "thumbnail"`.
- For photos, fallback is `"original"`.
- For videos, fallback is `"none"`.
- The helper first attempts a ready `asset_image_derivatives` row for the requested derivative kind.
- If the derivative is ready, the signed URL points at `asset-image-derivatives`.
- If no ready derivative exists:
  - photos fall back to a signed original URL, not a bounded transform in this Media Library code path;
  - videos return no poster URL.

Media Library detail:

- Detail calls `resolveSignedAssetDisplayUrl` with `use: "preview"`.
- For photos, fallback is `"original"`.
- For videos, fallback is `"none"` for poster/preview.
- Videos separately use `signVideoPlaybackUrlsForAssets`, which signs the original private video object for playback.

Derivative foundation:

- `asset_image_derivatives` has `thumbnail` and `preview` rows.
- Current derivative specs are 480px JPEG thumbnail and 1536px JPEG preview.
- Both photo display derivatives and video poster derivatives are generated into `asset-image-derivatives`.
- Tests verify signed display URLs prefer derivative URLs when ready, fall back to transformed original in some project contexts, and queue/process video poster rows.

Safety and performance assessment:

- The Media Library does use worker-created derivatives when they are ready.
- Photos currently have an expensive fallback: original signed URL on list/detail if derivative is missing or not ready. On a large list, this can load full-resolution originals into thumbnails.
- Videos are more conservative for posters: no poster is shown if derivative is not ready, but video detail signs the original for playback.
- The list signs previews for every returned item because there is no pagination. This multiplies service-role storage signing calls and can generate many short-lived URLs per request.
- Signed display URLs are short-lived, service-created, and based on server-loaded rows, not client-provided storage paths.
- The biggest near-term risk is performance, not tenant leakage: unpaginated list rendering plus photo original fallback can be costly.

Recommended preview direction:

- Keep using `resolveSignedAssetDisplayUrl`.
- For list thumbnails, prefer derivative-only or bounded transform fallback, not original fallback.
- Keep video poster fallback as no poster unless there is an intentional product decision to show a generic video tile.
- Add pagination before or alongside any grid view to avoid signing every asset.
- Consider passing `enqueueMissingDerivative: true` only if plan phase accepts route/page-triggered repair behavior for Media Library.

## Current download/open-original behavior

The current `Download original` action is a normal link to `/api/media-library/assets/[releaseAssetId]/download`.

The route:

1. Authenticates the user.
2. Resolves tenant server-side.
3. Loads release asset detail with Media Library read authorization.
4. Signs the original storage object for 120 seconds.
5. Returns a 302 redirect to the signed storage URL.

The route does not set `Content-Disposition: attachment` itself. The current Supabase `createSignedUrl(path, expiresIn)` call does not pass `download: true` or a download filename. Local installed `@supabase/storage-js` supports `createSignedUrl(path, expiresIn, { download: true | string })`, which appends a `download` query parameter to trigger download behavior.

Why the browser opens instead of downloads:

- The browser follows the 302 to Supabase Storage.
- Supabase serves images/videos with displayable content types.
- Without download disposition/query behavior, browsers commonly render image/video assets inline in the same or a new tab.
- The UI label says download, but the route behaves like "open signed original URL".

Fix options:

- Option A: keep redirect route and call `createSignedUrl(path, 120, { download: detail.row.original_filename })`.
  - Smallest code change.
  - Uses installed Supabase Storage API support.
  - Still exposes a short-lived signed URL after redirect.
  - Should be tested by asserting the signed URL includes a download query parameter or by stubbing options in unit tests.
- Option B: add a server-side download proxy route that fetches storage and returns `Content-Disposition: attachment`.
  - Stronger header control.
  - More server bandwidth and complexity.
  - Better if Supabase download query behavior is unreliable across file types.
- Option C: split routes/actions:
  - `Open original` route signs without download.
  - `Download` route signs with download or streams attachment.
  - UI makes behavior explicit.
- Option D: relabel current action to `Open original`.
  - Accurate, but does not satisfy the reported download issue.

Recommended direction:

- Add separate UI actions: `Open original` and `Download`.
- Implement `Download` first using Supabase signed URL `download` option unless tests or manual validation prove headers are insufficient.
- Keep `Open original` as a separate route or signed redirect without `download`.
- Both actions should require `media_library.access` and keep the existing advisory confirmation for blocked/restricted release state.

## Drag-and-drop feasibility

Existing dependency support:

- `@dnd-kit/core`, `@dnd-kit/sortable`, and `@dnd-kit/utilities` are already installed.
- Current usage is in template editors for sortable lists.
- There is no existing Media Library drag/drop code.
- There is no marquee selection library in dependencies.

Asset drag into folder:

- Feasible without schema changes.
- UI can make each asset card/row draggable by stable `mediaLibraryAssetId`.
- Folder sidebar items can be droppable targets.
- Drop handler can call existing `POST /api/media-library/folders/[folderId]/move-assets` with one or many selected stable asset IDs.
- If the dragged asset is selected, drop should move the selected set. If not selected, drop should move only the dragged asset.
- Invalid targets: no stable asset identity, archived folder, current folder when it would be a no-op, or lack of `canManageFolders`.
- Server remains authoritative: target folder must be active and tenant-scoped; asset IDs must exist in the tenant.

Folder drag into folder:

- Not feasible with current schema.
- Needs additive folder hierarchy migration first.
- UI can later use `@dnd-kit/core` droppable folder rows.
- A folder move route must validate tenant, authorization, active source/target folders, and cycle prevention.

Smallest maintainable asset-drag approach:

- Use explicit drag handles or a clear "move mode" so ordinary row/card dragging does not conflict with selection and marquee behavior.
- Reuse existing `move-assets` endpoint for dropped assets.
- Keep optimistic UI modest: update selection/busy state immediately, refresh server data after success, rollback on error by preserving old state until refresh.
- Do not allow client-provided tenant IDs or storage paths.
- Use idempotent move semantics already in `moveMediaLibraryAssetsToFolder`.

Race and failure cases:

- Folder archived while drop is in progress: service returns `409 folder_archived`; UI should show error and refresh.
- Asset moved by another user concurrently: current move route updates current membership to target and is retry-safe; last writer wins.
- Asset already in target folder: no-op count.
- Asset selected but no longer exists in stable Media Library identity table: service returns 404.
- Cross-tenant asset ID included: service sees missing asset under current tenant and returns 404.

## Folder nesting feasibility

Current model is flat. Folder nesting requires an additive migration.

Smallest schema option:

- Add nullable `parent_folder_id uuid` to `media_library_folders`.
- Add composite FK `(parent_folder_id, tenant_id)` referencing `media_library_folders(id, tenant_id)`.
- Keep `null` as root.
- Add indexes on `(tenant_id, parent_folder_id, name)` and active root/child lookups.
- Change active name uniqueness from tenant-wide to sibling-level:
  - unique root names by `(tenant_id, lower(btrim(name))) where parent_folder_id is null and archived_at is null`;
  - unique child names by `(tenant_id, parent_folder_id, lower(btrim(name))) where parent_folder_id is not null and archived_at is null`.

Cycle prevention options:

- Service-level recursive CTE inside a transaction/RPC.
- Database trigger that rejects setting a folder parent to itself or any descendant.
- Closure table.
- Materialized path.

Recommended first nesting model:

- Use a parent pointer plus a transactional SQL RPC or trigger for cycle prevention.
- Avoid closure tables unless the plan requires high-volume deep-tree queries.
- Limit nesting depth in service/UI if product does not need arbitrary depth.
- Preserve archived folders as soft-deleted nodes; decide in plan whether archiving a parent hides descendants automatically.

What "moving a folder carries contained assets and child folders" means:

- With a parent pointer, moving a folder should only update that folder's `parent_folder_id`.
- Asset memberships remain attached to their folder.
- Child folders remain attached to their parent.
- No release snapshots or historical evidence are rewritten.

Open schema decisions:

- Should archived child folders remain under archived parents or be independently restorable later?
- Should archive cascade visually only, or write archived state to descendants?
- Should root and child folder names be unique only among siblings?
- Is there a maximum tree depth?
- Should folders support manual ordering, or keep alphabetical order?

## Pagination and grid/list view feasibility

Current Media Library list has no pagination:

- `getMediaLibraryPageData` calls `listMediaLibraryAssets`, which loads latest published releases for all projects and then all release assets for those release IDs.
- It enriches every item with stable identity and membership.
- `page.tsx` signs a preview URL for every returned item.
- The UI renders every returned item.

Existing pagination patterns:

- Project asset list supports limit/offset, cached pages, page summaries, filters, and adjacent preloading in `src/components/projects/assets-list.tsx`.
- Matchable consent asset review supports page/limit route params and `hasNextPage`.

Feasible route/service shape:

- Add server-side pagination parameters to the Media Library page/service:
  - `page` or `offset`;
  - `limit`, bounded to a small set such as 24, 48, 96;
  - `folderId`;
  - optional sort.
- Return:
  - current page items;
  - total count or `hasNextPage`;
  - folder summaries/counts;
  - selected folder.

Implementation complexity:

- The latest-release-per-project logic complicates direct SQL pagination because the service currently computes latest releases in memory.
- A clean implementation can first compute latest release IDs, then query `project_release_assets` with `.range(...)` and a stable order.
- For folder filtering, resolve stable identities and memberships before or inside the paged query. The plan should avoid loading all assets just to filter a folder if folders can grow large.

View mode:

- Grid/list switching is mostly client/UI state once the item model is paged.
- Smallest useful first version:
  - URL query `view=grid|list`;
  - default to grid for a Drive-like media library;
  - keep list as compact row mode;
  - no persisted user preference in first slice.
- URL state is preferable to local state because it survives reload/back navigation and is easy to test. Persisted preference can wait.

Recommended first page size:

- 24 for grid by default.
- 50 or 48 for list if using one shared page size is acceptable.
- Keep one bounded `limit` parameter for first version to reduce state combinations.

## New folder UI simplification

Current UI:

- Sidebar has `Folders` heading.
- Create form shows:
  - visible label `New folder`;
  - input placeholder `Folder name`;
  - text button `Create`.
- i18n keys:
  - `mediaLibrary.list.folderForm.nameLabel`
  - `mediaLibrary.list.folderForm.namePlaceholder`
  - `mediaLibrary.list.folderForm.createSubmit`
  - `mediaLibrary.list.folderErrors.nameRequired`
  - `mediaLibrary.list.folderMessages.created`
  - matching Dutch keys in `messages/nl.json`.

Simpler UX:

- One compact input with placeholder `New folder` or `Create folder`.
- A square icon button with `+`.
- Keep a visually hidden label or `aria-label` for the input and button.
- Enter submits.
- Escape clears/cancels.
- Validation error should be inline near the input, not only `window.alert`.
- Disable input/button while busy.

Messages likely needed:

- `folderForm.inputAriaLabel`
- `folderForm.createAriaLabel`
- `folderForm.namePlaceholder` changed to `New folder` or `Create folder`
- optional `folderForm.cancelAriaLabel` if an inline cancel appears
- error message keys can be reused initially.

## Rename/archive action UX

Current folder actions:

- Rename and Archive are small text buttons inside every folder row.
- Rename uses `window.prompt`.
- Archive uses `window.confirm`.
- Archive is a soft archive, not permanent deletion.

Current asset actions:

- `Open` text link.
- `Download original` text link.
- No archive/delete asset action exists for Media Library assets.

Icon system:

- `lucide-react` is not in `package.json`.
- Existing icon-like controls use inline SVG in components such as template editors.
- `@dnd-kit` template rows use a drag-handle button with `aria-label` and `title`.

Recommended action pattern:

- Do not remove accessible names.
- Folder row:
  - keep the folder name as the primary click target;
  - use compact icon buttons for rename and archive;
  - use `aria-label` and `title`/tooltip text from i18n;
  - use pencil for rename;
  - use archive box icon, not trash, because the operation is soft archive and reversible in data terms only if future UI exposes restore.
- Asset row/card:
  - icon button or text+icon for open original/download depending on available space;
  - keep visible text in list mode if it improves scanability;
  - icon-only is more appropriate in grid cards if tooltips/labels are present.

Important semantic note:

- Do not introduce an asset trash/archive icon unless an actual Media Library asset archive feature is added. Current archive only applies to folders.

## Multi-select and marquee selection feasibility

Current selection:

- Checkbox-based multi-select already exists for assets.
- It applies to assets only, not folders.
- It is only available to folder managers.
- It supports batch folder add/move/remove.
- It does not support shift-click, cmd/ctrl-click, marquee selection, keyboard range selection, or select-all.
- Selection is local component state and uses stable Media Library asset IDs.

Existing selection patterns elsewhere:

- `consent-asset-matching-panel.tsx` uses local `selectedAssetIds` and checkbox selection for building review queues.
- Project asset list has pagination state but not a reusable generic selection manager.
- There is no shared selection-state abstraction.

No marquee library is installed.

Interaction conflict with drag-to-move:

- Full-card drag for move conflicts directly with drag-to-select/marquee.
- On pointer down over an asset tile, the UI needs one clear interpretation:
  - click selects/opens;
  - drag moves;
  - drag draws a selection rectangle.
- Without an explicit mode or drag handle, users will accidentally move assets when trying to select, or select when trying to move.

Selection design options:

- Checkbox-based multi-select:
  - Already implemented.
  - Best accessibility baseline.
  - Works on mouse, touch, and keyboard.
  - Lowest implementation risk.
- Shift/Cmd/Ctrl click:
  - Natural file-manager supplement.
  - Requires stable visible ordering and range selection behavior.
  - Works best after pagination/view-mode order is defined.
- Explicit selection mode:
  - A toolbar toggle such as `Select`.
  - In selection mode, click toggles assets and drag marquee selects.
  - Outside selection mode, drag handles or drag gestures can move assets.
  - Best way to avoid ambiguity.
- Full marquee plus drag/drop movement:
  - Highest UX complexity.
  - Needs pointer capture, hit testing, scroll behavior, touch fallback, keyboard fallback, and tests.
  - Should not be bundled with first pagination/grid/list work.

Recommended first-version selection behavior:

- Keep assets-only selection.
- Keep checkboxes always available in grid/list for folder managers.
- Add a top-level `Select` mode only if visual clutter becomes a problem.
- Add `Select all on page`, `Clear selection`, and selected count in the toolbar.
- Consider Shift-click range selection after pagination ordering is stable.
- Defer marquee selection to a follow-up after basic grid/list, pagination, and asset drag-to-folder are stable.

Batch action recommendations:

- First version:
  - move selected assets into a folder;
  - remove selected assets from current folder;
  - clear selection;
  - optionally add selected assets to folder only if the add-vs-move distinction remains clear.
- Do not add batch asset archive until the product defines Media Library asset archive semantics.
- Do not add batch download in this feature; ZIP export was removed and bulk delivery should be a separate release/Media Library/DAM decision.

Selection across pagination:

- Safest first version: selection is page-local and resets on folder/page/filter changes.
- If selection persists across pages, the UI must show hidden selected count and provide a way to review selected assets. That is more complex and should be deferred.

Accessibility:

- Checkboxes provide keyboard and screen-reader access.
- Marquee selection must not be the only way to multi-select.
- Drag/drop must have keyboard alternatives, likely select assets then choose `Move to folder`.
- Icon-only actions need accessible labels and visible focus states.
- Touch should prefer checkboxes/action menus over precision marquee.

## Options considered

Option 1: One large Feature 100 for all requested behavior.

- Pros: one cohesive UI refresh.
- Cons: combines pagination, view modes, download route behavior, selection, asset drag/drop, folder nesting schema, folder drag/drop, and accessibility changes. Too much risk for one PR-sized cycle.

Option 2: UI/read cleanup first, then organization mechanics.

- Pros: fixes current performance and clarity problems before adding drag/drop complexity.
- Cons: users wait longer for folder nesting and drag/drop.

Option 3: Asset drag/drop first using existing flat folder model.

- Pros: gives immediate Drive-like movement without migration.
- Cons: current list is still unpaginated and not grid-like; marquee conflict remains unresolved.

Option 4: Nested folders first.

- Pros: unblocks folder-to-folder drag.
- Cons: adds schema and cycle prevention before the basic Media Library UI is more scalable; larger blast radius.

Option 5: Download/open-original route cleanup first.

- Pros: small, high-confidence fix for reported behavior.
- Cons: does not improve library browsing.

## Recommended bounded direction

Feature 100 should be split. The full request is too large for one safe implementation cycle.

Recommended order:

1. `100A - Media Library browse cleanup`
   - Add server-side pagination.
   - Add grid/list view query state.
   - Keep existing checkbox selection but improve toolbar placement.
   - Simplify create-folder UI.
   - Replace folder rename/archive text buttons with accessible icon buttons.
   - Fix `Download` vs `Open original` behavior.
   - Keep flat folders.
   - No marquee selection.
   - No folder drag/drop.
2. `100B - Asset drag-to-folder`
   - Use `@dnd-kit/core`.
   - Drag one asset or selected assets into flat folder targets.
   - Reuse `move-assets`.
   - Preserve checkbox selection as keyboard/touch fallback.
   - Avoid full-card drag if marquee is still planned; prefer drag handle or explicit move mode.
3. `100C - Nested folders and folder drag-to-folder`
   - Add `parent_folder_id` and cycle prevention.
   - Add folder move route.
   - Render tree with indentation/collapse if needed.
   - Move folders by parent pointer only.
4. `100D - Advanced multi-select/marquee`
   - Add explicit selection mode and marquee drag-to-select.
   - Add shift-click/cmd-click if desired.
   - Keep selection page-local unless a later plan proves cross-page selection is needed.

If the product wants fewer RPI folders, combine download cleanup into `100A` because it is small and user-visible. Do not combine nested folders and marquee selection with `100A`.

## Risks and tradeoffs

Pagination risks:

- Current service sorts in memory after loading all assets. Pagination should avoid signing and rendering all items, but moving the sort/filter into a bounded query needs care.
- Folder counts may still need aggregate reads. Counts should not force loading every release asset into memory for large tenants.

Grid/list risks:

- Grid cards need concise metadata and accessible actions without losing release safety context.
- Text and buttons must remain responsive and avoid UI overlap.

Preview risks:

- Photo original fallback can be expensive in grid view.
- Derivative-only list previews may show more placeholders while workers catch up.
- Enqueue-on-view repair could create noisy background work if not bounded.

Drag/drop risks:

- Pointer interactions can conflict with selection and opening detail pages.
- Optimistic moves can become stale under concurrent folder changes.
- Drag/drop must not be the only interaction for moving assets.

Nested folder risks:

- Cycle prevention must be enforced server-side/database-side.
- Name uniqueness must be redefined from tenant-wide to sibling-level if Drive-like folders are desired.
- Archiving parent folders needs clear semantics for children and memberships.

Download risks:

- Supabase `download` query behavior should be tested against images and videos.
- A redirect-based download route has less header control than a proxy.
- A proxy route increases server bandwidth and complexity.

Authorization risks:

- `media_library.manage_folders` currently does not imply read access in TypeScript. UI surfaces should continue to require successful page read before folder controls render.
- If new routes are added for folder moves, batch moves, or selection-derived operations, each must derive tenant server-side and call the right authorizer.

## Edge cases and race conditions

Asset move retries:

- Existing `moveMediaLibraryAssetsToFolder` is mostly retry-safe.
- Repeating a move to the same folder returns no-op counts.
- Missing memberships are upserted; existing memberships are updated.

Concurrent asset moves:

- Current behavior is last writer wins.
- Plan phase should decide whether to accept last-writer-wins or add expected-current-folder conflict checks.

Add vs move:

- `add-assets` conflicts if an asset belongs to another folder.
- `move-assets` moves from any current folder into target.
- UI should make these semantics clear or collapse to only `Move to folder` for Drive-like behavior.

Folder archive during move:

- Existing services reject archived target/current folders with `409 folder_archived`.
- UI should refresh after 409.

Archived folders:

- Current archive hides folders from navigation and causes their memberships to be ignored in page enrichment.
- Membership rows remain.
- If folders become nested, archiving parent behavior must be specified.

Folder move retries:

- Future folder moves should be idempotent: moving folder A under B twice should no-op the second time.
- Moving a folder to the same parent should no-op.
- Moving into itself or descendant must be rejected.

Cycle prevention:

- Must not rely only on client tree state.
- Should be enforced in a transactional server operation or database trigger/RPC.

Selection:

- Page changes should clear selection in first version.
- If an asset disappears after move/filter/pagination, selection should drop that ID.
- Batch actions should disable while busy and refresh after success/failure.

Download:

- Expired signed URL is expected after TTL; user can request a new route URL.
- Missing original storage object returns current explicit `409 release_asset_source_missing`.
- Content-Disposition behavior differs by browser and file type; test image and video manually after implementation.

## Testing considerations

Existing relevant tests:

- Download auth/redirect/missing source:
  - `tests/feature-074-media-library-download.test.ts`
- Release snapshots and Media Library list/detail:
  - `tests/feature-074-project-release-media-library.test.ts`
  - `tests/feature-077-media-library-release-helpers.test.ts`
- Folder service and route behavior:
  - `tests/feature-078-media-library-folders.test.ts`
  - `tests/feature-078-media-library-folder-routes.test.ts`
- Folder UI rendering:
  - `tests/feature-078-media-library-ui.test.ts`
- Custom-role enforcement:
  - `tests/feature-085-custom-role-media-library-enforcement.test.ts`
- Derivatives:
  - `tests/feature-038-asset-image-derivatives.test.ts`
  - `tests/feature-063-video-asset-preview-playback-and-thumbnails.test.ts`

Likely new tests for `100A`:

- Media Library page/service returns only a bounded page of assets.
- Pagination preserves tenant scoping and latest-release-per-project behavior.
- Folder filter with pagination returns correct page and counts.
- Grid/list view state renders expected controls.
- Compact folder form uses new i18n keys and accessible labels.
- Icon folder actions render accessible names and no longer rely on visible verbose buttons.
- Download route signs with `download` option or proxy route sets `Content-Disposition: attachment`.
- Open-original route, if added, signs without download disposition.
- Photo/video preview state does not fall back to full originals in thumbnail grid unless explicitly chosen.

Likely new tests for `100B`:

- Route/service batch move remains authorized by `media_library.manage_folders`.
- Drag handler chooses selected assets when dragging a selected item.
- Drag handler chooses only dragged asset when it is not selected.
- Archived/missing folder errors are surfaced and refresh is triggered.
- Access-only users do not see drag/drop move affordances.

Likely new tests for `100C`:

- Migration applies cleanly from reset.
- Folder parent pointer is tenant scoped.
- Sibling name uniqueness works.
- Moving folder under itself is rejected.
- Moving folder under descendant is rejected.
- Moving folder under valid target is idempotent and does not rewrite asset memberships.
- Archived parent/child behavior matches chosen semantics.
- Cross-tenant folder move is rejected.

Likely new tests for `100D`:

- Selection mode toggles visual selected state.
- Shift-click selects range in current page.
- Clear selection resets state.
- Page/folder change resets selection if page-local behavior is chosen.
- Batch move uses selected IDs only.
- Keyboard selection remains possible without marquee.

Validation commands after implementation:

- `npm run lint`
- `npm test -- tests/feature-074-media-library-download.test.ts tests/feature-078-media-library-folders.test.ts tests/feature-078-media-library-folder-routes.test.ts tests/feature-078-media-library-ui.test.ts tests/feature-085-custom-role-media-library-enforcement.test.ts`
- Add any new Feature 100 tests to the targeted command.
- For schema changes in `100C`: `supabase db reset`
- For broad UI changes: `npm run build` if practical.

## Explicit open decisions for plan phase

1. Should this folder be renumbered because `docs/rpi/100-real-smtp-email-dispatch/` already exists?
2. Should `100A` include the download/open-original fix, or should that be a separate small RPI slice?
3. Should Media Library thumbnail fallback for photos be derivative-only, bounded transform, or current original fallback?
4. Should the first grid/list state live in the URL (`view=grid|list`)?
5. What page size should be used for first pagination?
6. Should folder counts remain exact, or can they be approximate/loaded separately for performance?
7. Should the UI keep both `Add to folder` and `Move to folder`, or simplify to `Move to folder`?
8. Should selection stay page-local when pagination lands?
9. Should drag-to-move use a drag handle, explicit move mode, or whole-card drag?
10. Should marquee selection be deferred until after drag-to-folder, or should a selection mode be introduced first?
11. Should nested folder names be unique per sibling rather than per tenant?
12. Should folder nesting have a maximum depth?
13. Should archiving a parent folder hide descendants only visually or archive descendants too?
14. Should folder move cycle prevention live in an RPC, trigger, or service transaction?
15. Should batch download remain out of scope until a dedicated bulk delivery feature?
16. Should an icon library be added, or should the app continue with local inline SVG icons for this slice?

