# 010 Auto Face Matching - Research

## Goal
Design a first practical version of automated facial matching that can auto-link consents to project photo assets using headshots, while keeping manual unlink/link as the correction path.

## Source of truth
This research is based on current repository code and migrations (not prior RPI intent docs).

## 1) Current system analysis

### Manual matching foundation (already implemented)
- Canonical approved-link table: `public.asset_consent_links`.
- Manual consent-centric matching is implemented in:
  - `src/lib/matching/consent-photo-matching.ts`
  - `src/app/api/projects/[projectId]/consents/[consentId]/assets/matchable/route.ts`
  - `src/app/api/projects/[projectId]/consents/[consentId]/assets/links/route.ts`
  - `src/components/projects/consent-asset-matching-panel.tsx`
- Manual linking/unlinking targets `assets.asset_type = 'photo'` and uses upsert/delete on `asset_consent_links`.

### Headshot flow and storage model
- Headshot upload (public invite flow):
  - create upload asset: `POST /api/public/invites/[token]/headshot`
  - finalize upload: `POST /api/public/invites/[token]/headshot/[assetId]/finalize`
  - files are stored in private bucket `project-assets`.
- Consent submission RPC enforces and persists biometric opt-in state:
  - `app.submit_public_consent(...)` in `supabase/migrations/20260306103000_fix_submit_public_consent_headshot_ambiguity.sql`
  - if `face_match_opt_in = true`, requires an uploaded `headshot` asset and inserts link into `asset_consent_links`.
- Staff headshot replacement exists:
  - `POST /api/projects/[projectId]/consents/[consentId]/headshot`
  - only allowed when consent opted in and an existing linked headshot already exists.

### Canonical link table usage today
- `asset_consent_links` currently stores:
  - headshot<->consent links
  - photo<->consent manual matching links
- Table currently has no source/confidence/review metadata; only key/scope/timestamps.

### Review/edit UI surfaces today
- Project page: `src/app/(protected)/projects/[projectId]/page.tsx`
- Consent details surface:
  - headshot preview/status and replacement control
  - `Match assets` panel (upload auto-link/manual link/unlink for photos)
- Assets grid (`src/components/projects/assets-list.tsx`) shows:
  - photo thumbnails
  - linked consent count
  - people filter based on linked consents

## 2) Eligibility rules for automated matching

A consent/headshot is eligible for auto matching only when all are true:
- `consents.face_match_opt_in = true`
- `consents.revoked_at is null`
- a linked headshot exists via `asset_consent_links`
- linked headshot asset is:
  - same `tenant_id` + `project_id`
  - `assets.asset_type = 'headshot'`
  - `assets.status = 'uploaded'`
  - `assets.archived_at is null`
  - `assets.retention_expires_at > now()`
- project photo candidates are:
  - same `tenant_id` + `project_id`
  - `assets.asset_type = 'photo'`
  - `assets.status = 'uploaded'`
  - `assets.archived_at is null`

Important: headshot link alone must never be treated as consent. `face_match_opt_in` is the explicit legal switch.

## 3) Matching trigger strategy for ongoing projects

### Observed trigger points in current code
- New project photos become usable at photo finalize route:
  - `POST /api/projects/[projectId]/assets/[assetId]/finalize`
- New consent + headshot link becomes usable at consent submit completion:
  - `/i/[token]/consent` route after successful `submit_public_consent`
- Replaced headshot becomes usable at:
  - `POST /api/projects/[projectId]/consents/[consentId]/headshot`

### Options evaluated
- Inline matching during upload/submit requests:
  - rejected for v1 (slow requests, timeout risk, poor retry ergonomics).
- Event-driven async matching:
  - preferred baseline.
- Periodic reconciliation:
  - required as backstop for missed/failed events.

### Recommended v1 strategy
- Event-driven enqueue + async worker:
  - on photo finalize: enqueue "match this photo against eligible consents in project"
  - on consent submit with opted-in headshot: enqueue "match this consent headshot against existing project photos"
  - on headshot replacement: enqueue same consent-side rematch job
- Add periodic reconciliation job:
  - scans recent projects/assets/consents and enqueues missing jobs safely.
- Idempotent links via existing upsert in `asset_consent_links` keep retries safe.

This supports multi-day/multi-week ongoing uploads without manual reruns.

## 4) Matching result model

### Current state
- `asset_consent_links` is approved-link canonical table and should remain so.

### Recommended minimal extension
Store auto-match metadata on `asset_consent_links`:
- `link_source text` (`manual` | `auto`)
- `match_confidence numeric` (nullable)
- `matched_at timestamptz` (nullable)
- `reviewed_at timestamptz` (nullable)
- `reviewed_by uuid` (nullable -> `auth.users.id`)
- optional `matcher_version text` (nullable) for model/version reprocessing traceability

Rationale:
- keeps one canonical approved-link table
- provides auditability and UI visibility for auto links
- avoids introducing full candidate/review subsystem in this phase

### Candidate table now vs later
- For this v1, separate candidate table can be deferred.
- Below-threshold matches are dropped (not linked) in v1.
- A dedicated candidate/review table should be introduced later when explicit review queues are needed.

## 5) Threshold and review strategy (v1)

Recommended v1 behavior:
- Define strict auto-link threshold (example policy shape):
  - if `confidence >= AUTO_LINK_THRESHOLD`: insert/update link as `link_source='auto'`
  - if below threshold: do not link
- Do not require approve/reject for every result.
- Photographers review in existing UI:
  - auto links appear in normal linked-photo views
  - wrong links can be unlinked
  - missing links can be added manually

Safety note:
- Conservative threshold is required because there is no full candidate review queue yet.

## 6) Background processing architecture

### Current repo capability
- No generic queue/worker exists yet.
- There is already one internal token-protected maintenance endpoint pattern:
  - `POST /api/internal/headshots/cleanup`

### Recommended operational model
- Add DB-backed matching job queue (retryable, deduplicated).
- Add internal worker endpoint (token-protected) that:
  - claims a batch of queued jobs
  - runs matching
  - writes auto links via idempotent upsert
  - marks success/failure with retry metadata
- Add scheduler/cron to invoke worker periodically.
- Add reconciliation endpoint or job mode to backfill missed triggers.

### Idempotency/retry rules
- Queue jobs require dedupe key per scope (e.g., consent or photo scope).
- Worker must tolerate repeated execution:
  - upsert links on `(asset_id, consent_id)`
  - re-running same scope should be a no-op for existing links.
- Failed jobs should retry with capped attempts/backoff.

## 7) Security and privacy requirements

Required controls for auto matching:
- Tenant isolation:
  - every job scoped by `tenant_id` + `project_id`
  - queries always include both scopes server-side
- Biometric consent enforcement:
  - must verify `face_match_opt_in=true` at match execution time
  - must verify consent not revoked
- Retention enforcement:
  - expired/archived/missing headshots are not eligible
  - cleanup endpoint already archives/deletes expired headshots
- Private storage remains private:
  - no public bucket exposure
  - no service role key in client
- Auditability:
  - preserve source/confidence/time metadata for auto links

Important policy behavior:
- Revocation stops future matching, but historical links can remain for audit/history.
- Downstream usage/export logic (future) must also check revocation state, not only links.

## 8) UI/UX implications (minimal)

Minimum additions needed for v1:
- Show auto/manual provenance on linked photos (badge/tag in consent-linked list and optionally asset detail context).
- Keep existing manual correction tools as primary review surface:
  - unlink wrong auto links
  - add missing links manually
- Do not add full review queue in this phase.

This matches product direction: high-confidence auto-linking first, lightweight human correction in existing UI.

## 9) Edge cases

- Asset with zero linked consents:
  - valid; no auto action required.
- Asset with multiple people:
  - multiple consents can be auto-linked to one photo.
- One consent to many assets:
  - expected; auto-link may create many rows.
- Two similar-looking subjects:
  - strict threshold minimizes false links; manual unlink remains correction path.
- Bad-quality headshot:
  - low confidence leads to few/no auto links; photographer can replace headshot and re-run via triggered rematch.
- Replaced headshot:
  - rematch should enqueue automatically; v1 should avoid destructive auto-unlinking of existing links.
- Revoked consent after auto-linking:
  - keep historical links; block future matching for that consent.
- Archived assets:
  - excluded from matching candidates.
- Duplicate/replayed jobs:
  - deduped queue + link upsert keeps behavior idempotent.
- Headshot retention expiry/deletion:
  - once expired/archived, consent becomes ineligible for future auto matching.

## Current implementation gaps to close in plan phase
- No face matching engine/provider integration yet.
- No async matching queue/worker infrastructure yet.
- No auto-link metadata columns on `asset_consent_links` yet.
- No UI indication of auto vs manual links yet.
- No reconcile/backfill mechanism for missed matching events yet.
