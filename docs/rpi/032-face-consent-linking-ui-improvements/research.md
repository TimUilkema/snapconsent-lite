# Feature 032 Research: Face Consent Linking UI Improvements

## Goal

Research how to improve the face consent linking UI and operator workflow after Feature 031, without changing the core face-precedence domain model.

This research is code-first. Prior RPI docs were treated as intent only.

## Inputs reviewed

Required docs:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `UNCODEXIFY.MD`
- `docs/rpi/README.md`
- `docs/rpi/031-one-consent-per-face-precedence-rules/research.md`
- `docs/rpi/031-one-consent-per-face-precedence-rules/plan.md`

Primary Feature 031 code paths verified directly:

- `src/components/projects/consent-asset-matching-panel.tsx`
- `src/components/projects/photo-link-review-dialog.tsx`
- `src/components/projects/previewable-image.tsx`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/matchable/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/links/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/[assetId]/manual-link-state/route.ts`
- `src/lib/matching/consent-photo-matching.ts`
- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/face-materialization.ts`
- `src/lib/matching/providers/compreface.ts`
- `src/lib/assets/sign-asset-thumbnails.ts`
- `src/lib/matching/project-matching-progress.ts`
- `src/components/projects/project-matching-progress.tsx`
- `src/components/projects/assets-upload-form.tsx`

Schema and migrations verified directly:

- `supabase/migrations/20260320140000_019_face_materialization_pipeline.sql`
- `supabase/migrations/20260403170000_031_face_level_photo_linking.sql`

Relevant tests reviewed:

- `tests/feature-031-one-consent-per-face-precedence-rules.test.ts`

## Current verified behavior

### Feature 031 core model is already face-aware and should remain unchanged

Canonical current photo ownership now uses:

- `asset_face_consent_links`
- `asset_face_consent_link_suppressions`
- `asset_consent_manual_photo_fallbacks`
- `asset_consent_manual_photo_fallback_suppressions`

`asset_consent_links` remains the headshot-to-consent table.

Verified in:

- `supabase/migrations/20260403170000_031_face_level_photo_linking.sql`
- `src/lib/matching/photo-face-linking.ts`

Feature 032 should not redesign this model.

### Current manual review UI is single-asset only

The current review entry point is the consent matching panel:

- `src/components/projects/consent-asset-matching-panel.tsx`

Verified behavior:

- it loads matchable photos from `GET /api/projects/[projectId]/consents/[consentId]/assets/matchable`
- it loads current links from `GET /api/projects/[projectId]/consents/[consentId]/assets/links`
- each asset opens its own `PhotoLinkReviewDialog`
- there is no multi-select state
- there is no sequential review queue
- there is no persisted review progress
- there is no server-backed review session

The current `ReviewAsset` shape only carries:

- `id`
- `originalFilename`
- `thumbnailUrl`
- `previewUrl`

Important current gap:

- the matchable response already includes `candidateAssetFaceId` and `candidateFaceRank`
- `buildReviewAsset(...)` drops those fields
- likely-review mode therefore cannot preselect the suggested face

### Opening manual review is an immediate server-side materialization read path

Manual review state is loaded from:

- `GET /api/projects/[projectId]/consents/[consentId]/assets/[assetId]/manual-link-state`

Verified route behavior:

- authenticates the user with the server Supabase client
- derives `tenantId` server-side via `resolveTenantId(...)`
- calls `getManualPhotoLinkState(...)` with the admin client
- returns `Cache-Control: no-store, max-age=0`

Verified `getManualPhotoLinkState(...)` behavior in `src/lib/matching/photo-face-linking.ts`:

- verifies the consent belongs to the project and tenant
- requires `revoked_at is null`
- verifies the photo asset belongs to the project and tenant
- checks for current photo materialization for the configured materializer version
- if missing, attempts direct single-asset materialization via `ensureAssetFaceMaterialization(...)`
- only falls back to `enqueueMaterializeAssetFacesJob(... mode: "repair_requeue")` if direct materialization does not complete

Implication for Feature 032:

- `manual-link-state` is no longer a cheap read-only endpoint
- broad list prefetching of this endpoint would trigger real materialization work

### Current manual review state shape is bounded but minimal

The current `manual-link-state` response includes:

- `materializationStatus`: `"ready" | "queued" | "processing"`
- `assetId`
- `materializationId`
- `detectedFaceCount`
- `faces[]` with:
  - `assetFaceId`
  - `faceRank`
  - `faceBox`
  - `currentAssignee`
  - `isSuppressedForConsent`
  - `isCurrentConsentFace`
- `fallbackAllowed`
- `currentConsentLink`

Verified limits:

- no face crop URLs
- no face occupancy reason beyond current assignee summary
- no review queue metadata
- no resumable session metadata
- no explicit `failed` or `retryable` state

### Current manual link rules already enforce Feature 031 semantics

Verified in `src/lib/matching/photo-face-linking.ts`:

- zero faces:
  - face mode throws `photo_zero_faces_only_fallback`
  - asset fallback is allowed
- one face:
  - missing `assetFaceId` defaults to the sole face in `resolveRequestedFace(...)`
- multiple faces:
  - missing `assetFaceId` throws `photo_face_selection_required`
- stale or foreign face IDs:
  - throw `invalid_asset_face_id`
- revoked consent:
  - blocked server-side before read/write
- manual conflict on an already manually-owned face:
  - returns structured `manual_conflict`

Feature 032 should reuse these write semantics instead of adding client-side rules.

### Current write API is single-action, not batch-aware

Manual writes use:

- `POST /api/projects/[projectId]/consents/[consentId]/assets/links`
- `DELETE /api/projects/[projectId]/consents/[consentId]/assets/links`

Verified request shape:

- `assetId`
- `assetFaceId?`
- `mode?: "face" | "asset_fallback"`
- `forceReplace?`

Verified response behavior:

- structured `409` for `manual_conflict`
- `jsonError(...)` turns server `HttpError` into `{ error, message }`
- no bulk endpoint
- no batch partial-result format
- no idempotency key contract on these routes

Current duplicate safety comes from server-side upsert/delete semantics, not client request IDs.

### Current bulk helper exists, but it is legacy and not sufficient for 032

`src/lib/matching/consent-photo-matching.ts` still exports:

- `linkPhotosToConsent(...)`
- `unlinkPhotosFromConsent(...)`

Verified behavior:

- they accept `assetIds[]`
- they loop one asset at a time
- they call `manualLinkPhotoToConsent(... mode: "auto")` or `manualUnlinkPhotoFromConsent(... mode: "auto")`

Why this is not enough for Feature 032:

- it has no face-selection queue behavior
- it cannot distinguish zero-face, one-face, and multi-face assets up front
- it is not resumable
- it has no per-item progress or conflict aggregation

### Current UI state is not resumable across refresh/navigation

Verified in:

- `src/components/projects/consent-asset-matching-panel.tsx`
- `src/components/projects/photo-link-review-dialog.tsx`

Current behavior:

- review state exists only in React component state
- closing the panel or refreshing the page loses selection context
- there is no durable review cursor

Relevant repo precedent:

- `src/components/projects/assets-upload-form.tsx` persists upload queue state in `window.localStorage`

That is a useful pattern if Feature 032 chooses client-backed queue persistence, but it is not currently used for review.

### Current face crop thumbnails do not exist

Verified in schema and code:

- `asset_face_materialization_faces` stores `face_box` and `embedding`
- no crop path, crop bucket, crop status, or crop dimensions are stored
- `sign-asset-thumbnails.ts` only signs full-asset storage objects with resize transforms
- no repo-verified helper signs or serves face-specific crops

Current signed full-image behavior:

- short-lived signed URL TTL is 120 seconds
- preview and thumbnail URLs are generated at read time

Implication:

- any durable review session must not store signed URLs directly
- it must store asset/face identifiers and regenerate URLs on read

### Current overlay boxes are not in a guaranteed stable coordinate space

Overlay rendering is in:

- `src/components/projects/photo-link-review-dialog.tsx`

Verified client behavior:

- uses `img.naturalWidth` and `img.naturalHeight` from the preview URL
- converts `faceBox.x_min/x_max/y_min/y_max` into percentages against those dimensions

Stored box behavior is determined in:

- `src/lib/matching/face-materialization.ts`
- `src/lib/matching/providers/compreface.ts`

Verified pipeline behavior:

- `normalizeMaterializedFaceBox(...)` persists provider `x_min/y_min/x_max/y_max` as-is
- `preprocessImageForCompreFace(...)` may rotate, resize, and recompress the image before detection
- no original image width/height or normalized coordinates are stored alongside the face row

Implication:

- the persisted face boxes are in provider-processed image space, not explicitly original-image space
- the UI scales them against the signed preview image dimensions
- wrong overlay placement is therefore a data-model problem, not just a CSS bug

### Current pending/retry UX is functional but narrow

The current dialog handles:

- loading
- ready
- queued
- processing
- generic unavailable/error

It does not expose:

- failed vs retryable materialization
- stale-state conflict details beyond the next write error
- queue position or last-updated progress
- resumable sequential review progress

### Current project-level progress is broad, not review-specific

Project matching progress exists in:

- `src/lib/matching/project-matching-progress.ts`
- `src/components/projects/project-matching-progress.tsx`

Verified behavior:

- project-wide polling every 4 seconds while matching is in progress
- total/processed image counts
- degraded/stalled state

It is useful as ambient project context, but it does not answer:

- whether one specific review asset is ready
- what remains in a bulk review batch
- which multi-face assets still need operator action

## Topic-by-topic analysis

### 1. Bulk manual linking workflow

Desired workflow:

- multi-select assets from one consent
- confirm once
- zero-face assets link as explicit fallback
- one-face assets link directly to the sole face
- multi-face assets enter a review queue

Current repo state:

- list UI is single-select only
- write API is single-action only
- no queue/session model exists
- existing legacy `assetIds[]` helper is not 031-aware enough for operator review

Options considered:

- client-only batch loop over existing `POST /assets/links`
- client-backed queue persistence in `localStorage`
- durable server-backed review session

Recommended bounded direction:

- add a small server-backed bulk review session model
- prepare the batch server-side from selected asset IDs
- classify each item server-side into:
  - `linked_immediately_fallback`
  - `linked_immediately_single_face`
  - `requires_face_selection`
  - `blocked`
- keep actual canonical writes on the existing manual link endpoints or thin new session actions that reuse the same server logic

Why this is preferred:

- retry-safe and resumable across refresh/device changes
- one place to enforce tenant scope, revoked-consent checks, duplicate confirm handling, and partial-failure recovery
- cleaner handling when another operator changes ownership mid-review

### 2. Face crop thumbnails

Current repo state:

- face rows already exist per materialization
- no crop binary or crop metadata exists
- current signing helper only supports full-image transforms

Options considered:

- crop on the client from full preview images
- crop on-demand through signed transform URLs
- generate and store private face crops server-side during materialization

Client cropping is the weakest option:

- downloads more image data than needed
- leaks more full-photo context into the browser than necessary for small face chips
- makes sequential review slower
- does not help list/grid density

On-demand transform URLs are not verified in the repo for arbitrary face-rectangle crops.

Recommended bounded direction:

- generate private face crops server-side as part of materialization, or in an immediately-adjacent materialization derivative step
- store crop metadata tied to the face row or to a dedicated derivative table keyed by `asset_face_id`
- sign crop URLs on read just like current full-asset preview URLs

Minimum metadata that is currently missing:

- crop storage bucket/path
- crop version/source materialization reference
- crop dimensions
- crop generation status if the generation is asynchronous

Versioning/invalidation direction:

- tie each crop to the current `asset_face_materialization_faces.id`
- old crops become naturally obsolete when a new materialization replaces the face rows
- never treat crop URLs as durable session state

### 3. Bounding box overlay correctness

Current root cause is mixed coordinate spaces.

Verified facts:

- provider preprocessing may rotate/resize before detection
- stored `face_box` persists provider coordinates directly
- UI renders against preview dimensions
- no normalized source-space coordinates are persisted

Options considered:

- patch the CSS/DOM math only
- keep current stored boxes and add client heuristics
- store authoritative normalized box coordinates and source image dimensions at materialization time

Recommended bounded direction:

- fix this in the materialization data model, not only in the dialog
- persist face boxes in a stable normalized coordinate space
- also persist the source image dimensions used for that normalized space
- have the UI render overlays against the actual displayed image rect, not assumptions about the storage transform

If the provider must preprocess:

- map provider coordinates back into the oriented source image space before persistence
- if exact reverse mapping is not feasible immediately, store both:
  - provider-space dimensions
  - normalized provider-space box
  - explicit coordinate-space metadata

The plan phase should choose one explicit coordinate contract and use it everywhere.

### 4. Face review UX improvements

Current dialog is bounded and serviceable, but slow for operators:

- single asset at a time
- full-photo context only
- no crop strip
- no review queue
- no persisted cursor
- no keyboard navigation

Recommended bounded UX direction:

- keep one normal modal/dialog, not a new bespoke workspace
- add a sequential review queue only for assets that actually need face choice
- show:
  - full photo
  - face crop list
  - per-face status badge
  - clear primary action
- retain current state categories, but extend to:
  - pending
  - processing
  - retryable failure
  - blocked by revocation/conflict

Per-face badge candidates justified by current server data:

- `Current`
- `Suppressed`
- `Available`
- `Assigned manual`
- `Assigned auto`

Keyboard/mobile bounded improvements:

- arrow keys or next/previous buttons through review queue
- enter to confirm selected face
- explicit large tap targets for face chips
- preserve one-column mobile layout instead of introducing new desktop-only patterns

### 5. Read-path and prefetch improvements

Current important constraint:

- opening `manual-link-state` can directly materialize the asset

That makes aggressive prefetch risky.

Options considered:

- prefetch `manual-link-state` for every visible asset in the list
- prefetch only on hover/intent
- add a lighter readiness endpoint
- warm state only during explicit bulk prepare

Recommended bounded direction:

- do not scroll-prefetch `manual-link-state`
- optionally prefetch it only on strong intent signals:
  - hover
  - keyboard focus
  - opening a queued review session item
- for bulk mode, use a dedicated server prepare step that classifies assets once instead of N ad hoc GETs from the client

If faster open is still needed:

- add a lightweight batch readiness endpoint that reports current materialization availability without forcing direct materialization

### 6. API and state model implications

Current API is sufficient for single-asset review, but not for operator-efficient bulk review.

Likely Feature 032 additions:

- a server-side bulk review prepare endpoint
- a server-side review session read endpoint
- additions to `manual-link-state` response
- possibly a face-crop read field on review payloads

Recommended bounded direction:

- keep canonical link writes and conflict rules in existing `photo-face-linking.ts`
- add orchestration endpoints for review sessions instead of duplicating manual write semantics in the client

`manual-link-state` likely needs additive fields such as:

- face crop URL or crop token per face
- richer face status enum derived from existing booleans/assignee
- retryable materialization state if crop generation or materialization fails

Session durability recommendation:

- prefer server-backed session state for multi-select review
- allow client-side convenience caching, but do not rely on it as the source of truth

### 7. Security, reliability, and edge cases

Verified current strengths:

- tenant scoping is resolved server-side on all current review routes
- consent/project/asset membership is validated server-side
- revoked consent is blocked server-side
- internal errors are hidden behind generic `internal_error`
- signed URLs are short-lived and regenerated on read

Feature 032 must explicitly preserve these rules.

Important repo-specific edge cases:

- revoked consent mid-review:
  - current writes already fail
  - session/read endpoints must surface a clean blocked state
- stale `assetFaceId` after rematerialization:
  - current writes already return `invalid_asset_face_id`
  - review session items must refresh face state when this occurs
- another user links the same face while review is open:
  - current write path returns `manual_conflict` or updated current ownership
  - bulk session UX must treat this as item-level conflict, not session failure
- duplicate confirm clicks:
  - current write semantics are mostly idempotent
  - bulk orchestration should still avoid duplicate session transitions
- partial failures:
  - preparing a 100-asset batch can succeed for some items and fail for others
  - the session model should record per-item state explicitly
- signed face thumbnail URLs:
  - must be generated on read
  - must not be embedded durably in session rows

## Schema and storage impact

No Feature 032 research finding requires changing Feature 031 canonical link tables.

Likely new schema/storage work is limited to UI support:

- review-session tables if the plan chooses durable server-backed sessions
- face crop storage metadata
- overlay coordinate metadata

Most likely affected existing tables:

- `asset_face_materialization_faces`
- or a new face-derivatives table keyed by `asset_face_id`

Most likely new storage requirement:

- a private bucket or private path convention for face crops

## Options considered

### Option A: Pure client-side UX improvements on top of current APIs

Pros:

- smallest API surface
- quick to build

Cons:

- weak resumability
- poor bulk retry handling
- conflicts and partial failures become client orchestration problems
- no clean home for durable progress

This is too fragile for the user’s stated production workflow.

### Option B: Server-backed review session plus additive review read models

Pros:

- retry-safe bulk prepare/confirm flow
- durable progress across refresh and navigation
- cleaner handling of mid-review conflicts and revocation
- lets UI stay fairly normal and bounded

Cons:

- adds schema and read orchestration
- slightly larger implementation than client-only queue state

This is the preferred direction.

### Option C: Fix only the dialog visuals and leave bulk workflow out

Pros:

- narrowest scope

Cons:

- does not solve the highest-value operator efficiency problem
- leaves repeated open/save/close loops for large consent reviews

This is too small if Feature 032 is meant to address workflow efficiency.

## Recommended bounded direction

1. Keep Feature 031 canonical writes and precedence rules unchanged.
2. Add a bounded server-backed bulk review session for one consent at a time.
3. During session prepare, classify selected assets server-side into:
   - immediate zero-face fallback
   - immediate one-face link
   - requires multi-face review
   - blocked/conflict
4. Keep manual link/unlink business logic in `photo-face-linking.ts`; session actions should reuse it.
5. Add private face crop generation tied to current materialized faces.
6. Fix overlay correctness by defining and persisting one stable box coordinate contract.
7. Extend the current dialog into a sequential review queue UI instead of inventing a new shell.
8. Avoid broad `manual-link-state` prefetch; use explicit prepare or strong-intent warming only.

## Risks and tradeoffs

- Direct materialization on manual review means careless prefetch can create background churn.
- Face crop generation inside materialization can lengthen materialization latency unless kept bounded.
- Server-backed sessions add schema and cleanup responsibilities.
- Overlay correctness may require provider-space to source-space remapping work, which is more than a CSS patch.
- Short-lived signed URLs mean review reads must regenerate media links frequently.

## Open decisions for Plan phase

1. Bulk review session model:
   - durable DB-backed session
   - or explicitly bounded client-backed queue persistence
2. Session scope:
   - one open session per consent
   - or multiple concurrent sessions per consent/user
3. Immediate bulk classification behavior:
   - whether zero-face and one-face items are written synchronously during prepare
   - or staged as explicit confirm steps within the session
4. Face crop storage model:
   - metadata columns on `asset_face_materialization_faces`
   - or a dedicated derivative table keyed by `asset_face_id`
5. Crop generation timing:
   - inline during materialization
   - or asynchronous derivative generation after materialization
6. Overlay coordinate contract:
   - normalized source-image coordinates
   - or explicit provider-space coordinates plus dimensions as an intermediate step
7. `manual-link-state` shape:
   - whether to extend it for richer single-asset review
   - or keep it lean and introduce a separate review-session read model
8. Retry UX:
   - whether materialization/crop failure gets a first-class retryable state in the review dialog
   - or remains a generic unavailable/error state for 032
