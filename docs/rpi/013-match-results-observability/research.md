# 013 Match Results Observability - Research

## Goal
Add a minimal observability layer that can persist evaluated matcher pair results from the existing worker pipeline, without changing 009/010/011/012 architecture.

## Source of truth
This research is based on current repository code:
- `src/lib/matching/auto-match-worker.ts`
- `src/lib/matching/auto-match-config.ts`
- `src/lib/matching/auto-match-jobs.ts`
- `src/lib/matching/auto-match-reconcile.ts`
- `src/app/api/internal/matching/*`
- current matching migrations through 012

Documentation is intent; repository code is authoritative.

## Current state (code-verified)

- Canonical active links:
  - `asset_consent_links` (`manual`/`auto` provenance + metadata)
- Manual suppression:
  - `asset_consent_link_suppressions`
- Review-band candidates (Feature 012):
  - `asset_consent_match_candidates`
- Queue/worker backbone:
  - `face_match_jobs` + SECURITY DEFINER claim/complete/fail helpers
- Worker behavior:
  - builds eligible candidate pairs
  - scores pairs via provider
  - writes:
    - auto links above threshold
    - review-band candidates
    - stale auto/candidate deletions
  - does not persist full evaluated pair outcomes

Current data loss point:
- Pairs scored below review band, skipped by suppression/manual rules, or just not linked are not retained for analysis.

## Important implementation reality

- Queue dedupe keys are strict and long-lived; not every rerun creates a new job row.
- Worker retries process the same job id/attempt path.
- Any observability write must be idempotent under retries and partial failures.

## What Feature 013 should enable

Small, practical outcomes:
- metric foundations:
  - evaluated pairs count
  - above-threshold vs review-band vs below-band distribution
  - suppressed/manual-skipped counts
- operational debugging:
  - verify matcher output volume per job
  - compare behavior across matcher versions
- future analytics without redesign:
  - false-positive corrections (correlating with manual unlink)
  - threshold tuning over real score distributions

Out of scope for 013:
- new review UI
- model training pipeline
- embeddings platform
- cross-project identity logic

## Design options considered

### Option A: Persist all scored pairs append-only (recommended baseline)
- Add `asset_consent_match_results`.
- One row per scored pair per job (idempotent upsert key).
- Pros:
  - supports historical analysis and version comparisons
  - preserves timeline
  - minimal worker change (one extra write path)
- Cons:
  - storage growth if fully unbounded

### Option B: Persist only top N per job
- Same table, but cap rows written per job.
- Pros:
  - predictable storage
  - still useful signal
- Cons:
  - biased analytics; low-confidence tail missing

### Option C: Persist only latest per pair
- Upsert keyed by `(asset_id, consent_id)` only.
- Pros:
  - very small storage footprint
- Cons:
  - loses history needed for trend and model comparison

## Recommendation

Use **Option A with bounded controls**:
- table: appendable result records keyed idempotently by job/pair
- env-gated persistence:
  - default off
  - optional cap per job for local/development guardrails
- no impact on canonical matching decisions

This keeps architecture stable while unlocking observability.

## Proposed minimal data model

New table:
- `public.asset_consent_match_results`

Fields (minimum):
- scope:
  - `tenant_id`, `project_id`
  - `asset_id`, `consent_id`
- job context:
  - `job_id` (fk to `face_match_jobs.id`)
  - `job_type`
- match output:
  - `confidence` (`0..1`)
  - `matcher_version`
- decision snapshot:
  - `decision` enum-like text, e.g.:
    - `auto_link_upserted`
    - `candidate_upserted`
    - `below_review_band`
    - `skipped_manual`
    - `skipped_suppressed`
- threshold snapshot:
  - `auto_threshold`
  - `review_min_confidence`
- audit:
  - `scored_at`
  - `created_at`

Idempotency key:
- unique `(job_id, asset_id, consent_id)`

Rationale:
- retry-safe on worker replay
- keeps one deterministic result record per job/pair
- supports per-job analytics

## Worker integration boundary

Keep existing flow and add one additional persistence step after normalized scores are computed and decision classification is known.

Do not alter:
- eligibility logic
- write rules for `asset_consent_links`
- suppression/manual authority rules
- queue model/endpoints

## Configuration recommendation

Add env flags:
- `AUTO_MATCH_PERSIST_RESULTS=false` (default)
- `AUTO_MATCH_RESULTS_MAX_PER_JOB` (optional hard cap)

Behavior:
- disabled: zero writes to results table
- enabled: persist all evaluated pairs, optionally capped

## Privacy and security implications

Match scores are biometric inference metadata and must be treated as sensitive.

Controls:
- do not store image bytes, embeddings, or face vectors
- keep tenant/project composite FKs
- keep access internal-only initially:
  - RLS enabled
  - no member-facing policies for now
- avoid logging raw storage paths in new logs if not needed

## Edge cases to handle

- duplicate/replayed job processing:
  - same `(job_id, asset_id, consent_id)` must not duplicate rows
- worker partial failure after results write:
  - retry should upsert same records safely
- manual/suppressed pairs:
  - results still useful; decision must reflect skip reason
- ineligible jobs with zero candidates:
  - no pair rows expected (acceptable)
- provider timeout/5xx:
  - no successful scored-pair writes for failed job attempt
- large projects:
  - optional cap prevents runaway row count per execution

## Code/doc mismatches noted

- `reconcile_project` exists as job type, but reconcile endpoint currently enqueues photo/consent jobs directly.
- This does not block 013; result rows should record actual `job_type` from processed jobs.

## Bounded next-step scope

Feature 013 should implement:
1. new results table migration
2. env-gated worker persistence of evaluated pair outcomes
3. deterministic tests for idempotent result writes and decision classification
4. docs/env updates

No architecture redesign required.
