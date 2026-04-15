# Feature 057 Plan: Project Matching Integration for Ready Recurring Profiles

## Inputs and ground truth

Read in the required order:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `docs/rpi/README.md`
5. `docs/rpi/025-matching-queue-robustness/plan.md`
6. `docs/rpi/029-complete-bounded-matching-fanout/plan.md`
7. `docs/rpi/030-continuation-retry-reliability/plan.md`
8. `docs/rpi/044-asset-preview-linking-ux-improvements/research.md`
9. `docs/rpi/044-asset-preview-linking-ux-improvements/plan.md`
10. `docs/rpi/045-asset-preview-unlinked-faces-and-hidden-face-suppression/research.md`
11. `docs/rpi/045-asset-preview-unlinked-faces-and-hidden-face-suppression/plan.md`
12. `docs/rpi/047-manual-face-box-creation-in-asset-preview/research.md`
13. `docs/rpi/047-manual-face-box-creation-in-asset-preview/plan.md`
14. `docs/rpi/048-block-person-assignment-for-faces-without-consent/research.md`
15. `docs/rpi/048-block-person-assignment-for-faces-without-consent/plan.md`
16. `docs/rpi/049-recurring-profiles-and-consent-management-foundations/research.md`
17. `docs/rpi/049-recurring-profiles-and-consent-management-foundations/plan.md`
18. `docs/rpi/050-recurring-profile-directory-foundation/research.md`
19. `docs/rpi/050-recurring-profile-directory-foundation/plan.md`
20. `docs/rpi/051-baseline-recurring-consent-request-foundation/research.md`
21. `docs/rpi/051-baseline-recurring-consent-request-foundation/plan.md`
22. `docs/rpi/052-baseline-request-management/research.md`
23. `docs/rpi/052-baseline-request-management/plan.md`
24. `docs/rpi/053-recurring-consent-history-and-profile-detail/research.md`
25. `docs/rpi/053-recurring-consent-history-and-inline-profile-detail/plan.md`
26. `docs/rpi/054-baseline-follow-up-actions/research.md`
27. `docs/rpi/054-baseline-follow-up-actions/plan.md`
28. `docs/rpi/055-project-participants-and-mixed-consent-intake/research.md`
29. `docs/rpi/055-project-participants-and-mixed-consent-intake/plan.md`
30. `docs/rpi/056-recurring-profile-headshots-and-matching-materialization-foundation/research.md`
31. `docs/rpi/056-recurring-profile-headshots-and-matching-materialization-foundation/plan.md`
32. `docs/rpi/057-project-matching-integration-for-ready-recurring-profiles/research.md`

Targeted live verification used for plan-critical conclusions:

- `src/lib/matching/auto-match-jobs.ts`
- `src/lib/matching/auto-match-worker.ts`
- `src/lib/matching/auto-match-reconcile.ts`
- `src/lib/matching/auto-match-repair.ts`
- `src/lib/matching/auto-match-fanout-continuations.ts`
- `src/lib/matching/materialized-face-compare.ts`
- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/asset-preview-linking.ts`
- `src/lib/matching/project-matching-progress.ts`
- `src/lib/profiles/profile-headshot-service.ts`
- `src/lib/projects/project-participants-service.ts`
- `supabase/migrations/20260307120000_012_auto_match_likely_candidates.sql`
- `supabase/migrations/20260320140000_019_face_materialization_pipeline.sql`
- `supabase/migrations/20260403120000_029_complete_bounded_matching_fanout.sql`
- `supabase/migrations/20260410113000_046_asset_consent_face_compare_scores.sql`
- `tests/feature-029-complete-bounded-matching-fanout.test.ts`
- `tests/feature-031-one-consent-per-face-precedence-rules.test.ts`
- `tests/feature-044-asset-preview-linking-ux-improvements.test.ts`
- `tests/feature-045-asset-preview-unlinked-faces-and-hidden-face-suppression.test.ts`
- `tests/feature-047-manual-face-box-creation-in-asset-preview.test.ts`
- `tests/feature-048-block-person-assignment-for-faces-without-consent.test.ts`
- `tests/feature-055-project-participants-foundation.test.ts`
- `tests/feature-055-project-participants-routes.test.ts`
- `tests/feature-055-project-participants-ui.test.ts`
- `tests/feature-056-recurring-profile-headshot-routes.test.ts`
- `tests/feature-056-recurring-profile-headshot-selection.test.ts`

Use live schema and code as source of truth. Use Feature 057 research as the primary synthesis. This plan does not reopen direct assignee-identity redesign, preview redesign, or broad consent-table redesign.

## Verified current planning boundary

- Ready recurring profile headshots now exist as reusable matching sources through:
  - `recurring_profile_headshots`
  - `recurring_profile_headshot_materializations`
  - `recurring_profile_headshot_materialization_faces`
  - `recurring_profile_headshots.selection_face_id`
- Recurring matching readiness is already derived server-side from:
  - active baseline `recurring_profile_consents.face_match_opt_in = true`
  - one current uploaded recurring headshot
  - one current materialization
  - one current selected canonical face
- Known recurring participation already exists through `project_profile_participants`.
- Current project assignee identity is still consent-backed:
  - exact-face links live in `asset_face_consent_links`
  - preview candidate and change-link flows are still `consentId`-based
- Current compare, score, and likely-candidate persistence are still consent-centric:
  - `asset_consent_face_compares`
  - `asset_consent_face_compare_scores`
  - `asset_consent_match_candidates`
- Current bounded fan-out and repair architecture is good and should be preserved:
  - job queue hardening from Feature 025
  - continuation batching from Feature 029
  - continuation retry reliability from Feature 030
- `reconcile_project` already exists as a job type, but the current materialized worker path completes it as a no-op.

Planning consequence:

- 057 should add recurring-profile matching sources into the project matcher without changing canonical face ownership.
- 057 should reuse the existing worker and continuation architecture instead of adding a second queueing model.
- 057 should not attempt to store recurring sources in the current consent compare tables.

## Recommendation

Implement Feature 057 by introducing ready recurring profile headshots as a second matching source family inside the existing project matching pipeline.

Concrete decisions:

- The main async matching worker remains the primary execution path.
- Recurring profile sources should reuse the current consent-headshot matching flow as much as practical:
  - project-scoped source enumeration
  - shared continuation scheduler
  - shared compare execution model
  - shared repair and progress foundations
- Add a derived project-local recurring source resolver keyed by `project_profile_participant_id`.
- Extend the existing fan-out model so photos can compare against both source families:
  - consent headshots
  - ready recurring participant headshots
- Keep `reconcile_project` as a bounded replay, catch-up, and re-evaluation seam for recurring readiness or participation changes. It is not the main conceptual model of the feature.
- Add parallel project-profile compare evidence tables, including per-face score rows, and do not add a profile-backed likely-candidate table in 057.
- Do not write `asset_face_consent_links`, `asset_consent_match_candidates`, or any other canonical assignment rows from profile-backed evidence in this feature.
- Do not add preview or lightbox UI in 057. Use existing participant readiness badges and existing project matching progress as the only operator-visible signals.

This is the smallest real integration step that makes ready recurring profiles useful for project matching while keeping exact-face ownership and consent-gated assignment unchanged.

## Chosen architecture

### Summary

Feature 057 adds recurring profile headshots as a second project matching source family:

1. Shared primary matching pipeline
   - newly uploaded photos continue through the existing materialize, fan-out, and compare worker flow
   - photo-side fan-out now enumerates both:
     - current project consent headshots
     - current ready recurring project participants
2. Recurring-source catch-up replay
   - `reconcile_project` is used only when recurring source readiness or participation changes require existing project photos to be replayed against the new or changed source set
3. Parallel recurring compare persistence
   - recurring-source compare evidence is stored in project-scoped parallel tables that mirror current compare persistence patterns without widening consent-centric assignment tables

### Why this architecture is the right size

- It keeps the current consent path intact.
- It treats recurring sources as another source family instead of inventing a second matching system.
- It uses project-local recurring participation as the project source anchor.
- It reuses the current worker and continuation scheduler instead of adding a second one.
- It supports both important directions:
  - new project photos must compare against already-ready recurring sources through the normal worker path
  - ready recurring source added later must catch up across existing project photos through bounded replay
- It keeps scoring-source identity separate from canonical assignee identity.

## Exact scope boundary

### Real in 057

- Ready recurring participant headshots become a second project matching source family.
- New recurring-source variants are added to the continuation scheduler.
- New photos can fan out to ready recurring project participants.
- Ready recurring project participants can fan out across existing project photos.
- `reconcile_project` becomes the bounded replay seam for recurring profile source changes.
- Parallel recurring compare evidence tables are added and written by the worker.
- Project repair is extended so recurring-source replay can be re-established safely.
- Project progress and in-progress state account for recurring-source work.

### Explicitly unchanged in 057

- `asset_face_consent_links` remains the only current exact-face owner table.
- Current exact-face ownership remains consent-backed only.
- Manual-over-auto precedence remains unchanged.
- Hidden, blocked, manual-face, and zero-face fallback behavior remain unchanged.
- `asset_consent_face_compares`, `asset_consent_face_compare_scores`, and `asset_consent_match_candidates` remain consent-centric and are not widened.
- Preview face candidate routes remain consent-only.
- Lightbox and candidate tray UX remain unchanged.

### Prepared for later, not implemented now

- preview/lightbox consumption of profile-backed evidence
- project-local bridge from recurring profile evidence to a directly assignable consent-backed identity
- profile-backed change-link and exact-face assignment UX
- profile-backed likely-candidate rows

## Exact project-local source resolver model

### Stable identity versus current compare instance

For recurring sources, 057 keeps this distinction explicit:

- stable reusable identity:
  - `profile_id`
- project-local source anchor:
  - `project_profile_participant_id`
- current compare instance:
  - current recurring `headshot_id`
  - current recurring headshot `materialization_id`
  - current recurring `selection_face_id`

### Chosen internal source descriptor

Add one internal resolver union used by worker and continuation code:

- `ProjectMatchingSource`

Consent variant:

- `kind = 'consent_headshot'`
- `consentId`
- `sourceAssetId`
- `sourceMaterializationId`

Recurring variant:

- `kind = 'ready_recurring_profile'`
- `projectProfileParticipantId`
- `profileId`
- `recurringHeadshotId`
- `recurringHeadshotMaterializationId`
- `selectionFaceId`
- `participantCreatedAt`
- `sourceUpdatedAt`

This descriptor is derived on demand. 057 does not add a persisted project-local source table.

### Chosen resolver shape

Add two new server helpers:

- `resolveReadyProjectRecurringSource(...)`
  - loads the current ready source for one participant
- `listReadyProjectRecurringSourcesPage(...)`
  - keyset-pages current ready recurring sources for a project

Required ordering:

- `(project_profile_participants.created_at asc, project_profile_participants.id asc)`

Required ready filters:

- project participant exists in tenant and project
- active baseline recurring consent with `face_match_opt_in = true`
- current recurring headshot exists and is not superseded
- current recurring headshot materialization exists and is compare-usable
- current `selection_face_id` exists

Required photo-boundary snapshot filter for photo-side fan-out:

- current recurring source `updated_at <= boundary_snapshot_at`

Reason:

- this prevents a photo-side continuation from picking up a participant who was added earlier but only became ready after the photo snapshot
- a later readiness change is handled by source-targeted `reconcile_project`, not by widening old photo continuations

### Why a derived-only resolver is enough

No thin source table is needed in 057 because currentness can be derived from existing rows:

- `project_profile_participants`
- `recurring_profile_headshots`
- `recurring_profile_headshot_materializations`
- `recurring_profile_consents`

Persisted compare rows and continuations will carry enough source-instance identifiers to revalidate currentness later.

## Exact trigger and replay seam

### Decision

`reconcile_project` is used in 057 as a bounded replay, catch-up, and re-evaluation seam for recurring-source availability changes.

It is not the primary execution path. The primary execution path remains the existing worker flow that starts from normal project photo intake and fans out across all current source families.

### Exact use in 057

Use `reconcile_project` only when the recurring source set for an already-existing project photo universe may have changed:

- a ready recurring profile is added to the project
- an existing participant becomes ready
- an already-ready participant changes current source instance
- an already-ready participant becomes not-ready

Do not use `reconcile_project` as the main conceptual entrypoint for recurring matching. New photos should reach recurring sources through the same materialize and fan-out path already used for consent headshots.

One job maps to one affected recurring participant inside one project.

Chosen dedupe key shape:

- `reconcile_project:${projectId}:recurring_profile_participant:${participantId}`

Chosen payload shape:

- `replayKind = 'recurring_profile_source'`
- `projectProfileParticipantId`
- `profileId`
- `reason`

Trigger producers must call `enqueueReconcileProjectJob(...)` with:

- `mode = 'repair_requeue'`

Reason:

- duplicate triggers should requeue the same logical replay row
- repeated source changes should not accumulate terminal dead rows

### Trigger producers in 057

#### 1. Ready recurring profile added to project

In `addProjectProfileParticipant(...)`:

- after insert or duplicate replay, resolve matching readiness
- if readiness is `ready`, enqueue the participant-scoped `reconcile_project` job

#### 2. Participant becomes ready after headshot upload, materialization, or face selection

In recurring profile headshot mutation paths from Feature 056:

- compute readiness before and after the mutation
- if the source transitions into `ready`, or stays `ready` but changes headshot/materialization/selection instance, load all `project_profile_participants` for that profile and enqueue one `reconcile_project` per project participant row

This applies to:

- recurring headshot activation/finalize
- recurring headshot repair completion
- recurring headshot manual face selection

#### 3. Previously ready participant becomes not-ready after replacement or opt-in revocation

In the same headshot and recurring-consent mutation paths:

- if readiness transitions out of `ready`, or baseline opt-in revokes readiness, load all project participants for that profile and enqueue the same participant-scoped `reconcile_project` jobs

### What the `reconcile_project` worker path does

For `replayKind = 'recurring_profile_source'`:

1. resolve the current recurring source for `projectProfileParticipantId`
2. if the source is not ready:
   - supersede any active recurring-source continuations for that participant
   - complete the replay job
3. if the source is ready:
   - compute the current photo boundary for the project
   - create or reset one `recurring_profile_to_photos` continuation for that exact source instance
   - supersede any older recurring-source continuations for the same participant that no longer match the current source instance
   - complete the replay job

This keeps replay bounded and current-source aware, while leaving normal photo intake as the main way matching work enters the system.

### Why this is smaller than project-wide replay

- no project-wide queued scan is needed
- no new project-scoped pagination state is needed in `reconcile_project`
- the job only touches the participant whose source changed
- project repair can still use this seam by enqueuing one replay job per ready participant when catch-up is needed

## Exact continuation and fan-out changes

### Direction changes

Keep existing directions:

- `photo_to_headshots`
- `headshot_to_photos`

Add recurring directions:

- `photo_to_recurring_profiles`
- `recurring_profile_to_photos`

These are not a separate matching pipeline. They are recurring-source variants inside the same continuation scheduler used today for consent-headshot work.

### Continuation schema changes

Widen the existing `face_match_fanout_continuations` table instead of adding a second continuation table.

Add nullable recurring-source fields:

- `source_project_profile_participant_id uuid null`
- `source_profile_id uuid null`
- `source_headshot_id uuid null`
- `source_selection_face_id uuid null`
- `boundary_project_profile_participant_id uuid null`
- `cursor_project_profile_participant_id uuid null`

Relax and extend existing semantics:

- `source_asset_id` remains used for photo and consent-headshot directions
- `source_asset_id` becomes nullable for `recurring_profile_to_photos`
- `source_materialization_id` remains generic scheduler metadata and can hold either:
  - `asset_face_materializations.id`
  - `recurring_profile_headshot_materializations.id`

Direction-specific constraints should enforce which columns must be present.

### Continuation creation rules

#### Photo-side materialize handoff

When `materialize_asset_faces` completes for a photo:

- keep current `photo_to_headshots` continuation creation unchanged
- additionally create or reset one `photo_to_recurring_profiles` continuation using:
  - the photo materialization as source
  - a recurring-source boundary captured at photo intake

This is the primary recurring-source execution path in 057. A new project photo should enter recurring matching the same way it already enters consent-headshot matching: via the main worker pipeline and shared continuation fan-out.

#### Replay catch-up handoff

When the recurring participant `reconcile_project` job runs:

- create or reset one `recurring_profile_to_photos` continuation for the current ready source instance

This is a bounded backfill path for existing project photos whose source universe changed after intake. It should not become the main model for recurring matching.

### Photo intake boundary additions

When `photo_uploaded` is enqueued, capture and persist a recurring-source boundary alongside the existing consent boundary:

- `recurringBoundarySnapshotAt`
- `recurringBoundaryParticipantCreatedAt`
- `recurringBoundaryParticipantId`

Boundary lookup should use the current ready recurring source set, ordered by participant created-at and id.

### Why recurring replay does not need a source materialize job

Recurring headshot materialization is already handled by Feature 056.
057 should not force that source into `materialize_asset_faces`.

The recurring-source replay seam should create or reset continuations directly from the already-materialized recurring source, while ongoing project photo intake continues to flow through the main materialized worker path.

## Exact persistence direction for profile-backed evidence

### Decision

Choose a bounded parallel compare-evidence structure:

- `asset_project_profile_face_compares`
- `asset_project_profile_face_compare_scores`

Do not add a profile-backed likely-candidate table in 057.

### Why this is the right persistence choice

- compare-summary rows give one durable source-to-asset result per source instance
- per-face score rows are required for later selected-face candidate trays
- candidate rows are not needed yet because 057 does not expose UI and does not support direct assignment
- this avoids widening the current consent compare and candidate tables

### Exact table purpose

#### `asset_project_profile_face_compares`

One summary compare row per:

- project participant source instance
- photo asset materialization
- compare version

Required stored identity:

- `project_profile_participant_id`
- `profile_id`
- `asset_id`
- `recurring_headshot_id`
- `recurring_headshot_materialization_id`
- `recurring_selection_face_id`
- `asset_materialization_id`
- `winning_asset_face_id`
- `winning_asset_face_rank`
- `winning_similarity`
- `compare_status`
- `compare_version`
- provider metadata
- `target_face_count`
- `compared_at`

Required uniqueness:

- unique on `(tenant_id, project_id, project_profile_participant_id, asset_id, recurring_selection_face_id, asset_materialization_id, compare_version)`

Reason:

- selection changes on the same recurring headshot materialization must create a new logical source instance

#### `asset_project_profile_face_compare_scores`

One score row per:

- project participant source instance
- target asset face
- compare version

Required stored identity:

- `project_profile_participant_id`
- `profile_id`
- `asset_id`
- `recurring_selection_face_id`
- `recurring_headshot_materialization_id`
- `asset_materialization_id`
- `asset_face_id`
- `asset_face_rank`
- `similarity`
- `compare_version`
- provider metadata
- `compared_at`

Required uniqueness:

- unique on `(tenant_id, project_id, project_profile_participant_id, asset_id, recurring_selection_face_id, asset_materialization_id, asset_face_id, compare_version)`

### Currentness validation rule

Profile-backed evidence is treated as current only when the participant's current ready source still matches:

- `project_profile_participant_id`
- current `recurring_headshot_materialization_id`
- current `selection_face_id`

Do not rely on `profile_id` alone.

### Compare execution job decision

Add one new matching job type:

- `compare_recurring_profile_materialized_pair`

Reason:

- the current `compare_materialized_pair` job is structurally consent-bound
- adding one new parallel compare executor is smaller than widening the current consent compare job contract

Chosen dedupe key inputs:

- `projectProfileParticipantId`
- `assetId`
- `recurringSelectionFaceId`
- `assetMaterializationId`
- `compareVersion`

### What 057 does not persist

- no writes to `asset_consent_match_candidates`
- no writes to `asset_face_consent_links`
- no profile-backed auto-winner rows in canonical link tables

## Exact relationship to current assignee identity

### Explicit rule

Recurring profiles become scoring sources in 057.
They do not become direct project face assignees in 057.

### Allowed state in 057

Yes, profile-backed evidence may exist even when there is no project-local assignable recurring consent context yet.

That state is represented by:

- project-scoped compare evidence rows keyed to `project_profile_participant_id`
- no canonical exact-face link
- no likely-candidate assignment row

### Future bridge boundary

A later feature can make a profile-backed candidate directly assignable only after:

- project-specific recurring consent is active for that profile in the project
- there is a deliberate project-local assignee projection that current exact-face write paths can validate

057 does not implement or decide that bridge.

## Exact repair, reconcile, and progress adjustments

### `reconcile_project`

`reconcile_project` becomes a real recurring replay seam, but only as bounded recurring participant catch-up and re-evaluation.

It does not replace:

- recent-window intake reconcile
- project repair
- the main worker path for newly uploaded photos

### `runAutoMatchReconcile(...)`

Keep recent-window reconcile for current consent flows unchanged.

Add one recurring-source branch:

- recent ready/not-ready recurring source events should requeue participant-scoped `reconcile_project` jobs

Do not turn recent-window reconcile into a broad recurring source scanner in 057, and do not route normal recurring matching through reconcile.

### `runProjectMatchingRepair(...)`

Keep current photo/headshot repair behavior.

Add one recurring extension:

- page current ready recurring project participants
- enqueue or requeue one participant-scoped `reconcile_project` job per ready participant

Do not make project repair directly create recurring continuations. Reuse the replay seam.

### Progress

Keep user-facing progress percentage photo-centric:

- `totalImages` unchanged
- `processedImages` unchanged
- `progressPercent` unchanged

Extend activity/degraded state:

- `isMatchingInProgress` should count:
  - queued or active `reconcile_project` rows for recurring participant replay
  - queued or active recurring continuation rows
  - queued or active `compare_recurring_profile_materialized_pair` rows
- degraded-state checks should include recurring continuations and compare jobs the same way current continuation/job health is handled

## Exact `/projects/[projectId]` and observability impact

### Decision

Do not add new dedicated UI in 057.

### Observable effect that is allowed

- existing participant readiness badges from Feature 056 remain
- existing project matching progress becomes truthful for recurring-source replay and fan-out work

This is the smallest honest observable behavior for 057.

### Explicit non-goals

- no new participant action button
- no new preview tray state
- no new lightbox indicator
- no profile-backed face candidate panel yet

## Exact future fit with asset preview and candidate tray UX

The chosen persistence model supports later asset-preview integration without redesigning exact-face writes now.

Later preview face candidate trays can:

- union `asset_consent_face_compare_scores`
- with `asset_project_profile_face_compare_scores`

Later per-face detail can:

- use compare-summary rows from both evidence families
- show profile-backed evidence as ranked face-scoped evidence
- keep profile-backed rows visibly non-assignable until a project-local assignable consent bridge exists

Manual-over-auto and face-state compatibility remain intact because:

- hidden and blocked faces still filter face-level candidate rendering
- manual exact-face ownership still wins
- manual faces remain out of auto reconciliation
- zero-face fallback remains separate from face-scored evidence

## Security and reliability considerations

- derive tenant scope server-side only
- never accept `tenant_id` from the client
- recurring readiness remains server-derived from baseline consent plus current recurring headshot state
- exact-face ownership stays on current consent-backed tables only
- duplicate participant-ready triggers must be safe through `repair_requeue` on participant-scoped `reconcile_project`
- stale recurring evidence must be filtered by current participant source instance, not just by `profile_id`
- headshot replacement, selection changes, and opt-in revocation must supersede or bypass stale continuations safely
- recurring-source compare jobs must never write canonical links
- project repair and replay remain idempotent and bounded
- no new access authority is granted by profile-backed evidence alone

## Edge cases

- Profile becomes ready while recurring replay is already queued:
  - the same participant-scoped `reconcile_project` row is requeued and converges on the current source instance.
- Profile becomes not-ready while recurring compare work is already in flight:
  - source currentness checks supersede later continuation batches and recurring compare rows are not treated as current unless they still match the current source instance.
- Duplicate participant add:
  - existing unique participant row plus replay dedupe prevents duplicate source replay.
- Duplicate readiness triggers:
  - participant-scoped `reconcile_project` requeue semantics make this safe.
- Repeated project repair:
  - replays the same participant-scoped recurring source jobs safely.
- Ready profile source but no project-local assignable recurring consent context:
  - compare evidence exists, direct assignment still does not.
- Manual exact-face assignment already exists:
  - recurring evidence persists, but no canonical write occurs and manual ownership remains unchanged.
- Hidden or blocked face receives recurring profile evidence:
  - evidence may exist in persistence, but face-state filters still win for later preview and assignment behavior.
- Headshot replacement or manual reselection invalidates old source currentness:
  - new replay creates or resets continuations for the new source instance; old source continuations are superseded and old evidence is no longer current.

## Test plan

Add one dedicated regression file:

- `tests/feature-057-project-matching-ready-recurring-profiles.test.ts`

Extend existing coverage where it already owns the boundary:

- `tests/feature-029-complete-bounded-matching-fanout.test.ts`
- `tests/feature-055-project-participants-foundation.test.ts`
- `tests/feature-056-recurring-profile-headshot-routes.test.ts`
- existing project progress coverage

Required regression coverage:

### Trigger and replay

- adding a ready recurring profile participant enqueues participant-scoped `reconcile_project`
- adding a not-ready participant does not enqueue recurring replay
- recurring headshot readiness transition to `ready` enqueues replay for all affected participant rows
- transition out of `ready` also enqueues replay

### Source resolver and currentness

- `resolveReadyProjectRecurringSource(...)` returns the current headshot/materialization/selection face for a ready participant
- non-ready participants do not resolve
- photo-side recurring source paging excludes sources whose current headshot row `updated_at` is newer than the photo boundary snapshot
- currentness checks reject stale source instances after replacement or manual reselection

### Fan-out integration

- photo materialization creates both consent and recurring continuations when both source families exist
- participant-scoped `reconcile_project` creates `recurring_profile_to_photos` continuation for a ready source
- recurring continuations page over project photos across multiple worker runs without duplicate compare rows

### Profile-backed compare persistence

- `compare_recurring_profile_materialized_pair` writes:
  - one summary compare row
  - per-face score rows
- no `asset_face_consent_links` writes occur
- no `asset_consent_match_candidates` writes occur

### Repair and progress

- project repair requeues recurring participant replay for ready participants
- active recurring replay/continuation/compare work keeps `isMatchingInProgress = true`
- progress percentage remains photo-centric

### No assignment redesign

- profile-backed compare evidence never changes canonical face ownership in 057
- manual-over-auto, hidden, blocked, and manual-face tests remain green without needing profile-aware exact-link changes

## Implementation phases

### Phase 1: Shared source-family integration

- add participant-scoped recurring source resolver helpers
- extend normal project photo source enumeration so photo-side fan-out includes ready recurring participants
- add or update shared source-descriptor helpers so consent and recurring sources can flow through the same worker scheduling logic

### Phase 2: Replay seam and continuation model

- extend `reconcile_project` payload handling for recurring participant replay
- enqueue replay from:
  - `addProjectProfileParticipant(...)`
  - recurring headshot finalize/repair/selection paths
  - recurring baseline consent readiness-changing paths

- widen `face_match_fanout_continuations` for recurring source metadata
- add recurring directions:
  - `photo_to_recurring_profiles`
  - `recurring_profile_to_photos`
- add recurring source boundary capture on `photo_uploaded`
- add recurring page readers and recurring currentness checks

### Phase 3: Parallel recurring compare persistence

- add:
  - `asset_project_profile_face_compares`
  - `asset_project_profile_face_compare_scores`
- add `compare_recurring_profile_materialized_pair` job type, dedupe builder, worker path, and compare persistence helper

### Phase 4: Repair and progress integration

- extend project repair to enqueue participant-scoped recurring replay for current ready participants
- extend project progress activity/degraded checks to include recurring replay, recurring continuations, and recurring compare jobs

### Phase 5: Tests and polish

- add feature-specific regression coverage
- extend fan-out and progress coverage
- verify no canonical assignment behavior changed

## Explicitly deferred follow-up cycles

- direct recurring-profile assignee identity in `asset_face_consent_links`
- profile-backed likely-candidate table and ranking UX
- lightbox and candidate tray redesign
- direct change-link flows from profile-backed evidence
- automatic consent request generation from matched profiles
- one-off and recurring identity merge
- batch participant send workflows
- broader consent backend redesign
- multi-headshot recurring profile redesign
- CompreFace provider redesign

## Concise implementation prompt

Implement Feature 057 as an additive second-source-family extension of the existing project matching pipeline. Treat ready recurring project participant headshots as recurring matching sources that reuse the current materialize, fan-out, compare, repair, and progress architecture as much as possible. Add a derived project-local recurring source resolver keyed by `project_profile_participant_id`, widen the existing fan-out continuation model to support `photo_to_recurring_profiles` and `recurring_profile_to_photos`, capture recurring-source boundaries on `photo_uploaded`, and ensure new project photos fan out to both consent and recurring sources through the main worker path. Make `reconcile_project` a participant-scoped replay and catch-up seam for recurring readiness or participation changes by reusing `repair_requeue` semantics with a dedupe key per project participant. Add a new `compare_recurring_profile_materialized_pair` job type and parallel project-profile compare evidence tables that persist summary compare rows plus per-face score rows keyed by participant and current selected recurring face. Extend project repair and matching progress so recurring replay and continuation work are observable, but do not change canonical exact-face ownership, consent-backed assignment, preview candidate APIs, or lightbox UI in this feature.
