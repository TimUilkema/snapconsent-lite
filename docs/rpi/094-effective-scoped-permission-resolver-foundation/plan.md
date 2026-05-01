# Feature 094 Plan - Effective Scoped Permission Resolver Foundation

## Scope and contract

Feature 094 adds a resolver foundation only. It must not migrate live capture, review, workflow, correction, Media Library, template, profile, project administration, or organization-user callers to a new authorization path.

In scope:

- add a bounded TypeScript effective capability resolver across current SnapConsent permission sources;
- add one SQL helper migration for scoped custom-role capability checks;
- add source-aware metadata for tests and future effective-access UI;
- add tests for resolver union behavior, SQL parity, and existing tenant-only parity;
- preserve current operational route behavior.

Out of scope:

- route migration for capture, review, workflow, or correction;
- route authorization behavior changes;
- capability key additions, removals, or renames;
- effective access UI;
- cleanup or removal of old permission helpers;
- role administration delegation;
- conversion of reviewer access or photographer staffing into custom roles;
- broad IAM engine work.

The implementation contract is: Feature 094 may create new resolver APIs, a new SQL helper, and tests that call them directly, but existing production call sites should keep using their current helpers until later feature slices.

## Inputs and ground truth

Primary synthesized input:

- `docs/rpi/094-effective-scoped-permission-resolver-foundation/research.md`

Required context and prior plans were read:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `UNCODEXIFY.md`
- `docs/rpi/README.md`
- `docs/rpi/SUMMARY.md`
- `docs/rpi/092-capability-scope-semantics-and-permission-migration-map/plan.md`
- `docs/rpi/093-scoped-custom-role-assignment-foundation/plan.md`
- `docs/rpi/081-custom-role-definitions-and-scoped-role-assignment-foundation/plan.md`
- `docs/rpi/082-project-scoped-reviewer-assignments-and-enforcement/plan.md`
- `docs/rpi/091-owner-admin-role-administration-consolidation/plan.md`

Targeted live verification covered:

- `src/lib/tenant/custom-role-scope-effects.ts`
- `src/lib/tenant/custom-role-assignment-service.ts`
- `tests/feature-093-scoped-custom-role-assignment-foundation.test.ts`
- `src/lib/tenant/role-capabilities.ts`
- `src/lib/tenant/permissions.ts`
- `src/lib/tenant/tenant-membership.ts`
- `src/lib/tenant/resolve-tenant.ts`
- `src/lib/tenant/reviewer-access-service.ts`
- `tests/feature-082-reviewer-access-assignments.test.ts`
- `src/lib/projects/project-workspaces-service.ts`
- `src/lib/projects/project-workspace-request.ts`
- `src/lib/tenant/tenant-custom-role-capabilities.ts`
- `src/lib/tenant/media-library-custom-role-access.ts`
- `src/lib/templates/template-service.ts`
- `src/lib/profiles/profile-access.ts`
- `src/lib/projects/project-administration-service.ts`
- `src/lib/tenant/organization-user-access.ts`
- SQL migrations for Features 082, 085, 086, 087, 088, and 089

Live code, migrations, and tests are authoritative over RPI history.

## Drift from research

No plan-changing drift was found.

Confirmed non-blocking drift remains:

- Feature 082 test filename is `tests/feature-082-reviewer-access-assignments.test.ts`, not the longer plan-era name.
- `rg` is unavailable in this local shell; targeted verification used PowerShell file search and `Select-String`.
- RPI/SUMMARY remains historically stale around later feature verification and Feature 087 naming, but live files are clear.

## Chosen architecture

Choose Option B from research: a constrained SnapConsent effective capability resolver across all current permission sources.

Add:

- `src/lib/tenant/effective-permissions.ts`

Do not duplicate the scope matrix. The resolver must import and reuse:

- `getCapabilityScopeSupport`
- `getRoleScopeEffect`
- `RoleAssignmentScopeType`
- `CapabilityScopeSupportValue`

from `src/lib/tenant/custom-role-scope-effects.ts`.

The resolver combines these sources:

- fixed membership role capabilities;
- tenant-wide and project reviewer assignments;
- fixed photographer workspace assignments;
- tenant custom role assignments;
- project custom role assignments;
- workspace custom role assignments.

The resolver does not become a generic IAM engine. It does not validate workflow state, correction state, public tokens, release snapshot immutability, route-specific not-found semantics beyond project/workspace scope validation, or role administration.

SQL strategy is narrower: add a custom-role-only scoped SQL helper for RLS parity and future surface wrappers. Do not add a broad SQL `current_user_has_effective_capability` helper in Feature 094.

## Exact TypeScript API plan

Add `src/lib/tenant/effective-permissions.ts`.

Export these helpers:

- `resolveEffectiveCapabilities(input)`
- `userHasEffectiveCapability(input)`
- `assertEffectiveCapability(input)`
- `resolveEffectiveTenantCapabilities(input)`
- `resolveEffectiveProjectCapabilities(input)`
- `resolveEffectiveWorkspaceCapabilities(input)`
- `assertEffectiveTenantCapability(input)`
- `assertEffectiveProjectCapability(input)`
- `assertEffectiveWorkspaceCapability(input)`

Recommended core input types:

```ts
export type EffectivePermissionScope =
  | { scopeType: "tenant" }
  | { scopeType: "project"; projectId: string }
  | { scopeType: "workspace"; projectId: string; workspaceId: string };

export type ResolveEffectiveCapabilitiesInput = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  scope: EffectivePermissionScope;
  capabilityKey?: TenantCapability;
  adminSupabase?: SupabaseClient;
};

export type EffectiveCapabilityCheckInput = ResolveEffectiveCapabilitiesInput & {
  capabilityKey: TenantCapability;
};
```

Convenience helper inputs:

- tenant helpers accept `supabase`, `tenantId`, `userId`, optional `capabilityKey`, and optional `adminSupabase`;
- project helpers accept those fields plus `projectId`;
- workspace helpers accept those fields plus `projectId` and `workspaceId`.

Recommended output types:

```ts
export type EffectiveCapabilityDenialReason =
  | "no_tenant_membership"
  | "project_not_found"
  | "workspace_not_found"
  | "capability_not_supported_at_scope"
  | "not_granted"
  | "lookup_failed";

export type IgnoredEffectiveCapability = {
  sourceType: "custom_role_assignment";
  assignmentId: string;
  roleId: string;
  roleName: string;
  assignmentScopeType: RoleAssignmentScopeType;
  projectId: string | null;
  workspaceId: string | null;
  capabilityKey: TenantCapability;
  assignmentScopeSupport: CapabilityScopeSupportValue;
  requestedScopeSupport: CapabilityScopeSupportValue;
  reason:
    | "assignment_scope_not_effective"
    | "requested_scope_not_supported"
    | "wrong_project"
    | "wrong_workspace";
};

export type EffectiveCapabilitiesResolution = {
  tenantId: string;
  userId: string;
  membershipRole: MembershipRole;
  scope: EffectivePermissionScope;
  capabilityKeys: TenantCapability[];
  sources: EffectiveCapabilitySource[];
  ignoredCapabilities: IgnoredEffectiveCapability[];
};

export type EffectiveCapabilityCheck = {
  allowed: boolean;
  tenantId: string;
  userId: string;
  scope: EffectivePermissionScope;
  capabilityKey: TenantCapability;
  sources: EffectiveCapabilitySource[];
  denialReason: EffectiveCapabilityDenialReason | null;
};
```

`resolveEffectiveCapabilities` returns the full source-aware resolution. If `capabilityKey` is provided, it may still return all effective capabilities for the scope, but it must populate source metadata sufficiently for `userHasEffectiveCapability` without an additional lookup.

`userHasEffectiveCapability` returns a check object and does not throw for normal denial. It may throw only for unexpected lookup failures if the implementation cannot safely classify the error.

`assertEffectiveCapability` throws `HttpError` on denial:

- `403`, `effective_capability_forbidden` for `not_granted`;
- `403`, `effective_capability_scope_forbidden` for `capability_not_supported_at_scope`;
- `500`, `effective_permission_lookup_failed` for unexpected resolver read failures.

Membership and object validation should preserve existing codes where appropriate:

- no membership comes from `resolveTenantMembership` as `403 no_tenant_membership`;
- wrong or missing project should throw `404 project_not_found`;
- wrong or missing workspace should throw `404 workspace_not_found`.

The assertion helpers return the successful `EffectiveCapabilityCheck` so tests and later route wrappers can inspect source metadata.

## Exact source metadata model

Export `EffectiveCapabilitySource` as this discriminated union:

```ts
export type EffectiveCapabilitySource =
  | FixedRoleCapabilitySource
  | SystemReviewerAssignmentCapabilitySource
  | PhotographerWorkspaceAssignmentCapabilitySource
  | CustomRoleAssignmentCapabilitySource;
```

### `fixed_role`

Fields:

- `sourceType: "fixed_role"`
- `role: MembershipRole`
- `capabilityKeys: TenantCapability[]`

This source must not include role administration capability keys because none exist. It must not represent reviewer assignment-gated or photographer staffing-gated capabilities for reviewer/photographer members.

### `system_reviewer_assignment`

Fields:

- `sourceType: "system_reviewer_assignment"`
- `assignmentId: string`
- `assignmentScopeType: "tenant" | "project"`
- `projectId: string | null`
- `capabilityKeys: TenantCapability[]`

This source represents active system reviewer role assignments only. It must be separate from custom role metadata even though both use `role_assignments`.

### `photographer_workspace_assignment`

Fields:

- `sourceType: "photographer_workspace_assignment"`
- `projectId: string`
- `workspaceId: string`
- `workspaceName: string | null`
- `capabilityKeys: TenantCapability[]`

This source represents `project_workspaces.photographer_user_id = userId` for a fixed photographer member.

### `custom_role_assignment`

Fields:

- `sourceType: "custom_role_assignment"`
- `assignmentId: string`
- `roleId: string`
- `roleName: string`
- `roleDescription: string | null`
- `assignmentScopeType: RoleAssignmentScopeType`
- `projectId: string | null`
- `workspaceId: string | null`
- `capabilityKeys: TenantCapability[]`
- `ignoredCapabilityKeys: TenantCapability[]`

Only include tenant-local non-system custom roles. Archived roles and revoked assignments are not effective sources.

Metadata must be useful for tests and future UI, but must not expose cross-tenant rows. Every service-role query must filter by `tenantId` and `userId`, and project/workspace ids must be validated against that tenant.

## Fixed role behavior

Fixed owner/admin:

- include as `fixed_role` sources for operational capability checks;
- grant capabilities according to the requested scope using the Feature 092 scope matrix;
- at tenant scope, grant capabilities with tenant support `yes`;
- at project scope, grant capabilities with project support `yes`;
- at workspace scope, grant capabilities with workspace support `yes`;
- do not make `defer`, `no`, or `not_applicable` meaningful for a requested scope;
- do not authorize role administration through the resolver.

Fixed reviewer:

- fixed reviewer role is eligibility for system reviewer assignments;
- fixed reviewer role alone should not grant review, workflow, correction, or Media Library capabilities;
- fixed reviewer may still contribute `profiles.view` as a `fixed_role` source at tenant scope, matching current catalog behavior;
- reviewer operational access is added through `system_reviewer_assignment` sources only.

Fixed photographer:

- fixed photographer role is eligibility for photographer workspace assignment;
- fixed photographer role alone should not grant capture capabilities in the effective resolver;
- fixed photographer may still contribute `profiles.view` as a `fixed_role` source at tenant scope;
- capture access is added through `photographer_workspace_assignment` sources only.

Role administration remains fixed owner/admin-only through existing services such as custom role editor, custom role assignment, and reviewer access administration. Feature 094 must not add role-administration capability keys or route role-administration checks through this resolver.

## Reviewer assignment behavior

Reviewer sources count only for members whose fixed `memberships.role` is `reviewer`.

Tenant-wide reviewer assignment:

- source is an active tenant-scope assignment of the system reviewer role;
- grants tenant Media Library capabilities:
  - `media_library.access`
  - `media_library.manage_folders`
- grants project-scope reviewer/workflow/correction capabilities for any project:
  - `review.workspace`
  - `review.initiate_consent_upgrade_requests`
  - `workflow.finalize_project`
  - `workflow.start_project_correction`
  - `workflow.reopen_workspace_for_correction`
  - `correction.review`
  - `correction.consent_intake`
  - `correction.media_intake`
- grants workspace-scope reviewer/workflow/correction capabilities where workspace support is `yes`:
  - `review.workspace`
  - `review.initiate_consent_upgrade_requests`
  - `workflow.reopen_workspace_for_correction`
  - `correction.review`
  - `correction.consent_intake`
  - `correction.media_intake`
- does not grant `workflow.finalize_project` or `workflow.start_project_correction` at workspace scope because the matrix says workspace `no`.

Project reviewer assignment:

- source is an active project-scope assignment of the system reviewer role for the matching project;
- grants the same project-scope reviewer/workflow/correction capabilities as tenant-wide reviewer, but only for that project;
- grants the same workspace-scope reviewer/workflow/correction capabilities for workspaces in that project;
- does not grant Media Library access or folder management;
- does not grant capture capabilities.

Workspace-scope system reviewer assignments are not part of current product behavior and should not grant anything in Feature 094.

Source metadata must identify reviewer assignment source type, assignment id, assignment scope, and project id where present.

## Photographer assignment behavior

Photographer sources count only for members whose fixed `memberships.role` is `photographer`.

An assigned photographer workspace source is present only when:

- the requested scope is a workspace scope;
- `project_workspaces.tenant_id = tenantId`;
- `project_workspaces.project_id = projectId`;
- `project_workspaces.id = workspaceId`;
- `project_workspaces.photographer_user_id = userId`.

The source grants only workspace-scope capture capabilities:

- `capture.workspace`
- `capture.create_one_off_invites`
- `capture.create_recurring_project_consent_requests`
- `capture.upload_assets`

It does not grant project-wide capture, review, workflow, correction, Media Library, template, profile management, organization-user, or role-administration capabilities.

Owner/admin fixed roles still grant broad capture according to requested scope. Custom-role capture assignment does not require fixed photographer role.

## Custom role assignment behavior

Custom role sources use only active tenant-local custom role assignments:

- `role_assignments.revoked_at is null`;
- `role_definitions.is_system = false`;
- `role_definitions.tenant_id = tenantId`;
- `role_definitions.archived_at is null`;
- `role_definition_capabilities.capability_key` matches a known `TenantCapability`.

System role definitions are ignored in the custom-role path. Cross-tenant rows must not be returned by the resolver.

Grant rules are additive and scope-aware:

- tenant resolution includes tenant custom role assignments only when the capability's tenant support is `yes`;
- project resolution includes tenant custom role assignments when tenant support is `yes` and project support is `yes`;
- project resolution includes matching project custom role assignments when project support is `yes`;
- workspace resolution includes tenant custom role assignments when tenant support is `yes` and workspace support is `yes`;
- workspace resolution includes matching project custom role assignments when workspace support is `yes`;
- workspace resolution includes matching workspace custom role assignments when workspace support is `yes`;
- `defer`, `no`, and `not_applicable` never grant;
- wrong project and wrong workspace assignments do not grant;
- revoked assignments do not grant;
- archived custom roles do not grant.

Important examples:

- a tenant custom role with `project_workspaces.manage` grants project workspace administration for projects because tenant support and project support are both `yes`;
- a tenant custom role with `templates.manage` does not grant a project-scoped check because project support is `no`;
- a tenant custom role with `capture.upload_assets` does not grant because tenant support is `defer`;
- a project custom role with `capture.upload_assets` grants matching project and workspace checks according to project/workspace support;
- a workspace custom role with `workflow.finalize_project` does not grant workspace checks because workspace support is `no`.

The resolver should expose ignored custom-role capability metadata for matching assignments where the role contains capabilities that are ineffective at the requested scope.

## Source precedence and union rules

Permissions are additive.

Rules:

- if any source grants the requested capability, the check is allowed;
- there are no deny rules;
- source order is for deterministic output only, not precedence;
- recommended source ordering is `fixed_role`, `system_reviewer_assignment`, `photographer_workspace_assignment`, then `custom_role_assignment`;
- duplicate capabilities across sources should appear once in `capabilityKeys`;
- source metadata should keep each contributing source so tests and future UI can explain why access exists;
- ignored metadata must not reduce effective grants from another source.

Unsupported requested scope handling:

- if the requested scope support for a capability is `no` or `not_applicable`, `userHasEffectiveCapability` should return denied with `capability_not_supported_at_scope`;
- if requested scope support is `defer`, only explicit special sources can grant if this plan names them. Current special sources do not grant tenant-scope deferred operational capabilities, so tenant checks for capture/review/workflow/correction should deny.

## SQL helper/migration plan

Feature 094 needs one SQL helper migration and no table/schema migration.

Add migration:

- `supabase/migrations/<timestamp>_094_scoped_custom_role_capability_helper.sql`

Add lower-level custom-role-only helper:

```sql
create or replace function app.current_user_has_scoped_custom_role_capability(
  p_tenant_id uuid,
  p_capability_key text,
  p_project_id uuid default null,
  p_workspace_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  ...
$$;
```

Grant/revoke:

- `revoke all on function app.current_user_has_scoped_custom_role_capability(uuid, text, uuid, uuid) from public;`
- `grant execute on function app.current_user_has_scoped_custom_role_capability(uuid, text, uuid, uuid) to authenticated;`

Do not add a public wrapper unless the implementation discovers the existing test harness cannot call app-schema helpers directly. Prefer no public wrapper for this foundation function.

The SQL helper is custom-role-only. It must not include fixed owner/admin, system reviewer assignments, or photographer workspace assignment logic. Later route-specific SQL/RLS wrappers can combine fixed, reviewer, photographer, and this custom-role helper as needed.

SQL context rules:

- tenant context: `p_project_id is null and p_workspace_id is null`;
- project context: `p_project_id is not null and p_workspace_id is null`;
- workspace context: `p_project_id is not null and p_workspace_id is not null`;
- `p_workspace_id is not null and p_project_id is null` returns false.

The function must validate context by existence:

- project context requires a project with `id = p_project_id` and `tenant_id = p_tenant_id`;
- workspace context requires a workspace with `id = p_workspace_id`, `project_id = p_project_id`, and `tenant_id = p_tenant_id`.

The helper should inline the same capability scope matrix as SQL data, using a `values` expression with:

- `capability_key`
- `tenant_support`
- `project_support`
- `workspace_support`

Tests must enforce parity with `custom-role-scope-effects.ts` because SQL cannot directly import TypeScript constants.

SQL grant logic:

- require `auth.uid()`;
- require current membership row for `p_tenant_id`;
- use active `role_assignments` for `auth.uid()` and `p_tenant_id`;
- join `role_definitions` with `is_system = false`, matching tenant, and `archived_at is null`;
- join `role_definition_capabilities` for `p_capability_key`;
- tenant context grants only tenant assignment rows where tenant support is `yes`;
- project context grants tenant assignment rows where tenant support is `yes` and project support is `yes`, or project assignment rows matching `p_project_id` where project support is `yes`;
- workspace context grants tenant assignment rows where tenant support is `yes` and workspace support is `yes`, project assignment rows matching `p_project_id` where workspace support is `yes`, or workspace assignment rows matching both project and workspace where workspace support is `yes`;
- `defer`, `no`, and `not_applicable` never grant.

Existing SQL helpers stay unchanged in Feature 094:

- `app.current_user_has_tenant_custom_role_capability`
- Media Library wrappers;
- template/profile wrappers;
- project administration wrappers;
- organization-user wrappers;
- reviewer access helpers;
- capture/review/workflow/correction wrappers.

Do not make RLS policies broadly use this new helper in Feature 094.

## Service-role access plan

The TypeScript resolver should use request-scoped Supabase first:

1. Resolve tenant membership with `resolveTenantMembership`.
2. Validate explicit project/workspace scope against `tenantId` after membership validation.
3. Use a service-role client only for metadata reads that RLS may hide or fragment.

The resolver should accept `adminSupabase?: SupabaseClient` for tests and for callers that already have a safe server-only admin client. If not provided, create the service-role client using the existing server-only pattern used by reviewer/custom-role helpers.

All service-role reads must filter by:

- `tenantId`;
- `userId` for assignments;
- `projectId` and `workspaceId` where applicable.

Read failures should be neutral and non-leaky:

- membership failure keeps `no_tenant_membership`;
- project/workspace absence returns the same 404 codes used by current helpers;
- unexpected service-role read errors become `effective_permission_lookup_failed` or `lookup_failed` in non-throwing check results.

Do not let callers pass client-provided tenant authority. Route helpers in later features must derive `tenantId` through active tenant/session utilities before calling the resolver.

## Existing surface interaction plan

Do not migrate existing tenant-only callers in Feature 094.

Leave these current paths unchanged:

- `src/lib/tenant/media-library-custom-role-access.ts`
- `src/lib/templates/template-service.ts`
- `src/lib/profiles/profile-access.ts`
- `src/lib/projects/project-administration-service.ts`
- `src/lib/tenant/organization-user-access.ts`
- all routes and RLS policies that already use the existing tenant-only helpers.

Feature 094 tests should prove parity by calling the new resolver directly and comparing answers with existing tenant-only helpers in representative cases:

- Media Library custom role access/folder management;
- template management;
- profile view/manage;
- project creation;
- project workspace management;
- organization-user view/invite/change/remove.

Later cleanup can replace or wrap existing tenant-only helpers after operational migration is complete. This avoids changing already shipped behavior while proving the new resolver can represent it.

## Test plan

Add:

- `tests/feature-094-effective-scoped-permission-resolver-foundation.test.ts`

Use existing Supabase test helpers. If fixture code becomes large, add test-local helpers in the test file or under an existing test helper pattern. Do not add production fixture utilities.

### Fixed role source tests

Cover:

- owner fixed role grants tenant `templates.manage` with `fixed_role` source;
- admin fixed role grants project `workflow.finalize_project` with `fixed_role` source;
- owner/admin fixed role grants workspace `capture.upload_assets` with `fixed_role` source;
- fixed owner/admin do not make unsupported scope checks meaningful;
- fixed reviewer without reviewer assignment does not grant `review.workspace` or Media Library;
- fixed reviewer may grant tenant `profiles.view`;
- fixed photographer without assigned workspace does not grant capture;
- fixed photographer may grant tenant `profiles.view`;
- role administration exclusion: no role-administration capability keys exist and resolver is not used for custom role editor/assignment/reviewer access administration.

### Reviewer assignment source tests

Cover:

- tenant-wide reviewer assignment counts only for fixed reviewer members;
- tenant-wide reviewer grants tenant Media Library capabilities;
- tenant-wide reviewer grants project review/workflow/correction capabilities;
- tenant-wide reviewer grants workspace review/correction and workspace-supported workflow capabilities;
- project reviewer assignment counts only for fixed reviewer members;
- project reviewer assignment grants project and workspace review/workflow/correction for the matching project;
- project reviewer assignment does not grant Media Library;
- project reviewer assignment does not grant wrong project or workspace in another project;
- reviewer source metadata includes assignment id and scope.

### Photographer workspace assignment source tests

Cover:

- fixed photographer assigned to a workspace grants workspace capture capabilities for that workspace;
- assigned photographer does not get project-wide capture;
- assigned photographer does not get wrong workspace capture;
- assigned photographer does not get review/workflow/correction;
- custom-role capture assignment does not require fixed photographer role;
- photographer source metadata includes project and workspace ids.

### Tenant custom role assignment tests

Cover:

- tenant custom role grants tenant-valid capabilities;
- tenant custom role with `project_workspaces.manage` grants matching project check because tenant and project support are both `yes`;
- tenant custom role with `templates.manage` does not grant project check;
- tenant custom role with deferred operational capability such as `capture.upload_assets` does not grant tenant or project checks from tenant assignment;
- ignored metadata records mixed-scope ignored capabilities.

### Project custom role assignment tests

Cover:

- project custom role grants project-valid capabilities for matching project;
- project custom role grants workspace-valid capabilities for workspaces in matching project;
- project custom role does not grant tenant-only capabilities;
- project custom role does not grant wrong project;
- project custom role does not grant workspace checks for workspaces outside its project;
- project custom role with workspace-unsupported capability such as `workflow.finalize_project` does not grant workspace check.

### Workspace custom role assignment tests

Cover:

- workspace custom role grants workspace-valid capabilities for exact workspace;
- workspace custom role does not grant project-level capability;
- workspace custom role does not grant wrong workspace;
- workspace custom role does not grant wrong project;
- workspace custom role ignores unsupported workspace capabilities.

### Revoked, archived, system, and cross-tenant tests

Cover:

- revoked custom role assignment ignored;
- archived custom role ignored;
- system role definition ignored in custom-role source path;
- cross-tenant custom role assignment ignored or rejected by setup constraints;
- wrong project ignored;
- wrong workspace ignored;
- assignment-id revoke behavior remains compatible with Feature 093 tests.

### SQL parity tests

Cover `app.current_user_has_scoped_custom_role_capability`:

- tenant custom role, tenant context;
- tenant custom role, project context for `project_workspaces.manage`;
- tenant custom role, project context denial for tenant-only/project-no capability;
- project custom role, project context;
- project custom role, workspace context;
- workspace custom role, exact workspace context;
- wrong project/workspace denial;
- deferred tenant operational capability denial;
- revoked/archived/system denial;
- SQL and TypeScript custom-role results agree for each scenario.

### Existing tenant-only parity tests

Compare new resolver answers with current helpers for:

- `resolveMediaLibraryAccess`;
- template management access;
- `resolveProfilesAccess`;
- `resolveProjectAdministrationAccess`;
- `resolveOrganizationUserAccess`.

These tests should call existing helpers and the new resolver directly. They should not migrate the helpers.

## Security considerations

Feature 094 must preserve these invariants:

- tenant id is always server-derived before calling the resolver;
- every database read is tenant-filtered;
- service-role reads happen only after membership validation;
- resolver metadata must not expose cross-tenant assignments, roles, projects, or workspaces;
- revoked assignments are ignored;
- archived custom roles are ignored;
- system role definitions are ignored in the custom-role source path;
- reviewer assignments require fixed reviewer membership;
- photographer workspace assignment requires fixed photographer membership;
- owner/admin role administration remains outside resolver;
- public token flows remain token-scoped and outside resolver;
- release snapshot access remains immutable/release-scoped and outside resolver;
- workflow/correction state checks remain separate.

The SQL helper must be `security definer`, have an explicit `search_path`, and must avoid broad public grants.

## Edge cases

Implementation should cover or explicitly preserve these cases:

- `p_workspace_id` without `p_project_id` in SQL returns false;
- TypeScript workspace input without project id is impossible through the exported type;
- project id from another tenant returns `project_not_found`;
- workspace id from another project or tenant returns `workspace_not_found`;
- tenant custom role with project/workspace unsupported capability does not grant those contexts;
- project custom role with workspace-supported capability grants all workspaces in the project;
- project custom role with workspace-unsupported capability does not grant workspace context;
- workspace custom role never grants project context;
- multiple sources for the same capability produce one effective key and multiple source records;
- ignored capability metadata does not override another valid grant;
- missing or unknown capability keys should be compile-time impossible in TypeScript and false in SQL;
- service-role lookup failure should not leak whether cross-tenant rows exist.

## Implementation phases

### Phase 1 - TypeScript resolver skeleton

- Add `src/lib/tenant/effective-permissions.ts`.
- Define exported input/output/source/denial types.
- Implement scope support helpers using `custom-role-scope-effects.ts`.
- Implement membership validation and project/workspace validation.
- Do not import the new resolver into existing production authorization helpers.

Validation:

- TypeScript compiles;
- no existing route/helper behavior changes.

### Phase 2 - Source loaders and union logic

- Implement fixed role source resolution.
- Implement reviewer assignment source resolution with assignment ids.
- Implement photographer workspace assignment source resolution.
- Implement custom role assignment source resolution with ignored metadata.
- Implement deterministic union and check/assert helpers.

Validation:

- new resolver unit/integration tests pass for fixed/reviewer/photographer/custom role scenarios.

### Phase 3 - SQL helper migration

- Add the Feature 094 migration for `app.current_user_has_scoped_custom_role_capability`.
- Inline the SQL scope matrix.
- Add grants/revokes.
- Do not update existing RLS policies or surface wrappers.

Validation:

- migration applies from clean reset;
- SQL helper tests pass.

### Phase 4 - Parity tests

- Add TypeScript/SQL parity tests for custom-role scenarios.
- Add existing tenant-only helper parity tests.
- Add role administration exclusion tests.

Validation:

- Feature 094 test file passes;
- surrounding Feature 082, 091, and 093 tests still pass if run.

### Phase 5 - Final verification

Recommended commands:

```powershell
npm test -- tests/feature-094-effective-scoped-permission-resolver-foundation.test.ts
npm test -- tests/feature-082-reviewer-access-assignments.test.ts tests/feature-091-owner-admin-role-administration-consolidation.test.ts tests/feature-093-scoped-custom-role-assignment-foundation.test.ts
npm run lint
```

If the test runner does not support file arguments, use the closest supported command and document the limitation.

## Feature 095 handoff

After Feature 094 implementation:

- `src/lib/tenant/effective-permissions.ts` exists;
- TypeScript route helpers can ask one source-aware capability question;
- `app.current_user_has_scoped_custom_role_capability` exists for future RLS wrappers;
- source metadata exists for tests and future effective access UI;
- operational routes remain unchanged;
- existing tenant-only helpers remain unchanged;
- Feature 095 can start migrating capture route helpers to the resolver while keeping workflow state checks separate.

Recommended Feature 095 first consumer:

- migrate central capture route helpers such as `requireWorkspaceCaptureAccessForRequest` and row variants to call `assertEffectiveWorkspaceCapability` for capture capabilities;
- keep state-machine checks in `project-workflow-service.ts`;
- update SQL/RLS capture wrappers in a route-specific migration that combines fixed/reviewer/photographer/custom-role paths as needed.

Do not include that migration in Feature 094.

## Scope boundaries

Feature 094 must not:

- migrate capture/review/workflow/correction routes;
- change existing route authorization behavior;
- add capability keys;
- rename capability keys;
- delegate role administration;
- remove old helpers;
- add effective access UI;
- convert reviewer access to custom roles;
- convert photographer assignment to custom roles;
- make SQL/RLS broadly use the new resolver before route-specific migration features;
- change public-token authorization;
- change release snapshot authorization;
- merge workflow/correction state checks into capability checks.

## Concise implementation prompt

Implement Feature 094 from this plan as a foundation-only slice. Add `src/lib/tenant/effective-permissions.ts` with source-aware effective capability resolution across fixed owner/admin operational capabilities, reviewer assignments, photographer workspace assignments, and tenant/project/workspace custom role assignments. Reuse `custom-role-scope-effects.ts`; do not duplicate the matrix in TypeScript. Export the resolver, check, assert, and tenant/project/workspace convenience helpers with source metadata and denial reasons. Keep role administration, public tokens, release snapshots, and workflow/correction state outside the resolver.

Add one SQL migration defining custom-role-only `app.current_user_has_scoped_custom_role_capability(p_tenant_id uuid, p_capability_key text, p_project_id uuid default null, p_workspace_id uuid default null)` with explicit scope matrix, `security definer`, explicit `search_path`, and authenticated execute grant. Do not update existing RLS policies or existing tenant-only surface wrappers in Feature 094.

Add `tests/feature-094-effective-scoped-permission-resolver-foundation.test.ts` covering fixed role, reviewer assignment, photographer assignment, tenant/project/workspace custom role, ignored/revoked/archived/system/wrong-scope cases, SQL parity, existing tenant-only parity, and role administration exclusion. Do not migrate operational routes or change existing authorization behavior.
