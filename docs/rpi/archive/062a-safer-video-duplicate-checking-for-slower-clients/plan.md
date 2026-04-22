# Feature 062A Plan: Safer Video Duplicate Checking For Slower Clients

## Inputs And Ground Truth

This plan is based on the live repository code and schema as the source of truth.

Inputs read in the required order:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/065-video-client-duplicate-hashing/research.md`

Targeted live verification for the planning boundary:

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
- `docs/rpi/062-video-upload-foundation/research.md`
- `docs/rpi/062-video-upload-foundation/plan.md`
- `src/lib/assets/asset-upload-policy.ts`

## Verified Current Planning Boundary

### Current client-side duplicate flow

Live code confirms:

- the project uploader still uses one shared queue surface in `assets-upload-form.tsx`
- `handleFileSelection(...)` calls `prepareSelectedItemsForQueue(...)` and only then starts the queue
- videos are hashed eagerly during prepare, before upload starts
- the hashing helper still uses `file.arrayBuffer()` plus `crypto.subtle.digest("SHA-256", ...)`
- photos and videos share the same duplicate-hash helper
- current video-specific throttling is limited to:
  - hash concurrency `1`
  - PUT concurrency `1`
  - prepare/finalize batch size `10`

The current bottleneck is therefore not duplicate semantics first. It is the cost of how the exact duplicate hash is produced for videos.

### Current server-side duplicate enforcement

Live code confirms:

- duplicate checks are scoped by tenant, project, asset type, and `content_hash`
- `assets.content_hash` already exists and is indexed by the migration `20260305150000_005_assets_content_hash.sql`
- preflight returns both `candidateSizes` and `duplicateHashes`
- the current client path uses full-file hashing first and then uses preflight `duplicateHashes`
- batch prepare suppresses same-request duplicates only when a normalized `contentHash` is present
- `createAssetWithIdempotency(...)` only performs duplicate lookup when `contentHash` is present and `duplicatePolicy !== "upload_anyway"`

This means any strategy that intentionally omits `contentHash` for normal video uploads weakens authoritative duplicate handling on the server.

### Current Feature 062 boundary and live drift

Feature 062 already landed in the live codebase. Important live facts:

- video upload support already exists
- `asset-upload-policy.ts` already supports `video`
- the live video max size is `2 GB`, not the `250 MB` value discussed in older 062 planning
- batch prepare already accepts `assetType: "video"`
- duplicate behavior for videos is already wired through the same `content_hash` model as photos

So Feature 062A is not another video-foundation feature. It is a narrow follow-up to make current video duplicate hashing safer on slower clients.

## Recommendation

Implement Feature 062A as a video-only hashing implementation change, not a duplicate-semantics redesign.

Chosen recommendation:

- keep exact duplicate detection semantics for images unchanged
- keep exact duplicate detection semantics for videos unchanged
- keep `content_hash` as the normal first-pass video duplicate signal
- replace eager full-file video hashing with chunked incremental SHA-256 hashing in a Web Worker
- keep current server preflight, prepare, create, and duplicate-policy semantics unchanged unless a tiny compatibility adjustment is required during implementation

This is the safest practical option because it directly reduces the slower-client cost that the research identified without reintroducing the hash-availability regressions previously documented in Feature 028.

## Chosen Video Duplicate Strategy

### Options evaluated

#### Option A: Keep current full client-side content hash

Shape:

- keep video duplicate detection exactly as-is
- continue full-file `arrayBuffer()` reads in the browser

Pros:

- no behavioral change
- duplicate semantics remain exact

Cons:

- keeps the slower-client bottleneck unchanged
- keeps the whole-file memory spike
- keeps the current startup responsiveness problem

Assessment:

- rejected because it does not solve the actual problem

#### Option B: Use `filename + filesize`

Shape:

- do not hash videos eagerly
- infer duplicates from a cheap client-side key such as `(originalFilename, fileSizeBytes)`

Pros:

- very cheap on the client
- no full-file read required

Cons:

- introduces false positives
- introduces false negatives
- cannot safely drive existing `ignore` or `overwrite` policy behavior as an authoritative duplicate signal
- does not align with the current byte-identical duplicate model already enforced for photos and videos

Assessment:

- rejected as the primary video duplicate strategy

#### Option C: Two-stage cheap key first, exact hash only in narrower cases

Examples:

- `filename + filesize` first, exact hash later
- size-only or other cheap heuristic first, exact hash only for candidate videos

Pros:

- lower average client cost
- fewer full-file hashes when the cheap key rarely collides

Cons:

- if the cheap key controls whether `contentHash` exists at all, server-side duplicate enforcement becomes conditional again
- that recreates the same class of correctness problem already documented in Feature 028: no hash means no authoritative duplicate lookup in create/prepare
- same-batch and overlapping-batch behavior becomes harder to reason about
- adds more semantic complexity than this bounded cycle should take on

Assessment:

- rejected for 062A because it weakens correctness in exchange for savings that can be achieved more safely by changing the video hashing implementation itself

### Chosen strategy

For `assetType = "video"`:

- continue using exact SHA-256 content-hash duplicate detection
- continue sending `contentHash` to preflight and batch prepare in the normal path
- change only how the client computes the hash:
  - from full-file `arrayBuffer()` reads
  - to chunked incremental hashing in a dedicated worker

For `assetType = "photo"`:

- leave hashing behavior exactly unchanged

## Risk Analysis Of The Chosen Strategy

### Why `filename + filesize` is not acceptable as the chosen strategy

#### False-positive risk

Two different videos can legitimately share the same filename and size while having different bytes.

Concrete product risk:

- a user could be shown the duplicate-policy UI for a non-duplicate video
- choosing `ignore` could skip a legitimate new upload
- choosing `overwrite` could archive an unrelated existing video

That is too risky for a consent/media system where asset retention and auditability matter.

#### False-negative risk

An exact duplicate video can be renamed.

Concrete product risk:

- the same byte-identical file uploaded as `clip.mp4` and later as `clip-copy.mp4` would not be flagged
- the server would not perform the current authoritative duplicate lookup because no `contentHash` would be available

That is weaker than the current product semantics and weaker than current image behavior.

### Why the two-stage cheap-key approach is also not the right fit here

The main problem is not that exact hashing is conceptually wrong. The problem is the current implementation cost of exact hashing for videos.

A cheap-key gate would move correctness onto a heuristic:

- videos with no cheap-key collision would often have no `contentHash`
- `prepareProjectAssetBatch(...)` would then have no same-request hash signal
- `createAssetWithIdempotency(...)` would skip authoritative duplicate lookup for those videos

That is precisely the wrong tradeoff for this bounded cycle.

### Why the chosen strategy is safer

The chosen strategy:

- preserves exact duplicate semantics
- avoids introducing false-positive policy actions
- avoids heuristic false-negative blind spots
- reduces peak client memory usage
- improves responsiveness without changing server trust boundaries

Residual risk that remains:

- hashing large videos still costs wall-clock time because all bytes still need to be read and hashed
- 062A reduces peak memory pressure and main-thread responsiveness problems more than it reduces total hashing time

That residual risk is acceptable for one bounded cycle and is explicitly smaller than the current whole-buffer risk.

## Exact Client-Side Behavior

### Photos

Photo duplicate behavior remains exactly unchanged:

- same helper semantics
- same eager hashing timing
- same `contentHash` handling
- same duplicate-policy UI

No photo logic is intentionally modified in this feature.

### Videos

For `assetType = "video"`:

1. selected videos still enter the current manifest and queue surface unchanged
2. videos still transition through `needs_hash -> ready_to_prepare`
3. videos still produce a SHA-256 `contentHash`
4. videos still send that `contentHash` to preflight and batch prepare
5. videos still participate in the existing duplicate-policy flow

The bounded change is only the hashing implementation:

- add a video-only hashing path that reads the file in fixed-size chunks
- compute the same lowercase SHA-256 hex digest incrementally
- run that work in a Web Worker so the main thread does not perform the entire hash loop directly

### Suggested helper shape

Add new client helpers under `src/lib/uploads/` for clarity, for example:

- `project-upload-video-hash-worker.ts`
- `project-upload-video-hash.ts`

Keep the current `project-upload-duplicate-detection.ts` file as the stable boundary for upload-form usage, but branch internally by asset type:

- photo -> current `arrayBuffer()` hash path
- video -> new chunked worker-backed exact hash path

### Fallback behavior

For compatibility:

- if worker-backed video hashing is unavailable, fall back to the current full-buffer exact hash path
- if hashing still fails, keep the current generic hash-unavailable behavior for this cycle

This keeps the change small and avoids a duplicate-policy UX redesign.

### Queue startup behavior

The current queue startup ordering should remain unchanged in 062A:

- `handleFileSelection(...)` still prepares before starting the queue
- mixed uploads still use one queue surface

The improvement comes from reducing video hashing memory pressure and main-thread cost, not from redesigning queue orchestration.

## Exact Server-Side Behavior

### Content-hash posture

For normal video uploads in 062A:

- `content_hash` remains the intended first-pass duplicate signal
- `content_hash` remains exact SHA-256
- `content_hash` is not replaced by a filename-based duplicate key

At the API contract level:

- `contentHash` stays technically optional for backward compatibility
- 062A does not intentionally omit it for videos in the normal path

### Preflight

Keep the current route contract unchanged:

- `POST /api/projects/[projectId]/assets/preflight`

No new video-specific heuristic key is added.

No new duplicate fields are introduced.

`candidateSizes` may remain unused by the client for this feature. 062A is not reintroducing size-gated hashing.

### Batch prepare

Keep the current route contract unchanged:

- `POST /api/projects/[projectId]/assets/batch/prepare`

Keep same-request duplicate suppression unchanged:

- request-local duplicate suppression still keys off normalized `contentHash`

### Create helper

Keep `createAssetWithIdempotency(...)` duplicate handling unchanged:

- duplicate lookup still keys off `(tenant_id, project_id, asset_type, content_hash)`
- `ignore` and `overwrite` semantics remain unchanged

### Migration and schema

No schema change is required for 062A.

The existing migration already provides the necessary storage boundary:

- `assets.content_hash`
- `assets.content_hash_algo`
- `(tenant_id, project_id, content_hash)` index

## Duplicate Policy UX Decision

Keep the current duplicate-policy UX unchanged.

That means:

- same policy choices:
  - `upload_anyway`
  - `overwrite`
  - `ignore`
- same policy prompt shape
- same queue surface
- same duplicate-policy timing in the flow

No new video-specific duplicate-policy choice should be added.

### i18n impact

Preferred plan:

- add no new duplicate-policy i18n keys
- reuse existing generic duplicate and hashing copy

Only add a new translation key if implementation proves a new user-facing fallback warning is strictly necessary. That is not the planned default.

## Mixed-Upload Behavior

Mixed uploads must continue to work in one queue surface.

Planned behavior:

- images keep exact duplicate checks unchanged
- videos keep exact duplicate checks, but with the lighter hashing implementation
- one shared manifest continues to hold both asset types
- one duplicate-policy UI continues to cover the selection
- preflight and prepare remain grouped by `assetType` as they are today

This keeps current mixed-upload architecture intact while making the video portion safer for slower clients.

## Security And Reliability Considerations

- tenant scoping remains server-side only
- project scoping remains server-side only
- no client-provided `tenant_id` is introduced
- server-side duplicate enforcement remains authoritative when `contentHash` is present
- service-role storage signing remains server-only
- no second uploader surface is introduced
- no storage-path or finalize redesign is introduced

Reliability posture for slower clients:

- lower peak memory pressure from avoiding whole-video `arrayBuffer()` reads
- lower main-thread responsiveness risk by moving video hashing work into a worker
- no added database cost beyond the current duplicate queries
- no added authenticated request count

Residual reliability limitations intentionally left unchanged:

- interrupted uploads still restart from zero
- refresh still loses live `File` objects
- hashing large videos still takes time

## Edge Cases

- same video selected twice in one batch:
  - still detected by exact hash and current same-request duplicate handling
- renamed exact duplicate video:
  - still detected because the exact content hash is preserved
- same filename and same size but different bytes:
  - not treated as duplicates because filename/size is not the chosen strategy
- mixed batch with many photos and some videos:
  - remains one queue surface
  - photos keep current behavior
  - video hashing becomes lighter on memory and UI responsiveness
- browser without worker support or worker hash failure:
  - fall back to current exact full-buffer video hash
- total video hash time for very large files:
  - may still be noticeable
  - 062A reduces peak memory and responsiveness problems more than total byte-read time
- refresh during hashing or upload:
  - current manifest recovery behavior remains unchanged

## Test Plan

Add focused regression coverage for the new video hashing strategy without broad uploader redesign tests.

### Helper-level tests

- photo hashing path remains unchanged and still uses the current direct full-buffer helper behavior
- video hashing path uses the new chunked worker-backed path
- video hashing produces the same SHA-256 hex output format as the current helper
- worker-unavailable path falls back to the current exact full-buffer video hash

### Client uploader tests

- image duplicate behavior remains unchanged
- video uploads still populate `contentHash` before duplicate preflight/prepare in the normal path
- mixed image/video selections still use one queue surface
- duplicate-policy behavior remains coherent for videos under the existing UI
- slower-client-oriented video path does not break normal prepare/startQueue behavior

### Server compatibility tests

- existing server duplicate handling for video continues to operate on `contentHash`
- same-request video duplicate suppression in batch prepare remains unchanged
- create helper duplicate enforcement for video remains unchanged when `contentHash` is provided

Recommended test locations:

- extend existing upload tests where practical
- add focused unit-style tests around the new video hashing helper/worker boundary

## Implementation Phases

### Phase 1: Strategy And Helper Boundary

- add a dedicated video-only exact hashing helper
- add a worker-backed chunked hashing implementation for videos
- keep the public upload-form hashing boundary small and explicit
- keep photo hashing behavior untouched

### Phase 2: Client Uploader Changes For Videos Only

- branch hashing behavior by `assetType` in the current upload flow
- keep current manifest fields (`contentHash`, `contentHashAlgo`, `isDuplicate`) unchanged
- keep current duplicate-policy and queue-state behavior unchanged
- wire fallback behavior for unsupported worker environments

### Phase 3: Minimal Server-Side Compatibility Changes

- preferred outcome: no behavioral server changes
- only make tiny compatibility or typing cleanups if implementation proves they are required
- keep preflight, batch prepare, and create duplicate semantics unchanged

### Phase 4: Tests And Cleanup

- add helper tests for video hashing behavior
- add regression coverage for image unchanged / video changed / mixed upload unchanged
- verify no accidental duplicate-semantics drift in prepare/create

## Explicitly Deferred Work

- filename-plus-filesize duplicate detection
- heuristic video duplicate keys
- size-gated or cheap-key-gated omission of `contentHash`
- queue redesign to start photo uploads before all video hashing finishes
- new duplicate-policy UI variants for video
- server-side streaming hash calculation
- resumable or multipart video uploads
- lowering the live video size cap as part of 062A

## Concise Implementation Prompt

Implement Feature 062A as a narrow follow-up to the live video upload pipeline. Keep image duplicate checking exactly unchanged. Keep video duplicate semantics exact and continue using `contentHash` as the normal first-pass duplicate signal for preflight, batch prepare, and create-time duplicate enforcement. Do not introduce filename-plus-filesize duplicate policy behavior and do not gate normal video duplicate correctness on a cheap heuristic key. Instead, change only the client-side video hashing implementation: add a video-only chunked incremental SHA-256 hashing path that runs in a Web Worker and returns the same lowercase hex digest currently used by the uploader, while leaving the photo path on the current full-buffer helper. Wire the uploader so `assetType = "video"` uses the new exact hashing implementation before duplicate preflight/prepare, keep the existing duplicate-policy UI and mixed-upload queue surface unchanged, and fall back to the current exact full-buffer hash path if worker-backed video hashing is unavailable. Make no schema change and avoid server behavior changes unless a tiny compatibility cleanup is required. Add focused tests that prove image behavior is unchanged, video hashing now uses the lighter exact path, mixed image/video uploads still work, and existing video duplicate-policy decisions still operate on exact hashes.
