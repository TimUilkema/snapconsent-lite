# Feature 087 - Tenant-level project administration custom-role enforcement plan

## Scope and contract

Feature 087 will enforce tenant-scoped custom roles for exactly these project-administration capabilities:

- `projects.create`
- `project_workspaces.manage`

This is the plan phase only. Implementation must not include organization-user/member-management delegation, capture custom-role enforcement, review custom-role enforcement, workflow/correction custom-role enforcement, project-scoped custom-role enforcement, workspace-scoped custom-role enforcement, invite-to-custom-role, or a generic effective permission engine.

The implementation should remain small and explicit: extend the existing bounded tenant custom-role helper, add project-administration-specific TypeScript authorization, update the project/project-workspace SQL helpers, wire the two affected UI surfaces, and add parity/non-expansion tests.

## Inputs and ground truth

Primary synthesized input:

- `docs/rpi/087-tenant-level-admin-permission-consolidation/research.md`

Required project docs reviewed:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `UNCODEXIFY.md`
- `docs/rpi/README.md`
- `docs/rpi/SUMMARY.md`

Targeted live verification covered:

- `src/lib/tenant/role-capabilities.ts`
- `src/lib/tenant/tenant-custom-role-capabilities.ts`
- `src/lib/tenant/permissions.ts`
- `src/lib/tenant/media-library-custom-role-access.ts`
- `src/lib/templates/template-service.ts`
- `src/lib/projects/project-workspaces-service.ts`
- `src/app/api/projects/route.ts`
- `src/app/api/projects/[projectId]/workspaces/route.ts`
- `src/app/api/projects/[projectId]/default-template/route.ts`
- `src/app/(protected)/projects/page.tsx`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/components/projects/create-project-form.tsx`
- `src/components/projects/project-workspace-staffing-form.tsx`
- `src/components/projects/project-reviewer-access-panel.tsx`
- Feature 070, 072, 082, 085, and 086 migrations
- Feature 070, 082, 084, 085, and 086 tests

Current live code and migrations are authoritative. The plan below calls out drift where the live state differs from convenient assumptions.

## Verified current boundary from targeted verification

Current TypeScript enforced tenant custom-role allowlist:

- `media_library.access`
- `media_library.manage_folders`
- `templates.manage`
- `profiles.view`
- `profiles.manage`

Current SQL enforced tenant custom-role allowlist is the same five keys in `app.current_user_has_tenant_custom_role_capability(...)`.

Current project-administration gaps:

- `projects.create` is fixed owner/admin only in `assertCanCreateProjectsAction(...)`, `resolveTenantPermissions(...).canCreateProjects`, `app.current_user_can_create_projects(...)`, and the projects insert policy.
- `project_workspaces.manage` is fixed owner/admin only in `assertCanManageProjectWorkspacesAction(...)`, `resolveWorkspacePermissions(...).canManageWorkspaces`, `app.current_user_can_manage_project_workspaces(...)`, and project-workspace write policies.
- `POST /api/projects/[projectId]/workspaces` has a second owner/admin-only check after `assertCanManageProjectWorkspacesAction(...)`.
- The project detail staffing form is currently gated by `projectPermissions.canManageMembers`, not by workspace-management authorization.
- Assignable photographer loading is currently inside the `canManageMembers` branch, which also loads reviewer access data.

Plan-critical SQL/RLS drift:

- Later migrations redefine `app.current_user_can_access_project(...)` and `app.current_user_can_access_project_workspace(...)` for Feature 082 reviewer assignments, but the current `projects` and `project_workspaces` select policies were last rewritten by `20260424144000_072_project_insert_returning_policy_fix.sql`.
- Those select policies are fixed-role/workspace-assignment based. They do not currently use the Feature 082 access helper and do not include custom project-administration capabilities.
- Many non-project-admin tables and RPCs do use `app.current_user_can_access_project(...)` or `app.current_user_can_access_project_workspace(...)`. Feature 087 must not broaden those generic helpers with project-administration custom roles.

## Locked feature scope

In scope:

- Add tenant custom-role enforcement for `projects.create`.
- Add tenant custom-role enforcement for `project_workspaces.manage`.
- Add narrow project-administration read visibility needed to make those actions usable.
- Update project create UI visibility.
- Update project workspace/staffing UI visibility.
- Keep reviewer access controls fixed owner/admin.
- Add SQL/TypeScript parity and non-expansion tests.

Out of scope:

- `organization_users.manage`
- `organization_users.invite`
- `organization_users.change_roles`
- `organization_users.remove`
- all capture capabilities
- all review capabilities
- all workflow/finalization capabilities
- all correction capabilities
- project-scoped custom-role enforcement
- workspace-scoped custom-role enforcement
- invite-to-custom-role
- generic app-wide effective capability resolution
- member-level deny/override rules
- owner transfer/demotion
- suspended/deactivated member states
- agency/client hierarchy
- per-folder or per-asset permissions
- Media Library helper refactor unless strictly required
- project default template authorization changes

## Explicit deferral of `organization_users.*`

Feature 087 must not change:

- Members nav visibility.
- `/members` page authority.
- member invite create/resend/revoke authority.
- fixed role change authority.
- member removal authority.
- custom role editor authority.
- custom role assignment authority.
- reviewer access grant/revoke authority.
- owner/admin protections.
- inviteable/editable fixed-role lists.

Feature 088 should separately research and plan member-management delegation semantics, including whether delegated users can invite members, change fixed roles, assign custom roles, grant reviewer access, manage admins, or use only narrower per-action member-management guards.

## Explicit project default template decision

Project default template updates remain authorized by effective `templates.manage`.

Feature 087 must not move project default template updates under `project_workspaces.manage`. The route `src/app/api/projects/[projectId]/default-template/route.ts` and service `setProjectDefaultTemplate(...)` should stay on the Feature 086 template-management path.

A future capability such as `projects.configure_templates` or `projects.manage` can be researched later if project-specific template configuration grows beyond the current default-template field.

## Chosen project visibility/read-access model

Choose Option B: add narrow project-administration read visibility.

The narrow read model is:

- A user with effective `project_workspaces.manage` can see tenant project rows and project workspace rows needed to manage workspace staffing.
- A user with effective `projects.create` can see project rows they created, so the existing create form redirect to `/projects/[projectId]` does not dead-end.
- `projects.create` alone does not allow workspace staffing.
- `project_workspaces.manage` does not allow capture, review, workflow, correction, asset, consent, Media Library, template/profile, member-management, custom-role assignment, or reviewer-access management data.
- Project/workspace operational access remains governed by existing fixed-role, photographer assignment, and Feature 082 reviewer assignment rules.

Do not implement this by broadening:

- `app.current_user_can_access_project(...)`
- `app.current_user_can_access_project_workspace(...)`
- `resolveAccessibleProjectWorkspaces(...)` for capture/review operational use
- `resolveWorkspacePermissions(...)` for capture/review operational use

Instead, add project-administration-specific read and authorization helpers. This avoids exposing tables that already depend on the generic project/workspace access helpers.

Behavior after project creation:

- A custom-role user with `projects.create` can create a project.
- Project creation must not create role assignment rows or workspace assignment rows as a side effect.
- The user can read the project row they created and land on a narrow project-administration detail view.
- If the user also has `project_workspaces.manage`, they can staff workspaces from that project.
- If the user has only `projects.create`, the detail view must not expose staffing, capture, review, correction, member-management, Media Library, templates, or profiles.

## Chosen TypeScript authorization architecture

Use project-administration-specific authorizers. Do not make `resolveTenantPermissions(...)` a custom-role-aware permission bag.

Recommended internal shape:

- Introduce a small project-administration resolver, for example `resolveProjectAdministrationAccess(...)`.
- It should return:
  - fixed membership role,
  - `canCreateProjects`,
  - `canManageProjectWorkspaces`,
  - `canViewProjectAdministration`,
  - clear source fields if useful for tests/debugging.
- It should combine:
  - fixed owner/admin capability via `roleHasCapability(...)`,
  - tenant-scoped custom-role `projects.create`,
  - tenant-scoped custom-role `project_workspaces.manage`.
- It should ignore project-scoped and workspace-scoped custom-role assignments.
- It should not include organization-user, capture, review, workflow, correction, Media Library, template, or profile capabilities.

Dependency note:

- `src/lib/tenant/tenant-custom-role-capabilities.ts` currently imports `resolveTenantMembership` from `src/lib/tenant/permissions.ts`.
- If `permissions.ts` needs to call the tenant custom-role helper, first avoid a circular dependency by moving `getTenantMembershipRole(...)` and `resolveTenantMembership(...)` to a small dependency-light tenant membership module, or by placing the new project-administration resolver in a separate module that imports both existing helpers without making `permissions.ts` import `tenant-custom-role-capabilities.ts`.
- Prefer the smallest clean dependency change. Do not duplicate the custom-role predicate.

Specific TypeScript decisions:

- `resolveTenantPermissions(...).canCreateProjects` should remain fixed-role-derived in Feature 087 unless implementation can update it without turning it into a broad effective custom-role resolver. The project list page should use the new project-administration resolver for create-form visibility.
- `assertCanCreateProjectsAction(...)` should become custom-role aware, either directly or by delegating to the new project-administration resolver.
- `assertCanManageProjectWorkspacesAction(...)` should become custom-role aware, either directly or by delegating to the new project-administration resolver.
- `resolveWorkspacePermissions(...).canManageWorkspaces` should not become the main Feature 087 custom-role path because that helper is tied to operational workspace access.
- Add a narrower helper such as `resolveProjectWorkspaceManagementAccess(...)` or fold that behavior into `resolveProjectAdministrationAccess(...)`.

## Chosen SQL/RLS helper architecture

Extend the bounded SQL helper:

- Add `projects.create` to `app.current_user_has_tenant_custom_role_capability(...)`.
- Add `project_workspaces.manage` to `app.current_user_has_tenant_custom_role_capability(...)`.
- Preserve its tenant-scope-only predicates:
  - active tenant membership,
  - `scope_type = 'tenant'`,
  - `project_id is null`,
  - `workspace_id is null`,
  - `revoked_at is null`,
  - role definition belongs to tenant,
  - role definition is not system,
  - role definition is not archived.

Update project-admin SQL helpers:

- `app.current_user_can_create_projects(p_tenant_id)` should return true for fixed owner/admin or active tenant custom role `projects.create`.
- `app.current_user_can_manage_project_workspaces(p_tenant_id, p_project_id)` should return true for fixed owner/admin or active tenant custom role `project_workspaces.manage`, with the project still tenant-matched.

Add or update narrow project-administration read SQL:

- Add a helper such as `app.current_user_can_view_project_administration(p_tenant_id, p_project_id)`.
- It should return true when:
  - fixed owner/admin already has project admin authority,
  - the user has active tenant custom role `project_workspaces.manage`, or
  - the project row was created by the current user and the user has active tenant custom role `projects.create`.
- Use this helper only for project/project-workspace administration metadata policies.

Policy plan:

- Update the `projects` insert policy to inherit `projects.create` through `app.current_user_can_create_projects(...)`.
- Update or supplement the `projects` select policy so project-administration users can read only project rows allowed by the narrow admin-read helper.
- Update or supplement the `project_workspaces` select policy so workspace managers can read workspace metadata for projects they can manage.
- Existing `project_workspaces` insert/update/delete policies should inherit `project_workspaces.manage` through `app.current_user_can_manage_project_workspaces(...)`.
- Do not add project-administration custom roles to `app.current_user_can_access_project(...)` or `app.current_user_can_access_project_workspace(...)`.
- Do not modify capture/review/correction table policies.

Preserve:

- Media Library wrapper behavior.
- Template/profile helper behavior.
- `organization_users.*` absence from the SQL enforced allowlist.

## Exact `projects.create` behavior

Allowed:

- fixed owner/admin,
- active tenant-scoped custom role with `projects.create`.

Denied:

- no tenant membership,
- fixed reviewer/photographer without the custom capability,
- custom role without `projects.create`,
- revoked assignment,
- archived role definition,
- cross-tenant assignment,
- project-scoped assignment,
- workspace-scoped assignment.

Non-expansion:

- `projects.create` alone does not grant project workspace management.
- `projects.create` alone does not grant capture/upload.
- `projects.create` alone does not grant review.
- `projects.create` alone does not grant finalization.
- `projects.create` alone does not grant correction.
- `projects.create` alone does not grant Media Library access.
- `projects.create` alone does not grant template/profile access.
- `projects.create` alone does not grant member management.

Implementation details:

- `/api/projects` should continue deriving tenant from the authenticated session.
- The create route should use the custom-aware project creation guard.
- The insert should remain tenant-scoped and set `created_by = user.id`.
- Do not create role assignment rows or workspace assignment rows as part of project creation.
- Ensure the route can return the created project id for custom-role project creators. This likely requires the narrow `projects` select policy for projects created by the actor, because Supabase `insert(...).select("id").single()` depends on select visibility.

## Exact `project_workspaces.manage` behavior

Allowed:

- fixed owner/admin,
- active tenant-scoped custom role with `project_workspaces.manage`.

Denied:

- no tenant membership,
- fixed reviewer/photographer without the custom capability,
- custom role without `project_workspaces.manage`,
- revoked assignment,
- archived role definition,
- cross-tenant assignment,
- project-scoped assignment,
- workspace-scoped assignment.

Non-expansion:

- `project_workspaces.manage` alone does not grant project creation.
- `project_workspaces.manage` alone does not grant capture/upload.
- `project_workspaces.manage` alone does not grant review.
- `project_workspaces.manage` alone does not grant workflow finalization.
- `project_workspaces.manage` alone does not grant correction.
- `project_workspaces.manage` alone does not grant Media Library access.
- `project_workspaces.manage` alone does not grant template/profile access.
- `project_workspaces.manage` alone does not grant member management.
- `project_workspaces.manage` alone does not grant reviewer access assignment management.

Implementation details:

- `assertCanManageProjectWorkspacesAction(...)` should be custom-role aware through the project-administration resolver.
- `POST /api/projects/[projectId]/workspaces` must remove or replace the extra `role !== "owner" && role !== "admin"` check. The central custom-aware guard should be authoritative.
- `createPhotographerWorkspace(...)` can remain idempotent: it checks for an existing photographer workspace, inserts if absent, and looks up the conflict row on insert conflict.
- The service path must still validate tenant/project ids server-side and never trust client `tenant_id`.
- SQL project-workspace write policies should inherit from `app.current_user_can_manage_project_workspaces(...)`.

## Exact UI/nav/control plan

Project navigation:

- Keep `/projects` navigation behavior unchanged.
- Do not add new nav items.

Project create UI:

- `/projects` should use project-administration access, not only `resolveTenantPermissions(...).canCreateProjects`, to decide whether to render `CreateProjectForm`.
- Existing form structure and copy can remain unchanged.
- If existing buttons/forms are simply shown to more authorized users, no new i18n copy is needed.

Project list visibility:

- Fixed owner/admin behavior remains unchanged.
- Existing photographer assigned-workspace visibility remains unchanged for photographers without project-admin custom roles.
- Existing reviewer assignment visibility remains unchanged for reviewers without project-admin custom roles.
- Users with `project_workspaces.manage` should see tenant project rows needed for staffing.
- Users with only `projects.create` should see project rows they created.
- Prefer a project-administration list helper so the page does not mix custom project-admin visibility into capture/review list logic.

Project detail:

- Preserve the existing full operational detail page for owner/admin, assigned photographers, and Feature 082 reviewers.
- Add a narrow project-administration branch for users who have project-admin read visibility but do not have operational project/workspace access.
- The narrow branch may show project metadata, workspace metadata, and staffing controls when `canManageProjectWorkspaces` is true.
- It must not query or render participants, invites, consents, assets, matching, workflow controls, correction controls, reviewer access assignment controls, custom-role assignment controls, or member-management controls.
- If a user has both operational access and `project_workspaces.manage`, the existing full page may render, with staffing controls controlled by the custom-aware project workspace management check.

Workspace/staffing UI:

- Replace `staffingMutationsAllowed = projectPermissions.canManageMembers && ...` with a custom-aware project workspace management gate.
- Keep active/not-finalized workflow gates.
- Load assignable photographer members through a narrow server-side helper that returns only the fields needed by `ProjectWorkspaceStaffingForm`: photographer user id and email.
- Do not use `getTenantMemberManagementData(...)` for staffing.
- Do not expose custom role assignment data or reviewer access data to workspace managers.

Reviewer access UI:

- Keep `ProjectReviewerAccessPanel` hidden unless the user has existing fixed owner/admin reviewer-access authority.
- Do not make it visible for `project_workspaces.manage`.

Members UI:

- Keep Members nav and `/members` unchanged.

Design/i18n:

- Follow `UNCODEXIFY.md`: no dashboard redesign, no IAM matrix, no decorative access console.
- Use existing page structure, tables, forms, and buttons.
- Avoid new copy. If a read-only narrow project-admin state needs text, add English and Dutch translation keys following the existing message structure.

## Security and tenant-isolation plan

Security invariants:

- Tenant id remains server-derived from session/membership.
- Client never supplies trusted `tenant_id`.
- Service-role reads, if used for narrow photographer lookup, must happen only after a custom-aware server-side authorization check.
- Custom role enforcement remains additive only.
- No deny/override permissions are introduced.
- Revoked assignments deny access.
- Archived role definitions deny access.
- Cross-tenant role definitions/assignments deny access.
- Project-scoped and workspace-scoped custom-role assignments do not grant tenant-level Feature 087 capabilities.
- Owner/admin fixed roles keep current authority.
- Owner rows remain immutable through normal member-management paths.
- Owner remains non-inviteable.

Avoid broad helper expansion:

- Do not add project-admin custom roles to `app.current_user_can_access_project(...)`.
- Do not add project-admin custom roles to `app.current_user_can_access_project_workspace(...)`.
- Do not add project-admin custom roles to capture/review/workflow/correction TypeScript guards.

Race/retry considerations:

- Project creation remains a normal insert. Feature 087 should not add side-effect assignments that would create partial-failure concerns.
- Workspace creation remains idempotent enough for retries through existing lookup-before-insert and conflict lookup behavior.
- Concurrent assignment revocation/role archiving should deny on the next helper evaluation because helpers check `revoked_at` and `archived_at` at read time.
- If a custom role is revoked between page render and POST, the POST guard and SQL policy must deny.

## SQL/RLS and TypeScript parity plan

For `projects.create`:

- TypeScript custom-aware project creation guard and SQL `app.current_user_can_create_projects(...)` must agree.
- `/api/projects` guard and the `projects` insert policy must agree.
- Project create route returning the new id must work under RLS for allowed custom-role project creators.
- Tests must cover fixed owner/admin, custom allowed, no-capability denied, revoked denied, archived denied, cross-tenant denied, project-scoped denied, and workspace-scoped denied.

For `project_workspaces.manage`:

- TypeScript custom-aware workspace-management guard and SQL `app.current_user_can_manage_project_workspaces(...)` must agree.
- `/api/projects/[projectId]/workspaces` guard and `project_workspaces` write policies must agree.
- UI visibility and route authority must agree.
- Tests must cover fixed owner/admin, custom allowed, no-capability denied, revoked denied, archived denied, cross-tenant denied, project-scoped denied, and workspace-scoped denied.

For narrow read visibility:

- Project list/detail access for custom project administrators must be backed by explicit project-admin read logic.
- Tests must prove project-admin read does not imply `current_user_can_access_project(...)` or `current_user_can_access_project_workspace(...)`.
- Tests must prove custom project administrators cannot read/write unrelated capture/review/correction surfaces through existing helpers.

## Test plan

Project creation tests:

- Fixed owner/admin can still create projects.
- Fixed reviewer/photographer without custom capability cannot create projects.
- Active tenant-scoped custom role with `projects.create` can create a project through the planned TypeScript/API path.
- SQL/RLS allows project insert only for fixed owner/admin or custom `projects.create`.
- No-capability custom role cannot create projects.
- Revoked assignment cannot create projects.
- Archived role cannot create projects.
- Cross-tenant assignment cannot create projects.
- Project-scoped assignment cannot create projects.
- Workspace-scoped assignment cannot create projects.
- Custom `projects.create` can read the project row it created, enough for the existing redirect.
- Custom `projects.create` does not grant project workspace management.
- Custom `projects.create` does not grant member management, capture, review, correction, finalization, Media Library, templates, or profiles.

Project workspace management tests:

- Fixed owner/admin can still manage workspaces.
- Fixed reviewer/photographer without custom capability cannot manage workspaces.
- Active tenant-scoped custom role with `project_workspaces.manage` can create/manage photographer workspaces through the planned TypeScript/API path.
- SQL/RLS allows project workspace writes only for fixed owner/admin or custom `project_workspaces.manage`.
- No-capability custom role cannot manage workspaces.
- Revoked assignment cannot manage workspaces.
- Archived role cannot manage workspaces.
- Cross-tenant assignment cannot manage workspaces.
- Project-scoped assignment cannot manage workspaces.
- Workspace-scoped assignment cannot manage workspaces.
- Custom `project_workspaces.manage` can read project/workspace staffing metadata.
- Custom `project_workspaces.manage` does not make `app.current_user_can_access_project(...)` true.
- Custom `project_workspaces.manage` does not make `app.current_user_can_access_project_workspace(...)` true.
- Custom `project_workspaces.manage` does not grant project creation.
- Custom `project_workspaces.manage` does not grant reviewer access assignment management.
- Custom `project_workspaces.manage` does not grant member management, capture, review, correction, finalization, Media Library, templates, or profiles.

UI tests:

- Project create form appears for effective `projects.create`.
- Project create form remains hidden for denied users.
- Workspace staffing form appears for effective `project_workspaces.manage` under the chosen narrow read model.
- Reviewer access panel remains hidden unless the user has existing reviewer-access management authority.
- Members nav remains hidden for Feature 087 custom-role-only users.
- Media Library, Templates, and Profiles nav behavior from Features 085 and 086 is unchanged.

Regression tests:

- Feature 082 reviewer access assignment tests.
- Feature 084 custom role assignment foundation tests, updated so `projects.create` and `project_workspaces.manage` are no longer expected to be non-enforcing while unrelated custom-role capabilities remain non-enforcing.
- Feature 085 Media Library custom-role enforcement tests.
- Feature 086 template/profile custom-role enforcement tests.
- Representative Feature 070 member-management tests.

## Fresh reset/dev data plan

Assume local development can use `supabase db reset`.

Do not preserve, repair, backfill, or normalize arbitrary old local custom-role rows. Do not add seed custom roles.

Tests should create their own:

- tenants,
- memberships,
- custom role definitions,
- capability mappings,
- active tenant-scoped assignments,
- revoked assignments,
- archived roles,
- cross-tenant roles,
- project-scoped assignments,
- workspace-scoped assignments,
- projects,
- workspaces.

## Risks and edge cases

Project access blast radius:

- The biggest risk is accidentally broadening `current_user_can_access_project(...)` or `current_user_can_access_project_workspace(...)`, which would expose capture/review/correction tables. The implementation must use narrow project-admin read helpers instead.

Create redirect:

- `CreateProjectForm` redirects to `/projects/[projectId]`. Custom-role project creators must be able to read the created project row or the redirect becomes a 404. Use a narrow created-by project read rule, not broad project access.

Workspace manager usability:

- `project_workspaces.manage` should be useful without requiring existing reviewer/photographer access. The narrow admin read branch provides project and workspace metadata for staffing without exposing operational project data.

Hidden fixed-role checks:

- The extra owner/admin route check in `POST /api/projects/[projectId]/workspaces` will block custom workspace managers if left in place.

Photographer lookup:

- Workspace managers need a list of assignable photographers. Load only user id and email after authorization. Do not expose full member-management data.

Revocation race:

- If an assignment is revoked or a role archived after page render, route guards and SQL policies must re-check and deny.

Partial failures:

- Do not create role assignments as side effects of project creation. This keeps project creation from becoming a multi-write authorization bootstrap flow.

## Implementation phases

1. Targeted verification and dependency cleanup
   - Reconfirm the current select policies for `projects` and `project_workspaces`.
   - Decide the smallest dependency adjustment needed so project-administration TypeScript helpers can call the shared tenant custom-role helper without a circular dependency.

2. SQL allowlist and project-admin SQL helpers
   - Create a new migration.
   - Extend `app.current_user_has_tenant_custom_role_capability(...)` with `projects.create` and `project_workspaces.manage`.
   - Redefine `app.current_user_can_create_projects(...)`.
   - Redefine `app.current_user_can_manage_project_workspaces(...)`.
   - Add narrow project-administration read helper.
   - Update only `projects` and `project_workspaces` policies needed for project-admin metadata read/write.
   - Preserve Media Library, template, and profile helper behavior.

3. TypeScript project-administration authorizers
   - Extend `ENFORCED_TENANT_CUSTOM_ROLE_CAPABILITIES`.
   - Add project-administration resolver/guards for create and workspace management.
   - Keep helper comments bounded so future work does not treat it as a generic permission engine.

4. Project creation API and UI
   - Update `/api/projects` to use the custom-aware create guard.
   - Update `/projects` create form visibility to use project-administration access.
   - Preserve existing form structure and copy.
   - Do not create assignment rows after project creation.

5. Project workspace/staffing API and UI
   - Update `/api/projects/[projectId]/workspaces` to rely on the custom-aware central guard.
   - Remove the extra fixed owner/admin check.
   - Add narrow staffing data loading for workspace managers.
   - Show `ProjectWorkspaceStaffingForm` for effective `project_workspaces.manage` and existing active/not-finalized gates.
   - Keep `ProjectReviewerAccessPanel` fixed owner/admin only.
   - Add the narrow project-admin detail branch if the user lacks operational project/workspace access.

6. Parity and non-expansion tests
   - Add focused tests for `projects.create`.
   - Add focused tests for `project_workspaces.manage`.
   - Add SQL/RLS parity tests.
   - Add UI visibility tests.
   - Add non-expansion tests for member management, capture, review, workflow, correction, Media Library, templates, and profiles.

7. Regression run
   - Run Feature 082 reviewer access assignment tests.
   - Run Feature 084 custom role assignment tests.
   - Run Feature 085 Media Library tests.
   - Run Feature 086 template/profile tests.
   - Run representative Feature 070 tenant RBAC/member-management tests.

## Clear scope boundaries

Do not implement:

- `organization_users.*` custom-role enforcement.
- capture custom-role enforcement.
- review custom-role enforcement.
- workflow/finalization custom-role enforcement.
- correction custom-role enforcement.
- project-scoped custom-role enforcement.
- workspace-scoped custom-role enforcement.
- generic effective capability resolution.
- invite-to-custom-role.
- Members page redesign.
- owner transfer/demotion.
- project default template authorization changes.
- Media Library helper refactor unless directly required to compile Feature 087 changes.

Do preserve:

- fixed owner/admin authority,
- owner row immutability,
- owner role non-inviteability,
- Feature 082 reviewer assignment enforcement,
- tenant-wide and project-scoped system reviewer behavior,
- photographer assigned-workspace capture behavior,
- Feature 085 Media Library behavior,
- Feature 086 template/profile behavior,
- tenant custom roles as additive only,
- all tenant scoping and server-derived tenant id rules.

## Concise implementation prompt

Implement Feature 087 exactly as planned in `docs/rpi/087-tenant-level-project-administration-custom-role-enforcement/plan.md`.

Enforce tenant-scoped custom roles only for `projects.create` and `project_workspaces.manage`. Extend the TypeScript and SQL tenant custom-role allowlists with only those two keys. Add project-administration-specific TypeScript authorization and narrow SQL project-admin read/write helpers. Do not broaden `app.current_user_can_access_project(...)` or `app.current_user_can_access_project_workspace(...)`. Keep organization-user/member-management, capture, review, workflow, correction, Media Library, template/profile, project default template, project-scoped custom-role, and workspace-scoped custom-role behavior unchanged.

Use a narrow project-administration read model: custom `project_workspaces.manage` users can see project/workspace staffing metadata, and custom `projects.create` users can read projects they created. Update project create UI/API and project workspace staffing UI/API accordingly, remove hidden owner/admin-only workspace route checks, keep reviewer access controls fixed owner/admin, and add parity/non-expansion tests plus regression coverage for Features 082, 084, 085, and 086.
