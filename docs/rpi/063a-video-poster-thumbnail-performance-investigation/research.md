# Feature 063A Research: Video Poster/Thumbnail Generation Performance Investigation

## Goal

Research how video poster generation works in the live repository after Feature 063 and identify safe, bounded performance improvements without redesigning the media platform.

This document is research only. Live code and schema are the source of truth where they differ from earlier RPI docs.

## Scope boundaries

In scope:

- current video poster generation flow
- current derivative count and usage
- current ffmpeg invocation and temp-file strategy
- current storage download/upload behavior
- current worker concurrency and lease behavior
- safe, low-risk performance improvements inside the existing architecture

Out of scope:

- adaptive streaming
- transcoding platform redesign
- hover-strip thumbnails
- playback token redesign
- broad worker or queue redesign
- replacing the private bucket model

## Inputs reviewed

### Core repo docs

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `docs/rpi/README.md`

### Prior RPI docs

5. `docs/rpi/038-original-image-ingest-and-display-derivatives/research.md`
6. `docs/rpi/038-original-image-ingest-and-display-derivatives/plan.md`
7. `docs/rpi/062-video-upload-foundation/research.md`
8. `docs/rpi/062-video-upload-foundation/plan.md`
9. `docs/rpi/063-video-asset-preview-playback-and-thumbnails/research.md`
10. `docs/rpi/063-video-asset-preview-playback-and-thumbnails/plan.md`

### Live implementation and schema

11. Upload/finalize/post-finalize flow
- `src/lib/assets/create-asset.ts`
- `src/lib/assets/finalize-asset.ts`
- `src/lib/assets/post-finalize-processing.ts`
- `src/lib/assets/prepare-project-asset-batch.ts`
- `src/lib/assets/finalize-project-asset-batch.ts`

12. Derivative and signing pipeline
- `src/lib/assets/asset-image-derivatives.ts`
- `src/lib/assets/asset-image-derivative-worker.ts`
- `src/lib/assets/asset-image-derivative-repair.ts`
- `src/lib/assets/sign-asset-thumbnails.ts`
- `src/lib/assets/sign-asset-playback.ts`
- `src/app/api/internal/assets/worker/route.ts`
- `src/app/api/internal/assets/repair/route.ts`

13. Current video preview/grid usage
- `src/app/api/projects/[projectId]/assets/route.ts`
- `src/components/projects/assets-list.tsx`
- `src/components/projects/project-asset-preview-lightbox.tsx`
- `src/components/projects/project-video-asset-preview-lightbox.tsx`
- `src/lib/matching/asset-preview-linking.ts`

14. Schema and tests
- `supabase/migrations/20260407133000_038_asset_image_derivative_pipeline.sql`
- `supabase/migrations/20260421120000_062_video_asset_type.sql`
- no separate `063` migration file was found; live 063 behavior reuses the existing derivative schema
- `tests/feature-038-asset-image-derivatives.test.ts`
- `tests/feature-062-video-upload-foundation.test.ts`
- `tests/feature-063-video-asset-preview-playback-and-thumbnails.test.ts`

15. Tooling/runtime boundary
- `package.json`
- ffmpeg usage in `src/lib/assets/asset-image-derivative-worker.ts`

## Live-code summary

Feature 063 is live in code, not just in docs:

- uploaded videos now enqueue poster derivatives
- the derivative worker has a video branch that uses ffmpeg
- the asset list API returns `thumbnailUrl`, `previewUrl`, and `playbackUrl` for video rows
- videos open in the shared preview surface

Important doc drift note:

- earlier 063 docs described video as bypassing whole-asset preview/linking reads
- live code still keeps `/preview-faces` photo-only, but video preview does load `/whole-asset-links` and `/whole-asset-candidates`

## Verified current poster generation pipeline

### 1. When poster jobs are enqueued

The enqueue point is post-finalize, not create-time:

- `finalizeAsset()` only marks the asset `uploaded` and returns the resolved `assetType`
- `finalizeProjectAssetBatch()` and the single finalize path then call `queueProjectAssetPostFinalizeProcessing(...)`
- `queueProjectAssetPostFinalizeProcessing(...)` queues image derivatives for both `photo` and `video`
- matching enqueue remains photo-only because `shouldEnqueuePhotoUploadedOnFinalize("video")` is `false`

### 2. How many derivative jobs are enqueued per video

Each uploaded video currently enqueues two derivative rows in `asset_image_derivatives`:

- `thumbnail`
- `preview`

That comes from `ASSET_IMAGE_DERIVATIVE_KINDS = ["thumbnail", "preview"]` and the shared queue helper `queueAssetImageDerivativesForAssetIds(...)`.

There is no video-specific poster table. Video posters reuse the photo derivative table and private derivative bucket.

### 3. Repair behavior

Repair now scans uploaded non-archived `photo` and `video` assets:

- `runAssetImageDerivativeRepair(...)` queries `.in("asset_type", ["photo", "video"])`
- missing, stale-version, or `dead` derivative rows are requeued through the same helper

### 4. How the worker handles video vs photo

The derivative worker is row-based, not asset-based:

1. Claim derivative rows with `claim_asset_image_derivatives`
2. For each claimed row, load the source asset row
3. Download the original asset object from private storage
4. Branch by `asset_type`
   - `photo` -> `sharp` directly on the source image buffer
   - `video` -> ffmpeg frame extraction, then `sharp` on the extracted frame
5. Upload the derivative image
6. Mark the derivative row `ready`

### 5. Current video frame extraction path

For video rows the worker currently does the following for each derivative row:

- download the full original video object into memory
- create a temp directory with `mkdtemp(...)`
- write the full video buffer to a temp input file
- resolve ffmpeg from `ASSET_FFMPEG_PATH` or `ffmpeg-static`
- try to extract one frame at `1.0s`
- if that fails, retry at `0.0s`
- ffmpeg writes a PNG frame file
- Node reads that PNG file back into memory
- `sharp` resizes and JPEG-encodes according to the derivative kind
- upload the JPEG derivative to `asset-image-derivatives`
- remove the temp directory in `finally`

### 6. Current derivative sizes and quality

Current derivative specs are shared across photo and video posters:

- `thumbnail`: `480x480`, JPEG quality `76`
- `preview`: `1536x1536`, JPEG quality `85`

### 7. Current worker concurrency and lease behavior

Current runtime defaults:

- worker concurrency default: `1`
- worker concurrency max override: `6`
- derivative lease default: `900` seconds
- internal worker route default `batchSize`: `25`

This matters because the worker claims a batch first, then processes the claimed rows afterward. With default concurrency `1`, later rows in a heavy video batch can sit in `processing` before their actual work starts.

## Verified current UI usage of `thumbnail` vs `preview`

### Grid/list usage

The project assets API loads and signs video poster URLs separately:

- `videoThumbnailMap` with `use: "thumbnail"` and `fallback: "none"`
- `videoPreviewMap` with `use: "preview"` and `fallback: "none"`
- `videoPlaybackMap` from `signVideoPlaybackUrlsForAssets(...)`

In the grid:

- video cards render `PreviewableVideoPoster`
- the poster tile uses `asset.thumbnailUrl`
- if no thumbnail is ready, the grid falls back to the placeholder card

### Modal usage

The video modal renders:

- `<video src={asset.playbackUrl} ... poster={asset.previewUrl ?? asset.thumbnailUrl ?? undefined}>`

So the modal prefers `preview`, but already falls back to `thumbnail` if `preview` is missing.

### Photo-only versus video-enabled preview reads

Still photo-only:

- `/preview-faces`
- face-level preview reads gated by `requirePhotoAsset(...)`

Video-enabled:

- `/whole-asset-links`
- `/whole-asset-candidates`
- those code paths use `requirePreviewableAsset(...)`, which accepts `photo` and `video`

### Answer: are both poster derivatives necessary today?

Code-level answer:

- yes, both are consumed in the current live code
- `thumbnail` is used in the grid
- `preview` is used only as the preferred modal `poster`

Product-behavior answer:

- one poster derivative would still satisfy the current product behavior because the modal already tolerates `thumbnail` fallback
- keeping both derivatives is currently about poster quality and separation of grid vs modal sizing, not about a hard functional requirement

## Is the current implementation doing duplicate expensive work?

Yes. This is the clearest current performance problem.

For one uploaded video, the system currently creates two independent jobs:

- `thumbnail`
- `preview`

Each job independently does all of the expensive source work:

- reload source asset metadata
- download the original video from storage
- write a temp source file
- launch ffmpeg
- seek and decode a representative frame
- read the generated frame back
- resize and encode JPEG
- upload the derivative

So the same representative frame is effectively regenerated twice, with two different output sizes.

That means the current implementation is duplicating:

- storage download work
- temp-file work
- ffmpeg startup overhead
- seek/decode work
- frame extraction work

The only thing that actually differs between the two jobs is the final resize/quality target.

## Likely cost centers in the current implementation

There is no dedicated timing instrumentation in the poster worker. The repo has no live step-level duration logging for:

- storage download
- temp-file write
- ffmpeg execution
- image resize/encode
- upload

So the assessment below is grounded from the code path itself.

### Highest-probability cost centers

1. Full original video download from storage

- the worker downloads the entire source object into memory for each derivative row
- for videos this is the biggest byte movement in the pipeline
- because there are two jobs per video, this cost is currently doubled

2. ffmpeg process startup plus seek/decode

- each derivative row launches a separate ffmpeg process
- each process seeks to `1.0s` and may retry at `0.0s`
- for compressed 4K video, decode and frame extraction are materially more expensive than a photo resize

3. Temp-file I/O

- the worker writes the full video buffer to disk before extraction
- ffmpeg writes a PNG frame to disk
- Node then reads that PNG back
- on Windows and local Docker-based setups, this extra file churn is likely very noticeable

4. Duplicate `sharp` resize/encode work

- after frame extraction the worker still runs a full `sharp` pipeline for each derivative kind
- this is smaller than the download/decode cost, but it is still duplicated today

### Lower-probability or smaller cost centers

5. Derivative upload

- poster JPEGs are much smaller than the source videos
- uploads are real cost, but probably not the primary bottleneck

6. URL signing on the read path

- the asset list route signs both poster URLs and playback URLs
- this adds per-request work, but it is not the main reason generation feels slow

### Lease and batch-size risk

There is also a credible throughput and duplicate-work risk in the current worker model:

- the claim RPC leases a whole batch up front
- default lease is 15 minutes
- default internal worker batch size is 25
- default worker concurrency is 1

For video-heavy batches, a serial worker can claim many rows long before it reaches the later ones. If processing 25 claimed rows takes longer than the lease window, overlapping worker runs can reclaim still-pending-in-practice rows and duplicate work.

This is more likely for video than photo because:

- there are 2 rows per video
- each row does full download plus ffmpeg work

## Realistic batch-cost assessment

These are qualitative estimates based on the live architecture, not measured benchmarks.

### Scenario 1: one short 4K clip

Current architecture likely does:

- 2 full storage downloads
- 2 temp source-file writes
- 2 ffmpeg startups
- 2 frame extraction attempts
- 2 JPEG encodes
- 2 uploads

This is acceptable as background work, but noticeably heavier than photo derivatives and slower than it needs to be.

### Scenario 2: 10 short 4K clips

Current architecture likely does:

- 20 derivative rows
- 20 full video downloads
- 20 ffmpeg runs

Operationally:

- one default worker call with `batchSize: 25` can claim all 20 rows
- with default concurrency `1`, that work is processed serially
- poster availability will likely trickle in slowly asset by asset

### Scenario 3: 50 short 4K clips

Current architecture likely does:

- 100 derivative rows
- at least 4 worker invocations if the scheduler keeps the default `batchSize: 25`
- 100 full video downloads and 100 ffmpeg runs unless work is deduplicated

This is where the current design will feel backlog-heavy:

- queue depth doubles because every video becomes two rows
- full-source duplicate work compounds quickly
- lease expiry and overlapping worker duplication become more plausible

## Options considered

### Option 1: keep the current implementation

Pros:

- no change

Cons:

- clearly duplicates the heaviest work
- queue depth stays doubled
- heavy batches are likely to backlog

Assessment:

- not recommended

### Option 2: keep both derivatives, but process video poster work once per asset

Description:

- preserve the existing `thumbnail` and `preview` rows
- preserve the existing private derivative bucket and current UI behavior
- when claimed video rows share the same asset, download the source once, extract one frame once, then derive both output sizes from that frame

Pros:

- removes the clearest duplicate work
- no product behavior change
- no schema change
- keeps current repair and fallback model

Cons:

- worker logic becomes slightly more complex around sibling-row coordination
- implementation needs careful idempotency handling if one sibling row is already ready or claimed elsewhere

Assessment:

- recommended first choice

### Option 3: generate only one poster derivative and reuse it everywhere

Description:

- simplify video posters to one stored image
- grid and modal both use that same poster

Pros:

- biggest simplification
- cuts generation jobs per video from 2 to 1

Cons:

- this is a product-visible behavior change
- if the single poster is small, the modal poster gets softer
- if the single poster is large, the grid may load larger images than necessary

Assessment:

- functionally viable today
- better as a follow-up product decision, not the safest first optimization

### Option 4: reduce derivative dimensions and/or JPEG quality only

Pros:

- low-risk
- easy to implement

Cons:

- does not remove the duplicated download/decode/extract cost
- likely smaller win than deduplicating source work

Assessment:

- useful secondary lever, not the first fix

### Option 5: increase worker concurrency

Pros:

- might improve throughput on a strong machine in some cases

Cons:

- current default is already conservative at `1`
- higher concurrency would multiply full video downloads, temp-file writes, and ffmpeg processes
- likely to make contention worse before duplicate work is removed

Assessment:

- not recommended as the first response

## Recommended safe performance gains

### 1. First recommendation: keep the current product model, but eliminate duplicate video source work

Recommended target:

- preserve `thumbnail` and `preview`
- preserve current grid and modal behavior
- preserve the current derivative table and repair flow
- change the worker so video poster rows are processed once per asset whenever both kinds are available in the claimed batch

Desired outcome:

- one original video download
- one temp source-file write
- one ffmpeg extraction
- one shared extracted frame
- two resized JPEG outputs from that frame

This stays inside the current architecture and removes the main waste without changing user-facing behavior.

### 2. Keep video poster worker throughput conservative until source-work dedupe lands

Recommended posture:

- keep default worker concurrency at `1`
- do not raise `ASSET_IMAGE_DERIVATIVE_WORKER_CONCURRENCY` for video-heavy workloads yet
- consider smaller scheduled worker `batchSize` than `25` if real jobs are long enough to threaten the 15-minute lease window

This is more operational than architectural, but it is a safe guardrail.

### 3. If needed after dedupe, tune preview dimensions and JPEG quality modestly

Possible follow-up levers:

- lower preview max dimension from `1536`
- lower preview JPEG quality from `85`
- possibly lower thumbnail JPEG quality slightly from `76`

These are bounded changes, but they should follow the larger win from deduplicating source work.

### 4. Treat "single poster only" as a separate product decision

A single poster derivative is technically enough for the current UX, because the modal already falls back to `thumbnail`.

However:

- it changes current quality expectations
- it changes the data model the list API and UI currently use

So it is safer as a second decision, not the first optimization slice.

## Recommended smallest bounded next step

Candidate 1 is the best next slice:

- no product change
- no schema change
- no storage model change
- no queue subsystem redesign

Concrete recommendation:

1. Keep `thumbnail` and `preview` rows in `asset_image_derivatives`
2. In the existing worker, group claimed video rows by `asset_id`
3. For each grouped video asset:
   - download the source video once
   - write the temp input file once
   - extract the representative frame once using the existing `1.0s` then `0.0s` rule
   - render both JPEG sizes from that frame
   - upload both derivatives
   - complete both rows
4. Leave photo processing unchanged
5. Keep repair and non-fatal failure behavior unchanged

Why this is the smallest good slice:

- it directly addresses the live duplicate work
- it preserves current UX and current private storage model
- it is still small enough for one normal RPI cycle

## Security and reliability considerations

- Tenant and project scope remain server-derived exactly as today.
- The client still must not provide `tenant_id`, bucket names, storage paths, or poster metadata.
- Playback and poster URL signing remain server-side.
- The current private bucket model remains unchanged.
- Poster generation must remain non-fatal. Failed posters must not block upload success or video playback.
- Storage paths should remain deterministic so retries overwrite the same objects.
- If the worker starts completing sibling rows together, it needs careful idempotent handling for races where:
  - one row is already `ready`
  - one row was claimed by another worker
  - one upload succeeds and the sibling fails
- If the worker remains row-claiming, batch size and lease duration need attention for heavy video jobs because rows are leased before processing starts.

## Edge cases to carry into planning

- very short clips where `1.0s` is unavailable and `0.0s` fallback is required
- corrupt or unsupported video that should dead-letter poster rows without changing asset availability
- browser-playback codec failures even when poster generation succeeds
- missing original storage object
- partial success where one poster variant is ready and the sibling is not
- lease expiry on long serial batches
- local Windows and Docker filesystem overhead from temp-file usage
- repair requeue behavior for dead or missing video poster rows

## Explicitly deferred work

- adaptive streaming
- HLS or DASH
- custom player controls
- scrub-strip thumbnails
- scene detection
- first-non-black-frame analysis
- codec normalization
- media platform redesign
- playback token refresh redesign
- replacing the derivative subsystem from scratch

## Open decisions for the plan phase

1. Should the next slice keep two video poster derivatives and dedupe source work, or simplify to one derivative only?
2. If two derivatives remain, what is the safest sibling-row completion strategy inside the existing worker?
3. Does the scheduled internal worker `batchSize` need to be reduced for video-heavy workloads to avoid lease expiry while the queue stays row-based?
4. After duplicate source work is removed, are the current `1536/85` preview settings still justified for the modal poster?
5. Is a small amount of timing instrumentation worth adding in the worker so the plan/implement phase can verify actual download/extract/encode costs?

## Research outcome

The live Feature 063 implementation works, but it is currently doing duplicate heavy work for every uploaded video.

Most important verified facts:

- each uploaded video queues two poster rows
- each row is processed independently
- each row re-downloads the full source video
- each row re-runs ffmpeg extraction
- the grid uses `thumbnail`
- the modal uses `preview`, but already falls back to `thumbnail`

The safest next optimization is not a redesign. It is to keep the current product behavior and current storage model while changing the worker to process video poster pairs once per asset instead of once per derivative kind.
