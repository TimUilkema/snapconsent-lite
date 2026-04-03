# 024 Upload Performance + Resumability - Plan

## Goal
Implement a bounded v1 that makes large project photo uploads materially faster and meaningfully recoverable after interruption, while preserving:
- tenant scoping
- idempotency
- correctness
- private bucket security
- current domain invariants

This plan is based on the current repository code as the source of truth.

## Verified Current State

Verified against current code:
- `src/components/projects/assets-upload-form.tsx` is the main large-batch path.
- The current flow is `preflight -> create -> storage PUT -> finalize`.
- `create` and `finalize` happen once per file.
- The current project bulk uploader is fully sequential.
- Bulk upload state exists only in React component state.
- Refresh/navigation loses generated idempotency keys, returned `assetId`s, and progress state.
- Direct browser-to-Supabase-Storage upload with signed upload URLs is already the correct architectural foundation.
- `createAssetWithIdempotency()` already supports reusing the same idempotency key to return the same asset plus a fresh signed upload URL.
- `finalizeAsset()` is already retry-safe enough for a batch wrapper because repeated finalize calls only reassert the uploaded state and link upserts remain idempotent.
- Photo finalize still enqueues matching via `enqueuePhotoUploadedJob()` with dedupe protection.

## Scope Decisions

### In scope for 024
- Project bulk photo upload path in `src/components/projects/assets-upload-form.tsx`
- New project-scoped batch prepare route
- New project-scoped batch finalize route
- Client-side manifest persistence and recovery for project bulk upload
- Bounded parallel queue for create/upload/finalize work
- Safe handling of `401`, `403`, network failure, refresh, and stale signed URLs
- Duplicate UX optimization using size-prefiltered hashing

### Explicitly deferred
- Rewriting `src/components/projects/consent-asset-matching-panel.tsx`
- Rewriting `src/components/projects/headshot-replacement-form.tsx`
- Rewriting `src/components/public/public-consent-form.tsx`
- Multipart uploads
- Byte-range resume
- Service worker/background upload
- File System Access API dependency
- Storing raw image blobs in IndexedDB
- Large pending-asset cleanup platform redesign

### Bounded decisions for 024
- Keep direct browser-to-storage uploads.
- Introduce batch prepare and batch finalize for the project bulk uploader only.
- Do not add a separate signed-URL reissue route in 024.
- Reuse batch prepare with stable per-file idempotency keys to reissue signed URLs for existing pending assets.
- Keep server-side duplicate enforcement authoritative.
- Keep preflight, but use it as a size-first duplicate UX stage instead of hashing every selected file.
- Use a persisted client manifest plus user re-selection for realistic recovery.
- Implement pause/resume as queue-level scheduling control, not true mid-file byte-range pause.

## No Migration

No migration is required for 024.

Why the current schema is sufficient:
- `assets` already stores `status`, `uploaded_at`, storage metadata, `asset_type`, and `content_hash`.
- `idempotency_keys` already supports server-side request replay for asset creation.
- `asset_consent_links` and current finalize semantics already support retry-safe linking.
- Storage path generation and private bucket policies already enforce the right security model.

Operational gap intentionally deferred:
- orphaned `pending` assets from abandoned batches are not redesigned in 024.
- recovery will reuse those rows via idempotent batch prepare rather than introducing new cleanup schema.

## Server Design

### 1. New batch prepare route
Add:
- `src/app/api/projects/[projectId]/assets/batch/prepare/route.ts`

Purpose:
- prepare many project photo uploads per authenticated request
- validate project access once per batch
- create or reuse pending asset rows
- return signed upload URLs in bulk

Request shape:

```json
{
  "assetType": "photo",
  "duplicatePolicy": "upload_anyway",
  "items": [
    {
      "clientItemId": "local-manifest-item-id",
      "idempotencyKey": "stable-per-file-key",
      "originalFilename": "IMG_0001.jpg",
      "contentType": "image/jpeg",
      "fileSizeBytes": 1234567,
      "contentHash": "optional-sha256-hex",
      "contentHashAlgo": "sha256"
    }
  ]
}
```

Rules:
- `assetType` is fixed to `photo` for the 024 bulk uploader.
- server derives tenant from auth/session and `resolveTenantId()`.
- server validates project ownership once before processing items.
- request is capped to `50` items.
- response is `200` with per-item results for mixed success.
- malformed body or oversized request returns `400`.

Response shape:

```json
{
  "items": [
    {
      "clientItemId": "local-manifest-item-id",
      "status": "ready",
      "assetId": "uuid",
      "storageBucket": "project-assets",
      "storagePath": "tenant/.../asset/.../file.jpg",
      "signedUrl": "signed-upload-url"
    },
    {
      "clientItemId": "local-manifest-item-id-2",
      "status": "skipped_duplicate",
      "duplicate": true
    },
    {
      "clientItemId": "local-manifest-item-id-3",
      "status": "error",
      "code": "invalid_content_type",
      "message": "Unsupported file type."
    }
  ]
}
```

Implementation approach:
- add an internal batch helper, for example `src/lib/assets/prepare-project-asset-batch.ts`
- route handles auth and scope once
- helper iterates items and calls a refactored lower-level asset-create helper
- refactor `createAssetWithIdempotency()` so its single-item validation logic can be reused without repeating project access per item
- keep per-item validation and duplicate behavior identical to current create semantics

### 2. New batch finalize route
Add:
- `src/app/api/projects/[projectId]/assets/batch/finalize/route.ts`

Purpose:
- finalize many uploaded project photos per authenticated request
- preserve current finalize semantics per asset
- enqueue matching jobs exactly as today, with existing dedupe keys

Request shape:

```json
{
  "items": [
    {
      "clientItemId": "local-manifest-item-id",
      "assetId": "uuid"
    }
  ]
}
```

Rules:
- request is capped to `50` items.
- route derives tenant/project server-side.
- batch finalizer validates each asset belongs to the project and tenant.
- route returns `200` with per-item results for mixed success.

Response shape:

```json
{
  "items": [
    {
      "clientItemId": "local-manifest-item-id",
      "status": "finalized",
      "assetId": "uuid"
    },
    {
      "clientItemId": "local-manifest-item-id-2",
      "status": "error",
      "code": "asset_not_found",
      "message": "Asset not found."
    }
  ]
}
```

Implementation approach:
- add an internal batch helper, for example `src/lib/assets/finalize-project-asset-batch.ts`
- batch helper calls `finalizeAsset()` per asset
- if finalized asset type is `photo`, preserve current best-effort `enqueuePhotoUploadedJob()` behavior
- if enqueue fails, keep finalize successful and rely on reconcile as today

### 3. No separate reissue route in 024
Decision:
- do not add `reissue-signed-url` or `pending-lookup` routes in 024

Reason:
- `createAssetWithIdempotency()` already returns a fresh signed URL for an existing idempotency key
- batch prepare can therefore serve both:
  - first-time prepare
  - recovery/retry prepare for existing pending assets

Implication:
- the client must persist stable per-file idempotency keys
- the client should not rely on persisted signed URLs because they expire

### 4. Preflight strategy
Keep:
- `src/app/api/projects/[projectId]/assets/preflight/route.ts`

Change its usage:
- first request sends file metadata without hashes
- server returns `candidateSizes`
- client hashes only files whose `file.size` is present in `candidateSizes`
- optional second preflight sends hashes for duplicate UX

Bounded decision:
- do not fold duplicate UX entirely into batch prepare in 024
- keep preflight as the lightweight UX hint path
- batch prepare remains authoritative for duplicate handling

## Client Design

### 1. New bulk upload architecture
Refactor `src/components/projects/assets-upload-form.tsx` to use a small client upload manager.

Add:
- `src/lib/uploads/project-upload-manifest.ts`
- `src/lib/uploads/project-upload-queue.ts`
- `src/lib/uploads/project-upload-types.ts`

Responsibilities:
- manifest persistence
- queue scheduling
- bounded concurrency
- retry and recovery orchestration
- item-level status tracking

### 2. Persisted manifest model
Use `localStorage` for v1 manifest persistence.

Reason:
- metadata-only storage is sufficient
- no raw file bytes will be stored
- implementation is smaller and more predictable than IndexedDB for one bounded cycle
- size is acceptable for metadata for `1000+` files

Manifest keying:
- storage key should include project id, for example `snapconsent:project-upload:<projectId>`
- manifest is never authoritative for security; it is only a client recovery hint

Stable per-file identity:
- persist both:
  - `clientItemId`: a local manifest item UUID
  - `idempotencyKey`: stable server replay key
- also persist a lightweight re-selection fingerprint:
  - `name`
  - `size`
  - `lastModified`
  - `contentType`

Persisted manifest fields per item:
- `clientItemId`
- `idempotencyKey`
- `projectId`
- `originalFilename`
- `contentType`
- `fileSizeBytes`
- `lastModified`
- `selectionFingerprint`
- `contentHash` or `null`
- `needsHash`
- `hashStatus`
- `assetId` or `null`
- `storageBucket` or `null`
- `storagePath` or `null`
- `status`
- `attemptCount`
- `lastErrorCode` or `null`
- `lastErrorMessage` or `null`
- `updatedAt`

Do not persist:
- raw `File` bytes
- signed upload URLs as authoritative recovery state

### 3. Queue states
Queue-level states:
- `idle`
- `preflighting`
- `running`
- `paused`
- `blocked_auth`
- `completed`
- `recoverable`

Item-level states:
- `selected`
- `needs_hash`
- `ready_to_prepare`
- `prepared`
- `uploading`
- `uploaded`
- `finalizing`
- `finalized`
- `skipped_duplicate`
- `failed`
- `needs_file`
- `blocked_auth`

### 4. Initial concurrency
Use conservative fixed values in 024:
- preflight requests: `1`
- prepare batch size: `50`
- prepare requests in flight: `1`
- hash concurrency: `2`
- storage PUT concurrency: `4`
- finalize batch size: `50`
- finalize requests in flight: `1`

Reason:
- strong reduction in authenticated round-trips
- bounded browser/network pressure
- simpler failure handling

### 5. Hashing strategy
Keep hashing client-side with `crypto.subtle`.

Change staging:
- do not hash every file before first upload starts
- use size prefilter first
- only hash files that are actual duplicate candidates
- hash candidate files incrementally with a small concurrency limit
- allow non-candidate files to proceed to prepare immediately

### 6. Retry and pause/resume behavior
Retry behavior:
- per-item retry for `failed`, `blocked_auth`, and `needs_file` items
- batch-level resume for any manifest with unfinished items
- prepare retry reuses the same idempotency key
- finalize retry reuses the same `assetId`

Pause behavior:
- pause stops scheduling new prepare/upload/finalize work
- active uploads are allowed to finish
- no byte-range partial resume is attempted

Resume behavior:
- queue resumes from persisted manifest state
- items with known `assetId` and `uploaded` status retry finalize directly
- items with known `idempotencyKey` but stale or missing signed URLs go back through batch prepare

Cancellation behavior for 024:
- do not implement destructive server-side cancellation
- optional UI reset can clear the local manifest only after confirmation
- if clear/reset is provided, warn that server-side pending assets may still exist and recovery information will be lost

### 7. Refresh recovery flow
On component mount:
- load manifest for the current project from `localStorage`
- if unfinished items exist, show a recovery banner
- classify items:
  - `finalized`: done, do not re-upload
  - `uploaded`: retry batch finalize
  - `prepared` or `failed_upload`: can retry batch prepare and upload if file can be reattached
  - `selected` with no file object: mark `needs_file`

Browser limitation handling:
- a refreshed page cannot reliably recover `File` objects from normal file input state
- unresolved items that require bytes must ask the user to reselect files
- auto-reassociation uses the stored fingerprint tuple
- if multiple pending items match the same fingerprint, mark them ambiguous and require explicit user resolution

## Duplicate Handling

### Initial batch flow
1. Create manifest items with stable `idempotencyKey`s.
2. Run size-only preflight for the selected batch.
3. Hash only candidate-size files.
4. Optionally run hash preflight to support duplicate policy UI.
5. Run batch prepare with the chosen duplicate policy.
6. Upload only items returned as `ready`.
7. Batch finalize uploaded items.

### Server-authoritative safety
- preflight remains advisory only
- batch prepare still performs authoritative duplicate handling via server logic
- duplicate policy remains `upload_anyway`, `overwrite`, or `ignore`
- duplicate safety remains scoped to `(tenant_id, project_id, asset_type)`

### Retry and refresh safety
- same file item must reuse the same idempotency key across retries
- batch prepare for an existing idempotency key must not create a new asset row
- items already marked `uploaded` must go to finalize retry, not create a new asset

## Files To Create / Modify

### Create
- `src/app/api/projects/[projectId]/assets/batch/prepare/route.ts`
- `src/app/api/projects/[projectId]/assets/batch/finalize/route.ts`
- `src/lib/assets/prepare-project-asset-batch.ts`
- `src/lib/assets/finalize-project-asset-batch.ts`
- `src/lib/uploads/project-upload-manifest.ts`
- `src/lib/uploads/project-upload-queue.ts`
- `src/lib/uploads/project-upload-types.ts`
- `tests/feature-024-upload-performance-resumability.test.ts`

### Modify
- `src/components/projects/assets-upload-form.tsx`
- `src/app/api/projects/[projectId]/assets/preflight/route.ts`
- `src/lib/assets/create-asset.ts`
- `src/lib/assets/finalize-asset.ts`
- `src/lib/client/idempotency-key.ts` only if a helper for externally provided stable keys improves clarity

### Leave unchanged in 024
- `src/components/projects/consent-asset-matching-panel.tsx`
- `src/components/projects/headshot-replacement-form.tsx`
- `src/components/public/public-consent-form.tsx`
- `src/app/api/public/invites/[token]/headshot/route.ts`
- `src/app/api/public/invites/[token]/headshot/[assetId]/finalize/route.ts`

## Step-by-Step Implementation Plan

1. Refactor asset helpers so batch prepare/finalize can reuse current single-item validation and write logic without redoing project access in every route call.
2. Add `prepare-project-asset-batch.ts` with request caps, per-item result shaping, and idempotent reuse through `createAssetWithIdempotency()`.
3. Add `batch/prepare` route with one auth lookup, one tenant resolution, one project access check, then per-item processing.
4. Add `finalize-project-asset-batch.ts` with request caps, per-item finalize calls, and current matching enqueue semantics.
5. Add `batch/finalize` route with one auth lookup and one tenant/project scope validation.
6. Update preflight handling so the client can use `candidateSizes` before hashing.
7. Extract a small client upload manager and manifest model.
8. Refactor `assets-upload-form.tsx` to:
   - create manifest items on selection
   - run size-prefiltered hashing
   - prepare in batches
   - upload with bounded parallelism
   - finalize in batches
   - persist progress continuously
   - recover from manifest on refresh
9. Add recovery UI states:
   - resume batch
   - retry failed items
   - request file re-selection for `needs_file`
   - clear completed manifest
10. Keep current success/error messaging but shift it to per-item and batch summary states so partial failures do not wipe completed progress.

## Security Considerations

- All new project routes must derive tenant from auth/session plus `resolveTenantId()`.
- Project access must be validated server-side before batch work starts.
- Client-provided `projectId`, `assetId`, `idempotencyKey`, and manifest state are never trusted for scoping.
- Signed upload URLs remain server-generated only.
- MIME type and file size remain server-validated in asset-create logic.
- Duplicate checks remain server-authoritative.
- Batch routes must enforce conservative item caps and reject oversized requests.
- Mixed-result responses should expose stable internal error codes and safe user-facing messages only.
- Recovery using a stale manifest must fail closed when auth or project access is no longer valid.

## Idempotency and Retry Safety

- Batch prepare is item-idempotent, not one giant all-or-nothing idempotent transaction.
- Each file item gets its own stable idempotency key.
- Repeating batch prepare with the same item key must reuse the same asset row and return a fresh signed URL.
- Batch finalize is safe to retry because `finalizeAsset()` and link upserts are already idempotent enough for this workflow.
- Matching enqueue remains safe because job dedupe keys are stable.
- Refresh after successful prepare must not create duplicate pending rows if the user resumes with the same manifest.
- Refresh after successful upload but failed finalize must retry finalize using the known `assetId`.

## Operational and Error-Handling Considerations

- `401` or `403` during prepare/finalize should transition the queue to `blocked_auth`, preserve the manifest, and stop new work.
- Network failure during PUT should mark only that item failed; other completed items remain completed.
- Stale signed URL errors should send the item back through batch prepare using the same idempotency key.
- Mixed success in prepare/finalize responses should update each item independently, not fail the whole queue in memory.
- Pending assets that were created but never uploaded remain a deferred cleanup concern; 024 should document this clearly rather than silently hiding it.
- Manifest should be cleared automatically once all items are terminal and the user has acknowledged completion, or after a conservative age threshold if the app wants stale-manifest cleanup.

## API and UI Impact

### API impact
- adds two authenticated internal project routes:
  - `POST /api/projects/[projectId]/assets/batch/prepare`
  - `POST /api/projects/[projectId]/assets/batch/finalize`
- keeps existing single-file create/finalize routes for all other upload surfaces
- keeps existing preflight route with a revised client usage pattern

### UI impact
- project bulk uploader gains:
  - queue-based progress
  - item-level status
  - per-item retry
  - pause/resume
  - refresh recovery banner
  - reselect-files recovery flow
- no redesign of other upload surfaces in 024

## Test Plan

Add or update tests to cover:
- batch prepare creates multiple assets in one authenticated request path
- batch prepare reuses existing assets when the same idempotency keys are retried
- batch finalize finalizes multiple assets and remains retry-safe
- matching enqueue still occurs exactly once per completed photo upload through dedupe keys
- size-prefilter duplicate flow hashes only candidate-size files at the client helper level
- refresh recovery manifest logic restores item states correctly
- items with known `assetId` retry finalize without creating new assets
- `401` and `403` move the queue to recoverable auth-blocked state
- mixed prepare/finalize success updates item states predictably
- request caps reject oversized batch prepare/finalize calls
- single-file and smaller upload flows remain unchanged

Recommended test files:
- new `tests/feature-024-upload-performance-resumability.test.ts`
- targeted unit-style tests for `src/lib/uploads/project-upload-manifest.ts`
- keep existing upload-related tests green without broad rewrites of public/headshot flows

## Verification Checklist

- `1000+` photo batches complete materially faster than the current sequential path.
- Direct browser-to-storage upload is still used; file bytes do not pass through Next.js.
- Authenticated app request count for large bulk uploads is materially reduced from `1 + 2N`.
- Project bulk upload survives refresh with manifest recovery UI.
- Already finalized items are not re-uploaded.
- Already prepared items reuse the same idempotency key and asset identity.
- Uploaded-but-not-finalized items can finalize after refresh without creating a new asset.
- Duplicate safety remains server-authoritative.
- Tenant and project scoping remain intact on all new routes.
- Mixed success/failure batches leave completed items completed and failed items retryable.
- `401` and `403` pause the queue cleanly and preserve recovery state.
- Missing reselected files are surfaced clearly as `needs_file`.
- Matching enqueue semantics remain unchanged for successfully finalized photo uploads.
- Existing single-file headshot/public flows are unaffected.
- Clean reset is not impacted because 024 adds no migration.

## Deferred Risks To Carry Forward

- orphaned `pending` assets still need a future cleanup story
- secondary upload surfaces still use the old sequential pattern
- local fingerprint re-association after refresh can be ambiguous for identical duplicate files in one selection
- client-side hashing still uses full-file reads for candidate files; v024 improves scope, not the underlying browser hashing primitive
