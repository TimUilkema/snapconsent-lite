# Feature 101 Plan - Media Library Browse UX Refresh

Resolved feature ID: 101

Resolved folder: `docs/rpi/101-media-library-browse-ux-refresh/`

The Media Library research exists at `docs/rpi/100-media-library-ui-ux-refresh/research.md`, but `100` is also occupied by `docs/rpi/100-account-and-organization-onboarding-ux/`. To avoid mixing Media Library work with account onboarding or any other Feature 100 work, this implementation plan uses the next available ID, 101.

## Inputs and Ground Truth

Primary synthesized input:

- `docs/rpi/100-media-library-ui-ux-refresh/research.md`

Required project inputs read before planning:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/SUMMARY.md`
- `docs/rpi/PROMPTS.md`
- `docs/rpi/README.md`
- `UNCODEXIFY.md`

Root `SUMMARY.md` and root `PROMPTS.md` are not present in this repo; the RPI copies under `docs/rpi/` are the available inputs.

Targeted live-code verification for plan-critical details:

- `src/app/(protected)/media-library/page.tsx`
- `src/components/media-library/media-library-folder-browser.tsx`
- `src/lib/project-releases/project-release-service.ts`
- `src/lib/project-releases/media-library-download.ts`
- `src/lib/assets/sign-asset-thumbnails.ts`
- `supabase/migrations/20260425120000_078_media_library_folders_foundation.sql`
- `messages/en.json`
- `messages/nl.json`
- `package.json`

Live code, migrations, and tests remain the source of truth. The research document is treated as the synthesized context for this plan, not as an authority over current code.

## Research Summary

The protected Media Library currently renders latest published release snapshot assets, not mutable live project assets. Folder organization is separate from release snapshots and targets stable rows in `media_library_assets`, preserving release immutability.

The current browse page has no pagination, no grid/list switch, and signs a preview URL for every returned asset. The current thumbnail helper uses worker-created derivatives when ready, but the Media Library list page asks photos to fall back to original files when thumbnails are missing. Videos already use no thumbnail fallback if no derivative is ready.

Folders are flat. The schema has no `parent_folder_id`, and `media_library_folder_memberships` enforces one active folder membership per stable Media Library asset by unique `(tenant_id, media_library_asset_id)`. Existing folder routes already support create, rename, archive, add assets, move assets, and remove assets.

The current folder UI is text-heavy, uses visible `Rename` and `Archive` buttons, and relies on `window.alert`, `window.prompt`, and `window.confirm`. Existing asset multi-select is checkbox-based, local to the client component, and already drives the folder add/move/remove routes.

The current `Download original` route signs the original object and redirects to the signed URL without a download disposition. Browsers therefore open image/video originals inline in a new tab when they can render the file.

## One-Cycle Scope

Implement one bounded "Google Drive-lite" Media Library browse refresh:

- Add server-side Media Library pagination so only one page of assets is rendered and preview-signed.
- Add URL-backed grid/list view mode, defaulting to grid.
- Keep worker-created thumbnails/previews and change list/grid photo thumbnail fallback away from full-resolution originals.
- Replace the verbose folder create form with a compact accessible input plus icon button.
- Replace folder rename/archive text buttons with accessible icon buttons.
- Fix original file actions by splitting open-original and download-original behavior, or by otherwise making the download route actually request download disposition.
- Improve existing checkbox-based multi-select with clearer selected count, page-local select all, and clear selection.
- Optionally add flat asset drag-to-folder as a final phase only if it cleanly reuses the existing `move-assets` route and does not disturb the core scope.

This is not a full file-manager rebuild.

## Deferred Follow-Ups

Explicitly out of scope for Feature 101:

- Nested folders.
- Folder drag-into-folder behavior.
- `parent_folder_id` or closure-table migrations.
- Folder tree and cycle-prevention logic.
- Full marquee draw-over selection.
- Cross-page persistent selection.
- Batch download or ZIP export.
- DAM export or sync behavior.
- Restoring any removed project ZIP export path.
- Media Library asset delete/archive.
- Mutating release snapshots.
- Consent, matching, review, project workflow, RBAC, reviewer access, or photographer assignment redesign.
- A broad generic file-manager abstraction.

Nested folders and full marquee selection should stay in a later RPI after pagination, grid/list, safer thumbnails, and simple folder organization are stable.

## Chosen Architecture

Keep the existing server-rendered Media Library page and the existing client folder browser component boundary.

The server page remains responsible for:

- authenticating the user;
- resolving tenant server-side;
- checking Media Library access through existing service calls;
- parsing safe URL query state;
- loading the requested asset page;
- signing preview URLs only for the returned page of assets;
- passing serialized display data to the client component.

The client component remains responsible for:

- folder browsing UI;
- compact create/rename/archive interactions;
- local page selection state;
- calling existing folder mutation routes;
- optional flat drag-to-folder UI if included.

No new schema is planned. No release snapshot storage is changed.

## Schema Plan

No schema changes.

Reasons:

- Pagination, grid/list mode, compact controls, icon actions, and original download/open behavior do not require schema changes.
- Existing stable Media Library asset identities are sufficient for selection and flat asset movement.
- Existing folder membership constraints are sufficient for one-folder-per-asset semantics.
- Nested folders are out of scope and are the only requested direction that would require a parent pointer or a more complex hierarchy model.

Do not add `parent_folder_id` in this cycle.

## Service and Read Plan

Extend `getMediaLibraryPageData` in `src/lib/project-releases/project-release-service.ts` to accept explicit pagination input:

```ts
type MediaLibraryPageInput = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  folderId?: string | null;
  page?: number;
  limit?: number;
};
```

Return pagination metadata with the existing folder and item data:

```ts
type MediaLibraryPagination = {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  hasPreviousPage: boolean;
  hasNextPage: boolean;
};
```

`MediaLibraryPageData` should include:

- `folders`
- `items`
- `selectedFolderId`
- `selectedFolder`
- `canManageFolders`
- `pagination`

Use one-based `page` in URL and service output. Clamp invalid or missing values to page 1. Allowed limits:

- 24 default
- 48
- 96

If an unsupported `limit` is supplied, use 24 rather than trusting client input. Treat `page < 1`, `NaN`, and non-integer values as page 1.

Preserve current list semantics:

- show only latest published release assets per project;
- keep older release assets available by direct detail links;
- preserve current effective sort order, newest release first, then release asset creation time/id as the stable tie breaker;
- keep folder counts based on active folders and currently visible latest-release assets.

The implementation should avoid signing all tenant asset previews. It should also avoid building the full client item list for all assets just to slice afterward. The preferred shape is:

- resolve and authorize tenant/user as today;
- load active folders and folder access as today;
- resolve latest published release IDs per project as today;
- fetch only the requested page of release assets for all-assets browsing where practical;
- for selected folder browsing, use folder membership to constrain candidate stable asset IDs before building the page;
- enrich only the returned page with stable Media Library asset identity and folder membership;
- compute `totalCount` with a count query or a bounded folder candidate count before page slicing;
- sign previews only for `pageData.items`.

If selected-folder pagination requires a small amount of in-memory candidate resolution because Supabase cannot express the current project/source-asset lineage join cleanly, keep it constrained to the selected folder's stable assets and document the tradeoff in code comments or tests. Do not fall back to signing all tenant assets.

## Route and API Plan

No new list API route is required. The browse page can remain a server component using `searchParams`.

Update accepted list URL params:

- `folderId`: existing optional folder id.
- `page`: optional one-based page number.
- `limit`: optional page size, allow 24, 48, or 96.
- `view`: optional `grid` or `list`.

Folder mutation routes stay in place:

- `POST /api/media-library/folders`
- `PATCH /api/media-library/folders/[folderId]`
- `POST /api/media-library/folders/[folderId]/archive`
- `POST /api/media-library/folders/[folderId]/add-assets`
- `POST /api/media-library/folders/[folderId]/move-assets`
- `POST /api/media-library/folders/[folderId]/remove-assets`

Original file routes:

- Keep `GET /api/media-library/assets/[releaseAssetId]/download`.
- Add `GET /api/media-library/assets/[releaseAssetId]/open` only if the UI needs a separate server-authenticated inline original route.

Refactor shared original signing logic in `media-library-download.ts` so both download and open behavior use the same authorization and detail lookup path. The route must continue to derive tenant server-side and require Media Library read access through `getReleaseAssetDetail`.

## UI and State Plan

Keep `MediaLibraryFolderBrowser` as the main client component, but split presentational pieces inside the same file or nearby component files only if it materially improves readability. Avoid a broad file-manager abstraction.

Primary layout:

- Keep a folder sidebar and main asset area.
- Main area header should hold current folder title, asset count/page summary, grid/list toggle, and pagination controls.
- Use grid as the default view.
- Keep list view for dense scanning.
- Avoid nested cards and decorative layout. Use restrained, operational UI consistent with `UNCODEXIFY.md`.

Client state:

- `selectedAssetIds`: page-local stable Media Library asset IDs.
- `createName`: compact folder input value.
- `createError`: inline validation/mutation error.
- `editingFolderId` and `editingFolderName`: if inline rename replaces prompt.
- `folderActionError`: optional inline error near folder controls.
- `busy`: existing mutation busy state, preferably narrowed by operation where practical.

URL state:

- `folderId`
- `page`
- `limit`
- `view`

Do not persist view preference to a user profile in this cycle. Do not persist selected IDs in the URL.

When changing folder, page, limit, or view:

- preserve valid unrelated params where useful;
- reset `page` to 1 when `folderId` or `limit` changes;
- preserve `folderId` when switching view;
- reset selection in the client component.

## Pagination and View Mode Plan

Default:

- `view=grid`
- `page=1`
- `limit=24`

Allowed view values:

- `grid`
- `list`

Unknown view values should render grid and avoid throwing.

Pagination UI:

- Show previous/next controls.
- Show current page and total pages when `totalCount` is available.
- Show page-size select with 24, 48, 96.
- Disable previous on page 1 and next when `hasNextPage` is false.
- If a requested page is beyond the final page after filtering, render the nearest valid page or redirect to a normalized URL for the last page. Prefer a redirect from the server page to avoid empty invalid pages.

Grid card content:

- thumbnail/poster area with stable aspect ratio;
- asset type;
- original filename;
- project name;
- workspace name;
- release version;
- release created date;
- linked people count;
- folder badge when not already inside that folder;
- checkbox for folder managers;
- open/download actions.

List row content:

- compact thumbnail/poster;
- filename;
- project/workspace;
- release version/date;
- linked people;
- folder;
- checkbox for folder managers;
- open/download actions.

Grid/list switch:

- Use icon-style segmented buttons or compact buttons with accessible names.
- Add i18n labels for `Grid view` and `List view`.
- Use URL links or router navigation that updates `view` without losing `folderId`, `page`, or `limit`.

## Thumbnail and Preview Fallback Plan

For list/grid thumbnails:

- Continue using worker-created display derivatives when `asset_image_derivatives` has a ready `thumbnail`.
- Use `resolveSignedAssetDisplayUrl` or the batch variant with `use: "thumbnail"`.
- For photos, change fallback from `"original"` to `"transform"` so missing derivatives use Supabase image transform with bounded dimensions instead of full-resolution original downloads.
- For videos, keep fallback `"none"` so no original video is loaded as a poster.
- Render the existing preview-unavailable state for missing video posters or failed thumbnail signing.

Prefer the batch signing helper so a page of assets signs in one helper call:

- `resolveSignedAssetDisplayUrlsForAssets` or existing batch helper shape in `sign-asset-thumbnails.ts`.
- Sign only page assets, not all assets in the tenant or selected folder.

Detail page preview behavior is not the main target of this browse cycle. Do not reduce detail-page functionality unless needed to share helper code safely. If detail remains unchanged, note that original fallback is still detail-only, not grid/list thumbnail behavior.

## Compact Folder Creation Plan

Replace the visible three-part create form with:

- one text input;
- placeholder like `New folder`;
- an adjacent square `+` icon button;
- visually hidden or `aria-label` text for both the input and button;
- inline error text below the input row.

Behavior:

- Enter submits.
- Escape clears the input and inline error.
- Empty or whitespace-only names show inline validation.
- Server `name_conflict` and archived/generic errors show inline.
- Success clears the input and refreshes the server data.
- Do not use `window.alert` for create-folder validation or mutation failures.

I18n keys to add or adjust under `mediaLibrary.list.folderForm` and related groups:

- `createPlaceholder`: `New folder`
- `createAriaLabel`: `Folder name`
- `createSubmitAriaLabel`: `Create folder`
- `createSubmitting`: `Creating`
- `clearCreateInput`: `Clear folder name` if a clear button is added

Existing keys can remain if still used:

- `nameLabel`
- `namePlaceholder`
- `createSubmit`
- `renameSubmit`
- `cancel`

## Folder Rename and Archive Icon Plan

Use existing inline SVG patterns; do not add a new icon dependency.

Folder row actions:

- pencil icon button for rename;
- archive box icon button for archive;
- no trash icon because archive is soft-hide behavior, not deletion.

Accessibility:

- Every icon button gets an `aria-label`.
- Use `title` only as a supplemental native tooltip, not as the accessible name.
- Keep visible focus states.
- Keep hit targets large enough for pointer use.

Preferred rename behavior:

- Replace `window.prompt` with inline row editing if the implementation stays reasonably small.
- Editing row shows an input with the current folder name plus save/cancel controls.
- Enter saves, Escape cancels.
- Server validation errors render inline near the row.

If inline rename becomes too large during implementation, keep prompt replacement as a follow-up within the same file, but still convert the visible row action to an accessible icon button. Do not remove accessibility text.

Archive behavior:

- Keep a confirmation step in this cycle.
- It may remain `window.confirm` for the first implementation if no reusable modal pattern exists.
- The action remains archive/soft-hide: it sets `archived_at` and removes the folder from active browse UI; it does not delete assets or release snapshots.

I18n keys to add or adjust:

- `sidebar.renameFolderAriaLabel`: `Rename {name}`
- `sidebar.archiveFolderAriaLabel`: `Archive {name}`
- `folderForm.renameNameAriaLabel`: `Folder name`
- `folderErrors.renameRequired` if a separate rename error is useful

## Download and Open Original Plan

Current problem:

- The `Download original` link points to `/api/media-library/assets/[releaseAssetId]/download`.
- The route signs the original source object and redirects to the signed URL.
- Supabase signed URL is created without a download option or response content-disposition.
- Browsers open renderable images/videos inline.

Chosen route behavior:

- `download` route should request a download disposition from Supabase signed URLs.
- Add a separate `open` route if the UI presents `Open original`.

Implementation direction:

- Refactor `createMediaLibraryAssetDownloadResponse` into a shared function such as `createMediaLibraryOriginalAssetResponse`.
- Accept a mode, for example `mode: "download" | "open"`.
- For `download`, call Supabase storage `createSignedUrl(path, 120, { download: filename })`, using `detail.row.original_filename` or a safe fallback filename.
- For `open`, call `createSignedUrl(path, 120)` without download disposition.
- Continue returning a 302 redirect to the signed URL.

UI behavior:

- Keep existing detail/list `Open` action for the Media Library detail page.
- Add or expose `Open original` only where it is useful and does not confuse with opening the app detail page.
- Keep `Download original` for the forced-download action.
- Both original-access actions require Media Library read access.
- Preserve existing safety/advisory confirmation for original access when blocked/restricted release safety requires confirmation. If both actions expose the original, both should use the same confirmation copy or adjusted copy that says "open or download" rather than download-only.

I18n keys:

- `mediaLibrary.list.actions.openDetail`: if needed to distinguish app detail from original.
- `mediaLibrary.list.actions.openOriginal`: `Open original`
- `mediaLibrary.list.actions.download`: keep `Download original`
- `mediaLibrary.detail.openOriginal`: `Open original`
- `mediaLibrary.shared.downloadConfirm.*`: consider wording update if reused for open-original.

Manual validation:

- Image original download prompts/saves rather than opening inline where browser honors the disposition.
- Image original open still opens inline.
- Video original download requests download.
- Expired signed URLs still fail safely after TTL.

## Selection Plan

Keep the existing checkbox-based multi-select. Do not implement marquee selection in Feature 101.

Selection scope:

- assets only;
- current page only;
- stable `mediaLibraryAssetId` values only;
- available only to users with `canManageFolders`;
- no URL persistence;
- no cross-page persistence.

Selection reset rules:

- reset on folder change;
- reset on page change;
- reset on limit change;
- reset on view change;
- reset after successful add/move/remove folder mutation;
- prune selected IDs that are no longer present in current page data after `router.refresh()`.

UI additions:

- selected count in a compact toolbar;
- `Select all on page`;
- `Clear selection`;
- target folder select;
- existing batch actions: add to folder, move to folder, remove from folder.

Batch action rules:

- `Add to folder` should keep existing semantics: only add assets that do not already belong to another folder, with service validation.
- `Move to folder` should use existing route semantics: create missing membership or update existing membership.
- `Remove from folder` should only be shown or enabled inside a selected folder context.
- No batch download.
- No batch archive/delete.

Accessibility:

- Asset checkboxes need labels that include the asset filename.
- Toolbar actions need disabled states and accessible labels.
- Keyboard users can select assets and use the same batch actions as pointer users.
- Touch users can use checkboxes and batch controls without relying on drag/drop.

I18n keys:

- `selection.selectAllOnPage`
- `selection.clearSelection`
- `selection.selectedToolbarLabel` if needed
- `selection.pageSelectionHint` only if visible hint text is genuinely useful; avoid explanatory clutter.

## Optional Flat Asset Drag-to-Folder Plan

Decision: include as an optional final implementation phase, not as a required acceptance criterion for Feature 101.

Rationale:

- Existing `@dnd-kit` dependencies and existing `move-assets` route make flat asset drag-to-folder feasible without schema changes.
- The core value of Feature 101 is pagination, grid/list, safer thumbnails, compact controls, original download behavior, and better selection.
- Drag/drop can add interaction complexity and should not block those improvements.

If implemented in this cycle:

- Use existing `@dnd-kit/core`.
- Use explicit drag handles on asset cards/rows, not the whole card, to avoid conflicts with selection checkboxes and detail links.
- Folder rows become drop targets.
- Dragging a selected asset moves the selected set.
- Dragging an unselected asset moves only that asset.
- Drop calls existing `POST /api/media-library/folders/[folderId]/move-assets` with stable `mediaLibraryAssetIds`.
- Invalid drops to the current folder are ignored or show a non-blocking inline status.
- Archived folders are not rendered as drop targets; server still rejects stale archived targets.
- On success, clear selection and refresh.
- On failure, keep selection and show inline error.
- Checkbox/batch move remains the keyboard and touch fallback.

If skipped:

- Leave a clear follow-up note in the implementation summary.
- Do not add partial drag state or unused DnD wiring.

Do not implement folder drag/drop or nested folder moves in Feature 101.

## Security and Authorization

Preserve existing invariants:

- Never accept `tenant_id` from the client.
- Resolve tenant from auth/session/server-side lookup.
- Media Library read actions require `media_library.access` or the existing owner/admin/tenant-wide reviewer equivalent.
- Folder organization actions require `media_library.manage_folders` or the existing owner/admin/tenant-wide reviewer equivalent.
- Project reviewer access and project/workspace custom roles must not grant Media Library access.
- Service-role writes remain behind explicit authorization.
- Release snapshots remain immutable.
- Folder operations target stable `media_library_assets.id`, not release snapshot rows.

Pagination and view mode require only read access because they are read-only browse state.

Selection UI should be shown only when `canManageFolders` is true because selected batch actions mutate folder membership. Read-only users can still browse grid/list and open/download originals subject to read authorization and safety confirmation.

Download and open routes must not trust release asset IDs alone. They must:

- authenticate the user;
- resolve tenant server-side;
- call the existing detail/read path for the release asset under that tenant;
- sign only after authorization succeeds.

## Edge Cases and Race Conditions

Pagination:

- Empty tenant or no released media: show empty state with disabled pagination.
- Empty selected folder: show folder-specific empty state.
- Requested page beyond last page after filtering: normalize to last valid page or page 1 when no assets.
- Invalid `limit` or `view`: use defaults.
- Assets published while browsing: refresh may change counts/pages; selection resets on page data change.

Preview signing:

- Missing photo derivative: use bounded transform fallback.
- Missing video poster: show preview-unavailable placeholder.
- Signing failure: show placeholder and keep row/card usable.
- Expired preview signed URLs: normal page refresh gets fresh URLs.

Selection:

- Stale selected asset IDs after release/folder refresh: prune IDs to current page.
- Selected asset moved by another user: server route determines final membership; UI refreshes afterward.
- Selected asset no longer belongs to current folder before remove: existing route should be idempotent or return a controlled error; UI shows inline error if needed.

Folder mutations:

- Duplicate create name: server unique active-name constraint remains authoritative; show inline conflict.
- Archive target while creating/moving: server rejects archived target; UI refreshes and shows error.
- Concurrent move requests: unique `(tenant_id, media_library_asset_id)` keeps one membership per asset; last successful move wins.
- Retried move requests: `move-assets` should stay effectively idempotent for the same target folder.

Download/open:

- Original object missing: route returns existing controlled 409/not-found behavior.
- Browser may still choose how to handle some downloads; signed URL download option is the smallest correct server hint.
- Signed URLs remain short-lived.

Optional drag/drop:

- Drop to current folder should be no-op.
- Drag selected set to current folder should be no-op.
- Drag unselectable asset with no stable `mediaLibraryAssetId` should be disabled.
- DnD failures should not clear selection.

## I18n Plan

Update both `messages/en.json` and `messages/nl.json` with matching keys.

Likely new keys under `mediaLibrary.list`:

- `pagination.previous`
- `pagination.next`
- `pagination.pageStatus`
- `pagination.pageSizeLabel`
- `pagination.pageSizeValue`
- `view.grid`
- `view.list`
- `view.gridAriaLabel`
- `view.listAriaLabel`
- `selection.selectAllOnPage`
- `selection.clearSelection`
- `folderForm.createPlaceholder`
- `folderForm.createAriaLabel`
- `folderForm.createSubmitAriaLabel`
- `folderForm.createSubmitting`
- `sidebar.renameFolderAriaLabel`
- `sidebar.archiveFolderAriaLabel`
- `actions.openDetail`
- `actions.openOriginal`

Adjust existing English/Dutch copy only where needed:

- `actions.open` may become app-detail specific.
- `shared.downloadConfirm` wording may need to cover both open-original and download-original if shared.

Keep stored domain content unchanged. Localize only UI chrome and validation/status copy.

## Test Plan

Add or update focused tests. Exact filenames can follow existing feature test naming, likely `tests/feature-101-media-library-browse-ux.test.ts` plus updates to existing download tests.

Service tests:

- `getMediaLibraryPageData` defaults to page 1, limit 24.
- unsupported limits clamp to default.
- invalid page values clamp to page 1.
- all-assets pagination returns only one page and correct metadata.
- selected folder pagination filters by folder membership and returns correct metadata.
- folder counts remain based on active folders/latest-release assets.
- unauthorized read remains forbidden.

Preview tests:

- list/grid photo thumbnail uses derivative when ready.
- list/grid photo thumbnail fallback uses transform, not original.
- video missing poster returns no URL/placeholder state.
- only page assets are passed to preview signing.

Route tests:

- download route calls Supabase `createSignedUrl` with `{ download: filename }`.
- open route, if added, calls `createSignedUrl` without `download`.
- both routes require Media Library read access.
- cross-tenant release asset access is rejected.
- missing original object returns controlled error.

Folder UI/component tests:

- compact create form renders input and accessible plus button.
- empty create shows inline error and does not call route.
- create conflict shows inline error.
- folder rename/archive icon buttons have accessible names.
- archive confirmation still happens.
- grid/list toggle links preserve folder/page/limit as intended.
- pagination controls render disabled/enabled state correctly.
- selection toolbar shows selected count.
- select all on page selects only selectable current-page assets.
- clear selection clears current-page selection.
- selection resets on page/folder/view changes.

Optional DnD tests if implemented:

- dragging selected asset to folder sends all selected IDs to `move-assets`.
- dragging unselected asset sends only that ID.
- dropping on current folder is no-op.
- failed move leaves selection and shows error.

I18n tests:

- English and Dutch message trees have matching new keys.

Validation commands after implementation:

- `npm test`
- `npm run lint`

If the repo has narrower test commands for feature files, run those first during implementation, then the full commands above.

## Implementation Phases

1. Pagination service contract
   - Extend `getMediaLibraryPageData` input/output.
   - Add page/limit normalization helpers.
   - Preserve latest-release behavior and folder filtering.
   - Add service tests.

2. Server page query parsing and preview signing
   - Parse `folderId`, `page`, `limit`, and `view`.
   - Normalize invalid state.
   - Sign only returned page assets.
   - Change browse thumbnail fallback for photos to transform and videos to none.

3. Grid/list and pagination UI
   - Add view toggle and pagination controls.
   - Add grid card rendering while preserving list row rendering.
   - Add i18n keys.
   - Add UI tests.

4. Compact folder and icon actions
   - Replace create folder form with compact input plus accessible icon button.
   - Replace visible folder rename/archive text buttons with icon buttons.
   - Prefer inline rename over `window.prompt` if small enough.
   - Replace create validation alerts with inline errors.

5. Original open/download behavior
   - Refactor original signing helper.
   - Force download route with Supabase signed URL download option.
   - Add open-original route if needed.
   - Update list/detail action labels.
   - Add route tests.

6. Selection UX
   - Add select all on page and clear selection.
   - Improve selected count toolbar.
   - Reset/prune selection on folder/page/view data changes.
   - Keep batch actions limited to folder organization.

7. Optional flat asset drag-to-folder
   - Implement only if phases 1-6 are stable and the diff remains small.
   - Use explicit drag handles and existing `move-assets` route.
   - Keep checkbox batch move as fallback.

8. Final validation
   - Run targeted tests.
   - Run `npm test`.
   - Run `npm run lint`.
   - Review changed i18n key parity.

## Scope Boundaries

Do not:

- add nested folders;
- add schema migrations;
- mutate release snapshots;
- add asset delete/archive;
- add batch download;
- restore ZIP export;
- add DAM export/sync;
- trust client-supplied tenant IDs;
- add new broad file-manager abstractions;
- add a new icon dependency unless implementation proves inline SVG is materially worse.

Do:

- preserve tenant scoping in every query;
- preserve custom-role Media Library enforcement;
- keep service-role operations server-only and explicitly authorized;
- keep writes retry-safe/idempotent where practical;
- localize new UI strings in English and Dutch;
- keep UI dense, predictable, and accessible.

## Open Decisions for Implementation

- Whether selected-folder pagination can be fully expressed in Supabase queries without an awkward project/source-asset pair filter. If not, use a constrained selected-folder candidate pass and document the tradeoff.
- Whether to redirect overlarge page numbers to the last valid page or render page 1. Prefer redirect to normalized URL if implementation is straightforward.
- Whether inline rename remains small enough for this cycle. If not, keep prompt replacement deferred but still use accessible icon buttons.
- Whether to expose `Open original` on both list and detail or only detail. Keep app-detail `Open` distinct from original access.
- Whether optional flat drag-to-folder fits after core phases. It must be skippable without compromising Feature 101.

## Implementation Prompt

Implement Feature 101 - Media Library Browse UX Refresh using `docs/rpi/101-media-library-browse-ux-refresh/plan.md` as the source plan and `docs/rpi/100-media-library-ui-ux-refresh/research.md` as research context. Do not add schema changes. Add server-side pagination for the protected Media Library, URL-backed grid/list view, safer page-only thumbnail signing, compact folder creation, accessible folder action icon buttons, corrected original download/open behavior, and improved page-local checkbox multi-select. Preserve release snapshot immutability, stable Media Library asset identities, tenant scoping, `media_library.access`, `media_library.manage_folders`, and custom-role enforcement. Keep batch actions limited to existing folder organization routes. Implement optional flat asset drag-to-folder only after the core refresh is complete and only if it can reuse the existing `move-assets` route with explicit drag handles and checkbox fallback. Update English and Dutch i18n messages and add focused tests for pagination, thumbnail fallback, download/open behavior, selection, folder UI, authorization, and i18n parity. Run `npm test` and `npm run lint` before completing.
