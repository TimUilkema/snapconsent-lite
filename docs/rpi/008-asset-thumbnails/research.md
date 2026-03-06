# 008 Asset Thumbnails - Research

## Goal
Show real image thumbnails (not placeholders) for project assets, and show linked headshot thumbnails in consent details, while keeping Supabase Storage private and tenant-scoped.

## Current State Analysis
### 1) Asset storage model
- `assets` schema is defined in `supabase/migrations/20260305120000_004_assets_schema.sql`.
- Relevant columns already exist for thumbnail retrieval:
  - `storage_bucket`
  - `storage_path`
  - `status` (`pending`, `uploaded`, `archived`)
  - `tenant_id`, `project_id`
  - `asset_type` (`photo`, `headshot`) from `20260306100000_006_headshot_consent_schema.sql`.
- Storage path is server-generated in `src/lib/assets/create-asset.ts`:
  - `tenant/<tenantId>/project/<projectId>/asset/<assetId>/<filename>`
- Upload lifecycle:
  - create pending asset + signed upload URL (`createAssetWithIdempotency`)
  - finalize -> mark `uploaded` (`finalizeAsset`)

### 2) Private Storage setup
- Bucket is private: `project-assets` (`public=false`) in `supabase/migrations/20260305122000_004_assets_storage.sql`.
- `storage.objects` policies validate tenant/project path prefixes and membership.
- No public object URLs are used.

### 3) Current UI behavior
- Asset list UI currently renders a placeholder square:
  - `src/components/projects/assets-list.tsx`
- Project page query currently filters assets to photos only:
  - `src/app/(protected)/projects/[projectId]/page.tsx` uses `.eq("asset_type", "photo")`
- Consent details already compute whether a linked headshot exists (ID map), but do not render image thumbnails.

## Storage Access Options
### Option A: Signed download URL per image (server-generated)
- Use `storage.from(bucket).createSignedUrl(path, ttl, options?)`.
- Supports private bucket access.
- In this repo’s `@supabase/storage-js`, `createSignedUrl` supports `transform` options (width/height/resize/quality).
- Pros:
  - Works with private bucket.
  - Short TTL limits exposure.
  - Can request smaller transformed thumbnails.
- Cons:
  - One call per image if transform is needed.

### Option B: Batch signed URLs (`createSignedUrls`)
- Use one call for multiple paths.
- In current library version, batch method supports `download` but not transform options.
- Pros:
  - Fewer round-trips.
- Cons:
  - No resize transform; browsers may fetch full-resolution images.

### Option C: Public URL / direct object URL
- Not acceptable with private bucket and privacy constraints.

## Server Architecture Findings
- Safe generation points:
  1. Server component (`src/app/(protected)/projects/[projectId]/page.tsx`)
  2. Authenticated route handler returning thumbnail URLs
  3. Shared helper under `src/lib/assets`
- Best fit for current architecture:
  - Keep URL signing server-side and centralize logic in `src/lib/assets` helper.
  - Call helper from server component for initial render.
  - Optional follow-up route for lazy loading/pagination if asset count grows.

## Recommended Thumbnail Strategy
### Recommended approach (v1)
1. Add a helper in `src/lib/assets` to generate short-lived signed thumbnail URLs from `(storage_bucket, storage_path)` rows.
2. Use signed URLs generated server-side with authenticated server client (not service key in browser).
3. For project asset grid:
  - Generate thumbnails only for `status='uploaded'` rows.
  - Use transform via `createSignedUrl(..., { transform: { width, height, resize, quality } })`.
4. For consent headshot display:
  - Resolve linked headshot asset metadata (`storage_bucket`, `storage_path`) and sign similarly.
5. UI rendering:
  - Extend `assets-list` rows with optional `thumbnailUrl`.
  - Consent details include optional `headshotThumbnailUrl`.
  - If URL missing/failed, fall back to current placeholder.

### Why this fits current codebase
- Reuses existing tenant-scoped DB queries and private bucket policies.
- Does not require exposing service role or changing upload flow.
- Minimal surface area: query + helper + UI render.

## Security Considerations
- Keep bucket private; never switch to public URLs.
- Keep signing on server only.
- Continue tenant/project filtering in DB queries before URL generation.
- Do not accept `storage_path` from client for signing.
- Prefer authenticated server client for read-signing where possible; avoid using service-role for thumbnail reads.
- Service role keys remain server-only (`src/lib/supabase/admin.ts` pattern).

## Performance Considerations
- Avoid signing every asset across very large lists on each request.
- Use one or more of:
  - pagination in asset list
  - limit signed URLs to visible page/window
  - short TTL (for example 60-300s) and regenerate on refresh
  - batch signing (`createSignedUrls`) when transform is not required
- Prefer transformed thumbnails over full-size downloads for large photos.
- Use lazy image loading in UI and keep placeholder fallback.

## Risks and Edge Cases
- `pending` assets:
  - object may not exist yet; do not sign or render as thumbnail.
- Missing storage object:
  - signed URL may return 404; UI should show fallback.
- Archived assets:
  - currently filtered out in project query; keep that behavior.
- Very large images:
  - avoid full-size fetches where possible; use transforms.
- URL expiry during viewing:
  - image may fail after TTL; acceptable for short-lived private URLs, with retry/refresh behavior.
- Headshots in project list vs business intent:
  - current app intentionally hides headshots from asset grid (`asset_type='photo'` filter).
  - If product requires headshot thumbnails in asset grid, this filter must be changed or a separate “Headshots” section should be introduced to avoid clutter.

## Summary
The safest path is server-side, short-lived signed thumbnail URLs from private storage, generated from tenant/project-scoped asset records, with transformed image sizes where needed. This preserves private storage and tenant isolation while replacing placeholder boxes with real thumbnails in both asset grid and consent headshot views.

