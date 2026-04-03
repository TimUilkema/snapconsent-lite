# Feature 020 Plan: Materialized Headshot Resolution Bug

## Scope boundary

This plan fixes the live Feature 019 bug where materialized worker jobs retry with:

- `errorCode = face_match_headshot_lookup_failed`

Scope is intentionally narrow:

- fix headshot resolution in the materialized pipeline
- keep `asset_consent_links` canonical
- keep current matching/apply semantics unchanged
- add targeted regression tests

Out of scope:

- schema redesign
- canonical link model changes
- face-level exclusivity
- queue architecture changes
- threshold or policy changes

## 1. Ground-truth validation

### Verified current behavior in code

- The failing code path is `loadEligibleConsentsWithHeadshotAssets(...)` in [face-materialization.ts](/C:/Users/tim/projects/snapconsent-lite/src/lib/matching/face-materialization.ts).
- `materialize_asset_faces` jobs rely on that helper to resolve eligible consent headshots before scheduling downstream compare work.
- Headshot links are initially inserted into `asset_consent_links` during public consent submit in [20260306101000_006_headshot_consent_submit_rpc.sql](/C:/Users/tim/projects/snapconsent-lite/supabase/migrations/20260306101000_006_headshot_consent_submit_rpc.sql).
- The same `asset_consent_links` table is also the canonical approved-link table for matched photos, verified in:
  - [consent-photo-matching.ts](/C:/Users/tim/projects/snapconsent-lite/src/lib/matching/consent-photo-matching.ts)
  - [auto-match-worker.ts](/C:/Users/tim/projects/snapconsent-lite/src/lib/matching/auto-match-worker.ts)

### Verified bug shape

Current headshot resolution does this:

1. load eligible consent ids
2. load all `asset_consent_links` rows for those consents
3. extract all linked asset ids, including approved photos
4. query `assets` for headshots from that mixed set
5. pick newest uploaded headshot per consent

That is too broad for real projects where each consent may already have many approved photo links.

### Verified invariants to preserve

- `asset_consent_links` remains canonical approved-link state
- manual links remain authoritative
- suppressions remain authoritative
- tenant/project scoping remains explicit and server-side
- retries remain safe
- current headshot selection behavior remains “newest eligible uploaded headshot wins”

### Code/docs mismatch relevant to this fix

Feature 019 docs assume a clean “current linked headshot” lookup. Current implementation achieves that by scanning broad canonical links first and filtering later. Code is authoritative, so Feature 020 fixes that implementation drift rather than changing the Feature 019 design intent.

## 2. Step-by-step implementation plan

### Step 1: Refactor headshot lookup in `face-materialization.ts`

- [x] Replace the current broad `asset_consent_links -> mixed asset ids -> assets` flow.
- [x] Add a headshot-specific lookup path that only considers linked assets where:
  - `asset_type = 'headshot'`
  - `status = 'uploaded'`
  - `archived_at is null`
  - `retention_expires_at is null or > now()`
- [x] Preserve newest-uploaded headshot selection per consent.

### Step 2: Tighten single-consent lookup path

- [x] Review `loadConsentHeadshotMaterialization(...)`.
- [x] Avoid loading up to `750` consent headshots and filtering in memory when only one consent is needed.
- [x] Reuse the same narrowed headshot-resolution helper for both:
  - all-eligible-consent lookup
  - one-consent lookup

### Step 3: Keep worker/apply behavior unchanged

- [x] Do not change worker claim/complete/fail lifecycle.
- [x] Do not change compare scheduling semantics beyond fixing the lookup.
- [x] Do not change canonical apply behavior, suppression behavior, or manual authority.

### Step 4: Add regression tests

- [x] Add a regression proving a consent with one headshot link and many approved photo links still resolves the headshot correctly.
- [x] Add a worker-level regression proving `materialize_asset_faces` succeeds and schedules compare work instead of retrying with `face_match_headshot_lookup_failed`.
- [x] Keep existing Feature 019 semantics tests green.

### Step 5: Run quality gates

- [x] `supabase db reset`
- [x] `npm test`
- [x] `npm run lint`
- [x] `npm run build`

## 3. Exact files to modify

- `src/lib/matching/face-materialization.ts`
- `tests/feature-019-face-materialization-pipeline.test.ts`
- `docs/rpi/020-materialized-headshot-resolution-bug/plan.md`

Intentionally not planning changes to:

- `src/lib/matching/auto-match-worker.ts`
- `src/lib/matching/consent-photo-matching.ts`
- migrations
- route handlers

Unless implementation proves an additional small helper extraction is necessary.

## 4. Design details

### Headshot resolution

The fix should resolve “current eligible headshot per consent” using headshot-scoped rows only.

Required behavior:

- only linked headshot assets count
- photos linked in `asset_consent_links` must be ignored at query time, not after broad scanning
- if multiple eligible headshots exist, choose the newest `uploaded_at`
- if no eligible headshot exists, return no headshot for that consent without throwing

### Query behavior

Prefer a query shape that avoids building a large mixed `IN (...)` list from all canonical links.

The practical goal is:

- do not load large photo-link populations just to discard them later
- keep tenant/project filters explicit on every query

### Single-consent behavior

For one-consent resolution:

- do not call the broad “load many eligible consents” path with `limit = 750` and filter in memory
- resolve the one consent directly using the same narrowed headshot lookup rules

## 5. Security considerations

- keep tenant/project scoping explicit in every query
- do not accept tenant/project ids from clients
- do not expose any new biometric state
- keep internal worker access unchanged
- avoid leaking internal lookup details in errors beyond the existing safe error codes

## 6. Edge cases

- Consent has many approved photo links and one headshot link: still resolves the headshot.
- Consent has multiple historical headshot links: newest eligible uploaded headshot wins.
- Consent has no linked headshot: skip scheduling compares for that consent, no retry storm.
- Linked headshot is archived or expired: treat as no eligible headshot.
- Consent is revoked or opt-out: exclude before headshot resolution, same as today.
- Duplicate/replayed worker jobs: fix must remain idempotent and retry-safe.

## 7. Testing plan

### Regression coverage

- Extend [feature-019-face-materialization-pipeline.test.ts](/C:/Users/tim/projects/snapconsent-lite/tests/feature-019-face-materialization-pipeline.test.ts) with:
  - a consent that already has many auto-linked photos plus one headshot
  - a `photo_uploaded` materialized worker run that must still resolve the headshot and enqueue/perform compare

### Behavioral checks

- prove no `face_match_headshot_lookup_failed` retry occurs in the covered scenario
- prove compare outcome is written
- prove canonical link semantics remain unchanged

### Commands

- `supabase db reset`
- `npm test`
- `npm run lint`
- `npm run build`

No migration is expected, so `supabase db reset` is only for clean verification, not for new schema.

## 8. Rollout / risk

This is a low-risk bug fix.

Why:

- no schema change
- no public API change
- no canonical write-path policy change
- no provider change

Rollback is trivial:

- revert the helper/query change if needed

## 9. Verification checklist

- `materialize_asset_faces` jobs no longer retry on real projects due to headshot lookup.
- Existing matched photo links no longer interfere with headshot resolution.
- A consent with one eligible headshot and many approved photos still schedules compare work.
- Worker runs make forward progress in `materialized_apply`.
- Feature 019 cold/warm throughput behavior remains intact.
- Canonical/manual/suppression semantics remain unchanged.
