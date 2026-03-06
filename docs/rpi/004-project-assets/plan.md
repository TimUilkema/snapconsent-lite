# 004-project-assets Plan

## 1) Decisions
No open decisions.

## 2) Step-by-step execution plan

1. Add assets schema + constraints
- Files:
  - `supabase/migrations/<timestamp>_004_assets_schema.sql` (create)
- DB migrations:
  - Create `assets` table with tenant/project/creator, storage metadata, status, timestamps.
  - Create `asset_consent_links` join table (many-to-many).
  - Add FK constraints to `tenants`, `projects`, `consents`, `assets`.
  - Add constraints to enforce same-tenant and same-project linkage (see section 3).
- Storage configuration:
  - None in this step.
- API/server routes:
  - None.
- UI changes:
  - None.

2. Add RLS policies for assets + join table
- Files:
  - `supabase/migrations/<timestamp>_004_assets_rls.sql` (create)
- DB migrations:
  - Enable RLS on `assets` and `asset_consent_links`.
  - Policies mirroring existing membership checks for `select/insert/update`.
- Storage configuration:
  - None.
- API/server routes:
  - None.
- UI changes:
  - None.

3. Configure Storage bucket + policies
- Files:
  - `supabase/migrations/<timestamp>_004_assets_storage.sql` (create)
- DB migrations:
  - Create bucket `project-assets` (private).
  - Add storage policies on `storage.objects`:
    - Allow authenticated members of tenant to upload/read only within `tenant/<tenantId>/project/<projectId>/...` paths.
    - Enforce `bucket_id = 'project-assets'`.
- Storage configuration:
  - Bucket creation + RLS policies for `storage.objects`.
- API/server routes:
  - None.
- UI changes:
  - None.

4. Add server routes for upload lifecycle
- Files:
  - `src/app/api/projects/[projectId]/assets/route.ts` (create: create asset + signed upload URL)
  - `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts` (create: finalize upload + link consents)
  - `src/lib/assets/create-asset.ts` (create: server helper)
  - `src/lib/assets/finalize-asset.ts` (create: server helper)
- DB migrations:
  - None.
- Storage configuration:
  - Use signed upload URLs from Supabase Storage server client.
- API/server routes:
  - POST create: validate project + consent IDs, create pending asset, issue signed URL.
  - POST finalize: verify object exists (or rely on client confirmation), set `uploaded_at`, insert `asset_consent_links`.
- UI changes:
  - None.

5. Add minimal UI to project dashboard
- Files:
  - `src/app/(protected)/projects/[projectId]/page.tsx` (modify: list assets, add upload section)
  - `src/components/projects/assets-upload-form.tsx` (create: file picker + upload flow)
  - `src/components/projects/assets-list.tsx` (create: render assets + linked consents summary)
- DB migrations:
  - None.
- Storage configuration:
  - None.
- API/server routes:
  - Call asset create + finalize routes.
- UI changes:
  - Assets section below invites, minimal list and upload button.

## 3) Data model implementation
- `assets` table:
  - Columns: `id`, `tenant_id`, `project_id`, `created_by`, `storage_bucket`, `storage_path`, `original_filename`, `content_type`, `file_size_bytes`, `status`, `created_at`, `uploaded_at`, `archived_at`.
  - Unique: `storage_path` (global) or `(tenant_id, project_id, storage_path)`.
  - FK: `(project_id, tenant_id)` references `projects(id, tenant_id)`.
- `asset_consent_links` table:
  - Columns: `asset_id`, `consent_id`, `tenant_id`, `project_id`, `created_at`.
  - Unique: `(asset_id, consent_id)`.
  - FK: `asset_id` -> `assets(id)`; `consent_id` -> `consents(id)`.
  - Constraint to enforce same tenant + project:
    - `asset_consent_links.tenant_id` and `project_id` must match both `assets` and `consents`.
    - Implement with composite FKs or a trigger check (prefer composite FK where possible).
- RLS:
  - `assets` and `asset_consent_links` policies must require membership of `tenant_id`.

## 4) Upload flow
- Asset creation endpoint:
  - POST `api/projects/[projectId]/assets` with file metadata + optional `consent_ids[]`.
  - Server resolves tenant from session, validates project ownership and consent IDs belong to same project.
  - Insert `assets` row with `status='pending'` and computed storage path.
  - Return signed upload URL + `assetId`.
- Signed upload URL generation:
  - Server uses Supabase Storage signed upload URL scoped to path with short expiry.
- Finalize upload:
  - POST `api/projects/[projectId]/assets/[assetId]/finalize` with optional `consent_ids[]`.
  - Mark `assets.status='uploaded'`, set `uploaded_at`.
  - Insert `asset_consent_links` rows (idempotent upsert).
- Idempotency:
  - Use `Idempotency-Key` for asset creation to avoid duplicate asset rows.
  - Use `on conflict do nothing` for `asset_consent_links`.

## 5) Security considerations
- Tenant scoping:
  - Never accept `tenant_id` from client; always derive server-side.
  - Validate project + consent IDs belong to resolved tenant and same project.
- Storage bucket policy:
  - Private bucket; signed URLs only.
  - Policy enforces `bucket_id='project-assets'` and path prefix with tenant/project.
- Cross-tenant prevention:
  - RLS on `assets` + `asset_consent_links`.
  - Storage policy blocks write/read outside allowed prefix.

## 6) Verification checklist
- Commands:
  - `supabase db reset`
  - `npm run lint`
- Manual test flow:
  1. Create project, upload an image asset.
  2. Link the asset to an existing consent (or none).
  3. Verify asset list shows in project dashboard.
  4. Confirm another tenant cannot access or list the asset.
