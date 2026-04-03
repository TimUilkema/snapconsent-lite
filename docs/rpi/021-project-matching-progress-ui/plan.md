# Feature 021 Plan: Project Matching Progress UI

## Scope boundary

This plan adds a small project-level matching progress UI:

- one server-side project progress endpoint
- one simple polling client component
- one progress bar on the project page

Out of scope:

- websockets
- SSE
- schema changes
- pipeline redesign
- generic realtime infrastructure

## Ground-truth validation

- The project page is [page.tsx](/C:/Users/tim/projects/snapconsent-lite/src/app/(protected)/projects/[projectId]/page.tsx).
- No existing project matching status endpoint exists.
- Existing matching state already provides enough data for a bounded image-based metric:
  - `assets`
  - `face_match_jobs`
  - `asset_face_materializations`
- Current pipeline mode is available through [auto-match-config.ts](/C:/Users/tim/projects/snapconsent-lite/src/lib/matching/auto-match-config.ts).

## Implementation steps

### Step 1: Add a server-side progress helper

- [x] Create a small helper in `src/lib/matching/` that returns:
  - `totalImages`
  - `processedImages`
  - `progressPercent`
  - `isMatchingInProgress`
- [x] Keep tenant/project scoping explicit.
- [x] Use image-based progress as the primary metric.
- [x] Add a raw-pipeline fallback approximation only where needed.

### Step 2: Add a project API endpoint

- [x] Add a tenant-scoped route under `src/app/api/projects/[projectId]/`.
- [x] Reuse current auth and tenant resolution patterns.
- [x] Return only the minimal progress payload.

### Step 3: Add a small client polling component

- [x] Create a lightweight client component in `src/components/projects/`.
- [x] Render:
  - one progress bar
  - one `processed / total` label
  - one small status label
- [x] Poll every few seconds while matching is still in progress.

### Step 4: Add the UI to the project page

- [x] Render the progress component near the project summary on the project page.
- [x] Pass initial server-fetched progress to avoid a blank first render.

### Step 5: Add tests and run quality gates

- [x] Add a targeted test for the progress helper.
- [x] Run:
  - `npm test`
  - `npm run lint`
  - `npm run build`

## Files expected to change

- `src/lib/matching/project-matching-progress.ts`
- `src/app/api/projects/[projectId]/matching-progress/route.ts`
- `src/components/projects/project-matching-progress.tsx`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `tests/feature-021-project-matching-progress.test.ts`
- `docs/rpi/021-project-matching-progress-ui/plan.md`

## Progress calculation

- `totalImages`: uploaded, unarchived project photos
- `processedImages`:
  - materialized modes: distinct uploaded project photos with a current materialization row for the active materializer version
  - raw mode fallback: distinct uploaded project photos with terminal `photo_uploaded` processing and no queued/processing `photo_uploaded` job
- `progressPercent`: rounded `(processedImages / totalImages) * 100`, bounded `0-100`
- `isMatchingInProgress`: any queued/processing matching jobs for the project

## Risks and edge cases

- Materialized progress may hit 100% before compare jobs finish. The separate `isMatchingInProgress` label covers that.
- Raw fallback is an approximation, not a full proof of pairwise completion.
- Projects with zero eligible photos should render `0 / 0` and a `0%` bar, not fail.

## Verification checklist

- Project page shows progress without manual refresh.
- Polling stops when matching is no longer in progress.
- Progress is tenant-scoped and project-scoped.
- No sensitive matching internals are exposed.
- No schema change is required.
