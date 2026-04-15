# Feature 059 Plan: Auto Assignment for Project-Scoped Recurring Assignees

## Goal

Implement the smallest production-safe next step after Feature 058 so project-scoped recurring assignees can participate in canonical exact-face auto assignment beside one-off project consent assignees, while reusing the existing linking model, compare pipeline, queue/continuation system, repair/reconcile flow, and manual override behavior.

This plan keeps Feature 059 bounded to widening the current system. It does not introduce a new matcher, a second auto-apply subsystem, broader recurring source enumeration, or a one-off/profile identity merge.

## Inputs and ground truth

### Required docs re-read

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/059-auto-assignment-for-project-scoped-recurring-assignees/research.md`

### Targeted live verification used for planning

- Canonical ownership and writes:
  - `src/lib/matching/photo-face-linking.ts`
  - `src/lib/matching/project-face-assignees.ts`
  - `src/lib/matching/consent-photo-matching.ts`
  - `src/app/api/projects/[projectId]/consents/[consentId]/assets/links/route.ts`
  - `src/app/api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/assignment/route.ts`
  - `supabase/migrations/20260403170000_031_face_level_photo_linking.sql`
  - `supabase/migrations/20260415210000_058_project_face_assignee_bridge.sql`
- Auto apply and replay:
  - `src/lib/matching/auto-match-worker.ts`
  - `src/lib/matching/auto-match-reconcile.ts`
  - `src/lib/matching/auto-match-repair.ts`
  - `src/lib/matching/auto-match-fanout-continuations.ts`
  - `src/lib/matching/materialized-face-compare.ts`
  - `src/lib/matching/recurring-materialized-face-compare.ts`
  - `src/lib/matching/project-recurring-sources.ts`
  - `src/lib/matching/project-matching-progress.ts`
- Preview and UI:
  - `src/lib/matching/asset-preview-linking.ts`
  - `src/app/api/projects/[projectId]/assets/[assetId]/preview-faces/route.ts`
  - `src/app/api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/preview-candidates/route.ts`
  - `src/components/projects/project-asset-preview-lightbox.tsx`
  - `src/components/projects/previewable-image.tsx`
- Hidden, blocked, manual faces:
  - `src/lib/matching/manual-asset-faces.ts`
  - `src/app/api/projects/[projectId]/assets/[assetId]/manual-faces/route.ts`
  - `src/app/api/projects/[projectId]/assets/[assetId]/hidden-faces/[assetFaceId]/route.ts`
  - `src/app/api/projects/[projectId]/assets/[assetId]/blocked-faces/[assetFaceId]/route.ts`
- Participation and recurring readiness:
  - `src/lib/projects/project-participants-service.ts`
  - `src/components/projects/project-participants-panel.tsx`
  - `src/lib/profiles/profile-consent-service.ts`
  - `src/lib/profiles/profile-headshot-service.ts`
- Boundary tests:
  - `tests/feature-031-one-consent-per-face-precedence-rules.test.ts`
  - `tests/feature-044-asset-preview-linking-ux-improvements.test.ts`
  - `tests/feature-045-asset-preview-unlinked-faces-and-hidden-face-suppression.test.ts`
  - `tests/feature-047-manual-face-box-creation-in-asset-preview.test.ts`
  - `tests/feature-048-block-person-assignment-for-faces-without-consent.test.ts`
  - `tests/feature-057-project-matching-ready-recurring-profiles.test.ts`
  - `tests/feature-058-project-local-assignee-bridge.test.ts`

Live code and schema remain the source of truth where older docs differ.

## Verified current planning boundary

- `asset_face_consent_links` already stores a generic `project_face_assignee_id`, but `asset_face_consent_links_auto_link_requires_consent_check` still blocks recurring auto rows.
- `reconcilePhotoFaceCanonicalStateForAsset(...)` is still consent-only:
  - loads only `asset_consent_face_compares`
  - loads only consent state
  - keys contenders by `consent_id`
  - reads only `asset_face_consent_link_suppressions`
  - creates auto assignees only through `ensureProjectConsentFaceAssignee(...)`
- Manual face assignment is already mixed and generic:
  - the face assignment route accepts `project_consent` and `recurring_profile_match`
  - `manualLinkPhotoToRecurringProjectParticipant(...)` already reuses the generic exact-face writer
- Recurring compare evidence already exists and is current-pair aware through:
  - `asset_project_profile_face_compares`
  - `asset_project_profile_face_compare_scores`
  - `resolveReadyProjectRecurringSource(...)`
  - recurring queue continuations and repair flows
- `processCompareRecurringProfileMaterializedPairJob(...)` persists recurring evidence but does not call canonical reconcile today.
- Exact-face suppressions are still consent-keyed only through `asset_face_consent_link_suppressions`.
- Manual unlink/replace/hide/block only create exact-face suppressions for consent-backed rows today, so recurring rows would immediately re-auto-apply once recurring auto ownership exists.
- Preview and lightbox already understand recurring linked owners and recurring candidate identity, but:
  - recurring candidate rows are evidence-only today
  - unmatched faces and manual boxes do not get unscored recurring options
  - recurring headshot thumbnail fields are not populated
  - overlay badges still use consent thumbnails only
- Manual-created faces still have `face_source = "manual"` and remain outside detector-only auto reconcile.
- Hidden, blocked, and zero-face fallback behavior are already isolated and should stay that way.
- Existing recurring replay is source-driven. Project recurring consent grant/revoke does not currently trigger asset-level canonical reconcile when compare rows are unchanged.

## Recommendation

Implement Feature 059 by widening the existing canonical face reconcile path instead of creating a recurring-only auto path.

The bounded recommendation is:

1. Generalize exact-face suppression from consent-level to assignee-level.
2. Widen `reconcilePhotoFaceCanonicalStateForAsset(...)` to union one-off and recurring contenders into one normalized in-memory winner model.
3. Reuse the existing compare tables and worker infrastructure.
4. Add the minimum replay widening needed for project recurring consent eligibility changes when compare rows do not change.
5. Add unscored recurring manual-link rows and recurring headshot thumbnails to the preview/manual-link read model.

No new matcher, queue model, compare persistence model, or directory-wide recurring search is needed.

## Chosen canonical auto-assignment architecture

`reconcilePhotoFaceCanonicalStateForAsset(...)` remains the only canonical auto-owner writer.

### Contender loading

Load and normalize two contender sources for the current asset materialization:

- One-off contenders from `asset_consent_face_compares` plus consent state/current headshot checks.
- Recurring contenders from `asset_project_profile_face_compares` plus recurring source currentness and project recurring auto-eligibility checks.

Use one in-memory contender shape:

- `projectFaceAssigneeId?: string`
- `assigneeKind: "project_consent" | "project_recurring_consent"`
- `consentId: string | null`
- `projectProfileParticipantId: string | null`
- `recurringProfileConsentId: string | null`
- `assetFaceId: string`
- `confidence: number`
- `stableContenderKey: string`

### Winner selection

Keep the current deterministic per-face winner loop and widen the sort key:

1. Higher `confidence`
2. Lower `stableContenderKey`

Stable contender keys:

- one-off: `consent:<consentId>`
- recurring: `recurring_consent:<recurringProfileConsentId>`

This preserves replay determinism and one-owner-per-face behavior without introducing a second auto precedence system.

### Write path

After winner selection:

- resolve or create assignees through:
  - `ensureProjectConsentFaceAssignee(...)`
  - `ensureProjectRecurringConsentFaceAssignee(...)` or a new recurring auto-safe helper
- upsert all desired auto winners into `asset_face_consent_links`
- keep the existing `asset_face_id` upsert target
- keep delete-on-stale behavior for displaced auto rows
- keep manual-over-auto precedence exactly as it works today

### Worker integration

The recurring compare worker must start invoking canonical reconcile after persisting a current recurring compare pair, matching the one-off materialized compare path.

This is not a new auto-apply system. It is the existing canonical writer now being fed recurring evidence too.

## Exact recurring auto-eligibility rules

Recurring auto ownership requires all of the following server-side conditions:

1. A current project participant exists for the project/profile pair.
2. `resolveReadyProjectRecurringSource(...)` returns a current source for that participant.
3. The participant has an active project-specific recurring consent in that project.
4. That project-specific recurring consent is not revoked.
5. That project-specific recurring consent has `face_match_opt_in = true`.
6. The target face is current, detector-backed, not hidden, and not blocked.
7. No exact-face assignee suppression exists for that face and assignee pair.
8. The assignee is not already manually linked on another face in the asset.

### Manual assignment vs auto assignment

Feature 059 will intentionally keep these different:

- Auto recurring assignment requires project recurring `face_match_opt_in = true`.
- Manual recurring assignment stays aligned with current 058 behavior and requires an active signed project recurring consent, but does not newly block on project recurring `face_match_opt_in`.

This keeps automation conservative without reopening the manual-link product surface in the same cycle.

## Exact mixed contender and one-owner-per-face behavior

- One-off consent-backed contenders and recurring assignee contenders may compete for the same face.
- Both use the same confidence threshold from the current auto-match config.
- Both use the same hidden/blocked/manual-face exclusions.
- Both are excluded by manual-over-auto precedence.
- Only one current canonical row may exist per face, and only one current face per assignee per asset remains allowed by the existing unique index.

Historical auto rows should keep the same preservation rule the system already uses for one-off consents:

- If a current auto owner later becomes ineligible only because its consent gate is revoked or opt-out changes, preserve the current row as historical current state until another explicit action replaces or removes it.
- Hidden, blocked, manual replace, manual unlink, stale materialization, or a new winner still remove/replace rows normally.

This preservation rule should now be generalized from consent-backed auto rows to both assignee kinds.

## Exact generic suppression plan

Feature 059 should replace consent-keyed exact-face suppressions with a generic assignee-keyed exact-face suppression table.

### New table

Add `asset_face_assignee_link_suppressions` with:

- `asset_face_id`
- `asset_materialization_id`
- `asset_id`
- `project_face_assignee_id`
- `tenant_id`
- `project_id`
- `reason`
- `created_at`
- `created_by`

Constraints and indexes:

- primary key on `(asset_face_id, project_face_assignee_id)`
- FK to `asset_face_materialization_faces`
- FK to `asset_face_materializations`
- FK to `(asset_id, tenant_id, project_id)`
- FK to `(project_face_assignee_id, tenant_id)` on `project_face_assignees`
- reason check stays `manual_unlink | manual_replace`
- indexes on `(tenant_id, project_id, asset_id)` and `(tenant_id, project_id, project_face_assignee_id)`

### Migration posture

- Backfill current `asset_face_consent_link_suppressions` rows into the new table by resolving the matching `project_face_assignee_id` for each consent-backed row.
- Switch exact-face reads and writes to the new table in the same release.
- Keep the old consent suppression table physically in place for one cycle if desired, but do not dual-read or dual-write in steady-state 059 logic.

### Write rules

Write assignee suppressions for both one-off and recurring rows when:

- a current face assignment is manually unlinked
- a current face assignment is manually replaced by another assignee
- a current assignee is moved from one face to another
- hide/block removes a current face owner

Clear assignee suppressions when:

- the same assignee is manually re-linked to that face
- a consent source change or recurring source change should intentionally reopen auto assignment for that assignee

### Source-change clearing

Mirror the current one-off source reset behavior:

- consent headshot/source change keeps clearing suppressions for that consent-backed assignee
- recurring headshot replacement or recurring selection-face changes should clear suppressions for the affected recurring assignee before replay

No zero-face fallback suppression changes are needed. `asset_consent_manual_photo_fallback_suppressions` stays consent-only.

## Exact replay and reconcile widening plan

Feature 059 needs a bounded replay path for project recurring consent eligibility changes that do not produce new compare rows.

### Chosen approach

Reuse `reconcile_project` jobs instead of adding a new async subsystem.

Add a new replay payload kind for project recurring consent eligibility changes, for example:

- `replayKind: "recurring_project_consent_eligibility"`

Payload should include at least:

- `projectProfileParticipantId`
- `profileId`
- `reason`

### Worker handling

In the existing `reconcile_project` branch:

1. Resolve the affected asset set from:
   - `asset_project_profile_face_compares` for the participant
   - current recurring auto rows in `asset_face_consent_links` joined through `project_face_assignees`
2. For each affected asset, run `reconcilePhotoFaceCanonicalStateForAsset(...)`.
3. Do not require new compare jobs first.

### Producers

Enqueue this replay on project recurring consent changes that affect auto eligibility:

- project recurring consent granted
- project recurring consent revoked
- project recurring `face_match_opt_in` flips if that surface exists

This is the smallest bounded way to converge auto ownership when only the project-level legal gate changes.

## Exact schema and model plan

### Required schema changes

1. Drop `asset_face_consent_links_auto_link_requires_consent_check`.
2. Add `asset_face_assignee_link_suppressions`.
3. Backfill exact-face suppressions from consent-keyed rows into assignee-keyed rows.
4. Add RLS policies for the new suppression table matching current project/tenant access patterns.

### Helper and model changes

- Generalize current assignment loading so exact-face suppressions are returned by assignee id, not consent id.
- Add recurring auto-eligibility loading keyed by participant or assignee.
- Keep compare persistence tables unchanged.
- Keep `project_face_assignees` unchanged apart from read/write helper widening.

No broad schema redesign is needed.

## Manual-link continuity plan

The generic face assignment route and force-replace behavior stay in place.

### What stays unchanged

- `POST /assets/[assetId]/faces/[assetFaceId]/assignment`
- `DELETE /assets/[assetId]/faces/[assetFaceId]/assignment`
- manual-created faces remain linkable through the same route
- consent-backed manual linking remains unchanged
- recurring manual linking remains project-participant scoped

### Candidate tray widening

Keep the current evidence-backed recurring rows, including blocked states for missing, pending, or revoked project recurring consent.

Additionally, add unscored recurring rows for manual-link eligible project participants:

- project participant exists
- project recurring consent state is `signed`
- no tenant-directory search

Behavior by face type:

- unmatched detector faces: show scored recurring rows when evidence exists, plus unscored eligible recurring rows when no score exists
- manual-created faces: same recurring manual-link rows should appear
- hidden faces: no change; restore first
- blocked faces: no change; blocked state still wins until cleared

Manual-created faces remain manual-only for auto assignment.

## Preview, read-model, and UI plan

Keep the existing preview/lightbox structure and widen only the read model.

### Read-model changes

Add recurring headshot thumbnail and preview data to:

- linked recurring owners in `getAssetPreviewFaces(...)`
- recurring face candidates in `getAssetPreviewFaceCandidates(...)`

Add a small batched recurring headshot loader keyed by profile id or participant id. It should reuse current recurring headshot state and signed URL logic rather than introducing a new asset identity model.

### UI changes

- `project-asset-preview-lightbox.tsx` should use recurring headshot thumbnails for recurring linked owners and recurring candidates where available.
- `previewable-image.tsx` already accepts a generic `headshotThumbnailUrl`; reuse it.
- Existing recurring identity labels and blocked reason copy can stay reused through the current i18n keys.

No arbitrary add-person search and no broader preview redesign are needed.

## Hidden, blocked, manual, and fallback interaction plan

- Hidden faces stay excluded from auto contenders and stay hidden until restored.
- Blocked faces stay excluded from auto contenders and keep current block-clear-on-manual-save behavior.
- Manual-created faces remain excluded from canonical auto assignment because the detector-only rule stays in place.
- Zero-face fallback remains separate and consent-only.

Feature 059 should not widen fallback behavior unless implementation reveals a hard blocker, which current live code does not suggest.

## Export and downstream decision

No export-specific widening is planned for 059.

Feature 058 already moved canonical exact-face ownership to project-local assignees, and recurring manual ownership already flows into export metadata. Once recurring auto rows use the same canonical table, export should continue to read them through the same assignee-based path.

## Security and reliability considerations

- Keep all tenant and project scoping server-side.
- Never trust client-provided tenant ids, assignee ids, or consent state.
- Revalidate auto eligibility at write time inside canonical reconcile.
- Keep exact-face writes idempotent through existing upsert/delete patterns.
- Keep queue, continuation, replay, and repair infrastructure unchanged apart from new payload handling.
- Ensure new replay producers use existing dedupe/window-key patterns so consent grant/revoke bursts remain retry-safe.
- Clear recurring suppressions before recurring source replay so stale suppressions do not permanently block renewed exact-face auto assignment.

## Edge cases

- Mixed one-off and recurring contenders with equal confidence must resolve deterministically by stable contender key.
- A recurring auto winner manually displaced or unlinked must get an assignee suppression so it does not immediately reapply.
- A recurring source replacement must invalidate stale compare rows through existing currentness checks and clear suppressions before replay.
- A project recurring consent revoke should stop new recurring auto application without forcing a broad row purge; existing auto ownership is preserved as historical current state until another action changes it.
- A later re-grant creates a new active recurring consent and may create a new assignee row; old suppressions tied to old assignee ids should not block the new assignee.
- Duplicate worker/replay execution must converge safely because canonical reconcile remains idempotent.
- Manual-created faces with no detector evidence must still be manually linkable to either assignee type.
- The feature must not enumerate or score recurring profiles outside project participants already in scope.

## Test plan

### New feature coverage

Add a dedicated `tests/feature-059-auto-assignment-for-project-scoped-recurring-assignees.test.ts` covering:

- mixed auto contenders on the same face where recurring wins
- mixed auto contenders on the same face where one-off wins
- equal-confidence mixed contenders using deterministic tie-break
- recurring auto blocked when project recurring consent is missing, pending, revoked, or `face_match_opt_in = false`
- recurring auto succeeds when source is ready and project recurring consent is signed with opt-in
- recurring compare processing now triggers canonical reconcile and writes an auto row
- generic suppression prevents reapply after recurring auto unlink and recurring auto manual replacement
- project recurring consent grant/revoke replays asset-level reconcile without new compare rows
- recurring auto exclusion for hidden, blocked, and manual-created faces
- recurring unscored manual-link rows for unmatched detector faces and manual boxes
- recurring headshot thumbnail presence for recurring candidates and linked recurring owners
- no tenant-directory-wide candidate widening

### Existing test updates

- `tests/feature-058-project-local-assignee-bridge.test.ts`
  - update suppression assertions to the new assignee suppression table
  - assert recurring candidate and linked-owner headshot fields when headshot exists
- `tests/feature-047-manual-face-box-creation-in-asset-preview.test.ts`
  - add recurring manual-link candidate coverage for manual-created faces
- `tests/feature-031-one-consent-per-face-precedence-rules.test.ts`
  - update exact-face suppression table references if they assert storage directly
- `tests/feature-045-asset-preview-unlinked-faces-and-hidden-face-suppression.test.ts`
  - update exact-face suppression assertions to the assignee-keyed table while leaving fallback suppression assertions unchanged
- `tests/feature-048-block-person-assignment-for-faces-without-consent.test.ts`
  - confirm blocked-face auto exclusion still holds after mixed contender widening

## Implementation phases

### Phase 1: Schema, suppression, and shared eligibility helpers

- add migration for generic assignee suppressions
- remove the consent-only auto-row constraint
- backfill consent suppressions into assignee suppressions
- switch exact-face suppression helpers to assignee ids
- add recurring auto-eligibility helper(s)

### Phase 2: Canonical reconcile widening

- widen `reconcilePhotoFaceCanonicalStateForAsset(...)` to mixed contenders
- generalize historical auto-row preservation to both assignee kinds
- call canonical reconcile after recurring compare jobs

### Phase 3: Replay widening for eligibility-only changes

- add `reconcile_project` handling for project recurring consent eligibility replays
- enqueue that replay on project recurring consent grant/revoke/opt-in changes
- clear recurring suppressions on recurring source changes before replay

### Phase 4: Preview and manual-link read-model widening

- add unscored recurring participant rows for face candidate trays
- add recurring headshot thumbnail/preview fields
- update lightbox and overlay badge reads to use recurring headshots

### Phase 5: Tests and cleanup

- add the new feature 059 test
- update existing boundary tests
- remove remaining consent-only exact-face suppression reads/writes
- keep deferred cleanup of legacy suppression tables separate if needed

## Explicitly deferred work

- recurring zero-face fallback
- tenant-directory recurring search or add-person search in the lightbox
- broader consent review/session redesign
- any queue or matcher redesign
- any merge between one-off and recurring identity models
- broader export or DAM redesign

## Concise implementation prompt

Implement Feature 059 by widening the existing exact-face linking system, not by creating a second recurring-only auto-assignment path.

- Add a migration that removes the consent-only auto-row check from `asset_face_consent_links` and introduces `asset_face_assignee_link_suppressions`, backfilled from existing consent-keyed face suppressions.
- Widen `reconcilePhotoFaceCanonicalStateForAsset(...)` so it loads one-off contenders from `asset_consent_face_compares` and recurring contenders from `asset_project_profile_face_compares`, normalizes them into one contender model, and selects exactly one deterministic winner per eligible detector face.
- Require recurring auto eligibility to have a current ready recurring source, a current project participant, an active signed project recurring consent, and project recurring `face_match_opt_in = true`; keep recurring manual assignment on the existing signed-project-consent path.
- Reuse the existing worker/replay infrastructure by invoking canonical reconcile after recurring compare jobs and by adding a `reconcile_project` replay branch for project recurring consent eligibility changes that reconciles affected assets without requiring new compare rows.
- Preserve manual-over-auto, hidden/blocked/manual-face semantics, one-owner-per-face behavior, and zero-face fallback as-is.
- Widen preview/manual-link reads so unmatched faces and manual boxes can show unscored but eligible recurring participants, and populate recurring headshot thumbnail/preview URLs for recurring candidates and linked owners where available.
