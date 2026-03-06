# 004-project-assets Research

## Goal
Enable photographers to upload and manage photos (assets) inside a project and link them to consent records (many-to-many), with minimal first implementation, strong tenant isolation, and a batch-level duplicate handling choice (upload anyway, overwrite, ignore).

## 1) Repository analysis

### Where projects, invites, consents live
- Project list + create project: `src/app/(protected)/projects/page.tsx`.
- Project dashboard (invites, consents, invite creation UI): `src/app/(protected)/projects/[projectId]/page.tsx`.
- Invite creation API: `src/app/api/projects/[projectId]/invites/route.ts`.
- Public invite + consent form: `src/app/i/[token]/page.tsx` and submit route `src/app/i/[token]/consent/route.ts`.

### Tenant scoping
- Server derives tenant via RPC: `src/lib/tenant/resolve-tenant.ts` (`current_tenant_id` / `ensure_tenant_for_current_user`).
- Queries always filter by `tenant_id` on server pages/routes.
- RLS uses membership checks (see below).

### Existing schema + RLS patterns
- Core tables (tenants, memberships, projects, subjects, consents, revoke_tokens, consent_events): `supabase/migrations/20260304151420_create_initial_tables.sql`.
- Invites + idempotency: `supabase/migrations/20260304210000_002_projects_invites_schema.sql`, `supabase/migrations/20260304212000_002_projects_invites_idempotency.sql`.
- Consent templates (global, read-only for authenticated): `supabase/migrations/20260305100000_003_consent_templates_schema.sql` and `supabase/migrations/20260305101000_003_consent_templates_rls.sql`.
- RLS policies consistently enforce tenant membership with `exists (select 1 from memberships where tenant_id = <table>.tenant_id and user_id = auth.uid())`: `supabase/migrations/20260304211000_002_projects_invites_rls.sql`.

## 2) Storage architecture (Supabase Storage)

### Bucket + object paths
- Use a private bucket, e.g. `project-assets`.
- Object path should encode tenant + project to prevent cross-tenant leakage:
  - `tenant/<tenantId>/project/<projectId>/asset/<assetId>/<originalFileName>`
  - The server generates the path; clients never choose it.

### Upload method
- Prefer **signed upload URLs** generated server-side.
- Server validates user membership and project ownership, then issues a signed upload URL scoped to a single path and short expiry.
- Client uploads directly to Storage using the signed URL.

### File limits and types
- Start minimal: allow `image/jpeg`, `image/png`, `image/webp`.
- Enforce size limits in UI + server validation (e.g. 10-25MB per file) and bucket config if supported.

## 3) Database model for assets (minimal)

### assets (proposed)
- `id uuid` PK
- `tenant_id uuid` (FK tenants)
- `project_id uuid` (FK projects)
- `created_by uuid` (FK auth.users)
- `storage_bucket text` (e.g. `project-assets`)
- `storage_path text` (object path)
- `original_filename text`
- `content_type text`
- `file_size_bytes bigint`
- `status text` (`pending`, `uploaded`, `archived`)
- `created_at timestamptz`, `uploaded_at timestamptz`, `archived_at timestamptz`
- Uniqueness: `(tenant_id, project_id, storage_path)` or global unique `storage_path`

### asset_consent_links (required for v1)
- Join table enabling many-to-many between assets and consents.
- Columns (minimal):
  - `asset_id uuid` (FK assets)
  - `consent_id uuid` (FK consents)
  - `tenant_id uuid` (FK tenants)
  - `project_id uuid` (FK projects)
  - `created_at timestamptz`
- Uniqueness: `(asset_id, consent_id)` to prevent duplicates.
- Optional: add `created_by uuid` for audit if needed.

## 4) Linking photos to consents

### Recommended v1
- **Many-to-many** via `asset_consent_links`.
- One asset can have multiple consents (multiple subjects).
- One consent can link to multiple assets.

### Implications for export / DAM
- Use `asset_consent_links` to export assets with consent snapshots; queries remain straightforward.
- This avoids schema change later when multi-subject photos are common.

### Invariant: 
-  asset_consents must only link rows within the same tenant_id and project_id (an asset cannot be linked to a consent from another project or tenant).

## 5) Security considerations

### RLS for assets table
- Mirror existing pattern: allow `select/insert/update` only for members of `tenant_id`.
- Never accept `tenant_id` from the client; derive tenant server-side and validate project ownership.

### Storage policies
- Bucket should be private; no public reads.
- Storage policy on `storage.objects` should enforce:
  - `bucket_id = 'project-assets'`
  - path prefix matches `tenant/<tenantId>/project/<projectId>/...`
  - authenticated user is a member of that `tenantId` (lookup via memberships).
- Prevent path traversal: the server generates paths; policy ensures prefix match.

## 6) Upload flow (secure, minimal)

1. Client selects files and (optional) consent links; client computes per-file hash (recommended) and sends metadata + hashes to server in create request.
2. Server validates auth + membership + project ownership.
3. Server checks for duplicates within project by hash (not filename); if any duplicates exist, respond with a summary and require a batch-level choice:
   - `upload_anyway` (default): store as new assets with unique paths.
   - `overwrite`: replace existing storage objects and update `assets` metadata.
   - `ignore`: skip duplicates and only upload new files.
4. Client sends chosen policy once; server applies it to the entire batch.
5. For non-ignored files, server creates `assets` rows with status `pending` (or updates existing rows for overwrite) and returns signed upload URLs.
6. Client uploads files directly to Storage.
7. Client calls finalize endpoint to mark `assets.status = 'uploaded'`, set `uploaded_at`, and create `asset_consent_links`.

Notes:
- Use idempotency keys for upload creation if you expect retries.
- If upload fails, keep pending rows and allow retry or cleanup job later.

## 7) Minimal UI integration

- Add an "Assets" section in `src/app/(protected)/projects/[projectId]/page.tsx` below invites.
- Include:
  - Upload button (file picker)
  - Asset list (filename, size, status, created_at)
  - Optional consent selector (only when consents exist for the project)

## 8) Risks / edge cases

- Large images: enforce client + server limits; consider resizing later.
- Duplicate uploads: detection should be hash-based; filename matching is insufficient.
- Overwrite risks: ensure overwrite only within same tenant/project and for matching hash policy.
- Partial uploads: pending rows without objects; provide retry/cleanup path.
- Deleting assets linked to consents: prefer soft delete (`archived_at`) and keep DB record for audit.
- Privacy: ensure private bucket + signed URLs for access; avoid public buckets.

## Next step
This research should feed `docs/rpi/004-project-assets/plan.md` with minimal, tenant-safe migrations, storage policy, server routes, and UI changes.
