# Feature 095 - Enforce Resolver Across Operational Routes Plan

## Scope and contract

Feature 095 migrates operational project/workspace authorization to the Feature 094 effective scoped permission resolver.

This is a plan-only phase. It does not implement code, migrations, UI changes, tests, route changes, helper changes, or runtime authorization changes.

Implementation must enforce both conditions for every migrated operational action:

1. The actor has the required effective capability for the target project or workspace.
2. The current project, workspace, workflow, correction, release, provenance, and idempotency state allows the action.

Feature 095 changes who may attempt operational actions. It must not change when actions are valid.

In scope:

- central TypeScript operational authorization helpers;
- normal capture and upload authorization;
- normal review authorization;
- workflow/finalization authorization;
- correction authorization;
- SQL/RLS helper parity;
- minimal project page UI gating and workspace visibility for authorized custom-role users;
- comprehensive tests for old sources and new project/workspace custom-role sources;
- public token and release boundary regression coverage.

Out of scope:

- adding, removing, or renaming capability keys;
- changing the Feature 092 scope matrix;
- enabling tenant-scoped deferred operational custom roles;
- role administration delegation;
- converting reviewer access or photographer assignment into custom roles;
- effective access UI;
- public token behavior changes;
- release snapshot authorization changes;
- broad cleanup/removal of old helpers outside the migration need.

## Inputs and ground truth

Primary input:

- `docs/rpi/095-operational-permission-resolver-enforcement/research.md`

Required context was read first:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `UNCODEXIFY.md`
- `docs/rpi/README.md`
- `docs/rpi/SUMMARY.md`
- `docs/rpi/095-operational-permission-resolver-enforcement/research.md`

Governing permission plans were read:

- `docs/rpi/092-capability-scope-semantics-and-permission-migration-map/plan.md`
- `docs/rpi/093-scoped-custom-role-assignment-foundation/plan.md`
- `docs/rpi/094-effective-scoped-permission-resolver-foundation/plan.md`

Targeted live verification covered:

- `src/lib/tenant/effective-permissions.ts`
- `src/lib/tenant/custom-role-scope-effects.ts`
- `supabase/migrations/20260501130000_094_scoped_custom_role_capability_helper.sql`
- `tests/feature-094-effective-scoped-permission-resolver-foundation.test.ts`
- `src/lib/projects/project-workspace-request.ts`
- `src/lib/projects/project-workflow-service.ts`
- `src/lib/projects/project-workflow-route-handlers.ts`
- `src/lib/tenant/permissions.ts`
- capture, review, workflow, correction, public-token, and release route seams under `src/app`
- `src/lib/projects/project-participants-route-handlers.ts`
- `src/lib/projects/project-consent-upgrade-route-handlers.ts`
- `src/lib/assets/project-correction-asset-route-handlers.ts`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/components/projects/project-workflow-controls.tsx`
- current project/workspace SQL helper migrations and RLS policies

Live code, migrations, and tests remain authoritative over older RPI documents.

## Drift from research

Targeted verification found no major drift from the Feature 095 research.

Confirmed details:

- Feature 094 resolver exports the expected `resolveEffective*`, `userHasEffectiveCapability`, and `assertEffective*` helpers.
- Feature 094 denial reasons are `no_tenant_membership`, `project_not_found`, `workspace_not_found`, `capability_not_supported_at_scope`, `not_granted`, and `lookup_failed`; assertion errors map to `effective_capability_scope_forbidden` or `effective_capability_forbidden`.
- The Feature 094 SQL helper signature is `app.current_user_has_scoped_custom_role_capability(p_tenant_id uuid, p_capability_key text, p_project_id uuid default null, p_workspace_id uuid default null)`.
- A public wrapper for the Feature 094 SQL helper exists and is used by tests.
- Operational route helpers still depend on `src/lib/tenant/permissions.ts`, not `src/lib/tenant/effective-permissions.ts`.
- Current project page gating still depends on `resolveProjectPermissions` and `resolveProjectWorkspaceSelection`.
- The latest migration in the working tree is `20260501130000_094_scoped_custom_role_capability_helper.sql`.

Plan decision from targeted verification:

- Normal workspace validation, needs-changes, and pre-finalization reopen remain under `review.workspace`.
- Correction-open workspace validation occurs after finalization and should branch to `correction.review`.
- Workspace correction reopen remains a separate `workflow.reopen_workspace_for_correction` action.

Known live drift retained from research:

- `docs/rpi/093-scoped-custom-role-assignment-foundation/research.md` is absent.
- No `079` migration file exists, but correction media code/tests are present.
- The worktree contains many unrelated modified/untracked files. Feature 095 implementation should not revert or cleanup unrelated changes.

## Chosen implementation architecture

Choose Option A from research: central helper migration plus matching SQL/RLS wrapper updates.

Implement the migration primarily in central TypeScript helpers:

- `src/lib/projects/project-workspace-request.ts`
- `src/lib/projects/project-workflow-route-handlers.ts`
- project workspace visibility service support
- project page server-side gating

Use targeted route call-site changes only where an action must pass a narrower capability than the existing broad helper name implies.

Explicitly reject route-by-route migration as the primary approach:

- it duplicates capability and state mapping;
- it increases risk of inconsistent error semantics;
- it makes future cleanup harder.

Explicitly reject SQL-only migration:

- TypeScript helpers and UI would still deny custom-role users;
- service-role-backed writes would still rely on old authorization.

Explicitly reject TypeScript-only migration:

- RLS would drift from app behavior;
- authenticated reads/RPCs/page queries could still block authorized users;
- future refactors could bypass the intended model.

## Exact capability-to-action mapping

Capture:

| Action | Capability |
| --- | --- |
| Open/use normal capture workspace surface | `capture.workspace` |
| Workspace handoff | `capture.workspace` |
| Create/revoke one-off invites | `capture.create_one_off_invites` |
| Add recurring participants | `capture.create_recurring_project_consent_requests` |
| Create recurring project consent requests | `capture.create_recurring_project_consent_requests` |
| Normal asset create/preflight/prepare/finalize | `capture.upload_assets` |

Review:

| Action | Capability |
| --- | --- |
| Open/use normal review surface | `review.workspace` |
| Create review sessions | `review.workspace` |
| Review session item actions | `review.workspace` |
| Preview faces/candidates/links | `review.workspace` |
| Face assignment/link/unlink | `review.workspace` |
| Manual faces | `review.workspace` |
| Hide/block/suppress faces | `review.workspace` |
| Whole-asset links | `review.workspace` |
| Normal consent upgrade requests | `review.initiate_consent_upgrade_requests` |
| Normal consent headshot replacement | `review.workspace` |

Workflow/finalization:

| Action | Capability |
| --- | --- |
| Project finalization | `workflow.finalize_project` |
| Project correction start | `workflow.start_project_correction` |
| Workspace correction reopen | `workflow.reopen_workspace_for_correction` |
| Normal workspace validation | `review.workspace` |
| Normal workspace needs-changes | `review.workspace` |
| Normal pre-finalization workspace reopen | `review.workspace` |
| Correction-open workspace validation | `correction.review` |

Correction:

| Action | Capability |
| --- | --- |
| Correction review | `correction.review` |
| Correction consent intake | `correction.consent_intake` |
| Correction media intake/upload | `correction.media_intake` |
| Correction-mode upgrade request | `correction.consent_intake` |

Awkward mapping to document for future cleanup:

- Workspace handoff uses `capture.workspace` because no narrower handoff-specific capability exists.
- Normal validation/needs-changes/reopen use `review.workspace` because no narrower workflow transition capability exists for pre-finalization workspace review transitions.
- Correction-open validation uses `correction.review` to avoid allowing normal review-only custom roles to perform finalized correction review unless they have the correction capability.

## Exact TypeScript helper plan

### `project-workspace-request.ts`

Preserve existing helper names where possible. Add small internal helpers and narrow wrappers to avoid spreading resolver logic across routes.

Add imports:

- `assertEffectiveWorkspaceCapability`
- `type EffectiveCapabilityCheck`
- `type TenantCapability`
- `createAdminClient` if an admin resolver client is needed and not already supplied through the call path

Add a local assertion adapter:

```ts
async function assertWorkspaceCapabilityForRoute(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  projectId: string;
  workspaceId: string;
  capabilityKey: TenantCapability;
  forbiddenCode: string;
  forbiddenMessage: string;
}): Promise<EffectiveCapabilityCheck>
```

Behavior:

- call `assertEffectiveWorkspaceCapability`;
- pass `tenantId`, `userId`, `projectId`, `workspaceId`, and `capabilityKey`;
- map `effective_capability_forbidden` and `effective_capability_scope_forbidden` to the helper's existing route-facing forbidden code;
- preserve `project_not_found` and `workspace_not_found`;
- preserve unexpected lookup errors as their existing `HttpError` codes.

Keep these helper names and change internals:

- `requireWorkspaceCaptureAccessForRequest`
- `requireWorkspaceReviewAccessForRequest`
- `requireWorkspaceCaptureMutationAccessForRequest`
- `requireWorkspaceReviewMutationAccessForRequest`
- `requireWorkspaceCaptureAccessForRow`
- `requireWorkspaceReviewAccessForRow`
- `requireWorkspaceCaptureMutationAccessForRow`
- `requireWorkspaceReviewMutationAccessForRow`
- `requireWorkspaceCorrectionReviewMutationAccessForRequest`
- `requireWorkspaceCorrectionReviewMutationAccessForRow`
- `requireWorkspaceCorrectionConsentIntakeAccessForRequest`
- `requireWorkspaceCorrectionConsentIntakeAccessForRow`
- `requireWorkspaceCorrectionMediaIntakeAccessForRequest`
- `requireWorkspaceCorrectionMediaIntakeAccessForRow`

Add optional capability parameters to existing mutation helpers:

```ts
type WorkspaceCapabilityOverride = {
  capabilityKey?: TenantCapability;
};
```

Use defaults:

- `requireWorkspaceCaptureAccessForRequest/Row`: `capture.workspace`
- `requireWorkspaceCaptureMutationAccessForRequest/Row`: default `capture.workspace`, but Feature 095 route call sites must pass narrower capture mutation capabilities.
- `requireWorkspaceReviewAccessForRequest/Row`: `review.workspace`
- `requireWorkspaceReviewMutationAccessForRequest/Row`: default `review.workspace`, but upgrade route must pass `review.initiate_consent_upgrade_requests`.

Add narrow wrappers for readability and test targeting:

- `requireWorkspaceOneOffInviteMutationAccessForRequest`
- `requireWorkspaceOneOffInviteMutationAccessForRow`
- `requireWorkspaceRecurringProjectConsentRequestMutationAccessForRequest`
- `requireWorkspaceAssetUploadMutationAccessForRequest`
- `requireWorkspaceAssetUploadMutationAccessForRow`
- `requireWorkspaceConsentUpgradeMutationAccessForRow`

These wrappers should delegate to the existing helper names with the correct capability key. Routes may either use the wrappers or pass `capabilityKey`; prefer wrappers for high-risk specific actions.

Correction helpers should not take generic capability overrides. Their mapping is fixed:

- correction review helpers use `correction.review`;
- correction consent intake helpers use `correction.consent_intake`;
- correction media intake helpers use `correction.media_intake`.

State checks remain unchanged and stay after the capability/row resolution path:

- normal mutation helpers still call `assertProjectWorkflowMutable`;
- capture mutation still calls `assertWorkspaceCaptureMutationAllowed`;
- review mutation still calls `assertWorkspaceReviewMutationAllowed`;
- correction review still calls `assertWorkspaceCorrectionReviewMutationAllowed`;
- correction consent intake still calls `assertWorkspaceCorrectionConsentIntakeAllowed`;
- correction media intake still calls `assertWorkspaceCorrectionMediaIntakeAllowed`.

Row helpers must still:

- load the row through `loadWorkspaceScopedRow`;
- assert row/project/workspace match;
- authorize the row workspace;
- then run state checks.

### Error mapping

Maintain existing route-facing error codes:

| Helper family | Forbidden code |
| --- | --- |
| capture access/mutation | `workspace_capture_forbidden` |
| review access/mutation | `workspace_review_forbidden` |
| correction review | `workspace_correction_review_forbidden` |
| correction consent intake | `workspace_correction_consent_intake_forbidden` |
| correction media intake | `workspace_correction_media_intake_forbidden` |

Do not expose `effective_capability_forbidden` directly from operational routes except in new low-level helper tests that call the resolver itself.

### `project-workflow-route-handlers.ts`

Keep public handler names:

- `handleWorkspaceWorkflowTransitionPost`
- `handleProjectFinalizePost`
- `handleProjectCorrectionStartPost`
- `handleWorkspaceCorrectionReopenPost`

Update dependency types:

- replace project-level `assertCanReviewProjectAction` dependency with a new project capability dependency;
- keep dependency injection style for tests;
- add `assertEffectiveProjectCapability` use through a local route-helper adapter.

Add local project-level helper:

```ts
async function assertProjectCapabilityForRoute(input: {
  supabase: SupabaseClient;
  tenantId: string;
  userId: string;
  projectId: string;
  capabilityKey: TenantCapability;
  forbiddenCode: string;
  forbiddenMessage: string;
})
```

Project-level mappings:

- finalization: `workflow.finalize_project`, route-facing code can remain `project_review_forbidden` for compatibility or become `project_finalize_forbidden` only if tests and clients already tolerate it. Preferred: preserve `project_review_forbidden` in Feature 095.
- correction start: `workflow.start_project_correction`, preserve route-facing forbidden semantics.

Workspace workflow transition mappings:

- handoff: call `requireWorkspaceCaptureAccessForRequest` with `capture.workspace`.
- validate:
  - if project is finalized and correction open, require `correction.review`;
  - otherwise require `review.workspace`.
- needs-changes: require `review.workspace`; this action is not rendered in correction open mode today.
- reopen:
  - if route path is normal pre-finalization reopen, require `review.workspace`;
  - if route path is correction reopen, use `workflow.reopen_workspace_for_correction`.

Because `handleWorkspaceWorkflowTransitionPost` currently authorizes before calling `applyWorkspaceWorkflowTransition`, implementation may need a small pre-read of project workflow state for `validate` to decide between `review.workspace` and `correction.review`. Reuse `loadProjectWorkflowRowForAccess` from `project-workspace-request.ts` or a small existing service read; do not duplicate project state query logic.

### `project-workflow-service.ts`

Do not move capability checks into the workflow service unless implementation finds an unavoidable dependency-cycle problem.

Keep this file focused on state-machine and side-effect rules:

- `assertProjectWorkflowMutable`
- `assertWorkspaceCaptureMutationAllowed`
- `assertWorkspaceReviewMutationAllowed`
- `assertWorkspaceCorrectionReviewMutationAllowed`
- `assertWorkspaceCorrectionConsentIntakeAllowed`
- `assertWorkspaceCorrectionMediaIntakeAllowed`
- `applyWorkspaceWorkflowTransition`
- `finalizeProject`
- `startProjectCorrection`
- `reopenWorkspaceForCorrection`
- public submission helpers

Feature 095 may add no-op helper comments only if necessary to explain why capability checks stay in request/route helpers and state checks stay in service helpers.

### `permissions.ts`

Avoid broad rewrites.

Do not remove old helpers in Feature 095. They may remain compatibility wrappers for non-migrated paths and Feature 096 cleanup.

Allowed targeted changes:

- update `resolveAccessibleProjectWorkspaces` / `resolveWorkspacePermissions` only if that is the cleanest way to make project page and shared asset-list visibility include effective operational capability users;
- otherwise add a new effective workspace visibility helper in `project-workspaces-service.ts` and leave `permissions.ts` mostly unchanged.

Preferred plan:

- add a new effective operational visibility helper outside `permissions.ts`;
- keep `permissions.ts` old helpers in place until Feature 096 cleanup;
- keep role administration, Media Library, organization-user, templates, profiles, and project administration on their existing helpers.

### Route call-site changes

Use central wrappers but update these call sites to pass/use exact capabilities:

Capture:

- invite create/revoke routes use one-off invite wrappers.
- participant add/request route handler dependencies use recurring project consent request wrapper.
- asset create/preflight/batch prepare/batch finalize/single finalize use asset upload wrappers.

Review:

- normal read/review mutation routes can keep existing review helpers because default is `review.workspace`.
- consent upgrade route dependency must use `requireWorkspaceConsentUpgradeMutationAccessForRow`.
- normal consent headshot replacement can keep review mutation default `review.workspace`.

Workflow/correction:

- finalization route uses project `workflow.finalize_project`.
- correction start route uses project `workflow.start_project_correction`.
- correction reopen route uses workspace/project `workflow.reopen_workspace_for_correction`.
- correction helper routes keep correction helpers, now internally resolver-backed.

### Source metadata testing

Do not add source metadata to API responses or project page props.

Test source metadata by:

- calling `resolveEffectiveWorkspaceCapabilities` or `resolveEffectiveProjectCapabilities` directly in helper tests;
- asserting route success/denial for route tests;
- asserting UI visibility only from rendered controls, not source metadata.

## Exact SQL/RLS migration plan

Add migration:

```text
supabase/migrations/20260501140000_095_operational_permission_resolver_enforcement.sql
```

No table schema change is planned.

### SQL helper design

Add low-level helper fragments or full wrappers that compose:

- fixed owner/admin;
- system reviewer assignments;
- photographer workspace assignment;
- `app.current_user_has_scoped_custom_role_capability`.

Do not add a generic `current_user_has_effective_capability` SQL helper in Feature 095. Use surface-specific wrappers so table policies remain readable and narrow.

Update existing helpers:

- `app.current_user_can_access_project`
- `app.current_user_can_access_project_workspace`
- `app.current_user_can_capture_project`
- `app.current_user_can_capture_project_workspace`
- `app.current_user_can_review_project`
- `app.current_user_can_review_project_workspace`

Meaning after migration:

- access helpers allow rows to be visible when the actor has any relevant effective operational path for that project/workspace, while still preserving fixed owner/admin, assigned photographer, and reviewer assignment access.
- capture helpers mean capture workspace access, not every capture mutation.
- review helpers mean normal review workspace access, not correction consent/media and not Media Library.

Add new wrappers:

- `app.current_user_can_create_one_off_invites(p_tenant_id uuid, p_project_id uuid, p_workspace_id uuid)`
- `app.current_user_can_create_recurring_project_consent_requests(p_tenant_id uuid, p_project_id uuid, p_workspace_id uuid)`
- `app.current_user_can_upload_project_assets(p_tenant_id uuid, p_project_id uuid, p_workspace_id uuid)`
- `app.current_user_can_initiate_consent_upgrade_requests(p_tenant_id uuid, p_project_id uuid, p_workspace_id uuid)`
- `app.current_user_can_finalize_project(p_tenant_id uuid, p_project_id uuid)`
- `app.current_user_can_start_project_correction(p_tenant_id uuid, p_project_id uuid)`
- `app.current_user_can_reopen_workspace_for_correction(p_tenant_id uuid, p_project_id uuid, p_workspace_id uuid)`
- `app.current_user_can_review_correction_workspace(p_tenant_id uuid, p_project_id uuid, p_workspace_id uuid)`
- `app.current_user_can_perform_correction_consent_intake(p_tenant_id uuid, p_project_id uuid, p_workspace_id uuid)`
- `app.current_user_can_perform_correction_media_intake(p_tenant_id uuid, p_project_id uuid, p_workspace_id uuid)`

Add public wrappers only if existing tests or Supabase RPC usage require them. If added, revoke public and grant authenticated consistently with existing helper patterns.

### Composition details

Fixed owner/admin:

- all operational wrappers return true for active owner/admin membership when the target project/workspace belongs to the tenant.

Photographer workspace assignment:

- capture workspace and all capture-specific wrappers return true only when:
  - current membership role is `photographer`;
  - `project_workspaces.photographer_user_id = auth.uid()`;
  - tenant/project/workspace ids match.
- photographers do not gain review, workflow, correction, or Media Library wrappers.

System reviewer assignment:

- review wrappers return true for owner/admin or active tenant/project system reviewer assignment.
- workflow project wrappers return true for owner/admin or active tenant/project system reviewer assignment, matching Feature 094 resolver behavior.
- correction wrappers return true for owner/admin or active tenant/project system reviewer assignment.
- reviewer wrappers never grant capture wrappers.
- project reviewer assignment must still not grant Media Library helpers.

Custom roles:

- wrappers call `app.current_user_has_scoped_custom_role_capability` with the exact capability key.
- tenant-scoped deferred operational custom roles remain ignored because the Feature 094 SQL helper matrix returns false for `defer`.
- project custom-role assignments apply to project/workspace checks per the Feature 094 SQL helper.
- workspace custom-role assignments apply only to the exact workspace.

### RLS policy updates

Update policies where a narrower write capability exists.

Capture:

- `subject_invites` select stays access-based; insert/update should use `app.current_user_can_create_one_off_invites` for normal rows. If correction provenance columns identify correction rows, allow `app.current_user_can_perform_correction_consent_intake` for correction rows.
- `project_profile_participants` insert should use `app.current_user_can_create_recurring_project_consent_requests`.
- `recurring_profile_consent_requests` project-scope insert/update policies should use recurring request wrapper for normal rows and correction consent intake wrapper for correction provenance rows where distinguishable.
- `recurring_profile_consents` select remains access-based; writes should stay aligned with the existing RPC/service path and recurring request wrapper.
- `assets` normal insert/update should use `app.current_user_can_upload_project_assets`; correction media writes should be allowed through `app.current_user_can_perform_correction_media_intake` only where the policy can distinguish correction context. If the table has no reliable correction marker for the row, keep RLS broad enough for route parity and rely on TypeScript state checks, but document this in the migration comments/tests.

Review:

- review read/select policies remain access-based.
- normal review mutation tables can continue using `app.current_user_can_review_project_workspace`, updated to include `review.workspace`.
- `project_consent_upgrade_requests` insert/update should use `app.current_user_can_initiate_consent_upgrade_requests` for normal requests and correction consent intake wrapper when correction provenance identifies correction rows.

Workflow:

- project/workspace workflow table policies, where present, should use workflow wrappers for updates.
- service-role workflow writes still require TypeScript state checks.

Correction:

- correction review mutation policies should use `app.current_user_can_review_correction_workspace` where table policy can distinguish correction operations. If not distinguishable, keep review mutation RLS as the backstop and rely on TypeScript helper branch for correction-specific capability.
- correction consent/media policies should use the correction wrappers where row provenance or route-specific writes make it possible.

Policies to leave unchanged:

- public token tables/policies that are token-scoped;
- Media Library policies and helpers;
- role administration/custom role/editor policies;
- template/profile/project-administration/organization-user custom-role policies outside operational routes;
- release snapshot detail/download policies.

### Grants and comments

For each new function:

- `security definer`;
- explicit `set search_path = public, extensions`;
- revoke all from public;
- grant execute to authenticated if needed by RLS/RPC tests;
- add concise SQL comments only where the wrapper intentionally keeps capability and state-machine enforcement separate.

## Migration decision

Feature 095 needs one SQL migration:

```text
supabase/migrations/20260501140000_095_operational_permission_resolver_enforcement.sql
```

The migration should:

- redefine existing operational access/capture/review helper functions where their broad meaning remains useful;
- add capability-specific helper wrappers for invite, recurring request, upload, upgrade, workflow, and correction actions;
- update only the RLS policies needed for route parity and precision;
- keep the Feature 094 custom-role helper as the custom-role-only building block;
- avoid table schema changes.

No table migration or backfill is planned. If implementation finds a schema blocker, stop and update this plan before adding schema changes.

## Exact UI gating plan

Do not build an effective access UI. Do not expose resolver source metadata in page props.

### Server-side capability calculation

In `src/app/(protected)/projects/[projectId]/page.tsx`, replace operational gating based on `projectPermissions.canCaptureProjects` and `projectPermissions.canReviewSelectedProject` with server-calculated effective booleans.

Use:

- `resolveEffectiveProjectCapabilities` for project-level workflow booleans;
- `resolveEffectiveWorkspaceCapabilities` for selected workspace booleans.

Selected context:

- `tenantId` from `resolveTenantId`;
- `user.id` from Supabase auth;
- `project.id` from the tenant-scoped project row;
- selected workspace id from the effective workspace selection helper.

Compute booleans:

- `canOpenCaptureWorkspace`
- `canCreateOneOffInvites`
- `canCreateRecurringProjectConsentRequests`
- `canUploadAssets`
- `canReviewWorkspace`
- `canInitiateConsentUpgradeRequests`
- `canFinalizeProject`
- `canStartProjectCorrection`
- `canReopenWorkspaceForCorrection`
- `canCorrectionReview`
- `canCorrectionConsentIntake`
- `canCorrectionMediaIntake`

Use `capabilityKeys.includes(...)` from the resolver output or call `userHasEffectiveCapability`; prefer one workspace resolution plus one project resolution to avoid many redundant resolver calls.

### Workspace visibility

Add an effective operational workspace selection/listing helper in `src/lib/projects/project-workspaces-service.ts`, for example:

```ts
resolveEffectiveProjectWorkspaceSelection(input): Promise<{
  workspaces: AccessibleProjectWorkspace[];
  selectedWorkspace: AccessibleProjectWorkspace | null;
}>
```

It should:

- preserve current selected workspace URL behavior;
- include workspaces where the actor has at least one relevant effective workspace capability;
- include project-level workflow-capable users enough to see the project and workflow controls;
- preserve owner/admin, reviewer assignment, and photographer assignment visibility;
- not treat tenant-scoped deferred operational custom roles as visible access.

If implementation can safely evolve `resolveProjectWorkspaceSelection` without breaking old callers, it may update that function internally. Otherwise add the new helper and use it only on the project page and shared operational route helpers.

### Boolean replacement mapping

Replace:

- `projectPermissions.canCaptureProjects` for operational gating with specific capture booleans.
- `projectPermissions.canReviewSelectedProject` for operational gating with review/workflow/correction booleans.

Derived UI booleans:

- `captureWorkspaceOpen = canOpenCaptureWorkspace && selectedWorkspace`
- `inviteMutationsAllowed = normal state && canCreateOneOffInvites`
- `recurringConsentMutationsAllowed = normal state && canCreateRecurringProjectConsentRequests`
- `uploadMutationsAllowed = normal state && canUploadAssets`
- `normalReviewMutationsAllowed = normal review state && canReviewWorkspace`
- `normalUpgradeMutationsAllowed = normal review state && canInitiateConsentUpgradeRequests`
- `correctionReviewMutationsAllowed = correction review state && canCorrectionReview`
- `correctionConsentMutationsAllowed = correction consent state && canCorrectionConsentIntake`
- `correctionMediaIntakeAllowed = correction media state && canCorrectionMediaIntake`
- `canFinalizeProjectAction = state ready && canFinalizeProject`
- `canStartCorrectionAction = state finalized && canStartProjectCorrection`
- `canReopenWorkspaceForCorrectionAction = state correction-open/validated && canReopenWorkspaceForCorrection`

Control gating:

- `ProjectWorkflowControls` should receive specific props instead of broad `canCaptureProjects` and `canReviewProjects`, or a structured `capabilities` prop.
- Handoff button uses `canOpenCaptureWorkspace`.
- Validate/needs-changes/pre-finalization reopen use `canReviewWorkspace`.
- Correction-open validate uses `canCorrectionReview`.
- Correction reopen button uses `canReopenWorkspaceForCorrection`.
- Finalize button uses `canFinalizeProject`.
- Start correction button uses `canStartProjectCorrection`.
- `ProjectParticipantsPanel.allowConsentActions` and `allowConsentMutations` use recurring/correction consent booleans, not broad capture.
- `CreateInviteForm` and `InviteActions` use one-off invite/correction consent booleans.
- `AssetsUploadForm` uses upload/correction media booleans.
- review panels use `canReviewWorkspace`.
- `OneOffConsentUpgradeForm` uses `canInitiateConsentUpgradeRequests` normally and correction consent intake in correction mode.
- `ConsentHeadshotReplaceControl` uses `canReviewWorkspace` and remains hidden in correction mode.
- export link remains review/workspace based unless export has a separate existing capability; do not invent one.
- `AssetsList` should render for users with effective workspace access to capture, review, or correction as appropriate.

### UI tests

Use existing project page UI test patterns.

Tests should cover:

- project custom role with upload sees upload but not invite/review controls;
- workspace custom role with one-off invite sees invite form/actions but not upload/review controls;
- review custom role sees review panels but not capture controls;
- upgrade-only review custom role sees upgrade form only when normal review state allows it;
- workflow finalization role sees finalize/start correction controls as applicable;
- correction consent/media/review roles see correction controls only when correction state allows;
- source metadata does not appear in rendered page output.

## State-machine preservation plan

Do not move or delete current state-machine checks. Add capability assertions before or beside them.

Capture:

- preserve `assertProjectWorkflowMutable`;
- preserve finalized project closure of normal capture;
- preserve workspace capture mutation states `active` and `needs_changes`;
- preserve asset row/project/workspace validation;
- preserve duplicate policy handling;
- preserve upload idempotency and batch retry behavior.

Review:

- preserve workspace review mutation states `handed_off` and `needs_changes`;
- preserve current `allowValidated` behavior where a helper passes it;
- preserve asset/face/materialization/consent/session row ownership checks;
- preserve validation blockers and review queue invariants;
- preserve normal consent headshot replacement preconditions.

Workflow/finalization:

- preserve active/unarchived project checks;
- preserve handoff/validation/needs-changes/reopen transition state checks in `applyWorkspaceWorkflowTransition`;
- preserve validation blocker checks;
- preserve finalization blocker checks;
- preserve idempotent already-finalized behavior;
- preserve release snapshot creation/repair behavior;
- preserve correction-ready finalization requirements.

Correction:

- preserve correction-open state checks;
- preserve source release requirement for correction start;
- preserve workspace reopened-for-current-cycle checks;
- preserve correction review handed-off workspace requirement;
- preserve correction consent/media reopened workspace requirement;
- preserve correction provenance checks:
  - `request_source`;
  - `correction_opened_at_snapshot`;
  - `correction_source_release_id_snapshot`.

Public token:

- preserve token status and expiry checks;
- preserve public submission availability helpers;
- preserve one-off and recurring revoke idempotency.

## Correction boundary plan

Correction member actions must use correction capabilities once the action is in finalized correction mode.

Rules:

- correction review uses `correction.review`, not normal `review.workspace`;
- correction consent intake uses `correction.consent_intake`, not normal capture or normal review upgrade;
- correction media intake uses `correction.media_intake`, not normal `capture.upload_assets`;
- correction public token flows remain token-scoped and do not call the effective member resolver;
- normal capture roles cannot modify finalized correction data because normal capture state checks still reject finalized projects;
- normal review custom roles do not automatically perform correction actions unless the resolver grants correction capability from fixed owner/admin, reviewer assignment, or a scoped custom role.

Reviewer assignment behavior:

- Feature 094 resolver grants correction capabilities from tenant-wide reviewer assignment and project reviewer assignment.
- Therefore fixed reviewer with an appropriate reviewer assignment remains able to perform correction actions.
- Fixed reviewer without reviewer assignment remains denied.
- Project reviewer assignment remains project-limited and still does not grant Media Library access.

Correction route handling:

- routes that branch by `isProjectFinalized(project) && isProjectCorrectionOpen(project)` must select correction capability before mutating;
- row-based correction helpers must keep row scope validation before state/capability decisions;
- correction-mode upgrade requests must use `correction.consent_intake`;
- correction media route helpers stay separate under `/correction/assets`.

## Existing behavior preservation plan

Implementation tests must prove these old behavior paths remain intact:

- owner/admin allowed for operational actions where state allows;
- fixed photographer assigned to a workspace allowed for normal capture in that workspace;
- fixed photographer not assigned to a workspace denied for that workspace;
- fixed reviewer without reviewer assignment denied review/workflow/correction;
- fixed reviewer with tenant-wide assignment retains broad review/workflow/correction access;
- fixed reviewer with project assignment remains project-limited;
- project reviewer assignment still does not grant Media Library;
- reviewer access still does not grant normal capture;
- tenant-scoped operational custom roles remain ignored because scope support is `defer`;
- public token flows remain unchanged;
- release snapshot access remains unchanged.

Implementation tests must prove new additive behavior:

- project custom-role assignment can grant matching workspace capture/review/correction where the matrix allows;
- workspace custom-role assignment can grant exact workspace capture/review/correction where the matrix allows;
- project custom-role assignment can grant project-level workflow capabilities;
- workspace custom-role assignment cannot grant project-level finalization/start correction;
- revoked assignments, archived roles, system roles, wrong project, wrong workspace, inactive membership, and cross-tenant ids are denied.

## Test plan

Create one primary test file:

```text
tests/feature-095-operational-permission-resolver-enforcement.test.ts
```

Use existing fixture helpers where possible:

- authenticated owner/admin/reviewer/photographer users;
- project/workspace creation;
- photographer workspace assignment;
- reviewer access assignment;
- custom role creation/grant/revoke;
- public token/invite/recurring consent fixtures;
- release/correction fixtures.

Add or update surrounding tests only when they already own a UI or route behavior that must be adjusted.

### Capture route/helper tests

Cover:

- owner/admin can create one-off invite, recurring participant/request, and upload assets;
- assigned photographer can perform those capture actions in the assigned workspace;
- unassigned photographer is denied;
- project custom role with `capture.create_one_off_invites` can create/revoke one-off invites but cannot upload;
- workspace custom role with `capture.upload_assets` can create/preflight/prepare/finalize assets but cannot create invites;
- project custom role with `capture.create_recurring_project_consent_requests` can add participants/request consent but cannot create one-off invites unless granted;
- tenant custom role with capture capability remains denied;
- revoked/archived/wrong-scope custom role denied;
- finalized project still denies normal capture even when capability exists.

### Review route/helper tests

Cover:

- fixed reviewer without assignment denied;
- tenant reviewer assignment can review across projects;
- project reviewer assignment can review assigned project only;
- project reviewer assignment does not grant Media Library;
- project/workspace custom role with `review.workspace` can read review surfaces and perform normal review mutations;
- custom role with `review.initiate_consent_upgrade_requests` can create normal upgrade request;
- `review.workspace` without upgrade capability cannot create normal upgrade request if no source grants upgrade capability;
- normal consent headshot replacement remains under `review.workspace`;
- review capability does not grant capture.

### Workflow/finalization tests

Cover:

- project custom role with `workflow.finalize_project` can finalize when workflow state allows;
- workspace custom role with `workflow.finalize_project` denied because workspace scope is unsupported;
- project custom role with `workflow.start_project_correction` can start correction only after finalization and release exists;
- project/workspace custom role with `workflow.reopen_workspace_for_correction` can reopen matching workspace only when correction is open and workspace validated;
- `review.workspace` can validate/needs-changes/reopen normal pre-finalization workspaces;
- correction-open validate requires `correction.review`;
- validation/finalization blockers still deny.

### Correction tests

Cover:

- correction review custom role can perform correction review only when correction open and workspace handed off;
- correction consent intake custom role can create correction invite/participant/request/upgrade only when workspace reopened in current cycle;
- correction media custom role can preflight/prepare/finalize correction media only when workspace reopened in current cycle;
- normal capture custom role cannot perform correction media/consent actions after finalization;
- normal review custom role without correction capability cannot perform correction review;
- reviewer assignment source still grants correction capability through the resolver;
- stale correction provenance denied.

### SQL/RLS tests

Cover:

- each new SQL wrapper returns true for fixed owner/admin where appropriate;
- photographer assignment grants only capture wrappers;
- reviewer assignment grants review/workflow/correction wrappers, not capture wrappers;
- custom role project/workspace assignment grants exact capability wrapper;
- tenant-scoped operational custom role remains false;
- generic capture workspace access does not grant invite/upload wrapper unless the specific capability is present;
- `app.current_user_can_access_project` and workspace access helpers allow authorized operational custom-role users to read required project/workspace rows;
- Media Library helpers remain separate and project reviewer assignment still fails Media Library access.

### UI gating tests

Cover:

- upload-only custom role sees upload controls and not invite/review/finalize controls;
- invite-only custom role sees invite controls and not upload/review controls;
- recurring consent request custom role sees participant/request controls;
- review custom role sees review/matching controls;
- upgrade-only capability controls are visible only for upgrade action and state;
- workflow role sees finalize/start correction controls where state allows;
- correction-specific roles see correction controls only in correction-open/reopened state;
- source metadata does not render.

### Public token regression tests

Cover:

- one-off public signing still succeeds/fails by token and workspace public submission state;
- public invite headshot upload/finalize still uses token state;
- recurring public consent signing still uses token state;
- one-off and recurring revocation still use revoke token state;
- organization invite acceptance remains membership-token scoped.

### Release and Media Library no-expansion tests

Cover:

- release snapshot creation remains tied to finalization and retry repair;
- release asset download still uses Media Library authorization;
- project reviewer assignment does not grant Media Library;
- scoped project/workspace review custom role does not grant Media Library.

### Regression commands

Recommended implementation verification:

```powershell
npm test -- tests/feature-095-operational-permission-resolver-enforcement.test.ts
npm test -- tests/feature-094-effective-scoped-permission-resolver-foundation.test.ts tests/feature-082-reviewer-access-assignments.test.ts tests/feature-073-project-workflow-routes.test.ts tests/feature-075-project-correction-workflow.test.ts tests/feature-076-correction-consent-intake-foundation.test.ts tests/feature-079-correction-media-intake-foundation.test.ts
npm run lint
```

If the test runner does not support file arguments, use the closest supported command and document the limitation.

## Security considerations

- Derive tenant id server-side through existing tenant resolution; never accept `tenant_id` from request bodies.
- Validate project/workspace tenant ownership before capability checks or treat absence as not found.
- Do not expose service role clients to client code.
- Do not expose resolver source metadata in route responses or page props.
- Preserve existing route-facing error codes to avoid leaking object existence differently.
- Preserve SQL/RLS tenant scoping on every wrapper.
- Keep public token authorization token-scoped.
- Keep release snapshot/Media Library authorization release-scoped and tenant-scoped.
- Do not let project/workspace custom role review imply Media Library.
- Do not let reviewer assignment imply capture.
- Do not let `capture.workspace` imply invite/upload-specific writes in SQL or TypeScript.
- Keep role administration fixed owner/admin-only and outside Feature 095 resolver migration.

## Edge cases

- Session expired: existing routes return unauthenticated and should not call the resolver without a user.
- Project id from another tenant: return not found/forbidden through existing route semantics; SQL wrappers return false.
- Workspace id from another project: return `workspace_not_found` or false.
- Project custom role applies to all current and future workspaces in that project for workspace-supported operational capabilities.
- Workspace custom role applies only to exact workspace.
- Workspace custom role with project-only workflow capability does not grant project finalization/start correction.
- Tenant custom role with deferred operational capability remains ignored.
- Multiple sources for the same capability are additive and should not create deny precedence.
- Revoked custom role assignment is ignored.
- Archived custom role definition is ignored.
- System role definition is not treated as custom role assignment.
- Partial failure after idempotent write still retries safely.
- Concurrent workflow/correction mutations still rely on existing state update guards.
- RLS may not distinguish every correction row mode; where SQL cannot encode the full state/provenance boundary, TypeScript route helpers remain authoritative for state.

## Implementation phases

### Phase 1 - TypeScript central helper migration

- Add resolver-backed assertion adapters in `project-workspace-request.ts`.
- Add optional capability-key support and narrow wrappers.
- Migrate correction helpers to `correction.*`.
- Update workflow route handlers for project workflow capabilities and correction-open validation branching.
- Keep state checks in `project-workflow-service.ts`.

Validation:

- helper-level tests cover source preservation, custom-role grants, and error-code mapping.

### Phase 2 - SQL/RLS migration

- Add `20260501140000_095_operational_permission_resolver_enforcement.sql`.
- Update existing access/capture/review SQL helpers.
- Add new capability-specific SQL wrappers.
- Update RLS policies for capture/review/workflow/correction writes where table context supports precision.
- Preserve Media Library, public-token, role-admin, template/profile, project-admin, and organization-user helpers.

Validation:

- SQL/RLS tests cover wrapper truth tables and no-expansion regressions.

### Phase 3 - UI gating migration

- Add effective operational workspace visibility/selection.
- Compute server-side project/workspace effective capability booleans.
- Replace broad old project page booleans with specific booleans.
- Update `ProjectWorkflowControls` props to receive specific permissions.
- Update invite, participant, upload, review, upgrade, and correction control gating.
- Do not add effective access UI.

Validation:

- UI tests cover visibility and non-exposure of source metadata.

### Phase 4 - Operational route and helper tests

- Add `tests/feature-095-operational-permission-resolver-enforcement.test.ts`.
- Cover capture, review, workflow, correction, state-machine, wrong-scope, revoked, archived, and old-source preservation.
- Add focused updates to existing UI/route tests only if their assertions need the new booleans.

Validation:

- primary Feature 095 test file passes.

### Phase 5 - Regression suite

- Run Feature 094 resolver tests.
- Run reviewer assignment, workflow, correction, public token, release/Media Library, and UI regressions.
- Run lint.
- Run broader `npm test` if practical.

## Feature 096 handoff

After Feature 095:

- old operational authorization helpers may still exist as compatibility wrappers;
- `permissions.ts` may still contain fixed-role/reviewer/photographer helpers for old callers and cleanup;
- SQL may still have compatibility helper names with resolver-backed internals;
- route code should be mostly migrated, but cleanup/removal of duplicate helper paths is not the Feature 095 goal;
- effective access UI remains unbuilt;
- public token and release authorization remain separate.

Feature 096 should handle cleanup only after Feature 095 tests prove enforcement is correct:

- remove or deprecate duplicated operational helper paths;
- simplify project page permission data if safe;
- reconcile SQL wrapper naming if redundant;
- consider effective access UI in a separate plan if needed.

## Scope boundaries

Do implement during Feature 095 implementation:

- resolver-backed operational authorization helpers;
- exact capability mapping in route call sites;
- SQL/RLS parity migration;
- minimal project page gating;
- tests and regressions listed above.

Do not implement:

- capability key changes;
- Feature 092 matrix changes;
- tenant-scoped operational custom role enablement;
- role administration delegation;
- reviewer-to-custom-role conversion;
- photographer-to-custom-role conversion;
- public token authorization changes;
- release snapshot authorization changes;
- effective access UI;
- broad cleanup beyond what is necessary for enforcement.

## Concise implementation prompt

Implement Feature 095 from this plan. Migrate central operational authorization in `project-workspace-request.ts` and `project-workflow-route-handlers.ts` to the Feature 094 effective resolver while preserving route-facing helper names and error semantics. Add narrow capability wrappers or capability parameters so invites use `capture.create_one_off_invites`, recurring project consent requests use `capture.create_recurring_project_consent_requests`, uploads use `capture.upload_assets`, normal review uses `review.workspace`, normal upgrade requests use `review.initiate_consent_upgrade_requests`, workflow project actions use the `workflow.*` keys, and correction uses `correction.*`.

Add SQL migration `20260501140000_095_operational_permission_resolver_enforcement.sql` with surface-specific operational wrappers that compose fixed owner/admin, reviewer assignments, photographer workspace assignment, and `app.current_user_has_scoped_custom_role_capability`. Update only necessary RLS policies, keeping public token, Media Library, role administration, release, template/profile, project-admin, and organization-user boundaries unchanged.

Update the project page to compute server-side effective capability booleans for the selected project/workspace and gate existing controls with those booleans without exposing source metadata or building effective access UI. Preserve all workflow, correction, provenance, release, public-token, and idempotency checks. Add `tests/feature-095-operational-permission-resolver-enforcement.test.ts` covering capture, review, workflow, correction, SQL/RLS, UI gating, public-token regressions, Media Library no-expansion, old fixed sources, custom-role project/workspace sources, and state-machine preservation.
