# Feature 030 Research: Continuation Retry Reliability

## Goal

Investigate why a `face_match_fanout_continuation` can become terminal or stalled after a mid-batch downstream enqueue failure, leaving matching completeness dependent on manual repair.

This research treats existing docs as intent only. Code, migrations, SQL functions, and current tests are the source of truth.

## Inputs reviewed

Required docs:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/029-complete-bounded-matching-fanout/research.md`
- `docs/rpi/029-complete-bounded-matching-fanout/plan.md`

Primary code and schema verified directly:

- `src/app/api/internal/matching/worker/route.ts`
- `src/app/api/internal/matching/repair/route.ts`
- `src/lib/matching/auto-match-worker.ts`
- `src/lib/matching/auto-match-jobs.ts`
- `src/lib/matching/auto-match-repair.ts`
- `src/lib/matching/auto-match-reconcile.ts`
- `src/lib/matching/auto-match-fanout-continuations.ts`
- `src/lib/matching/face-materialization.ts`
- `src/lib/matching/materialized-face-compare.ts`
- `src/lib/matching/project-matching-progress.ts`
- `supabase/migrations/20260306130000_010_auto_match_backbone_schema.sql`
- `supabase/migrations/20260306131000_010_auto_match_queue_functions.sql`
- `supabase/migrations/20260320140000_019_face_materialization_pipeline.sql`
- `supabase/migrations/20260327150000_025_matching_pipeline_robustness.sql`
- `supabase/migrations/20260403120000_029_complete_bounded_matching_fanout.sql`
- `tests/feature-010-auto-match-backbone.test.ts`
- `tests/feature-019-face-materialization-pipeline.test.ts`
- `tests/feature-021-project-matching-progress.test.ts`
- `tests/feature-029-complete-bounded-matching-fanout.test.ts`

Verification run:

- `npm test` completed successfully in the current workspace. Existing tests pass, but there is no regression coverage for a mid-batch downstream enqueue failure that exhausts continuation retries and then requires repair.

## Current verified behavior

### Exact continuation lifecycle today

Normal orchestration path:

1. Intake creates `photo_uploaded` or `consent_headshot_ready` in `face_match_jobs`.
2. Worker processes intake jobs in `runAutoMatchWorker(...)` and converts them into `materialize_asset_faces` jobs in `enqueueMaterializeJobForIntake(...)`.
3. `processMaterializeAssetFacesJob(...)` ensures the source materialization exists.
4. `processMaterializeAssetFacesJob(...)` then calls `createOrResetFanoutContinuationsForMaterializedAsset(...)`.
5. That function loads the intake boundary snapshot when available, falls back to a current boundary when not, and calls `enqueue_face_match_fanout_continuation(...)`.
6. Worker claims continuations with `claim_face_match_fanout_continuations(...)`.
7. `processClaimedFanoutContinuation(...)` loads the next bounded page, schedules downstream `compare_materialized_pair` or opposite-side `materialize_asset_faces` jobs, and returns the next cursor.
8. `complete_face_match_fanout_continuation_batch(...)` is the only place that advances the cursor.

### Continuation statuses and transitions

Verified from `20260403120000_029_complete_bounded_matching_fanout.sql`:

- `queued`
  - initial insert in `enqueue_face_match_fanout_continuation(...)`
  - successful batch with more work remaining
  - retryable failure in `fail_face_match_fanout_continuation(...)`
  - repair reset with `p_reset_terminal = true`
- `processing`
  - set by `claim_face_match_fanout_continuations(...)` for queued rows or stale leased rows
- `completed`
  - set by `complete_face_match_fanout_continuation_batch(...)` when `processClaimedFanoutContinuation(...)` says the boundary is exhausted or empty
- `superseded`
  - set by `complete_face_match_fanout_continuation_batch(...)` when the source is no longer current or eligible
  - photo source no longer eligible/current materialization
  - headshot consent no longer eligible/current headshot materialization
  - invalid headshot continuation missing `source_consent_id`
- `dead`
  - set only by `fail_face_match_fanout_continuation(...)` after an exception and retry exhaustion, or after a non-retryable exception

### Retryable vs terminal classification today

Verified in `auto-match-worker.ts`:

- `MatcherProviderError.retryable === true` => retryable
- `HttpError.status >= 500` => retryable
- unknown error => retryable
- `HttpError.status < 500` => terminal/non-retryable

Important nuance:

- many business-terminal continuation conditions do not throw; they return `superseded`
- `dead` is therefore not a business-terminal state, it is a retry-budget-exhausted failure state

### Continuation batch error path

Verified path for continuation batch errors:

1. `executeClaimedFaceMatchFanoutContinuation(...)`
2. `processClaimedFaceMatchFanoutContinuation(...)`
3. `processClaimedFanoutContinuation(...)`
4. downstream enqueue/load helper throws
5. catch in `executeClaimedFaceMatchFanoutContinuation(...)`
6. `failFaceMatchFanoutContinuation(...)`
7. SQL `fail_face_match_fanout_continuation(...)`
8. row becomes `queued` with backoff, or `dead`

### Cursor advancement behavior

Verified behavior:

- the cursor only advances in `complete_face_match_fanout_continuation_batch(...)`
- that completion write happens after downstream scheduling succeeds for the whole batch
- if an exception is thrown, the cursor does not advance

Verified edge case:

- continuation code treats a downstream enqueue call that returns an existing deduped row as success, even if that row is already terminal
- this matters because `enqueue_face_match_job(...)` is normal dedupe, not repair requeue
- if a downstream dedupe row already exists in `dead` state and its work has not actually produced the required compare/materialization, the continuation can still advance past it

That edge case is real in the current code, but it is not the primary repair-dependent failure described in the bug context.

### Same-source resurrection behavior

Normal orchestration does not automatically revive dead continuations.

Verified from `enqueue_face_match_fanout_continuation(...)` and `createOrResetFanoutContinuationsForMaterializedAsset(...)`:

- normal continuation enqueue uses `p_reset_terminal = false`
- existing `completed`, `superseded`, or `dead` rows are returned as-is
- normal same-source materialization does not clear the cursor or reset status
- repair uses `repairRequested: true`, which sets `p_reset_terminal = true`

So the current system requires explicit repair/reconcile-style reset to revive a dead continuation for the same source version.

### Progress / health visibility today

Verified in `app.get_project_matching_progress(...)`:

- `is_matching_in_progress` is true for queued or actively leased continuations
- dead continuations are ignored

Result:

- a project can show `processed_images = total_images`
- `progress_percent = 100`
- `is_matching_in_progress = false`
- while matching completeness is still wrong because a continuation is dead

This is a visibility gap.

## Exact failure path

The shipped code path for the reported bug is:

1. A `headshot_to_photos` continuation is created and starts draining normally.
2. `processClaimedFanoutContinuation(...)` loads a page of photos and begins enqueueing downstream jobs.
3. Some downstream jobs may already have been created successfully.
4. A later downstream enqueue throws `HttpError(500, "face_match_enqueue_failed", ...)` from `enqueueFaceMatchJob(...)` in `auto-match-jobs.ts`.
5. The exception aborts the batch before `complete_face_match_fanout_continuation_batch(...)` runs, so the cursor is not advanced.
6. `executeClaimedFaceMatchFanoutContinuation(...)` catches the error and calls `failFaceMatchFanoutContinuation(...)`.
7. Because the error is `HttpError.status = 500`, it is treated as retryable.
8. The continuation is requeued with backoff until `attempt_count + 1 >= max_attempts`.
9. On the exhausting failure, SQL marks the continuation `dead`.
10. A dead continuation is no longer claimable by the worker, is ignored by progress activity, and is not reset by later normal orchestration for the same source version.

This makes the remaining tail of the continuation unreachable in normal flow.

## Why repair was needed

`runProjectMatchingRepair(...)` scans current photos and current headshots, then requeues `materialize_asset_faces` jobs with `repairRequested: true`.

That matters because the repair path is the only path that currently does all of the following together:

- requeues terminal materialize/intake work with `repair_requeue`
- recomputes a fresh current fan-out boundary
- calls continuation enqueue with `resetTerminal: true`
- clears the dead continuation cursor/status and makes it claimable again

Repair is therefore not just "extra insurance" here. In the current implementation it is the only built-in mechanism that can revive a dead continuation for the same source version.

## Root cause

The root cause is not that `face_match_enqueue_failed` is initially marked non-retryable. It is initially retryable.

The root cause is that the continuation state machine uses `dead` too aggressively for orchestration-layer failures:

- downstream enqueue/materialize scheduling failures are infrastructure/orchestration failures, not source-terminal business states
- after bounded retry exhaustion they become `dead`
- `dead` is permanent for normal orchestration because same-source continuation enqueue does not reset terminal rows
- progress/health does not surface dead continuations as degraded

In other words:

- first-failure classification is mostly correct
- lifecycle classification is wrong for eventual completeness

Today a retryable scheduler failure can still become a permanent normal-flow stop condition.

## Explicit answers to the research questions

### 1. What is the exact continuation lifecycle today?

See "Current verified behavior". Intake -> materialize -> create continuation -> claim -> bounded page scheduling -> complete to `queued`/`completed`/`superseded`, or fail to `queued`/`dead`.

### 2. Under what conditions does a continuation move to each state?

- `queued`: insert, retryable failure, incomplete successful batch, repair reset
- `processing`: claim or reclaim of stale lease
- `completed`: boundary exhausted or empty while source is still current
- `superseded`: source asset/headshot/consent is no longer current or eligible
- `dead`: exception plus retry exhaustion or explicit non-retryable exception

### 3. What code path handles continuation batch errors?

`executeClaimedFaceMatchFanoutContinuation(...)` in `src/lib/matching/auto-match-worker.ts`, then `failFaceMatchFanoutContinuation(...)`, then SQL `fail_face_match_fanout_continuation(...)`.

### 4. Which errors are currently treated as retryable vs terminal?

- retryable: `HttpError >= 500`, `MatcherProviderError.retryable`, unknown errors
- terminal: `HttpError < 500`
- superseded source/currentness cases are handled without throwing

### 5. Is a mid-batch downstream enqueue failure currently classified incorrectly?

Partially.

- the first `face_match_enqueue_failed` is classified retryable, which is reasonable
- but retry exhaustion converts that same downstream scheduling failure into permanent `dead`
- that permanent state is incorrect for normal eventual completeness

### 6. Does the cursor only advance after successful batch scheduling, or are there edge cases?

- yes, cursor advancement is after successful batch finalize
- edge case: deduped downstream rows in terminal state can be treated as successful scheduling and allow cursor advance without restoring the missing work

### 7. If enqueue fails after some downstream jobs were created, what durable state exists and what happens on retry?

Durable state after the partial batch:

- already-created downstream `face_match_jobs` rows remain
- any already-completed compare rows remain
- continuation cursor remains unchanged

Retry behavior:

- same page is re-read
- already-created downstream jobs dedupe safely
- already-persisted compare rows are skipped
- this is idempotent

The failure is therefore not "lost progress". The failure is "eventual progress can still stop permanently after retry exhaustion".

### 8. Can the same source materialization later recreate or revive a dead continuation automatically?

No, not in normal flow.

Only repair-style reset with `resetTerminal: true` revives it.

### 9. What role is repair currently playing in restoring correctness after this failure?

Repair is currently the resurrection path for dead continuations. It rebuilds the normal orchestration entrypoint in a special reset mode that normal intake/materialize does not use.

### 10. What is the smallest robust fix direction?

The smallest robust fix direction is:

- keep bounded continuation batches exactly as they are
- keep cursor advancement as the last write of the batch
- keep materialization-first fan-out
- stop treating downstream scheduling failures as permanently terminal continuation failures

Concretely for Plan phase:

- reserve `completed` and `superseded` for true business-terminal states
- reserve `dead` for genuinely unrecoverable invariant/corruption cases, not ordinary downstream enqueue/materialize scheduling failures
- make downstream enqueue/materialize scheduling failures remain nonterminal after retry exhaustion, likely via a continuation failure transition that requeues with bounded backoff instead of becoming `dead`
- add explicit health/progress visibility for dead continuations if any remain possible

If the implementation keeps `dead` for exhausted retryable scheduler failures, then normal same-source continuation resurrection must also exist. That is a fallback, not the preferred primary fix.

## Risks and edge cases

### Failure after some downstream jobs are enqueued but before cursor update

Current behavior is safe:

- cursor does not advance
- already-created work stays durable
- retry is idempotent

### Worker crash during continuation batch

Current behavior is safe and already covered by Feature 029 tests:

- partial downstream jobs survive
- stale lease can be reclaimed
- cursor stays unchanged until finalize

### Source superseded during retries

Handled correctly today:

- photo continuations supersede if the source photo is no longer eligible/current
- headshot continuations supersede if consent is revoked/opted out or if the current headshot materialization changed

### Consent revoked during retries

Handled in two layers:

- continuation becomes `superseded` once consent is no longer eligible
- already-enqueued compare jobs re-check `consentEligible` before canonical apply

### Max retry exhaustion

This is the current bug boundary:

- continuation becomes `dead`
- normal orchestration cannot revive it
- completeness now depends on repair

### Dead continuation visibility

Current visibility is weak:

- progress reports active queued/processing continuations
- dead continuations disappear from `is_matching_in_progress`
- no current health signal marks the project as degraded/stalled

## Other similar bugs that can happen

These are adjacent correctness risks in the current implementation:

1. The same dead-or-stalled behavior can happen in `photo_to_headshots`, not just `headshot_to_photos`.
2. A dead downstream `materialize_asset_faces` or `compare_materialized_pair` dedupe row can cause a continuation to advance without actually recreating missing work, because normal enqueue does not repair-requeue terminal deduped jobs.
3. Dead continuations are invisible in project progress, so operators may see "idle" or "100% processed" while pair completeness is still wrong.
4. Normal same-source intake/materialization dedupe means repeated identical events do not self-heal terminal continuation state.
5. Continuations are only claimed in worker runs where all claimed `face_match_jobs` are compare jobs, or there are no claimed jobs. Under sustained intake/materialize load this can delay continuation draining and is an additional starvation risk, even though it is separate from the repair-dependent dead-state bug.

## Recommended fix direction for Plan phase

Plan should stay narrow and repo-specific:

1. Treat downstream enqueue/materialize scheduling failures as nonterminal orchestration failures.
2. Keep true terminal states limited to:
   - `completed`
   - `superseded`
   - genuinely unrecoverable continuation invariant failures
3. Add a continuation failure path that does not permanently dead-letter retryable scheduler failures.
4. Decide explicitly whether SQL needs a new nonterminal exhausted state or whether `queued` with backoff is sufficient.
5. Add health/progress visibility for dead/stalled continuations so incompleteness is not hidden.
6. Add regression tests for:
   - `face_match_enqueue_failed` after some downstream jobs were already created
   - retry exhaustion behavior for scheduler failures
   - same-source behavior after a dead continuation
   - dead continuation visibility in project progress/health
   - terminal downstream dedupe rows not silently skipping missing work

The preferred fix should make normal orchestration eventually complete without requiring repair. Repair should remain for manual recovery and historical cleanup, not as a dependency of normal correctness.
