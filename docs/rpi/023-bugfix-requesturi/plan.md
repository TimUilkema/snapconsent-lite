# Feature 023 Plan: Request-URI Too Large / unsafe large `.in(...)` query bug class

## Scope boundary

This feature fixes the reproduced Request-URI failure and the most dangerous current variants of the same bug class without redesigning the matching system.

In scope:

- fix the reproduced project matching progress failure
- repair the highest-risk project-scale read paths that still fan ids back into `.in(...)`
- repair bounded batch/request paths with a shared chunking mechanism and explicit caps
- add project-wide prevention so new unsafe direct `.in(...)` usage is harder to introduce

Out of scope:

- redesigning canonical matching state (`asset_consent_links` remains canonical)
- changing consent domain rules
- replacing Supabase/PostgREST architecture
- generic query-builder abstraction work
- fixing every existing `.in(...)` call regardless of actual risk

## Ground-truth validation

The current code confirms three distinct variants of the same bug class:

1. Project-scale read fanout:
   - [`project-matching-progress.ts`](/C:/Users/tim/projects/snapconsent-lite/src/lib/matching/project-matching-progress.ts) loads all uploaded photo ids, then calls `.in("asset_id", photoAssetIds)` and `.in("scope_asset_id", photoAssetIds)`.
   - This is the reproduced HTTP `414 Request-URI Too Large` path.

2. Project-scale headshot resolution fanout:
   - [`face-materialization.ts`](/C:/Users/tim/projects/snapconsent-lite/src/lib/matching/face-materialization.ts) loads all eligible headshot ids, then filters `asset_consent_links` with `.in("asset_id", eligibleHeadshotIds)`.
   - [`page.tsx`](/C:/Users/tim/projects/snapconsent-lite/src/app/(protected)/projects/[projectId]/page.tsx) repeats the same pattern for project page headshot preview.
   - [`auto-match-worker.ts`](/C:/Users/tim/projects/snapconsent-lite/src/lib/matching/auto-match-worker.ts) has the same pattern in raw mode.

3. Bounded but still unsafe batch/request arrays:
   - [`auto-match-worker.ts`](/C:/Users/tim/projects/snapconsent-lite/src/lib/matching/auto-match-worker.ts) uses direct `.in(...)` on candidate batch ids with `MAX_MATCH_CANDIDATES = 750`, which is compute-bounded but not URL-safe for UUIDs.
   - [`create-asset.ts`](/C:/Users/tim/projects/snapconsent-lite/src/lib/assets/create-asset.ts), [`finalize-asset.ts`](/C:/Users/tim/projects/snapconsent-lite/src/lib/assets/finalize-asset.ts), and [`consent-photo-matching.ts`](/C:/Users/tim/projects/snapconsent-lite/src/lib/matching/consent-photo-matching.ts) accept request arrays with no explicit conservative cap and query them directly with `.in(...)`.

Code also confirms one existing mitigation pattern:

- [`assets/preflight/route.ts`](/C:/Users/tim/projects/snapconsent-lite/src/app/api/projects/[projectId]/assets/preflight/route.ts) already chunks `IN` filters with `IN_FILTER_CHUNK_SIZE = 40`.

## Bounded decisions for Feature 023

### 1. Use RPCs for the project-scale read fixes

Feature 023 will use Postgres RPC functions, not client-side fanout and not a generic SQL view, for the two project-scale read problems that need structural repair now:

- project matching progress
- current project headshot resolution

Why RPC:

- parameterized and set-based
- no URL-length dependence on large id lists
- easy to keep tenant/project predicates explicit
- fits the existing repo pattern (`claim_face_match_jobs`, `submit_public_consent`, `current_tenant_id`)
- smaller than introducing new generalized data-access infrastructure

### 2. Use shared chunked `.in(...)` only for bounded exceptions

Feature 023 will not “just chunk everything”.

Chunking is approved only for:

- request-driven id arrays after explicit validation
- worker batch reads already bounded for business reasons
- maintenance paths that are already batch-windowed and are not worth a new SQL object in this cycle

Project-scale reads must move to set-based SQL/RPC instead.

### 3. Keep the implementation bounded

Must-fix now in Feature 023:

- `project-matching-progress.ts`
- `face-materialization.ts`
- `auto-match-worker.ts` headshot resolution in raw mode
- project page headshot preview in `page.tsx`
- request/batch `.in(...)` safety in:
  - `auto-match-worker.ts`
  - `create-asset.ts`
  - `finalize-asset.ts`
  - `consent-photo-matching.ts`
  - `assets/preflight/route.ts` (refactor to shared helper)
- PostgREST error normalization
- regression tests
- lightweight automated detection for new direct `.in(...)` usage

Deferred from Feature 023:

- structural rewrite of [`assets/route.ts`](/C:/Users/tim/projects/snapconsent-lite/src/app/api/projects/[projectId]/assets/route.ts) consent-filter pagination
- structural rewrite of `listLinkedPhotosForConsent(...)` if chunking proves insufficient
- lower-risk bounded maintenance paths in [`auto-match-reconcile.ts`](/C:/Users/tim/projects/snapconsent-lite/src/lib/matching/auto-match-reconcile.ts) and [`cleanup/route.ts`](/C:/Users/tim/projects/snapconsent-lite/src/app/api/internal/headshots/cleanup/route.ts)

Those deferred paths will be explicitly documented in code comments and the detection allowlist so they are not silently ignored.

## Implementation plan

### Step 1: Add shared error normalization for PostgREST failures

Create a small helper, likely under `src/lib/http/` or `src/lib/supabase/`, that converts unknown Supabase/PostgREST errors into a stable shape:

- `code`
- `message`
- optional inferred `httpStatus`

Required behavior:

- if `error.code` is missing, never surface `undefined`
- infer `request_uri_too_large` when the message indicates `414`, `URI too long`, or `Request-URI Too Large`
- keep thrown application errors stable and non-sensitive

Planned file changes:

- create `src/lib/http/postgrest-error.ts` or equivalent
- update touched matching/asset helpers to use it

### Step 2: Add a set-based RPC for project matching progress

Add one migration with a `public.get_project_matching_progress(...)` RPC.

Recommended signature:

- `p_tenant_id uuid`
- `p_project_id uuid`
- `p_pipeline_mode text`
- `p_materializer_version text`

Recommended return columns:

- `total_images bigint`
- `processed_images bigint`
- `is_matching_in_progress boolean`

Implementation shape:

- one SQL statement using CTEs
- count uploaded, unarchived project photo assets directly from `assets`
- materialized mode:
  - count distinct uploaded photos with current `asset_face_materializations` rows for the requested materializer version
- raw mode:
  - count distinct uploaded photos with terminal `photo_uploaded` status and no queued/processing `photo_uploaded` job
- compute active matching jobs directly from `face_match_jobs`

Reason for RPC over direct server queries:

- removes the current two-query fanout pattern
- reduces race windows because counts come from one DB-side snapshot
- avoids pushing hundreds of ids back into PostgREST filters

Planned file changes:

- add migration under `supabase/migrations/`
- update `src/lib/matching/project-matching-progress.ts` to call the RPC
- keep the TypeScript return shape unchanged for UI/API callers

### Step 3: Add a set-based RPC for current project consent headshots

Add one RPC in the same migration for current headshot resolution.

Recommended signature:

- `p_tenant_id uuid`
- `p_project_id uuid`
- `p_opt_in_only boolean default true`
- `p_not_revoked_only boolean default false`
- `p_limit integer default null`

Recommended return columns:

- `consent_id uuid`
- `headshot_asset_id uuid`
- `headshot_uploaded_at timestamptz`

Implementation shape:

- select consents within tenant/project first
- apply optional `face_match_opt_in` and `revoked_at is null` filters
- order candidate consents by `signed_at desc nulls last, created_at desc`
- apply `p_limit` before headshot expansion
- join `asset_consent_links` to `assets`
- restrict joined assets to:
  - `asset_type = 'headshot'`
  - `status = 'uploaded'`
  - `archived_at is null`
  - `retention_expires_at is null or > now()`
- use `row_number()` partitioned by `consent_id` ordered by newest headshot upload to pick the current headshot

This RPC will replace the current “load headshot ids first, then feed them into `.in(...)`” pattern in:

- `src/lib/matching/face-materialization.ts`
- `src/lib/matching/auto-match-worker.ts` raw headshot resolution
- `src/app/(protected)/projects/[projectId]/page.tsx`

Behavior mapping:

- materialized/raw worker eligibility:
  - `p_opt_in_only = true`
  - `p_not_revoked_only = true`
  - `p_limit = MAX_MATCH_CANDIDATES`
- project page preview:
  - `p_opt_in_only = true`
  - `p_not_revoked_only = false`
  - `p_limit = null`

### Step 4: Introduce a shared safe `IN` helper for bounded exceptions

Extract the local preflight chunking pattern into one shared helper module.

Recommended helper shape:

- `SAFE_IN_FILTER_CHUNK_SIZE = 40`
- `chunkValues<T>(values: T[], chunkSize = SAFE_IN_FILTER_CHUNK_SIZE)`
- `runChunkedRead(...)`
- `runChunkedMutation(...)`

Required behavior:

- de-duplicate values before chunking
- abort the whole operation on the first failed chunk
- never return partial merged success
- preserve retry-safety for deletes/upserts by keeping each chunk idempotent

Initial callers in Feature 023:

- `src/app/api/projects/[projectId]/assets/preflight/route.ts`
- `src/lib/matching/auto-match-worker.ts`
- `src/lib/assets/create-asset.ts`
- `src/lib/assets/finalize-asset.ts`
- `src/lib/matching/consent-photo-matching.ts`
- `src/lib/matching/face-materialization.ts` for any remaining bounded `.in(...)` paths that are not worth a new RPC in this cycle

### Step 5: Repair the must-fix bounded batch/request paths

Apply the shared helper and explicit caps to the current bounded exception paths.

#### `src/lib/matching/auto-match-worker.ts`

Fix now:

- chunk pair-state lookups in `applyAutoMatches(...)` for:
  - `asset_consent_links`
  - `asset_consent_link_suppressions`
- replace raw headshot resolution with the new current-headshot RPC
- chunk `loadEligibleConsentsForHeadshotAsset(...)` if it still validates a large linked-consent set through `.in("id", linkedConsentIds)`

Why this is in scope:

- raw mode is explicitly part of the feature edge cases
- `MAX_MATCH_CANDIDATES = 750` is not URL-safe

#### `src/lib/assets/create-asset.ts` and `src/lib/assets/finalize-asset.ts`

Add explicit request caps and chunked validation:

- `MAX_REQUEST_CONSENT_IDS = 50`
- reject larger arrays with `400 invalid_consent_ids_too_large`
- use the shared chunk helper for consent validation
- use chunked delete for suppression cleanup in `finalize-asset.ts`

#### `src/lib/matching/consent-photo-matching.ts`

Add explicit request caps and chunked validation:

- `MAX_REQUEST_ASSET_IDS = 100` for manual link/unlink requests
- reject larger arrays with `400 invalid_asset_ids_too_large`
- use chunked validation in `validatePhotoAssetIdsInProject(...)`
- use chunked delete/read for manual unlink, suppression delete, and likely-candidate follow-up reads where the id set can exceed safe URL size

This path remains server-side and idempotent.

### Step 6: Update project page callers without changing UI contract

Use the new helpers/RPCs in the existing page and API surfaces without changing payloads.

Planned file changes:

- `src/app/(protected)/projects/[projectId]/page.tsx`
  - replace local headshot preview fanout query with the current-headshot RPC
- `src/app/api/projects/[projectId]/matching-progress/route.ts`
  - keep route contract unchanged
- `src/lib/matching/project-matching-progress.ts`
  - keep `ProjectMatchingProgress` return type unchanged

UI impact:

- no visible redesign
- project progress continues to show:
  - processed uploaded photos / total uploaded photos
  - whether matching is still ongoing
- large projects no longer fail because of URL length

### Step 7: Add lightweight repository-level prevention

Add a small automated check for direct `.in(...)` usage.

Recommended implementation:

- add `scripts/check-unsafe-in-filters.mjs`
- scan `src/**/*.ts` and `src/**/*.tsx` for `\.in\(`
- fail unless one of these is true:
  - the call is inside the shared helper module
  - the nearby code contains a required `safe-in-filter:` comment documenting the bound
  - the file/path is in a small explicit allowlist for deferred reviewed cases

Also add:

- `package.json` script such as `check:in-filters`

Purpose:

- future engineers must either use the helper / set-based RPC path or explicitly justify bounded direct `.in(...)` usage

### Step 8: Document deferred risk explicitly

Do not silently ignore the remaining structural high-risk path:

- [`assets/route.ts`](/C:/Users/tim/projects/snapconsent-lite/src/app/api/projects/[projectId]/assets/route.ts)

Why deferred:

- the correct fix is a paginated set-based RPC for consent-filtered asset ids plus total count
- that change is larger than the other 023 repairs because it must preserve search, sort, pagination, and count semantics together

Plan outcome for 023:

- document it as deferred in code comments and this plan
- add it to the detection allowlist with a TODO pointing at a follow-up feature

## Files to create or modify

Create:

- `docs/rpi/023-bugfix-requesturi/plan.md`
- `supabase/migrations/<timestamp>_023_request_uri_safety.sql`
- `src/lib/http/postgrest-error.ts` or equivalent
- `src/lib/supabase/safe-in-filter.ts` or equivalent
- `scripts/check-unsafe-in-filters.mjs`
- `tests/feature-023-request-uri-safety.test.ts`

Modify:

- `src/lib/matching/project-matching-progress.ts`
- `src/lib/matching/face-materialization.ts`
- `src/lib/matching/auto-match-worker.ts`
- `src/lib/matching/consent-photo-matching.ts`
- `src/lib/assets/create-asset.ts`
- `src/lib/assets/finalize-asset.ts`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/app/api/projects/[projectId]/matching-progress/route.ts`
- `src/app/api/projects/[projectId]/assets/preflight/route.ts`
- `tests/feature-019-face-materialization-pipeline.test.ts`
- `tests/feature-021-project-matching-progress.test.ts`
- `package.json`

Deferred, not modified in Feature 023:

- `src/app/api/projects/[projectId]/assets/route.ts`
- `src/lib/matching/auto-match-reconcile.ts`
- `src/app/api/internal/headshots/cleanup/route.ts`

## Migration decision

Yes, a migration is required.

Add one migration that creates:

- `public.get_project_matching_progress(...)`
- `public.list_current_project_consent_headshots(...)`

Security for the new functions:

- grant execute to `service_role`
- do not expose execute to `anon`
- do not rely on client-provided tenant ids
- call the functions only from server-side code after tenant/project access has already been resolved

No new tables or canonical schema redesign are needed.

No new indexes are planned initially because current schema already has relevant supporting indexes for the targeted queries:

- `assets_tenant_project_type_status_idx`
- `asset_consent_links_tenant_project_idx`
- `face_match_jobs_tenant_project_status_idx`
- existing `asset_face_materializations` tenant/project indexes

If implementation shows a clear query-plan problem after `supabase db reset`, index follow-up can be a separate small migration.

## API and UI impact

API impact:

- no new public HTTP endpoints
- no route contract changes for the existing matching progress API
- request-driven array endpoints gain explicit `400` validation for oversized arrays

UI impact:

- no visual redesign
- project page progress and headshot preview continue to work
- failure mode changes from opaque `code: undefined` errors to stable internal errors

## Security considerations

- tenant scoping remains explicit in every SQL function and every non-RPC query
- project existence/membership continues to be verified server-side before admin queries or RPC calls
- no client-provided tenant ids are trusted
- service role remains server-only
- new request caps reduce abuse and accidental expensive queries
- no biometric or matching internals are newly exposed to the client

## Operational and error-handling considerations

- progress RPC returns a snapshot, so concurrent matching activity may change results between polls, but the response is internally consistent within one query
- chunked reads and deletes must fail closed: if any chunk fails, throw and do not return partial success
- chunked deletes/upserts remain retry-safe because the underlying operations are already idempotent
- partial failures should surface normalized internal codes, not `undefined`
- raw pipeline and materialized pipeline both remain supported
- consent revocation and archived/non-eligible assets stay enforced at query time, not after broad id fanout

## Edge cases to verify during implementation

- large project with hundreds of uploaded photos
- large project with many opted-in consents
- project with no uploaded photos
- project with no eligible consents/headshots
- project with no materializations yet
- raw pipeline mode and materialized pipeline mode
- duplicate requests / retries
- concurrent matching activity while progress is queried
- revoked consent
- archived or expired headshots
- tenant mismatch / missing permissions
- oversized request arrays
- PostgREST errors with missing `code`
- chunked read failure partway through processing
- future direct `.in(...)` usage added without a documented bound

## Test plan

### Progress regression coverage

Extend [`tests/feature-021-project-matching-progress.test.ts`](/C:/Users/tim/projects/snapconsent-lite/tests/feature-021-project-matching-progress.test.ts) to add large-id-set scenarios:

- materialized mode with hundreds of uploaded photos
- raw mode with hundreds of uploaded photos
- zero-photo project
- active-jobs-only project

Expected result:

- correct counts
- no thrown URI-length failure

### Headshot resolution regression coverage

Extend [`tests/feature-019-face-materialization-pipeline.test.ts`](/C:/Users/tim/projects/snapconsent-lite/tests/feature-019-face-materialization-pipeline.test.ts):

- one eligible headshot plus many project photos / approved links
- raw and materialized headshot-resolution paths both continue to resolve the current headshot
- revoked / non-eligible consents are excluded where expected

### New Feature 023 safety tests

Add `tests/feature-023-request-uri-safety.test.ts` for:

- chunk helper merges results across multiple chunks
- helper aborts on partial chunk failure
- oversized `consentIds` request rejected in asset create/finalize paths
- oversized `assetIds` request rejected in manual link/unlink paths
- error normalization maps code-less 414-like errors to a stable internal code

### Verification commands

- `supabase db reset`
- `npm test`
- `npm run lint`
- `npm run build`
- `npm run check:in-filters`

## Verification checklist

- The reproduced project progress 414 no longer occurs on the large real project.
- Large projects still return correct `processed / total` progress values.
- Raw pipeline and materialized pipeline both return progress without URL-length failure.
- Project page headshot preview no longer depends on project-scale `.in(...)` headshot filters.
- Worker candidate batch lookups no longer send unchunked large UUID lists.
- Oversized request arrays are rejected with stable `400` errors.
- Tenant scoping remains intact for all new SQL functions and all touched queries.
- PostgREST failures no longer surface as `code: undefined`.
- Deferred-risk paths are explicitly documented and detection-reviewed.
- Tests cover large-id-set regressions.
- The new migration works from a clean `supabase db reset`.
- Canonical matching behavior, suppression behavior, and retry-safety remain unchanged.
