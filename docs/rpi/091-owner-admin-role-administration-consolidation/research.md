# Feature 091 Research - Owner/Admin Role Administration Consolidation

## Title and Scope

Feature 091 validates and consolidates the current V1 product rule:

- role administration remains fixed owner/admin-only;
- fixed owners/admins can create, edit, archive, assign, and revoke tenant custom roles;
- fixed owners/admins can grant and revoke tenant-wide and project reviewer access;
- non-owner/admin members can receive custom roles and use operational capabilities where enforcement has shipped, but cannot administer custom roles, role assignments, or reviewer access.

This is research only. No code, migration, test, UI, or runtime behavior changes are included in this phase.

## Inputs Reviewed

Required context:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `UNCODEXIFY.md`
- `docs/rpi/README.md`
- `docs/rpi/SUMMARY.md`

RPI history:

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
- `docs/rpi/087-tenant-level-admin-permission-consolidation/plan.md`
- `docs/rpi/088-organization-user-management-custom-role-enforcement/research.md`
- `docs/rpi/088-organization-user-read-list-and-invite-custom-role-enforcement/plan.md`
- `docs/rpi/089-organization-user-role-change-and-removal-custom-role-enforcement/research.md`
- `docs/rpi/089-organization-user-role-change-and-removal-custom-role-enforcement/plan.md`
- `docs/rpi/090-role-administration-delegation/research.md`
- `docs/rpi/090-role-administration-delegation/plan.md`

Live source inspected:

- `src/lib/tenant/role-capabilities.ts`
- `src/lib/tenant/tenant-custom-role-capabilities.ts`
- `src/lib/tenant/role-assignment-foundation.ts`
- `src/lib/tenant/permissions.ts`
- `src/lib/tenant/custom-role-service.ts`
- `src/lib/tenant/custom-role-assignment-service.ts`
- `src/lib/tenant/reviewer-access-service.ts`
- `src/lib/tenant/organization-user-access.ts`
- `src/lib/tenant/member-management-service.ts`
- `src/lib/tenant/member-management-route-utils.ts`
- `src/lib/tenant/membership-invites.ts`
- member, role, custom-role-assignment, reviewer-access, invite, and project reviewer-access route handlers under `src/app/api`
- `src/app/(protected)/members/page.tsx`
- `src/components/members/member-management-panel.tsx`
- `src/components/members/delegated-member-management-panel.tsx`
- `src/components/members/custom-role-management-section.tsx`
- `src/components/projects/project-reviewer-access-panel.tsx`
- `src/app/(protected)/layout.tsx`
- `src/components/navigation/protected-nav.tsx`
- `messages/en.json`
- `messages/nl.json`

Migrations inspected:

- `20260430120000_081_role_assignment_foundation.sql`
- `20260430130000_082_reviewer_access_assignment_enforcement.sql`
- `20260430140000_083_custom_role_editor_functions.sql`
- `20260430150000_085_media_library_custom_role_enforcement.sql`
- `20260430160000_086_template_profile_custom_role_enforcement.sql`
- `20260430170000_087_project_admin_custom_role_enforcement.sql`
- `20260430180000_088_organization_user_invite_custom_role_enforcement.sql`
- `20260501120000_089_organization_user_role_change_remove_custom_role_enforcement.sql`

Tests inspected:

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

## Source-of-Truth Notes and Drift Found

Live code, migrations, and tests are authoritative over older RPI documents.

Drift and naming notes:

- The prompt references `docs/rpi/087-tenant-level-project-administration-custom-role-enforcement/`. The live repository has `docs/rpi/087-tenant-level-admin-permission-consolidation/` instead. The live Feature 087 migration and test are `20260430170000_087_project_admin_custom_role_enforcement.sql` and `tests/feature-087-project-admin-custom-role-enforcement.test.ts`, so live implementation matches the project-administration enforcement topic even though the RPI folder name differs.
- `docs/rpi/SUMMARY.md` is broadly aligned through Feature 090 and states Feature 090 had no runtime migration. That matches the live migration set: there is no Feature 090 SQL migration.
- Feature 090 plan text identifies a possible future Feature 091 implementation candidate around `custom_roles.assign`. The current Feature 091 request supersedes that direction. This research treats Feature 091 as owner/admin-only consolidation, not delegated assignment.
- Historical RPI docs mention candidate capability names such as `custom_roles.manage`, `custom_roles.assign`, `reviewer_access.manage`, `roles.manage`, and `roles.assign`. Live source, migrations, messages, and tests do not define those keys.

## Verified Current Owner/Admin Role-Administration Boundary

Current live behavior matches the requested V1 boundary.

- Custom role create: fixed `owner` and `admin` only.
- Custom role edit/archive: fixed `owner` and `admin` only.
- Custom role assign/revoke: fixed `owner` and `admin` only.
- Tenant-wide reviewer access grant/revoke: fixed `owner` and `admin` only.
- Project reviewer access grant/revoke: fixed `owner` and `admin` only.
- Non-owner/admin members can receive custom roles and use already-enforced operational capabilities, but those capabilities do not make them role administrators.

No route, service, SQL, RLS, RPC, loader, or UI path reviewed contradicts the owner/admin-only role-administration rule.

## Verified Custom Role Editor Behavior

Route and tenant derivation:

- `src/app/api/members/roles/route.ts`
- `src/app/api/members/roles/[roleId]/route.ts`
- `src/app/api/members/roles/[roleId]/archive/route.ts`

These routes call `requireAuthenticatedTenantContext()`, which derives the authenticated Supabase client, authenticated user, and active tenant via `ensureTenantId`. They do not accept `tenant_id` from the client.

Service authorization:

- `custom-role-service.ts` gates `listRoleEditorData`, `createCustomRole`, `updateCustomRole`, and `archiveCustomRole` through `assertTenantMemberManager`.
- That helper calls `resolveTenantPermissions(...).canManageMembers`.
- `resolveTenantPermissions` derives `canManageMembers` from fixed membership role through `deriveTenantPermissionsFromRole`; only owner/admin return true.
- The service does not consult tenant custom-role capabilities for role-editor access.

SQL/RPC behavior:

- Feature 083 RPCs `create_tenant_custom_role_with_capabilities`, `update_tenant_custom_role_with_capabilities`, and `archive_tenant_custom_role` hard-check `memberships.role in ('owner', 'admin')` for the supplied actor.
- Those RPCs are granted to `service_role`, not `authenticated`.
- Direct authenticated writes to `role_definitions` and `role_definition_capabilities` are blocked because the migration grants only select on those tables to authenticated users and defines only select RLS policies.

Role integrity:

- System roles are immutable in both service and SQL (`system_role_immutable`).
- Archived custom roles are protected from edit (`role_archived`).
- Archiving is idempotent at the RPC/service boundary; archiving an already archived role returns unchanged rather than creating a second mutation.
- Role names/slugs can be reused after archive through active-only uniqueness.

Delegated exposure:

- Delegated organization-user flows do not receive `roleEditor` data from `getOrganizationUserDirectoryData`.
- `/api/members/roles` uses the same service guard, so delegated users with `organization_users.*` capabilities are denied role editor data.

Ambiguous copy:

- `customRoles.definitionOnlyNote` says assignments are managed in the members table, which is accurate for owner/admin, but it does not explicitly say custom-role creation/editing is owner/admin-only. The delegated panel does state "Custom roles and reviewer access remain owner/admin-managed."

## Verified Custom Role Assignment Behavior

Route and tenant derivation:

- `src/app/api/members/custom-role-assignments/route.ts`
- `src/app/api/members/[userId]/custom-roles/route.ts`
- `src/app/api/members/[userId]/custom-roles/[roleId]/route.ts`

These routes also derive tenant and actor through `requireAuthenticatedTenantContext()`. They accept target user id and role id, but not tenant id.

Service authorization:

- `custom-role-assignment-service.ts` gates list, summary, grant, and revoke through `assertTenantMemberManager`.
- That helper uses `resolveTenantPermissions(...).canManageMembers`, which remains fixed owner/admin-only.
- The service does not use `organization_users.*` or any custom role capability for assignment administration.

Assignment rules:

- System roles cannot be assigned or revoked through the tenant custom-role assignment workflow.
- Archived custom roles cannot be newly assigned.
- Archived roles that are already assigned remain visible and revokable by owner/admin.
- Duplicate grants are idempotent: an existing active assignment is returned with `created: false`.
- Duplicate revokes are idempotent: no active row returns `revoked: false`.
- Assignment writes use the service-role client only after owner/admin authorization, membership validation, role validation, and active-assignment lookup.

Delegated exposure:

- Delegated users do not receive `assignableCustomRoles` or `customRoleAssignments` from the delegated member directory loader.
- `/api/members/custom-role-assignments` uses the owner/admin service guard, so delegated users cannot fetch assignable role lists or assignment summaries through that endpoint.

## Verified Reviewer Access Administration Behavior

Tenant-wide reviewer access:

- `src/app/api/members/reviewer-access/route.ts` lists reviewer access summary through `listReviewerAccessSummary`.
- `src/app/api/members/[userId]/reviewer-access/tenant-wide/route.ts` grants/revokes tenant-wide access through `grantTenantWideReviewerAccess` and `revokeTenantWideReviewerAccess`.
- `reviewer-access-service.ts` gates list/grant/revoke through an internal `assertTenantMemberManager` that directly checks membership role is owner/admin.

Project reviewer access:

- `src/app/api/projects/[projectId]/reviewer-access/route.ts` lists and grants project reviewer access.
- `src/app/api/projects/[projectId]/reviewer-access/[userId]/route.ts` revokes project reviewer access.
- These paths also call the same reviewer-access service guard and require owner/admin before listing or mutating project reviewer assignments.

Reviewer access model:

- Reviewer access is stored in `role_assignments` using the system reviewer role definition.
- It is separate from tenant custom-role assignment.
- A target must currently have fixed membership role `reviewer`.
- Grants are idempotent on active assignment uniqueness.
- Revokes mark active assignments revoked and are idempotent when no active assignment exists.

No accidental delegation found:

- `organization_users.*` custom-role capabilities do not grant reviewer access management.
- `project_workspaces.manage` and `projects.create` custom-role capabilities do not grant reviewer access management.
- `ProjectReviewerAccessPanel` renders management controls only when the server has already loaded `ProjectReviewerAccessData`, and that loader is owner/admin-gated.

## Verified Delegated Organization-User Behavior

`organization_users.manage` currently grants:

- view/list organization users through `resolveOrganizationUserAccess`;
- visibility into pending invites as allowed by the directory service;
- no custom-role editor, assignment, or reviewer access administration.

`organization_users.invite` currently grants:

- delegated invites only for reviewer and photographer fixed roles;
- delegated resend/revoke for own pending reviewer/photographer invites;
- no admin invites and no owner invites.

`organization_users.change_roles` currently grants:

- role changes only for non-self reviewer/photographer rows;
- next roles limited to reviewer/photographer;
- no owner/admin target mutation.

`organization_users.remove` currently grants:

- removal only for non-self reviewer/photographer rows;
- no owner/admin target removal.

Data model boundary:

- Owner/admin member management uses `TenantMemberManagementData`, which includes `reviewerAccess`, `roleEditor`, `assignableCustomRoles`, and `customRoleAssignments`.
- Delegated organization-user management uses `OrganizationUserDirectoryData`, which omits those role-administration fields.
- `tests/feature-089-organization-user-role-change-and-removal-custom-role-enforcement.test.ts` asserts the reduced delegated data omits `assignableCustomRoles`, `customRoleAssignments`, and `reviewerAccess`.

UI boundary:

- The delegated panel has only invite, fixed-role change, and removal controls where row-level decisions allow them.
- It does not render `CustomRoleManagementSection`.
- It does not render custom-role assignment controls.
- It does not render tenant-wide reviewer access controls.
- It keeps owner/admin rows and self rows read-only for delegated mutation paths.

## Verified Capability Catalog and Enforced Allowlist Status

Current `TENANT_CAPABILITIES` includes operational capabilities for:

- organization users;
- templates/profiles;
- projects/workspaces;
- capture;
- review;
- workflow;
- correction;
- Media Library.

Current system role mappings:

- owner/admin map to all tenant capabilities;
- reviewer maps to operational review/profile/media-library capabilities;
- photographer maps to capture/profile capabilities.

Current enforced tenant custom-role allowlist:

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

No role-administration capability keys exist in live source, messages, tests, or migrations:

- no `custom_roles.manage`
- no `custom_roles.assign`
- no `reviewer_access.manage`
- no `roles.manage`
- no `roles.assign`

The SQL enforced custom-role helper allowlist also contains only operational capabilities and does not include role-administration keys.

## Verified SQL/RLS/RPC Safety

Role definition tables:

- `role_definitions` and `role_definition_capabilities` have RLS enabled.
- Authenticated users receive select grants only.
- System roles and system role capabilities are readable to authenticated users.
- Tenant custom role definitions/capabilities are readable only when `app.current_user_can_manage_members(tenant_id)` is true.
- `app.current_user_can_manage_members` remains fixed owner/admin-only.

Role assignments:

- `role_assignments` has RLS enabled.
- Authenticated users receive select grants only.
- Tenant managers can select tenant assignments.
- Users can select their own assignment rows.
- There are no authenticated insert/update/delete grants for direct role assignment mutation.

Custom role editor RPCs:

- The custom role editor RPCs are service-role-only.
- They hard-check owner/admin membership internally.
- A delegated user cannot call them directly as `authenticated`.

Reviewer access write path:

- Reviewer access grant/revoke uses service-role writes only after owner/admin authorization.
- Direct authenticated role assignment writes are not available.

Organization-user RLS/RPC interaction:

- Features 088 and 089 expand organization-user read/list, invite, fixed-role update, and membership removal in bounded ways.
- They do not redefine `app.current_user_can_manage_members`.
- They do not grant direct mutation of role definition or role assignment tables.
- They do not create a route or RPC path that assigns custom roles or reviewer access from organization-user capabilities.

Answer to bypass questions:

- A delegated user cannot mutate role tables through direct authenticated Supabase calls with the current grants/policies.
- A delegated user cannot call custom role editor RPCs directly as authenticated.
- A delegated user cannot use RLS to assign a custom role.
- A delegated user cannot use organization-user capabilities to bypass role-administration service checks in reviewed code.

## Current UI/Product Clarity Findings

Clear areas:

- The Members page chooses owner/admin full management data or delegated reduced data server-side.
- The delegated panel explicitly states custom roles and reviewer access remain owner/admin-managed.
- The delegated panel avoids role-admin controls and role-admin data.
- Fixed roles and custom roles are visually separate: the role reference describes fixed roles, `CustomRoleManagementSection` defines custom roles, and the members table has a separate custom roles column.

Ambiguous or stale areas:

- `members.customRoleAssignments.note` in `messages/en.json` says: "Custom role assignments are visible here. Broad enforcement will be added in later feature slices." The Dutch copy has the same meaning. This is stale because Features 085-089 already enforce several operational custom-role surfaces. It should be replaced in the plan phase with copy that says enforcement is area-by-area and currently applies only where implemented.
- The owner/admin custom role editor does not explicitly say role creation/editing/assignment is owner/admin-only. Delegated users do not see the panel, but owner/admin copy could make the product rule clearer.
- The capability catalog UI lists capabilities, but does not clarify that catalog presence does not guarantee every product surface is fully migrated to custom-role enforcement. The stale assignment note tries to cover this but is now too broad.
- The navigation label "Organization users" is appropriate for delegated access, but delegated users may infer they have full member administration unless the panel helper remains visible and specific.

UI cleanup should remain restrained and follow `UNCODEXIFY.md`: clarify the existing Members surface, not redesign a broad IAM dashboard.

## Test Gaps

Existing coverage is strong for Features 083, 084, 088, and 089:

- Feature 083 tests owner/admin role editor behavior, non-manager denial, system-role immutability, archived-role edit denial, duplicate handling, and tenant boundaries.
- Feature 084 tests owner/admin custom-role assignment/revocation, non-manager denial, system/archived/cross-tenant/non-member rejection, idempotent grant/revoke, archived assigned roles remaining revokable, and assignment UI.
- Feature 089 tests that delegated organization-user capabilities do not expand role editor, custom role assignment summary, reviewer access summary, unrelated operational capabilities, or delegated data model fields.

Gaps or weak spots to consider in the plan phase:

- Add a consolidated Feature 091 regression test that creates a delegated user with all `organization_users.*` capabilities and asserts denial for custom-role create/edit/archive/list, custom-role assignment list/grant/revoke, and reviewer access list/grant/revoke.
- Add route-handler-level or API-level tests for delegated denial on `/api/members/roles`, `/api/members/custom-role-assignments`, `/api/members/[userId]/custom-roles`, `/api/members/reviewer-access`, and project reviewer-access endpoints if the test harness supports route calls.
- Add an explicit catalog regression test that role-administration capability keys are absent from `TENANT_CAPABILITIES`, the enforced custom-role allowlist, messages, and seeded SQL capability values.
- Add direct authenticated SQL/RLS tests showing delegated users cannot insert/update/delete `role_definitions`, `role_definition_capabilities`, or `role_assignments`.
- Add a regression test that `/api/members` or `getOrganizationUserDirectoryData` never includes `roleEditor`, `assignableCustomRoles`, `customRoleAssignments`, or `reviewerAccess` for delegated access.
- Add tests proving service-role writes remain protected by server-side owner/admin checks before insert/update. The current service tests cover non-manager rejection, but a single consolidation test can make this boundary more discoverable.
- Add UI copy assertions after updating stale custom-role enforcement copy.

## Options Considered

### Option A - Consolidate Owner/Admin-Only Role Administration

Keep custom role editor, custom role assignment, and reviewer access administration fixed owner/admin-only. Improve tests, docs, UI copy, and data-boundary assertions.

Pros:

- Matches current live code.
- Matches the current V1 product rule.
- Avoids privilege escalation from delegated users assigning or editing roles that contain powerful operational capabilities.
- Keeps role administration separate from operational capability migration.
- Smallest PR-sized next step.

Cons:

- Delegated organization-user managers still cannot assign custom role bundles, even when that might be useful operationally.
- The Members UI needs copy cleanup to reduce ambiguity around what custom roles currently enforce.

### Option B - Add Delegated Custom Role Assignment Now

Introduce `custom_roles.assign` with strict safeguards.

Pros:

- Could let bounded managers assign prebuilt operational bundles.
- Aligns with some future-looking Feature 090 discussion.

Cons:

- Conflicts with the current Feature 091 product rule.
- Assignment can escalate users into `organization_users.*`, project, template/profile, or Media Library powers unless a strict allowed-role/capability filter is designed.
- Requires target restrictions, self-assignment rules, capability subset policy, RLS/RPC changes, UI changes, and broad tests.

Decision: reject/defer for V1.

### Option C - Add Delegated Custom Role Editor Now

Introduce `custom_roles.manage`.

Pros:

- Would let non-admin role managers maintain local permission bundles.

Cons:

- Editing a role can change permissions for every current assignee.
- Safe delegation would need restrictions around roles assigned to the actor, roles assigned to other users, capability subsets, archive behavior, and assignment interaction.
- Too much risk for the current consolidation feature.

Decision: reject/defer.

### Option D - Build a Generic Role Administration Engine

Introduce broad `roles.manage` / `roles.assign` or a generic effective permission engine.

Pros:

- Could eventually unify fixed roles, custom roles, reviewer access, and future permission surfaces.

Cons:

- Too broad for V1.
- Conflicts with the current area-by-area operational custom-role migration strategy.
- `roles.manage` and `roles.assign` are ambiguous because fixed membership role changes, custom role assignment, and reviewer access assignment are different product concepts.

Decision: reject/defer.

## Recommendation

Choose Option A.

The live repository already follows the owner/admin-only role-administration rule. The next plan should make that boundary explicit and regression-tested without adding delegated role administration.

Recommended smallest consolidation work for the plan phase:

- Add Feature 091 tests that assert delegated organization-user capabilities do not grant custom role editor, custom role assignment, or reviewer access administration.
- Add absence tests for role-administration capability keys in the catalog and enforced allowlist.
- Add direct RLS/write-denial tests where practical.
- Update Members UI copy to clarify:
  - custom roles are permission bundles;
  - role administration is owner/admin-only;
  - custom-role enforcement is area-by-area and only guaranteed where shipped.
- Update RPI summary/docs after implementation, not during this research-only phase.

## Risks and Tradeoffs

- Keeping role administration owner/admin-only preserves a clear security boundary but limits delegation flexibility.
- Delegated organization-user capabilities are now powerful operationally, especially `change_roles` and `remove`, so their separation from role administration needs durable regression tests.
- The current owner/admin full member-management data model is convenient but broad; future additions to it could accidentally leak into delegated data if loaders are merged or reused carelessly.
- Direct RLS select of a user's own `role_assignments` can expose assignment ids and role definition ids, but tenant custom role metadata remains owner/admin-readable only and no direct writes are granted. This is acceptable for current behavior but should remain documented.
- The stale assignment copy can make users think custom roles are still mostly non-enforcing, which is now inaccurate after Features 085-089.

## Explicit Open Decisions for the Plan Phase

- Should Feature 091 include only tests and copy/docs, or also add small service-level comments documenting the owner/admin-only boundary?
- Should the plan add route-handler tests, service tests, RLS tests, or a mix based on the existing test harness cost?
- Should stale custom-role enforcement copy say "enforced in shipped areas only" or enumerate current enforced areas?
- Should the role editor panel include a short owner/admin-only note, or is the delegated panel helper enough?
- Should `docs/rpi/SUMMARY.md` be updated in the implementation phase to note the Feature 087 folder-name drift and the Feature 091 owner/admin-only consolidation decision?
- Should direct own-row `role_assignments` select exposure be documented in architecture/security notes, even though it does not permit mutation?
