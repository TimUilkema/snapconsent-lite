# 005-duplicate-upload-handling Plan

## Decisions
- API approach: **Option A (preflight + per-file create/finalize)** to minimize changes and reuse existing routes.
- `ignore` policy: **skip duplicates entirely** (no upload and no DB changes for duplicates).
- `overwrite` policy: **archive existing duplicate asset(s)** and upload a new replacement asset.
- Always hash **all** selected files client-side to ensure immediate duplicate detection (even when no size matches exist yet).

## Step-by-step execution plan
1. **Schema: add content hash to assets**
   - Files: `supabase/migrations/<timestamp>_005_assets_content_hash.sql`
   - DB migrations:
     - Add `assets.content_hash text` (nullable; only set when hash is computed for candidates).
     - Optional `assets.content_hash_algo text default 'sha256'`.
     - Add index `(tenant_id, project_id, content_hash)`.
   - Security considerations:
     - No client-provided `tenant_id`.

2. **Server: preflight route for size candidates**
   - Files:
     - Create `src/app/api/projects/[projectId]/assets/preflight/route.ts`.
     - Update `src/lib/assets/create-asset.ts` if shared helper needed.
   - API changes:
     - POST `.../assets/preflight` with `{ files: [{ name, size, contentType, contentHash }] }`.
     - Server resolves tenant from session, queries `assets` by `content_hash` within the project, and returns duplicate hashes.
   - Security considerations:
     - Tenant/project scoped query only; no client-trusted tenant_id.

3. **Server: duplicate detection + policy handling**
   - Files:
     - Update `src/lib/assets/create-asset.ts`.
     - Update `src/app/api/projects/[projectId]/assets/route.ts`.
     - Update `src/lib/assets/finalize-asset.ts`.
     - Update `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`.
   - API changes:
     - Accept `content_hash`, `content_hash_algo`, and `duplicate_policy` (`upload_anyway`, `overwrite`, `ignore`).
     - If `content_hash` is provided, check for existing assets by `(tenant_id, project_id, content_hash)`.
       - `upload_anyway`: create a new asset row and proceed as normal.
       - `overwrite`: mark existing duplicate asset(s) as archived, then create a new asset row for replacement upload.
       - `ignore`: return `skip_upload: true` and do not create or modify any DB rows for the duplicate.
   - Idempotency:
     - Reuse existing idempotency key behavior per file.
     - Ensure create route is safe to retry (same key returns same decision/result).
   - Security considerations:
     - Overwrite/ignore only allowed when hash match is within same tenant/project.

4. **Client: two-phase flow + batch policy**
   - Files:
     - Update `src/components/projects/assets-upload-form.tsx`.
   - UI changes:
     - Compute SHA-256 for **all** files using `crypto.subtle.digest`.
     - Send hashes to preflight to detect duplicates.
     - If duplicates found, ask once for batch policy and apply to all files.
     - For `ignore`, skip upload and skip finalize for those files.
   - Security considerations:
     - Do not include tenant_id in any client requests.

5. **Edge cases + docs**
   - Files:
     - Update `docs/rpi/005-duplicate-upload-handling/plan.md` only if implementation changes are required.
   - Edge cases:
     - Mixed batch (some duplicates, some new).
     - Size matches but hash mismatch (treat as new).
     - Retries after partial uploads.

## Data model changes
- Migration: `supabase/migrations/<timestamp>_005_assets_content_hash.sql`
  - Add `content_hash` to `assets` (nullable).
  - Optional `content_hash_algo` default `sha256`.
  - Add index `(tenant_id, project_id, content_hash)`.

## Upload flow
1. Client hashes all files.
2. Client POSTs hashes to `.../assets/preflight`.
3. Server returns duplicate hashes.
4. Client submits per-file create with `content_hash` and chosen `duplicate_policy`.
5. Server decides: create new asset, archive+replace, or ignore.
6. Client uploads only when required, then calls finalize.
7. Finalize links consents and marks uploaded/overwritten.

## Security and tenant isolation
- Duplicate detection always scoped to `(tenant_id, project_id)` derived server-side.
- `overwrite` only allowed when a hash match exists in the same tenant/project; archives the old asset(s) and creates a new replacement.
- RLS remains enforced; no client-trusted tenant IDs.

## Verification checklist
- Commands:
  - `supabase db reset`
  - `npm run lint`
- Manual tests:
  - Upload batch with no duplicates ? all uploaded.
  - Upload batch with duplicates and choose `upload_anyway` ? duplicates stored as new assets.
  - Upload batch with duplicates and choose `overwrite` ? existing assets archived; new replacement assets created.
  - Upload batch with duplicates and choose `ignore` ? no upload and no DB changes for duplicates.
