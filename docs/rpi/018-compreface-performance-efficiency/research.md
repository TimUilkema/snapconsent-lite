# 018 CompreFace Performance Efficiency - Research

## Scope and method

This research is **code-first**. Existing RPI docs were read for context, but repository code and migrations are treated as ground truth.

Verified inputs:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/010-*`, `011-*`, `012-*`, `013-*`, `017-*`
- `src/lib/matching/*`
- `src/lib/matching/providers/compreface.ts`
- matching trigger routes:
  - `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`
  - `src/app/i/[token]/consent/route.ts`
  - `src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts`
- worker/reconcile routes:
  - `src/app/api/internal/matching/worker/route.ts`
  - `src/app/api/internal/matching/reconcile/route.ts`
- matching-related migrations and tests
- current env/config (`.env.example` and `.env.local` key values)
- upstream CompreFace docs:
  - https://github.com/exadel-inc/CompreFace/blob/master/docs/Rest-API-description.md
  - https://github.com/exadel-inc/CompreFace/blob/master/docs/Face-services-and-plugins.md
  - https://github.com/exadel-inc/CompreFace/blob/master/docs/Architecture-and-scalability.md
  - https://github.com/exadel-inc/CompreFace/blob/master/docs/Custom-builds.md

---

## 1) Current request pattern in code

## Trigger entry points

1. `photo_uploaded`
- Triggered from photo finalize route when finalized asset type is `photo`.
- Enqueue dedupe key: `photo_uploaded:<asset_id>`.

2. `consent_headshot_ready`
- Triggered from public consent submit route when: non-duplicate, `face_match_opt_in=true`, and headshot present.
- Triggered from staff headshot replacement route after new uploaded headshot link is written.
- Enqueue dedupe key: `consent_headshot_ready:<consent_id>:<headshot_asset_id>`.

3. Reconcile flow
- Reconcile route scans recent uploaded photos, recent signed opt-in consents, and recent uploaded headshots.
- It enqueues `photo_uploaded` / `consent_headshot_ready` jobs (not `reconcile_project` jobs in current route behavior).
- Reconcile scan bounds are independent per set and controlled by reconcile `batchSize`:
  - up to `R_photo` recent photos
  - up to `R_consent` recent consents
  - up to `R_headshot` recent headshots (which may map to linked consents)
- Provider calls happen later in worker, based on resulting enqueued jobs and dedupe status.

## Worker execution shape

- Worker claims up to `batchSize` jobs (`claim_face_match_jobs`) but processes claimed jobs **sequentially** in one request.
- Per job it resolves candidate pairs, then calls matcher once with all candidates.
- Provider (`compreface`) performs **one HTTP verify request per candidate pair**.

## Exact provider call math

Let:
- `N` = eligible uploaded photos in a project
- `K` = eligible opt-in, non-revoked consents with valid headshot
- `C` = `maxComparisonsPerJob` cap (effective cap is min(config, 750), default 750)

Then:

- For one `photo_uploaded` job: calls = `min(K, C)`
- For one `consent_headshot_ready` job: calls = `min(N, C)`

If all N photos enqueue `photo_uploaded`: total calls = `N * min(K, C)`

If all K consents enqueue `consent_headshot_ready`: total calls = `K * min(N, C)`

If both sides are enqueued for the same population (for example large reconcile windows): upper bound is approximately:
- `N * min(K, C) + K * min(N, C)`
- with no cap and symmetric full sets: up to `2NK` verify calls

For reconcile-only windows, using scan counts instead of full population:
- approx `R_photo * min(K, C) + R_consent * min(N, C)` (+ additional headshot-scan consent jobs, dedupe permitting)

---

## 2) Repeated work in current implementation

## Headshot-derived repeated work

- The same headshot image is sent in every pairwise verify request where that consent participates.
- Within a single job run, storage download/preprocess is cached in-memory, but CompreFace still recomputes from raw image each request.
- There is no persistent headshot embedding cache used by matcher decisions.

## Asset-derived repeated work

- The same photo is sent repeatedly across comparisons against multiple consents.
- Group photo face detection/embedding is recomputed per pairwise verify request.
- No persistent per-asset face detection/embedding cache is used by matcher decisions.

## Existing cache/reuse today

- In-provider per-`match()` in-memory cache only:
  - dedupes storage download + local preprocess per unique `bucket:path` within a single job call.
- No cross-job image cache, no embedding cache, no detection cache.
- Persisted results (`asset_consent_match_results`, `asset_consent_match_result_faces`) are observability/evidence stores, not an execution cache.

---

## 3) Current CompreFace provider flow (code-verified)

Current adapter (`src/lib/matching/providers/compreface.ts`) uses:

- Endpoint: `POST /api/v1/verification/verify`
- Request mode: JSON Base64 (`source_image`, `target_image`)
- Query params always set:
  - `face_plugins=calculator`
  - `status=true`
- Preprocess in app before upload:
  - decode + rotate + resize + JPEG recompress using `sharp`
  - photo longest side cap 1920
  - headshot longest side cap 1280
  - size target <= 5MB (`COMPREFACE_MAX_IMAGE_BYTES`)
- Concurrency: bounded by `AUTO_MATCH_PROVIDER_CONCURRENCY` (default 4, max 16)

Not used currently:

- `verification/embeddings/verify` endpoint
- recognition enrollment/subject workflows
- detection-first pipeline as matcher execution model

## Current config/env relevant to throughput

Observed in repo/runtime config:

- `.env.local` (current machine snapshot, secrets redacted):
  - `AUTO_MATCH_PROVIDER=compreface`
  - `AUTO_MATCH_CONFIDENCE_THRESHOLD=0.85`
  - `AUTO_MATCH_PROVIDER_TIMEOUT_MS=30000`
  - `AUTO_MATCH_PROVIDER_CONCURRENCY=12`
  - `AUTO_MATCH_MAX_COMPARISONS_PER_JOB` unset (so default effective cap path applies)
  - `AUTO_MATCH_PERSIST_RESULTS=true`
  - `AUTO_MATCH_PERSIST_FACE_EVIDENCE=true`
  - `AUTO_MATCH_RESULTS_MAX_PER_JOB` unset
- `.env.example` also sets persistence flags to `true`.
- Worker route default batch size: `25` (overridable per call).

---

## 4) Relevant CompreFace capabilities

From official docs:

- Face verification endpoint returns `source_image_face`, `face_matches`, boxes, similarity, optional embeddings (via `calculator` plugin), and `plugins_versions`.
- Embedding endpoints exist:
  - `POST /api/v1/verification/embeddings/verify`
  - recognition embedding endpoints (`/api/v1/recognition/embeddings/...`)
- Plugin mechanism allows optional fields; `calculator` returns embeddings.
- Architecture separates:
  - `compreface-api` (API/key validation/proxy/classification)
  - `compreface-core` (heavy NN embedding/plugin inference)
- Scale guidance: multiple API/core instances for throughput/HA.
- GPU note: CompreFace docs state default release build is broad-hardware oriented and does not support GPU; GPU requires custom builds.

---

## 5) Likely bottlenecks causing CPU-bound / pipeline-bound behavior

Most likely contributors in current SnapConsent flow:

1. Pairwise raw-image verification (`1 request per asset-consent pair`) causes repeated detection/embedding work in CompreFace.
2. App-side image decode/resize/recompress and base64 encode per unique image per job.
3. JSON base64 request/response serialization overhead.
4. DB write churn for links/candidates/results/face-evidence (especially with persistence flags on).
5. Worker processes claimed jobs serially inside one invocation.
6. Effective parallelism depends on external fan-out; one worker request may underfeed `compreface-core`.

This is consistent with the reported symptom profile (CPU materially active while GPU remains low), especially when combined with:
- default CompreFace build not GPU-enabled, or
- insufficient in-flight provider work reaching `compreface-core`.

---

## 6) Option comparison (A-E)

## A) Keep verification mode, cache/reuse headshot embeddings

- Value: medium
- Risk: medium
- Reality: meaningful reuse requires embedding workflow; raw verify endpoint alone cannot consume cached embedding directly.
- Likely needs additional storage/versioning logic to be durable.

## B) Keep verification mode, cache/reuse asset detections/embeddings

- Value: high
- Risk: medium-high
- Requires persistent per-asset face data lifecycle (schema/storage/invalidation), plus matcher path changes.

## C) Switch to embedding-based verification requests

- Value: medium-high
- Risk: medium
- Can reduce repeated source embedding work and HTTP overhead if done with reusable embeddings.
- Needs score/threshold re-validation and careful parity testing.

## D) Switch to recognition/enrollment for project matching

- Value: potentially very high
- Risk: high
- Requires subject lifecycle sync (create/update/delete) across consent submit, headshot replace, revoke, retention, project scope.
- Largest behavioral/operational change.

## E) Add bounded concurrency/parallelism without semantic redesign

- Value: immediate medium
- Risk: low
- No schema change required.
- Keeps canonical link model and all current invariants intact.
- Existing benchmark artifacts in repo already show better pairs/sec with higher worker fan-out (until overload).

---

## 7) Recommended smallest next step

Recommended first production-safe optimization: **E (bounded parallelism)**.

Why first:

- Lowest risk, fastest to ship, no schema changes.
- Stays inside worker/provider boundary.
- Does not change matching semantics, thresholds, authority rules, or canonical link behavior.
- Directly addresses underfeeding/pipeline utilization issues.

Practical implementation shape:

1. Add bounded job-level parallel processing in worker (default conservative, e.g. `1`, tunable to `2-4`).
2. Keep provider concurrency bounded (existing env already supports this).
3. Use matrix benchmarking to choose stable worker-concurrency x provider-concurrency operating point (avoid overload regimes shown in existing benchmark files).

Then next order:

2. **C (embedding-based reuse path)** as next phase if more throughput is needed, with strict parity testing.
3. **B/A** when persistent reuse across jobs is required.
4. **D** last (largest redesign/risk).

---

## 8) Constraints check (must remain true)

Current design enforces and recommendation preserves:

- `asset_consent_links` remains canonical approved link state.
- Manual links remain authoritative.
- Suppression behavior remains authoritative.
- Tenant/project scoping remains server-side and DB-enforced.
- Writes remain idempotent/retry-safe (upsert/delete + queue claim/complete/fail model).
- Biometric matching remains opt-in (`face_match_opt_in`) and revocation-gated for future processing.

---

## 9) Code/docs mismatches found

1. Some earlier RPI research docs (not current code) still describe provider output as similarity-only; current code parses/stores optional face evidence metadata.
2. `reconcile_project` exists as a job type in schema/worker handling, but reconcile route currently enqueues `photo_uploaded` and `consent_headshot_ready` jobs directly.
3. Historical docs mention results persistence defaulting off; current `.env.example` sets:
   - `AUTO_MATCH_PERSIST_RESULTS=true`
   - `AUTO_MATCH_PERSIST_FACE_EVIDENCE=true`
   while code-level fallbacks default to `false` when env vars are unset.
