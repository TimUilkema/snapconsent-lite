# Feature 047 Plan: Manual Face Box Creation in Asset Preview

## Inputs and ground truth

This plan is based on:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- verified research in `docs/rpi/047-manual-face-box-creation-in-asset-preview/research.md`

Targeted live verification was limited to plan-critical files:

- `src/components/projects/project-asset-preview-lightbox.tsx`
- `src/components/projects/previewable-image.tsx`
- `src/lib/client/face-overlay.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/preview-faces/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/preview-candidates/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/hidden-faces/[assetFaceId]/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/links/route.ts`
- `src/lib/matching/asset-preview-linking.ts`
- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/face-materialization.ts`
- `src/lib/matching/materialized-face-compare.ts`
- `src/lib/matching/auto-match-worker.ts`
- `src/lib/assets/sign-face-derivatives.ts`
- `supabase/migrations/20260320140000_019_face_materialization_pipeline.sql`
- `supabase/migrations/20260403170000_031_face_level_photo_linking.sql`
- `supabase/migrations/20260404110000_032_face_review_sessions_and_derivatives.sql`
- `supabase/migrations/20260409110000_045_asset_face_hidden_states.sql`

## Verified current boundary

The current live boundary is:

- `ProjectAssetPreviewLightbox` already owns preview-local hover, selection, candidate loading, hide/restore actions, and preview refresh behavior.
- `ImagePreviewLightbox` already owns measured frame size, natural image size, zoom, pan, pointer-based pan, and overlay rendering.
- Overlay placement already uses normalized coordinates through `getFaceOverlayStyle(...)` and `transformPreviewOverlayStyle(...)`.
- `face-overlay.ts` already exposes contained-image rect math, which is the right basis for image-rect-only drawing.
- `GET /api/projects/[projectId]/assets/[assetId]/preview-faces` already returns all current faces for an asset, including `linked_manual`, `linked_auto`, `unlinked`, and `hidden`.
- `GET /api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/preview-candidates` already ranks candidates per face id and falls back to unscored active consents.
- `POST /api/projects/[projectId]/consents/[consentId]/assets/links` already performs the exact manual face-link write and remains reusable after manual face creation.
- `POST/DELETE /api/projects/[projectId]/assets/[assetId]/hidden-faces/[assetFaceId]` already provide the shared hidden-face behavior and should remain reusable for manual faces.
- Current face identity everywhere is `asset_face_materialization_faces.id`.
- Current face rows still assume detector output:
  - `embedding` is currently `not null`
  - there is no `face_source`
  - current compare generation and auto reconciliation currently read all face rows unless filtered

## Options considered

### Option A: Keep manual faces in `asset_face_materialization_faces`

Pros:

- reuses current preview, hidden-face, linking, export, and candidate read paths
- preserves the existing exact-face identity model
- keeps manual faces immediately compatible with current unlinked-face UX

Cons:

- requires additive schema change
- requires rematerialization preservation logic
- requires explicit exclusion from auto-matching paths

### Option B: Add a separate manual-face table and union reads

Pros:

- preserves detector table semantics
- avoids touching detector materialization writes at first glance

Cons:

- forces union logic into preview, hidden-face, linking, candidate, export, and cleanup paths
- creates two current-face identity models
- increases surface area for regressions

### Option C: Create manual faces in the current face table and let them enter automatic matching

Pros:

- fewer explicit filters in compare and reconcile code

Cons:

- violates the product boundary for this feature
- manual faces would acquire compare scores and auto links without explicit user action
- makes missing embeddings or fake embeddings a correctness problem

## Recommendation

Choose Option A and explicitly reject Option C.

Feature 047 should:

- store manual faces in `asset_face_materialization_faces`
- add a face-level provenance field
- allow manual faces to exist without embeddings
- preserve manual faces across detector rematerialization
- reuse the current preview, hidden-face, candidate, and manual-link flows
- explicitly exclude manual faces from automatic compare, likely-candidate, and auto-reconcile paths

## Chosen architecture

### Architecture summary

Feature 047 will:

- keep `AssetsList -> ProjectAssetPreviewLightbox -> ImagePreviewLightbox`
- keep current overlay geometry, zoom, pan, hover, and selection models
- add a bounded draw mode inside `ImagePreviewLightbox`
- add one asset-centric create route for manual face creation
- keep manual faces in `asset_face_materialization_faces`
- treat created manual faces as normal current preview faces
- reuse the existing face-candidate route and manual-link route after creation
- reuse the existing hidden-face route and shared hidden-face model
- keep `Link to entire asset` as disabled placeholder UI only

### Exact v1 scope

Included:

- `+ Add person` in the asset preview
- a two-option menu:
  - `Select face`
  - `Link to entire asset`
- only `Select face` is implemented
- drawing one rectangular face box
- confirm and cancel flow
- inserting one manual current face row
- best-effort face thumbnail generation
- immediate preview refresh
- immediate reuse of the existing unlinked-face candidate tray and manual-link flow

Excluded:

- real backend for `Link to entire asset`
- zero-face fallback redesign
- full box editing toolkit
- resize handles and arbitrary shape editing
- cross-rematerialization durable detector face identity
- broader matching-system redesign
- automatic matching for manual faces

### Exact v1 decisions

- `Link to entire asset` is shown disabled in the `+ Add person` menu.
- Manual face creation produces a normal current face instance with its own `asset_face_id`.
- Manual faces are previewable, hideable, restorable, and manually linkable.
- Manual faces are never auto-linked and never become compare targets.
- After save, the client refreshes `preview-faces`, selects the returned face id, and lets the existing unlinked-face candidate tray open automatically.

## Exact schema and model plan

### Chosen additive schema change

Extend `public.asset_face_materialization_faces` with:

- `face_source text not null default 'detector'`
- `created_by uuid null references auth.users(id) on delete set null`

Alter existing column:

- `embedding jsonb` becomes nullable

Add checks:

- `face_source in ('detector', 'manual')`
- `face_source <> 'manual' or face_box_normalized is not null`
- `(face_source = 'manual' and embedding is null) or (face_source = 'detector' and embedding is not null)`

No new table is added for manual faces.

### Why this shape is chosen

- `face_source` is the minimum provenance needed to preserve manual rows and exclude them from auto-matching.
- `created_by` preserves actor attribution for the new manual write without redesigning broader audit logging.
- nullable `embedding` prevents fake embedding data for manual faces and makes the auto-matching exclusion enforceable.

### Extra provenance not included in v1

Not added now:

- manual notes
- manual confidence fields
- separate manual-face versioning
- extra export-only metadata

`created_at` already exists. `created_by` is enough for this bounded feature.

### Rank assignment

- Manual faces get `face_rank = max(current face_rank) + 1` within the current materialization.
- Manual faces are appended after detector faces.
- Rank gaps are allowed.
- Contiguous rank renumbering is not required.

### Duplicate and near-duplicate policy

Server policy:

- if IoU with an existing current face is `>= 0.98`, treat the request as idempotent and return the existing face
- if IoU with an existing current face is `>= 0.90` and `< 0.98`, reject with `409 manual_face_overlaps_existing_face`
- otherwise allow insert

This keeps retry behavior safe and blocks obvious duplicate boxes.

### Index and constraint plan

Keep existing:

- unique `(materialization_id, face_rank)`
- existing materialization indexes

No new index is required for v1 because face counts per asset are small and current materialization reads already load faces by `materialization_id`.

## Exact coordinate storage model

### Chosen storage model

- client sends normalized coordinates only
- server validates and stores normalized coordinates in `face_box_normalized`
- server derives and stores raw pixel coordinates in `face_box`
- coordinate space remains tied to the current materialization's source image metadata:
  - `source_image_width`
  - `source_image_height`
  - `source_coordinate_space`

### Chosen request shape

The new create route accepts:

```json
{
  "faceBoxNormalized": {
    "x_min": 0.1,
    "y_min": 0.2,
    "x_max": 0.3,
    "y_max": 0.45
  }
}
```

### UI image-rect boundary

This is mandatory in v1:

- drawing starts only if pointer down occurs inside the actual displayed image rect
- pointer movement is clamped to the displayed image rect
- no draft rectangle can extend into gray or padded container space
- all normalization is relative to the displayed image rect, not the full preview frame

### Pointer math plan

Use existing contained-image math from `face-overlay.ts`:

1. Compute the contained image rect from frame size and natural image size.
2. Convert pointer coordinates into preview-frame-local coordinates.
3. Undo current zoom and pan relative to the frame center.
4. Clamp that base point into the contained image rect.
5. Normalize the clamped base point into `[0, 1]` relative to image rect width and height.
6. Build the draft box from normalized start and end points.

This preserves correct behavior while zoomed or panned.

## Exact draw-mode UI behavior

### Where `+ Add person` lives

Add it in `ProjectAssetPreviewLightbox` within the existing `belowScene` controls area, next to the show-hidden toggle.

Reason:

- keeps the generic `ImagePreviewLightbox` chrome mostly reusable
- keeps preview-specific actions in the preview-specific component
- avoids redesigning the lightbox header API

### Draw mode flow

1. User opens `+ Add person`.
2. Menu shows:
   - `Select face`
   - disabled `Link to entire asset`
3. Choosing `Select face` enters draw mode.
4. While in draw mode:
   - current overlays remain visible
   - overlay activation is disabled
   - pointer pan is disabled
   - current selected face and candidate tray are cleared
5. User drags inside the displayed image to create one draft rectangle.
6. Releasing pointer leaves the draft rectangle in place.
7. User can:
   - `Save face`
   - `Cancel`
8. On save success:
   - refresh preview faces
   - select the new face
   - exit draw mode
   - let the normal unlinked-face candidate tray open automatically

### Resize decision

No resize handles in v1.

If the operator wants a different box before save:

- drag again to replace the draft rectangle
- or cancel and restart

This keeps the interaction bounded and avoids a second pointer-editing mode.

### Minimum usable v1 interaction

- one drag to create a box
- one visible draft box
- save and cancel buttons
- client-side minimum-size guard before enabling save

## Exact validation rules

### Server-side validation

The create helper must validate:

- authenticated project access
- tenant id derived server-side
- asset belongs to tenant and project
- asset is a photo
- asset is `uploaded` and not archived
- current materialization exists, or can be ensured inline
- current materialization has `source_image_width`, `source_image_height`, and `source_coordinate_space`
- normalized coordinates are finite
- `0 <= x_min < x_max <= 1`
- `0 <= y_min < y_max <= 1`
- box area is non-zero
- normalized box lies fully inside the image
- derived raw pixel coordinates lie inside source image bounds
- minimum normalized width and height thresholds are met
- duplicate and high-overlap policy above

Chosen minimum threshold:

- reject if normalized width or height is below `0.02`

The exact threshold can remain a constant in server code and test fixtures.

### Client-side guardrails

The UI should:

- ignore pointer-down outside the displayed image rect
- clamp pointer move inside the displayed image rect
- show no draft box until a valid drag starts inside the image rect
- disable save when the draft box is below minimum size
- clear the draft on cancel

Client-side checks are UX only. Server-side validation remains authoritative.

### Reliability and retry handling

- rank allocation uses `max(face_rank) + 1`
- on unique-rank conflict, reload current faces and retry insert
- exact or near-exact duplicate requests should return the existing face instead of creating a new one

## Exact derivative and thumbnail behavior

### Chosen behavior

- thumbnail generation happens inline in the create route through a narrowly reused helper
- derivative generation is best-effort
- manual face creation succeeds even if thumbnail generation fails

### Helper strategy

Do not redesign the provider pipeline.

Instead:

- extract or add a narrow server helper that can crop a `review_square_256` image from the asset's oriented original source using normalized coordinates
- reuse the existing face-derivative storage naming and persistence pattern already used by `face-materialization.ts`

### Missing-thumbnail fallback

If derivative generation fails:

- `preview-faces` returns `faceThumbnailUrl = null`
- existing preview UI already falls back to generic face or initials presentation
- no extra fallback UI is required in v1

## Exact read, write, and API plan

### New route

Add:

- `POST /api/projects/[projectId]/assets/[assetId]/manual-faces`

Chosen body:

- `faceBoxNormalized` with `x_min`, `y_min`, `x_max`, `y_max`

Chosen response:

```json
{
  "ok": true,
  "created": true,
  "assetId": "asset-id",
  "materializationId": "materialization-id",
  "assetFaceId": "face-id",
  "faceRank": 3,
  "faceSource": "manual"
}
```

If deduped to an existing face:

```json
{
  "ok": true,
  "created": false,
  "assetId": "asset-id",
  "materializationId": "materialization-id",
  "assetFaceId": "existing-face-id",
  "faceRank": 1,
  "faceSource": "detector"
}
```

### New helper

Add a focused server helper, preferably in a new file such as `src/lib/matching/manual-asset-faces.ts`, to:

- ensure or load current photo materialization
- validate box input
- detect duplicates
- allocate rank and insert the manual face row
- best-effort generate and persist a derivative
- return created face metadata

### Existing route changes

`preview-faces`:

- include `faceSource` in each face payload
- otherwise keep current behavior

`preview-candidates`:

- no new route behavior required
- manual faces use the same route
- because manual faces never receive compare rows, they naturally fall back to unscored active consents

`manual-link route`:

- unchanged
- once a manual face exists, it is linked through the existing route exactly like any other face

`hidden-face routes`:

- unchanged
- manual faces use the same hide and restore path

## Exact rematerialization preservation rule

This is mandatory.

### Chosen rule

Detector rematerialization refreshes detector rows but preserves manual rows in the current materialization.

### Concrete write behavior

When `ensureAssetFaceMaterialization(...)` rewrites a photo materialization:

1. Load existing face rows for the current materialization.
2. Split them into:
   - detector rows
   - manual rows
3. Recompute detector rows from provider output using detector ranks `0..n-1`.
4. Reassign preserved manual rows to appended ranks after the refreshed detector max rank, preserving the manual rows' relative order.
5. Delete existing detector rows for that materialization.
6. Update preserved manual rows to their appended ranks if needed.
7. Insert refreshed detector rows with `face_source = 'detector'`.

### Consequences

- manual face ids survive rematerialization
- manual hidden/link/suppression rows tied to manual face ids survive because those face rows are preserved
- detector face ids may still be replaced when detector rows are rebuilt
- durable detector face identity across rematerialization remains out of scope for this feature

### Cleanup behavior

- deleting old detector rows will cascade old detector links, suppressions, hidden rows, and derivatives
- preserved manual rows stay current because they remain on the current materialization id
- no special cleanup is needed for preserved manual rows

### Why this is acceptable in v1

- the product requirement here is preserving manual faces
- the feature does not promise durable identity for detector-created faces across rematerialization
- current repair rematerialization for photos is already bounded and not a broad redesign target in this cycle

## Exact auto-matching exclusion rule for manual faces

This is also mandatory.

### Chosen rule

Only detector-created faces participate in:

- materialized embedding compare
- compare-score persistence
- likely-candidate persistence
- auto reconciliation

Manual faces:

- appear in preview
- can be hidden and restored
- can be manually linked
- never trigger or receive automatic matching work

### Exact affected paths

`materialized-face-compare.ts`:

- filter target asset faces to `face_source = 'detector'`
- ignore any face with missing embedding
- persist compare rows and compare-score rows only for detector faces
- `target_face_count` should reflect detector compare targets only

`auto-match-worker.ts`:

- no new manual-face create flow should enqueue compare jobs
- likely-candidate upserts remain detector-only because compare winners are detector-only

`photo-face-linking.ts`:

- `reconcilePhotoFaceCanonicalStateForAsset(...)` must ignore `face_source = 'manual'` when building auto contenders and desired auto links
- manual faces must still remain eligible for manual linking and hidden-face reads

Manual face create route:

- may ensure current materialization inline if needed for source dimensions
- must not enqueue compare, candidate, or reconcile work beyond the existing manual-link flows

## Hidden-face interaction

No special hidden-face path is added.

Manual faces:

- can be hidden through the existing hidden-face route
- can be restored through the existing hidden-face route
- use the same `asset_face_hidden_states` table
- are excluded from active assignment and auto reconciliation the same way detector faces are

## Post-create UX behavior

### Chosen flow

After a successful create:

1. exit draw mode
2. refresh `preview-faces`
3. keep the returned face selected
4. let the existing unlinked-face candidate tray open automatically

### Why this is chosen

- it maximizes reuse of the current unlinked-face flow
- it keeps the operator in the preview context
- it avoids inventing a special one-off linking dialog for manual faces

## Security and reliability considerations

- protected project access is required
- tenant and project scope are derived server-side
- asset validation is server-side
- client coordinates are never trusted without server validation
- create route uses service-role-backed server logic, not client authority
- existing exact-face linking protections remain unchanged
- derivative failure does not roll back the face row
- duplicate requests are deduped by overlap policy
- rank collision retries handle concurrent create requests
- expired sessions return the existing auth error pattern

## Edge cases

- drawing while zoomed or panned: pointer coordinates are inverse-transformed back into base image space before normalization
- drawing into gray space: ignored on pointer-down and clamped on pointer-move
- no current detected faces on the asset: allowed if materialization metadata can be ensured inline
- existing detected faces already present: manual face is appended after the current max rank
- duplicate or near-duplicate manual face: dedupe or reject according to IoU policy
- thumbnail generation failure: face still exists and remains linkable
- rematerialization after manual face creation: manual rows are preserved and re-appended
- hidden and restored manual face: uses existing hidden-face flow
- immediate linking after creation: uses existing candidate tray and manual-link route

## Test plan

Add focused tests for:

- migration shape:
  - `face_source` default and constraint
  - nullable `embedding`
  - conditional checks for manual faces
- create route validation:
  - rejects out-of-bounds normalized boxes
  - rejects zero-area boxes
  - rejects too-small boxes
  - rejects asset outside tenant or project
  - rejects non-photo or non-uploaded asset
- image-rect-only UI behavior:
  - pointer down outside image rect does not start a draft
  - draft coordinates clamp to contained image rect while zoomed and panned
- persisted coordinates:
  - normalized values stored exactly
  - raw pixel box derived correctly from source dimensions
- appended rank behavior:
  - manual face rank is max plus one
  - concurrent rank collision retries do not create duplicate ranks
- duplicate handling:
  - exact duplicate returns existing face idempotently
  - very high overlap rejects with conflict
- preview visibility:
  - created manual face appears in `preview-faces`
  - `faceSource` is returned as `manual`
- thumbnail fallback:
  - create succeeds when derivative generation fails
  - preview returns `faceThumbnailUrl = null`
- candidate flow reuse:
  - after create and refresh, the manual face can use the same candidate route and manual-link route
- hidden-face behavior:
  - manual face can be hidden and restored through existing routes
- rematerialization preservation:
  - manual rows survive detector rematerialization
  - preserved manual rows are re-appended after detector rows
- tenant and project scope enforcement:
  - no cross-tenant or cross-project create allowed
- auto-matching exclusion:
  - manual faces do not enter `asset_consent_face_compare_scores`
  - manual faces do not become `winning_asset_face_id` in compare rows
  - manual faces do not produce likely candidates
  - manual faces do not become auto reconciliation contenders

## Implementation phases

### Phase 1: Schema and model changes

- add migration for `face_source`, `created_by`, and nullable `embedding`
- update TypeScript row types and read helpers
- update `face-materialization.ts` to preserve manual rows across detector rematerialization
- update compare and reconcile helpers to understand `face_source`

### Phase 2: Manual face create route and helper

- add `manual-asset-faces` server helper
- add `POST /api/projects/[projectId]/assets/[assetId]/manual-faces`
- implement validation, dedupe policy, rank allocation retry, and insert
- add best-effort derivative generation and persistence

### Phase 3: Preview draw mode UI

- extend `ImagePreviewLightbox` with bounded draw-mode props and pointer handling
- reuse contained-image rect math for draw clamping and normalization
- add `+ Add person` menu and disabled `Link to entire asset`
- add save and cancel flow for the draft box

### Phase 4: Post-create preview integration

- refresh preview after create
- select returned face id
- let existing candidate tray open automatically
- keep manual faces compatible with hide and restore actions

### Phase 5: Tests and polish

- add migration and helper tests
- add create route tests
- add preview integration tests
- add rematerialization preservation tests
- add explicit auto-matching exclusion tests

## Scope boundaries

Still out of scope after this plan:

- real `Link to entire asset` backend
- zero-face fallback redesign
- full box editing toolkit
- durable detector face identity across rematerialization
- broader matching-system redesign
- automatic matching for manual faces

## Concise implementation prompt

Implement Feature 047 by keeping manual faces in `asset_face_materialization_faces`, adding `face_source` plus actor provenance, allowing manual faces to store normalized and derived raw boxes without embeddings, and creating one new asset-centric create route for manual face insertion. Extend the asset preview with a bounded draw mode that only operates inside the actual displayed image rect, disables pan while drawing, supports confirm and cancel, refreshes preview faces after save, selects the new face, and reuses the existing unlinked-face candidate and manual-link flows. Preserve manual rows across detector rematerialization, but explicitly exclude `face_source = manual` from compare-score generation, likely-candidate generation, and auto reconciliation.
