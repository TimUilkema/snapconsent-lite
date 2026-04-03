# Feature 025 Plan: Matching Pipeline Robustness

## Inputs And Ground Truth

This plan is based on:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `README.md`
- `docs/rpi/SUMMARY.md`
- verified research in `docs/rpi/025-matching-queue-robustness/research.md`

Repository code is the ground truth. The plan below re-checks and follows the current implementation in:

- `src/lib/matching/auto-match-jobs.ts`
- `src/lib/matching/auto-match-worker.ts`
- `src/lib/matching/auto-match-reconcile.ts`
- `src/lib/matching/face-materialization.ts`
- `src/lib/matching/materialized-face-compare.ts`
- `src/lib/matching/project-matching-progress.ts`
- `src/app/api/internal/matching/worker/route.ts`
- `src/app/api/internal/matching/reconcile/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`
- `src/lib/assets/finalize-project-asset-batch.ts`
- `src/app/i/[token]/consent/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts`
- relevant matching migrations and tests

## Verified Current State

The current matching pipeline already has the right high-level architecture for replay-safe repair:

- queue rows are tenant-scoped and deduped by `(tenant_id, project_id, dedupe_key)`
- materialized work is versioned by `materializer_version`
- compare work is versioned by `(consent_id, asset_id, headshot_materialization_id, asset_materialization_id, compare_version)`
- materialization writes and compare writes are already upsert-based and mostly idempotent

The main robustness gaps are in queue control, not in the materialized compare model:

- `claim_face_match_jobs(...)` only claims `queued` rows
- `enqueue_face_match_job(...)` does not requeue existing logical work
- `complete_face_match_job(...)` / `fail_face_match_job(...)` are not protected against stale-worker completion after reclaim
- `runAutoMatchReconcile(...)` only re-enqueues intake keys and cannot repair existing deduped rows
- project progress treats all `processing` rows as active forever

## Options Considered

### Option A: Minimal queue hardening

Examples:

- stale lease reclaim in `claim_face_match_jobs(...)`
- explicit requeue primitive
- limited reconcile improvement

Pros:

- smallest code and migration footprint
- fixes the immediate stale `processing` wedge

Cons:

- does not provide an explicit project-scoped repair path for future bug replays
- does not give operators a safe way to re-run materialized orchestration across an existing project
- leaves "repair" too dependent on lookback-based reconcile behavior

### Option B: Queue hardening plus dedicated repair path

Examples:

- lease reclaim with lock-token safety
- explicit requeue/replay primitive
- reconcile upgraded to use repair-aware semantics for recent items
- dedicated internal project repair path that replays materialized orchestration safely

Pros:

- fixes the current failure class
- gives a safe operator path for bug-fix replay and project repair
- keeps the existing materialized pipeline and pair-level apply model
- bounded enough for a single feature

Cons:

- adds queue metadata and one new internal repair flow
- slightly increases worker and queue-function complexity

### Option C: More extensive redesign

Examples:

- redesign queue ownership model
- replace current dedupe model entirely
- rebuild orchestration into a different state machine

Pros:

- could produce a more theoretically uniform system

Cons:

- too disruptive for the current verified failure class
- higher migration and regression risk
- not necessary because the existing materialized tables and pair keys are already good enough for replay-safe recovery

## Recommendation

Choose **Option B**.

It is safer than the current design because it closes the real correctness gaps:

- stale job ownership becomes recoverable
- duplicate active processing is prevented with claim-token checks
- replay becomes explicit rather than relying on dedupe conflicts
- repair moves from implicit lookback behavior to an intentional internal workflow

It is preferred over Option A because the current bug is not only a stale-lock problem. It is also a repair-gap problem. The system needs an explicit project repair path for partial orchestration failure and future bug-fix replay.

It is preferred over Option C because the current materialized pipeline already has the right idempotent storage shape. The queue and repair behavior need hardening, not a full redesign.

## Chosen Architecture

### Summary

Implement a bounded robustness layer on top of the existing queue and materialized pipeline:

1. Add **lease-based queue claiming** with **claim tokens**.
2. Keep **normal enqueue behavior unchanged** for existing intake flows.
3. Add an **explicit replay/requeue primitive** for repair paths.
4. Upgrade **reconcile** to use repair-aware requeue semantics for recent intake work.
5. Add a **dedicated internal project repair path** that requeues current-version `materialize_asset_faces` work for current uploaded photos and current consent headshots.
6. Make `materialize_asset_faces` **repair-aware** so repaired materialize runs requeue downstream compare jobs instead of silently no-oping on deduped compare keys.
7. Change project progress so **stale processing jobs do not keep the UI active forever**.

### What Is In Scope Now

Must-have in this feature:

- queue lease timeout
- stale `processing` reclaim in claim
- claim-token guarded complete/fail
- explicit requeue/replay primitive
- reconcile improvement for recent repair-safe requeue
- new internal project repair path
- repair-aware materialize fan-out for compare jobs
- progress active-state fix for stale jobs
- worker/reconcile/repair logging and regression tests

Deferred:

- heartbeat support
- automatic background sweeper
- large-scale bulk repair across all projects
- richer admin UI for queue inspection
- reclaim-count based automatic dead-letter policy
- deeper redesign of `reconcile_project` job ownership

## Schema / DB Changes

### 1. `public.face_match_jobs` columns

Add:

- `lock_token uuid`
- `lease_expires_at timestamptz`
- `reclaim_count integer not null default 0`
- `requeue_count integer not null default 0`
- `last_requeued_at timestamptz`
- `last_requeue_reason text`

Rationale:

- `lock_token` prevents stale workers from completing or failing a job after the lease was reclaimed
- `lease_expires_at` supports claim-time stale detection and progress filtering
- `reclaim_count` makes stale recovery visible without conflating it with application failures
- `requeue_*` fields give minimal auditability for explicit repair/replay

### 2. Indexes

Add:

- index on `(status, lease_expires_at)` for stale-processing lookup
- keep existing `(status, run_after)` index for queued claim order

### 3. Queue SQL functions

Update:

- `app.claim_face_match_jobs(...)`
- `app.complete_face_match_job(...)`
- `app.fail_face_match_job(...)`

Add:

- `app.requeue_face_match_job(...)`
- public wrapper `public.requeue_face_match_job(...)`

### 4. Function signatures

Planned signature changes:

- `claim_face_match_jobs(p_locked_by text, p_batch_size integer, p_lease_seconds integer default ...)`
- `complete_face_match_job(p_job_id uuid, p_lock_token uuid)`
- `fail_face_match_job(p_job_id uuid, p_lock_token uuid, ...)`

Planned new repair primitive:

- `requeue_face_match_job(...)` mirroring enqueue scope and payload, but with explicit repair semantics and a `p_requeue_reason`

### 5. Progress SQL

Update `app.get_project_matching_progress(...)` so:

- `queued` jobs are active
- `processing` jobs are active only while `lease_expires_at > now()`
- stale `processing` jobs do not keep `is_matching_in_progress = true`

## Queue Behavior Changes

### 1. Claim behavior

Decision:

- add a lease timeout
- reclaim happens in `claim_face_match_jobs(...)`
- no periodic sweeper in scope for this feature

Behavior:

- claimable rows are:
  - `status = 'queued' and run_after <= now()`
  - `status = 'processing' and lease_expires_at <= now()`
- each claim assigns:
  - `status = 'processing'`
  - `locked_by = workerId`
  - `locked_at = now()`
  - `started_at = now()`
  - `lock_token = gen_random_uuid()`
  - `lease_expires_at = now() + lease_seconds`
- reclaimed rows increment `reclaim_count`

### 2. Complete/fail behavior

Decision:

- complete/fail must require the current `lock_token`

Behavior:

- `complete_face_match_job(...)` only succeeds if:
  - `id = job_id`
  - `status = 'processing'`
  - `lock_token = supplied_lock_token`
- `fail_face_match_job(...)` uses the same guard
- if a stale worker tries to complete/fail after reclaim, the function returns no row and the worker treats that as a benign lost-lease conflict

This is the key guard against duplicate active processing after reclaim.

#### Complete/fail ownership result

`complete_face_match_job(...)` and `fail_face_match_job(...)` should return an explicit outcome that lets the worker distinguish:
- successful ownership-bound completion/failure
- lost-lease ownership mismatch
- missing-job cases

Do not rely only on "no row updated" semantics in worker code.

### 3. Lease duration and heartbeat

Decision:

- add configurable lease duration
- do **not** add heartbeats in this feature

Reason:

- current jobs are still bounded by one asset or one versioned pair
- heartbeats add extra write churn and complexity
- a conservative lease value plus lock-token guarded complete/fail is enough for the current failure class

Planned config:

- new env-backed config helper, for example `AUTO_MATCH_JOB_LEASE_SECONDS`
- bounded default, for example `900` seconds

Deferred:

- heartbeat RPC and worker heartbeating if production job durations show real need

#### Lease config safety

Lease duration configuration must be validated server-side.
Invalid or out-of-range values must fall back to a conservative bounded default.
Do not allow fragile or unbounded lease configuration through env values.
### 4. Requeue / replay semantics

Decision:

- keep current enqueue behavior unchanged for normal intake
- add an explicit requeue primitive for repair paths

Normal enqueue remains:

- dedupe-only
- no requeue on conflict
- current intake call sites stay behaviorally stable

Repair requeue behavior:

- if no row exists for the dedupe key, insert queued work
- if row exists and is `queued`, refresh payload/run_after as needed
- if row exists and is `succeeded`, `dead`, or stale `processing`, reset it to `queued`
- if row exists and is active non-stale `processing`, return an `already_processing` result and do not steal the lease
- repair resets the row for a new replay cycle and increments `requeue_count`

#### Requeue row reuse tradeoff

This feature intentionally reuses existing job rows for explicit repair/requeue of terminal or stale work to keep the implementation bounded.
Active non-stale `processing` rows must never be mutated by repair.
`requeue_count`, `last_requeued_at`, and `last_requeue_reason` are required because replay reuses row history.
### 5. Retry behavior

Application failure retries remain unchanged:

- worker catches exception
- `fail_face_match_job(...)` requeues with backoff or dead-letters at `max_attempts`

Lease reclaim is kept separate from failure retries:

- reclaim increments `reclaim_count`
- reclaim does not consume `attempt_count` in this feature

Reason:

- process crashes and restarts should not automatically burn normal retry budget
- repeated lease expiry is an operational signal, not necessarily a job-logic failure

#### Status name alignment

Before implementation, verify the exact `face_match_jobs` status values from the current schema/code and use those exact names consistently in SQL, TypeScript, tests, and plan execution.
Do not introduce inferred status names.

### Job state transition rules

The implementation must keep an explicit state model for `face_match_jobs`.

Allowed transitions:
- `queued -> processing` via claim
- `processing -> succeeded` via complete with matching `lock_token`
- `processing -> queued` via fail/retry
- `processing -> dead` via fail at retry limit
- `processing(stale lease) -> processing` via reclaim with new `lock_token`
- `succeeded -> queued` only via explicit repair/requeue
- `dead -> queued` only via explicit repair/requeue
- `failed/terminal -> queued` only via explicit repair/requeue if that status exists in current schema

Non-stale active `processing` rows must never be mutated by repair.

## Worker / Reconcile / Repair Behavior Changes

### 1. Worker changes

Worker DTOs and helpers must carry:

- `lock_token`
- `lease_expires_at`

Worker behavior changes:

- claim uses lease-aware `claim_face_match_jobs(...)`
- complete/fail calls include the `lock_token`
- lost-lease complete/fail conflicts are logged and treated as non-fatal

### 2. `materialize_asset_faces` replay behavior

Decision:

- `materialize_asset_faces` gains a repair-aware fan-out mode

Behavior:

- normal intake-triggered materialize runs keep current dedupe-only compare enqueue
- repair-triggered materialize runs use repair-aware compare requeue semantics

Why:

- this is the smallest way to recover:
  - materialization already exists but compare jobs are missing
  - some compare jobs exist and others do not
  - compare jobs already exist but need replay after a bug fix

### 3. `compare_materialized_pair` replay behavior

No semantic redesign is planned.

Current versioned pair behavior is already suitable for replay because:

- compare rows are unique by versioned pair
- compare writes are upsert-based
- apply logic is already canonical pair-level logic

Work in scope:

- add regression tests proving replay remains safe

### 4. Reconcile changes

Decision:

- keep current reconcile route and recent-window behavior
- make it use repair-aware requeue semantics for intake work

Behavior change:

- `runAutoMatchReconcile(...)` still scans recent photos, consents, and headshots
- instead of plain enqueue, it uses the explicit requeue primitive
- recent stale/terminal intake rows can therefore be repaired
- active non-stale rows remain untouched

This fixes the current mismatch between code comments and actual behavior.

#### Reconcile scope boundary

`runAutoMatchReconcile(...)` remains bounded to its existing recent-window repair scope.
Deep or historical replay is handled only by the dedicated project repair path in this feature.
### 5. Dedicated repair path

Decision:

- add a dedicated internal project repair path
- do not rely on lookback reconcile for deep repair

Planned shape:

- new internal server-only entry point, for example `POST /api/internal/matching/repair`
- token-protected like worker/reconcile
- request accepts:
  - `projectId`
  - optional `batchSize`
  - optional `reason`
  - optional pagination cursors if needed for bounded scans

Server-side safety:

- do not accept `tenant_id` from caller
- resolve tenant by loading the project server-side

Repair meaning in this feature:

- scan current uploaded photos in the project
- scan current current consent headshots in the project
- explicitly requeue current-version `materialize_asset_faces` jobs for those assets
- mark those materialize jobs as repair-triggered so downstream compare fan-out uses repair-aware requeue semantics

This repair model intentionally operates at the materialized orchestration layer, not the raw intake layer.

Reason:

- it is closer to the actual missing durable work
- it can recover from "materialization exists, compare fan-out missing"
- it supports future bug-fix replay without pretending old intake events are enough

### Repair idempotency

The project repair path must be idempotent.
Repeated or overlapping repair requests for the same project must be safe.
Repair only requeues current-version, currently eligible, tenant-scoped `materialize_asset_faces` work, and repaired materialize fan-out only targets current eligible opposite-side materializations.
Deep historical replay remains a dedicated repair concern and is not part of bounded recent-window reconcile.


### 6. `reconcile_project` job type

Decision:

- leave the existing `reconcile_project` queue job type out of scope for deeper activation in this feature

Reason:

- turning it into a queued, paginated repair engine is useful but larger
- the bounded repair path above is enough for the current failure class

Deferred:

- reusing `reconcile_project` as a durable project repair job

## Progress / Observability / Operations

### 1. Project progress behavior

Decision:

- stale `processing` jobs should **not** count as active

Behavior:

- UI no longer shows "matching in progress" forever when the only remaining processing rows are stale
- processed image semantics remain otherwise unchanged in this feature

### 2. Logging and diagnostics

Must-have additions:

- worker logs when jobs are reclaimed
- worker logs when complete/fail loses lease ownership
- reconcile logs or returns counts for:
  - inserted
  - requeued
  - already_processing
  - already_queued
- repair route returns the same style of counters

### 3. Operator repair tooling

Decision:

- yes, add operator-safe repair tooling

Must-have:

- internal token-protected repair endpoint

Deferred:

- protected admin UI for queue inspection and repair
- richer dashboard metrics for queue health

## Partial-Failure Resilience

### Case: job claimed, worker crashes before completion

Recovery:

- job lease expires
- next claim reclaims it
- old worker cannot complete it because `lock_token` no longer matches

### Case: materialization written, downstream compare jobs missing

Recovery:

- project repair requeues the current-version `materialize_asset_faces` job
- materialize replay loads existing materialization and repair-requeues compare jobs

### Case: some compare jobs created, others missing

Recovery:

- repaired materialize replay re-fans out all current pairs
- missing compare jobs are inserted
- existing terminal compare jobs can be explicitly requeued
- active non-stale compare jobs are not duplicated

### Case: link creation succeeds but later cleanup/update work fails

Recovery:

- replayed compare job re-runs existing pair-level apply logic
- tests must verify replay does not duplicate canonical links or break manual provenance

### Case: replay after bug fix or transient outage

Recovery:

- operator runs project repair
- repair requeues current-version materialize jobs
- repaired materialize runs requeue current-version compare jobs
- versioned materialization/compare tables absorb replay idempotently

### Case: missing storage object or matcher/provider problem during retry

Behavior:

- normal retry/dead behavior remains in worker failure flow
- repair does not bypass eligibility or retention checks
- permanently missing or ineligible assets settle to skipped or dead behavior rather than perpetual active state

## Implementation Phases

### Phase 1: Queue lease hardening

- add `lock_token`, `lease_expires_at`, `reclaim_count`, `requeue_*` metadata columns
- update claim/complete/fail SQL functions
- add index for stale-processing lookup
- add config helper for lease seconds
- update worker DTOs and complete/fail calls to carry `lock_token`
- update worker logging for reclaim and lost-lease outcomes

Verification:

- targeted queue tests for stale reclaim and stale-worker completion conflict

### Phase 2: Explicit requeue primitive

- add `requeue_face_match_job(...)` SQL function and TS wrapper
- keep normal enqueue path unchanged
- define repair result states in TS (`inserted`, `requeued`, `already_processing`, `already_queued`)
- update recent-window reconcile to use repair-aware requeue semantics

Verification:

- tests for dedupe-safe normal enqueue vs explicit repair requeue
- tests for reconcile against existing deduped rows

### Phase 3: Project repair path

- add internal repair route and service
- server-side resolve tenant from project
- project repair requeues current-version `materialize_asset_faces` jobs for current photos and current headshots
- include bounded scan controls and route result counters

Verification:

- tests for photos-first / consent-later repair
- tests for repair after existing materialization but missing compare fan-out

### Phase 4: Repair-aware materialize fan-out and progress fix

- add repair mode to materialize job payload/processing
- repair-mode materialize uses repair-aware requeue for compare jobs
- update project progress RPC to ignore stale processing jobs for active-state purposes

Verification:

- tests for partial compare fan-out recovery
- tests for progress not stuck active on stale jobs

### Phase 5: Replay safety regression coverage

- add replay tests around compare/apply path
- verify canonical links, review candidates, and observability rows remain idempotent under replay

## Test Plan

Add or extend tests in:

- `tests/feature-010-auto-match-backbone.test.ts`
- `tests/feature-019-face-materialization-pipeline.test.ts`
- `tests/feature-021-project-matching-progress.test.ts`

Required regression coverage:

### Queue recovery

- stale `processing` job is reclaimed after lease expiry
- reclaimed job gets a new `lock_token`
- stale worker cannot complete or fail after reclaim
- active non-stale processing job is not stolen by repair requeue

### Requeue / replay

- normal enqueue remains deduped and does not requeue terminal rows
- explicit repair requeue resets terminal rows to `queued`
- explicit repair requeue inserts row when none exists
- reconcile against an existing deduped recent row requeues it when appropriate

### Partial orchestration failure

- `materialize_asset_faces` replay after existing materialization and missing compare jobs
- repaired materialize run requeues compare jobs
- compare replay is safe when compare row already exists

### Photos-first / consent-later

- project with pre-materialized photos, then consent/headshot, then interrupted headshot-side orchestration
- repair path backfills compare work and canonical links

### Consent-first / photos-later

- existing happy path still works and is not duplicated by stronger repair semantics

### Progress correctness

- stale `processing` job does not keep `isMatchingInProgress = true`
- queued job still counts as active
- non-stale processing job still counts as active

### Race-safe idempotency

- reclaim and old-worker completion race resolves safely
- replayed compare does not duplicate links/candidates/results
- manual provenance remains preserved under replay

## Risks And Tradeoffs

### False reclaim risk

Risk:

- a legitimate long-running job could look stale and be reclaimed

Mitigation:

- conservative default lease
- config-bound lease duration
- `lock_token` guarded complete/fail so old worker cannot overwrite the new owner

Tradeoff:

- without heartbeat, lease must be long enough to avoid accidental reclaim

### Duplicate execution risk

Risk:

- reclaim plus replay can cause the same logical work to run more than once

Mitigation:

- explicit distinction between normal enqueue and repair requeue
- `lock_token` ownership checks
- existing materialization and compare upserts
- canonical pair-level writes remain idempotent

### Complexity added

Risk:

- queue SQL and worker control flow become more complex

Mitigation:

- keep normal intake semantics unchanged
- add only one explicit replay primitive
- defer heartbeats and background sweeper

### Migration risk

Risk:

- changing queue function signatures can break worker code if not rolled out together

Mitigation:

- implement schema/function changes and TS updates in the same feature branch
- keep wrappers explicit and cover them with integration-style tests

### Operational safety tradeoff

Decision:

- do not auto-dead-letter repeated lease expiries in this feature

Reason:

- process restarts should not silently kill recoverable work
- `reclaim_count` plus logs is safer for the first hardening pass

Deferred:

- threshold-based operational escalation on repeated lease expiry

## Implementation Prompt

Implement Feature 025 using Option B from this plan.

Make the matching queue lease-aware and replay-safe without changing normal intake dedupe behavior. Add lease metadata and claim tokens to `face_match_jobs`, update claim/complete/fail SQL functions to use lease-aware ownership, add an explicit `requeue_face_match_job(...)` primitive for repair flows, update recent-window reconcile to use repair-aware requeue semantics, add a new internal project repair path that requeues current-version `materialize_asset_faces` jobs for current uploaded photos and current consent headshots, make repair-triggered `materialize_asset_faces` runs requeue downstream `compare_materialized_pair` work safely, update project progress so stale processing jobs do not keep matching active forever, and add targeted regression tests for stale reclaim, replay/requeue, partial orchestration failure, photos-first/consent-later repair, progress correctness, and race-safe idempotency.
