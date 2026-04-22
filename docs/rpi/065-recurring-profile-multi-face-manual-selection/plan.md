# Feature 065 Plan: Recurring Profile Multi-Face Manual Selection

## Goal

Adjust recurring profile headshot behavior so any upload with more than one
detected face always requires manual face selection.

## Implementation plan

1. Update `selectRecurringProfileCanonicalFace(...)` in
   `src/lib/profiles/profile-headshot-service.ts`.
   - Keep zero-face handling unchanged.
   - Keep single-face threshold behavior unchanged.
   - For any `rankedFaces.length > 1`, return:
     - `selectionFaceId = null`
     - `selectionStatus = "needs_face_selection"`
     - a manual-selection reason string
   - When the top ranked face is below the existing thresholds, return a
     low-quality reason instead of the generic multi-face reason.

2. Remove now-unused multi-face dominance constants and decision branches.

3. Update unit tests in
   `tests/feature-056-recurring-profile-headshot-selection.test.ts`.
   - Replace the old dominant multi-face auto-selection assertion with a
     manual-selection assertion.
   - Keep the existing similar-multi-face manual-selection test.
   - Add a multi-face low-quality test that preserves manual selection plus a
     warning-specific selection reason.
   - Keep the single-face unusable test.

4. Surface a warning in `src/components/profiles/profile-headshot-panel.tsx`.
   - Show it only for `needs_face_selection` when the current headshot carries
     the low-quality multi-face reason.
   - Localize the warning in both English and Dutch.

## Security and invariants

- No tenant-scoping changes.
- No auth or route contract changes.
- No client-side trust changes.
- Canonical face selection remains server-side.

## Edge cases

- Multi-face portrait with one dominant face:
  - now `needs_face_selection`, never `auto_selected`
- Multi-face group image with only small faces:
  - now `needs_face_selection`, as long as faces were detected and persisted
- Single detected face below threshold:
  - remains `unusable_headshot`
- No detected face:
  - remains `no_face_detected`
- Materialization failure or missing embeddings:
  - unchanged; readiness still depends on existing materialization flow

## Test plan

- Run the recurring profile headshot selection tests.
- Run the recurring profile headshot route tests as a regression check for the
  unchanged route contract.
