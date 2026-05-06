# Organization Invite Acceptance and Active Tenant Selection Investigation

Date: 2026-05-01

Scope: investigation only. No application code, migrations, tests, or database rows were changed.

## Executive Summary

The invite acceptance flow created the expected membership for the invited reviewer account. The unexpected "Choose a workspace" screen is not caused by invite acceptance assigning the reviewer role to the owner account.

The active organization picker issue is caused by membership lookup code reading all RLS-visible `memberships` rows without explicitly filtering to the authenticated `user_id`. Organization owners/admins can intentionally view other organization-user membership rows through RLS policies, so the owner session sees both:

- `test@test.com` as `owner`
- `tim@uilkema.nl` as `reviewer`

The picker then renders both rows as selectable active-tenant options even though only one of them belongs to the signed-in owner.

Classification:

- Active tenant resolver bug: yes.
- Picker query bug: yes.
- UX copy issue: yes, the screen chooses tenants/organizations but says "workspace".
- Invite acceptance bug: no evidence found.
- Stale session/cookie issue: not the root cause, although clearing `sc_active_tenant` on logout exposed the resolver bug.
- Data integrity issue: no invalid duplicate membership found.
- Manual-test-data artifact: no evidence in the inspected data; the current data is valid.

## Sources Inspected

Required context:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/SUMMARY.md`
- `docs/rpi/PROMPTS.md`

Relevant RPI context:

- `docs/rpi/060-tenant-resolution-hardening/`
- `docs/rpi/070-tenant-rbac-and-organization-user-management-foundation/`
- `docs/rpi/072-project-staffing-photographer-scoped-capture-workspaces-and-bounded-project-workflow-permissions/`
- `docs/rpi/080-advanced-organization-access-management-foundation/`
- `docs/rpi/081-custom-role-definitions-and-scoped-role-assignment-foundation/`
- `docs/rpi/082-project-scoped-reviewer-assignments-and-enforcement/`
- `docs/rpi/088-organization-user-management-custom-role-enforcement/`
- `docs/rpi/089-organization-user-role-change-and-removal-custom-role-enforcement/`
- `docs/rpi/093-scoped-custom-role-assignment-foundation/`
- `docs/rpi/094-effective-scoped-permission-resolver-foundation/`
- `docs/rpi/095-operational-permission-resolver-enforcement/`
- `docs/rpi/096-permission-cleanup-and-effective-access-ui/`

Live code:

- `src/app/join/[token]/page.tsx`
- `src/app/join/[token]/accept/route.ts`
- `src/lib/tenant/membership-invites.ts`
- `src/app/select-tenant/page.tsx`
- `src/lib/tenant/active-tenant.ts`
- `src/lib/tenant/resolve-tenant.ts`
- `src/lib/tenant/active-tenant-route-handler.ts`
- `src/lib/tenant/tenant-cookies.ts`
- `src/app/(protected)/layout.tsx`
- `src/app/auth/login/route.ts`
- `src/app/auth/sign-up/route.ts`
- `src/app/auth/logout/route.ts`
- `messages/en.json`
- `messages/nl.json`

Migrations:

- `supabase/migrations/20260304210000_002_projects_invites_schema.sql`
- `supabase/migrations/20260304211000_002_projects_invites_rls.sql`
- `supabase/migrations/20260423090000_070_tenant_rbac_membership_invites_foundation.sql`
- `supabase/migrations/20260423110000_070_tenant_membership_invite_flows.sql`
- `supabase/migrations/20260430180000_088_organization_user_invite_custom_role_enforcement.sql`
- `supabase/migrations/20260501120000_089_organization_user_role_change_remove_custom_role_enforcement.sql`

Tests:

- `tests/feature-060-tenant-resolution-hardening.test.ts`
- `tests/feature-070-active-tenant-route.test.ts`
- `tests/feature-070-tenant-rbac-foundation.test.ts`
- `tests/feature-082-reviewer-access-assignments.test.ts`
- `tests/feature-088-organization-user-read-list-and-invite-custom-role-enforcement.test.ts`
- `tests/feature-089-organization-user-role-change-and-removal-custom-role-enforcement.test.ts`
- `tests/feature-093-scoped-custom-role-assignment-foundation.test.ts`
- `tests/feature-094-effective-scoped-permission-resolver-foundation.test.ts`
- `tests/feature-095-operational-permission-resolver-enforcement.test.ts`
- `tests/feature-096-permission-cleanup-and-effective-access-ui.test.ts`

## Part 1: Invite Acceptance Login and Signup Behavior

### Route and Components

The invite page is handled by `src/app/join/[token]/page.tsx`.

The accept POST is handled by `src/app/join/[token]/accept/route.ts`.

Authentication forms submit through:

- `src/app/auth/login/route.ts`
- `src/app/auth/sign-up/route.ts`

Invite data access is centralized in `src/lib/tenant/membership-invites.ts`, which calls invite RPCs.

### Data Known Before Authentication

For a valid invite token, the public invite RPC returns:

- invite id
- tenant id
- tenant name
- invited email
- invited role
- invite status
- expiry
- `can_accept`

The page also calls `supabase.auth.getUser()` to determine whether a browser session is already authenticated.

### Whether the Token Identifies the Target Email Safely

Yes. The invite URL contains a private token. The database stores and looks up the token by hash. The public lookup returns only the invite represented by that token.

This means the token-protected page can know the invited email without taking an email address from the client.

### Current Account-Existence Behavior

The app does not currently pre-check whether the invited email has a Supabase Auth account when rendering `/join/[token]`.

Unauthenticated users always see both:

- sign in
- create account

If an existing account attempts sign-up, `src/app/auth/sign-up/route.ts` maps Supabase's existing-account error to `account_exists` and redirects back to the invite page with an auth error.

Invite creation RPCs do query `auth.users` for already-member prevention, but that is not used to tailor the public join UI.

### Is Account-Existence Detection Possible?

Yes, technically. Server-side code or a security-definer RPC can check `auth.users` for the normalized invited email.

This should not be exposed as a generic account lookup endpoint. It would need to be limited to a valid, unexpired invite token and only the email already bound to that token.

### Account Enumeration Risk

There is an account-enumeration risk if account existence is exposed for arbitrary emails or reusable lookup calls.

In this specific tokenized flow, the risk is lower because the token already reveals the invited email to the token holder. It can be acceptable to tailor UI in a valid invite-token context, but the implementation must not create a broader email-existence oracle.

### Current Intended Behavior by State

Invited email has no account:

- `/join/[token]` shows both sign-in and sign-up.
- User signs up with the invited email.
- After authentication, the invite page can render the accept action.
- Accept creates the membership and sets the active tenant cookie.

Invited email already has an account:

- `/join/[token]` still shows both sign-in and sign-up.
- Sign-in works.
- Sign-up returns `account_exists`.

User is logged in as a different email:

- The page compares authenticated email to invited email.
- It shows a wrong-email state and does not offer the accept form.
- The accept RPC also rejects mismatched authenticated email.

User opens invite link while already authenticated as the invited email:

- The page shows the signed-in state and an accept button.

Invite is expired, revoked, or already accepted:

- The page renders a non-action state.
- The accept route maps RPC errors for invalid, expired, revoked, mismatch, and server states.

### Is the Current Choice Intentional or a Bug?

The current "sign in or create account" behavior appears to be a conservative UX from the original tenant-RBAC invite work. It is not a security bug by itself, but it is a UX gap relative to the expected guided flow.

### Safest Recommended Product Behavior

Two safe product directions are available:

1. Keep the generic two-path UI and improve copy so users understand which path to choose.
2. Add token-scoped account-existence tailoring after validating the invite token, rendering only sign-in or sign-up for the invited email.

If tailoring is implemented later, it should:

- run only server-side;
- only run for a valid invite token;
- not accept arbitrary email input;
- retain fallback handling for races, stale tokens, and sign-up/sign-in failures.

## Part 2: Active Tenant / Organization Picker Behavior

### Route and Component

The observed screen is rendered by `src/app/select-tenant/page.tsx`.

The protected app layout redirects there when `ensureTenantId` throws `active_tenant_required`.

### Tenant vs Project Workspace

This screen chooses the active tenant/organization, not a project workspace.

The hidden form field submitted by each card is `tenant_id`, and the POST target is `/api/tenants/active`.

The word "workspace" is imprecise UI copy in:

- `messages/en.json` under `activeTenant`
- `messages/nl.json` under `activeTenant`

### Query That Loads the List

`src/app/select-tenant/page.tsx` calls `listCurrentUserTenantMemberships` from `src/lib/tenant/active-tenant.ts`.

That function queries:

```ts
from("memberships")
  .select("tenant_id, role, created_at")
  .order("created_at", { ascending: true })
```

It does not call `auth.getUser()` and does not add `.eq("user_id", user.id)`.

It then loads tenant names from `tenants` for the returned tenant ids.

The picker does not read from:

- reviewer access assignments
- custom role assignments
- project/workspace scoped role assignments
- project workspace tables

It reads tenant membership rows, plus tenant names.

### Active Tenant Resolver Behavior

`src/lib/tenant/resolve-tenant.ts` has the same pattern. Its internal `loadCurrentUserMemberships` query reads RLS-visible `memberships` rows without filtering by `user_id`.

When more than one row is visible and there is no valid `sc_active_tenant` cookie, `selectActiveTenantId` throws `active_tenant_required`.

### Why Owner and Reviewer Rows Appeared

The database has a valid owner membership for `test@test.com` and a valid reviewer membership for `tim@uilkema.nl` in the same tenant.

RLS policies intentionally allow an owner/admin or organization-user manager to view other membership rows. Therefore, when the authenticated user is `test@test.com`, the Supabase query in `listCurrentUserTenantMemberships` returns both membership rows:

- owner row for `test@test.com`
- reviewer row for `tim@uilkema.nl`

The picker maps every returned row into a card and labels it with that row's role. That is why the owner session saw a `Role: Reviewer` card.

The `Role: Reviewer` entry is a real membership row, but it is not a membership belonging to `test@test.com`.

### Authenticated User / Session Confirmation

The database and RLS behavior confirm that the observed Owner + Reviewer picker is consistent with being authenticated as `test@test.com`.

If authenticated as `tim@uilkema.nl`, the RLS check only returns Tim's reviewer membership row. It does not return the owner row.

The picker page itself also renders the current `user.email` near the bottom of the page, but the pasted screen text omitted that line.

### Candidate Causes Evaluated

Two different tenant rows with the same name:

- No. The inspected database has one tenant named `test`.

Duplicate membership rows for the same tenant/user:

- No. The table has primary key `(tenant_id, user_id)`, and the inspected data has one row per user.

One tenant membership and one reviewer role assignment treated as separate organizations:

- No. There were no `role_assignments` rows for either user in this scenario.

Stale session/cookie state:

- Not the root cause. Logout clears `sc_active_tenant`, which made the resolver require selection, but the bad list came from the membership query.

Still authenticated as `tim@uilkema.nl`:

- Not supported by the DB/RLS check. Tim's reviewer session only sees the reviewer membership, not the owner row.

Manual account creation caused invalid data:

- No evidence in the inspected database. The data shape is valid.

Owner associated with reviewer invite:

- No. The invite was accepted by Tim's auth user id, and Tim has the reviewer membership.

### Invite Acceptance Correctness

The `accept_tenant_membership_invite` RPC:

- requires `auth.uid()`;
- loads the authenticated user's email from `auth.users`;
- normalizes it;
- compares it to the invite normalized email;
- rejects mismatches with `invite_email_mismatch`;
- inserts into `public.memberships` using the authenticated user id;
- uses `on conflict on constraint memberships_pkey do nothing`;
- marks the invite accepted with `accepted_by_user_id = auth.uid()`.

The observed data matches this behavior.

## Part 3: Data Inspection

Data was inspected read-only through the local Supabase Postgres container. Invite tokens, token hashes, service keys, and secrets were not queried for the report.

### Users

| Email | User id |
| --- | --- |
| `test@test.com` | `1496513b-5981-4df5-aed5-7845bc9dbe45` |
| `tim@uilkema.nl` | `436594d2-30c9-46c2-b26c-20dab448039a` |

### Tenants

| Tenant name | Tenant id |
| --- | --- |
| `test` | `8e6245e6-05b5-4813-8ac6-e349a836f7a2` |

Only one related tenant named `test` was found.

### Memberships

| Tenant | User | Role |
| --- | --- | --- |
| `test` | `test@test.com` | `owner` |
| `test` | `tim@uilkema.nl` | `reviewer` |

### Invite Rows

One invite row was found for `tim@uilkema.nl`:

| Tenant | Email | Role | Status | Invited by | Accepted by |
| --- | --- | --- | --- | --- | --- |
| `test` | `tim@uilkema.nl` | `reviewer` | `accepted` | `test@test.com` | `tim@uilkema.nl` |

### Role Assignments

No `role_assignments` rows were found for either user in this scenario.

### Reviewer Assignments / Custom Role Assignments

No reviewer access or custom role assignment rows were involved in the observed picker entries. The displayed rows correspond to tenant membership rows.

### RLS Visibility Check

Simulating `auth.uid() = test@test.com`:

- visible memberships included the owner row and Tim's reviewer row.

Simulating `auth.uid() = tim@uilkema.nl`:

- visible memberships included only Tim's reviewer row.

This confirms the duplicate-looking `test` labels are one tenant with two different users' membership rows visible to the owner, not two tenants and not duplicate rows for the same user.

## Part 4: Existing Test Coverage

### Already Covered

Invite flow service coverage:

- `tests/feature-070-tenant-rbac-foundation.test.ts`
- Covers create/refresh invite, public invite lookup, existing account acceptance, repeated acceptance, already-member behavior, wrong-email rejection, revoked invite rejection.

Active tenant POST route coverage:

- `tests/feature-070-active-tenant-route.test.ts`
- Covers unauthenticated redirect, invalid tenant selection rejection, and valid active-tenant cookie creation.
- This route correctly validates selection with explicit `user_id` and `tenant_id`.

Tenant resolver mocked coverage:

- `tests/feature-060-tenant-resolution-hardening.test.ts`
- Covers single membership, multiple memberships requiring active selection, active tenant cookie selection, pending invite cookie behavior, and recovery paths.

Reviewer/scoped permissions coverage:

- Features 082, 093, 094, 095, and 096 cover reviewer assignments, custom role assignments, effective permissions, and operational enforcement.

### Untested Behavior

Missing coverage:

- `listCurrentUserTenantMemberships` has no direct test.
- The resolver is not tested against the real RLS case where owner/admin can see other users' memberships.
- `/select-tenant` is not tested for rendering only the signed-in user's tenant memberships.
- No regression test confirms that a one-tenant owner with additional organization members bypasses the picker.
- Invite join UI is not tested for account-exists/no-account tailoring.

### Tests to Add Later

Invite acceptance:

- Add a join-flow test for an unauthenticated invite page with no existing account.
- Add a join-flow test for an existing invited account.
- If product chooses account-existence tailoring, add token-scoped tests proving it only applies after a valid invite token and does not expose arbitrary email lookup.

Unexpected picker issue:

- Add a database-backed test where an owner and reviewer belong to the same tenant.
- Sign in as owner.
- Assert `listCurrentUserTenantMemberships` returns only the owner's membership row.
- Assert `resolveTenantId` resolves the single tenant without throwing `active_tenant_required`.

Invariant test:

- Keep or add coverage that repeated invite acceptance does not create duplicate memberships. The schema primary key `(tenant_id, user_id)` already enforces this, and existing invite tests partially cover repeated accept.

## Security Considerations

The invite token flow is correctly tokenized and does not accept a client-supplied tenant id or email for acceptance. Acceptance derives identity from the authenticated Supabase user.

The active tenant picker POST path validates the submitted tenant id against the authenticated user id before setting the active tenant cookie. That path is safer than the picker query.

The account-existence question needs care. It is acceptable to consider token-scoped tailoring because the invite token already reveals the target invited email, but a generic account-existence endpoint would be unsafe.

The active tenant query issue can leak other membership roles into the current user's tenant picker UI for users who have organization-user visibility. The immediate security impact is reduced because active-tenant selection is still validated by user id, but it is still a tenant-resolution and UI authorization bug.

## Recommended Later Fix Direction

Likely code changes:

- In `src/lib/tenant/active-tenant.ts`, make `listCurrentUserTenantMemberships` load the authenticated user and add `.eq("user_id", user.id)` to the `memberships` query.
- In `src/lib/tenant/resolve-tenant.ts`, make `loadCurrentUserMemberships` filter by the authenticated user id.
- Consider defensive de-duplication by tenant id, but do not rely on de-duplication alone; explicit `user_id` filtering is the important invariant.
- Update active-tenant UI copy in `messages/en.json` and `messages/nl.json` from "workspace" to "organization" or another product-approved tenant term.

Likely test changes:

- Add service-level coverage for `listCurrentUserTenantMemberships`.
- Add resolver regression coverage for owner/admin sessions with other visible membership rows in the same tenant.
- Add UI/page-level or route-level coverage for `/select-tenant` if the current test setup can exercise server components.

## Open Product Questions

1. Should the active tenant selector use the product term "organization" everywhere, or is "workspace" still the desired customer-facing name for tenants?
2. Should invite links tailor sign-in versus sign-up based on token-scoped account existence?
3. If account-existence tailoring is desired, should the UI show one path only, or should it still keep a fallback secondary path for recovery from stale Auth state and race conditions?

