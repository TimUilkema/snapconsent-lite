# Feature 045 Research: Asset Preview Unlinked Faces, Candidate Linking, and Hidden Face Suppression

## Goal

Research how to extend the asset preview so it can:

- show all detected current faces, not only current linked faces
- let an operator manually link an unlinked detected face to a consent/person from ranked candidates
- let an operator hide and later restore a bad or irrelevant detected face
- ensure hidden faces stop affecting active asset-level matching UX

This research is code-first. Current repository code and schema are the source of truth.

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

`<NEXT_ID>` resolves to `045` because `docs/rpi/044-asset-preview-linking-ux-improvements/` is the highest existing numbered folder.

Live implementation verified directly:

- `src/components/projects/assets-list.tsx`
- `src/components/projects/previewable-image.tsx`
- `src/components/projects/project-asset-preview-lightbox.tsx`
- `src/components/projects/photo-link-review-dialog.tsx`
- `src/components/projects/consent-asset-matching-panel.tsx`
- `src/lib/client/face-overlay.ts`
- `src/lib/matching/asset-preview-linking.ts`
- `src/lib/matching/consent-photo-matching.ts`
- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/face-review-response.ts`
- `src/lib/matching/face-review-sessions.ts`
- `src/lib/matching/face-materialization.ts`
- `src/lib/matching/materialized-face-compare.ts`
- `src/lib/matching/auto-match-worker.ts`
- `src/app/api/projects/[projectId]/assets/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/preview-links/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/preview-link-candidates/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/links/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/matchable/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/[assetId]/manual-link-state/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/review-sessions/[sessionId]/items/[itemId]/actions/route.ts`

Relevant migrations and tests verified directly:

- `supabase/migrations/20260307120000_012_auto_match_likely_candidates.sql`
- `supabase/migrations/20260320140000_019_face_materialization_pipeline.sql`
- `supabase/migrations/20260403170000_031_face_level_photo_linking.sql`
- `supabase/migrations/20260404110000_032_face_review_sessions_and_derivatives.sql`
- `supabase/migrations/20260404120000_032_face_derivative_storage.sql`
- `tests/feature-031-one-consent-per-face-precedence-rules.test.ts`
- `tests/feature-032-face-consent-linking-ui-improvements.test.ts`
- `tests/feature-044-asset-preview-linking-ux-improvements.test.ts`

## Verified current behavior

- Feature 044 is live in the workspace and gives the asset preview a linked-face strip, a right-side consent panel, remove-link, and change-person.
- The current asset preview only renders exact current linked faces. It does not load all detected faces for the asset.
- The consent-centric review flow already knows all detected faces for one asset via `manual-link-state`, but that route is scoped to one consent and can trigger direct materialization work.
- Current manual link semantics are already face-specific. If the UI has a current `assetFaceId`, the existing `POST /api/projects/[projectId]/consents/[consentId]/assets/links` route can directly assign that face.
- Current remove/suppress semantics are consent-specific, not face-hidden-global. The repo has face/consent suppressions and zero-face fallback suppressions, but no way to hide a detected face itself.
- The current asset-preview candidate picker is asset-level and unranked. It returns active consents for the asset, plus same-asset link metadata, but no similarity score and no per-face ranking.

## Current schema, routes, and components involved

### Current detected-face and compare schema

- `asset_face_materializations`
- `asset_face_materialization_faces`
- `asset_face_image_derivatives`
- `asset_consent_face_compares`
- `asset_consent_match_candidates`

### Current canonical link and suppression schema

- `asset_face_consent_links`
- `asset_face_consent_link_suppressions`
- `asset_consent_manual_photo_fallbacks`
- `asset_consent_manual_photo_fallback_suppressions`

### Current preview and linking routes

- `GET /api/projects/[projectId]/assets`
- `GET /api/projects/[projectId]/assets/[assetId]/preview-links`
- `GET /api/projects/[projectId]/assets/[assetId]/preview-link-candidates`
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

## 1. Current detected-face model

Current detected faces on project assets are represented by:

- `asset_face_materializations`: one current materialization row per `(tenant_id, project_id, asset_id, materializer_version)`
- `asset_face_materialization_faces`: one row per detected face in that materialization, unique by `(materialization_id, face_rank)`

Current vs stale:

- "Current" is not a boolean on the face row.
- Currentness is derived by loading the photo materialization for the configured materializer version via `loadCurrentAssetFaceMaterialization(...)` and related helpers.
- Face links and face/consent suppressions tied to old `asset_materialization_id` values are cleaned by `cleanupCurrentPhotoStateForAsset(...)`.

Data currently available per detected face:

- stable-in-current-materialization face id: `asset_face_materialization_faces.id`
- `face_rank`
- `provider_face_index`
- `detection_probability`
- `face_box`
- `face_box_normalized`
- `embedding`
- face crop derivatives in `asset_face_image_derivatives` keyed by `asset_face_id`

Candidate or score data is not stored on the face row itself. It is stored per asset/consent pair in:

- `asset_consent_face_compares` with `winning_asset_face_id`, `winning_asset_face_rank`, `winning_similarity`
- `asset_consent_match_candidates` with `confidence`, `winning_asset_face_id`, `winning_asset_face_rank`

Current preview access boundary:

- asset preview routes currently have access only to current linked exact faces
- consent-centric review routes have access to all detected faces for one consent/asset pair

## 2. Current preview overlay boundary

Current preview loading path:

- `GET /api/projects/[projectId]/assets` returns `linkedFaceOverlays[]` for the grid and initial preview
- `GET /api/projects/[projectId]/assets/[assetId]/preview-links` returns richer data for the selected asset, but still only current linked exact faces

What the preview knows today:

- `assetFaceId`
- `faceRank`
- `faceBoxNormalized`
- `consentId`
- consent summary
- `linkSource`
- `matchConfidence`

What it does not know today:

- unlinked detected faces
- hidden faces
- per-face ranked candidates
- face-hidden state

Overlay rendering can support a mixed set of manual linked, auto linked, and unlinked detected faces without changing the geometry math:

- `getFaceOverlayStyle(...)` only needs a normalized face box
- `ImagePreviewLightbox` already handles hover, selected overlay, zoom, pan, and overlay transforms

What would need additive UI work:

- current overlay payload assumes `href`, label, and linked-person styling
- unlinked faces need a neutral overlay/card variant and local click handling instead of consent navigation

Conclusion:

- overlay math can be reused as-is
- overlay payload and preview-local state need additive face-state variants

## 3. Current candidate and match-score sources

There is no current asset-preview route that returns ranked candidate people for one selected asset face.

What exists today:

- `asset_consent_match_candidates`
  - persisted review-band candidates
  - keyed by `(asset_id, consent_id)`
  - stores `confidence`
  - stores `winning_asset_face_id` and `winning_asset_face_rank`
- `asset_consent_face_compares`
  - persisted compare evidence for current materialization pairs
  - stores `winning_similarity`
  - stores `winning_asset_face_id` and `winning_asset_face_rank`
- `GET /api/projects/[projectId]/consents/[consentId]/assets/matchable?mode=likely`
  - consent-centric
  - returns one consent's likely assets with `candidateAssetFaceId` and `candidateFaceRank`
- `GET /api/projects/[projectId]/assets/[assetId]/preview-link-candidates`
  - asset-centric
  - returns all non-revoked signed consents for the project
  - includes headshot thumbnail and `currentAssetLink`
  - does not return similarity scores
  - does not rank by face similarity

Important current limit:

- `asset_consent_match_candidates` only persists rows in the review band
- above-threshold rows become canonical links and candidate rows are deleted
- some eligible consents may have no current compare row yet

So descending similarity is:

- available when current compare evidence exists for that consent/face
- sometimes available, not guaranteed for every linkable consent
- not surfaced by any current per-face preview route

Recommended fallback when scores are unavailable:

- append unscored but otherwise linkable consents using a deterministic secondary order
- the current repo precedent is `signed_at desc` in `getAssetPreviewLinkCandidates(...)`

## 4. Current linking semantics for unlinked detected faces

The current canonical manual-link route can already link a currently unlinked detected face directly.

Verified behavior in `manualLinkPhotoToConsent(...)`:

- validates tenant and project scope server-side
- requires the consent to belong to the project
- blocks revoked consents
- validates the asset belongs to the project and is upload-complete
- validates the `assetFaceId` belongs to the current materialization
- defaults to the only face when exactly one face exists
- requires explicit `assetFaceId` when multiple faces exist
- preserves manual-over-auto precedence
- enforces one face per consent per asset
- handles replacement by reusing the same canonical write flow
- writes consent-specific suppressions when a current assignee is displaced

Conclusion:

- save/confirm for linking an unlinked detected face can reuse the existing `POST /consents/[consentId]/assets/links` route
- no new backend write operation is required for manual face linking itself

## 5. Current suppression and hide model

The repo currently has no concept of hiding or suppressing a detected face itself.

What exists:

- `asset_face_consent_link_suppressions`
  - scope: one face plus one consent
  - reasons: `manual_unlink`, `manual_replace`
- `asset_consent_manual_photo_fallback_suppressions`
  - scope: one zero-face asset plus one consent
  - reason: `manual_unlink`
- review-session `suppress_face`
  - not a global face hide
  - it just calls `manualUnlinkPhotoFromConsent(...)` for the current consent, which creates a face/consent suppression

What does not exist:

- hidden face table
- ignored face table
- excluded materialized face state
- inactive overlay state for detected faces independent of consent

## 6. Cleanest bounded domain model for hidden faces

The cleanest bounded model is a new separate face-level hidden-state table keyed by the current materialized face, not a new column on `asset_face_materialization_faces`.

Why a separate table fits the repo better:

- materialization rows are derived detection evidence, not user-decision state
- current link and suppression user decisions are already modeled in separate tables
- reversible hide/unhide is naturally represented by insert/delete or active/inactive rows
- cleanup can follow the same current-materialization rules already used for face links and face/consent suppressions

Why a face-row flag is weaker:

- it mixes user moderation state into materialized matcher output
- it complicates rematerialization semantics
- it is harder to treat as an auditable reversible decision

Materialization durability limit:

- current face identity is only robust for the current materialization
- stale materialization-specific rows are already cleaned in `cleanupCurrentPhotoStateForAsset(...)`
- if the repo needs hide/unhide to survive arbitrary rematerialization or materializer-version change, current `asset_face_materialization_faces.id` is not durable enough by itself

Bounded v1 implication:

- hidden state should likely be materialization-scoped for now
- if current materialization changes, old hidden rows should be ignored and cleaned like current face suppressions

## 7. Hidden face effect on matching state

This is the key product requirement. Hidden faces must be excluded from all active asset-level matching reads and auto-reconciliation paths.

Current code paths that would need to ignore hidden faces:

- `listLinkedFaceOverlaysForAssetIds(...)`
  - otherwise hidden faces still render as active overlays
- `listPhotoConsentAssignmentsForAssetIds(...)`
  - this feeds asset-grid `linkedConsentCount`, `linkedPeople`, and consent filters
- `getAssetPreviewLinkedFaces(...)`
  - this feeds the linked-face strip and right-side panel
- any new all-detected-faces preview read helper
- `resolveLikelyCandidateBatch(...)`
  - otherwise hidden false-positive faces can keep surfacing as likely-match assets
- `listMatchableProjectPhotosForConsent(...)`
  - via the likely-candidate path above
- `reconcilePhotoFaceCanonicalStateForAsset(...)`
  - auto contenders on hidden faces must be ignored
  - stale auto links on hidden faces must not remain current

Important current repo fact:

- there is no dedicated asset-level "matched/unmatched" boolean
- the effective asset-level matching UX is derived from linked counts, linked people, linked overlays, and likely-match lists

So the false-positive edge case is only fixed if hidden faces stop influencing those derived reads.

## 8. Hidden face behavior when links or candidates already exist

Current model reasoning leads to the safest bounded behavior:

- If a hidden face is currently auto linked:
  - remove the current link
  - create the existing face/consent suppression for that assignee
  - add hidden-face state
- If a hidden face is currently manually linked:
  - remove the current manual link
  - create the existing face/consent suppression for that assignee
  - add hidden-face state
- If a hidden face is unlinked but has scored candidates:
  - keep compare and candidate evidence as historical input
  - add hidden-face state
  - read and reconcile logic must ignore that face while hidden

Why hiding should remove the current link:

- a hidden-but-still-linked face would keep asset summaries and preview state misleading
- current linked-state tables are supposed to represent active exact face assignments

Should auto reconciliation recreate a link on a hidden face?

- No.
- Hidden faces should be excluded from active auto contenders while hidden.

Should hiding also create a suppression for the current linked consent?

- Yes, for the currently assigned consent, by reusing the existing unlink semantics.
- That is the smallest bounded way to avoid immediate reappearance after explicit rejection of that face assignment.

## 9. Restore and unhide behavior

Smallest reversible v1 behavior:

- hidden faces stay out of the active overlay set by default
- preview gets a `show hidden faces` toggle
- hidden faces render in a clearly inactive style when shown
- selecting a hidden face offers `Restore`
- restoring removes the hidden-face state
- restored faces return as normal detected faces

Recommended bounded restore semantics:

- do not restore the old manual or auto link invisibly
- load current link and candidate state fresh after unhide
- keep prior face/consent suppressions if the hide path created them through unlink

Why this is safer:

- it avoids storing and replaying invisible link state
- it keeps restored faces consistent with current canonical state

## 10. New read and write API needs

Current preview routes are not sufficient for the requested behavior.

Needed additions:

- a preview-oriented read route that returns all current detected faces for one asset, not only linked exact faces
- a per-face candidate route that can return ranked candidates for one selected asset face
- hidden-face management write route(s) for hide and restore

What can stay unchanged:

- current manual link route for save/confirm link
- current manual unlink route for consent-specific unlink
- current overlay geometry helpers

Bounded API direction:

- keep `GET /api/projects/[projectId]/assets` lightweight
- keep `preview-links` focused on current exact linked faces if desired, or replace it with a broader `preview-faces` route for the selected asset only
- add a face-scoped candidate route rather than overloading the current asset-level `preview-link-candidates` route

## 11. UI state implications

This can remain local to the preview layer.

Additional preview-local state needed:

- `hoveredFaceId`
- `selectedFaceId`
- selected face kind: linked, unlinked, hidden
- candidate picker open/closed
- pending replacement consent id before save
- save/hide/restore in-flight state
- `showHiddenFaces`
- action and refresh errors

The current preview architecture already supports this:

- `ProjectAssetPreviewLightbox` owns preview-local linked-face state
- `ImagePreviewLightbox` already accepts controlled hovered and selected overlay ids
- preview state already resets naturally on close and previous/next navigation

## 12. UX boundary for the candidate list

The smallest coherent addition is:

- keep the current 044 linked-face right-side panel for linked exact faces
- when an unlinked face is selected, show a compact candidate list in the below-image preview area, under the linked-face strip or as a sibling section

Why this fits the current layout:

- `ImagePreviewLightbox` already supports `belowScene` and `sidePanel`
- the right-side panel is currently tuned for linked consent preview and actions
- forcing linked-preview and unlinked-candidate flows into one panel would blur two distinct modes

This keeps the feature bounded:

- linked face selected -> right-side consent panel
- unlinked face selected -> compact candidate list with explicit Save
- hidden face selected -> restore action, not candidate linking

## 13. Permission and security implications

Current permission boundaries are already sound and should be reused:

- all current routes authenticate with the server Supabase client
- tenant id is resolved server-side via `resolveTenantId(...)`
- admin client reads and writes still apply explicit tenant/project filters

New hide/unhide operations must also:

- derive tenant from auth, never from the client
- validate the asset belongs to the project
- validate the face belongs to the current materialization for that asset
- keep all candidate and consent summary reads tenant- and project-scoped

Manual link permissions already enforce the right face-level boundary for unlinked-face linking.

## 14. Edge cases to carry into plan phase

- No ranked candidates available:
  - show an unscored manual candidate list or an empty state
- Candidate scores unavailable for some people:
  - show score only when current compare evidence exists
- Face has no derivative thumbnail:
  - use overlay plus placeholder avatar
- Hiding an unlinked face:
  - should be allowed and should not require a consent id
- Hiding a currently linked face:
  - should remove the active link first
- Unhiding after rematerialization:
  - stale hidden rows may not map to a current face anymore
- Multiple hidden faces on one asset:
  - preview must support a hidden-face list or toggle without losing active-face selection
- Previous/next navigation while picker is open:
  - reset preview-local candidate state on asset change
- Zoom changes while a face is selected:
  - keep selection by `assetFaceId`; only recompute visual position
- Selecting hidden faces while `show hidden faces` is enabled:
  - expose restore, not active link actions
- Manual-linking to a consent already linked elsewhere on the same asset:
  - current manual-link flow moves the consent to the new face and writes `manual_replace` suppression on the old face

## 15. Options considered

### Option A: Reuse current preview-link routes and add all detected faces there

Pros:

- smallest route count
- reuses current lightbox fetch path

Cons:

- current `preview-links` route is semantically exact-linked-face-oriented
- hidden-face and unlinked-face candidate concerns would overload the response

### Option B: Reuse consent-centric `manual-link-state` for asset preview

Pros:

- already returns all detected faces
- already returns face status, crop URL, and match confidence

Cons:

- wrong shape for asset-centric preview
- requires a consent id up front
- can trigger direct materialization work
- does not solve asset-level hidden-face state

### Option C: Add bounded asset-centric preview face reads plus a dedicated hidden-face state

Pros:

- fits the existing 044 asset-preview architecture
- keeps overlay math and manual-link writes unchanged
- gives a clean place to represent linked, unlinked, and hidden faces together
- keeps face hiding independent from consent-specific suppressions

Cons:

- adds at least one new face-preview read route and one new hide/unhide write route
- needs hidden-face-aware filtering in existing matching and summary helpers

## Recommended bounded direction

Choose Option C.

Recommended direction for the plan phase:

1. Keep current overlay geometry, zoom, hover, highlight, and exact linked-face behavior.
2. Add an asset-centric selected-asset face read model that returns:
   - all current detected faces
   - current exact link state when present
   - hidden state
   - enough data to render linked, unlinked, and hidden overlays distinctly
3. Reuse the existing manual face-link route for Save-confirm linking of unlinked faces.
4. Add a new hidden-face table and hide/restore route pair.
5. Make hidden-face-aware filtering a shared server-side rule for:
   - preview overlays
   - linked-face strip
   - asset linked counts and linked people summaries
   - likely-match reads
   - face auto reconciliation
6. Build ranked per-face candidates from current compare evidence where available, with deterministic fallback ordering for unscored candidates.
7. Keep zero-face fallback links out of this preview surface unless plan-phase research proves a strong need.

## Current constraints and invariants

- `asset_face_consent_links.asset_face_id` is the face-level canonical key for current exact links.
- `asset_face_consent_links` also has unique `(tenant_id, project_id, asset_id, consent_id)`, so one consent can occupy at most one face per asset.
- Manual beats auto under the current canonical model.
- Manual-linking an already-linked consent to another face moves that consent and writes `manual_replace` suppression on the old face.
- Face/consent suppressions are consent-specific. They are not face-hidden-global.
- Current face identity is materialization-scoped, not a durable cross-rematerialization face instance.

## Risks and tradeoffs

- Hidden state tied to current `asset_face_id` is bounded but not durable across arbitrary rematerialization.
- If hidden faces are ignored only in preview reads but not in assignment and likely-match helpers, asset-level UX will stay inconsistent.
- Per-face ranked candidates derived from compare evidence will be incomplete when matching has not yet run for some consents.
- If the hide flow does not unlink current assignees, the asset can remain misleadingly linked while the face is visually hidden.
- Keeping zero-face fallback links out of this surface keeps the feature bounded, but means preview remains exact-face-first rather than fully assignment-complete.

## Explicit open decisions for the plan phase

- New hidden-face model:
  - new table keyed by `asset_face_id` and `asset_materialization_id`
  - or another shape if plan wants stronger rematerialization survival
- Hide semantics for currently linked faces:
  - always unlink first and create consent suppression
  - or preserve some invisible state
- Hidden-face read filtering scope:
  - exclude from all active preview and matching summaries
  - or only from preview overlays
- Ranked candidate source:
  - current compare rows only
  - compare rows plus likely-candidate rows
  - compare rows plus unscored manual fallback list
- Score-unavailable fallback ordering:
  - signed date
  - name
  - current 044 asset-preview candidate order
- Rematerialization behavior:
  - accept materialization-scoped hide state for v1
  - or add explicit remap logic
- Restore semantics:
  - restore as normal unlinked face
  - or try to restore prior link state
- Preview layout:
  - keep linked-face details in right panel and put unlinked candidate list below the image
  - or make one shared right-side panel with mode-specific content
- Zero-face fallback visibility:
  - keep excluded from this preview
  - or add a separate non-overlay section later
