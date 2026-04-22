# Feature 066 Research: Post-Finalize Matching Job Enqueue Reliability

## Goal

Fix project photo finalize so newly uploaded photos reliably enqueue matching/materialization work instead of silently staying in the asset-list `pending` state.

## Live issue observed

- Newly uploaded project photos showed `Pending materialization` in the project assets list.
- Running `POST /api/internal/assets/worker` improved thumbnail and preview loading times.
- Those same assets remained `Pending materialization`.

## Verified cause

### 1. The asset derivative worker is not the matching worker

Verified in `src/app/api/internal/assets/worker/route.ts`:

- the route runs `runAssetImageDerivativeWorker(...)`
- it drains derivative jobs only
- it does not create rows in `asset_face_materializations`

This explains why thumbnails/previews improved while review status did not change.

### 2. Pending review state is driven by face materialization, not derivatives

Verified in:

- `src/lib/matching/asset-preview-linking.ts`
- `src/app/api/projects/[projectId]/assets/route.ts`

Current behavior:

- photo assets without a current `asset_face_materializations` row for the active materializer version derive as `pending`
- only the matching/materialization pipeline can move them out of that state

### 3. The matching enqueue path during finalize uses the wrong Supabase client

Verified in:

- `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`
- `src/lib/assets/finalize-project-asset-batch.ts`
- `src/lib/assets/post-finalize-processing.ts`
- `src/lib/matching/auto-match-jobs.ts`
- `supabase/migrations/20260306131000_010_auto_match_queue_functions.sql`

Current finalize flow:

- finalize routes create a request-scoped server client via `createClient()`
- that client is passed into `queueProjectAssetPostFinalizeProcessing(...)`
- post-finalize calls `enqueuePhotoUploadedJob(...)` with that same client

But the queue RPC permissions are:

- `public.enqueue_face_match_job(...)` is granted to `service_role`
- it is not granted to `authenticated`

So the finalize path can fail to enqueue `photo_uploaded` jobs when it uses the request-scoped user client.

### 4. The finalize path currently hides the enqueue failure

Verified in `src/lib/assets/post-finalize-processing.ts`:

- matching enqueue is wrapped in `try { ... } catch { /* Primary finalize flow must still succeed */ }`
- no matching enqueue failure is logged

Result:

- uploads finalize successfully
- derivative jobs still queue and run
- no `face_match_jobs` row exists for the new photo
- the asset remains `pending` forever unless a repair path is run later

## Live data verification

Local inspection showed for the newest pending photo assets:

- no `asset_face_materializations` row
- no `face_match_jobs` row

That matches the finalize-enqueue failure path exactly.

## Relevant files

- `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`
- `src/lib/assets/finalize-project-asset-batch.ts`
- `src/lib/assets/post-finalize-processing.ts`
- `src/lib/matching/auto-match-jobs.ts`
- `src/lib/supabase/admin.ts`
- `src/app/api/internal/matching/worker/route.ts`
- `src/app/api/internal/matching/repair/route.ts`

## Risks and edge cases

- Finalize must still remain retry-safe and should not fail the upload because downstream matching enqueue failed.
- Matching enqueue should use the admin client, but tenant/project ids must still come from the already validated finalize scope.
- Existing pending assets with no jobs need operational backfill via the repair path; code change alone will not repair already-missed rows.

## Recommendation

Make `queueProjectAssetPostFinalizeProcessing(...)` use the admin client for matching-boundary reads and matching-job enqueue, while preserving current non-fatal behavior for finalize. Add explicit logging for matching enqueue failures. After the code fix, backfill current pending assets through the existing matching repair endpoint and matching worker.
