# Feature 086 - Custom role enforcement for tenant templates and profiles plan

## 1. Scope and contract

Feature 086 is a bounded custom-role enforcement slice for tenant-level template and recurring-profile surfaces.

This feature must enforce active tenant-scoped custom role assignments for exactly these capabilities:

- `templates.manage`
- `profiles.view`
- `profiles.manage`

Locked scope decisions:

- include `templates.manage`
- include `profiles.view`
- include `profiles.manage`
- defer `projects.create`
- defer all `organization_users.*` capabilities
- use tenant-scoped custom role assignments only
- ignore project-scoped and workspace-scoped custom role assignments
- ignore revoked assignments
- ignore archived custom roles
- update SQL/RLS and TypeScript authorization
- do not build a generic app-wide capability engine
- preserve Feature 082 reviewer enforcement
- preserve Feature 085 Media Library behavior

Out of scope:

- generic app-wide effective capability resolution
- member management custom-role enforcement
- project creation custom-role enforcement
- project/workspace/capture/review/correction/finalization custom-role enforcement
- project-scoped or workspace-scoped custom role enforcement
- invite-to-custom-role
- custom role editor or assignment redesign
- changes to consent, matching, release, correction, workflow, or Media Library semantics
- preserving arbitrary old local custom-role assignment data

## 2. Inputs and ground truth

Required documents were read in order:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `UNCODEXIFY.md`
5. `docs/rpi/README.md`
6. `docs/rpi/SUMMARY.md`
7. `docs/rpi/081-custom-role-definitions-and-scoped-role-assignment-foundation/plan.md`
8. `docs/rpi/082-project-scoped-reviewer-assignments-and-enforcement/plan.md`
9. `docs/rpi/083-custom-role-editor-foundation/plan.md`
10. `docs/rpi/084-custom-role-assignment-foundation/plan.md`
11. `docs/rpi/085-custom-role-media-library-enforcement/plan.md`
12. `docs/rpi/039-consent-form-template-editor/plan.md`
13. `docs/rpi/046-template-editor-live-preview-and-layout-builder/plan.md`
14. `docs/rpi/049-recurring-profiles-and-consent-management-foundations/plan.md`
15. `docs/rpi/050-recurring-profile-directory-foundation/plan.md`
16. `docs/rpi/051-baseline-recurring-consent-request-foundation/plan.md`
17. `docs/rpi/056-recurring-profile-headshots-and-matching-materialization-foundation/plan.md`
18. `docs/rpi/086-custom-role-template-profile-enforcement/research.md`

Targeted live verification covered:

- `src/lib/tenant/role-capabilities.ts`
- `src/lib/tenant/permissions.ts`
- `src/lib/tenant/custom-role-assignment-service.ts`
- `src/lib/tenant/media-library-custom-role-access.ts`
- `src/lib/templates/template-service.ts`
- `src/lib/profiles/profile-access.ts`
- `src/lib/profiles/profile-directory-service.ts`
- `src/lib/profiles/profile-consent-service.ts`
- `src/lib/profiles/profile-follow-up-service.ts`
- `src/lib/profiles/profile-headshot-service.ts`
- `src/lib/profiles/profile-route-handlers.ts`
- `src/app/(protected)/layout.tsx`
- `src/components/navigation/protected-nav.tsx`
- template and profile protected pages and route files
- relevant migrations and tests for Features 039, 050, 051, 056, 080, 084, and 085

Current live code and migrations are authoritative. Earlier RPI documents explain intent but do not override verified implementation.

## 3. Verified current template/profile boundary

Template authorization today:

- `templates.manage` exists in `TENANT_CAPABILITIES`.
- Fixed owner/admin roles have `templates.manage`.
- Fixed reviewer/photographer roles do not have `templates.manage`.
- `resolveTemplateManagementAccess(...)` reads `memberships.role` and derives `canManageTemplates` through `roleHasCapability(...)`.
- `assertTemplateManager(...)` is the central TypeScript mutation guard for template create, update, version, publish, and archive flows.
- `/templates` and `/templates/[templateId]` redirect non-managers to `/projects`.
- `POST /api/templates/[templateId]/preview-validate` is editor-adjacent and currently reaches `getTemplateForManagement(...)`; it should explicitly align with template management authorization.
- `PATCH /api/projects/[projectId]/default-template` calls `setProjectDefaultTemplate(...)`, which already depends on template management access.
- `app.current_user_can_manage_templates(p_tenant_id)` currently allows fixed owner/admin only.
- Template insert/update policies and template version/publish RPCs rely on that SQL helper.

Profile authorization today:

- `profiles.view` and `profiles.manage` exist in `TENANT_CAPABILITIES`.
- Fixed owner/admin have both profile capabilities.
- Fixed reviewer/photographer have `profiles.view` only.
- `resolveProfilesAccess(...)` reads `memberships.role` and derives `canViewProfiles` and `canManageProfiles` from fixed role capabilities only.
- `listRecurringProfilesPageData(...)` resolves access but does not explicitly reject `!canViewProfiles`; this is harmless today because every fixed role has view access, but it should be fixed when custom role view semantics become explicit.
- `getRecurringProfileDetailPanelData(...)` rejects without `canViewProfiles`.
- Profile create/archive, profile type create/archive, baseline request/cancel/replace/follow-up, and headshot upload/finalize/select paths all require `canManageProfiles`.
- `app.current_user_can_manage_recurring_profiles(p_tenant_id)` currently allows fixed owner/admin only.
- Profile write policies and recurring profile management RPCs rely on that SQL helper.
- Profile select policies mostly use raw tenant membership for baseline profile rows and workspace-aware policies for project-scope recurring consent rows.

Navigation today:

- `ProtectedNav` always includes `Profiles` and `Templates`.
- `ProtectedNav` has filtering props only for `Members` and `Media Library`.
- `ProtectedLayout` computes `showMembers` from `resolveTenantPermissions(...)` and `showMediaLibrary` from `resolveMediaLibraryAccess(...)`.

Custom-role enforcement pattern today:

- Feature 084 creates tenant-scoped custom role assignments but keeps them non-enforcing outside Media Library.
- Feature 085 enforces only `media_library.access` and `media_library.manage_folders`.
- Media Library TypeScript enforcement validates membership first, uses service-role reads after validation, ignores revoked assignments, ignores archived custom roles, ignores system roles, and ignores project/workspace-scoped assignments.
- Feature 085 SQL helper uses the same predicates and is wired into Media Library access/manage helpers.

Relevant tests today:

- Feature 039 covers owner template lifecycle and photographer template denial.
- Feature 050 covers owner/admin profile directory management and photographer read-only behavior.
- Feature 051 covers owner baseline request creation and photographer denial.
- Feature 056 covers recurring profile headshot management and RLS behavior.
- Feature 084 proves custom role assignments do not grant broad live access.
- Feature 085 proves Media Library custom-role enforcement and non-expansion.

Feature 086 changes:

- template management authorization can come from fixed owner/admin or active tenant custom `templates.manage`
- profile view authorization can come from fixed `profiles.view`, custom `profiles.view`, or custom `profiles.manage`
- profile management authorization can come from fixed owner/admin or active tenant custom `profiles.manage`
- nav visibility for Templates and Profiles becomes capability-aware

Feature 086 preserves:

- fixed owner/admin access
- fixed reviewer/photographer profile view access
- Feature 082 reviewer enforcement
- Feature 085 Media Library behavior
- existing project/workspace/capture/review/correction/finalization/member-management behavior

## 4. Recommendation

Implement Feature 086 with a narrow tenant custom-role capability predicate and surface-specific authorizers.

Add a shared helper for active tenant-scoped custom role capabilities, but keep authorization decisions in:

- `resolveTemplateManagementAccess(...)`
- `resolveProfilesAccess(...)`
- existing Media Library resolver exports

Do not expose a broad permission bag and do not route unrelated helpers through the new predicate. This gives templates and profiles SQL/TypeScript parity while keeping the app out of a half-migrated IAM model.

## 5. Chosen enforcement architecture

Add a bounded TypeScript helper:

- `src/lib/tenant/tenant-custom-role-capabilities.ts`

Recommended exports:

- `ENFORCED_TENANT_CUSTOM_ROLE_CAPABILITIES`
- `EnforcedTenantCustomRoleCapability`
- `userHasTenantCustomRoleCapability(...)`
- `userHasAnyTenantCustomRoleCapabilities(...)`

The helper must be limited to currently enforced tenant-level custom role keys:

- `media_library.access`
- `media_library.manage_folders`
- `templates.manage`
- `profiles.view`
- `profiles.manage`

Use this helper in template and profile authorizers. Media Library may delegate its internal custom-role predicate to this helper only if the change is mechanical and Feature 085 tests stay green. The required behavior is preservation, not a Media Library refactor.

Add a bounded SQL helper:

- `app.current_user_has_tenant_custom_role_capability(p_tenant_id uuid, p_capability_key text)`

Use it to update template/profile SQL helpers. Also make `app.current_user_has_media_library_custom_role_capability(...)` delegate to the shared SQL helper so SQL keeps one audited predicate for the same active tenant custom-role rules.

Do not import or call this helper from:

- member-management helpers
- project creation helpers
- project/workspace access helpers
- capture helpers
- review helpers
- correction/finalization helpers
- Feature 082 system reviewer helper functions

## 6. Exact capability semantics

Templates:

- `templates.manage` grants `/templates` and `/templates/[templateId]` page access.
- `templates.manage` grants tenant template create, draft edit, create version, publish, archive, and preview validation.
- `templates.manage` grants project default template update because that existing route is template configuration.
- There is no separate template view capability in Feature 086.
- Published tenant template selection for invite/project workflows remains available according to existing behavior and is not converted into a custom-role-only surface.

Profiles:

- `profiles.view` grants recurring profile directory and detail read access.
- `profiles.manage` grants recurring profile/profile-type creation and archive, baseline request/cancel/replace/follow-up management, and profile headshot upload/finalize/face selection.
- `profiles.manage` implies the read access needed to use management surfaces.
- Management routes require effective `profiles.manage` only; they do not require both `profiles.view` and `profiles.manage`.
- `profiles.view` alone never grants profile mutations.

Fixed roles:

- owner/admin keep existing template and profile management access.
- reviewer/photographer keep existing profile view access.
- reviewer/photographer do not gain template management unless separately assigned an active tenant custom role with `templates.manage`.

## 7. Exact SQL/RLS helper plan

Add one migration, tentatively:

- `supabase/migrations/<timestamp>_086_template_profile_custom_role_enforcement.sql`

### Shared helper

Add:

```sql
app.current_user_has_tenant_custom_role_capability(
  p_tenant_id uuid,
  p_capability_key text
) returns boolean
```

Required behavior:

- return false unless `p_capability_key` is in:
  - `media_library.access`
  - `media_library.manage_folders`
  - `templates.manage`
  - `profiles.view`
  - `profiles.manage`
- require `auth.uid()` to be a current member of `p_tenant_id`
- require active `role_assignments` for the current user and tenant
- require `scope_type = 'tenant'`
- require `project_id is null`
- require `workspace_id is null`
- require `revoked_at is null`
- require `role_definitions.is_system = false`
- require `role_definitions.tenant_id = p_tenant_id`
- require `role_definitions.archived_at is null`
- require matching `role_definition_capabilities.capability_key`

Grant execute to `authenticated`. Revoke public execute first, matching existing helper conventions.

### Media Library wrapper preservation

Replace or recreate:

- `app.current_user_has_media_library_custom_role_capability(p_tenant_id uuid, p_capability_key text)`

as a wrapper that:

- still returns false for non-Media-Library keys
- delegates accepted Media Library keys to `app.current_user_has_tenant_custom_role_capability(...)`

Do not change the public Media Library access/manage wrapper contracts or table policies. Existing Feature 085 behavior must remain identical.

### Template helper

Replace:

- `app.current_user_can_manage_templates(p_tenant_id uuid)`

Final behavior:

- true for current fixed owner/admin membership
- true for active tenant custom role with `templates.manage`
- false otherwise

Existing template RLS policies and template RPCs should inherit the new behavior through this helper. No template table policy rewrite is required unless implementation finds a stale helper reference.

### Profile helpers

Add:

- `app.current_user_can_view_recurring_profiles(p_tenant_id uuid)`

Behavior:

- true for current fixed roles that have `profiles.view`
- true for active tenant custom role with `profiles.view`
- true for active tenant custom role with `profiles.manage`
- false otherwise

Replace:

- `app.current_user_can_manage_recurring_profiles(p_tenant_id uuid)`

Behavior:

- true for current fixed owner/admin membership
- true for active tenant custom role with `profiles.manage`
- false otherwise

### Profile select policies

Migrate tenant-level recurring profile select policies from raw membership checks to `app.current_user_can_view_recurring_profiles(...)` when the policy is for tenant-level profile/baseline data.

Recommended policy updates:

- `recurring_profile_types` select
- `recurring_profiles` select
- baseline branch of `recurring_profile_consent_requests` select
- baseline branch of `recurring_profile_consents` select
- recurring profile headshot select policies and storage select policies, where they currently use raw tenant membership
- recurring profile headshot materialization select policies, where they currently use raw tenant membership

Preserve project/workspace branches for project recurring consent data. Do not replace `app.current_user_can_access_project_workspace(...)` checks for `consent_kind = 'project'`.

Profile insert/update policies and management RPCs should inherit custom `profiles.manage` through the updated manage helper.

Do not update:

- project/workspace helpers
- capture helpers
- review helpers
- correction/finalization helpers
- member-management helpers
- system reviewer assignment helpers

## 8. Exact TypeScript helper plan

### New tenant custom-role helper

Add `src/lib/tenant/tenant-custom-role-capabilities.ts`.

Required behavior:

- accept server-resolved `tenantId`
- accept authenticated `userId`
- validate current tenant membership before service-role reads
- create the service-role client only after membership validation
- query active tenant-scope assignments only
- require null `project_id` and `workspace_id`
- require `revoked_at is null`
- join/load tenant custom role definitions only
- require `is_system = false`
- require `tenant_id = input.tenantId`
- require `archived_at is null`
- enforce a hard TypeScript allowlist of currently enforced tenant-level keys
- return only booleans or a set of matched allowed keys

Recommended source pattern:

- reuse the Feature 085 custom-role predicate shape
- use `resolveTenantMembership(...)` for membership validation
- keep service-role reads local to the helper
- throw a 500-style `HttpError` on lookup failures with a neutral code such as `tenant_custom_role_capability_lookup_failed`

### Template updates

Update `resolveTemplateManagementAccess(...)` in `src/lib/templates/template-service.ts`:

- load membership as today
- allow fixed `roleHasCapability(role, "templates.manage")`
- otherwise call `userHasTenantCustomRoleCapability(..., "templates.manage")`
- return the same shape with `role` and `canManageTemplates`

Keep `assertTemplateManager(...)` as the central write guard. Updating the resolver should carry:

- `listManageableTemplatesForTenant(...)`
- `createTenantTemplate(...)`
- `updateDraftTemplate(...)`
- `createTenantTemplateVersion(...)`
- `publishTenantTemplate(...)`
- `archiveTenantTemplate(...)`
- `setProjectDefaultTemplate(...)`

Make preview validation explicit:

- update `POST /api/templates/[templateId]/preview-validate` or its service path to require effective `templates.manage`
- keep it non-persistent

Do not make published template selector reads require `templates.manage`.

### Profile updates

Update `resolveProfilesAccess(...)` in `src/lib/profiles/profile-access.ts`:

- fixed role `profiles.view` still grants view
- fixed role `profiles.manage` still grants manage
- custom `profiles.view` grants view
- custom `profiles.manage` grants manage and effective view

Suggested logic:

- resolve fixed role once
- compute fixed booleans
- if fixed booleans already provide both needed answers, avoid unnecessary custom-role reads
- otherwise ask for any of `profiles.view` and `profiles.manage`
- set `canManageProfiles` from fixed manage or custom manage
- set `canViewProfiles` from fixed view, fixed manage, custom view, or custom manage

Update `listRecurringProfilesPageData(...)`:

- after resolving access, throw `HttpError(403, "recurring_profile_view_forbidden", ...)` when neither effective view nor manage applies
- then continue current list behavior

Existing management paths can keep their current guard functions because those guards call `resolveProfilesAccess(...)`:

- `assertProfilesManager(...)` in `profile-directory-service.ts`
- profile consent management guards
- profile follow-up management guard
- `assertManageProfileHeadshots(...)` in `profile-headshot-service.ts`

### Permissions module

Avoid broad changes to `resolveTenantPermissions(...)`.

Do not turn it into an effective custom-role bag. `ProtectedLayout` should call surface-specific resolvers for Templates and Profiles, just as it already calls the Media Library resolver.

Only update `permissions.ts` if implementation discovers a narrow compile-time need, and if so only add the specific effective values required by nav without affecting project/workspace/capture/review/member behavior.

## 9. UI/nav plan

Update `src/components/navigation/protected-nav.tsx`:

- add optional `showTemplates`
- add optional `showProfiles`
- filter `/templates` when `showTemplates` is false
- filter `/profiles` when `showProfiles` is false
- keep `showMembers` and `showMediaLibrary` behavior unchanged

Update `src/app/(protected)/layout.tsx`:

- compute `showTemplates` with `resolveTemplateManagementAccess(...)`
- compute `showProfiles` with `resolveProfilesAccess(...)`
- show Templates when `canManageTemplates` is true
- show Profiles when `canViewProfiles` or `canManageProfiles` is true
- keep Members tied to `resolveTenantPermissions(...).canManageMembers`
- keep Media Library tied to `resolveMediaLibraryAccess(...).canAccess`
- keep Projects behavior unchanged

Page behavior:

- `/templates` remains accessible only to effective template managers.
- `/templates/[templateId]` remains accessible only to effective template managers.
- `/profiles` becomes explicitly accessible only to effective profile viewers or managers.
- profile detail API remains accessible only to effective profile viewers or managers.

Control behavior:

- template controls remain visible only for effective `templates.manage`.
- profile create/archive/type/baseline/headshot controls remain visible only for effective `profiles.manage`.
- profile viewers with only `profiles.view` can view directory and detail only.

i18n:

- No new copy is required if implementation only hides nav and controls and reuses existing forbidden handling.
- Add English and Dutch keys only if a new visible unauthorized/empty state is introduced.

## 10. `projects.create` deferral

`projects.create` is deferred.

Reasons:

- project creation opens a broader project/workspace workflow, including defaults, staffing, capture, review, and later correction/release behavior
- including it would expand Feature 086 beyond tenant templates/profiles
- Feature 084/085 non-enforcement expectations for `projects.create` should remain unchanged
- project-management custom-role enforcement should be a later RPI slice that can consider `projects.create` and `project_workspaces.manage` together

Feature 086 may touch the project default template route only because it already depends on template-management semantics.

## 11. Security and tenant isolation plan

Cross-tenant assignments:

- SQL and TypeScript helpers must require membership tenant, assignment tenant, and role tenant all equal the server-resolved tenant.
- Tests must create a second tenant and prove a role/assignment from another tenant does not grant access.

Revoked assignments:

- Require `role_assignments.revoked_at is null`.
- Tests must revoke after grant and prove denial in SQL and TypeScript.

Archived custom roles:

- Require `role_definitions.archived_at is null`.
- Tests must archive an assigned role and prove denial.

Project/workspace-scoped custom role assignments:

- Require `scope_type = 'tenant'`, `project_id is null`, and `workspace_id is null`.
- Tests must insert scoped rows with template/profile capabilities and prove denial.

`profiles.manage` without `profiles.view`:

- Treat manage as sufficient for effective read in SQL and TypeScript.
- This avoids a broken manager UI state.

High-impact actions:

- Template publishing remains guarded by TypeScript and SQL helper/RPC checks.
- Profile baseline/headshot management remains guarded by TypeScript and RLS/RPC checks.
- No client-provided tenant id is accepted.

SQL/TypeScript mismatch:

- Add parity tests for helper decisions.
- Keep one shared predicate for custom-role assignment matching in SQL.
- Keep one bounded TypeScript predicate for custom-role assignment matching.

Accidental non-scope expansion:

- Keep custom role checks out of member/project/workspace/capture/review/correction/finalization helpers.
- Add non-expansion tests for member management, project creation, project/workspace access, capture/upload, review/correction/finalization, workspace staffing, and Media Library.

Media Library regression:

- Preserve all Feature 085 semantics:
  - access-only can list/detail/download
  - manage-only can manage folders but does not get list/detail/download
  - revoked/archived/scoped/cross-tenant assignments are denied
  - project-scoped reviewer remains denied tenant-wide Media Library

## 12. Fresh reset and seed/dev data plan

Implementation validation should use:

```bash
supabase db reset
```

Development data rules:

- do not preserve arbitrary old local custom-role assignment data
- do not repair old local rows
- do not backfill local custom role assignments
- do not add sample custom role seed data by default
- tests create every role definition, capability mapping, assignment, revoked row, archived role, scoped row, and cross-tenant row they need

Migrations should be forward-only and clean from a fresh reset.

## 13. Test plan

### SQL/RLS tests

Add Feature 086 SQL/RLS coverage for:

- owner/admin pass `current_user_can_manage_templates`
- owner/admin pass `current_user_can_manage_recurring_profiles`
- fixed reviewer/photographer pass the profile view helper
- custom `templates.manage` passes template manage helper
- custom `profiles.view` passes profile view helper but not profile manage helper
- custom `profiles.manage` passes profile manage helper and effective profile view helper
- no-capability custom role denied
- revoked assignment denied
- archived role denied
- cross-tenant assignment denied
- project-scoped assignment denied
- workspace-scoped assignment denied
- template insert/update RLS works for custom `templates.manage`
- template version/publish RPCs work for custom `templates.manage`
- recurring profile/profile-type write RLS works for custom `profiles.manage`
- baseline request/cancel/replace RPCs work for custom `profiles.manage`
- headshot write RLS/RPC paths work for custom `profiles.manage`
- profile select RLS preserves all current fixed-role reads
- `profiles.view` can read recurring profile data but cannot write

### TypeScript/service tests

Add or extend tests for:

- `userHasTenantCustomRoleCapability(...)` allowlist behavior
- `resolveTemplateManagementAccess(...)` allows custom `templates.manage`
- template create/update/version/publish/archive allows custom `templates.manage`
- template preview validation requires custom/fixed `templates.manage`
- project default template update allows custom `templates.manage`
- template management denied without `templates.manage`
- `resolveProfilesAccess(...)` returns correct view/manage booleans for fixed roles and custom roles
- `profiles.view` allows directory and detail reads
- `profiles.view` cannot create/archive profiles
- `profiles.view` cannot create/archive profile types
- `profiles.view` cannot create/cancel/replace/follow-up baseline requests
- `profiles.view` cannot upload/finalize/select recurring profile headshots
- `profiles.manage` can perform profile management actions and can read needed profile data
- `listRecurringProfilesPageData(...)` rejects users with neither view nor manage

### Non-expansion/regression tests

Add tests proving template/profile custom roles do not grant:

- member management
- project creation
- project/workspace access
- capture/upload
- review/correction/finalization
- workspace staffing
- Media Library unless the role also has the relevant Media Library capability

Keep Feature 082 reviewer tests green.

Keep Feature 085 tests green, especially:

- tenant-wide reviewer Media Library allowed
- project-scoped reviewer Media Library denied
- Media Library access-only and manage-only semantics unchanged
- revoked/archived/scoped/cross-tenant Media Library denial unchanged

### UI/nav tests

Add or update nav/component tests for:

- Templates nav visible for effective `templates.manage`
- Templates nav hidden when denied
- Profiles nav visible for fixed profile viewers
- Profiles nav visible for custom `profiles.view`
- Profiles nav visible for custom `profiles.manage`
- Profile mutation controls hidden for view-only users
- Profile mutation controls visible for manage users

### Validation run

Implementation should run:

- `supabase db reset`
- new Feature 086 tests
- relevant Feature 039 tests
- relevant Feature 050 tests
- relevant Feature 051 tests
- relevant Feature 056 tests
- Feature 080 role capability catalog tests
- Feature 084 custom role assignment foundation tests
- Feature 085 Media Library custom-role enforcement tests
- `npm run lint`
- full `npm test` when feasible

## 14. Risks and edge cases

Risk: shared helper becomes too generic.

- Mitigation: hard allowlist only the five currently enforced tenant custom role keys and document the boundary in code.

Risk: profile select RLS migration blocks existing fixed reviewers/photographers.

- Mitigation: `current_user_can_view_recurring_profiles(...)` must preserve current fixed `profiles.view` role behavior; tests cover all four fixed roles.

Risk: `profiles.manage` without `profiles.view` becomes inconsistent.

- Mitigation: both SQL and TypeScript treat manage as sufficient for effective read.

Risk: template preview validation remains less strict than template editing.

- Mitigation: require effective `templates.manage` explicitly for preview validation.

Risk: project default template update accidentally becomes project-management custom-role enforcement.

- Mitigation: treat it as template configuration only; do not touch project creation or workspace management helpers.

Risk: service-role reads bypass tenant isolation.

- Mitigation: validate membership first with normal server client, then service-role query by exact tenant/user/capability.

Risk: archived or revoked rows remain effective.

- Mitigation: require `revoked_at is null` and `archived_at is null` in SQL and TypeScript.

Risk: scoped custom role rows accidentally grant tenant permissions.

- Mitigation: require tenant scope and null project/workspace ids.

Risk: Media Library behavior changes during helper reuse.

- Mitigation: keep Media Library exported behavior and tests unchanged; any delegation must be internal and tested.

## 15. Implementation phases

### Phase 1 - SQL helper migration

- Add `app.current_user_has_tenant_custom_role_capability(...)`.
- Convert `app.current_user_has_media_library_custom_role_capability(...)` to a wrapper.
- Update `app.current_user_can_manage_templates(...)`.
- Add `app.current_user_can_view_recurring_profiles(...)`.
- Update `app.current_user_can_manage_recurring_profiles(...)`.
- Update tenant-level profile select policies to use the view helper while preserving project/workspace branches.
- Keep all non-template/profile helpers unchanged.

Validation:

- migration applies from `supabase db reset`
- SQL helper tests cover fixed roles, custom grants, revoked, archived, cross-tenant, scoped, and no-capability cases
- Feature 085 SQL expectations remain unchanged

### Phase 2 - Tenant custom-role TypeScript helper

- Add `tenant-custom-role-capabilities.ts`.
- Implement allowlisted custom-role capability lookup.
- Validate membership before service-role reads.
- Add unit/service tests for allowlist and predicate behavior.

Validation:

- no imports from project/workspace/capture/review/member helpers
- revoked/archived/scoped/cross-tenant cases fail

### Phase 3 - Template authorization wiring

- Update `resolveTemplateManagementAccess(...)`.
- Keep `assertTemplateManager(...)` as the central guard.
- Align preview validation with `templates.manage`.
- Verify template pages/routes/services inherit access.
- Verify project default template update uses effective template management.

Validation:

- Feature 039 owner/admin and photographer behavior remains correct
- custom `templates.manage` can manage templates
- no-capability custom role remains denied

### Phase 4 - Profile authorization wiring

- Update `resolveProfilesAccess(...)`.
- Make `profiles.manage` imply effective view.
- Add explicit view denial in `listRecurringProfilesPageData(...)`.
- Confirm profile directory, detail, baseline, follow-up, and headshot services inherit behavior.

Validation:

- fixed reviewer/photographer remain read-only viewers
- custom `profiles.view` can read but not mutate
- custom `profiles.manage` can read and mutate

### Phase 5 - Navigation and UI gating

- Add `showTemplates` and `showProfiles` to `ProtectedNav`.
- Compute both in protected layout through surface-specific resolvers.
- Hide profile mutation controls for view-only users if any control currently assumes fixed role only.
- Avoid new copy unless necessary.

Validation:

- nav tests cover visible/hidden states
- profile UI tests cover view-only versus manage controls

### Phase 6 - Non-expansion and regression validation

- Add non-expansion tests for member/project/workspace/capture/review/correction/finalization/Media Library boundaries.
- Re-run Feature 082 and Feature 085 regression tests.
- Run `supabase db reset`, lint, and relevant tests.

Validation:

- Feature 086 custom roles affect templates/profiles only
- Media Library behavior is preserved

## 16. Clear scope boundaries

Do implement:

- active tenant custom-role enforcement for `templates.manage`
- active tenant custom-role enforcement for `profiles.view`
- active tenant custom-role enforcement for `profiles.manage`
- SQL/RLS helper parity
- TypeScript helper parity
- Templates and Profiles nav visibility gating
- profile read-only versus manage UI gating
- tests for active, revoked, archived, cross-tenant, scoped, and no-capability cases
- non-expansion tests

Do not implement:

- `projects.create` enforcement
- `project_workspaces.manage` enforcement
- `organization_users.*` enforcement
- project/workspace-scoped custom role enforcement
- capture/review/correction/finalization custom role enforcement
- member-management custom role enforcement
- generic effective capability engine
- custom role editor redesign
- custom role assignment redesign
- Media Library semantic changes
- production/local backfill for old custom role data

## 17. Concise implementation prompt

Implement Feature 086 as a bounded tenant template/profile custom-role enforcement slice. Add a small allowlisted tenant custom-role capability helper in SQL and TypeScript for currently enforced tenant-level custom capabilities only: Media Library keys, `templates.manage`, `profiles.view`, and `profiles.manage`. Use it to update template and recurring-profile authorization while keeping surface-specific authorizers.

Update SQL helpers so `current_user_can_manage_templates` allows owner/admin or active tenant custom `templates.manage`, add `current_user_can_view_recurring_profiles`, and update `current_user_can_manage_recurring_profiles` to allow owner/admin or active tenant custom `profiles.manage`. Preserve Media Library behavior by keeping the Media Library helper contract intact. Migrate tenant-level profile select policies to the profile view helper without changing project/workspace recurring consent access branches.

Update TypeScript so `resolveTemplateManagementAccess` honors custom `templates.manage`, `resolveProfilesAccess` honors custom `profiles.view` and `profiles.manage`, and `profiles.manage` implies effective view. Explicitly deny `/profiles` page data when neither view nor manage applies, and align template preview validation with template management access. Update protected nav to show Templates for effective template managers and Profiles for effective profile viewers/managers.

Do not enforce custom roles for member management, project creation, project/workspace access, capture, review, correction, finalization, or workspace staffing. Do not build a generic capability engine. Validate with `supabase db reset`, focused Feature 086 SQL/RLS, service, route, UI/nav, and non-expansion tests, plus Feature 039, 050, 051, 056, 080, 084, and 085 regressions.
