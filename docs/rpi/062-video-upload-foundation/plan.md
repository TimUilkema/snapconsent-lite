# Feature 062 Plan: Video Upload Foundation

Implementation note, April 22, 2026:

- The duplicate-checking portions of this plan were later superseded by Feature 062A.
- Current live behavior keeps exact duplicate checking for photos only.
- Current live behavior removes normal upload-flow duplicate checking for videos.

## Scope

Deliver the smallest production-safe change that lets common video files upload through the existing project asset uploader and appear in the project assets list.

In scope:

- `asset_type = 'video'`
- narrow first-slice video upload acceptance
- reuse of the current create, signed upload URL, storage, finalize, idempotency, duplicate, and continuation model
- one shared uploader surface for images and videos
- conservative internal scheduling for video items
- project assets grid placeholder treatment for videos

Out of scope:

- playback
- poster or frame extraction
- video transcoding
- matching, review, or consent linking for videos
- multipart resumable upload redesign
- export redesign
- timeline or seek UI
- audio/media redesign

## Inputs And Ground Truth

Inputs re-read for the plan phase, in order:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/062-video-upload-foundation/research.md`

Targeted live boundary re-verified from code, schema, and tests:

- `src/lib/assets/create-asset.ts`
- `src/lib/assets/finalize-asset.ts`
- `src/lib/assets/prepare-project-asset-batch.ts`
- `src/lib/assets/finalize-project-asset-batch.ts`
- `src/app/api/projects/[projectId]/assets/route.ts`
- `src/app/api/projects/[projectId]/assets/preflight/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`
- `src/app/api/projects/[projectId]/assets/batch/prepare/route.ts`
- `src/app/api/projects/[projectId]/assets/batch/finalize/route.ts`
- `src/components/projects/assets-upload-form.tsx`
- `src/lib/uploads/project-upload-manifest.ts`
- `src/lib/uploads/project-upload-queue.ts`
- `src/lib/uploads/project-upload-duplicate-detection.ts`
- `src/lib/uploads/project-upload-types.ts`
- `src/lib/client/idempotency-key.ts`
- `src/lib/client/storage-signed-url.ts`
- `src/lib/assets/post-finalize-processing.ts`
- `src/lib/assets/asset-image-derivatives.ts`
- `src/lib/assets/asset-image-derivative-worker.ts`
- `src/lib/assets/sign-asset-thumbnails.ts`
- `src/lib/matching/auto-match-trigger-conditions.ts`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/components/projects/assets-list.tsx`
- `src/components/projects/project-asset-preview-lightbox.tsx`
- `src/components/projects/previewable-image.tsx`
- `supabase/migrations/20260305120000_004_assets_schema.sql`
- `supabase/migrations/20260305121000_004_assets_rls.sql`
- `supabase/migrations/20260305122000_004_assets_storage.sql`
- `supabase/migrations/20260305150000_005_assets_content_hash.sql`
- `supabase/migrations/20260306100000_006_headshot_consent_schema.sql`
- `supabase/migrations/20260407133000_038_asset_image_derivative_pipeline.sql`
- `tests/feature-023-request-uri-safety.test.ts`
- `tests/feature-024-upload-performance-resumability.test.ts`
- `tests/feature-038-asset-image-derivatives.test.ts`

Verified live facts that bound this plan:

- `create-asset.ts` is image-only today, only allows `asset_type` `photo|headshot`, and enforces a 25 MB max size.
- Batch prepare is currently hardcoded to `assetType: "photo"`.
- Preflight duplicate checks and create-time duplicate checks are scoped by `tenant_id`, `project_id`, `asset_type`, and `content_hash`.
- The client uploader hashes full files with `file.arrayBuffer()` and uploads via one-shot XHR `PUT`.
- The batch finalize path always calls post-finalize processing, which currently assumes `photo|headshot`.
- Post-finalize processing only queues image derivatives and matching for `photo`.
- The asset list route currently filters to `asset_type = 'photo'` and builds photo review/linking state for returned rows.
- Thumbnail signing and preview surfaces are image-only and fall back to image transforms or image derivatives.
- The private bucket and storage path rules are already media-agnostic and do not need redesign.

## Verified Current Planning Boundary

### Current upload and storage boundary

The current project upload flow is:

1. client selection in `assets-upload-form.tsx`
2. duplicate preflight via `/api/projects/[projectId]/assets/preflight`
3. asset row creation plus signed upload URL via `/api/projects/[projectId]/assets/batch/prepare` or `/api/projects/[projectId]/assets`
4. browser direct `PUT` to Supabase Storage
5. finalize via `/api/projects/[projectId]/assets/batch/finalize` or `/api/projects/[projectId]/assets/[assetId]/finalize`

The current private storage model is already reusable:

- bucket: `project-assets`
- path: `tenant/<tenantId>/project/<projectId>/asset/<assetId>/<sanitizedFilename>`
- signed upload URLs are issued server-side
- tenant and project scope are derived server-side

### Current queue and duplicate boundary

The current queue persists per-project manifest state in `localStorage` and recovers unfinished items after refresh. Idempotency is already per file. Duplicate detection is content-hash based and server-enforced, with same-request duplicate suppression in batch prepare.

Current constraints that matter for video:

- full-file hashing in browser memory
- no byte-range resume
- upload restarts from zero after interruption
- current queue constants are photo-oriented:
  - hash concurrency: `2`
  - PUT concurrency: `4`
  - prepare batch size: `50`
  - finalize batch size: `50`

### Current post-finalize and UI boundary

Current derivative and matching flows are explicitly photo-only:

- image derivatives are queued only for `asset_type = 'photo'`
- matching enqueue only happens for `photo`
- headshot-only consent linking is handled separately in finalize

Current project asset display is photo-only in practice:

- assets list route returns photos only
- list and lightbox render through image preview components
- video rows would currently fall into image placeholder or image transform code unless explicitly branched

## Recommendation

Implement Feature 062 as one shared uploader surface with additive video support behind the existing asset pipeline.

Chosen direction:

- widen `assets.asset_type` to include `video`
- accept only `mp4`, `mov`, and `webm` in this slice
- keep the current private bucket and signed upload URL flow unchanged
- keep the current idempotency, duplicate, prepare, upload, and finalize model unchanged at a conceptual level
- use one manifest and one queue UI, but group work internally by `asset_type`
- process video items more conservatively than photo items
- keep videos out of image derivatives, matching, review, linking, and playback
- render videos in the asset grid with a video placeholder and no preview lightbox

This is the smallest coherent production-safe slice that fits the live code.

## Chosen Video Asset Model

### Schema and type changes

Add one migration that widens `assets_asset_type_check` from:

- `photo`
- `headshot`

to:

- `photo`
- `headshot`
- `video`

No new table is needed. No new storage bucket is needed. No new upload session table is needed.

Update TypeScript unions anywhere upload or finalize paths currently use:

- `"photo" | "headshot"`

to:

- `"photo" | "headshot" | "video"`

This applies to create, finalize, batch helpers, preflight normalization, post-finalize branching, and asset list row typing.

### Metadata policy

Do not add new metadata columns in this feature.

Store videos with the existing asset fields only:

- `original_filename`
- `content_type`
- `file_size_bytes`
- `content_hash`
- `content_hash_algo`
- `storage_bucket`
- `storage_path`
- `status`
- `uploaded_at`

Deferred metadata:

- duration
- codec
- frame rate
- width and height
- poster image references

## Accepted Format Policy

### Supported first-slice video formats

Accept exactly these video formats:

- `.mp4` with MIME `video/mp4`
- `.mov` with MIME `video/quicktime`
- `.webm` with MIME `video/webm`

### Validation policy

Replace the image-only upload policy boundary with a shared asset upload policy that can:

- return the combined picker `accept` string for project asset uploads
- validate an upload by `asset_type`, MIME, and extension
- keep headshot and photo validation image-only
- keep video validation narrow

Exact first-slice rules:

- `asset_type = 'photo'` and `asset_type = 'headshot'` continue using current accepted image rules
- `asset_type = 'video'` accepts only the three listed formats
- MIME and extension should both be checked
- an allowed extension may be used when browsers omit MIME, but unknown MIME plus unknown extension is rejected
- `.m4v`, `.avi`, `.mkv`, and other containers remain rejected

### UI and error copy

Any new validation copy must use the existing i18n framework. Add translation keys for:

- unsupported video type
- video size limit exceeded
- mixed upload acceptance messaging
- video placeholder labels

## File-Size And Large-File Policy

### Chosen limits

Keep the current image limit unchanged:

- photo/headshot max size: `25 MB`

Add a conservative video limit:

- video max size: `250 MB`

### Why this cap is safe with the current pipeline

This limit is chosen because the live pipeline still:

- hashes the full file in browser memory
- uploads in a single PUT request
- restarts from zero after interruption
- requires file re-selection after refresh for unresolved items

`250 MB` is large enough for common short-form project videos and still conservative enough for the current hashing and single-request upload design. Larger files should wait for a future resumable or multipart upload cycle.

### Enforcement points

Enforce the size cap in both places:

- client-side selection validation for immediate feedback
- server-side create and batch prepare validation as the source of truth

## Upload Pipeline Integration Plan

### Shared pipeline model

Keep the current logical upload lifecycle unchanged:

1. select files
2. hash files
3. preflight duplicates
4. prepare assets and issue signed upload URLs
5. direct storage PUT
6. finalize uploaded assets

Do not create a second uploader surface.

### Chosen integration shape

Use one shared manifest and one shared UI, but group preflight and prepare work by `asset_type`.

Chosen approach:

- do not redesign server batch contracts to accept mixed asset types in one request
- keep each prepare request single-type
- keep finalize request shape unchanged because it finalizes by `assetId` only
- keep preflight route single-type per call

That means a mixed selection such as `100 images + 10 videos` stays one queue to the user, but internally runs:

- photo preflight batches
- video preflight batches
- photo prepare batches
- video prepare batches
- photo and video finalize batches through the same finalize route

### Server changes

Widen and branch these server paths:

- `create-asset.ts`
  - accept `asset_type = 'video'`
  - validate via shared asset upload policy
  - apply asset-type-specific size caps
- `prepare-project-asset-batch.ts`
  - accept `assetType: "photo" | "video"`
  - reuse same-request duplicate logic unchanged
- `preflight/route.ts`
  - normalize and accept `video`
- `batch/prepare/route.ts`
  - normalize and accept `video`
- `finalize-asset.ts`
  - widen asset type unions and return type
- `batch/finalize/route.ts`
  - keep request shape unchanged
- `assets/route.ts`
  - list both `photo` and `video`
  - keep photo-only enrichment isolated to photo rows

No storage helper redesign is needed.

## Batching And Concurrency Plan

### Shared queue, differentiated scheduling

Add `assetType` to `ProjectUploadItem` and persist it in the manifest. Asset type is determined client-side from the validated file type and then revalidated server-side.

Photos keep current scheduling.

Videos use conservative scheduling:

- hash concurrency: `1`
- PUT concurrency: `1`
- prepare batch size: `10`
- finalize batch size: `10`
- preflight batch size: keep current `250` because requests contain only metadata

### Mixed upload behavior

Mixed uploads stay in one queue surface. Internally:

- photo items can continue using current batching and concurrency
- video items are prepared and uploaded one at a time
- video hashing should not monopolize the whole queue before photos can proceed

Planned execution rule:

- partition runnable items by `assetType`
- prefer progressing any ready photo work first using current concurrency
- allow at most one active video upload at a time
- do not allow more than one video hash operation at a time
- continue to use the same finalize loop, but chunk video asset IDs into smaller finalize batches

This keeps the queue simple while avoiding `100 images + 10 videos` turning into ten concurrent large uploads.

### Why grouped per-type prepare is the smallest safe option

The live server batch prepare route is photo-hardcoded. Widening it to accept a mixed array with per-item types would be a larger contract change than this feature needs. Grouped per-type calls let the client reuse the same queue model without forcing a wider server batch redesign.

## Duplicate-Detection Plan

Reuse the current content-hash duplicate model unchanged.

Chosen behavior:

- compute SHA-256 for video files too
- keep duplicate checks scoped by `tenant_id`, `project_id`, `asset_type`, and `content_hash`
- keep duplicate policy values and UI semantics unchanged:
  - `upload_anyway`
  - `overwrite`
  - `ignore`

### Type-scoping implication

Duplicate scope remains type-specific. That means:

- a video duplicates another video when the hash matches in the same tenant and project
- a video does not duplicate a photo even if bytes somehow match

This matches the existing live behavior and avoids widening duplicate semantics in this feature.

### Reliability note

Same-request duplicate suppression for video batches continues to work because:

- each video prepare request is still single-type
- later video chunks will still see earlier pending video rows in DB by content hash

## Finalize And Post-Finalize Branching Plan

### Finalize behavior

Keep finalize idempotent and bounded:

- set `status = 'uploaded'`
- set `uploaded_at`
- return the resolved `assetType`

Headshot-specific consent-link behavior stays unchanged.

Video-specific finalize behavior:

- finalize the asset row only
- do not create consent links
- do not enqueue image derivatives
- do not enqueue matching

### Post-finalize branching

Widen post-finalize types to include `video`, then branch explicitly:

- `photo`
  - queue image derivatives
  - allow matching enqueue
- `headshot`
  - no project-photo derivative queue
  - no photo matching enqueue
- `video`
  - no derivative queue
  - no matching enqueue

Also widen `shouldEnqueuePhotoUploadedOnFinalize(...)` so it accepts `video` in the type system but returns `true` only for `photo`.

### Derivative and repair safety

Do not send videos into:

- `asset-image-derivatives.ts`
- `asset-image-derivative-worker.ts`
- derivative repair logic
- image transform fallback signing

The derivative pipeline remains photo-only in this feature.

## Project Assets Grid And List Behavior

### API behavior

Widen the assets list route from photo-only to photo-plus-video:

- include uploaded, non-archived `photo`
- include uploaded, non-archived `video`
- continue excluding `headshot`

Then split row shaping:

- photo rows continue through current thumbnail signing, review summary, linked face overlays, linked consent counts, and preview data shaping
- video rows skip all photo-only enrichment

Add `assetType` to returned asset rows so the UI can branch explicitly.

For video rows return:

- `assetType: "video"`
- `thumbnailUrl: null`
- `previewUrl: null`
- `thumbnailState: "unavailable"`
- `previewState: "unavailable"`
- `linkedConsentCount: 0`
- no linked face overlays
- no review-only metadata

### Grid behavior

Render a dedicated video placeholder card instead of routing videos through `PreviewableImage`.

Planned UI behavior:

- show a neutral video placeholder tile
- show filename, size, and added date like photos
- show a localized `Video` badge or equivalent label
- do not show photo review chips for video rows
- do not attach image preview click behavior

### Lightbox behavior

Do not open the current image lightbox for videos in this slice.

Chosen behavior:

- clicking a video card does nothing or uses a non-interactive button state
- no playback modal
- no placeholder lightbox

This is the smallest bounded behavior and avoids pushing video rows into the current image-only preview stack.

## Security And Reliability Considerations

- Continue deriving tenant scope server-side with existing auth and project access checks.
- Do not accept `tenant_id` from the client.
- Keep the current private `project-assets` bucket and signed upload URL flow unchanged.
- Keep idempotency per file item and reuse existing manifest recovery behavior.
- Keep create and finalize retry-safe.
- Revalidate type and size server-side even if the client filters upfront.
- Keep all post-finalize business logic server-side.

Known bounded limitations that remain in Feature 062:

- interrupted video uploads restart from zero
- refresh during unresolved uploads still requires file re-selection
- large video hashing is memory-heavy because it reads the whole file
- signed upload URL expiry is still handled by retrying prepare, not by extending an in-flight upload

These are accepted limitations for the first slice and justify the conservative 250 MB cap.

## Edge Cases

- same video selected twice in one batch
  - same-request hash duplicate handling remains active
- duplicate video already exists as pending or uploaded
  - current DB hash lookup already catches it
- same bytes uploaded once as photo and once as video
  - not treated as duplicates because duplicate scope remains asset-type-specific
- mixed `100 photos + 10 videos`
  - one queue surface, grouped internal execution, one active video upload at a time
- video signed URL expires before upload begins
  - item returns to prepare state and retries with the same idempotency key
- network interruption during video upload
  - upload restarts from zero on retry
- refresh during video upload
  - manifest recovers but original file must be reselected
- videos accidentally entering photo review or matching views
  - prevented by `assetType = "video"` plus explicit photo-only branching
- videos accidentally entering derivative repair
  - prevented by keeping derivative queue and repair photo-only

## Test Plan

Add focused tests to the existing upload and derivative suites plus UI coverage around the asset list.

### Server and helper tests

- migration or schema assertion coverage for `asset_type = 'video'`
- shared upload policy accepts:
  - `video/mp4` with `.mp4`
  - `video/quicktime` with `.mov`
  - `video/webm` with `.webm`
- shared upload policy rejects:
  - unsupported video MIME or extension
  - supported extension with mismatched unsupported MIME
- create helper accepts video with valid type and size
- create helper rejects video above `250 MB`
- batch prepare accepts `assetType = 'video'`
- finalize returns `assetType = 'video'`
- duplicate detection skips or preserves videos according to duplicate policy using video hashes

### Queue and mixed-upload tests

- manifest items persist `assetType`
- mixed photo and video selections are partitioned into per-type preflight and prepare calls
- video queue scheduling uses hash concurrency `1` and PUT concurrency `1`
- mixed queue keeps photo scheduling unchanged while serializing video uploads

### Post-finalize and derivative tests

- `queueProjectAssetPostFinalizeProcessing(...)` does not enqueue derivative rows for video
- `shouldEnqueuePhotoUploadedOnFinalize(...)` remains `false` for video
- finalize batch does not create face-match jobs for video
- derivative signing helpers are not invoked for video list rows

### Assets list and UI tests

- assets list route returns both photo and video rows
- photo rows still include current preview and review data
- video rows return `assetType = 'video'` with no preview URLs
- video cards render placeholder treatment
- video cards do not open the image lightbox
- localized video placeholder labels and validation errors render from translation keys, not hardcoded strings

## Implementation Phases

### Phase 1: schema and policy widening

- add migration widening `assets.asset_type` to include `video`
- introduce shared asset upload policy for photo, headshot, and video
- define exact video MIME, extension, and size rules
- widen core TypeScript asset-type unions

### Phase 2: create, finalize, and batch integration

- update preflight, create, batch prepare, and finalize helpers/routes to accept `video`
- keep signed upload URL, storage path, and idempotency behavior unchanged
- add explicit post-finalize branching so videos skip derivatives and matching

### Phase 3: client queue and batching adjustments

- add `assetType` to upload manifest item types
- widen picker accept value for project assets uploads
- group selected items by type for preflight and prepare
- add conservative video hash, upload, and finalize scheduling
- preserve one shared queue surface and duplicate policy flow

### Phase 4: assets grid and placeholder behavior

- widen project assets list route to include videos
- keep photo enrichment photo-only
- add video placeholder rendering in `assets-list.tsx`
- ensure videos do not open the photo lightbox
- add i18n keys for new labels and errors

### Phase 5: tests and cleanup

- add server, queue, post-finalize, and UI tests
- tighten any asset row typing affected by `assetType`
- verify no photo-only route or helper accidentally widens to video behavior beyond this plan

## Explicitly Deferred Work

- playback
- poster generation or frame extraction
- transcoding
- duration or codec metadata capture
- review and matching for video
- export behavior changes for video
- multipart or resumable upload redesign
- larger video support beyond the conservative cap

## Concise Implementation Prompt

Implement Feature 062 as a bounded additive change to the existing project asset pipeline. Add `asset_type = 'video'` to the assets schema and widen the related TypeScript unions. Replace the image-only upload validation boundary with a shared asset upload policy that keeps current photo and headshot rules unchanged and accepts only `mp4`, `mov`, and `webm` for `video`, with a server-enforced video size cap of `250 MB`. Reuse the existing create, signed upload URL, direct storage PUT, finalize, private bucket, idempotency, duplicate-detection, and manifest recovery model. Keep one uploader surface and one queue UI, but add `assetType` to manifest items and internally group preflight and prepare work by type, using conservative video scheduling of hash concurrency `1`, PUT concurrency `1`, and prepare/finalize batch size `10`, while leaving photo batching unchanged. Widen finalize and post-finalize paths so videos finalize normally but never enter image derivative generation, image transform fallback signing, matching, review, or consent-linking paths. Widen the project assets list route to return uploaded `photo` and `video` rows, keep photo enrichment photo-only, and render video rows in the grid with a localized placeholder card and no lightbox behavior. Add focused tests for accepted and rejected video types, video create and finalize, duplicate handling for videos, mixed image and video queue behavior, explicit exclusion from derivative and matching triggers, and video placeholder rendering in the assets list.
