# 008 Asset Thumbnails - Plan

## Decisions
- Use **Option A** from research: server-side signed download URLs for thumbnails.
- Keep `project-assets` bucket private.
- Generate thumbnail URLs only for `assets.status = 'uploaded'`.
- Keep headshots out of main asset grid; show linked headshot thumbnails only in consent details.
- Use transformed signed URLs for thumbnails (`width`, `height`, `resize`, `quality`) when signing succeeds.
- Fallback to placeholder UI when signing fails or object is unavailable.

## Step-by-step Implementation Plan
1. Add thumbnail signing helper in `src/lib/assets`.
- Create `src/lib/assets/sign-asset-thumbnails.ts`.
- Add helper functions:
  - `signThumbnailUrl(...)` for one asset.
  - `signThumbnailUrlsForAssets(...)` for small lists.
- Inputs are server-derived rows (`storage_bucket`, `storage_path`, `status`, `asset_type`), not client-provided paths.
- Skip signing for non-`uploaded` assets.
- Use short TTL constant (for example `THUMBNAIL_SIGNED_URL_TTL_SECONDS = 120`).
- Use `createSignedUrl(..., { transform: { width, height, resize: "cover", quality } })`.
- Return `null` on signing errors (no hard failure of page render).

2. Extend project page data loading and thumbnail preparation.
- Modify `src/app/(protected)/projects/[projectId]/page.tsx`.
- Asset grid query:
  - Keep `asset_type = 'photo'`.
  - Include `storage_bucket` and `storage_path` in selected columns.
- Consent/headshot query:
  - Continue existing headshot-link map logic.
  - Fetch linked headshot asset metadata (`storage_bucket`, `storage_path`, `status`) for relevant consent IDs.
- Call new signing helper server-side:
  - sign photo thumbnails for asset grid rows.
  - sign headshot thumbnails for consent details.
- Build view models with optional `thumbnailUrl` fields.

3. Update asset grid UI to render thumbnails.
- Modify `src/components/projects/assets-list.tsx`.
- Extend `AssetRow` prop with optional `thumbnailUrl`.
- Replace static placeholder box with:
  - `<img>` (or `next/image` if desired) when `thumbnailUrl` exists.
  - existing placeholder box when absent.
- Add `loading="lazy"` and object-cover styling for grid thumbnails.

4. Add headshot thumbnail display in consent details.
- Modify consent details section in `src/app/(protected)/projects/[projectId]/page.tsx`.
- For consents with linked headshot:
  - render thumbnail preview in the details card.
  - keep existing text status (`Linked`, `Missing`) as fallback signal.
- If thumbnail URL is null, show compact placeholder.
- Keep `Replace headshot` action behavior unchanged.

5. Keep integration changes minimal and scoped.
- Do not add new public routes.
- Do not change upload/finalize business logic.
- Do not change bucket policies or RLS in this feature.

## Server-side Signing Approach
- Signing happens in server code only:
  - primary call site: server component `src/app/(protected)/projects/[projectId]/page.tsx`.
  - shared logic: `src/lib/assets/sign-asset-thumbnails.ts`.
- Use Supabase server client (authenticated session context) for signing where possible.
- Use transformed signed URLs for thumbnail size reduction.
- If signing fails for an asset/headshot:
  - log-safe handling in helper,
  - return `null`,
  - UI falls back to placeholder instead of breaking page render.

## UI Integration Plan
- Asset list:
  - render signed thumbnail for uploaded photos.
  - keep placeholder for pending/missing/unavailable images.
  - lazy-load thumbnails.
- Consent details:
  - show linked headshot thumbnail when available.
  - no headshot entries in main photo asset grid.
  - keep placeholder/status text fallback.

## Security and Performance Considerations
- Security:
  - tenant/project scope enforced in DB queries before signing.
  - never accept `storage_bucket`/`storage_path` from client.
  - keep service role keys server-only; never expose signing credentials.
  - bucket remains private; no public URL conversion.
- Performance:
  - short TTL on signed thumbnail URLs.
  - sign only assets rendered for current page.
  - skip non-uploaded assets.
  - use transformed thumbnails to avoid full-size downloads.

## Verification Checklist
1. Uploaded photo assets show thumbnails in project asset grid.
2. Pending or missing assets show placeholder box (no broken page).
3. Linked headshot thumbnail appears in consent details when available.
4. Main asset grid still excludes headshots.
5. No public bucket exposure (`public=false` remains; no `getPublicUrl` usage).
6. Tenant isolation intact:
  - project page for tenant A cannot render tenant B thumbnails.
7. Signing failure behavior:
  - page still renders,
  - affected item falls back to placeholder.

