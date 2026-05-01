# Feature 079 - Project correction media intake and release asset additions - Plan

## Inputs and ground truth

### Inputs reviewed
- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `UNCODEXIFY.md`
- `docs/rpi/README.md`
- `docs/rpi/SUMMARY.md`
- `docs/rpi/079-project-correction-media-intake-and-release-asset-additions/research.md`

### Live verification used for planning
- `src/lib/projects/project-workflow-service.ts`
- `src/lib/projects/project-workspace-request.ts`
- `src/lib/assets/create-asset.ts`
- `src/lib/assets/finalize-asset.ts`
- `src/lib/assets/prepare-project-asset-batch.ts`
- `src/lib/assets/finalize-project-asset-batch.ts`
- `src/lib/assets/post-finalize-processing.ts`
- `src/lib/assets/asset-upload-policy.ts`
- `src/app/api/projects/[projectId]/assets/route.ts`
- `src/app/api/projects/[projectId]/assets/preflight/route.ts`
- `src/app/api/projects/[projectId]/assets/batch/prepare/route.ts`
- `src/app/api/projects/[projectId]/assets/batch/finalize/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`
- `src/lib/projects/project-asset-review-list.ts`
- `src/lib/matching/project-matching-progress.ts`
- `src/lib/matching/auto-match-trigger-conditions.ts`
- `src/lib/matching/whole-asset-linking.ts`
- `src/lib/project-releases/project-release-service.ts`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/components/projects/assets-upload-form.tsx`
- `src/components/projects/assets-list.tsx`
- `supabase/migrations/20260423121000_072_project_workspace_access.sql`
- `supabase/migrations/20260424130000_074_project_releases_media_library_foundation.sql`
- `supabase/migrations/20260424150000_075_project_correction_re_release_foundation.sql`
- `supabase/migrations/20260425120000_078_media_library_folders_foundation.sql`
- `messages/en.json`
- `messages/nl.json`
- `tests/feature-024-upload-performance-resumability.test.ts`
- `tests/feature-038-asset-image-derivatives.test.ts`
- `tests/feature-062-video-upload-foundation.test.ts`
- `tests/feature-073-project-workflow-foundation.test.ts`
- `tests/feature-073-project-workflow-routes.test.ts`
- `tests/feature-073-project-workflow-ui.test.tsx`
- `tests/feature-074-project-release-media-library.test.ts`
- `tests/feature-074-media-library-download.test.ts`
- `tests/feature-075-project-correction-workflow.test.ts`
- `tests/feature-076-correction-consent-intake-foundation.test.ts`
- `tests/feature-076-correction-provenance-foundation.test.ts`
- `tests/feature-078-media-library-folders.test.ts`
- `tests/feature-078-media-library-folder-routes.test.ts`
- `tests/feature-078-media-library-ui.test.ts`

### Ground truth policy
- Current live code and schema are authoritative.
- The research document is the synthesized starting point.
- Any conflict resolves in favor of the current live code.

## Verified current boundary

### Correction workflow boundary
- `assertWorkspaceCaptureMutationAllowed(...)` still blocks all asset capture writes once a project is finalized and returns `409 project_finalized`.
- `assertWorkspaceCorrectionReviewMutationAllowed(...)` allows review-safe mutations during an open correction cycle, but only in `handed_off` workspaces.
- `assertWorkspaceCorrectionConsentIntakeAllowed(...)` allows consent intake during correction only when the project is finalized, correction is open, and the workspace was reopened for the active correction cycle.
- `reopenWorkspaceForCorrection(...)` only moves a workspace from `validated` to `handed_off`.
- `finalizeProject(...)` already requires at least one reopened workspace when correction is open and relies on workflow validation readiness before re-finalizing.

### Upload boundary
- Existing upload routes all call capture helpers, not correction helpers.
- Existing upload writes are therefore blocked for finalized projects, even when correction is open.
- `assets` RLS is still capture-scoped:
  - `assets_insert_workspace_capture`
  - `assets_update_workspace_capture`
  both depend on `app.current_user_can_capture_project_workspace(...)`.
- Review-side linking tables already have reviewer-capable policies, but `assets` itself does not.

### Validation boundary
- Current workspace validation blocking counts uploaded photo review state and matching progress.
- `getWorkspaceWorkflowSummary(...)` does not currently count `assets.status = 'pending'`.
- Videos do not currently participate in review/matching blockers.
- Result: a pending asset row can exist without blocking validation, which is unsafe once correction upload is allowed.

### Release and Media Library boundary
- Release snapshots are built from live `assets`, not by mutating prior release rows.
- Eligible release inputs are already:
  - `asset_type in ('photo', 'video')`
  - `status = 'uploaded'`
  - `archived_at is null`
- Media Library latest-release behavior already selects the highest published `release_version` per project.
- Feature 078 stable Media Library identity is already keyed by `(tenant_id, project_id, source_asset_id)`.

## Options considered

### Option A - Reuse existing upload routes with correction-aware branching
- Pros:
  - fewer route files
  - same client endpoints
- Cons:
  - broadens semantics of the normal capture API
  - increases risk of accidentally reopening finalized-project capture paths
  - mixes capture authority and correction authority in the same handlers
  - makes future auditing harder because the route family no longer maps cleanly to product state

### Option B - Add correction-specific upload routes that reuse existing services
- Pros:
  - smallest safe change to public route semantics
  - normal capture routes remain unchanged
  - correction-only authority can be enforced explicitly
  - keeps finalized-project write reopening narrowly bounded to one route family
  - lets the UI opt into correction mode cleanly
- Cons:
  - a few more route files
  - upload component needs a mode or endpoint override

### Option C - Defer media add, only ship archive or exclusion
- Pros:
  - avoids reopening writes
- Cons:
  - does not solve the missing correction capability this feature exists to address
  - still leaves no path to add new photos or videos for v2+

### Option D - Include both add and archive/exclusion in one slice
- Pros:
  - more complete correction toolset
- Cons:
  - significantly larger scope
  - changes review, release eligibility, and UI semantics at the same time
  - archive/exclusion policy needs separate product decisions

## Recommendation

Choose Option B.

Feature 079 should add a correction-specific media intake route family and a correction-specific access seam, while reusing the current low-level upload, finalize, derivative, and matching services. Normal capture routes stay unchanged. Asset archive or exclusion remains out of scope for a later feature.

## Chosen architecture

### High-level shape
- Add a new correction media-intake authority seam in workflow and request helpers.
- Add a correction-only route family under `/api/projects/[projectId]/correction/assets/...`.
- Reuse existing upload services:
  - `prepareProjectAssetBatch(...)`
  - `finalizeProjectAssetBatch(...)`
  - `createAssetWithIdempotency(...)` indirectly through batch prepare
  - `finalizeAsset(...)`
  - `queueProjectAssetPostFinalizeProcessing(...)`
- Reuse the existing upload UI component in a correction mode that points at the new endpoints.
- Add a pending-media validation blocker so pending rows cannot be omitted from corrected releases.
- Leave release snapshot creation logic unchanged unless implementation proves a narrow hook is required.

### Why normal capture routes remain unchanged
- They currently represent active capture workflow semantics.
- Widening them would blur the line between "project still being captured" and "project finalized but under correction."
- Keeping them unchanged prevents accidental reopening of:
  - public token writes
  - staffing flows
  - default-template edits
  - generic capture semantics for finalized projects

## Exact correction media permission model

### Allowed roles
- `owner`
- `admin`
- `reviewer`

### Denied roles
- `photographer`
- unauthenticated users
- users without tenant membership

### Required project and workspace state
- project must be finalized
- project must not be archived
- project correction must be open
- workspace must be reopened for the active correction cycle
- workspace must currently be `handed_off`

### Explicitly not allowed
- correction media intake in active, non-finalized projects
- correction media intake in finalized projects with correction closed
- correction media intake in workspaces that were not reopened for the active correction cycle
- correction media intake in reopened workspaces that have already been re-validated
- automatic reopen as a side effect of upload

### Helper design

Add to `src/lib/projects/project-workflow-service.ts`:

```ts
assertWorkspaceCorrectionMediaIntakeAllowed(project, workspace)
```

Planned behavior:
- `409 project_archived` when the project is archived
- `409 project_not_finalized` when the project is not finalized
- `409 project_finalized` when the project is finalized but correction is not open
- `409 workspace_correction_media_locked` when the workspace is not reopened for the active cycle or is not currently `handed_off`

Add to `src/lib/projects/project-workspace-request.ts`:

```ts
requireWorkspaceCorrectionMediaIntakeAccessForRequest(...)
requireWorkspaceCorrectionMediaIntakeAccessForRow(...)
```

Planned behavior:
- resolve tenant and workspace exactly like the current request and row helpers
- require reviewer-capable workspace permissions, not capture permissions
- then call `assertWorkspaceCorrectionMediaIntakeAllowed(...)`
- never accept `tenant_id` from the client

### Alignment with Features 075 and 076
- Authority should follow the same reviewer-capable correction model as correction review and correction consent intake.
- Photographer access remains denied in this first slice to avoid reopening broader recapture and staffing behavior.

## Exact route/API plan

### Chosen route family
- `POST /api/projects/[projectId]/correction/assets/preflight`
- `POST /api/projects/[projectId]/correction/assets/batch/prepare`
- `POST /api/projects/[projectId]/correction/assets/batch/finalize`

### Single create/finalize parity
- Do not add correction-specific single create or single finalize routes in the first slice.
- Rationale:
  - the current protected upload UI uses preflight plus batch prepare plus batch finalize
  - omitting extra correction routes keeps the reopened write surface minimal
  - row-scoped correction helper still gets added now so a future parity route can be implemented safely if needed

### Request and response shapes

Reuse the current request and response contracts where possible.

`POST /correction/assets/preflight`
- request body:
  - `workspaceId`
  - `assetType`
  - `files[] { name, size, contentType, contentHash }`
- response:
  - `200 { candidateSizes, duplicateHashes }`
- asset types accepted:
  - `photo`
  - `video`
- reject:
  - `headshot`

`POST /correction/assets/batch/prepare`
- request body:
  - `workspaceId`
  - `assetType`
  - `duplicatePolicy`
  - `items[]`
- response:
  - `200 { items }`
- behavior:
  - reuse prepare batching and signed upload URL generation
  - preserve existing batch size limits and duplicate handling

`POST /correction/assets/batch/finalize`
- request body:
  - `workspaceId`
  - `items[]`
- response:
  - `200 { items }`
- behavior:
  - reuse current finalize batching
  - preserve finalize idempotency and post-finalize queueing

### Error/status code plan

Reuse existing codes where they already communicate the right state.

- `401 unauthenticated`
- `403 no_tenant_membership`
- `403 workspace_media_intake_forbidden`
  - new code for users who can view a workspace but do not have reviewer-capable correction authority
- `404 workspace_not_found`
- `404 asset_not_found`
- `400 invalid_body`
- `400 invalid_files`
- `400 invalid_asset_type`
- `400 files_too_large`
- `400 invalid_idempotency_key`
- `409 project_archived`
- `409 project_not_finalized`
- `409 project_finalized`
  - used when the correction route is called while correction is closed
- `409 workspace_correction_media_locked`
- existing duplicate and finalize conflict results from the reused upload services should remain unchanged

### Route guard order
1. authenticate user
2. resolve tenant from server-side membership
3. resolve project id from route params
4. resolve workspace from request body
5. require correction media-intake access
6. validate allowed asset type
7. call reused upload service

## Write/RLS/client strategy

### Chosen strategy
- Use request-authoritative correction route handlers.
- Keep authenticated client reads for access checks and preflight reads.
- Use admin or service-role writes for correction prepare and finalize after strict correction access checks.

### Why this is the narrowest safe strategy
- Current `assets` RLS is intentionally capture-scoped.
- Adding broad reviewer insert or update access on `assets` would reopen finalized-project mutation capability outside the intended correction route family.
- Route-authoritative admin writes keep the reopen scope narrow and explicit.

### Planned details
- `preflight` can stay on the authenticated request client because it is read-only.
- `batch/prepare` should use:
  - authenticated client for auth, tenant resolution, and correction access checks
  - admin client for `prepareProjectAssetBatch(...)` writes
- `batch/finalize` should use:
  - authenticated client for auth, tenant resolution, and correction access checks
  - admin client for `finalizeProjectAssetBatch(...)` writes
- No new `assets` RLS policies are planned for Feature 079.
- No `tenant_id` is accepted from the client in any correction route.

## Asset type and upload policy plan

### Supported asset types
- `photo`
- `video`

### Explicitly rejected
- `headshot`

### Duplicate handling
- Keep current photo duplicate behavior unchanged.
- Keep current video behavior unchanged.
- Keep current same-request duplicate filtering in batch prepare unchanged.
- Keep overwrite and ignore semantics unchanged.

### Batch policy limits
- Keep the current prepare and finalize batch limits unchanged.
- Keep existing file-size policy from `asset-upload-policy.ts` unchanged.

### Provenance metadata
- Do not add a correction provenance column or request-source field to `assets` in Feature 079.
- Rationale:
  - the assets remain normal project assets in a correction-open reopened workspace
  - release immutability is enforced by snapshot creation, not by asset provenance fields
  - existing `created_at`, `created_by`, workspace, project correction timestamps, and release versioning already provide adequate audit context for this slice

## Upload/finalize/idempotency plan

### Services to reuse
- `prepareProjectAssetBatch(...)`
- `finalizeProjectAssetBatch(...)`
- `finalizeAsset(...)`
- `queueProjectAssetPostFinalizeProcessing(...)`
- `createAssetWithIdempotency(...)` through the prepare flow

### Idempotency approach
- Preserve the current idempotency contract.
- Do not add a correction-specific idempotency namespace.
- Rationale:
  - the logical resource is still "project asset in this workspace"
  - current operation scoping already includes `projectId` and `workspaceId`
  - a retry of the same correction upload should collapse the same way a retry does during normal capture

### Retry and conflict expectations
- duplicate prepare retries should remain safe
- finalize retries should remain safe
- correction routes should surface the same per-item results as the normal batch services
- no change should be made to the normal capture route family

## Derivatives, matching, and review plan

### Photos
- photo finalize already enqueues derivative and matching work
- `queueProjectAssetPostFinalizeProcessing(...)` already enqueues `photo_uploaded` work only for `photo`
- uploaded correction photos should enter the existing review and matching pipeline without feature-specific branching
- current correction review authority should allow review and linking of those assets before re-finalization

### Videos
- video finalize already enqueues derivative and poster-style processing
- videos do not enter photo matching progress
- whole-asset linking already supports uploaded `photo` and `video`

### Review surfaces
- `AssetsList` already lists uploaded photos and videos for the selected workspace
- correction-added uploaded assets should therefore appear in the existing project asset list without a new list surface
- photo review summaries remain driven by the current review-summary helpers
- videos remain review-neutral beyond whole-asset linking

### Repair and reconcile expectations
- no new repair or reconcile path is planned in this slice
- correction uploads should rely on the same existing derivative and matching repair behavior as normal uploads

## Pending-media validation blocker plan

### Problem to solve
- current workflow validation does not block on `assets.status = 'pending'`
- once correction upload is allowed, that creates a silent omission risk if a pending row exists during re-finalization

### Planned blocker
- extend `getWorkspaceWorkflowSummary(...)` to count pending project media rows for the workspace:
  - `asset_type in ('photo', 'video')`
  - `status = 'pending'`
  - `archived_at is null`
- include this in validation readiness
- include this in the blocker summary/message path used by validation and project re-finalization

### Scope of blocker
- apply it generally to workspace validation, not correction-only
- rationale:
  - the omission risk is not inherently correction-specific
  - a pending project media row is unsafe in any validation path

### Intentionally unchanged
- derivative failure remains non-blocking unless an existing photo review or matching blocker already makes it blocking
- videos do not become review-blocking after upload

## Validation and re-finalization plan

### Expected corrected workflow behavior
- a pending correction upload blocks workspace validation through the new pending-media blocker
- an uploaded correction photo continues to block validation until existing materialization and review requirements are satisfied
- an uploaded correction video does not require photo review, so it can be included once uploaded
- correction re-finalization then builds the next release from eligible live assets

### Release immutability guarantee
- old `project_releases` rows remain unchanged
- old `project_release_assets` rows remain unchanged
- the new release version includes newly eligible uploaded correction media

## Release and Media Library implications

### Release logic
- no release schema change is planned
- no `project_release_assets` schema change is planned
- no change is planned to the core source-asset eligibility query unless implementation proves a narrow issue

### Expected result
- any correction-added `photo` or `video` asset that is:
  - uploaded
  - non-archived
  - part of the mutable project state at re-finalization time
  should automatically appear in the next published release version

### Media Library
- Feature 078 stable identity behavior should continue to work for newly released correction assets
- existing folder memberships for previously released assets remain unchanged
- newly released correction assets should have no folder membership by default
- latest-release selection remains unchanged and should naturally surface the corrected release

## UI/i18n plan

### UI approach
- reuse `AssetsUploadForm`
- add a mode prop, for example:

```ts
mode?: "capture" | "correction"
```

- correction mode swaps the endpoint family to `/api/projects/[projectId]/correction/assets/...`
- capture mode remains the default and keeps current endpoints

### Project page changes
- compute a new boolean such as `correctionMediaIntakeAllowed`
- planned condition:
  - user can review projects
  - project is finalized
  - project correction is open
  - selected workspace is reopened for the current correction cycle
  - selected workspace workflow state is `handed_off`
- render `AssetsUploadForm` when either:
  - normal `captureMutationsAllowed`, or
  - `correctionMediaIntakeAllowed`
- pass `mode="correction"` for the correction case
- keep `AssetsList` unchanged

### Helper copy
- add short correction-mode helper copy in the upload form:
  - new uploads affect the next release version only
  - previous releases remain unchanged

### Hidden/disabled behavior
- keep correction upload controls hidden outside eligible correction state
- do not auto-promote general capture banners into correction upload permission banners unless implementation shows a clear UX gap

### i18n files
- `messages/en.json`
- `messages/nl.json`

### Proposed message additions
- `projects.assetsUploadForm.correctionNotice`
- optionally `projects.assetsUploadForm.correctionLabel` if a separate heading is useful

## Security and reliability considerations

### Security
- tenant isolation must remain server-derived and enforced on every query
- workspace isolation must stay inside request helpers and reused services
- reviewer-capable correction authority must not imply capture authority
- photographers remain denied
- no public token route should gain new write capability
- no staffing or default-template routes should be touched

### Reliability
- route handlers should validate correction access before any write or signed upload preparation
- current low-level idempotency behavior should be preserved
- correction routes should reuse current duplicate handling rather than introducing parallel logic

### Race handling
- validation racing with prepare:
  - pending row blocker should stop validation once the pending row exists
- project finalization racing with finalize:
  - pending row blocker should prevent re-finalization while any correction media row is still pending
- matching jobs still running after correction photo upload:
  - existing photo review and matching blockers remain responsible for readiness
- duplicate upload retries:
  - current idempotency and duplicate policy logic remains the protection
- release snapshot creation while a video derivative is still processing:
  - uploaded video remains release-eligible once uploaded; derivative lag remains non-blocking in this slice

### Audit implications
- rely on existing `created_by`, `created_at`, correction-open timestamps, and release version lineage
- do not add correction-specific provenance fields in this feature

## Edge cases

- correction route called before correction is opened
- correction route called after correction has been closed
- correction route called for a workspace reopened in a prior cycle but not the active cycle
- correction route called after the reopened workspace has been re-validated
- correction upload prepared but browser never finishes upload
- finalize retried after partial network failure
- duplicate photo re-upload during correction with `overwrite`
- duplicate video re-upload during correction
- photo uploaded during correction while matching backlog is degraded
- re-finalization attempted while a new correction photo is still pending review
- re-finalization attempted while a correction upload is still only `pending`
- newly released correction asset appearing in latest Media Library release with no folder membership

## Test plan

### Permission and route coverage
- add correction route tests for owner allowed
- add correction route tests for admin allowed
- add correction route tests for reviewer allowed
- add correction route tests for photographer denied
- add correction route tests for unauthenticated denied
- add correction route tests for cross-tenant denied
- add correction route tests for cross-workspace denied
- add correction route tests for correction closed denied
- add correction route tests for finalized project without correction open denied
- add correction route tests for non-reopened workspace denied
- add correction route tests for reopened but no longer `handed_off` denied

### Upload behavior coverage
- photo correction preflight allowed
- video correction preflight allowed
- headshot rejected from correction routes
- photo correction batch prepare and finalize succeeds
- video correction batch prepare and finalize succeeds
- duplicate photo behavior preserved
- video duplicate behavior preserved
- finalize retry remains safe

### Processing coverage
- correction photo finalize enqueues derivative work
- correction photo finalize enqueues matching work
- correction video finalize enqueues derivative work but not photo matching work

### Validation coverage
- pending media blocker fires for `status = 'pending'` photo
- pending media blocker fires for `status = 'pending'` video
- uploaded correction photo still blocks validation until existing processing and review requirements are satisfied
- uploaded correction video does not introduce new review blockers after upload

### Release and Media Library coverage
- corrected finalization includes new uploaded correction photo in v2+
- corrected finalization includes new uploaded correction video in v2+
- original v1 release rows remain unchanged
- Feature 078 stable Media Library identity exists for newly released correction assets
- existing folder memberships remain unchanged
- new correction assets have no folder membership by default
- no DAM behavior is introduced

### Existing suites to extend
- `tests/feature-024-upload-performance-resumability.test.ts`
- `tests/feature-038-asset-image-derivatives.test.ts`
- `tests/feature-062-video-upload-foundation.test.ts`
- `tests/feature-073-project-workflow-foundation.test.ts`
- `tests/feature-073-project-workflow-routes.test.ts`
- `tests/feature-073-project-workflow-ui.test.tsx`
- `tests/feature-074-project-release-media-library.test.ts`
- `tests/feature-075-project-correction-workflow.test.ts`
- `tests/feature-076-correction-consent-intake-foundation.test.ts`
- `tests/feature-078-media-library-folders.test.ts`

## Implementation phases

### Phase 1 - Correction media access seam and route family
- add `assertWorkspaceCorrectionMediaIntakeAllowed(...)`
- add request and row helpers in `project-workspace-request.ts`
- add correction preflight, batch prepare, and batch finalize routes
- wire routes to auth checks plus admin-client writes where needed
- tests:
  - permission matrix
  - correction-open and workspace-state gating
  - headshot rejection

### Phase 2 - UI reuse in correction mode
- extend `AssetsUploadForm` with a correction mode
- update project page gating and helper copy
- add English and Dutch strings
- tests:
  - project page shows upload form in eligible correction state
  - upload controls stay hidden outside eligible correction state

### Phase 3 - Pending-media validation blocker
- extend workflow summary with pending media count
- block validation and correction re-finalization when pending media exists
- tests:
  - pending photo blocks validation
  - pending video blocks validation
  - no regression for existing workflow transitions

### Phase 4 - Release and Media Library regressions
- verify corrected finalization includes new uploaded assets in v2+
- verify v1 immutability
- verify Feature 078 stable identity behavior for newly released correction assets
- tests:
  - release inclusion
  - Media Library latest-release behavior
  - folder-membership unaffected

## Scope boundaries

### In scope
- correction-only project media upload for photos and videos
- reviewer-capable correction media authority
- correction-specific upload route family
- reuse of current upload component in correction mode
- pending-media validation blocker
- derivative and matching enqueue verification
- corrected release inclusion and release immutability tests

### Out of scope
- archive, exclude, or delete asset behavior for corrected releases
- DAM export or sync
- Media Library folder behavior changes
- release history or diff UI
- public sharing
- broad recapture workflow
- new staffing flows
- default-template changes
- consent template authoring
- mutation of old release snapshots or release asset rows
- photographer correction upload authority

## Concise implementation prompt

Implement Feature 079 as a bounded correction-only media intake slice. Add a reviewer-capable correction media permission seam, correction-specific preflight plus batch prepare plus batch finalize routes under `/api/projects/[projectId]/correction/assets/...`, and reuse the existing asset prepare/finalize/post-finalize services with admin-client writes after strict correction access checks. Allow only finalized projects with correction open, only for workspaces reopened for the active correction cycle and currently in `handed_off`, support only `photo` and `video`, reject `headshot`, preserve existing duplicate and idempotency behavior, reuse `AssetsUploadForm` in a correction mode with English and Dutch helper copy that uploads affect the next release only, and add a general pending-media validation blocker for workspace `assets.status = 'pending'` rows so corrected re-finalization cannot omit unfinished uploads. Keep release snapshot logic and old release rows immutable, keep archive/exclusion out of scope, and add regression tests for permissions, upload/finalize flow, enqueue behavior, validation blockers, release v2+ inclusion, v1 immutability, and Feature 078 Media Library identity behavior.
