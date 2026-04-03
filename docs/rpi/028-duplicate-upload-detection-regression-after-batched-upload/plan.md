# Feature 028 Plan: Restore Authoritative Duplicate Detection for Batched Uploads

## Chosen architecture

Recommended option: **Option B, all-file hashing with server-authoritative duplicate handling**

This feature should restore duplicate-detection correctness by making sure every uploaded project photo has a `contentHash` before duplicate policy decisions are made.

Chosen strategy:
- hash **every selected project photo file** before prepare/create decisions
- store and send `contentHash` for all batch items
- keep uploaded assets stored with a hash
- check new uploads against existing DB assets using that hash
- add **same-request duplicate-hash validation in batch prepare** so duplicates inside the same batch are handled deterministically server-side
- keep DB duplicate enforcement in `createAssetWithIdempotency(...)` authoritative for existing rows
- preserve the batched prepare/finalize, resumability, and fewer-request architecture from Feature 024
- explicitly verify retry/idempotency and concurrent create behavior in tests/documentation

Why this is preferred:
- aligns with the product goal of **maximal duplicate-detection correctness**
- removes “hash availability” as the main regression source
- keeps the main performance gains from Feature 024:
    - batched prepare/finalize
    - fewer authorization/setup requests
    - resumability
    - queue/manifest behavior
- gives the simplest mental model:
    - every file is hashed
    - every file can be duplicate-checked
    - the server no longer depends on a client heuristic to know whether duplicate detection is possible

Explicitly deferred:
- broad upload-architecture redesign
- new server-side batch persistence tables
- finalize-ordering redesign
- public headshot upload redesign
- broad schema redesign beyond what already exists

## Option comparison

### Option A: Expanded size-prefilter hashing

Shape:
- hash files when their size matches an existing DB asset size
- also hash files when their size collides with another file in the current selection

Pros:
- smaller client-side change
- preserves more client CPU savings

Cons:
- still allows files with no hash
- does not align with the goal of authoritative duplicate detection
- still leaves blind spots whenever hash availability is missing
- more complex mental model

### Option B: All-file hashing

Shape:
- hash every selected project photo before duplicate policy decisions
- batch prepare/server create use hashes for all items

Pros:
- strongest correctness
- simplest mental model
- removes the current regression source entirely
- makes server-side duplicate detection possible for every uploaded file
- best aligns with the stated product goal

Cons:
- adds browser CPU/file-read cost back into the upload path
- increases pre-upload preparation time for large batches

### Option C: Bounded combined fix

Shape:
- keep selective hashing
- add same-request server validation
- patch the most obvious regression points

Pros:
- smaller than Option B
- preserves more client CPU savings

Cons:
- still not fully aligned with the “detect all duplicates” goal
- keeps complexity around when hashes exist vs do not exist
- still leaves correctness dependent on optimization heuristics

## Correctness target

This feature must guarantee:

1. **Every uploaded project photo file gets a `contentHash` before duplicate policy decisions**
    - duplicate checking must not depend on DB-size-prefilter heuristics

2. **Exact duplicates within the same selected batch**
    - must be detected
    - duplicate policy UI must be able to apply to them
    - batch prepare must handle them deterministically server-side

3. **Duplicates against existing DB assets in the same project**
    - must be detected using `contentHash`
    - this includes existing `pending` and `uploaded` rows with matching hashes, because current server duplicate queries already see them

4. **Duplicates across retry/replay where a hash-bearing pending row already exists**
    - must continue to be detected
    - idempotency behavior must remain stable

5. **Same-size non-duplicates**
    - may still have the same byte size
    - must not be treated as duplicates unless their hashes match

### Important concurrency note

This feature should make duplicate detection authoritative for all uploaded files by ensuring hashes always exist.

The plan should also explicitly verify concurrent create behavior:
- same-request duplicates must be handled deterministically server-side
- overlapping uploads with the same hash must be tested/documented against current idempotent create behavior
- if implementation review proves a remaining true server race on same-hash creation, that must be called out clearly rather than silently claiming stronger guarantees than the code provides

## Hashing / preflight behavior changes

### Current problem

Current batch uploader hashes files only when `fileSizeBytes` matches DB `candidateSizes`.

That is too narrow because it means:
- some files never get hashed
- server duplicate detection is skipped for those files
- same-batch and some concurrent duplicates are missed

### Planned behavior

For project photo uploads:
- hash **every selected file** before duplicate policy handling
- persist `contentHash` in the manifest for all items
- send `contentHash` for all items to batch prepare/create

### Preflight role after this change

The existing preflight route may remain for bounded compatibility and UI flow, but:
- it should no longer decide whether a file gets hashed at all
- `candidateSizes` may remain available, but not as a gate for hash existence
- duplicate policy decisions should now rely on universal hash availability rather than selective hashing

### Why this is acceptable

Feature 024’s main gains were likely:
- batched prepare/finalize
- fewer auth/setup requests
- resumability/manifest recovery
- parallelized upload orchestration

This feature reintroduces browser hashing cost, but does **not** discard the main network/request architecture improvements from Feature 024.

## Client vs server responsibility

### Client responsibilities

The client is responsible for:
- hashing every selected project photo file before prepare/create
- storing `contentHash` in manifest state
- surfacing duplicate policy UI
- preserving `duplicatePolicy`, `contentHash`, and manifest recovery behavior

### Server responsibilities

The server must remain authoritative for:
- duplicate detection against existing DB rows in `createAssetWithIdempotency(...)`
- same-request duplicate-hash validation in batch prepare
- deterministic handling of `ignore`, `overwrite`, and `upload_anyway`
- tenant/project scoping
- retry-safe idempotent create behavior

### Why server-side same-request validation is required

Even if the client already hashes every file and flags duplicates:
- the server must still validate same-request collisions
- this protects against client bugs/regressions
- this makes duplicate handling deterministic and server-enforced
- it keeps business-critical behavior off the browser trust boundary

## Batch-scope duplicate handling

### Detection

Same-batch exact duplicates should be detected:
- client-side for UX, because every item has a hash
- server-side in `prepareProjectAssetBatch(...)` by grouping request items by normalized hash

### Deterministic handling model

For same-request duplicate hashes, batch prepare should use request order as the deterministic tie-break:
- first item with a given hash is treated as the batch “first”
- later items with the same hash are treated as duplicates of that first item

This is bounded, deterministic, and easy to test.

### Policy behavior within a single batch

#### `upload_anyway`
- all items remain eligible for creation
- same-batch duplicates are still surfaced in the UI
- server allows all through

#### `ignore`
- first item with a hash proceeds
- later same-request duplicates return `skipped_duplicate`
- no new asset rows for skipped duplicates

#### `overwrite`
- first item with a hash proceeds
- later same-request duplicates in the same request are also treated as duplicates and skipped from create in this cycle

Reason:
- `overwrite` should remain about replacing existing DB duplicates
- redefining it to archive earlier siblings inside the same request would add extra complexity and confusing semantics
- for this cycle, deterministic skip of later same-request duplicates is safer

This rule must be explicitly implemented and tested.

## Server-side validation changes

### `prepareProjectAssetBatch(...)`

Primary server-side change belongs here.

Add same-request duplicate grouping:
- normalize incoming `contentHash`
- group items by hash when hash is present
- detect duplicate hashes within the same batch request
- apply deterministic request-order policy handling before calling `createAssetWithIdempotency(...)`

Behavior:
- items skipped due to same-request `ignore` / `overwrite` handling should return the existing `skipped_duplicate` result shape
- only items that should actually create or reuse an asset row should call `createAssetWithIdempotency(...)`

### `createAssetWithIdempotency(...)`

Keep the existing DB duplicate query logic largely unchanged:
- duplicate lookup stays keyed by `(tenant_id, project_id, asset_type, content_hash)`
- no finalize-ordering redesign
- no schema redesign

But because hashes will now always be present for project photo uploads, this path becomes authoritative much more often.

Small refactors are acceptable if helpful, for example:
- extracting duplicate lookup into a small helper
- clarifying status handling in comments
- tightening normalization/validation of incoming hashes

### `preflight` route

Keep the route contract unchanged unless implementation proves a small simplification is clearly beneficial.

This feature should not redesign preflight.
The important behavior change is:
- preflight no longer decides whether a file gets hashed

## Behavior for duplicate policies

### `upload_anyway`

Against existing DB duplicates:
- unchanged
- create helper creates a new asset row

Within the same batch:
- duplicates are identified for UX
- prepare continues all items

### `ignore`

Against existing DB duplicates:
- unchanged
- `createAssetWithIdempotency(...)` returns `skipUpload: true`

Within the same batch:
- first item proceeds
- later same-request duplicates are skipped in batch prepare

### `overwrite`

Against existing DB duplicates:
- unchanged
- matching DB rows are archived and a new asset row is created

Within the same batch:
- first item proceeds
- later same-request duplicates are skipped in batch prepare in this cycle

This is a deliberate bounded simplification.

## Scope of changes

### In scope now

- `src/components/projects/assets-upload-form.tsx`
- possibly small hashing-related helpers used by the uploader
- `src/lib/assets/prepare-project-asset-batch.ts`
- possibly small clarity/refactor changes in `src/lib/assets/create-asset.ts`
- focused regression tests in the upload test suite

### Explicitly out of scope

- schema changes
- finalize helper redesign
- batch finalize redesign
- new server-side batch tables
- public headshot upload redesign
- broad concurrent-upload coordination redesign

## Schema / migration impact

No schema changes are needed.

Why:
- `assets.content_hash` and `content_hash_algo` already exist
- duplicate lookup index already exists
- hashes are already stored on create when provided
- the regression is in hash availability and batch orchestration, not missing schema

## Implementation phases

### Phase 1: Restore all-file hashing in the batch client flow

Update `assets-upload-form.tsx` so:
- every selected project photo file is hashed before duplicate policy decisions
- manifest items persist `contentHash` for all files
- existing queue/resumability behavior is preserved

Keep:
- current batch prepare/finalize architecture
- current manifest structure as much as possible
- current retry/recovery flow

### Phase 2: Add same-request duplicate validation in batch prepare

Update `prepareProjectAssetBatch(...)` to:
- group request items by normalized hash
- detect same-request duplicates deterministically
- apply request-order handling for `ignore` and `overwrite`
- allow all through for `upload_anyway`
- only call `createAssetWithIdempotency(...)` for items that should proceed

### Phase 3: Tighten helper clarity where needed

Make only small changes in `createAssetWithIdempotency(...)` if useful to:
- clarify duplicate lookup behavior
- clarify treatment of `pending` / `uploaded` / `archived`
- keep logic explicit and reviewable

Do not redesign create semantics.

### Phase 4: Add focused regression tests

Add regression coverage for:
- same-batch exact duplicates
- same-batch same-size non-duplicates
- duplicates against existing DB assets
- duplicates against existing pending rows with hashes
- behavior when all files are hashed
- prepare retry/idempotency safety
- overlapping/replay cases where hashes already exist

### Phase 5: Verify unchanged batching/resumability behavior

Re-run targeted upload tests to ensure:
- batch prepare still reuses idempotency keys correctly
- batch finalize remains unchanged
- manifest persistence/recovery still works
- resumability behavior is not broken

## Test plan

Focused regression coverage should include:

1. **Same-batch exact duplicates**
    - two items in one prepare batch with same hash
    - `ignore` skips later items
    - `upload_anyway` allows both
    - `overwrite` skips later same-request duplicates in this cycle

2. **Same-batch same-size non-duplicates**
    - both are hashed
    - neither is skipped as duplicate

3. **Duplicates against existing DB assets**
    - existing row with same hash in same tenant/project
    - prepare/create should respect `ignore` / `overwrite`

4. **Duplicates against existing pending rows**
    - pending row with same hash already exists
    - create helper should still detect the duplicate

5. **Behavior when all files are hashed**
    - client path proves every selected project photo gets a hash before prepare/create

6. **Retry/idempotency safety**
    - prepare retry for the same surviving item reuses the same asset
    - skipped duplicate items do not create extra asset rows

7. **Overlapping/replay safety with hashes present**
    - where a hash-bearing row already exists, later duplicate handling remains correct

Prefer extending `tests/feature-024-upload-performance-resumability.test.ts` rather than creating a broad new integration suite, unless implementation clearly needs one additional focused test file.

## Risks and tradeoffs

### Client CPU cost vs correctness

Tradeoff:
- hashing every file increases browser CPU and file-read work

Chosen balance:
- accept the hashing cost to restore authoritative duplicate detection
- retain the main batching/network gains from Feature 024

### Server-authority vs complexity

Tradeoff:
- pure client hashing alone is not enough
- server-side same-request validation adds some prepare complexity

Chosen balance:
- client always provides hashes
- server validates same-request duplicates and existing DB duplicates

### Same-batch determinism

Tradeoff:
- deterministic “first item wins” is simple
- richer sibling-overwrite semantics would be more complex

Chosen balance:
- first item wins
- later same-request duplicates are skipped for `ignore` and `overwrite`

### Concurrent-upload edge cases

Tradeoff:
- all-file hashing greatly improves duplicate detection
- true concurrent create races must still be verified honestly

Chosen balance:
- make hashes universally available
- make same-request handling deterministic
- rely on current idempotent create path for existing-row detection
- explicitly test/document remaining concurrency behavior rather than over-claiming

### Scope creep risk

High-risk directions to avoid:
- redesigning finalize ordering
- adding new server-side batch persistence
- rewriting all duplicate detection surfaces
- broad public upload changes

## Why this plan aligns with the product goal

This plan aligns with the stated goal because:
- every project photo upload is hashed
- duplicate detection no longer depends on a size-gated heuristic
- same-batch duplicates are handled deterministically server-side
- DB duplicate checks remain authoritative
- the main Feature 024 performance architecture remains intact

This is the strongest realistic one-cycle plan for “detect all duplicates” without redesigning the upload system.

## Implementation prompt

Implement Feature 028 as an authoritative duplicate-detection fix for the batched project photo uploader.

Read first:
- `docs/rpi/028-duplicate-upload-detection-regression-after-batched-upload/research.md`
- `docs/rpi/028-duplicate-upload-detection-regression-after-batched-upload/plan.md`

Implement only the chosen plan:
- update `src/components/projects/assets-upload-form.tsx` so every selected project photo file is hashed before duplicate policy decisions
- preserve the existing batch prepare/finalize, manifest persistence, resumability, and queue architecture
- update `src/lib/assets/prepare-project-asset-batch.ts` to detect same-request duplicate `contentHash` values and handle them deterministically by request order
- for same-request duplicates:
    - `upload_anyway`: allow all items through
    - `ignore`: first item proceeds, later duplicates return `skipped_duplicate`
    - `overwrite`: first item proceeds, later duplicates also return `skipped_duplicate` in this cycle
- keep `src/lib/assets/create-asset.ts` DB duplicate enforcement unchanged except for small refactors/clarifications if needed
- do not add schema changes
- do not redesign finalize flow

Add focused regression tests for:
- same-batch exact duplicates
- same-batch same-size non-duplicates
- duplicates against existing DB assets
- duplicates against existing pending rows with hashes
- all-file hashing behavior
- retry/idempotency safety

Run the targeted upload tests and summarize:
- what changed
- what was verified
- what remains intentionally deferred