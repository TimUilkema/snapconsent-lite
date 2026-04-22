# Feature 062A Research: Video Client Duplicate Hashing Cost

Implementation note, April 22, 2026:

- This feature has now been implemented.
- Current live behavior keeps exact duplicate hashing for photos.
- Current live behavior removes normal upload-flow duplicate checking for videos on both client prepare and server duplicate enforcement.

## Goal

Determine whether the current client-side duplicate hashing flow for project video uploads is likely to become a bottleneck on slower laptops, using the live repository code as the source of truth.

This research is intentionally narrow. It focuses only on:

- project upload flow
- client-side duplicate hashing
- video files only

This research does not propose a full uploader redesign and does not recommend changing image duplicate hashing behavior in this cycle.

## Scope and method

This is a code-first research step. Prior RPI docs were read as history and context, but the live code was treated as authoritative whenever docs and implementation could differ.

Required docs read in order:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `docs/rpi/README.md`
5. `docs/rpi/005-duplicate-upload-handling/research.md`
6. `docs/rpi/005-duplicate-upload-handling/plan.md`
7. `docs/rpi/024-upload-performance-resumability/research.md`
8. `docs/rpi/024-upload-performance-resumability/plan.md`
9. `docs/rpi/028-duplicate-upload-detection-regression-after-batched-upload/research.md`
10. `docs/rpi/028-duplicate-upload-detection-regression-after-batched-upload/plan.md`
11. `docs/rpi/030-continuation-retry-reliability/research.md`
12. `docs/rpi/030-continuation-retry-reliability/plan.md`
13. `docs/rpi/062-video-upload-foundation/research.md`
14. `docs/rpi/062-video-upload-foundation/plan.md`

Live code inspected:

- `src/components/projects/assets-upload-form.tsx`
- `src/lib/uploads/project-upload-duplicate-detection.ts`
- `src/lib/uploads/project-upload-manifest.ts`
- `src/lib/uploads/project-upload-queue.ts`
- `src/lib/uploads/project-upload-types.ts`
- `src/lib/assets/asset-upload-policy.ts`
- `src/app/api/projects/[projectId]/assets/preflight/route.ts`
- `src/app/api/projects/[projectId]/assets/batch/prepare/route.ts`
- `src/lib/assets/prepare-project-asset-batch.ts`
- `src/lib/assets/create-asset.ts`

## Research questions

1. Exactly how are video files currently hashed on the client?
2. What concurrency and queue-startup behavior applies to video hashing?
3. What pain points does that create for slower clients?
4. Is the current behavior acceptable for small, medium, and large video-heavy selections?
5. What are the smallest safe optimizations that only target video hashing?

## Current relevant code structure

### Upload entry point

Project asset uploads start in:

- `src/components/projects/assets-upload-form.tsx`

The relevant selection flow is:

1. user selects files
2. `handleFileSelection(...)` validates file type and size
3. selected items are added to the manifest
4. `prepareSelectedItemsForQueue(...)` runs before `startQueue()`
5. duplicate hashing and duplicate preflight happen during prepare
6. only after prepare completes does the actual upload queue begin

Key lines:

- `handleFileSelection(...)` calls `prepareSelectedItemsForQueue(...)` and only then `startQueue()`:
  - `src/components/projects/assets-upload-form.tsx:868-875`

### Hashing helper

The client hashing helper is:

- `src/lib/uploads/project-upload-duplicate-detection.ts`

It does:

1. `await file.arrayBuffer()`
2. `await crypto.subtle.digest("SHA-256", buffer)`
3. convert the digest bytes to lowercase hex

Key lines:

- `src/lib/uploads/project-upload-duplicate-detection.ts:1-17`

### Queue constants

Upload constants live in:

- `src/lib/uploads/project-upload-types.ts`

Relevant live values:

- photo hash concurrency: `2`
- video hash concurrency: `1`
- photo PUT concurrency: `4`
- video PUT concurrency: `1`
- photo prepare batch size: `50`
- video prepare batch size: `10`

Key lines:

- `src/lib/uploads/project-upload-types.ts:5-13`

### Duplicate preflight and authoritative duplicate enforcement

Duplicate preflight route:

- `src/app/api/projects/[projectId]/assets/preflight/route.ts`

Authoritative create-time duplicate enforcement:

- `src/lib/assets/create-asset.ts`

Batch prepare wrapper:

- `src/lib/assets/prepare-project-asset-batch.ts`

## Exact current video hashing behavior

## 1. Where hashing starts

Hashing starts in `prepareSelectedItemsForQueue(...)` in the upload form, not in a background worker and not after upload starts.

The component first marks selected items as `needs_hash`, then hashes them before the queue is allowed to begin:

- `src/components/projects/assets-upload-form.tsx:290-358`

This means the upload flow is front-loaded:

- no video upload starts until hashing finishes for the newly selected items
- no duplicate policy UI can be decided until hashing finishes
- no create/prepare requests are sent until hashing finishes

## 2. Whether it uses full-file `arrayBuffer()` reads

Yes.

The current video hashing helper reads the whole file into memory with:

- `const buffer = await file.arrayBuffer()`

and only then performs:

- `subtle.digest("SHA-256", buffer)`

There is no chunked hashing, stream hashing, worker offload, or partial-file sampling in the live code:

- `src/lib/uploads/project-upload-duplicate-detection.ts:9-14`

## 3. Whether videos are treated the same as images

Yes for hashing algorithm and hash coverage.

Both photos and videos currently:

- are hashed on the client
- use the same `hashProjectUploadFile(...)` helper
- use full-file SHA-256
- send `contentHash` to preflight and batch prepare
- rely on server-side duplicate enforcement keyed by `(tenant_id, project_id, asset_type, content_hash)`

The only meaningful difference is scheduling:

- photos hash with concurrency `2`
- videos hash with concurrency `1`

Relevant lines:

- hashing loop by asset type:
  - `src/components/projects/assets-upload-form.tsx:329-358`
- per-type hash concurrency:
  - `src/lib/uploads/project-upload-queue.ts:201-203`
- per-type duplicate scoping on the server:
  - `src/app/api/projects/[projectId]/assets/preflight/route.ts:135-141`
  - `src/lib/assets/create-asset.ts:293-301`

## 4. What current concurrency limits apply

### Hashing

Video hash concurrency is explicitly limited to `1`:

- `PROJECT_VIDEO_UPLOAD_HASH_CONCURRENCY = 1`
- `src/lib/uploads/project-upload-types.ts:10-13`

The component hashes by asset type in fixed order:

1. photo items
2. video items

The code uses:

- `for (const assetType of ["photo", "video"] as const)`

and awaits each type group before moving on:

- `src/components/projects/assets-upload-form.tsx:331-358`

That means:

- all selected photos hash first
- then all selected videos hash
- only after both groups finish does duplicate preflight continue

### Uploading

Video upload PUT concurrency is also limited to `1`:

- `PROJECT_VIDEO_UPLOAD_PUT_CONCURRENCY = 1`
- `src/lib/uploads/project-upload-types.ts:10-13`

This protects runtime upload pressure, but it does not reduce the up-front hashing startup cost.

## Important live-code correction versus older RPI docs

Older planning docs described a more conservative first-slice video size cap around `250 MB`.

The live code does not match that older planning intent.

Current live upload policy allows videos up to:

- `VIDEO_UPLOAD_MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024 * 1024`
- `src/lib/assets/asset-upload-policy.ts:4-5`

That materially increases the practical risk of full-file hashing on slower laptops.

## Current queue startup behavior

The current flow blocks queue startup on hashing.

`handleFileSelection(...)` does this:

1. add selected items to manifest
2. `await prepareSelectedItemsForQueue(...)`
3. only if that succeeds, `await startQueue()`

Key lines:

- `src/components/projects/assets-upload-form.tsx:861-875`

Inside `prepareSelectedItemsForQueue(...)`, hashing happens before duplicate preflight results are applied and before any prepare request is issued:

- `src/components/projects/assets-upload-form.tsx:325-377`

Practical result:

- a large video delays the first network upload for the whole newly selected batch
- mixed selections do not start photo upload immediately while video hashing continues

## What preflight and server duplicate handling currently do

The preflight route still computes:

- `candidateSizes`
- `duplicateHashes`

But the current client path for this flow uses preflight after hashing and relies on `duplicateHashes` for duplicate UI state:

- `src/app/api/projects/[projectId]/assets/preflight/route.ts:97-156`
- `src/components/projects/assets-upload-form.tsx:361-377`

Server-side duplicate enforcement remains authoritative when `contentHash` is present:

- batch prepare does same-request duplicate suppression by hash
  - `src/lib/assets/prepare-project-asset-batch.ts:61-95`
- create helper checks existing assets by `content_hash`
  - `src/lib/assets/create-asset.ts:293-327`

Because videos are currently always hashed in this flow, duplicate detection correctness is strong. The cost issue is not correctness. The cost issue is the client-side full-file hash pass.

## Likely pain points for slower laptops

## 1. Memory pressure

The biggest immediate risk is memory pressure from full-file reads.

Even though video hash concurrency is only `1`, the current implementation still pulls one entire video into memory before hashing it. On slower or memory-constrained laptops this can cause:

- long stalls while the browser allocates the buffer
- tab sluggishness
- GC churn after hashing completes
- potential tab crashes or OS pressure for very large files

This risk is materially higher because the live video size cap is `2 GB`, not `250 MB`.

## 2. CPU and file-read cost

Every selected video pays a full byte-for-byte client-side SHA-256 pass before upload.

That means slower machines must complete:

1. browser file read of the entire video
2. SHA-256 digest of the entire byte stream

before the first upload request for that item can begin.

This is especially noticeable for:

- multiple medium videos
- a few very large videos
- slower SSDs or older laptops with weaker CPUs

## 3. Queue startup delay

The current flow is front-loaded. Uploading waits for hashing.

This means the user can experience a long "checking duplicates" period with no bytes uploading yet, even though the network is idle.

This is likely to feel slow or broken when the selection includes several large videos.

## 4. Large mixed uploads

Mixed photo and video uploads are particularly vulnerable to poor startup behavior.

Although the runtime queue later prefers photos first, that does not help initial startup because `handleFileSelection(...)` waits for `prepareSelectedItemsForQueue(...)` to finish before `startQueue()` is called.

Since hashing runs inside prepare, a few large videos can delay the beginning of a mixed upload that otherwise contains many small photos.

That creates a poor user experience for batches like:

- many photos plus a handful of videos

because the videos can hold back the whole batch.

## 5. Many-video uploads

For many-video selections, total startup cost scales roughly with total bytes selected because:

- all videos are fully hashed
- hashing is serial for videos
- uploading does not begin until that prepare phase completes

The serial hash limit of `1` helps cap peak memory pressure, but it also guarantees long startup wall-clock time when many videos are selected.

## Acceptability assessment

These judgments are practical, not benchmark-based. They are derived from the live algorithm and its current limits.

## 1. `1-5` moderate videos

Likely acceptable, with caveats.

If the files are moderate in size, current behavior is probably tolerable even on slower laptops. The user will still pay noticeable startup time, but the flow is unlikely to be disastrous.

This becomes less acceptable as individual files get large because the cost is dominated by full-file read plus full-file digest.

## 2. `10+` videos

Likely a bottleneck on slower laptops.

At this point the startup hash pass is likely to become long enough that users perceive the uploader as stalled, especially if some files are large.

## 3. `20+` videos

Likely not acceptable for slower clients.

The serial full-file hashing model creates too much front-loaded work and too much total byte-read cost before the queue starts moving.

## 4. Mixed uploads with many photos plus many videos

Likely poor.

Even when photos themselves are cheap to hash and upload, the current startup model forces the whole new selection through hashing before the upload queue starts. Large videos therefore create avoidable delay for the photo portion of the batch.

## Smallest safe optimization options that only target video hashing

## Option A: Keep exact SHA-256 duplicate detection, but hash videos incrementally in chunks

This is the smallest optimization that directly attacks the real bottleneck without weakening duplicate detection.

Shape:

- leave image hashing unchanged
- leave duplicate semantics unchanged
- leave server `contentHash` contract unchanged
- replace video `file.arrayBuffer()` hashing with chunked incremental SHA-256 hashing

Benefits:

- avoids loading an entire video into memory at once
- lowers peak memory pressure
- should reduce browser stalls on slower devices
- preserves exact duplicate detection for videos

Costs:

- requires a different hashing implementation for video
- likely requires a library or worker-side incremental SHA-256 implementation because Web Crypto `digest()` is not incremental in the current usage

Assessment:

- best bounded optimization if correctness should remain unchanged

## Option B: Move video hashing off the main thread

Shape:

- keep exact full-video hashing
- run video hashing in a Web Worker

Benefits:

- better UI responsiveness
- reduces visible main-thread jank

Costs:

- does not remove full-file byte-read cost
- does not remove memory pressure if the worker still reads full files into a single buffer

Assessment:

- helpful, but weaker than chunked hashing for the actual memory problem
- better as a complement than as the only change

## Option C: Allow photos to proceed while videos continue hashing

Shape:

- keep current image hashing unchanged
- keep current video hash algorithm unchanged
- change queue orchestration so photo work can start before all selected videos finish hashing

Benefits:

- helps mixed uploads
- reduces perceived startup delay for photos

Costs:

- does not reduce video hash memory cost
- does not reduce total client hash work
- requires queue orchestration changes, not just hashing helper changes

Assessment:

- useful for mixed selections
- not the smallest direct fix for video hash cost itself

## Option D: Weaken video hashing for very large videos

Examples:

- partial-file hashing
- sampled hashing
- no pre-upload hash for large videos

Benefits:

- cheaper on slow clients

Costs:

- weakens duplicate detection
- may prevent authoritative duplicate handling in `createAssetWithIdempotency(...)` when `contentHash` is absent

Assessment:

- not recommended as the first bounded step unless the product explicitly accepts weaker duplicate detection for large videos

## Recommended next step

The best bounded next step is:

- keep image duplicate hashing exactly as-is
- keep video duplicate detection exact
- change only video hashing from full-file `arrayBuffer()` reads to chunked incremental SHA-256 hashing
- preferably run that video hashing in a worker so UI responsiveness also improves

Why this is the best next step:

1. it targets the actual bottleneck directly
2. it does not require redesigning the upload pipeline
3. it does not require changing image behavior
4. it preserves server-side duplicate enforcement semantics
5. it lowers the main risk for slower clients: whole-file memory pressure

If one cycle must stay even smaller than that, the fallback bounded step is:

- keep current hashing semantics
- but allow photo prepare/upload to begin while video hashing continues

That would improve mixed uploads, but it would not solve the video hashing cost itself.

## Research outcome

The current live project uploader hashes videos on the client using the same full-file SHA-256 flow as images:

- hashing begins before the queue starts
- hashing reads the entire file with `file.arrayBuffer()`
- video hash concurrency is `1`
- duplicate enforcement depends on the resulting `contentHash`

This is probably acceptable for a few moderate videos, but it is likely to become a bottleneck on slower laptops for:

- `10+` videos
- `20+` videos
- mixed selections with many photos plus many videos
- any selection containing very large videos

The largest practical risk is not duplicate correctness. Current duplicate correctness is relatively strong because videos are fully hashed before prepare. The practical risk is client cost:

- full-file memory reads
- full-file digest CPU work
- long queue startup delay

The strongest bounded optimization is to change only video hashing to chunked incremental hashing, ideally off the main thread, while leaving image hashing and the rest of the upload pipeline unchanged.

No code changes were made during this research step.
