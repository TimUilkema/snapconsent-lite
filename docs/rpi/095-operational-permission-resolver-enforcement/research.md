# Feature 095 - Enforce Resolver Across Operational Routes Research

## Title and scope

Feature 095 is the research phase for migrating operational project and workspace authorization to the Feature 094 effective scoped permission resolver.

The scope is research only. No code, migrations, route handlers, helpers, UI, tests, or runtime authorization behavior were changed.

Feature 095 should migrate operational authorization for:

- capture and upload;
- review;
- workflow and finalization;
- correction.

The target rule is conjunctive:

1. The actor must have the required effective capability for the target project or workspace.
2. The requested action must still be allowed by the current project, workspace, workflow, correction, release, and provenance state.

Capability checks must not replace state-machine checks. State-machine checks must not replace capability checks.

## Inputs reviewed

Required context and workflow documents:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `UNCODEXIFY.md`
- `docs/rpi/README.md`
- `docs/rpi/SUMMARY.md`

Feature 092 through 094 RPI history:

- `docs/rpi/092-capability-scope-semantics-and-permission-migration-map/research.md`
- `docs/rpi/092-capability-scope-semantics-and-permission-migration-map/plan.md`
- `docs/rpi/093-scoped-custom-role-assignment-foundation/plan.md`
- `docs/rpi/094-effective-scoped-permission-resolver-foundation/research.md`
- `docs/rpi/094-effective-scoped-permission-resolver-foundation/plan.md`

Prior workflow, capture, review, and correction RPI history:

- `docs/rpi/055-project-participants-and-mixed-consent-intake/research.md`
- `docs/rpi/055-project-participants-and-mixed-consent-intake/plan.md`
- `docs/rpi/060-project-unresolved-face-review-queue/research.md`
- `docs/rpi/060-project-unresolved-face-review-queue/plan.md`
- `docs/rpi/067-consent-scope-state-and-upgrade-requests/research.md`
- `docs/rpi/067-consent-scope-state-and-upgrade-requests/plan.md`
- `docs/rpi/070-tenant-rbac-and-organization-user-management-foundation/research.md`
- `docs/rpi/070-tenant-rbac-and-organization-user-management-foundation/plan.md`
- `docs/rpi/072-project-staffing-photographer-scoped-capture-workspaces-and-bounded-project-workflow-permissions/research.md`
- `docs/rpi/072-project-staffing-photographer-scoped-capture-workspaces-and-bounded-project-workflow-permissions/plan.md`
- `docs/rpi/073-workspace-handoff-and-project-finalization-foundation/research.md`
- `docs/rpi/073-workspace-handoff-and-project-finalization-foundation/plan.md`
- `docs/rpi/075-project-correction-and-re-release-foundation/research.md`
- `docs/rpi/075-project-correction-and-re-release-foundation/plan.md`
- `docs/rpi/076-correction-consent-intake-and-authorization-updates/research.md`
- `docs/rpi/076-correction-consent-intake-and-authorization-updates/plan.md`
- `docs/rpi/079-project-correction-media-intake-and-release-asset-additions/research.md`
- `docs/rpi/079-project-correction-media-intake-and-release-asset-additions/plan.md`

Live source inspected as source of truth:

- `src/lib/tenant/effective-permissions.ts`
- `src/lib/tenant/custom-role-scope-effects.ts`
- `supabase/migrations/20260501130000_094_scoped_custom_role_capability_helper.sql`
- `tests/feature-094-effective-scoped-permission-resolver-foundation.test.ts`
- `src/lib/projects/project-workspace-request.ts`
- `src/lib/tenant/permissions.ts`
- `src/lib/projects/project-workspaces-service.ts`
- `src/lib/projects/project-workflow-service.ts`
- `src/lib/projects/project-workflow-route-handlers.ts`
- capture, review, workflow, correction, public token, and Media Library routes under `src/app`
- `src/lib/projects/project-participants-route-handlers.ts`
- `src/lib/projects/project-participants-service.ts`
- `src/lib/projects/project-consent-upgrade-route-handlers.ts`
- `src/lib/projects/project-consent-upgrade-service.ts`
- `src/lib/assets/project-correction-asset-route-handlers.ts`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/components/projects/project-workflow-controls.tsx`
- migrations defining project workspace, reviewer assignment, correction, release, and Feature 094 SQL helpers
- tests for Features 055, 060, 067, 070, 073, 075, 076, 079, 082, 093, 094, upload, review, release, and Media Library behavior

## Source-of-truth notes and drift found

Live code, migrations, and tests are authoritative over RPI documents.

Observed drift and current-state notes:

- `docs/rpi/093-scoped-custom-role-assignment-foundation/research.md` is not present in the live tree. The Feature 093 plan and Feature 094 documents are present.
- Feature 094 added the TypeScript effective resolver and the SQL custom-role capability helper, but no operational route imports `src/lib/tenant/effective-permissions.ts` yet. Live operational helpers still use `src/lib/tenant/permissions.ts`.
- The Feature 094 SQL migration added a public wrapper for `current_user_has_scoped_custom_role_capability`, although Feature 094 planning preferred avoiding a public wrapper unless RLS needed it.
- No migration with `079` in the filename is present. Correction media intake is present in live code and tests, using `src/lib/assets/project-correction-asset-route-handlers.ts` and existing asset tables.
- The worktree already contained many unrelated local changes and untracked feature folders before this research document was added. This research phase leaves those files untouched.
- `rg` was not available in this environment, so searches used PowerShell recursion and `Select-String`.

## Effective resolver integration findings

### TypeScript resolver shape

`src/lib/tenant/effective-permissions.ts` exports the central resolver API:

- `resolveEffectiveCapabilities`
- `userHasEffectiveCapability`
- `assertEffectiveCapability`
- `resolveEffectiveTenantCapabilities`
- `resolveEffectiveProjectCapabilities`
- `resolveEffectiveWorkspaceCapabilities`
- `assertEffectiveTenantCapability`
- `assertEffectiveProjectCapability`
- `assertEffectiveWorkspaceCapability`

Base input shape:

- `supabase`
- `tenantId`
- `userId`
- `scope`: `tenant`, `project`, or `workspace`
- optional `capabilityKey`
- optional `adminSupabase`

Project convenience helpers add `projectId`. Workspace convenience helpers add `projectId` and `workspaceId`.

Resolution output includes:

- `tenantId`
- `userId`
- `scope`
- `projectId`
- `workspaceId`
- `sources`
- `capabilities`
- `denied`

Source metadata values currently modeled:

- `fixed_role`
- `system_reviewer_assignment`
- `photographer_workspace_assignment`
- `custom_role_assignment`

Denial/error codes currently modeled:

- `no_tenant_membership`
- `project_not_found`
- `workspace_not_found`
- `capability_not_supported_at_scope`
- `not_granted`
- `lookup_failed`
- assertion failures throw `effective_capability_scope_forbidden` or `effective_capability_forbidden`

The resolver validates project/workspace tenant ownership before granting scoped capability. That validation is a useful replacement for repeated ad hoc scope checks, but Feature 095 must still preserve route-specific row scoping and state checks.

### Sources modeled by the resolver

Fixed owner/admin:

- Owner and admin capabilities come from the Feature 092 capability catalog and scope matrix.
- Owner/admin grant operational capability where the matrix supports the requested scope.
- Tenant-scoped operational capabilities marked `defer` are not granted from custom tenant roles, but fixed owner/admin still retain their established operational power through fixed-role handling.

Fixed reviewer:

- Fixed reviewer role alone does not grant operational review, workflow, or correction capability.
- Reviewer access must come from tenant-wide or project reviewer assignment.
- Tenant reviewer assignment grants reviewer operational capabilities across projects/workspaces and still grants Media Library access.
- Project reviewer assignment grants project/workspace review, workflow, and correction capabilities within the assigned project, but does not grant Media Library access.

Fixed photographer:

- Fixed photographer role alone does not grant all capture globally.
- Photographer workspace assignment grants workspace capture capabilities for the exact assigned workspace:
  - `capture.workspace`
  - `capture.create_one_off_invites`
  - `capture.create_recurring_project_consent_requests`
  - `capture.upload_assets`

Custom roles:

- Custom role assignments are additive at tenant, project, or workspace scope.
- Tenant operational custom role support is `defer`, so tenant custom roles do not grant the Feature 095 operational capabilities.
- Project and workspace custom roles can grant operational capabilities where `custom-role-scope-effects.ts` marks the capability as `yes`.
- System role definitions, archived roles, revoked assignments, inactive memberships, and wrong-tenant/wrong-scope rows are ignored.

### SQL helper shape

`supabase/migrations/20260501130000_094_scoped_custom_role_capability_helper.sql` adds:

- `app.current_user_has_scoped_custom_role_capability(p_tenant_id uuid, p_capability_key text, p_project_id uuid default null, p_workspace_id uuid default null)`
- `public.current_user_has_scoped_custom_role_capability(...)`

This SQL helper is custom-role-only. It does not model fixed owner/admin, reviewer assignments, or photographer assignment. Operational SQL/RLS helpers must compose it with the existing fixed/system sources instead of replacing those sources.

## Current operational authorization model

Current live operational authorization is still mostly fixed-role and reviewer-assignment based. Project/workspace custom roles exist but do not currently unlock operational routes or UI.

| Source | Capture | Review | Workflow/finalization | Correction |
| --- | --- | --- | --- | --- |
| Fixed owner | Allowed where state permits. Old helpers grant capture broadly at project/workspace. | Allowed where state permits. Old helpers grant review broadly. | Allowed through old review/project helpers where state permits. | Allowed through old review/correction helpers where correction state permits. |
| Fixed admin | Same as owner. | Same as owner. | Same as owner. | Same as owner. |
| Fixed reviewer with no assignment | Denied. | Denied by Feature 082 reviewer assignment enforcement. | Denied because workflow/finalization uses review authorization. | Denied because correction uses review authorization. |
| Fixed reviewer with tenant-wide assignment | Denied capture. | Allowed across tenant projects/workspaces where state permits. | Allowed across tenant projects through review/project helpers where state permits. | Allowed across tenant projects/workspaces where correction state permits. |
| Fixed reviewer with project assignment | Denied capture. | Allowed inside assigned project where state permits. Does not grant Media Library. | Allowed inside assigned project through review/project helpers where state permits. | Allowed inside assigned project/workspaces where correction state permits. |
| Fixed photographer assigned to workspace | Allowed for exact assigned workspace where state permits. | Denied. | Handoff is allowed through capture path; review/finalize/correction denied. | Denied except public-token submissions created from correction consent intake are token-scoped, not photographer-scoped. |
| Fixed photographer not assigned | Denied. Project/workspace access is hidden or unavailable. | Denied. | Denied. | Denied. |
| Tenant custom role assignee | Ignored for operational capabilities. Tenant operational support is `defer`. | Ignored for operational capabilities. | Ignored for operational capabilities. | Ignored for operational capabilities. |
| Project custom role assignee | Ignored by current operational helpers and UI. | Ignored by current operational helpers and UI. | Ignored by current operational helpers and UI. | Ignored by current operational helpers and UI. |
| Workspace custom role assignee | Ignored by current operational helpers and UI. | Ignored by current operational helpers and UI. | Ignored by current operational helpers and UI. | Ignored by current operational helpers and UI. |

Target Feature 095 behavior should preserve every allowed/denied fixed-source behavior above while adding project/workspace custom-role grants through the Feature 094 resolver.

## Operational route/action inventory

The table below groups routes by operational action. Most route handlers already centralize authorization through `project-workspace-request.ts` or `project-workflow-route-handlers.ts`; that is the main opportunity for a low-churn migration.

### Capture and upload

| Action | Route path | Service/helper | Current authorization | Target scope | Required capability after migration | State/provenance checks to preserve | SQL/RLS involved | Current test coverage | UI gating needed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Open capture/review workspace data and list assets | `GET /api/projects/[projectId]/assets` and project page data | route-local `resolveWorkspacePermissions`; page uses `resolveProjectPermissions` and `resolveProjectWorkspaceSelection` | old `canCaptureProjects || canReviewProjects`; workspace visibility from old fixed photographer/reviewer access | workspace | read/open should use effective workspace access. Capture surface requires `capture.workspace`; review surface requires `review.workspace`; shared asset list can accept either relevant effective workspace capability | no mutation state; still tenant/project/workspace scoped | `assets` select through `app.current_user_can_access_project_workspace`; page `projects` and `project_workspaces` select through access helpers | asset/page tests and workflow UI tests | Yes |
| Create one-off invite | `POST /api/projects/[projectId]/invites` | route calls `requireWorkspaceCaptureMutationAccessForRequest`; correction branch calls `requireWorkspaceCorrectionConsentIntakeAccessForRequest`; service `createInviteWithIdempotency` | normal old capture; correction old review/correction consent path | workspace | normal: `capture.create_one_off_invites`; correction: `correction.consent_intake` | idempotency key; active project; not finalized for normal; workspace `active` or `needs_changes`; correction requires finalized project, correction open, reopened workspace in current correction cycle, provenance snapshot | `subject_invites` insert currently uses generic capture helper; admin service writes after app check | invite route tests, Feature 076 correction tests | Yes, invite form/actions |
| Revoke one-off invite | `POST /api/projects/[projectId]/invites/[inviteId]/revoke` | route loads invite row then uses `requireWorkspaceCaptureMutationAccessForRow` or `requireWorkspaceCorrectionConsentIntakeAccessForRow` | normal old capture; correction old review/correction consent path | workspace from row | normal: `capture.create_one_off_invites`; correction: `correction.consent_intake` | invite must be active and unused; correction provenance must match active cycle; pending upgrade request cancellation must stay consistent | `subject_invites` update currently generic capture; `project_consent_upgrade_requests` update for linked pending upgrades | invite/revoke and correction provenance tests | Yes, invite action buttons |
| Add recurring profile participant | `POST /api/projects/[projectId]/profile-participants` | `handleAddProjectProfileParticipantPost`; normal `requireWorkspaceCaptureMutationAccessForRequest`; correction `requireWorkspaceCorrectionConsentIntakeAccessForRequest` | normal old capture; correction old review/correction consent path | workspace | normal: `capture.create_recurring_project_consent_requests`; correction: `correction.consent_intake` | idempotent participant insert; active project; workspace capture state or correction reopened current cycle | `project_profile_participants` insert currently generic capture; admin/client mix in participant service | Feature 055 route/UI, Feature 076 | Yes, participants panel |
| Create recurring project consent request | `POST /api/projects/[projectId]/profile-participants/[participantId]/consent-request` | `handleCreateProjectProfileConsentRequestPost`; service `createProjectProfileConsentRequest` | normal old capture; correction old review/correction consent path | workspace and participant row | normal: `capture.create_recurring_project_consent_requests`; correction: `correction.consent_intake` | idempotency key; participant/workspace/project match; active profile; visible published template; RPC idempotency; correction provenance update | `recurring_profile_consent_requests`, `recurring_profile_consents`, `project_profile_participants`; RPC `create_recurring_profile_project_consent_request`; existing RLS uses capture/access helpers | Feature 055, Feature 076, recurring consent tests | Yes, participant consent actions |
| Normal asset create | `POST /api/projects/[projectId]/assets` | route calls `requireWorkspaceCaptureMutationAccessForRequest`; service `createAssetWithIdempotency` | old capture mutation | workspace | `capture.upload_assets` | idempotency key; active project; not finalized; workspace `active` or `needs_changes`; duplicate policy | `assets` insert currently generic capture; service writes with admin after app check | upload/asset tests | Yes, upload panel |
| Normal asset duplicate/preflight | `POST /api/projects/[projectId]/assets/preflight` | route calls `requireWorkspaceCaptureMutationAccessForRequest`; duplicate lookup | old capture mutation | workspace | `capture.upload_assets` | active project; not finalized; workspace `active` or `needs_changes`; duplicate policy | `assets` read/access policy | upload tests | Yes |
| Normal batch asset prepare/finalize | `POST /api/projects/[projectId]/assets/batch/prepare`; `POST /api/projects/[projectId]/assets/batch/finalize` | route calls `requireWorkspaceCaptureMutationAccessForRequest`; asset batch services | old capture mutation | workspace | `capture.upload_assets` | idempotency; active project; not finalized; workspace `active` or `needs_changes`; finalize must preserve asset/project/workspace ownership | `assets` insert/update currently generic capture; service writes with admin after app check | upload/resumability tests | Yes |
| Normal single asset finalize | `POST /api/projects/[projectId]/assets/[assetId]/finalize` | route calls `requireWorkspaceCaptureMutationAccessForRow`; `finalizeAsset` | old capture mutation from asset row workspace | workspace from asset row | `capture.upload_assets` | asset row must match project/workspace; active project; not finalized; workspace `active` or `needs_changes`; asset type/status invariants | `assets` update currently generic capture; matching job side effects | upload/asset tests | Yes |

### Review

| Action | Route path | Service/helper | Current authorization | Target scope | Required capability after migration | State/provenance checks to preserve | SQL/RLS involved | Current test coverage | UI gating needed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Read preview faces | `GET /api/projects/[projectId]/assets/[assetId]/preview-faces` | route uses `requireWorkspaceReviewAccessForRow` | old review access | workspace from asset row | `review.workspace` | asset/project/workspace scope | face materialization and asset read policies through access/review helpers | Feature 044, 045, 047, 060 | Yes, review panels |
| Read preview face/link candidates | `GET /api/projects/[projectId]/assets/[assetId]/preview-link-candidates`; `GET /api/projects/[projectId]/assets/[assetId]/whole-asset-candidates`; consent matchable routes | route uses `requireWorkspaceReviewAccessForRow` | old review access | workspace | `review.workspace` | asset/consent/project/workspace scope; only current eligible candidates | face/assignee/link tables select through workspace access | Feature 044, 060 | Yes |
| Read preview/manual/whole-asset link state | `GET /api/projects/[projectId]/assets/[assetId]/preview-links`; manual link state routes; whole-asset link reads | route uses `requireWorkspaceReviewAccessForRow` | old review access | workspace | `review.workspace` | asset/project/workspace scope | link/suppression tables select through access helpers | Feature 044, 045, 047 | Yes |
| Create review session | `POST /api/projects/[projectId]/consents/[consentId]/review-sessions` | route uses `requireWorkspaceCorrectionReviewMutationAccessForRow` | normal old review; finalized/correction old review plus correction state | workspace from consent row | normal: `review.workspace`; correction: `correction.review` | unfinalized normal review mutation state; finalized correction open and workspace handed off | `face_review_sessions`, `face_review_session_items` insert/update currently review helper | Feature 060 and correction tests | Yes |
| Review session item action | `POST /api/projects/[projectId]/consents/[consentId]/review-sessions/[sessionId]/items/[itemId]/actions` | route uses `requireWorkspaceCorrectionReviewMutationAccessForRow` | normal old review; correction old review/correction state | workspace | normal: `review.workspace`; correction: `correction.review` | session/item/project/workspace match; normal/correction review mutation state; idempotent outcome behavior | face review session tables update through review helper | Feature 060, correction tests | Yes |
| Face assignment/link/unlink | `POST/DELETE /api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/assignment` and preview links | route uses correction-aware review mutation helper | normal old review; correction old review/correction state | workspace from asset row | normal: `review.workspace`; correction: `correction.review` | materialization/current face scope; asset/workspace scope; normal/correction review mutation state | face link/suppression tables insert/update/delete currently review helper | Feature 044, 045, 060 | Yes |
| Manual face creation | `POST /api/projects/[projectId]/assets/[assetId]/manual-faces` | route uses correction-aware review mutation helper | normal old review; correction old review/correction state | workspace | normal: `review.workspace`; correction: `correction.review` | asset must be photo/current materialization rules; normal/correction review mutation state | manual face/materialization tables through review helper | Feature 047 | Yes |
| Hide/block/suppress faces | `POST/DELETE /api/projects/[projectId]/assets/[assetId]/hidden-faces/[assetFaceId]`; blocked faces route; suppression routes | route uses correction-aware review mutation helper | normal old review; correction old review/correction state | workspace | normal: `review.workspace`; correction: `correction.review` | current materialization and face scope; normal/correction review mutation state | hidden/blocked/suppression tables through review helper | Feature 045 | Yes |
| Whole-asset links | `POST/DELETE /api/projects/[projectId]/assets/[assetId]/whole-asset-links` | route uses correction-aware review mutation helper | normal old review; correction old review/correction state | workspace | normal: `review.workspace`; correction: `correction.review` | asset and assignee scope; normal/correction review mutation state | whole-asset link tables through review helper | Feature 044, 060 | Yes |
| Consent asset manual links | `POST/DELETE /api/projects/[projectId]/consents/[consentId]/assets/links` | route uses correction-aware review mutation helper | normal old review; correction old review/correction state | workspace | normal: `review.workspace`; correction: `correction.review` | consent and asset workspace/project match; normal/correction review mutation state | consent asset link tables through review helper | Feature 044, 060 | Yes |
| Consent headshot replacement | `POST /api/projects/[projectId]/consents/[consentId]/headshot` | route uses `requireWorkspaceReviewMutationAccessForRow` | old normal review mutation | workspace | `review.workspace` | current UI hides in correction; preserve normal review mutation state | consent/headshot asset update paths | Feature 067/UI | Yes |
| Normal consent upgrade request | `POST /api/projects/[projectId]/consents/[consentId]/upgrade-request` | `handleCreateProjectConsentUpgradeRequestPost`; normal uses `requireWorkspaceReviewMutationAccessForRow`; correction branch uses correction consent intake helper | normal old review; correction old review/correction consent path | workspace | normal: `review.initiate_consent_upgrade_requests`; correction: `correction.consent_intake` | idempotency; prior consent still valid; target template visible/published/same family/newer; pending upgrade reuse/supersede/cancel; correction provenance when correction mode | `project_consent_upgrade_requests`, `subject_invites`; insert/update currently review helper for upgrade request and capture/review paths for invite | Feature 067, Feature 076 | Yes, upgrade form |

### Workflow and finalization

| Action | Route path | Service/helper | Current authorization | Target scope | Required capability after migration | State/provenance checks to preserve | SQL/RLS involved | Current test coverage | UI gating needed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Workspace handoff | workspace workflow route under `src/app/api/projects/[projectId]/workspaces/...` | `handleWorkspaceWorkflowTransitionPost`; handoff uses `requireWorkspaceCaptureAccessForRequest`; service `applyWorkspaceWorkflowTransition` | old capture access | workspace | likely `capture.workspace` | project active/unarchived/unfinalized; workspace transition from `active` or `needs_changes` to `handed_off`; retry-safe transition semantics | `project_workspaces` update is performed after app authorization, with policies still relevant for route reads | Feature 073 workflow routes/UI | Yes, workflow controls |
| Workspace validation | workspace workflow route | same handler; validation uses `requireWorkspaceReviewAccessForRequest` | old review access | workspace | normal: `review.workspace`; correction-open validation may need `correction.review` as an open decision | project not archived; normal unfinalized review state; validation blockers clear; correction-open validation allowed by service when project is finalized and correction is open | `project_workspaces` update; validation reads blockers from review/capture tables | Feature 073, 075 | Yes |
| Workspace needs changes | workspace workflow route | same handler; uses `requireWorkspaceReviewAccessForRequest` | old review access | workspace | normal: `review.workspace`; correction-open behavior should be checked in plan | project not archived; allowed transition from handed off/validated according to service; workspace becomes `needs_changes` | `project_workspaces` update | Feature 073 | Yes |
| Workspace reopen before finalization | workspace workflow route | same handler; uses `requireWorkspaceReviewAccessForRequest` | old review access | workspace | `review.workspace` | project active/unfinalized; allowed transition from validated back to active/needs state as service allows | `project_workspaces` update | Feature 073 | Yes |
| Project finalization | `POST /api/projects/[projectId]/finalize` | `handleProjectFinalizePost`; currently `resolveAccessibleProjectWorkspaces` plus `assertCanReviewProjectAction`; service `finalizeProject`; release `ensureProjectReleaseSnapshot` | old project review access | project | `workflow.finalize_project` | project unarchived; workflow state `ready_to_finalize` or `correction_ready_to_finalize`; correction reopened workspaces complete; idempotent already-finalized response; release snapshot repair/retry behavior | project row update; release snapshot tables; Media Library indexing | Feature 073, 074, 075 | Yes |
| Start project correction | `POST /api/projects/[projectId]/correction/start` | `handleProjectCorrectionStartPost`; currently project review access; service `startProjectCorrection` | old project review access | project | `workflow.start_project_correction` | project active and finalized; published release exists for finalized timestamp; idempotent if already open; source release snapshot stored | project correction columns; release lookup | Feature 075 | Yes |
| Reopen workspace for correction | `POST /api/projects/[projectId]/workspaces/[workspaceId]/correction-reopen` | `handleWorkspaceCorrectionReopenPost`; currently `requireWorkspaceReviewAccessForRequest`; service `reopenWorkspaceForCorrection` | old review access | workspace or project+workspace | `workflow.reopen_workspace_for_correction` | project finalized; correction open; workspace validated; idempotent when already reopened in current correction cycle | `project_workspaces` correction reopened timestamps | Feature 075, UI workflow tests | Yes |

### Correction

| Action | Route path | Service/helper | Current authorization | Target scope | Required capability after migration | State/provenance checks to preserve | SQL/RLS involved | Current test coverage | UI gating needed |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Correction review of assets/faces/sessions | same review mutation routes when project is finalized and correction is open | `requireWorkspaceCorrectionReviewMutationAccessForRow` | old review access plus correction state | workspace | `correction.review` | project finalized; correction open; workspace handed off for review; row/workspace/project match | review tables and asset/face tables currently use generic review policies | Feature 075, 076, 079 and review tests | Yes |
| Correction consent intake through one-off invites | normal invite routes in correction mode | `requireWorkspaceCorrectionConsentIntakeAccessForRequest/Row` | old review access plus correction consent state | workspace | `correction.consent_intake` | finalized project; correction open; workspace reopened in current cycle; invite/request provenance matches active correction cycle; idempotency | `subject_invites`, pending upgrade requests | Feature 076 | Yes |
| Correction consent intake through recurring participants/requests | participant routes in correction mode | correction consent intake helpers | old review access plus correction consent state | workspace | `correction.consent_intake` | same correction-open/reopened/provenance rules; participant/request idempotency | `project_profile_participants`, recurring profile request/consent tables | Feature 076 | Yes |
| Correction upgrade request | `POST /api/projects/[projectId]/consents/[consentId]/upgrade-request` in correction mode | correction consent intake helper | old review access plus correction consent state | workspace | `correction.consent_intake` | target template checks plus correction provenance | `project_consent_upgrade_requests`, `subject_invites` | Feature 067, 076 | Yes |
| Correction media preflight/prepare/finalize | `POST /api/projects/[projectId]/correction/assets/preflight`; `.../batch/prepare`; `.../batch/finalize` | `src/lib/assets/project-correction-asset-route-handlers.ts`; `requireWorkspaceCorrectionMediaIntakeAccessForRequest` | old review access plus correction media state | workspace | `correction.media_intake` | finalized project; correction open; workspace reopened in current cycle; duplicate/idempotency behavior; normal capture remains closed | `assets` read/insert/update currently generic capture policies, while route uses service role after app authorization | Feature 079 | Yes |

## Central helper migration strategy

The route inventory supports the expected direction: update central TypeScript helpers and workflow route helpers rather than rewriting every route independently.

### Helpers that should use `assertEffectiveWorkspaceCapability`

`src/lib/projects/project-workspace-request.ts` is the primary migration point.

These helpers should be migrated to effective workspace capability checks:

- `requireWorkspaceCaptureAccessForRequest`
- `requireWorkspaceCaptureAccessForRow`
- `requireWorkspaceCaptureMutationAccessForRequest`
- `requireWorkspaceCaptureMutationAccessForRow`
- `requireWorkspaceReviewAccessForRequest`
- `requireWorkspaceReviewAccessForRow`
- `requireWorkspaceReviewMutationAccessForRequest`
- `requireWorkspaceReviewMutationAccessForRow`
- `requireWorkspaceCorrectionReviewMutationAccessForRequest`
- `requireWorkspaceCorrectionReviewMutationAccessForRow`
- `requireWorkspaceCorrectionConsentIntakeAccessForRequest`
- `requireWorkspaceCorrectionConsentIntakeAccessForRow`
- `requireWorkspaceCorrectionMediaIntakeAccessForRequest`
- `requireWorkspaceCorrectionMediaIntakeAccessForRow`

The row helpers should keep loading the scoped row and asserting row/project/workspace match before authorizing the action. Effective capability confirms the user can act at the resolved workspace; it does not prove that the row belongs to that workspace.

The correction helpers should no longer reuse normal review permission as their authorization source. They should use:

- `correction.review` for correction review mutations;
- `correction.consent_intake` for correction consent intake;
- `correction.media_intake` for correction media intake.

The normal capture/review mutation helper names can remain as compatibility wrappers, but their internals need either a route-supplied capability key or thin capability-specific wrappers. The existing generic capture mutation helper is too broad for Feature 095 because invite creation, recurring consent request creation, and uploads have separate capability keys.

Recommended helper pattern for the plan phase:

- keep current helper names where they represent broad access, for example `requireWorkspaceCaptureAccessForRequest` with `capture.workspace`;
- allow mutation helpers to accept an optional `capabilityKey` with the narrow route capability;
- add small named wrappers only where readability or SQL/RLS parity benefits, for example invite/upload helpers;
- preserve the current return shape so route code and tests do not need broad rewrites.

### Helpers that should use `assertEffectiveProjectCapability`

Project-level workflow/finalization authorization should move away from old project review authorization:

- `handleProjectFinalizePost` should require `workflow.finalize_project`.
- `handleProjectCorrectionStartPost` should require `workflow.start_project_correction`.

The route handlers currently use `resolveAccessibleProjectWorkspaces` and `assertCanReviewProjectAction`. That denies project custom-role users with only workflow capabilities. The plan should introduce a project-level authorization path that validates the project belongs to the active tenant and then calls `assertEffectiveProjectCapability`.

### Workspace workflow helpers

`handleWorkspaceWorkflowTransitionPost` currently branches:

- `handoff` uses capture access;
- all other transitions use review access.

Recommended migration:

- handoff: `capture.workspace`;
- normal validation, needs-changes, and pre-finalization reopen: `review.workspace`;
- workspace correction reopen: `workflow.reopen_workspace_for_correction`;
- correction-open validation of a reopened workspace needs an explicit plan decision: either keep it under `review.workspace` for parity with current reviewer assignments, or branch to `correction.review` because it is semantically correction review after finalization.

### Compatibility wrappers and route error semantics

Current route semantics depend on stable `HttpError` codes such as:

- `workspace_capture_forbidden`
- `workspace_review_forbidden`
- `project_review_forbidden`
- `workspace_correction_review_forbidden`
- `workspace_correction_consent_intake_forbidden`
- `workspace_correction_media_intake_forbidden`
- `project_not_found`
- `workspace_not_found`

The effective resolver throws generic effective capability errors. Central helpers should map those errors to the existing route-facing error codes so API clients and tests do not churn. The original resolver metadata can still be used in tests by directly calling the resolver, while route tests should assert stable route behavior.

### Source metadata exposure

Route helpers do not need to expose source metadata to client UI. Tests that need to prove a source path should call `resolveEffectiveWorkspaceCapabilities` or `resolveEffectiveProjectCapabilities` directly and assert `sources`.

If helper tests need to confirm that a route was allowed due to a custom role, they can set up the custom role assignment and assert the route succeeds. They should not require source metadata in the route response.

### Workspace selection and visibility

`src/lib/projects/project-workspaces-service.ts` currently relies on `resolveAccessibleProjectWorkspaces`, which uses the old fixed/reviewer model. This blocks project/workspace custom-role users before they can reach route-level authorization.

Feature 095 needs a minimal effective-access workspace listing path for operational users. It should include workspaces where the user has at least one operational effective capability relevant to the project page. It must not enable tenant-scoped deferred operational custom roles.

## SQL/RLS migration strategy findings

Feature 095 needs SQL/RLS parity. TypeScript-only enforcement would let the UI and some service-role writes work, but authenticated reads/RPCs and direct RLS-backed inserts would drift from application behavior.

### Current SQL helpers

Relevant existing helpers include:

- `app.current_user_can_access_project`
- `app.current_user_can_access_project_workspace`
- `app.current_user_can_capture_project`
- `app.current_user_can_capture_project_workspace`
- `app.current_user_can_review_project`
- `app.current_user_can_review_project_workspace`
- `app.current_user_has_tenant_wide_reviewer_access`
- `app.current_user_has_project_reviewer_access`
- `app.current_user_has_workspace_reviewer_access`
- `app.current_user_has_scoped_custom_role_capability`

Feature 072 defined capture/review/access helpers for fixed roles and photographer assignment. Feature 082 redefined access/review helpers to require reviewer assignments for reviewer access and preserve photographer workspace access. Feature 094 added the custom-role SQL building block, but existing operational RLS helpers do not compose it yet.

### RLS policies depending on generic helpers

Important tables with policies tied to access/capture/review helpers include:

- `projects`
- `project_workspaces`
- `subject_invites`
- `subjects`
- `consents`
- `project_profile_participants`
- `recurring_profile_consent_requests`
- `recurring_profile_consents`
- `assets`
- `asset_consent_links`
- face materialization/review/link/suppression tables
- hidden/blocked/manual face tables
- `project_consent_scope_signed_projections`
- `project_consent_upgrade_requests`
- release and Media Library tables through separate release/media-library helpers

### SQL composition rule

Operational SQL helpers should combine:

- fixed owner/admin sources;
- system reviewer assignments;
- photographer workspace assignment where appropriate;
- `app.current_user_has_scoped_custom_role_capability(...)`.

The Feature 094 SQL helper is custom-role-only and should be used as a building block, not as the full answer.

### Existing helpers vs new wrappers

Existing generic helpers are too broad for some Feature 095 operations.

For read/open access:

- extend `app.current_user_can_access_project` and `app.current_user_can_access_project_workspace` so project/workspace custom-role users can see the project/workspace needed for authorized operations.
- The exact access predicate should be conservative: fixed owner/admin, assigned photographer, reviewer assignment, or a scoped custom role with at least one supported operational capability for that project/workspace.

For broad capture/review compatibility:

- `app.current_user_can_capture_project_workspace` can include `capture.workspace` plus the old owner/admin/photographer sources, but it should not be used for all mutations where a narrower capability exists.
- `app.current_user_can_review_project_workspace` can include `review.workspace` plus old owner/admin/reviewer-assignment sources.
- `app.current_user_can_review_project` can include `review.workspace`, workflow project capabilities, and correction project capabilities only if its name remains a broad review access helper. A narrower project wrapper is cleaner for workflow.

For mutation-specific RLS clarity, prefer new wrappers:

- `app.current_user_can_create_one_off_invites(p_tenant_id, p_project_id, p_workspace_id)`
- `app.current_user_can_create_recurring_project_consent_requests(p_tenant_id, p_project_id, p_workspace_id)`
- `app.current_user_can_upload_project_assets(p_tenant_id, p_project_id, p_workspace_id)`
- `app.current_user_can_initiate_consent_upgrade_requests(p_tenant_id, p_project_id, p_workspace_id)`
- `app.current_user_can_finalize_project(p_tenant_id, p_project_id)`
- `app.current_user_can_start_project_correction(p_tenant_id, p_project_id)`
- `app.current_user_can_reopen_workspace_for_correction(p_tenant_id, p_project_id, p_workspace_id)`
- `app.current_user_can_review_correction_workspace(p_tenant_id, p_project_id, p_workspace_id)`
- `app.current_user_can_perform_correction_consent_intake(p_tenant_id, p_project_id, p_workspace_id)`
- `app.current_user_can_perform_correction_media_intake(p_tenant_id, p_project_id, p_workspace_id)`

These wrappers keep policy intent visible and reduce the risk that `capture.workspace` accidentally grants invite creation or asset upload.

### Policy updates to consider

Specific policy migrations should follow the table-level operation:

- `subject_invites` insert/update should use one-off invite or correction consent intake wrappers, not generic capture.
- `project_profile_participants` insert and project recurring request creation should use recurring project consent request or correction consent intake wrappers.
- `assets` normal insert/update should use upload wrapper; correction asset routes may use service role but RLS parity should still support correction media intake if authenticated writes are added or refactored.
- review mutation tables should use `review.workspace` for normal review and `correction.review` for correction-mode rows where the database can distinguish the mode, or keep review wrapper as a backstop while TypeScript enforces correction branch. The database has limited state/provenance context per row, so not every correction distinction belongs in RLS.
- `project_consent_upgrade_requests` insert/update should use normal upgrade capability or correction consent intake, depending on request provenance/source where available.
- workflow table updates should use workflow wrappers, but service functions still need state checks because RLS cannot encode all workflow transition invariants cleanly.

### Service-role and RLS alignment

Many operational writes use an admin client after application authorization. Examples include invite creation, asset creation/finalization, correction media intake, workflow transitions, and release snapshot creation. RLS still matters because:

- route helper row reads often use the authenticated client;
- page data and workspace selection are RLS-backed;
- some services and RPCs rely on authenticated access;
- future refactors should not silently weaken enforcement;
- tests should prove SQL and TypeScript remain aligned.

## Capability granularity recommendations

Use the most specific existing capability key where one exists. Do not add keys.

Capture:

- `capture.workspace` should grant opening/using the normal capture workspace surface and workspace handoff.
- `capture.workspace` should not be treated as a generic write permission for one-off invites, recurring consent requests, or asset upload when a specific key exists.
- Create/revoke one-off invites should require `capture.create_one_off_invites`.
- Add recurring participants and create recurring project consent requests should require `capture.create_recurring_project_consent_requests`.
- Normal asset preflight, create, batch prepare, batch finalize, and single finalize should require `capture.upload_assets`.

Review:

- Opening/using the normal review surface should require `review.workspace`.
- Review session create/action, preview face/candidate/link reads, face assignment, manual faces, hidden/blocked/suppressed faces, whole-asset links, and consent asset links should require `review.workspace` for normal unfinalized review.
- Normal consent upgrade request creation should require `review.initiate_consent_upgrade_requests`.

Workflow/finalization:

- Workspace handoff should stay aligned to capture and use `capture.workspace`.
- Workspace validation, needs-changes, and pre-finalization reopen should use `review.workspace`.
- Project finalization should require `workflow.finalize_project`.
- Project correction start should require `workflow.start_project_correction`.
- Workspace correction reopen should require `workflow.reopen_workspace_for_correction`.

Correction:

- Correction review should require `correction.review`.
- Correction consent intake should require `correction.consent_intake`.
- Correction media intake/upload should require `correction.media_intake`.
- Correction-mode upgrade requests should require `correction.consent_intake`, not normal `review.initiate_consent_upgrade_requests`.

## UI gating findings

`src/app/(protected)/projects/[projectId]/page.tsx` currently gates operational UI almost entirely with old booleans from `resolveProjectPermissions` and old workspace selection from `resolveProjectWorkspaceSelection`.

Current project page booleans include:

- `projectPermissions.canCaptureProjects`
- `projectPermissions.canReviewSelectedProject`
- `captureMutationsAllowed`
- `reviewSafeMutationsAllowed`
- `reviewConsentFlowMutationsAllowed`
- `correctionConsentMutationsAllowed`
- `correctionMediaIntakeAllowed`
- `consentIntakeActionsAllowed`

Current controls affected:

- export link and review panels;
- `ProjectWorkflowControls`;
- invite create/revoke controls;
- recurring participant and consent request controls;
- asset upload panel;
- consent upgrade request form;
- consent headshot replacement;
- consent asset matching panel;
- correction consent/media controls.

Feature 095 must update UI gating enough for project/workspace custom-role-authorized users to use the app. Without this, route authorization could succeed but users would not see the project, workspace, or controls.

Recommended minimal server-side page data:

- compute effective capability booleans once for the selected project/workspace;
- keep source metadata server-only and out of page props/components;
- retain existing state-derived booleans and combine them with effective capability booleans;
- update workspace selection/listing so a user with a relevant project/workspace effective capability can see the project/workspace.

Suggested boolean model:

- `canOpenCaptureWorkspace`: `capture.workspace`
- `canCreateOneOffInvites`: `capture.create_one_off_invites`
- `canCreateRecurringProjectConsentRequests`: `capture.create_recurring_project_consent_requests`
- `canUploadAssets`: `capture.upload_assets`
- `canReviewWorkspace`: `review.workspace`
- `canInitiateConsentUpgradeRequests`: `review.initiate_consent_upgrade_requests`
- `canFinalizeProject`: `workflow.finalize_project`
- `canStartProjectCorrection`: `workflow.start_project_correction`
- `canReopenWorkspaceForCorrection`: `workflow.reopen_workspace_for_correction`
- `canCorrectionReview`: `correction.review`
- `canCorrectionConsentIntake`: `correction.consent_intake`
- `canCorrectionMediaIntake`: `correction.media_intake`

Control mapping:

- invite creation/revocation should use `canCreateOneOffInvites` in normal mode and `canCorrectionConsentIntake` in correction mode.
- participant creation and recurring consent request controls should use `canCreateRecurringProjectConsentRequests` in normal mode and `canCorrectionConsentIntake` in correction mode.
- normal upload should use `canUploadAssets`; correction upload should use `canCorrectionMediaIntake`.
- normal review panels should use `canReviewWorkspace`; normal upgrade form should use `canInitiateConsentUpgradeRequests`.
- workflow controls should use the workflow-specific booleans where available, with handoff under capture and normal validation under review.

UI tests should verify that project/workspace custom-role assignees see only the controls their capabilities grant, while source metadata never appears in rendered output.

## State-machine preservation findings

Feature 095 must preserve the existing state-machine checks. The effective resolver only answers "does the user have this capability at this scope"; it does not answer "is this action valid right now."

State checks to preserve:

- active/unarchived project checks before operational mutations;
- finalized project checks that close normal capture and normal unfinalized workflows;
- workspace capture mutation states: `active` and `needs_changes`;
- workspace review mutation states: `handed_off` and `needs_changes`, with existing `allowValidated` behavior where used;
- workspace public submission states for public token flows;
- handoff transition allowed-from/target rules;
- validation blocker checks before workspace validation and project finalization;
- project workflow states `active`, `ready_to_finalize`, `finalized`, `correction_open`, `correction_ready_to_finalize`;
- idempotent already-finalized behavior in `finalizeProject`;
- release snapshot repair/retry behavior in `ensureProjectReleaseSnapshot`;
- correction start requires a finalized project and a published release for the finalized timestamp;
- correction start is idempotent when correction is already open;
- workspace correction reopen requires finalized project, correction open, and a validated workspace;
- workspace correction reopen is idempotent when already reopened in the current correction cycle;
- correction review mutation requires finalized project, correction open, and a handed-off correction workspace;
- correction consent and media intake require finalized project, correction open, and workspace reopened in the current correction cycle;
- correction request provenance must match the active correction cycle:
  - `request_source`
  - `correction_opened_at_snapshot`
  - `correction_source_release_id_snapshot`
- idempotency keys for invite, recurring consent request, upgrade request, asset creation, and batch asset operations;
- public token status and expiry handling;
- revoke idempotency and already-revoked handling.

The implementation plan should explicitly place capability assertions next to the current state assertions rather than replacing those state assertions.

## Correction boundary

Correction routes intentionally reuse several normal capture and review surfaces, but the authorization semantics are different once a project is finalized and correction is open.

Actions that look like capture but must use correction capabilities:

- one-off correction invite creation and revocation: `correction.consent_intake`;
- recurring participant and recurring project consent request creation in correction mode: `correction.consent_intake`;
- correction-mode consent upgrade request creation: `correction.consent_intake`;
- correction media preflight, prepare, and finalize: `correction.media_intake`.

Actions that look like review but must use correction capabilities:

- review sessions and item actions in correction mode: `correction.review`;
- face assignment/link/unlink in correction mode: `correction.review`;
- manual faces in correction mode: `correction.review`;
- hidden/blocked/suppressed face changes in correction mode: `correction.review`;
- whole-asset and consent asset links in correction mode: `correction.review`;
- correction-open workspace validation should be treated as an explicit plan decision, because the current handler uses normal review access but the action occurs after finalization.

Normal capture roles must not be allowed to modify finalized correction data. This is already enforced by state checks today. Feature 095 should keep that boundary and change the capability source for correction branches from old review access to `correction.*`.

## Public token and release boundaries

Public token flows should remain token-scoped and should not call the effective member capability resolver.

Public routes inspected:

- `src/app/i/[token]/consent/route.ts`
- `src/app/rp/[token]/consent/route.ts`
- `src/app/r/[token]/revoke/route.ts`
- `src/app/rr/[token]/revoke/route.ts`
- `src/app/api/public/invites/[token]/headshot/route.ts`
- `src/app/api/public/invites/[token]/headshot/[assetId]/finalize/route.ts`
- `src/app/join/[token]/accept/route.ts`

The one-off and recurring consent submission routes resolve token context and use public submission state checks:

- `assertWorkspacePublicSubmissionAllowed`
- `assertWorkspaceCorrectionPublicSubmissionAllowed`

Those checks validate workspace/project/correction availability and correction provenance, not member capability. That is correct and should remain unchanged.

Revocation routes use revoke tokens. Organization invite acceptance uses membership invite tokens. These flows should not be migrated to the Feature 094 operational resolver.

Release and Media Library boundaries:

- `ensureProjectReleaseSnapshot` is a finalization side effect and must remain snapshot-based and retry-safe.
- `createMediaLibraryAssetDownloadResponse` delegates to `getReleaseAssetDetail`, which uses Media Library authorization, not project operational authorization.
- Project reviewer assignment still must not grant Media Library access. Feature 095 should not change release detail/download authorization.

## Existing behavior preservation requirements

Feature 095 tests should prove these old-source behaviors remain intact:

- owner/admin can still perform operational actions where state allows;
- fixed photographer assigned to a workspace can still perform normal capture for that workspace;
- fixed photographer not assigned to the workspace remains denied;
- fixed reviewer without reviewer assignment remains denied review, workflow, and correction;
- fixed reviewer with tenant-wide assignment keeps current broad reviewer access;
- fixed reviewer with project assignment keeps project-limited reviewer access;
- project reviewer assignment still does not grant Media Library;
- reviewer access still does not grant normal capture;
- tenant-scoped operational custom roles remain ignored because operational support is `defer`;
- public token flows remain unchanged;
- release snapshot access remains unchanged.

New additive behavior to prove:

- project custom role with a capture capability can perform only matching project/workspace capture actions;
- workspace custom role with a capture capability can perform only matching workspace capture actions;
- project custom role with review capability can perform review actions without fixed reviewer role;
- workspace custom role with review capability can perform review actions without fixed reviewer role;
- project custom role with workflow capabilities can finalize/start correction without fixed reviewer role;
- workspace or project custom role with correction capabilities can perform correction actions without fixed reviewer role;
- wrong project/workspace custom role assignments are denied;
- revoked custom role assignments, archived roles, and inactive members are denied.

## Test plan themes

Service/helper tests:

- central workspace helper tests for each capability source and denial path;
- project workflow helper tests for `workflow.finalize_project`, `workflow.start_project_correction`, and `workflow.reopen_workspace_for_correction`;
- correction helper tests proving `correction.*` is used instead of normal review/capture in finalized correction mode;
- error-code compatibility tests for existing route-facing errors.

Route tests:

- one-off invite create/revoke with `capture.create_one_off_invites`;
- recurring participant/request with `capture.create_recurring_project_consent_requests`;
- normal asset preflight/create/prepare/finalize with `capture.upload_assets`;
- review sessions, face mutations, hidden/blocked/manual/whole-asset links with `review.workspace`;
- normal upgrade request with `review.initiate_consent_upgrade_requests`;
- project finalization with `workflow.finalize_project`;
- correction start with `workflow.start_project_correction`;
- workspace correction reopen with `workflow.reopen_workspace_for_correction`;
- correction review, consent intake, and media intake routes with the three correction capabilities.

SQL/RLS tests:

- custom-role SQL helper remains custom-role-only;
- operational SQL wrappers include owner/admin, reviewer assignment, photographer assignment, and custom role sources as appropriate;
- tenant-scoped operational custom roles remain ignored;
- generic capture access does not grant invite/upload-specific writes;
- review capability does not grant capture writes;
- Media Library access remains separate from project reviewer assignment.

UI gating tests:

- project/workspace custom-role users can see the workspace and only the controls their capabilities permit;
- capture-only custom role does not see review/finalization/correction controls;
- review-only custom role does not see normal capture upload/invite controls;
- workflow-only project role sees workflow controls but not capture/review mutation surfaces unless separately granted;
- correction-only roles see correction controls only when correction state allows them;
- source metadata is not rendered.

State-machine preservation tests:

- archived project denial;
- finalized project closes normal capture;
- wrong workspace state denies capture/review mutation;
- validation blockers still block validation/finalization;
- correction closed denies correction actions even with capability;
- correction reopened workspace/current cycle checks still deny stale provenance;
- idempotency retries still return stable responses.

Public token and release regression tests:

- one-off public signing and headshot upload/finalize continue to use token state, not member capability;
- recurring public signing and revocation continue to use token state;
- organization invite acceptance remains membership-token scoped;
- release download still uses Media Library authorization;
- project reviewer assignment still does not grant Media Library.

## Options considered

### Option A - Central helper migration

Update central capture/review/workflow/correction helpers to call the Feature 094 resolver, with targeted route call-site changes only where a specific capability key must be passed.

Pros:

- fastest safe route;
- minimizes route churn;
- preserves route API shapes and route error semantics;
- keeps state-machine checks close to existing code;
- allows helper-level tests to cover many routes.

Cons:

- central helpers must map capabilities carefully;
- broad helper names can hide overly broad capability checks if the plan is not explicit.

### Option B - Route-by-route migration

Update every operational route directly to call the effective resolver.

Pros:

- explicit per action;
- easy to see exact capability at each route.

Cons:

- more duplication;
- higher risk of inconsistent state/error handling;
- makes future capability or source changes more expensive;
- increases risk of missing a route.

### Option C - SQL/RLS-only migration

Update SQL helpers and RLS policies only.

Pros:

- strengthens the database backstop;
- can unblock some authenticated client access.

Cons:

- app helpers and UI would still deny custom-role users;
- service-role writes would still rely on old TypeScript authorization;
- route error semantics would not be updated.

### Option D - TypeScript-only migration

Update route helpers and UI but not SQL/RLS.

Pros:

- faster to implement;
- directly fixes route authorization for service-role-backed writes.

Cons:

- RLS drift;
- authorized users may still be blocked by authenticated reads, RPCs, or page queries;
- database policies would not document the same security model;
- future refactors could accidentally bypass TypeScript-only enforcement.

## Recommendation

Use Option A plus matching SQL/RLS wrapper updates.

Recommended implementation direction for Feature 095 plan:

- update central TypeScript operational helpers to call the Feature 094 resolver;
- preserve helper names where they represent stable route semantics;
- introduce optional capability-key parameters or small wrappers for route-specific capture/review mutations;
- enforce specific capability keys per action;
- map resolver denials to existing route error codes;
- update SQL/RLS helpers for parity, using Feature 094 SQL scoped custom-role helper as the custom-role building block;
- keep SQL wrappers surface-specific enough to avoid broadening invite/upload permissions;
- update minimal project page UI gating and workspace visibility so custom-role-authorized users can actually use the app;
- preserve every workflow, correction, idempotency, public-token, and release snapshot invariant;
- add tests for old fixed sources, new project/workspace custom-role sources, wrong-scope/revoked/archived denials, state preservation, SQL/RLS parity, UI gating, public-token regressions, and Media Library no-expansion;
- avoid broad cleanup/removal of old helpers until a later feature.

## Risks and tradeoffs

- The biggest risk is broadening capture by treating `capture.workspace` as a write-all permission. Use action-specific capabilities for invites, recurring requests, and uploads.
- SQL cannot easily express every correction state/provenance rule. Keep state-machine enforcement in TypeScript services and use RLS as a capability/scope backstop.
- Workspace visibility must be broadened enough for custom-role operational users, but not so broadly that tenant deferred operational capabilities leak project access.
- Some services use admin clients after app authorization. Tests need to cover route/helper authorization because RLS alone will not catch all regressions.
- Correction routes reuse normal review/capture route files. The implementation must branch on project workflow state before selecting normal vs correction capability.
- Preserving existing error codes requires a deliberate error-mapping layer around effective resolver assertions.
- UI gating can drift from route authorization if the page computes booleans differently. Prefer shared server-side capability helpers or a single server data shape.

## Explicit open decisions for the plan phase

- Exact helper API: optional `capabilityKey` on existing mutation helpers vs new named wrappers for invite/upload/upgrade actions.
- Exact SQL wrapper names and whether to keep or replace existing generic helper names in policies.
- Exact project/workspace access helper semantics for users with only workflow or correction capabilities.
- Whether correction-open workspace validation should require `correction.review` or continue under `review.workspace` for parity.
- How much workspace listing should include users with project-scoped workflow-only capabilities.
- Whether `app.current_user_can_review_project` should remain broad for compatibility or be split for workflow/finalization wrappers.
- How to model correction-specific RLS where the row itself does not carry enough workflow/correction state.
- Which route tests should assert resolver source metadata directly and which should only assert route success/denial.
