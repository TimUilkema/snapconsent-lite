# 003-consent-templates Research

## Scope
Add consent templates with versioning so photographers can select approved text, invites capture a specific version, and consents store immutable snapshots of what was signed.

## Current State (Consent Text/Version)
- Consent text and version are hardcoded in `src/lib/consent/constants.ts` as `DEFAULT_CONSENT_TEXT` and `DEFAULT_CONSENT_VERSION`.
- The public invite form displays those constants in `src/app/i/[token]/page.tsx`.
- Consent submission passes those constants in `src/app/i/[token]/consent/route.ts` and writes them into `consents` via the `app.submit_public_consent` SQL function.
- `app.submit_public_consent` is defined in `supabase/migrations/20260304210000_002_projects_invites_schema.sql` and inserts `p_consent_text` + `p_consent_version` into `public.consents`.

Implication: the system already stores snapshots in `consents`, but there is no template entity or version management. Template values are currently static constants.

## Proposed Schema (Minimal)

### Decision: Global template catalog (no tenant_id)
Use a single global `consent_templates` table where each version is its own row, grouped by a stable `template_key`. Templates are managed by the application (not by photographers). This keeps schema minimal and avoids tenant-specific edits.

### `consent_templates`
- `id uuid primary key default gen_random_uuid()`
- `template_key text not null` (stable identifier, e.g. `gdpr-general`)
- `name text not null` (display name)
- `version integer not null` (monotonic per `template_key`)
- `body text not null` (template text shown to subject)
- `status text not null default 'active' check (status in ('draft','active','retired'))`
- `created_at timestamptz not null default now()`

Constraints/indexes:
- Unique `(template_key, version)`
- Index `(template_key, status)`

Immutability strategy:
- Never update `body` or `version` once created. Updates create a new row with an incremented version.
- Enforce with application rules plus optional DB trigger to block updates when `body` or `version` would change.

## How Templates Attach

### Project defaults (optional)
Add optional `projects.default_consent_template_id` referencing a specific template version row.
- If set, invite creation uses that template version by default.
- If not set, the UI should require explicit selection.

### Invites
Add `subject_invites.consent_template_id` referencing the template version row chosen at invite creation time.
- This ensures the invite always points to a specific version.

### Consents
Continue storing immutable snapshot values in `public.consents`:
- `consent_text` and `consent_version` should be copied from the invite’s template at time of consent submission.
- This preserves what was signed even if templates are retired later.

## RLS + Tenant Scoping
- `consent_templates` is global and should be read-only for normal users.
- If RLS is enabled on `consent_templates`, allow `SELECT` and disallow `INSERT/UPDATE/DELETE` for authenticated users.
- Never accept `tenant_id` from the client for any tenant-scoped table; derive it server-side from the authenticated user.
- Avoid direct client writes to template tables; template rows are managed by migrations only (for now).

## Server-Side vs Public

### Protected (server-side only)
- Template selection for projects/invites (read-only list of global templates).
- Project default template assignment (optional).
- Invite creation selecting a template version.

### Public
- Invite view and consent submission remain public, but they only read template content via invite -> template_id.
- Public routes should never modify templates.

## Idempotency and Race Risks
- Template version creation: concurrent updates could produce duplicate version numbers.
  - Mitigation: use a transaction that computes next version with `SELECT max(version) FOR UPDATE` on `template_key`, then insert.
  - Unique constraint on `(template_key, version)` enforces safety.
- Invite creation: store `consent_template_id` at invite creation time; retries should not change the chosen version (reuse idempotency key).
- Consent submit: should read template details from the invite row inside the same transaction that writes `consents` to avoid mismatch.

## Seeding for Prototyping
Seed two templates globally via migration:
- `gdpr-general`: placeholder text describing general EU GDPR consent.
- `avg-nl`: placeholder text describing Dutch AVG-flavored consent.

Notes:
- Use placeholder language; do not claim legal compliance.
- Keep seeding idempotent: only insert if no row exists for the template/version pair.

## Integration Touchpoints
- Receipt email already uses `consent_text` / `consent_version` stored in `consents`; no change needed except to ensure those fields are populated from template versions.
- Revoke flow remains unchanged (revocation does not delete templates or consents).

## Minimal PR Impact Summary
- Add one new table (`consent_templates`) and optional FK columns on `projects` + `subject_invites`.
- Add server-side template selection UI (read-only list) and default selection.
- Update invite creation to require a template version and store `consent_template_id`.
- Update consent submission to copy template snapshot into `consents`.
