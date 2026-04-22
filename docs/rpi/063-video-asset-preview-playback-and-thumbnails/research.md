# Feature 063 Research: Video Asset Preview Playback and Thumbnails

## Scope

Research the smallest production-safe step after Feature 062 that:

- lets uploaded video assets open in the project asset preview surface
- supports basic in-app playback for private video assets
- replaces the current video placeholder tile with a real thumbnail/poster
- keeps the existing private storage, create/finalize, and derivative-worker foundations where they still fit

This document is research only. The live repository is the source of truth. Prior RPI docs were used as history and intent, not as binding fact.

## Inputs reviewed

### Core repo docs

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `docs/rpi/README.md`

### Prior RPI docs

5. `docs/rpi/008-asset-thumbnails/research.md`
6. `docs/rpi/008-asset-thumbnails/plan.md`
7. `docs/rpi/038-original-image-ingest-and-display-derivatives/research.md`
8. `docs/rpi/038-original-image-ingest-and-display-derivatives/plan.md`
9. `docs/rpi/061-link-consent-to-whole-asset/research.md`
10. `docs/rpi/061-link-consent-to-whole-asset/plan.md`
11. `docs/rpi/062-video-upload-foundation/research.md`
12. `docs/rpi/062-video-upload-foundation/plan.md`
13. `docs/rpi/004-project-assets/research.md`
14. `docs/rpi/004-project-assets/plan.md`
15. `docs/rpi/043-simple-project-export-zip/research.md`
16. `docs/rpi/043-simple-project-export-zip/plan.md`

### Live code, schema, and tests verified directly

- `src/lib/assets/asset-upload-policy.ts`
- `src/lib/assets/create-asset.ts`
- `src/lib/assets/finalize-asset.ts`
- `src/lib/assets/prepare-project-asset-batch.ts`
- `src/lib/assets/finalize-project-asset-batch.ts`
- `src/lib/assets/post-finalize-processing.ts`
- `src/lib/assets/sign-asset-thumbnails.ts`
- `src/lib/assets/asset-image-derivatives.ts`
- `src/lib/assets/asset-image-derivative-worker.ts`
- `src/lib/assets/asset-image-derivative-repair.ts`
- `src/lib/matching/asset-preview-linking.ts`
- `src/app/api/projects/[projectId]/assets/route.ts`
- `src/app/api/projects/[projectId]/assets/preflight/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`
- `src/app/api/projects/[projectId]/assets/batch/prepare/route.ts`
- `src/app/api/projects/[projectId]/assets/batch/finalize/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/preview-faces/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/whole-asset-candidates/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/whole-asset-links/route.ts`
- `src/app/api/internal/assets/worker/route.ts`
- `src/app/api/internal/assets/repair/route.ts`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/components/projects/assets-list.tsx`
- `src/components/projects/project-asset-preview-lightbox.tsx`
- `src/components/projects/previewable-image.tsx`
- `package.json`
- `supabase/migrations/20260305120000_004_assets_schema.sql`
- `supabase/migrations/20260305121000_004_assets_rls.sql`
- `supabase/migrations/20260305122000_004_assets_storage.sql`
- `supabase/migrations/20260305150000_005_assets_content_hash.sql`
- `supabase/migrations/20260306100000_006_headshot_consent_schema.sql`
- `supabase/migrations/20260407133000_038_asset_image_derivative_pipeline.sql`
- `supabase/migrations/20260421120000_062_video_asset_type.sql`
- `tests/feature-024-upload-performance-resumability.test.ts`
- `tests/feature-038-asset-image-derivatives.test.ts`
- `tests/feature-062-video-upload-foundation.test.ts`

## Verified current video asset, grid, and preview boundary

## 1. Video assets are now first-class `assets` rows, but only at the upload/store/list level

Live code after Feature 062 confirms:

- `assets.asset_type` now allows `video` via `20260421120000_062_video_asset_type.sql`
- upload policy accepts `.mp4`, `.mov`, and `.webm` with a `250 MB` cap in `asset-upload-policy.ts`
- `createAssetWithIdempotency(...)` accepts `assetType: "video"` and writes the same private `project-assets` bucket/path pattern as photos
- batch prepare accepts `assetType: "photo" | "video"`
- finalize returns `assetType: "photo" | "headshot" | "video"`

Current storage remains:

- bucket: `project-assets`
- path: `tenant/<tenantId>/project/<projectId>/asset/<assetId>/<filename>`
- tenant and project scope derived server-side

## 2. The grid already lists videos, but only as placeholder cards

The live project assets route already returns both photos and videos:

- `src/app/api/projects/[projectId]/assets/route.ts` queries `.in("asset_type", ["photo", "video"])`
- photo rows get signed thumbnail and preview URLs plus review data
- video rows currently fall through to:
  - `thumbnailUrl: null`
  - `previewUrl: null`
  - `thumbnailState: "unavailable"`
  - `previewState: "unavailable"`
  - no face overlays
  - no review metadata

The live grid UI confirms the current behavior:

- `assets-list.tsx` treats only `assetType === "photo"` as previewable
- `VideoAssetPlaceholder` renders the current generic tile
- video rows show a localized `Video` badge
- no click handler opens preview for video cards

So after 062, videos upload and list correctly, but the user still only sees placeholder cards.

## 3. Clicking a video card currently does not open a preview surface

Live UI behavior is explicit:

- `isPreviewableAssetType("photo") === true`
- `isPreviewableAssetType("video") === false`
- `ProjectAssetPreviewLightbox` is only mounted when the selected asset is previewable

This matches the 062 test coverage in `tests/feature-062-video-upload-foundation.test.ts`.

## 4. The current preview/lightbox stack is photo-only end to end

This is the strongest live boundary for 063.

`ProjectAssetPreviewLightbox` currently:

- wraps `ImagePreviewLightbox` from `previewable-image.tsx`
- assumes an image `src`
- fetches `/api/projects/[projectId]/assets/[assetId]/preview-faces`
- renders face overlays, whole-asset links, face linking trays, hide/block/manual-face actions

The preview backend also hard-rejects non-photo assets:

- `requirePhotoAsset(...)` in `src/lib/matching/asset-preview-linking.ts`
- `asset.asset_type !== "photo"` returns `404`

That means current preview routes and current preview UI cannot simply be pointed at a video row. A video branch has to bypass the face-review read model.

## 5. Private signed URL access already exists and is close to usable for basic video playback

Live signing code shows:

- `signOriginalAssetUrl(...)` signs any uploaded private object without checking `asset_type`
- `resolveSignedAssetDisplayUrl(...)` can fall back to the signed original object
- signed URLs are server-generated only

Inference from current code:

- the same signed private object model should be able to serve basic video playback URLs because there is no asset-type restriction in the signer

Important live caveats:

- the current display helper is image-oriented
- its `SIGNED_URL_TTL_SECONDS` is only `120`
- its state names include `transform_fallback`, which does not fit video playback semantics
- `enqueueMissingDerivative` and derivative repair helpers assume image derivatives and would currently try to queue missing derivatives for any asset id passed to them

So the private access foundation is reusable, but the current helper cannot be reused blindly for video playback.

## 6. There is no live video poster or thumbnail generation path

Verified current state:

- no poster columns on `assets`
- no `asset_video_posters` table
- no duration, codec, or video dimension metadata on `assets`
- no ffmpeg or equivalent media binary dependency in `package.json`
- current worker uses `sharp` only
- current repair scans `asset_type = 'photo'` only

Live derivative code is still image-source-specific in practice:

- `queueProjectAssetPostFinalizeProcessing(...)` only queues image derivatives for `photo`
- `asset-image-derivative-worker.ts` downloads the source asset and sends it to `sharp`
- if a video asset were queued into the current worker, `sharp` decode would fail and the derivative would go dead

## Current schema, routes, components, and helpers involved

### Schema and storage

- `public.assets`
- `public.asset_image_derivatives`
- private storage buckets:
  - `project-assets`
  - `asset-image-derivatives`

### Upload and finalize

- `src/lib/assets/create-asset.ts`
- `src/lib/assets/finalize-asset.ts`
- `src/lib/assets/prepare-project-asset-batch.ts`
- `src/lib/assets/finalize-project-asset-batch.ts`
- `src/lib/assets/post-finalize-processing.ts`

### Asset list and current preview

- `src/app/api/projects/[projectId]/assets/route.ts`
- `src/components/projects/assets-list.tsx`
- `src/components/projects/project-asset-preview-lightbox.tsx`
- `src/components/projects/previewable-image.tsx`

### Private URL and derivative helpers

- `src/lib/assets/sign-asset-thumbnails.ts`
- `src/lib/assets/asset-image-derivatives.ts`
- `src/lib/assets/asset-image-derivative-worker.ts`
- `src/lib/assets/asset-image-derivative-repair.ts`

### Internal worker and repair seams

- `src/app/api/internal/assets/worker/route.ts`
- `src/app/api/internal/assets/repair/route.ts`

### Photo-only preview read model that video must bypass

- `src/lib/matching/asset-preview-linking.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/preview-faces/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/whole-asset-candidates/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/whole-asset-links/route.ts`

## Options considered

## 1. Video preview surface

### Option A: use the existing project asset preview surface and branch between photo and video

Description:

- keep one project asset preview entry point
- when `assetType === "photo"`, keep the current lightbox behavior
- when `assetType === "video"`, render a native `<video>` player with signed private playback URL

Pros:

- preserves one preview affordance for assets
- reuses current grid-to-preview interaction
- keeps video scope bounded to playback, not face review
- avoids a second product surface

Cons:

- the current `ProjectAssetPreviewLightbox` is deeply photo-specific, so the branch must happen near the top, not deep inside the current face-review flow

Assessment:

- recommended

### Option B: introduce a separate video-only modal

Pros:

- isolates video logic from the photo preview component

Cons:

- creates a second preview surface for users
- duplicates modal shell behavior that the app already has
- adds product-level inconsistency without a strong technical need

Assessment:

- not recommended for the first slice

### Recommendation

Use Option A, but implement it as a clean top-level branch:

- keep the current photo lightbox intact
- add a bounded video preview branch that reuses the same overall preview surface entry point
- do not route video through the face-preview APIs or photo-review trays

This is not a separate product modal. It is one asset preview surface with two media-specific bodies.

## 2. Video poster storage model

### Option 1: reuse `asset_image_derivatives`

Description:

- generate image derivatives for video assets too
- keep using `thumbnail` and `preview` derivative kinds
- grid uses the `thumbnail` poster
- preview modal uses the `preview` poster as the `<video poster>`

Pros:

- strongest reuse of existing storage, signing, queue, and repair seams
- current derivative table already stores image outputs, and posters are image outputs
- current grid and list code already understands thumbnail vs preview derivative patterns
- no new table is strictly required

Cons:

- some helper names remain image/photo oriented
- worker and repair logic must be widened carefully so video does not go through the current `sharp` path

Assessment:

- recommended

### Option 2: add a separate `asset_video_posters` seam

Pros:

- cleaner source-media semantics

Cons:

- duplicates queue, repair, signing, and UI selection logic
- larger than this feature needs

Assessment:

- not recommended for the first slice

### Recommendation

Store video posters in the current `asset_image_derivatives` model.

Reason:

- the outputs are still images
- the table is already variant-based and keyed by asset id
- using both `thumbnail` and `preview` variants keeps grid and modal semantics aligned with the current photo derivative model

The plan phase should widen the worker and repair paths, not create a parallel poster subsystem.

## Recommended video preview model

Use signed private original-object playback with a native HTML `<video>` element.

Recommended first-slice behavior:

- open from the existing project asset preview entry point
- `<video controls playsInline preload="metadata">`
- signed original private storage URL as the source
- preview poster image from the derivative pipeline when available
- localized loading and error states

Native controls cover the required bounded behavior:

- play/pause
- seek/scrub
- mute and volume
- fullscreen where the browser supports it

Custom transport controls are not needed for 063.

## Recommended private video access model

Keep the current private bucket model and server-side signed URL model.

Recommended adjustments:

1. Add a dedicated video playback signing helper or widen the existing signing helper with a clearly named video path.
2. Use the signed original object for playback. Do not transcode in this slice.
3. Use a longer TTL for playback than the current image-display `120` seconds.

Recommended bounded default:

- playback URL TTL around 15 minutes

Why a longer TTL is warranted:

- video seeks and pause/resume commonly outlast a 2-minute image-preview TTL
- this avoids forcing token-refresh redesign just for basic playback

Important implementation constraint:

- do not reuse the current `transform_fallback` state naming for video playback
- do not call the current derivative enqueue path for video playback signing unless the worker has already been widened for video posters

## Recommended video poster and thumbnail model

Generate two JPEG poster derivatives from one deterministic frame:

- `thumbnail` derivative for the grid
- `preview` derivative for the modal poster

Recommended generation point:

- background post-finalize processing

Recommended processing approach:

- keep the current finalize flow fast
- enqueue video derivatives after finalize just like photo derivatives
- branch in the derivative worker by source `asset_type`
  - `photo` -> existing `sharp` path
  - `video` -> frame extraction plus JPEG resize path

Minimal additional dependency:

- a bounded ffmpeg-based extraction path is likely required

Current live evidence for that conclusion:

- `sharp` is present
- no current library can decode video frames
- no ffmpeg dependency is installed yet

The recommended 063 change is not a transcoding platform. It is a single-frame extraction step plus existing JPEG derivative sizing.

## Recommended default thumbnail timestamp strategy

Use a fixed offset of `1.0s`, with a fallback attempt at `0.0s`.

Recommended rule:

1. Try to extract the poster frame at `1.0s`.
2. If that fails because the asset is too short or frame extraction cannot seek there, retry at `0.0s`.
3. If both fail, mark the derivative dead and fall back to the current placeholder UI.

Why this is the best bounded default:

- first frame often lands on black slates or encoder artifacts
- midpoint requires probing duration and adds unnecessary complexity
- first non-black frame requires media analysis and is out of scope
- `1.0s` is deterministic, cheap, and usually more representative than frame zero for short B2B project clips

## Recommended fit with the current grid and preview modal

## Grid

For video rows after 063:

- show a real poster thumbnail when `thumbnail` derivative is ready
- keep the localized `Video` badge
- keep filename, size, and added date treatment
- make the tile open the preview surface

Fallback states:

- poster pending: keep the current video placeholder tile, but allow preview open
- poster dead or missing: keep the current video placeholder tile, but allow preview open

The video should remain usable even when poster generation is delayed or fails.

## Preview modal

Recommended bounded video behavior:

- branch early on `assetType === "video"`
- skip all face-overlay, linking, hidden-face, blocked-face, and whole-asset-link preview logic
- render:
  - video title
  - optional metadata line already used by photo preview shell
  - native `<video controls playsInline preload="metadata">`
  - `poster` from the preview derivative when available
  - localized loading and playback-error text

This keeps the current photo preview stack untouched while still reusing the existing asset preview surface.

## Worker and repair considerations

Recommended 063 worker model:

- keep one derivative queue and one derivative repair path
- widen them to include video assets
- branch processing by source `asset_type`

Required live-code changes implied by the research:

- `queueProjectAssetPostFinalizeProcessing(...)` should enqueue derivatives for `video` as well as `photo`
- `runAssetImageDerivativeRepair(...)` should stop scanning only `asset_type = 'photo'`
- `asset-image-derivative-worker.ts` must detect `asset_type = 'video'` and use frame extraction instead of `sharp` decode of the source asset

Safe failure model:

- upload and finalize still succeed if poster generation fails
- derivative failure should not archive or invalidate the original video asset
- repair can requeue missing or dead poster derivatives later

## Security and reliability considerations

- Tenant and project scope must stay server-derived exactly as today.
- Never accept `tenant_id`, `storage_bucket`, `storage_path`, or poster metadata from the client.
- Keep all playback and poster URL signing server-side.
- Keep `project-assets` and `asset-image-derivatives` private.
- Do not expose the service role key to the client.
- Keep post-finalize processing idempotent. Duplicate finalize calls must not create duplicate derivative rows.
- Poster storage paths should remain deterministic so retries overwrite the same objects.
- Video preview should use `preload="metadata"` to avoid pulling the full file immediately.
- The current 062 upload cap of `250 MB` is still an important guardrail because there is no resumable upload or adaptive streaming in this slice.

Important bounded reliability limitation from live code:

- accepted video container types do not guarantee browser playback codec support

Because 062 accepts containers, not codecs, 063 should expect some uploads to:

- store successfully
- generate posters successfully
- still fail in the browser player

That is acceptable for this bounded slice if the modal shows a localized playback error and the asset remains listed.

## Edge cases

- Video has no poster yet: show placeholder in the grid and still allow playback preview.
- Poster generation fails permanently: keep placeholder fallback and allow playback preview.
- User clicks video while poster is pending: open the modal and play from the signed original URL without waiting for poster completion.
- Very short video under 1 second: poster extraction should retry at `0.0s`.
- Playback URL expires mid-session: use a longer playback TTL than image previews and accept reopen/retry rather than designing token refresh now.
- Browser cannot play the uploaded codec: show localized error state in the modal.
- Large videos: keep native `preload="metadata"` and preserve the 062 size cap.
- Missing original storage object: playback should fail clearly; poster generation should fail safely and not hide the asset row.
- Signed poster generation or playback signing failure: keep the row visible and show placeholder or modal error rather than breaking the list page.

## Explicitly deferred work

- timeline hover preview thumbnails
- scrub-strip thumbnails
- adaptive streaming
- HLS or DASH
- transcoded playback renditions
- codec normalization
- video duration or codec metadata modeling
- video matching, review, or linking
- export redesign
- frame-level or face-level video analysis
- long-session token refresh redesign
- custom player controls beyond what native browser controls already provide

## Recommended smallest usable 063 slice

Candidate 1 is the right scope:

- real poster thumbnail in the grid
- basic private video playback in the existing asset preview surface
- native browser controls
- placeholder fallback if poster generation fails

Do not expand 063 into a custom player or a broader media platform.

## Open decisions for the plan phase

1. Exact playback URL delivery shape.
   - Recommended direction: add a dedicated video playback URL field rather than overloading photo-oriented `previewState` semantics.

2. Exact signing moment for playback URLs.
   - Recommended direction: either sign current-page video rows in the assets list response or sign on modal open. Both fit the current architecture.

3. Exact ffmpeg packaging choice.
   - Recommended direction: use a small server-side ffmpeg dependency or documented runtime binary, not a larger media stack redesign.

4. Exact poster derivative count.
   - Recommended direction: generate both `thumbnail` and `preview` poster derivatives from the same frame so grid and modal stay aligned with the current photo derivative pattern.

5. Exact playback error UX for unsupported codecs.
   - Recommended direction: localized modal error only, without changing 062 upload acceptance in this cycle.

## Research outcome

The live repo already has the right private-storage, signed-URL, upload, finalize, and asset-grid foundations for 063.

The real blockers are narrower:

- the preview surface is still photo-only
- the derivative worker is still image-source-only
- repair only scans photo assets
- there is no poster extraction dependency yet
- the current display signing helper is still image-state-oriented

The smallest coherent production-safe next step is:

- keep one asset preview surface
- branch it cleanly between photo and video
- play videos from signed private original URLs with native `<video>` controls
- generate video poster derivatives in the existing derivative model through post-finalize background work
- use a deterministic `1.0s` frame with `0.0s` fallback
- preserve current placeholder behavior whenever poster generation is pending or fails

That is additive, bounded, reuse-heavy, and appropriate for one normal RPI cycle.
