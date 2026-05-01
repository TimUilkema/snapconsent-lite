# Feature 082 Plan: Reviewer Access Assignments and Enforcement

## 1. Scope and contract

Feature 082 changes reviewer access from fixed-role automatic tenant-wide access to explicit assignment-based access. It uses the Feature 081 `role_assignments` foundation and enforces assignments consistently in TypeScript helpers, route handlers, SQL helpers, RLS-backed reads/writes, UI, and tests.

This plan locks the following contract:

- Use `role_assignments`; do not create `project_reviewer_assignments`.
- Tenant-wide reviewer access is an active tenant-scope assignment of the system `reviewer` role.
- Project-scoped reviewer access is an active project-scope assignment of the system `reviewer` role.
- Workspace-scope reviewer assignments are not used by Feature 082.
- Fixed `memberships.role = reviewer` means reviewer eligibility, not automatic project access.
- Owner/admin access remains fixed-role and tenant-wide.
- Photographer access remains fixed-role plus assigned workspace.
- SQL/RLS and TypeScript helpers must agree.
- Media Library access is owner/admin or tenant-wide reviewer assignment only.

Out of scope:

- custom role editor;
- custom role creation/editing;
- invite-to-custom-role;
- full generic effective-capability engine;
- member-level allow/deny overrides;
- workspace-specific reviewer enforcement;
- photographer access redesign;
- capture, consent, matching, or release snapshot semantics changes;
- project-scoped Media Library filtering.

## 2. Inputs and ground truth

The required files were reloaded in order before this plan:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `UNCODEXIFY.md`
5. `docs/rpi/README.md`
6. `docs/rpi/SUMMARY.md`
7. `docs/rpi/081-custom-role-definitions-and-scoped-role-assignment-foundation/research.md`
8. `docs/rpi/081-custom-role-definitions-and-scoped-role-assignment-foundation/plan.md`
9. `docs/rpi/082-project-scoped-reviewer-assignments-and-enforcement/research.md`

Targeted live verification checked the current schema, helper signatures, member API conventions, project page seams, workspace request helpers, workflow route handlers, Media Library authorization, messages, and absence of existing reviewer-access API routes.

Current live code and schema are authoritative. The only notable drift to account for is that Feature 081 is now present but explicitly non-enforcing; Feature 082 must narrow that guarantee rather than preserve it globally.

## 3. Verified current boundary

Current reviewer behavior:

- `memberships.role = reviewer` makes reviewers tenant-wide in app helpers and SQL helpers.
- `/projects` treats every non-photographer, including reviewer, as all-projects visible.
- `resolveAccessibleProjectWorkspaces(...)` returns all workspaces for reviewers.
- `assertCanReviewProjectAction(...)` and `assertCanReviewWorkspaceAction(...)` are role-only for reviewers.
- Review, correction, finalization, consent upgrade, and correction media intake routes mostly centralize through `project-workspace-request.ts` and workflow route handlers.
- Media Library TypeScript authorization checks fixed reviewer role capability.
- SQL helpers allow fixed reviewers in project/workspace/review and Media Library helpers.

Current owner/admin behavior:

- fixed roles keep full tenant-wide access;
- member, template, project creation, workspace management, capture, review, workflow, correction, and Media Library permissions remain fixed-role based;
- Feature 082 must preserve this.

Current photographer behavior:

- project visibility comes from assigned `project_workspaces.photographer_user_id`;
- workspace access and capture are assigned-workspace scoped;
- review remains denied;
- Feature 082 must preserve this.

Current Feature 081 foundation:

- `role_definitions`, `capabilities`, `role_definition_capabilities`, and `role_assignments` exist;
- system roles and capabilities are seeded;
- active assignment uniqueness, revocation fields, tenant/project/workspace FKs, and membership cascade exist;
- reads are exposed through RLS; authenticated writes are not;
- helper code labels assignment resolution non-enforcing.

Feature 082 changes:

- reviewer project/workspace visibility;
- reviewer review/correction/finalization authority;
- reviewer Media Library authority;
- member role-change cleanup for reviewer assignments;
- tests that expect fixed reviewer tenant-wide access.

Feature 082 preserves:

- owner/admin fixed-role access;
- photographer assigned-workspace capture;
- capture route semantics;
- consent/matching/release semantics;
- member/template/project/workspace management boundaries.

## 4. Recommendation

Implement Feature 082 as an explicit reviewer access layer over Feature 081 role assignments:

- Add a domain-specific reviewer access service in `src/lib/tenant/reviewer-access-service.ts`.
- Add SQL helper functions that test active system reviewer assignments.
- Update existing SQL access/review/Media Library helpers to call those new helper functions.
- Update app-layer permissions so review access is project-aware.
- Add owner/admin-only route handlers for grant/revoke/list.
- Add minimal Members page and project detail UI.
- Update tests so reviewers create explicit tenant-wide or project-scoped assignments.

Do not build a generic effective-capability engine. The role definition capabilities remain durable metadata; Feature 082 interprets only system reviewer assignments at tenant and project scope for live access.

## 5. Chosen access model

Post-feature behavior:

- Owner/admin: all tenant projects, all workspaces, and all current owner/admin actions.
- Photographer: unchanged assigned-workspace project visibility and capture behavior.
- Reviewer with active tenant-scope system reviewer assignment: all tenant projects and all workspaces for review, correction, finalization, and tenant-wide Media Library access.
- Reviewer with active project-scope system reviewer assignments: assigned projects and all workspaces in those projects for review, correction, and finalization.
- Reviewer with no active reviewer assignment: no project visibility and no review access.
- Reviewer with both tenant-wide and project grants: all projects; project grants remain stored and become effective again if tenant-wide access is revoked.

Project-scoped reviewer access does not grant:

- normal capture/upload;
- normal participant invite/capture routes;
- member management;
- profile management beyond current project review surfaces;
- template management;
- project creation;
- workspace staffing/management;
- tenant-wide Media Library access.

Fixed `memberships.role = reviewer` after Feature 082:

- means eligible for reviewer access;
- grants no project access by itself;
- must be paired with active tenant/project reviewer assignments;
- is required by SQL and TypeScript effective checks as a safety backstop.

Owner/admin do not need reviewer assignments. Photographers should not be assigned reviewer grants in Feature 082.

Role changes away from `reviewer` should revoke active system reviewer assignments for clarity. Effective checks must also ignore active assignment rows unless the member still has fixed role `reviewer`.

## 6. Exact assignment write model

Add `src/lib/tenant/reviewer-access-service.ts`.

Recommended exported functions:

- `listReviewerAccessSummary(input)`
- `listProjectReviewerAssignments(input)`
- `grantTenantWideReviewerAccess(input)`
- `revokeTenantWideReviewerAccess(input)`
- `grantProjectReviewerAccess(input)`
- `revokeProjectReviewerAccess(input)`
- `revokeActiveReviewerAssignmentsForMember(input)`
- `resolveEffectiveReviewerAccessForTenant(input)`
- `resolveEffectiveReviewerAccessForProject(input)`

Core service rules:

- Validate actor with `resolveTenantPermissions(...).canManageMembers` for assignment writes and manager summaries.
- Never accept trusted `tenant_id` from the client; routes derive tenant through `requireAuthenticatedTenantContext()`.
- Use the system `reviewer` role definition where `role_definitions.is_system = true` and `system_role_key = 'reviewer'`.
- Target must be a current member of the active tenant.
- Target fixed role must be `reviewer`.
- Owner/admin targets are rejected as unnecessary.
- Photographer targets are rejected.
- Project grants validate project belongs to the active tenant before writing.
- Tenant-wide grants write `scope_type = 'tenant'`, no project/workspace.
- Project grants write `scope_type = 'project'`, `project_id`, no workspace.
- Duplicate active grant returns the existing grant and is not an error.
- Revoke sets `revoked_at` and `revoked_by`.
- Revoke is idempotent when the target and scope are valid but no active row exists.
- Re-add after revoke inserts a new row, preserving audit history.
- Writes should use a server-only admin Supabase client after actor validation because Feature 081 currently grants authenticated reads but not authenticated writes on `role_assignments`.

Suggested assignment record shape returned by the service:

```ts
type ReviewerAccessAssignment = {
  assignmentId: string;
  tenantId: string;
  userId: string;
  scopeType: "tenant" | "project";
  projectId: string | null;
  createdAt: string;
  createdBy: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
};
```

Suggested summary shape:

```ts
type ReviewerAccessSummary = {
  userId: string;
  email: string;
  role: "reviewer";
  tenantWideAccess: {
    active: boolean;
    assignmentId: string | null;
    grantedAt: string | null;
  };
  projectAssignments: Array<{
    assignmentId: string;
    projectId: string;
    projectName: string;
    grantedAt: string;
  }>;
};
```

The service may use existing Feature 081 read helpers for catalog lookup, but grant/revoke logic should live in the reviewer access service because it is product-specific.

## 7. Exact API plan

Use route conventions already present under `src/app/api/members/**` and `src/app/api/projects/**`: derive tenant/user server-side, parse JSON defensively, throw `HttpError`, and return `jsonError(error)`.

### Tenant-wide reviewer access

Add:

- `GET /api/members/reviewer-access`
- `POST /api/members/[userId]/reviewer-access/tenant-wide`
- `DELETE /api/members/[userId]/reviewer-access/tenant-wide`

`GET /api/members/reviewer-access`

- Auth: owner/admin only.
- Request body: none.
- Response `200`:

```json
{
  "reviewers": [
    {
      "userId": "uuid",
      "email": "reviewer@example.com",
      "role": "reviewer",
      "tenantWideAccess": {
        "active": true,
        "assignmentId": "uuid",
        "grantedAt": "iso"
      },
      "projectAssignments": []
    }
  ]
}
```

`POST /api/members/[userId]/reviewer-access/tenant-wide`

- Auth: owner/admin only.
- Request body: none.
- Response `201` when created:

```json
{
  "assignment": { "assignmentId": "uuid", "scopeType": "tenant", "projectId": null },
  "created": true
}
```

- Response `200` when already active:

```json
{
  "assignment": { "assignmentId": "uuid", "scopeType": "tenant", "projectId": null },
  "created": false
}
```

`DELETE /api/members/[userId]/reviewer-access/tenant-wide`

- Auth: owner/admin only.
- Request body: none.
- Response `200`:

```json
{ "ok": true, "revoked": true }
```

- If no active valid tenant-wide assignment exists, return `200` with `revoked: false`.

### Project-scoped reviewer access

Add:

- `GET /api/projects/[projectId]/reviewer-access`
- `POST /api/projects/[projectId]/reviewer-access`
- `DELETE /api/projects/[projectId]/reviewer-access/[userId]`

`GET /api/projects/[projectId]/reviewer-access`

- Auth: owner/admin only.
- Validates project is in active tenant.
- Response `200`:

```json
{
  "projectId": "uuid",
  "assignments": [
    {
      "assignmentId": "uuid",
      "userId": "uuid",
      "email": "reviewer@example.com",
      "grantedAt": "iso"
    }
  ],
  "eligibleReviewers": [
    {
      "userId": "uuid",
      "email": "reviewer@example.com",
      "hasProjectAccess": true,
      "hasTenantWideAccess": false
    }
  ]
}
```

`POST /api/projects/[projectId]/reviewer-access`

- Auth: owner/admin only.
- Request body:

```json
{ "userId": "uuid" }
```

- Response `201` when created; `200` when already active:

```json
{
  "assignment": { "assignmentId": "uuid", "scopeType": "project", "projectId": "uuid" },
  "created": true
}
```

`DELETE /api/projects/[projectId]/reviewer-access/[userId]`

- Auth: owner/admin only.
- Request body: none.
- Response `200`:

```json
{ "ok": true, "revoked": true }
```

- If no active valid project assignment exists, return `200` with `revoked: false`.

### Error and status rules

- `401 unauthenticated`: no session.
- `403 tenant_member_management_forbidden`: actor is not owner/admin.
- `404 project_not_found`: project is not in active tenant or should not be exposed.
- `404 member_not_found`: target member is not in active tenant.
- `404 reviewer_assignment_not_found`: only for non-idempotent lookup endpoints; deletes should usually no-op after validating target/scope.
- `400 invalid_body`: malformed JSON or missing `userId`.
- `409 reviewer_access_target_not_reviewer`: target role is not `reviewer`.
- `409 reviewer_access_assignment_conflict`: only if a uniqueness race cannot be resolved by re-reading existing active assignment.

## 8. Exact SQL/RLS helper plan

Add one migration, for example:

`supabase/migrations/<timestamp>_082_reviewer_access_assignment_enforcement.sql`

New helper functions:

- `app.current_user_has_tenant_wide_reviewer_access(p_tenant_id uuid)`
- `app.current_user_has_project_reviewer_access(p_tenant_id uuid, p_project_id uuid)`
- optional `app.current_user_has_workspace_reviewer_access(p_tenant_id uuid, p_project_id uuid, p_workspace_id uuid)`

Required helper conditions:

- `auth.uid()` is not null;
- current membership role in `p_tenant_id` is `reviewer`;
- `role_assignments.user_id = auth.uid()`;
- `role_assignments.tenant_id = p_tenant_id`;
- `role_assignments.revoked_at is null`;
- `role_definitions.is_system = true`;
- `role_definitions.system_role_key = 'reviewer'`;
- tenant-wide helper requires `scope_type = 'tenant'`;
- project helper returns true for tenant-wide assignment or project-scope assignment with matching `project_id`;
- workspace helper validates the workspace belongs to tenant/project, then delegates to project helper.

Update existing helpers:

- `app.current_user_can_access_project(p_tenant_id, p_project_id)`
- `app.current_user_can_access_project_workspace(p_tenant_id, p_project_id, p_workspace_id)`
- `app.current_user_can_review_project(p_tenant_id, p_project_id)`
- `app.current_user_can_review_project_workspace(p_tenant_id, p_project_id, p_workspace_id)`
- `app.current_user_can_access_media_library(p_tenant_id)`
- `app.current_user_can_manage_media_library(p_tenant_id)`

Expected updated behavior:

- Project access: owner/admin fixed-role OR assigned photographer workspace in project OR effective reviewer project access.
- Workspace access: owner/admin fixed-role OR assigned photographer workspace OR effective reviewer project access.
- Project review: owner/admin fixed-role OR effective reviewer project access.
- Workspace review: owner/admin fixed-role OR effective reviewer project access.
- Media Library access/manage: owner/admin fixed-role OR tenant-wide reviewer assignment.

Do not change:

- `app.current_user_can_capture_project`;
- `app.current_user_can_capture_project_workspace`;
- project creation helpers;
- member management helpers;
- template management helpers;
- workspace management helpers.

Also update public wrapper functions for Media Library if present:

- `public.current_user_can_access_media_library(uuid)`
- `public.current_user_can_manage_media_library(uuid)`

Grant execute on new helpers to `authenticated` if tests or app code call them directly. Keep security definer functions with explicit `search_path`.

## 9. Exact TypeScript helper plan

Update `src/lib/tenant/permissions.ts` and add reviewer assignment resolution in `src/lib/tenant/reviewer-access-service.ts`.

Preferred model:

- keep fixed role capability catalog as metadata;
- stop using fixed reviewer role alone as live review authorization;
- add explicit effective fields;
- preserve legacy `canReviewProjects` only as an effective-access boolean in the relevant context.

Recommended types:

```ts
type ReviewAccessSource = "owner_admin" | "tenant_assignment" | "project_assignment" | "none";

type TenantPermissions = {
  role: MembershipRole;
  canManageMembers: boolean;
  canManageTemplates: boolean;
  canCreateProjects: boolean;
  canCaptureProjects: boolean;
  canReviewProjects: boolean; // tenant-wide effective only
  isReviewerEligible: boolean;
  hasTenantWideReviewAccess: boolean;
};

type ProjectPermissions = TenantPermissions & {
  canCreateOneOffInvites: boolean;
  canCreateRecurringProjectConsentRequests: boolean;
  canUploadProjectAssets: boolean;
  canReviewSelectedProject: boolean;
  reviewAccessSource: ReviewAccessSource;
};
```

Function changes:

- `resolveTenantPermissions(...)` should set owner/admin fixed booleans as today; for reviewer it should set `isReviewerEligible: true`, `hasTenantWideReviewAccess` from active tenant assignment, and `canReviewProjects` equal to tenant-wide effective access.
- `deriveTenantPermissionsFromRole(...)` can remain a static helper only if tests and UI need role metadata, but live authorization should use `resolveTenantPermissions(...)`. If retained, document that it is role metadata and not effective access.
- `resolveProjectPermissions(...)` should become project-aware by taking `projectId`, or add `resolveProjectScopedPermissions(...)` and migrate callers. The project detail page and workflow route handlers need effective project access.
- `resolveAccessibleProjectWorkspaces(...)` should:
  - owner/admin: all workspaces;
  - photographer: assigned workspaces only;
  - reviewer with effective access to project: all project workspaces;
  - reviewer without effective access: throw 404 `project_not_found`.
- `resolveWorkspacePermissions(...)` should use effective project access for reviewers and keep photographer assigned-workspace checks.
- `assertCanReviewProjectAction(...)` should take `projectId` and check effective project review access.
- `assertCanReviewWorkspaceAction(...)` should use updated workspace permissions.
- Correction media helpers in `project-workspace-request.ts` should not check fixed `roleHasCapability(permissions.role, "correction.media_intake")` alone for reviewer. They should check effective review/correction media access for the selected project, while owner/admin remain allowed.
- `authorizeMediaLibraryAccess(...)` should allow owner/admin or `hasTenantWideReviewAccess`; fixed reviewer role alone should fail.

Implementation should update all callers rather than leave overloaded ambiguous helper calls.

## 10. Project list and project detail plan

### `/projects`

Update `src/app/(protected)/projects/page.tsx`:

- owner/admin: query all tenant projects;
- photographer: keep current assigned `project_workspaces` query and project id filtering;
- reviewer with tenant-wide assignment: query all tenant projects;
- reviewer with project assignments: query active project assignment ids, then load those projects;
- reviewer with no assignments: return empty list and existing empty state or a reviewer-specific empty message.

The project list should use server-derived active tenant and authenticated user. It should not accept tenant or assignment state from the client.

### `/projects/[projectId]`

Update `src/app/(protected)/projects/[projectId]/page.tsx`:

- use project-aware permissions for the loaded project;
- keep RLS-backed project load, but do not rely on it alone;
- `resolveProjectWorkspaceSelection(...)` should enforce updated accessible workspace logic;
- unassigned reviewers or reviewers assigned to other projects get `notFound()`;
- project-scoped reviewers see all workspaces in assigned projects;
- project-scoped reviewers see review/correction/finalization affordances based on workflow state;
- project-scoped reviewers do not see normal capture-only affordances;
- owner/admin and photographer rendering remains unchanged except for renamed/effective permission fields.

Add a project reviewer access section visible only to owner/admin. It should be near existing workspace/staffing controls, not a new broad access-management page.

## 11. Review, correction, and finalization route plan

Central helper changes should carry most route behavior. Avoid editing every route individually unless a route bypasses the shared helpers.

Update:

- `project-workspace-request.ts` review helpers;
- `project-workflow-route-handlers.ts`;
- `project-consent-upgrade-route-handlers.ts` only if helper signatures require call-site changes;
- `project-participants-route-handlers.ts` only if helper signatures require call-site changes.

Required route behavior:

- tenant-wide reviewer can perform old reviewer actions on all projects;
- project-scoped reviewer can perform old reviewer actions only on assigned projects;
- unassigned reviewer cannot perform old reviewer actions;
- reviewer assignment does not grant normal capture/upload;
- owner/admin remain unchanged;
- photographer remains unchanged.

Specific handlers:

- Workspace validation/reopen/needs-changes routes should continue to call `requireWorkspaceReviewAccessForRequest`.
- Project finalization should call project-aware `assertCanReviewProjectAction(..., projectId)`.
- Project correction start should call project-aware `assertCanReviewProjectAction(..., projectId)`.
- Workspace correction reopen should continue to call reviewer workspace access helper after it becomes assignment-aware.
- Correction review routes should continue through `requireWorkspaceCorrectionReviewMutationAccessForRow`.
- Correction consent intake routes should continue through `requireWorkspaceCorrectionConsentIntakeAccessForRequest/Row`.
- Correction media intake routes should use effective project reviewer access, not fixed reviewer capability alone.
- Consent upgrade request route should remain review-scoped through the existing request helpers.

Representative route tests are enough if they prove central helper behavior and one route per major class.

## 12. Media Library access plan

Lock this rule:

- owner/admin can access and manage Media Library as before;
- reviewer with active tenant-wide reviewer assignment can access and manage Media Library as current reviewer did;
- reviewer with only project-scoped assignments cannot access tenant-wide Media Library;
- project-scoped Media Library filtering is deferred.

Implementation changes:

- Update `authorizeMediaLibraryAccess(...)` in `project-release-service.ts` to use owner/admin fixed roles or tenant-wide reviewer assignment.
- `media-library-folder-service.ts` can keep using `authorizeMediaLibraryAccess(...)`.
- Update SQL helpers `app.current_user_can_access_media_library(...)` and `app.current_user_can_manage_media_library(...)` to use owner/admin fixed roles or tenant-wide reviewer assignment.
- Keep Media Library list/detail/download/folder routes structurally unchanged unless helper signatures change.

Tests must cover:

- unassigned reviewer denied;
- project-scoped reviewer denied;
- tenant-wide reviewer allowed for list/detail/download/folder management;
- owner/admin still allowed;
- photographer still denied.

## 13. UI/i18n plan

Include both minimal UI surfaces in Feature 082:

### Members page

Update `src/app/(protected)/members/page.tsx`, `getTenantMemberManagementData(...)`, and `MemberManagementPanel` data types so the panel receives reviewer access summaries.

Add to `src/components/members/member-management-panel.tsx`:

- reviewer access column or compact row detail for reviewer members;
- tenant-wide access toggle/button for reviewer members;
- summary text for project-specific assignment count;
- clear no-access state for reviewers without active assignments;
- no controls for owner rows;
- no reviewer assignment controls for admin/photographer rows.

Use the new member APIs for tenant-wide grant/revoke and `router.refresh()` after mutation.

### Project detail page

Add a small project reviewer access section for owner/admin on `src/app/(protected)/projects/[projectId]/page.tsx`.

Recommended component:

- `src/components/projects/project-reviewer-access-panel.tsx`

Panel behavior:

- list eligible reviewer members;
- list active project reviewer assignments;
- show tenant-wide reviewers as already having access but not as project assignment rows;
- allow grant/revoke project-specific access;
- call project reviewer access APIs;
- refresh after mutation.

UI constraints:

- use existing tables/forms/buttons layout;
- no custom role matrix;
- no dashboard/hero/access-console layout;
- no decorative panels;
- keep copy short;
- add English and Dutch translations in `messages/en.json` and `messages/nl.json`.

Suggested i18n groups:

- `members.reviewerAccess.*`
- `projects.detail.reviewerAccess.*`

Copy should explain:

- reviewer role is eligibility;
- tenant-wide review access applies to all current and future projects;
- project access applies to this project;
- removing tenant-wide access leaves project-specific grants intact.

## 14. Role-change behavior plan

Update `updateTenantMemberRole(...)` in `member-management-service.ts`.

Rules:

- reviewer -> photographer: update role and revoke active system reviewer assignments.
- reviewer -> admin: update role and revoke active system reviewer assignments; admin fixed role has full access.
- reviewer -> owner: owner promotion is currently unsupported through manageable roles, so no new behavior.
- photographer/admin -> reviewer: update role only; do not create reviewer assignments.
- removed membership: rely on existing `role_assignments` cascade from Feature 081.

Implementation detail:

- If changing away from reviewer, call `revokeActiveReviewerAssignmentsForMember(...)` after role update.
- Effective checks must require fixed role `reviewer`, so any temporary stale assignment rows do not grant access if cleanup fails.
- Use `revoked_by = actor user id`.
- Tests should assert assignments are revoked after role change and ineffective even if a row remains active in an artificial SQL fixture.

## 15. Fresh reset and seed/dev data plan

Development validation should start from:

```bash
supabase db reset
```

Local development expectations:

- do not preserve old local reviewer tenant-wide access;
- do not infer assignments for existing local reviewer rows;
- tests create explicit reviewer assignments;
- no local data backfill.

Seed/dev data:

- optional: add one tenant-wide reviewer and one project-scoped reviewer in seed data only if the repo already maintains representative dev users;
- otherwise keep seed minimal and rely on tests.

Production preservation:

- out of scope unless the rollout explicitly requires it;
- if needed, create a separate bounded operational backfill to insert tenant-scope system reviewer assignments for existing production reviewer memberships;
- do not mix production preservation with local reset behavior.

## 16. Security and tenant isolation plan

Mitigations:

- Cross-tenant assignment: validate target project/member in active tenant; existing FKs also protect writes.
- Non-member target: return 404; existing `(tenant_id, user_id)` FK also protects writes.
- Photographer target: reject with 409.
- Owner/admin target: reject with 409 or no-op; prefer 409 with clear code.
- Project outside active tenant: return 404.
- Stale revoked assignments: every SQL and TS effective query requires `revoked_at is null`.
- Role changed away from reviewer: revoke rows and require fixed role reviewer in effective checks.
- TypeScript/RLS mismatch: add parity tests for helper functions and route behavior.
- Project existence leaks: use 404 for cross-tenant or inaccessible project/member lookups.
- Media Library leakage: Media Library checks require owner/admin or tenant-wide reviewer assignment only.
- Active tenant switching: every route derives tenant through existing active tenant server utilities.
- Service role safety: service role client is only created server-side after actor validation and is never exposed to the browser.

## 17. Test plan

### Assignment write tests

Add tests for:

- owner/admin can grant tenant-wide reviewer access;
- owner/admin can revoke tenant-wide reviewer access;
- owner/admin can grant project reviewer access;
- owner/admin can revoke project reviewer access;
- non-manager cannot grant/revoke;
- target must be fixed role reviewer;
- duplicate tenant grant is idempotent;
- duplicate project grant is idempotent;
- revoke is idempotent for valid target/scope;
- re-add after revoke creates a new active row;
- cross-tenant project/member writes fail;
- role change away from reviewer revokes active assignments.

### TypeScript access tests

Add or update tests for:

- owner/admin still see all projects/workspaces;
- photographer remains assigned-workspace scoped;
- tenant-wide reviewer sees all projects/workspaces;
- project-scoped reviewer sees assigned projects only;
- unassigned reviewer sees no projects;
- project-scoped reviewer cannot access unassigned project detail/workspaces;
- project-scoped reviewer cannot perform normal capture/upload;
- project-scoped reviewer can perform review/correction/finalization on assigned project when workflow state permits.

### SQL/RLS tests

Exercise these helpers:

- `current_user_can_access_project`;
- `current_user_can_access_project_workspace`;
- `current_user_can_review_project`;
- `current_user_can_review_project_workspace`;
- `current_user_can_access_media_library`;
- `current_user_can_manage_media_library`.

Test each for:

- owner/admin;
- photographer;
- tenant-wide reviewer;
- project-scoped reviewer;
- unassigned reviewer.

Also test RLS-visible rows for projects/workspaces and representative review/media tables where existing tests already cover reviewer access.

### Route/API tests

Use representative routes:

- member reviewer-access API list/grant/revoke;
- project reviewer-access API list/grant/revoke;
- project list or service-level visibility;
- project detail/workspace selection;
- one review mutation route;
- one correction review or correction consent route;
- correction media intake preflight or prepare route;
- finalization route;
- one capture route proving reviewer assignment does not grant capture;
- Media Library list/detail/download;
- Media Library folder route.

### Regression tests

Update expectations in:

- Feature 070 role/RBAC tests;
- Feature 072 workspace tests;
- Feature 073 workflow tests;
- Feature 074 Media Library tests;
- Feature 075 correction tests;
- Feature 076 correction consent tests;
- Feature 078 Media Library folder tests;
- Feature 079 correction media tests;
- Feature 080 capability catalog tests;
- Feature 081 role assignment foundation tests.

Feature 081 non-enforcement tests should be narrowed: durable assignments generally remain non-enforcing except active system reviewer tenant/project assignments for fixed reviewer members.

## 18. Risks and edge cases

- Old tests expect fixed reviewer tenant-wide access; update fixtures to create explicit assignments.
- `canReviewProjects` is ambiguous; add clearer fields and define legacy boolean as effective access only.
- SQL and TypeScript drift could leak or block access; parity tests are mandatory.
- Tenant-wide and project-scoped grants can coexist; UI must show tenant-wide as effective all-project access while leaving project grants intact.
- Revoke/re-add must preserve audit history and not reactivate old rows.
- Role change away from reviewer must clean up grants, with fixed-role checks as safety.
- Media Library can leak tenant-wide assets if left tied to fixed reviewer role; update both TS and SQL helpers.
- Direct URL access by unassigned reviewers should produce not-found style behavior.
- Project deletion cascades project-scope assignment rows through existing FK.
- Membership deletion cascades assignment rows through existing FK.
- Active tenant switching must not reuse cached reviewer summaries across tenants.
- Production rollout may need a backfill decision for existing production reviewers; local development does not.

## 19. Implementation phases

### Phase 1: SQL helper migration and SQL tests

- Add reviewer assignment SQL helpers.
- Update project/workspace/review/Media Library helpers.
- Keep capture helpers unchanged.
- Add SQL/RLS tests for helper parity.
- Validate after `supabase db reset`.

### Phase 2: Reviewer access service and APIs

- Add `reviewer-access-service.ts`.
- Add tenant-wide member routes.
- Add project-scoped project routes.
- Add idempotent grant/revoke behavior.
- Add assignment write tests.

### Phase 3: TypeScript permission migration

- Add effective reviewer access resolver usage.
- Update tenant/project/workspace permission helpers.
- Make project review assertions project-aware.
- Update workflow route handler dependencies and tests.
- Update Media Library authorization.

### Phase 4: Project list/detail and UI

- Update `/projects` filtering.
- Update project detail project-aware permissions.
- Add Members page reviewer access summary/toggle.
- Add project reviewer access panel.
- Add EN/NL messages.

### Phase 5: Route regression updates

- Update central request helpers and representative route tests.
- Verify review, correction, finalization, capture denial, and Media Library behavior.

### Phase 6: Clean reset full validation

- Run `supabase db reset`.
- Run lint.
- Run full test suite.
- Fix only Feature 082-related regressions.

## 20. Clear scope boundaries

Do not implement:

- custom role editor;
- custom role assignment UI beyond reviewer tenant/project grants;
- invite-to-custom-role;
- workspace-specific reviewer assignment;
- generic capability engine;
- project-scoped Media Library filtering;
- photographer assignment redesign;
- owner/admin assignment enforcement;
- member allow/deny overrides;
- production backfill unless explicitly requested as rollout work.

Do implement:

- system reviewer tenant/project assignment enforcement;
- SQL/RLS parity;
- TypeScript helper parity;
- owner/admin APIs;
- minimal Members and project UI;
- role-change cleanup;
- tests proving scoped access and preserved owner/admin/photographer behavior.

## 21. Concise implementation prompt

Implement Feature 082 using the Feature 081 `role_assignments` table. Add a reviewer access service that grants/revokes active system `reviewer` role assignments at tenant or project scope, owner/admin-only, target fixed role reviewer only, idempotent create/revoke, and revocation by `revoked_at`/`revoked_by`. Add APIs for tenant-wide reviewer access under members and project reviewer access under projects.

Add SQL helpers for tenant-wide and project reviewer access, then update existing project/workspace/review and Media Library SQL helpers so owner/admin remain fixed-role tenant-wide, photographers remain assigned-workspace scoped, reviewers require active tenant/project assignments, and Media Library allows owner/admin or tenant-wide reviewer assignment only.

Update TypeScript permissions so fixed reviewer role is eligibility only. Project and workspace review checks must be project-aware. Update project list, project detail, review/correction/finalization helpers, and Media Library authorization to use effective reviewer access. Add minimal Members page and project detail UI with EN/NL messages. Update role changes away from reviewer to revoke active reviewer assignments. Validate from a clean `supabase db reset` with assignment, TypeScript, SQL/RLS, route, UI-adjacent, and regression tests.
