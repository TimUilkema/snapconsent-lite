# Feature 060 - Tenant Resolution Hardening After Auth Transitions

## Recommendation
- Reuse the existing tenant RPCs.
- Centralize recovery in `src/lib/tenant/resolve-tenant.ts`.
- Update protected pages so they redirect on `!user` before doing tenant-dependent work.

## Implementation steps
1. Add shared internal helpers for:
   - `current_tenant_id()`
   - `ensure_tenant_for_current_user()`
   - authenticated user check
2. Change `resolveTenantId(...)` to:
   - try `current_tenant_id()`
   - fall back to `ensure_tenant_for_current_user()`
   - retry `current_tenant_id()`
   - return `null` only when auth is gone
   - otherwise preserve a real server error for authenticated requests
3. Change `ensureTenantId(...)` to reuse the same recovery ladder.
4. Add missing `!user` redirects in protected pages that currently call `resolveTenantId(...)` first.
5. Add regression tests for:
   - transient current-tenant lookup failure
   - null tenant with authenticated user
   - retry after failed bootstrap attempt
   - unauthenticated fallback returning `null`
   - persistent authenticated failure still surfacing as an error
6. Run targeted lint and tests.

## Safety notes
- The bootstrap RPC already returns the existing membership first, so using it as a fallback does not widen tenant access.
- The fix stays server-side and does not rely on client tenant state.
- No schema changes are required.
