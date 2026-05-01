# Feature 086 - Custom role enforcement for tenant templates and profiles research

## 1. Title and scope

Feature 086 is the next bounded custom-role enforcement slice after Media Library. The researched target is tenant-level template and recurring-profile authorization for:

- `templates.manage`
- `profiles.view`
- `profiles.manage`

The feature should let tenant-scoped custom role assignments grant template/profile authority without changing the user's fixed `memberships.role` to `owner` or `admin`.

Recommended scope remains bounded:

- include template management enforcement
- include recurring profile view/management enforcement
- update TypeScript and SQL/RLS parity for those surfaces
- preserve Feature 082 reviewer enforcement
- preserve Feature 085 Media Library enforcement
- defer `projects.create`
- defer organization-user/member-management custom-role enforcement
- defer project/workspace/capture/review/correction/finalization custom-role enforcement

Current live code and migrations are authoritative. Prior RPI docs are context only.

## 2. Inputs reviewed

Required baseline docs:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `UNCODEXIFY.md`
- `docs/rpi/README.md`
- `docs/rpi/SUMMARY.md`

Access-management context:

- `docs/rpi/081-custom-role-definitions-and-scoped-role-assignment-foundation/plan.md`
- `docs/rpi/082-project-scoped-reviewer-assignments-and-enforcement/plan.md`
- `docs/rpi/083-custom-role-editor-foundation/plan.md`
- `docs/rpi/084-custom-role-assignment-foundation/plan.md`
- `docs/rpi/085-custom-role-media-library-enforcement/plan.md`

Template/profile context:

- `docs/rpi/039-consent-form-template-editor/plan.md`
- `docs/rpi/046-template-editor-live-preview-and-layout-builder/plan.md`
- `docs/rpi/049-recurring-profiles-and-consent-management-foundations/plan.md`
- `docs/rpi/050-recurring-profile-directory-foundation/plan.md`
- `docs/rpi/051-baseline-recurring-consent-request-foundation/plan.md`
- `docs/rpi/056-recurring-profile-headshots-and-matching-materialization-foundation/plan.md`

Live code and schema inspected:

- `src/lib/tenant/role-capabilities.ts`
- `src/lib/tenant/permissions.ts`
- `src/lib/tenant/custom-role-assignment-service.ts`
- `src/lib/tenant/reviewer-access-service.ts`
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
- `src/app/(protected)/templates/**`
- `src/app/api/templates/**`
- `src/app/(protected)/profiles/page.tsx`
- `src/app/api/profiles/**`
- `src/app/api/profile-types/**`
- relevant migrations from Features 039, 050, 051, 052, 056, 059, 067, 081, 082, 085
- relevant tests for Features 039, 050, 051, 056, 080, 084, 085

Note: `rg` is not installed in this workspace, so code search used PowerShell recursive `Select-String`.

## 3. Verified current template authorization

Capability catalog:

- `templates.manage` exists in `TENANT_CAPABILITIES`.
- Fixed `owner` and `admin` roles have `templates.manage`.
- Fixed `reviewer` and `photographer` roles do not have `templates.manage`.

TypeScript authorization:

- `resolveTemplateManagementAccess(...)` in `src/lib/templates/template-service.ts` loads `memberships.role` through `getTenantMembershipRole(...)` and returns `canManageTemplates = roleHasCapability(role, "templates.manage")`.
- `assertTemplateManager(...)` is the central mutation guard and currently means fixed owner/admin only.
- `deriveTenantPermissionsFromRole(...)` and `resolveTenantPermissions(...)` expose `canManageTemplates` from fixed role capability metadata only.

Protected page visibility:

- `/templates` and `/templates/[templateId]` both call `resolveTemplateManagementAccess(...)`.
- If `canManageTemplates` is false, the pages redirect to `/projects`.
- The protected nav currently always includes the `Templates` item. There is no `showTemplates` prop equivalent to `showMembers` or `showMediaLibrary`.

Template reads:

- `GET /api/templates` lists visible published tenant templates through `listVisibleTemplatesForTenant(...)`.
- `GET /api/templates/[templateId]` calls `getTemplateForManagement(...)`.
- Published tenant template rows are readable to tenant members through RLS. Draft/archived tenant management rows require `app.current_user_can_manage_templates(tenant_id)`.
- Current live `listVisibleTemplatesForTenant(...)` only returns tenant-owned published templates, despite older docs that mention app-wide templates. A later migration removed seeded app templates.

Template mutations:

- `POST /api/templates` calls `createTenantTemplate(...)`.
- `PATCH /api/templates/[templateId]` calls `updateDraftTemplate(...)`.
- `POST /api/templates/[templateId]/versions` calls `createTenantTemplateVersion(...)`.
- `POST /api/templates/[templateId]/publish` calls `publishTenantTemplate(...)`.
- `POST /api/templates/[templateId]/archive` calls `archiveTenantTemplate(...)`.
- All these service paths call `assertTemplateManager(...)` or equivalent management access before writing.

Preview and project default:

- `POST /api/templates/[templateId]/preview-validate` loads the template with `getTemplateForManagement(...)` but does not explicitly call `assertTemplateManager(...)`. It is non-persistent, but it is editor-adjacent and should be aligned with `templates.manage` in the plan unless a deliberate read-only preview policy is chosen.
- `PATCH /api/projects/[projectId]/default-template` calls `setProjectDefaultTemplate(...)`, which requires `resolveTemplateManagementAccess(...).canManageTemplates`.
- This project default route is a template-management/configuration surface, not a reason to include the broader `projects.create` capability in Feature 086.

SQL/RLS authorization:

- `app.current_user_can_manage_templates(p_tenant_id)` currently returns true only for `memberships.role in ('owner', 'admin')`.
- Template insert/update policies call `app.current_user_can_manage_templates(tenant_id)`.
- Template management RPCs for create-version/publish paths call `app.current_user_can_manage_templates(...)`.

Existing tests:

- `tests/feature-039-consent-form-template-editor.test.ts` covers owner lifecycle behavior, project default update, and photographer denial.
- No current test proves a custom role with `templates.manage` grants template access, because that behavior does not exist yet.

Current fixed-role assumptions to update:

- `resolveTemplateManagementAccess(...)`
- `assertTemplateManager(...)` consumers
- `resolveTenantPermissions(...).canManageTemplates` if nav/page gating uses that field
- `app.current_user_can_manage_templates(...)`
- template RLS policies and template RPCs indirectly through that SQL helper
- `/templates` nav visibility if Feature 086 introduces capability-based visibility

## 4. Verified current profile authorization

Capability catalog:

- `profiles.view` and `profiles.manage` exist in `TENANT_CAPABILITIES`.
- Fixed `owner` and `admin` have both `profiles.view` and `profiles.manage`.
- Fixed `reviewer` and `photographer` have `profiles.view` but not `profiles.manage`.
- This means recurring profile read access is already broad for all current fixed membership roles. Feature 086's `profiles.view` custom-role enforcement is still useful for parity and future role shapes, but it does not expand access for the current four fixed roles.

TypeScript authorization:

- `resolveProfilesAccess(...)` in `src/lib/profiles/profile-access.ts` reads `memberships.role`.
- It returns `canViewProfiles = roleHasCapability(role, "profiles.view")`.
- It returns `canManageProfiles = roleHasCapability(role, "profiles.manage")`.
- There is no custom-role lookup in this helper.

Protected page/nav visibility:

- `/profiles` calls `listRecurringProfilesPageData(...)` and redirects to `/projects` on thrown errors.
- The protected nav currently always includes `Profiles`; there is no `showProfiles` prop.
- `listRecurringProfilesPageData(...)` calls `resolveProfilesAccess(...)`, but does not explicitly reject `!canViewProfiles` before querying. Under current fixed roles this is harmless because all four fixed roles have `profiles.view`.
- `getRecurringProfileDetailPanelData(...)` explicitly rejects `!canViewProfiles`.

Directory/list/read:

- `listRecurringProfilesPageData(...)` reads profile types, profiles, baseline requests, baseline consents, and matching readiness for the active tenant.
- `GET /api/profiles/[profileId]/detail` routes through `getRecurringProfileDetailPanelData(...)` and requires `canViewProfiles`.
- SQL select policies for `recurring_profile_types`, `recurring_profiles`, recurring request/consent rows, and headshot/materialization rows generally allow any current tenant member, not a dedicated SQL `profiles.view` helper.

Profile management:

- `createRecurringProfile(...)`, `archiveRecurringProfile(...)`, `createRecurringProfileType(...)`, and `archiveRecurringProfileType(...)` call `assertProfilesManager(...)`.
- `assertProfilesManager(...)` requires `resolveProfilesAccess(...).canManageProfiles`.
- Routes:
  - `POST /api/profiles`
  - `POST /api/profiles/[profileId]/archive`
  - `POST /api/profile-types`
  - `POST /api/profile-types/[profileTypeId]/archive`

Baseline recurring consent management:

- `createBaselineConsentRequest(...)`, `cancelBaselineConsentRequest(...)`, `replaceBaselineConsentRequest(...)`, and follow-up service paths use `resolveProfilesAccess(...).canManageProfiles`.
- SQL RPCs such as baseline request creation/cancel/replace also call `app.current_user_can_manage_recurring_profiles(...)`.
- Routes:
  - `POST /api/profiles/[profileId]/baseline-consent-request`
  - `POST /api/profiles/[profileId]/baseline-consent-request/[requestId]/cancel`
  - `POST /api/profiles/[profileId]/baseline-consent-request/[requestId]/replace`
  - `POST /api/profiles/[profileId]/baseline-follow-up`

Profile headshot management:

- `createRecurringProfileHeadshotUpload(...)`, `finalizeRecurringProfileHeadshotUpload(...)`, and `selectRecurringProfileHeadshotFace(...)` call `assertManageProfileHeadshots(...)`.
- `assertManageProfileHeadshots(...)` requires `resolveProfilesAccess(...).canManageProfiles`.
- Headshot SQL policies and activation/materialization RPCs use `app.current_user_can_manage_recurring_profiles(...)`.
- Routes:
  - `POST /api/profiles/[profileId]/headshot`
  - `POST /api/profiles/[profileId]/headshot/[headshotId]/finalize`
  - `POST /api/profiles/[profileId]/headshot/[headshotId]/select-face`

SQL/RLS authorization:

- `app.current_user_can_manage_recurring_profiles(p_tenant_id)` currently returns true only for fixed owner/admin.
- Insert/update policies for `recurring_profile_types` and `recurring_profiles` call that helper.
- Headshot insert/update policies and materialization write policies call that helper.
- Recurring consent management RPCs call that helper.
- Select policies are tenant-membership based, not profile-capability based.

Existing tests:

- Feature 050 tests cover owner/admin profile directory operations, photographer read-only listing, and photographer mutation denial.
- Feature 051 tests cover owner baseline request creation and photographer denial.
- Feature 056 route tests cover auth/error plumbing for headshots, and service/materialization tests cover headshot behavior.
- No current test proves custom `profiles.view` or `profiles.manage` enforcement.

Current fixed-role assumptions to update:

- `resolveProfilesAccess(...)`
- every `assertProfilesManager(...)` and `assertManageProfileHeadshots(...)` path through that helper
- `listRecurringProfilesPageData(...)` should explicitly require effective view access once nav/page visibility becomes capability based
- `app.current_user_can_manage_recurring_profiles(...)`
- a new or updated SQL read helper should codify `profiles.view` / `profiles.manage` read behavior if RLS is migrated from raw tenant membership checks

## 5. Verified current custom-role enforcement pattern

Feature 081 foundation:

- `capabilities`, `role_definitions`, `role_definition_capabilities`, and `role_assignments` are live.
- Tenant custom roles have `is_system = false`, `tenant_id = active tenant`, and nullable `archived_at`.
- `role_assignments` supports tenant/project/workspace scopes.
- Active tenant assignments require `scope_type = 'tenant'`, `project_id is null`, `workspace_id is null`.
- Revocation is represented by `revoked_at` and `revoked_by`.
- A trigger prevents assigning another tenant's custom role and prevents new active assignments to archived tenant roles.

Feature 084 assignment behavior:

- The custom-role assignment UI/API creates tenant-scoped custom-role assignments only.
- It rejects system roles for the custom-role assignment workflow.
- It rejects archived custom roles on grant.
- It allows revoking archived assigned roles.
- It keeps custom role assignments non-enforcing outside the Media Library slice.

Feature 085 Media Library enforcement:

- TypeScript uses `src/lib/tenant/media-library-custom-role-access.ts`.
- It validates current tenant membership first through `resolveTenantMembership(...)`.
- Owner/admin fixed roles remain allowed.
- Tenant-wide system reviewer assignment remains allowed via Feature 082 resolver.
- Custom roles are checked only for `media_library.access` and `media_library.manage_folders`.
- The custom-role query uses service-role reads after membership validation because assignees cannot broadly read tenant custom role definitions/capability mappings through authenticated RLS.
- It ignores revoked assignments, archived roles, system roles, and project/workspace-scoped custom role assignments.
- SQL parity is implemented with `app.current_user_has_media_library_custom_role_capability(...)` and updated `app.current_user_can_access_media_library(...)` / `app.current_user_can_manage_media_library(...)`.

The pattern is strong and should be reused, but the Media Library module is intentionally surface-specific. Feature 086 is now the third tenant-level enforcement area, so a very small shared tenant custom-role capability helper is justified.

## 6. Options considered for enforcement architecture

Option A: extend the Media Library-specific resolver.

- Pros: least code.
- Cons: wrong name and ownership once templates/profiles use it; easy to accidentally tie unrelated semantics to Media Library.
- Recommendation: do not extend this module directly.

Option B: add separate template/profile-specific custom-role resolvers.

- Pros: very explicit call sites; low risk of accidental broad enforcement.
- Cons: duplicates the same tenant-scoped assignment predicates from Feature 085; increases SQL/TS drift risk.
- Recommendation: acceptable, but less maintainable now that three tenant-level surfaces need the same custom-role predicate.

Option C: add a small shared tenant custom-role capability helper with an allowlist, used only by Media Library, templates, and profiles.

- Pros: reuses one audited predicate for active tenant custom-role capabilities; avoids a generic app-wide engine; lets each surface keep its own authorizer semantics.
- Cons: requires careful naming and tests so it is not mistaken for broad IAM.
- Recommendation: choose this option.

Recommended helper shape:

- TypeScript module such as `src/lib/tenant/tenant-custom-role-capabilities.ts`
- SQL helper such as `app.current_user_has_tenant_custom_role_capability(p_tenant_id uuid, p_capability_key text)`
- Hard allowlist only for currently enforcing tenant-level keys:
  - `media_library.access`
  - `media_library.manage_folders`
  - `templates.manage`
  - `profiles.view`
  - `profiles.manage`
- Keep surface-specific authorizers:
  - Media Library keeps `resolveMediaLibraryAccess(...)` return shape and semantics
  - templates get `resolveTemplateManagementAccess(...)`
  - profiles get `resolveProfilesAccess(...)`
- Do not import this helper into project/workspace/capture/review/correction/finalization/member-management helpers.

## 7. Recommended capability semantics

Templates:

- `templates.manage` grants access to `/templates`, `/templates/[templateId]`, create draft, edit draft, create new version, publish, archive, preview validation, and project default template update.
- There is no separate template view capability today.
- Published template selection for invites/projects can remain available to current tenant members according to existing product behavior.
- Template management UI/nav should be visible to users with fixed owner/admin access or effective custom-role `templates.manage`.

Profiles:

- `profiles.view` grants read-only recurring profile directory/detail access.
- `profiles.manage` grants recurring profile/profile-type mutations, baseline request/follow-up management, and profile headshot management.
- `profiles.manage` should imply the read access needed to use management surfaces.
- Management routes should require `profiles.manage` only, not both `profiles.view` and `profiles.manage`, because manage-without-view is not a useful UI state.
- Profile nav should be visible when the user has effective `profiles.view` or `profiles.manage`.
- Mutation controls should be hidden unless effective `profiles.manage` is true.

Important current-state nuance:

- All current fixed membership roles already have `profiles.view`, so profile nav/read visibility will not materially change for owner/admin/reviewer/photographer. The implementation should still model `profiles.view` explicitly for SQL/TypeScript parity and future custom-role evolution.

## 8. Recommendation on including or deferring `projects.create`

Defer `projects.create`.

Reasons:

- Project creation is tenant-level, but it is not isolated to templates/profiles. It opens a project/workspace workflow that immediately touches project defaults, default workspace creation, staffing, capture, review, and later operational access.
- The route/helper is currently centralized through `assertCanCreateProjectsAction(...)`, but including it would broaden Feature 086 into project-management enforcement.
- Feature 084 tests currently prove custom roles with `projects.create` do not grant project creation. Changing that expectation belongs in a separate RPI cycle.
- A separate Feature 087-style project-management slice can cover `projects.create` and `project_workspaces.manage` together with project/workspace implications.

Feature 086 should only touch project code where it is template-specific, namely `setProjectDefaultTemplate(...)` and `/api/projects/[projectId]/default-template`.

## 9. SQL/RLS migration recommendation

Add one migration for Feature 086.

Recommended shared SQL helper:

```sql
app.current_user_has_tenant_custom_role_capability(
  p_tenant_id uuid,
  p_capability_key text
) returns boolean
```

Required behavior:

- return false unless `p_capability_key` is in the bounded allowlist for Media Library, templates, and profiles
- require `auth.uid()` is a current member of `p_tenant_id`
- require active `role_assignments` row for the current user and tenant
- require `scope_type = 'tenant'`
- require `project_id is null` and `workspace_id is null`
- require `revoked_at is null`
- require `role_definitions.is_system = false`
- require `role_definitions.tenant_id = p_tenant_id`
- require `role_definitions.archived_at is null`
- require `role_definition_capabilities.capability_key = p_capability_key`

Then update or preserve wrappers:

- Replace `app.current_user_has_media_library_custom_role_capability(...)` with a wrapper around the shared helper, or leave it in place and add equivalent logic for templates/profiles. Prefer wrapper to avoid duplicate predicates.
- Keep public Media Library wrappers returning identical behavior.

Update template helper:

- `app.current_user_can_manage_templates(p_tenant_id)` should allow:
  - fixed owner/admin membership
  - active tenant custom role with `templates.manage`
- Existing template insert/update policies and template RPCs will inherit this behavior.

Add or update profile helpers:

- `app.current_user_can_view_recurring_profiles(p_tenant_id)` should allow:
  - any fixed role that currently has `profiles.view` (currently all four fixed roles)
  - active tenant custom role with `profiles.view`
  - active tenant custom role with `profiles.manage`
- `app.current_user_can_manage_recurring_profiles(p_tenant_id)` should allow:
  - fixed owner/admin membership
  - active tenant custom role with `profiles.manage`
- Profile management policies/RPCs already call the manage helper and will inherit mutation authorization.
- Consider migrating recurring profile select policies from raw tenant membership checks to `app.current_user_can_view_recurring_profiles(...)`. This should preserve current fixed-role behavior while making SQL read semantics explicit.

Do not update:

- project/workspace access helpers
- capture helpers
- review helpers
- correction/finalization helpers
- member-management helpers
- system reviewer assignment helpers

## 10. TypeScript helper recommendation

Add a narrow shared TypeScript helper, not a broad capability engine.

Recommended module:

- `src/lib/tenant/tenant-custom-role-capabilities.ts`

Recommended exports:

- `userHasTenantCustomRoleCapability(...)`
- `userHasAnyTenantCustomRoleCapabilities(...)`
- type for the bounded enforceable tenant capability keys

Rules:

- require server-resolved `tenantId`
- require authenticated `userId`
- validate current tenant membership before service-role reads
- use service-role reads only after membership validation
- ignore revoked assignments, archived roles, system roles, and project/workspace scopes
- enforce an allowlist of Feature 085 and 086 capability keys

Template updates:

- Update `resolveTemplateManagementAccess(...)` to return true for fixed `templates.manage` or custom-role `templates.manage`.
- Update `resolveTenantPermissions(...)` only if needed for nav/page gating. If updated, do not add unrelated custom-role booleans.
- Keep template write services behind `assertTemplateManager(...)`.

Profile updates:

- Update `resolveProfilesAccess(...)` so:
  - fixed `profiles.view` still grants view
  - fixed `profiles.manage` still grants manage
  - custom `profiles.view` grants view
  - custom `profiles.manage` grants manage and effective view
- Update `listRecurringProfilesPageData(...)` to explicitly reject when neither effective view nor manage is present.
- Existing profile create/archive/type/baseline/headshot services can keep using `canManageProfiles`.

Media Library preservation:

- Either leave `media-library-custom-role-access.ts` intact or make it delegate to the shared helper without changing its exported return shape.
- Feature 085 tests must continue proving access-only/manage-only semantics, revoked/archived/scoped denial, and non-expansion.

Avoid:

- changing project/workspace/review/capture helpers
- making `resolveTenantPermissions(...)` a full custom-role capability bag
- using custom roles for member management or project creation

## 11. UI/nav recommendation

Protected navigation:

- Add `showTemplates` and `showProfiles` style props to `ProtectedNav`, or equivalent filtering.
- Compute them server-side in `src/app/(protected)/layout.tsx`.
- Show `Templates` when effective `templates.manage` is true.
- Show `Profiles` when effective `profiles.view` or `profiles.manage` is true.
- Keep `Members` tied to fixed/effective member-management behavior, which is out of scope.
- Keep `Media Library` tied to the Feature 085 resolver.

Pages:

- `/templates` and `/templates/[templateId]` already redirect when `canManageTemplates` is false; updating the helper should be enough.
- `/profiles` should explicitly require effective view/manage before querying.
- The profile detail route already checks `canViewProfiles`; update helper semantics should be enough.

Controls:

- Template controls remain visible only to effective `templates.manage`.
- Profile create/archive/type/baseline/headshot controls remain visible only to effective `profiles.manage`.
- Read-only profile users should still be able to view the directory/detail but not mutate.

i18n:

- No new copy is required if controls are only shown/hidden.
- Add English and Dutch messages only if implementation introduces a new unauthorized/empty state or helper text.

## 12. Security and tenant-isolation risks

Risk: cross-tenant custom role assignment grants access.

- Mitigation: helper joins membership, assignment tenant, and role tenant to the same server-resolved `tenantId`; tests create a second tenant and prove denial in the original tenant.

Risk: revoked assignments still grant access.

- Mitigation: require `role_assignments.revoked_at is null` in SQL and TypeScript.

Risk: archived custom roles still grant access.

- Mitigation: require `role_definitions.archived_at is null`; tests should archive a role after assignment.

Risk: project/workspace-scoped custom assignments grant tenant-level access.

- Mitigation: require tenant scope and null project/workspace ids; tests should insert project/workspace scoped rows with template/profile capabilities.

Risk: SQL and TypeScript diverge.

- Mitigation: parity tests for SQL helpers and TypeScript helpers for owner/admin, fixed viewer, custom grant, no capability, revoked, archived, scoped, cross-tenant.

Risk: `profiles.manage` without `profiles.view` creates a broken UI.

- Mitigation: define manage as sufficient for read/page access.

Risk: template publishing and profile management are high-impact actions.

- Mitigation: keep all writes server-side, tenant-derived, and protected by both TypeScript helpers and RLS/RPC helpers.

Risk: custom role enforcement accidentally grants member management, project creation, review, capture, correction, finalization, workspace staffing, or Media Library.

- Mitigation: allowlist only Feature 086 keys in template/profile authorizers; keep non-expansion tests, including preserving Feature 085 Media Library behavior.

Risk: broad helper becomes a generic app-wide capability engine by accident.

- Mitigation: name and document it as bounded tenant custom-role enforcement for selected tenant-level surfaces only; do not expose a generic permissions object.

## 13. Fresh reset and seed/dev data considerations

Assume local development can use:

```bash
supabase db reset
```

Research recommendation:

- Do not preserve, repair, backfill, or normalize arbitrary old local custom-role assignment data.
- Do not add seed custom roles for Feature 086.
- Tests should create all custom role definitions, capability mappings, role assignments, revoked rows, archived roles, cross-tenant rows, and scoped-assignment rows explicitly.
- Migrations should be clean and forward-only.
- Running `supabase db reset` belongs in the implementation validation pass, not this research-only phase.

## 14. Testing recommendations

SQL/RLS tests:

- owner/admin can manage templates and profiles.
- fixed reviewer/photographer retain current profile view access.
- custom role with `templates.manage` can pass `current_user_can_manage_templates`.
- custom role with `profiles.view` can pass a new profile view helper but not manage.
- custom role with `profiles.manage` can pass manage and effective view.
- custom role without template/profile capabilities is denied.
- revoked assignment denied.
- archived role denied.
- cross-tenant assignment denied.
- project/workspace-scoped assignment denied.
- template insert/update RLS works for `templates.manage`.
- recurring profile/profile-type/headshot write RLS works for `profiles.manage`.
- profile select RLS, if migrated, still allows all fixed roles with `profiles.view`.

TypeScript/service tests:

- `resolveTemplateManagementAccess(...)` allows custom `templates.manage`.
- template create/update/version/publish/archive allow custom `templates.manage`.
- project default template update allows custom `templates.manage`.
- template management is denied for a custom role without `templates.manage`.
- `resolveProfilesAccess(...)` returns view/manage correctly for fixed roles and custom roles.
- profile directory/detail allow `profiles.view`.
- `profiles.view` cannot create/archive profiles, create/archive profile types, create/cancel/replace/follow-up baseline requests, upload/finalize/select headshots.
- `profiles.manage` can perform those profile management actions and has needed read access.

Non-expansion/regression tests:

- Feature 082 reviewer enforcement remains unchanged.
- Feature 085 Media Library behavior remains unchanged:
  - `media_library.access` still controls list/detail/download.
  - `media_library.manage_folders` still controls folder mutations.
  - template/profile custom roles do not grant Media Library unless the role also has Media Library capability.
- Template/profile custom roles do not grant:
  - member management
  - project creation
  - project/workspace access
  - capture/upload
  - review/correction/finalization
  - workspace staffing

UI/nav tests:

- Templates nav visible for effective `templates.manage`.
- Templates nav hidden when denied.
- Profiles nav visible for fixed profile viewers and effective custom `profiles.view`/`profiles.manage`.
- Profile mutation controls hidden for view-only users.
- Profile mutation controls visible for manage users.

Validation:

- Implementation should run `supabase db reset`.
- Run new Feature 086 tests plus relevant Feature 039, 050, 051, 056, 080, 084, and 085 regression tests.
- Run lint/full tests when feasible.

## 15. Open questions for the plan phase

1. Should Feature 086 refactor `media-library-custom-role-access.ts` to delegate to a shared tenant custom-role helper, or leave Media Library untouched and duplicate the predicate for templates/profiles?

   Recommendation: delegate only if tests prove identical Feature 085 behavior; otherwise add the shared helper for new surfaces and defer Media Library refactor.

2. Should profile select RLS policies be migrated from raw tenant membership checks to a new `current_user_can_view_recurring_profiles(...)` helper in Feature 086?

   Recommendation: yes, if the helper preserves all current fixed-role read access. This makes SQL semantics match `profiles.view` without changing current behavior.

3. Should `resolveTenantPermissions(...)` expose effective custom-role `canManageTemplates` and `canManageProfiles`, or should nav/page code call surface-specific resolvers?

   Recommendation: prefer surface-specific resolvers for templates/profiles. Only update `resolveTenantPermissions(...)` if layout/nav implementation needs a compact single call, and keep the added booleans narrow.

4. Should template preview validation require `templates.manage` explicitly?

   Recommendation: yes. It is editor-adjacent and should follow template management access even though it is non-persistent.

5. Should `profiles.manage` automatically imply `profiles.view` in both SQL and TypeScript?

   Recommendation: yes. Management without read access is not a coherent UI or service state.

6. Should `projects.create` be included?

   Recommendation: no. Defer to a separate project-management custom-role enforcement RPI cycle.
