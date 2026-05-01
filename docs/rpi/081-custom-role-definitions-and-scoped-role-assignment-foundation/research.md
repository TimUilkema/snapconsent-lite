# Feature 081 Research - Custom role definitions and scoped role assignment foundation

## Title and scope

Feature 081 researches the first durable database-backed foundation for custom roles and scoped role assignment.

The intended slice is a foundation only. It should let the database represent role definitions, role-capability mappings, and role assignments at tenant, project, and workspace scope, while preserving the current fixed-role enforcement model.

Out of scope for this feature:

- custom role editor UI
- assigning custom roles from the Members page
- invite-to-custom-role flow
- member-level allow or deny overrides
- replacing all SQL/RLS helpers
- making reviewers project-scoped now
- changing photographer workspace access behavior
- changing project, correction, finalization, or Media Library access behavior
- agency/client hierarchy
- SSO or enterprise IAM
- per-folder or per-asset permissions

The central architectural rule for this research is that Feature 081 must not create a conflicting live access source. `memberships.role` remains the current enforcement source for existing app behavior.

## Inputs reviewed

Required inputs reviewed in the requested order:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `UNCODEXIFY.md`
5. `docs/rpi/README.md`
6. `docs/rpi/SUMMARY.md`
7. `docs/rpi/070-tenant-rbac-and-organization-user-management-foundation/research.md`
8. `docs/rpi/070-tenant-rbac-and-organization-user-management-foundation/plan.md`
9. `docs/rpi/072-project-staffing-photographer-scoped-capture-workspaces-and-bounded-project-workflow-permissions/research.md`
10. `docs/rpi/072-project-staffing-photographer-scoped-capture-workspaces-and-bounded-project-workflow-permissions/plan.md`
11. `docs/rpi/078-organization-scoped-media-library-folders-and-organization-foundation/research.md`
12. `docs/rpi/078-organization-scoped-media-library-folders-and-organization-foundation/plan.md`
13. `docs/rpi/080-advanced-organization-access-management-foundation/research.md`
14. `docs/rpi/080-advanced-organization-access-management-foundation/plan.md`

Live implementation and schema inspected as source of truth:

- Tenant roles, permissions, and capability catalog:
  - `src/lib/tenant/role-capabilities.ts`
  - `src/lib/tenant/permissions.ts`
  - `src/lib/tenant/member-management-service.ts`
  - `src/lib/tenant/member-management-route-utils.ts`
  - `src/lib/tenant/membership-invites.ts`
  - `src/lib/tenant/resolve-tenant.ts`
  - `src/lib/tenant/active-tenant.ts`
  - `src/lib/tenant/active-tenant-route-handler.ts`
- Project, workspace, workflow, profile, template, release, and Media Library helpers:
  - `src/lib/projects/project-workspaces-service.ts`
  - `src/lib/projects/project-workspace-request.ts`
  - `src/lib/projects/project-workflow-service.ts`
  - `src/lib/projects/project-workflow-route-handlers.ts`
  - `src/lib/profiles/profile-access.ts`
  - `src/lib/templates/template-service.ts`
  - `src/lib/project-releases/project-release-service.ts`
  - `src/lib/media-library/media-library-folder-service.ts`
- Current UI and API surfaces:
  - `src/app/(protected)/members/page.tsx`
  - `src/components/members/member-management-panel.tsx`
  - `src/app/api/members/**`
  - `src/app/api/projects/**`
  - `src/app/api/media-library/**`
- Relevant migrations:
  - `supabase/migrations/20260304210000_002_projects_invites_schema.sql`
  - `supabase/migrations/20260304211000_002_projects_invites_rls.sql`
  - `supabase/migrations/20260407150000_039_consent_form_template_editor.sql`
  - `supabase/migrations/20260414170000_050_recurring_profile_directory_foundation.sql`
  - `supabase/migrations/20260423090000_070_tenant_rbac_membership_invites_foundation.sql`
  - `supabase/migrations/20260423110000_070_tenant_membership_invite_flows.sql`
  - `supabase/migrations/20260423120000_072_project_workspaces_foundation.sql`
  - `supabase/migrations/20260423121000_072_project_workspace_access.sql`
  - `supabase/migrations/20260424110000_073_workspace_workflow_and_project_finalization.sql`
  - `supabase/migrations/20260424130000_074_project_releases_media_library_foundation.sql`
  - `supabase/migrations/20260424150000_075_project_correction_re_release_foundation.sql`
  - `supabase/migrations/20260424170000_076_correction_consent_provenance.sql`
  - `supabase/migrations/20260425120000_078_media_library_folders_foundation.sql`
- Relevant tests:
  - `tests/feature-070-tenant-rbac-foundation.test.ts`
  - `tests/feature-070-active-tenant-route.test.ts`
  - `tests/feature-073-project-workflow-foundation.test.ts`
  - `tests/feature-073-project-workflow-routes.test.ts`
  - `tests/feature-074-project-release-media-library.test.ts`
  - `tests/feature-074-media-library-download.test.ts`
  - `tests/feature-078-media-library-folders.test.ts`
  - `tests/feature-078-media-library-folder-routes.test.ts`
  - `tests/feature-079-correction-media-intake-foundation.test.ts`
  - `tests/feature-080-role-capability-catalog.test.ts`

Prior RPI docs were used as context only. Current live code and migrations are authoritative wherever older docs differ.

## Verified current behavior

### Current fixed-role model

`public.memberships` is the core tenant relationship. It is keyed by `(tenant_id, user_id)` and has:

- `tenant_id uuid not null references public.tenants(id) on delete cascade`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `role text not null`
- `created_at timestamptz not null default now()`

The original Feature 002 constraint allowed `owner`, `admin`, and `photographer`. Feature 070 replaced it with:

- `owner`
- `admin`
- `reviewer`
- `photographer`

The current source of truth for live access enforcement is:

- `memberships.role` for fixed tenant role identity
- `project_workspaces.photographer_user_id` for photographer workspace assignment
- project/workspace workflow state for additional capture, review, validation, correction, and finalization gating
- SQL/RLS helper functions that read `memberships.role`
- TypeScript helpers that read `memberships.role` and now derive booleans from the Feature 080 catalog

Inviteable and editable roles are only:

- `admin`
- `reviewer`
- `photographer`

`owner` is not inviteable, not editable, and not removable in the current member-management service and UI. Owner rows are visible to managers but read-only.

Owner safety is enforced in multiple places:

- `MANAGEABLE_MEMBERSHIP_ROLES` excludes `owner`.
- `tenant_membership_invites.role` has a check constraint limited to `admin`, `reviewer`, and `photographer`.
- `create_or_refresh_tenant_membership_invite(...)` and `refresh_tenant_membership_invite(...)` reject roles outside `admin`, `reviewer`, and `photographer`.
- `updateTenantMemberRole(...)` rejects existing `owner` rows with `owner_membership_immutable`.
- `removeTenantMember(...)` rejects existing `owner` rows with `owner_membership_immutable`.
- membership update/delete RLS policies exclude owner rows.

Current member management:

- `GET /api/members` loads members and pending invites for the active tenant.
- `POST /api/members/invites` creates or refreshes an invite.
- `POST /api/members/invites/[inviteId]/resend` resends and can update the pending invite role.
- `POST /api/members/invites/[inviteId]/revoke` revokes pending invites.
- `PATCH /api/members/[userId]` changes non-owner roles.
- `DELETE /api/members/[userId]` removes non-owner memberships.
- `src/lib/tenant/member-management-service.ts` requires `permissions.canManageMembers`, which maps to `organization_users.manage` and currently means owner/admin.

Organization invite acceptance:

- `tenant_membership_invites` stores pending, accepted, revoked, and expired invite rows.
- Invite tokens are stored hashed in `token_hash`.
- Pending invites are unique per `(tenant_id, normalized_email)`.
- `create_or_refresh_tenant_membership_invite(...)` reuses or refreshes the pending row and returns `already_member` when the target email already belongs to a current member.
- `accept_tenant_membership_invite(...)` validates the authenticated email against the invite email, inserts the membership with the invite role using `on conflict do nothing`, marks the invite accepted, and is retry-safe.
- Accepting an invite sets the active tenant cookie through the join route flow and clears the pending invite cookie.

Active tenant behavior:

- `resolveTenantId(...)` and `ensureTenantId(...)` read the user's memberships.
- A single membership resolves automatically.
- Multiple memberships require a valid `sc_active_tenant` cookie.
- The active tenant cookie is only a hint and is validated against current memberships.
- A pending organization invite cookie blocks owner-tenant bootstrap while the user has no memberships.
- If no membership and no pending invite cookie exist, `ensure_tenant_for_current_user()` can still bootstrap a fresh owner tenant.

Current tests that cover this model:

- `tests/feature-070-tenant-rbac-foundation.test.ts` covers role booleans, SQL helper behavior, owner/admin project and workspace management, reviewer/photographer blocks, invite create/refresh/accept/revoke, member listing, non-owner role update, and member removal.
- `tests/feature-070-active-tenant-route.test.ts` covers active-tenant selection.
- `tests/feature-080-role-capability-catalog.test.ts` covers fixed-role capability mapping and member UI clarity.

### Current capability catalog from Feature 080

The TypeScript catalog lives in `src/lib/tenant/role-capabilities.ts`.

Current capability keys:

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

Current role-to-capability mapping:

- `owner`: every current capability.
- `admin`: every current capability.
- `reviewer`: `profiles.view`, review, workflow/finalization, correction, and Media Library capabilities.
- `photographer`: `profiles.view` plus capture and upload capabilities.

Current permission booleans are derived in `src/lib/tenant/permissions.ts`:

- `deriveTenantPermissionsFromRole(...)`
- `deriveProjectPermissionsFromRole(...)`
- `resolveTenantPermissions(...)`
- `resolveProjectPermissions(...)`
- `resolveWorkspacePermissions(...)`

The app-layer booleans still used by routes and pages include:

- `canManageMembers`
- `canManageTemplates`
- `canManageProfiles`
- `canCreateProjects`
- `canCaptureProjects`
- `canReviewProjects`
- `canCreateOneOffInvites`
- `canCreateRecurringProjectConsentRequests`
- `canUploadAssets`
- `canInitiateConsentUpgradeRequests`
- `canManageWorkspaces`

Helpers/services still using role-derived booleans or capability checks:

- `src/lib/tenant/member-management-service.ts`
- `src/lib/templates/template-service.ts`
- `src/lib/profiles/profile-access.ts`
- `src/lib/projects/project-workspace-request.ts`
- `src/lib/project-releases/project-release-service.ts`
- `src/lib/media-library/media-library-folder-service.ts`
- protected layout and project pages

Important mismatch risk:

- TypeScript now has named capability keys.
- SQL/RLS still independently encodes fixed-role behavior through role lists.
- There is no database capability table today.
- There is no automated database seed/capability drift check today because the catalog is code-only.

For Feature 081, the durable database naming scheme should store the same capability keys as `src/lib/tenant/role-capabilities.ts`. Introducing a different naming vocabulary would create immediate drift between code, UI, tests, and future database enforcement.

## Current schema, routes, helpers, SQL/RLS, and tests involved

### Current SQL/RLS permission model

The current SQL/RLS model is fixed-role based. It does not read a role definition table, role-capability join table, or role-assignment table.

Member management:

- SQL helpers:
  - `app.current_user_membership_role(p_tenant_id)`
  - `app.current_user_can_manage_members(p_tenant_id)`
- Current allowed manager roles: `owner`, `admin`.
- RLS policies on `memberships` allow manager select/insert/update/delete, with owner rows protected from update/delete.
- RLS policies on `tenant_membership_invites` allow owner/admin management.
- TypeScript services also check `resolveTenantPermissions(...).canManageMembers`.
- Enforcement is both SQL/RLS and TypeScript.

Template management:

- SQL helper: `app.current_user_can_manage_templates(p_tenant_id)`.
- Current allowed manager roles: `owner`, `admin`.
- Template policies use that helper for tenant-template management.
- `src/lib/templates/template-service.ts` also resolves `templates.manage`.
- Enforcement is both SQL/RLS and TypeScript.

Recurring profile management:

- SQL helper: `app.current_user_can_manage_recurring_profiles(p_tenant_id)`.
- Current allowed manager roles: `owner`, `admin`.
- Recurring profile/type policies use that helper for writes.
- `src/lib/profiles/profile-access.ts` derives `profiles.view` and `profiles.manage`.
- Profile viewing is available to any current fixed role through the TypeScript catalog and membership-backed SQL policies.
- Enforcement is both SQL/RLS and TypeScript.

Project creation:

- SQL helper: `app.current_user_can_create_projects(p_tenant_id)`.
- Current allowed roles: `owner`, `admin`.
- `projects_insert_workspace_member` requires that helper plus `created_by = auth.uid()`.
- `src/app/api/projects/route.ts` calls `assertCanCreateProjectsAction(...)`.
- Enforcement is both SQL/RLS and TypeScript.

Project access:

- SQL helper: `app.current_user_can_access_project(p_tenant_id, p_project_id)`.
- Owner/admin/reviewer can access projects tenant-wide.
- Photographer access requires at least one `project_workspaces` row in the project with `photographer_user_id = auth.uid()`.
- `projects_select_workspace_member` uses this helper.
- Protected project list/page code also uses TypeScript tenant/workspace helpers.
- Enforcement is both SQL/RLS and TypeScript.

Workspace access:

- SQL helpers:
  - `app.current_user_can_access_project_workspace(p_tenant_id, p_project_id, p_workspace_id)`
  - `app.current_user_can_capture_project_workspace(...)`
  - `app.current_user_can_review_project_workspace(...)`
  - `app.current_user_can_manage_project_workspaces(...)`
- Owner/admin/reviewer can access/review all workspaces in a project.
- Photographers can access/capture only workspaces where `project_workspaces.photographer_user_id = auth.uid()`.
- Owner/admin can manage project workspaces.
- `project_workspaces` RLS and many workspace-scoped table policies use these helpers.
- `src/lib/projects/project-workspaces-service.ts` and `src/lib/projects/project-workspace-request.ts` mirror the same behavior in TypeScript.
- Enforcement is both SQL/RLS and TypeScript.

Capture actions:

- Current capture permission is fixed-role plus workspace assignment.
- Owner/admin can capture in any project workspace.
- Photographers can capture only in assigned workspaces.
- Reviewers cannot capture.
- SQL/RLS uses `app.current_user_can_capture_project_workspace(...)` for insert/update on capture tables such as `subject_invites`, `subjects`, `consents`, `assets`, and `project_profile_participants`.
- TypeScript route helpers use `requireWorkspaceCaptureAccessForRequest(...)`, `requireWorkspaceCaptureMutationAccessForRequest(...)`, and row-scoped equivalents.
- Workflow state further narrows capture mutations through `assertWorkspaceCaptureMutationAllowed(...)`.

Review actions:

- Current review permission is fixed-role based.
- Owner/admin/reviewer can review any workspace in the tenant.
- Photographers cannot review, even in their assigned workspace.
- SQL/RLS uses `app.current_user_can_review_project_workspace(...)` for review-state inserts/updates on face links, review sessions, face assignees, whole-asset links, hidden/block state, and upgrade requests.
- TypeScript route helpers use `requireWorkspaceReviewAccessForRequest(...)`, `requireWorkspaceReviewMutationAccessForRequest(...)`, and row-scoped equivalents.
- Workflow state further narrows review mutations through `assertWorkspaceReviewMutationAllowed(...)`.

Workflow, finalization, and correction actions:

- Feature 073/075/076/079 workflow code uses reviewer-capable access plus workflow/correction state.
- Finalization and correction start are owner/admin/reviewer actions.
- Correction consent intake, correction review, and correction media intake are owner/admin/reviewer actions.
- `src/lib/projects/project-workspace-request.ts` uses `roleHasCapability(..., "correction.media_intake")` for correction media intake and keeps the workflow-state checks in `project-workflow-service`.
- Enforcement is primarily TypeScript service/route checks plus SQL/RLS table policies for underlying rows.

Media Library access and folder management:

- SQL helpers:
  - `app.current_user_can_access_media_library(p_tenant_id)`
  - `app.current_user_can_manage_media_library(p_tenant_id)`
- Current allowed roles: `owner`, `admin`, `reviewer`.
- Photographers are denied.
- Release tables are select-only for authenticated users and readable only through the Media Library access helper.
- Folder tables allow authenticated owner/admin/reviewer reads and writes through the Media Library helpers.
- `src/lib/project-releases/project-release-service.ts` checks `media_library.access`.
- `src/lib/media-library/media-library-folder-service.ts` uses Media Library authorization and folder write rules.
- Enforcement is both SQL/RLS and TypeScript.

Why Feature 081 should not change SQL/RLS enforcement:

- SQL/RLS currently encodes live fixed-role behavior directly and protects many tables.
- A partial SQL migration to role-definition/capability tables would need to touch every helper above and every policy depending on them.
- Doing only some helpers would create inconsistent access behavior across TypeScript and RLS.
- The intended 081 behavior explicitly preserves current access behavior.
- Therefore 081 should add foundation tables and read/verification helpers only. It should not make SQL/RLS consume new assignments yet.

### Current route/helper surface

Tenant/member routes:

- `src/app/api/members/**`
- `src/app/join/[token]/accept/route.ts`
- `src/app/api/tenants/active/route.ts`
- `src/lib/tenant/member-management-service.ts`
- `src/lib/tenant/membership-invites.ts`
- `src/lib/tenant/resolve-tenant.ts`
- `src/lib/tenant/active-tenant.ts`

Project/workspace routes:

- `src/app/api/projects/route.ts`
- `src/app/api/projects/[projectId]/workspaces/**`
- capture routes under `src/app/api/projects/[projectId]/invites/**`, `profile-participants/**`, and `assets/**`
- review routes under `assets/[assetId]/**`, `consents/[consentId]/**`, finalize, correction, and export routes
- `src/lib/projects/project-workspaces-service.ts`
- `src/lib/projects/project-workspace-request.ts`
- `src/lib/projects/project-workflow-service.ts`
- `src/lib/projects/project-workflow-route-handlers.ts`

Media Library routes:

- `src/app/api/media-library/assets/[releaseAssetId]/download/route.ts`
- `src/app/api/media-library/folders/**`
- `src/lib/project-releases/project-release-service.ts`
- `src/lib/media-library/media-library-folder-service.ts`

### Current fixed-role and capability-catalog model

The current model has two layers:

1. Database fixed-role layer:
   - `memberships.role`
   - SQL helper role lists
   - RLS policies
   - invite/member-management constraints
2. TypeScript capability vocabulary:
   - `src/lib/tenant/role-capabilities.ts`
   - role-to-capability mapping for the same fixed roles
   - app-layer permission booleans derived from capability keys

The TypeScript catalog is not the database enforcement source. It is an app-layer vocabulary over fixed roles.

### Current enforcement source of truth

The live enforcement source of truth is still `memberships.role`, interpreted by both:

- SQL helper functions and RLS policies
- TypeScript helpers that load membership role and derive capability booleans

`project_workspaces.photographer_user_id` is an additional live assignment source for photographer workspace access only.

No current route or RLS policy should consult any new Feature 081 role-assignment table until a later migration feature explicitly moves that area and its tests.

## Options considered

### Scoped assignment options

#### Option A - Role assignments only at tenant scope first

Shape:

- durable roles and capabilities are added
- role assignments exist only at tenant scope
- project/workspace scoped columns or tables are deferred

Evaluation:

- implementation size: small
- migration complexity: low
- tenant isolation: straightforward
- RLS implications: minimal if read-only/foundation-only
- compatibility with current fixed roles: good
- future custom role editor fit: partial
- future project-scoped reviewer fit: weak because another assignment migration is required
- future workspace-scoped reviewer fit: weak
- agency/client future fit: partial
- conflicting access truth risk: medium if tenant assignments start shadowing `memberships.role`

Conclusion:

- Too narrow for the stated 081 goal. It would create durable roles but not the scoped assignment foundation that future project/workspace reviewer work needs.

#### Option B - Generic scoped assignment table now

Shape:

- one assignment table supports `tenant`, `project`, and `workspace` scopes
- `project_id` and `workspace_id` are nullable/conditional by `scope_type`
- constraints enforce tenant/project/workspace consistency
- no current enforcement reads it yet

Evaluation:

- implementation size: medium
- migration complexity: medium
- tenant isolation: strong if every row stores `tenant_id` and has composite FKs
- RLS implications: manageable if owner/admin readable and optionally service-managed in 081
- compatibility with current fixed-role enforcement: strong if not used for live checks
- future custom role editor fit: strong
- future project-scoped reviewer fit: strong
- future workspace-scoped reviewer fit: strong
- agency/client future fit: good because scope is explicit and can be extended later
- conflicting access truth risk: low if documented and tested as non-enforcing

Conclusion:

- Recommended. It directly prepares the intended future scoped model while avoiding a partial enforcement migration.

#### Option C - Separate assignment tables per scope

Shape:

- `tenant_role_assignments`
- `project_role_assignments`
- `workspace_role_assignments`

Evaluation:

- implementation size: medium to large
- migration complexity: medium
- tenant isolation: strong with separate composite FKs
- RLS implications: repeated policy surface
- compatibility with current fixed-role enforcement: good if non-enforcing
- future custom role editor fit: workable but fragmented
- future project-scoped reviewer fit: strong
- future workspace-scoped reviewer fit: strong
- agency/client future fit: okay but extension means more tables
- conflicting access truth risk: low to medium

Conclusion:

- More explicit than Option B but more repetitive. The current app already has multiple scope concepts; a single typed assignment table is easier to query and reason about for read helpers.

#### Option D - Do nothing durable yet

Shape:

- keep Feature 080 code catalog only
- defer DB-backed roles and scoped assignments

Evaluation:

- implementation size: none
- migration complexity: none
- tenant isolation: unchanged
- RLS implications: unchanged
- compatibility with current fixed-role enforcement: perfect
- future custom role editor fit: poor
- future project-scoped reviewer fit: poor
- future workspace-scoped reviewer fit: poor
- agency/client future fit: poor
- conflicting access truth risk: none now, but future migration remains larger

Conclusion:

- Too conservative for the feature goal. Feature 080 already did the code-only catalog.

Recommendation:

- Use Option B: add one generic, tenant-scoped role-assignment table that can represent tenant, project, and workspace assignment, but keep it non-enforcing in Feature 081.

### Role definition model options

#### Option 1 - Tenant-local custom roles plus system roles in one table

Shape:

- one `role_definitions` table
- system roles have `tenant_id null`, `is_system = true`, stable `system_role_key`
- tenant custom roles have `tenant_id not null`, `is_system = false`

Evaluation:

- represents current fixed roles cleanly as global system roles
- avoids copying system roles to every tenant
- tenant-local custom roles can be prepared without exposing creation APIs yet
- role slugs can be unique within tenant and separately unique for system roles
- future UI can list system roles plus tenant roles
- system roles can be immutable through constraints/service rules

Conclusion:

- Recommended, with custom-role creation not exposed in Feature 081.

#### Option 2 - Global/system role definitions plus tenant custom roles in separate tables

Shape:

- `system_role_definitions`
- `tenant_role_definitions`

Evaluation:

- very explicit
- fewer nullable fields
- more joins and duplicated code paths
- role-capability mapping must either split too or use polymorphic references

Conclusion:

- Reasonable but more complex than necessary.

#### Option 3 - Copy system roles per tenant

Shape:

- every tenant gets its own owner/admin/reviewer/photographer role rows

Evaluation:

- custom editor has one table to display
- backfill/seed becomes per-tenant
- system role drift across tenants becomes possible
- current fixed-role behavior still depends on `memberships.role`, so copied rows would invite drift

Conclusion:

- Not recommended for 081.

#### Option 4 - Store system-role templates separately from tenant roles

Shape:

- role templates define system role capability sets
- tenant role rows may be instantiated from templates later

Evaluation:

- useful if system roles become tenant-customizable templates later
- overdesigned for a foundation where current fixed roles must remain stable

Conclusion:

- Not recommended for 081.

Role definition recommendation:

- Add one role-definition table that supports global system roles and tenant-local custom roles.
- Seed only global system roles in Feature 081.
- Do not expose custom role creation API in Feature 081.
- Keep system roles immutable and stable.

### Capability storage model options

#### Option 1 - Capabilities as rows in a `capabilities` table

Shape:

- `capabilities.key` stores the canonical string key.
- optional labels/groups/descriptions may be stored, but should not be authoritative for UI copy in 081.
- `role_capabilities` references capability rows.

Evaluation:

- source of truth for allowed database capability keys is explicit.
- database can enforce role-capability mappings against known capability rows.
- drift with `role-capabilities.ts` can be tested.
- labels/descriptions should stay in code/i18n for now to avoid duplicate UI copy.
- groups can stay in TypeScript; database only needs raw keys for enforcement foundation.

Conclusion:

- Recommended.

#### Option 2 - Checked text values directly in a role-capability join table

Shape:

- no `capabilities` table.
- `role_capabilities.capability_key` has a SQL check constraint containing all allowed keys.

Evaluation:

- smaller table count.
- every capability catalog change requires rewriting a check constraint.
- harder to query/list capabilities for future UI.
- still duplicates capability keys in SQL.

Conclusion:

- Viable but less flexible than capability rows.

#### Option 3 - Capabilities seeded from the TypeScript catalog

Shape:

- migration seeds capability keys copied from `role-capabilities.ts`.
- tests compare SQL seed rows to the TypeScript catalog.

Evaluation:

- good fit for Supabase migrations.
- SQL remains deterministic for clean `supabase db reset`.
- TypeScript remains the developer-friendly catalog.
- drift tests are essential.

Conclusion:

- Recommended in combination with Option 1.

#### Option 4 - Capabilities stored only in code, DB stores role ids only

Shape:

- database has roles but not role-capability mappings.

Evaluation:

- not enough for a durable custom-role foundation.
- future SQL/RLS migration would still have nowhere to resolve capabilities.

Conclusion:

- Reject.

Capability storage recommendation:

- Add a `role_capabilities` or `capabilities` table with one row per current Feature 080 capability key.
- Add a `role_definition_capabilities` join table from role definitions to capability keys/ids.
- Seed all current capability keys and system role mappings in an idempotent SQL migration.
- Keep capability labels, descriptions, groups, and i18n copy in TypeScript/messages for Feature 081.
- Add tests that fail if database capability rows or system role mappings drift from `src/lib/tenant/role-capabilities.ts`.
- Do not add versioning in 081. Treat future capability changes as normal migrations plus catalog tests.

### Role assignment semantics

Who should be assigned:

- Assignments should reference the existing tenant membership, not bare `auth.users`.
- Recommended reference shape: `(tenant_id, user_id)` foreign key to `public.memberships(tenant_id, user_id)`.
- This guarantees scoped assignments cannot exist for users who are not tenant members.

Why not assign directly to `auth.users`:

- A bare user id lacks tenant membership semantics.
- It would allow project/workspace assignment rows without current tenant access.
- It would complicate removal handling.

Tenant membership requirement:

- Tenant membership should still be required before any scoped assignment.
- Project/workspace assignments should not imply tenant membership.
- A tenant membership must be created through the existing invite/bootstrap/member flow first.

Removed members:

- Because `memberships` currently hard-deletes non-owner removals, role assignments should reference memberships with `on delete cascade` or equivalent cleanup.
- That prevents removed members from leaving active durable scoped assignments.
- If later features introduce suspended/deactivated memberships, assignment revocation semantics can be revisited.

Revocation/archive:

- Assignment rows should have active/revoked state rather than hard delete only.
- Recommended columns:
  - `created_at`
  - `created_by`
  - `revoked_at`
  - `revoked_by`
- Active assignment means `revoked_at is null`.
- Historical revoked rows help audit future custom-role changes without becoming live enforcement in 081.

Multiple active roles:

- Allow multiple active roles for one user in the same scope.
- Future custom roles may intentionally compose, and deny/override semantics are out of scope.
- Effective future permissions can be the union of capabilities across active assignments.

Duplicate prevention:

- Prevent duplicate active assignments for the same `(tenant_id, user_id, role_definition_id, scope_type, project_id, workspace_id)` by a partial unique index where `revoked_at is null`.

Scope consistency:

- `scope_type = 'tenant'` requires `project_id is null` and `workspace_id is null`.
- `scope_type = 'project'` requires `project_id is not null` and `workspace_id is null`.
- `scope_type = 'workspace'` requires both `project_id is not null` and `workspace_id is not null`.
- Workspace assignments must use a composite FK `(workspace_id, tenant_id, project_id)` to `project_workspaces`.
- Project assignments must use `(project_id, tenant_id)` to `projects`.

Should current fixed-role assignments be duplicated into new rows now:

- Do not backfill every current membership into role-assignment rows in Feature 081 by default.
- Backfilling creates an immediate drift problem because `memberships.role` remains enforcement and assignments do not.
- If the plan chooses to mirror current memberships for developer inspection, those mirrored rows must be marked clearly as non-enforcing and must be regenerated/kept in sync on role changes. That adds unnecessary complexity.

Recommendation:

- Seed system role definitions and role-capability mappings.
- Do not create per-membership role-assignment rows for existing `memberships.role` in Feature 081.
- Keep assignments available for future features and tests, but not populated as a shadow mirror of live roles.

### Relationship to `memberships.role`

Recommended relationship after Feature 081:

- `memberships.role` remains unchanged and authoritative for live enforcement.
- System roles are mirrored as durable role definitions for `owner`, `admin`, `reviewer`, and `photographer`.
- System role definitions map to the same capability keys as `ROLE_CAPABILITIES`.
- New scoped assignment rows are durable foundation data only and are not read by current route/RLS enforcement.
- TypeScript capability catalog remains the developer-facing capability vocabulary.
- SQL/RLS helpers continue to read `memberships.role`.

Should every current membership receive a role assignment row:

- No, not in Feature 081.

Why not:

- It creates two representations of the same fixed role without enforcement using the new one.
- Role changes in the Members page would need to update both `memberships.role` and role assignments to avoid drift.
- Invite acceptance would need to write both places.
- Removal would need careful cleanup and auditing.
- None of that is needed if the assignments are not live enforcement.

Future safe migration path:

1. Feature 081 adds system roles, capabilities, and assignment tables.
2. Future features can create scoped assignment rows for new capabilities without changing existing `memberships.role` behavior.
3. A later enforcement migration can add read-only resolver functions that union fixed-role capabilities with durable assignments.
4. Each route/RLS area can migrate behind parity tests.
5. Only after all live helpers read the durable model should `memberships.role` be considered for deprecation or simplification.

Tests proving current behavior did not change should assert:

- fixed role booleans still match Feature 080.
- SQL helpers still return current fixed-role answers.
- member-management invite, update, and remove behavior still writes `memberships.role` only.
- durable assignment rows do not grant any current access.

### Recommended bounded direction

Implement a schema-only/read-helper foundation:

- `capabilities`
- `role_definitions`
- `role_definition_capabilities`
- `role_assignments`

Seed:

- all current Feature 080 capability keys
- system role definitions for `owner`, `admin`, `reviewer`, `photographer`
- system role-to-capability mappings matching `ROLE_CAPABILITIES`

Add helper boundaries:

- list system role definitions
- list tenant-visible role definitions
- list capabilities
- load role with capabilities
- list role assignments for a user/scope
- resolve durable role assignments without enforcing them
- test/dev assertion that DB capabilities and system role mappings match TypeScript

Do not add:

- custom role editor UI
- assignment UI
- invite-to-custom-role
- RLS helper migration
- route behavior changes
- automatic mirroring of every membership role into assignments

This direction prepares future scoped roles while keeping current behavior stable.

## Proposed future migration path toward scoped capability enforcement

Feature 082 - project-scoped role assignments for reviewers:

- Use the `role_assignments` table to create project- or workspace-scoped reviewer assignments.
- Add read helpers that resolve durable assignments for a project/workspace.
- Keep reviewer tenant-wide behavior until the feature explicitly changes enforcement.
- When changing enforcement, update project list visibility, workspace visibility, TypeScript helpers, SQL helpers, and RLS policies together for the reviewer area.

Feature 083 - custom role editor UI:

- Add APIs and UI for tenant-local role definitions.
- Allow editing only tenant custom roles, never system roles.
- Validate capability keys against the seeded `capabilities` table.
- Use server-side role-management permission, likely owner/admin only.
- Keep dangerous capability combinations visible and audited.

Feature 084 - invite/member assignment to custom roles:

- Extend invite/member flows to assign custom roles only after the role editor and assignment semantics are stable.
- Decide whether invites still require a fixed `memberships.role` fallback.
- Do not remove fixed-role membership creation until all live enforcement can handle durable roles.

Feature 085 - gradual SQL/RLS enforcement migration to scoped capabilities:

- Add SQL functions that resolve effective capabilities from fixed roles plus active durable assignments.
- Migrate one enforcement area at a time:
  - project reviewer access
  - workspace reviewer access
  - Media Library access
  - template/profile management
  - member management
- Add parity tests before and after each area migrates.
- Keep `memberships.role` as fallback until all policies and TypeScript helpers are migrated.

What Feature 081 should prepare now:

- stable tables and constraints
- stable system role keys
- stable capability keys
- non-enforcing read helpers
- drift tests
- developer documentation warnings

What must stay deferred:

- actual custom role creation by users
- scoped reviewer enforcement
- route/RLS behavior changes
- replacing fixed-role SQL helpers

## Security and tenant-isolation risks

Risk: accidentally granting access through new tables before enforcement is ready.

- Mitigation: no current SQL helper, RLS policy, route, or service should call the new assignment resolver in Feature 081.
- Add tests that a durable assignment row does not allow a photographer to review, does not allow a reviewer to capture, and does not allow a non-member to access anything.

Risk: inconsistent TypeScript and SQL capability interpretation.

- Current SQL has role lists, while TypeScript has capability keys.
- Mitigation: seed database capabilities from the same keys and add drift tests.
- Do not invent SQL-only capability names.

Risk: project/workspace assignment rows crossing tenant boundaries.

- Mitigation: every assignment row must include `tenant_id`.
- Use composite FKs:
  - `(project_id, tenant_id)` to `projects`
  - `(workspace_id, tenant_id, project_id)` to `project_workspaces`
  - `(tenant_id, user_id)` to `memberships`

Risk: workspace assignment points to the wrong project.

- Mitigation: workspace scope must require both `project_id` and `workspace_id`, with a composite workspace FK.

Risk: deleted/removed memberships leave active assignments.

- Mitigation: assignment membership FK should cascade on membership deletion or a trigger should revoke assignments on removal.
- Because current member removal hard-deletes `memberships`, cascading cleanup is the simplest first-slice fit.

Risk: custom roles with no capabilities.

- Feature 081 should not expose custom-role creation.
- Future editor should allow empty draft roles only if they are clearly non-assignable, or reject empty active roles.

Risk: roles with dangerous capability combinations.

- Feature 081 should seed system combinations only.
- Future UI should make high-risk capabilities visible and probably require owner/admin management.
- No allow/deny overrides should be introduced in 081.

Risk: owner/admin safety.

- Keep owner protection on `memberships.role`.
- System `owner` role definition must be immutable.
- Do not add owner assignment/demotion semantics in 081.

Risk: future privilege escalation through custom role editing.

- No custom role editing API in 081.
- Future role editor must be server-authoritative and likely require `organization_users.manage` or a future role-management capability.
- Future editor must not allow a user to grant themselves role-management power through client-submitted tenant ids.

Risk: active tenant switching and scoped assignment resolution.

- Future assignment resolvers must always take server-resolved active tenant id.
- They must never accept tenant id from client.
- Project/workspace assignments must be checked against the active tenant membership, not just the project id.

## Migration and seed considerations

Likely new tables:

### `capabilities`

Recommended columns:

- `key text primary key`
- `created_at timestamptz not null default now()`

Optional later columns:

- `deprecated_at`
- `replacement_key`

Not recommended in 081:

- labels
- descriptions
- UI group metadata

Reason:

- UI copy and groups already live in TypeScript/i18n. Duplicating them in DB creates another drift source.

### `role_definitions`

Recommended columns:

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid null references public.tenants(id) on delete cascade`
- `slug text not null`
- `name text not null`
- `description text null`
- `is_system boolean not null default false`
- `system_role_key text null`
- `created_at timestamptz not null default now()`
- `created_by uuid null references auth.users(id) on delete restrict`
- `updated_at timestamptz not null default now()`
- `updated_by uuid null references auth.users(id) on delete restrict`
- `archived_at timestamptz null`
- `archived_by uuid null references auth.users(id) on delete restrict`

Recommended constraints:

- system roles have `tenant_id is null`, `is_system = true`, and non-null `system_role_key`.
- tenant custom roles have `tenant_id is not null`, `is_system = false`, and `system_role_key is null`.
- system role keys limited to `owner`, `admin`, `reviewer`, `photographer`.
- unique global system role key.
- unique active role slug per tenant for tenant roles.
- unique active system slug for system roles.
- archive shape checks if archive columns are included.

Feature 081 should seed system role definitions only.

### `role_definition_capabilities`

Recommended columns:

- `role_definition_id uuid not null references role_definitions(id) on delete cascade`
- `capability_key text not null references capabilities(key) on delete restrict`
- `created_at timestamptz not null default now()`
- primary key `(role_definition_id, capability_key)`

Recommended behavior:

- system role mappings are seeded idempotently.
- no user-facing mutation API in 081.
- future custom role editor can use the same join table for tenant roles.

### `role_assignments`

Recommended columns:

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null references public.tenants(id) on delete cascade`
- `user_id uuid not null`
- `role_definition_id uuid not null references role_definitions(id) on delete restrict`
- `scope_type text not null check (scope_type in ('tenant', 'project', 'workspace'))`
- `project_id uuid null`
- `workspace_id uuid null`
- `created_at timestamptz not null default now()`
- `created_by uuid null references auth.users(id) on delete restrict`
- `revoked_at timestamptz null`
- `revoked_by uuid null references auth.users(id) on delete restrict`

Recommended constraints:

- FK `(tenant_id, user_id)` to `memberships(tenant_id, user_id)` with cascade on delete.
- FK `(project_id, tenant_id)` to `projects(id, tenant_id)` for project/workspace scope.
- FK `(workspace_id, tenant_id, project_id)` to `project_workspaces(id, tenant_id, project_id)` for workspace scope.
- scope shape check:
  - tenant: both project and workspace null
  - project: project not null, workspace null
  - workspace: project and workspace not null
- revoke shape check:
  - `revoked_at` and `revoked_by` both null or both non-null
- partial unique active assignment index across role/user/scope where `revoked_at is null`.

Should system roles be seeded in SQL migration:

- Yes. Seed `owner`, `admin`, `reviewer`, and `photographer` idempotently.

Should capabilities be seeded in SQL migration:

- Yes. Seed the exact `TENANT_CAPABILITIES` keys idempotently.

Should seed data be idempotent:

- Yes. Use `insert ... on conflict do update` or `on conflict do nothing` depending on whether descriptive fields are included.

Clean local reset validation:

- The migration should apply cleanly from scratch with `supabase db reset`.
- Because live enforcement remains on `memberships.role`, no compatibility layer for arbitrary old local assignment data is needed.

Production-safe backfill:

- No role-assignment backfill is required if assignments are not used for live enforcement.
- Seeding system roles/capabilities is production-safe and additive.

## App helper considerations

Recommended helper boundaries after Feature 081:

- `listRoleDefinitionsForTenant(supabase, tenantId)`
  - returns global system roles plus tenant custom roles when custom roles exist later
- `listSystemRoles(supabase)`
  - reads role definitions where `is_system = true`
- `listCapabilities(supabase)`
  - reads database capability keys
- `loadRoleDefinitionWithCapabilities(supabase, roleDefinitionId, tenantId)`
  - tenant-scoped lookup for future UI
- `listRoleAssignmentsForUser(supabase, tenantId, userId)`
  - non-enforcing read helper
- `listRoleAssignmentsForProject(supabase, tenantId, projectId)`
  - future staffing/reviewer UI support
- `listRoleAssignmentsForWorkspace(supabase, tenantId, projectId, workspaceId)`
  - future workspace-scoped reviewer support
- `resolveDurableRoleAssignments(...)`
  - returns assignment/capability information but must be documented as non-enforcing in 081
- `assertRoleCapabilityCatalogMatchesDatabase(...)`
  - dev/test helper comparing TypeScript keys and system mappings to database rows

Helper placement:

- A new module under `src/lib/tenant/role-definitions.ts` or `src/lib/tenant/role-assignment-foundation.ts` would keep this separate from live `permissions.ts`.
- Do not put durable assignment resolution into `src/lib/tenant/permissions.ts` yet, because that file currently powers live enforcement.

## UI and API scope recommendation

Feature 081 should expose no user-visible UI.

Recommended API scope:

- No public or protected mutation APIs for custom roles.
- No Members page assignment controls.
- No invite-to-custom-role behavior.

Acceptable minimal surfacing:

- internal helper functions
- tests
- RPI/developer documentation

Reason:

- A UI or API that creates role definitions or assignments would imply these rows affect access.
- In Feature 081 they intentionally should not affect current access.
- User-visible custom role management should wait until enforcement and migration rules are planned.

## Testing recommendations

Tests should prove both foundation correctness and no current behavior change.

Current fixed role behavior:

- `deriveTenantPermissionsFromRole(...)` and `deriveProjectPermissionsFromRole(...)` still produce the exact Feature 080 booleans.
- `ROLE_CAPABILITIES` still maps the four fixed roles exactly.
- SQL helpers still return the same answers:
  - owner/admin manage members, create projects, manage templates/profiles, manage project workspaces
  - reviewer reviews/finalizes/corrects/accesses Media Library but cannot capture/create/manage members
  - photographer captures only assigned workspaces and cannot review or access Media Library

Member management:

- owner row remains non-editable and non-removable.
- invite roles remain `admin`, `reviewer`, `photographer`.
- role update still writes `memberships.role`.
- member removal still removes the membership and cascades/deletes any future assignment rows if present.
- invite acceptance still creates a membership with the invite role and does not require a role-assignment row.

Invite and active tenant:

- duplicate invite refresh remains idempotent.
- wrong-email accept fails.
- revoked/expired invite cannot be accepted.
- accepted invite sets active tenant through existing flow.
- active tenant selection remains membership-validated.

Project/workspace access:

- photographers remain scoped to assigned workspaces.
- reviewers remain tenant-wide for now.
- durable project/workspace role assignment rows do not affect project list, workspace visibility, capture, review, finalization, correction, or export in Feature 081.

Media Library:

- owner/admin/reviewer access remains unchanged.
- photographer remains denied.
- durable assignment rows do not grant Media Library access.

New schema and seed tests:

- all expected capability keys are seeded in `capabilities`.
- system role rows exist for `owner`, `admin`, `reviewer`, `photographer`.
- system role-capability rows match `ROLE_CAPABILITIES`.
- system roles are immutable by normal authenticated writes if write RLS is present, or writable only by service/admin path if no authenticated writes are granted.
- tenant custom role slug uniqueness works if tenant role rows are allowed by schema.
- assignment scope shape checks reject invalid tenant/project/workspace combinations.
- workspace assignment cannot point to a workspace from another project.
- assignment cannot point to a project from another tenant.
- assignment cannot exist without a tenant membership.
- duplicate active assignments are prevented.
- revoked historical duplicate may coexist with a new active assignment if desired.
- removing a membership cleans active assignment rows or prevents them from staying active.

Drift tests:

- TypeScript `TENANT_CAPABILITIES` equals database capability rows after migration.
- TypeScript `ROLE_CAPABILITIES` equals seeded system role mappings.
- No extra database capability key exists without TypeScript support.
- No TypeScript capability is missing from the database.

Non-enforcement tests:

- Create a durable role assignment granting `review.workspace` to a photographer and assert current review route/helper still denies.
- Create a durable role assignment granting `capture.workspace` to a reviewer and assert current capture route/helper still denies.
- Create a durable Media Library assignment for a photographer and assert current Media Library authorization still denies.

## Open questions for the plan phase

1. Should `role_definitions.created_by` and `updated_by` be nullable for seeded system roles, or should migrations use a sentinel/system actor pattern?
2. Should `role_assignments.created_by` be nullable for future system-created assignments, or always require an authenticated actor?
3. Should Feature 081 include authenticated read RLS for role definition/assignment tables, or keep them service/admin-only until UI exists?
4. If authenticated read RLS is added, should owners/admins see all durable assignments while normal members see only their own?
5. Should `role_assignments` cascade on membership delete or soft-revoke via trigger? Cascade is simpler, soft-revoke is more auditable.
6. Should tenant custom role rows be allowed by schema in 081 but not exposed by API, or should a check constraint temporarily restrict inserted rows to system roles only?
7. Should a future role-management capability key be added now? Current research recommends no future-only capability keys in 081.
8. Should system role definitions include display names/descriptions in DB, or rely only on i18n/code? Current recommendation is i18n/code only for labels.
9. Should the drift assertion run only in tests, or should there be a development-only runtime check?
10. Should role assignments allow multiple active roles in the same scope from day one? Current recommendation is yes, with duplicate prevention for identical role/scope/user rows.

