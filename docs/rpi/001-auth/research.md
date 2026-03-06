# 001-auth Research

## Scope
Implement Supabase authentication for:
- login
- logout
- protected route
- middleware session refresh

This document captures repository state and what is required before implementation.

## Current Repository State

### App structure
- Next.js App Router scaffold only.
- `src/app/page.tsx` is the default starter page.
- No auth pages, no protected pages, no route handlers, no server actions.
- No `middleware.ts` exists.
- No Supabase client utilities exist in `src/lib` (or elsewhere in `src`).

### Dependencies
From `package.json`:
- `@supabase/ssr` is installed.
- `@supabase/supabase-js` is installed.
- Next.js `16.1.6`, React `19.2.3`.

Implication: all required packages for SSR auth integration are already present.

### Environment configuration
From `.env.local`:
- `NEXT_PUBLIC_SUPABASE_URL` exists.
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` exists.
- `SUPABASE_SERVICE_ROLE_KEY` exists.
- `SECRET_KEY` exists.

Security observation:
- Service role key exists server-side only (correct), but implementation must ensure it is never imported into client bundles.
- For login/logout/protected-route + middleware refresh, service role is not required; anon key + user session should be enough.

### Supabase local config
From `supabase/config.toml`:
- Auth enabled.
- Email signups enabled.
- Email confirmations disabled locally (`enable_confirmations = false`), so password login can work without email verification in local dev.
- JWT expiry is 1 hour.
- Refresh token rotation enabled.
- Site URL points to `http://127.0.0.1:3000`.

Implication:
- Session refresh behavior is relevant and should be wired in middleware.
- Token rotation/reuse interval means concurrent refreshes and race handling matter.

### Database/migrations
- Only migration file: `supabase/migrations/20260304151420_create_initial_tables.sql`.
- That migration file is currently empty (0 bytes).
- No tenant/membership/consent tables currently exist.
- No RLS policies currently exist in repository migrations.

Implication:
- Auth (identity/session) can still be implemented against Supabase Auth immediately.
- Tenant-scoped authorization logic for domain tables cannot be fully enforced yet because schema/policies are not created.

## Architecture and Constraint Alignment

From `AGENTS.md` + `ARCHITECTURE.md` + `CONTEXT.md`:
- Never trust client input.
- Prefer server-side logic (route handlers/server actions).
- Tenant scoping required for every DB query.
- Never accept `tenant_id` from client.
- Supabase Auth is identity source; server derives current user from cookies/session.

For this feature:
- Login/logout should be implemented through server-controlled flow or carefully constrained client calls.
- Protected routes must validate session server-side.
- Middleware should refresh auth session cookies to keep SSR/session consistent.
- Any future tenant lookup must derive from authenticated user (`auth.uid()` -> membership), not request payload.

## Existing Gaps to Fill for 001-auth

1. Supabase client helpers are missing
- Need SSR-safe server client helper for Server Components/Route Handlers.
- Need browser client helper for login form interactions (if using client-side form submission).
- Need middleware client helper for cookie sync/refresh.

2. Auth UI/routes are missing
- Need login entry point (e.g., `/login`) with email/password form.
- Need a post-login destination (e.g., `/app` or `/dashboard`) to validate protected access.

3. Logout flow is missing
- Need sign-out endpoint or server action.
- Must clear session cookies and redirect predictably.

4. Protected-route enforcement is missing
- Need server-side guard that checks `getUser()`/session and redirects unauthenticated users to `/login`.
- Should avoid trusting only client state.

5. Middleware refresh is missing
- Need root `middleware.ts` that creates Supabase middleware client and refreshes session via auth call.
- Need matcher to exclude static assets and optionally public auth paths.

6. Auth callback handling may be needed
- If implementation includes OAuth/magic link later, callback route is needed.
- For email/password only, callback route is optional for initial scope.

## Recommended Implementation Shape (for planning)

### Files likely required
- `src/lib/supabase/server.ts`
- `src/lib/supabase/client.ts`
- `src/lib/supabase/middleware.ts` (or equivalent helper)
- `middleware.ts`
- `src/app/login/page.tsx`
- `src/app/(protected)/...` page(s) or a protected sample page
- `src/app/auth/logout/route.ts` or equivalent server action

### Flow requirements
- Login:
  - Accept email/password.
  - Use Supabase auth sign-in.
  - On success, redirect to protected page.
  - On failure, return generic error (avoid account enumeration details).
- Logout:
  - Invalidate session with Supabase.
  - Redirect to `/login` (or public landing).
- Protected route:
  - Check user server-side each request.
  - Redirect unauthenticated users to `/login`.
- Middleware refresh:
  - Run on matched routes.
  - Refresh/propagate auth cookies via Supabase SSR utility.
  - Return updated response with cookies preserved.

## Security Requirements for Implementation

- Do not expose service role key to client code.
- Do not trust client-submitted identity or tenant values.
- Keep auth checks server-side for protected resources.
- Maintain clear 401/redirect behavior for unauthenticated access.
- Preserve compatibility with future tenant membership checks.
- Avoid leaking sensitive auth failure details.

## Edge Cases to Handle During Implementation

1. Expired access token with valid refresh token
- Middleware should refresh and continue request.

2. Expired/invalid refresh token
- Session refresh fails; protected route should redirect to login.

3. Concurrent requests during token rotation
- Multiple simultaneous refresh attempts can race; cookie handling should use Supabase SSR-recommended middleware pattern to reduce inconsistencies.

4. Retry/duplicate submissions
- Double-submit on login/logout should be safe and not corrupt state.
- Logout should be idempotent from UX perspective (already signed out still lands on login).

5. Session revoked server-side
- Protected route checks must rely on fresh server auth state, not stale client cache.

6. Partial failures
- Sign-in success but redirect/render failure should still leave valid session cookies.
- Sign-out network failure should surface actionable error and avoid false "signed out" state.

## Test and Verification Needs (for later Implement phase)

- Manual smoke tests:
  - Unauthenticated user to protected path -> redirected to login.
  - Valid login -> redirected to protected page.
  - Logout -> redirected and protected path blocked again.
  - Expired session behavior through middleware refresh.

- Automated tests to add when implementing behavior:
  - Route protection redirect behavior.
  - Logout idempotency behavior.
  - Middleware matcher excludes static assets and includes protected app routes.

## Open Questions / Assumptions

- Tenant/membership schema is not present yet; this feature can implement identity auth first and add tenant resolution in a follow-up feature once migrations exist.
- Protected route path is not yet defined in product IA; choose a minimal placeholder route during implementation and document it in `plan.md`.
- Login method assumed to be email/password for initial scope.
