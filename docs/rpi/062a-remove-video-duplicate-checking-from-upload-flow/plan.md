# Feature 062A Plan: Remove Video Duplicate Checking From The Upload Flow

## Inputs And Ground Truth

This plan is based on the live repository code and schema as the source of truth.

Inputs read in the required order:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/062a-remove-video-duplicate-checking-from-upload-flow/research.md`

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
- `src/lib/assets/asset-upload-policy.ts`
- `docs/rpi/062-video-upload-foundation/research.md`
- `docs/rpi/062-video-upload-foundation/plan.md`

## Verified Current Planning Boundary

### Current client-side upload queue and duplicate behavior

Live code confirms:

- the project uploader uses one queue surface in `src/components/projects/assets-upload-form.tsx`
- `handleFileSelection(...)` still calls `prepareSelectedItemsForQueue(...)` before `startQueue()`
- `prepareSelectedItemsForQueue(...)` currently hashes both photos and videos eagerly
- the current helper still does `file.arrayBuffer()` plus `crypto.subtle.digest("SHA-256", ...)`
- duplicate-policy UI is driven by `isDuplicate` items and queue state `awaiting_policy`
- current batch duplicate detection is hash-based for both photos and videos

This means the current video cost is entirely in the normal upload path, before upload starts.

### Current server-side duplicate enforcement

Live code confirms:

- `assets.content_hash` already exists and is indexed by `(tenant_id, project_id, content_hash)`
- preflight currently returns:
  - `candidateSizes`
  - `duplicateHashes`
- batch prepare same-request duplicate suppression only happens when `contentHash` is present
- create-time duplicate lookup only happens when `contentHash` is present and `duplicatePolicy !== "upload_anyway"`
- create still succeeds when `contentHash` is absent because `content_hash` is nullable and duplicate lookup is skipped

That makes this feature feasible without schema changes:

- videos can already prepare and create without a `contentHash`

### Current video upload boundary

Feature 062 is already live in the repository. Relevant current facts:

- video upload support already exists
- video validation already exists in `asset-upload-policy.ts`
- videos currently allow up to `2 GB`
- batch prepare already accepts `assetType: "video"`
- the current video duplicate path is not a separate system; it is the same hash-based flow used by photos

So 062A is a narrow removal of video duplicate checking from the upload flow, not another video-foundation feature.

## Recommendation

Implement 062A as a bounded removal of video duplicate checking from the normal upload path.

Chosen recommendation:

- keep image duplicate checking exactly unchanged
- remove eager duplicate hashing for videos
- remove normal video duplicate preflight checks
- remove normal same-request duplicate suppression for videos in batch prepare
- leave current create/finalize/storage behavior intact
- keep one queue surface and one mixed-upload flow

This intentionally accepts duplicate videos in exchange for:

- no eager large-file video hashing
- lower memory pressure
- lower CPU spikes
- faster queue startup on slower laptops
- zero false-positive duplicate warnings for videos

## Chosen Product Semantics

### Core decision

Videos do not participate in duplicate checking during the normal upload flow.

Images continue to participate in exact duplicate checking exactly as they do today.

### Explicit intended behavior

For photos:

- exact client-side hashing remains
- exact duplicate-policy behavior remains
- existing server-side duplicate enforcement remains

For videos:

- no eager duplicate hashing
- no normal duplicate preflight behavior
- no normal duplicate-policy gating
- duplicate videos are acceptable

### Explicit non-goals

This feature is intentionally not trying to:

- catch duplicate videos
- infer video duplicates heuristically
- maintain exact video dedupe guarantees
- replace video hashing with a cheap heuristic warning system

The product tradeoff is explicit:

- allowing duplicate videos is preferable to slowing or destabilizing uploads on slower clients

## Exact Client-Side Behavior

### Images

Image behavior remains exactly unchanged:

- same hashing helper behavior
- same prepare-time exact hashing
- same duplicate preflight flow
- same duplicate-policy gating

### Videos

For `assetType = "video"`:

- do not call the eager hashing helper during normal prepare
- do not set `contentHash` during the normal upload path
- do not call duplicate preflight as part of normal video prepare
- do not mark video items `isDuplicate` from upload-flow duplicate logic

### Queue behavior

The queue remains shared.

The minimal client-side change is:

- branch `prepareSelectedItemsForQueue(...)` by asset type
- photos stay on the current exact path
- videos skip the duplicate-checking path and transition directly to `ready_to_prepare`

This keeps:

- one manifest
- one queue UI
- one mixed-upload selection surface

without redesigning queue orchestration.

### Same-selection duplicate handling for videos

Preferred choice for this feature:

- no same-selection duplicate suppression for videos

Reason:

- the product intent explicitly prefers no video duplicate checking over cheap but inaccurate checks
- even tiny local duplicate warnings for videos would reintroduce video-specific duplicate semantics and edge cases

### Client request behavior

For photos:

- keep current preflight and prepare payloads unchanged

For videos:

- do not depend on `contentHash` in preflight
- do not depend on `contentHash` in prepare
- normal prepare request can continue sending `contentHash: null`

## Exact Server-Side Behavior

### General rule

Keep server-side changes minimal and scoped to preventing video duplicate checks from triggering in the normal flow.

For photos:

- no change

For videos:

- allow upload flow to proceed normally with no duplicate checking

### Preflight behavior for videos

Preferred smallest change:

- keep the route contract intact
- for `assetType = "video"`, return no duplicate-triggering result in the normal path

Practical plan:

- do not rely on `duplicateHashes` for videos
- either:
  - have the client skip preflight for videos entirely, or
  - keep the route callable but treat video preflight results as non-operative

Preferred implementation choice:

- client skips duplicate preflight for videos during the normal upload flow

Why:

- smallest behavior change
- avoids unnecessary server work
- makes the product semantics clearer

### Batch prepare behavior for videos

Current batch prepare only suppresses same-request duplicates when `contentHash` exists.

Planned video behavior:

- if `assetType = "video"`, batch prepare should not perform same-request duplicate suppression in the normal path
- video items should proceed to prepare even when `contentHash` is absent

Smallest safe server-side change:

- make same-request duplicate suppression explicitly photo-only
- or equivalently gate it on `assetType !== "video"`

This avoids hidden future regressions if video hashes appear intermittently.

### Create-time duplicate behavior for videos

Current create helper only performs duplicate lookup when `contentHash` exists.

Planned video behavior:

- keep create-time duplicate lookup unchanged for photos
- remove create-time duplicate lookup for videos in the normal upload flow
- allow videos to create normally when `contentHash` is absent
- tolerate duplicate video creates even if a video `contentHash` is later supplied by another caller

Smallest compatibility decision:

- do not add a heuristic fallback for videos
- do not add filename/size duplicate lookup for videos

That preserves the product intent:

- no duplicate checking for videos in the normal upload flow

### Schema and migration posture

No schema change is required for 062A.

The existing `content_hash` migration stays in place for the broader asset system, but 062A does not require new columns or constraints.

## Duplicate-Policy UX Decision

Videos should bypass duplicate-policy UI in the normal upload path.

Preferred implementation shape:

- duplicate-policy UI remains exactly as it is for images
- videos do not set `isDuplicate` in the normal path
- videos therefore do not contribute to `awaiting_policy`

This is the smallest and clearest UX:

- users are not shown misleading video duplicate warnings
- users are not led to think video duplicate detection still exists

No new video-specific duplicate UI is needed.

## Mixed-Upload Behavior

One queue surface remains.

Planned mixed behavior:

- photos still perform exact duplicate checks
- videos skip duplicate checking and proceed normally
- a mixed batch can still reach duplicate-policy UI if photos trigger it
- videos should not cause duplicate-policy decisions in the normal path

This keeps mixed uploads coherent:

- image behavior is preserved
- video behavior is simplified

## Manifest And Type Model Changes

Keep manifest/type changes minimal.

### Current model

Current `ProjectUploadItem` already allows:

- `contentHash: string | null`
- `contentHashAlgo: "sha256" | null`
- `needsHash: boolean`
- `hashStatus`
- `isDuplicate`

### Planned minimal changes

No broad queue-model redesign is needed.

Small planned adjustments:

- allow video items to stay with:
  - `contentHash = null`
  - `contentHashAlgo = null`
- stop forcing video items into `needs_hash` during normal prepare
- allow video items to move directly toward `ready_to_prepare`

Optional cleanup:

- use `hashStatus = "not_needed"` for videos in the normal path for clarity
- set `needsHash = false` for videos

No new video-specific duplicate-key fields are needed because this feature is removing video duplicate checking, not replacing it.

## Safety And Reliability Considerations

### Safety posture

This change intentionally:

- removes false-positive duplicate warnings for videos
- removes false-positive duplicate skips for videos
- removes eager large-file processing from the video duplicate path

### Reliability posture

This improves slower-client behavior by:

- removing full-file video hashing from normal prepare
- lowering startup CPU and memory pressure
- allowing video uploads to begin without duplicate-evaluation work

### Accepted tradeoff

This also intentionally increases:

- the chance that duplicate videos are uploaded

That is acceptable for the product in this feature.

## Edge Cases

- same video selected twice in one batch:
  - both uploads may proceed
  - this is acceptable in this feature
- duplicate video already exists in the project:
  - new upload may still proceed
  - this is acceptable in this feature
- mixed batch with duplicate photos and videos:
  - duplicate-policy UI may still appear for photos
  - videos should not be the reason the policy UI appears
- video uploads with no `contentHash`:
  - should prepare and create normally
- stale signed URL or refresh:
  - current retry/recovery behavior remains unchanged
- future code path accidentally supplying `contentHash` for video:
  - server-side plan should make video duplicate suppression explicitly non-operative in the normal batch prepare path to avoid partial reintroduction

## Test Plan

Add focused regression coverage for removal of video duplicate checking while preserving image behavior.

### Image behavior unchanged

- image duplicate behavior remains exact
- image hashing path remains unchanged
- image duplicate-policy flow remains unchanged
- image server duplicate enforcement remains unchanged

### Video behavior

- video uploads proceed without eager duplicate hashing
- video uploads are not blocked by missing `contentHash`
- video items do not trigger duplicate-policy decisions in the normal path
- same video selected twice in one batch is not treated as a duplicate gate in the normal path

### Mixed-upload behavior

- mixed image/video uploads still work in one queue surface
- photos can still trigger duplicate-policy UI
- videos do not trigger duplicate-policy UI in the normal path

### Server compatibility behavior

- batch prepare succeeds for videos with `contentHash = null`
- create helper remains stable for video uploads with `contentHash = null`
- video preflight is skipped or non-operative without breaking the flow

Recommended test locations:

- extend upload-related tests where practical
- add focused tests around `prepareSelectedItemsForQueue(...)` behavior by asset type
- add targeted helper tests for video prepare/create without `contentHash`

## Implementation Phases

### Phase 1: Client-side video duplicate bypass

- branch normal prepare behavior by asset type
- keep photos on the current exact-hash path
- move videos to a no-hash, no-duplicate-check path
- ensure videos do not set duplicate-gating state

### Phase 2: Minimal server compatibility changes

- make video batch prepare explicitly tolerate and ignore missing `contentHash`
- make same-request duplicate suppression effectively photo-only
- keep photo duplicate behavior unchanged

### Phase 3: Duplicate-policy/UI cleanup if needed

- verify videos do not trigger duplicate-policy UI
- add no new video duplicate copy unless implementation proves it necessary
- keep UI wording minimal and avoid misleading video duplicate messaging

### Phase 4: Tests and cleanup

- add regression coverage for image unchanged / video bypass / mixed upload coherent
- tighten any item-status or type cleanup needed for `hashStatus = "not_needed"` behavior
- verify no accidental storage/finalize redesign drift

## Explicitly Deferred Work

- heuristic video duplicate checking
- exact video duplicate checking
- worker-based or chunked video hashing
- uploader redesign
- resumable uploads
- server-side streaming hash calculation
- changing image duplicate behavior
- broad duplicate-policy redesign

## Concise Implementation Prompt

Implement Feature 062A as a narrow removal of video duplicate checking from the normal upload flow. Keep image duplicate checking exactly unchanged. In the client uploader, branch by `assetType` so photos stay on the current eager hash and duplicate-policy path, while videos skip eager hashing, skip normal duplicate preflight, do not set duplicate-gating state, and proceed directly toward prepare/upload with `contentHash = null`. Keep one queue surface and one mixed-upload flow. On the server, make only the smallest compatibility changes needed so video batch prepare and create continue to work normally without `contentHash`, and ensure same-request duplicate suppression remains effectively photo-only. Do not add heuristic duplicate warnings for videos. Do not redesign storage, finalize, or the broader uploader. Add focused tests proving image behavior is unchanged, video uploads proceed without eager duplicate hashing, videos are not blocked by missing `contentHash`, mixed image/video uploads still work, image duplicate-policy flow remains correct, and videos do not trigger duplicate-policy decisions in the normal path.
