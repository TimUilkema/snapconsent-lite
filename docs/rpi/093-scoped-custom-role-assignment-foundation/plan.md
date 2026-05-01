# Feature 093 - Project/Workspace Custom Role Assignment Foundation Plan

## Scope and contract

Feature 093 implements the assignment foundation for tenant, project, and workspace custom role assignments.

This is a plan for the implementation phase only. It does not implement code, migrations, UI, tests, or runtime behavior in this phase.

Use `docs/rpi/092-capability-scope-semantics-and-permission-migration-map/plan.md`, specifically `Feature 093 plan boundary`, as the governing contract. Feature 092 already decided the scope semantics; Feature 093 turns that boundary into an exact implementation plan.

In scope:

- owner/admin-only custom role assignment administration;
- assigning existing tenant custom role definitions at `tenant`, `project`, or `workspace` scope;
- preserving existing tenant-scope assignment behavior;
- displaying assignment scope and target labels in the owner/admin Members UI;
- returning scope-validity warning metadata for mixed-scope roles;
- rejecting assignments with zero effective capabilities at the selected scope;
- listing active assignments by default, with service/API support for revoked history where requested;
- idempotent grants and revokes;
- tenant, project, and workspace boundary validation.

Out of scope:

- operational route enforcement for project/workspace assignments;
- broad scoped effective permission resolver replacement;
- delegated role administration;
- new capability keys;
- role definition scope restrictions;
- converting reviewer access or photographer assignment to custom roles;
- capture, review, workflow, correction, or Media Library enforcement changes;
- broad IAM dashboard or Members page redesign.

## Inputs and ground truth

Required project and RPI context was read first:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `UNCODEXIFY.md`
- `docs/rpi/README.md`
- `docs/rpi/SUMMARY.md`
- `docs/rpi/092-capability-scope-semantics-and-permission-migration-map/plan.md`

Targeted prior RPI plans were read:

- `docs/rpi/081-custom-role-definitions-and-scoped-role-assignment-foundation/plan.md`
- `docs/rpi/083-custom-role-editor-foundation/plan.md`
- `docs/rpi/084-custom-role-assignment-foundation/plan.md`
- `docs/rpi/091-owner-admin-role-administration-consolidation/plan.md`

Targeted live verification covered:

- `src/lib/tenant/custom-role-assignment-service.ts`
- `src/app/api/members/custom-role-assignments/route.ts`
- `src/app/api/members/[userId]/custom-roles/route.ts`
- `src/app/api/members/[userId]/custom-roles/[roleId]/route.ts`
- `supabase/migrations/20260430120000_081_role_assignment_foundation.sql`
- `src/lib/tenant/role-capabilities.ts`
- `src/app/(protected)/members/page.tsx`
- `src/components/members/member-management-panel.tsx`
- `src/components/members/custom-role-management-section.tsx`
- `src/lib/tenant/member-management-service.ts`
- `messages/en.json`
- `messages/nl.json`
- `src/lib/projects/project-administration-service.ts`
- `src/lib/projects/project-workspaces-service.ts`
- Feature 081, 084, 087, and 091 tests.

Live code, migrations, and tests remain authoritative where old RPI documents differ.

## Verified current boundary

### Current custom role assignment service

`src/lib/tenant/custom-role-assignment-service.ts` currently exports:

- `listAssignableCustomRoles(input)`
- `listCustomRoleAssignmentsForMembers(input)`
- `resolveCustomRoleAssignmentSummary(input)`
- `grantCustomRoleToMember(input)`
- `revokeCustomRoleFromMember(input)`

Current exported types include:

- `AssignableCustomRole`
- `CustomRoleAssignmentRecord`
- `MemberCustomRoleAssignmentSummary`
- `CustomRoleAssignmentListResult`
- `GrantCustomRoleResult`
- `RevokeCustomRoleResult`

Current behavior is tenant-only:

- `CustomRoleAssignmentRecord.scopeType` is typed as `"tenant"`.
- Grant inserts `scope_type = 'tenant'`, `project_id = null`, and `workspace_id = null`.
- Listing filters to `scope_type = 'tenant'`, `project_id is null`, and `workspace_id is null`.
- Revoke finds active rows by `(tenantId, targetUserId, roleId)` at tenant scope.
- Assignment summaries group active tenant-scope assignments by `userId`.

Current grant behavior:

- validates fixed owner/admin through `resolveTenantPermissions(...).canManageMembers`;
- validates target tenant membership;
- validates role definition exists in the active tenant, `is_system = false`, and `archived_at is null`;
- rejects system roles with `system_role_assignment_forbidden`;
- rejects archived roles with `custom_role_archived`;
- uses service-role insert only after validation;
- pre-reads an active assignment and returns it with `created: false`;
- handles unique-conflict races by re-reading the active assignment and returning `created: false`;
- returns `created: true` for a new row.

Current revoke behavior:

- validates fixed owner/admin;
- validates target tenant membership;
- validates role definition belongs to the active tenant and `is_system = false`;
- allows archived custom roles to be revoked;
- updates `revoked_at` and `revoked_by` on the active tenant-scope assignment;
- returns `{ assignment, revoked: true }` when a row is updated;
- returns `{ assignment: null, revoked: false }` when no active row exists.

Current route shapes:

- `GET /api/members/custom-role-assignments` returns `resolveCustomRoleAssignmentSummary`.
- `POST /api/members/[userId]/custom-roles` accepts `{ "roleId": "uuid" }`.
- `DELETE /api/members/[userId]/custom-roles/[roleId]` revokes by user id plus role id.

Current owner/admin guard:

- assignment service uses `assertTenantMemberManager`;
- the guard calls `resolveTenantPermissions`;
- `canManageMembers` remains fixed owner/admin-only;
- Feature 091 tests prove delegated `organization_users.*` actors and operational custom-role actors cannot administer role assignments.

Current direct-write safety:

- Feature 081 grants authenticated users select only on `role_assignments`;
- no authenticated insert/update/delete grants exist for role tables;
- service-role writes are route/service controlled;
- Feature 091 tests cover direct write denial for delegated authenticated users.

Current tests that must remain green:

- `tests/feature-081-role-assignment-foundation.test.ts`
- `tests/feature-083-custom-role-editor-foundation.test.ts`
- `tests/feature-084-custom-role-assignment-foundation.test.ts`
- `tests/feature-087-project-admin-custom-role-enforcement.test.ts`
- `tests/feature-088-organization-user-read-list-and-invite-custom-role-enforcement.test.ts`
- `tests/feature-089-organization-user-role-change-and-removal-custom-role-enforcement.test.ts`
- `tests/feature-091-owner-admin-role-administration-consolidation.test.ts`

### Current role assignment schema

Feature 081 migration already creates the needed assignment substrate:

- `role_assignments.scope_type text not null check (scope_type in ('tenant', 'project', 'workspace'))`
- nullable `project_id`
- nullable `workspace_id`
- membership FK `(tenant_id, user_id)` to `memberships(tenant_id, user_id)` with cascade cleanup
- project FK `(project_id, tenant_id)` to `projects(id, tenant_id)`
- workspace FK `(workspace_id, tenant_id, project_id)` to `project_workspaces(id, tenant_id, project_id)`
- scope shape check:
  - tenant requires null project/workspace;
  - project requires project and null workspace;
  - workspace requires project and workspace;
- revoke shape check requiring `revoked_at` and `revoked_by` to be both null or both non-null;
- active unique indexes for tenant, project, and workspace exact scopes;
- role-definition guard trigger that rejects cross-tenant custom role references and rejects active assignments to archived tenant custom roles.

No new role assignment table is needed.

### Current Members page UI

`src/app/(protected)/members/page.tsx` routes fixed owner/admin users to `getTenantMemberManagementData` and `MemberManagementPanel`.

Delegated users go through `getOrganizationUserDirectoryData` and `DelegatedMemberManagementPanel`. The delegated data shape intentionally omits:

- `roleEditor`;
- `assignableCustomRoles`;
- `customRoleAssignments`;
- `reviewerAccess`.

`MemberManagementPanel` currently:

- shows the custom role editor section;
- shows a `Custom roles` column in the current members table;
- renders active custom role assignments as labels;
- uses an assign role select per member;
- uses `POST /api/members/[userId]/custom-roles` for assignment;
- uses `DELETE /api/members/[userId]/custom-roles/[roleId]` for revoke;
- has no assignment history UI;
- does not show project/workspace scope or target labels.

Messages currently exist under `members.customRoleAssignments` in English and Dutch for tenant-only assignment.

### Current project/workspace target services

`src/lib/projects/project-administration-service.ts` can list projects and workspaces for project administration, but those functions authorize through project administration capabilities. Feature 093 assignment targets are role-administration data and must stay fixed owner/admin-only.

Relevant existing data shapes:

- `ProjectAdministrationProjectRow`: `id`, `name`, `status`, `created_at`
- `ProjectAdministrationWorkspaceRow`: `id`, `tenant_id`, `project_id`, `workspace_kind`, `photographer_user_id`, `name`, workflow/audit fields

`src/lib/projects/project-workspaces-service.ts` focuses on operational workspace visibility and photographer workspace creation. It should not become the Members assignment target loader.

## Chosen service architecture

Extend `src/lib/tenant/custom-role-assignment-service.ts`.

Do not add a new top-level assignment service. The existing service already owns custom role assignment validation, route response mapping, idempotent grant, revoke, and Members-page summary data. Feature 093 should evolve it instead of splitting the assignment lifecycle across modules.

To keep the file maintainable, factor small local helpers or a narrow sibling helper if implementation grows:

- scope normalization/validation;
- project/workspace boundary validation;
- assignment target loading;
- capability scope-effect mapping.

Expected files:

- extend `src/lib/tenant/custom-role-assignment-service.ts`;
- add `src/lib/tenant/custom-role-scope-effects.ts` or equivalent for Feature 093 assignment warnings;
- optionally add `src/lib/tenant/custom-role-assignment-targets.ts` only if target loading makes the assignment service too large.

The exported service API should become:

- `listAssignableCustomRoles(input): Promise<AssignableCustomRole[]>`
- `listCustomRoleAssignmentsForMembers(input): Promise<MemberCustomRoleAssignmentSummary[]>`
- `resolveCustomRoleAssignmentSummary(input): Promise<CustomRoleAssignmentListResult>`
- `listCustomRoleAssignmentTargets(input): Promise<CustomRoleAssignmentTargetData>`
- `grantCustomRoleToMember(input): Promise<GrantCustomRoleResult>`
- `revokeCustomRoleAssignment(input): Promise<RevokeCustomRoleResult>`
- `revokeCustomRoleFromMember(input): Promise<RevokeCustomRoleResult>`

`revokeCustomRoleFromMember` should be retained as the tenant-only legacy compatibility wrapper. It should resolve the active tenant-scope assignment by `(targetUserId, roleId)` and then delegate to assignment-id revoke semantics. New code should call `revokeCustomRoleAssignment`.

New or updated service types:

- `RoleAssignmentScopeType = "tenant" | "project" | "workspace"`
- `CustomRoleAssignmentScopeInput`
- `CustomRoleAssignmentScopeMetadata`
- `CustomRoleAssignmentTargetProject`
- `CustomRoleAssignmentTargetWorkspace`
- `CustomRoleAssignmentTargetData`
- `ScopeEffectMetadata`
- updated `CustomRoleAssignmentRecord`
- updated `MemberCustomRoleAssignmentSummary`
- updated `CustomRoleAssignmentListResult`
- updated `GrantCustomRoleResult`
- updated `RevokeCustomRoleResult`

Service rules:

- derive tenant and actor from route/session context, never request body;
- validate fixed owner/admin before service-role writes;
- validate target membership before grant;
- validate custom role ownership/system/archive state before grant;
- validate project/workspace boundaries before grant;
- compute scope effect before write;
- reject zero-effective-capability assignments before write;
- allow mixed-scope assignments when at least one capability is effective;
- keep archived assigned roles visible and revokable;
- do not import scoped assignment results into operational permission helpers.

## Exact API route/body/response plan

### Grant route

Keep the grant route:

```text
POST /api/members/[userId]/custom-roles
```

Use a flat body:

```json
{
  "roleId": "uuid",
  "scopeType": "tenant",
  "projectId": null,
  "workspaceId": null
}
```

For project scope:

```json
{
  "roleId": "uuid",
  "scopeType": "project",
  "projectId": "uuid"
}
```

For workspace scope:

```json
{
  "roleId": "uuid",
  "scopeType": "workspace",
  "projectId": "uuid",
  "workspaceId": "uuid"
}
```

Justification:

- it preserves the existing `roleId` body shape and adds only the minimum scope fields;
- it maps directly to `role_assignments.scope_type`, `project_id`, and `workspace_id`;
- it avoids a nested `scope` object that would require more UI and API churn without adding security;
- tenant id remains absent and server-derived.

Compatibility:

- if `scopeType` is omitted, treat the request as tenant scope only when `projectId` and `workspaceId` are also absent;
- this preserves existing tenant-only clients and tests;
- implementation should still return the expanded assignment shape.

Grant validation:

- `tenant` scope requires no `projectId` or `workspaceId`;
- `project` scope requires `projectId` and no `workspaceId`;
- `workspace` scope requires both `projectId` and `workspaceId`;
- project must belong to the active tenant and must be assignable;
- workspace must belong to the active tenant and provided project;
- target user must be a current member of the active tenant;
- role must be an active tenant custom role;
- system role must be rejected;
- archived role must be rejected;
- selected scope must have at least one effective capability;
- tenant id in body, if present, must be ignored or rejected as invalid body. Prefer rejecting unknown `tenantId` with `invalid_body` to avoid normalizing unsafe payloads.

Grant success:

```json
{
  "assignment": {
    "assignmentId": "uuid",
    "tenantId": "uuid",
    "userId": "uuid",
    "roleId": "uuid",
    "scopeType": "project",
    "projectId": "uuid",
    "projectName": "Spring portraits",
    "workspaceId": null,
    "workspaceName": null,
    "createdAt": "2026-05-01T10:00:00.000Z",
    "createdBy": "uuid",
    "revokedAt": null,
    "revokedBy": null,
    "role": {
      "roleId": "uuid",
      "name": "Project reviewer",
      "description": null,
      "capabilityKeys": ["review.workspace"],
      "archivedAt": null
    },
    "effectiveCapabilityKeys": ["review.workspace"],
    "ignoredCapabilityKeys": [],
    "hasScopeWarnings": false
  },
  "created": true
}
```

Status codes:

- `201` when a new active assignment is created;
- `200` when an exact active assignment already exists and is returned idempotently.

Grant errors:

- `401 unauthenticated`
- `403 tenant_member_management_forbidden`
- `400 invalid_body`
- `400 invalid_assignment_scope`
- `404 member_not_found`
- `404 custom_role_not_found`
- `404 assignment_project_not_found`
- `404 assignment_workspace_not_found`
- `409 custom_role_archived`
- `403 system_role_assignment_forbidden`
- `409 custom_role_assignment_no_effective_capabilities`
- `409 custom_role_assignment_conflict`

Use not-found style errors for cross-tenant project/workspace ids to avoid leaking other-tenant resources.

### Canonical revoke route

Add the new canonical route:

```text
DELETE /api/members/custom-role-assignments/[assignmentId]
```

No request body.

Validation:

- actor must be fixed owner/admin in active tenant;
- assignment id must belong to the active tenant;
- assignment must reference a tenant custom role (`is_system = false`);
- archived roles are allowed for revoke;
- revoked assignments return idempotently.

Success:

```json
{
  "assignment": {
    "...": "same expanded assignment shape"
  },
  "revoked": true
}
```

Repeated revoke:

```json
{
  "assignment": {
    "...": "same expanded assignment shape with revokedAt/revokedBy"
  },
  "revoked": false
}
```

Decision: return the existing revoked assignment when the assignment id exists but is already revoked. Assignment-id revoke is unambiguous, so returning the row gives the UI stable confirmation and supports retry-safe clients.

Errors:

- `401 unauthenticated`
- `403 tenant_member_management_forbidden`
- `400 invalid_body`
- `404 custom_role_assignment_not_found`
- `403 system_role_assignment_forbidden`
- `500 custom_role_assignment_revoke_failed`

### Legacy tenant revoke route

Keep the existing route:

```text
DELETE /api/members/[userId]/custom-roles/[roleId]
```

It remains tenant-only compatibility for Feature 084 behavior.

Rules:

- resolve only active tenant-scope assignment for `(tenantId, targetUserId, roleId)`;
- if none exists, return `{ assignment: null, revoked: false }` as today;
- if one exists, delegate to `revokeCustomRoleAssignment`;
- do not use this route for project/workspace UI;
- mark it as a compatibility path in comments/tests.

### List route

Keep:

```text
GET /api/members/custom-role-assignments
```

Default response remains active assignments only for the Members UI:

```json
{
  "assignableRoles": [],
  "members": [],
  "targets": {
    "projects": []
  }
}
```

Add optional query:

```text
?includeRevoked=1
```

When `includeRevoked=1`, include revoked custom role assignment rows in summaries. Do not make the Members table render full history in this feature unless the implementation finds an existing test/component path already expects it.

## Exact assignment data model

### AssignableCustomRole

```ts
type AssignableCustomRole = {
  roleId: string;
  name: string;
  description: string | null;
  capabilityKeys: TenantCapability[];
  archivedAt: string | null;
};
```

Assignable roles remain active custom roles only:

- `tenant_id = active tenant`;
- `is_system = false`;
- `archived_at is null`.

### CustomRoleAssignmentRecord

```ts
type CustomRoleAssignmentRecord = {
  assignmentId: string;
  tenantId: string;
  userId: string;
  roleId: string;
  scopeType: "tenant" | "project" | "workspace";
  projectId: string | null;
  projectName: string | null;
  workspaceId: string | null;
  workspaceName: string | null;
  createdAt: string;
  createdBy: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  role: AssignableCustomRole;
  effectiveCapabilityKeys: TenantCapability[];
  ignoredCapabilityKeys: TenantCapability[];
  hasScopeWarnings: boolean;
};
```

Use `projectName` and `workspaceName` directly in summary records instead of nested project/workspace objects. This keeps the UI row rendering simple and avoids creating a broad access-target model.

### MemberCustomRoleAssignmentSummary

```ts
type MemberCustomRoleAssignmentSummary = {
  userId: string;
  assignments: CustomRoleAssignmentRecord[];
};
```

Default list behavior:

- include active assignments only;
- include archived-role active assignments so owners/admins can see and revoke them;
- exclude system role assignments from custom-role assignment summaries;
- order by `created_at asc` and then target label for deterministic UI.

`includeRevoked` behavior:

- include active and revoked custom role assignments;
- retain `revokedAt` and `revokedBy`;
- still exclude system role assignments;
- intended for tests, history-capable API consumers, and future UI, not a broad history redesign in Feature 093.

### CustomRoleAssignmentTargetData

```ts
type CustomRoleAssignmentTargetData = {
  projects: Array<{
    projectId: string;
    name: string;
    status: string;
    finalizedAt: string | null;
    workspaces: Array<{
      workspaceId: string;
      projectId: string;
      name: string;
      workspaceKind: "default" | "photographer";
      workflowState: "active" | "handed_off" | "needs_changes" | "validated";
    }>;
  }>;
};
```

Targets are used for assignment selection only. They are not proof of operational access.

## Exact scope-effect helper plan

Add a small Feature 093 helper, tentatively:

```text
src/lib/tenant/custom-role-scope-effects.ts
```

It must not become the Feature 094 effective permission resolver.

Export:

```ts
type CapabilityScopeSupportValue = "yes" | "no" | "defer" | "not_applicable";

type CapabilityScopeSupport = {
  tenant: CapabilityScopeSupportValue;
  project: CapabilityScopeSupportValue;
  workspace: CapabilityScopeSupportValue;
};

type RoleScopeEffect = {
  scopeType: "tenant" | "project" | "workspace";
  effectiveCapabilityKeys: TenantCapability[];
  ignoredCapabilityKeys: TenantCapability[];
  hasScopeWarnings: boolean;
  hasZeroEffectiveCapabilities: boolean;
};

function getCapabilityScopeSupport(capabilityKey: TenantCapability): CapabilityScopeSupport;

function getRoleScopeEffect(
  capabilityKeys: readonly TenantCapability[],
  scopeType: "tenant" | "project" | "workspace",
): RoleScopeEffect;
```

The helper should encode the Feature 092 final matrix exactly:

- tenant `yes`: `organization_users.*`, `templates.manage`, `profiles.view`, `profiles.manage`, `projects.create`, `project_workspaces.manage`, `media_library.*`;
- tenant `defer`: capture, review, workflow, and correction operational capabilities;
- tenant `no` or `not_applicable`: none beyond the matrix values;
- project `yes`: `project_workspaces.manage`, capture, review, workflow, and correction capabilities as listed in Feature 092;
- project `no`: tenant-only org/template/profile/media library capabilities;
- project `not_applicable`: `projects.create`;
- workspace `yes`: capture, review, `workflow.reopen_workspace_for_correction`, and correction capabilities;
- workspace `no`: org/template/profile/media library, `project_workspaces.manage`, `workflow.finalize_project`, and `workflow.start_project_correction`;
- workspace `not_applicable`: `projects.create`.

Treatment:

- only `yes` is effective;
- `no`, `defer`, and `not_applicable` are ignored for the selected scope;
- `hasScopeWarnings = ignoredCapabilityKeys.length > 0`;
- grant rejects when `effectiveCapabilityKeys.length === 0`.

This helper is for assignment warnings and zero-effective rejection only. It must not:

- inspect users;
- inspect assignments;
- answer whether a user can perform an action;
- combine fixed owner/admin, reviewer access, photographer staffing, or public-token access;
- be wired into capture/review/workflow/correction authorization.

## Exact UI/i18n plan

### UI behavior

Keep all role administration owner/admin-only.

Do not change delegated Members UI except to ensure it still does not receive role editor, assignment target, custom role assignment, or reviewer access data.

In `MemberManagementPanel`:

- keep the existing restrained table/form style;
- do not add a new IAM dashboard;
- do not add hero copy, decorative cards, or broad access matrix;
- show assigned custom role labels with:
  - role name;
  - scope label;
  - project target name for project/workspace assignments;
  - workspace target name for workspace assignments;
  - archived role marker when relevant;
  - warning marker when `hasScopeWarnings`;
  - revoked marker only if rendering a history view.

Assignment controls per member:

- select role;
- select scope using a normal select or segmented radio group:
  - tenant;
  - project;
  - workspace;
- show project picker when scope is project or workspace;
- show workspace picker when scope is workspace and a project is selected;
- group workspaces by selected project;
- disable assignment until required scope fields are selected;
- show mixed-scope warning before assignment when selected role plus selected scope has ignored capabilities;
- block zero-effective-capability assignment client-side and server-side;
- submit to existing `POST /api/members/[userId]/custom-roles` with the expanded flat body;
- revoke using assignment id through `DELETE /api/members/custom-role-assignments/[assignmentId]`;
- use `router.refresh()` after writes.

Scope warning display:

- for mixed scope, show one short warning line near the assignment controls:
  - effective capability labels;
  - ignored capability labels;
  - do not over-explain future enforcement.
- for zero effective capabilities, show blocking validation:
  - the selected role has no capabilities that apply at this scope.

Assigned role display:

- tenant target label: `All organization`;
- project target label: project name;
- workspace target label: `{projectName} / {workspaceName}`;
- if target project/workspace has been deleted and FK cascade did not leave a row, the assignment should be gone. If a label lookup is missing unexpectedly, show an i18n fallback such as `Unknown target` and keep revoke available by id.

### i18n keys

Add under `members.customRoleAssignments` in both `messages/en.json` and `messages/nl.json`.

Recommended English keys:

- `scopeLabel`: `Scope`
- `scopeTenant`: `Organization`
- `scopeProject`: `Project`
- `scopeWorkspace`: `Workspace`
- `targetLabel`: `Target`
- `projectLabel`: `Project`
- `workspaceLabel`: `Workspace`
- `projectPlaceholder`: `Select a project`
- `workspacePlaceholder`: `Select a workspace`
- `allOrganizationTarget`: `All organization`
- `unknownTarget`: `Unknown target`
- `scopeWarning`: `Some role capabilities do not apply at this scope.`
- `effectiveCapabilities`: `Applies here: {capabilities}`
- `ignoredCapabilities`: `Ignored here: {capabilities}`
- `zeroEffectiveCapabilities`: `This role has no capabilities that apply at the selected scope.`
- `scopeProjectRequired`: `Select a project before assigning this role.`
- `scopeWorkspaceRequired`: `Select a workspace before assigning this role.`
- `errors.invalidScope`: `Select a valid assignment scope.`
- `errors.projectNotFound`: `Project not found.`
- `errors.workspaceNotFound`: `Workspace not found.`
- `errors.zeroEffectiveCapabilities`: `This role has no capabilities that apply at that scope.`

Recommended Dutch keys:

- `scopeLabel`: `Scope`
- `scopeTenant`: `Organisatie`
- `scopeProject`: `Project`
- `scopeWorkspace`: `Workspace`
- `targetLabel`: `Doel`
- `projectLabel`: `Project`
- `workspaceLabel`: `Workspace`
- `projectPlaceholder`: `Selecteer een project`
- `workspacePlaceholder`: `Selecteer een workspace`
- `allOrganizationTarget`: `Hele organisatie`
- `unknownTarget`: `Onbekend doel`
- `scopeWarning`: `Sommige mogelijkheden van deze rol gelden niet voor deze scope.`
- `effectiveCapabilities`: `Geldt hier: {capabilities}`
- `ignoredCapabilities`: `Genegeerd hier: {capabilities}`
- `zeroEffectiveCapabilities`: `Deze rol heeft geen mogelijkheden die gelden voor de gekozen scope.`
- `scopeProjectRequired`: `Selecteer een project voordat je deze rol toewijst.`
- `scopeWorkspaceRequired`: `Selecteer een workspace voordat je deze rol toewijst.`
- `errors.invalidScope`: `Selecteer een geldige toewijzingsscope.`
- `errors.projectNotFound`: `Project niet gevonden.`
- `errors.workspaceNotFound`: `Workspace niet gevonden.`
- `errors.zeroEffectiveCapabilities`: `Deze rol heeft geen mogelijkheden die gelden voor die scope.`

Reuse existing capability labels through `members.capabilities.*` and `CAPABILITY_LABEL_KEYS`. Do not duplicate capability names in new strings.

## Project/workspace assignment-target loader plan

Add a bounded loader owned by role assignment, not project administration:

```ts
listCustomRoleAssignmentTargets(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
}): Promise<CustomRoleAssignmentTargetData>
```

Authorization:

- fixed owner/admin through the same `assertTenantMemberManager`;
- do not authorize through `projects.create`, `project_workspaces.manage`, or `organization_users.*`;
- do not send this data to delegated Members UI.

Data:

- projects: `id`, `name`, `status`, `finalized_at`;
- workspaces: `id`, `tenant_id`, `project_id`, `workspace_kind`, `name`, `workflow_state`;
- sort projects by `created_at desc` or name if the UI needs stable alphabetical assignment selection;
- sort workspaces by default workspace first, then created time/name.

Target inclusion decision:

- include active and finalized projects that still exist, because assignments may be prepared for future resolver behavior and finalized projects still have release/history relevance;
- exclude `projects.status = 'archived'` from new assignment pickers to avoid granting roles on projects that no longer accept normal workflow changes;
- include workspaces for included projects regardless of `workflow_state`, because assignment itself does not change workflow state and Feature 094+ will handle enforcement separately;
- no separate workspace archived state exists in the verified schema.

Boundary validation on grant must not trust the preloaded target list. It must re-check:

- project belongs to active tenant and is not archived;
- workspace belongs to active tenant and provided project.

Integration:

- extend `TenantMemberManagementData` with `customRoleAssignmentTargets`;
- extend `resolveCustomRoleAssignmentSummary` or return a sibling field from `getTenantMemberManagementData`;
- recommended: `resolveCustomRoleAssignmentSummary` returns `targets` so the GET route and Members data share the same shape.

## Migration decision

No migration is planned for Feature 093.

Reason:

- `role_assignments` already supports `tenant`, `project`, and `workspace` scopes;
- it already has `project_id` and `workspace_id`;
- it already has active unique indexes for exact tenant/project/workspace assignments;
- it already has membership, project, and workspace FKs with tenant alignment;
- it already has revoke shape constraints;
- it already has the role-definition tenant guard;
- it already rejects active assignments to archived tenant roles;
- authenticated users already lack direct write grants.

If implementation unexpectedly finds a real schema blocker, stop and update this plan before adding a migration. The only plausible small migration would be a targeted RLS/grant tightening if direct authenticated writes are discovered, but current verification and Feature 091 tests indicate none is needed.

## Security considerations

Feature 093 must preserve:

- tenant id server-derived from authenticated session/active tenant context;
- no client-provided `tenant_id`;
- owner/admin-only role assignment administration;
- delegated `organization_users.*` users cannot list assignment admin data, grant, or revoke;
- operational custom roles do not grant role administration;
- service-role writes happen only after actor, target membership, role, scope, and boundary validation;
- system roles cannot be assigned or revoked through custom role assignment routes;
- archived roles cannot be newly assigned;
- archived active assignments remain visible and revokable;
- revoked assignments do not count as active;
- cross-tenant project ids are rejected;
- cross-tenant workspace ids are rejected;
- workspace/project mismatches are rejected;
- zero-effective-capability assignments are rejected;
- scoped assignments do not enforce operational route permissions yet;
- assignment target data is not sent to delegated Members UI;
- direct authenticated writes to role tables remain denied.

Service comments should be concise and explain why:

- assignment administration remains fixed owner/admin-only;
- scope-effect metadata is warning-only and not authorization;
- assignment-id revoke is required because user/role revoke becomes ambiguous across scopes.

## Edge cases

- Duplicate exact grant at the same scope returns the existing active assignment with `created: false`.
- Same user/role at tenant and project scopes is allowed.
- Same user/role in two different projects is allowed.
- Same user/role in two different workspaces is allowed.
- Re-add after revoke creates a new active row; do not clear revocation fields on old rows.
- Concurrent grants rely on active unique indexes and re-read after unique violation.
- Repeated assignment-id revoke returns the revoked row with `revoked: false`.
- Legacy tenant revoke with no active tenant-scope row returns `{ assignment: null, revoked: false }`.
- A role edited after assignment should update displayed name/capabilities and recalculated effective/ignored metadata.
- A role archived after assignment remains visible and revokable but not assignable.
- A project archived after assignment should not be selectable for new grants; existing active assignments should remain visible and revokable unless FK cascade removed them.
- A project or workspace deletion cascades assignment rows through existing FKs.
- Session expiry returns unauthenticated through existing route utilities.
- Partial failure after DB grant but before response is handled by idempotent retry.
- Partial failure after revoke but before response is handled by assignment-id repeated revoke.

## Test plan

Create:

```text
tests/feature-093-scoped-custom-role-assignment-foundation.test.ts
```

Required service/API tests:

- owner/admin can assign tenant role as before;
- owner/admin can assign project-scoped custom role;
- owner/admin can assign workspace-scoped custom role;
- duplicate grants are idempotent per exact scope;
- same user/role can have tenant and project assignments without conflict;
- same user/role can have assignments in two projects;
- same user/role can have assignments in two workspaces;
- project/workspace mismatch is rejected;
- cross-tenant project is rejected;
- cross-tenant workspace is rejected;
- system role is rejected;
- archived role is rejected;
- non-member target is rejected;
- non-owner/admin is rejected;
- delegated `organization_users.*` actor is rejected;
- operational custom-role actor is rejected;
- zero-effective-capability assignment is rejected;
- mixed-scope assignment returns effective and ignored capability metadata;
- assignment-id revoke revokes exactly one assignment;
- repeated assignment-id revoke is idempotent;
- existing tenant-only grant remains compatible when `scopeType` is omitted;
- existing tenant-only revoke route remains compatible;
- direct authenticated writes remain denied.

Scope-effect helper tests:

- every `TENANT_CAPABILITIES` key has matrix support;
- tenant-scope role with tenant-only capabilities has effective capabilities;
- workspace-scope role with tenant-only capabilities has zero effective capabilities;
- mixed role such as `templates.manage` plus `capture.upload_assets` at workspace scope returns `capture.upload_assets` effective and `templates.manage` ignored;
- tenant-scope operational deferred capability is ignored and can cause zero-effective rejection;
- project-scope `project_workspaces.manage` is effective;
- workspace-scope `project_workspaces.manage` is ignored;
- project-scope `workflow.finalize_project` is effective;
- workspace-scope `workflow.finalize_project` is ignored.

Assignment target loader tests:

- owner/admin receives active non-archived projects;
- archived projects are excluded from assignment targets;
- workspaces are grouped under their projects;
- target loader is denied to delegated users;
- grant revalidates project/workspace boundaries even if ids are manually posted.

UI/component tests:

- Members UI renders tenant/project/workspace scope labels;
- Members UI renders project and workspace target names;
- project picker appears for project/workspace scope;
- workspace picker appears for workspace scope;
- mixed-scope warning renders with effective and ignored capability labels;
- zero-effective assignment is blocked client-side;
- revoke uses assignment id rather than role id for scoped assignments;
- delegated UI still does not render assignment admin controls or receive assignment target data.

Regression tests to keep green:

- Feature 081 role assignment foundation;
- Feature 083 custom role editor foundation;
- Feature 084 custom role assignment foundation;
- Feature 087 project-admin custom-role enforcement;
- Feature 088/089 delegated organization-user enforcement;
- Feature 091 owner/admin role-administration consolidation.

Verification commands for implementation phase:

```powershell
npm test -- tests/feature-093-scoped-custom-role-assignment-foundation.test.ts
npm test -- tests/feature-081-role-assignment-foundation.test.ts tests/feature-084-custom-role-assignment-foundation.test.ts tests/feature-087-project-admin-custom-role-enforcement.test.ts tests/feature-091-owner-admin-role-administration-consolidation.test.ts
npm run lint
```

If the test runner does not support file arguments, use the closest supported command and document the limitation.

## Implementation phases

### Phase 1 - Scope-effect helper

- Add `custom-role-scope-effects.ts`.
- Encode the Feature 092 matrix exactly.
- Add focused unit tests for `getCapabilityScopeSupport` and `getRoleScopeEffect`.

Validation:

- every catalog capability has matrix coverage;
- no operational resolver behavior is introduced.

### Phase 2 - Assignment service expansion

- Extend assignment scope types and record shapes.
- Add target loading helpers.
- Add project/workspace validation helpers.
- Add scoped grant support.
- Add assignment-id revoke.
- Keep legacy tenant revoke wrapper.

Validation:

- service tests cover tenant/project/workspace lifecycle and idempotency.

### Phase 3 - API routes

- Extend `POST /api/members/[userId]/custom-roles`.
- Add `DELETE /api/members/custom-role-assignments/[assignmentId]`.
- Keep `DELETE /api/members/[userId]/custom-roles/[roleId]` as tenant-only compatibility.
- Extend `GET /api/members/custom-role-assignments` with targets and optional `includeRevoked=1`.

Validation:

- route/API tests cover request shapes, status codes, and error codes.

### Phase 4 - Members data and UI

- Extend `TenantMemberManagementData`.
- Pass assignment target data only to `MemberManagementPanel`.
- Update assignment controls for scope/project/workspace selection.
- Render scope target labels and warnings.
- Switch scoped revoke UI to assignment-id route.
- Add English and Dutch messages.

Validation:

- component tests and manual Members page check on desktop/mobile if implementation touches layout substantially.

### Phase 5 - Security and direct-write regression

- Add delegated denial tests.
- Add direct authenticated write-denial regression.
- Prove operational route enforcement remains unchanged.

Validation:

- Feature 091 boundary remains intact.

### Phase 6 - Regression pass

- Run targeted Feature 093 tests.
- Run related Feature 081/084/087/091 tests.
- Run lint.
- Run full `npm test` if practical.

## Scope boundaries

Do implement:

- scoped custom role assignment administration;
- assignment scope warning metadata;
- assignment-id scoped revoke;
- Members UI controls for tenant/project/workspace assignment;
- target loading for owner/admin Members data;
- tests for scope validation, idempotency, warning metadata, and security boundaries.

Do not implement:

- effective operational permission resolver;
- SQL custom-role scoped resolver;
- capture/review/workflow/correction route enforcement;
- reviewer access conversion;
- photographer assignment conversion;
- new capability keys;
- delegated role administration;
- broad Members/IAM redesign;
- new role assignment table;
- migration unless a verified blocker appears.

## Feature 094 handoff

Feature 094 can consume these Feature 093 outputs:

- scoped custom role assignment rows exist for tenant/project/workspace scopes;
- assignments contain validated tenant/project/workspace boundaries;
- assignment-id revoke is canonical and unambiguous;
- assignment summaries expose scope metadata and target labels;
- scope-effect metadata exists for warning UI:
  - effective capability keys;
  - ignored capability keys;
  - `hasScopeWarnings`;
- zero-effective-capability rows are not created through the service/API.

Still unchanged after Feature 093:

- operational routes do not read project/workspace custom role assignments;
- TypeScript and SQL effective scoped capability resolver is not implemented;
- reviewer access remains a separate system reviewer assignment model;
- photographer workspace assignment remains separate staffing/capture logic;
- fixed owner/admin safety remains explicit.

Feature 094 should implement the real scoped effective capability resolver and SQL/TypeScript parity strategy without treating Feature 093 warning metadata as authorization.

## Concise implementation prompt

Implement Feature 093 from this plan. Extend the existing custom role assignment service to support `tenant`, `project`, and `workspace` assignment scopes using the existing `role_assignments` table. Add a small Feature 092 matrix-backed scope-effect helper for assignment warnings only. Preserve tenant-only grant compatibility, add assignment-id based revoke as the canonical scoped revoke path, validate target membership, active tenant custom role, project/workspace boundaries, and zero-effective-capability rejection, and keep role administration fixed owner/admin-only.

Extend the owner/admin Members page with restrained scope/project/workspace assignment controls, target labels, mixed-scope warnings, and assignment-id revoke. Add owner/admin-only assignment target loading for active non-archived projects and their workspaces. Do not add a migration unless a real blocker is found. Do not migrate operational route enforcement, add capability keys, delegate role administration, convert reviewer or photographer access, or build a broad IAM dashboard. Add `tests/feature-093-scoped-custom-role-assignment-foundation.test.ts` covering scoped grant/revoke/idempotency/security/UI behavior and keep Feature 081/084/087/091 regressions green.
