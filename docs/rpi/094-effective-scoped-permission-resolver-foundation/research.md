# Feature 094 - Effective Scoped Permission Resolver Foundation Research

## Title and scope

Feature 094 researches the foundation for a scoped effective permission resolver. This is research only. It does not implement code, migrations, UI changes, tests, route migrations, runtime authorization changes, capability key changes, or cleanup.

The resolver foundation should let backend code answer scoped capability questions with source metadata, for example:

- whether a user has `templates.manage` for a tenant;
- whether a user has `project_workspaces.manage` for a project;
- whether a user has `capture.upload_assets` for a workspace;
- whether a user has `review.workspace` for a project or workspace;
- which fixed role, system assignment, staffing row, or custom role assignment grants the result.

The model remains additive. No deny rules are present. State-machine, public-token, release-snapshot, correction-provenance, and role-administration checks remain separate from capability resolution.

## Inputs reviewed

Required project context:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `UNCODEXIFY.md`
- `docs/rpi/README.md`
- `docs/rpi/SUMMARY.md`

RPI history reviewed:

- Feature 080 research and plan
- Feature 081 research and plan
- Feature 082 research and plan
- Feature 083 research and plan
- Feature 084 research and plan
- Feature 085 research and plan
- Feature 086 research and plan
- Feature 087 research and plan using the live folder present in the repo: `087-tenant-level-admin-permission-consolidation`
- Feature 088 research and plan
- Feature 089 research and plan
- Feature 090 research and plan
- Feature 091 research and plan
- Feature 092 research and plan
- Feature 093 plan

Live source and tests inspected:

- `src/lib/tenant/role-capabilities.ts`
- `src/lib/tenant/tenant-custom-role-capabilities.ts`
- `src/lib/tenant/custom-role-scope-effects.ts`
- `src/lib/tenant/role-assignment-foundation.ts`
- `src/lib/tenant/custom-role-assignment-service.ts`
- `src/lib/tenant/permissions.ts`
- `src/lib/tenant/tenant-membership.ts`
- `src/lib/tenant/resolve-tenant.ts`
- `src/lib/tenant/reviewer-access-service.ts`
- `src/lib/tenant/media-library-custom-role-access.ts`
- `src/lib/templates/template-service.ts`
- `src/lib/profiles/profile-access.ts`
- `src/lib/projects/project-administration-service.ts`
- `src/lib/tenant/organization-user-access.ts`
- `src/lib/projects/project-workspace-request.ts`
- `src/lib/projects/project-workspaces-service.ts`
- `src/lib/projects/project-workflow-service.ts`
- `src/lib/projects/project-workflow-route-handlers.ts`
- route/helper seams in project participants, consent upgrade, and correction asset handlers
- migrations 081, 082, 085, 086, 087, 088, and 089
- tests for Features 081, 082, 084, 085, 086, 087, 088, 089, 091, and 093

## Source-of-truth notes and drift found

Live code, migrations, and tests are authoritative over RPI documents.

Drift and repository notes:

- `docs/rpi/093-scoped-custom-role-assignment-foundation/research.md` is not present. The live Feature 093 handoff comes from `plan.md`, implementation files, and `tests/feature-093-scoped-custom-role-assignment-foundation.test.ts`.
- The repo does not contain a separate `087-tenant-level-project-administration-custom-role-enforcement` folder. The live `087-tenant-level-admin-permission-consolidation/plan.md` is titled "Tenant-level project administration custom-role enforcement plan" and matches the implemented Feature 087 behavior.
- `docs/rpi/SUMMARY.md` still contains "last verified" language through Feature 091, while live folders and code include Feature 092 and 093 artifacts. Treat the live files as newer.
- `src/lib/tenant/custom-role-scope-effects.ts` now represents the Feature 092 matrix in code. It is currently warning/assignment metadata, not authorization.
- The latest SQL definition of `app.current_user_has_tenant_custom_role_capability` is from Feature 089 and only supports tenant-scoped allowlisted capabilities. Earlier migrations define narrower versions.
- Project/workspace custom-role assignment is implemented in live code, but no operational route currently treats those rows as effective access.
- The working tree is dirty with many existing modified/untracked files. This research adds only the Feature 094 research document.

## Current permission sources

### Fixed membership role

Stored in `memberships.role` with live roles `owner`, `admin`, `reviewer`, and `photographer`.

Current enforcement:

- TypeScript fixed capability catalog is in `src/lib/tenant/role-capabilities.ts`.
- `src/lib/tenant/permissions.ts` derives many legacy permission booleans from fixed roles.
- SQL helpers use `app.current_user_membership_role(...)` and fixed role checks across project, workspace, template, profile, media-library, and organization-user helpers.

Feature 094 treatment:

- Include fixed role capabilities as an effective resolver source for operational checks.
- Source metadata should identify `fixed_role` and the membership role.
- Keep role administration outside the resolver. Owner/admin-only custom role editor, custom role assignment, and reviewer access administration stay fixed-role checks.

### Tenant custom role assignment

Stored in `role_assignments` with `scope_type = 'tenant'`, `project_id is null`, `workspace_id is null`, referencing tenant custom `role_definitions` and `role_definition_capabilities`.

Current enforcement:

- `src/lib/tenant/tenant-custom-role-capabilities.ts` checks tenant-only allowlisted capabilities with service-role reads after membership validation.
- SQL `app.current_user_has_tenant_custom_role_capability(p_tenant_id, p_capability_key)` checks active tenant-scope custom-role rows.
- Surface-specific TypeScript resolvers and SQL helpers use it for Media Library, templates, profiles, project administration, and organization-user actions.

Feature 094 treatment:

- Include in the resolver.
- Apply only capabilities with matrix `tenant = yes`.
- Ignore revoked assignments, archived role definitions, system role definitions, cross-tenant role definitions, and capabilities whose tenant support is `defer`, `no`, or `not_applicable`.

### Project custom role assignment

Stored in `role_assignments` with `scope_type = 'project'`, `project_id` populated, `workspace_id is null`.

Current enforcement:

- Feature 093 validates and displays project-scope assignments, but operational authorization ignores them.
- Feature 093 tests prove project scope can be granted, listed, and revoked, and wrong/cross-tenant project ids are rejected.

Feature 094 treatment:

- Include in the resolver.
- A project assignment grants capabilities where matrix `project = yes` for that project.
- For workspace-valid capabilities, a project assignment should apply to all current and future workspaces in that project.
- It does not grant tenant-only capabilities.

### Workspace custom role assignment

Stored in `role_assignments` with `scope_type = 'workspace'`, `project_id` and `workspace_id` populated.

Current enforcement:

- Feature 093 validates and displays workspace-scope assignments, but operational authorization ignores them.
- Feature 093 tests prove workspace/project mismatch and cross-tenant workspace ids are rejected.

Feature 094 treatment:

- Include in the resolver.
- A workspace assignment grants capabilities where matrix `workspace = yes` for that exact project/workspace.
- It does not grant project-level actions when workspace support is `no`, for example `workflow.finalize_project`.

### Tenant-wide reviewer assignment

Stored in `role_assignments` as an active tenant-scope assignment of the system `reviewer` role definition.

Current enforcement:

- TypeScript `reviewer-access-service.ts` resolves tenant-wide and project reviewer access with service-role reads.
- `permissions.ts` treats fixed reviewer role as eligibility and requires assignment for live reviewer access.
- SQL helpers from Feature 082 require fixed membership role `reviewer` plus active system reviewer assignment.
- Media Library allows owner/admin, tenant-wide reviewer assignment, or tenant custom-role Media Library capability.

Feature 094 treatment:

- Include tenant-wide reviewer assignment as a source for effective review/workflow/correction capabilities where current reviewer behavior already authorizes those actions.
- Include tenant-wide reviewer assignment as a source for Media Library access/manage folders, preserving current behavior.
- Keep source metadata distinct from custom roles: `system_reviewer_assignment`.
- Continue requiring fixed `memberships.role = reviewer` for system reviewer assignment to count.

### Project reviewer assignment

Stored in `role_assignments` as an active project-scope assignment of the system `reviewer` role definition.

Current enforcement:

- `reviewer-access-service.ts` and SQL helpers grant assigned reviewers project visibility and all workspaces in assigned projects for review/correction/finalization paths.
- Project reviewer assignment does not grant Media Library access.

Feature 094 treatment:

- Include as a source for project/workspace review, workflow, and correction capabilities where current reviewer behavior applies.
- Project reviewer assignment should grant workspace review for all workspaces in the project.
- It must not grant Media Library capabilities.
- Continue requiring fixed reviewer membership role.

### Fixed photographer workspace assignment

Stored on `project_workspaces.photographer_user_id`.

Current enforcement:

- `resolveAccessibleProjectWorkspaces` returns only assigned workspaces for photographers.
- `resolveWorkspacePermissions` rejects photographers for unassigned workspaces.
- `assertCanCaptureWorkspaceAction` uses fixed role `photographer` capability plus the workspace assignment boundary.
- SQL project/workspace access and capture helpers check `project_workspaces.photographer_user_id = auth.uid()`.

Feature 094 treatment:

- Include assigned photographer workspace as a source for workspace capture capabilities.
- Only count it when membership role is `photographer` and the workspace row is assigned to that user.
- Do not grant project-level capture across all workspaces unless a future explicit capability source says so.
- Source metadata should distinguish staffing from custom role assignment: `photographer_workspace_assignment`.

### Owner/admin special handling

Stored as fixed `memberships.role in ('owner', 'admin')`.

Current enforcement:

- Owner/admin fixed roles grant broad operational capabilities in TypeScript and SQL.
- Owner/admin remain the only role-administration actors for custom role editor, custom role assignment, and reviewer access administration.

Feature 094 treatment:

- Include owner/admin as fixed effective capability sources for operational checks.
- Use the same scope matrix so owner/admin do not make nonsensical scopes meaningful.
- Keep role administration fixed owner/admin-only outside the resolver.

### Public token flows

Stored through token hashes, public route state, expiry/status fields, and public-token helper flows.

Current enforcement:

- Public routes validate token hashes, expiry, status, request source, workspace/project context, and correction provenance.
- Public token flows do not use tenant member authorization.

Feature 094 treatment:

- Remain outside the resolver.
- The resolver must not validate or replace public-token authorization.

### Release snapshot and Media Library access

Stored in release snapshot tables and Media Library stable asset/folder tables.

Current enforcement:

- Media Library list/detail/download/folders use Media Library authorization helpers.
- Release snapshot data is immutable output and not live project authorization.

Feature 094 treatment:

- Media Library tenant access can be represented as an effective capability result.
- Release snapshot immutability and public/download object checks remain outside the resolver.

## Current custom-role scope support

Feature 092 final matrix is represented in live code by `src/lib/tenant/custom-role-scope-effects.ts`.

Current matrix:

| Capability | Tenant | Project | Workspace |
|---|---|---|---|
| `organization_users.manage` | yes | no | no |
| `organization_users.invite` | yes | no | no |
| `organization_users.change_roles` | yes | no | no |
| `organization_users.remove` | yes | no | no |
| `templates.manage` | yes | no | no |
| `profiles.view` | yes | no | no |
| `profiles.manage` | yes | no | no |
| `projects.create` | yes | not_applicable | not_applicable |
| `project_workspaces.manage` | yes | yes | no |
| `capture.workspace` | defer | yes | yes |
| `capture.create_one_off_invites` | defer | yes | yes |
| `capture.create_recurring_project_consent_requests` | defer | yes | yes |
| `capture.upload_assets` | defer | yes | yes |
| `review.workspace` | defer | yes | yes |
| `review.initiate_consent_upgrade_requests` | defer | yes | yes |
| `workflow.finalize_project` | defer | yes | no |
| `workflow.start_project_correction` | defer | yes | no |
| `workflow.reopen_workspace_for_correction` | defer | yes | yes |
| `correction.review` | defer | yes | yes |
| `correction.consent_intake` | defer | yes | yes |
| `correction.media_intake` | defer | yes | yes |
| `media_library.access` | yes | no | no |
| `media_library.manage_folders` | yes | no | no |

Feature 093 uses `getRoleScopeEffect(capabilityKeys, scopeType)` to calculate:

- `effectiveCapabilityKeys`
- `ignoredCapabilityKeys`
- `hasScopeWarnings`
- `hasZeroEffectiveCapabilities`

The same matrix can be reused safely for authorization if Feature 094 treats only `"yes"` as granting and treats `defer`, `no`, and `not_applicable` as ignored. The helper currently has no user, assignment, role-definition, or DB lookup logic, so it is safe as pure scope semantics but not sufficient as an authorization resolver.

Special treatment needed:

- Tenant `defer` operational capabilities must not grant from tenant custom-role assignments.
- `project_workspaces.manage` grants at tenant and project scope, not workspace scope.
- `projects.create` is tenant-only; project/workspace support is not applicable.
- Media Library remains tenant-wide; project reviewer or project review custom role must not imply it.
- Role administration has no capability keys and stays outside this matrix.

## Desired resolver responsibilities

The resolver should:

- answer whether a user has a capability at tenant, project, or workspace scope;
- return the effective capability keys for a scope;
- return source metadata for every contributing grant;
- explain custom-role capabilities ignored because the assignment scope does not support them;
- filter out revoked assignments;
- filter out archived custom role definitions;
- filter out system role definitions in the custom-role path;
- validate project/workspace boundaries when project or workspace ids are supplied;
- be additive across fixed role, reviewer access, photographer workspace assignment, and custom-role assignment sources;
- derive tenant/user context server-side through existing route helpers and membership checks.

The resolver should not:

- validate workflow state;
- validate correction state or correction provenance;
- validate public tokens;
- authorize custom role editor, custom role assignment, reviewer access administration, or owner/admin safety operations;
- perform writes or side effects;
- accept client-provided tenant authority;
- replace route-specific object existence checks;
- hide route-specific not-found behavior that prevents cross-tenant leaks;
- read release snapshots as live authorization.

## TypeScript helper design options

### Recommended type concepts

Use one bounded module, for example `src/lib/tenant/effective-permissions.ts`.

Suggested scope types:

```ts
type EffectivePermissionScope =
  | { scopeType: "tenant" }
  | { scopeType: "project"; projectId: string }
  | { scopeType: "workspace"; projectId: string; workspaceId: string };
```

Suggested source types:

```ts
type EffectiveCapabilitySource =
  | { sourceType: "fixed_role"; role: MembershipRole }
  | { sourceType: "system_reviewer_assignment"; assignmentId: string; scopeType: "tenant" | "project"; projectId: string | null }
  | { sourceType: "photographer_workspace_assignment"; projectId: string; workspaceId: string }
  | { sourceType: "custom_role_assignment"; assignmentId: string; roleId: string; roleName: string; scopeType: "tenant" | "project" | "workspace"; projectId: string | null; workspaceId: string | null };
```

Suggested resolution output:

```ts
type EffectiveCapabilityResolution = {
  tenantId: string;
  userId: string;
  scope: EffectivePermissionScope;
  capabilityKeys: TenantCapability[];
  sources: EffectiveCapabilitySource[];
  ignoredCustomRoleCapabilities: Array<{
    assignmentId: string;
    roleId: string;
    capabilityKey: TenantCapability;
    scopeType: "tenant" | "project" | "workspace";
    support: "no" | "defer" | "not_applicable";
  }>;
};
```

Suggested capability check output:

```ts
type EffectiveCapabilityCheck = {
  allowed: boolean;
  capabilityKey: TenantCapability;
  sources: EffectiveCapabilitySource[];
  denialReason:
    | null
    | "no_tenant_membership"
    | "project_not_found"
    | "workspace_not_found"
    | "capability_not_supported_at_scope"
    | "not_granted";
};
```

### Recommended exported helpers

Recommended core helpers:

- `resolveEffectiveCapabilities(input)`
- `userHasEffectiveCapability(input)`
- `assertEffectiveCapability(input)`

Recommended convenience wrappers:

- `resolveEffectiveTenantCapabilities(input)`
- `resolveEffectiveProjectCapabilities(input)`
- `resolveEffectiveWorkspaceCapabilities(input)`
- `assertEffectiveTenantCapability(input)`
- `assertEffectiveProjectCapability(input)`
- `assertEffectiveWorkspaceCapability(input)`

Suggested input:

```ts
type ResolveEffectiveCapabilitiesInput = {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  scope:
    | { scopeType: "tenant" }
    | { scopeType: "project"; projectId: string }
    | { scopeType: "workspace"; projectId: string; workspaceId: string };
  capabilityKey?: TenantCapability;
  adminSupabase?: SupabaseClient;
};
```

Why this shape fits the repo:

- Existing route helpers already have `supabase`, `tenantId`, `userId`, and usually `projectId`/`workspaceId`.
- `project-workspace-request.ts` can call workspace assertions without changing route bodies.
- `project-workflow-route-handlers.ts` can call project or workspace assertions and keep state checks separate.
- `adminSupabase` matches existing custom-role and reviewer helpers where RLS blocks assignment metadata reads.

Avoid a generic IAM engine shape with arbitrary resource ids or strings. The repo has exactly tenant/project/workspace member authorization scopes for this feature.

## Source precedence and union rules

Rules:

- Capabilities are additive. Any valid source can grant.
- No deny rules exist.
- Source precedence is for explanation only, not authorization outcome.
- Return all grant sources when practical; for boolean fast paths it is acceptable to stop after the first source only if a separate debug/test resolver returns all sources.
- Fixed owner/admin grants operational capabilities according to fixed catalog plus scope matrix.
- Tenant custom role assignment grants only tenant `yes` capabilities.
- Project custom role assignment grants project `yes` capabilities for that project.
- Project custom role assignment grants workspace `yes` capabilities for all workspaces in that project.
- Workspace custom role assignment grants workspace `yes` capabilities for that exact workspace.
- Revoked assignments are ignored.
- Archived custom role definitions are ignored.
- System role definitions are ignored in the custom-role source path.
- System reviewer role definitions are considered only by reviewer access logic.
- Cross-tenant rows are ignored or rejected at validation boundaries.
- Wrong-project and wrong-workspace rows are ignored for resolution and rejected on assignment writes.
- `defer`, `no`, and `not_applicable` never grant.

## Fixed owner/admin treatment

Owner/admin should be included as `fixed_role` sources inside the effective resolver for operational checks.

Use the same scope matrix:

- tenant checks include capabilities with tenant `yes`;
- project checks include capabilities with project `yes`, plus tenant-wide tenant `yes` where the capability is tenant-level and the caller is explicitly checking tenant context;
- workspace checks include capabilities with workspace `yes`, and project-scoped capabilities only through a project check.

For owner/admin, this means:

- `templates.manage`, `profiles.*`, `organization_users.*`, `media_library.*`, and `projects.create` are tenant-level grants.
- `project_workspaces.manage` can be treated as tenant-wide and project-valid for project administration.
- capture/review/correction workspace capabilities are available at workspace scope.
- project workflow capabilities are available at project scope.

Role administration must stay outside the resolver:

- no `custom_roles.manage`, `custom_roles.assign`, `roles.manage`, `roles.assign`, or `reviewer_access.manage` keys exist;
- Feature 091 tests intentionally preserve owner/admin-only role administration;
- resolver adoption must not make operational custom roles or organization-user delegation able to administer roles.

## Reviewer access treatment

Current live behavior should be preserved.

Tenant-wide reviewer assignment:

- Counts only for fixed membership role `reviewer`.
- Grants tenant-wide project/workspace review access.
- Grants current reviewer workflow/correction authority where live code routes through reviewer access.
- Grants Media Library access/manage folders as current helpers do.

Project reviewer assignment:

- Counts only for fixed membership role `reviewer`.
- Grants project review access and all workspace review access for that project.
- Grants current workflow/correction authority for that assigned project where live code routes through reviewer access.
- Does not grant Media Library.
- Does not grant normal capture/upload.

Custom-role review:

- Should not require fixed membership role `reviewer`.
- Should not grant Media Library unless `media_library.access` is separately granted.
- Must have source metadata distinct from system reviewer assignments.

Open nuance for plan phase:

- Map the exact reviewer assignment source to capability keys carefully. Current code often treats reviewer access as enough for review, finalization, correction start, correction review, correction consent intake, and correction media intake. Feature 094 can model those as capability grants, but later migration features must decide which route calls each capability key.

## Photographer workspace assignment treatment

Current live behavior should be preserved.

Assigned photographer workspace source:

- Counts only for fixed membership role `photographer`.
- Comes from `project_workspaces.photographer_user_id`.
- Grants workspace capture capabilities for the assigned workspace:
  - `capture.workspace`
  - `capture.create_one_off_invites`
  - `capture.create_recurring_project_consent_requests`
  - `capture.upload_assets`
- Does not grant project-level all-workspace capture by itself.
- Does not grant review/workflow/correction capabilities.

Custom-role capture:

- Should not require fixed membership role `photographer`.
- Project custom role capture applies to all workspaces in that project.
- Workspace custom role capture applies only to the assigned workspace.
- Tenant custom role capture remains deferred and does not grant.

Source metadata should use `photographer_workspace_assignment`, not `custom_role_assignment`.

## Already migrated tenant-only surface interaction

Already migrated tenant-only areas:

- Media Library: `media-library-custom-role-access.ts`, SQL Media Library helpers.
- Templates: `template-service.ts`, `app.current_user_can_manage_templates`.
- Profiles: `profile-access.ts`, recurring profile SQL helpers.
- Project creation and project workspace management: `project-administration-service.ts`, Feature 087 SQL helpers.
- Organization users: `organization-user-access.ts`, Feature 088/089 SQL helpers.

Current patterns:

- Most TypeScript surfaces call fixed role checks plus `tenant-custom-role-capabilities.ts`.
- Media Library has a surface-specific resolver because it also includes tenant-wide reviewer assignment.
- SQL helpers duplicate the tenant custom-role predicate and then wrap it in surface-specific fixed-role logic.
- All migrated custom-role enforcement is tenant-scope only.

Recommendation:

- Feature 094 should not replace already migrated route/service callers.
- Add resolver parity tests proving that the new resolver returns the same answers and sources for these tenant-only capabilities.
- Keep existing surface-specific helpers as stable call sites until a later cleanup feature.
- Later cleanup can make those helpers wrappers around `assertEffectiveCapability`, but only after parity is proven.

## SQL/RLS strategy

TypeScript-only is insufficient because many tables and storage policies rely on SQL/RLS helpers. Feature 094 needs a SQL strategy.

Current SQL duplication:

- `app.current_user_has_tenant_custom_role_capability` is redefined by Features 086, 087, 088, and 089 as the allowlist grows.
- Media Library has `app.current_user_has_media_library_custom_role_capability`.
- Templates/profiles/project-admin/organization-user helpers wrap the shared tenant custom-role helper.
- Project/workspace/review/capture helpers still encode fixed owner/admin, reviewer assignment, and photographer assignment logic separately.

Recommended SQL architecture:

1. Add a lower-level scoped custom-role helper:

```sql
app.current_user_has_scoped_custom_role_capability(
  p_tenant_id uuid,
  p_capability_key text,
  p_project_id uuid default null,
  p_workspace_id uuid default null
)
```

2. Keep it custom-role-only:

- current user must have tenant membership;
- active assignment only;
- custom role definition only (`is_system = false`);
- role definition tenant matches `p_tenant_id`;
- role definition is not archived;
- capability mapping matches `p_capability_key`;
- tenant assignment grants only tenant `yes`;
- project assignment grants project `yes` for matching project and workspace `yes` for workspaces in that project;
- workspace assignment grants workspace `yes` only for matching project/workspace;
- `defer`, `no`, and `not_applicable` do not grant.

3. Preserve or add surface-specific wrappers:

- tenant-only wrappers can call the new scoped helper with null project/workspace and retain current behavior;
- future capture/review/workflow/correction SQL helpers can combine fixed owner/admin, reviewer assignment, photographer assignment, and the lower-level scoped custom-role helper;
- avoid replacing every RLS helper with a broad generic `current_user_has_effective_capability` until migration features define exact surface semantics.

Possible SQL effective helper:

- `app.current_user_has_effective_capability(...)` is tempting, but should be deferred unless Feature 094 tests can prove it does not broaden existing RLS behavior.
- A generic SQL effective helper that includes fixed owner/admin/reviewer/photographer sources risks mixing route-specific semantics into every table policy.

How to avoid matrix drift:

- TypeScript and SQL cannot directly share constants today.
- Feature 094 should add SQL/TypeScript parity tests for every capability/scope matrix entry.
- Keep the SQL matrix in one migration/function block, not copied across surface helpers.
- Consider future code generation only if drift becomes painful; tests are sufficient for the next slice.

## RLS and service-role access needs

Normal authenticated reads are not enough for all resolver metadata:

- Feature 081 grants authenticated select on role tables, but RLS policies only expose system roles, tenant role definitions/capabilities to tenant managers, and a user's own assignment rows.
- Assignees can see their own assignment rows but may not see the custom role definitions/capability mappings behind them unless they are owner/admin.
- Existing TypeScript helpers use a service-role client after membership validation to read role definitions/capabilities and role assignments safely.
- Reviewer access resolution also uses service-role reads because assignment rows are authorization inputs.

Recommended TypeScript access pattern:

- Validate `resolveTenantMembership(supabase, tenantId, userId)` first with the request-scoped authenticated client.
- Use an optional injected `adminSupabase` for tests and a server-only service-role client by default.
- Every service-role query must filter by `tenant_id`, `user_id`, and supplied project/workspace ids.
- Return not-found style denial for invalid project/workspace contexts where route helpers currently prevent cross-tenant leaks.
- Use `HttpError` codes aligned with existing helpers:
  - `no_tenant_membership`
  - `project_not_found`
  - `workspace_not_found`
  - `effective_permission_lookup_failed`
  - `effective_permission_forbidden` or route-specific forbidden codes in wrappers.

Avoid leaking cross-tenant data:

- never accept tenant id from client bodies;
- derive tenant in routes with existing active-tenant/session helpers;
- project/workspace validation queries must include `tenant_id`;
- source metadata should only include ids/names from the active tenant.

## Route helper integration plan

Feature 095+ should consume central route helpers, not every route individually.

Capture:

- Future `requireWorkspaceCaptureAccessForRequest` and row variants need `tenantId`, `userId`, `projectId`, and resolved `workspaceId`.
- They can call `assertEffectiveCapability(..., "capture.workspace")` or more specific capture capabilities before state checks.
- Keep `assertWorkspaceCaptureMutationAllowed` separate.

Review:

- Future `requireWorkspaceReviewAccessForRequest` and row variants need tenant/project/workspace context.
- They can call `assertEffectiveCapability(..., "review.workspace")`.
- Consent upgrade should call `review.initiate_consent_upgrade_requests` where a route creates upgrade requests.
- Keep matching/review row ownership and workflow mutation checks separate.

Project administration:

- `assertCanCreateProjectsAction` can later wrap tenant `projects.create`.
- `assertCanManageProjectWorkspacesAdministrationAction` can later wrap project `project_workspaces.manage`.
- The existing project-administration resolver should remain until parity is proven.

Workflow:

- Finalize project and start correction need project scope:
  - `workflow.finalize_project`
  - `workflow.start_project_correction`
- Reopen workspace for correction needs workspace or project scope:
  - `workflow.reopen_workspace_for_correction`
- Keep finalization readiness, release snapshot creation, correction-open state, and idempotency checks in `project-workflow-service.ts`.

Correction:

- Correction review needs `correction.review`.
- Correction consent intake needs `correction.consent_intake`.
- Correction media intake needs `correction.media_intake`.
- Keep correction provenance, source release, reopened workspace, and finalized-project gates separate.

Denial shaping:

- Resolver-level assertions can throw generic `effective_capability_forbidden`.
- Route helper wrappers should translate to existing route-specific codes where tests expect them, for example `workspace_capture_forbidden`, `workspace_review_forbidden`, or `workspace_media_intake_forbidden`.

Safest migration order:

1. Feature 094 resolver and parity tests, no route migration.
2. Feature 095 capture route-helper migration.
3. Feature 096 review route-helper migration.
4. Feature 097 workflow/finalization migration.
5. Feature 098 correction migration.
6. Cleanup only after SQL and TypeScript parity is proven across all migrated routes.

## Test plan themes

Feature 094 plan should require tests for:

- fixed owner/admin capability source at tenant, project, and workspace scopes;
- owner/admin role administration remains outside resolver;
- fixed reviewer without assignment behaves as today;
- tenant-wide reviewer assignment grants expected review/workflow/correction and Media Library capabilities;
- project reviewer assignment grants project/workspace review-family capabilities but not Media Library;
- fixed photographer workspace assignment grants capture only for assigned workspace;
- custom-role review/capture does not require fixed reviewer/photographer roles;
- tenant custom role grants tenant-valid capabilities;
- tenant custom role does not grant deferred operational capabilities;
- project custom role grants project-valid capabilities for that project;
- project custom role grants workspace-valid capabilities for all workspaces in that project;
- workspace custom role grants workspace-valid capabilities in that workspace only;
- mixed-scope ignored capabilities do not grant;
- `project_workspaces.manage` project scope grants project management but workspace scope does not;
- `projects.create` project/workspace scope is ignored/not applicable;
- revoked assignment ignored;
- archived custom role ignored;
- system role definition ignored in custom-role path;
- cross-tenant assignment ignored/rejected;
- wrong project ignored;
- wrong workspace ignored;
- SQL scoped custom-role helper matches TypeScript custom-role source behavior;
- existing tenant-only enforcement behavior preserved for Media Library, templates, profiles, project admin, and organization-user actions;
- RLS direct reads/writes do not become broader;
- source metadata reports the granting assignment/source id and ignored capability metadata.

## Options considered

### Option A - Custom-role-only scoped resolver

The resolver handles tenant/project/workspace custom role assignments only. Fixed roles, reviewer access, and photographer assignment remain outside wrappers.

Pros:

- smallest implementation;
- lower risk of changing fixed role behavior;
- simpler SQL helper.

Cons:

- route helpers still mix old and new authorization models;
- source-aware "effective permission" answers remain incomplete;
- later cleanup still needs a second resolver or many wrappers.

### Option B - Effective capability resolver across all sources

The TypeScript resolver includes fixed roles, reviewer assignments, photographer workspace assignments, and custom role assignments as separate source types.

Pros:

- matches the final additive permission model;
- route helpers can eventually ask one question;
- source metadata can explain grants for tests and future UI;
- avoids hiding reviewer/photographer special cases in every migration feature.

Cons:

- larger test matrix;
- needs careful boundaries so role administration, public tokens, and state checks stay outside;
- SQL should still be layered to avoid broad RLS changes.

### Option C - Surface-specific resolvers only

Every area keeps or adds its own resolver.

Pros:

- explicit and locally safe;
- matches the current incremental migration style.

Cons:

- duplicates scope matrix and assignment logic;
- makes source metadata inconsistent;
- migration remains fragmented.

### Option D - Generic IAM engine

A broad abstraction over all roles, resources, states, and route domains.

Pros:

- theoretically unified.

Cons:

- too broad for the repo's current migration stage;
- risks collapsing workflow/correction/public-token/release checks into authorization;
- harder to test and review safely.

## Recommendation

Choose Option B as a constrained SnapConsent effective capability resolver, not a generic IAM engine.

Recommended Feature 094 direction:

- Add a bounded TypeScript effective scoped capability resolver.
- Include fixed membership roles, system reviewer assignments, photographer workspace assignment, and custom role assignments as separate source types.
- Use the existing Feature 092 matrix from `custom-role-scope-effects.ts` as the source of scope truth for TypeScript.
- Add a lower-level SQL scoped custom-role helper for RLS parity.
- Keep fixed owner/admin/reviewer/photographer logic in SQL surface-specific wrappers unless a later migration proves a generic SQL effective helper is safe.
- Expose source metadata and ignored custom-role capability metadata.
- Do not migrate capture, review, workflow, correction, or already migrated tenant-only routes in Feature 094.
- Add tests that prove resolver parity with current tenant-only behavior and scoped custom-role SQL behavior.

## Risks and tradeoffs

- Resolver breadth can accidentally authorize role administration. Mitigation: no role-administration capability keys, tests from Feature 091, and explicit comments.
- SQL and TypeScript scope matrices can drift. Mitigation: exhaustive parity tests for every capability/scope value.
- Reviewer access overlaps with custom-role review. Mitigation: distinct source metadata and no Media Library implication from project reviewer or scoped review custom roles.
- Photographer staffing overlaps with custom-role capture. Mitigation: distinct source metadata and exact workspace-only staffing semantics.
- Tenant-scoped operational capabilities are `defer`; accidentally enabling them would broaden access tenant-wide. Mitigation: tests for all deferred tenant operational capabilities.
- RLS helpers are already duplicated. Mitigation: introduce a lower-level scoped custom-role SQL helper and migrate wrappers incrementally.
- Service-role reads are necessary but sensitive. Mitigation: membership validation first, tenant-scoped queries only, no client exposure.
- Source metadata can expose target names if not filtered. Mitigation: include only active-tenant source rows and keep route denials not-found shaped.

## Explicit open decisions for the plan phase

- Final TypeScript file name and exact exported type names.
- Whether `resolveEffectiveCapabilities` always returns all source metadata or has a fast boolean path plus a debug/full resolver.
- Whether Feature 094 should add only `app.current_user_has_scoped_custom_role_capability` or also add a generic SQL `app.current_user_has_effective_capability` with no RLS callers yet.
- Exact SQL parameter names and how null `project_id`/`workspace_id` determines tenant/project/workspace scope.
- Whether SQL scoped custom-role helper should return source rows for tests through a separate debug function, or only booleans.
- Exact mapping from system reviewer assignments to workflow/correction capability keys in resolver tests.
- Exact fixed owner/admin scope behavior for tenant-level queries that ask for project/workspace-only operational capabilities.
- Whether existing tenant-only helpers should become thin wrappers in Feature 094 tests only, or remain completely untouched until cleanup.
- Final denial error codes for `assertEffectiveCapability` versus route-specific wrapper errors.
