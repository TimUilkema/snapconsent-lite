# 011 Real Face Matcher - Plan

## Ground-Truth Validation (Feature 010 Backbone)

This plan is based on repository code, not intent docs alone.

Validated in current implementation:
- Queue exists and is constrained in DB:
  - `public.face_match_jobs`
  - valid `job_type` / scope combinations
  - status checks and dedupe key uniqueness
  - internal-only access via SECURITY DEFINER helpers
- Trigger moments are wired:
  - photo finalize route enqueues `photo_uploaded`
  - consent submit route enqueues `consent_headshot_ready`
  - headshot replacement route enqueues `consent_headshot_ready`
- Internal endpoints exist and are token-protected:
  - `/api/internal/matching/worker`
  - `/api/internal/matching/reconcile`
- Worker eligibility re-check already exists server-side.
- `asset_consent_links` is canonical and already carries auto/manual provenance metadata.
- Manual provenance downgrade protection exists for existing rows (`manual` cannot be overwritten by `auto`).

Implication for 011:
- Keep queue/worker/reconcile architecture unchanged.
- Replace matcher stub only; do not add public endpoints or redesign queue model.

## Decisions

- Provider for 011: **CompreFace** (local/self-hosted Docker service).
- Provider integration boundary:
  - keep `src/lib/matching/auto-matcher.ts` as provider interface
  - add adapter at `src/lib/matching/providers/compreface.ts`
- Matching execution remains worker-only.
- Threshold policy:
  - `AUTO_MATCH_CONFIDENCE_THRESHOLD`
  - `confidence >= threshold` => create/update auto link
  - `confidence < threshold` => do not create link; remove existing auto link for that exact pair
- Manual authority rules:
  - manual links always override automatic behavior
  - manual unlink suppresses future auto recreation for exact `(asset_id, consent_id)`
- Canonical active links remain in `asset_consent_links`.
- Writes remain idempotent and retry-safe.

## Step-by-Step Implementation Plan (HIGH)

### Step 1 - Add Matcher Config + Provider Boundary

Create:
- `src/lib/matching/auto-match-config.ts`
- `src/lib/matching/providers/compreface.ts`

Modify:
- `src/lib/matching/auto-matcher.ts`

Changes:
- Add env parsing and validation for:
  - `AUTO_MATCH_PROVIDER=compreface`
  - `AUTO_MATCH_CONFIDENCE_THRESHOLD`
  - `AUTO_MATCH_PROVIDER_TIMEOUT_MS`
  - `COMPREFACE_BASE_URL`
  - `COMPREFACE_API_KEY`
  - optional `AUTO_MATCH_MAX_COMPARISONS_PER_JOB`
- Keep `auto-matcher.ts` as provider interface and provider selector.
- Add CompreFace adapter implementation behind this interface.
- Keep provider logic isolated from queue/domain logic.

### Step 2 - Add Manual-Unlink Suppression Persistence

Create migration:
- `supabase/migrations/<timestamp>_011_auto_match_manual_unlink_suppressions.sql`

DB changes:
- Create table `public.asset_consent_link_suppressions` with exact-pair keying:
  - `asset_id uuid not null`
  - `consent_id uuid not null`
  - `tenant_id uuid not null`
  - `project_id uuid not null`
  - `reason text not null default 'manual_unlink'`
  - `created_at timestamptz not null default now()`
  - optional `created_by uuid null`
- Constraints:
  - primary key `(asset_id, consent_id)`
  - composite FK to assets `(asset_id, tenant_id, project_id)`
  - composite FK to consents `(consent_id, tenant_id, project_id)`
  - reason check restricted to known values (start with `'manual_unlink'`)
- Indexes:
  - `(tenant_id, project_id, consent_id)`
  - `(tenant_id, project_id, asset_id)`
- RLS:
  - enable RLS
  - tenant-member `select/insert/delete` policies (same tenancy model as existing matching writes)

Reason:
- `asset_consent_links` remains canonical active-link table.
- Suppression state must be persisted outside active links to honor manual unlink intent.

### Step 3 - Update Manual Link/Unlink Write Paths

Modify:
- `src/lib/matching/consent-photo-matching.ts`
- `src/lib/assets/finalize-asset.ts`

Changes:
- On manual photo unlink:
  - delete active row from `asset_consent_links` (existing behavior)
  - insert suppression row into `asset_consent_link_suppressions` for each exact pair
- On manual photo link:
  - upsert canonical manual link (existing behavior)
  - delete suppression row for that exact pair (manual relink unsuppresses)
- On finalize with `consentIds` (manual linking path), clear suppression for linked exact pairs.
- Keep tenant/project scoping on all reads/writes.
- Keep idempotency (retries safe if suppression already exists/absent).

Note:
- Suppression is limited to manual photo matching paths.
- Do not change headshot replacement semantics.

### Step 4 - Worker Candidate Enrichment for Real Matching

Modify:
- `src/lib/matching/auto-match-worker.ts`

Changes:
- Keep existing job claim/retry/dead flow and eligibility re-check model.
- For eligible candidates, resolve required storage metadata (`storage_bucket`, `storage_path`) for both photo and headshot sides.
- Build pair inputs for matcher with explicit exact pair identity:
  - `(asset_id, consent_id)`
  - photo storage reference
  - headshot storage reference
- Enforce optional `AUTO_MATCH_MAX_COMPARISONS_PER_JOB` cap to bound runtime.
- Preserve multi-person behavior:
  - `photo_uploaded`: one photo against many eligible consents
  - `consent_headshot_ready`: one consent against many eligible photos

### Step 5 - Apply Threshold + Canonical Auto-Link Lifecycle

Modify:
- `src/lib/matching/auto-match-worker.ts`

Changes:
- Parse threshold once per run from config.
- For scored pairs:
  - `confidence >= threshold`:
    - upsert into `asset_consent_links` as `link_source='auto'`
    - write `match_confidence`, `matched_at`, `matcher_version`
    - skip rows already manual
    - skip rows suppressed by manual unlink
  - `confidence < threshold`:
    - do not create link
    - if exact pair currently has `link_source='auto'`, delete it (stale auto cleanup)
    - never delete manual link
- Also remove existing auto links for exact pairs that are suppressed by manual unlink.
- Keep all writes idempotent:
  - upsert on `(asset_id, consent_id)`
  - scoped deletes constrained by tenant/project + exact pair + `link_source='auto'`

### Step 6 - Retry Classification and Provider Error Handling

Create:
- `src/lib/matching/provider-errors.ts` (or equivalent colocated error types)

Modify:
- `src/lib/matching/providers/compreface.ts`
- `src/lib/matching/auto-match-worker.ts`

Changes:
- Classify provider failures into retryable/non-retryable categories:
  - retryable: timeout, network failure, HTTP 5xx
  - non-retryable: invalid config/auth, permanent request contract errors, provider invalid-image contract errors
- Keep queue behavior:
  - retryable failures -> `fail_face_match_job(..., retryable=true)` (requeued with backoff)
  - non-retryable failures -> `fail_face_match_job(..., retryable=false)` (dead at next transition)
- Pair-level invalid-image/no-face conditions should not break tenant scoping or idempotency; they should not create links.

### Step 7 - Keep Reconcile/Trigger Architecture Intact

Modify only if necessary:
- `src/lib/matching/auto-match-reconcile.ts` (likely no logic changes)
- trigger routes only if type/interface changes require small wiring edits

Changes:
- No new trigger moments.
- No new endpoints.
- Keep existing queue job types:
  - `photo_uploaded`
  - `consent_headshot_ready`
  - `reconcile_project` (reconcile/backfill job type)
- Keep payload advisory-only rule; worker always re-validates current eligibility from DB.

### Step 8 - Local Docker Setup + Env/Docs

Modify:
- `.env.example`
- `README.md`

Changes:
- Add matcher env vars and descriptions.
- Add local CompreFace setup instructions:
  - run CompreFace via Docker (official self-hosted stack)
  - create/access API key for recognition/verification service
  - configure `COMPREFACE_BASE_URL` and `COMPREFACE_API_KEY`
  - call existing internal worker/reconcile endpoints as before
- Explicitly document that secrets stay server-side and no public endpoint changes are introduced.

### Step 9 - Tests (Deterministic + Focused)

Create:
- `tests/feature-011-real-face-matcher.test.ts`

Modify:
- `tests/feature-010-auto-match-backbone.test.ts` only if shared helpers are extracted

Test strategy:
- Prefer deterministic worker tests with matcher injection/fake provider (no mandatory live CompreFace dependency).
- Add focused coverage for:
  - photo finalize enqueue path remains valid with real matcher integration
  - consent submit enqueue path remains valid
  - headshot replacement enqueue remains valid
  - threshold pass creates/updates auto link
  - threshold fail creates no link
  - threshold fail after prior auto link removes stale auto link
  - manual link row is preserved and never downgraded/removed by matcher
  - manual unlink creates suppression and prevents future auto recreation
  - duplicate/replayed jobs remain idempotent (no duplicate rows)
  - revoked consent / opt-out / missing headshot / archived photo => no new link
  - provider timeout and provider 5xx are retried
  - provider invalid-image classification is non-retryable or pair-skipped per contract
  - multi-person photo behavior (multiple consents can be auto-linked to one asset)

## Files To Create

- `supabase/migrations/<timestamp>_011_auto_match_manual_unlink_suppressions.sql`
- `src/lib/matching/auto-match-config.ts`
- `src/lib/matching/providers/compreface.ts`
- `src/lib/matching/provider-errors.ts` (or equivalent)
- `tests/feature-011-real-face-matcher.test.ts`

## Files To Modify

- `src/lib/matching/auto-matcher.ts`
- `src/lib/matching/auto-match-worker.ts`
- `src/lib/matching/consent-photo-matching.ts`
- `src/lib/assets/finalize-asset.ts`
- `.env.example`
- `README.md`
- `src/lib/matching/auto-match-reconcile.ts` (only if adapter interface requires it)
- trigger route files only if compile-time wiring requires minimal updates

## Edge Cases Coverage (Explicit)

- duplicate jobs
- revoked consent
- opt-out
- missing headshot
- archived photo
- provider timeout
- provider 5xx
- provider invalid image
- manual link
- manual unlink
- stale auto links
- multi-person photos

## Verification Checklist

1. `supabase db reset` applies with new suppression migration cleanly.
2. Feature 010 trigger paths still enqueue correctly.
3. Worker processes queued jobs with CompreFace provider selected via env.
4. Threshold behavior is correct:
   - above threshold creates/updates auto links
   - below threshold does not create links
5. Existing auto link is removed when same exact pair scores below threshold later.
6. Manual link is never downgraded or deleted by matcher.
7. Manual unlink suppresses future auto recreation for exact pair.
8. Duplicate jobs do not create duplicate canonical rows.
9. Reconcile still backfills missed jobs and remains internal-only.
10. Retry classification works:
    - timeout/5xx retried
    - non-retryable provider errors do not loop forever
11. Tenant scoping remains enforced in every query/write path.
12. `npm run lint` and `npm test` pass after implementation.
