# Feature 031 Research: One Consent Per Face Precedence Rules

## Goal

Research how the current matcher and canonical link model behave, and what would be required to enforce one current consent assignment per detected photo face, with manual decisions taking precedence over auto decisions.

This research is code-first. Existing RPI docs were treated as intent only.

## Inputs reviewed

Required docs:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- prior matching RPI docs:
  - `docs/rpi/009-matching-foundation/research.md`
  - `docs/rpi/010-auto-face-matching/research.md`
  - `docs/rpi/011-real-face-matcher/research.md`
  - `docs/rpi/012-manual-review-likely-matches/research.md`
  - `docs/rpi/015-headshot-replace-resets-suppressions/research.md`
  - `docs/rpi/017-face-result-geometry-and-embeddings/research.md`
  - `docs/rpi/019-face-materialization-deduped-embedding-pipeline/research.md`
  - `docs/rpi/025-matching-queue-robustness/research.md`
  - `docs/rpi/029-complete-bounded-matching-fanout/research.md`
  - `docs/rpi/030-continuation-retry-reliability/research.md`

Schema and migrations verified directly:

- `supabase/migrations/20260305120000_004_assets_schema.sql`
- `supabase/migrations/20260306130000_010_auto_match_backbone_schema.sql`
- `supabase/migrations/20260306132000_011_auto_match_manual_unlink_suppressions.sql`
- `supabase/migrations/20260307120000_012_auto_match_likely_candidates.sql`
- `supabase/migrations/20260307130000_013_auto_match_results_observability.sql`
- `supabase/migrations/20260313162000_017_match_result_faces.sql`
- `supabase/migrations/20260320140000_019_face_materialization_pipeline.sql`
- `supabase/migrations/20260327150000_025_matching_pipeline_robustness.sql`
- `supabase/migrations/20260403120000_029_complete_bounded_matching_fanout.sql`
- `supabase/migrations/20260403133000_030_continuation_retry_reliability.sql`

Primary code verified directly:

- `src/lib/matching/consent-photo-matching.ts`
- `src/lib/matching/auto-match-worker.ts`
- `src/lib/matching/auto-match-jobs.ts`
- `src/lib/matching/auto-match-fanout-continuations.ts`
- `src/lib/matching/face-materialization.ts`
- `src/lib/matching/materialized-face-compare.ts`
- `src/lib/matching/auto-match-reconcile.ts`
- `src/lib/matching/auto-match-repair.ts`
- `src/lib/matching/project-matching-progress.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/links/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/matchable/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts`
- `src/app/i/[token]/consent/route.ts`
- `src/components/projects/consent-asset-matching-panel.tsx`

Relevant tests verified directly:

- `tests/feature-010-auto-match-backbone.test.ts`
- `tests/feature-012-manual-review-likely-matches.test.ts`
- `tests/feature-019-face-materialization-pipeline.test.ts`
- `tests/feature-021-project-matching-progress.test.ts`
- `tests/feature-029-complete-bounded-matching-fanout.test.ts`

## Current verified behavior

### Canonical model is still asset-level, not face-level

- The canonical active link table is still `public.asset_consent_links`.
- Its primary key is still `(asset_id, consent_id)`.
- It stores both:
  - headshot-to-consent links
  - photo-to-consent links
- Auto/manual provenance is stored on the same row via `link_source in ('manual', 'auto')`.

Verified in:

- `supabase/migrations/20260305120000_004_assets_schema.sql`
- `supabase/migrations/20260306130000_010_auto_match_backbone_schema.sql`

Answer 1: the canonical current link model is still asset-level.

### Face-level identity exists only in materialization/compare state

The closest current stable identifier for a detected face instance is:

- `asset_face_materialization_faces.id`

Supporting facts:

- `asset_face_materialization_faces` stores one row per detected face.
- It has unique `(materialization_id, face_rank)`.
- `asset_consent_face_compares.winning_asset_face_id` references that face row.

Important limit:

- this face identity is only stable within one materialization version
- canonical link/suppression/candidate tables do not reference it
- manual API/UI never accept it

Answer 2: the nearest current face-instance identifier is `asset_face_materialization_faces.id`, but it is not the canonical link key and is version-bound to a materialization.

### Compare persistence already knows the winning face, but canonical apply ignores it

In materialized mode:

- `ensureMaterializedFaceCompare(...)` compares one headshot face against all detected target faces in one photo
- it picks one winning target face
- it persists:
  - `winning_asset_face_id`
  - `winning_asset_face_rank`
  - `winning_similarity`

But canonical apply then collapses back to pairwise `(asset_id, consent_id)` writes in `applyAutoMatches(...)`.

Verified in:

- `src/lib/matching/materialized-face-compare.ts`
- `src/lib/matching/auto-match-worker.ts`

Implication:

- the matcher can tell which face won for a pair
- the canonical table cannot enforce one-consent-per-face because it throws that identity away

### Manual links and auto links share the same pair row

Manual links:

- `linkPhotosToConsent(...)` upserts into `asset_consent_links`
- writes `link_source = 'manual'`
- clears exact-pair suppressions in `asset_consent_link_suppressions`

Manual unlinks:

- `unlinkPhotosFromConsent(...)` deletes from `asset_consent_links`
- upserts exact-pair suppression rows into `asset_consent_link_suppressions`
- suppression key is `(asset_id, consent_id)`

Auto links:

- `applyAutoMatches(...)` upserts into `asset_consent_links`
- writes `link_source = 'auto'`, confidence, timestamps, matcher version

Auto/manual precedence that does exist today:

- DB trigger `preserve_manual_asset_consent_link_provenance()` prevents `manual -> auto` downgrade on the same `(asset_id, consent_id)` row
- worker-side apply also skips exact pairs already marked manual

Answer 4: manual and auto are represented as the same canonical pair row, distinguished only by `link_source`; manual unlink is represented separately as an exact-pair suppression row.

### Auto-vs-auto competition is only resolved per pair, not per face

Current worker behavior:

- scores are normalized per exact pair key `asset_id:consent_id`
- above-threshold auto rows are upserted independently per pair
- no schema constraint or apply logic checks `winning_asset_face_id`

Verified consequence:

- two different consents can compare to the same photo
- both compares can point at the same `winning_asset_face_id`
- both canonical auto links can still exist

This is directly verified by `feature-019-face-materialization-pipeline.test.ts`:

- test name: `materialized_apply stores enough face identity to allow later face exclusivity without enforcing it yet`
- both compares share the same `winning_asset_face_id`
- both `asset_consent_links` rows are still `auto`

Answer 5: when two auto candidates compete for the same face, the system currently allows both canonical auto links to exist as long as they are different `(asset_id, consent_id)` pairs.

### Manual-vs-auto conflict is only protected for the same pair

Verified behavior:

- if the exact pair `(asset_id, consent_id)` is already manual, auto will not overwrite it
- this is enforced in both the DB trigger and worker apply path

Inferred from code, because there is no dedicated same-face-different-consent test:

- if a manual link for consent A and an auto match for consent B point to the same `winning_asset_face_id`, nothing in schema or apply logic prevents both
- current conflict detection only keys on `(asset_id, consent_id)`, not face id

Answer 6: same-pair manual beats auto; same-face different-consent conflict is not prevented today.

### Headshot replacement clears suppressions and reruns matching, but does not proactively reset canonical auto links

Verified route behavior in `src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts`:

- remove existing headshot link rows for the consent
- insert replacement headshot link as `manual`
- clear all photo suppressions for that consent via `clearConsentPhotoSuppressions(...)`
- enqueue `consent_headshot_ready`

Verified continuation behavior in `feature-029-complete-bounded-matching-fanout.test.ts`:

- old headshot continuation becomes `superseded`
- replacement headshot creates a new valid backfill

What does not happen at replacement time:

- existing auto photo links for that consent are not deleted immediately
- they remain until current compare work reruns and `applyAutoMatches(...)` deletes stale auto exact pairs below threshold

Answer 7: headshot replacement resets suppressions and reruns matching; old continuations are superseded; stale auto photo links are not proactively cleared at replacement time.

### Suppressions are pairwise, not face-specific

Current suppression semantics:

- table: `asset_consent_link_suppressions`
- key: `(asset_id, consent_id)`
- reason: only `'manual_unlink'`

Implications:

- suppression blocks auto recreation of one photo/consent pair
- suppression does not identify which face in a group photo was rejected
- suppression does not block a different consent from taking the same face

Answer 8: suppressions are currently asset/consent pair suppressions, not face-level suppressions.

### Group photo manual linking is not face-specific in UI or API

Verified UI/API behavior:

- consent matching UI selects `assetIds: string[]`
- write route accepts only `{ assetIds: string[] }`
- no API accepts face id, face rank, face box, or winning face id
- linked-photo UI shows whole-photo thumbnails only

Verified in:

- `src/components/projects/consent-asset-matching-panel.tsx`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/links/route.ts`
- `src/lib/matching/consent-photo-matching.ts`

Answer 9: yes, robust group-photo handling requires face-specific manual linking in the UI/API; current UI/API are asset-only.

### Face-level manual linking requires face-aware materialization and fallback behavior

The current manual linking flow is asset-only:

- UI selects `assetIds[]`
- API accepts only `{ assetIds: string[] }`
- the server does not require a face identifier
- no current manual route ensures the target photo has a current face materialization before linking

For the desired invariant of **one current consent assignment per detected face**, this is not sufficient.

Why this matters:

- if a photo contains multiple detected faces, a manual link to the whole asset is ambiguous
- the system cannot know which face instance the user intended to assign
- the system therefore cannot reliably:
  - replace the correct competing face assignment
  - create the correct face-level suppression on manual unlink
  - preserve other valid face assignments in the same group photo

Implication:

- when detected faces exist, robust manual linking must become **face-specific**, not asset-only

Verified current gap:

- there is no current server/API contract that:
  - checks whether the photo has a current materialization before manual linking
  - materializes the photo on demand for manual linking
  - returns detected faces for the user to choose from
  - stores which face instance a manual link refers to

Recommended behavior for Plan phase:

1. When a user starts a manual link to a photo, the server should first resolve whether the photo has a current face materialization.
2. If it does not, the system should materialize the photo first using the existing face-materialization pipeline rather than creating a blind asset-level link.
3. After materialization:
  - if zero faces are detected:
    - allow an explicit asset-level manual fallback link
    - this must remain distinct from a face-level canonical link because no face instance exists
  - if exactly one face is detected:
    - allow the system to default the manual selection to that one face
  - if multiple faces are detected:
    - require the user to choose the specific face instance in the UI before the manual link is written
4. Manual unlink should follow the same unit:
  - unlink a specific face assignment when a face-level link exists
  - only use asset-level unlink semantics for the explicit zero-face fallback case

Architectural implication:

- Feature 031 is not only a canonical auto-apply change
- it also requires a face-aware manual linking flow for photos with detected faces
- this belongs in the same feature scope because otherwise manual paths would still violate the new invariant

Bounded repo-fit direction:

- keep face detection/materialization server-side
- reuse existing materialization tables and pipeline where possible
- add face-aware manual API/UI on top of current materialized face evidence
- allow asset-level manual fallback only when there is no current detected face for the target photo


### Repair/replay preserves current pairwise invariants, not the proposed face-level invariant

Verified current robustness features:

- job requeue/repair exists for intake, materialize, and compare jobs
- fan-out continuations page through large projects
- continuations can be repaired/requeued
- current pair replay is gated by:
  - current materialization check
  - current headshot check
  - consent eligibility check

Verified in:

- `src/lib/matching/auto-match-jobs.ts`
- `src/lib/matching/auto-match-fanout-continuations.ts`
- `src/lib/matching/auto-match-repair.ts`
- `src/lib/matching/auto-match-worker.ts`
- `feature-010`
- `feature-019`
- `feature-029`

But:

- replay still writes canonical state by `(asset_id, consent_id)`
- nothing in repair/replay prevents multiple current links to the same winning face

Answer 10: robust enforcement needs schema/API changes. Current repair/replay only preserves exact-pair invariants.

### Revocation is only partially enforced today

Verified:

- auto apply is blocked for revoked consents via `loadConsentEligibility(...)` / current consent eligibility checks
- `feature-029` verifies already-enqueued compare work still persists compare rows but skips canonical apply after revocation

Gap:

- `linkPhotosToConsent(...)` and the manual link route only check that the consent exists in the project
- they do not block linking a revoked consent manually

This matters because face-level "current" assignment semantics will need a clear rule for revoked consents.

## Current gaps vs desired behavior

### Gap 1: one-consent-per-face cannot be enforced canonically today

Reason:

- canonical rows are keyed by `(asset_id, consent_id)`
- no canonical table is keyed by detected face instance
- no unique constraint can say "one current consent per winning face"

Answer 3: not robustly. Auto-only heuristics could prefer one compare per winning face, but the current schema cannot represent or enforce the invariant across manual links, suppressions, UI writes, and replay.

### Gap 2: same consent cannot be linked to multiple different faces in one asset

Current limitation:

- canonical PK `(asset_id, consent_id)` allows only one row
- `asset_consent_face_compares` stores only one `winning_asset_face_id` per versioned pair
- materialized compare intentionally picks one winning face

Implication:

- if the same person appears twice in one photo, current canonical state cannot represent both face instances

### Gap 3: manual corrections are too coarse for group photos

Current manual unlink means:

- delete one `(asset_id, consent_id)` row
- add one `(asset_id, consent_id)` suppression

For group photos, that is too blunt:

- it does not tell the system which face was wrong
- it cannot reject one face while keeping another face for the same consent

### Gap 4: headshot replacement reset semantics are incomplete for the desired invariant

Current behavior only clears suppressions and reruns.

Desired rule 5 requires:

- reset auto-derived links for that consent
- rerun matching from the replacement headshot

Today the first half is only eventual and pairwise, not immediate and canonical at face level.

### Gap 5: `asset_consent_links` is overloaded

Today one table mixes:

- headshot-to-consent links
- photo-to-consent canonical links

For face-level precedence rules, photo links and headshot links want different semantics:

- headshot link is asset-level and singular
- photo link wants to be face-level and precedence-aware

Keeping both in one table makes future constraints harder.

## Domain invariants to enforce

Recommended invariants for the Plan phase:

1. A detected photo face instance has at most one current consent assignment.
2. Manual face assignment is authoritative over auto face assignment.
3. Auto must never overwrite a manual current assignment for that same face instance.
4. Auto may replace auto only for the same face instance, and only when the new auto decision is stronger according to explicit precedence rules.
5. Manual unlink creates a face-specific suppression for that exact face/consent combination.
6. Headshot replacement clears face-specific suppressions for that consent, clears or invalidates that consent's auto-derived current face links, and reruns matching.
7. Repair/replay must converge to the same current face-level state as a clean run.
8. Revoked consents must not gain new current face assignments.
9. Group photo manual review must operate on face instances, not whole-photo assets.

## Scenario-by-scenario expected behavior

### Auto vs auto conflict on the same face

Current verified behavior:

- two compares can point at the same `winning_asset_face_id`
- both canonical auto links can exist

Desired behavior:

- one current auto face link survives
- highest-confidence auto wins for that face
- lower-confidence auto becomes non-current or is removed
- if the winner later drops below threshold and there is no manual face link, the face becomes unassigned unless another eligible auto candidate wins

### Manual vs auto conflict on the same face

Current behavior:

- same exact pair: manual wins
- same face, different consent: conflict is not detected

Desired behavior:

- manual face link becomes the only current assignment for that face
- any competing auto current assignment for that face is removed or demoted
- future auto reruns must not replace that manual face link

### Manual vs manual conflict on the same face

Current behavior:

- not representable explicitly, because manual writes are asset-level only
- multiple asset-level rows can coexist on the same photo

Recommended desired behavior:

- a second explicit manual assignment on the same face should replace the previous current face assignment after an intentional user action
- Plan phase should decide whether that replacement is:
  - explicit confirmation in the UI
  - or a reject-with-conflict response until the user clears the old face link first

### Manual unlink of the current face link

Current behavior:

- delete pair row
- add pair suppression `(asset_id, consent_id)`

Desired behavior:

- remove the current face-level canonical link
- add face-level suppression for `(photo_face_id, consent_id)`
- leave the face unassigned
- do not suppress other faces in the same asset

### Headshot replacement

Current verified behavior:

- replacement headshot becomes current
- old continuation supersedes
- suppressions for the consent are cleared
- rerun is enqueued

Desired behavior:

- keep manual face links
- clear that consent's auto-derived current face links
- clear that consent's face suppressions
- rerun against all current photos
- converge to new face-level current assignments

### Revoked consent

Current verified behavior:

- auto apply stops
- historical compare rows can still exist
- current manual link API still allows linking revoked consents

Recommended desired behavior:

- no new current face links for revoked consents
- existing historical audit remains intact
- Plan phase must decide whether previously current face links remain visible as current or become non-current once revoked
- given `CONTEXT.md` says revocation stops future processing only, the repo-consistent direction is:
  - preserve history
  - block new assignments
  - ensure downstream "current usable consent" views exclude revoked rows

### Same consent matching multiple different faces in one asset

Current behavior:

- impossible to represent canonically
- current compare model stores only one winning face per `(asset, consent)` pair

Recommended desired behavior:

- if product wants to support repeated appearances of the same person in one photo, canonical face links must allow multiple face rows for one consent in one asset
- that implies canonical keying by face instance, not by `(asset_id, consent_id)`
- current compare persistence would also need to retain more than one winning face for a consent/photo pair

This is a Plan-phase decision point:

- support it explicitly
- or document it as unsupported for now

### Group photo with multiple different people

Current behavior:

- superficially works when different consents match different faces
- but canonical state is still just multiple asset-level rows on the same photo
- manual correction cannot target specific faces

Desired behavior:

- each detected face in the group photo has its own current assignment state
- manual review UI shows face boxes/crops and current assignee per face

### Repair/replay after face-level rules exist

Current pairwise robustness is strong, but it is the wrong unit.

Desired behavior:

- repair/replay should recompute current face assignments from current face-level compare state
- precedence must be deterministic:
  - manual beats auto
  - auto beats auto only by explicit ranking rule
- replay must not recreate stale lower-priority assignments

Repo-specific opportunity:

- `asset_consent_face_compares` already persists `winning_asset_face_id` and `winning_similarity`
- that table can likely seed face-level replay without rerunning the matcher for the same current materializations

Repo-specific limit:

- it only stores one winner per `(asset, consent)` versioned pair
- it is not enough if the product wants one consent to occupy multiple faces in the same asset

## Architectural implications

### 1. A dedicated canonical photo face-link model is needed

Smallest repo-fit direction:

- keep `asset_consent_links` for headshot-to-consent linkage
- introduce a dedicated canonical photo face-link table for photo faces

Reason:

- headshot linkage is still asset-level
- photo matching now wants face-level precedence and suppressions

### 2. Face-level suppressions need their own table

Current pair suppression table is too coarse.

Needed:

- face-level suppression keyed by face instance plus consent
- probably equivalent metadata to the current table: tenant/project scope, reason, created_by, timestamps

### 3. Manual API/UI must become face-aware

Current writes are `assetIds[]`.

Needed:

- manual link/unlink requests must carry a face identifier
- group photo UI needs face overlays or per-face crops
- consent-centric UI alone is insufficient; an asset-centric face review surface will likely be needed

### 4. Auto apply should resolve conflicts by face id, not by asset/consent pair

The current `applyAutoMatches(...)` unit is the wrong one for the new invariant.

Needed apply rules:

- read current face-level canonical rows
- read face-level suppressions
- resolve per-face precedence
- then write one current row per face

### 5. Current materialized face rows are the nearest migration anchor

Best current repo anchor:

- `asset_face_materialization_faces.id`

Why:

- it already exists
- it is referenced by `asset_consent_face_compares.winning_asset_face_id`
- repair/replay can already resolve it from current materializations

Caveat:

- it is tied to a materialization version
- if the project needs manual face links to survive future materializer-version changes without migration, a more durable `asset_face_instances` abstraction may be needed later

### 6. Current compare persistence is enough for one winner per consent/photo pair, not for repeated faces of the same person

If Plan phase wants to support:

- same consent on two different faces in one asset

then current compare persistence is insufficient and needs extension beyond single `winning_asset_face_id`.

## Recommended direction for Plan phase

Recommended bounded direction:

1. Introduce a dedicated canonical photo-face link table keyed by photo face instance, not by `(asset_id, consent_id)`.
2. Keep headshot links separate from photo-face canonical links; do not extend `asset_consent_links` further for face-level current state.
3. Introduce face-level suppressions keyed by face instance plus consent.
4. Change auto canonical apply to resolve conflicts per face:
   - manual wins over auto
   - auto never overwrites manual
   - higher-confidence auto may replace lower-confidence auto for the same face
5. Add face-specific manual link/unlink APIs and a group-photo face review UI.
6. On headshot replacement:
   - clear that consent's face suppressions
   - clear or invalidate that consent's auto-derived current face links
   - rerun matching across all current photos
7. Use `asset_consent_face_compares` plus current materializations as the replay/repair source for the new invariant.
8. Decide explicitly whether Feature 031 must support the same consent on multiple different faces in one asset.
9. Add face-aware manual linking behavior:
    - materialize on demand when needed
    - asset-level fallback only when zero faces are detected
    - auto-select when exactly one face exists
    - explicit face selection UI when multiple faces exist



Most important conclusion:

- the repo already has enough face-level compare evidence to start enforcing one-consent-per-face for auto decisions
- but it does not have a face-level canonical model, face-level suppressions, or face-specific manual UI/API
- so the invariant cannot be made robustly correct without schema and API changes
