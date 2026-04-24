# Feature 072 Implementation Summary

## Reader note

This file is cumulative.

- The early sections capture the original foundation pass and intermediate continuation passes.
- The latest status is defined by the most recent continuation summary near the end of the document.
- Where an older section says Feature 072 was still incomplete, treat that as historical context for that pass, not the current repo state.

## Inputs followed

Implementation was driven by:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `docs/rpi/README.md`
5. `docs/rpi/072-project-staffing-photographer-scoped-capture-workspaces-and-bounded-project-workflow-permissions/plan.md`

The plan remained the implementation contract. Live code and schema were used as the final source of truth when a plan detail needed verification.

## What was completed in this implementation phase

### 1. Schema and migration foundation

Added [20260423120000_072_project_workspaces_foundation.sql](/C:/Users/tim/projects/snapconsent-lite/supabase/migrations/20260423120000_072_project_workspaces_foundation.sql).

This migration establishes the structural foundation for Feature 072:

- creates `public.project_workspaces`
- backfills one default workspace per existing project
- adds `workspace_id` to the planned project-local operational tables
- backfills existing rows onto the default workspace
- adds defaulting triggers so older insert paths still attach to the default workspace
- adds workspace foreign keys and core workspace indexes
- rebuilds key uniqueness boundaries to include `workspace_id` where needed
- tightens `workspace_id` to non-null for the project-local tables covered in this slice

### 2. SQL access and RLS foundation

Added [20260423121000_072_project_workspace_access.sql](/C:/Users/tim/projects/snapconsent-lite/supabase/migrations/20260423121000_072_project_workspace_access.sql).

This migration adds the first workspace-aware permission layer:

- redefines project access so photographers only see projects where they have at least one workspace
- adds workspace-aware SQL helpers for access, capture, review, and staffing management
- enables RLS on `project_workspaces`
- rewrites the core project, invite, consent, asset, participant, and review-related policies to use workspace-aware access helpers

### 3. TypeScript permission and workspace service foundation

Updated [permissions.ts](/C:/Users/tim/projects/snapconsent-lite/src/lib/tenant/permissions.ts).

Added:

- `AccessibleProjectWorkspace`
- `WorkspacePermissions`
- `resolveAccessibleProjectWorkspaces(...)`
- `resolveWorkspacePermissions(...)`
- `assertCanManageProjectWorkspacesAction(...)`
- `assertCanCaptureWorkspaceAction(...)`
- `assertCanReviewWorkspaceAction(...)`

Added [project-workspaces-service.ts](/C:/Users/tim/projects/snapconsent-lite/src/lib/projects/project-workspaces-service.ts).

This service provides:

- visible workspace listing
- project workspace selection resolution
- idempotent photographer workspace creation

### 4. Workspace API foundation

Added [route.ts](/C:/Users/tim/projects/snapconsent-lite/src/app/api/projects/[projectId]/workspaces/route.ts).

Implemented:

- `GET /api/projects/[projectId]/workspaces`
- `POST /api/projects/[projectId]/workspaces`

Behavior:

- `GET` returns only visible workspaces
- `POST` is owner/admin-only and idempotently creates one photographer workspace per photographer assignment

### 5. Capture helper compatibility changes

Updated:

- [create-asset.ts](/C:/Users/tim/projects/snapconsent-lite/src/lib/assets/create-asset.ts)
- [finalize-asset.ts](/C:/Users/tim/projects/snapconsent-lite/src/lib/assets/finalize-asset.ts)
- [invite-idempotency.ts](/C:/Users/tim/projects/snapconsent-lite/src/lib/idempotency/invite-idempotency.ts)

These changes introduced optional `workspaceId` support while preserving old single-workspace behavior.

Reason:

- new workspace-aware callers need explicit workspace scoping
- older callers and existing tests still depend on legacy single-workspace semantics during the transition

## Intentional deviations from the full plan

This implementation phase stopped at the structural foundation and did not complete the entire plan.

Not completed in this phase:

- full project page workspace navigation and switcher
- owner/admin staffing UI inside the project page
- full route-by-route conversion of capture and review APIs to require `workspaceId`
- full SSR project page resolution against selected workspace
- full public invite flow and recurring project consent flow conversion to explicit workspace scope
- full matching/read-model isolation sweep
- export conversion to workspace-scoped reviewer/admin/owner-only behavior

Reason for stopping:

- the schema and permission foundation needed to land first
- attempting the entire route/UI/read-model sweep in one pass would have mixed structural foundation work with a much larger behavioral migration
- targeted test runs showed that backward compatibility had to be preserved carefully in shared helper paths before continuing

## Verification run in this phase

### Passed

- `npx eslint src/lib/tenant/permissions.ts src/lib/projects/project-workspaces-service.ts src/lib/assets/create-asset.ts src/lib/assets/finalize-asset.ts src/lib/idempotency/invite-idempotency.ts src/app/api/projects/[projectId]/workspaces/route.ts`
- `npx tsx --test --test-concurrency=1 tests/feature-024-upload-performance-resumability.test.ts`
- `npx tsx --test --test-concurrency=1 tests/feature-070-tenant-rbac-foundation.test.ts tests/feature-043-simple-project-export-zip.test.ts`

### Partially passing targeted run

- `npx tsx --test --test-concurrency=1 tests/feature-010-auto-match-backbone.test.ts tests/feature-024-upload-performance-resumability.test.ts`

Outcome:

- `feature-024` passed after compatibility fixes
- `feature-010` still had one failing stale-job reclaim assertion

## Constraints and observations from implementation

- The repository already had a dirty worktree and adjacent Feature 070 changes; this implementation was done additively without reverting unrelated work.
- The new workspace foundation had to preserve old single-workspace behavior until the route/UI/read-model sweep is complete.
- Some existing tests still assert old export behavior for photographers. That export boundary change is still pending.
- Matching continuation constraints need a careful follow-up pass before the full workspace isolation migration can be considered complete.

## Recommended next implementation step

Continue with the remaining Feature 072 sweep on top of this foundation:

1. convert the project page and SSR loads to resolve/select one workspace inside the existing `/projects/[projectId]` route
2. convert capture and review routes to explicit workspace-aware access checks
3. make public invite and recurring project consent flows persist workspace-scoped rows explicitly
4. scope matching progress and project read models to the selected workspace
5. move export to the planned workspace-scoped reviewer/admin/owner boundary

## Current status

Feature 072 is not fully implemented end-to-end yet.

What exists now is the bounded foundation:

- subordinate `project_workspaces` scope in the schema
- default workspace backfill for existing projects
- first workspace-aware SQL and TypeScript permission layer
- workspace listing/creation service and API
- transition-safe helper support for workspace-aware capture writes

That foundation is intended to support the remaining route, UI, and read-model migration in the next implementation pass.

## Continuation pass 2 summary

This continuation pass advanced Feature 072 after the initial schema/foundation implementation.

### Completed

- Tightened workspace-aware protected project flow:
    - photographers now only see assigned projects
    - workspace selection failures resolve to 404
    - export is hidden unless the user has review-level rights
- Added missing workspace UI copy in:
    - `messages/en.json`
    - `messages/nl.json`
- Made matching progress and export honor the Feature 072 boundary:
    - `src/app/api/projects/[projectId]/matching-progress/route.ts` resolves a selected workspace and enforces workspace visibility
    - `src/lib/project-export/response.ts`, `src/lib/project-export/project-export.ts`, and `src/app/api/projects/[projectId]/export/route.ts` make export workspace-scoped and reviewer/admin/owner-only
- Made asset batch/finalize flows workspace-aware in:
    - `src/lib/assets/prepare-project-asset-batch.ts`
    - `src/lib/assets/finalize-project-asset-batch.ts`
    - `src/lib/assets/post-finalize-processing.ts`
    - `src/app/api/projects/[projectId]/assets/batch/prepare/route.ts`
    - `src/app/api/projects/[projectId]/assets/batch/finalize/route.ts`
    - `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`
- Updated public consent paths to carry workspace scope compatibly:
    - `src/lib/invites/public-invite-context.ts`
    - `src/lib/consent/submit-consent.ts`
    - `src/lib/recurring-consent/public-recurring-consent.ts`
    - related public submit route(s)
- Updated matching job enqueue paths so they accept and persist `workspaceId` where supplied:
    - `src/lib/matching/auto-match-jobs.ts`
    - `src/lib/matching/auto-match-fanout-continuations.ts`
    - `src/lib/matching/project-recurring-sources.ts`
- Updated tests for the new export and participant-route boundary:
    - `tests/feature-043-simple-project-export-zip.test.ts`
    - `tests/feature-055-project-participants-routes.test.ts`

### Minimal deviations from `plan.md`

- Added compatibility fallback in export and public consent lookup paths for test/legacy schema runs where `project_workspaces` or `workspace_id` columns are not yet visible through PostgREST.
- On migrated schema, the new workspace-scoped behavior applies.
- Did not finish the full review-route sweep or the full workspace-scoped read-model sweep.
- This pass focused on project discovery, export, matching progress, public submit propagation, and finalize/capture boundary enforcement.

### Remaining unfinished Feature 072 items

- Complete explicit row-level workspace enforcement for review/detail routes.
- Finish public recurring/project consent UI loads beyond persistence.
- Finish the broader workspace-scoped read-model isolation sweep for remaining legacy routes/helpers.
- Expand or verify the minimal project-page staffing/switcher UI if needed.
- Fix remaining `feature-021-project-matching-progress.test.ts` fixture failures caused by `face_match_fanout_continuations` rows no longer satisfying the current scope check constraint.

### Tests run

Passed:

- `npx eslint` on all updated app/lib/test files in this pass
- `npx tsx --test --test-concurrency=1 tests/feature-043-simple-project-export-zip.test.ts`
- `npx tsx --test --test-concurrency=1 tests/feature-024-upload-performance-resumability.test.ts tests/feature-055-project-participants-routes.test.ts`
- `npx tsx --test --test-concurrency=1 tests/feature-010-auto-match-backbone.test.ts`

Still failing:

- `npx tsx --test --test-concurrency=1 tests/feature-021-project-matching-progress.test.ts`
    - 2 continuation-fixture cases still fail
    - likely because the test inserts `face_match_fanout_continuations` rows that no longer satisfy the existing scope check constraint
    - do not weaken workspace isolation to fix this; update the fixture or implementation consistently with the new workspace scope

## Continuation pass 3 summary

This pass finished the remaining Feature 072 continuation items that were explicitly requested for review/detail enforcement, public recurring/project consent propagation, read-model isolation, and the `feature-021` continuation fixture failures.

### Completed

- Completed explicit row-level workspace enforcement before elevated/admin-client review/detail operations in:
  - `src/app/api/projects/[projectId]/assets/[assetId]/blocked-faces/[assetFaceId]/route.ts`
  - `src/app/api/projects/[projectId]/assets/[assetId]/hidden-faces/[assetFaceId]/route.ts`
  - `src/app/api/projects/[projectId]/consents/[consentId]/assets/links/route.ts`
  - `src/app/api/projects/[projectId]/consents/[consentId]/assets/matchable/route.ts`
  - `src/app/api/projects/[projectId]/consents/[consentId]/assets/[assetId]/manual-link-state/route.ts`
  - `src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts`
- Finished the remaining consent-photo helper scoping needed by those routes in:
  - `src/lib/matching/photo-face-linking.ts`
  - `src/lib/matching/consent-photo-matching.ts`
  - added optional `workspaceId` handling to consent and asset validation
  - scoped matchable-photo, linked-photo, whole-asset fallback, and related lookup queries by workspace when supplied
- Preserved legacy/single-workspace compatibility for project participant request creation in:
  - `src/lib/projects/project-participants-service.ts`
  - added compatibility fallbacks when `workspace_id` is not exposed through PostgREST
  - allowed legacy null-workspace participant rows to continue through the default single-workspace path without weakening the current workspace boundary
- Finished the `feature-021-project-matching-progress.test.ts` continuation fixture repair:
  - updated the fixture to create a valid boundary one-off consent
  - populated `boundary_consent_id` on continuation rows instead of weakening the scope constraint
- Fixed the remaining public recurring baseline test fixture regression in:
  - `tests/feature-051-baseline-recurring-consent-request-foundation.test.ts`
  - the helper now signs with the existing profile's current name/email instead of reusing one hardcoded email across multiple active profiles
- Fixed a verification-found preview helper regression in:
  - `src/lib/matching/asset-preview-linking.ts`
  - restored the missing `workspaceId` argument when loading current headshot materialization ids for preview candidates

### Deviations from `plan.md`

- No intentional behavior deviation from the Feature 072 workspace contract was introduced.
- One compatibility deviation remains deliberate:
  - legacy/test schema runs that do not expose `workspace_id` through PostgREST still use compatibility fallbacks in participant request creation and related older flows
  - current schema runs still enforce workspace isolation
- Requested new workspace-specific DB coverage for public project recurring consent could not be added in the older Feature 055 compatibility harness because that harness does not expose `project_workspaces` in the PostgREST schema cache. Existing and updated tests were kept green instead of adding schema-specific assertions that only pass on the fully migrated cache state.

### Remaining unfinished Feature 072 items after this pass

- Add more direct automated coverage for cross-workspace review/detail route rejection at the route-module boundary itself.
- Finish any remaining legacy read helpers still mixing project-wide rows where a selected workspace should be required.
- Verify whether any project/workspace UI load paths still need explicit workspace-scoped rendering assertions beyond the already updated service and route coverage.

### Tests run in this pass

Passed:

- `npx eslint src/lib/projects/project-participants-service.ts`
- `npx tsx --test --test-concurrency=1 tests/feature-055-project-participants-foundation.test.ts`
- `npx eslint src/lib/matching/photo-face-linking.ts src/lib/matching/consent-photo-matching.ts src/app/api/projects/[projectId]/assets/[assetId]/blocked-faces/[assetFaceId]/route.ts src/app/api/projects/[projectId]/assets/[assetId]/hidden-faces/[assetFaceId]/route.ts src/app/api/projects/[projectId]/consents/[consentId]/assets/links/route.ts src/app/api/projects/[projectId]/consents/[consentId]/assets/matchable/route.ts src/app/api/projects/[projectId]/consents/[consentId]/assets/[assetId]/manual-link-state/route.ts src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts`
- `npx tsx --test --test-concurrency=1 tests/feature-032-face-consent-linking-ui-improvements.test.ts`
- `npx tsx --test --test-concurrency=1 tests/feature-051-baseline-recurring-consent-request-foundation.test.ts`
- `npx eslint tests/feature-051-baseline-recurring-consent-request-foundation.test.ts`
- `npx tsx --test --test-concurrency=1 tests/feature-044-asset-preview-linking-ux-improvements.test.ts`
- `npx tsx --test --test-concurrency=1 tests/feature-045-asset-preview-unlinked-faces-and-hidden-face-suppression.test.ts`
- `npx tsx --test --test-concurrency=1 tests/feature-048-block-person-assignment-for-faces-without-consent.test.ts`
- `npx eslint src/lib/matching/asset-preview-linking.ts`
- `npx tsx --test --test-concurrency=1 tests/feature-021-project-matching-progress.test.ts`
- `npx tsx --test --test-concurrency=1 tests/feature-067-consent-upgrade-route.test.ts`

Also rerun successfully during this pass after compatibility fixes:

- `npx tsx --test --test-concurrency=1 tests/feature-055-project-participants-foundation.test.ts`
- `npx tsx --test --test-concurrency=1 tests/feature-051-baseline-recurring-consent-request-foundation.test.ts`

## Continuation pass 4 summary

This pass audited the completed Feature 072 implementation for compatibility code that only existed to support pre-072 local schemas, old fixture shapes, or runtime fallbacks that hid missing workspace scope. The target was a clean fresh schema from `supabase db reset`, not arbitrary legacy local data.

### Removed or simplified compatibility code

- Removed runtime PostgREST fallback/update paths that were only compensating for older request/consent rows without proper workspace persistence:
  - `src/lib/projects/project-participants-service.ts`
  - `src/lib/recurring-consent/public-recurring-consent.ts`
- Removed project-wide assignee helper behavior from active matching paths by threading explicit `workspaceId` through the remaining consent/recurring assignee lookups and writers:
  - `src/lib/matching/project-face-assignees.ts`
  - `src/lib/matching/photo-face-linking.ts`
  - `src/lib/matching/whole-asset-linking.ts`
  - `src/lib/matching/auto-match-worker.ts`
- Simplified the Feature 055 test setup to use the current workspace model directly instead of depending on authenticated project creation during fixture setup:
  - `tests/feature-055-project-participants-foundation.test.ts`

### Kept compatibility and migration support intentionally

- Kept default workspace creation on new projects and backfill/defaulting triggers in the 072 migration foundation because a fresh reset still needs a valid default workspace model.
- Kept migration-time backfills that attach existing project-local rows to a valid workspace because they are required for a correct migrated schema, not for stale local fixture support.
- Kept forward-compatible workspace derivation in SQL write paths where a clean migrated schema still needs the database to persist the correct workspace atomically.

### Schema and SQL corrections completed

- Finished the 072 schema migration for the generic assignee suppression table:
  - added `workspace_id` to `asset_face_assignee_link_suppressions`
  - backfilled it from the owning asset workspace
  - added trigger/fk/not-null coverage
  - added workspace-aware RLS policies for the table
- Tightened recurring project consent uniqueness and write-path correctness on a fresh reset:
  - `recurring_profile_consents_active_signed_project_unique_idx` now excludes superseded rows
  - `app.create_recurring_profile_project_consent_request(...)` now scopes active/pending checks by workspace and inserts `workspace_id` directly
  - `app.submit_public_recurring_profile_consent(...)` now scopes prior-active lookup by workspace, inserts consent `workspace_id` directly, and resolves the governing participant in the same workspace
- Fixed scope projection writes so project recurring/project consent projections derive and persist the governing workspace instead of falling through the default-workspace trigger:
  - `app.insert_project_consent_scope_signed_projections(...)`

### Tests and fixtures updated

- Feature 055 fixtures now create/use the current workspace model explicitly:
  - default workspace lookup
  - explicit photographer workspace creation
  - participant/request/consent rows attached to that workspace
- Matching/review paths now use workspace-scoped assignee lookups so read models and canonical state do not mix rows across workspaces.

### Deviations from `plan.md`

- No product-behavior deviation was introduced.
- This pass intentionally optimized for clean-reset correctness rather than preserving arbitrary old local data or pre-072 fixture shapes, per the review clarification.

### Remaining compatibility code to revisit later

- The 072 migration still retains defaulting/backfill triggers for migrated project-local rows. They are still useful for migration correctness and single-workspace defaults, but they should be revisited later if the codebase fully eliminates all insert paths that rely on trigger-side workspace defaulting.
- Some older legacy tables remain in the schema for historical migration continuity even though current Feature 072 runtime paths use the newer workspace-scoped tables.

### Tests run in this pass

Passed:

- `supabase db reset`
- `npx tsx --test --test-concurrency=1 tests/feature-032-face-consent-linking-ui-improvements.test.ts`
- `npx tsx --test --test-concurrency=1 tests/feature-055-project-participants-foundation.test.ts`
- `npx tsx --test --test-concurrency=1 tests/feature-010-auto-match-backbone.test.ts tests/feature-019-face-materialization-pipeline.test.ts tests/feature-021-project-matching-progress.test.ts tests/feature-029-complete-bounded-matching-fanout.test.ts tests/feature-031-one-consent-per-face-precedence-rules.test.ts tests/feature-032-face-consent-linking-ui-improvements.test.ts tests/feature-043-simple-project-export-zip.test.ts tests/feature-045-asset-preview-unlinked-faces-and-hidden-face-suppression.test.ts tests/feature-051-baseline-recurring-consent-request-foundation.test.ts tests/feature-055-project-participants-foundation.test.ts tests/feature-067-consent-upgrade-route.test.ts`
- `npx eslint src/lib/matching/project-face-assignees.ts src/lib/matching/photo-face-linking.ts src/lib/matching/whole-asset-linking.ts src/lib/matching/auto-match-worker.ts src/lib/matching/auto-match-repair.ts src/lib/projects/project-participants-service.ts src/lib/recurring-consent/public-recurring-consent.ts tests/feature-055-project-participants-foundation.test.ts tests/helpers/supabase-test-client.ts`

## Current status after pass 4

Feature 072 is implemented on the current clean-reset model.

What is in place now:

- `project` remains the umbrella container and `workspace` is the operational unit
- default workspace creation works on fresh project creation and migration backfill
- photographers are bounded to their own project workspaces
- capture, matching, review/detail, public recurring project consent, read models, and export are workspace-scoped on the active 072 paths
- matching/review read helpers use workspace-scoped assignee and suppression state
- fresh-schema recurring project consent request/submit paths persist `workspace_id` directly instead of relying on compatibility follow-up updates

What remains as follow-up rather than core implementation work:

- broader direct regression coverage for cross-workspace rejection at some route-module boundaries
- possible future cleanup of migration/defaulting triggers if every insert path eventually becomes explicitly workspace-aware
- eventual retirement review of historical legacy tables that remain only for migration continuity
