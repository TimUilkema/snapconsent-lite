# 010 Auto Face Matching - Plan

## Decisions

- This feature is backbone-only.
  - It adds scheduling, queueing, worker processing, metadata, and UI provenance scaffolding.
  - It does **not** implement a real face-recognition provider, embeddings, face detection, or a confidence model yet.
- `asset_consent_links` remains the canonical approved-link table.
- Future auto-links will use metadata on `asset_consent_links`:
  - `link_source`
  - `match_confidence`
  - `matched_at`
  - `reviewed_at`
  - `reviewed_by`
  - optional `matcher_version`
- No full candidate/review queue is added in this phase.
  - Manual unlink/link remains the correction workflow.
- Queue access model:
  - `face_match_jobs` is internal-only in this phase.
  - Queue writes/claims/completions happen only through tightly scoped `SECURITY DEFINER` SQL helpers.
- Job integrity:
  - `face_match_jobs` must enforce valid `job_type` / scope combinations so malformed jobs cannot be inserted.
  - `job_type` and `status` must be constrained by DB checks.
- Provenance preservation:
  - If an existing `(asset_id, consent_id)` link is already `manual`, future auto-processing must not downgrade that same row to `auto`.
  - This rule applies only per exact link row and does not block creation of additional links for other consents/assets.
- UI expectations:
  - This phase provides backbone + provenance scaffolding only.
  - Because the matcher is stubbed, no real auto-links are expected yet unless explicitly seeded/tested later.

## Step-by-step execution plan

### Step 1 - Queue + metadata schema migration
- Files:
  - `supabase/migrations/<timestamp>_010_auto_match_backbone_schema.sql`
- DB changes:
  - Add metadata columns to `public.asset_consent_links`:
    - `link_source text not null default 'manual' check (link_source in ('manual','auto'))`
    - `match_confidence numeric(5,4) null check (match_confidence >= 0 and match_confidence <= 1)`
    - `matched_at timestamptz null`
    - `reviewed_at timestamptz null`
    - `reviewed_by uuid null references auth.users(id) on delete set null`
    - `matcher_version text null`
  - Create queue table `public.face_match_jobs` with:
    - scope:
      - `tenant_id uuid not null`
      - `project_id uuid not null`
      - `scope_asset_id uuid null`
      - `scope_consent_id uuid null`
    - routing:
      - `job_type text not null`
      - `dedupe_key text not null`
      - `payload jsonb not null default '{}'::jsonb`
    - execution:
      - `status text not null default 'queued'`
      - `attempt_count int not null default 0`
      - `max_attempts int not null default 5`
      - `run_after timestamptz not null default now()`
      - `locked_at timestamptz null`
      - `locked_by text null`
      - `started_at timestamptz null`
      - `completed_at timestamptz null`
    - errors/audit:
      - `last_error_code text null`
      - `last_error_message text null`
      - `last_error_at timestamptz null`
      - `created_at timestamptz not null default now()`
      - `updated_at timestamptz not null default now()`
  - Constraints and indexes:
    - unique `(tenant_id, project_id, dedupe_key)`
    - composite FKs for scoped rows:
      - `(scope_asset_id, tenant_id, project_id)` -> `assets(id, tenant_id, project_id)` where applicable
      - `(scope_consent_id, tenant_id, project_id)` -> `consents(id, tenant_id, project_id)` where applicable
    - index on `(status, run_after)`
    - index on `(tenant_id, project_id, status)`
    - `CHECK` constraint on `job_type`:
      - `job_type in ('photo_uploaded', 'consent_headshot_ready', 'reconcile_project')`
    - `CHECK` constraint on `status`:
      - `status in ('queued', 'processing', 'succeeded', 'failed', 'dead')`
    - `CHECK` constraints for valid `job_type` / scope combinations, for example:
      - `photo_uploaded` requires `scope_asset_id`
      - `consent_headshot_ready` requires `scope_consent_id`
      - `reconcile_project` may require neither
- RLS:
  - Enable RLS on `face_match_jobs`.
  - Do not add member-facing policies.
  - Queue access is internal-only and will occur through `SECURITY DEFINER` helper functions.

### Step 2 - Queue SQL helpers for safe claim/retry
- Files:
  - `supabase/migrations/<timestamp>_010_auto_match_queue_functions.sql`
- DB changes:
  - Add `app.enqueue_face_match_job(...)` as a tightly scoped `SECURITY DEFINER` function to upsert by dedupe key and keep enqueue idempotent.
  - Add `app.claim_face_match_jobs(...)` as a tightly scoped `SECURITY DEFINER` function using `FOR UPDATE SKIP LOCKED` semantics for concurrent workers.
  - Add `app.complete_face_match_job(...)` as a tightly scoped `SECURITY DEFINER` function to mark success and maintain `updated_at`.
  - Add `app.fail_face_match_job(...)` as a tightly scoped `SECURITY DEFINER` function to centralize failure transitions, retry/backoff updates, dead-letter behavior, and `updated_at`.
- API/server impact:
  - Worker/reconcile routes will call these RPC helpers instead of ad-hoc `select/update` logic.

### Step 3 - Matching backbone server modules
- Files to create:
  - `src/lib/matching/auto-match-jobs.ts`
  - `src/lib/matching/auto-match-worker.ts`
  - `src/lib/matching/auto-match-reconcile.ts`
  - `src/lib/matching/auto-matcher.ts`
- Server logic:
  - `auto-match-jobs.ts`
    - deterministic dedupe-key builders
    - enqueue wrappers for photo, consent-headshot, and reconcile scopes
  - `auto-matcher.ts`
    - provider interface
    - stub/no-op implementation for this phase
  - `auto-match-worker.ts`
    - claim jobs
    - re-check current eligibility from DB
    - invoke stub matcher
    - perform idempotent link metadata writes when matches exist in future
    - complete/fail jobs
  - `auto-match-reconcile.ts`
    - bounded periodic backfill scan
    - enqueue missing jobs safely
- Provenance rule:
  - If an existing `(asset_id, consent_id)` row already has `link_source='manual'`, auto-processing must preserve that manual provenance.
  - This applies only to that exact row and must not block creation of new links for other eligible `(asset_id, consent_id)` pairs.
- Payload rule:
  - `payload` is advisory/debug context only.
  - Worker must always re-read current DB state and re-validate eligibility at execution time.

### Step 4 - Trigger integration on existing flows
- Files to modify:
  - `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`
  - `src/lib/assets/finalize-asset.ts` (if needed to expose finalized asset type)
  - `src/app/i/[token]/consent/route.ts`
  - `src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts`
- Trigger behavior:
  - Photo finalize trigger:
    - enqueue `photo_uploaded` job for uploaded photo assets only
  - Consent submit trigger:
    - when `face_match_opt_in=true` and a finalized eligible headshot is linked, enqueue `consent_headshot_ready`
  - Headshot replacement trigger:
    - enqueue `consent_headshot_ready` rematch job
- Failure strategy:
  - Primary user operations remain successful even if enqueue fails.
  - Reconciliation job backfills missed enqueue events later.

### Step 5 - Internal worker + reconciliation endpoints
- Files to create:
  - `src/app/api/internal/matching/worker/route.ts`
  - `src/app/api/internal/matching/reconcile/route.ts`
- Route behavior:
  - Worker endpoint:
    - token-protected, aligned with existing internal maintenance endpoint pattern
    - claims a batch of due jobs
    - processes jobs within request window
    - returns counts such as:
      - `claimed`
      - `succeeded`
      - `retried`
      - `dead`
      - `skipped_ineligible`
  - Reconcile endpoint:
    - token-protected
    - scans a bounded recent lookback window for eligible new photos, consents, and headshot replacements
    - enqueues deduped jobs
    - returns counts such as:
      - `scanned`
      - `enqueued`
      - `already_present`
- Cron/scheduling:
  - configure external scheduler/platform cron to call:
    - worker endpoint frequently
    - reconcile endpoint on slower cadence
- Scope note:
  - reconciliation is a backstop, not full historical reprocessing on every run

### Step 6 - Link metadata propagation + minimal provenance UI
- Files to modify:
  - `src/lib/matching/consent-photo-matching.ts`
  - `src/app/api/projects/[projectId]/consents/[consentId]/assets/links/route.ts`
  - `src/components/projects/consent-asset-matching-panel.tsx`
  - optionally `src/app/(protected)/projects/[projectId]/page.tsx`
- Server/API changes:
  - Include link metadata fields in linked-asset reads:
    - `link_source`
    - `match_confidence`
    - `matched_at`
    - `reviewed_at`
    - `reviewed_by`
  - Manual link writes remain idempotent and explicitly mark `link_source='manual'`
- UI changes:
  - Show `Manual` / `Auto` provenance badge on linked photos
  - Keep existing manual unlink/link controls as correction path
  - Do not add full review queue UI
- Expectation:
  - This UI is scaffolding for future real auto-links
  - because matcher is stubbed, no real auto-linked rows are expected by default in this phase

### Step 7 - Env/docs/tests and verification pass
- Files to modify:
  - `.env.example`
  - `README.md`
  - test files (if test harness exists)
- Add:
  - internal worker token env var
  - internal reconcile token env var
  - cron invocation notes
- Validation:
  - run migration reset and lint/tests after implementation

## Backbone data model

### `asset_consent_links` metadata additions
- `link_source`
  - provenance for canonical links (`manual` or `auto`)
- `match_confidence`
  - nullable placeholder for future provider scores
- `matched_at`
  - timestamp for auto-link creation time
- `reviewed_at`, `reviewed_by`
  - optional future review trail
- `matcher_version`
  - optional model/version tracking for future reprocessing

### `face_match_jobs` queue table
- Core identity:
  - `id uuid primary key`
  - `tenant_id uuid not null`
  - `project_id uuid not null`
  - `job_type text not null`
- Scope fields:
  - `scope_asset_id uuid null`
  - `scope_consent_id uuid null`
- Dedupe:
  - `dedupe_key text not null`
  - unique `(tenant_id, project_id, dedupe_key)`
- Status/retry:
  - `status text not null`
  - `attempt_count int not null default 0`
  - `max_attempts int not null default 5`
  - `run_after timestamptz not null default now()`
  - `locked_at timestamptz null`
  - `locked_by text null`
- Timing/audit:
  - `started_at timestamptz null`
  - `completed_at timestamptz null`
  - `last_error_code text null`
  - `last_error_message text null`
  - `last_error_at timestamptz null`
  - `payload jsonb not null default '{}'::jsonb`
  - `created_at timestamptz not null default now()`
  - `updated_at timestamptz not null default now()`

## Trigger and scheduling plan

- Photo finalize trigger:
  - on successful photo finalize, enqueue scoped `photo_uploaded` job keyed by asset id
- Consent submit trigger:
  - on successful public consent submit with opt-in and valid headshot link, enqueue scoped `consent_headshot_ready` job keyed by consent id plus current headshot context
- Headshot replacement trigger:
  - on successful staff replacement, enqueue `consent_headshot_ready` rematch job
- Periodic reconciliation:
  - internal reconcile endpoint scans recent eligible photos and consents/headshots and enqueues missing dedupe keys
- Async-only execution:
  - matching never runs inline in user request paths
  - user-facing endpoints only enqueue

## Worker / processing plan

- Enqueue:
  - use `app.enqueue_face_match_job` with deterministic dedupe keys
- Claim safely:
  - worker claims jobs via `app.claim_face_match_jobs` using `SKIP LOCKED`
- Retry-safe execution:
  - for each claimed job, re-check eligibility at processing time
  - on transient failure:
    - set `status='queued'`
    - increment `attempt_count`
    - move `run_after` forward using backoff
  - on permanent failure or max attempts reached:
    - set `status='dead'`
- Idempotent writes:
  - future auto-link writes use upsert on `(asset_id, consent_id)` with metadata updates
  - if existing row is already `manual`, preserve `link_source='manual'`
  - this does not prevent creation of additional links for other eligible consents/assets
- No-op matcher behavior in this phase:
  - `auto-matcher` interface exists, but default implementation returns zero matches
  - worker marks jobs succeeded with zero links created and records matcher version `stub`

## Security and privacy

- Tenant/project scoping:
  - all enqueue/claim/process queries include server-derived `tenant_id` and `project_id`
- No client-trusted tenant/project input:
  - public/staff routes derive scope exactly as existing code does today
- Biometric gating:
  - worker processes a consent only if `face_match_opt_in=true`
- Revocation gating:
  - worker skips consents with `revoked_at is not null`
- Headshot retention gating:
  - worker requires linked headshot asset to be uploaded, not archived, and not retention-expired
- Private storage:
  - no bucket/public policy change
  - no service role key exposed to client
- Auditability:
  - job table records lifecycle/error history
  - link metadata captures source and future score/review fields

## UI plan

- Minimum UX now:
  - add provenance indicators for linked assets (`Manual` / `Auto`)
  - keep existing manual unlink/link controls unchanged as correction path
- Expectation in this phase:
  - provenance UI is scaffolding for future real auto-links
  - because the matcher is stubbed, no real auto-linked rows are expected yet unless explicitly seeded/tested
- Optional lightweight status:
  - show backbone status only when useful
  - avoid operational dashboards in this phase
- Explicitly out of scope:
  - full candidate review queue
  - approve/reject workflow for every potential match

## Verification checklist

1. `supabase db reset` applies migrations cleanly.
2. New queue table, constraints, indexes, and helper functions exist and are callable through internal worker flow.
3. Photo finalize enqueues deduped `photo_uploaded` jobs.
4. Consent submit with opt-in + headshot enqueues `consent_headshot_ready` jobs.
5. Headshot replacement enqueues rematch jobs.
6. Worker claims jobs safely under concurrent calls.
7. Worker retries transient failures with backoff and moves exhausted jobs to `dead`.
8. Ineligible records are skipped:
  - revoked consent
  - `face_match_opt_in=false`
  - missing/archived/expired headshot
  - non-uploaded/archived photos
9. Stub matcher path succeeds with zero links and does not break user flows.
10. Link metadata fields are readable in API responses and displayed in consent linked-photo UI.
11. Manual matching/link/unlink behavior remains unchanged and idempotent.
12. Queue helper functions are the only supported access path to `face_match_jobs`; direct member-facing queue access is not possible.
13. Invalid `job_type` / scope combinations are rejected by DB constraints.
14. If a future auto-write touches an existing manual `(asset_id, consent_id)` row, manual provenance is preserved.
15. The stub matcher creates no real auto-links by default, but the queue/worker lifecycle still completes successfully.