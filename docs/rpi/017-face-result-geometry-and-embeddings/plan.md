# 017 Face Result Geometry and Embeddings - Plan

## Goal

Implement the smallest production-safe feature to persist matched-face geometry and embeddings for consent-linked asset/consent pairs, so this evidence can later be exported to the DAM.

This plan keeps existing matching architecture and canonical semantics unchanged:

- queue/worker/reconcile flow remains intact
- `asset_consent_links` remains canonical approved link state
- `asset_consent_match_candidates` remains review-band latest-state store
- manual authority and suppression behavior remain unchanged
- tenant scoping and biometric opt-in gating remain unchanged

## Chosen implementation shape

1. Keep `asset_consent_match_results` as pair/job parent observability rows.
2. Add one new child table for per-face evidence rows keyed by `(job_id, asset_id, consent_id, face_rank)`.
3. Extend matcher provider contract to optionally return per-face evidence details.
4. Extend CompreFace adapter parsing to extract face-level geometry/embeddings/metadata where available.
5. Keep scalar confidence decision flow unchanged (auto threshold and review-band behavior unchanged).
6. Persist face evidence only for consent-linked outcomes, not all detected faces in all assets.

## Decisions

## 1) Schema model

Use a new table:

- `public.asset_consent_match_result_faces`

Ownership model:

- parent relationship via `(job_id, asset_id, consent_id)` to `asset_consent_match_results`
- per-face rows keyed by deterministic `face_rank` within the pair/job

## 2) Parent requirement

Matched-face evidence requires parent result persistence.

Config rule:

- `AUTO_MATCH_PERSIST_FACE_EVIDENCE=true` requires `AUTO_MATCH_PERSIST_RESULTS=true`.

Behavior:

- worker validates config before claiming jobs
- if invalid, fail fast with explicit configuration error (no job claims/writes)

## 3) Evidence scope

Persist face evidence only for consent-linked outcomes:

- `auto_link_upserted`
- `skipped_manual`

Do not persist face evidence for:

- `candidate_upserted`
- `below_review_band`
- `skipped_suppressed`

This keeps the feature bounded to consent-linked asset/subject pairs.

## 4) Scalar decision behavior

No change to current decision behavior:

- pair-level confidence drives canonical/candidate writes exactly as today
- face evidence persistence is additive and does not change threshold logic

## Q1 - Exact schema changes

Create migration:

- `supabase/migrations/<timestamp>_017_match_result_faces.sql`

Create table:

- `public.asset_consent_match_result_faces`

Columns:

- `job_id uuid not null`
- `asset_id uuid not null`
- `consent_id uuid not null`
- `face_rank integer not null`
- `tenant_id uuid not null references public.tenants(id) on delete restrict`
- `project_id uuid not null`
- `similarity numeric(5,4) not null check (similarity >= 0 and similarity <= 1)`
- `source_face_box jsonb`
- `target_face_box jsonb`
- `source_embedding jsonb`
- `target_embedding jsonb`
- `provider text not null`
- `provider_mode text not null`
- `provider_face_index integer`
- `provider_plugin_versions jsonb`
- `matcher_version text`
- `scored_at timestamptz not null default now()`
- `created_at timestamptz not null default now()`

Primary key / idempotency key:

- primary key `(job_id, asset_id, consent_id, face_rank)`

Foreign keys:

- `(job_id, asset_id, consent_id)` -> `public.asset_consent_match_results(job_id, asset_id, consent_id)` on delete cascade
- `(asset_id, tenant_id, project_id)` -> `public.assets(id, tenant_id, project_id)` on delete cascade
- `(consent_id, tenant_id, project_id)` -> `public.consents(id, tenant_id, project_id)` on delete cascade
- `job_id` -> `public.face_match_jobs(id)` on delete cascade

Indexes:

- `(tenant_id, project_id, scored_at desc)`
- `(tenant_id, project_id, consent_id, scored_at desc)`
- `(tenant_id, project_id, asset_id, scored_at desc)`
- `(tenant_id, project_id, job_id)`

RLS / grants:

- enable RLS
- no authenticated member policies
- revoke table privileges from `public`, `anon`, `authenticated`
- grant `select, insert, update, delete` to `service_role`

Retention/history:

- keep historical rows per job by default (no purge in this feature)
- future retention cleanup is explicitly out of scope

## Q2 - Should face evidence require parent result persistence?

Yes.

Reason:

- parent rows provide stable per-job pair context and decision class
- existing parent key `(job_id, asset_id, consent_id)` gives deterministic ownership and idempotency

Config/env changes:

- add `AUTO_MATCH_PERSIST_FACE_EVIDENCE=false` to `.env.example`
- add README note:
  - requires `AUTO_MATCH_PERSIST_RESULTS=true`
  - intended for internal observability/export pipelines

## Q3 - Provider contract changes

Modify matcher types in `src/lib/matching/auto-matcher.ts`:

- keep existing `AutoMatcherMatch` fields
- add optional face-evidence array, for example `faces?: AutoMatcherFaceEvidence[]`

Add face evidence types:

- box shape (`x_min`, `y_min`, `x_max`, `y_max`, `probability`)
- embedding vectors (`number[]`)
- per-face similarity
- provider metadata (`providerFaceIndex`, plugin versions)

Modify `src/lib/matching/providers/compreface.ts`:

- keep existing verification endpoint call
- parse full verification response structure when present:
  - source face box/embedding
  - target face matches with boxes/embeddings/similarity
  - plugin/version metadata if provided
- keep existing pair-level confidence extraction for threshold behavior
- return optional per-face detail payload in matcher result
- tolerate missing optional fields without throwing

## Q4 - Worker changes

Primary file:

- `src/lib/matching/auto-match-worker.ts`

Changes:

1. Add config normalization for `persistFaceEvidence`.
2. Validate config rule (`persistFaceEvidence` requires `persistResults`) before job claim.
3. Keep existing canonical/candidate/scalar result writes unchanged.
4. After parent results upsert:
   - build child face rows from bounded parent-result set only
   - include only decisions in consent-linked scope (`auto_link_upserted`, `skipped_manual`)
5. Upsert face rows with PK `(job_id, asset_id, consent_id, face_rank)`.
6. Delete stale face ranks for same pair/job not present in current write set.

Idempotency:

- deterministic key per pair/job/face rank
- replay converges via upsert + stale-rank cleanup

Partial failure handling:

- keep current retry model
- if face evidence write fails, job remains failed/retryable per existing worker behavior

## Q5 - Exact per-face data to store

Store:

- pair scope: tenant/project/job/asset/consent
- similarity per matched face
- target face box
- source face box when available
- target embedding when available
- source embedding when available
- provider (`compreface`), provider mode (`verification`)
- matcher version and provider plugin/version metadata
- scored timestamp

Vector metadata:

- store embedding arrays as JSONB
- include plugin/version metadata to interpret vector provenance
- embedding dimensionality can be inferred at export time from array length

## Q6 - Out of scope for this phase

- DAM export endpoint implementation
- backfill of historical jobs/results into face-evidence rows
- recognition-mode redesign or provider swap
- indexing every detected face in every asset
- SnapConsent-side vector search/ranking
- encryption/key-management redesign for biometric blobs
- retention purge jobs for face evidence

## Q7 - Security/privacy considerations

- Tenant isolation:
  - enforce scope columns and composite FKs
  - service-only access on evidence table
- Biometric sensitivity:
  - keep data internal-only (no member/public read policies)
  - do not add embeddings/boxes to client responses in this phase
  - avoid logging raw embeddings in app logs
- Export safety:
  - future export must apply tenant/project scoping and consent-state filtering
- Revoked consent:
  - matching remains blocked by existing gating
  - historical evidence retained unless later retention policy is introduced

## Q8 - Edge cases to handle

- duplicate job delivery:
  - no duplicate rows due deterministic PK
- retry after partial failure:
  - idempotent upsert + stale-rank cleanup converges
- headshot replacement:
  - new jobs write new evidence; history remains intact
- revoked biometric consent:
  - no new evidence for revoked consents (existing worker eligibility check)
- stale results:
  - historical evidence remains; later export selects current-valid rows
- provider payload missing fields:
  - persist scalar result and any available face fields; do not crash
- feature flag off / legacy rows:
  - no child writes when disabled
  - worker behavior remains unchanged

## Q9 - Testing strategy

Migration/schema tests:

- `supabase db reset` applies new migration cleanly
- constraints/FKs/PK/RLS/grants validate as intended

Provider parsing tests (`feature-011-compreface-preprocess.test.ts` extension):

- parse full response with source/target boxes + embeddings
- missing embedding/box fields are tolerated
- unchanged confidence extraction behavior

Worker persistence tests (new `tests/feature-017-face-evidence.test.ts`):

- with results+face-evidence enabled:
  - parent rows written
  - child rows written for consent-linked decisions only
- idempotent replay does not duplicate rows
- stale face-rank cleanup works on replay with fewer faces
- results cap (`resultsMaxPerJob`) bounds child writes to bounded parent set
- config guard enforced when face evidence enabled but parent results disabled

Regression tests:

- existing feature-011/012/013 tests remain green
- canonical link and candidate behavior unchanged

## Step-by-step implementation plan

1. Add schema migration for `asset_consent_match_result_faces`.
2. Add config getter `getAutoMatchPersistFaceEvidence()` and env/docs updates.
3. Extend matcher interfaces/types for optional face evidence payload.
4. Extend CompreFace adapter parsing to emit optional face evidence details.
5. Extend worker config validation and add face-evidence write path after parent result upsert.
6. Add deterministic stale-rank cleanup for pair/job face rows.
7. Add/extend tests for parser, worker persistence, idempotency, and regression safety.
8. Run verification:
   - `supabase db reset`
   - `npm run lint`
   - `npm test`

## Files likely to change

Database/migrations:

- `supabase/migrations/<timestamp>_017_match_result_faces.sql`

Matching code:

- `src/lib/matching/auto-match-config.ts`
- `src/lib/matching/auto-matcher.ts`
- `src/lib/matching/providers/compreface.ts`
- `src/lib/matching/auto-match-worker.ts`

Docs/env:

- `.env.example`
- `README.md`
- `docs/rpi/017-face-result-geometry-and-embeddings/plan.md`

Tests:

- `tests/feature-011-compreface-preprocess.test.ts`
- `tests/feature-013-match-results-observability.test.ts` (targeted extension where useful)
- `tests/feature-017-face-evidence.test.ts` (new)
