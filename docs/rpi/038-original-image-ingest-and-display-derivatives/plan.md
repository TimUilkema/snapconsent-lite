# 038 Original Image Ingest + Display Derivatives - Plan

## Goal
Implement a shared image-ingest pipeline that lets both project photo upload entry points accept the same classes of files, preserves the original upload, and reliably renders assets in the web app through normalized display derivatives.

This plan follows the recommended approach from `research.md`:

- keep original uploads untouched
- generate display-safe derivatives
- stop depending on transforming the original asset object at display time

## Scope for this implementation

### In scope
- unify supported upload policy across:
  - project assets upload
  - consent matching panel "Upload new photos"
- preserve original uploaded files exactly as received
- generate at least two web-display derivatives per uploaded image:
  - thumbnail
  - preview
- serve project photo thumbnails/previews from derivatives instead of original transforms
- add a safe fallback when derivatives are not ready or generation failed
- support the current failure class: large Pixel Ultra HDR JPEGs that upload but do not render via Supabase transforms

### Explicit first-pass support target
Server-accepted originals:
- JPEG
- PNG
- WebP
- AVIF
- GIF
- BMP
- TIFF

This pass should also handle metadata-heavy JPEG variants such as Pixel Ultra HDR JPEGs because they remain JPEG inputs and should be normalized server-side into display derivatives.

### Out of scope for this pass
- HEIC / HEIF unless runtime decoding is verified during implementation
- RAW / PSD / proprietary formats
- video or document support
- replacing or deleting original files after upload

## High-level design

### 1. Shared ingest policy
Create a shared image-ingest policy module used by both client upload UIs and server validation.

Responsibilities:
- define accepted original MIME types and file extensions
- define client-side `accept` specifiers
- expose one canonical server allowlist
- keep server validation authoritative

This removes the current duplication between:
- `src/components/projects/assets-upload-form.tsx`
- `src/components/projects/consent-asset-matching-panel.tsx`
- `src/lib/assets/create-asset.ts`

### 2. Original-plus-derivatives asset model
Keep the original asset object where it is today:
- `tenant/<tenantId>/project/<projectId>/asset/<assetId>/<originalFileName>`

Add derivative records for variants such as:
- `thumbnail`
- `preview`

Recommended storage path pattern:
- `tenant/<tenantId>/project/<projectId>/asset/<assetId>/derived/<variant>.<ext>`

Recommended output formats:
- thumbnail: JPEG or WebP
- preview: JPEG or WebP

Use one consistent output family for web display so previews behave predictably regardless of original source format.

### 3. Derivative generation
Generate derivatives server-side from the original uploaded object using `sharp`, not Supabase transform-on-read.

Normalization requirements:
- auto-orient using EXIF
- flatten/convert unsupported display details where needed
- normalize color space to sRGB
- strip or minimize metadata for derivative output
- resize to bounded dimensions for thumbnail and preview variants

### 4. Derivative delivery
UI/API responses should prefer signed URLs for derivative objects.

The existing thumbnail-signing helper should be refactored so:
- it first resolves ready derivatives
- it signs derivative object URLs without transform
- it only falls back when a derivative is missing or failed

### 5. Fallback behavior
If a derivative is unavailable:
- prefer a signed original URL for the preview modal if the browser can likely render it
- keep placeholder/fallback UI for thumbnails if no derivative is ready yet

This avoids total blank states during migration or transient generation failures.

## Data model changes

## Recommended schema
Add a new tenant-scoped derivative table rather than overloading `assets` with many variant-specific columns.

Proposed table: `asset_image_derivatives`

Columns:
- `id uuid primary key`
- `tenant_id uuid not null`
- `project_id uuid not null`
- `asset_id uuid not null`
- `variant text not null`
- `storage_bucket text not null`
- `storage_path text not null`
- `content_type text not null`
- `file_size_bytes bigint`
- `width integer`
- `height integer`
- `status text not null`
- `failure_code text null`
- `failure_message text null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `generated_at timestamptz null`
- `failed_at timestamptz null`

Constraints:
- foreign key `(asset_id, tenant_id, project_id)` -> `assets`
- unique `(tenant_id, project_id, asset_id, variant)`
- `status` check like `('pending','ready','failed')`

Indexes:
- `(tenant_id, project_id, asset_id)`
- `(tenant_id, project_id, status)`

### Why a separate table
- future-safe for more variants
- keeps original asset metadata clean
- enables retries and observability per derivative
- avoids repeatedly adding columns to `assets`

## Job / processing strategy

### Recommendation
Generate derivatives asynchronously after finalize, using a dedicated asset-processing job path.

Reason:
- finalization should remain fast and retry-safe
- large batches should not block on image processing
- derivative generation can fail/retry independently of upload success
- this matches the repo's existing preference for queued post-upload work

### Recommended approach
Introduce a small dedicated asset-processing queue for derivative generation rather than reusing `face_match_jobs`.

Suggested first job type:
- `generate_asset_derivatives`

The queue design should mirror existing retry-safe job conventions:
- dedupe by `(assetId, derivativeVersion)`
- lease-based worker processing
- bounded retries
- repair/requeue support later if needed

### Alternative considered and rejected
Generating derivatives inline inside `finalizeAsset()` was rejected because:
- it increases request latency
- it makes uploads more timeout-prone
- it couples upload correctness to image processing
- it scales poorly for the bulk uploader and future DAM usage

## API and server changes

### 1. Shared policy module
Add a module under `src/lib/assets/` for accepted image input policy.

Use it from:
- `create-asset.ts`
- `assets-upload-form.tsx`
- `consent-asset-matching-panel.tsx`
- any headshot upload controls if they should share the same policy later

### 2. Asset finalization
Update finalize flows so that after original upload is marked `uploaded`:
- derivative generation job is enqueued
- existing photo matching enqueue behavior remains intact

Uploads must still succeed if derivative enqueue fails.
The system should rely on repair/reconcile mechanisms for missed jobs, similar to photo matching.

### 3. Derivative signing helper
Refactor `src/lib/assets/sign-asset-thumbnails.ts` into a more general helper that:
- loads derivative rows for requested assets
- signs derivative object URLs
- supports selecting variant by requested size/use
- falls back to original signed URL when appropriate

The old transform-based helper behavior should be removed from the default path for project photos.

### 4. Asset list and matchable photo APIs
Update these APIs to source their URLs from derivatives:
- `src/app/api/projects/[projectId]/assets/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/matchable/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/links/route.ts`
- any other current asset preview response path

Expected response behavior:
- `thumbnailUrl` points to the thumbnail derivative when ready
- `previewUrl` points to the preview derivative when ready
- if not ready, preview can fall back to the signed original URL
- include enough information for the UI to show a "processing preview" state if needed

### 5. Optional migration shim
During rollout, older uploaded assets will not have derivatives yet.

The implementation should therefore include a temporary fallback path:
- if derivative rows do not exist, sign the original as preview fallback
- optionally continue to use the old transform path only for already-safe originals, but the preferred fallback is the original signed object, not another transform

This avoids a forced backfill before the feature can ship.

## UI changes

### 1. Upload buttons
Both upload entry points should use the same accept specifier from shared policy.

Expected UX result:
- the project assets uploader and the consent matching uploader accept the same file families
- there is one product definition of "supported image upload"

### 2. Asset rendering states
Preview surfaces should distinguish:
- derivative ready
- derivative processing
- derivative failed with original preview fallback
- original unavailable/unrenderable

Minimal first-pass UI:
- keep existing layout
- show current image if derivative or fallback exists
- show placeholder plus subtle "Preview processing" text if derivative is not ready yet and no safe fallback exists

### 3. No visible behavior regression for normal files
For common JPEG/PNG/WebP uploads, the user should still see thumbnails/previews appear quickly after finalize.

## Storage design details

### Bucket usage
Keep using the existing private `project-assets` bucket.

Reasons:
- existing RLS-style object policies already enforce tenant/project path scoping
- derivative objects are still tenant/project asset-scoped data
- avoids introducing a second storage domain without clear benefit

### Storage object writes
Derivative object paths must be generated server-side only.
Clients must never submit derivative storage paths.

### Cleanup / overwrite behavior
For this pass:
- derivative generation should overwrite the same variant path for the same asset
- archived assets can keep derivative objects unless a later cleanup policy is added

That keeps retries idempotent and avoids path sprawl.

## Security considerations

- continue deriving tenant/project on the server only
- do not accept derivative metadata or paths from the client
- keep the bucket private
- sign derivative URLs server-side only
- enforce tenant/project scoping on derivative table reads and writes
- if a new job queue table is added, keep it tenant-scoped and service-owned
- preserve original files for audit/export; do not mutate originals during derivative generation

## Edge cases and failure handling

### Retries
- upload create/finalize remains idempotent as it is today
- derivative generation should upsert the same `(asset_id, variant)` row
- derivative storage path should be deterministic so retries replace, not duplicate

### Partial failures
- original uploaded + derivative pending: asset is still valid
- original uploaded + derivative failed: asset remains valid, UI falls back where possible
- derivative enqueue failed: upload still succeeds; repair or reconciliation should recover later

### Races
- duplicate finalize or repair requests must not create duplicate derivative rows
- concurrent worker attempts must lease one job at a time

### Expired sessions/tokens
- upload completion should not depend on the client waiting for derivative generation
- preview reads should continue using short-lived signed URLs as today

### Large or unusual images
- if original is too large or too unusual for derivative generation, mark derivative failed with a structured failure code
- do not archive or corrupt the original

### Matching interaction
- photo matching should continue using its own normalized pipeline
- derivative generation should be independent from face materialization so one does not block the other

## Testing plan

### Unit tests
- shared ingest policy:
  - accepted MIME types/extensions
  - shared accept specifier generation
- derivative path generation:
  - deterministic paths
  - variant uniqueness
- derivative selection helper:
  - ready derivative preferred
  - fallback original returned when derivative missing

### Integration tests
- finalize flow enqueues derivative generation for photo assets
- derivative generation writes derivative rows idempotently
- asset list API returns derivative URLs when ready
- asset list API falls back appropriately when derivative is pending or failed

### Regression coverage
- a regression for the current broken class:
  - an uploaded JPEG that would fail on Supabase transform path but succeeds through server-generated derivative output
- a migration case:
  - asset with no derivative rows still renders via fallback path

### Verification commands
During implementation:
- focused test files for asset upload/render paths
- `npm run lint`
- `supabase db reset`

If a new queue table or worker path is added, add at least one end-to-end test covering:
- upload
- finalize
- derivative job execution
- asset preview URL resolution

## Step-by-step implementation plan

1. Add a shared image-ingest policy module and switch both upload UIs plus `create-asset.ts` to it.
2. Add a migration for `asset_image_derivatives` and any required indexes/RLS.
3. Add derivative path/version helpers under `src/lib/assets/`.
4. Add server-side derivative generation logic using `sharp`.
5. Add a dedicated derivative-generation job path and enqueue it after photo finalize.
6. Add read helpers that resolve derivative URLs first and original fallback second.
7. Update asset-list, matchable-photo, linked-photo, and review-response APIs to use derivative-backed URLs.
8. Add minimal UI states for derivative pending/fallback behavior.
9. Add regression tests for the current broken large-JPEG class and for older assets without derivatives.
10. Run lint, focused tests, and `supabase db reset`.

## Recommended sequencing

To keep this reviewable, implement in three small slices:

### Slice 1
- shared upload policy
- derivative schema
- derivative generation helper

### Slice 2
- derivative job enqueue + worker
- derivative URL read helper
- API migration to derivative URLs

### Slice 3
- fallback UX polish
- regression tests
- optional backfill/repair helper for existing assets

## Open implementation decision to confirm during coding

The main implementation choice to verify at coding time is output format:
- JPEG output is the safest universal preview format
- WebP output may be smaller, but JPEG is the lower-risk first default

Recommended default for this feature:
- thumbnail derivative: JPEG
- preview derivative: JPEG

That keeps the first implementation simpler and browser-safe. A later optimization can switch or dual-emit WebP when useful.
