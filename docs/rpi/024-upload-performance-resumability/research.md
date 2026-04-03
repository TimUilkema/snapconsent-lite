# 024 Upload Performance + Resumability - Research

## Goal
Research how to make large photo uploads much faster and more reliable for very large batches, while preserving tenant scoping, idempotency, and correctness.

This research is based on the current repository code as the source of truth. Older RPI docs were only used as secondary context and were verified against the implementation.

## Sources Inspected

Required docs:
- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`

Current implementation:
- `src/components/projects/assets-upload-form.tsx`
- `src/components/projects/consent-asset-matching-panel.tsx`
- `src/components/projects/headshot-replacement-form.tsx`
- `src/components/public/public-consent-form.tsx`
- `src/app/api/projects/[projectId]/assets/route.ts`
- `src/app/api/projects/[projectId]/assets/preflight/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`
- `src/app/api/public/invites/[token]/headshot/route.ts`
- `src/app/api/public/invites/[token]/headshot/[assetId]/finalize/route.ts`
- `src/lib/assets/create-asset.ts`
- `src/lib/assets/finalize-asset.ts`
- `src/lib/client/idempotency-key.ts`
- `src/lib/client/storage-signed-url.ts`
- `src/lib/supabase/server.ts`
- `src/lib/supabase/admin.ts`
- `src/lib/tenant/resolve-tenant.ts`
- `src/lib/matching/auto-match-jobs.ts`

Schema and policies:
- `supabase/migrations/20260304212000_002_projects_invites_idempotency.sql`
- `supabase/migrations/20260305120000_004_assets_schema.sql`
- `supabase/migrations/20260305121000_004_assets_rls.sql`
- `supabase/migrations/20260305122000_004_assets_storage.sql`
- `supabase/migrations/20260305150000_005_assets_content_hash.sql`
- `supabase/migrations/20260306100000_006_headshot_consent_schema.sql`

Tests and prior docs checked for drift:
- `tests/feature-010-auto-match-backbone.test.ts`
- `tests/feature-012-manual-review-likely-matches.test.ts`
- `tests/feature-023-request-uri-safety.test.ts`
- `docs/rpi/004-project-assets/research.md`
- `docs/rpi/005-duplicate-upload-handling/research.md`
- `docs/rpi/006-headshot-consent/research.md`

## Current Upload Pipeline Analysis

### Current bulk project upload UI
Primary large-batch upload path:
- `src/components/projects/assets-upload-form.tsx`

Current flow for one selected batch:
1. User selects files in the browser.
2. Client hashes files in `prepareFiles()` using `hashFile()`.
3. Client sends one authenticated `POST /api/projects/[projectId]/assets/preflight`.
4. If duplicates are detected, UI pauses for a batch-level policy choice.
5. Client enters `uploadPreparedFiles()`.
6. For each file, sequentially:
   - `POST /api/projects/[projectId]/assets`
   - `PUT` directly to Supabase Storage using the signed upload URL
   - `POST /api/projects/[projectId]/assets/[assetId]/finalize`
7. After the whole batch completes, `router.refresh()` reloads the project page.

Current batch behavior:
- Uploads are strictly sequential.
- Create is awaited before upload.
- Upload is awaited before finalize.
- Finalize is awaited before the next file begins.
- There is no in-memory queue with concurrency control.
- There is no persistence of upload state outside React component state.

### Request model for one photo
For one project photo in the main upload form, current network sequence is:
1. Browser `POST /assets/preflight` once per batch, not per file.
2. Browser `POST /assets` per file.
3. Server `createAssetWithIdempotency()`:
   - project access check
   - consent validation
   - idempotency lookup
   - duplicate lookup/archive if applicable
   - `assets` insert with `status='pending'`
   - `idempotency_keys` upsert
   - service-role `storage.createSignedUploadUrl(...)`
4. Browser `PUT` file bytes directly to Storage.
5. Browser `POST /assets/[assetId]/finalize` per file.
6. Server `finalizeAsset()`:
   - asset lookup
   - consent validation
   - `assets` update to `status='uploaded'`
   - optional `asset_consent_links` upsert
7. For photos only, finalize route also calls `enqueuePhotoUploadedJob()`.

### Request count for a large batch
For `N` files in the main bulk uploader:
- `1` preflight request
- `N` authenticated create requests
- `N` Storage `PUT` requests
- `N` authenticated finalize requests
- total: `1 + 3N` browser-originated requests
- authenticated Next.js route hits: `1 + 2N`

For `1000` files, current bulk upload is roughly:
- `2001` authenticated app requests
- `1000` Storage PUTs
- `3001` total requests before page refresh

### Secondary upload surfaces
Other upload surfaces reuse the same create/upload/finalize pattern:
- `src/components/projects/consent-asset-matching-panel.tsx`
  - multi-file photo upload, also strictly sequential
  - no preflight/hash step
- `src/components/projects/headshot-replacement-form.tsx`
  - single-file headshot replacement
- `src/components/public/public-consent-form.tsx`
  - single-file public headshot upload

These are relevant because a future upload manager should likely be shared, but large-batch pressure is concentrated in `assets-upload-form.tsx`.

## Verified Current Bottlenecks

### 1. Client-side hashing is fully sequential
In `assets-upload-form.tsx`, `prepareFiles()` loops with `await hashFile(file)` for every selected file.

Implications:
- No upload starts until hashing completes.
- Large batches pay a full client CPU + file-read pass up front.
- Hashing reads each file into memory with `file.arrayBuffer()`.
- This is app-bound, not network-bound.

This is a doc/code mismatch with older Feature 005 intent:
- old docs described hashing only candidate files after a size prefilter
- current code hashes every selected file first, then calls preflight

### 2. Preflight does extra work and part of it is unused
`POST /assets/preflight` currently:
- authenticates the request
- resolves tenant
- checks matching sizes in `assets`
- checks matching content hashes in `assets`

The response contains:
- `candidateSizes`
- `duplicateHashes`

But current UI only uses `duplicateHashes`.
`candidateSizes` is returned but not used by `assets-upload-form.tsx`.

This means current preflight cost includes:
- one authenticated server request
- at least one DB pass for sizes that does not currently affect the client flow

This is also a concrete optimization opportunity for the plan:
- preflight already returns `candidateSizes`
- the client could first ask for duplicate candidate sizes
- then only hash files whose `file.size` exists in `candidateSizes`
- files with unique sizes could skip client hashing entirely for duplicate UX precheck

That would not replace authoritative server-side duplicate enforcement in `createAssetWithIdempotency()`, but it would substantially reduce client CPU and file-read cost for large batches where most files have unique sizes.

### 3. Create/upload/finalize is fully sequential
`uploadPreparedFiles()` processes files one by one.

Implications:
- Storage bandwidth is underutilized for many files.
- Small-file batches are dominated by round-trip latency.
- Slow files block the entire queue.
- Auth/session exposure window becomes much longer.

This is both network-bound and app-bound:
- network-bound because every file pays separate request latency
- app-bound because each authenticated request repeats server-side auth, tenant resolution, and DB work

### 4. Each file repeats auth/session and tenant resolution
Authenticated upload routes (`preflight`, `create`, `finalize`) all call:
- `createClient()` from `src/lib/supabase/server.ts`
- `supabase.auth.getUser()`
- `resolveTenantId()` RPC

So for project uploads, each file currently causes:
- one authenticated create request with auth/session check
- one authenticated finalize request with auth/session check

This repeated work is safe but expensive.

### 5. Create path repeats project access and duplicate checks per file
`createAssetWithIdempotency()` currently does, per file:
- `ensureProjectAccess()`
- `validateConsents()`
- idempotency read
- optional duplicate lookup/archive
- asset insert
- idempotency write
- signed upload URL generation

For the main project uploader, `consentIds` are empty, so consent validation is cheap, but project access and idempotency work still repeat for every file.

### 6. Finalize path repeats DB work per file
`finalizeAsset()` currently does, per file:
- asset lookup
- asset status update
- optional consent link upsert
- suppression cleanup if relevant

For photo uploads, finalize route also does matching job enqueue after finalization.

### 7. Duplicate detection is partially duplicated
Current duplicate-related work happens in two places:
- batch preflight lookup for UX
- per-file duplicate handling again in `createAssetWithIdempotency()`

This is correct for safety, but it means the current UX preflight is not the authoritative duplicate action and does not eliminate per-file duplicate DB cost.

### 8. Refresh destroys all in-memory progress
Current upload state lives only in component state:
- selected `File[]`
- prepared hashes
- duplicate policy choice
- progress counters
- create response data like `assetId` and `signedUrl`

No usage was found for:
- `localStorage`
- `sessionStorage`
- `IndexedDB`
- `BroadcastChannel`
- service workers/background sync

So refresh/navigation currently:
- aborts any active XHR upload
- clears the selected file input
- loses every generated idempotency key
- loses every returned `assetId`
- loses knowledge of which files were created/uploaded/finalized

## Network-Bound vs App-Bound Breakdown

### Mostly network-bound
- `PUT` of file bytes to Storage
- browser-to-app latency for `create` and `finalize`

### Mostly app-bound
- sequential SHA-256 hashing before upload
- repeated auth/session checks
- repeated tenant resolution RPC
- repeated project access check
- repeated signed URL generation
- repeated idempotency read/write
- repeated finalize DB writes

### Practical interpretation
- For many small/medium files, the current bottleneck is not raw upload bandwidth alone. It is the serial create/upload/finalize loop plus repeated app round-trips.
- For larger files, storage PUT time dominates more, but full sequential uploads still underutilize browser/network capacity.

## Authentication and Request Model

### Current authenticated upload model
Project upload routes use the cookie-backed Supabase SSR client:
- `createClient()` reads cookies from the request
- route calls `auth.getUser()`
- route resolves tenant via `current_tenant_id`

This means:
- the browser does not send a separate bearer token manually
- same-origin fetches rely on the session cookie
- every authenticated route request independently validates the session

### Storage upload auth model
Actual file bytes are uploaded directly to Supabase Storage using signed upload URLs.

Implications:
- Storage PUT does not go through the Next.js app
- once the signed URL exists, the file upload no longer needs app auth for that PUT
- app auth still matters for prepare/create/finalize requests

### Likely causes of auth failures in long upload sessions
Most plausible, based on current code:
- session expiry during a long-running batch
- refresh/navigation destroying client state
- later create/finalize requests failing after earlier uploads took too long

Less plausible from current code:
- a special auth bug caused by request count alone

What repeated sequential requests do cause:
- they increase total wall-clock time
- that increases the chance the cookie-backed session expires before the batch finishes

### Safest reliability approach for auth
For long uploads, the safest direction is:
- reduce authenticated request count sharply
- keep direct-to-storage uploads
- fail fast on one authenticated batch-prepare call before spending upload time
- pause the queue cleanly on `401`/`403`
- allow resume after the user reauthenticates

## Large-Batch Upload Strategy Evaluation

### Option A: keep fully sequential uploads
Possible:
- yes

Assessment:
- simplest
- clearly too slow and fragile for 1000+ images
- worst possible session-expiry exposure
- worst bandwidth utilization

Not recommended.

### Option B: bounded parallel uploads using current per-file routes
Possible:
- yes, without major backend changes

How it would work:
- keep current `POST /assets`
- keep current signed upload URLs
- keep current `POST /finalize`
- client runs multiple file pipelines in parallel

Pros:
- immediate speedup
- no schema changes required
- lower implementation risk than a full redesign

Cons:
- still pays `2N` authenticated route hits
- still pays signed URL generation per file
- still pays finalize per file
- easy to overwhelm the browser or DB if concurrency is too high

This is a valid short-term improvement, but not the best v1 if the goal is 1000s of images.

### Option C: batched prepare + bounded parallel Storage PUT + batched finalize
Possible:
- yes, within the current architecture

How it fits the repo:
- keep Next.js route handlers
- keep tenant derivation server-side
- keep direct browser PUT to signed upload URLs
- keep `assets` rows and finalize semantics
- add batch preparation/finalization routes instead of per-file prepare/finalize

Pros:
- resolves auth and tenant once per batch, not per file
- cuts route round-trips dramatically
- preserves current private bucket + signed upload URL design
- easiest path to resumability because batch manifest can persist stable `assetId`s

Cons:
- requires new server endpoints/helpers
- requires queue/finalize manifest handling
- needs careful batch caps

This is the strongest practical v1 for this codebase.

### Signed upload URLs in batches
Possible:
- yes

Reason:
- the server already generates storage paths and asset rows safely
- returning many `{ assetId, signedUrl, storagePath }` entries in one auth-scoped response fits the current design

Safety requirements:
- tenant/project still derived server-side
- batch size capped
- per-file validation still server-side

### Recommended v1 strategy
Most practical v1 for plan phase:
1. Keep Supabase Storage direct upload architecture.
2. Add a batch prepare route for project photo uploads.
3. Add bounded parallel browser uploads.
4. Add a batch finalize route.
5. Persist upload manifest/state in browser storage.
6. Change duplicate preflight to a two-stage client flow:
   - ask the server for duplicate candidate sizes first
   - only hash files whose size matches an existing asset size
   - run hash-based duplicate UX only for those candidate files

Recommended starting numbers:
- prepare batch size: `50-100` files per request
- finalize batch size: `20-100` assets per request
- active upload concurrency: `4-6` Storage PUTs

Why:
- low enough to avoid overwhelming the browser
- high enough to materially reduce wall-clock time
- still small enough for predictable server validation and error handling

This is a high-value optimization because current code already computes `candidateSizes`, but the client ignores it and hashes every file. Using size as a prefilter is a practical v1 improvement that reduces browser-side work without weakening server-side duplicate correctness.

## Refresh / Resumability Research

## Current state
Current behavior after refresh:
- all active uploads are lost
- all React state is lost
- all selected `File` objects are lost
- the user cannot automatically continue the batch

### What is definitely possible
Without changing the storage architecture, it is definitely possible to:
- persist a client-side upload manifest in browser storage
- persist stable idempotency keys per file
- persist returned `assetId`, `storagePath`, and per-file status
- recover which files were:
  - not started
  - prepared
  - uploaded but not finalized
  - finalized
- show recovery UI after refresh
- retry finalize for already-uploaded assets if `assetId` is known
- reissue signed upload URLs for existing pending assets if the app adds a safe server endpoint for that
- use file-size prefiltering so only duplicate-candidate files are hashed client-side

### What is limited by browser behavior
Using the current `<input type="file">` model:
- selected files do not survive refresh in normal React memory
- file input cannot be repopulated programmatically after reload
- active uploads are aborted by refresh/navigation

This means true automatic continuation of raw file bytes is not possible with the current UI alone.

### What "resume" can realistically mean in v1
Realistic v1 meaning of resume:
- restore the queue metadata
- restore known server-side asset records
- restore which items still need bytes uploaded or only need finalize
- ask the user to reselect missing local files when necessary

This is different from:
- true background upload that survives tab close
- true byte-level resumable multipart upload

### IndexedDB and persisted file bytes
Possible but limited:
- IndexedDB can store Blobs in many browsers
- File System Access API can preserve file handles in some browsers

Caveats:
- large batches can exceed quota
- storing 1000s of images duplicates storage locally and can be slow
- File System Access API is not universal
- current app does not use either

Conclusion:
- v1 should persist manifest/state, not raw image bytes
- user re-selection is the realistic fallback for unresolved files after refresh

### What requires larger architectural changes
- true upload continuation after browser refresh without re-selection
- resumable multipart uploads
- service-worker-driven background upload survival

These require a broader architectural step beyond a small v1.

## Idempotency and Consistency Analysis

### Current create-step idempotency
`createAssetWithIdempotency()` is retry-safe only when the same:
- `tenant_id`
- `operation`
- `Idempotency-Key`

are reused.

Current UI behavior:
- every file create call generates a fresh random idempotency key
- the key is not persisted anywhere client-side

Implication:
- current create is technically idempotent
- current client behavior does not make effective use of that idempotency across refresh/retry

### Current finalize-step idempotency
Finalize has no explicit idempotency key.

But it is mostly retry-safe for the same `assetId` because:
- setting `assets.status='uploaded'` is repeatable
- consent link upsert is repeatable
- photo enqueue uses dedupe keys downstream

Gap:
- if refresh loses `assetId`, the client cannot safely retry finalize for the same asset

### Partial failure scenarios in current code

#### Create succeeded, upload failed
Current result:
- pending `assets` row exists
- idempotency record exists
- storage object may not exist

Current recovery:
- weak
- if client lost the idempotency key, retry creates a new pending asset row

#### Upload succeeded, finalize failed
Current result:
- storage object exists
- `assets` row may still be `pending`

Current recovery:
- only possible if client still knows `assetId`
- current UI loses that on refresh

#### Refresh during upload
Current result:
- XHR aborted
- client loses all state
- server may already have pending asset rows for some files

Current recovery:
- weak
- no manifest persistence
- no pending-asset recovery flow found in current code

### Minimum changes needed for safe recovery
Minimum safe recovery changes for a future plan:
- persist one stable client manifest per file
- persist stable idempotency key per file
- persist returned `assetId` per file
- persist per-file state transitions
- add server support to:
  - reissue signed upload URL for an existing pending asset, or
  - batch finalize already-uploaded assets, or
  - query pending assets for a resumable manifest

## Storage / Supabase Constraints

### Current storage model
Current architecture is:
- private bucket `project-assets`
- object path scoped as `tenant/<tenantId>/project/<projectId>/asset/<assetId>/...`
- signed upload URLs generated server-side
- browser uploads directly to Storage

This remains suitable for large batches.

### Why current storage architecture is good
- file bytes do not pass through Next.js
- tenant/project scoping stays server-controlled
- service role stays server-only
- direct browser-to-storage uploads are the correct direction for scale

### Current caveats
- signed upload URLs are generated one by one
- each retry with a new assetId creates a new storage path
- no cleanup path for abandoned `pending` assets was found in current code
- no resumable multipart upload layer exists

### Parallel upload caveats
Parallel uploads are feasible with the current storage approach, but:
- too much concurrency can overwhelm browser connections
- hashing large files plus parallel PUTs can increase memory pressure
- app should cap concurrency conservatively

## Minimal UI/UX Implications

Minimal robust large-batch UX should add:
- queue-level progress
- per-file status:
  - queued
  - preparing
  - uploading
  - uploaded
  - finalizing
  - complete
  - failed
- per-file retry
- batch pause/resume
- explicit recovery message after refresh
- clear distinction between:
  - files that need re-selection
  - files already uploaded and only needing finalize
  - completed files

Cancellation:
- current code has no cancellation
- v1 cancellation can be implemented as:
  - abort active XHRs
  - keep manifest state
  - allow retry later

No major visual redesign is required for v1.

## Security and Safety

Current security properties that must be preserved:
- tenant derived server-side
- project checked server-side
- no client-trusted tenant/project IDs
- service-role key stays server-only
- private bucket remains private
- `assets` and `idempotency_keys` stay tenant-scoped

Safe limits recommended for future plan:
- cap prepare batch request size
- cap finalize batch request size
- cap client concurrency
- keep existing per-file validation:
  - MIME allowlist
  - file size max
  - consent ID limits

Duplicate safety:
- avoid creating new asset rows for refresh retries by persisting idempotency keys and asset IDs
- do not trust client duplicate claims without server validation

## Edge Cases To Carry Into Planning

- `1000+` image batches
- browser refresh mid-upload
- auth/session expiry during a long batch
- duplicate images
- network drop and reconnect
- large files near the current `25 MB` limit
- upload succeeded but finalize failed
- create succeeded but upload never started
- retry after refresh with lost idempotency key
- abandoned pending assets
- partial batch success with mixed retry states

## Definite vs Browser-Limited vs Architectural

### Definitely possible in the current architecture
- bounded parallel direct-to-storage uploads
- batch prepare route returning many signed upload URLs
- batch finalize route
- persistent client manifest for retry/recovery
- stable idempotency keys per file
- resume UI that recovers server-side state and asks for re-selection where needed

### Limited by browser behavior
- keeping selected `File` objects across refresh with the current file-input approach
- continuing active uploads through refresh/navigation
- fully automatic resume without re-selection for unresolved files

### Requires larger architectural changes
- true resumable multipart uploads
- background uploads surviving tab close/reload
- byte-level continuation without user re-selection
- durable local storage of thousands of large image blobs as a primary strategy

## Research Outcome

Current upload performance is limited by several stacked bottlenecks, not just raw upload bandwidth:
- sequential client hashing
- sequential create/upload/finalize
- repeated auth and tenant resolution per file
- repeated signed URL generation per file
- repeated finalize and enqueue work per file
- state loss on refresh

The current private-bucket + signed upload URL architecture is still the right foundation.

The strongest practical v1 direction for planning is:
1. keep direct browser-to-storage uploads
2. add batch prepare
3. add bounded parallel uploads
4. add batch finalize
5. persist a resumable client manifest with stable idempotency keys and asset IDs

That gives a large performance win and meaningful recovery without requiring a full resumable-upload architecture.

No code changes were made during this research step.
