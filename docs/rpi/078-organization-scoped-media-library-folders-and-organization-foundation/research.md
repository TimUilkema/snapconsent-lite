# Feature 078 Research - Organization-scoped Media Library folders and organization foundation

## Inputs reviewed

Required inputs reviewed in order:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `UNCODEXIFY.md`
5. `docs/rpi/README.md`
6. `docs/rpi/SUMMARY.md`
7. `docs/rpi/074-project-release-package-and-media-library-placeholder/research.md`
8. `docs/rpi/074-project-release-package-and-media-library-placeholder/plan.md`
9. `docs/rpi/075-project-correction-and-re-release-foundation/research.md`
10. `docs/rpi/075-project-correction-and-re-release-foundation/plan.md`
11. `docs/rpi/076-correction-consent-intake-and-authorization-updates/research.md`
12. `docs/rpi/076-correction-consent-intake-and-authorization-updates/plan.md`
13. `docs/rpi/077-media-library-asset-safety-and-release-detail-review-context/research.md`
14. `docs/rpi/077-media-library-asset-safety-and-release-detail-review-context/plan.md`

Live code and schema inspected as source of truth:

- Media Library and release tables:
  - `supabase/migrations/20260424130000_074_project_releases_media_library_foundation.sql`
  - `src/lib/project-releases/project-release-service.ts`
  - `src/lib/project-releases/types.ts`
  - `src/lib/project-releases/media-library-download.ts`
  - `src/lib/project-releases/media-library-release-safety.ts`
  - `src/lib/project-releases/media-library-release-overlays.ts`
- Correction and release version behavior:
  - `supabase/migrations/20260424150000_075_project_correction_re_release_foundation.sql`
  - `supabase/migrations/20260424170000_076_correction_consent_provenance.sql`
  - `src/lib/projects/project-workflow-service.ts`
  - `src/lib/projects/project-workflow-route-handlers.ts`
  - `src/lib/projects/project-workspace-request.ts`
- Tenant resolution and permissions:
  - `supabase/migrations/20260423121000_072_project_workspace_access.sql`
  - `src/lib/tenant/resolve-tenant.ts`
  - `src/lib/tenant/active-tenant.ts`
  - `src/lib/tenant/active-tenant-route-handler.ts`
  - `src/lib/tenant/permissions.ts`
- Current protected UI and routes:
  - `src/app/(protected)/layout.tsx`
  - `src/components/navigation/protected-nav.tsx`
  - `src/app/(protected)/media-library/page.tsx`
  - `src/app/(protected)/media-library/[releaseAssetId]/page.tsx`
  - `src/app/api/media-library/assets/[releaseAssetId]/download/route.ts`
  - `src/components/media-library/media-library-download-button.tsx`
  - `src/components/media-library/release-safety-badges.tsx`
  - `src/components/media-library/release-safety-banner.tsx`
  - `src/components/media-library/release-usage-permissions.tsx`
  - `src/components/media-library/released-photo-review-surface.tsx`
- Current route-handler write patterns:
  - `src/app/api/projects/[projectId]/invites/route.ts`
  - `src/app/api/projects/[projectId]/profile-participants/route.ts`
  - `src/app/api/projects/[projectId]/workspaces/[workspaceId]/correction-reopen/route.ts`
- Relevant tests:
  - `tests/feature-060-tenant-resolution-hardening.test.ts`
  - `tests/feature-070-active-tenant-route.test.ts`
  - `tests/feature-073-project-workflow-foundation.test.ts`
  - `tests/feature-073-project-workflow-routes.test.ts`
  - `tests/feature-074-project-release-media-library.test.ts`
  - `tests/feature-074-media-library-download.test.ts`
  - `tests/feature-075-project-correction-workflow.test.ts`
  - `tests/feature-076-correction-consent-intake-foundation.test.ts`
  - `tests/feature-076-correction-provenance-foundation.test.ts`
  - `tests/feature-077-media-library-release-helpers.test.ts`
  - `tests/feature-077-media-library-ui.test.ts`

Source-of-truth rule used for this document:

- Live code and migrations are authoritative.
- Earlier RPI docs are context only.
- Where earlier docs drift from current code, this document follows the current repo.

## Verified current Media Library and release behavior

### Media Library list behavior today

Current list behavior is implemented in `listMediaLibraryAssets(...)` plus `src/app/(protected)/media-library/page.tsx`.

Verified behavior:

- Media Library is tenant-scoped and latest-release-only by project, not all-releases-by-default.
- The list reads all published `project_releases` for the active tenant, orders by `release_version desc` and `source_project_finalized_at desc`, and keeps the first row per `project_id`.
- It then reads `project_release_assets` only for those latest release ids.
- The page renders one flat list of released assets with:
  - preview thumbnail or poster
  - filename
  - asset type
  - project name
  - workspace name
  - release version
  - linked people count
  - release created timestamp
  - `Open` and `Download original`
- Feature 077 adds read-only safety context on that list:
  - `Blocked`
  - `Restricted`
  - `Manual`

Important implication for Feature 078:

- Current "latest" behavior is latest published release per project, not latest release row per source asset across the whole tenant.
- If a correction publishes v2 and removes an asset from that project's latest release, the main Media Library list no longer shows that asset, even though the historical release row still exists.

### Historical release detail access today

Current detail behavior is implemented in `getReleaseAssetDetail(...)` plus `src/app/(protected)/media-library/[releaseAssetId]/page.tsx`.

Verified behavior:

- Detail access is by `project_release_assets.id`.
- The detail loader reads a single `project_release_assets` row by `(tenant_id, id)`.
- It then verifies the parent `project_releases` row still exists and is `published`.
- This allows direct access to historical release asset detail rows even though the main Media Library list only shows the latest release per project.
- There is no dedicated release-history browser today. Historical access is direct-id only.

Tests confirm this behavior:

- `tests/feature-074-project-release-media-library.test.ts` verifies the latest list shows v2 after correction, while a direct detail lookup by the v1 release asset id still resolves historical detail.

### Download flow after Feature 077

Current download behavior is implemented in:

- `src/app/api/media-library/assets/[releaseAssetId]/download/route.ts`
- `src/lib/project-releases/media-library-download.ts`

Verified flow:

1. `GET /api/media-library/assets/[releaseAssetId]/download`
2. server resolves authenticated user
3. server resolves active tenant with `resolveTenantId(...)`
4. server loads released asset detail with `getReleaseAssetDetail(...)`
5. server signs the original storage object via the admin Supabase client
6. route returns `302` redirect to a short-lived signed URL

Other verified download details:

- The route authorizes against the release row, not client-supplied storage coordinates.
- Missing source storage returns `409 release_asset_source_missing`.
- Authorized download remains possible for historical release asset ids, not just latest-release rows.

### Blocked/restricted download warning today

Feature 077 warning behavior is advisory UI only.

Verified behavior:

- Safety state is derived from immutable release snapshot JSON by `deriveMediaLibraryReleaseSafety(...)`.
- `MediaLibraryDownloadButton` uses `window.confirm(...)` when:
  - blocked faces are present
  - or any linked owner is revoked
  - or any effective scope is not `granted`
- Hidden-only, suppressed-only, and manual-only states do not require confirmation.
- The download route itself does not enforce confirmation or inspect warning query parameters.
- Direct route hits bypass the UI confirmation step.

### Release/version identifiers currently available

Current release identifiers available in live schema and TS types:

- `project_releases.id`
- `project_releases.project_id`
- `project_releases.release_version`
- `project_releases.source_project_finalized_at`
- `project_release_assets.id`
- `project_release_assets.release_id`
- `project_release_assets.project_id`
- `project_release_assets.workspace_id`
- `project_release_assets.source_asset_id`
- `workspace_snapshot.release.releaseId`
- `workspace_snapshot.release.releaseVersion`

Important current distinction:

- `project_release_assets.id` identifies one immutable snapshot row in one release.
- `source_asset_id` points back to the mutable source `assets.id` lineage that may appear again in later release versions for the same project.

### Release v2+ relation to `source_asset_id`, `project_release_assets.id`, and `release_version`

Current live behavior after Features 075 and 076:

- Correction finalization updates `projects.finalized_at` to a new timestamp.
- `ensureProjectReleaseSnapshot(...)` uses `(tenant_id, project_id, source_project_finalized_at)` as the release-cycle uniqueness key.
- `resolveOrCreateBuildingRelease(...)` computes `nextReleaseVersion = latestProjectRelease.release_version + 1`.
- A new correction release inserts a new `project_releases` row and a fresh set of `project_release_assets` rows.
- Old published release rows are not mutated.
- Old published release asset rows are not mutated.
- The same `source_asset_id` can appear in both v1 and v2 for the same project.
- The v1 and v2 `project_release_assets.id` values are different rows.

Current repo evidence:

- `tests/feature-074-project-release-media-library.test.ts` verifies that v1 and v2 both exist, the list resolves to v2, and the historical v1 asset row is still accessible by its original release asset id.
- `tests/feature-075-project-correction-workflow.test.ts` verifies v2 publishes without mutating v1.

Minor live nuance:

- `buildMissingReleaseSummary()` still hardcodes `releaseVersion: 1` for finalize-repair warnings. That affects warning payloads only, not actual release creation or persisted release rows.

## Current schema/code paths involved

### Current Media Library read model

- `project_releases`
- `project_release_assets`
- `src/lib/project-releases/project-release-service.ts`
- `src/lib/project-releases/types.ts`
- `src/app/(protected)/media-library/page.tsx`
- `src/app/(protected)/media-library/[releaseAssetId]/page.tsx`
- `src/app/api/media-library/assets/[releaseAssetId]/download/route.ts`

### Current release creation and versioning model

- `src/lib/projects/project-workflow-service.ts`
- `src/lib/projects/project-workflow-route-handlers.ts`
- `src/lib/project-releases/project-release-service.ts`
- `supabase/migrations/20260424130000_074_project_releases_media_library_foundation.sql`
- `supabase/migrations/20260424150000_075_project_correction_re_release_foundation.sql`

### Current tenant/access model

- `src/lib/tenant/resolve-tenant.ts`
- `src/lib/tenant/active-tenant.ts`
- `src/lib/tenant/active-tenant-route-handler.ts`
- `src/lib/tenant/permissions.ts`
- `supabase/migrations/20260423121000_072_project_workspace_access.sql`
- `src/app/(protected)/layout.tsx`
- `src/components/navigation/protected-nav.tsx`

### Current correction/version tests that matter to Feature 078

- `tests/feature-074-project-release-media-library.test.ts`
- `tests/feature-074-media-library-download.test.ts`
- `tests/feature-075-project-correction-workflow.test.ts`
- `tests/feature-076-correction-consent-intake-foundation.test.ts`
- `tests/feature-076-correction-provenance-foundation.test.ts`
- `tests/feature-077-media-library-release-helpers.test.ts`
- `tests/feature-077-media-library-ui.test.ts`

## Current constraints and invariants

Verified live invariants Feature 078 must preserve:

- Release snapshots are immutable once published.
- Media Library is read-only over release snapshots.
- Media Library does not mutate project review state.
- Correction plus re-finalization is the only way to change released state.
- A new release version creates new `project_release_assets` rows instead of rewriting old ones.
- The main Media Library list is latest published release per project.
- Historical release asset detail remains directly accessible by release asset id.
- Headshots are not released Media Library assets.
- Photos and videos are the released asset types.
- Tenant scope is always derived server-side.
- Photographers are excluded from Media Library access today.

## Tenant scope and permission findings

### Active tenant resolution

Current active tenant resolution is server-side in `resolveTenantId(...)` and `ensureTenantId(...)`.

Verified behavior:

- The server reads the `sc_active_tenant` cookie.
- If the user has one membership, that tenant is used without requiring a cookie.
- If the user has multiple memberships, the cookie must match a current membership or the server throws `409 active_tenant_required`.
- If the user has no memberships, the server attempts `ensure_tenant_for_current_user()` unless a pending org-invite cookie blocks bootstrap.
- Protected pages, API routes, and Media Library download all resolve tenant server-side.

Tests confirm:

- `tests/feature-060-tenant-resolution-hardening.test.ts`
- `tests/feature-070-active-tenant-route.test.ts`

### Current Media Library role boundary

Current Media Library access is limited to `owner`, `admin`, and `reviewer` in three layers:

- UI gating:
  - `ProtectedLayout` only sets `showMediaLibrary = permissions.canReviewProjects`
  - `ProtectedNav` only shows `/media-library` when that flag is true
- Server authorization:
  - `authorizeMediaLibraryAccess(...)` calls `resolveTenantPermissions(...)`
  - access requires `permissions.canReviewProjects`
- RLS:
  - `app.current_user_can_access_media_library(tenant_id)`
  - allowed roles are `owner`, `admin`, `reviewer`

Confirmed result:

- photographers remain denied in the current first slice
- this matches both the product behavior and test coverage

### Current release-table RLS shape

Current release-table protections from the 074 migration:

- `project_releases`
  - RLS enabled
  - authenticated users get `select` only
  - `service_role` gets full DML
  - select policy uses `app.current_user_can_access_media_library(tenant_id)`
- `project_release_assets`
  - same pattern as above

This means:

- release tables are readable by reviewer-capable tenant members
- release rows are not writable by normal authenticated clients
- immutable release behavior is reinforced by both app code and RLS shape

### Cleanest folder-table RLS/helper model

For Feature 078, the cleanest tenant-scoped model is:

- keep tenant scoping explicit on every folder table row
- use Media Library reviewer-capable access as the role boundary
- derive tenant server-side from the active membership, never from the client
- keep `created_by` / `updated_by` as audit fields only

Recommended DB helper shape:

- reuse `app.current_user_can_access_media_library(tenant_id)` for read policies
- add a sibling helper for writes only if write policies are introduced, for example:
  - `app.current_user_can_manage_media_library(tenant_id)`
- in the first slice, the role set for read and write should stay the same:
  - `owner`
  - `admin`
  - `reviewer`

Recommended policy shape:

- folders
  - select: reviewer-capable Media Library access
  - insert/update/delete or archive: same reviewer-capable Media Library access
- library asset identity rows
  - select: reviewer-capable Media Library access
  - insert/update: service/admin path only if populated from release creation
- folder membership rows
  - select: reviewer-capable Media Library access
  - insert/update/delete: reviewer-capable Media Library access or service/admin path

Route-authority recommendation:

- even if authenticated write policies are added, folder CRUD and membership writes should still go through server route handlers
- route handlers should derive tenant id server-side and validate role/workspace context before writing

### `created_by` and `updated_by`

Verified recommendation:

- `created_by` and `updated_by` should remain audit fields only
- they should not become ownership boundaries
- folder access is organization-scoped within the active tenant, not creator-scoped

## Naming recommendation: folders vs collections

Live product language review:

- current protected nav calls the area `Media Library`
- current Media Library UI is a straightforward list/detail surface
- no existing Media Library vocabulary uses either `folders` or `collections`
- repository-wide search found no current product feature named `folder` or `collection` in Media Library code or messages

Interpretation:

- there is no existing in-product vocabulary to preserve here
- the first slice can choose the term that best matches the actual model

Recommendation:

- use `folders` for Feature 078

Why:

- the requested first slice is simple organization metadata with add, move, remove, rename, and archive behavior
- users will expect one-location organization from the current scope
- `collections` implies curation and many-to-many grouping, which is broader than the proposed bounded slice
- the product already has "Media Library" as the high-level noun, so `folders` reads naturally inside it

Bounded language recommendation:

- UI term: `Folders`
- internal model may still use neutral table names if desired, but the user-facing first slice should say `folder`

## Folder structure model findings

### Flat vs nested

Recommendation:

- flat folders only in the first slice

Why:

- current Media Library is a single normal list/detail flow
- nested folders add route complexity, rename/move recursion, breadcrumb UX, and extra RLS/query surface
- the user request is satisfied by one-level organization
- nested trees make later DAM handoff harder to reason about because built-in hierarchy starts behaving like product truth

### Tenant-wide vs project-scoped vs release-scoped

Recommendation:

- folders should be tenant-wide Media Library organization metadata
- they should not be project-scoped
- they should not be release-scoped

Why:

- the Media Library itself is tenant-scoped in the current app
- a released asset from any project can already appear in the tenant Media Library
- foldering is meant to organize the tenant's released-media destination, not a single project review cycle
- release-scoped folders would contradict the requirement that organization metadata be separate from immutable release snapshots

### Hard delete vs archive

Recommendation:

- use archive / soft delete for folders in the first slice

Why:

- folders are mutable organization metadata and may be referenced by membership rows
- archive handles concurrent organizer activity more safely than hard delete
- archive preserves auditability without affecting release truth
- archived folders can simply disappear from normal selection lists while leaving membership history intact

### Recommended folder row shape

Recommended first-slice folder columns:

- `id uuid primary key`
- `tenant_id uuid not null`
- `name text not null`
- `description text null`
- `created_at timestamptz not null default now()`
- `created_by uuid not null`
- `updated_at timestamptz not null default now()`
- `updated_by uuid not null`
- `archived_at timestamptz null`
- `archived_by uuid null`

Recommended constraints:

- active-name uniqueness per tenant
- `name` trimmed and non-empty
- archive shape check:
  - both `archived_at` and `archived_by` null
  - or both non-null

### Folder-name uniqueness

Recommendation:

- folder names should be unique per tenant among non-archived folders

Why:

- the first slice has flat folders only
- duplicate names create avoidable move/add ambiguity
- allowing archived-name reuse keeps the model practical

## Folder membership and stable-identity options

### Current live baseline

There is no current folder model and there is no current stable Media Library asset identity table.

The only stable cross-release lineage key visible in live code today is:

- `project_release_assets.source_asset_id`

But that key is only present on immutable release asset rows. The current app does not have a separate library identity row that survives across release versions.

### Option A - folder membership points directly to `project_release_assets.id`

Shape:

- folder membership row stores the immutable release asset row id

Pros:

- simplest foreign key to current detail route
- historical release detail remains trivial by id
- no extra identity table needed

Cons:

- bad fit for latest-release behavior
- if v2 publishes, the folder still points at the v1 snapshot row
- making the folder show v2 would require either:
  - mutating the old membership
  - duplicating the membership
  - or accepting that folders are historical-release buckets
- it organizes immutable snapshots, not current library assets
- future DAM handoff is weaker because organization metadata is tied to one release snapshot row

Assessment:

- reject for the first slice

### Option B - folder membership points to `source_asset_id` plus tenant/project context

Shape:

- folder membership row stores `(tenant_id, project_id, source_asset_id, folder_id)`

Pros:

- follows the cross-release asset lineage that already exists in live release rows
- v1 to v2 carry-forward works without mutating old release rows
- historical release detail remains possible because detail still uses release asset ids separately
- smaller than introducing a new library identity table

Cons:

- `source_asset_id` is still a source-system asset identifier, not a library identity
- there is no first-class row to represent "this is a tenant library asset across release versions"
- any future mutable library metadata has nowhere clear to live except the membership row itself
- DAM handoff seams remain weaker because the built-in library has no explicit asset identity of its own

Assessment:

- viable
- smaller than Option C
- still somewhat under-modeled for a library feature

### Option C - introduce a stable Media Library asset identity

Shape:

- new table for stable library asset lineage
- folder memberships point to that stable identity, not directly to a release row

Recommended minimal identity row:

- `id uuid primary key`
- `tenant_id uuid not null`
- `project_id uuid not null`
- `source_asset_id uuid not null`
- `created_at timestamptz not null default now()`

Recommended uniqueness:

- unique `(tenant_id, project_id, source_asset_id)`

Pros:

- clean separation between immutable release truth and mutable library organization
- folder membership can survive v1 to v2 without touching old release rows
- gives the built-in library an explicit asset identity that can later participate in DAM handoff
- creates a clean place for future library-only metadata without putting it on release rows
- historical detail still works because release asset ids continue to represent immutable snapshot rows

Cons:

- one additional table
- one additional lookup/join in list and folder queries
- requires a small identity-maintenance seam when new releases publish

Assessment:

- best fit for the product rule that organization metadata must stay separate from release immutability
- recommended

### Option D - equivalent live-code variant discovered during research

Live-code equivalent discovered:

- there is already a usable implicit lineage key: `(tenant_id, project_id, source_asset_id)`
- no other stable asset identity exists today

Interpretation:

- Option B is the thinnest possible direct use of live lineage
- Option C is the explicit modeled version of that same lineage

## Stable library asset identity findings

### Recommended table shape

Recommended new table:

- `media_library_assets`

Recommended first-slice columns:

- `id uuid primary key`
- `tenant_id uuid not null`
- `project_id uuid not null`
- `source_asset_id uuid not null`
- `created_at timestamptz not null default now()`

Optional but reasonable audit columns:

- `created_by uuid null`

Columns not recommended in the first slice:

- `latest_release_asset_id`
- `latest_release_id`
- mutable consent/review/scope metadata
- DAM fields

### Recommended key

Recommendation:

- key the stable identity by `(tenant_id, project_id, source_asset_id)`

Why:

- `source_asset_id` alone is an asset-table id, but the live release semantics are project-bound
- release versioning and latest-release resolution are already project-specific
- the same tenant can have multiple projects with independent released assets

### Should it reference latest release asset directly?

Recommendation:

- no
- derive latest release asset at read time

Why:

- storing a mutable `latest_release_asset_id` would create unnecessary pointer maintenance
- pointer updates would have to run on every correction publish and every asset removal
- the latest-resolution rule already exists in live code through published release ordering
- deriving at read time preserves the rule that the stable library identity is not release truth

### When should it be created?

Recommendation:

- create or upsert stable library asset rows during release snapshot creation

Why:

- the release publish seam is when an asset becomes part of the tenant's released-media library
- it guarantees every released asset has a stable library id before any folder operation
- it avoids lazy-creation gaps in list and filter queries
- it stays idempotent because the natural unique key is `(tenant_id, project_id, source_asset_id)`

Important boundary:

- this hook should only upsert the library identity row
- it must not mutate old `project_releases` or `project_release_assets`
- it should remain organization/index metadata, not release truth

### How v2+ behaves with a stable identity

Recommended behavior:

- v1 publish creates:
  - one `media_library_assets` row
  - one or more immutable `project_release_assets` rows
- v2 publish for the same source asset:
  - reuses the same `media_library_assets` row
  - inserts a new `project_release_assets` row in v2
- folder membership remains attached to the stable library asset id
- current folder views resolve that stable id to the latest published release asset row

### If v2 no longer contains the asset

Recommendation for first slice:

- keep the stable library asset row
- keep the folder membership row
- current folder views should resolve only assets that still exist in the latest published release
- if no latest release asset exists for that stable identity, omit it from the normal folder asset list

Why:

- this preserves mutable organization metadata without pretending a current released asset still exists
- it does not require deleting membership rows
- it leaves room for a later "historical/unavailable in latest release" affordance without changing the model

## Recommended folder membership model

### One folder vs multiple folders

Recommendation:

- first slice should be one folder only per library asset

Why:

- the requested operations are `add`, `move`, and `remove`, which map naturally to single-folder membership
- many-to-many membership behaves more like collections than folders
- one-folder-only keeps batch move semantics simple

### Recommended membership-table shape

Recommendation:

- use a separate membership table even though the first slice is single-folder-only

Suggested table:

- `media_library_folder_memberships`

Suggested columns:

- `id uuid primary key`
- `tenant_id uuid not null`
- `media_library_asset_id uuid not null`
- `folder_id uuid not null`
- `created_at timestamptz not null default now()`
- `created_by uuid not null`
- `updated_at timestamptz not null default now()`
- `updated_by uuid not null`

Suggested constraints:

- unique `(tenant_id, media_library_asset_id)`
- foreign key to `media_library_assets`
- foreign key to `media_library_folders`

Why this is better than a nullable `folder_id` column on the identity row:

- it keeps folder organization explicitly separate from the stable identity row
- it is easier to evolve later toward many-to-many if collections are added
- it matches the product framing of mutable folder membership without touching release truth

## Latest-release behavior and folder carry-forward

Recommended first-slice behavior:

- the normal Media Library view keeps showing latest published release assets only
- a folder view should also resolve to latest published release assets only
- folder membership should attach to the stable library asset identity, not a historical release row

Implications:

- if an asset was added to a folder while v1 was current, the folder should show v2 automatically after correction publish
- this happens by resolving the stable identity to the latest published release asset for the same `(tenant_id, project_id, source_asset_id)`
- old release rows remain historical and auditable, but folder organization follows the current library asset

If v2 removes the asset:

- do not mutate v1
- do not delete the folder membership automatically
- do not show the asset in the current folder list
- leave historical release detail reachable by the old release asset id outside the folder filter

Recommended first-slice rule:

- folder membership should never point directly at historical release assets
- folders organize current library assets, not release-history rows

## UI behavior findings

### Current UI baseline

Current Media Library UI is intentionally simple:

- one protected route for the list:
  - `/media-library`
- one protected route for detail:
  - `/media-library/[releaseAssetId]`
- no separate asset manager shell
- no folder or collection UI today

Feature 077 already established:

- list badges for blocked/restricted/manual
- detail safety banner
- read-only overlay review surface for released photos
- UI-only download confirmation

### Recommended first-slice folder UI

Recommendation:

- keep one Media Library page
- add a simple left sidebar or left filter rail inside the existing page

Sidebar contents:

- `All assets`
- flat folder list
- `Create folder`
- archived folders excluded from normal navigation

Main list behavior:

- `All assets` shows the current latest-release list exactly as today
- selecting a folder filters the list to latest released assets currently assigned to that folder
- the list layout should stay the same basic list/cards already used by the current page

Batch organization behavior:

- allow selecting assets from the current list
- allow batch:
  - `Add to folder`
  - `Move to folder`
  - `Remove from folder`

Folder-management behavior:

- create folder
- rename folder
- archive folder

### Detail-page behavior from a folder

Recommendation:

- keep the existing release asset detail route:
  - `/media-library/[releaseAssetId]`
- preserve folder context through a query string such as `?folderId=...` only for back-link UX
- do not introduce a separate folder detail route in the first slice

Feature 077 behavior should remain unchanged inside folders:

- safety badges
- safety banner
- released-photo overlay review context
- usage permissions
- UI-only download confirmation

## API and route-boundary findings

### Current repo pattern

Current repo pattern is consistent:

- protected pages do server-rendered reads
- authenticated writes go through route handlers under `src/app/api/**`
- route handlers resolve auth and tenant server-side
- mutation logic lives in `src/lib/**` services and helpers

Examples verified:

- `src/app/api/projects/[projectId]/invites/route.ts`
- `src/app/api/projects/[projectId]/profile-participants/route.ts`
- `src/app/api/projects/[projectId]/workspaces/[workspaceId]/correction-reopen/route.ts`

### Recommendation for Feature 078 writes

Recommendation:

- use route handlers, not server actions

Why:

- this matches the current repo pattern for authenticated mutations
- server-side auth and tenant derivation stay explicit
- idempotency and conflict errors are easier to shape consistently

Likely route-handler surface:

- `POST /api/media-library/folders`
- `PATCH /api/media-library/folders/[folderId]`
- `POST /api/media-library/folders/[folderId]/archive`
- `POST /api/media-library/folders/[folderId]/assign`
- `POST /api/media-library/folders/move`
- `POST /api/media-library/folders/remove`

Equivalent alternative:

- one generic batch-organize route is possible
- but separate add/move/remove endpoints will likely be clearer for the first slice

### Idempotency and retry expectations

Recommended write behavior:

- create folder
  - idempotent with `Idempotency-Key` or conflict-safe unique active name handling
- rename folder
  - retry-safe compare-and-set; same name returns no-op
- archive folder
  - retry-safe; already archived returns no-op
- add assets to folder
  - upsert membership rows; duplicate add returns no-op
- move assets between folders
  - update membership by stable library asset id; repeated same move returns no-op
- remove assets from folder
  - delete membership rows; repeated remove returns no-op

All writes should:

- derive tenant server-side
- reject archived target folders
- reject assets outside the active tenant
- operate on stable library asset ids, not release asset ids

## Release immutability and finalization boundary

Verified live boundary:

- finalization and correction already publish immutable release rows
- release creation is not folder-aware today
- release rows are read-only for authenticated users

Required Feature 078 conclusions:

- folders must not be required for release creation
- folders must not be required for project finalization
- folder changes must not mutate:
  - `project_releases`
  - `project_release_assets`
- folder changes must not reopen correction or finalization flows

### Does release snapshot creation need a hook?

If Feature 078 uses Option C with a stable library identity:

- yes, but only a very small one

Recommended hook:

- during or immediately after successful release snapshot creation, upsert `media_library_assets` rows for every released asset using `(tenant_id, project_id, source_asset_id)`

Why this is the smallest safe hook:

- it guarantees stable identities exist before folder organization starts
- it does not touch old release rows
- it does not make folders part of release truth
- it is retry-safe through a unique key

If the plan chooses Option B instead:

- no new release hook is required
- folder membership would attach directly to `(tenant_id, project_id, source_asset_id)`

## DAM compatibility findings

Verified live DAM boundary:

- there are no current DAM sync tables
- there are no DAM status fields
- there are no external DAM ids on release rows

Recommendation:

- Feature 078 should not add DAM-specific fields

Identifiers that should remain explicit:

- `tenant_id`
- `project_id`
- `workspace_id`
- `release_id`
- `project_release_assets.id`
- `source_asset_id`
- `media_library_assets.id` if introduced

Future-fit interpretation:

- immutable `project_releases` and `project_release_assets` remain the publication/audit source
- built-in folders remain optional tenant organization metadata
- a later DAM mode could consume releases and either:
  - bypass built-in folder organization entirely
  - or map stable library asset identities to DAM objects
- none of that requires DAM fields in Feature 078 if the stable identifiers above exist

## Security and reliability findings

### Tenant isolation

New folder-related tables must include `tenant_id` and tenant-scoped FKs where applicable.

Recommended boundaries:

- all list/filter queries include resolved tenant id
- all writes derive tenant from the authenticated server context
- cross-tenant folder ids or library asset ids should resolve as not found

### Role restrictions

Recommended first-slice access:

- allow:
  - `owner`
  - `admin`
  - `reviewer`
- deny:
  - `photographer`

This matches current Media Library access and avoids widening tenant media visibility.

### Race cases

Two users add the same asset to the same folder:

- handle with unique `(tenant_id, media_library_asset_id)` and upsert/no-op behavior

Folder archived while another user adds assets:

- membership writes should verify the folder is not archived at write time
- if archived concurrently, return conflict

Release v2 publishes while a user is organizing v1 assets:

- stable identity prevents loss of organization intent
- current folder view simply resolves to the latest release asset after publish

Asset removed from the latest release by correction:

- keep stable identity and membership row
- omit the asset from current folder views
- do not mutate old release rows

### Audit fields

Recommended audit fields:

- folders:
  - `created_at`, `created_by`
  - `updated_at`, `updated_by`
  - `archived_at`, `archived_by`
- memberships:
  - `created_at`, `created_by`
  - `updated_at`, `updated_by`

## Test findings and recommended new coverage

### Existing tests to preserve

- `tests/feature-060-tenant-resolution-hardening.test.ts`
- `tests/feature-070-active-tenant-route.test.ts`
- `tests/feature-074-project-release-media-library.test.ts`
- `tests/feature-074-media-library-download.test.ts`
- `tests/feature-075-project-correction-workflow.test.ts`
- `tests/feature-076-correction-consent-intake-foundation.test.ts`
- `tests/feature-076-correction-provenance-foundation.test.ts`
- `tests/feature-077-media-library-release-helpers.test.ts`
- `tests/feature-077-media-library-ui.test.ts`

### New coverage Feature 078 should add

Schema and RLS:

- folder name uniqueness per tenant among active folders
- one active membership per stable library asset
- cross-tenant folder isolation
- reviewer-capable access allowed
- photographer denied

Folder lifecycle:

- create folder
- rename folder
- archive folder
- archived folder disappears from normal folder list

Membership behavior:

- add assets to folder
- move assets between folders
- remove assets from folder
- duplicate add is idempotent
- repeated move/remove is idempotent

Latest-release resolution:

- asset added to folder in v1 appears from v2 automatically after correction publish
- old v1 release rows remain unchanged
- old v1 release asset detail remains accessible by id
- if v2 removes the asset, current folder view no longer resolves it

Immutability:

- folder changes do not mutate `project_releases`
- folder changes do not mutate `project_release_assets`
- archiving a folder does not delete released assets

Media Library behavior:

- download behavior from folder-filtered views still uses Feature 077 warning behavior
- active tenant switching isolates folders and memberships
- no DAM fields or sync behavior are introduced

## Options considered

### Option 1 - organize immutable release asset rows directly

Summary:

- folder membership points at `project_release_assets.id`

Verdict:

- reject

Main reason:

- it organizes history rows, not current library assets

### Option 2 - use `source_asset_id` directly as the library key

Summary:

- folder membership points at `(tenant_id, project_id, source_asset_id)`

Verdict:

- viable fallback

Main tradeoff:

- smallest model, but weaker long-term library identity

### Option 3 - add a thin stable library asset identity and separate membership rows

Summary:

- add `media_library_assets`
- add `media_library_folders`
- add `media_library_folder_memberships`
- folder membership is one-folder-only for now via unique asset membership

Verdict:

- recommended

Main reason:

- best separation between immutable release truth and mutable organization metadata

## Recommended bounded direction

Recommendation:

- implement tenant-scoped `Folders` as mutable Media Library organization metadata on top of immutable release snapshots
- keep the current Media Library list/detail/download model intact
- introduce a thin stable library asset identity keyed by `(tenant_id, project_id, source_asset_id)`
- use flat tenant-wide folders
- use one active folder membership per library asset in the first slice
- resolve folder views to the latest published release asset for that stable identity
- preserve historical release detail by release asset id outside the folder model

This is the smallest safe direction because it:

- preserves release immutability
- preserves latest-release Media Library behavior
- keeps folder organization tenant-scoped, not release-scoped
- avoids pretending folders are part of publication truth
- leaves a clean seam for future DAM handoff without implementing DAM now

## Risks and tradeoffs

- introducing a stable identity table is slightly larger than direct `source_asset_id` membership, but the model is cleaner and more future-proof
- current folder views hiding assets removed from the latest release may surprise users unless the UI later surfaces an unavailable count
- keeping one-folder-only now is intentionally restrictive, but it matches the `folders` vocabulary and avoids accidental collection semantics
- if folder writes use admin/service clients only, write-RLS tests will be thinner; if authenticated write policies are added, the plan will need extra policy coverage
- the current finalize repair warning still hardcodes version `1`, which is not a folder problem but is a live nuance near release-version UX

## Explicit open decisions for the plan phase

1. Should archived folders be fully hidden, or should the UI include an archived-folder management view in the first slice?
2. Should active folder names be case-insensitively unique per tenant?
3. Should folder creation require an `Idempotency-Key`, or is conflict-safe unique-name behavior sufficient?
4. Should folder writes use authenticated write RLS, admin/service-role writes, or both?
5. Should the UI surface a count of memberships that no longer resolve to the latest release, or simply hide them in the first slice?
6. Should folder batch operations use one generic organize endpoint or separate add/move/remove route handlers?
7. Should `description` ship in the first slice, or should folder rows start with `name` only plus audit fields?
