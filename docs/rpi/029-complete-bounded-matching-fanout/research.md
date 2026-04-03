# Feature 029 Research: Complete Bounded Matching Fan-Out

## Goal

Research how to make the matching pipeline **eventually complete** for large projects without allowing a single intake job to explode in size.

The specific user-facing requirement is:

- creating a new consent/headshot while the worker cron is already running must still eventually compare that consent against all currently eligible project photos
- uploading a new photo while the worker cron is already running must still eventually compare that photo against all currently eligible consent headshots
- this must remain correct for large projects where total eligible pairs are much larger than the current per-job caps

This research is code-first. Existing RPI docs are intent only. Repository code and local database state are treated as ground truth.

## Inputs reviewed

Required docs:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`

Relevant prior RPI docs:

- `docs/rpi/019-face-materialization-deduped-embedding-pipeline/*`
- `docs/rpi/020-materialized-headshot-resolution-bug/*`
- `docs/rpi/025-matching-queue-robustness/*`
- `docs/rpi/026-prevent-partial-materialization-orchestration-failures/*`

Primary code inspected:

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
- `tests/feature-010-auto-match-backbone.test.ts`
- `tests/feature-019-face-materialization-pipeline.test.ts`
- `tests/feature-021-project-matching-progress.test.ts`

Local database was queried directly against the current project data provided by the user.

## Desired behavior

This is the behavior the implementation should satisfy:

1. A new consent/headshot must eventually be compared against **all** currently eligible project photos.
2. A new photo must eventually be compared against **all** currently eligible consent headshots.
3. This must remain true even if matching work is already running for the same project.
4. No single worker job should need to scan or enqueue the entire opposite side in one request.
5. Retries, replay, repair, and concurrent workers must remain idempotent and safe.
6. Large projects must drain through **multiple bounded jobs**, not through one giant job.
7. Large-project correctness must not depend on later unrelated uploads happening to backfill missed work.

Short version:

- **bounded per job**
- **complete over time**
- **safe under concurrency/retry**

## Current relevant endpoints and trigger paths

### Intake paths

Current matching intake is server-side and token/auth protected where appropriate:

- Photo finalize:
  - `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`
  - batch variant: `src/lib/assets/finalize-project-asset-batch.ts`
  - enqueues `photo_uploaded`

- Public consent submit:
  - `src/app/i/[token]/consent/route.ts`
  - enqueues `consent_headshot_ready`

- Staff headshot replacement:
  - `src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts`
  - enqueues `consent_headshot_ready`

### Internal worker/repair paths

- Worker cron endpoint:
  - `src/app/api/internal/matching/worker/route.ts`
  - calls `runAutoMatchWorker(...)`

- Reconcile endpoint:
  - `src/app/api/internal/matching/reconcile/route.ts`
  - calls `runAutoMatchReconcile(...)`

- Repair endpoint:
  - `src/app/api/internal/matching/repair/route.ts`
  - calls `runProjectMatchingRepair(...)`

These are all relevant because the current bug is not an intake-only bug. It is a fan-out/orchestration completeness bug.

## Current pipeline, verified from code

### Queue/job model

Current matching job types:

- `photo_uploaded`
- `consent_headshot_ready`
- `reconcile_project`
- `materialize_asset_faces`
- `compare_materialized_pair`

Defined in:

- `src/lib/matching/auto-match-jobs.ts`

### Materialized pipeline shape

In `AUTO_MATCH_PIPELINE_MODE=materialized_apply`:

1. intake jobs do not compare directly
2. intake jobs enqueue `materialize_asset_faces`
3. `materialize_asset_faces` ensures the current asset/headshot materialization exists
4. `materialize_asset_faces` fans out `compare_materialized_pair`
5. compare jobs upsert versioned compare rows and, in apply mode, canonical pair state

This is the current intended architecture and is correct in shape.

## Actual problem, verified in code

The current bug is **not** primarily a queue-stuck problem in the current workspace code.

The actual problem is:

- the pipeline applies a **hard per-job comparison cap**
- but instead of using that cap as a **batch boundary with continuation**, it uses the cap as a **truncation boundary**
- once the first batch is scheduled, the remaining opposite-side items are simply ignored

### Current cap

Current hard cap in worker code:

- `MAX_MATCH_CANDIDATES = 750`
  - `src/lib/matching/auto-match-worker.ts`

Current env-driven `AUTO_MATCH_MAX_COMPARISONS_PER_JOB` is normalized through the same bounded worker flow:

- `src/lib/matching/auto-match-config.ts`
- `src/lib/matching/auto-match-worker.ts`

### Raw pipeline truncation

Raw mode truncates both directions:

- `photo_uploaded`:
  - loads eligible consents and then `slice(0, maxComparisonsPerJob)`
  - `src/lib/matching/auto-match-worker.ts`

- `consent_headshot_ready`:
  - loads eligible project photos and then `slice(0, maxComparisonsPerJob)`
  - `src/lib/matching/auto-match-worker.ts`

Also, raw helper queries are already capped before slicing:

- `loadCurrentProjectConsentHeadshots(..., { limit: MAX_MATCH_CANDIDATES })`
- `loadEligibleProjectPhotoIds(...).limit(MAX_MATCH_CANDIDATES)`

So raw mode already has the same correctness problem.

### Materialized pipeline truncation

Materialized mode has the same issue in fan-out:

- photo-side materialize:
  - loads headshot materializations with `maxComparisonsPerJob`
  - then loops over `headshotMaterializations.slice(0, maxComparisonsPerJob)`
  - `src/lib/matching/auto-match-worker.ts`

- headshot-side materialize:
  - loads photo materializations with `limit(maxComparisonsPerJob)`
  - then stops scheduling when `scheduledPairs >= maxComparisonsPerJob`
  - `src/lib/matching/face-materialization.ts`
  - `src/lib/matching/auto-match-worker.ts`

This means the current materialized pipeline is **bounded but incomplete**.

## Verified local evidence from the user’s project

Project:

- `ce035696-e17e-4284-b80b-6d98eeecd2f4`

Tenant:

- `9bdde4b2-7187-4e16-907e-f4beab1cfdb2`

Observed current local state:

- uploaded photos: `2560`
- queue currently idle:
  - `0 queued`
  - `0 processing`
  - `9632 succeeded`

### Tom Cruise

- consent id: `cf6be91b-3ff8-47f0-8265-e049f18959e4`
- created at: `2026-03-28 18:45:16.428452+00`
- headshot asset: `5cb7a281-427c-4820-ab82-d47bee9aa1da`

Verified results:

- compare rows: `750`
- linked photos: `2`
- uncompared photos: `1810`

Only linked photos:

- `Henry Cavill_76.jpg`
- `Henry Cavill_78.jpg`

Tom’s compared assets are not “all photos that existed before Tom was created”. They are just the first bounded slice reached by the headshot-side fan-out path.

### Robnert downey

- consent id: `57115a93-559c-41c5-9cff-ba95ca2521a8`
- created at: `2026-03-28 18:44:45.796604+00`
- headshot asset: `d0ce943b-25b9-4b1f-9214-42e929fb0689`

Verified results:

- compare rows: `750`
- linked photos: `0`
- uncompared photos: `1810`

### Important conclusion from local data

The repeated `750` count is the key signal.

Tom and Robert were not missed because of:

- stale processing rows
- worker crashes
- missing materialization rows
- missing compare dedupe behavior

They were missed because the headshot-side backfill path only scheduled the first `750` compare jobs and then stopped.

## Why the user observed this during active worker processing

The timing matters, but not for the reason initially suspected.

### Consent-first then photos-later

If the consent exists first:

- every later `photo_uploaded` job is another chance to compare that photo against current headshots
- the system can eventually cover many photos through later photo-side work

### Photos-first then consent-later

If photos already exist first:

- the new consent depends on the headshot-side backfill path
- that path currently fans out only one bounded batch
- there is no continuation job or cursor to cover the rest

So “creating a consent while the worker cron is already running” can expose this, but the underlying defect is:

- **missing continuation semantics for bounded fan-out**

## Why simply removing the limit is not a safe fix

Removing limits would avoid this exact truncation bug, but it creates larger operational problems.

### What goes wrong if limits are removed

For a project with `50` headshots and `50,000` photos:

- total potential pairs: `2,500,000`

If one new consent tries to fan out against all existing photos in one `materialize_asset_faces` run:

- one worker request would try to inspect and enqueue tens of thousands of compare jobs at once
- request duration grows sharply
- DB round-trips and queue writes spike
- a single project can monopolize the worker
- lease timeout risk increases
- repair/replay becomes heavier
- fairness across projects gets worse

So “remove the cap” improves completeness by making boundedness and operational safety worse.

### Correct requirement

The right requirement is:

- keep per-job bounds
- do not truncate
- continue across multiple jobs until coverage is complete

## Current repair and reconcile paths do not solve this fully

### Reconcile

Current reconcile is bounded by recent windows and batch size:

- `src/lib/matching/auto-match-reconcile.ts`

It repairs missing recent intake rows, but it does not provide deep, guaranteed full-project completion for large existing opposite-side sets.

### Repair

Current project repair is also bounded:

- default batch size: `500`
- max batch size: `2000`
- `src/lib/matching/auto-match-repair.ts`

It scans current photos and headshots once, but it still reuses the same bounded materialize fan-out behavior underneath.

So repair is useful, but it is not yet a proof of complete large-project coverage.

## Relevant edge cases

These are the important edge cases the plan must handle.

### 1. New consent created while photo backlog already exists

Current failure case:

- only first bounded photo slice gets compare jobs
- remaining current photos are never compared unless some later unrelated event reintroduces them

### 2. New photo uploaded while many headshots already exist

Current code has the same shape on the opposite side:

- only first bounded headshot slice gets compare jobs
- for current user expectations this may not show up often because headshot counts are smaller today, but the bug exists symmetrically

### 3. New photos arrive while a headshot-side backfill is still paginating

Desired behavior:

- newly uploaded photos should still get their own intake path
- continuation of headshot-side work should not duplicate canonical results
- versioned pair dedupe must keep the state safe

### 4. Headshot replaced mid-backfill

Desired behavior:

- old headshot version should stop being the current source for future compare scheduling
- already queued compares for the old version can complete safely but should not be treated as current if superseded
- new headshot must eventually cover all current photos

### 5. Consent revoked or opt-out changed mid-backfill

Desired behavior:

- future compare scheduling should stop
- current compare/apply path should still re-check eligibility before canonical writes

### 6. Worker crash during a multi-batch fan-out

Desired behavior:

- already-enqueued continuation batches remain safe
- rerunning the parent orchestration should not lose progress or duplicate canonical state

### 7. Very large projects

Examples:

- `50+` consents
- `10k-50k` photos

Desired behavior:

- work drains through many bounded jobs
- one project does not starve all other projects
- no single orchestration request tries to enqueue the full cross-product

### 8. Fairness across projects

The worker cron endpoint claims batches globally:

- `src/app/api/internal/matching/worker/route.ts`
- `src/lib/matching/auto-match-worker.ts`

If one intake event turns into one huge job, fairness suffers.

A correct design for large projects needs to preserve:

- bounded per-job work
- interleaving across projects

## Current strengths that should be preserved

The existing architecture already has important good properties:

- versioned materializations
- versioned compare-job dedupe
- queue lease/requeue hardening from Feature 025
- partial-orchestration prevention improvements from Feature 026
- idempotent canonical pair writes
- repair/replay pathways already exist

This means the next feature does **not** need to redesign matching from scratch.

The missing piece is specifically:

- **bounded continuation over large opposite-side sets**

## Current test coverage gaps

Existing tests cover:

- materialized compare dedupe
- project repair replay
- photos-first / consent-later recovery in small-scale cases
- queue reclaim and repair behavior

But current tests do **not** cover:

- more eligible opposite-side items than `maxComparisonsPerJob`
- proof that all current photos/headshots are eventually covered after multiple bounded batches
- continuation behavior across multiple worker runs
- fairness / continuation semantics when large fan-out spans several batches

This is why the current truncation bug was able to exist despite substantial queue and replay coverage.

## Future scenarios that matter

### Scenario A: 50 headshots, 10k photos

- total potential pairs: `500,000`
- new consent/headshot must not rely on one giant fan-out
- backfill should progress through bounded continuation jobs

### Scenario B: 50 headshots, 50k photos

- total potential pairs: `2,500,000`
- deep backfill may take many worker cycles
- progress must still be eventual and safe

### Scenario C: ongoing intake while backlog exists

- cron worker is already running
- new photo uploads continue
- new consents continue
- the pipeline should converge without requiring operators to run repair manually

### Scenario D: replay after bug fix

- operators may need to rerun large projects safely
- continuation-based orchestration should make repair cheaper and more predictable than “one giant requeue”

## Research conclusion

The actual problem is:

- the matching pipeline currently treats `maxComparisonsPerJob` as a **terminal truncation cap**
- but the product needs it to be a **batch size for continued orchestration**

This affects:

- raw mode
- materialized mode
- normal intake behavior
- repair/backfill behavior

The current system is already strong on:

- replay safety
- queue recovery
- versioned compare dedupe

The missing behavior is:

- **complete bounded fan-out**

## Recommendation for the Plan phase

The next plan should focus on:

1. keeping per-job bounds
2. replacing truncating fan-out with paginated/continuation fan-out
3. making continuation idempotent and replay-safe
4. ensuring both directions are covered:
   - headshot -> many photos
   - photo -> many headshots
5. making repair able to resume or regenerate continuation safely for large projects
6. adding regression tests with opposite-side counts greater than the current cap

The plan should explicitly avoid the simplistic fix of “remove the limits”, because that would trade correctness for operational fragility.
