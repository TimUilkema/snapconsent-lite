# Feature 047 Research: Manual Face Box Creation in Asset Preview

## Goal

Research how to let a staff user manually draw a face bounding box in the asset preview when automatic face detection missed a person, so the system can create a new face instance for that asset and treat it like other exact faces for later linking.

This research is code-first. Current repository code and schema are the source of truth. The feature must stay bounded, reuse the current exact-face linking and preview overlay model where possible, and keep `Link to entire asset` explicitly out of scope beyond minimal placeholder UX.

## Inputs reviewed

Requested docs, in order:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/031-one-consent-per-face-precedence-rules/research.md`
- `docs/rpi/031-one-consent-per-face-precedence-rules/plan.md`
- `docs/rpi/032-face-consent-linking-ui-improvements/research.md`
- `docs/rpi/032-face-consent-linking-ui-improvements/plan.md`
- `docs/rpi/033-asset-face-overlays-and-confidence/research.md`
- `docs/rpi/033-asset-face-overlays-and-confidence/plan.md`
- `docs/rpi/044-asset-preview-linking-ux-improvements/research.md`
- `docs/rpi/044-asset-preview-linking-ux-improvements/plan.md`
- `docs/rpi/045-asset-preview-unlinked-faces-and-hidden-face-suppression/research.md`
- `docs/rpi/045-asset-preview-unlinked-faces-and-hidden-face-suppression/plan.md`

`<NEXT_ID>` resolves to `047` because `docs/rpi/046-template-editor-live-preview-and-layout-builder/` is the highest existing numbered folder.

Live implementation verified directly:

- `src/components/projects/assets-list.tsx`
- `src/components/projects/project-asset-preview-lightbox.tsx`
- `src/components/projects/previewable-image.tsx`
- `src/components/projects/photo-link-review-dialog.tsx`
- `src/lib/client/face-overlay.ts`
- `src/lib/matching/asset-preview-linking.ts`
- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/consent-photo-matching.ts`
- `src/lib/matching/face-materialization.ts`
- `src/lib/matching/materialized-face-compare.ts`
- `src/lib/matching/auto-matcher.ts`
- `src/lib/matching/providers/compreface.ts`
- `src/lib/project-export/project-export.ts`
- `src/app/api/projects/[projectId]/assets/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/preview-faces/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/preview-candidates/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/hidden-faces/[assetFaceId]/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/links/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/[assetId]/manual-link-state/route.ts`
- `supabase/migrations/20260320140000_019_face_materialization_pipeline.sql`
- `supabase/migrations/20260403170000_031_face_level_photo_linking.sql`
- `supabase/migrations/20260404110000_032_face_review_sessions_and_derivatives.sql`
- `supabase/migrations/20260409110000_045_asset_face_hidden_states.sql`
- `supabase/migrations/20260410113000_046_asset_consent_face_compare_scores.sql`
- `tests/feature-019-face-materialization-pipeline.test.ts`
- `tests/feature-031-one-consent-per-face-precedence-rules.test.ts`
- `tests/feature-032-face-consent-linking-ui-improvements.test.ts`
- `tests/feature-044-asset-preview-linking-ux-improvements.test.ts`
- `tests/feature-045-asset-preview-unlinked-faces-and-hidden-face-suppression.test.ts`

## Verified current behavior

- Feature 045 is live. The asset preview now loads all current asset faces, not only linked faces, and shows `linked_manual`, `linked_auto`, `unlinked`, and `hidden` states.
- There is no current shipped `+ Add person`, `Select face`, or `Link to entire asset` UI. No existing production path was found for manually creating a face row on an asset.
- Current face identity across preview, exact-face linking, hidden-face state, candidate ranking, compare evidence, and export is `asset_face_materialization_faces.id`.
- Current face rows are materialization-scoped. The live write path is `ensureAssetFaceMaterialization(...)` in `src/lib/matching/face-materialization.ts`, which inserts the materialization row, inserts face rows, and best-effort persists face derivatives.
- Current manual link behavior is already face-specific. `POST /api/projects/[projectId]/consents/[consentId]/assets/links` can assign a specific `assetFaceId`, and current unlink, replace, suppression, and hidden-face behavior are all keyed by that face id.
- Preview overlay rendering already uses normalized face coordinates and a shared transform layer that handles resize, zoom, and pan.
- Hidden faces are first-class current-face state. They are excluded from active exact-face linking, excluded from auto reconciliation, still returned to preview, and can be restored.
- Current cleanup is materialization-aware. Stale face links, suppressions, and hidden-face rows are cleaned or inactivated when the current materialization changes.

## Current schema, routes, and components involved

### Face and derivative schema

- `asset_face_materializations`
- `asset_face_materialization_faces`
- `asset_face_image_derivatives`
- `asset_consent_face_compares`
- `asset_consent_face_compare_scores`
- `asset_consent_match_candidates`

### Canonical exact-face linking and suppression schema

- `asset_face_consent_links`
- `asset_face_consent_link_suppressions`
- `asset_face_hidden_states`
- `asset_consent_manual_photo_fallbacks`
- `asset_consent_manual_photo_fallback_suppressions`

### Current preview and linking routes

- `GET /api/projects/[projectId]/assets/[assetId]/preview-faces`
- `GET /api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/preview-candidates`
- `POST /api/projects/[projectId]/assets/[assetId]/hidden-faces/[assetFaceId]`
- `DELETE /api/projects/[projectId]/assets/[assetId]/hidden-faces/[assetFaceId]`
- `POST /api/projects/[projectId]/consents/[consentId]/assets/links`
- `DELETE /api/projects/[projectId]/consents/[consentId]/assets/links`
- `GET /api/projects/[projectId]/consents/[consentId]/assets/[assetId]/manual-link-state`

### Current preview components and helpers

- `AssetsList`
- `ProjectAssetPreviewLightbox`
- `ImagePreviewLightbox`
- `PreviewImageFaceOverlayLink`
- `getFaceOverlayStyle(...)`
- `transformPreviewOverlayStyle(...)`

## 1. Current face identity and materialization model

Current asset faces are represented by:

- `asset_face_materializations`: one current materialization row per `(tenant_id, project_id, asset_id, materializer_version)`
- `asset_face_materialization_faces`: one row per face in that materialization, unique by `(materialization_id, face_rank)`

Verified current behavior:

- Face ids are database row ids from `asset_face_materialization_faces.id`.
- Face rank is currently assigned by the materializer result as `faceRank` and stored as `face_rank`.
- Current materialization is determined by the current row in `asset_face_materializations` for the active materializer version.
- Face thumbnails are stored in `asset_face_image_derivatives`; the current pipeline generates review crops during materialization and persists them best-effort.
- The current provider path already preserves both source image dimensions and normalized coordinates:
  - `asset_face_materializations.source_image_width`
  - `asset_face_materializations.source_image_height`
  - `asset_face_materializations.source_coordinate_space`
  - `asset_face_materialization_faces.face_box`
  - `asset_face_materialization_faces.face_box_normalized`
- The current production write path for face rows is detector/materializer-driven. No live route or helper was found that creates a current face row from a staff-drawn manual box.

Implication:

- A manual face should reuse `asset_face_materialization_faces.id` as its identity if possible, because every current downstream read already expects that id shape.

## 2. Current asset preview capabilities

Current preview architecture:

- `AssetsList` owns selected asset state and opens `ProjectAssetPreviewLightbox`.
- `ProjectAssetPreviewLightbox` fetches preview faces, manages hovered and selected face state, show-hidden toggle state, candidate tray state, and hide/restore actions.
- `ImagePreviewLightbox` owns image measurement, zoom, pan, wheel behavior, and overlay scene rendering.
- `getFaceOverlayStyle(...)` converts normalized box coordinates into pixel positions in the displayed image area.
- `transformPreviewOverlayStyle(...)` reapplies those overlay boxes into the zoomed and panned lightbox viewport.

Verified behavior relevant to draw mode:

- The current overlay engine already works in normalized coordinates and on top of the measured image scene.
- Hovered and selected overlay state are already separate from the geometry helpers, so a temporary draft rectangle can be added without redesigning overlay math.
- The current lightbox does pointer-based pan when zoomed. A draw-box mode would need to temporarily gate or override that pointer handling while drawing or resizing.
- Current selection and hover state can coexist with a draw mode as additive UI state in `ProjectAssetPreviewLightbox`, but draw mode cannot share the same pointer path as pan at the same time.

Bounded conclusion:

- The existing preview can support a temporary draw rectangle mode without replacing the overlay engine. It needs additive state, a draft box overlay, and explicit interaction gating while draw mode is active.

## 3. Current canonical exact-face linking model

Current canonical exact-face link table:

- `asset_face_consent_links`

Current invariants verified from migration 031 and live linking code:

- Primary key is `asset_face_id`, so one face can map to only one consent.
- Unique `(tenant_id, project_id, asset_id, consent_id)`, so one consent can occupy only one face on the same asset.
- `link_source` distinguishes `manual` vs `auto`.
- Manual link and unlink operations create or remove rows in `asset_face_consent_links` and create suppressions in `asset_face_consent_link_suppressions` where needed.
- Hidden faces are handled separately by `asset_face_hidden_states`, not by changing face identity.
- Auto reconciliation works over current active, non-hidden face ids and honors suppressions and manual precedence.

Bounded conclusion:

- A manually created face instance can fit the current exact-face model without special-case linking semantics if it becomes a normal current `asset_face_materialization_faces` row with a stable `asset_face_id`.

## 4. Where a manually drawn face should be stored

### Option A: Store manual faces in `asset_face_materialization_faces` with a source marker

Pros:

- Best compatibility with current overlay reads, because preview already loads current faces from this table.
- Best compatibility with exact-face linking, hidden-face state, compare rows, and export, all of which already key by `asset_face_id`.
- Keeps one shared exact-face model. A manual face can behave like any other current face after creation.
- Hidden-face behavior from Feature 045 can remain unchanged if manual faces have normal `asset_face_id` rows.
- Best fit for future export and DAM bounding box usage because the exported face list already comes from current materialized faces.

Cons:

- Current materialization write path assumes face rows are provider output. It does not distinguish detector faces from preserved manual faces.
- Rematerialization becomes the key risk. A detector rerun could delete, overwrite, or orphan manual rows unless the write path changes to preserve them.
- Current uniqueness by `(materialization_id, face_rank)` means manual rank assignment must avoid collisions with detector ranks.

### Option B: Create a separate manual-face table and union it into current reads

Pros:

- Manual faces can survive rematerialization without changing the provider write path much.
- Clear source separation between detector-created and manual-created faces.

Cons:

- Requires union logic in preview face reads, hidden-face handling, exact-face linking reads, candidate ranking, export, cleanup, and possibly compare-score reads.
- Introduces dual identity semantics for "current asset faces" unless more code is adapted to treat both sources uniformly.
- Makes Feature 045 hidden-face support more complex because hidden state is currently keyed to one face table.
- Higher risk of subtle regressions because many current helpers assume `asset_face_id` comes from `asset_face_materialization_faces`.

### Option C: Add a separate manual-face table plus a projection or sync into the current face table

Pros:

- Could preserve clear provenance while still letting downstream systems read one current face table shape.

Cons:

- More moving pieces than this feature needs.
- Risks becoming a redesign of current materialization modeling.
- Hard to justify for a bounded v1 when no existing projection layer exists.

### Recommendation

Recommend Option A:

- Keep manual faces in `asset_face_materialization_faces`.
- Add an explicit source marker such as `face_source` with values like `detector` and `manual`.
- Treat manually created rows as current faces in the same materialization as detector faces.
- Update later plan to preserve `face_source = manual` rows across detector rematerialization instead of recreating a second current-face model.

This is the smallest path that preserves current exact-face semantics and minimizes read-path churn.

## 5. Bounding box coordinate format

Verified current model:

- Overlay rendering uses normalized coordinates.
- Provider materialization persists both raw `face_box` and `face_box_normalized`.
- Source image dimensions and coordinate space are already stored on the materialization row.
- Export includes both `face_box` and `face_box_normalized`, which is useful for downstream consumers.

Evaluation:

- Normalized coordinates are the safest canonical persisted format for manual creation because preview overlays, responsive rendering, zoom/pan transforms, and future export to different display sizes all depend on scale-independent coordinates.
- Raw pixel coordinates are still useful when the source image dimensions are known and when later systems want exact pixel-space crops or export fidelity.
- Current architecture already has both shapes, so manual faces should not introduce a new coordinate convention.

Recommendation:

- Persist normalized coordinates as the canonical manual input.
- Also persist pixel-space `face_box` derived server-side from normalized coordinates and the current materialization's source image dimensions.
- Reuse the existing `source_coordinate_space` from the current materialization, which is already `oriented_original` in the live provider path.

Bounded conclusion:

- The smallest safe storage model is "normalized box plus derived raw pixel box", not normalized-only and not raw-only.

## 6. Face thumbnail and materialization behavior

Verified current behavior:

- Face derivative generation is currently tied to materialization work in `ensureAssetFaceMaterialization(...)`.
- The provider already knows how to crop a review image from the oriented original image using normalized coordinates.
- Derivative persistence is already best-effort. If upload or database persistence fails, the face row still exists.
- No generic live helper was found that takes an arbitrary persisted face row and later generates a derivative independently of the materialization path.

Evaluation:

- Requiring thumbnail success before creating the manual face would be stricter than the current detector path.
- Delaying manual face creation until a larger asynchronous rematerialization job runs would make the UX worse and complicate immediate linking.
- The smallest safe behavior is to create the face row immediately, then best-effort generate a review crop using the same source image and normalized-box crop logic.

Recommendation:

- Manual face creation should persist the face row first.
- The server should then attempt to generate and persist a face derivative immediately or through a narrowly extracted helper reused from the current crop generation path.
- Thumbnail failure should not roll back face creation. The manual face should still appear and remain linkable.
- The later plan can decide whether this crop generation happens inline in the route or via a queued job, but the behavior should remain best-effort and non-blocking for data correctness.

## 7. Manual face source semantics

Verified current schema:

- `asset_face_consent_links.link_source` distinguishes manual vs auto link provenance.
- `asset_face_materialization_faces` does not currently distinguish detector-created vs manual-created face provenance.

Recommendation:

- Add a face-level source marker on `asset_face_materialization_faces`, such as `face_source`.
- Keep it bounded to the values needed now, for example `detector` and `manual`.
- Do not expose a large new UI taxonomy in v1. A subtle UI badge is optional; core behavior matters more than visible provenance.
- Preserve the distinction in schema because future matching and rematerialization logic will need to treat manual faces as operator-created and not subject to detector cleanup rules.

Bounded conclusion:

- A new face-level source field is justified. Reusing link-source semantics is not enough because a face can exist before it is linked.

## 8. Integration with current preview and linking UX

Verified current preview behavior:

- `getAssetPreviewFaces(...)` already returns all current faces with current hidden and link state.
- Unlinked current faces already appear in preview and can open current candidate/linking flows.
- Candidate ranking already works per `asset_face_id`.

Recommendation:

- After creation, the manual face should appear immediately in the current preview overlay list.
- It should behave like an unlinked detected face, except its face source is `manual`.
- It should reuse the same exact-face candidate picker and linking flow as any other unlinked face.
- Opening the candidate tray immediately after save is a product decision, not a schema requirement. It fits the current UX well and is likely the best default, but the plan phase should make that explicit.

Strong preference:

- Reuse the exact same preview and linking flow after creation instead of designing a separate "manual face linking" flow.

## 9. Interaction design for drawing

Current bounded v1 flow:

- Add `+ Add person` in the asset preview toolbar or face actions area.
- Open a small menu with:
  - `Select face`
  - `Link to entire asset`
- `Select face` enters draw mode.
- In draw mode:
  - existing overlays stay visible
  - pan is temporarily disabled while drawing or resizing
  - user drag creates a draft rectangle over the image
  - draft box is shown using the same overlay coordinate system
  - user can confirm save or cancel

Recommended minimum v1:

- Start drawing with pointer drag on the image.
- Normalize the box automatically to top-left plus width/height.
- Require confirm and cancel controls outside the box rather than relying on implicit save.
- Allow basic resize before save if it can be added without major complexity.
- Do not require advanced snapping behavior.
- Use the existing measured image and normalized overlay math so drawing while zoomed or panned still resolves into normalized coordinates in the actual image space.

Bounded conclusion:

- V1 does not need a full vector editor. A single draft rectangle with confirm and cancel is sufficient.

## 10. Validation rules for manual face creation

Server-side validation should include at minimum:

- derive tenant and project scope from the authenticated server session
- validate the asset belongs to the current tenant and project
- validate the asset is a photo and upload-complete
- validate there is a current materialization or create one first so source dimensions and coordinate space are known
- validate normalized coordinates are finite numbers
- validate `x`, `y`, `width`, and `height` are within `[0, 1]` after normalization
- validate non-zero area
- validate the full box lies inside image bounds after normalization
- validate a minimum width and height threshold to reject tiny unusable boxes
- validate derived pixel coordinates remain inside source image dimensions
- validate the request is idempotent enough to avoid duplicate inserts on simple retries

Duplicate handling:

- Exact duplicate or near-duplicate detection is useful but should stay bounded.
- The safest v1 server behavior is to reject an obviously duplicate current face box for the same asset if IoU is extremely high against an existing current face, especially another manual face.
- The later plan can choose whether near-duplicates are rejected or allowed with operator confirmation. Hard duplicate prevention is the minimum useful guard.

## 11. Effect on current face ranking and order

Verified current behavior:

- Preview face ordering uses `face_rank`.
- Current schema only requires rank uniqueness inside one materialization.
- Nothing found that requires detector ranks to be contiguous beyond ordered display and stable identity within the current materialization.

Recommendation:

- Manual faces should receive a new `face_rank` appended after the current maximum rank in that materialization.
- Ranks do not need to be renumbered.
- Appending is the smallest compatible rule and avoids disturbing existing detector-face order.

Bounded conclusion:

- Use append-only rank assignment for manual faces.

## 12. Effect on current matching and candidate logic

Current exact-face linking:

- Manual faces can participate immediately if they have normal `asset_face_id` rows.

Current hidden-face logic:

- Hidden-face support should apply unchanged if manual faces share the same current face table.

Current candidate ranking:

- Candidate ranking in `getAssetPreviewFaceCandidates(...)` reads:
  - `asset_consent_face_compare_scores`
  - then `asset_consent_face_compares`
  - then `asset_consent_match_candidates`
  - then remaining active signed consents
- A newly created manual face will not have compare-score rows immediately unless later comparison work runs for it.

Recommendation:

- Manual faces should participate in the current exact-face preview model immediately.
- They should be eligible for future compare evidence and candidate ranking once compare jobs or rescoring touch them.
- Until compare evidence exists, the current fallback candidate behavior is already acceptable.
- Manual faces should not be treated as stale detector noise by auto cleanup or rematerialization.

Important bounded rule:

- Creating a manual face because detection missed a person means later detector reruns must not delete or override that face just because the provider still does not detect it.

## 13. Rematerialization and cleanup implications

This is the highest-risk area.

Verified current behavior:

- Current materialization writes are detector-result driven.
- Current cleanup logic in `cleanupCurrentPhotoStateForAsset(...)` and related helpers assumes current faces are tied to the current materialization.
- Stale current-face links, suppressions, and hidden rows are cleaned when the asset's current materialization changes.

Risk:

- If manual faces live in `asset_face_materialization_faces` but rematerialization rewrites that materialization from detector output only, manual faces can be lost or treated as stale.

Bounded recommendation:

- Preserve manual faces inside the current materialization instead of creating a second face model.
- Later plan should explicitly change rematerialization behavior so detector refreshes merge detector faces into the current materialization while preserving `face_source = manual` rows.
- Manual faces should never be removed solely because detector output omitted them.
- Cleanup should continue to remove stale rows tied to replaced materializations, but preserved manual rows must stay in the current materialization and therefore stay current.

Implication:

- The plan phase must define a "manual faces survive rematerialization" rule as part of the materialization write path. This is not optional if Option A is chosen.

## 14. Hidden-face interaction

Verified current behavior:

- Hidden-face state is modeled independently in `asset_face_hidden_states`.
- Hidden faces are excluded from active assignment and auto reconciliation, but can still be shown in preview and restored.

Recommendation:

- Manual faces should use the exact same hidden-face mechanism.
- A manual face should be hideable and restorable exactly like a detector face.
- If a user manually adds a face and then hides it, preview and reconciliation should behave exactly as they do for detector faces.

Bounded conclusion:

- One shared hidden-face model is both practical and strongly preferred.

## 15. `Link to entire asset` placeholder boundary

Out of scope:

- backend modeling
- fallback-link redesign
- zero-face/manual-photo linking expansion
- asset-wide consent semantics

Minimal treatment recommended for this cycle:

- Show `Link to entire asset` in the `+ Add person` menu only as a disabled or placeholder action.
- If clicked, it can show a small "not yet available" note if product wants visible affordance.
- No backend route or deeper design should be added in this research cycle.

## 16. Security and authorization

Current code already establishes the correct trust boundary:

- tenant id is derived server-side through the authenticated session
- project membership and asset lookup are validated server-side
- preview and link routes use server-side tenant-scoped queries
- clients do not provide trusted tenant authority

Manual face creation must preserve that model:

- derive tenant and project server-side
- validate asset scope server-side
- validate box coordinates server-side
- keep the route behind protected project access
- do not trust client-provided tenant or project identity beyond route parameters validated against the session

## 17. Edge cases the plan phase must handle

- very small face boxes: reject with minimum size validation
- partially outside image: reject server-side after normalization
- duplicate boxes on the same face: reject obvious duplicates or near-identical overlaps
- drawing while zoomed or panned: map draft coordinates through the existing image-space transform, not viewport-space pixels
- manual face on asset with existing detected faces: append a new face rank and show it alongside detector faces
- manual face on asset with no detected faces: still allow it if the asset can be materialized enough to know image dimensions and coordinate space
- rematerialization after manual face creation: preserve manual rows
- manual face with failed thumbnail generation: keep the face row and allow linking
- hidden and restored manual face: use the same hidden-face flow
- later linking of the created manual face: reuse the current unlinked-face candidate and manual link flow

## 18. Options considered and recommended bounded direction

### Recommended bounded direction

- Add `+ Add person` to the asset preview.
- Offer `Select face` and placeholder `Link to entire asset`.
- Implement only `Select face`.
- Persist the manual face into `asset_face_materialization_faces` with a new face-level source marker.
- Persist normalized coordinates as canonical input and derive pixel coordinates server-side.
- Append manual `face_rank` after the current max rank.
- Best-effort generate a face derivative without making derivative success a transaction requirement.
- Reuse the current preview overlay list, hidden-face behavior, exact-face candidate picker, and manual-link flows.
- Preserve manual rows across rematerialization by changing the materialization write path to merge detector output with existing manual rows instead of replacing them.

### Why this is bounded

- It extends the existing current-face model instead of creating a second one.
- It preserves current exact-face linking invariants.
- It keeps `Link to entire asset` out of scope.
- It avoids redesigning the full face materialization pipeline while still acknowledging the one required preservation rule for manual rows.

## Current constraints and invariants

- Tenant scoping must be enforced in every query and mutation.
- Current exact-face identity is `asset_face_id`.
- One consent can occupy at most one face per asset.
- One face can have at most one linked consent.
- Hidden faces must not participate in active assignment or auto reconciliation.
- Manual exact-face links take precedence over auto links.
- Current overlay rendering expects normalized boxes.
- Current export already depends on materialized face rows and their coordinate fields.

## Risks and tradeoffs

- The main risk is rematerialization. Storing manual faces in the current face table is the best read-model fit, but only if the write path preserves them.
- Adding a separate manual-face table would reduce write-path pressure but would spread complexity across preview, linking, hidden-face logic, export, and cleanup.
- Immediate derivative generation improves UX, but making it required would be stricter than current detector behavior and create unnecessary failure coupling.
- Duplicate-box handling can become overdesigned quickly. V1 should limit itself to clear duplicate protection, not fuzzy dedupe heuristics.
- Showing manual provenance in UI may be useful later, but it is not required for the first bounded iteration.

## Explicit open decisions for the plan phase

- Should manual faces live directly in `asset_face_materialization_faces` with `face_source = manual`, or is there a stronger reason to accept a separate-table union model?
- Is normalized plus derived raw pixel storage sufficient, or is there any live consumer that would force additional coordinate metadata on the face row itself?
- Should thumbnail generation happen inline in the create route or through a queued helper, given the current best-effort derivative semantics?
- Exactly how should rematerialization preserve manual faces while refreshing detector faces in the same materialization?
- Should server-side duplicate protection reject only exact duplicates, or also very-high-overlap near-duplicates?
- Should the UI open the candidate picker automatically after manual face save, or just select the new face and let the user proceed?
- What is the minimum resize/edit affordance needed before save in draw mode?
- Should `Link to entire asset` be disabled in the menu or shown as a clickable placeholder with a short note?
