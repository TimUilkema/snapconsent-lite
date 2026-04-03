# Feature 028 Research: Duplicate Upload Detection Regression After Batched Upload Changes

## Scope and method

This research is code-first. Docs were read for intent, but current repository code was treated as ground truth.

Read and verified:
- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `README.md`
- `docs/rpi/README.md`
- `docs/rpi/005-duplicate-upload-handling/*`
- `docs/rpi/023-bugfix-requesturi/*`
- `docs/rpi/024-upload-performance-resumability/*`

Repository notes:
- `SUMMARY.md` is not present in the repo root.
- `docs/rpi/022-asset-upload-performance/` exists but has no checked-in research/plan content in this repo snapshot.

Code reviewed:
- `src/app/api/projects/[projectId]/assets/preflight/route.ts`
- `src/app/api/projects/[projectId]/assets/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`
- `src/app/api/projects/[projectId]/assets/batch/prepare/route.ts`
- `src/app/api/projects/[projectId]/assets/batch/finalize/route.ts`
- `src/lib/assets/create-asset.ts`
- `src/lib/assets/finalize-asset.ts`
- `src/lib/assets/prepare-project-asset-batch.ts`
- `src/lib/assets/finalize-project-asset-batch.ts`
- `src/lib/uploads/project-upload-manifest.ts`
- `src/lib/uploads/project-upload-queue.ts`
- `src/lib/uploads/project-upload-types.ts`
- `src/components/projects/assets-upload-form.tsx`
- `src/app/api/public/invites/[token]/headshot/route.ts`
- `supabase/migrations/20260305120000_004_assets_schema.sql`
- `supabase/migrations/20260305150000_005_assets_content_hash.sql`
- `tests/feature-024-upload-performance-resumability.test.ts`
- `tests/feature-023-request-uri-safety.test.ts`

## Goal

Research why duplicate detection is now missing duplicates after the batched upload and upload-speed changes, and determine whether the size-prefilter optimization is safe in theory but misapplied in practice.

## 1. Current relevant code structure

### Single project photo upload flow

Current single-file authenticated project upload flow:

1. `POST /api/projects/[projectId]/assets`
   - route in `src/app/api/projects/[projectId]/assets/route.ts`
   - calls `createAssetWithIdempotency(...)`
2. browser uploads bytes directly to Storage using the returned signed upload URL
3. `POST /api/projects/[projectId]/assets/[assetId]/finalize`
   - route in `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`
   - calls `finalizeAsset(...)`
   - photo finalize also enqueues matching via `enqueuePhotoUploadedJob(...)`

Duplicate detection timing in this path:
- duplicate handling only happens in `createAssetWithIdempotency(...)`
- only when `contentHash` is provided and `duplicatePolicy !== "upload_anyway"`

### Batched project photo upload flow

Current batched uploader lives in `src/components/projects/assets-upload-form.tsx`.

Current client lifecycle:

1. file selection creates persisted manifest items with stable `clientItemId` and `idempotencyKey`
2. preflight pass 1:
   - `preflightForItems(..., includeHashes = false)`
   - sends `name`, `size`, `contentType`
   - route returns `candidateSizes`
3. client hashes only files whose `fileSizeBytes` is in `candidateSizes`
4. preflight pass 2:
   - `preflightForItems(..., includeHashes = true)`
   - sends hashes only for files that were hashed
   - route returns `duplicateHashes`
5. if any manifest item is marked `isDuplicate`, queue pauses in `awaiting_policy`
6. after policy selection, client calls batch prepare:
   - `POST /api/projects/[projectId]/assets/batch/prepare`
   - route calls `prepareProjectAssetBatch(...)`
7. browser uploads ready items directly to Storage
8. client calls batch finalize:
   - `POST /api/projects/[projectId]/assets/batch/finalize`
   - route calls `finalizeProjectAssetBatch(...)`

Batch helpers:
- `src/lib/assets/prepare-project-asset-batch.ts`
- `src/lib/assets/finalize-project-asset-batch.ts`

Manifest/queue state:
- `src/lib/uploads/project-upload-manifest.ts`
- `src/lib/uploads/project-upload-queue.ts`
- `src/lib/uploads/project-upload-types.ts`

### Public and headshot upload flows

Non-batch upload surfaces still call the single-item helper directly:
- `src/app/api/public/invites/[token]/headshot/route.ts`
- project headshot replacement controls and other single-file upload surfaces in UI

These do not use the batched project photo preflight/manifest flow.

## 2. Current upload lifecycle and duplicate detection timing

### Asset row creation timing

`createAssetWithIdempotency(...)` inserts the `assets` row before upload:
- `status = 'pending'`
- `content_hash` is written at create time if the client supplied it
- `uploaded_at` remains null until finalize

This means duplicate-relevant DB state can exist before bytes are uploaded.

### Byte size timing

`file_size_bytes` is known before upload and is stored at create time.

### Content hash timing

`content_hash` is only known if the client computed it and sent it.

In the current batch uploader, that is no longer true for every file:
- hashes are only computed for files whose size matches `candidateSizes` returned by preflight
- files not marked as candidate-size files keep `contentHash = null`

### Finalize timing

`finalizeAsset(...)`:
- marks `assets.status = 'uploaded'`
- sets `uploaded_at`
- upserts manual consent links if supplied
- does not compute or backfill content hashes

So duplicate detection is not finalized-time logic. It is create-time logic gated by whether a hash exists.

## 3. What changed after Features 005 / 023 / 024

### Feature 005 intent vs current code

Feature 005 planned:
- `content_hash` in `assets`
- duplicate checks by `(tenant_id, project_id, content_hash)`
- client hashing for duplicate detection

Current code still matches that at the server data-model level:
- `assets.content_hash`
- `assets.content_hash_algo`
- index `(tenant_id, project_id, content_hash)`

But current client behavior is narrower than the original all-file-hash approach described in earlier docs:
- duplicate-relevant hashes are now computed only for size-prefiltered items

### Feature 023 impact

Feature 023 mainly changed request-URI safety.

Observed duplicate-related impact:
- preflight size/hash queries are chunked using `chunkValues(...)`
- consent validation in create/finalize helpers uses `runChunkedRead(...)`

Feature 023 did not materially redesign duplicate detection semantics.

### Feature 024 impact

Feature 024 introduced the meaningful upload-path changes:
- batch prepare route
- batch finalize route
- persisted client manifest/queue
- bounded parallel upload flow
- size-prefiltered hashing in `assets-upload-form.tsx`

The most important duplicate-behavior change is in the client:
- preflight pass 1 now determines which files are hashed at all
- only files whose size matches an existing DB asset size are hashed
- duplicate policy UI only appears if `duplicateHashes` comes back from the second preflight

This is the clearest regression point.

## 4. Current duplicate detection behavior

### Preflight route behavior today

`src/app/api/projects/[projectId]/assets/preflight/route.ts`:
- authenticates user
- resolves tenant server-side
- scopes queries to `(tenant_id, project_id, asset_type)`
- first computes `candidateSizes` by querying existing `assets.file_size_bytes`
- then computes `duplicateHashes` by querying existing `assets.content_hash`

Important current behavior:
- preflight only compares against rows already in the database
- it does not compare files within the current selection/batch
- it does not compare against other in-memory manifest items

### Client duplicate behavior today

`src/components/projects/assets-upload-form.tsx`:
- `initialPreflight = await preflightForItems(chunkIds, false)`
- `candidateSizeSet` controls `needsHash`
- only `needsHash` items get `hashFile(file)`
- `duplicatePreflight = await preflightForItems(chunkIds, true)`
- `isDuplicate` is only set from `duplicateHashSet.has(item.contentHash)`

Implication:
- if a file never gets hashed, it can never be marked duplicate in the client
- that same file will then be sent to batch prepare with `contentHash = null`

### Server create behavior today

`createAssetWithIdempotency(...)` only runs duplicate lookup if:
- `contentHash` is present
- and `duplicatePolicy !== "upload_anyway"`

Current duplicate lookup:
- scoped to `(tenant_id, project_id, asset_type, content_hash)`
- `limit(1)` for existence check
- no status filter

Current duplicate policy effects:
- `ignore`: return `skipUpload: true`, no new DB row
- `overwrite`: archive matching non-archived rows in the same project and create a new asset row
- `upload_anyway`: always create a new asset row

Critical implication:
- if `contentHash` is null, the server performs no duplicate check at all

## 5. Verified current regression behavior

### Primary verified regression

The current size-prefiltered batch flow can miss duplicates because size prefiltering is being used as the gate for whether a content hash exists at all.

Concrete path:

1. selected file has no matching `file_size_bytes` among existing DB assets
2. client does not hash the file
3. second preflight has no hash to compare
4. UI never pauses for duplicate policy
5. batch prepare sends `contentHash = null`
6. `createAssetWithIdempotency(...)` does no duplicate lookup
7. duplicate is missed

This is a verified code-path behavior, not a guess.

### Same-batch duplicates are currently missable

If two identical files are uploaded together in the same batch and there is no already-existing asset of that size in the project:
- preflight sees no `candidateSizes`
- neither file is hashed
- neither file is marked duplicate
- both go through with `duplicatePolicy = upload_anyway`
- server-side duplicate enforcement is bypassed because `contentHash` is null for both

The current preflight route never compares current batch items with each other, so same-batch duplicates are a concrete regression risk.

### Cross-batch / concurrent-batch duplicates are currently missable

If two concurrent batches both introduce the same new file and neither batch sees an existing DB row of that size yet:
- both preflight calls return no candidate size
- both clients skip hashing
- both create requests send `contentHash = null`
- neither batch gets server duplicate enforcement

This means the regression is not only same-batch. It also affects some cross-batch races.

### What is not the primary bug

Not primary:
- delayed finalize
- delayed `uploaded_at`
- hash persistence after finalize

Why:
- when a hash exists, `createAssetWithIdempotency(...)` already writes `content_hash` at create time on the pending row
- duplicate decisions do not depend on finalize

So this is not mainly a finalize-ordering regression. It is mainly a hash-availability regression caused by the new prefilter usage.

## 6. Byte-size prefilter analysis

### Is size-first filtering theoretically safe?

Yes, as an algorithmic optimization:
- if two files are byte-for-byte identical, they must have the same file size
- therefore it is safe to eliminate impossible duplicate candidates by size before comparing hashes

So the optimization itself is sound.

### Why the current implementation can still miss duplicates

The implementation problem is not the theory. It is the candidate set.

Current candidate set for hashing is:
- files whose size matches an already-existing asset size in the DB

That is not the same as:
- files that might be duplicates of anything relevant to the upload operation

It excludes:
- duplicates within the current selection
- duplicates in concurrent batches that have not yet created rows visible to preflight
- duplicates when the first relevant copy has not yet been written to the database at preflight time

### Conclusion on the prefilter

The size-prefilter optimization is algorithmically safe.

The current regression is caused by how the optimization is applied:
- it determines whether hashes exist at all
- not merely whether hash comparisons are needed against a complete known candidate corpus

This is the most important research conclusion.

## 7. Batch / concurrency / race behavior

### Same-batch duplicates

Current behavior:
- can be missed by preflight
- server can only catch them if hashes are present
- current client often withholds hashes for same-batch duplicates because there is no DB size candidate yet

### Cross-batch duplicates

Current behavior:
- can be missed if two batches preflight before either creates a hash-bearing pending row
- once a hash-bearing row exists in DB, later batches can detect it

### Pending vs uploaded assets

Current duplicate lookup in `createAssetWithIdempotency(...)` does not filter by `status`.
So if a row with the same `content_hash` exists and the client supplies the hash, duplicate detection can see:
- pending assets
- uploaded assets
- archived assets

This is important:
- hash persistence timing is not the main problem
- missing hashes are the main problem

### Overwrite / ignore race behavior

Current behavior:
- `ignore` skips upload if a matching hash is found
- `overwrite` archives matching non-archived assets by hash, regardless of whether they were fully uploaded or still pending

That is the current behavior, not necessarily the intended final policy model.

## 8. Current schema involved

### `assets`

Relevant fields:
- `tenant_id`
- `project_id`
- `asset_type`
- `file_size_bytes`
- `status` (`pending`, `uploaded`, `archived`)
- `uploaded_at`
- `archived_at`
- `content_hash`
- `content_hash_algo`

Relevant indexes / constraints:
- unique `(tenant_id, project_id, storage_path)`
- index `assets_tenant_project_created_at_idx`
- index `assets_tenant_project_content_hash_idx`

### Batch state

There is no dedicated server-side upload batch table.

Batch state exists client-side only:
- `ProjectUploadManifest`
- persisted in `localStorage`

### Idempotency

Server-side create idempotency uses `idempotency_keys`:
- operation key `create_project_asset:${projectId}`
- stable per-file idempotency keys

This supports retry safety, but not duplicate inference when `contentHash` is absent.

## 9. Existing tests and coverage gaps

### Existing coverage

`tests/feature-024-upload-performance-resumability.test.ts` covers:
- prepare batch size caps
- finalize batch size caps
- idempotent prepare retry
- finalize retry safety
- manifest persistence/recovery
- queue chunking

`tests/feature-023-request-uri-safety.test.ts` covers:
- request size safety helpers
- consent array bounds
- manual link/unlink bounds

### Verified gaps

No current tests cover:
- same-batch duplicate files
- cross-batch duplicate files
- same-size duplicate files in the same batch
- same-size non-duplicate files in the same batch
- preflight candidate-size logic vs duplicate correctness
- duplicates when one item is not yet finalized
- duplicate behavior when hashes are omitted by the client
- concurrent upload scenarios

This is a clear test-gap / false-confidence category.

## 10. Candidate root-cause categories

### 1. Query scope regression

Verified:
- preflight only checks existing DB assets
- it does not include current batch state
- it does not include other in-flight client items

This is a concrete regression source.

### 2. Batching state regression

Verified:
- Feature 024 introduced batch manifest + batched prepare/finalize
- duplicate UX is now driven by a batch-level preflight decision
- that batch-level preflight does not reason about same-batch duplicates

This is a concrete regression source.

### 3. Concurrency / race regression

Verified:
- concurrent batches can both skip hashing if no existing same-size asset is yet in DB
- server cannot enforce duplicates without `contentHash`

This is a concrete regression source.

### 4. Byte-size prefilter bug

Not algorithmically, yes operationally.

Verified:
- size-first elimination is theoretically safe
- the bug is that size-prefiltering is currently used to decide whether the hash exists at all

So the issue is not “size prefilter is wrong.”
The issue is “size prefilter is currently applied too early and too narrowly.”

### 5. Hash persistence timing bug

Not primary.

Verified:
- when hashes exist, they are written on create before finalize
- server duplicate lookup can see pending assets

### 6. Policy handling bug

Verified:
- duplicate policy UI only appears when client preflight finds duplicates
- default path remains `upload_anyway`
- if preflight misses duplicates, policy never changes and server duplicate handling is bypassed

This is a real contributing factor.

### 7. Test gap / false confidence

Verified:
- there are no regression tests for same-batch or concurrent duplicate detection

## 11. Security and tenancy

Current security properties are correct and should be preserved in any fix:
- duplicate queries are tenant/project scoped
- tenant is resolved server-side from auth/session
- project access is validated server-side
- no client-provided tenant IDs are trusted
- overwrite/ignore decisions stay within the same `(tenant_id, project_id, asset_type)` scope

Any eventual fix must keep duplicate enforcement server-authoritative where possible.

## 12. Planning recommendation

The likely fix belongs mainly in:
- batched upload orchestration
- duplicate query / hash-availability logic
- tests

Not mainly in:
- finalize ordering
- schema redesign

### Smallest realistic fix path for one RPI cycle

The plan should evaluate a bounded combined fix:

1. Keep size-prefiltering, but do not use existing-DB-size matches as the only reason to compute hashes.
2. At minimum, also hash files when their size collides with another file in the current selection/batch.
   - this closes the clearest same-batch regression
3. Make batch prepare explicitly aware of same-request duplicate hashes when hashes are provided, so same-batch duplicate handling is deterministic server-side too.
4. Add focused regression tests for:
   - same-batch exact duplicates
   - same-size non-duplicates
   - duplicates across retries / overlapping batches where hashes exist
   - missed duplicates when hash is absent

### Planning tradeoff to decide explicitly

The plan should explicitly decide between:

- Option A: keep optimization, hash same-size-within-current-selection files plus DB-size-candidate files
  - smallest bounded fix
  - closes the most obvious regression
  - may still leave some concurrent-batch blind spots

- Option B: restore all-file hashing for project photo uploads
  - strongest correctness
  - simplest mental model
  - larger performance cost

- Option C: hybrid
  - hash all files only when duplicate policy enforcement matters, or when batches overlap / duplicate risk is high
  - likely too large for one bounded fix cycle unless carefully reduced

Based on current code, the plan should start with Option A vs Option B explicitly.

The central question for planning is:
- do we want the smallest fix that restores same-batch correctness while keeping the optimization, or
- do we want to re-prioritize authoritative duplicate detection over the client CPU savings introduced in 024?

No code changes were made during this research.
