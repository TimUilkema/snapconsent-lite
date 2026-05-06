# Feature 103 Research - Organization Users Page Simplification and Inline Advanced Role Settings

## Inputs reviewed

Project and workflow inputs:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/SUMMARY.md`
- `docs/rpi/PROMPTS.md`
- `docs/rpi/README.md`
- `UNCODEXIFY.md`

Prior RPI context reviewed as background:

- `docs/rpi/070-tenant-rbac-and-organization-user-management-foundation/`
- `docs/rpi/080-advanced-organization-access-management-foundation/`
- `docs/rpi/081-custom-role-definitions-and-scoped-role-assignment-foundation/`
- `docs/rpi/082-project-scoped-reviewer-assignments-and-enforcement/`
- `docs/rpi/083-custom-role-editor-foundation/`
- `docs/rpi/084-custom-role-assignment-foundation/`
- `docs/rpi/088-organization-user-management-custom-role-enforcement/`
- `docs/rpi/089-organization-user-role-change-and-removal-custom-role-enforcement/`
- `docs/rpi/090-role-administration-delegation/`
- `docs/rpi/091-owner-admin-role-administration-consolidation/`
- `docs/rpi/093-scoped-custom-role-assignment-foundation/`
- `docs/rpi/094-effective-scoped-permission-resolver-foundation/`
- `docs/rpi/095-operational-permission-resolver-enforcement/`
- `docs/rpi/096-permission-cleanup-and-effective-access-ui/`

Live implementation, schema, messages, and tests reviewed:

- `src/app/(protected)/members/page.tsx`
- `src/app/(protected)/layout.tsx`
- `src/components/members/member-management-panel.tsx`
- `src/components/members/delegated-member-management-panel.tsx`
- `src/components/members/custom-role-management-section.tsx`
- `src/components/projects/project-reviewer-access-panel.tsx`
- `src/app/api/members/**`
- `src/app/api/projects/[projectId]/reviewer-access/**`
- `src/lib/tenant/member-management-service.ts`
- `src/lib/tenant/organization-user-access.ts`
- `src/lib/tenant/member-management-route-utils.ts`
- `src/lib/tenant/custom-role-service.ts`
- `src/lib/tenant/custom-role-assignment-service.ts`
- `src/lib/tenant/custom-role-scope-effects.ts`
- `src/lib/tenant/reviewer-access-service.ts`
- `src/lib/tenant/member-effective-access-service.ts`
- `src/lib/tenant/effective-permissions.ts`
- `src/lib/tenant/permissions.ts`
- `src/lib/tenant/role-capabilities.ts`
- `messages/en.json`
- `messages/nl.json`
- Relevant migrations from Features 070, 081, 082, 088, 089, 094, and 095
- Relevant tests from Features 070, 080, 081, 082, 083, 084, 088, 089, 091, 093, 094, 095, 096, 099, and 102

Live code, migrations, and tests are the source of truth. Prior RPI documents were used only to understand intent and drift.

## Verified current Organization Users / Members page behavior

The Organization Users page is the protected `/members` route rendered by `src/app/(protected)/members/page.tsx`.

The page is a server component. It:

- creates the Supabase server client;
- requires an authenticated user;
- derives the active tenant through `ensureTenantId(supabase)`;
- resolves organization-user access with `resolveOrganizationUserAccess`;
- renders the full `MemberManagementPanel` only for fixed owner/admin users;
- renders `DelegatedMemberManagementPanel` for non-owner/admin users with delegated organization-user capabilities;
- renders a read-only message and a projects link when the user has no organization-user access.

The protected layout also resolves organization-user access in `src/app/(protected)/layout.tsx` and shows the Members navigation item only when `hasAnyOrganizationUserAccess(...)` is true.

Current full owner/admin default section order in `MemberManagementPanelView`:

1. Status message, when present.
2. Invite member.
3. Role reference.
4. Custom roles editor.
5. Current members table.
6. Pending invites.

Current delegated section order in `DelegatedMemberManagementPanelView`:

1. Status message, when present.
2. Helper text explaining delegated limits.
3. Invite member, only if allowed.
4. Current members table, only if directory visibility is allowed.
5. Pending invites.

The full owner/admin view currently shows advanced role administration by default. This includes a large static fixed-role capability reference, the custom role editor, custom role assignment controls inside each member row, tenant-wide reviewer access controls inside each reviewer row, and a per-member `Access` button for effective access details.

## Current routes, components, and services involved

Page and navigation:

- `/members` -> `src/app/(protected)/members/page.tsx`
- Protected navigation visibility -> `src/app/(protected)/layout.tsx`

Client components on the page:

- `MemberManagementPanel` / `MemberManagementPanelView`: full owner/admin client component.
- `DelegatedMemberManagementPanel` / `DelegatedMemberManagementPanelView`: reduced delegated client component.
- `CustomRoleManagementSection`: custom role definition editor nested inside the full owner/admin panel.

Related reviewer project UI:

- Project-specific reviewer access is not on `/members`; it is rendered by `ProjectReviewerAccessPanel` on `src/app/(protected)/projects/[projectId]/page.tsx` when project permissions allow member management.

Member and organization-user services:

- `getTenantMemberManagementData`: owner/admin full page data.
- `getOrganizationUserDirectoryData`: reduced delegated page data.
- `createTenantMemberInvite`, `resendTenantMemberInvite`, `revokeTenantMemberInvite`.
- `updateTenantMemberRole`, `removeTenantMember`.
- `resolveOrganizationUserAccess` and its target-decision helpers.

Role administration services:

- `listRoleEditorData`, `createCustomRole`, `updateCustomRole`, `archiveCustomRole`.
- `resolveCustomRoleAssignmentSummary`, `grantCustomRoleToMember`, `revokeCustomRoleAssignment`, legacy `revokeCustomRoleFromMember`.
- `listReviewerAccessSummary`, `grantTenantWideReviewerAccess`, `revokeTenantWideReviewerAccess`, `listProjectReviewerAssignments`, `grantProjectReviewerAccess`, `revokeProjectReviewerAccess`.
- `getMemberEffectiveAccessSummary`.

API routes:

- `GET /api/members`
- `POST /api/members/invites`
- `POST /api/members/invites/[inviteId]/resend`
- `POST /api/members/invites/[inviteId]/revoke`
- `PATCH /api/members/[userId]`
- `DELETE /api/members/[userId]`
- `GET /api/members/roles`
- `POST /api/members/roles`
- `PATCH /api/members/roles/[roleId]`
- `POST /api/members/roles/[roleId]/archive`
- `GET /api/members/custom-role-assignments`
- `POST /api/members/[userId]/custom-roles`
- `DELETE /api/members/custom-role-assignments/[assignmentId]`
- `DELETE /api/members/[userId]/custom-roles/[roleId]` as legacy tenant-only revoke compatibility.
- `GET /api/members/reviewer-access`
- `POST /api/members/[userId]/reviewer-access/tenant-wide`
- `DELETE /api/members/[userId]/reviewer-access/tenant-wide`
- `GET /api/members/[userId]/effective-access`
- `GET /api/projects/[projectId]/reviewer-access`
- `POST /api/projects/[projectId]/reviewer-access`
- `DELETE /api/projects/[projectId]/reviewer-access/[userId]`

All these route handlers use `requireAuthenticatedTenantContext`, which derives the tenant server-side. None of the relevant routes accepts `tenant_id` as authority. The custom role assignment route explicitly rejects a body containing `tenantId`.

## Current authorization and visibility boundaries

Fixed owner and fixed admin:

- `resolveOrganizationUserAccess` returns `isFixedOwnerAdmin: true`.
- They can view organization users, invite users, change non-owner roles, remove non-owner users, and manage all pending invites.
- They can invite `admin`, `reviewer`, and `photographer`.
- They cannot assign or mutate `owner` through this UI.
- They receive `TenantMemberManagementData`, which includes members, pending invites, reviewer access summaries, custom role editor data, assignable custom roles, custom role assignment summaries, and assignment target projects/workspaces.

Fixed reviewer:

- Without delegated organization-user custom-role capabilities, they do not get the Members navigation link and receive the read-only page if they access `/members` directly.
- Reviewer project access is controlled separately through active system reviewer role assignments and fixed reviewer membership eligibility.
- A reviewer fixed role alone does not grant role administration.

Fixed photographer:

- Without delegated organization-user custom-role capabilities, they do not get the Members navigation link and receive the read-only page if they access `/members` directly.
- Photographer workspace assignment remains separate from custom roles and reviewer access.
- A photographer fixed role alone does not grant role administration.

Delegated organization-user-management custom-role users:

- `organization_users.manage` grants directory visibility.
- `organization_users.invite` grants invite creation for reviewer and photographer only.
- `organization_users.change_roles` grants visibility plus row-level fixed-role changes only for non-self reviewer/photographer rows, with next roles limited to reviewer/photographer.
- `organization_users.remove` grants visibility plus row-level removal only for non-self reviewer/photographer rows.
- Delegated users receive `OrganizationUserDirectoryData`, not `TenantMemberManagementData`.
- Delegated data intentionally omits `roleEditor`, `assignableCustomRoles`, `customRoleAssignments`, `customRoleAssignmentTargets`, and `reviewerAccess`.
- Delegated UI does not render the role reference, custom role editor, custom role assignment controls, reviewer access controls, or effective access details.

No member-management access:

- The page shows `members.readOnly` and a link back to projects.
- The current read-only copy says only owners/admins can manage organization members. That is now partially stale because delegated users can manage reduced organization-user slices, but the branch is shown only to users with no organization-user access.

Owner/admin-only controls today:

- Role reference, custom role editor, custom role assignment controls, reviewer access controls, and effective access explanations.
- Owner/admin full member table role changes and removals for non-owner rows.
- Pending invite role changes/resend/revoke for all pending invites.

Delegated controls today:

- Invite reviewers/photographers when `organization_users.invite` applies.
- View directory rows when `organization_users.manage`, `organization_users.change_roles`, or `organization_users.remove` applies.
- Change reviewer/photographer fixed roles where row-level decision allows.
- Remove reviewer/photographer rows where row-level decision allows.
- Resend/revoke own pending reviewer/photographer invites where row-level decision allows.

Controls hidden today and why:

- Role administration surfaces are hidden from delegated users because role definition, custom role assignment, reviewer access administration, and effective access source metadata remain fixed owner/admin-only.
- Owner rows are read-only because owner memberships are immutable in this UI/API.
- Delegated users cannot mutate owner/admin rows or their own row because target checks reject those cases.
- Non-reviewer rows do not show tenant-wide reviewer access controls because reviewer access assignments require fixed reviewer membership.

## Current authorization model by action

Member listing:

- Owner/admin full listing: `getTenantMemberManagementData` first calls an internal `assertTenantMemberManager`, which uses `resolveTenantPermissions(...).canManageMembers`.
- Delegated listing: `getOrganizationUserDirectoryData` calls `resolveOrganizationUserAccess` and only loads membership rows when `canViewOrganizationUsers` is true.
- RLS/migrations also allow organization-user visibility through `app.current_user_can_view_organization_users`.

Invite creation/resend/revoke:

- `createTenantMemberInvite`, `resendTenantMemberInvite`, and `revokeTenantMemberInvite` call `assertCanInviteOrganizationUsers`.
- Fixed owner/admin can invite admin/reviewer/photographer.
- Delegated users can invite reviewer/photographer only and can manage only their own non-admin pending invites.
- Invite writes delegate to tenant membership invite helpers and outbound email delivery remains server-side.

Fixed-role changes:

- `updateTenantMemberRole` validates the role against `MANAGEABLE_MEMBERSHIP_ROLES`, asserts the broad action through `assertCanChangeOrganizationUserRoles`, loads the target membership in the active tenant, and then runs `assertCanChangeOrganizationUserRole` for row-level checks.
- Owner/admin can change non-owner rows to admin/reviewer/photographer.
- Delegated role changes are limited to non-self reviewer/photographer targets and reviewer/photographer next roles.
- Changing a fixed reviewer away from reviewer revokes active reviewer assignments.

Member removal:

- `removeTenantMember` asserts `assertCanRemoveOrganizationUsers`, loads the target membership, and then runs `assertCanRemoveOrganizationUser`.
- Owner/admin can remove non-owner rows.
- Delegated removals are limited to non-self reviewer/photographer rows.
- Membership deletion cascades custom role assignments through the database relationship. Tests also verify reviewer assignment cleanup/cascade behavior.

Custom role editor:

- `custom-role-service.ts` uses `assertTenantMemberManager` with `resolveTenantPermissions(...).canManageMembers`.
- Create/update/archive use service-role RPCs or service-role access only after fixed owner/admin validation.
- Custom role definitions are tenant scoped; system roles are immutable.

Custom role assignment/revocation:

- `custom-role-assignment-service.ts` uses `assertTenantMemberManager` with `resolveTenantPermissions(...).canManageMembers`.
- Grant validates target tenant membership, custom role ownership, system/archive state, assignment scope shape, target project/workspace, and zero-effective-capability restrictions.
- Grant/revoke writes use service-role operations after validation and are idempotent around active unique indexes and already-revoked rows.
- Delegated organization-user capabilities do not authorize custom role assignment.

Reviewer access grant/revoke:

- `reviewer-access-service.ts` uses fixed owner/admin membership checks.
- Reviewer access can only target fixed reviewer members.
- Tenant-wide and project assignments are active system reviewer role assignments in `role_assignments`.
- Delegated organization-user capabilities do not authorize reviewer access administration.

Effective access explanation:

- `getMemberEffectiveAccessSummary` calls `assertOwnerAdminEffectiveAccessViewer`, which checks `resolveTenantPermissions(...).canManageMembers`.
- It exposes source metadata and is intentionally owner/admin-only.
- Delegated organization-user views must not receive this metadata.

Owner/admin-only role administration enforcement:

- The live code enforces owner/admin-only role administration through `resolveTenantPermissions(...).canManageMembers`, not through custom role capabilities.
- Feature 091 tests explicitly verify that delegated `organization_users.*` users cannot list or mutate custom roles, custom role assignments, or reviewer access.
- The capability catalog intentionally does not include role-administration capability keys such as `roles.manage`, `roles.assign`, or `reviewer_access.manage`.

## Current custom role UI behavior

Custom role editor:

- Rendered in `CustomRoleManagementSection`, which is nested in the full `MemberManagementPanelView`.
- It appears between Role reference and Current members.
- It shows a title, subtitle, owner/admin management note, create/edit form, grouped capability checkboxes, and active custom roles table.
- It lists active custom roles with name, description, grouped capability labels, and edit/archive actions.

Custom role assignments:

- Rendered inside the full Current members table as a `Custom roles` column.
- For each member, the UI shows assigned custom role cards with role name, scope label, target label, scope warnings, archived-role note, and remove button.
- Assignment controls appear inline per member: role select, scope select, project select when needed, workspace select when needed, and `Assign role`.
- If no active custom roles exist, the row shows `Create an active custom role before assigning one.`

Scoped assignment behavior:

- Scope options are Organization, Project, and Workspace.
- The UI computes `getRoleScopeEffect` for the selected role and selected scope.
- Mixed-scope warning copy says `Some role capabilities do not apply at this scope.`
- It shows `Applies here: ...` and `Ignored here: ...` for mixed-scope assignments.
- Zero-effective selections are blocked and show `This role has no capabilities that apply at the selected scope.`
- The service also rejects zero-effective explicit scoped assignments.

What is noisy for the default page:

- The custom role editor capability catalog is long and advanced.
- Per-member custom role assignment controls consume a wide table column and add several selectors per row.
- Scope effect warnings are important but technical for day-to-day member management.
- Capability terms such as `effective capabilities`, `ignored capabilities`, and `scope` are accurate but IAM-heavy.

What must remain discoverable:

- Owner/admin users must still be able to create/edit/archive custom roles.
- Owner/admin users must still be able to assign/revoke custom roles at tenant/project/workspace scope.
- Warnings for ignored capabilities and zero-effective assignments must remain visible before writes when advanced controls are shown.

## Current reviewer access UI behavior

Tenant-wide reviewer access on `/members`:

- Rendered inside the full owner/admin Current members table in the `Reviewer access` column.
- Only fixed reviewer rows are eligible.
- For reviewer rows, the UI shows either `All projects` or `Project grants only`, plus a project grant count.
- It shows `Grant all projects` or `Revoke all projects` for tenant-wide reviewer access.
- For non-reviewers, it shows `Not eligible`.

Project reviewer access:

- Rendered separately in `ProjectReviewerAccessPanel` on the project detail page, not the Organization Users page.
- It lets owner/admin/project managers grant fixed reviewer members access to one project.
- It lists project-specific reviewer assignments and notes tenant-wide reviewers already have access.

Distinction from fixed reviewer membership:

- Fixed reviewer membership makes a user eligible for reviewer access.
- Actual review access requires tenant-wide or project reviewer assignments, except owner/admin behavior.
- Current copy partially communicates this through `roleDescriptions.reviewer`: `Eligible for review access. Projects require tenant-wide or project-specific grants.`

Potential confusion:

- `All projects`, `Project grants only`, `Grant all projects`, and `Not eligible` are terse and may not clearly explain fixed reviewer membership versus additional reviewer grants.
- The phrase `tenant-wide reviewer access` appears in system messages and effective access copy, while the row UI says `All projects`; the concept is the same but the terminology varies.
- Reviewer access controls sit in the default members table even though they are advanced access settings.

Default visibility recommendation:

- Keep a simple access summary visible by default, but move reviewer access grant/revoke controls behind the inline advanced section.
- Default row copy can summarize reviewer state as `Reviewer: all projects`, `Reviewer: project-specific`, `Reviewer: no project access`, or `No reviewer access` without showing grant/revoke buttons.

## Current effective access UI behavior

Where it is rendered:

- Effective access is rendered in `MemberManagementPanelView` as a per-member `Access` button in the Actions column.
- When opened, it inserts a detail row below the member row.
- It is only present in the full owner/admin panel.

Who can access it:

- The API route `GET /api/members/[userId]/effective-access` calls `getMemberEffectiveAccessSummary`.
- The service is fixed owner/admin-only and rejects delegated users with `tenant_member_management_forbidden`.

What it shows:

- Fixed role.
- Count of custom role assignments.
- Reviewer access summary, including tenant-wide yes/no and project count.
- Count of photographer workspace assignments.
- Warnings for fixed owner/admin broad access, tenant-wide reviewer summary, and ignored capabilities.
- Effective capabilities grouped by scope and capability group.
- Source labels for each capability group: fixed role, custom role, reviewer assignment, or photographer assignment.
- Ignored capabilities with role, capability, and reason.

Default-page noise:

- This is explanatory source metadata, not a common day-to-day action.
- It can be expensive because it resolves candidate scopes per opened member.
- It is already lazy per member, which is good. It should remain lazy and owner/admin-only.

Recommendation:

- Put the `Access` button behind the same page-level advanced role settings toggle in the first version.
- Keep the per-member disclosure/lazy fetch inside the advanced area. Do not fetch effective access for every row by default.
- Consider a later smaller row summary visible by default only if product copy can stay accurate without resolver calls.

## Current Role reference UI/content

Where it is rendered:

- `Role reference` is rendered in `MemberManagementPanelView` in `src/components/members/member-management-panel.tsx`, immediately after `Invite member` and before `CustomRoleManagementSection`.

Who can see it:

- Only fixed owner/admin users can see it because it is in `MemberManagementPanelView`.
- Delegated users render `DelegatedMemberManagementPanelView`, which does not include Role reference.
- No-access users see the read-only branch.

Exact information it shows:

- Title `Role reference`.
- Subtitle `Fixed roles map to these current capabilities.`
- A table with role and capabilities columns.
- One row for each `MEMBERSHIP_ROLES` value: owner, admin, reviewer, photographer.
- Each role row shows localized role label and `roleDescriptions.*`.
- Owner row additionally shows `Owners are read-only, non-inviteable, and non-removable in this slice.`
- Capability groups and capability labels for each fixed role are computed from `ROLE_CAPABILITIES`, `CAPABILITY_GROUPS`, `CAPABILITY_LABEL_KEYS`, and `roleHasCapability`.
- Owner/admin show all current tenant capabilities.
- Reviewer shows profile view, review, workflow/correction, and Media Library capabilities.
- Photographer shows profile view and capture capabilities.

i18n keys powering it:

- `members.roleReference.title`
- `members.roleReference.subtitle`
- `members.roleReference.capabilitiesColumn`
- `members.roleReference.ownerProtected`
- `members.roles.*`
- `members.roleDescriptions.*`
- `members.capabilityGroups.*`
- `members.capabilities.*`
- `members.membersTable.columns.role`

Usefulness for day-to-day member management:

- Low. It explains fixed role capability mapping, but most day-to-day tasks are inviting users, checking current role/access state, changing roles, and removing members.
- It pushes a large capability table above the actual member list.

Duplication:

- It duplicates the custom role editor's capability catalog.
- It overlaps with effective access explanations, which already explain what a specific member has and why.
- It overlaps with reviewer access copy for fixed reviewer eligibility.
- It does not help with custom role assignment scope effects, which are shown near the assignment controls.

Can it be removed from the default page without losing important guidance?

- Yes. Important guidance can be preserved with concise contextual copy:
  - fixed role explanation near the invite/member role select;
  - reviewer eligibility explanation near reviewer access controls;
  - advanced helper text inside the advanced section;
  - per-member effective access when needed.

Recommended treatment:

- Do not show the large static Role reference in the default page.
- Do not remove the underlying role/capability labels because custom role editor and effective access still use them.
- For Feature 103 first implementation, either remove the Role reference from default and move a compact rewritten version behind `Show advanced role settings`, or replace it with concise contextual fixed-role helper copy.
- Preferred direction: no large static Role reference by default. If retained, put it behind the advanced toggle and collapse or shorten it.

Tests affected if removed, hidden, or rewritten:

- Add/update owner/admin Members UI render tests to assert Role reference is absent by default.
- Add tests asserting Role reference or replacement guidance appears after `Show advanced role settings` if retained.
- Existing tests may not currently assert `Role reference` directly, but render snapshots/markup expectations in Features 091 and 093 could be impacted by hierarchy changes.
- If keys become unused, message files can keep them temporarily, or tests should verify only active new keys. Add English/Dutch parity coverage for new keys.

## Current terminology and confusing copy

Current visible labels/copy:

- Fixed role: `Role`, `Owner`, `Admin`, `Reviewer`, `Photographer`, `Fixed role`.
- Fixed role descriptions:
  - Owner: `Full organization access with protected ownership.`
  - Admin: `Full organization access except owner protection.`
  - Reviewer: `Eligible for review access. Projects require tenant-wide or project-specific grants.`
  - Photographer: `Capture and upload access in assigned project workspaces.`
- Custom role: `Custom roles`, `Define tenant-local permission sets from the current capability catalog.`
- Custom role assignment note: `Custom roles grant access only in areas where custom-role enforcement has shipped. Role assignment remains owner/admin-only.`
- Scoped role assignment labels: `Scope`, `Organization`, `Project`, `Workspace`, `Target`.
- Reviewer access: `Reviewer access`, `All projects`, `Project grants only`, `Grant all projects`, `Revoke all projects`, `Not eligible`.
- Effective access: `Access`, `Hide access`, `Effective capabilities`, `Sources`, `Ignored capabilities`.
- Capabilities: labels such as `manage organization users`, `review workspaces`, `finalize projects`.
- Ignored capabilities and warnings:
  - `Some role capabilities do not apply at this scope.`
  - `Applies here: ...`
  - `Ignored here: ...`
  - `This role has no capabilities that apply at the selected scope.`

Confusing or overly technical wording:

- `tenant-local`, `capability catalog`, `effective capabilities`, `ignored capabilities`, and `scope` are precise but not task-oriented.
- `Tenant-wide` appears in effective access and status messages while row UI says `All projects`.
- `Project grants only` may sound like the user has project access when the count is zero.
- `Role reference` is broad and static; it makes the page feel like a permission catalog instead of member management.
- `Owner/admin fixed roles are broad and remain special for tenant safety and role administration` is accurate but dense.

Simpler user-facing terminology to consider:

- Fixed role -> `Main role` or keep `Role` in the table; use `Main role` only in helper copy if needed.
- Custom role -> `Additional access` in default summaries, while keeping `Custom roles` in advanced administration.
- Scoped role assignment -> `Additional access for organization/project/workspace`.
- Reviewer access -> `Review access`.
- Effective access -> `Access details` or `Why this user has access`.
- Capabilities -> `Access areas` in UI copy; keep capability labels in advanced/editor details.
- Ignored capabilities -> `Not applied here` in UI copy; keep backend concept unchanged.

Do not rename database concepts, capability keys, service names, or backend role semantics.

## Recommended simplified default view

Default page goal:

- Focus on daily member management: invite users, view members, understand each member's main role and access summary, change fixed roles where allowed, remove members where allowed, and manage pending invites.

For fixed owner/admin users, default view should show:

- Page title/subtitle.
- Invite member section.
- Current members table.
- Pending invites.
- A concise page-level `Show advanced role settings` button.
- In the member table:
  - email;
  - fixed role selector or owner protected label;
  - simple access summary;
  - joined date;
  - basic actions: save role/remove where currently allowed.

Simple access summary should avoid resolver calls and use already-loaded page data:

- For fixed role: show role label and short role description, or keep role column plus an access summary column.
- For reviewer rows: summarize tenant-wide/project reviewer assignment count from `reviewerAccess`.
- For custom roles: summarize assigned custom role count from `customRoleAssignments`.
- For photographer rows: avoid promising workspace assignment coverage unless the data is already available. The current owner/admin page data does not include photographer workspace assignment summaries except on-demand effective access.

Default-visible examples:

- `Main role: Reviewer`
- `Review access: all projects`
- `Review access: 2 project grants`
- `Additional access: 1 role`
- `Additional access: none`

Hidden until `Show advanced role settings`:

- Large Role reference, if retained at all.
- Custom role definition editor.
- Custom role assignment controls and assigned-role management.
- Tenant-wide reviewer access grant/revoke controls.
- Effective access per-member `Access` button and detail rows.
- Scope warnings/ignored capability details.

Advanced toggle visibility:

- First version should show the advanced toggle only in the full owner/admin panel because only owner/admin users have advanced role administration surfaces today.
- Delegated users should continue to see the reduced delegated panel with no advanced toggle because there are no delegated advanced role controls to reveal. Adding a disabled/empty advanced toggle would imply unavailable administration.
- If future delegated advanced controls are added, the toggle can be generalized based on allowed advanced surfaces.

Safest first state model:

- Local React state in `MemberManagementPanel`.
- Default collapsed.
- No URL query param and no persisted preference in Feature 103.
- Rationale: this is UI-only, avoids changing server rendering, avoids new route state, avoids shareable URLs that could imply authorization differences, and keeps implementation small.

## Recommended inline advanced settings design

Do not create a separate route or page.

Options considered:

- Page-level toggle: smallest, clear, keeps page unified.
- Accordion section: similar to toggle, useful for grouping advanced controls under one area.
- Tabs within the same page: more structural churn and can make default/advanced feel like separate pages.
- Per-member expandable details only: already exists for effective access, but it does not solve the large custom role editor and Role reference.
- Combination of page-level toggle plus per-member details: best first version.

Recommended first version:

- Add one page-level button in the full owner/admin panel near the top, after invite or near the page intro: `Show advanced role settings` / `Hide advanced role settings`.
- When hidden, render the simplified owner/admin member management view.
- When shown, reveal one inline advanced area on the same page.
- Keep effective access as per-member lazy disclosure inside the advanced state.
- Keep advanced controls in the same route and component tree. Do not add navigation, separate URL, or modal-first administration.

## Recommended grouping of advanced controls

Use one advanced area with separate plain sections inside it:

1. Role guidance
   - Either no static Role reference, or a short/collapsed fixed-role reference.
   - Prefer concise contextual explanations over a large table.
2. Custom role definitions
   - Existing `CustomRoleManagementSection`.
3. Additional access assignments
   - Existing per-member custom role assignment controls.
   - Consider a future refactor to move custom role assignments out of the main default table into an advanced per-member area, but this can be deferred if the first implementation gates the current column behind advanced state.
4. Review access
   - Tenant-wide reviewer grant/revoke controls.
   - Project-specific reviewer grants remain on project pages, with only summaries on `/members`.
5. Access details
   - Existing effective access `Access` buttons and detail rows.

All advanced controls should be under one page-level advanced mode, not spread as default-visible cards.

Above the fold should remain:

- Page title/subtitle.
- Invite member.
- Start of current members table.
- Advanced toggle should be visible before or near the members table so owner/admin users know the controls still exist.

## Recommended copy and hierarchy

High-level default title/subtitle:

- Title: keep `Organization users`.
- Subtitle option: `Invite users and manage their main organization role.`

Simple member access summary:

- Column label: `Access summary`.
- Empty/default: `No additional access`.
- Reviewer examples: `Review access: all projects`, `Review access: {count} projects`, `Review access: not granted`.
- Custom role examples: `Additional access: {count} role`, `Additional access: {count} roles`.

Advanced toggle:

- `Show advanced role settings`
- `Hide advanced role settings`

Advanced section helper:

- `Manage custom roles, reviewer access, and detailed access explanations. These settings are available to owners and admins only.`

Fixed role explanation:

- `The main role controls baseline organization access. Owner rows stay protected.`

Additional access explanation:

- `Additional access can add access for the whole organization, a project, or a workspace without changing the user's main role.`

Reviewer access explanation:

- `Reviewer members need review access before they can review projects. Access can apply to all projects here or to individual projects from a project page.`

Role reference replacement:

- Prefer contextual helper copy near role selects and reviewer/custom role controls.
- If a reference remains, title it more plainly, for example `Main role guide`, and keep it collapsed/advanced-only.

Tone:

- Avoid IAM-heavy terms in default UI.
- Keep capability labels in advanced/editor details where precision matters.
- Preserve owner/admin-only boundaries in copy.

## i18n considerations

Current English and Dutch member-management keys:

- `members.title`, `members.subtitle`, `members.readOnly`, `members.backToProjects`
- `members.delegated.*`
- `members.roles.*`
- `members.roleDescriptions.*`
- `members.roleReference.*`
- `members.capabilityGroups.*`
- `members.capabilities.*`
- `members.invite.*`
- `members.membersTable.*`
- `members.reviewerAccess.*`
- `members.effectiveAccess.*`
- `members.customRoles.*`
- `members.customRoleAssignments.*`
- `members.customRoleForm.*`
- `members.pendingInvites.*`
- `members.errors.*`

Project reviewer access keys:

- `projects.detail.reviewerAccess.*`

Likely new keys:

- `members.advanced.show`
- `members.advanced.hide`
- `members.advanced.title`
- `members.advanced.subtitle`
- `members.advanced.fixedRoleHelp`
- `members.advanced.additionalAccessHelp`
- `members.accessSummary.column`
- `members.accessSummary.noAdditionalAccess`
- `members.accessSummary.customRoleCount`
- `members.accessSummary.reviewAllProjects`
- `members.accessSummary.reviewProjectCount`
- `members.accessSummary.reviewNotGranted`

Possibly updated keys:

- `members.subtitle`
- `members.membersTable.subtitle`
- `members.membersTable.removalExplanation`
- `members.customRoleAssignments.note`
- `members.roleDescriptions.reviewer`
- `members.reviewerAccess.*`
- `members.effectiveAccess.show` / `hide` if button moves behind advanced or is renamed to `Access details`.

Potentially unused keys if Role reference is removed rather than hidden:

- `members.roleReference.title`
- `members.roleReference.subtitle`
- `members.roleReference.capabilitiesColumn`
- `members.roleReference.ownerProtected`

Do not introduce hardcoded UI strings. Add or update English and Dutch messages together and follow the existing nested `members` key structure.

## UI state and routing recommendation

Recommended first version:

- Local React state in `MemberManagementPanel`.
- Default hidden.
- Client-only rendering decision inside the existing owner/admin client component.
- Keep the server page unchanged except for passing the same data into the client component.

Do not use URL query state in first version:

- A query param such as `advanced=1` would make browser history/share links more complex and could imply server-rendered access differences.
- It may require reading search params in the server component and expanding the UI during SSR.
- It is not needed for a first simplification pass.

Do not persist preference in first version:

- Persistence requires storage choice, tenant/user scoping, i18n testing, and privacy/product decisions.
- The page should start simple by default each visit.

Scroll behavior:

- Opening advanced settings should preserve current scroll position because it is a local client-state reveal.
- Place the toggle near the area it reveals. If advanced content is below the members default table, the button can set `aria-expanded` and reveal content without automatic scrolling.
- Avoid auto-scroll in first version unless usability testing shows the revealed advanced area is hard to find.

Server rendering:

- Advanced state should affect only client rendering in Feature 103.
- Authorization and data loading stay unchanged. The first implementation may still load full owner/admin data on the server even when advanced is hidden; that avoids behavior/API changes.
- A later performance feature could split advanced data loading, but that is out of scope.

## Testing considerations

Existing relevant coverage:

- Feature 070: fixed role/membership/invite foundations.
- Feature 080/081: capability catalog and role assignment foundations.
- Feature 082: reviewer access assignment and enforcement.
- Feature 083: custom role editor owner/admin behavior and non-manager denial.
- Feature 084: custom role assignment/revocation and owner/admin-only behavior.
- Feature 088: delegated organization-user read/list/invite custom-role enforcement and reduced data omission.
- Feature 089: delegated role-change/removal target restrictions, UI reduced controls, and no role-admin expansion.
- Feature 091: owner/admin role administration consolidation; delegated users cannot manage custom roles, custom role assignments, or reviewer access.
- Feature 093: scoped custom role assignment behavior, target pickers, scope warnings, zero-effective assignment rejection, delegated data omission.
- Feature 094: effective scoped resolver foundation and organization-user custom-role capability mapping.
- Feature 095: operational effective resolver enforcement.
- Feature 096: owner/admin-only effective access service and source explanation behavior.
- Feature 099: delegated organization-user visibility does not affect tenant resolution.
- Feature 102 includes an example English/Dutch i18n parity test pattern.

Tests needed for Feature 103:

- Owner/admin default render hides advanced role settings by default.
- Owner/admin default render still shows invite controls, current members, fixed role controls, basic save/remove actions, and pending invites.
- Owner/admin default render does not show the large Role reference, custom role editor, custom role assignment controls, reviewer grant/revoke controls, or effective access buttons.
- Clicking `Show advanced role settings` reveals advanced controls inline on the same page.
- Clicking `Hide advanced role settings` hides them again without route change.
- Owner/admin advanced render preserves custom role editor, scoped assignment controls, reviewer access controls, scope warnings, zero-effective warnings, and effective access button/detail behavior.
- Delegated panel remains reduced and does not expose the advanced toggle unless the implementation intentionally has delegated advanced surfaces.
- Delegated users still see only allowed invite/member/pending-invite controls.
- No API/service authorization behavior changes: existing Feature 088, 089, 091, 093, and 096 tests should continue to pass.
- Role reference tests:
  - absent from default owner/admin render;
  - present only inside advanced if retained, or replaced by contextual copy if removed.
- i18n:
  - new English and Dutch keys exist;
  - no new hardcoded strings in components;
  - optional parity helper test for the new `members.advanced` and `members.accessSummary` key groups.

Implementation test style:

- Existing tests use `renderToStaticMarkup` for view components. That can assert default hidden/visible server-rendered states only if the view accepts state props or a test wrapper is used.
- If the toggle lives in the stateful client component, consider extracting a presentational `MemberManagementPanelView` prop such as `advancedRoleSettingsVisible` for deterministic tests.
- Avoid large snapshot tests; assert specific text/absence.

## Risks and edge cases

Risk: owners/admins think controls were removed.

- Mitigation: make the advanced toggle visible near the top and use direct copy: `Show advanced role settings`.

Risk: simplified wording misrepresents actual permissions.

- Mitigation: default summaries must avoid claiming full effective access unless backed by already-loaded data. Keep detailed source explanations in advanced effective access.

Risk: delegated users see owner/admin-only controls after toggle.

- Mitigation: first version should not render the advanced toggle in the delegated panel. Keep server-side data split unchanged.

Risk: hiding warnings makes dangerous assignments easier.

- Mitigation: warnings are only relevant when assigning roles. Keep them visible wherever assignment controls are revealed. Do not hide warnings after an advanced section is open.

Risk: effective access calls become expensive.

- Mitigation: keep per-member effective access lazy and advanced-only. Do not fetch summaries for every row by default.

Risk: advanced hidden sections mask errors.

- Mitigation: because first version keeps data loading unchanged, full page load errors remain unchanged. For lazy effective access, keep existing loading/error states inside the opened advanced detail.

Risk: layout churn in a wide table.

- Mitigation: first version can keep existing advanced table internals behind the toggle. Defer deeper table refactoring unless required for a clean default view.

Risk: Role reference removal loses owner/admin guidance.

- Mitigation: preserve owner protection and reviewer eligibility guidance in contextual copy near role selects/reviewer access.

Risk: stale i18n keys remain.

- Mitigation: acceptable to leave unused Role reference keys temporarily if this keeps Feature 103 small, but document them and avoid adding hardcoded copy.

## Recommended bounded direction for Feature 103

Feature 103 is suitable for one RPI implementation cycle if bounded to UI/UX and information architecture only.

Include:

- Add a local owner/admin-only inline advanced toggle on `/members`.
- Simplify the default owner/admin view to show invite, member list, pending invites, fixed role, basic actions, and concise access summaries.
- Hide Role reference from the default page.
- Hide custom role editor, custom role assignment controls, reviewer grant/revoke controls, and effective access details by default.
- Reveal advanced controls inline on the same page after clicking `Show advanced role settings`.
- Keep delegated panel behavior and data shape unchanged except for any copy cleanup that does not expand access.
- Add/update English and Dutch i18n keys.
- Add focused UI tests for default hidden state, advanced revealed state, delegated boundary, and Role reference treatment.

Do not include:

- Runtime authorization changes.
- New routes/pages.
- New capabilities.
- New database migrations.
- Delegated role administration.
- Backend role/capability renames.
- Effective resolver changes.
- Reviewer access semantics changes.
- Photographer workspace assignment changes.
- Persisted advanced preferences.
- URL query state.
- Lazy server data splitting for advanced sections.

Component refactoring:

- Keep refactoring minimal.
- It is reasonable to split small presentational helpers inside `member-management-panel.tsx` if required for testing and readability.
- Avoid a broad member-management table rewrite in Feature 103 unless the plan phase decides the simplified default cannot be cleanly achieved otherwise.

## Explicit deferred items

- Persisting advanced toggle state per user/tenant.
- URL query support for advanced state.
- Separate advanced data loading endpoint or server action for full role administration data.
- Reworking custom role assignment into a separate per-member advanced drawer.
- Replacing the fixed role/capability catalog with a new domain-authored help model.
- Adding delegated custom role assignment/editor/reviewer access administration.
- Converting reviewer access or photographer assignments into custom roles.
- Changing effective permission resolver behavior or batching strategy.
- Broader IA redesign of organization settings.

## Open decisions for the plan phase

1. Should Role reference be removed entirely from the rendered UI, or retained only behind advanced settings in a shorter/collapsed form?
2. Should the default members table keep a separate `Access summary` column, or fold summary text under the fixed role column to reduce table width?
3. Should assigned custom role names be visible in the default summary, or only a count such as `Additional access: 2 roles`?
4. Should tenant-wide reviewer grant/revoke controls move to a dedicated advanced reviewer section, or remain in the member table only when advanced is visible?
5. Should effective access buttons be hidden unless advanced mode is open, or should the default page retain a per-member `Access details` disclosure because it is already lazy?
6. Should the existing `MemberManagementPanelView` accept an explicit advanced visibility prop for deterministic tests, or should tests render the stateful component and simulate button clicks?
7. Which old i18n keys should be removed immediately versus left temporarily unused?
8. Should the read-only no-access copy be updated to acknowledge delegated management exists, or left unchanged because it is not shown to delegated users?
9. Should the plan include a small copy cleanup for `tenant-wide` versus `all projects`, or keep wording changes limited to new advanced/default copy?
