# Feature 062A Plan: Simpler Video Duplicate Checking For Slower Clients

## Inputs And Ground Truth

This plan is based on the live repository code and schema as the source of truth.

Inputs read in the required order:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/065-video-client-duplicate-hashing/research.md`

Old plan reviewed before revision:

- `docs/rpi/062a-safer-video-duplicate-checking-for-slower-clients/plan.md`

Targeted live verification for the concrete planning boundary:

- `src/components/projects/assets-upload-form.tsx`
- `src/lib/uploads/project-upload-duplicate-detection.ts`
- `src/lib/uploads/project-upload-manifest.ts`
- `src/lib/uploads/project-upload-queue.ts`
- `src/lib/uploads/project-upload-types.ts`
- `src/lib/assets/create-asset.ts`
- `src/lib/assets/prepare-project-asset-batch.ts`
- `src/app/api/projects/[projectId]/assets/preflight/route.ts`
- `src/app/api/projects/[projectId]/assets/batch/prepare/route.ts`
- `supabase/migrations/20260305150000_005_assets_content_hash.sql`
- `src/lib/assets/asset-upload-policy.ts`
- `docs/rpi/062-video-upload-foundation/research.md`
- `docs/rpi/062-video-upload-foundation/plan.md`

## Verified Current Planning Boundary

### Current client-side upload and duplicate handling

Live code confirms:

- the project uploader still uses one shared queue surface in `src/components/projects/assets-upload-form.tsx`
- `handleFileSelection(...)` still calls `prepareSelectedItemsForQueue(...)` before `startQueue()`
- all newly selected videos are still hashed eagerly during prepare
- the current helper still uses `file.arrayBuffer()` plus `crypto.subtle.digest("SHA-256", ...)`
- videos and images still share the same `contentHash`-based duplicate path
- current video throttling is limited to:
  - hash concurrency `1`
  - PUT concurrency `1`
  - prepare/finalize batch size `10`

This means the current slower-client problem is real and front-loaded:

- no video upload starts until full-file hashing finishes
- mixed selections still pay the prepare-time video hashing cost before queue start

### Current server-side duplicate enforcement

Live code confirms:

- `assets.content_hash` already exists and is indexed by `tenant_id`, `project_id`, `content_hash`
- preflight currently returns:
  - `candidateSizes`
  - `duplicateHashes`
- batch prepare suppresses same-request duplicates only when a normalized `contentHash` exists
- `createAssetWithIdempotency(...)` only performs duplicate lookup when `contentHash` is present and `duplicatePolicy !== "upload_anyway"`

That means the current server duplicate model is exact when hashes exist, but it already tolerates missing `contentHash` technically because the field is nullable and create still works without it.

### Current video upload boundary

Feature 062 is already live. Important boundary facts:

- video upload support already exists
- `asset-upload-policy.ts` already supports `video`
- videos currently allow up to `2 GB`
- batch prepare already accepts `assetType: "video"`
- the current duplicate pipeline for videos is simply the same exact `contentHash` model used by photos

So 062A is a narrow follow-up to simplify video duplicate checking cost, not another video-foundation feature.

## Recommendation

Implement 062A as a bounded product tradeoff for videos:

- keep image duplicate checking exactly unchanged
- stop eager full-file client hashing for videos
- replace exact eager video hashing with a cheap heuristic duplicate key
- keep the existing upload surface, queue UI, and create/finalize/storage flow
- make only the minimum server-side compatibility changes needed so videos upload and duplicate-policy handling remain coherent when `contentHash` is missing

This plan intentionally prefers:

- cheap startup
- lower memory pressure
- lower CPU spikes
- catching common accidental video duplicates

over:

- exact byte-level duplicate detection for videos

This is the product tradeoff for this cycle.

## Chosen Video Duplicate Strategy

### Evaluated options

#### Option A: keep exact eager full-file video hashing

Pros:

- preserves exact duplicate detection

Cons:

- keeps the slower-client bottleneck unchanged
- keeps the whole-file memory read
- conflicts with the stated product direction for this feature

Assessment:

- rejected

#### Option B: heuristic key based on normalized filename + exact file size

Pros:

- very cheap
- works both client-side and server-side with existing stored metadata
- requires no schema change
- catches many obvious accidental repeats

Cons:

- misses renamed exact duplicates
- can produce false positives for unrelated files that share name and size

Assessment:

- viable and simple

#### Option C: heuristic key based on normalized filename + exact file size + `lastModified`

Pros:

- improves same-device accidental duplicate detection
- better for same-selection and local retry/reselection cases

Cons:

- existing server data does not store `lastModified`
- cannot be used by itself for server duplicate checks against previously uploaded videos

Assessment:

- useful as part of the client-side key, but not sufficient alone for server lookup

### Chosen strategy

Use a split heuristic strategy for videos only:

1. Client-local video duplicate key:
   - `normalized filename + exact file size + lastModified`
2. Server/project video duplicate lookup key:
   - `normalized filename + exact file size`

Why this split is preferred:

- `lastModified` helps catch obvious same-local-file reselection and same-batch repeats with fewer false positives
- the server can only reliably check metadata it already stores, which today is filename and size
- this keeps the implementation small and avoids schema changes

## Exact Product Semantics

### What this feature is trying to catch for videos

This feature is intended to catch common accidental duplicates such as:

- the same local video selected twice in one batch
- the same local video reselected again shortly after
- an obvious repeated upload of the same exported file name and file size into the same project

### What this feature is intentionally not trying to guarantee

This feature is not trying to guarantee:

- renamed exact duplicate detection
- all byte-identical copies across devices or environments
- exact server-authoritative video dedupe
- robust detection of transcoded or otherwise modified copies

The product intent is explicit:

- some duplicate videos are acceptable in exchange for a much cheaper client path

## Exact Client-Side Behavior

### Images

Images stay exactly as they are today:

- eager full-file SHA-256 hashing remains unchanged
- current image duplicate preflight and server enforcement remain unchanged
- current image duplicate-policy behavior remains unchanged

### Videos

For `assetType = "video"`:

- do not run eager full-file hashing
- do not populate `contentHash` during the normal client prepare flow
- derive a cheap duplicate key client-side instead

### Chosen client-side video duplicate key

For videos, derive and store:

- `normalizedFilename`
  - lowercase
  - trimmed
  - use the full filename including extension
- `fileSizeBytes`
- `lastModified`

Then build:

- `videoDuplicateKey = normalizedFilename + "::" + fileSizeBytes + "::" + lastModified`

Also derive:

- `videoServerDuplicateKey = normalizedFilename + "::" + fileSizeBytes`

This keeps client logic explicit:

- the local key is stronger for same-local-file collisions
- the server key is the portable subset the server can check against stored assets

### Manifest model changes

Add minimal video-heuristic fields to `ProjectUploadItem`, for example:

- `normalizedFilename: string | null`
- `duplicateKey: string | null`
- `serverDuplicateKey: string | null`

Behavior:

- for photos, these may remain `null`
- for videos, these are populated on item creation, before prepare

### Same-selection duplicate handling

For videos in the current selection:

- use `duplicateKey` (`filename + size + lastModified`) for same-selection duplicate detection
- set `isDuplicate` from that heuristic for video items before prepare

This should catch the strongest local accidental duplicate case without reading file bytes.

### Preflight behavior from the client

For photos:

- keep current `contentHash`-based preflight unchanged

For videos:

- send metadata for heuristic duplicate lookup instead of `contentHash`
- include enough data for server-side video duplicate preflight, for example:
  - `name`
  - normalized filename or the raw filename if the server re-normalizes it
  - `size`
  - optional `lastModified` only if useful for client-result mapping, not for DB lookup

### Prepare behavior from the client

For photos:

- keep current prepare request shape unchanged

For videos:

- do not send `contentHash` in the normal path
- send the heuristic duplicate fields needed for:
  - same-request duplicate suppression in batch prepare
  - server-side filename+size fallback behavior

### Duplicate-policy UI participation

The current duplicate-policy flow remains in place.

For videos:

- duplicates in the same selection can trigger policy choice via `duplicateKey`
- existing-project duplicate candidates can trigger policy choice via video preflight heuristic matches

The queue surface stays unified.

## Exact Server-Side Behavior

## General rule

Keep server-side changes minimal and scoped to video when `contentHash` is absent.

For photos:

- no change

For videos:

- support heuristic duplicate handling when `contentHash` is missing

### Preflight behavior for videos

Current preflight already accepts `assetType`.

Planned video behavior:

- if `assetType = "video"` and no `contentHash` is supplied, preflight should perform heuristic duplicate lookup using:
  - normalized filename
  - exact file size

Smallest safe implementation shape:

- query existing video assets in the same tenant/project by candidate `file_size_bytes`
- filter the returned rows in application code by normalized `original_filename`
- return a new video-heuristic duplicate result field, for example:
  - `duplicateVideoKeys`
  - or per-file matched duplicate keys

Keep existing image `duplicateHashes` behavior unchanged.

### Batch prepare same-request behavior for videos

Current batch prepare only suppresses same-request duplicates when `contentHash` exists.

Planned video behavior:

- if `assetType = "video"` and `contentHash` is absent, use the client-provided `duplicateKey` for same-request duplicate suppression
- keep `upload_anyway` unchanged
- for `ignore` and `overwrite`, later same-request video duplicates with the same `duplicateKey` are treated as duplicates in the current batch

This is a small compatibility change in `prepare-project-asset-batch.ts`, not a redesign.

### Create-time duplicate behavior for videos

Current create-time duplicate lookup only runs when `contentHash` exists.

Planned video behavior:

- if `assetType = "video"` and `contentHash` is absent:
  - use heuristic duplicate lookup by normalized filename + exact size
  - scope the lookup to tenant + project + asset type as today

Behavior by policy:

- `upload_anyway`
  - always create the new video asset
- `ignore`
  - skip upload when a heuristic video duplicate match is found
- `overwrite`
  - archive heuristic video duplicates and create the new replacement asset

This is intentionally heuristic. It is not exact byte-level dedupe.

### Content-hash posture for videos

For this feature:

- `contentHash` remains valid and supported if ever provided
- but it is no longer required for normal video duplicate checks
- normal first-pass video duplicate behavior is heuristic, not exact

### Migration and schema

No schema change is required for 062A.

The existing `content_hash` migration remains in place for the broader asset system, but 062A does not depend on adding new video-specific columns.

## Mixed-Upload Behavior

Mixed uploads remain on one queue surface.

Planned behavior:

- images continue exact hashing and exact duplicate checks
- videos skip eager full-file hashing and use the cheap heuristic path
- one manifest still tracks both asset types
- one duplicate-policy UI still covers the batch
- one create/finalize/storage flow remains in place

This preserves the current mixed-upload architecture while removing the worst video hashing cost.

## Duplicate-Policy UX Decision

Keep the current duplicate-policy UI structure unchanged.

Recommended minimal UX change:

- keep the same policy choices:
  - `upload_anyway`
  - `overwrite`
  - `ignore`
- add one small video-specific explanatory note when the batch includes video duplicate checks

Recommended wording intent:

- video duplicate checks are approximate and based on file metadata

Why this small wording change is worth it:

- the product semantics for videos are intentionally weaker than images in this feature
- the UI should not overclaim exactness

Recommended i18n impact:

- add only the minimal new keys needed for that note
- keep the existing duplicate-policy labels unchanged

## Safety And Risk Analysis

### Likely false negatives

Video duplicates may be missed when:

- the same video is renamed before upload
- the same bytes are exported with a different filename
- the same video is copied to another environment with different file metadata
- a duplicate has the same content but a different file size due to re-encoding

This is acceptable in this feature because the product explicitly prefers cheaper uploads over perfect video dedupe.

### Likely false positives

Video duplicates may be incorrectly flagged when:

- two unrelated videos share the same filename and exact size
- a camera or export tool produces reused filenames with identical file sizes
- a user intentionally uploads a distinct video revision that happens to match filename and size

This is partly mitigated by:

- using `lastModified` in the client-local duplicate key
- keeping server duplicate scope restricted to the same tenant/project/video type
- keeping `upload_anyway` available as the default escape hatch

### Why this tradeoff is acceptable

This feature is explicitly optimized for:

- avoiding large in-memory video reads on slower laptops
- reducing startup stalls
- keeping the uploader practical for real users on weaker devices

The application can tolerate some duplicate videos better than it can tolerate an upload experience that becomes sluggish, memory-heavy, or unstable.

## Security And Reliability Considerations

- tenant scoping remains server-side only
- project scoping remains server-side only
- no client-provided `tenant_id` is introduced
- signed upload URLs remain server-generated
- current create/finalize/storage behavior remains intact
- no second uploader surface is introduced

Reliability posture after this change:

- much lower memory pressure for videos because eager full-file hashing is removed
- lower CPU spikes before queue start
- faster queue startup for video-heavy and mixed selections
- no new schema migration risk

Known bounded limitations that remain:

- video duplicate detection is heuristic
- interrupted uploads still restart from zero
- refresh still loses live `File` objects
- some duplicates will be missed

## Edge Cases

- same video selected twice in one batch:
  - should be caught by the local `duplicateKey`
- same local video reselected later:
  - should usually be caught by the heuristic path if filename, size, and local metadata still match
- renamed exact duplicate video:
  - intentionally may not be caught
- same filename and same size but different content:
  - may be flagged as duplicate heuristically
- mixed batch with many photos and some videos:
  - photos stay exact
  - videos stay cheap
  - one queue surface remains
- video uploads with no `contentHash`:
  - server should still prepare and create successfully
- browser refresh or stale signed URL:
  - current manifest and retry behavior remain unchanged

## Test Plan

Add focused tests for the heuristic video path while preserving image behavior.

### Image behavior unchanged

- image duplicate behavior remains exact
- image hashing path remains unchanged
- image preflight and prepare behavior remain unchanged

### Video heuristic behavior

- video items derive the cheap duplicate key instead of eager `contentHash`
- same video selected twice in one batch is caught by the heuristic key
- obvious repeated local video uploads are caught when filename and size match
- videos can prepare and upload normally when `contentHash` is absent

### Mixed-upload behavior

- mixed image/video uploads still use one queue surface
- images still follow the exact path
- videos follow the heuristic path
- duplicate-policy flow remains coherent across mixed batches

### Server compatibility behavior

- video preflight works without `contentHash`
- batch prepare suppresses same-request video duplicates using the heuristic key
- create helper remains stable when video `contentHash` is absent
- image server duplicate behavior remains unchanged

Recommended test locations:

- extend upload-related tests where practical
- add focused unit tests around client-side duplicate-key derivation
- add targeted helper tests for video preflight and create fallback logic

## Implementation Phases

### Phase 1: Client video duplicate-key strategy

- add normalized video duplicate-key helpers
- populate video duplicate fields in manifest items
- branch the uploader so videos skip eager full-file hashing
- keep image hashing untouched

### Phase 2: Minimal server compatibility changes

- extend video preflight to support heuristic duplicate matching without `contentHash`
- extend batch prepare same-request video duplicate handling to use the video duplicate key
- extend create-time video duplicate fallback to use filename+size when `contentHash` is absent
- keep image duplicate logic unchanged

### Phase 3: Duplicate-policy/UI wording only if necessary

- keep current duplicate-policy structure
- add only a small video-specific explanatory note if needed
- add only the minimal i18n keys required

### Phase 4: Tests and cleanup

- add regression coverage for image unchanged / video heuristic / mixed upload coherent
- verify no accidental storage/finalize redesign drift
- tighten any typing needed for optional video duplicate-key fields

## Explicitly Deferred Work

- exact video byte-level duplicate checking
- worker-based or chunked exact video hashing
- queue redesign
- resumable uploads
- server-side streaming hash calculation
- changing image duplicate behavior
- broader duplicate-policy redesign
- schema redesign for dedicated persisted video duplicate metadata

## Concise Implementation Prompt

Implement Feature 062A as a bounded product tradeoff for video uploads. Keep image duplicate checking exactly unchanged. For videos, stop eager full-file client hashing and replace it with a cheap heuristic duplicate path based on normalized filename, exact file size, and `lastModified` on the client, with server-side project duplicate lookup using normalized filename plus exact file size when `contentHash` is absent. Preserve the existing upload surface, queue UI, create/finalize/storage pipeline, mixed-upload flow, tenant/project scoping, and duplicate-policy structure. Add only the minimal manifest/type fields needed for video duplicate keys, update video preflight and batch prepare to work without normal video `contentHash`, and add a small video-specific duplicate explanation in the UI only if necessary. Treat this feature as catching common accidental duplicate videos rather than guaranteeing exact byte-level video dedupe, and add focused tests proving image behavior is unchanged, video duplicates use the heuristic key, obvious same-file repeats are caught, mixed uploads still work, and server behavior remains stable when video `contentHash` is absent.
