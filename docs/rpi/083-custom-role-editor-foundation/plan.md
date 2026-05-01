# Feature 083 Plan - Custom role editor foundation

## 1. Scope and contract

Feature 083 adds the first user-facing custom role definition editor.

The feature lets owner/admin users manage tenant-local custom role definitions and their capability mappings. It does not assign those custom roles to users, projects, or workspaces, and it does not make custom-role capabilities live authorization.

Locked scope:

- Use the existing Feature 081 `role_definitions` and `role_definition_capabilities` tables.
- Do not create new role model tables.
- Add owner/admin-only custom role list/create/edit/archive service and APIs.
- Add a compact custom roles section to the existing Members / Organization Users page.
- Show seeded system roles as read-only reference data.
- Require active custom roles to have at least one known capability.
- Archive custom roles instead of deleting them.
- Keep Feature 082 reviewer enforcement limited to active assignments of the system `reviewer` role.

Out of scope:

- custom role assignment UI or API;
- invite-to-custom-role;
- generic effective-capability engine;
- migrating SQL/RLS helpers to custom roles;
- changing owner/admin fixed-role behavior;
- changing photographer workspace behavior;
- changing reviewer enforcement except to preserve its system-reviewer-only boundary;
- changing capture, review, Media Library, consent, matching, workflow, correction, or release semantics;
- preserving arbitrary old local custom-role rows.

## 2. Inputs and ground truth

Required files were read before this plan:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `UNCODEXIFY.md`
5. `docs/rpi/README.md`
6. `docs/rpi/SUMMARY.md`
7. `docs/rpi/081-custom-role-definitions-and-scoped-role-assignment-foundation/research.md`
8. `docs/rpi/081-custom-role-definitions-and-scoped-role-assignment-foundation/plan.md`
9. `docs/rpi/082-project-scoped-reviewer-assignments-and-enforcement/research.md`
10. `docs/rpi/082-project-scoped-reviewer-assignments-and-enforcement/plan.md`
11. `docs/rpi/083-custom-role-editor-foundation/research.md`

Targeted live verification then checked:

- `src/lib/tenant/role-capabilities.ts`
- `src/lib/tenant/role-assignment-foundation.ts`
- `src/lib/tenant/reviewer-access-service.ts`
- `src/lib/tenant/permissions.ts`
- `src/lib/tenant/member-management-service.ts`
- `src/lib/tenant/member-management-route-utils.ts`
- `src/app/(protected)/members/page.tsx`
- `src/components/members/member-management-panel.tsx`
- `src/app/api/members/**`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/components/projects/project-reviewer-access-panel.tsx`
- `messages/en.json`
- `messages/nl.json`
- `supabase/migrations/20260430120000_081_role_assignment_foundation.sql`
- `supabase/migrations/20260430130000_082_reviewer_access_assignment_enforcement.sql`
- Feature 080, 081, 082, and member-management tests under `tests/`

Current live code and schema are authoritative. Older RPI documents are context only.

## 3. Verified current boundary

Feature 081 is live and provides:

- `capabilities(key, created_at)`;
- `role_definitions(id, tenant_id, slug, name, description, is_system, system_role_key, created/updated/archive audit fields)`;
- `role_definition_capabilities(role_definition_id, capability_key, created_at)`;
- `role_assignments(id, tenant_id, user_id, role_definition_id, scope_type, project_id, workspace_id, created/revoked audit fields)`.

Feature 081 constraints already support tenant custom role rows:

- system roles are global rows with `tenant_id is null`, `is_system = true`, and `system_role_key in ('owner', 'admin', 'reviewer', 'photographer')`;
- tenant custom roles have `tenant_id is not null`, `is_system = false`, null `system_role_key`, and non-null actor fields;
- active tenant role names and slugs are unique per tenant using partial indexes where `archived_at is null`;
- archived tenant role names and slugs can be reused;
- `role_definition_capabilities` can store mappings for both system and custom roles.

Feature 081 RLS currently allows authenticated reads only:

- all authenticated users can read capability keys;
- authenticated users can read system role definitions and mappings;
- tenant custom role definitions and mappings are readable to tenant managers through `app.current_user_can_manage_members(tenant_id)`;
- normal authenticated users have no insert/update/delete policies for role tables.

Feature 081 helper functions are read-oriented and non-enforcing:

- `listCapabilities`
- `listSystemRoleDefinitions`
- `listRoleDefinitionsForTenant`
- `loadRoleDefinitionWithCapabilities`
- `resolveDurableRoleAssignments`
- `assertRoleCapabilityCatalogMatchesDatabase`

Feature 082 is live and enforcing only for active assignments of the system `reviewer` role:

- SQL joins require `role_definitions.is_system` and `system_role_key = 'reviewer'`;
- TypeScript reviewer access service loads only the system reviewer role definition;
- fixed reviewer membership is eligibility only;
- tenant/project reviewer access comes from active system reviewer assignments;
- custom roles are not read by reviewer enforcement.

The current Members page:

- is the Organization Users area;
- renders an invite form, fixed role reference, current members table with reviewer access, and pending invites;
- is manager-only for mutation surfaces;
- uses `getTenantMemberManagementData(...)` and `MemberManagementPanel`;
- uses existing i18n under `members.*`;
- already displays capability groups and capability labels from `CAPABILITY_GROUPS`, `CAPABILITY_LABEL_KEYS`, and `members.capabilities.*`.

Feature 083 adds custom role definition editing only.

## 4. Recommendation

Implement Feature 083 as a small editor over the Feature 081 role-definition tables:

- Add `src/lib/tenant/custom-role-service.ts`.
- Add narrow SQL RPC functions for atomic custom role create/update/archive.
- Add Members API routes under `/api/members/roles`.
- Extend Members page data with role editor data.
- Add a compact Custom roles section to `MemberManagementPanel`, preferably factored into a child component.
- Reuse existing capability groups and i18n labels.
- Keep role helpers separate from live permission enforcement helpers.
- Keep authenticated direct writes to role tables disabled.

This delivers the first user-facing role editor without implying custom roles are assigned or enforced. It also avoids a new access-management navigation area until assignment and broader enforcement work are ready.

## 5. Chosen architecture

Use the existing Feature 081 tables:

- system role rows remain seeded and read-only;
- tenant custom role rows are created in `role_definitions`;
- selected capabilities are stored in `role_definition_capabilities`;
- no new role tables are introduced.

Use route-authoritative writes:

- route derives tenant through `requireAuthenticatedTenantContext()`;
- route validates owner/admin through the service;
- service creates a server-only admin client only after validation;
- service calls transactional RPC functions for writes;
- client never sends or controls `tenant_id`.

Keep boundaries separate:

- `permissions.ts` remains live fixed-role plus Feature 082 reviewer-assignment enforcement;
- `reviewer-access-service.ts` remains specific to system reviewer assignments;
- `role-assignment-foundation.ts` remains foundation/read helper code;
- `custom-role-service.ts` handles editor-specific validation and custom role mutations.

Use the Members page:

- no new `/roles` or `/access` nav item;
- no broad IAM dashboard;
- no role assignment workflow;
- custom role definitions sit near the fixed role reference where owners/admins already review role capability meaning.

## 6. Exact schema/migration/RPC plan

Feature 083 needs no new tables.

Add one narrow migration for transactional RPC functions, tentatively:

- `supabase/migrations/<timestamp>_083_custom_role_editor_functions.sql`

Reason: Supabase query-builder calls do not provide a convenient multi-statement transaction boundary from the service. Create/update must keep role metadata and capability mappings consistent. A small RPC layer is cleaner than service-side insert/delete/cleanup sequences.

Do not add:

- new role model tables;
- draft status;
- authenticated write RLS policies;
- system-role immutability trigger;
- slug immutability trigger.

Service-level and RPC-level guards are enough for this feature because normal authenticated writes are blocked. A system-role immutability trigger would complicate future seed maintenance and is not needed for this bounded editor.

### RPC functions

Add:

- `app.create_tenant_custom_role_with_capabilities(...)`
- `app.update_tenant_custom_role_with_capabilities(...)`
- `app.archive_tenant_custom_role(...)`

All functions:

- `language plpgsql`;
- `security definer`;
- `set search_path = public, extensions`;
- revoke execute from `public`;
- grant execute to `service_role` only;
- accept server-resolved `p_tenant_id` and server-authenticated `p_actor_user_id`;
- verify `p_actor_user_id` is a current `owner` or `admin` member of `p_tenant_id`;
- never trust client authority.

`app.create_tenant_custom_role_with_capabilities` parameters:

- `p_tenant_id uuid`
- `p_actor_user_id uuid`
- `p_slug text`
- `p_name text`
- `p_description text`
- `p_capability_keys text[]`

Behavior:

- reject non-manager actor with an exception that the service maps to `403 tenant_member_management_forbidden`;
- require nonblank slug and name;
- require non-empty capability array;
- reject duplicate capability keys;
- reject any key not present in `capabilities`;
- insert `role_definitions` with `tenant_id = p_tenant_id`, `is_system = false`, `system_role_key = null`, `created_by = p_actor_user_id`, `updated_by = p_actor_user_id`;
- insert mappings into `role_definition_capabilities`;
- return the created role id;
- let active unique name/slug violations bubble as SQLSTATE `23505` for mapping to `409 role_name_conflict`.

`app.update_tenant_custom_role_with_capabilities` parameters:

- `p_tenant_id uuid`
- `p_role_definition_id uuid`
- `p_actor_user_id uuid`
- `p_name text`
- `p_description text`
- `p_capability_keys text[]`

Behavior:

- verify manager actor;
- lock and load `role_definitions` row by id and tenant;
- require `is_system = false`;
- reject missing/cross-tenant role as `role_not_found`;
- reject archived role as `role_archived`;
- do not update `slug`;
- update `name`, `description`, `updated_at`, `updated_by`;
- replace the full capability set atomically by deleting existing mappings and inserting the requested set;
- reject unknown, duplicate, or empty capability keys;
- return the role id.

`app.archive_tenant_custom_role` parameters:

- `p_tenant_id uuid`
- `p_role_definition_id uuid`
- `p_actor_user_id uuid`

Behavior:

- verify manager actor;
- lock and load role by id and tenant;
- require `is_system = false`;
- missing/cross-tenant role maps to `404 role_not_found`;
- if already archived, return `false`;
- otherwise set `archived_at`, `archived_by`, `updated_at`, `updated_by` and return `true`;
- do not delete capability mappings or assignment rows.

## 7. Exact custom role lifecycle plan

Custom roles are tenant-local rows:

- `is_system = false`;
- `tenant_id = active server-resolved tenant`;
- `system_role_key = null`;
- actor fields set to the authenticated manager.

Lifecycle decisions:

- `name` is required.
- `description` is optional.
- `slug` is generated server-side from the initial name.
- `slug` is not shown as editable and is not accepted from clients.
- slug immutability is enforced by service/RPC design: update RPC does not update it.
- active names and slugs are unique per tenant.
- archived names and slugs can be reused.
- archive instead of delete.
- archived roles keep capability mappings.
- no draft role state.
- active roles require at least one capability.
- editing archived roles is rejected with `409 role_archived`.
- archive is idempotent and returns `changed: false` when already archived.

Name and description validation:

- trim leading/trailing whitespace;
- collapse internal whitespace in `name`;
- reject blank name with `400 invalid_role_name`;
- use a max role name length of 120 characters;
- trim `description`;
- store `null` for blank description;
- use a max description length of 500 characters and return `400 invalid_role_description` when exceeded.

Slug generation:

- derive from normalized name;
- lowercase;
- convert non-alphanumeric runs to `-`;
- trim leading/trailing `-`;
- use `role` as fallback if the result is empty;
- if the active slug already exists in the tenant, append `-2`, `-3`, and so on;
- if an active normalized name already exists, return `409 role_name_conflict` instead of silently creating another role with a suffixed slug.

Archived roles:

- hidden from the active custom role list by default;
- available through `GET /api/members/roles?includeArchived=1` for manager/debug display and tests;
- no restore behavior in Feature 083.

## 8. Exact system role immutability plan

System roles:

- `owner`
- `admin`
- `reviewer`
- `photographer`

Display:

- keep the existing fixed Role reference table visible;
- system roles show localized names/descriptions and grouped capabilities;
- system roles are clearly read-only;
- no edit or archive controls for system roles.

API/service protections:

- create APIs never accept `is_system`, `system_role_key`, `tenant_id`, or actor/archive fields.
- update/archive APIs only target `is_system = false` rows in the active tenant.
- if a system role id is supplied, return `403 system_role_immutable`.
- system role capability mappings cannot be changed through custom role APIs.
- tests must prove system role edit/archive/mapping mutation attempts fail.

Database protection:

- keep current RLS with no authenticated writes.
- do not add a system-role immutability trigger in Feature 083.
- rely on service/RPC checks plus tests for this editor path.

## 9. Exact capability selection plan

Source of truth:

- database keys in `capabilities`;
- TypeScript keys in `TENANT_CAPABILITIES`;
- grouping in `CAPABILITY_GROUPS`;
- labels through `CAPABILITY_LABEL_KEYS` and `members.capabilities.*`.

Validation:

- load database capability keys and compare them to `TENANT_CAPABILITIES`;
- reject unknown keys with `400 invalid_capability_key`;
- reject duplicate keys with `400 duplicate_capability_key`;
- reject empty capability set with `400 empty_capability_set`;
- keep a defensive RPC-side unknown/duplicate/empty check even after TypeScript validation.

UI:

- grouped checkboxes by `CAPABILITY_GROUPS`;
- group labels from `members.capabilityGroups.*`;
- capability labels from `members.capabilities.*`;
- do not show raw technical keys as primary text;
- do not add capability descriptions in Feature 083 unless implementation finds a label is unusably unclear.

Mutation:

- create role and mappings in one RPC call;
- update role metadata and replace the full capability set in one RPC call;
- repeated update with the same body should succeed and leave the same final capability set;
- system role mappings are immutable through this API.

High-impact combinations:

- allowed for custom role definitions;
- owner/admin-only management is the safety gate;
- no enforcement occurs in Feature 083, so these combinations do not grant access yet.

## 10. Exact service/API plan

Add:

- `src/lib/tenant/custom-role-service.ts`

Recommended exported types:

- `RoleEditorCapability`
- `RoleEditorRole`
- `RoleEditorData`
- `CustomRoleInput`

Recommended exported functions:

- `listRoleEditorData(input)`
- `createCustomRole(input)`
- `updateCustomRole(input)`
- `archiveCustomRole(input)`
- `validateCustomRoleCapabilityKeys(input)`
- `normalizeCustomRoleName(value)`
- `normalizeCustomRoleDescription(value)`
- `generateCustomRoleSlug(input)`

Service rules:

- call `resolveTenantPermissions(...).canManageMembers`;
- never accept client-provided tenant id;
- create service-role client only after actor/tenant validation;
- use RPCs for mutations;
- map unique violation `23505` to `409 role_name_conflict`;
- map RPC validation exceptions to the documented API error codes;
- return normalized role data with capability keys after each write.

Add routes:

- `GET /api/members/roles`
- `POST /api/members/roles`
- `PATCH /api/members/roles/[roleId]`
- `POST /api/members/roles/[roleId]/archive`

Do not add `GET /api/members/roles/[roleId]` in the first slice. The list response is enough for the inline editor.

### `GET /api/members/roles`

Auth:

- authenticated;
- active tenant derived by `requireAuthenticatedTenantContext()`;
- owner/admin only.

Query:

- optional `includeArchived=1`.

Response `200`:

```json
{
  "capabilities": [
    { "key": "review.workspace", "groupKey": "review", "labelKey": "reviewWorkspace" }
  ],
  "systemRoles": [
    {
      "id": "uuid",
      "kind": "system",
      "slug": "reviewer",
      "name": "Reviewer",
      "description": "System reviewer role matching memberships.role = reviewer.",
      "archivedAt": null,
      "capabilityKeys": ["review.workspace"],
      "canEdit": false,
      "canArchive": false
    }
  ],
  "customRoles": [
    {
      "id": "uuid",
      "kind": "custom",
      "slug": "media-library-manager",
      "name": "Media Library Manager",
      "description": null,
      "archivedAt": null,
      "capabilityKeys": ["media_library.access"],
      "canEdit": true,
      "canArchive": true
    }
  ]
}
```

### `POST /api/members/roles`

Body:

```json
{ "name": "Media Library Manager", "description": null, "capabilityKeys": ["media_library.access"] }
```

Response:

- `201 { "role": ... }` on create.
- Duplicate active role name returns `409 role_name_conflict`.

Duplicate create decision:

- return conflict consistently for active duplicate names/slugs.
- do not compare payloads to return an existing role in Feature 083.
- UI should disable pending submit and refresh after success.
- a retry after uncertain network state may see conflict; the user can refresh and see the created role.

### `PATCH /api/members/roles/[roleId]`

Body:

```json
{ "name": "Project Lead", "description": "Coordinates review work.", "capabilityKeys": ["review.workspace"] }
```

Response:

- `200 { "role": ... }`.

Rules:

- full replacement for name, description, and capability set;
- slug is not changed;
- archived roles rejected;
- system roles rejected;
- cross-tenant role ids return `404 role_not_found`.

### `POST /api/members/roles/[roleId]/archive`

Body:

- none.

Response:

```json
{ "role": { "...": "..." }, "changed": true }
```

Rules:

- archive is idempotent;
- already archived returns `changed: false`;
- system roles rejected;
- cross-tenant role ids return `404 role_not_found`.

### Error codes

- `401 unauthenticated`
- `403 tenant_member_management_forbidden`
- `404 role_not_found`
- `400 invalid_body`
- `400 invalid_role_name`
- `400 invalid_role_description`
- `400 invalid_capability_key`
- `400 duplicate_capability_key`
- `400 empty_capability_set`
- `409 role_name_conflict`
- `409 role_archived`
- `403 system_role_immutable`
- `500 role_definition_write_failed`

## 11. Write consistency and retry plan

Create:

- TypeScript validates and generates slug.
- RPC inserts role and mappings in one transaction.
- unique conflict maps to `409 role_name_conflict`.
- duplicate create with the same name returns conflict, not existing role.

Update:

- TypeScript validates body and capability set.
- RPC locks the role row and replaces metadata/mappings atomically.
- repeated update with same body is successful.
- no partial mapping state is visible after RPC failure.

Archive:

- RPC locks role row.
- first archive sets archive fields and returns `changed: true`;
- repeated archive returns `changed: false`;
- capability mappings remain.

Race handling:

- concurrent creates with same normalized name/slug: one succeeds, one receives `409 role_name_conflict`;
- concurrent updates: last committed update wins because this is a definition editor without assignment enforcement in this slice;
- concurrent archive/update: update rejects if archive wins first; archive remains idempotent if update wins first;
- partial capability writes are avoided by RPC transaction boundary.

## 12. UI/i18n plan

Add role editor data to the Members page:

- extend `TenantMemberManagementData` with role editor data, or fetch role editor data separately in `MembersPage` and pass it to the panel;
- recommended: extend `getTenantMemberManagementData(...)` so the page remains one server data load for manager-only member/access data.

Add UI inside the existing Members page:

- place Custom roles after Role reference and before Current members;
- custom roles section visible only to manager users, because the entire panel is manager-only today;
- active custom roles in a compact table;
- inline create/edit form in the section;
- edit uses the same form mode instead of introducing modal infrastructure;
- archive button uses `window.confirm`;
- submit then `router.refresh()`;
- no optimistic updates.

Recommended component split:

- keep `MemberManagementPanel` as coordinator;
- add a child component such as `CustomRoleManagementSection` in `src/components/members/` or the same file if small;
- avoid making the existing panel harder to follow.

UI behavior:

- show system roles read-only through existing Role reference;
- show active custom roles with name, description, capability group summary, and actions;
- create/edit form includes name, description, and grouped capability checkboxes;
- reject empty capability selection client-side before submit, while API still enforces it;
- archived roles are hidden by default;
- no restore UI;
- no assignment count unless the implementation can read it cheaply without adding assignment workflows.

Clarification copy:

- include one short note that custom roles define reusable permission sets and are not assigned in this screen.
- do not add a long explanation or marketing copy.

Follow `UNCODEXIFY.md`:

- no hero section;
- no decorative dashboard;
- no IAM matrix;
- no nested card layout;
- normal table/form controls;
- concise copy;
- existing button/input/table style.

### i18n keys

Add English and Dutch messages under existing `members` namespace.

Recommended keys:

- `members.customRoles.title`
- `members.customRoles.subtitle`
- `members.customRoles.definitionOnlyNote`
- `members.customRoles.empty`
- `members.customRoles.columns.name`
- `members.customRoles.columns.description`
- `members.customRoles.columns.capabilities`
- `members.customRoles.columns.actions`
- `members.customRoles.archive`
- `members.customRoles.archiveConfirm`
- `members.customRoles.archived`
- `members.customRoles.created`
- `members.customRoles.updated`
- `members.customRoles.archiveChanged`
- `members.customRoles.archiveUnchanged`
- `members.customRoleForm.createTitle`
- `members.customRoleForm.editTitle`
- `members.customRoleForm.nameLabel`
- `members.customRoleForm.descriptionLabel`
- `members.customRoleForm.descriptionPlaceholder`
- `members.customRoleForm.capabilitiesLabel`
- `members.customRoleForm.create`
- `members.customRoleForm.update`
- `members.customRoleForm.cancel`
- `members.customRoleForm.emptyCapabilityError`
- `members.customRoleForm.duplicateNameError`
- `members.customRoleForm.error`

Do not add `members.capabilityDescriptions.*` in Feature 083 by default. Existing grouped labels are enough for the first slice.

## 13. Enforcement and assignment boundary

Feature 083 must not change:

- `memberships.role` fixed-role behavior;
- owner/admin tenant-wide management;
- photographer assigned-workspace capture;
- Feature 082 reviewer assignment enforcement;
- SQL/RLS helper logic;
- Media Library authorization;
- capture/review/correction/finalization route authorization.

Feature 083 must not add:

- custom role assignment UI;
- custom role assignment API;
- invite-to-custom-role;
- generic effective-capability engine;
- custom role enforcement in SQL or TypeScript.

Tests must prove:

- a custom role with `review.workspace` does not grant review access;
- a custom role with `media_library.access` does not grant Media Library access;
- a `role_assignments` row pointing at a custom role does not affect Feature 082 reviewer enforcement;
- Feature 082 still requires the system `reviewer` role assignment.

## 14. Fresh reset and seed/dev data plan

Feature 083 development should validate from:

```bash
supabase db reset
```

Local data policy:

- no preservation of arbitrary old local custom roles;
- no local backfill;
- no custom role seed rows by default;
- tests create custom roles explicitly;
- migrations are clean and forward-only.

Production preservation:

- no production backfill is required for the editor itself;
- if externally created custom roles exist in production, preserving or normalizing them is a separate rollout decision.

## 15. Security and tenant isolation plan

Mitigations:

- Non-manager create/edit/archive: service validates `resolveTenantPermissions(...).canManageMembers`; tests cover denial.
- Client-provided tenant id: API ignores it; tenant comes from `requireAuthenticatedTenantContext()`.
- Cross-tenant role edit: lookup by role id, active tenant id, and custom role shape; cross-tenant ids return `404 role_not_found`.
- System role mutation: service/RPC rejects system roles; UI has no controls; tests cover update/archive attempts.
- System role mapping mutation: update RPC only accepts tenant custom roles.
- Unknown capability key: validate against DB and `TENANT_CAPABILITIES`.
- Duplicate capability key: reject payload.
- Duplicate active name/slug: rely on normalized service checks plus existing unique indexes; map to `409 role_name_conflict`.
- Archived role edits: reject with `409 role_archived`.
- Empty capability set: reject in UI and API.
- Dangerous capability combinations: owner/admin-only editor; no assignment or enforcement in this feature.
- Accidental Feature 082 expansion: tests use custom review/media roles to prove no access.
- Partial mapping writes: use transactional RPC.
- Service-role misuse: create service-role client only after manager validation; RPC also validates actor membership.
- Active tenant switching: every route derives tenant at request time and UI refreshes after writes.

## 16. Test plan

Add focused tests, likely:

- `tests/feature-083-custom-role-editor-foundation.test.ts`

### Service/API tests

- owner/admin can list system roles and active custom roles;
- owner/admin can create a custom role;
- owner/admin can edit custom role name, description, and capability set;
- owner/admin can archive a custom role;
- archive is idempotent;
- non-manager cannot create/edit/archive;
- cross-tenant role access fails with not-found style behavior;
- system role edit fails;
- system role archive fails;
- system role mapping cannot be changed through custom role APIs;
- unknown capability key fails;
- duplicate capability key fails;
- empty capability set fails;
- duplicate active role name fails with exact chosen conflict behavior;
- archived role edit fails;
- archived role name/slug reuse works;
- update replacement leaves exactly the requested capability set;
- client-supplied `tenant_id` cannot redirect writes.

### Enforcement-boundary tests

- custom role with `review.workspace` does not grant project review access;
- custom role with `media_library.access` does not grant Media Library access;
- custom role assignment through `role_assignments` does not affect Feature 082 reviewer enforcement;
- system reviewer assignment tests still pass.

### UI/component tests

- Custom roles section renders for manager data;
- existing system role reference remains read-only;
- create/edit form renders grouped capabilities with localized labels;
- empty capability selection is blocked client-side;
- archive action calls archive route and refreshes;
- no custom role assignment controls render.

### Regression tests

Keep green:

- `tests/feature-070-tenant-rbac-foundation.test.ts`
- `tests/feature-080-role-capability-catalog.test.ts`
- `tests/feature-081-role-assignment-foundation.test.ts`
- `tests/feature-082-reviewer-access-assignments.test.ts`

Validation pass:

- clean `supabase db reset`;
- targeted Feature 083 tests;
- related regression tests;
- lint and full test suite when feasible.

## 17. Risks and edge cases

- Slug collisions: generate unique slugs, but duplicate normalized names still conflict.
- Update races: last write wins for metadata/capabilities; acceptable because custom roles are definitions only in this slice.
- Partial mapping writes: avoided with RPC transaction.
- Archived roles with existing assignments: archive remains allowed; assignments are not enforcing and future assignment features must decide restore/revoke semantics.
- System role immutability: guarded by service/RPC and no authenticated write RLS; tests are required.
- Accidental enforcement: keep custom role helpers out of `permissions.ts` and SQL helpers.
- Capability DB/code drift: service compares database capability rows with `TENANT_CAPABILITIES`.
- Tenant switching: routes derive tenant per request; no cached tenant authority in the client.
- Service-role misuse: RPC validates manager actor as a second guard.
- Members page clutter: section must stay compact and avoid assignment workflows.
- Future migration path: later features can add assignment UI and area-by-area enforcement after this editor is stable.

## 18. Implementation phases

### Phase 1 - RPC migration

- Add the three `app.*custom_role*` RPC functions.
- Grant execute only to service role.
- Keep table RLS write policies unchanged.

Validation:

- migration applies after `supabase db reset`;
- RPC rejects non-manager actor and invalid capability payloads;
- no existing role table behavior changes.

### Phase 2 - Custom role service

- Add `src/lib/tenant/custom-role-service.ts`.
- Implement normalization, slug generation, capability validation, role listing, create/update/archive calls, and error mapping.
- Keep code separate from permission enforcement.

Validation:

- service tests for create/edit/archive and validation;
- no imports into live authorization helpers.

### Phase 3 - API routes

- Add `/api/members/roles` GET/POST.
- Add `/api/members/roles/[roleId]` PATCH.
- Add `/api/members/roles/[roleId]/archive` POST.
- Use `requireAuthenticatedTenantContext()` and existing `HttpError/jsonError` conventions.

Validation:

- route/API tests for auth, authorization, validation, tenant isolation, and system immutability.

### Phase 4 - Members UI and i18n

- Extend Members page data with role editor data.
- Add Custom roles section and grouped capability selector.
- Add English and Dutch messages.
- Use submit plus `router.refresh()`.

Validation:

- component tests for rendering, grouped capabilities, client-side empty selection, and archive action;
- manual review for layout fit on desktop/mobile if implementation touches substantial UI.

### Phase 5 - Enforcement boundary tests

- Create custom roles with review and Media Library capabilities in tests.
- Optionally create custom role assignment rows via admin client.
- Prove no review/Media Library access is granted.
- Re-run Feature 082 reviewer access tests.

Validation:

- custom roles remain definitions only.

### Phase 6 - Clean reset and regression pass

- Run `supabase db reset`.
- Run targeted Feature 083 tests.
- Run Feature 080/081/082/member-management regressions.
- Run lint and full tests when feasible.

## 19. Clear scope boundaries

Do implement:

- owner/admin custom role definition listing;
- custom role create/edit/archive;
- capability selection from existing catalog;
- system role read-only display;
- route-authoritative server validation;
- transactional role/mapping writes;
- UI/i18n additions in Members;
- tests for security, tenant isolation, system immutability, and non-enforcement.

Do not implement:

- assigning custom roles to members;
- assigning custom roles to projects or workspaces;
- invite-to-custom-role;
- generic effective-capability engine;
- broad SQL/RLS migration;
- custom role enforcement in any current access area;
- owner/admin, photographer, or reviewer behavior changes;
- sample custom role seeds by default;
- old local custom-role preservation.

## 20. Concise implementation prompt

Implement Feature 083 as a bounded custom role definition editor. Reuse the existing Feature 081 `role_definitions` and `role_definition_capabilities` tables. Add a narrow migration with service-role-only RPCs for atomic custom role create, update, and archive. Add `src/lib/tenant/custom-role-service.ts` with owner/admin validation, server-derived tenant scope, name/description normalization, server-side slug generation, capability validation against both database keys and `TENANT_CAPABILITIES`, and system role immutability checks.

Add `/api/members/roles`, `/api/members/roles/[roleId]`, and `/api/members/roles/[roleId]/archive` route handlers following existing Members API conventions. Extend the Members page with a compact Custom roles section, read-only system role reference, inline create/edit form, grouped capability checkboxes using existing i18n labels, and archive confirmation. Add English and Dutch copy under `members.*`.

Do not add custom role assignment, invite-to-custom-role, generic effective capability resolution, or SQL/RLS enforcement changes. Preserve Feature 082 system-reviewer-only enforcement. Add tests for create/edit/archive, validation, system role immutability, tenant isolation, archived-name reuse, and proof that custom roles with review or Media Library capabilities do not grant live access. Validate from a clean `supabase db reset`.
