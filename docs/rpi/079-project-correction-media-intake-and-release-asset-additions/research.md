# Feature 079 Research: Project correction media intake and release asset additions

## Inputs reviewed

### Required context docs

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `UNCODEXIFY.md`
- `docs/rpi/README.md`
- `docs/rpi/SUMMARY.md`
- `docs/rpi/073-workspace-handoff-and-project-finalization-foundation/research.md`
- `docs/rpi/073-workspace-handoff-and-project-finalization-foundation/plan.md`
- `docs/rpi/074-project-release-package-and-media-library-placeholder/research.md`
- `docs/rpi/074-project-release-package-and-media-library-placeholder/plan.md`
- `docs/rpi/075-project-correction-and-re-release-foundation/research.md`
- `docs/rpi/075-project-correction-and-re-release-foundation/plan.md`
- `docs/rpi/076-correction-consent-intake-and-authorization-updates/research.md`
- `docs/rpi/076-correction-consent-intake-and-authorization-updates/plan.md`
- `docs/rpi/077-media-library-asset-safety-and-release-detail-review-context/research.md`
- `docs/rpi/077-media-library-asset-safety-and-release-detail-review-context/plan.md`
- `docs/rpi/078-organization-scoped-media-library-folders-and-organization-foundation/research.md`
- `docs/rpi/078-organization-scoped-media-library-folders-and-organization-foundation/plan.md`

### Current live code and schema inspected

- Workflow and access:
  - `src/lib/projects/project-workflow-service.ts`
  - `src/lib/projects/project-workspace-request.ts`
  - `supabase/migrations/20260423120000_072_project_workspaces_foundation.sql`
  - `supabase/migrations/20260423121000_072_project_workspace_access.sql`
- Asset intake and finalize:
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
- Review, matching, and video linkage:
  - `src/lib/matching/project-matching-progress.ts`
  - `src/lib/matching/auto-match-trigger-conditions.ts`
  - `src/lib/matching/whole-asset-linking.ts`
  - `src/app/api/projects/[projectId]/assets/[assetId]/whole-asset-links/route.ts`
  - `src/lib/projects/project-asset-review-list.ts`
- Release and Media Library:
  - `src/lib/project-releases/project-release-service.ts`
  - `supabase/migrations/20260424130000_074_project_releases_media_library_foundation.sql`
  - `supabase/migrations/20260425120000_078_media_library_folders_foundation.sql`
- UI:
  - `src/app/(protected)/projects/[projectId]/page.tsx`
  - `src/components/projects/assets-upload-form.tsx`
  - `src/components/projects/assets-list.tsx`
  - `src/components/projects/project-video-asset-preview-lightbox.tsx`
- Core schema:
  - `supabase/migrations/20260305120000_004_assets_schema.sql`
  - `supabase/migrations/20260305150000_005_assets_content_hash.sql`
  - `supabase/migrations/20260306100000_006_headshot_consent_schema.sql`
  - `supabase/migrations/20260421120000_062_video_asset_type.sql`
- Existing tests:
  - `tests/feature-024-upload-performance-resumability.test.ts`
  - `tests/feature-038-asset-image-derivatives.test.ts`
  - `tests/feature-062-video-upload-foundation.test.ts`
  - `tests/feature-073-project-workflow-foundation.test.ts`
  - `tests/feature-073-project-workflow-routes.test.ts`
  - `tests/feature-073-project-workflow-ui.test.tsx`
  - `tests/feature-074-project-release-media-library.test.ts`
  - `tests/feature-075-project-correction-workflow.test.ts`
  - `tests/feature-076-correction-consent-intake-foundation.test.ts`
  - `tests/feature-076-correction-provenance-foundation.test.ts`
  - `tests/feature-077-media-library-release-helpers.test.ts`
  - `tests/feature-078-media-library-folders.test.ts`

## Verified current correction and asset-upload behavior

### Executive summary

Current live behavior supports correction-safe review mutations and correction-safe consent intake, but it does not support adding new project media during correction. The hard stop is at the route/access layer, not at release snapshotting.

The release system already behaves the right way for immutability:

- old `project_releases` and `project_release_assets` rows stay immutable
- new releases are rebuilt from the mutable live `assets` table
- release v2+ automatically includes uploaded, non-archived `photo` and `video` assets
- Media Library already resolves to the latest published release per project and keeps historical release-asset detail available

The missing capability is narrowly:

- allow new `photo` and `video` assets to be created and finalized while a finalized project has `correction_state = 'open'`
- only for an explicitly correction-reopened workspace
- without reopening normal capture, public-token, or staffing behavior

## Current schema/code paths involved

### Project/correction workflow

- `project_workspaces.workflow_state` currently uses `active`, `handed_off`, `needs_changes`, `validated`
- `projects.correction_state` currently uses `none`, `open`
- `getProjectWorkflowSummary()` derives `active`, `ready_to_finalize`, `finalized`, `correction_open`, `correction_ready_to_finalize`
- `startProjectCorrection()` requires:
  - project already finalized
  - an existing published release for the current `finalized_at`
- `reopenWorkspaceForCorrection()` only allows `validated -> handed_off`
- correction re-finalization reuses `validate` plus `finalizeProject()`

### Assets

- `assets` is the mutable live source table
- relevant live columns include:
  - `tenant_id`
  - `project_id`
  - `workspace_id`
  - `asset_type`
  - `status`
  - `content_hash`
  - `content_hash_algo`
  - `archived_at`
  - `uploaded_at`
- supported asset types in live code:
  - `photo`
  - `headshot`
  - `video`
- normal project media upload routes only support `photo` and `video`
- `headshot` remains a separate consent/headshot flow

### Releases and Media Library

- `project_releases` stores immutable release headers keyed by `(tenant_id, project_id, release_version)` and `(tenant_id, project_id, source_project_finalized_at)`
- `project_release_assets` stores immutable release snapshots keyed by `release_id` plus `source_asset_id`
- `media_library_assets` provides stable identity keyed by `(tenant_id, project_id, source_asset_id)`

## Current constraints and invariants

### 1. Current correction lock boundary

Verified from `project-workflow-service.ts` and `project-workspace-request.ts`:

- `assertProjectWorkflowMutable()` rejects finalized projects
- `assertWorkspaceCaptureMutationAllowed()` rejects finalized projects and only allows workspace states `active` and `needs_changes`
- `assertWorkspaceReviewMutationAllowed()` rejects finalized projects and only allows `handed_off` and `needs_changes`, optionally `validated`
- `assertWorkspaceCorrectionReviewMutationAllowed()` is the existing correction seam for review-safe changes:
  - pre-finalization: falls back to normal review rules
  - post-finalization: requires correction open and workspace `handed_off`
- `assertWorkspaceCorrectionConsentIntakeAllowed()` is the existing correction seam for consent intake:
  - project must be finalized
  - correction must be open
  - workspace must be reopened for the active cycle
  - that means `workflow_state = 'handed_off'` and `reopened_at >= correction_opened_at`

Current upload routes still use capture mutation helpers, so correction media upload is blocked today.

Correct seam for Feature 079:

- add a new correction-specific media-intake permission seam alongside the existing correction review and correction consent seams
- do not piggyback on normal capture mutation rules

### 2. Current asset upload/finalize flow

Normal project uploads today:

- preflight:
  - `POST /api/projects/[projectId]/assets/preflight`
- batch prepare:
  - `POST /api/projects/[projectId]/assets/batch/prepare`
- batch finalize:
  - `POST /api/projects/[projectId]/assets/batch/finalize`
- single create:
  - `POST /api/projects/[projectId]/assets`
- single finalize:
  - `POST /api/projects/[projectId]/assets/[assetId]/finalize`

Core services:

- create/prepare:
  - `createAssetWithIdempotency()`
  - `prepareProjectAssetBatch()`
- finalize:
  - `finalizeAsset()`
  - `finalizeProjectAssetBatch()`
- post-finalize:
  - `queueProjectAssetPostFinalizeProcessing()`

Verified behavior:

- idempotency for create is keyed by `create_project_asset:<projectId>:<workspaceId>`
- batch prepare is capped at 50 items
- batch finalize is capped at 50 items
- duplicate suppression is photo-only
- video uploads intentionally skip duplicate hash suppression
- overwrite duplicate policy archives existing matching assets in the live `assets` table
- finalize marks `assets.status = 'uploaded'`
- release inclusion later depends on `status = 'uploaded'` and `archived_at is null`

Important route-layer detail:

- `POST /assets` checks capture mutation on the request-scoped client, then writes via `createAdminClient()`
- `POST /assets/preflight`, `POST /assets/batch/prepare`, `POST /assets/batch/finalize`, and `POST /assets/[assetId]/finalize` all use request-scoped `createClient()`
- `assets` RLS currently allows insert/update only for capture-capable workspace members

So the low-level services are reusable, but the current route/RLS shape is not correction-safe as-is.

### 3. Correction media permission findings

Current correction authority is reviewer-based, not photographer-based:

- correction review mutations require `canReviewProjects`
- correction consent intake requires `canReviewProjects`

Recommendation for the first slice:

- allow owner, admin, and reviewer through the existing review-capable permission path
- keep photographers blocked

Reasoning:

- this matches Features 075 and 076
- it avoids reopening broad capture behavior on finalized projects
- it avoids reopening public-token submission and staffing/default-template side effects
- current RLS and route helpers are already aligned around reviewer-capable correction authority, not correction capture authority

Allowing photographers in Feature 079 would require a materially broader workflow decision, not a small extension.

### 4. Workspace state findings

Smallest safe bounded rule:

- media intake only when project correction is open
- media intake only in workspaces explicitly reopened for the active correction cycle
- workspace must currently be `handed_off`
- do not allow upload into still-validated workspaces
- do not auto-reopen a workspace when someone tries to upload

Why:

- this matches the live correction consent gate
- it keeps correction scope explicit
- it preserves Feature 075's reopen-before-change model
- it avoids hidden workflow changes from a side effecting upload

### 5. Asset types and upload scope findings

- support should cover both `photo` and `video`
- `headshot` should remain excluded
- existing photo duplicate rules should remain unchanged
- existing video duplicate behavior should remain unchanged

No new asset provenance column is required for correctness:

- live `assets` rows are already mutable workspace/project state
- release immutability comes from snapshot rows, not from freezing `assets`
- consent requests needed provenance because public submissions had to be cycle-scoped
- asset inclusion does not have the same provenance matching requirement

If product later wants audit labeling for "added during correction", that is optional future metadata, not a correctness prerequisite for Feature 079.

## Correction permission findings

Recommended helper seam:

- `requireWorkspaceCorrectionMediaIntakeAccessForRequest()`
- `requireWorkspaceCorrectionMediaIntakeAccessForRow()`

Expected behavior:

- reviewer-capable access only
- load correction-aware project row
- assert project finalized plus correction open
- assert workspace reopened for the active cycle
- return workspace and project metadata without using the capture-mutation helper

This should live next to:

- `requireWorkspaceCorrectionReviewMutationAccess...`
- `requireWorkspaceCorrectionConsentIntakeAccess...`

## Upload/finalize/retry findings

What should be reused:

- `AssetsUploadForm` queue, manifest, and retry behavior
- `preflight` request shape
- `prepareProjectAssetBatch()`
- `createAssetWithIdempotency()`
- `finalizeProjectAssetBatch()`
- `finalizeAsset()`
- `queueProjectAssetPostFinalizeProcessing()`

What should not be reused unchanged:

- the current normal capture-gated upload routes
- the current capture-only `assets` insert/update RLS assumption

Key retry guarantees already present:

- batch prepare is idempotent by per-item idempotency key
- same-request duplicate suppression is deterministic for photos
- batch finalize is retry-safe
- photo matching enqueue is deduped on finalize retries
- create/finalize helpers already support both single-item and batch use

Important live gap:

- `assets.status = 'pending'` rows are ignored by workflow validation and release inclusion
- if upload preparation has created pending rows but finalization never happens, those rows do not block workspace validation or project re-finalization
- this is true today before Feature 079 and becomes more visible once correction media intake exists

## Matching/derivative implications

### Photos

- finalize enqueues derivatives
- finalize enqueues `photo_uploaded` matching work
- matching progress and validation blockers already observe uploaded photos
- repair and reconcile paths already target uploaded, non-archived project assets and can backfill missed derivative work

### Videos

- finalize enqueues derivative rows for poster and preview generation
- videos do not enqueue `photo_uploaded` matching work
- videos are eligible for whole-asset linking and preview/lightbox review today
- current validation blockers do not require a video-specific review completion state

Implication:

- photo correction uploads already fit the existing matching model
- video correction uploads fit the existing review/display model
- derivative failure should remain operationally tolerated and repairable, not a release blocker

## Validation/re-finalization implications

### Existing blockers are sufficient for new photos after finalize

For uploaded photos, live blockers already cover:

- matching in progress
- degraded matching state
- uploaded photos still in review status `pending`
- uploaded photos still in review status `needs_review`

That means newly finalized correction photos will naturally block re-validation until matching, materialization, and review settle.

### Existing blockers are not sufficient for in-flight uploads

Live blockers do not count:

- `assets.status = 'pending'` photo rows
- `assets.status = 'pending'` video rows

Result:

- correction finalization can race with unfinished upload or finalize work
- release v2 would silently exclude unfinished assets because release snapshot creation only reads `status = 'uploaded'`

Recommended bounded addition:

- add a new workflow blocker for pending project asset rows in the workspace
- scope it to `photo` and `video`
- keep derivative failure non-blocking

This is the one validation change that looks strictly required if correction media intake is enabled.

## Release v2+ and Media Library implications

Verified live release inclusion rule in `loadEligibleSourceAssets()`:

- includes only `assets` where:
  - `tenant_id` matches
  - `project_id` matches
  - `asset_type in ('photo', 'video')`
  - `status = 'uploaded'`
  - `archived_at is null`

Implications:

- corrected release v2+ will automatically include new uploaded correction media
- old release rows remain unchanged
- no mutation of `project_release_assets` history is needed

Verified Media Library behavior:

- `listMediaLibraryAssets()` picks the latest published release per project
- `getReleaseAssetDetail()` still resolves immutable historical release asset rows
- Feature 078 stable identity uses `media_library_assets` keyed by `(tenant_id, project_id, source_asset_id)`

Implications for Feature 079:

- a newly added correction asset will receive a stable Media Library identity when the corrected release is published
- folder membership is unaffected for brand-new assets because they had no prior stable identity
- existing folder memberships for existing assets still carry forward by stable identity

## Asset exclusion/removal findings

Manual project photo and video exclusion is not currently implemented.

Verified live behavior:

- duplicate overwrite can archive an existing live asset row by content hash
- headshot replacement can archive old headshots
- whole-asset unlink, hide, and block routes exist, but they do not archive the asset
- no project photo or video archive or delete route was found
- release inclusion excludes archived assets, but there is no normal project review action today to archive a released photo or video intentionally

If an asset was wrongly released in v1, current live code does not provide a bounded reviewer UI or API to keep it out of v2.

Recommendation:

- keep asset archive or exclude behavior out of Feature 079
- treat that as a separate Feature 080

Reason:

- add-media and remove-media are different scope and risk surfaces
- exclusion and removal need their own product rule and audit semantics
- Feature 079 can stay focused on intake and release immutability

## UI/API findings

### Current UI

Verified in `src/app/(protected)/projects/[projectId]/page.tsx`:

- upload controls render only when `captureMutationsAllowed`
- on finalized correction-open projects, the UI shows `workflow.projectCorrectionCaptureLocked`
- assets list still renders for the selected workspace

That means:

- new correction assets would already appear in the normal live asset review UI after finalize
- review lightboxes and whole-asset linking already support correction review mutations
- the missing UI piece is only the intake control path

### Recommended UI behavior

- reuse `AssetsUploadForm`
- add a correction mode or endpoint prop
- show it only for:
  - correction open
  - reviewer-capable users
  - selected workspace reopened for the active cycle
  - workspace currently `handed_off`
- add explicit helper copy stating that uploads affect the next release only, not prior releases
- keep upload controls hidden outside that state

### Recommended API direction

Current services can be reused, but the route layer should be correction-specific.

Reasoning:

- current normal routes are capture-oriented by name and semantics
- current normal batch and finalize routes rely on request-scoped capture RLS
- widening those routes risks reopening finalized-project capture behavior

Recommended bounded API shape:

- correction-specific preflight, prepare, and finalize routes
- backed by the same lower-level upload services
- guarded by the new correction media-intake helper
- keep `tenant_id` fully server-derived

This is safer than teaching the existing normal capture routes to mean two different permission models.

## Security and reliability findings

### Security invariants to preserve

- derive `tenant_id` server-side only
- keep workspace scoping on every lookup and write
- keep correction intake reviewer-capable only
- do not reopen public-token writes
- do not reopen staffing or default-template mutation paths
- do not mutate old release snapshots

### Race cases to explicitly cover in plan and tests

- correction finalization racing with unfinished asset uploads
- correction finalization racing with batch finalize retries
- validation occurring while pending uploads exist
- photo matching still running after correction upload
- duplicate correction uploads with repeated idempotency keys
- release v2 snapshot creation while a new asset is still `pending`

The largest live correctness gap is the pending-upload race, not release immutability.

## Existing tests and required new tests

### Existing tests already proving adjacent behavior

- Feature 024:
  - duplicate handling
  - batch prepare and finalize retry safety
  - matching dedupe on finalize retry
- Feature 038:
  - post-finalize derivative enqueue
  - photo matching enqueue
  - video derivative enqueue
- Feature 062:
  - video upload policy
  - photo-only duplicate checks
- Feature 073:
  - workflow transitions
  - validation and finalization behavior
- Feature 074:
  - release snapshot creation
  - historical release immutability
  - latest-release Media Library behavior
- Feature 075:
  - correction open, reopen, and finalize flow
  - v2 release creation without mutating v1
- Feature 076:
  - correction intake authority and cycle provenance
- Feature 078:
  - stable Media Library identity
  - latest-release carry-forward behavior

### New tests Feature 079 should add

- owner, admin, and reviewer correction upload allowed in a reopened correction workspace
- photographer blocked for the first slice
- upload blocked when correction is closed
- upload blocked on finalized project without correction open
- upload blocked on non-reopened or still-validated workspace
- correction photo batch prepare and finalize works and enqueues matching
- correction video batch prepare and finalize works and enqueues derivatives only
- headshot upload remains excluded from project correction intake
- photo duplicate rules remain unchanged
- video duplicate behavior remains unchanged
- uploaded correction photo blocks validation until matching, materialization, and review are ready
- pending correction upload rows block validation if the new blocker is added
- corrected finalization publishes release v2+ including the new asset
- release v1 remains unchanged
- stable Media Library identity is created for newly added correction assets once released
- cross-tenant and cross-workspace denial
- no DAM behavior introduced

## Options considered

### Option A: Reuse existing upload routes with correction-aware branching

Pros:

- smallest visible URL surface
- easiest UI reuse if the form keeps its current endpoints

Cons:

- current routes are capture-oriented, not correction-oriented
- current batch and finalize routes rely on capture RLS
- widening them risks reopening finalized-project capture behavior
- mixed admin and request-scoped route implementations already differ, so branching would be easy to get subtly wrong

### Option B: Add correction-specific upload routes that reuse the existing services

Pros:

- keeps normal capture routes unchanged
- keeps the permission model explicit
- avoids broadening normal capture semantics on finalized projects
- allows consistent correction-only guardrails and error codes

Cons:

- adds route surface
- `AssetsUploadForm` needs endpoint parameterization

### Option C: Defer asset add and only allow asset archive or exclusion

Not recommended.

- it does not solve the missing media-addition capability
- it does not match the stated product need

### Option D: Include both asset add and asset archive or exclusion now

Not recommended.

- materially larger scope
- exclusion and removal have no existing bounded product or API surface
- higher risk of coupling live asset mutation with release-history expectations

## Recommended bounded direction

Feature 079 should implement correction-scoped project media addition only.

Recommended shape:

- reviewer-capable correction media intake only
- only while correction is open
- only in a workspace reopened for the active correction cycle and currently `handed_off`
- support `photo` and `video`
- exclude `headshot`
- reuse the existing upload services and upload form
- add correction-specific route handlers instead of widening the normal capture routes
- add a new workflow blocker for pending `photo` and `video` asset rows so unfinished uploads cannot silently miss the next corrected release
- keep release snapshot logic unchanged
- keep asset archive or exclusion out of scope for Feature 080

## Risks and tradeoffs

- adding correction upload without a pending-upload blocker would create a silent omission risk in release v2
- allowing photographers in the first slice would expand correction beyond the current reviewer-authorized model
- widening the normal routes instead of using correction-specific routes increases the chance of reopening finalized-project capture semantics unintentionally
- adding asset provenance metadata now would add schema and UI cost without solving a current correctness problem

## Explicit open decisions for the plan phase

- Should Feature 079 add only correction-specific batch and preflight routes, or also correction-specific single create and finalize routes for parity?
- Should the pending-upload blocker be implemented as a generalized `pending project media` blocker across normal and correction workflows, or scoped only where correction upload is enabled?
- Should UI copy mention "next release version only" inline near the upload form, in a banner, or both?
- Is there any product need for optional audit metadata on assets added during correction, even though it is not required for release correctness?
