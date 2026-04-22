# Feature 063A Plan: Video Poster/Thumbnail Generation Performance Investigation

## Inputs and ground truth

Primary synthesized input:

- `docs/rpi/063a-video-poster-thumbnail-performance-investigation/research.md`

Required repo context re-read before planning:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`

Targeted live verification completed only against the current planning boundary:

- `src/lib/assets/create-asset.ts`
- `src/lib/assets/finalize-asset.ts`
- `src/lib/assets/post-finalize-processing.ts`
- `src/lib/assets/prepare-project-asset-batch.ts`
- `src/lib/assets/finalize-project-asset-batch.ts`
- `src/lib/assets/asset-image-derivatives.ts`
- `src/lib/assets/asset-image-derivative-worker.ts`
- `src/lib/assets/asset-image-derivative-repair.ts`
- `src/lib/assets/sign-asset-thumbnails.ts`
- `src/lib/assets/sign-asset-playback.ts`
- `src/app/api/internal/assets/worker/route.ts`
- `src/app/api/internal/assets/repair/route.ts`
- `src/app/api/projects/[projectId]/assets/route.ts`
- `src/components/projects/assets-list.tsx`
- `src/components/projects/project-asset-preview-lightbox.tsx`
- `src/components/projects/project-video-asset-preview-lightbox.tsx`
- `package.json`
- `supabase/migrations/20260407133000_038_asset_image_derivative_pipeline.sql`
- `supabase/migrations/20260421120000_062_video_asset_type.sql`
- `tests/feature-038-asset-image-derivatives.test.ts`
- `tests/feature-062-video-upload-foundation.test.ts`
- `tests/feature-063-video-asset-preview-playback-and-thumbnails.test.ts`

Live code and schema are the source of truth where older docs differ.

## Verified current planning boundary

### Upload/finalize boundary

- Video uploads already reuse the current create, signed upload URL, direct storage PUT, and finalize flow.
- Finalize remains non-fatal and only marks the asset uploaded.
- Post-finalize currently queues derivative rows for both `photo` and `video`.
- Matching enqueue remains photo-only.

This feature does not need:

- create-time changes
- finalize API changes
- upload-policy changes
- bucket or storage-path redesign

### Derivative storage and signing boundary

- Video posters already reuse `asset_image_derivatives`.
- Derivative kinds remain `thumbnail` and `preview`.
- Current specs are:
  - `thumbnail`: JPEG `480x480`, quality `76`
  - `preview`: JPEG `1536x1536`, quality `85`
- Video playback already uses a separate signing helper with a 15-minute TTL.
- Asset list API already returns:
  - `thumbnailUrl`
  - `previewUrl`
  - `playbackUrl`

This feature does not need:

- a new table
- a new bucket
- playback URL redesign
- derivative signing API redesign

### Worker boundary

The current worker is the main optimization target:

- it claims derivative rows individually
- it processes rows individually
- for each video row it downloads the original video, writes temp files, launches ffmpeg, extracts a frame, JPEG-encodes one derivative, uploads it, and completes one row

This is where duplicate expensive work is happening today.

### Repair boundary

- Repair already scans uploaded `photo` and `video` assets.
- Repair already requeues missing or dead derivative rows.
- Repair currently assumes the same two derivative kinds for all derivative-bearing assets.

This feature should keep repair recognizable and compatible with the current row model.

### Current UI/product boundary

Current live behavior:

- grid tile uses `thumbnailUrl`
- video modal uses `poster={previewUrl ?? thumbnailUrl ?? undefined}`
- video playback uses `playbackUrl`
- if poster derivatives are missing, the grid falls back to the existing placeholder

Important planning conclusion:

- the current product already works with two poster derivatives
- the modal already tolerates thumbnail fallback
- there is no need to redesign current user-facing behavior to get the main performance win

### Tooling/runtime boundary

- `ffmpeg-static` is already installed
- worker already supports `ASSET_FFMPEG_PATH` override
- no new media runtime dependency is required

### Schema boundary

- `asset_image_derivatives` already has the row model needed for this change
- uniqueness is already `(tenant_id, project_id, asset_id, derivative_kind)`
- claim/fail RPCs already exist
- no migration is required for the planned optimization

## Recommendation

Implement the smallest safe optimization slice as:

- preserve the current two-derivative model for videos
- preserve current grid and modal behavior
- keep the current private bucket model and current asset create/finalize flow unchanged
- keep the current derivative table and repair model unchanged
- refactor the derivative worker so video rows are processed once per asset per worker pass, not once per derivative kind
- add a small worker batch-size guardrail to reduce lease-expiry risk on video-heavy queues

This is the best bounded next step because it removes the clearest duplicate work without introducing a product change or a queue redesign.

## Chosen optimization strategy

Chosen strategy:

- keep both `thumbnail` and `preview` derivatives
- dedupe source work inside the existing worker

Explicitly not chosen in this slice:

- one-poster-only product simplification
- worker concurrency increase
- queue redesign
- cross-worker asset claiming redesign

Why this is the right choice:

- it preserves current UX
- it preserves current API response shape
- it preserves current repair assumptions
- it delivers the biggest safe internal performance win

## Exact worker execution model

### High-level model

Refactor the worker into two paths:

- `photo` claimed rows: keep the current per-row behavior
- `video` claimed rows: process per asset group inside the claimed batch

### Claimed-row grouping

After the worker claims rows:

1. Load source asset rows for the claimed derivative rows.
2. Partition claimed rows by source asset type.
3. Keep photo rows on the existing per-row path.
4. Group video rows by:
   - `tenant_id`
   - `project_id`
   - `asset_id`

Each video asset group becomes one shared execution unit for that worker pass.

### Shared video execution per asset group

For one video asset group:

1. Re-load the current derivative rows for that asset to understand current sibling state.
2. Determine which claimed rows still need generation in this pass.
3. Download the original video once.
4. Create one temp directory once.
5. Write the source video file once.
6. Resolve ffmpeg once for the group.
7. Extract the representative frame once using the existing timestamp rule:
   - first `1.0s`
   - then fallback `0.0s`
8. Keep the extracted frame in memory.
9. For each claimed derivative kind that still needs work:
   - run the existing image resize/encode pipeline against the shared frame buffer
   - upload the derivative to its deterministic storage path
   - complete that specific derivative row
10. Clean up temp files once in `finally`

### Reuse scope achieved by this model

When both poster kinds are claimed together for the same asset, the worker will reuse:

- source asset metadata load
- original video download
- temp directory creation
- source video temp file write
- ffmpeg startup
- timestamp seek/decode
- extracted frame buffer

The only per-kind work left will be:

- JPEG resize/encode
- derivative upload
- derivative-row completion

### Single-row fallback inside the same model

If only one poster row for an asset is claimed in the current worker pass:

- the same per-asset helper still runs
- it performs one download, one temp-file write, and one frame extraction
- it renders only the claimed derivative kind

This keeps behavior correct without requiring cross-worker coordination changes.

## Exact row-coordination strategy

### Core principle

Coordinate only among sibling rows claimed by the same worker pass.

Do not redesign claim semantics so one worker claims entire video assets. That is a broader queue change and is out of scope.

### Sibling-state handling

Before shared generation for a video asset group, inspect current derivative row state for:

- `thumbnail`
- `preview`

Then apply these rules.

### Case 1: one sibling already `ready`

Behavior:

- do not regenerate or rewrite the ready sibling
- only generate the claimed sibling rows that are still missing work

Reason:

- avoids unnecessary writes
- keeps retries idempotent

### Case 2: both siblings claimed in the same worker batch

Behavior:

- perform the shared source pipeline once
- render and upload both claimed derivative kinds from the same extracted frame
- complete each claimed row individually

This is the main optimized path.

### Case 3: one sibling claimed elsewhere

Behavior:

- do not try to adopt, lock, or complete the sibling claimed by another worker
- process only the rows claimed in the current worker pass

Reason:

- avoids queue-system redesign
- avoids racing on rows the current worker does not own

Tradeoff:

- duplicate work can still happen across workers in edge cases
- that risk is reduced operationally by smaller worker batch size, not eliminated architecturally in this slice

### Case 4: shared pre-output failure

Examples:

- asset lookup fails
- download fails
- temp file setup fails
- ffmpeg unavailable
- frame extraction fails

Behavior:

- fail every claimed sibling row in the current asset group with the same failure classification
- preserve current retryable vs non-retryable behavior

Recommended classifications:

- download failure -> retryable
- temp-file failure -> retryable
- upload failure -> retryable
- ffmpeg unavailable -> non-retryable in current code, preserve that
- corrupt/unsupported video extraction failure -> non-retryable

### Case 5: partial per-kind failure after frame extraction succeeds

Examples:

- thumbnail JPEG encode succeeds, preview upload fails
- preview succeeds, thumbnail fails

Behavior:

- complete successful claimed rows
- fail unsuccessful claimed rows individually
- leave the asset usable
- let repair requeue missing/dead rows later

This intentionally allows temporary partial poster availability because the UI already tolerates it.

### Idempotency posture

Idempotency remains grounded in existing behavior:

- deterministic storage paths
- derivative storage upload uses `upsert: true`
- complete only updates rows still in `processing`
- fail only transitions rows still in `processing`
- repair remains responsible for dead/missing recovery

## Queue/lease/batch safety decision

### Chosen decision

- keep worker concurrency default at `1`
- keep lease model unchanged
- reduce the default internal worker batch size from `25` to `10`

### Why reduce batch size

Current risk:

- rows are leased before work starts
- video rows are expensive
- one asset currently produces two rows
- even after source-work dedupe, video-heavy batches can still be slow enough that large claimed sets create lease-expiry risk

Reducing default batch size is a small operational guardrail that:

- lowers the chance of rows sitting leased-but-unprocessed for too long
- lowers the chance of overlapping scheduler runs reclaiming expired rows
- does not redesign claim semantics

### What stays unchanged

- claim RPC stays row-based
- lease duration stays `900` seconds
- worker route shape stays the same
- scheduler can still override `batchSize` explicitly when needed

### Explicit non-goal

This slice will not add:

- lease heartbeats
- asset-level claim RPCs
- queue partitioning
- higher default worker concurrency

## Product-behavior decision

Preserve current product behavior.

Explicit decision:

- keep both `thumbnail` and `preview` derivatives
- keep grid poster behavior unchanged
- keep modal poster behavior unchanged
- keep current `previewUrl ?? thumbnailUrl` modal fallback unchanged

This plan does not intentionally simplify to one poster output.

## Derivative size/quality decision

Keep current video poster sizes and JPEG quality unchanged in this slice:

- `thumbnail`: `480x480`, quality `76`
- `preview`: `1536x1536`, quality `85`

Reason:

- the primary performance gain comes from eliminating duplicate source work
- size/quality tuning is a secondary lever
- keeping current output characteristics reduces product drift and test churn

Follow-up rule:

- only revisit these values in a later bounded pass if timing or bandwidth observations still justify it after dedupe lands

## Instrumentation decision

Core decision:

- do not add persistent telemetry, schema fields, or API changes for timing

Optional bounded addition:

- if implementation friction is low, add minimal opt-in worker timing logs behind a dedicated env flag

If that optional logging is added, it must remain:

- server-side only
- off by default
- non-persistent
- scoped to the video shared execution path

Recommended logged phases only:

- source download
- frame extraction
- per-kind JPEG encode
- per-kind upload
- total per-asset video poster duration

If this logging does not fit cleanly, defer it. The optimization does not depend on it.

## Repair behavior

Preserve the current repair model.

### What stays the same

- repair still scans uploaded non-archived `photo` and `video` assets
- repair still detects missing, stale-version, and dead derivative rows
- repair still requeues missing/dead rows through the existing queue helper
- poster generation remains non-fatal to asset availability

### How repair interacts with the new worker

- if repair requeues both video poster rows, the shared per-asset worker path will dedupe source work
- if repair requeues only one missing/dead sibling row, the worker will process that single claimed row correctly
- no repair schema or API changes are needed

### Failure posture

- corrupt or unsupported video stays dead-lettered per current policy
- retryable failures remain retryable
- repair remains the recovery path for missing/dead video poster rows

## Security and reliability considerations

- Tenant and project scoping remain server-derived and unchanged.
- The client still must not provide `tenant_id`, storage bucket names, storage paths, or derivative metadata.
- Playback signing remains server-side and unchanged.
- The private `project-assets` and `asset-image-derivatives` buckets remain unchanged.
- Poster generation remains non-fatal. An uploaded video must remain listable and previewable even if poster work fails.
- Worker coordination must avoid mutating rows that the current worker did not claim.
- Partial sibling success is acceptable and must remain recoverable by repair.
- Deterministic derivative paths and `upsert` uploads must remain intact for retry safety.
- Photo derivative behavior must remain unchanged.

## Edge cases

- both video sibling rows claimed together and both missing
- only one video sibling row claimed in the current pass
- one sibling already ready, the other missing or dead
- one sibling claimed elsewhere by another worker
- shared source download failure
- ffmpeg missing or misconfigured
- corrupt or unsupported video
- one derivative upload fails after the extracted frame is already available
- modal poster absent but thumbnail present
- long-running video-heavy batches approaching lease expiry
- repair requeue of only one sibling row
- unchanged photo rows mixed into the same worker batch

## Test plan

### Existing test files to update

`tests/feature-038-asset-image-derivatives.test.ts`

Add focused coverage for the new shared video path:

- when both video poster rows are claimed in the same worker run, source download happens once for the asset
- when both rows are claimed together, frame extraction happens once for the asset
- both poster outputs are still generated correctly
- one ready sibling plus one missing/dead sibling only regenerates the missing/dead kind
- partial sibling failure leaves one row ready and one row retried/dead as appropriate
- repair continues to recover missing/dead video poster rows
- photo derivative behavior remains unchanged

Recommended structure:

- keep current real ffmpeg integration tests for end-to-end correctness
- add one focused unit-style test seam around the shared video group helper using injected or stubbed operations so invocation counts can be asserted without relying on real media timing

### Keep existing feature boundaries covered

`tests/feature-062-video-upload-foundation.test.ts`

- keep current upload/finalize/video previewability expectations unchanged
- no product behavior change expected here

`tests/feature-063-video-asset-preview-playback-and-thumbnails.test.ts`

- keep current grid and modal behavior expectations unchanged
- ensure video preview still uses playback URL and poster fallback semantics unchanged

### Minimum behavior matrix

- duplicate video source work reduced when sibling rows are processed in one claimed group
- two poster outputs still correct
- one claimed sibling row still processes correctly
- one ready sibling is not unnecessarily regenerated
- partial sibling success/failure remains safe
- repair requeue remains compatible
- invalid video still dead-letters without affecting asset upload state
- unchanged photo derivative worker behavior
- unchanged grid and modal video UX

## Implementation phases

### Phase 1: worker coordination refactor

- factor the worker into explicit photo-row and video-asset-group paths
- add a shared video poster generation helper that:
  - loads sibling state
  - downloads source once
  - writes temp source once
  - extracts frame once
  - renders one or two derivative kinds from the shared frame
  - completes or fails claimed rows individually
- keep photo per-row logic unchanged

Exit criteria:

- video sibling rows claimed together reuse source work inside one worker pass
- single claimed video sibling row still works
- photo behavior is unchanged

### Phase 2: repair compatibility and partial-state handling

- confirm repair semantics remain unchanged
- add any small worker guards needed for:
  - already-ready sibling rows
  - missing/dead sibling rows
  - partial success/failure handling

Exit criteria:

- repair still requeues missing/dead video poster rows correctly
- partial sibling states remain safe and recoverable

### Phase 3: batch-size guardrail

- lower internal worker route default batch size from `25` to `10`
- update operational docs/examples if they reference the old default

Exit criteria:

- smaller default claim size reduces lease-risk surface without changing API shape

### Phase 4: optional instrumentation

- only if it fits cleanly, add opt-in timing logs for the shared video execution path
- no schema changes
- no API changes

Exit criteria:

- timing visibility exists only if implemented cleanly and behind an opt-in flag

### Phase 5: tests and cleanup

- add new worker coordination tests
- keep existing integration tests passing
- verify no regression in photo derivative behavior or current video UX

Exit criteria:

- tests cover the shared video path and current UX remains unchanged

## Explicitly deferred work

- one-poster-only product simplification
- adaptive streaming
- transcoding
- HLS or DASH
- queue redesign or asset-level claiming
- lease heartbeat or lock-renewal mechanism
- playback token redesign
- poster size/quality tuning beyond the current values
- codec normalization
- broader media-platform redesign

## Concise implementation prompt

Implement Feature 063A as a bounded internal optimization of the existing video poster pipeline. Keep the current `asset_image_derivatives` model, current private bucket model, current upload/finalize flow, and current grid/modal behavior unchanged. Preserve both video poster derivatives, `thumbnail` and `preview`, and keep current sizes and JPEG quality. Refactor the derivative worker so claimed video poster rows are processed once per asset within a worker pass: load sibling row state, download the source video once, create one temp source file, extract the poster frame once using the existing `1.0s` then `0.0s` rule, and render one or both JPEG outputs from that shared frame while completing or failing each claimed row individually. Do not redesign claim semantics or playback signing. Keep photo processing unchanged. Preserve current repair behavior and non-fatal poster failure semantics. Add handling for already-ready siblings, one-row claimed groups, and partial sibling success/failure. Reduce the internal worker route default `batchSize` from `25` to `10` as a small lease-safety guardrail. Add focused tests proving duplicate source work is removed for same-asset video sibling rows, partial sibling states remain safe, repair still works for missing/dead video posters, photo derivatives remain unchanged, and current video grid/playback UX stays unchanged.
