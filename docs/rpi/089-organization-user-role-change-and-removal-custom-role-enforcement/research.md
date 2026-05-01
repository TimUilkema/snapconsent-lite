# Feature 089 - Organization User Role-Change and Removal Custom-Role Enforcement Research

## Title and scope

Feature 089 researches the next organization-user permission migration slice after Feature 088.

The candidate custom-role capabilities are:

- `organization_users.change_roles`
- `organization_users.remove`

This is research only. No route, service, migration, test, or UI implementation is included in this phase.

Main product question:

Can fixed role changes and member removal be safely delegated to tenant custom roles without granting owner/admin-equivalent power?

## Inputs reviewed

Project context:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `UNCODEXIFY.md`
- `docs/rpi/README.md`
- `docs/rpi/SUMMARY.md`

Prior RPI context:

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
- `docs/rpi/088-organization-user-management-custom-role-enforcement/research.md`
- `docs/rpi/088-organization-user-read-list-and-invite-custom-role-enforcement/plan.md`

Live code, schema, and tests:

- `src/lib/tenant/role-capabilities.ts`
- `src/lib/tenant/tenant-custom-role-capabilities.ts`
- `src/lib/tenant/organization-user-access.ts`
- `src/lib/tenant/member-management-service.ts`
- `src/lib/tenant/membership-invites.ts`
- `src/lib/tenant/permissions.ts`
- `src/lib/tenant/reviewer-access-service.ts`
- `src/lib/tenant/custom-role-service.ts`
- `src/lib/tenant/custom-role-assignment-service.ts`
- `src/lib/tenant/resolve-tenant.ts`
- `src/app/api/members/route.ts`
- `src/app/api/members/[userId]/route.ts`
- `src/app/api/members/invites/route.ts`
- `src/app/api/members/invites/[inviteId]/resend/route.ts`
- `src/app/api/members/invites/[inviteId]/revoke/route.ts`
- `src/app/api/members/**/reviewer-access/**`
- `src/app/api/members/**/custom-roles/**`
- `src/app/api/members/roles/**`
- `src/app/(protected)/members/page.tsx`
- `src/app/(protected)/layout.tsx`
- `src/components/members/member-management-panel.tsx`
- `src/components/members/delegated-member-management-panel.tsx`
- `src/components/members/custom-role-management-section.tsx`
- `messages/en.json`
- `messages/nl.json`
- `supabase/migrations/20260423090000_070_tenant_rbac_membership_invites_foundation.sql`
- `supabase/migrations/20260423110000_070_tenant_membership_invite_flows.sql`
- `supabase/migrations/20260430120000_081_role_assignment_foundation.sql`
- `supabase/migrations/20260430130000_082_reviewer_access_assignment_enforcement.sql`
- `supabase/migrations/20260430150000_085_media_library_custom_role_enforcement.sql`
- `supabase/migrations/20260430160000_086_template_profile_custom_role_enforcement.sql`
- `supabase/migrations/20260430170000_087_project_admin_custom_role_enforcement.sql`
- `supabase/migrations/20260430180000_088_organization_user_invite_custom_role_enforcement.sql`
- `tests/feature-070-tenant-rbac-foundation.test.ts`
- `tests/feature-080-role-capability-catalog.test.ts`
- `tests/feature-081-role-assignment-foundation.test.ts`
- `tests/feature-082-reviewer-access-assignments.test.ts`
- `tests/feature-084-custom-role-assignment-foundation.test.ts`
- `tests/feature-087-project-admin-custom-role-enforcement.test.ts`
- `tests/feature-088-organization-user-read-list-and-invite-custom-role-enforcement.test.ts`

## Source-of-truth drift found

Live code and migrations are the source of truth.

Notable drift:

- `docs/rpi/SUMMARY.md` says its last verified migration was `20260430160000_086_template_profile_custom_role_enforcement.sql` and says no top-level `087-*` folder was present. Live repo now contains Feature 087 docs, `supabase/migrations/20260430170000_087_project_admin_custom_role_enforcement.sql`, and `tests/feature-087-project-admin-custom-role-enforcement.test.ts`.
- The requested `docs/rpi/087-tenant-level-project-administration-custom-role-enforcement/research.md` is not present. The available 087 project-admin plan and the 087 admin consolidation research were reviewed.
- Feature 087 is implemented live. Therefore the enforced tenant custom-role map after Feature 088 includes `projects.create` and `project_workspaces.manage`, not only Media Library, templates, profiles, and organization-user read/invite.

## Verified current behavior

Current fixed membership roles:

- `owner`
- `admin`
- `reviewer`
- `photographer`

Current manageable target roles:

- `admin`
- `reviewer`
- `photographer`

`owner` is intentionally excluded from `MANAGEABLE_MEMBERSHIP_ROLES`, from invite role checks, and from the membership update/insert RLS `with check` role allowlist.

Owner/admin remain the fixed privileged organization-user managers. Current custom-role organization-user enforcement after Feature 088 grants only:

- reduced organization-user read/list access through `organization_users.manage`
- bounded invite create/resend/revoke access through `organization_users.invite`

Current custom-role organization-user enforcement does not grant:

- fixed role changes
- member removal
- custom role editor access
- custom role assignment access
- reviewer access grant/revoke access

## Current enforced custom-role capability map after Feature 088

TypeScript enforced tenant custom-role allowlist in `src/lib/tenant/tenant-custom-role-capabilities.ts`:

- `media_library.access`
- `media_library.manage_folders`
- `templates.manage`
- `profiles.view`
- `profiles.manage`
- `projects.create`
- `project_workspaces.manage`
- `organization_users.manage`
- `organization_users.invite`

SQL enforced tenant custom-role allowlist in `app.current_user_has_tenant_custom_role_capability(...)` after migration `20260430180000_088_organization_user_invite_custom_role_enforcement.sql`:

- `media_library.access`
- `media_library.manage_folders`
- `templates.manage`
- `profiles.view`
- `profiles.manage`
- `projects.create`
- `project_workspaces.manage`
- `organization_users.manage`
- `organization_users.invite`

Not currently enforced through tenant custom roles:

- `organization_users.change_roles`
- `organization_users.remove`
- capture capabilities
- review/workflow/correction capabilities

Important verification:

- `organization_users.change_roles` and `organization_users.remove` exist in `TENANT_CAPABILITIES`.
- They are inserted into SQL `capabilities`.
- They are mapped to system `owner` and `admin` role definitions.
- The custom role editor can include them because it validates against `TENANT_CAPABILITIES`.
- Assignments containing these capabilities are visible through the custom role assignment/editor surfaces to fixed owner/admin managers.
- They are intentionally absent from the TypeScript and SQL enforced custom-role allowlists.

## Current role-change routes, services, helpers, SQL/RLS policies, and UI surfaces

Route:

- `PATCH /api/members/[userId]` in `src/app/api/members/[userId]/route.ts`

Route behavior:

- derives `tenantId` server-side through `requireAuthenticatedTenantContext()`
- reads `targetUserId` from the route param
- accepts only a `role` body value in `MANAGEABLE_MEMBERSHIP_ROLES`
- calls `updateTenantMemberRole(...)`

Service:

- `updateTenantMemberRole(...)` in `src/lib/tenant/member-management-service.ts`

Service checks:

- calls local `assertTenantMemberManager(...)`
- `assertTenantMemberManager(...)` calls `resolveTenantPermissions(...)`
- `resolveTenantPermissions(...).canManageMembers` is fixed-role-derived from `memberships.role`
- active custom roles do not affect `resolveTenantPermissions(...).canManageMembers`
- re-validates the target role through `assertManageableRole(...)`
- loads the target membership by server-derived `tenantId` and route-derived `targetUserId`
- returns 404 when the target membership is absent in that tenant
- blocks target rows whose current role is `owner`
- updates the membership role to `admin`, `reviewer`, or `photographer`
- if the previous target role was `reviewer` and the updated role is not `reviewer`, calls `revokeActiveReviewerAssignmentsForMember(...)`

SQL/RLS:

- `app.current_user_can_manage_members(p_tenant_id)` returns true only for fixed `owner` or `admin`.
- `public.current_user_can_manage_members(p_tenant_id)` wraps the app helper for tests.
- `memberships_update_manage_member_rows` allows update when:
  - `app.current_user_can_manage_members(tenant_id)` is true
  - old row `role <> 'owner'`
  - new row role is in `admin`, `reviewer`, `photographer`
- This means SQL/RLS separately protects owner rows and owner assignment.

UI:

- Fixed owner/admin users receive `MemberManagementPanel`.
- `MemberManagementPanel` renders role dropdowns for any member with `canEdit`.
- `canEdit` is currently `row.role !== 'owner'`.
- Dropdown options are `admin`, `reviewer`, `photographer`.
- Owner rows render read-only owner text and an owner-protected message.
- Delegated Feature 088 users receive `DelegatedMemberManagementPanel`, which currently shows no role-change controls.

Current role-change answers:

- Fixed roles that can currently change member roles: `owner` and `admin`.
- Target roles that can currently be assigned: `admin`, `reviewer`, `photographer`.
- `owner` can be assigned: no.
- `admin` can be assigned by fixed owner/admin: yes.
- Owner rows can be changed: no.
- Changing reviewer to a non-reviewer role revokes active reviewer access assignments.
- Changing photographer to reviewer does not create reviewer access assignments.
- Current service does not add an explicit self-change guard. Therefore Feature 089 should not assume a live fixed owner/admin self-target rule beyond the owner immutability rule.

## Current member-removal routes, services, helpers, SQL/RLS policies, and UI surfaces

Route:

- `DELETE /api/members/[userId]` in `src/app/api/members/[userId]/route.ts`

Route behavior:

- derives `tenantId` server-side through `requireAuthenticatedTenantContext()`
- reads `targetUserId` from the route param
- calls `removeTenantMember(...)`

Service:

- `removeTenantMember(...)` in `src/lib/tenant/member-management-service.ts`

Service checks:

- calls local `assertTenantMemberManager(...)`
- loads the target membership by server-derived `tenantId` and route-derived `targetUserId`
- returns 404 when the target membership is absent in that tenant
- blocks target rows whose current role is `owner`
- deletes only the `memberships` row
- does not call Supabase Auth admin user deletion

SQL/RLS:

- `memberships_delete_manage_member_rows` allows delete when:
  - `app.current_user_can_manage_members(tenant_id)` is true
  - old row `role <> 'owner'`
- `app.current_user_can_manage_members(...)` remains fixed owner/admin only.
- `role_assignments` has a composite foreign key to `memberships(tenant_id, user_id)` with `on delete cascade`.

UI:

- Fixed owner/admin users receive `MemberManagementPanel`.
- Remove controls render when `member.canEdit` is true.
- `member.canEdit` is currently `row.role !== 'owner'`.
- Owner rows render read-only owner-protected text.
- Delegated Feature 088 users receive `DelegatedMemberManagementPanel`, which currently shows no remove controls.

Current member-removal answers:

- Fixed roles that can currently remove members: `owner` and `admin`.
- Target roles that can currently be removed: `admin`, `reviewer`, `photographer`.
- Owner rows can be removed: no.
- Admin rows can be removed by fixed owner/admin: yes.
- Removal deletes only the membership row, not the auth account.
- Custom-role assignments are deleted by `role_assignments_membership_fk on delete cascade`.
- System reviewer assignments use `role_assignments`, so they are also deleted by the same cascade on membership deletion.
- If a removed user has no memberships left, `ensureTenantId(...)` can attempt the existing tenant bootstrap path on a later protected request unless an organization-invite cookie blocks bootstrap first.
- Current service does not add an explicit self-removal guard. Therefore Feature 089 should not assume a live fixed owner/admin self-removal rule beyond the owner immutability rule.

## Current fixed role and owner/admin safety behavior

Preserved live safety behavior:

- Fixed owner/admin can perform full current member-management actions.
- Owner rows cannot be edited or removed through normal service/RLS paths.
- Owner role is not inviteable.
- Owner role is not assignable through the API service or membership RLS update policy.
- Admin can be assigned by fixed owner/admin.
- Admin members can be changed or removed by fixed owner/admin.
- Member removal does not delete auth users.
- Tenant id is server-derived and is not accepted from the client body.

Risk note:

- Existing fixed owner/admin behavior is broad. Feature 089 should not copy that breadth into custom-role delegation.
- Delegated users with target-sensitive custom permissions should be explicitly blocked from owner targets, admin targets, owner next role, admin next role, and self-targeting.

Live test coverage notes:

- `tests/feature-070-tenant-rbac-foundation.test.ts` verifies admins can update and remove non-owner memberships through the service.
- `tests/feature-088-organization-user-read-list-and-invite-custom-role-enforcement.test.ts` verifies custom `organization_users.change_roles` and `organization_users.remove` are currently deferred.
- I did not find an explicit current test that calls the service against an owner target and asserts `owner_membership_immutable`; that behavior is enforced in live service and RLS and should be covered directly in Feature 089 tests.

## Current reviewer assignment cleanup behavior on role change/removal

Role change:

- `updateTenantMemberRole(...)` records the existing row before update.
- If the existing role was `reviewer` and the updated role is not `reviewer`, it calls `revokeActiveReviewerAssignmentsForMember(...)`.
- `revokeActiveReviewerAssignmentsForMember(...)` uses the service role to update active role assignments for the system reviewer role definition, setting `revoked_at` and `revoked_by`.
- This cleanup is active revocation, not deletion.

Removal:

- `removeTenantMember(...)` deletes the membership row.
- `role_assignments` rows for that tenant/user are deleted by the membership foreign key cascade.
- This removes both reviewer access assignments and custom-role assignments for the removed tenant membership.

Behavior to preserve:

- Reviewer to photographer should revoke active reviewer access assignments.
- Reviewer to admin should continue to revoke active reviewer access assignments under the current fixed owner/admin path.
- Photographer to reviewer should not auto-create reviewer access assignments.
- Removing a reviewer should preserve the current role assignment cleanup through cascade.

## Current custom role assignment cleanup behavior on member removal

Feature 084 tests verify:

- Fixed role changes leave tenant custom-role assignments intact.
- Membership deletion cascades custom-role assignments.

Live schema:

- `role_assignments_membership_fk` references `public.memberships(tenant_id, user_id)` with `on delete cascade`.

Feature 089 should preserve this:

- A reviewer/photographer role change should not revoke tenant custom-role assignments.
- Member removal should remove active and revoked assignment rows through the existing cascade.
- No compatibility layer is needed for arbitrary old local assignment rows under the current dev-data policy.

## Current Feature 088 organization-user access model

TypeScript:

- `resolveOrganizationUserAccess(...)` is the Feature 088 central resolver.
- Fixed owner/admin returns full booleans:
  - `canViewOrganizationUsers`
  - `canInviteOrganizationUsers`
  - `canChangeOrganizationUserRoles`
  - `canRemoveOrganizationUsers`
  - `canManageAllPendingInvites`
  - `allowedInviteRoles = ["admin", "reviewer", "photographer"]`
- Non-owner/admin users are checked through `userHasAnyTenantCustomRoleCapabilities(...)` for only:
  - `organization_users.manage`
  - `organization_users.invite`
- Custom `organization_users.manage` grants read/list only.
- Custom `organization_users.invite` grants delegated invite only.
- Custom role users always get:
  - `canChangeOrganizationUserRoles = false`
  - `canRemoveOrganizationUsers = false`
  - `canManageAllPendingInvites = false`

SQL:

- `app.current_user_can_view_organization_users(p_tenant_id)` allows fixed owner/admin or custom `organization_users.manage`.
- `app.current_user_can_invite_organization_users(p_tenant_id, p_target_role)` allows:
  - fixed owner/admin for `admin`, `reviewer`, `photographer`
  - custom `organization_users.invite` only for `reviewer` and `photographer`
- `app.current_user_can_manage_own_pending_organization_invite(...)` allows delegated inviters to mutate only their own pending non-admin invites.
- `app.current_user_can_manage_members(p_tenant_id)` remains fixed owner/admin only.

Data model:

- Fixed owner/admin `GET /api/members` returns full `TenantMemberManagementData`.
- Delegated users receive `OrganizationUserDirectoryData`.
- Reduced delegated data omits reviewer access, custom role editor data, assignable custom roles, and custom role assignments.

Members nav:

- `src/app/(protected)/layout.tsx` shows the Members nav when `resolveOrganizationUserAccess(...)` returns view or invite access.

Recommended reuse for Feature 089:

- Reuse and extend `resolveOrganizationUserAccess(...)`.
- Add target-sensitive helpers instead of broadening `resolveTenantPermissions(...).canManageMembers`.
- Keep `app.current_user_can_manage_members(...)` fixed owner/admin.
- Add new SQL helpers for target-sensitive role change and removal.

## Capability catalog and enforced allowlist

`organization_users.change_roles`:

- Exists in `TENANT_CAPABILITIES`: yes.
- Exists in SQL `capabilities`: yes.
- Fixed role mapping: system `owner` and `admin`.
- Custom role definitions can contain it: yes.
- Assignments containing it are visible to fixed owner/admin through custom-role management: yes.
- Currently enforced in TypeScript tenant custom-role allowlist: no.
- Currently enforced in SQL tenant custom-role allowlist: no.
- Feature 088 test explicitly verifies that custom `organization_users.change_roles` does not grant role changes.

`organization_users.remove`:

- Exists in `TENANT_CAPABILITIES`: yes.
- Exists in SQL `capabilities`: yes.
- Fixed role mapping: system `owner` and `admin`.
- Custom role definitions can contain it: yes.
- Assignments containing it are visible to fixed owner/admin through custom-role management: yes.
- Currently enforced in TypeScript tenant custom-role allowlist: no.
- Currently enforced in SQL tenant custom-role allowlist: no.
- Feature 088 test explicitly verifies that custom `organization_users.remove` does not grant member removal.

Feature 089 allowlist recommendation:

- Add both `organization_users.change_roles` and `organization_users.remove` to the TypeScript and SQL enforced tenant custom-role allowlists only if Feature 089 implements both target-sensitive helpers and matching tests.
- Do not add either key as a broad permission.
- Do not interpret either key through `resolveTenantPermissions(...).canManageMembers`.

## Target-role safety model for role changes

Delegated role changers should not receive owner/admin-equivalent authority.

Recommended target rules:

- Fixed owner/admin behavior remains unchanged.
- Delegated custom role changer can only target current `reviewer` or `photographer` rows.
- Delegated custom role changer can only assign next role `reviewer` or `photographer`.
- Delegated custom role changer cannot target `owner`.
- Delegated custom role changer cannot target `admin`.
- Delegated custom role changer cannot assign `owner`.
- Delegated custom role changer cannot assign `admin`.
- Delegated custom role changer cannot change self.

Answers:

- Should delegated role changers be allowed to assign `admin`? No.
- Should delegated role changers be allowed to change an `admin` to another role? No.
- Should delegated role changers be allowed to change another delegated organization-user manager? Only if that target's current fixed role is `reviewer` or `photographer`. The capability assignment itself should not make a target admin-equivalent or protected from low-risk role changes, but this is an open product decision because a delegated user could disrupt another delegated user.
- Should delegated role changers be allowed to change themselves? No.
- Should delegated role changers be limited to reviewer/photographer targets? Yes.
- Should delegated role changers be limited to reviewer/photographer next roles? Yes.
- Should delegated role changes preserve reviewer assignment cleanup? Yes.
- Should changing photographer to reviewer create reviewer access assignments? No.
- Should changing reviewer to photographer revoke active reviewer access assignments? Yes.

## Target safety model for member removal

Delegated removers should not receive owner/admin-equivalent authority.

Recommended target rules:

- Fixed owner/admin behavior remains unchanged.
- Delegated custom remover can only remove current `reviewer` or `photographer` rows.
- Delegated custom remover cannot remove `owner`.
- Delegated custom remover cannot remove `admin`.
- Delegated custom remover cannot remove self.

Answers:

- Should delegated removers be allowed to remove admins? No.
- Should delegated removers be allowed to remove owners? No.
- Should delegated removers be allowed to remove other delegated organization-user managers? Only if the target is a current `reviewer` or `photographer`. This is functional but disruptive, so it should be called out in plan-phase acceptance criteria.
- Should delegated removers be allowed to remove themselves? No.
- Should delegated removers be limited to reviewer/photographer targets? Yes.
- Should removal of a reviewer target clean up reviewer access assignments through current cascade? Yes.
- Should removal of a custom-role-assigned target clean up custom-role assignments through current cascade? Yes.
- Does removal need additional audit beyond current membership deletion and assignment cleanup? No new audit substrate exists in this area. Feature 089 should not introduce a broad audit system; tests should verify existing cleanup behavior.

## SQL/RLS helper design

Do not broaden:

- `app.current_user_can_manage_members(p_tenant_id)`

Recommended new helpers:

- `app.current_user_can_change_organization_user_role(p_tenant_id uuid, p_target_user_id uuid, p_next_role text)`
- `app.current_user_can_remove_organization_user(p_tenant_id uuid, p_target_user_id uuid)`
- public wrappers for focused tests:
  - `public.current_user_can_change_organization_user_role(...)`
  - `public.current_user_can_remove_organization_user(...)`

Recommended SQL behavior:

- Return false when `auth.uid()` is null.
- Return true for fixed owner/admin with current fixed semantics, subject to existing target constraints:
  - target exists in tenant
  - target role is not `owner`
  - next role is in `admin`, `reviewer`, `photographer` for role changes
- For custom-role delegation:
  - actor must have tenant membership in `p_tenant_id`
  - actor must have active tenant-scoped custom role capability
  - assignment must be tenant scope only
  - assignment must not be revoked
  - role definition must be tenant custom role, not system role
  - role definition must not be archived
  - target must be in same tenant
  - target must not be actor
  - target current role must be `reviewer` or `photographer`
  - next role for role changes must be `reviewer` or `photographer`

RLS policy recommendation:

- Keep `memberships_select_organization_user_rows` for read/list behavior.
- Replace or augment membership update policy so role changes can pass when either:
  - current fixed owner/admin helper allows the existing behavior, or
  - new target-sensitive role-change helper allows the custom delegated behavior.
- Replace or augment membership delete policy so deletion can pass when either:
  - current fixed owner/admin helper allows the existing behavior, or
  - new target-sensitive removal helper allows the custom delegated behavior.
- Preserve `with check` role restriction that prevents assigning `owner`.

RPC recommendation:

- No new mutation RPC is required for the current service design. Existing service-layer `memberships.update(...)` and `memberships.delete(...)` can keep working if RLS update/delete policies call the new helpers.
- Public authenticated wrappers are useful for tests because prior features already test SQL helpers directly.

## TypeScript helper design

Recommended extension in `src/lib/tenant/organization-user-access.ts`:

- Extend `resolveOrganizationUserAccess(...)` to check `organization_users.change_roles` and `organization_users.remove` for non-owner/admin users.
- Keep fixed owner/admin as the short-circuit full-access case.
- Add target-sensitive helpers:
  - `assertCanChangeOrganizationUserRole(...)`
  - `assertCanRemoveOrganizationUser(...)`
  - `canChangeOrganizationUserRoleTarget(...)`
  - `canRemoveOrganizationUserTarget(...)`

Recommended TypeScript behavior:

- Load the actor membership through `resolveTenantMembership(...)`.
- Load the target membership before deciding target-sensitive authorization.
- Fixed owner/admin should preserve current behavior:
  - no owner target changes/removal
  - role-change next role limited to `admin`, `reviewer`, `photographer`
  - admin targets remain manageable
- Custom-role users should pass only when:
  - capability exists through tenant custom role
  - target role is `reviewer` or `photographer`
  - next role is `reviewer` or `photographer` for role changes
  - target is not self
- Return or throw structured denial codes useful for API/UI/tests:
  - `organization_user_role_change_forbidden`
  - `organization_user_remove_forbidden`
  - `organization_user_target_forbidden`
  - `organization_user_self_target_forbidden`
  - `invalid_membership_role`
  - existing `owner_membership_immutable`

Service integration recommendation:

- `updateTenantMemberRole(...)` should call the new role-change assertion instead of `assertTenantMemberManager(...)`.
- `removeTenantMember(...)` should call the new removal assertion instead of `assertTenantMemberManager(...)`.
- The service should still load the target row and preserve owner immutability and reviewer cleanup.
- The route should continue deriving tenant id server-side.

SQL and TypeScript parity:

- TypeScript and SQL should define the same delegated target roles and next roles.
- Tests should intentionally cover mismatches: service says yes but RLS says no, and helper says no for the same denied cases.
- Avoid introducing a generic effective permission engine.

## Members page UI/control gating implications

Follow `UNCODEXIFY.md`:

- no IAM dashboard
- no access matrix
- no decorative permission console
- keep the existing Members page structure
- use normal tables, selects, and buttons

Recommended UI direction for Feature 089:

- Fixed owner/admin continue using the full `MemberManagementPanel`.
- Delegated users should continue using a reduced Members panel, not receive full role editor/assignment/reviewer access data.
- If custom role change is implemented, delegated role controls should appear only on target rows whose current role is `reviewer` or `photographer`, and not on the actor's own row.
- Delegated role dropdown should include only `reviewer` and `photographer`.
- If custom removal is implemented, delegated remove controls should appear only on target rows whose current role is `reviewer` or `photographer`, and not on the actor's own row.
- Owner and admin rows may remain visible for users with `organization_users.manage`, but should be read-only.
- Self rows should be read-only for delegated users.
- Custom role editor, custom role assignment, and reviewer access controls should remain hidden for delegated users.

Data model implication:

- `OrganizationUserDirectoryMemberRecord` will likely need per-row booleans such as:
  - `canChangeRole`
  - `allowedRoleOptions`
  - `canRemove`
- Do not serialize privileged role editor, custom assignment, or reviewer access details to delegated users.

i18n implications:

- Add English and Dutch keys for delegated role-change/remove success, denial, and confirmation copy.
- Existing capability labels for `organizationUsersChangeRoles` and `organizationUsersRemove` already exist in `messages/en.json` and `messages/nl.json`.
- Existing delegated copy says role changes/removals are owner/admin-managed; this must change if Feature 089 implements delegated controls.

## Interaction with custom role editor and assignment

Feature 089 should not grant custom role editor or custom role assignment authority.

Verified current behavior:

- `listRoleEditorData(...)`, `createCustomRole(...)`, `updateCustomRole(...)`, and `archiveCustomRole(...)` call a fixed `assertTenantMemberManager(...)`.
- That helper uses `resolveTenantPermissions(...).canManageMembers`, which remains fixed owner/admin.
- `resolveCustomRoleAssignmentSummary(...)`, `grantCustomRoleToMember(...)`, and `revokeCustomRoleFromMember(...)` also require fixed owner/admin through the same pattern.
- Feature 088 tests assert custom `organization_users.manage`, `organization_users.invite`, `organization_users.change_roles`, and `organization_users.remove` do not grant these surfaces.

Feature 089 boundary:

- Custom `organization_users.change_roles` must not grant role editor access.
- Custom `organization_users.remove` must not grant role editor access.
- Custom `organization_users.change_roles` must not grant custom role assignment access.
- Custom `organization_users.remove` must not grant custom role assignment access.
- Custom role editor routes remain fixed owner/admin.
- Custom role assignment routes remain fixed owner/admin.

## Interaction with reviewer access

Feature 089 should not grant reviewer access assignment authority.

Verified current behavior:

- Tenant-wide reviewer access routes call `grantTenantWideReviewerAccess(...)` and `revokeTenantWideReviewerAccess(...)`.
- Project reviewer access surfaces call `listProjectReviewerAssignments(...)`, `grantProjectReviewerAccess(...)`, and `revokeProjectReviewerAccess(...)`.
- `reviewer-access-service.ts` uses a fixed owner/admin `assertTenantMemberManager(...)`.
- Project page loads `ProjectReviewerAccessPanel` only when `projectPermissions.canManageMembers` is true, and that remains fixed-role-derived.
- Feature 088 tests assert organization-user custom roles do not grant reviewer access management.

Feature 089 boundary:

- Custom `organization_users.change_roles` must not grant tenant-wide reviewer access grant/revoke.
- Custom `organization_users.remove` must not grant tenant-wide reviewer access grant/revoke.
- Custom `organization_users.change_roles` must not grant project reviewer access grant/revoke.
- Custom `organization_users.remove` must not grant project reviewer access grant/revoke.
- Reviewer access routes remain fixed owner/admin.

Cleanup behavior:

- Changing a reviewer target away from reviewer should still revoke active reviewer access assignments.
- Changing photographer to reviewer should not create reviewer access assignments.

## Options considered

### Option A - Role-change only, low-risk targets

Implement custom `organization_users.change_roles` only for reviewer/photographer targets and reviewer/photographer next roles.

Pros:

- Smaller blast radius than implementing both capabilities.
- Exercises target-sensitive update authorization.
- Preserves removal as fixed owner/admin.

Cons:

- Leaves half of the organization-user capability group unenforced.
- Still needs both TypeScript and SQL/RLS target-sensitive work.

### Option B - Removal only, low-risk targets

Implement custom `organization_users.remove` only for reviewer/photographer targets.

Pros:

- Smaller UI than role changes.
- Reuses existing membership delete cascade cleanup.

Cons:

- Removal is destructive organization access loss.
- A delegated user could remove another delegated user if that target is reviewer/photographer.
- Does not prove role-change target/next-role handling.

### Option C - Role-change and removal, low-risk targets

Implement both capabilities with strict target restrictions.

Pros:

- Aligns the remaining organization-user capability keys with enforceable bounded behavior.
- TypeScript and SQL can support this cleanly because the live service already loads target memberships before mutation.
- The same target-role model can be shared across helpers and UI row booleans.
- Preserves owner/admin full behavior while avoiding admin/owner/self delegation.

Cons:

- Requires careful parity tests across TypeScript helper, service route, and RLS.
- Delegated removal remains sensitive.
- UI needs row-level action gating instead of a simple fixed-role panel split.

### Option D - Full role-change/removal delegation

Implement both broadly for custom-role users.

Rejected.

Reason:

- Broad delegation would allow custom-role users to manage admins or assign admin, which is owner/admin-equivalent power.
- Live code does not contain product rules that prevent privilege escalation in this model.

### Option E - Defer implementation

Do not implement role-change/removal delegation yet.

Rejected as the primary recommendation.

Reason:

- Live code can support target-sensitive authorization cleanly in TypeScript and SQL/RLS.
- The remaining risks are manageable if Feature 089 stays limited to reviewer/photographer targets and next roles.

## Recommended bounded Feature 089 implementation scope

Recommendation: Option C.

Recommended Feature 089 title:

Organization User Role-Change and Removal Custom-Role Enforcement

Exact implementation scope:

- Enforce tenant custom `organization_users.change_roles` only for reviewer/photographer targets and reviewer/photographer next roles.
- Enforce tenant custom `organization_users.remove` only for reviewer/photographer targets.
- Keep owner/admin target management fixed owner/admin only.
- Keep assigning `admin` fixed owner/admin only.
- Keep assigning `owner` impossible through this path.
- Keep self-target role changes/removal denied for delegated custom-role users.
- Preserve existing fixed owner/admin full behavior.
- Preserve existing reviewer assignment cleanup on role change.
- Preserve existing role assignment cleanup on removal.

Capabilities to enforce now:

- `organization_users.change_roles`
- `organization_users.remove`

Capabilities to defer:

- custom role editor delegation
- custom role assignment delegation
- reviewer access assignment delegation
- invite-to-custom-role
- project-scoped organization-user enforcement
- workspace-scoped organization-user enforcement

Role changes are in scope:

- yes, bounded to reviewer/photographer targets and reviewer/photographer next roles for delegated custom-role users

Member removal is in scope:

- yes, bounded to reviewer/photographer targets for delegated custom-role users

## Explicit target and next role restrictions

Delegated custom `organization_users.change_roles`:

- current target role allowed: `reviewer`, `photographer`
- next role allowed: `reviewer`, `photographer`
- target `owner`: denied
- target `admin`: denied
- next `owner`: denied
- next `admin`: denied
- self-target: denied

Delegated custom `organization_users.remove`:

- current target role allowed: `reviewer`, `photographer`
- target `owner`: denied
- target `admin`: denied
- self-target: denied

Fixed owner/admin:

- preserve current behavior:
  - may assign `admin`, `reviewer`, `photographer`
  - may change or remove `admin`, `reviewer`, `photographer`
  - may not assign `owner`
  - may not change or remove `owner`

## Explicit delegation boundaries

Custom role editor delegation:

- out of scope
- remains fixed owner/admin

Custom role assignment delegation:

- out of scope
- remains fixed owner/admin

Reviewer access delegation:

- out of scope
- tenant-wide reviewer access grant/revoke remains fixed owner/admin
- project reviewer access grant/revoke remains fixed owner/admin

## Security and tenant-isolation risks

Primary risks:

- privilege escalation by assigning `admin`
- privilege escalation or disruption by changing/removing admin users
- owner safety violations
- self-removal or self-demotion causing ambiguous active-tenant behavior
- cross-tenant target lookup mistakes
- mismatched TypeScript and SQL authorization decisions
- accidental broadening of `app.current_user_can_manage_members(...)`
- leaking privileged role editor, custom assignment, or reviewer access data to delegated users

Required mitigations:

- Tenant id stays server-derived.
- All target membership queries include `tenant_id = input.tenantId`.
- SQL helpers inspect the target membership row in the same tenant.
- SQL helpers enforce no self-target for delegated custom-role users.
- TypeScript helpers enforce the same target and next-role rules.
- RLS update/delete policies use target-sensitive helpers.
- `resolveTenantPermissions(...).canManageMembers` remains fixed-role-derived.
- `app.current_user_can_manage_members(...)` remains fixed owner/admin.
- Project-scoped and workspace-scoped custom role assignments do not grant tenant organization-user permissions.
- Revoked assignments and archived roles do not grant access.

## SQL/RLS and TypeScript parity considerations

The implementation must keep these pairs aligned:

- TypeScript custom-role allowlist and SQL custom-role allowlist.
- TypeScript target role list and SQL target role list.
- TypeScript next role list and SQL next role list.
- TypeScript self-target denial and SQL self-target denial.
- Service route authorization and RLS update/delete authorization.

Recommended pattern:

- Define small TypeScript constants for delegated manageable target roles and next roles.
- Mirror the same literal lists in the migration.
- Add tests that call both service helpers and public SQL helper wrappers for each important allow/deny case.
- Avoid broad helper names that imply full member management.

## UI/control gating implications

Recommended delegated Members UI:

- show normal member table when delegated user can view organization users
- show read-only owner/admin rows
- show self row read-only
- for reviewer/photographer rows:
  - show role dropdown only if delegated user has `organization_users.change_roles`
  - dropdown options only `reviewer` and `photographer`
  - show remove button only if delegated user has `organization_users.remove`
- keep delegated invite UI behavior unchanged
- keep full member management panel for fixed owner/admin only
- keep custom role editor, custom role assignment, and reviewer access UI hidden in delegated panel

Reduced response model additions:

- `canChangeRole`
- `allowedRoleOptions`
- `canRemove`

No visual redesign is needed.

## Non-expansion boundaries

Feature 089 must not grant:

- project creation beyond existing `projects.create`
- project workspace management beyond existing `project_workspaces.manage`
- capture/upload
- review
- workflow/finalization
- correction
- Media Library access or folder management beyond existing Media Library capabilities
- templates/profiles beyond existing template/profile capabilities
- custom role editor access
- custom role assignment access
- reviewer access assignment
- invite-to-custom-role
- project-scoped custom-role enforcement
- workspace-scoped custom-role enforcement
- generic effective permission engine
- owner transfer
- owner demotion
- member-level deny/override rules
- agency/client hierarchy

## Test recommendations

Add focused Feature 089 tests, likely:

- `tests/feature-089-organization-user-role-change-and-removal-custom-role-enforcement.test.ts`

Recommended TypeScript/service tests:

- fixed owner/admin role changes remain unchanged
- fixed owner/admin can assign admin
- fixed owner/admin cannot assign owner
- fixed owner/admin cannot change owner rows
- custom `organization_users.change_roles` can change reviewer to photographer
- custom `organization_users.change_roles` can change photographer to reviewer
- custom `organization_users.change_roles` cannot assign admin
- custom `organization_users.change_roles` cannot assign owner
- custom `organization_users.change_roles` cannot change admin target
- custom `organization_users.change_roles` cannot change owner target
- custom `organization_users.change_roles` cannot change self
- custom `organization_users.remove` can remove reviewer
- custom `organization_users.remove` can remove photographer
- custom `organization_users.remove` cannot remove admin
- custom `organization_users.remove` cannot remove owner
- custom `organization_users.remove` cannot remove self
- custom `organization_users.manage` alone cannot change roles or remove
- custom `organization_users.invite` alone cannot change roles or remove

Recommended SQL/RLS tests:

- public SQL wrappers return true for fixed owner/admin where current behavior allows
- public SQL wrappers return true for delegated reviewer/photographer target cases
- public SQL wrappers return false for delegated admin/owner/self target cases
- `memberships.update(...)` succeeds for delegated allowed role change
- `memberships.update(...)` fails for delegated admin/owner/self/next-admin cases
- `memberships.delete(...)` succeeds for delegated allowed removal
- `memberships.delete(...)` fails for delegated admin/owner/self cases
- `current_user_can_manage_members(...)` remains false for delegated users

Assignment scope tests:

- active tenant-scoped assignment grants
- revoked assignment does not grant
- archived role does not grant
- cross-tenant role/assignment does not grant
- project-scoped assignment does not grant
- workspace-scoped assignment does not grant

Cleanup tests:

- reviewer to photographer revokes active reviewer assignments
- photographer to reviewer does not create reviewer assignments
- member removal cascades reviewer access assignments
- member removal cascades tenant custom-role assignments
- role change leaves custom-role assignments intact

UI/data tests:

- delegated response includes row-level role/remove booleans only, not full privileged data
- delegated users do not receive `reviewerAccess`, `roleEditor`, `assignableCustomRoles`, or `customRoleAssignments`
- delegated role dropdown only includes reviewer/photographer
- owner/admin/self rows are read-only for delegated users

Non-expansion tests:

- custom `organization_users.change_roles` does not grant role editor access
- custom `organization_users.remove` does not grant role editor access
- custom `organization_users.change_roles` does not grant custom role assignment access
- custom `organization_users.remove` does not grant custom role assignment access
- custom organization-user capabilities do not grant reviewer access management
- custom organization-user capabilities do not grant Media Library/template/profile/project/capture/review capabilities unless those explicit separate capabilities are assigned

## Fresh reset/dev data considerations

Assume local development can use `supabase db reset`.

Tests should create their own:

- tenants
- memberships for owner/admin/reviewer/photographer
- pending invites where needed
- custom role definitions
- capability mappings
- active tenant-scoped role assignments
- revoked assignments
- archived custom roles
- cross-tenant role definitions and assignments
- project-scoped and workspace-scoped assignments
- reviewer access assignments
- custom role assignments

No backfill or arbitrary local data repair is recommended for Feature 089 unless plan-phase live verification discovers a production migration requirement.

## Likely implementation phases for the plan document

1. Add shared TypeScript target-rule helpers in `organization-user-access.ts`.
2. Add `organization_users.change_roles` and `organization_users.remove` to the TypeScript enforced tenant custom-role allowlist.
3. Update `updateTenantMemberRole(...)` and `removeTenantMember(...)` to use target-sensitive authorization while preserving cleanup behavior.
4. Add migration that extends SQL enforced allowlist and creates target-sensitive role-change/removal helpers plus public wrappers.
5. Update membership update/delete RLS policies to call the target-sensitive helpers without broadening `current_user_can_manage_members`.
6. Extend reduced organization-user data model with row-level action booleans.
7. Update delegated Members UI controls with normal table/select/button behavior and i18n keys.
8. Add Feature 089 tests for TypeScript, SQL/RLS, service cleanup, UI data shape, and non-expansion boundaries.

## Open decisions for the plan phase

- Should delegated users be able to change or remove another delegated user who is currently fixed `reviewer` or `photographer`? Recommended default: yes if target role is low-risk, but product should acknowledge the operational disruption risk.
- Should Feature 089 add an explicit fixed owner/admin self-removal or self-demotion guard? Recommended default: no, because the goal is to preserve fixed owner/admin behavior unless separately requested.
- Should delegated users with only `organization_users.change_roles` but not `organization_users.manage` see the member list in order to act? Recommended default: yes, role-change/remove should imply the minimum list data needed for target rows, but this needs explicit plan-phase data-model design.
- Should role-change and removal action success messages reuse current member table messages or add delegated-specific messages? Recommended default: add explicit delegated error keys, reuse neutral success copy where it still fits.

## Final recommendation

Choose Option C.

Feature 089 should enforce both `organization_users.change_roles` and `organization_users.remove` for tenant-scoped custom roles, but only with strict target-sensitive restrictions:

- delegated role changes: reviewer/photographer targets only, reviewer/photographer next roles only
- delegated removals: reviewer/photographer targets only
- no delegated owner target management
- no delegated admin target management
- no delegated admin assignment
- no delegated owner assignment
- no delegated self role changes
- no delegated self removal

Keep `resolveTenantPermissions(...).canManageMembers` and `app.current_user_can_manage_members(...)` fixed owner/admin only. Add separate TypeScript and SQL target-sensitive helpers for role changes and removal, and preserve all current cleanup behavior.
