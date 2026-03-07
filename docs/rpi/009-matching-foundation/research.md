# 009 Matching Foundation - Research

## Goal
Add manual matching of consent forms to photo assets within a project as the foundation for later facial-recognition-assisted matching.

## Source of truth
This research is based on current repository implementation (migrations + route handlers + UI), not prior RPI intent docs.

## 1) Current state analysis

### Data model and constraints
- `assets` and `asset_consent_links` are defined in:
  - `supabase/migrations/20260305120000_004_assets_schema.sql`
  - `supabase/migrations/20260306100000_006_headshot_consent_schema.sql`
- `assets` has:
  - tenant/project scoping: `tenant_id`, `project_id`
  - lifecycle: `status in ('pending','uploaded','archived')`
  - type: `asset_type in ('photo','headshot')`
  - composite uniqueness: `(id, tenant_id, project_id)`
- `asset_consent_links` has:
  - primary key `(asset_id, consent_id)` (duplicate link prevention)
  - `tenant_id`, `project_id` columns
  - composite FKs:
    - `(asset_id, tenant_id, project_id) -> assets(id, tenant_id, project_id)`
    - `(consent_id, tenant_id, project_id) -> consents(id, tenant_id, project_id)`
- `consents` has `face_match_opt_in` and unique constraints including `(id, tenant_id, project_id)`.

### Existing asset/consent linking behavior
- Link creation is already implemented in upload flows:
  - `src/lib/assets/finalize-asset.ts` upserts into `asset_consent_links` when `consentIds` are provided.
  - `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts` exposes finalize for staff.
- Current photo upload UI always sends `consentIds: []`:
  - `src/components/projects/assets-upload-form.tsx`
- Headshot linking uses the same join table:
  - public consent submit RPC inserts headshot link when opted in:
    - `supabase/migrations/20260306101000_006_headshot_consent_submit_rpc.sql`
  - headshot replacement for staff:
    - `src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts`

### Current UI surfaces
- Project page:
  - `src/app/(protected)/projects/[projectId]/page.tsx`
- Assets area:
  - photo-only grid (`asset_type = 'photo'`), thumbnails in `src/components/projects/assets-list.tsx`
  - no manual consent-link controls yet
- Consent details:
  - shown per used invite in project page
  - currently focused on consent metadata + headshot status/preview/replacement
  - no general linked-photo management from consent view

### Tenant/project derivation (server-side)
- Authenticated staff routes:
  - derive tenant via `resolveTenantId()` -> RPC `current_tenant_id`
  - `projectId` from route params
  - example: `src/app/api/projects/[projectId]/assets/route.ts`
- Public invite routes:
  - derive tenant/project from invite token via `resolvePublicInviteContext()`
  - example: `src/app/api/public/invites/[token]/headshot/route.ts`
- No trusted client-provided `tenant_id` path is used in existing code.

## 2) Relationship model verification

### Many-to-many support
- Current schema already supports true many-to-many:
  - one consent -> many assets (multiple rows with same `consent_id`)
  - one asset -> many consents (multiple rows with same `asset_id`)

### Is `asset_consent_links` sufficient?
- Yes for manual foundation v1. No new core relationship table is required.
- Existing join table is already the canonical approved link model.
- Important semantic note:
  - table currently stores both headshot links and future photo-person links
  - consumers must filter via `assets.asset_type` when needed (`photo` vs `headshot`)

### Integrity constraints
- Same tenant/project enforcement is already strong via composite FKs and route-level validation.
- Duplicate links are prevented by PK `(asset_id, consent_id)`.
- Gap to address in planning:
  - RLS currently has `select/insert/update` policies for `asset_consent_links` but no `delete` policy in `20260305121000_004_assets_rls.sql`
  - manual unlink needs explicit delete authorization path (policy or security-definer function/route using admin with strict checks).

## 3) Minimum manual linking workflows

### Asset-centric
- For a photo asset: view linked consents/subjects.
- Add one or multiple consent links.
- Remove one or multiple consent links.

### Consent-centric
- For a consent: view linked photo assets (not headshots).
- Add/remove photo links from this consent context.

### Bulk operations
- Bulk add/remove from one asset to many consents is useful immediately.
- Bulk across many assets can be deferred.

## 4) UI/UX foundation recommendation

### Minimal high-value UI
- Keep current project assets grid.
- Add per-asset action: `Match subjects` (modal or drawer).
- In that panel:
  - show current linked subjects/consents
  - searchable multi-select of project consents
  - `Save matches` (upsert links) and `Remove selected`
- In consent details:
  - add `Linked photos` section with thumbnail list and unlink controls
  - optional `Add photos` entrypoint reusing same linking API

### Why this is the best baseline now
- Builds on current project page without introducing a separate review area yet.
- Gives immediate operational value for manual tagging.
- Reuses the exact data model that automated matching should eventually write into after review.

## 5) API / server-side design (minimum)

### Required capabilities
- List matchable consents for a project (searchable).
- List links for an asset and linked assets for a consent.
- Create links (idempotent).
- Remove links (idempotent).

### Minimal route shape (aligned with existing route style)
- `GET /api/projects/[projectId]/consents/matchable?q=...`
  - returns consents + subject info (+ revoked status)
- `GET /api/projects/[projectId]/assets/[assetId]/links`
  - returns linked consents
- `POST /api/projects/[projectId]/assets/[assetId]/links`
  - body: `{ consentIds: string[] }`
  - behavior: validate scope, upsert links
- `DELETE /api/projects/[projectId]/assets/[assetId]/links`
  - body: `{ consentIds: string[] }`
  - behavior: validate scope, delete links
- Optional consent-centric read endpoint:
  - `GET /api/projects/[projectId]/consents/[consentId]/assets?assetType=photo`

### Validation requirements
- Asset must exist in tenant/project and should be `asset_type='photo'` for manual matching UI.
- All consent IDs must belong to same tenant/project.
- Never accept client tenant scope.

## 6) Security and integrity analysis

- Tenant isolation:
  - route-level tenant derivation + tenant/project filters
  - DB-level RLS and composite FK scoping
- Same-project enforcement:
  - should be validated in handler before writing
  - DB FK also enforces consistency
- Retry safety:
  - link creation via upsert on `(asset_id, consent_id)` is retry-safe
  - unlink via delete is naturally idempotent
- Duplicate prevention:
  - guaranteed by PK
- Revocation handling:
  - revocation updates `consents.revoked_at` and keeps historical consent data
  - linked records should remain for audit/history; future usage gating should evaluate revocation separately
  - this aligns with existing revocation design (no consent deletion).

## 7) Future compatibility with facial recognition

### Recommended compatibility pattern
- Keep `asset_consent_links` as approved/final matches.
- Add future candidate workflow in separate table, for example:
  - `asset_consent_match_candidates`
  - fields like `asset_id`, `consent_id`, `confidence`, `source`, `status`, `reviewed_by`, timestamps
- Automated matcher writes candidates.
- Reviewer approves/rejects candidates.
- Approval writes/upserts into `asset_consent_links`.

### Benefit
- Manual and automated flows converge on one canonical approved-link table.
- No redesign required for current manual matching model.

## 8) Edge cases

- Asset with zero linked consents:
  - valid; show `No linked subjects`.
- Asset with multiple people:
  - multiple links allowed.
- Consent linked to zero assets:
  - valid; show `No linked photos`.
- Duplicate link attempts:
  - no-op due PK/upsert.
- Unlink after revocation:
  - should be allowed from data-management perspective; historical consent remains.
- Archived assets:
  - currently hidden from main grid; decide whether unlink remains possible in detail/admin views.
- Headshots vs normal photos:
  - manual matching UI should target `asset_type='photo'`.
  - headshot link behavior remains dedicated to facial-match consent flows.

## 9) Implementation-relevant files for next phase

- Schema/RLS context:
  - `supabase/migrations/20260305120000_004_assets_schema.sql`
  - `supabase/migrations/20260305121000_004_assets_rls.sql`
  - `supabase/migrations/20260306100000_006_headshot_consent_schema.sql`
- Existing link logic:
  - `src/lib/assets/finalize-asset.ts`
  - `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`
- Project UI surfaces:
  - `src/app/(protected)/projects/[projectId]/page.tsx`
  - `src/components/projects/assets-list.tsx`
  - `src/components/projects/assets-upload-form.tsx`
