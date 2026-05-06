# Current User RLS Scope Audit

Date: 2026-05-01

## Scope and Safety Statement

This was a read-only repository investigation for current-user scoping bugs caused by relying on RLS-visible rows instead of explicitly filtering to the authenticated user.

No application code, migrations, tests, or runtime behavior were changed. No database reset or destructive command was run. No local secret files were inspected. This report is the only file created for the investigation.

The audit focused on code paths where active tenant, current membership, current role, effective permissions, reviewer access, photographer workspaces, personal dashboards, invite acceptance, or "my access" behavior could accidentally consume rows that are visible through RLS but do not belong to the authenticated user.

## Executive Summary

The confirmed bug pattern exists in two root active-tenant helpers:

- `src/lib/tenant/resolve-tenant.ts::loadCurrentUserMemberships`
- `src/lib/tenant/active-tenant.ts::listCurrentUserTenantMemberships`

Both helpers query `memberships` without filtering by the authenticated user's `user_id`. Since later RLS policies intentionally allow owners/admins and delegated organization-user managers to see other users' membership rows, these helpers can treat another user's membership row as the current user's tenant state.

Most other inspected current-user authorization paths are safe because they require an explicit `userId` and filter by it before deriving role, assignment, reviewer access, custom-role capability, or photographer workspace access. Broad membership and assignment queries do exist, but the inspected ones are primarily admin/team management views and are separated from current-user permission resolution.

No additional likely bug was confirmed from live code without product clarification. One dashboard area needs product clarification because it lists recent projects by active tenant and RLS visibility rather than explicitly mirroring the `/projects` page's role-aware list behavior.

## Confirmed Bug Pattern

RLS answers whether the authenticated user may see a row. It does not answer whether the row belongs to that user.

The dangerous pattern is:

1. A helper name or caller intent says "current user", "my tenant", "my membership", or "my access".
2. The query reads rows from a table such as `memberships` or `role_assignments`.
3. The query relies on RLS and does not filter by the authenticated user's id.
4. The result is used as personal state, active tenant state, current role, current assignment, or current permission state.

That pattern became unsafe once RLS intentionally widened row visibility for owners/admins and delegated organization-user managers.

## Files and RPI Docs Reviewed

Required context reviewed:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/SUMMARY.md`
- `docs/rpi/PROMPTS.md`

Relevant RPI directories reviewed or searched for intent and historical boundaries:

- `docs/rpi/060-tenant-resolution-hardening/`
- `docs/rpi/070-tenant-rbac-and-organization-user-management-foundation/`
- `docs/rpi/072-project-staffing-photographer-scoped-capture-workspaces-and-bounded-project-workflow-permissions/`
- `docs/rpi/080-advanced-organization-access-management-foundation/`
- `docs/rpi/081-custom-role-definitions-and-scoped-role-assignment-foundation/`
- `docs/rpi/082-project-scoped-reviewer-assignments-and-enforcement/`
- `docs/rpi/083-custom-role-editor-foundation/`
- `docs/rpi/084-custom-role-assignment-foundation/`
- `docs/rpi/085-custom-role-media-library-enforcement/`
- `docs/rpi/086-custom-role-template-profile-enforcement/`
- `docs/rpi/087-tenant-level-admin-permission-consolidation/`
- `docs/rpi/088-organization-user-management-custom-role-enforcement/`
- `docs/rpi/089-organization-user-role-change-and-removal-custom-role-enforcement/`
- `docs/rpi/090-role-administration-delegation/`
- `docs/rpi/091-owner-admin-role-administration-consolidation/`
- `docs/rpi/092-capability-scope-semantics-and-permission-migration-map/`
- `docs/rpi/093-scoped-custom-role-assignment-foundation/`
- `docs/rpi/094-effective-scoped-permission-resolver-foundation/`
- `docs/rpi/095-operational-permission-resolver-enforcement/`
- `docs/rpi/096-permission-cleanup-and-effective-access-ui/`

Key live code reviewed:

- `src/lib/tenant/active-tenant.ts`
- `src/lib/tenant/resolve-tenant.ts`
- `src/lib/tenant/tenant-cookies.ts`
- `src/lib/tenant/active-tenant-route-handler.ts`
- `src/app/select-tenant/page.tsx`
- `src/app/(protected)/layout.tsx`
- `src/app/(protected)/dashboard/page.tsx`
- `src/app/(protected)/projects/page.tsx`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/lib/tenant/tenant-membership.ts`
- `src/lib/tenant/permissions.ts`
- `src/lib/tenant/effective-permissions.ts`
- `src/lib/tenant/reviewer-access-service.ts`
- `src/lib/tenant/custom-role-assignment-service.ts`
- `src/lib/tenant/member-management-service.ts`
- `src/lib/tenant/member-effective-access-service.ts`
- `src/lib/tenant/organization-user-access.ts`
- `src/lib/tenant/role-assignment-foundation.ts`
- `src/lib/tenant/media-library-custom-role-access.ts`
- `src/lib/projects/project-administration-service.ts`
- `src/lib/projects/project-workspaces-service.ts`
- `src/lib/projects/project-workspace-request.ts`
- `src/lib/tenant/membership-invites.ts`

Key migrations reviewed or searched:

- `supabase/migrations/20260304211000_002_projects_invites_rls.sql`
- `supabase/migrations/20260423090000_070_tenant_rbac_membership_invites_foundation.sql`
- `supabase/migrations/20260430120000_081_role_assignment_foundation.sql`
- `supabase/migrations/20260430130000_082_reviewer_access_assignment_enforcement.sql`
- `supabase/migrations/20260430180000_088_organization_user_invite_custom_role_enforcement.sql`
- `supabase/migrations/20260501120000_089_organization_user_role_change_remove_custom_role_enforcement.sql`
- `supabase/migrations/20260501130000_094_scoped_custom_role_capability_helper.sql`
- `supabase/migrations/20260501150000_095_effective_permission_enforcement.sql`

Key tests reviewed or searched:

- `tests/feature-060-tenant-resolution-hardening.test.ts`
- `tests/feature-070-active-tenant-route.test.ts`
- `tests/feature-070-tenant-rbac-foundation.test.ts`
- `tests/feature-082-reviewer-access-assignments.test.ts`
- `tests/feature-094-effective-scoped-permission-resolver-foundation.test.ts`
- `tests/feature-096-permission-cleanup-and-effective-access-ui.test.ts`

## Search Strategy Used

`rg` was unavailable in this local shell, so repository search used PowerShell `Select-String` over `src`, `tests`, and `supabase`.

Searches included:

- `from("memberships")` and `from('memberships')`
- `from("role_assignments")` and `from('role_assignments')`
- `photographer_user_id`, `assigned_user_id`, `invited_by_user_id`, `accepted_by_user_id`, `created_by`, `updated_by`, `revoked_by_user_id`, `user_id`, `member_user_id`, `profile_user_id`, `owner_user_id`
- `listCurrent`, `getCurrent`, `currentUser`, `activeTenant`, `resolveTenant`, `ensureTenant`, `membership`, `my`, `reviewer`, `photographer`, `workspace`, `assignment`, `permission`, `access`
- `auth.getUser`, `getUser(`, `auth.uid()`
- `selectActiveTenant`, `active_tenant_required`, `sc_active_tenant`, `setActiveTenant`
- `.single()`, `.maybeSingle()`, `.limit(1)` around high-risk membership and assignment reads

The search results were followed through call chains where query intent was not clear from the file name alone.

## Findings Table

| ID | Area | File/function | Pattern found | Classification | Risk | Recommended next step |
| --- | --- | --- | --- | --- | --- | --- |
| CUR-001 | Active tenant resolution | `src/lib/tenant/resolve-tenant.ts::loadCurrentUserMemberships`, called by `resolveTenantIdWithRecovery` | Selects `memberships.tenant_id, created_at` ordered by `created_at` with no authenticated user lookup and no `user_id` filter; result drives active tenant selection and `active_tenant_required`. | Confirmed bug | High | Start a focused RPI fix to derive the auth user server-side and filter memberships by `user_id`; add owner/admin and delegated visibility regression tests. |
| CUR-002 | Active tenant options | `src/lib/tenant/active-tenant.ts::listCurrentUserTenantMemberships`, used by `src/app/select-tenant/page.tsx` and `src/app/(protected)/layout.tsx` | Selects visible `memberships` rows with no `user_id` filter, then renders/selects tenant options as current-user state. | Confirmed bug | High | Make the helper require or derive the authenticated user id and filter by it; dedupe tenant options only after the current-user filter. |
| CUR-003 | Tenant member management | `src/lib/tenant/member-management-service.ts::getTenantMemberManagementData` | Broad member and pending invite directory after fixed owner/admin manager check. | Safe intentional broad query | Low | Keep broad admin listing separate from current-user membership helpers. |
| CUR-004 | Organization user directory | `src/lib/tenant/member-management-service.ts::getOrganizationUserDirectoryData` | Broad membership/invite listing when `resolveOrganizationUserAccess` grants directory visibility; otherwise invite fallback filters by `invited_by_user_id`. | Safe intentional broad query | Low | Keep delegated directory reads separate from active/current-user resolution. |
| CUR-005 | Reviewer tenant access management | `src/lib/tenant/reviewer-access-service.ts::listReviewerAccessSummary` | Broad reviewer membership and role-assignment summary after manager authorization. | Safe intentional broad query | Low | Keep as admin summary; do not reuse for "my reviewer access". |
| CUR-006 | Project reviewer assignment management | `src/lib/tenant/reviewer-access-service.ts::listProjectReviewerAssignments` | Broad eligible reviewer and assignment listing for a project management surface. | Safe intentional broad query | Low | Keep separate from `resolveEffectiveReviewerAccessForTenant/Project`. |
| CUR-007 | Custom role assignment management | `src/lib/tenant/custom-role-assignment-service.ts::listCustomRoleAssignmentsForMembers` | Broad custom-role assignment listing after owner/admin member-manager assertion. | Safe intentional broad query | Low | Keep admin-only; avoid feeding results into current-user capability checks. |
| CUR-008 | Member effective access admin summary | `src/lib/tenant/member-effective-access-service.ts::getMemberEffectiveAccessSummary` | Owner/admin target-user summary uses broad admin summaries but filters to explicit `targetUserId`. | Safe intentional broad query | Low | Keep target user explicit; preserve owner/admin-only access. |
| CUR-009 | Project administration and staffing | `src/lib/projects/project-administration-service.ts`, `src/lib/projects/project-workspaces-service.ts` | Broad project/workspace/photographer lists are used for users with administration or staffing capabilities; photographer personal workspace paths filter by `photographer_user_id`. | Safe intentional broad query | Low | Keep admin/staffing lists separate from photographer personal views. |
| CUR-010 | Role assignment foundation helper | `src/lib/tenant/role-assignment-foundation.ts::listRoleAssignments` and `listRoleAssignmentsForUser` | Private helper loads tenant assignments broadly; `listRoleAssignmentsForUser` filters in memory by `userId` before current-user use. | Naming/comment clarity issue | Medium | In a future cleanup, rename the broad helper or push the `user_id` filter into the database query for the user-specific helper. |
| CUR-011 | Dashboard recent projects | `src/app/(protected)/dashboard/page.tsx` | Lists recent projects for the active tenant using project RLS visibility, not the explicit role-aware `/projects` listing behavior. | Needs product decision | Medium | Decide whether the dashboard is team-wide or "my accessible projects"; if personal, reuse the explicit projects visibility logic. |
| CUR-012 | Workspace permission compatibility label | `src/lib/projects/project-workspace-request.ts::buildWorkspacePermissionsForCapability` | Effective/custom-role/reviewer review-like grants can be labeled `reviewAccessSource: "owner_admin"` in a compatibility object. | Naming/comment clarity issue | Low | Rename or make the source label capability-based when compatibility code is revisited. |

## Detailed Findings

### Active Tenant And Tenant Resolution

#### CUR-001 - Active tenant resolution uses RLS-visible memberships as current-user memberships

`src/lib/tenant/resolve-tenant.ts::loadCurrentUserMemberships` selects:

```ts
supabase
  .from("memberships")
  .select("tenant_id, created_at")
  .order("created_at", { ascending: true });
```

It does not call `auth.getUser()`, does not accept a `userId`, and does not filter by `user_id`.

`resolveTenantIdWithRecovery` uses those rows as the current user's membership set. If there is one visible row, it returns that tenant. If there are multiple visible rows without a valid active-tenant cookie, it throws `active_tenant_required`. If the cookie tenant is present in the visible rows, it accepts the cookie.

RLS may additionally expose:

- the user's own membership rows through the original own-row policy;
- other member rows in tenants where the user is owner/admin through `memberships_select_manage_member_rows`;
- other member rows in tenants where the user has delegated organization-user visibility through `memberships_select_organization_user_rows`.

The result is used as current-user active tenant state, not as an admin directory. That is unsafe. An owner/admin with exactly one tenant but multiple visible member rows in that tenant can be treated as having multiple memberships and hit `active_tenant_required`. A visible row for another user can also validate an active tenant cookie or drive a first-row selection as if it belonged to the current user.

Existing tests in `tests/feature-060-tenant-resolution-hardening.test.ts` exercise resolution behavior through mocked membership arrays, but they do not assert that the live default membership query filters by the authenticated user's `user_id`. The missing test is an owner/admin or delegated organization-user scenario where RLS exposes another user's membership row and tenant resolution must ignore it.

Recommended fix direction:

- Derive the authenticated user server-side or require a trusted `userId` argument.
- Filter `memberships` with `.eq("user_id", user.id)` before resolving active tenant state.
- Keep the existing recovery behavior, but only after current-user rows have been loaded.

Recommended tests:

- Owner with one own membership and one other visible member row in the same tenant should resolve to the tenant without `active_tenant_required`.
- Owner/admin with another user's reviewer row visible should not have the reviewer row influence selected tenant or role.
- Delegated organization-user manager with broad membership visibility should still resolve only their own membership rows.
- A stale active tenant cookie should only be accepted if the authenticated user has a matching membership row.

#### CUR-002 - Active tenant option list uses RLS-visible memberships as current-user options

`src/lib/tenant/active-tenant.ts::listCurrentUserTenantMemberships` selects:

```ts
supabase
  .from("memberships")
  .select("tenant_id, role, created_at")
  .order("created_at", { ascending: true });
```

It does not call `auth.getUser()`, does not accept a `userId`, and does not filter by `user_id`.

The helper name and call sites make the intended semantics current-user-only:

- `src/app/select-tenant/page.tsx` authenticates a user, then calls `listCurrentUserTenantMemberships(supabase)` and renders or redirects based on the result.
- `src/app/(protected)/layout.tsx` authenticates a user, calls `ensureTenantId(supabase)`, then calls `listCurrentUserTenantMemberships(supabase)` to render `ActiveTenantSwitcher`.

RLS may expose other users' membership rows for owners/admins or delegated organization-user managers. Those rows can appear as selectable tenants or show another user's role as if it were the current user's tenant option. If a second visible member row belongs to the same tenant, the UI can also duplicate the tenant with the other member's role.

Existing route tests in `tests/feature-070-active-tenant-route.test.ts` cover the POST guard and verify that selected tenant validation passes the authenticated `userId` into `currentUserHasTenantMembership`. They do not cover the option-list helper.

Recommended fix direction:

- Make the helper require a trusted authenticated user id or derive it internally.
- Filter `memberships` by `.eq("user_id", user.id)`.
- If tenant option deduplication is needed, perform it after the explicit current-user filter.

Recommended tests:

- Active tenant switcher data for an owner/admin must include only the owner's membership row, not visible reviewer/photographer/member rows.
- The select-tenant page should not redirect to `active_tenant_required` solely because other users' rows are visible.
- The displayed role for a tenant option must be the authenticated user's role.

#### Safe active tenant route guard

`src/lib/tenant/active-tenant-route-handler.ts::handleSetActiveTenantPost` gets the authenticated user with `supabase.auth.getUser()` and validates the requested tenant through `currentUserHasTenantMembership`.

`src/lib/tenant/active-tenant.ts::currentUserHasTenantMembership` selects `memberships.id` with both:

- `.eq("user_id", userId)`
- `.eq("tenant_id", tenantId)`

This is the correct pattern for current-user membership validation. It should be reused as the model for the read-side tenant resolution helpers.

### Current Membership, Role, And Permission Helpers

`src/lib/tenant/tenant-membership.ts::getTenantMembershipRole` filters by both `tenant_id` and `user_id`. `resolveTenantMembership` builds on that helper and returns the authenticated user's role for the tenant.

`src/lib/tenant/permissions.ts` uses `resolveTenantMembership(supabase, tenantId, userId)` before deriving fixed role permissions, reviewer access, accessible workspaces, and workspace permissions.

`src/lib/tenant/effective-permissions.ts::resolveEffectiveCapabilities` requires `tenantId` and `userId` in its input. The inspected current-user sources are explicit:

- tenant membership is resolved through `resolveTenantMembership(input.supabase, input.tenantId, input.userId)`;
- reviewer `role_assignments` are loaded with `.eq("tenant_id", context.tenantId)` and `.eq("user_id", context.userId)`;
- custom role `role_assignments` are loaded with `.eq("tenant_id", context.tenantId)` and `.eq("user_id", context.userId)`;
- photographer workspace capability is only granted when `workspace.photographer_user_id === context.userId`.

No current-user RLS-visible-row bug was found in these helpers.

Relevant test coverage:

- `tests/feature-082-reviewer-access-assignments.test.ts`
- `tests/feature-094-effective-scoped-permission-resolver-foundation.test.ts`
- `tests/feature-096-permission-cleanup-and-effective-access-ui.test.ts`

These tests cover explicit reviewer assignments, photographer workspace access, custom-role scoped capability resolution, and operational enforcement.

### Organization Users And Member Management

#### CUR-003 - Owner/admin member directory is a safe broad query

`src/lib/tenant/member-management-service.ts::getTenantMemberManagementData` first calls `assertTenantMemberManager(input.supabase, input.tenantId, input.userId)`. That assertion resolves permissions for the authenticated user and requires owner/admin member-management capability.

After that, it broadly lists:

- `memberships` by `tenant_id`;
- pending `tenant_membership_invites` by `tenant_id` and status.

The result is an organization member directory, not current-user state. This broad query is intentional and safe as long as it is not reused by active tenant or current-role logic.

Recommended tests:

- Existing member-management tests should continue to assert owner/admin access.
- No new current-user RLS regression test is required here unless the data is later reused by personal state helpers.

#### CUR-004 - Delegated organization user directory is a safe broad query

`src/lib/tenant/member-management-service.ts::getOrganizationUserDirectoryData` calls `resolveOrganizationUserAccess` for the authenticated actor. `resolveOrganizationUserAccess` uses explicit `tenantId` and `userId` and resolves custom-role organization-user capabilities for that user.

When the actor can view organization users, the service broadly lists member rows and invite rows for the directory. When the actor cannot view organization users, the invite fallback filters reviewer/photographer pending invites by `.eq("invited_by_user_id", input.userId)`.

This is an intended admin/delegated directory flow. It is safe from the current-user membership bug because directory results are not used to derive the actor's own role or active tenant.

Recommended tests:

- Keep tests that separate owner/admin directory access from delegated organization-user access.
- Add a guard test if future code attempts to feed directory rows into current-user role, active tenant, or permission state.

### Reviewer Access And Role Assignments

#### Safe current-user reviewer access resolution

`src/lib/tenant/reviewer-access-service.ts::loadMembership` filters `memberships` by both `tenant_id` and `user_id`.

`resolveEffectiveReviewerAccessForTenant` validates the target user through that explicit membership lookup and then loads reviewer role assignments through a service-role client with `.eq("tenant_id", input.tenantId)` and `.eq("user_id", input.userId)`.

`resolveEffectiveReviewerAccessForProject` builds on tenant access and keeps the user id explicit.

No current-user RLS-visible-row bug was found in these resolver paths.

#### CUR-005 and CUR-006 - Reviewer admin summaries are safe broad queries

`listReviewerAccessSummary` and `listProjectReviewerAssignments` intentionally read across reviewer memberships and reviewer role assignments for management UI. They are protected by manager checks and project/tenant validation.

These are admin-visible summaries, not "my reviewer access" helpers. The key safety boundary is that current-user permission and reviewer access code uses `resolveEffectiveReviewerAccessForTenant/Project`, not these broad summaries.

Recommended tests:

- Keep tests that prove reviewer access grants are manager-only, role-gated, tenant-scoped, and idempotent.
- Add regression coverage if a personal reviewer dashboard is introduced: it must use explicit `userId` filters, not admin summaries.

### Custom Roles, Effective Access, And Assignment Management

#### CUR-007 - Custom role assignment management is a safe broad query

`src/lib/tenant/custom-role-assignment-service.ts::listCustomRoleAssignmentsForMembers` calls `assertTenantMemberManager` before loading tenant-wide role assignments for a member-management surface.

This is a safe broad admin query. Current-user custom role resolution elsewhere uses explicit `userId` filters in `effective-permissions.ts` and `tenant-custom-role-capabilities.ts`.

Recommended tests:

- Keep owner/admin and delegated-role administration tests separated from current-user capability tests.
- Add a regression test if custom-role assignment summaries are ever shown in a "my access" surface.

#### CUR-008 - Effective access admin summary is safe because the target user is explicit

`src/lib/tenant/member-effective-access-service.ts::getMemberEffectiveAccessSummary` is an owner/admin target-member inspection path. It accepts `targetUserId`, validates the actor, and filters broad summaries back to that explicit target:

- target member is loaded with explicit `targetUserId`;
- photographer workspace assignments filter by `.eq("photographer_user_id", input.userId)` in the lower-level loader;
- reviewer summary and custom-role assignment summary are broad admin summaries, then selected by `targetUserId`.

This is safe because it is an admin explanation of a named target user, not the actor's own current-user state.

Recommended tests:

- Keep existing tests that only owner/admin can read effective access summary details.
- Add a regression if delegated organization-user views are ever allowed to see source metadata, because RPI 096 intentionally keeps those boundaries conservative.

#### CUR-010 - Role assignment foundation helper is safe today but easy to misuse

`src/lib/tenant/role-assignment-foundation.ts::listRoleAssignments` loads role assignments broadly by tenant. `listRoleAssignmentsForUser` then filters in memory by `assignment.userId === userId`, and `resolveDurableRoleAssignments` consumes that filtered result.

The inspected current-user call chain is safe because filtering happens before use. The risk is maintainability: the private helper name does not advertise that it returns all tenant assignments, and future current-user code could accidentally consume the broad helper directly.

Recommended fix direction:

- In future cleanup work, rename the broad helper to make tenant-wide scope explicit.
- Prefer pushing `.eq("user_id", userId)` into the database query for `listRoleAssignmentsForUser`.

Recommended tests:

- Add a unit test around `listRoleAssignmentsForUser` with another user's visible assignment and assert it is excluded.
- If the helper is refactored, assert the generated Supabase query includes the user filter.

### Project, Photographer Workspace, And Capture Flows

`src/lib/projects/project-workspaces-service.ts::listVisibleProjectWorkspaces` resolves the authenticated user's tenant membership with explicit `tenantId` and `userId`. It then evaluates visibility through effective permissions. Photographer workspace access is tied to `photographer_user_id === userId`.

`src/app/(protected)/projects/page.tsx` inherits active tenant resolution from `resolveTenantId`, but after that it uses explicit user checks:

- owner/admin or tenant-wide project users get a broad tenant project list;
- photographers load workspaces with `.eq("photographer_user_id", user.id)`;
- reviewers call `resolveEffectiveReviewerAccessForTenant({ userId: user.id })`.

`src/lib/projects/project-administration-service.ts` separates administration/staffing behavior from personal photographer behavior. Broad assignable photographer lists are used only for users with project administration or workspace management capability.

No additional current-user RLS-visible-row bug was found in project or photographer workspace services beyond the inherited active-tenant resolution bug.

Recommended tests:

- Existing photographer workspace and effective permission tests should remain focused on `photographer_user_id`.
- Add active-tenant regression tests so project pages cannot inherit another visible user's tenant state.

### Dashboard, Queues, And Counters

#### CUR-011 - Dashboard recent projects needs product clarification

`src/app/(protected)/dashboard/page.tsx` authenticates the user, resolves the active tenant through `resolveTenantId`, then lists recent projects:

```ts
supabase
  .from("projects")
  .select("id, title, created_at")
  .eq("tenant_id", tenantId)
  .order("created_at", { ascending: false })
  .limit(5);
```

This query does not derive current-user role or assignment state from project rows. However, it relies on project RLS visibility rather than the explicit role-aware branching used by `src/app/(protected)/projects/page.tsx`.

If the dashboard is intended to be a team-wide tenant dashboard, this can be acceptable for users whose RLS visibility is intentionally broad. If the dashboard is intended to mean "my recent projects" or "my accessible projects", it should reuse the same explicit access logic as the projects page.

This is not classified as a confirmed current-user RLS scope bug because the UI intent is ambiguous and the query is not used to derive user identity, role, membership, or permissions.

Recommended product decision:

- Decide whether the dashboard recent projects section is tenant-wide or personal/access-scoped.

Recommended tests if product chooses personal/access-scoped:

- Photographer should only see projects for workspaces assigned to that photographer.
- Project-scoped reviewer should only see assigned review projects.
- Tenant-wide reviewer/custom-role user should see only projects allowed by effective capability.
- Owner/admin should continue to see broad tenant recent projects.

### Public Token And Invite Flows With Authenticated Context

The inspected membership invite flows use server-derived identity rather than client-supplied user identity.

Relevant SQL and TypeScript patterns:

- `app.accept_tenant_membership_invite` derives `v_user_id := auth.uid()`.
- Acceptance compares the authenticated user's normalized email to the token-bound invite email.
- Existing membership checks are tied to `m.user_id = v_user_id`.
- Accepted memberships are inserted for `v_user_id`.
- Admin/delegated invite create, refresh, and revoke flows derive actor identity with `auth.uid()` and use capability checks.
- TypeScript service code treats invite token values as server-side/public-token inputs and does not print token hashes or secrets.

No current-user RLS-visible-row bug was found in the inspected invite acceptance path.

Recommended tests:

- Existing invite tests should continue to cover wrong-email acceptance, already-member handling, expired/revoked invite behavior, and delegated invite boundaries.
- Add a regression only if invite acceptance starts consulting visible `memberships` rows outside the RPC.

### RLS Policies And SQL Helpers

The RLS widening that enables the confirmed bug is intentional:

- `20260423090000_070_tenant_rbac_membership_invites_foundation.sql` adds `memberships_select_manage_member_rows` for users who can manage members.
- `20260430180000_088_organization_user_invite_custom_role_enforcement.sql` adds `memberships_select_organization_user_rows` for users who can view organization users.
- `20260430120000_081_role_assignment_foundation.sql` adds broad `role_assignments` visibility for tenant managers.

Those policies are appropriate for admin and delegated management surfaces. The problem is application code treating the widened visibility as current-user ownership.

The inspected SQL helper functions for reviewer, photographer, and scoped custom-role access generally do the right thing:

- reviewer assignment helpers join through `memberships` with `m.user_id = auth.uid()`;
- photographer workspace helpers compare `pw.photographer_user_id = auth.uid()`;
- scoped custom-role capability helpers join assignments through the authenticated user's membership and `ra.user_id = auth.uid()`.

No SQL helper bug matching the active-tenant pattern was found in the inspected migrations.

## Safe Intentional Broad Queries Found

The following broad query groups are intentional and should stay broad unless product requirements change:

1. `getTenantMemberManagementData`: owner/admin member directory and pending invite list after manager assertion.
2. `getOrganizationUserDirectoryData`: delegated/admin organization user directory and invite visibility after explicit access resolution.
3. `listReviewerAccessSummary`: tenant reviewer access administration summary.
4. `listProjectReviewerAssignments`: project reviewer assignment administration surface.
5. `listCustomRoleAssignmentsForMembers`: custom-role assignment management summary.
6. `getMemberEffectiveAccessSummary`: owner/admin effective access summary for an explicit target user.
7. Project administration and staffing services: broad project/workspace/photographer lists for users with administration or staffing capability.
8. `role-assignment-foundation` tenant-wide loader: currently safe because current-user callers filter before use, but naming should be clarified.

The shared reason these are safe is that they are admin/team management surfaces or explicit target-user inspection flows. They do not answer "what belongs to the authenticated user?" unless an explicit user filter is applied before use.

## Confirmed Or Likely Bugs

### Confirmed bug count: 2

#### Confirmed bug 1: active tenant resolution

`resolveTenantId` and `ensureTenantId` can read other users' visible membership rows through `loadCurrentUserMemberships`. The active tenant resolver then treats those rows as the authenticated user's membership set.

Impact:

- owner/admin users can be forced into tenant selection because other member rows make the membership count appear greater than one;
- active tenant cookies can be accepted based on a row that is visible but not owned by the authenticated user;
- downstream protected pages inherit the wrong active-tenant decision or unnecessary `active_tenant_required` state.

#### Confirmed bug 2: active tenant option listing

`listCurrentUserTenantMemberships` can return other users' visible membership rows and roles as selectable tenant options.

Impact:

- active tenant switcher/select-tenant UI can show rows that do not belong to the current user;
- owner/admin users can see another member's reviewer/photographer/member role as if it were their own tenant option;
- duplicated tenant options can appear when multiple visible rows share the same tenant.

### Likely bug count: 0

No additional likely current-user RLS scope bug was identified from live code. The dashboard area below needs product clarification rather than bug classification.

## Areas That Need Product Clarification

### Dashboard recent projects

The dashboard recent projects list uses active tenant plus project RLS visibility. Product should decide whether the section is:

- a team-wide recent projects view for the active tenant; or
- a personal/access-scoped recent projects view that should mirror `/projects`.

If it is personal/access-scoped, it should use explicit current-user access logic rather than relying only on project RLS visibility.

### Organization user invite visibility

`getOrganizationUserDirectoryData` lets users with organization-user view capability see the broader pending invite directory. That appears consistent with the delegated directory model, while users without that capability fall back to invites they sent. If product intends delegated viewers to see less invite metadata than owner/admins, that should be clarified separately. It is not the same as the active-tenant current-user membership bug.

## Recommended Fix Direction Per Finding

| ID | Recommended fix direction |
| --- | --- |
| CUR-001 | Update tenant resolution to load only memberships for the authenticated user. Do not rely on RLS-visible `memberships` for current-user state. Preserve recovery behavior after the filter. |
| CUR-002 | Update active tenant option listing to require or derive authenticated `userId` and filter by it before loading tenant names or rendering roles. |
| CUR-003 | No fix. Keep as owner/admin broad directory. |
| CUR-004 | No fix. Keep delegated directory logic separate from current-user membership helpers. |
| CUR-005 | No fix. Keep reviewer admin summary separate from personal reviewer access resolver. |
| CUR-006 | No fix. Keep project reviewer assignment admin view broad by design. |
| CUR-007 | No fix. Keep custom-role assignment summary admin-only. |
| CUR-008 | No fix. Keep explicit `targetUserId` and owner/admin-only guard. |
| CUR-009 | No fix. Keep broad project/staffing admin reads separate from photographer personal reads. |
| CUR-010 | Future cleanup: rename broad role-assignment helper or push user filtering into the DB query for the user-specific helper. |
| CUR-011 | Product decision first. If personal/access-scoped, reuse `/projects` effective access logic. |
| CUR-012 | Future cleanup: replace misleading `owner_admin` compatibility source with a source-neutral or capability-based label. |

## Recommended Tests Per Finding

| ID | Recommended tests |
| --- | --- |
| CUR-001 | Add regression tests where owner/admin and delegated organization-user actors can see other membership rows through RLS but tenant resolution only considers their own `user_id`. Include stale active-tenant cookie acceptance tests. |
| CUR-002 | Add active tenant option tests proving other visible members' rows and roles are excluded from switcher/select-tenant data. |
| CUR-003 | Keep owner/admin directory authorization tests; add a guard only if directory results are reused by current-user helpers. |
| CUR-004 | Keep delegated organization-user access tests; add a guard if directory rows are reused to derive actor role or tenant state. |
| CUR-005 | Keep reviewer summary manager-only tests; add personal reviewer dashboard tests if a "my reviewer access" surface is introduced. |
| CUR-006 | Keep project reviewer assignment manager-only and tenant-scoped tests. |
| CUR-007 | Keep custom-role assignment admin tests; add personal access tests if assignment summaries are surfaced to the current user. |
| CUR-008 | Keep owner/admin-only effective access summary tests; assert target-user filtering when multiple users have assignments. |
| CUR-009 | Keep photographer `photographer_user_id` assignment tests and project admin capability tests separate. |
| CUR-010 | Add a unit test with another user's assignment visible and assert `listRoleAssignmentsForUser` excludes it. |
| CUR-011 | If product chooses personal/access-scoped dashboard, test owner/admin, photographer, project-scoped reviewer, tenant-wide reviewer, and custom-role access separately. |
| CUR-012 | Add a small compatibility test if the permission source label is changed so legacy callers still receive expected capabilities. |

## Suggested Priority Order For Follow-Up RPI Work

1. Create a focused active-tenant current-user filtering RPI.
2. Fix `resolveTenantId`/`ensureTenantId` membership loading to filter by authenticated `user_id`.
3. Fix `listCurrentUserTenantMemberships` and select-tenant/switcher callers to filter by authenticated `user_id`.
4. Add regression tests for owner/admin and delegated organization-user users who can see other membership rows.
5. Decide the dashboard recent projects semantics and create a separate RPI only if the dashboard should be personal/access-scoped.
6. Schedule a low-risk naming cleanup for broad role-assignment helper names and workspace permission source labels.

## Open Questions

1. Should active tenant options deduplicate by tenant after current-user filtering, or should the memberships table uniqueness invariant make duplicates impossible for a user and tenant?
2. Should `listCurrentUserTenantMemberships` derive `auth.getUser()` internally, or should callers pass a trusted `user.id` they already loaded?
3. Should `resolveTenantId` return a typed error if the authenticated user exists but has zero current-user memberships after filtering, or preserve the current recovery function behavior exactly?
4. Is the dashboard recent projects section intended to be team-wide for the active tenant, or personal/access-scoped?
5. Should delegated organization-user directory readers see all pending invite metadata, or only a reduced directory view?
