# Feature 036 Plan: Matchable Photo Pagination

## Goal

Paginate the consent photo review list so manual review and likely-match review only load one page at a time.

## Implementation steps

### 1. Extend the matchable-photo service contract

In `src/lib/matching/photo-face-linking.ts`:

- add `page?: number | null` to the input
- change the return type from `MatchablePhotoRow[]` to a paged result object
- normalize:
  - page
  - page size

Use:

- default size `20`
- max size `100`

Return:

- `assets`
- `page`
- `pageSize`
- `hasNextPage`
- `hasPreviousPage`

### 2. Implement bounded filtered pagination for default mode

Keep current ordering:

- newest photos first

But stop loading the entire asset set.

Implementation:

- fetch uploaded photos in raw batches with `range(...)`
- load materializations/links/fallbacks only for each batch
- filter out assets already linked to the current consent
- skip filtered rows until the requested page offset
- collect `pageSize + 1` rows to compute `hasNextPage`

### 3. Implement bounded filtered pagination for likely mode

Keep current likely-mode ordering and eligibility rules:

- confidence band filtering
- current winner face required
- no current link for this consent
- no suppression for the candidate face

Implementation:

- fetch candidate rows in ranked batches with `range(...)`
- resolve asset/materialization/link/suppression state per batch
- skip filtered rows until page offset
- collect `pageSize + 1` rows to compute `hasNextPage`

### 4. Update the API route

In `src/app/api/projects/[projectId]/consents/[consentId]/assets/matchable/route.ts`:

- parse `page`
- keep parsing `mode`, `q`, and `limit`
- return the paged response metadata along with `assets`

### 5. Update the consent asset matching panel

In `src/components/projects/consent-asset-matching-panel.tsx`:

- track:
  - current page
  - page size
- reset to page `0` when:
  - opening the panel
  - changing mode
  - changing page size
  - running a new search
- render normal pagination controls:
  - previous
  - next
  - page-size select (`20`, `50`, `100`)

The client should request one page from the server instead of trying to hold the entire matchable list.

### 6. Add regression coverage

Update `tests/feature-012-manual-review-likely-matches.test.ts` to cover:

- default mode pagination across filtered linked assets
- likely mode pagination across ranked candidate rows

### 7. Verification

Run:

- `npx tsx --test --test-concurrency=1 tests/feature-012-manual-review-likely-matches.test.ts`
- `npx tsx --test --test-concurrency=1 tests/feature-032-face-consent-linking-ui-improvements.test.ts`
- `npm run lint`

## Security and reliability

- all tenant scoping remains server-derived
- no new client authority is introduced
- paging metadata is read-only and does not affect write paths
- batch iteration is bounded and retry-safe

## Edge cases

- pages beyond the available filtered result set should return an empty `assets` array with `hasNextPage = false`
- changing from likely mode to default mode should reset back to the first page
- searching should also reset to the first page
- selected asset ids may legitimately persist across page changes in the same panel session
