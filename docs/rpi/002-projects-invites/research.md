# 002-projects-invites Research

## Scope
End-to-end flow to research:
1. Authenticated photographer creates a Project and sees a Project dashboard.
2. Photographer creates a Subject Invite for a Project and gets a URL suitable for QR encoding.
3. Subject opens/scans invite link (public), fills minimal consent form, submits.
4. System stores Subject + Consent under the Project.
5. System sends receipt email with signed details + revoke link.
6. Subject can revoke; revocation stops future processing and remains auditable (no deletes).

## Current Repository State

### App/auth structure
Current app already has baseline auth from `001-auth`:
- `middleware.ts` + `src/lib/supabase/middleware.ts`: session refresh via `supabase.auth.getUser()`.
- `src/lib/supabase/server.ts`: server-side Supabase client with cookie adapter.
- `src/app/login/page.tsx`, `src/app/auth/login/route.ts`, `src/app/auth/logout/route.ts`.
- Protected area exists at `src/app/(protected)/dashboard/page.tsx` guarded by `src/app/(protected)/layout.tsx`.

Implication:
- Photographer-side flows can build directly on existing protected routing/auth session patterns.
- Public invite/revoke flows must be added as explicit public routes (outside protected group).

### Database/migrations state
- Only migration file exists: `supabase/migrations/20260304151420_create_initial_tables.sql`.
- That migration file is currently empty.
- No application tables currently exist (including `tenants`, `memberships`, `projects`, `subjects`, `consents`, etc.).

Implication:
- `002-projects-invites` must introduce first real schema migration(s).
- Tenant scoping must be designed from scratch in SQL + RLS.

### Local Supabase/email setup
From `supabase/config.toml`:
- Supabase Auth is enabled.
- Local email testing service configured is **Inbucket** (`[inbucket]`, web UI on port `54324`).
- No Mailpit-specific config currently exists in this repo.

Implication:
- Local email receipt testing can be done with Inbucket immediately.
- If Mailpit is required, SMTP wiring must be added (see email section below).

## Domain Gaps for This Feature
To support project/invite/consent/revoke flow, missing pieces are:
- Tenant model (`tenants`, `memberships`) required for secure scoping.
- Project ownership and invite lifecycle tables.
- Public token-based invite + revoke mechanisms.
- Consent audit representation that never deletes records.
- Receipt email delivery and retry strategy.

## Proposed Minimal Data Model

## Prerequisite tenant/auth tables
These are required for tenant scoping and should be created if absent.

### `tenants`
- `id uuid primary key default gen_random_uuid()`
- `name text not null`
- `created_at timestamptz not null default now()`

### `memberships`
- `tenant_id uuid not null references tenants(id) on delete cascade`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `role text not null check (role in ('owner','admin','photographer'))`
- `created_at timestamptz not null default now()`
- Primary key: `(tenant_id, user_id)`

## Feature tables

### `projects`
Purpose: photographer-created container for subject invites and consents.

Suggested columns:
- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null references tenants(id) on delete restrict`
- `created_by uuid not null references auth.users(id) on delete restrict`
- `name text not null`
- `description text null`
- `status text not null default 'active' check (status in ('active','archived'))`
- `created_at timestamptz not null default now()`

Constraints/indexes:
- Index `(tenant_id, created_at desc)`
- Optional unique `(tenant_id, name)` if duplicate names should be blocked.

### `subject_invites`
Purpose: shareable public invite links/QR payloads.

Suggested columns:
- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null references tenants(id) on delete restrict`
- `project_id uuid not null references projects(id) on delete restrict`
- `created_by uuid not null references auth.users(id) on delete restrict`
- `token_hash text not null unique` (store hash, never raw token)
- `status text not null default 'active' check (status in ('active','expired','used','revoked'))`
- `expires_at timestamptz null`
- `max_uses integer not null default 1 check (max_uses > 0)`
- `used_count integer not null default 0 check (used_count >= 0)`
- `created_at timestamptz not null default now()`

Constraints/indexes:
- Index `(tenant_id, project_id, created_at desc)`
- Check `used_count <= max_uses`

### `subjects`
Purpose: canonical subject identity for a tenant/project.

Suggested columns:
- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null references tenants(id) on delete restrict`
- `project_id uuid not null references projects(id) on delete restrict`
- `email text not null`
- `full_name text not null`
- `created_at timestamptz not null default now()`

Constraints/indexes:
- Unique index on `(tenant_id, project_id, lower(email))` for dedupe.
- Index `(tenant_id, project_id)`.

### `consents`
Purpose: immutable grant record; revocation represented without deleting grant.

Suggested columns:
- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null references tenants(id) on delete restrict`
- `project_id uuid not null references projects(id) on delete restrict`
- `subject_id uuid not null references subjects(id) on delete restrict`
- `invite_id uuid not null references subject_invites(id) on delete restrict`
- `consent_text text not null`
- `consent_version text not null`
- `signed_at timestamptz not null default now()`
- `capture_ip inet null`
- `capture_user_agent text null`
- `revoked_at timestamptz null`
- `revoke_reason text null`
- `receipt_email_sent_at timestamptz null`
- `created_at timestamptz not null default now()`

Constraints/indexes:
- Unique `(invite_id)` if invite is single-use (recommended for this phase).
- Index `(tenant_id, project_id, signed_at desc)`.
- Check `revoked_at is null or revoked_at >= signed_at`.

### `revoke_tokens`
Purpose: one-time revoke link backing token, separate from invite token.

Suggested columns:
- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null references tenants(id) on delete restrict`
- `consent_id uuid not null unique references consents(id) on delete restrict`
- `token_hash text not null unique`
- `expires_at timestamptz not null`
- `consumed_at timestamptz null`
- `created_at timestamptz not null default now()`

Constraints/indexes:
- Index `(tenant_id, expires_at)`.
- One active token per consent can be enforced via unique `consent_id`.

## Auditing recommendation
For stricter auditability, add a small event table:
- `consent_events(id, consent_id, event_type, payload jsonb, created_at)`
- Record `granted` and `revoked` events.

This preserves immutable history even when `consents.revoked_at` is updated.

## Server-side vs Public Route Responsibilities

### Authenticated photographer (server-side)
Use protected routes + server-side handlers only:
- Create project (`POST /api/projects` or Server Action).
- View project dashboard (`/projects/[projectId]`, protected Server Component).
- Create invite (`POST /api/projects/[projectId]/invites` or Server Action).

Why server-side:
- Derive `auth.uid()` from session.
- Resolve tenant from memberships on server.
- Never trust client-provided tenant/project ownership.

### Public subject flow (public page + server route)
- Public invite page: `GET /i/[token]` (minimal consent form).
- Consent submit: `POST /i/[token]/consent` Route Handler.
- Public revoke page: `GET /r/[token]` (confirmation UI).
- Revoke submit: `POST /r/[token]/revoke` Route Handler.

Why Route Handlers for public writes:
- Centralized validation and token handling.
- Better control of idempotency behavior and status codes.
- Keeps DB writes and token verification server-side.

## RLS + Tenant Scoping Requirements

## Tenant derivation rule (non-negotiable)
- Never accept `tenant_id` from client payloads.
- Resolve tenant server-side as:
  - `auth.uid()` -> `memberships` -> selected tenant.

## RLS requirements
Enable RLS on all tenant-scoped tables:
- `tenants`, `memberships`, `projects`, `subject_invites`, `subjects`, `consents`, `revoke_tokens`.

Authenticated policies (photographer/admin):
- `SELECT/INSERT/UPDATE` allowed only when membership exists:
  - `exists (select 1 from memberships m where m.tenant_id = <row>.tenant_id and m.user_id = auth.uid())`

Public subject/revoke writes:
- Do not grant broad `anon` table access.
- Prefer a narrow server-side flow that validates token and performs writes atomically.
- Recommended: SQL function or transaction that derives tenant/project from token hash and writes rows without trusting client identifiers.

## Token handling requirements
- Store only hashed invite/revoke tokens (`token_hash`), never plaintext.
- Compare by hash in constant-time-safe application logic where possible.
- Expiry and single-use checks must be enforced server-side.

## Idempotency and Retry Risk Analysis

### Invite creation retries (photographer)
Risk:
- Double click / retry can create duplicate invites.

Handling:
- Add idempotency key support for create-invite endpoint.
- Persist `(tenant_id, operation, idempotency_key)` unique (dedicated table or unique key on invite request table).
- On retry, return the previously created invite URL instead of creating a second token.

### Consent double-submit (subject)
Risk:
- Subject presses submit twice or client retries after timeout.

Handling:
- Single-use invite with unique `consents.invite_id`.
- Consent creation transaction should:
  1. validate invite active/not expired/not consumed,
  2. upsert/create subject,
  3. insert consent,
  4. increment invite `used_count` and mark status `used`.
- If unique conflict on `invite_id`, return success-like response with existing consent receipt state (idempotent UX).

### Revoke clicked twice
Risk:
- User reopens revoke link or repeated POST.

Handling:
- Revoke token has `consumed_at`; first call sets it.
- Consent revoke update uses `where revoked_at is null` to avoid duplicate state mutation.
- Second call returns idempotent response (`already_revoked`), not an error leak.

### Partial failure: DB success, email send fails
Risk:
- Consent persisted but receipt email not sent.

Handling:
- Do not roll back consent for email failure.
- Persist consent first; track `receipt_email_sent_at`/status and retry email asynchronously or via manual retry endpoint/job.

## Email Receipt Delivery (Local Testing)

## Current local capability
- Supabase local config currently includes **Inbucket** (`[inbucket]`, UI on `http://127.0.0.1:54324`).
- This can be used immediately to inspect test receipt emails.

## If Mailpit is specifically required
Current repo does not include Mailpit config. Two options:
1. Keep Inbucket for local receipt verification (lowest friction).
2. Add Mailpit container and route SMTP through it (future infra change).

## Practical local test flow
1. Run local Supabase stack and app.
2. Submit consent through public invite route.
3. Confirm receipt email is emitted by app mail layer.
4. Open local inbox UI (`:54324` with current Inbucket setup) and validate:
   - subject email recipient,
   - signed consent summary content,
   - revoke link points to public revoke route.
5. Open revoke link and confirm revocation behavior + audit fields updated.

## Risks / Open Questions
- Multi-tenant UX is not yet defined (single active tenant selection strategy needed).
- Single-use vs multi-use invites must be decided before schema finalization.
- Consent text/version source of truth is not yet modeled (`consent_templates` table missing).
- Production email provider contract (SMTP/Resend/etc.) and retry mechanism are not yet selected.

## Recommended Next Step
Create `docs/rpi/002-projects-invites/plan.md` with:
- concrete migration order,
- exact routes/pages/actions to add,
- transaction boundaries for consent + revoke,
- explicit test cases for retries/races/expired tokens.
