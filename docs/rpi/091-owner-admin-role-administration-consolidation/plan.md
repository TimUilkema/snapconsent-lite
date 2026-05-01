# Feature 091 Plan - Owner/Admin Role Administration Consolidation

## Scope and Contract

Feature 091 is a consolidation and hardening slice. It must preserve the current product rule:

- Role administration is fixed owner/admin-only.
- Owners/admins can create, edit, archive, assign, and revoke tenant custom roles.
- Owners/admins can grant and revoke tenant-wide and project reviewer access.
- Other members can receive custom roles and use operational capabilities where enforcement has shipped.
- Other members cannot administer custom roles, custom role assignments, or reviewer access.

This plan intentionally does not add delegated role administration.

In scope:

- Add or strengthen regression tests proving role administration remains owner/admin-only.
- Add tests proving delegated `organization_users.*` users cannot access role editor, custom role assignment, or reviewer access administration.
- Add tests proving delegated directory data omits privileged role-administration fields.
- Add tests proving role-administration capability keys do not exist in the TypeScript catalog or enforced allowlist.
- Add direct SQL/RLS write-denial tests where practical.
- Update stale Members/custom-role UI copy in English and Dutch.
- Add concise comments only where they preserve a non-obvious security invariant.
- Update `docs/rpi/SUMMARY.md` during implementation after tests pass, if following the repo convention for completed features.

Out of scope:

- No `custom_roles.manage`.
- No `custom_roles.assign`.
- No `reviewer_access.manage`.
- No `roles.manage`.
- No `roles.assign`.
- No delegated custom role editor, custom role assignment, or reviewer access administration.
- No project/workspace-scoped custom role assignment UI.
- No invite-to-custom-role.
- No generic effective permission engine.
- No capture/review/workflow/correction custom-role migration.
- No owner transfer or owner demotion.
- No schema redesign or new role tables.
- No broad Members page redesign.

## Inputs and Ground Truth

Primary synthesized input:

- `docs/rpi/091-owner-admin-role-administration-consolidation/research.md`

Required context read:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `UNCODEXIFY.md`
- `docs/rpi/README.md`
- `docs/rpi/SUMMARY.md`

Targeted verification covered:

- `src/lib/tenant/role-capabilities.ts`
- `src/lib/tenant/tenant-custom-role-capabilities.ts`
- `src/lib/tenant/custom-role-service.ts`
- custom role editor route handlers
- `src/components/members/custom-role-management-section.tsx`
- `src/lib/tenant/custom-role-assignment-service.ts`
- custom role assignment route handlers
- `src/components/members/member-management-panel.tsx`
- `src/lib/tenant/reviewer-access-service.ts`
- reviewer access route handlers
- `src/components/projects/project-reviewer-access-panel.tsx`
- `src/lib/tenant/organization-user-access.ts`
- `src/lib/tenant/member-management-service.ts`
- `src/components/members/delegated-member-management-panel.tsx`
- `src/app/(protected)/members/page.tsx`
- `src/app/api/members/route.ts`
- `messages/en.json`
- `messages/nl.json`
- Feature 081, 083, 088, and 089 migrations
- Feature 083, 084, 088, and 089 tests

Live code, migrations, and tests remain authoritative over RPI history.

## Verified Current Boundary

### Capability Catalog and Enforced Allowlist

Targeted verification confirmed:

- `TENANT_CAPABILITIES` contains only the current operational capability catalog.
- `ENFORCED_TENANT_CUSTOM_ROLE_CAPABILITIES` contains only shipped operational custom-role enforcement keys:
  - Media Library access/folder management;
  - template/profile access;
  - project creation/workspace management;
  - bounded organization-user read/list, invite, role-change, and removal.
- No live TypeScript capability key exists for:
  - `custom_roles.manage`
  - `custom_roles.assign`
  - `reviewer_access.manage`
  - `roles.manage`
  - `roles.assign`

### Custom Role Editor

Targeted verification confirmed:

- `listRoleEditorData`, `createCustomRole`, `updateCustomRole`, and `archiveCustomRole` all call `assertTenantMemberManager`.
- `assertTenantMemberManager` uses `resolveTenantPermissions(...).canManageMembers`.
- `canManageMembers` remains fixed owner/admin-only.
- The service does not authorize role editor access through `organization_users.*` or other custom role capabilities.
- The editor routes derive tenant and actor through `requireAuthenticatedTenantContext()` and do not accept client `tenant_id`.
- Service-role RPC writes happen only after the service-level owner/admin authorization check.
- Feature 083 RPCs also hard-check owner/admin and are service-role-only.

### Custom Role Assignment

Targeted verification confirmed:

- Assignment list, summary, grant, and revoke paths call `assertTenantMemberManager`.
- Delegated `organization_users.*` capabilities do not authorize custom role assignment.
- Routes derive tenant and actor server-side through `requireAuthenticatedTenantContext()`.
- System role assignment/revocation through the custom role workflow is rejected.
- Archived custom roles cannot be newly assigned.
- Archived assigned roles remain visible and revokable by owner/admin.
- Duplicate grant returns the active assignment with `created: false`.
- Duplicate revoke returns `revoked: false`.
- Service-role `role_assignments` writes happen only after owner/admin authorization, target membership validation, and role validation.

### Reviewer Access Administration

Targeted verification confirmed:

- Tenant-wide reviewer access list/grant/revoke is gated by `reviewer-access-service.ts` owner/admin checks.
- Project reviewer access list/grant/revoke is gated by the same owner/admin checks.
- Reviewer access writes use the system reviewer role definition, not tenant custom role assignment.
- `organization_users.*`, `projects.create`, and `project_workspaces.manage` do not grant reviewer access administration.
- Project reviewer access UI depends on server-loaded `ProjectReviewerAccessData`; that service loader is owner/admin-gated.

### Delegated Organization-User Data Model

Targeted verification confirmed:

- `getTenantMemberManagementData` returns the full owner/admin model with `reviewerAccess`, `roleEditor`, `assignableCustomRoles`, and `customRoleAssignments`.
- `getOrganizationUserDirectoryData` returns the reduced delegated model and does not include those privileged fields.
- `src/app/(protected)/members/page.tsx` and `src/app/api/members/route.ts` choose full vs delegated data based on `resolveOrganizationUserAccess().isFixedOwnerAdmin`.
- The delegated UI does not render custom role editor, custom role assignment controls, or reviewer access controls.

### SQL/RLS/RPC Safety

Targeted verification confirmed:

- Feature 081 grants authenticated users select only on `role_definitions`, `role_definition_capabilities`, and `role_assignments`.
- No authenticated insert/update/delete grants for those role tables were found in the relevant migrations.
- Tenant custom role metadata select policies depend on `app.current_user_can_manage_members`.
- `app.current_user_can_manage_members` remains fixed owner/admin-only.
- Feature 083 custom role editor RPCs are service-role-only and hard-check owner/admin.
- Feature 088/089 organization-user helpers broaden bounded member/invite access only; they do not grant role definition or role assignment mutation.

## Drift From Research

No new plan-changing drift was found during targeted verification.

Existing non-blocking drift remains:

- RPI/SUMMARY history around Feature 087 folder naming is inconsistent, but live migrations/tests are clear and not plan-critical for Feature 091.
- Feature 090 future-looking text about `custom_roles.assign` is superseded by this Feature 091 owner/admin-only consolidation scope.
- `members.customRoleAssignments.note` remains stale in both English and Dutch.

## Options Considered

### Option A - Consolidate Owner/Admin-Only Role Administration

Keep role administration fixed owner/admin-only and add regression tests, copy cleanup, and focused security comments.

Decision: choose.

### Option B - Add Delegated Custom Role Assignment

Introduce `custom_roles.assign`.

Decision: reject/defer. This conflicts with the Feature 091 product rule and requires a separate escalation-risk design.

### Option C - Add Delegated Custom Role Editor

Introduce `custom_roles.manage`.

Decision: reject/defer. Editing a role changes effective permissions for every assignee and is too risky for this consolidation slice.

### Option D - Build a Generic Role Administration Engine

Introduce broad `roles.manage` / `roles.assign` or a generic permission engine.

Decision: reject/defer. This is too broad and conflicts with the current area-by-area migration strategy.

## Recommendation

Implement Option A.

Feature 091 should be a small PR-sized hardening slice:

1. Add consolidated Feature 091 regression tests.
2. Update concise Members/custom-role i18n copy.
3. Add at most a few comments that preserve the owner/admin-only role-administration invariant.
4. Update `docs/rpi/SUMMARY.md` after implementation if tests pass.

No migration is planned.

## Chosen Consolidation Approach

The implementation should not change authorization behavior. It should make the existing behavior harder to regress.

The tests should treat this distinction as the central contract:

- Operational custom-role enforcement: tenant custom roles may grant already-shipped operational capabilities such as Media Library access, template/profile management, project creation, project workspace management, and bounded organization-user actions.
- Role administration: custom role editor, custom role assignment, and reviewer access administration remain fixed owner/admin-only.

## Exact Test Plan

Create:

- `tests/feature-091-owner-admin-role-administration-consolidation.test.ts`

Prefer a new test file so the boundary is discoverable. Reuse existing helper patterns from Feature 083, 084, 088, and 089 tests rather than exporting test-local helpers from those files.

### Fixture Setup

Build one fixture with:

- tenant A;
- tenant B for cross-tenant sanity where useful;
- owner actor in tenant A;
- admin actor in tenant A;
- delegated actor in tenant A with fixed role `photographer` or `reviewer`;
- operational actor in tenant A with custom operational capabilities such as `projects.create` and `project_workspaces.manage`;
- reviewer target in tenant A;
- photographer target in tenant A;
- at least one project in tenant A;
- at least one active tenant custom role;
- one custom role containing all `organization_users.*` capabilities assigned to the delegated actor;
- optionally one custom role containing `projects.create` and `project_workspaces.manage` assigned to the operational actor;
- an archived custom role assigned to a target for revocation coverage;
- the system reviewer role definition loaded from durable role definitions where reviewer access tests require it.

Use existing test utilities such as `adminClient`, `createAuthUserWithRetry`, `signInClient`, and Supabase test helpers already used by Features 083-089.

### Catalog Absence Tests

Add a test named close to:

- `feature 091 does not define role administration capability keys`

Assertions:

- `TENANT_CAPABILITIES` does not include:
  - `custom_roles.manage`
  - `custom_roles.assign`
  - `reviewer_access.manage`
  - `roles.manage`
  - `roles.assign`
- `ENFORCED_TENANT_CUSTOM_ROLE_CAPABILITIES` does not include those keys.
- Optional database assertion: `capabilities` table does not contain those keys after migration reset.

### Owner/Admin Positive Regression Tests

Add a test named close to:

- `feature 091 preserves owner admin role administration`

Assertions:

- Owner or admin can call `listRoleEditorData`.
- Owner or admin can `createCustomRole`.
- Owner or admin can `updateCustomRole`.
- Owner or admin can `archiveCustomRole`.
- Owner or admin can call `resolveCustomRoleAssignmentSummary`.
- Owner or admin can `grantCustomRoleToMember`.
- Duplicate custom role grant returns `created: false`.
- Owner or admin can `revokeCustomRoleFromMember`.
- Duplicate custom role revoke returns `revoked: false`.
- Owner or admin can `grantTenantWideReviewerAccess`.
- Duplicate tenant-wide reviewer grant returns `created: false`.
- Owner or admin can `revokeTenantWideReviewerAccess`.
- Duplicate tenant-wide reviewer revoke returns `revoked: false`.
- Owner or admin can `grantProjectReviewerAccess`.
- Owner or admin can `revokeProjectReviewerAccess`.

Keep this focused. Existing Features 083/084/082 already test deeper behavior; Feature 091 should prove the consolidated boundary still works.

### Delegated Denial Tests

Add a test named close to:

- `feature 091 denies role administration to delegated organization user managers`

Use a delegated actor assigned a tenant custom role with all four organization-user capabilities:

- `organization_users.manage`
- `organization_users.invite`
- `organization_users.change_roles`
- `organization_users.remove`

Assert this actor receives `tenant_member_management_forbidden` from:

- `listRoleEditorData`
- `createCustomRole`
- `updateCustomRole`
- `archiveCustomRole`
- `resolveCustomRoleAssignmentSummary`
- `grantCustomRoleToMember`
- `revokeCustomRoleFromMember`
- `listReviewerAccessSummary`
- `grantTenantWideReviewerAccess`
- `revokeTenantWideReviewerAccess`
- `listProjectReviewerAssignments`
- `grantProjectReviewerAccess`
- `revokeProjectReviewerAccess`

If reviewer service functions return the same code through their fixed owner/admin guard, assert that exact code. If a project lookup would otherwise fire first, ensure the project exists and belongs to the tenant so the authorization boundary is tested first.

### Operational Capability Non-Expansion Tests

Add a test named close to:

- `feature 091 operational custom roles do not imply role administration`

Use an actor assigned operational capabilities such as:

- `projects.create`
- `project_workspaces.manage`
- optionally `media_library.access`

Assert this actor cannot:

- fetch role editor data;
- fetch custom role assignment summary;
- assign a custom role;
- list reviewer access;
- grant project reviewer access.

This protects against confusing operational custom-role enforcement with role administration.

### Delegated Data-Shape Tests

Add a test named close to:

- `feature 091 delegated directory omits privileged role administration data`

Call `getOrganizationUserDirectoryData` for a delegated actor with all `organization_users.*` capabilities.

Assert returned data does not contain:

- `roleEditor`
- `assignableCustomRoles`
- `customRoleAssignments`
- `reviewerAccess`

Also assert row-level protections remain:

- owner row cannot be changed or removed;
- admin row cannot be changed or removed by delegated actor;
- delegated actor self row cannot be changed or removed;
- reviewer/photographer target rows expose mutation booleans only when corresponding capability permits it.

Optionally call `getTenantMemberManagementData` for owner/admin and assert the full fields still exist.

### SQL/RLS Write-Denial Tests

Add a test named close to:

- `feature 091 authenticated delegated users cannot write role administration tables directly`

Using the delegated signed-in Supabase client, attempt:

- insert into `role_definitions`;
- update a tenant custom `role_definitions` row;
- insert into `role_definition_capabilities`;
- delete from `role_definition_capabilities`;
- insert into `role_assignments`;
- update an active `role_assignments` row to revoke it;
- delete from `role_assignments`.

Assert each direct write fails. Prefer checking for a PostgREST/Postgres permission or RLS error without overfitting to a single message if existing test helpers normalize errors.

Also assert own-row select exposure does not imply mutation:

- delegated actor may be able to select their own `role_assignments` rows;
- the same actor still cannot update or delete those rows.

### UI/Copy Tests

Update existing UI tests rather than adding a separate render test if that is simpler:

- `tests/feature-080-role-capability-catalog.test.ts` currently asserts Members UI role/capability text.
- `tests/feature-084-custom-role-assignment-foundation.test.ts` currently asserts custom role assignment UI labels.
- `tests/feature-088...` and `tests/feature-089...` assert delegated UI/data behavior.

Assertions to update/add:

- Rendered owner/admin Members UI includes the new area-by-area custom role assignment note.
- Rendered owner/admin custom role management copy mentions owner/admin-managed role administration or owner/admin-only custom role management.
- Rendered UI does not include the stale phrase "Broad enforcement will be added in later feature slices."
- Delegated UI still includes the helper that custom roles and reviewer access remain owner/admin-managed.
- Delegated UI still does not render custom role editor, assignment controls, or reviewer access controls.

### Route/API-Level Tests

Primary coverage can be service-level because current route handlers are thin and derive context through server cookie/session helpers. If existing route test harnesses can call these route handlers with authenticated session context without brittle mocking, add route/API assertions for:

- `/api/members/roles`
- `/api/members/custom-role-assignments`
- `/api/members/[userId]/custom-roles`
- `/api/members/reviewer-access`
- `/api/projects/[projectId]/reviewer-access`

If route harnessing is high-cost or brittle, document in the test file comments or implementation notes that service-level checks cover the authorization functions directly and route handlers are thin context adapters.

## Exact UI/i18n Copy Plan

Do not hardcode UI strings. Update `messages/en.json` and `messages/nl.json`.

Update existing keys rather than adding many new keys unless the component needs an extra line.

### English

Update `members.customRoles.definitionOnlyNote`.

Current:

```text
Custom roles define reusable permission sets. Assignments are managed in the members table below.
```

Planned:

```text
Custom roles define reusable permission bundles. Owners and admins manage role definitions and assignments.
```

Update `members.customRoleAssignments.note`.

Current:

```text
Custom role assignments are visible here. Broad enforcement will be added in later feature slices.
```

Planned:

```text
Custom roles grant access only in areas where custom-role enforcement has shipped. Role assignment remains owner/admin-only.
```

Keep `members.delegated.membersSubtitle` unless implementation finds wording awkward. It already says:

```text
Role changes and removals are available only where allowed. Custom roles and reviewer access remain owner/admin-managed.
```

### Dutch

Update `members.customRoles.definitionOnlyNote`.

Current:

```text
Aangepaste rollen definieren herbruikbare permissiesets. Toewijzingen beheer je in de ledentabel hieronder.
```

Planned:

```text
Aangepaste rollen definieren herbruikbare permissiebundels. Owners en admins beheren roldefinities en toewijzingen.
```

Update `members.customRoleAssignments.note`.

Current:

```text
Aangepaste roltoewijzingen zijn hier zichtbaar. Brede handhaving volgt in latere featureslices.
```

Planned:

```text
Aangepaste rollen geven alleen toegang in onderdelen waar handhaving voor aangepaste rollen is ingevoerd. Roltoewijzing blijft voor owners en admins.
```

Keep Dutch wording concise and consistent with existing terms. The implementation may choose "machtigingen" instead of "permissies" only if it updates nearby copy consistently; avoid broad terminology churn in Feature 091.

## Exact Code/Comment Plan

No behavior changes are planned.

Add comments only if they help prevent accidental future broadening:

- `src/lib/tenant/custom-role-service.ts`: above `assertTenantMemberManager`, add one short comment that role definition administration intentionally remains fixed owner/admin-only and must not use tenant custom-role capabilities.
- `src/lib/tenant/custom-role-assignment-service.ts`: above `assertTenantMemberManager`, add one short comment that assignment/revocation is role administration and remains owner/admin-only.
- `src/lib/tenant/reviewer-access-service.ts`: above its `assertTenantMemberManager`, add one short comment that reviewer access administration is separate from tenant custom role assignment and remains owner/admin-only.
- `src/lib/tenant/member-management-service.ts`: optionally add a short comment near `getOrganizationUserDirectoryData` return shape explaining that delegated directory data deliberately omits role editor, role assignment, and reviewer access administration data.

Do not add comments to route handlers unless implementation changes make a security invariant non-obvious.

## SQL/RLS/RPC Decision

No migration is needed.

Reason:

- Authenticated users have no direct insert/update/delete grants on role definition or role assignment tables.
- Custom role editor RPCs are service-role-only and hard-check owner/admin.
- `app.current_user_can_manage_members` remains fixed owner/admin-only.
- Organization-user SQL helpers do not grant role definition or role assignment mutation.

Implementation should add RLS/write-denial tests to verify the current schema rather than changing the schema.

If implementation unexpectedly finds an authenticated direct-write path, stop and update the plan before adding a migration. The minimal migration would be to revoke the offending grant and/or tighten the relevant RLS policy, but current verification does not indicate that is necessary.

## Security Considerations

Implementation must preserve:

- Tenant id is always server-derived through session/active tenant resolution; no client `tenant_id` is accepted.
- Role administration remains fixed owner/admin-only.
- Service-role writes happen only after server-side authorization.
- System roles remain immutable and non-assignable through tenant custom role assignment.
- Archived custom roles cannot be newly assigned.
- Archived assigned custom roles remain revokable by owner/admin.
- Revoked assignments are ignored by enforcement.
- Delegated `organization_users.*` capabilities do not imply role editor, custom role assignment, or reviewer access administration.
- Reviewer access administration remains separate from tenant custom role assignment.
- Own-row `role_assignments` select visibility does not imply mutation authority.
- UI hiding is never the authorization boundary; services/RLS remain authoritative.

## Edge Cases

Cover these in tests or implementation notes:

- Delegated user with all `organization_users.*` capabilities tries role editor list/create/update/archive.
- Delegated user with all `organization_users.*` capabilities tries custom role assignment list/grant/revoke.
- Delegated user with all `organization_users.*` capabilities tries tenant-wide and project reviewer access list/grant/revoke.
- User with operational custom capabilities such as `projects.create` or `project_workspaces.manage` tries reviewer access administration.
- User with operational custom capabilities tries custom role assignment.
- Archived assigned custom roles remain revokable by owner/admin.
- System roles remain non-assignable through custom role assignment.
- Direct authenticated writes to `role_definitions`, `role_definition_capabilities`, and `role_assignments` remain denied.
- A user's own role assignment rows may be selectable, but cannot be mutated directly.
- Duplicate grants and duplicate revokes remain idempotent.
- Project reviewer access denial tests should use an existing in-tenant project so denial is about authorization, not missing project.

## Implementation Phases

### Phase 1 - Consolidated Regression Tests

- Add `tests/feature-091-owner-admin-role-administration-consolidation.test.ts`.
- Build the fixture described above.
- Add catalog absence tests.
- Add owner/admin positive role-administration tests.
- Add delegated denial tests.
- Add operational capability non-expansion tests.
- Add delegated data-shape tests.
- Add direct SQL/RLS write-denial tests where practical.

### Phase 2 - UI/i18n Copy

- Update `messages/en.json`.
- Update `messages/nl.json`.
- Keep component structure unchanged unless an existing component needs to render a newly added message key.
- Update render assertions that mention old copy.

### Phase 3 - Optional Security Comments

- Add only the comments listed in the code/comment plan if they improve maintainability.
- Do not change authorization helpers.

### Phase 4 - Summary Update

- Update `docs/rpi/SUMMARY.md` after tests pass.
- Add a concise Feature 091 entry stating:
  - role administration remains owner/admin-only;
  - no role-administration capability keys were added;
  - tests/copy were consolidated;
  - no migration was added.
- If useful, note the existing Feature 087 folder naming drift without broad rewriting.

### Phase 5 - Verification

Run targeted tests first:

```powershell
npm test -- tests/feature-091-owner-admin-role-administration-consolidation.test.ts
```

Then run relevant surrounding tests:

```powershell
npm test -- tests/feature-083-custom-role-editor-foundation.test.ts tests/feature-084-custom-role-assignment-foundation.test.ts tests/feature-088-organization-user-read-list-and-invite-custom-role-enforcement.test.ts tests/feature-089-organization-user-role-change-and-removal-custom-role-enforcement.test.ts
```

If the repo test runner does not support file arguments, use the closest supported command and document any limitation.

Run lint if code/comments/messages changed:

```powershell
npm run lint
```

Run full `npm test` if practical after targeted tests pass.

## Scope Boundaries

Feature 091 must not:

- add delegated role administration;
- add new capability keys;
- add a generic permission engine;
- migrate capture/review/workflow/correction to custom-role enforcement;
- add project/workspace custom-role assignment;
- change owner/admin fixed-role behavior;
- redesign member management;
- change reviewer access semantics;
- broaden `resolveTenantPermissions`;
- broaden `app.current_user_can_manage_members`;
- introduce a migration unless a real SQL/RLS gap is discovered.

## Implementation Prompt

Implement Feature 091 from `docs/rpi/091-owner-admin-role-administration-consolidation/plan.md`.

Keep role administration fixed owner/admin-only. Do not add `custom_roles.manage`, `custom_roles.assign`, `reviewer_access.manage`, `roles.manage`, or `roles.assign`. Do not add delegated role editor, custom role assignment, or reviewer access administration.

Make a small consolidation PR:

1. Add `tests/feature-091-owner-admin-role-administration-consolidation.test.ts` covering catalog absence, owner/admin positive role administration, delegated denial for role editor/custom role assignment/reviewer access, delegated data-shape omissions, operational capability non-expansion, and direct role-table write denial where practical.
2. Update stale custom-role assignment copy in `messages/en.json` and `messages/nl.json` with concise area-by-area enforcement and owner/admin-only wording.
3. Add only concise security-boundary comments in the role-administration services/loaders if they help prevent accidental broadening.
4. Update `docs/rpi/SUMMARY.md` after tests pass with a brief Feature 091 entry.
5. Run the new Feature 091 test, relevant Feature 083/084/088/089 tests, lint, and full tests if practical. Document any command that cannot be run.
