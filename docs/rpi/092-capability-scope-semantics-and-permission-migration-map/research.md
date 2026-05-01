# Feature 092 - Capability Scope Semantics and Remaining Permission Migration Map

## Title and scope

This research defines the recommended scope semantics for the current capability catalog before migrating the remaining operational permissions away from the fixed membership-role model.

This is research only. It does not add capabilities, change code, update migrations, update tests, or broaden any authorization path.

The core question is how each catalog capability should behave when durable custom roles can be assigned at tenant, project, and workspace scope. The main risk is over-broad enforcement, especially granting workspace-local capture or review actions from a tenant-wide role without an explicit product decision.

## Inputs reviewed

Required context:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `UNCODEXIFY.md`
- `docs/rpi/README.md`
- `docs/rpi/SUMMARY.md`

RPI history:

- Feature 080 research and plan
- Feature 081 research and plan
- Feature 082 research and plan
- Feature 083 research and plan
- Feature 084 research and plan
- Feature 085 research and plan
- Feature 086 research and plan
- Feature 087 docs under the live folder `087-tenant-level-admin-permission-consolidation`
- Feature 088 research and plan
- Feature 089 research and plan
- Feature 090 research and plan
- Feature 091 research and plan

Live source inspected as authoritative:

- Capability and tenant custom-role helpers: `src/lib/tenant/role-capabilities.ts`, `src/lib/tenant/tenant-custom-role-capabilities.ts`, `src/lib/tenant/permissions.ts`, `src/lib/tenant/role-assignment-foundation.ts`
- Tenant, member, role, assignment, reviewer access, and organization-user services under `src/lib/tenant/`
- Project administration, workspaces, workflow, workspace request, participants, consent upgrade, and route-handler services under `src/lib/projects/`
- Asset upload/correction handlers under `src/lib/assets/`
- Project API routes under `src/app/api/projects/**`
- Member API routes under `src/app/api/members/**`
- Template/profile/media-library services and routes
- Migrations for Features 070, 072, 073, 074, 075, 076, 078, 081, 082, 083, 085, 086, 087, 088, and 089
- Tests for Features 070, 073, 074, 075, 076, 079, 080, 081, 082, 083, 084, 085, 086, 087, 088, 089, and 091

## Source-of-truth notes and drift found

Live code, migrations, and tests are authoritative over older RPI docs.

Drift found:

- Feature 087 is requested as project-administration custom-role enforcement, but the live RPI folder is named `087-tenant-level-admin-permission-consolidation`. The live implementation is project administration enforcement for `projects.create` and `project_workspaces.manage`, with migration `20260430170000_087_project_admin_custom_role_enforcement.sql` and test `feature-087-project-admin-custom-role-enforcement.test.ts`.
- `docs/rpi/SUMMARY.md` is useful as a timeline but is stale in places for Features 087 and later. The current source shows 087, 088, 089, and 091 behavior has shipped in code/tests.
- The schema supports tenant, project, and workspace `role_assignments`, but owner/admin custom-role assignment UI/API currently exposes tenant-scope custom assignments only.
- The SQL helper `app.current_user_has_tenant_custom_role_capability` has been repeatedly redefined by migrations 085-089 and is intentionally allowlisted. It ignores project and workspace assignments.
- Reviewer access uses durable `role_assignments`, but only for the system reviewer role and only for reviewer-access semantics. That is separate from custom-role assignment.

## Current capability catalog

Current `TENANT_CAPABILITIES`:

- `organization_users.manage`
- `organization_users.invite`
- `organization_users.change_roles`
- `organization_users.remove`
- `templates.manage`
- `profiles.view`
- `profiles.manage`
- `projects.create`
- `project_workspaces.manage`
- `capture.workspace`
- `capture.create_one_off_invites`
- `capture.create_recurring_project_consent_requests`
- `capture.upload_assets`
- `review.workspace`
- `review.initiate_consent_upgrade_requests`
- `workflow.finalize_project`
- `workflow.start_project_correction`
- `workflow.reopen_workspace_for_correction`
- `correction.review`
- `correction.consent_intake`
- `correction.media_intake`
- `media_library.access`
- `media_library.manage_folders`

Current fixed-role mappings:

- `owner`: all capabilities.
- `admin`: all capabilities.
- `reviewer`: `profiles.view`, `review.workspace`, `review.initiate_consent_upgrade_requests`, `workflow.finalize_project`, `workflow.start_project_correction`, `workflow.reopen_workspace_for_correction`, `correction.review`, `correction.consent_intake`, `correction.media_intake`, `media_library.access`, `media_library.manage_folders`.
- `photographer`: `profiles.view`, `capture.workspace`, `capture.create_one_off_invites`, `capture.create_recurring_project_consent_requests`, `capture.upload_assets`.

Current enforced tenant custom-role allowlist:

- `media_library.access`
- `media_library.manage_folders`
- `templates.manage`
- `profiles.view`
- `profiles.manage`
- `projects.create`
- `project_workspaces.manage`
- `organization_users.manage`
- `organization_users.invite`
- `organization_users.change_roles`
- `organization_users.remove`

Cataloged but not custom-role enforced yet:

- `capture.workspace`
- `capture.create_one_off_invites`
- `capture.create_recurring_project_consent_requests`
- `capture.upload_assets`
- `review.workspace`
- `review.initiate_consent_upgrade_requests`
- `workflow.finalize_project`
- `workflow.start_project_correction`
- `workflow.reopen_workspace_for_correction`
- `correction.review`
- `correction.consent_intake`
- `correction.media_intake`

Enforced through the system reviewer assignment model rather than custom roles:

- Project/workspace review access and project visibility for fixed reviewer members are gated by tenant-wide or project-scoped system reviewer role assignments.
- Tenant-wide reviewer assignment grants Media Library access under the reviewer model.
- No shipped reviewer access UI/API grants workspace-scoped reviewer assignments, although SQL helper naming includes workspace reviewer access as a wrapper around project reviewer access.

## Current role assignment model

Schema:

- `role_definitions` stores system role definitions (`owner`, `admin`, `reviewer`, `photographer`) and tenant-local custom role definitions.
- `role_definition_capabilities` links role definitions to catalog capability keys.
- `role_assignments` has `scope_type` in `tenant`, `project`, `workspace`.
- Tenant scope requires null `project_id` and `workspace_id`.
- Project scope requires `project_id` and null `workspace_id`.
- Workspace scope requires both `project_id` and `workspace_id`.
- Foreign keys ensure assignments stay within tenant/project/workspace boundaries.
- Active uniqueness exists separately per scope shape. Revocation is soft via `revoked_at` and `revoked_by`.

Product exposure today:

- Owner/admin custom-role assignment UI/API exposes only tenant-scoped custom role assignment.
- The custom-role assignment service inserts only `scope_type = 'tenant'`, null `project_id`, null `workspace_id`.
- Project/workspace custom assignments can exist at schema level and are used in tests to prove they do not affect tenant-only migrated areas.
- Project/workspace custom assignments are not product-visible for custom roles.
- Reviewer access management exposes tenant-wide and project-scoped assignments, but only for the system reviewer role and only for users whose fixed membership role is `reviewer`.

Current TypeScript/SQL enforcement:

- `tenant-custom-role-capabilities.ts` enforces only tenant-scoped active custom role assignments, and only for the allowlisted capabilities.
- SQL `app.current_user_has_tenant_custom_role_capability` mirrors this tenant-only allowlist.
- `role-assignment-foundation.ts` is still a non-authoritative read/drift helper for broad durable assignments.
- Reviewer access service enforces system reviewer assignments separately.
- Operational capture/review/workflow/correction helpers still use fixed owner/admin, fixed photographer workspace assignment, and fixed reviewer effective reviewer access.

## Already migrated areas

### Media Library

- Capability keys: `media_library.access`, `media_library.manage_folders`.
- Scope used today: tenant-scoped custom role assignment only.
- TypeScript: `src/lib/tenant/media-library-custom-role-access.ts`.
- SQL/RLS: `app.current_user_has_media_library_custom_role_capability`, `app.current_user_can_access_media_library`, `app.current_user_can_manage_media_library`.
- Routes/UI: `src/app/(protected)/media-library/**`, `src/app/api/media-library/**`, folder and release services.
- V1 status: complete enough for V1 as a tenant-wide released-media surface.
- Ambiguity: `media_library.manage_folders` does not imply `media_library.access` in the custom-role resolver. That appears intentional and is covered by tests; the UI should continue making this visible.

### Templates

- Capability key: `templates.manage`.
- Scope used today: tenant-scoped custom role assignment only.
- TypeScript: `src/lib/templates/template-service.ts`, `resolveTemplateManagementAccess`.
- SQL/RLS: `app.current_user_can_manage_templates`.
- Routes/UI: template management routes and template management UI.
- V1 status: complete enough for V1.
- Ambiguity: project default template changes are authorized through template management, not project administration. This is documented in code and should remain explicit.

### Recurring profiles

- Capability keys: `profiles.view`, `profiles.manage`.
- Scope used today: tenant-scoped custom role assignment only.
- TypeScript: `src/lib/profiles/profile-access.ts`.
- SQL/RLS: `app.current_user_can_view_profiles`, `app.current_user_can_manage_profiles`.
- Routes/UI: recurring profile directory routes and UI.
- V1 status: complete enough for V1.
- Ambiguity: `profiles.manage` implies `profiles.view`; this is explicitly implemented.

### Project creation

- Capability key: `projects.create`.
- Scope used today: tenant-scoped custom role assignment only.
- TypeScript: `src/lib/projects/project-administration-service.ts`, called by `assertCanCreateProjectsAction`.
- SQL/RLS: `app.current_user_can_create_projects`.
- Routes/UI: `src/app/api/projects/route.ts`, projects landing/creation UI.
- V1 status: complete enough for tenant-scoped "can create project containers".
- Ambiguity: none. Project-scope and workspace-scope assignment for this capability are nonsensical because the target project does not exist yet.

### Project workspace management

- Capability key: `project_workspaces.manage`.
- Scope used today: tenant-scoped custom role assignment only.
- TypeScript: `src/lib/projects/project-administration-service.ts`, `assertCanManageProjectWorkspacesAdministrationAction`, `listProjectAdministrationWorkspaces`, and `src/app/api/projects/[projectId]/workspaces/route.ts`.
- SQL/RLS: `app.current_user_can_manage_project_workspaces`.
- Routes/UI: project detail workspace management and photographer staffing form.
- V1 status: complete enough for an all-projects workspace manager role.
- Ambiguity: this capability should support project-scoped assignment in a later feature so a user can staff/manage workspaces for one project without tenant-wide project administration.

### Organization users

- Capability keys: `organization_users.manage`, `organization_users.invite`, `organization_users.change_roles`, `organization_users.remove`.
- Scope used today: tenant-scoped custom role assignment only.
- TypeScript: `src/lib/tenant/organization-user-access.ts`, `member-management-service.ts`.
- SQL/RLS: `app.current_user_can_view_organization_users`, `app.current_user_can_invite_organization_users`, `app.current_user_can_change_organization_user_role`, `app.current_user_can_remove_organization_user`.
- Routes/UI: member APIs under `src/app/api/members/**`, delegated member management UI.
- V1 status: complete enough for delegated V1 boundaries.
- Ambiguity: delegated users can target only reviewer/photographer users and cannot manage owner/admin/self or role administration.

### Role administration

- Capability keys: none. This is intentionally not capability-delegated.
- Scope used today: fixed owner/admin only.
- TypeScript: `custom-role-service.ts`, `custom-role-assignment-service.ts`, `reviewer-access-service.ts`, `member-management-service.ts`.
- SQL/RLS: owner/admin membership checks, not custom-role capability checks.
- Routes/UI: custom role editor, custom role assignment, reviewer access management.
- V1 status: complete enough and intentionally fixed.
- Ambiguity: none for V1. Do not delegate role administration in Feature 093+ unless a later explicit product decision adds new capability keys.

## Reviewer access model

Fixed `reviewer` role:

- A fixed reviewer membership is eligibility, not full tenant-wide review authority by itself.
- Effective reviewer access requires an active durable system reviewer role assignment.

Tenant-wide reviewer assignments:

- Stored in `role_assignments` with `scope_type = 'tenant'`, system reviewer role definition, and null project/workspace.
- Grant reviewer access to all projects/workspaces.
- Grant Media Library access under reviewer semantics.

Project reviewer assignments:

- Stored in `role_assignments` with `scope_type = 'project'`, system reviewer role definition, and `project_id`.
- Grant reviewer access to that project and its workspaces.
- Do not grant tenant-wide Media Library access.

Workspace reviewer assignments:

- The schema can represent workspace assignments and SQL has a workspace-named reviewer helper, but the current service/UI does not expose workspace reviewer assignments.
- Current SQL `current_user_has_workspace_reviewer_access` delegates to project reviewer access, not a distinct workspace assignment.

Project/workspace access effects:

- `resolveAccessibleProjectWorkspaces` lets reviewers with effective project reviewer access see all workspaces in the project.
- Project list/detail access relies on effective reviewer access for reviewer members.
- Review actions currently check `assertCanReviewProjectAction`, `assertCanReviewWorkspaceAction`, or workspace request helpers.

Why reviewer access is not just tenant custom-role assignment:

- It is target-user constrained to fixed reviewer members.
- It uses system reviewer role definitions, not tenant-local custom role definitions.
- It supports project scope today.
- It is a project access model as well as a capability model.
- It is operationally safer than a tenant-wide custom role for all review actions.

Future `review.workspace` custom-role enforcement should coexist first, not replace reviewer access. A later replacement decision would need an explicit migration for existing reviewer assignments, UI semantics, tests, and cleanup rules. The safer next step is additive scoped custom-role enforcement with reviewer access preserved.

## Project administration scope

`projects.create`:

- Tenant-only.
- Creates a new tenant project container.
- Project/workspace-scoped assignment is not applicable because no target project/workspace exists before creation.

`project_workspaces.manage` today:

- Custom-role enforced only through tenant-scoped assignment.
- Gives a user project-administration visibility and workspace staffing ability across tenant projects.
- A user with `projects.create` can also see projects they created in the administration read model.

Recommended semantics:

- Tenant-scope support: yes, as "all projects workspace manager".
- Project-scope support: yes, to staff/manage workspaces for one project.
- Workspace-scope support: no. The action manages workspaces from the project level; assigning it to the workspace being managed is circular and would not help create/manage sibling workspaces.

Affected UI/API for project-scoped support:

- Project detail workspace list and staffing panel.
- `GET/POST src/app/api/projects/[projectId]/workspaces/route.ts`.
- Project administration list/read model should expose the specific project when project-scoped `project_workspaces.manage` is present.
- Effective access UI should explain whether a user has tenant-wide or project-limited workspace management.

## Capture scope

Current capture access model:

- TypeScript helpers: `requireWorkspaceCaptureAccessForRequest`, `requireWorkspaceCaptureMutationAccessForRequest`, `requireWorkspaceCaptureAccessForRow`, `requireWorkspaceCaptureMutationAccessForRow`.
- Underlying permissions: fixed owner/admin; fixed photographer assigned to the selected workspace; reviewers are not capture-capable except correction intake paths that deliberately use reviewer boundaries.
- SQL/RLS: `app.current_user_can_capture_project_workspace` and table policies for `subject_invites`, `subjects`, `consents`, `assets`, and related workspace-scoped rows.
- State gates: normal capture mutations require active project, unfinalized project, and workspace state `active` or `needs_changes`.

Actions:

- Access workspace capture surface: reads workspace-scoped capture data. Currently owner/admin and assigned photographer. Tenant-scoped custom role could be allowed only if product accepts all-workspace capture; project-scoped and workspace-scoped are safer.
- Create one-off invites: `src/app/api/projects/[projectId]/invites/route.ts`, `createInviteWithIdempotency`, touches `subject_invites` with `tenant_id`, `project_id`, `workspace_id`, template, token hash, idempotency. Recommended tenant yes only as explicit all-workspace capture, project yes, workspace yes.
- Revoke one-off invites: `src/app/api/projects/[projectId]/invites/[inviteId]/revoke/route.ts`, row-scoped checks against `subject_invites.workspace_id`, only unused active invites; also cancels pending upgrade request using same invite. Recommended tenant/project/workspace same as create, plus row workspace match.
- Add recurring participants: `src/app/api/projects/[projectId]/profile-participants/route.ts`, `project-participants-route-handlers.ts`, `project-participants-service.ts`, touches `project_profile_participants`, recurring profile reads, matching replay. Recommended tenant maybe, project yes, workspace yes.
- Create recurring project consent requests: `src/app/api/projects/[projectId]/profile-participants/[participantId]/consent-request/route.ts`, RPC `create_recurring_profile_project_consent_request`, idempotency, template selection. Recommended tenant maybe, project yes, workspace yes.
- Upload assets/preflight/prepare/finalize: normal routes under `src/app/api/projects/[projectId]/assets/**`; services `prepareProjectAssetBatch`, `finalizeProjectAssetBatch`, `finalizeAsset`. All target `assets` by workspace. Recommended tenant maybe, project yes, workspace yes. Avoid accidentally making `capture.upload_assets` tenant-wide unless an all-workspace uploader role is explicitly desired.

Correction mode capture-like actions:

- During finalized project correction, one-off invite creation/revoke and recurring consent request creation switch to `requireWorkspaceCorrectionConsentIntakeAccess...`, not normal capture.
- Correction media upload routes use `requireWorkspaceCorrectionMediaIntakeAccess...`.
- These should be migrated under correction capabilities, not normal capture capabilities.

## Review scope

Current review access model:

- Read helpers: `requireWorkspaceReviewAccessForRequest` and `requireWorkspaceReviewAccessForRow`.
- Mutation helpers: `requireWorkspaceReviewMutationAccessForRequest`, `requireWorkspaceReviewMutationAccessForRow`, and `requireWorkspaceCorrectionReviewMutationAccessForRow`.
- Underlying permissions: fixed owner/admin or fixed reviewer with effective project reviewer access.
- SQL/RLS: `app.current_user_can_review_project_workspace` and project/workspace access helpers.
- State gates: normal review mutations require active unfinalized project and workspace `handed_off` or `needs_changes`, with a few reads not mutation-gated. Some mutations allow correction review on finalized correction-open projects when the workspace is `handed_off`.

Actions:

- Open review surface/read review data: preview faces, preview candidates, whole-asset candidates, review-session reads. Current routes use review row/request access. Recommended tenant maybe for all-project reviewers, project yes, workspace yes.
- Create review sessions: `src/app/api/projects/[projectId]/consents/[consentId]/review-sessions/route.ts`; mutation access through correction-aware review helper. Recommended tenant maybe, project yes, workspace yes.
- Preview faces/link candidates/whole-asset candidates: routes under `assets/[assetId]/*preview*` and `whole-asset-candidates`; read-only review access. Recommended tenant maybe, project yes, workspace yes.
- Assign/unassign faces: `assets/[assetId]/faces/[assetFaceId]/assignment/route.ts`; touches asset faces, manual link rows, consent/participant targets; all row-matched to workspace. Recommended tenant maybe, project yes, workspace yes.
- Create manual faces: `assets/[assetId]/manual-faces/route.ts`; creates manual face materialization for one asset/workspace. Recommended tenant maybe, project yes, workspace yes.
- Hide/suppress/block faces: hidden and blocked face routes; touches face suppression/linking state in one workspace. Recommended tenant maybe, project yes, workspace yes.
- Whole-asset links and consent asset links: routes under `whole-asset-links`, `consents/[consentId]/assets/links`, and manual link state; workspace-row matched. Recommended tenant maybe, project yes, workspace yes.
- Consent upgrade requests: `consents/[consentId]/upgrade-request/route.ts`, `project-consent-upgrade-service.ts`; creates invite and project consent upgrade request for the consent workspace. Recommended tenant maybe, project yes, workspace yes. In finalized correction mode this currently uses correction consent intake, so migration should decide whether the same capability or `correction.consent_intake` authorizes it.

## Workflow and finalization scope

Current workflow access model:

- Workspace handoff uses capture access.
- Workspace validate/needs_changes/reopen uses review access.
- Project finalization and project correction start use `assertCanReviewProjectAction` after resolving accessible project workspaces.
- Workspace correction reopen uses review access.
- SQL/RLS remains fixed role/reviewer assignment based through project/workspace helpers.

Actions:

- Workspace handoff: route `workspaces/[workspaceId]/handoff`; capture access; active/needs_changes to handed_off; project must not be archived/finalized. Recommended capability mapping remains capture-side or `capture.workspace`, with tenant maybe, project yes, workspace yes.
- Workspace validation: route `workspaces/[workspaceId]/validate`; review access; handed_off to validated; blockers must be clear. Recommended `review.workspace` or future workflow-specific treatment; tenant maybe, project yes, workspace yes.
- Workspace needs changes/reopen before finalization: routes `needs-changes` and `reopen`; review access; handed_off to needs_changes or validated to needs_changes. Recommended `review.workspace` or future workflow-specific treatment; tenant maybe, project yes, workspace yes.
- Project finalization: route `projects/[projectId]/finalize`; capability `workflow.finalize_project`; touches project finalization fields and release snapshot creation; requires all workspaces validated and no blockers. Recommended tenant maybe, project yes, workspace no. Workspace-scope cannot safely finalize an umbrella project unless all workspace assignees coordinate, which is a different approval model.
- Project correction start: route `projects/[projectId]/correction/start`; capability `workflow.start_project_correction`; requires finalized active project and existing release snapshot; opens correction cycle. Recommended tenant maybe, project yes, workspace no.
- Workspace reopen for correction: route `workspaces/[workspaceId]/correction-reopen`; capability `workflow.reopen_workspace_for_correction`; requires finalized project, correction open, target workspace validated; reopens exactly one workspace. Recommended tenant maybe, project yes, workspace yes.

## Correction scope

Current correction access model:

- Correction review uses reviewer access with correction state gates.
- Correction consent intake uses reviewer access with reopened workspace/current correction cycle gates.
- Correction media intake intentionally uses reviewer-capable access, not capture access, so finalized capture remains closed.
- Public correction submissions are token/provenance scoped, not custom-role scoped.

Actions:

- Correction review: routes using `requireWorkspaceCorrectionReviewMutationAccessForRow`, including review sessions, review-session item actions, face assignments, manual faces, hidden/blocked faces, and whole-asset links. Requires finalized project with correction open and workspace `handed_off`, or falls back to normal review rules before finalization. Recommended tenant maybe, project yes, workspace yes.
- Correction consent intake: one-off invite create/revoke in correction mode, recurring participant add, recurring project consent request, and consent upgrade request in correction mode. Requires finalized project, correction open, target workspace reopened for current cycle. Recommended tenant maybe, project yes, workspace yes.
- Correction media intake: correction asset preflight/prepare/finalize routes under `projects/[projectId]/correction/assets/**`; requires finalized project, correction open, target workspace reopened for current cycle. Recommended tenant maybe, project yes, workspace yes.
- Reopened workspace upload/intake: same as correction media intake, not normal `capture.upload_assets`.
- Correction release preparation: finalizing a correction cycle reuses `finalizeProject` and release snapshot repair/creation. Treat as `workflow.finalize_project`, project-scoped, not a separate release-permission surface for now.

## Public token and release boundaries

These should not become normal custom-role surfaces:

- One-off invite public signing.
- Recurring consent public signing.
- Public revocation.
- Organization invite acceptance.
- Release snapshot creation internals.
- Media Library release detail/download authorization.

Public token flows are authorization by possession of a narrow, expiring, hashed token plus route-specific validation. They usually do not have an authenticated tenant member and should not call membership/custom-role helpers.

Release snapshots are immutable outputs of project finalization/correction. Media Library authorization should remain a tenant-level released-media authorization check, not a live project/workspace authorization check. Otherwise historical release access would change when project staffing or workspace permissions change.

## Capability scope matrix

| Capability key | Current fixed/system role meaning | Current custom-role enforcement status | Current enforcement scope | Tenant support | Project support | Workspace support | Recommended first implementation feature | Notes/rationale |
|---|---|---|---|---|---|---|---|---|
| `organization_users.manage` | Owner/admin manage members; delegated users can read/list reduced directory. | Enforced. | Tenant custom role only. | yes | no | no | Done | Tenant membership resource. |
| `organization_users.invite` | Owner/admin invite admin/reviewer/photographer; delegated users invite reviewer/photographer. | Enforced. | Tenant custom role only. | yes | no | no | Done | Tenant membership invite resource. |
| `organization_users.change_roles` | Owner/admin broad role changes except owner; delegated users change reviewer/photographer only. | Enforced. | Tenant custom role only. | yes | no | no | Done | Tenant membership resource, target-sensitive. |
| `organization_users.remove` | Owner/admin broad removal except owner; delegated users remove reviewer/photographer only. | Enforced. | Tenant custom role only. | yes | no | no | Done | Tenant membership resource, target-sensitive. |
| `templates.manage` | Owner/admin manage tenant templates. | Enforced. | Tenant custom role only. | yes | no | no | Done | Tenant reusable content. |
| `profiles.view` | Owner/admin/reviewer/photographer can view recurring profiles. | Enforced. | Tenant custom role only. | yes | no | no | Done | Organization directory resource. |
| `profiles.manage` | Owner/admin manage recurring profiles. | Enforced. | Tenant custom role only. | yes | no | no | Done | Manage implies view. |
| `projects.create` | Owner/admin create projects. | Enforced. | Tenant custom role only. | yes | not applicable | not applicable | Done | No target project exists before action. |
| `project_workspaces.manage` | Owner/admin staff/manage project workspaces; custom role grants all-project workspace admin today. | Enforced. | Tenant custom role only. | yes | yes | no | Feature 093/094 | Add project-scoped assignment before using it for one-project staffing. |
| `capture.workspace` | Owner/admin and assigned photographer access capture workspace. | Not enforced by custom roles. | Fixed owner/admin or photographer workspace assignment. | maybe | yes | yes | Feature 095 | Tenant-wide should mean explicit all-workspace capture. |
| `capture.create_one_off_invites` | Same as capture workspace, with mutation/state checks. | Not enforced by custom roles. | Fixed capture helper and workspace state. | maybe | yes | yes | Feature 095 | Workspace-local invite rows. |
| `capture.create_recurring_project_consent_requests` | Same as capture workspace, with mutation/state checks. | Not enforced by custom roles. | Fixed capture helper and workspace state. | maybe | yes | yes | Feature 095 | Workspace-local participants/requests. |
| `capture.upload_assets` | Same as capture workspace, with upload state checks. | Not enforced by custom roles. | Fixed capture helper and workspace state. | maybe | yes | yes | Feature 095 | Highest over-broad risk if tenant-wide by accident. |
| `review.workspace` | Owner/admin and reviewer with effective reviewer access review workspace. | System reviewer assignments, not custom roles. | Fixed role plus tenant/project reviewer assignment. | maybe | yes | yes | Feature 096 | Coexist with reviewer access first. |
| `review.initiate_consent_upgrade_requests` | Review-capable users create upgrade requests. | Not enforced by custom roles. | Fixed review helper; correction mode uses correction consent intake. | maybe | yes | yes | Feature 096 or 098 | Decide correction-mode authority in plan. |
| `workflow.finalize_project` | Owner/admin and effective reviewer finalize project/correction cycle. | Not enforced by custom roles. | Fixed review project helper and state blockers. | maybe | yes | no | Feature 097 | Project-wide action; workspace scope is too narrow. |
| `workflow.start_project_correction` | Owner/admin and effective reviewer open correction cycle. | Not enforced by custom roles. | Fixed review project helper and release-state checks. | maybe | yes | no | Feature 097 | Project-wide action after release snapshot. |
| `workflow.reopen_workspace_for_correction` | Owner/admin and effective reviewer reopen one validated workspace in correction cycle. | Not enforced by custom roles. | Fixed review workspace helper and correction-state checks. | maybe | yes | yes | Feature 097 | Workspace-targeted but project-state gated. |
| `correction.review` | Owner/admin and effective reviewer review correction work. | Not enforced by custom roles. | Fixed review helper plus correction gates. | maybe | yes | yes | Feature 098 | Workspace-local mutations under project correction cycle. |
| `correction.consent_intake` | Owner/admin and effective reviewer create/revoke correction consent intake. | Not enforced by custom roles. | Fixed review helper plus correction gates. | maybe | yes | yes | Feature 098 | Includes correction one-off, recurring, and upgrade request flows. |
| `correction.media_intake` | Owner/admin and effective reviewer upload correction media. | Not enforced by custom roles. | Fixed review-capable helper plus correction gates. | maybe | yes | yes | Feature 098 | Intentionally not normal capture on finalized project. |
| `media_library.access` | Owner/admin and tenant-wide reviewer can browse/download releases. | Enforced. | Tenant custom role plus reviewer model. | yes | no | no | Done | Release-snapshot tenant surface. |
| `media_library.manage_folders` | Owner/admin and tenant-wide reviewer manage release folders. | Enforced. | Tenant custom role plus reviewer model. | yes | no | no | Done | Folder management is tenant Media Library scope. |

## Options considered

### Option A - Continue tenant-scope-only custom-role enforcement

This is the fastest implementation path but creates over-broad operational grants. It would make capture, upload, review, workflow, and correction behave like organization-wide privileges even though their data and state machines are often workspace-local.

Recommendation: reject for operational capabilities. Keep tenant-scope-only for tenant resources.

### Option B - Add project/workspace-scoped custom role assignment and then migrate operational capabilities

This matches the live schema, avoids over-broad grants, and preserves tenant-scoped enforcement for organization resources. It lets SnapConsent model all-project roles, one-project roles, and one-workspace roles explicitly.

Recommendation: choose this path.

### Option C - Keep capture/review/workflow/correction fixed-role/system-reviewer only

This could be acceptable for a short V1 speed decision, especially for reviewer access, but it leaves the old model relevant and delays the capability migration. It also does not solve custom operational delegation.

Recommendation: acceptable only as a defer decision, not the main migration path.

### Option D - Build a generic effective permission engine now

The current codebase uses surface-specific helpers with important state-machine and target-shape checks. A broad generic engine would be high-risk unless constrained carefully. The safer foundation is a scoped capability resolver that computes effective custom-role capabilities by scope, then each surface keeps its domain-specific checks.

Recommendation: defer/reject as a broad engine. Build a narrow resolver foundation instead.

## Recommended roadmap

1. Feature 093 - Project/Workspace Custom Role Assignment Foundation
   - Owner/admin only.
   - Product-visible assignment of tenant custom roles at project/workspace scope.
   - Do not enforce operational capabilities yet beyond read/display where safe.

2. Feature 094 - Scoped Capability Resolver Foundation
   - Add a typed resolver for effective custom-role capabilities at tenant, project, and workspace scope.
   - Keep it separate from state-machine checks and fixed owner/admin bootstrap checks.
   - Preserve the current tenant-only helper for already migrated tenant resources until callers move deliberately.

3. Feature 095 - Capture Custom-Role Enforcement
   - Migrate normal capture surface, one-off invites, recurring participant/request creation, and asset upload/preflight/prepare/finalize.
   - Keep correction intake out of normal capture.

4. Feature 096 - Review Custom-Role Enforcement
   - Add `review.workspace` and `review.initiate_consent_upgrade_requests` enforcement for normal review surfaces.
   - Coexist with reviewer access assignments.

5. Feature 097 - Workflow/Finalization Custom-Role Enforcement
   - Migrate project finalization, project correction start, and workspace correction reopen.
   - Keep project-wide actions project-scoped, not workspace-scoped.

6. Feature 098 - Correction Custom-Role Enforcement
   - Migrate correction review, consent intake, and media intake with current correction state/provenance gates.

7. Feature 099 - Effective Access UI
   - Show why a user has access: fixed role, reviewer assignment, tenant custom role, project custom role, workspace custom role, photographer workspace assignment.

8. Feature 100 - Permission Helper Consolidation and Legacy Cleanup
   - Consolidate duplicate SQL/TypeScript predicates only after all operational slices have tests.

## Old model cleanup criteria

Fixed helpers that must remain:

- Owner/admin bootstrap and safety checks.
- Tenant membership existence and active tenant resolution.
- Role administration owner/admin checks for custom-role editor, custom-role assignment, and reviewer-access management.
- Public token authorization helpers.
- Release snapshot authorization and immutable Media Library access checks.

Helpers that can be deprecated only after migration:

- `canCaptureSelectedProject` and `canReviewSelectedProject` as broad fixed-role booleans for operational custom-role enforcement.
- Direct use of `assertCanCaptureWorkspaceAction` and `assertCanReviewWorkspaceAction` by migrated routes, once scoped capability checks coexist or replace them.
- SQL helpers that encode fixed-only capture/review access, after RLS and route tests prove scoped custom role behavior.

SQL helpers to consolidate later:

- Repeated tenant custom-role capability allowlist helpers from migrations 085-089.
- Project/workspace access helpers that currently combine fixed owner/admin, reviewer access, photographer assignment, and selected custom-role checks.
- Media Library custom-role helper duplication, only after behavior remains tested.

Tests required before cleanup:

- Resolver tests for tenant/project/workspace custom-role assignments, revoked assignments, archived roles, cross-tenant assignments, and wrong-scope assignments.
- Route and service tests for each capture, review, workflow, and correction action.
- RLS/RPC tests for the SQL helper layer.
- Regression tests proving tenant-scoped organization resources ignore project/workspace assignments.
- Tests proving public token flows do not require membership/custom-role permissions.
- Tests proving project-scoped reviewer access and custom-role review access coexist without expanding Media Library access.

Reviewer access:

- Remains special until a later explicit feature decides to migrate or replace it.
- Cleanup should not remove system reviewer assignments as part of custom-role operational enforcement.

Photographer workspace assignment:

- Remains special for now.
- It can eventually be represented by workspace-scoped custom roles, but only after capture migration, effective access UI, and a migration plan for existing project workspaces.

## Risks and tradeoffs

- Tenant-scoped operational roles are powerful. They may be useful for "all projects capture manager" or "all projects reviewer", but should be opt-in semantics, not an accidental side effect.
- Project-scoped review/correction roles must still respect workspace state and release/correction state. Capability checks cannot replace state-machine checks.
- Workspace-scoped workflow permissions are not all equivalent. Reopen workspace for correction can be workspace-scoped; finalize project and start correction should not be.
- Reviewer access and custom-role review access may overlap. The first enforcement slice should treat either path as sufficient, then later UI can explain both.
- SQL and TypeScript helpers are not fully consolidated today. Each migration slice needs matching tests to prevent drift.
- Existing tests intentionally prove wrong-scope custom role assignments do not affect tenant-only features; future scoped enforcement must update only operational tests/surfaces that are intentionally migrated.

## Explicit open decisions for the plan phase

- Should tenant-scoped capture/review/correction custom roles be enabled in the first operational slices as all-project/all-workspace grants, or should initial enforcement require project/workspace assignment only?
- Should `review.initiate_consent_upgrade_requests` authorize correction-mode upgrade requests, or should correction-mode upgrade requests require `correction.consent_intake` only?
- Should workspace validation/needs-changes/reopen before finalization remain under `review.workspace`, or should a future workflow capability be introduced later? Feature 092 does not add keys.
- Should project-scoped `project_workspaces.manage` include access to list assignable photographers for that project only, and should it list all projects where the assignment applies?
- Should scoped custom-role assignment be available for all custom role definitions immediately, or should the UI restrict assignment scopes based on the capabilities in the role?
- Should fixed photographers retain automatic workspace capture access after scoped custom roles ship, or should a later migration convert photographer workspace assignment into workspace-scoped custom role assignment?
- How should effective access UI present overlapping fixed role, reviewer assignment, photographer workspace assignment, and custom-role assignment without implying role administration delegation?
