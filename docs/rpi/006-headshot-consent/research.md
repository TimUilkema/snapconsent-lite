# 006-headshot-consent Research

## Goal
Add optional headshot support to consent forms, with strict enforcement that a headshot is required when the subject explicitly opts in to facial matching.

Headshots should reuse the existing asset infrastructure (`assets` + `asset_consent_links`) and remain tenant/project scoped, private, and retry-safe.

## 1) Current system analysis

### Public consent flow (invite token flow)
- Invite links are created in authenticated staff UI via `POST /api/projects/[projectId]/invites`:
  - Route: `src/app/api/projects/[projectId]/invites/route.ts`
  - Idempotent helper: `src/lib/idempotency/invite-idempotency.ts`
- Invite token generation:
  - `deriveInviteToken()` computes `HMAC_SHA256(secret, tenantId:projectId:idempotencyKey)`.
  - File: `src/lib/tokens/public-token.ts`
  - DB stores only `token_hash = sha256(token)` in `subject_invites`.
- Public invite page:
  - Route: `src/app/i/[token]/page.tsx`
  - Calls RPC `get_public_invite(p_token)` to load project/template and whether signing is allowed.
- Public consent submit:
  - Route: `src/app/i/[token]/consent/route.ts` posts full name + email.
  - Server calls `submitConsent()` wrapper (`src/lib/consent/submit-consent.ts`) -> RPC `submit_public_consent`.

### Consent creation and storage
- Canonical write path is DB function `app.submit_public_consent(...)` (latest definition in `supabase/migrations/20260305123000_fix_submit_public_consent_for_update.sql`).
- Function behavior:
  - Hashes invite token and locks invite row (`for update`) to avoid race conditions.
  - Validates invite state (active, not expired, template exists, usage remaining).
  - Upserts `subjects` by `(tenant_id, project_id, email)`.
  - Inserts `consents` row with template text/version snapshot.
  - Creates revoke token and `consent_events` record.
  - Increments invite usage and marks used when max reached.
  - Returns existing consent as `duplicate=true` if invite already consumed.
- Core schema:
  - `consents` table: `supabase/migrations/20260304210000_002_projects_invites_schema.sql`
  - Consent template integration: `supabase/migrations/20260305100000_003_consent_templates_schema.sql` and `20260305103000_003_consent_templates_submit.sql`

### Existing asset upload infrastructure

#### Tables and relationship
- `assets` table (metadata + upload lifecycle):
  - Migration: `supabase/migrations/20260305120000_004_assets_schema.sql`
  - Includes `tenant_id`, `project_id`, `storage_bucket`, `storage_path`, content metadata, `status` (`pending|uploaded|archived`), timestamps.
- `asset_consent_links` join table:
  - Same migration.
  - Composite FKs enforce same `(tenant_id, project_id)` across linked `assets` and `consents`.
  - PK `(asset_id, consent_id)` prevents duplicate links.
- Duplicate upload support:
  - `assets.content_hash`, `content_hash_algo` in `20260305150000_005_assets_content_hash.sql`

#### Create/finalize routes
- Create upload route: `src/app/api/projects/[projectId]/assets/route.ts`
  - Requires authenticated user and tenant membership.
  - Calls `createAssetWithIdempotency()` (`src/lib/assets/create-asset.ts`).
  - Uses `Idempotency-Key` header.
- Finalize route: `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`
  - Calls `finalizeAsset()` (`src/lib/assets/finalize-asset.ts`).
  - Marks asset uploaded and upserts consent links.
- Preflight duplicate route: `src/app/api/projects/[projectId]/assets/preflight/route.ts`.

#### Storage bucket structure
- Private Supabase bucket `project-assets`:
  - Migration: `supabase/migrations/20260305122000_004_assets_storage.sql`
- Storage path pattern:
  - `tenant/<tenantId>/project/<projectId>/asset/<assetId>/<sanitizedFileName>`
  - Constructed in `src/lib/assets/create-asset.ts`.
- Signed upload URLs are generated server-side with admin client:
  - `createAdminClient()` in `src/lib/supabase/admin.ts`
  - Service role key is server-only (`import "server-only"`).

### How tenant_id and project_id are derived server-side
- Authenticated staff flow:
  - `tenant_id` comes from `resolveTenantId()` -> RPC `current_tenant_id` based on `auth.uid()` membership.
  - `project_id` comes from route param and is verified with tenant-scoped query.
  - Files: `src/lib/tenant/resolve-tenant.ts`, route handlers under `src/app/api/projects/...`.
- Public invite flow:
  - No tenant/project from client.
  - RPC hashes token, looks up `subject_invites.token_hash`, and derives `tenant_id` + `project_id` from invite row.
  - DB functions: `app.get_public_invite`, `app.submit_public_consent` in migrations above.

### Safe reuse for headshots
- Reusable today:
  - `assets` table + `asset_consent_links` join model.
  - Private bucket and signed upload URL approach.
  - Metadata/file validation, duplicate detection, and idempotent create pattern.
- Gap for public self-headshot:
  - Current upload routes require authenticated membership and cannot be called by invite-token subjects.
- Safe reuse strategy:
  - Add invite-token-scoped public upload endpoints that derive invite context server-side, then call shared asset creation/finalization logic (or shared internal helper) with `asset_type='headshot'`.
  - Never accept `tenant_id` or `project_id` from client payload.

## 2) UX flows to support (v1)

### A) Subject self-headshot during consent
1. Subject opens `/i/[token]`.
2. Show unchecked checkbox:
   - "I consent to facial matching to help link photos where I appear."
3. When unchecked:
   - Hide headshot upload UI.
4. When checked:
   - Show headshot upload input (capture or file upload).
   - Show retention/privacy copy: temporary storage, project-scoped facial matching use, auto-delete after retention period.
5. Consent submit rule:
   - Must block submission unless a finalized headshot exists when `face_match_opt_in=true`.
6. Server must re-enforce rule regardless of client state.

### B) Photographer headshot attachment (staff UI)
1. After consent exists, staff uploads/attaches a headshot using existing asset infrastructure.
2. Enforcement:
   - Only allowed when consent has `face_match_opt_in=true`.
3. Same private storage/signed URL path and same tenant/project checks as normal asset uploads.

## 3) Data model changes (minimal)

### Required additions
- `assets.asset_type text not null default 'photo'`
  - Check constraint like `asset_type in ('photo', 'headshot')`.
  - Keeps extensibility for future asset classes.
- `consents.face_match_opt_in boolean not null default false`
  - Explicit consent-state source of truth for biometric usage.

### Headshot linking
- Keep linking via existing `asset_consent_links`.
- This already supports many-to-many and keeps one generalized relationship path.

### Should we add `consents.headshot_asset_id`?
- Recommendation for v1: **no dedicated column**, use join table only.
- Why:
  - Avoids dual-write consistency issues between a direct FK and join table.
  - Reuses existing asset linking infrastructure and queries.
  - Keeps schema change minimal.
- Tradeoff:
  - "At most one active headshot per consent" becomes an app/RPC rule (or trigger) rather than a simple FK constraint.
- If strict DB-level single-headshot invariant is required later, evaluate:
  - adding a dedicated pointer, or
  - trigger-based enforcement on `asset_consent_links` for `asset_type='headshot'`.

## 4) Security and privacy requirements

### Required guarantees and implementation approach
- Headshot uploads only with valid consent context:
  - Public: valid invite token that resolves to a signable invite.
  - Staff: authenticated user with tenant membership and consent/project access.
- `tenant_id` and `project_id` always server-derived:
  - From invite token lookup (public) or session membership + project check (staff).
- Private storage and signed upload URLs:
  - Continue using private `project-assets` bucket + server-issued signed upload URLs.
- Explicit biometric opt-in:
  - `consents.face_match_opt_in` is mandatory source of truth.
- Linked headshot alone does not imply consent:
  - Matching jobs must require `consents.face_match_opt_in=true` (and `revoked_at is null`).
- Defined retention + automatic deletion:
  - Headshots get retention policy (e.g., `N` days from consent signed date or earlier on revocation).
  - Scheduled deletion process removes storage object and archives/deletes associated headshot asset record per policy.

### Misuse prevention
- Cross-tenant/project linking is blocked by composite foreign keys and tenant/project-scoped queries.
- Public endpoints never trust client-provided IDs for scoping decisions.
- Staff attach endpoint rejects headshot links when `face_match_opt_in=false`.
- Facial matching pipeline must include consent-state filter, so accidental headshot links cannot bypass opt-in.

## 5) API design (minimal additions)

Prefer reusing current create/finalize logic and validation paths.

### Public flow additions
- `POST /api/public/invites/[token]/headshot`
  - Purpose: request signed upload URL for a headshot.
  - Input: filename/contentType/fileSize (and optional content hash).
  - Server resolves invite -> tenant/project; creates pending `assets` row with `asset_type='headshot'`; returns signed URL + `assetId`.
- `POST /api/public/invites/[token]/headshot/[assetId]/finalize`
  - Purpose: mark uploaded headshot complete in invite context.
  - Server validates asset belongs to invite-derived tenant/project and `asset_type='headshot'`.

### Consent submission update
- Extend public consent submit path (`/i/[token]/consent` + RPC) to accept:
  - `face_match_opt_in` boolean
  - optional `headshot_asset_id`
- In DB transaction:
  - If `face_match_opt_in=true`, require valid finalized headshot in same invite/project context before inserting consent.
  - Insert consent with `face_match_opt_in`.
  - If provided and valid, link headshot asset to new consent via `asset_consent_links`.

### Staff flow additions
- Reuse existing staff upload routes with new `assetType` payload field and headshot-specific validation.
- Add attach endpoint (minimal) for existing assets:
  - `POST /api/projects/[projectId]/consents/[consentId]/headshot`
  - Validates consent opt-in and tenant/project scope, then upserts link.

## 6) Validation rules

Enforce at both UI and server/RPC layers.

- Rule 1:
  - If `face_match_opt_in=true`, a finalized headshot must exist before consent submission succeeds.
  - Server response on violation: `400` validation error.
- Rule 2:
  - If `face_match_opt_in=false`, headshot is optional.
  - Any uploaded but unused public headshot should be cleaned up per short pending-retention policy.
- Rule 3:
  - Photographer/admin cannot attach headshot when `face_match_opt_in=false`.
  - Server response: `409` conflict (or `400` validation).
- Rule 4:
  - Headshot assets must pass existing file limits and type validation (JPEG/PNG/WEBP, <= configured max).

## 7) Edge cases and handling

- Subject checks facial matching but does not upload headshot:
  - Client blocks submit; server/RPC also rejects (authoritative).
- Subject uploads headshot then unchecks facial matching:
  - Submit allowed with `face_match_opt_in=false`, but uploaded headshot is not linked and is queued for cleanup.
- Duplicate submissions/retries:
  - Consent submit already handles duplicates via invite row lock + unique invite consent.
  - Public/staff headshot create endpoints should use idempotency keys to avoid duplicate pending assets.
- Large image uploads:
  - Enforce existing max size check before signed URL issuance.
- Unsupported file types:
  - Reuse existing MIME allowlist checks and return validation error.
- Subject revokes consent after headshot upload:
  - Revocation immediately removes consent from eligible facial matching set.
  - Retention policy should delete linked headshot early (or mark for immediate deletion).
- Photographer attaching headshot after consent:
  - Allowed only when opt-in true; if a single-headshot policy is desired, replace/archive existing headshot link deterministically.

## 8) Research outcome for next step

This feature can be implemented as a small extension of current architecture by:
- adding explicit consent state (`face_match_opt_in`),
- classifying assets (`asset_type='headshot'`),
- introducing invite-token public upload endpoints that reuse existing asset create/finalize logic,
- and enforcing opt-in + retention rules server-side (preferably transactionally in the consent submit path).

No code changes were made in this research step.
