# Feature 088 - Organization User Read/List and Invite Custom-Role Enforcement Plan

## Scope and contract

Feature 088 migrates the safest organization-user/member-management slice from fixed owner/admin-only enforcement to tenant-scoped custom-role enforcement.

In scope:

- Enforce `organization_users.manage` as limited Members page read/list access.
- Enforce `organization_users.invite` as bounded organization invite create/resend/revoke access.
- Preserve fixed owner/admin full member-management authority.
- Preserve the existing outbound email, invite acceptance, role-change, removal, custom role, reviewer access, Media Library, template/profile, and project-administration behavior.

Out of scope:

- `organization_users.change_roles`
- `organization_users.remove`
- custom role editor delegation
- custom role assignment delegation
- reviewer access grant/revoke delegation
- admin role-change delegation
- admin removal delegation
- owner transfer or demotion
- invite-to-custom-role
- project-scoped or workspace-scoped organization-user custom-role enforcement
- generic app-wide effective permission engine

This plan is implementation guidance only. Do not implement code in the plan phase.

## Inputs and ground truth

Read first:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `UNCODEXIFY.md`
- `docs/rpi/README.md`
- `docs/rpi/SUMMARY.md`
- `docs/rpi/088-organization-user-management-custom-role-enforcement/research.md`

Targeted live verification covered:

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
- `src/app/(protected)/layout.tsx`
- `src/app/(protected)/members/page.tsx`
- `src/components/navigation/protected-nav.tsx`
- `src/components/members/member-management-panel.tsx`
- `src/components/members/custom-role-management-section.tsx`
- `src/app/api/members/**`
- `messages/en.json`
- `messages/nl.json`
- Feature 070, 081, 083, 084, 085, 086, and 087 SQL migrations
- Feature 070, 082, 083, 084, 085, 086, and 087 tests

`docs/rpi/SUMMARY.md` is useful orientation but stale for Feature 087. Live code and migrations show Feature 087 project-administration custom-role enforcement is implemented in `20260430170000_087_project_admin_custom_role_enforcement.sql`, and the current enforced tenant custom-role allowlist includes project-administration capabilities.

## Verified current boundary from targeted verification

Current catalog and fixed-role mapping:

- `TENANT_CAPABILITIES` includes `organization_users.manage`, `organization_users.invite`, `organization_users.change_roles`, and `organization_users.remove`.
- Fixed `owner` and `admin` map to all four organization-user capabilities.
- Fixed `reviewer` and `photographer` do not map to organization-user capabilities.
- SQL capability seed rows exist for all four keys through the Feature 081 foundation.

Current enforced tenant custom-role allowlist:

- `media_library.access`
- `media_library.manage_folders`
- `templates.manage`
- `profiles.view`
- `profiles.manage`
- `projects.create`
- `project_workspaces.manage`

`organization_users.*` capabilities are not currently in the TypeScript or SQL enforced custom-role allowlists.

Current member-management behavior:

- `resolveTenantPermissions(...).canManageMembers` is fixed-role-derived through `roleHasCapability(role, "organization_users.manage")`.
- `member-management-service.ts` has an umbrella `assertTenantMemberManager(...)` gate using `resolveTenantPermissions(...).canManageMembers`.
- `getTenantMemberManagementData(...)` is full management data only and loads members, pending invites, reviewer access summaries, custom role editor data, assignable custom roles, and custom role assignment summaries.
- Invite create/resend/revoke, fixed role change, and member removal all use the same umbrella TypeScript manager gate today.
- `app.current_user_can_manage_members(p_tenant_id)` is SQL owner/admin only and is used broadly by membership and invite RLS plus invite RPCs.
- The security-definer invite RPCs currently call the broad member-management helper.
- Custom role editor SQL RPCs have explicit owner/admin checks.
- Custom role assignment service uses the umbrella member manager gate and service-role writes.
- Reviewer access service has its own fixed owner/admin guard.

Current UI behavior:

- Protected nav shows Members only when `permissions.canManageMembers` is true.
- `/members` calls `getTenantMemberManagementData(...)`.
- `MemberManagementPanel` receives the full privileged data model and renders invite controls, member role controls, remove controls, custom role editor, custom role assignment controls, and reviewer access controls.

## Locked feature scope

Feature 088 implements exactly two custom-role-enforced capabilities:

- `organization_users.manage`: limited read/list access.
- `organization_users.invite`: bounded invite management.

Feature 088 does not make `resolveTenantPermissions(...).canManageMembers` custom-role aware. That permission remains fixed-role-derived because existing code uses it as a broad member-management signal.

Feature 088 does not broaden `app.current_user_can_manage_members(p_tenant_id)`. That helper remains owner/admin only because it protects broad membership writes, role editor surfaces, custom role assignments, reviewer access surfaces, and legacy full-management policies.

## Explicit deferral of `organization_users.change_roles`

Do not add `organization_users.change_roles` to the TypeScript or SQL enforced custom-role allowlist.

Keep these fixed owner/admin only:

- `PATCH /api/members/[userId]`
- `updateTenantMemberRole(...)`
- membership role update RLS protected by `app.current_user_can_manage_members(...)`

Owner rows stay immutable. Owner role assignment stays unavailable. Existing reviewer assignment cleanup on role changes remains unchanged for owner/admin paths.

Tests must prove that a tenant-scoped custom role containing `organization_users.change_roles` does not grant fixed role changes.

## Explicit deferral of `organization_users.remove`

Do not add `organization_users.remove` to the TypeScript or SQL enforced custom-role allowlist.

Keep these fixed owner/admin only:

- `DELETE /api/members/[userId]`
- `removeTenantMember(...)`
- membership delete RLS protected by `app.current_user_can_manage_members(...)`

Owner removal protection stays in place. Member removal continues to delete only the membership row, not the auth account, and dependent role assignments continue to be cleaned up by current schema behavior.

Tests must prove that a tenant-scoped custom role containing `organization_users.remove` does not grant member removal.

## Explicit custom role editor delegation boundary

Keep custom role editor delegation out of Feature 088.

These routes and services remain fixed owner/admin only:

- `GET /api/members/roles`
- `POST /api/members/roles`
- `PATCH /api/members/roles/[roleId]`
- `POST /api/members/roles/[roleId]/archive`
- `custom-role-service.ts`
- Feature 083 SQL RPCs
- `CustomRoleManagementSection`

Do not let `organization_users.manage` or `organization_users.invite` expose role editor data or actions. Future delegation should use a separate role-management capability, not organization-user read/list or invite authority.

## Explicit custom role assignment delegation boundary

Keep custom role assignment delegation out of Feature 088.

These routes and services remain fixed owner/admin only:

- `GET /api/members/custom-role-assignments`
- `POST /api/members/[userId]/custom-roles`
- `DELETE /api/members/[userId]/custom-roles/[roleId]`
- `custom-role-assignment-service.ts`

Delegated organization-user users must not receive assignable custom roles, custom role assignment summaries, or assignment controls. This prevents a delegated user from assigning a powerful custom role to themselves or another user.

## Explicit reviewer access delegation boundary

Keep reviewer access grant/revoke delegation out of Feature 088.

These routes and services remain fixed owner/admin only:

- `GET /api/members/reviewer-access`
- `POST /api/members/[userId]/reviewer-access/tenant-wide`
- `DELETE /api/members/[userId]/reviewer-access/tenant-wide`
- project reviewer access routes
- `reviewer-access-service.ts`

`organization_users.change_roles` must not imply reviewer access grant/revoke, and Feature 088 does not introduce `reviewer_access.manage`. Feature 082 reviewer eligibility and tenant/project reviewer access behavior remains unchanged.

## Chosen organization-user read/list model

`organization_users.manage` grants limited read/list access only.

Allowed reduced data:

- active member email
- active member fixed role
- active member joined date
- owner/admin/reviewer/photographer labels
- pending invite email
- pending invite fixed role
- pending invite status, expiry, and last-sent metadata where already shown today
- per-invite read-only action flags, with all mutation flags false unless the actor also has invite authority for that specific invite

Not allowed:

- invite creation unless the actor also has `organization_users.invite`
- invite resend or revoke unless the actor also has `organization_users.invite` and passes the ownership rule
- fixed role changes
- member removal
- custom role editor data
- assignable custom roles
- custom role assignment summaries
- custom role assignment controls
- reviewer access summaries
- reviewer access controls

Users with `organization_users.manage` can see owner rows and pending admin invites as read-only rows. Owner rows remain strictly read-only and no controls should be rendered for them.

## Chosen delegated invite model

`organization_users.invite` grants bounded invite management.

Fixed owner/admin behavior remains unchanged:

- can invite `admin`, `reviewer`, and `photographer`
- cannot invite `owner`
- can resend all pending invites
- can revoke all pending invites
- continue through the existing outbound email foundation and external-origin URL pattern

Delegated custom-role inviters may:

- create invites for `reviewer`
- create invites for `photographer`
- resend allowed pending invites according to the ownership rule below
- revoke allowed pending invites according to the ownership rule below

Delegated custom-role inviters must not:

- invite `owner`
- invite `admin`
- resend an invite whose current or effective role is `admin`
- revoke an invite whose role is `admin`
- attach custom roles to invites
- change fixed roles
- remove members

`organization_users.invite` does not imply broad member listing. Invite-only users receive only the minimum data needed for invite controls and their own allowed pending invite rows.

## Chosen delegated resend/revoke ownership rule

Use the safer first-slice rule:

- Fixed owner/admin can resend and revoke all pending invites.
- Delegated `organization_users.invite` users can resend and revoke only active pending invites that they created.
- For delegated users, the invite row must have `invited_by_user_id = auth.uid()`.
- For delegated users, the invite role must be `reviewer` or `photographer`.
- Delegated users cannot mutate admin pending invites, owner invites, accepted invites, revoked invites, expired invites, or pending invites created by another actor.

This avoids a delegated inviter taking over an admin-created invite or disrupting another manager's pending invite. It also limits the impact of the pending invite uniqueness rule on `(tenant_id, normalized_email)`: a delegated user cannot refresh, downgrade, revoke, or rotate tokens for someone else's pending invite.

## Chosen TypeScript authorization architecture

Add a focused organization-user access module, for example:

- `src/lib/tenant/organization-user-access.ts`

Recommended exports:

- `resolveOrganizationUserAccess(...)`
- `assertCanViewOrganizationUsers(...)`
- `assertCanInviteOrganizationUsers(...)`
- `assertCanChangeOrganizationUserRoles(...)`
- `assertCanRemoveOrganizationUsers(...)`

`resolveOrganizationUserAccess(...)` should derive:

- `membership`
- `isFixedOwnerAdmin`
- `canViewOrganizationUsers`
- `canInviteOrganizationUsers`
- `canChangeOrganizationUserRoles`
- `canRemoveOrganizationUsers`
- `allowedInviteRoles`
- `canManageAllPendingInvites`

Rules:

- `isFixedOwnerAdmin` is true for fixed `owner` or `admin`.
- `canViewOrganizationUsers` is true for fixed owner/admin or tenant-scoped custom `organization_users.manage`.
- `canInviteOrganizationUsers` is true for fixed owner/admin or tenant-scoped custom `organization_users.invite`.
- `canChangeOrganizationUserRoles` remains fixed owner/admin only.
- `canRemoveOrganizationUsers` remains fixed owner/admin only.
- Fixed owner/admin `allowedInviteRoles` are `admin`, `reviewer`, and `photographer`.
- Delegated custom inviter `allowedInviteRoles` are `reviewer` and `photographer`.

Implementation notes:

- Use the existing bounded tenant custom-role helper, not a generic effective permission engine.
- Keep `resolveTenantPermissions(...).canManageMembers` fixed-role-derived.
- Do not import organization-user custom-role checks into broad fixed-role permission paths.
- The change-role and remove assertion helpers may wrap the existing fixed member-manager check, but they must not accept custom `organization_users.change_roles` or `organization_users.remove` in Feature 088.

## Chosen SQL/RLS helper architecture

Do not broaden:

- `app.current_user_can_manage_members(p_tenant_id)`

Add a new migration after Feature 087 that updates the tenant custom-role allowlist and adds focused helpers.

Allowlist update:

- Add `organization_users.manage`.
- Add `organization_users.invite`.
- Do not add `organization_users.change_roles`.
- Do not add `organization_users.remove`.

Preserve all existing tenant custom-role predicates:

- authenticated user
- active tenant membership
- assignment tenant and user match
- `scope_type = 'tenant'`
- `project_id is null`
- `workspace_id is null`
- `revoked_at is null`
- role definition is a tenant custom role
- role definition belongs to the same tenant
- role definition is not archived
- requested capability is in the hard enforced allowlist

Add helpers:

- `app.current_user_can_view_organization_users(p_tenant_id uuid)`
- `app.current_user_can_invite_organization_users(p_tenant_id uuid, p_target_role text default null)`
- `app.current_user_can_manage_own_pending_organization_invite(p_tenant_id uuid, p_invite_id uuid, p_target_role text default null)`

Helper behavior:

- Fixed owner/admin pass view and invite helpers.
- Fixed owner/admin can invite `admin`, `reviewer`, and `photographer`.
- Custom `organization_users.manage` passes only the view helper.
- Custom `organization_users.invite` passes the invite helper only when `p_target_role` is null or `reviewer`/`photographer`.
- Custom `organization_users.invite` fails the invite helper for `admin` and `owner`.
- The own-pending-invite helper passes fixed owner/admin for invite rows in their tenant.
- The own-pending-invite helper passes delegated custom inviters only when the invite belongs to the same tenant, is pending, has `invited_by_user_id = auth.uid()`, and has role `reviewer` or `photographer`.

RLS policy plan:

- Keep existing broad membership and invite management policies unchanged.
- Add a membership select policy for reduced organization-user reads using `app.current_user_can_view_organization_users(tenant_id)`.
- Add an invite select policy that allows:
  - reduced read/list users to see pending invite rows through `app.current_user_can_view_organization_users(tenant_id)`;
  - invite-only users to see their own pending non-admin invites through `app.current_user_can_invite_organization_users(tenant_id, null)` plus `invited_by_user_id = auth.uid()` and role in `reviewer`, `photographer`.
- Do not add broad delegated insert/update RLS policies. Invite writes should go through the security-definer RPCs with explicit authorization checks.

Expose public authenticated wrappers for testability if consistent with prior features:

- `public.current_user_can_view_organization_users(p_tenant_id uuid)`
- `public.current_user_can_invite_organization_users(p_tenant_id uuid, p_target_role text default null)`

Only expose an own-pending wrapper if tests need direct SQL helper coverage; otherwise validate it through invite RPC tests.

## Exact Members page UI/data plan

Navigation:

- Show Members nav for fixed owner/admin.
- Show Members nav for custom `organization_users.manage`.
- Show Members nav for custom `organization_users.invite`.
- Keep Members nav hidden for users with neither capability.

Page data flow:

- Resolve organization-user access server-side in `/members`.
- If `isFixedOwnerAdmin` is true, call the existing `getTenantMemberManagementData(...)` and render the existing full `MemberManagementPanel`.
- If `isFixedOwnerAdmin` is false and the actor has read or invite access, call a new reduced loader such as `getOrganizationUserDirectoryData(...)` or `getDelegatedMemberManagementData(...)`.
- If the actor has neither read nor invite access, keep the existing unauthorized/read-only fallback behavior.

Reduced loader contract:

- Return access booleans.
- Return allowed invite roles.
- Return active member rows only when `canViewOrganizationUsers` is true.
- Return all pending invite rows only when `canViewOrganizationUsers` is true.
- Return actor-created pending non-admin invite rows when the actor has only `canInviteOrganizationUsers`.
- Return per-invite `canResend` and `canRevoke` flags.
- Do not return custom role editor data.
- Do not return assignable custom roles.
- Do not return custom role assignment summaries.
- Do not return reviewer access summaries.
- Do not return role-change mutation flags.
- Do not return member-removal mutation flags.

UI rendering:

- Keep the existing full `MemberManagementPanel` for fixed owner/admin.
- Add a reduced delegated Members component, or split the existing component only if privileged props are never passed to delegated users.
- For delegated read-only users, render normal members and pending-invites tables with no mutation controls.
- For delegated inviters, render the invite form and allowed pending invite controls.
- For users with both custom capabilities, render reduced read/list plus invite controls.
- Invite role dropdown for delegated users includes only `reviewer` and `photographer`.
- Invite role dropdown for fixed owner/admin continues to include `admin`, `reviewer`, and `photographer`.
- Role-change controls render only for fixed owner/admin.
- Remove controls render only for fixed owner/admin.
- Custom role editor renders only for fixed owner/admin.
- Custom role assignment controls render only for fixed owner/admin.
- Reviewer access controls render only for fixed owner/admin.

Design and i18n:

- Follow `UNCODEXIFY.md`.
- Do not create an IAM dashboard, access matrix, or decorative permission console.
- Keep normal forms, tables, and buttons.
- Add English and Dutch messages for:
  - delegated read-only organization users state
  - delegated invite helper text
  - admin invite forbidden error
  - generic invite forbidden fallback
  - resend forbidden fallback
  - revoke forbidden fallback

## Exact invite API/RPC plan

Affected API routes:

- `GET /api/members`
- `POST /api/members/invites`
- `POST /api/members/invites/[inviteId]/resend`
- `POST /api/members/invites/[inviteId]/revoke`

Keep fixed owner/admin only:

- `PATCH /api/members/[userId]`
- `DELETE /api/members/[userId]`
- `GET /api/members/roles`
- `POST /api/members/roles`
- `PATCH /api/members/roles/[roleId]`
- `POST /api/members/roles/[roleId]/archive`
- `GET /api/members/custom-role-assignments`
- `POST /api/members/[userId]/custom-roles`
- `DELETE /api/members/[userId]/custom-roles/[roleId]`
- `GET /api/members/reviewer-access`
- `POST /api/members/[userId]/reviewer-access/tenant-wide`
- `DELETE /api/members/[userId]/reviewer-access/tenant-wide`
- project reviewer access routes

`GET /api/members`:

- Return full data only to fixed owner/admin.
- Return a discriminated reduced payload to delegated read/invite users, for example `mode: "reduced"`.
- Do not include role editor, assignment, reviewer access, role mutation, or removal data in the reduced payload.
- Return forbidden for users with neither fixed nor delegated access.

`POST /api/members/invites`:

- Server-derive tenant and actor from the authenticated session.
- Fixed owner/admin continue unchanged.
- Delegated users must pass `organization_users.invite`.
- Delegated requested role must be `reviewer` or `photographer`.
- Delegated requested role `admin` returns a forbidden response.
- Requested role `owner` remains invalid/non-inviteable.
- Do not accept custom role assignment data on invite create.

`POST /api/members/invites/[inviteId]/resend`:

- Fixed owner/admin continue unchanged.
- Delegated users must pass `organization_users.invite`.
- Delegated users can resend only their own active pending `reviewer`/`photographer` invites.
- Delegated users cannot resend admin invites or invites created by another actor.
- Token rotation must happen only after authorization succeeds.

`POST /api/members/invites/[inviteId]/revoke`:

- Fixed owner/admin continue unchanged.
- Delegated users must pass `organization_users.invite`.
- Delegated users can revoke only their own active pending `reviewer`/`photographer` invites.
- Delegated users cannot revoke admin invites or invites created by another actor.

SQL RPC updates:

- Update `app.create_or_refresh_tenant_membership_invite(...)` to call `app.current_user_can_invite_organization_users(p_tenant_id, p_role)` instead of the broad member-management helper.
- Preserve existing role validation, normalized email, already-member handling, pending uniqueness, expiry handling, token rotation, and email-token output.
- If a delegated inviter creates an invite for an email that already has a pending invite in the tenant, allow refresh only when that pending invite is their own non-admin invite. Otherwise raise a forbidden/conflict error without mutating the existing row.
- Update `app.refresh_tenant_membership_invite(...)` to authorize through the own-pending helper.
- Update `app.revoke_tenant_membership_invite(...)` to authorize through the own-pending helper.
- Preserve `app.accept_tenant_membership_invite(...)` behavior.

TypeScript service updates:

- `createTenantMemberInvite(...)` should use the new organization-user invite assertion before calling the RPC or rely on a lower-level service wrapper that maps SQL authorization errors consistently.
- `resendTenantMemberInvite(...)` should map delegated forbidden errors without rotating tokens.
- `revokeTenantMemberInvite(...)` should map delegated forbidden errors without mutating rows.
- Keep outbound email delivery through `sendTenantMembershipInviteEmail(...)` and the existing external-origin URL pattern.
- Preserve current idempotency and retry behavior where it exists.

## Security and tenant-isolation plan

Required invariants:

- Tenant id is always server-derived.
- Authenticated user id is always server-derived.
- Custom role checks count only active tenant-scoped assignments for the current user and tenant.
- Revoked assignments do not grant access.
- Archived role definitions do not grant access.
- Cross-tenant assignments do not grant access.
- Project-scoped assignments do not grant tenant-level organization-user access.
- Workspace-scoped assignments do not grant tenant-level organization-user access.
- Fixed owner/admin retain current authority.
- Owner rows remain immutable.
- Owner invites remain impossible.
- Delegated users cannot invite or mutate admin invites.
- Delegated users cannot mutate another actor's pending invite.
- Direct table writes are not opened for delegated invite mutations.
- Service-role reads for member emails run only after authorization succeeds.
- Reduced UI components never receive privileged data.

## SQL/RLS and TypeScript parity plan

For `organization_users.manage`:

- TypeScript `canViewOrganizationUsers` and SQL `current_user_can_view_organization_users` must agree.
- Fixed owner/admin allowed.
- Active tenant-scoped custom role with `organization_users.manage` allowed for reduced read/list.
- No-capability roles denied.
- Revoked assignments denied.
- Archived roles denied.
- Cross-tenant assignments denied.
- Project-scoped assignments denied.
- Workspace-scoped assignments denied.
- No write authority granted.

For `organization_users.invite`:

- TypeScript `canInviteOrganizationUsers` and SQL/RPC invite authorization must agree.
- Fixed owner/admin allowed for existing behavior.
- Active tenant-scoped custom role with `organization_users.invite` allowed only for delegated invite scope.
- Delegated `reviewer` invite allowed.
- Delegated `photographer` invite allowed.
- Delegated `admin` invite denied.
- Delegated `owner` invite denied.
- Delegated resend/revoke limited to actor-created non-admin pending invites.
- No-capability roles denied.
- Revoked assignments denied.
- Archived roles denied.
- Cross-tenant assignments denied.
- Project-scoped assignments denied.
- Workspace-scoped assignments denied.

For full member management:

- `resolveTenantPermissions(...).canManageMembers` remains fixed-role-derived.
- `app.current_user_can_manage_members(...)` remains fixed owner/admin.
- Existing full management routes remain fixed owner/admin.

## Test plan

Add focused Feature 088 tests, likely in:

- `tests/feature-088-organization-user-read-list-and-invite-custom-role-enforcement.test.ts`

Access resolution tests:

- fixed owner/admin has full member-management access
- custom `organization_users.manage` has reduced read/list access
- custom `organization_users.invite` has delegated invite access
- user with both custom capabilities has both reduced read/list and invite access
- no-capability custom role denied
- revoked assignment denied
- archived role denied
- cross-tenant assignment denied
- project-scoped assignment denied
- workspace-scoped assignment denied

Members page and data loading tests:

- fixed owner/admin receives full management data
- delegated read/list user receives reduced data only
- delegated invite user receives only invite-needed data
- delegated users do not receive custom role editor data
- delegated users do not receive custom role assignment data
- delegated users do not receive reviewer access summaries
- role-change and removal mutation flags are absent or false for delegated users

Invite behavior tests:

- fixed owner/admin can invite admin/reviewer/photographer as before
- custom `organization_users.invite` can invite reviewer
- custom `organization_users.invite` can invite photographer
- custom `organization_users.invite` cannot invite admin
- custom `organization_users.invite` cannot invite owner
- custom `organization_users.invite` can resend actor-created non-admin pending invites
- custom `organization_users.invite` cannot resend admin pending invites
- custom `organization_users.invite` cannot resend pending invites created by fixed owner/admin or another delegated inviter
- custom `organization_users.invite` can revoke actor-created non-admin pending invites
- custom `organization_users.invite` cannot revoke admin pending invites
- custom `organization_users.invite` cannot revoke pending invites created by fixed owner/admin or another delegated inviter
- invite email delivery still uses the outbound email foundation
- create/resend/revoke retry behavior remains stable

Deferred action tests:

- custom `organization_users.change_roles` does not grant fixed role changes
- custom `organization_users.remove` does not grant member removal
- custom `organization_users.manage` does not grant fixed role changes
- custom `organization_users.invite` does not grant fixed role changes
- custom `organization_users.manage` does not grant member removal
- custom `organization_users.invite` does not grant member removal

Boundary tests:

- custom `organization_users.manage` does not grant role editor access
- custom `organization_users.invite` does not grant role editor access
- custom `organization_users.manage` does not grant custom role assignment access
- custom `organization_users.invite` does not grant custom role assignment access
- custom `organization_users.manage` does not grant reviewer access management
- custom `organization_users.invite` does not grant reviewer access management

Non-expansion tests:

- organization-user custom roles do not grant project creation
- organization-user custom roles do not grant project workspace management
- organization-user custom roles do not grant capture/upload
- organization-user custom roles do not grant review
- organization-user custom roles do not grant workflow/finalization
- organization-user custom roles do not grant correction
- organization-user custom roles do not grant Media Library access or folder management
- organization-user custom roles do not grant templates/profiles
- organization-user custom roles do not grant project-scoped custom-role enforcement
- organization-user custom roles do not grant workspace-scoped custom-role enforcement

Regression tests to run:

- `tests/feature-070-tenant-rbac-foundation.test.ts`
- `tests/feature-082-reviewer-access-assignments.test.ts`
- `tests/feature-083-custom-role-editor-foundation.test.ts`
- `tests/feature-084-custom-role-assignment-foundation.test.ts`
- `tests/feature-085-custom-role-media-library-enforcement.test.ts`
- `tests/feature-086-custom-role-template-profile-enforcement.test.ts`
- `tests/feature-087-project-admin-custom-role-enforcement.test.ts`
- the new Feature 088 test file

Also run:

- `npm run lint`
- `npm test`
- `supabase db reset` before SQL/RLS validation where local state may drift

## Fresh reset/dev data plan

Assume local development can use `supabase db reset`.

Do not preserve, repair, backfill, normalize, or seed arbitrary old local custom-role rows.

Do not add seed custom roles.

Tests should create their own:

- tenants
- owner/admin/reviewer/photographer memberships
- pending invites
- accepted/revoked/expired invites
- custom role definitions
- capability mappings
- active tenant-scoped assignments
- revoked assignments
- archived roles
- cross-tenant roles
- project-scoped assignments
- workspace-scoped assignments
- reviewer access assignments where needed for boundary tests

## Risks and edge cases

Pending invite uniqueness:

- The unique pending invite index on `(tenant_id, normalized_email)` can cause a delegated invite attempt to collide with another actor's pending invite.
- Delegated create-or-refresh must not take over, downgrade, revoke, or rotate another actor's pending invite.
- Return a forbidden/conflict response when the existing pending invite is not an actor-created non-admin invite.

Invite races:

- Two delegated inviters may race to invite the same email.
- The RPC should rely on the unique index and re-check ownership before any refresh/update path.

Token rotation:

- Resend token rotation must happen only after authorization succeeds.
- Unauthorized resend attempts must not change `token_hash`, expiry, or last-sent metadata.

Expired invites:

- Preserve existing expiry handling for owner/admin.
- Delegated users should manage only active pending own non-admin invites.
- Expired rows may be reported through existing outcomes but should not be revived unless the delegated user is allowed to manage that invite and the target role remains reviewer/photographer.

Already-member handling:

- Preserve current same-tenant already-member handling.
- Do not leak cross-tenant membership information.

Email delivery:

- Preserve current outbound email foundation behavior.
- If email delivery fails after a DB invite mutation, preserve the existing retry/idempotency behavior and error mapping.

Data leakage:

- The reduced loader must not fetch or serialize privileged custom-role or reviewer-access data.
- Client-side conditional rendering is not sufficient; privileged props must not be present for delegated users.

## Implementation phases

1. Targeted verification and final API/data-model choice
   - Reconfirm current invite RPC signatures and route response shapes.
   - Decide exact reduced payload discriminant names.
   - Confirm i18n key placement under existing `members` messages.

2. Extend tenant custom-role allowlists
   - Add `organization_users.manage` and `organization_users.invite` to the TypeScript enforced allowlist.
   - Add the same two keys to the SQL enforced allowlist.
   - Do not add `organization_users.change_roles` or `organization_users.remove`.

3. Add organization-user TypeScript access resolver
   - Add the focused access module.
   - Keep `resolveTenantPermissions(...).canManageMembers` fixed-role-derived.
   - Add assertions for view, invite, change roles, and remove with Feature 088 boundaries.

4. Add SQL/RLS organization-user helpers
   - Add view, invite, and own-pending-invite helpers.
   - Add reduced select policies.
   - Keep `app.current_user_can_manage_members(...)` unchanged.
   - Avoid delegated direct table write policies.

5. Update invite RPCs, services, and routes
   - Replace broad invite RPC authorization with focused invite helpers.
   - Preserve fixed owner/admin behavior.
   - Enforce delegated roles and ownership.
   - Map new forbidden cases clearly.
   - Preserve outbound email and token behavior.

6. Add reduced Members data loader and UI gating
   - Keep the existing full loader and `MemberManagementPanel` for fixed owner/admin.
   - Add a reduced loader and reduced delegated component.
   - Update `/members` and `GET /api/members` to return full or reduced data based on server-derived access.
   - Update protected nav visibility to use organization-user access.
   - Add English and Dutch messages.

7. Add parity, UI, invite, deferred-action, and non-expansion tests
   - Cover TypeScript, SQL/RPC, route/service, and UI/data boundaries.
   - Include revoked, archived, cross-tenant, project-scoped, and workspace-scoped custom-role denial cases.

8. Run regressions
   - Run Feature 070, 082, 083, 084, 085, 086, and 087 tests.
   - Run the new Feature 088 tests.
   - Run lint and full test suite as practical.

## Clear scope boundaries

Feature 088 must not grant:

- project creation
- project workspace management
- capture/upload
- review
- workflow/finalization
- correction
- Media Library access
- Media Library folder management
- template management
- profile viewing or management
- custom role editor access
- custom role assignment access
- reviewer access assignment
- fixed role changes
- member removal
- project-scoped organization-user permission enforcement
- workspace-scoped organization-user permission enforcement
- invite-to-custom-role
- owner transfer or demotion
- member-level deny/override rules
- agency/client hierarchy

## Concise implementation prompt

Implement Feature 088 exactly as planned in `docs/rpi/088-organization-user-read-list-and-invite-custom-role-enforcement/plan.md`.

Enforce only `organization_users.manage` and `organization_users.invite` for tenant-scoped custom roles. Keep `organization_users.change_roles`, `organization_users.remove`, custom role editor delegation, custom role assignment delegation, and reviewer access delegation fixed owner/admin only.

Add focused organization-user TypeScript authorizers and SQL helpers without broadening `resolveTenantPermissions(...).canManageMembers` or `app.current_user_can_manage_members(...)`. Add reduced Members page data and UI for delegated read/invite users so privileged role editor, assignment, reviewer access, role-change, and removal data is never serialized to them.

Allow delegated inviters to create only `reviewer` and `photographer` invites and to resend/revoke only active pending non-admin invites they created. Preserve fixed owner/admin invite behavior, owner/admin safety, invite idempotency, outbound email foundation, and all Feature 070/082/083/084/085/086/087 regressions.
