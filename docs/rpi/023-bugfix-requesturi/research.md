# Feature 023 Research: Request-URI Too Large bug class

## Scope and method

This research is code-first. Documentation was read for context, but repository code and direct local reproduction were treated as ground truth.

Files reviewed:

- `AGENTS.md`
- `ARCHITECTURE.md`
- `CONTEXT.md`
- `README.md`
- `docs/rpi/README.md`
- `docs/rpi/018-compreface-performance-efficiency/*`
- `docs/rpi/019-face-materialization-deduped-embedding-pipeline/*`
- `docs/rpi/020-materialized-headshot-resolution-bug/*`
- `docs/rpi/021-project-matching-progress-ui/*`
- `src/lib/matching/project-matching-progress.ts`
- `src/lib/matching/face-materialization.ts`
- `src/lib/matching/auto-match-worker.ts`
- `src/lib/matching/consent-photo-matching.ts`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/app/api/projects/[projectId]/assets/route.ts`
- `src/app/api/projects/[projectId]/assets/preflight/route.ts`
- `src/lib/assets/create-asset.ts`
- `src/lib/assets/finalize-asset.ts`
- `src/lib/matching/auto-match-reconcile.ts`
- `src/app/api/internal/headshots/cleanup/route.ts`
- `tests/feature-019-face-materialization-pipeline.test.ts`
- `tests/feature-021-project-matching-progress.test.ts`

## Verified current bug

### Failing path

The current project page calls [`getProjectMatchingProgress(...)`](/C:/Users/tim/projects/snapconsent-lite/src/lib/matching/project-matching-progress.ts) from [`src/app/(protected)/projects/[projectId]/page.tsx`](/C:/Users/tim/projects/snapconsent-lite/src/app/(protected)/projects/[projectId]/page.tsx#L196).

In materialized modes, the helper does this:

1. load every uploaded project photo id from `assets`
2. build `photoAssetIds`
3. query `asset_face_materializations` with `.in("asset_id", photoAssetIds)`

Relevant lines:

- [`src/lib/matching/project-matching-progress.ts:36`](/C:/Users/tim/projects/snapconsent-lite/src/lib/matching/project-matching-progress.ts#L36)
- [`src/lib/matching/project-matching-progress.ts:77`](/C:/Users/tim/projects/snapconsent-lite/src/lib/matching/project-matching-progress.ts#L77)
- [`src/lib/matching/project-matching-progress.ts:94`](/C:/Users/tim/projects/snapconsent-lite/src/lib/matching/project-matching-progress.ts#L94)

### Direct reproduction

Current local `.env.local` sets:

- `AUTO_MATCH_PIPELINE_MODE=materialized_apply`

So the materialized branch is active.

Running the same query path against the logged project `3dafb62e-9c7f-40dc-8703-d566257dfc10` showed:

- uploaded project photo count: `360`
- generated request URL length for the materialization query: `14296`
- PostgREST response: HTTP `414 Request-URI Too Large`

This is the current concrete cause of the error:

- `project_matching_progress_materializations_failed:undefined`

`undefined` is secondary damage from the wrapper in [`src/lib/matching/project-matching-progress.ts:87`](/C:/Users/tim/projects/snapconsent-lite/src/lib/matching/project-matching-progress.ts#L87): the 414 error object has a `message`, but no `code`, so the thrown string drops the useful detail.

## Root cause

The root cause is not specific to one table. The bug class is:

- server code loads a large set of ids from one query
- server code feeds those ids back into a second PostgREST query through `.in(...)`
- the second query is encoded into the request URL
- once the id list becomes project-scale, the URL exceeds what the local PostgREST stack accepts

This is a query-shaping problem, not a matching-only problem.

The project progress helper is one concrete instance, but the same pattern exists elsewhere.

## Documentation vs code

Feature 021 research and plan describe the intended metric correctly at a product level:

- processed uploaded photos / total uploaded photos

But the implementation chose a two-step id fanout query instead of a set-based database query. The docs did not call out URL-size risk, and the code is where the bug was introduced.

Feature 020 is similar:

- the documented bug was a too-broad headshot lookup through `asset_consent_links`
- current code does contain the Feature 020 semantic fix
- but the replacement helper still uses large `.in(...)` filters and therefore still carries the Request-URI risk class

So Feature 020 fixed one semantic bug, but it did not fully eliminate this broader failure mode.

## Where the same bug might occur

The following classification is based on current code shape, actual limits in code, and whether the id arrays are project-scale, user-scale, or explicitly chunked.

### Confirmed current failure

1. [`src/lib/matching/project-matching-progress.ts`](/C:/Users/tim/projects/snapconsent-lite/src/lib/matching/project-matching-progress.ts)

- `.in("asset_id", photoAssetIds)` at line 84
- `.in("scope_asset_id", photoAssetIds)` at line 100
- `photoAssetIds` comes from all uploaded photos in the project
- this is already reproduced with HTTP 414

### High-risk matching code paths

2. [`src/lib/matching/face-materialization.ts`](/C:/Users/tim/projects/snapconsent-lite/src/lib/matching/face-materialization.ts)

- `loadCurrentHeadshotAssetsForConsentIds(...)` loads all eligible headshots in the project, then queries `asset_consent_links` with both:
  - `.in("consent_id", consentIds)`
  - `.in("asset_id", eligibleHeadshotIds)`
- relevant lines:
  - [`381-393`](/C:/Users/tim/projects/snapconsent-lite/src/lib/matching/face-materialization.ts#L381)
- this is exactly the same URI-risk pattern, even though it is narrower than the pre-Feature-020 implementation

3. [`src/lib/matching/auto-match-worker.ts`](/C:/Users/tim/projects/snapconsent-lite/src/lib/matching/auto-match-worker.ts)

- raw-pipeline headshot resolution still does:
  - `.in("consent_id", consentIds)` at line 508
  - `.in("id", headshotIds)` at line 528
- pair-state lookups in `applyAutoMatches(...)` do:
  - `.in("asset_id", assetIds)` / `.in("consent_id", consentIds)` at lines 899-916
- these arrays are at least capped by `MAX_MATCH_CANDIDATES = 750`, but that cap is not URL-safe for UUID lists
- this means the raw pipeline still appears vulnerable even though worker candidate counts are bounded for compute reasons

4. [`src/app/(protected)/projects/[projectId]/page.tsx`](/C:/Users/tim/projects/snapconsent-lite/src/app/(protected)/projects/[projectId]/page.tsx)

- the project page headshot preview query does:
  - `.in("consent_id", optedInConsentIds)`
  - `.in("asset_id", headshotAssetIds)`
- relevant lines:
  - [`229-236`](/C:/Users/tim/projects/snapconsent-lite/src/app/(protected)/projects/[projectId]/page.tsx#L229)
- both arrays are derived from project-wide data, so large projects can hit the same failure mode here too

5. [`src/app/api/projects/[projectId]/assets/route.ts`](/C:/Users/tim/projects/snapconsent-lite/src/app/api/projects/[projectId]/assets/route.ts)

- consent-filter flow does:
  - load all `asset_consent_links` for selected consent ids
  - derive `filteredAssetIds`
  - then query `assets` with `.in("id", filteredAssetIds)` before pagination
- relevant lines:
  - [`221-272`](/C:/Users/tim/projects/snapconsent-lite/src/app/api/projects/[projectId]/assets/route.ts#L221)
- this can blow up when a filter matches many project photos

6. [`src/lib/matching/consent-photo-matching.ts`](/C:/Users/tim/projects/snapconsent-lite/src/lib/matching/consent-photo-matching.ts)

- several reads and deletes use `.in(...)` on asset ids derived from current matching state:
  - validation of manual link/unlink ids
  - linked photo listing
  - likely-match candidate filtering
  - suppression deletes
- especially relevant:
  - `.in("id", linkedAssetIds)` at line 393
  - `.in("asset_id", uniqueAssetIds)` at lines 459 and 499
- for heavily matched consents this can become large

### Medium-risk code paths

7. [`src/lib/assets/create-asset.ts`](/C:/Users/tim/projects/snapconsent-lite/src/lib/assets/create-asset.ts)

- validates `.in("id", consentIds)` from request input
- there is no explicit server-side cap on `consentIds`

8. [`src/lib/assets/finalize-asset.ts`](/C:/Users/tim/projects/snapconsent-lite/src/lib/assets/finalize-asset.ts)

- same pattern for `consentIds`
- also deletes suppressions with `.in("consent_id", input.consentIds)`

9. [`src/lib/matching/auto-match-reconcile.ts`](/C:/Users/tim/projects/snapconsent-lite/src/lib/matching/auto-match-reconcile.ts)

- uses `.in("id", assetIds)` and `.in("id", linkedConsentIds)`
- these are less risky because reconcile already works in bounded windows and per-headshot/per-consent subsets
- still the same query shape exists

### Lower-risk or already mitigated code paths

10. [`src/app/api/internal/headshots/cleanup/route.ts`](/C:/Users/tim/projects/snapconsent-lite/src/app/api/internal/headshots/cleanup/route.ts)

- `.in("id", archivedIds)` exists
- current route has `DEFAULT_BATCH_SIZE = 100`, so the blast radius is smaller

11. [`src/app/api/projects/[projectId]/assets/preflight/route.ts`](/C:/Users/tim/projects/snapconsent-lite/src/app/api/projects/[projectId]/assets/preflight/route.ts)

- this route already chunks `IN` filters using:
  - `IN_FILTER_CHUNK_SIZE = 40`
  - `chunkValues(...)`
- this is the only clear existing mitigation pattern in the codebase

## What current tests do and do not cover

### Current coverage

- Feature 020 regression test exists and is real:
  - [`tests/feature-019-face-materialization-pipeline.test.ts:716`](/C:/Users/tim/projects/snapconsent-lite/tests/feature-019-face-materialization-pipeline.test.ts#L716)
- It proves the semantic bug from Feature 020 was fixed for a consent with one headshot and 24 approved photos.

### Gaps

1. Feature 021 tests use only three photos.

- [`tests/feature-021-project-matching-progress.test.ts`](/C:/Users/tim/projects/snapconsent-lite/tests/feature-021-project-matching-progress.test.ts)
- no large-project coverage
- no regression for URI length

2. Feature 020 test scale is too small for URI-length failures.

- 24 already-linked photos is enough to verify the mixed-headshot/photo bug
- it is not enough to verify the replacement query stays safe at project scale

3. No shared test policy exists for large `.in(...)` filters.

- there is no test harness that creates hundreds of ids and asserts helpers/routes still succeed
- there is no guard ensuring new `.in(...)` usage is chunked, capped, or replaced with set-based SQL

## Why this keeps recurring

The repeated pattern in current code is:

- query A gets ids
- application code transforms ids in memory
- query B uses `.in(...)` with the entire derived array

This shape is attractive because it is simple to write with Supabase query builder, but it scales badly for project-wide sets.

Feature 020 shows that fixing one occurrence by narrowing the semantics is not enough. Without a project-wide rule, the same query shape reappears in new code.

## Prevention options

### Best prevention: prefer set-based database queries over id fanout

For project-scale reads, the safest approach is:

- do not load ids into application memory just to feed them back into a second PostgREST filter
- instead express the result directly in SQL/RPC/view form with tenant/project predicates and joins

Examples for this bug class:

- project progress should count directly from `asset_face_materializations` and `face_match_jobs`
- headshot resolution should join link state to eligible headshot assets inside the database
- asset filtering by selected consents should stay in SQL instead of materializing `filteredAssetIds` first

This is the only approach that removes URL-size sensitivity rather than just moving the threshold.

### Second-line prevention: shared chunking helper for allowed `IN` filters

When `.in(...)` is still the right tool, the codebase needs one shared helper that:

- chunks arrays by a conservative size
- merges read results
- batches updates/deletes safely
- makes the safe path the default path

Current evidence:

- the upload preflight route already does this locally with chunk size `40`
- that pattern is not reused elsewhere

### Required policy: no project-scale `.in(...)` without an explicit bound

The repository needs a code-level rule such as:

- if an `.in(...)` list is derived from database rows, project state, or unconstrained request input, do not call it directly
- either:
  - replace it with a set-based DB query, or
  - run it through a shared chunking helper, or
  - enforce a small validated cap first

### Explicit input caps for request-driven arrays

Several APIs accept id arrays with no tight limit. Those should be validated with explicit maximum sizes even if chunking is added.

This prevents:

- oversized URLs
- oversized payloads
- accidental high-cost operations

### Add repository-level detection

A process-only rule will not be enough.

A stronger prevention step would be to add a simple repository check that flags direct `.in(` usage outside approved helpers or approved bounded cases.

This could be:

- a lightweight script in CI
- a lint rule
- or a review checklist backed by a script

The point is to force engineers to justify every new `IN` filter shape.

## Recommended research conclusion

This is not one isolated Feature 021 bug.

It is a repeated project-scale PostgREST query-shaping bug class:

- direct `.in(...)` filters on large dynamic id arrays
- especially when the id arrays come from earlier project-scoped reads

Feature 021 is the currently reproduced failure.
Feature 020 fixed one semantic version of the same shape, but not the general class.
Other matching, project-page, and asset-listing paths still contain the same risk pattern today.

## Recommended next-phase focus for planning

The plan for Feature 023 should focus on three deliverables:

1. Fix the currently failing project progress helper with a set-based query.
2. Audit and repair the highest-risk existing paths that still use project-scale `.in(...)` lists.
3. Introduce a project-wide prevention mechanism:
   - preferred set-based query rule
   - shared chunking helper for approved exceptions
   - test coverage for large id sets
   - automated detection of unsafe direct `.in(...)` usage

## Open questions for planning

These should be resolved in the plan phase against current code:

1. Which high-risk paths should be fixed immediately in the same PR as the progress helper, and which should be staged?
2. Should the repository standardize on:
   - RPCs for set-based queries, or
   - reusable chunked Supabase helpers where SQL joins are awkward?
3. What conservative chunk size should be adopted for UUID-heavy `IN` filters when chunking is unavoidable?
4. How should PostgREST errors be normalized so 414-like failures never surface as `code: undefined` again?
