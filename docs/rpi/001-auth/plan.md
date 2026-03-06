# 001-auth Plan

## Goal
Implement Supabase SSR authentication in Next.js App Router using `@supabase/ssr` with:
- login page
- logout action
- protected route/page
- middleware session refresh

This plan is implementation-ready and intentionally scoped as a small PR.

## Implementation Scope
- Identity/session only (Supabase Auth email+password).
- No tenant/membership authorization logic yet (schema/policies not present in current migrations).
- No domain table access changes in this feature.

## Exact File List

### Create
- `src/lib/supabase/client.ts`
- `src/lib/supabase/server.ts`
- `src/lib/supabase/middleware.ts`
- `middleware.ts`
- `src/app/login/page.tsx`
- `src/app/auth/login/route.ts`
- `src/app/auth/logout/route.ts`
- `src/app/(protected)/layout.tsx`
- `src/app/(protected)/dashboard/page.tsx`

### Change
- `src/app/page.tsx` (replace starter content with simple public landing + links to `/login` and `/dashboard`)

## Step-by-Step Plan

1. Add Supabase SSR utility clients
- Implement browser client helper in `src/lib/supabase/client.ts` using `createBrowserClient` with:
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Implement server helper in `src/lib/supabase/server.ts` using `createServerClient` + `cookies()` integration for App Router server contexts.
- Implement middleware helper in `src/lib/supabase/middleware.ts` using `createServerClient` for `NextRequest`/`NextResponse` cookie read/write.

2. Add middleware session refresh
- Create root `middleware.ts` that:
  - calls middleware Supabase helper
  - triggers session refresh via `supabase.auth.getUser()`
  - returns response with any updated auth cookies
- Add `config.matcher` to include app routes and exclude:
  - `/_next/static`
  - `/_next/image`
  - `/favicon.ico`
  - common static assets/extensions

3. Implement login page
- Create `src/app/login/page.tsx` with email/password form posting to `/auth/login` using `method="post"`.
- Include generic error display driven by query param (for failed login).
- If already authenticated, server-side redirect from login page to `/dashboard`.

4. Implement login action endpoint
- Create `src/app/auth/login/route.ts` with `POST` handler.
- Parse form data (`email`, `password`), validate presence/basic format.
- Call `supabase.auth.signInWithPassword`.
- On success: redirect to `/dashboard` (303 See Other).
- On failure: redirect to `/login?error=invalid_credentials` (303) with generic message mapping.

5. Implement protected route guard
- Create `src/app/(protected)/layout.tsx` as server layout guard.
- Use server Supabase client + `auth.getUser()`.
- If no authenticated user, redirect to `/login`.
- Render children when authenticated.

6. Add protected page
- Create `src/app/(protected)/dashboard/page.tsx` as minimal authenticated page.
- Display authenticated user email/ID from server-fetched user for verification.
- Include logout form/button posting to `/auth/logout`.

7. Implement logout action endpoint
- Create `src/app/auth/logout/route.ts` with `POST` handler.
- Call `supabase.auth.signOut()`.
- Always redirect to `/login` (303), even if session is already missing/expired (idempotent UX).

8. Update public home page
- Replace starter template in `src/app/page.tsx` with minimal public landing links:
  - `/login`
  - `/dashboard` (to test protection behavior)

## Auth Request/Response Behavior

### `POST /auth/login`
- Request:
  - `Content-Type: application/x-www-form-urlencoded` (HTML form post)
  - Fields: `email`, `password`
- Success response:
  - `303` redirect to `/dashboard`
  - Supabase auth cookies set/updated in response
- Failure response:
  - `303` redirect to `/login?error=invalid_credentials`
  - No sensitive detail about whether email exists
- Validation failure:
  - `303` redirect to `/login?error=invalid_input`

### `POST /auth/logout`
- Request:
  - form `POST` from authenticated page
- Success response:
  - `303` redirect to `/login`
  - Session cookies cleared/rotated by Supabase sign-out
- Missing/expired session:
  - still `303` redirect to `/login` (idempotent)

### Protected route access (`/dashboard`)
- Authenticated:
  - `200` render protected page
- Unauthenticated:
  - server redirect to `/login`

### Middleware behavior
- On each matched request:
  - read incoming auth cookies
  - call `auth.getUser()` to refresh when needed
  - write refreshed cookies to response
- If no valid session:
  - middleware does not hard-fail; downstream protected guard handles redirect logic

## Security Considerations

- Cookie handling:
  - Use Supabase SSR cookie adapter exactly for read/write in server and middleware contexts.
  - Always return the response object that received cookie updates.
  - Avoid manual auth cookie mutations unless required by Supabase helper pattern.
- Secrets:
  - Never use `SUPABASE_SERVICE_ROLE_KEY` in browser code.
  - Prefer anon key + user session for auth flows.
- Error safety:
  - Use generic login error text (`Invalid email or password`).
  - Do not expose raw Supabase auth errors to users.
- Server-side trust boundary:
  - Authentication checks happen on server (`auth.getUser()`), not client-only state.
- Logging:
  - Do not log passwords, tokens, or raw cookie values.

## Edge Cases and Handling

1. Expired access token
- Middleware refresh path should renew session using refresh token and continue request.

2. Expired/invalid refresh token
- `getUser()` fails to refresh; protected layout redirects to `/login`.

3. Missing cookies
- Treat as unauthenticated and redirect when hitting protected route.

4. Retries/double-submit
- Login double submit: either one success path, or failure redirects; no server-side data corruption.
- Logout double submit: always redirect to `/login`; action remains effectively idempotent.

5. Middleware redirect loops
- Do not redirect in middleware for `/login`.
- Keep auth enforcement in protected layout to avoid global loop conditions.
- Ensure matcher excludes Next internals/static assets.

6. Local vs production environment differences
- Local uses `127.0.0.1` Supabase URL and non-production cookie context.
- In production, verify correct public URL and secure cookie behavior via platform defaults.
- Ensure deployed env vars are set for `NEXT_PUBLIC_SUPABASE_URL` and anon key.

## Verification Plan

### Commands
1. `npm run lint`
2. `supabase db reset`
3. `npm run dev`

### Manual test checklist
1. Open `/` and verify public links render.
2. Visit `/dashboard` while logged out -> redirected to `/login`.
3. Submit invalid login credentials -> redirected to `/login?error=...` with generic message.
4. Submit valid login credentials -> redirected to `/dashboard`.
5. Refresh `/dashboard` after login -> remains authenticated.
6. Click logout on dashboard -> redirected to `/login`.
7. Revisit `/dashboard` after logout -> redirected to `/login`.
8. Open two tabs and perform login/logout quickly to observe stable behavior (no crashes/looping).
9. Confirm static assets and `_next` resources load (middleware matcher not over-broad).

## Out of Scope (This PR)
- Tenant resolution from memberships.
- RLS policy additions/changes.
- Signup, password reset, OAuth/magic-link flows.
- Extensive automated auth integration test harness.
