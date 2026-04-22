# Feature 060 - Tenant Resolution Hardening After Auth Transitions

## Inputs reviewed
- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `src/lib/tenant/resolve-tenant.ts`
- `src/app/(protected)/layout.tsx`
- `src/app/(protected)/dashboard/page.tsx`
- `src/app/(protected)/projects/page.tsx`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/app/(protected)/profiles/page.tsx`
- `src/app/(protected)/templates/page.tsx`
- `src/app/(protected)/templates/[templateId]/page.tsx`
- `src/app/auth/login/route.ts`
- `src/lib/supabase/server.ts`
- `src/lib/supabase/middleware.ts`
- `middleware.ts`
- `supabase/migrations/20260304210000_002_projects_invites_schema.sql`

## Verified current problem
- `resolveTenantId(...)` called `current_tenant_id()` once and threw `tenant_lookup_failed` on any RPC error.
- The protected layout already called `ensureTenantId(...)`, but protected pages still resolved tenant state independently during render.
- `dashboard` and `projects` did not guard `!user` before tenant resolution.
- After idle or logout/login transitions, the first protected request could hit a transient auth or cookie propagation window and crash with a 500 before the next request stabilized.

## Constraints
- Keep tenant authority server-side.
- Do not trust client tenant state.
- Do not redesign auth or queue infrastructure.
- Keep the fix additive and shared so all pages and routes benefit.

## Bounded recommendation
- Harden the shared tenant helper instead of special-casing one page.
- Make tenant resolution recover through `ensure_tenant_for_current_user()` when the first `current_tenant_id()` lookup fails or returns null.
- Retry `current_tenant_id()` once after bootstrap.
- Only return `null` when the request is no longer authenticated.
- Keep a hard failure only for authenticated requests that still cannot resolve tenant state after recovery.
- Add missing `!user` redirects on protected pages that currently resolve tenant state first.

## Risks to cover
- Idle-session cookie refresh races.
- First request after login redirect.
- Authenticated user with no membership yet.
- Real backend failure should still surface as a real server error instead of being mislabeled as "no membership".
