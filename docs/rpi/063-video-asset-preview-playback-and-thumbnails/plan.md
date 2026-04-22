# Feature 063 Plan - Video Asset Preview Playback and Thumbnails

## Inputs and ground truth

Primary synthesized input:

- `docs/rpi/063-video-asset-preview-playback-and-thumbnails/research.md`

Required repo context re-read before planning:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`

Targeted live verification completed against:

- `src/lib/assets/asset-upload-policy.ts`
- `src/lib/assets/create-asset.ts`
- `src/lib/assets/finalize-asset.ts`
- `src/lib/assets/prepare-project-asset-batch.ts`
- `src/lib/assets/finalize-project-asset-batch.ts`
- `src/lib/assets/post-finalize-processing.ts`
- `supabase/migrations/20260421120000_062_video_asset_type.sql`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/components/projects/assets-list.tsx`
- `src/components/projects/project-asset-preview-lightbox.tsx`
- `src/components/projects/previewable-image.tsx`
- `src/app/api/projects/[projectId]/assets/route.ts`
- `src/lib/assets/sign-asset-thumbnails.ts`
- `src/lib/assets/asset-image-derivatives.ts`
- `src/lib/assets/asset-image-derivative-worker.ts`
- `src/lib/assets/asset-image-derivative-repair.ts`
- `src/app/api/internal/assets/worker/route.ts`
- `src/app/api/internal/assets/repair/route.ts`
- `supabase/migrations/20260407133000_038_asset_image_derivative_pipeline.sql`
- `src/lib/matching/asset-preview-linking.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/preview-faces/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/whole-asset-candidates/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/whole-asset-links/route.ts`
- `tests/feature-024-upload-performance-resumability.test.ts`
- `tests/feature-038-asset-image-derivatives.test.ts`
- `tests/feature-062-video-upload-foundation.test.ts`

Live code and schema are treated as source of truth where they differ from older docs.

## Verified current planning boundary

### Upload and asset model after 062

- Project uploads already accept `assetType: "video"` alongside `photo`.
- Video uploads are stored in the same private project asset bucket/path model as photos.
- `createAssetWithIdempotency`, batch prepare, `finalizeAsset`, and batch finalize already support `video`.
- `finalizeAsset` does not route videos into consent linking.
- `queueProjectAssetPostFinalizeProcessing` currently enqueues image derivatives only for `photo`.
- Photo matching enqueue remains photo-only and already excludes video.

### Current project assets grid and preview boundary

- The project assets API already lists uploaded `photo` and `video` rows.
- Photo rows receive signed thumbnail/preview display URLs plus review/linking metadata.
- Video rows currently return `thumbnailUrl: null`, `previewUrl: null`, and `thumbnailState` / `previewState` effectively unavailable.
- `AssetsList` currently treats only photos as previewable.
- Video cards render `VideoAssetPlaceholder` and show a `videoBadge`.
- Clicking a video row does not open the preview surface.

### Current preview surface boundary

- `ProjectAssetPreviewLightbox` is a large photo-specific surface with face overlays, face trays, preview-faces fetches, whole-asset linking, hidden face handling, blocked face handling, and manual face creation.
- `previewable-image.tsx` and `ImagePreviewLightbox` are image-only.
- The current preview architecture is not suitable for threading video through the existing photo detail logic.
- The clean bounded seam is to keep one preview entry point but branch immediately by asset type before any photo-only fetching or overlay logic runs.

### Current signing and derivative boundary

- `sign-asset-thumbnails.ts` signs original asset URLs and derivative URLs with a shared 120-second TTL.
- That helper is image-display oriented:
  - it uses image-display states like `ready_derivative` and `transform_fallback`
  - it may enqueue missing derivatives on read
  - it can fall back to image transforms or original-image display
- `signOriginalAssetUrl` itself does not reject video, but the surrounding semantics are photo/display specific.
- `asset_image_derivatives` already stores generic `thumbnail` and `preview` image outputs in a private derivative bucket.
- The derivative worker currently uses `sharp` directly on the original uploaded asset buffer, so queued video jobs would fail today.
- Repair currently scans only uploaded non-archived `photo` assets.

### Current photo-only seams that video must bypass

- `requirePhotoAsset` in `asset-preview-linking.ts` rejects non-photo assets.
- `/preview-faces`, `/whole-asset-candidates`, and `/whole-asset-links` route through photo-only logic.
- Video preview must not call those APIs and must not render those trays.

### Current tests anchoring behavior

- Feature 062 tests currently assert that videos are not previewable and render placeholder cards.
- Feature 038 tests anchor the current derivative queue, worker, signing, and repair behavior for photos.
- Feature 024 tests anchor prepare/finalize retry safety and current upload flow invariants.

## Recommendation

Implement the smallest coherent 063 slice as:

- keep one asset preview entry point in the project assets UI
- branch early between photo preview and video preview
- use native HTML video playback for video assets
- sign private original video playback URLs server-side
- reuse `asset_image_derivatives` for video poster `thumbnail` and `preview` outputs
- enqueue poster generation in the existing post-finalize pipeline
- extend the existing derivative worker and repair sweep to support video source assets
- keep poster generation non-fatal, with placeholder fallback when pending or failed

This stays inside one normal RPI cycle, avoids redesigning the media stack, and preserves existing photo behavior.

## Chosen video preview architecture

Use one asset preview entry point, not a second product surface.

Planned structure:

- Keep `AssetsList` as the single selection and navigation surface.
- Make video assets previewable from the list, alongside photos.
- Refactor `ProjectAssetPreviewLightbox` into a thin dispatcher that accepts both asset types and branches immediately:
  - `photo` -> existing photo preview implementation, behavior unchanged
  - `video` -> new bounded video preview implementation

Recommended component shape:

- `ProjectAssetPreviewLightbox` becomes the shared entry point and type switch.
- Extract the current photo-heavy implementation into a `ProjectPhotoAssetPreviewLightbox` helper component or equivalent internal module.
- Add a new `ProjectVideoAssetPreviewLightbox` for the video branch.

Reasons:

- preserves one preview entry point
- keeps navigation, selection, and modal ownership in one place
- prevents video from flowing into preview-faces and linking requests
- avoids destabilizing the photo preview logic by mixing concerns

## Playback URL strategy

### Chosen approach

Add a small server-side playback signing helper for original video objects and include the resulting playback URL in the existing assets list response for video rows.

Do not overload the current image-display helper as the main video playback API.

### Concrete plan

- Add a small helper dedicated to private original asset playback signing.
- Use it only on the server.
- In `src/app/api/projects/[projectId]/assets/route.ts`:
  - keep current photo thumbnail/preview signing path unchanged
  - for video rows, sign the original uploaded object as `playbackUrl`
  - keep poster URLs separate from playback URLs

Recommended response shape for video rows:

- `thumbnailUrl`: poster thumbnail derivative when ready
- `thumbnailState`: `ready_derivative`, `processing`, or `unavailable`
- `previewUrl`: poster preview derivative when ready
- `previewState`: same poster state model
- `playbackUrl`: signed original private video URL or `null`

This lets the grid use poster images and the modal use the original video object.

### TTL choice

Use a longer playback TTL than the current 120-second image-display TTL.

Recommended first-slice value:

- `VIDEO_PLAYBACK_SIGNED_URL_TTL_SECONDS = 900` (15 minutes)

Why 15 minutes:

- long enough for normal open, inspect, seek, pause, and adjacent navigation in a modal
- short enough to remain clearly bounded private access
- avoids a token-refresh redesign in this slice

### Why not modal-open signing for 063

Signing in the list response is the smaller first slice because it:

- avoids a second preview-specific API route
- works with current page caching and adjacent item navigation
- keeps all URL signing server-side in an existing list read path

Known limit:

- a playback URL can still expire during a very long session

Bounded 063 behavior:

- show a localized playback error state if the signed URL has expired or cannot load
- defer token refresh / re-sign-on-expiry to future work

## Poster/thumbnail storage model

Reuse `asset_image_derivatives`.

No second poster subsystem is recommended.

### Concrete fit

Store video poster outputs exactly like photo derivatives:

- `derivative_kind = 'thumbnail'` for the grid tile poster
- `derivative_kind = 'preview'` for the larger poster used as the modal `poster`

Why this fit is clean:

- outputs are still image derivatives
- the existing table already stores width, height, content type, storage path, status, attempts, and failures
- the existing private derivative bucket and path model already match the need
- no schema redesign is required

No new derivative kinds are needed for 063.

## Poster generation pipeline

### Post-finalize enqueue

Widen `queueProjectAssetPostFinalizeProcessing` so uploaded `video` assets enqueue derivative rows just like `photo` assets.

Rules:

- `photo` -> keep current derivative enqueue behavior
- `video` -> enqueue `thumbnail` and `preview` derivative rows
- matching enqueue remains photo-only

### Worker branch

Extend the existing derivative worker to branch on the source asset type after loading the asset row.

Branch behavior:

- `photo` source -> keep current `sharp` render path
- `video` source -> run bounded frame extraction and emit JPEG poster derivative

Recommended video branch flow per derivative row:

1. Download the private original video object as today.
2. Write the source video buffer to a temporary file.
3. Invoke ffmpeg to extract one frame at the configured timestamp.
4. If extraction at `1.0s` fails because the timestamp is not available, retry once at `0.0s`.
5. Render the requested derivative kind as JPEG.
6. Read the output image metadata and store it in the existing derivative row.
7. Upload the derivative image to the existing private derivative bucket/path.
8. Clean up temporary files in `finally`.

### Reuse level

For 063, allow each derivative job to extract its own frame independently.

That means:

- the `thumbnail` job extracts and renders the thumbnail poster
- the `preview` job extracts and renders the preview poster

This is not the most efficient possible pipeline, but it is the smallest change because it preserves the existing one-row-per-kind worker model. Shared extracted-frame caching is explicitly deferred.

### Failure behavior

Poster generation must be non-fatal.

If poster generation fails:

- the uploaded video asset remains `uploaded`
- the video still lists in the assets grid
- the video still opens in preview if `playbackUrl` is available
- the grid falls back to the placeholder tile
- failed poster derivatives remain visible to repair via `dead` rows

Recommended retry posture:

- download/upload/temp-file failures -> retryable
- unsupported codec / invalid media / persistent ffmpeg extraction failure -> non-retryable `dead`
- `1.0s` extraction miss -> retry once inside the same job at `0.0s` before marking failure

## Thumbnail timestamp strategy

Use a deterministic first-slice rule:

- primary timestamp: `1.0s`
- fallback timestamp: `0.0s`

Why:

- first frame is often black, slates, or fade-in
- `1.0s` is simple and usually yields a more representative B2B DAM thumbnail
- the `0.0s` fallback keeps very short clips from failing unnecessarily
- this avoids complex frame analysis and keeps worker cost bounded

Do not add:

- first non-black frame scanning
- midpoint selection
- percentage-based sampling
- scene detection

## Dependency/tooling choice

### Chosen bounded strategy

Use ffmpeg only inside the derivative worker path.

Recommended packaging:

- add `ffmpeg-static` as the default binary source
- support an environment override such as `ASSET_FFMPEG_PATH` for deployment environments that need a custom binary path

### Why this is the smallest practical option

- no broad transcoding platform
- no streaming server
- no separate media service
- no client-side media processing
- no new long-running queue system beyond the existing derivative worker

### Runtime expectations

- ffmpeg is invoked from Node via `child_process`
- temporary file usage is limited to the worker path
- the main app request path remains unchanged except for signing and poster display

`ffprobe` is not required for 063 if the worker only needs to extract a frame and then read output image metadata.

## Project assets grid/list behavior

### Target behavior

Photo rows stay unchanged.

Video rows change as follows:

- if poster thumbnail is ready, show the poster image in the existing square tile
- keep a visible video badge so videos remain distinguishable from photos
- if poster generation is pending, keep the placeholder tile and localized processing copy
- if poster generation failed or is unavailable, keep the placeholder tile and localized unavailable copy
- clicking a video tile opens the shared preview modal

### UI implementation notes

- Do not force video tiles through `PreviewableImage`.
- Keep `PreviewableImage` image-only.
- Add a small video tile branch in `AssetsList` or a tiny dedicated video poster tile component.
- Preserve the existing list/grid layout and metadata rows.

### Navigation behavior

- Videos should participate in modal selection and next/previous navigation.
- Adjacent navigation should move across both photos and videos in sort order.
- The shared modal dispatcher decides which preview branch to render for each selected asset.

## Preview modal behavior

### Target behavior

The video branch should render:

- native `<video controls playsInline preload="metadata">`
- `src={playbackUrl}`
- `poster={previewUrl ?? thumbnailUrl ?? undefined}`

Expected native capabilities come from browser controls:

- play/pause
- mute/volume
- seek/scrub
- fullscreen where supported by the browser

### Loading and error states

Add localized video-specific states for:

- loading metadata / preparing preview
- playback unavailable
- poster unavailable if needed

Bounded 063 behavior:

- no custom controls
- no scrub thumbnail strip
- no hover timeline previews
- no download action redesign
- no adaptive streaming

### Bypass rules

For `assetType === "video"`:

- do not call `/preview-faces`
- do not call `/whole-asset-candidates`
- do not call `/whole-asset-links`
- do not render face overlays, linked people trays, hidden face trays, blocked face trays, or whole-asset linking panels

Photo preview behavior must remain unchanged.

## Security and reliability considerations

- Keep all URL signing server-side.
- Keep the current private bucket model for originals and derivatives.
- Do not accept tenant scope from the client.
- Continue deriving tenant/project access on the server from auth and scoped lookups.
- Keep video playback on signed original-object URLs only.
- Keep poster generation asynchronous and non-fatal.
- Keep derivative upserts and worker writes idempotent through the existing derivative-key uniqueness model.
- Keep matching/linking logic photo-only.

### Reliability notes

- Unsupported codecs or malformed media should fail poster generation without blocking upload or playback.
- Very large uploaded videos may still produce posters more slowly; the UI must tolerate pending poster state.
- A signed playback URL may expire during a long modal session; 063 should show a bounded error state rather than add refresh architecture.
- If ffmpeg is unavailable or misconfigured, poster generation fails safely and the grid falls back to placeholders while video playback can still work.

## Edge cases

- Video uploaded successfully, poster not generated yet: show placeholder in grid, allow modal playback.
- Video uploaded successfully, poster generation dead: show placeholder in grid, allow modal playback if original signing succeeds.
- Video row clicked while poster is pending: open video modal with playback URL and no poster or thumbnail poster fallback.
- Playback URL missing or expired: show localized playback error in the modal.
- Short clip with no frame at `1.0s`: retry at `0.0s`.
- Unsupported or corrupt video: poster job becomes `dead`; playback may also fail in-browser.
- Archived or non-uploaded assets: remain excluded by the existing list query rules.
- Headshots remain outside this feature.

## Test plan

### Existing test files to update

`tests/feature-062-video-upload-foundation.test.ts`

- Update the previewability expectation for videos.
- Keep coverage for accepted video upload formats and size limits.
- Keep the placeholder component coverage, but repurpose it as the pending/unavailable fallback state instead of the only video tile state.

`tests/feature-038-asset-image-derivatives.test.ts`

- Add video poster queue coverage:
  - video post-finalize processing enqueues `thumbnail` and `preview` derivative rows
  - matching enqueue remains excluded for video
- Add video worker success coverage:
  - video derivative rows become `ready`
  - output files are JPEG posters in the derivative bucket
- Add video repair coverage:
  - missing video poster derivatives are requeued
  - existing ready photo/video rows are not disturbed
- Add video poster failure coverage:
  - failed extraction leads to non-fatal `dead` derivative rows
  - no asset upload regression

`tests/feature-024-upload-performance-resumability.test.ts`

- Keep existing retry-safety coverage unchanged.
- Add one targeted assertion if needed that video finalize remains retry-safe while not enqueuing photo matching.

### New test coverage recommended

Add a small Feature 063 test file for preview/list branching and playback signing.

Suggested coverage:

- video rows now open the shared preview entry point
- video rows receive `playbackUrl` from the assets list API
- video grid tiles switch from placeholder to poster image when poster derivatives are ready
- video rows still show placeholder fallback when poster generation is pending or failed
- video preview branch renders native `<video>` semantics and does not render photo-only trays
- photo preview behavior remains unchanged

### Minimum behavior matrix to cover

- video playback URL signing path
- poster derivative generation success path
- poster fallback path when generation fails
- repair/requeue for missing video poster derivatives
- grid thumbnail replacement once ready
- video exclusion from photo review/linking paths
- unchanged photo signing and preview behavior

## Implementation phases

### Phase 1 - Shared preview entry point and playback signing

- Refactor `ProjectAssetPreviewLightbox` into an asset-type dispatcher.
- Extract current photo preview implementation behind the photo branch.
- Add a bounded video preview branch with native `<video>` playback.
- Add a dedicated server-side playback signing helper for original video objects.
- Extend the assets list API to return `playbackUrl` for video rows.
- Update `AssetsList` so video rows open preview instead of being non-interactive.

Exit criteria:

- videos open in the shared preview surface
- photo preview remains unchanged
- no video path calls photo-only preview/linking APIs

### Phase 2 - Reuse derivative storage model for video posters

- Keep `asset_image_derivatives` as the poster store.
- No new table or storage subsystem.
- Extend list response shaping so video rows read poster `thumbnail` and `preview` derivatives from the existing derivative model.

Exit criteria:

- poster URLs and poster states are represented through existing derivative rows
- no schema redesign is introduced

### Phase 3 - Video poster generation and repair

- Widen post-finalize derivative enqueue from photo-only to photo-plus-video.
- Extend the derivative worker with the video frame-extraction branch.
- Add the `1.0s` then `0.0s` timestamp rule.
- Widen repair to scan uploaded non-archived videos as well as photos.
- Keep video failures non-fatal.

Exit criteria:

- new video uploads queue poster derivatives automatically
- worker can render video poster derivatives
- repair can requeue missing video poster derivatives

### Phase 4 - Grid/list poster behavior and fallback states

- Render poster thumbnails for ready video rows.
- Keep video badge.
- Keep localized placeholder fallback for pending/unavailable poster states.
- Ensure list interactions and adjacent modal navigation behave correctly across mixed photo/video pages.

Exit criteria:

- ready posters replace the generic video placeholder in the grid
- pending/failed posters degrade safely

### Phase 5 - Tests, i18n, and cleanup

- Update existing feature 038 and 062 tests.
- Add focused 063 coverage for preview and signing behavior.
- Add English and Dutch translation keys for new video preview and poster states.
- Verify no regressions in photo preview behavior.

Exit criteria:

- tests cover the new video preview and poster path
- no new hardcoded user-facing strings are introduced

## Explicitly deferred work

- adaptive streaming, HLS, or DASH
- transcoded playback renditions
- timeline hover-preview thumbnails
- scrub-strip thumbnail generation
- scene detection or first-non-black-frame analysis
- custom video controls
- background poster frame reuse across derivative kinds
- long-session playback URL refresh architecture
- video face detection, matching, review, or linking
- export redesign for video poster assets

## Open decisions for implementation

These are narrow implementation details, not product-scope questions:

- exact helper location and name for playback signing
  - recommended: new focused helper rather than widening `sign-asset-thumbnails.ts` semantics
- exact dispatcher refactor shape for `ProjectAssetPreviewLightbox`
  - recommended: extract current photo implementation into a dedicated helper component
- exact environment variable name for ffmpeg path override
  - recommended: one explicit override, with `ffmpeg-static` as the default

The main architectural choices for 063 are otherwise settled by this plan.

## Concise implementation prompt

Implement Feature 063 as a bounded additive change:

- keep one project asset preview entry point and branch it immediately by `assetType`
- preserve the current photo preview path unchanged
- add a video preview branch that uses native `<video controls playsInline preload="metadata">`
- sign private original video playback URLs server-side with a 15-minute TTL and return them in the existing assets list response as `playbackUrl`
- reuse `asset_image_derivatives` for video poster `thumbnail` and `preview` JPEG outputs
- widen post-finalize derivative enqueue, the derivative worker, and the repair sweep to support `video` source assets
- use poster timestamp `1.0s`, with a single in-job fallback to `0.0s`
- keep poster generation non-fatal so uploads and playback still work when poster extraction fails
- replace the grid placeholder with real poster thumbnails when ready, keep the video badge, and fall back to the placeholder while poster generation is pending or failed
- keep videos out of photo preview/linking APIs and trays
- add i18n keys for all new user-facing video preview and poster fallback copy
- update tests to cover video preview opening, playback signing, poster generation success/failure, repair requeue, grid poster replacement, video exclusion from photo-linking flows, and unchanged photo behavior
