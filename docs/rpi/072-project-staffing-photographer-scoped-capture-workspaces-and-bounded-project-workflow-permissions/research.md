# Feature 072 Research - Project staffing, photographer-scoped capture workspaces, and bounded project workflow permissions

## Inputs reviewed

This document is a revision of the earlier Feature 072 research pass. The existing `research.md` was treated as the base document and was not rebuilt from scratch.

Required inputs re-read for this revision in order:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `docs/rpi/README.md`
5. `docs/rpi/072-project-staffing-photographer-scoped-capture-workspaces-and-bounded-project-workflow-permissions/research.md`

Original prior-doc context from the first research pass is retained, but this revision did targeted live verification only where needed to reassess the recommendation against the clarified product model.

Prior adjacent RPI context already incorporated from the first pass:

- `docs/rpi/002-projects-invites/*`
- `docs/rpi/004-project-assets/*`
- `docs/rpi/024-upload-performance-resumability/*`
- `docs/rpi/025-matching-queue-robustness/*`
- `docs/rpi/029-complete-bounded-matching-fanout/*`
- `docs/rpi/031-one-consent-per-face-precedence-rules/*`
- `docs/rpi/043-simple-project-export-zip/*`
- `docs/rpi/055-project-participants-and-mixed-consent-intake/*`
- `docs/rpi/060-project-unresolved-face-review-queue/*`
- `docs/rpi/062-video-upload-foundation/*`
- `docs/rpi/064-whole-asset-linking-for-video-assets/*`
- `docs/rpi/070-tenant-rbac-and-organization-user-management-foundation/*`

Live schema, routes, helpers, migrations, components, and tests inspected as source of truth:

- `supabase/migrations/20260304210000_002_projects_invites_schema.sql`
- `supabase/migrations/20260304211000_002_projects_invites_rls.sql`
- `supabase/migrations/20260305120000_004_assets_schema.sql`
- `supabase/migrations/20260305121000_004_assets_rls.sql`
- `supabase/migrations/20260320140000_019_face_materialization_pipeline.sql`
- `supabase/migrations/20260403120000_029_complete_bounded_matching_fanout.sql`
- `supabase/migrations/20260404110000_032_face_review_sessions_and_derivatives.sql`
- `supabase/migrations/20260415110000_055_project_participants_mixed_consent_foundation.sql`
- `supabase/migrations/20260415193000_057_project_matching_ready_recurring_profiles.sql`
- `supabase/migrations/20260415210000_058_project_face_assignee_bridge.sql`
- `supabase/migrations/20260416090000_059_generic_face_assignee_suppressions.sql`
- `supabase/migrations/20260421110000_061_asset_assignee_links.sql`
- `supabase/migrations/20260422143000_067_consent_scope_state_foundations.sql`
- `supabase/migrations/20260422190000_069_consent_upgrade_governing_foundations.sql`
- `supabase/migrations/20260422200000_069_upgrade_submit_binding_and_supersedence.sql`
- `supabase/migrations/20260423090000_070_tenant_rbac_membership_invites_foundation.sql`
- `src/app/(protected)/projects/page.tsx`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/app/api/projects/route.ts`
- `src/app/api/projects/[projectId]/assets/route.ts`
- `src/app/api/projects/[projectId]/assets/preflight/route.ts`
- `src/app/api/projects/[projectId]/assets/batch/prepare/route.ts`
- `src/app/api/projects/[projectId]/assets/batch/finalize/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/preview-faces/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/preview-link-candidates/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/preview-links/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/whole-asset-candidates/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/whole-asset-links/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/assignment/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/manual-faces/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/blocked-faces/[assetFaceId]/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/hidden-faces/[assetFaceId]/route.ts`
- `src/app/api/projects/[projectId]/invites/route.ts`
- `src/app/api/projects/[projectId]/invites/[inviteId]/revoke/route.ts`
- `src/app/api/projects/[projectId]/profile-participants/route.ts`
- `src/app/api/projects/[projectId]/profile-participants/[participantId]/consent-request/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/review-sessions/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/upgrade-request/route.ts`
- `src/app/api/projects/[projectId]/matching-progress/route.ts`
- `src/app/api/projects/[projectId]/export/route.ts`
- `src/lib/tenant/permissions.ts`
- `src/lib/tenant/resolve-tenant.ts`
- `src/lib/projects/project-participants-service.ts`
- `src/lib/projects/project-consent-upgrade-service.ts`
- `src/lib/projects/project-asset-review-list.ts`
- `src/lib/matching/face-materialization.ts`
- `src/lib/matching/project-recurring-sources.ts`
- `src/lib/project-export/project-export.ts`
- `src/lib/project-export/response.ts`
- `src/lib/invites/public-invite-context.ts`
- `src/lib/recurring-consent/public-recurring-consent.ts`
- `src/components/projects/project-participants-panel.tsx`
- `src/components/projects/assets-upload-form.tsx`
- `src/components/projects/assets-list.tsx`
- `src/components/projects/project-photo-asset-preview-lightbox.tsx`
- `tests/feature-043-simple-project-export-zip.test.ts`
- `tests/feature-055-project-participants-routes.test.ts`
- `tests/feature-060-project-unresolved-face-review-queue.test.ts`
- `tests/feature-070-tenant-rbac-foundation.test.ts`

Additional targeted verification performed for this revision:

- `src/app/(protected)/projects/[projectId]/page.tsx`
- `supabase/migrations/20260304210000_002_projects_invites_schema.sql`
- `supabase/migrations/20260305120000_004_assets_schema.sql`
- `supabase/migrations/20260320140000_019_face_materialization_pipeline.sql`
- `supabase/migrations/20260415110000_055_project_participants_mixed_consent_foundation.sql`
- `src/lib/invites/public-invite-context.ts`
- `src/lib/recurring-consent/public-recurring-consent.ts`
- `src/lib/project-export/response.ts`

Prior RPI docs were treated as context only. Where a prior doc and live code differ, the live schema and current implementation are authoritative.

## Verified current behavior

### 1. Current live boundary

Projects are currently the only operational container for all of the following:

- one-off invite issuance via `subject_invites`
- one-off subject identity via `subjects`
- one-off signed consents via `consents`
- recurring project participants via `project_profile_participants`
- recurring project consent requests and signed project consents
- uploaded assets via `assets`
- asset-to-consent links via `asset_consent_links`
- matching fanout and compare workload
- review sessions, manual faces, hidden faces, blocked faces, assignee links, and whole-asset links
- project export and current project read models

That is visible both in schema and in the protected project page:

- `src/app/(protected)/projects/[projectId]/page.tsx` loads a single `project_id` and then renders the mixed participant section, invite section, upload surface, asset list, matching progress, and export entry point under that same project.
- Public consent flows in `src/lib/invites/public-invite-context.ts`, `src/app/i/[token]/consent/route.ts`, and `src/lib/recurring-consent/public-recurring-consent.ts` all resolve and submit against a specific `project_id`.
- Matching and review tables are keyed by `project_id`, not by photographer, shoot, or workspace.

There is no separate live operational container for "capture workspace", "shoot", "session", "handoff", or "photographer assignment".

### 2. What project-scoped access exists today after Feature 070

Feature 070 added tenant roles and role-based capability helpers, but it did not add project staffing.

Live tenant roles in `src/lib/tenant/permissions.ts` are:

- `owner`
- `admin`
- `reviewer`
- `photographer`

Live role-derived capabilities are:

- owner/admin: create projects, manage members/templates/profiles, capture, and review
- reviewer: review only
- photographer: capture only

Important current limitation:

- `resolveProjectPermissions(...)` is role-only. It does not take `projectId`.
- `assertCanCaptureProjectAction(...)` and `assertCanReviewProjectAction(...)` are also role-only and tenant-scoped.
- `resolveProjectPermissions(supabase, tenantId, userId)` decides what kind of project actions a user may perform, but not which projects they may perform them on.

Current project visibility remains tenant-wide for members:

- `src/app/(protected)/projects/page.tsx` lists all projects for the active tenant.
- `src/app/(protected)/projects/[projectId]/page.tsx` loads any project in the tenant, then conditionally hides or shows capture/review controls based on role.
- `src/app/api/projects/[projectId]/matching-progress/route.ts` checks auth, tenant resolution, and project existence, but not capture/review role or project assignment.
- `src/lib/project-export/response.ts` and `src/app/api/projects/[projectId]/export/route.ts` currently require auth, tenant membership, and project existence only.
- `tests/feature-043-simple-project-export-zip.test.ts` explicitly verifies that photographer members can export a project ZIP today.

Current SQL helper state matches that limitation:

- `app.current_user_can_capture_project(p_tenant_id, p_project_id)`
- `app.current_user_can_review_project(p_tenant_id, p_project_id)`
- `app.current_user_can_access_project(p_tenant_id, p_project_id)`

All three currently collapse to tenant membership plus role. None of them enforce project assignment because there is no project assignment table yet.

### 3. Current scaling and operational implications of one shared project

If multiple unrelated photographers contribute to one shared project today, they contribute into one shared consent pool, one shared asset pool, one shared matching pool, one shared review queue, and one shared export.

That is not just a UX concern. It is grounded in the live architecture:

- `list_uploaded_project_photos_page(...)` in Feature 029 pages all uploaded photos by `(tenant_id, project_id)`.
- `list_current_project_consent_headshots_page(...)` pages all current consent headshots by `(tenant_id, project_id)`.
- recurring project matching sources in `src/lib/matching/project-recurring-sources.ts` are also loaded by `project_id`.
- compare tables such as `asset_consent_face_compares` and `asset_project_profile_face_compares` are project-scoped.

Implications of mixed unrelated photographer contributions inside one project:

- matching fanout grows against the full project-wide opposite side, not the photographer's own subset
- one-off headshots collected by Photographer A become candidates for assets uploaded by Photographer B
- recurring project participants added for one capture stream become candidates across the whole project
- review queues and asset review summaries become shared and noisier
- people filters in the asset list are project-wide, not photographer-local
- exports bundle the full mixed project, not a photographer-bounded slice

So the concern about pair explosion and unrelated capture sets mixing is valid in the current implementation.

## Current schema, routes, helpers, and UI surfaces involved

### Core tables and functions

Project and one-off intake:

- `projects`
- `subject_invites`
- `subjects`
- `consents`
- `revoke_tokens`
- `consent_events`

Assets and direct project media links:

- `assets`
- `asset_consent_links`

Recurring project participants and project-scoped recurring consent:

- `project_profile_participants`
- `recurring_profile_consent_requests` with `consent_kind = 'project'`
- `recurring_profile_consents` with `consent_kind = 'project'`

Matching and review state:

- `asset_face_materializations`
- `asset_face_materialization_faces`
- `asset_consent_face_compares`
- `asset_project_profile_face_compares`
- `face_review_sessions`
- `face_review_session_items`
- `project_face_assignees`
- `asset_assignee_links`
- hidden face, blocked face, and manual face tables from Features 045, 048, 058, 059, 061, 067, and 069
- `project_consent_scope_signed_projections`
- `project_consent_upgrade_requests`

Current SQL access helpers:

- `app.current_user_can_access_project(...)`
- `app.current_user_can_capture_project(...)`
- `app.current_user_can_review_project(...)`

Important nuance:

- newer project-local tables often use `app.current_user_can_access_project(...)`
- older foundational tables such as `projects`, `subject_invites`, `subjects`, `consents`, `assets`, and `asset_consent_links` still rely on membership-based RLS policies directly

So Feature 072 cannot stop at UI gating if it wants a real DB-backed project-assignment boundary.

### Routes and helpers that would be touched

Project creation and listing:

- `src/app/(protected)/projects/page.tsx`
- `src/app/api/projects/route.ts`

Project detail and shared read surfaces:

- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/app/api/projects/[projectId]/assets/route.ts`
- `src/app/api/projects/[projectId]/matching-progress/route.ts`
- `src/app/api/projects/[projectId]/export/route.ts`
- `src/lib/project-export/response.ts`
- `src/lib/project-export/project-export.ts`
- `src/lib/projects/project-asset-review-list.ts`

Capture-side project actions:

- `src/app/api/projects/[projectId]/invites/route.ts`
- `src/app/api/projects/[projectId]/invites/[inviteId]/revoke/route.ts`
- `src/app/api/projects/[projectId]/profile-participants/route.ts`
- `src/app/api/projects/[projectId]/profile-participants/[participantId]/consent-request/route.ts`
- `src/app/api/projects/[projectId]/assets/preflight/route.ts`
- `src/app/api/projects/[projectId]/assets/batch/prepare/route.ts`
- `src/app/api/projects/[projectId]/assets/batch/finalize/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`
- `src/lib/tenant/permissions.ts`

Review-governance project actions:

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

Public flows that would be affected by any new capture boundary:

- `src/lib/invites/public-invite-context.ts`
- `src/app/i/[token]/consent/route.ts`
- `src/lib/recurring-consent/public-recurring-consent.ts`

Current UI surfaces directly affected:

- `src/components/projects/project-participants-panel.tsx`
- `src/components/projects/assets-upload-form.tsx`
- `src/components/projects/assets-list.tsx`
- `src/components/projects/project-photo-asset-preview-lightbox.tsx`

## Current constraints and invariants

The live code establishes these constraints:

- `project_id` is the current end-to-end scope key for consent intake, asset ingestion, matching, review, and export.
- Public one-off and recurring project consent flows both bind to a single project.
- Matching fanout boundaries are project-wide, not creator-wide and not photographer-wide.
- Review state is attached to project-scoped assets and project-scoped assignees.
- Export is project-wide today.
- There is no live child-workspace abstraction below project.
- There is no live grouping abstraction above project besides tenant.
- Creator attribution exists on some rows such as `projects.created_by`, `subject_invites.created_by`, `assets.created_by`, and `project_profile_participants.created_by`, but that attribution is not enough to isolate mixed capture safely.

Important derived invariants:

- If the product wants unrelated photographer work not to mix for consent, matching, review, and export, project assignment alone is insufficient. The operational scope itself must narrow below `project_id`.
- The clarified product model does not accept "separate normal projects per photographer" as the steady-state answer. It requires one organization-facing project with one or more isolated photographer workspaces beneath it.
- Because Feature 073 is expected to introduce workspace handoff and later umbrella-project closure, Feature 072 needs to establish a first-class workspace boundary now even though the current schema is still project-scoped.
- The bounded way to do that is to preserve `project` as the umbrella container and add a subordinate workspace scope, not to create a second parallel project system.

## Project staffing model options considered

### Option A - One organization project with multiple assigned photographers sharing one workspace

Fit with current code and schema:

- strongest short-term fit
- requires only additive staffing tables and project-level permission checks
- does not require moving existing `project_id` references

Matching implications:

- all assigned photographers still share the same matching pool
- does not solve compare fanout across unrelated capture sets

Consent separation implications:

- one-off and recurring project consent remain mixed in one project
- no structural boundary between Photographer A's signers and Photographer B's signers

Review and visibility implications:

- photographers could be limited to assigned projects
- reviewers/admins still see one shared project review surface
- reviewer workload stays mixed

Export implications:

- export remains whole-project unless a new filtered export mode is added

Implementation complexity:

- lowest of the real options

Future compatibility:

- compatible with later handoff tracking
- poor fit for the clarified product requirement because it keeps one shared working set

Conclusion:

- good for staffing
- explicitly not good enough for the intended product model

### Option B - One organization-facing umbrella project plus photographer-scoped child capture workspaces

Fit with current code and schema:

- closest to the desired "organization sees one project, photographer sees a closed-off personal version" product idea
- requires touching the current project-scoped operational tables because `project_id` is the hard boundary almost everywhere
- still fits as a bounded next slice if implemented as an additive subordinate scope under `projects`, rather than as a second project system

Matching implications:

- solves fanout and unrelated matching only if matching moves to workspace scope from the start
- requires the compare inputs, replay/reconcile logic, and progress reads to become workspace-aware while still anchored to an umbrella project

Consent separation implications:

- one-off invite intake can remain under the same public flow pattern if invite rows gain workspace scope
- recurring project participants and recurring project consent requests also need workspace scope or they will still pollute the shared project-side matching space

Review and visibility implications:

- reviewer/admin can still enter through the normal project page, then select a workspace
- Feature 072 does not need a sophisticated aggregated review surface; it needs workspace-separated queues and a project-level workspace list

Export implications:

- read models and exports should become workspace-aware
- full aggregated umbrella export can be deferred, but mixed project-wide photographer export cannot remain the long-term shape

Implementation complexity:

- higher than assignment-only
- still bounded if Feature 072 only establishes the workspace entity, workspace assignments, workspace-scoped operational rows, and project-page workspace navigation

Future compatibility:

- strongest fit for the clarified product direction
- strongest foundation for Feature 073 workspace handoff and later umbrella-project closure

Conclusion:

- now the recommended direction
- more expensive than assignment-only, but it establishes the right lifecycle boundary instead of baking in another temporary shape

### Option C - Each photographer gets a separate normal project, with grouping/reporting deferred

Fit with current code and schema:

- best fit with the live architecture because separate projects already isolate intake, assets, matching, review, and export
- no new sub-project model required

Matching implications:

- strongest immediate isolation
- compare fanout remains bounded to the photographer's own project

Consent separation implications:

- one-off and recurring project consent stay separate because they are already project-bound

Review and visibility implications:

- reviewers/admins can review each project separately with current surfaces
- no aggregated organization-side event view yet

Export implications:

- current export behavior already matches this model

Implementation complexity:

- low from a data-boundary perspective
- operationally incompatible with the clarified product model because the organization should still see one project

Future compatibility:

- useful only as a fallback operational workaround, not as the recommended next architecture

Conclusion:

- no longer the recommended direction
- it preserves isolation, but it breaks the intended one-project UX and the planned 073 layering

### Option D - Keep one shared project but add subgroup, shoot, or session tags

Fit with current code and schema:

- additive and cheaper than full child workspaces

Matching implications:

- weak
- tags do not prevent project-wide fanout unless all matching, review, and export logic is retargeted to those tags

Consent separation implications:

- weak
- still shares the same project-level subject and consent pool

Review and visibility implications:

- could improve filters and UX labeling
- does not provide real isolation or permission boundaries by itself

Implementation complexity:

- moderate for modest product value

Future compatibility:

- may become redundant if a real workspace layer arrives later

Conclusion:

- useful metadata later
- not the right answer for Feature 072 because the goal is now explicitly isolated photographer workspaces under one project

## Shared project vs photographer-scoped capture separation

The main research question is whether one organization-facing project should be split into photographer-scoped capture workspaces.

Based on the clarified product model and the live architecture, the answer is:

- yes, the product needs photographer-scoped isolated workspaces under one umbrella project
- a shared project with assignment-only controls is not a safe or sufficient boundary because consent intake, matching fanout, review queues, and exports would still mix

The live architecture still shows that this is not a tiny change:

- public invite flows are project-local
- recurring project consent flows are project-local
- matching fanout is project-local
- review state is project-local
- export is project-local

But the clarified product model changes the recommendation. Deferring workspaces would force Feature 073 to build handoff and closure on the wrong unit. The bounded next step is therefore:

- keep `project` as the umbrella container and top-level UI object
- introduce a first-class photographer-scoped workspace under the project in Feature 072
- move capture and review-noise-producing operational data to workspace scope beneath the project
- keep everything inside the normal Projects area

This is the smallest safe step that aligns the data model with the intended product and with the expected Feature 073 handoff foundation.

## UI and product shape

The clarified UX should remain one project system:

- the Projects list still shows one project row for the organization-facing project
- opening a project stays inside the normal project detail area
- if the project has exactly one workspace, the experience should feel like a normal single project and default directly into that workspace context
- if the project has multiple workspaces, the project detail should expose a workspace selector or workspace list inside the project
- a photographer should only see and operate inside their own workspace
- reviewer/admin/owner users should enter through the umbrella project and then inspect one workspace at a time, with optional lightweight project-level summary information

This does not require two project systems. It requires one project shell with subordinate workspace navigation.

## What should stay project-scoped vs workspace-scoped

Recommended project-scoped concerns:

- project metadata and project list entries
- project creation
- project staffing overview
- project default template selection, at least for the first slice
- project-level workspace roster and lightweight aggregate counts
- later umbrella-project closure state in Feature 073

Recommended workspace-scoped concerns in Feature 072:

- one-off invites
- one-off subjects
- one-off consents
- recurring project participants
- recurring project consent requests
- recurring project consents
- assets
- asset-to-consent links
- matching jobs, materializations, compare fanout, and progress reads
- review queues and review-state tables that currently attach to project-scoped capture data
- consent upgrade requests and consent-scope projections that derive from workspace-scoped consent records
- photographer access checks
- reviewer/admin workspace review entry points

Recommended export and read-model stance:

- workspace-aware read models should be established in Feature 072 because review noise and asset lists must stop mixing
- full umbrella-project export or sophisticated aggregated project reporting can be deferred
- the current project-wide photographer export behavior should not remain the default once multiple isolated workspaces exist

## Matching, review, and export implications

Matching:

- assignment-only on a shared project keeps the current project-wide fanout and is therefore incompatible with the clarified product requirement
- Feature 072 should establish workspace-scoped fanout boundaries so uploaded assets and consent headshots only compare inside one photographer workspace
- the current project-wide unique keys and job scopes imply that core matching tables and replay/reconcile helpers will need a `workspace_id` subordinate to `project_id`

Review:

- current review surfaces assume one project-wide queue and one project-wide asset list
- the revised foundation should make queues and asset review lists workspace-scoped while still entering through the umbrella project
- Feature 072 does not need a full aggregated review dashboard; it needs clean workspace-by-workspace review
- that gives Feature 073 a clear handoff unit: reviewer/admin reviews a workspace, not an undifferentiated project blob

Export and read models:

- current project export is a whole-project artifact and therefore mismatched for isolated multi-photographer workspaces
- project read models such as asset review summaries and people filters also need workspace scope once workspaces exist
- Feature 072 should establish workspace-aware read models first
- aggregated umbrella export/reporting can be deferred if needed, but the plan phase should decide whether to tighten export permissions immediately or introduce explicit workspace export selection

## Project-scoped permission model conclusions

Recommended permission shape on top of Feature 070:

- owner/admin remain tenant-wide and can see/manage all projects
- reviewer remains a tenant-wide review role for this slice, but review actions become workspace-targeted inside a project
- photographer becomes assignment-scoped at the workspace level inside a project

Recommended photographer workspace actions:

- open their assigned project and land in their workspace
- create one-off invites in their workspace
- revoke unused invites in their workspace
- add recurring participants in their workspace
- create recurring project consent requests in their workspace
- upload and finalize assets in their workspace
- view only workspace-local capture and read surfaces

Recommended project-level organization and staffing actions:

- owner/admin create the umbrella project
- owner/admin assign one or more photographers, with one workspace per photographer in the first bounded model
- owner/admin/reviewer can open the umbrella project and switch between workspaces they are allowed to inspect

Recommended reviewer/admin-only actions:

- review queues and preview routes for a selected workspace
- manual face creation
- face assignment and whole-asset linking
- hide or block faces
- consent headshot replacement
- consent upgrade initiation

Recommended owner/admin-only actions unchanged from Feature 070:

- create projects
- manage tenant members
- manage templates and recurring profiles
- set project default template

Open permission edge:

- export is currently membership-wide, including photographers
- once isolated workspaces exist, export must be reconsidered explicitly in the plan phase rather than remaining an accidental legacy permission

## Review visibility model

Smallest bounded review model that fits the current architecture:

- reviewers/admins continue to enter through the umbrella project
- inside that project, reviewers/admins inspect one workspace at a time
- photographers do not see other photographers' workspaces
- a lightweight workspace roster plus workspace-local detail view is enough for Feature 072
- a richer aggregated umbrella review view can be deferred

## Minimal lifecycle implications

Feature 072 still does not require a full lifecycle state machine.

But Feature 072 now does need to establish the correct structural lifecycle unit:

- `project` is the umbrella organization-facing unit
- `workspace` is the photographer capture and later handoff unit

Recommended 072 vs 073 split:

- Feature 072 should establish the workspace entity, workspace assignment, workspace-aware access checks, and workspace-scoped operational data
- Feature 072 should avoid a full handoff state machine if possible
- Feature 073 should build on that workspace boundary by adding workspace handoff states and later umbrella-project close/finalize behavior

If a tiny status is unavoidable in 072, it should attach to workspace rows, not to the umbrella project. But the preferred outcome is to let 072 establish structure and let 073 add the workflow states.

## Recommendation

Best bounded next step after Feature 070:

- Feature 072 should be umbrella project plus photographer-scoped capture workspace foundation
- it should not stop at project assignment on one shared workspace

Reasoning:

- project assignment is needed now because photographers should not automatically operate on every tenant project
- the clarified product requirement explicitly needs one project with isolated photographer workspaces beneath it
- Feature 073 is expected to add workspace handoff and later umbrella closure, so deferring workspaces would push the next feature onto the wrong boundary
- the current architecture is heavily project-scoped, but a bounded foundation is still possible by preserving `project` as the umbrella key and adding `workspace_id` beneath it to the operational tables that currently mix

Recommended product stance for this feature:

- the organization creates one project
- that project may have one or more assigned photographers
- each assigned photographer gets an isolated workspace inside that project
- if only one workspace exists, the project behaves like a normal single project
- if multiple workspaces exist, the project stays one umbrella project in the UI and exposes workspace selection inside it

What should definitely be deferred:

- a rich aggregated umbrella review dashboard across all workspaces
- aggregated umbrella export/reporting
- DAM/media-library integration
- broader agency hierarchy
- a full project lifecycle state machine

## Risks and tradeoffs

- This recommendation is more invasive than assignment-only because many project-scoped tables and helpers need a subordinate workspace scope.
- A real workspace boundary will require both app-layer changes and a database/RLS sweep, especially for older project-local tables that still only check tenant membership.
- Existing projects and rows will need a backfill strategy, likely by creating one default workspace per project and attaching current rows to it.
- Keeping reviewer visibility tenant-wide is still the smallest role model, but some organizations may later want review staffing per project or workspace.
- Tightening or reshaping export permissions may be behavior-changing because photographers can export today.

## Explicit open decisions for the plan phase

1. What is the exact workspace model for the first slice: one workspace per assigned photographer, or a more flexible workspace-assignment table that still defaults to one-per-photographer?
2. What should the route shape be inside Projects: query-param workspace selection on the existing project page, or a nested workspace route under the same project shell?
3. Should project default template remain umbrella-scoped only in 072, with workspace overrides deferred?
4. Should export become workspace-selectable, or should project export be restricted to reviewer/admin/owner until a proper aggregated export model exists?
5. Which project-local tables need `workspace_id` in the first slice to guarantee true isolation for intake, matching, review, and read models?
6. Should reviewers remain tenant-wide in 072, or should project/workspace reviewer assignment also be pulled into this feature?
7. What is the backfill strategy for existing projects and existing project-local rows when the first default workspace is introduced?
