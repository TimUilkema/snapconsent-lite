# Feature 072 Plan - Umbrella project and photographer-scoped capture workspace foundation

## Inputs and ground truth

Required inputs read in order:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `docs/rpi/README.md`
5. `docs/rpi/072-project-staffing-photographer-scoped-capture-workspaces-and-bounded-project-workflow-permissions/research.md`

Primary synthesized source:

- `docs/rpi/072-project-staffing-photographer-scoped-capture-workspaces-and-bounded-project-workflow-permissions/research.md`

Targeted live verification performed for plan-critical conclusions:

- `src/lib/tenant/permissions.ts`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/app/api/projects/[projectId]/invites/route.ts`
- `src/app/api/projects/[projectId]/assets/route.ts`
- `src/app/api/projects/[projectId]/matching-progress/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/preview-faces/route.ts`
- `src/lib/project-export/response.ts`
- `tests/feature-043-simple-project-export-zip.test.ts`
- `tests/feature-070-tenant-rbac-foundation.test.ts`
- `supabase/migrations/20260304210000_002_projects_invites_schema.sql`
- `supabase/migrations/20260304211000_002_projects_invites_rls.sql`
- `supabase/migrations/20260305120000_004_assets_schema.sql`
- `supabase/migrations/20260305121000_004_assets_rls.sql`
- `supabase/migrations/20260320140000_019_face_materialization_pipeline.sql`
- `supabase/migrations/20260415110000_055_project_participants_mixed_consent_foundation.sql`
- `supabase/migrations/20260423090000_070_tenant_rbac_membership_invites_foundation.sql`

Ground-truth rule:

- `research.md` is the primary synthesis.
- Current live schema and code are authoritative wherever a planning detail needs verification.

## Verified current boundary

Current live boundary:

- `project` is still the only operational scope for one-off invites, one-off subjects, one-off consents, recurring project participants, recurring project consent requests, recurring project consents, assets, matching, review state, and export.
- Feature 070 added tenant RBAC, but project access is still role-based and tenant-wide, not project-assignment-based.
- Many older tables still use membership-only RLS.
- Capture and review routes are still keyed by `projectId`, and the protected project page still loads one shared project workspace.
- Current shared-project behavior mixes unrelated photographers' consents, assets, matching fanout, review queues, and export payloads.

Plan-critical implications:

- assignment-only on one shared project is not enough
- Feature 072 must establish a real subordinate operational scope below `project`
- that subordinate scope must be the unit that Feature 073 later hands off and reviews

## Options considered

### Option A - Assignment-only on one shared project

Pros:

- smallest schema change
- easy fit with current routes

Cons:

- does not isolate consent intake, matching, review, or export
- bakes the wrong unit into Feature 073

Decision:

- rejected

### Option B - Umbrella project plus photographer-scoped workspaces

Pros:

- matches the clarified product model
- keeps one project system in the UI
- creates the correct unit for later handoff and review

Cons:

- requires a targeted schema, RLS, helper, and route sweep

Decision:

- chosen

### Option C - Separate normal projects per photographer

Pros:

- strongest fit with the current live schema

Cons:

- breaks the intended one-project UX
- wrong steady-state product shape

Decision:

- rejected as the 072 architecture

### Option D - Tags or sessions inside one shared project

Pros:

- additive

Cons:

- does not create real isolation

Decision:

- rejected

## Recommendation

Feature 072 should introduce `workspace` as a first-class subordinate scope under `project`.

Reasoning:

- the organization still needs one umbrella project in the Projects area
- photographers need isolated operational workspaces inside that project
- the next feature needs a stable handoff unit, and that unit should be `workspace`, not the whole project
- the current project-wide boundary is the reason unrelated capture sets mix today

## Chosen architecture

Chosen shape:

- `project` remains the umbrella organization-facing container
- `project_workspace` becomes the photographer-scoped operational container
- all capture data and review-noise-producing data that must be isolated moves from project-only scope to project-plus-workspace scope
- the UI stays in the normal Projects area

First-slice modeling choice:

- use one workspace per assigned photographer
- represent assignment directly on the workspace row
- do not introduce a separate workspace-assignment join table in 072

Why this exact model:

- it matches the clarified product language directly
- it avoids unnecessary generalization in the first slice
- it still leaves room to add more flexible assignment later if needed

Feature 073 layering:

- 072 establishes structure and isolation
- 073 adds workspace handoff, reviewer completion, and umbrella-project close/finalize behavior

## Exact workspace model

### New table

Introduce `public.project_workspaces`:

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null references public.tenants(id) on delete cascade`
- `project_id uuid not null`
- `workspace_kind text not null check (workspace_kind in ('photographer', 'default'))`
- `photographer_user_id uuid null references auth.users(id) on delete restrict`
- `name text not null`
- `created_by uuid not null references auth.users(id) on delete restrict`
- `created_at timestamptz not null default now()`
- foreign key `(project_id, tenant_id)` references `public.projects(id, tenant_id)` on delete cascade
- unique `(id, tenant_id, project_id)`

### Constraints and indexes

- partial unique index on `(tenant_id, project_id, photographer_user_id)` where `photographer_user_id is not null`
- partial unique index on `(tenant_id, project_id)` where `workspace_kind = 'default'`
- check:
  - `workspace_kind = 'photographer'` requires `photographer_user_id is not null`
  - `workspace_kind = 'default'` requires `photographer_user_id is null`
- index on `(tenant_id, project_id, created_at desc)`
- index on `(tenant_id, photographer_user_id, created_at desc)` where `photographer_user_id is not null`

### Assignment representation

Assignment is represented by the workspace row itself:

- one photographer assignment == one `project_workspaces` row with `workspace_kind = 'photographer'`
- no separate assignment table in 072

### Naming

`project_workspaces.name` is required because the app has no stable app-side user profile table for display labels.

Plan choice:

- creation route seeds `name` from server-known membership/email context or an explicit server-validated label
- rename/edit UX is deferred unless it is needed to make minimal staffing usable

### Status

No lifecycle status field in 072.

Allowed structural distinction only:

- `workspace_kind`

Workflow status is deferred to Feature 073.

## Exact project vs workspace boundary

### Remains project-scoped in 072

- `projects`
- project metadata and project list entries
- project creation
- project default consent template
- project staffing overview
- project workspace roster
- lightweight project-level aggregate counts

### Becomes workspace-scoped in 072

One-off intake:

- `subject_invites`
- `subjects`
- `consents`

Recurring project participation:

- `project_profile_participants`
- project-scoped rows in `recurring_profile_consent_requests`
- project-scoped rows in `recurring_profile_consents`

Assets and links:

- `assets`
- `asset_consent_links`

Matching and matching observability:

- `face_match_jobs`
- `asset_consent_match_candidates`
- `asset_consent_match_results`
- `asset_face_materializations`
- `asset_face_materialization_faces`
- `asset_consent_face_compares`
- `asset_project_profile_face_compares`

Review and review-derived state:

- `face_review_sessions`
- `face_review_session_items`
- `project_face_assignees`
- `asset_assignee_links`
- `asset_consent_manual_photo_fallbacks`
- `asset_consent_manual_photo_fallback_suppressions`
- `asset_face_hidden_states`
- `asset_face_block_states`
- `project_consent_scope_signed_projections`
- `project_consent_upgrade_requests`

Read-model boundary:

- asset list, people filters, consent-scope filters, matching progress, and review summaries must all become workspace-scoped

Tables intentionally left without direct `workspace_id` in 072:

- `revoke_tokens`
- `consent_events`

Reason:

- they already hang off consent rows, which become workspace-scoped

## Exact access and permission model

### Project visibility

Owners/admins:

- can see all projects in the tenant
- can see all workspaces inside a project

Reviewers:

- remain tenant-wide in 072
- can see all projects in the tenant
- can inspect all workspaces inside a project

Photographers:

- can see only projects where they have at least one assigned workspace
- can access only their own workspace rows inside those projects

### Workspace visibility

Owners/admins:

- all workspaces in the project

Reviewers:

- all workspaces in the project

Photographers:

- only the workspace whose `photographer_user_id = auth.uid()`

### Photographer actions in own workspace

- open the project and land in their workspace
- create one-off invites
- revoke unused invites
- add recurring participants
- create recurring project consent requests
- upload/finalize assets
- see workspace-local capture read surfaces

### Reviewer/admin actions in a workspace

- open any workspace within an accessible project
- review workspace-local assets and queues
- run preview routes
- create review sessions
- assign faces and whole-asset links
- hide and block faces
- replace consent headshots
- initiate consent upgrades

### Staffing actions

Owners/admins only:

- create project workspaces
- assign photographers by creating one workspace per photographer

Implementation note:
The `project_workspaces` insert path must stay compatible with project creation. A new
project auto-creates its default workspace, so the database-side workspace-manage check
must key off owner/admin tenant membership directly rather than depending on an existing
workspace row or a project-visibility lookup that can fail inside the insert/trigger path.
Related guardrail: avoid self-referential select policies on `projects` and
`project_workspaces` for owner/admin visibility, because `insert ... returning` depends on
the new row being visible in the same statement.

Reviewer assignment decision:

- do not add reviewer assignment in 072
- keep reviewer visibility tenant-wide to keep the slice bounded

### Export permission

Chosen 072 rule:

- export becomes workspace-scoped
- export is limited to `owner`, `admin`, and `reviewer`
- photographers cannot export in 072

Reason:

- current photographer export is a legacy project-wide permission that conflicts with workspace isolation
- export is not a capture-only action

## Exact UI boundary

Chosen route shape:

- keep the existing project page route: `/projects/[projectId]`
- use `workspaceId` query param on that existing page

Why this is the bounded choice:

- the page already consumes `searchParams`
- it preserves one Projects system
- it avoids a second route tree for the first slice

### Project page behavior

No accessible workspaces:

- owner/admin/reviewer sees a project shell with staffing state and no workspace detail yet
- photographer should never reach this state; treat as not found

Exactly one accessible workspace:

- do not require manual selection
- load the workspace automatically
- make the page feel like the old normal single-project view

Multiple accessible workspaces:

- require `workspaceId` in the URL
- if missing, redirect to the same project page with the first accessible workspace selected
- render a workspace switcher/list inside the project page

Photographer UX:

- if they only have one accessible workspace, they land directly in it
- they do not see or select other photographers' workspaces

Review/admin UX:

- they open the umbrella project
- they can switch between workspaces inside the project
- richer aggregated dashboard behavior is deferred

### Minimal new UI surfaces

- workspace roster/switcher inside the project page
- owner/admin-only staffing panel for adding photographers to the project
- empty state for projects with no workspaces yet

## Exact schema, RLS, and helper plan

### Schema changes

Add `workspace_id uuid` to the workspace-scoped tables listed above.

Migration pattern for each table:

1. add nullable `workspace_id`
2. backfill values
3. add foreign key `(workspace_id, project_id, tenant_id)` to `project_workspaces`
4. rebuild relevant unique indexes to include `workspace_id`
5. make `workspace_id` non-null where required

Key uniqueness updates:

- `subjects`: unique `(tenant_id, project_id, workspace_id, email)`
- `assets`: unique `(tenant_id, project_id, workspace_id, storage_path)`
- `project_profile_participants`: unique `(tenant_id, project_id, workspace_id, recurring_profile_id)`
- project-kind unique indexes on recurring consent requests/consents must include `workspace_id`
- matching compare unique keys must include `workspace_id`

### SQL access helpers

Keep and redefine:

- `app.current_user_can_access_project(p_tenant_id, p_project_id)`
- `app.current_user_can_capture_project(p_tenant_id, p_project_id)`
- `app.current_user_can_review_project(p_tenant_id, p_project_id)`

Behavior update:

- owner/admin/reviewer stay tenant-role-based for project access
- photographer project access becomes true only if they have at least one workspace in the project

Add:

- `app.current_user_can_access_project_workspace(p_tenant_id, p_project_id, p_workspace_id)`
- `app.current_user_can_capture_project_workspace(p_tenant_id, p_project_id, p_workspace_id)`
- `app.current_user_can_review_project_workspace(p_tenant_id, p_project_id, p_workspace_id)`

Add public wrappers for the new workspace helpers as needed.

### TypeScript helper plan

In `src/lib/tenant/permissions.ts`:

- keep tenant-role derivation
- add project access resolution that knows about workspace visibility
- add workspace-scoped assertions for capture and review
- keep project-create assertion owner/admin-only

Suggested helpers:

- `resolveAccessibleProjectWorkspaces(...)`
- `resolveWorkspacePermissions(...)`
- `assertCanManageProjectWorkspacesAction(...)`
- `assertCanCaptureWorkspaceAction(...)`
- `assertCanReviewWorkspaceAction(...)`

### First-slice RLS sweep

Must update older membership-only policies on:

- `projects`
- `subject_invites`
- `subjects`
- `consents`
- `assets`
- `asset_consent_links`

Must ensure workspace-aware policies on newer project-local tables too:

- `project_profile_participants`
- project-kind `recurring_profile_consent_requests`
- project-kind `recurring_profile_consents`
- `project_face_assignees`
- `asset_assignee_links`
- `project_consent_scope_signed_projections`
- `project_consent_upgrade_requests`
- review-state tables listed above where authenticated access or policy checks exist

Policy intent:

- photographers cannot select or mutate rows from other photographers' workspaces
- owners/admins/reviewers can read across workspaces in accessible projects
- capture inserts/updates require workspace capture permission

## Exact route and service hardening plan

### New routes/services

Add workspace foundation routes:

- `GET /api/projects/[projectId]/workspaces`
- `POST /api/projects/[projectId]/workspaces`

Route rules:

- `GET` returns only workspaces visible to the caller
- `POST` is owner/admin-only and idempotently creates the photographer workspace

Add service:

- `src/lib/projects/project-workspaces-service.ts`

### Existing SSR and read loads

Harden:

- `src/app/(protected)/projects/page.tsx`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/app/api/projects/[projectId]/assets/route.ts`
- `src/app/api/projects/[projectId]/matching-progress/route.ts`
- `src/app/api/projects/[projectId]/export/route.ts`
- `src/lib/project-export/response.ts`
- `src/lib/projects/project-participants-service.ts`
- `src/lib/projects/project-asset-review-list.ts`

Plan:

- project list for photographers filters to projects with at least one accessible workspace
- project detail page resolves the selected workspace before loading workspace-scoped data
- read routes require `workspaceId` for multi-workspace projects and validate access

### Capture routes

Make workspace-scoped:

- `src/app/api/projects/[projectId]/invites/route.ts`
- `src/app/api/projects/[projectId]/invites/[inviteId]/revoke/route.ts`
- `src/app/api/projects/[projectId]/profile-participants/route.ts`
- `src/app/api/projects/[projectId]/profile-participants/[participantId]/consent-request/route.ts`
- `src/app/api/projects/[projectId]/assets/route.ts` `POST`
- `src/app/api/projects/[projectId]/assets/preflight/route.ts`
- `src/app/api/projects/[projectId]/assets/batch/prepare/route.ts`
- `src/app/api/projects/[projectId]/assets/batch/finalize/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`

Plan:

- collection routes accept explicit `workspaceId`
- detail routes load the target row and verify its `workspace_id`
- capture assertion uses workspace helper, not project-only helper

### Review routes

Make workspace-scoped:

- `src/app/api/projects/[projectId]/assets/[assetId]/preview-faces/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/preview-link-candidates/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/preview-links/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/whole-asset-candidates/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/whole-asset-links/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/assignment/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/manual-faces/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/blocked-faces/[assetFaceId]/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/hidden-faces/[assetFaceId]/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/review-sessions/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/upgrade-request/route.ts`

Plan:

- verify the target asset/consent belongs to the selected workspace
- review assertion uses workspace helper

### Public flows

Make workspace-aware:

- `src/lib/invites/public-invite-context.ts`
- `src/app/i/[token]/consent/route.ts`
- `src/lib/recurring-consent/public-recurring-consent.ts`

Plan:

- invite lookup returns `workspace_id` alongside `project_id`
- recurring project consent request lookup returns `workspace_id` for project-kind requests
- public submit paths persist workspace-scoped rows and enqueue workspace-scoped matching work

### Unauthorized behavior

Project or workspace not visible:

- return `404`

Visible scope but wrong action type:

- return `403`

Invalid `workspaceId` for selected project:

- return `404`

## Exact matching and read-model isolation plan

### Matching fanout

Minimum required change:

- matching jobs, headshot sources, recurring profile sources, and compare pairs must all filter by `workspace_id`

Helpers to update:

- `loadCurrentProjectConsentHeadshots`
- recurring project matching source loaders in `src/lib/matching/project-recurring-sources.ts`
- project matching progress loader
- job enqueue paths triggered by public consent submit, recurring consent submit, and asset upload/finalize

Plan choice:

- keep the current matching pipeline structure
- add workspace scope rather than redesign job types broadly

### Workspace-local read models

Asset list and filters:

- `assets` GET becomes workspace-scoped
- people filters load only current consents in the selected workspace
- consent-scope filter families load only from the selected workspace

Review summaries:

- asset review summaries only count the selected workspace
- linked overlays, assignments, hidden states, and blocked states only load from the selected workspace

Matching progress:

- progress endpoint reports for the selected workspace, not the whole project

Project shell aggregates:

- only lightweight project-level workspace counts are needed in 072
- no full cross-workspace aggregated review model

## Exact export stance

Chosen 072 stance:

- export is workspace-scoped
- caller must be owner/admin/reviewer
- route stays under the existing project route family
- selected workspace is determined by `workspaceId`
- if the caller has exactly one accessible workspace and none is supplied, the server may auto-resolve it
- if there are multiple accessible workspaces and none is supplied, return a validation error or redirect from the page before calling the API

Deferred:

- aggregated umbrella-project export
- cross-workspace reporting export

## Backfill strategy

### Migration strategy

1. create `project_workspaces`
2. insert one default workspace per existing project
3. add nullable `workspace_id` columns to all workspace-scoped tables
4. backfill each table's `workspace_id` from the project's default workspace
5. add foreign keys and rebuild unique indexes
6. make `workspace_id` non-null where required
7. update helpers and policies

### Backfill details

Default workspace rows:

- one per existing project
- `workspace_kind = 'default'`
- `name = 'Default workspace'`
- `photographer_user_id = null`
- `created_by = projects.created_by`

Safety:

- use `insert ... on conflict do nothing` patterns for default workspace backfill
- backfill row updates by `(tenant_id, project_id)` join
- only tighten constraints after backfill succeeds

Behavioral outcome:

- migrated existing projects continue to behave like single-workspace projects
- old project-local data remains intact but is now attached to the default workspace

## Minimal lifecycle decision

Feature 072 establishes structure only.

Decision:

- no handoff workflow
- no review-complete workflow
- no umbrella-project close/finalize workflow
- no workspace status field in 072

Allowed now:

- structural `workspace_kind`

Deferred to Feature 073:

- workspace handoff state
- reviewer/admin workspace completion state
- umbrella-project close/finalize state

## Security and reliability considerations

- tenant scoping remains mandatory on every query and helper
- workspace visibility must be enforced server-side and in RLS
- photographers must never be able to read or mutate rows from another workspace
- route handlers must not trust client-provided `tenant_id`
- `workspaceId` must always be validated against both `projectId` and current-user access
- workspace creation/assignment must be idempotent via unique constraints and upsert-style writes
- backfill must preserve existing single-project behavior
- public invite and recurring consent flows must carry workspace scope from token lookup through submit and matching enqueue
- route failures should preserve existing 401/403/404 patterns and avoid cross-tenant or cross-workspace leakage

## Edge cases

- single-workspace project should render like the old project detail with no manual workspace selection
- multi-workspace project should still be one project in the Projects list
- project with zero workspaces should show owner/admin/reviewer staffing state, not a broken dashboard
- photographers should only ever see their own workspace
- owners/admins should see all workspaces in the project
- reviewers remain tenant-wide in 072 and should be able to inspect all project workspaces
- existing projects must migrate to a default workspace without data loss
- legacy project export behavior must not survive accidentally once workspaces exist
- invite revoke/finalize/review detail routes must reject rows from a different workspace even if the project matches
- public invite and recurring consent flows must create workspace-scoped rows from the token's workspace

## Test plan

### Schema and migration tests

- migration creates `project_workspaces`
- default workspace backfill creates one row per existing project
- all required workspace-scoped tables end with non-null `workspace_id`
- new foreign keys and unique indexes behave correctly

### Permission and helper tests

- owner/admin/reviewer project visibility remains correct
- photographer only sees projects where they have a workspace
- photographer only sees their own workspace
- workspace capture and review helper assertions behave correctly

### RLS tests

- photographer cannot select `subject_invites`, `subjects`, `consents`, `assets`, or related workspace rows from another workspace
- reviewer/admin can read across workspaces in an accessible project

### Route tests

Capture:

- invite creation requires accessible workspace capture permission
- asset upload/finalize requires accessible workspace capture permission
- recurring project participant/request routes stay workspace-bounded

Review:

- preview/review routes require accessible workspace review permission
- detail routes reject cross-workspace row access

SSR and UI:

- single-workspace project auto-resolves
- multi-workspace project resolves `workspaceId` and renders switcher
- photographer cannot switch to another workspace

Matching/read-model isolation:

- two workspaces in one project do not mix matching inputs
- asset list, people filters, review summary, and matching progress only show selected workspace data

Export:

- owner/admin/reviewer can export the selected workspace
- photographer export is blocked
- export payload only contains selected workspace data

Public flows:

- one-off invite sign creates workspace-scoped subject/consent rows
- recurring project consent sign creates workspace-scoped project consent rows

## Implementation phases

### Phase 1 - Schema and backfill

- add `project_workspaces`
- add `workspace_id` columns
- backfill default workspaces
- rebuild keys and constraints

### Phase 2 - Helpers and RLS

- add SQL workspace access helpers
- update TypeScript permission helpers
- sweep old membership-only policies

### Phase 3 - Workspace staffing and access-aware routing

- add workspace list/create service and routes
- filter project list for photographers
- harden project SSR selection and access behavior

### Phase 4 - Capture and review route scoping

- add `workspaceId` handling to collection routes
- validate row ownership on detail routes
- update public invite and recurring consent flows

### Phase 5 - Read-model and export isolation

- workspace-scope asset list, people filters, review summaries, and matching progress
- switch export to workspace-scoped reviewer/admin/owner behavior

### Phase 6 - UI and tests

- add project-page workspace roster/switcher
- add minimal owner/admin staffing UI
- complete migration, permission, route, isolation, SSR, and export tests

## Scope boundaries

### Feature 072 implements now

- workspace entity and backfill foundation
- one workspace per assigned photographer
- workspace-aware project visibility for photographers
- workspace-aware capture and review route hardening
- workspace-scoped operational data and read-model isolation
- minimal project-page workspace navigation
- workspace-scoped export boundary

### Feature 073 should implement next

- workspace handoff
- reviewer/admin workspace review completion
- umbrella-project close/finalize behavior

### Later features

- aggregated umbrella review dashboard
- aggregated umbrella export/reporting
- DAM/media-library integration
- broader project lifecycle engine
- agency hierarchy
- workspace template overrides if later needed

## Concise implementation prompt

Implement Feature 072 as a bounded structural slice. Add `project_workspaces` under `projects`, using one workspace per assigned photographer in the first slice and one backfilled default workspace for existing projects. Add `workspace_id` to the minimum set of project-local capture, matching, review, and export tables needed for true isolation. Update SQL helpers, RLS, TypeScript permission helpers, SSR loads, and project route handlers so photographers only see their own workspaces while owner/admin/reviewer users inspect one workspace at a time through the existing `/projects/[projectId]` page using `workspaceId` query-param selection. Make asset lists, people filters, matching progress, review state, and export workspace-scoped. Restrict export to owner/admin/reviewer and keep handoff/closure state out of this feature.
