# Feature 031 Plan: One Consent Per Face Precedence Rules

## Inputs And Ground Truth

This plan is based on:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- verified research in `docs/rpi/031-one-consent-per-face-precedence-rules/research.md`
- prior matching RPI docs that still matter for this feature:
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

Repository code and current schema are the source of truth. This plan is grounded in the verified current implementation in:

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
- `tests/feature-010-auto-match-backbone.test.ts`
- `tests/feature-012-manual-review-likely-matches.test.ts`
- `tests/feature-019-face-materialization-pipeline.test.ts`
- `tests/feature-021-project-matching-progress.test.ts`
- `tests/feature-029-complete-bounded-matching-fanout.test.ts`

## Verified Current State

The research result is now the plan boundary:

- `asset_consent_links` is still the canonical current-link table and is still keyed by `(asset_id, consent_id)`.
- It currently mixes headshot-to-consent linkage and photo-to-consent linkage.
- Manual and auto photo links are differentiated only by `link_source`.
- Manual unlink suppressions are still pairwise in `asset_consent_link_suppressions`.
- The materialized pipeline already persists the winning photo face in `asset_consent_face_compares.winning_asset_face_id`.
- `tests/feature-019-face-materialization-pipeline.test.ts` explicitly verifies that two different consents can currently auto-link to the same detected face.
- Manual photo linking is still whole-photo only:
  - API body is `assetIds[]`
  - UI state is `selectedAssetIds`
  - no face-specific request shape exists
- Headshot replacement currently clears consent-wide photo suppressions and reruns matching, but it does not immediately clear existing auto photo links for that consent.
- Repair and replay are strong at the materialization/compare level, but they still rebuild pairwise `(asset_id, consent_id)` state, not face-level canonical ownership.

Old behavior:

- one photo asset can have multiple current consent links with no face exclusivity
- manual precedence is only enforced for the exact same `(asset_id, consent_id)` row
- group-photo manual review cannot target a specific face

New behavior required by this feature:

- a detected photo face becomes the canonical ownership unit
- manual face decisions outrank auto face decisions
- all current-state write paths converge on the same face-level model
- zero-face fallback remains possible, but it is modeled separately from face ownership

## Options Considered

### Option A: Keep extending `asset_consent_links`

Pros:

- smallest apparent schema diff
- fewer immediate reader migrations

Cons:

- keeps mixing headshot links and photo matching state
- still leaves current state keyed primarily by asset/consent, not by face
- makes one-consent-per-face enforcement awkward and mostly procedural
- keeps zero-face fallback and face ownership tangled together
- makes replay and repair logic harder to reason about because the canonical unit stays overloaded

### Option B: Introduce a durable cross-materialization `asset_face_instances` abstraction now

Pros:

- face identity could survive future materializer-version changes more cleanly
- manual links would not be tied directly to a current materialized-face row

Cons:

- significantly larger schema and migration surface
- requires a new matching/remapping layer the repo does not currently have
- adds more risk than Feature 031 needs to solve the verified current bug
- would slow delivery of the actual canonical-precedence fix

### Option C: Add a dedicated current photo-face link model keyed to current materialized face rows, and keep zero-face fallback separate

Pros:

- aligns canonical ownership with the face unit the matcher already persists today
- keeps headshot linkage separate from photo-face state
- keeps materialization-first matching intact
- gives repair/replay a clear and deterministic current-state target
- is small enough to implement and review in this repo

Cons:

- current face identity remains tied to `asset_face_materialization_faces.id`
- cross-materializer remapping of manual face links is deferred
- zero-face fallback needs a separate small model

## Recommendation

Choose **Option C**.

The chosen architecture is:

- keep `asset_consent_links` as the headshot-to-consent link table going forward
- add a dedicated canonical photo-face link table for detected photo faces
- add a dedicated face-level suppression table
- add a separate explicit zero-face manual fallback model for photos with no detected faces
- keep materialization server-side and staged for manual linking when faces are not ready yet
- keep current face identity anchored to `asset_face_materialization_faces.id` for Feature 031
- explicitly defer support for linking the same consent to multiple different faces in one asset

This is preferred over Option A because it stops overloading `asset_consent_links`.

It is preferred over Option B because the repo already has `winning_asset_face_id`, current materialization checks, and deterministic compare replay. Feature 031 can enforce correct face precedence now without inventing a new long-lived face-instance layer.


Feature 031 does not change the compare unit: matching still evaluates consent/headshot against a photo asset and persists the winning face in compare state. What changes is the canonical current-state unit: photo linking is now applied at the winning face level rather than the asset/consent pair level.

## Chosen Architecture

### 1. Canonical model for photo links

Feature 031 will introduce a dedicated canonical current-state table for detected photo-face links, for example:

- `public.asset_face_consent_links`

This table becomes the source of truth for current detected-face ownership.

`asset_consent_links` stops being the canonical current table for photos. Going forward it remains only for headshot-to-consent linkage.

This answers question 1 and question 2:

- canonical photo links move to a dedicated photo-face table
- headshot links stay in `asset_consent_links`

### 2. Headshot-to-consent linkage stays separate

`asset_consent_links` remains the headshot-to-consent link table.

Feature 031 should stop creating or updating photo rows in `asset_consent_links`.

Code paths to update:

- `src/lib/matching/consent-photo-matching.ts`
- `src/lib/matching/auto-match-worker.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/links/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts`
- `src/app/i/[token]/consent/route.ts`

Headshot replacement remains asset-level and continues to use `asset_consent_links`.

### 3. Face identifier choice

Feature 031 will use the current materialized face row id as the canonical face identifier for now:

- `asset_face_materialization_faces.id`

Every current face link must also store its owning current materialization id:

- `asset_materialization_id`

Reason:

- the repo already persists and compares against this id
- `asset_consent_face_compares.winning_asset_face_id` already points at it
- repair and replay already reason over current materializations

Deferred:

- a more durable cross-materialization face-instance abstraction is not part of Feature 031
- if a future materializer-version change produces a new current materialization for a photo, face links tied to the old materialization become stale and must be rebuilt or manually re-reviewed

This answers question 3.

### 4. Explicit limitation for repeated appearances of the same consent in one asset

Feature 031 will choose **B. Defer that case explicitly**.

Feature 031 will **not** support the same consent on multiple different faces in one asset yet.

Reason:

- current compare persistence stores only one `winning_asset_face_id` per `(asset_id, consent_id, materialization versions, compare_version)`
- current likely-review and compare pipeline do not model multiple winning faces for one consent/photo pair
- trying to support repeated-person-in-one-photo now would expand this feature beyond the one-consent-per-face invariant

Implementation consequence:

- add a unique constraint on the new current photo-face link table for `(tenant_id, project_id, asset_id, consent_id)`
- manual and auto paths both enforce at most one current face assignment for a given consent within a given photo

This answers question 4.

### 5. Deterministic auto-apply rules

Feature 031 will move auto current-state resolution from pairwise `(asset_id, consent_id)` writes to face-based reconciliation.

Canonical invariants:

1. A detected photo face instance has at most one current consent assignment.
2. Manual face assignment is authoritative over auto face assignment.
3. Auto must never overwrite a manual current assignment for that same face.
4. Auto may replace auto only for the same face and only by explicit precedence rules.

Chosen auto conflict rules for one face:

1. If a current manual face link exists for that face, no auto row may exist for that face.
2. Otherwise, gather current eligible auto contenders for that face from `asset_consent_face_compares` using `winning_asset_face_id`.
3. Exclude contenders when:
   - consent is revoked
   - consent is not opted in
   - the face/consent pair is suppressed
   - the compare row is not current for the current headshot materialization and current photo materialization
   - confidence is below the auto threshold
4. Choose exactly one auto winner per face.

Deterministic auto tie-break order:

1. higher `winning_similarity`
2. lower `consent_id` lexicographically

The second tie-breaker is intentionally stable across replay and independent of job arrival order.

Same-face outcomes:

- auto vs auto:
  - keep only the highest-ranked current auto winner for that face
- manual vs auto:
  - manual wins immediately
  - displaced auto row is removed
  - displaced auto consent gets a face-level suppression for that face
- manual vs manual:
  - reject by default with conflict metadata
  - allow explicit replacement only with `forceReplace: true`
  - replacing a manual link also creates a face-level suppression for the displaced consent on that face

This answers question 5.

### 6. Manual linking and unlinking rules

When detected faces exist, manual photo linking becomes face-specific.

This feature will stop treating all photos as bulk `assetIds[]` link targets.

Manual link behavior by face count:

- zero detected faces:
  - manual face linking is impossible
  - allow an explicit asset-level manual fallback only
  - fallback is stored separately from face ownership
- exactly one detected face:
  - the API may default to that face when the request omits `assetFaceId`
  - the UI may offer a one-click link action because the target face is unambiguous
- multiple detected faces:
  - client must select a specific current face instance
  - the API must reject requests that do not specify `assetFaceId`

Manual unlink behavior:

- if unlinking a current face link for the same consent:
  - delete the current face link
  - insert a face-level suppression for that same `(asset_face_id, consent_id)`
- if unlinking a face candidate for a consent that is not the current assignee:
  - insert the face-level suppression
  - do not alter the current assignee for that face
- if unlinking a zero-face fallback:
  - delete the fallback row
  - insert a separate fallback suppression keyed by `(asset_id, consent_id)` because there is no face id

This answers question 6.

### 7. Face-level suppressions

Feature 031 will add a dedicated face-level suppression table for photo matching, for example:

- `public.asset_face_consent_link_suppressions`

This table becomes the suppression source for detected-face matching.

`asset_consent_link_suppressions` is no longer the photo-matching suppression table for detected faces. It may remain only for compatibility or zero-face fallback suppression if the repo keeps that pairwise fallback model.

Suppression semantics:

- suppressions are keyed to the specific current photo face and consent
- they block auto recreation for that face/consent pair only
- they do not suppress other faces in the same asset
- they do not suppress a different consent on the same face unless that consent is also explicitly suppressed

This answers question 7.

### 8. Headshot replacement behavior

Feature 031 will keep the current headshot replacement flow, but it must also update current face-level state explicitly.

Required behavior on headshot replacement:

1. replace the headshot link in `asset_consent_links`
2. preserve manual face links for that consent
3. preserve explicit zero-face manual fallbacks for that consent
4. delete that consent's current auto-derived face links from `asset_face_consent_links`
5. delete that consent's face-level suppressions
6. delete that consent's zero-face fallback suppressions
7. enqueue `consent_headshot_ready` with the current photo boundary

This answers question 8.

### 9. Revoked consent behavior

Feature 031 will align with `CONTEXT.md`:

- revoking consent stops future processing
- domain history is preserved

Chosen rule:

- revoked consents must not gain any new current face links or new zero-face fallbacks
- existing current rows are not purged solely because the consent was revoked
- any query that needs a "current usable link" must treat that as:
  - current face or fallback row
  - joined to a consent that is still opted in and not revoked

Manual consequence:

- manual link and fallback APIs must start rejecting revoked consents

Auto consequence:

- auto reconciliation ignores revoked consents
- replay and repair do not recreate current rows for revoked consents

This answers question 9.

### 10. Repair and replay

Feature 031 will keep repair and replay materialization-first, but canonical rebuild must now happen at the photo-face unit.

Chosen rule:

- current compare rows remain the durable source of truth for auto contenders
- manual face links and zero-face fallback rows remain the durable source of truth for manual decisions
- replay derives current canonical state from:
  - current photo materialization faces
  - current compare rows for current materialization pairs
  - face-level suppressions
  - manual face links
  - zero-face fallback rows

Implementation direction:

- add a deterministic helper such as `reconcilePhotoFaceCanonicalStateForAsset(...)`
- this helper rewrites current face links for one photo asset from authoritative current state
- call it from:
  - compare apply after a current compare row is written
  - manual link and unlink routes
  - headshot replacement cleanup for affected assets as needed
  - repair and replay paths when canonical current state must be rebuilt without rerunning matching

This answers question 10.

### 11. Manual-review API and UI changes

Feature 031 requires face-specific manual review when faces exist.

Minimum API shape:

- add a face-inspection endpoint for one photo asset and one consent, for example:
  - `GET /api/projects/[projectId]/consents/[consentId]/assets/[assetId]/manual-link-state`
- replace bulk photo-link POST and DELETE bodies with a face-aware request shape, for example:
  - `POST /api/projects/[projectId]/consents/[consentId]/assets/links`
  - `DELETE /api/projects/[projectId]/consents/[consentId]/assets/links`

Example request body:

```json
{
  "assetId": "photo-uuid",
  "mode": "face",
  "assetFaceId": "face-uuid",
  "forceReplace": false
}
```

Zero-face fallback request:

```json
{
  "assetId": "photo-uuid",
  "mode": "asset_fallback"
}
```

Server rules:

- derive tenant id from auth and session only
- verify the consent belongs to the project and is not revoked
- verify the photo belongs to the project and is upload-complete
- verify the specified `assetFaceId` belongs to the current materialization for that asset
- reject `mode = face` when zero faces exist
- reject `mode = asset_fallback` when one or more faces exist
- default the only face when exactly one exists and `assetFaceId` is omitted
- reject missing `assetFaceId` when multiple faces exist

Minimum UI change:

- stop relying on bulk `selectedAssetIds` manual linking for existing photos
- convert the current matching panel into per-photo review actions
- when the user chooses a photo:
  - zero faces:
    - show explicit "Link whole photo without detected face" fallback action
  - one face:
    - show the cropped face and allow one-click manual link
  - multiple faces:
    - show face overlays or face crops and require explicit selection
- linked photos view should group by photo and show:
  - linked face crops for face links
  - a distinct badge for zero-face manual fallback

This answers question 11.

### 12. Materialize-on-demand UX choice

Feature 031 will use a **staged** materialize-on-demand flow, not inline synchronous face detection inside the manual-link POST.

Chosen behavior:

1. user opens face review for a photo
2. server checks for a current materialization
3. if missing, server enqueues or repair-requeues `materialize_asset_faces`
4. endpoint returns `materializationStatus: "queued" | "processing"`
5. client polls until `materializationStatus: "ready"` or a safe user-facing error state
6. only then may the user submit a manual face link or zero-face fallback

Reason:

- reuses the existing materialization pipeline
- keeps materialization server-side
- avoids long-running user requests
- stays consistent with repair, replay, and continuation logic

POST and DELETE write endpoints should reject with a safe conflict response when current materialization is still missing.

This answers question 12.

## Schema / DB Changes

### 1. New `public.asset_face_consent_links` table

Add a dedicated current-state face-link table for detected photo faces.

Recommended columns:

- `asset_face_id uuid primary key references asset_face_materialization_faces(id) on delete cascade`
- `asset_materialization_id uuid not null references asset_face_materializations(id) on delete cascade`
- `asset_id uuid not null references assets(id) on delete cascade`
- `consent_id uuid not null references consents(id) on delete cascade`
- `tenant_id uuid not null references tenants(id) on delete cascade`
- `project_id uuid not null references projects(id) on delete cascade`
- `link_source text not null check (link_source in ('manual', 'auto'))`
- `match_confidence numeric null`
- `matched_at timestamptz null`
- `reviewed_at timestamptz null`
- `reviewed_by uuid null references auth.users(id)`
- `matcher_version text null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Required uniqueness:

- `primary key (asset_face_id)`
- unique `(tenant_id, project_id, asset_id, consent_id)`
  - this is the explicit Feature 031 limitation that defers the same-consent-multiple-faces-per-asset case

Required indexes:

- `(tenant_id, project_id, consent_id)`
- `(tenant_id, project_id, asset_id)`
- `(tenant_id, project_id, asset_materialization_id)`
- `(tenant_id, project_id, link_source, consent_id)`

### 2. New `public.asset_face_consent_link_suppressions` table

Add face-level suppressions for detected-face matching.

Recommended columns:

- `asset_face_id uuid not null references asset_face_materialization_faces(id) on delete cascade`
- `asset_materialization_id uuid not null references asset_face_materializations(id) on delete cascade`
- `asset_id uuid not null references assets(id) on delete cascade`
- `consent_id uuid not null references consents(id) on delete cascade`
- `tenant_id uuid not null references tenants(id) on delete cascade`
- `project_id uuid not null references projects(id) on delete cascade`
- `reason text not null check (reason in ('manual_unlink', 'manual_replace'))`
- `created_by uuid null references auth.users(id)`
- `created_at timestamptz not null default now()`

Required uniqueness:

- unique `(asset_face_id, consent_id)`

Required indexes:

- `(tenant_id, project_id, consent_id)`
- `(tenant_id, project_id, asset_id)`

### 3. New zero-face fallback model

Because zero-face fallback must stay distinct from face ownership, add a separate small model, for example:

- `public.asset_consent_manual_photo_fallbacks`

Recommended columns:

- `asset_id uuid not null references assets(id) on delete cascade`
- `consent_id uuid not null references consents(id) on delete cascade`
- `tenant_id uuid not null references tenants(id) on delete cascade`
- `project_id uuid not null references projects(id) on delete cascade`
- `created_by uuid null references auth.users(id)`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Required uniqueness:

- primary key or unique `(asset_id, consent_id)`

Optional paired suppression table if the fallback needs durable unlink intent:

- `public.asset_consent_manual_photo_fallback_suppressions`

This fallback model is not part of face exclusivity and must not participate in face conflict resolution.

### 4. Candidate / review metadata changes

Current likely-review state is still asset-level in `asset_consent_match_candidates`.

Feature 031 should keep the table if possible, but extend it with the winning face reference needed for face review:

- `winning_asset_face_id uuid null`
- `winning_asset_face_rank integer null`

Because same-consent-multiple-faces-per-asset is deferred, one candidate face per `(asset_id, consent_id)` is still sufficient for Feature 031.

### 5. Compare table indexes

Add a supporting index on `asset_consent_face_compares` for per-face reconciliation:

- `(tenant_id, project_id, winning_asset_face_id, compare_version)`

This makes face-level contender lookup explicit and cheap for `reconcilePhotoFaceCanonicalStateForAsset(...)`.

### 6. Compatibility and backfill migration

Feature 031 needs an explicit migration story because `asset_consent_links` already contains photo rows.

Recommended compatibility approach:

1. Add the new face-link, suppression, and fallback tables first.
2. Backfill current photo rows from `asset_consent_links` only when the migration is unambiguous:
   - current photo materialization has exactly one face:
     - migrate to `asset_face_consent_links`
   - current photo materialization has zero faces and the row is manual:
     - migrate to `asset_consent_manual_photo_fallbacks`
3. Do not guess for multi-face legacy photo rows.
4. Preserve those ambiguous rows in an explicit compatibility location instead of silently inventing face ownership.

Preferred explicit compatibility mechanism:

- move legacy photo rows into a dedicated archive table such as `asset_consent_legacy_photo_links`
- include a migration status column such as:
  - `migrated_face_link`
  - `migrated_zero_face_fallback`
  - `requires_manual_resolution`

Then:

- delete photo rows from `asset_consent_links`
- leave only headshot rows there going forward

This keeps the cutover explicit and auditable.

## Server-Side Write Model

### Recommendation

Move the new manual face-link and suppression writes into explicit SQL helpers or narrowly scoped server-side transactional helpers instead of spreading the precedence logic across route handlers.

Recommended helpers:

- `app.manual_link_photo_face(...)`
- `app.manual_unlink_photo_face(...)`
- `app.manual_link_zero_face_photo_fallback(...)`
- `app.manual_unlink_zero_face_photo_fallback(...)`
- `app.clear_consent_auto_photo_face_links(...)`
- `app.clear_consent_photo_face_suppressions(...)`

Reason:

- current manual flow will now do conflict checks, replacements, suppressions, and idempotent cleanup
- these writes should be atomic and retry-safe

### Idempotent write rules

Duplicate manual requests must be safe.

Expected behavior:

- duplicate POST for the same face and consent:
  - upsert same manual row
  - delete same suppression if present
  - no duplicate state
- duplicate DELETE for the same face and consent:
  - delete no-op is safe
  - suppression upsert is safe
- duplicate `forceReplace` request:
  - same final current row
  - same displaced-consent suppression rows

## Auto Reconciliation Changes

### 1. Replace pairwise auto apply with face-aware canonical reconciliation

`applyAutoMatches(...)` in `src/lib/matching/auto-match-worker.ts` is the wrong write unit for Feature 031.

Replace the photo-link part of that flow with a face-aware helper such as:

- `reconcilePhotoFaceCanonicalStateForAsset(...)`

Expected algorithm for one photo asset:

1. load the current photo materialization and current faces
2. load current manual face links for the asset
3. load current zero-face fallback rows for the asset
4. load face-level suppressions for the asset
5. load current eligible compare rows for the asset from `asset_consent_face_compares`
6. group compares by `winning_asset_face_id`
7. apply precedence per face:
   - existing manual face link wins
   - else highest-ranked eligible auto contender wins
8. delete stale auto rows for faces with no remaining winning auto contender
9. do not touch manual face rows except where the explicit manual write path changed them

### 2. What a compare job does after Feature 031

`compare_materialized_pair` still:

- materializes the pair if needed
- persists the compare row once
- checks currentness and consent eligibility

But instead of upserting a pairwise row into `asset_consent_links`, it must:

- persist candidate and review state
- invoke face-aware canonical reconciliation for the target asset when the pair is current

This keeps `asset_consent_face_compares` as the durable auto evidence table and makes current face ownership a derived current-state table.

### 3. Exact conflict scenarios

Auto vs auto on the same face:

- load all eligible contenders for the same `winning_asset_face_id`
- keep only the top-ranked auto row

Manual vs auto on the same face:

- current manual row always blocks auto
- if the user manually links over an existing auto assignee:
  - replace the current row with manual
  - add suppression for the displaced auto consent on that face

Manual vs manual on the same face:

- default API response: conflict
- explicit `forceReplace: true`:
  - replace the row transactionally
  - add suppression for the displaced manual consent on that face

### 4. Same consent on different faces in the same asset

Because Feature 031 defers repeated appearances, the auto reconciler must also respect the new unique `(asset_id, consent_id)` rule.

If future data ever presents more than one contender face for the same consent in one asset:

- keep only the higher-ranked current face for that consent within that asset
- leave the rest unassigned

That keeps replay deterministic and aligned with the explicit temporary limitation.

## Manual Materialize-On-Demand Flow

### 1. Face inspection endpoint

Add a new authenticated endpoint for one consent and one photo asset, for example:

- `GET /api/projects/[projectId]/consents/[consentId]/assets/[assetId]/manual-link-state`

Response should include:

- `materializationStatus`
  - `ready`
  - `queued`
  - `processing`
  - `unusable`
- `assetId`
- `materializationId`
- `detectedFaceCount`
- `faces[]`
  - `assetFaceId`
  - `faceRank`
  - face box or crop metadata
  - current assignee metadata if any
  - whether this consent is suppressed on that face
- `fallbackAllowed`
- `currentConsentLink`
  - face link or fallback metadata for this consent if already present

### 2. Server behavior when the photo is not materialized yet

The endpoint must:

1. resolve tenant and project server-side
2. verify the asset is an uploaded current photo in the project
3. check current materialization for the configured materializer version
4. if missing:
   - enqueue or repair-requeue `materialize_asset_faces`
   - return a safe pending state

The endpoint must not expose internal matcher or provider errors directly to the client.

### 3. UI behavior

The current `ConsentAssetMatchingPanel` should change from batch checkbox linking to per-photo review:

- matchable photo cards get a `Review faces` or `Link` action
- opening that action loads the manual-link-state endpoint
- pending materialization shows a waiting state with polling
- zero faces show an explicit fallback CTA
- one face shows the single face crop and a direct link CTA
- multiple faces show selectable face crops or overlays and require explicit selection

Keep the UI bounded:

- no broad asset-management redesign
- no new global moderation console
- only the minimum selection flow needed for group-photo correctness

## Headshot Replacement Flow

Update `src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts` so replacement becomes:

1. verify consent still exists and is opted in
2. replace the headshot row in `asset_consent_links`
3. clear that consent's face-level suppressions
4. clear that consent's zero-face fallback suppressions
5. clear that consent's current auto face links
6. preserve that consent's manual face links and manual zero-face fallbacks
7. archive orphaned old headshot assets as today
8. enqueue `consent_headshot_ready` with the current photo boundary

Reason:

- manual review should remain authoritative
- auto state from the old headshot must not remain current
- suppressions from the old headshot must not block reevaluation from the new headshot

## Repair / Reconcile / Replay

### 1. Reconcile

`runAutoMatchReconcile(...)` can remain recent-window and internal-only.

Required update:

- its requeued intake work must remain compatible with the new face-link model
- when compare work completes, current state must be rebuilt through the same face reconciliation helper as normal flow

### 2. Repair

`runProjectMatchingRepair(...)` remains the project-scoped, materialization-first repair entrypoint.

Required behavior after Feature 031:

- requeue current source materializations as it does today
- let continuations backfill missing compare rows
- add a bounded canonical rebuild path for assets whose compare rows already exist but current face-link state is missing or stale

Preferred implementation:

- add a repair mode that pages current photo assets and runs `reconcilePhotoFaceCanonicalStateForAsset(...)` after current compare and materialization state is available

### 3. Replay

Replay should not depend on rematching when current compare rows already exist.

Required replay rule:

- rebuild face-level current rows from current compare rows and manual tables
- do not recreate stale lower-priority auto assignments
- do not override manual rows
- do not recreate current rows for revoked consents

This keeps repair and replay aligned to the same canonical unit as normal apply and manual writes.

## Project Progress Behavior

Feature 031 does not need a new pair-level progress model.

Keep current progress semantics:

- `totalImages`
- `processedImages`
- `progressPercent`
- `isMatchingInProgress`
- `hasDegradedMatchingState`

Required compatibility change:

- manual materialize-on-demand must reuse the existing `materialize_asset_faces` queue path so progress and degraded-health behavior stay truthful

No new user-facing progress percentage is required for face-link reconciliation in this feature.

## Security Considerations

- Every new table and query path must remain explicitly tenant-scoped and project-scoped.
- No client-provided `tenant_id` should be accepted anywhere.
- Manual link and unlink writes must validate:
  - consent belongs to project
  - asset belongs to project
  - face belongs to the asset's current materialization
  - consent is not revoked
- Materialize-on-demand must remain authenticated and server-controlled.
- Route handlers must return safe conflict or pending states rather than raw matcher or materialization internals.
- Any archive or compatibility table for legacy photo rows must remain tenant-scoped and internal.

## Partial-Failure And Concurrency Cases

### Case: duplicate manual link request

Expected behavior:

- idempotent final state
- no duplicate face links
- suppression cleanup remains idempotent

### Case: partial failure after materializing but before manual face link write

Expected behavior:

- materialization stays durable
- no current face link is written yet
- next client retry sees `materializationStatus = ready` and can safely retry the manual link

### Case: two users race to manually link the same face

Expected behavior:

- one write wins first
- second write sees current assignee and either:
  - replaces auto immediately if allowed
  - receives a manual conflict unless `forceReplace: true`

### Case: manual link races with auto compare apply

Expected behavior:

- manual row wins
- displaced auto row is removed or blocked
- same-face auto cannot overwrite the manual row later

### Case: manual unlink of the current face link

Expected behavior:

- delete current row for that face and consent if present
- insert face-level suppression
- leave the face unassigned unless another eligible auto contender wins on subsequent reconciliation

### Case: group photo with multiple different people

Expected behavior:

- each face in the asset is reconciled independently
- different consents may occupy different current faces in the same asset
- UI requires choosing the right face for manual linking

### Case: zero-face fallback

Expected behavior:

- explicit fallback row only
- no face ownership row created

### Case: one-face manual selection

Expected behavior:

- server may default to the sole face
- duplicate request remains idempotent

### Case: multiple-face manual selection without `assetFaceId`

Expected behavior:

- reject with a conflict or validation error
- return enough structured metadata for the UI to re-open face selection cleanly

### Case: headshot replacement while compare work is still draining

Expected behavior:

- old headshot continuations still supersede as today
- old auto face rows for that consent are cleared
- manual face rows survive
- new compare work rebuilds auto state from the replacement headshot only

### Case: revoked consent during manual or auto work

Expected behavior:

- manual writes are blocked
- auto reconciliation excludes the consent
- existing history remains intact

### Case: repair and replay after the new rules exist

Expected behavior:

- canonical face state is rebuilt deterministically from current compare, manual, and suppression state
- replay does not depend on write arrival order

## Implementation Phases

### Phase 1: Canonical face-link schema

- add `asset_face_consent_links`
- add `asset_face_consent_link_suppressions`
- add zero-face fallback tables
- add compare-table supporting indexes
- add any compatibility or archive table needed for legacy photo rows

Verification:

- migration-backed tests for uniqueness, tenant scoping, and basic upsert and delete behavior

### Phase 2: Read-path split between headshots, face links, and fallback rows

- stop reading photo links from `asset_consent_links`
- update consent photo list and read helpers to return:
  - face links
  - fallback rows
  - grouped asset presentation for the UI
- extend likely-review reads with winning face metadata

Verification:

- tests for linked-photo listing and likely-review listing with face metadata

### Phase 3: Manual link and unlink server logic

- add face-aware manual link and unlink helpers
- enforce zero, one, and many-face rules
- enforce revoked-consent blocking
- add explicit manual conflict and `forceReplace` handling
- add materialization-on-demand inspection endpoint

Verification:

- tests for idempotent manual writes, conflict handling, and zero-face fallback

### Phase 4: Auto canonical reconciliation

- replace pairwise photo-link apply with face-aware asset reconciliation
- keep compare persistence unchanged
- reconcile current face links from current compare rows plus manual and suppression state

Verification:

- tests for auto-vs-auto and manual-vs-auto same-face precedence

### Phase 5: Headshot replacement and replay and repair alignment

- clear consent auto face links and face suppressions on headshot replacement
- keep manual rows intact
- make repair and replay rebuild canonical face state deterministically

Verification:

- tests for headshot replacement, replay, repair, and revoked-consent compatibility

### Phase 6: UI update for face-specific review

- replace bulk checkbox linking for existing photos with per-photo review
- add materialization pending state
- add one-face direct link path
- add explicit many-face selection path
- show zero-face fallback distinctly

Existing bulk manual linking for detected-face photos is intentionally replaced by per-photo review. In multi-select flows, assets with zero or one detected face may still be handled quickly, but assets with multiple detected faces must be reviewed individually so the user can choose the correct face.

Verification:

- component and route tests for face-selection workflows

## Test Plan

Add a dedicated regression file:

- `tests/feature-031-one-consent-per-face-precedence-rules.test.ts`

Update existing coverage in:

- `tests/feature-012-manual-review-likely-matches.test.ts`
- `tests/feature-019-face-materialization-pipeline.test.ts`
- `tests/feature-021-project-matching-progress.test.ts`
- `tests/feature-029-complete-bounded-matching-fanout.test.ts`

Required regression coverage:

### Auto precedence

- two auto matches compete for the same `winning_asset_face_id`
- only one current face link survives
- higher-confidence auto wins
- deterministic tie breaks do not depend on arrival order

### Manual replacing auto

- manual link on a face with an existing auto assignee replaces the auto row
- displaced auto consent gets a face-level suppression

### Auto not replacing manual

- current manual face link exists
- new higher-confidence auto compare arrives for the same face
- manual row remains current

### Manual vs manual

- second manual link on the same face without `forceReplace` conflicts
- same request with `forceReplace` replaces the assignee and adds suppression for the displaced consent

### Manual unlink and suppression

- unlink current face link inserts face-level suppression
- same face does not immediately regain that consent through auto replay

### One current consent per face

- same face cannot hold two current consents
- different faces in the same asset can each hold different current consents

### Zero-face fallback

- zero detected faces allow explicit asset-level fallback only
- fallback does not create a face ownership row

### One-face auto-selection behavior

- exactly one detected face
- manual link without `assetFaceId` defaults to the sole face

### Multiple-face explicit selection behavior

- multiple detected faces
- missing `assetFaceId` is rejected
- explicit selected face succeeds

### Headshot replacement

- current auto face rows for the consent are cleared
- current manual face rows stay
- face suppressions are cleared
- new headshot re-drives matching

### Revoked consent

- revoked consent cannot get new manual face links
- revoked consent cannot get new auto current face links
- existing rows are not purged automatically

### Replay and repair

- replay from current compare rows restores deterministic face-level current state
- repair after missing canonical rows rebuilds correct face assignments without rematching when compare rows already exist

### Duplicate and retry safety

- duplicate manual POST is idempotent
- duplicate manual DELETE is idempotent
- partial failure after materialization but before manual write leaves retriable clean state

### Progress compatibility

- materialize-on-demand pending state remains compatible with current project progress and degraded matching behavior if any helper needs adjustment

## Risks And Tradeoffs

### Current face ids are not durable across future materializer-version changes

Tradeoff:

- Feature 031 uses the current materialized face row id now

Mitigation:

- keep currentness explicit through `asset_materialization_id`
- keep cross-version durable face identity as a deferred follow-up
- document that future materializer upgrades may require manual face re-review

### Explicitly deferring repeated-person-in-one-photo support

Tradeoff:

- one consent cannot occupy two different current faces in one asset yet

Why this is acceptable:

- it matches current compare persistence
- it keeps Feature 031 bounded around the one-consent-per-face invariant

### Compatibility migration for legacy photo rows

Tradeoff:

- old asset-level photo rows cannot always be migrated automatically

Mitigation:

- only migrate unambiguous rows automatically
- archive ambiguous legacy rows explicitly
- do not silently guess face ownership

### UI scope change

Tradeoff:

- bulk existing-photo linking becomes narrower because group-photo correctness needs per-photo review

Mitigation:

- keep upload flow unchanged
- keep one-face linking fast
- keep zero-face fallback explicit and simple

## Implementation Prompt

Implement Feature 031 using the dedicated photo-face canonical model from this plan.

Add a new tenant-scoped `asset_face_consent_links` table for current detected-face ownership, a new `asset_face_consent_link_suppressions` table for face-level suppressions, and a separate explicit zero-face manual fallback model for photos with no detected faces. Keep `asset_consent_links` for headshot-to-consent linkage only, and stop writing photo current state there. Use `asset_face_materialization_faces.id` plus the current `asset_materialization_id` as the face identifier for this feature, and explicitly enforce the temporary limitation that one consent may have at most one current face in a given asset. Replace pairwise photo-link apply in the worker with a deterministic face-aware reconciliation helper that derives current auto state from current compare rows grouped by `winning_asset_face_id`, applies explicit precedence rules, and never lets auto overwrite manual. Add face-aware manual link and unlink server logic with zero-face, one-face, and many-face handling, staged materialize-on-demand through the existing materialization pipeline, explicit manual conflict handling, and idempotent retry-safe writes. Update headshot replacement so it clears that consent’s auto face rows and face suppressions while preserving manual rows, and align repair and replay so canonical face-level state can be rebuilt deterministically from current compare rows, current materializations, and manual decision tables. Add regression coverage for same-face auto competition, manual-over-auto precedence, face-level suppressions, group-photo behavior, zero-face fallback, revoked consent blocking, headshot replacement, replay and repair determinism, duplicate request safety, and progress compatibility.
