# Feature 084 Research - Custom role assignment foundation

## 1. Title and scope

Feature 084 researches the first user-facing workflow for assigning tenant-local custom roles to existing tenant members.

The recommended slice is a bounded assignment foundation:

- owners/admins can view active custom role assignments on the Members / Organization Users page;
- owners/admins can assign active tenant custom roles to current tenant members;
- owners/admins can revoke those custom role assignments;
- writes use the existing Feature 081 `role_assignments` table;
- assignments remain visible, durable, and auditable, but custom role capabilities are not broadly enforced in this feature.

Out of scope for Feature 084:

- invite-to-custom-role;
- assigning custom roles during invite acceptance;
- project-scoped or workspace-scoped custom role assignment UI;
- generic effective capability resolution;
- broad SQL/RLS migration to custom role enforcement;
- changing Feature 082 system reviewer assignment enforcement;
- changing fixed owner/admin behavior;
- changing photographer workspace behavior;
- changing capture, review, Media Library, consent, matching, workflow, correction, or release behavior.

Current live code and migrations are authoritative. Prior RPI documents were used as architecture context only.

## 2. Inputs reviewed

Required inputs were read in order:

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
12. `docs/rpi/083-custom-role-editor-foundation/plan.md`

Live implementation and schema inspected:

- `supabase/migrations/20260430120000_081_role_assignment_foundation.sql`
- `supabase/migrations/20260430130000_082_reviewer_access_assignment_enforcement.sql`
- `supabase/migrations/20260430140000_083_custom_role_editor_functions.sql`
- `src/lib/tenant/role-assignment-foundation.ts`
- `src/lib/tenant/custom-role-service.ts`
- `src/lib/tenant/reviewer-access-service.ts`
- `src/lib/tenant/member-management-service.ts`
- `src/lib/tenant/member-management-route-utils.ts`
- `src/lib/tenant/permissions.ts`
- `src/lib/tenant/role-capabilities.ts`
- `src/app/(protected)/members/page.tsx`
- `src/components/members/member-management-panel.tsx`
- `src/components/members/custom-role-management-section.tsx`
- `src/app/api/members/**`
- `src/app/api/projects/[projectId]/reviewer-access/**`
- `src/lib/projects/project-workspace-request.ts`
- `src/lib/project-releases/project-release-service.ts`
- `messages/en.json`
- `messages/nl.json`
- `tests/feature-081-role-assignment-foundation.test.ts`
- `tests/feature-082-reviewer-access-assignments.test.ts`
- `tests/feature-083-custom-role-editor-foundation.test.ts`

`rg` is not installed in this local shell, so repository searches used PowerShell commands.

## 3. Verified current role assignment foundation

Feature 081 is live.

`role_assignments` currently has:

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null references tenants(id) on delete cascade`
- `user_id uuid not null`
- `role_definition_id uuid not null references role_definitions(id) on delete restrict`
- `scope_type text not null check in ('tenant', 'project', 'workspace')`
- `project_id uuid null`
- `workspace_id uuid null`
- `created_at timestamptz not null default now()`
- `created_by uuid null references auth.users(id) on delete restrict`
- `revoked_at timestamptz null`
- `revoked_by uuid null references auth.users(id) on delete restrict`

Current active/revoked semantics:

- active rows have `revoked_at is null` and `revoked_by is null`;
- revoked rows have both `revoked_at` and `revoked_by`;
- the database check enforces both revoke fields being null or both non-null;
- revocation is represented by update, not delete.

Current active uniqueness:

- tenant scope unique active assignment: `(tenant_id, user_id, role_definition_id)` where `scope_type = 'tenant' and revoked_at is null`;
- project scope unique active assignment: `(tenant_id, user_id, role_definition_id, project_id)` where `scope_type = 'project' and revoked_at is null`;
- workspace scope unique active assignment: `(tenant_id, user_id, role_definition_id, project_id, workspace_id)` where `scope_type = 'workspace' and revoked_at is null`.

Scope shape constraints:

- tenant scope requires `project_id is null` and `workspace_id is null`;
- project scope requires `project_id is not null` and `workspace_id is null`;
- workspace scope requires both `project_id` and `workspace_id`.

Tenant/project/workspace guards:

- assignments require an existing `(tenant_id, user_id)` membership through `role_assignments_membership_fk`;
- membership deletion cascades assignment rows;
- project assignments use `(project_id, tenant_id)` FK to `projects`;
- workspace assignments use `(workspace_id, tenant_id, project_id)` FK to `project_workspaces`;
- workspace assignments cannot point to a workspace under a different project.

Role-definition guard behavior:

- `app.assert_role_assignment_role_definition_scope()` runs before insert/update on `role_assignments`;
- system role definitions are allowed only as global system rows;
- tenant custom role definitions must have `role_definitions.tenant_id = role_assignments.tenant_id`;
- active assignment to an archived tenant custom role is blocked;
- the trigger does not revoke assignments when a role is archived later.

RLS and grants:

- authenticated users can select `role_assignments`;
- tenant managers can read tenant assignment rows;
- users can read their own assignment rows;
- there are no authenticated insert/update/delete policies for `role_assignments`;
- server-side writes therefore need service-role access after explicit authorization.

Current helper functions:

- `listRoleAssignmentsForUser(...)`
- `listRoleAssignmentsForProject(...)`
- `listRoleAssignmentsForWorkspace(...)`
- `resolveDurableRoleAssignments(...)`
- `loadRoleDefinitionWithCapabilities(...)`

Important helper limitation:

- `resolveDurableRoleAssignments(...)` returns active tenant/project/workspace assignments with role definitions and capability keys, but it is explicitly documented as non-enforcing.

Current tests cover:

- seeded capabilities and system mappings;
- role definition shape constraints;
- assignment scope constraints;
- cross-tenant project/workspace guards;
- membership-required assignments;
- duplicate active assignment prevention;
- revoke plus re-add behavior;
- membership deletion cascade;
- durable assignment non-enforcement for non-Feature-082 cases.

Reusable for Feature 084:

- use `role_assignments` directly for durable custom role assignments;
- use tenant scope only: `scope_type = 'tenant'`, `project_id = null`, `workspace_id = null`;
- rely on the active unique index for duplicate active protection;
- rely on membership FK for current-member requirement and removal cleanup;
- rely on the trigger to reject archived roles and cross-tenant custom roles;
- keep authenticated direct writes disabled.

## 4. Verified current custom role editor state

Feature 083 is live.

Current custom role service:

- `src/lib/tenant/custom-role-service.ts`;
- owner/admin-only through `resolveTenantPermissions(...).canManageMembers`;
- routes derive active tenant through `requireAuthenticatedTenantContext()`;
- service creates a Supabase service-role client only after actor validation;
- mutation calls use service-role-only RPCs.

Current custom role APIs:

- `GET /api/members/roles`
- `POST /api/members/roles`
- `PATCH /api/members/roles/[roleId]`
- `POST /api/members/roles/[roleId]/archive`

Current listing behavior:

- `listRoleEditorData(...)` returns `capabilities`, `systemRoles`, and `customRoles`;
- custom roles are active-only by default;
- `GET /api/members/roles?includeArchived=1` can include archived custom roles;
- `RoleEditorRole.kind` is `"system"` or `"custom"`;
- `canEdit` and `canArchive` are false for system roles and archived custom roles.

Current custom role lifecycle:

- custom roles are tenant-local `role_definitions` rows with `is_system = false`;
- system roles are global `role_definitions` rows with `is_system = true` and `system_role_key`;
- active custom role name/slug uniqueness is enforced per tenant;
- archived custom role names/slugs can be reused;
- active custom roles require at least one known capability at service/API level;
- archive sets `archived_at`, `archived_by`, `updated_at`, and `updated_by`;
- archive does not delete capability mappings or assignment rows.

Capability mappings:

- mappings live in `role_definition_capabilities`;
- create/update replaces the full capability set through RPCs;
- validation compares requested keys against both database `capabilities` and TypeScript `TENANT_CAPABILITIES`;
- capability grouping and labels come from `CAPABILITY_GROUPS`, `CAPABILITY_LABEL_KEYS`, and `members.capabilities.*`.

Current Members page custom role UI:

- `/members` loads `getTenantMemberManagementData(...)`;
- `MemberManagementPanel` renders invite form, role reference, custom role management, current members, and pending invites;
- `CustomRoleManagementSection` lists active custom roles, creates/edits roles with grouped checkboxes, and archives roles;
- the section explicitly says custom roles are definitions only and are not assigned there.

Reusable for Feature 084:

- reuse `RoleEditorRole`/custom role data shape or add a lightweight assignable-role summary derived from the same service;
- assign dropdown should use active custom roles only;
- do not show system roles as assignable in the custom-role assignment workflow;
- reuse capability labels only for role detail/summary if needed, not as the primary assignment UI.

Gap for Feature 084:

- no custom role assignment service exists;
- no custom role assignment APIs exist;
- Members table does not show assigned custom roles;
- no assignment UI exists for active custom roles.

## 5. Verified Feature 082 reviewer enforcement boundary

Feature 082 is live and deliberately narrow.

SQL enforcement requires:

- current fixed membership role is `reviewer`;
- an active `role_assignments` row exists;
- joined `role_definitions.is_system = true`;
- `role_definitions.system_role_key = 'reviewer'`;
- tenant-scope assignment for tenant-wide reviewer access, or project-scope assignment for project reviewer access.

Relevant SQL helpers:

- `app.current_user_has_tenant_wide_reviewer_access`
- `app.current_user_has_project_reviewer_access`
- `app.current_user_has_workspace_reviewer_access`
- `app.current_user_can_access_project`
- `app.current_user_can_access_project_workspace`
- `app.current_user_can_review_project`
- `app.current_user_can_review_project_workspace`
- `app.current_user_can_access_media_library`
- `app.current_user_can_manage_media_library`

TypeScript enforcement mirrors SQL:

- `reviewer-access-service.ts` only loads the system reviewer role definition;
- `resolveEffectiveReviewerAccessForTenant/Project(...)` require fixed membership role `reviewer`;
- `permissions.ts` makes owner/admin fixed roles tenant-wide;
- photographer behavior remains workspace-assignment based;
- Media Library access is owner/admin or tenant-wide system reviewer assignment only.

Reviewer assignment writes:

- owner/admin-only through `assertTenantMemberManager`;
- target user must be a fixed `reviewer` member;
- tenant-wide grants use tenant-scope system reviewer assignment rows;
- project grants use project-scope system reviewer assignment rows;
- duplicate grant returns the existing active assignment;
- revoke sets `revoked_at` and `revoked_by`;
- revoke is idempotent;
- re-add after revoke creates a new active row;
- role changes away from reviewer call `revokeActiveReviewerAssignmentsForMember(...)`.

Members page reviewer display:

- current members table has a Reviewer access column;
- reviewer rows show tenant-wide state and project grant count;
- owner/admins can grant/revoke tenant-wide reviewer access inline.

Recommendation for Feature 084:

- mirror the service pattern, not the enforcement pattern;
- add a domain-specific `custom-role-assignment-service.ts`;
- use the same owner/admin authorization, active tenant derivation, service-role writes, idempotent grant/revoke, and re-add semantics;
- do not modify Feature 082 SQL or TypeScript enforcement.

## 6. Current UI/API surfaces involved

Current Members APIs:

- `GET /api/members`
- `POST /api/members/invites`
- `POST /api/members/invites/[inviteId]/resend`
- `POST /api/members/invites/[inviteId]/revoke`
- `PATCH /api/members/[userId]`
- `DELETE /api/members/[userId]`
- `GET /api/members/reviewer-access`
- `POST /api/members/[userId]/reviewer-access/tenant-wide`
- `DELETE /api/members/[userId]/reviewer-access/tenant-wide`
- `GET /api/members/roles`
- `POST /api/members/roles`
- `PATCH /api/members/roles/[roleId]`
- `POST /api/members/roles/[roleId]/archive`

Current route conventions:

- route handlers call `requireAuthenticatedTenantContext()`;
- request bodies are parsed defensively;
- services throw `HttpError`;
- routes return `jsonError(error)` on failures;
- mutation routes use server-derived tenant and user ids.

Current Members page:

- manager-only for mutation surfaces;
- read-only message for non-managers;
- normal tables/forms/buttons;
- no dedicated access-management page;
- all user-facing text goes through `messages/en.json` and `messages/nl.json`.

Feature 084 should extend this page rather than introduce a new navigation area.

## 7. Options considered for assignment scope

### Option A - Tenant-scoped custom role assignments only

Assign custom roles to members at tenant scope.

Implementation size:

- small;
- one service and a few member routes;
- no project/workspace picker or project page changes required.

UI complexity:

- low;
- member row can show assigned custom role labels and inline assign/revoke controls.

Tenant isolation:

- strongest fit for current Members page;
- `tenant_id` is server-derived and already required by schema;
- member and role validation are straightforward.

Compatibility with Feature 081:

- uses tenant-scope rows exactly as designed;
- relies on current active uniqueness and membership cascade.

Compatibility with future enforcement:

- good foundation for future tenant-wide enforcement slices;
- project/workspace assignment can be added later without changing this slice.

Risk of implying access:

- moderate because capabilities are visible, but manageable with concise copy that custom role enforcement is not broad yet.

Test scope:

- focused service/API/UI tests plus non-enforcement regressions.

Fit with small-slice discipline:

- best fit.

### Option B - Tenant and project-scoped custom role assignments

Assign custom roles to members either tenant-wide or for specific projects.

Implementation size:

- medium to large;
- needs project selection, project validation, assignment summaries by project, and likely project-detail UI.

UI complexity:

- higher;
- Members page becomes a scoped access manager;
- project assignment UX could overlap with Feature 082 project reviewer grants.

Tenant isolation:

- feasible through existing composite FKs;
- more route and error surfaces.

Compatibility with Feature 081:

- good at table level.

Compatibility with future enforcement:

- potentially useful, but future project capability semantics are not designed yet.

Risk of implying access:

- high, because project-scoped custom roles would look like live project access while no generic enforcement exists.

Test scope:

- significantly broader.

Fit with small-slice discipline:

- not a good first assignment slice.

### Option C - Tenant, project, and workspace-scoped custom role assignments

Use the full Feature 081 table shape for all custom role scopes.

Implementation size:

- large;
- needs project and workspace selectors, summaries, validation, and likely multiple UI locations.

UI complexity:

- high;
- easily becomes an enterprise IAM matrix.

Tenant isolation:

- schema supports it, but service/UI risk rises.

Compatibility with future enforcement:

- broadest representation, but future semantics are not ready.

Risk of implying access:

- very high.

Test scope:

- too broad for Feature 084.

Fit with small-slice discipline:

- poor.

### Option D - Assign custom roles and enforce one area immediately

Add assignment UI and migrate one permission area to custom role enforcement in the same feature.

Implementation size:

- large;
- requires assignment, enforcement, SQL/RLS parity, UI, and regression tests.

UI complexity:

- medium.

Tenant isolation:

- depends on the selected enforcement area.

Compatibility with Feature 081:

- possible.

Compatibility with future enforcement:

- useful if the area is carefully chosen.

Risk of implying access:

- lower for the enforced area, higher for all other selected capabilities.

Test scope:

- large because assignment and enforcement failures can drift.

Fit with small-slice discipline:

- better as Feature 085 after assignment behavior is stable.

Recommendation:

- choose Option A for Feature 084;
- defer project/workspace custom role assignment;
- defer enforcement to a later bounded feature.

## 8. Recommended custom role assignment model

Use tenant-scope custom role assignments only.

Representation:

- `role_assignments.scope_type = 'tenant'`;
- `project_id = null`;
- `workspace_id = null`;
- `role_definition_id` points to a tenant custom role where `is_system = false`;
- `tenant_id` is the server-derived active tenant;
- `user_id` is an existing tenant member;
- `created_by` is the authenticated owner/admin actor;
- revoke uses `revoked_at` and `revoked_by`.

Assignable roles:

- active tenant custom roles only;
- exclude archived custom roles;
- exclude all system roles;
- role must belong to the active tenant.

Assignable members:

- current tenant members only;
- allow assignment to current owner/admin/reviewer/photographer members unless plan phase chooses to exclude owner for UI clarity;
- do not create memberships or invites from this workflow.

Multiple roles:

- allow multiple different custom roles per member;
- prevent duplicate active exact member/role tenant-scope rows through existing index;
- service should treat duplicate active create as idempotent and return the existing assignment.

## 9. Recommended lifecycle and revocation behavior

Create behavior:

- validate actor owner/admin through `canManageMembers`;
- validate target member in active tenant;
- validate role is active, tenant-local, `is_system = false`, and same tenant;
- insert tenant-scope assignment with `created_by`;
- if an equivalent active assignment already exists, return it with `created: false`;
- if a uniqueness race occurs, re-read active assignment and return it.

Revoke behavior:

- validate actor owner/admin;
- validate target member in active tenant;
- validate role id is a tenant custom role in the active tenant;
- update active assignment with `revoked_at = now` and `revoked_by = actor`;
- if no active row exists for a valid member/role, return `revoked: false`;
- do not hard delete on revoke.

Re-add behavior:

- after revoke, a new create should insert a new active row;
- historical revoked rows remain for audit.

Member removal:

- existing `(tenant_id, user_id)` FK cascades assignment rows when membership is deleted;
- this means removal deletes assignment rows instead of soft-revoking them;
- Feature 084 should rely on this current Feature 081 behavior rather than add a separate cleanup path.

Fixed role changes:

- custom role assignments should remain independent of fixed role changes;
- only Feature 082 system reviewer assignments are revoked when a reviewer changes away from reviewer;
- changing `memberships.role` should not delete or revoke custom role assignments.

Role edits:

- editing a custom role should affect the definition displayed for existing assignments;
- because custom roles are not broadly enforcing in Feature 084, edits do not grant live access.

Role archive:

- archive should remain allowed;
- new assignments to archived roles are blocked by the Feature 081 trigger;
- existing active assignment rows to a role that is archived later are not automatically revoked today;
- Feature 084 should not add automatic archive-time revocation unless the plan phase decides UI clarity requires it;
- the safer recommendation is to display such assignments as archived/inactive and make future enforcement ignore archived role definitions.

## 10. Recommended relationship to live enforcement

Feature 084 must avoid accidental enforcement.

Answers to the key enforcement questions:

- A member with an active custom role assignment containing `review.workspace` should not gain review access in Feature 084.
- A member with an active custom role assignment containing `media_library.access` should not gain Media Library access.
- A member with an active custom role assignment containing `capture.upload_assets` should not gain capture/upload access.
- Current SQL helpers should not be changed to read custom role assignments.
- Current TypeScript permission helpers should not be changed to read custom role assignments.
- Feature 082 reviewer checks should continue to require active assignments of the system `reviewer` role, not custom roles.
- Members UI should label these as assigned custom roles / reusable permission sets, not as complete live access grants.

Current enforcement remains:

- owner/admin fixed-role tenant-wide management;
- photographer fixed role plus assigned workspace for capture;
- Feature 082 active system reviewer tenant/project assignments for reviewer access;
- Media Library owner/admin or tenant-wide system reviewer assignment only.

Feature 084 tests must prove custom role assignments do not grant:

- review access;
- capture/upload access;
- Media Library access;
- member management;
- project creation;
- workspace staffing;
- Feature 082 reviewer access unless the assignment is the system reviewer role, which this new custom-role workflow must reject.

## 11. Recommended API/service boundary

Add a new domain-specific service:

- `src/lib/tenant/custom-role-assignment-service.ts`

Recommended exported functions:

- `listAssignableCustomRoles(input)`
- `listCustomRoleAssignmentsForMembers(input)`
- `grantCustomRoleToMember(input)`
- `revokeCustomRoleFromMember(input)`
- `resolveCustomRoleAssignmentSummary(input)`

Recommended assignment summary shape:

```ts
type CustomRoleAssignmentSummary = {
  userId: string;
  activeAssignments: Array<{
    assignmentId: string;
    roleId: string;
    roleName: string;
    roleSlug: string;
    archivedAt: string | null;
    grantedAt: string;
    grantedBy: string | null;
    capabilityKeys: TenantCapability[];
  }>;
};
```

Recommended assignable role shape:

```ts
type AssignableCustomRole = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  capabilityKeys: TenantCapability[];
};
```

Service authorization:

- require authenticated user;
- route derives active tenant via `requireAuthenticatedTenantContext()`;
- write and manager listing require `resolveTenantPermissions(...).canManageMembers`;
- use service-role writes after actor/member/role validation;
- do not add authenticated write RLS policies.

Recommended routes:

- `GET /api/members/custom-role-assignments`
- `POST /api/members/[userId]/custom-roles`
- `DELETE /api/members/[userId]/custom-roles/[roleId]`

Why these names:

- `GET /api/members/roles` is already role-definition editor data;
- `custom-role-assignments` makes the list endpoint explicit;
- member-scoped POST/DELETE mirrors the row-level action and avoids overloading system fixed-role routes;
- route names clearly separate custom role assignment from Feature 082 reviewer access.

Alternative route names:

- `GET /api/members/roles/assignments`
- `POST /api/members/[userId]/roles`
- `DELETE /api/members/[userId]/roles/[roleId]`

These are shorter but less clear because `/api/members/roles` already means role definitions and could be mistaken for fixed role changes. Prefer explicit `custom-roles`.

### `GET /api/members/custom-role-assignments`

Auth:

- authenticated owner/admin only.

Response:

```json
{
  "assignableRoles": [
    {
      "id": "uuid",
      "name": "Project Lead",
      "slug": "project-lead",
      "description": null,
      "capabilityKeys": ["review.workspace"]
    }
  ],
  "memberAssignments": [
    {
      "userId": "uuid",
      "activeAssignments": [
        {
          "assignmentId": "uuid",
          "roleId": "uuid",
          "roleName": "Project Lead",
          "roleSlug": "project-lead",
          "archivedAt": null,
          "grantedAt": "iso",
          "grantedBy": "uuid",
          "capabilityKeys": ["review.workspace"]
        }
      ]
    }
  ]
}
```

Include only active assignment rows by default. If assignments to archived roles can exist, include them in active summaries with `archivedAt` set so the UI can mark them archived/inactive; do not include revoked history in the first UI.

### `POST /api/members/[userId]/custom-roles`

Auth:

- authenticated owner/admin only.

Body:

```json
{ "roleId": "uuid" }
```

Validation:

- target member must exist in active tenant;
- role must be an active custom role in active tenant;
- role must not be system;
- role must not be archived;
- ignore any client-provided tenant id.

Responses:

- `201 { "assignment": ..., "created": true }` when inserted;
- `200 { "assignment": ..., "created": false }` when already active.

Errors:

- `401 unauthenticated`;
- `403 tenant_member_management_forbidden`;
- `400 invalid_body`;
- `404 member_not_found`;
- `404 custom_role_not_found`;
- `409 custom_role_archived`;
- `403 system_role_assignment_forbidden`;
- `409 custom_role_assignment_conflict` only if uniqueness race cannot be resolved by re-read.

### `DELETE /api/members/[userId]/custom-roles/[roleId]`

Auth:

- authenticated owner/admin only.

Validation:

- target member must exist in active tenant;
- role id must refer to a tenant custom role in active tenant, even if archived;
- system role ids rejected;
- no active assignment is not an error.

Response:

```json
{ "ok": true, "revoked": true }
```

If no active row exists after valid member/role lookup:

```json
{ "ok": true, "revoked": false }
```

## 12. Recommended UI/i18n scope

Minimal Members page UI:

- add an Assigned custom roles column or compact row detail in the current members table;
- show active custom role assignments as simple text labels/chips;
- allow owner/admin to assign an active custom role from a select/dropdown per member;
- allow owner/admin to revoke an assignment inline;
- show only active custom roles in the assign dropdown;
- do not show full assignment history;
- show archived assigned roles only if existing rows require it, marked as archived/inactive;
- keep custom role creation in the existing Custom roles section from Feature 083.

Empty states:

- if no active custom roles exist, show a compact message near assignment controls and point to the existing Custom roles section;
- do not disable the entire Members page.

Clarification copy:

- keep one short note near assignment controls that assigned custom roles are durable labels/permission sets and broader enforcement will expand later;
- avoid a long explanatory access-management panel.

Recommended i18n keys:

- `members.customRoleAssignments.column`
- `members.customRoleAssignments.title`
- `members.customRoleAssignments.assignRole`
- `members.customRoleAssignments.assignedRoles`
- `members.customRoleAssignments.noAssignedRoles`
- `members.customRoleAssignments.noAssignableRoles`
- `members.customRoleAssignments.createRoleFirst`
- `members.customRoleAssignments.remove`
- `members.customRoleAssignments.removeConfirm`
- `members.customRoleAssignments.assigned`
- `members.customRoleAssignments.revoked`
- `members.customRoleAssignments.note`
- `members.customRoleAssignments.archivedAssignedRole`
- `members.customRoleAssignments.errors.fallback`
- `members.customRoleAssignments.errors.roleArchived`
- `members.customRoleAssignments.errors.systemRoleForbidden`

Suggested English copy:

- Column: `Custom roles`
- Assign button: `Assign role`
- Remove action: `Remove`
- Empty assigned state: `No custom roles assigned`
- No roles available: `No active custom roles`
- Create first: `Create a custom role first.`
- Note: `Custom role assignments are stored for members. Broad capability enforcement is not enabled yet.`
- Archived warning: `Archived role`

Suggested Dutch copy:

- Column: `Aangepaste rollen`
- Assign button: `Rol toewijzen`
- Remove action: `Verwijderen`
- Empty assigned state: `Geen aangepaste rollen toegewezen`
- No roles available: `Geen actieve aangepaste rollen`
- Create first: `Maak eerst een aangepaste rol.`
- Note: `Aangepaste roltoewijzingen worden opgeslagen voor leden. Brede permissiehandhaving staat nog niet aan.`
- Archived warning: `Gearchiveerde rol`

UI style:

- follow existing `MemberManagementPanel` table/form/button style;
- no new navigation area;
- no dashboard, matrix, hero, or decorative access console;
- no nested card-heavy redesign.

## 13. Role change and member removal considerations

Member removal:

- current `removeTenantMember(...)` deletes the `memberships` row;
- Feature 081 FK cascades `role_assignments`;
- custom role assignments are therefore removed with membership deletion.

Fixed role changes:

- `updateTenantMemberRole(...)` currently revokes active Feature 082 system reviewer assignments when changing away from reviewer;
- custom role assignments should remain independent of fixed role changes;
- do not revoke custom role assignments when a reviewer becomes admin/photographer, or when a photographer becomes reviewer.

Owner/admin assignment:

- owner/admin can be assigned custom roles, but the UI should avoid implying the custom role changes owner/admin fixed privileges;
- plan phase can decide whether to suppress assignment controls for owner rows to preserve owner immutability clarity;
- from a schema and service standpoint, assignment to owners is safe because custom roles are not enforcement.

Reviewer/photographer assignment:

- allow custom role assignment to reviewers and photographers;
- assigned custom role should not change reviewer eligibility or photographer capture scope in Feature 084.

Recommended default:

- allow assignment to any current tenant member, including owner, admin, reviewer, and photographer;
- keep owner fixed role immutable and non-removable as today;
- do not add fixed-role cleanup for custom role assignments.

## 14. Archived role assignment considerations

Current facts:

- Feature 081 trigger blocks new active assignments to archived custom roles;
- Feature 083 archive does not revoke existing assignment rows;
- existing active assignment rows can therefore point to a role that later becomes archived.

Recommended Feature 084 behavior:

- assign endpoint rejects archived custom roles;
- assign dropdown lists active custom roles only;
- archive remains allowed even when active assignments exist;
- assignment list can include active rows whose role is archived, but mark them as archived/inactive;
- revoke remains possible for archived assigned roles;
- do not add restore behavior;
- do not automatically revoke active assignments on archive in Feature 084 unless the plan phase chooses a stronger cleanup model.

Future enforcement rule:

- any later custom-role enforcement must explicitly ignore archived role definitions even if an assignment row still has `revoked_at is null`.

## 15. Fresh reset and seed/dev data considerations

Development should assume:

```bash
supabase db reset
```

Recommended data policy:

- do not preserve old local custom role assignment rows;
- no local backfill is needed;
- no production backfill is required for this assignment foundation unless requested later;
- tests create custom roles and assignments explicitly;
- seed/dev data does not need sample custom role assignments unless the repo later adds representative access-management seed scenarios.

This fits the current local development policy and avoids compatibility layers for arbitrary old local state.

## 16. Security and tenant-isolation risks

Risk: assigning a role across tenants.

- Mitigation: route derives tenant server-side; service looks up role by `id`, `tenant_id = activeTenantId`, and `is_system = false`; Feature 081 trigger also rejects cross-tenant role definitions.

Risk: assigning to a non-member.

- Mitigation: service validates target membership in active tenant; database membership FK also rejects it.

Risk: assigning archived roles.

- Mitigation: service rejects `archived_at is not null`; database trigger rejects active assignment to archived tenant roles.

Risk: assigning system roles through the custom role API.

- Mitigation: service requires `is_system = false`; reject system role ids with `403 system_role_assignment_forbidden`; do not reuse reviewer-access routes.

Risk: client-provided tenant id.

- Mitigation: ignore tenant ids in payloads; all routes use `requireAuthenticatedTenantContext()`.

Risk: service-role writes after insufficient validation.

- Mitigation: create service-role client only after actor/member/role validation; keep RPC or query-builder writes in a server-only service.

Risk: duplicate active assignments.

- Mitigation: existing partial unique index plus service idempotent re-read on uniqueness race.

Risk: stale revoked assignments.

- Mitigation: list and enforcement-related future code must require `revoked_at is null`; revoke must update only active rows.

Risk: fixed role changes.

- Mitigation: custom assignments remain independent; enforcement remains fixed-role plus Feature 082 only.

Risk: member removal cleanup.

- Mitigation: existing membership FK cascades rows; tests should prove this with custom roles.

Risk: custom role assignment accidentally granting live access.

- Mitigation: do not import custom role assignment resolver into `permissions.ts`, SQL helpers, project workspace helpers, or Media Library services; add non-enforcement tests.

Risk: Feature 082 reviewer enforcement accidentally reading custom roles.

- Mitigation: keep system reviewer checks requiring `rd.is_system` and `system_role_key = 'reviewer'`; add regression tests assigning a custom role with `review.workspace`.

Risk: active tenant switching.

- Mitigation: all reads/writes derive tenant at request time; UI refreshes after mutations.

Risk: UI showing assignments from another tenant.

- Mitigation: list endpoint filters by active tenant; role/member joins include tenant filters; tests create two tenants.

## 17. Testing recommendations

Add a focused test file, likely:

- `tests/feature-084-custom-role-assignment-foundation.test.ts`

Recommended service/API tests:

- owner/admin can list assignable custom roles and member assignment summaries;
- owner/admin can assign an active custom role to a member;
- owner/admin can revoke a custom role assignment;
- non-manager cannot assign/revoke;
- cannot assign system role through custom role assignment API;
- cannot assign archived custom role;
- cannot assign role from another tenant;
- cannot assign to member from another tenant;
- duplicate active assignment create is idempotent;
- revocation is idempotent;
- re-add after revoke creates a new active row;
- multiple different custom roles can be assigned to the same member;
- member removal cleans custom role assignments through cascade;
- fixed role change does not delete custom role assignments;
- archived assigned role can still be listed/revoked if a role is archived after assignment.

Recommended non-enforcement tests:

- custom role with `review.workspace` does not grant project/workspace review access;
- custom role with `capture.upload_assets` does not grant capture/upload access;
- custom role with `media_library.access` does not grant Media Library access;
- custom role with `organization_users.manage` does not grant member management;
- custom role with `projects.create` does not grant project creation;
- custom role with `project_workspaces.manage` does not grant workspace staffing;
- Feature 082 tenant/project system reviewer assignment still works;
- Feature 082 still ignores custom roles even when they contain reviewer-like capabilities.

Recommended UI/component tests:

- Members UI displays assigned custom role labels;
- assignment dropdown contains active custom roles only;
- archived roles do not appear in assign options;
- assign action calls the member custom-role route and refreshes;
- revoke action calls the member custom-role route and refreshes;
- no full assignment history UI renders;
- no custom role assignment controls render for non-manager read-only page.

Recommended reset validation:

- `supabase db reset` produces clean system roles/capabilities and no sample custom role assignments;
- tests create all custom roles and custom role assignments they need.

Regression tests to keep green:

- `tests/feature-081-role-assignment-foundation.test.ts`
- `tests/feature-082-reviewer-access-assignments.test.ts`
- `tests/feature-083-custom-role-editor-foundation.test.ts`
- representative member-management tests in `tests/feature-070-tenant-rbac-foundation.test.ts`

## 18. Open questions for the plan phase

1. Should assignment controls appear for owner rows, or should owners be display-only to preserve current owner immutability clarity?
2. Should archived active assignments be shown in the main member row, or only in a warning/detail area?
3. Should archiving a custom role automatically revoke active custom role assignments, or should archive remain definition-only with assignments displayed as archived/inactive?
4. Should the list endpoint include revoked assignment history for audit/debugging, or should history stay out of the first UI?
5. Should custom role assignment writes use direct service-role query-builder calls, or a narrow SQL RPC for grant/revoke idempotency?
6. Should assignment summary include capability keys for each role, or keep capability details in the existing Custom roles section only?
7. Should the UI support assigning multiple roles in one submit, or one role at a time for simpler retry/idempotency behavior?
8. Should `GET /api/members` include custom role assignments directly, or should the UI call a separate `GET /api/members/custom-role-assignments` endpoint?
9. Should the service expose revoked rows for tests only, or should tests inspect the database directly?
10. What exact copy should be used to avoid implying that assigned custom roles already enforce every selected capability?

## 19. Plan-phase recommendation

Plan Feature 084 as tenant-scoped custom role assignment only.

Implement:

- `src/lib/tenant/custom-role-assignment-service.ts`;
- owner/admin-only list/grant/revoke APIs under Members;
- Members page display and inline assign/revoke controls;
- English and Dutch messages under `members.customRoleAssignments.*`;
- tests for tenant isolation, lifecycle, idempotency, member removal, fixed-role independence, archived-role behavior, and non-enforcement.

Do not implement:

- project/workspace custom role assignment;
- invite-to-custom-role;
- generic effective capability resolver;
- SQL/RLS helper migration;
- custom role enforcement;
- Feature 082 reviewer enforcement changes.

This gives owners/admins the missing workflow after Feature 083 while keeping live access behavior stable for a later bounded enforcement feature.
