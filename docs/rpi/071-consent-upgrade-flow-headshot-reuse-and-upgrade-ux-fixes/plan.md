# Feature 071 Plan - Consent upgrade flow headshot reuse and upgrade UX fixes

## Inputs and ground truth

Required inputs re-read for this phase:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `docs/rpi/README.md`
5. `docs/rpi/071-consent-upgrade-flow-headshot-reuse-and-upgrade-ux-fixes/research.md`

Targeted live verification performed for plan-critical conclusions:

- `src/app/i/[token]/page.tsx`
- `src/components/public/public-consent-form.tsx`
- `src/app/i/[token]/consent/route.ts`
- `src/lib/invites/public-invite-context.ts`
- `src/lib/consent/public-consent-prefill.ts`
- `supabase/migrations/20260422200000_069_upgrade_submit_binding_and_supersedence.sql`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/app/api/projects/[projectId]/assets/route.ts`
- `src/components/projects/project-participants-panel.tsx`
- `src/lib/projects/project-participants-service.ts`
- `src/app/rp/[token]/page.tsx`
- `src/components/public/public-recurring-consent-form.tsx`
- `src/lib/recurring-consent/public-recurring-consent.ts`
- `src/components/projects/one-off-consent-upgrade-form.tsx`
- `tests/feature-055-project-participants-ui.test.ts`
- `tests/feature-069-public-upgrade-ui.test.ts`
- `tests/feature-069-governing-foundations.test.ts`
- `tests/feature-069-upgrade-submit-foundation.test.ts`
- `messages/en.json`
- `messages/nl.json`

Plan ground truth:

- The 069 server-side upgrade write path is already correct and should remain unchanged.
- The defects are in presentation, client validation, and current-facing read filtering.
- No schema migration is required for Feature 071.

## Verified current boundary

Verified and in scope:

- One-off public upgrade page already resolves `upgradeContext` and passes `upgradeMode`, but the form ignores it.
- One-off public submit route already relaxes server-side headshot validation for upgrade submits, but SQL still requires either:
  - a new uploaded headshot, or
  - a reusable prior headshot linked to the prior consent.
- `PublicInviteUpgradeContext` does not currently include whether a reusable prior headshot exists.
- Project detail one-off participants still render raw invite rows, including invites whose signed consent is now superseded.
- Project assets API still builds current-facing `people` filter options from all signed `consents` without filtering `superseded_at`.
- Recurring participant state already distinguishes active consent and pending replacement correctly.
- Recurring protected/public UI receives enough state to render replacement-aware copy, but currently uses generic request/form wording.

Verified and out of scope for 071:

- One-off and recurring same-owner binding
- One-off and recurring supersedence writes
- matching and assignee retargeting
- project export/history redesign
- signed-consent aggregate stats on the project page
- immutable identity snapshots for one-off or recurring owners

## Options considered

### Option A - Bounded presentation/read-model/client-validation fix

Scope:

- add minimal one-off upgrade headshot reuse context
- update one-off public form rendering and client validation
- filter superseded one-off rows from current-facing project surfaces
- add upgrade/replacement wording in recurring protected/public UI
- add minimal i18n and tests

Why it fits:

- preserves 067/069 business rules
- fixes the reported behavior directly
- stays bugfix-sized

### Option B - Rework one-off participant display around current owner rows

Scope:

- Option A plus regrouping one-off project display away from invite-centric rows

Why not chosen:

- higher regression surface
- turns a bugfix into a broader participant/history UI redesign
- not required to stop stale superseded rows from appearing in current-facing surfaces

### Option C - Copy-only upgrade wording fix

Scope:

- titles, subtitles, helper text only

Why not chosen:

- would leave the one-off headshot bug unresolved
- would leave the stale old/new one-off list bug unresolved

## Recommendation

Implement Option A.

Feature 071 should stay focused on presentation, client validation, and current-facing read filtering because targeted verification confirmed the server upgrade write path is already enforcing the correct business model:

- same-owner upgrade binding remains in place
- governing/current supersedence only happens after successful signing
- email collision protection already exists
- one-off headshot reuse already exists in SQL when a reusable prior headshot is available

Changing the server upgrade model here would be unnecessary and would increase regression risk across the public submit path, scope-state projections, matching retargeting, and project participant state.

## Chosen architecture

### Summary

Feature 071 will use the existing 067/069 write path unchanged and add a thin presentation/read-model layer on top:

1. Extend one-off upgrade page context with a read-only `reusableHeadshotAvailable` signal.
2. Use that signal plus `upgradeMode` to render the one-off public form correctly and relax client-side headshot validation only when reuse is actually possible.
3. Filter superseded one-off consent rows out of current-facing project surfaces that should represent current participants.
4. Add upgrade/replacement-aware copy branches in existing recurring protected/public components.

### Why a minimal one-off context extension is required

`upgradeMode` alone is not sufficient for the one-off public form.

The live SQL submit path still raises `headshot_required_for_face_match_opt_in` if:

- the signer opts into face matching,
- no new headshot is uploaded,
- and no reusable current headshot is linked to the prior consent.

Therefore the UI must know whether a reusable prior headshot exists before it can safely stop requiring a new upload. The smallest correct architecture is:

- keep server authority unchanged
- add a read-only flag to `PublicInviteUpgradeContext`
- pass that flag into `PublicConsentForm`

## Exact first-slice scope

### Included

1. One-off public upgrade form headshot-reuse behavior
2. One-off current project UI/read-model filtering
3. Recurring protected upgrade wording/context
4. Recurring public upgrade wording/context
5. Minimal Dutch/English i18n updates
6. Minimal tests to lock the intended behavior

### Additional current-facing surfaces included in 071

- `src/app/(protected)/projects/[projectId]/page.tsx`
  - one-off participants list only
- `src/app/api/projects/[projectId]/assets/route.ts`
  - current-facing `people` filter options only

### Explicitly excluded from 071

- `statsSignedConsents` and `statsInvites` cards on the project page
  - these are aggregate counts, not current-participant presentation
- project export/history views
- adding a dedicated one-off history panel
- asset overlay/detail hydration query in the assets route
  - this lookup resolves already-linked consent ids after assignment/linking logic and does not drive the stale current people filter

## Exact one-off public form plan

### Context changes

Extend `PublicInviteUpgradeContext` in `src/lib/invites/public-invite-context.ts` with:

- `reusableHeadshotAvailable: boolean`

Populate it by checking whether the prior consent currently has a reusable linked headshot asset:

- same tenant and project
- `asset_type = 'headshot'`
- `status = 'uploaded'`
- `archived_at is null`
- not expired by retention

No write behavior changes.

### Page wiring

Update `src/app/i/[token]/page.tsx` to pass both:

- `upgradeMode`
- `reusableHeadshotAvailable`

to `PublicConsentForm`.

### Rendering behavior

In `src/components/public/public-consent-form.tsx`:

- if `upgradeMode` is false:
  - keep existing behavior
- if `upgradeMode` is true and `reusableHeadshotAvailable` is true:
  - show upgrade-aware helper copy that the existing headshot will be reused for face matching
  - keep upload controls available as an optional replacement action
  - relabel the upload CTA to replacement-oriented wording
- if `upgradeMode` is true and `reusableHeadshotAvailable` is false:
  - keep the existing required-upload behavior
  - still show upgrade-aware title/subtitle/helper copy for the overall flow

### Client-side validation

Replace the blanket submit guard:

- current: require `headshotAssetId` whenever `faceMatchOptIn` is true

With a derived rule:

- require a new headshot only when:
  - `faceMatchOptIn` is true, and
  - no `headshotAssetId` is present, and
  - `reusableHeadshotAvailable` is false

This keeps client behavior aligned with the live SQL submit path.

### Passive reuse vs optional replacement

Chosen behavior:

- passive reuse by default
- optional replacement action remains available

Reason:

- smallest correct fix
- avoids forcing a second upload
- avoids hiding the existing ability to replace the headshot intentionally
- works with the existing submit semantics where a new `headshot_asset_id` overrides reuse

### Upgrade copy changes

One-off public upgrade mode should add:

- upgrade-oriented page title
- short subtitle explaining that the signer is updating an existing consent to a newer version
- short note that name/email edits update the existing person record for this project

Headshot area copy should branch:

- reusable prior headshot available:
  - explain reuse
  - offer optional replacement
- reusable prior headshot not available:
  - keep current required-upload explanation

## Exact one-off current read-model plan

### Project page leak to fix

Current leak:

- `src/app/(protected)/projects/[projectId]/page.tsx`
- `subject_invites` are loaded with nested `consents(...)`
- those nested one-off consent rows do not include or filter `superseded_at`
- `inviteRows.map(...)` renders all non-revoked invites as current-looking rows

Planned fix:

1. Include `superseded_at` in the nested one-off consent select.
2. Introduce a narrow current-facing filter before rendering:
   - keep invites with no signed consent yet
   - keep invites whose first signed consent is not superseded
   - hide invites whose signed consent is superseded
3. Use the filtered collection for:
   - one-off participant list rendering
   - `signedConsentIds` used for pending one-off upgrade request mapping
   - `inviteCount` displayed in the project stats card only if we decide that card should stay tied to visible invite rows

Chosen count behavior:

- do not change `statsSignedConsents`
- keep `inviteCount` behavior aligned with the visible one-off participant list if that count is computed from the filtered rows during implementation
- do not expand scope into historical counting semantics

### Assets people-filter leak to fix

Current leak:

- `src/app/api/projects/[projectId]/assets/route.ts`
- current-facing `people` filter options come from:
  - `from("consents").select("id, subjects(email, full_name)")`
  - `not("signed_at", "is", null)`
- no `superseded_at is null` filter

Planned fix:

- add `.is("superseded_at", null)` to the people-filter lookup query

### Whether narrow filtering is sufficient

Chosen approach:

- narrow `superseded_at is null` filtering plus invite-row hiding is sufficient for 071

Why:

- it fixes the reported old/new parallel-row bug
- it matches the existing current headshot and scope-state reads
- it avoids a broader participant display redesign

### History preservation

Historical rows remain preserved in:

- the database
- the existing supersedence links
- existing export/history-oriented surfaces outside this feature

Feature 071 will not add a new one-off history viewer. Historical one-off rows will simply stop appearing in current-facing project participant UI and current people-filter options.

## Exact recurring upgrade UX plan

### Protected project participant actions

Current state:

- `ProjectProfileParticipantActions` always uses `projects.participants.request.*`
- it does not branch when there is an active current consent and the user is effectively creating a replacement request

Planned behavior:

- detect replacement mode when:
  - `participant.projectConsent.activeConsent` exists
  - `participant.projectConsent.pendingRequest` does not exist
  - `participant.actions.canCreateRequest` is true
- render replacement-specific labels and helper copy in that branch

Recommended implementation shape:

- keep the existing component
- add a small `isUpgradeRequest` branch
- switch translation namespace or key set based on that branch

This is smaller than introducing a new component wrapper.

### Pending recurring replacement share panel

If `pendingRequest` exists and `activeConsent` also exists:

- keep the same layout
- use replacement-aware labels for:
  - expires label if needed
  - request email label
  - link label
  - copy/open success copy if wording is user-visible

This keeps the whole protected recurring flow explicitly replacement-oriented rather than only the initial CTA.

### Public recurring page

Current state:

- `src/app/rp/[token]/page.tsx` passes `upgradeMode`
- the page still uses generic `publicRecurringConsent.title`

Planned behavior:

- branch title/subtitle/helper copy when `request.upgradeContext` exists
- explain that the signer is updating an existing project consent to a newer version
- add a short note that edits update the same recurring profile

### Public recurring form

Current state:

- `PublicRecurringConsentForm` receives `upgradeMode` but ignores it

Planned behavior:

- keep the same form layout component
- add conditional helper copy and any upgrade-specific field hints through existing props and surrounding markup
- do not add one-off headshot logic here, because recurring public form still has no immediate headshot upload path

### Conditional copy vs wrapper

Chosen approach:

- conditional copy in the existing components

Why:

- upgrade state is already present in the live props
- the layout is already correct
- the bug is wording/context, not component structure

## Exact name/email editing behavior for this bugfix

### Server behavior

Remain unchanged:

- one-off upgrade submit remains bound to the same `subject_id`
- recurring replacement submit remains bound to the same `recurring_profile_id`
- one-off email collision protection remains enforced server-side

### UI behavior

Minimal change only:

- keep name/email fields editable
- add brief upgrade-mode helper copy clarifying that edits update the existing person/profile for this project flow

Reason:

- aligned with 069
- avoids redesigning owner identity rules
- gives users better context without constraining legitimate updates

## Exact i18n/message plan

### English and Dutch updates required

Files:

- `messages/en.json`
- `messages/nl.json`

### One-off public upgrade keys

Add bounded upgrade-specific keys under `publicInvite` and `publicInvite.form` for:

- upgrade page title
- upgrade subtitle
- upgrade identity/update helper
- reusable-headshot helper title/body
- optional replace-headshot CTA
- optional replace-headshot success/selection wording only if needed

Keep existing non-upgrade keys for:

- generic fresh invite flow
- required headshot flow when no reusable prior headshot exists

### Recurring public upgrade keys

Add bounded upgrade-specific keys under `publicRecurringConsent` and, if needed, `publicRecurringConsent.form` for:

- upgrade page title
- upgrade subtitle
- upgrade identity/update helper
- any replacement-specific helper text near the form

### Protected recurring participant keys

Add a small replacement-specific key group under `projects.participants`, for example:

- `projects.participants.upgradeRequest.*`

Include only the fields that differ from generic request copy:

- section/field label
- select placeholder
- helper text
- submit/submitting text
- pending replacement link/email labels if they differ
- copy success/error text only if wording changes

Do not rewrite unrelated participant UI strings.

## Security and reliability considerations

- Preserve tenant scoping in all existing and changed queries.
- Do not accept any new client-provided tenant identifiers.
- Keep all current server-side authority in the route handlers and SQL functions.
- Do not change the 069 supersedence write logic.
- Do not change one-off email collision protection.
- Do not let client-side relaxation bypass server-side headshot requirements.
  - only relax when server-derived `reusableHeadshotAvailable` is true
- Keep all create-request actions idempotent exactly as they are now.
- Preserve the current rule that the active governing consent remains current until the replacement signs.
- Preserve current pending-request semantics for recurring participants.

## Edge cases

### One-off upgrade with reusable prior headshot

Expected behavior:

- form explains reuse
- signer is not forced to upload a new headshot
- signer can optionally replace the headshot
- submit succeeds with passive reuse if no replacement is uploaded

### One-off upgrade without reusable prior headshot

Expected behavior:

- upgrade page still reads as an update flow
- if face matching is enabled, headshot upload remains required
- client and server both enforce that requirement

### One-off upgrade where signer replaces the headshot

Expected behavior:

- new upload remains available in upgrade mode
- uploaded `headshot_asset_id` overrides passive reuse
- server write path stays unchanged

### Superseded one-off row visibility

Expected behavior:

- superseded one-off consent rows are hidden from:
  - project detail one-off participants list
  - project assets `people` filter options
- history remains preserved in the database and non-current surfaces

### Recurring replacement request while active consent remains governing

Expected behavior:

- protected project UI uses replacement-oriented wording
- public recurring page uses replacement-oriented wording
- active consent remains governing until replacement signs

### Edited one-off name/email during upgrade

Expected behavior:

- form helper explains this updates the existing person
- submit stays bound to the same `subject_id`
- duplicate email collision protection remains server-enforced

### Edited recurring profile fields during replacement

Expected behavior:

- form helper explains this updates the existing profile
- submit stays bound to the same `recurring_profile_id`

## Test plan

### One-off public upgrade UI and client validation

Update or extend `tests/feature-069-public-upgrade-ui.test.ts` to cover:

- one-off upgrade with reusable prior headshot renders reuse-oriented copy
- one-off upgrade with reusable prior headshot renders optional replacement CTA
- one-off upgrade without reusable prior headshot keeps required-upload copy
- recurring public upgrade renders replacement-oriented copy

Add a small pure helper or exported predicate if needed to test one-off client-side headshot requirement logic directly without browser event plumbing.

### One-off current read-model/list filtering

Add bounded regression coverage for:

- project-page invite-row filtering helper or equivalent pure mapper
  - pending invite remains visible
  - current signed invite remains visible
  - superseded signed invite is hidden
- assets people-filter integration or focused helper coverage
  - superseded one-off consent rows are not returned in current-facing people options

### Recurring protected/public wording and context

Extend `tests/feature-055-project-participants-ui.test.ts` to cover:

- active recurring project consent with no pending request shows replacement-oriented request copy
- active recurring project consent with pending replacement request shows replacement-oriented share/pending copy if wording changes there

Extend `tests/feature-069-public-upgrade-ui.test.ts` for recurring public replacement copy.

### Governing/current integration coverage

Do not add new broad governing-write tests unless implementation proves necessary.

Rely on existing coverage in:

- `tests/feature-069-upgrade-submit-foundation.test.ts`
- `tests/feature-069-governing-foundations.test.ts`

These already verify the business model that Feature 071 is intentionally preserving.

## Implementation phases

### Phase 1 - One-off public form upgrade/headshot behavior

1. Extend `PublicInviteUpgradeContext` with `reusableHeadshotAvailable`.
2. Compute that flag in `resolvePublicInviteUpgradeContext`.
3. Thread the flag through `src/app/i/[token]/page.tsx`.
4. Update `PublicConsentForm` rendering and client validation.
5. Add one-off public upgrade i18n keys.
6. Add/extend tests for one-off public upgrade rendering and headshot requirement logic.

### Phase 2 - One-off current read-model/list filtering

1. Update project-page one-off consent select to include `superseded_at`.
2. Apply a narrow current-facing filter to invite rows before rendering.
3. Update assets API people-filter query to exclude superseded one-off consents.
4. Add regression coverage for filtered current rows and current people options.

### Phase 3 - Recurring upgrade wording/context

1. Add replacement-specific copy keys for protected recurring participant actions.
2. Add conditional recurring protected UI branch in `ProjectProfileParticipantActions`.
3. Add replacement-specific public recurring page copy in `src/app/rp/[token]/page.tsx`.
4. Add replacement-aware helper rendering in `PublicRecurringConsentForm`.
5. Extend recurring UI tests.

### Phase 4 - Tests and verification

1. Run the targeted upgrade and participant UI tests.
2. Run any new assets-route regression tests.
3. Run lint if implementation touches broader TS/UI surfaces in a way that warrants it.
4. Record any unrelated existing test failures separately rather than expanding 071 scope.

## Scope boundaries

### Feature 071 fixes now

- one-off upgrade no longer wrongly forces a new headshot when passive reuse is actually available
- one-off upgrade still correctly requires a headshot when passive reuse is not available
- one-off current project UI no longer shows superseded rows as parallel active participants
- project assets current people filter no longer shows superseded one-off consent rows
- recurring upgrade flows read as replacement/update flows in both protected and public UI
- minimal explanatory copy clarifies that edited name/email fields update the same existing owner/profile

### Deferred for later follow-up

- broader one-off participant/history redesign
- dedicated one-off history UI
- aggregate count semantics review for current vs historical counts
- immutable historical identity snapshots
- any outbound email modernization in recurring submit flow
- any export/history surfacing changes

## Concise implementation prompt

Implement Feature 071 as a bounded bugfix on top of the existing 067/069 architecture. Keep the one-off and recurring server-side upgrade binding and supersedence logic unchanged. Add a minimal read-only `reusableHeadshotAvailable` signal to one-off public upgrade context, use it to make `PublicConsentForm` reuse-aware and only relax client-side headshot requirements when passive reuse is actually possible, and keep upload available as an optional replacement action. Filter superseded one-off consent rows out of the current-facing project detail participant list and assets API `people` filter options, without redesigning history or exports. Add replacement-oriented wording branches for recurring protected participant actions and the public recurring page/form when upgrade context is present. Update only the necessary Dutch/English i18n keys and add bounded regression tests for one-off public upgrade behavior, one-off current-row filtering, and recurring upgrade wording/context.
