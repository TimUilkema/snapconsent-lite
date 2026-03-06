# 006-headshot-consent Plan

## Decisions
- Keep the existing upload architecture (`assets` + `asset_consent_links` + signed upload URLs) and extend it for headshots instead of creating parallel infrastructure.
- Add explicit biometric consent state to consents:
  - `consents.face_match_opt_in boolean not null default false`.
- Classify assets by type:
  - `assets.asset_type text not null default 'photo'` with allowed values `('photo','headshot')`.
- Do not add `consents.headshot_asset_id` in v1; keep linkage in `asset_consent_links` only.
- Enforce headshot requirement server-side (authoritative), not only in UI:
  - `face_match_opt_in = true` requires a finalized headshot before consent insert succeeds.
- Allow staff headshot attachment only when consent has opted in.
- Introduce retention metadata and scheduled cleanup for headshot assets.

## Step-by-step execution plan
1. Add schema migration for consent + asset typing + retention metadata.
   - Add columns:
     - `consents.face_match_opt_in boolean not null default false`
     - `assets.asset_type text not null default 'photo'`
     - `assets.retention_expires_at timestamptz null` (for cleanup scheduling)
   - Add constraints and indexes (details below).
2. Add/adjust DB function(s) for public consent submit with headshot validation.
   - Update `app.submit_public_consent` and wrapper `public.submit_public_consent` signatures to accept:
     - `p_face_match_opt_in boolean`
     - `p_headshot_asset_id uuid default null`
   - In one transaction:
     - Validate invite token as today.
     - If `p_face_match_opt_in=true`, require valid uploaded headshot asset in same invite tenant/project with `asset_type='headshot'`.
     - Insert consent with `face_match_opt_in`.
     - Link headshot via `asset_consent_links`.
   - If PostgreSQL identifier ambiguity appears during implementation, add a follow-up migration that replaces the function without changing behavior.
3. Add public invite-token headshot upload endpoints.
   - `POST /api/public/invites/[token]/headshot`
   - `POST /api/public/invites/[token]/headshot/[assetId]/finalize`
   - Reuse shared asset creation/finalize logic with invite-derived tenant/project and `asset_type='headshot'`.
4. Extend shared server asset logic to support typed assets.
   - Update `createAssetWithIdempotency` to accept validated `assetType` (`photo|headshot`).
   - Keep existing size/type validation and duplicate-policy behavior.
5. Update public consent route + page.
   - UI: checkbox + conditional headshot upload input and privacy/retention messaging.
   - Submit includes `face_match_opt_in` and `headshot_asset_id` (if uploaded).
   - Server route passes fields to updated consent submit helper/RPC.
6. Add optional staff headshot attach path.
   - Endpoint: `POST /api/projects/[projectId]/consents/[consentId]/headshot`.
   - Validate consent scope + opt-in + headshot asset type/status before linking.
   - Optionally allow upload+attach via existing staff upload route by passing `assetType='headshot'`.
7. Add retention/cleanup execution path.
   - Add cleanup route/job (cron-driven) that finds expired headshot assets and archives/deletes storage objects safely.
   - Ensure cleanup is retry-safe and tenant-scoped.
8. Add tests and verification checks (DB + API + UI smoke).

## Data model changes

### Migration A: `*_006_headshot_consent_schema.sql`
- `alter table public.consents add column if not exists face_match_opt_in boolean not null default false;`
- `alter table public.assets add column if not exists asset_type text not null default 'photo';`
- `alter table public.assets add column if not exists retention_expires_at timestamptz;`
- Add check constraint:
  - `assets_asset_type_check`: `asset_type in ('photo','headshot')`.
- Add index for common headshot queries:
  - `create index if not exists assets_tenant_project_type_status_idx on public.assets (tenant_id, project_id, asset_type, status);`
- Add index for cleanup scan:
  - `create index if not exists assets_headshot_retention_idx on public.assets (asset_type, retention_expires_at) where asset_type = 'headshot' and retention_expires_at is not null;`

### Migration B: `*_006_headshot_consent_submit_rpc.sql`
- Replace function definitions:
  - `app.submit_public_consent(...)`
  - `public.submit_public_consent(...)`
- New RPC behavior:
  - Validate `p_face_match_opt_in`/`p_headshot_asset_id` consistency.
  - Enforce required headshot when opted in.
  - Ensure candidate headshot asset:
    - belongs to same `tenant_id` + `project_id` as invite,
    - has `asset_type='headshot'`,
    - has `status='uploaded'`,
    - is not archived.
  - Insert consent with `face_match_opt_in`.
  - Upsert link into `asset_consent_links` if headshot provided.
- Keep existing invite row locking and duplicate consent behavior unchanged.

### Migration C: `*_006_headshot_asset_policies.sql` (if needed)
- RLS table policies likely unchanged because existing `assets`/`asset_consent_links` policies are tenant-scoped and type-agnostic.
- No new table policy is required for new columns.
- No Storage policy shape change required; same bucket path structure applies.
- If cleanup route uses service role, no policy change needed. If not, add minimal policy support accordingly.

### Migration D: `*_fix_submit_public_consent_headshot_ambiguity.sql` (only if needed)
- Replace `app.submit_public_consent(...)` again if PL/pgSQL output-column names conflict with DML or `ON CONFLICT` clauses during rollout.
- Keep behavior unchanged:
  - same validation rules,
  - same consent insert behavior,
  - same headshot linking behavior.
- Purpose:
  - implementation-safe follow-up migration, not a feature change.

## API/UI plan

### API changes

#### 1) Public headshot upload (invite-token flow)
- New route: `POST /api/public/invites/[token]/headshot`
  - Input: `originalFilename`, `contentType`, `fileSizeBytes`, optional `contentHash`, optional `duplicatePolicy`.
  - Header: `Idempotency-Key` required.
  - Server steps:
    - Resolve invite via token hash and validate signable status.
    - Derive `tenant_id`/`project_id` from invite.
    - Create pending headshot asset (`asset_type='headshot'`), signed upload URL response.
  - Response: `{ assetId, signedUrl, storageBucket, storagePath }` or `{ skipUpload, duplicate }`.
- New route: `POST /api/public/invites/[token]/headshot/[assetId]/finalize`
  - Input: none (or optional metadata)
  - Server steps:
    - Validate invite context and asset ownership/type/status.
    - Finalize asset to `uploaded`.
  - Response: `{ ok: true }`.

#### 2) Public consent submit changes
- Update `src/app/i/[token]/consent/route.ts` and consent helper to pass:
  - `face_match_opt_in`
  - `headshot_asset_id` (optional)
- Update RPC invocation and types in `src/lib/consent/submit-consent.ts`.
- Error mapping:
  - missing headshot while opted-in -> `400` (`headshot_required`).
  - invalid headshot context -> `400` (`invalid_headshot`).

#### 3) Optional staff attach headshot endpoint
- New route: `POST /api/projects/[projectId]/consents/[consentId]/headshot`
  - Auth required.
  - Tenant/project resolved server-side.
  - Validate consent exists, same project/tenant, and `face_match_opt_in=true`.
  - Validate target asset is uploaded headshot in same project/tenant.
  - Upsert into `asset_consent_links`.
  - Response: `{ ok: true }`.

### UI changes

#### Public consent page (`/i/[token]`)
- Add checkbox:
  - "I consent to facial matching to help link photos where I appear."
- Conditional headshot upload field:
  - Hidden by default.
  - Appears when checkbox checked.
  - Required before submit when checked.
- Add explicit retention/privacy copy in UI text.
- Track uploaded headshot `assetId` in form state.
- Handle transitions:
  - If checked -> unchecked after upload, clear `headshot_asset_id` from submit payload (keep orphan cleanup strategy).

#### Staff UI (project page)
- Extend `AssetsUploadForm` to choose/upload `assetType='headshot'` for attachment workflows.
- Add consent-level action to attach headshot (for existing uploaded headshot assets).
- Show validation message when consent did not opt in.

## Security considerations
- Never accept `tenant_id` or `project_id` from public client payload.
- Public headshot endpoints must validate invite token and derive scope from DB invite row.
- Keep bucket private; use signed upload URLs only.
- Keep service-role access server-only.
- Enforce biometric consent semantics:
  - `face_match_opt_in` is the only source of truth for facial matching eligibility.
  - Headshot asset presence is insufficient by itself.
- Staff attach route must block links when `face_match_opt_in=false`.
- Keep all DB writes retry-safe:
  - idempotency keys for create endpoints,
  - upsert for `asset_consent_links`,
  - transaction-safe checks in consent submit RPC.
- Retention enforcement:
  - set `retention_expires_at` for headshot assets,
  - cleanup job archives/removes expired assets and storage objects,
  - on consent revocation, make linked headshot immediately ineligible for matching and eligible for accelerated cleanup.

## Verification checklist
- Migrations apply cleanly with `supabase db reset`.
- Schema checks:
  - `consents.face_match_opt_in` exists, default false, non-null.
  - `assets.asset_type` exists, default `photo`, constrained to `photo|headshot`.
  - required indexes exist.
- RPC checks:
  - `submit_public_consent` accepts new parameters.
  - `face_match_opt_in=true` + no valid headshot -> rejected.
  - `face_match_opt_in=false` -> submit succeeds without headshot.
  - valid opted-in submit links headshot in `asset_consent_links`.
- Public API checks:
  - cannot create/finalize headshot with invalid/expired/used invite token.
  - valid invite can create + finalize headshot and submit consent.
  - duplicate retries with same idempotency key are safe.
- Staff API checks:
  - attach denied when consent has `face_match_opt_in=false`.
  - attach allowed when opted in and asset is valid headshot.
  - cross-project/tenant attach attempts fail.
- UI checks:
  - checkbox toggles upload field correctly.
  - submit blocked client-side when checked and no uploaded headshot.
  - server still rejects bypass attempts.
- Retention/cleanup checks:
  - headshot assets receive retention timestamp.
  - cleanup job processes expired headshots safely and idempotently.
  - consent revocation removes subject from facial-matching eligibility immediately.
