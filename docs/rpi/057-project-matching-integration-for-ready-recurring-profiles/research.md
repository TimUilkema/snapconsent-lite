# Feature 057 Research: Project Matching Integration for Ready Recurring Profiles

## Scope

Research the smallest coherent next step after Feature 056:

- include ready recurring profile headshots in project matching source enumeration
- preserve the current async worker, continuation, repair, and retry model
- preserve exact-face ownership, consent-gated assignment, and manual-over-auto precedence
- avoid a full preview/lightbox redesign or a broad assignee-identity redesign

Live schema and code are the source of truth. Features 049-056 are the baseline product intent unless live code now contradicts them.

## Inputs reviewed

### Required repo docs

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `docs/rpi/README.md`
5. `docs/rpi/049-recurring-profiles-and-consent-management-foundations/research.md`
6. `docs/rpi/049-recurring-profiles-and-consent-management-foundations/plan.md`
7. `docs/rpi/050-recurring-profile-directory-foundation/research.md`
8. `docs/rpi/050-recurring-profile-directory-foundation/plan.md`
9. `docs/rpi/051-baseline-recurring-consent-request-foundation/research.md`
10. `docs/rpi/051-baseline-recurring-consent-request-foundation/plan.md`
11. `docs/rpi/052-baseline-request-management/research.md`
12. `docs/rpi/052-baseline-request-management/plan.md`
13. `docs/rpi/053-recurring-consent-history-and-profile-detail/research.md`
14. `docs/rpi/053-recurring-consent-history-and-inline-profile-detail/plan.md`
15. `docs/rpi/054-baseline-follow-up-actions/research.md`
16. `docs/rpi/054-baseline-follow-up-actions/plan.md`
17. `docs/rpi/055-project-participants-and-mixed-consent-intake/research.md`
18. `docs/rpi/055-project-participants-and-mixed-consent-intake/plan.md`
19. `docs/rpi/056-recurring-profile-headshots-and-matching-materialization-foundation/research.md`
20. `docs/rpi/056-recurring-profile-headshots-and-matching-materialization-foundation/plan.md`

### Live schema, services, routes, helpers, and tests verified

- `supabase/migrations/20260307120000_012_auto_match_likely_candidates.sql`
- `supabase/migrations/20260320140000_019_face_materialization_pipeline.sql`
- `supabase/migrations/20260327150000_025_matching_pipeline_robustness.sql`
- `supabase/migrations/20260403120000_029_complete_bounded_matching_fanout.sql`
- `supabase/migrations/20260403133000_030_continuation_retry_reliability.sql`
- `supabase/migrations/20260403170000_031_face_level_photo_linking.sql`
- `supabase/migrations/20260409110000_045_asset_face_hidden_states.sql`
- `supabase/migrations/20260410113000_046_asset_consent_face_compare_scores.sql`
- `supabase/migrations/20260414110000_047_manual_asset_faces.sql`
- `supabase/migrations/20260414160000_048_asset_face_block_states.sql`
- `supabase/migrations/20260415110000_055_project_participants_mixed_consent_foundation.sql`
- `supabase/migrations/20260415160000_056_recurring_profile_headshots_matching_foundation.sql`
- `supabase/migrations/20260415170000_056_recurring_profile_headshot_queue_and_activation.sql`
- `src/lib/profiles/profile-headshot-service.ts`
- `src/lib/projects/project-participants-service.ts`
- `src/lib/matching/auto-match-jobs.ts`
- `src/lib/matching/auto-match-worker.ts`
- `src/lib/matching/auto-match-reconcile.ts`
- `src/lib/matching/auto-match-repair.ts`
- `src/lib/matching/auto-match-fanout-continuations.ts`
- `src/lib/matching/auto-match-trigger-conditions.ts`
- `src/lib/matching/face-materialization.ts`
- `src/lib/matching/materialized-face-compare.ts`
- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/asset-preview-linking.ts`
- `src/lib/matching/project-matching-progress.ts`
- `src/lib/assets/post-finalize-processing.ts`
- `src/components/projects/project-participants-panel.tsx`
- `src/components/profiles/profile-headshot-panel.tsx`
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

## Verified current matching/source/assignee boundary after Feature 056

### 1. Feature 056 added a reusable recurring-profile matching source, but not project matching integration

Live recurring-profile headshot storage now exists in:

- `recurring_profile_headshots`
- `recurring_profile_headshot_materializations`
- `recurring_profile_headshot_materialization_faces`

Key verified facts:

- One current uploaded headshot is enforced per profile through a partial unique index on `recurring_profile_headshots`.
- The current canonical compare face is stored on `recurring_profile_headshots.selection_face_id`.
- The selected face points to `recurring_profile_headshot_materialization_faces.id`.
- Matching authorization comes from active baseline `recurring_profile_consents.face_match_opt_in = true`.
- `deriveRecurringProfileMatchingReadiness(...)` returns:
  - `blocked_no_opt_in`
  - `missing_headshot`
  - `materializing`
  - `no_face_detected`
  - `needs_face_selection`
  - `unusable_headshot`
  - `ready`

`ready` currently means:

- active baseline recurring consent with `face_match_opt_in = true`
- current unsuperseded uploaded headshot exists
- current materialization exists and is compare-usable
- `selection_face_id` exists with `selection_status` of `auto_selected` or `manual_selected`

### 2. The stable recurring matching source identity is `profile_id`, not headshot-id-only state

Feature 056 introduced several identities:

- `profile_id`: stable reusable person identity
- `headshot_id`: current uploaded headshot row, replaceable over time
- `materialization_id`: current detector/materialization version for that headshot
- `selection_face_id`: current canonical compare face within the current materialization

For project matching integration, the best effective source identity is:

- stable identity: `profile_id`
- current compare instance: current `selection_face_id` on the current unsuperseded headshot and current materialization

Reasoning:

- `headshot_id` changes on replacement
- `materialization_id` is versioned implementation detail
- `selection_face_id` is the actual compare face but is only meaningful in the context of the current headshot
- `profile_id` is the durable reusable source the product cares about

### 3. Current project matching is still hard-wired to project consents and project consent headshots

Verified current source model:

- source enumeration is based on current project consent headshots from `list_current_project_consent_headshots(...)`
- worker intake and compare dedupe use `consentId`
- compare rows live in `asset_consent_face_compares`
- compare score rows live in `asset_consent_face_compare_scores`
- likely candidates live in `asset_consent_match_candidates`
- all three are foreign-keyed to `public.consents`

Current assumptions that are still hard-wired:

- one matching source is identified by `consent_id`
- the source headshot is the current project headshot for that consent
- headshot-side continuations use `source_consent_id`
- repair and reconcile only enumerate consent headshots
- `reconcile_project` already exists as a job type, but the current materialized worker path does not use it to enumerate recurring-profile sources
- preview candidate loaders only return active project `consents`

### 4. Exact-face assignee identity is still consent-backed and must remain so in 057

Current canonical ownership remains:

- face identity: `asset_face_materialization_faces.id`
- current assignee identity: `asset_face_consent_links.consent_id`

Current exact-face rules still hold:

- manual-over-auto precedence
- one current assignee per exact face
- one current face per consent per asset
- hidden faces exclude the face from auto reconciliation
- blocked faces exclude the face from assignment and auto reconciliation
- manual faces and zero-face fallbacks remain separate paths

Feature 055 matters here: project-specific recurring consent lives in `recurring_profile_consents` with `consent_kind = 'project'`, not in `public.consents`.

That means the repo already distinguishes:

- reusable recurring profile identity
- project-specific recurring consent context
- current consent-backed exact-face assignee identity

057 should preserve that split.

## Current schema/routes/components/helpers involved

### Recurring profile source and readiness

- `src/lib/profiles/profile-headshot-service.ts`
- `supabase/migrations/20260415160000_056_recurring_profile_headshots_matching_foundation.sql`
- `supabase/migrations/20260415170000_056_recurring_profile_headshot_queue_and_activation.sql`
- `src/components/profiles/profile-headshot-panel.tsx`

### Project participation and recurring project consent context

- `src/lib/projects/project-participants-service.ts`
- `src/components/projects/project-participants-panel.tsx`
- `supabase/migrations/20260415110000_055_project_participants_mixed_consent_foundation.sql`

### Current matching intake, fan-out, compare, repair, and progress

- `src/lib/matching/auto-match-jobs.ts`
- `src/lib/matching/auto-match-worker.ts`
- `src/lib/matching/auto-match-reconcile.ts`
- `src/lib/matching/auto-match-repair.ts`
- `src/lib/matching/auto-match-fanout-continuations.ts`
- `src/lib/matching/face-materialization.ts`
- `src/lib/matching/materialized-face-compare.ts`
- `src/lib/matching/project-matching-progress.ts`
- `src/lib/assets/post-finalize-processing.ts`
- `supabase/migrations/20260327150000_025_matching_pipeline_robustness.sql`
- `supabase/migrations/20260403120000_029_complete_bounded_matching_fanout.sql`
- `supabase/migrations/20260403133000_030_continuation_retry_reliability.sql`

### Current exact-face review and preview candidate surfaces

- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/asset-preview-linking.ts`
- `supabase/migrations/20260403170000_031_face_level_photo_linking.sql`
- `supabase/migrations/20260409110000_045_asset_face_hidden_states.sql`
- `supabase/migrations/20260414110000_047_manual_asset_faces.sql`
- `supabase/migrations/20260414160000_048_asset_face_block_states.sql`

## Options considered

### Option A: Widen current compare and candidate tables directly for profile-backed sources

Example direction:

- widen `asset_consent_face_compares`
- widen `asset_consent_face_compare_scores`
- widen `asset_consent_match_candidates`
- widen job payloads, dedupe keys, continuations, preview reads, and canonical apply

Pros:

- one explicit source model
- eventually avoids parallel read paths

Cons:

- too much widening at once
- immediately couples scoring-source identity to assignable identity questions
- pushes 057 into preview, canonical apply, and exact-face ownership redesign

Recommendation:

- reject for the first 057 slice

### Option B: Add a small project-local source resolver and parallel profile-backed evidence persistence

Example direction:

- derive project-local ready source rows from `project_profile_participants` plus current recurring profile readiness
- extend `reconcile_project`, repair, and fan-out enumeration to use that source resolver
- persist profile-backed compare or candidate evidence in additive parallel structures
- leave current consent compare tables and canonical face assignment unchanged

Pros:

- smallest additive integration path
- keeps scoring-source identity separate from current assignee identity
- lets ready recurring profiles participate in matching before they are directly assignable
- preserves current preview, exact-face, and consent-specific rules

Cons:

- adds a second evidence path for later preview reads
- still requires bounded worker and continuation generalization around source enumeration

Recommendation:

- recommend

### Option C: Create a project-local profile-consent-backed source identity first, then fit it into the current consent model

Example direction:

- first project recurring consent would become the matching source anchor
- recurring profile headshot would only score once there is project-specific recurring consent

Pros:

- closest to the current consent-centric assignee model
- simpler later assignment story

Cons:

- too restrictive for the actual product intent
- blocks useful scoring for ready participants who do not yet have project-specific recurring consent
- makes matching integration depend on request/send/review flows that are explicitly out of scope here

Recommendation:

- reject for 057

## Recommended bounded integration direction

### Core recommendation

Choose Option B:

- keep `profile_id` as the stable reusable scoring-source identity
- introduce a project-local source resolver that turns ready project participants into matchable source rows
- reuse project-scoped replay through `reconcile_project`
- add bounded parallel persistence for profile-backed compare or candidate evidence
- do not change exact-face ownership or current consent-backed assignee identity in 057

### Recommended source row shape

The plan phase should introduce one internal project-local source descriptor with enough data to validate "currentness":

- `sourceKind`: `consent_headshot` or `ready_recurring_profile`
- `projectId`
- `consentId` nullable
- `profileId` nullable
- `projectProfileParticipantId` nullable
- `currentHeadshotId`
- `currentMaterializationId`
- `currentSelectionFaceId`
- `sourceVersionStamp` or equivalent currentness inputs derived from current headshot/materialization state

This does not need to be a public API model in 057. It is the internal seam that lets reconcile, repair, and fan-out stay bounded while supporting both source types.

### Why this is the smallest coherent step

- It reuses Feature 056 readiness without redesigning it.
- It reuses Feature 055 project participation without treating participation as signed consent.
- It preserves the current worker and continuation architecture rather than replacing it.
- It allows scoring before direct assignability.
- It keeps manual-over-auto, hidden, blocked, manual-face, and zero-face behavior unchanged because canonical apply still remains consent-backed.

## Recommended trigger and enqueue seam

### Use `reconcile_project` as the project-scoped replay hook

This is the best existing seam when:

- a ready recurring profile is added to a project
- a project participant becomes ready after upload, materialization, or face selection
- a previously ready source becomes not-ready after replacement or opt-in revocation

Why `reconcile_project` is the right seam:

- the change affects project-local source enumeration, not one specific asset
- one profile can affect many projects
- the queue already has project-scoped replay semantics, dedupe, leasing, reclaim, and retry behavior
- it avoids pretending a recurring profile source is expressible as `consent_headshot_ready`
- it gives 057 a way to extend an existing job type rather than inventing a new replay model

### Recommended trigger producers

Project replay should be enqueued when any of these server-side events occur:

- `addProjectProfileParticipant(...)` creates or replays a participant row and the profile is already `ready`
- recurring profile headshot activation or canonical face selection changes readiness for a profile that participates in one or more projects
- baseline recurring consent opt-in flips readiness for a participating profile

Recommended reliability posture:

- duplicate triggers are acceptable if dedupe stays project-scoped
- replay should always re-resolve current sources rather than trust stale payload state
- if a profile becomes not-ready while work is already in flight, later compare readers should ignore stale profile-backed evidence unless it still matches current source state

### Do not add a brand-new orchestration model unless code forces it

The live worker already has the right robustness properties. 057 should prefer:

- extending project replay source enumeration
- extending bounded fan-out source descriptors

over:

- a second independent matching queue
- a second repair pipeline
- direct synchronous project-wide replay

## Recommended compare and candidate persistence direction

### Current persistence is too consent-specific to reuse directly

Today the following are all consent-FK'd and consent-shaped:

- `asset_consent_face_compares`
- `asset_consent_face_compare_scores`
- `asset_consent_match_candidates`

They are used by:

- worker compare persistence
- likely candidate upserts
- preview face candidate trays
- canonical auto-link reconciliation

Trying to store profile-backed sources there in 057 would immediately force assignee-identity widening.

### Recommended first integration step: additive parallel profile-backed evidence

For 057, keep the current consent tables unchanged and add a parallel bounded structure for profile-backed evidence.

The exact table names are a plan-phase decision, but the persistence should support:

- project id
- asset id
- asset materialization id
- asset face id or score granularity needed for later preview reads
- profile id
- project participant id
- current recurring headshot/materialization identity
- current selected face id
- compare version
- score and evidence timestamps

Recommended shape preference:

- parallel compare or score tables for profile-backed evidence
- optional thin project-local source table only if it materially simplifies replay/currentness validation

Not recommended for 057:

- polymorphic widening of the existing consent tables
- persisting profile-backed rows into `asset_consent_match_candidates`
- auto-link writes from profile-backed evidence

### Why parallel persistence is the safest first step

- it keeps scoring-source identity independent from assignable identity
- it lets later preview reads union evidence without forcing current link writes
- it allows stale evidence to be filtered by current profile headshot state the same way current consent preview reads filter to current headshot materializations

## Recommended relationship to exact-face assignee identity

### Scoring source identity and assignable project assignee identity should remain separate

Verified current rule:

- exact-face current ownership is still a project consent assignment problem

Recommended 057 behavior:

- yes, recurring profile sources can participate in scoring before they are directly assignable
- no, they should not produce direct `asset_face_consent_links` writes in this feature

### What makes a later profile-backed candidate assignable

A later follow-on feature should only make a profile-backed candidate directly assignable once there is a valid project-specific recurring consent context and a deliberate bridge into the exact-face assignment model.

The most likely future requirement is:

- active project-specific recurring consent for that profile in the current project
- a project-local assignee projection that exact-face write paths can validate

057 should not decide that bridge yet. It should only preserve room for it.

## Recommended future fit with asset preview and candidate tray UX

Current preview flows are consent-centric:

- preview candidate trays read consent compare scores and likely candidates
- lightbox detail panels assume `consentId`
- exact-face change-link flows post to consent-based link routes

Profile-backed evidence can still fit later if it is treated as additive evidence, not as immediate ownership.

Recommended future UX posture:

- preview face candidate trays can later show profile-backed evidence alongside current consent-backed candidates
- lightbox detail panels can show that a face resembles a ready recurring profile even when no direct project assignment is yet available
- exact-face change-link flows can later gate direct assignment behind project-specific recurring consent context

Important coexistence rules:

- manual exact links still win
- hidden and blocked faces still suppress face-level assignment behavior
- manual faces remain non-auto
- zero-face fallback remains separate from exact-face candidates

That means 057 can safely add backend evidence first and defer UI changes.

## Recommended repair, reconcile, and progress evolution

### Reconcile

Extend `reconcile_project` source enumeration later to include:

- current project consent headshots
- ready recurring profile participant sources

The project replay should remain current-source based and idempotent.

### Repair

Project repair should later enumerate ready recurring project participants in addition to current consent headshots.

Smallest bounded behavior:

- reuse project repair to re-enqueue project-side compare work for ready recurring sources
- rely on Feature 056 headshot-specific repair for missing or stale recurring headshot materialization facts

This keeps responsibilities separated:

- profile headshot repair restores the source
- project repair restores project compare coverage

### Progress

Do not change the user-facing meaning of progress in 057.

Recommended first-step behavior:

- keep `totalImages` and `processedImages` photo-centric
- extend `is_matching_in_progress` and degraded-state detection later to account for any new profile-backed fan-out or compare work introduced by 057

Reasoning:

- users already read the percentage as photo processing progress
- counting sources in the denominator would change semantics unnecessarily
- project replay still needs in-progress and degraded visibility if profile-backed work is active

## Security and reliability considerations

- tenant scope must remain server-derived on every participant lookup, readiness lookup, replay enqueue, and compare read
- never accept `tenant_id` from the client
- recurring profile readiness must continue to come from server-side baseline consent plus current headshot state
- duplicate readiness and participation triggers must be safe through project-scoped replay dedupe and current-source revalidation
- currentness checks are required so headshot replacement or opt-in revocation does not leave old profile-backed evidence treated as live
- retries and replays must be idempotent at the persistence boundary
- 057 must not bypass the current consent-gated assignment rule from Feature 048
- exact-face review auditability must remain on the existing consent-backed link tables

## Edge cases

- Profile becomes ready while project replay is already in flight:
  - duplicate replay is acceptable if source resolution and compare dedupe are current-state aware.
- Profile becomes not-ready while compare work is already in flight:
  - stale profile-backed evidence must be ignored unless it still matches the current ready source inputs.
- Duplicate participant add and duplicate readiness events:
  - should converge through unique participant rows plus project replay dedupe.
- Repeated repair or reconcile on the same project:
  - should remain safe because source enumeration re-derives current inputs.
- Ready profile source exists but no project-specific recurring consent exists yet:
  - scoring can still happen, canonical assignment cannot.
- Manual exact-face assignment already exists for a face:
  - profile-backed evidence may later be visible, but it must not displace the manual winner.
- Hidden or blocked face later receives profile-backed evidence:
  - face-level hidden and blocked rules still win over candidate visibility and assignment.
- Profile headshot replacement resets selection or materialization:
  - project replay should treat the old source as stale and the new source as current.

## Explicitly deferred work

- direct recurring-profile assignee identity in `asset_face_consent_links`
- widening exact-face ownership beyond the current consent-backed model
- full lightbox and preview candidate tray redesign
- auto-request generation from profile matches
- one-off and recurring identity merge
- batch participant send workflows
- broader consent-table redesign
- multi-headshot recurring profile redesign
- CompreFace provider redesign
- changing the user-facing meaning of project progress percentages

## Smallest usable 057 slice

The smallest coherent implementation slice after this research is:

1. enqueue project-scoped `reconcile_project` when ready recurring profile participation or readiness changes
2. extend project matching source enumeration to include ready recurring profile participant sources through a project-local source resolver
3. persist profile-backed compare or candidate evidence in bounded additive parallel structures
4. keep exact-face canonical apply, current candidate trays, and consent-backed assignment unchanged

This produces real backend integration value without forcing a preview redesign or an assignee-identity redesign.

## Open decisions for the plan phase

- What is the smallest practical internal source descriptor needed to generalize fan-out and dedupe without over-generalizing the whole pipeline?
- Should 057 persist profile-backed evidence at compare-row granularity, score-row granularity, or candidate-row granularity first?
- Does the continuation schema need a small generic source-key widening now, or is a profile-specific parallel continuation path smaller in practice?
- Is a thin project-local source table worth adding for currentness validation, or should source rows stay derived-only?
- How should later preview reads label profile-backed evidence when the face is not yet directly assignable?
- What exact future bridge should convert active project-specific recurring consent into an assignable exact-face identity, without weakening existing auditability?

## Research conclusion

Feature 056 created a real reusable matching source on recurring profiles, but the live project matcher is still entirely consent-headshot centric. The smallest safe Feature 057 is not to widen current consent compare tables or exact-face ownership. It is to add a project-local ready-source resolver, trigger project-scoped replay through `reconcile_project` when recurring readiness or participation changes, and persist profile-backed scoring evidence in additive parallel structures while keeping current consent-backed assignment and review flows unchanged.
