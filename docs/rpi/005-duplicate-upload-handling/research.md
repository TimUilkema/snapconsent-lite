# 005-duplicate-upload-handling Research

## Goal
Add batch-level duplicate handling for asset uploads with a single choice applied to the entire batch: `upload_anyway`, `overwrite`, or `ignore`. Use a strict two-phase check: only compute file hashes for files whose sizes match existing assets in the same project.

## 1) Current state (assets + uploads)

### Upload flow (current)
- Client uploads each file individually: create asset + signed URL, upload, finalize.
- Code paths:
  - Create asset helper: `src/lib/assets/create-asset.ts`.
  - Finalize helper: `src/lib/assets/finalize-asset.ts`.
  - Routes: `src/app/api/projects/[projectId]/assets/route.ts`, `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`.
  - UI: `src/components/projects/assets-upload-form.tsx`.

### Data model (current)
- `assets` stores metadata but no hash.
- `asset_consent_links` provides many-to-many linking.
- Schema: `supabase/migrations/20260305120000_004_assets_schema.sql`.

### Storage (current)
- Private bucket `project-assets` with path `tenant/<tenantId>/project/<projectId>/asset/<assetId>/<originalFileName>`.
- Signed upload URLs generated server-side.

## 2) Two-phase duplicate detection (size first, hash second)

### Phase 1: size prefilter
- For a batch upload, the client sends `(filename, size, content_type)` for all files.
- Server queries existing `assets` in the same project by `file_size_bytes`.
- Only files whose sizes match at least one existing asset are candidates for hashing.

### Phase 2: hash only candidates
- Client computes `SHA-256` **only** for files flagged by the size prefilter.
- Server checks `(tenant_id, project_id, content_hash)` to confirm true duplicates.
- This avoids hashing the entire batch when most files are new.

## 3) Proposed data model additions

### Add `content_hash` to `assets`
- `assets.content_hash text not null` (or `bytea`), computed from file contents.
- Index: `(tenant_id, project_id, content_hash)` for quick duplicate lookup.
- Do **not** make it unique to allow `upload_anyway`.

Optional:
- `content_hash_algo text default 'sha256'`.

## 4) Batch policy (applies to entire upload)

When duplicates are detected, the user chooses one policy:

1. **upload_anyway** (default)
   - Create new asset rows and storage objects even if duplicates exist.
2. **overwrite**
   - Reuse existing asset rows + storage paths for matching hashes.
   - Update metadata (`original_filename`, `content_type`, `file_size_bytes`, `uploaded_at`, `status`).
   - Keep existing consent links and append new ones if provided.
3. **ignore**
   - Skip duplicates entirely.
   - Decide whether to add consent links to existing assets (open plan decision).

## 5) API flow options

### Option A: Preflight + per-file create (minimal changes)
1. Client sends preflight with file sizes only.
2. Server returns list of size-matched candidates.
3. Client hashes only those candidates and sends hashes.
4. Server returns duplicate summary; user picks policy.
5. Client uploads files using existing create/finalize routes with `duplicate_policy` and `content_hash`.

### Option B: Batch endpoint (better for large uploads)
1. Client sends batch metadata (sizes); server returns candidates.
2. Client hashes candidates and sends hashes + policy in one batch request.
3. Server returns per-file upload instructions (signed URLs / skip / overwrite targets).

## 6) Security + tenant scoping
- All duplicate checks are scoped to `(tenant_id, project_id)`.
- Never accept `tenant_id` from the client.
- `overwrite` must only target assets within the same tenant/project and matching hash.
- RLS still applies to `assets` and `asset_consent_links`.

## 7) Edge cases / risks
- Hash collisions are extremely unlikely; treat same hash as duplicate.
- Partial failures: some files upload, some skip; ensure UI shows results.
- Large batches: avoid hashing entire batch by using size prefilter.
- Retry safety: use idempotency keys for create requests.

## Next step
Create `docs/rpi/005-duplicate-upload-handling/plan.md` with the chosen API approach and schema changes for `content_hash`.