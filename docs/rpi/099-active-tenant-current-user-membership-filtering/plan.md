# Feature 099 - Active Tenant Current-User Membership Filtering

## 1. Inputs and Ground Truth

Feature ID: 099

Feature name: Active tenant current-user membership filtering

Plan date: 2026-05-02

Inputs read first, in the requested order:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `docs/rpi/README.md`
5. `docs/rpi/SUMMARY.md`
6. `docs/rpi/PROMPTS.md`
7. `docs/rpi/investigation/current-user-rls-scope-audit.md`

Targeted live-code and test verification:

- `src/lib/tenant/resolve-tenant.ts`
- `src/lib/tenant/active-tenant.ts`
- `src/lib/tenant/active-tenant-route-handler.ts`
- `src/lib/tenant/tenant-cookies.ts`
- `src/app/select-tenant/page.tsx`
- `src/app/(protected)/layout.tsx`
- `src/lib/tenant/tenant-membership.ts`
- `src/lib/tenant/permissions.ts`
- `messages/en.json`
- `messages/nl.json`
- `tests/feature-060-tenant-resolution-hardening.test.ts`
- `tests/feature-070-active-tenant-route.test.ts`
- `tests/feature-070-tenant-rbac-foundation.test.ts`
- `src/components/navigation/active-tenant-switcher.tsx`
- `tests/helpers/supabase-test-client.ts`
- targeted migration snippets for the `memberships` primary key, own-row RLS, owner/admin broad membership visibility, delegated organization-user broad membership visibility, and tenant bootstrap RPC behavior

Ground truth order for this plan:

1. Live application code, migrations, and tests.
2. The current-user RLS scope audit as the research input.
3. Older RPI documents only as historical context.

No implementation code should be changed in this phase.

## 2. Targeted Verification Summary

`src/lib/tenant/resolve-tenant.ts` currently has a private `loadCurrentUserMemberships(supabase)` helper that selects `tenant_id, created_at` from `memberships`, ordered by `created_at`, without an authenticated `user_id` filter. `resolveTenantId` and `ensureTenantId` use those rows as active tenant state.

`src/lib/tenant/active-tenant.ts` currently has `listCurrentUserTenantMemberships(supabase)` that selects `tenant_id, role, created_at` from `memberships`, ordered by `created_at`, without an authenticated `user_id` filter. It then loads tenant names and returns tenant options for the select-tenant page and header switcher.

`src/lib/tenant/active-tenant-route-handler.ts` already uses the safe pattern for active tenant selection writes: it derives `user.id` from `supabase.auth.getUser()` and calls `currentUserHasTenantMembership(supabase, user.id, tenantId)`.

`currentUserHasTenantMembership` already filters by both `user_id` and `tenant_id`.

`src/lib/tenant/tenant-membership.ts` already filters current membership role lookups by both `tenant_id` and `user_id`.

`src/lib/tenant/permissions.ts` derives current-user permissions through `resolveTenantMembership(supabase, tenantId, userId)` and explicit `userId`-based reviewer/workspace checks.

The `memberships` table has primary key `(tenant_id, user_id)`, so a user cannot have duplicate memberships for the same tenant in valid database state.

RLS now intentionally allows more than own rows:

- `memberships_select_own` allows a user to see their own row.
- `memberships_select_manage_member_rows` allows owner/admin member managers to see tenant membership rows.
- `memberships_select_organization_user_rows` allows delegated organization-user viewers to see tenant membership rows.

`app.ensure_tenant_for_current_user()` already uses `auth.uid()` and filters `memberships` by `m.user_id = v_user_id`; no migration is required for this bugfix.

`messages/en.json` and `messages/nl.json` still use "workspace" copy on the active tenant selection screen and header switcher label.

`tests/feature-060-tenant-resolution-hardening.test.ts` covers selection behavior with mocked membership arrays, but it does not prove the live membership query filters by authenticated user.

`tests/feature-070-active-tenant-route.test.ts` covers the POST guard and confirms selected tenant validation receives the authenticated user id. It does not cover the active tenant option-list helper.

## 3. Confirmed Bug Summary

CUR-001: `resolveTenantId` and `ensureTenantId` treat RLS-visible `memberships` rows as current-user membership rows. Owner/admins and delegated organization-user managers can intentionally see other users' membership rows, so active tenant resolution can become ambiguous or use rows that do not belong to the authenticated user.

CUR-002: `listCurrentUserTenantMemberships` treats RLS-visible `memberships` rows as current-user tenant options. The select-tenant page and header switcher can show duplicate tenant options, another member's role, or extra visible rows that do not belong to the authenticated user.

The root issue is that RLS answers "may this user see this row?", while these helpers need "does this row belong to this authenticated user?".

## 4. Chosen Architecture

Use explicit authenticated `user_id` filters for every current-user membership query.

Decision 1: `resolveTenantId` should derive the authenticated user internally when the caller does not pass one, but should also accept a trusted server-derived authenticated user id to avoid repeated `auth.getUser()` calls.

Chosen public shape:

```ts
export async function resolveTenantId(
  supabase: SupabaseClient,
  dependencies?: ResolveTenantDependencies,
): Promise<string | null>

export async function ensureTenantId(
  supabase: SupabaseClient,
  dependencies?: ResolveTenantDependencies,
): Promise<string>
```

Keep the public function names and second-argument pattern. Extend the dependency/options object with:

```ts
authenticatedUserId?: string;
loadAuthenticatedUserId?: (supabase: SupabaseClient) => Promise<string | null>;
loadMemberships?: (
  supabase: SupabaseClient,
  authenticatedUserId: string,
) => Promise<TenantMembershipLookupResult>;
```

Remove or replace the old boolean-only `hasAuthenticatedUser` dependency in the implementation and tests. The resolver now needs the authenticated user id, not just an authenticated boolean.

Default resolver flow:

1. Read active tenant and pending invite cookies as it does today.
2. Use `dependencies.authenticatedUserId` if provided.
3. Otherwise call `supabase.auth.getUser()` through `loadAuthenticatedUserId`.
4. If no authenticated user id is available, return `null`.
5. Load current-user memberships with `.eq("user_id", authenticatedUserId)`.
6. Continue the existing select, pending invite, bootstrap RPC, retry, and error behavior using only filtered current-user memberships.

Decision 2: `listCurrentUserTenantMemberships` should require a trusted authenticated user id.

Chosen signature:

```ts
export async function listCurrentUserTenantMemberships(
  supabase: SupabaseClient,
  authenticatedUserId: string,
): Promise<CurrentUserTenantMembership[]>
```

This helper has only two live call sites, and both already load `user` before calling it. Requiring `authenticatedUserId` makes misuse visible at compile time and avoids another `auth.getUser()` call in the select-tenant page and protected layout.

Decision 3: repeated `auth.getUser()` calls are minimized by:

- Passing `user.id` from `src/app/(protected)/layout.tsx` into `ensureTenantId(supabase, { authenticatedUserId: user.id })`.
- Passing `user.id` from `src/app/(protected)/layout.tsx` into `listCurrentUserTenantMemberships(supabase, user.id)`.
- Passing `user.id` from `src/app/select-tenant/page.tsx` into `listCurrentUserTenantMemberships(supabase, user.id)`.
- Leaving other `resolveTenantId(supabase)` call sites source-compatible. They will derive the user internally unless a later focused cleanup passes known user ids there too.

Decision 4: no database migration and no RLS policy change.

The policies are intentionally broad for admin and delegated organization-user directory views. The application helpers that answer current-user state must add explicit ownership filters.

## 5. Exact Scope Boundary

In scope:

- Add current-user `user_id` filtering to tenant resolution membership reads.
- Add current-user `user_id` filtering to active tenant option-list membership reads.
- Adjust `select-tenant` and protected layout call sites for the helper signature changes.
- Update active-tenant and switcher copy from "workspace" to "organization" in English and Dutch messages.
- Add regression tests for owner/admin broad membership visibility.
- Add delegated organization-user broad visibility regression coverage if practical using existing custom-role test helpers/patterns.
- Preserve existing tests.

Out of scope:

- CUR-003 through CUR-009 broad admin queries.
- CUR-010 role-assignment helper naming cleanup.
- CUR-011 dashboard recent projects semantics.
- CUR-012 workspace permission compatibility label cleanup.
- Dashboard behavior changes.
- Reviewer access redesign.
- Custom role redesign.
- Role administration changes.
- RLS policy changes.
- Database migrations.
- Invite acceptance UX tailoring.
- Account-existence detection changes.
- Public token flow changes.
- Rewording every historic "workspace" use across the product.

## 6. Exact Code Change Plan

### 6.1 `src/lib/tenant/resolve-tenant.ts`

Change the private membership loader from:

```ts
loadCurrentUserMemberships(supabase)
```

to:

```ts
loadCurrentUserMemberships(supabase, authenticatedUserId)
```

The membership query must be:

```ts
supabase
  .from("memberships")
  .select("tenant_id, created_at")
  .eq("user_id", authenticatedUserId)
  .order("created_at", { ascending: true });
```

Add a default authenticated user id loader:

```ts
async function loadAuthenticatedUserId(supabase: SupabaseClient): Promise<string | null> {
  const { data: { user }, error } = await supabase.auth.getUser();
  return !error && user ? user.id : null;
}
```

Update `ResolveTenantDependencies` to include:

- `authenticatedUserId?: string`
- `loadAuthenticatedUserId?: (supabase: SupabaseClient) => Promise<string | null>`
- `loadMemberships?: (supabase: SupabaseClient, authenticatedUserId: string) => Promise<TenantMembershipLookupResult>`

Remove the old `hasAuthenticatedUser` dependency from the resolver internals and update tests accordingly.

Update `resolveTenantIdWithRecovery` to resolve `authenticatedUserId` before membership lookup. If no authenticated user id exists, return `null`.

Preserve these behaviors after filtering:

- Zero memberships with a pending organization invite cookie throws `pending_org_invite_acceptance_required`.
- Zero memberships without a pending invite attempts `ensure_tenant_for_current_user`.
- A successful bootstrap RPC result returns the ensured tenant id.
- A retry membership lookup still happens when the bootstrap RPC does not return a tenant id.
- A final unauthenticated state returns `null` through the new early auth check.
- Authenticated unresolved state with a lookup error throws `tenant_lookup_failed`.
- Authenticated unresolved state without a lookup error throws `tenant_bootstrap_failed`.
- Multiple current-user memberships with no valid active tenant cookie throw `active_tenant_required`.
- A valid active tenant cookie is valid only if the filtered current-user membership rows contain that tenant.

### 6.2 `src/lib/tenant/active-tenant.ts`

Change:

```ts
listCurrentUserTenantMemberships(supabase)
```

to:

```ts
listCurrentUserTenantMemberships(supabase, authenticatedUserId)
```

The membership query must be:

```ts
supabase
  .from("memberships")
  .select("tenant_id, role, created_at")
  .eq("user_id", authenticatedUserId)
  .order("created_at", { ascending: true });
```

Keep the tenant name lookup through `tenants` and `.in("id", tenantIds)`.

Keep `tenantIds = [...new Set(...)]` for the tenant name lookup. Do not add UI option dedupe beyond the database invariant. The `memberships` primary key `(tenant_id, user_id)` is the authoritative uniqueness guarantee after filtering by current user.

The displayed role for each returned option must come from the filtered current user's membership row.

Keep `currentUserHasTenantMembership` unchanged because it already filters by `user_id` and `tenant_id`.

### 6.3 `src/app/select-tenant/page.tsx`

Change:

```ts
const memberships = await listCurrentUserTenantMemberships(supabase);
```

to:

```ts
const memberships = await listCurrentUserTenantMemberships(supabase, user.id);
```

Preserve existing behavior except that memberships belonging to other visible users are excluded:

- Unauthenticated users still redirect to `/login?next=%2Fselect-tenant`.
- Zero current-user memberships with pending invite cookie still redirects to the join path.
- Zero current-user memberships without pending invite still redirects to `/dashboard`.
- One current-user membership still redirects to `/projects`.
- Multiple current-user memberships still render the selector unless the active tenant cookie matches one of the current user's memberships.
- Invalid selection messaging still uses the existing query string flow.

### 6.4 `src/app/(protected)/layout.tsx`

Change:

```ts
const tenantId = await ensureTenantId(supabase);
...
memberships = await listCurrentUserTenantMemberships(supabase);
```

to:

```ts
const tenantId = await ensureTenantId(supabase, { authenticatedUserId: user.id });
...
memberships = await listCurrentUserTenantMemberships(supabase, user.id);
```

Preserve existing behavior except that the active tenant switcher only receives the authenticated user's memberships:

- `active_tenant_required` still redirects to `/select-tenant`.
- `pending_org_invite_acceptance_required` still redirects to the join path when the cookie is present.
- Workspace setup fallback still renders for unresolved setup errors.
- The switcher still renders only when the filtered current-user membership list has at least two entries.

### 6.5 Files Not Changed

Do not change `src/lib/tenant/active-tenant-route-handler.ts`. It already validates POSTed tenant selection against the authenticated user id.

Do not change `src/lib/tenant/tenant-cookies.ts`.

Do not change `src/lib/tenant/tenant-membership.ts` or `src/lib/tenant/permissions.ts`; they already use explicit `userId` filtering for current-user membership and permissions.

Do not change RLS migrations.

## 7. Exact UI Copy and i18n Plan

Use "organization" as the tenant-facing term for active tenant selection and the header switcher label.

Keep existing message keys where possible to avoid component churn. Only update values.

English changes in `messages/en.json`:

- `layout.workspaceSetupIssueTitle`: `Organization setup issue`
- `layout.workspaceSetupIssueBody`: `Unable to set up your organization membership. Sign out and sign in again, then retry.`
- `layout.workspace`: `Organization`
- `activeTenant.title`: `Choose an organization`
- `activeTenant.subtitle`: `This account belongs to more than one organization. Pick the organization you want to use right now.`
- `activeTenant.choose`: `Open organization`
- `activeTenant.errors.invalidSelection`: `Select an organization you currently belong to.`

Leave `layout.switchWorkspace` as `Switch` because the visible label beside it will be `Organization`.

Dutch changes in `messages/nl.json`:

- `layout.workspaceSetupIssueTitle`: `Probleem met organisatie-instelling`
- `layout.workspaceSetupIssueBody`: `Het organisatielidmaatschap kon niet worden ingesteld. Meld je af, meld je opnieuw aan en probeer het opnieuw.`
- `layout.workspace`: `Organisatie`
- `activeTenant.title`: `Kies een organisatie`
- `activeTenant.subtitle`: `Dit account hoort bij meer dan een organisatie. Kies de organisatie die je nu wilt gebruiken.`
- `activeTenant.choose`: `Organisatie openen`
- `activeTenant.errors.invalidSelection`: `Kies een organisatie waar je nu lid van bent.`

Do not reword project workspace, photographer workspace, or other operational workspace copy in this feature.

## 8. Exact Test Plan

### 8.1 Update Existing Resolver Tests

Update `tests/feature-060-tenant-resolution-hardening.test.ts` for the new resolver dependency contract.

Required adjustments:

- Change the mock `loadMemberships` dependency to accept `(_supabase, authenticatedUserId)`.
- Add assertions where useful that `authenticatedUserId` is the trusted current user id.
- Replace `hasAuthenticatedUser` test dependency with `loadAuthenticatedUserId` or pass `authenticatedUserId` directly.

Preserve existing tests for:

- Single membership resolution.
- Active tenant cookie selection for multiple memberships.
- `active_tenant_required` when multiple current-user memberships have no valid cookie.
- Bootstrap through `ensure_tenant_for_current_user`.
- Pending invite recovery.
- Retry after bootstrap failure.
- Null return for unauthenticated users.
- `tenant_lookup_failed`.
- `ensureTenantId` propagation.

Add resolver unit tests:

1. `resolveTenantId passes trusted authenticated user id into membership lookup without calling auth.getUser`.
   - Call `resolveTenantId(supabase, { authenticatedUserId: "user-1", loadMemberships: ... })`.
   - Assert `loadMemberships` receives `"user-1"`.
   - Assert auth lookup is not called.

2. `resolveTenantId derives authenticated user id when no trusted id is provided`.
   - Mock `loadAuthenticatedUserId` to return `"user-1"`.
   - Assert `loadMemberships` receives `"user-1"`.

3. `resolveTenantId ignores stale active tenant cookie for a single current-user membership`.
   - Memberships contain only `tenant-current`.
   - Cookie is `tenant-stale`.
   - Result is `tenant-current`.

### 8.2 Add Feature 099 Regression Tests

Create `tests/feature-099-active-tenant-current-user-membership-filtering.test.ts`.

Use real Supabase test clients and current RLS policies through `tests/helpers/supabase-test-client.ts`.

Imports expected:

- `randomUUID`, `test`, `assert`
- `SupabaseClient`
- `resolveTenantId`
- `listCurrentUserTenantMemberships`
- `createCustomRole`
- `grantCustomRoleToMember`
- `adminClient`, `assertNoPostgrestError`, `createAuthUserWithRetry`, `signInClient`

Helper setup:

- Create signed test members with `createAuthUserWithRetry` and `signInClient`.
- Insert a tenant with multiple memberships using `adminClient`.
- Use owner/admin or delegated custom-role grants to make other membership rows RLS-visible.
- Use a `loadTenantCookies` dependency returning `{ activeTenantId: null, pendingOrgInviteToken: null }` for resolver calls.

Test 1: `feature 099 owner visible membership rows do not affect tenant resolution`.

- Create owner, reviewer, and photographer users in one tenant.
- Sign in owner.
- Confirm owner can see multiple `memberships` rows through the authenticated owner client.
- Call `resolveTenantId(owner.client, { loadTenantCookies })`.
- Assert the result is the tenant id and no `active_tenant_required` is thrown.

Test 2: `feature 099 admin visible membership rows do not affect active tenant options`.

- Create owner, admin, and reviewer users in one tenant.
- Sign in admin.
- Confirm admin can see multiple `memberships` rows through the authenticated admin client.
- Call `listCurrentUserTenantMemberships(admin.client, admin.userId)`.
- Assert the returned list has length `1`.
- Assert the returned `tenantId` is the tenant id.
- Assert the returned `role` is `"admin"`, not the other visible reviewer role.

Test 3: `feature 099 delegated organization-user visibility does not affect tenant resolution or options`.

- Create owner, delegated manager, and target reviewer users in one tenant.
- Give delegated manager a tenant custom role with `organization_users.manage` using `createCustomRole` and `grantCustomRoleToMember`.
- Confirm delegated manager can see multiple `memberships` rows through their authenticated client.
- Call `resolveTenantId(manager.client, { loadTenantCookies })`.
- Assert the result is the tenant id.
- Call `listCurrentUserTenantMemberships(manager.client, manager.userId)`.
- Assert the returned list has length `1`.
- Assert the returned `role` is the manager's fixed membership role, likely `"photographer"` in the test setup.

If the delegated setup is unexpectedly too slow or brittle in local Supabase, keep the owner/admin tests as required coverage and add a focused mock test that simulates delegated RLS-visible rows. Prefer the real delegated integration test if it can be made reliable with existing Feature 088 patterns.

### 8.3 Active Tenant Route Tests

Keep `tests/feature-070-active-tenant-route.test.ts` unchanged unless TypeScript changes require import cleanup. The route handler already tests that selected tenant validation receives the authenticated user id.

### 8.4 Message Validation

No separate snapshot test is required for the copy-only message value changes. `npm run lint` and TypeScript should catch invalid JSON shape/import fallout.

## 9. Security Considerations

The fix closes a server-side authorization ambiguity: current-user tenant state will be derived only from rows with `memberships.user_id = authenticatedUserId`.

Do not accept `authenticatedUserId` from client input. Only pass it after `supabase.auth.getUser()` in server code. The option name must make that expectation clear.

Do not change broad RLS policies. They are needed for member management and delegated organization-user directory views.

Do not use service-role clients for active tenant resolution or tenant option listing. RLS should still run for authenticated server clients, with the explicit `user_id` filter narrowing rows further.

Do not expose the Supabase service role key to the client.

The active tenant POST route remains protected because it validates the requested `tenant_id` with both authenticated `userId` and target `tenantId`.

Tenant option roles must come from the current user's filtered membership row, not another visible member row.

## 10. Edge Cases

Zero current-user memberships after filtering:

- In `resolveTenantId`, this should behave as a true no-membership state: pending invite recovery first, then tenant bootstrap RPC, then retry, then existing error/null semantics.
- In `listCurrentUserTenantMemberships`, return an empty array.

Stale `sc_active_tenant` cookie after filtering:

- If the user has exactly one current-user membership, return that tenant and ignore the stale cookie.
- If the user has multiple current-user memberships and the cookie does not match one of them, throw `active_tenant_required`.
- If the cookie matches only an RLS-visible row that is not owned by the current user, it must be ignored because non-owned rows are filtered out before cookie validation.

Single current-user membership plus other visible rows:

- Resolve directly to the current user's single tenant.
- Do not require active tenant selection because other users' rows are visible.
- Active tenant switcher must not render because the filtered list length is one.

Multiple current-user memberships plus other visible rows:

- Keep existing active tenant selection behavior based only on the current user's memberships.
- Other visible rows must not add options or change roles.

Pending invite cookie:

- Preserve current redirect/recovery behavior.
- If filtering removes all visible non-owned rows and a pending invite cookie exists, treat the authenticated user as having zero current-user memberships and require invite acceptance.

Bootstrap:

- `ensure_tenant_for_current_user` already uses `auth.uid()` and current-user filtering internally.
- No migration is needed.
- If bootstrap succeeds, preserve the existing direct return of the RPC tenant id.

Races:

- If membership rows change between the first lookup and retry, the resolver should use the latest filtered rows on retry.
- If a membership is removed after active tenant selection but before a later request, the stale cookie is no longer accepted unless a filtered current-user row still matches it.

Partial failures:

- Membership lookup errors should still produce `tenant_lookup_failed` when recovery cannot resolve a tenant for an authenticated user.
- Tenant name lookup errors in the option list should still produce `tenant_membership_lookup_failed`.

Deduplication:

- Do not dedupe displayed options beyond the database invariant.
- Keep `Set` only to avoid duplicate tenant id fetches defensively.
- If duplicate current-user membership rows ever appear, that is schema corruption because `(tenant_id, user_id)` is the primary key.

Expired sessions:

- If `auth.getUser()` cannot produce a user id and no trusted server-derived user id was passed, `resolveTenantId` returns `null`; `ensureTenantId` then throws its existing `tenant_bootstrap_failed` error.
- In `select-tenant` and protected layout, user lookup still happens first and redirects unauthenticated users before calling the helpers.

## 11. Implementation Phases

Phase 1: Resolver filtering

- Update `src/lib/tenant/resolve-tenant.ts` dependency types.
- Add authenticated user id loading.
- Add `.eq("user_id", authenticatedUserId)` to membership lookup.
- Preserve recovery and error behavior.
- Update `tests/feature-060-tenant-resolution-hardening.test.ts`.
- Run the Feature 060 targeted test file.

Phase 2: Active tenant option filtering

- Update `src/lib/tenant/active-tenant.ts` signature.
- Add `.eq("user_id", authenticatedUserId)` to the option-list membership query.
- Update `src/app/select-tenant/page.tsx`.
- Update `src/app/(protected)/layout.tsx`.
- Keep `active-tenant-route-handler.ts` unchanged.
- Add Feature 099 regression tests.
- Run Feature 060, Feature 070 active tenant route, and Feature 099 targeted tests.

Phase 3: Copy cleanup

- Update `messages/en.json`.
- Update `messages/nl.json`.
- Keep message keys stable.
- Run lint.

Phase 4: Final validation

- Run targeted tests.
- Run `npm run lint`.
- Run `npm test` if targeted tests pass.

## 12. Validation Commands

Targeted tests:

```bash
npx tsx --test --test-concurrency=1 tests/feature-060-tenant-resolution-hardening.test.ts tests/feature-070-active-tenant-route.test.ts tests/feature-099-active-tenant-current-user-membership-filtering.test.ts
```

Lint:

```bash
npm run lint
```

Full test suite if targeted tests pass:

```bash
npm test
```

No `supabase db reset` is expected because this feature should not add or change migrations.

## 13. Non-Goals

- Do not redesign active tenant selection.
- Do not redesign member management.
- Do not change dashboard recent projects semantics.
- Do not change reviewer access, photographer assignment, custom role, or effective permission semantics.
- Do not rename broad admin helper APIs in this feature.
- Do not add RLS policies.
- Do not add migrations.
- Do not change invite acceptance behavior.
- Do not change public token flows.
- Do not broaden "workspace" copy cleanup outside the active tenant and setup/switcher copy listed above.

## 14. Concise Implementation Prompt

Implement Feature 099 by following `docs/rpi/099-active-tenant-current-user-membership-filtering/plan.md` as the implementation contract.

Before coding, read:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/099-active-tenant-current-user-membership-filtering/plan.md`

Keep deviations minimal.

Implement in phases:

1. Update `resolveTenantId` and `ensureTenantId` membership loading to use an explicit authenticated `user_id` filter while preserving recovery behavior.
2. Update `listCurrentUserTenantMemberships` to require a trusted authenticated user id and filter memberships by it; update select-tenant and protected layout call sites.
3. Update active tenant organization copy in English and Dutch messages.
4. Add the resolver and active tenant option regression tests described in the plan.

Additional rules:

- Do not rely on RLS-visible `memberships` rows for current-user tenant state.
- Do not accept user id or tenant id from client input as authority.
- Do not change RLS policies or add a migration.
- Do not change dashboard, invite acceptance, reviewer access, custom role, or role administration behavior.

After each phase, run the relevant targeted tests and fix failures before continuing. At the end, report what changed, any minimal deviations from the plan, and the validation commands with results.
