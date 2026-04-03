# Feature 021 Research: Project Matching Progress UI

## Scope and method

This research is based on the current repository code and schema:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/components/projects/*`
- `src/app/api/projects/[projectId]/*`
- `src/lib/matching/*`
- matching-related migrations

Repository code is authoritative.

## Current UI and data shape

- The project detail page is server-rendered in [page.tsx](/C:/Users/tim/projects/snapconsent-lite/src/app/(protected)/projects/[projectId]/page.tsx).
- There is no existing project-level matching status endpoint.
- Existing project UI already uses small client components for focused interactions, including:
  - [assets-list.tsx](/C:/Users/tim/projects/snapconsent-lite/src/components/projects/assets-list.tsx)
  - [consent-asset-matching-panel.tsx](/C:/Users/tim/projects/snapconsent-lite/src/components/projects/consent-asset-matching-panel.tsx)
- Existing client polling is minimal. `assets-list.tsx` uses `useEffect` and fetches on input/state changes, but there is no generic polling subsystem.

## Current matching state available in the repo

Current persisted state relevant to project progress:

- uploaded project photos live in `assets`
- queued/processing/terminal work lives in `face_match_jobs`
- materialized photo processing lives in `asset_face_materializations`
- materialized compare outcomes live in `asset_consent_face_compares`

Verified from migrations:

- [20260306130000_010_auto_match_backbone_schema.sql](/C:/Users/tim/projects/snapconsent-lite/supabase/migrations/20260306130000_010_auto_match_backbone_schema.sql)
- [20260320140000_019_face_materialization_pipeline.sql](/C:/Users/tim/projects/snapconsent-lite/supabase/migrations/20260320140000_019_face_materialization_pipeline.sql)

## Best current progress metric

The preferred product metric is:

- processed project images / total eligible project images

The simplest reliable version already supported by the current codebase is:

- `totalImages` = uploaded, unarchived photo assets in the project
- `processedImages`:
  - materialized pipeline: distinct uploaded photo asset ids that have a current materialization row for the active materializer version
  - raw pipeline fallback: distinct uploaded photo asset ids with a terminal `photo_uploaded` job (`succeeded` or `dead`) and no current queued/processing `photo_uploaded` job

Why this is the best small-scope fit:

- it is image-based, not queue-count-based
- it stays fully server-side
- it uses current durable matching state
- it does not require new schema

## What `isMatchingInProgress` can mean today

The simplest reliable boolean is:

- project has any `face_match_jobs` in `queued` or `processing`

This is not the main user-facing progress metric, but it is sufficient for a small “Matching in progress” label.

## Constraints and tradeoffs

- In `materialized_apply`, image materialization can reach 100% while compare jobs are still running. That is acceptable for this feature because the progress bar is explicitly image-based, and `isMatchingInProgress` remains true while downstream jobs continue.
- In `raw`, exact photo-level completion is harder because the pipeline is pairwise, not per-photo-materialization. The terminal-job fallback is a bounded approximation, not a perfect semantic proof of all pair work being done.
- No websocket or SSE support is needed. Simple polling is sufficient.

## Recommendation

Implement:

1. a small tenant-scoped helper for project matching progress
2. a tenant-scoped route under the project API
3. a small client component on the project page that:
   - renders one progress bar
   - renders `processed / total`
   - renders a small in-progress label
   - polls every few seconds until matching is no longer in progress

This stays within current architecture and avoids schema or pipeline changes.
