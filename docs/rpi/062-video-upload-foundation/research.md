# Feature 062 Research: Video Upload Foundation

Implementation note, April 22, 2026:

- Feature 062A later changed the live upload behavior for videos.
- Current live behavior no longer uses normal upload-flow duplicate hashing or duplicate-policy gating for videos.
- Photos still use exact duplicate hashing.
- Videos now prepare and upload with `contentHash = null` in the normal upload flow.

## Goal

Research the smallest production-safe next step that allows common video files to enter the existing project asset upload system without creating a second uploader surface.

This cycle is limited to:

- uploading supported video files
- storing them in the existing private asset system
- reusing current create/finalize, signed upload URL, duplicate detection, batching, retry, and continuation patterns where practical
- showing a video placeholder thumbnail/card in the project assets grid

Explicitly out of scope for this cycle:

- in-app video playback
- poster/frame extraction infrastructure
- video transcoding
- video matching/review/linking
- export redesign
- multipart resumable upload redesign

This research treats the live repository code and schema as source of truth. Prior RPI docs were used as context only.

## Inputs Reviewed

### Core docs

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `docs/rpi/README.md`

### Prior upload and asset RPI docs

- `docs/rpi/004-project-assets/research.md`
- `docs/rpi/004-project-assets/plan.md`
- `docs/rpi/005-duplicate-upload-handling/research.md`
- `docs/rpi/005-duplicate-upload-handling/plan.md`
- `docs/rpi/008-asset-thumbnails/research.md`
- `docs/rpi/008-asset-thumbnails/plan.md`
- `docs/rpi/023-bugfix-requesturi/research.md`
- `docs/rpi/023-bugfix-requesturi/plan.md`
- `docs/rpi/024-upload-performance-resumability/research.md`
- `docs/rpi/024-upload-performance-resumability/plan.md`
- `docs/rpi/028-duplicate-upload-detection-regression-after-batched-upload/research.md`
- `docs/rpi/028-duplicate-upload-detection-regression-after-batched-upload/plan.md`
- `docs/rpi/030-continuation-retry-reliability/research.md`
- `docs/rpi/030-continuation-retry-reliability/plan.md`
- `docs/rpi/038-original-image-ingest-and-display-derivatives/research.md`
- `docs/rpi/038-original-image-ingest-and-display-derivatives/plan.md`
- `docs/rpi/043-simple-project-export-zip/research.md`
- `docs/rpi/043-simple-project-export-zip/plan.md`

Repository note:

- `docs/rpi/022-asset-upload-performance/` exists in this repo snapshot, but `research.md` and `plan.md` are not present, so they could not be reviewed.

### Live upload, storage, UI, schema, and tests

- `src/lib/assets/asset-image-policy.ts`
- `src/lib/assets/create-asset.ts`
- `src/lib/assets/finalize-asset.ts`
- `src/lib/assets/prepare-project-asset-batch.ts`
- `src/lib/assets/finalize-project-asset-batch.ts`
- `src/lib/assets/post-finalize-processing.ts`
- `src/lib/assets/asset-image-derivatives.ts`
- `src/lib/assets/asset-image-derivative-worker.ts`
- `src/lib/assets/sign-asset-thumbnails.ts`
- `src/lib/client/idempotency-key.ts`
- `src/lib/client/storage-signed-url.ts`
- `src/lib/uploads/project-upload-duplicate-detection.ts`
- `src/lib/uploads/project-upload-manifest.ts`
- `src/lib/uploads/project-upload-queue.ts`
- `src/lib/uploads/project-upload-types.ts`
- `src/lib/matching/auto-match-trigger-conditions.ts`
- `src/app/api/projects/[projectId]/assets/route.ts`
- `src/app/api/projects/[projectId]/assets/preflight/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`
- `src/app/api/projects/[projectId]/assets/batch/prepare/route.ts`
- `src/app/api/projects/[projectId]/assets/batch/finalize/route.ts`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/components/projects/assets-upload-form.tsx`
- `src/components/projects/assets-list.tsx`
- `src/components/projects/project-asset-preview-lightbox.tsx`
- `src/components/projects/previewable-image.tsx`
- `src/components/projects/consent-asset-matching-panel.tsx`
- `src/app/api/internal/assets/worker/route.ts`
- `src/app/api/internal/assets/repair/route.ts`
- `supabase/migrations/20260305120000_004_assets_schema.sql`
- `supabase/migrations/20260305121000_004_assets_rls.sql`
- `supabase/migrations/20260305122000_004_assets_storage.sql`
- `supabase/migrations/20260305150000_005_assets_content_hash.sql`
- `supabase/migrations/20260306100000_006_headshot_consent_schema.sql`
- `supabase/migrations/20260407133000_038_asset_image_derivative_pipeline.sql`
- `tests/feature-023-request-uri-safety.test.ts`
- `tests/feature-024-upload-performance-resumability.test.ts`
- `tests/feature-038-asset-image-derivatives.test.ts`

## Verified Current Upload/Storage/Finalize Boundary

## 1. Asset creation today

The live project asset create path is:

- single-file route: `POST /api/projects/[projectId]/assets`
- batched route: `POST /api/projects/[projectId]/assets/batch/prepare`
- core helper: `createAssetWithIdempotency(...)` in `src/lib/assets/create-asset.ts`

Verified current behavior:

- auth is required
- tenant is derived server-side with `resolveTenantId(...)`
- project access is checked server-side with `ensureProjectAccess(...)`
- the client never provides `tenant_id`
- the helper creates the `assets` row before upload with `status = 'pending'`
- the helper persists per-file idempotency in `idempotency_keys`
- the helper issues the signed upload URL directly with a service-role storage client

There is no separate upload-authorization helper or separate upload-auth route beyond the create/batch-prepare routes themselves.

### Current create-time validation

Current create validation is image-only:

- `asset-image-policy.ts` only accepts image MIME types/extensions
- `create-asset.ts` calls `isAcceptedImageUpload(...)`
- `create-asset.ts` enforces `MAX_FILE_SIZE_BYTES = 25 * 1024 * 1024`
- `create-asset.ts` only allows `asset_type` of `photo` or `headshot`

This means common video files are blocked in live code in three places:

1. picker `accept` value
2. server-side type validation
3. `asset_type` schema/code modeling

### Current storage path and bucket

Storage is already media-agnostic at the path level:

- bucket: `project-assets`
- path pattern: `tenant/<tenantId>/project/<projectId>/asset/<assetId>/<sanitizedFilename>`

The bucket is private. The storage policy in `20260305122000_004_assets_storage.sql` scopes access only by tenant/project path membership, not by MIME type.

That means the private bucket model and signed upload URL model are reusable for videos without a storage-policy redesign.

## 2. Signed upload URLs today

Signed upload URLs are created by `admin.storage.from(bucket).createSignedUploadUrl(path)` inside `createAssetWithIdempotency(...)`.

Verified implications:

- uploads bypass Next.js after prepare/create
- file bytes go directly from the browser to Supabase Storage with `XMLHttpRequest`
- signed upload URLs are already retried indirectly by rerunning prepare/create with the same idempotency key
- the storage browser helper is only `resolveSignedUploadUrlForBrowser(...)`, which rewrites loopback hostnames for local dev

## 3. Finalize today

Finalize paths are:

- single-file route: `POST /api/projects/[projectId]/assets/[assetId]/finalize`
- batched route: `POST /api/projects/[projectId]/assets/batch/finalize`
- core helper: `finalizeAsset(...)` in `src/lib/assets/finalize-asset.ts`

Verified finalize behavior:

- the asset row is reloaded inside tenant/project scope
- `assets.status` becomes `uploaded`
- `uploaded_at` is set
- consent linking only happens for `headshot` assets
- photo post-finalize work is queued separately by `queueProjectAssetPostFinalizeProcessing(...)`

Current photo post-finalize work:

- queue image derivatives in `asset_image_derivatives`
- enqueue photo matching intake work

This is important for video scope:

- videos must not be finalized as `photo`
- videos must not enter the current image derivative queue
- videos must not enter the current photo matching pipeline

## 4. Batching today

The current project uploader uses one logical client queue with:

- manifest persistence in `localStorage`
- batch prepare route
- direct Storage PUTs
- batch finalize route

Live constants from `project-upload-types.ts`:

- preflight batch size: `250`
- prepare batch size: `50`
- finalize batch size: `50`
- PUT concurrency: `4`
- hash concurrency: `2`

Important live-code correction versus older docs:

- the current uploader hashes all selected files before duplicate policy decisions
- it no longer uses size-prefiltered hashing

That behavior is visible in `assets-upload-form.tsx`, which calls `hashProjectUploadFile(file)` for every newly selected upload item before duplicate resolution.

## 5. Duplicate detection today

Duplicate handling is already content-hash based and server-enforced.

Verified current behavior:

- client computes SHA-256 hashes with `hashProjectUploadFile(...)`
- preflight checks DB `content_hash` matches by tenant/project/asset_type
- batch prepare also checks same-request duplicate hashes
- create helper does authoritative duplicate checks against `assets.content_hash`
- duplicate checks are scoped by `(tenant_id, project_id, asset_type, content_hash)`
- pending rows count as duplicates too because create-time duplicate lookup does not require `status = 'uploaded'`

This is a good fit for video uploads if videos get their own `asset_type` value.

## 6. Retry, continuation, and resumability today

Current retry/recovery behavior is bounded but real:

- each selected file gets a stable `idempotencyKey`
- manifest state is persisted per project in `localStorage`
- after refresh, unfinished items are recovered as `needs_file` or `uploaded`
- a refreshed page cannot keep `File` objects, so the user must reselect unresolved files
- 401/403 moves the queue to `blocked_auth`
- a 4xx Storage PUT failure marks the item `ready_to_prepare`, allowing a fresh signed URL

Current limitations matter for videos:

- uploads are still single-request PUTs, not multipart
- hashing reads the full file with `file.arrayBuffer()`
- there is no byte-range resume
- interrupted uploads restart from the beginning

This makes the current pipeline reusable for moderate video sizes, but not a safe foundation for very large video files.

## Current Schema, Routes, Components, and Helpers Involved

## Schema

Current `assets` columns already useful for video files:

- `id`
- `tenant_id`
- `project_id`
- `storage_bucket`
- `storage_path`
- `original_filename`
- `content_type`
- `file_size_bytes`
- `content_hash`
- `content_hash_algo`
- `status`
- `uploaded_at`

Current schema limitation:

- `asset_type` check only allows `photo` and `headshot`

Current derivative schema is image-specific:

- table: `asset_image_derivatives`
- kinds: `thumbnail`, `preview`
- worker renders with `sharp`
- queue/repair code is photo-oriented

## Routes and server helpers

Project asset upload lifecycle:

- `src/app/api/projects/[projectId]/assets/preflight/route.ts`
- `src/app/api/projects/[projectId]/assets/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`
- `src/app/api/projects/[projectId]/assets/batch/prepare/route.ts`
- `src/app/api/projects/[projectId]/assets/batch/finalize/route.ts`
- `src/lib/assets/create-asset.ts`
- `src/lib/assets/finalize-asset.ts`
- `src/lib/assets/prepare-project-asset-batch.ts`
- `src/lib/assets/finalize-project-asset-batch.ts`

Private bucket and signing:

- signed upload URLs are created in `create-asset.ts`
- signed display URLs are created in `sign-asset-thumbnails.ts`

Post-finalize photo-only processing:

- `src/lib/assets/post-finalize-processing.ts`
- `src/lib/assets/asset-image-derivatives.ts`
- `src/lib/assets/asset-image-derivative-worker.ts`

## Client components and queue helpers

Project asset uploader:

- `src/components/projects/assets-upload-form.tsx`
- `src/lib/uploads/project-upload-manifest.ts`
- `src/lib/uploads/project-upload-queue.ts`
- `src/lib/uploads/project-upload-duplicate-detection.ts`
- `src/lib/uploads/project-upload-types.ts`

Project asset grid and preview:

- `src/components/projects/assets-list.tsx`
- `src/components/projects/project-asset-preview-lightbox.tsx`
- `src/components/projects/previewable-image.tsx`

Project page integration:

- `src/app/(protected)/projects/[projectId]/page.tsx`

## Current Reality Relevant to Video Support

## 1. The storage/auth foundation is already reusable

The current create/signed-upload/finalize/storage path is not image-specific at the bucket or path level.

Reusable without redesign:

- server-side tenant/project auth model
- idempotency pattern
- private `project-assets` bucket
- server-generated storage path
- direct browser-to-storage upload
- finalize step
- manifest persistence and auth-blocked recovery states

## 2. The current asset model is not broad enough yet

The current `assets` table is close to sufficient, but not quite.

Why a new `asset_type = 'video'` value is required:

- current code uses `photo` to trigger image derivatives and matching
- current code uses `headshot` for consent-linked headshots
- if videos were stored as `photo`, they would be eligible for image-only derivative and matching logic
- if videos were stored as `headshot`, they would collide with headshot semantics

So the minimal additive schema change is:

- widen `asset_type` from `('photo','headshot')` to `('photo','headshot','video')`

No immediate metadata columns are strictly required for first-slice upload:

- duration can wait
- codec can wait
- original video dimensions can wait
- poster/thumbnail object metadata can wait

The current asset table already stores the core data needed to upload and retain video files safely.

## 3. Current UI and derivative code is image-only

The current project asset grid assumes image display:

- `assets/route.ts` only queries `asset_type = 'photo'`
- the grid/lightbox render through `PreviewableImage`, which is `<img>`-based
- `sign-asset-thumbnails.ts` resolves image derivatives or image transform/original fallbacks

The current derivative pipeline is explicitly image-only:

- `asset_image_derivatives` only has image preview kinds
- the worker renders with `sharp`
- repair code queues missing image derivatives for photo assets

That means the smallest safe video display behavior is not a real poster pipeline. It is a video-specific placeholder card in the project assets grid.

## 4. Matching and consent-linking are already photo-only

Live code and SQL use `asset_type = 'photo'` broadly in:

- face materialization
- matching progress
- face review
- consent photo linking
- project preview/linking routes

That is useful for Feature 062:

- it gives a clear boundary
- videos can enter the asset system without accidentally becoming matchable photos, as long as they use `asset_type = 'video'`

## 5. The biggest practical risk is large-file behavior, not tenant/security behavior

Current video blockers are practical rather than auth/storage architectural:

- server-side create limit is only 25 MB
- hashing loads the full file into memory
- uploads are one-shot PUTs
- refresh cannot continue a partially uploaded file without reselecting it

So the current pipeline can be reused for videos only if the first slice stays conservative on file size and concurrency.

## Options Considered

## Option A: separate video uploader surface

Pros:

- isolates video-specific behavior

Cons:

- unnecessary product split
- duplicates the current upload/auth/storage model
- conflicts with the requested scope

Assessment:

- not recommended

## Option B: reuse current uploader and add real video poster generation now

Pros:

- nicer grid presentation

Cons:

- current derivative stack is image-only
- real poster generation needs media tooling not present in live code
- introduces poster lifecycle, retries, and failure handling immediately

Assessment:

- too large for this cycle

## Option C: reuse current uploader, store videos as assets, show a video placeholder in the grid

Pros:

- preserves the existing upload experience
- preserves private bucket + signed URL model
- avoids new media-processing infrastructure
- keeps scope bounded to upload/store/list

Cons:

- no real thumbnails yet
- no playback yet

Assessment:

- recommended

## Option D: broader media pipeline redesign

Pros:

- could unify image/video/audio long term

Cons:

- far outside one RPI cycle

Assessment:

- explicitly deferred

## Recommended Video Upload Model

## Recommendation

Feature 062 should ship as:

- common video files upload through the existing project uploader UI
- videos are stored in the same `assets` table and `project-assets` bucket
- videos get `asset_type = 'video'`
- videos reuse the same direct signed upload URL + finalize pattern
- videos reuse the same content-hash duplicate detection model
- videos appear in the project asset grid with a video placeholder thumbnail/card
- videos do not participate in image derivative generation, face materialization, consent-photo linking, or playback

This is closest to Candidate 1 from the prompt, and it is the smallest production-safe step visible in the live codebase.

## Minimal asset-model change

Recommended first-slice model changes:

1. Widen `assets.asset_type` to include `video`.
2. Update TypeScript unions so upload/finalize/helpers can represent `video`.
3. Keep videos in the existing `assets` table with the existing core metadata only.

Not required in this slice:

- `duration_ms`
- `codec`
- `frame_rate`
- `original_width` / `original_height`
- dedicated poster records

Those can remain deferred until playback or richer media management becomes a real requirement.

## Recommended Supported Formats

Keep the first-slice format list narrow:

- `.mp4` / `video/mp4`
- `.mov` / `video/quicktime`
- `.webm` / `video/webm`

Why this set:

- conventional and common for user-facing uploads
- narrow enough to keep support expectations bounded
- no playback commitment is required yet

Not recommended for the first slice:

- AVI
- MKV
- HEVC/HEIF video-specific expansion
- broader legacy/proprietary containers

Open plan-phase detail:

- whether to include `.m4v` as an extension alias if local user files commonly surface that way

## Recommended Batching and Large-File Handling

## Smallest robust answer

Use one user-facing project upload flow, but differentiate internal execution for videos.

Recommended behavior:

- same picker
- same manifest system
- same duplicate policy UI
- same create/signed-upload/finalize API shape
- internally separate photo items and video items by `asset_type`

### Why internal separation is needed

Current batch helpers and routes are photo-hardcoded:

- `assets/batch/prepare` only accepts `assetType = "photo"`
- post-finalize photo work is photo-specific
- the project asset list and preview model are photo-oriented

The smallest safe approach is:

- keep one UI
- keep one logical manifest
- run grouped prepare/finalize calls per asset type

That avoids inventing a second uploader while keeping server-side branching explicit.

### Recommended first-slice video scheduling rules

Recommended conservative video strategy:

- video hash concurrency: `1`
- video PUT concurrency: `1`
- video prepare/finalize batches: smaller grouped calls than photos, for example `10`

Photos can keep their current batching behavior.

This matters because current hashing does full-file `arrayBuffer()` reads and current uploads are whole-file PUTs.

### Mixed selections such as `100 images + 10 videos`

Recommended product behavior:

- one upload selection
- one queue surface
- internally grouped execution

Recommended implementation behavior:

- photos and videos share one manifest and status UI
- client groups items by asset type before preflight/prepare/finalize
- at most one video upload is active at a time
- photo batches do not need to wait for all videos to hash first

This keeps the shared upload experience while avoiding the worst photo-plus-large-video blocking behavior.

## Recommended first-slice video size limit

The live code currently enforces `25 MB` for all uploads, which is too small for common videos.

For Feature 062, the bounded recommendation is:

- keep current image cap unchanged
- add a separate conservative video cap
- recommended first-pass video cap: `250 MB`

Why a conservative cap is needed:

- current duplicate hashing loads the full file into memory
- current upload is not multipart/resumable
- interrupted uploads restart from zero
- current refresh recovery still requires file re-selection

This cap is a product safeguard, not a storage limitation. Larger videos can be revisited in a later upload-resumability/media-processing cycle.

## Recommended Duplicate-Detection Approach

Reuse the current duplicate model.

Current live duplicate model already fits videos if videos get their own asset type:

- SHA-256 `content_hash`
- same-request duplicate grouping in batch prepare
- DB duplicate lookup in create
- scoped by `(tenant_id, project_id, asset_type, content_hash)`
- detects duplicates against pending rows too

Recommended first-slice behavior:

- keep duplicate detection content-hash based
- hash video files client-side too
- compute video hashes more conservatively than photos by using concurrency `1`
- keep duplicate policy semantics unchanged: `upload_anyway`, `overwrite`, `ignore`

This avoids introducing filename-based or video-specific duplicate rules.

## Recommended Project Assets Grid / Thumbnail Behavior

Use a generic video placeholder, not a real poster.

Why:

- current grid/lightbox is image-only
- current derivative pipeline is image-only
- current worker uses `sharp`
- real poster extraction would require new media-processing infrastructure

Recommended grid behavior for videos:

- show a stable video placeholder tile
- show filename and size as current cards already do
- optionally show a small "Video" badge
- do not open the current image lightbox for videos

Recommended API behavior for videos in the asset list:

- include `assetType`
- return `thumbnailUrl = null`
- return `previewUrl = null`
- let the UI render a video-specific placeholder rather than an "image unavailable" state

This is the smallest bounded display model that still makes uploaded videos visible and understandable in the project grid.

## Security and Reliability Considerations

Security should remain unchanged:

- tenant is always derived server-side
- project scope stays server-side
- no client-provided `tenant_id`
- signed upload URLs remain server-generated
- private bucket remains private
- no service role exposure to the client

Reliability concerns to carry into the plan:

- videos must bypass current photo post-finalize derivative and matching enqueue
- videos must not be included in image-only repair paths
- videos must not appear in photo-only matching/review APIs
- retry must continue to use the existing per-file idempotency key behavior
- stale signed URLs should continue to recover through prepare retry
- interrupted video uploads still restart from zero in this cycle

## Edge Cases

- same video selected twice in one batch
  - current same-request hash duplicate handling can be reused

- duplicate video already pending in DB
  - current create-time duplicate lookup already catches pending rows when hashes are present

- mixed photo and video selection
  - one logical queue, differentiated internal grouping

- signed URL expires before upload starts
  - current retry path can re-prepare with the same idempotency key

- upload interrupted after large video starts
  - first slice restarts full upload; no byte-range resume

- page refresh mid-video upload
  - manifest survives, file object does not; re-selection is required

- videos in people-filtered asset views
  - videos have no consent links in this slice and should naturally disappear when a consent filter is applied

- videos in current photo review/matching panels
  - should remain excluded by `asset_type = 'photo'`

- videos accidentally sent into image derivatives
  - must be prevented explicitly by asset type branching

## Explicitly Deferred Work

- video playback in the web app
- poster/frame extraction
- ffmpeg or equivalent media tooling
- duration/codec metadata capture
- video review and consent matching
- video export behavior
- large-file multipart resumability
- richer media filters/sorting beyond basic presence in the grid

## Open Decisions For The Plan Phase

1. Exact first-slice video size cap.
   - Recommended starting point: `250 MB`.

2. Exact accepted video extension/MIME set.
   - Recommended starting point: MP4, MOV, WebM.
   - Open question: include `.m4v` alias or not.

3. Exact queue scheduling shape for mixed uploads.
   - Recommended direction: shared manifest, grouped internal execution, one active video upload at a time.

4. Exact API contract for asset list rows.
   - Whether `assetType` alone is enough for the UI placeholder.
   - Or whether a dedicated `displayKind` / `thumbnailMode` field is cleaner.

5. Exact lightbox behavior for videos.
   - Simplest answer: no lightbox open for videos in Feature 062.

6. Exact policy module shape.
   - Whether to generalize `asset-image-policy.ts` into a broader asset upload policy module.

7. Whether batch prepare/finalize routes should accept `video` directly or stay per-type and be called separately by the client.
   - Recommended smallest change: keep grouped per-type calls from the client rather than mixed-type server batches.

## Research Outcome

The live repo already has the right security and storage foundation for first-slice video uploads.

The actual blockers are narrower:

- image-only upload validation
- `asset_type` limited to `photo|headshot`
- photo-only batch route assumptions
- photo-only derivative/matching post-finalize work
- image-only project asset rendering
- a current upload strategy that is safe for moderate files, but not for very large videos

The smallest coherent next step is:

- add `asset_type = 'video'`
- accept a narrow set of common video formats
- reuse the existing create/signed-upload/finalize/private-bucket/duplicate-idempotency pipeline
- keep one uploader surface
- internally schedule videos more conservatively than photos
- show a video placeholder card in the grid
- explicitly keep videos out of current image derivative, matching, review, and playback paths

That is a bounded, additive, production-oriented Feature 062 starting point and is suitable for a normal plan/implement RPI cycle.
