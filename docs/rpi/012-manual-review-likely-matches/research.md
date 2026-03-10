# 012 Manual Review of Likely Facial Matches - Research

## Goal
Research the smallest production-realistic way to add manual review of likely face matches on top of Features 009/010/011, without architecture drift.

## Source of Truth and Verification Scope
This research was verified against repository code (ground truth), then compared to RPI docs.

Read and verified:
- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/009-matching-foundation/research.md`
- `docs/rpi/009-matching-foundation/plan.md`
- `docs/rpi/010-auto-face-matching/research.md`
- `docs/rpi/010-auto-face-matching/plan.md`
- `docs/rpi/011-real-face-matcher/research.md`
- `docs/rpi/011-real-face-matcher/plan.md`

Code inspected:
- `src/lib/matching/*`
- `src/lib/matching/providers/compreface.ts`
- `src/lib/assets/finalize-asset.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/*`
- `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`
- `src/app/i/[token]/consent/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts`
- `src/app/api/internal/matching/*`
- Matching migrations (009/010/011)
- Matching tests:
  - `tests/feature-010-auto-match-backbone.test.ts`
  - `tests/feature-011-real-face-matcher.test.ts`
  - `tests/feature-011-compreface-preprocess.test.ts`

## Current State (Code-Verified)

### 009 foundation (implemented)
- Canonical active links are in `public.asset_consent_links`.
- Consent-centric manual linking/unlinking exists and is server-side.
- Manual link writes are idempotent (`upsert` on `(asset_id, consent_id)`).
- Manual unlink is idempotent (`delete`) and now also writes suppression rows.

### 010 backbone (implemented)
- Queue table exists: `public.face_match_jobs`.
- Queue access is internal-only through SECURITY DEFINER SQL helpers:
  - `enqueue_face_match_job`
  - `claim_face_match_jobs`
  - `complete_face_match_job`
  - `fail_face_match_job`
- Trigger points are wired:
  - photo finalize -> `photo_uploaded`
  - consent submit (non-duplicate + opt-in + headshot) -> `consent_headshot_ready`
  - headshot replacement -> `consent_headshot_ready`
- Worker and reconcile internal endpoints exist and are token-gated.

### 011 real matcher (implemented)
- Real provider integration exists behind `auto-matcher.ts`, currently via CompreFace adapter.
- Threshold-based auto-link lifecycle exists in worker:
  - `confidence >= threshold` -> upsert auto link
  - `confidence < threshold` -> no create; stale auto link deleted
- Manual authority is preserved:
  - manual provenance protected by DB trigger and worker-side filtering
  - manual unlink suppression table exists: `asset_consent_link_suppressions`
  - worker excludes suppressed pairs and removes existing stale auto rows for suppressed pairs
- In-memory resize/compress before CompreFace upload is implemented.

## Data Model Relevant to Feature 012

### Canonical links
- `asset_consent_links`:
  - PK `(asset_id, consent_id)`
  - scope columns `tenant_id`, `project_id`
  - provenance and matcher metadata:
    - `link_source` (`manual`/`auto`)
    - `match_confidence`
    - `matched_at`
    - `reviewed_at`
    - `reviewed_by`
    - `matcher_version`

### Suppression
- `asset_consent_link_suppressions`:
  - PK `(asset_id, consent_id)`
  - reason currently constrained to `'manual_unlink'`
  - used by worker to block automatic recreation for exact pair.

### Queue
- `face_match_jobs` scoped by tenant/project with constrained job/scope combinations and retry/dead behavior.

### Critical gap for likely-match review
- There is currently **no persisted candidate/score store** for below-threshold or review-band matches.
- Worker computes pair scores in memory, then writes only:
  - above-threshold auto links
  - stale auto deletions
- Result: no queryable dataset exists for "likely matches to review".

## What Is Missing for Feature 012
- Persisted non-canonical match evidence for medium-confidence pairs.
- API query path to fetch likely matches for a specific consent with score sorting.
- UI toggle/filter behavior in the consent linking panel for likely-review mode.
- Optional explicit rejection action semantics (currently only link/unlink are exposed).

## Doc vs Code Mismatches (Important)
- `reconcile_project` job type is present in schema/helpers/worker branch, but reconcile endpoint currently directly enqueues `photo_uploaded` and `consent_headshot_ready`; it does not enqueue `reconcile_project` jobs in practice.
- 009/010 planning docs discuss broader list/pagination variants in matching panel; current consent matching endpoints are still basic (`q` + `limit`) and do not support dedicated confidence sorting/paging for likely-review data.

## Research Questions

### 1) Current matching data model after 009/010/011
- Canonical approved links: `asset_consent_links`.
- Auto metadata is on canonical rows.
- Manual unlink suppression is separate in `asset_consent_link_suppressions`.
- Queue/worker/reconcile are fully present.
- Below-threshold scores are **not persisted** today.

### 2) Does current system persist enough data for likely-review UI?
- No.
- Smallest required addition: persist candidate scores for exact `(asset_id, consent_id)` pairs outside canonical link table.

### 3) Best model for medium-confidence review data
Options:
- Reuse `asset_consent_links` for medium candidates: reject (breaks canonical "active links only" invariant).
- Ephemeral worker output only: reject (not queryable for UI).
- New candidate table (recommended): keep canonical table clean and preserve architecture.

Recommended table (smallest good):
- `asset_consent_match_candidates`
  - PK `(asset_id, consent_id)`
  - `tenant_id`, `project_id`
  - `confidence numeric(5,4)`
  - `matcher_version text`
  - `last_scored_at timestamptz`
  - optional `source_job_type text`
  - composite FKs to assets/consents in same project
  - RLS tenant-member select; worker/service-role write.

Additional optional columns to support review workflows without future schema changes:
  - reviewed_at timestamptz
  - reviewed_by uuid
These fields allow distinguishing between:
  - newly surfaced candidates
  - candidates already reviewed by a photographer
This supports future UI filters such as “show only unreviewed likely matches” without requiring a later migration.

Recommended index for efficient sorting in the review UI:
  -  index (consent_id, confidence DESC)
his supports queries of the form:

WHERE consent_id = ?
ORDER BY confidence DESC
LIMIT ?

which is the expected access pattern for the review panel.

### 4) Tradeoffs
- Candidate table:
  - Pros: idempotent upsert, retry-safe, easy confidence sorting/paging, keeps canonical links clean.
  - Cons: stale-row cleanup required.
- Reusing canonical links:
  - Pros: no new table.
  - Cons: conflates "approved" vs "suggested"; high risk to existing invariants.
- On-demand matching per UI request:
  - Pros: no persistence.
  - Cons: expensive, slow, non-deterministic UX, provider coupling in user requests.

### 5) Threshold model for review band
Recommended:
- `AUTO_MATCH_CONFIDENCE_THRESHOLD` remains upper bound (already implemented).
- Add `AUTO_MATCH_REVIEW_MIN_CONFIDENCE` as global lower bound (default `0.30`).
- Review band: `min_review <= confidence < auto_threshold`.
- Keep global env config for first version (not project setting yet).

### 6) UI behavior in existing linking panel
Recommended in `consent-asset-matching-panel`:
- Add toggle: **`Review likely matches`**
- When enabled:
  - query likely candidates only
  - sort by confidence descending
  - keep existing `Link selected` and `Unlink selected` actions
- Keep normal unlinked browsing as default mode.
- Do not mix likely and normal lists in one unsorted stream.

### 7) Interaction with manual invariants
- Manual link remains authoritative (already true).
- Manual unlink suppression remains authoritative (already true).
- For explicit rejection of a likely candidate:
  - recommended behavior: suppress future resurfacing for exact pair.
  - minimal way: reuse suppression table semantics.

### 8) Should reviewed-but-not-linked candidates be persisted?
- Yes, as latest-state candidates (not full history).
- Needed fields:
  - exact pair identity + tenant/project scope
  - latest confidence
  - matcher version
  - last scored timestamp
- Full historical audit of every score is out of scope for 012.

### 9) Behavior when jobs rerun and scores change
Recommended deterministic lifecycle:
- `confidence >= auto_threshold`:
  - ensure canonical auto link exists
  - remove candidate row for that pair
- `review_min <= confidence < auto_threshold`:
  - upsert/update candidate row
  - ensure no new auto link
- `confidence < review_min`:
  - delete candidate row
  - stale auto link handling remains as currently implemented
- Suppressed pair:
  - no auto link creation
  - candidate row hidden/removed.
Worker should explicitly remove candidate rows when suppression exists for a pair.
This prevents stale candidate rows from appearing for pairs that have been manually rejected.


### 10) Smallest production-realistic solution
- Extend current worker to persist review-band candidates.
- Extend existing consent matchable API to support likely-review mode.
- Add UI toggle in existing matching panel.
- No architecture redesign, no new public pages, no cross-project behavior.

### 11) New endpoints needed?
- Not required.
- Smallest path: extend existing endpoint:
  - `GET /api/projects/[projectId]/consents/[consentId]/assets/matchable`
  - add query mode, e.g. `mode=likely`, with optional paging/sort params.
- Existing POST/DELETE links endpoints remain the write path.

### 12) Security/RLS implications
- Candidate table must be tenant/project scoped with composite FKs and RLS.
- Worker writes stay server/service-role/internal.
- UI/API returns only same-tenant/same-project candidate rows.
- No client-provided tenant/project trust.
- No cross-project matching exposure.

The candidate table should enforce the same composite foreign key structure used in asset_consent_links:
  - (asset_id, tenant_id, project_id)
  - (consent_id, tenant_id, project_id)
This preserves the invariant that cross-project or cross-tenant matching is impossible at the database level.

### Storage Growth Considerations
The candidate table size is bounded by the review-band lifecycle rules.
Typical project scale example:
  - 20 consents
    - 1000 assets
Worst-case raw pair combinations:
    - 20,000 potential pairs

However only pairs within the review band are stored:
  - review_min <= confidence < auto_threshold

Additionally:
  - scores below review_min are deleted
  - scores above auto_threshold become canonical links and candidate rows are removed

This keeps the candidate dataset bounded and prevents unbounded growth.

## Edge Cases (012-specific)
- Score rises from review band to auto threshold:
  - candidate removed, auto link created.
- Score drops below review band:
  - candidate removed.
- Manually linked pair later scores low:
  - manual link remains; no downgrade.
- Manually unlinked/suppressed pair:
  - should not auto-recreate; should not appear in likely-review mode.
- Multiple people in one asset:
  - multiple consent candidates for same asset supported.
- Duplicate/replayed jobs:
  - candidate upsert + canonical upsert/delete remain idempotent.
- Matcher version changes:
  - update candidate row `matcher_version` + `last_scored_at`; stale behavior remains deterministic.
- Large projects:
  - likely-review query requires confidence sorting + pagination.
- Ineligible consent/headshot/photo:
  - no candidate creation.

## Recommended Feature 012 Scope (Bounded)
Feature 012 should be its own cycle and stay small:

1. Add `asset_consent_match_candidates` table (latest-state candidates only).
2. Add worker persistence rules for review band candidate lifecycle.
3. Add review-min threshold config.
4. Extend existing consent matchable endpoint for likely-review mode and confidence sorting.
5. Add `Review likely matches` toggle to existing consent matching panel.
6. Keep canonical `asset_consent_links` unchanged as approved-link source of truth.
7. Keep queue/worker/reconcile architecture unchanged.

## Final Recommendation
Implement manual likely-match review as a thin extension of current worker + existing consent matching API/UI, with one small candidate table for medium-confidence pairs.

Recommended toggle label:
- **`Review likely matches`**

This is the smallest maintainable design that:
- preserves 009/010/011 architecture
- keeps business logic server-side
- keeps writes idempotent/retry-safe
- preserves manual authority and suppression invariants
- avoids introducing a large new review subsystem.
