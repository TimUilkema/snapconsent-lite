# Feature 030 Plan: Continuation Retry Reliability

## Inputs And Ground Truth

This plan is based on:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- verified research in `docs/rpi/029-complete-bounded-matching-fanout/research.md`
- verified plan intent in `docs/rpi/029-complete-bounded-matching-fanout/plan.md`
- verified research in `docs/rpi/030-continuation-retry-reliability/research.md`

Repository code and current schema are the source of truth. This plan is grounded in the verified current implementation in:

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

## Verified Current State

Feature 029 already shipped the right high-level continuation architecture:

- bounded continuation fan-out
- materialization-first orchestration
- cursor advancement only after batch finalize
- version-aware compare dedupe
- repair/reconcile pathways that can recreate or reset continuation state

The verified reliability hole is narrower:

- a retryable downstream scheduling failure inside `processClaimedFanoutContinuation(...)` throws
- `fail_face_match_fanout_continuation(...)` eventually converts that retryable failure into `dead`
- normal same-source continuation enqueue does not reset terminal rows
- dead continuations are not surfaced as degraded state in project progress
- normal continuation batches treat a deduped downstream terminal job row as good enough and can advance the cursor without re-establishing the missing work

That means Feature 030 does not need another fan-out redesign. It needs a tighter continuation failure model and stricter downstream scheduling semantics.

Old behavior:

- retryable continuation scheduler failures can become `dead`
- `dead` is permanent for normal orchestration
- terminal downstream dedupe rows can silently satisfy scheduling attempts
- project progress can look idle or complete while correctness is degraded

New behavior required by this feature:

- retryable continuation scheduler failures remain nonterminal
- continuation batches only advance when missing downstream work is either already durable or now queued/processing
- `dead` is reserved for true invariant/corruption failures
- progress/health exposes degraded continuation state without leaking internal error detail

## Options Considered

### Option A: Keep `dead` semantics and rely on same-source auto-reset

Pros:

- smaller SQL diff
- directly revives dead continuations on later same-source events

Cons:

- still uses `dead` too aggressively for normal retryable scheduler failures
- still leaves the currently running source stranded until another same-source event occurs
- does not solve the downstream terminal-dedupe edge case by itself
- still makes eventual completeness partially depend on outside replay

### Option B: Add a new continuation status such as `stalled` or `degraded`

Pros:

- makes degraded state explicit in continuation rows
- avoids overloading `dead`

Cons:

- adds state machine complexity without being necessary for correctness
- still requires the worker to decide what to do with exhausted retryable failures
- does not reduce the need for stricter downstream scheduling semantics

### Option C: Keep the existing statuses, make retryable scheduler failures nonterminal, and harden downstream scheduling

Pros:

- narrowest fix that addresses the verified bug directly
- keeps bounded fan-out and materialization-first behavior unchanged
- avoids broad schema churn
- preserves `dead` for true nonretryable invariant/corruption failures only
- directly fixes the downstream terminal-dedupe edge case

Cons:

- requires SQL function updates for continuation failure handling
- requires explicit progress/health semantics for degraded retrying continuations

## Recommendation

Choose **Option C**.

This is the smallest fix that preserves Feature 029's architecture while removing repair as a dependency for normal completeness.

The chosen direction is:

- keep the existing continuation statuses
- stop dead-lettering retryable continuation scheduler failures
- use strict continuation-local scheduling helpers so a missing compare/materialize result is never treated as successfully scheduled unless the work is already durable or actively queued
- expose degraded continuation state in project progress/health
- only auto-revive same-source dead continuations as a backward-compatible escape hatch for retryable scheduler-failure rows, not as the primary design

## Chosen Architecture

### Exact continuation states after this fix

Keep the existing continuation states:

- `queued`
- `processing`
- `completed`
- `superseded`
- `dead`

No new continuation table and no new continuation status are needed.

What changes is the meaning:

- `completed`
  - boundary exhausted successfully
- `superseded`
  - source is no longer current or eligible
- `dead`
  - only for genuinely unrecoverable invariant/corruption failures
- `queued`
  - includes retrying continuations that hit downstream scheduler/infrastructure failures and are waiting on backoff

### Old vs New failure lifecycle

Old:

- retryable downstream scheduler failure
- requeue a few times
- eventually `dead`
- normal flow cannot revive it

New:

- retryable downstream scheduler failure
- persist error details on the continuation row
- increment attempt count
- keep the continuation `queued` with bounded backoff
- retry until the scheduler failure clears, the source is superseded, or a true nonretryable invariant failure is reached

### Preferred same-source behavior

Preferred design:

- same-source normal flow should not be required to revive ordinary retryable continuation failures, because those failures no longer become terminal

Compatibility behavior:

- same-source normal continuation enqueue should still be able to reset an existing `dead` continuation when that dead row is from the old retryable scheduler-failure class
- this reset should be targeted, not blanket
- do not auto-reset normal `completed` or `superseded` rows
- do not auto-reset true invariant/corruption dead rows

That gives the repo a clean forward path without leaving pre-fix dead rows permanently stranded.

## Failure Classification

### Continuation outcomes to preserve

Keep the current non-exception business-terminal flow:

- source no longer current -> `superseded`
- consent revoked / opt-out -> `superseded`
- empty boundary -> `completed`
- exhausted boundary -> `completed`

### Retryable scheduler/infrastructure failures

Treat these as nonterminal continuation failures:

- downstream `enqueue_face_match_job(...)` failure (`face_match_enqueue_failed`)
- downstream `requeue_face_match_job(...)` failure (`face_match_requeue_failed`)
- continuation claim/complete race outcomes already handled as lost lease
- transient PostgREST / DB / network failures during batch scheduling and required batch reads when they surface as retryable worker errors

Persistence rules:

- store `last_error_code`
- store `last_error_message`
- store `last_error_at`
- increment `attempt_count`
- set `run_after` using bounded backoff
- keep `status = 'queued'`

### True terminal dead-letter conditions

`dead` should remain possible, but only for nonretryable continuation failures such as:

- explicit nonretryable invariant validation errors raised by continuation code
- impossible continuation row contract mismatches that indicate corruption, not normal business supersession
- other `HttpError.status < 500` failures intentionally raised as nonretryable continuation invariants

This keeps business-terminal state, orchestration retry state, and invariant failure state distinguishable.

## Bounded Retry And Backoff Semantics

### Retryable scheduler failures should never transition to `dead`

For this feature, the answer is **no**.

Retryable continuation scheduler failures should not become `dead`.

### Replacement lifecycle

Use the existing queued-with-backoff model, but remove retryable dead-lettering for continuations:

- continue incrementing `attempt_count`
- continue persisting `last_error_*`
- continue using capped exponential backoff through `run_after`
- keep the current per-attempt backoff ceiling bounded
- do not cap total retry attempts for retryable continuation failures

This preserves bounded worker pressure without making eventual completeness depend on repair.

### `max_attempts` handling

No new column is required.

For continuations:

- retain `max_attempts` on the row for compatibility with the current schema and wrappers
- stop using it to dead-letter retryable continuation scheduler failures
- continue allowing nonretryable failures to transition directly to `dead`

This is narrower than introducing a new exhausted-but-not-dead state.

## Downstream Scheduling Semantics

### Current problem

Continuation batches currently do this:

- if durable compare state already exists, skip
- else call normal enqueue helper
- if enqueue does not throw, continue

That is too weak because a terminal deduped downstream job row can still satisfy the call path without guaranteeing the missing work will actually happen.

### New rule

A continuation batch may advance past an opposite-side item only when one of these is true:

1. the required durable state already exists now
2. the required downstream job is now queued
3. the required downstream job is actively processing
4. the required downstream terminal row was successfully reset and is now queued again

Anything less is not successful scheduling.

### Compare job scheduling

When a versioned compare row is missing:

- do not use plain enqueue semantics from the continuation batch
- use a strict internal scheduling helper that guarantees the compare work is effectively pending or durable
- reuse the existing `repair_requeue` / `requeue_face_match_job(...)` behavior so dead or otherwise terminal deduped compare jobs can be reset in normal continuation flow when the compare row is still missing

Accepted successful outcomes:

- compare row already exists
- compare job newly enqueued
- compare job requeued from terminal state
- compare job already queued
- compare job already processing

Rejected outcomes:

- deduped compare job in terminal state while the compare row is still missing
- impossible requeue result that leaves no durable compare row and no active/pending compare job

Rejected outcomes must fail the continuation batch without advancing the cursor.

### Materialize job scheduling

When the opposite-side current materialization is missing:

- do not use plain enqueue semantics from the continuation batch
- use the same strict scheduling rule through `repair_requeue` behavior

Accepted successful outcomes:

- current materialization already exists
- materialize job newly enqueued
- materialize job requeued from terminal state
- materialize job already queued
- materialize job already processing

Rejected outcomes:

- deduped materialize job in terminal state while the current materialization is still missing
- impossible requeue result that leaves no current materialization and no active/pending materialize job

### Why this is preferred

This keeps:

- bounded fan-out
- materialization-first behavior
- idempotent job scheduling
- existing queue dedupe and repair-requeue primitives

while removing the silent "terminal dedupe counts as success" hole.

## SQL / Schema Changes

### Recommendation

Add a small SQL migration that amends existing Feature 029 continuation functions.

No new table is needed.
No new continuation status is needed.

### Required SQL changes

#### 1. `app.fail_face_match_fanout_continuation(...)`

Change the failure transition rules:

- retryable failure:
  - always update to `queued`
  - increment `attempt_count`
  - set bounded `run_after`
  - clear lease fields
  - persist `last_error_*`
  - do not set `completed_at`
  - do not transition to `dead`
- nonretryable failure:
  - transition to `dead`
  - set `completed_at`
  - persist `last_error_*`

Update the public wrapper accordingly.

#### 2. `app.enqueue_face_match_fanout_continuation(...)`

Keep normal dedupe behavior for:

- `queued`
- `processing`
- `completed`
- `superseded`

Add targeted normal-flow reset behavior for:

- existing `dead` continuation rows whose `last_error_code` indicates the old retryable scheduler-failure class

That reset should:

- clear the cursor
- clear `last_error_*`
- reset `attempt_count`
- set `status = 'queued'`

Do not use this path to auto-reset true invariant/corruption dead rows.

#### 3. `app.get_project_matching_progress(...)`

Keep current `total_images` and `processed_images` semantics.

Add a degraded-health signal, for example:

- `has_degraded_matching_state boolean`

Recommended meaning:

- true if any continuation for the project is `dead`
- true if any continuation is `queued` or active `processing` with `attempt_count > 0` and `last_error_at is not null`

Keep `is_matching_in_progress` true for:

- queued continuations
- actively leased processing continuations
- existing active matching jobs

This avoids the false-idle / false-complete case.

### Column changes

No table column change is required for the preferred design.

Existing fields already cover:

- retry tracking
- bounded backoff
- degraded-state detection

## Worker And Library Changes

### 1. Continuation failure classification in worker code

Do not continue using the generic job-level retry classifier as the only continuation rule.

Add a continuation-local classification layer in `auto-match-worker.ts` so the worker can distinguish:

- `superseded` / `completed` business-terminal outcomes
- retryable scheduler/infrastructure failures
- true nonretryable continuation invariants

This avoids a generic "retry everything" design.

### 2. Strict continuation-local downstream scheduling helpers

In `auto-match-fanout-continuations.ts`, add dedicated internal helpers for:

- compare scheduling from continuation batches
- materialize scheduling from continuation batches

These helpers should:

- check whether the required durable state already exists
- otherwise use `repair_requeue` semantics to ensure the downstream job is active or pending
- treat terminal deduped rows without durable work as a failure to schedule
- throw a retryable scheduler error if the work still is not durable or pending

The continuation cursor must not advance when these helpers fail.

### 3. Cursor advancement rule

Keep the existing rule unchanged:

- cursor update remains the final write of the batch
- any failure before finalize leaves the cursor unchanged

The only change is that downstream scheduling must become stricter before the batch is allowed to finalize.

### 4. Compare/materialization durability checks

Use the durable state already in the repo:

- compare row existence in `asset_consent_face_compares`
- current materialization existence in `asset_face_materializations`

Do not add backlog tables or inline materialization work.

### 5. Same-source legacy dead-row recovery

Implement the targeted dead-row reset in continuation enqueue, not as a worker-side blanket override.

That keeps recovery tied to the normal continuation dedupe key and avoids broad reprocessing.

## Repair / Reconcile Semantics

### Repair remains secondary

Keep repair as an operator recovery tool and historical cleanup path.

After this feature:

- normal continuation retries should recover from retryable downstream scheduler failures without repair
- repair should still be able to reset true terminal rows and rebuild historical missing work when explicitly requested

### Repair behavior to preserve

Keep current repair semantics:

- project-scoped, internal-only
- tenant resolved server-side from project
- paginated source scan
- `repairRequested` reset behavior for materialize and continuation rows

No broad repair redesign is needed for Feature 030.

### Reconcile behavior to preserve

Keep reconcile as recent-window internal requeue.

No new reconcile behavior is required beyond remaining compatible with the updated continuation lifecycle.

## Project Progress And Health Behavior

### What progress should show after this fix

The project should no longer appear healthy when continuation correctness is degraded.

Required behavior:

- `isMatchingInProgress = true`
  - when continuations are queued or actively leased, including retry-backoff continuations
- `hasDegradedMatchingState = true`
  - when a continuation is retrying after scheduler failure
  - when a continuation is dead from a true invariant/corruption failure

This supports the important cases:

- all photos materialized, continuation still retrying -> in progress and degraded
- no active work left, but a true dead continuation exists -> not in progress, degraded

### What should not be exposed

Do not expose:

- raw SQL errors
- raw `last_error_message`
- tenant-crossing internal state

Expose only the coarse health signal needed to avoid false-idle / false-complete reporting.

## Security Considerations

- All updated continuation queries and SQL functions must remain tenant-scoped and project-scoped.
- Worker, repair, and reconcile remain internal token-protected routes.
- No client-provided `tenant_id` should be accepted anywhere in this feature.
- The targeted continuation reset logic must key off server-side continuation rows and error codes, not client input.
- Progress/health output must not expose internal error details beyond a coarse degraded-state boolean.

## Partial-Failure And Concurrency Cases

### Case: failure after some downstream jobs were enqueued but before continuation finalize

Expected behavior:

- already-created downstream jobs remain durable
- continuation cursor does not advance
- retry re-reads the same page
- existing compare rows are skipped
- existing queued/processing downstream jobs are accepted as already pending

### Case: worker crash during continuation batch

Expected behavior:

- same as Feature 029 crash safety
- stale lease reclaimed normally
- cursor unchanged until finalize
- already-created downstream jobs remain durable

### Case: repeated retryable enqueue failures

Expected behavior:

- continuation remains `queued`
- `attempt_count` increases
- `last_error_*` updates
- `run_after` uses bounded backoff
- no transition to `dead`

### Case: retry exhaustion semantics

Expected behavior:

- there is no retryable dead-letter cutoff for continuation scheduler failures
- bounded delay remains
- eventual completeness remains tied to clearing the underlying scheduler/infrastructure fault, not to manual repair

### Case: source superseded during retries

Expected behavior:

- continuation stops retrying once a claimed batch determines the source is no longer current or eligible
- row completes as `superseded`

### Case: consent revoked during retries

Expected behavior:

- continuation becomes `superseded`
- already-enqueued compare jobs still re-check currentness and consent eligibility before canonical apply

### Case: same-source event happens again after a continuation has stalled

Expected behavior:

- for a normal queued retrying continuation, no special reset is needed
- the same source reuses the existing active continuation

### Case: same-source event happens again after a continuation has died

Expected behavior:

- if the dead row is from the retryable scheduler-failure class, normal enqueue resets it
- if the dead row is a true invariant/corruption failure, do not silently auto-reset it

### Case: downstream deduped compare/materialize row already exists in terminal state

Expected behavior:

- continuation does not treat that as successful scheduling
- continuation uses requeue semantics to reset the downstream job if durable work is still missing
- if reset fails, the continuation batch fails retryably and does not advance the cursor

### Case: project appears idle or 100 percent processed while correctness is degraded

Expected behavior:

- `isMatchingInProgress` remains true for active queued retrying continuations
- `hasDegradedMatchingState` exposes the degraded condition
- dead invariant continuations remain visible as degraded even when no active work is running

## Implementation Phases

### Phase 1: SQL function updates

- add one migration that amends:
  - `app.fail_face_match_fanout_continuation(...)`
  - `public.fail_face_match_fanout_continuation(...)`
  - `app.enqueue_face_match_fanout_continuation(...)`
  - `public.enqueue_face_match_fanout_continuation(...)`
  - `app.get_project_matching_progress(...)`
  - `public.get_project_matching_progress(...)`
- keep the table structure and statuses unchanged

Verification:

- migration-backed tests for retryable queued retry behavior, targeted dead reset, and degraded progress visibility

### Phase 2: Worker-side continuation failure classification

- add continuation-local error classification in `auto-match-worker.ts`
- ensure retryable scheduler failures remain queued
- ensure nonretryable continuation invariants can still dead-letter

Verification:

- worker tests for retryable vs nonretryable continuation failures

### Phase 3: Strict downstream scheduling helpers

- add strict internal helpers in `auto-match-fanout-continuations.ts`
- switch continuation batches to these helpers for compare/materialize scheduling
- use existing repair-requeue primitives where durable work is missing behind a terminal dedupe row

Verification:

- tests for terminal dedupe row handling and same-page retry without cursor loss

### Phase 4: Progress / health plumbing

- update `project-matching-progress.ts` to read the new degraded-health field
- keep existing progress percentage behavior unchanged

Verification:

- progress tests for active degraded continuation and dead continuation visibility

### Phase 5: Regression coverage

- extend Feature 029 continuation tests
- extend Feature 021 progress tests
- update Feature 010 job robustness tests only where the continuation-compatible requeue semantics need direct verification

## Test Plan

Update or add coverage in:

- `tests/feature-029-complete-bounded-matching-fanout.test.ts`
- `tests/feature-021-project-matching-progress.test.ts`
- `tests/feature-010-auto-match-backbone.test.ts`

Required regression coverage:

### Mid-batch `face_match_enqueue_failed`

- inject a downstream enqueue failure after some compare/materialize jobs were already created
- verify the continuation cursor does not advance
- verify the continuation remains retryable and resumes automatically without repair

### Partial downstream job creation before failure

- verify jobs created before the failure remain durable
- rerun the worker
- verify no duplicate compare rows and no lost tail

### Retryable continuation resumption without cursor loss

- trigger the same retryable scheduler failure multiple times
- verify the continuation remains `queued`
- verify `attempt_count` increases and `last_error_*` persists
- verify eventual success once the injected failure is removed

### Exhausted retryable failure behavior

- drive the continuation past the old `max_attempts` threshold
- verify it still does not become `dead`
- verify backoff continues to apply and progress shows degraded state

### Same-source behavior after stalled or dead continuation

- stalled queued retrying continuation:
  - re-trigger the same source
  - verify the active continuation is reused, not duplicated
- dead retryable legacy continuation:
  - simulate a dead continuation row with retryable scheduler error code
  - re-trigger the same source
  - verify the continuation resets to `queued`

### Terminal downstream dedupe row does not silently skip missing work

- simulate a deduped `compare_materialized_pair` row in terminal state with no compare row
- verify continuation requeues or fails retryably instead of advancing the cursor
- simulate a deduped `materialize_asset_faces` row in terminal state with no current materialization
- verify the same behavior

### Nonretryable invariant failure behavior

- inject a continuation-local nonretryable invariant failure
- verify the continuation can still become `dead`
- verify progress/health shows degraded state without active progress

### Progress / health visibility

- active retrying continuation:
  - `isMatchingInProgress = true`
  - `hasDegradedMatchingState = true`
- dead continuation:
  - `isMatchingInProgress = false`
  - `hasDegradedMatchingState = true`
- healthy draining continuation:
  - `isMatchingInProgress = true`
  - `hasDegradedMatchingState = false`

### Repair still works, but is not required

- verify a retryable continuation failure clears through normal retries without repair
- verify repair can still reset true terminal rows when invoked explicitly

## Risks And Tradeoffs

### Infinite retry risk

Tradeoff:

- retryable continuation scheduler failures can now retry indefinitely

Why this is acceptable:

- delay remains bounded
- worker pressure remains bounded by `run_after`
- this preserves eventual completeness
- health/progress now exposes degraded state instead of hiding it

### Legacy dead rows

Tradeoff:

- existing dead rows from the old scheduler-failure lifecycle may remain in deployed databases

Mitigation:

- targeted normal same-source reset for retryable-dead rows
- repair continues to work for explicit recovery

### Strict downstream scheduling adds extra checks

Tradeoff:

- continuation batches will do slightly more logic around compare/materialize dedupe rows

Mitigation:

- reuse current durable tables and existing repair-requeue RPCs
- keep the checks narrow and only on missing durable work

### Progress API shape changes

Tradeoff:

- adding degraded health state slightly expands the progress contract

Mitigation:

- keep the new field coarse and internal
- do not expose raw error detail
- preserve existing `totalImages`, `processedImages`, and `progressPercent` semantics

## Implementation Prompt

Implement Feature 030 as a narrow continuation reliability fix.

Keep the existing `face_match_fanout_continuations` table and statuses, but change continuation failure handling so retryable downstream scheduler failures never dead-letter the continuation. Update the continuation SQL failure function to keep retryable failures `queued` with bounded backoff and persisted `last_error_*`, reserve `dead` for true nonretryable invariant/corruption failures, and add a targeted normal-flow reset path for existing `dead` continuation rows that were created by retryable scheduler failures. In the continuation batch code, replace plain downstream enqueue behavior with strict internal scheduling helpers that only count work as successfully scheduled when the required compare/materialization state already exists or the downstream job is now queued, processing, enqueued, or requeued. Use existing repair-requeue job semantics from the continuation path so terminal deduped downstream jobs with missing durable work are reset instead of silently skipped. Keep cursor advancement as the final batch write, preserve materialization-first behavior and version-aware compare dedupe, and update project progress to expose a coarse degraded-health signal without leaking raw internal errors. Add regression coverage for mid-batch `face_match_enqueue_failed`, partial downstream job creation, retrying continuations past the old retry threshold, legacy dead-row same-source reset, terminal downstream dedupe handling, degraded progress visibility, and repair still functioning as an operator recovery tool rather than a normal completeness requirement.
