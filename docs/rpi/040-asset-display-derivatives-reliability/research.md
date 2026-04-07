# Feature 040 Research: Asset Display Derivatives Reliability

## Goal

Research why Feature 038 is not functioning as intended, why the web app is still using original uploaded images on display surfaces, and what bounded direction should make display derivatives reliable, async, retry-safe, and actually used by the UI.

This is research only. No implementation changes are proposed in this document.

## Inputs reviewed

Required docs, in order:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/038-original-image-ingest-and-display-derivatives/research.md`
- `docs/rpi/038-original-image-ingest-and-display-derivatives/plan.md`

Feature 038 implementation, schema, tests, and related asset code:

- `supabase/migrations/20260407133000_038_asset_image_derivative_pipeline.sql`
- `src/lib/assets/asset-image-policy.ts`
- `src/lib/assets/asset-image-derivatives.ts`
- `src/lib/assets/asset-image-derivative-worker.ts`
- `src/lib/assets/post-finalize-processing.ts`
- `src/lib/assets/sign-asset-thumbnails.ts`
- `src/lib/assets/create-asset.ts`
- `src/lib/assets/finalize-asset.ts`
- `src/lib/assets/prepare-project-asset-batch.ts`
- `src/lib/assets/finalize-project-asset-batch.ts`
- `src/app/api/internal/assets/worker/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`
- `src/app/api/projects/[projectId]/assets/batch/prepare/route.ts`
- `src/app/api/projects/[projectId]/assets/batch/finalize/route.ts`
- `tests/feature-038-asset-image-derivatives.test.ts`

Current image display/read paths:

- `src/app/api/projects/[projectId]/assets/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/matchable/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/links/route.ts`
- `src/lib/matching/face-review-response.ts`
- `src/components/projects/assets-list.tsx`
- `src/components/projects/consent-asset-matching-panel.tsx`
- `src/components/projects/previewable-image.tsx`
- `src/app/(protected)/projects/[projectId]/page.tsx`

Current async queue/worker/retry infrastructure used elsewhere for comparison:

- `src/lib/matching/auto-match-jobs.ts`
- `src/lib/matching/auto-match-worker.ts`
- `src/app/api/internal/matching/worker/route.ts`
- `src/app/api/internal/matching/reconcile/route.ts`
- `src/app/api/internal/matching/repair/route.ts`
- `docs/rpi/025-matching-queue-robustness/research.md`
- `docs/rpi/030-continuation-retry-reliability/research.md`
- `README.md`

Direct database/storage inspection on 2026-04-07 against the configured Supabase project:

- `asset_image_derivatives` exists
- `asset_image_derivatives` row count is `0`
- uploaded `photo` asset count is `270`
- uploaded `photo` assets missing any derivative rows is `270`
- `asset-image-derivatives` bucket exists
- visible objects in `asset-image-derivatives` bucket root: `0`

## Executive summary

Feature 038 was mostly implemented in code, but its row-enqueue path is wired incorrectly in production-facing finalize flows.

Verified root cause:

1. `asset_image_derivatives` only grants table write access to `service_role`.
2. Both photo finalize entry points call derivative queueing through `createClient()`, which is an authenticated/anon-key server client, not a service-role client.
3. The derivative upsert therefore fails.
4. `queueProjectAssetPostFinalizeProcessing(...)` swallows that failure by design.
5. No derivative rows are created, no derivative objects are generated, and the UI falls back to signed original asset URLs.

That fully explains the observed state:

- `asset_image_derivatives` has zero rows
- the derivative worker has nothing to process
- project asset grids, consent matching surfaces, and preview modals keep loading originals
- large originals are used even for thumbnail-sized surfaces

The cleanest bounded direction is to repair Feature 038, not redesign it:

- keep the existing derivative table, worker, and read-helper design
- fix derivative enqueue to use service-role access
- add an explicit derivative repair/backfill path and worker operationalization
- change thumbnail fallback so list/grid surfaces do not use originals by default

## Verified current behavior

### What Feature 038 intended

Feature 038 research and plan intended to:

- preserve original uploads untouched
- broaden ingest policy with one shared image policy
- generate `thumbnail` and `preview` derivatives asynchronously
- read derivative URLs first in the UI
- fall back safely when derivatives are missing
- keep the pipeline private, tenant-scoped, and retry-safe

### What was actually implemented

Implemented pieces:

- shared image ingest policy
- `asset_image_derivatives` table and private `asset-image-derivatives` bucket
- derivative lease/retry SQL functions
- service-role derivative worker using `sharp`
- `thumbnail` and `preview` variants
- read helper that prefers derivative rows and can fall back
- post-finalize hook intended to queue derivatives for photo assets
- internal asset worker route
- Feature 038 tests proving the manual queue + worker path

What is live but broken/incomplete:

- derivative row creation in normal finalize flows
- rollout/backfill for older assets
- repair/reconcile tooling for missing/outdated derivatives
- worker operationalization/documentation comparable to matching
- UI fallback behavior for missing derivatives on grid/list surfaces

## 1. Current state of Feature 038

### Intended design vs live design

Feature 038 planned:

- shared upload policy
- async derivative generation
- derivative-backed UI reads
- original preserved privately
- original fallback only as a bounded fallback

Live code matches most of that design structurally, but not operationally.

Implemented schema/helpers/routes/workers:

- schema: `asset_image_derivatives`, claim/fail RPCs, derivative bucket
- helpers: `src/lib/assets/asset-image-derivatives.ts`
- worker: `src/lib/assets/asset-image-derivative-worker.ts`
- worker route: `src/app/api/internal/assets/worker/route.ts`
- enqueue hook: `src/lib/assets/post-finalize-processing.ts`
- UI read helper: `src/lib/assets/sign-asset-thumbnails.ts`
- photo read paths:
  - `src/app/api/projects/[projectId]/assets/route.ts`
  - `src/app/api/projects/[projectId]/consents/[consentId]/assets/matchable/route.ts`
  - `src/app/api/projects/[projectId]/consents/[consentId]/assets/links/route.ts`
  - `src/lib/matching/face-review-response.ts`

Incomplete/unused/bypassed pieces:

- derivative rows are not being created in real finalize flows
- worker route exists, but I found no in-repo scheduling/docs equivalent to the matching worker
- there is no asset derivative reconcile/repair endpoint
- there is no UI derivative status surfaced to distinguish ready vs pending vs dead
- thumbnails/previews still fall back straight to originals on photo surfaces

### Notable divergences from the plan

- Plan recommended using the existing `project-assets` bucket for derivatives. Implementation uses a separate private `asset-image-derivatives` bucket.
- Plan described a simpler `pending/ready/failed` model. Implementation added a stronger leased queue model with `pending/processing/ready/dead`, attempts, backoff, and reclaimable leases.
- Plan called for fallback safety, but current read paths use `fallback: "original"` for photo surfaces, which is much more aggressive than the plan’s stated intent.

## 2. Derivative table reality

### Table existence and actual schema

`asset_image_derivatives` exists in both migration and current database.

Actual columns/constraints/statuses include:

- identity/scope: `id`, `tenant_id`, `project_id`, `asset_id`
- varianting: `derivative_kind`, `derivative_version`
- storage: `storage_bucket`, `storage_path`, `content_type`, `file_size_bytes`, `width`, `height`
- queue state: `status`, `attempt_count`, `max_attempts`, `run_after`, `locked_at`, `locked_by`, `lease_expires_at`
- outcomes: `generated_at`, `failed_at`, `last_error_code`, `last_error_message`, `last_error_at`
- timestamps: `created_at`, `updated_at`

Statuses are:

- `pending`
- `processing`
- `ready`
- `dead`

Variants are:

- `thumbnail`
- `preview`

### Actual row reality

Verified in the configured database on 2026-04-07:

- `asset_image_derivatives` rows: `0`
- uploaded photo assets: `270`
- uploaded photo assets missing any derivative rows: `270`
- derivative bucket objects observed: `0`

### Why rows are missing

The evidence points to rows never being created, not rows being updated incorrectly or deleted later.

Reasons:

- the table exists, so this is not a missing migration problem
- there are no rows in any status, so this is not a worker-only failure mode
- there are no objects in the derivative bucket, matching the zero-row state
- the queue helper performs an upsert into `asset_image_derivatives`
- that upsert requires table write privileges
- the migration revokes table access from `authenticated` and grants DML only to `service_role`
- the finalize routes call the queue through `createClient()`, which uses the anon key plus user session, not the service role
- the post-finalize hook catches and ignores derivative queue errors

Verified code mismatch:

- `supabase/migrations/20260407133000_038_asset_image_derivative_pipeline.sql`
  - revokes all from `authenticated`
  - grants `select, insert, update, delete` only to `service_role`
- `src/lib/supabase/server.ts`
  - `createClient()` uses `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`
  - uses `createClient()`
  - then calls `queueProjectAssetPostFinalizeProcessing(...)`
- `src/lib/assets/finalize-project-asset-batch.ts`
  - also calls `queueProjectAssetPostFinalizeProcessing(...)`
- `src/lib/assets/post-finalize-processing.ts`
  - tries `queueAssetImageDerivativesForAssetIds(...)`
  - swallows errors

### Are variants/statuses aligned with the plan?

Mostly yes, but with a more robust queue model than originally planned.

This is not the problem. The schema is sufficient for bounded repair:

- versioned derivative rows
- deterministic unique key per asset/variant
- lease-based claim
- retry/backoff

## 3. Upload/finalize pipeline

### Upload entry points

There are two photo upload entry points:

1. Normal project asset upload
   - `src/components/projects/assets-upload-form.tsx`
   - batch prepare: `src/app/api/projects/[projectId]/assets/batch/prepare/route.ts`
   - batch finalize: `src/app/api/projects/[projectId]/assets/batch/finalize/route.ts`

2. Consent matching panel “Upload new photos”
   - `src/components/projects/consent-asset-matching-panel.tsx`
   - create asset: `src/app/api/projects/[projectId]/assets/route.ts`
   - single finalize: `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`

Both use the same shared upload policy:

- `src/lib/assets/asset-image-policy.ts`
- server validation in `src/lib/assets/create-asset.ts`

### What happens on finalize

Current photo finalize flow:

1. asset row is marked `uploaded`
2. `queueProjectAssetPostFinalizeProcessing(...)` is called
3. for `photo` assets, it tries to queue derivative rows
4. it separately enqueues matching intake work

### Do both upload entry points behave the same way?

Yes for derivatives:

- single finalize route and batch finalize both call the same post-finalize helper
- both therefore hit the same derivative enqueue bug

### Is derivative generation job actually enqueued?

Not in the live finalize path.

The intended enqueue call exists, but it fails because it is using the wrong Supabase client privilege level. The failure is silent due to `catch {}`.

### Is the enqueue step failing silently?

Yes. This is one of the main verified problems.

`src/lib/assets/post-finalize-processing.ts` explicitly comments that original finalize must still succeed and derivative reads fall back to the original asset.

That is reasonable as a product invariant, but without logging/repair/backfill it turns a real pipeline failure into a silent permanent state.

## 4. Async processing / worker reliability

### Does derivative generation have a real async pipeline today?

Yes, once rows exist.

The derivative pipeline includes:

- table-backed queue state in `asset_image_derivatives`
- claim RPC with leasing and `for update skip locked`
- retry/backoff RPC
- service-role worker implementation
- internal token-protected worker route

### Reliability characteristics of the derivative queue

Good parts already implemented:

- deterministic row key `(tenant_id, project_id, asset_id, derivative_kind)`
- derivative versioning
- lease-based claiming
- reclaim of expired `processing` rows
- bounded retries with backoff
- terminal `dead` state
- deterministic storage path per asset/version/variant
- worker writes with `upsert: true`

Current gap areas vs the repo’s matching pipeline:

- no repair/reconcile endpoint under `src/app/api/internal/assets`
- no README documentation or scheduler examples for the asset worker
- no project-level observability for derivative readiness/dead rows
- no backfill tool for older assets
- no integration test for finalize -> derivative row creation using the real request-scoped client path

### Comparison to face matching/materialization

Matching today has:

- service-role enqueue helpers by default
- worker route
- reconcile route
- repair route
- richer operational docs in `README.md`
- explicit repair thinking carried through Features 025 and 030

Derivative processing today has:

- a decent queue model
- a worker route
- no repair/reconcile path
- no operational docs
- a broken enqueue privilege path

So the derivative worker itself is not the weakest link. The broken link is earlier: rows never get created.

### Is the worker path being called?

I could not verify external scheduler configuration from the repo alone.

What is verified:

- `ASSET_DERIVATIVE_WORKER_TOKEN` is configured in `.env.local`
- `src/app/api/internal/assets` contains only `worker/route.ts`
- `README.md` documents matching worker/reconcile endpoints, but not the asset derivative worker

Inference:

- the asset worker may or may not be scheduled externally
- regardless, zero rows means it currently has nothing to process

## 5. Read-path behavior in the web app

### Verified photo display surfaces

| Surface | URL source | Derivative preference | Current fallback |
| --- | --- | --- | --- |
| Project asset grid | `/api/projects/[projectId]/assets` | yes | signed original |
| Asset preview modal | same API `previewUrl` | yes | signed original |
| Consent matchable photos | `/api/projects/[projectId]/consents/[consentId]/assets/matchable` | yes | signed original |
| Linked photos | `/api/projects/[projectId]/consents/[consentId]/assets/links` | yes | signed original |
| Face review session asset images | `src/lib/matching/face-review-response.ts` | yes | signed original |

All of those photo surfaces call `signThumbnailUrlsForAssets(...)` with:

- `tenantId`
- `projectId`
- `use: "thumbnail"` or `use: "preview"`
- `fallback: "original"`

That means:

- if a ready derivative row exists, it is used
- if not, the helper signs the original object directly
- the UI still receives a URL, but it is the full original

### Does the UI distinguish thumbnail vs preview vs original?

At the API shape level, yes:

- `thumbnailUrl`
- `previewUrl`

At runtime when derivatives are missing, not really:

- both can collapse to signed originals
- the browser loads the original even in grid/list surfaces

### Current helper behavior

`src/lib/assets/sign-asset-thumbnails.ts`:

- prefers ready derivatives when `tenantId` and `projectId` are provided
- otherwise falls back according to `fallback`
- default fallback is `"transform"`

For the photo APIs above, callers override to `"original"`.

### Adjacent out-of-scope surfaces

Consent headshot previews on the project page still use `signThumbnailUrlsForAssets(...)` without derivative lookup context and with resize-only options:

- `src/app/(protected)/projects/[projectId]/page.tsx`

So headshots are still transform-on-read/original-backed, but that is separate from Feature 038’s photo asset derivative pipeline.

Face crop thumbnails are separate and already use `asset_face_image_derivatives`.

## 6. Why originals are still being used

Verified reasons, in order:

1. Derivative rows do not exist.
2. They do not exist because enqueue is failing in finalize flows.
3. That enqueue failure is silent.
4. The UI read paths all fall back to original URLs for photo assets.

What is not supported by current evidence:

- rows being created and later deleted
- rows existing but not being queried on photo APIs
- rows existing but not being signable
- UI ignoring returned derivative URLs

The current failure is earlier and simpler: the fallback path is masking a row-creation failure.

## 7. Fallback behavior

### Current fallback

Current photo fallback is:

- no derivative row or no ready derivative
- sign the original object directly
- use that original for both thumbnail and preview surfaces

Why this is slow:

- grid/list surfaces request the full original asset
- CSS shrinks display size, but transfer size and decode cost stay large
- preview and thumbnail can become the same underlying original object path

### Fallback options considered

#### Option A: keep falling back to original everywhere

Pros:

- simplest
- no blank states

Cons:

- causes the exact current performance problem
- makes full-original delivery the normal path whenever the pipeline is late or broken

Assessment:

- not acceptable as the steady-state default

#### Option B: thumbnail placeholder only, preview original as last resort

Pros:

- grid/list surfaces stop loading huge originals
- keeps an escape hatch for previewing older assets during rollout
- bounded and simple

Cons:

- temporary placeholder states in list/grid until derivatives/backfill complete
- preview fallback can still be heavy when used

Assessment:

- best bounded fallback for the first repair

#### Option C: on-read bounded preview generation via server `sharp`

Pros:

- avoids original delivery
- gives a better legacy fallback than placeholders

Cons:

- adds a new CPU-heavy authenticated image proxy path
- more moving parts than needed for the first repair
- easy to over-scope

Assessment:

- possible later, not necessary for the bounded first fix

#### Option D: keep using Supabase transform-on-read as fallback

Pros:

- less custom server code

Cons:

- this is the failure class Feature 038 was trying to avoid
- still depends on original transform compatibility

Assessment:

- not recommended

### Recommended bounded fallback strategy

For photo assets:

- `thumbnailUrl`: use ready derivative only; otherwise return `null` and let the UI show a placeholder/processing state
- `previewUrl`: prefer ready derivative; during rollout/backfill, allow original only as an explicit last resort
- optionally enqueue missing derivatives on read, but do not inline-generate them on read

That keeps the normal UI rendering path off originals without forcing a large redesign.

## 8. Derivative sizes and formats

### What is implemented today

Current defaults in `src/lib/assets/asset-image-derivatives.ts`:

- thumbnail: JPEG, max `480x480`, quality `76`
- preview: JPEG, max `1280x1280`, quality `85`

Worker behavior in `src/lib/assets/asset-image-derivative-worker.ts`:

- auto-orient with `rotate()`
- resize `fit: "inside"`
- `withoutEnlargement: true`
- flatten to white
- output JPEG

### Evaluation

This is already a reasonable bounded shape:

- one small derivative for grids/lists
- one larger derivative for preview
- browser-safe output
- deterministic, simple, cheap to store

Potential adjustments for plan phase:

- thumbnail max edge `400-480` is fine
- preview max edge could stay `1280` or be bumped modestly to `1500-1600`
- keep aspect-ratio preservation; do not force crop in the derivative itself

### Format choice

Recommended bounded default:

- keep JPEG as the first implementation standard

Why:

- already implemented
- universally browser-safe
- good enough for photo-centric surfaces
- avoids adding dual-format complexity while the reliability bug is still unresolved

Tradeoffs to note:

- transparent PNGs will flatten to white
- animated GIFs will effectively become poster-style static JPEG derivatives

For this app’s photo-consent scope, that is acceptable if originals remain preserved.

## 9. Compatibility / migration / backfill

### Older assets

Current database reality means older assets absolutely need repair/backfill:

- uploaded photo assets: `270`
- assets with any derivative rows: `0`

This is not a small tail. It is effectively the entire current photo library.

### Is backfill needed?

Yes.

Without backfill, fixing enqueue alone only helps future uploads. Existing assets would continue falling back to originals.

### Recommended repair/backfill shape

Bounded direction:

- add an internal derivative repair/backfill flow that scans uploaded photo assets missing derivative rows or missing current derivative version
- upsert derivative queue rows idempotently
- let the existing worker generate objects asynchronously

Optional extra safety:

- on photo read, if derivative rows are missing, fire a best-effort enqueue for that asset/version

But the primary recovery path should still be a deliberate repair/backfill flow, not on-read generation.

## 10. Security and storage

### Current storage approach

Originals:

- bucket: `project-assets`
- path shape: `tenant/<tenantId>/project/<projectId>/asset/<assetId>/<filename>`

Derivatives:

- bucket: `asset-image-derivatives`
- path shape: `tenant/<tenantId>/project/<projectId>/asset/<assetId>/derivative/<derivativeVersion>/<kind>.jpg`

### Security posture

Good parts:

- derivative paths are deterministic and server-generated
- URLs are signed server-side
- table reads are tenant/project scoped
- private bucket model is preserved
- originals remain preserved and private

Current security/operational mismatch:

- derivative row writes are effectively service-owned
- finalize flows use an authenticated client, not a service-role client

That mismatch is causing the reliability failure, but it does not widen access. It blocks intended writes.

### Does fallback widen access?

No direct access widening is evident:

- originals are still signed server-side
- scope comes from server-side queries and signed URLs

But the current fallback does bypass intended rendering controls:

- full originals become normal UI render payloads
- original metadata/size are exposed to the browser more often than intended

## 11. Performance implications

### Likely impact of current behavior

The current behavior is plausibly very expensive for users:

- a 16 MB `6000x4000` original can be loaded where a thumbnail should be used
- the grid may show many such images on one page
- browsers still download and decode the original even if display size is tiny
- preview modals do not get a distinct bounded preview when derivatives are missing

Qualitatively, the current slowness is most likely driven by:

- bandwidth
- browser decode/memory cost for large images
- repeated short-lived signed-original delivery on normal browsing paths

For photo surfaces, the slowness is no longer mainly transform latency. The APIs explicitly fall back to originals, so the dominant problem is oversized payloads.

For headshot surfaces outside this feature, transform-on-read latency may still matter, but that is a separate issue.

## 12. Current constraints and invariants

- Originals must remain preserved and private.
- Tenant/project scoping must stay server-derived and explicit.
- Derivative writes must be idempotent and retry-safe.
- Upload/finalize must remain successful even if derivative enqueue fails.
- Business logic stays server-side.
- This should stay bounded to display derivatives for project photo assets, not a wider DAM redesign.
- Face crop derivatives (`asset_face_image_derivatives`) are separate and should not be conflated with photo display derivatives.

## 13. Options considered

### Option 1: Repair Feature 038 in place

Description:

- keep the existing derivative table, worker, variants, and read helper
- fix enqueue privilege usage
- add repair/backfill and better fallback behavior

Pros:

- smallest bounded change
- aligns with already-written code/tests
- preserves async/retry-safe direction

Cons:

- still needs operational follow-through
- may need small fallback/UI adjustments in addition to the enqueue fix

Assessment:

- recommended

### Option 2: Redesign around a broader asset-processing queue

Description:

- replace the current derivative-specific table/worker with a more generic asset-processing queue

Pros:

- more general long-term architecture

Cons:

- too broad for the actual failure
- discards working pieces already implemented
- risks mixing unrelated media-processing concerns

Assessment:

- not recommended for the next phase

### Option 3: Keep current architecture but only tweak fallback

Description:

- leave enqueue/worker architecture alone
- stop using originals on thumbnail surfaces

Pros:

- improves immediate UX

Cons:

- does not fix zero derivative rows
- older/newer assets still never get durable derivatives

Assessment:

- insufficient by itself

## 14. Recommended bounded direction

### Recommendation

Repair and finish Feature 038 rather than redesign it.

Bounded direction for the next plan:

1. Fix derivative row enqueue to use service-role access.
2. Keep the current `asset_image_derivatives` table and worker model.
3. Add an internal derivative repair/backfill flow for missing/current-version derivatives.
4. Operationalize the asset worker similarly to matching:
   - document it
   - schedule it
   - add minimal observability
5. Change photo thumbnail fallback so grid/list surfaces do not use originals by default.
6. Keep preview fallback more permissive than thumbnail fallback during rollout, but treat original preview as a last resort, not the normal path.
7. Add regression coverage for finalize -> derivative enqueue using the real server client path.

### Why this is the cleanest bounded fix

- the worker queue model is already good enough for a first pass
- the read helper is already derivative-aware
- the failure is concentrated in one broken privilege path plus missing operational completeness
- current tests prove the manual happy path works; they do not prove the real finalize path works

## 15. Risks and tradeoffs

- Fixing enqueue alone will not help existing assets; backfill is required.
- If fallback is tightened too aggressively before backfill, users may see placeholders for many legacy assets.
- If thumbnail fallback continues to use originals, performance will remain poor whenever derivatives are late.
- If the worker is not documented/scheduled, rows may accumulate in `pending` after the enqueue fix.
- If no repair path exists, dead/outdated derivatives will still need manual recovery later.
- Keeping JPEG-only output is simpler, but loses transparency/animation in display derivatives.

## 16. Open decisions for the plan phase

1. Keep the current derivative-specific queue/table or wrap it in a broader asset-processing abstraction later.
   - Recommendation: keep the current table/worker for now.

2. Whether to use service-role access inside `queueProjectAssetPostFinalizeProcessing(...)` or move service-role creation into the derivative queue helper itself.
   - Matching already defaults to service-role helpers. Mirroring that pattern is the lower-risk direction.

3. Whether thumbnail fallback should ever use originals directly.
   - Recommendation: no, not for normal grid/list surfaces.

4. Whether preview fallback may temporarily use originals directly during rollout/backfill.
   - Recommendation: yes, but only as a last resort and not for steady-state thumbnails.

5. Whether to add on-read enqueue of missing derivatives.
   - Recommendation: optional safety net, but separate repair/backfill should remain primary.

6. Whether preview size should stay at the current `1280` max edge or move closer to `1500-1600`.
   - Recommendation: decide in plan; either is bounded.

7. Whether to keep JPEG as the sole derivative format for the first repair.
   - Recommendation: yes.

8. Whether to add minimal derivative observability now.
   - At least counts of pending/dead derivatives and a documented worker invocation path are worth including.

9. How backfill is triggered.
   - Recommendation: dedicated internal repair/backfill endpoint or script, not inline generation on user reads.

10. Whether headshot display surfaces should remain out of scope.
    - Recommendation: yes for the immediate Feature 040 plan, unless the user explicitly expands scope.

## Conclusion

Feature 038 is not failing because the derivative idea was wrong. It is failing because the live finalize path never successfully writes derivative queue rows, and the UI is explicitly designed to fall back to original signed URLs when that happens.

The current database state strongly supports that conclusion:

- derivatives table exists
- derivative bucket exists
- derivative rows: `0`
- derivative objects: `0`
- uploaded photo assets: `270`
- uploaded photo assets missing derivatives: `270`

The cleanest next step is to finish the existing design:

- fix the enqueue privilege bug
- add repair/backfill and worker operationalization
- stop using originals as the default thumbnail fallback

That preserves originals, stays tenant-scoped and server-side, and keeps the outcome bounded and reviewable.
