# Feature 026 Plan: Prevent Partial Materialization-Orchestration Failures

## 1. Chosen architecture

### Recommendation

Choose **Option C: bounded combined prevention**.

That means:

- tighten the `ensureAssetFaceMaterialization(...)` contract so orchestration success does not depend on unnecessary post-write reads
- add small helper-local retries for genuinely necessary reads
- make `materialize_asset_faces` explicitly safe to rerun from current durable state
- add focused regression coverage for the partial-success failure class

### Why this option

It is the smallest plan that actually prevents the verified failure class.

Option A alone is too narrow:

- it removes the most obvious unnecessary reread
- but it does not explicitly define replay-safe behavior for existing durable materialization with missing fan-out

Option B is better, but still incomplete:

- retries reduce fragility
- but retries alone do not make the stage contract explicit

Option C fits one RPI cycle because the repo already has the necessary substrate:

- queue lease/requeue behavior from Feature 025
- deterministic compare-job dedupe
- idempotent compare rows
- idempotent canonical apply writes
- existing repair flow already proves `materialize_asset_faces` replay can safely re-derive fan-out

This feature should not redesign queue ownership, repair tooling, compare currentness rules, or canonical link semantics.

### In scope now

- tighten helper contract around orchestration success
- reduce unnecessary helper rereads
- add bounded helper-local retries for necessary reads
- codify replay-safe `materialize_asset_faces` behavior
- add focused tests for headshot-side and photo-side partial-success replay

### Explicitly deferred

- queue redesign
- deeper repair/admin tooling
- compare pipeline redesign
- canonical link redesign
- broad cleanup of currentness-check read paths unrelated to this failure class
- broad headshot-resolution redesign beyond what is needed for these tests

## 2. Helper contract changes

### Current problem

`ensureAssetFaceMaterialization(...)` currently has one contract shape for two different needs:

- orchestration use in `processMaterializeAssetFacesJob(...)`
- full readback use where callers might need persisted face rows in memory

Today, the orchestration caller only needs:

- eligible asset metadata
- materialization header row

It does not need:

- freshly reread face rows

### Planned contract

Keep `ensureAssetFaceMaterialization(...)` as the primary helper, but make its behavior explicit:

1. **Successful enough for orchestration**
   - asset is eligible
   - durable materialization header row exists or was successfully written
   - durable face-row write succeeded when provider returned faces
   - helper can return asset + materialization even if face-row reread is unavailable

2. **Optional richer return**
   - persisted face rows should be loaded only when the caller actually needs them

### Planned helper shape

Add a narrow caller-controlled option, for example:

- `includeFaces?: boolean`

Behavior:

- `includeFaces: false`
  - helper returns asset + materialization without requiring face-row reread
  - this is the orchestration path used by `materialize_asset_faces`
- `includeFaces: true`
  - helper loads persisted face rows and returns the current full shape
  - use only where in-memory face rows are actually needed

This keeps the helper explicit and avoids hidden “best effort” behavior.

### Reads that remain necessary

For orchestration:

- eligible asset lookup
- existing materialization header lookup when reusing prior durable state
- materialization header write
- face-row write when provider returns faces

### Reads that become optional or deferred

For orchestration:

- post-write `loadMaterializationFaces(...)`

This read is stricter than fan-out requires and should not block compare scheduling.

## 3. Bounded retry behavior

### Retry scope

Add helper-local bounded retries only around genuinely necessary reads:

1. existing materialization header lookup
2. face-row lookup only when `includeFaces: true`

### Retry placement

Retry should be local to `face-materialization.ts`, not a new shared retry framework.

This keeps the change bounded and explicit.

### Retry count and timing

Use a very small retry policy, for example:

- 2 or 3 total attempts
- short delay only, tens of milliseconds to low hundreds
- no unbounded exponential retry loop

The goal is only to smooth over transient PostgREST / DB read hiccups, not to hide real persistent failures.

### Fail-fast cases

Still fail immediately for:

- asset eligibility failure
- provider materialization failure
- materialization header write failure
- face-row write failure
- invalid asset type / missing storage object / permanent lookup mismatch

Only necessary read fragility gets bounded retry.

## 4. Worker/orchestration changes

### `processMaterializeAssetFacesJob(...)`

Change the worker to call the helper in orchestration mode:

- `includeFaces: false`

This makes the stage depend only on:

- `ensured.asset`
- `ensured.materialization`

which is already all the worker uses for fan-out.

### Compare fan-out after durable materialization

After the helper returns asset + materialization:

- photo-side flow continues to load current eligible headshot materializations and enqueue versioned compare jobs
- headshot-side flow continues to load current eligible photo materializations and enqueue versioned compare jobs

No change is needed to compare dedupe or canonical apply semantics.

### Explicit stage-safe replay rule

Define `materialize_asset_faces` behavior explicitly:

- if the durable materialization already exists for the current version, rerunning the job is normal
- rerun should derive missing compare fan-out from current durable state
- duplicate compare enqueue attempts are acceptable because versioned compare dedupe already exists

This becomes a deliberate stage contract, not an incidental byproduct of repair.

### Headshot-side and photo-side coverage

Use the same helper/orchestration fix path for both:

- headshot-side `materialize_asset_faces`
- photo-side `materialize_asset_faces`

Do not ship a headshot-only patch. The weakness is shared by the same helper and stage.

## 5. Failure handling behavior

### Failures that should no longer strand durable materialization

- post-write face-row reread failure in orchestration mode

After this feature, that should not fail `materialize_asset_faces`, because orchestration does not need that reread.

### Failures that remain retryable job failures

- existing materialization header lookup still failing after bounded retry
- required face-row lookup still failing after bounded retry in `includeFaces: true` mode
- downstream fan-out read failures:
  - load eligible headshot materializations
  - load eligible photo materializations
  - load eligible consent ids for a headshot asset
- compare-job enqueue failures severe enough to abort the stage

These should still fail the job so normal queue retry / repair semantics can operate.

### Why this is acceptable

The goal is not to suppress real failures.

The goal is to stop failing on helper reads that are not required for compare fan-out after durable state is already safely written.

## 6. Stage-safe replay semantics

### Durable state case 1: materialization written, compare fan-out missing

Expected behavior after this feature:

- rerunning the same `materialize_asset_faces` job loads or reuses the durable materialization header
- worker derives compare fan-out from current durable state
- compare enqueue dedupe prevents duplicate active logical compare work

### Durable state case 2: existing materialization reused

Expected behavior:

- helper returns existing materialization header after bounded lookup retry
- worker fans out compare work again if missing

### Durable state case 3: unusable materialization

Expected behavior:

- helper still returns success if durable materialization exists and was written correctly
- worker completes stage deterministically
- fan-out may legitimately schedule zero compares or compares that later resolve to source-unusable/target-empty/no-match depending on side and current state

This preserves current no-face / multi-face semantics instead of conflating them with orchestration failure.

## 7. Schema / migration impact

### Recommendation

No schema change is needed for Feature 026.

### Why

Current schema already provides the required correctness substrate:

- durable materialization tables
- versioned compare dedupe
- queue lease/requeue behavior
- idempotent canonical and observability writes

This feature is about tightening helper and worker behavior, not changing persistence structure.

If implementation proves a tiny index or schema aid is unexpectedly required, that should be treated as out-of-scope unless clearly necessary for correctness. Current research does not justify it.

## 8. Implementation phases

### Phase 1: Tighten the helper contract

- update `ensureAssetFaceMaterialization(...)` to support orchestration-mode operation without requiring face-row reread
- keep the helper return shape explicit
- isolate the read paths that remain necessary

### Phase 2: Add bounded helper-local retries

- add a very small retry wrapper for:
  - existing materialization header lookup
  - face-row lookup when explicitly requested
- keep retry local to `face-materialization.ts`

### Phase 3: Update `materialize_asset_faces` orchestration

- call the helper in orchestration mode
- preserve current fan-out logic
- keep compare dedupe / payload / repairRequested semantics unchanged
- make replay behavior explicit in code comments where needed

### Phase 4: Add focused regression tests

- add a fault-injection style test seam using a wrapped Supabase client or narrow helper-level test hook
- cover post-write read fragility and replay safety

### Phase 5: Verify no regressions in existing matching robustness behavior

- rerun targeted matching tests
- ensure no duplication in compare rows, canonical links, candidates, or persisted results

## 9. Test plan

### Required new regression coverage

1. **Post-write helper read failure after durable writes**
   - simulate successful materialization header + face-row writes
   - force the post-write face-row read to fail
   - verify orchestration-mode helper still returns success
   - verify compare fan-out proceeds

2. **Headshot-side partial orchestration replay**
   - consent/headshot path materializes successfully
   - first run fails before compare fan-out or leaves fan-out missing
   - rerun of `materialize_asset_faces` safely enqueues missing compare jobs

3. **Photo-side partial orchestration replay**
   - photo path materializes successfully
   - compare fan-out is missing
   - rerun safely enqueues missing compare jobs

4. **No duplicate compare rows under replay**
   - repeated `materialize_asset_faces` replay must not create duplicate `asset_consent_face_compares`

5. **No duplicate canonical/candidate/result writes under replay**
   - repeated replay must not create duplicate:
     - `asset_consent_links`
     - `asset_consent_match_candidates`
     - `asset_consent_match_results`
     - `asset_consent_match_result_faces`

### Existing tests to preserve

Keep existing Feature 019 and Feature 010 robustness tests passing:

- materialized compare dedupe
- project repair replay
- photos-first / consent-later recovery
- compare replay safety
- stale lease / requeue behavior

### Test technique recommendation

For the new post-write fragility test, prefer a narrow fault-injecting Supabase wrapper in tests rather than adding production-only complexity.

That keeps runtime code clean while still proving the exact failure class.

## 10. Risks and tradeoffs

### Risk: hiding real DB failures

Tradeoff:

- removing unnecessary rereads is good
- but bounded retries on necessary reads can mask persistent problems if overdone

Mitigation:

- retry only necessary reads
- use very small retry counts
- still fail the job after retry exhaustion

### Risk: replay duplication

Tradeoff:

- making stage replay explicit increases the frequency of safe reruns

Mitigation:

- rely on already-existing versioned compare dedupe and idempotent apply writes
- add replay-focused regression tests

### Risk: partial-success ambiguity

Tradeoff:

- once helper contract distinguishes orchestration success from full reread success, the code must remain explicit about what “success” means

Mitigation:

- document orchestration-mode helper semantics clearly
- avoid vague “best effort” behavior

### Risk: scope creep into broader currentness cleanup

Tradeoff:

- other read fragility exists in compare currentness and headshot-resolution helpers

Mitigation:

- keep this feature focused on `materialize_asset_faces` partial-success prevention
- defer unrelated currentness cleanup unless implementation proves a direct blocker

## 11. Why this plan is enough for one cycle

This plan is intentionally narrow:

- no migration
- no route changes
- no queue redesign
- no canonical model changes
- no repair tooling expansion

It targets the exact failure point:

- durable materialization already exists
- helper read fragility still blocks compare fan-out

That is the smallest production-safe change that prevents the observed Tom/Brad-style failure class in the normal orchestration path.

## 12. Implementation prompt

Implement Feature 026 according to this plan:

- tighten `ensureAssetFaceMaterialization(...)` so orchestration success does not require unnecessary post-write face-row rereads
- add a narrow `includeFaces`-style helper mode or equivalent explicit contract so `processMaterializeAssetFacesJob(...)` can continue with just asset + materialization header state
- add small helper-local retries only for necessary materialization reads
- update `processMaterializeAssetFacesJob(...)` to use the orchestration-safe helper path while preserving existing compare dedupe and apply semantics
- add focused regression tests for:
  - post-write helper read failure after durable writes
  - headshot-side partial orchestration replay
  - photo-side partial orchestration replay
  - replay safety with no duplicate compare/canonical/result rows
- do not add schema changes unless implementation proves they are required for correctness
- do not redesign queue/requeue architecture or expand repair tooling in this feature
