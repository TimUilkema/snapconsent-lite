# Feature 019 Plan: Face materialization and deduped embedding-compare pipeline

## Scope boundary

This plan stays within the recommendation from `docs/rpi/019-face-materialization-deduped-embedding-pipeline/research.md`:

- add SnapConsent-owned durable face materialization state
- add deduped versioned compare jobs
- keep `asset_consent_links` as the canonical approved-link model
- keep manual links and suppressions authoritative
- keep opt-in / revocation gating server-side
- persist the winning asset face for each compare result
- do not introduce face-level exclusivity yet
- do not switch the system of record to CompreFace recognition collections

## 1. Ground-truth validation

### Verified current behavior in code

- Current trigger routes enqueue matching work from:
  - photo finalize: `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`
  - consent submit: `src/app/i/[token]/consent/route.ts`
  - headshot replacement: `src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts`
  - reconcile: `src/app/api/internal/matching/reconcile/route.ts`

- Current job types in code/schema are:
  - `photo_uploaded`
  - `consent_headshot_ready`
  - `reconcile_project`

- Current worker behavior in `src/lib/matching/auto-match-worker.ts`:
  - claims queued jobs
  - resolves pair candidates per job
  - runs the provider matcher
  - applies pair-level writes
  - completes or fails each job independently
  - already processes claimed jobs with bounded worker-level concurrency

- Current pair resolution behavior:
  - `photo_uploaded` expands one photo across eligible opted-in consents with current headshots
  - `consent_headshot_ready` expands one consent headshot across eligible uploaded project photos
  - `AUTO_MATCH_MAX_COMPARISONS_PER_JOB` bounds partner expansion

- Current provider behavior in `src/lib/matching/providers/compreface.ts`:
  - uses `POST /api/v1/verification/verify`
  - sends raw images as base64 JSON
  - requests `face_plugins=calculator`
  - parses similarity plus optional face boxes/embeddings from the response
  - does not reuse persisted embeddings or face detections for execution

- Current canonical/apply semantics in `applyAutoMatches(...)`:
  - `asset_consent_links` stays canonical
  - manual links block auto overwrite
  - `asset_consent_link_suppressions` block auto recreation
  - below-threshold auto links are removed
  - review-band pairs go to `asset_consent_match_candidates`
  - optional observability goes to `asset_consent_match_results` and `asset_consent_match_result_faces`

### Verified repeated work today

- Same logical `(consent, asset)` pair can be scheduled from both:
  - `photo_uploaded`
  - `consent_headshot_ready`

- Reconcile can revisit the same logical pair again without a versioned pair identity.

- Repeated work exists at four layers:
  - duplicate logical pair scheduling across trigger directions
  - repeated storage download / decode / resize / base64 work across jobs
  - repeated provider-side face detection
  - repeated provider-side embedding generation

- Group-photo waste is real:
  - the same asset photo is re-detected and re-embedded once per consent comparison under the current raw verification flow

### Verified current invariants to preserve

- `asset_consent_links` is the canonical approved-link table
- manual links remain authoritative
- manual unlink creates exact-pair suppression
- headshot replacement clears suppressions for that consent
- revoked / non-opt-in consents are ineligible for future matching
- tenant and project scoping are explicit in current DB queries and composite foreign keys
- current writes are retry-safe through upserts and per-job claim/complete/fail lifecycle

### Code/docs mismatches relevant to this plan

1. Feature 018 docs still mention sequential worker behavior in places, but current worker code is already bounded-concurrent.

2. `reconcile_project` still exists in schema and code checks, but the current reconcile route enqueues `photo_uploaded` and `consent_headshot_ready` directly.

3. `.env.example` does not fully match current code defaults in `src/lib/matching/auto-match-config.ts`:
  - provider concurrency comment says `4`, code fallback is `2`
  - persistence envs are enabled in `.env.example`, but code fallback is `false`

Code remains authoritative for this feature plan.

## 2. Step-by-step implementation plan

### Step 1: Add immutable materialization and compare schema

- [x] Add one migration for Feature 019 schema and grants.
- [x] Add immutable SnapConsent-owned materialization tables for asset/headshot face sets and per-face rows.
- [x] Add immutable SnapConsent-owned compare outcome table keyed by versioned pair identity.
- [x] Extend `face_match_jobs` job type checks for downstream materialization/compare jobs.
- [x] Extend existing result/candidate job-type checks where compare jobs become the applying scorer.
- [x] Keep canonical pair/link tables unchanged.

### Step 2: Add materialization helper and provider calls

- [x] Add a materialization helper in `src/lib/matching/` that:
  - loads one eligible asset
  - calls CompreFace detection with `calculator`
  - persists one immutable materialization row
  - persists one immutable face row per detected face
  - returns face count, usability, and provider metadata
- [x] Extend the CompreFace provider with:
  - detection + calculator materialization call
  - embedding compare call using `POST /api/v1/verification/embeddings/verify`

### Step 3: Add compare helper

- [x] Add a compare helper in `src/lib/matching/` that:
  - loads the current source headshot face embedding
  - loads all target asset face embeddings
  - calls embedding verify once for that versioned pair
  - selects the best target face
  - persists the winning asset face id / face rank and winning score
  - persists a no-match compare outcome when source is unusable or target has zero faces

### Step 4: Change worker orchestration

- [x] Keep public trigger routes unchanged.
- [x] Keep `photo_uploaded` and `consent_headshot_ready` as intake/orchestration jobs.
- [x] Change those trigger jobs so they no longer perform raw pairwise verification directly.
- [x] Add a downstream `materialize_asset_faces` job type that materializes one asset and then enqueues compare jobs against current opposite-side materializations.
- [x] Add a downstream `compare_materialized_pair` job type that compares one versioned headshot materialization against one versioned asset materialization and then applies current pair-level semantics.

### Step 5: Reuse current apply semantics

- [x] Keep `applyAutoMatches(...)` or a small extracted equivalent as the canonical pair-level apply layer.
- [x] Feed it compare outputs from the new compare table instead of raw provider pairwise verification.
- [x] Preserve thresholds, review-band behavior, manual authority, and suppression handling.
- [x] Persist winning face data in the new compare table without changing `asset_consent_links` semantics.

### Step 6: Add rollout config and observability

- [x] Add one rollout mode env to allow staged rollout without a big cutover.
- [x] Add materialization and compare job logging with safe, non-biometric summaries.
- [x] Expose enough worker metrics to benchmark queue throughput and compare coverage during rollout.

### Step 7: Add tests and update docs

- [x] Add migration-backed Feature 019 tests.
- [x] Add regression tests proving canonical/manual/suppression semantics are unchanged.
- [x] Add tests for winning-face persistence.
- [x] Update `.env.example` and `README.md` for the new rollout mode and any new internal matching settings.

## 3. Exact files to create/modify

### Create

- `supabase/migrations/<timestamp>_019_face_materialization_pipeline.sql`
- `src/lib/matching/face-materialization.ts`
- `src/lib/matching/materialized-face-compare.ts`
- `tests/feature-019-face-materialization-pipeline.test.ts`

### Modify

- `src/lib/matching/auto-match-jobs.ts`
- `src/lib/matching/auto-match-worker.ts`
- `src/lib/matching/auto-match-config.ts`
- `src/lib/matching/providers/compreface.ts`
- `src/app/api/internal/matching/worker/route.ts`
- `.env.example`
- `README.md`
- `tests/feature-011-real-face-matcher.test.ts`
- `tests/feature-012-manual-review-likely-matches.test.ts`
- `tests/feature-013-match-results-observability.test.ts`

### Intentionally unchanged unless implementation proves otherwise

- `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`
- `src/app/i/[token]/consent/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts`
- `src/app/api/internal/matching/reconcile/route.ts`

The bounded plan keeps current trigger entrypoints intact and moves the change into worker orchestration plus new derived state.

## 4. Data model details

### 4.1 Versioned headshot and photo materializations

Use one shared asset-based materialization model because both photos and headshots are already represented as `assets`.

#### `asset_face_materializations`

Purpose:

- one immutable materialization row per `(asset_id, materializer_version)`
- stores current execution inputs derived from one asset image

Likely columns:

- `id uuid primary key`
- `tenant_id uuid not null`
- `project_id uuid not null`
- `asset_id uuid not null`
- `asset_type text not null`
- `source_content_hash text`
- `source_content_hash_algo text`
- `source_uploaded_at timestamptz`
- `materializer_version text not null`
- `provider text not null`
- `provider_mode text not null`
- `provider_plugin_versions jsonb`
- `face_count integer not null`
- `usable_for_compare boolean not null`
- `unusable_reason text`
- `materialized_at timestamptz not null`
- `created_at timestamptz not null`

Proposed uniqueness:

- unique `(tenant_id, project_id, asset_id, materializer_version)`

Reasoning:

- in the current repo model, content changes are normally represented by a new asset row
- `content_hash` should still be snapshotted for audit and future-proofing
- immutable rows are simpler and safer than mutable "current/inactive" toggles

#### `asset_face_materialization_faces`

Purpose:

- one immutable row per detected face within one materialized asset face set
- gives each asset face its own durable identity for later exclusivity features

Likely columns:

- `id uuid primary key`
- `tenant_id uuid not null`
- `project_id uuid not null`
- `asset_id uuid not null`
- `materialization_id uuid not null`
- `face_rank integer not null`
- `provider_face_index integer`
- `detection_probability numeric(5,4)`
- `face_box jsonb not null`
- `embedding jsonb not null`
- `created_at timestamptz not null`

Proposed uniqueness:

- unique `(materialization_id, face_rank)`

Important Feature 019 point:

- this table gives every asset face a durable `face_id`
- later exclusivity can operate on that `face_id`
- Feature 019 itself will not enforce exclusivity

### 4.2 Deduped versioned compare outcome

#### `asset_consent_face_compares`

Purpose:

- one immutable compare outcome per versioned logical pair
- durable execution output for apply-layer decisions

Likely columns:

- `id uuid primary key`
- `tenant_id uuid not null`
- `project_id uuid not null`
- `asset_id uuid not null`
- `consent_id uuid not null`
- `headshot_materialization_id uuid not null`
- `asset_materialization_id uuid not null`
- `headshot_face_id uuid null`
- `winning_asset_face_id uuid null`
- `winning_asset_face_rank integer null`
- `winning_similarity numeric(5,4) not null`
- `compare_status text not null`
- `compare_version text not null`
- `provider text not null`
- `provider_mode text not null`
- `provider_plugin_versions jsonb`
- `target_face_count integer not null`
- `compared_at timestamptz not null`
- `created_at timestamptz not null`

Proposed uniqueness:

- unique `(tenant_id, project_id, consent_id, asset_id, headshot_materialization_id, asset_materialization_id, compare_version)`

### 4.3 Explicit winning-face persistence

Feature 019 must persist, at minimum:

- `winning_asset_face_id`
- `winning_asset_face_rank`
- `winning_similarity`

That is enough for a later feature to detect:

- multiple consents selecting the same asset face
- which consent has the highest score on that face

Feature 019 does not use that data to enforce exclusivity yet.

### 4.4 Optional full per-face scoring

Plan decision:

- do not add a full per-face score table in the initial Feature 019 cut
- persist only the winning face in durable compare state
- if broader per-face score observability is needed later, add it as an observability-only table or extend existing observability rows behind a flag

Reasoning:

- bounded storage growth
- smaller PR
- enough state for the next exclusivity feature already exists once face rows plus winner id are stored

## 5. Versioning / invalidation design

### Materializer version

Use a SnapConsent-controlled code version constant, not a user-facing runtime setting, for materialization semantics.

Materializer version must change when any of these change:

- image preprocessing behavior that affects embedding inputs
- CompreFace endpoint/mode used for materialization
- model/plugin family change that changes embedding space
- face selection/usability rules for headshots

Materializer version should not change for:

- threshold tuning only
- review-band changes only
- apply-layer policy changes only

### Compare version

Use a separate SnapConsent-controlled compare version constant.

Compare version must change when:

- similarity selection logic changes
- winning-face selection logic changes
- compare response normalization changes

Compare version should not change when only thresholds change.

### What requires rematerialization

- headshot asset changes
- photo asset changes
- materializer version change
- provider/model/plugin change that invalidates embedding compatibility

### What requires only re-compare

- compare version change while materialized embeddings remain compatible

### What requires only re-apply

- confidence threshold change
- review-band threshold change
- manual link or suppression change
- consent revocation/opt-out re-evaluation

### Currentness model

Prefer immutable rows plus derived currentness:

- current headshot comes from current linked headshot asset plus current `materializer_version`
- current photo materialization comes from asset plus current `materializer_version`
- current compare outcome comes from current materialization ids plus current `compare_version`

Avoid mutable "invalidate old row" logic unless implementation proves it is necessary.

## 6. Compare-job design details

### Unit of work

Use one compare job per:

- one consent
- one asset
- one headshot materialization version
- one asset materialization version
- one compare version

This is the right unit because it:

- preserves the pair-level canonical model
- supports zero/one/many faces in assets
- avoids exploding the queue to per-face granularity

### Job types and dedupe

Add two new downstream job types:

- `materialize_asset_faces`
- `compare_materialized_pair`

Keep current trigger jobs as orchestration entrypoints:

- `photo_uploaded`
- `consent_headshot_ready`

Proposed dedupe keys:

- `materialize_asset_faces:<asset_id>:<materializer_version>`
- `compare_materialized_pair:<consent_id>:<asset_id>:<headshot_materialization_id>:<asset_materialization_id>:<compare_version>`

### Headshot vs asset roles

Keep the roles directional:

- headshot is the source face
- asset photo face set is the target search space

Do not model the compare pair as unordered.

### Compare execution

`compare_materialized_pair` should:

1. Load the one usable headshot face embedding.
2. Load all asset face embeddings for the target materialization.
3. If the headshot is unusable or the target has zero faces, persist a compare outcome with no winner and `winning_similarity = 0`.
4. Otherwise call `POST /api/v1/verification/embeddings/verify` with:
   - one source embedding
   - all target embeddings
5. Select the highest-similarity target face.
6. Persist the winning asset face id / rank and winning score.
7. Feed the pair-level result into the existing apply layer.

### Retry safety

Retry safety is preserved by:

- deduped compare job enqueue key
- immutable compare outcome uniqueness on versioned pair identity
- apply re-checking manual/suppression/current-eligibility state at write time

## 7. Apply-layer behavior details

### Canonical pair behavior remains unchanged

Feature 019 must keep these behaviors exactly as they work today:

- above-threshold compare outcome can create/update an auto link
- review-band compare outcome can create/update a likely-match candidate
- below-review-band compare outcome clears stale auto/candidate state
- manual links block auto overwrite
- suppressions block auto recreation
- revoked/non-opt-in consents are ineligible for future matching

### How compare outcomes feed apply

The compare job should translate its outcome into the existing pair-level apply inputs:

- one candidate pair `(asset_id, consent_id)`
- one scored match with `confidence = winning_similarity`
- optional face evidence payload containing the winning face only

That allows existing pair-level apply logic to stay largely intact.

### Winning face persistence without semantic change

Feature 019 should:

- always persist the winning face to `asset_consent_face_compares`
- optionally surface the winning face as the only persisted face-evidence row in existing observability tables when result persistence is enabled

Feature 019 must not:

- change `asset_consent_links` from pair-level to face-level
- block one asset face from matching multiple consents yet

## 8. Security considerations

### Tenant and project isolation

All new tables must include:

- `tenant_id`
- `project_id`

And should use composite foreign keys where possible back to:

- `assets`
- `consents`

### Durable embeddings are internal-only

New materialization and compare tables should be more restricted than likely-match candidates:

- no direct authenticated RLS access by default
- service-role access only for worker/internal processing
- no client exposure

Reason:

- embeddings are durable biometric data, not ordinary app metadata

### Logging and error handling

Logs should include only safe metadata:

- asset id
- consent id
- job type
- face counts
- durations
- compare status

Logs should not include:

- raw embeddings
- full face boxes unless explicitly needed for internal debug
- provider payloads with biometric vectors

### Trust boundary

No client-provided tenant or project scope should be trusted.

Implementation must continue deriving scope from:

- current route context
- current DB relationships
- service-role internal worker model

### Retention/privacy note

Because Feature 019 introduces durable embeddings:

- document retention expectations
- keep tables internal-only
- treat later deletion/retention policy improvements as follow-up work if current asset/consent retention rules are not yet sufficient

## 9. Edge cases

### Zero-face asset

- Materialization row is still persisted.
- `face_count = 0`
- `usable_for_compare = true` for materialization completeness, but compare outcome stores no winner and `winning_similarity = 0`

### Zero-face or multi-face headshot

- Materialization row is persisted.
- `usable_for_compare = false`
- `unusable_reason` distinguishes `no_face` vs `multiple_faces`
- compare jobs for that materialization persist no-winner outcome and do not auto-link

Plan choice:

- Feature 019 should require exactly one usable headshot face for compare eligibility
- this is the smallest safe approximation of current product intent

### Headshot replaced during compare

- compare job uniqueness includes headshot materialization id/version
- old compare outcome remains historical
- only current linked headshot materialization participates in future scheduling

### Asset changed during compare

- in current repo behavior, asset replacement is generally a new asset row
- new asset gets new materialization identity and new compare jobs
- old compare rows remain historical

### Revoke / opt-out during compare

- compare may finish
- apply layer must re-check eligibility before any canonical write

### Manual link during compare

- apply layer re-reads current canonical link state
- manual link remains authoritative

### Manual unlink / suppression during compare

- apply layer re-reads current suppression state
- exact-pair suppression remains authoritative

### Duplicate / replayed jobs

- enqueue dedupe handles job replay
- immutable unique compare rows handle replay at versioned pair level
- apply remains idempotent

### Stale compare jobs

- compare job should verify its referenced materialization ids still correspond to current code versions before applying
- stale rows may remain historical, but stale apply should be skipped safely

### Provider/model version changes

- bump materializer version when embedding compatibility changes
- do not compare embeddings across incompatible materializer versions

### Threshold changes

- do not rematerialize
- do not recompare unless compare logic changed
- re-apply pair decisions from stored compare outcomes

### Large projects / storage growth

- immutable materialization and compare rows will grow with project volume
- keep full per-face score persistence out of initial scope
- rely on indexes and versioned dedupe to control compute growth

### Multiple consents later choosing the same winning asset face

- Feature 019 allows this
- multiple compare rows can point at the same `winning_asset_face_id`
- canonical pair links remain unchanged
- later exclusivity logic can resolve this because the winning face is already stored

## 10. Future-extension note

### Why storing the winning face now matters

Persisting `winning_asset_face_id`, `winning_asset_face_rank`, and `winning_similarity` in Feature 019 enables a later feature to add:

- face-level exclusivity
- "highest consent per face wins"
- conflict resolution when multiple consents target the same asset face

### Explicit out-of-scope statement

That later exclusivity behavior is out of scope for Feature 019.

Feature 019 only stores enough durable state to support it later. Feature 019 does not change canonical pair-level link semantics or current auto-link policy.

## 11. Testing plan

### Schema / migration verification

- Add a Feature 019 integration test that assumes the new migration schema exists.
- Run `supabase db reset` because this feature adds schema.

### Materialization tests

- photo asset with zero faces -> persists zero-face materialization
- photo asset with multiple faces -> persists one materialization row plus multiple face rows
- headshot with exactly one face -> `usable_for_compare = true`
- headshot with zero or multiple faces -> `usable_for_compare = false`

### Compare-job dedupe tests

- duplicate `compare_materialized_pair` enqueue for the same versioned pair stays deduped
- same logical pair from both trigger directions results in one compare job for the same materialization versions
- replayed compare job upserts the same compare outcome safely

### Versioning / invalidation tests

- new headshot asset id creates a new materialization and new compare jobs
- new photo asset id creates a new materialization and new compare jobs
- materializer version bump creates a new materialization row
- compare version bump creates a new compare row without forcing rematerialization
- threshold change re-applies outcomes without forcing rematerialization

### Canonical semantics regression tests

- existing auto-link threshold behavior remains unchanged
- existing review-band candidate behavior remains unchanged
- manual links remain authoritative
- suppressions remain authoritative
- revoked / non-opt-in consents remain ineligible

### Winning-face persistence tests

- compare outcome stores `winning_asset_face_id`
- compare outcome stores `winning_asset_face_rank`
- compare outcome stores `winning_similarity`
- two different consents may store the same winning asset face without canonical exclusivity being enforced

### Existing test file updates

- `tests/feature-011-real-face-matcher.test.ts`
  - keep manual/suppression/eligibility regressions green
- `tests/feature-012-manual-review-likely-matches.test.ts`
  - prove likely-match behavior still comes from pair-level confidence
- `tests/feature-013-match-results-observability.test.ts`
  - update expectations if compare jobs become the scorer recorded in observability rows

### Quality gates

- `supabase db reset`
- `npm test`
- `npm run lint`
- `npm run build`

## 12. Rollout / migration strategy

### Stage 1: Schema and shadow materialization

- Add schema and internal-only tables.
- Add materialization pipeline behind rollout mode.
- Keep canonical apply on current raw path by default.

### Stage 2: Shadow compare

- Enable materialized compare in shadow mode.
- Persist compare outcomes and winner faces.
- Keep raw provider path as canonical writer during parity validation.

### Stage 3: Materialized apply cutover

- Switch worker apply path to `compare_materialized_pair`.
- Keep current thresholds and pair-level apply semantics unchanged.
- Keep raw path available as rollback mode.

### Fallback

- Roll back rollout mode to `raw`.
- Leave materialization and compare rows in place as inert derived state.
- No canonical link migration is needed because `asset_consent_links` semantics never changed.

### Recommended rollout mode shape

Add one env with three modes:

- `raw` default
- `materialized_shadow`
- `materialized_apply`

Reason:

- explicit staged rollout
- easy rollback
- avoids partial hidden behavior switches

## 13. Verification checklist

- Trigger routes still enqueue safely and remain retry-tolerant.
- Canonical approved links still live only in `asset_consent_links`.
- Manual links still cannot be overwritten by auto logic.
- Manual unlink suppressions still block auto recreation.
- Revoked / non-opt-in consents still do not participate in future biometric matching.
- One uploaded asset is materialized once per asset/version, not once per consent pair.
- One headshot is materialized once per asset/version, not once per photo pair.
- Same logical `(asset, consent)` pair for the same materialization versions produces one compare job, even if both trigger directions fire.
- Compare output stores winning face id, winning face rank, and winning score.
- Canonical auto-link and likely-candidate behavior stays pair-level and threshold-driven.
- Multiple consents can still point at the same winning asset face in Feature 019 without new exclusivity behavior.
- Worker retries remain safe and idempotent.
- Rollback to `raw` mode is possible without undoing schema.
