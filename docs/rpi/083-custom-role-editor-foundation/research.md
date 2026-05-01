# Feature 083 Research - Custom role editor foundation

## 1. Title and scope

Feature 083 researches the first user-facing custom role editor for SnapConsent. The intended slice is a bounded role-definition editor: owners/admins can view system roles, create tenant-local custom roles, edit custom role metadata and capability mappings, and archive custom roles.

This research does not recommend assigning custom roles to users, projects, or workspaces in Feature 083. It also does not recommend broad custom-role enforcement. Current live enforcement remains:

- fixed `memberships.role` for owner/admin/photographer behavior;
- active system `reviewer` role assignments at tenant/project scope for Feature 082 reviewer enforcement;
- SQL/RLS helpers and TypeScript services that explicitly preserve those boundaries.

Feature 083 should make reusable permission sets visible and manageable, while making it clear that definitions are not the same thing as assigned or enforced access.

## 2. Inputs reviewed

Required inputs were read in the requested order:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `UNCODEXIFY.md`
5. `docs/rpi/README.md`
6. `docs/rpi/SUMMARY.md`
7. `docs/rpi/080-advanced-organization-access-management-foundation/research.md`
8. `docs/rpi/080-advanced-organization-access-management-foundation/plan.md`
9. `docs/rpi/081-custom-role-definitions-and-scoped-role-assignment-foundation/research.md`
10. `docs/rpi/081-custom-role-definitions-and-scoped-role-assignment-foundation/plan.md`
11. `docs/rpi/082-project-scoped-reviewer-assignments-and-enforcement/research.md`
12. `docs/rpi/082-project-scoped-reviewer-assignments-and-enforcement/plan.md`

Live implementation and schema were then inspected as source of truth, especially:

- `src/lib/tenant/role-capabilities.ts`
- `src/lib/tenant/role-assignment-foundation.ts`
- `src/lib/tenant/reviewer-access-service.ts`
- `src/lib/tenant/permissions.ts`
- `src/lib/tenant/member-management-service.ts`
- `src/lib/tenant/member-management-route-utils.ts`
- `src/app/(protected)/members/page.tsx`
- `src/components/members/member-management-panel.tsx`
- `src/app/api/members/**`
- `src/app/(protected)/projects/page.tsx`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/components/projects/project-reviewer-access-panel.tsx`
- `src/app/api/projects/[projectId]/reviewer-access/**`
- `src/lib/projects/project-workspace-request.ts`
- `src/lib/projects/project-workflow-route-handlers.ts`
- `src/lib/project-releases/project-release-service.ts`
- `src/lib/media-library/media-library-folder-service.ts`
- `messages/en.json`
- `messages/nl.json`
- `supabase/migrations/20260423090000_070_tenant_rbac_membership_invites_foundation.sql`
- `supabase/migrations/20260430120000_081_role_assignment_foundation.sql`
- `supabase/migrations/20260430130000_082_reviewer_access_assignment_enforcement.sql`
- `tests/feature-080-role-capability-catalog.test.ts`
- `tests/feature-081-role-assignment-foundation.test.ts`
- `tests/feature-082-reviewer-access-assignments.test.ts`

`rg` is not installed in the local shell, so repository searches used PowerShell `Get-ChildItem` and `Select-String`.

## 3. Verified current role/capability foundation

Feature 081 is live. It created four tables:

- `capabilities`
- `role_definitions`
- `role_definition_capabilities`
- `role_assignments`

`capabilities` shape:

- `key text primary key`
- `created_at timestamptz not null default now()`
- non-blank key check

The seeded capability rows match `TENANT_CAPABILITIES` in `src/lib/tenant/role-capabilities.ts`.

`role_definitions` shape:

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid null`
- `slug text not null`
- `name text not null`
- `description text null`
- `is_system boolean not null default false`
- `system_role_key text null`
- `created_at`, `created_by`, `updated_at`, `updated_by`
- `archived_at`, `archived_by`

Important constraints:

- system rows must have `is_system = true`, `tenant_id is null`, non-null `system_role_key`, null actor fields, and no archive fields.
- tenant custom rows must have `is_system = false`, non-null `tenant_id`, null `system_role_key`, and non-null `created_by` and `updated_by`.
- `system_role_key` is limited to `owner`, `admin`, `reviewer`, `photographer`.
- active system slug/name are unique.
- active tenant role slug/name are unique per tenant using `lower(btrim(...))` partial unique indexes where `archived_at is null`.

This means tenant custom role rows are already structurally allowed. Archived names and slugs are reusable by schema because uniqueness only applies to active rows.

`role_definition_capabilities` shape:

- `role_definition_id uuid not null references role_definitions(id) on delete cascade`
- `capability_key text not null references capabilities(key) on delete restrict`
- `created_at timestamptz not null default now()`
- primary key `(role_definition_id, capability_key)`

The table supports empty role definitions because no database constraint requires at least one capability. Feature 083 should enforce a non-empty capability set in the service/API for active custom roles.

`role_assignments` shape:

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null`
- `user_id uuid not null`
- `role_definition_id uuid not null`
- `scope_type text not null` with `tenant`, `project`, or `workspace`
- `project_id uuid null`
- `workspace_id uuid null`
- `created_at`, `created_by`, `revoked_at`, `revoked_by`

Important constraints:

- assignments require an existing `(tenant_id, user_id)` membership and cascade on membership delete.
- project/workspace scopes are tenant-bound through composite foreign keys.
- scope shape checks prevent invalid tenant/project/workspace column combinations.
- active duplicate assignments are prevented per exact user/role/scope.
- a trigger prevents assignment to another tenant's custom role and blocks new active assignment to archived custom roles.

RLS on Feature 081 tables:

- `capabilities`: authenticated users can select all capability keys; no authenticated writes.
- `role_definitions`: authenticated users can select system roles; tenant custom roles are selectable only when `app.current_user_can_manage_members(tenant_id)` is true; no authenticated writes.
- `role_definition_capabilities`: authenticated users can select system mappings; tenant mappings are selectable only for tenant managers; no authenticated writes.
- `role_assignments`: tenant managers can select tenant assignment rows, and users can select their own assignment rows; no authenticated writes.

No normal authenticated insert/update/delete policies exist for these tables. This is important for Feature 083: browser/client writes must not write role tables directly. A server route should validate owner/admin authority and then use a server-only service-role client for mutations.

Seed behavior:

- system roles are seeded in `role_definitions` for `owner`, `admin`, `reviewer`, and `photographer`;
- all current capability keys are seeded;
- system role-capability mappings are seeded and drift-tested against `ROLE_CAPABILITIES`.

Current helper surfaces:

- `listCapabilities(supabase)`
- `listSystemRoleDefinitions(supabase)`
- `listRoleDefinitionsForTenant(supabase, tenantId)`
- `loadRoleDefinitionWithCapabilities(supabase, { tenantId, roleDefinitionId })`
- `listRoleAssignmentsForUser/Project/Workspace(...)`
- `resolveDurableRoleAssignments(...)`
- `assertRoleCapabilityCatalogMatchesDatabase(...)`

Reusable pieces for Feature 083:

- capability catalog constants and grouping metadata from `role-capabilities.ts`;
- database capability and system role seeds;
- role-definition read helpers and types;
- RLS read policies for owner/admin role display;
- active unique indexes for tenant custom role name/slug conflict handling;
- assignment constraints that already prevent new active assignment to archived custom roles.

Gaps for Feature 083:

- no custom role write service exists;
- no custom role mutation APIs exist;
- `listRoleDefinitionsForTenant(...)` currently returns tenant role rows without filtering archived roles, so the editor should either add a custom-role service wrapper or extend helpers with explicit active/archived filtering;
- no helper currently validates and replaces a custom role's full capability set;
- no UI exists for custom roles.

Current capability keys in `TENANT_CAPABILITIES`:

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

Current capability groups in `CAPABILITY_GROUPS`:

- `organizationUsers`: organization user management capabilities.
- `templatesProfiles`: template/profile view and management capabilities.
- `projectsWorkspaces`: project creation and workspace staffing capabilities.
- `capture`: workspace capture, invite/request creation, and asset upload.
- `review`: workspace review and consent upgrade initiation.
- `workflowCorrection`: finalization, correction, and correction intake/review.
- `mediaLibrary`: Media Library access and folder management.

Current fixed role mappings in `ROLE_CAPABILITIES`:

- `owner`: every current capability.
- `admin`: every current capability.
- `reviewer`: `profiles.view`, review capabilities, workflow/correction capabilities, and Media Library capabilities.
- `photographer`: `profiles.view` plus capture capabilities.

Current labels and UI display:

- `CAPABILITY_LABEL_KEYS` maps dot-separated capability keys to camelCase message keys.
- English and Dutch capability labels already exist under `members.capabilities.*`.
- English and Dutch capability group labels already exist under `members.capabilityGroups.*`.
- There are no capability descriptions today.
- `MemberManagementPanel` renders the fixed role reference by grouping each role's capabilities and displaying localized labels, not raw technical keys.

Current Feature 081 tests:

- `tests/feature-081-role-assignment-foundation.test.ts` verifies capability seed drift, system role definitions, system role mappings, role definition constraints, assignment scope constraints, cross-tenant guards, active assignment uniqueness, revocation, membership cleanup, helper reads, and the non-enforcement boundary for durable assignments that are not Feature 082 system reviewer grants.

## 4. Verified Feature 082 reviewer enforcement boundary

Feature 082 is live and enforcing, but only for active assignments of the system `reviewer` role.

SQL helpers in `20260430130000_082_reviewer_access_assignment_enforcement.sql` require:

- current membership role is fixed `reviewer`;
- active `role_assignments.revoked_at is null`;
- joined `role_definitions.is_system = true`;
- `role_definitions.system_role_key = 'reviewer'`;
- tenant-scope assignment for tenant-wide reviewer access, or project-scope assignment for project reviewer access.

Updated SQL helpers include:

- `app.current_user_has_tenant_wide_reviewer_access`
- `app.current_user_has_project_reviewer_access`
- `app.current_user_has_workspace_reviewer_access`
- `app.current_user_can_access_project`
- `app.current_user_can_access_project_workspace`
- `app.current_user_can_review_project`
- `app.current_user_can_review_project_workspace`
- `app.current_user_can_access_media_library`
- `app.current_user_can_manage_media_library`

TypeScript mirrors the same boundary:

- `src/lib/tenant/reviewer-access-service.ts` loads only the system reviewer role definition.
- `resolveEffectiveReviewerAccessForTenant/Project(...)` requires current fixed membership role `reviewer`.
- owner/admin keep fixed-role tenant-wide access.
- photographers keep assigned-workspace capture behavior.
- Media Library access is owner/admin or tenant-wide reviewer assignment only.

Important Feature 083 implication:

- custom roles with `review.workspace` or `media_library.access` will not grant reviewer/project/Media Library access in the current live implementation.
- assigning a custom role row, if a test or future API manually creates one, is not read by Feature 082 enforcement.
- Feature 083 tests should deliberately create a custom role with review capabilities and prove it does not grant review access.

## 5. Current UI/API surfaces involved

`/members` currently serves as the organization user management area. The page:

- redirects unauthenticated users;
- resolves active tenant server-side;
- calls `getTenantMemberManagementData(...)`;
- shows a read-only notice for non-owner/admin users;
- renders `MemberManagementPanel` for managers.

`MemberManagementPanel` currently includes:

- invite member form;
- fixed role reference table showing system roles and grouped capability labels;
- current members table with role editing/removal for non-owner rows;
- reviewer access column with tenant-wide reviewer grant/revoke controls;
- pending invites table.

Current member APIs:

- `GET /api/members`
- `POST /api/members/invites`
- `POST /api/members/invites/[inviteId]/resend`
- `POST /api/members/invites/[inviteId]/revoke`
- `PATCH /api/members/[userId]`
- `DELETE /api/members/[userId]`
- `GET /api/members/reviewer-access`
- `POST /api/members/[userId]/reviewer-access/tenant-wide`
- `DELETE /api/members/[userId]/reviewer-access/tenant-wide`

Current project reviewer APIs:

- `GET /api/projects/[projectId]/reviewer-access`
- `POST /api/projects/[projectId]/reviewer-access`
- `DELETE /api/projects/[projectId]/reviewer-access/[userId]`

`/projects/[projectId]` currently includes `ProjectReviewerAccessPanel` for owner/admin users near workspace/staffing controls. That is a useful UI pattern for Feature 083: simple forms, small tables, server-authoritative APIs, `router.refresh()` after mutation, and no broad access-management dashboard.

Protected navigation currently has `/members` but no `/access` or `/roles` route. The nav label is localized as `Organization users` / `Organisatiegebruikers`.

## 6. Options considered for UI placement

### Option A - Extend `/members` with a custom roles section

Pros:

- organization user management, fixed role descriptions, and reviewer access already live there;
- owner/admin users already expect access controls in this area;
- no new navigation item;
- smallest useful user-facing slice;
- matches current page/API conventions under `src/app/api/members/**`.

Cons:

- the page is already busy with invites, role reference, current members, reviewer access, and pending invites.
- the section must stay compact and avoid becoming an IAM console.

### Option B - Add dedicated `/access` or `/roles` page

Pros:

- cleaner long-term home if future features add custom role assignment, access review, and broader effective capability management.

Cons:

- broader product/navigation scope;
- risks implying custom roles are a fully enforced access-management system today;
- larger UI/i18n/test surface.

### Option C - Backend/API only

Pros:

- smallest engineering surface.

Cons:

- does not satisfy the user-facing custom role editor goal.

Recommendation: choose Option A. Add a "Custom roles" section to the existing Members/Organization Users area for Feature 083. Defer a dedicated access page until custom-role assignment and enforcement are broader.

Recommended section order:

1. Invite member
2. Role reference
3. Custom roles
4. Current members
5. Pending invites

This keeps definitions near fixed role reference, while current member assignment remains unchanged.

## 7. Options considered for custom role lifecycle

### Create active roles only

This matches the current schema and avoids adding a draft status. It should require a non-empty name and at least one capability.

### Add draft roles

Drafts would allow empty capability sets, but the current schema has only active versus archived. Adding draft state would require schema and UI complexity without clear first-slice value.

### Hard delete

Hard delete is not recommended. Role definitions may have historical assignments now or later, and deletion would make audit/debugging harder.

### Archive

Archive is already supported by `role_definitions.archived_at` and `archived_by`. It keeps the row and capability mappings while removing the role from active choices. This is the recommended lifecycle.

## 8. Recommended custom role create/edit/archive model

Recommended behavior:

- tenant custom roles have `slug`, `name`, and optional `description`.
- `slug` is generated server-side from the initial name.
- `slug` should not be manually editable in the UI.
- `slug` should be immutable after creation for stable references and predictable route/debug behavior.
- `name` and `description` can be edited.
- active custom role names and slugs are unique per tenant.
- archived custom role names/slugs can be reused because the existing indexes already allow that.
- create active custom roles only; no draft state in Feature 083.
- reject active custom roles with an empty capability set.
- archive instead of hard delete.
- archived roles keep their capability mappings.
- archived roles are hidden from active choices by default.
- archived roles may be shown in a collapsed/read-only "Archived roles" area only if it stays small.

Assignment-related lifecycle:

- Feature 083 should not create custom role assignments.
- If custom role assignment rows already exist because of test data or future work, editing a role definition should be understood as changing the reusable permission set. Since custom roles are not broadly enforced yet, this has no current live access effect.
- Archive should not delete or mutate assignment rows. Future effective-capability enforcement should explicitly ignore archived custom role assignments or revoke them in the assignment feature.
- The UI may show a read-only assignment count if the data is cheap to fetch, but assignment workflows should remain out of scope.

Validation:

- name: required, trimmed, normalized whitespace, reasonable max length such as 80 or 120 characters.
- description: optional, trimmed, max length such as 500 characters.
- capabilities: non-empty array of known capability keys.
- unknown capability key: `400 invalid_capability_key`.
- duplicate capability key in one payload: reject with `400 duplicate_capability_key` rather than silently accepting ambiguous client input.
- duplicate active name/slug: `409 role_name_conflict`.
- archive already archived role: idempotent `200 { changed: false }`.

## 9. Recommended system role display and immutability model

System roles are seeded global rows:

- `owner`
- `admin`
- `reviewer`
- `photographer`

They should be visible in the editor as read-only system roles.

Recommended UI:

- show system roles separately from custom roles or as a read-only subsection above custom roles;
- display system role names, descriptions, and grouped capabilities;
- do not render edit/archive controls for system roles;
- keep copy concise and factual.

Recommended API/service behavior:

- create routes never accept `is_system`, `system_role_key`, `tenant_id`, actor fields, or archive fields from the client.
- update/archive routes must reject system roles with `403 system_role_immutable` or `409 system_role_immutable`.
- update/archive routes must tenant-scope the role lookup before mutating.
- role capability update APIs must never mutate system role mappings.

Current database protection:

- authenticated users have no write RLS policies for `role_definitions` or `role_definition_capabilities`.
- system rows cannot be archived because the `role_definitions_shape_check` requires system rows to have null archive fields.
- service-role code can still update system role name/description or capability mappings if it is written incorrectly, so Feature 083 must enforce system immutability in the service and tests.

## 10. Recommended capability selection/editing model

Capability source of truth:

- keys come from `capabilities` table and `TENANT_CAPABILITIES`.
- group ordering comes from `CAPABILITY_GROUPS`.
- label key mapping comes from `CAPABILITY_LABEL_KEYS`.
- role-to-capability system mappings come from `ROLE_CAPABILITIES`.

Current labels:

- English and Dutch labels exist under `members.capabilities.*`.
- Group names exist under `members.capabilityGroups.*`.
- There are no per-capability descriptions today.

Recommended UI presentation:

- checkbox groups by `CAPABILITY_GROUPS`;
- group headers localized through existing message keys;
- primary text is localized label, not raw technical key;
- add short English and Dutch descriptions for capability selector rows if the plan phase decides the labels are too terse for safe editing;
- keep raw capability keys available only as secondary developer text if absolutely needed for debugging, not as primary UI.

High-impact capabilities:

- do not introduce a complicated danger scoring model in Feature 083.
- visually group management, review/correction, and Media Library capabilities clearly.
- the route/service should be the safety layer; UI warnings are secondary.

Mutation model:

- create route creates role definition and capability mappings in one server operation.
- update route replaces the full capability set rather than applying patches.
- capability keys are validated against both the database `capabilities` table and the TypeScript `TENANT_CAPABILITIES` set to catch drift.
- role metadata update and capability replacement should be transactional. If Supabase query builder cannot provide a transaction directly, add a small SQL RPC or use a service helper that performs delete/insert/update through a dedicated database function.
- update must be retry-safe enough: repeating the same full replacement should leave the same final capability set.
- mapping replacement should preserve `role_definition_capabilities.created_at` only for unchanged rows if using upsert, but preserving exact mapping timestamps is not critical in Feature 083 because the mapping table has no actor audit columns.

## 11. Recommended API/service boundary

Recommended service:

- `src/lib/tenant/custom-role-service.ts`

This service should be separate from:

- `permissions.ts`, because custom roles are not live authorization yet;
- `reviewer-access-service.ts`, because reviewer assignments are a product-specific enforcing slice;
- `role-assignment-foundation.ts`, because that module is currently read-helper/foundation oriented.

Recommended APIs under existing Members conventions:

- `GET /api/members/roles`
- `POST /api/members/roles`
- `GET /api/members/roles/[roleId]` (optional if list response is complete enough for edit forms)
- `PATCH /api/members/roles/[roleId]`
- `POST /api/members/roles/[roleId]/archive`

Why `/api/members/roles`:

- `/members` is the recommended UI placement.
- member/reviewer access APIs already live under `/api/members`.
- a dedicated `/api/access/roles` would imply a broader access-management product area.

Authorization:

- require authenticated user.
- derive active tenant through `requireAuthenticatedTenantContext()`.
- require owner/admin by checking `resolveTenantPermissions(...).canManageMembers`.
- never accept `tenant_id` from request bodies.
- use service-role client only after actor validation.

Recommended request/response shapes:

`GET /api/members/roles`

- manager-only.
- response includes capabilities, system roles, active custom roles, and optionally archived custom roles.
- recommended response:

```json
{
  "capabilities": [
    { "key": "review.workspace", "groupKey": "review", "labelKey": "reviewWorkspace" }
  ],
  "roles": [
    {
      "id": "uuid",
      "kind": "system",
      "slug": "owner",
      "name": "Owner",
      "description": "System owner role matching memberships.role = owner.",
      "archivedAt": null,
      "capabilityKeys": ["..."],
      "canEdit": false,
      "canArchive": false
    },
    {
      "id": "uuid",
      "kind": "custom",
      "slug": "media-library-manager",
      "name": "Media Library Manager",
      "description": null,
      "archivedAt": null,
      "capabilityKeys": ["media_library.access", "media_library.manage_folders"],
      "canEdit": true,
      "canArchive": true
    }
  ]
}
```

`POST /api/members/roles`

- body: `{ "name": string, "description"?: string | null, "capabilityKeys": string[] }`
- response: `201 { "role": ... }`
- duplicate retry behavior: if an active role with same normalized name/slug, same description, and same capability set already exists, returning `200 { role, created: false }` is acceptable; if details differ, return `409 role_name_conflict`.

`PATCH /api/members/roles/[roleId]`

- body: `{ "name": string, "description"?: string | null, "capabilityKeys": string[] }`
- full replacement for metadata and capability set.
- response: `200 { "role": ... }`
- reject system roles, archived roles, cross-tenant roles, unknown capabilities, duplicate capabilities, empty capability sets, and active name conflicts.

`POST /api/members/roles/[roleId]/archive`

- body: none.
- response: `200 { "role": ..., "changed": true | false }`
- reject system roles and cross-tenant roles.
- idempotent if already archived.

Error codes:

- `401 unauthenticated`
- `403 tenant_member_management_forbidden`
- `404 role_not_found`
- `400 invalid_body`
- `400 invalid_role_name`
- `400 invalid_capability_key`
- `400 duplicate_capability_key`
- `400 empty_capability_set`
- `409 role_name_conflict`
- `409 role_archived`
- `403 system_role_immutable`
- `500 role_definition_write_failed`

## 12. Recommended UI and i18n scope

Recommended UI:

- add a normal "Custom roles" section to `MemberManagementPanel`;
- list active custom roles in a compact table;
- show system roles read-only through the existing role reference or a nearby read-only system-role subsection;
- create/edit custom roles with a simple form, either inline in the section or in a standard modal;
- capability selector uses grouped checkboxes;
- archive action requires a confirmation;
- submit then `router.refresh()` is enough; optimistic updates are not needed.

Archived roles:

- hidden by default from active choices.
- if shown, show read-only in a compact archived list.
- no restore behavior in Feature 083 unless plan phase finds it essential.

Copy and i18n:

- add English and Dutch messages under the existing `members` namespace.
- likely groups:
  - `members.customRoles.*`
  - `members.customRoleForm.*`
  - `members.capabilityDescriptions.*` if descriptions are added.
- keep fixed role labels under `members.roles`.
- keep capability labels under `members.capabilities`.
- do not hardcode new UI copy in components.

UI style:

- follow `UNCODEXIFY.md`.
- use existing table/form/button styles.
- no hero, dashboard, matrix-heavy enterprise IAM layout, decorative panels, or new nav item.
- keep text concise.

Recommended clarification copy:

- include a short, factual note that custom roles define reusable permission sets and are not assigned in this screen.
- do not turn this into broad explanatory marketing copy.

## 13. Enforcement and assignment boundary

Feature 083 should not:

- assign custom roles to members;
- assign custom roles to projects or workspaces;
- add invite-to-custom-role behavior;
- replace fixed `memberships.role`;
- make custom role capabilities live authorization;
- add a generic effective-capability engine;
- change Feature 082 reviewer enforcement.

Current enforcement boundary to preserve:

- owner/admin fixed roles remain tenant-wide management roles.
- photographer fixed role remains assigned-workspace capture.
- reviewer fixed role is eligibility, and active system reviewer assignments grant tenant/project review access.
- SQL and TypeScript reviewer access helpers continue to require the system reviewer role definition, not any custom role containing `review.workspace`.

Tests should prove:

- a custom role with `review.workspace`, `workflow.finalize_project`, and `media_library.access` does not grant project review access;
- a custom role assigned through `role_assignments` to a reviewer or photographer does not affect Feature 082 unless it is the system reviewer role assignment already supported by Feature 082;
- project-scoped reviewer enforcement remains limited to active system reviewer role assignments.

## 14. Fresh reset and seed/dev data considerations

Feature 083 should assume local development can reset with:

```bash
supabase db reset
```

Recommended data policy:

- keep migrations clean and forward-only if any are needed.
- do not preserve arbitrary old local custom-role rows.
- do not backfill local custom role data.
- tests create the custom roles and role mappings they need.
- seed only system roles/capabilities by default, as Feature 081 already does.
- do not add sample custom roles unless the repo has an established representative dev seed pattern that benefits manual validation.

Production backfill:

- no production backfill is required for a custom role editor if there are no existing production custom roles.
- if production later has custom roles from internal scripts, compatibility should be handled as a separate rollout decision, not a local dev preservation effort.

## 15. Security and tenant-isolation risks

Risk: client-provided tenant id.

- Mitigation: routes derive tenant through `requireAuthenticatedTenantContext()` and ignore any tenant id in payloads.

Risk: non-manager creates or edits roles.

- Mitigation: validate `canManageMembers` before service-role writes; add route/service tests for non-manager denial.

Risk: cross-tenant role editing.

- Mitigation: lookup custom roles by `id`, `tenant_id = activeTenantId`, and `is_system = false` before mutation. Return `404 role_not_found` for missing/cross-tenant rows.

Risk: system role mutation.

- Mitigation: reject `is_system` role ids in service before any write; never expose controls in UI; test update/archive/mapping mutation attempts through APIs.

Risk: system role capability mapping mutation.

- Mitigation: role capability replacement helper must require `is_system = false` and matching `tenant_id`.

Risk: unknown capability keys.

- Mitigation: compare payload keys to database `capabilities` and TypeScript `TENANT_CAPABILITIES`; reject unknowns.

Risk: duplicate names/slugs.

- Mitigation: normalize names/slugs server-side and rely on existing active unique indexes; convert unique violations to `409 role_name_conflict`.

Risk: archived role edits.

- Mitigation: reject editing archived roles with `409 role_archived`; archive endpoint is idempotent.

Risk: roles with no capabilities.

- Mitigation: reject empty active custom roles in Feature 083 because there is no draft state.

Risk: dangerous capability combinations.

- Mitigation: owner/admin-only management; grouped selector; no assignment or enforcement in Feature 083; future assignment/enforcement features must reassess high-impact combinations.

Risk: custom review capabilities accidentally affect Feature 082.

- Mitigation: keep SQL/TS reviewer access checking system reviewer role only; add explicit tests.

Risk: partial capability writes.

- Mitigation: use an atomic RPC/transaction for metadata and mapping replacement, or a retry-safe full replacement sequence with conflict handling and verification.

Risk: service-role writes after insufficient validation.

- Mitigation: service-role client is created only inside server-only service functions after actor and tenant checks.

Risk: active tenant switching.

- Mitigation: all list/mutate routes derive active tenant at request time and refresh UI after writes.

## 16. Testing recommendations

Add a focused test file, for example:

- `tests/feature-083-custom-role-editor-foundation.test.ts`

Recommended coverage:

- owner/admin can list system roles and active custom roles.
- owner/admin can create a custom role with valid name, description, and capabilities.
- owner/admin can edit custom role name, description, and full capability set.
- owner/admin can archive a custom role.
- archived custom roles are absent from active list by default.
- archived custom role names/slugs can be reused if this remains the chosen behavior.
- non-manager cannot create/edit/archive custom roles.
- system roles cannot be edited, archived, or have mappings changed through custom role APIs.
- cross-tenant role access fails with not-found style behavior.
- duplicate active role names/slugs are rejected.
- unknown capability keys are rejected.
- duplicate capability keys are rejected.
- empty capability set is rejected.
- create duplicate retry with same normalized body is handled predictably, or returns conflict according to plan.
- update replacement is retry-safe and leaves exactly the requested capability set.
- archived role edit fails.
- no client-provided tenant id can redirect writes to another tenant.
- custom role with review capabilities does not grant project/review access.
- custom role with Media Library capabilities does not grant Media Library access.
- Feature 082 reviewer enforcement still only uses active system reviewer role assignments.
- `supabase db reset` creates only seeded system roles/capabilities, and tests create their own custom roles.

Regression tests to keep green:

- `tests/feature-080-role-capability-catalog.test.ts`
- `tests/feature-081-role-assignment-foundation.test.ts`
- `tests/feature-082-reviewer-access-assignments.test.ts`
- representative member-management tests in `tests/feature-070-tenant-rbac-foundation.test.ts`

UI/component tests:

- Custom roles section renders for manager data.
- System roles render read-only.
- Capability groups render localized labels.
- Create/edit form rejects empty capability selection in UI before submit, while API still enforces it.
- Archive confirmation path calls the archive API and refreshes.

## 17. Open questions for the plan phase

1. Should the list route include archived roles by default, or should archived roles require `?includeArchived=1`?
2. Should archived custom roles be visible at all in the first UI, or only hidden after archive?
3. Should create duplicate retries return the existing identical role or always return `409 role_name_conflict`?
4. Should capability descriptions be added in Feature 083, or are current capability labels clear enough when grouped?
5. Should slug immutability be enforced only by service code, or should a migration add a database trigger for tenant role slug immutability?
6. Should system role immutability rely on service tests, or should a database trigger prevent service-role mutation except seed migrations?
7. Should custom role archive be allowed when active assignment rows exist, or should the service block and show assignment counts? Current recommendation is allow archive and keep assignment rows non-enforcing.
8. Should a future `roles.manage` capability be introduced later, or should owner/admin via `organization_users.manage` remain the management authority for custom roles?
9. Should the role editor use a modal or an inline form in `MemberManagementPanel`? The recommended default is a simple inline create form plus edit modal only if the table becomes crowded.
10. Should tests use a small SQL RPC for transactional role writes, or is a service-role query sequence with verification enough?

## 18. Plan-phase recommendation

Plan Feature 083 as a small custom role definition editor:

- no new assignment workflow;
- no generic enforcement engine;
- no reviewer enforcement changes;
- no direct authenticated write RLS for role tables;
- owner/admin-only server routes under `/api/members/roles`;
- service-role mutations after server-side tenant/actor validation;
- system roles visible and immutable;
- custom roles create/edit/archive with full capability-set replacement;
- grouped localized capability selector on `/members`;
- tests proving custom roles are definitions only and do not grant live access.

The existing Feature 081 schema is sufficient for this first editor. Any plan-phase migration should be limited to a narrowly justified hardening trigger or transactional RPC, not new role model tables.
