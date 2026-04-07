# Feature 036 Research: Matchable Photo Pagination

## Goal

Paginate the consent photo review list so manual linking and likely-match review do not load every uploaded project photo into one response.

## Inputs reviewed

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `UNCODEXIFY.MD`
- `docs/rpi/README.md`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/matchable/route.ts`
- `src/components/projects/consent-asset-matching-panel.tsx`
- `src/lib/matching/photo-face-linking.ts`
- `tests/feature-012-manual-review-likely-matches.test.ts`

## Current behavior

### API route

`GET /api/projects/:projectId/consents/:consentId/assets/matchable` accepts:

- `q`
- `mode`
- `limit`

It returns only:

- `assets`

There is no page or cursor metadata.

### Client panel

`ConsentAssetMatchingPanel` loads the entire current result set into one client array:

- opening the panel loads all default-mode matchable assets
- searching reloads the whole set
- toggling likely mode reloads the whole set

Likely mode currently hardcodes `limit=50` from the client. Default mode sends no limit, which means the server reads the full filtered list.

### Matching service

`listMatchableProjectPhotosForConsent(...)` in `photo-face-linking.ts` has two code paths:

- `default`
- `likely`

Both currently return `MatchablePhotoRow[]`.

#### Default mode

Default mode:

1. loads uploaded project photo assets ordered by `created_at desc`
2. loads current materializations/links/fallbacks for all of those assets
3. filters out assets already linked to the current consent
4. applies `limit` only at the end

That means a large project can pull every uploaded photo even if the UI only needs the first page.

#### Likely mode

Likely mode:

1. loads a confidence-sorted candidate slice
2. resolves assets/materializations/current links/suppressions for that slice
3. filters out linked/suppressed/invalid rows
4. slices at the end

This is already more bounded than default mode, but it still has no paging metadata and cannot request later result windows.

## Constraints

- tenant scoping must remain server-derived and enforced in every query
- the UI should not infer linkability from stale client state
- likely mode ordering must remain by confidence desc, then newest score/create time behavior
- default mode ordering should remain newest uploaded photos first
- the change should not alter review session semantics or face-link writes

## Risks

### Offset must apply to filtered rows, not raw rows

If page offset is applied before filtering linked/suppressed rows, pages can be sparse or skip eligible assets.

So paging has to happen over the final matchable list, not simply over raw `assets` rows.

### Exact total counts are not necessary for the first patch

Calculating exact totals would require scanning all filtered rows again, which defeats the performance goal.

The practical UI only needs:

- current page
- page size
- previous/next availability

### Default mode needs bounded over-fetch

Because linked assets are filtered after reading current link/materialization state, the server needs to fetch raw asset batches until it has enough unlinked rows to satisfy:

- skipped rows for prior pages
- current page rows
- one extra row for `hasNextPage`

### Likely mode needs the same filtered paging behavior

Candidate rows are already ordered, but linked/suppressed/invalid rows are removed after fetch. So likely mode also needs bounded batched reads rather than a single final slice.

## Recommended approach

Use page-based server pagination with bounded over-fetch:

- default page size: `20`
- supported sizes: `20`, `50`, `100`
- API returns:
  - `assets`
  - `page`
  - `pageSize`
  - `hasNextPage`
  - `hasPreviousPage`

Implementation should:

- keep filtering and ordering on the server
- fetch raw assets/candidates in batches
- skip filtered rows until the requested page offset is satisfied
- collect `limit + 1` rows to determine `hasNextPage`

This avoids loading the entire asset list while preserving current matchability rules.
