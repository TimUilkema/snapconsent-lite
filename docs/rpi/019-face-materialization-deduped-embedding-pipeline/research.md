# Feature 019 Research: Face materialization and deduped embedding-compare pipeline

## 1. Scope and method

This research is based on the current repository code first, then cross-checked against upstream CompreFace documentation.

Primary repo inputs reviewed:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/009-matching-foundation/*`
- `docs/rpi/010-auto-face-matching/*`
- `docs/rpi/011-real-face-matcher/*`
- `docs/rpi/012-manual-review-likely-matches/*`
- `docs/rpi/013-match-results-observability/*`
- `docs/rpi/017-*`
- `docs/rpi/018-compreface-performance-efficiency/*`
- `src/lib/matching/*`
- `src/lib/assets/finalize-asset.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`
- `src/app/i/[token]/consent/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts`
- `src/app/api/internal/matching/worker/route.ts`
- `src/app/api/internal/matching/reconcile/route.ts`
- matching-related migrations
- matching-related tests
- `.env.example`
- `README.md`

Upstream CompreFace docs cross-checked:

- REST API description: <https://github.com/exadel-inc/CompreFace/blob/master/docs/Rest-API-description.md>
- Face services and plugins: <https://github.com/exadel-inc/CompreFace/blob/master/docs/Face-services-and-plugins.md>
- Architecture and scalability: <https://github.com/exadel-inc/CompreFace/blob/master/docs/Architecture-and-scalability.md>
- Custom builds: <https://github.com/exadel-inc/CompreFace/blob/master/custom-builds/README.md>

Code is treated as authoritative where repo docs differ.

## 2. Current pipeline (code-verified)

### Trigger and enqueue flow

Current matching work is enqueued from three paths:

- `photo_uploaded`
  - Triggered after photo finalize in `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`.
  - Guard is `shouldEnqueuePhotoUploadedOnFinalize(assetType)` in `src/lib/matching/auto-match-trigger-conditions.ts`, which currently returns `true` only for `photo`.
  - Enqueue dedupe key is `photo_uploaded:<asset_id>` in `src/lib/matching/auto-match-jobs.ts`.

- `consent_headshot_ready`
  - Triggered on public consent submit in `src/app/i/[token]/consent/route.ts` when the submission is not duplicate, `face_match_opt_in` is true, and a headshot asset id is present.
  - Triggered again on headshot replacement in `src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts`.
  - Enqueue dedupe key is `consent_headshot_ready:<consent_id>:<headshot_asset_id>` in `src/lib/matching/auto-match-jobs.ts`.

- reconcile
  - `src/app/api/internal/matching/reconcile/route.ts` calls `runAutoMatchReconcile(...)`.
  - `src/lib/matching/auto-match-reconcile.ts` scans recent photos, recent signed opted-in consents, and recent uploaded headshots, then enqueues `photo_uploaded` and `consent_headshot_ready` jobs directly.
  - Although `reconcile_project` still exists in job types and schema, the current reconcile route does not enqueue `reconcile_project` jobs.

Queue behavior:

- Jobs are stored in `face_match_jobs`.
- Enqueue is idempotent per `(tenant_id, project_id, dedupe_key)` via `enqueue_face_match_job`.
- Claim uses `FOR UPDATE SKIP LOCKED` via `claim_face_match_jobs`.
- Completion and failure are per-job via `complete_face_match_job` and `fail_face_match_job`.

### Worker behavior

Current worker behavior is in `src/lib/matching/auto-match-worker.ts`.

- The worker claims a batch of jobs.
- The worker now processes claimed jobs with bounded job-level concurrency via `mapWithConcurrency(...)`.
- Worker concurrency is resolved from `AUTO_MATCH_WORKER_CONCURRENCY`.
- Each claimed job is still isolated:
  - resolve candidates
  - run matcher
  - apply writes
  - complete or fail that one job

This matters for Feature 019 because the main remaining inefficiency is no longer "jobs are always sequential". Feature 018 already addressed that.

### Candidate resolution and current pair math

`resolveJobCandidates(...)` currently works like this:

- `photo_uploaded`
  - Load one eligible photo asset.
  - Load all eligible consents with current headshots.
  - Create one candidate pair per `(photo asset, consent)`.

- `consent_headshot_ready`
  - Load one eligible consent headshot.
  - Load eligible project photos.
  - Create one candidate pair per `(consent, photo asset)`.

- `reconcile_project`
  - Currently returns no candidates in worker code.

`AUTO_MATCH_MAX_COMPARISONS_PER_JOB` caps partner expansion per job.

Current provider-call count, ignoring caps:

- `N` new photos against `K` eligible consents -> about `N * K` verification calls from `photo_uploaded`
- `K` new headshots/consents against `N` eligible photos -> about `K * N` verification calls from `consent_headshot_ready`
- if both trigger directions happen for the same logical population, the same logical `(asset, consent)` pair can be rechecked twice
- reconcile can revisit the same pairs again

With cap `C`, per-job work is bounded to `min(partner_count, C)`, but duplicate logical pairs still exist across job types and across reruns.

### Provider flow today

Current CompreFace provider is `src/lib/matching/providers/compreface.ts`.

- SnapConsent uses `POST /api/v1/verification/verify`.
- Requests are JSON base64, not multipart.
- Query params are `face_plugins=calculator` and `status=true`.
- SnapConsent preprocesses each image locally with Sharp before upload:
  - decode
  - rotate
  - resize
  - jpeg encode
  - base64 encode
- Headshots and photos are downloaded from Supabase Storage inside the provider.

Important current details:

- There is only in-memory cache for storage download and local preprocess within one `match()` call.
- There is no cross-job cache.
- There is no persistent reuse of face detection results.
- There is no persistent reuse of embeddings for execution.

The provider also parses richer response data than the current matching decision uses:

- `similarity`
- plugin versions
- source face box
- target face boxes
- source embedding
- target embeddings

But current write semantics do not use those outputs as execution inputs. They are observability only.

### Decision and persistence flow today

`applyAutoMatches(...)` is the canonical write path.

It:

- loads existing `asset_consent_links`
- loads exact-pair suppressions from `asset_consent_link_suppressions`
- preserves manual links
- blocks suppressed pairs
- upserts above-threshold auto links into `asset_consent_links`
- upserts review-band rows into `asset_consent_match_candidates`
- deletes stale auto links
- deletes stale review candidates
- optionally persists pair-level results into `asset_consent_match_results`
- optionally persists per-face evidence into `asset_consent_match_result_faces`

Current invariants are already encoded in code and tests:

- `asset_consent_links` is the canonical approved state
- manual links remain authoritative
- manual unlink creates exact-pair suppression
- headshot replacement clears suppressions for that consent
- revoked or opt-out consents are ineligible for future matching
- archived/non-uploaded photos are ineligible
- writes are idempotent at pair level because canonical and candidate tables are upserted by `(asset_id, consent_id)`

### Existing durable state vs observability state

Current durable execution inputs:

- assets and their storage references
- consents and eligibility state
- `asset_consent_links`
- `asset_consent_link_suppressions`
- `face_match_jobs`

Current observability/history state:

- `asset_consent_match_candidates`
- `asset_consent_match_results`
- `asset_consent_match_result_faces`

`asset_consent_match_result_faces` is not a reusable materialization cache because:

- it is keyed by `job_id`
- it is historical, not canonical
- it is only written when `AUTO_MATCH_PERSIST_RESULTS=true`
- face rows are only kept for decisions in scope today: `auto_link_upserted` and `skipped_manual`
- many compared pairs never get durable face rows at all

## 3. Repeated work and duplicate-pair analysis

### 3.1 Pair scheduling duplication

The same logical `(consent headshot, asset photo)` comparison can currently be scheduled from both directions:

- `photo_uploaded` expands one photo across eligible consents
- `consent_headshot_ready` expands one consent headshot across eligible photos

Queue dedupe does not eliminate that duplication because dedupe keys are scope-based, not pair-based:

- `photo_uploaded:<asset_id>`
- `consent_headshot_ready:<consent_id>:<headshot_asset_id>`

So current dedupe prevents duplicate jobs of the same scope, but it does not prevent duplicate logical pair evaluation across job types.

### 3.2 Reconcile duplication

Reconcile can revisit the same logical pairs again.

This is sometimes useful:

- a previous enqueue was missed
- a headshot was replaced
- a photo became eligible later
- a consent became eligible later

But current reconcile also re-enqueues same-version work because it does not reason about:

- image content version
- headshot version
- provider/model/materialization version
- already-computed pair version state

### 3.3 Repeated image preprocessing

Repeated local work still happens before CompreFace sees the request:

- storage download
- image decode
- resize/rotate/jpeg encode
- base64 serialization

The provider caches this only within one `match()` call. The same headshot or photo used in a later job is re-downloaded and reprocessed.

### 3.4 Repeated face detection and embedding generation

This is the dominant repeated work.

Current flow uses raw-image verification for every pair:

- same headshot is sent repeatedly across many photo comparisons
- same group photo is sent repeatedly across many consent comparisons
- CompreFace repeatedly redetects faces in the target photo
- CompreFace repeatedly recalculates embeddings from raw image pixels

For group photos this is especially wasteful because the same asset face set is recomputed once per consent comparison.

### 3.5 Repeated transport overhead

Current provider transport also repeats:

- JSON request construction
- base64 payload transfer
- response parsing

This is probably smaller than repeated model inference, but still material when pair counts are large.

### 3.6 Useful reprocessing vs wasteful reprocessing

Useful reprocessing:

- headshot image changed
- asset image changed
- consent became newly eligible
- photo became newly eligible
- materialization algorithm changed
- provider model/plugin version changed
- compare algorithm changed

Wasteful reprocessing:

- same headshot content, same photo content, same provider/model/preprocess version, same compare version
- same pair reached from both trigger directions
- reconcile rerunning same logical versioned pair without any invalidating change

### 3.7 Group-photo nuance

Current provider returns face-level evidence, but current pair confidence is still derived from the provider response rather than from a SnapConsent-owned face set.

SnapConsent currently parses all returned face evidence, but matching confidence is taken from the first returned verification match. The provider response shape supports multiple face matches, but SnapConsent does not currently persist a stable reusable face-set representation for assets or headshots.

Inference from code:

- the system effectively assumes one meaningful source headshot face
- and lets CompreFace decide which target face in the asset is the best match

That works functionally, but it is exactly why the same group-photo face detection work is repeated across many pairwise requests.

## 4. Relevant CompreFace capabilities

### 4.1 Detection-first processing

Official docs show that CompreFace supports a detection service:

- `POST /api/v1/detection/detect`
- supports `face_plugins=calculator`
- returns bounding boxes
- returns embeddings when `calculator` is requested

This is the key capability for materializing asset face sets, especially for photos with zero, one, or many faces.

### 4.2 Cropped-face handling

Recognition docs note `detect_faces=false` on recognition requests, which tells CompreFace to treat the image as an already-cropped face.

That is relevant conceptually for headshots if SnapConsent wants to treat them as a single cropped-face input, but the current provider does not use this mode.

### 4.3 Raw-image verification

Current SnapConsent flow uses:

- `POST /api/v1/verification/verify`

This compares two images directly and can return:

- similarity
- boxes
- embeddings
- plugin versions

This is simple, but it recomputes detection and embeddings from raw images every time.

### 4.4 Embedding-based verification

Official docs also show:

- `POST /api/v1/verification/embeddings/verify`

This compares:

- one source embedding
- many target embeddings

This is the strongest fit for a SnapConsent-owned deduped compare pipeline:

- materialize the consent headshot embedding once
- materialize all asset face embeddings once per asset version
- compare one source embedding to all faces in one asset face set
- select the max similarity as the pair score

That preserves the current canonical pair model while removing repeated provider-side face detection and embedding generation.

### 4.5 Recognition subjects / collections

Recognition service supports:

- enrolling known faces into a Face Collection
- subject workflows
- recognizing unknown faces among enrolled subjects
- recognition embedding endpoints
- verifying an input embedding against a stored collection image

This is relevant, but it is a weaker fit for SnapConsent than owned materialization for several reasons:

- provider-side subject lifecycle becomes hidden mutable state
- SnapConsent would need reliable create/update/delete synchronization on headshot replacement and revoke
- project and tenant isolation would need to be mirrored in CompreFace collections/services
- auditability and replay become harder because the canonical execution inputs live outside SnapConsent tables
- group-photo handling still needs careful control over how many asset faces are scanned and interpreted

### 4.6 Architecture and scalability implications

CompreFace architecture docs separate:

- API/classification servers
- embedding servers (`compreface-core`)

They explicitly call out embedding calculation as the heavy operation and recommend scaling embedding servers, ideally with GPU support.

That matches current repo findings:

- Feature 018 improved worker feeding/concurrency
- but same-version raw-image pairwise verification still causes repeated heavy embedding work inside `compreface-core`

## 5. Candidate architecture options

### Option A: SnapConsent-owned versioned face materialization + deduped compare jobs

Description:

- materialize headshot and photo face outputs into SnapConsent tables
- store per-face embeddings and geometry durably
- schedule compare work at the versioned logical pair level
- use embedding-based verification for compare, or an equivalent deterministic compare layer
- keep `asset_consent_links` as canonical approved state

Likely compare unit:

- one consent headshot materialization version
- against one asset face-set materialization version

Within that compare unit:

- compare the headshot embedding against every face embedding in the asset face set
- keep the highest similarity
- keep optional face-level evidence for the winning face and possibly all scored faces

Why it fits SnapConsent:

- supports zero/one/many faces in assets
- keeps durable execution state in SnapConsent tables
- makes versioning explicit
- lets triggers dedupe same-version work regardless of which direction scheduled it
- keeps canonical link model unchanged

### Option B: CompreFace recognition enrollment / subject collections

Description:

- enroll each opted-in consent headshot as a subject in a recognition collection/service
- recognize faces in uploaded assets against that collection

Advantages:

- potentially fewer raw verify requests
- provider owns the recognition index

Disadvantages:

- subject lifecycle becomes provider-owned state
- explicit invalidation is harder
- headshot replacement must update or remove enrolled subject images
- revoke/suppression/manual semantics still have to be reimposed in SnapConsent
- replay and audit are weaker because the execution state is no longer fully SnapConsent-owned
- cross-project and cross-tenant separation becomes an external lifecycle problem

For SnapConsent, this is a larger architecture shift than Feature 019 needs.

### Option C: Hybrid

Description:

- SnapConsent owns materialized face sets and versioning
- CompreFace recognition collections are used later as an acceleration layer for some projects

Assessment:

- possible later
- not a good first move
- adds two state systems instead of one

### Option D: Reuse current result tables as cache

Description:

- try to promote `asset_consent_match_results` and `asset_consent_match_result_faces` into execution cache

Assessment:

- not suitable
- current tables are job-scoped observability/history
- face evidence is incomplete by design
- cache invalidation/versioning would be awkward and error-prone

## 6. Data model / lifecycle implications

### 6.1 Existing hooks the repo already has

The current repo already has some useful building blocks:

- `assets.content_hash` and `assets.content_hash_algo`
- asset storage identity via `storage_bucket` and `storage_path`
- eligibility state on assets and consents
- exact-pair suppression table
- canonical approved-link table
- queue/job lifecycle

That means Feature 019 likely does not need to redesign canonical matching state. It needs new derived/materialized state.

### 6.2 Likely new persisted state

Research outcome: a real materialization pipeline probably needs at least three classes of new state.

1. Materialized face-set header rows

Purpose:

- represent one versioned materialization of one logical image input

Likely fields:

- tenant_id
- project_id
- asset_id
- materialization_kind: `headshot` or `photo`
- input identity: asset id plus content hash if available
- active/inactive status
- materializer version
- provider name
- provider mode
- provider plugin versions
- zero-face / single-face / multi-face counts
- materialized_at
- invalidated_at if superseded

2. Materialized face rows

Purpose:

- one row per detected face inside one materialized face set

Likely fields:

- tenant_id
- project_id
- materialization_id
- face_rank
- box geometry
- embedding vector
- detection probability
- optional landmarks if needed later

3. Versioned compare state

Purpose:

- record that a specific versioned logical pair has been compared
- dedupe retries and cross-trigger duplication

Likely fields:

- tenant_id
- project_id
- consent_id
- asset_id
- consent_materialization_id
- asset_materialization_id
- compare_version
- status
- best_face_rank or winning face id
- best_similarity
- compared_at
- source trigger metadata

This compare state may be modeled as jobs plus results, or as a deduped state table plus queue, but the key requirement is versioned pair identity.

### 6.3 What should remain canonical vs derived vs cache-like

Canonical:

- `asset_consent_links`
- `asset_consent_link_suppressions`

Derived but durable:

- materialized face sets
- materialized face rows
- compare state/results
- review candidates

Observability/history:

- existing per-job result rows
- benchmark/log rows if kept

Cache-like but still durable:

- embeddings and geometry used as execution inputs

The important distinction is that durable embeddings are not canonical business approval state. They are reusable execution inputs.

### 6.4 Versioning rules

Versioning should change when any execution-relevant input changes:

- headshot image content changes
- asset image content changes
- preprocessing/materializer logic changes
- provider model/plugin version changes
- compare algorithm version changes

Versioning should not require rematerialization when only policy changes:

- confidence threshold changes
- review-band threshold changes
- manual link changes
- suppression changes

Those are apply-layer changes. They should re-evaluate existing compare outputs, not recompute embeddings.

### 6.5 Lifecycle and invalidation

Headshot replaced:

- old headshot materialization becomes inactive for future compare scheduling
- new headshot materialization is created
- future compare dedupe keys use the new headshot materialization id/version
- existing suppressions should follow current behavior and be cleared by the headshot replacement flow

Asset replaced or re-uploaded with new content:

- new asset materialization version
- old compare state for that asset version stays historical but is no longer current

Consent revoked or opt-out:

- future materialization/compare scheduling stops immediately
- canonical links/suppressions remain governed by existing business rules
- stored embeddings may remain for audit/observability only if policy allows, but must be excluded from future matching

Threshold changes:

- no rematerialization required
- compare state can be re-applied to canonical link/candidate outcomes

Provider/model/plugin version changes:

- materializations from old and new versions should not be assumed comparable
- new version should create new materializations
- compare state should be version-partitioned

## 7. Deduped compare-job design space

### 7.1 Right unit of work

The right compare unit is not "one detected face vs one detected face" at queue level.

The better queue unit is:

- one current consent headshot materialization
- against one current asset face-set materialization

Reasons:

- preserves today's canonical pair model `(asset_id, consent_id)`
- supports group photos naturally
- allows one compare job to score all target faces for that asset
- avoids exploding queue size to per-face granularity

### 7.2 Recommended dedupe identity

Recommended logical dedupe key:

- tenant_id
- project_id
- consent_id
- asset_id
- consent_materialization_id or consent_materialization_version
- asset_materialization_id or asset_face_set_version
- compare_version

This is effectively a versioned pair key.

It should not be unordered in implementation, because the roles are not symmetric:

- consent headshot is the source identity face
- asset face set is the target search space

But at business level it still resolves back to the canonical pair `(asset_id, consent_id)`.

### 7.3 Retry and replay safety

Retry-safe behavior should remain:

- enqueue by versioned pair dedupe key
- compare result upsert by versioned pair identity
- apply phase re-checks manual/suppression/current-eligibility state before any canonical write

That keeps retries safe even if:

- a manual link appears while compare is in flight
- a suppression is created while compare is in flight
- a consent is revoked while compare is in flight

## 8. Security and invariant checks

### 8.1 Canonical and authority invariants

Feature 019 should preserve current invariants unchanged:

- `asset_consent_links` remains canonical approved state
- manual links remain authoritative
- exact-pair suppressions remain authoritative
- manual unlink must continue blocking future auto recreation
- opt-in and revocation must continue gating future biometric processing

Materialization and compare tables must never become the source of truth for approved links.

### 8.2 Tenant and project isolation

Current code enforces tenant/project scoping in every matching query. New materialization and compare state would need the same pattern:

- tenant_id on every new table
- project_id on every new table
- composite foreign keys back to asset/consent/project identity where possible
- all internal queries scoped by tenant_id and project_id

Provider-owned subject collections weaken this because the real isolation boundary moves outside SnapConsent tables.

### 8.3 Privacy and security risks of durable embeddings

New risk introduced by Feature 019:

- biometric embeddings become durable data instead of transient provider response data

Implications:

- internal-only access paths
- no client exposure
- least-privilege reads
- careful logging redaction
- explicit retention/deletion policy review
- probably no broad admin UI exposure by default

This is manageable, but it is materially different from current raw-verify-only semantics.

### 8.4 Internal route and service-role considerations

Current internal protections should remain:

- worker and reconcile stay token-protected internal routes
- business logic remains server-side
- no client trust boundary changes
- no new reason to expose service-role credentials

## 9. Risks and edge cases

Zero-face asset:

- materialization should persist a successful zero-face result
- compare jobs against that asset version should short-circuit to no match

Zero-face or multi-face headshot:

- current product intent expects one headshot face
- materialization must record what was actually found
- policy is needed for multi-face headshots:
  - reject for matching
  - pick best face
  - or require manual remediation

Current raw verify path hides that nuance inside provider behavior.

Concurrent manual actions during async compare:

- compare results must not bypass manual link or suppression authority
- apply layer must still re-read canonical/suppression state before writing

Revocation during async compare:

- compare may finish
- apply must not create new link/candidate for a revoked consent

Headshot replaced during async compare:

- old compare result should not apply to the new headshot version
- versioned pair identity solves this

Threshold changes:

- should re-apply compare outputs
- should not force rematerialization

Provider/model upgrades:

- embeddings from different materializer/model versions should not be mixed silently

Operational complexity:

- storage cost increases
- invalidation logic becomes real product logic
- staged rollout is advisable

## 10. Code/docs mismatches found

1. Feature 018 docs still describe the worker as sequential in some places, but current code in `src/lib/matching/auto-match-worker.ts` already processes claimed jobs with bounded concurrency.

2. `reconcile_project` still exists in:

- `src/lib/matching/auto-match-jobs.ts`
- schema checks
- candidate/result job-type enums

But the current reconcile route enqueues `photo_uploaded` and `consent_headshot_ready` jobs directly instead of dispatching `reconcile_project`.

3. `.env.example` and current code defaults do not fully match:

- `.env.example` comments `AUTO_MATCH_PROVIDER_CONCURRENCY=4`
- code fallback in `src/lib/matching/auto-match-config.ts` is currently `2`
- `.env.example` enables result/evidence persistence by default
- code fallback for both persistence flags is `false`

These mismatches matter because older docs can overstate or understate where current inefficiency really sits.

## 11. Recommendation

### Recommended direction

Best next architecture direction: SnapConsent-owned versioned face materialization plus deduped versioned compare state, not CompreFace recognition enrollment as the primary design.

Recommended first-phase shape:

1. Materialize opted-in consent headshots into versioned headshot face sets.
2. Materialize uploaded photos into versioned asset face sets.
3. Deduplicate compare work on `(asset_id, consent_id, headshot_materialization_version, asset_materialization_version, compare_version)`.
4. Compare one headshot embedding against all faces in one asset face set.
5. Reduce to one best pair score.
6. Keep current apply semantics into `asset_consent_links`, `asset_consent_match_candidates`, and suppressions/manual rules unchanged.

### Why this is the best fit

- It directly attacks the two verified waste sources:
  - same-version duplicate pair scheduling
  - repeated raw-image detection/embedding work
- It preserves the current canonical link model.
- It preserves manual and suppression authority.
- It keeps tenant and project scoping in SnapConsent-owned tables.
- It fits group-photo assets cleanly.
- It allows reconcile to become a backfill/invalidation tool instead of a raw re-verify amplifier.
- It avoids hidden provider-side subject lifecycle as the system of record.

### Recognition enrollment assessment

Recognition enrollment should not be the first architecture move.

It may be worth evaluating later as an optional acceleration layer, but it is a worse primary fit because:

- provider-owned mutable subject state becomes operationally central
- lifecycle synchronization is harder
- invalidation/audit/replay are weaker
- tenant/project isolation becomes less explicit

### Staged rollout advice

A staged rollout is advisable:

- first introduce materialization as write-only derived state
- then add versioned compare state
- then dual-run compare against current raw verification for parity checks
- then switch canonical apply to the deduped compare pipeline once parity is acceptable

That sequencing keeps business invariants stable while the new durable biometric execution state is validated.
