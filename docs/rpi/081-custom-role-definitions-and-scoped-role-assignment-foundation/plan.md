# Feature 081 Plan - Custom role definitions and scoped role assignment foundation

## Scope and contract

Feature 081 adds the first durable database-backed foundation for role definitions, role-capability mappings, and scoped role assignments.

This is a foundation-only slice. It must not change live authorization behavior. `memberships.role` remains the active enforcement source for current app behavior, and the new durable assignment rows must not grant or deny access in this feature.

In scope:

- one additive migration for durable role/capability/assignment tables
- seeded capability rows matching `TENANT_CAPABILITIES`
- seeded system role definitions for `owner`, `admin`, `reviewer`, and `photographer`
- seeded system role-capability mappings matching `ROLE_CAPABILITIES`
- a non-enforcing role assignment table that can represent tenant, project, and workspace scope
- read-only helper surfaces for future features and tests
- drift tests proving database seeds match the TypeScript catalog
- regression tests proving current access behavior is unchanged

Out of scope:

- custom role editor UI
- role assignment UI
- invite-to-custom-role flow
- member-level allow/deny overrides
- changing `memberships.role`
- changing existing SQL/RLS permission helpers
- changing route authorization behavior
- making reviewers project-scoped
- changing photographer workspace access
- changing Media Library, project, correction, or finalization behavior
- backfilling all current memberships into durable role assignments

## Inputs and ground truth

Required inputs were read in order:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `UNCODEXIFY.md`
5. `docs/rpi/README.md`
6. `docs/rpi/SUMMARY.md`
7. `docs/rpi/080-advanced-organization-access-management-foundation/research.md`
8. `docs/rpi/080-advanced-organization-access-management-foundation/plan.md`
9. `docs/rpi/081-custom-role-definitions-and-scoped-role-assignment-foundation/research.md`

The Feature 081 research document is the primary synthesized source for this plan. Current live code and migrations remain authoritative where a planning detail needed verification.

Targeted live verification covered:

- `src/lib/tenant/role-capabilities.ts`
- `src/lib/tenant/permissions.ts`
- `src/lib/tenant/member-management-service.ts`
- `src/lib/tenant/membership-invites.ts`
- `src/lib/tenant/resolve-tenant.ts`
- `src/lib/tenant/active-tenant.ts`
- `supabase/migrations/20260304210000_002_projects_invites_schema.sql`
- `supabase/migrations/20260423090000_070_tenant_rbac_membership_invites_foundation.sql`
- `supabase/migrations/20260423120000_072_project_workspaces_foundation.sql`
- current Feature 070, 078, 079, and 080 tests

No broad research was redone.

## Verified current boundary

Current fixed roles are:

- `owner`
- `admin`
- `reviewer`
- `photographer`

Current inviteable/editable roles are:

- `admin`
- `reviewer`
- `photographer`

`owner` is not inviteable, editable, or removable. That safety is enforced by TypeScript constants, member-management service checks, invite SQL constraints/RPCs, and membership RLS policies.

The current live enforcement source of truth is:

- `public.memberships.role` for fixed tenant role identity
- `public.project_workspaces.photographer_user_id` for photographer workspace assignment
- project/workspace workflow state for additional capture, review, correction, and finalization gating
- SQL/RLS helpers that read `memberships.role`
- TypeScript helpers that read `memberships.role` and derive booleans from Feature 080 capability keys

The TypeScript capability catalog lives in `src/lib/tenant/role-capabilities.ts`. Its exact current keys are:

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

Current SQL/RLS behavior is fixed-role based:

- member management: owner/admin
- template/profile management: owner/admin
- project creation: owner/admin
- project access: owner/admin/reviewer tenant-wide; photographers only when assigned to a workspace in the project
- workspace access: owner/admin/reviewer all workspaces; photographers only assigned workspaces
- capture: owner/admin all workspaces; photographers assigned workspaces
- review/finalization/correction: owner/admin/reviewer
- Media Library access and folder management: owner/admin/reviewer

Feature 081 does not change any of those behaviors.

## Recommendation

Implement the research recommendation as a small additive foundation:

- add durable `capabilities`, `role_definitions`, `role_definition_capabilities`, and `role_assignments` tables
- seed current capability keys and current system fixed roles
- keep `memberships.role` authoritative for live enforcement
- do not mirror every current membership into role assignment rows
- do not import the new assignment resolver into live permission checks
- do not change existing SQL/RLS helpers or current domain table policies

This avoids a dangerous half-migrated access model. There is one live enforcement source for Feature 081: the existing fixed-role model. The new tables are durable metadata and future assignment storage only.

## Chosen architecture

Use a global-plus-tenant role definition model:

- system role definitions are global rows with `tenant_id is null`
- tenant custom role rows are structurally allowed but not exposed through UI/API in Feature 081
- system role definitions are seeded for the four current fixed roles
- system role definitions are immutable to normal authenticated users
- tenant custom roles are future-ready but not product-visible yet

Use a durable capability table with the same keys as the TypeScript catalog:

- database capability keys must equal `TENANT_CAPABILITIES`
- system role mappings must equal `ROLE_CAPABILITIES`
- labels, descriptions, groups, and i18n copy stay in TypeScript/i18n for now

Use one generic scoped assignment table now:

- tenant scope: `scope_type = 'tenant'`
- project scope: `scope_type = 'project'`
- workspace scope: `scope_type = 'workspace'`
- assignments require existing tenant membership
- assignments are non-enforcing in Feature 081

## Exact schema/model plan

Create one additive migration, tentatively named:

- `supabase/migrations/<timestamp>_081_role_assignment_foundation.sql`

The migration should apply cleanly from a fresh `supabase db reset`.

### `public.capabilities`

Columns:

- `key text primary key`
- `created_at timestamptz not null default now()`

Constraints:

- `capabilities_key_not_blank_check check (btrim(key) <> '')`

Indexes:

- primary key on `key`

No labels, descriptions, groups, or UI ordering should be stored in this table in Feature 081.

### `public.role_definitions`

Columns:

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

Actor field decision:

- `created_by` and `updated_by` are nullable for seeded system roles.
- tenant custom role rows should require `created_by` and `updated_by`.
- do not use a sentinel system actor.

Required checks:

- `role_definitions_slug_not_blank_check check (btrim(slug) <> '')`
- `role_definitions_name_not_blank_check check (btrim(name) <> '')`
- `role_definitions_system_role_key_check check (system_role_key is null or system_role_key in ('owner', 'admin', 'reviewer', 'photographer'))`
- `role_definitions_shape_check`:
  - system rows: `is_system = true`, `tenant_id is null`, `system_role_key is not null`, `created_by is null`, `updated_by is null`, `archived_at is null`, `archived_by is null`
  - tenant rows: `is_system = false`, `tenant_id is not null`, `system_role_key is null`, `created_by is not null`, `updated_by is not null`
- `role_definitions_archive_shape_check`:
  - `(archived_at is null and archived_by is null) or (archived_at is not null and archived_by is not null)`

Unique indexes:

- `role_definitions_system_role_key_unique_idx` on `(system_role_key)` where `is_system`
- `role_definitions_system_slug_active_unique_idx` on `lower(btrim(slug))` where `is_system and archived_at is null`
- `role_definitions_system_name_active_unique_idx` on `lower(btrim(name))` where `is_system and archived_at is null`
- `role_definitions_tenant_slug_active_unique_idx` on `(tenant_id, lower(btrim(slug)))` where `not is_system and archived_at is null`
- `role_definitions_tenant_name_active_unique_idx` on `(tenant_id, lower(btrim(name)))` where `not is_system and archived_at is null`

Supporting indexes:

- `role_definitions_tenant_active_idx` on `(tenant_id, archived_at, created_at desc)` where `not is_system`
- `role_definitions_system_idx` on `(system_role_key)` where `is_system`

Tenant custom role rows are structurally allowed now so future UI/API work can reuse the same table. Feature 081 should not expose any user-facing creation, update, archive, or delete path for them.

### `public.role_definition_capabilities`

Columns:

- `role_definition_id uuid not null references public.role_definitions(id) on delete cascade`
- `capability_key text not null references public.capabilities(key) on delete restrict`
- `created_at timestamptz not null default now()`
- `primary key (role_definition_id, capability_key)`

Indexes:

- primary key on `(role_definition_id, capability_key)`
- `role_definition_capabilities_capability_idx` on `(capability_key)`

Seeded system role mappings should be idempotent. No normal authenticated write policy should exist in Feature 081.

### `public.role_assignments`

Columns:

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null references public.tenants(id) on delete cascade`
- `user_id uuid not null`
- `role_definition_id uuid not null references public.role_definitions(id) on delete restrict`
- `scope_type text not null check (scope_type in ('tenant', 'project', 'workspace'))`
- `project_id uuid null`
- `workspace_id uuid null`
- `created_at timestamptz not null default now()`
- `created_by uuid null references auth.users(id) on delete restrict`
- `revoked_at timestamptz null`
- `revoked_by uuid null references auth.users(id) on delete restrict`

Relationship decisions:

- assignments reference `memberships` through `(tenant_id, user_id)`
- tenant membership is required before any assignment
- project/workspace scoped assignment does not imply membership
- membership deletion cascades assignment deletion in Feature 081
- multiple active roles in the same scope are allowed
- duplicate exact active role/user/scope rows are prevented

Foreign keys:

- `role_assignments_membership_fk foreign key (tenant_id, user_id) references public.memberships(tenant_id, user_id) on delete cascade`
- `role_assignments_project_scope_fk foreign key (project_id, tenant_id) references public.projects(id, tenant_id) on delete cascade`
- `role_assignments_workspace_scope_fk foreign key (workspace_id, tenant_id, project_id) references public.project_workspaces(id, tenant_id, project_id) on delete cascade`

The composite project/workspace FKs are nullable-safe because tenant-scope rows have null project/workspace columns. Scope shape checks below make sure they are only null where intended.

Required checks:

- `role_assignments_scope_shape_check`:
  - tenant: `project_id is null and workspace_id is null`
  - project: `project_id is not null and workspace_id is null`
  - workspace: `project_id is not null and workspace_id is not null`
- `role_assignments_revoke_shape_check`:
  - `(revoked_at is null and revoked_by is null) or (revoked_at is not null and revoked_by is not null)`

Role-definition tenant guard:

- add a `before insert or update` constraint trigger, for example `app.assert_role_assignment_role_definition_scope()`
- the trigger must verify the referenced role definition is either:
  - a system role with `is_system = true` and `tenant_id is null`, or
  - a tenant role with `is_system = false` and `tenant_id = new.tenant_id`
- the trigger must reject active assignment to an archived tenant role

A plain FK to `role_definitions(id)` is not enough because it cannot ensure a tenant assignment does not reference another tenant's custom role.

Partial unique active-assignment indexes:

- `role_assignments_active_tenant_unique_idx` on `(tenant_id, user_id, role_definition_id)` where `scope_type = 'tenant' and revoked_at is null`
- `role_assignments_active_project_unique_idx` on `(tenant_id, user_id, role_definition_id, project_id)` where `scope_type = 'project' and revoked_at is null`
- `role_assignments_active_workspace_unique_idx` on `(tenant_id, user_id, role_definition_id, project_id, workspace_id)` where `scope_type = 'workspace' and revoked_at is null`

Supporting indexes:

- `role_assignments_tenant_user_active_idx` on `(tenant_id, user_id, revoked_at, created_at desc)`
- `role_assignments_project_active_idx` on `(tenant_id, project_id, revoked_at, created_at desc)` where `project_id is not null`
- `role_assignments_workspace_active_idx` on `(tenant_id, project_id, workspace_id, revoked_at, created_at desc)` where `workspace_id is not null`
- `role_assignments_role_definition_idx` on `(role_definition_id)`

## Exact seed strategy

Seed in the same migration as the table creation.

Capabilities:

- insert one row per `TENANT_CAPABILITIES` key
- use `insert ... on conflict (key) do nothing`
- do not seed future-only keys

System roles:

- insert system role definitions for:
  - `owner`
  - `admin`
  - `reviewer`
  - `photographer`
- use `slug` equal to the fixed role key
- use `system_role_key` equal to the fixed role key
- use stable names such as `Owner`, `Admin`, `Reviewer`, and `Photographer`
- keep `tenant_id`, `created_by`, `updated_by`, `archived_at`, and `archived_by` null
- use idempotent upsert by the partial unique system-role-key index

System role mappings:

- insert mappings by selecting system role ids from `role_definitions`
- map each system role to the exact capability set in `ROLE_CAPABILITIES`
- use `on conflict (role_definition_id, capability_key) do nothing`

Do not seed:

- tenant custom roles
- role assignment rows for existing memberships
- future role-management capability keys
- labels, descriptions, groups, or UI metadata in `capabilities`

After `supabase db reset`, the database should contain only the seeded capabilities, system role definitions, and system role-capability mappings for this feature.

## Exact RLS/SQL boundary

### Existing live SQL/RLS helpers

Do not change existing live SQL helper functions in Feature 081.

Do not make any existing helper read the new role tables:

- `app.current_user_can_manage_members`
- `app.current_user_can_create_projects`
- `app.current_user_can_manage_templates`
- `app.current_user_can_manage_recurring_profiles`
- `app.current_user_can_access_project`
- `app.current_user_can_manage_project_workspaces`
- `app.current_user_can_access_project_workspace`
- `app.current_user_can_capture_project_workspace`
- `app.current_user_can_review_project_workspace`
- `app.current_user_can_access_media_library`
- `app.current_user_can_manage_media_library`

Do not change existing domain table policies for member management, templates, profiles, projects, workspaces, capture tables, review tables, workflow/correction tables, or Media Library tables.

### New foundation table RLS

Enable RLS on all new tables.

Grant read privileges only where policies allow them. Do not grant normal authenticated insert/update/delete privileges in Feature 081.

Recommended policies:

- `capabilities`
  - select: any authenticated user can read capability keys
  - writes: no authenticated policies
- `role_definitions`
  - select system roles: authenticated users can read rows where `is_system`
  - select tenant roles: authenticated users can read rows for tenants where `app.current_user_can_manage_members(tenant_id)` is true
  - writes: no authenticated policies
- `role_definition_capabilities`
  - select system mappings: authenticated users can read mappings for system roles
  - select tenant mappings: authenticated users can read mappings for tenant roles they can read as managers
  - writes: no authenticated policies
- `role_assignments`
  - select manager view: authenticated users can read tenant assignments where `app.current_user_can_manage_members(tenant_id)` is true
  - select own assignments: authenticated users can read rows where `user_id = auth.uid()`
  - writes: no authenticated policies

Service role bypasses RLS for migrations, seeds, and tests.

This is safe because the new rows are not live enforcement, and normal users cannot mutate role definitions, mappings, or assignments in Feature 081.

## Exact TypeScript helper plan

Add one new module:

- `src/lib/tenant/role-assignment-foundation.ts`

Keep the module separate from live `src/lib/tenant/permissions.ts`.

Planned exported helpers:

- `listCapabilities(supabase)`
- `listSystemRoleDefinitions(supabase)`
- `listRoleDefinitionsForTenant(supabase, tenantId)`
- `loadRoleDefinitionWithCapabilities(supabase, input)`
- `listRoleAssignmentsForUser(supabase, tenantId, userId)`
- `listRoleAssignmentsForProject(supabase, tenantId, projectId)`
- `listRoleAssignmentsForWorkspace(supabase, tenantId, projectId, workspaceId)`
- `resolveDurableRoleAssignments(supabase, input)`
- `assertRoleCapabilityCatalogMatchesDatabase(supabase)`

Helper rules:

- helpers are read-only in Feature 081
- helpers must be documented as non-enforcing
- helpers must require server-resolved `tenantId`; never accept client authority over tenant scope
- helpers should return explicit scope fields and active/revoked state
- `resolveDurableRoleAssignments` may resolve assigned role capabilities, but it must not be used for authorization
- `assertRoleCapabilityCatalogMatchesDatabase` compares database rows to `TENANT_CAPABILITIES` and `ROLE_CAPABILITIES`

Do not:

- import these helpers into `permissions.ts` for access decisions
- call these helpers from existing route handlers for authorization
- change the return shapes in `permissions.ts`
- expose mutation functions for custom roles or assignments

## Relationship to `memberships.role`

Required relationship for Feature 081:

- `memberships.role` remains unchanged
- `memberships.role` remains authoritative for live access
- fixed roles are represented as durable system role definitions
- system role-capability mappings mirror `ROLE_CAPABILITIES`
- existing memberships are not mirrored into `role_assignments`
- member role changes continue to update only `memberships.role`
- invite acceptance continues to create only a fixed-role membership
- member removal continues to delete the membership; any future assignment rows for that membership cascade away
- SQL/RLS helpers continue to read `memberships.role`
- TypeScript permission helpers continue to resolve memberships and derive current booleans from the Feature 080 catalog

Do not backfill all current memberships into role assignments. Backfill would create a shadow source that is not used for enforcement, and member update/invite/removal flows would then need unnecessary synchronization in a foundation-only feature.

## Non-enforcement guarantee

Feature 081 guarantees new rows do not affect live access through these implementation rules:

- no changes to existing SQL helper functions
- no changes to existing RLS policies for current domain tables
- no changes to current route authorization helpers
- no imports from `role-assignment-foundation.ts` into live permission resolution
- no custom role or assignment mutation UI/API
- no membership-to-assignment backfill
- tests intentionally create durable assignment rows and prove current access remains unchanged

The new tables may contain a row assigning a reviewer-like role at project or workspace scope, but current project visibility, workspace visibility, capture, review, correction, finalization, and Media Library access must still follow `memberships.role` and current project/workspace rules.

## Future migration path

Feature 082 - project-scoped reviewer assignments:

- prepared by: `role_assignments` with project/workspace scopes, system reviewer role definition, capability mappings
- deferred: changing reviewer visibility, project list queries, workspace RLS helpers, review routes, and current tenant-wide reviewer behavior

Feature 083 - custom role editor UI:

- prepared by: tenant-local `role_definitions` and `role_definition_capabilities`
- deferred: UI, mutation APIs, validation UX, capability grouping, dangerous-combination review, and custom-role audit behavior

Feature 084 - invite/member assignment to custom roles:

- prepared by: membership-required assignment rows and durable role definitions
- deferred: invite schema/RPC changes, member-management UI controls, default fixed-role fallback decisions, and assignment lifecycle UX

Feature 085 - gradual SQL/RLS enforcement migration:

- prepared by: durable capabilities, role mappings, scoped assignments, and drift tests
- deferred: SQL effective-capability functions, route helper migrations, RLS policy migrations, and area-by-area parity tests

Do not implement those future behaviors in Feature 081.

## UI/API scope

Feature 081 should expose no user-visible UI.

Do not add:

- custom role editor
- Members page role-assignment controls
- invite-to-custom-role API
- role-management mutation routes
- product-visible assignment read routes

Internal/test-only read helpers are enough for this slice. A product API would imply these rows are meaningful for live access, which is intentionally false in Feature 081.

## Documentation/comment plan

The plan document is the primary developer note.

Add concise code comments only where they preserve important invariants:

- the new helper module should say durable assignments are non-enforcing in Feature 081
- the drift assertion should say database keys must match the Feature 080 TypeScript catalog
- the migration trigger should explain it prevents assigning a tenant to another tenant's custom role
- the role assignment table comments should identify `memberships.role` as the live enforcement source for this slice

Do not scatter broad roadmap commentary through code. Keep future migration guidance in RPI docs.

## Test plan

Add a new focused test file:

- `tests/feature-081-role-assignment-foundation.test.ts`

Also keep current permission-sensitive tests green:

- `tests/feature-070-tenant-rbac-foundation.test.ts`
- `tests/feature-070-active-tenant-route.test.ts`
- `tests/feature-078-media-library-folders.test.ts`
- `tests/feature-079-correction-media-intake-foundation.test.ts`
- `tests/feature-080-role-capability-catalog.test.ts`

### Existing behavior unchanged

Tests should prove:

- `deriveTenantPermissionsFromRole(...)` and `deriveProjectPermissionsFromRole(...)` still return the Feature 080 booleans
- `ROLE_CAPABILITIES` still maps the four fixed roles exactly
- current SQL helpers still return owner/admin/reviewer/photographer answers as before
- member-management listing, role update, owner immutability, and removal are unchanged
- invite create/refresh/revoke/accept remains unchanged
- active tenant selection remains membership-validated
- project creation remains owner/admin only
- project and workspace visibility remains unchanged
- photographers remain scoped to assigned workspaces
- reviewers remain tenant-wide for now
- Media Library access remains owner/admin/reviewer only
- correction/finalization behavior is unchanged

### New schema and seed tests

Tests should prove:

- all expected capability keys are seeded
- no extra database capability key exists
- system role definitions exist for `owner`, `admin`, `reviewer`, and `photographer`
- system role definitions have `tenant_id is null`, `is_system = true`, and matching `system_role_key`
- system role mappings match `ROLE_CAPABILITIES`
- system role shape constraints reject tenant ids, actor ids, archive fields, and invalid system role keys
- tenant role shape constraints require tenant id, null system role key, and actor ids
- active system and tenant role slug/name uniqueness works
- assignment tenant scope rejects project/workspace ids
- assignment project scope requires project id and rejects workspace id
- assignment workspace scope requires both project id and workspace id
- workspace assignment cannot point to a workspace from another project
- project/workspace assignment cannot cross tenant boundaries
- assignment cannot exist without tenant membership
- assignment cannot reference another tenant's custom role
- active assignment cannot reference an archived role
- duplicate active assignments are prevented per exact user/role/scope
- revoked historical duplicates can coexist with a new active assignment
- membership removal cascades assignment rows

### Non-enforcement tests

Use service-role setup to insert durable assignment rows, then assert current live helpers/routes still ignore them:

- assign the system reviewer role at workspace scope to a photographer and prove current review access is still denied
- assign the system photographer role at workspace scope to a reviewer and prove current capture access is still denied
- assign a reviewer/media-library-capable durable role to a photographer and prove Media Library access is still denied
- create a project-scoped durable assignment and prove project list visibility is unchanged
- create a workspace-scoped durable assignment and prove workspace visibility is unchanged

### Drift tests

Tests should compare:

- TypeScript `TENANT_CAPABILITIES` equals database `capabilities.key`
- TypeScript `ROLE_CAPABILITIES` equals database system role mappings
- every database seeded capability is known by TypeScript
- every TypeScript capability exists in the database
- every system role mapping after `supabase db reset` is exactly expected

## Risks and edge cases

Risk: schema allows assignment to another tenant's custom role.

- Mitigation: role-assignment validation trigger checks the role definition's tenant/system shape against assignment tenant.

Risk: accidental enforcement through new helpers.

- Mitigation: keep helpers in a separate module, document them as non-enforcing, and add non-enforcement tests.

Risk: SQL/TypeScript capability drift.

- Mitigation: seed database keys from the current catalog and add drift tests.

Risk: assignment rows survive membership removal.

- Mitigation: FK `(tenant_id, user_id)` to memberships with `on delete cascade`.

Risk: project/workspace cross-tenant references.

- Mitigation: composite FKs `(project_id, tenant_id)` and `(workspace_id, tenant_id, project_id)`.

Risk: workspace assignment points to the wrong project.

- Mitigation: workspace scope requires both `project_id` and `workspace_id`, and the composite workspace FK includes both.

Risk: future custom role has no capabilities.

- Mitigation: no custom role UI/API in Feature 081. Future editor decides whether empty roles are drafts or invalid active roles.

Risk: dangerous capability combinations.

- Mitigation: only seed known system combinations now. Future UI must make high-impact capabilities explicit and audited.

Risk: owner/admin safety.

- Mitigation: owner safety remains on `memberships.role`; do not add owner assignment/demotion semantics.

Risk: active tenant switching and future assignment reads.

- Mitigation: helper APIs require server-resolved tenant id and never accept tenant scope from client payloads.

## Implementation phases

### Phase 1 - Migration and seed data

- add `capabilities`
- add `role_definitions`
- add `role_definition_capabilities`
- add `role_assignments`
- add constraints, indexes, FKs, RLS, and the role-definition tenant guard trigger
- seed capabilities, system roles, and system role mappings

Validation:

- migration applies from clean reset
- seed rows exist and are idempotent
- no existing SQL/RLS helpers changed

### Phase 2 - Read/helper module

- add `src/lib/tenant/role-assignment-foundation.ts`
- implement read-only helpers
- implement catalog/database drift assertion helper
- document helpers as non-enforcing

Validation:

- TypeScript compiles
- no live permission module imports the new assignment resolver

### Phase 3 - Drift and schema tests

- add `tests/feature-081-role-assignment-foundation.test.ts`
- cover seed drift, role shape constraints, assignment scope constraints, tenant/project/workspace consistency, duplicate prevention, revocation, and membership cleanup

Validation:

- new Feature 081 tests pass

### Phase 4 - Non-enforcement and current-behavior regression

- add durable assignment rows in tests
- prove current access helpers/routes ignore them
- run current Feature 070, 078, 079, and 080 permission-sensitive tests

Validation:

- fixed-role access behavior remains unchanged
- photographers remain workspace-scoped
- reviewers remain tenant-wide
- Media Library access remains unchanged

### Phase 5 - Documentation/developer notes

- add concise invariant comments in migration/helper code
- keep roadmap details in RPI docs

Validation:

- comments explain why the non-enforcing boundary exists without adding broad speculative notes

## Clear scope boundaries

Feature 081 must not:

- change `memberships.role`
- change member-management writes
- change invite acceptance
- change active tenant resolution
- change current route authorization
- change current SQL helper behavior
- change current domain table RLS policies
- make reviewer access project-scoped
- make durable assignments live enforcement
- expose custom role UI/API
- backfill all memberships into role assignments

Feature 081 may:

- create durable foundation tables
- seed current role/capability metadata
- add read-only, non-enforcing helpers
- add tests proving seed correctness, constraint safety, drift detection, and no behavior change

## Concise implementation prompt

Implement Feature 081 as a foundation-only durable role/capability/scoped-assignment layer. Add one additive migration with `capabilities`, `role_definitions`, `role_definition_capabilities`, and `role_assignments`, including constraints, composite FKs, RLS, and a trigger that prevents assigning tenant users to another tenant's custom role. Seed only the current Feature 080 capability keys, the four system roles (`owner`, `admin`, `reviewer`, `photographer`), and system role-capability mappings matching `ROLE_CAPABILITIES`. Do not backfill memberships into assignments. Keep `memberships.role` authoritative and do not change existing SQL/RLS helpers, route authorization, invite behavior, active-tenant behavior, project/workspace behavior, correction/finalization behavior, or Media Library behavior. Add a separate read-only `src/lib/tenant/role-assignment-foundation.ts` helper module documented as non-enforcing, and do not import it into live permission checks. Add Feature 081 tests for seed/catalog drift, schema constraints, tenant/project/workspace consistency, assignment cleanup, duplicate/revoked assignment behavior, and non-enforcement, then run the existing Feature 070, 078, 079, and 080 permission-sensitive tests.
