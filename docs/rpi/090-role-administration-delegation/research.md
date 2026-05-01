# Feature 090 Research - Role administration delegation

## Title and scope

Feature 090 researches whether a tenant member who is not a fixed `owner` or `admin` can safely administer the permission system itself.

This is a research-only phase. No implementation plan is created here and no code, migration, route, helper, test, or UI file is changed.

Role administration means:

- creating tenant custom roles
- editing tenant custom role metadata
- replacing tenant custom role capability sets
- archiving tenant custom roles
- assigning tenant custom roles to members
- revoking tenant custom role assignments
- possibly granting and revoking reviewer access assignments

The main product question is whether a custom-role user can manage these surfaces without escalating themselves or others into owner/admin-equivalent authority.

## Inputs reviewed

Required orientation docs reviewed first:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `UNCODEXIFY.md`
- `docs/rpi/README.md`
- `docs/rpi/SUMMARY.md`

Prior RPI documents reviewed as context and design history:

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
- `docs/rpi/087-tenant-level-project-administration-custom-role-enforcement/research.md`
- `docs/rpi/087-tenant-level-project-administration-custom-role-enforcement/plan.md`
- `docs/rpi/088-organization-user-management-custom-role-enforcement/research.md`
- `docs/rpi/088-organization-user-read-list-and-invite-custom-role-enforcement/plan.md`
- `docs/rpi/089-organization-user-role-change-and-removal-custom-role-enforcement/research.md`
- `docs/rpi/089-organization-user-role-change-and-removal-custom-role-enforcement/plan.md`

Live source of truth inspected:

- `src/lib/tenant/role-capabilities.ts`
- `src/lib/tenant/tenant-custom-role-capabilities.ts`
- `src/lib/tenant/role-assignment-foundation.ts`
- `src/lib/tenant/custom-role-service.ts`
- `src/lib/tenant/custom-role-assignment-service.ts`
- `src/lib/tenant/reviewer-access-service.ts`
- `src/lib/tenant/organization-user-access.ts`
- `src/lib/tenant/member-management-service.ts`
- `src/lib/tenant/permissions.ts`
- `src/lib/projects/project-administration-service.ts`
- `src/lib/templates/template-service.ts`
- `src/lib/profiles/profile-access.ts`
- `src/app/api/members/route.ts`
- `src/app/api/members/[userId]/route.ts`
- `src/app/api/members/roles/route.ts`
- `src/app/api/members/roles/[roleId]/route.ts`
- `src/app/api/members/roles/[roleId]/archive/route.ts`
- `src/app/api/members/custom-role-assignments/route.ts`
- `src/app/api/members/[userId]/custom-roles/route.ts`
- `src/app/api/members/[userId]/custom-roles/[roleId]/route.ts`
- `src/app/api/members/reviewer-access/route.ts`
- `src/app/api/members/[userId]/reviewer-access/tenant-wide/route.ts`
- `src/app/api/projects/[projectId]/reviewer-access/route.ts`
- `src/app/api/projects/[projectId]/reviewer-access/[userId]/route.ts`
- `src/app/(protected)/members/page.tsx`
- `src/app/(protected)/layout.tsx`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/components/members/member-management-panel.tsx`
- `src/components/members/custom-role-management-section.tsx`
- `src/components/members/delegated-member-management-panel.tsx`
- `src/components/projects/project-reviewer-access-panel.tsx`
- `messages/en.json`
- `messages/nl.json`
- `supabase/migrations/20260430120000_081_role_assignment_foundation.sql`
- `supabase/migrations/20260430130000_082_reviewer_access_assignment_enforcement.sql`
- `supabase/migrations/20260430140000_083_custom_role_editor_functions.sql`
- `supabase/migrations/20260430150000_085_media_library_custom_role_enforcement.sql`
- `supabase/migrations/20260430160000_086_template_profile_custom_role_enforcement.sql`
- `supabase/migrations/20260430170000_087_project_admin_custom_role_enforcement.sql`
- `supabase/migrations/20260430180000_088_organization_user_invite_custom_role_enforcement.sql`
- `supabase/migrations/20260501120000_089_organization_user_role_change_remove_custom_role_enforcement.sql`
- `tests/feature-080-role-capability-catalog.test.ts`
- `tests/feature-081-role-assignment-foundation.test.ts`
- `tests/feature-082-reviewer-access-assignments.test.ts`
- `tests/feature-083-custom-role-editor-foundation.test.ts`
- `tests/feature-084-custom-role-assignment-foundation.test.ts`
- `tests/feature-085-custom-role-media-library-enforcement.test.ts`
- `tests/feature-086-custom-role-template-profile-enforcement.test.ts`
- `tests/feature-087-project-admin-custom-role-enforcement.test.ts`
- `tests/feature-088-organization-user-read-list-and-invite-custom-role-enforcement.test.ts`
- `tests/feature-089-organization-user-role-change-and-removal-custom-role-enforcement.test.ts`

`docs/rpi/SUMMARY.md` is useful orientation, but live code and migrations after Feature 089 are authoritative. The summary is stale in places about later 087+ work.

## Verified current behavior

The current fixed membership roles are:

- `owner`
- `admin`
- `reviewer`
- `photographer`

The current TypeScript capability catalog contains:

- `organization_users.manage`
- `organization_users.invite`
- `organization_users.change_roles`
- `organization_users.remove`
- `templates.manage`
- `profiles.view`
- `profiles.manage`
- `projects.create`
- `project_workspaces.manage`
- `capture.workspace`
- `capture.create_one_off_invites`
- `capture.create_recurring_project_consent_requests`
- `capture.upload_assets`
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

Fixed `owner` and `admin` map to every current capability. Fixed `reviewer` maps to profile view, review, workflow, correction, and Media Library capabilities. Fixed `photographer` maps to profile view and capture/upload capabilities.

After Feature 089, the enforced tenant-scoped custom-role allowlist is:

- `media_library.access`
- `media_library.manage_folders`
- `templates.manage`
- `profiles.view`
- `profiles.manage`
- `projects.create`
- `project_workspaces.manage`
- `organization_users.manage`
- `organization_users.invite`
- `organization_users.change_roles`
- `organization_users.remove`

This matches live `src/lib/tenant/tenant-custom-role-capabilities.ts` and the final SQL allowlist in `20260501120000_089_organization_user_role_change_remove_custom_role_enforcement.sql`.

Custom role editor, custom role assignment, and reviewer access assignment are not in that allowlist and are not delegated today. They remain fixed `owner`/`admin` operations in live TypeScript services and SQL/RLS.

## Current custom role editor

### Routes and service

The current role editor routes are:

- `GET /api/members/roles`
- `POST /api/members/roles`
- `PATCH /api/members/roles/[roleId]`
- `POST /api/members/roles/[roleId]/archive`

All routes call `requireAuthenticatedTenantContext()` and then use `src/lib/tenant/custom-role-service.ts`.

`listRoleEditorData(...)`, `createCustomRole(...)`, `updateCustomRole(...)`, and `archiveCustomRole(...)` all call a local `assertTenantMemberManager(...)`. That helper resolves tenant permissions and requires `permissions.canManageMembers`.

Important nuance: `permissions.canManageMembers` comes from `resolveTenantPermissions(...)`, which is fixed-role based. It maps to the fixed role capability catalog and does not include delegated `organization_users.manage`. Therefore only fixed `owner` and `admin` can use the role editor.

### List behavior

`listRoleEditorData(...)` returns:

- capability metadata derived from `CAPABILITY_GROUPS` and `CAPABILITY_LABEL_KEYS`
- system roles
- tenant custom roles

Active custom roles are returned by default. `GET /api/members/roles?includeArchived=1` can include archived custom roles. `mapRole(...)` marks system roles and archived custom roles as non-editable and non-archivable.

This data is unsafe to expose broadly because it reveals the tenant's full permission design, all custom role capability sets, archived custom role definitions when requested, and system role mappings. The current reduced delegated member directory intentionally omits it.

### Create, update, archive behavior

Custom role create/update input is normalized in TypeScript:

- role name is required and limited to 120 characters
- description is optional and limited to 500 characters
- capability set must be an array
- capability set must be non-empty
- duplicate capability keys are rejected
- capability keys are checked against both the database `capabilities` table and the TypeScript `TENANT_CAPABILITIES` catalog

Create generates a tenant-local slug from the name and checks active tenant custom-role name conflicts before calling the SQL RPC.

Update first proves the target is a mutable tenant custom role, then replaces the complete capability set through SQL. It does not patch individual capabilities.

Archive soft-deletes the tenant custom role by setting `archived_at`, `archived_by`, `updated_at`, and `updated_by`. It does not delete capability mappings or active assignment rows.

### SQL/RPC behavior

Feature 083 added service-role-only RPCs:

- `app.create_tenant_custom_role_with_capabilities(...)`
- `app.update_tenant_custom_role_with_capabilities(...)`
- `app.archive_tenant_custom_role(...)`
- public wrappers for those functions

The app functions are `security definer`, but their execute grants are revoked from `public` and granted only to `service_role`. The TypeScript service performs actor validation before calling them with a service-role client.

The RPCs also hard-check fixed owner/admin by requiring a membership row for the actor with `role in ('owner', 'admin')`. They do not accept delegated custom-role authority.

System roles are protected by table shape constraints and RPC checks:

- system roles have `is_system = true`, `tenant_id is null`, a non-null `system_role_key`, no actor audit fields, and no archive fields
- update/archive RPCs throw `system_role_immutable` for system roles
- service preflight also rejects `role.is_system`

Archived roles are protected:

- update rejects archived roles
- archive is idempotent and returns `false` if the role is already archived
- active role uniqueness indexes ignore archived custom roles, so names/slugs can be reused after archive

### RLS behavior

`role_definitions` RLS allows:

- all authenticated users to select system role definitions
- tenant managers to select tenant custom role definitions

`role_definition_capabilities` RLS allows:

- all authenticated users to select system role capability mappings
- tenant managers to select tenant custom role capability mappings

Tenant manager in those policies is `app.current_user_can_manage_members(tenant_id)`, which remains fixed `owner`/`admin`. Direct authenticated writes are not granted for role definition tables or role capability mappings.

### Tests

`tests/feature-083-custom-role-editor-foundation.test.ts` covers:

- owner/admin listing of system and custom roles
- create/update/archive with full capability replacement
- non-manager denial
- invalid capability, duplicate, archived, system, and tenant boundary validation
- archived name/slug reuse
- non-expansion where custom roles did not affect review or Media Library before later enforcement slices

## Current custom role assignment

### Routes and service

The current assignment routes are:

- `GET /api/members/custom-role-assignments`
- `POST /api/members/[userId]/custom-roles`
- `DELETE /api/members/[userId]/custom-roles/[roleId]`

All routes use `src/lib/tenant/custom-role-assignment-service.ts`.

`listAssignableCustomRoles(...)`, `listCustomRoleAssignmentsForMembers(...)`, `resolveCustomRoleAssignmentSummary(...)`, `grantCustomRoleToMember(...)`, and `revokeCustomRoleFromMember(...)` all require the same fixed-owner/admin `assertTenantMemberManager(...)` pattern through `resolveTenantPermissions(...).canManageMembers`.

Delegated `organization_users.*` capabilities do not grant custom role assignment access.

### Assignment behavior

The workflow assigns only tenant custom roles:

- `role_definitions.is_system = false`
- `role_definitions.tenant_id = active tenant`
- `role_definitions.archived_at is null` for grant
- `role_assignments.scope_type = 'tenant'`
- `project_id = null`
- `workspace_id = null`

System roles cannot be assigned or revoked through this workflow. Archived custom roles cannot be assigned. Archived assigned custom roles can still be listed and revoked.

Multiple active custom roles can be assigned to the same member. The duplicate prevention is per exact active tuple `(tenant_id, user_id, role_definition_id)` for tenant scope.

Duplicate grant is idempotent:

- service checks for an existing active assignment first
- insert unique violations are handled by re-reading the raced active assignment
- unresolved conflicts return `custom_role_assignment_conflict`

Revocation is represented by setting `revoked_at` and `revoked_by`. Revoke with no active assignment is idempotent and returns `{ assignment: null, revoked: false }`.

Membership removal cascades assignment rows because `role_assignments_membership_fk` references `(tenant_id, user_id)` on `memberships` with `on delete cascade`.

Fixed role changes do not revoke tenant custom-role assignments. This is intentional in Feature 084 and still live.

### Schema and RLS behavior

`role_assignments` supports `tenant`, `project`, and `workspace` scopes, but current custom-role assignment UI/API uses tenant scope only.

The table has:

- scope shape constraints
- revoke shape constraints
- membership foreign key cleanup
- project/workspace tenant alignment foreign keys
- active unique indexes per scope
- a trigger that rejects cross-tenant custom role assignments and rejects new active assignments to archived tenant roles

RLS allows tenant managers to select all assignment rows and users to select their own rows. Authenticated direct insert/update/delete grants are not present for assignment writes. The service writes with the service role after fixed owner/admin validation.

### UI behavior

The full fixed owner/admin Members page includes:

- a custom role assignment column
- active assigned role labels
- archived assigned role labels
- per-member assign dropdown containing active tenant custom roles not already assigned
- remove buttons for assigned custom roles

This full panel is not rendered for delegated organization-user managers. The reduced delegated panel omits role editor data, assignable custom roles, custom role assignments, and reviewer access.

### Tests

`tests/feature-084-custom-role-assignment-foundation.test.ts` covers:

- owner/admin listing, assignment, revocation, re-add, and stacking
- non-manager, system role, archived role, cross-tenant role, and non-member assignment rejection
- membership removal cascade
- fixed role changes leaving custom assignments intact
- archived assigned roles remaining visible and revokable
- custom role assignments enforcing only shipped custom-role slices and preserving non-expansion
- Members UI assignment labels and controls

## Current reviewer access assignment

### Routes and service

Tenant-wide reviewer access routes:

- `GET /api/members/reviewer-access`
- `POST /api/members/[userId]/reviewer-access/tenant-wide`
- `DELETE /api/members/[userId]/reviewer-access/tenant-wide`

Project reviewer access routes:

- `GET /api/projects/[projectId]/reviewer-access`
- `POST /api/projects/[projectId]/reviewer-access`
- `DELETE /api/projects/[projectId]/reviewer-access/[userId]`

All write paths go through `src/lib/tenant/reviewer-access-service.ts`.

`assertTenantMemberManager(...)` in that service loads the actor membership and requires fixed role `owner` or `admin`. It does not use `resolveOrganizationUserAccess(...)` and does not check tenant custom role capabilities.

Target validation requires the target to be a current tenant member with fixed membership role `reviewer`. Tenant-wide and project-scoped grants both assign the system reviewer role definition through `role_assignments`.

### Reviewer access semantics

Reviewer access is special because it is not the same as assigning a tenant custom role:

- it uses the system `reviewer` role definition, not tenant custom roles
- it is a gate on top of fixed membership role `reviewer`
- tenant-wide reviewer access grants broad review and Media Library authority
- project reviewer access grants project review access but not tenant-wide Media Library access
- it is read by SQL helpers for project/workspace review access and Media Library access

Feature 082 SQL helpers join `role_assignments` to the system reviewer role definition and require `rd.is_system = true` and `rd.system_role_key = 'reviewer'`.

The TypeScript permission resolver mirrors that:

- fixed owner/admin have broad review
- fixed reviewer must have tenant-wide or project reviewer assignment
- photographers keep workspace-assignment capture behavior

### Lifecycle behavior

Reviewer access grants are idempotent:

- service checks for existing active assignment
- unique races are resolved by re-read

Reviewer access revocation sets `revoked_at` and `revoked_by`, like custom role revocation.

When a fixed reviewer is changed away from reviewer, `updateTenantMemberRole(...)` calls `revokeActiveReviewerAssignmentsForMember(...)`. Member removal cascades assignments through the `role_assignments` membership foreign key.

### UI behavior

The full Members page has a Reviewer access column for tenant-wide reviewer access. The project detail page renders `ProjectReviewerAccessPanel` only when `projectPermissions.canManageMembers` is true. That boolean is fixed owner/admin from `resolveProjectPermissions(...)`, not custom `organization_users.manage`.

Delegated organization-user panels do not expose reviewer access.

### Tests

`tests/feature-082-reviewer-access-assignments.test.ts` covers:

- SQL helpers for tenant-wide, project-scoped, and unassigned reviewer access
- TypeScript helper parity with SQL enforcement
- manager-only, role-gated, idempotent, tenant-scoped service writes

## Current enforced custom-role capability map after Feature 089

The live enforced custom-role map is intentionally narrow by area.

Media Library:

- `media_library.access`
- `media_library.manage_folders`

Templates and profiles:

- `templates.manage`
- `profiles.view`
- `profiles.manage`

Tenant-level project administration:

- `projects.create`
- `project_workspaces.manage`

Organization users:

- `organization_users.manage`: reduced read/list only for delegated users
- `organization_users.invite`: reviewer/photographer invite and own delegated pending-invite management
- `organization_users.change_roles`: target-sensitive reviewer/photographer role changes only
- `organization_users.remove`: target-sensitive reviewer/photographer member removal only

Important non-expansion:

- `organization_users.manage` does not grant custom role editor access.
- `organization_users.manage` does not grant custom role assignment access.
- `organization_users.manage` does not grant reviewer access assignment access.
- `organization_users.change_roles` does not grant custom role assignment access.
- `organization_users.remove` does not grant custom role assignment access.
- `project_workspaces.manage` does not grant reviewer access assignment access.
- Project/workspace scoped custom role assignments are not used by these tenant-level enforcements.

## Capability catalog implications

The current catalog does not contain role-administration capabilities. Live searches found no `roles.manage`, `roles.assign`, or `reviewer_access.manage` keys in TypeScript, SQL migrations, messages, or tests.

Adding capability keys is not neutral in this app. The custom role editor exposes every `TENANT_CAPABILITIES` key as a selectable capability and validates against the SQL `capabilities` seed. If Feature 090 only adds future-only role-administration keys without enforcement or UI restrictions, fixed owner/admin users could create and assign custom roles containing visible capabilities that do nothing. That would create product ambiguity and increase test drift.

Recommended naming for later capability vocabulary:

- `custom_roles.manage`
- `custom_roles.assign`
- `reviewer_access.manage`

Rationale:

- `custom_roles.manage` is clearer than `roles.manage` because system/fixed roles are not manageable and owner transfer/demotion remains out of scope.
- `custom_roles.assign` is clearer than `roles.assign` because fixed membership role changes already exist as `organization_users.change_roles`.
- `reviewer_access.manage` should be separate because reviewer access uses system reviewer assignment rows, has tenant/project scope semantics, and is not tenant custom-role assignment.

Alternative names considered:

- `roles.manage`: shorter and matches the candidate prompt, but too broad because it could imply system role or fixed role administration.
- `roles.assign`: too easy to confuse with fixed membership role change or reviewer access.
- `role_definitions.manage` and `role_assignments.manage`: technically precise, but too implementation-shaped for the user-facing capability catalog.

If these capabilities are later added:

- owner/admin should map to all new role-administration capabilities.
- reviewer/photographer should map to none by default.
- SQL seed migrations must add rows to `capabilities`.
- system role capability mapping seeds must add owner/admin mappings.
- `tests/feature-080-role-capability-catalog.test.ts` and `tests/feature-081-role-assignment-foundation.test.ts` must be updated for TypeScript/SQL drift.
- English and Dutch labels must be added under `members.capabilities.*`.
- `CAPABILITY_GROUPS` likely needs a new group such as `roleAdministration`.
- The custom role editor should hide or disable role-administration capabilities for delegated role managers unless the implementation explicitly supports them.

This research recommends not adding these keys in Feature 090 itself. Add them only when the first enforcement slice also decides how to display, restrict, and test them.

## Escalation risk model

Role administration is higher risk than the delegated organization-user actions from Features 088 and 089. Those features delegated bounded actions against existing member rows and kept owner/admin targets protected. Role administration can change the permission model itself.

Escalation paths identified:

- A user who can edit a custom role assigned to themselves can add capabilities to that role and immediately gain those capabilities.
- A user who can archive a role assigned to themselves can remove their own access, possibly locking themselves out of the delegated authority needed to recover.
- A user who can assign any custom role to themselves can grant themselves any capability already present on an assignable role.
- A user who can create arbitrary custom roles and assign them can create a role containing all enforced capabilities and assign it to themselves or a collaborator.
- A user who can assign roles containing capabilities they do not personally have can escalate others beyond the actor's own authority.
- A user who can assign `organization_users.change_roles` or `organization_users.remove` can indirectly manage member rows within the bounded Feature 089 target rules.
- A user who can assign a role-administration capability can create a recursive delegation path where another delegated user can grant back stronger roles.
- A user who can edit a custom role assigned to many users can unexpectedly change many users' access at once.
- A user who can archive a role assigned to others can disrupt access for many users at once.
- A user who can grant tenant-wide reviewer access can grant broad review and Media Library authority to any fixed reviewer.
- A user who can grant project reviewer access can broaden review authority for a specific project even when they do not have review authority themselves.

High-risk capabilities that should be fixed owner/admin-only by default:

- all role-administration capabilities
- `organization_users.manage`
- `organization_users.invite`
- `organization_users.change_roles`
- `organization_users.remove`
- `projects.create`
- `project_workspaces.manage`
- `templates.manage`
- `profiles.manage`
- `review.workspace`
- `workflow.finalize_project`
- `workflow.start_project_correction`
- `workflow.reopen_workspace_for_correction`
- all correction capabilities
- `media_library.manage_folders`
- tenant-wide reviewer access

Lower-risk candidates are limited. `profiles.view` and `media_library.access` are narrower than management capabilities, but still expose tenant data. Capture capabilities are operationally significant and workspace semantics are not expressed in tenant custom-role assignment yet. Treat every current enforced capability as security-relevant, not as harmless.

## Allowed-capability subset options

### Model 1 - Owner/admin only for role administration

No delegation. Fixed `owner` and `admin` remain the only role administrators.

Pros:

- safest current model
- matches live code and SQL
- avoids recursive delegation
- avoids self-assignment and self-edit escalation
- avoids needing a generic effective permission engine

Cons:

- no new delegation value in implementation
- later features still need role-administration vocabulary and UI design

This is the recommended Feature 090 outcome.

### Model 2 - Explicit low-risk allowlist

Delegated role managers can create or edit custom roles containing only a curated allowlist.

Possible allowlist candidates:

- none for the first implementation
- maybe `profiles.view`
- maybe `media_library.access`

Concerns:

- even read capabilities expose tenant data.
- capture capabilities are not low risk because they create invites, consent requests, and uploads.
- project/template/profile management capabilities are not low risk.
- organization-user capabilities are not low risk.
- role-administration capabilities must be excluded.

This model is feasible only after a plan chooses exact low-risk capabilities and UI copy. It is safer than actor-effective ceilings but still needs self-management restrictions and SQL/RLS parity.

### Model 3 - Actor-effective-capability ceiling

Delegated role administrators can create or assign only roles whose capabilities are a subset of their own effective capabilities.

The live code does not have a generic effective permission engine. It has narrow, area-specific resolvers:

- Media Library custom role access
- template/profile access
- project administration access
- organization-user access
- reviewer access assignments

These resolvers have different scope rules. Reviewer access depends on fixed reviewer role plus tenant/project assignments. Photographer capture depends on workspace assignment. Workflow and correction depend on project/workspace state. Tenant custom-role assignments currently enforce only tenant-scoped capabilities, not project/workspace scoped custom roles.

Therefore Model 3 is out of scope now. Building it would require defining cross-scope capability semantics before it can be used safely.

### Model 4 - Owner/admin approval for high-risk role changes

Delegated users could draft roles or low-risk changes, while fixed owner/admin approves high-risk changes.

This is productively safer but much larger:

- draft role tables or states
- approval workflow
- audit events
- UI states
- race handling when a role is assigned while pending changes exist

This is not a Feature 090 implementation slice.

## Self-assignment and self-management analysis

Recommended self-management rules for any later delegation:

- delegated users must not assign custom roles to themselves.
- delegated users must not revoke custom roles from themselves unless fixed owner/admin.
- delegated users must not edit a custom role assigned to themselves.
- delegated users must not archive a custom role assigned to themselves.
- delegated users must not assign roles containing role-administration capabilities unless fixed owner/admin.
- delegated users must not create a role containing role-administration capabilities unless fixed owner/admin.

The current system has no role-admin self-escalation tests because role administration is fixed owner/admin only. Feature 089 does have self-target restrictions for delegated member role changes and removals. That pattern should be reused for any later delegated role assignment feature.

Delegated users assigning roles to each other can still create a mutual escalation loop unless role-admin capabilities are excluded and target restrictions are strict. A later plan should test cross-user "assign back" scenarios explicitly.

## Target member safety analysis

Feature 089 provides the current best target-safety precedent:

- delegated role changes cannot target self
- delegated role changes cannot target owner/admin
- delegated role changes can only move reviewer/photographer targets between reviewer and photographer
- delegated removals cannot target self
- delegated removals cannot target owner/admin
- delegated removals can only target reviewer/photographer

Recommended target rules for later delegated custom role assignment:

- delegated assigners must not target owners.
- delegated assigners must not target admins.
- delegated assigners must not target themselves.
- first delegated assignment slice should target only reviewer/photographer fixed-role members.
- delegated assigners should not revoke custom roles from owners/admins.
- delegated assigners should not revoke roles they cannot assign.
- delegated assigners should not assign roles containing capabilities outside the chosen allowed subset.
- delegated assigners should not assign roles containing any role-administration capability.

Whether delegated assigners can revoke roles they did not originally assign is an open product decision. Operationally, revoking someone else's assigned role can disrupt access. Security-wise, original-assigner-only rules create recovery complexity. The safest first slice is "can revoke only allowed roles from allowed targets," with fixed owner/admin as recovery authority.

## Role editor UI implications

If `custom_roles.manage` is later implemented, `CustomRoleManagementSection` cannot be reused unchanged for delegated role managers.

Current section assumptions:

- it receives all system roles and all active tenant custom roles from full role editor data
- it renders every current capability as an editable checkbox
- it allows full capability replacement
- it shows archived-active state only through active list filtering
- it has no concept of capabilities outside actor authority
- it has no self-assigned-role protection

Delegated role-manager UI would need a reduced surface:

- show only manageable custom roles or clearly show non-manageable roles read-only
- probably hide system roles or show them only as fixed reference
- hide role-administration capabilities from delegated creation/edit
- disable or hide high-risk capabilities outside the allowed subset
- warn when a role cannot be edited because it is assigned to the actor
- prevent archive when role is assigned to actor
- explain that fixed owner/admin can manage all roles
- use existing tables/forms/buttons and avoid an IAM dashboard or permission matrix

For i18n, English and Dutch copy would be needed for:

- restricted role management
- unmanageable role state
- capability not available to delegate
- role assigned to you cannot be edited/archived
- high-risk capabilities are owner/admin-only

## Role assignment UI implications

If `custom_roles.assign` is later implemented, the current Members page assignment controls cannot be reused unchanged for delegated assigners.

Current full owner/admin assignment controls:

- show every member row
- show active custom role assignments
- allow assigning any active tenant custom role to any current member
- allow revoking assigned custom roles
- include owner/admin targets
- include roles regardless of capability set

Delegated role assignment UI would need reduced data:

- show only target rows that the actor may assign/revoke for, or show unsafe targets read-only
- hide owner/admin assignment controls
- hide self assignment controls
- list only roles the actor can assign
- distinguish "no assignable roles" from "you cannot assign roles to this user"
- decide whether existing unmanageable assignments are hidden, read-only, or visible but non-revokable
- avoid exposing full role capability sets unless needed to explain choices

The current `DelegatedMemberManagementPanel` is a better starting point than the full `MemberManagementPanel` because it already renders reduced member data and target-sensitive row controls.

## SQL/RLS/RPC implications

Direct authenticated writes should remain disabled for role definition, role capability mapping, role assignment, and reviewer access writes.

Current hardening:

- custom role editor RPCs are service-role-only and hard-check fixed owner/admin in SQL.
- custom role assignment service writes with the service role after fixed owner/admin validation.
- reviewer access service writes with the service role after fixed owner/admin validation.
- role assignment RLS does not grant direct authenticated insert/update/delete.

For `custom_roles.manage`, changing the existing Feature 083 RPCs directly would be risky because they currently implement full-power role editing. Safer options:

- add separate delegated-safe RPCs that enforce allowed capability subset and target role restrictions in SQL, or
- update existing RPCs with explicit fixed-owner/admin full path and delegated restricted path.

Separate delegated-safe RPCs are preferable because the full owner/admin editor can remain stable while the delegated editor has stricter invariants.

Required SQL helpers for `custom_roles.manage` would likely include:

- actor has active tenant-scoped `custom_roles.manage`
- role is tenant custom, not system
- role is not archived for edit
- role is not assigned to actor for edit/archive
- requested capability set is non-empty and fully within allowed subset
- requested capability set excludes role-administration capabilities unless fixed owner/admin
- role name/slug uniqueness remains tenant-local

Required SQL helpers for `custom_roles.assign` would likely include:

- actor has active tenant-scoped `custom_roles.assign`
- target is current tenant member
- target is not actor
- target fixed role is reviewer/photographer in first slice
- target fixed role is not owner/admin
- role is active tenant custom role
- role capability set is within allowed subset
- role capability set excludes role-administration capabilities
- assignment is tenant-scope only
- revoked and archived states are ignored for authorization

Required SQL helpers for `reviewer_access.manage` would likely include:

- actor has active tenant-scoped `reviewer_access.manage`
- target is current fixed reviewer
- target is not actor if the actor is also reviewer
- project exists in tenant for project grants
- tenant-wide grant may remain fixed owner/admin-only
- project grant may be allowed only when the actor can administer that project, if the feature chooses project-only delegation

RLS policies would need parity with service checks. For role definitions and role capability mapping, existing select policies currently expose tenant custom roles only to fixed owner/admin tenant managers. Delegated role administrators would need read access to at least the roles/capabilities they can manage. This should not be solved by broadening all role definition reads without a data exposure decision.

## Relationship to project/workspace-scoped role assignments

`role_assignments` supports tenant, project, and workspace scope. Live custom-role assignment UI/API uses only tenant scope, and live custom-role enforcement checks only tenant-scoped custom-role assignments.

Feature 090 should not implement project-scoped or workspace-scoped custom role assignment. If delegated role assignment is later implemented, the first safe slice should remain tenant-scope only.

Project/workspace scoped custom-role assignment remains future work because:

- current enforced custom-role areas are tenant-level slices
- capture/review/workflow/correction have workspace and state semantics not expressible as simple tenant capabilities
- reviewer access already has a domain-specific project assignment model
- a generic effective permission engine does not exist

## Non-expansion boundaries

Feature 090 should not grant:

- fixed owner assignment, transfer, demotion, or deletion
- delegated admin target management
- delegated admin assignment
- member removal beyond Feature 089 rules
- organization invites beyond Feature 088 rules
- project creation beyond existing `projects.create`
- project workspace management beyond existing `project_workspaces.manage`
- capture/upload authority
- review authority
- workflow/finalization authority
- correction authority
- Media Library authority
- template/profile authority
- project-scoped custom-role enforcement
- workspace-scoped custom-role enforcement
- generic effective permission engine
- member-level deny/override rules
- agency/client hierarchy
- invite-to-custom-role

Role administration should remain separate from `organization_users.manage`, `organization_users.change_roles`, and `organization_users.remove`.

## Options considered

### Option A - Research only, defer implementation

Document the safe role-administration model and split implementation into later RPI features.

Assessment:

- security: strongest
- implementation size now: none
- product risk: low
- downside: no immediate delegation

Recommended.

### Option B - Custom role editor delegation only

Add `custom_roles.manage` for delegated create/edit/archive with a restricted capability subset.

Assessment:

- feasible only with a strict explicit allowlist
- unsafe with arbitrary capability selection
- requires reduced role editor UI
- requires new delegated-safe SQL/RPC checks
- must block editing/archiving roles assigned to the actor

Not recommended for Feature 090 implementation. It is a possible later feature after capability vocabulary and allowed subset are decided.

### Option C - Custom role assignment delegation only

Add `custom_roles.assign` for assigning/revoking existing allowed roles without editing definitions.

Assessment:

- safer than editor delegation because role definitions remain owner/admin controlled
- still needs no-self-target, no owner/admin targets, allowed-role filtering, and capability subset rules
- current assignment service allows owner/admin to assign any active tenant custom role to any current member, so it cannot be reused unchanged

This is the safest eventual implementation slice if the product wants actual delegation. It should still be a later feature, not Feature 090 implementation.

### Option D - Custom role editor and assignment delegation

Add both role definition and assignment delegation.

Assessment:

- creates combined self-escalation risk
- requires solving editing, assignment, target, and capability subset rules together
- requires reduced full UI and SQL parity

Not recommended until separate editor and assignment rules are proven.

### Option E - Reviewer access delegation

Add `reviewer_access.manage` or similar for reviewer access grants/revokes.

Assessment:

- should be separate from custom role assignment
- project reviewer grants may be a narrow later candidate
- tenant-wide reviewer grants are high risk because they grant broad review and Media Library access
- target must remain fixed reviewer only

Not recommended for Feature 090 implementation. If pursued later, start with project reviewer access only and keep tenant-wide reviewer access fixed owner/admin.

## Recommended bounded Feature 090 scope

Recommended Feature 090 title:

- `Role administration delegation research`

Recommended outcome:

- Option A - research only, defer implementation.

Feature 090 should not implement code, migrations, UI changes, or tests beyond this research document.

Do not add new capability keys in Feature 090. Adding role-administration keys now would expose non-enforced options in the custom role editor unless the UI and enforcement are changed in the same implementation slice.

Recommended later capability names:

- `custom_roles.manage`
- `custom_roles.assign`
- `reviewer_access.manage`

Recommendation on `roles.manage`:

- Do not use this exact name unless the product intentionally wants a broader roles domain. Prefer `custom_roles.manage`.
- Implement later, not now.
- If implemented, allow only a strict explicit capability subset and block self-assigned role edits/archive.

Recommendation on `roles.assign`:

- Do not use this exact name unless the product intentionally wants a broader roles domain. Prefer `custom_roles.assign`.
- Implement later, not now.
- This is the safest first delegation candidate, but only with owner/admin targets blocked, self-assignment blocked, tenant scope only, and allowed role filtering.

Recommendation on `reviewer_access.manage`:

- Use this exact name later if reviewer access delegation is implemented.
- Keep separate from custom role assignment.
- Implement later, not now.
- Prefer project reviewer access only as the first reviewer-access delegation slice. Keep tenant-wide reviewer access fixed owner/admin unless there is a stronger product requirement.

Safest later implementation split:

1. Capability vocabulary and UI shielding:
   - add `custom_roles.manage`, `custom_roles.assign`, and/or `reviewer_access.manage` only when enforcement is ready
   - update catalog drift tests and labels
   - ensure delegated role editors cannot select unsupported high-risk keys
2. Delegated custom role assignment:
   - tenant scope only
   - reviewer/photographer targets only
   - no self-assignment
   - active custom roles only
   - fixed owner/admin-controlled role definitions only
   - no roles containing role-administration capabilities
   - preferably explicit low-risk allowlist
3. Delegated custom role editor:
   - strict low-risk allowlist
   - no self-assigned role edit/archive
   - no role-administration capability management
   - reduced role editor UI
4. Reviewer access delegation:
   - separate feature
   - project reviewer access first if implemented
   - tenant-wide reviewer access remains owner/admin by default

## Safest helper architecture

Do not fold role administration into `organization-user-access.ts`.

Recommended later TypeScript structure:

- keep `tenant-custom-role-capabilities.ts` as the narrow resolver for enforced tenant custom-role capabilities
- add a dedicated role administration access module, for example `src/lib/tenant/role-administration-access.ts`
- add pure target/capability decision helpers similar to `canChangeOrganizationUserRoleTarget(...)`
- keep full fixed owner/admin short-circuit separate from delegated restricted paths
- keep custom role editor service full-power owner/admin methods separate from delegated-safe methods
- keep custom role assignment service full-power owner/admin methods separate from delegated-safe methods
- keep reviewer access service fixed owner/admin methods separate from any delegated reviewer-access methods

Do not create a generic effective permission engine in the next implementation. The current app's permission areas have different scope semantics and state guards.

## Safest SQL/RLS/RPC architecture

Recommended SQL defaults:

- keep direct authenticated writes disabled for role-administration tables
- keep role editor full-power RPCs service-role-only
- either add delegated-safe RPCs or add explicit delegated branches with strict checks
- update RLS only with parity tests and target-sensitive predicates
- avoid broad tenant custom role definition/capability exposure until UI/data exposure rules are decided

For any delegated write path, SQL should independently enforce:

- active tenant membership
- tenant-scoped active custom-role capability
- no project/workspace-scoped grants for tenant role administration
- no revoked assignments
- no archived custom role grants
- no system role mutation
- no owner/admin targets for delegated assignment
- no self-target for delegated assignment/revoke
- no self-assigned role edit/archive
- no role-administration capabilities in delegated-managed roles

Service-role writes must remain protected by explicit server-side authorization before elevation.

## Security and tenant-isolation risks

Risks to test and mitigate later:

- cross-tenant role definition assignment
- cross-tenant role assignment visibility
- project/workspace scoped assignment accidentally granting tenant role administration
- revoked assignment still granting role administration
- archived role still granting role administration
- system role mutation
- role assigned to actor being edited by actor
- self assignment
- owner/admin target assignment or revocation by delegate
- assigning a role with capabilities outside allowed subset
- assigning a role with role-administration capabilities
- assigning a role that grants organization-user mutation capabilities
- role archive disrupting many users
- concurrent grant/revoke races
- duplicate active assignment races
- stale UI submitting after role archived or target removed

Tenant isolation remains the primary invariant: every role definition, assignment, reviewer access assignment, and member target check must use the server-resolved tenant id.

## Test recommendations

If a later plan adds capability vocabulary only:

- catalog tests for exact role-to-capability mapping
- SQL seed drift tests
- English/Dutch label tests or component render tests
- custom role editor tests proving hidden/disabled future keys if they are not enforceable

If a later plan adds `custom_roles.assign`:

- fixed owner/admin behavior unchanged
- non-delegated users denied
- delegated assigner can assign allowed active custom role to reviewer/photographer target
- delegated assigner cannot target self
- delegated assigner cannot target owner/admin
- delegated assigner cannot assign owner/admin-equivalent roles
- delegated assigner cannot assign roles containing role-admin capabilities
- delegated assigner cannot assign roles outside capability allowlist
- archived roles cannot be assigned
- archived assigned roles can be revoked only if policy allows
- revoked assignments do not grant access
- duplicate grant is idempotent
- revoke missing assignment is idempotent
- member removal cascades assignment rows
- project/workspace scoped assignments do not grant delegation
- cross-tenant roles and targets are denied
- SQL helper/RLS parity for all target-sensitive rules
- reduced delegated UI hides unsafe controls

If a later plan adds `custom_roles.manage`:

- delegated create rejects disallowed capabilities
- delegated edit rejects disallowed capabilities
- delegated edit rejects system roles
- delegated edit rejects archived roles
- delegated edit rejects roles assigned to actor
- delegated archive rejects roles assigned to actor
- role name/slug conflicts remain tenant-local
- capability replacement is transactional
- archived role names/slugs can be reused as today
- editing role assigned to others is either forbidden or explicitly tested as allowed with copy and audit expectations
- concurrent update/archive races are safe
- SQL/RPC and TypeScript validation agree
- reduced role editor UI exposes only manageable roles/capabilities

If a later plan adds `reviewer_access.manage`:

- project reviewer grant/revoke target must be fixed reviewer
- tenant-wide reviewer access remains fixed owner/admin unless explicitly in scope
- delegated users cannot grant reviewer access to self unless intentionally allowed and tested
- project existence and tenant scoping are enforced
- project-scoped reviewer access does not grant tenant-wide Media Library
- revoked and duplicate reviewer assignments behave idempotently
- fixed role change away from reviewer still revokes active reviewer assignments
- project reviewer UI hides from users without the new capability

Regression tests to keep:

- `tests/feature-081-role-assignment-foundation.test.ts`
- `tests/feature-082-reviewer-access-assignments.test.ts`
- `tests/feature-083-custom-role-editor-foundation.test.ts`
- `tests/feature-084-custom-role-assignment-foundation.test.ts`
- `tests/feature-085-custom-role-media-library-enforcement.test.ts`
- `tests/feature-086-custom-role-template-profile-enforcement.test.ts`
- `tests/feature-087-project-admin-custom-role-enforcement.test.ts`
- `tests/feature-088-organization-user-read-list-and-invite-custom-role-enforcement.test.ts`
- `tests/feature-089-organization-user-role-change-and-removal-custom-role-enforcement.test.ts`

## Fresh reset and dev data considerations

Assume local development can be reset with `supabase db reset`.

Do not preserve, repair, backfill, or normalize arbitrary old local role rows or assignments for a future role-administration slice unless production migration safety is explicitly required.

Tests should create their own:

- tenants
- fixed owner/admin/reviewer/photographer members
- active and archived tenant custom roles
- capability mappings
- active and revoked tenant-scope custom role assignments
- cross-tenant roles and assignments
- project/workspace-scoped assignments
- tenant-wide and project reviewer access assignments
- roles assigned to the actor
- roles assigned to other members
- high-risk capability roles
- low-risk allowlist roles

## Open decisions for plan phase

- Should the product use `custom_roles.manage`/`custom_roles.assign`, or the broader `roles.manage`/`roles.assign` names?
- Should role-administration capability keys be added in a vocabulary-only feature, or only with first enforcement?
- What exact capabilities, if any, are low-risk enough for delegated role management?
- Should delegated role assignment use an explicit allowlist or actor-effective capability ceiling?
- If using actor-effective ceiling, what scope semantics apply to reviewer, photographer, project, workspace, workflow, and correction capabilities?
- Should delegated role assigners be able to revoke roles they did not assign?
- Should delegated role managers be able to edit roles assigned to other users?
- Should delegated role managers be able to archive roles assigned to other users?
- Should `custom_roles.assign` imply reduced member-list visibility like `organization_users.change_roles` and `organization_users.remove`?
- Should assigned roles with unsupported/high-risk capabilities be hidden, disabled, or visible read-only to delegated assigners?
- Should `reviewer_access.manage` allow only project reviewer access, or tenant-wide reviewer access too?
- Should delegated reviewer access managers need `project_workspaces.manage`, `review.workspace`, or project ownership in addition to `reviewer_access.manage`?
- What audit trail is required for delegated role definition changes beyond existing `created_by`, `updated_by`, `archived_by`, `created_by`, and `revoked_by` fields?

## Final recommendation

Feature 090 should remain research-only and should not add role-administration delegation yet.

The live model can prevent escalation for bounded organization-user actions, but it does not yet have the generic effective permission engine, delegated-safe role editor RPCs, reduced role-admin UI, or capability subset model needed for safe role administration.

The safest later first implementation is custom role assignment delegation only, with a new `custom_roles.assign` capability, tenant scope only, reviewer/photographer targets only, no self-assignment, no owner/admin targets, and a strict allowed-role/capability filter. Role editor delegation and reviewer access delegation should be separate later features.

Do not overload:

- `organization_users.manage`
- `organization_users.change_roles`
- `organization_users.remove`

Role administration is a separate permission domain.
