# Feature 089 - Organization user role-change and removal custom-role enforcement plan

## 1. Scope and contract

Feature 089 implements bounded delegation for the remaining organization-user mutation capabilities:

- `organization_users.change_roles`
- `organization_users.remove`

The implementation must allow tenant-scoped active custom-role assignments to perform only low-risk member role changes and removals. Delegated users must not become owner/admin equivalents.

In scope:

- Enforce custom `organization_users.change_roles` for current `reviewer` and `photographer` targets only.
- Allow delegated role changes only to next role `reviewer` or `photographer`.
- Enforce custom `organization_users.remove` for current `reviewer` and `photographer` targets only.
- Add target-sensitive TypeScript authorization helpers.
- Add target-sensitive SQL helpers and update membership update/delete RLS.
- Add row-level action booleans to the reduced delegated Members data model.
- Add minimal delegated Members UI controls for allowed rows.
- Preserve reviewer assignment cleanup on reviewer-to-non-reviewer role change.
- Preserve membership-delete cascade cleanup for role assignments.

Out of scope:

- Owner transfer or owner demotion.
- Delegated admin assignment.
- Delegated admin or owner target management.
- Delegated self role-change or self-removal.
- Custom role editor delegation.
- Custom role assignment delegation.
- Reviewer access grant/revoke delegation.
- Invite-to-custom-role.
- Project-scoped or workspace-scoped organization-user permissions.
- Generic effective permission engine.
- Member-level deny/override rules.
- Project, capture, review, correction, Media Library, template, or profile behavior changes.

## 2. Inputs and ground truth

Read first:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `UNCODEXIFY.md`
- `docs/rpi/README.md`
- `docs/rpi/SUMMARY.md`
- Feature 070, 080, 081, 082, 083, 084, 085, 086, 087, 088 RPI plans and relevant research
- `docs/rpi/089-organization-user-role-change-and-removal-custom-role-enforcement/research.md`

Plan-critical live files verified:

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
- `src/app/api/members/invites/**`
- `src/app/(protected)/members/page.tsx`
- `src/components/members/member-management-panel.tsx`
- `src/components/members/delegated-member-management-panel.tsx`
- `messages/en.json`
- `messages/nl.json`
- Feature 070, 081, 082, and 088 migrations
- Feature 070, 080, 081, 082, 084, 087, and 088 tests

Ground-truth note: `docs/rpi/SUMMARY.md` is stale about the 087 slice. Live code and migrations contain Feature 087 project-administration enforcement and are authoritative.

## 3. Verified current member role-change/removal boundary

Current fixed role boundary:

- `owner` and `admin` fixed membership roles derive `canManageMembers=true` through `resolveTenantPermissions`.
- `reviewer` and `photographer` fixed membership roles derive `canManageMembers=false`.
- `MANAGEABLE_MEMBERSHIP_ROLES` is `["admin", "reviewer", "photographer"]`.
- `owner` is not assignable or inviteable through normal member-management flows.

Current role-change behavior:

- `PATCH /api/members/[userId]` derives tenant and actor server-side through `requireAuthenticatedTenantContext`.
- The route validates the request body role against `MANAGEABLE_MEMBERSHIP_ROLES`.
- `updateTenantMemberRole(...)` calls the fixed owner/admin `assertTenantMemberManager`.
- The service loads the target membership by server-derived tenant id and route target user id.
- Missing targets return `member_not_found`.
- Owner targets throw `owner_membership_immutable`.
- Fixed owner/admin can currently assign `admin`, `reviewer`, or `photographer`.
- If the current target role is `reviewer` and the next role is not `reviewer`, `revokeActiveReviewerAssignmentsForMember(...)` revokes active system reviewer assignments.
- Changing `photographer` to `reviewer` does not create reviewer access assignments.

Current removal behavior:

- `DELETE /api/members/[userId]` derives tenant and actor server-side through `requireAuthenticatedTenantContext`.
- `removeTenantMember(...)` calls the fixed owner/admin `assertTenantMemberManager`.
- The service loads the target membership by tenant and user id.
- Missing targets return `member_not_found`.
- Owner targets throw `owner_membership_immutable`.
- Removal deletes only the `memberships` row. It does not delete the auth user.
- `role_assignments` has a foreign key to `(tenant_id, user_id)` on `memberships` with `on delete cascade`, so system reviewer assignments and tenant custom-role assignments are removed with the membership row.
- If a removed user has no memberships left, tenant resolution can later create or select a different tenant according to the existing `resolve-tenant` behavior; Feature 089 must not add special preservation logic.

Current Feature 088 delegated behavior:

- `resolveOrganizationUserAccess(...)` returns full organization-user booleans for fixed owner/admin.
- Non-owner/admin users currently get custom-role access only for `organization_users.manage` and `organization_users.invite`.
- Custom `organization_users.manage` gives reduced member/invite listing.
- Custom `organization_users.invite` gives bounded invite create/resend/revoke for reviewer/photographer roles and only the actor's own pending delegated invites when list access is absent.
- Custom `organization_users.change_roles` and `organization_users.remove` currently resolve to false because they are not in the enforced allowlist.
- `getOrganizationUserDirectoryData(...)` returns reduced data and omits role editor, custom role assignments, assignable roles, and reviewer access summaries.
- `DelegatedMemberManagementPanel` currently renders reduced read/list and invite workflows only; role changes and removals are absent.

Current SQL/RLS boundary:

- `app.current_user_can_manage_members(p_tenant_id)` remains fixed owner/admin only.
- Membership update policy currently uses `app.current_user_can_manage_members(tenant_id) and role <> 'owner'` in `USING`, and `app.current_user_can_manage_members(tenant_id) and role in ('admin', 'reviewer', 'photographer')` in `WITH CHECK`.
- Membership delete policy uses fixed owner/admin and protects owner rows.
- `app.current_user_has_tenant_custom_role_capability(...)` currently enforces only the Feature 088 custom-role allowlist through `organization_users.manage` and `organization_users.invite` plus earlier shipped custom-role capabilities.

## 4. Recommendation

Implement Option C from the research:

- Enforce both `organization_users.change_roles` and `organization_users.remove`.
- Keep fixed owner/admin behavior unchanged.
- Allow delegated role changes only for another member whose current fixed role is `reviewer` or `photographer`, and only to next role `reviewer` or `photographer`.
- Allow delegated removal only for another member whose current fixed role is `reviewer` or `photographer`.
- Deny delegated self-targeting.
- Deny delegated owner/admin targets.
- Deny delegated owner/admin assignment.
- Do not introduce a custom-role hierarchy.

Delegated users may change or remove another delegated user if that target's fixed membership role is `reviewer` or `photographer` and the target is not self. This is an operational disruption risk, but adding hierarchy or manager immunity would be a larger authorization model. Owners/admins can recover through fixed authority.

## 5. Chosen target-sensitive access model

Fixed owner/admin:

- May assign `admin`, `reviewer`, and `photographer`.
- May change `admin`, `reviewer`, and `photographer` targets.
- May remove `admin`, `reviewer`, and `photographer` targets.
- May not assign `owner`.
- May not change or remove owner targets through normal paths.
- Existing self behavior is preserved for fixed owner/admin; do not add a new fixed-role self restriction in this slice unless live tests expose a regression.

Delegated custom `organization_users.change_roles`:

- May change another member from `reviewer` to `photographer`.
- May change another member from `photographer` to `reviewer`.
- May not target `owner`.
- May not target `admin`.
- May not target self.
- May not assign `admin`.
- May not assign `owner`.
- May not use project-scoped or workspace-scoped custom assignments for tenant-level role changes.

Delegated custom `organization_users.remove`:

- May remove another member whose current fixed role is `reviewer`.
- May remove another member whose current fixed role is `photographer`.
- May not remove `owner`.
- May not remove `admin`.
- May not remove self.
- May not use project-scoped or workspace-scoped custom assignments for tenant-level removal.

Custom-role validity:

- Only active tenant-scoped custom role assignments count.
- Revoked assignments do not count.
- Archived custom roles do not count.
- System role assignments do not count for these custom-role capabilities.
- Cross-tenant assignments do not count.

## 6. Exact TypeScript helper plan

Primary module: `src/lib/tenant/organization-user-access.ts`.

Update `resolveOrganizationUserAccess(...)`:

- Add custom-role resolution for `organization_users.change_roles` and `organization_users.remove`.
- Keep fixed owner/admin short-circuit with all current organization-user booleans.
- For non-owner/admin, compute:
  - `canViewOrganizationUsers` if the actor has `organization_users.manage`, `organization_users.change_roles`, or `organization_users.remove`.
  - `canInviteOrganizationUsers` if the actor has `organization_users.invite`.
  - `canChangeOrganizationUserRoles` if the actor has `organization_users.change_roles`.
  - `canRemoveOrganizationUsers` if the actor has `organization_users.remove`.
- Do not call `resolveTenantPermissions(...).canManageMembers` to authorize delegated role change/removal.

Add helpers:

- `canChangeOrganizationUserRoleTarget(input)`:
  - Inputs: actor access, actor user id, target membership, next role.
  - Fixed owner/admin returns true when target role is not `owner` and next role is in `MANAGEABLE_MEMBERSHIP_ROLES`.
  - Delegated users require `canChangeOrganizationUserRoles`, target user id not self, target role in `reviewer`/`photographer`, and next role in `reviewer`/`photographer`.
  - Return a structured result such as `{ allowed: boolean; reason?: OrganizationUserTargetDenialReason; allowedRoleOptions: ManageableMembershipRole[] }`.
- `canRemoveOrganizationUserTarget(input)`:
  - Fixed owner/admin returns true when target role is not `owner`.
  - Delegated users require `canRemoveOrganizationUsers`, target user id not self, and target role in `reviewer`/`photographer`.
  - Return a structured result with denial reason.
- `assertCanChangeOrganizationUserRole(input)`:
  - Loads or receives target membership for the active tenant.
  - Throws `member_not_found` if no target membership exists.
  - Throws `owner_membership_immutable` for owner targets in the fixed owner/admin path to preserve current behavior.
  - Throws specific delegated errors otherwise.
- `assertCanRemoveOrganizationUser(input)`:
  - Same target load behavior.
  - Preserves `owner_membership_immutable` for owner targets in fixed owner/admin path.
  - Throws specific delegated errors otherwise.

Recommended error codes:

- `organization_user_role_change_forbidden` for no role-change capability.
- `organization_user_remove_forbidden` for no remove capability.
- `organization_user_target_forbidden` for admin/owner or otherwise disallowed delegated targets.
- `organization_user_self_target_forbidden` for self-target denial.
- `invalid_membership_role` for invalid next role.
- Preserve `owner_membership_immutable`.
- Preserve `member_not_found`.

Keep SQL and TypeScript aligned by expressing the same fixed and delegated predicates in tests:

- Fixed: owner/admin actor, target not owner, next role manageable.
- Delegated role change: tenant-scoped custom capability, target not self, old role reviewer/photographer, next role reviewer/photographer.
- Delegated remove: tenant-scoped custom capability, target not self, old role reviewer/photographer.

## 7. Exact service integration plan

Update `src/lib/tenant/member-management-service.ts`.

`updateTenantMemberRole(...)`:

- Keep route validation against `MANAGEABLE_MEMBERSHIP_ROLES`.
- Load target membership before authorizing, as the target fixed role is part of the decision.
- Replace the broad `assertTenantMemberManager(...)` call with `assertCanChangeOrganizationUserRole(...)`.
- Preserve fixed owner/admin behavior:
  - owner/admin may assign `admin`, `reviewer`, `photographer`.
  - owner target remains immutable.
- Preserve delegated behavior:
  - require `organization_users.change_roles`.
  - deny self.
  - deny admin/owner targets.
  - allow reviewer/photographer targets only.
  - allow reviewer/photographer next roles only.
- Keep tenant id server-derived and use only the route target user id plus validated body role.
- Preserve reviewer cleanup:
  - reviewer -> photographer by delegated user revokes active system reviewer assignments.
  - reviewer -> admin by fixed owner/admin still revokes active system reviewer assignments.
  - photographer -> reviewer creates no reviewer assignments.
- Keep custom role assignments intact on fixed role changes.
- Return updated row data with new row-level action fields for delegated callers if the response shape is shared.

`removeTenantMember(...)`:

- Load target membership before authorizing.
- Replace the broad `assertTenantMemberManager(...)` call with `assertCanRemoveOrganizationUser(...)`.
- Preserve fixed owner/admin behavior:
  - owner target remains immutable.
  - admin/reviewer/photographer targets remain removable.
- Preserve delegated behavior:
  - require `organization_users.remove`.
  - deny self.
  - deny admin/owner targets.
  - allow reviewer/photographer targets only.
- Continue deleting only the membership row.
- Do not add manual assignment cleanup unless the live schema changes; the current FK cascade is the cleanup contract.

Invite services:

- Do not change Feature 088 invite behavior.
- `organization_users.change_roles` and `organization_users.remove` must not imply invite authority unless the custom role also has `organization_users.invite`.

## 8. Exact SQL/RLS helper and policy plan

Create a new migration, for example:

- `supabase/migrations/<timestamp>_089_organization_user_role_change_remove_custom_role_enforcement.sql`

Do not broaden:

- `app.current_user_can_manage_members(p_tenant_id)`
- `public.current_user_can_manage_members(p_tenant_id)`

Update enforced SQL custom-role allowlist:

- Add `organization_users.change_roles`.
- Add `organization_users.remove`.

Add helpers:

- `app.current_user_can_change_organization_user_role(p_tenant_id uuid, p_target_user_id uuid, p_next_role text)`
- `app.current_user_can_remove_organization_user(p_tenant_id uuid, p_target_user_id uuid)`
- `public.current_user_can_change_organization_user_role(...)`
- `public.current_user_can_remove_organization_user(...)`

Helper behavior:

- Return false if `auth.uid()` is null.
- Fixed owner/admin path:
  - Change helper returns true when target exists in tenant, target role is not `owner`, and `p_next_role in ('admin', 'reviewer', 'photographer')`.
  - Remove helper returns true when target exists in tenant and target role is not `owner`.
- Delegated custom-role path:
  - Require active tenant-scoped custom role capability.
  - Ignore revoked assignments.
  - Ignore archived roles.
  - Ignore system roles.
  - Ignore project/workspace-scoped assignments.
  - Deny self-target.
  - For role change, require current target role in `('reviewer', 'photographer')` and `p_next_role in ('reviewer', 'photographer')`.
  - For removal, require current target role in `('reviewer', 'photographer')`.

Membership update RLS strategy:

- Update policy must handle old row and new row separately because PostgreSQL `USING` sees the existing row and `WITH CHECK` sees the new row.
- Do not rely on one helper that queries current table state for both old and new values inside the same policy.
- Use direct policy predicates or split internal helpers so old/new row safety is explicit.

Recommended update policy shape:

```sql
drop policy if exists "memberships_update_manage_member_rows" on public.memberships;
create policy "memberships_update_manage_member_rows"
on public.memberships
for update
to authenticated
using (
  (
    app.current_user_can_manage_members(tenant_id)
    and role <> 'owner'
  )
  or (
    auth.uid() is not null
    and user_id <> auth.uid()
    and role in ('reviewer', 'photographer')
    and app.current_user_has_tenant_custom_role_capability(
      tenant_id,
      'organization_users.change_roles'
    )
  )
)
with check (
  (
    app.current_user_can_manage_members(tenant_id)
    and role in ('admin', 'reviewer', 'photographer')
  )
  or (
    auth.uid() is not null
    and user_id <> auth.uid()
    and role in ('reviewer', 'photographer')
    and app.current_user_has_tenant_custom_role_capability(
      tenant_id,
      'organization_users.change_roles'
    )
  )
);
```

Notes:

- In `USING`, `role` is the old target role, so delegated users can only select reviewer/photographer rows for update.
- In `WITH CHECK`, `role` is the new role, so delegated users can only write reviewer/photographer.
- The primary key and tenant id are not supposed to change through service code. If the migration wants extra SQL hardening for tenant/user immutability during update, add a trigger instead of relying on application behavior.
- The public role-change helper remains useful for tests and service parity, but the RLS policy should keep old/new checks explicit.

Membership delete RLS strategy:

```sql
drop policy if exists "memberships_delete_manage_member_rows" on public.memberships;
create policy "memberships_delete_manage_member_rows"
on public.memberships
for delete
to authenticated
using (
  (
    app.current_user_can_manage_members(tenant_id)
    and role <> 'owner'
  )
  or (
    auth.uid() is not null
    and user_id <> auth.uid()
    and role in ('reviewer', 'photographer')
    and app.current_user_has_tenant_custom_role_capability(
      tenant_id,
      'organization_users.remove'
    )
  )
);
```

Public wrappers:

- Add wrappers only for test visibility.
- Revoke all from public, then grant execute to authenticated, following existing migration style.

## 9. Enforced allowlist plan

Update `src/lib/tenant/tenant-custom-role-capabilities.ts`:

- Add `organization_users.change_roles`.
- Add `organization_users.remove`.

Update SQL `app.current_user_has_tenant_custom_role_capability(...)` enforced list:

- Add `organization_users.change_roles`.
- Add `organization_users.remove`.

Do not add broader semantics:

- These capabilities do not grant role editor access.
- These capabilities do not grant custom role assignment access.
- These capabilities do not grant reviewer access assignment access.
- These capabilities do not grant invite management unless the role also has `organization_users.invite`.
- These capabilities imply only the minimum reduced member-list visibility needed to act.

## 10. Delegated member-list data plan

Extend `OrganizationUserDirectoryData` and member rows.

Decision:

- A user with only `organization_users.change_roles` can view the reduced member list because they need target rows to act.
- A user with only `organization_users.remove` can view the reduced member list because they need target rows to act.
- This implied visibility is reduced directory visibility only, not full member-management data.

Add row-level fields to `OrganizationUserDirectoryMemberRecord`:

- `canChangeRole: boolean`
- `allowedRoleOptions: ManageableMembershipRole[]`
- `canRemove: boolean`

Row computation:

- For fixed owner/admin full panel, preserve existing `TenantMemberRecord.canEdit` behavior for full member management.
- For delegated data:
  - Owner rows: `canChangeRole=false`, `allowedRoleOptions=[]`, `canRemove=false`.
  - Admin rows: `canChangeRole=false`, `allowedRoleOptions=[]`, `canRemove=false`.
  - Self row: `canChangeRole=false`, `allowedRoleOptions=[]`, `canRemove=false`.
  - Reviewer/photographer row with change capability: `canChangeRole=true`, `allowedRoleOptions=["reviewer", "photographer"]`.
  - Reviewer/photographer row with remove capability: `canRemove=true`.

Do not include:

- Role editor data.
- Assignable custom roles.
- Custom role assignment summaries.
- Reviewer access summaries.
- Pending admin-invite mutation controls for delegated users.

## 11. UI/i18n plan

Keep full fixed owner/admin UI:

- `MemberManagementPanel` remains the full panel for fixed owner/admin.
- Do not hide existing owner/admin controls from fixed owner/admin beyond current owner immutability.

Update delegated UI:

- Continue using `DelegatedMemberManagementPanel`.
- Show owner, admin, and self rows as read-only.
- Show a role dropdown only when `member.canChangeRole` is true.
- Delegated dropdown options must come from `member.allowedRoleOptions` and be only `reviewer`/`photographer`.
- Show "Save role" only for rows with `canChangeRole`.
- Show "Remove" only for rows with `canRemove`.
- Keep delegated invite UI unchanged.
- Do not render custom role editor controls.
- Do not render custom role assignment controls.
- Do not render reviewer access controls.
- Do not add IAM dashboards, access matrices, permission consoles, or decorative layouts. Keep the existing table/forms/buttons structure.

Update page/nav gating:

- `MembersPage` should load delegated data when any reduced organization-user action is available:
  - view/list
  - invite
  - role change
  - remove
- Members navigation should likewise include users with `organization_users.change_roles` or `organization_users.remove`, because those capabilities imply minimum reduced member-list visibility.

I18n additions in `messages/en.json` and `messages/nl.json`:

- Delegated helper text that role changes/removals are limited to reviewers and photographers.
- Delegated role-change success.
- Delegated role-change forbidden/fallback error.
- Delegated remove success.
- Delegated remove forbidden/fallback error.
- Self-target denial copy if surfaced from route errors.
- Target forbidden copy.
- Confirmation copy can reuse `membersTable.removeConfirm` unless the UI needs a delegated-specific variant.

Update existing delegated copy that currently says role changes/removals remain owner/admin-only.

## 12. Cleanup behavior plan

Role change:

- Reviewer -> photographer by delegated user revokes active system reviewer assignments through the existing `revokeActiveReviewerAssignmentsForMember(...)`.
- Reviewer -> admin by fixed owner/admin still revokes active system reviewer assignments.
- Photographer -> reviewer creates no reviewer assignments.
- Custom role assignments remain intact on fixed role changes and delegated reviewer/photographer role changes.

Removal:

- Deleting a membership row cascades all `role_assignments` rows for that `(tenant_id, user_id)`.
- This cascade removes active and revoked custom-role assignment rows.
- This cascade removes active and revoked system reviewer assignment rows.
- Do not add separate cleanup code unless the live schema changes.

## 13. Security and tenant isolation plan

Mitigations:

- Delegated admin assignment: blocked by route validation plus TypeScript next-role restriction plus RLS `WITH CHECK`.
- Delegated owner assignment: blocked by `MANAGEABLE_MEMBERSHIP_ROLES`, SQL membership role check, and RLS.
- Delegated admin target management: blocked by TypeScript target-role restriction and RLS `USING`.
- Delegated owner target management: blocked by TypeScript owner immutability and RLS `USING`.
- Delegated self-target: blocked by TypeScript and SQL `auth.uid() <> user_id`.
- Cross-tenant target ids: target membership is loaded by server-derived tenant id; SQL helpers and RLS operate on row tenant id.
- Revoked assignments: ignored by enforced custom-role helper.
- Archived roles: ignored by enforced custom-role helper.
- Project/workspace-scoped assignments: ignored by enforced custom-role helper.
- TypeScript allows but RLS denies: service should surface a forbidden/conflict error and tests should cover parity.
- RLS allows but TypeScript denies: route/service tests should cover denial before write.
- Privileged data leakage: delegated data remains reduced and row-action based.
- Role editor/custom assignment/reviewer assignment exposure: existing services remain fixed owner/admin and full panel remains fixed owner/admin only.
- Active tenant switching: continue to derive tenant through existing server-side tenant resolution; never accept tenant id from client.

## 14. Fresh reset and seed/dev data plan

Development validation assumes fresh local state:

- Run `supabase db reset` during implementation validation.
- Do not backfill, repair, or preserve arbitrary old local role/custom-role assignment rows.

Tests must create their own:

- Tenants.
- Owner/admin/reviewer/photographer users.
- Custom role definitions.
- Capability mappings.
- Active tenant-scoped assignments.
- Revoked assignments.
- Archived roles.
- Cross-tenant assignments.
- Project-scoped assignments.
- Workspace-scoped assignments.
- Pending invites where invite non-regression is tested.
- Reviewer access assignments where cleanup is tested.
- Custom role assignments where cleanup is tested.

## 15. Test plan

TypeScript/service tests:

- Fixed owner/admin behavior remains unchanged.
- Fixed owner/admin can assign admin.
- Fixed owner/admin cannot assign owner.
- Fixed owner/admin cannot change/remove owner.
- Custom `organization_users.change_roles` can change reviewer to photographer.
- Custom `organization_users.change_roles` can change photographer to reviewer.
- Custom `organization_users.change_roles` cannot assign admin.
- Custom `organization_users.change_roles` cannot assign owner.
- Custom `organization_users.change_roles` cannot change admin target.
- Custom `organization_users.change_roles` cannot change owner target.
- Custom `organization_users.change_roles` cannot change self.
- Custom `organization_users.remove` can remove reviewer.
- Custom `organization_users.remove` can remove photographer.
- Custom `organization_users.remove` cannot remove admin.
- Custom `organization_users.remove` cannot remove owner.
- Custom `organization_users.remove` cannot remove self.
- Custom `organization_users.manage` alone cannot change/remove.
- Custom `organization_users.invite` alone cannot change/remove.
- Delegated change/remove can target another delegated user only when that target's fixed role is reviewer/photographer and not self.

SQL/RLS tests:

- Public wrappers return expected allow/deny decisions.
- Membership update succeeds for delegated reviewer/photographer allowed cases.
- Membership update fails for delegated admin target, owner target, self target, next admin, and next owner cases.
- Membership delete succeeds for delegated reviewer/photographer allowed cases.
- Membership delete fails for delegated admin target, owner target, and self target cases.
- `current_user_can_manage_members(...)` remains false for delegated custom-role users.
- Revoked assignment denied.
- Archived role denied.
- Cross-tenant assignment denied.
- Project-scoped assignment denied.
- Workspace-scoped assignment denied.
- RLS old/new role behavior is covered: old target role must be reviewer/photographer and new role must be reviewer/photographer.

Cleanup tests:

- Reviewer to photographer revokes active reviewer assignments.
- Photographer to reviewer does not create reviewer assignments.
- Member removal cascades reviewer assignments.
- Member removal cascades custom role assignments.
- Fixed role change leaves custom role assignments intact.

UI/data tests:

- Delegated response includes row-level `canChangeRole`, `allowedRoleOptions`, and `canRemove`.
- Delegated response does not include full privileged data.
- Delegated role dropdown only includes reviewer/photographer.
- Owner/admin/self rows are read-only for delegated users.
- Delegated remove controls render only for allowed rows.
- Members navigation/page access includes change-role-only and remove-only users.

Non-expansion tests:

- `organization_users.change_roles` does not grant role editor access.
- `organization_users.remove` does not grant role editor access.
- Neither capability grants custom role assignment access.
- Neither capability grants reviewer access management.
- Neither capability grants Media Library access.
- Neither capability grants template/profile access.
- Neither capability grants project creation or workspace management.
- Neither capability grants capture, review, workflow/finalization, or correction access.
- Neither capability grants invite management unless `organization_users.invite` is also assigned.

Recommended implementation test files:

- Add a new `tests/feature-089-organization-user-role-change-and-removal-custom-role-enforcement.test.ts`.
- Update targeted UI tests or add Feature 089 UI assertions alongside the new test file.
- Keep existing Feature 088 deferral test updated to reflect that role change/removal are no longer deferred, while preserving deferrals for role editor, custom role assignment, reviewer access, and unrelated capabilities.

## 16. Risks and edge cases

- Delegated users can disrupt other delegated reviewer/photographer users. This is accepted for Feature 089 because the safety model is based on fixed target role plus self-protection, not custom-role hierarchy.
- Fixed owner/admin self behavior should remain unchanged to avoid broad behavior drift.
- Admin assignment is the main escalation risk and must be blocked in both TypeScript and SQL for delegated users.
- PostgreSQL update RLS old/new row mismatch is a real risk; keep `USING` and `WITH CHECK` predicates explicit.
- A removed user can lose their active tenant and may later bootstrap/select another tenant through existing resolution. Do not add custom recovery behavior.
- Owner immutability must remain enforced even if the service target load and RLS checks disagree.
- Membership cascade deletes role assignment history for the removed member. This is live behavior and should be preserved for this slice.
- Reduced data can leak too much if full panel data is reused. Keep delegated data separate.
- Reduced data can leak too little if change/remove-only users cannot see members. Feature 089 explicitly makes those capabilities imply reduced member-list visibility.
- Future audit requirements are not addressed here. Do not introduce audit tables in this slice.

## 17. Implementation phases

1. Capability allowlists and access resolver
   - Add both capability keys to the TypeScript enforced custom-role allowlist.
   - Extend `resolveOrganizationUserAccess(...)`.
   - Add target-sensitive helper functions and structured denial reasons.

2. Service integration
   - Update `updateTenantMemberRole(...)` to use target-sensitive role-change assertions.
   - Update `removeTenantMember(...)` to use target-sensitive removal assertions.
   - Preserve reviewer cleanup and membership-only deletion.

3. SQL/RLS migration
   - Add both capability keys to the SQL enforced custom-role allowlist.
   - Add app helpers and public wrappers.
   - Update membership update/delete policies with explicit old/new row predicates.
   - Preserve `current_user_can_manage_members(...)` unchanged.

4. Delegated data model
   - Add row-level action booleans and allowed role options.
   - Make change/remove imply reduced member-list visibility.
   - Keep full privileged data out of delegated responses.

5. UI and i18n
   - Add delegated row role-change/remove controls.
   - Update Members page/nav gating.
   - Add English and Dutch copy.

6. Tests and validation
   - Add Feature 089 service/RLS/UI/non-expansion tests.
   - Update Feature 088 deferral expectations.
   - Run `supabase db reset`.
   - Run targeted Feature 089 tests, then relevant 070/081/082/084/087/088 tests.
   - Run lint/test commands required by the repo.

## 18. Clear scope boundaries

Feature 089 must not grant:

- Project creation.
- Project workspace management.
- Capture/upload.
- Review.
- Workflow/finalization.
- Correction.
- Media Library access or folder management.
- Template/profile access or management.
- Custom role editor access.
- Custom role assignment access.
- Reviewer access assignment access.
- Invite-to-custom-role.
- Project-scoped custom-role enforcement for organization-user permissions.
- Workspace-scoped custom-role enforcement for organization-user permissions.
- Generic effective permission engine.
- Owner transfer/demotion.
- Member-level deny/override rules.
- Agency/client hierarchy.

Feature 089 changes only:

- Target-sensitive delegated role changes between `reviewer` and `photographer`.
- Target-sensitive delegated removal of `reviewer` and `photographer`.
- Reduced delegated member-list visibility and row controls needed for those two actions.

## 19. Concise implementation prompt

Implement Feature 089 exactly as planned in `docs/rpi/089-organization-user-role-change-and-removal-custom-role-enforcement/plan.md`. Enforce tenant custom-role capabilities `organization_users.change_roles` and `organization_users.remove` only through target-sensitive TypeScript and SQL/RLS checks. Keep `resolveTenantPermissions(...).canManageMembers` and `app.current_user_can_manage_members(...)` fixed owner/admin only. Delegated users may change only non-self reviewer/photographer targets to reviewer/photographer, and may remove only non-self reviewer/photographer targets. They may not target owners/admins, assign owners/admins, or access role editor, custom role assignment, reviewer access management, invite management, or unrelated project/media/template/profile permissions unless separately authorized by existing capabilities. Preserve owner immutability, reviewer assignment cleanup on reviewer-to-non-reviewer role changes, and membership-delete cascade cleanup. Add row-level delegated Members UI controls and tests for TypeScript, SQL/RLS parity, cleanup, UI data shape, and non-expansion. Validate with `supabase db reset` and targeted Feature 089 plus relevant 070/081/082/084/087/088 tests.
