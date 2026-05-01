# Feature 092 - Capability Scope Semantics and Remaining Permission Migration Map Plan

## Scope and contract

Feature 092 is a plan-only decision artifact. It does not implement runtime behavior, migrations, UI changes, tests, route changes, helper changes, or capability catalog changes.

The contract for this feature is to lock the remaining permission migration semantics:

- role definitions are reusable, scope-neutral capability bundles;
- role assignments carry tenant, project, or workspace scope;
- each capability has an explicit valid-scope matrix;
- operational custom-role enforcement must be added in later, narrow implementation features;
- old fixed-role, reviewer, photographer, public-token, and release-snapshot boundaries remain intact until later features explicitly migrate or preserve them.

## Inputs and ground truth

Primary input:

- `docs/rpi/092-capability-scope-semantics-and-permission-migration-map/research.md`

Required context was reread before planning:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `UNCODEXIFY.md`
- `docs/rpi/README.md`
- `docs/rpi/SUMMARY.md`

Targeted verification checked:

- capability catalog and fixed role mappings in `src/lib/tenant/role-capabilities.ts`;
- tenant custom-role enforcement allowlist in `src/lib/tenant/tenant-custom-role-capabilities.ts`;
- permission and assignment foundation in `src/lib/tenant/permissions.ts` and `src/lib/tenant/role-assignment-foundation.ts`;
- Feature 081 role assignment migration;
- already migrated tenant custom-role surfaces for Media Library, templates, profiles, project creation, project workspace management, organization-user management, and owner/admin-only role administration;
- reviewer access service and Feature 082 SQL helpers;
- project/workspace administration route seams;
- capture, review, workflow, and correction route/helper seams;
- surrounding feature tests from Feature 070 through Feature 091 where present.

## Drift from research

No plan-changing drift was found during targeted verification. Live code still matches the Feature 092 research conclusions:

- `role_assignments` already supports `tenant`, `project`, and `workspace` scopes at the schema/foundation level.
- Product-visible custom-role assignment is still tenant-scoped only.
- Tenant custom-role enforcement is still limited to the allowlisted tenant-level capabilities.
- Project/workspace custom-role assignment is not product-visible or enforced.
- Capture, review, workflow/finalization, and correction still use fixed role, reviewer, photographer, and workflow-state helpers rather than custom-role operational enforcement.
- Reviewer access remains a system reviewer role assignment model with tenant-wide and project scopes exposed. SQL has a workspace reviewer helper, but workspace reviewer assignment is not product-visible today.
- Media Library access is granted by owner/admin, tenant-wide reviewer access, or tenant-scoped Media Library custom-role capabilities, not project reviewer access.

Test inventory note: live test filenames include Feature 070, 073, 075, 076, 079, 080, 081, 082, 083, 084, 085, 086, 087, 088, 089, and 091 coverage. No standalone Feature 072, 090, or 092 test file was found by feature-number filename.

## Chosen scope semantics

Role definitions are scope-neutral. A custom role definition is only a capability bundle, and the assignment scope controls where the role applies.

Tenant assignments:

- apply tenant-wide only for capabilities marked `tenant = yes`;
- do not grant capabilities marked `tenant = defer`, `tenant = no`, or `tenant = not applicable`;
- remain the only product-visible custom-role assignment scope until Feature 093.

Project assignments:

- apply to the assigned project for capabilities marked `project = yes`;
- apply to all current and future workspaces in that project when a workspace-targeted capability is valid at project scope;
- do not grant tenant-only capabilities.

Workspace assignments:

- apply only to the assigned workspace for capabilities marked `workspace = yes`;
- require both matching `project_id` and `workspace_id`;
- do not grant project-level actions where workspace scope is `no`.

State-machine checks remain separate from capability checks. A capability can authorize who may attempt an action, but it must not replace project status, workspace workflow state, correction state, correction provenance, release snapshot, idempotency, or public-token validation.

## Final capability scope matrix

Values:

- `yes` means assignments at that scope may grant the capability.
- `no` means assignments at that scope must not grant the capability.
- `defer` means do not enable that scope in the first migration sequence; a later RPI may explicitly change it.
- `not applicable` means the capability does not make sense at that resource scope.

| Capability key | Tenant | Project | Workspace | First implementation feature | Rationale |
|---|---:|---:|---:|---|---|
| `organization_users.manage` | yes | no | no | Already tenant-enforced | Tenant membership resource. |
| `organization_users.invite` | yes | no | no | Already tenant-enforced | Tenant invitation resource. |
| `organization_users.change_roles` | yes | no | no | Already tenant-enforced | Tenant membership role mutation. |
| `organization_users.remove` | yes | no | no | Already tenant-enforced | Tenant membership removal. |
| `templates.manage` | yes | no | no | Already tenant-enforced | Tenant reusable consent template resource. |
| `profiles.view` | yes | no | no | Already tenant-enforced | Organization recurring profile directory visibility. |
| `profiles.manage` | yes | no | no | Already tenant-enforced | Organization recurring profile directory mutation. |
| `projects.create` | yes | not applicable | not applicable | Already tenant-enforced | Creates tenant project containers. |
| `project_workspaces.manage` | yes | yes | no | 093/094 then later project admin enhancement | Tenant grants all-project workspace management; project grants one-project workspace management. Workspace scope is not useful because the action manages workspaces from project scope. |
| `capture.workspace` | defer | yes | yes | 095 | Workspace-local capture access; tenant-wide capture is too broad for the first migration. |
| `capture.create_one_off_invites` | defer | yes | yes | 095 | Invite creation/revoke is workspace-local. |
| `capture.create_recurring_project_consent_requests` | defer | yes | yes | 095 | Recurring participant consent requests target project/workspace data. |
| `capture.upload_assets` | defer | yes | yes | 095 | Upload/preflight/prepare/finalize is workspace-local. |
| `review.workspace` | defer | yes | yes | 096 | Review queues and mutations are workspace-local, with project scope granting all workspaces in one project. |
| `review.initiate_consent_upgrade_requests` | defer | yes | yes | 096 | Upgrade requests are review actions against workspace-scoped consents/assets. |
| `workflow.finalize_project` | defer | yes | no | 097 | Finalization affects the umbrella project. |
| `workflow.start_project_correction` | defer | yes | no | 097 | Correction start affects the umbrella project. |
| `workflow.reopen_workspace_for_correction` | defer | yes | yes | 097 | Reopen targets one workspace but depends on project correction state. |
| `correction.review` | defer | yes | yes | 098 | Correction review is workspace-local and project correction-state gated. |
| `correction.consent_intake` | defer | yes | yes | 098 | Correction consent intake is workspace-local and correction-provenance gated. |
| `correction.media_intake` | defer | yes | yes | 098 | Correction media intake is workspace-local and correction-state gated. |
| `media_library.access` | yes | no | no | Already tenant-enforced | Media Library is tenant-wide release-snapshot access. |
| `media_library.manage_folders` | yes | no | no | Already tenant-enforced | Folder management is a tenant Media Library action. |

Tenant-scoped operational custom roles remain deferred. Owner/admin and tenant-wide system reviewer assignment continue to provide existing broad operational access where live code already does so.

## Mixed-scope role assignment rule

Mixed-scope roles are allowed.

A custom role may contain tenant-only, project-valid, and workspace-valid capabilities in one reusable bundle. When that role is assigned at a specific scope, only capabilities valid for that assignment scope become effective.

Feature 093 should add assignment warnings or metadata:

- `effectiveCapabilities`: capabilities from the role that can apply at the selected scope;
- `ignoredCapabilities`: capabilities from the role that are not valid at the selected scope;
- `hasScopeWarnings`: true when at least one capability is ignored.

Feature 093 should reject an assignment only when the role would have zero effective capabilities at the requested scope. This avoids useless rows without forcing owners/admins to create separate role definitions for every scope.

Feature 094 resolver tests must prove ignored capabilities do not become effective. For example, assigning a role containing `templates.manage` and `capture.upload_assets` at workspace scope may grant `capture.upload_assets` for that workspace, but must not grant `templates.manage`.

## Reviewer access coexistence decision

System reviewer access remains special and must coexist with custom-role review enforcement.

Decisions:

- Preserve tenant-wide and project reviewer assignments using the system reviewer role definition.
- Do not convert reviewer access to custom roles in Features 093 through 098.
- Future `review.workspace` custom-role enforcement is additive: either effective reviewer access or scoped custom-role `review.workspace` can authorize review after Feature 096.
- Tenant-wide reviewer access continues to grant Media Library access through existing Media Library helpers.
- Project reviewer access does not grant tenant-wide Media Library access.
- Scoped custom-role review access must not imply Media Library access unless the user also has `media_library.access`.
- SQL and TypeScript helpers must keep reviewer access and custom-role review as separate authorization paths, even if later route helpers combine them into an effective "can review" result.

## Photographer workspace assignment coexistence decision

Fixed photographer workspace assignment remains special.

Decisions:

- Preserve assigned photographer workspace access as an allowed capture path.
- Feature 095 adds scoped custom-role capture as an additive path; it does not remove photographer assignment.
- Photographer workspace assignment should continue to represent staffing and project workflow semantics.
- A later cleanup feature may research whether photographer assignment should be internally represented as workspace-scoped custom role assignment, but that is not part of Features 093 through 100 unless explicitly re-planned.

## Feature 093 plan boundary

Feature 093 should implement Project/Workspace Custom Role Assignment Foundation.

In scope:

- owner/admin-only assignment administration;
- assigning existing non-system, non-archived custom role definitions at `tenant`, `project`, or `workspace` scope;
- preserving existing tenant-scope assignment behavior;
- displaying assignment scope clearly in owner/admin UI;
- returning scope-validity warnings for mixed-scope roles;
- listing active and revoked assignment history where current UI already expects history;
- idempotent grant and revoke behavior;
- tenant/project/workspace boundary validation.

Out of scope:

- operational route enforcement;
- broad scoped capability resolver replacement;
- delegated role administration;
- new capability keys;
- role definition scope restrictions;
- converting reviewer or photographer access to custom roles.

API/service expectations:

- Extend the existing custom-role assignment service to accept `scopeType: "tenant" | "project" | "workspace"`, plus `projectId` and `workspaceId` as required by scope.
- Keep tenant assignments as `project_id = null` and `workspace_id = null`.
- Require project assignments to include a tenant-owned project and `workspace_id = null`.
- Require workspace assignments to include a tenant-owned workspace that belongs to the provided project.
- Never accept `tenant_id` from the client.
- Validate target user membership in the active tenant.
- Validate custom role definition ownership, `is_system = false`, and `archived_at is null`.
- Use the existing active unique indexes for retry-safe grants. If an identical active assignment already exists, return it as an idempotent result instead of creating a duplicate.
- Revoke by assignment identity for scoped assignments. The existing role-id-only revoke shape is ambiguous once the same role can be assigned at multiple scopes, so Feature 093 should introduce or use an assignment-id based revoke path while preserving existing tenant-only behavior where needed.
- Set `revoked_at` and `revoked_by` together. Repeated revoke should be safe and should not create a second mutation.

UI expectations:

- Keep role administration owner/admin-only.
- Show assignment scope and scope target in member management.
- Allow owners/admins to choose tenant, project, or workspace scope when assigning a role.
- When scope is project or workspace, require an explicit project/workspace picker constrained to the active tenant.
- Show ignored-capability warnings for mixed-scope assignments without blocking when at least one capability is effective.
- Do not show project/workspace custom-role assignment as proof of access to operational routes until Feature 094+ and the relevant migration feature are complete.

Test expectations:

- tenant, project, and workspace grant validation;
- idempotent duplicate grants;
- scoped revoke by assignment id;
- revoked assignments ignored in listing/effective metadata;
- archived and system roles rejected;
- cross-tenant project/workspace rejected;
- workspace/project mismatch rejected;
- mixed-scope warnings emitted;
- zero-effective-capability assignment rejected.

## Feature 094 plan boundary

Feature 094 should implement Scoped Effective Capability Resolver Foundation.

In scope:

- tested TypeScript helpers for custom-role capability resolution across tenant, project, and workspace assignments;
- SQL helper strategy that mirrors the same matrix;
- explicit scope matrix as code data, without adding capability keys;
- parity tests between TypeScript and SQL behavior where RLS depends on SQL;
- no broad route migration except small internal call sites needed to exercise the resolver safely.

Suggested TypeScript shape:

- `getCapabilityScopeSupport(capabilityKey)` returns the locked tenant/project/workspace support values.
- `getRoleScopeEffect(roleCapabilities, scopeType)` returns effective and ignored capabilities for UI/API warnings.
- `userHasScopedCustomRoleCapability({ supabase, tenantId, userId, capabilityKey, projectId?, workspaceId?, adminSupabase? })` returns whether a custom role grants the capability in that context.
- `resolveScopedCustomRoleCapabilities({ supabase, tenantId, userId, projectId?, workspaceId?, adminSupabase? })` returns effective capability sets plus contributing assignment metadata for tests and later UI.

Resolver rules:

- Ignore revoked assignments.
- Ignore archived custom role definitions.
- Ignore system role definitions.
- Enforce tenant boundaries on every lookup.
- Project assignments match only the same project.
- Workspace assignments match only the same project and workspace.
- Project-scoped assignments apply to all current and future workspaces in that project for workspace-valid capabilities.
- Workspace-scoped assignments do not authorize project-level actions where workspace support is `no`.
- Tenant assignments grant only capabilities with `tenant = yes`.
- `defer`, `no`, and `not applicable` never grant.

Treatment of special paths:

- Fixed owner/admin checks remain outside the custom-role resolver unless a route-specific wrapper intentionally combines them.
- Reviewer access remains outside the custom-role resolver.
- Photographer workspace assignment remains outside the custom-role resolver.
- Public-token and release-snapshot authorization remains outside the custom-role resolver.

SQL strategy:

- Add SQL custom-role resolver helpers only after the TypeScript matrix is explicit.
- Keep SQL helpers narrowly focused on custom-role assignment resolution, with fixed owner/admin, reviewer, photographer, and public-token paths either separate or combined only in route-specific wrappers.
- Add tests that prove SQL rejects revoked, archived, system-role, cross-tenant, wrong-project, wrong-workspace, unsupported-scope, and deferred-scope grants.

## Feature 095-098 migration outline

### Feature 095 - Capture Custom-Role Enforcement

Move normal capture actions onto additive scoped custom-role enforcement.

Capability keys:

- `capture.workspace`
- `capture.create_one_off_invites`
- `capture.create_recurring_project_consent_requests`
- `capture.upload_assets`

Target seams:

- `src/lib/projects/project-workspace-request.ts`
- `src/lib/projects/project-participants-service.ts`
- `src/lib/projects/project-participants-route-handlers.ts`
- project invite routes under `src/app/api/projects/[projectId]/invites/**`
- recurring participant routes under `src/app/api/projects/[projectId]/profile-participants/**`
- asset upload/preflight/prepare/finalize routes under `src/app/api/projects/[projectId]/assets/**`

Requirements:

- preserve owner/admin capture access;
- preserve assigned photographer workspace access;
- add project/workspace custom-role capture as an additional path;
- do not treat correction intake as normal capture;
- keep workflow mutability checks separate;
- add SQL/RLS parity where capture RLS helpers are used.

Required tests include owner/admin, photographer, project-scoped role, workspace-scoped role, wrong workspace, wrong project, revoked assignment, archived role, and tenant-scope operational defer.

### Feature 096 - Review Custom-Role Enforcement

Move normal review actions onto additive scoped custom-role enforcement.

Capability keys:

- `review.workspace`
- `review.initiate_consent_upgrade_requests`

Target seams:

- `src/lib/projects/project-workspace-request.ts`
- review session routes under `src/app/api/projects/[projectId]/consents/[consentId]/review-sessions/**`
- preview face/candidate/link routes under `src/app/api/projects/[projectId]/assets/**`
- face assignment, manual face, hidden/blocked/suppressed face routes where present;
- whole-asset link routes;
- consent upgrade request routes and handlers.

Requirements:

- preserve owner/admin review access;
- preserve tenant-wide and project reviewer access;
- add project/workspace custom-role review as an additional path;
- do not grant Media Library access from scoped review custom roles;
- keep workflow mutation checks separate;
- keep correction consent intake separate from normal upgrade requests.

Required tests include fixed reviewer, project reviewer, project-scoped custom role, workspace-scoped custom role, no Media Library implication, wrong workspace, revoked assignment, archived role, and tenant-scope review defer.

### Feature 097 - Workflow/Finalization Custom-Role Enforcement

Move project finalization, correction start, and workspace correction reopen onto scoped custom-role enforcement.

Capability keys:

- `workflow.finalize_project`
- `workflow.start_project_correction`
- `workflow.reopen_workspace_for_correction`

Target seams:

- `src/lib/projects/project-workflow-service.ts`
- `src/lib/projects/project-workflow-route-handlers.ts`
- `src/app/api/projects/[projectId]/finalize/route.ts`
- `src/app/api/projects/[projectId]/correction/start/route.ts`
- `src/app/api/projects/[projectId]/workspaces/[workspaceId]/correction-reopen/route.ts`

Requirements:

- preserve current review-capable path unless the feature plan explicitly narrows it;
- add project-scoped workflow capabilities for project-level actions;
- add project/workspace scoped capability for workspace correction reopen;
- keep project finalization, release snapshot creation, correction state, workspace validation, and correction source release checks separate;
- do not add new capability keys.

Workspace handoff, validate, needs-changes, and normal reopen should remain under the current capture/review workflow semantics unless Feature 097 research finds a necessary adjustment.

### Feature 098 - Correction Custom-Role Enforcement

Move correction review and intake onto additive scoped custom-role enforcement.

Capability keys:

- `correction.review`
- `correction.consent_intake`
- `correction.media_intake`

Target seams:

- `src/lib/projects/project-workspace-request.ts`
- `src/lib/projects/project-participants-route-handlers.ts`
- `src/lib/projects/project-consent-upgrade-route-handlers.ts`
- `src/lib/assets/project-correction-asset-route-handlers.ts`
- correction-specific routes under `src/app/api/projects/**`

Requirements:

- preserve owner/admin and reviewer-capable correction paths until replacement is explicitly planned;
- add project/workspace custom-role correction paths;
- keep correction state, correction provenance, finalized-project, source release, and reopened-workspace gates separate;
- keep correction media intake separate from normal `capture.upload_assets`;
- keep release snapshot immutability intact.

Required tests include correction-state closed/open, wrong correction provenance, wrong workspace, project-scoped correction role, workspace-scoped correction role, revoked assignment, archived role, and tenant-scope correction defer.

## Feature 099 effective access UI outline

Feature 099 should add an owner/admin-facing explanation of effective access after operational enforcement exists.

It should explain access sources without changing authorization:

- fixed tenant role;
- tenant-wide reviewer access;
- project reviewer access;
- photographer workspace assignment;
- tenant custom role assignment;
- project custom role assignment;
- workspace custom role assignment;
- effective capabilities by area;
- ignored capabilities for mixed-scope assignments.

The UI should not imply that project/workspace custom-role assignments authorize operational routes until the corresponding migration features are complete.

## Feature 100 cleanup criteria

Feature 100 must start with research/plan before implementation.

Cleanup can begin only after:

- Feature 093 project/workspace assignment foundation is implemented and tested;
- Feature 094 scoped resolver SQL and TypeScript parity is implemented and tested;
- Feature 095 capture migration tests pass;
- Feature 096 review migration tests pass;
- Feature 097 workflow/finalization migration tests pass;
- Feature 098 correction migration tests pass;
- public-token and release-snapshot boundaries have explicit regression tests;
- owner/admin bootstrap and role-administration safety tests still pass.

Permanent or long-lived helpers:

- fixed owner/admin role checks for bootstrap, role administration, and tenant safety;
- public-token authorization helpers;
- release snapshot authorization helpers;
- reviewer access helpers unless a later RPI explicitly replaces the reviewer model;
- photographer workspace assignment helpers unless a later RPI explicitly replaces staffing with scoped custom roles.

Deprecation candidates only after migration:

- duplicate TypeScript booleans that express capture/review/workflow/correction access without scoped resolver input;
- SQL helper wrappers that duplicate new scoped resolver logic;
- old route-specific authorization code that no longer adds state-machine or public-token protection.

Cleanup must not collapse capability checks and state-machine checks into one generic authorization result.

## Risks and tradeoffs

- Tenant-scoped operational roles are powerful all-project/all-workspace grants. The plan defers them for capture, review, workflow, and correction to avoid accidental over-broad access.
- Mixed-scope roles reduce role-definition sprawl but can confuse owners/admins. Feature 093 must show effective and ignored capabilities clearly.
- Reviewer access and custom-role review will overlap. This is intentional, but helpers and UI must identify the access source.
- SQL and TypeScript scope matrices can drift. Feature 094 must add parity tests or shared generated data if practical.
- State-machine checks can be accidentally weakened if capability checks are treated as sufficient. Every migration feature must keep workflow, correction, release, and provenance gates separate.
- Public token flows are not tenant member authorization. They must stay token-scoped.
- Release snapshots are immutable authorization products. Media Library detail/download access should remain release-snapshot based, not live project permission based.
- Assignment-id based revoke may require UI/API adjustment because role-id-only revoke becomes ambiguous after scoped assignment is introduced.

## Open decisions

No blocking open decisions remain for Feature 092.

Later features must decide implementation details within the locked boundaries:

- exact route shape for assignment-id based scoped revoke in Feature 093;
- final UI copy and placement for scope warnings in Feature 093;
- exact SQL helper names in Feature 094;
- whether any future RPI should turn deferred tenant-scoped operational capabilities into `yes`.

Deferred tenant-scoped operational support must not be enabled opportunistically during Features 093 through 098.

## Concise prompt for Feature 093

Start Feature 093 - Project/Workspace Custom Role Assignment Foundation.

Use `docs/rpi/092-capability-scope-semantics-and-permission-migration-map/plan.md` as the governing plan. Implement owner/admin-only assignment of existing non-system, non-archived custom role definitions at tenant, project, and workspace scope. Preserve existing tenant assignment behavior, validate tenant/project/workspace boundaries, make grants and revokes idempotent, introduce an unambiguous assignment-id based revoke path for scoped assignments, and show assignment scope plus mixed-scope effective/ignored capability warnings in the owner/admin member management UI. Do not migrate capture, review, workflow, or correction authorization yet. Do not delegate role administration. Do not add, remove, or rename capability keys.
