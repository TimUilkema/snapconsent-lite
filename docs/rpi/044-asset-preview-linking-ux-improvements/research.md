# Feature 044 Research: Asset Preview Linking UX Improvements

## Goal

Research how to improve the project asset preview so linked people are easier to inspect and manage directly from the image preview, while keeping the feature bounded and reusing the existing face-level/manual-linking model.

This research is code-first. Earlier RPI docs were treated as intent only. Current repository code and schema are the source of truth.

## Inputs reviewed

Required docs, in requested order:

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

Relevant implementation, routes, helpers, migrations, and tests verified directly:

- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/app/api/projects/[projectId]/assets/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/matchable/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/links/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/[assetId]/manual-link-state/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/review-sessions/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/review-sessions/current/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/review-sessions/[sessionId]/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/review-sessions/[sessionId]/items/[itemId]/actions/route.ts`
- `src/components/projects/assets-list.tsx`
- `src/components/projects/previewable-image.tsx`
- `src/components/projects/photo-link-review-dialog.tsx`
- `src/components/projects/consent-asset-matching-panel.tsx`
- `src/lib/client/face-overlay.ts`
- `src/lib/client/face-review-selection.ts`
- `src/lib/matching/consent-photo-matching.ts`
- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/face-review-sessions.ts`
- `src/lib/matching/face-review-response.ts`
- `src/lib/matching/face-materialization.ts`
- `src/lib/assets/sign-asset-thumbnails.ts`
- `src/lib/assets/sign-face-derivatives.ts`
- `supabase/migrations/20260320140000_019_face_materialization_pipeline.sql`
- `supabase/migrations/20260403170000_031_face_level_photo_linking.sql`
- `supabase/migrations/20260404110000_032_face_review_sessions_and_derivatives.sql`
- `supabase/migrations/20260404120000_032_face_derivative_storage.sql`
- `tests/feature-031-one-consent-per-face-precedence-rules.test.ts`
- `tests/feature-032-face-consent-linking-ui-improvements.test.ts`

`<NEXT_ID>` was resolved to `044` because `docs/rpi/043-simple-project-export-zip/` is the highest existing numbered folder.

## Verified current behavior

- Users can click a project asset card and open a larger preview. The asset grid in `assets-list.tsx` lifts preview open state into `selectedAssetGlobalIndex`, then renders one shared `ImagePreviewLightbox`.
- Previous and next image navigation already exists in that lightbox and stays aligned with paginated asset fetches. `AssetsList` keeps page cache and adjacent-page prefetch logic so navigation can cross page boundaries without losing alignment.
- Zoom already exists in the lightbox. `ImagePreviewLightbox` owns `zoom` and `pan` locally and supports zoom buttons, wheel zoom, and pointer drag pan.
- Linked face overlays already render in the larger preview, not in the grid cards. `AssetsList` passes `previewFaceOverlays`, but does not set `showInlineFaceOverlays`, so the current asset grid has no inline face boxes.
- Overlay positions already stay aligned during resize and zoom. Base positions come from normalized face boxes through `getFaceOverlayStyle(...)`; lightbox overlay boxes are then transformed into zoomed viewport space by `transformPreviewOverlayStyle(...)`.
- Linked overlays already show link state and score where relevant. The preview overlay card shows headshot badge or initials, label, manual/auto icon, and confidence percentage when `matchConfidence` exists.
- Hovering a linked overlay already highlights it, raises it, and dims others. `ImagePreviewLightbox` tracks only `hoveredOverlayId`; there is no selected overlay state yet.
- Current overlay click behavior is direct navigation to the consent details on the project page. Overlay `href` values are `/projects/[projectId]?openConsentId=[consentId]#consent-[consentId]`.

Important boundary:

- The current asset preview overlay system only knows about current linked faces. It does not load or render all detected faces for the asset.

## 1. Current asset preview architecture

### Components involved

- Project page section: `src/app/(protected)/projects/[projectId]/page.tsx`
- Asset grid and preview orchestration: `src/components/projects/assets-list.tsx`
- Reusable image/lightbox UI: `src/components/projects/previewable-image.tsx`
- Shared overlay geometry math: `src/lib/client/face-overlay.ts`

### Where preview state lives

Lifted in `AssetsList`:

- current asset page data cache
- `selectedAssetGlobalIndex`
- current selected asset for preview
- previous/next navigation across paginated results

Local in `ImagePreviewLightbox`:

- `hoveredOverlayId`
- `zoom`
- `pan`
- drag state
- failed image state
- measured frame size and natural image size

Local in `PreviewableImage`:

- when `onOpenPreview` is not passed, `PreviewableImage` can open its own lightbox
- on the assets page, that local behavior is bypassed and the page-level lightbox is used instead

### Where navigation lives

- Previous and next handlers are created in `AssetsList` and passed into `ImagePreviewLightbox`.
- `AssetsList` also preloads neighboring preview URLs and prefetches adjacent asset pages while the lightbox is open.

### Where zoom lives

- `zoom` and `pan` live inside `ImagePreviewLightbox`.
- The lightbox resets zoom and pan only when it remounts. On the assets page it remounts whenever `selectedAsset.id` or `selectedAssetGlobalIndex` changes because the component key changes.

### Where overlays are rendered

- Inline overlay rendering exists in `PreviewableImage`, but is opt-in via `showInlineFaceOverlays`.
- The asset grid does not currently enable inline overlays.
- The larger preview renders overlays in `ImagePreviewLightbox`.

### How overlay positions are calculated and updated

- Normalized box math lives in `getFaceOverlayStyle(...)` in `src/lib/client/face-overlay.ts`.
- It computes a contained or covered image rect from:
  - measured container size
  - actual image natural size
  - fit mode
- Asset preview uses `contain`.
- `ImagePreviewLightbox` computes base overlay positions against the measured preview frame and natural image size.
- Those base pixel positions are then transformed into the current zoomed and panned viewport by `transformPreviewOverlayStyle(...)`.
- Overlay cards are laid out separately with collision avoidance by `getPreviewOverlayCardLayout(...)`.

### How hover, highlight, and foreground work today

- `ImagePreviewLightbox` tracks `hoveredOverlayId`.
- Hovering either the face box or its card sets that id.
- The active overlay gets a higher `z-index`.
- Non-hovered overlays are dimmed while one overlay is active.
- There is no persistent selected face state in the asset lightbox today.

### Current structure assessment

- The current asset preview is a modal lightbox launched from a page section.
- The image scene is already isolated enough that adding a linked-people strip below and a right-side detail panel is structurally feasible.
- The current lightbox does not have a selected-face concept, so the new UX needs additive state for:
  - hovered linked face
  - selected linked face
- The existing overlay positioning, hover, zoom, and card styling can be reused without redesign.

### Clean layering direction

Best fit with current structure:

- keep `AssetsList` as owner of asset selection and previous/next navigation
- keep current overlay geometry and zoom logic inside the lightbox scene
- add new asset-preview-specific selection and side-panel state inside the lightbox layer, not in the grid

This keeps the overlay system intact and avoids moving zoom or navigation state upward.

## 2. Current canonical face-link model

### Canonical tables now in use

Current detected-face canonical state:

- `asset_face_consent_links`
- `asset_face_consent_link_suppressions`

Current zero-face fallback state:

- `asset_consent_manual_photo_fallbacks`
- `asset_consent_manual_photo_fallback_suppressions`

Headshot-to-consent links remain in:

- `asset_consent_links`

### How linked face overlays are loaded

- The assets API calls `listLinkedFaceOverlaysForAssetIds(...)`.
- That helper loads current materializations and current face links, filters out stale rows, resolves the current face row, and returns:
  - `assetId`
  - `assetFaceId`
  - `consentId`
  - `faceRank`
  - `faceBoxNormalized`
  - `linkSource`
  - `matchConfidence`

### How manual links and auto links are distinguished

- `asset_face_consent_links.link_source` is `'manual'` or `'auto'`.
- Manual links are written by `manualLinkPhotoToConsent(...)`.
- Auto links are written only by `reconcilePhotoFaceCanonicalStateForAsset(...)`.

### One-consent-per-face and one-face-per-consent-in-asset rules

Verified current invariants:

- `asset_face_consent_links.asset_face_id` is the primary key, so one face can have at most one current linked consent.
- There is also a unique constraint on `(tenant_id, project_id, asset_id, consent_id)`, so one consent can have at most one current face in a given asset.
- This means repeated appearances of the same person in one asset remain intentionally unsupported.

### Manual > auto precedence

Current behavior is already correct and enforced in live code:

- `reconcilePhotoFaceCanonicalStateForAsset(...)` never auto-writes onto a face with a current manual link.
- It also excludes any consent that already has a manual face link in the asset from auto contenders.
- `manualLinkPhotoToConsent(...)` can replace an existing auto assignee on a face and then writes a suppression for the displaced consent with reason `manual_replace`.

### Suppression behavior

Face-level suppressions:

- `asset_face_consent_link_suppressions`
- key: `(asset_face_id, consent_id)`
- reasons:
  - `manual_unlink`
  - `manual_replace`

Zero-face fallback suppressions:

- `asset_consent_manual_photo_fallback_suppressions`
- key: `(asset_id, consent_id)`
- reason:
  - `manual_unlink`

### How unlinking works

Face unlink:

- delete from `asset_face_consent_links`
- upsert a face-level suppression for the same face/consent
- delete likely-match candidate row for that pair
- run face reconciliation for the asset

Zero-face fallback unlink:

- delete from `asset_consent_manual_photo_fallbacks`
- upsert fallback suppression
- delete likely-match candidate row for that pair

### Replace-link behavior under the current model

Important conclusion:

- a dedicated backend replace concept is unnecessary
- the best existing operation is not explicit unlink-then-relink
- the best existing operation is `manualLinkPhotoToConsent(...)` on the newly selected consent

Why:

- if current face owner is auto `A` and the user chooses person `B`, linking `B` to that face directly:
  - deletes `A`
  - writes suppression for `A` with `manual_replace`
  - writes manual link for `B`
  - reconciles the asset
- if current face owner is manual `A` and the user chooses `B`:
  - the first call returns structured `manual_conflict`
  - retrying the same call with `forceReplace: true` performs the replacement atomically
  - `A` receives `manual_replace` suppression

This is cleaner than an explicit unlink + new manual link sequence because:

- it is one canonical write flow
- it preserves `manual_replace` semantics
- it avoids a transient unassigned face between two client calls

### Current live model answer

The current canonical model is already sufficient for this feature's write semantics. The feature should reuse existing manual link, unlink, suppression, and reconciliation behavior rather than inventing a new replace operation.

## 3. Current APIs and helpers relevant to this feature

### Asset preview data currently loaded

Primary asset list and preview data is loaded by:

- `GET /api/projects/[projectId]/assets`
- implementation: `src/app/api/projects/[projectId]/assets/route.ts`

For each asset, the route already returns:

- signed thumbnail and preview URLs
- dimensions and file metadata
- `linkedConsentCount`
- `linkedPeople[]`
- `linkedFaceOverlays[]`

`linkedFaceOverlays[]` already contains most of the current overlay payload:

- `assetFaceId`
- `consentId`
- `consentName`
- `consentEmail`
- `headshotThumbnailUrl`
- `faceRank`
- `faceBoxNormalized`
- `linkSource`
- `matchConfidence`

This is what powers the current overlay rendering inside `ImagePreviewLightbox`.

What it does not include:

- linked face crop thumbnails for the asset face
- fallback/manual-photo links with no face box
- richer consent preview fields such as signed date, consent version, revoked status, structured snapshot summary, or face match opt-in
- candidate people for a "change person" picker

Conclusion:

- the current assets route is good for the existing lightbox overlays
- it is not sufficient by itself for the full linked-people strip plus right-side consent preview panel
- expanding it too far would overload a paginated asset grid API with preview-only detail

### Existing asset/consent linking write routes

Canonical write route:

- `POST /api/projects/[projectId]/consents/[consentId]/assets/links`
- implementation: `src/app/api/projects/[projectId]/consents/[consentId]/assets/links/route.ts`

Supported write modes today:

- headshot/manual photo link
- detected-face manual link by `assetFaceId`
- optional `forceReplace`

Canonical unlink route:

- `DELETE /api/projects/[projectId]/consents/[consentId]/assets/links`
- same route file

Supported unlink modes today:

- face-level unlink by `assetFaceId`
- fallback/manual-photo unlink by `assetId`

Important backend conclusion:

- these existing write routes are already sufficient for "Remove link"
- they are also sufficient for "Change person" if the UI targets the chosen consent and submits the selected `assetFaceId`
- no new write API is required for this feature if the UI is limited to current linked-face inspection and replacement

### Existing candidate-loading routes and helpers

Current consent-centric manual review route:

- `GET /api/projects/[projectId]/consents/[consentId]/assets/[assetId]/manual-link-state`

This route returns detailed per-face candidate and assignment information for a single consent/asset pair and is used by:

- `src/components/projects/consent-asset-matching-panel.tsx`
- `src/components/projects/photo-link-review-dialog.tsx`

It is useful for manual-review flows, but it is not a natural fit for this feature because:

- it is consent-centric rather than asset-centric
- it can trigger direct candidate materialization work
- it assumes the user is reviewing one consent against one asset, not browsing all linked people on one asset

Current review-session routes:

- `POST /api/projects/[projectId]/consents/[consentId]/review-sessions`
- `GET /api/projects/[projectId]/consents/[consentId]/review-sessions/current`
- `GET /api/projects/[projectId]/consents/[consentId]/review-sessions/[sessionId]`
- `POST /api/projects/[projectId]/consents/[consentId]/review-sessions/[sessionId]/items/[itemId]/actions`

These are also consent-centric and queue-oriented. They are not a clean base for an inline "change person" picker inside the asset preview.

### Existing summary data sources

Relevant helper paths:

- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/face-review-response.ts`
- `src/lib/matching/face-materialization.ts`
- `src/lib/assets/sign-face-derivatives.ts`
- `src/lib/assets/sign-asset-thumbnails.ts`

Current project page server load already has access to richer consent rows than the client preview receives, including:

- full name
- email
- signed date
- consent version
- consent text / structured snapshot fields
- `face_match_opt_in`
- revoked state
- headshot asset references

Conclusion:

- a bounded new preview-oriented read API is likely warranted
- it should be asset-centric, scoped to one asset, and limited to linked people plus lightweight consent preview data
- it should not reuse the queue/review-session routes

## 4. Current consent summary data available for preview

### Data already available in the current asset preview surface

From `GET /api/projects/[projectId]/assets`, the preview can already show:

- person name
- email
- link source
- match confidence where relevant
- headshot thumbnail URL
- deep link to the consent section, derived client-side from `consentId`

### Richer consent data available elsewhere in the project

From the project page server-side consent load and related helpers, the codebase already has access to or can derive:

- person full name
- email
- consent signed date
- consent version
- consent status including revoked state
- face match opt-in
- structured consent snapshot content when present
- headshot asset / thumbnail

What is not currently packaged into a lightweight preview payload for the asset lightbox is a single small object with these fields.

### Recommended bounded consent preview payload

For later planning, the right-side panel can stay bounded if it requests or receives only:

- `consentId`
- `fullName`
- `email`
- `status`
- `signedAt`
- `consentVersion`
- `faceMatchOptIn`
- `structuredSnapshotSummary`
- `headshotThumbnailUrl`
- `linkedFaceThumbnailUrl`
- `goToConsentHref`
- `linkSource`
- `matchConfidence`
- `linkMode`

Where:

- `status` should cover at least active vs revoked
- `structuredSnapshotSummary` should be intentionally small and omit full consent body text
- `linkMode` should distinguish exact face link vs fallback link if fallback rows remain visible in this surface

## 5. Current face thumbnail sources

### Linked person card below the image

Two thumbnail sources already exist in the system:

- consent headshot thumbnails
- asset face crop derivatives

Consent headshots:

- loaded by `loadCurrentProjectConsentHeadshots(...)`
- signed by `signThumbnailUrlsForAssets(...)`

Asset face crops:

- stored in `asset_face_image_derivatives`
- current derivative kind includes `review_square_256`
- loaded by `loadFaceImageDerivativesForFaceIds(...)`
- signed by `signFaceDerivativeUrls(...)`

For a linked-people strip that is explicitly tied to face overlays, the better primary thumbnail is the linked asset face crop, because:

- it maps directly to the overlayed face on the current image
- it makes hover/select correlation clearer than a generic headshot

### Change-person picker list

For picker rows, the best existing thumbnail is the consent headshot thumbnail, because:

- the picker is person-oriented rather than face-on-this-image oriented
- current consent assets already support signed thumbnail derivation

### Right-side consent preview panel

The right-side panel can reasonably show both:

- the consent headshot thumbnail as the person's canonical profile image
- the linked face crop from the current asset as contextual confirmation

This is optional, but the data paths already exist.

### Fallbacks when thumbnails do not exist

Verified current constraints:

- some consents may have no headshot asset
- some linked faces may not yet have a usable derivative URL in client payloads

Bounded fallback recommendation:

- face crop missing: use a neutral face placeholder or initials chip and keep overlay as the primary locator
- headshot missing: use initials/avatar fallback

## 6. Linked-people strip below the image

### Cleanest data source

The strip should be driven by current canonical linked-face rows for the selected asset, not by the broader detected-face list.

Best later shape:

- one item per currently linked face
- keyed by `assetFaceId`
- include minimal consent preview summary and face thumbnail

The current asset list API already exposes most of this but is missing:

- linked face thumbnail URL
- explicit fallback/exact link mode
- some richer preview fields

That supports a bounded conclusion:

- either extend the existing preview payload for the selected asset only
- or add a dedicated single-asset preview read route

### Mapping cards to overlays

Exact face links map cleanly by `assetFaceId`.

Recommended strip card shape:

- `assetFaceId`
- `consentId`
- `fullName`
- `email`
- `faceThumbnailUrl`
- `headshotThumbnailUrl`
- `linkSource`
- `matchConfidence`
- `faceBoxNormalized`
- `linkMode`

### Multiple linked faces

The strip should simply render one card per current linked face in overlay order or face-rank order.

Current schema already guarantees:

- one consent per face
- one face per consent per asset

So duplicate-card ambiguity is limited.

### No linked people

For assets with no linked faces, the strip should render an empty state rather than inferred candidates.

This keeps the feature bounded to current linked-face inspection.

### Fallback/manual-photo links with no exact face box

Fallback links are still represented in the model via `asset_consent_manual_photo_fallbacks`, but they do not map to an exact face overlay.

This matters because the requested UX depends on:

- hover card -> highlight overlay
- click overlay -> open linked-person preview

Recommendation:

- the strip should primarily show exact face links
- if fallback links still need to appear, render them as a clearly separate non-overlay-linked card section or omit them from this preview surface

The simpler bounded direction is to keep the strip aligned to exact linked faces only.

### Hover and selected state behavior

Recommended synchronization:

- hover card -> set hovered linked face -> raise and highlight corresponding overlay
- hover overlay -> highlight corresponding card
- select overlay -> select corresponding card and open right panel
- select card -> select corresponding overlay and open right panel

## 7. Click-on-face to open right-side consent preview

### Is there already a selected-face concept?

Not in `ImagePreviewLightbox`.

Current live state there is:

- zoom/pan state
- hovered overlay id
- current preview asset
- previous/next navigation callbacks

There is no persistent selected overlay or selected face concept today.

There is, however, an existing precedent in `PhotoLinkReviewDialog`, which keeps explicit selected-face state in a richer review flow.

### Where selected face state should live

The cleanest bounded choice is local state inside `ImagePreviewLightbox`, because:

- selection is preview-local
- it resets naturally when the preview closes or navigates to another asset
- it should not affect the asset grid outside the lightbox

### Can the current overlay system support click-to-select?

Yes.

The current overlay system already supports:

- hover state
- active z-index/foreground treatment
- pointer interaction
- zoom-synced transform math

The needed change is additive:

- preserve hover behavior
- add selection styling and click handling on top of the existing overlay items

### Recommended bounded state model

- `hoveredLinkedFaceId: string | null`
- `selectedLinkedFaceId: string | null`
- `isDetailsPanelOpen: boolean`
- `isChangePersonOpen: boolean`

Derived state:

- `selectedLinkedPerson` from current linked-face payload by `selectedLinkedFaceId`

### Recommended panel behavior

No face selected:

- panel closed by default

Unlinked face selected:

- not recommended for this feature's first iteration
- supporting this would require exposing all detected faces in the preview and adds candidate-loading complexity

Linked face selected:

- open right-side panel
- show consent preview
- show "Go to consent form"
- show "Remove link"
- show "Change person"

Bounded recommendation:

- open the panel only for currently linked faces
- keep unlinked face interaction unchanged for now

## 8. Remove link behavior

### Verified current unlink behavior

`DELETE /api/projects/[projectId]/consents/[consentId]/assets/links` already performs the needed canonical unlink.

Face-level unlink effects:

- remove current row from `asset_face_consent_links`
- create or update suppression in `asset_face_consent_link_suppressions`
- remove stale likely-match candidate for that face/consent pair
- run reconciliation

Fallback unlink effects:

- remove row from `asset_consent_manual_photo_fallbacks`
- create fallback suppression
- remove stale likely-match candidate

### Manual vs auto unlink differences

The endpoint handles both because it removes the current canonical link row and then writes the appropriate suppression.

For this feature, the important behavior is already correct:

- removing a manual link remains authoritative
- removing an auto link also suppresses immediate recreation for that same pair

### UI refresh behavior today

Current project page patterns rely on a server refresh after writes rather than deep optimistic cache mutation.

Bounded recommendation:

- "Remove link" in the right-side panel should call the existing unlink flow unchanged
- after success, refresh preview-linked-face data and clear `selectedLinkedFaceId`

## 9. Change person behavior

### Can current manual-link APIs attach a selected consent to a selected face directly?

Yes.

`POST /api/projects/[projectId]/consents/[consentId]/assets/links` accepts an `assetFaceId` and already routes to `manualLinkPhotoToConsent(...)`.

### What exact sequence should happen under the current model?

Best current sequence:

- user selects another person
- UI submits manual-link request for the chosen consent and the current `assetFaceId`
- if the API returns `manual_conflict`, retry with `forceReplace: true` after user confirmation if needed

This is better than:

- unlink existing link
- then create a new manual link

because the existing manual-link helper already knows how to replace correctly and atomically.

### Auto -> manual replacement

Already supported.

When the old assignee is auto and the new one is manual:

- old auto row is displaced
- old pair receives `manual_replace`
- new person becomes the canonical manual link

This already yields the desired manual > auto outcome.

### Manual -> manual replacement

Already supported through conflict + `forceReplace`.

This preserves current precedence and suppression semantics without a new backend concept.

### Do additional suppressions need to be created?

No new suppression model is needed.

Existing replacement already writes the right face-level suppression for the displaced pair.

### Research conclusion for change person

The cleanest bounded implementation strategy is:

- reuse the current manual-link endpoint exactly
- treat change-person as "manual link selected consent to selected face"
- handle existing-manual conflict through the current `forceReplace` mechanism

No dedicated replace route or redesigned linking semantic is justified by current code.

## 10. Change-person picker UI scope

### Current reusable picker components

There is no existing person-picker component that already provides:

- consent thumbnails
- names
- search/filter
- selection inside the asset preview lightbox

Current related UI:

- `ConsentAssetMatchingPanel` is a consent-centric review surface
- `PhotoLinkReviewDialog` is a face-review queue UI

These components are useful references for data semantics, but they are not directly reusable as a compact person picker in the asset preview.

### Existing data support

The project assets response includes a `people[]` list, but it is not enough for the requested picker because it lacks:

- consent headshot thumbnails
- richer preview/status fields
- picker-specific filtering support

### Recommended bounded picker approach

Best bounded UI option:

- open a compact modal or panel section from the right-side preview
- lazy-load selectable people with thumbnails and names
- keep it separate from the image scene so overlay layout remains untouched

Not recommended for first pass:

- embedding the existing review dialog
- redesigning the queue/manual review workflow
- supporting full review-session semantics inside the preview

## 11. Navigation and layout constraints

### Current layout shape

The current lightbox is centered around:

- a large image scene
- previous/next navigation controls
- zoom controls
- overlay layer on top of the image

This is a modal/lightbox, not an inline page section. That is favorable for bounded enhancement because the preview already owns its own layout container.

### Can the requested layout fit cleanly?

On desktop and normal laptop widths, yes:

- image remains central
- linked-people strip can sit below the image frame
- right-side panel can sit beside the image frame

This can be layered around the existing image/overlay scene without replacing the overlay implementation.

### Responsive constraints

On narrower widths, side-by-side image plus right panel will become cramped, especially with zoom controls and navigation still present.

Bounded responsive fallback recommendation:

- desktop: image center, strip below image, panel on the right
- narrower laptop/tablet widths: stack the panel below the image rather than shrinking the image scene too aggressively

The panel should collapse or stack before the image becomes too small to inspect face overlays.

## 12. Performance and state-refresh implications

### What is already loaded when a preview opens?

When the user opens an asset preview from the grid, the page has already loaded:

- the paginated asset item
- preview image URL
- linked face overlay summaries

So the current preview opens without an extra fetch for the basics.

### What should be prefetched vs lazy-loaded?

Bounded recommendation:

- preloaded: current linked overlay summaries needed for image overlay rendering
- lazy-loaded when preview opens or when a linked face is selected: richer linked-face preview payload for the selected asset
- lazy-loaded only when "Change person" opens: picker candidate people list

This avoids bloating the paginated assets list response and avoids repeated work for assets the user never expands.

### Overlay rerender sensitivity

Current overlay math is driven by measured image/frame state and a small set of preview-local interaction states.

There is no sign that adding lightweight selected-face state will fundamentally break alignment, but unnecessary parent re-renders should still be minimized.

Bounded implication:

- keep selection/preview panel state local to the lightbox
- avoid refetching the entire asset grid when only one preview interaction changes

## 13. Security and permission implications

### View permissions

The existing project page and project asset routes already require authenticated project access. Tenant and project scope are derived server-side.

Verified patterns:

- routes derive tenant from auth/session context
- queries scope by `tenant_id` and `project_id`
- client does not provide authoritative tenant ids

### Write permissions

The current asset link write routes already enforce the critical boundary:

- consent must belong to the tenant/project
- asset and face must belong to the tenant/project
- writes happen server-side through canonical helpers

Additional review-session routes also scope by `created_by = actorUserId`, but this feature does not need to reuse those routes.

### Security conclusion

No permission redesign is needed if this feature reuses:

- existing project asset read authorization
- existing link/unlink write routes

The plan phase should still preserve the current pattern of deriving tenant/project scope entirely server-side.

## 14. Edge cases to carry into plan phase

- Asset with no linked faces: show the image preview normally, show empty linked-people strip, keep right-side panel closed.
- Asset with linked faces but no thumbnails: render cards with fallback avatar/placeholder and keep overlay as the primary locator.
- Clicking an unlinked face: current bounded recommendation is to do nothing new in this feature and reserve unlinked-face manual linking for existing review flows.
- Clicking a linked face whose consent is revoked: the panel should still render the linked person summary and expose the canonical consent form destination if permitted, while clearly showing revoked status.
- Changing a link to a consent already linked elsewhere on the same asset: current backend uniqueness rules will surface a conflict; the plan must define the exact user-facing conflict handling.
- Removing a link then selecting another person immediately: after unlink refresh, the old pair will be suppressed; the new manual-link request should still work for a different consent.
- Previous/next navigation while a right-side panel is open: because selection should be preview-local, navigating to another asset should clear selected face and panel state.
- Overlay selection when zoom changes: selected face should remain selected by `assetFaceId`; only visual positioning should recompute.
- Asset fallback/manual links with no exact face box: these do not map cleanly to overlay-linked cards or click-on-face behavior and should be treated as out-of-band if included at all.

## Options considered

### Option A: Expand the existing paginated assets API to include all preview and picker data

Pros:

- no new read route
- minimal client fetch orchestration

Cons:

- bloats the main asset grid payload
- mixes grid concerns with deep preview concerns
- likely loads picker and consent detail data for many assets the user never opens

### Option B: Add a bounded single-asset preview read API and lazy candidate list

Pros:

- keeps the paginated grid response small
- matches the actual interaction surface
- allows face thumbnails and consent preview fields to be packaged cleanly
- keeps candidate picker loading lazy and bounded

Cons:

- adds one or two read endpoints
- requires lightbox-side fetch and refresh orchestration

### Option C: Reuse consent-centric review-session/manual-link-state routes for the preview UX

Pros:

- reuses existing endpoints

Cons:

- wrong shape for asset-centric linked-person inspection
- brings in queue/review assumptions
- risks triggering heavier candidate materialization paths
- broadens feature scope

## Recommended bounded direction

Recommended direction for planning:

- keep the current `ImagePreviewLightbox` modal architecture
- preserve existing overlay rendering, zoom math, hover/highlight, and previous/next behavior
- add preview-local selected linked-face state on top of the current hover model
- add a linked-people strip below the image driven by exact current linked-face rows
- open a right-side consent preview panel only when a currently linked face/card is selected
- reuse the existing unlink route unchanged for "Remove link"
- reuse the existing manual-link route unchanged for "Change person", including `forceReplace` handling when required
- prefer a new bounded asset-preview-oriented read API for one selected asset
- lazy-load the change-person candidate list rather than embedding review-session/manual-link-state flows

This direction preserves current server-side business logic and keeps the feature focused on linked-face inspection and management inside the asset preview.

## Risks and tradeoffs

- Zero-face fallback links do not map naturally to overlay-linked cards or click-on-face selection. Including them in this UX complicates the surface quickly.
- If the plan chooses to support unlinked face selection, scope expands into candidate loading and manual linking for all faces, not just current linked ones.
- A side panel on smaller widths can make the image too small unless the layout stacks responsively.
- Change-person conflicts need explicit UI handling when the target consent is already linked elsewhere in the same asset.
- Adding a preview-specific read API improves boundedness but creates another read surface that must stay aligned with canonical link state.

## Open decisions for the plan phase

- Whether to add a new single-asset preview read API or minimally extend an existing one.
- Whether the linked-people strip should show only exact current linked faces or also out-of-band fallback/manual-photo links.
- Whether the right-side panel should open only for linked faces or also support unlinked face selection in a later phase.
- What minimal consent fields should appear in the right-side preview panel.
- Whether the change-person picker should be a compact modal or an expandable section inside the side panel.
- How to present and confirm `forceReplace` conflicts when replacing an existing manual link or targeting a consent already linked elsewhere on the asset.
- What responsive breakpoint should switch the right-side panel from side-by-side to stacked layout.
