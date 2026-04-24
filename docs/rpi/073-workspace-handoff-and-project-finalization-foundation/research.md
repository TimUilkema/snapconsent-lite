# Feature 073 Research - Workspace handoff and project validation/finalization foundation

## Scope and source-of-truth

This document covers the research phase only for Feature 073.

Current live code and current live database schema are authoritative.

Prior RPI documents and `docs/rpi/SUMMARY.md` were reviewed as context, but if they differ from live code or schema, this document follows live implementation and calls out notable drift.

The goal is a first bounded workflow/state layer on top of Feature 072 workspaces:

- capture-capable users can hand off a workspace
- review-capable users can validate a workspace or mark it as needing changes
- review/admin users can finalize the project once required workspaces are complete

This research assumes the existing role model from Feature 070 and the workspace isolation model from Feature 072 remain intact.

## Inputs reviewed

Requested context and RPI inputs:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/SUMMARY.md`
- `docs/rpi/README.md`
- `docs/rpi/070-tenant-rbac-and-organization-user-management-foundation/research.md`
- `docs/rpi/070-tenant-rbac-and-organization-user-management-foundation/plan.md`
- `docs/rpi/072-project-staffing-photographer-scoped-capture-workspaces-and-bounded-project-workflow-permissions/research.md`
- `docs/rpi/072-project-staffing-photographer-scoped-capture-workspaces-and-bounded-project-workflow-permissions/plan.md`
- `docs/rpi/060-project-unresolved-face-review-queue/research.md`
- `docs/rpi/060-project-unresolved-face-review-queue/plan.md`
- `docs/rpi/061-link-consent-to-whole-asset/research.md`
- `docs/rpi/061-link-consent-to-whole-asset/plan.md`
- `docs/rpi/064-whole-asset-linking-for-video-assets/research.md`
- `docs/rpi/064-whole-asset-linking-for-video-assets/plan.md`
- `docs/rpi/067-consent-scope-state-and-upgrade-requests/research.md`
- `docs/rpi/067-consent-scope-state-and-upgrade-requests/plan.md`
- `docs/rpi/069-consent-upgrade-flow-owner-reuse-and-prefill-refinement/research.md`
- `docs/rpi/069-consent-upgrade-flow-owner-reuse-and-prefill-refinement/plan.md`
- `docs/rpi/071-consent-upgrade-flow-headshot-reuse-and-upgrade-ux-fixes/research.md`
- `docs/rpi/071-consent-upgrade-flow-headshot-reuse-and-upgrade-ux-fixes/plan.md`

Authoritative live schema, helpers, routes, UI, and tests reviewed:

- `supabase/migrations/20260304210000_002_projects_invites_schema.sql`
- `supabase/migrations/20260423120000_072_project_workspaces_foundation.sql`
- `supabase/migrations/20260423121000_072_project_workspace_access.sql`
- `src/lib/tenant/permissions.ts`
- `src/lib/projects/project-workspaces-service.ts`
- `src/lib/projects/project-workspace-request.ts`
- `src/lib/projects/project-participants-service.ts`
- `src/lib/projects/project-consent-upgrade-service.ts`
- `src/lib/projects/current-one-off-consent.ts`
- `src/lib/matching/project-matching-progress.ts`
- `src/lib/matching/asset-preview-linking.ts`
- `src/lib/matching/face-review-sessions.ts`
- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/whole-asset-linking.ts`
- `src/lib/consent/project-consent-scope-state.ts`
- `src/lib/project-export/project-export.ts`
- `src/lib/project-export/response.ts`
- `src/lib/invites/public-invite-context.ts`
- `src/lib/recurring-consent/public-recurring-consent.ts`
- `src/lib/consent/submit-consent.ts`
- `src/app/(protected)/projects/page.tsx`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/app/api/projects/[projectId]/workspaces/route.ts`
- `src/app/api/projects/[projectId]/default-template/route.ts`
- `src/app/api/projects/[projectId]/export/route.ts`
- `src/app/api/projects/[projectId]/matching-progress/route.ts`
- capture routes under `src/app/api/projects/[projectId]/invites`, `profile-participants`, and `assets`
- review routes under `src/app/api/projects/[projectId]/assets/...` and `consents/...`
- public token routes under `src/app/i/[token]/consent/route.ts`, `src/app/rp/[token]/consent/route.ts`, and `src/app/api/public/invites/[token]/headshot/...`
- `messages/en.json`
- `messages/nl.json`
- `tests/feature-021-project-matching-progress.test.ts`
- `tests/feature-043-simple-project-export-zip.test.ts`
- `tests/feature-055-project-participants-foundation.test.ts`
- `tests/feature-055-project-participants-routes.test.ts`
- `tests/feature-067-consent-upgrade-route.test.ts`
- `tests/feature-070-tenant-rbac-foundation.test.ts`
- `tests/feature-071-one-off-current-surfaces.test.ts`
- `tests/helpers/supabase-test-client.ts`

## Verified current behavior

### Drift from older docs

Notable drift between prior context docs and live code:

- Live one-off current-facing surfaces already hide superseded consent rows.
  - `src/lib/projects/current-one-off-consent.ts`
  - covered by `tests/feature-071-one-off-current-surfaces.test.ts`
- Live project page does not stop on a blank workspace selection for multi-workspace users.
  - `resolveProjectWorkspaceSelection` returns `requiresExplicitSelection`
  - `src/app/(protected)/projects/[projectId]/page.tsx` immediately redirects to the first visible workspace
- Live code already exposes workspace selection inside the existing project page and keeps navigation project-first.
  - there is no user-facing "umbrella project" term in live UI

### 1. Current live boundary after Feature 072

`project_workspaces` is live and is the current isolation boundary.

Authoritative schema:

- `supabase/migrations/20260423120000_072_project_workspaces_foundation.sql`
- `supabase/migrations/20260423121000_072_project_workspace_access.sql`

Current `project_workspaces` columns:

- `id`
- `tenant_id`
- `project_id`
- `workspace_kind`
- `photographer_user_id`
- `name`
- `created_by`
- `created_at`

Current constraints and helpers:

- `workspace_kind` check allows `default` and `photographer`
- shape check requires `photographer_user_id` only for `photographer`
- one default workspace per project
- one photographer workspace per `(tenant_id, project_id, photographer_user_id)`
- `app.default_project_workspace_id(...)`
- trigger `app.ensure_default_project_workspace()` auto-creates a default workspace for every project

Current `project_workspaces` RLS and SQL access helpers:

- select policy uses `app.current_user_can_access_project_workspace(...)`
- insert/update/delete policies use `app.current_user_can_manage_project_workspaces(...)`
- SQL helpers exist for:
  - `current_user_can_access_project`
  - `current_user_can_manage_project_workspaces`
  - `current_user_can_access_project_workspace`
  - `current_user_can_capture_project`
  - `current_user_can_capture_project_workspace`
  - `current_user_can_review_project`
  - `current_user_can_review_project_workspace`

Current project-scoped versus workspace-scoped boundary:

- project-scoped:
  - `projects`
  - project metadata such as `default_consent_template_id`
  - project page route and navigation
- workspace-scoped after Feature 072:
  - `subjects`
  - `assets`
  - `consents`
  - `subject_invites`
  - `asset_consent_links`
  - `asset_face_materializations`
  - `asset_face_materialization_faces`
  - `asset_face_consent_links`
  - hidden face state
  - blocked face state
  - `face_match_jobs`
  - `face_match_fanout_continuations`
  - `project_face_assignees`
  - `project_profile_participants`
  - project-kind `recurring_profile_consent_requests`
  - project-kind `recurring_profile_consents`
  - `project_consent_upgrade_requests`
  - `face_review_sessions`
  - `face_review_session_items`

The live project detail page resolves the selected workspace as follows:

- `src/lib/projects/project-workspaces-service.ts`
  - if `workspaceId` is requested, it must be visible to the current user or the request fails
  - if one visible workspace exists, it auto-selects it
  - if multiple visible workspaces exist and none is requested, it returns `requiresExplicitSelection`
- `src/app/(protected)/projects/[projectId]/page.tsx`
  - calls `resolveProjectWorkspaceSelection(...)`
  - when multiple visible workspaces exist and none is selected, it redirects to the first visible workspace
  - all workspace-scoped panels then use the selected workspace

Current UI behavior:

- single-workspace project:
  - effectively behaves as a normal project page
  - workspace is auto-selected
  - no separate navigation tree is introduced
- multi-workspace project:
  - still uses the same project detail page
  - shows workspace chips inside the header area
  - all participants/invites/assets/matching panels are filtered to the selected workspace

### 2. Current permission model

Live TypeScript permission helpers:

- `src/lib/tenant/permissions.ts`

Current role model:

- `owner`
- `admin`
- `reviewer`
- `photographer`

Current tenant-level permission mapping:

- owner/admin:
  - can manage members
  - can manage templates
  - can manage profiles
  - can create projects
  - can capture
  - can review
- reviewer:
  - review only
- photographer:
  - capture only

Current project/workspace access helpers:

- `resolveAccessibleProjectWorkspaces(...)`
  - owner/admin/reviewer can see all workspaces in the project
  - photographer only sees workspaces where `photographer_user_id = current user`
- `resolveWorkspacePermissions(...)`
  - validates tenant membership
  - validates project workspace existence
  - denies photographers outside their assigned workspace with a 404
- `assertCanCaptureWorkspaceAction(...)`
- `assertCanReviewWorkspaceAction(...)`
- `assertCanManageProjectWorkspacesAction(...)`

Current request helpers that routes already reuse:

- `src/lib/projects/project-workspace-request.ts`
- `requireWorkspaceCaptureAccessForRequest(...)`
- `requireWorkspaceReviewAccessForRequest(...)`
- `requireWorkspaceCaptureAccessForRow(...)`
- `requireWorkspaceReviewAccessForRow(...)`
- `loadWorkspaceScopedRow(...)`
- `assertWorkspaceScopedRowMatchesWorkspace(...)`

These are the right seams for 073 state transition routes. A separate parallel permission system is not needed.

Current capture-gated route categories:

- one-off invites
  - `src/app/api/projects/[projectId]/invites/route.ts`
  - `src/app/api/projects/[projectId]/invites/[inviteId]/revoke/route.ts`
- recurring project participants and requests
  - `src/app/api/projects/[projectId]/profile-participants/route.ts`
  - `src/app/api/projects/[projectId]/profile-participants/[participantId]/consent-request/route.ts`
- project asset upload preparation/finalization
  - `src/app/api/projects/[projectId]/assets/route.ts` POST
  - `src/app/api/projects/[projectId]/assets/preflight/route.ts`
  - `src/app/api/projects/[projectId]/assets/batch/prepare/route.ts`
  - `src/app/api/projects/[projectId]/assets/batch/finalize/route.ts`
  - `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`

Current review-gated route categories:

- asset review and mutation routes under `assets/...`
  - blocked faces
  - hidden faces
  - manual faces
  - face assignment
  - preview faces
  - preview link candidates
  - preview links
  - whole-asset candidates
  - whole-asset links
- consent review and mutation routes under `consents/...`
  - consent asset links
  - matchable assets
  - manual link state
  - consent headshot review/replace
  - face review sessions
  - consent upgrade request creation

Current read-access routes that allow either capture or review on the selected workspace:

- `src/app/api/projects/[projectId]/assets/route.ts` GET
- `src/app/api/projects/[projectId]/matching-progress/route.ts`

Current project-level or tenant-level gaps:

- `resolveProjectPermissions(...)` is tenant-role only and does not take `projectId` or `workspaceId`
  - the project detail SSR page uses it for UI affordance gating
  - data reads are still workspace-filtered, so this is not a known data leak
  - it does mean some UI decisions are broader than strict workspace-specific capability
- `src/app/api/projects/[projectId]/default-template/route.ts`
  - project-level metadata route
  - checks tenant/template management capability, not workspace state
- `src/app/api/projects/[projectId]/workspaces/route.ts`
  - uses manage-workspaces permission, not any workflow state guard

### 3. Current workspace and project state boundary

Current workspace state:

- there is no workspace workflow/status column on `project_workspaces`
- only `workspace_kind` exists
- no handoff, validation, or review state exists in live schema or live code

Current project state:

- `projects.status` exists from `20260304210000_002_projects_invites_schema.sql`
- live allowed values are `active` and `archived`
- there is no `ready_to_finalize`
- there is no `finalized`
- there are no `finalized_at` or `finalized_by` columns

Important live behavior detail:

- `projects.status` is displayed in the project list and project detail UI
- there is no broad route-level lock layer that uses `projects.status`
- current capture/review/export routes generally do not enforce archived/finalized project locking

### 4. Current capture, review, export, and public-flow locking behavior

Current locking behavior is operational, not workflow-state driven.

Existing capture-phase locks:

- auth required
- tenant membership required
- workspace capture permission required
- record-level workspace match required where row-scoped helpers are used
- asset-specific status checks still apply
  - for example uploaded/archived checks on assets

Existing review-phase locks:

- auth required
- tenant membership required
- workspace review permission required
- row-scoped workspace validation on consent/asset-bound routes

Existing export behavior:

- `src/lib/project-export/response.ts`
- export is workspace-scoped
- photographers cannot export
- owner/admin/reviewer can export the selected workspace
- if multiple visible workspaces exist and none is selected, export returns `workspace_required`
- there is no finalization requirement for export today

Existing public token behavior:

- one-off public invite submit
  - `src/app/i/[token]/consent/route.ts`
  - `src/lib/invites/public-invite-context.ts`
  - `src/lib/consent/submit-consent.ts`
- recurring project consent submit
  - `src/app/rp/[token]/consent/route.ts`
  - `src/lib/recurring-consent/public-recurring-consent.ts`
- public invite headshot upload/finalize
  - `src/app/api/public/invites/[token]/headshot/route.ts`
  - `src/app/api/public/invites/[token]/headshot/[assetId]/finalize/route.ts`

These public flows are already workspace-bound by token-derived lookup, but they do not currently know anything about handoff, validation, or project finalization.

### 5. Current validation/read-model signals

Live signals already available for bounded validation:

- matching/materialization progress
  - `src/lib/matching/project-matching-progress.ts`
  - gives:
    - `totalImages`
    - `processedImages`
    - `isMatchingInProgress`
    - `hasDegradedMatchingState`
- asset review summary for photo assets
  - `src/lib/matching/asset-preview-linking.ts`
  - `getAssetReviewSummaries(...)`
  - `buildPendingAssetReviewSummary(...)`
  - statuses:
    - `pending`
    - `needs_review`
    - `blocked`
    - `resolved`
  - summary fields:
    - `unresolvedFaceCount`
    - `blockedFaceCount`
    - `firstNeedsReviewFaceId`
- current hidden face state
  - hidden faces are excluded from unresolved review counts
- current blocked face state
  - blocked faces become a distinct summary outcome
- exact face links
  - current links come from `asset_face_consent_links`
- whole-asset links
  - `src/lib/matching/whole-asset-linking.ts`
- fallback links for zero-face assets
  - represented in photo-linking/export flows
- effective consent-scope state
  - `src/lib/consent/project-consent-scope-state.ts`
  - statuses:
    - `granted`
    - `not_granted`
    - `revoked`
    - `not_collected`
- pending upgrade requests
  - `project_consent_upgrade_requests`
- pending recurring project consent requests
  - `project_participants_service` returns `missing | pending | signed | revoked`

Limits of current live read models:

- asset review summary is strong for photo face-review completeness
- it is not a full project/workspace workflow engine
- non-photo assets are treated as resolved in the current project asset list read model
  - that means current workspace-wide review summary does not prove that whole-asset linking for video assets is complete
- consent scope effective states are useful for UI and export context, but not a safe completeness gate by themselves
  - `not_granted` and `revoked` can be valid end states
- face review sessions track review work in detail, but they are session UX state, not the authoritative project/workspace completion model

### 6. Current project/workspace tests involved

Existing tests worth extending:

- `tests/feature-070-tenant-rbac-foundation.test.ts`
  - role boundaries
  - SQL permission helper expectations
- `tests/feature-055-project-participants-routes.test.ts`
  - capture permission enforcement on participant routes
- `tests/feature-067-consent-upgrade-route.test.ts`
  - review permission enforcement on upgrade route
- `tests/feature-043-simple-project-export-zip.test.ts`
  - reviewer export path
  - photographer export denial
  - workspace-scoped export expectations
- `tests/feature-055-project-participants-foundation.test.ts`
  - workspace-scoped recurring participant/request/consent behavior
- `tests/feature-021-project-matching-progress.test.ts`
  - matching progress and degraded-state behavior
- `tests/feature-071-one-off-current-surfaces.test.ts`
  - superseded current-surface filtering

Current test gaps:

- no workspace workflow state tests
- no project finalization tests
- no lock-after-handoff tests
- no lock-after-validation tests
- no finalized-project mutation lock tests
- no dedicated SSR workspace-selector tests
- no dedicated "all workspaces required" readiness tests

## Current permission boundary

The live permission model already matches the 073 principle that workflow must be driven by permissions plus workspace state, not by the label "photographer".

Important observations:

- capture permission is currently a capability outcome, not a separate workflow identity
- review permission is currently a capability outcome, not a separate workflow identity
- mixed-role behavior already exists for owner/admin because they have both capture and review permissions
- Feature 073 should preserve that pattern
- Feature 073 should not branch on `workspace_kind = photographer` for workflow decisions
- Feature 073 should branch on:
  - current workspace state
  - current project finalization state
  - `assertCanCaptureWorkspaceAction(...)`
  - `assertCanReviewWorkspaceAction(...)`
  - project-level management permissions where needed

## Current project/workspace state boundary

Live state boundary today:

- project has a coarse metadata status: `active | archived`
- workspace has no workflow state
- review readiness is currently inferred only from operational data on demand
- export is already workspace-scoped, but not finalization-scoped

That means 073 must add explicit human workflow state somewhere. It cannot be derived cleanly from current data alone because:

- `handed_off` is a user intent
- `needs_changes` is a user judgment
- `validated` is a user judgment
- `finalized` is a project-level decision that must create hard locks

## State machine options considered

### Option A - store simple state columns directly on `project_workspaces` and finalization columns on `projects`

Shape:

- `project_workspaces.state`
- project columns for readiness/finalization, or at least finalization

Pros:

- smallest implementation surface
- matches current repo style of text status plus check constraint
- easy to query and easy to lock against in routes
- easy to test

Cons:

- if project readiness is also stored, it can drift from workspace truth
- limited audit trail unless extra columns are added

Fit:

- good for workspace state
- weaker if it also stores `ready_to_finalize`

### Option B - separate transition/event tables for workspace and project states

Shape:

- `workspace_state_events`
- `project_state_events`
- possibly current-state projections

Pros:

- best audit trail
- easier future expansion for comments, approvals, notifications

Cons:

- much larger than the bounded first slice
- requires projection/current-state logic
- more retry/idempotency surface area
- more route and RLS complexity

Fit:

- too large for 073 first slice

### Option C - fully derive both workspace and project state from operational data

Shape:

- no workflow columns
- infer handoff/validated/finalized from invites, uploads, review rows, export state, and matching state

Pros:

- no new state writes

Cons:

- does not model human intent
- cannot represent `needs_changes`
- cannot represent explicit handoff
- cannot create a durable finalized lock
- breaks down immediately on the first real workflow exception

Fit:

- not viable

### Option D - hybrid: stored workspace state, derived project readiness, stored project finalization

Shape:

- stored workspace workflow state on `project_workspaces`
- derive `ready_to_finalize` from current workspace states and current blockers
- store finalization on `projects`

Pros:

- preserves explicit operator intent where it matters
- avoids stale `ready_to_finalize` denormalization
- keeps finalization as a durable lock state
- small enough for current repo style
- strong fit for route-level locking and testability

Cons:

- still only lightweight audit unless extra actor/timestamp columns are added
- readiness query must be designed carefully

Fit:

- best fit for the current repo

## Project finalization options considered

### Store `ready_to_finalize` and `finalized` on `projects`

Pros:

- easy to render in UI

Cons:

- `ready_to_finalize` can drift whenever a workspace changes state or a new workspace is added
- creates synchronization work with little benefit

### Derive readiness, store finalization

Pros:

- live truth always wins
- avoids stale readiness bugs
- finalization remains durable and lockable

Cons:

- readiness query must be assembled from workspace state plus blocker reads

### Reuse `projects.status` for `active | finalized | archived`

Pros:

- fewer columns

Cons:

- current live schema already uses `status` for `active | archived`
- `archived` and `finalized` are not obviously the same axis
- expands an existing status meaning instead of adding a clearly separate workflow boundary

Conclusion:

- keep readiness derived
- store finalization explicitly
- do not overload the existing `projects.status` column for 073

## Recommended bounded direction

### Recommended architecture

Use Option D:

- store workspace workflow state directly on `project_workspaces`
- derive project readiness from live workspace state plus live blockers
- store project finalization explicitly on `projects`

### Recommended workspace states

First-slice stored workspace states:

- `active`
- `handed_off`
- `validated`
- `needs_changes`

Recommendation on `in_review`:

- do not store `in_review` now
- if needed, treat it as a derived UI affordance when a workspace is `handed_off` and a reviewer is actively working
- reason:
  - it is not needed for bounded locking
  - it introduces lease/ownership questions the repo does not currently model
  - it is easy to add later without rewriting the core state machine

### Recommended project state model

Do not add a new stored project readiness state.

Use a hybrid read model:

- derived project readiness:
  - `active`
  - `ready_to_finalize`
- stored finalization:
  - `finalized_at`
  - `finalized_by`

UI/project state presentation can then be:

- `finalized` when `finalized_at` is not null
- else `ready_to_finalize` when the derived readiness query passes
- else `active`

This avoids writing a stale `ready_to_finalize` flag while still giving finalization a hard persisted lock.

### Recommended first-slice storage location

Store current workspace workflow state on `project_workspaces`.

Recommended additive columns:

- `workflow_state text not null default 'active'`
- `workflow_state_changed_at timestamptz not null default now()`
- `workflow_state_changed_by uuid null`
- `handed_off_at timestamptz null`
- `handed_off_by uuid null`
- `validated_at timestamptz null`
- `validated_by uuid null`
- `needs_changes_at timestamptz null`
- `needs_changes_by uuid null`
- `reopened_at timestamptz null`
- `reopened_by uuid null`

Recommended project finalization columns:

- `finalized_at timestamptz null`
- `finalized_by uuid null`

Recommendation on event tables:

- do not add `workspace_state_events` now
- the per-state actor/timestamp columns above are enough for first-slice observability
- full event history can be deferred until the product actually needs audit drill-down, discussion threads, or multi-step approvals

### Recommended valid transitions

Bounded state machine:

- `active -> handed_off`
  - actor: capture-capable user for that workspace
- `handed_off -> validated`
  - actor: review-capable user for that workspace
- `handed_off -> needs_changes`
  - actor: review-capable user for that workspace
- `needs_changes -> handed_off`
  - actor: capture-capable user for that workspace after corrections
- `validated -> needs_changes`
  - actor: review-capable user for that workspace
  - this acts as the bounded reopen path

Why not add a separate stored `reopened` state:

- it does not add durable meaning beyond `needs_changes`
- it complicates locking without improving UX
- `reopened_at` and `reopened_by` can still record that the transition happened

Admin/owner override recommendation:

- owner/admin should use the same allowed transitions as any review-capable or capture-capable actor
- do not add a second override-only transition matrix yet

### Recommended capture locking

Authenticated capture mutations should be allowed only when:

- project is not finalized
- workspace state is `active` or `needs_changes`

Authenticated capture mutations should be blocked when:

- workspace state is `handed_off`
- workspace state is `validated`
- project is finalized

That lock should cover:

- one-off invite creation
- one-off invite revoke
- recurring participant addition
- recurring project consent request creation
- asset preflight
- asset upload create/prepare/finalize
- any future capture-side authenticated mutation in the selected workspace

Recommendation on public token submit routes after handoff:

- keep already-issued public one-off submit active after handoff
- keep already-issued public recurring project consent submit active after handoff
- keep public invite headshot upload/finalize active after handoff

Reason:

- these flows are already token-scoped to the workspace
- turning them off at handoff would be a surprising break in already-issued capture work
- the safer bounded rule is to freeze new authenticated capture mutations, not to invalidate existing public completions

But validation/finalization must account for those still-open public flows. See open decisions below.

### Recommended review and validation locking

Review mutations should be allowed when:

- project is not finalized
- workspace state is `handed_off`, `needs_changes`, or `validated` only as allowed below

Recommendation by state:

- `handed_off`
  - allow review reads and review mutations
- `needs_changes`
  - allow review reads and review mutations
  - this lets reviewers verify fixes without an extra transition
- `validated`
  - keep review reads allowed
  - block review mutations other than the explicit reopen transition to `needs_changes`
- finalized project
  - keep read-only access and export
  - block review mutations across all workspaces

Review mutations that should be blocked after validation/finalization:

- exact face assignment changes
- manual faces
- hide/block/clear face state
- whole-asset link changes
- manual link state changes
- consent headshot replacement
- face review session mutation actions
- consent upgrade request creation

### Recommended validation criteria for the first slice

Do not try to fully derive workspace validation from operational data.

Use explicit reviewer validation, with bounded server-side preconditions.

Feasible server-side preconditions now:

- workspace matching progress is not active
  - `isMatchingInProgress = false`
- workspace matching is not degraded
  - `hasDegradedMatchingState = false`
- no photo asset in the workspace has review status `pending`
- no photo asset in the workspace has review status `needs_review`

Recommended interpretation of `blocked` assets:

- do not treat `blocked` as automatically invalid
- blocked faces are already an intentional review outcome
- a workspace can still be valid if the remaining reviewed photo assets are blocked rather than linked

Recommended things not to enforce yet as hard validation gates:

- whole-asset completeness for video assets
  - current workspace-wide read model does not prove this
- fallback-link completeness for every zero-face photo
  - current data can support reviewer judgment, but not a simple universal gate without extra query work and product decisions
- consent-scope effective statuses
  - `not_granted` and `revoked` are legitimate end states
- face review session state
  - this is session UX state, not the canonical workspace completeness model

Recommended likely blockers for validation or finalization, but still requiring product confirmation in plan:

- active one-off invites
- pending recurring project consent requests
- pending consent upgrade requests

Those are all queryable now, but the exact rule should be finalized in planning.

### Recommended project finalization rule

For Feature 073, treat every live workspace under the project as required.

Reason:

- there is no current optional workspace concept
- there is no current workspace archive/removal concept
- there is no current `is_required` flag

Recommended finalization preconditions:

- project is not already finalized
- every current workspace in `project_workspaces` is in `validated`
- derived blocker checks pass
  - at minimum no active/degraded matching
  - likely also no outstanding pending public/workflow items once product confirms exact rule

Recommended finalization lock:

- block all project capture mutations
- block all project review mutations
- block project workspace staffing changes
- block project default template changes
- keep export allowed
- keep project/workspace read-only views allowed

### Recommended minimal UI surface

Stay inside the existing project page.

Minimal additions:

- add a workspace workflow badge to each existing workspace chip in the header
- add selected-workspace actions near the existing workspace selector:
  - hand off workspace
  - mark needs changes
  - mark validated
  - reopen workspace
- add a project-level readiness/finalization area near the existing project status card and export action
- keep single-workspace projects visually simple by showing the selected workspace state/action row without introducing a second navigation layer

Do not add:

- a new project-level dashboard just for handoff/finalization
- umbrella-project terminology
- a second navigation tree for workspaces

If UI copy is added later, update:

- `messages/en.json`
- `messages/nl.json`

## Required workspace semantics

Live code currently has no optional workspace semantics.

Verified live facts:

- no `project_workspaces` archive column
- no `project_workspaces` delete/archive route in app code
- no `is_required` or `is_optional` column
- current workspace management route only lists and creates workspaces

Recommendation:

- Feature 073 should treat every current workspace row as required for finalization
- optional/skipped/archived workspace support should be deferred until there is an explicit product model for it

## Risks and tradeoffs

- Identity-driven workflow risk:
  - the live workspace model still has `workspace_kind = photographer`, but workflow must not be based on that label
  - use permission outcomes and workspace state, not photographer identity
- Public token over-locking risk:
  - blocking public submit on handoff would break already-issued consent collection unexpectedly
  - safer first slice: freeze authenticated capture, not token-scoped completion
- Capture mutation after review starts risk:
  - if handoff does not lock authenticated capture routes, review can race with new invites/uploads/participants
  - route-level locks need to be central and state-aware
- Validating before matching/materialization is complete risk:
  - current matching progress helper exposes both active and degraded states
  - validation should at least check those before allowing `validated`
- Finalizing while async worker/reconcile jobs are still pending risk:
  - matching progress covers a large part of this for photo assets
  - it does not represent every possible background repair path
  - readiness/finalization should stay conservative
- Overbuilding workflow risk:
  - event-sourced workflow, comments, approval chains, or reviewer ownership leases are too large for this slice
  - storing `in_review` now would pull the feature in that direction
- Workspace isolation risk:
  - new transition routes must reuse current workspace access helpers
  - photographers/capture users must never be able to transition or inspect other workspaces by guessing IDs
- UX terminology risk:
  - do not expose "umbrella project"
  - keep navigation project-first and use only the existing workspace affordance inside the project page

## Recommended test additions

Add a dedicated 073 test set and extend existing tests where the live seams already exist.

Recommended new coverage:

- valid workspace transitions
  - `active -> handed_off`
  - `handed_off -> validated`
  - `handed_off -> needs_changes`
  - `needs_changes -> handed_off`
  - `validated -> needs_changes`
- invalid transitions
  - capture user cannot validate
  - reviewer cannot hand off
  - no transition from finalized project
- permission failures
  - photographer cannot transition another workspace
  - reviewer cannot transition a workspace they cannot access
- workspace isolation
  - row-scoped transition routes must 404 or 403 correctly outside visible workspace scope
- post-handoff capture locks
  - invite create/revoke blocked
  - participant add blocked
  - recurring project request create blocked
  - asset preflight/prepare/finalize blocked
- post-validation lock
  - review mutation routes blocked except reopen
- finalization preconditions
  - fails until all workspaces validated
  - fails when readiness blockers are still present
- finalized-project lock
  - capture routes blocked
  - review mutation routes blocked
  - workspace staffing blocked
  - default template update blocked
  - export still allowed if that remains the chosen rule

Existing files worth extending directly:

- `tests/feature-070-tenant-rbac-foundation.test.ts`
- `tests/feature-055-project-participants-routes.test.ts`
- `tests/feature-067-consent-upgrade-route.test.ts`
- `tests/feature-043-simple-project-export-zip.test.ts`
- `tests/feature-021-project-matching-progress.test.ts`

## Open decisions for plan phase

These decisions should be made explicitly in the planning phase.

### Handoff lock strictness

- Should validation be blocked while active one-off invites still exist?
- Should validation be blocked while pending recurring project consent requests still exist?
- Should validation be blocked while pending consent upgrade requests still exist?
- Should finalization require all such pending public/workflow items to be cleared first?

### Reopen behavior

- Is `validated -> needs_changes` the only reopen path?
- Or does the product want a separate explicit `validated -> active` transition?
- Who can reopen:
  - reviewer only
  - reviewer and admin
  - reviewer, admin, and owner

### Exact validation criteria

- Is `blocked` an acceptable reviewed outcome for validation?
- Are non-photo assets purely reviewer judgment in this slice, or should there be a bounded whole-asset completeness check?
- Do pending upgrade requests block validation or only finalization?

### Project readiness/finalization model

- Confirm derived readiness plus stored finalization
- Confirm whether finalization should remain orthogonal to existing `projects.status = active | archived`
- Confirm whether finalized projects remain exportable

### `in_review`

- Confirm that `in_review` is deferred and not stored in 073
- If product wants a UI hint, confirm it is purely derived

### Minimal UI action placement

- Confirm exact placement of workspace state badges and transition actions in the existing project header
- Confirm whether the project list needs any finalization indicator now, or if project detail only is sufficient for 073

### Finalized-project interaction with export and later DAM/media work

- Confirm export remains allowed after finalization
- Confirm finalization is the last internal workflow state before future DAM/media publishing features
- Confirm finalization should not imply DAM release or external publishing

## Bottom line

The smallest safe direction for Feature 073 is:

- store workspace workflow state directly on `project_workspaces`
- do not store `in_review`
- derive project readiness from workspace states and live blockers
- store project finalization explicitly on `projects`
- treat all live workspaces as required
- lock authenticated capture after handoff and validation
- keep already-issued public token submits active after handoff
- lock review mutations after validation and after finalization
- use current matching progress plus photo asset review summaries as bounded validation guardrails
- defer full audit/event history, optional workspaces, approval chains, notifications, and DAM/media lifecycle work
