# Feature 020 Research: Materialized Headshot Resolution Bug

## 1. Scope and method

This research covers the current production bug in the Feature 019 materialized matching pipeline where worker jobs fail with:

- `jobType = materialize_asset_faces`
- `errorCode = face_match_headshot_lookup_failed`

Ground truth was verified from:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/019-face-materialization-deduped-embedding-pipeline/research.md`
- `docs/rpi/019-face-materialization-deduped-embedding-pipeline/plan.md`
- `src/lib/matching/face-materialization.ts`
- `src/lib/matching/auto-match-worker.ts`
- `src/lib/matching/consent-photo-matching.ts`
- `src/lib/consent/submit-consent.ts`
- `supabase/migrations/20260306101000_006_headshot_consent_submit_rpc.sql`
- `tests/feature-019-face-materialization-pipeline.test.ts`

Repository code is treated as authoritative.

## 2. Current behavior

### 2.1 Where the failure happens

The failing path is in `loadEligibleConsentsWithHeadshotAssets(...)` in [face-materialization.ts](/C:/Users/tim/projects/snapconsent-lite/src/lib/matching/face-materialization.ts).

That function currently:

1. Loads eligible consents from `consents`.
2. Loads all `asset_consent_links` rows for those consent ids.
3. Extracts every linked `asset_id`.
4. Queries `assets` for `asset_type = 'headshot'` where `id in (<all linked asset ids>)`.
5. Picks the newest headshot per consent from the filtered result.

### 2.2 Why this worked at first

This works on an empty or nearly empty project because a newly opted-in consent initially gets its headshot linked into `asset_consent_links` during public consent submit:

- [20260306101000_006_headshot_consent_submit_rpc.sql](/C:/Users/tim/projects/snapconsent-lite/supabase/migrations/20260306101000_006_headshot_consent_submit_rpc.sql)

So early on, `asset_consent_links` may contain mostly:

- one headshot link per consent

### 2.3 Why it fails on a real matched project

`asset_consent_links` is not a headshot mapping table. It is the canonical pair-level approved-link table for both:

- consent headshots
- matched project photos

That is verified in:

- manual link/unlink code in [consent-photo-matching.ts](/C:/Users/tim/projects/snapconsent-lite/src/lib/matching/consent-photo-matching.ts)
- auto-link apply behavior in [auto-match-worker.ts](/C:/Users/tim/projects/snapconsent-lite/src/lib/matching/auto-match-worker.ts)

Once a consent has many matched photos, the current helper does not load "current headshot links". It loads all canonical links for that consent, including many photo asset ids, then sends the whole mixed set into an `assets ... in (...)` query.

This means the helper is using the canonical approved-link table as if it were a dedicated headshot index.

## 3. Verified symptom

The worker logs show repeated retries for:

- `jobType: materialize_asset_faces`
- `errorCode: face_match_headshot_lookup_failed`

and zero progress:

- `succeeded: 0`
- `retried: <claimed>`
- `scoredPairs: 0`

This matches the current code path:

- `materialize_asset_faces` for a photo needs eligible consent headshots so it can enqueue downstream compare jobs
- that resolution currently goes through `loadEligibleConsentsWithHeadshotAssets(...)`
- when that lookup fails, the job is retried and no compare jobs are scheduled

## 4. Root cause

The root cause is a modeling/query bug:

- Feature 019 needs "current eligible headshot asset per consent"
- current code derives that by scanning `asset_consent_links`
- but `asset_consent_links` is canonical pair approval state, not a dedicated headshot relation

The breakage is not that the table contains bad data. The breakage is that the query assumes the table only or mainly contains headshot rows.

On a real project with many matched photos, this creates an unnecessarily large and semantically mixed lookup set.

## 5. Code/docs mismatch

Feature 019 docs describe "current linked headshot asset plus current materializer version" as the currentness model.

That intent is reasonable, but the implementation currently resolves "current linked headshot asset" by reading every canonical link row for the consent first and filtering afterward. In practice, that is too broad for the live canonical table shape.

So the mismatch is:

- docs assume a clean current-headshot lookup
- code currently performs a broad canonical-link scan and only later filters to headshots

## 6. Constraints for the fix

The fix must preserve these verified invariants:

- `asset_consent_links` remains canonical approved-link state
- manual links remain authoritative
- suppressions remain authoritative
- tenant/project scoping remains explicit
- writes remain retry-safe
- no client trust boundary changes
- no schema redesign unless clearly necessary

This bug does not justify changing canonical link semantics.

## 7. Smallest safe fix direction

The smallest production-safe repair is to narrow headshot resolution so it only considers headshot assets at query time, not after loading all canonical links.

That implies:

1. Keep using the existing headshot link convention for now.
2. Stop building a large mixed `asset_id` list from all consent links.
3. Resolve headshots by joining or filtering against `assets.asset_type = 'headshot'` before or during link lookup.
4. Return only one current eligible headshot per consent.

This should be implemented inside the materialization helper, without changing:

- trigger routes
- queue architecture
- compare semantics
- canonical pair-level apply behavior

## 8. Likely implementation shape

The likely repair is in [face-materialization.ts](/C:/Users/tim/projects/snapconsent-lite/src/lib/matching/face-materialization.ts):

- replace the two-step "load all links, then filter ids through assets" approach
- with a query that only loads headshot-linked assets for the eligible consents

Likely additional hardening:

- make `loadConsentHeadshotMaterialization(...)` resolve one consent directly instead of loading up to `750` consent headshots and filtering in memory
- add regression tests for a consent that already has many photo links plus one headshot link
- add a worker-level regression proving `materialize_asset_faces` can progress on a project with existing approved photo links

## 9. Risks and edge cases

### Multiple headshot links for one consent

Current code sorts by `uploaded_at desc` and chooses the newest headshot. The fix should preserve that behavior.

### Old headshot links left in canonical state

If headshot replacement can leave historical headshot links around, the fix still needs deterministic "newest uploaded headshot wins" behavior.

### Revoked or non-opt-in consents

These must still be filtered out before headshot resolution.

### Missing or expired headshots

These must continue to resolve to "no eligible headshot", not a worker failure.

### Retry behavior

The fix should turn current retry storms into either:

- successful scheduling when a valid headshot exists
- safe no-op when no valid headshot exists

not repeated transient failures.

## 10. Recommendation

Proceed with a small repair focused on headshot lookup only.

Recommended scope:

- fix `loadEligibleConsentsWithHeadshotAssets(...)`
- fix any single-consent headshot lookup path that currently depends on the same broad scan
- add targeted regression tests

What this implies:

- Feature 019 materialized matching should start progressing again on real projects
- existing canonical/manual/suppression semantics should remain unchanged
- no migration should be required for this bug fix
