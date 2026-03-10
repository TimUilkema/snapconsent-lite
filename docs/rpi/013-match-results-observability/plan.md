# 013 Match Results Observability - Plan

## Ground-truth validation

Validated in current code:
- Worker already computes normalized scored pairs for each claimed job.
- Worker currently writes only:
  - `asset_consent_links` (auto link lifecycle)
  - `asset_consent_match_candidates` (review band)
  - stale delete paths
- Queue/worker/reconcile architecture from 010 remains active and stable.
- Manual authority/suppression invariants are already enforced and must remain unchanged.

Conclusion:
- 013 can be a small additive worker write path plus schema/config/tests.

## Decisions

- Keep 009/010/011/012 architecture unchanged.
- Add one internal observability table for evaluated pair outcomes:
  - `asset_consent_match_results`
- Preserve canonical table semantics:
  - `asset_consent_links` remains the only active-link source of truth.
- Keep write path retry-safe:
  - idempotent upsert keyed by `(job_id, asset_id, consent_id)`.
- Keep results table internal-only for this feature cycle.

## Step-by-step implementation plan

### Step 1 - Add results schema migration

Create:
- `supabase/migrations/<timestamp>_013_auto_match_results_observability.sql`

Migration contents:
- create table `public.asset_consent_match_results` with:
  - ids/scope:
    - `id uuid default gen_random_uuid() primary key`
    - `tenant_id uuid not null`
    - `project_id uuid not null`
    - `asset_id uuid not null`
    - `consent_id uuid not null`
    - `job_id uuid not null`
    - `job_type text not null`
  - score + decision:
    - `confidence numeric(5,4) not null check (confidence >= 0 and confidence <= 1)`
    - `decision text not null`
    - `matcher_version text null`
    - `auto_threshold numeric(5,4) not null`
    - `review_min_confidence numeric(5,4) not null`
  - audit:
    - `scored_at timestamptz not null default now()`
    - `created_at timestamptz not null default now()`
- constraints:
  - unique `(job_id, asset_id, consent_id)` for idempotent retries
  - `job_type` check aligned with existing queue types
  - `decision` check for bounded decision vocabulary
  - composite fk `(asset_id, tenant_id, project_id)` to assets
  - composite fk `(consent_id, tenant_id, project_id)` to consents
  - fk `job_id` to `face_match_jobs(id)` on delete cascade
- indexes:
  - `(tenant_id, project_id, scored_at desc)`
  - `(tenant_id, project_id, job_id)`
  - `(tenant_id, project_id, consent_id, scored_at desc)`
- security:
  - enable RLS
  - no authenticated member policies in this phase (internal-only table)
  - revoke table privileges from `anon`/`authenticated`

### Step 2 - Add config flags

Modify:
- `src/lib/matching/auto-match-config.ts`

Add:
- `getAutoMatchPersistResults()` -> boolean, default `false`
- `getAutoMatchResultsMaxPerJob()` -> `number | null` (optional cap)

Rules:
- max per job is bounded (`1..5000`) if set
- invalid values fall back to `null` (no cap)

### Step 3 - Worker result persistence

Modify:
- `src/lib/matching/auto-match-worker.ts`

Implementation:
- In `applyAutoMatches(...)`, after decision classification is known:
  - build result rows from normalized scored pairs
  - assign `decision` per pair using existing decision logic:
    - manual pair -> `skipped_manual`
    - suppressed pair -> `skipped_suppressed`
    - confidence >= threshold and writable -> `auto_link_upserted`
    - review band and writable -> `candidate_upserted`
    - below review band -> `below_review_band`
  - include `job_id`, `job_type`, thresholds, matcher version
- persist only when `AUTO_MATCH_PERSIST_RESULTS=true`
- apply optional cap (`AUTO_MATCH_RESULTS_MAX_PER_JOB`) before write
- upsert with conflict key:
  - `(job_id, asset_id, consent_id)`
- preserve existing business logic/writes exactly:
  - no change to auto-link decisions
  - no change to candidate lifecycle behavior
  - no change to retries/dead handling

### Step 4 - Env and docs

Modify:
- `.env.example`
- `README.md`

Add:
- `AUTO_MATCH_PERSIST_RESULTS=false`
- `AUTO_MATCH_RESULTS_MAX_PER_JOB=`
- short notes:
  - feature is observability-only
  - canonical linking behavior unchanged

### Step 5 - Tests

Create:
- `tests/feature-013-match-results-observability.test.ts`

Deterministic coverage:
- when `AUTO_MATCH_PERSIST_RESULTS=false`, no results rows are written
- when enabled, scored pairs are persisted with expected decision labels
- upsert idempotency:
  - same job replay does not create duplicate rows
- thresholds/decision snapshots are stored correctly
- manual and suppression decisions are classified correctly
- optional max-per-job cap is honored
- tenant/project scoping is preserved in writes

Optional updates:
- extend `tests/feature-012-manual-review-likely-matches.test.ts` only if shared helper extraction is useful

## Files to create

- `supabase/migrations/<timestamp>_013_auto_match_results_observability.sql`
- `tests/feature-013-match-results-observability.test.ts`

## Files to modify

- `src/lib/matching/auto-match-config.ts`
- `src/lib/matching/auto-match-worker.ts`
- `.env.example`
- `README.md`

## Invariants and edge cases

Must remain intact:
- canonical active links remain `asset_consent_links`
- manual links remain authoritative
- manual unlink suppression remains authoritative
- no cross-project matching
- queue/worker/reconcile architecture unchanged

Edge cases to verify:
- duplicate/replayed jobs
- worker retry after partial failure
- manual pair scored high (result row says skipped manual; no auto overwrite)
- suppressed pair scored high (result row says skipped suppressed; no recreation)
- below-band pair still persisted when results enabled
- empty candidate job produces zero result rows

## Verification checklist

1. `supabase db reset` applies new 013 migration cleanly.
2. Existing matching tests still pass (009/010/011/012 coverage).
3. New 013 tests pass and validate idempotent result persistence.
4. Lint/test pipeline remains green.
5. Worker behavior for actual linking/candidates is unchanged from 012.
6. Result table is internal-only and tenant/project scoped by schema.
