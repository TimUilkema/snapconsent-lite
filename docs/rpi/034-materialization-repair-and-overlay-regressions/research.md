# Feature 034 Research: Materialization Repair And Overlay Regressions

## Goal

Fix the regressions introduced around feature 032/033 where:

- manual single-asset face review can get stuck on an existing zero-face materialization and incorrectly report "No detected faces were found"
- repair/worker flows can fail to recover from stale unusable materializations, which prevents new compare results and auto matches
- the selected-face label in review overlays obscures the detected face
- the consent badge in the asset preview overlay does not sit on the actual face-box corner

## Inputs reviewed

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `UNCODEXIFY.MD`
- `docs/rpi/README.md`
- `docs/rpi/031-one-consent-per-face-precedence-rules/research.md`
- `docs/rpi/031-one-consent-per-face-precedence-rules/plan.md`
- `docs/rpi/032-face-consent-linking-ui-improvements/research.md`
- `docs/rpi/032-face-consent-linking-ui-improvements/plan.md`
- `docs/rpi/033-asset-face-overlays-and-confidence/research.md`
- `docs/rpi/033-asset-face-overlays-and-confidence/plan.md`

Primary code paths verified:

- `src/lib/matching/face-materialization.ts`
- `src/lib/matching/materialized-face-compare.ts`
- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/auto-match-worker.ts`
- `src/lib/matching/auto-match-repair.ts`
- `src/components/projects/photo-link-review-dialog.tsx`
- `src/components/projects/previewable-image.tsx`
- `tests/feature-031-one-consent-per-face-precedence-rules.test.ts`
- `tests/feature-032-face-consent-linking-ui-improvements.test.ts`

## Current verified behavior

### 1. Manual single-asset review only direct-materializes when no materialization row exists

`getManualPhotoLinkState(...)` currently:

- loads the current materialization for the asset
- only calls `attemptDirectManualPhotoMaterialization(...)` when that lookup returns `null`
- otherwise it trusts the existing row and builds the ready state from it

Implication:

- if the current row exists but was materialized with `face_count = 0`, manual review never retries detection
- the UI can get stuck in a false zero-face state even when the provider would now detect faces correctly

### 2. Repair jobs do not actually rematerialize stale rows

`runProjectMatchingRepair(...)` and manual-link requeue paths enqueue `materialize_asset_faces` jobs with:

- `repairRequested: true`

But `processMaterializeAssetFacesJob(...)` currently calls `ensureAssetFaceMaterialization(...)` without any force/rematerialize mode.

`ensureAssetFaceMaterialization(...)` immediately returns the existing row for the same `(tenant, project, asset, materializer_version)`.

Implication:

- repair requeues on stale zero-face/unusable rows do not repair anything
- the job completes, but the old materialization remains authoritative

### 3. Compare rows can stay stale because materialization ids are reused in place

The schema intentionally keys materializations by:

- `(tenant_id, project_id, asset_id, materializer_version)`

and `ensureAssetFaceMaterialization(...)` updates that row in place.

`ensureMaterializedFaceCompare(...)` currently reuses an existing compare row solely by:

- `headshot_materialization_id`
- `asset_materialization_id`
- `compare_version`

Implication:

- if a materialization is refreshed in place and `materialized_at` changes, the compare row can still be treated as current
- stale `source_unusable`, `target_empty`, or old matched winners can persist until something else deletes them

### 4. Downstream schema relationships matter for repair semantics

Verified foreign key behavior:

- `asset_face_consent_links.asset_face_id -> asset_face_materialization_faces(id) on delete cascade`
- `asset_face_consent_link_suppressions.asset_face_id -> asset_face_materialization_faces(id) on delete cascade`
- `asset_face_image_derivatives.asset_face_id -> asset_face_materialization_faces(id) on delete cascade`
- review session face/materialization references use `on delete set null`

Implication:

- a broad "delete all faces and rebuild" rematerialization would also delete manual links, suppressions, and face crops
- the safe bounded repair path is to target stale zero-face/unusable materializations first, where there are no valid face rows to preserve

### 5. Review overlay and asset-preview overlay styling drifted from the intended feature-032 behavior

Verified UI regressions:

- `PhotoLinkReviewDialog` renders `Selected` inside the box at top-left, which can cover the face
- `PreviewableImage` currently uses direct percentage positioning instead of the shared measured `getFaceOverlayStyle(...)` path from feature 032
- the consent badge is offset from the corner instead of being centered on the face box bottom-right corner

## Root cause summary

The backend failure is a stale-state bug chain:

1. a bad zero-face or unusable materialization row is persisted
2. manual review trusts that row and does not retry detection
3. repair jobs requeue but do not actually rematerialize the existing row
4. compare rows are keyed to the same materialization ids and can remain stale even after the row is refreshed in place

This explains both symptoms the user reported:

- manual review can show "No detected faces were found for this photo"
- the worker can run without producing new matches because it still sees unusable current materializations / stale compare state

## Recommended implementation direction

### Backend

- add an explicit `forceRematerialize` path to `ensureAssetFaceMaterialization(...)`
- use it only for repair candidates:
  - photos with `face_count = 0`
  - headshots that are currently unusable for compare
- let manual single-asset review retry direct materialization when the current photo row is a zero-face candidate
- let compare reuse only when `compared_at` is not older than either materialization's `materialized_at`

### UI

- move the `Selected` chip below the review box, centered
- reuse `getFaceOverlayStyle(...)` in the asset preview modal
- anchor the consent badge so its center sits exactly on the face box bottom-right corner
- strengthen selected-state contrast without returning to the earlier black/orange styling

## Risks and edge cases

- Forced rematerialization should stay bounded to stale zero-face/unusable cases so it does not silently wipe valid manual face rows.
- In-place rematerialization still reuses the materialization id, so compare freshness must be validated by timestamps, not ids alone.
- Manual review must still fall back to job requeue when direct materialization throws or the provider is unavailable.
- UI overlays must stay clickable without blocking the underlying face box selection target.
