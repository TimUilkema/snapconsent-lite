# Feature 087 - Tenant-level admin permission consolidation research

## Title and scope

Feature 087 researches the next bounded tenant-scoped custom-role enforcement slice after Feature 086.

Candidate capabilities:

- Primary target: `projects.create`
- Primary target: `project_workspaces.manage`
- Research-gated optional target: `organization_users.manage`
- Research-gated optional target: `organization_users.invite`
- Research-gated optional target: `organization_users.change_roles`
- Research-gated optional target: `organization_users.remove`

This document is research only. It recommends implementation scope, helper boundaries, SQL/RLS parity, UI implications, non-expansion boundaries, and test themes. It does not include implementation steps or code changes.

## Inputs reviewed

Required project context:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `UNCODEXIFY.md`
- `docs/rpi/README.md`
- `docs/rpi/SUMMARY.md`

Prior RPI context:

- `docs/rpi/070-tenant-rbac-and-organization-user-management-foundation/research.md`
- `docs/rpi/070-tenant-rbac-and-organization-user-management-foundation/plan.md`
- `docs/rpi/080-advanced-organization-access-management-foundation/research.md`
- `docs/rpi/080-advanced-organization-access-management-foundation/plan.md`
- `docs/rpi/081-custom-role-definitions-and-scoped-role-assignment-foundation/research.md`
- `docs/rpi/081-custom-role-definitions-and-scoped-role-assignment-foundation/plan.md`
- `docs/rpi/082-project-scoped-reviewer-assignments-and-enforcement/research.md`
- `docs/rpi/082-project-scoped-reviewer-assignments-and-enforcement/plan.md`
- `docs/rpi/083-custom-role-editor-foundation/research.md`
- `docs/rpi/083-custom-role-editor-foundation/plan.md`
- `docs/rpi/084-custom-role-assignment-foundation/research.md`
- `docs/rpi/084-custom-role-assignment-foundation/plan.md`
- `docs/rpi/085-custom-role-media-library-enforcement/research.md`
- `docs/rpi/085-custom-role-media-library-enforcement/plan.md`
- `docs/rpi/086-custom-role-template-profile-enforcement/research.md`
- `docs/rpi/086-custom-role-template-profile-enforcement/plan.md`

Live TypeScript, UI, SQL, and test files reviewed:

- `src/lib/tenant/role-capabilities.ts`
- `src/lib/tenant/tenant-custom-role-capabilities.ts`
- `src/lib/tenant/permissions.ts`
- `src/lib/tenant/member-management-service.ts`
- `src/lib/tenant/member-management-route-utils.ts`
- `src/lib/tenant/custom-role-service.ts`
- `src/lib/tenant/custom-role-assignment-service.ts`
- `src/lib/tenant/reviewer-access-service.ts`
- `src/lib/tenant/media-library-custom-role-access.ts`
- `src/lib/templates/template-service.ts`
- `src/lib/profiles/profile-access.ts`
- `src/lib/projects/project-workspaces-service.ts`
- `src/lib/projects/project-workspace-request.ts`
- `src/lib/projects/project-workflow-route-handlers.ts`
- `src/app/api/projects/route.ts`
- `src/app/api/projects/[projectId]/workspaces/route.ts`
- `src/app/api/projects/[projectId]/default-template/route.ts`
- `src/app/(protected)/layout.tsx`
- `src/app/(protected)/projects/page.tsx`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/components/navigation/protected-nav.tsx`
- `src/components/projects/project-workspace-staffing-form.tsx`
- `src/components/projects/project-reviewer-access-panel.tsx`
- `supabase/migrations/20260423090000_070_tenant_rbac_membership_invites_foundation.sql`
- `supabase/migrations/20260423121000_072_project_workspace_access.sql`
- `supabase/migrations/20260430130000_082_reviewer_access_assignment_enforcement.sql`
- `supabase/migrations/20260430150000_085_media_library_custom_role_enforcement.sql`
- `supabase/migrations/20260430160000_086_template_profile_custom_role_enforcement.sql`
- `tests/feature-070-tenant-rbac-foundation.test.ts`
- `tests/feature-084-custom-role-assignment-foundation.test.ts`
- `tests/feature-085-custom-role-media-library-enforcement.test.ts`
- `tests/feature-086-custom-role-template-profile-enforcement.test.ts`

`docs/rpi/SUMMARY.md` was used only as orientation. The findings below are based on live files.

## Verified current behavior

The live code matches the expected post-Feature-086 enforcement boundary:

- Media Library custom-role enforcement is live for `media_library.access` and `media_library.manage_folders`.
- Template/Profile custom-role enforcement is live for `templates.manage`, `profiles.view`, and `profiles.manage`.
- `projects.create` remains fixed-role-only.
- `project_workspaces.manage` remains fixed-role-only.
- `organization_users.*` remains fixed-role-only.
- Capture, review, workflow, and correction capabilities remain fixed-role or Feature-082 reviewer-assignment based. They are not custom-role enforced.
- Tenant-scoped custom roles are additive only. No deny or override semantics exist.
- Active tenant-scoped custom-role assignments are the only custom assignments considered by the shared tenant helper. Revoked assignments, archived role definitions, cross-tenant roles, project-scoped assignments, and workspace-scoped assignments do not grant enforced tenant-level capabilities.

Important current drift from capability names:

- The project detail page currently gates project workspace staffing controls with `projectPermissions.canManageMembers`, not with an effective `project_workspaces.manage` check.
- `POST /api/projects/[projectId]/workspaces` calls `assertCanManageProjectWorkspacesAction(...)`, but then performs a second explicit `role !== "owner" && role !== "admin"` denial. Feature 087 must remove or replace that second fixed-role check if `project_workspaces.manage` is enforced for custom roles.
- SQL Media Library custom-role access is now routed through a wrapper around `app.current_user_has_tenant_custom_role_capability(...)`, but TypeScript Media Library access still uses a surface-specific helper in `src/lib/tenant/media-library-custom-role-access.ts`. The behavior is aligned, but the predicate is duplicated.

## Verified current enforced custom-role capability map

### TypeScript allowlist

`src/lib/tenant/tenant-custom-role-capabilities.ts` defines:

- `media_library.access`
- `media_library.manage_folders`
- `templates.manage`
- `profiles.view`
- `profiles.manage`

`assertEnforcedTenantCustomRoleCapability(...)` rejects all other capability keys with `tenant_custom_role_capability_not_enforced`.

The helper verifies:

- the actor has a current tenant membership,
- the assignment is tenant-scoped,
- `project_id` is null,
- `workspace_id` is null,
- `revoked_at` is null,
- the role belongs to the same tenant,
- the role is not a system role,
- the role is not archived,
- the role definition contains one of the requested allowlisted capability keys.

### SQL allowlist

`supabase/migrations/20260430160000_086_template_profile_custom_role_enforcement.sql` defines `app.current_user_has_tenant_custom_role_capability(p_tenant_id, p_capability_key)` with the same allowlist:

- `media_library.access`
- `media_library.manage_folders`
- `templates.manage`
- `profiles.view`
- `profiles.manage`

The SQL helper has the same tenant-scope, active-assignment, non-system, non-archived role constraints.

### SQL helpers using the shared custom-role helper

Live SQL helper callers include:

- `app.current_user_has_media_library_custom_role_capability(...)`, a Media Library-specific wrapper.
- `app.current_user_can_manage_templates(...)`.
- `app.current_user_can_view_recurring_profiles(...)`.
- `app.current_user_can_manage_recurring_profiles(...)`.

Media Library access/manage helpers call the Media Library wrapper after Feature 085/086. Template and profile helpers call the shared helper directly.

### TypeScript authorizers using custom-role enforcement

Live TypeScript custom-role authorizers include:

- `resolveTemplateManagementAccess(...)` in `src/lib/templates/template-service.ts`.
- `resolveProfilesAccess(...)` in `src/lib/profiles/profile-access.ts`.
- Media Library authorizers in `src/lib/tenant/media-library-custom-role-access.ts`.

Templates and profiles use the shared tenant custom-role helper. Media Library still uses a Media Library-specific TypeScript predicate rather than the shared helper, while SQL uses the shared helper through a wrapper. This is a drift risk, not a current behavior mismatch.

### Surface-specific authorizers

Media Library, templates, and profiles remain surface-specific. There is no generic app-wide effective capability resolver in live code.

## Verified remaining fixed-role-only capability map

| Capability | Current behavior | SQL/RLS helper | TypeScript helper | Routes/services/UI | Tests | Custom-role status |
| --- | --- | --- | --- | --- | --- | --- |
| `organization_users.manage` | Owner/admin fixed roles only through member-management umbrella. | `app.current_user_can_manage_members(p_tenant_id)` | `resolveTenantPermissions(...).canManageMembers`, `assertTenantMemberManager(...)` | `/members`, member invite/create/resend/revoke, role change, removal, role editor data, custom role assignment data. | Feature 070 and 084 cover manager/non-manager behavior. | Not live. |
| `organization_users.invite` | Not separately enforced. Included in owner/admin fixed role capabilities, but routes use `canManageMembers`. | `app.current_user_can_manage_members(...)` for invite RLS. | `assertTenantMemberManager(...)` | `createTenantMemberInvite(...)`, invite routes. | Feature 070 member invite coverage. | Not live. |
| `organization_users.change_roles` | Not separately enforced. Role changes use member-management umbrella. | Membership update policies through `app.current_user_can_manage_members(...)`; owner rows protected. | `updateTenantMemberRole(...)` after `assertTenantMemberManager(...)`. | Role-change routes/services and Members UI controls. | Feature 070, 084 lifecycle tests. | Not live. |
| `organization_users.remove` | Not separately enforced. Removal uses member-management umbrella. | Membership delete policies through `app.current_user_can_manage_members(...)`; owner rows protected. | `removeTenantMember(...)` after `assertTenantMemberManager(...)`. | Member removal routes/services and Members UI controls. | Feature 070, 084 cascade tests. | Not live. |
| `projects.create` | Owner/admin fixed roles only. | `app.current_user_can_create_projects(p_tenant_id)`; projects insert policy. | `assertCanCreateProjectsAction(...)`, `resolveTenantPermissions(...).canCreateProjects`. | `POST /api/projects`, `/projects` create form. | Feature 070 fixed role tests; Feature 084/086 custom-role non-enforcement tests. | Not live. |
| `project_workspaces.manage` | Owner/admin fixed roles only. | `app.current_user_can_manage_project_workspaces(p_tenant_id, p_project_id)`; project workspace insert/update/delete policies. | `assertCanManageProjectWorkspacesAction(...)`, `resolveWorkspacePermissions(...).canManageWorkspaces`. | `POST /api/projects/[projectId]/workspaces`, project detail staffing controls. | Feature 084 custom-role non-enforcement test. | Not live. |
| `capture.workspace` | Owner/admin or assigned photographer workspace access. | `app.current_user_can_capture_project(...)`, `app.current_user_can_capture_project_workspace(...)`. | `assertCanCaptureProjectAction(...)`, `assertCanCaptureWorkspaceAction(...)`, workspace request helpers. | Capture invites, participants, uploads, workflow handoff routes. | Existing project/workspace access and workflow tests. | Not live and should remain out of scope. |
| `capture.create_one_off_invites` | Fixed role capability; effectively capture-surface gated. | Capture project/workspace helpers. | Capture project/workspace guards. | Subject invite routes and forms. | Existing capture tests. | Not live and should remain out of scope. |
| `capture.create_recurring_project_consent_requests` | Fixed role capability; effectively capture-surface gated. | Capture project/workspace helpers plus profile/template policy checks as applicable. | Capture guards. | Recurring project consent request routes. | Existing recurring/profile tests. | Not live and should remain out of scope. |
| `capture.upload_assets` | Owner/admin or assigned photographer workspace access. | Capture project/workspace helpers. | Capture mutation guards. | Asset upload prepare/finalize/preflight routes. | Existing asset/capture tests. | Not live and should remain out of scope. |
| `review.workspace` | Owner/admin or effective system reviewer assignment from Feature 082. | `app.current_user_can_review_project(...)`, `app.current_user_can_review_project_workspace(...)`; system reviewer assignment helpers. | `assertCanReviewProjectAction(...)`, `assertCanReviewWorkspaceAction(...)`. | Review routes, workflow review transitions, correction review. | Feature 082 and related tests. | Not live and should remain out of scope. |
| `review.initiate_consent_upgrade_requests` | Review-surface gated; owner/admin or effective system reviewer assignment. | Review helpers. | Review guards. | Project consent upgrade request routes. | Existing review/upgrade tests. | Not live and should remain out of scope. |
| `workflow.finalize_project` | Owner/admin or effective reviewer access, with project workflow validation. | Review helpers for access; service enforces workflow state. | `handleProjectFinalizePost(...)`, `assertCanReviewProjectAction(...)`. | Project finalization route. | Existing workflow tests. | Not live and should remain out of scope. |
| `workflow.start_project_correction` | Owner/admin or effective reviewer access, with finalized/release state validation. | Review helpers for access; service enforces workflow state. | `handleProjectCorrectionStartPost(...)`. | Project correction start route. | Existing workflow/correction tests. | Not live and should remain out of scope. |
| `workflow.reopen_workspace_for_correction` | Owner/admin or effective reviewer access, with correction-state validation. | Review helpers for access; service enforces workflow state. | `handleWorkspaceCorrectionReopenPost(...)`. | Workspace correction reopen route. | Existing correction tests. | Not live and should remain out of scope. |
| `correction.review` | Review-surface gated with correction-state mutation checks. | Review helpers. | `requireWorkspaceCorrectionReviewMutationAccessForRequest(...)` and row variants. | Correction review routes. | Existing correction tests. | Not live and should remain out of scope. |
| `correction.consent_intake` | Review-surface gated with correction-state consent intake checks. | Review helpers. | `requireWorkspaceCorrectionConsentIntakeAccessForRequest(...)` and row variants. | Correction consent intake routes. | Existing correction tests. | Not live and should remain out of scope. |
| `correction.media_intake` | Review-capable boundary, not capture reopening. | Review helpers. | `requireWorkspaceCorrectionMediaIntakeAccessForRequest(...)` and row variants. | Correction media routes. | Existing correction tests. | Not live and should remain out of scope. |

## Current project creation authorization

Live project creation path:

- UI: `src/app/(protected)/projects/page.tsx` renders `CreateProjectForm` only when `resolveTenantPermissions(...).canCreateProjects` is true.
- Route: `src/app/api/projects/route.ts` handles `POST`.
- Tenant derivation: `ensureTenantId(supabase)` derives tenant server-side.
- Guard: `assertCanCreateProjectsAction(supabase, tenantId, user.id)`.
- SQL/RLS: `app.current_user_can_create_projects(p_tenant_id)` and the projects insert policy.
- Insert: route inserts `tenant_id`, `created_by`, `name`, and `description`.

Current behavior:

- Owner/admin fixed roles can create projects.
- Reviewer/photographer fixed roles cannot create projects.
- Tenant-scoped custom roles with `projects.create` do not currently grant project creation.
- Feature 084 explicitly tests that a custom role containing `projects.create` leaves `canCreateProjects` false, the SQL helper false, and `assertCanCreateProjectsAction(...)` denied.

Recommended Feature 087 behavior:

- Preserve owner/admin fixed role authority.
- Allow active tenant-scoped custom-role assignments containing `projects.create`.
- Deny no-capability, revoked, archived, cross-tenant, project-scoped, and workspace-scoped custom-role cases.
- Do not let `projects.create` grant workspace staffing, capture, review, correction, finalization, Media Library, template/profile, or member-management rights.

## Current project workspace/staffing authorization

Live workspace/staffing path:

- UI: `src/app/(protected)/projects/[projectId]/page.tsx` renders `ProjectWorkspaceStaffingForm` when `staffingMutationsAllowed` is true.
- Current UI gate: `staffingMutationsAllowed = Boolean(projectPermissions.canManageMembers && project.status === "active" && !project.finalized_at)`.
- Route: `src/app/api/projects/[projectId]/workspaces/route.ts` handles `POST`.
- Tenant derivation: `resolveTenantId(supabase)` derives tenant server-side.
- Guard: `assertCanManageProjectWorkspacesAction(...)`.
- Additional route check: the route then rejects unless the accessible workspace result role is `owner` or `admin`.
- Workflow guard: `assertProjectWorkflowMutable(...)`.
- Service: `createPhotographerWorkspace(...)` creates an idempotent photographer workspace or returns the existing row.
- SQL/RLS: `app.current_user_can_manage_project_workspaces(p_tenant_id, p_project_id)` governs project workspace insert/update/delete policies.

Current behavior:

- Owner/admin fixed roles can manage project workspaces/staffing.
- Reviewer/photographer fixed roles cannot.
- Tenant-scoped custom roles with `project_workspaces.manage` do not currently grant workspace management.
- Project-scoped and workspace-scoped custom-role assignments are ignored by all live enforcement helpers.

Recommended Feature 087 behavior:

- Preserve owner/admin fixed role authority.
- Allow active tenant-scoped custom-role assignments containing `project_workspaces.manage`.
- Keep this as tenant-scoped custom-role enforcement even though the route is project-specific. The capability is currently modeled as an owner/admin administrative capability, not as a project-scoped custom role.
- Remove or replace the extra fixed owner/admin role check in `POST /api/projects/[projectId]/workspaces`; otherwise the central guard change would not take effect.
- Move project detail staffing control visibility from `canManageMembers` to an effective project workspace management check.
- Keep reviewer access assignment controls separate from workspace staffing.
- Do not let `project_workspaces.manage` grant review, capture, correction, finalization, Media Library, template/profile, project creation, or member-management rights.

## Current organization-user/member-management authorization

Live member-management path:

- Navigation: `src/app/(protected)/layout.tsx` shows `/members` when `resolveTenantPermissions(...).canManageMembers` is true.
- Members page data: `getTenantMemberManagementData(...)`.
- Guard: `assertTenantMemberManager(...)`.
- Permission source: `resolveTenantPermissions(...).canManageMembers`, fixed owner/admin only.
- SQL/RLS: `app.current_user_can_manage_members(p_tenant_id)` governs membership and tenant membership invite policies.
- Owner protection: owner membership rows cannot be updated/deleted by normal member-management policies; service code also blocks owner edits/removal.
- Invite roles: owner is not inviteable.
- Role changes: `updateTenantMemberRole(...)` allows manageable roles and revokes active system reviewer assignments when changing a reviewer away from reviewer.
- Removal: `removeTenantMember(...)` blocks owner removal and relies on database cascades for dependent assignments.

The member-management umbrella currently includes more than basic member CRUD:

- listing members,
- pending invite create/resend/revoke,
- fixed role changes,
- member removal,
- role editor data,
- custom role assignment summary,
- tenant custom role grant/revoke services,
- reviewer access summaries on the Members page.

Reviewer access assignment has an additional boundary:

- `src/lib/tenant/reviewer-access-service.ts` uses an explicit owner/admin role check in `assertReviewerAccessManager(...)`.
- It does not currently delegate to `canManageMembers`.
- This keeps tenant-wide/project reviewer assignment management fixed owner/admin.

Answers to organization-user research questions:

- `organization_users.manage` cannot safely become an umbrella custom-role gate in Feature 087 without also deciding whether custom-role users may see and operate role editor, custom role assignment, reviewer access, invites, fixed role changes, and removals.
- `organization_users.invite`, `organization_users.change_roles`, and `organization_users.remove` are not separately enforced by the current routes/services. The current service structure is organized around one `canManageMembers` umbrella.
- Enabling `organization_users.manage` naively would likely grant custom-role editor and custom role assignment management wherever code depends on `assertTenantMemberManager(...)`. That is too broad for Feature 087.
- Enabling `organization_users.change_roles` naively could allow a custom-role user to promote another user to `admin`, because the live role-change service is built around manageable fixed roles, not a custom-role-only delegation model.
- The product decision "can a custom-role user change fixed roles at all, or only assign custom roles?" is unresolved.
- The product decision "can a custom-role user grant/revoke reviewer access assignments?" is unresolved and should not be bundled into workspace staffing.
- Owner rows are protected, but owner/admin management semantics for delegated custom roles remain unresolved.

Recommendation: defer all `organization_users.*` custom-role enforcement to Feature 088.

## Current project default template authorization

Live project default template path:

- Route: `src/app/api/projects/[projectId]/default-template/route.ts`.
- Service: `setProjectDefaultTemplate(...)` in `src/lib/templates/template-service.ts`.
- Guard: `resolveTemplateManagementAccess(...)` and `canManageTemplates`.
- SQL/RLS: project update is performed through the service role after tenant/project validation and `assertProjectWorkflowMutable(...)`; template validity is checked against the tenant and active template state.
- Current comment: project default-template changes are treated as template-management actions, not broad project-management grants.

Live code reviewed did not show a separate allowed/whitelisted template configuration surface. The current live concept is a project default template.

Options considered:

- Option A: Keep project default template update under `templates.manage`.
- Option B: Move project default template update under `project_workspaces.manage` for Feature 087.
- Option C: Keep it under `templates.manage` for now and defer a future narrower capability such as `projects.configure_templates` or `projects.manage`.
- Option D: Split default and allowed/whitelisted template configuration if multiple live concepts exist.

Recommendation: choose Option C for Feature 087. Do not move project default template authorization to `project_workspaces.manage` in this slice.

Rationale:

- `project_workspaces.manage` is currently the staffing/workspace administrative surface, not a general project configuration capability.
- Moving the route in Feature 087 would alter Feature 086 behavior and broaden workspace managers into template configuration.
- `templates.manage` is not the perfect long-term fit for project-specific template selection, but it is the live behavior and is already custom-role enforced.
- A future `projects.configure_templates` or `projects.manage` capability would be clearer if project-level template configuration grows beyond the current default template field.

## Current SQL/RLS helpers and policies involved

Existing helpers that matter for Feature 087:

- `app.current_user_has_tenant_custom_role_capability(p_tenant_id, p_capability_key)`
- `app.current_user_can_create_projects(p_tenant_id)`
- `app.current_user_can_manage_project_workspaces(p_tenant_id, p_project_id)`
- `app.current_user_can_manage_members(p_tenant_id)`
- `app.current_user_has_media_library_custom_role_capability(p_tenant_id, p_capability_key)`
- `app.current_user_can_access_media_library(p_tenant_id)`
- `app.current_user_can_manage_media_library(p_tenant_id)`
- `app.current_user_can_manage_templates(p_tenant_id)`
- `app.current_user_can_view_recurring_profiles(p_tenant_id)`
- `app.current_user_can_manage_recurring_profiles(p_tenant_id)`
- `app.current_user_can_capture_project(...)`
- `app.current_user_can_capture_project_workspace(...)`
- `app.current_user_can_review_project(...)`
- `app.current_user_can_review_project_workspace(...)`

Policies that should inherit Feature 087 behavior through helper changes:

- `projects` insert policy through `app.current_user_can_create_projects(tenant_id)`.
- `project_workspaces` insert/update/delete policies through `app.current_user_can_manage_project_workspaces(tenant_id, project_id)`.

Feature 087 should not modify capture/review/correction policies.

## Current TypeScript helpers, services, routes, and UI components involved

Likely in-scope for a future implementation plan:

- `src/lib/tenant/tenant-custom-role-capabilities.ts`
- `src/lib/tenant/permissions.ts`
- `src/app/api/projects/route.ts`
- `src/app/api/projects/[projectId]/workspaces/route.ts`
- `src/app/(protected)/projects/page.tsx`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/components/projects/project-workspace-staffing-form.tsx` only if props/types need adjustment.

Likely out of scope except for regression tests:

- `src/lib/tenant/member-management-service.ts`
- `src/lib/tenant/custom-role-assignment-service.ts`
- `src/lib/tenant/reviewer-access-service.ts`
- `src/components/projects/project-reviewer-access-panel.tsx`
- `src/lib/projects/project-workspace-request.ts`
- `src/lib/projects/project-workflow-route-handlers.ts`
- Media Library, template, and profile authorizers.

## Options considered

### Scope option 1: only `projects.create` and `project_workspaces.manage`

This is the safest bounded slice. Both capabilities are already tenant/admin capabilities in the catalog. Both have central TypeScript guards and SQL helpers. Both can be enforced by extending the existing allowlisted tenant custom-role helper without designing new delegation semantics.

### Scope option 2: primary targets plus a safe subset of `organization_users.*`

No safe subset is evident in live code. The routes/services are not separated by invite, role-change, removal, custom role assignment, reviewer assignment, and role editor capabilities. Adding only `organization_users.invite` or only `organization_users.remove` would require a service decomposition that belongs in its own plan.

### Scope option 3: primary targets plus all `organization_users.*`

This is too broad. It risks allowing custom-role users to manage fixed roles, administer custom roles, see role editor data, alter custom-role assignments, and possibly interact awkwardly with reviewer access assignment boundaries.

### Scope option 4: split differently and defer organization-user/member-management to Feature 088

This is the recommended option.

## Recommended bounded Feature 087 scope

Recommended Feature 087 title:

Feature 087 - Tenant-level project administration custom-role enforcement

Recommended exact capability keys to enforce:

- `projects.create`
- `project_workspaces.manage`

Recommended capabilities to defer:

- `organization_users.manage`
- `organization_users.invite`
- `organization_users.change_roles`
- `organization_users.remove`
- all capture capabilities,
- all review capabilities,
- all workflow capabilities,
- all correction capabilities,
- project-scoped custom role enforcement,
- workspace-scoped custom role enforcement.

Recommended project default template decision:

- Keep project default template update under `templates.manage` for Feature 087.
- Defer a clearer project template configuration capability to a later feature if needed.

## Shared tenant custom-role helper extension

Recommended TypeScript helper architecture:

- Extend `ENFORCED_TENANT_CUSTOM_ROLE_CAPABILITIES` with `projects.create` and `project_workspaces.manage`.
- Keep `assertEnforcedTenantCustomRoleCapability(...)` allowlisted.
- Keep the helper tenant-scoped only.
- Do not introduce a generic app-wide effective capability engine.
- Prefer surface-specific authorizers for project creation and project workspace management, matching the Media Library/template/profile pattern.
- Consider a small naming/comment update that states the helper is only for explicitly migrated tenant-level custom-role enforcement.

Recommended SQL helper architecture:

- Extend the SQL allowlist in `app.current_user_has_tenant_custom_role_capability(...)` with `projects.create` and `project_workspaces.manage`.
- Update `app.current_user_can_create_projects(...)` to allow fixed owner/admin or custom `projects.create`.
- Update `app.current_user_can_manage_project_workspaces(...)` to allow fixed owner/admin or custom `project_workspaces.manage`.
- Preserve Media Library, template, and profile wrappers exactly except for any necessary redefinition ordering.
- Do not add `organization_users.*` to the SQL allowlist in Feature 087.

## Security and tenant-isolation risks

Main Feature 087 risks:

- TypeScript/SQL mismatch: project creation and workspace management must be allowed/denied consistently in API guards and RLS helpers.
- Hidden fixed-role checks: the workspace creation route has an extra owner/admin role check after the central guard.
- UI mismatch: project detail staffing controls currently depend on member-management permission, not workspace-management permission.
- Cross-tenant leakage: custom-role helper changes must continue to derive tenant server-side and match role definitions, assignments, and members by tenant.
- Scoped assignment expansion: project-scoped and workspace-scoped custom-role assignments must not satisfy tenant-level `projects.create` or `project_workspaces.manage`.
- Role lifecycle: revoked assignments and archived custom roles must deny immediately.
- Unrelated capability expansion: project admin capabilities must not unlock capture, review, correction, Media Library, template/profile, or member-management surfaces.

## SQL/RLS and TypeScript parity considerations

For `projects.create`:

- TypeScript guard and UI should use the same effective rule as SQL.
- SQL `projects` insert policy should inherit custom-role access through `app.current_user_can_create_projects(...)`.
- Tests should prove API guard and SQL RPC agree.

For `project_workspaces.manage`:

- TypeScript guard and UI should use the same effective rule as SQL.
- SQL project workspace insert/update/delete policies should inherit custom-role access through `app.current_user_can_manage_project_workspaces(...)`.
- The route-level extra owner/admin check must be replaced so the central guard is authoritative.
- Tests should prove API guard, UI visibility helper, and SQL RPC agree.

## UI/nav/control gating implications

Project create:

- `/projects` already always appears in navigation.
- `CreateProjectForm` should become visible for fixed owner/admin and tenant-scoped custom-role users with `projects.create`.
- No dashboard redesign or IAM matrix is needed.

Project workspace/staffing:

- The staffing form should become visible for fixed owner/admin and tenant-scoped custom-role users with `project_workspaces.manage`, subject to existing active/not-finalized workflow gates.
- Photographer assignment data currently loads only under `canManageMembers`; Feature 087 needs a separate load path for workspace managers.
- Reviewer access controls must stay under the existing member/reviewer-access management boundary and should not be shown merely for `project_workspaces.manage`.

Members:

- Members navigation should remain fixed owner/admin in Feature 087.
- Members controls should not be split in Feature 087.

Project default template:

- Leave current UI/control authorization under `templates.manage`.
- No new visible copy appears required if authorization remains unchanged.

i18n:

- If implementation only shows existing forms to additional authorized users, no new user-facing strings should be needed.
- If new unauthorized/read-only explanations are added, add English and Dutch translation keys following existing message structure.

## Non-expansion boundaries

Feature 087 should explicitly not grant or alter:

- capture workspace access,
- one-off invite creation,
- recurring project consent request creation,
- asset upload,
- review workspace access,
- consent upgrade initiation,
- project finalization,
- project correction start,
- workspace correction reopen,
- correction review,
- correction consent intake,
- correction media intake,
- Media Library access or folder management,
- template/profile behavior beyond Feature 086,
- project default template behavior,
- project-scoped custom role assignment enforcement,
- workspace-scoped custom role assignment enforcement,
- generic effective capability resolution,
- member-level deny/override rules,
- agency/client hierarchy,
- per-folder or per-asset permissions,
- invite-to-custom-role,
- owner transfer or owner demotion,
- suspended/deactivated member states,
- broad Members page redesign.

## Test recommendations

Recommended Feature 087 tests:

- Fixed owner/admin can still create projects.
- Fixed reviewer/photographer without custom capability cannot create projects.
- Active tenant-scoped custom role with `projects.create` can create a project through TypeScript guard/API path and SQL policy/RPC.
- Custom role without `projects.create` cannot create projects.
- Revoked assignment with `projects.create` cannot create projects.
- Archived role with `projects.create` cannot create projects.
- Cross-tenant assignment with `projects.create` cannot create projects.
- Project-scoped assignment with `projects.create` cannot create projects.
- Workspace-scoped assignment with `projects.create` cannot create projects.
- Custom `projects.create` does not grant project workspace management.
- Custom `projects.create` does not grant member management, capture, review, correction, Media Library, templates, or profiles.
- Fixed owner/admin can still manage project workspaces.
- Fixed reviewer/photographer without custom capability cannot manage project workspaces.
- Active tenant-scoped custom role with `project_workspaces.manage` can create/manage photographer workspaces through TypeScript guard/API path and SQL policy/RPC.
- Custom role without `project_workspaces.manage` cannot manage project workspaces.
- Revoked assignment with `project_workspaces.manage` cannot manage project workspaces.
- Archived role with `project_workspaces.manage` cannot manage project workspaces.
- Cross-tenant assignment with `project_workspaces.manage` cannot manage project workspaces.
- Project-scoped assignment with `project_workspaces.manage` cannot manage project workspaces.
- Workspace-scoped assignment with `project_workspaces.manage` cannot manage project workspaces.
- Custom `project_workspaces.manage` does not grant project creation.
- Custom `project_workspaces.manage` does not grant reviewer access assignment management.
- Custom `project_workspaces.manage` does not grant member management, capture, review, correction, finalization, Media Library, templates, or profiles.
- Existing Feature 085 Media Library tests still pass.
- Existing Feature 086 template/profile tests still pass.
- Existing Feature 082 reviewer assignment behavior still passes.

UI tests should verify:

- project create form appears for effective `projects.create`,
- project create form remains hidden for users without it,
- staffing form appears for effective `project_workspaces.manage`,
- reviewer access panel remains hidden unless the user has the existing fixed owner/admin/member-management authority,
- Members nav remains hidden for custom roles in Feature 087.

## Fresh reset/dev data considerations

Assume local development can use `supabase db reset`.

Tests should create their own:

- tenants,
- memberships,
- custom role definitions,
- capability mappings,
- active tenant-scoped assignments,
- revoked assignments,
- archived roles,
- cross-tenant roles,
- project-scoped assignments,
- workspace-scoped assignments,
- projects,
- workspaces.

No production/local backfill is needed for Feature 087. No compatibility layer for arbitrary old local custom-role data is recommended.

## Likely implementation phases for the plan document

1. Extend the bounded TypeScript and SQL tenant custom-role allowlists with `projects.create` and `project_workspaces.manage`.
2. Update project creation TypeScript and SQL authorization in parity.
3. Update project workspace management TypeScript and SQL authorization in parity, including removing the extra fixed-role route check.
4. Update project create and project staffing UI visibility to use effective authorization.
5. Add focused parity and non-expansion tests.
6. Re-run existing Feature 082, 085, and 086 tests to catch regression around reviewer assignments, Media Library, templates, and profiles.

## Open decisions for the plan phase

- Should project creation effective authorization be exposed through `resolveTenantPermissions(...).canCreateProjects`, or should Feature 087 introduce a small project-administration resolver used by both API and UI?
- Should project workspace effective authorization be represented on `resolveProjectPermissions(...)`, `resolveWorkspacePermissions(...)`, or a new narrow resolver for project administration controls?
- How should the project detail page load assignable photographers for workspace managers without also loading reviewer access assignment data?
- Should TypeScript Media Library custom-role access be migrated to the shared tenant helper for consistency, or left untouched to keep Feature 087 smaller?
- What exact SQL migration ordering is needed to redefine helpers and preserve dependent policies cleanly?

## Final recommendation

Feature 087 should include only:

- `projects.create`
- `project_workspaces.manage`

Feature 087 should defer all organization-user/member-management custom-role enforcement to Feature 088.

Project default template authorization should remain under `templates.manage` in Feature 087. A later feature should introduce a clearer project template configuration capability if product scope requires moving that action out of template management.

The safest architecture is to keep the tenant custom-role helper bounded and allowlisted in both TypeScript and SQL, extend it only for the two recommended capability keys, and preserve surface-specific authorizers. Do not introduce generic app-wide effective capability resolution.
