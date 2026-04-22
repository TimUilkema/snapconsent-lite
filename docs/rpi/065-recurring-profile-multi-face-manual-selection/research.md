# Feature 065 Research: Recurring Profile Multi-Face Manual Selection

## Inputs reviewed

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `UNCODEXIFY.MD`
- `docs/rpi/README.md`
- `docs/rpi/049-recurring-profiles-and-consent-management-foundations/research.md`
- `docs/rpi/056-recurring-profile-headshots-and-matching-materialization-foundation/research.md`
- `docs/rpi/056-recurring-profile-headshots-and-matching-materialization-foundation/plan.md`
- `docs/rpi/057-project-matching-integration-for-ready-recurring-profiles/research.md`
- `docs/rpi/059-auto-assignment-for-project-scoped-recurring-assignees/research.md`
- `src/lib/profiles/profile-headshot-service.ts`
- `src/lib/profiles/profile-directory-service.ts`
- `src/components/profiles/profile-headshot-panel.tsx`
- `tests/feature-056-recurring-profile-headshot-selection.test.ts`
- `tests/feature-056-recurring-profile-headshot-routes.test.ts`

## Current behavior

The recurring profile headshot canonical-face decision is server-side in
`selectRecurringProfileCanonicalFace(...)`.

Current logic:

- `0` ranked faces: `no_face_detected`
- `1` ranked face:
  - auto-select when confidence and area thresholds are met
  - otherwise `unusable_headshot`
- `>1` ranked faces:
  - auto-select when the top face passes thresholds and clearly dominates the second face
  - otherwise either `needs_face_selection` or `unusable_headshot`

The multi-face auto-selection branch was introduced in Feature `056` to handle
"portrait plus small background face" uploads without operator input.

## Verified current thresholds and consequences

Current thresholds are:

- `MIN_FACE_CONFIDENCE = 0.8`
- `MIN_FACE_AREA_RATIO = 0.05`

Important consequence:

- `unusable_headshot` does not mean "no faces were stored"
- it means the selected-ready path could not accept the image as a compare source

For recurring profile headshots today, an image becomes `unusable_headshot` in
these cases:

1. One detected face exists, but it is too small or too low-confidence.
   - selection reason: `single_face_below_threshold`
2. Multiple detected faces exist, but the top-ranked face is too small or too
   low-confidence.
   - this follow-up now stays in `needs_face_selection`
   - selection reason: `multiple_faces_low_quality`

Separate from selection status, materialization itself tracks detector truth:

- `usable_for_compare = false` with `unusable_reason = "no_face"` when no faces
  were materialized
- `usable_for_compare = false` with `unusable_reason = "embedding_missing"` when
  one or more faces were detected but embeddings were missing

That means users can see boxes/candidate faces in the UI and still hit an
"unusable" readiness state because readiness is derived from canonical face
selection rules, not only from raw detection presence.

## Current UI coupling

The face chooser is already implemented and only appears when:

- the user can manage headshots
- matching authorization is active
- readiness is `needs_face_selection`
- candidate faces exist

That means a behavior change from multi-face auto-selection to
always-manual-selection does not need a new route or UI component. It only
needs the server-side decision rule to stop auto-selecting multi-face results.

## Risks and edge cases

- This change makes more uploads stop at `needs_face_selection`, including the
  previous "dominant face plus small background face" case.
- Manual selection currently accepts any persisted detected face on a
  materialized headshot. It does not re-apply the single-face prominence
  thresholds during manual choice.
- Matching readiness for a multi-face image therefore depends on operator
  choice rather than the old dominance heuristic.
- Project replay behavior remains intact because readiness still transitions
  through the same `needs_face_selection -> ready` path once a face is chosen.

## Recommended bounded change

Change `selectRecurringProfileCanonicalFace(...)` so that:

- zero-face and single-face behavior stay unchanged
- any headshot with more than one detected face always returns
  `needs_face_selection`
- when the best detected multi-face candidate is still below the existing
  confidence or size threshold, the server should preserve that fact through a
  distinct reason so the UI can warn that matching quality may still be poor
- the dominance heuristic and multi-face unusable branch are removed

This matches the requested product rule:

- if more than one face is detected in a recurring profile headshot, the web
  app should never auto-select a face
- the user must always choose the face manually
