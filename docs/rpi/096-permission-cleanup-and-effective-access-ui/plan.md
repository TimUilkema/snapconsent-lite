# Feature 096 - Permission Cleanup and Effective Access UI Plan

## Scope and contract

Feature 096 implements the cleanup and explanation slice after Feature 095.

This is the plan phase only. It does not implement code, migrations, UI changes, tests, route changes, helper changes, or runtime behavior changes.

Implementation must not expand access. The goal is to make the completed permission model easier to maintain and understand:

- fixed owner/admin remains special for bootstrap, tenant safety, and role administration;
- operational member authorization uses effective capabilities;
- effective capabilities combine fixed role, reviewer assignment, photographer workspace assignment, and tenant/project/workspace custom role assignments;
- public token authorization remains token-scoped;
- release snapshot and Media Library authorization remain release/tenant-scoped;
- state-machine checks remain separate from permission checks;
- owners/admins can inspect why a member has access.

In scope:

- clean or isolate high-risk stale operational helper paths;
- update assets GET and matching progress away from old broad `resolveWorkspacePermissions` booleans;
- preserve ZIP export as a restrictive legacy path planned for removal;
- remove the old review-project fallback dependency from finalization/correction-start handlers;
- add a minimal owner/admin-only effective access detail on the Members page;
- add a backend service and route for one-member effective access summaries;
- add tests for cleanup, UI, delegated omission, permanent boundaries, and ZIP export preservation if touched;
- update `docs/rpi/SUMMARY.md` and add a short `ARCHITECTURE.md` note if implementation adds the effective access service;
- add concise comments for permanent boundaries where implementation touches them.

Out of scope:

- new capability keys;
- capability scope matrix changes;
- delegated role administration;
- public token behavior changes;
- release snapshot authorization changes;
- reviewer access replacement;
- photographer assignment replacement;
- business workflow/state-machine changes;
- broad IAM dashboard;
- owner/admin fixed-role deletion;
- broad SQL helper rename migration;
- ZIP export authorization redesign;
- expanded ZIP export access for project/workspace custom-role assignees;
- ZIP export in the effective access UI.

## Inputs and ground truth

Primary input:

- `docs/rpi/096-permission-cleanup-and-effective-access-ui/research.md`

Required context read before planning:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `UNCODEXIFY.md`
- `docs/rpi/README.md`
- `docs/rpi/SUMMARY.md`

Governing recent permission plans read:

- `docs/rpi/092-capability-scope-semantics-and-permission-migration-map/plan.md`
- `docs/rpi/093-scoped-custom-role-assignment-foundation/plan.md`
- `docs/rpi/094-effective-scoped-permission-resolver-foundation/plan.md`
- `docs/rpi/095-operational-permission-resolver-enforcement/plan.md`

Targeted live verification covered:

- `src/lib/tenant/effective-permissions.ts`
- `src/lib/projects/project-workspace-request.ts`
- `src/lib/projects/project-workflow-route-handlers.ts`
- `src/lib/projects/project-workspaces-service.ts`
- `src/lib/tenant/permissions.ts`
- `src/app/api/projects/[projectId]/assets/route.ts`
- `src/app/api/projects/[projectId]/matching-progress/route.ts`
- `src/lib/project-export/response.ts`
- `src/app/api/projects/[projectId]/finalize/route.ts`
- `src/app/api/projects/[projectId]/correction/start/route.ts`
- `src/app/(protected)/members/page.tsx`
- `src/components/members/member-management-panel.tsx`
- `src/components/members/delegated-member-management-panel.tsx`
- `src/lib/tenant/member-management-service.ts`
- `src/lib/tenant/custom-role-assignment-service.ts`
- `src/lib/tenant/reviewer-access-service.ts`
- Feature 095 SQL migration
- `messages/en.json`
- `messages/nl.json`
- relevant tests for Features 043, 073, 091, 093, 094, and 095.

Live code, migrations, and tests are authoritative over RPI docs.

## Drift from research

No plan-blocking drift was found.

Confirmed or corrected details:

- Assets GET still selects a workspace through effective visibility, then re-checks old `resolveWorkspacePermissions` booleans.
- Matching progress still selects a workspace through effective visibility, then re-checks old `resolveWorkspacePermissions` booleans.
- ZIP export still selects a workspace through effective visibility, then intentionally requires old restrictive `resolveWorkspacePermissions(...).canReviewProjects`.
- Project finalization and correction-start handlers call effective project capabilities when injected, but still keep optional `assertCanReviewProjectAction` fallback dependencies.
- `project-workspace-request.ts` is resolver-backed but still adapts effective grants into old `WorkspacePermissions` booleans for compatibility.
- Correction review helpers in `project-workspace-request.ts` already branch to `correction.review` after finalization. The generic workspace workflow transition handler still passes `review.workspace` for non-handoff transitions. Feature 096 will not change that generic transition behavior unless a touched test proves it is part of stale fallback cleanup.
- The Members page already has Feature 093 scoped custom-role assignment UI and owner/admin-only assignment target data. Effective access should be added as a row detail, not a new dashboard.
- The research classified ZIP export as a cleanup candidate. The product decision for this plan reclassifies it as a temporary restrictive legacy/removal-boundary path.

## Chosen option

Choose Option C: cleanup plus minimal effective access UI.

Reject:

- cleanup only, because owners/admins would still lack an explanation of effective access;
- UI only, because stale route/helper paths would remain confusing and could still deny intended effective access;
- full IAM dashboard and full helper deletion, because it is too broad, risky, and violates the UI constraints.

## Stale operational call-site cleanup plan

### Assets GET

Current state:

- `src/app/api/projects/[projectId]/assets/route.ts` GET calls `resolveSelectedWorkspaceForRequest`.
- That selection already uses effective workspace/project visibility.
- The route then calls `resolveWorkspacePermissions` and checks `canCaptureProjects || canReviewProjects`.

Plan:

- Add a small effective workspace read helper, preferably in `src/lib/projects/project-workspace-request.ts`.
- Suggested name: `requireWorkspaceOperationalReadAccessForRequest`.
- Inputs should match `resolveSelectedWorkspaceForRequest` plus optional already-selected workspace if implementation wants to avoid selecting twice.
- It must derive authorization from effective workspace capabilities, not `resolveWorkspacePermissions`.
- It must preserve route-facing error code `workspace_read_forbidden`.
- It must not authorize project-level workflow-only visibility by itself.

Decision:

- Assets GET should require at least one effective workspace operational capability for the selected workspace.
- Use this capability set:
  - `capture.workspace`
  - `capture.create_one_off_invites`
  - `capture.create_recurring_project_consent_requests`
  - `capture.upload_assets`
  - `review.workspace`
  - `review.initiate_consent_upgrade_requests`
  - `workflow.reopen_workspace_for_correction`
  - `correction.review`
  - `correction.consent_intake`
  - `correction.media_intake`
- Do not treat project-level `workflow.finalize_project` or `workflow.start_project_correction` as enough to read workspace assets.

Implementation shape:

- The route still resolves auth and tenant server-side.
- The helper calls `resolveSelectedWorkspaceForRequest`, then `resolveEffectiveWorkspaceCapabilities`.
- If none of the workspace operational capabilities is present, throw `HttpError(403, "workspace_read_forbidden", "Project workspace access is forbidden.")`.
- Return the selected workspace so the route can continue unchanged.

Tests:

- A workspace custom role with a workspace operational capability can read assets where the old fixed-role boolean would deny.
- A project custom role with a workspace-supported operational capability can read assets in that project.
- A project custom role with only `workflow.finalize_project` cannot read assets.
- Wrong workspace remains `workspace_not_found`.
- No operational capability remains `workspace_read_forbidden`.

### Matching progress

Current state:

- `src/app/api/projects/[projectId]/matching-progress/route.ts` calls `resolveSelectedWorkspaceForRequest`.
- It then calls `resolveWorkspacePermissions` and checks `canCaptureProjects || canReviewProjects`.

Plan:

- Use the same `requireWorkspaceOperationalReadAccessForRequest` helper as assets GET.
- Keep route-facing error code `workspace_read_forbidden`.
- Keep project existence lookup and tenant scoping unchanged.

Decision:

- Matching progress requires the same effective workspace operational read access as assets GET.
- This intentionally fixes stale denial for project/workspace operational custom-role users.
- It does not grant access from project-level workflow-only visibility.

Tests:

- A project/workspace operational custom-role user can read matching progress for an authorized workspace.
- A project workflow-only custom-role user cannot read matching progress.
- Existing owner/admin, assigned photographer, and reviewer-assignment behavior remains valid.
- Wrong tenant/project/workspace behavior remains non-leaky.

### Project ZIP export

Current state:

- `src/lib/project-export/response.ts` uses effective workspace selection.
- It then requires `resolveWorkspacePermissions(...).canReviewProjects`.
- Existing Feature 043 tests verify photographers cannot export and reviewers can export.

Product decision:

- ZIP export is planned for later removal/deprecation.
- Feature 096 must preserve current restrictive authorization behavior.
- Do not broaden ZIP export to project/workspace custom-role users.
- Do not add ZIP export to the effective access UI.
- Do not add a new export capability.
- Do not redesign export authorization.

Plan:

- Leave the old `resolveWorkspacePermissions(...).canReviewProjects` authorization check in place.
- If implementation touches `src/lib/project-export/response.ts`, add a concise TODO/deprecation comment directly above the old check:

```ts
// ZIP export is a legacy path planned for removal; keep its restrictive reviewer-only authorization until then.
```

- Keep route-facing error code `project_export_forbidden`.
- Keep existing export tests green.

Tests:

- If the file is touched, add a Feature 096 regression proving a project/workspace custom role with `review.workspace` does not gain ZIP export access.
- Keep existing Feature 043 photographer-denied and reviewer-allowed tests green.

### Project finalization and correction-start fallback dependencies

Current state:

- `handleProjectFinalizePost` and `handleProjectCorrectionStartPost` use `assertEffectiveProjectCapability` when injected.
- They still keep optional fallback dependencies:
  - `resolveAccessibleProjectWorkspaces`
  - `assertCanReviewProjectAction`
- The concrete routes still import and pass those old fallback dependencies.

Plan:

- Make `assertEffectiveProjectCapability` required in both dependency types.
- Remove `resolveAccessibleProjectWorkspaces` and `assertCanReviewProjectAction` from:
  - `ProjectFinalizeDependencies`
  - `ProjectCorrectionStartDependencies`
  - `src/app/api/projects/[projectId]/finalize/route.ts`
  - `src/app/api/projects/[projectId]/correction/start/route.ts`
  - route tests that inject dependencies.
- Keep the existing `assertProjectWorkflowCapability` adapter and route-facing error semantics.
- Preserve capability mapping:
  - finalization: `workflow.finalize_project`
  - correction start: `workflow.start_project_correction`
- Preserve route-facing forbidden code `project_review_forbidden` in Feature 096 to avoid client/test churn.

Tests:

- Finalize handler calls `workflow.finalize_project` and never calls old review fallback.
- Correction-start handler calls `workflow.start_project_correction` and never calls old review fallback.
- Existing finalization idempotency/release repair tests remain green.
- Existing correction-start state/release tests remain green.

### Additional stale call sites

Targeted source search found no additional source call sites for old operational helpers beyond:

- project page fixed owner/admin reviewer-admin gate through `resolveProjectPermissions`;
- assets GET;
- matching progress;
- ZIP export;
- finalization/correction-start fallback dependency;
- compatibility boolean adapter inside `project-workspace-request.ts`.

Project page `resolveProjectPermissions(...).canManageMembers` is a role-administration boundary, not operational authorization. Keep behavior, but clarify naming/comments if touched.

## ZIP export deprecation/preservation plan

ZIP export is a temporary legacy/removal-boundary path for Feature 096.

Implementation rules:

- Do not migrate ZIP export to effective operational capabilities.
- Do not add a ZIP export capability.
- Do not include ZIP export in owner/admin effective access summaries.
- Do not broaden ZIP export access to project/workspace custom-role assignees.
- Preserve current restrictive review-like fixed/reviewer assignment behavior.
- Add only a concise TODO/deprecation comment if touching the file.
- Keep Feature 043 export tests green.

Documentation:

- Mention in `SUMMARY.md` that ZIP export is intentionally excluded from final effective-permission polish because it is planned for removal.
- Mention it as a legacy path in the Feature 096 docs/summary updates, not as a model for future authorization.

## Legacy helper cleanup classification

| Helper or name | Classification | Feature 096 action |
| --- | --- | --- |
| `deriveTenantPermissionsFromRole` | Keep temporarily. | Add or adjust comments if touched to clarify fixed-role-only baseline. Do not rename now. |
| `deriveProjectPermissionsFromRole` | Keep temporarily. | Add or adjust comments if touched to clarify fixed-role-only baseline. Do not rename now. |
| `resolveTenantPermissions` | Keep permanently for fixed owner/admin safety and compatibility. | Document as fixed-role/reviewer baseline, not general effective authorization. |
| `resolveProjectPermissions` | Keep temporarily/permanent boundary for fixed admin checks. | Do not use for operational authorization. If project page gate is touched, wrap or comment that `canManageMembers` is fixed owner/admin role administration. |
| `resolveWorkspacePermissions` | Keep temporarily. | Remove from assets GET and matching progress. Keep for ZIP export and old tests. |
| `assertCanCreateProjectsAction` | Keep permanently for project administration surface. | No Feature 096 change. It delegates to project administration custom-role-aware service. |
| `assertCanManageProjectWorkspacesAction` | Keep permanently for project administration surface. | No Feature 096 change. |
| `assertCanCaptureProjectAction` | Keep temporarily. | Do not delete in Feature 096 because older tests still import it. Mark/comment as legacy fixed-role compatibility only if touched. |
| `assertCanReviewProjectAction` | Keep temporarily, but remove from workflow route handlers. | Stop using it in finalization/correction-start. Keep export/tests compatibility. |
| `assertCanCaptureWorkspaceAction` | Keep temporarily. | Do not delete in Feature 096 because older tests still import it. Mark/comment as legacy fixed-role compatibility only if touched. |
| `assertCanReviewWorkspaceAction` | Keep temporarily. | Do not delete in Feature 096 because older tests still import it. Mark/comment as legacy fixed-role compatibility only if touched. |
| `canCaptureProjects` | Keep only inside legacy compatibility types/tests. | Do not use as source of truth for new operational route authorization. Remove from assets GET/matching progress paths. |
| `canReviewProjects` | Keep only inside legacy compatibility types/tests and ZIP export. | Do not use as source of truth for migrated operational route authorization. Keep for restrictive ZIP export. |
| `buildWorkspacePermissionsForCapability` | Keep as compatibility adapter. | Do not expose its `reviewAccessSource` as real source metadata. Add comment if touched. |
| SQL `current_user_can_*` wrappers | Keep. | No rename migration. Treat broad names as RLS-stable wrappers. |

No broad helper deletion is planned. The implementation should make old helpers less likely to be reused by moving high-risk call sites away and documenting fixed-role-only compatibility where touched.

## Effective access UI plan

### Placement

Add a minimal owner/admin-only effective access detail to the existing Members page.

UI placement:

- Add an `Access` row action in `MemberManagementPanel`.
- Clicking it expands a single detail row directly under the selected member row.
- The expanded row spans the table columns and uses the existing table/section style.
- Only one member should be expanded at a time.
- Do not add a new dashboard page.
- Do not add metrics, charts, hero copy, large cards, or broad IAM visuals.
- Do not add anything to `DelegatedMemberManagementPanel`.

The action should be visible for all current members shown to owner/admin users, including owner rows that are protected from edit/remove.

### Loading behavior

Use route-loaded, one-member-at-a-time data.

Plan:

- Add route `GET /api/members/[userId]/effective-access`.
- `MemberManagementPanel` uses `fetch` when an admin opens a member's access detail.
- Cache the fetched result in component state by `userId` for the current page session.
- Show a compact loading line while the request is pending.
- Show a compact error line if the request fails.
- Do not load effective access summaries for all members in `getTenantMemberManagementData`.

Reason:

- the component is already a client component using fetch for member mutations;
- route-loaded data avoids an expensive all-members page load;
- delegated users never receive the route data unless they successfully pass owner/admin checks, which they should not.

### Display content

The detail should show:

- fixed role;
- custom role assignments by scope and target;
- reviewer access summary;
- photographer workspace assignments;
- effective capability groups for resolved scopes;
- source labels for why each group/capability exists;
- ignored custom-role capabilities;
- warnings.

Use existing capability labels and group labels from the role capability/i18n setup. Avoid raw capability keys as primary text.

Recommended layout inside expanded row:

- a short fixed-role line;
- a source summary list:
  - custom roles;
  - reviewer access;
  - photographer workspaces;
- a restrained effective capabilities section grouped by scope:
  - organization;
  - project;
  - workspace;
- ignored capability warnings only when present.

Empty states should be terse:

- no custom role assignments;
- no reviewer access;
- no photographer workspaces;
- no effective operational sources beyond fixed role.

### Delegated omission

Delegated users must not receive effective access data:

- no props on `DelegatedMemberManagementPanel`;
- no access action in delegated UI;
- route checks fixed owner/admin and returns `tenant_member_management_forbidden` for delegated users;
- tests should assert delegated directory data still omits privileged fields.

### ZIP export exclusion

Do not show ZIP export in the effective access UI. It is a legacy/removal-boundary path and not part of the final effective operational access model.

## Effective access data service plan

### New service

Add a focused service:

```text
src/lib/tenant/member-effective-access-service.ts
```

Primary export:

```ts
getMemberEffectiveAccessSummary(input: {
  supabase: SupabaseClient;
  tenantId: string;
  actorUserId: string;
  targetUserId: string;
}): Promise<MemberEffectiveAccessSummary>
```

Authorization:

- derive `tenantId` before calling the service;
- never accept `tenant_id` from client input;
- require the actor to be fixed owner/admin by checking `resolveTenantPermissions(...).canManageMembers`;
- reject delegated users with `tenant_member_management_forbidden`;
- validate the target user is a current member of the tenant;
- service-role reads must be tenant-filtered and target-user-filtered.

### Output shape

Use a presentation-oriented type. Exact names can vary, but the shape should include:

```ts
type MemberEffectiveAccessSummary = {
  userId: string;
  email: string;
  fixedRole: MembershipRole;
  customRoleAssignments: Array<{
    assignmentId: string;
    roleId: string;
    roleName: string;
    scopeType: "tenant" | "project" | "workspace";
    projectId: string | null;
    projectName: string | null;
    workspaceId: string | null;
    workspaceName: string | null;
    effectiveCapabilityKeys: TenantCapability[];
    ignoredCapabilityKeys: TenantCapability[];
  }>;
  reviewerAccess: {
    tenantWide: boolean;
    projects: Array<{ assignmentId: string; projectId: string; projectName: string }>;
  };
  photographerAssignments: Array<{
    projectId: string;
    projectName: string;
    workspaceId: string;
    workspaceName: string;
  }>;
  effectiveScopes: Array<{
    scopeType: "tenant" | "project" | "workspace";
    projectId: string | null;
    projectName: string | null;
    workspaceId: string | null;
    workspaceName: string | null;
    capabilityGroups: Array<{
      groupKey: string;
      capabilityKeys: TenantCapability[];
      sources: Array<{
        sourceType:
          | "fixed_role"
          | "system_reviewer_assignment"
          | "photographer_workspace_assignment"
          | "custom_role_assignment";
        label: string;
      }>;
    }>;
  }>;
  ignoredCapabilities: Array<{
    capabilityKey: TenantCapability;
    assignmentId: string;
    roleName: string;
    scopeType: "tenant" | "project" | "workspace";
    reason: string;
  }>;
  warnings: Array<{
    key: string;
    values?: Record<string, string>;
  }>;
};
```

Do not include raw SQL helper names, RLS policy names, service-role metadata, or ZIP export.

### Data sources to reuse

Reuse existing services/data where practical:

- target member fixed role from `memberships`;
- custom role assignments from `listCustomRoleAssignmentsForMembers` or `resolveCustomRoleAssignmentSummary`;
- reviewer access from `listReviewerAccessSummary`;
- capability labels/groups from `CAPABILITY_GROUPS`, `CAPABILITY_LABEL_KEYS`, and existing i18n messages;
- effective capabilities and source metadata from `resolveEffectiveCapabilities` / scope convenience helpers.

The service may call owner/admin-only existing services and filter to `targetUserId`, but avoid loading more than needed if implementation can add small internal query helpers cleanly.

### Photographer assignment loading

Add a small service-role query inside the new service or a local helper:

- table: `project_workspaces`;
- filter:
  - `tenant_id = tenantId`;
  - `photographer_user_id = targetUserId`;
- select:
  - workspace id/name;
  - project id;
  - project name/status through a tenant-scoped project lookup or join.

Include current existing assignments as access sources. Do not convert them to custom roles.

### Effective scope resolution

Reuse `resolveEffectiveCapabilities` directly.

Resolve only candidate scopes:

- tenant scope once;
- project scopes from project custom-role assignments;
- project scopes from reviewer project assignments;
- project scopes connected to photographer assignments;
- workspace scopes from workspace custom-role assignments;
- workspace scopes from photographer assignments.

Do not enumerate every project/workspace for:

- fixed owner/admin;
- tenant-wide reviewer access;
- tenant custom roles.

For broad sources:

- summarize fixed owner/admin as broad fixed-role access;
- summarize tenant-wide reviewer access as tenant-wide reviewer access;
- show tenant custom role effective tenant capabilities and assignment scope warnings;
- do not run N x projects x workspaces resolution.

### Source labels

Map resolver sources to admin-friendly labels:

- `fixed_role`: fixed role label;
- `system_reviewer_assignment`: reviewer access label;
- `photographer_workspace_assignment`: photographer assignment label;
- `custom_role_assignment`: custom role name and scope label.

Keep source labels localized in UI where possible. The service can return stable source types plus enough names/ids; the component should map them through i18n.

## UI/i18n copy plan

Add messages under `members.effectiveAccess` in both `messages/en.json` and `messages/nl.json`.

Use existing `members.capabilities.*`, `members.capabilityGroups.*`, and `members.roles.*` keys for capability and role labels.

Recommended English keys:

- `action`: `Access`
- `loading`: `Loading access details...`
- `title`: `Effective access`
- `fixedRole`: `Fixed role`
- `sources`: `Sources`
- `capabilities`: `Effective capabilities`
- `customRoles`: `Custom roles`
- `reviewerAccess`: `Reviewer access`
- `photographerAssignments`: `Photographer workspaces`
- `sourceFixedRole`: `Fixed role`
- `sourceCustomRole`: `Custom role`
- `sourceReviewerTenant`: `Reviewer access for all projects`
- `sourceReviewerProject`: `Reviewer access for {project}`
- `sourcePhotographerWorkspace`: `Photographer for {workspace}`
- `scopeTenant`: `Organization`
- `scopeProject`: `Project: {project}`
- `scopeWorkspace`: `Workspace: {project} / {workspace}`
- `ignoredTitle`: `Ignored at this scope`
- `ignoredCapabilities`: `{role} includes capabilities that do not apply here: {capabilities}`
- `noCustomRoles`: `No custom role assignments.`
- `noReviewerAccess`: `No reviewer access assignments.`
- `noPhotographerAssignments`: `No photographer workspaces.`
- `noExtraSources`: `No additional access sources.`
- `broadOwnerAdmin`: `Owner/admin role grants broad organization and operational access.`
- `tenantWideReviewerSummary`: `Tenant-wide reviewer access applies across projects where review or correction is available.`
- `zipExportExcluded`: not needed in UI because ZIP export is excluded.
- `errors.forbidden`: `Only owners and admins can inspect effective access.`
- `errors.notFound`: `Member not found.`
- `errors.fallback`: `Unable to load effective access.`

Recommended Dutch keys:

- `action`: `Toegang`
- `loading`: `Toegangsdetails laden...`
- `title`: `Effectieve toegang`
- `fixedRole`: `Vaste rol`
- `sources`: `Bronnen`
- `capabilities`: `Effectieve mogelijkheden`
- `customRoles`: `Aangepaste rollen`
- `reviewerAccess`: `Reviewertoegang`
- `photographerAssignments`: `Fotograaf-workspaces`
- `sourceFixedRole`: `Vaste rol`
- `sourceCustomRole`: `Aangepaste rol`
- `sourceReviewerTenant`: `Reviewertoegang voor alle projecten`
- `sourceReviewerProject`: `Reviewertoegang voor {project}`
- `sourcePhotographerWorkspace`: `Fotograaf voor {workspace}`
- `scopeTenant`: `Organisatie`
- `scopeProject`: `Project: {project}`
- `scopeWorkspace`: `Workspace: {project} / {workspace}`
- `ignoredTitle`: `Genegeerd binnen deze scope`
- `ignoredCapabilities`: `{role} bevat mogelijkheden die hier niet gelden: {capabilities}`
- `noCustomRoles`: `Geen aangepaste roltoewijzingen.`
- `noReviewerAccess`: `Geen reviewertoegang toegewezen.`
- `noPhotographerAssignments`: `Geen fotograaf-workspaces.`
- `noExtraSources`: `Geen aanvullende toegangsbronnen.`
- `broadOwnerAdmin`: `Owner/admin-rol geeft brede organisatie- en operationele toegang.`
- `tenantWideReviewerSummary`: `Tenantbrede reviewertoegang geldt voor projecten waar review of correctie beschikbaar is.`
- `errors.forbidden`: `Alleen owners en admins kunnen effectieve toegang bekijken.`
- `errors.notFound`: `Lid niet gevonden.`
- `errors.fallback`: `Effectieve toegang kan niet worden geladen.`

Copy cleanup:

- Update `members.roleReference.subtitle` to make clear it describes fixed-role baseline capabilities, not complete effective access.
- Update `members.customRoleAssignments.note` only if still present in the live message structure and stale after operational migration.

No hardcoded user-facing strings should be added.

## SQL cleanup decision

No SQL migration is planned for Feature 096.

Reasons:

- Feature 095 already added operational SQL/RLS wrappers.
- Current SQL helper names are RLS-stable and used by policies.
- Renaming SQL wrappers would create high churn without changing product behavior.
- ZIP export deprecation should not trigger SQL work.

Allowed SQL work:

- none by default.

If implementation discovers a real SQL/RLS blocker, stop and update the RPI plan before adding a migration. A tiny comment-only SQL migration is not worth the churn for Feature 096.

## Test plan

Create primary test file:

```text
tests/feature-096-permission-cleanup-and-effective-access-ui.test.ts
```

Use existing fixture patterns from Feature 093, 094, 095, and member management tests.

### Stale operational call-site cleanup tests

Assets GET:

- custom-role workspace operational user can read assets where old `resolveWorkspacePermissions` would have denied;
- project custom-role operational user can read assets for a matching project workspace;
- project workflow-only custom-role user cannot read assets;
- no effective workspace operational capability returns `workspace_read_forbidden`;
- wrong workspace remains `workspace_not_found`.

Matching progress:

- custom-role workspace operational user can read matching progress;
- project custom-role operational user can read matching progress in matching project;
- project workflow-only custom-role user cannot read matching progress;
- no effective workspace operational capability returns `workspace_read_forbidden`.

Workflow fallback:

- finalization handler uses `workflow.finalize_project`;
- correction-start handler uses `workflow.start_project_correction`;
- tests fail if old `assertCanReviewProjectAction` fallback is called.

ZIP export:

- if `src/lib/project-export/response.ts` is touched, add a regression proving project/workspace custom-role review access does not grant ZIP export.
- keep Feature 043 export tests green.

### Helper wrapper/compatibility tests

- `requireWorkspaceOperationalReadAccessForRequest` maps effective denial to `workspace_read_forbidden`.
- Compatibility wrappers in `project-workspace-request.ts` preserve existing route-facing forbidden codes.
- `resolveWorkspacePermissions` remains available for legacy ZIP export/tests but is not used by assets GET or matching progress.

### Effective access data service tests

- owner/admin can load a selected member's effective access summary;
- delegated organization-user actor is rejected with `tenant_member_management_forbidden`;
- non-member target is rejected as `member_not_found`;
- summary includes fixed role;
- summary includes tenant/project/workspace custom-role assignments with effective and ignored capability keys;
- summary includes reviewer tenant-wide and project assignments;
- summary includes photographer workspace assignments;
- summary includes effective capabilities with source labels;
- summary summarizes owner/admin and tenant-wide reviewer broad access without enumerating every project/workspace;
- cross-tenant project/workspace/assignment data is not leaked.

### Members UI tests

- owner/admin Members table renders an `Access` action;
- clicking/opening a member access detail renders fixed role, custom roles, reviewer access, photographer assignment, effective capability groups, and ignored capability warnings;
- empty source states render compactly;
- delegated Members panel does not render the access action;
- delegated directory data still omits `customRoleAssignments`, `reviewerAccess`, role editor data, assignment target data, and effective access data;
- UI strings use i18n keys.

### Boundary guardrail tests

Add focused regressions or reuse existing files when cheaper:

- public token signing/revocation routes remain token-scoped;
- release snapshot and Media Library authorization remain separate;
- project/workspace review custom roles do not grant Media Library;
- role definition/assignment/reviewer access administration remains owner/admin-only;
- state-machine checks still reject otherwise-capable users when workflow/correction state disallows an action.

### Suggested regression commands

Implementation should run:

```powershell
npm test -- tests/feature-096-permission-cleanup-and-effective-access-ui.test.ts
npm test -- tests/feature-095-operational-permission-resolver-enforcement.test.ts tests/feature-094-effective-scoped-permission-resolver-foundation.test.ts tests/feature-093-scoped-custom-role-assignment-foundation.test.ts tests/feature-091-owner-admin-role-administration-consolidation.test.ts tests/feature-043-simple-project-export-zip.test.ts
npm run lint
```

If the test runner does not support file arguments, run the closest supported command and document the limitation.

## Documentation plan

Update `docs/rpi/SUMMARY.md`:

- add Features 092 through 096 to the permission migration summary;
- describe the final effective permission model;
- note permanent special boundaries:
  - fixed owner/admin bootstrap and role administration;
  - reviewer access;
  - photographer workspace assignment;
  - public token flows;
  - release snapshot and Media Library authorization;
  - state-machine checks;
- document stale helper cleanup/deprecation direction;
- document ZIP export as a restrictive legacy path planned for removal and intentionally excluded from effective permission polish.

Update `ARCHITECTURE.md` if implementation adds the effective access service:

- add a short permission architecture note;
- state future operational checks should use effective capabilities or surface-specific wrappers, not `resolveWorkspacePermissions` booleans;
- state role administration and public/release boundaries remain separate.

Do not rewrite old RPI docs. This plan and later implementation notes are the current Feature 096 history.

## Security considerations

- Derive tenant from authenticated session/active tenant utilities; never accept `tenant_id` from clients.
- Keep all effective access summary routes server-side and owner/admin-only.
- Do not expose service role clients or service-role-only metadata to client code.
- Tenant-filter every query.
- Target-filter effective access summary reads by selected `targetUserId`.
- Do not serialize effective access data to delegated users.
- Do not route role administration through operational effective capabilities.
- Do not collapse public token authorization into member effective access.
- Do not collapse release/Media Library authorization into project/workspace operational access.
- Preserve existing route-facing error codes for stale operational cleanup to avoid new information leaks.
- Keep ZIP export restrictive and do not broaden custom-role access.
- Keep workflow/correction state checks separate from capability checks.

## Edge cases

- Session expiry: route returns unauthenticated and does not compute summaries.
- Actor loses owner/admin between page load and access summary request: route returns `tenant_member_management_forbidden`.
- Target member removed between page load and request: route returns `member_not_found`.
- Target custom role assignment revoked between page load and request: summary reflects current state.
- Role archived after assignment: current assignment should still be visible where existing assignment summaries support it, but archived roles should not be treated as effective custom-role sources by the resolver.
- Project/workspace deleted after assignment: FK cascade should remove rows; if labels are unexpectedly missing, UI should show an unknown target fallback.
- User has many assignments: service resolves candidate scopes only and should cap or summarize if needed rather than enumerating the tenant.
- Owner/admin selected as target: summarize broad fixed-role access without enumerating all projects/workspaces.
- Tenant-wide reviewer selected as target: summarize broad reviewer access without enumerating all projects/workspaces.
- Multiple sources grant one capability: UI should show multiple source labels without duplicate capability rows where practical.
- Ignored custom-role capabilities should not hide another source that grants the same capability.
- Partial failure in route-loaded UI: show compact error state; no mutation occurs.
- ZIP export remains old behavior even if effective access UI shows review access from project/workspace custom roles.

## Implementation phases

### Phase 1 - Stale operational call-site cleanup

- Add effective workspace operational read helper.
- Update assets GET to use it.
- Update matching progress to use it.
- Remove finalization/correction-start old review fallback dependencies.
- Preserve ZIP export behavior and add a deprecation TODO only if touching the file.

Validation:

- stale call-site tests pass;
- Feature 095 operational tests still pass;
- Feature 043 export tests still pass.

### Phase 2 - Effective access summary service

- Add `member-effective-access-service.ts`.
- Add target member validation and owner/admin guard.
- Load custom-role assignments, reviewer summary, photographer assignments, candidate scopes, resolver results, ignored capabilities, and warnings.
- Add `GET /api/members/[userId]/effective-access`.

Validation:

- service tests cover owner/admin allowed, delegated denied, target not found, source summaries, ignored capabilities, and no cross-tenant leakage.

### Phase 3 - Members UI effective access detail

- Add row action and one-at-a-time expanded detail in `MemberManagementPanel`.
- Fetch summaries on demand.
- Render source summaries, capability groups, ignored warnings, and compact empty states.
- Add English and Dutch i18n keys.
- Do not change delegated UI except tests that prove omission.

Validation:

- component tests cover display and delegated omission;
- UI remains restrained and table-based.

### Phase 4 - Tests

- Create `tests/feature-096-permission-cleanup-and-effective-access-ui.test.ts`.
- Add focused updates to existing tests only where required by dependency shape changes.
- Keep older historical helper tests intact unless directly touched.

Validation:

- primary Feature 096 tests pass;
- related Feature 043/091/093/094/095 tests pass.

### Phase 5 - Documentation updates

- Update `docs/rpi/SUMMARY.md`.
- Update `ARCHITECTURE.md` if implementation adds the new effective access service note.
- Add concise comments in touched legacy wrapper/ZIP paths.

Validation:

- docs describe final effective model and permanent boundaries.

### Phase 6 - Final regression pass

- Run targeted tests and lint.
- Run broader `npm test` if practical.
- Confirm no code path accepts client-provided tenant id.
- Confirm no effective access data appears in delegated props or UI.

## Finish-line definition

Feature 096 is complete when:

- assets GET no longer depends on old broad fixed-role booleans as source of truth;
- matching progress no longer depends on old broad fixed-role booleans as source of truth;
- assets GET and matching progress no longer conflict with effective operational workspace access;
- project-level finalization/correction-start handlers no longer carry old review fallback dependencies;
- ZIP export remains restrictive, does not grant project/workspace custom-role export access, and is documented as planned for removal;
- remaining old helpers are documented compatibility wrappers or permanent boundaries;
- owner/admin users can inspect why a member currently has access;
- delegated users cannot inspect or receive effective access admin data;
- public-token, release/Media Library, role-administration, reviewer-access, photographer-assignment, and state-machine boundaries remain intact;
- tests cover stale call-site cleanup, effective access data/UI, delegated omission, and boundary guardrails;
- `SUMMARY.md` summarizes the finished permission model.

## Scope boundaries

Do implement in the implementation phase:

- effective workspace operational read helper;
- assets GET/matching progress cleanup;
- workflow fallback dependency cleanup;
- ZIP export preservation comment if touched;
- owner/admin-only effective access summary service/route;
- Members row action/expansion;
- i18n keys;
- focused tests;
- docs updates.

Do not implement:

- capability key additions/renames;
- scope matrix changes;
- SQL helper renames;
- broad SQL cleanup;
- ZIP export redesign;
- ZIP export access expansion;
- ZIP export effective access explanation;
- delegated role administration;
- reviewer/photographer replacement;
- public token changes;
- release snapshot authorization changes;
- broad IAM dashboard.

## Concise implementation prompt

Implement Feature 096 from this plan. Clean up the remaining stale operational call sites by adding an effective workspace operational read helper and using it for assets GET and matching progress, preserving `workspace_read_forbidden` and excluding project-level workflow-only visibility. Remove the old `assertCanReviewProjectAction` fallback dependencies from project finalization and correction-start handlers so they require `assertEffectiveProjectCapability` with `workflow.finalize_project` and `workflow.start_project_correction`. Preserve ZIP export's current restrictive `canReviewProjects` behavior because ZIP export is planned for removal; do not broaden it to project/workspace custom-role users, and add only a concise deprecation TODO if touching that file.

Add an owner/admin-only `getMemberEffectiveAccessSummary` service and `GET /api/members/[userId]/effective-access` route. The service must derive tenant server-side, require fixed owner/admin, validate the target member, reuse `resolveEffectiveCapabilities`, existing custom-role assignment summaries, reviewer access summaries, and a tenant-filtered photographer workspace query, and compute only candidate scopes for one member on demand. Add a restrained Members page row action/expansion that fetches and renders fixed role, custom roles, reviewer access, photographer assignments, effective capability groups, sources, ignored capabilities, and warnings. Do not expose this data to delegated users and do not include ZIP export.

Add `tests/feature-096-permission-cleanup-and-effective-access-ui.test.ts` covering stale route cleanup, wrapper compatibility, effective access service, Members UI display, delegated omission, public token/release/Media Library/role-admin boundaries, state-machine separation, and ZIP export restrictive preservation if touched. Update English and Dutch i18n keys, update `docs/rpi/SUMMARY.md`, and add a short `ARCHITECTURE.md` permission note if the effective access service is introduced. Do not add migrations or redesign the permission system.
