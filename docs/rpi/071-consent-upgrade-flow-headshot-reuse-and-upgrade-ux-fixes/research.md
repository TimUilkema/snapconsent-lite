# Feature 071 Research - Consent upgrade flow investigation and bounded fix direction

## Scope

This research covers a bounded bugfix investigation for the upgrade flows introduced by Features 067 and 069:

- one-off consent upgrade request creation and signing
- recurring project consent replacement request creation and signing
- governing/current consent semantics after upgrade
- project read models and UI surfaces that should show current vs historical consent rows
- headshot reuse/carry-forward behavior during upgrade
- upgrade-specific public and protected UX wording/context

Out of scope:

- redesigning the consent model
- changing one-off vs recurring identity boundaries
- DAM/media-library/project closure workflow
- RBAC/user management
- redesigning outbound email jobs

## Inputs reviewed

Required docs reviewed, in order:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `docs/rpi/README.md`

Prior RPI docs reviewed:

- `docs/rpi/067-consent-scope-state-and-upgrade-requests/research.md`
- `docs/rpi/067-consent-scope-state-and-upgrade-requests/plan.md`
- `docs/rpi/069-consent-upgrade-flow-owner-reuse-and-prefill-refinement/research.md`
- `docs/rpi/069-consent-upgrade-flow-owner-reuse-and-prefill-refinement/plan.md`
- `docs/rpi/051-baseline-recurring-consent-request-foundation/research.md`
- `docs/rpi/051-baseline-recurring-consent-request-foundation/plan.md`
- `docs/rpi/055-project-participants-and-mixed-consent-intake/research.md`
- `docs/rpi/055-project-participants-and-mixed-consent-intake/plan.md`

Feature 068 docs were not needed as a primary input because current upgrade-request creation/delivery does not go through the new typed outbound email-job foundation. The current live repo does use the email foundation for one-off receipt delivery after submit, but not for creating/sending upgrade requests.

Live schema, routes, helpers, components, and tests reviewed:

- `supabase/migrations/20260304210000_002_projects_invites_schema.sql`
- `supabase/migrations/20260422143000_067_consent_scope_state_foundations.sql`
- `supabase/migrations/20260422172000_067_consent_scope_projection_write_path.sql`
- `supabase/migrations/20260422190000_069_consent_upgrade_governing_foundations.sql`
- `supabase/migrations/20260422200000_069_upgrade_submit_binding_and_supersedence.sql`
- `src/lib/projects/project-consent-upgrade-service.ts`
- `src/lib/projects/project-consent-upgrade-route-handlers.ts`
- `src/lib/invites/public-invite-context.ts`
- `src/app/i/[token]/page.tsx`
- `src/components/public/public-consent-form.tsx`
- `src/app/i/[token]/consent/route.ts`
- `src/lib/consent/public-consent-prefill.ts`
- `src/lib/consent/submit-consent.ts`
- `src/lib/recurring-consent/public-recurring-consent.ts`
- `src/app/rp/[token]/page.tsx`
- `src/components/public/public-recurring-consent-form.tsx`
- `src/app/rp/[token]/consent/route.ts`
- `src/lib/projects/project-participants-service.ts`
- `src/components/projects/project-participants-panel.tsx`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/app/api/projects/[projectId]/assets/route.ts`
- `src/lib/consent/project-consent-scope-state.ts`
- `src/lib/matching/face-materialization.ts`
- `src/lib/matching/project-face-assignees.ts`
- `src/lib/matching/asset-preview-linking.ts`
- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/whole-asset-linking.ts`
- `src/lib/project-export/project-export.ts`
- `tests/feature-067-consent-upgrade-ui.test.ts`
- `tests/feature-069-governing-foundations.test.ts`
- `tests/feature-069-public-upgrade-ui.test.ts`
- `tests/feature-069-upgrade-submit-foundation.test.ts`
- `messages/en.json`
- `messages/nl.json`

Test execution during research:

- Ran `npm test -- tests/feature-069-upgrade-submit-foundation.test.ts tests/feature-069-governing-foundations.test.ts tests/feature-069-public-upgrade-ui.test.ts tests/feature-067-consent-upgrade-ui.test.ts`
- Because the repo test script expands to `tests/**/*.test.ts`, the full suite ran.
- Upgrade-related tests passed.
- Unrelated pre-existing failures remained in `tests/feature-021-project-matching-progress.test.ts` and `tests/feature-051-baseline-recurring-consent-request-foundation.test.ts`.

## Source-of-truth schema and code paths

### Tables and core records involved

- `subjects`
  - one-off person identity per `(tenant_id, project_id, email)`
  - upgrade flow in 069 reuses the same `subject_id`
- `subject_invites`
  - one-off public invite transport
  - each one-off upgrade currently creates a new invite row
- `consents`
  - one-off signed consent rows
  - 069 adds one-off supersedence via `superseded_at` and `superseded_by_consent_id`
- `project_consent_upgrade_requests`
  - explicit one-off upgrade request record
  - binds new invite to prior consent and reused `subject_id`
- `recurring_profile_project_consents`
  - project-specific recurring consent rows
  - 069 adds supersedence/current-governing behavior here too
- `project_recurring_consent_requests`
  - recurring project consent request rows
  - replacement requests for an existing active consent stay pending until signed
- `recurring_profiles`
  - recurring person identity reused during recurring project upgrades

### Routes and request handlers

- One-off upgrade request creation
  - `src/lib/projects/project-consent-upgrade-route-handlers.ts`
  - `src/lib/projects/project-consent-upgrade-service.ts`
- Public one-off consent page + submit
  - `src/app/i/[token]/page.tsx`
  - `src/app/i/[token]/consent/route.ts`
- Public recurring project consent page + submit
  - `src/app/rp/[token]/page.tsx`
  - `src/app/rp/[token]/consent/route.ts`

### Helpers and business logic

- One-off upgrade/public context
  - `src/lib/invites/public-invite-context.ts`
  - `src/lib/consent/public-consent-prefill.ts`
- One-off submit
  - `src/lib/consent/submit-consent.ts`
  - SQL function `submit_public_consent` in `20260422200000_069_upgrade_submit_binding_and_supersedence.sql`
- Recurring public context and submit
  - `src/lib/recurring-consent/public-recurring-consent.ts`
  - SQL function `submit_public_recurring_profile_consent` in `20260422200000_069_upgrade_submit_binding_and_supersedence.sql`
- Governing/current consent reads
  - `src/lib/consent/project-consent-scope-state.ts`
  - `list_current_project_consent_headshots` RPC in `20260422190000_069_consent_upgrade_governing_foundations.sql`

### UI components and read models

- Public one-off form
  - `src/components/public/public-consent-form.tsx`
- Public recurring form
  - `src/components/public/public-recurring-consent-form.tsx`
- Project participants/service
  - `src/lib/projects/project-participants-service.ts`
  - `src/components/projects/project-participants-panel.tsx`
- Project detail page one-off list and headshot map
  - `src/app/(protected)/projects/[projectId]/page.tsx`
- Project assets people filter/read model
  - `src/app/api/projects/[projectId]/assets/route.ts`

## Reconstructed intended behavior

The intended behavior below is based on live code plus 067/069 goals, with live code treated as source of truth when docs and code differ.

### One-off upgrade flow

Before signing:

- A signed one-off project consent can request an upgrade only to a newer published version in the same template family.
- The new request is for the same owner, not a new unrelated person.
- The public page should prefill prior values from the governing/current consent and subject owner record.
- If the existing governing consent already has a reusable headshot and the new submission still opts into face matching, the signer should not be forced to upload a new headshot.
- The public page should read as an updated consent flow, not as a fresh first-time consent request.

During signing:

- The signer can confirm the newer consent text.
- The old governing consent remains current until the new signing succeeds.
- If the signer edits name/email, the flow still remains bound to the same `subject_id`; this is an owner update, not a new person creation.
- The flow should block rebinding to a different existing subject in the same project.

After signing:

- The new consent becomes the current/governing one-off project consent for that owner.
- The prior consent remains historical and auditable.
- Current-facing project UI should not show old and new one-off consents as two active parallel project participants.

### Recurring project replacement flow

Before signing:

- A recurring project participant with an active project consent can request a replacement using a newer version from the same template family.
- The request is a replacement for the same recurring profile, not a generic new project request.
- The project UI should say so explicitly.
- The public recurring page should also make the replacement context clear.

During signing:

- The active current project consent remains governing until the replacement is signed.
- The public page should prefill current recurring profile and prior consent values.
- If name/email are edited, the update should stay bound to the same `recurring_profile_id`.

After signing:

- The new recurring project consent becomes governing/current.
- The prior project consent becomes historical.
- Current project state, assignee state, and scope-state reads should switch to the replacement consent.

## Verified current live behavior

### One-off upgrade creation and submit

Verified in `project-consent-upgrade-service.ts` and the 069 SQL migration:

- Upgrade creation makes a fresh `subject_invites` row plus a `project_consent_upgrade_requests` row.
- The upgrade request stores the prior consent, new template version, and reused `subject_id`.
- `submit_public_consent` detects pending upgrade context from `project_consent_upgrade_requests`.
- On successful sign it:
  - locks the prior consent and bound subject
  - updates the same `subjects` row instead of creating a new one
  - rejects an edited email if it would collide with another subject in the same project
  - reuses the prior headshot asset if the new submit still opts into face matching and no new headshot was uploaded
  - retargets project/person linkage tables to the new consent
  - supersedes the prior one-off consent
  - marks the upgrade request signed with `completed_consent_id`

This confirms the main one-off supersedence and owner-reuse write path is already implemented server-side.

### One-off public upgrade rendering

Verified in `src/app/i/[token]/page.tsx` and `src/components/public/public-consent-form.tsx`:

- The page resolves `upgradeContext`.
- It passes `initialValues={upgradeContext?.initialValues}`.
- It passes `upgradeMode={Boolean(upgradeContext)}`.
- The form prefills prior values correctly.
- The form component defines `upgradeMode?: boolean` but does not use it for rendering or client-side validation.

### Recurring replacement creation and submit

Verified in `project-participants-service.ts`, `public-recurring-consent.ts`, and the 069 SQL migration:

- Recurring participants can have an active signed project consent and a pending replacement request at the same time.
- The old recurring project consent stays current while the replacement request is pending.
- Public recurring request loading resolves `upgradeContext` and prefilled initial values.
- `submit_public_recurring_profile_consent` updates the same `recurring_profiles` row, creates the replacement project consent, and supersedes the prior one only after the new sign succeeds.

### Governing/current reads

Verified current-aware reads include:

- `project_consent_scope_effective_states` excludes superseded one-off and recurring rows
- `list_current_project_consent_headshots` excludes superseded rows
- matching/linking reads in `asset-preview-linking.ts`, `photo-face-linking.ts`, `whole-asset-linking.ts`, and `project-face-assignees.ts` consistently filter or reason on current/governing consent rows

### Project UI/read inconsistencies

Verified stale or non-current-aware reads include:

- the one-off participant list in `src/app/(protected)/projects/[projectId]/page.tsx`
- the project assets people-filter/read model in `src/app/api/projects/[projectId]/assets/route.ts`
- some export/history shaping in `src/lib/project-export/project-export.ts` still loads all consent rows without clearly distinguishing superseded one-off history

## Mismatches between intended and live behavior

### Mismatch 1 - One-off upgrade still behaves like a fresh form for headshot upload

Intended:

- reuse prior headshot when allowed
- do not force re-upload during upgrade
- present an upgrade/replacement-aware public flow

Live:

- prefill works
- server route and SQL submit path already allow headshot reuse
- client form still renders generic upload UX and still blocks submit when `faceMatchOptIn` is true and no fresh `headshotAssetId` is present

Classification:

- primary bug in public client behavior and rendering
- secondary UX wording/context gap because upgrade mode is loaded but not surfaced

### Mismatch 2 - Old and new one-off consents still appear as parallel current-looking rows

Intended:

- new consent becomes governing/current after successful upgrade
- old consent remains historical
- current-facing project UI should not present both as active rows for the same owner

Live:

- supersedence is written correctly
- current headshot reads already follow governing/current rules
- one-off participant list still enumerates raw invite/consent rows without filtering/collapsing superseded one-off rows
- asset people filter also still enumerates raw consent rows without `superseded_at is null`
- result: old row remains visible, while the current-only headshot map no longer provides a headshot for it

Classification:

- read-model/UI bug, not a supersedence write failure

### Mismatch 3 - Recurring upgrade UX still reads like the original generic request flow

Intended:

- project participant action should feel like "request updated/replacement consent"
- public recurring form should also present replacement context

Live:

- recurring participant state and public request context already know it is a replacement flow
- protected project action UI still shows generic request copy:
  - `Toestemmingsverklaring`
  - `Selecteer een toestemmingsverklaring`
  - `Projectverzoek maken`
- public recurring form also receives `upgradeMode` but does not use it

Classification:

- public/protected UX wording/context bug
- not a missing data-model capability

## Root-cause analysis

### 1. One-off headshot reuse issue

Observed symptom:

- the signer is still asked to upload a headshot in one-off upgrade flow even though v1 already had one

Root cause:

- `src/app/i/[token]/page.tsx` correctly resolves upgrade context and passes `upgradeMode`
- `src/app/i/[token]/consent/route.ts` correctly relaxes server-side validation by setting `requireHeadshotWhenOptedIn` to `false` for upgrade submits
- `submit_public_consent` correctly reuses the prior headshot asset during upgrade submit when allowed
- but `src/components/public/public-consent-form.tsx` ignores `upgradeMode`
- the component still performs generic client-side validation requiring `headshotAssetId` when `faceMatchOptIn` is true
- the component also still renders the generic headshot upload flow instead of upgrade-aware messaging

Conclusion:

- this is a client/UI bug
- request creation, server submit handling, and post-submit carry-forward are already implemented

### 2. Old/new consent list issue after one-off upgrade

Observed symptom:

- after upgrade signing, the new consent appears, but the old consent still remains in the project UI in a way that looks like a second active row
- the old row also shows no headshot

Root cause:

- one-off upgrade submit correctly writes supersedence in `consents`
- `src/app/(protected)/projects/[projectId]/page.tsx` still builds one-off participant UI from invite-centric `subject_invites -> consents` reads
- that read path does not filter out superseded one-off consents
- `loadCurrentProjectConsentHeadshots` does filter to current/governing consents
- therefore the old invite row is still rendered, but its headshot disappears because the headshot loader only returns the new current consent
- `src/app/api/projects/[projectId]/assets/route.ts` has a similar stale read-model problem for the people filter/listing

Conclusion:

- this is primarily a current-read filtering/composition bug
- the write path is correct
- the biggest design mismatch is that the current one-off participant list is still invite-centric rather than current-owner-centric

### 3. Recurring generic-request UX issue

Observed symptom:

- recurring upgrade still shows the original generic request controls and wording

Root cause:

- recurring participant state already exposes enough information to know when the user is requesting a replacement while an active consent exists
- the project action UI in `src/components/projects/project-participants-panel.tsx` still renders the generic request copy under `projects.participants.request.*`
- Dutch translation keys currently produce the exact observed labels
- `src/app/rp/[token]/page.tsx` passes `upgradeMode={Boolean(request.upgradeContext)}`
- `src/components/public/public-recurring-consent-form.tsx` defines `upgradeMode?: boolean` but does not use it

Conclusion:

- this is a UI-context bug in both the protected recurring request entry point and the public recurring signing page
- the request context is already present; the wrong generic UI is being reused

## Name/email change behavior during upgrade

### One-off

Live behavior:

- one-off upgrade submit remains bound to the stored `subject_id`
- edits update the same `subjects` row
- edited email is rejected if it would collide with another existing subject in the same project

Assessment:

- this is aligned with 069 owner-reuse intent
- the upgrade is still for the same owner
- it should not create or rebind to a new unrelated owner silently

Important caveat:

- because one-off owner display data is still read from mutable `subjects.full_name` and `subjects.email`, editing those fields changes how historical one-off rows appear in current UI/history surfaces
- that is an existing snapshot/audit-display limitation, not a reason to break owner reuse

### Recurring

Live behavior:

- recurring upgrade submit stays bound to the same `recurring_profile_id`
- edits update the same `recurring_profiles` row

Assessment:

- this is aligned with intended replacement semantics for the same recurring person

### Recommendation for 071 scope

- keep current owner-reuse semantics
- do not redesign identity binding in this feature
- plan phase needs one explicit decision on whether upgrade pages should soften or constrain editable name/email fields in the UI, but the underlying same-owner binding should stay

## Governing/current semantics assessment

### What is correct today

- one-off and recurring submit paths only supersede the prior governing consent after successful signing
- recurring active consent remains governing while a replacement request is still pending
- scope-state reads are already built around current/governing consent rows
- current headshot reads are already built around current/governing consent rows
- several matching and assignee reads already follow supersedence/current rules

### What is inconsistent today

- one-off participant list on the project page
- one-off project assets people filter/read model
- public upgrade pages do not consistently present upgrade context even when the backend has it

### Answer to the governing/current question

After a successful one-off upgrade signing, the new consent does become the governing/current consent in live code. The inconsistency is not the write path. The inconsistency is that some project UI/read surfaces still enumerate historical one-off rows as if they are current rows.

## Smallest bounded fix options

### Option A - Minimal one-off correctness fix plus recurring wording fix

Scope:

- one-off public form:
  - use `upgradeMode`
  - stop client-side forcing a fresh headshot when upgrade reuse is allowed
  - show upgrade-aware headshot/help text
- one-off current project reads:
  - filter or collapse superseded one-off rows in project participant UI
  - filter superseded one-off rows from project assets people options
- recurring protected/public UX:
  - add replacement/upgrade wording and labels when active consent or `upgradeMode` is present

Pros:

- smallest fix matching the reported defects
- preserves 067/069 architecture
- does not redesign current identity or request models

Cons:

- one-off project page may still remain structurally invite-centric under the hood, with filtering layered on top

### Option B - Normalize one-off current display around current owner rather than invite rows

Scope:

- everything in Option A
- refactor one-off project participant display to group by current owner/current governing consent instead of rendering each invite row

Pros:

- more robust long-term current-vs-history behavior
- reduces future superseded-row leakage

Cons:

- larger change
- higher regression surface for project participant UI
- no longer a tight bugfix-sized follow-up

### Option C - UX-only wording fix, leave list/read behavior as-is

Scope:

- only public/protected wording and headshot prompt adjustments

Pros:

- smallest patch

Cons:

- does not fix the old/new row bug
- leaves project current-vs-history presentation inconsistent with governing semantics
- not sufficient for the reported scenario

## Recommended bounded direction

Recommended next feature scope:

1. Fix one-off public upgrade form behavior.
   - Consume `upgradeMode` in `public-consent-form.tsx`.
   - Remove the client-side requirement for a fresh headshot during upgrade when reuse is allowed.
   - Add upgrade-aware helper copy so the signer understands they are updating an existing consent and can reuse the prior headshot.

2. Fix one-off current read-model presentation.
   - Update project-page one-off participant reads and rendering so superseded one-off consents are not shown as parallel active rows.
   - Update project assets people-filter/read model to exclude superseded one-off consent rows from current-facing people lists.
   - Keep old one-off rows historical/auditable, but only in explicitly historical surfaces, not in current participant UI.

3. Fix recurring replacement UX wording/context.
   - In project participant actions, branch copy and CTA labels when an active project consent exists and the user is requesting a newer version.
   - In the public recurring form, consume `upgradeMode` and show replacement-aware title/subtitle/helper copy.

This best preserves the 067/069 architecture because it accepts the existing governing/current write path and fixes the places where presentation and read composition failed to follow it.

## Should this be one follow-up feature or split?

This can stay as one bounded follow-up feature if the goal is "upgrade flow correctness and upgrade-oriented UX." The bugs are tightly related:

- one-off client form ignores upgrade semantics
- one-off current UI ignores supersedence semantics
- recurring entry/public UI ignores upgrade semantics

A split is only justified if implementation size becomes too large in plan phase. If split, the cleanest split would be:

- one-off correctness/read-model bugfix
- recurring upgrade wording/context bugfix

Based on current findings, one bounded feature still looks reasonable.

## Risks and tradeoffs

- Filtering superseded one-off rows from current project UI must not remove access to historical audit information if another screen already expects to show history.
- If current project UI remains invite-centric, a narrow filter can fix the reported bug but may leave similar edge cases elsewhere.
- Upgrade-aware public form copy must remain localized in both Dutch and English.
- The one-off form should not overpromise headshot reuse if the current governing consent has no reusable headshot; plan phase should decide the exact conditional copy.
- Mutable owner identity fields mean historical one-off rows may continue to display updated owner name/email. Feature 071 should document that limitation rather than expand scope into immutable snapshots.
- Recurring submit still uses older receipt-delivery code rather than the 068 typed outbound foundation. That is adjacent but not required to fix the current upgrade UX defects.

## Explicit open decisions for plan phase

1. One-off history visibility
   - Should superseded one-off consents simply be hidden from the main project participant list, or should the participant UI gain an explicit history affordance?

2. One-off display composition
   - Is a narrow `superseded_at is null` filter enough for the current participant list, or should the list be minimally re-shaped around current governing owner rows?

3. Upgrade copy rules for headshot reuse
   - When `upgradeMode` is true, should the UI always hide upload controls until the user explicitly chooses to replace the headshot, or should it keep upload available as an optional replacement action?

4. Name/email editing UX
   - Should upgrade forms continue allowing full edits with same-owner server binding, or should the UI add explanatory copy that these changes update the existing person/profile?

5. Recurring protected UI wording
   - Should the existing generic request component gain an upgrade branch, or should recurring replacement use a distinct small wrapper with different labels and helper text?

6. Historical surfaces audit
   - Beyond the main project page and assets people filter, are there any additional current-facing surfaces that should be included in the same bugfix because they still show superseded one-off rows?

## Summary

The live repo already implements the core 069 business logic for upgrade owner reuse, governing/current supersedence, and server-side headshot carry-forward. The defects in the reported scenario come from three narrower failures:

- `public-consent-form.tsx` still behaves like a generic fresh form and blocks one-off headshot reuse client-side
- current one-off project reads still render stale superseded rows as if they were parallel active consents
- recurring upgrade entry and public pages load upgrade context but never present upgrade/replacement-specific UI

The recommended next step is a bounded follow-up that fixes those presentation and read-model gaps without redesigning the underlying consent architecture.
