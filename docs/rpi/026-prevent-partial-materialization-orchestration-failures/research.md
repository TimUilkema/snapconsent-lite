# Feature 026 Research: Prevent Partial Materialization-Orchestration Failures

## 1. Scope and method

This research is code-first. Repository code is treated as ground truth; existing RPI docs are used to understand intent and recent design history.

Read and verified:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `README.md`
- `docs/rpi/README.md`
- relevant RPI docs:
  - `004-project-assets`
  - `006-headshot-consent`
  - `009-matching-foundation`
  - `010-auto-face-matching`
  - `011-real-face-matcher`
  - `012-manual-review-likely-matches`
  - `013-match-results-observability`
  - `015-headshot-replace-resets-suppressions`
  - `017-face-result-geometry-and-embeddings`
  - `019-face-materialization-deduped-embedding-pipeline`
  - `020-materialized-headshot-resolution-bug`
  - `021-project-matching-progress-ui`
  - `025-matching-queue-robustness`

Primary code inspected:

- `src/lib/matching/face-materialization.ts`
- `src/lib/matching/auto-match-worker.ts`
- `src/lib/matching/auto-match-jobs.ts`
- `src/lib/matching/auto-match-reconcile.ts`
- `src/lib/matching/auto-match-repair.ts`
- `src/lib/matching/materialized-face-compare.ts`
- `src/lib/matching/project-matching-progress.ts`
- `src/app/api/internal/matching/worker/route.ts`
- `src/app/api/internal/matching/reconcile/route.ts`
- `src/app/i/[token]/consent/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`
- `src/lib/assets/finalize-project-asset-batch.ts`
- relevant matching migrations
- relevant matching tests

Note:

- `SUMMARY.md` was requested but is not present at the repository root in the current checkout.

This document covers prevention of the failure class where materialization succeeds durably enough to leave reusable state behind, but the orchestration job fails before compare fan-out, leaving matching stranded until a later repair.

## 2. Current relevant code structure

### 2.1 Intake paths

Current matching intake paths are all server-side and tenant-scoped:

- Public consent submit:
  - `src/app/i/[token]/consent/route.ts`
  - calls `submitConsent(...)`
  - when the submission is non-duplicate, `face_match_opt_in=true`, and a headshot asset is present, it enqueues `consent_headshot_ready`
- Staff headshot replacement:
  - `src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts`
  - replaces canonical headshot link, clears photo suppressions for that consent, then enqueues `consent_headshot_ready`
- Staff photo finalize:
  - `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`
  - finalizes the asset and enqueues `photo_uploaded` for photos
- Batch photo finalize:
  - `src/lib/assets/finalize-project-asset-batch.ts`
  - loops finalized items and enqueues `photo_uploaded` for photos

All four intake paths intentionally swallow enqueue errors and rely on later backfill:

- consent submit
- headshot replacement
- single photo finalize
- batch finalize

That remains true after Feature 025. Queue robustness improved, but intake still treats enqueue as best-effort.

### 2.2 Queue and worker architecture

Current queue model:

- table: `public.face_match_jobs`
- dedupe key uniqueness: `(tenant_id, project_id, dedupe_key)`
- job types:
  - `photo_uploaded`
  - `consent_headshot_ready`
  - `reconcile_project`
  - `materialize_asset_faces`
  - `compare_materialized_pair`

Current worker entrypoint:

- `src/app/api/internal/matching/worker/route.ts`
- token-protected
- calls `runAutoMatchWorker(...)`

Current reconcile entrypoint:

- `src/app/api/internal/matching/reconcile/route.ts`
- token-protected
- calls `runAutoMatchReconcile(...)`

Current repair entrypoint is separate and project-scoped:

- `src/lib/matching/auto-match-repair.ts`
- materialize-focused repair/backfill for a project

### 2.3 Materialized pipeline lifecycle

In `AUTO_MATCH_PIPELINE_MODE=materialized_apply` or `materialized_shadow`, the worker runs a staged pipeline:

1. intake jobs (`photo_uploaded`, `consent_headshot_ready`, `reconcile_project`) do not compare directly
2. intake jobs enqueue `materialize_asset_faces`
3. `materialize_asset_faces` ensures the current asset/headshot face materialization exists
4. `materialize_asset_faces` fans out `compare_materialized_pair` jobs
5. `compare_materialized_pair` ensures a versioned compare row exists
6. in `materialized_apply`, current compare rows are applied to canonical pair state

This means compare fan-out is not stored as an independent invariant. It is an effect of the `materialize_asset_faces` orchestration step completing successfully.

## 3. Current schema involved

### 3.1 Queue

`face_match_jobs`

- durable queue rows with tenant/project scope
- unique logical work identity by dedupe key
- lease-aware ownership from Feature 025:
  - `lock_token`
  - `lease_expires_at`
  - `reclaim_count`
  - `requeue_count`
  - `last_requeued_at`
  - `last_requeue_reason`
- repair primitive exists in SQL:
  - `requeue_face_match_job(...)`

Relevant current invariant:

- queue recovery is stronger than before, but queue recovery does not prevent helper-level partial-success bugs inside a claimed job

### 3.2 Materialization state

`asset_face_materializations`

- one row per `(tenant_id, project_id, asset_id, materializer_version)`
- stores materialization header state:
  - provider metadata
  - face count
  - usability for compare
  - timestamps

`asset_face_materialization_faces`

- one row per `(materialization_id, face_rank)`
- stores persisted face rows:
  - provider face index
  - face box
  - embedding

These two tables are the durable materialized execution inputs for the versioned compare pipeline.

### 3.3 Compare state

`asset_consent_face_compares`

- one row per versioned pair:
  - `(tenant_id, project_id, consent_id, asset_id, headshot_materialization_id, asset_materialization_id, compare_version)`
- stores the compare result and winning face metadata

This makes compare replay and dedupe safe once compare jobs are actually scheduled.

### 3.4 Canonical pair state

`asset_consent_links`

- canonical approved link table
- primary key `(asset_id, consent_id)`
- stores both:
  - headshot-consent links
  - photo-consent links
- preserves manual authority via trigger and worker filtering

`asset_consent_link_suppressions`

- exact-pair suppression table
- primary key `(asset_id, consent_id)`
- used to block auto recreation after manual unlink

### 3.5 Observability / review tables touched by replay

`asset_consent_match_candidates`

- latest-state review-band table
- primary key `(asset_id, consent_id)`

`asset_consent_match_results`

- job-scoped observability table
- unique `(job_id, asset_id, consent_id)`

`asset_consent_match_result_faces`

- per-face evidence for persisted result rows
- primary key `(job_id, asset_id, consent_id, face_rank)`

These are already replay-safe because writes are upserts keyed by exact pair or exact job/pair.

## 4. Current matching/materialization lifecycle, verified

### 4.1 Consent submit with headshot

Current flow:

1. public consent submit route validates form data
2. `submitConsent(...)` writes consent state and canonical headshot link
3. route enqueues `consent_headshot_ready`
4. worker claims `consent_headshot_ready`
5. in materialized modes, worker enqueues `materialize_asset_faces` for the headshot asset
6. worker later claims `materialize_asset_faces`
7. `ensureAssetFaceMaterialization(...)` persists or reuses the headshot materialization
8. worker loads eligible photo materializations and enqueues `compare_materialized_pair`
9. compare jobs eventually write compare rows and possibly canonical auto links

### 4.2 Staff headshot replacement

Current flow:

1. route validates tenant, project, consent, and replacement asset
2. old headshot link(s) are removed
3. new headshot link is upserted
4. suppressions for that consent are cleared
5. route enqueues `consent_headshot_ready`
6. downstream worker flow is the same as consent submit

### 4.3 Photo finalize

Current flow:

1. finalize route or batch helper marks photo uploaded
2. route/helper enqueues `photo_uploaded`
3. worker claims `photo_uploaded`
4. in materialized modes, worker enqueues `materialize_asset_faces` for the photo asset
5. worker later claims `materialize_asset_faces`
6. `ensureAssetFaceMaterialization(...)` persists or reuses the photo materialization
7. worker loads eligible headshot materializations and enqueues `compare_materialized_pair`
8. compare jobs eventually write compare rows and possibly canonical auto links

### 4.4 Worker-driven materialization contract

The current materialization helper contract is in `ensureAssetFaceMaterialization(...)`.

Current behavior:

1. load eligible asset metadata
2. try to load existing materialization row by `(tenant, project, asset, materializer_version)`
3. if existing row exists:
   - load materialized face rows
   - return existing materialization as success
4. if no existing row:
   - call provider materializer
   - upsert materialization header row
   - upsert face rows
   - load face rows again from DB
   - return the materialization and faces

Important verified properties:

- “row already exists” is already treated as success
- retries already reuse existing materialization rows
- the helper already returns enough state for the orchestration step
- the helper is not purely write-through; it still depends on follow-up reads to produce its return value

### 4.5 Compare fan-out behavior

Current fan-out is deterministic from current state:

- photo-side materialization:
  - load eligible consent headshot materializations
  - enqueue versioned compare jobs for each current headshot materialization against the materialized photo
- headshot-side materialization:
  - load eligible consent ids for that headshot asset
  - load eligible photo materializations
  - enqueue versioned compare jobs for each current photo materialization

Compare dedupe identity is versioned and explicit:

- consent id
- asset id
- headshot materialization id
- asset materialization id
- compare version

That means compare scheduling is already replay-safe if the orchestration step re-runs.

## 5. Exact `face_materialization_lookup_failed` path

### 5.1 Where the error code is raised

The `face_materialization_lookup_failed` code currently comes from `src/lib/matching/face-materialization.ts` in two places:

- `loadMaterializationFaces(...)`
  - throws `"Unable to load materialized faces."`
- `loadAssetFaceMaterialization(...)`
  - throws `"Unable to load face materialization."`

Those are the only current sources for this error code.

### 5.2 Verified correction to the initial problem statement

The initial failure statement is only partially accurate against current code.

What is not true anymore:

- the helper does not write the materialization row and then immediately reload that same row from DB before continuing

What is true:

- the helper still depends on additional DB reads after or around the durable write
- if those reads fail, the job fails before compare fan-out

Current exact helper behavior after a new materialization write:

1. upsert materialization header row
2. upsert face rows
3. reload face rows via `loadMaterializationFaces(...)`
4. return

So the current fragile step is not “re-read the just-written materialization row.” It is:

- pre-existing row lookup before work, or
- post-write face-row lookup after work

### 5.3 Why the worker currently needs the helper return value

`processMaterializeAssetFacesJob(...)` currently calls `ensureAssetFaceMaterialization(...)` and then uses:

- `ensured.asset`
- `ensured.materialization`

It does not actually use `ensured.faces` for compare fan-out.

This is a critical research finding:

- the orchestration step does not need the just-written face rows in memory in order to schedule downstream compare jobs
- it only needs to know the asset type, scope, and materialization id/version

That means the current post-write face-row reload is stricter than orchestration requires.

### 5.4 Most likely current failure class

The current recurring failure class is:

1. `materialize_asset_faces` starts
2. provider materialization succeeds
3. materialization header row is upserted
4. face rows are upserted
5. helper performs a follow-up lookup and throws `face_materialization_lookup_failed`
6. job fails before compare fan-out
7. compare jobs are missing even though reusable materialized state exists

The same class also applies when a retry encounters an existing materialization row and the read path fails before returning success.

## 6. Verified current partial-success behavior

### 6.1 What happens today if materialization write succeeds but fan-out does not

Current behavior:

- the durable materialization row may already exist
- the durable face rows may already exist
- the claimed `materialize_asset_faces` job still fails
- `failFaceMatchJob(...)` marks it retryable for 5xx-style errors
- no compare jobs are enqueued on that failed run

So the system can end up in a valid durable materialized state but an incomplete orchestration state.

### 6.2 Is the system replay-safe from that point

Partly yes, but not by default.

What is already safe:

- `ensureAssetFaceMaterialization(...)` reuses existing materialization rows
- compare-job dedupe is versioned and replay-safe
- compare writes are idempotent
- canonical apply writes are idempotent
- repair/requeue semantics from Feature 025 can replay the missing materialize job

What is not yet safe enough:

- the materialize step itself still depends on fragile helper reads
- successful durable materialization does not automatically imply downstream compare fan-out
- recovery still depends on a later retry or repair path

### 6.3 Can the same class occur elsewhere

Yes. This is a general orchestration weakness, not a Tom-only edge case.

It can occur in:

- consent headshot intake
- headshot replacement
- photo-side materialization
- project repair
- reconcile-triggered replay
- any future path that calls `ensureAssetFaceMaterialization(...)` and then fans out compare work

The reason is simple:

- all of these paths converge on the same `materialize_asset_faces` job type and the same helper

## 7. Current replay and repair behavior

### 7.1 Reconcile

Current reconcile:

- scans a bounded recent window
- requeues `photo_uploaded` and `consent_headshot_ready` rows using repair-aware queue semantics
- does not directly repair compare fan-out gaps
- does not scan the full project

So reconcile is bounded backfill, not a durable prevention mechanism for this failure class.

### 7.2 Project repair

Current project repair:

- resolves tenant from `projectId` server-side
- scans current uploaded project photos and current consent headshots
- requeues `materialize_asset_faces` work directly
- marks those jobs with `repairRequested=true`
- relies on the same materialization/orchestration helper path

This is why project repair can recover the missing compare-fan-out case, but it is still a manual recovery tool, not the actual prevention fix.

## 8. Current compare fan-out safety and idempotency

### 8.1 What is already good

Current compare fan-out is fundamentally derivable from current state:

- if a headshot materialization exists and current photo materializations exist, compare jobs can be re-derived
- if a photo materialization exists and current headshot materializations exist, compare jobs can be re-derived

Current idempotency protections are already strong:

- compare job dedupe keys are versioned
- compare rows are unique on the versioned pair
- canonical links are upserted on `(asset_id, consent_id)`
- candidate rows are upserted on `(asset_id, consent_id)`
- result rows and face evidence rows are upserted by deterministic keys

### 8.2 What is missing

The missing piece is not compare-side idempotency. It is the materialize-step guarantee that:

- once durable materialization exists, downstream fan-out should still happen or be safely recoverable by rerunning the same job

Today that guarantee is indirect rather than explicit.

## 9. Scope of the failure class across the app

### 9.1 Headshot-side materialization

Vulnerable:

- new consent with headshot
- headshot replacement
- project repair requeue of headshots

If the helper fails after durable writes, compares against existing photos are never scheduled.

### 9.2 Photo-side materialization

Also vulnerable:

- photo finalize
- batch finalize
- project repair requeue of photos
- reconcile replay of recent photos

If the helper fails after durable writes, compares against current headshots are never scheduled.

### 9.3 Currentness checks after compare

`processCompareMaterializedPairJob(...)` revalidates whether the compared materialized pair is still current using:

- `loadConsentHeadshotMaterialization(...)`
- `loadCurrentAssetFaceMaterialization(...)`

This is a separate post-compare currentness check and not the same failure class, but it is another area where read fragility affects orchestration.

Also note:

- `loadConsentHeadshotMaterialization(...)` still resolves the current consent headshot through `loadCurrentHeadshotAssetForConsent(...)`
- that helper still broad-scans `asset_consent_links` for the consent and filters headshots later
- that is a separate structural weakness already discussed in Feature 020 history

### 9.4 Conclusion on scope

The Tom Cruise incident is not a special-case route bug. It is a general weakness in the current `materialize_asset_faces` orchestration contract.

## 10. Tests and regression gaps

### 10.1 What is already covered

Existing tests already cover:

- materialized compare dedupe across both trigger directions
- project repair recovering a manually-created “materializations exist but compare jobs missing” state
- photos-first / consent-later recovery via project repair
- compare replay safety
- stale lease recovery and repair-aware requeue semantics
- progress ignoring stale processing rows

### 10.2 What is not covered

Current tests do not directly cover the specific failure class for this feature:

- provider/materialization write succeeds, then helper read fails before compare fan-out
- `ensureAssetFaceMaterialization(...)` succeeds far enough to leave durable state behind but still throws
- headshot-side partial orchestration failure without manual repair
- photo-side partial orchestration failure without manual repair
- in-process recovery behavior for post-write lookup failure
- ability to continue fan-out without reloading face rows that are not needed for fan-out

This is the main regression gap for Feature 026.

## 11. Candidate prevention approaches

### Option A: Use the just-written materialization row directly

Meaning in current codebase:

- keep using `materializationRow` returned by the upsert
- avoid any unnecessary post-write read before fan-out
- return enough data for orchestration success without requiring `loadMaterializationFaces(...)`

Fit with current code:

- very strong
- `processMaterializeAssetFacesJob(...)` only needs:
  - asset identity/type
  - materialization id
  - face count / usability metadata
- it does not need the freshly loaded face rows in memory to enqueue downstream compare jobs

Correctness:

- good, if the helper contract is tightened to say that materialization success for orchestration does not require a post-write face-row reread

Race safety:

- good, because compare jobs later load persisted materialization and face rows from DB

Complexity:

- low

Limitation:

- this only reduces one fragile step; it does not by itself make the whole orchestration explicitly stage-safe

### Option B: Retry lookup in-process before failing

Meaning:

- when `loadAssetFaceMaterialization(...)` or `loadMaterializationFaces(...)` fails in the helper, retry a few bounded times before surfacing failure

Correctness:

- useful for transient DB/PostgREST hiccups

Race safety:

- acceptable if retries are small and scoped to internal helper reads

Complexity:

- low to medium

Limitation:

- this treats the symptom
- it still leaves orchestration correctness dependent on a read that may not be needed for fan-out

### Option C: Make orchestration explicitly stage-safe and replay-safe

Meaning:

- treat “materialization exists” and “compare fan-out missing” as a normal recoverable state
- ensure rerunning `materialize_asset_faces` always derives missing compare work from current durable state
- avoid hidden assumptions that a first successful write must also complete the whole stage atomically

Correctness:

- strongest option

Race safety:

- good, because compare job and compare-row dedupe already exist

Complexity:

- medium

Important observation:

- the codebase is already close to this model
- project repair proves that re-running `materialize_asset_faces` can re-derive compare work safely
- the missing part is making the normal orchestration path itself robust enough not to strand on unnecessary helper reads

### Option D: Combine the above

Meaning:

- remove unnecessary post-write dependency for fan-out
- add bounded helper retries around genuinely necessary reads
- make the `materialize_asset_faces` stage explicitly replay-safe from current durable state

Correctness:

- best fit

Race safety:

- best fit with current architecture

Complexity:

- medium, still bounded

Fit with current repo:

- strongest overall fit
- does not redesign queue ownership
- does not redesign canonical link semantics
- uses existing versioned compare dedupe and idempotent writes

## 12. Risks and edge cases

- Duplicate retries:
  - safe if compare job fan-out continues to use current versioned dedupe keys
- Worker crash after write:
  - materialize rerun must re-derive compare jobs without rematerialization errors or duplicate canonical writes
- Missing storage object:
  - should still fail cleanly before materialization, not be treated as successful partial materialization
- No faces found:
  - should still persist a valid unusable materialization and allow downstream semantics to treat it as non-matchable
- Multi-face headshot:
  - current usability rules mark it unusable for compare; orchestration should still complete deterministically
- Tenant scoping:
  - all helper reads and fan-out queries must remain tenant/project constrained
- Double fan-out:
  - safe only if compare job dedupe remains versioned and deterministic
- Canonical link duplication:
  - currently prevented by PK/upsert; prevention fix must preserve this
- Observability duplication:
  - currently prevented by deterministic upserts; prevention fix must preserve this
- Headshot replacement:
  - reruns must operate on the current headshot asset/materialization, not stale links
- Stale currentness assumptions:
  - compare apply already revalidates currentness; prevention fix should not weaken that

## 13. Security and tenancy

Current security model remains appropriate for this feature:

- worker/reconcile/repair use service-role clients server-side only
- tenant is never trusted from the client
- public consent flow derives context from invite token
- staff flows derive tenant from server-side membership resolution
- compare scheduling and materialization queries are tenant/project scoped in code

The prevention fix does not need any client-facing trust boundary changes. It should remain entirely server-side and internal.

## 14. Verified current behavior summary

### 14.1 What happens today after headshot materialization succeeds

Current verified behavior:

- helper may already have persisted:
  - materialization header row
  - materialization face rows
- orchestration still fails if helper follow-up reads throw
- no compare fan-out happens on that failed run

### 14.2 Does compare fan-out depend on fragile re-lookup

Yes, but more narrowly than the original problem statement suggested.

It does not depend on reloading the just-written materialization header row.

It does currently depend on helper-level reads that are stricter than fan-out actually needs, especially:

- face-row reload after write
- existing materialization/face read path on reruns

### 14.3 Is partial success currently recoverable without manual repair

Partially:

- automatic retry may recover if the failure is transient
- but if the helper keeps failing, the normal pipeline still strands
- current durable recovery is repair/requeue, not inherent orchestration resilience

So the current system is replay-capable, but not yet self-stabilizing for this failure class.

## 15. Recommendation for the Plan phase

The Plan phase should choose a bounded combined approach, centered on prevention rather than more repair tooling.

Recommended direction:

1. Tighten the contract of `ensureAssetFaceMaterialization(...)`
   - successful durable materialization for orchestration should not require unnecessary post-write rereads
   - return enough state for fan-out using the row already returned by the write path
2. Add bounded in-process retry only for genuinely necessary helper reads
   - especially existing-row reuse reads
3. Make `materialize_asset_faces` explicitly stage-safe
   - if durable materialization already exists, rerun should continue to derive missing compare fan-out as normal behavior
4. Add focused regression tests for:
   - post-write helper read failure after durable writes
   - headshot-side partial orchestration failure
   - photo-side partial orchestration failure
   - rerun/fan-out safety without duplicate compare or canonical rows

The Plan phase does not need to redesign the queue again. Feature 025 already added the lease/requeue repair substrate. Feature 026 should now harden the materialization/orchestration step itself so repair is fallback only, not the normal escape hatch for partial success.
