# AGENTS.md

## Tech stack (do not change)
- Next.js (App Router) + TypeScript
- Tailwind CSS
- Supabase (Auth + Postgres)
- Prefer server-side logic (Route Handlers / Server Actions). Never trust client input.

## Setup commands
- Install: `npm install`
- Dev: `npm run dev`
- Lint: `npm run lint`
- Tests: `npm test` (if present)

## Security rules (non-negotiable)
- Enforce tenant scoping in every DB query.
- Never accept tenant_id from client; derive from auth/session/server-side lookup.
- Never expose Supabase service role key to the client.
- Use parameterized queries only.
- Prefer idempotent writes (retry-safe).

## Output expectations
- Small PR-sized changes.
- Add/update tests when behavior changes.
- Explain edge cases: retries, races, expired sessions/tokens, partial failures.
- 
## Project context
- Read CONTEXT.md before planning changes.