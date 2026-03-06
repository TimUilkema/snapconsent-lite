# 003-consent-templates Plan

## 1) Decisions
No open decisions.

## 2) Step-by-step execution plan

1. Add global consent templates schema
- Files:
  - `supabase/migrations/<timestamp>_003_consent_templates_schema.sql` (create)
- DB migrations:
  - Create `consent_templates` table with `template_key`, `version`, `body`, `status`, `created_by` (nullable), `created_at`.
  - Add unique `(template_key, version)` and index `(template_key, status)`.
  - Add optional `projects.default_consent_template_id` FK to `consent_templates(id)`.
  - Add `subject_invites.consent_template_id` FK to `consent_templates(id)` (nullable in schema; enforce non-null in invite creation).
- RLS changes:
  - None in this step (schema only).
- Idempotency/race:
  - Version uniqueness enforced by unique constraint; inserts are global and explicit.

2. Add RLS for consent_templates (read-only)
- Files:
  - `supabase/migrations/<timestamp>_003_consent_templates_rls.sql` (create)
- DB migrations:
  - Enable RLS on `consent_templates`.
  - Policy: `SELECT` allowed to authenticated users only.
  - No `INSERT/UPDATE/DELETE` policies.
- RLS changes:
  - Global read-only access for authenticated users (no tenant scoping; templates are global).
- Idempotency/race:
  - No changes (policy only).

3. Seed two global templates (prototype)
- Files:
  - `supabase/migrations/<timestamp>_003_consent_templates_seed.sql` (create)
- DB migrations:
  - Insert two templates if missing (gdpr-general, avg-nl) with placeholder language and `status='active'`.
- RLS changes:
  - None (migration runs as postgres).
- Idempotency/race:
  - Use `where not exists` on `(template_key, version)` to avoid duplicates.

4. Update invite creation to select template version
- Files:
  - `src/app/(protected)/projects/[projectId]/page.tsx` (modify: include template selector)
  - `src/components/projects/create-invite-form.tsx` (modify: select template version)
  - `src/app/api/projects/[projectId]/invites/route.ts` (modify: persist `consent_template_id`)
- DB migrations:
  - None.
- RLS changes:
  - None.
- Idempotency/race:
  - Ensure `idempotency_keys.response_json` includes `consent_template_id` so retries reuse the same template version.

5. Update consent submission to source template snapshot from invite
- Files:
  - `supabase/migrations/<timestamp>_003_consent_templates_submit.sql` (create: update `app.submit_public_consent`)
  - `src/lib/consent/submit-consent.ts` (modify: remove `consent_text`/`consent_version` inputs)
  - `src/app/i/[token]/consent/route.ts` (modify: stop passing constants)
  - `src/app/i/[token]/page.tsx` (modify: display template body/version from invite lookup)
- DB migrations:
  - Update `app.submit_public_consent` to join `subject_invites.consent_template_id` -> `consent_templates` and copy `body` + `version` into `consents`.
- RLS changes:
  - None.
- Idempotency/race:
  - Read invite + template row in same transaction before inserting consent.

6. Update receipt content source
- Files:
  - `src/lib/email/send-receipt.ts` (modify if required to accept snapshot values)
  - `src/app/i/[token]/consent/route.ts` (modify to send snapshot from RPC response)
- DB migrations:
  - None.
- RLS changes:
  - None.
- Idempotency/race:
  - No change; receipt remains post-commit best effort.

## 3) Data model changes
- Add global `consent_templates` table (no `tenant_id`).
- Add optional `projects.default_consent_template_id` FK to template version.
- Add `subject_invites.consent_template_id` FK to template version (enforced in invite creation; backfill to default if needed).
- Update `app.submit_public_consent` to source `consent_text`/`consent_version` from invite -> template join, not constants.
- Seed two global templates via migration (idempotent insert).

## 4) API/UI plan (minimal)
- No template management UI in the app (global templates are read-only for now).
- Invite creation UI: add template version selector defaulting to `projects.default_consent_template_id` when set, otherwise a global default (gdpr-general v1).
- Public invite page: read template body/version via invite lookup (no constants).

## 5) Concurrency + idempotency plan
- Unique constraint on `(template_key, version)` enforces safety for any manual/admin inserts.
- Invite creation retries reuse `consent_template_id` via idempotency record.
- Consent submission remains idempotent per invite (existing behavior).

## 6) Verification checklist
- Commands:
  - `supabase db reset`
  - `npm run lint`
- Manual tests:
  1. Create invite with default template, subject signs.
  2. Confirm `consents.consent_text`/`consent_version` match the selected template snapshot.
  3. Create another invite with the other template, confirm public form shows that template.
  4. Confirm templates cannot be edited in-place (no UI; DB rows immutable unless via migration).
