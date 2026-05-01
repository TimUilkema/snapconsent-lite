# Feature 084 - Custom role assignment foundation plan

## 1. Scope and contract

Feature 084 adds the first user-facing custom role assignment workflow. Owners and admins can assign and revoke tenant-local custom roles for existing tenant members from the Members / Organization Users page.

This feature must:

- Use the Feature 081 `role_assignments` table.
- Create tenant-scoped rows only: `scope_type = 'tenant'`, `project_id = null`, `workspace_id = null`.
- Assign only active tenant custom roles: `is_system = false`, `tenant_id = active tenant`, `archived_at is null`.
- Never assign system roles through this custom-role assignment flow.
- Never assign archived custom roles.
- Allow multiple different custom roles for the same member.
- Treat duplicate active assignment creation as idempotent.
- Revoke by setting `revoked_at` and `revoked_by`.
- Treat revoke with no active assignment as idempotent.
- Create a new active row when a role is re-added after revoke.
- Rely on the Feature 081 membership foreign key cascade for member removal cleanup.
- Leave custom role assignments independent of fixed role changes.
- Keep custom role assignments visible and durable but non-enforcing in Feature 084.
- Preserve Feature 082 reviewer enforcement as system-reviewer-only.

Out of scope:

- Project-scoped or workspace-scoped custom role assignments.
- Invite-to-custom-role or custom roles during invite acceptance.
- Generic effective-capability resolution.
- Broad custom role enforcement in SQL, RLS, TypeScript permissions, or routes.
- Changes to Feature 082 reviewer enforcement.
- Changes to owner/admin fixed-role behavior or photographer workspace behavior.
- Changes to capture, review, Media Library, consent, matching, workflow, correction, or release behavior.
- Preservation or backfill of arbitrary old local custom-role assignment data.

## 2. Inputs and ground truth

Read in order:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `UNCODEXIFY.md`
5. `docs/rpi/README.md`
6. `docs/rpi/SUMMARY.md`
7. `docs/rpi/081-custom-role-definitions-and-scoped-role-assignment-foundation/plan.md`
8. `docs/rpi/082-project-scoped-reviewer-assignments-and-enforcement/plan.md`
9. `docs/rpi/083-custom-role-editor-foundation/plan.md`
10. `docs/rpi/084-custom-role-assignment-foundation/research.md`

Targeted live verification covered:

- `src/lib/tenant/role-assignment-foundation.ts`
- `src/lib/tenant/custom-role-service.ts`
- `src/lib/tenant/reviewer-access-service.ts`
- `src/lib/tenant/member-management-service.ts`
- `src/lib/tenant/member-management-route-utils.ts`
- `src/lib/tenant/permissions.ts`
- `src/app/(protected)/members/page.tsx`
- `src/components/members/member-management-panel.tsx`
- `src/components/members/custom-role-management-section.tsx`
- `src/app/api/members/**`
- `messages/en.json`
- `messages/nl.json`
- Feature 081, 082, and 083 migrations
- Feature 081, 082, 083, and representative member-management tests

Current live code and schema are the source of truth. Prior RPI documents explain intent but do not override verified implementation.

## 3. Verified current boundary

Feature 081 provides:

- `role_definitions`, `role_definition_capabilities`, and `role_assignments`.
- System roles with `is_system = true`, `tenant_id = null`, and `system_role_key`.
- Tenant custom roles with `is_system = false`, non-null `tenant_id`, and nullable `archived_at`.
- `role_assignments` audit fields: `created_at`, `created_by`, `revoked_at`, `revoked_by`.
- Scope shape constraints for tenant, project, and workspace rows.
- Revoke shape constraint requiring `revoked_at` and `revoked_by` to be both null or both non-null.
- Active uniqueness indexes for tenant, project, and workspace assignment scopes.
- Membership foreign key `(tenant_id, user_id)` with `on delete cascade`.
- Project and workspace scope foreign keys with tenant alignment.
- Role-definition guard trigger that rejects cross-tenant role definitions and rejects new active assignments to archived tenant roles.
- RLS read policies for tenant managers and own assignment rows.
- Authenticated `select` grants but no authenticated insert/update/delete write grants for `role_assignments`.
- Read helpers in `role-assignment-foundation.ts`, including active-only assignment resolution, with comments stating these helpers are non-enforcing.

Feature 083 provides:

- `custom-role-service.ts` with `listRoleEditorData`, `createCustomRole`, `updateCustomRole`, and `archiveCustomRole`.
- Owner/admin authorization through `resolveTenantPermissions(...).canManageMembers`.
- Service-role RPC calls after actor validation for custom role create/update/archive.
- Active custom roles listed by default; archived roles available with `includeArchived`.
- System roles distinguished by `kind: "system"`, `is_system`, `systemRoleKey`, and immutable route/service checks.
- Custom roles distinguished by `kind: "custom"`, `tenant_id`, `archivedAt`, capability mappings, and `canEdit`/`canArchive`.
- Members page UI for role definitions in `CustomRoleManagementSection`.
- Copy that currently says custom roles are definitions only and are not assigned there.

Feature 082 provides:

- `reviewer-access-service.ts`, a domain-specific service over `role_assignments`.
- Direct service-role query-builder writes after owner/admin, target-member, target-role, and scope validation.
- Idempotent grant/revoke behavior using active uniqueness and re-read after unique conflict.
- Enforcement only for active assignments of the system `reviewer` role.
- SQL helpers that join `role_assignments` to `role_definitions` and require `rd.is_system` and `rd.system_role_key = 'reviewer'`.
- TypeScript permission helpers that still derive broad permissions from fixed `memberships.role`, with reviewer access gated through the Feature 082 service.
- Role-change cleanup only when a member changes away from fixed `reviewer`, and only for active system reviewer assignments.

Current Members page and API conventions:

- `MembersPage` loads `getTenantMemberManagementData`.
- Non-managers receive a read-only page; managers receive `MemberManagementPanel`.
- `getTenantMemberManagementData` currently returns members, pending invites, reviewer access summary, and role editor data.
- Current member routes use `requireAuthenticatedTenantContext()` and derive tenant server-side.
- Existing route patterns are focused under `/api/members`, such as `/api/members/roles`, `/api/members/reviewer-access`, and `/api/members/[userId]/reviewer-access/tenant-wide`.
- UI strings are under the `members` message namespace in both English and Dutch.

Feature 084 changes:

- Adds tenant-scoped custom role assignment listing, grant, revoke, and member-page display/control.
- Adds service/API/UI/i18n/tests for that lifecycle.

Feature 084 preserves:

- Existing role definition schema.
- Existing `role_assignments` schema and RLS.
- Existing fixed role permissions.
- Existing reviewer assignment enforcement.
- Existing member invite behavior.
- Existing member removal behavior except for relying on its existing cascade.

## 4. Recommendation

Implement tenant-scoped custom role assignments only.

Do not add a migration. The existing Feature 081 table, constraints, indexes, triggers, and RLS are sufficient for the assignment lifecycle. Use a new TypeScript service that mirrors the Feature 082 reviewer service pattern but validates custom roles instead of system reviewer roles.

Do not import custom role assignments into `permissions.ts`, SQL access helpers, RLS access helpers, or domain authorization services. Feature 084 is an assignment and visibility foundation, not an enforcement feature.

## 5. Chosen architecture

Add:

- `src/lib/tenant/custom-role-assignment-service.ts`
- `src/app/api/members/custom-role-assignments/route.ts`
- `src/app/api/members/[userId]/custom-roles/route.ts`
- `src/app/api/members/[userId]/custom-roles/[roleId]/route.ts`

Update:

- `src/lib/tenant/member-management-service.ts`
- `src/components/members/member-management-panel.tsx`
- Possibly add a small presentational component such as `src/components/members/custom-role-assignment-controls.tsx` if it keeps the table readable.
- `messages/en.json`
- `messages/nl.json`
- Tests under `tests/`.

Architecture rules:

- Route handlers derive `tenantId` with `requireAuthenticatedTenantContext()`.
- Route handlers never accept `tenant_id` from clients.
- Services validate the actor through `resolveTenantPermissions(...).canManageMembers`.
- Services validate target membership in the active tenant before writes.
- Services validate role definition in the active tenant before writes.
- Create the service-role Supabase client only after actor, target member, and role validation.
- Keep authenticated direct writes to `role_assignments` disabled.
- Keep custom role assignment logic out of `permissions.ts`.
- Do not add custom role assignments to SQL helper enforcement.

## 6. Exact schema/RPC decision

No migration is planned for Feature 084.

No new tables are needed because `role_assignments` already has:

- Tenant, user, role definition, scope, project, workspace, audit, and revocation fields.
- Tenant-scope shape constraints.
- Active tenant-scope uniqueness.
- Membership cascade cleanup.
- Role-definition tenant guard.
- Archived role guard for active assignments.
- RLS read policies and no authenticated write grants.

No RPC is planned for grant/revoke. Direct service-role query-builder writes are sufficient because:

- Grant and revoke are single-table mutations after service-layer validation.
- The existing active unique index handles duplicate active grants and races.
- The service can re-read the active row after a unique-conflict error, matching the reviewer service pattern.
- Revoke is a single conditional update of active rows.
- There is no multi-table capability replacement or role-definition mutation that needs a transactional RPC.

If implementation discovers a concrete race that cannot be handled with insert/re-read and conditional update, defer an RPC decision to the implementation PR with a small migration. The planned default remains no migration.

## 7. Exact assignment lifecycle plan

Grant:

- Input: `tenantId`, `actorUserId`, `targetUserId`, `roleId`.
- Validate actor is current tenant owner/admin through `canManageMembers`.
- Validate target is a current member of the active tenant.
- Validate role is a current tenant custom role:
  - `id = roleId`
  - `tenant_id = tenantId`
  - `is_system = false`
  - `archived_at is null`
- Insert into `role_assignments`:
  - `tenant_id = tenantId`
  - `user_id = targetUserId`
  - `role_definition_id = roleId`
  - `scope_type = 'tenant'`
  - `project_id = null`
  - `workspace_id = null`
  - `created_by = actorUserId`
  - `revoked_at = null`
  - `revoked_by = null`
- Return `{ assignment, created: true }` with status `201`.

Duplicate grant:

- If an active tenant-scope assignment already exists, return it with `{ created: false }` and status `200`.
- If insert races with another request and hits the active unique index, re-read the active assignment and return `{ created: false }`.
- If the conflict cannot be resolved by re-read, return `409 custom_role_assignment_conflict`.

Revoke:

- Input: `tenantId`, `actorUserId`, `targetUserId`, `roleId`.
- Validate actor is current tenant owner/admin.
- Validate target is a current member of the active tenant.
- Validate role belongs to the active tenant and `is_system = false`.
- Allow revoke when the role has become archived after assignment.
- Find active tenant-scope assignment for `(tenantId, targetUserId, roleId)`.
- If found, update `revoked_at = now()` and `revoked_by = actorUserId`.
- Return `{ assignment, revoked: true }`.

Revoke when no active row exists:

- Return `{ assignment: null, revoked: false }` with status `200`.

Re-add after revoke:

- Insert a new active row. Do not reuse or clear the old revoked row.
- The new row has a new `id`, new `created_at`, and new `created_by`.

Multiple roles:

- Allow multiple different active custom roles for the same member.
- Prevent only the exact duplicate active tenant-scope `(tenantId, userId, roleDefinitionId)` assignment.

Assignable members:

- Allow assignment to any current tenant member, including owner, admin, reviewer, and photographer.
- This does not change owner immutability, fixed role behavior, or live authorization.

Member removal:

- Continue deleting from `memberships`.
- The existing `(tenant_id, user_id)` foreign key cascade removes role assignment rows.

Fixed role changes:

- Do not revoke custom role assignments.
- Preserve the existing reviewer cleanup when changing away from fixed `reviewer`; that cleanup remains system-reviewer-only.

Archived custom roles:

- Do not assign archived roles.
- Do not auto-revoke active assignments when a role is archived.
- List active assignments whose role has since been archived as archived/inactive labels.
- Allow revocation of archived assigned roles.
- Do not add restore behavior.

Role edits:

- Existing assignments continue pointing at the same role definition.
- Role name/capability edits are reflected in assignment display.
- No enforcement changes are implied by capability edits.

## 8. Exact service/API plan

### Service types

Add normalized types in `custom-role-assignment-service.ts`:

- `AssignableCustomRole`
- `CustomRoleAssignmentRecord`
- `MemberCustomRoleAssignmentSummary`
- `CustomRoleAssignmentListResult`
- `GrantCustomRoleResult`
- `RevokeCustomRoleResult`

Recommended fields:

- Role fields: `roleId`, `name`, `description`, `capabilityKeys`, `archivedAt`.
- Assignment fields: `assignmentId`, `tenantId`, `userId`, `roleId`, `scopeType`, `createdAt`, `createdBy`, `revokedAt`, `revokedBy`, `role`.
- Summary fields: `userId`, `assignments`.

### Service functions

`listAssignableCustomRoles(input)`

- Auth: owner/admin through `canManageMembers`.
- Reads active tenant custom roles only.
- Returns roles with capability keys.
- Excludes system and archived roles.

`listCustomRoleAssignmentsForMembers(input)`

- Auth: owner/admin through `canManageMembers`.
- Reads active tenant-scope custom role assignments for the active tenant.
- Joins or separately loads role definitions and capability rows.
- Includes assignments whose role is now archived so managers can see and revoke them.
- Excludes system role assignments.
- Returns summaries grouped by member `userId`.
- Optionally accepts `includeRevoked` for service tests or future route use, but UI should consume active assignments only in Feature 084.

`grantCustomRoleToMember(input)`

- Implements the grant lifecycle above.
- Uses service-role insert only after validation.
- Handles duplicate active assignment and unique-race idempotently.

`revokeCustomRoleFromMember(input)`

- Implements the revoke lifecycle above.
- Uses service-role update only after validation.
- Allows archived tenant custom roles to be revoked.
- Rejects system roles.

`resolveCustomRoleAssignmentSummary(input)`

- Convenience helper for `getTenantMemberManagementData` and route responses.
- Returns `{ assignableRoles, members }`.
- Does not imply enforcement.

### Data loading integration

Extend `TenantMemberManagementData` with:

- `customRoleAssignments: MemberCustomRoleAssignmentSummary[]`
- `assignableCustomRoles: AssignableCustomRole[]`

`getTenantMemberManagementData` should call the new service after manager authorization, beside `listReviewerAccessSummary` and `listRoleEditorData`.

### Routes

#### `GET /api/members/custom-role-assignments`

Auth:

- `requireAuthenticatedTenantContext()`.
- Owner/admin through service-level `canManageMembers`.

Response `200`:

```json
{
  "assignableRoles": [],
  "members": []
}
```

Errors:

- `401 unauthenticated`
- `403 tenant_member_management_forbidden`
- `500 tenant_member_lookup_failed` or a service-specific lookup failure

Tenant derivation:

- Server-side only from active tenant context.

#### `POST /api/members/[userId]/custom-roles`

Request:

```json
{
  "roleId": "uuid"
}
```

Auth:

- `requireAuthenticatedTenantContext()`.
- Owner/admin through service-level `canManageMembers`.

Response:

- `201 { "assignment": ..., "created": true }`
- `200 { "assignment": ..., "created": false }`

Errors:

- `401 unauthenticated`
- `403 tenant_member_management_forbidden`
- `400 invalid_body`
- `404 member_not_found`
- `404 custom_role_not_found`
- `409 custom_role_archived`
- `403 system_role_assignment_forbidden`
- `409 custom_role_assignment_conflict`

Validation:

- `userId` comes from the route.
- `roleId` comes from the JSON body.
- Tenant comes from server context.
- Reject system roles explicitly before any write.
- Reject archived roles explicitly before any write.

#### `DELETE /api/members/[userId]/custom-roles/[roleId]`

Request:

- No body.

Auth:

- `requireAuthenticatedTenantContext()`.
- Owner/admin through service-level `canManageMembers`.

Response:

- `200 { "assignment": ..., "revoked": true }`
- `200 { "assignment": null, "revoked": false }`

Errors:

- `401 unauthenticated`
- `403 tenant_member_management_forbidden`
- `400 invalid_body` for missing route params
- `404 member_not_found`
- `404 custom_role_not_found`
- `403 system_role_assignment_forbidden`

Validation:

- Allow archived custom roles for revoke if they belong to the tenant.
- Reject system roles.
- Do not accept tenant or scope from client.

## 9. Members page UI/i18n plan

UI placement:

- Add custom role assignment controls to the existing Members table.
- Do not add a new access-management page.
- Do not add a dashboard, matrix, or decorative role console.

Table shape:

- Add a `Custom roles` column near `Reviewer access`.
- For each member row, show active custom role assignments as compact labels.
- If an assigned role is archived, show it as an archived/inactive label with subdued styling.
- If no roles are assigned, show a simple empty state.
- Provide a select per member with active assignable custom roles that are not already actively assigned to that member.
- Provide an inline assign button.
- Provide inline remove buttons for assigned custom roles.
- Disable controls while a mutation is pending.
- Use `router.refresh()` after assignment/revoke, matching the existing panel pattern.

Behavior:

- Assignment controls render only on the manager page because non-managers already receive the read-only Members page.
- No full assignment history UI.
- Assign dropdown includes active tenant custom roles only.
- Archived roles never appear in assign options.
- Archived assigned roles, if present, remain visible and revokable.
- If no active custom roles exist, show a small message and no assign controls.
- Keep the existing custom role editor section. Update its note so it no longer claims roles are not assigned here if the assignment controls are in the same page.

Suggested i18n keys under `members.customRoleAssignments`:

- `column`
- `title`
- `assignRole`
- `assignedRoles`
- `noAssignedRoles`
- `noAssignableRoles`
- `createRoleFirst`
- `selectPlaceholder`
- `remove`
- `removeConfirm`
- `assigned`
- `revoked`
- `note`
- `archivedAssignedRole`
- `errors.fallback`
- `errors.roleArchived`
- `errors.systemRoleForbidden`
- `errors.memberNotFound`
- `errors.roleNotFound`
- `errors.conflict`

Suggested English copy:

- `column`: `Custom roles`
- `assignRole`: `Assign role`
- `noAssignedRoles`: `No custom roles`
- `noAssignableRoles`: `No roles available`
- `createRoleFirst`: `Create an active custom role before assigning one.`
- `selectPlaceholder`: `Select a custom role`
- `remove`: `Remove`
- `removeConfirm`: `Remove {role} from {email}?`
- `assigned`: `Custom role assigned.`
- `revoked`: `Custom role removed.`
- `note`: `Custom role assignments are visible here. Broad enforcement will be added in later feature slices.`
- `archivedAssignedRole`: `{role} is archived and no longer assignable.`
- `errors.fallback`: `Unable to update custom role assignments.`
- `errors.roleArchived`: `Archived custom roles cannot be assigned.`
- `errors.systemRoleForbidden`: `System roles cannot be assigned here.`

Suggested Dutch copy:

- `column`: `Aangepaste rollen`
- `assignRole`: `Rol toewijzen`
- `noAssignedRoles`: `Geen aangepaste rollen`
- `noAssignableRoles`: `Geen rollen beschikbaar`
- `createRoleFirst`: `Maak eerst een actieve aangepaste rol voordat je er een toewijst.`
- `selectPlaceholder`: `Selecteer een aangepaste rol`
- `remove`: `Verwijderen`
- `removeConfirm`: `{role} verwijderen bij {email}?`
- `assigned`: `Aangepaste rol toegewezen.`
- `revoked`: `Aangepaste rol verwijderd.`
- `note`: `Aangepaste roltoewijzingen zijn hier zichtbaar. Brede handhaving volgt in latere featureslices.`
- `archivedAssignedRole`: `{role} is gearchiveerd en kan niet meer worden toegewezen.`
- `errors.fallback`: `Aangepaste roltoewijzingen kunnen niet worden bijgewerkt.`
- `errors.roleArchived`: `Gearchiveerde aangepaste rollen kunnen niet worden toegewezen.`
- `errors.systemRoleForbidden`: `Systeemrollen kunnen hier niet worden toegewezen.`

All new user-facing strings must use i18n keys.

## 10. Enforcement boundary

Feature 084 must not change live authorization.

Required boundary:

- Current SQL helpers do not read custom role assignments for generic capability checks.
- Current TypeScript permission helpers do not read custom role assignments.
- `permissions.ts` continues to derive fixed-role permissions from `memberships.role`.
- Feature 082 reviewer access continues to require active assignments where `role_definitions.is_system = true` and `system_role_key = 'reviewer'`.
- Custom role assignments do not grant review access.
- Custom role assignments do not grant capture/upload access.
- Custom role assignments do not grant Media Library access.
- Custom role assignments do not grant member management.
- Custom role assignments do not grant project creation.
- Custom role assignments do not grant workspace staffing.
- Custom role assignments do not grant correction or finalization access.

The UI must avoid implying immediate broad access. Copy should present assignments as visible custom role assignments and explicitly note that broad enforcement is later work.

## 11. Fresh reset and seed/dev data plan

Development and validation should assume a clean local database:

- Run `supabase db reset` before full validation.
- Do not preserve, repair, or backfill arbitrary old local custom-role assignment rows.
- Do not add production backfill unless a later implementation request explicitly requires it.
- Tests create the custom roles and assignments they need.
- Do not add sample custom role assignment seed data by default.

## 12. Security and tenant isolation plan

Cross-tenant role assignment:

- Validate `role_definitions.tenant_id = active tenant`.
- Reject missing role as `404 custom_role_not_found`.
- Keep the Feature 081 trigger as a second layer.

Assigning roles to non-members:

- Validate target membership by `(tenant_id, user_id)`.
- Return `404 member_not_found` for missing target membership.
- Keep the membership FK as a second layer.

Archived roles:

- Grant path checks `archived_at is null`.
- Return `409 custom_role_archived`.
- Revoke path allows archived roles if they belong to the tenant and are custom.

System roles:

- Grant and revoke paths reject `is_system = true` with `403 system_role_assignment_forbidden`.
- Do not expose system roles as assignable options.

Client-provided tenant id:

- No route accepts tenant id.
- Tenant comes only from `requireAuthenticatedTenantContext()`.

Service-role writes:

- Create service-role client only after actor/member/role validation.
- Write only the validated tenant, target user, role, and tenant scope.

Duplicate active assignments:

- Use existing active tenant unique index.
- Pre-read active assignment for idempotency.
- Handle unique-race by re-reading active assignment.

Stale revoked assignments:

- Grant ignores revoked rows and creates a new active row.
- Revoke updates only active rows.

Fixed role changes:

- Do not couple custom role assignments to fixed role changes.
- Preserve existing system reviewer cleanup when a reviewer changes away from fixed reviewer.

Member removal:

- Continue deleting membership rows.
- Assert cascade removes custom role assignment rows.

Accidental enforcement:

- Do not import the new service into `permissions.ts`.
- Do not update SQL helper functions to read custom role definitions or capability mappings.
- Add non-enforcement tests.

Active tenant switching:

- Use active tenant context for every route and service call.
- Refresh page data after mutations.
- Do not cache assignments across tenants in client state beyond current page props.

UI tenant isolation:

- Members page data comes from `getTenantMemberManagementData`.
- Assignment summaries are grouped from active tenant rows only.
- Assign dropdown is active tenant roles only.

## 13. Test plan

### Service/API tests

Add or extend tests to prove:

- Owner/admin can list assignable custom roles and member assignment summaries.
- Owner/admin can assign an active custom role to a member.
- Owner/admin can revoke a custom role assignment.
- Non-manager cannot assign or revoke.
- Cannot assign system role.
- Cannot assign archived custom role.
- Cannot assign role from another tenant.
- Cannot assign to member from another tenant.
- Duplicate active assignment is idempotent.
- Revocation is idempotent.
- Re-add after revoke creates a new active row.
- Multiple custom roles can be assigned to the same member.
- Member removal cleans custom role assignments through cascade.
- Fixed role change does not delete custom role assignments.
- Archived assigned role can still be listed and revoked if the role is archived after assignment.

### Non-enforcement tests

Add tests that assign custom roles with these capabilities and verify they do not grant live access:

- `review.workspace` does not grant review access.
- `capture.upload_assets` does not grant capture/upload access.
- `media_library.access` does not grant Media Library access.
- `organization_users.manage` does not grant member management.
- `projects.create` does not grant project creation.
- `project_workspaces.manage` does not grant workspace staffing.
- Feature 082 system reviewer assignment still works and ignores custom roles.

Use both relevant SQL/RPC checks and TypeScript helper checks where existing coverage patterns exist.

### UI/component tests

Add tests for:

- Members UI displays assigned custom role labels.
- Assignment dropdown contains active custom roles only.
- Archived roles do not appear in assign options.
- Assign action calls `/api/members/[userId]/custom-roles` and refreshes.
- Revoke action calls `/api/members/[userId]/custom-roles/[roleId]` and refreshes.
- No full assignment history UI renders.
- No custom role assignment controls render for the non-manager read-only page.

### Regression tests to keep green

- Feature 081 role assignment foundation tests.
- Feature 082 reviewer access assignment tests.
- Feature 083 custom role editor tests.
- Representative Feature 070 member-management tests.

## 14. Risks and edge cases

Archived assigned roles:

- Risk: archived roles remain visibly assigned and confuse managers.
- Mitigation: label as archived/inactive, remove from assign dropdown, allow revoke.

Duplicate grant races:

- Risk: concurrent grant requests hit the unique index.
- Mitigation: treat `23505` as a re-read path and return existing active assignment.

Revoke/re-add audit behavior:

- Risk: implementation updates a revoked row back to active and loses history.
- Mitigation: revoke only sets revoke fields; re-add always inserts a new row.

Fixed role changes:

- Risk: custom assignments are accidentally deleted when changing fixed roles.
- Mitigation: keep cleanup limited to `revokeActiveReviewerAssignmentsForMember`.

Member removal cascade:

- Risk: custom assignment rows remain after membership deletion.
- Mitigation: rely on FK cascade and add a regression test.

Cross-tenant ids:

- Risk: service-role writes bypass RLS after insufficient validation.
- Mitigation: validate active tenant membership and role ownership before creating service-role client.

System role assignment attempts:

- Risk: custom-role route becomes a second system-role assignment API.
- Mitigation: explicit `is_system` rejection and tests.

UI clarity:

- Risk: assigned custom roles imply immediate access.
- Mitigation: concise note and non-enforcement tests.

Future enforcement:

- Risk: archived assigned roles accidentally become enforcing later.
- Mitigation: future enforcement should require role `archived_at is null`; document this expectation in tests and plan.

Members page readability:

- Risk: too many controls crowd the current table.
- Mitigation: keep labels compact, assign control simple, and factor a small row component if needed.

## 15. Implementation phases

### Phase 1 - Confirm no schema/RPC changes

- Re-check Feature 081 constraints before coding.
- Confirm no migration is needed.
- Validation: `supabase db reset` succeeds before implementation validation.

### Phase 2 - Custom role assignment service

- Add `custom-role-assignment-service.ts`.
- Implement list, grant, revoke, and summary helpers.
- Mirror reviewer service idempotency and service-role write pattern.
- Validation: focused service tests for lifecycle and tenant isolation.

### Phase 3 - Assignment API routes

- Add focused GET, POST, and DELETE routes.
- Use `requireAuthenticatedTenantContext()`.
- Map known service errors to existing `jsonError` behavior.
- Validation: API tests for status codes, response shapes, and error codes.

### Phase 4 - Members page UI and i18n

- Extend `TenantMemberManagementData`.
- Load assignment summary in `getTenantMemberManagementData`.
- Add table column and inline assign/revoke controls.
- Add English and Dutch messages.
- Update custom role editor note.
- Validation: component/UI tests and manual Members page check.

### Phase 5 - Non-enforcement tests

- Add custom-role assignment non-enforcement tests for review, capture/upload, Media Library, member management, project creation, and workspace staffing.
- Preserve Feature 082 reviewer enforcement tests.
- Validation: targeted test files pass.

### Phase 6 - Regression and clean reset validation

- Run `supabase db reset`.
- Run relevant tests:
  - `tests/feature-081-role-assignment-foundation.test.ts`
  - `tests/feature-082-reviewer-access-assignments.test.ts`
  - `tests/feature-083-custom-role-editor-foundation.test.ts`
  - new Feature 084 tests
  - representative Feature 070 member-management tests
- Run lint if UI/TypeScript changes warrant it.

## 16. Clear scope boundaries

Do:

- Add tenant-scoped custom role assignment for existing members.
- Add owner/admin-only service and routes.
- Add member-page display and inline assign/revoke controls.
- Add lifecycle, tenant-isolation, idempotency, archive, cascade, fixed-role independence, and non-enforcement tests.

Do not:

- Add project or workspace custom role assignment.
- Add custom role invite behavior.
- Add custom roles to fixed permission resolution.
- Add a generic capability engine.
- Change SQL/RLS access helpers for custom roles.
- Change reviewer assignment enforcement.
- Change photographer workspace access.
- Change owner/admin fixed-role behavior.
- Add seed data or backfill for old local assignments.

## 17. Concise implementation prompt

Implement Feature 084 as a tenant-scoped custom role assignment foundation. Use the existing `role_assignments` table with tenant-scope rows only. Add `src/lib/tenant/custom-role-assignment-service.ts` with manager-authorized list/grant/revoke helpers, using service-role query-builder writes only after validating actor, target member, and active tenant custom role. Add focused member routes for listing assignments, granting a custom role to a member, and revoking a custom role from a member. Extend the existing Members page data and table to show assigned custom roles and inline assign/revoke controls, with English and Dutch i18n. Do not create migrations, do not add project/workspace assignment, do not assign system or archived roles, and do not connect custom role assignments to live authorization. Add tests for lifecycle, idempotency, tenant isolation, archived roles, member removal cascade, fixed-role independence, UI behavior, and explicit non-enforcement across current access areas while keeping Feature 082 system reviewer enforcement unchanged.
