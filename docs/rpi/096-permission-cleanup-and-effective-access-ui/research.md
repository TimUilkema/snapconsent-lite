# Feature 096 - Permission Cleanup and Effective Access UI Research

## Title and scope

Feature 096 is a research-only finish/cleanup phase for the permissions migration after Feature 095. It does not propose new capability keys, new access behavior, public-token changes, release authorization changes, reviewer replacement, photographer-assignment replacement, delegated role administration, or a broad IAM dashboard.

The intended implementation should make the migrated model easier to maintain and explain:

- fixed owner/admin remains special for tenant safety, bootstrap, and role administration;
- normal operational authorization uses effective capabilities;
- effective capabilities combine fixed membership role, system reviewer assignment, photographer workspace assignment, and tenant/project/workspace custom-role assignments;
- public token authorization remains token-scoped;
- release snapshot and Media Library authorization remain release/tenant-scoped;
- state-machine checks remain separate from permission checks;
- owners/admins can inspect why a member has access.

## Inputs reviewed

Required context:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `UNCODEXIFY.md`
- `docs/rpi/README.md`
- `docs/rpi/SUMMARY.md`

Recent permission RPI docs:

- `docs/rpi/092-capability-scope-semantics-and-permission-migration-map/research.md`
- `docs/rpi/092-capability-scope-semantics-and-permission-migration-map/plan.md`
- `docs/rpi/093-scoped-custom-role-assignment-foundation/plan.md`
- `docs/rpi/094-effective-scoped-permission-resolver-foundation/research.md`
- `docs/rpi/094-effective-scoped-permission-resolver-foundation/plan.md`
- `docs/rpi/095-operational-permission-resolver-enforcement/research.md`
- `docs/rpi/095-operational-permission-resolver-enforcement/plan.md`

Prior role/custom-role context:

- Features 080 through 091 research and plan docs, using the live Feature 087 folder `docs/rpi/087-tenant-level-admin-permission-consolidation/`.

Live source-of-truth code and migrations:

- `src/lib/tenant/effective-permissions.ts`
- `src/lib/tenant/custom-role-scope-effects.ts`
- `src/lib/tenant/permissions.ts`
- `src/lib/projects/project-workspace-request.ts`
- `src/lib/projects/project-workspaces-service.ts`
- `src/lib/projects/project-workflow-route-handlers.ts`
- `src/lib/projects/project-workflow-service.ts`
- operational routes under `src/app/api/projects/**`
- correction asset handlers under `src/lib/assets/`
- project page server logic in `src/app/(protected)/projects/[projectId]/page.tsx`
- tenant surface helpers for Media Library, templates, profiles, organization users, reviewer access, custom roles, and custom-role assignments
- Members page and member management components
- `messages/en.json` and `messages/nl.json`
- migrations from Features 082 through 095
- tests for Features 055, 070, 073, 074, 075, 076, 079, 080 through 095.

## Source-of-truth notes and drift found

Live code, migrations, and tests are authoritative over prior RPI docs.

Drift and noteworthy differences:

- `docs/rpi/093-scoped-custom-role-assignment-foundation/research.md` is not present in the live repository; only the plan is present.
- The live Feature 087 folder is `087-tenant-level-admin-permission-consolidation`, not a project-administration-titled folder.
- `docs/rpi/SUMMARY.md` lags the latest permission work and should be updated during Feature 096.
- Feature 094 SQL includes both `app.current_user_has_scoped_custom_role_capability` and a `public.current_user_has_scoped_custom_role_capability` wrapper. The Feature 094 plan preferred avoiding a public wrapper unless needed.
- Feature 095 moved many operational route checks to effective capabilities, but some route-facing and compatibility names still read as fixed-role/reviewer/capture/review helpers.
- `project-workspace-request.ts` maps effective-capability grants into old `WorkspacePermissions` booleans and sets `reviewAccessSource: "owner_admin"` for any review-like grant. That preserves old route shapes but is misleading as source metadata.
- Authenticated assets GET, matching progress, and project export still call `resolveWorkspacePermissions` after effective workspace selection and then check `canCaptureProjects`/`canReviewProjects`. These are important cleanup candidates because they can deny custom-role effective access even though the visibility selection path is now effective-capability aware.
- Project workflow finalization/correction handlers accept `assertEffectiveProjectCapability`, but still retain an `assertCanReviewProjectAction` fallback in the dependency type and tests.
- Workspace workflow transition handlers pass `review.workspace` for non-handoff transitions. Live code is authoritative, but the plan phase should decide whether correction-open validation should be documented as review authorization plus state-machine control or moved to a correction-specific wrapper without expanding access.

## Current post-Feature-095 permission model

### Effective resolver

`src/lib/tenant/effective-permissions.ts` is the TypeScript source of truth for effective member capabilities.

Public helpers:

- `resolveEffectiveCapabilities`
- `userHasEffectiveCapability`
- `assertEffectiveCapability`
- `resolveEffectiveTenantCapabilities`
- `resolveEffectiveProjectCapabilities`
- `resolveEffectiveWorkspaceCapabilities`
- `assertEffectiveTenantCapability`
- `assertEffectiveProjectCapability`
- `assertEffectiveWorkspaceCapability`

Source metadata:

- `fixed_role`
- `system_reviewer_assignment`
- `photographer_workspace_assignment`
- `custom_role_assignment`

Denial reasons:

- `no_tenant_membership`
- `project_not_found`
- `workspace_not_found`
- `capability_not_supported_at_scope`
- `not_granted`
- `lookup_failed`

The resolver validates tenant membership with the request client, uses the service-role client for metadata lookups, validates project/workspace tenancy, applies the custom-role scope matrix, returns source rows for granted capabilities, and returns ignored custom-role capabilities with reasons from the scope matrix.

### Scope matrix

`src/lib/tenant/custom-role-scope-effects.ts` defines where custom-role capabilities can take effect.

Tenant-scoped custom roles can affect:

- organization user management capabilities;
- template management;
- profile view/manage;
- project creation;
- project workspace management;
- Media Library view/manage/delete/download.

Project-scoped custom roles can affect:

- project workspace management;
- operational capture/review/workflow/correction capabilities that are project-appropriate;
- project-level workflow actions such as finalization and project correction start.

Workspace-scoped custom roles can affect:

- workspace capture;
- workspace review;
- workspace correction;
- workspace correction reopen.

Workspace-scoped custom roles do not grant project-level workspace management, finalization, or project correction start. Tenant-scoped operational capabilities are deferred or ignored rather than treated as global operational grants.

### Operational routes now using the resolver

The main operational wrapper is `src/lib/projects/project-workspace-request.ts`. Its old route-facing helper names remain, but the underlying authorization path now calls `assertEffectiveWorkspaceCapability` for specific capability keys.

Resolver-backed operational route families include:

- asset upload/preflight/batch/finalize paths using `capture.upload_assets`;
- one-off invite create/revoke paths using `capture.create_one_off_invites` in normal capture mode and correction consent-intake capability in correction mode;
- recurring profile consent request paths using `capture.create_recurring_project_consent_requests` in normal capture mode and correction consent-intake capability in correction mode;
- upgrade request paths using `review.initiate_consent_upgrade_requests` in normal review mode and correction consent-intake capability in correction mode;
- review and matching routes using review wrappers backed by effective workspace capability checks;
- correction review mutation routes using `correction.review`;
- correction consent-intake routes using `correction.consent_intake`;
- correction media-intake routes using `correction.media_intake`;
- workspace correction reopen using `workflow.reopen_workspace_for_correction`.

Project-level workflow finalization and correction start use `assertEffectiveProjectCapability` with:

- `workflow.finalize_project`
- `workflow.start_project_correction`

Those handlers still carry old review-action fallback dependencies, which should be removed or isolated once tests and call sites are cleaned up.

### Route families still bypassing or partially bypassing the resolver

The following live paths still depend on old `resolveWorkspacePermissions` booleans after Feature 095:

- `src/app/api/projects/[projectId]/assets/route.ts` GET: selects a workspace through the effective visibility path, then calls `resolveWorkspacePermissions` and checks `canCaptureProjects || canReviewProjects`.
- `src/app/api/projects/[projectId]/matching-progress/route.ts`: calls `resolveWorkspacePermissions` and checks `canCaptureProjects || canReviewProjects`.
- `src/lib/project-export/response.ts`: selects a workspace through the effective visibility path, then calls `resolveWorkspacePermissions` and requires `canReviewProjects`.

These are cleanup candidates because they are operational/read-adjacent surfaces where old broad booleans can conflict with the effective-capability model.

### Old helpers still called

`src/lib/tenant/permissions.ts` remains live. Important call sites:

- project page calls `resolveProjectPermissions` only to check `projectPermissions.canManageMembers` before loading reviewer-access administration data;
- project finalization and correction start routes still pass `assertCanReviewProjectAction` as a fallback dependency;
- assets GET, matching progress, and project export call `resolveWorkspacePermissions`;
- project/workspace administration routes call `assertCanCreateProjectsAction` and `assertCanManageProjectWorkspacesAction`, which delegate to project administration custom-role-aware services.

Old operational assertion exports still exist:

- `assertCanCaptureProjectAction`
- `assertCanReviewProjectAction`
- `assertCanCaptureWorkspaceAction`
- `assertCanReviewWorkspaceAction`

Some tests from earlier features still import these helpers to prove old fixed-role/custom-role non-expansion boundaries.

### SQL/RLS helpers updated

Feature 094 added:

- `app.current_user_has_scoped_custom_role_capability`
- `public.current_user_has_scoped_custom_role_capability`

Feature 095 added or replaced operational SQL helpers:

- `app.current_user_has_any_operational_custom_role_project_access`
- `app.current_user_has_any_operational_custom_role_workspace_access`
- `app.current_user_has_fixed_capture_workspace_source`
- `app.current_user_has_fixed_review_project_source`
- `app.current_user_has_fixed_review_workspace_source`
- `app.current_user_can_access_project`
- `app.current_user_can_access_project_workspace`
- `app.current_user_can_capture_project`
- `app.current_user_can_capture_project_workspace`
- `app.current_user_can_review_project`
- `app.current_user_can_review_project_workspace`
- `app.current_user_can_create_one_off_invites`
- `app.current_user_can_create_recurring_project_consent_requests`
- `app.current_user_can_upload_project_assets`
- `app.current_user_can_initiate_consent_upgrade_requests`
- `app.current_user_can_finalize_project`
- `app.current_user_can_start_project_correction`
- `app.current_user_can_reopen_workspace_for_correction`
- `app.current_user_can_correction_review`
- `app.current_user_can_correction_consent_intake`
- `app.current_user_can_correction_media_intake`

Feature 095 also updated RLS policies for project/project-workspace selection and insert/update policies on invites, assets, profile participants, and consent upgrade requests.

### UI gates now using effective capabilities

The project page computes specific effective capability booleans with `resolveEffectiveProjectCapabilities` and `resolveEffectiveWorkspaceCapabilities`, then combines them with workflow state checks before showing or enabling controls.

Examples include:

- capture workspace opening;
- one-off invite creation;
- recurring profile consent requests;
- asset upload;
- review workspace opening;
- upgrade request initiation;
- project finalization;
- project correction start;
- workspace correction reopen;
- correction review;
- correction consent intake;
- correction media intake.

The project page still uses old `resolveProjectPermissions(...).canManageMembers` as a fixed owner/admin gate for reviewer-access administration, which is a permanent role-administration boundary but should be renamed or wrapped more explicitly.

### Permanent special boundaries still present

Permanent boundaries remain in separate helpers:

- owner/admin tenant safety and bootstrap in fixed membership role checks;
- role definition and role assignment administration in `custom-role-service.ts` and `custom-role-assignment-service.ts`;
- reviewer assignment administration in `reviewer-access-service.ts`;
- photographer workspace assignment through `project_workspaces.photographer_user_id`;
- public consent signing/revocation token flows;
- release snapshot and Media Library authorization;
- state-machine and idempotency checks in workflow services;
- audit/history behavior for release, correction, and consent flows.

## Cleanup candidate inventory

### TypeScript helpers in `src/lib/tenant/permissions.ts`

| Candidate | Current role | Classification | Research finding |
| --- | --- | --- | --- |
| `deriveTenantPermissionsFromRole` | Fixed-role derived booleans. | Rename now if low churn; otherwise keep and document fixed-role-only. | The name is too broad for the effective model. A `deriveFixedRoleTenantPermissions` name would better communicate that it excludes custom roles, reviewer assignments, and photographer assignments. |
| `deriveProjectPermissionsFromRole` | Fixed-role derived project booleans. | Rename now if low churn; otherwise keep and document fixed-role-only. | Same issue as tenant helper. |
| `resolveTenantPermissions` | Fixed membership role plus tenant-wide reviewer summary, not scoped custom roles. | Keep permanently for fixed-role/tenant safety surfaces, but do not use as general operational authorization. | Useful for owner/admin bootstrap and legacy fixed-role UI, but misleading if read as complete tenant access. |
| `resolveProjectPermissions` | Fixed role plus reviewer access, not custom roles. | Rename/wrap now where possible; keep until tests and fixed-role admin call sites are migrated. | Project page uses it only for fixed owner/admin reviewer-admin gating. That call should use a clearer role-admin helper. |
| `resolveAccessibleProjectWorkspaces` | Old fixed role/reviewer/photographer workspace visibility. | Keep temporarily as compatibility; prefer effective project-workspace service for operational UI. | Workflow finalization/correction fallback still references it. |
| `resolveWorkspacePermissions` | Fixed role/reviewer/photographer workspace booleans. | Convert or retire from operational call sites now. | Assets GET, matching progress, and project export still depend on it. These are the highest-risk stale helper call sites. |
| `assertCanCreateProjectsAction` | Delegates to project administration custom-role-aware service. | Keep; optionally rename later to project-administration capability language. | This is not an obsolete operational helper; it is a project administration boundary. |
| `assertCanManageProjectWorkspacesAction` | Delegates to project administration custom-role-aware service. | Keep. | Project/workspace administration is distinct from operational capture/review. |
| `assertCanCaptureProjectAction` | Old broad fixed-role helper. | Remove now if no live non-test callers remain, or convert to resolver-backed wrapper if retained for compatibility tests. | Source search found no live source call sites outside `permissions.ts`, but older tests still import old helpers. |
| `assertCanReviewProjectAction` | Old broad fixed-role/reviewer helper. | Convert/remove from workflow handler dependencies now. | Finalization and correction-start handlers should require effective project capabilities directly. |
| `assertCanCaptureWorkspaceAction` | Old fixed-role/photographer workspace helper. | Remove/convert to compatibility wrapper after test migration. | Older feature tests use this to assert non-expansion. |
| `assertCanReviewWorkspaceAction` | Old fixed-role/reviewer workspace helper. | Remove/convert to compatibility wrapper after test migration. | Older feature tests use this to assert reviewer behavior. |

### Project/workspace helper functions

| Candidate | Current role | Classification | Research finding |
| --- | --- | --- | --- |
| `project-workspace-request.ts` capture/review helper names | Route-facing compatibility wrappers around effective workspace capabilities. | Keep as wrappers now, but rename or add clearer capability-specific wrappers incrementally. | They preserve route-facing errors. Their names are operationally familiar but hide capability specificity. |
| `buildWorkspacePermissionsForCapability` | Adapts effective resolver result into legacy `WorkspacePermissions` shape. | Rename or constrain now; do not expose as source metadata. | The `reviewAccessSource: "owner_admin"` fallback is misleading for custom-role/reviewer grants. |
| `resolveSelectedWorkspaceForRequest` | Effective workspace selection wrapper. | Keep. | This is now a useful effective visibility helper. |
| `resolveProjectWorkspaceSelection` | Effective visibility resolution for project page/export paths. | Keep. | It uses effective project/workspace capabilities and should remain the preferred selection path. |
| `listVisibleProjectWorkspaces` | Lists workspaces using effective project/workspace capabilities. | Keep. | Useful operational visibility surface; watch N x workspace resolver cost. |
| Workflow route dependency fallback to `assertCanReviewProjectAction` | Compatibility fallback. | Remove now if feasible. | Feature 095 already passes `assertEffectiveProjectCapability`; retaining fallback keeps old helper confusion alive. |

### Old booleans in project and route data

| Candidate | Current role | Classification | Research finding |
| --- | --- | --- | --- |
| `canCaptureProjects` / `canReviewProjects` in `WorkspacePermissions` | Legacy broad booleans. | Keep only in fixed-role compatibility type; avoid in new operational authorization. | They do not express specific capabilities and can conflict with effective custom-role access. |
| `projectPermissions.canManageMembers` on project page | Fixed owner/admin reviewer-admin loading gate. | Rename/wrap now. | Behavior is correct as role-admin boundary, but the route should read as fixed owner/admin, not general project permissions. |
| Project page effective booleans such as `canCreateOneOffInvites` and `canCorrectionMediaIntake` | Specific effective UI gates. | No action. | These names align with the effective model. |
| `captureMutationsAllowed` / `reviewSafeMutationsAllowed` | State-machine combined booleans. | No action, but document as state gates. | These are not permission sources; they combine workflow state with effective capability gates. |

### Operational routes and adjacent read paths

| Candidate | Current role | Classification | Research finding |
| --- | --- | --- | --- |
| Assets POST/preflight/batch/finalize | Resolver-backed capture upload checks. | No action beyond naming cleanup. | Uses `capture.upload_assets` plus state checks. |
| Assets GET | Effective workspace selection, then legacy `resolveWorkspacePermissions` check. | Rename/convert now. | Should use effective capability semantics consistently. |
| Matching progress | Legacy `resolveWorkspacePermissions` check. | Rename/convert now. | Should not depend on broad fixed-role booleans after Feature 095. |
| Project export | Effective selection, then legacy `canReviewProjects` check. | Rename/convert now after deciding exact capability. | Likely should be a review-like effective capability or documented export-specific boundary. |
| Finalize/correction start | Effective project capability plus old fallback dependency. | Convert now. | Make effective resolver required and remove fallback. |
| Workspace workflow transitions | Wrapper-backed effective checks. | Keep wrappers; clarify capability branch. | Plan should decide whether correction-open validate remains `review.workspace` or shifts to `correction.review` without expanding access. |

### SQL helper functions and RLS wrappers

| Candidate | Current role | Classification | Research finding |
| --- | --- | --- | --- |
| `app.current_user_has_scoped_custom_role_capability` | Custom-role-only scoped SQL helper. | Keep permanently or long-term. | Useful RLS primitive; not a full effective resolver. |
| `public.current_user_has_scoped_custom_role_capability` | Public wrapper for scoped helper. | Keep unless proven unused and safe to remove later. | Public wrapper existence differs from Feature 094 plan, but removing SQL wrappers is churn. |
| `app.current_user_has_tenant_custom_role_capability` | Tenant-only custom-role helper from earlier features. | Keep; consolidate later if needed. | Still supports tenant surfaces and older wrappers. |
| Media Library custom-role SQL helpers | Tenant Media Library wrappers. | Keep. | Media Library remains a special release/tenant boundary. |
| Template/profile/org-user custom-role SQL wrappers | Tenant-surface wrappers. | Keep. | They protect surface-specific RLS and encode tenant-scope behavior. |
| Reviewer SQL helpers | Reviewer assignment model. | Keep until explicit replacement. | Reviewer access remains a permanent special model for now. |
| `app.current_user_can_access_project` / workspace | Broad RLS visibility wrappers. | Keep, but document. | SQL names are broad but stable RLS dependencies. |
| `app.current_user_can_capture_project` / `app.current_user_can_review_project` | Operational read wrappers. | Keep as RLS compatibility; document semantics. | Renaming SQL would create high churn. |
| Feature 095 action wrappers | Specific operational RLS wrappers. | Keep. | Names map well to specific effective capabilities. |

### Tests with stale helper names

| Candidate | Current role | Classification | Research finding |
| --- | --- | --- | --- |
| `tests/feature-073-project-workflow-routes.test.ts` | Finalize/correction tests still phrase checks as review permission and inject old fallback. | Rename/update now. | Should assert effective project capability dependency and route-facing errors. |
| `tests/feature-081/082/084/087/088/089` old helper imports | Historical non-expansion and reviewer tests. | Keep until wrapper migration; update selectively. | These tests are useful guardrails but should stop implying old helpers are the future source of truth. |
| `tests/feature-095-operational-permission-resolver-enforcement.test.ts` | Verifies selected effective route behavior. | Expand now. | Add stale-helper bypass/denial regression cases for assets GET, matching progress, project export, and finalize/correction fallback removal. |
| UI tests around member management | Existing custom-role assignment display tests. | Extend now. | Add owner/admin effective access detail display and delegated omission tests. |

### i18n/copy

| Candidate | Current role | Classification | Research finding |
| --- | --- | --- | --- |
| `members.roleReference.subtitle` | Says fixed roles map to current capabilities. | Rename/copy cleanup now. | Should distinguish fixed role baseline from effective access sources. |
| `members.customRoleAssignments.note` | Says custom roles grant only where enforcement has shipped. | Update now. | Operational enforcement has shipped; copy should describe scope and ignored capabilities instead. |
| Delegated member copy | Says custom roles and reviewer access remain owner/admin-managed. | Keep. | Aligns with permanent boundary. |
| New effective access strings | Not present. | Add in implementation phase. | Must add English and Dutch keys following existing structure. |

## Permanent boundary inventory

### Owner/admin bootstrap and tenant safety

Fixed owner/admin must remain special. They are the safety path for tenant administration, user recovery, role assignment, and bootstrap. Custom roles must not be able to delete or delegate away this root administrative boundary.

### Role administration owner/admin-only

Role definition and role assignment administration remain owner/admin-only in `custom-role-service.ts` and `custom-role-assignment-service.ts`. Operational custom roles intentionally do not grant role editor, role assignment, or reviewer-assignment administration.

### Reviewer access model

Reviewer access remains a system assignment model. It is distinct from custom roles because it represents explicit review coverage and supports tenant-wide/project reviewer assignment behavior. Feature 096 should document it as an effective access source, not replace it.

### Photographer workspace assignment

`project_workspaces.photographer_user_id` remains a direct operational capture source. It is workflow/staffing data, not custom-role data. Feature 096 should display it in effective access explanations where relevant, but not replace it.

### Public token flows

Public consent signing, public revocation, and invite/consent token flows are token-scoped and must not be collapsed into member effective permission checks. These paths intentionally authorize non-member or externally linked actions by token, expiry, and target object.

### Release snapshot and Media Library authorization

Release snapshots and Media Library access remain release/tenant-scoped. Media Library access currently combines owner/admin, tenant-wide reviewer, and tenant custom-role Media Library capabilities. It should remain separate from project/workspace operational authorization.

### State-machine checks

Workflow state checks in `project-workflow-service.ts` remain separate from capability checks. Capabilities answer "may this user perform this kind of action"; state-machine checks answer "is the project/workspace currently in a state where this action is valid."

### Idempotency and retry safety

Project finalization, correction start, invite/profile consent request creation, upgrade requests, and asset batch flows have idempotency/retry behavior. Cleanup must not change these semantics while refactoring permission wrappers.

### Audit/history behavior

Consent history, release snapshots, correction provenance, and reviewer/role assignment records are historical product records. Effective access UI can summarize current access reasons, but must not rewrite audit/history behavior.

## Effective access UI requirements

### Recommended location

The effective access view should live on the Members page for fixed owner/admin users.

Best fit: a restrained member-row expansion or simple row action that opens an inline details region for one member at a time. This matches the current member management flow, keeps the explanation next to the member being inspected, and avoids creating a broad IAM dashboard.

Secondary fit: a compact side panel or detail section in `member-management-panel.tsx` if the current table layout makes row expansion awkward. It should still be launched from a member row and scoped to one member.

Not recommended:

- a separate dashboard page;
- metric cards or hero-style IAM summary;
- loading all effective access details for all members by default;
- putting the primary effective access explanation on the project page.

The project page can keep capability-specific operational gates. Admins asking "why does this member have access?" are more likely to start from Members, and the required context crosses projects/workspaces.

### What the UI should show

The owner/admin view should show a concise explanation grouped by source and scope:

- fixed membership role;
- tenant custom-role assignments;
- project custom-role assignments;
- workspace custom-role assignments;
- reviewer access assignments, including tenant-wide vs project-specific;
- photographer workspace assignments;
- effective capabilities grouped by area;
- ignored custom-role capabilities caused by scope semantics;
- source labels explaining why access exists.

Suggested capability groups:

- organization users;
- templates and profiles;
- projects and workspaces;
- capture;
- review;
- workflow;
- correction;
- Media Library.

Each capability row should use product labels from the capability catalog/role editor metadata where available, not raw database keys as the primary text. Raw keys can be omitted or shown only as secondary developer-like text if the existing admin UI already exposes them.

### What the UI should not show

The UI should not show:

- raw database table names, RLS helper names, or SQL internals;
- service-role-only metadata;
- private implementation details such as resolver denial stack traces;
- broad IAM dashboard visuals;
- system source metadata to delegated non-owner/admin users;
- speculative access for every project/workspace in the tenant.

Delegated organization-user management UI should remain unchanged except for clearer copy if needed. Delegated users should not receive effective access admin data in props, server actions, or route responses.

### Data reusable from the current Members loader

`getTenantMemberManagementData` already loads much of the required context for owners/admins:

- members with `userId`, email, fixed role, creation date, and editability;
- reviewer access summary via `listReviewerAccessSummary`;
- role editor data and capability labels via `listRoleEditorData`;
- assignable custom roles;
- custom-role assignment summaries;
- custom-role assignment target labels for projects/workspaces;
- assignment effective/ignored capability metadata derived from the scope matrix.

This is enough to render a basic source summary for fixed roles, custom-role assignments, and reviewer access without additional access-resolution queries.

### Additional service queries needed

The UI still needs additional backend data for a complete explanation:

- photographer workspace assignments for the selected member, including project/workspace names and active/archive state filters;
- effective capability resolution for selected scopes, using `resolveEffectiveCapabilities` so source metadata and ignored capabilities match route authorization;
- a compact list of candidate scopes to resolve for the selected member;
- possibly a project/workspace target lookup for reviewer assignments and photographer assignments if not already available in the existing summaries.

The implementation should expose this through an owner/admin-only server-side service, server action, or route handler. It should derive tenant and admin authority server-side and must not accept `tenant_id` from the client.

## Effective access data model findings

### Reuse the resolver directly

The access explanation should reuse `resolveEffectiveCapabilities` rather than duplicating effective permission logic. The UI needs a presentation adapter, not a second authorization engine.

Recommended backend shape:

```ts
type MemberEffectiveAccessSummary = {
  userId: string;
  email: string;
  fixedRole: TenantMembershipRole;
  reviewerAccess: {
    tenantWide: boolean;
    projects: Array<{ projectId: string; projectName: string }>;
  };
  photographerAssignments: Array<{
    projectId: string;
    projectName: string;
    workspaceId: string;
    workspaceName: string;
  }>;
  customRoleAssignments: Array<{
    assignmentId: string;
    roleId: string;
    roleName: string;
    scopeType: "tenant" | "project" | "workspace";
    projectId?: string | null;
    projectName?: string | null;
    workspaceId?: string | null;
    workspaceName?: string | null;
    effectiveCapabilityKeys: string[];
    ignoredCapabilities: Array<{ capabilityKey: string; reason: string }>;
  }>;
  effectiveScopes: Array<{
    scopeType: "tenant" | "project" | "workspace";
    projectId?: string | null;
    projectName?: string | null;
    workspaceId?: string | null;
    workspaceName?: string | null;
    capabilityGroups: Array<{
      group: string;
      capabilities: Array<{
        key: string;
        label: string;
        sources: Array<{
          type: "fixed_role" | "system_reviewer_assignment" | "photographer_workspace_assignment" | "custom_role_assignment";
          label: string;
        }>;
      }>;
    }>;
  }>;
  warnings: Array<{ messageKey: string; details?: Record<string, string> }>;
};
```

The exact TypeScript type can be smaller, but it should preserve these concepts:

- selected member identity;
- fixed role;
- source summaries;
- effective capabilities grouped by scope and product area;
- source labels;
- ignored capabilities and warnings.

### Compute on demand per member

The service should compute effective access on demand for one selected member rather than loading full effective access for every member on page load.

Reasons:

- resolving every member across every project/workspace would be expensive;
- `listVisibleProjectWorkspaces` already demonstrates that per-workspace resolver calls can add up;
- most admin sessions will inspect only one or a few members;
- on-demand loading keeps the Members page restrained and responsive.

### Candidate scopes to resolve

The service should not resolve all possible project/workspace scopes in the tenant by default.

Recommended candidate scopes:

- tenant scope once for the selected member;
- project scopes where the member has project custom-role assignments;
- project scopes where the member has reviewer project assignments;
- project scopes connected to photographer workspace assignments;
- workspace scopes where the member has workspace custom-role assignments;
- workspace scopes where the member is the assigned photographer;
- optionally project/workspace scopes implied by tenant-wide reviewer access, summarized rather than fully enumerated.

Owner/admin fixed roles create broad access. For those users, the UI can explain "fixed owner/admin role grants broad tenant and operational access" without expanding every project and workspace.

### All possible capabilities vs assigned scopes

The UI should show assigned/relevant scopes, not all possible project/workspace capabilities. Showing every possible scope creates noise and performance risk.

For fixed owner/admin, show a compact fixed-role baseline plus broad effective groups. For reviewer tenant-wide access, show tenant-wide reviewer source plus the operational groups it affects. For custom roles, show each assignment and the capabilities that are effective at that assignment scope.

### Avoiding expensive N x projects x workspaces resolution

Use these constraints:

- one selected member at a time;
- precompute candidate scopes from assignments/reviewer/photographer data;
- use the existing assignment target summaries where possible;
- summarize broad fixed owner/admin and tenant-wide reviewer access instead of enumerating every project/workspace;
- cap or paginate detailed scope rows if the member has many assignments;
- keep resolver calls server-side and batched by candidate scope where the existing resolver API permits.

### Warnings

The data model should carry warnings for cases admins commonly misunderstand:

- a custom role assignment contains capabilities ignored at that scope;
- tenant-scoped operational custom-role capabilities are not global operational grants;
- workspace-scoped assignments do not grant project-level finalization or project workspace management;
- role administration is not granted by custom roles;
- public-token and release authorization are separate and not represented as member effective access.

## UI scope and constraints

The minimal UI should follow existing Members page patterns and `UNCODEXIFY.md`.

Constraints:

- no broad IAM dashboard;
- no hero, metrics, or card-heavy layout;
- no nested cards;
- no decorative gradients/orbs;
- use existing table/section typography and spacing;
- keep copy direct and operational;
- use existing i18n keys and add English/Dutch messages;
- make fixed role, custom roles, reviewer access, and photographer assignment visually distinct without over-designing;
- keep delegated UI unchanged except for any necessary copy cleanup;
- avoid exposing owner/admin-only source details to delegated users.

Suggested presentation:

- member row has a small "Access" action visible only to owner/admin;
- expanding the row loads or reveals a compact detail region;
- top line: fixed role and broad source summary;
- source groups: custom roles, reviewer access, photographer assignment;
- capability groups: collapsed or concise lists grouped by product area;
- ignored capability section only shown when present;
- use project/workspace names from existing target labels;
- show "No custom roles", "No reviewer access", or "No photographer workspaces" only as compact empty states inside the detail region.

The UI should answer "why does this user have access?" rather than trying to become a role design surface. Role editing and assignment controls should remain in their existing sections.

## Legacy helper cleanup strategy

### Misleading helper names

Most misleading names:

- `resolveTenantPermissions`
- `resolveProjectPermissions`
- `resolveWorkspacePermissions`
- `assertCanCaptureProjectAction`
- `assertCanReviewProjectAction`
- `assertCanCaptureWorkspaceAction`
- `assertCanReviewWorkspaceAction`
- `canCaptureProjects`
- `canReviewProjects`
- SQL wrappers named `current_user_can_capture_project` and `current_user_can_review_project` when used as broad visibility gates.

The TypeScript names are more urgent because they influence new code. SQL names should be treated as stable RLS wrapper names unless there is a very small, proven-safe rename.

### Wrapping vs deletion

Prefer wrapper cleanup over broad deletion:

- keep route-facing helper names where they preserve stable error codes;
- make effective capability keys explicit at the wrapper boundary;
- add comments where wrappers intentionally preserve legacy error codes;
- remove old helpers only when source and test call sites are gone;
- avoid a large SQL rename migration during Feature 096.

### Page-level props

`canCaptureProjects` and `canReviewProjects` should not be used for new project page or route authorization. Existing compatibility types can keep them temporarily, but the project page should prefer action-specific booleans derived from effective capabilities.

### Route helpers

Route helpers can keep old names temporarily if they call the resolver and preserve stable route errors. New helpers should be capability-specific where possible, for example:

- require upload-assets capability;
- require one-off-invite capability;
- require recurring-request capability;
- require review-upgrade capability;
- require correction-review capability;
- require correction-consent-intake capability;
- require correction-media-intake capability.

### SQL wrappers

SQL wrappers should keep old names for RLS stability in Feature 096. Document which wrappers are compatibility/visibility wrappers and which wrappers map to specific actions.

### Deferred cleanup

Defer:

- broad SQL helper renames;
- replacing reviewer access with custom roles;
- replacing photographer assignment with custom roles;
- changing Media Library/release authorization;
- changing public token authorization;
- rewriting all historical tests around old helper names in one pass.

Focus Feature 096 on high-impact stale operational call sites, clearer wrapper names/comments, and the minimal effective access UI.

## Test strategy

### Existing coverage that proves the model

Feature 093 tests already cover scoped custom-role assignment behavior:

- tenant/project/workspace assignment creation;
- idempotent assignment;
- invalid target rejection;
- assignment revocation;
- owner/admin-only assignment;
- RLS direct-write protection;
- assignment target summaries;
- Members UI assignment labels and warnings.

Feature 094 tests cover the effective resolver foundation:

- fixed reviewer/photographer behavior;
- tenant/project/workspace custom-role resolution;
- revoked/archived/system/wrong-scope/cross-tenant cases;
- SQL scoped helper parity;
- tenant-only surface parity;
- custom roles do not grant role administration.

Feature 095 tests cover selected operational enforcement:

- upload uses specific effective capture capability and state checks;
- correction review requires correction capability after finalization;
- workflow handlers pass project/workspace workflow capabilities;
- project operational custom roles do not grant Media Library.

Feature 082 tests cover reviewer access assignment and enforcement. Features 083/084/091 cover role administration boundaries. Features 085/086/087/088/089 cover tenant custom-role enforcement for Media Library, templates/profiles, project administration, and organization users. Workflow/correction/public token/release tests cover state and public/release boundaries.

### Tests to add or update for Feature 096

Cleanup regression tests:

- assets GET should not depend on old `resolveWorkspacePermissions` booleans after effective access is granted;
- matching progress should not depend on old `resolveWorkspacePermissions` booleans after effective access is granted;
- project export should either use an effective review-like capability or explicitly document and test its preserved boundary;
- finalization and correction-start handlers should require effective project capability dependency and should not call old review fallback;
- compatibility wrappers should preserve route-facing error codes.

Wrapper behavior tests:

- kept compatibility wrappers should call the effective resolver with the expected capability key;
- old helper wrappers, if retained, should be clearly tested as compatibility wrappers rather than the source of truth;
- old broad fixed-role helpers should remain unable to grant role administration through custom roles.

Effective access data model tests:

- owner/admin service returns fixed role, custom-role assignments, reviewer summary, photographer workspace assignments, effective capabilities, sources, and ignored capabilities for a selected member;
- custom-role ignored capabilities are surfaced for tenant/project/workspace scope mismatches;
- fixed owner/admin summary does not require enumerating every project/workspace;
- tenant-wide reviewer access is summarized without expensive all-workspace expansion;
- cross-tenant assignments or stale target references are not leaked.

Members UI tests:

- owner/admin can open an effective access detail for a member;
- detail shows fixed role, custom roles, reviewer access, photographer assignment, capability groups, source labels, and ignored capabilities;
- empty source states are compact and restrained;
- delegated user path does not receive or render effective access details;
- user-facing copy uses i18n messages in English and Dutch.

Boundary guardrail tests:

- public consent signing and revocation token flows are unaffected;
- organization invite acceptance remains token/session scoped as currently designed;
- release snapshot and Media Library access remain separate;
- role definition and role assignment administration remain owner/admin-only;
- reviewer access administration remains owner/admin-only;
- state-machine checks still reject otherwise-capable users when workflow state disallows the action;
- idempotent writes still behave retry-safely after wrapper cleanup.

### Tests with stale names to update

Known stale or confusing test areas:

- `tests/feature-073-project-workflow-routes.test.ts` still says finalize/correction routes check review permission and injects `assertCanReviewProjectAction`;
- older tests import `assertCanCaptureWorkspaceAction`, `assertCanReviewWorkspaceAction`, and `assertCanReviewProjectAction` to prove non-expansion boundaries;
- old UI tests use `canCaptureProjects`/`canReviewProjects` fixtures for legacy workflow components.

Do not rewrite historical tests wholesale. Update only tests touched by Feature 096 cleanup and add new tests that describe the effective model clearly.

## Documentation strategy

### `docs/rpi/SUMMARY.md`

Update the summary with Features 092 through 096:

- capability scope semantics and migration map;
- scoped custom-role assignments;
- effective scoped resolver;
- operational resolver enforcement;
- permission cleanup and effective access UI.

The summary should describe the final model succinctly:

- fixed owner/admin remains the root administrative boundary;
- operational routes use effective capabilities;
- effective access combines fixed roles, system reviewer assignments, photographer workspace assignments, and scoped custom-role assignments;
- public token and release/Media Library authorization remain separate;
- state-machine checks remain separate;
- owners/admins can inspect current effective access reasons.

### `ARCHITECTURE.md`

Add or update a short architecture note for effective scoped permissions if the implementation phase changes names or introduces the effective access service. The architecture doc should not duplicate all RPI history, but it should prevent future code from using legacy fixed-role helpers as general authorization.

### RPI docs

RPI docs should remain the detailed design history. Feature 096 should not rewrite old RPI docs except for the new `research.md` and later `plan.md`. Use `SUMMARY.md` for the current cross-feature state.

### Inline comments

Add concise comments during implementation only where they protect invariants:

- owner/admin-only role administration;
- legacy wrappers that preserve route-facing errors while calling effective capabilities;
- SQL wrappers intentionally kept for RLS stability;
- state-machine checks intentionally separate from capabilities;
- public token/release flows intentionally separate from member effective access.

## Options considered

### Option A - Cleanup only

Remove, wrap, or rename old helpers and update docs/tests, but do not add UI.

Pros:

- smallest implementation;
- safest immediately after Feature 095;
- reduces code confusion.

Cons:

- owners/admins still cannot understand why a user has access;
- custom roles, reviewer assignments, and photographer assignment remain hard to reason about together;
- does not meet the feature purpose of explaining effective access.

### Option B - Effective access UI only

Add an owner/admin effective access UI but leave helper cleanup for later.

Pros:

- improves admin usability quickly;
- can reuse existing member loader data and resolver metadata;
- avoids touching route helpers.

Cons:

- old helper confusion remains in code;
- stale operational call sites such as assets GET, matching progress, and project export may continue to conflict with the effective model;
- new UI could accurately explain access that some old route path still denies.

### Option C - Cleanup plus minimal effective access UI

Clean up the highest-risk old operational helper paths, clarify wrapper names/comments, update docs/tests, and add a minimal owner/admin effective access view on Members.

Pros:

- addresses maintainability and admin clarity together;
- keeps the implementation bounded;
- aligns with the finish-line definition for the permissions migration;
- avoids a broad dashboard or permission redesign;
- makes tests document the new model.

Cons:

- larger than cleanup-only or UI-only;
- needs careful scoping to avoid a second large migration after Feature 095;
- requires a new owner/admin-only data service for effective access summaries.

### Option D - Full IAM dashboard and full helper deletion

Build a broad IAM dashboard and delete/rename all old helpers, including SQL wrappers.

Pros:

- appears complete;
- could remove old naming ambiguity.

Cons:

- too broad and risky after a large migration;
- violates the restrained UI direction;
- high SQL/RLS churn;
- likely expands the feature beyond cleanup;
- risks changing behavior in public token, release, reviewer, or photographer boundaries.

## Recommendation

Choose Option C: cleanup plus a minimal effective access UI.

Recommended implementation direction for the plan phase:

- keep fixed owner/admin role administration special;
- keep public token, release/Media Library, reviewer access, and photographer assignment boundaries separate;
- remove or convert high-risk stale operational call sites that still depend on `resolveWorkspacePermissions` booleans;
- make finalization/correction project workflow handlers require effective project capabilities directly;
- keep SQL wrapper names for RLS stability and document compatibility semantics;
- keep route-facing wrappers where they preserve error codes, but make capability keys explicit;
- add an owner/admin-only, on-demand effective access detail on the Members page;
- reuse `resolveEffectiveCapabilities` and existing member loader data;
- add focused tests for cleanup regressions, effective access data, owner/admin-only UI, delegated omission, and boundary guardrails;
- update `SUMMARY.md` and possibly `ARCHITECTURE.md` with the final effective permission model.

Do not redesign the permission system.

## Risks and tradeoffs

- Renaming too much at once could create a large diff after Feature 095 and obscure behavior-preservation review.
- Leaving SQL wrapper names in place preserves stability but means some broad names remain in the database layer.
- On-demand effective access avoids expensive page loads but adds a request path/server action that must be owner/admin protected.
- Effective access explanations can become noisy for owner/admin or tenant-wide reviewer users; summarize broad sources instead of enumerating every scope.
- Existing old tests still use legacy helper names. Updating all of them would be churn; updating none of them leaves the old model overrepresented.
- Project export and matching progress need a precise capability decision in the plan phase because they are read/export surfaces rather than direct capture/review mutations.
- UI source labels must be clear without leaking internals or implying custom roles grant role administration.

## Explicit open decisions for the plan phase

1. Which effective capability should authorize authenticated project export, or should export remain a separate review/release boundary with an explicit helper?
2. Which effective capability should authorize matching progress reads: any capture/review access, specific review access, or a dedicated existing capability?
3. Should assets GET require any effective capture/review capability for the selected workspace, or should effective workspace selection itself be sufficient?
4. Should workspace validation during correction-open state continue using `review.workspace`, or should the wrapper branch to `correction.review` for correction-mode validation?
5. Should old TypeScript helper names be renamed in Feature 096, or should they be kept with comments while call sites are moved away?
6. Should old assertion helpers in `permissions.ts` be deleted if only tests use them, or retained as deprecated compatibility wrappers for one more feature?
7. What exact owner/admin-only transport should the effective access UI use: server action, route handler, or page-level lazy section?
8. How much raw capability-key text should the UI show versus localized capability labels only?
9. Should tenant-wide reviewer and owner/admin broad access be summarized only, or should the UI allow optional expansion into project/workspace examples?
10. Should `ARCHITECTURE.md` be updated in Feature 096, or should `SUMMARY.md` plus RPI docs be the only documentation updates?

