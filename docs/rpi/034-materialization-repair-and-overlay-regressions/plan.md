# Feature 034 Plan: Materialization Repair And Overlay Regressions

## Goal

Restore correct materialization/matching behavior and fix the two overlay UI regressions without changing schema.

## Implementation steps

### 1. Add bounded forced rematerialization support

In `src/lib/matching/face-materialization.ts`:

- extend `ensureAssetFaceMaterialization(...)` with `forceRematerialize?: boolean`
- keep the fast return for normal calls
- when `forceRematerialize` is true, rerun provider materialization and update the existing row in place instead of trusting the stale record

Use this only for repair candidates:

- photo materializations with `face_count = 0`
- headshot materializations with `usable_for_compare = false`

### 2. Retry manual single-asset review on stale zero-face rows

In `src/lib/matching/photo-face-linking.ts`:

- detect current photo materializations that are stale zero-face candidates
- if one is found, try `attemptDirectManualPhotoMaterialization(...)` with forced rematerialization before returning the ready state
- keep the existing requeue fallback when direct materialization still fails

### 3. Let repair/worker flows actually repair stale materializations

In `src/lib/matching/auto-match-worker.ts`:

- inspect the current materialization before processing a `materialize_asset_faces` job
- when `repairRequested` is true and the current row is a repair candidate, pass `forceRematerialize: true`
- otherwise preserve the existing fast-path behavior

### 4. Invalidate stale compare rows when materializations were refreshed in place

In `src/lib/matching/materialized-face-compare.ts`:

- treat an existing compare row as reusable only when:
  - `compared_at >= headshot.materialization.materialized_at`
  - `compared_at >= asset.materialization.materialized_at`
- otherwise recompute and upsert over the same compare row key

This covers stale `source_unusable`, `target_empty`, and stale matched winners when the same materialization ids are reused.

### 5. Fix review selection and asset-preview overlays

In `src/components/projects/photo-link-review-dialog.tsx`:

- move the `Selected` chip below the face box
- strengthen the selected-state treatment so it is visually distinct from ordinary face status coloring
- avoid black/orange styling

In `src/components/projects/previewable-image.tsx`:

- reuse the shared `getFaceOverlayStyle(...)` measured overlay math
- measure the rendered preview image wrapper and natural image size
- place the consent badge with its center exactly on the face box bottom-right corner

### 6. Verification

Add/update tests for:

- manual review recovering from an existing stale zero-face materialization
- compare recomputation after an in-place materialization refresh

Run:

- `npm test -- tests/feature-031-one-consent-per-face-precedence-rules.test.ts`
- `npm test -- tests/feature-032-face-consent-linking-ui-improvements.test.ts`
- `npm run lint`

## Security and reliability

- All queries remain tenant-scoped and server-derived.
- No new client trust is introduced.
- Forced rematerialization remains bounded to stale zero-face/unusable rows to avoid deleting valid linked face state.
- Manual review still degrades safely to queued repair when synchronous rematerialization is unavailable.

## Edge cases

- If a photo truly still has zero faces after forced rematerialization, manual review should continue to expose only the explicit zero-face fallback.
- If provider materialization fails during forced retry, the user should still see queued/processing state rather than a silent success.
- If stale compare rows are refreshed to `no_match` or `source_unusable`, existing downstream read paths must tolerate the updated status cleanly.
