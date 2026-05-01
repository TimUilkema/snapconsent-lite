# Feature 075 - Project correction and re-release foundation

## Inputs reviewed

Required inputs reviewed in order:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `docs/rpi/README.md`
5. `docs/rpi/SUMMARY.md`
6. `UNCODEXIFY.md`
7. `docs/rpi/070-tenant-rbac-and-organization-user-management-foundation/research.md`
8. `docs/rpi/070-tenant-rbac-and-organization-user-management-foundation/plan.md`
9. `docs/rpi/072-project-staffing-photographer-scoped-capture-workspaces-and-bounded-project-workflow-permissions/research.md`
10. `docs/rpi/072-project-staffing-photographer-scoped-capture-workspaces-and-bounded-project-workflow-permissions/plan.md`
11. `docs/rpi/073-workspace-handoff-and-project-finalization-foundation/research.md`
12. `docs/rpi/073-workspace-handoff-and-project-finalization-foundation/plan.md`
13. `docs/rpi/074-project-release-package-and-media-library-placeholder/research.md`
14. `docs/rpi/074-project-release-package-and-media-library-placeholder/plan.md`

Supporting context reviewed:

- `docs/rpi/060-project-unresolved-face-review-queue/research.md`
- `docs/rpi/061-link-consent-to-whole-asset/research.md`
- `docs/rpi/064-whole-asset-linking-for-video-assets/research.md`
- `docs/rpi/067-consent-scope-state-and-upgrade-requests/research.md`
- `docs/rpi/069-consent-upgrade-flow-owner-reuse-and-prefill-refinement/research.md`
- `docs/rpi/071-consent-upgrade-flow-headshot-reuse-and-upgrade-ux-fixes/research.md`

Live code and schema inspected as source of truth:

- `supabase/migrations/20260423121000_072_project_workspace_access.sql`
- `supabase/migrations/20260424110000_073_workspace_workflow_and_project_finalization.sql`
- `supabase/migrations/20260424130000_074_project_releases_media_library_foundation.sql`
- `src/lib/projects/project-workflow-service.ts`
- `src/lib/projects/project-workflow-route-handlers.ts`
- `src/lib/projects/project-workspace-request.ts`
- `src/lib/projects/project-workspaces-service.ts`
- `src/lib/projects/project-consent-upgrade-route-handlers.ts`
- `src/lib/projects/project-participants-route-handlers.ts`
- `src/lib/project-releases/project-release-service.ts`
- `src/lib/project-releases/media-library-download.ts`
- `src/lib/project-export/project-export.ts`
- `src/lib/project-export/response.ts`
- `src/lib/tenant/permissions.ts`
- `src/app/api/projects/[projectId]/finalize/route.ts`
- `src/app/api/projects/[projectId]/workspaces/[workspaceId]/reopen/route.ts`
- `src/app/api/projects/[projectId]/workspaces/[workspaceId]/validate/route.ts`
- `src/app/api/projects/[projectId]/workspaces/route.ts`
- `src/app/api/projects/[projectId]/default-template/route.ts`
- `src/app/api/projects/[projectId]/assets/...`
- `src/app/api/projects/[projectId]/consents/...`
- `src/app/i/[token]/consent/route.ts`
- `src/app/rp/[token]/consent/route.ts`
- `src/lib/consent/submit-consent.ts`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/components/projects/project-workflow-controls.tsx`
- `src/app/(protected)/media-library/page.tsx`
- `src/app/(protected)/media-library/[releaseAssetId]/page.tsx`
- `src/app/api/media-library/assets/[releaseAssetId]/download/route.ts`
- `src/components/navigation/protected-nav.tsx`
- `tests/feature-073-project-workflow-foundation.test.ts`
- `tests/feature-073-project-workflow-routes.test.ts`
- `tests/feature-073-project-workflow-ui.test.tsx`
- `tests/feature-074-project-release-media-library.test.ts`
- `tests/feature-074-media-library-download.test.ts`

## Verified current behavior

### Current live finalization behavior

Feature 073 finalized-state storage is simple and project-level:

- `projects.finalized_at`
- `projects.finalized_by`

The 073 migration also introduced workspace workflow state on `project_workspaces`:

- `workflow_state`
- `workflow_state_changed_at`
- `workflow_state_changed_by`
- `handed_off_at/by`
- `validated_at/by`
- `needs_changes_at/by`
- `reopened_at/by`

Current workspace states are:

- `active`
- `handed_off`
- `needs_changes`
- `validated`

Current derived project workflow states are:

- `active`
- `ready_to_finalize`
- `finalized`

`src/lib/projects/project-workflow-service.ts` makes finalization effectively one-way today:

- `finalizeProject(...)` blocks archived projects.
- `finalizeProject(...)` returns `changed: false` when `finalized_at` is already set.
- `finalizeProject(...)` requires derived workflow `ready_to_finalize`.
- `finalizeProject(...)` only updates `projects.finalized_at` and `projects.finalized_by`.
- The update is retry-safe because it uses `.is("finalized_at", null)`.

There is no live project reopen path. The only existing reopen path is workspace-level `validated -> needs_changes`, and that route still depends on `assertProjectWorkflowMutable(...)`, so it cannot run after project finalization.

### Current live lock model

Finalization is currently the broad lock seam.

`assertProjectWorkflowMutable(...)` rejects:

- archived projects with `project_archived`
- finalized projects with `project_finalized`

That helper is reused by both request-scoped and row-scoped mutation access helpers in `src/lib/projects/project-workspace-request.ts`.

This means finalized projects currently block all authenticated mutation classes that flow through those helpers:

- capture mutations
- review mutations
- workspace workflow transitions
- staffing changes that call project workflow mutability
- default-template changes that call project workflow mutability

Public token writes are separately blocked by `assertWorkspacePublicSubmissionAllowed(...)`, which also rejects finalized projects.

### Current live route coverage

Routes and services already using the finalization lock correctly:

- project finalization route via `handleProjectFinalizePost(...)`
- workspace workflow routes via `handleWorkspaceWorkflowTransitionPost(...)`
- project workspace creation/staffing route at `src/app/api/projects/[projectId]/workspaces/route.ts`
- project default-template route at `src/app/api/projects/[projectId]/default-template/route.ts`
- asset upload and finalize routes under `src/app/api/projects/[projectId]/assets/...`
- participant and recurring consent request routes via `project-participants-route-handlers.ts`
- consent upgrade request route via `project-consent-upgrade-route-handlers.ts`
- public invite and recurring profile token submissions

There is no correction-specific exception path in live code.

### Current live release behavior

Feature 074 introduced `project_releases` and `project_release_assets`.

Important release constraints in live schema:

- `project_releases` unique `(tenant_id, project_id, release_version)`
- `project_releases` unique `(tenant_id, project_id, source_project_finalized_at)`
- `project_release_assets` unique `(release_id, source_asset_id)`
- release status is constrained to `building` or `published`

`ensureProjectReleaseSnapshot(...)` currently behaves as follows:

- it requires `projects.finalized_at` and `projects.finalized_by`
- it looks up an existing release by `(tenantId, projectId, finalizedAt)`
- it returns an existing `published` release unchanged
- it repairs an existing `building` release in place by deleting and rebuilding child rows
- it creates a new parent release if none exists for that `source_project_finalized_at`

Current v1 assumptions are still baked into the service:

- `release_version` is hard-coded to `1`
- `buildMissingReleaseSummary()` also hard-codes version `1`
- the parent release idempotency key is `source_project_finalized_at`

So the schema can support v2+, but the live service implementation still effectively only supports v1.

Current finalize route behavior matters for correction design:

- `handleProjectFinalizePost(...)` finalizes the project first, then calls `ensureProjectReleaseSnapshot(...)`
- if release building fails, the route still returns `200` with a repair warning payload
- retrying the same finalize path repairs or creates the release for the current `source_project_finalized_at`

That existing partial-failure repair shape is worth preserving for correction finalization.

### Current live release snapshot contents

Release snapshots are built from mutable project review state, but the snapshot rows themselves are read-only consumption records:

- only `asset_type in ('photo', 'video')` are released
- only `status = 'uploaded'` assets are included
- `archived_at is null` is required
- headshots are excluded
- storage objects are not copied; release assets point to the original storage bucket/path
- `source_asset_id` is the stable link back to the source asset

There is no explicit cross-release asset linkage column such as `supersedes_release_asset_id`.

### Current live immutability protections for published releases

Published release rows are already protected from normal mutation:

- authenticated RLS is `select` only on `project_releases`
- authenticated RLS is `select` only on `project_release_assets`
- only `service_role` can write release tables
- `ensureProjectReleaseSnapshot(...)` returns published rows unchanged on retry
- only `building` rows are repaired in place

This means the current system already treats published releases as immutable artifacts.

### Current live Media Library behavior

Media Library is reviewer-capable only:

- navigation is gated by reviewer-capable access
- `app.current_user_can_access_media_library(...)` allows only `owner`, `admin`, `reviewer`
- photographers are denied

`listMediaLibraryAssets(...)` currently lists all published release assets across all published releases in the tenant. It does not filter to the latest release per project.

`loadProjectRelease(...)` already exists and loads the latest published release for one project by ordering `source_project_finalized_at desc`, but that helper is not used by the main Media Library list.

Current Media Library state therefore has:

- no latest-release-only default
- no current-release marker
- no historical-release section
- all published release assets visible in the main list

The release asset detail page already exposes release metadata, including release version.

### Current review mutation and lock behavior

Current review mutation routes are protected by `requireWorkspaceReviewMutationAccessForRow(...)` or `requireWorkspaceReviewMutationAccessForRequest(...)`, which means they are blocked when either:

- the project is finalized
- the workspace is not in a review-open state

Live review-open workspace states are only:

- `handed_off`
- `needs_changes`

Validated workspaces are not editable through review mutation routes today. The helper has an `allowValidated` option, but no current route uses it.

This is important for Feature 075: a correction design that keeps workspaces `validated` until someone edits them cannot work without either:

- an explicit reopen step first
- or new auto-downgrade behavior inside the review mutation boundary

### Current review mutation route surface

Likely correction-safe review mutations already exist at these endpoints:

- `POST/DELETE /api/projects/[projectId]/assets/[assetId]/blocked-faces/[assetFaceId]`
- `POST/DELETE /api/projects/[projectId]/assets/[assetId]/hidden-faces/[assetFaceId]`
- `POST /api/projects/[projectId]/assets/[assetId]/manual-faces`
- `POST/DELETE /api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/assignment`
- `POST/DELETE /api/projects/[projectId]/assets/[assetId]/whole-asset-links`
- `POST/DELETE /api/projects/[projectId]/consents/[consentId]/assets/links`
- `POST /api/projects/[projectId]/consents/[consentId]/review-sessions`
- `POST /api/projects/[projectId]/consents/[consentId]/review-sessions/[sessionId]/items/[itemId]/actions`

Relevant read-only review endpoints already exist and can remain read-only:

- preview candidates
- preview faces
- preview links
- matchable assets
- manual link state reads
- review session reads

Routes that are review-adjacent but should remain blocked in Feature 075:

- `POST /api/projects/[projectId]/consents/[consentId]/upgrade-request`
- `POST /api/projects/[projectId]/consents/[consentId]/headshot`

Routes that are clearly capture-side and should remain blocked during correction:

- `POST /api/projects/[projectId]/assets`
- `POST /api/projects/[projectId]/assets/preflight`
- `POST /api/projects/[projectId]/assets/batch/prepare`
- `POST /api/projects/[projectId]/assets/batch/finalize`
- `POST /api/projects/[projectId]/assets/[assetId]/finalize`
- participant add / recurring consent request creation routes
- project workspace creation and staffing changes
- project default-template changes
- all public-token submit flows

## Current constraints and invariants

The live system already encodes the invariants Feature 075 must preserve:

- tenant scoping is required on project, workspace, asset, consent, release, and release asset queries
- server-side helpers derive authority from auth and tenant membership
- `tenant_id` is never expected from the client for authority decisions
- project finalization is the current broad mutation lock
- workspace access preserves owner/admin/reviewer versus photographer boundaries
- public token submissions are distinct from authenticated review/capture routes
- release snapshots are immutable consumption/audit artifacts after publish
- release creation is already retry-safe for the current `source_project_finalized_at`
- Media Library reads release rows, not mutable review tables
- export ZIP behavior is still separate from Media Library and should not be redesigned accidentally

## Current code paths and schema involved

### Finalization and workflow paths

- `supabase/migrations/20260424110000_073_workspace_workflow_and_project_finalization.sql`
- `src/lib/projects/project-workflow-service.ts`
- `src/lib/projects/project-workflow-route-handlers.ts`
- `src/lib/projects/project-workspace-request.ts`
- `src/app/api/projects/[projectId]/finalize/route.ts`
- `src/app/api/projects/[projectId]/workspaces/[workspaceId]/reopen/route.ts`
- `src/app/api/projects/[projectId]/workspaces/[workspaceId]/validate/route.ts`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/components/projects/project-workflow-controls.tsx`

### Release and Media Library paths

- `supabase/migrations/20260424130000_074_project_releases_media_library_foundation.sql`
- `src/lib/project-releases/project-release-service.ts`
- `src/lib/project-releases/media-library-download.ts`
- `src/app/(protected)/media-library/page.tsx`
- `src/app/(protected)/media-library/[releaseAssetId]/page.tsx`
- `src/app/api/media-library/assets/[releaseAssetId]/download/route.ts`
- `src/components/navigation/protected-nav.tsx`

### Review mutation surfaces

- `src/lib/matching/asset-preview-linking.ts`
- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/whole-asset-linking.ts`
- `src/lib/matching/manual-asset-faces.ts`
- `src/lib/matching/project-face-assignees.ts`
- review routes under `src/app/api/projects/[projectId]/assets/...`
- review routes under `src/app/api/projects/[projectId]/consents/...`

## Options considered for correction state modeling

### Option comparison

| Option | Summary | Implementation size | Auditability | Idempotency and v2+ fit | Interaction with 073 locks | Interaction with 074 release uniqueness | Future fit for 076 and DAM delta work |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A | Correction fields directly on `projects` | Smallest | Moderate | Good if `finalized_at` remains the release-event key and new releases advance it | Strong, because current broad finalization lock can stay in place and only narrow correction-safe exceptions are added | Strong, because `source_project_finalized_at` can continue to be the per-release-cycle idempotency key | Good enough for 075 and acceptable seam for 076; weaker long-term cycle audit than a dedicated table |
| B | Separate `project_correction_cycles` or `project_release_cycles` table | Medium to large | Best | Best | Requires more new joins and more helper changes | Good | Best future fit, but larger than needed for first slice |
| C | Reuse or overwrite `projects.finalized_at` to represent reopen state | Small in schema, unsafe in behavior | Weak | Poor, because the current release idempotency key is `source_project_finalized_at` | Weak, because clearing `finalized_at` reopens too much of the existing system | Poor, because the published baseline loses its current release-event key | Weak |
| D | Derive correction state from release rows only | Small in schema, incomplete in behavior | Weak | Weak | Weak, because release rows do not tell the app that review mutation exceptions are open right now | Weak | Weak |

### Option A assessment

Direct project fields are the smallest safe model if they are used narrowly.

Recommended first-slice fields to consider on `projects`:

- `correction_state` with a tight check such as `none | open`
- `correction_opened_at`
- `correction_opened_by`
- `correction_source_release_id`
- optional `correction_reason`

Not recommended for first slice:

- `latest_published_release_id`
- `current_release_version`

Those can be derived from release rows and would create pointer-maintenance work that the live schema does not currently need.

### Option B assessment

A dedicated cycle table is cleaner for a long-lived audit log, but it is larger than the first-slice problem requires. It would add:

- new lifecycle rows
- new joins in workflow helpers
- new idempotency design for start-correction and correction-finalize
- more UI data plumbing

This looks more appropriate if Feature 076 or later introduces multiple correction-scoped intake flows and operator history, not for the minimal review-only foundation.

### Option C assessment

Clearing or overloading `projects.finalized_at` is the wrong seam.

Problems:

- it would reopen capture/public-token/default-template/staffing paths that are currently guarded by finalized-project checks
- it would break the current `source_project_finalized_at` release uniqueness assumption
- it would erase the clean distinction between immutable published release history and mutable correction state

### Option D assessment

Release rows alone cannot express "correction is open right now" or "review mutations are temporarily allowed." They only express what was published.

This option is too weak for live route authorization.

### Recommended correction state model

Recommend Option A for Feature 075 first slice:

- keep `projects.finalized_at` populated while correction is open
- add a small project-level correction-open marker on `projects`
- continue treating the current finalized timestamp as the active published baseline until a new correction finalization produces a new one
- derive latest release from `project_releases`, not from a stored pointer

This preserves the current lock model and keeps the correction exception surface narrow.

## Options considered for reopen behavior

### Reopen all workspaces immediately when correction starts

Variants considered:

- set all workspaces to `needs_changes`
- set all workspaces to `handed_off`

Pros:

- simple touched-state story
- no need to know affected workspaces up front

Cons:

- unnecessary churn on untouched workspaces
- requires every workspace to be revalidated
- makes the first slice operationally heavy on multi-workspace projects

Setting all workspaces to `needs_changes` is especially awkward because `validate` currently only accepts `handed_off`, and `handoff` is capture-authorized today.

### Keep all workspaces validated until a mutation auto-downgrades them

Pros:

- only touched workspaces require revalidation
- no up-front operator action per workspace

Cons:

- hidden state changes inside review mutations
- broader helper changes across many routes
- harder to audit and reason about retries

This is workable later, but it is not the smallest safe first slice.

### Keep all workspaces validated and require explicit reopen before review edits

Pros:

- smallest explicit workflow
- easiest to audit
- no surprise write side effects in review mutation routes
- only touched workspaces leave `validated`
- existing project finalization readiness can still derive from workspace states

Cons:

- needs one correction-aware reopen path because validated workspaces are read-only today

### Recommended reopen behavior

Recommend:

- correction start is project-level only
- starting correction does not bulk-change workspace states
- affected workspaces are reopened explicitly by a reviewer-capable user before edits

There is no reliable way to know affected workspaces before review edits happen. Keeping all workspaces validated until an explicit reopen avoids unnecessary churn and keeps the operator intent visible.

For the first slice, the reopened correction workspace should move into a review-open state that reviewers can edit and validate without involving capture users again.

Important live-state observation:

- `needs_changes` is capture-oriented in the current 073 flow
- `handoff` is the existing review-ready state
- `validate` currently works from `handed_off`, not from `needs_changes`
- `handoff` is currently capture-authorized, which does not fit a reviewer-only correction loop

Because of that, the plan phase should treat the current `reopen -> needs_changes` semantics as a mismatch for review-only correction. The smallest safe direction is likely:

- add a correction-aware reopen path from `validated -> handed_off`
- keep `validate` as the revalidation step

That avoids reopening capture authority and avoids introducing a new workflow state in 075.

## Options considered for workspace revalidation

### Option 1: all workspaces must be revalidated during any correction

Pros:

- simplest data model

Cons:

- too much operator work
- unnecessary blocking on untouched workspaces

### Option 2: only touched workspaces must be revalidated, tracked by explicit reopen

Pros:

- smallest reliable touched-state model
- no new touched table
- uses existing workflow state as the source of truth

Cons:

- needs explicit reopen UI/action

### Option 3: only touched workspaces must be revalidated, tracked by hidden auto-touch

Pros:

- lower user friction

Cons:

- larger service changes
- less explicit audit trail

### Recommended revalidation model

Recommend Option 2.

Bounded first-slice behavior:

- a workspace stays `validated` until a reviewer explicitly reopens it for correction
- reopening marks the workspace as not validated anymore
- review corrections happen only inside reopened workspaces
- correction finalization requires all workspaces to be back in `validated`
- untouched workspaces stay validated and do not need a second pass

Validation blockers should reuse the existing Feature 073 blocker rules. Because Feature 075 does not reopen invites, recurring requests, upgrades, or public token intake, those blockers should normally remain zero after a finalized project enters review-only correction.

## Options considered for release v2+ identity and versioning

### Option 1: keep `source_project_finalized_at` as the per-release-cycle idempotency key

Pros:

- matches the existing 074 design
- keeps retry repair semantics intact
- does not require mutating old releases

Cons:

- requires correction finalization to advance `projects.finalized_at`

### Option 2: add a new explicit per-cycle release timestamp or cycle id and stop using `source_project_finalized_at`

Pros:

- cleaner long-term if a dedicated cycle table exists

Cons:

- more schema and service change than needed for 075
- duplicates a working release-cycle anchor the live code already uses

### Option 3: overwrite or reuse the existing release row

Pros:

- smallest write count

Cons:

- violates immutable release history
- breaks audit and DAM-friendly version semantics

### Recommended release versioning model

Recommend Option 1.

Feature 075 should keep these rules:

- each published release is tied to one finalized project timestamp
- correction finalization advances `projects.finalized_at` to a new timestamp
- `ensureProjectReleaseSnapshot(...)` uses that new timestamp as the idempotency key for the new release
- release version becomes `max(existing release_version) + 1`
- old release rows remain unchanged

`source_asset_id` is enough for first-slice cross-release asset identity. It lets later work compare:

- project
- release version
- source asset id

That is sufficient for later DAM delta logic without adding DAM-specific fields now.

Do not add `supersedes_release_asset_id` in Feature 075 first slice.

## Recommended bounded direction

### Core recommendation

Build Feature 075 on top of the existing finalization lock rather than around it.

Recommended model:

1. Keep `projects.finalized_at` and `projects.finalized_by` as the published-baseline marker.
2. Add a small correction-open marker on `projects`.
3. Allow only reviewer-capable correction actions while correction is open.
4. Keep capture, staffing, default-template, public-token, and consent-intake creation flows locked.
5. Reopen only affected workspaces explicitly for correction.
6. Reuse workspace validation before re-finalization.
7. Reuse project finalization plus release creation to publish v2+.
8. Make Media Library list read the latest published release per project by default.
9. Keep old release rows reachable as historical records but not in the default main list.

### Recommended correction lifecycle

Suggested first-slice lifecycle:

1. Project is finalized and has a published latest release.
2. Reviewer-capable user starts correction on the project.
3. Project enters correction-open mode, but capture-side and public-token routes remain locked.
4. Reviewer-capable user explicitly reopens only the workspace(s) that need correction.
5. Allowed review mutation routes update the mutable source-of-truth review tables.
6. Reopened workspaces are validated again.
7. User finalizes the project again.
8. Finalization advances `projects.finalized_at`.
9. Release snapshot service creates release version `2+`.
10. Media Library defaults to that latest published release.

### Recommended correction start rules

Who can start correction:

- `owner`
- `admin`
- `reviewer`

Who should be blocked:

- `photographer`

Project-level preconditions:

- project must be active
- project must already be finalized
- project must not already have correction open
- a published release matching the current `projects.finalized_at` should exist

That final precondition matters because correction is supposed to start from a stable published baseline. If the prior finalize returned a release-repair warning and the published release does not yet exist, the safest first-slice behavior is to repair or retry release creation first, then allow correction start.

### Recommended allow/block list during correction

Allow during correction:

- reviewer-capable project correction start
- explicit correction workspace reopen
- review mutation routes that only change link/review state
- workspace validation for reopened correction workspaces
- project re-finalization

Block during correction:

- asset upload and finalize
- one-off invite creation
- recurring participant add
- recurring project consent request creation
- consent upgrade request creation
- consent headshot replacement
- public token writes
- project staffing changes
- default-template changes

### Recommended Media Library direction

Feature 075 should make Media Library act like a latest-published-release view by default.

Recommended default behavior:

- list page shows only assets from the latest published release per project
- detail page continues to show release version metadata
- older release assets remain directly reachable by release asset id
- no dedicated history browser is required in 075

Recommended storage/query direction:

- derive latest published release from `project_releases`
- do not add `projects.latest_published_release_id` in 075
- do not mutate old release rows to mark them inactive

The current schema already has usable indexes for per-project latest-release lookup by `source_project_finalized_at desc`, but the plan phase should verify whether a partial published index would materially improve the new list query.

## Minimal UI research

Feature 075 does not need a new dashboard or a new Media Library information architecture.

Minimal project-page surfaces:

- finalized project state shows `Start correction` for `owner`, `admin`, `reviewer`
- a correction-open banner or status row explains that review corrections are open and the next finalization will publish a new release version
- existing workspace workflow controls are reused for correction reopen and revalidation
- correction finalization appears on the existing project workflow panel when all reopened workspaces return to `validated`

Minimal Media Library surfaces:

- default list reads latest published release assets only
- release asset detail keeps showing release version metadata
- older releases can remain direct-link historical records without adding folders, collections, or a new history browser in 075

UI copy later implementation notes:

- keep changes inside the existing project page and Media Library pages
- do not introduce new product-marketing sections or dashboard chrome
- follow existing i18n patterns for English and Dutch when the UI phase starts

## First-slice scope recommendation

In scope for Feature 075 first slice:

- project-level correction-open state
- correction start authorization for reviewer-capable roles
- correction-safe review-only workspace reopen path
- correction-safe allowlist for existing review mutation routes
- revalidation of reopened correction workspaces
- project re-finalization
- immutable release version `2+` creation
- latest-release default Media Library reads
- release-version metadata in existing UI surfaces
- tests for correction state, route boundaries, release versioning, and latest-release reads

Explicitly out of scope for Feature 075 first slice:

- new one-off people
- new recurring profiles
- adding existing recurring profiles as new participants
- new one-off invite links
- new project recurring consent requests
- one-off consent upgrade requests
- recurring project replacement or upgrade requests
- reopening public token write flows
- uploading new project media
- project staffing changes
- new consent templates
- DAM sync
- DAM delta tables
- folder or collection management
- public sharing
- comments or discussion
- notification or email workflows
- arbitrary editing of existing release rows

## Security and reliability findings

### Security findings

- Current tenant scoping is already embedded in project, workspace, asset, consent, release, and release-asset queries.
- Current reviewer-capable permission helpers are the correct authority seam for correction start and correction review actions.
- Photographers should stay outside correction authority because their live project permissions are capture-scoped and workspace-assignment-scoped, not project-wide review-scoped.
- Release-table RLS already supports v2+ without needing broader authenticated writes.
- The main security risk is accidentally reopening capture/public/default-template/staffing flows if correction is implemented by clearing `finalized_at`. That approach should be avoided.

### Reliability findings

- Current finalization plus release creation is already designed for retry after partial release build failure.
- Reusing `source_project_finalized_at` for v2+ keeps that retry story intact.
- Old release immutability is already compatible with correction and should stay untouched.
- Explicit workspace reopen is more reliable than auto-touching workspaces inside review mutations because it keeps retries and audit easier to reason about.

## Risks and tradeoffs

- Direct correction fields on `projects` are the smallest safe choice, but they are less audit-rich than a dedicated cycle table.
- Requiring explicit workspace reopen adds one more operator action, but it keeps the correction surface narrow and explicit.
- Keeping old release assets out of the default Media Library list improves the normal read path, but the plan phase still needs to decide whether there should be any light historical affordance in the UI.
- Reusing the existing finalize route is probably the smallest path, but `finalizeProject(...)` must stop treating "already finalized" as a universal no-op when correction is open.
- The current 073 workspace state machine was built for capture handoff, not review-only correction. The plan phase needs one small state-transition decision to avoid accidentally restoring capture authority.

## Suggested tests for the plan phase

Correction start:

- owner can start correction
- admin can start correction
- reviewer can start correction
- photographer cannot start correction
- correction start requires existing finalized project
- correction start is idempotent or conflict-safe
- correction start rejects when latest published release for current finalized baseline is missing

Correction-time route boundaries:

- allowed review mutation routes succeed during correction for reviewer-capable users
- blocked review-adjacent routes remain blocked during correction
- capture routes remain blocked during correction
- public token submission routes remain blocked during correction
- staffing and default-template routes remain blocked during correction

Workspace correction and revalidation:

- correction reopen only affects explicitly selected workspaces
- untouched validated workspaces remain validated
- reopened workspaces are no longer considered validated
- reopened workspaces must be validated again before project finalization
- validation continues to use existing blocker rules

Correction finalization and release versioning:

- correction finalization creates release v2
- second correction creates release v3
- repeated finalize retry for the same correction cycle does not create duplicate releases
- partial release build failure can be repaired without mutating older published releases
- old release v1 rows remain unchanged after v2 publish

Media Library:

- list page defaults to latest published release per project
- detail page shows release version metadata
- older release asset detail remains accessible if addressed directly
- photographer is denied Media Library access

Security and tenant isolation:

- cross-tenant correction start is denied
- cross-tenant correction review mutation is denied
- cross-tenant release asset read is denied

## Future Feature 076 seams

These should be treated as deferred seams, not part of Feature 075 plan scope:

- correction-scoped one-off invites
- adding existing recurring profiles to a correction workspace
- project recurring consent requests during correction
- one-off consent upgrade requests during correction
- recurring project consent replacement during correction
- public token writes during correction
- validation blockers for pending correction consent work

Feature 075 should leave clear seams for those later additions:

- project-level correction-open state
- workspace-level correction reopen and revalidation
- correction-aware route authorization helper boundaries
- immutable per-release version history
- stable `source_asset_id` across releases

## Explicit open decisions for the plan phase

1. Should correction start require a reason string, or should `correction_reason` stay optional in the first slice?
2. Should the correction workspace reopen action reuse the existing `reopen` route with correction-only semantics, or should it use a distinct correction-only route?
3. Should the reopened correction workspace move to `handed_off`, or should the workflow service instead gain a correction-only direct `validated -> validated-after-edit` style path?
4. Should the finalize route remain `POST /api/projects/[projectId]/finalize` for both initial finalization and correction finalization, or is a distinct correction-finalize route still justified after route-level review?
5. Should older release assets be completely hidden from navigation in 075, or should there be a minimal history affordance that does not expand into a new Media Library information architecture?
6. Does the latest-release list query need a new partial published index, or is the existing release indexing sufficient at current expected scale?
