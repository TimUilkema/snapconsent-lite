# Feature 018 Plan: Worker-Level Bounded Parallelism

## Implementation Progress

- [x] Add worker concurrency config parsing with safe defaults and caps.
- [x] Introduce bounded job-level parallel processing in the matching worker.
- [x] Keep worker route auth/contract unchanged apart from internal response visibility for resolved worker concurrency.
- [x] Add worker run and per-job failure observability.
- [x] Add tests for worker concurrency behavior and invariant preservation.
- [x] Document the new worker concurrency env/config.
- [x] Run quality gates and fix blocking issues found during lint, test, and build verification.

## 1. Ground-truth validation

### Verified in code

- `src/lib/matching/auto-match-worker.ts` currently claims up to `batchSize` jobs via `claimFaceMatchJobs(...)` and then processes the claimed jobs sequentially in a `for ... of` loop.
- Each claimed job is already handled through an isolated per-job path:
  - `processClaimedFaceMatchJob(...)` re-resolves current eligibility and candidates from the database.
  - matching is executed through the injected `matcher`.
  - writes are applied through existing idempotent helpers.
  - success is finalized with `completeFaceMatchJob(...)`.
  - failures are handled per job by `failFaceMatchJob(...)`.
- `src/lib/matching/providers/compreface.ts` already performs bounded concurrency inside a single job by using `mapWithConcurrency(...)` with `getAutoMatchProviderConcurrency()`.
- `src/lib/matching/auto-match-config.ts` currently exposes parsing for provider settings and persistence flags, but there is no worker-level concurrency setting yet.
- `src/app/api/internal/matching/worker/route.ts` currently accepts `batchSize` and `workerId`, validates the worker token, and delegates to `runAutoMatchWorker(...)`.
- `src/lib/matching/auto-match-jobs.ts` and the queue RPC usage confirm the current claim/complete/fail lifecycle:
  - claim marks jobs as `processing`
  - complete marks a job `succeeded`
  - fail either requeues with backoff or marks `dead`
- Matching invariants relevant to this feature are enforced today in server-side code and DB writes:
  - tenant/project scoping is explicit
  - manual links remain authoritative
  - suppressions block auto recreation
  - revoked or non-opt-in consents are skipped
  - replayed jobs remain retry-safe through current upsert/delete behavior

### Confirmed current worker behavior

- Worker-level concurrency is effectively `1` today, even when a batch contains multiple claimed jobs.
- Per-job failures do not fail the entire worker run today; the worker catches job errors individually and continues through the batch.

### Confirmed current provider concurrency behavior

- Provider-level concurrency is already separate from worker behavior.
- `AUTO_MATCH_PROVIDER_CONCURRENCY` is parsed and capped in config, and the CompreFace matcher uses it to process candidate pairs concurrently inside one job.
- This means Option E can be implemented without changing provider strategy.

### Confirmed queue lifecycle

- Jobs are claimed in batches from the queue.
- A claimed job is completed or failed individually.
- Retry vs dead behavior is already determined per job based on the thrown error and current failure policy.

### Code/docs mismatches relevant to this plan

- `docs/rpi/018-compreface-performance-efficiency/research.md` correctly called out that the code already has provider-level concurrency but still processes claimed jobs sequentially at the worker layer.
- `reconcile_project` exists in matching job types, but the current reconcile route re-enqueues `photo_uploaded` and `consent_headshot_ready` jobs rather than dispatching a distinct `reconcile_project` worker path.
- `.env.example` currently shows persistence flags enabled, while `auto-match-config.ts` falls back to disabled when those env vars are unset. This does not block Feature 018 but should be noted when updating docs.

## 2. Step-by-step implementation plan

### Step 1: Add worker concurrency config parsing

- Add a new config helper in `src/lib/matching/auto-match-config.ts` for worker-level job concurrency.
- Parse a new env var, clamp it to a safe max, and fall back to `1` if unset or invalid.
- Keep parsing behavior server-side only and match the defensive style already used for provider settings.

### Step 2: Introduce bounded job-level parallel processing in the worker

- Update `src/lib/matching/auto-match-worker.ts` so claimed jobs are processed with bounded concurrency instead of a sequential loop.
- Reuse the existing per-job processing function rather than changing matcher semantics or queue semantics.
- Keep aggregation of worker counters deterministic and per job.
- Preserve the current behavior where one job failure is recorded and does not abort sibling jobs.

### Step 3: Keep route contract small and internal

- Keep `src/app/api/internal/matching/worker/route.ts` internally authenticated exactly as it is today.
- Do not add a request-body worker concurrency override in this feature; use env/config only.
- Optionally expose resolved worker concurrency in the route response only if needed for debugging and benchmark visibility.

### Step 4: Add focused worker observability

- Extend worker logging in `src/lib/matching/auto-match-worker.ts` so each run records:
  - claimed job count
  - resolved worker concurrency
  - elapsed run time
  - succeeded / retried / dead / skipped counts
- Keep per-job success/failure logs minimal and non-sensitive.

### Step 5: Add regression coverage

- Add targeted tests for worker concurrency behavior without changing matching semantics.
- Reuse existing matcher test patterns so the new tests fit the current suite.

### Step 6: Update env/docs

- Document the new worker concurrency env in `.env.example`.
- Update `README.md` only if the repository currently documents matching tuning knobs there and the new setting belongs beside provider concurrency.
- Do not change RPI research; document the implementation intent only in code-facing docs if needed.

## 3. Exact files to create/modify

Expected files to modify:

- `docs/rpi/018-compreface-performance-efficiency/plan.md`
- `src/lib/matching/auto-match-config.ts`
- `src/lib/matching/auto-match-worker.ts`
- `src/app/api/internal/matching/worker/route.ts`
- `.env.example`
- `README.md`
- `tests/feature-011-real-face-matcher.test.ts`

Optional additional test file only if the worker test becomes too large to keep maintainable:

- `tests/feature-018-worker-concurrency.test.ts`

No migration file is planned.

## 4. Worker concurrency design details

### Where concurrency is introduced

- Introduce bounded concurrency inside `runAutoMatchWorker(...)`, after jobs have already been claimed and before individual job completion/failure handling.
- Do not change queue claiming, matcher input construction, reconcile behavior, or provider request semantics.

### How claimed jobs are processed concurrently

- After claim, dispatch claimed jobs through a small concurrency-limited runner.
- Each runner task should:
  - call the existing `processClaimedFaceMatchJob(...)`
  - on success, contribute its counters to the run summary
  - on error, call the existing fail path for that specific job and contribute the right retry/dead counters

### How each job remains isolated

- Each claimed job continues using its own job id, tenant id, project id, and payload.
- Matching reads and writes stay scoped to that job's pair resolution path.
- No mutable shared state should be used for business decisions; only final run counters are aggregated centrally.

### Failure isolation

- A failure in one job must not reject the entire worker invocation.
- The concurrency runner should collect per-job outcomes and allow sibling jobs to finish.
- Final worker output remains an aggregate summary over the batch.

### Complete/fail lifecycle preservation

- Success still calls `completeFaceMatchJob(...)` once per job.
- Failure still calls `failFaceMatchJob(...)` once per job.
- The worker must not attempt batch-complete or batch-fail semantics.

### Idempotency and retry behavior under concurrent execution

- The queue still prevents the same job from being claimed twice in the same processing wave.
- Existing pair/result upserts and deletes remain unchanged, so reruns continue to be safe.
- If the same project has multiple different jobs running concurrently, current canonical/manual/suppression guards still decide the final state server-side during each job's write phase.
- Retries remain per job. A timed-out or retryable job can be requeued while sibling jobs from the same worker run succeed.

## 5. Config/env details

### Proposed env var

- `AUTO_MATCH_WORKER_CONCURRENCY`

### Default value

- Default to `1` to preserve current behavior unless explicitly enabled.

### Max cap

- Cap at `8` for the first iteration.
- Reason: worker concurrency multiplies with `AUTO_MATCH_PROVIDER_CONCURRENCY`, so an aggressive cap would make overload too easy.

### Parsing and validation behavior

- Accept positive integers only.
- Invalid, zero, negative, empty, or non-numeric values fall back to `1`.
- Values above the cap are clamped to the cap.

### Safe fallback behavior

- If parsing fails, the worker behaves exactly as it does today.
- This keeps rollout safe and avoids accidental production fan-out from bad config.

### Interaction with existing provider concurrency

- Effective parallel CompreFace work is approximately:
  - `worker_concurrency * provider_concurrency`
- This multiplier should be called out in code comments and docs because it is the main overload risk in this feature.

### Recommended initial values

- Start with `AUTO_MATCH_WORKER_CONCURRENCY=2`
- Keep `AUTO_MATCH_PROVIDER_CONCURRENCY` conservative during rollout if it is already high in local or production environments.

## 6. Logging / observability details

### Per worker run

- Log:
  - `workerId`
  - claimed count
  - resolved worker concurrency
  - batch size requested
  - elapsed duration
  - succeeded / retried / dead / skipped counts
  - total scored pairs and candidate pairs if already part of the current summary

### Per job success/failure

- Log:
  - job id
  - job type
  - tenant/project identifiers only if already logged in existing internal logs
  - elapsed job duration
  - outcome class: succeeded, retried, dead, skipped_ineligible
  - retryable provider error code where applicable

### Sensitive-data handling

- Do not log:
  - invite tokens
  - storage paths
  - raw face evidence
  - embeddings
  - full provider payloads in worker summary logs
- Keep error logging to sanitized codes/messages already used by provider and worker internals.

### Useful benchmark metrics

- Throughput per worker invocation
- Average jobs completed per second
- Retry rate
- Dead-letter rate
- Mean and tail worker run duration
- Mean and tail per-job duration

## 7. Security considerations

- Tenant/project isolation remains unchanged because job payload resolution and DB writes stay in the current server-side matching code.
- Internal-only worker access remains unchanged because `MATCHING_WORKER_TOKEN` protection is not being modified.
- No client trust boundary changes are introduced; concurrency is controlled only by server config.
- Config parsing remains defensive and server-side.
- No sensitive error details should be surfaced beyond current internal behavior.
- The change must not weaken:
  - biometric opt-in checks
  - revocation handling
  - manual authority rules
  - suppression behavior
- No new service-role usage is introduced beyond the existing internal worker model.

## 8. Edge cases

### Duplicate or replayed worker invocations

- Claim semantics remain the first line of defense.
- Concurrent worker invocations can still safely coexist because only claimed jobs are processed.

### Stale claimed jobs

- Existing failure/retry handling remains unchanged.
- This feature does not alter stale-lock recovery logic.

### Partial success within a worker batch

- Expected and supported.
- The worker should return mixed aggregate counts rather than fail the entire invocation.

### Provider timeout for one job while others succeed

- The timeout job should be retried or dead-lettered according to existing error policy.
- Sibling jobs should still finish and complete normally.

### Concurrent manual link during worker processing

- Existing write-time manual-authority checks must remain the source of truth.
- Auto-upsert behavior should continue to skip or preserve manual links exactly as today.

### Concurrent manual unlink / suppression during worker processing

- Existing suppression checks at write time must continue to block auto recreation.

### Consent revoked during async processing

- Existing eligibility resolution should continue to skip the job if the consent is no longer eligible when processed.

### Headshot replaced during processing

- Existing re-resolution of headshot/current consent state should remain authoritative for that job's execution path.

### Large job batches causing overload

- Bounded worker concurrency and a hard cap are the main mitigation.
- Batch size is not the same as concurrency and should remain independently configurable.

### Invalid worker concurrency config

- Must fall back to `1`.
- The worker should optionally log the resolved value rather than throwing during request handling.

### Race conditions caused by concurrent job execution

- This feature increases overlap between independent jobs, so tests must confirm current canonical/manual/suppression invariants still hold.
- The implementation must not introduce shared mutable business state across tasks.

## 9. Testing plan

### Unit / small-scope tests

- Add tests for `AUTO_MATCH_WORKER_CONCURRENCY` parsing if `auto-match-config.ts` already has direct unit-testable helpers or if a new helper is introduced there.
- Verify:
  - unset => `1`
  - invalid => `1`
  - zero/negative => `1`
  - above cap => clamped

### Integration tests for worker bounded parallelism

- Add a test that enqueues multiple jobs, uses a matcher that blocks briefly, and asserts max in-flight job execution reaches the configured limit but not beyond it.
- Add a test proving one job failure does not fail sibling jobs in the same worker batch under concurrent execution.

### Regression tests for unchanged semantics

- Re-run and keep green the existing matching tests that already cover:
  - auto link creation
  - below-threshold stale auto-link removal
  - manual link authority
  - suppression blocking
  - revocation and opt-out ineligibility
  - retryable vs dead provider failures
  - result persistence idempotency
  - face evidence persistence constraints

### Canonical/manual/suppression verification

- Add or extend a test so concurrent processing does not change current canonical outcomes for:
  - manual links
  - suppressed links
  - revoked / non-opt-in consents

### Commands

- `npm run lint`
- `npm test`

### Database reset requirement

- `supabase db reset` should not be required because no schema or migration change is planned for Option E.

## 10. Rollout / benchmark plan

### Conservative starting point

- Start with:
  - `AUTO_MATCH_WORKER_CONCURRENCY=2`
  - current provider concurrency unchanged or reduced if it is already set aggressively

### Small benchmark matrix

- Test combinations such as:
  - worker `1` x provider `2`
  - worker `2` x provider `2`
  - worker `2` x provider `4`
  - worker `4` x provider `2`
- Avoid jumping directly to high-high combinations because total parallel verification requests multiply quickly.

### What to monitor

- Worker throughput
- Queue depth and drain rate
- Retry/dead-letter rate
- Mean and tail job duration
- CPU utilization on app host and CompreFace host
- GPU utilization on CompreFace host
- Signs of provider saturation such as request timeouts or rising latency

### Rollback / fallback

- Set `AUTO_MATCH_WORKER_CONCURRENCY=1` to revert to current behavior without code rollback.
- If needed, also reduce `AUTO_MATCH_PROVIDER_CONCURRENCY` to bring total parallelism back down quickly.

## 11. Verification checklist

- Claimed jobs are processed concurrently up to a bounded worker-level limit.
- Default behavior remains unchanged when the new env var is absent or invalid.
- One job failure does not fail the full worker invocation.
- Queue claim / complete / fail behavior remains per job.
- Matching semantics, thresholds, candidate resolution, and provider flow remain unchanged.
- Manual links remain authoritative.
- Suppressions still block auto recreation.
- Revoked and non-opt-in consents remain ineligible.
- Tenant/project scoping remains server-side and unchanged.
- No schema migration is required.
- Internal worker auth remains unchanged.
- Logs provide enough run/job summary data to benchmark throughput safely without leaking biometric or storage details.
