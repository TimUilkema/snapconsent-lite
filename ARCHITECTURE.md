# ARCHITECTURE.md

## Purpose
This repository is a simplified “SnapConsent Lite” app built primarily to practice AI-assisted development workflows (Codex) on a realistic web stack.

The architecture prioritizes:
- repeatability (fresh clone works)
- security-by-default
- small, reviewable changes
- database-backed invariants (RLS, migrations)
- retry-safe/idempotent writes (offline + agent retries)

## Tech Stack
- Next.js (App Router) + TypeScript
- TailwindCSS
- Supabase:
    - Postgres
    - Auth
    - Row Level Security (RLS)
- Local dev:
    - Supabase CLI + Docker
    - Migrations in `supabase/migrations`

## High-Level Components
### Web App (Next.js)
- UI pages/components live in `src/app` and `src/components`.
- Server-side logic lives in:
    - Route Handlers (`src/app/api/**/route.ts`) and/or
    - Server Actions (when appropriate)
- The client should never contain security-critical logic.

### Data Layer (Supabase Postgres)
- Schema changes are done via migrations.
- RLS enforces tenant scoping and access control.
- Writes should be designed to be retry-safe.

### Auth
- Supabase Auth provides identity.
- The server derives the current user from session/cookies.
- Never trust any client-provided `tenant_id`.

## Domain Model (Lite)
This is intentionally minimal and may evolve.

- `tenants`
- `memberships` (user ↔ tenant)
- `subjects` (people who give consent)
- `consent_templates` (what is being requested)
- `consents` (immutable audit record of granted consent + possible revocation)

### Key Invariants
- Consent records are never deleted (revocation is an update + audit).
- Revocation stops future processing only.
- All domain data is tenant-scoped.
- All access control is enforced server-side + with RLS.

## Data Access Patterns
### Preferred pattern
- UI calls server endpoints (Route Handlers / Server Actions).
- Server uses Supabase server client to query/write.
- DB enforces rules using RLS and constraints.

### Outbound email pattern
- Outbound email is a canonical server-side pattern, not a route-local side effect.
- Feature code should enqueue typed jobs through `src/lib/email/outbound/` and keep per-email content in the centralized registry/renderer structure.
- Durable email state lives in Postgres and follows the repo's retry-safe async pattern: enqueue, optional immediate dispatch, and token-protected internal worker retry.
- Email links sent outside the app must reuse the existing external-origin helpers backed by `APP_ORIGIN`.
- Feature code should not import transport or provider details directly unless the email foundation itself is being changed.

### What to avoid
- Direct writes from the browser to tenant-scoped tables unless RLS and policies are proven correct.
- Relying on client-side validation for security decisions.

### Parameterization / SQL safety
- Use parameterized queries / query builder APIs.
- Do not concatenate SQL strings with user input.

## Multi-Tenancy
### Principle
Tenant scoping is enforced at every layer:
- API layer: derive tenant from authenticated user + membership.
- DB layer: RLS policies require tenant membership.

### Tenant resolution
- Never accept `tenant_id` from the client.
- Resolve as:
    - `auth.uid()` → membership → tenant
- If a user belongs to multiple tenants, pick one:
    - explicitly via a server-side “active tenant” selection (future),
    - or default to the oldest/only membership (initially).

## Idempotency & Offline/Retry Safety
Agents and offline clients may retry requests. All writes should tolerate duplicates.

### Patterns
- Prefer `insert ... on conflict do update` semantics (or Supabase upsert).
- Use deterministic ids when appropriate (UUIDs created server-side).
- For actions that must only happen once, use an idempotency key table:
    - `(tenant_id, idempotency_key)` unique

### Typical failure modes to handle
- request retried after network drop
- partial failure (DB write succeeded, client never received response)
- double click / duplicate submission
- concurrent writes causing race conditions

## API Design Conventions
- Route Handlers should be explicit about:
    - auth required vs public
    - tenant scoping
    - input validation
    - error shaping (no internal details leaked)

### Recommended responses
- 200/201 for success
- 400 for validation errors
- 401 for unauthenticated
- 403 for authenticated but unauthorized
- 404 only when safe (avoid leaking existence across tenants)
- 409 for conflict / idempotency collision

## Security Checklist (Default Expectations)
- RLS enabled on all tenant-scoped tables.
- Policies written and tested (at least basic “can’t read other tenant”).
- Tokens/links (if used later) must expire and be single-use when possible.
- Rate limit auth and any public endpoints.
- Do not log secrets.
- `.env.local` is never committed.

## Testing Strategy (Lite)
Minimum:
- schema + RLS sanity tests by running:
    - `supabase db reset`
    - smoke tests for critical flows

As the app grows:
- unit tests for domain logic
- integration tests for API routes
- RLS tests (separate database role sessions)

## Repository Conventions
- `AGENTS.md` contains instructions for Codex.
- `CONTEXT.md` describes the product at a high level.
- `ARCHITECTURE.md` explains how the system is structured and why.
- RPI workflow docs live in `docs/rpi/<feature-id>/`.

## Change Management
- Small PR-sized increments.
- Migrations must be included for any schema changes.
- Update docs when architecture or invariants change.
- Prefer explicit modeling over hidden logic.
- 
## Internationalization (i18n)

If the repo includes the UI language switch / i18n framework:

- Reuse the existing i18n setup for all new user-facing UI text.
- Do not introduce new hardcoded inline UI strings in components when translation keys should be used.
- Add new translation keys/messages for Dutch and English when adding new UI copy.
- Keep stored domain content unchanged; only localize UI chrome, labels, buttons, helper text, and validation copy that belongs to the app UI.
- Follow the existing translation key structure and naming conventions already used in the repo.
