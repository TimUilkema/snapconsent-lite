1) Decisions
- Invite model is single-use for this phase (`consents.invite_id` unique, invite transitions to `used` after first successful consent).
- Tenant scoping is mandatory for all domain tables; `tenant_id` is always derived server-side from authenticated user membership.
- Tenant bootstrap strategy: if authenticated user has no membership, first project creation bootstraps a tenant + owner membership in a server-side SQL function.
- Public invite and revoke flows use Route Handlers (not direct browser DB access).
- Invite and revoke links use random opaque tokens; only SHA-256 token hashes are stored in DB.
- Revocation is idempotent and auditable: no deletes, set `revoked_at` + append a `consent_events` row.
- Consent submit is transaction-first (persist subject/consent/revoke token before any email send).
- Receipt send is post-commit best effort; failed send does not roll back consent and is retryable.
- Local email verification uses existing Supabase Inbucket (`http://127.0.0.1:54324`), no Mailpit infra change in this feature.

2) Execution steps
1. Add schema foundation (tenant + project + invite + consent + revoke)
- What changes:
  - Create initial domain tables, constraints, indexes, and helper SQL functions for tenant resolution/bootstrap and token hashing.
- Files to create/modify:
  - `supabase/migrations/<timestamp>_002_projects_invites_schema.sql` (create)
- DB migration(s):
  - Create extension: pgcrypto (create extension if not exists pgcrypto;)
  - Create tables: `tenants`, `memberships`, `projects`, `subject_invites`, `subjects`, `consents`, `revoke_tokens`, `consent_events`.
  - Add constraints/indexes from research (including unique `consents.invite_id`).
  - Add SQL helpers:
    - `app.current_tenant_id()`
    - `app.ensure_tenant_for_current_user()`
    - (optional) app.sha256_hex(text) if hashing is done in SQL; otherwise hash in app code
- RLS changes in this step:
  - None (schema only).

2. Add RLS + policies
- What changes:
  - Enable RLS and apply tenant membership policies.
- Files to create/modify:
  - `supabase/migrations/<timestamp>_002_projects_invites_rls.sql` (create)
- DB migration(s):
  - `alter table ... enable row level security` on all tenant tables.
- RLS changes in this step:
  - Authenticated policies on tenant-scoped tables using membership existence checks.
  - No broad `anon` write policies on tenant tables.
  - Public writes remain server-mediated via route handlers/functions.

3. Add server-side domain helpers
- What changes:
  - Add small server utilities for tenant resolution/bootstrap and token generation/hash verification.
- Files to create/modify:
  - `src/lib/tenant/resolve-tenant.ts` (create)
  - `src/lib/tokens/public-token.ts` (create)
  - `src/lib/supabase/server.ts` (modify only if shared query helper wiring is needed)
- DB migration(s):
  - None.
- RLS changes in this step:
  - None.

4. Implement authenticated project creation + listing UI
- What changes:
  - Add protected projects index page and create-project action.
- Files to create/modify:
  - `src/app/(protected)/projects/page.tsx` (create)
  - `src/app/api/projects/route.ts` (create)
  - `src/app/(protected)/dashboard/page.tsx` (modify: link to projects)
- DB migration(s):
  - None.
- RLS changes in this step:
  - None.

5. Implement project dashboard + invite creation (returns URL)
- What changes:
  - Add project detail page and authenticated invite creation endpoint.
- Files to create/modify:
  - `src/app/(protected)/projects/[projectId]/page.tsx` (create)
  - `src/app/api/projects/[projectId]/invites/route.ts` (create)
  - `src/lib/idempotency/invite-idempotency.ts` (create)
- DB migration(s):
  - `supabase/migrations/<timestamp>_002_projects_invites_idempotency.sql` (create: idempotency table keyed by tenant+operation+key)
- RLS changes in this step:
  - Add policy for idempotency table (tenant membership constrained).

6. Implement public invite page + consent submit
- What changes:
  - Add public invite landing/form and consent submission route with transaction.
- Files to create/modify:
  - `src/app/i/[token]/page.tsx` (create)
  - `src/app/i/[token]/consent/route.ts` (create)
  - `src/lib/consent/submit-consent.ts` (create)
- DB migration(s):
  - None.
- RLS changes in this step:
  - None (route handler enforces token checks and server-side writes).

7. Implement receipt generation + local email adapter
- What changes:
  - Add receipt payload builder and email sender abstraction; wire send after consent commit and update `receipt_email_sent_at` on success.
- Files to create/modify:
  - `src/lib/email/send-receipt.ts` (create)
  - `src/lib/email/templates/consent-receipt.ts` (create)
  - `src/app/i/[token]/consent/route.ts` (modify)
  - `.env.example` (create/update with email config vars)
- DB migration(s):
  - None.
- RLS changes in this step:
  - None.

8. Implement public revoke page + idempotent revoke endpoint
- What changes:
  - Add revoke confirmation page and route that consumes revoke token exactly once and marks consent revoked (audit event added).
- Files to create/modify:
  - `src/app/r/[token]/page.tsx` (create)
  - `src/app/r/[token]/revoke/route.ts` (create)
  - `src/lib/consent/revoke-consent.ts` (create)
- DB migration(s):
  - None.
- RLS changes in this step:
  - None.

9. Final hardening + docs
- What changes:
  - Error shaping, rate-limit hooks/placeholders, and minimal flow docs.
- Files to create/modify:
  - `src/lib/http/errors.ts` (create)
  - `README.md` (modify: local flow + Inbucket verification)
  - `docs/rpi/002-projects-invites/plan.md` (modify if implementation deltas appear)
- DB migration(s):
  - None.
- RLS changes in this step:
  - None.

3) Critical flows (short)
- create project
  - Request: `POST /api/projects` (authenticated, JSON `{ name, description? }`).
  - Server flow: `auth.getUser()` -> resolve/ensure tenant -> insert into `projects` with derived `tenant_id` + `created_by`.
  - Response: `201 { projectId }`; `401` if unauthenticated; `400` validation; `403` membership/bootstrap failure.

- create invite (returns URL)
  - Request: `POST /api/projects/:projectId/invites` with header `Idempotency-Key`.
  - Server flow: verify project belongs to derived tenant -> idempotency lookup/create -> generate token + `token_hash` -> insert invite.
  - Response: `201 { inviteId, inviteUrl, expiresAt }`; on idempotent retry return same payload with `200`.

- public invite validation + consent submit (transaction boundaries)
  - Validate page (`GET /i/:token`): hash token, load invite, check active/not expired/not used.
  - Submit (`POST /i/:token/consent`): single DB transaction:
    1. lock invite row,
    2. verify active constraints,
    3. upsert subject,
    4. insert consent,
    5. insert revoke token,
    6. increment/close invite,
    7. insert `consent_events` row (`granted`).
  - Response: `201 { consentId }` on first success; idempotent duplicate returns `200 { consentId, duplicate: true }`; invalid/expired token returns `404` or `410`.

- receipt generation
  - After consent transaction commits: build receipt payload from consent + subject + project, send email, then set `consents.receipt_email_sent_at` if successful.
  - If send fails: keep consent valid, return success with warning flag (`receiptQueued: true`), and keep retry path server-side.

- revoke (idempotent)
  - Request: `POST /r/:token/revoke`.
  - Server flow: hash token -> lock token row -> check expiry/consumed -> set `consumed_at` if first use -> update consent `revoked_at` when null -> insert `consent_events` (`revoked`).
  - Response: first revoke `200 { revoked: true }`; repeated revoke `200 { revoked: true, alreadyRevoked: true }`; expired/invalid token `410`/`404`.

4) Verification checklist
- Commands to run:
  - `supabase db reset`
  - `npm run lint`
  - `npm run dev`

- Manual test checklist:
  1. Log in as photographer and open `/projects`.
  2. Create a project and verify it appears in list and opens dashboard.
  3. Create invite from project dashboard and verify returned invite URL is shown/copyable.
  4. Open invite URL in private/incognito window and verify public consent form renders.
  5. Submit consent once; verify success page and project dashboard shows new consent/subject.
  6. Submit same consent again (double-submit simulation) and verify idempotent outcome (no duplicate consent rows).
  7. Verify receipt email appears in local Inbucket (`http://127.0.0.1:54324`) with revoke link.
  8. Open revoke link and confirm revoke success.
  9. Re-open/re-submit revoke and confirm idempotent already-revoked response.
  10. Verify revoked consent is still present historically and marked revoked (no delete).
