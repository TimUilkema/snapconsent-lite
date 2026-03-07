# 009 Matching Foundation - Plan

## Decisions
- Canonical approved-link model:
  - Use `asset_consent_links` as the single source of truth for approved manual matches.
  - Do not introduce a new approved-link table in this phase.
- Matching scope:
  - Manual matching applies to `assets.asset_type = 'photo'` only.
  - Headshot linking remains separate and unchanged.
- Workflow direction:
  - Consent-centric primary UX:
    - each consent gets a `Match assets` action
    - from that action user can:
      - upload new photos auto-linked to that consent
      - link/unlink existing uploaded project photos
- Unlink authorization:
  - Add explicit RLS `DELETE` policy for `asset_consent_links` (tenant membership).
  - Still enforce tenant/project/same-project validation in route handlers before delete.
- Revocation behavior:
  - Revoked consents remain linkable/unlinkable for history/data hygiene.
  - No consent/history deletion.

## Step-by-step execution plan

### Step 1 - DB/RLS alignment for unlink support (small migration commit)
- Files:
  - create `supabase/migrations/<timestamp>_009_asset_consent_links_delete_policy.sql`
- DB/RLS changes:
  - add `DELETE` RLS policy on `public.asset_consent_links` for authenticated tenant members, aligned with existing select/insert/update policies.
- Notes:
  - no schema table changes required.
  - keep existing PK/FK constraints unchanged.
  - - Add index for consent-centric reads:
  - `create index if not exists asset_consent_links_tenant_project_consent_idx
    on public.asset_consent_links (tenant_id, project_id, consent_id);`

### Step 2 - Server helpers for consent-centric matching reads/writes (small lib commit)
- Files:
  - create `src/lib/matching/consent-photo-matching.ts`
- Add helper functions:
  - `assertConsentInProject(...)`
  - `listMatchableProjectPhotosForConsent(...)`
  - `listLinkedPhotosForConsent(...)`
  - `linkPhotosToConsent(...)` (upsert into `asset_consent_links`)
  - `unlinkPhotosFromConsent(...)` (delete rows)
- Validation rules in helpers:
  - consent must belong to resolved tenant/project.
  - asset IDs must be photo assets in same tenant/project and uploaded/not archived.
  - link/unlink operations only target same-project rows.
  - writes are idempotent (`upsert` for link, constrained `delete` for unlink).
  - `asset_type = 'photo'`
  - `status = 'uploaded'`
  - not archived

### Step 3 - API routes for consent-centric matching (small route commit)
- Files to create:
  - `src/app/api/projects/[projectId]/consents/[consentId]/assets/matchable/route.ts`
  - `src/app/api/projects/[projectId]/consents/[consentId]/assets/links/route.ts`
- Route behavior:
  - `GET .../matchable`:
    - list matchable project photo assets for consent (search + pagination inputs: `q`, `limit`, `cursor` or `offset`).
    - include `isLinked` flag for each asset.
  - `GET .../links`:
    - list currently linked photo assets for consent.
  - `POST .../links`:
    - body `{ assetIds: string[] }`
    - validate and link with idempotent upsert.
  - `DELETE .../links`:
    - body `{ assetIds: string[] }`
    - validate and unlink idempotently.
- Security in every route:
  - require authenticated user.
  - resolve tenant via `resolveTenantId`.
  - never accept tenant from client.
  - enforce project scoping and same-project checks before writes.

### Step 4 - Consent-centric upload route behavior (small integration commit)
- Files to modify:
  - `src/app/api/projects/[projectId]/assets/route.ts`
  - `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`
  - `src/lib/assets/create-asset.ts`
  - `src/lib/assets/finalize-asset.ts`
- Changes:
  - keep existing `consentIds` support and strict validation.
  - ensure photo uploads from consent-centric flow can pass a single consent ID and finalize links automatically.
  - do not change existing business logic for generic uploads/headshots.
- Outcome:
  - new consent UI can upload photos and have them linked immediately via existing create/finalize path.

### Step 5 - Consent-centric UI entrypoint and panel (small UI commit)
- Files to modify/create:
  - modify `src/app/(protected)/projects/[projectId]/page.tsx`
  - create `src/components/projects/consent-asset-matching-panel.tsx`
  - optional small shared UI util component:
    - `src/components/projects/asset-select-list.tsx` (only if needed for cleanliness)
- UI changes:
  - add `Match assets` button in each consent detail block.
  - open a consent-scoped panel/modal with two sections:
    - `Upload new photos` (auto-link to this consent)
    - `Link existing photos` (search/select from matchable uploaded photos)
  - show `Linked photos` list in the same panel (thumbnail + filename + unlink action).
- UX behavior:
  - upload section uses existing create/finalize flow with `consentIds: [consentId]`.
  - existing-photo section supports multi-select link/unlink.
  - keep headshot replacement UI unchanged.

### Step 6 - Project asset list integration (small follow-up UI commit)
- Files to modify:
  - `src/components/projects/assets-list.tsx`
  - optionally `src/app/(protected)/projects/[projectId]/page.tsx` (if counts/indicators are added)
- Changes:
  - optionally show a simple linked-consent count badge per asset for immediate feedback.
  - do not alter primary grid scope (`photo` assets only).

### Step 7 - Verification and docs pass (final cleanup commit)
- Files:
  - update `docs/rpi/009-matching-foundation/plan.md` if implementation-level adjustments are needed.
  - optional README note if new API endpoints need mention.
- Validation:
  - run lint/tests and manual checklist below.

## API/server plan

### Listing matchable project assets for a consent
- Endpoint: `GET /api/projects/[projectId]/consents/[consentId]/assets/matchable`
- Returns:
  - uploaded, non-archived `photo` assets in same tenant/project
  - metadata for UI (`id`, `filename`, `status`, thumbnail context)
  - `isLinked` boolean per asset for this consent
- Supports:
  - search by filename (`q`)
  - bounded result size (`limit`)

### Creating links
- Endpoint: `POST /api/projects/[projectId]/consents/[consentId]/assets/links`
- Body: `{ assetIds: string[] }`
- Behavior:
  - validate consent scope
  - validate all assets are same tenant/project and photo assets
  - upsert links into `asset_consent_links`
  - idempotent on retries/duplicates

### Removing links
- Endpoint: `DELETE /api/projects/[projectId]/consents/[consentId]/assets/links`
- Body: `{ assetIds: string[] }`
- Behavior:
  - validate consent and asset scope
  - delete targeted rows with tenant/project constraints
  - idempotent if links already absent

### Consent-centric upload with automatic linking
- Reuse existing endpoints:
  - `POST /api/projects/[projectId]/assets` with `consentIds: [consentId]`
  - `POST /api/projects/[projectId]/assets/[assetId]/finalize` with `consentIds: [consentId]`
- Keep current server-side validation in `create-asset` / `finalize-asset`.

## UI plan

- Add `Match assets` action to each consent shown on project page.
- In the matching panel for a consent:
  - section A: upload new photos (multi-file optional) and auto-link to this consent
  - section B: select/link existing uploaded project photos (search + multi-select)
  - linked photos display with thumbnail + unlink control
- Keep interaction intentionally simple:
  - optimistic refresh via `router.refresh()` after writes
  - clear success/error feedback per action
  - no separate review dashboard in this phase

## Security and integrity

- Tenant/project scoping:
  - derive tenant from authenticated server session (`resolveTenantId`)
  - derive project from route params and validate membership/scope on every query
  - never trust tenant/project from client body
- Same-project enforcement:
  - check consent and assets all belong to same resolved tenant/project before link/unlink
  - rely on composite FK constraints as DB backstop
- Duplicate prevention:
  - primary key `(asset_id, consent_id)` + upsert
- Retry-safe behavior:
  - `POST` link uses upsert (safe replay)
  - `DELETE` unlink safely no-ops if row absent
- Revoked consent handling:
  - do not delete consent history
  - allow links to remain or be adjusted manually; future usage policy evaluation is separate from link persistence

## Future compatibility

- Keep `asset_consent_links` as approved/final links.
- Future facial recognition should introduce a separate candidate/review model (for example `asset_consent_match_candidates`) with confidence/status fields.
- Approval path should upsert into `asset_consent_links`, so manual and automated approvals converge on one canonical table.

## Verification checklist

1. Upload new images from a consent `Match assets` panel and confirm they auto-link to that consent.
2. Link existing uploaded project photos to a consent and confirm links appear in `Linked photos`.
3. Unlink photos from a consent and confirm links are removed.
4. Confirm one consent can be linked to many photo assets.
5. Confirm one photo asset can be linked to many consents.
6. Confirm duplicate link attempts do not create duplicate rows.
7. Confirm no cross-project/cross-tenant link creation is possible via API.
8. Confirm revoked consent remains in history and link operations do not delete consent records.
