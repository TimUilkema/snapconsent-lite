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

## Project context
Before planning or implementing changes read:

- `CONTEXT.md`
- `ARCHITECTURE.md`

These documents describe the domain model and system structure.

## UI DESIGN 
IMPORTANT:
Before making UI changes/implementations read:
- `UNCODEXIFY.MD`

## Development workflow

For any non-trivial change follow the **RPI workflow** described in:

docs/rpi/README.md

Steps:

1. Research
2. Plan
3. Implement

Research and plan documents should be created under:

docs/rpi/<feature-id>/

## Internationalization (i18n)

If the repo includes the UI language switch / i18n framework:

- Reuse the existing i18n setup for all new user-facing UI text.
- Do not introduce new hardcoded inline UI strings in components when translation keys should be used.
- Add new translation keys/messages for Dutch and English when adding new UI copy.
- Keep stored domain content unchanged; only localize UI chrome, labels, buttons, helper text, and validation copy that belongs to the app UI.
- Follow the existing translation key structure and naming conventions already used in the repo.

## Large document writing + encoding safety

When creating or updating large markdown documents (especially `research.md` and `plan.md`):

- Always write clean UTF-8 text.
- Prefer plain ASCII punctuation unless the file already intentionally uses Unicode.
- Do not introduce Windows encoding artifacts, replacement characters, or smart-quote corruption.
- If the target document is large, write it in smaller patches/sections instead of one very large write.
- Assume large single writes may hit Windows command-length limits or patch-size limits.
- Prefer incremental section-by-section updates with a final readback/verification pass.
- After writing a large document, verify the file is coherent end-to-end and that no section was truncated or corrupted.