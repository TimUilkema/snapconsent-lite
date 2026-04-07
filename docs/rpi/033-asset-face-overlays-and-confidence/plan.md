# Feature 033 Plan: Asset Face Overlays And Review Confidence

## Goal

Implement two additive UI improvements:

- show the current consent's confidence percentage on review bounding boxes
- show linked face overlays in the project asset grid, with the linked consent headshot and a direct path to the consent details already present on the project page

No schema change is required for this feature.

## Implementation steps

### 1. Extend review read models with current-consent confidence

In `src/lib/matching/photo-face-linking.ts`:

- add a helper that loads current compare evidence for one consent across one or more assets
- validate compare rows against:
  - current compare version
  - current asset materialization id
  - current headshot materialization id
  - `compare_status = matched`
- return a per-asset-face confidence map

Use that helper in:

- `buildReadyManualPhotoLinkState(...)`
- the review-session read-model builder in `face-review-sessions.ts`

Add `matchConfidence: number | null` to:

- `ManualPhotoLinkState.faces[]`
- `FaceReviewFaceReadModel`
- serialized API responses
- client-side dialog types

### 2. Render the confidence badge in the review dialog

Update `src/components/projects/photo-link-review-dialog.tsx` to:

- accept `matchConfidence` on both single-review and queue faces
- render a small bottom-right badge inside the bounding box when confidence exists
- format it as a percentage

The badge should be:

- visually compact
- readable over the image
- non-blocking for face selection

### 3. Add a linked-face overlay read helper for asset pages

In `src/lib/matching/photo-face-linking.ts` add an exported helper that, for a set of asset ids, returns current face-level links only:

- `assetId`
- `assetFaceId`
- `consentId`
- `faceRank`
- `faceBoxNormalized`
- `linkSource`
- `matchConfidence`

Rules:

- ignore stale rows whose `asset_materialization_id` is not the current materialization
- ignore links whose linked face is missing from the current materialization
- do not include zero-face fallback rows, because they have no box to draw

Re-export it from `src/lib/matching/consent-photo-matching.ts`.

### 4. Enrich the assets API with overlay data

In `src/app/api/projects/[projectId]/assets/route.ts`:

- keep current count/filter behavior
- load current linked-face overlays for the page asset ids
- load consent summaries for overlay consent ids
- load current consent headshot assets with `loadCurrentProjectConsentHeadshots(...)`
- sign small headshot thumbnails
- return `linkedFaceOverlays[]` per asset

Each overlay item should include:

- `consentId`
- `fullName`
- `email`
- `headshotThumbnailUrl`
- `faceBoxNormalized`
- `linkSource`
- `matchConfidence`

Also change the card image signing/display contract to preserve the full photo shape for overlay accuracy.

### 5. Render asset-grid overlays

In `src/components/projects/assets-list.tsx`:

- extend the asset response type with `linkedFaceOverlays`
- render each card preview in a measured container
- reuse `getFaceOverlayStyle(...)`
- draw overlays only for linked faces
- show the consent headshot inside each overlay
- make the overlay clickable to the consent details target

Keep the existing image preview interaction intact where the overlay is not clicked.

### 6. Add consent deep-link opening on the project page

In `src/app/(protected)/projects/[projectId]/page.tsx`:

- accept `searchParams`
- derive `openConsentId`
- add a stable id for each consent details block
- render the matching `<details>` as open when `openConsentId` matches

Overlay href shape:

- `/projects/${projectId}?openConsentId=${consentId}#consent-${consentId}`

### 7. Verification

Add/update tests for:

- the new confidence mapping helper or read-model behavior
- the linked-face overlay helper filtering stale links correctly
- overlay utility behavior if its signature changes

Run targeted tests after implementation.

## Security and reliability

- All consent/headshot/link lookups remain server-side and tenant-scoped.
- No tenant id is accepted from the client.
- Asset-grid overlays must ignore stale materialization rows to avoid drawing wrong boxes.
- Consent deep-link opening is read-only UI state; it must not affect canonical data.

## Edge cases

- If no current compare exists for the current consent/face, the review badge is omitted.
- If a linked consent has no signable current headshot, render the overlay without the image but keep it clickable.
- Zero-face fallback links still count as linked consents but do not create overlays.
- Multiple linked faces in one photo should all render their own overlays independently.
