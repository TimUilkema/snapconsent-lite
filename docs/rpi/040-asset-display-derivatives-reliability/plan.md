# Feature 040 Plan: Asset Display Derivatives Reliability

## Goal

Repair the broken derivative pipeline from Feature 038, make the web app actually use bounded display images instead of full originals, and consolidate product behavior to one project photo upload flow.

This plan follows `docs/rpi/040-asset-display-derivatives-reliability/research.md` as the research boundary and source of truth.

## Recommendation

Repair Feature 038 in place.

- Keep the current derivative-specific table, leased queue model, and worker.
- Fix derivative enqueue so real finalize flows can write rows reliably.
- Add a bounded repair/backfill path for existing assets.
- Change photo rendering so web app image surfaces use:
  1. ready derivative
  2. bounded transform-on-read fallback
  3. placeholder/unavailable state
- Remove the duplicate consent matching panel photo-upload behavior from product behavior.

Do not redesign asset processing broadly.

## 1. Inputs and ground truth

### Feature 038 intended design

Feature 038 intended to:

- preserve originals untouched and private
- accept a broader shared upload policy
- asynchronously generate `thumbnail` and `preview` derivatives
- prefer derivative-backed URLs in the UI
- use a bounded fallback when derivatives are missing

### Verified Feature 040 findings

Verified in research:

- `asset_image_derivatives` exists
- the derivative worker and lease/retry queue model exist
- the derivative bucket exists
- current DB has `0` rows in `asset_image_derivatives`
- current DB has `270` uploaded photos and all `270` are missing derivatives
- photo UI/API read paths already prefer derivatives, but currently fall back to signed originals

### Broken enqueue privilege path

Verified root cause:

- `asset_image_derivatives` table writes are granted only to `service_role`
- real photo finalize flows call derivative queueing through `createClient()` using the anon key + authenticated session
- derivative upsert fails
- `queueProjectAssetPostFinalizeProcessing(...)` swallows that failure

### Current derivative table/bucket/worker reality

Already live and worth keeping:

- `asset_image_derivatives` table with leased queue columns
- `asset-image-derivatives` private bucket
- claim/fail SQL functions
- service-role derivative worker using `sharp`
- internal asset worker route

### Current UI fallback behavior

Current photo surfaces call `signThumbnailUrlsForAssets(...)` with `fallback: "original"`, so missing derivatives cause signed original asset URLs to be used for:

- project asset grid
- consent matching panel
- linked photos
- face review asset images
- preview modals

That is the current performance bug and must change.

### Product decision to remove the consent matching upload path

Feature 040 explicitly changes product behavior:

- keep only the normal project asset upload flow
- remove consent matching panel “Upload new photos”
- consent matching becomes selection/linking from already uploaded project photos only

## 2. Verified current boundary

### Keep as-is or with minimal targeted extension

These parts are already good enough to keep:

- `asset_image_derivatives` table and leased queue model
- `thumbnail` and `preview` derivative model
- derivative worker implementation
- deterministic derivative path/version structure
- derivative URL read-helper structure
- async post-finalize intent
- originals preserved privately in `project-assets`
- separate face-crop derivative architecture

### Broken or incomplete

These parts must be repaired or completed:

- derivative enqueue from real finalize flows
- silent enqueue failure observability
- repair/backfill for existing assets with missing derivatives
- worker operationalization/docs comparable to matching
- aggressive original fallback on photo display surfaces
- duplicate consent matching upload entrypoint

## 3. Options considered

### Option A: Repair Feature 038 in place

Description:

- keep the current derivative table/worker/read-helper design
- fix enqueue privilege usage
- add bounded repair/backfill and fallback changes
- remove duplicate consent-panel upload behavior

Pros:

- smallest change that fixes the real bug
- aligns with current code and tests
- preserves async/retry-safe derivative generation

Cons:

- still requires worker/docs/repair completeness

Assessment:

- recommended

### Option B: Redesign around a broader asset-processing abstraction

Description:

- replace the current derivative-specific pipeline with a more general asset-processing queue or orchestration layer

Pros:

- more general long-term architecture

Cons:

- too broad for the verified bug
- would discard already-working pieces
- risks turning a bounded repair into a larger refactor

Assessment:

- reject for this feature

### Option C: Fallback-only tweak without fixing enqueue

Description:

- keep derivative enqueue as-is
- only stop using originals on UI read paths

Pros:

- helps UX immediately

Cons:

- derivatives would still never be created in normal flows
- existing and future assets would stay dependent on fallback behavior

Assessment:

- insufficient

### Option D: Keep the consent matching upload flow

Description:

- leave “Upload new photos” inside the consent matching panel

Pros:

- no product change for that panel

Cons:

- duplicates the project asset upload flow
- duplicates UI surface area for upload/finalize behavior
- keeps two photo-ingest entry points when product now wants one

Assessment:

- reject

## 4. Chosen architecture

### Core architecture

Chosen architecture:

- keep the current derivative-specific queue/table/worker
- fix enqueue to use service-role access in the real finalize path
- keep async derivative generation after upload finalize
- add a bounded repair/backfill path for missing or outdated derivative rows
- operationalize the asset worker similarly to matching, but without broader redesign
- consolidate photo upload to the main project asset upload flow only

### Rendering policy

The web app render contract for project photo assets becomes:

1. ready derivative URL
2. bounded transform-on-read fallback URL
3. placeholder/unavailable state

Explicitly:

- full original asset URLs are not used as the normal display fallback for web app image surfaces
- originals remain private and preserved for non-display purposes such as explicit future “open/download original” behavior, not normal UI rendering

### URL resolution policy

For photo assets:

- `thumbnailUrl`
  - prefer ready `thumbnail` derivative
  - otherwise sign a bounded transform-on-read URL for the original
  - otherwise return `null`
- `previewUrl`
  - prefer ready `preview` derivative
  - otherwise sign a bounded transform-on-read URL for the original
  - otherwise return `null`

The read helper should also return source/state metadata so UI can distinguish:

- `ready_derivative`
- `transform_fallback`
- `processing`
- `unavailable`

This keeps steady-state on prerendered derivatives while giving bounded compatibility for legacy/pending assets.

## 5. Upload flow consolidation

### Product behavior change

Photo upload is consolidated to one path:

- keep the main project asset uploader in `src/components/projects/assets-upload-form.tsx`
- remove consent matching panel photo upload behavior from `src/components/projects/consent-asset-matching-panel.tsx`

After this feature, the consent matching panel only:

- loads already uploaded project photos
- filters/searches/selects them
- links/unlinks consents/faces
- optionally directs the user to the main Assets section for uploading

### Route implications

Verified current usage:

- the batch upload routes are used by the main project uploader
- the single-create `POST /api/projects/[projectId]/assets` and single-finalize `POST /api/projects/[projectId]/assets/[assetId]/finalize` photo flow is used by the consent matching panel upload behavior
- headshot routes are separate and remain in use

### Bounded route decision

For this feature:

- keep `GET /api/projects/[projectId]/assets` as-is because it powers asset listing
- keep `POST /api/projects/[projectId]/assets` temporarily as a compatibility shim, but remove all product/UI callers for photo upload
- keep `POST /api/projects/[projectId]/assets/[assetId]/finalize` temporarily as a compatibility shim, but remove all product/UI callers for photo upload
- do not remove batch prepare/finalize routes; they remain the primary uploader flow

Why keep the single-photo routes for now:

- they are small and already server-side
- removing product behavior is sufficient for scope
- deleting them now is not required to achieve the product goal
- leaving them unused is more bounded than deleting routes mid-feature while shared asset APIs are also being touched

### Consent matching UI behavior after removal

Consent matching panel changes:

- remove hidden file input and upload handler
- remove upload button/copy about uploading new photos in-panel
- replace with a short callout such as:
  - “Upload project photos in the Assets section, then return here to review and link them.”
- optionally add an anchor/button that jumps to `#project-assets`

## 6. Enqueue and finalize behavior

### Chosen privilege pattern

Derivative queue row creation should be service-owned in the helper layer, following the matching queue pattern.

Plan decision:

- move service-role acquisition into the derivative queue helper pattern, not into individual finalize callers
- update derivative queue helpers to support internal service-role use by default
- update `queueProjectAssetPostFinalizeProcessing(...)` to call the derivative queue helper without depending on the request-scoped client for derivative writes

Why this pattern is preferred:

- matches the repo’s safer server-side convention already used by matching enqueue helpers
- prevents future callers from accidentally reintroducing the same privilege mismatch
- makes the helper responsible for writing to a service-owned table

### Finalize behavior

For real photo finalize flows:

1. finalize asset as uploaded
2. queue derivative rows using service-role access
3. enqueue matching intake work as today
4. keep upload success non-fatal if derivative enqueue fails

### Eliminating silent failure

Derivative enqueue failure must remain non-fatal to upload success, but it must no longer be silent.

Planned behavior:

- keep `queueProjectAssetPostFinalizeProcessing(...)` non-fatal
- add structured server logging when derivative enqueue fails
- include scope fields in logs:
  - `tenantId`
  - `projectId`
  - `assetId`
  - `assetType`
  - error code/message
- keep matching enqueue behavior separate

The route response does not need to fail the upload, but the failure must be observable in logs and recoverable via repair/backfill.

### Idempotency and retries

- derivative queue helper continues to upsert by `(tenant_id, project_id, asset_id, derivative_kind)`
- duplicate finalize attempts must not create duplicate rows
- outdated derivative version or `dead` rows should be re-queued by upsert logic

## 7. Repair / backfill / recovery

### Why this is required

Fixing future uploads alone is not enough:

- existing DB has uploaded assets with zero derivatives
- legacy assets must be recovered to stop original-sized fallbacks

### Chosen repair path

Add a bounded internal repair/backfill endpoint under `src/app/api/internal/assets`.

Recommended shape:

- `POST /api/internal/assets/repair`

Token-protected, similar in spirit to internal matching routes.

### Repair endpoint responsibilities

The repair flow should:

- scan uploaded, non-archived photo assets
- detect assets with:
  - no derivative rows
  - derivative rows missing the current derivative version
  - optionally `dead` derivative rows that should be reset/requeued
- idempotently upsert derivative rows for the current version
- return counts such as:
  - scanned assets
  - queued derivative rows
  - assets already current
  - pending count
  - dead count

### Bounded implementation choice

Do not add a new general queue.

Use the existing `asset_image_derivatives` table as the repair target:

- missing rows -> insert `pending`
- outdated version -> upsert new/current row state
- `dead` -> reset to `pending` by existing queue helper/version logic or explicit repair helper

### Optional read-path safety net

Allowed as a bounded extra:

- when a photo read path sees no current derivative rows, it may perform a best-effort enqueue attempt for that asset/version

But this is secondary.

Primary recovery remains:

- explicit repair/backfill endpoint
- async worker

### Retry-safe design

- use deterministic row identity
- upsert, do not insert ad hoc duplicates
- repair can be rerun safely for the same project/asset set

## 8. Fallback policy

### Contract

The fallback contract for project photo web rendering is:

1. ready derivative
2. bounded transform-on-read fallback
3. placeholder/unavailable state

Full original URLs are excluded from the normal web app display fallback.

### Thumbnail fallback

Thumbnail behavior:

- preferred: ready `thumbnail` derivative
- fallback: bounded transform-on-read using the thumbnail target size
- if no transform URL can be signed or the image fails to load at runtime: show placeholder/unavailable

### Preview fallback

Preview behavior:

- preferred: ready `preview` derivative
- fallback: bounded transform-on-read using the preview target size
- if no transform URL can be signed or the image fails to load at runtime: show placeholder/unavailable or “Preview unavailable”

### Transform fallback sizing

Transform fallback should use the same bounded targets as the intended derivatives, not an unbounded original URL.

This keeps fallback behavior close to steady-state display expectations and avoids normal full-original delivery.

### When transform fallback is unavailable or known-bad

Use placeholder/unavailable when:

- asset status/storage path is not signable
- the helper cannot build a fallback URL
- derivative/source status indicates the asset is unavailable
- the image fails to load in the browser at runtime

Client-side image failure handling must be added in `PreviewableImage` so a broken derivative or transform URL degrades to placeholder state instead of repeated failed image requests.

### UI states

Minimal first-pass UI states:

- thumbnail available
- preview available
- processing
- unavailable

Text can stay minimal:

- grid/list: neutral placeholder
- preview modal: “Preview processing” or “Preview unavailable”

## 9. Derivative sizes and formats

### Chosen defaults

Keep the derivative format simple and explicit:

- output format: JPEG
- thumbnail quality: `76`
- preview quality: `85`

### Chosen sizes

Thumbnail:

- keep current `480` max edge

Reason:

- already implemented
- aligns with “around 400x300 or smaller” for most list/grid use
- avoids unnecessary churn while fixing reliability

Preview:

- increase from current `1280` max edge to `1536` max edge

Reason:

- still clearly bounded
- closer to the desired `1500-1600` preview scale
- better for enlarged preview modals on large originals

### Variant count

Keep only the existing two variants:

- `thumbnail`
- `preview`

Do not introduce more display variants in this feature.

## 10. Read-path changes

### Shared helper change

Refactor the photo display URL helper so it resolves, per asset/use:

- derivative URL if ready
- bounded transform URL if derivative not ready
- `null` if neither is available

The helper should also return source/state metadata, for example:

- `thumbnailState`
- `previewState`

with values like:

- `ready_derivative`
- `transform_fallback`
- `processing`
- `unavailable`

### Surface-by-surface behavior

#### Project asset grid

Route:

- `src/app/api/projects/[projectId]/assets/route.ts`

Plan:

- `thumbnailUrl`: derivative thumbnail first, bounded transform fallback second, `null` otherwise
- `previewUrl`: derivative preview first, bounded transform fallback second, `null` otherwise
- include `thumbnailState` and `previewState`

#### Consent matching panel

Route:

- `src/app/api/projects/[projectId]/consents/[consentId]/assets/matchable/route.ts`

Plan:

- same URL/state contract as asset grid
- no upload behavior in the panel itself
- panel consumes already uploaded project photo assets only

#### Linked photos

Route:

- `src/app/api/projects/[projectId]/consents/[consentId]/assets/links/route.ts`

Plan:

- same URL/state contract
- linked face crop behavior remains separate and unchanged

#### Face review asset images

Serializer:

- `src/lib/matching/face-review-response.ts`

Plan:

- same URL/state contract for asset image thumbnail/preview URLs
- face crop derivatives remain separate

#### Preview modals

Component:

- `src/components/projects/previewable-image.tsx`

Plan:

- use `previewUrl` if present
- if `previewUrl` is `null` or preview load fails, show unavailable state inside the modal
- add image-load failure fallback so transform or derivative failures do not leave broken images

### API compatibility

Keep existing fields:

- `thumbnailUrl`
- `previewUrl`

Add only minimal new metadata required for placeholders/processing state.

This keeps UI/API changes bounded.

## 11. Worker operationalization and observability

### Worker invocation

Operationalize the existing worker route:

- keep `POST /api/internal/assets/worker`
- document required env var:
  - `ASSET_DERIVATIVE_WORKER_TOKEN`
- document example scheduler call in `README.md`

### Repair invocation

Add and document:

- `POST /api/internal/assets/repair`
- token-protected, with its own internal token env var

### Minimal observability

Keep this minimal but real:

- worker response already includes claimed/succeeded/retried/dead
- repair endpoint should include:
  - scanned assets
  - queued rows
  - current missing-derivative count
  - pending count
  - dead count
- enqueue failures should be logged server-side instead of disappearing silently

Do not build a dashboard in this feature.

## 12. Security and reliability

### Tenant scoping

- always derive `tenantId` from server-side auth/session or trusted internal input
- never accept client-provided `tenant_id`
- scope all DB queries by `tenant_id` and `project_id`

### Service-role vs authenticated responsibilities

- authenticated/request-scoped clients:
  - validate access
  - perform normal asset finalize and list queries
- service-role helpers:
  - derivative queue row writes
  - derivative worker processing
  - derivative repair/backfill
  - storage writes to derivative bucket

### Storage and signing

- derivative paths remain deterministic and server-generated
- derivative URLs remain signed server-side only
- clients never provide derivative metadata or storage paths

### Reliability

- derivative row upserts remain idempotent
- worker lease/retry/dead behavior stays based on the existing queue model
- upload success remains independent from derivative processing completion
- partial failures are allowed:
  - upload succeeds
  - derivative may be pending/retried/dead
  - UI still uses bounded fallback or placeholder

## 13. Edge cases

- Existing assets with no derivative rows:
  - repair/backfill required
  - bounded transform fallback covers rollout window
- Upload finalize retried:
  - must not duplicate derivative rows
- Duplicate enqueue attempts:
  - must upsert/reuse current row identity
- Worker not running while rows accumulate:
  - rows remain pending
  - transform fallback continues to keep UI bounded
  - repair/worker docs make recovery explicit
- Derivative generation `dead` states:
  - keep row observable
  - bounded transform fallback may still be used
  - placeholder if transform also fails
- Transform fallback unavailable for problematic originals:
  - client placeholder/unavailable state
- List/grid surfaces before backfill is complete:
  - may show transform fallback or placeholders
  - must not use full-original fallback
- Preview requests for very large legacy assets:
  - use bounded preview transform, not signed original
- Assets archived/deleted after derivative rows exist:
  - existing FK/storage assumptions already support cleanup or unavailability
  - UI should degrade to unavailable state if source/derivative is gone
- Headshot surfaces:
  - remain out of scope for this feature unless explicitly required during implementation

## 14. Testing plan

### Regression tests for the original failure

- add coverage for normal project photo finalize using the real request-scoped client path that previously failed
- verify derivative rows are created after normal project asset finalize
- verify batch project asset finalize also creates derivative rows

### Repair/backfill tests

- asset with no derivative rows is detected and queued by repair endpoint/helper
- repair is idempotent when rerun
- outdated-version or `dead` rows are re-queued appropriately if touched

### Read helper tests

- preference order is:
  1. derivative
  2. bounded transform fallback
  3. placeholder/unavailable
- thumbnails never fall back to full original signed URLs
- previews never fall back to full original signed URLs

### API tests

- asset grid API returns derivative-backed URLs when ready
- asset grid API returns bounded transform fallback when derivative is missing
- matchable assets API does the same
- linked assets API does the same
- face review serializer does the same
- state metadata is returned as expected

### UI tests

- consent matching panel no longer exposes photo upload UI
- consent matching panel shows guidance to use the main asset upload flow
- `PreviewableImage` shows placeholder/unavailable state on image load failure

### Worker tests

- worker claims and completes derivative rows
- retry/dead behavior remains correct if touched
- derivative render/upload failures set expected statuses or error codes

### Compatibility rollout tests

- legacy asset with no derivatives still renders via bounded transform fallback
- legacy asset whose transform fallback fails shows placeholder/unavailable

### Verification commands during implementation

- `npm test`
- `npm run lint`
- `supabase db reset`

## 15. Implementation phases

### Phase 1: Enqueue privilege fix and observability

- make derivative queue helper service-owned by default
- update post-finalize flow to use it correctly
- add structured error logging for derivative enqueue failures
- add regression tests for real finalize-path derivative row creation

### Phase 2: Read-path fallback contract

- refactor photo URL resolution helper
- remove full-original fallback from photo surfaces
- add derivative/fallback state metadata
- update APIs and `PreviewableImage` failure handling

### Phase 3: Repair/backfill and worker operationalization

- add internal asset repair endpoint
- document worker and repair invocation in `README.md`
- add minimal counts/observability in repair response
- add tests for repair/backfill and legacy asset compatibility

### Phase 4: Upload-flow consolidation and UI cleanup

- remove consent matching panel upload behavior
- update panel copy/anchor to point users to the main Assets uploader
- keep single-photo create/finalize routes only as compatibility shims
- add route/UI tests for the consolidated behavior

### Phase 5: Regression coverage and polish

- tighten edge-case coverage
- validate pending/dead/fallback states
- run full verification

## 16. Scope boundaries

This feature does not include:

- a broad asset-processing queue redesign
- deleting originals
- changing face crop derivative architecture
- expanding into headshot derivative work unless explicitly necessary
- new DAM/export workflows
- unrelated project/consent workflow redesign
- general media-management refactors beyond the bounded upload-flow consolidation above

## Implementation prompt

Implement Feature 040 by repairing the existing Feature 038 derivative pipeline in place: make derivative enqueue service-owned and observable, keep the current `asset_image_derivatives` queue/worker model, add a bounded internal repair/backfill path for missing current-version derivatives, remove the consent matching panel photo-upload behavior so the main project asset uploader is the only product upload flow, and change all project-photo display surfaces to resolve URLs in this order: ready derivative, bounded transform-on-read fallback, placeholder/unavailable. Do not use full original-sized asset URLs as the normal display fallback, do not redesign asset processing broadly, keep originals private and preserved, keep tenant scoping explicit, and add regression tests for the real finalize path, repair/backfill, and derivative/fallback read behavior.
