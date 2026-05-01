# Feature 075 - Project correction and re-release foundation

## Inputs and ground truth

Primary inputs:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `docs/rpi/README.md`
5. `docs/rpi/SUMMARY.md`
6. `UNCODEXIFY.md`
7. `docs/rpi/075-project-correction-and-re-release-foundation/research.md`

Targeted live verification performed for plan-critical seams only:

- `supabase/migrations/20260424110000_073_workspace_workflow_and_project_finalization.sql`
- `src/lib/projects/project-workflow-service.ts`
- `src/lib/projects/project-workflow-route-handlers.ts`
- `src/lib/projects/project-workspace-request.ts`
- `src/app/api/projects/[projectId]/finalize/route.ts`
- existing workspace transition routes
- `supabase/migrations/20260424130000_074_project_releases_media_library_foundation.sql`
- `src/lib/project-releases/project-release-service.ts`
- `src/lib/project-releases/media-library-download.ts`
- `src/app/(protected)/media-library/page.tsx`
- `src/app/(protected)/media-library/[releaseAssetId]/page.tsx`
- `src/app/api/media-library/assets/[releaseAssetId]/download/route.ts`
- review mutation routes under `src/app/api/projects/[projectId]/assets/...`
- review mutation routes under `src/app/api/projects/[projectId]/consents/...`
- `src/lib/matching/asset-preview-linking.ts`
- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/whole-asset-linking.ts`
- `src/lib/matching/manual-asset-faces.ts`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `messages/en.json`
- `messages/nl.json`
- `tests/feature-067-consent-upgrade-route.test.ts`
- `tests/feature-073-project-workflow-foundation.test.ts`
- `tests/feature-073-project-workflow-routes.test.ts`
- `tests/feature-073-project-workflow-ui.test.tsx`
- `tests/feature-074-project-release-media-library.test.ts`
- `tests/feature-074-media-library-download.test.ts`

Source-of-truth order for this plan:

1. Live schema and live code
2. `research.md`
3. Older RPI context

## Verified current boundary

Plan-critical live facts confirmed:

- `projects.finalized_at` and `projects.finalized_by` are the current project finalization lock.
- `assertProjectWorkflowMutable(...)` blocks finalized projects globally for workflow and mutation helpers.
- `assertWorkspaceCaptureMutationAllowed(...)` and `assertWorkspaceReviewMutationAllowed(...)` both also reject finalized projects.
- Current workspace transitions are:
  - `handoff`: `active | needs_changes -> handed_off`
  - `validate`: `handed_off -> validated`
  - `needs_changes`: `handed_off -> needs_changes`
  - `reopen`: `validated -> needs_changes`
- Current capture-open workspace states are `active` and `needs_changes`.
- Current review-open workspace states are `handed_off` and `needs_changes`.
- Current public-token-open workspace states are `active`, `handed_off`, and `needs_changes`.
- `finalizeProject(...)` is currently idempotent and returns `changed: false` when the project is already finalized.
- `handleProjectFinalizePost(...)` always calls `ensureProjectReleaseSnapshot(...)` after `finalizeProject(...)`, even when finalization itself is a no-op. That is the current release repair seam.
- `ensureProjectReleaseSnapshot(...)` still hardcodes `release_version = 1`, but its uniqueness anchor is `source_project_finalized_at`.
- Published releases are already immutable for authenticated users because release tables only expose `select` via RLS.
- `listMediaLibraryAssets(...)` currently returns assets from every published release in the tenant, not the latest release per project.
- Media Library detail and download already authorize by reviewer-capable tenant access and can keep loading any published release asset by id.
- Current review mutation permission tests are narrow. Live tests cover workflow routes, release/media-library behavior, participant capture-route handlers, and the consent-upgrade review route handler. There is no existing broad correction-gate test surface.

## Options considered

### Correction state storage

Option A: add correction fields directly on `projects`

- smallest implementation
- works with the current finalized-project lock
- enough for 075 if correction history remains intentionally lightweight

Option B: add a dedicated correction-cycle table

- stronger long-term audit
- larger than the first slice needs
- adds extra joins and idempotency surface immediately

Recommendation:

- choose Option A for 075

### Correction workspace reopen route

Option A: extend the existing `reopen` route

- fewer route files
- overloads existing pre-finalization semantics
- current `reopen` means `validated -> needs_changes`, which is the wrong target for review-only correction

Option B: add a correction-only reopen route

- keeps 073 semantics intact
- makes the correction exception explicit
- avoids reopening capture-oriented `needs_changes`

Recommendation:

- choose Option B

### Correction start behavior when the published baseline release is missing

Option A: auto-repair by calling release snapshot creation during correction start

- convenient
- hides a release repair side effect inside a lifecycle-open action

Option B: require the published baseline release to exist and reject otherwise

- smaller and clearer
- uses the existing finalize route as the repair path

Recommendation:

- choose Option B

### Correction finalization route

Option A: add a distinct correction-finalize route

- explicit
- duplicates live finalize logic and response shape

Option B: reuse `POST /api/projects/[projectId]/finalize`

- smallest path
- keeps existing release repair behavior
- only requires `finalizeProject(...)` to recognize correction-open finalized projects

Recommendation:

- choose Option B

### Media Library latest-release selection

Option A: store `latest_published_release_id` on `projects`

- simple reads
- adds pointer maintenance and more write coordination

Option B: derive the latest published release from `project_releases`

- matches current live schema
- no new mutable pointer

Recommendation:

- choose Option B

## Recommendation

Implement Feature 075 as a narrow correction mode layered on top of the existing finalized-project lock.

The core design is:

1. Keep `projects.finalized_at` populated at all times during correction.
2. Add a small correction-open marker on `projects`.
3. Introduce a dedicated correction start route and a dedicated correction workspace reopen route.
4. Keep capture, public-token, staffing, and default-template routes unchanged and still blocked after finalization.
5. Add a new correction-aware review mutation helper and use it only in the existing review-safe mutation routes.
6. Reuse existing validation blockers and the existing finalize route.
7. Make release creation advance to version `2+` by finalized timestamp.
8. Make Media Library list the latest published release per project by default while keeping old release assets directly readable by id.

## Chosen architecture

### Chosen project model

Add direct project-level correction fields and keep the current finalization fields unchanged.

Chosen fields:

- `projects.correction_state text not null default 'none'`
- `projects.correction_opened_at timestamptz null`
- `projects.correction_opened_by uuid null references auth.users(id) on delete restrict`
- `projects.correction_source_release_id uuid null references public.project_releases(id) on delete restrict`
- `projects.correction_reason text null`

Chosen correction-state values:

- `none`
- `open`

Chosen close behavior:

- on successful correction finalization, set `correction_state = 'none'`
- clear `correction_opened_at`
- clear `correction_opened_by`
- clear `correction_source_release_id`
- clear `correction_reason`

Chosen reason behavior:

- `correction_reason` is optional in 075

Chosen index behavior:

- no new project-level correction index in 075
- project lookups are already by `(tenant_id, id)`

Fields explicitly not added in 075:

- `projects.latest_published_release_id`
- `projects.current_release_version`

### Chosen workflow summary model

Extend `ProjectWorkflowSummary` so the UI can distinguish a normal finalized project from a correction-open finalized project.

Chosen summary additions:

- `correctionState: "none" | "open"`
- `correctionOpenedAt: string | null`
- `correctionOpenedBy: string | null`
- `correctionSourceReleaseId: string | null`
- `correctionReason: string | null`

Chosen derived workflow states:

- `active`
- `ready_to_finalize`
- `finalized`
- `correction_open`
- `correction_ready_to_finalize`

Chosen derivation:

1. If `project.finalized_at` is null:
   - `ready_to_finalize` when all workspaces are validated and blockers are clear
   - otherwise `active`
2. If `project.finalized_at` is not null and `correction_state = 'none'`:
   - `finalized`
3. If `project.finalized_at` is not null and `correction_state = 'open'`:
   - `correction_ready_to_finalize` when all workspaces are validated and blockers are clear
   - otherwise `correction_open`

## Exact schema and model plan

Add a new migration that:

1. Adds the correction columns to `projects`.
2. Adds `projects_correction_state_check` for `('none', 'open')`.
3. Adds a shape check so `open` requires:
   - `correction_opened_at`
   - `correction_opened_by`
   - `correction_source_release_id`
4. Adds a complementary shape check so `none` requires those three fields to be null.
5. Leaves `correction_reason` nullable in both states.

No release-table mutation model changes are needed beyond service behavior for versioning.

No new RLS policies are needed for correction fields because all writes remain server-side through existing project routes and service-role/admin server clients where already used.

## Exact correction lifecycle

1. Project is finalized with a published release baseline.
2. Reviewer-capable user calls correction start.
3. Project moves from:
   - `workflowState = finalized`
   - `correctionState = none`
   to:
   - `workflowState = correction_ready_to_finalize` if all workspaces are still validated
   - or `workflowState = correction_open` if not
   - `correctionState = open`
4. No workspace state changes happen during correction start.
5. Reviewer-capable user explicitly reopens only the affected workspace(s) for correction.
6. Reopened workspaces move `validated -> handed_off`.
7. Allowlisted review mutation routes can operate only within those reopened workspaces.
8. Reviewer validates reopened workspaces again with the existing validate route.
9. Finalize route closes correction, advances `projects.finalized_at`, and creates release `v2+`.
10. Media Library list now shows that new latest release by default.

## Exact API and read/write plan

### 1. Correction start

New route:

- `POST /api/projects/[projectId]/correction/start`

New route file:

- `src/app/api/projects/[projectId]/correction/start/route.ts`

New service function:

- `startProjectCorrection(...)` in `src/lib/projects/project-workflow-service.ts`

Supporting release helper:

- add `loadPublishedProjectReleaseByFinalizedAt(...)` in `src/lib/project-releases/project-release-service.ts`

Request body:

```json
{
  "reason": "optional string"
}
```

Chosen request rules:

- body is optional
- if present, `reason` is optional
- blank `reason` normalizes to `null`

Response shape:

```json
{
  "changed": true,
  "projectWorkflow": {
    "...": "updated workflow summary including correction fields"
  },
  "correction": {
    "state": "open",
    "openedAt": "timestamp",
    "openedBy": "user-id",
    "sourceReleaseId": "uuid",
    "reason": "optional string"
  }
}
```

Permission checks:

- authenticate user
- resolve tenant server-side
- resolve project visibility through existing project/workspace access
- require reviewer-capable project action through existing reviewer-capable permission helper

Preconditions:

- project exists in tenant
- project status is `active`
- `projects.finalized_at` is not null
- `projects.correction_state = 'none'`, or treat an already-open correction as idempotent success
- the current finalized baseline has a published release row

Chosen missing-release behavior:

- reject with `409 project_correction_release_missing`
- instruct caller to retry project finalization to repair the baseline release

Chosen idempotency:

- if correction is already open for the same current project baseline, return `200` with `changed: false`
- do not rewrite `correction_reason` on idempotent retry

Chosen error codes:

- `project_correction_not_finalized`
- `project_correction_release_missing`
- `project_correction_conflict`
- reuse existing auth and tenant errors

### 2. Correction workspace reopen

New route:

- `POST /api/projects/[projectId]/workspaces/[workspaceId]/correction-reopen`

New route file:

- `src/app/api/projects/[projectId]/workspaces/[workspaceId]/correction-reopen/route.ts`

New service function:

- `reopenWorkspaceForCorrection(...)` in `src/lib/projects/project-workflow-service.ts`

Chosen response shape:

```json
{
  "changed": true,
  "workspace": {
    "...": "updated workspace row"
  },
  "projectWorkflow": {
    "...": "updated workflow summary including correction fields"
  }
}
```

Chosen behavior:

- allowed only when project correction is open
- allowed only for reviewer-capable actors
- `validated -> handed_off`
- set:
  - `workflow_state = 'handed_off'`
  - `workflow_state_changed_at = now()`
  - `workflow_state_changed_by = actor`
  - `reopened_at = now()`
  - `reopened_by = actor`
- do not overwrite `handed_off_at` and `handed_off_by`

Chosen idempotency:

- if the workspace is already in the correction-reopened state for the current request retry, return `changed: false`
- use `workflow_state = 'handed_off'` plus `reopened_at = workflow_state_changed_at` as the retry marker

Chosen error codes:

- `project_correction_not_open`
- `workspace_correction_reopen_conflict`
- reuse existing `workspace_not_found`, `project_review_forbidden`, and tenant errors

Why this route is separate:

- it preserves the 073 meaning of `reopen`
- it avoids the capture-oriented `needs_changes` path
- capture routes stay blocked because finalized-project capture helpers remain unchanged

### 3. Correction finalization

Correction finalization must require at least one workspace to have been reopened during the current correction cycle.

Recommended rule:

- at least one project workspace must have `reopened_at >= projects.correction_opened_at`

If correction is open but no workspace was reopened during that correction cycle, finalization should return `409` with a clear error code such as:

- `project_correction_no_reopened_workspaces`

Reason:

- prevents creating release v2/v3 that is identical to the previous release
- keeps release history meaningful
- still allows untouched workspaces to remain validated

Route reused:

- `POST /api/projects/[projectId]/finalize`

Chosen service change:

- extend `finalizeProject(...)` instead of adding a new correction finalize service entry point

Chosen behavior:

1. If project is not finalized:
   - keep existing 073 behavior
2. If project is finalized and `correction_state = 'none'`:
   - keep existing idempotent no-op behavior
3. If project is finalized and `correction_state = 'open'`:
   - require `workflowState = correction_ready_to_finalize`
   - update:
     - `finalized_at = now()`
     - `finalized_by = actor`
     - `correction_state = 'none'`
     - clear correction-open metadata fields
   - return `changed: true`

Chosen retry behavior:

- after correction-close succeeds, a retried finalize call returns `changed: false`
- the route still calls `ensureProjectReleaseSnapshot(...)`
- that reuses the existing repair flow for the new finalized timestamp

Chosen partial release failure behavior:

- keep the current finalize-route warning shape
- correction finalization can return `200` with a repair warning if release building fails
- retrying the same finalize route repairs the release for the new `source_project_finalized_at`

## Exact helper design

### Keep existing helpers unchanged

Do not loosen:

- `assertProjectWorkflowMutable(...)`
- `requireWorkspaceCaptureMutationAccessForRequest(...)`
- `requireWorkspaceCaptureMutationAccessForRow(...)`
- `requireWorkspaceReviewMutationAccessForRequest(...)`
- `requireWorkspaceReviewMutationAccessForRow(...)`
- `assertWorkspacePublicSubmissionAllowed(...)`

Those should keep their current pre-correction semantics and continue blocking finalized projects generally.

### Add new correction-aware project helpers

Add to `src/lib/projects/project-workflow-service.ts`:

- `isProjectCorrectionOpen(project)`
- `assertProjectCorrectionOpen(project)`
- `startProjectCorrection(...)`
- `reopenWorkspaceForCorrection(...)`
- `assertWorkspaceCorrectionReviewMutationAllowed(...)`

Chosen logic for `assertWorkspaceCorrectionReviewMutationAllowed(...)`:

- if project is archived: reject
- if project is not finalized:
  - reuse current normal review mutation rules
- if project is finalized and correction is not open:
  - reject `project_finalized`
- if project is finalized and correction is open:
  - allow only `workspace.workflow_state === 'handed_off'`

This keeps correction review edits narrow and keeps photographers blocked through the existing reviewer permission check.

### Add new correction-aware request helpers

Add to `src/lib/projects/project-workspace-request.ts`:

- `requireWorkspaceCorrectionReviewMutationAccessForRow(...)`
- `requireWorkspaceCorrectionReviewMutationAccessForRequest(...)`

Chosen behavior:

- resolve tenant and workspace exactly like current row/request helpers
- reuse `assertCanReviewWorkspaceAction(...)`
- call the new correction-aware workflow helper
- return the same shape as current review mutation access helpers so route diffs stay small

## Exact route allow/block plan

### Allowlisted review mutation routes for correction

These route files should switch from the current review mutation helper to the new correction-aware review mutation helper:

- `src/app/api/projects/[projectId]/assets/[assetId]/blocked-faces/[assetFaceId]/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/hidden-faces/[assetFaceId]/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/manual-faces/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/assignment/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/whole-asset-links/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/links/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/review-sessions/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/review-sessions/[sessionId]/items/[itemId]/actions/route.ts`

These stay review-only because they mutate linking, suppression, manual-face, or review-session state and do not create new people or new consent intake.

### Review-adjacent routes that stay blocked during correction

Leave unchanged:

- `src/app/api/projects/[projectId]/consents/[consentId]/upgrade-request/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts`

Reason:

- they widen correction into consent intake or matching-input mutation
- those are deferred to Feature 076

### Read-only review routes

Keep read-only review routes unchanged:

- preview candidate routes
- preview faces routes
- preview links routes
- whole-asset candidate routes
- consent-linked-assets reads
- consent manual-link-state reads
- current review session reads

There is no live POST or DELETE route for consent manual-link-state today, so Feature 075 does not need to plan a correction mutation decision for that surface.

### Capture and public routes that stay blocked

Leave unchanged:

- all asset upload and finalize routes
- participant add routes
- recurring consent request creation routes
- project workspace creation/staffing routes
- project default-template route
- public token submit routes

No correction-specific exception should be added to any of those paths.

## Exact release versioning plan

Changes in `src/lib/project-releases/project-release-service.ts`:

1. Keep `source_project_finalized_at` as the release-cycle uniqueness key.
2. Add a helper that resolves the next release version for a project:
   - query published and building releases for the project
   - compute `max(release_version) + 1`
3. Replace all hardcoded `1` values used for new release creation and missing-release summaries where they should reflect the actual current release cycle.
4. Keep existing behavior:
   - published release for the same finalized timestamp returns unchanged
   - existing building release for the same finalized timestamp is repaired in place
   - zero-asset finalized projects still publish a parent release
   - photos and videos are included
   - headshots are excluded
   - original storage references are preserved
   - `source_asset_id` remains the stable source identity

Chosen release uniqueness:

- unchanged: `(tenant_id, project_id, source_project_finalized_at)`

Chosen retry model:

- duplicate finalize retry after a new correction finalization finds the same finalized timestamp and reuses the same release row
- unique constraints remain the final backstop for races

Chosen immutability:

- do not mutate existing published `project_releases`
- do not mutate existing published `project_release_assets`
- only repair a `building` row for the active finalized timestamp

## Exact Media Library latest-release plan

Chosen rule:

- list page shows only assets from the latest published release per project

Chosen implementation:

1. In `listMediaLibraryAssets(...)`, first read published release rows for the tenant:
   - select `id`, `project_id`, `release_version`, `source_project_finalized_at`
   - order by `project_id asc`, `source_project_finalized_at desc`, `release_version desc`
2. Reduce in application code to the first published release per `project_id`.
3. Fetch `project_release_assets` only for those latest release ids.
4. Keep current sort of the final list for presentation.

Chosen detail behavior:

- `getReleaseAssetDetail(...)` stays id-based and continues to allow any published release asset by id

Chosen index behavior:

- do not add a new release index in 075
- current `project_releases_tenant_project_finalized_at_idx` is sufficient for the first slice
- revisit with a partial published index only if later profiling shows it is needed

Chosen history affordance:

- no dedicated history browser in 075
- old release assets remain direct-link historical records only

## Exact UI and i18n plan

### Project page

Files:

- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/components/projects/project-workflow-controls.tsx`

Chosen UI changes:

1. On finalized projects with `correctionState = none` and reviewer-capable access:
   - show `Start correction`
2. When correction is open:
   - show correction-open status text in the existing workflow panel
   - explain that review corrections are open and the next finalization publishes a new release version
3. For a selected validated workspace during correction:
   - show `Reopen for correction`
4. Reuse the existing validate action after a correction reopen.
5. Reuse the existing finalize action when workflow state becomes `correction_ready_to_finalize`.
6. Keep capture/staffing actions hidden or disabled because `finalized_at` remains set.

Chosen page data changes:

- project page project query must include the correction columns
- `reviewMutationsAllowed` calculation must support:
  - normal review mode before project finalization
  - correction-open review mode only when workspace state is `handed_off`
- `captureMutationsAllowed` and `staffingMutationsAllowed` stay false whenever `finalized_at` is set

### Media Library

Files:

- `src/app/(protected)/media-library/page.tsx`
- `src/app/(protected)/media-library/[releaseAssetId]/page.tsx`

Chosen UI changes:

- list page copy should describe latest published releases, not all published releases
- detail page remains read-only
- release version metadata remains visible

### i18n keys

Existing key families to extend:

- `projects.detail.workflow`
- `mediaLibrary.list`
- `mediaLibrary.detail`

Expected new workflow keys:

- `projectStates.correction_open`
- `projectStates.correction_ready_to_finalize`
- `actions.startCorrection`
- `actions.startCorrectionPending`
- `actions.correctionReopen`
- `actions.correctionReopenPending`
- `correctionOpenHelper`
- `correctionReadyHelper`
- `correctionBanner`
- `workspaceCorrectionReopenedAt`

Expected Media Library copy updates:

- update list subtitle text to reflect latest published release behavior
- optionally add a tiny helper line on detail pages that the asset belongs to a historical release version when not current, but defer if it needs extra reads

Add both English and Dutch entries in:

- `messages/en.json`
- `messages/nl.json`

## Security and reliability considerations

Security requirements preserved by this plan:

- tenant scoping remains explicit on every project, workspace, release, and release-asset query
- correction authority remains reviewer-capable only
- photographers remain blocked because correction uses reviewer permission helpers, not capture helpers
- service-role writes stay limited to release tables as today
- old published release rows remain immutable
- no correction exception is added to capture, public-token, staffing, or template routes

Reliability requirements preserved by this plan:

- correction start is idempotent
- correction workspace reopen is idempotent
- correction finalization is idempotent
- release creation still repairs partial failures by finalized timestamp
- duplicate release rows are prevented by existing unique constraints
- untouched workspaces remain validated and do not need rework

## Edge cases

- Correction start on a finalized project with a missing published baseline release returns `409` and points the operator back to the finalize repair path.
- Retrying correction start after a network drop returns `changed: false` and the current correction-open summary.
- Trying to edit review routes during correction without reopening the workspace remains blocked.
- Trying to use capture routes during correction remains blocked because finalized-project capture checks do not change.
- Trying to use public token write flows during correction remains blocked because `assertWorkspacePublicSubmissionAllowed(...)` does not change.
- Correction finalization is blocked until all reopened workspaces return to `validated`.
- If correction finalization succeeds but release building fails, the project is closed out of correction and the caller receives the existing repair warning. Retrying finalize repairs the release for that new finalized timestamp.
- If a second correction is opened after v2 publishes, the next finalization produces v3 using the same finalized-timestamp uniqueness pattern.

## Test plan

### Schema and service tests

Add a new Feature 075 service/schema test file that covers:

- correction fields default to `none` and null metadata
- correction open shape constraints
- correction close clears correction metadata
- start correction requires finalized active project
- correction finalization creates v2
- second correction finalization creates v3
- release version increments by `max + 1`
- old release rows remain unchanged
- building release repair still works after correction finalization

### Workflow and route tests

Extend or add route tests for:

- correction start allowed for owner/admin/reviewer
- correction start denied for photographer
- correction start denied when baseline release is missing
- correction start idempotent retry
- correction workspace reopen allowed only during correction
- correction workspace reopen denied for photographer
- correction workspace reopen returns `handed_off`
- existing `reopen` route stays unchanged for pre-finalization semantics
- existing finalize route handles correction-open projects
- correction finalization blocked until reopened workspaces are revalidated

### Review mutation gate tests

Add Feature 075 route tests that verify:

- allowlisted review mutation routes succeed during correction when workspace is correction-reopened
- allowlisted review mutation routes still work before project finalization
- non-allowlisted review-adjacent mutation routes remain blocked during correction
- capture routes remain blocked during correction
- staffing/default-template routes remain blocked during correction
- public-token writes remain blocked during correction

### Media Library tests

Extend Feature 074 tests for:

- latest-release list shows only the newest published release per project
- detail page still loads an older published release asset by direct id
- download route still works for older release assets by direct id
- photographer remains denied

### UI tests

Extend Feature 073 UI tests for:

- finalized project shows `Start correction`
- correction-open workflow messaging renders
- correction-ready-to-finalize messaging renders
- correction-reopen action appears for validated workspaces during correction

## Implementation phases

### Phase 1. Schema and types

- add project correction columns and constraints
- extend workflow types and summary types
- extend project page project query types

### Phase 2. Workflow and correction services

- add project correction load/derive helpers
- add correction start service
- add correction workspace reopen service
- extend finalize service for correction finalization

### Phase 3. Routes

- add correction start route
- add correction workspace reopen route
- keep finalize route and wire it to the updated finalize service

### Phase 4. Correction-aware review mutation gates

- add correction-aware review mutation request helpers
- switch only the allowlisted review mutation routes to those helpers
- leave blocked routes unchanged

### Phase 5. Release versioning

- remove hardcoded release version `1` on new release creation
- compute next version by project
- preserve published-row reuse and building-row repair behavior

### Phase 6. Media Library latest-release reads

- change list query to latest published release per project
- keep detail and download reads id-based

### Phase 7. UI and i18n

- update project workflow controls and project page wiring
- update Media Library copy
- add English and Dutch keys

### Phase 8. Tests and verification

- add new Feature 075 tests
- extend relevant 073 and 074 tests
- run targeted test files first
- then run lint and broader relevant test coverage

## Scope boundaries
Local development data policy:

- Assume local development can be reset with `supabase db reset`.
- Prefer clean forward schema changes and fresh-state validation.
- Do not build compatibility layers, repair scripts, or one-off backfills for arbitrary old local projects, assets, finalized projects, correction rows, or release rows unless explicitly required by this plan.
- New correction fields should default existing rows to the non-correction state.
- Release v2+ behavior only needs to work for projects finalized or re-finalized through the implemented Feature 075 workflow.

In scope:

- project-level correction-open state
- reviewer-capable correction start
- correction-safe workspace reopen
- allowlisted review mutation routes during correction
- workspace revalidation after correction
- correction finalization through the existing finalize route
- release version `2+`
- latest published release Media Library list
- minimal project page and Media Library UI updates
- English and Dutch i18n keys

Out of scope:

- new one-off people
- new recurring profiles
- adding existing recurring profiles as new participants
- one-off invite creation during correction
- recurring consent request creation during correction
- one-off or recurring consent upgrade request creation during correction
- public token reopening
- project media uploads during correction
- staffing changes during correction
- project default-template changes during correction
- consent template changes
- DAM sync
- DAM delta tables
- Media Library folders or collections
- comments, discussion, notifications, or email workflows
- arbitrary edits to release snapshot rows

## Concise implementation prompt

Implement Feature 075 as a bounded review-only correction mode on top of the existing finalized-project lock. Add project-level correction fields on `projects`, a `POST /api/projects/[projectId]/correction/start` route, a `POST /api/projects/[projectId]/workspaces/[workspaceId]/correction-reopen` route that moves `validated -> handed_off` for reviewer-capable users only, correction-aware workflow summary states, and a correction-aware review mutation helper used only by the existing review-safe mutation routes. Reuse `POST /api/projects/[projectId]/finalize` for correction finalization, advance `projects.finalized_at` to create release `v2+`, keep old release rows immutable, change Media Library list reads to latest published release per project, update the existing project page and Media Library UI minimally, add English and Dutch i18n keys, and add tests for correction permissions, route allow/block behavior, workspace revalidation, release versioning, latest-release reads, and tenant isolation.
