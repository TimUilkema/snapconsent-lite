# Feature 029 Plan: Complete Bounded Matching Fan-Out

## Inputs And Ground Truth

This plan is based on:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- verified research in `docs/rpi/029-complete-bounded-matching-fanout/research.md`
- prior intent docs in:
  - `docs/rpi/019-face-materialization-deduped-embedding-pipeline/*`
  - `docs/rpi/020-materialized-headshot-resolution-bug/*`
  - `docs/rpi/025-matching-queue-robustness/*`
  - `docs/rpi/026-prevent-partial-materialization-orchestration-failures/*`

Repository code and current schema are the source of truth. This plan is grounded in the verified current implementation in:

- `src/app/api/internal/matching/worker/route.ts`
- `src/app/api/internal/matching/reconcile/route.ts`
- `src/app/api/internal/matching/repair/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`
- `src/app/i/[token]/consent/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts`
- `src/lib/assets/finalize-project-asset-batch.ts`
- `src/lib/matching/auto-match-config.ts`
- `src/lib/matching/auto-match-jobs.ts`
- `src/lib/matching/auto-match-worker.ts`
- `src/lib/matching/auto-match-reconcile.ts`
- `src/lib/matching/auto-match-repair.ts`
- `src/lib/matching/face-materialization.ts`
- `src/lib/matching/materialized-face-compare.ts`
- `src/lib/matching/project-matching-progress.ts`
- `supabase/migrations/20260306130000_010_auto_match_backbone_schema.sql`
- `supabase/migrations/20260306131000_010_auto_match_queue_functions.sql`
- `supabase/migrations/20260320140000_019_face_materialization_pipeline.sql`
- `supabase/migrations/20260327120000_023_request_uri_safety.sql`
- `supabase/migrations/20260327150000_025_matching_pipeline_robustness.sql`
- `tests/feature-010-auto-match-backbone.test.ts`
- `tests/feature-019-face-materialization-pipeline.test.ts`
- `tests/feature-021-project-matching-progress.test.ts`

## Verified Current State

The current repo already has the right durable substrate for replay-safe matching:

- materializations are immutable and versioned by `materializer_version`
- compare outcomes are immutable and versioned by `(consent_id, asset_id, headshot_materialization_id, asset_materialization_id, compare_version)`
- queue rows are tenant-scoped, deduped by `(tenant_id, project_id, dedupe_key)`, and lease-safe after Feature 025
- materialization and compare writes are already upsert-based and retry-safe

The actual completeness bug is in fan-out orchestration, not in pair execution:

- raw mode truncates in `resolveJobCandidates(...)` by loading at most `MAX_MATCH_CANDIDATES` opposite-side rows and then `slice(0, maxComparisonsPerJob)`
- materialized mode truncates in `processMaterializeAssetFacesJob(...)` by loading a bounded opposite-side list and then stopping after the first bounded loop
- `runProjectMatchingRepair(...)` and `runAutoMatchReconcile(...)` can requeue intake/materialize work, but they still feed the same truncating fan-out path

Old behavior:

- `maxComparisonsPerJob` is a terminal cap
- one source item fans out to the first bounded slice only
- large projects depend on unrelated later uploads or manual repair luck to fill missed pairs

New behavior required by this feature:

- `maxComparisonsPerJob` becomes a continuation batch size
- one source item creates a durable bounded backfill that keeps paging until its fixed boundary is exhausted
- new arrivals are handled by their own intake events instead of widening older backfills

## Options Considered

### Option A: Remove the limit

Pros:

- smallest code diff
- fixes the immediate truncation symptom

Cons:

- one intake job can explode to tens of thousands of opposite-side reads and queue writes
- fairness across projects gets worse
- lease timeout risk increases
- repair/replay becomes heavier, not safer

### Option B: Create all pair backlog rows immediately

Pros:

- explicit durable pair backlog
- no cursor logic during fan-out execution

Cons:

- every new consent or photo would write one durable row per opposite-side item immediately
- large projects would amplify writes and storage for work the repo already models in `asset_consent_face_compares`
- headshot replacement, revocation, replay, and cancellation would need mass backlog reset or cancellation logic
- it duplicates state the repo already tracks better at the materialization and compare layers

### Option C: Dedicated durable continuation table plus bounded keyset fan-out

Pros:

- preserves bounded work per batch
- keeps compare jobs as the execution unit
- stores only one durable row per source version/direction instead of one row per pair
- keeps repair/backfill explicit without re-comparing existing versioned pairs by default
- fits the current repo architecture and queue hardening

Cons:

- adds one new internal state machine
- requires new claim/complete/fail SQL for continuation rows
- requires paginated opposite-side loaders instead of today's limit-only helpers

## Recommendation

Choose **Option C**.

This repo already has durable materializations, version-aware compare dedupe, and lease-safe job claiming. The missing piece is a durable continuation model for bounded opposite-side pagination.

It is preferred over Option B because the repo does not need one durable row per pair up front. `asset_consent_face_compares` already holds durable completed pair state, and `face_match_jobs` already dedupes versioned compare execution. A pair-backlog table would add avoidable write amplification, replay reset logic, and cancellation complexity.

It is preferred over Option A because "remove the cap" would trade correctness for operational fragility.

## Chosen Architecture

### Summary

Implement **tenant-scoped durable fan-out continuations** that page a fixed opposite-side boundary over multiple bounded batches while keeping `materialize_asset_faces` and `compare_materialized_pair` as the execution flow.

The model is:

1. Intake captures a fixed opposite-side boundary snapshot in the intake job payload.
2. `materialize_asset_faces` ensures the source materialization exists, then creates or resets one or more continuation rows.
3. The worker claims continuation rows separately from `face_match_jobs`.
4. Each continuation batch keyset-pages the next eligible opposite-side items up to `maxComparisonsPerJob`.
5. Each batch only enqueues missing compare work for versioned pairs that do not already have a current compare row.
6. If an opposite-side materialization is missing, the batch nudges its `materialize_asset_faces` job instead of recomputing anything inline.
7. The continuation row advances its cursor only after all enqueue work for the batch succeeds.
8. When the boundary is exhausted, the continuation is completed.

### Old vs New

Old:

- one `materialize_asset_faces` run loads the first `N` opposite-side items and exits permanently
- `N` is a truncation cap

New:

- one source version creates a continuation row with a fixed boundary
- each worker batch processes the next `N` opposite-side items
- `N` is a continuation batch size, not a terminal cap

### Why This Is Better Than Upfront Pair Creation

This repo already has durable completed-pair state in `asset_consent_face_compares` and durable compare execution dedupe in `face_match_jobs`.

The continuation design keeps durable state proportional to:

- one source photo materialization, or
- one source consent/headshot materialization plus consent

It does **not** create one durable backlog row per pair at intake time.

That is materially safer here because:

- headshot replacement only needs to supersede one continuation row, not cancel thousands of pair rows
- revocation/opt-out only needs to stop future continuation batches
- repair can reset a continuation boundary instead of rewriting a pair backlog
- already-compared versioned pairs can be skipped from the compare table directly

### Scope Boundary

In scope now:

- materialized pipeline completeness
- durable bounded continuation state
- intake-time boundary snapshots
- keyset pagination for both fan-out directions
- continuation claim/retry/lease safety
- completeness repair that fills missing versioned pairs without re-comparing existing ones by default
- progress reporting that stays active while continuations are draining

Deferred:

- exact pair-level percentage progress in the UI
- broad admin tooling for continuation inspection
- a separate full compare replay mode unless implementation proves Feature 025's existing repair semantics still need one explicit flag
- deeper redesign of the raw pipeline beyond removing its truncating helper calls if raw remains enabled

### Raw-Mode Guardrail

The current `raw` branch in `resolveJobCandidates(...)` is verified to have the same truncation bug.

Feature 029 is architected around the materialized pipeline because that is where the repo's repair, replay, and current tests are concentrated. Do not leave the raw branch on the old `slice()` behavior after shipping this feature. Either:

- make raw consume the same paginated continuation helpers before direct matching, or
- explicitly stop shipping raw mode in deploy config and tests in the same change.

Do not fix `materialized_apply` and leave `raw` silently truncating.

## Schema / DB Changes

### 1. New `public.face_match_fanout_continuations` table

Add a dedicated continuation table, for example:

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null`
- `project_id uuid not null`
- `direction text not null`
  - `photo_to_headshots`
  - `headshot_to_photos`
- `source_asset_id uuid not null`
- `source_consent_id uuid null`
  - required for `headshot_to_photos`
  - null for `photo_to_headshots`
- `source_materialization_id uuid not null`
- `source_materializer_version text not null`
- `compare_version text not null`
- `boundary_snapshot_at timestamptz not null`
- `boundary_sort_at timestamptz not null`
- `boundary_asset_id uuid null`
- `boundary_consent_id uuid null`
- `cursor_sort_at timestamptz null`
- `cursor_asset_id uuid null`
- `cursor_consent_id uuid null`
- `dispatch_mode text not null default 'normal'`
  - `normal`
  - `backfill_repair`
  - optional explicit replay mode only if implementation proves it is still needed
- `status text not null default 'queued'`
  - `queued`
  - `processing`
  - `completed`
  - `superseded`
  - `dead`
- `attempt_count integer not null default 0`
- `max_attempts integer not null default 5`
- `run_after timestamptz not null default now()`
- `locked_at timestamptz`
- `locked_by text`
- `lock_token uuid`
- `lease_expires_at timestamptz`
- `reclaim_count integer not null default 0`
- `started_at timestamptz`
- `completed_at timestamptz`
- `last_error_code text`
- `last_error_message text`
- `last_error_at timestamptz`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Rationale:

- this is the explicit durable state missing today
- cursor state does not belong hidden in a materialize-job payload
- separate continuation leasing avoids overloading `face_match_jobs` with a second scheduler responsibility

### 2. Continuation uniqueness

Add partial unique indexes so duplicate intake or retry does not create duplicate continuations:

- unique `(tenant_id, project_id, direction, source_materialization_id, compare_version)` where `direction = 'photo_to_headshots'`
- unique `(tenant_id, project_id, direction, source_materialization_id, source_consent_id, compare_version)` where `direction = 'headshot_to_photos'`

This preserves:

- one durable continuation per source photo version
- one durable continuation per consent plus source headshot version

### 3. Continuation claim / complete / fail functions

Add continuation SQL functions mirroring the current queue hardening:

- `app.enqueue_face_match_fanout_continuation(...)`
- `app.claim_face_match_fanout_continuations(...)`
- `app.complete_face_match_fanout_continuation_batch(...)`
- `app.fail_face_match_fanout_continuation(...)`

Add public service-role wrappers like Feature 025 does for `face_match_jobs`.

Required behavior:

- claim queued or stale-processing continuation rows
- guard complete/fail with `lock_token`
- allow a batch to either:
  - move back to `queued` with an advanced cursor, or
  - move to `completed` / `superseded`

### 4. Intake boundary helper functions

Add SQL helpers for fixed opposite-side boundaries:

- `app.get_photo_fanout_boundary(...)`
  - latest eligible uploaded photo in `(uploaded_at, id)` order
- `app.get_current_consent_headshot_fanout_boundary(...)`
  - latest eligible consent in `(consent.created_at, consent.id)` order
  - boundary is evaluated against the current headshot as of `boundary_snapshot_at`

Add paginated read helpers:

- `app.list_uploaded_project_photos_page(...)`
- `app.list_current_project_consent_headshots_page(...)`

Do not overload the current limit-only `list_current_project_consent_headshots(...)` into ambiguous behavior. Add a paginated variant or a clearly versioned extension.

### 5. New and updated indexes

Add:

- continuation claim index on `(status, run_after, lease_expires_at)`
- continuation project/source lookup indexes
- partial photo fan-out index on `assets (tenant_id, project_id, uploaded_at, id)` where:
  - `asset_type = 'photo'`
  - `status = 'uploaded'`
  - `archived_at is null`
- partial consent fan-out index on `consents (tenant_id, project_id, created_at, id)` where:
  - `face_match_opt_in = true`
  - `revoked_at is null`
- `asset_consent_links (tenant_id, project_id, consent_id, asset_id)` for current-headshot paging joins

No new uniqueness or index is required on:

- `asset_face_materializations`
- `asset_face_materialization_faces`
- `asset_consent_face_compares`

Those tables already have the versioned uniqueness this feature needs.

### 6. Progress SQL change

Update `app.get_project_matching_progress(...)` so `is_matching_in_progress` is true when either of these are active:

- existing `face_match_jobs` are queued or have a valid lease
- `face_match_fanout_continuations` are queued or have a valid lease

No change is required to `processed_images` semantics in this feature.

## Intake Changes

### 1. Photo finalize

In:

- `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`
- `src/lib/assets/finalize-project-asset-batch.ts`

When enqueueing `photo_uploaded`, capture and persist a boundary snapshot in the intake payload:

- `boundarySnapshotAt`
- `boundaryConsentCreatedAt`
- `boundaryConsentId`

The snapshot must be derived server-side from the current eligible consent/headshot set for the project.

Duplicate or retried enqueue must not widen the boundary:

- `enqueue_face_match_job(...)` already preserves the first row on dedupe conflict
- that existing intake row becomes the durable intake-time boundary snapshot

### 2. Consent submit and headshot replacement

In:

- `src/app/i/[token]/consent/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts`

When enqueueing `consent_headshot_ready`, capture and persist:

- `boundarySnapshotAt`
- `boundaryPhotoUploadedAt`
- `boundaryPhotoAssetId`

This is the fixed photo-side boundary for that consent/headshot intake event.

### 3. Reconcile

`runAutoMatchReconcile(...)` remains recent-window repair.

When reconcile requeues recent intake rows, it should:

- recompute a fresh current boundary snapshot
- store that boundary in the requeued intake payload
- use `backfill_repair` semantics, not eager compare replay semantics

### 4. Repair

`runProjectMatchingRepair(...)` should stay project-scoped and server-only, but become paginated instead of one-shot:

- add keyset cursor inputs for the photo scan and current-headshot scan
- return `hasMore` plus next cursors
- requeue current photo and current headshot materialize jobs page by page

Repair default behavior after Feature 029:

- rebuild or reset continuation rows for current source versions
- fill missing versioned pairs
- do **not** re-compare versioned pairs that already have compare rows unless an explicit replay mode is requested

## Continuation / Fan-Out Behavior

### 1. Continuation creation

`materialize_asset_faces` remains the point where source materialization is ensured.

After `ensureAssetFaceMaterialization(...)` succeeds:

- if the source asset is a photo:
  - create or reuse one `photo_to_headshots` continuation keyed by the source photo materialization and compare version
  - use the boundary captured on the `photo_uploaded` intake job
- if the source asset is a headshot:
  - treat continuation creation as consent-scoped, not only asset-scoped
  - create one `headshot_to_photos` continuation per `consent_headshot_ready` intake event using:
    - the shared source headshot materialization
    - the intake consent id
    - that intake row's fixed photo boundary
  - if the same headshot asset is linked to multiple consents, each consent still gets its own continuation row while reusing the same materialization

For repair-created materialize jobs:

- use current project state to compute a fresh boundary
- reset terminal or completed continuation rows for the current source version
- leave active non-stale continuation rows alone

### 2. Source-currentness checks

Before processing any continuation batch, re-check that the source is still current:

- `photo_to_headshots`
  - source photo is still eligible uploaded photo
  - current photo materialization for the current materializer version is still `source_materialization_id`
- `headshot_to_photos`
  - consent is still opted in and not revoked
  - current eligible headshot materialization for that consent and materializer version is still `source_materialization_id`

If the source is no longer current:

- mark the continuation `superseded`
- do not enqueue more compare work

This is the mechanism that stops old headshot backfills after headshot replacement.

### 3. Batch size semantics

`AUTO_MATCH_MAX_COMPARISONS_PER_JOB` remains the bounded fan-out size, but its meaning changes:

- old meaning: terminal cap
- new meaning: number of opposite-side items examined per continuation batch

Keep `MAX_MATCH_CANDIDATES = 750` as the hard upper safety ceiling for one batch, not for the full source workload.

### 4. Photo-to-headshots continuation query

Use keyset pagination over the current eligible consent/headshot set with:

- order: `(consents.created_at asc, consents.id asc)`
- cursor: `(cursor_sort_at, cursor_consent_id)`
- boundary: `(boundary_sort_at, boundary_consent_id)`
- extra filter: current headshot asset `uploaded_at <= boundary_snapshot_at`

Required query behavior:

- tenant-scoped
- project-scoped
- `face_match_opt_in = true`
- `revoked_at is null`
- current headshot asset is uploaded, unarchived, retained, and current as of query time
- headshot uploaded after `boundary_snapshot_at` is excluded from the old continuation

This is how a later headshot replacement is kept out of an older photo continuation.

### 5. Headshot-to-photos continuation query

Use keyset pagination over uploaded project photos with:

- order: `(assets.uploaded_at asc, assets.id asc)`
- cursor: `(cursor_sort_at, cursor_asset_id)`
- boundary: `(boundary_sort_at, boundary_asset_id)`

Required filters:

- tenant-scoped
- project-scoped
- `asset_type = 'photo'`
- `status = 'uploaded'`
- `archived_at is null`

### 6. What each batch does

For each opposite-side item in the batch:

1. Re-check opposite-side eligibility from current server-side state.
2. Resolve the current opposite-side materialization for the current materializer version.
3. If the opposite materialization exists:
   - bulk-check whether the versioned compare row already exists in `asset_consent_face_compares`
   - if it already exists, skip enqueue
   - if it does not exist, enqueue `compare_materialized_pair`
4. If the opposite materialization does not exist:
   - enqueue the opposite asset's `materialize_asset_faces` job
   - do not compute embeddings inline
   - still advance the cursor, because that opposite asset's own intake/materialize path will eventually compare back against the current source

The cursor advances over items examined, not only items compared.

### 7. Why advancing over missing opposite materializations is correct

This repo already has intake/materialize jobs per asset.

If a continuation encounters an eligible opposite-side asset that exists but is not materialized yet:

- the continuation nudges the opposite-side materialize job idempotently
- when that opposite-side materialize job runs, it will create or use its own continuation and enqueue the versioned pair from that side

That preserves:

- materialization-first behavior
- bounded continuation batches
- eventual completeness without forcing the older continuation to block on one missing opposite-side materialization

### 8. Already-compared versioned pairs

Normal fan-out batches must not re-enqueue already-compared versioned pairs unnecessarily.

Implementation rule:

- bulk-load existing compare rows for the selected batch from `asset_consent_face_compares`
- skip compare enqueue when the versioned row already exists
- keep `face_match_jobs` compare dedupe as a second line of defense

Repair rule:

- default repair should also skip already-compared versioned pairs
- only an explicit replay mode may requeue existing compare jobs

## Worker Changes

### 1. Worker claim flow

`runAutoMatchWorker(...)` should process both schedulers:

1. claim and process `face_match_jobs` as today
2. claim and process `face_match_fanout_continuations`

Fairness rule:

- do not let one project monopolize a worker run with a single huge continuation
- continuation claim count should stay bounded per run exactly like job claim count

### 2. Continuation batch completion

Each continuation batch must finish with a lock-token-guarded continuation update that is the **last write of the batch**.

Order of operations:

1. load next page
2. enqueue compare/materialize work idempotently
3. update cursor and next status on the continuation row

Do not advance the cursor before all enqueue work for the batch has succeeded.

This is the crash-safety rule that prevents lost work.

### 3. Continuation failure behavior

Continuation rows should mirror the current queue failure behavior:

- retry transient failures with backoff
- reclaim stale leases
- dead-letter only after bounded retry exhaustion

A continuation batch failure must not consume progress already persisted in compare rows or already-enqueued downstream jobs.

### 4. Materialize job behavior

`processMaterializeAssetFacesJob(...)` should stop doing direct truncating fan-out.

New behavior:

- ensure source materialization
- create or reset continuation row(s)
- complete the materialize job

The continuation scheduler, not the materialize job itself, becomes the bounded fan-out loop.

### 5. Compare job behavior

`compare_materialized_pair` stays the pair execution unit.

No redesign is needed for:

- versioned compare identity
- immutable compare row writes
- currentness check before apply

However, because continuations can keep stale compare jobs alive longer, add one explicit eligibility recheck before canonical apply for:

- `face_match_opt_in = true`
- `revoked_at is null`

Do not assume upstream fan-out eligibility remains true by the time a compare job applies.

## Materialization-First Preservation

This design preserves the repo's materialization-first model:

- source continuations are created only after source materialization exists
- opposite-side work is compared only when opposite materialization exists
- if opposite materialization is missing, the worker nudges `materialize_asset_faces` instead of redoing detection or embeddings inline
- existing materialization rows are reused by version, exactly as today

No new design in this feature should:

- recompute source embeddings because fan-out spans multiple batches
- recompute opposite-side embeddings when a current materialization already exists

## Repair / Reconcile / Replay

### 1. Reconcile

Keep reconcile recent-window and internal-only.

After Feature 029:

- reconcile requeues missing recent intake rows with fresh boundary snapshots
- the requeued intake/materialize flow recreates or resets continuations
- reconcile does not need to know about compare rows directly

### 2. Repair

Keep repair project-scoped, internal-only, and server-resolved by project.

Change it to:

- page through current uploaded photos
- page through current eligible consent headshots
- requeue `materialize_asset_faces` for those source assets in bounded pages
- let materialize re-create or reset the correct continuation rows

This keeps repair aligned with materialization-first behavior.

### 3. Replay

Do not overload default completeness repair into full compare replay.

Default repair after this feature should:

- rebuild missing continuations
- backfill missing versioned compare work
- skip versioned pairs that already have compare rows

If explicit compare replay is still required for future bug-fix reprocessing:

- add a separate internal-only replay flag
- keep it opt-in
- make its stronger semantics explicit in the route, payload, and logs

## Project Progress Behavior

`get_project_matching_progress(...)` should keep its current meaning:

- `total_images` = uploaded photos
- `processed_images` = photos with current materialization in materialized mode

Do not turn this feature into a pair-level percentage feature.

Required change:

- `is_matching_in_progress` must stay true while continuation rows are still queued or actively leased

That means a large consent-side backfill may legitimately show:

- `processed_images = total_images`
- `progress_percent = 100`
- `is_matching_in_progress = true`

That is better than incorrectly showing the project as idle while compare backfill is still draining.

## Security Considerations

- Every new continuation query, boundary helper, and paginated reader must remain explicitly tenant-scoped and project-scoped.
- No client-provided `tenant_id` should be accepted anywhere in this feature. Intake routes continue deriving tenant from auth/session or from the existing public consent submit RPC flow.
- Internal worker, reconcile, and repair routes stay token-protected and server-only.
- Repair must continue resolving `tenant_id` from the loaded project row, not from request input.
- Progress and repair paths must not broaden cross-tenant existence leakage beyond the repo's current internal-only behavior.
- No new continuation state, materialization state, or compare state is exposed to the client.

## Partial-Failure And Concurrency Cases

### Case: worker is already processing compare jobs, then a new headshot is added

Expected behavior:

- intake captures the current photo boundary immediately
- materialize job creates a headshot-side continuation
- continuation batches page current-at-intake photos over multiple runs
- active compare jobs already in flight remain safe because compare dedupe is version-aware

### Case: worker is already processing compare jobs, then a new photo is uploaded

Expected behavior:

- intake captures the current consent/headshot boundary immediately
- materialize job creates a photo-side continuation
- later headshots are excluded from that continuation and handled by their own intake events

### Case: new opposite-side items arrive while an older continuation is still draining

Expected behavior:

- the old continuation keeps its original boundary
- the new opposite-side item gets its own intake path
- overlap is harmless because compare dedupe is version-aware

### Case: same intake event is retried

Expected behavior:

- the intake job dedupe key preserves the first boundary snapshot
- continuation uniqueness preserves one continuation row per source version/direction
- duplicate retry does not widen the boundary or create duplicate continuations

### Case: worker crashes after partially enqueueing a batch

Expected behavior:

- already-enqueued compare/materialize jobs remain durable
- continuation cursor does not advance because the final continuation update did not happen
- replaying the same batch is safe because compare/materialize enqueue is idempotent

### Case: two workers race on the same continuation

Expected behavior:

- one lease wins
- stale worker loses on `lock_token`
- no double cursor advancement

### Case: consent headshot is replaced mid-backfill

Expected behavior:

- old headshot continuation is marked `superseded` once its source materialization is no longer current for that consent
- new headshot intake creates a new continuation with a new fixed photo boundary
- old compare rows remain historical and are not reused as current state

### Case: consent is revoked or opt-out changes mid-backfill

Expected behavior:

- future continuation batches stop scheduling new work for that consent
- compare/apply path re-checks current eligibility before canonical writes
- already persisted compare rows may remain historical, but canonical links are not created or refreshed for ineligible consent

### Case: existing compare rows already exist for the versioned pair

Expected behavior:

- normal continuation skips them in bulk
- explicit replay is the only path that may intentionally revisit them

### Case: repair runs on a project already affected by the truncation bug

Expected behavior:

- repair pages current source assets, not one giant project scan
- reset or create continuation rows for current source versions
- each continuation drains its missing tail over multiple worker batches
- already-compared versioned pairs are skipped

## Implementation Phases

### Phase 1: Continuation schema and paginated SQL helpers

- add `face_match_fanout_continuations`
- add continuation claim/complete/fail enqueue SQL
- add paginated photo and current-headshot helper SQL
- add indexes for continuation claims and keyset scans
- update progress SQL to include active continuations

Verification:

- migration-backed tests for continuation uniqueness, claim, reclaim, and progress activity

### Phase 2: Boundary snapshots at intake

- update:
  - `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`
  - `src/lib/assets/finalize-project-asset-batch.ts`
  - `src/app/i/[token]/consent/route.ts`
  - `src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts`
- capture fixed boundary snapshots into intake job payloads
- keep primary upload/consent/headshot flows successful if matching enqueue fails

Verification:

- tests proving duplicate intake does not widen the boundary

### Phase 3: Materialize-to-continuation handoff

- stop direct truncating fan-out in `processMaterializeAssetFacesJob(...)`
- create or reset continuation rows after source materialization exists
- keep repair vs normal dispatch mode explicit

Verification:

- tests proving one materialize job creates continuation state instead of only one bounded compare slice

### Phase 4: Continuation worker batches

- add worker continuation claim/process loop
- add source-currentness checks
- add bulk compare-row existence checks
- enqueue compare or opposite-side materialize jobs from each batch
- advance cursor only as the final batch write

Verification:

- multi-run worker tests proving opposite-side count greater than cap eventually reaches full coverage

### Phase 5: Repair and reconcile alignment

- keep reconcile bounded and recent-window only, but refresh intake boundaries on requeue
- make repair paginated and continuation-aware
- default repair fills missing compare work without replaying existing versioned pairs

Verification:

- tests for project repair after partial truncation
- tests for reconcile after partial progress

## Test Plan

Add a dedicated regression file:

- `tests/feature-029-complete-bounded-matching-fanout.test.ts`

Update existing coverage in:

- `tests/feature-010-auto-match-backbone.test.ts`
- `tests/feature-019-face-materialization-pipeline.test.ts`
- `tests/feature-021-project-matching-progress.test.ts`

Required regression coverage:

### Completeness over multiple batches

- opposite-side count greater than the current cap
- `maxComparisonsPerJob = 2` or `3` in test setup
- multiple worker runs required before the continuation completes
- final compare row count equals all in-boundary opposite-side items

### Photos-first then consent-later

- create many photos first
- create consent/headshot later
- verify the consent-side continuation drains all pre-existing photos
- verify no dependence on later unrelated uploads

### Consent-first then photos-later

- create consent/headshot first
- upload many photos later
- verify photo-side continuations cover the consent without duplicates

### Active worker plus new headshot

- start with worker already processing other compare/materialize jobs
- add a new headshot while work is active
- verify the new continuation boundary is fixed at intake time and still drains completely

### Active worker plus new photo

- same as above in the opposite direction

### Retry and crash recovery

- inject a failure after some compare/materialize enqueues but before continuation cursor completion
- rerun worker
- verify no lost tail and no duplicate compare rows

### Versioned compare dedupe

- pre-create some versioned compare rows
- run continuation batches
- verify only missing versioned pairs are enqueued in normal mode

### Headshot replacement

- start a headshot-side continuation
- replace the headshot before completion
- verify old continuation becomes `superseded`
- verify new headshot creates a fresh valid continuation
- verify old compare state is not treated as current

### Revocation / opt-out

- revoke or opt out the consent mid-backfill
- verify no new canonical links are written after revocation
- verify continuation stops scheduling new work for that consent

### Repair and reconcile

- simulate a historically truncated project
- run repair with bounded pages
- verify full coverage is restored over multiple worker runs
- run reconcile after partial progress and verify it does not duplicate completed versioned pairs

### Progress

- active continuation with all photos already materialized keeps `isMatchingInProgress = true`
- completed continuation clears active state
- stale continuation lease does not keep progress active forever

## Risks And Tradeoffs

### Added state machine complexity

Risk:

- a continuation table plus the existing job queue is more moving parts than today

Mitigation:

- keep continuation state explicit and small
- mirror Feature 025's lease/token pattern instead of inventing a weaker scheduler
- keep compare jobs and materialize jobs unchanged as execution units

### Boundary semantics are stricter than today

Tradeoff:

- old continuations no longer widen to include later arrivals

Why this is correct:

- later arrivals must be handled by their own intake events
- widening older continuations is exactly how "bounded but incomplete" turns into "bounded but never-finished"

### Progress percent remains photo-materialization-centric

Tradeoff:

- `progress_percent` can reach `100` while continuation compare backfill is still draining

Mitigation:

- keep `isMatchingInProgress` correct
- do not conflate photo materialization coverage with pair-level completion in this feature

### Repair semantics split

Tradeoff:

- default repair should fill missing work without replaying good compare rows

Mitigation:

- keep replay explicit if it is still needed
- do not overload completeness repair into mass compare replay

## Implementation Prompt

Implement Feature 029 using the dedicated continuation-table design from this plan.

Add a new tenant-scoped `face_match_fanout_continuations` table with lock-token and lease-safe claim semantics, capture fixed opposite-side boundaries at intake time for `photo_uploaded` and `consent_headshot_ready`, stop doing direct truncating fan-out inside `processMaterializeAssetFacesJob(...)`, create or reset continuation rows after source materialization exists, keyset-page opposite-side photos by `(uploaded_at, id)` and opposite-side current consent headshots by `(consent.created_at, consent.id)` plus `boundary_snapshot_at`, bulk-skip versioned pairs that already exist in `asset_consent_face_compares`, enqueue opposite-side `materialize_asset_faces` jobs when materialization is missing, update project progress to count active continuations, keep reconcile recent-window and repair paginated, make default repair fill missing bounded work without replaying already-compared versioned pairs, and add regression coverage for multi-batch completeness, active-worker intake, crash recovery, headshot replacement, revocation, repair, reconcile, and progress activity.

