# 012 Manual Review of Likely Facial Matches - Plan

## Ground-Truth Validation (Code First)

This plan is based on the current repository implementation, not intent docs alone.

Validated current state:
- Feature 009 foundation exists:
  - canonical approved links are in `public.asset_consent_links`
  - consent-centric manual link/unlink is implemented in `src/lib/matching/consent-photo-matching.ts`
- Feature 010 backbone exists:
  - queue table `public.face_match_jobs` with constrained `job_type`/scope and status checks
  - queue access is internal-only via SECURITY DEFINER SQL helpers
  - worker and reconcile internal routes are token-protected
  - enqueue triggers are wired on photo finalize, consent submit, and headshot replacement
- Feature 011 real matcher exists:
  - provider selected in `src/lib/matching/auto-matcher.ts` (CompreFace supported)
  - threshold logic in worker upserts/deletes auto links in `asset_consent_links`
  - manual provenance is preserved
  - manual unlink suppression is persisted in `asset_consent_link_suppressions`

Critical current gap for 012:
- Worker does not persist medium-confidence candidates anywhere.
- `assets/matchable` API returns normal unlinked photos only; no likely-review mode.
- UI has no "Review likely matches" toggle.

Observed doc/code mismatch to preserve as-is for 012:
- `reconcile_project` exists in queue schema/helpers/worker branch, but reconcile currently enqueues photo/consent jobs directly.
- 012 does not change this behavior.

## Decisions

- Keep current 009/010/011 architecture unchanged:
  - same queue/worker/reconcile design
  - no new public subsystem
  - canonical approved links remain `asset_consent_links`
- Add a small candidate table for medium-confidence results:
  - `asset_consent_match_candidates`
  - latest-state per exact `(asset_id, consent_id)` pair
- Keep all business logic server-side.
- Keep writes idempotent and retry-safe.
- Preserve tenant/project scoping and no cross-project matching.
- Extend existing consent matching API and panel UI; do not create new pages/endpoints unless needed.

## Data Model (New Candidate Table)

Create migration:
- `supabase/migrations/<timestamp>_012_auto_match_likely_candidates.sql`

Add table:
- `public.asset_consent_match_candidates`

Columns:
- `asset_id uuid not null`
- `consent_id uuid not null`
- `tenant_id uuid not null`
- `project_id uuid not null`
- `confidence numeric(5,4) not null`
- `matcher_version text null`
- `source_job_type text null`
- `last_scored_at timestamptz not null default now()`
- `reviewed_at timestamptz null`
- `reviewed_by uuid null references auth.users(id) on delete set null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Constraints:
- primary key `(asset_id, consent_id)`
- confidence check `confidence >= 0 and confidence <= 1`
- source job type check allowing:
  - `photo_uploaded`
  - `consent_headshot_ready`
  - `reconcile_project`
- composite FK `(asset_id, tenant_id, project_id) -> assets(id, tenant_id, project_id)` on delete cascade
- composite FK `(consent_id, tenant_id, project_id) -> consents(id, tenant_id, project_id)` on delete cascade

Indexes:
- `(tenant_id, project_id, consent_id, confidence desc)`
- `(tenant_id, project_id, asset_id)`
- optional `(tenant_id, project_id, updated_at desc)` for cleanup/ops visibility

RLS:
- enable RLS
- add tenant-member `select` policy (same membership pattern as link tables)
- add tenant-member `delete` policy for scoped maintenance if needed
- add tenant-member `insert/update` policies to keep current server-client mode compatible
- internal worker writes continue through service role with existing architecture

## Configuration Changes

Modify:
- `src/lib/matching/auto-match-config.ts`
- `.env.example`
- `README.md`

Add:
- `AUTO_MATCH_REVIEW_MIN_CONFIDENCE` (default `0.30`)

Rules:
- review band is `review_min <= confidence < auto_threshold`
- clamp review min to `[0, 1]`
- enforce deterministic behavior when misconfigured:
  - if review min >= auto threshold, review band becomes empty

## Step-by-Step Implementation Plan

### Step 1 - Add Candidate Schema
- Add migration for `asset_consent_match_candidates` table, constraints, indexes, and RLS policies.
- Keep migration small and self-contained.

### Step 2 - Extend Worker for Candidate Lifecycle
Modify:
- `src/lib/matching/auto-match-worker.ts`
- `src/lib/matching/auto-match-config.ts`

Worker lifecycle per candidate pair:
1. Load candidates and score as today.
2. Keep current manual/suppression protections and auto-link lifecycle.
3. Apply candidate table lifecycle:
   - `confidence >= auto_threshold`:
     - upsert/update canonical auto link (existing behavior)
     - delete candidate row for exact pair
   - `review_min <= confidence < auto_threshold`:
     - only if pair is not manual and not suppressed:
       - upsert candidate row with latest score/version/job type/timestamp
     - do not create auto link
   - `confidence < review_min`:
     - delete candidate row for exact pair
4. If pair is manual or suppressed:
   - never create candidate row
   - remove existing candidate row for that pair
5. If stale auto link is deleted (existing logic), candidate lifecycle still follows thresholds above.

Idempotency:
- candidate writes use upsert on `(asset_id, consent_id)`
- deletes are exact-pair scoped with tenant/project filters
- duplicate/replayed jobs remain safe

### Step 3 - Extend Consent Matchable API with Likely Mode
Modify:
- `src/lib/matching/consent-photo-matching.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/matchable/route.ts`

Add a likely mode to existing endpoint:
- `GET /api/projects/[projectId]/consents/[consentId]/assets/matchable?mode=likely&limit=...&q=...`

Behavior:
- `mode=default` (or omitted):
  - keep current behavior (unlinked uploaded photos)
- `mode=likely`:
  - return only unlinked uploaded photo assets for this consent with candidate rows in review band
  - exclude manual/auto already-linked pairs
  - exclude suppressed pairs
  - sort by confidence descending, then stable tie-breaker (`created_at desc`)
  - include candidate metadata per item:
    - `confidence`
    - `lastScoredAt`
    - `matcherVersion`

Security:
- keep auth + tenant derivation in route
- never trust tenant/project from client
- enforce same tenant/project consent scope before querying

### Step 4 - UI Toggle in Existing Consent Matching Panel
Modify:
- `src/components/projects/consent-asset-matching-panel.tsx`

Add:
- checkbox/toggle label: `Review likely matches`

UI behavior:
- default off (current behavior unchanged)
- when enabled:
  - call existing `assets/matchable` endpoint with `mode=likely`
  - show likely assets sorted by confidence
  - display confidence badge/value per asset
- keep existing actions coherent:
  - `Link selected` works unchanged
  - `Unlink selected` works unchanged
  - linking removes candidate row indirectly on next worker run; optional immediate refresh after successful link

### Step 5 - Tests
Create:
- `tests/feature-012-manual-review-likely-matches.test.ts`

Modify if needed:
- `tests/feature-011-real-face-matcher.test.ts`

Minimum deterministic coverage:
- review-band score upserts candidate row (no auto link)
- above-threshold score creates/updates auto link and removes candidate row
- below-review-min score removes candidate row
- manual link pair never gets candidate row
- suppressed pair never gets candidate row
- duplicate job replay is idempotent for candidate upsert
- likely-mode API returns only unlinked review-band rows sorted by confidence desc
- opt-out/revoked/missing-headshot/archived-photo remain ineligible and do not create candidates

### Step 6 - Docs and Env Notes
Modify:
- `.env.example`
- `README.md`

Add concise notes:
- what `AUTO_MATCH_REVIEW_MIN_CONFIDENCE` does
- likely-review mode depends on worker having processed jobs

## Files to Create

- `supabase/migrations/<timestamp>_012_auto_match_likely_candidates.sql`
- `tests/feature-012-manual-review-likely-matches.test.ts`

## Files to Modify

- `src/lib/matching/auto-match-config.ts`
- `src/lib/matching/auto-match-worker.ts`
- `src/lib/matching/consent-photo-matching.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/matchable/route.ts`
- `src/components/projects/consent-asset-matching-panel.tsx`
- `.env.example`
- `README.md`
- `tests/feature-011-real-face-matcher.test.ts` (if helper reuse is needed)

## Edge Cases and Invariants (Must Hold)

- duplicate/replayed jobs do not create duplicate canonical or candidate rows
- revoked consent / opt-out consent remain ineligible
- missing/expired headshot remains ineligible
- archived/non-uploaded photo remains ineligible
- manual link remains authoritative and is never downgraded
- manual unlink suppression prevents auto recreation and likely resurfacing
- score crosses thresholds on rerun:
  - review -> auto: candidate removed, auto link present
  - auto -> review/below: stale auto removal still applies; candidate behavior follows band
  - review -> below: candidate removed
- multi-person photos supported via many `(asset_id, consent_id)` pairs
- tenant/project scoping enforced at query and DB constraint level
- no cross-project matching exposure

## Verification Checklist

1. `supabase db reset` applies new migration cleanly.
2. Existing 009/010/011 tests still pass.
3. Worker processing with deterministic matcher creates review-band candidates correctly.
4. Above-threshold processing still writes canonical auto links and clears candidate rows.
5. Below-review-min processing clears candidate rows.
6. Manual links and suppressions block candidate surfacing and auto writes for exact pair.
7. Likely mode API returns only unlinked, in-band, sorted candidate assets for the selected consent.
8. Consent linking panel toggle loads likely mode and still supports normal link/unlink actions.
9. Tenant/project isolation remains intact for candidate reads/writes.
10. No new public endpoint or queue architecture change was introduced.
