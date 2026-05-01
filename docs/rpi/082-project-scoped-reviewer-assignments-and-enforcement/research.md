# Feature 082 Research: Reviewer Access Assignments and Enforcement

## 1. Title and scope

Feature 082 should be the first enforcing slice built on the Feature 081 durable role-assignment foundation. The feature should replace automatic tenant-wide access for `memberships.role = reviewer` with explicit reviewer grants while preserving owner/admin tenant-wide access and photographer workspace-scoped capture behavior.

The researched scope is limited to:

- explicit tenant-wide reviewer grants;
- explicit project-scoped reviewer grants;
- project list, project detail, workspace, review, correction, finalization, and Media Library authorization changes needed to enforce those grants consistently;
- owner/admin UI/API surfaces for creating and revoking grants;
- tests for TypeScript authorization, SQL/RLS authorization, and assignment writes.

This research does not recommend a custom role editor, invite-to-custom-role flow, member allow/deny overrides, workspace-specific reviewer assignment, or photographer access redesign.

## 2. Inputs reviewed

Required project and RPI inputs were reviewed in the requested order:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `UNCODEXIFY.md`
- `docs/rpi/README.md`
- `docs/rpi/SUMMARY.md`
- Feature 070 research and plan
- Feature 072 research and plan
- Feature 073 research and plan
- Feature 075 research and plan
- Feature 076 research and plan
- Feature 079 research and plan
- Feature 080 research and plan
- Feature 081 research and plan

Live code and schema were then inspected as the source of truth, especially:

- `src/lib/tenant/role-capabilities.ts`
- `src/lib/tenant/permissions.ts`
- `src/lib/tenant/role-assignment-foundation.ts`
- `src/lib/tenant/member-management-service.ts`
- `src/lib/projects/project-workspaces-service.ts`
- `src/lib/projects/project-workspace-request.ts`
- `src/lib/projects/project-workflow-service.ts`
- `src/lib/projects/project-workflow-route-handlers.ts`
- `src/lib/projects/project-consent-upgrade-route-handlers.ts`
- `src/lib/projects/project-participants-route-handlers.ts`
- `src/lib/project-releases/project-release-service.ts`
- `src/lib/media-library/media-library-folder-service.ts`
- `src/app/(protected)/projects/page.tsx`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/app/(protected)/members/page.tsx`
- `src/components/members/member-management-panel.tsx`
- `src/app/api/members/**`
- `src/app/api/projects/**`
- `src/app/api/media-library/**`
- relevant migrations under `supabase/migrations/`
- relevant tests under `tests/`

`rg` is not available in the local shell, so repository searches used PowerShell `Get-ChildItem` and `Select-String`.

## 3. Verified current reviewer behavior

Current reviewer behavior is still fixed-role and tenant-wide.

### Project list visibility

`src/app/(protected)/projects/page.tsx` resolves the active tenant and calls `resolveTenantPermissions`. If the fixed membership role is `photographer`, it loads projects through assigned `project_workspaces`. For every non-photographer role, including `reviewer`, it loads all tenant projects:

- owners see all tenant projects;
- admins see all tenant projects;
- reviewers see all tenant projects;
- photographers see only projects with assigned workspaces.

There is no role-assignment lookup in the project list.

### Project and workspace access

`src/lib/tenant/permissions.ts` is the main app-layer access source:

- `deriveTenantPermissionsFromRole("reviewer")` sets `canReviewProjects: true`.
- `resolveProjectPermissions(...)` is tenant/user role-only; it does not accept `projectId` or inspect assignments.
- `resolveAccessibleProjectWorkspaces(...)` returns all project workspaces for any non-photographer role. Reviewers therefore see every workspace in every project they can load.
- `resolveWorkspacePermissions(...)` denies photographers when they are not assigned to the workspace. Reviewers are non-photographers, so they get role-derived review permissions for any workspace in the tenant.
- `assertCanReviewProjectAction(...)` only checks role-derived `canReviewProjects`.
- `assertCanReviewWorkspaceAction(...)` only checks `resolveWorkspacePermissions(...)` plus role-derived `canReviewProjects`.

### Review routes

Most review and matching APIs do not implement route-local reviewer logic. They go through central helpers in `src/lib/projects/project-workspace-request.ts`, especially:

- `requireWorkspaceReviewAccessForRequest`
- `requireWorkspaceReviewAccessForRow`
- `requireWorkspaceReviewMutationAccessForRequest`
- `requireWorkspaceReviewMutationAccessForRow`
- `requireWorkspaceCorrectionReviewMutationAccessForRow`

Routes under `src/app/api/projects/[projectId]/assets/**`, `consents/**/review-sessions/**`, matching preview/link routes, and face/manual review routes rely on those helpers. Because those helpers call the fixed-role permission helpers, reviewer access is tenant-wide today.

### Correction routes

Correction consent intake and correction media intake are also centralized through `project-workspace-request.ts`:

- `requireWorkspaceCorrectionConsentIntakeAccessForRequest`
- `requireWorkspaceCorrectionConsentIntakeAccessForRow`
- `requireWorkspaceCorrectionMediaIntakeAccessForRequest`

These first require reviewer-style workspace access or role capabilities such as `correction.media_intake`, then validate finalized/correction workflow state. A fixed reviewer can currently perform these actions anywhere in the tenant where workflow state permits.

### Finalization and correction start

`src/lib/projects/project-workflow-route-handlers.ts` handles project finalization and correction start:

- `handleProjectFinalizePost(...)` resolves accessible project workspaces, calls `assertCanReviewProjectAction(...)`, then finalizes and builds a release snapshot.
- `handleProjectCorrectionStartPost(...)` resolves accessible project workspaces, calls `assertCanReviewProjectAction(...)`, then starts correction.
- `handleWorkspaceCorrectionReopenPost(...)` requires workspace review access before reopening a workspace for correction.

Since `assertCanReviewProjectAction(...)` is role-only, any fixed reviewer can finalize or start correction for any tenant project if workflow blockers pass.

### Media Library routes

`src/lib/project-releases/project-release-service.ts` implements `authorizeMediaLibraryAccess(...)` by calling `resolveTenantPermissions(...)` and checking `roleHasCapability(permissions.role, "media_library.access")`. The reviewer fixed role has that capability. `src/lib/media-library/media-library-folder-service.ts` uses `authorizeMediaLibraryAccess(...)` for folder list, create, rename, archive, move, add, and remove operations.

The Media Library is currently a tenant-wide surface. It does not filter by project assignment.

### SQL/RLS enforcement

`supabase/migrations/20260423121000_072_project_workspace_access.sql` embeds tenant-wide reviewer access in SQL helpers:

- `app.current_user_can_access_project(...)` allows `owner`, `admin`, and `reviewer` for every tenant project.
- `app.current_user_can_access_project_workspace(...)` allows `owner`, `admin`, and `reviewer` for every tenant workspace.
- `app.current_user_can_review_project(...)` allows `owner`, `admin`, and `reviewer`.
- `app.current_user_can_review_project_workspace(...)` allows `owner`, `admin`, and `reviewer`.
- capture helpers do not allow reviewers.

These helpers are used by policies for projects, workspaces, invites, subjects, consents, assets, asset links, review tables, profile participants, recurring request tables, and consent upgrade requests.

`supabase/migrations/20260424130000_074_project_releases_media_library_foundation.sql` defines `app.current_user_can_access_media_library(...)` as `owner`, `admin`, or `reviewer`. `supabase/migrations/20260425120000_078_media_library_folders_foundation.sql` defines `app.current_user_can_manage_media_library(...)` the same way.

### Places that assume reviewers are tenant-wide

The tenant-wide reviewer assumption exists in:

- `ROLE_CAPABILITIES.reviewer` in `role-capabilities.ts` for review, workflow, correction, and Media Library capabilities;
- `deriveTenantPermissionsFromRole(...)`;
- `deriveProjectPermissionsFromRole(...)`;
- `resolveProjectPermissions(...)`;
- `resolveAccessibleProjectWorkspaces(...)`;
- `resolveWorkspacePermissions(...)`;
- `assertCanReviewProjectAction(...)`;
- `assertCanReviewWorkspaceAction(...)`;
- project list loading in `src/app/(protected)/projects/page.tsx`;
- project detail authorization and UI affordances in `src/app/(protected)/projects/[projectId]/page.tsx`;
- project workflow route handlers for finalize and correction start;
- all review/correction route helpers that call the central workspace request helpers;
- `authorizeMediaLibraryAccess(...)`;
- SQL helpers for project/workspace access and review;
- SQL helpers for Media Library access and management;
- tests that assert reviewer role alone can review, see projects, or access Media Library.

## 4. Verified current owner/admin and photographer behavior

Owner/admin behavior and photographer behavior are mature and should remain fixed-role based in Feature 082.

### Owner/admin access

Owners and admins receive tenant-wide project, workspace, capture, review, correction, finalization, member management, template management, and project creation permissions from fixed roles.

In TypeScript:

- `ROLE_CAPABILITIES.owner` and `ROLE_CAPABILITIES.admin` include management, capture, review, workflow, correction, and Media Library capabilities.
- `resolveTenantPermissions(...)`, `resolveProjectPermissions(...)`, `resolveAccessibleProjectWorkspaces(...)`, and `resolveWorkspacePermissions(...)` treat owner/admin as tenant-wide roles.
- member management services use `resolveTenantPermissions(...).canManageMembers`.
- workspace staffing remains owner/admin managed.

In SQL/RLS:

- owner/admin are allowed by project/workspace access, review, capture, Media Library, project create, workspace manage, and member management helpers.
- `app.current_user_can_manage_project_workspaces(...)` is fixed owner/admin only.

Feature 082 should not move owner/admin to role assignments.

### Photographer access

Photographer behavior is scoped by `project_workspaces.photographer_user_id`.

In TypeScript:

- project list loads assigned project workspace rows for photographers and then loads only those projects;
- `resolveAccessibleProjectWorkspaces(...)` filters workspaces to `photographer_user_id === userId`;
- `resolveWorkspacePermissions(...)` returns 404-style errors for unassigned workspaces;
- capture request helpers require capture access and workflow mutability;
- review helpers deny photographers because fixed photographer role has no `review.workspace` capability.

In SQL/RLS:

- project access is allowed only when a photographer has an assigned workspace in the project;
- workspace access and capture are allowed only for assigned workspaces;
- review helpers deny photographers;
- project creation and workspace management deny photographers.

Feature 082 should not change photographer assignment, capture semantics, or the fact that photographer fixed role remains capture-only.

## 5. Current Feature 081 role-assignment foundation status

Feature 081 is present in live schema and code, but intentionally non-enforcing.

### Tables and seeds

`supabase/migrations/20260430120000_081_role_assignment_foundation.sql` creates:

- `capabilities`
- `role_definitions`
- `role_definition_capabilities`
- `role_assignments`

Seeded system roles are:

- `owner`
- `admin`
- `reviewer`
- `photographer`

Seeded capabilities match `TENANT_CAPABILITIES` in `src/lib/tenant/role-capabilities.ts`:

- member/template/project/capture/profile/review/workflow/correction/media-library capability keys.

The seeded reviewer system role includes:

- `profiles.view`
- `review.workspace`
- `review.initiate_consent_upgrade_requests`
- `workflow.finalize_project`
- `workflow.start_project_correction`
- `workflow.reopen_workspace_for_correction`
- `correction.review`
- `correction.consent_intake`
- `correction.media_intake`
- `media_library.access`
- `media_library.manage_folders`

### Assignment constraints

`role_assignments` includes:

- `tenant_id`
- `user_id`
- `role_definition_id`
- `scope_type` as `tenant`, `project`, or `workspace`
- `project_id`
- `workspace_id`
- `created_at`
- `created_by`
- `revoked_at`
- `revoked_by`

Important constraints already exist:

- assignment user must be a tenant member through `(tenant_id, user_id)` FK to `memberships`;
- project and workspace scopes are tenant-bound through composite FKs;
- scope shape checks prevent tenant rows with project/workspace ids, project rows without project ids, and workspace rows without workspace ids;
- active unique indexes prevent duplicate active assignment rows per exact scope;
- revoked rows must include both `revoked_at` and `revoked_by`;
- membership deletion cascades assignment rows;
- active assignments cannot reference archived custom roles;
- tenant-scoped custom role definitions cannot be assigned across tenants.

RLS currently allows authenticated reads for managers and own assignment rows. It does not expose authenticated writes.

### Helper functions

`src/lib/tenant/role-assignment-foundation.ts` provides read helpers:

- `listCapabilities`
- `listSystemRoleDefinitions`
- `listRoleDefinitionsForTenant`
- `loadRoleDefinitionWithCapabilities`
- `listRoleAssignmentsForUser`
- `listRoleAssignmentsForProject`
- `listRoleAssignmentsForWorkspace`
- `resolveDurableRoleAssignments`
- `assertRoleCapabilityCatalogMatchesDatabase`

The file explicitly labels assignment resolution as non-enforcing. Live permissions do not call these helpers.

### Current tests

`tests/feature-081-role-assignment-foundation.test.ts` verifies:

- catalog drift between TypeScript and database seeds;
- role definition and capability reads;
- assignment constraints for scope, tenant, project, workspace, and membership boundaries;
- active uniqueness and revocation;
- replacement row creation after revocation;
- membership cleanup cascades role assignments;
- durable assignments do not currently change live access.

Feature 082 must revise the non-enforcement expectation narrowly: system reviewer assignments at tenant/project scope should become enforcing for fixed reviewer members, while unrelated durable assignments should remain non-enforcing until future features.

## 6. Current schema, routes, helpers, SQL/RLS, and tests involved

### Schema and SQL helpers

The implementation will need migrations that update or add helpers related to:

- `app.current_user_can_access_project(...)`
- `app.current_user_can_access_project_workspace(...)`
- `app.current_user_can_review_project(...)`
- `app.current_user_can_review_project_workspace(...)`
- `app.current_user_can_access_media_library(...)`
- `app.current_user_can_manage_media_library(...)`

It should avoid changing capture helpers except to prove no regression:

- `app.current_user_can_capture_project(...)`
- `app.current_user_can_capture_project_workspace(...)`
- `app.current_user_can_manage_project_workspaces(...)`

### TypeScript helpers

The main TypeScript migration seams are:

- `resolveTenantPermissions(...)`
- `deriveTenantPermissionsFromRole(...)`
- `resolveProjectPermissions(...)`
- `resolveAccessibleProjectWorkspaces(...)`
- `resolveWorkspacePermissions(...)`
- `assertCanReviewProjectAction(...)`
- `assertCanReviewWorkspaceAction(...)`
- all request helpers in `project-workspace-request.ts`
- `authorizeMediaLibraryAccess(...)`

### Route surfaces

Route behavior should be changed through shared helpers wherever possible:

- project list page;
- project detail page;
- workspace workflow routes;
- project finalize route;
- project correction start route;
- correction reopen route;
- review/matching routes;
- correction consent intake routes;
- correction media intake routes;
- Media Library routes;
- member management routes;
- new reviewer assignment routes.

### Tests

Current tests with relevant reviewer/photographer expectations include:

- `tests/feature-070-tenant-rbac-foundation.test.ts`
- `tests/feature-072-project-staffing-workspaces.test.ts`
- `tests/feature-073-project-workflow-foundation.test.ts`
- `tests/feature-073-project-workflow-routes.test.ts`
- `tests/feature-074-media-library-download.test.ts`
- `tests/feature-074-project-release-media-library.test.ts`
- `tests/feature-075-project-correction-workflow.test.ts`
- `tests/feature-076-correction-consent-intake-foundation.test.ts`
- `tests/feature-078-media-library-folder-routes.test.ts`
- `tests/feature-078-media-library-folders.test.ts`
- `tests/feature-079-correction-media-intake-foundation.test.ts`
- `tests/feature-080-role-capability-catalog.test.ts`
- `tests/feature-081-role-assignment-foundation.test.ts`

## 7. Options considered for reviewer access modeling

### Option A: assign system reviewer role at tenant or project scope

Tenant-scope assignment of the system `reviewer` role grants review access across all current and future tenant projects. Project-scope assignment of the system `reviewer` role grants review access to that project and all its workspaces.

Benefits:

- directly uses Feature 081 for its intended first enforcement slice;
- uses existing constraints for tenant/project/membership boundaries;
- supports union of active grants;
- keeps audit history through assignment rows and revocation fields;
- aligns with future custom-role direction without building custom-role UI now;
- avoids a second assignment table with overlapping semantics.

Costs:

- SQL helpers must join role assignment and system role tables;
- TypeScript needs an effective reviewer access resolver rather than role-only booleans;
- project-scoped assignments must not blindly grant tenant-wide capabilities like Media Library.

This is the recommended direction.

### Option B: add `project_reviewer_assignments`

A dedicated table would be simpler for project-only reviewer access. It would also avoid interpreting generic scoped role/capability semantics.

It is not recommended because Feature 081 already created the durable assignment table, constraints, and seeded system reviewer role. A dedicated table would duplicate assignment semantics and make future custom-role migration harder.

### Option C: keep `memberships.role = reviewer` as tenant-wide and add project-scoped assignments only for non-reviewers

This preserves current behavior and is the smallest compatibility change.

It is not recommended because it does not solve the core product problem. A fixed reviewer would still see all tenant projects unless admins remembered to avoid using that fixed role, which conflicts with the desired explicit tenant-wide grant model.

### Option D: add project-scoped reviewer assignments but do not enforce yet

This would be another foundation-only slice.

It is not recommended. Feature 081 already produced the foundation. Feature 082 should deliver user-visible enforcement value.

## 8. Recommended model for tenant-wide and project-scoped reviewer grants

Use Option A with a domain-specific service layer over Feature 081 tables.

Recommended representation:

- tenant-wide reviewer access: active `role_assignments` row with the system `reviewer` role, `scope_type = 'tenant'`, no project or workspace;
- project-scoped reviewer access: active `role_assignments` row with the system `reviewer` role, `scope_type = 'project'`, `project_id` set, no workspace;
- effective access: union of active tenant-scope and project-scope reviewer assignments;
- workspace-scope reviewer assignment: not used for Feature 082 enforcement, even though the table can represent it.

Recommended service shape:

- introduce a reviewer-access domain service, for example `reviewer-access-assignments-service.ts`;
- keep generic Feature 081 helpers as durable catalog/read helpers;
- put product-specific eligibility, write idempotency, revocation, tenant-wide detection, and project grant resolution in the reviewer service.

This avoids scattering raw role-assignment queries through pages, route handlers, and SQL-facing code. It also keeps Feature 082 narrow: effective reviewer access is product logic over a generic assignment table, not a full generic effective-capability engine.

## 9. Recommended meaning of `memberships.role = reviewer`

After Feature 082, `memberships.role = reviewer` should mean "eligible reviewer seat", not automatic project access.

Recommended rules:

- fixed `owner` and `admin` keep full tenant-wide access and do not need reviewer assignments;
- fixed `photographer` remains capture-only and should not receive reviewer grants in this slice;
- fixed `reviewer` can receive tenant-wide or project-scoped reviewer grants;
- fixed `reviewer` with no active reviewer grants sees no projects and cannot review;
- changing a member from photographer to reviewer makes them eligible for reviewer grants but should not automatically create grants;
- changing a member away from reviewer should make reviewer grants non-effective, even if old assignment rows remain, or the role-change service should revoke them explicitly;
- removing membership deletes assignment rows through the existing FK cascade.

The Members page should describe the reviewer role as eligible for review access, with actual access controlled by tenant-wide and project-specific assignments.

Owner/admin assignment rows are unnecessary because owner/admin already have full access. Photographer assignment rows should be rejected by the Feature 082 write service to avoid surprising capture-plus-review combinations.

## 10. Recommended project list and project detail behavior

### Project list

Recommended behavior:

- owner/admin: all tenant projects;
- photographer: projects with assigned workspaces only;
- reviewer with active tenant-wide reviewer assignment: all tenant projects;
- reviewer with active project-scoped reviewer assignments: assigned projects only;
- reviewer with no active reviewer assignment: empty state;
- reviewer with both tenant-wide and project grants: all tenant projects; project grants remain stored but are redundant while tenant-wide access is active.

The project list should derive visibility server-side from active tenant and authenticated membership. It must never accept `tenant_id` or effective access from the client.

### Project detail and workspace selection

Recommended behavior:

- owner/admin: all workspaces in any tenant project;
- photographer: assigned workspaces only;
- tenant-wide reviewer: all workspaces in any tenant project;
- project-scoped reviewer: all workspaces under assigned projects;
- reviewer without an effective grant for the project: not-found style behavior for direct navigation.

Project-scoped reviewer assignment should apply to all workspaces in the assigned project. Workspace-specific reviewer grants should be deferred unless future product work requires it.

Project SSR, workspace selection, and API row access should align. If a reviewer manually navigates to an unassigned project URL, the app should avoid leaking existence and return 404/notFound where it currently does so for inaccessible projects. For mutation routes where the project is visible but the action is not allowed, 403 is appropriate.

## 11. Recommended SQL/RLS migration direction

Feature 082 must not be TypeScript-only. RLS helpers must agree with app-layer helpers.

Recommended SQL approach:

- add narrow helper functions for effective reviewer assignment checks instead of building a generic capability engine in SQL;
- update existing project/workspace/review/Media Library helpers to call those checks;
- keep owner/admin fixed-role checks unchanged;
- keep photographer assigned-workspace checks unchanged;
- always require `revoked_at is null`;
- always require the assigned user is the current authenticated user and remains a fixed `reviewer` member if that is the chosen eligibility rule.

Suggested helper shape:

- `app.current_user_has_tenant_wide_reviewer_access(p_tenant_id uuid)`
- `app.current_user_has_project_reviewer_access(p_tenant_id uuid, p_project_id uuid)`
- optionally `app.current_user_has_reviewer_access_to_workspace(p_tenant_id uuid, p_project_id uuid, p_workspace_id uuid)` as a wrapper through project access.

The helper should join `role_assignments` to `role_definitions` and require:

- `role_definitions.system_role_key = 'reviewer'`;
- active assignment;
- assignment tenant matches;
- assignment user matches `auth.uid()`;
- current membership role is `reviewer`;
- tenant-scope row for tenant-wide access, or project-scope row for the requested project.

Update existing helpers:

- `current_user_can_access_project`: owner/admin OR photographer assigned to project OR effective reviewer access to project;
- `current_user_can_access_project_workspace`: owner/admin OR photographer assigned to workspace OR effective reviewer access to workspace's project;
- `current_user_can_review_project`: owner/admin OR effective reviewer access to project;
- `current_user_can_review_project_workspace`: owner/admin OR effective reviewer access to workspace's project;
- `current_user_can_access_media_library`: owner/admin OR tenant-wide reviewer assignment only, if adopting the recommended Media Library rule;
- `current_user_can_manage_media_library`: owner/admin OR tenant-wide reviewer assignment only, if adopting the recommended Media Library rule.

Avoid updating capture helpers except to verify reviewers still cannot capture by assignment.

## 12. Recommended TypeScript helper migration direction

The current `canReviewProjects` boolean is ambiguous because it means fixed-role capability, not effective scoped access. Feature 082 should introduce clearer effective-access helpers.

Recommended model:

- keep fixed role and fixed capability catalog as role metadata;
- add an effective reviewer access resolver that can answer tenant-wide and project-specific review access;
- make project and workspace permission helpers project-aware where review access is involved.

Suggested TypeScript API direction:

- `resolveReviewerAccessForTenant(...)` returns fixed reviewer eligibility, tenant-wide grant, and project grant ids/counts;
- `resolveReviewerAccessForProject(...)` returns whether the user can review a specific project and whether that comes from owner/admin, tenant-wide reviewer assignment, or project assignment;
- `resolveProjectPermissions(...)` should either accept `projectId` or be replaced by a project-aware helper used by project detail and route handlers;
- `resolveWorkspacePermissions(...)` should use effective project reviewer access for reviewers;
- `assertCanReviewProjectAction(...)` should become project-aware or be replaced by a project-aware assertion;
- `assertCanReviewWorkspaceAction(...)` should use the updated workspace permission resolver.

For tenant permissions, avoid setting `canReviewProjects` true from fixed reviewer role alone. Either:

- keep `canReviewProjects` only for owner/admin and tenant-wide effective reviewer access after loading assignments; or
- deprecate it in favor of `hasTenantWideReviewAccess` and `canReviewSelectedProject`.

The second option is clearer and should be preferred during planning.

## 13. Recommended assignment write model

Feature 082 should add server-side owner/admin APIs for reviewer assignment writes.

Recommended rules:

- writes go through a domain-specific reviewer assignment service over `role_assignments`;
- only owner/admin can create or revoke reviewer grants;
- target user must be a current member of the active tenant with fixed role `reviewer`;
- tenant-wide access is a tenant-scope system reviewer assignment;
- project-specific access is a project-scope system reviewer assignment;
- assignment creation is idempotent when an equivalent active row already exists;
- revocation sets `revoked_at` and `revoked_by`;
- re-adding a previously revoked assignment should create a new row to preserve audit history, matching Feature 081 tests;
- deleting membership can rely on existing cascade cleanup, but role-change away from reviewer should either revoke active grants or make them ineffective through the fixed-role eligibility check.

The current Feature 081 RLS exposes reads, not authenticated writes. Feature 082 write APIs should remain server-side and should not expose direct client writes to `role_assignments`.

## 14. Recommended UI/API scope

Smallest useful UI/API scope:

- add owner/admin project detail controls to grant/revoke project-scoped access for reviewer members;
- add owner/admin Members page controls or readout for tenant-wide "review all projects" access;
- show reviewer access summary on the Members page so a reviewer with no assignment is understandable;
- defer a dedicated access-management page.

Recommended APIs:

- list reviewer access summary for members;
- grant/revoke tenant-wide reviewer access for a reviewer member;
- list project reviewer grants for a project;
- grant/revoke project reviewer access for a reviewer member.

The project detail page is the clearest place to assign reviewers to one project because owners/admins already manage project workspaces and staffing there. The Members page is the clearest place to grant tenant-wide "review all projects" access because the grant is member-wide and applies to all current and future projects.

UI copy should be minimal and localized through the existing i18n framework. Required concepts:

- reviewer role is eligibility;
- tenant-wide review access applies to all current and future projects;
- project review access applies only to this project;
- tenant-wide access overrides project-specific grants in effective access, but removing tenant-wide access leaves project grants intact.

Do not introduce a custom-role editor or broad access-management dashboard for this feature.

## 15. Recommended Media Library access rule

Recommended rule: owner/admin or tenant-wide reviewer assignment only.

Project-scoped reviewer grants should not grant tenant-wide Media Library access in Feature 082.

Rationale:

- the current Media Library is a tenant-wide library of latest released assets;
- allowing project-scoped reviewers into the full Media Library would leak unrelated projects;
- filtering Media Library assets by project-scoped reviewer assignments would require project-aware list/detail/download/folder semantics and is larger than this feature;
- keeping Media Library tied to fixed reviewer role would undermine the goal of removing automatic tenant-wide reviewer access.

Therefore:

- owner/admin keep full Media Library access/manage rights;
- reviewer with tenant-wide reviewer assignment can access and manage Media Library folders, matching current trusted reviewer behavior;
- reviewer with only project-scoped grants cannot access the tenant-wide Media Library in Feature 082;
- project-scoped Media Library filtering can be a later Media Library-specific access feature.

This requires updating both `authorizeMediaLibraryAccess(...)` and SQL helpers `current_user_can_access_media_library(...)` / `current_user_can_manage_media_library(...)`.

## 16. Recommended correction/finalization behavior

Project-scoped reviewer access should allow the same review/correction/finalization actions the old tenant-wide reviewer role allowed, but only inside assigned projects.

Recommended effective project reviewer capabilities:

- view project/workspace review surfaces for the assigned project;
- validate/reopen/needs-changes/handoff review-side workspace workflow actions where current workflow rules permit;
- initiate consent upgrade requests where review mutation rules permit;
- finalize assigned projects when workflow blockers pass;
- start correction on assigned projects;
- reopen assigned project workspaces for correction;
- perform correction review actions;
- perform correction consent intake;
- perform correction media intake.

The following should remain denied:

- project creation;
- project workspace staffing/management;
- member/profile/template management;
- capture/upload in normal active capture mode;
- inviting participants in normal capture mode;
- tenant-wide Media Library access unless the reviewer also has tenant-wide reviewer assignment.

No action currently allowed to reviewers appears to need to become owner/admin-only in this feature. The important change is scoping the old reviewer authority to effective assigned projects.

## 17. Fresh reset and seed/dev data considerations

For Feature 082, local development can assume `supabase db reset`.

Recommended data approach:

- do not preserve old local reviewer access behavior;
- do not add compatibility logic to infer tenant-wide grants for old local reviewers;
- tests should create explicit tenant-wide or project-scoped reviewer assignments as needed;
- seed/dev data may include one reviewer with tenant-wide access and one reviewer with project-scoped access if useful for manual validation;
- no arbitrary local data backfill is required.

Production backfill is a product decision for the plan phase. If existing production reviewers must keep access, a migration or operational script could create tenant-wide reviewer assignments for existing reviewer memberships. That should not be conflated with local dev reset compatibility.

## 18. Security and tenant-isolation risks

Key risks and mitigations:

- Cross-tenant assignment row: existing composite FKs prevent project/workspace tenant mismatch; write service should still validate tenant/project membership before insert for clear errors.
- Assignment to non-member: existing FK prevents it; service should validate target membership before write.
- Assignment to photographer: service should reject unless the member is first changed to reviewer/admin/owner; SQL/TypeScript effective checks should also require fixed role `reviewer`.
- Assignment to owner/admin: unnecessary; service should reject or no-op because owner/admin already have full access.
- Removed membership with stale grants: existing FK cascade deletes role assignments.
- Role changed away from reviewer: SQL and TypeScript effective checks should require fixed reviewer role, and role-change service should consider revoking active reviewer grants for clarity.
- Revoked assignments still granting access: every SQL and TypeScript assignment lookup must require `revoked_at is null`.
- TypeScript allows access while RLS denies it: update central TypeScript helpers and SQL helpers in the same feature, with parity tests.
- RLS allows access while TypeScript denies it: same parity tests; avoid leaving fixed `reviewer` role in SQL helpers.
- Project existence leak through assignment APIs: owner/admin-only APIs should validate project in active tenant and use not-found style errors for invalid tenant/project combinations.
- Tenant-wide reviewer accidentally gets project-management rights: assignment resolver should grant review/correction/finalization only, not member/template/project/workspace management.
- Project-scoped reviewer accidentally gets Media Library: Media Library helpers should require owner/admin or tenant-wide reviewer assignment only.
- Active tenant switching: all resolvers and write services must derive tenant from active session/server context and filter by that tenant only.

## 19. Testing recommendations

Feature 082 should add or update tests for:

- owner/admin still see all projects and all workspaces;
- photographer still sees only assigned workspace projects;
- photographer capture access remains assigned-workspace scoped;
- photographer review denial remains unchanged;
- reviewer with tenant-wide reviewer assignment sees all projects;
- reviewer with project-scoped assignment sees only assigned projects;
- reviewer with no reviewer assignment sees no projects;
- reviewer cannot access an unassigned project by direct URL;
- reviewer cannot call review APIs on an unassigned project;
- reviewer can call review APIs on an assigned project;
- reviewer can validate assigned workspaces;
- reviewer can finalize assigned projects if workflow blockers pass;
- reviewer can start correction and reopen assigned project workspaces if workflow state permits;
- reviewer can perform correction review, correction consent intake, and correction media intake on assigned projects;
- reviewer assignment does not grant normal capture/upload;
- reviewer assignment does not grant normal participant invite/capture routes;
- reviewer assignment does not grant member management, template management, project creation, or workspace staffing;
- project-scoped reviewer assignment does not grant Media Library access;
- tenant-wide reviewer assignment grants Media Library access/manage rights, if adopting the recommended Media Library rule;
- assignment create/revoke is owner/admin-only;
- target member must have fixed role `reviewer`;
- duplicate active assignment create is idempotent at service/API level;
- revoked assignments stop granting access;
- re-adding after revoke creates a new active row;
- cross-tenant assignment attempts fail;
- TypeScript helper behavior and SQL/RLS helper behavior match for owner/admin, photographer, tenant-wide reviewer, project-scoped reviewer, and unassigned reviewer;
- Feature 081 non-enforcement tests are narrowed so only system reviewer assignments at tenant/project scope are enforcing in Feature 082;
- `supabase db reset` produces a clean schema and tests create explicit reviewer assignments.

SQL/RLS tests should directly exercise:

- `current_user_can_access_project`;
- `current_user_can_access_project_workspace`;
- `current_user_can_review_project`;
- `current_user_can_review_project_workspace`;
- `current_user_can_access_media_library`;
- `current_user_can_manage_media_library`.

App-layer tests should exercise:

- `resolveAccessibleProjectWorkspaces`;
- `resolveWorkspacePermissions`;
- project-aware review assertions;
- project list visibility if there are existing page/service tests;
- route helpers through representative API routes rather than every route individually.

## 20. Open questions for the plan phase

- Should role changes away from `reviewer` revoke active reviewer assignment rows, or should effective access checks simply ignore them while preserving audit rows?
- Should tenant-wide reviewer assignment be exposed as a toggle on each reviewer row, or a separate reviewer access panel on the Members page?
- Should project detail assignment controls support adding multiple reviewers at once, or one reviewer at a time for the first slice?
- Should project-scoped reviewer assignment APIs return 404 or 403 when a reviewer target is not eligible? The service should avoid leaking cross-tenant membership details, but owner/admin within tenant can safely receive validation details.
- Should production migration create tenant-wide assignments for existing reviewer memberships, or should existing reviewers lose access until an admin explicitly grants it? Local development should not require compatibility, but production rollout may need a policy decision.
- Should Feature 082 update the static Feature 080 reviewer capability catalog text to clarify that capabilities are effective only when assigned, or leave the catalog as role-definition metadata?
- Should the first implementation include seed/dev sample reviewer assignments, or keep seed data minimal and rely on tests?
