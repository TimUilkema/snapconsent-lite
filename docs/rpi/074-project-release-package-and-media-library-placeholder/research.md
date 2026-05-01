# Feature 074 Research - Project release package and Media Library placeholder foundation

## Inputs reviewed

Primary inputs reviewed in the requested order:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/SUMMARY.md`
- `docs/rpi/070-tenant-rbac-and-organization-user-management-foundation/research.md`
- `docs/rpi/070-tenant-rbac-and-organization-user-management-foundation/plan.md`
- `docs/rpi/072-project-staffing-photographer-scoped-capture-workspaces-and-bounded-project-workflow-permissions/research.md`
- `docs/rpi/072-project-staffing-photographer-scoped-capture-workspaces-and-bounded-project-workflow-permissions/plan.md`
- `docs/rpi/073-workspace-handoff-and-project-finalization-foundation/research.md`
- `docs/rpi/073-workspace-handoff-and-project-finalization-foundation/plan.md`
- Prior RPI docs for export, review, consent scope, whole-asset linking, video, and release-adjacent behavior under:
  - `docs/rpi/043-simple-project-export-zip/`
  - `docs/rpi/060-project-unresolved-face-review-queue/`
  - `docs/rpi/061-link-consent-to-whole-asset/`
  - `docs/rpi/064-whole-asset-linking-for-video-assets/`
  - `docs/rpi/067-consent-scope-state-and-upgrade-requests/`
  - `docs/rpi/069-consent-upgrade-flow-owner-reuse-and-prefill-refinement/`
  - `docs/rpi/071-consent-upgrade-flow-headshot-reuse-and-upgrade-ux-fixes/`

Live implementation and schema inspected:

- Finalization and workflow:
  - `supabase/migrations/20260424110000_073_workspace_workflow_and_project_finalization.sql`
  - `src/lib/projects/project-workflow-service.ts`
  - `src/lib/projects/project-workflow-route-handlers.ts`
  - `src/app/api/projects/[projectId]/finalize/route.ts`
  - `src/lib/projects/project-workspace-request.ts`
  - `src/lib/projects/project-workspaces-service.ts`
  - `src/app/(protected)/projects/[projectId]/page.tsx`
  - `src/components/projects/project-workflow-controls.tsx`
- Export:
  - `src/lib/project-export/project-export.ts`
  - `src/lib/project-export/response.ts`
  - `src/app/api/projects/[projectId]/export/route.ts`
  - `tests/feature-043-simple-project-export-zip.test.ts`
- Assets and storage:
  - `supabase/migrations/20260305120000_004_assets_schema.sql`
  - `supabase/migrations/20260305121000_004_assets_rls.sql`
  - `supabase/migrations/20260305122000_004_assets_storage.sql`
  - `supabase/migrations/20260306100000_006_headshot_consent_schema.sql`
  - `supabase/migrations/20260421120000_062_video_asset_type.sql`
  - `supabase/migrations/20260423120000_072_project_workspaces_foundation.sql`
  - `supabase/migrations/20260423121000_072_project_workspace_access.sql`
  - `src/lib/assets/create-asset.ts`
  - `src/lib/assets/finalize-asset.ts`
  - `src/lib/assets/post-finalize-processing.ts`
  - `src/lib/assets/sign-asset-thumbnails.ts`
  - `src/lib/assets/sign-asset-playback.ts`
  - `src/app/api/projects/[projectId]/assets/route.ts`
- Matching, links, scopes, and review metadata:
  - `src/lib/matching/asset-preview-linking.ts`
  - `src/lib/matching/project-matching-progress.ts`
  - `src/lib/matching/face-materialization.ts`
  - `src/lib/matching/photo-face-linking.ts`
  - `src/lib/matching/whole-asset-linking.ts`
  - `src/lib/matching/project-face-assignees.ts`
  - `src/lib/matching/manual-asset-faces.ts`
  - `src/lib/matching/consent-photo-matching.ts`
  - `src/lib/consent/project-consent-scope-state.ts`
  - `src/lib/projects/current-one-off-consent.ts`
  - `src/lib/projects/project-participants-service.ts`
- Navigation and current protected app surface:
  - `src/components/navigation/protected-nav.tsx`
  - `src/app/(protected)/layout.tsx`
- Tests:
  - `tests/feature-073-project-workflow-foundation.test.ts`
  - `tests/feature-073-project-workflow-routes.test.ts`
  - `tests/feature-073-project-workflow-ui.test.tsx`

Source-of-truth rule used for this document:

- Live code and live migrations were treated as authoritative.
- Prior RPI docs and `docs/rpi/SUMMARY.md` were used as context only.
- Where prior docs drift from live implementation, this document calls out the drift and follows the live code.

## Verified current behavior

High-confidence live behavior summary:

- Feature 073 is implemented as stored workspace workflow state plus stored project finalization on `projects.finalized_at/finalized_by`.
- Project finalization is currently one-way in live code. There is no project reopen path. Workspace reopen exists only from `validated -> needs_changes` before project finalization.
- Finalization has no post-finalization side effects today. It does not create a release, queue a release, create an export, or touch library-like tables.
- Finalization is idempotent. Repeating the action after success returns the already-finalized project summary.
- Finalized projects are treated as read-only for capture, review, staffing, and default-template changes through the current workflow guards.
- Current export is still a separate, reviewer-only, workspace-scoped ZIP flow. It is not used as a stored release artifact.
- Current export remains photo-only. Videos can be uploaded, previewed, and linked in the project UI, but the export pipeline still filters `assets.asset_type = 'photo'`.
- There is no existing release schema, release service, Media Library route, Media Library navigation item, DAM sync table, or DAM placeholder field.
- Private media access today is server-authenticated and mostly delivered as short-lived signed URLs returned by server routes. Export is the main current server-streamed download path.
- Headshot assets are project support/reference assets with retention semantics and matching-specific use. They are not treated like normal deliverable project media.
- Canonical current link state is no longer stored in one place:
  - exact face links: `asset_face_consent_links`
  - whole-asset links: `asset_assignee_links`
  - historical/manual photo fallback rows still exist: `asset_consent_manual_photo_fallbacks`
  - hidden, blocked, and suppression states live in their own tables
  - manual faces live in `asset_face_materialization_faces` with `face_source = 'manual'`

Important drift from older RPI context:

- Earlier RPI context around export and fallback links predates the current `project_face_assignees` and `asset_assignee_links` layer. Live code now uses assignee-backed whole-asset links as the canonical current model, while some export logic still reads historical fallback rows separately.
- Earlier Feature 073 planning context described the finalization foundation conceptually. Live implementation is narrower: explicit `finalized_at/finalized_by`, no project reopen, no release side effects, and export remains available after finalization.

## Current finalization boundary

Live implementation details:

- Migration `20260424110000_073_workspace_workflow_and_project_finalization.sql` added:
  - `project_workspaces.workflow_state`
  - audit columns for handoff, validation, needs-changes, and reopen
  - `projects.finalized_at`
  - `projects.finalized_by`
- `src/lib/projects/project-workflow-service.ts` is the main authority for workflow derivation and mutation rules.

Current workflow model:

- Workspace workflow states:
  - `active`
  - `handed_off`
  - `needs_changes`
  - `validated`
- Derived project workflow states:
  - `active`
  - `ready_to_finalize`
  - `finalized`

How finalization works in live code:

- `finalizeProject(...)` loads the current project row and derived project workflow summary.
- Finalization is allowed only when:
  - project status is not `archived`
  - project is not already finalized
  - derived workflow state is `ready_to_finalize`
- `ready_to_finalize` is derived when:
  - all visible project workspaces are in `validated`
  - there are no validation blockers
- Validation blockers currently include:
  - matching still in progress
  - degraded matching state
  - uploaded photos still in `pending`
  - photos still in `needs_review`
  - active one-off invites
  - pending recurring project consent requests
  - pending consent upgrade requests
- On success, finalization only updates:
  - `projects.finalized_at`
  - `projects.finalized_by`
- The update is guarded with `.is("finalized_at", null)`, so retries are safe.

Is finalization reversible?

- Not at the project level in live code.
- There is no route, helper, or migration support for clearing `projects.finalized_at`.
- Workspace reopen exists only before project finalization and only from `validated -> needs_changes`.

What is locked after finalization?

- `assertProjectWorkflowMutable(...)` rejects finalized projects with `409 project_finalized`.
- Current capture/review/staffing/default-template mutation paths use this guard directly or indirectly:
  - workspace staffing route
  - workspace-scoped capture/review mutation access helpers
  - template default update through `setProjectDefaultTemplate(...)`
  - public submissions are blocked once the project is finalized
- Project page UI also renders finalized read-only messaging and disables the relevant project actions.

What is not locked after finalization?

- Export is still allowed after finalization. `tests/feature-073-project-workflow-foundation.test.ts` explicitly verifies that finalization does not block export.
- Read access to project data remains available subject to normal project/workspace permissions.

Does finalization currently call post-finalization side effects?

- No.
- The finalize route (`POST /api/projects/[projectId]/finalize`) resolves auth, tenant, visible workspace scope, and review permission, then calls `finalizeProject(...)` using `createAdminClient()`.
- No release service, no ZIP generation, no library row creation, and no async follow-up are wired in.

Safest seam for release creation:

- The cleanest seam is immediately after `finalizeProject(...)` succeeds, from the server-side finalize route/handler path.
- Reasons:
  - finalization is already the explicit user action for "publish the reviewed project state"
  - the route already has the authenticated actor, tenant scope, and review authorization
  - the project state is already guaranteed to be release-ready at that moment
  - there is currently no other release-adjacent action to piggyback on

Important implementation constraint:

- The finalization write itself is tiny, but release snapshot assembly will be larger and multi-row.
- That argues against one giant finalization-plus-snapshot transaction in the first slice unless a dedicated DB-side transaction helper is introduced.
- It favors: finalize first, then call an idempotent release snapshot service immediately afterward.

## Current export and snapshot-like behavior

Current export path:

- Route: `GET /api/projects/[projectId]/export`
- Service entry: `createProjectExportResponse(...)`
- Data loader: `loadProjectExportRecords(...)`
- Assembler: `buildPreparedProjectExport(...)`

Permissions and scope:

- Export requires authentication and an active tenant membership.
- Export requires explicit or auto-resolved workspace selection through `resolveProjectWorkspaceSelection(...)`.
- Export requires reviewer-capable workspace permissions (`canReviewProjects`).
- Export is workspace-scoped, not whole-project scoped.

What export includes today:

- Uploaded, non-archived photo assets only.
- One-off consent rows for the selected project/workspace.
- Current face materialization data for those photos.
- Face boxes and face ranks.
- Exact face links from `asset_face_consent_links`.
- Whole-asset links from `asset_assignee_links`.
- Historical/manual photo fallback links from `asset_consent_manual_photo_fallbacks`.
- Effective scope states for linked owners via `loadProjectConsentScopeStatesByConsentIds(...)` and `loadProjectConsentScopeStatesByParticipantIds(...)`.
- Signed scope projections from `project_consent_scope_signed_projections`.
- Sidecar JSON per asset and per consent.
- Original binary asset files streamed into the ZIP through server-side storage download.

What export omits today:

- Videos.
- Headshot assets.
- Hidden-face state.
- Blocked-face state.
- Face suppression state.
- Manual-face provenance in the asset JSON.
- Release/version metadata, because releases do not exist yet.
- Any stored immutable snapshot row. Export is generated on demand.

How export handles photos versus videos:

- Photos:
  - loaded from `assets` with `asset_type = 'photo'`
  - materialization and face data included
  - exact face, whole-asset, and fallback link data included
- Videos:
  - omitted entirely from export today
  - live project UI supports them, but export does not

Workspace-scoped versus project-scoped export behavior:

- Asset and consent row selection are workspace-scoped.
- Effective scope resolution is project-scoped by project/tenant and the linked owner IDs.
- Export file naming and ZIP assembly are export-specific formatting concerns, not neutral snapshot concerns.

Can release snapshot assembly reuse export helpers safely?

Partial reuse only.

Good candidates to reuse or adapt:

- source row loading patterns for assets, face materialization, face rows, assignee display, and scope state helpers
- filename-independent metadata assembly logic for photo face/link structures

Reasons not to reuse the export assembler directly:

- export is workspace-scoped, while release should be project-scoped across finalized workspaces
- export is photo-only, while release should likely include both photos and videos
- export output shape is ZIP/sidecar oriented, not normalized for in-app library reads
- export currently ignores hidden/blocked/suppression/manual-face snapshot needs
- export still carries historical fallback-table behavior that should be treated carefully in a new release service

Recommendation:

- Build a separate internal release snapshot service.
- That service may borrow low-level readers and shape conventions from export, but should not reuse the ZIP assembler as the release package implementation.

## Current asset, storage, and download behavior

Current asset model:

- `assets` is the source table for project asset records.
- Important columns now include:
  - `tenant_id`
  - `project_id`
  - `workspace_id`
  - `storage_bucket`
  - `storage_path`
  - `original_filename`
  - `content_type`
  - `file_size_bytes`
  - `status`
  - `uploaded_at`
  - `archived_at`
  - `asset_type`
  - `content_hash`
  - `content_hash_algo`
  - `retention_expires_at`

Current asset types in live code:

- `photo`
- `headshot`
- `video`

Asset-type behavior relevant to Feature 074:

- `photo`
  - primary review and export asset type today
  - has face materialization, exact-face linking, hidden/block/manual state, and whole-asset linking support
- `video`
  - supported for upload, preview, thumbnails/posters, playback, and whole-asset linking
  - not included in current export
  - no face-materialization path in current workflow
- `headshot`
  - support asset used for consent/project participant matching
  - has retention semantics
  - can be linked to consents
  - not a deliverable/media-library style asset in current product shape

Should headshots appear as Media Library release assets?

- Recommendation: no.
- Reasons grounded in live code:
  - headshots are treated as matching/reference inputs, not normal deliverables
  - headshots have retention handling that does not apply to normal project media
  - export excludes them
  - library/dam foundation should start from project photos/videos, not internal matching support assets

How original storage is represented:

- Original files stay in Supabase Storage bucket `project-assets`.
- Object path pattern from live code:
  - `tenant/<tenantId>/project/<projectId>/asset/<assetId>/<sanitizedFilename>`
- `storage_bucket` and `storage_path` are stored on the asset row and reused across preview/export flows.

How signed URLs are generated today:

- Image display URLs:
  - `src/lib/assets/sign-asset-thumbnails.ts`
  - creates short-lived signed URLs via a service-role client
  - can return derivative URLs, transform fallbacks, or original-object URLs
- Video playback URLs:
  - `src/lib/assets/sign-asset-playback.ts`
  - creates short-lived signed original-object URLs
- Export:
  - uses server-side `storage.download(...)`
  - streams data into a ZIP rather than returning signed URLs

Current download/original access pattern:

- There is no general "download original asset" route today for project assets.
- Private read access is mainly exposed as server-returned signed URLs for preview/playback and as server-streamed export ZIPs.

Should release assets reference source storage objects or copy them?

- Recommendation: reference the existing storage objects.
- Reasons:
  - non-negotiable requirement says release must not destructively move project assets
  - there is no current retention/delete logic for photos/videos that would force duplication
  - copying would increase implementation size and storage cost immediately
  - release snapshot rows can stay immutable while still pointing at the source object coordinates

Retention and delete behavior to account for:

- Headshots have retention expiry and should stay outside release media assets.
- Photos/videos use normal asset rows with `status = uploaded` and `archived_at` for duplicate/archive handling.
- No live code indicates automatic deletion of uploaded project photos/videos after finalization.
- Release download behavior still needs to handle missing source objects defensively because export already treats missing objects as a possible failure mode.

## Current consent, link, and review metadata sources

This is the live source-of-truth map for snapshotting.

### Source asset and workspace metadata

- Asset source rows:
  - `assets`
- Workspace source rows:
  - `project_workspaces`
- Photo materialization and face geometry:
  - `asset_face_materializations`
  - `asset_face_materialization_faces`

### One-off current consents

- Primary table:
  - `consents`
- Relevant live semantics:
  - one-off consent history remains immutable
  - current UI filters use `superseded_at is null`
  - active/revoked state still depends on `revoked_at`
- Current helper for hiding superseded one-off rows in UI:
  - `filterCurrentOneOffInviteRows(...)`
  - `filterCurrentOneOffPeopleOptions(...)`

### Recurring project consents

- Primary tables:
  - `project_profile_participants`
  - `recurring_profile_consent_requests`
  - `recurring_profile_consents`
- Current helper for recurring participant consent state:
  - `loadProjectRecurringConsentStateByParticipantIds(...)`
- States surfaced in live code:
  - `missing`
  - `pending`
  - `signed`
  - `revoked`

### Project face assignees

- Canonical owner bridge table:
  - `project_face_assignees`
- Assignee kinds:
  - `project_consent`
  - `project_recurring_consent`
- Main helper:
  - `loadProjectFaceAssigneeDisplayMap(...)`

### Exact-face links

- Source table:
  - `asset_face_consent_links`
- Current read helpers:
  - `listLinkedFaceOverlaysForAssetIds(...)`
  - `listPhotoConsentAssignmentsForAssetIds(...)`
- Important live behavior:
  - current exact links are validated against the current materialization when surfaced
  - link ownership is expressed through `project_face_assignee_id`

### Whole-asset links

- Canonical current table:
  - `asset_assignee_links`
- Current helper:
  - `loadCurrentWholeAssetLinksForAssets(...)`
- Applies to:
  - photos
  - videos
- Ownership is assignee-backed, not raw-consent-backed.

### Manual fallback links

- Historical/manual zero-face photo fallback table:
  - `asset_consent_manual_photo_fallbacks`
- Related suppression table:
  - `asset_consent_manual_photo_fallback_suppressions`
- Important live drift:
  - current whole-asset assignment flow writes to `asset_assignee_links`
  - export still reads `asset_consent_manual_photo_fallbacks` separately
  - some current review helpers map consent-backed `asset_assignee_links` rows back into fallback-like structures for photo review logic
- Release snapshot logic should keep fallback as a distinct concept, but it should not assume that the fallback table alone represents all whole-asset state.

### Hidden face state

- Source table:
  - `asset_face_hidden_states`
- Current helper:
  - `loadCurrentHiddenFacesForAssets(...)`
- Current-state rule:
  - only rows with `restored_at is null`
  - only rows whose `asset_materialization_id` still matches the current materialization
  - stale rows are actively marked inactive by the helper

### Blocked face state

- Source table:
  - `asset_face_block_states`
- Current helper:
  - `loadCurrentBlockedFacesForAssets(...)`
- Current-state rule:
  - only rows with `cleared_at is null`
  - only rows whose `asset_materialization_id` still matches the current materialization
  - stale rows are actively marked inactive by the helper

### Suppressions

- Face/assignee suppression table:
  - `asset_face_assignee_link_suppressions`
- Current helper:
  - internal `loadCurrentFaceSuppressionsForAssets(...)` in `photo-face-linking.ts`
- Semantics:
  - suppresses future auto-assignment or re-link behavior for a face/assignee pair
  - reasons include `manual_unlink` and `manual_replace`

### Manual faces

- Stored in:
  - `asset_face_materialization_faces`
- Distinguishing column:
  - `face_source = 'manual'`
- Manual faces are part of the current materialization and preserved across detector rematerialization.

### Consent-scope effective state

- Effective state table:
  - `project_consent_scope_effective_states`
- Signed projection table:
  - `project_consent_scope_signed_projections`
- Helpers:
  - `loadProjectConsentScopeStatesByConsentIds(...)`
  - `loadProjectConsentScopeStatesByParticipantIds(...)`
- Live behavior:
  - helpers prefer effective state rows
  - if effective rows are missing, they fall back to the stored signed snapshot plus catalog data

### Superseded and revoked behavior

- One-off consents:
  - immutable historical rows in `consents`
  - active/current filtering depends on `superseded_at` and `revoked_at`
- Recurring project consents:
  - immutable historical rows in `recurring_profile_consents`
  - active/current filtering depends on `superseded_at` and `revoked_at`
- Release snapshotting should preserve current-state interpretation at release time without mutating consent history.

### Video whole-asset linking

- Videos participate in:
  - `assets.asset_type = 'video'`
  - `asset_assignee_links`
- Videos do not currently participate in:
  - face materialization
  - exact-face links
  - photo fallback rows
  - current export ZIP

### Export metadata JSON

Current export metadata sidecars already encode:

- asset core metadata
- photo face geometry
- exact-face links
- whole-asset links
- fallback links
- linked owner effective scopes
- consent signed/effective scope state

Current export metadata sidecars do not encode:

- hidden face rows
- blocked face rows
- face suppressions
- manual face provenance
- release/version identity
- project-wide cross-workspace snapshot context

Implication for Feature 074:

- The live code already has enough source tables/helpers to build a bounded release snapshot without inventing new review logic.
- The missing work is snapshot orchestration and immutable storage shape, not foundational metadata availability.

## Release creation timing options

### Option A - Create release inside the same finalization write path

Description:

- Finalize the project and create all release rows as one tightly-coupled operation.

Pros:

- single user action
- no finalized-without-release gap from the user's point of view
- simplest mental model

Cons:

- release snapshot assembly is materially larger than the current finalization update
- more failure surface inside the finalize request
- harder to keep the finalization write small and reliable
- awkward if snapshot creation partly succeeds and needs repair

Assessment:

- Good UX, but too coupled for the current repo shape unless a dedicated transactional helper is added.

### Option B - Finalize first, then immediately call an idempotent release snapshot service

Description:

- Keep the finalization write as-is.
- After it succeeds, synchronously invoke `ensureProjectReleaseSnapshot(...)` in the finalize route/handler.

Pros:

- preserves the current explicit finalization action
- still feels like a one-step UX
- easier to reason about retries
- makes "finalized but missing release" repairable by rerunning the release service
- clean seam for later backgrounding if snapshot cost grows

Cons:

- there is a real gap where finalization may succeed and release creation may fail
- requires explicit repair/retry handling

Assessment:

- Best fit for the live implementation and first-slice scope.

### Option C - Separate explicit post-finalization "Create release package" action

Description:

- Finalization only locks the project.
- A second user action creates the release.

Pros:

- easiest to isolate failures
- simplest implementation sequencing

Cons:

- worse UX
- easy to leave finalized projects without releases
- creates product ambiguity around whether finalization is actually publish-ready
- adds a second operator step for something that should usually be automatic

Assessment:

- Not recommended for Feature 074 unless synchronous release creation proves too expensive.

### Option D - Async worker/job after finalization

Description:

- Finalization enqueues release creation.
- A worker later builds the release snapshot.

Pros:

- best for very large snapshots
- shortest request latency

Cons:

- there is no current release job foundation
- introduces more infrastructure than this bounded slice needs
- more moving parts for retries, observability, and partial failure
- delays first user visibility in Media Library

Assessment:

- Reasonable future direction if snapshots become heavy, but overbuilt for the first slice.

### Recommendation

- Use Option B.
- Concretely:
  - `finalizeProject(...)` remains the explicit state transition.
  - finalize route calls a new server-only idempotent release snapshot service immediately afterward.
  - if release creation fails, the project remains finalized and read-only.
  - add a repairable server seam so the same service can be retried safely for the same finalization event.

Why this is the best seam:

- It matches the live Feature 073 implementation.
- It keeps transaction size bounded.
- It preserves UX simplicity.
- It supports retry-safe repair without exposing a separate user-facing "publish release" workflow yet.

## Release data model options

### Option A - Minimal release tables with JSON snapshots

Shape:

- `project_releases`
- `project_release_assets`
- rich asset-level JSONB snapshots

Pros:

- smallest implementation
- easy immutability story
- flexible for snapshot breadth
- fits current repo tendency to shape read models in TypeScript

Cons:

- less queryable if later library filters become richer
- JSON shape discipline must be maintained carefully

### Option B - More normalized release snapshot tables

Shape:

- `project_releases`
- `project_release_assets`
- separate release faces, release links, release people, release scopes, and so on

Pros:

- highly queryable
- explicit relational shape

Cons:

- largest implementation by far
- duplicates a lot of live review schema
- highest migration and maintenance cost
- not justified by the first-slice Media Library requirements

### Option C - Reuse export ZIP as the release package

Shape:

- store a release row plus a generated export artifact path/blob

Pros:

- fastest path if the ZIP were already the right product object

Cons:

- export is workspace-scoped and photo-only
- export is not a stable internal read model
- difficult to query for Media Library
- mixes audit/snapshot concerns with delivery formatting
- makes video inclusion awkward

Assessment:

- Not a good fit.

### Option D - Hybrid normalized parent/asset rows plus JSONB detail snapshots

Shape:

- normalized `project_releases`
- normalized `project_release_assets`
- JSONB snapshots for consent/link/review/scope details on each released asset

Pros:

- good balance of implementation size and queryability
- easy to drive a basic Media Library list/detail UI
- keeps release identity relational
- stores immutable detail snapshots without recreating the full review schema
- future DAM sync can join stable IDs and also read snapshot JSON

Cons:

- some JSON duplication remains
- later richer filtering may require promoting a few JSON fields into columns

### Comparison summary

| Option | Implementation size | Immutability | Media Library queryability | Future v2 fit | Future DAM fit | Fit with live repo |
| --- | --- | --- | --- | --- | --- | --- |
| A | Small | Good | Fair | Good | Fair | Good |
| B | Large | Good | Excellent | Good | Excellent | Weak for first slice |
| C | Small-medium | Weak | Weak | Weak | Weak | Weak |
| D | Medium | Good | Good | Good | Good | Best overall |

### Recommendation

- Use Option D.
- Keep parent and asset release rows relational.
- Use JSONB for the detailed snapshot payloads instead of creating release-face/release-link/etc tables in Feature 074.

## Candidate first-slice schema

Recommended schema direction:

### `project_releases`

Recommended columns:

- `id uuid primary key`
- `tenant_id uuid not null`
- `project_id uuid not null`
- `release_version integer not null`
- `status text not null`
- `created_by uuid not null`
- `created_at timestamptz not null default now()`
- `source_project_finalized_at timestamptz not null`
- `source_project_finalized_by uuid not null`
- `snapshot_created_at timestamptz null`
- `project_snapshot jsonb not null`

Recommended constraints and indexes:

- foreign key `(project_id, tenant_id) -> projects(id, tenant_id)`
- unique `(tenant_id, project_id, release_version)`
- unique `(tenant_id, project_id, source_project_finalized_at)`
- check `release_version >= 1`
- check `status in ('building', 'published')`
- index `(tenant_id, project_id, created_at desc)`
- index `(tenant_id, created_at desc)`

Notes:

- `release_version` should be unique per `(tenant_id, project_id)`.
- First release should always be version `1`.
- `status` should stay minimal. `building` plus `published` is enough to support retry-safe creation without inventing a full workflow engine.
- `project_snapshot` should capture at least:
  - project name
  - project status at release time
  - finalized timestamps/actor
  - included workspace ids and names

### `project_release_assets`

Recommended columns:

- `id uuid primary key`
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

Recommended constraints and indexes:

- foreign key `(release_id, tenant_id) -> project_releases(id, tenant_id)` or equivalent scoped FK
- foreign key `(project_id, tenant_id) -> projects(id, tenant_id)`
- unique `(release_id, source_asset_id)`
- index `(tenant_id, release_id, created_at asc)`
- index `(tenant_id, project_id, workspace_id, created_at desc)`
- index `(tenant_id, asset_type, created_at desc)`
- check `asset_type in ('photo', 'video')`

Refinements to the user's candidate shape:

- keep `source_asset_id` as the column name to make snapshot semantics explicit
- add `original_storage_bucket` as a real column; path alone is not enough for download
- prefer immutable snapshot columns over a mutable `release_status` on each asset row
- use `workspace_snapshot jsonb` instead of relying only on live `project_workspaces` joins later

Fields to defer for now:

- `superseded_by_release_id`
- `dam_sync_status`
- `dam_sync_error`
- asset-level DAM ids or DAM sync state

Reason to defer:

- versioned releases already preserve future v2 compatibility
- DAM integration is out of scope and does not need placeholder columns to remain possible
- deferring these fields keeps the first schema smaller and clearer

Feature 074 creation rule:

- only create version `1`
- schema should allow version `2+` later, but Feature 074 should not expose a path that uses it

## Release eligibility and asset inclusion

Recommended first-slice inclusion rules:

- include assets from all validated workspaces in the finalized project
- include only `assets.status = 'uploaded'`
- exclude `archived_at is not null`
- include `asset_type in ('photo', 'video')`
- exclude `asset_type = 'headshot'`

Detailed recommendations:

### All validated workspaces versus one workspace

- Release should be project-scoped, not workspace-scoped.
- Finalization already represents a project-wide ready state.
- A project release that only includes one workspace would not match the product concept.

### Photos only versus photos and videos

- Recommendation: include both photos and videos.
- Reasons:
  - videos are a live supported project asset type
  - videos already support whole-asset linking and playback
  - Feature 074 is a release foundation, not a reimplementation of the old export ZIP scope
  - excluding videos now would create avoidable rework in v2

### Headshots

- Exclude from release media assets.
- They remain support assets for matching/reference workflows.

### Blocked and hidden faces

- Include the asset row.
- Snapshot the blocked/hidden state in metadata.
- Do not exclude an asset just because one or more faces are hidden or blocked.

### Assets with no links

- Include them if they are part of the finalized project and meet asset eligibility.
- Reasons:
  - Media Library is an internal consumption view, not external publishing
  - finalized review state may intentionally resolve an asset without active links
  - release snapshot should preserve the finalized source-of-truth outcome, not silently drop assets

### Whole-asset linked videos

- Include.
- This is the only current link mode videos have.

### Hidden/suppressed/manual state

- Treat these as snapshot metadata, not inclusion filters.

### Export rule reuse

- Do not mirror export rules exactly.
- Export remains:
  - workspace-scoped
  - reviewer download oriented
  - photo-only
- Release should intentionally differ:
  - project-scoped
  - snapshot oriented
  - photos plus videos

## Snapshot content boundary

Recommended bounded minimum snapshot per released asset:

### Must snapshot now

- Asset metadata snapshot:
  - source asset id
  - original filename
  - content type
  - file size
  - uploaded timestamp
  - storage bucket/path references
  - image/video dimensions when available
  - photo materialization summary when relevant
- Workspace/source project snapshot:
  - source project id and name
  - source workspace id, name, and kind
  - project finalized timestamp and actor
  - release id and release version
- Consent/owner snapshot:
  - linked assignee summaries
  - identity kind (`project_consent` or `project_recurring_consent`)
  - one-off consent current status at release time
  - recurring project consent state at release time where linked
- Exact-face link snapshot:
  - face id
  - face rank
  - assignee id
  - consent/participant ids
  - link source
  - match confidence
- Whole-asset link snapshot:
  - assignee-backed links for photos/videos
- Fallback link snapshot:
  - historical/manual zero-face photo fallback concept kept distinct
- Review snapshot:
  - hidden face rows
  - blocked face rows
  - face/assignee suppressions
  - manual face rows
  - enough face geometry to show what was linked or hidden at release time
- Scope snapshot:
  - effective scope states for linked owners
  - signed scope data for one-off linked consents when available

### Can defer

- release-level audit dashboard aggregates
- separate normalized release face/link/scope tables
- full replayable export sidecar JSON storage
- derivative URL state
- advanced search-oriented denormalized fields
- DAM sync status models
- withdrawal/restriction lifecycle state beyond whatever the linked consent snapshot already shows

Recommended snapshot shape boundary:

- parent row stores project-level snapshot metadata
- asset row stores immutable detail snapshots
- JSON should be shaped for:
  - Media Library list/detail reads
  - later DAM payload assembly
  - release audit/debug inspection

Why this minimum is enough:

- basic Media Library list/detail can be built from it
- release history is auditable
- future DAM sync can read immutable source metadata from the release row rather than re-reading mutable project tables
- future v2 can add another release row without changing the first-slice model

## Media Library access and permissions

Live permission baseline:

- Tenant membership is always required.
- Owners/admins/reviewers can review/export project workspaces.
- Photographers can only access their assigned project workspaces.
- Project/workspace access is enforced today through workspace-aware permission helpers and RLS.

First-slice access model options:

### Option A - Reuse reviewer/export access

- Owners/admins/reviewers can read the Media Library and download originals.
- Photographers cannot.

Pros:

- best match to current finalized/release authority
- easiest to reason about
- avoids turning Media Library into a broad tenant media browser for capture-only users

Cons:

- more restrictive than possible future DAM/client-consumption use cases

### Option B - All tenant members can read released assets

Pros:

- simpler tenant-wide library concept

Cons:

- broadens access beyond current review/export expectations
- photographers would gain cross-workspace visibility after release
- higher risk for a first slice

### Option C - Workspace-aware release visibility

- release assets remain filtered by workspace visibility after release

Pros:

- closest to existing project-workspace access model

Cons:

- does not fit the product concept of a post-finalization internal library well
- makes release consumption more complicated
- gets in the way of future tenant-level DAM usage

### Recommendation

- Use Option A for Feature 074.
- Owners/admins/reviewers can:
  - list releases in Media Library
  - open released asset detail
  - download released originals
- Photographers/capture-only users should not get Media Library access in the first slice.

Why:

- It matches current "review/export/finalization" authority.
- It keeps the first slice bounded.
- It avoids accidental widening of asset visibility during the initial release foundation.

Post-release visibility scope:

- Recommended read scope is tenant-level within reviewer-capable roles, not workspace-aware.
- Release rows are snapshot/consumption artifacts, not capture workspaces.
- Workspace ids should remain in the snapshot for traceability, not for first-slice read gating.

## Media Library UI boundary

Current protected navigation:

- protected top nav items are currently:
  - `/dashboard`
  - `/projects`
  - `/members`
  - `/profiles`
  - `/templates`
- there is no existing Media Library route

Recommended minimal first-slice UI:

- route:
  - `/media-library`
- navigation:
  - add a primary protected nav item labeled `Media Library`
  - show it only to owner/admin/reviewer roles
- list page:
  - released assets across the active tenant
  - default sort: newest release first, then newest asset within release
  - simple columns/cards:
    - preview thumbnail/poster
    - original filename
    - asset type
    - project name
    - release version
    - source workspace name
    - linked people count
    - release created date
- detail page:
  - `/media-library/[releaseAssetId]` or equivalent
  - read-only
  - show:
    - original asset preview/playback
    - project and workspace source
    - release/version metadata
    - linked people/assignees snapshot
    - exact-face / whole-asset / fallback snapshot summary
    - hidden/blocked/manual/suppression snapshot where relevant
    - effective scope metadata snapshot
    - download original action

Explicit non-goals for the UI:

- no folders or collections
- no editing
- no public sharing
- no advanced search/filtering
- no DAM management surface
- no "umbrella project" wording

Recommendation:

- Keep the first slice to a normal list page plus a normal detail page.
- Do not build a full asset-management shell or secondary dashboard.

## Download and original-file delivery

Current live pattern:

- previews/playback are usually delivered as short-lived signed URLs
- export is the only current server-streamed original download path

Media Library download options:

### Option A - Return signed URLs directly from the library API/detail route

Pros:

- minimal implementation

Cons:

- pushes more storage details into UI responses
- harder to centralize download authorization and audit later
- easy for future callers to start depending on raw storage paths/URL patterns

### Option B - Add a dedicated server-side release download route

Example:

- `GET /api/media-library/assets/[releaseAssetId]/download`

Behavior:

- authenticate user
- resolve active tenant server-side
- authorize owner/admin/reviewer access
- read release asset row
- sign the referenced original object or stream it
- never expose raw storage coordinates to the client

Pros:

- keeps authorization server-controlled
- cleanly decouples UI from storage coordinates
- easy place to handle missing source objects
- better foundation for later audit logging or DAM fallback

Cons:

- one extra route to build

### Recommendation

- Use Option B.
- For Feature 074, the route can redirect to or return a short-lived signed URL after authorization.
- Streaming bytes through the app is not necessary for the first slice unless product wants download filenames/content-disposition fully controlled server-side.

Missing source object behavior:

- If the release row exists but the source storage object is missing:
  - keep the release row immutable
  - return a controlled 404/409-style error from the download route
  - do not mutate or delete the release snapshot to hide the problem

## RLS and server authority

Release creation authority:

- Release creation should be server-only.
- Do not accept `tenant_id` from the client.
- Use the finalized project row plus server-resolved tenant/auth context as the source of truth.

Recommended write model:

- permission check with the authenticated user-scoped client
- create snapshot rows with a server-side admin/service client, consistent with current finalization/export patterns

Why not client-side writes:

- release creation must remain authoritative and retry-safe
- snapshot creation reads across many tables and should not depend on broad client RLS write access

Recommended RLS for new tables:

### `project_releases`

- select:
  - tenant-scoped and limited to reviewer-capable tenant members
- insert/update/delete:
  - no general client writes
  - service role / server path only

### `project_release_assets`

- select:
  - tenant-scoped and limited to reviewer-capable tenant members
- insert/update/delete:
  - no general client writes
  - service role / server path only

Implementation note:

- current workspace RLS helpers are workspace-aware, but Media Library should be tenant/reviewer scoped in the first slice
- add new RLS helpers for release reads rather than reusing workspace visibility rules blindly

Controlled download authorization:

- the Media Library download route should authorize off the release row plus tenant membership/role
- it should not rely on direct storage object policies alone as the primary app-level check

## DAM compatibility extension points

Minimal extension points considered:

- release id
- release version
- source project id
- source workspace ids
- source asset ids
- immutable metadata snapshot

Potential placeholder fields considered:

- `dam_sync_status`
- `dam_sync_error`
- `external_dam_asset_id`
- release-target or media-destination tables

Recommendation:

- Defer DAM-specific columns and tables for Feature 074.

Why deferring is safe:

- stable release ids and source ids already create the needed integration seam
- immutable snapshot JSON is more useful than placeholder sync fields without real sync logic
- versioned release rows already support later outbound sync retries and v2 updates

What should exist now to avoid blocking future DAM work:

- stable release-level primary key
- stable release asset primary key
- `release_version`
- `source_asset_id`
- `project_id`
- `workspace_id`
- immutable snapshot JSON with consent/link/review/scope details

What can wait:

- sync status fields
- external DAM ids
- target tables
- per-asset restriction lifecycle state beyond what consent/revocation snapshot already exposes

## Recommended bounded direction

Recommended Feature 074 direction:

1. Keep Feature 073 finalization as the explicit publish boundary.
2. After successful finalization, immediately call a new idempotent server-side release snapshot service.
3. Store a project-scoped, versioned, immutable release snapshot:
   - one parent `project_releases` row
   - one `project_release_assets` row per released photo/video
4. Reference source storage objects instead of copying files.
5. Build a read-only Media Library on top of those release rows.
6. Keep access limited to owner/admin/reviewer roles.
7. Defer correction mode, re-release v2 workflow, DAM sync fields, and advanced library management.

Recommended release creation contract:

- input:
  - tenant id from server auth context
  - project id
  - authenticated actor id
- preconditions:
  - project exists in tenant
  - project is finalized
  - release for `source_project_finalized_at` does not already exist as `published`
- output:
  - existing published release if already created
  - newly created release if missing

Recommended immutability model:

- published release rows are immutable
- project/workspace source tables remain the editing/review source of truth
- Media Library reads only from release rows

Recommended first-slice tests to add in the plan/implementation phase:

- release creation succeeds only for finalized projects
- release creation is forbidden before finalization
- retrying release creation for the same finalized project is idempotent
- first release version is `1`
- `source_asset_id` and `workspace_id` are written correctly
- photos and videos are included, headshots are excluded
- finalized project export behavior remains unchanged
- release creation does not mutate or move source assets
- Media Library list/detail access is restricted to owner/admin/reviewer
- Media Library download is authorized and tenant-isolated
- published release rows are read-only after creation

## Risks and tradeoffs

- Finalize-then-snapshot means there can be a temporary finalized-without-release gap if snapshot creation fails. This is acceptable only if retry/repair is designed in from the start.
- Reusing export logic too directly would bake in photo-only, workspace-scoped, and ZIP-specific assumptions that do not match the release package concept.
- Keeping release details mostly in JSONB is the right first-slice tradeoff, but some fields may need promotion into columns later if the Media Library grows beyond a simple list/detail UI.
- Referencing source storage objects avoids duplication now, but it means release downloads depend on continued source object availability. The download route must handle missing-object failures cleanly.
- Excluding photographers from the first-slice Media Library is conservative and consistent with current review authority, but future product direction may want broader tenant-level read access.
- Deferring DAM placeholder fields keeps the schema cleaner, but later DAM work will need a migration once the real sync contract is known.

## Open decisions for the plan phase

- Should release creation return a user-visible partial-success state if finalization succeeds but snapshot creation fails, or should the finalize route fail hard and rely on operator retry? The repair path is clear either way, but the UX choice should be explicit.
- Should the release snapshot service build the parent and asset rows through plain server-side Supabase upserts, or is this the right point to introduce a dedicated transactional DB function/RPC?
- What exact parent-level `project_snapshot` shape should be stored in `project_releases`?
- Should the Media Library detail route expose a normalized response shape assembled from multiple JSON blobs, or should the release asset row store one pre-shaped detail payload for simpler reads?
- How should fallback links be represented in the release snapshot for zero-face photos when both `asset_assignee_links` and historical fallback tables may be relevant?
- Should the first-slice Media Library list show all released assets across the tenant, or group/filter by release by default?
- Should the download route redirect to a short-lived signed URL or stream bytes directly for better control over filename/content-disposition?
- Should there be a lightweight internal repair action for "create missing release snapshot for finalized project," or is an internal service call invoked by the finalize route enough for the first slice?
