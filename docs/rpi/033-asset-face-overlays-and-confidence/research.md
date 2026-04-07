# Feature 033 Research: Asset Face Overlays And Review Confidence

## Goal

Add two operator-facing UI improvements on top of the existing face-linking system:

- show the current consent's face-match confidence on review bounding boxes when compare data exists
- show linked face overlays in the project asset grid, including the linked consent headshot and a direct way to open that consent form

This research is grounded in the current checked-in code, not prior assumptions.

## Inputs reviewed

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `UNCODEXIFY.MD`
- `docs/rpi/README.md`
- `docs/rpi/032-face-consent-linking-ui-improvements/research.md`
- `docs/rpi/032-face-consent-linking-ui-improvements/plan.md`

Primary code paths verified:

- `src/components/projects/assets-list.tsx`
- `src/components/projects/previewable-image.tsx`
- `src/components/projects/photo-link-review-dialog.tsx`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/app/api/projects/[projectId]/assets/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/matchable/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/[assetId]/manual-link-state/route.ts`
- `src/lib/client/face-overlay.ts`
- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/face-review-sessions.ts`
- `src/lib/matching/face-review-response.ts`
- `src/lib/matching/face-materialization.ts`

## Current verified behavior

### Review UI already has face boxes but no confidence label

`PhotoLinkReviewDialog` renders face overlays from `faceBoxNormalized` using `getFaceOverlayStyle(...)`.

Verified current response shapes:

- single-asset review state returns `faces[]` with:
  - `assetFaceId`
  - `faceRank`
  - `faceBox`
  - `faceBoxNormalized`
  - `cropUrl`
  - status/assignee flags
- review-session state returns `faces[]` with:
  - `assetFaceId`
  - `faceRank`
  - `faceBoxNormalized`
  - `cropUrl`
  - status/assignee flags

Neither path currently includes a per-face confidence field, so the dialog has nothing to display.

### The repo already stores enough evidence to surface confidence for the current consent

Verified relevant data sources in `photo-face-linking.ts`:

- `asset_face_consent_links.match_confidence`
- `asset_consent_face_compares.winning_similarity`
- `asset_consent_face_compares.winning_asset_face_id`
- `asset_consent_face_compares.asset_materialization_id`
- `asset_consent_face_compares.headshot_materialization_id`

Important limitation:

- compare rows identify only the winning face for a given `(asset, consent)` pair
- the current system does not store a scored confidence for every detected face in the image

Implication:

- Feature 033 can truthfully show confidence on the winning face for the current consent
- it cannot show distinct confidence percentages for all non-winning faces without a schema/model change

### Asset list API does not expose face geometry or consent headshots

`GET /api/projects/[projectId]/assets` currently returns, per asset:

- file metadata
- thumbnail/preview URLs
- linked consent count
- linked people summary

It does not return:

- current linked face ids
- normalized face boxes
- link source/confidence per linked face
- linked consent headshot thumbnail
- a direct consent target

### Existing asset-list thumbnail rendering is not suitable for accurate face overlays as-is

`assets-list.tsx` currently renders square cards with:

- `PreviewableImage`
- `imageClassName="h-full w-full object-cover"`

The current assets route signs the card image with the default square thumbnail transform, which is also crop-oriented.

Implication:

- bounding boxes cannot reliably align over a cropped square thumbnail
- the grid needs either:
  - a contain-style image source/render path, or
  - cover-specific geometry math with a non-cropped source contract

The simplest safe choice is to use a contained display source for the grid image and reuse the existing normalized overlay math.

### There is no dedicated consent detail route

The current project page shows consent details inline inside invite cards:

- `src/app/(protected)/projects/[projectId]/page.tsx`

Each consent lives in a `<details>` block, opened manually by the user. There is no dedicated `/consents/[consentId]` page.

Implication:

- “open this consent form” from an asset overlay needs to target the existing project page
- the cleanest bounded approach is a query param or anchor that opens the matching `<details>` block on load

### Headshot lookup already exists and is reusable

The project page already uses:

- `loadCurrentProjectConsentHeadshots(...)`
- `signThumbnailUrlsForAssets(...)`

That is enough to build small consent headshot thumbnails for asset-grid overlays without changing schema.

## Recommended implementation direction

### 1. Add face confidence to review read models

Extend:

- `ManualPhotoLinkState.faces[]`
- `FaceReviewFaceReadModel`
- `face-review-response.ts` serializers
- `photo-link-review-dialog.tsx` client types

Use current-consent compare evidence to attach:

- `matchConfidence: number | null`

Rules:

- only show it when the compare/headshot/materialization evidence is current
- fall back to the current face link's stored `match_confidence` when appropriate
- do not invent confidence for non-winning faces

### 2. Add a current linked-face overlay read helper for the asset grid

Add a helper in `photo-face-linking.ts` that returns only current face-level links for the requested asset ids:

- current materialization only
- normalized face box
- face rank
- consent id
- link source
- stored match confidence

Then enrich that in the assets API with:

- consent summary
- headshot thumbnail URL
- consent href/query target

### 3. Open consent details from asset overlays via project-page state

Use a bounded project-page enhancement:

- accept `searchParams.openConsentId`
- open the matching consent `<details>` block on render
- add a stable anchor id like `consent-${consentId}`

This avoids inventing a new route just for grid navigation.

### 4. Keep the overlay UI plain

Per `UNCODEXIFY.MD`, the overlay should stay functional:

- existing image card
- simple face rectangle
- compact headshot thumbnail inside the overlay
- clickable link target
- no new decorative shell or dashboard treatment

## Risks and edge cases

- Confidence is only valid for the current winning face. Showing badges on all faces would overstate what the data means.
- Linked face overlays must ignore stale links from old materializations.
- Some linked consents may have no currently signable headshot; the overlay should still remain clickable with a text fallback if needed.
- The asset grid must continue to respect tenant scoping; all consent/headshot enrichment must stay server-side.
- Opening a consent form by query param must not auto-open unrelated consent cards.

