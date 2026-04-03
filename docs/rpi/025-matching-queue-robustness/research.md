# Feature 025 Research: Matching Queue Robustness

## Scope

Research the current facial matching bug where:

- uploading a consent with headshot first, then uploading photos, works
- uploading many photos first, then uploading the consent with headshot, can fail to match those already-uploaded photos

Research goals:

- verify the current bug against code and local data
- identify where the same failure class can occur elsewhere in the app
- identify how to prevent this class of issue in the future
- identify how to make the facial matcher job queue more robust against worker crashes, partial failures, and replay/backfill gaps

Code is treated as ground truth. Existing docs are treated as design intent only.

## Inputs Reviewed

Top-level docs:

- `AGENTS.md`
- `ARCHITECTURE.md`
- `CONTEXT.md`
- `README.md`
- `docs/rpi/README.md`

Related RPI feature docs:

- `docs/rpi/006-headshot-consent/*`
- `docs/rpi/009-matching-foundation/*`
- `docs/rpi/010-auto-face-matching/*`
- `docs/rpi/011-real-face-matcher/*`
- `docs/rpi/012-manual-review-likely-matches/*`
- `docs/rpi/013-match-results-observability/*`
- `docs/rpi/015-headshot-replace-resets-suppressions/*`
- `docs/rpi/016-compreface-service-fit/research.md`
- `docs/rpi/017-face-result-geometry-and-embeddings/*`
- `docs/rpi/018-compreface-performance-efficiency/*`
- `docs/rpi/019-face-materialization-deduped-embedding-pipeline/*`
- `docs/rpi/020-materialized-headshot-resolution-bug/*`
- `docs/rpi/021-project-matching-progress-ui/*`
- `docs/rpi/023-bugfix-requesturi/*`

Primary code and schema reviewed:

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
- `supabase/migrations/20260306130000_010_auto_match_backbone_schema.sql`
- `supabase/migrations/20260306131000_010_auto_match_queue_functions.sql`
- `supabase/migrations/20260320140000_019_face_materialization_pipeline.sql`
- `supabase/migrations/20260327120000_023_request_uri_safety.sql`

Tests reviewed:

- `tests/feature-010-auto-match-backbone.test.ts`
- `tests/feature-019-face-materialization-pipeline.test.ts`
- `tests/feature-021-project-matching-progress.test.ts`

Local database was inspected directly to verify the failing scenario and queue state.

## Current Pipeline, Verified From Code

### Intake triggers

Uploaded photos enqueue `photo_uploaded` jobs:

- `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts:56`
- `src/lib/assets/finalize-project-asset-batch.ts:71`

Consent submit and headshot replacement enqueue `consent_headshot_ready` jobs:

- `src/app/i/[token]/consent/route.ts:71`
- `src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts:204`

All four intake call sites swallow enqueue errors and rely on reconcile later:

- `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts:67`
- `src/lib/assets/finalize-project-asset-batch.ts:82`
- `src/app/i/[token]/consent/route.ts:88`
- `src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts:215`

### Queue model

Queue rows live in `public.face_match_jobs` with a unique key on `(tenant_id, project_id, dedupe_key)`:

- `supabase/migrations/20260306130000_010_auto_match_backbone_schema.sql:77`

Enqueue is idempotent by dedupe key:

- `src/lib/matching/auto-match-jobs.ts:102`
- `supabase/migrations/20260306131000_010_auto_match_queue_functions.sql:1`

On dedupe conflict, enqueue does not requeue or rewrite the job. It only updates `updated_at`:

- `supabase/migrations/20260306131000_010_auto_match_queue_functions.sql:69`

Claim only selects rows where `status = 'queued'`:

- `supabase/migrations/20260306131000_010_auto_match_queue_functions.sql:131`
- `supabase/migrations/20260306131000_010_auto_match_queue_functions.sql:135`

Retry only happens when the worker catches an exception and explicitly calls `fail_face_match_job(...)`:

- `src/lib/matching/auto-match-worker.ts:1880`
- `supabase/migrations/20260306131000_010_auto_match_queue_functions.sql:214`

There is no stale lease reclaim, no heartbeat, and no worker-recovery path for jobs left in `processing`.

### Materialized pipeline

In `materialized_apply` / `materialized_shadow`:

1. intake jobs enqueue `materialize_asset_faces`
2. `materialize_asset_faces` creates or loads materializations
3. then it enqueues `compare_materialized_pair`
4. `compare_materialized_pair` writes compare results and, in apply mode, canonical links

Relevant code:

- `src/lib/matching/auto-match-worker.ts:1325`
- `src/lib/matching/auto-match-worker.ts:1449`
- `src/lib/matching/auto-match-worker.ts:1499`
- `src/lib/matching/auto-match-worker.ts:1540`
- `src/lib/matching/auto-match-worker.ts:1619`

This means "photos first, consent later" is supposed to work. The consent-side intake should materialize the headshot and then schedule compare jobs against already-materialized photos:

- `src/lib/matching/auto-match-worker.ts:1519`
- `src/lib/matching/face-materialization.ts:402`

## Verified Bug: Photos First, Consent Later

### What happened locally

Local DB evidence confirms the failing pattern is real.

Brad Pitt consent:

- `consent_id = ca7e5695-f9b6-47fc-bf5e-23cebb2d24c9`
- headshot `asset_id = 019003a9-d4ad-4ffd-8e54-d87100c395d8`

Verified local facts:

- there are `120` uploaded Brad Pitt photos in the project
- there are `120` Brad Pitt photo materializations
- there are `0` compare rows between Brad's consent and Brad Pitt photo assets
- there are `0` photo links between Brad's consent and Brad Pitt photo assets
- there are `34` compare rows between Brad's consent and Roger Federer photo assets

This proves:

- the project already had Brad photos and their materializations
- Brad's consent did not fan out compare work against those already-existing Brad photos
- later photo-side processing for other subjects still compared those new photos against Brad's headshot

### Verified queue timeline

From local `face_match_jobs`:

- Brad `consent_headshot_ready` job `93540f9d-2f15-48dd-89d4-810d1bc2152d` was created on `2026-03-27 14:39:13.673459+00`
- it started on `2026-03-27 14:39:18.773568+00`
- it completed successfully on `2026-03-27 14:39:18.790860+00`

That intake job enqueued downstream `materialize_asset_faces` job `c32b0521-5543-45cc-893e-d33329f9d451`:

- created on `2026-03-27 14:39:18.786654+00`
- status is still `processing`
- `locked_by = manual-materialized-drain`
- `locked_at = started_at = 2026-03-27 14:40:31.940614+00`
- `attempt_count = 1`
- `last_error_code = face_materialization_lookup_failed`
- `last_error_message = Unable to load face materialization.`

At the same time, the headshot materialization row itself already exists:

- materialization `6a8e045a-52b2-4d5d-8976-68e03a8b380c`
- `materialized_at = 2026-03-27 14:39:19.152+00`
- `face_count = 1`
- `usable_for_compare = true`

So the actual failure mode is not "Brad headshot never materialized." The failure mode is:

- the headshot-side orchestration job got stranded in `processing`
- compare scheduling for already-existing photos never completed
- the queue has no recovery mechanism for that stranded row

### Why consent-first then photos-later still appears to work

This asymmetry follows directly from the pipeline structure.

If consent exists first, every later `photo_uploaded` job is another chance to materialize that photo and enqueue compare work against the current eligible headshots:

- `src/lib/matching/auto-match-worker.ts:1332`
- `src/lib/matching/auto-match-worker.ts:1489`

If photos exist first, the system depends on the consent/headshot side to enqueue compare work against the already-existing photo materializations:

- `src/lib/matching/auto-match-worker.ts:1381`
- `src/lib/matching/auto-match-worker.ts:1519`

If that single consent-side materialization job gets stuck, there is no automatic sweep that fills the gap.

## Root Cause

### Root cause 1: no stale processing recovery

`claim_face_match_jobs` only claims `queued` rows:

- `supabase/migrations/20260306131000_010_auto_match_queue_functions.sql:135`

If a worker crashes or exits after claim and before `complete_face_match_job(...)` or `fail_face_match_job(...)`, the job remains `processing` forever.

This is the central queue robustness defect.

### Root cause 2: dedupe conflict does not requeue

`enqueue_face_match_job(...)` uses the dedupe key uniqueness constraint and, on conflict, only does:

- `set updated_at = v_now`

Code:

- `supabase/migrations/20260306131000_010_auto_match_queue_functions.sql:69`

That means a later trigger, or reconcile, cannot recover a stuck or already-succeeded logical job if it uses the same dedupe key.

### Root cause 3: reconcile does not actually repair this failure mode

The intent in comments and earlier docs is that reconcile backfills missed jobs:

- `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts:68`
- `src/app/i/[token]/consent/route.ts:89`
- `src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts:216`
- `tests/feature-010-auto-match-backbone.test.ts:465`

But the actual reconcile implementation just re-enqueues the same dedupe keys:

- `src/lib/matching/auto-match-reconcile.ts:157`
- `src/lib/matching/auto-match-reconcile.ts:185`
- `src/lib/matching/auto-match-reconcile.ts:229`

Because enqueue-on-conflict only touches `updated_at`, reconcile can only backfill when the row does not already exist. It does not recover:

- stale `processing` rows
- already-succeeded rows that need replay
- already-dead rows that should be retried after a code fix or transient outage

The existing test only covers the "no job row exists yet" case:

- `tests/feature-010-auto-match-backbone.test.ts:465`

It does not cover replay or stuck-row recovery.

### Root cause 4: orchestration jobs are single points of failure

`materialize_asset_faces` is both:

- the durable record that materialization was requested
- the only mechanism that fans out downstream compare jobs for that asset version

If the job becomes stranded after materialization but before compare enqueue finishes, the system has no invariant that says:

- "all current eligible pairs must eventually have compare jobs"

Instead, it relies on that one orchestration row completing successfully.

## Where This Failure Class Can Occur Elsewhere

This is not limited to Brad Pitt or to `consent_headshot_ready`.

### 1. Any `face_match_jobs` row can be stranded

All current matching job types use the same queue primitives:

- `photo_uploaded`
- `consent_headshot_ready`
- `reconcile_project`
- `materialize_asset_faces`
- `compare_materialized_pair`

Definitions:

- `src/lib/matching/auto-match-jobs.ts:5`

Any of them can be left in `processing` forever if a worker dies after claim.

### 2. All intake flows that swallow enqueue errors inherit the same false safety net

These flows assume reconcile can fix missed work:

- asset finalize
- batch finalize
- public consent submit
- headshot replacement

Code:

- `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts:67`
- `src/lib/assets/finalize-project-asset-batch.ts:82`
- `src/app/i/[token]/consent/route.ts:88`
- `src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts:215`

That assumption is only valid if the logical job row does not already exist.

### 3. Photos-first / consent-later is the clearest asymmetric casualty

This path depends on consent-side orchestration to backfill compares against already-existing photo materializations:

- `src/lib/matching/auto-match-worker.ts:1519`

So it is especially sensitive to a stranded headshot-side `materialize_asset_faces` job.

### 4. Progress UI can stay "in progress" forever

Project matching progress marks work active if any relevant job is `queued` or `processing`:

- `supabase/migrations/20260327120000_023_request_uri_safety.sql:57`
- `supabase/migrations/20260327120000_023_request_uri_safety.sql:63`

A permanently stuck `processing` row can therefore keep project UI in a false "matching in progress" state indefinitely.

### 5. Replay after code fixes is weak everywhere

Any bug fix that requires rerunning existing logical work is harder than it should be because dedupe keys act like permanent job identity, not just duplicate suppression.

This affects:

- reprocessing after matcher bugs
- reprocessing after materializer bugs
- replay after compare-version or materializer-version changes when the dedupe key does not change
- repair after partial writes

### 6. `reconcile_project` is present in types but not used as a true repair primitive

The job type exists in schema and worker branching:

- `src/lib/matching/auto-match-jobs.ts:8`
- `src/lib/matching/auto-match-worker.ts:1825`

But the reconcile route currently enqueues intake jobs directly instead of dispatching a durable project-level repair workflow:

- `src/lib/matching/auto-match-reconcile.ts:157`
- `src/lib/matching/auto-match-reconcile.ts:197`
- `src/lib/matching/auto-match-reconcile.ts:274`

So there is no first-class "scan project state and repair any missing work" job today.

## Test Coverage Gaps

Current tests prove happy-path behavior, but not the failure mode seen here.

Covered today:

- reconcile backfills when jobs are missing entirely
- materialized pipeline dedupes compare work across both trigger directions
- project matching progress reflects queued/processing work

Relevant tests:

- `tests/feature-010-auto-match-backbone.test.ts:465`
- `tests/feature-019-face-materialization-pipeline.test.ts:431`
- `tests/feature-021-project-matching-progress.test.ts:253`

Not covered today:

- worker crash after claim but before complete/fail
- worker crash after materialization write but before downstream compare enqueue
- reconcile against a stale `processing` dedupe row
- reconcile against a `succeeded` row that needs replay
- photos-first / consent-later where the consent-side orchestration is interrupted

## Preventing This Class Of Bug

### 1. Add lease expiry and stale claim recovery

The queue needs a real lease model.

Minimum change:

- treat `processing` rows with `locked_at < now() - lease_timeout` as reclaimable
- reclaim them in `claim_face_match_jobs(...)`
- reset `locked_by`, `locked_at`, and optionally increment a reclaim counter

Without this, any worker crash can wedge logical work indefinitely.

### 2. Separate duplicate suppression from replay semantics

Current enqueue semantics collapse these two ideas:

- "do not create duplicate concurrent work"
- "never rerun this logical work unless the dedupe key changes"

Those should be separate.

Better model:

- keep a stable `work_key` / dedupe key for logical identity
- allow explicit requeue of an existing row when the caller is performing repair or replay

Examples:

- `enqueue_face_match_job(..., p_requeue_if_terminal boolean)`
- `requeue_face_match_job_by_dedupe_key(...)`
- `repair_face_match_job(...)`

Reconcile should use repair/requeue semantics, not plain enqueue semantics.

### 3. Make project-level repair explicit

Add a durable repair path that answers:

- which photos should currently compare against which opted-in headshots?
- which materializations should exist for current assets?
- which compare jobs or compare rows are missing for current versioned pairs?

This should be a first-class repair workflow, not a best-effort re-enqueue of intake events.

### 4. Make orchestration steps idempotent and restart-safe

For `materialize_asset_faces`, the durable invariant should be:

- if current eligible opposite-side materializations exist, then missing current compare jobs or compare rows should eventually be created

That implies restart-safe logic after partial completion:

- materialization row exists but compare fan-out incomplete
- some compare rows exist, some do not
- same job replays after partial success

Current compare dedupe keys are already versioned and can support safe replay:

- `src/lib/matching/auto-match-jobs.ts:92`

The missing piece is reliable replay/recovery.

### 5. Add observability for stuck work

At minimum, surface:

- oldest queued job age by type
- oldest processing job age by type
- count of processing jobs older than lease timeout
- compare scheduling lag between materialization time and first compare enqueue
- projects with `is_matching_in_progress = true` but no lock movement for N minutes

Without this, the queue can silently degrade until users notice missing matches.

### 6. Add an operator-safe repair tool

The current recovery is manual SQL. That is not good enough for repeated production incidents.

Need at least one of:

- internal admin route to requeue a job by id
- internal admin route to repair a dedupe key
- internal project repair route that scans and re-enqueues missing materialize/compare work

## Recommendations For A More Robust Matching Queue

### Recommendation A: add lease timeout to claim

Highest-priority queue fix.

`claim_face_match_jobs(...)` should claim:

- `queued` rows that are due
- `processing` rows whose lease has expired

This is the smallest change that fixes the "worker died after claim" wedge.

### Recommendation B: add explicit requeue semantics on dedupe conflict

Second highest priority.

`enqueue_face_match_job(...)` should support one or both of:

- leave existing row untouched for normal intake dedupe
- requeue terminal or stale rows when the caller is performing reconcile/repair

That preserves idempotent intake while allowing real repair.

### Recommendation C: introduce periodic repair/sweeper job

A sweeper can:

- reclaim stale `processing` rows
- requeue dead or stale orchestration jobs when upstream state still requires them
- scan for missing compare jobs for current versioned materialization pairs

This is the operational safety net the current system lacks.

### Recommendation D: use heartbeats for long-running work

If some matching jobs can take long enough that lease timeout becomes ambiguous, workers should heartbeat/extend lease while active.

That avoids false reclaim on legitimately long jobs.

### Recommendation E: add queue lineage and repair metadata

Useful additions:

- `reclaimed_at`
- `reclaim_count`
- `last_heartbeat_at`
- `requeued_by`
- `requeue_reason`
- `source_job_id`

This will make incident debugging far easier than inferring from timestamps and payloads.

## Recommended Regression Tests

### Queue recovery

- claim a job, simulate worker death before `complete`/`fail`, verify lease expiry makes it claimable again
- reconcile against an existing stale `processing` row, verify it is requeued or otherwise repaired
- reconcile against an existing `succeeded` intake row when downstream compare work is missing, verify repair happens

### Materialized pipeline partial failure

- `materialize_asset_faces` writes materialization successfully, then throws before compare enqueue, verify rerun schedules missing compares
- photos-first / consent-later with many existing photo materializations, then interrupt headshot-side orchestration, verify repair path backfills compares

### UI/observability

- stale processing row does not keep project progress in false active state forever once lease has expired or the sweeper has reclaimed it

## Conclusion

The current bug is real and is not primarily a face-matching quality issue. It is a queue recovery problem.

The verified defect is:

- a `materialize_asset_faces` job can be stranded in `processing`
- the queue has no stale-lock recovery
- dedupe conflict prevents replay
- reconcile only replays missing rows, not stuck or terminal rows

That explains why "consent first, photos later" often works while "photos first, consent later" can fail: the latter relies on a single consent-side orchestration path to backfill existing photos, and that path currently has no durable recovery once wedged.

The highest-value fixes are:

1. add lease expiry / stale processing reclaim
2. add explicit requeue/repair semantics beyond dedupe-only enqueue
3. add a project-level repair path for missing materialize/compare work
4. add regression tests for worker interruption and partial orchestration failure
