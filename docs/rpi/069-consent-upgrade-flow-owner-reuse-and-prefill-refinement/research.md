# Feature 069 Research - Consent upgrade-flow refinement for owner reuse, prefill, and active-vs-history behavior

## 1. Inputs reviewed

Required inputs reviewed in order:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `docs/rpi/README.md`
5. `docs/rpi/PROMPTS.md`
6. `docs/rpi/SUMMARY.md`
7. `docs/rpi/067-consent-scope-state-and-upgrade-requests/research.md`
8. `docs/rpi/067-consent-scope-state-and-upgrade-requests/plan.md`

Path note:

- The repo does not contain root-level `PROMPTS.md` or `SUMMARY.md`.
- The live equivalents are `docs/rpi/PROMPTS.md` and `docs/rpi/SUMMARY.md`, which are also the paths referenced by Feature 067 research.

Live code, schema, routes, helpers, and tests inspected as source of truth:

- `supabase/migrations/20260304210000_002_projects_invites_schema.sql`
- `supabase/migrations/20260415110000_055_project_participants_mixed_consent_foundation.sql`
- `supabase/migrations/20260415210000_058_project_face_assignee_bridge.sql`
- `supabase/migrations/20260422143000_067_consent_scope_state_foundations.sql`
- `supabase/migrations/20260422172000_067_consent_scope_projection_write_path.sql`
- `src/app/api/projects/[projectId]/consents/[consentId]/upgrade-request/route.ts`
- `src/app/i/[token]/page.tsx`
- `src/app/i/[token]/consent/route.ts`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/app/api/projects/[projectId]/assets/route.ts`
- `src/components/public/public-consent-form.tsx`
- `src/components/consent/consent-form-layout-renderer.tsx`
- `src/components/projects/one-off-consent-upgrade-form.tsx`
- `src/lib/consent/submit-consent.ts`
- `src/lib/consent/project-consent-scope-state.ts`
- `src/lib/idempotency/invite-idempotency.ts`
- `src/lib/invites/public-invite-context.ts`
- `src/lib/matching/asset-preview-linking.ts`
- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/project-face-assignees.ts`
- `src/lib/matching/whole-asset-linking.ts`
- `src/lib/projects/project-consent-upgrade-route-handlers.ts`
- `src/lib/projects/project-consent-upgrade-service.ts`
- `src/lib/projects/project-participants-service.ts`
- `tests/feature-055-project-participants-foundation.test.ts`
- `tests/feature-067-consent-upgrade-foundation.test.ts`
- `tests/feature-067-consent-upgrade-route.test.ts`
- `tests/feature-067-consent-upgrade-ui.test.ts`

## 2. Verified current implemented behavior after Feature 067

### 2.1 What the current one-off upgrade request flow does

Protected creation flow:

- Upgrade requests are created through `POST /api/projects/[projectId]/consents/[consentId]/upgrade-request`.
- The route delegates to `createProjectConsentUpgradeRequest`.
- The service validates that:
  - the prior consent exists in the same project and tenant
  - the prior consent is not revoked
  - the target template is a newer published version in the same template family
- It then creates:
  - a new standard `subject_invites` row via `createInviteWithIdempotency`
  - a new `project_consent_upgrade_requests` row linked to the same `subject_id` as the prior consent
- It does not create a new consent yet. The public signer still completes a normal one-off invite flow.

What rows are created when the upgrade request is made:

- `subject_invites`
- `project_consent_upgrade_requests`
- `idempotency_keys` rows for both the invite create and the upgrade-request create paths

Verified live behavior:

- The upgrade request service is already owner-aware at request-creation time because it stores `subject_id` from the prior consent on `project_consent_upgrade_requests`.
- Feature 067 tests assert that the second signing event can reuse the same `subject_id` when the upgraded signer submits the same email.

### 2.2 What public route handles upgrade signing

There is no separate public upgrade route.

Current public upgrade signing uses the same one-off invite path as a fresh signer:

- public page: `GET /i/[token]`
- public submit: `POST /i/[token]/consent`
- route helper: `submitConsent`
- SQL/RPC authority: `submit_public_consent`

The public page and form are generic invite surfaces:

- `src/app/i/[token]/page.tsx` loads only generic invite/template data via `get_public_invite`.
- `PublicConsentForm` accepts only:
  - `token`
  - `consentText`
  - `structuredFieldsDefinition`
  - `formLayoutDefinition`
- There is no upgrade-mode prop, no prior-consent context, and no server-provided prefill payload.

### 2.3 How submit currently resolves the one-off owner

The submit path is still a generic one-off invite submit.

Current server-side owner resolution:

- `submit_public_consent` resolves the invite by token.
- It validates the current template version attached to that invite.
- It then upserts `subjects` on the unique key `(tenant_id, project_id, email)`.
- If the submitted email matches an existing subject in that project, the existing `subject_id` is reused and `full_name` is updated.
- If the submitted email differs, a new `subjects` row is created.
- The new `consents` row is then inserted against that resolved `subject_id`.

Current implication:

- Upgrade submit is not anchored to `project_consent_upgrade_requests.subject_id`.
- Owner reuse currently depends on submitted email equality, not on the upgrade request's prior owner binding.
- Name edits are safe for owner reuse only when the email stays the same.
- Email edits currently break owner reuse by creating a new subject.

### 2.4 What Feature 067 already got right

Feature 067 already added a subject-centric current scope-state foundation for one-off project consent:

- `project_consent_scope_signed_projections` stores one-off scope projections with `owner_kind = 'one_off_subject'` and `subject_id`.
- `project_consent_scope_effective_states` derives the governing one-off scope state by latest signed event per:
  - tenant
  - project
  - owner kind
  - `subject_id`
  - `template_key`
- `loadProjectConsentScopeStatesByConsentIds` already collapses one-off scope reads to the owner boundary, not the consent row boundary.

So the scope-state foundation already treats one-off upgrades more like "new signed version for the same owner" than "totally new person".

### 2.5 Why the current UX still behaves like a new separate one-off person

The live system now has split one-off identity boundaries:

- scope-state reads are subject-centric
- most project and asset UX is still consent-centric or invite-centric

That split is the core mismatch.

## 3. Current schema, routes, helpers, and UI surfaces involved

### 3.1 Schema and DB behavior

One-off identity and signing foundation:

- `subjects`
  - project-local uniqueness by `(tenant_id, project_id, email)`
- `subject_invites`
  - normal one-off invite transport
- `consents`
  - immutable signed one-off rows
  - no current one-off supersedence marker today
- `project_consent_upgrade_requests`
  - thin workflow row linking prior consent, `subject_id`, target template, invite, and eventual completed consent
- `project_consent_scope_signed_projections`
  - one-off scope rows anchored to `subject_id`
- `project_consent_scope_effective_states`
  - current effective scope state anchored to one-off owner `subject_id`

Recurring comparison points:

- `recurring_profile_consents` already has `superseded_at` and `superseded_by_consent_id`
- recurring submit logic already treats active as `revoked_at is null and superseded_at is null`
- some recurring read helpers still only filter `revoked_at is null`, so current read behavior is not fully aligned with the schema

### 3.2 Protected one-off upgrade creation path

- `src/app/api/projects/[projectId]/consents/[consentId]/upgrade-request/route.ts`
- `src/lib/projects/project-consent-upgrade-route-handlers.ts`
- `src/lib/projects/project-consent-upgrade-service.ts`
- `src/lib/idempotency/invite-idempotency.ts`

### 3.3 Public one-off signing path used by upgrades

- `src/app/i/[token]/page.tsx`
- `src/components/public/public-consent-form.tsx`
- `src/components/consent/consent-form-layout-renderer.tsx`
- `src/app/i/[token]/consent/route.ts`
- `src/lib/consent/submit-consent.ts`
- SQL `submit_public_consent`

### 3.4 One-off current-vs-history and owner display surfaces

Project page:

- `src/app/(protected)/projects/[projectId]/page.tsx`
- One-off participants are currently loaded from `subject_invites` with nested `consents`
- The page renders invite cards, not owner cards

Project assets and people filter:

- `src/app/api/projects/[projectId]/assets/route.ts`
- People filter options are built directly from `consents`
- Selected person filter uses `consentId`

Asset preview and assignee display:

- `src/lib/matching/asset-preview-linking.ts`
- `src/lib/matching/project-face-assignees.ts`
- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/whole-asset-linking.ts`

These still rely heavily on:

- `consent_id`
- `project_face_assignees` rows unique to one concrete one-off consent
- consent-specific routes under `/projects/[projectId]/consents/[consentId]/...`

## 4. Exact mismatch between current behavior and desired product behavior

### 4.1 Upgrade form behavior mismatch

Current live behavior:

- the public page is generic
- fields are initialized empty
- scope and duration are not prefilled
- name and email are not prefilled
- face-match opt-in is not prefilled
- the headshot upload controls are shown whenever the generic face-match section is shown
- if face-match opt-in is enabled, headshot upload is still required

Desired behavior:

- prior answers should prefill where safe
- new scopes on the newer version should start unset
- acceptance must remain unchecked
- headshot reupload should not be shown or required
- face-match opt-in may still be changed
- name and email may still be edited

### 4.2 Owner reuse mismatch

Current live behavior:

- the upgrade request stores the prior `subject_id`
- but the actual public submit path does not use that binding
- submit resolves owner by email uniqueness, not by upgrade-request owner

Why this is wrong:

- if the signer edits email during upgrade, a new `subjects` row is created
- that turns a same-owner upgrade into a new owner
- even when email does not change, owner reuse is accidental through email collision, not enforced through the upgrade request itself

Desired behavior:

- upgrade should always stay anchored to the same project owner/person that requested the update
- email edits should update the same owner, not create a new owner

### 4.3 Active-vs-history mismatch

Current live behavior:

- the new upgrade signing creates a new immutable `consents` row
- the old signed row remains
- there is no one-off `superseded_at` or `superseded_by_consent_id`
- project page one-off UI still renders invite cards and consent cards as parallel live one-off entries
- asset people filter still lists one-off people by `consentId`
- one-off project assignees are keyed by `consent_id`, not by `subject_id`
- one-off face/whole-asset linking routes still operate on concrete consent ids

Result:

- even if scope-state derivation knows the newer consent is the governing version for the same `subject_id`, the visible project UX still behaves as if a new one-off current person was created
- the old one-off consent is still treated as a separate operational owner in several surfaces

### 4.4 Headshot behavior mismatch

Current live behavior:

- `PublicConsentForm` always exposes headshot upload UI
- the submit route still requires a headshot for face-match opt-in
- the one-off upgrade flow does not reuse the prior headshot

Desired behavior:

- upgrade mode should reuse the existing current headshot
- upgrade mode should not ask for reupload
- face-match opt-in should remain editable

## 5. Research answers

### 5.1 Current implemented Feature 067 behavior

How the one-off upgrade flow actually behaves:

1. staff creates a protected upgrade request for an existing consent
2. service creates a new standard invite plus `project_consent_upgrade_requests`
3. signer opens the normal `/i/[token]` page
4. signer submits through the normal one-off consent route
5. submit inserts a new `consents` row and marks the upgrade request `signed`

What rows are created:

- at upgrade-request create time:
  - `subject_invites`
  - `project_consent_upgrade_requests`
  - `idempotency_keys`
- at public sign time:
  - `subjects` upsert
  - `consents`
  - `project_consent_scope_signed_projections`
  - `revoke_tokens`
  - `consent_events`
  - `asset_consent_links` only if the signer uploads a headshot and opts in

Why the current implementation creates "new visible person" behavior:

- because the upgrade request creation is subject-aware, but the later public submit and most project/asset reads are not
- owner reuse is email-based instead of request-bound
- current project and asset surfaces still enumerate one-off identities by invite or consent row
- one-off assignee rows are still keyed by concrete consent ids

### 5.2 Current one-off owner identity behavior

The actual live one-off owner boundary is split:

- one-off scope-state owner boundary: `subjects.id`
- one-off public submit owner resolution: `(tenant_id, project_id, email)` upsert into `subjects`
- one-off project page primary listing boundary: `subject_invites` and nested `consents`
- one-off asset people filter boundary: `consents.id`
- one-off asset-facing assignee boundary: `project_face_assignees.consent_id`

Surfaces still consent-row-centric:

- project dashboard one-off participant list
- one-off consent detail panels
- asset people filter options
- consent-specific matching panels and routes
- one-off assignee creation and lookup
- current exact-face and whole-asset link ownership for one-off assignees

Duplication source assessment:

- primary cause:
  - project page list composition
  - consent-row selection logic
  - asset-facing assignee linkage
- secondary cause:
  - subject creation/reuse logic when email changes during upgrade
- not the main cause:
  - upgrade-request row creation itself, which already stores the right prior `subject_id`

### 5.3 Upgrade prefill behavior

Data currently available for safe prefill:

- prior one-off structured values from `consents.structured_fields_snapshot`
- prior one-off `face_match_opt_in` from `consents`
- current subject full name and email from `subjects`
- current target template definition from the invite/template loaded for `/i/[token]`
- current linked headshot existence via existing one-off headshot link helpers

Fields that can be safely prefilled:

- scope selections, but only where the prior selected `optionKey` still exists on the newer template version
- duration, only where the prior selected duration option still exists on the newer version
- full name
- email
- face-match opt-in

Fields that must not be prefilled:

- final acceptance checkbox
- any signing/confirmation action
- any hidden field that would imply acceptance was already given

How new scopes should behave in prefill:

- they should be present on the new form, because they exist on the newer template version
- they should start unchecked or unselected
- they should not be rendered as `not_collected` in the form
- `not_collected` remains an effective-state read concept for older governing signed versions, not a form-prefill concept

Narrowest additive prefill path:

- keep the existing public invite page and form
- add optional upgrade context and initial values
- drive prefill by matching prior signed values to current target-template `optionKey`s
- leave the generic submit route in place, but make it upgrade-aware server-side

### 5.4 Headshot and face-match behavior in upgrade mode

Why headshot is currently shown:

- the public form is generic and always includes face-match controls
- the form always passes upload controls to the face-match block renderer
- no upgrade mode exists to suppress them

How current one-off public signing wires headshot logic:

- public form uploads a headshot through `/api/public/invites/[token]/headshot`
- submit sends `face_match_opt_in` and `headshot_asset_id`
- SQL requires a headshot whenever `face_match_opt_in = true`
- if a headshot is provided, it is linked to the new consent through `asset_consent_links`

Cleanest suppression direction:

- add explicit upgrade-mode context to the public page and form
- hide the upload controls in upgrade mode
- allow face-match opt-in to be toggled without forcing a new upload
- if the prior consent already has a current reusable headshot and the upgraded signer opts in, reuse that headshot for the new governing consent

### 5.5 Active-vs-history behavior

How the system currently determines current one-off scope state:

- by latest signed event per `subject_id + template_key` in `project_consent_scope_effective_states`

How the system currently determines current one-off project/asset identity:

- inconsistently, mostly by `consent_id` or invite

What exact refinement is needed:

- one-off upgrade completion must keep the same project owner anchored to the prior `subject_id`
- the newer consent must become the current governing one-off consent for operational reads
- older signed one-off consents must remain historical records
- project and asset UX must stop surfacing superseded one-off consents as separate current people

Does one-off need explicit supersedence markers?

- For scope-state alone: not strictly.
- For the broader live project/asset one-off model: probably yes.

Reason:

- too many current live one-off reads and assignee joins are consent-centric
- without explicit one-off supersedence, every current-vs-history read would need custom "latest consent for subject" logic
- explicit one-off supersedence would mirror recurring and make "current versus history" durable across project lists, asset people filters, and future one-off active-consent reads

### 5.6 Name/email editing during upgrade

Safest owner behavior:

- upgrade flow should always stay anchored to the prior owner
- keep the same `subject_id`
- update current subject fields on that same `subject_id`

Why this is the safest bounded product behavior:

- the upgrade request itself is evidence that the new version is meant for the same owner/person
- if the operator needs a truly different person, that should be a fresh invite, not an upgrade of an existing consent owner

Current limitation to note:

- one-off signed consents still do not snapshot subject name/email immutably
- older one-off history is displayed through mutable `subjects` fields
- so updating subject email during upgrade will also change how older one-off records display in some surfaces
- this is an existing one-off audit limitation, not something introduced by Feature 069

## 6. Small additive options considered

### Option A - Improve submit path only

Scope:

- detect upgrade-bound invite submit server-side
- anchor submit to `project_consent_upgrade_requests.subject_id`
- update subject name/email on the same `subject_id`
- keep the rest of the public form and current project/asset reads unchanged

Product fit:

- fixes email-change owner breakage
- does not fix empty upgrade form
- does not fix headshot reupload requirement
- does not fix duplicate current-person project UX

Architectural fit:

- small and additive
- underuses the existing upgrade workflow row by not surfacing upgrade mode publicly

Audit safety:

- safe for signed history
- still inherits the existing mutable one-off subject-display limitation

Complexity:

- low

Migration risk:

- none

Likelihood of fixing the observed behavior cleanly:

- low

### Option B - Add upgrade-mode prefill and owner binding, but no current/history refinement

Scope:

- make `/i/[token]` upgrade-aware
- prefill from prior consent and current subject
- suppress headshot upload UI in upgrade mode
- anchor submit to prior `subject_id`
- optionally reuse prior headshot for the new consent
- do not change one-off current/history model

Product fit:

- fixes the public-form mismatch
- still leaves project page and asset surfaces acting like the upgrade created a separate current person

Architectural fit:

- good
- stays additive and reuses the standard invite flow

Audit safety:

- high

Complexity:

- low to medium

Migration risk:

- none to low

Likelihood of fixing the observed behavior cleanly:

- medium at best

### Option C - Add upgrade binding, prefill, and read-time current-owner refinements without new schema

Scope:

- everything in Option B
- plus read-time helpers that treat latest one-off consent for the same `subject_id` as current
- update project page, people filter, and preview composition to resolve through that current owner view
- no explicit one-off supersedence marker

Product fit:

- much closer to desired behavior
- old consent can remain visible as history
- new consent can become current in read surfaces

Architectural fit:

- workable because scope-state already resolves one-off current state by `subject_id`
- awkward because many current operational tables and routes are still consent-centric

Audit safety:

- high

Complexity:

- medium

Migration risk:

- low

Likelihood of fixing the observed behavior cleanly:

- medium

Main downside:

- current-vs-history semantics stay implicit for one-off consent outside the scope-state subsystem
- every consent-centric read has to remember how to translate old consent rows into current owner state

### Option D - Add explicit one-off supersedence markers plus narrow read refinements

Scope:

- everything in Option B
- add one-off supersedence markers on `consents`
- treat active one-off consent as "not revoked and not superseded"
- update project page and one-off read surfaces to show current versus history correctly
- keep changes bounded to one-off upgrade behavior and the project surfaces that expose it

Product fit:

- strong
- current one-off consent becomes an explicit concept rather than an inferred one
- old signed rows remain in audit history but stop being treated as current

Architectural fit:

- better match for the live repo than pure read-time inference
- mirrors the recurring model already introduced in Feature 067

Audit safety:

- high if supersedence only marks operational current-state and does not mutate signed payloads

Complexity:

- medium

Migration risk:

- medium

Likelihood of fixing the observed behavior cleanly:

- high

### Option E - Add one-off supersedence plus operational carry-forward of current owner state

Scope:

- everything in Option D
- on successful upgrade completion, carry forward the one-off owner's operational current state to the new consent where needed
- especially:
  - reuse current subject owner
  - reuse existing headshot link for the new consent when face-match remains enabled
  - keep one-off owner-facing project and asset behavior pointed at the new governing consent instead of leaving operational state stranded on the old consent

Product fit:

- best fit to the manual testing goal
- avoids the product behaving like a brand-new current person was created

Architectural fit:

- good, because the live repo still has many one-off operational seams rooted in `consent_id`
- carry-forward is a pragmatic way to preserve those seams while making the upgrade behave like an update

Audit safety:

- high if only operational rows are updated and old signed consent rows remain intact

Complexity:

- medium to medium-high

Migration risk:

- medium

Likelihood of fixing the observed behavior cleanly:

- highest

## 7. Tradeoffs by option

| Option | Product fit | Architectural fit | Audit safety | Complexity | Migration risk | Fixes observed issue cleanly? |
| --- | --- | --- | --- | --- | --- | --- |
| A. Submit path only | Low | Medium | High | Low | Low | No |
| B. Prefill + owner binding only | Medium | High | High | Low to medium | Low | No |
| C. Prefill + owner binding + read-only current-owner refinements | Medium to high | Medium | High | Medium | Low | Partial |
| D. Prefill + owner binding + explicit one-off supersedence | High | High | High | Medium | Medium | Mostly |
| E. Prefill + owner binding + one-off supersedence + operational carry-forward | Highest | High | High | Medium to medium-high | Medium | Yes |

Key tradeoff summary:

- Options A and B are too small to fix the actual mismatch observed in manual testing.
- Option C can improve visible reads, but leaves one-off "current versus history" semantics implicit and fragile because the wider one-off model is still consent-centric.
- Option D gives the repo an explicit one-off current/history boundary, which fits the existing recurring precedent.
- Option E is the smallest direction that plausibly makes the feature feel like a real one-off update flow instead of a second current person flow.

## 8. Recommended bounded direction

Recommend a bounded follow-up that keeps the existing upgrade-request transport, but adds explicit upgrade-mode semantics and one-off current/history handling.

### 8.1 Core recommendation

Recommended slice:

1. Keep the current protected upgrade-request create flow.
2. Make the public invite page and submit path upgrade-aware when the invite belongs to a pending `project_consent_upgrade_requests` row.
3. Prefill upgrade-mode fields from the prior governing consent and current subject.
4. Anchor upgrade submit to the prior `subject_id`, regardless of submitted email changes.
5. Reuse the existing headshot in upgrade mode instead of requiring reupload.
6. Add explicit one-off supersedence markers so the new consent becomes the operational current consent and the old one becomes history.
7. Add narrow project/read refinements so one-off current surfaces stop showing superseded rows as separate current people.
8. Make the minimum recurring read fixes needed so recurring active-state reads respect existing `superseded_at` behavior too.

### 8.2 Why this is the best bounded fit

This direction stays small enough because it does not reopen Feature 067's scope-state architecture.

It reuses:

- the existing upgrade request table
- the existing one-off invite transport
- the existing one-off public form system
- the existing scope-state owner model

It adds only what the live code currently lacks:

- upgrade-mode public context and prefill
- submit-time owner binding to the prior owner
- one-off explicit current-vs-history semantics
- narrow project/asset read refinements where current one-off people are still consent-centric

### 8.3 What this recommendation should and should not do

Should do:

- same owner reused
- new consent version becomes operationally current
- old consent remains immutable audit history
- form prefilled where safe
- new scopes start unselected
- acceptance remains unchecked
- no headshot reupload UI in upgrade mode
- face-match opt-in still editable
- no duplicate current one-off person UX

Should not do:

- redesign the whole one-off consent model
- redesign baseline recurring or broad recurring request flows
- redesign matching identity or whole-asset linking architecture
- redesign exports or scope semantics beyond the minimal current/history correction needed here

## 9. Risks and edge cases

- Email change during upgrade:
  - must stay anchored to the same `subject_id`
  - otherwise the flow still creates a new owner

- Existing one-off audit limitation:
  - updating subject name/email changes current display of older one-off rows because name/email are not snapshotted on `consents`
  - this should be called out in planning, but not expanded into a broader audit redesign in this slice

- Headshot reuse when face-match opt-in changes:
  - if the upgraded signer keeps face-match opt-in enabled, the prior current headshot should be reused
  - if the upgraded signer opts out, the old headshot should remain historical but not remain the current operational matching source

- New scopes in upgrade prefill:
  - must be visible and unset on the new form
  - must not silently inherit consent the signer never explicitly confirmed

- Partial upgrade completion:
  - canonical new consent insertion, supersedence update, and any operational carry-forward need coherent transaction boundaries or deterministic repair behavior

- Current one-off operational tables:
  - several current one-off flows are still rooted in `consent_id`
  - plan work must decide the exact minimum set of rows that need current-owner carry-forward or current-owner read translation

- Recurring consistency:
  - recurring already has `superseded_at`
  - project participants and recurring assignee state reads still ignore it in some places
  - if not fixed, recurring and one-off "active" semantics diverge further

- Retries and idempotency:
  - upgrade-request create is already idempotent
  - upgrade submit refinement must remain retry-safe and not duplicate supersedence or operational carry-forward work

## 10. Explicit open decisions for the plan phase

- Decide whether one-off supersedence is modeled exactly like recurring:
  - recommended: `superseded_at` plus `superseded_by_consent_id`

- Decide the exact one-off operational rows that must move to the new current consent on upgrade completion:
  - minimum likely set:
    - current headshot linkage
    - one-off assignee current identity
    - current exact-face / whole-asset / fallback one-off ownership reads

- Decide whether the project page should:
  - collapse one-off current participants to one current card per owner with nested history
  - or keep invite cards but clearly separate current versus historical upgrade lineage

- Decide the exact public upgrade context payload shape:
  - prior consent summary
  - subject name/email
  - prior structured values
  - prior face-match opt-in
  - existing headshot availability

- Decide whether upgrade submit should update the mutable `subjects.email` field when the signer edits email:
  - recommended: yes, because upgrade must stay anchored to the same owner

- Decide whether to add a one-off consent event for supersedence:
  - recommended if one-off supersedence is added

- Decide the exact recurring consistency fixes included in this slice:
  - minimum recommended:
    - recurring project participant reads
    - recurring assignee current-state reads

- Decide whether any temporary repair/backfill support is needed if one-off supersedence or operational carry-forward touches existing operational rows.
