# Feature 073 Plan - Workspace handoff and project validation/finalization foundation

## Scope and contract

This document is the implementation plan for Feature 073 only.

Live code and live schema are authoritative. `docs/rpi/073-workspace-handoff-and-project-finalization-foundation/research.md` is the primary synthesized source for this plan, but any planning-critical conflict resolves in favor of the current repository state.

This plan is intentionally bounded:

- add workspace workflow state on top of Feature 072 workspaces
- add project finalization on top of Feature 070 RBAC and Feature 072 workspace isolation
- reuse existing tenant, workspace, capture, and review permission helpers
- keep workflow state explicit, server-authoritative, additive, and testable
- keep UI inside the existing project page and workspace selector pattern

This plan does not redesign project/workspace architecture, matching, review, consent, export, project navigation, DAM/media integration, notifications, comments, approval chains, or audit dashboards.

## Inputs and ground truth

### Inputs reviewed

Required planning inputs:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/SUMMARY.md`
- `docs/rpi/073-workspace-handoff-and-project-finalization-foundation/research.md`
- `UNCODEXIFY.MD`

Targeted live verification for the plan boundary:

- `supabase/migrations/20260304210000_002_projects_invites_schema.sql`
- `supabase/migrations/20260423120000_072_project_workspaces_foundation.sql`
- `supabase/migrations/20260423121000_072_project_workspace_access.sql`
- `src/app/(protected)/projects/page.tsx`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/app/api/projects/route.ts`
- `src/app/api/projects/[projectId]/workspaces/route.ts`
- `src/app/api/projects/[projectId]/default-template/route.ts`
- `src/lib/projects/project-workspaces-service.ts`
- `src/lib/projects/project-workspace-request.ts`
- `src/lib/templates/template-service.ts`
- `src/lib/tenant/permissions.ts`
- `messages/en.json`
- `messages/nl.json`

### Verified current boundary

Planning-critical live facts confirmed during targeted verification:

- `projects.status` only models `active | archived`.
- there is no existing project finalization column or route.
- there is no existing project archive route under `src/app/api/projects`.
- `project_workspaces` has no workflow column today.
- there is no workspace delete, archive, optional, skipped, or required model.
- the existing request-helper seam for workspace-scoped access is `src/lib/projects/project-workspace-request.ts`.
- the existing workspace-selection and workspace-roster seam is `src/lib/projects/project-workspaces-service.ts`.
- `src/app/api/projects/[projectId]/workspaces/route.ts` is the current project staffing route and should be finalization-locked.
- `src/app/api/projects/[projectId]/default-template/route.ts` plus `setProjectDefaultTemplate(...)` is the current project-default-template mutation seam and should be finalization-locked.
- the current project detail page already has the right minimal insertion surfaces: workspace chips, status cards, export affordance, matching progress, staffing form, participant panels, invite panels, and assets panels.

### Drift from research

No planning-critical drift was found relative to `research.md`.

## Recommendation

Use the research recommendation without broadening the architecture:

- store workspace workflow state directly on `project_workspaces`
- defer stored `in_review`
- derive project readiness from live workspace state plus live blocker checks
- store finalization explicitly on `projects`
- treat all current workspaces as required
- lock authenticated capture after handoff and validation
- keep already-issued public token submit flows active after handoff
- block public token writes after validation and after finalization
- lock review mutations after validation except explicit reopen-to-needs-changes
- lock capture and review mutations after project finalization
- keep export allowed after finalization

## Chosen architecture

### Why this architecture fits

Feature 073 should use stored workspace state plus derived project readiness plus stored project finalization.

Reasons:

- workspace handoff, needs-changes, and validation are explicit human workflow decisions and cannot be cleanly derived from operational data
- project readiness is a volatile computed condition and should not be denormalized into a stale stored flag
- project finalization is a durable lock and should be stored explicitly
- this matches the repo's current style: simple constrained columns, server-side service logic, existing permission helpers, and additive migrations
- this keeps the feature small enough to implement and test without introducing a lifecycle engine

### Why `in_review` is deferred

`in_review` is deferred in Feature 073 and, if desired for UI later, should be derived only.

Reasons:

- the first slice does not need a separate review-lease state to enforce locks
- storing `in_review` would force decisions about reviewer ownership, leases, abandonment, and conflict resolution that the repo does not currently model
- the states that matter for locking and finalization are already covered by `active`, `handed_off`, `needs_changes`, and `validated`

### Why workflow stays permission-driven, not identity-driven

Workflow decisions must depend on:

- workspace state
- project finalization state
- existing capture/review/manage capabilities

Workflow decisions must not depend on:

- `workspace_kind = 'photographer'`
- photographer identity labels
- assumptions that capture and review are always performed by different users

This preserves the current RBAC model where owner/admin users can capture and review, reviewers can review, photographers can capture, and mixed-role behavior comes from capability checks rather than hard-coded personas.

## Exact schema/model plan

### Migration scope

Create one new additive migration for Feature 073.

The migration should:

- alter `public.project_workspaces`
- alter `public.projects`
- avoid replacing or renaming existing columns
- avoid workflow event tables
- avoid changing Feature 072 access helpers or RLS policy shape unless a narrow additive select column update is required elsewhere in code

### `project_workspaces` additions

Add these columns to `public.project_workspaces`:

- `workflow_state text not null default 'active'`
- `workflow_state_changed_at timestamptz not null default now()`
- `workflow_state_changed_by uuid null references auth.users(id) on delete restrict`
- `handed_off_at timestamptz null`
- `handed_off_by uuid null references auth.users(id) on delete restrict`
- `validated_at timestamptz null`
- `validated_by uuid null references auth.users(id) on delete restrict`
- `needs_changes_at timestamptz null`
- `needs_changes_by uuid null references auth.users(id) on delete restrict`
- `reopened_at timestamptz null`
- `reopened_by uuid null references auth.users(id) on delete restrict`

Add a check constraint:

- `workflow_state in ('active', 'handed_off', 'needs_changes', 'validated')`

Add pair-consistency checks for observability columns:

- `((handed_off_at is null) = (handed_off_by is null))`
- `((validated_at is null) = (validated_by is null))`
- `((needs_changes_at is null) = (needs_changes_by is null))`
- `((reopened_at is null) = (reopened_by is null))`

Do not add a separate stored `reopened` state. Reopen is modeled as a transition that lands in `needs_changes`, with `reopened_at` and `reopened_by` recording that it happened.

### `projects` additions

Add these columns to `public.projects`:

- `finalized_at timestamptz null`
- `finalized_by uuid null references auth.users(id) on delete restrict`

Add a pair-consistency check:

- `((finalized_at is null) = (finalized_by is null))`

### Project status interaction

Do not overload `projects.status`.

Keep:

- `projects.status = active | archived`

Add separately:

- `projects.finalized_at`
- `projects.finalized_by`

This keeps archive state and finalization state on separate axes.

### Index plan

No new index is required for Feature 073.

Reasons:

- workspace counts per project are expected to stay small
- transition routes update by primary key plus tenant/project filters
- readiness derives from per-project workspace reads and bounded blocker queries, not large tenant-wide scans

If a later implementation pass shows a concrete performance issue, a narrow index such as `(project_id, workflow_state)` can be added then. It is not part of the first slice plan.

### SQL helper function plan

Do not add new SQL helper functions for workflow or finalization in Feature 073.

Use TypeScript service logic for:

- workflow lock checks
- transition application
- readiness derivation
- finalization checks

Reasons:

- existing RLS and SQL helpers already solve access control
- the new logic is workflow authorization, not row-visibility authorization
- keeping the workflow layer in a small TypeScript service reduces migration scope and avoids duplicating state logic in SQL and TS

### Type/model updates

Update the TypeScript types that already expose workspace/project summaries.

Expected updates:

- extend `AccessibleProjectWorkspace` in `src/lib/tenant/permissions.ts` to include workflow columns
- extend the `resolveAccessibleProjectWorkspaces(...)` select list to include the new workflow fields
- add workflow and finalization summary types in a new or adjacent project workflow service

## Exact workspace transition model

### Stored workspace states

Feature 073 stores exactly these workspace states:

- `active`
- `handed_off`
- `needs_changes`
- `validated`

### Route-level actions

Expose four explicit transition actions:

- handoff
- validate
- needs changes
- reopen

Recommended route shapes:

- `POST /api/projects/[projectId]/workspaces/[workspaceId]/handoff`
- `POST /api/projects/[projectId]/workspaces/[workspaceId]/validate`
- `POST /api/projects/[projectId]/workspaces/[workspaceId]/needs-changes`
- `POST /api/projects/[projectId]/workspaces/[workspaceId]/reopen`

These stay under the existing project/workspace route family and keep each action explicit.

### Allowed transitions

Allowed transitions in Feature 073:

- `active -> handed_off`
- `handed_off -> validated`
- `handed_off -> needs_changes`
- `needs_changes -> handed_off`
- `validated -> needs_changes`

### Transition-to-route mapping

Route behavior:

- `handoff` allows `active -> handed_off`
- `handoff` also allows `needs_changes -> handed_off`
- `validate` allows `handed_off -> validated`
- `needs-changes` allows `handed_off -> needs_changes`
- `reopen` allows `validated -> needs_changes`

This keeps the UI language clear without introducing more stored states.

### Required capability per transition

Capability rules:

- `handoff` requires existing workspace capture permission
- `validate` requires existing workspace review permission
- `needs-changes` requires existing workspace review permission
- `reopen` requires existing workspace review permission

Owner/admin users get these abilities through the current Feature 070 capability model. No separate override matrix is added.

### Invalid transitions

All other transitions are invalid in Feature 073.

Examples:

- `active -> validated`
- `active -> needs_changes`
- `handed_off -> handed_off` as a first attempt from a different client state
- `validated -> handed_off`
- any transition on a finalized project
- any transition on an archived project

### Idempotency behavior

Transition routes should be idempotent for same-action retries.

Behavior:

- if the route is retried and the workspace is already in the target state produced by that same route, return `200` with the current state and `changed: false`
- if the route is retried but the workspace moved to a different state, return `409`
- if the first write succeeded but the client missed the response, the second identical request should safely read back the already-applied state and return success

### Race handling

Transition writes should use compare-and-swap style guards.

Implementation approach:

- load the workspace row with tenant, project, and workspace scope
- check project archive/finalized state before transition
- compute the expected allowed current states for the route
- perform an `update ... where id = ? and tenant_id = ? and project_id = ? and workflow_state in (...)`
- if zero rows update, reload the row and decide whether the route became an idempotent success or a real conflict

This avoids silent lost updates when two users transition the same workspace at the same time.

## Exact project finalization/readiness model

### Derived project states

Project state is presented as:

- derived `active`
- derived `ready_to_finalize`
- stored `finalized`

Derivation rule:

- if `projects.finalized_at is not null`, the project is `finalized`
- else if all current workspaces are validated and all finalization blocker checks pass, the project is `ready_to_finalize`
- else the project is `active`

### Stored finalization model

Finalization is represented by:

- `projects.finalized_at`
- `projects.finalized_by`

Finalization is not reversible in Feature 073.

Do not add:

- `projects.ready_to_finalize`
- `projects.status = finalized`

### Finalization route

Recommended route:

- `POST /api/projects/[projectId]/finalize`

### Finalization actor rule

Finalization requires existing review capability for the project.

That means:

- owner can finalize
- admin can finalize
- reviewer can finalize
- photographer cannot finalize

No separate finalization-only permission is introduced.

### Finalization preconditions

A project can be finalized only when:

- the user has project review capability
- the project exists in the active tenant
- the project is not archived
- the project is not already finalized
- every current workspace under the project is in `validated`
- every workspace still passes the first-slice blocker rules at finalization time

### Required workspace rule

All current workspace rows count as required for Feature 073.

Reason:

- there is no optional workspace model
- there is no skipped workspace model
- there is no workspace archive/removal model

### Archived interaction

Archived projects should be treated as workflow read-only.

Feature 073 behavior:

- archived projects cannot be handed off
- archived projects cannot be marked needs changes
- archived projects cannot be validated
- archived projects cannot be finalized
- archived projects remain readable
- export remains allowed unless a later archive feature defines otherwise

Feature 073 does not add or change project archive routes. It only ensures new workflow mutations do not operate on archived projects.

### Finalized interaction with archive

Feature 073 should allow the data model to represent a finalized project that is later archived.

Feature 073 does not implement archive actions, but it should not make that future combination impossible.

### Finalization lock surface

After finalization:

- block authenticated capture mutations
- block authenticated review mutations
- block workspace staffing creation changes
- block project default-template changes
- block public token write flows
- keep protected reads allowed
- keep export allowed

## Exact validation/blocker rules

### Workspace validation blocker rules

Validation is explicit reviewer intent, but it is gated by bounded server-side blockers.

A workspace may be validated only when all of the following are true:

- matching is not in progress for the workspace
- matching is not degraded for the workspace
- no photo asset in the workspace has review status `pending`
- no photo asset in the workspace has review status `needs_review`
- no one-off invite in the workspace remains `active`
- no workspace-scoped recurring project consent request remains `pending`
- no workspace-scoped one-off consent upgrade request remains `pending`

### Why pending invite/request blockers are included

These are included because already-issued public token flows remain active after handoff. If validation ignored them, new consent or headshot data could still enter the workspace after review marked it validated.

Blocking validation on open public/request channels keeps the validated state stable without cancelling already-issued links at handoff time.

### Blocked asset rule

`blocked` photo assets are acceptable reviewed outcomes and do not block validation by themselves.

Reason:

- blocked faces are an intentional review result
- the first slice should distinguish unresolved work from intentionally blocked outcomes

### Consent-scope rule

Consent-scope effective states such as `not_granted`, `not_collected`, or `revoked` do not automatically block validation or finalization.

Reason:

- those can be legitimate end states
- Feature 073 should not redesign consent policy semantics

### Video and whole-asset rule

Feature 073 does not add a hard validation gate for video whole-asset completeness.

Reason:

- the current workspace-wide review summary is strong for photo review completeness
- it does not provide a robust server-side proof of video whole-asset completeness

Video remains reviewer judgment in this slice.

### Public headshot upload rule

Feature 073 does not add a separate hard blocker for in-progress public headshot uploads beyond the existing invite/request blocker rules and the post-validation/public-write lock.

Reason:

- current live read models do not expose a narrow, authoritative workspace-level "pending public headshot finalize" readiness signal
- introducing that gate would broaden the feature beyond the current bounded layer

### Finalization blocker rules

Finalization rechecks the same blocker rules across every workspace in the project.

This means finalization is blocked when any workspace still has:

- matching in progress
- degraded matching state
- photo review status `pending`
- photo review status `needs_review`
- active one-off invites
- pending recurring project consent requests
- pending one-off consent upgrade requests

### Read models to reuse

Implement blocker reads by reusing live code where possible:

- `getProjectMatchingProgress(...)`
- `getAssetReviewSummaries(...)`
- direct workspace-scoped reads on `subject_invites`
- direct workspace-scoped reads on `recurring_profile_consent_requests`
- direct workspace-scoped reads on `project_consent_upgrade_requests`

Do not invent a second review-completeness model.

## Exact capture/review/public-flow locking plan

### Authenticated capture lock rules

Authenticated capture mutations are allowed only when:

- `projects.status = active`
- `projects.finalized_at is null`
- `project_workspaces.workflow_state in ('active', 'needs_changes')`

Authenticated capture mutations are blocked when:

- the project is archived
- the project is finalized
- the workspace is `handed_off`
- the workspace is `validated`

### Capture routes to lock

Lock these existing authenticated capture mutations through a central helper layer:

- `src/app/api/projects/[projectId]/invites/route.ts`
- `src/app/api/projects/[projectId]/invites/[inviteId]/revoke/route.ts`
- `src/app/api/projects/[projectId]/profile-participants/route.ts`
- `src/app/api/projects/[projectId]/profile-participants/[participantId]/consent-request/route.ts`
- `src/app/api/projects/[projectId]/assets/route.ts` POST
- `src/app/api/projects/[projectId]/assets/preflight/route.ts`
- `src/app/api/projects/[projectId]/assets/batch/prepare/route.ts`
- `src/app/api/projects/[projectId]/assets/batch/finalize/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`

### `needs_changes` capture rule

`needs_changes` reopens authenticated capture mutation routes. That is the explicit workspace state for correction work.

### Public token flow rule after handoff

After handoff, already-issued public token write flows remain allowed:

- one-off public consent submit
- recurring project consent submit
- public invite headshot upload
- public invite headshot finalize

### Public token flow rule after validation

After validation, public token write flows are blocked.

Reason:

- validated is intended to be read-only except explicit reopen-to-needs-changes
- keeping public writes open after validation would undermine the validated lock

### Public token flow rule after finalization

After finalization, public token write flows are blocked.

### Public token status code

Return `409` for blocked public writes caused by workspace/project closure.

Recommended error codes:

- `workspace_not_accepting_submissions`
- `project_finalized`

### Review mutation lock rules

Authenticated review mutations are allowed only when:

- `projects.status = active`
- `projects.finalized_at is null`
- `project_workspaces.workflow_state in ('handed_off', 'needs_changes')`

Exception:

- `reopen` remains allowed from `validated`

### Review state behavior

Review behavior by workspace state:

- `handed_off`: review reads and review mutations allowed
- `needs_changes`: review reads and review mutations allowed
- `validated`: review reads allowed, review mutations blocked, explicit reopen allowed
- finalized project: review reads allowed, review mutations blocked

### Review routes to lock

Lock these existing review mutation routes through a central helper layer:

- face assignment mutation routes
- manual-face creation routes
- hidden-face mutation routes
- blocked-face mutation routes
- preview-link mutation routes
- whole-asset-link mutation routes
- consent asset-link mutation routes
- consent headshot replacement route
- review-session mutation routes
- consent upgrade request creation route

This covers the current route families under:

- `src/app/api/projects/[projectId]/assets/...`
- `src/app/api/projects/[projectId]/consents/...`

### Review read rule

Do not block current review read routes after validation or finalization.

This includes existing GET routes used for:

- preview faces
- preview candidates
- preview links
- matchable assets
- review-session reads
- project detail SSR
- export

### Workspace staffing and project-default-template locks

Project-level mutations that are not capture/review but still change project operational shape should be locked after finalization and on archived projects.

Feature 073 should block:

- workspace staffing creation via `src/app/api/projects/[projectId]/workspaces/route.ts` POST
- project default-template updates via `src/app/api/projects/[projectId]/default-template/route.ts`

Feature 073 should not change read access to these current surfaces.

## Exact API plan

### Workspace transition routes

Add these route handlers:

- `src/app/api/projects/[projectId]/workspaces/[workspaceId]/handoff/route.ts`
- `src/app/api/projects/[projectId]/workspaces/[workspaceId]/validate/route.ts`
- `src/app/api/projects/[projectId]/workspaces/[workspaceId]/needs-changes/route.ts`
- `src/app/api/projects/[projectId]/workspaces/[workspaceId]/reopen/route.ts`

Request body:

- no body required for the first slice

Response shape:

- `200 { workspace, changed, projectWorkflow }`

Where:

- `workspace` contains the updated workflow fields for the selected workspace
- `changed` is `true` when the route changed state and `false` for an idempotent retry
- `projectWorkflow` contains the updated derived project summary needed by the UI

### Project finalization route

Add:

- `src/app/api/projects/[projectId]/finalize/route.ts`

Request body:

- no body required for the first slice

Response shape:

- `200 { projectWorkflow, changed }`

Behavior:

- first successful finalization returns `changed: true`
- idempotent retry on an already-finalized project returns `changed: false`

### Status codes

Use these status rules:

- `401` when unauthenticated
- `404` when project/workspace scope should not be revealed
- `403` when the project/workspace is visible but the user lacks the needed action capability
- `409` for invalid state transitions, closed-workspace locks, readiness blockers, archived-project locks, finalization conflicts, and closure of public token write flows

### Tenant and workspace authority

All new routes must:

- derive tenant server-side
- validate tenant membership server-side
- validate project scope server-side
- validate workspace visibility server-side
- never accept `tenant_id` from the client
- reuse existing workspace access helpers instead of trusting client-selected `workspaceId`

## Exact service/helper plan

### New workflow service

Add a small workflow-specific service:

- `src/lib/projects/project-workflow-service.ts`

Responsibilities:

- load project finalization columns
- load workspace workflow state
- derive workspace blocker summary
- derive project readiness/finalization summary
- apply workspace transitions
- finalize the project
- expose project-level mutation lock checks for archived/finalized projects

Suggested functions:

- `getWorkspaceWorkflowSummary(...)`
- `getProjectWorkflowSummary(...)`
- `assertProjectWorkflowMutable(...)`
- `assertWorkspaceCaptureMutationAllowed(...)`
- `assertWorkspaceReviewMutationAllowed(...)`
- `applyWorkspaceWorkflowTransition(...)`
- `finalizeProject(...)`

### Extend request helpers, do not overload access helpers

Do not silently change the behavior of existing access helpers in a way that would start blocking read routes.

Instead:

- keep `requireWorkspaceCaptureAccessForRequest(...)` and `requireWorkspaceReviewAccessForRequest(...)` as permission-and-selection helpers
- add new mutation helpers in `src/lib/projects/project-workspace-request.ts`

Recommended additions:

- `requireWorkspaceCaptureMutationAccessForRequest(...)`
- `requireWorkspaceReviewMutationAccessForRequest(...)`
- `requireWorkspaceCaptureMutationAccessForRow(...)`
- `requireWorkspaceReviewMutationAccessForRow(...)`

These new helpers should:

- reuse the existing access helper
- call the workflow service lock checks
- return the same workspace/permission shape plus workflow summary when needed

### Extend workspace service

Extend `src/lib/projects/project-workspaces-service.ts` to support the project page and workspace routes without scattering select lists.

Planned additions:

- return workflow fields in workspace roster helpers
- add any small normalization helpers needed for workflow badge display

Do not move transition logic into the general workspace-roster service. Keep state-machine logic in the new workflow service.

### Extend permission type surface

Extend `src/lib/tenant/permissions.ts` only as needed to keep workspace summaries aligned with the new columns.

Do not add a parallel permission model.

### Project-level mutation lock hook points

Use the workflow service from:

- `src/app/api/projects/[projectId]/workspaces/route.ts` POST
- `src/lib/templates/template-service.ts` inside `setProjectDefaultTemplate(...)`

This avoids ad hoc archived/finalized checks in each route.

## Exact UI and i18n plan

### UI surface

Keep all UI changes inside the existing project page.

Add:

- workspace workflow badges on the existing workspace chips
- selected-workspace workflow action buttons near the current workspace header area
- a project workflow card or status row near the existing project status card and export affordance
- read-only messaging when a workspace or project is locked

Do not add:

- a new route tree
- a new dashboard
- a new project-vs-workspace navigation model
- any user-facing "umbrella project" terminology

### Single-workspace rule

Single-workspace projects should stay visually simple.

Behavior:

- show the workspace badge and the relevant selected-workspace actions inline
- do not force a separate chooser flow

### Multi-workspace rule

Multi-workspace projects should stay inside the current project page.

Behavior:

- keep the existing workspace chip selector
- attach a compact workflow badge to each chip
- show action buttons only for the selected workspace

### Suggested UI actions by state

Selected workspace actions:

- `active`: show `Hand off workspace` to capture-capable users
- `handed_off`: show `Mark validated` and `Needs changes` to review-capable users
- `needs_changes`: show `Hand off workspace` to capture-capable users, and keep review read/mutation surfaces available
- `validated`: show `Reopen workspace` to review-capable users

Project-level action:

- show `Finalize project` only when the current user can review and the derived project state is `ready_to_finalize`

### Lock messaging

Add compact messaging in the existing project page when:

- authenticated capture actions are blocked because the workspace is handed off
- authenticated capture actions are blocked because the workspace is validated
- review mutations are blocked because the workspace is validated
- all mutations are blocked because the project is finalized
- the project is archived and workflow mutations are unavailable

### UI style constraints

Follow the current project page language and `UNCODEXIFY.MD`:

- no new hero treatment
- no new navigation structure
- no decorative workflow dashboard
- no oversized badges or ornamental copy
- use the existing card and chip structure with small state affordances

### i18n additions

Add new user-facing keys in both:

- `messages/en.json`
- `messages/nl.json`

Recommended namespace:

- `projects.detail.workflow`

Suggested keys:

- workspace state labels
- project state labels
- action labels for handoff, validate, needs changes, reopen, finalize
- lock/read-only helper text
- blocker summary labels for not-ready states
- finalization success/error surface copy if existing UI patterns show inline mutation results

If the projects list later shows finalization state, add a minimal list-surface status label there too. Feature 073 does not require a projects-list redesign.

## Security and reliability considerations

### Security rules

Feature 073 must preserve these invariants:

- tenant scoping stays server-derived
- `tenant_id` is never accepted from the client
- workspace access remains mandatory for workspace routes
- photographers and other capture-only users must not gain visibility into other workspaces through transition routes
- review-only users must not gain capture transition ability
- mixed-role users must be able to perform both flows when existing permissions allow
- public token flows remain token-scoped and must not broaden visibility

### Server-authoritative state transitions

All transitions and finalization must be server-authoritative.

The client may:

- show the current state
- request a transition

The server must:

- load the current workspace/project state
- verify tenant and workspace scope
- verify capture/review capability
- verify archived/finalized locks
- verify transition validity
- apply the transition atomically enough to reject stale current-state writes

### Retry and idempotency

Transition and finalization routes should be safe to retry without requiring a separate idempotency-key table.

Use:

- explicit target-state routes
- compare-and-swap current-state guards
- read-after-write fallback when zero rows update

This is sufficient for the first slice because each route is a single state transition with a stable target.

### Race handling

Handle these races explicitly:

- two users validating or reopening at the same time
- capture finalize arriving while another user hands off the workspace
- finalization racing with a workspace transition
- validation racing with matching-progress changes
- validation racing with a public token submit that still has an active invite/request

Rules:

- transition/finalization writes use current-state filters
- readiness and blocker checks happen immediately before transition/finalization writes
- lock helpers re-read the current project/workspace state at request time instead of trusting page-loaded state

## Edge cases

### Project/workspace shape

- one-workspace project: auto-selection remains, workflow actions are shown inline
- multi-workspace project: existing chip selection remains, each workspace gets a badge, transitions operate only on the selected workspace
- zero visible workspaces: no new behavior; existing selection rules remain, transition actions stay unavailable

### Transition cases

- workspace already handed off: repeated handoff returns idempotent success only when the route target already matches; otherwise invalid transitions return `409`
- workspace already validated: repeated validate returns idempotent success; other mutation routes are blocked until reopen
- workspace marked needs changes after validation: supported through `reopen`
- workspace marked needs changes from handed off: supported through `needs-changes`

### Project closure cases

- project already finalized: finalization returns idempotent success, other workflow mutations return `409`
- archived project: all new workflow mutations return `409`
- finalized project later archived: allowed by data shape, but not implemented by Feature 073

### Public token cases

- public submit after handoff: allowed
- public submit after validation: blocked
- public submit after finalization: blocked

### Matching and review cases

- async matching still running: validation and finalization blocked
- degraded matching state: validation and finalization blocked
- blocked-only review outcomes: allowed
- video assets with no exact-face materialization: do not auto-block validation in Feature 073

### Consent/request cases

- pending upgrade requests: block validation and finalization
- pending recurring project consent requests: block validation and finalization
- active one-off invites: block validation and finalization

## Test plan

### New test coverage

Add Feature 073-focused tests, preferably in new files:

- `tests/feature-073-workspace-workflow-schema.test.ts`
- `tests/feature-073-workspace-workflow-routes.test.ts`
- `tests/feature-073-project-finalization.test.ts`
- `tests/feature-073-project-workflow-ui.test.tsx`

### Schema tests

Add schema coverage for:

- new `project_workspaces` columns
- new `projects` columns
- workspace workflow-state check constraint
- actor/timestamp pair-consistency checks

### Workspace transition tests

Add tests for:

- `active -> handed_off`
- `needs_changes -> handed_off`
- `handed_off -> validated`
- `handed_off -> needs_changes`
- `validated -> needs_changes`

### Invalid transition tests

Add tests for:

- reviewer cannot hand off
- capture-only user cannot validate
- invalid current-state transitions return `409`
- transitions on finalized project return `409`
- transitions on archived project return `409`

### Permission and isolation tests

Extend current permission coverage to prove:

- photographers cannot transition another workspace
- inaccessible workspace IDs stay `404`
- review-only users cannot perform capture mutation transitions
- capture-only users cannot perform review mutation transitions

### Capture lock tests

Add or extend tests so that after `handed_off` and `validated`:

- invite create is blocked
- invite revoke is blocked
- recurring participant add is blocked
- recurring project consent request create is blocked
- asset preflight is blocked
- asset prepare/finalize is blocked

### Review lock tests

Add or extend tests so that after `validated` and after project finalization:

- face assignment mutation is blocked
- manual face creation is blocked
- hidden/blocked-face mutations are blocked
- whole-asset-link mutations are blocked
- consent headshot replacement is blocked
- consent upgrade request creation is blocked
- review-session mutation actions are blocked

### Finalization tests

Add tests for:

- project not ready when any workspace is not validated
- project not ready when blocker checks fail
- finalization succeeds when all workspaces are validated and blockers are clear
- repeated finalization is idempotent
- finalized project blocks capture/review/staffing/default-template mutations
- export remains allowed after finalization

### Public token tests

Add tests for:

- public one-off submit still works after handoff
- public recurring project consent submit still works after handoff
- public invite headshot upload/finalize still works after handoff
- public token writes are blocked after validation
- public token writes are blocked after finalization

### UI/server-render tests

Add practical rendering tests for:

- workspace badges on the project page
- selected-workspace workflow actions by state and permission
- finalize action visibility only when ready and permitted
- read-only messaging after validation/finalization

### Regression extensions

Extend existing tests where the seams already exist:

- `tests/feature-070-tenant-rbac-foundation.test.ts`
- `tests/feature-043-simple-project-export-zip.test.ts`
- `tests/feature-055-project-participants-routes.test.ts`
- `tests/feature-067-consent-upgrade-route.test.ts`

## Implementation phases

1. Schema and type additions.
   Add the migration, extend workspace/project types, and thread the new columns through workspace roster reads.

2. Workflow service and lock helpers.
   Add the workflow service, readiness/blocker derivation, project mutability checks, and the new mutation-specific workspace request helpers.

3. Transition and finalization routes.
   Add workspace transition routes and the project finalization route, with compare-and-swap transition logic and idempotent retry behavior.

4. Lock enforcement in existing mutations.
   Wire the new mutation helpers into capture routes, review mutation routes, staffing, default-template updates, and public token write flows.

5. Minimal UI and i18n.
   Add workflow badges, selected-workspace actions, readiness/finalization status, read-only messaging, and EN/NL message keys.

6. Tests and verification.
   Add the new Feature 073 tests, extend existing regression tests, run targeted tests after each phase, and finish with a clean end-to-end verification pass.

## Scope boundaries

### Implements now

- stored workspace workflow state on `project_workspaces`
- explicit workspace handoff, validation, needs-changes, and reopen actions
- derived project readiness
- stored project finalization on `projects`
- central workflow lock helpers for capture, review, staffing, default-template, and public token write flows
- minimal project-page workflow UI and i18n
- tests for transitions, locks, finalization, and regressions

### Deferred

- DAM/media integration
- notifications, email, or push tied to workflow transitions
- comments or discussion systems
- workflow event history tables
- audit dashboards
- optional or skipped workspaces
- workspace archive/removal model
- reviewer ownership or `in_review` leases
- approval chains
- aggregated project dashboard/export redesign
- agency/client hierarchy

## Concise implementation prompt

Implement Feature 073 exactly as this plan describes. Follow the phases in order, keep the architecture bounded, reuse the existing Feature 070 and 072 permission/workspace helpers, and do not introduce a parallel permission system or event-history tables. After each phase, run the most relevant tests before moving on. If live code forces any deviation from this plan, stop, document the reason, update the plan, and only then continue.
