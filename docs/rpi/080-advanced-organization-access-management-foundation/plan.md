# Feature 080 Plan - Fixed-role capability catalog and organization user clarity

## Inputs and ground truth

Required inputs were read in the requested order:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `UNCODEXIFY.md`
5. `docs/rpi/README.md`
6. `docs/rpi/SUMMARY.md`
7. `docs/rpi/080-advanced-organization-access-management-foundation/research.md`

The primary synthesized source for this plan is `docs/rpi/080-advanced-organization-access-management-foundation/research.md`. Current live code and schema are authoritative where they are more specific or conflict with the research document.

Targeted live verification was limited to the requested plan-critical files:

- Tenant permission and member-management code:
  - `src/lib/tenant/permissions.ts`
  - `src/lib/tenant/member-management-service.ts`
  - `src/lib/tenant/member-management-route-utils.ts`
  - `src/app/api/members/**`
- Members UI:
  - `src/app/(protected)/members/page.tsx`
  - `src/components/members/member-management-panel.tsx`
- Related access helpers:
  - `src/lib/profiles/profile-access.ts`
  - `src/lib/templates/template-service.ts`
  - `src/lib/projects/project-workspaces-service.ts`
  - `src/lib/projects/project-workspace-request.ts`
  - `src/lib/projects/project-workflow-service.ts`
  - `src/lib/project-releases/project-release-service.ts`
  - `src/lib/media-library/media-library-folder-service.ts`
- SQL helpers and policies in Feature 070 and later migrations.
- `messages/en.json` and `messages/nl.json`.
- Existing Feature 070 through 079 tests that assert permission or role behavior.

## Verified Current Boundary

Feature 070 already implemented the fixed-role tenant RBAC foundation:

- Live roles are `owner`, `admin`, `reviewer`, and `photographer`.
- Inviteable and editable target roles are `admin`, `reviewer`, and `photographer`.
- Owner memberships are not inviteable, editable, or removable.
- Owner and admin can manage members, templates, profiles, project creation, and project workspaces.
- Reviewer can perform tenant-wide review-oriented project, workspace, workflow, correction, and Media Library actions.
- Photographer can perform capture-oriented actions, with workspace access constrained to assigned `project_workspaces`.

Current TypeScript permission booleans live in `src/lib/tenant/permissions.ts`:

- `canManageMembers`
- `canManageTemplates`
- `canManageProfiles`
- `canCreateProjects`
- `canCaptureProjects`
- `canReviewProjects`
- project-level derivatives:
  - `canCreateOneOffInvites`
  - `canCreateRecurringProjectConsentRequests`
  - `canUploadAssets`
  - `canInitiateConsentUpgradeRequests`
- workspace-level derivative:
  - `canManageWorkspaces`

Current duplication verified in live code:

- `src/lib/tenant/permissions.ts` hardcodes role lists for tenant, project, workspace, capture, review, and workspace management.
- `src/lib/profiles/profile-access.ts` recomputes `owner` or `admin` for profile management.
- `src/lib/templates/template-service.ts` recomputes `owner` or `admin` for template management.
- `src/lib/project-releases/project-release-service.ts` treats Media Library access as `canReviewProjects`.
- `src/lib/media-library/media-library-folder-service.ts` reuses Media Library authorization from release service.
- `src/lib/projects/project-workspace-request.ts` gates correction media intake on `canReviewProjects`.
- `src/app/(protected)/layout.tsx` shows `/members` from `canManageMembers` and Media Library from `canReviewProjects`.

Current SQL/RLS helpers verified:

- `app.current_user_can_manage_members(p_tenant_id)` is `owner` or `admin`.
- `app.current_user_can_create_projects(p_tenant_id)` is `owner` or `admin`.
- `app.current_user_can_manage_project_workspaces(p_tenant_id, p_project_id)` is `owner` or `admin`.
- `app.current_user_can_capture_project(...)` and `app.current_user_can_capture_project_workspace(...)` allow owner/admin and assigned photographers after Feature 072.
- `app.current_user_can_review_project(...)` and `app.current_user_can_review_project_workspace(...)` allow owner/admin/reviewer.
- `app.current_user_can_access_media_library(p_tenant_id)` allows owner/admin/reviewer.
- `app.current_user_can_manage_media_library(p_tenant_id)` allows owner/admin/reviewer.

Conclusion: no database schema change is needed for Feature 080. SQL helper and RLS behavior must stay unchanged in this slice.

## Options Considered

### Option A - UI clarity only

Improve `/members` copy and role descriptions without a code-level catalog.

Assessment: lowest risk, but it does not reduce role-check duplication or create a stable capability vocabulary for later custom-role planning.

### Option B - TypeScript fixed-role capability catalog

Add a canonical TypeScript catalog for existing fixed roles, refactor app-layer permission helpers to derive current booleans from that catalog, and expose the same capability vocabulary in `/members`.

Assessment: best fit. It is behavior-preserving, has no schema impact, reduces app-layer duplication, and makes role meaning clearer without implying custom permissions exist.

### Option C - SQL capability helpers or RLS migration

Move SQL/RLS to capability names now.

Assessment: too broad for this slice. SQL helpers are the current DB backstop and already enforce fixed-role semantics. Rewriting them now would increase security risk without changing product behavior.

### Option D - Custom roles or permission overrides

Add role tables, custom role editor, member overrides, or scoped reviewer assignments.

Assessment: explicitly out of scope. These would create a second source of truth or require broad SQL/RLS and route behavior changes.

## Recommendation

Implement Option B only.

Feature 080 should introduce an app-layer fixed-role capability catalog and use it to derive existing TypeScript permission booleans. It should also improve `/members` so managers understand what each fixed role grants and what removal means. It must not change route behavior, invite behavior, active-tenant behavior, email behavior, SQL helper behavior, or RLS enforcement.

## Chosen Architecture

Create a new source-code-only catalog module:

- `src/lib/tenant/role-capabilities.ts`

This module should own:

- fixed role constants and types
- manageable role constants and types
- capability key constants and types
- capability group metadata for UI ordering
- role-to-capability mapping
- pure helper functions:
  - `roleHasCapability(role, capability)`
  - `roleHasEveryCapability(role, capabilities)`
  - `getCapabilitiesForRole(role)`

Then keep `src/lib/tenant/permissions.ts` as the server-side resolver layer:

- re-export role constants/types from `role-capabilities.ts` to avoid broad import churn
- derive existing `TenantPermissions`, `ProjectPermissions`, and `WorkspacePermissions` from capability checks
- keep current return shapes stable
- keep current `HttpError` codes and messages unchanged
- keep dynamic workspace checks for photographers unchanged

The catalog is not an enforcement source for the database. It is an app-layer vocabulary for fixed-role behavior already enforced by app helpers and SQL/RLS.

No migration is planned.

## Exact Capability Catalog Design

Capability keys should be string-literal TypeScript values. Use dot-separated keys to make grouping obvious in tests and UI code.

### Organization users

- `organization_users.manage`
  - Current behavior: owner/admin can load member-management data.
- `organization_users.invite`
  - Current behavior: owner/admin can create and resend member invites.
- `organization_users.change_roles`
  - Current behavior: owner/admin can change non-owner member roles to `admin`, `reviewer`, or `photographer`.
- `organization_users.remove`
  - Current behavior: owner/admin can remove non-owner memberships.

### Templates and profiles

- `templates.manage`
  - Current behavior: owner/admin can create, edit, publish, archive, and set project default templates.
- `profiles.view`
  - Current behavior: any tenant member with a valid role can view the recurring profile directory.
- `profiles.manage`
  - Current behavior: owner/admin can create, update, archive, request baseline consent, and manage recurring profile headshots.

### Projects and workspaces

- `projects.create`
  - Current behavior: owner/admin can create projects.
- `project_workspaces.manage`
  - Current behavior: owner/admin can manage project staffing/workspaces.

### Capture

- `capture.workspace`
  - Current behavior: owner/admin can capture in project workspaces; photographers can capture only in assigned workspaces.
- `capture.create_one_off_invites`
  - Current behavior: same role boundary as capture.
- `capture.create_recurring_project_consent_requests`
  - Current behavior: same role boundary as capture.
- `capture.upload_assets`
  - Current behavior: same role boundary as capture.

### Review

- `review.workspace`
  - Current behavior: owner/admin/reviewer can review project workspaces.
- `review.initiate_consent_upgrade_requests`
  - Current behavior: owner/admin/reviewer can initiate consent upgrade requests.

### Workflow and finalization

- `workflow.finalize_project`
  - Current behavior: owner/admin/reviewer can finalize when workflow state allows it.
- `workflow.start_project_correction`
  - Current behavior: owner/admin/reviewer can start correction when release state allows it.
- `workflow.reopen_workspace_for_correction`
  - Current behavior: owner/admin/reviewer can reopen validated workspaces for an open correction cycle.

### Correction

- `correction.review`
  - Current behavior: owner/admin/reviewer can perform correction review actions when project/workspace state allows it.
- `correction.consent_intake`
  - Current behavior: owner/admin/reviewer can perform correction consent intake when project/workspace state and provenance allow it.
- `correction.media_intake`
  - Current behavior: owner/admin/reviewer can add correction media when the correction cycle and reopened workspace allow it.

### Media Library

- `media_library.access`
  - Current behavior: owner/admin/reviewer can access Media Library release assets.
- `media_library.manage_folders`
  - Current behavior: owner/admin/reviewer can create, rename, archive, assign, move, and remove Media Library folder memberships.

Do not add future-only keys in this slice. Explicitly defer these examples:

- `roles.customize`
- `review.project_assignment`
- `review.workspace_assignment`
- `photographer_pool.manage`
- `media_library.manage_asset_permissions`
- `billing.manage`

## Exact Role-To-Capability Mapping

### owner

Owner receives every current capability:

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

Owner safety semantics remain separate from capabilities:

- owner role is not inviteable
- owner rows are read-only
- owner memberships cannot be removed
- no owner transfer or demotion is introduced

### admin

Admin receives the same capability set as owner.

Admin does not receive owner safety semantics. Admins remain inviteable, editable, and removable by managers under the current service rules.

### reviewer

Reviewer receives:

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

Reviewer does not receive:

- member management
- template management
- profile management
- project creation
- workspace staffing
- capture or upload actions

### photographer

Photographer receives:

- `profiles.view`
- `capture.workspace`
- `capture.create_one_off_invites`
- `capture.create_recurring_project_consent_requests`
- `capture.upload_assets`

Photographer capabilities remain workspace-scoped by live access checks. The catalog grants the role class, while `resolveAccessibleProjectWorkspaces(...)` and `resolveWorkspacePermissions(...)` still enforce assignment to the selected workspace.

Photographer does not receive:

- member management
- template management
- profile management
- project creation
- workspace staffing
- review
- workflow finalization
- correction review/intake
- Media Library access

## Permission Helper Refactor Plan

### New module

Add `src/lib/tenant/role-capabilities.ts` with no Supabase or Next.js imports.

Exports:

- `MEMBERSHIP_ROLES`
- `MANAGEABLE_MEMBERSHIP_ROLES`
- `MembershipRole`
- `ManageableMembershipRole`
- `TENANT_CAPABILITIES`
- `TenantCapability`
- `ROLE_CAPABILITIES`
- `CAPABILITY_GROUPS`
- `roleHasCapability(role, capability)`
- `roleHasEveryCapability(role, capabilities)`
- `getCapabilitiesForRole(role)`

Implementation rules:

- Use readonly arrays and `as const`.
- Return defensive copies or readonly arrays from `getCapabilitiesForRole`.
- Keep capability checks pure and deterministic.
- Do not read request input, tenant id, or database state in the catalog.

### `src/lib/tenant/permissions.ts`

Refactor these functions to derive from capabilities:

- `deriveTenantPermissionsFromRole(role)`
- `deriveProjectPermissionsFromRole(role)`
- `resolveWorkspacePermissions(...)`
- `assertCanManageProjectWorkspacesAction(...)`

Keep existing exported permission types and return fields stable.

Mapping from capabilities to existing booleans:

- `canManageMembers` = `organization_users.manage`
- `canManageTemplates` = `templates.manage`
- `canManageProfiles` = `profiles.manage`
- `canCreateProjects` = `projects.create`
- `canCaptureProjects` = `capture.workspace`
- `canReviewProjects` = `review.workspace`
- `canCreateOneOffInvites` = `capture.create_one_off_invites`
- `canCreateRecurringProjectConsentRequests` = `capture.create_recurring_project_consent_requests`
- `canUploadAssets` = `capture.upload_assets`
- `canInitiateConsentUpgradeRequests` = `review.initiate_consent_upgrade_requests`
- `canManageWorkspaces` = `project_workspaces.manage`

Dynamic boundaries remain outside the catalog:

- photographers only see assigned workspaces
- workspace id must match selected or row-scoped workspace
- project/workspace workflow state can still narrow capture or review mutations
- correction state and provenance can still narrow correction actions

### Profile and template helpers

Refactor role duplication where it is currently local:

- `src/lib/profiles/profile-access.ts`
  - derive `canManageProfiles` from `profiles.manage`
  - keep `canViewProfiles: true` for any valid membership, or derive it from `profiles.view`
- `src/lib/templates/template-service.ts`
  - derive `canManageTemplates` from `templates.manage`

Keep current error codes/messages stable.

### Media Library helpers

Refactor Media Library app-layer checks:

- `src/lib/project-releases/project-release-service.ts`
  - `authorizeMediaLibraryAccess(...)` should check `media_library.access`, not `canReviewProjects`, while preserving the same allowed roles and error behavior.
- `src/lib/media-library/media-library-folder-service.ts`
  - keep using `authorizeMediaLibraryAccess(...)` or add a narrow `authorizeMediaLibraryFolderManagement(...)` only if it improves clarity.
  - if adding a new helper, it should check `media_library.manage_folders`, with the same owner/admin/reviewer allowed set.

### Project workflow and correction helpers

Keep route behavior unchanged. Refactor only where the code currently uses app-layer booleans for review/correction:

- `src/lib/projects/project-workspace-request.ts`
  - review access can continue through `assertCanReviewWorkspaceAction(...)`
  - correction media intake can check `correction.media_intake` through the permissions object or derived helper, but must still preserve the current owner/admin/reviewer set and all workflow-state checks.

Do not rewrite `src/lib/projects/project-workflow-service.ts` state-machine logic for this feature. Those functions are state guards, not role catalogs.

### Routes

Member routes under `src/app/api/members/**` should not change behavior. They may keep importing `MANAGEABLE_MEMBERSHIP_ROLES` from `src/lib/tenant/permissions.ts` if that file re-exports the constants.

Do not accept capabilities from client payloads. Client payloads remain limited to current inputs such as role, invite id, target user id, and email.

## SQL/RLS Boundary

SQL helpers remain unchanged in Feature 080.

The database continues to encode fixed-role semantics as enforcement backstops:

- membership management: owner/admin
- project creation: owner/admin
- project workspace management: owner/admin
- capture: owner/admin plus assigned photographer at project/workspace level
- review: owner/admin/reviewer
- Media Library access and folder management: owner/admin/reviewer

No new SQL functions, tables, RLS policies, or migrations are planned.

Add app-layer parity tests instead of SQL changes. If implementation finds a real mismatch between TypeScript catalog and SQL helper behavior, stop and update this plan before changing schema.

## Members UI Plan

Keep the route:

- `/members`

Change user-facing label:

- recommended page title and nav label: `Organization users`
- Dutch: `Organisatiegebruikers`

This keeps URL compatibility while making the page meaning clearer.

Add a simple role reference section in `MemberManagementPanel`:

- no permission editor
- no complex matrix
- no nested cards
- no decorative dashboard layout
- grouped by role with concise descriptions and grouped capability labels

Recommended placement:

1. Invite section
2. Role reference section
3. Current members
4. Pending invites

Reasoning:

- managers choose a role during invite before they review current members
- a role reference panel avoids crowding every member row
- the same descriptions can inform the selected invite role with one short helper line under the selector

Role descriptions:

- Owner: full organization access; protected from role changes and removal in this slice.
- Admin: full organization access except owner protection.
- Reviewer: review, finalization, correction, and Media Library access.
- Photographer: capture and upload access in assigned project workspaces.

Current member rows:

- keep owner rows read-only
- keep non-owner role selector and save/remove actions unchanged
- add or keep owner note, but clarify it is protected/read-only
- add visible removal explanation near the table, not only in the browser confirm dialog

Invite form:

- keep role dropdown limited to `admin`, `reviewer`, `photographer`
- keep owner absent from invite options
- optionally show the selected role description below the dropdown
- do not add custom roles or capability editing

Removal copy:

- visible table helper should say removal only removes this organization access
- confirm dialog should say the auth account is not deleted
- mention removed users may still belong to other organizations

## Member-Management Copy Plan

Keep invite, resend, revoke, role update, and remove behavior unchanged.

Add clear copy for:

- owners are read-only in this slice
- owner role is not inviteable
- removing a user removes organization access only
- auth account is not deleted
- the user may still belong to other organizations

Do not mention future custom roles in the UI.

## i18n Plan

Update both:

- `messages/en.json`
- `messages/nl.json`

Reuse the existing `members` namespace and update `nav.members`.

Recommended English keys:

- `nav.members`: `Organization users`
- `members.title`: `Organization users`
- `members.subtitle`: updated copy for organization access, current users, and pending invites
- `members.roles.owner|admin|reviewer|photographer`: keep existing labels
- `members.roleDescriptions.owner|admin|reviewer|photographer`
- `members.roleReference.title`
- `members.roleReference.subtitle`
- `members.roleReference.ownerProtected`
- `members.capabilityGroups.organizationUsers`
- `members.capabilityGroups.templatesProfiles`
- `members.capabilityGroups.projectsWorkspaces`
- `members.capabilityGroups.capture`
- `members.capabilityGroups.review`
- `members.capabilityGroups.workflowCorrection`
- `members.capabilityGroups.mediaLibrary`
- `members.capabilities.<capabilityKeyAsCamelCase>`
- `members.invite.selectedRoleHelp`
- `members.membersTable.removalExplanation`
- `members.membersTable.ownerProtectedExplanation`
- `members.membersTable.removeConfirm`

Use camelCase message keys for capability labels to avoid JSON nesting problems with dot-separated capability ids. Example mapping:

- `organization_users.manage` -> `organizationUsersManage`
- `media_library.manage_folders` -> `mediaLibraryManageFolders`

Recommended Dutch terminology:

- `Organization users` -> `Organisatiegebruikers`
- `Owner` can remain `Owner` if the current app keeps role names in English, or use `Eigenaar` only if updating all role labels consistently.
- Keep existing product terms such as `workspace`, `reviewer`, and `Media Library` where already used.

No stored domain content should be localized or changed.

## Security and Reliability Considerations

Security invariants:

- No privilege changes.
- No owner edit/removal changes.
- No owner invite support.
- No client-provided tenant id.
- No client-provided capabilities.
- No custom-role shadow source of truth.
- No SQL/RLS behavior change.
- No service role exposure.
- No email foundation change.

Reliability invariants:

- Invite create-or-refresh behavior stays idempotent.
- Resend still rotates the invite token and can update role.
- Revoke remains a pending-invite state change.
- Member removal remains a membership delete only.
- Active tenant resolution stays server-side and unchanged.
- Photographer workspace access remains assignment-scoped.
- Review and correction actions remain narrowed by workflow/correction state after role capability checks.

Catalog-specific invariant:

- The catalog can be imported by client components for display, but server routes must still derive authority from authenticated server context and database-backed membership lookup.

## Edge Cases

- Owner rows: display read-only status; do not render editable role selector or remove action.
- Admin editing another admin: behavior remains allowed because current service only blocks owner rows.
- Inviting owner: still impossible because `MANAGEABLE_MEMBERSHIP_ROLES` excludes `owner`.
- Removing a member with other organization memberships: only current tenant access is removed.
- Removing a member with no remaining memberships: current bootstrap behavior may create a new solo owner tenant on next protected access; do not change this in Feature 080.
- Pending invite role changes: resend can still apply `admin`, `reviewer`, or `photographer`; owner remains invalid.
- Photographer access: catalog says photographer has capture capability, but workspace resolution still decides which workspace rows are visible/actionable.
- Reviewer access: remains tenant-wide for projects/workspaces and Media Library; no project-scoped reviewer assignment is introduced.
- Correction media intake: remains reviewer-capable and correction-state-gated; photographers remain denied even for assigned workspaces.
- UI capability display: display is explanatory only and not an authorization API.

## Test Plan

Add pure catalog tests, preferably in a new file:

- `tests/feature-080-role-capability-catalog.test.ts`

Coverage:

- every fixed role has the expected exact capability set
- `MANAGEABLE_MEMBERSHIP_ROLES` remains `admin`, `reviewer`, `photographer`
- `owner` is absent from manageable roles
- `roleHasCapability(...)` returns true/false for representative capabilities
- `getCapabilitiesForRole(...)` cannot mutate the canonical role mapping

Add app-helper parity tests:

- `deriveTenantPermissionsFromRole(...)` returns the same booleans as Feature 070 for all roles
- `deriveProjectPermissionsFromRole(...)` returns the same booleans as Feature 070 for all roles
- workspace management remains owner/admin only
- Media Library access derived from `media_library.access` remains owner/admin/reviewer only
- profile management remains owner/admin only, while profile viewing remains valid for all members
- template management remains owner/admin only
- correction/media-intake capability remains owner/admin/reviewer only

Update existing tests if needed:

- `tests/feature-070-tenant-rbac-foundation.test.ts`
  - keep existing expected permission booleans
  - optionally add app catalog vs SQL helper parity assertions
- `tests/feature-073-project-workflow-foundation.test.ts`
- `tests/feature-073-project-workflow-routes.test.ts`
- `tests/feature-074-project-release-media-library.test.ts`
- `tests/feature-074-media-library-download.test.ts`
- `tests/feature-075-project-correction-workflow.test.ts`
- `tests/feature-076-correction-consent-intake-foundation.test.ts`
- `tests/feature-078-media-library-folders.test.ts`
- `tests/feature-079-correction-media-intake-foundation.test.ts`

Add UI/component tests:

- role descriptions render in the members panel
- grouped capability labels render for each fixed role
- owner protected/read-only explanation renders
- removal-preserves-account explanation renders
- owner is not present in invite role options
- existing member save/remove controls remain absent for owner and present for editable non-owner rows

Run focused tests after implementation:

- catalog and permission unit tests
- member-management UI tests
- existing Feature 070 permission tests
- existing Feature 073 through 079 permission-sensitive tests listed above

Run full `npm test` if feasible before final implementation handoff.

## Implementation Phases

### Phase 1 - Catalog foundation

- Add `src/lib/tenant/role-capabilities.ts`.
- Move or duplicate role constants there.
- Re-export role constants/types from `src/lib/tenant/permissions.ts` for compatibility.
- Add pure catalog tests.

Validation:

- catalog tests pass
- TypeScript import paths remain compatible

### Phase 2 - Permission helper refactor

- Refactor `deriveTenantPermissionsFromRole(...)`.
- Refactor `deriveProjectPermissionsFromRole(...)`.
- Refactor workspace-management derivation.
- Refactor profile/template access helpers.
- Refactor Media Library authorization to use named capabilities.
- Keep error behavior and return shapes unchanged.

Validation:

- existing Feature 070 permission tests pass
- new helper parity tests pass

### Phase 3 - Members UI clarity

- Update `/members` page and nav label to `Organization users`.
- Add role reference display using the catalog order.
- Add selected role helper text in invite form if straightforward.
- Add owner protected and removal-preserves-account copy.
- Keep existing actions and forms unchanged.

Validation:

- member-management UI tests pass
- manual UI check confirms no permission editor was added

### Phase 4 - i18n and regression

- Update `messages/en.json`.
- Update `messages/nl.json`.
- Run focused tests for Features 070 and 073 through 079.
- Run `npm test` if feasible.

Validation:

- no missing translation keys
- no behavior regression in member, project, workflow, correction, or Media Library access tests

## Scope Boundaries

In scope:

- TypeScript fixed-role capability catalog.
- Role-to-capability mapping for existing fixed roles.
- App-layer permission helper refactor.
- Members UI role descriptions and capability display.
- Clearer organization user and removal copy.
- English and Dutch i18n updates.
- Behavior parity tests.

Out of scope:

- custom role database schema
- custom role editor
- permission override tables
- project-scoped reviewer assignment
- workspace-scoped reviewer assignment
- photographer pool redesign
- owner transfer or owner demotion
- suspended/deactivated member states
- per-folder permissions
- per-asset permissions
- public/client portal roles
- SSO
- billing permissions
- advanced audit console
- changing SQL/RLS permission behavior
- changing invite acceptance behavior
- changing project/correction/finalization behavior
- changing outbound email behavior

## Concise Implementation Prompt

Implement Feature 080 as a behavior-preserving TypeScript fixed-role capability catalog and `/members` clarity update. Add `src/lib/tenant/role-capabilities.ts` with fixed role constants, capability keys, grouped metadata, exact role-to-capability mapping, and pure helpers. Refactor app-layer permission helpers in `src/lib/tenant/permissions.ts`, profile/template access, and Media Library authorization to derive current booleans from the catalog while preserving all return shapes, error codes, and allowed roles. Do not add migrations or change SQL/RLS. Keep member invite, resend, revoke, role update, removal, owner protection, active-tenant, and email behavior unchanged. Update `/members` to stay on the same route but use the user-facing label `Organization users`, render role descriptions and grouped capabilities, and clarify that removal only removes organization access and does not delete the auth account. Add English and Dutch i18n keys. Add catalog, helper parity, and member UI tests, then run focused Feature 070 and 073-079 permission-sensitive tests.
