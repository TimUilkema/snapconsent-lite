# Feature 088 Research - Organization user-management custom-role enforcement

## Title and scope

Feature 088 researches whether organization-user/member-management capabilities should move from fixed owner/admin enforcement to the durable tenant custom-role model.

This is research only. No code, migration, route, helper, test, or UI changes are included in this phase.

Candidate capability keys:

- `organization_users.manage`
- `organization_users.invite`
- `organization_users.change_roles`
- `organization_users.remove`

Main recommendation: Option B, invite-only delegation first, with `organization_users.manage` as limited read/list access and `organization_users.invite` as bounded invite create/resend/revoke access. Fixed role changes, member removal, custom role editor, custom role assignment, and reviewer access assignment should remain fixed owner/admin only.

## Inputs reviewed

Required root and workflow inputs:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `UNCODEXIFY.md`
- `docs/rpi/README.md`
- `docs/rpi/SUMMARY.md`

Prior RPI inputs:

- `docs/rpi/070-tenant-rbac-and-organization-user-management-foundation/research.md`
- `docs/rpi/070-tenant-rbac-and-organization-user-management-foundation/plan.md`
- `docs/rpi/080-advanced-organization-access-management-foundation/research.md`
- `docs/rpi/080-advanced-organization-access-management-foundation/plan.md`
- `docs/rpi/081-custom-role-definitions-and-scoped-role-assignment-foundation/research.md`
- `docs/rpi/081-custom-role-definitions-and-scoped-role-assignment-foundation/plan.md`
- `docs/rpi/082-project-scoped-reviewer-assignments-and-enforcement/research.md`
- `docs/rpi/082-project-scoped-reviewer-assignments-and-enforcement/plan.md`
- `docs/rpi/083-custom-role-editor-foundation/research.md`
- `docs/rpi/083-custom-role-editor-foundation/plan.md`
- `docs/rpi/084-custom-role-assignment-foundation/research.md`
- `docs/rpi/084-custom-role-assignment-foundation/plan.md`
- `docs/rpi/085-custom-role-media-library-enforcement/research.md`
- `docs/rpi/085-custom-role-media-library-enforcement/plan.md`
- `docs/rpi/086-custom-role-template-profile-enforcement/research.md`
- `docs/rpi/086-custom-role-template-profile-enforcement/plan.md`
- `docs/rpi/087-tenant-level-admin-permission-consolidation/research.md`
- `docs/rpi/087-tenant-level-project-administration-custom-role-enforcement/plan.md`

Feature 087 drift found:

- `docs/rpi/087-tenant-level-project-administration-custom-role-enforcement/research.md` does not exist in the live repo.
- The requested `087-tenant-level-project-administration-custom-role-enforcement` folder exists with `plan.md`.
- A second `087-tenant-level-admin-permission-consolidation` folder exists with `research.md`.
- Live code and migration `20260430170000_087_project_admin_custom_role_enforcement.sql` show Feature 087 implementation is present. This research follows live code and schema over the older `SUMMARY.md`, which still says no top-level `087-*` folder was present.

Live code, schema, and tests inspected:

- `src/lib/tenant/role-capabilities.ts`
- `src/lib/tenant/tenant-custom-role-capabilities.ts`
- `src/lib/tenant/permissions.ts`
- `src/lib/tenant/tenant-membership.ts`
- `src/lib/tenant/member-management-service.ts`
- `src/lib/tenant/member-management-route-utils.ts`
- `src/lib/tenant/membership-invites.ts`
- `src/lib/tenant/custom-role-service.ts`
- `src/lib/tenant/custom-role-assignment-service.ts`
- `src/lib/tenant/reviewer-access-service.ts`
- `src/lib/tenant/role-assignment-foundation.ts`
- `src/lib/projects/project-administration-service.ts`
- `src/app/(protected)/layout.tsx`
- `src/app/(protected)/members/page.tsx`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/components/navigation/protected-nav.tsx`
- `src/components/members/member-management-panel.tsx`
- `src/components/members/custom-role-management-section.tsx`
- `src/app/api/members/**`
- `src/app/api/projects/[projectId]/reviewer-access/**`
- `messages/en.json`
- `messages/nl.json`
- `supabase/migrations/20260423090000_070_tenant_rbac_membership_invites_foundation.sql`
- `supabase/migrations/20260423110000_070_tenant_membership_invite_flows.sql`
- `supabase/migrations/20260430120000_081_role_assignment_foundation.sql`
- `supabase/migrations/20260430130000_082_reviewer_access_assignment_enforcement.sql`
- `supabase/migrations/20260430140000_083_custom_role_editor_functions.sql`
- `supabase/migrations/20260430150000_085_media_library_custom_role_enforcement.sql`
- `supabase/migrations/20260430160000_086_template_profile_custom_role_enforcement.sql`
- `supabase/migrations/20260430170000_087_project_admin_custom_role_enforcement.sql`
- `tests/feature-070-tenant-rbac-foundation.test.ts`
- `tests/feature-080-role-capability-catalog.test.ts`
- `tests/feature-081-role-assignment-foundation.test.ts`
- `tests/feature-082-reviewer-access-assignments.test.ts`
- `tests/feature-083-custom-role-editor-foundation.test.ts`
- `tests/feature-084-custom-role-assignment-foundation.test.ts`
- `tests/feature-085-custom-role-media-library-enforcement.test.ts`
- `tests/feature-086-custom-role-template-profile-enforcement.test.ts`
- `tests/feature-087-project-admin-custom-role-enforcement.test.ts`

## Verified current behavior

The custom-role migration is area-by-area, not a generic effective-permission engine.

Tenant-scoped custom roles are currently enforced for:

- `media_library.access`
- `media_library.manage_folders`
- `templates.manage`
- `profiles.view`
- `profiles.manage`
- `projects.create`
- `project_workspaces.manage`

Reviewer access remains special:

- Fixed `reviewer` means reviewer eligibility.
- Tenant-wide system reviewer assignment grants tenant-wide reviewer access.
- Project-scoped system reviewer assignment grants reviewer access for that project.
- This is not tenant custom-role enforcement.

Organization user/member management remains fixed owner/admin only in live code and SQL:

- `/members` nav is shown from `resolveTenantPermissions(...).canManageMembers`.
- `canManageMembers` is fixed-role-derived from `organization_users.manage`, but only through `memberships.role`.
- `organization_users.*` custom role assignments can be created and assigned, but they do not grant member-management access.
- SQL helper `app.current_user_can_manage_members(p_tenant_id)` still returns true only for fixed `owner` and `admin`.

## Current enforced custom-role capability map after Feature 087

`src/lib/tenant/tenant-custom-role-capabilities.ts` defines:

| Capability | Enforced for tenant custom roles now? |
| --- | --- |
| `media_library.access` | Yes |
| `media_library.manage_folders` | Yes |
| `templates.manage` | Yes |
| `profiles.view` | Yes |
| `profiles.manage` | Yes |
| `projects.create` | Yes |
| `project_workspaces.manage` | Yes |
| `organization_users.manage` | No |
| `organization_users.invite` | No |
| `organization_users.change_roles` | No |
| `organization_users.remove` | No |

The final SQL definition of `app.current_user_has_tenant_custom_role_capability(...)` in `20260430170000_087_project_admin_custom_role_enforcement.sql` has the same enforced allowlist. It only counts active tenant-scoped assignments where:

- the user is an active tenant member;
- the assignment belongs to the same tenant and user;
- `scope_type = 'tenant'`;
- `project_id` and `workspace_id` are null;
- `revoked_at` is null;
- the role definition is a tenant custom role, not a system role;
- the role definition belongs to the same tenant;
- the role definition is not archived;
- the role definition contains the requested capability.

## Capability catalog status

| Capability | Exists in `TENANT_CAPABILITIES` | Owner/admin fixed mapping | Reviewer/photographer fixed mapping | SQL capability rows | Custom role definitions can contain it | Assignments visible | Enforced tenant custom-role allowlist |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `organization_users.manage` | Yes | Yes | No | Yes, seeded by Feature 081 | Yes | Owner/admin can see all assignment summaries; assigned users can see their own raw assignment row by RLS, but not full tenant custom role metadata unless they are managers | No |
| `organization_users.invite` | Yes | Yes | No | Yes | Yes | Same as above | No |
| `organization_users.change_roles` | Yes | Yes | No | Yes | Yes | Same as above | No |
| `organization_users.remove` | Yes | Yes | No | Yes | Yes | Same as above | No |

The custom role editor exposes these capabilities as selectable because it validates against the full catalog, not the enforced allowlist. This is acceptable only because enforcement remains explicit and allowlisted.

## Current organization-user/member-management surface

| Surface | Route/UI | Current TypeScript gate | Current SQL/RLS gate | Feature 088 recommendation |
| --- | --- | --- | --- | --- |
| Members nav | `src/app/(protected)/layout.tsx`, `ProtectedNav` | `resolveTenantPermissions(...).canManageMembers`, fixed owner/admin | None directly | Show for fixed owner/admin or effective `organization_users.manage` / `organization_users.invite`, depending final UI mode |
| Members page loader | `src/app/(protected)/members/page.tsx` | `getTenantMemberManagementData(...)` catches forbidden and renders read-only message | Service queries rely on `memberships` and invite RLS | Replace with explicit organization-user access loader; do not reuse full management data for delegated viewers |
| Full management data | `getTenantMemberManagementData(...)` | `assertTenantMemberManager(...)` umbrella | `app.current_user_can_manage_members(...)` | Keep fixed owner/admin because it loads role editor, assignments, and reviewer access |
| Invite create | `POST /api/members/invites` | `createTenantMemberInvite(...)` then umbrella manager | RPC checks `app.current_user_can_manage_members(...)` | Include under `organization_users.invite`, but only with separate target-role checks |
| Invite resend | `POST /api/members/invites/[inviteId]/resend` | `resendTenantMemberInvite(...)` then umbrella manager | RPC checks `app.current_user_can_manage_members(...)` | Include under `organization_users.invite`, with pending invite tenant/role/creator restrictions |
| Invite revoke | `POST /api/members/invites/[inviteId]/revoke` | `revokeTenantMemberInvite(...)` then umbrella manager | RPC checks `app.current_user_can_manage_members(...)` | Include under `organization_users.invite` for pending invites only, preferably only non-admin invites created by delegated inviters |
| Current members table | `MemberManagementPanel` | Data available only to managers | `memberships_select_manage_member_rows` | Include read/list rows in a separate read model |
| Fixed role changes | `PATCH /api/members/[userId]` | `updateTenantMemberRole(...)` umbrella plus owner immutable and manageable role validation | membership update policy uses umbrella; owner rows excluded; new role cannot be owner | Defer custom-role delegation |
| Member removal | `DELETE /api/members/[userId]` | `removeTenantMember(...)` umbrella plus owner immutable | membership delete policy uses umbrella; owner rows excluded | Defer custom-role delegation |
| Owner row behavior | Members table `canEdit: row.role !== "owner"` | service prevents owner role change/removal | policies exclude owner update/delete | Preserve |
| Custom role editor | `CustomRoleManagementSection`, `/api/members/roles/**` | `custom-role-service` umbrella manager | RPCs hard-check `owner/admin`; role definition RLS uses umbrella | Keep fixed owner/admin |
| Custom role assignment controls | member table custom role column, `/api/members/[userId]/custom-roles/**` | `custom-role-assignment-service` umbrella manager | `role_assignments_select_tenant_managers`; writes use service role after manager checks | Keep fixed owner/admin |
| Tenant-wide reviewer access | member table reviewer access column, `/api/members/[userId]/reviewer-access/tenant-wide` | `reviewer-access-service` owner/admin check | role assignment reads/writes through service patterns | Keep fixed owner/admin |
| Project reviewer access | project page panel, `/api/projects/[projectId]/reviewer-access/**` | `reviewer-access-service` owner/admin check; project page loads this only when `projectPermissions.canManageMembers` | system reviewer assignments | Keep fixed owner/admin |
| Project workspace staffing | project page | Feature 087 project administration access | Feature 087 project administration helpers | Out of scope |

## Current TypeScript member-management gates

`resolveTenantPermissions(...).canManageMembers` is the only current app-level member-management boolean. It is derived by `deriveTenantPermissionsFromRole(...)`, which calls `roleHasCapability(role, "organization_users.manage")` on the fixed membership role. It is not custom-role-aware.

Invite, role-change, and removal are not separately guarded in TypeScript:

- `createTenantMemberInvite(...)` uses `assertTenantMemberManager(...)`.
- `resendTenantMemberInvite(...)` uses `assertTenantMemberManager(...)`.
- `revokeTenantMemberInvite(...)` uses `assertTenantMemberManager(...)`.
- `updateTenantMemberRole(...)` uses `assertTenantMemberManager(...)`.
- `removeTenantMember(...)` uses `assertTenantMemberManager(...)`.

`assertTenantMemberManager(...)` guards too many things for direct custom-role reuse. Reusing it for `organization_users.manage` would also grant:

- full member table;
- pending invite controls;
- fixed role changes;
- member removal;
- custom role editor data and mutations;
- custom role assignment data and mutations;
- reviewer access summaries and grant/revoke controls.

Services that need split authorizers for Feature 088:

- `member-management-service.ts`: split read/list, invite create/resend/revoke, fixed role change, and removal.
- `membership-invites.ts`: add SQL/RPC support for invite-specific authority rather than relying on `current_user_can_manage_members`.
- `custom-role-service.ts`: keep its own fixed owner/admin guard.
- `custom-role-assignment-service.ts`: keep its own fixed owner/admin guard.
- `reviewer-access-service.ts`: keep its current fixed owner/admin guard.

Routes that can migrate safely with a bounded refactor:

- `GET /api/members` if it returns a reduced organization-user read model for delegated access instead of full management data.
- `POST /api/members/invites`.
- `POST /api/members/invites/[inviteId]/resend`.
- `POST /api/members/invites/[inviteId]/revoke`.

Routes that should remain fixed owner/admin for Feature 088:

- `PATCH /api/members/[userId]`.
- `DELETE /api/members/[userId]`.
- `/api/members/roles/**`.
- `/api/members/custom-role-assignments`.
- `/api/members/[userId]/custom-roles/**`.
- `/api/members/reviewer-access`.
- `/api/members/[userId]/reviewer-access/tenant-wide`.
- `/api/projects/[projectId]/reviewer-access/**`.

## Current SQL/RLS member-management gates

SQL currently has one umbrella owner/admin helper:

- `app.current_user_can_manage_members(p_tenant_id)`
- public wrapper `public.current_user_can_manage_members(p_tenant_id)`

That helper is used for:

- selecting all membership rows;
- inserting membership rows;
- updating non-owner membership rows;
- deleting non-owner membership rows;
- selecting pending tenant membership invites;
- inserting tenant membership invites;
- updating tenant membership invites;
- invite RPC create/resend/revoke checks;
- tenant custom role definition visibility;
- tenant custom role capability visibility;
- tenant role assignment visibility for tenant managers.

Adding custom `organization_users.manage` directly to `app.current_user_can_manage_members(...)` would grant too much. It would unlock all of the surfaces above, including role editor and custom role assignment reads, and would also satisfy write policies for membership updates/deletes and invite rows.

SQL policies do not currently distinguish list/read from invite update, fixed role update, and member removal. Separate helpers are needed:

- `app.current_user_can_view_organization_users(p_tenant_id)`
- `app.current_user_can_invite_organization_users(p_tenant_id, p_target_role text default null)`
- `app.current_user_can_change_organization_user_roles(p_tenant_id, p_target_user_id uuid default null, p_next_role text default null)`
- `app.current_user_can_remove_organization_users(p_tenant_id, p_target_user_id uuid default null)`

For Feature 088, only the first two should be implemented. `app.current_user_can_manage_members(...)` should remain fixed owner/admin for compatibility with role editor, custom-role assignment, reviewer access, and broad member write policies.

The invite RPCs need separate authorization checks beyond RLS because they are `security definer` functions and currently call `app.current_user_can_manage_members(...)` internally:

- `app.create_or_refresh_tenant_membership_invite(...)`
- `app.refresh_tenant_membership_invite(...)`
- `app.revoke_tenant_membership_invite(...)`

## Members page read/list access

The current Members page loads more than members and pending invites. `getTenantMemberManagementData(...)` returns:

- active members with email, fixed role, join date, and owner editability;
- pending invites with email, role, expiry, last sent, and created time;
- reviewer access summaries;
- custom role editor capability and role data;
- assignable custom roles;
- custom role assignment summaries for members.

That shape is not safe for direct `organization_users.manage` custom-role access. It would expose enough role metadata and controls to confuse the boundary between member viewing and role administration.

Recommended minimum safe read model for custom `organization_users.manage`:

- member email;
- fixed role;
- joined date;
- owner/admin/reviewer/photographer labels;
- pending invite email;
- pending invite fixed role;
- pending invite expiry and last sent date;
- no custom role editor data;
- no custom role assignment data;
- no reviewer access summaries;
- no reviewer access controls;
- no custom role assignment controls;
- no fixed role mutation controls;
- no member removal controls.

This does expose member emails and pending invite emails. That is inherent in organization-user read/list access and should be considered acceptable only for tenant-scoped custom roles. Project-scoped and workspace-scoped assignments must not grant this access.

## Invite delegation

Routes involved:

- `POST /api/members/invites`
- `POST /api/members/invites/[inviteId]/resend`
- `POST /api/members/invites/[inviteId]/revoke`

Service and RPC involved:

- `createTenantMemberInvite(...)`
- `resendTenantMemberInvite(...)`
- `revokeTenantMemberInvite(...)`
- `createOrRefreshTenantMembershipInvite(...)`
- `refreshTenantMembershipInvite(...)`
- `revokeTenantMembershipInvite(...)`
- SQL RPCs with matching names.

Current invite safety:

- owner role is non-inviteable;
- invite roles are constrained to `admin`, `reviewer`, and `photographer`;
- duplicate pending invites for the same tenant/email are reused/refreshed;
- expired pending invites are expired during create/resend/accept flows;
- already-member invites become no-op/already-member outcomes;
- acceptance requires the authenticated account email to match the invite email;
- invite email delivery goes through `deliverTenantMembershipInviteEmail(...)` and the outbound email foundation;
- links use tokenized join flow and the existing external origin/email foundation.

Recommended Feature 088 invite delegation:

- Fixed owner/admin keep current authority, including inviting admins.
- Custom-role `organization_users.invite` users can create invites for `reviewer` and `photographer`.
- Custom-role `organization_users.invite` users must not invite `admin`.
- Custom-role `organization_users.invite` users must not invite `owner`.
- Custom-role `organization_users.invite` users must not attach custom roles at invite time.
- Resend with role changes must respect the same target-role bounds.
- Revoke should be treated as part of invite management, but for delegated inviters it should be limited to non-admin pending invites. The plan phase should decide whether to additionally require `invited_by_user_id = auth.uid()` for delegated revoke/resend; that is the safest default if product expectations allow it.

Reason: allowing a delegated inviter to invite an `admin` would let them send an invite to an address they control and obtain broad owner/admin-like power indirectly. This would make `organization_users.invite` much stronger than its name suggests.

## Fixed role change delegation

Route and service:

- `PATCH /api/members/[userId]`
- `updateTenantMemberRole(...)`

Current behavior:

- guarded by `assertTenantMemberManager(...)`;
- target row must exist in the active tenant;
- target owner rows are immutable;
- next role must be one of `admin`, `reviewer`, `photographer`;
- `owner` cannot be assigned;
- changing away from reviewer revokes active system reviewer assignments.

Current SQL:

- membership update policy uses `app.current_user_can_manage_members(tenant_id)`;
- current row role must not be owner;
- new role must be `admin`, `reviewer`, or `photographer`.

Recommendation: defer `organization_users.change_roles`.

The current structure does not distinguish whether a delegated user may promote to admin, demote an admin, change another delegated manager, or only change reviewer/photographer targets. A safe target model needs explicit product rules and SQL parity. It should not be coupled to invite delegation.

## Member removal delegation

Route and service:

- `DELETE /api/members/[userId]`
- `removeTenantMember(...)`

Current behavior:

- guarded by `assertTenantMemberManager(...)`;
- target row must exist in the active tenant;
- owner rows are protected;
- deletion removes the membership only, not the auth account.

Current schema behavior:

- `role_assignments` has a `(tenant_id, user_id)` foreign key to `memberships` with `on delete cascade`.
- Feature 084 tests verify membership deletion cascades role assignments.
- Reviewer access assignments are also role assignment rows and therefore are removed by membership deletion; fixed role change away from reviewer explicitly revokes active reviewer assignments.

Recommendation: defer `organization_users.remove`.

Removal has target-risk questions that are not encoded today:

- whether delegated users can remove admins;
- whether delegated users can remove other delegated organization managers;
- whether delegated users can remove someone with custom role editor/assignment power;
- whether self-removal is allowed or blocked;
- whether removal should be restricted to lower fixed roles.

Those require a separate target-sensitive authorization model.

## Custom role editor delegation boundary

Routes and services:

- `GET /api/members/roles`
- `POST /api/members/roles`
- `PATCH /api/members/roles/[roleId]`
- `POST /api/members/roles/[roleId]/archive`
- `custom-role-service.ts`

Current guards:

- TypeScript uses member-management umbrella authority.
- SQL editor RPCs hard-check membership `role in ('owner', 'admin')`.
- System roles are immutable.
- Archived custom roles cannot be edited.

Recommendation: custom role editor delegation is out of scope for Feature 088.

Granting this through `organization_users.manage` would be a privilege escalation. A future capability such as `roles.manage` should be researched separately, likely Feature 090 or later.

## Custom role assignment delegation boundary

Routes and services:

- `GET /api/members/custom-role-assignments`
- `POST /api/members/[userId]/custom-roles`
- `DELETE /api/members/[userId]/custom-roles/[roleId]`
- `custom-role-assignment-service.ts`

Current guards:

- TypeScript uses member-management umbrella authority.
- System role definitions cannot be assigned through this workflow.
- Archived roles cannot be newly assigned.
- Revocation is idempotent and sets `revoked_at/by`.
- Assignment creation uses service role after tenant/member/role validation.

Recommendation: custom role assignment delegation is out of scope for Feature 088.

Allowing an organization-user manager to assign custom roles could let them grant `organization_users.*`, `projects.create`, `project_workspaces.manage`, templates/profiles, or Media Library capabilities to themselves or others. A future capability such as `roles.assign` should be researched separately.

## Reviewer access delegation boundary

Routes and services:

- `GET /api/members/reviewer-access`
- `POST/DELETE /api/members/[userId]/reviewer-access/tenant-wide`
- `GET/POST /api/projects/[projectId]/reviewer-access`
- `DELETE /api/projects/[projectId]/reviewer-access/[userId]`
- `reviewer-access-service.ts`

Current guards:

- `reviewer-access-service.ts` uses its own fixed owner/admin `assertTenantMemberManager(...)`.
- Targets must be fixed `reviewer` members.
- Tenant-wide and project-scoped reviewer access use system reviewer role assignment rows.
- Feature 082 tests cover tenant-wide/project-scoped and unassigned reviewer behavior.

Recommendation: reviewer access grant/revoke delegation is out of scope for Feature 088.

`organization_users.change_roles` should not imply reviewer access grant/revoke. A future capability such as `reviewer_access.manage` could be researched later, but keeping this fixed owner/admin indefinitely is also defensible because reviewer access changes operational review authority across projects.

## Effective permission architecture recommendation

Feature 088 should follow the Feature 087 pattern: surface-specific authorizers, no generic app-wide effective permission engine.

Recommended TypeScript helpers:

- `resolveOrganizationUserManagementAccess(...)`
- `assertCanViewOrganizationUsers(...)`
- `assertCanInviteOrganizationUsers(...)`
- `assertCanChangeOrganizationUserRoles(...)` as fixed owner/admin only for now
- `assertCanRemoveOrganizationUsers(...)` as fixed owner/admin only for now

Recommended data loaders:

- keep `getTenantMemberManagementData(...)` fixed owner/admin for the full page;
- add a reduced read model for delegated organization-user viewers/inviters;
- do not make `resolveTenantPermissions(...).canManageMembers` custom-role-aware in Feature 088.

Recommended SQL helpers:

- add `organization_users.manage` and `organization_users.invite` to the SQL and TypeScript tenant custom-role enforced allowlists only if implemented;
- add separate SQL helpers for view and invite;
- do not broaden `app.current_user_can_manage_members(...)`;
- keep hard allowlists in both TypeScript and SQL.

## UI and i18n implications

UI should keep the existing Members page structure as much as possible and follow `UNCODEXIFY.md`: normal tables, forms, and buttons; no access matrix or permission dashboard.

Recommended UI gating:

- Members nav appears for fixed owner/admin, custom `organization_users.manage`, or custom `organization_users.invite`.
- If the user only has `organization_users.manage`, show read-only members and pending invites.
- If the user has `organization_users.invite`, show invite creation and allowed pending invite controls.
- Invite role dropdown for delegated inviters should only show `reviewer` and `photographer`.
- Fixed owner/admin continue to see `admin`, `reviewer`, and `photographer`.
- Role-change controls appear only for fixed owner/admin in Feature 088.
- Remove controls appear only for fixed owner/admin in Feature 088.
- Custom role editor remains visible only for fixed owner/admin.
- Custom role assignment controls remain visible only for fixed owner/admin.
- Reviewer access controls remain visible only for fixed owner/admin.

Likely i18n additions:

- read-only organization-user view text that does not say only owner/admin can manage members when custom read/list is allowed;
- invite-permission helper text for delegated users explaining only reviewer/photographer can be invited;
- errors for `organization_user_invite_forbidden`, `organization_user_admin_invite_forbidden`, and possibly `organization_user_invite_revoke_forbidden`;
- English and Dutch keys under the existing `members` structure.

## SQL/RLS and TypeScript parity considerations

For `organization_users.manage` read/list:

- fixed owner/admin allowed;
- fixed reviewer/photographer denied unless an active tenant-scoped custom role grants `organization_users.manage`;
- no-capability custom role denied;
- revoked assignment denied;
- archived role denied;
- cross-tenant assignment denied;
- project-scoped assignment denied;
- workspace-scoped assignment denied;
- role editor not exposed;
- custom role assignment not exposed;
- reviewer access management not exposed.

For `organization_users.invite`:

- fixed owner/admin keep current invite authority;
- fixed reviewer/photographer denied unless active tenant-scoped custom role grants `organization_users.invite`;
- custom `organization_users.invite` can invite only non-admin, non-owner roles;
- no-capability, revoked, archived, cross-tenant, project-scoped, and workspace-scoped cases denied;
- create/resend/revoke route checks and SQL RPC checks match;
- tenant id remains server-derived;
- invite email delivery remains through outbound email foundation;
- duplicate/retry behavior remains create-or-refresh and idempotent revoke semantics.

For deferred capabilities:

- tests should prove custom roles containing `organization_users.change_roles` and `organization_users.remove` do not grant role changes/removal in Feature 088.
- tests should prove `organization_users.manage` and `organization_users.invite` do not grant custom role editor, custom role assignment, reviewer access, project creation, project workspace management, Media Library, templates, or profiles beyond separately assigned capabilities.

## Non-expansion boundaries

Feature 088 should not grant:

- project creation;
- project workspace management;
- capture/upload;
- review;
- workflow/finalization;
- correction;
- Media Library access or folder management;
- templates/profiles access;
- custom role editor;
- custom role assignment;
- reviewer access assignment;
- project-scoped custom-role enforcement;
- workspace-scoped custom-role enforcement;
- invite-to-custom-role;
- generic effective capability engine;
- owner transfer/demotion;
- member-level deny/override rules;
- agency/client hierarchy.

## Options considered

### Option A - Read/list only first

Pros:

- Lowest privilege expansion.
- Forces the Members page to split safe read data from full member administration.
- Avoids target-role and invite ownership rules.

Cons:

- Small user-facing value if invite delegation is the real operational need.
- Still requires SQL/RLS split work because broadening `current_user_can_manage_members` is unsafe.

### Option B - Invite-only delegation first

Pros:

- Useful next step without granting role changes/removal.
- Can be made safe if delegated inviters cannot invite admins or owners.
- Naturally pairs with a reduced read model for members and pending invites.
- Keeps custom role editor, custom role assignment, and reviewer access out of scope.

Cons:

- Requires separate SQL helpers and RPC authorization changes.
- Needs explicit product decision on whether delegated inviters can resend/revoke all non-admin pending invites or only invites they created.
- Existing Members UI must be capability-gated by section.

Recommendation: choose Option B.

### Option C - Invite + removal but no fixed role changes

Not recommended. Removal needs target-sensitive rules for admins, other delegated managers, self-removal, and active custom/reviewer assignments. The current SQL and service structure is too broad.

### Option D - Full organization-user enforcement

Not recommended. Granting all four capabilities now risks privilege escalation through admin role changes, admin invitations, removal of admins/managers, custom-role assignment, and reviewer access confusion.

### Option E - Defer implementation

Not recommended. The live structure is broad, but the Feature 087 project-administration pattern gives a clear safe path: add surface-specific helpers and keep the umbrella manager helper fixed owner/admin.

## Recommended bounded Feature 088 implementation scope

Recommended title:

Feature 088 - Organization user read/list and invite custom-role enforcement

Recommended exact scope:

- Add custom-role enforcement for `organization_users.manage` as limited Members page read/list access.
- Add custom-role enforcement for `organization_users.invite` as bounded invite create/resend/revoke access.
- Keep fixed owner/admin authority unchanged.
- Keep `app.current_user_can_manage_members(...)` fixed owner/admin.
- Add new organization-user-specific TypeScript and SQL helpers.
- Split the Members page data model so delegated users do not receive custom role editor, custom-role assignment, or reviewer access data.

Recommended capabilities to enforce now:

- `organization_users.manage`
- `organization_users.invite`

Recommended capabilities to defer:

- `organization_users.change_roles`
- `organization_users.remove`

Explicit capability recommendations:

- `organization_users.manage`: enforce now for limited read/list only. It should not be an umbrella Members page permission.
- `organization_users.invite`: enforce now for invite create/resend/revoke, but delegated users must not invite or resend to `admin` or `owner`. Plan phase should default delegated revoke/resend to non-admin invites created by the actor unless product direction says all non-admin pending invites are acceptable.
- `organization_users.change_roles`: defer.
- `organization_users.remove`: defer.

Delegation boundary recommendations:

- Custom role editor delegation: out.
- Custom role assignment delegation: out.
- Reviewer access delegation: out.

## Required tests

Recommended test themes:

- fixed owner/admin can still view, invite admins/reviewers/photographers, resend, revoke, change roles, remove non-owner members, manage custom roles, assign custom roles, and manage reviewer access;
- fixed reviewer/photographer denied member read/list unless custom role grants `organization_users.manage` or `organization_users.invite`;
- custom `organization_users.manage` can view reduced members/pending invites model only;
- custom `organization_users.manage` cannot invite, resend, revoke, change roles, remove members, edit roles, assign custom roles, or manage reviewer access;
- custom `organization_users.invite` can view the minimum data needed to invite and manage allowed pending invites;
- custom `organization_users.invite` can create reviewer/photographer invites;
- custom `organization_users.invite` cannot create or resend admin/owner invites;
- custom `organization_users.invite` revoke behavior follows the plan-phase ownership/role decision;
- no-capability custom role denied;
- revoked assignment denied;
- archived role denied;
- cross-tenant assignment denied;
- project-scoped assignment denied;
- workspace-scoped assignment denied;
- owner protections preserved;
- admin target role changes/removals still fixed owner/admin only;
- role editor not accidentally granted;
- custom role assignment not accidentally granted;
- reviewer access management not accidentally granted;
- project creation and workspace management not accidentally granted;
- Media Library, templates, and profiles not accidentally granted.

## Fresh reset and dev data considerations

Assume `supabase db reset` is acceptable for local development validation. Tests should create their own:

- tenants;
- owner/admin/reviewer/photographer memberships;
- pending, accepted, revoked, and expired invites;
- custom role definitions with organization-user capabilities;
- active tenant-scoped assignments;
- revoked assignments;
- archived roles;
- cross-tenant roles and assignments;
- project-scoped assignments;
- workspace-scoped assignments;
- reviewer access assignments only where needed to prove non-expansion.

No compatibility repair for arbitrary old local rows is needed unless the plan phase discovers a production migration requirement.

## Open decisions for plan phase

- Should delegated `organization_users.invite` users be able to resend/revoke all non-admin pending invites, or only invites they created?
- Should `organization_users.invite` imply read/list access, or should the UI require either `organization_users.manage` or fixed owner/admin to see the broader list? Recommended default: invite implies the minimal invite read model, but `organization_users.manage` controls broader read-only member listing.
- Should pending admin invites be visible to delegated readers? Recommended default: visible in read/list mode but not mutable by delegated inviters.
- Should reduced read/list include owner email rows? Recommended default: yes, read-only.
- Should delegated invite creation expose "already member" outcomes exactly like owner/admin? Recommended default: yes, but without revealing cross-tenant data.
- Should SQL use target-role-aware invite helpers or separate admin/non-admin invite helpers? Recommended default: target-role-aware helpers for parity with RPC inputs.
- Should the UI introduce separate read-only and invite-capable panel props, or split into smaller member-list and invite-list components? Recommended default: split by data model to avoid accidentally passing privileged data to delegated views.
