# Feature 076 Research - Correction consent intake and authorization updates

## Inputs reviewed

Authoritative live inputs:

- `supabase/migrations/20260424110000_073_workspace_workflow_and_project_finalization.sql`
- `supabase/migrations/20260424130000_074_project_releases_media_library_foundation.sql`
- `supabase/migrations/20260424150000_075_project_correction_re_release_foundation.sql`
- `supabase/migrations/20260304210000_002_projects_invites_schema.sql`
- `supabase/migrations/20260414193000_051_baseline_recurring_consent_request_foundation.sql`
- `supabase/migrations/20260415110000_055_project_participants_mixed_consent_foundation.sql`
- `supabase/migrations/20260422143000_067_consent_scope_state_foundations.sql`
- `supabase/migrations/20260422190000_069_consent_upgrade_governing_foundations.sql`
- `supabase/migrations/20260422200000_069_upgrade_submit_binding_and_supersedence.sql`
- `supabase/migrations/20260423120000_072_project_workspaces_foundation.sql`
- `src/lib/projects/project-workflow-service.ts`
- `src/lib/projects/project-workflow-route-handlers.ts`
- `src/lib/projects/project-workspace-request.ts`
- `src/lib/projects/project-workspaces-service.ts`
- `src/lib/projects/project-consent-upgrade-service.ts`
- `src/lib/projects/project-consent-upgrade-route-handlers.ts`
- `src/lib/projects/project-participants-service.ts`
- `src/lib/projects/project-participants-route-handlers.ts`
- `src/lib/project-releases/project-release-service.ts`
- `src/lib/project-releases/media-library-download.ts`
- `src/lib/invites/public-invite-context.ts`
- `src/lib/consent/submit-consent.ts`
- `src/lib/recurring-consent/public-recurring-consent.ts`
- `src/lib/matching/project-face-assignees.ts`
- `src/lib/matching/project-recurring-sources.ts`
- `src/lib/matching/project-matching-progress.ts`
- `src/lib/matching/auto-match-repair.ts`
- `src/lib/profiles/profile-access.ts`
- `src/lib/profiles/profile-directory-service.ts`
- `src/lib/profiles/profile-consent-service.ts`
- `src/lib/profiles/profile-headshot-service.ts`
- `src/lib/tenant/permissions.ts`
- `src/app/api/projects/[projectId]/correction/start/route.ts`
- `src/app/api/projects/[projectId]/workspaces/[workspaceId]/correction-reopen/route.ts`
- `src/app/api/projects/[projectId]/finalize/route.ts`
- `src/app/api/projects/[projectId]/invites/route.ts`
- `src/app/api/projects/[projectId]/invites/[inviteId]/revoke/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/upgrade-request/route.ts`
- `src/app/api/projects/[projectId]/profile-participants/route.ts`
- `src/app/api/projects/[projectId]/profile-participants/[participantId]/consent-request/route.ts`
- `src/app/i/[token]/page.tsx`
- `src/app/i/[token]/consent/route.ts`
- `src/app/api/public/invites/[token]/headshot/route.ts`
- `src/app/api/public/invites/[token]/headshot/[assetId]/finalize/route.ts`
- `src/app/rp/[token]/page.tsx`
- `src/app/rp/[token]/consent/route.ts`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/components/projects/project-workflow-controls.tsx`
- `src/app/(protected)/media-library/page.tsx`
- `src/app/(protected)/media-library/[releaseAssetId]/page.tsx`
- `src/app/api/media-library/assets/[releaseAssetId]/download/route.ts`
- `tests/feature-055-project-participants-foundation.test.ts`
- `tests/feature-055-project-participants-routes.test.ts`
- `tests/feature-067-consent-upgrade-foundation.test.ts`
- `tests/feature-067-consent-upgrade-route.test.ts`
- `tests/feature-069-governing-foundations.test.ts`
- `tests/feature-069-upgrade-submit-foundation.test.ts`
- `tests/feature-071-one-off-current-surfaces.test.ts`
- `tests/feature-073-project-workflow-foundation.test.ts`
- `tests/feature-073-project-workflow-routes.test.ts`
- `tests/feature-074-project-release-media-library.test.ts`
- `tests/feature-074-media-library-download.test.ts`
- `tests/feature-075-project-correction-workflow.test.ts`

Supporting context only:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `UNCODEXIFY.md`
- `docs/rpi/README.md`
- `docs/rpi/SUMMARY.md`
- Feature 070, 072, 073, 074, and 075 research and plan docs
- Prior consent/profile/matching RPI docs listed in the feature request

## Verified current behavior

### Current correction / finalization / release boundary after Feature 075

- Correction is modeled on `projects` with `correction_state`, `correction_opened_at`, `correction_opened_by`, `correction_source_release_id`, and `correction_reason`.
- A project can only enter correction after it is finalized and already has a published release snapshot for the current `finalized_at`. `startProjectCorrection` rejects otherwise with `project_correction_release_missing`.
- Correction reopen is workspace-scoped. `reopenWorkspaceForCorrection` only allows `validated -> handed_off`, records `reopened_at` and `reopened_by`, and leaves historical `handed_off_*` data intact.
- Project workflow summary derives `workflowState` as `active`, `ready_to_finalize`, `finalized`, `correction_open`, or `correction_ready_to_finalize`.
- `finalizeProject` handles both initial finalization and correction re-finalization. During correction it requires `correction_ready_to_finalize` and at least one correction-reopened workspace, then clears all correction fields and advances `finalized_at`.
- `ensureProjectReleaseSnapshot` creates immutable release rows keyed by `source_project_finalized_at`. A corrected finalization produces `release_version + 1`. Existing published release rows are not mutated. Feature 075 tests verify v2 is published without mutating v1.
- Media Library reads published release rows, not mutable review tables. The top-level Media Library list defaults to the latest published release per project.

### Current correction mutation seam

- Feature 075 added a narrow exception for review-safe correction work through `assertWorkspaceCorrectionReviewMutationAllowed`.
- That helper allows review mutations when:
  - the project is active
  - the project is finalized
  - `correction_state = 'open'`
  - the workspace is currently `handed_off`
- If the project is not finalized, the helper falls back to normal review rules.
- Routes already on the correction-aware seam are review-only linking/review surfaces such as blocked faces, hidden faces, manual faces, face assignment, whole-asset links, consent asset links, and review-session actions.
- Capture routes, consent-intake routes, staffing routes, and default-template routes are still blocked by the normal finalized-project lock.

### Current finalized / correction lock model

- `assertProjectWorkflowMutable` is the main helper that rejects finalized projects for authenticated mutable flows.
- `requireWorkspaceCaptureMutationAccessForRequest` and `requireWorkspaceCaptureMutationAccessForRow` use the capture lock path and therefore block:
  - one-off invite creation and revoke
  - project participant add
  - recurring project consent request creation
  - asset upload and finalize
  - other capture-oriented mutations
- `requireWorkspaceReviewMutationAccessForRow` still blocks consent-upgrade request creation and consent headshot replacement after finalization because it uses the normal finalized lock, not the correction-aware exception.
- `assertWorkspacePublicSubmissionAllowed` rejects finalized projects for public token writes with `409 project_finalized`.
- `tests/feature-073-project-workflow-foundation.test.ts` confirms public submission stays open through `handed_off` and closes at `validated`. Feature 075 did not change that helper.

### Current one-off invite and public submit behavior

- One-off invites use `subject_invites`. The table currently has no correction marker, no source enum, and no correction cycle snapshot.
- Invite creation is idempotent and server-side, but only available through capture permission today.
- Invite revocation is also capture-scoped and revokes the linked invite row. If an upgrade request is linked to that invite, revoke also cancels the pending upgrade request.
- Public one-off submit (`/i/[token]/consent`) resolves the invite, then calls `assertWorkspacePublicSubmissionAllowed`. A finalized project currently blocks the submit before the RPC runs.
- Public invite headshot upload and headshot finalize use the same public submission helper and are likewise blocked after finalization.
- `submit_public_consent` already handles upgrade semantics correctly once it is reached:
  - inserts immutable signed consent history
  - updates current-vs-history scope projections
  - retargets project assignees and manual consent-link surfaces to the new governing consent
  - supersedes the prior consent and completes the upgrade request when applicable

### Current one-off upgrade behavior

- One-off upgrade requests live in `project_consent_upgrade_requests` and reuse `subject_invites` for the public token.
- The route is review-scoped today, but still blocked after finalization because it uses the normal review helper rather than the correction review helper.
- The table has no correction marker fields.
- Existing upgrade behavior already supports:
  - sharing a pending request when the target template matches
  - canceling or superseding stale pending requests when a newer request replaces them
  - governing-consent supersedence on successful public submit
- Drift from earlier RPI framing: live code does not have a separate public correction-upgrade path. It still uses the standard one-off invite token flow.

### Current recurring participant and recurring project consent behavior

- Existing recurring participants are workspace-scoped in `project_profile_participants`.
- Adding a participant is capture-scoped today, idempotent, and blocked after finalization.
- The participant row itself does not imply project consent. Assignment eligibility still depends on signed current project recurring consent and `face_match_opt_in`.
- If the recurring profile is baseline-ready, adding a participant already enqueues recurring replay work, but downstream project assignment still guards on project consent state.
- Project recurring consent requests use `recurring_profile_consent_requests` with `consent_kind = 'project'`.
- The route is capture-scoped today and blocked after finalization.
- Live code does not have a distinct recurring-project-replacement route. The same request-creation path already supports a same-family newer-template replacement/upgrade if an active project consent exists.
- Public recurring project submit (`/rp/[token]/consent`) also calls `assertWorkspacePublicSubmissionAllowed` when the request is project-scoped, so finalized projects currently block it.
- On successful public recurring project submit, existing code already:
  - inserts immutable recurring consent history
  - updates current-vs-history recurring project consent state
  - supersedes prior same-family project consent when appropriate
  - enqueues reconcile work for matching when face match is enabled

### Current public token lock behavior

- Current public write lock is centralized in `assertWorkspacePublicSubmissionAllowed`.
- Blocked public writes currently surface as `409` and routes map `project_finalized` or `workspace_not_accepting_submissions` to `error=unavailable`.
- `resolvePublicInviteContext` and `resolvePublicRecurringConsentRequestScope` do not have correction-aware logic.
- No existing public path distinguishes:
  - requests created before finalization
  - requests created during correction
  - requests from a prior correction cycle
- As implemented today, enabling public writes during correction without an additional check would also reopen any still-active token that happens to belong to the reopened workspace.

### Current matching / review / release snapshot implications

- Matching progress is already part of workspace validation blockers. A workspace cannot validate while matching is still in progress or degraded.
- Correction finalization reuses the same readiness model because `correction_ready_to_finalize` depends on all workspaces being validated.
- The one-off public submit route already enqueues headshot-ready fanout when needed.
- The recurring public submit route already enqueues project reconcile work when needed.
- Matching workers and progress helpers inspected in this pass do not reject finalized-but-correction-open projects.
- Release snapshot construction reads current mutable review state at the moment of corrected finalization. It does not special-case correction-created rows.
- That means newly signed one-off consents, upgraded governing consents, current recurring project consents, exact-face links, and whole-asset links should already flow into the next immutable release snapshot if the mutable review state has been corrected before re-finalization.

## Current constraints and invariants

- Tenant scoping is enforced server-side and must remain mandatory.
- Client input must not choose `tenant_id`.
- Public flows are token-scoped and currently rely on route-level server validation before write RPCs run.
- Old release snapshots are immutable and Media Library is intentionally read-only.
- Feature 075 intentionally did not reopen general capture. Asset upload/finalize, staffing, and default-template changes remain blocked on finalized projects.
- Reviewer-safe correction mutation is currently limited to reopened review workspaces, not the whole project.
- Current role split is:
  - `owner` / `admin`: capture + review + tenant profile management
  - `reviewer`: review only
  - `photographer`: capture only
- Current project permission helpers tie one-off invite creation, participant add, and recurring project consent request creation to capture permission, not review permission.
- Current UI follows that split. During correction open, review-safe controls remain visible in reopened workspaces, but invite/upgrade/participant/request controls are hidden because they still depend on non-correction capture or review-consent flags.
- Adding a recurring participant does not create project consent automatically and must not be treated as if it did.

## Options considered for correction request marking

### Option A - no schema change, infer from `created_at >= correction_opened_at`

Pros:

- Smallest code change.
- Possible for `subject_invites` and `recurring_profile_consent_requests` because both already have `created_at`.

Cons:

- Loses traceability after correction finalization because `projects.correction_opened_at` is cleared.
- Makes later audit/debugging of release v2 provenance weaker.
- More fragile if the product later needs to show which requests belonged to which correction cycle.

Assessment:

- Technically viable for a short-lived guard, but weak as a durable foundation.

### Option B - add `request_source = normal | correction` only

Pros:

- Explicit and queryable.
- Useful for UI copy, audit, and reporting.

Cons:

- Not enough by itself to distinguish the current correction cycle from an older correction cycle.
- Would still need an additional live-cycle check to avoid reopening a stale correction token in a later correction.

Assessment:

- Better than timestamps alone for audit, but insufficient for the public-token exception model by itself.

### Option C - add explicit correction-cycle snapshot fields on public-request-bearing tables

Suggested shape:

- `subject_invites.request_source`
- `subject_invites.correction_opened_at_snapshot`
- `recurring_profile_consent_requests.request_source`
- `recurring_profile_consent_requests.correction_opened_at_snapshot`

Pros:

- Small, explicit, and durable.
- Lets public submit validate both source and active correction-cycle identity.
- Preserves auditability after corrected finalization clears the live correction fields on `projects`.
- Keeps blocker queries simple because pending invite/request blockers can remain table/status based.

Cons:

- Requires schema and service changes in the token-bearing tables.

Assessment:

- Recommended smallest safe schema change.

### Marker scope recommendation

- `subject_invites` needs explicit correction metadata because it carries the one-off and one-off-upgrade public token.
- `recurring_profile_consent_requests` needs explicit correction metadata for project-kind public recurring requests.
- `project_consent_upgrade_requests` does not strictly need new correction fields in the first slice if the linked invite carries the correction marker.
- `project_profile_participants` does not need correction metadata for the first slice because it has no public token, and validation can safely block on all unresolved active/pending workspace work.

## Options considered for public token exception design

### Option 1 - relax `assertWorkspacePublicSubmissionAllowed` globally when correction is open

Assessment:

- Reject. Too broad. It would reopen old non-correction tokens in the reopened workspace.

### Option 2 - keep the global helper strict and add a correction-aware wrapper used only by correction-enabled public flows

Suggested rule:

- project is finalized
- project correction is open
- workspace is correction-reopened in the current correction cycle
- token-bearing row is marked `request_source = correction`
- token-bearing row snapshot matches the active correction cycle
- token-bearing row is still active/pending

Assessment:

- Recommended. This preserves the normal finalized-project lock for every non-correction token and every unchanged public route.

### Blocked-token response recommendation

- Keep `409` for denied public writes.
- Preserve the current UI mapping to `error=unavailable`.
- Prefer reusing `project_finalized` for stale or non-correction tokens if the goal is not to leak whether correction is open.
- If a new code is needed for observability, keep it internal to logs/tests and map it to the same public UX.

## Options considered for one-off correction invites

- Reuse the existing `subject_invites` table and invite creation service.
- Do not create a new correction-only invite table.
- Allow creation only in explicitly correction-reopened workspaces.
- Route/service should stay server-authoritative and idempotent.
- Invite revoke can reuse the existing revoke path, but revoke permission should also work in the same correction-intake seam.
- Public one-off submit and headshot upload/finalize should be allowed only for invites created during the active correction cycle.

Recommended seam:

- Add a narrow correction-intake access helper for request creation and revoke.
- Do not broaden normal capture permissions or normal finalized-project mutability.

## Options considered for one-off upgrade during correction

- Reuse the existing upgrade request route and service.
- Do not build a separate correction-upgrade table.
- Require the consent's workspace to be correction-reopened.
- Keep using the linked invite token for public submit.
- Rely on existing governing-consent supersedence and retargeting after sign.

Assessment:

- This is a good first-slice candidate. Most domain behavior already exists. The missing pieces are authorization, correction-cycle marking on the linked invite, and finalized-project public-token exceptions.

## Options considered for recurring participants and recurring consent during correction

### Existing recurring profile add

- Reuse `project_profile_participants`.
- Allow add only in correction-reopened workspaces.
- Do not interpret participant creation as project consent.
- Because participant add is closer to review correction than capture, a correction-specific intake permission should be used instead of capture permission in correction mode.

### Project recurring consent request

- Reuse `recurring_profile_consent_requests` with `consent_kind = 'project'`.
- Restrict correction requests to existing workspace participants.
- Add correction metadata only on the request table, not by creating a parallel correction request table.
- Allow public recurring submit only for correction-created requests tied to the active correction cycle.

### Recurring project replacement / upgrade

- Live code already uses the same request table and request path for same-family newer-template replacement.
- This is smaller than introducing a separate replacement feature because the core governing-consent behavior already exists.
- It can stay in scope if the plan treats it as "correction recurring project consent requests, including the existing same-family newer-template replacement path" rather than as a separate broad feature.

## Options considered for recurring profile quick-add

- Live recurring profile creation is tenant-scoped and only available to `owner` / `admin`.
- Raw profile creation is technically small, but useful correction intake would immediately pull in tenant-level profile management concerns:
  - who is allowed to create tenant profiles
  - how profile type selection should work
  - whether baseline consent/headshot readiness should be collected in the same surface
  - whether reviewers should gain tenant-wide profile-management authority

Assessment:

- Keep inline brand-new recurring profile creation out of Feature 076.
- Preferred first slice is adding existing recurring profiles only.

## Recommended bounded first-slice direction

Recommended scope:

- Allow reviewer-capable users (`owner`, `admin`, `reviewer`) to create correction-scoped consent intake in correction-reopened workspaces.
- Keep photographers denied.
- Support:
  - one-off correction invites
  - one-off consent upgrade requests
  - adding existing recurring profiles to the correction workspace
  - project recurring consent requests for existing participants
  - the already-existing same-family recurring project replacement path when created through that request flow
- Add explicit correction-cycle metadata only where public tokens exist:
  - `subject_invites`
  - `recurring_profile_consent_requests`
- Keep validation/finalization blockers generic:
  - active invites
  - pending one-off upgrade requests
  - pending recurring project consent requests
  - matching in progress or degraded

Rationale:

- This preserves Feature 075's review-only correction boundary for asset/media state while extending correction just enough to fix missing or insufficient consent.
- It reuses the live consent, supersedence, matching, and release snapshot foundations instead of creating parallel correction-only domain tables.

## In-scope and out-of-scope recommendation

In scope for Feature 076:

- Correction-scoped one-off invite creation and revoke
- Correction-scoped one-off consent upgrade requests
- Existing recurring profile add to correction-reopened workspaces
- Correction-scoped project recurring consent requests for existing participants
- Public token submit/headshot exceptions only for correction-created active-cycle requests
- Validation and correction-finalization blockers for unresolved correction consent work
- UI affordances inside the existing project correction workspace surfaces

Out of scope for Feature 076:

- General project recapture or asset upload during correction
- Broad photographer reopening
- Workspace staffing changes
- Default-template changes
- Consent template authoring
- Media Library edits
- Release diff UI
- DAM sync work
- Folder/collection/public sharing work
- Notification redesign beyond existing request delivery paths
- Inline creation of brand-new recurring profiles

## Security and reliability findings

- The main security risk is broadening the finalized-project public lock too far. The exception must be tied to both correction state and request provenance.
- Reusing existing tables is safe only if correction-cycle provenance is explicit for token-bearing rows.
- Generic blocker queries are a strength here. Because finalized projects should have had no unresolved blockers before correction, blocking on all active/pending invite/request rows in the reopened workspace is simpler and safer than trying to block only "correction-created" rows.
- Existing consent submit paths are already retry-tolerant and idempotent enough for the first slice because they reuse current RPC and request sharing patterns.
- Matching safety looks acceptable because validation already blocks while matching is in progress or degraded, and corrected finalization depends on validation.

## Risks and tradeoffs

- Introducing a new correction-intake permission seam adds policy complexity, but it is still safer than reclassifying invite/participant/request creation as general review or general capture everywhere.
- If correction-cycle markers are added only to `subject_invites` and `recurring_profile_consent_requests`, audit on `project_consent_upgrade_requests` will be indirect through the linked invite. That is acceptable for a first slice but should be called out in the plan.
- Allowing existing recurring-profile add during correction may create a participant row before project consent is signed. Live code already handles that safely, but the UI and blocker messaging need to make the "participant added but not yet consented" state obvious.
- Same-family recurring project replacement is already in live code, but including it in Feature 076 slightly widens the test matrix. Excluding it would create a product gap where recurring project consent correction works for first-time requests but not for scope/template upgrades.

## Suggested tests for the plan phase

- Correction one-off invite permission tests for owner/admin/reviewer allow and photographer deny
- Correction invite revoke tests in reopened workspaces
- Public one-off correction submit tests for active correction-cycle invites
- Public one-off headshot upload/finalize tests for active correction-cycle invites
- Public one-off token denial tests for pre-correction invites in reopened workspaces
- One-off upgrade request creation tests during correction
- One-off upgrade public submit tests during correction, including governing-consent supersedence
- Existing recurring participant add tests during correction and photographer denial tests
- Project recurring consent request creation tests during correction
- Project recurring public submit tests during correction
- Same-family recurring project replacement tests during correction if included
- Public token denial tests after correction finalization closes the cycle
- Validation blocker tests for active invites, pending upgrades, pending recurring requests, and matching still running
- Release v2 snapshot tests that verify corrected consent/scope/link state appears in the new release while v1 remains unchanged
- Cross-tenant and cross-workspace denial tests for every new correction intake path
- Regression tests proving capture upload, staffing, and default-template routes stay blocked during correction

## Explicit open decisions for the plan phase

- Should correction consent intake use a dedicated helper such as `canManageCorrectionConsentIntake`, or should it be expressed as a correction-only override layered onto existing capture/review helpers?
- Should `project_consent_upgrade_requests` also get explicit correction metadata for direct auditability, or is invite-linked provenance enough for the first slice?
- Should recurring participant add during correction be available to all reviewer-capable users, or only `owner` / `admin` because it touches participant roster composition?
- Should stale or non-correction public tokens during an active correction return the existing `project_finalized` code or a new internal-only code mapped to the same public UX?
- Should the first slice include the existing same-family recurring project replacement path explicitly, or should the plan land first-time recurring project consent requests first and leave replacement coverage for a follow-up despite the live reuse seam?
