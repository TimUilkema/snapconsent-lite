# Feature 076 Plan - Correction consent intake and authorization updates

## Inputs and ground truth

Primary synthesis source:

- `docs/rpi/076-correction-consent-intake-and-authorization-updates/research.md`

Authoritative live verification for this plan:

- `supabase/migrations/20260424150000_075_project_correction_re_release_foundation.sql`
- `supabase/migrations/20260423120000_072_project_workspaces_foundation.sql`
- `supabase/migrations/20260415110000_055_project_participants_mixed_consent_foundation.sql`
- `supabase/migrations/20260422143000_067_consent_scope_state_foundations.sql`
- `supabase/migrations/20260422200000_069_upgrade_submit_binding_and_supersedence.sql`
- `src/lib/projects/project-workflow-service.ts`
- `src/lib/projects/project-workflow-route-handlers.ts`
- `src/lib/projects/project-workspace-request.ts`
- `src/app/api/projects/[projectId]/correction/start/route.ts`
- `src/app/api/projects/[projectId]/workspaces/[workspaceId]/correction-reopen/route.ts`
- `src/app/api/projects/[projectId]/finalize/route.ts`
- `src/app/api/projects/[projectId]/invites/route.ts`
- `src/app/api/projects/[projectId]/invites/[inviteId]/revoke/route.ts`
- `src/lib/idempotency/invite-idempotency.ts`
- `src/lib/invites/public-invite-context.ts`
- `src/lib/consent/submit-consent.ts`
- `src/app/i/[token]/consent/route.ts`
- `src/app/api/public/invites/[token]/headshot/route.ts`
- `src/app/api/public/invites/[token]/headshot/[assetId]/finalize/route.ts`
- `src/lib/projects/project-consent-upgrade-service.ts`
- `src/lib/projects/project-consent-upgrade-route-handlers.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/upgrade-request/route.ts`
- `src/lib/projects/project-participants-service.ts`
- `src/lib/projects/project-participants-route-handlers.ts`
- `src/app/api/projects/[projectId]/profile-participants/route.ts`
- `src/app/api/projects/[projectId]/profile-participants/[participantId]/consent-request/route.ts`
- `src/lib/recurring-consent/public-recurring-consent.ts`
- `src/app/rp/[token]/consent/route.ts`
- `src/lib/matching/project-matching-progress.ts`
- `src/lib/matching/project-recurring-sources.ts`
- `src/lib/matching/project-face-assignees.ts`
- `src/lib/project-releases/project-release-service.ts`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/components/projects/project-workflow-controls.tsx`
- `src/components/projects/create-invite-form.tsx`
- `src/components/projects/one-off-consent-upgrade-form.tsx`
- `src/components/projects/project-participants-panel.tsx`
- `messages/en.json`
- `messages/nl.json`
- `tests/feature-055-project-participants-foundation.test.ts`
- `tests/feature-055-project-participants-routes.test.ts`
- `tests/feature-067-consent-upgrade-foundation.test.ts`
- `tests/feature-067-consent-upgrade-route.test.ts`
- `tests/feature-069-upgrade-submit-foundation.test.ts`
- `tests/feature-071-one-off-current-surfaces.test.ts`
- `tests/feature-073-project-workflow-foundation.test.ts`
- `tests/feature-074-project-release-media-library.test.ts`
- `tests/feature-075-project-correction-workflow.test.ts`

Source-of-truth rule for this plan:

- Live code and live schema are authoritative.
- `research.md` is the primary synthesis source.
- Older RPI docs are context only.

## Verified current boundary

- Feature 075 correction is project-level state on `projects`, with workspace reopen tracked on `project_workspaces.reopened_at` / `reopened_by`.
- Feature 075 only reopened review-safe mutation surfaces. Invite creation, invite revoke, one-off upgrade creation, participant add, project recurring consent request creation, public token submit, public headshot upload/finalize, capture upload, staffing, and default-template changes are still blocked once a project is finalized.
- `assertWorkspacePublicSubmissionAllowed` remains strict and rejects any finalized project with `409 project_finalized`.
- `subject_invites`, `recurring_profile_consent_requests`, and `project_consent_upgrade_requests` currently have no correction provenance fields.
- Live workspace-era schema already made participant uniqueness and recurring project pending-request uniqueness workspace-scoped in Feature 072:
  - `project_profile_participants (tenant_id, project_id, workspace_id, recurring_profile_id)`
  - `recurring_profile_consent_requests (tenant_id, profile_id, project_id, workspace_id, consent_kind)` for pending project requests
- One-off upgrade submit and recurring project replacement already reuse the existing core consent/governing/supersedence flows. No separate correction-specific consent storage is needed.
- Release snapshot generation reads the current mutable project state at corrected finalization time and already produces v2+ immutable releases without mutating older releases.

## Options considered

### Provenance storage

Option A:

- `request_source` only

Rejected because:

- It does not distinguish the active correction cycle from a prior correction cycle.

Option B:

- `request_source` + `correction_opened_at_snapshot`

Viable, but weaker because:

- It loses the direct link back to the source release row that opened the correction cycle.

Option C:

- `request_source` + `correction_opened_at_snapshot` + `correction_source_release_id_snapshot` on token-bearing rows

Chosen because:

- It is still small.
- It gives durable auditability after correction closes.
- It gives the public token exception a clear active-cycle identity check.

### Correction authority seam

Option A:

- Reclassify invite/participant/request creation as normal review permission everywhere

Rejected because:

- It would blur normal project lifecycle boundaries and risk broadening reviewer authority outside correction.

Option B:

- Add a dedicated correction-consent-intake seam and route-level branching into it

Chosen because:

- It keeps normal finalized-project locks intact.
- It allows owner/admin/reviewer during correction without reopening capture.

### Public token exception design

Option A:

- Relax `assertWorkspacePublicSubmissionAllowed` globally when correction is open

Rejected because:

- It would reopen stale non-correction tokens.

Option B:

- Keep the existing helper strict and add a second correction-aware token gate used only by the relevant public routes

Chosen because:

- It is the narrowest safe exception.

### Recurring profile creation

Option A:

- Inline create brand-new recurring profiles from correction

Rejected for Feature 076 because:

- Live profile creation is still tenant-scoped profile management.
- It would widen permissions and UI scope beyond correction consent intake.

Option B:

- Existing recurring profiles only

Chosen because:

- It satisfies the correction use case without pulling in tenant-level profile management redesign.

## Recommendation

Implement Feature 076 as a bounded extension of Feature 075:

- Add explicit correction-cycle provenance only on token-bearing rows:
  - `subject_invites`
  - `recurring_profile_consent_requests`
- Add a dedicated correction-consent-intake permission seam for authenticated internal actions in correction-reopened workspaces.
- Reuse existing invite, upgrade, recurring request, supersedence, matching, and release snapshot behavior.
- Add a separate correction-aware public token write gate for one-off submit/headshot and recurring project submit.
- Keep validation blockers generic and keep capture/media/release boundaries unchanged.

## Chosen architecture

### Architectural statement

Feature 076 does not create correction-only consent tables, correction-only release rows, or a new correction UI area. Instead it extends the existing mutable project/workspace layer with:

- correction provenance on request rows that carry public tokens
- a correction-intake authorization seam for reviewer-capable users
- route-level branching so the same route/service can work in normal pre-finalization mode and in finalized correction mode
- narrow public-token exceptions tied to active correction-cycle provenance

### File-level seam summary

Schema:

- new migration under `supabase/migrations/`

Workflow and permission helpers:

- `src/lib/projects/project-workflow-service.ts`
- `src/lib/projects/project-workspace-request.ts`

One-off invite and upgrade:

- `src/lib/idempotency/invite-idempotency.ts`
- `src/lib/invites/public-invite-context.ts`
- `src/lib/projects/project-consent-upgrade-service.ts`
- `src/app/api/projects/[projectId]/invites/route.ts`
- `src/app/api/projects/[projectId]/invites/[inviteId]/revoke/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/upgrade-request/route.ts`
- `src/app/i/[token]/consent/route.ts`
- `src/app/api/public/invites/[token]/headshot/route.ts`
- `src/app/api/public/invites/[token]/headshot/[assetId]/finalize/route.ts`

Recurring participants and project recurring consent:

- `src/lib/projects/project-participants-service.ts`
- `src/lib/projects/project-participants-route-handlers.ts`
- `src/lib/recurring-consent/public-recurring-consent.ts`
- `src/app/api/projects/[projectId]/profile-participants/route.ts`
- `src/app/api/projects/[projectId]/profile-participants/[participantId]/consent-request/route.ts`
- `src/app/rp/[token]/consent/route.ts`

UI and i18n:

- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/components/projects/create-invite-form.tsx`
- `src/components/projects/one-off-consent-upgrade-form.tsx`
- `src/components/projects/project-participants-panel.tsx`
- `src/components/projects/invite-actions.tsx`
- `src/components/projects/project-workflow-controls.tsx`
- `messages/en.json`
- `messages/nl.json`

## Exact schema / model plan

### 1. `subject_invites`

Add:

- `request_source text not null default 'normal'`
- `correction_opened_at_snapshot timestamptz null`
- `correction_source_release_id_snapshot uuid null references public.project_releases(id) on delete restrict`

Constraints:

- `subject_invites_request_source_check`
  - `request_source in ('normal', 'correction')`
- `subject_invites_correction_provenance_shape_check`
  - normal rows must have both snapshot columns null
  - correction rows must have both snapshot columns non-null
- `subject_invites_correction_workspace_check`
  - if `request_source = 'correction'`, `workspace_id` must be non-null

Nullability/default behavior:

- Fresh rows default to `request_source = 'normal'`
- Fresh normal rows leave correction snapshots null
- No compatibility backfill logic beyond clean default behavior is needed for local reset-based development

Indexes:

- No new index required in the first slice
- Existing token-hash lookup and workspace/status blocker queries remain the primary access paths

Usage:

- Normal invites and normal upgrade-linked invites write `normal` + null snapshots
- Correction one-off invites and correction upgrade-linked invites write `correction` + the active project correction snapshots

### 2. `recurring_profile_consent_requests`

Add:

- `request_source text not null default 'normal'`
- `correction_opened_at_snapshot timestamptz null`
- `correction_source_release_id_snapshot uuid null references public.project_releases(id) on delete restrict`

Constraints:

- `recurring_profile_consent_requests_request_source_check`
  - `request_source in ('normal', 'correction')`
- `recurring_profile_consent_requests_correction_provenance_shape_check`
  - normal rows must have both snapshot columns null
  - correction rows must have both snapshot columns non-null
- `recurring_profile_consent_requests_correction_kind_check`
  - if `request_source = 'correction'`, then:
    - `consent_kind = 'project'`
    - `project_id is not null`
    - `workspace_id is not null`

Nullability/default behavior:

- Fresh rows default to `request_source = 'normal'`
- Baseline recurring consent requests remain normal rows

Indexes:

- No new index required in the first slice
- The existing workspace-aware pending project request unique index remains authoritative

Usage:

- Baseline recurring requests remain `normal`
- Normal project recurring requests before finalization remain `normal`
- Correction project recurring requests write `correction` + the active project correction snapshots

### 3. `project_consent_upgrade_requests`

Decision:

- Do not add correction metadata in Feature 076

Reason:

- The linked `subject_invites` row already carries the public-token provenance that matters for correction-cycle enforcement.
- This keeps the schema touch smaller while preserving auditability through the linked invite.

### 4. `project_profile_participants`

Decision:

- Do not add correction metadata in Feature 076

Reason:

- Participant rows do not carry public tokens.
- Validation blockers can remain generic.
- Participant rows are already workspace-scoped and idempotent through the existing unique index + conflict fallback.

### 5. Service and type updates

Update local type definitions to include the new provenance fields where relevant:

- `PublicInviteContext`
- `PublicRecurringConsentRequestScope`
- invite/request row types used in services and pages where provenance-aware logic is needed

## Exact correction-intake permission model

### Roles

Allowed during correction consent intake:

- `owner`
- `admin`
- `reviewer`

Denied:

- `photographer`

### Helper design

Add in `src/lib/projects/project-workflow-service.ts`:

- `assertWorkspaceCorrectionConsentIntakeAllowed(input)`

Behavior:

- reject archived projects with `409 project_archived`
- require project finalized
- require `correction_state = 'open'`
- require workspace `workflow_state = 'handed_off'`
- otherwise throw `409 project_finalized` or `409 workspace_review_locked`

Add in `src/lib/projects/project-workspace-request.ts`:

- `requireWorkspaceCorrectionConsentIntakeAccessForRequest(...)`
- `requireWorkspaceCorrectionConsentIntakeAccessForRow(...)`

Behavior:

- resolve workspace exactly like existing helpers
- require review-capable workspace access via `assertCanReviewWorkspaceAction`
- load project correction state
- apply `assertWorkspaceCorrectionConsentIntakeAllowed`

### Route branching rule

Routes that support both normal mode and correction mode will branch as follows:

- if project is not finalized:
  - keep the existing normal capture/review helper
- if project is finalized:
  - use the new correction-consent-intake helper

This keeps all other finalized-project locks intact.

### Participant add decision

Feature 076 will allow `owner` / `admin` / `reviewer` to add existing recurring profiles during correction.

Reason:

- The action is bounded to an existing project workspace and existing tenant profiles.
- It does not grant profile creation or profile editing authority.
- It aligns with the first-slice requirement that reviewer-capable users can fix consent-state problems during correction.

## Exact one-off invite / upgrade plan

### One-off correction invite creation

Reuse:

- `subject_invites`
- `createInviteWithIdempotency`
- `POST /api/projects/[projectId]/invites`

Service changes:

- Extend `createInviteWithIdempotency` input with optional provenance:
  - `requestSource?: 'normal' | 'correction'`
  - `correctionOpenedAtSnapshot?: string | null`
  - `correctionSourceReleaseIdSnapshot?: string | null`
- Default to normal/null for existing callers
- Persist the new fields when provided

Route changes:

- `POST /api/projects/[projectId]/invites`
  - keep current request/response body shape
  - if pre-finalization:
    - keep existing capture mutation access
  - if finalized:
    - require `requireWorkspaceCorrectionConsentIntakeAccessForRequest`
    - pass correction provenance into `createInviteWithIdempotency`

Idempotency:

- Keep the existing `Idempotency-Key` contract unchanged
- Correction invites remain retry-safe through the existing idempotency table and `token_hash` upsert behavior

Status and errors:

- keep existing `201` create and `200` idempotent replay
- keep existing body shape
- reuse current error codes where possible

### One-off correction invite revoke

Reuse:

- `POST /api/projects/[projectId]/invites/[inviteId]/revoke`

Route changes:

- if pre-finalization:
  - keep existing capture mutation path
- if finalized:
  - require correction-consent-intake access for the selected workspace and the invite row
  - after loading the invite row, require:
    - `request_source = 'correction'`
    - snapshots match the active project correction cycle
    - `status = 'active'`
    - `used_count = 0`

Behavior:

- keep revocation in the same table by updating `status = 'revoked'`
- keep the existing linked-upgrade cancellation behavior

Error handling:

- if provenance does not match the active correction cycle, return `409 invite_not_revokable`
- keep `404 invite_not_found` and `409 invite_not_revokable` semantics otherwise

### One-off consent upgrade during correction

Reuse:

- `project_consent_upgrade_requests`
- `createProjectConsentUpgradeRequest`
- existing one-off invite token flow

Route changes:

- `POST /api/projects/[projectId]/consents/[consentId]/upgrade-request`
  - if pre-finalization:
    - keep existing review mutation row access
  - if finalized:
    - use `requireWorkspaceCorrectionConsentIntakeAccessForRow` against the consent row

Service changes:

- extend `createProjectConsentUpgradeRequest` to detect correction mode from its caller and pass correction provenance into the linked `createInviteWithIdempotency` call
- do not add new fields to `project_consent_upgrade_requests`

Behavior:

- keep current pending-request sharing and supersedence logic
- keep current governing-consent retarget behavior in `submit_public_consent`
- keep current validation blocker behavior via pending upgrade request count

Release verification expectation:

- no special snapshot code is planned
- tests must prove that a corrected finalization publishes v2 with the upgraded one-off governing consent and scope state

## Exact recurring participant / request plan

### Existing recurring profile add during correction

Reuse:

- `project_profile_participants`
- `addProjectProfileParticipant`

Route changes:

- `POST /api/projects/[projectId]/profile-participants`
  - if pre-finalization:
    - keep existing capture path
  - if finalized:
    - use `requireWorkspaceCorrectionConsentIntakeAccessForRequest`

Behavior:

- keep the existing request body
- keep current service idempotency via unique violation fallback
- keep current readiness replay enqueue when the profile is baseline-ready

Invariant:

- adding a participant does not create project consent
- adding a participant does not by itself make the participant assignment-eligible

UI:

- this remains "add existing profile" only
- no inline brand-new profile creation in Feature 076

### Project recurring consent request during correction

Reuse:

- `recurring_profile_consent_requests`
- `createProjectProfileConsentRequest`
- the existing `create_recurring_profile_project_consent_request` RPC flow

Route changes:

- `POST /api/projects/[projectId]/profile-participants/[participantId]/consent-request`
  - if pre-finalization:
    - keep existing capture path
  - if finalized:
    - use `requireWorkspaceCorrectionConsentIntakeAccessForRequest`

Service and RPC changes:

- extend `createProjectProfileConsentRequest` to pass correction provenance into the RPC when the request is being created during correction
- extend the underlying RPC signature so project-kind correction requests write:
  - `request_source = 'correction'`
  - `correction_opened_at_snapshot`
  - `correction_source_release_id_snapshot`
- keep baseline recurring request behavior unchanged

### Same-family recurring project replacement / upgrade

Decision:

- Include it in Feature 076

Reason:

- Live code already uses the same project recurring request path for first-time requests and same-family newer-template replacement.
- Excluding it would create an artificial gap on top of a reusable existing seam.

Behavior:

- the old project recurring consent stays current until the replacement signs
- after signing, existing supersedence logic makes the new project recurring consent current
- no separate replacement route or table is needed

Blockers:

- pending recurring project requests, including pending replacement requests, continue to block validation through the existing generic pending-request count

## Exact public token exception plan

### New helper

Keep `assertWorkspacePublicSubmissionAllowed` unchanged.

Add in `src/lib/projects/project-workflow-service.ts`:

- `assertCorrectionScopedPublicSubmissionAllowed(input)`

Suggested input:

- `supabase`
- `tenantId`
- `projectId`
- `workspaceId`
- `requestSource`
- `correctionOpenedAtSnapshot`
- `correctionSourceReleaseIdSnapshot`

Behavior:

- load the project and workspace
- if project is archived:
  - throw `409 workspace_not_accepting_submissions`
- if project is not finalized:
  - allow only if the workspace is in the normal public-submission states
- if project is finalized:
  - require `correction_state = 'open'`
  - require workspace `workflow_state = 'handed_off'`
  - require `requestSource = 'correction'`
  - require both correction snapshots to match the active project correction cycle
  - otherwise throw `409 project_finalized`

### Route usage

One-off public routes:

- `src/app/i/[token]/consent/route.ts`
- `src/app/api/public/invites/[token]/headshot/route.ts`
- `src/app/api/public/invites/[token]/headshot/[assetId]/finalize/route.ts`

Change:

- extend `resolvePublicInviteContext` to return the new provenance fields
- replace the strict finalized-project check with the correction-aware helper

Recurring public route:

- `src/app/rp/[token]/consent/route.ts`

Change:

- extend `resolvePublicRecurringConsentRequestScope` to return the new provenance fields
- for `consentKind = 'project'`, call the correction-aware helper
- baseline recurring requests remain unchanged and outside correction logic

### Public error behavior

- keep the public UX unchanged:
  - blocked correction writes still map to `error=unavailable`
- reuse `409 project_finalized` for:
  - old pre-correction tokens
  - stale prior-cycle correction tokens
  - finalized projects with closed correction
  - tokens that are not correction-created

Reason:

- This avoids leaking correction state details.
- It minimizes new translation and error-surface work.

## Exact validation / finalization blocker plan

Keep the current blocker model generic.

### Tables and statuses

Validation and correction finalization continue to block on:

- active one-off invites
  - `subject_invites.status = 'active'`
  - workspace-scoped
- pending recurring project consent requests
  - `recurring_profile_consent_requests.status = 'pending'`
  - `consent_kind = 'project'`
  - workspace-scoped
- pending one-off consent upgrade requests
  - `project_consent_upgrade_requests.status = 'pending'`
  - workspace-scoped
- matching in progress or degraded
- pending photo asset and needs-review photo asset counts

### No correction-only blocker filtering

Do not try to block only correction-created rows.

Reason:

- finalized projects should already be clean before correction opens
- generic blockers are simpler and safer

One-off invite blocker clarification:

Validation/finalization should block on unresolved one-off invite work, not on rows that have already completed successfully.

During implementation, verify the live invite-consumption semantics. If successful public submit leaves `subject_invites.status = 'active'` but updates `used_count`, `submitted_at`, or another consumed marker, blocker queries must account for that and should not keep a completed correction invite blocking validation forever.

The blocker should represent unresolved active/pending invite work, not merely every row whose status string is `active` if live code uses a separate consumed marker.

### Public headshot upload / finalize in progress

No new dedicated blocker is planned.

Reason:

- correction one-off invites stay active until the consent submit or revoke path resolves them
- the existing active invite blocker keeps validation closed while public headshot work is still attached to an unresolved invite

## Exact matching / release snapshot plan

### Matching

No new matching architecture is planned.

Expected reused behavior:

- one-off correction submit keeps using the existing consent submit path and current headshot-ready enqueue
- one-off correction upgrade keeps using the existing governing-consent retarget logic in `submit_public_consent`
- recurring project correction submit keeps using the existing recurring submit path and current reconcile enqueue
- adding a recurring participant still only replays readiness; assignment eligibility still depends on current signed project consent
- review/linking surfaces continue to read current assignee state from existing tables
- workspace validation continues to wait for matching to settle through the current blockers

### Release snapshot

No release schema change is planned.

Expected reused behavior:

- corrected finalization produces a new release version
- v2+ snapshots current mutable project state at corrected finalization time
- Media Library latest-release behavior remains unchanged

Tests must verify that v2 captures:

- newly signed one-off consents
- upgraded one-off governing consent and effective scope state
- newly signed recurring project consents
- same-family recurring replacement current/governing state
- corrected exact-face and whole-asset links

## Exact UI / i18n plan

### Project page state

Add explicit correction-intake booleans in `src/app/(protected)/projects/[projectId]/page.tsx`:

- `correctionConsentIntakeActionsAllowed`
- `correctionConsentIntakeMutationsAllowed`

Derived rule:

- review-capable user
- project active
- correction open
- selected workspace exists
- selected workspace `workflow_state = 'handed_off'`

Then derive per-surface booleans:

- `oneOffInviteMutationsAllowed = captureMutationsAllowed || correctionConsentIntakeMutationsAllowed`
- `oneOffUpgradeMutationsAllowed = reviewConsentFlowMutationsAllowed || correctionConsentIntakeMutationsAllowed`
- `participantMutationsAllowed = captureMutationsAllowed || correctionConsentIntakeMutationsAllowed`

Do not widen:

- asset upload/finalize controls
- staffing controls
- default-template controls
- authenticated headshot replacement controls for existing one-off consents

### Existing components to reuse

- `CreateInviteForm`
- `OneOffConsentUpgradeForm`
- `ProjectParticipantsPanel`
- `InviteActions`

Minimal component changes:

- add a simple mode prop where it helps copy:
  - `mode?: 'normal' | 'correction'`
- or add correction-specific helper props if mode branching is too broad

Planned behavior:

- show one-off correction invite creation inside the existing right-side invite card area
- show one-off correction upgrade in the existing consent detail area
- show add-existing-profile and recurring project consent request actions in the existing participants panel
- show pending blocker copy through the existing workflow blocker list

### Workflow copy changes

Update `projects.detail.workflow.projectCorrectionCaptureLocked` in both locales.

Current live copy says invites and consent intake remain locked during correction. That will be false after Feature 076.

Replace with copy that stays true after Feature 076, for example:

- capture, staffing, and template changes remain locked during correction

Add minimal helper copy where needed to explain:

- correction consent intake is only available in reopened workspaces
- public completion links created during correction will be included in the next corrected release once resolved

### i18n

Add English and Dutch keys only where new UI text is actually introduced.

Likely namespaces:

- `projects.detail.workflow`
- `projects.invites`
- `projects.detail.upgradeRequest`
- `projects.participants`
- `projects.inviteActions`

Keep stored consent content unchanged.

## Security and reliability considerations

- Tenant scoping remains server-side for every route and service.
- The client never supplies `tenant_id`.
- Correction consent intake authority is reviewer-capable but only inside correction-reopened workspaces.
- Photographers remain blocked from correction consent intake because the new helper is review-authority based.
- Normal finalized-project locks stay intact for:
  - capture upload/finalize
  - staffing
  - default-template changes
  - any route not explicitly branched into the new correction seam
- Old non-correction public tokens stay blocked.
- Stale prior-cycle correction tokens stay blocked.
- Public routes continue to expose only token-scoped data.
- Invite and request creation remain retry-safe through existing idempotency or unique-violation patterns.
- Public submit remains idempotent through the existing RPC flows.
- Release history remains immutable because corrected output is a new release version, not an update to prior release rows.

## Edge cases

- Correction finalization vs public token submit:
  - existing active/pending blocker counts should prevent finalization while unresolved public correction work still exists
  - if a consent signs before corrected finalization, the new state is eligible for inclusion in v2
- Request creation vs validation:
  - generic active/pending blockers should keep validation closed until the new request is resolved or revoked
- Retry after invite or request creation:
  - keep existing 200 replay / 201 create behavior
- Retry after public submit:
  - reuse existing duplicate handling in one-off and recurring public submit
- Correction reopen on the wrong workspace:
  - correction intake helper requires the specific workspace to be `handed_off`
- Existing active consent plus recurring replacement request:
  - the old recurring project consent stays current until the replacement signs

## Test plan

### Schema and model

- migration test coverage for new provenance shape constraints on `subject_invites`
- migration test coverage for new provenance shape and kind constraints on `recurring_profile_consent_requests`
- fresh `supabase db reset` validation that normal rows default to `normal` + null snapshots

### Workflow and permissions

- owner/admin/reviewer can create correction one-off invites in reopened workspaces
- photographer is denied correction one-off invite creation
- owner/admin/reviewer can revoke correction-created active-cycle invites during correction
- photographers remain denied correction revoke
- owner/admin/reviewer can create one-off upgrade requests during correction
- owner/admin/reviewer can add existing recurring profiles during correction
- owner/admin/reviewer can create recurring project consent requests during correction
- capture upload/finalize, staffing, and default-template routes remain blocked during correction

### Public token bounds

- one-off correction invite submit succeeds for active-cycle correction invites
- one-off correction invite headshot upload succeeds for active-cycle correction invites
- one-off correction invite headshot finalize succeeds for active-cycle correction invites
- old pre-correction one-off tokens remain blocked during correction
- stale prior-cycle one-off correction tokens remain blocked
- recurring project correction request submit succeeds for active-cycle correction requests
- old normal recurring project tokens remain blocked during correction
- stale prior-cycle recurring correction tokens remain blocked
- all correction public writes are blocked again after corrected finalization

### Consent and governing behavior

- one-off upgrade signing supersedes the old consent and retargets governing assignees/links
- recurring same-family replacement keeps the old project recurring consent current until the new one signs
- recurring same-family replacement makes the new consent current after signing

### Validation and blocker behavior

- active correction one-off invites block workspace validation
- pending correction one-off upgrade requests block workspace validation
- pending correction recurring project requests block workspace validation
- matching in-progress or degraded state still blocks validation after new consent arrives

### Release outcomes

- corrected finalization publishes v2 without mutating v1
- v2 includes newly signed one-off correction consent
- v2 includes one-off upgraded governing consent and updated scope state
- v2 includes newly signed recurring project consent
- v2 includes recurring replacement governing/current state when included
- v2 includes corrected exact-face and whole-asset links
- Media Library still resolves the latest published release for the project

### Isolation

- cross-tenant denial for every new correction intake route
- cross-workspace denial for every new correction intake route
- correction revoke denied for invites outside the selected/reopened workspace

## Implementation phases

### Phase 1. Schema provenance

- add provenance columns and constraints to `subject_invites`
- add provenance columns and constraints to `recurring_profile_consent_requests`
- update TypeScript row types

### Phase 2. Correction consent-intake helper seam

- add `assertWorkspaceCorrectionConsentIntakeAllowed`
- add request/row access helpers in `project-workspace-request.ts`
- keep existing helpers unchanged

### Phase 3. One-off correction routes

- extend `createInviteWithIdempotency`
- branch invite create and invite revoke into correction mode
- branch one-off upgrade route/service into correction mode

### Phase 4. Recurring correction routes

- branch participant add into correction mode
- branch recurring project request creation into correction mode
- extend recurring project request creation to write correction provenance

### Phase 5. Public token exceptions

- extend public invite context and recurring request scope with provenance
- add correction-aware public submission helper
- update one-off public submit/headshot routes
- update recurring public submit route

### Phase 6. Blocker, matching, and release verification

- keep blocker queries generic
- add focused tests for matching settle requirements and v2 release content

### Phase 7. UI and i18n

- add correction-intake booleans on the project page
- reuse existing forms/panels in correction mode
- update English and Dutch copy

### Phase 8. Tests and verification

- extend route/service/integration coverage across permissions, public token bounds, blockers, and release outcomes

## Scope boundaries

In scope:

- correction-scoped one-off invites
- correction-scoped one-off upgrades
- existing recurring profile add
- correction-scoped project recurring consent requests
- same-path recurring project replacement/upgrade
- correction-scoped public token completion for active-cycle correction requests
- validation and corrected-finalization blockers
- minimal project-page UI and i18n changes

Out of scope:

- general recapture
- asset upload reopening during correction
- photographer correction consent authority
- staffing changes
- default-template changes
- template authoring changes
- Media Library editing
- release diff UI
- DAM sync or delta tables
- public sharing / folders / collections
- notification redesign
- tenant-wide recurring profile management redesign
- inline creation of brand-new recurring profiles

## Concise implementation prompt

Implement Feature 076 as a narrow correction-mode extension. Add correction provenance fields only to `subject_invites` and `recurring_profile_consent_requests`, add a dedicated correction-consent-intake helper seam for owner/admin/reviewer in correction-reopened `handed_off` workspaces, branch the existing invite/upgrade/participant/request routes into that seam when the project is finalized and correction-open, add a separate correction-aware public token submission gate for one-off and project-recurring correction-created active-cycle tokens, keep generic validation blockers, reuse existing consent/governing/matching/release logic, keep capture/staffing/default-template/media-library behavior unchanged, defer brand-new recurring profile creation, localize any new UI copy in English and Dutch, and cover permissions, stale-token denial, blockers, matching settle, release v2 content, and tenant/workspace isolation in tests.
