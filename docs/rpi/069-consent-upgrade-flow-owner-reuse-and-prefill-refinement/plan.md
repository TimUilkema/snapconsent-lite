# Feature 069 Plan - Consent upgrade-flow refinement for owner reuse, prefill, recurring project upgrades, and governing-consent matching behavior

## 1. Inputs and ground truth

Inputs reviewed in the required order:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `docs/rpi/README.md`
5. `docs/rpi/PROMPTS.md`
6. `docs/rpi/SUMMARY.md`
7. `docs/rpi/067-consent-scope-state-and-upgrade-requests/research.md`
8. `docs/rpi/067-consent-scope-state-and-upgrade-requests/plan.md`
9. `docs/rpi/069-consent-upgrade-flow-owner-reuse-and-prefill-refinement/research.md`
10. Targeted live verification only for the plan-critical seams

Path note:

- The repo does not contain root `PROMPTS.md` or `SUMMARY.md`.
- The live equivalents are `docs/rpi/PROMPTS.md` and `docs/rpi/SUMMARY.md`.

Targeted live verification used as current source of truth:

- `supabase/migrations/20260304210000_002_projects_invites_schema.sql`
- `supabase/migrations/20260327120000_023_request_uri_safety.sql`
- `supabase/migrations/20260403170000_031_face_level_photo_linking.sql`
- `supabase/migrations/20260415210000_058_project_face_assignee_bridge.sql`
- `supabase/migrations/20260421110000_061_asset_assignee_links.sql`
- `supabase/migrations/20260422143000_067_consent_scope_state_foundations.sql`
- `supabase/migrations/20260422172000_067_consent_scope_projection_write_path.sql`
- `src/app/i/[token]/page.tsx`
- `src/app/i/[token]/consent/route.ts`
- `src/app/rp/[token]/page.tsx`
- `src/app/rp/[token]/consent/route.ts`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/app/api/projects/[projectId]/assets/route.ts`
- `src/components/public/public-consent-form.tsx`
- `src/components/public/public-recurring-consent-form.tsx`
- `src/lib/consent/submit-consent.ts`
- `src/lib/consent/validate-consent-base-fields.ts`
- `src/lib/invites/public-invite-context.ts`
- `src/lib/matching/asset-preview-linking.ts`
- `src/lib/matching/auto-match-fanout-continuations.ts`
- `src/lib/matching/auto-match-reconcile.ts`
- `src/lib/matching/auto-match-worker.ts`
- `src/lib/matching/face-materialization.ts`
- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/project-face-assignees.ts`
- `src/lib/matching/project-recurring-sources.ts`
- `src/lib/matching/whole-asset-linking.ts`
- `src/lib/projects/project-consent-upgrade-service.ts`
- `src/lib/projects/project-participants-service.ts`
- `src/lib/recurring-consent/public-recurring-consent.ts`

Ground-truth conclusions from live verification:

- The protected upgrade-request create flow is already correct enough to keep. It creates a normal `subject_invites` row plus a `project_consent_upgrade_requests` row that stores the prior `subject_id`.
- The public sign path is still fully generic. `/i/[token]` and `submit_public_consent` do not currently use upgrade context, do not prefill, and do not bind submit to the stored `subject_id`.
- One-off scope-state reads already operate on `subject_id`, but most visible project and asset reads still operate on invite ids, consent ids, or assignee rows tied to a specific `consent_id`.
- `project_face_assignees`, `asset_face_consent_links`, manual fallback rows, and headshot lookups prove that one-off "current person" behavior is still operationally consent-centric.
- Exact-face and whole-asset links already hang off `project_face_assignee_id`, which gives this feature a bounded carry-forward seam.
- Manual zero-face fallback rows and some helper reads still store `consent_id` directly and need explicit carry-forward.
- Recurring already has `superseded_at` and `superseded_by_consent_id`, but recurring project request creation still rejects when an active project consent exists, recurring public signing is still generic, and recurring submit still rejects when an active unsuperseded project consent exists.
- `project-participants-service.ts` and `project-face-assignees.ts` currently model recurring project consent state as mutually exclusive: active or pending, not both. That conflicts with the product rule that an unsigned replacement request must not demote the already-signed current consent.
- Recurring project matching readiness is split today: source readiness comes from baseline consent plus recurring profile headshot state, while project participation and assignee creation still gate on active project consent `face_match_opt_in`. That means this feature can stay bounded to project-consent state, assignee selection, and matching-enqueue gatekeepers rather than redesigning baseline recurring source logic.
- Worker-side one-off eligibility checks in `auto-match-worker.ts`, `auto-match-fanout-continuations.ts`, `auto-match-reconcile.ts`, and current headshot reads still only treat `revoked_at` as inactive. They need governing-consent awareness so superseded or newly opted-out consents stop driving future matching work.

## 2. Verified current planning boundary

This plan stays inside the smallest additive correction needed to fix the observed upgrade mismatch.

Locked boundaries:

- Keep `consents` immutable.
- Do not overwrite prior signed rows.
- Keep Feature 067 scope-state foundations and projection writes.
- Keep the protected upgrade-request create flow and normal one-off invite transport.
- Keep the public sign route on `/i/[token]` and `/i/[token]/consent`.
- Keep recurring project public sign transport on `/rp/[token]` and `/rp/[token]/consent`.
- Do not redesign the one-off identity model across the whole app.
- Do not redesign matching, whole-asset linking, exports, or baseline recurring consent.
- Do not add outbound delivery or reminder work.

This plan does include:

- upgrade-aware public page context and form prefill
- submit-time binding to the existing owner
- one-off explicit supersedence
- bounded operational carry-forward for one-off current behavior
- minimal current-vs-history read refinements in the affected project and asset surfaces
- recurring project consent upgrade request/create, public prefill, submit, and current/history behavior
- the explicit rule that sending a replacement request does not supersede the current consent
- the explicit rule that future facial-matching eligibility follows the newly governing consent
- minimal recurring active-read parity fixes where live code still ignores `superseded_at`

## 3. Options considered

### Option A - Submit-path-only owner binding

Pros:

- smallest write-path change
- fixes email-change owner splitting

Cons:

- no prefill
- no headshot suppression
- no current-vs-history correction
- does not fix the observed "new current person" UX

### Option B - Upgrade-mode prefill plus owner binding only

Pros:

- fixes the public-form mismatch
- additive and low risk

Cons:

- still leaves the project page, asset people filter, headshot reads, and assignee reads treating the upgrade as a new current consent person

### Option C - Read-only current-owner inference with no explicit one-off supersedence

Pros:

- avoids schema changes on `consents`
- reuses existing subject-centric scope-state logic

Cons:

- leaves one-off current/history semantics implicit
- every consent-centric surface would need custom inference
- does not fit the current consent-id-heavy operational reads cleanly

### Option D - Upgrade-aware public flow plus explicit governing-consent transitions for one-off and recurring project consent

Pros:

- directly matches the product intent
- keeps history immutable
- gives one-off the same explicit current/history vocabulary recurring already has
- lets current one-off reads stop treating superseded rows as separate current people
- keeps recurring project consent additive by reusing existing request and consent tables instead of introducing a second upgrade system
- cleanly supports "old stays current until new signs" and "future matching follows the new governing consent"

Cons:

- medium complexity
- requires a small migration and several targeted helper/read updates

## 4. Recommendation

Choose Option D.

Why this is chosen over the smaller alternatives:

- A submit-path-only fix still leaves the visible product mismatch intact.
- A prefill-only fix still leaves the old and new one-off consents acting like separate current people.
- Read-only inference without one-off supersedence would spread brittle "latest consent for subject" logic across too many existing consent-centric reads.

Recommended bounded direction:

1. Make the public one-off invite flow upgrade-aware when the invite belongs to a pending `project_consent_upgrade_requests` row.
2. Make recurring project consent requests and the public `/rp/[token]` flow upgrade-aware when a pending project request coexists with an active unsuperseded project consent.
3. Prefill upgrade-mode values from the prior governing consent plus the current bound owner record.
4. Bind one-off submit to the prior `subject_id`, and bind recurring project submit to the existing `profile_id`, even when name or email changes.
5. Suppress one-off headshot upload in upgrade mode and reuse the existing headshot only when a reusable one exists.
6. Add explicit one-off supersedence on `consents` and reuse recurring's existing supersedence columns.
7. Do not supersede anything when a replacement request is created. Old one-off and recurring project consents remain current until the new version signs successfully.
8. Carry the current one-off operational identity forward to the new consent through the existing assignee seam and the small set of still-consent-backed rows.
9. Refine the minimum one-off, recurring project, and matching eligibility reads needed so superseded or newly opted-out governing consents stop appearing as current or driving future matching.

## 5. Chosen architecture

### 5.1 Public upgrade mode

- Keep `/i/[token]` as the public page.
- Keep `/rp/[token]` as the public recurring page.
- Keep `PublicConsentForm` as the main form component.
- Keep `PublicRecurringConsentForm` as the recurring project form component.
- Add optional `upgradeContext` and `initialValues` props instead of creating second upgrade-only public components.
- Add thin server-side helpers that resolve optional upgrade context after the normal public invite/request lookup succeeds.

### 5.2 Owner-binding model

- The authoritative owner for one-off upgrade submit is `project_consent_upgrade_requests.subject_id`.
- Upgrade submit never creates a new `subjects` row.
- Upgrade submit updates the existing bound subject row in place.
- The authoritative owner for recurring project upgrade submit is `recurring_profile_consent_requests.profile_id`.
- Recurring project upgrade submit never creates a new recurring profile.
- Recurring project upgrade submit stays anchored to the same `profile_id`; any allowed name/email edits update that same profile row rather than creating a second owner.

### 5.3 One-off current/history model

- Add explicit one-off supersedence markers on `consents`.
- Treat active one-off consent as `revoked_at is null and superseded_at is null`.
- Older signed one-off rows remain immutable history.
- Feature 067 scope-state reads should be updated to respect the explicit supersedence markers, not just latest-signed inference.

### 5.4 Recurring project current/history model

- Reuse existing `recurring_profile_consents.superseded_at` and `superseded_by_consent_id`.
- Treat active recurring project consent as `revoked_at is null and superseded_at is null`.
- A pending recurring project request does not change the active governing consent.
- Successful signing of the new recurring project consent supersedes the prior active project consent and makes the new one current.
- Older recurring project consents remain immutable history.

### 5.5 Operational carry-forward model

- Reuse the existing `project_face_assignees` row for the owner by retargeting it from the old consent to the new consent.
- Preserve exact-face and whole-asset links by keeping the assignee id stable.
- Update only the remaining consent-backed operational rows that still need the current consent id for reads or suppression behavior.
- For recurring project consent, do not mass-rewrite historical assignee or link rows. Future project behavior follows the newly active recurring project consent through active-state reads, new assignee creation, and matching gating keyed to the new governing consent.

This is the smallest change that fixes "same owner, new governing consent" without redesigning the whole one-off model.

## 6. Exact schema/model plan

### 6.1 `consents` one-off supersedence

Add to `public.consents`:

- `superseded_at timestamptz null`
- `superseded_by_consent_id uuid null references public.consents(id) on delete set null`

Add constraints and indexes:

- a supersedence timeline check matching the recurring pattern
- an index on `(tenant_id, project_id, subject_id, signed_at desc)`
- an index on `(tenant_id, superseded_by_consent_id)` where `superseded_by_consent_id is not null`
- an index on `(tenant_id, project_id, revoked_at, superseded_at)` for active/current reads

Deliberate non-decision:

- Do not add a global "one active one-off consent per subject" unique index. One-off supersedence in this slice is used for upgrade lineage, not as a global one-off redesign.

### 6.2 `consent_events`

Decision:

- Do not add a new one-off `superseded` consent event in this slice.

Reason:

- `consents.superseded_at`
- `consents.superseded_by_consent_id`
- `project_consent_upgrade_requests.completed_consent_id`

already provide explicit audit linkage, and `consent_events` currently has a tight `('granted','revoked')` check. Extending that event vocabulary is not required to fix the product mismatch.

### 6.3 Existing Feature 067 scope-state objects

Update the one-off effective-state selection logic so current one-off scope state is based on non-superseded consent rows, not just latest signed rows.

Meaning after Feature 069:

- current governing one-off scope state = latest signed consent for the owner and family where `revoked_at is null and superseded_at is null`
- historical one-off scope state = older signed rows still visible through history/audit reads

### 6.4 Recurring project supersedence model

Decision:

- reuse existing `recurring_profile_consents.superseded_at`
- reuse existing `recurring_profile_consents.superseded_by_consent_id`
- do not add new recurring supersedence columns
- do not add a new recurring upgrade table

Meaning after Feature 069:

- current recurring project consent = latest signed project consent for `(tenant_id, profile_id, project_id)` where `revoked_at is null and superseded_at is null`
- historical recurring project consent = older signed project consent rows, including rows later superseded by a newer signed version
- pending recurring project requests can coexist with an active current project consent and do not change current state until successful signing

### 6.5 No new upgrade table

Decision:

- Reuse the existing `project_consent_upgrade_requests` table.
- Do not add a second one-off upgrade workflow table.
- Reuse the existing `recurring_profile_consent_requests` table for recurring project upgrades.
- Do not add a recurring-project-specific upgrade table or generic request framework.

## 7. Exact public upgrade-context and prefill plan

### 7.1 One-off upgrade detection

The public page knows an invite is an upgrade invite by:

1. resolving the normal public invite from the token
2. resolving the invite id from the token server-side
3. loading a pending `project_consent_upgrade_requests` row by `invite_id`

If no pending upgrade row exists, render the existing standard one-off form behavior.

### 7.2 Recurring project upgrade detection

The public recurring page knows a request is a project upgrade by:

1. resolving the normal public recurring request from the token
2. loading the request scope for `requestId`
3. when `consent_kind = 'project'`, loading the current active recurring project consent for the same `(tenant_id, profile_id, project_id)`

If no current active project consent exists, render the existing standard recurring project request behavior.

### 7.3 Upgrade context payload

Add a server-side upgrade payload shaped like:

```ts
type PublicConsentUpgradeContext = {
  requestId: string;
  priorConsentId: string;
  boundSubjectId: string;
  reusableHeadshotAssetId: string | null;
  canEnableFaceMatch: boolean;
  initialValues: {
    subjectName: string;
    subjectEmail: string;
    faceMatchOptIn: boolean;
    structuredFieldValues: Record<string, string | string[] | null>;
  };
};
```

Source of each field:

- `requestId`, `priorConsentId`, `boundSubjectId` from `project_consent_upgrade_requests`
- `subjectName`, `subjectEmail` from the bound `subjects` row
- `faceMatchOptIn` and prior structured values from the prior `consents` row
- `reusableHeadshotAssetId` from the current valid headshot linked to the prior owner/consent
- `canEnableFaceMatch` = `Boolean(reusableHeadshotAssetId)`

Recurring project payload:

```ts
type PublicRecurringProjectUpgradeContext = {
  requestId: string;
  priorConsentId: string;
  boundProfileId: string;
  hasReusableProfileHeadshot: boolean;
  initialValues: {
    subjectName: string;
    subjectEmail: string;
    faceMatchOptIn: boolean;
    structuredFieldValues: Record<string, string | string[] | null>;
  };
};
```

Source of each field:

- `requestId`, `boundProfileId` from `recurring_profile_consent_requests`
- `priorConsentId` from the current active recurring project consent for that profile/project
- `subjectName`, `subjectEmail` from the bound recurring profile
- `faceMatchOptIn` and prior structured values from the prior active recurring project consent
- `hasReusableProfileHeadshot` from recurring profile headshot readiness; this is informative for UI copy and testing, not a requirement to allow opting in

### 7.4 Prefill rules

Prefill these fields:

- full name
- email
- one-off face-match opt-in, but only if `canEnableFaceMatch` is true
- recurring project face-match opt-in from the prior active project consent
- scope selections where the prior `optionKey` still exists on the new template version
- duration where the prior option key still exists on the new template version

Never prefill:

- the final acceptance checkbox
- any signature-equivalent confirmation

Newly added scopes on the newer template:

- appear normally in the form
- start unset
- are not represented as `not_collected` in form state

Removed options from the prior version:

- are ignored during prefill if they no longer exist on the target template

Recurring-specific rule:

- recurring project upgrade mode never asks for a new headshot on the public form
- if recurring project consent is opted in but the profile has no ready reusable headshot yet, the opt-in remains valid but future matching stays blocked until profile headshot readiness becomes ready

### 7.5 Form component strategy

Decision:

- keep `PublicConsentForm`
- keep `PublicRecurringConsentForm`
- add optional `upgradeContext`
- add optional `initialValues`
- add an explicit `mode: "standard" | "upgrade"`
- keep the existing layout renderers intact and add only thin upgrade-aware branches

This is smaller than creating second upgrade-only public components and keeps the existing layout renderers intact.

## 8. Exact submit/write-path plan

### 8.1 Submit authority and transaction boundary

All durable one-off upgrade writes stay inside `submit_public_consent`.
All durable recurring project upgrade writes stay inside `submit_public_recurring_profile_consent`.

The SQL functions become upgrade-aware by:

- resolving any pending `project_consent_upgrade_requests` row for the invite
- using that row to bind owner resolution and supersedence behavior
- resolving whether a recurring project request has a currently active governing consent for the same profile/project
- using that current recurring project consent only as upgrade context until the new row is signed successfully

The route handler remains responsible for:

- parsing and validating form inputs
- resolving upgrade context for UI-grade validation
- enqueuing best-effort downstream matching work after successful submit

### 8.2 Submit-time owner-binding rules

When the invite belongs to a pending upgrade request:

- load and lock the pending upgrade request row
- bind the new consent to `project_consent_upgrade_requests.subject_id`
- do not run email-based subject upsert logic for owner selection
- update `subjects.full_name` and `subjects.email` on that same subject row
- if the requested email collides with a different subject row in the same tenant/project, reject with conflict
- never create a new `subjects` row from an upgrade submit

When the invite is not an upgrade:

- keep the existing submit behavior

Recurring project upgrade submit rules:

- load and lock the pending recurring project request row
- resolve the bound `profile_id` from that request
- if a current active recurring project consent exists for that same profile/project, treat submit as an upgrade rather than rejecting it
- do not create a new recurring profile
- update `recurring_profiles.full_name` and `recurring_profiles.email` on that same profile row if the request accepts edited values
- if the requested email collides with a different recurring profile row in the same tenant, reject with conflict instead of merging or splitting identities
- if no current active project consent exists, keep the existing non-upgrade project-request behavior

### 8.3 Headshot write behavior

In upgrade mode:

- the form never uploads a headshot
- if `face_match_opt_in = true`, the server may only accept it when a reusable headshot asset exists
- if accepted, insert `asset_consent_links(asset_id, new_consent_id, tenant_id, project_id)` for the reusable asset
- if `face_match_opt_in = false`, do not create a headshot link for the new consent

Extend the submit result so the route receives the effective headshot asset id used by the RPC:

- uploaded asset id for standard flow
- reused asset id for upgrade flow
- `null` when none is used

Recurring project behavior:

- the public recurring project form still does not upload a headshot
- successful upgrade submit does not create, replace, or supersede recurring profile headshot rows
- if the new governing recurring project consent keeps `face_match_opt_in = true`, future project matching may continue under the new governing consent using the existing recurring profile headshot/readiness model
- if the new governing recurring project consent sets `face_match_opt_in = false`, preserve existing links/history but stop treating that participant as an active project matching source

### 8.4 Governing-consent transition rule

Locked rule for both one-off and recurring project consent:

- creating or sending a replacement request does not supersede the current consent
- the old consent stays current/live until the new version is signed successfully
- supersedence and current-governing transition happen only after the new signed row is committed successfully

### 8.5 One-off supersedence write sequence

On successful upgrade submit, after the new immutable consent row is inserted:

1. write Feature 067 scope projections for the new consent
2. set the prior consent's `superseded_at`
3. set the prior consent's `superseded_by_consent_id = new_consent_id`
4. mark the upgrade request `status = 'signed'` and `completed_consent_id = new_consent_id`

### 8.6 Recurring project supersedence write sequence

On successful recurring project upgrade submit, after the new immutable `recurring_profile_consents` row is inserted:

1. write Feature 067 scope projections for the new recurring project consent
2. set the prior recurring project consent's `superseded_at`
3. set the prior recurring project consent's `superseded_by_consent_id = new_consent_id`
4. mark the recurring request `status = 'signed'`
5. do not rewrite historical recurring project assignee rows or existing historical match/link rows

### 8.7 Operational carry-forward write sequence

Minimum exact operational carry-forward in this slice:

1. Retarget the existing one-off `project_face_assignees` row from `prior_consent_id` to `new_consent_id`
2. Update `asset_face_consent_links.consent_id` where `project_face_assignee_id` is that reused assignee
3. Update `asset_consent_manual_photo_fallbacks.consent_id` from the prior consent to the new consent
4. Update `asset_consent_manual_photo_fallback_suppressions.consent_id` from the prior consent to the new consent

Deliberate non-moves:

- Do not rewrite historical match candidates, compare rows, or observability tables keyed to the old consent
- Do not rewrite whole-asset link rows because `asset_assignee_links` already follow `project_face_assignee_id`
- Do not rewrite face-assignee suppressions because they already follow `project_face_assignee_id`
- Do not mass-rewrite recurring project assignee or link rows. Recurring project upgrades switch current behavior by changing the active governing consent and letting future reconcile/create paths use the new recurring consent id.

### 8.8 Idempotency and retry behavior

- duplicate submit replay remains keyed by unique `consents.invite_id`
- duplicate recurring submit replay remains keyed by unique `recurring_profile_consents.request_id`
- supersedence update is deterministic because the same prior/new pair is reapplied
- assignee retarget and consent-id carry-forward updates are deterministic updates
- headshot reuse insert is `on conflict do nothing`

### 8.9 Post-commit best-effort work

After submit succeeds:

- if the effective headshot asset id is non-null and `face_match_opt_in = true`, enqueue the existing headshot-ready job for the new consent
- if a recurring project upgrade signs with `face_match_opt_in = true`, enqueue the existing recurring project reconcile path against the new governing consent
- if a one-off or recurring upgrade signs with `face_match_opt_in = false`, do not enqueue new compare, auto-match, or likely-match work for that owner under the new governing consent
- if enqueue fails, keep the consent success and rely on existing reconcile/repair patterns

## 9. Exact current-vs-history read/UI plan

### 9.1 Project page

Decision:

- keep the existing invite/consent-card style rather than introducing a new owner-detail page
- add explicit current-versus-history separation

Current one-off section:

- sourced from one-off consents where `revoked_at is null and superseded_at is null`
- each card is anchored to the invite that produced that active consent
- pending upgrade request state attaches to the active consent card

History section:

- contains superseded one-off consents
- contains revoked one-off consents
- keeps the older consent detail access intact
- marks superseded rows clearly as history

This is the smallest UI change that stops upgraded signers from appearing as two current people.

### 9.2 Recurring project participant panel

Decision:

- keep the existing participant card layout
- stop treating `pendingRequest` as mutually exclusive with `activeConsent`

Target data shape change:

- `projectConsent.state` continues to describe the current governing consent state
- `projectConsent.pendingRequest` becomes orthogonal and may coexist with `activeConsent`

Behavior:

- if active recurring project consent exists and a newer request is pending, the card stays `signed`
- the UI keeps showing the current active consent/template/signed timestamp
- the UI also shows the pending replacement request metadata and share actions
- if the pending request expires or is abandoned, the active current consent remains unchanged
- if the pending request signs successfully, the new recurring consent becomes active and the old one drops into history through existing supersedence semantics

This is the smallest UI/read change that satisfies the product rule without redesigning recurring history screens.

### 9.3 Asset people filter

Keep the existing query shape:

- continue using `consentId`

Refine the option source:

- only expose active unsuperseded one-off consents
- do not expose superseded one-off consents as selectable current people

No subject-based filter redesign in this slice.

### 9.4 Asset preview and linked-person reads

Current one-off linked-person behavior should resolve through the new current consent after upgrade by:

- reusing the assignee row
- updating consent-backed current link rows
- loading summaries/headshots from the new active consent id

Targeted read helpers to refine:

- `asset-preview-linking.ts`
- `project-face-assignees.ts`
- `assets/route.ts`
- any one-off current headshot helper that still reads "current" purely by `consent_id` without supersedence awareness

Recurring project read refinements:

- `project-participants-service.ts` active recurring project reads must filter `revoked_at is null and superseded_at is null`
- `project-face-assignees.ts` recurring state helpers must allow `activeConsent` and `pendingRequest` to coexist
- any recurring project panel helper or badge logic that currently downgrades signed to pending must be updated so unsigned replacement requests do not replace the active consent

### 9.5 Headshot current-read semantics

Update current headshot reads so active one-off headshots are based on non-superseded consents.

At minimum update:

- `list_current_project_consent_headshots`
- any current headshot thumbnail helper used by project page and asset API

### 9.6 Scope-state reads

The existing Feature 067 one-off scope-state helper remains the operational source.

Refinement:

- when selecting the governing one-off consent, treat superseded one-off rows as historical, not current
- when selecting the governing recurring project consent, treat superseded rows as historical and do not let a pending replacement request demote the still-active consent

## 10. Headshot and face-match upgrade behavior

Locked one-off upgrade-mode behavior:

- Headshot upload UI is hidden.
- Headshot upload API is not used.
- Acceptance is still unchecked.
- Face-match opt-in remains user-editable only when a reusable one-off headshot exists.
- If no reusable one-off headshot exists, upgrade mode renders face-match opt-in off and does not allow enabling it in this slice.
- If prior consent had opt-in true but the reusable one-off headshot is no longer valid, upgrade mode forces the new consent's face-match opt-in to false unless a later feature adds replace-headshot support.

Reuse rules:

- prior reusable headshot exists + submit opt-in true -> reuse that headshot for the new consent
- prior reusable headshot exists + submit opt-in false -> do not link a headshot to the new consent
- no reusable headshot exists -> no headshot linked to the new consent

Locked governing-consent matching rule for both one-off and recurring project consent:

- if the new governing consent keeps face matching enabled:
  - preserve carried-forward links/history
  - reuse the existing reusable matching source
  - continue future matching under the new governing consent
- if the new governing consent disables face matching:
  - preserve existing links/history
  - do not auto-delete current links
  - stop treating the owner as an active matching source
  - do not enqueue new compare, auto-match, or likely-match work for that owner

Recurring project specifics:

- recurring project public signing still does not offer headshot upload or replacement
- recurring project face-match opt-in remains editable on the public form even if headshot readiness is not currently ready
- existing recurring profile headshot rows stay unchanged during recurring project upgrade
- if V1 was opted in and V2 stays opted in, future project matching continues under the new active recurring project consent once baseline/profile-headshot readiness is ready
- if V1 was opted in and V2 opts out, existing recurring links/history remain but project matching helpers and enqueue gatekeepers must stop using that participant as an active matching source
- if V1 was opted out and V2 opts in, future matching may resume under the new governing recurring project consent, but only when the recurring profile also has reusable headshot readiness

Matching gatekeeper updates required in this slice:

- one-off consent eligibility checks in `auto-match-worker.ts`, `auto-match-fanout-continuations.ts`, `auto-match-reconcile.ts`, and one-off current-headshot loaders must treat `superseded_at` as inactive
- recurring project helper reads that determine active consent and assignee eligibility must use the new active project consent after sign and stop future work when that new governing consent opts out

## 11. Security and reliability considerations

- Tenant scope remains server-derived and present on every read and write.
- Public token safety remains unchanged: invite and upgrade binding are resolved server-side from the token, never from client-submitted ids.
- Submit-time owner binding trusts only the server-loaded `project_consent_upgrade_requests.subject_id`.
- Recurring project submit trusts only the server-loaded `recurring_profile_consent_requests.profile_id`.
- Upgrade submit must not silently split owner identity when email changes.
- Upgrade submit must not silently merge two different subjects when the new email already belongs to another subject row. Reject instead.
- Recurring project upgrade submit must not silently create or merge recurring profiles when email changes. Reject conflict instead.
- All durable write-path steps should execute inside the existing authoritative SQL submit transaction.
- The only allowed partial failure after commit is best-effort async enqueue.
- Duplicate upgrade requests remain controlled by the existing pending unique index.
- One-off or recurring replacement requests that are created but never completed must not change the current governing consent.
- Duplicate submit replay remains safe through `consents.invite_id` uniqueness and deterministic carry-forward updates.
- Matching stop/start behavior must be server-authoritative: workers and reconcile helpers must consult the new governing consent before future work proceeds, so an opt-out on the new governing consent cannot silently keep producing new matches.

## 12. Edge cases

- Upgrade submit with changed email:
  keep same `subject_id`, update the row, reject on conflicting email collision
- Upgrade submit with changed full name:
  keep same `subject_id`, update the row
- Recurring project replacement request sent but never completed:
  old recurring project consent stays current/live
- One-off replacement request sent but never completed:
  old one-off consent stays current/live
- New scopes added in the newer version:
  present but unset on the form
- Removed scopes:
  ignored during prefill if no longer in the target template
- Upgrade with reusable prior headshot and opt-in retained:
  reuse headshot and enqueue new-consent matching
- Upgrade with no reusable prior headshot:
  no upload, no opt-in enablement in this slice
- Upgrade opt-out from face matching:
  no new matching work under the new governing consent; existing links/history remain preserved
- V1 opted in, V2 opted out:
  preserve existing links/history, but stop active-source treatment and stop new matching jobs
- V1 opted out, V2 opted in:
  one-off requires reusable carried-forward headshot; recurring project may resume future matching only when recurring profile headshot readiness is available
- Repeated upgrade submit:
  returns the same consent result and does not duplicate supersedence or carry-forward effects
- Repeated recurring project submit replay:
  returns the same consent result and does not duplicate supersedence
- Superseded one-off consent still referenced by current rows:
  fixed by assignee retarget plus consent-id carry-forward updates
- Superseded recurring project consent still referenced by historical rows:
  preserve those rows as history; current reads must translate to the new active governing consent instead of rewriting history
- Historical display after mutable subject field changes:
  older one-off rows still inherit the existing subject-display limitation; this is noted but not redesigned here
- Multiple active one-off template families for the same subject in one project:
  current/history logic in this slice is targeted at upgrade lineage; broader multi-family owner presentation remains out of scope

## 13. Test plan

Required coverage:

### Public upgrade context and form

- upgrade invite page loads upgrade context
- full name/email prefill from bound subject
- recurring project public page loads upgrade context when a pending project request has a current active governing consent
- scope and duration prefill only for matching option keys
- newly added scopes remain unset
- acceptance checkbox remains unchecked
- headshot upload UI is suppressed in upgrade mode
- one-off face-match toggle behavior matches reusable-headshot availability
- recurring project face-match toggle remains editable without adding a public headshot flow

### Submit path

- upgrade submit reuses the same `subject_id` even when email changes
- upgrade submit updates the bound subject row
- conflicting email change rejects instead of creating or merging subjects
- upgrade submit never creates a new subject
- recurring project upgrade submit reuses the same `profile_id`
- recurring project replacement request creation is allowed while an active project consent exists
- request creation alone leaves the old one-off or recurring project consent current
- reusable headshot is linked to the new consent when allowed
- no reusable headshot means opt-in true is rejected server-side

### One-off supersedence and carry-forward

- new consent is inserted immutably
- prior consent gains `superseded_at` and `superseded_by_consent_id`
- old consent remains queryable as history
- existing one-off assignee row is reused and retargeted
- `asset_face_consent_links.consent_id` is carried forward
- manual fallback and fallback-suppression rows are carried forward
- whole-asset links remain valid without rewriting `asset_assignee_links`

### Recurring project supersedence and current behavior

- unsigned recurring replacement request does not replace the active consent in project participant reads
- signed recurring replacement request supersedes the prior active project consent
- recurring participant panel can show active consent and pending request together
- recurring project active-state reads ignore superseded consents
- future recurring project assignee creation and reconcile paths use the new active recurring project consent after sign
- historical recurring links remain preserved without mass rewrites

### Read surfaces

- project page stops showing superseded one-off consents as separate current people
- project page still shows superseded consent in history
- asset people filter excludes superseded one-off consents
- asset preview linked people/headshots resolve to the new active consent
- one-off scope-state reads follow the new governing consent
- recurring project participant UI keeps signed current state until the new request signs
- recurring project participant UI shows pending replacement request without demoting the active consent
- recurring current-state helpers respect `superseded_at`

### Reliability

- duplicate submit replay is idempotent
- enqueue failure after submit does not roll back consent success

### Governing-consent matching

- one-off governing-consent opt-out stops new matching work without deleting history
- recurring project governing-consent opt-out stops new matching work without deleting history
- no new matching jobs are enqueued when the new governing consent disables face matching
- future matching continues under the new governing consent when opt-in remains enabled
- worker-side one-off consent eligibility ignores superseded consents

### Minimal recurring parity

- recurring participant active-state reads ignore superseded recurring consents
- recurring assignee active-state reads ignore superseded recurring consents

## 14. Implementation phases

### Phase 1 - Schema and current/history foundations

- add one-off supersedence columns and constraints on `consents`
- update one-off effective-state SQL/view logic to respect supersedence
- update current one-off headshot SQL to respect supersedence
- update recurring project create/read helpers so pending replacement requests can coexist with an active current consent
- add minimal recurring active-read parity filters for `superseded_at`
- update worker-side one-off consent eligibility gates so superseded consents are inactive for future matching

### Phase 2 - Public upgrade context and prefill

- add server helper for optional public upgrade context
- wire `/i/[token]` to pass `upgradeContext` and `initialValues`
- wire `/rp/[token]` to pass recurring project upgrade context and `initialValues`
- update `PublicConsentForm` for upgrade mode, prefill, and no-upload behavior
- update `PublicRecurringConsentForm` for project upgrade prefill while keeping no-headshot public behavior

### Phase 3 - Submit-time owner binding and governing-consent transition

- make route validation upgrade-aware
- make `submit_public_consent` anchor to the bound subject for upgrade invites
- update subject fields on the same owner
- reuse prior headshot when allowed
- return effective headshot asset id from submit
- make recurring project request creation allow active-current plus pending-replacement
- make `submit_public_recurring_profile_consent` allow project upgrades to sign against the same `profile_id`
- update recurring project owner fields on the same profile when accepted
- supersede the prior recurring project consent only after the new recurring consent signs successfully

### Phase 4 - One-off supersedence and operational carry-forward

- set prior consent supersedence on successful upgrade
- retarget the existing one-off assignee row
- carry forward consent-backed current link and fallback rows
- keep compare/candidate history untouched

### Phase 5 - Current-vs-history and governing-matching read refinements

- refine project page current/history split
- refine recurring project participant panel data shape so active consent and pending request can coexist
- refine asset people filter option source
- refine asset preview/headshot summary reads so superseded one-off rows stop surfacing as current
- refine matching gatekeepers so the new governing consent controls future one-off and recurring project matching eligibility

### Phase 6 - Hardening and tests

- add/extend tests for prefill, owner reuse, headshot reuse, supersedence, current/history reads, recurring project upgrade behavior, and governing-consent matching eligibility

## 15. Scope boundaries

In scope:

- one-off upgrade-mode public form behavior
- same-owner submit binding even when email changes
- one-off explicit current-vs-history semantics
- no headshot reupload in upgrade mode
- bounded operational carry-forward to keep current one-off behavior anchored to the same owner
- narrow project and asset read refinements needed to stop showing superseded one-off consents as separate current people
- recurring project consent replacement-request behavior where old consent stays current until new signing
- recurring project public upgrade prefill and submit behavior
- recurring project current-vs-history and pending-versus-active read refinements
- governing-consent matching eligibility changes for one-off and recurring project consent
- minimal recurring active-read parity fixes

Out of scope:

- Feature 067 scope-state redesign
- per-scope revocation
- generic one-off identity redesign across the app
- baseline recurring redesign
- baseline recurring upgrade redesign
- matching-system redesign
- whole-asset linking redesign
- notification, reminder, or outbound delivery work
- immutable one-off name/email snapshot redesign
- broad admin history UI redesign

## 16. Concise implementation prompt

Implement Feature 069 by following this plan as the implementation contract.

Keep the existing one-off upgrade-request create flow and existing public transports on `/i/[token]` and `/rp/[token]`. Make the one-off public invite page upgrade-aware when the invite belongs to a pending `project_consent_upgrade_requests` row, and make recurring project public signing upgrade-aware when a pending project request coexists with an active current recurring project consent. Prefill safe prior values, keep acceptance unchecked, suppress one-off headshot upload in upgrade mode, and do not add a recurring public headshot flow. On submit, bind one-off upgrades to the stored `subject_id` and recurring project upgrades to the stored `profile_id`, update the same owner row in place, reject conflicting email collisions instead of creating or merging owners, and reuse the prior one-off headshot only when a reusable one exists.

Add explicit one-off supersedence on `consents` with `superseded_at` and `superseded_by_consent_id`, reuse recurring's existing supersedence columns, and do not mutate historical signed rows. Do not supersede the current one-off or recurring project consent when a replacement request is merely created; keep the old consent current until the new one signs successfully. After successful one-off upgrade submit, make the new consent operationally current by retargeting the existing one-off assignee row and carrying forward the small set of still-consent-backed current rows: `asset_face_consent_links.consent_id`, `asset_consent_manual_photo_fallbacks.consent_id`, and `asset_consent_manual_photo_fallback_suppressions.consent_id`. After successful recurring project upgrade submit, supersede the prior recurring project consent but preserve existing historical assignee/link rows and let future recurring project behavior follow the new active consent through current-state reads and new reconcile paths. Leave historical compare and candidate rows untouched. Update one-off current headshot reads, Feature 067 effective-state reads, recurring project participant reads, and matching gatekeepers so superseded or newly opted-out governing consents no longer behave as current and no longer drive future matching work, while existing links/history remain preserved.
