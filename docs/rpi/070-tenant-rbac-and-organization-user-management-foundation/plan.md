# Feature 070 Plan - Tenant RBAC and organization user management foundation

## Inputs and ground truth

Required inputs re-read for this phase:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `docs/rpi/README.md`
5. `docs/rpi/070-tenant-rbac-and-organization-user-management-foundation/research.md`

Targeted live verification performed for plan-critical conclusions:

- `supabase/migrations/20260304210000_002_projects_invites_schema.sql`
- `supabase/migrations/20260304211000_002_projects_invites_rls.sql`
- `supabase/migrations/20260415110000_055_project_participants_mixed_consent_foundation.sql`
- `src/lib/tenant/resolve-tenant.ts`
- `src/app/(protected)/layout.tsx`
- `src/app/api/projects/route.ts`
- `src/lib/templates/template-service.ts`
- `src/lib/profiles/profile-access.ts`
- `src/lib/projects/project-participants-route-handlers.ts`
- `src/lib/projects/project-participants-service.ts`
- `src/lib/projects/project-consent-upgrade-route-handlers.ts`
- `src/lib/projects/project-consent-upgrade-service.ts`
- `src/app/api/projects/[projectId]/invites/route.ts`
- `src/app/api/projects/[projectId]/assets/batch/prepare/route.ts`
- `src/app/api/projects/[projectId]/assets/batch/finalize/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/assignment/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/manual-faces/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/review-sessions/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/review-sessions/[sessionId]/items/[itemId]/actions/route.ts`
- `src/components/navigation/protected-nav.tsx`
- `src/lib/email/outbound/types.ts`
- `src/lib/email/outbound/registry.ts`
- `src/lib/email/outbound/consent-receipt-delivery.ts`
- `src/lib/url/external-origin.ts`
- `src/app/auth/login/route.ts`
- `src/app/login/page.tsx`
- `src/lib/supabase/server.ts`
- `src/lib/supabase/middleware.ts`
- `docs/rpi/071-consent-upgrade-flow-headshot-reuse-and-upgrade-ux-fixes/research.md`
- `docs/rpi/071-consent-upgrade-flow-headshot-reuse-and-upgrade-ux-fixes/plan.md`

Ground-truth conclusions confirmed during targeted verification:

- Live membership roles are still only `owner`, `admin`, and `photographer`.
- `current_tenant_id()` still resolves the oldest membership by `created_at`.
- `ensure_tenant_for_current_user()` still auto-bootstraps a new owner tenant for authenticated users with no memberships.
- There is still no member-management UI and no active-tenant selector.
- The typed outbound email foundation still only has `consent_receipt`.
- Feature 071 changed upgrade UX/read behavior, but project participant creation, upgrade-request creation, and review routes are still membership-only and remain in scope for Feature 070 route hardening.

## Verified current boundary

### Membership and tenant boundary

- `memberships` remains the core tenant relationship and should stay that way.
- Multi-tenant membership is already possible in schema, but current app behavior is still effectively single-active-tenant.
- Protected layout still calls `ensureTenantId(...)`, which can bootstrap a new owner tenant.
- `memberships` RLS still only allows a user to read their own rows.

### Existing role boundary

- Existing role-aware gates already exist for:
  - template management
  - recurring profile management
- Existing project and review flows still do not have role-aware gates.

### Post-071 verification relevant to Feature 070

- `project-participants-route-handlers.ts` and `project-consent-upgrade-route-handlers.ts` still check only auth plus tenant membership.
- `project-participants-service.ts` and `project-consent-upgrade-service.ts` still have no role checks.
- Representative review routes still do:
  - auth
  - tenant resolution
  - immediate `createAdminClient()` elevation
  - service call
- This confirms Feature 070 must add explicit role enforcement to capture and review routes, including upgrade-request surfaces touched by 071.

## Options considered

### Option A - Fixed-role first slice

Description:

- Keep one `memberships.role` column.
- Expand it to the bounded role set needed now.
- Build explicit server-side permission helpers from roles.

Pros:

- Best fit for the current repo.
- Smallest schema and UI surface.
- Easiest to test and reason about.
- Compatible with existing `owner/admin/photographer` model.

Cons:

- Less flexible than future capabilities.

### Option B - Capability flags

Description:

- Replace roles with explicit capability grants.

Pros:

- More flexible long term.

Cons:

- Too large for the repo's current maturity.
- Turns Feature 070 into an IAM system instead of a bounded foundation.

### Option C - Role plus capability layering

Description:

- Add both roles and overrides in the first slice.

Pros:

- Future-proof.

Cons:

- Still too large.
- Adds product and UI complexity that the current repo does not need yet.

## Recommendation

Choose Option A.

Feature 070 should stay role-based and tenant-scoped:

- `memberships` remains the only organization relationship.
- `owner` remains for bootstrap compatibility.
- `admin`, `reviewer`, and `photographer` are the bounded working roles.
- Permission logic is enforced through explicit server-side helpers and adopted across tenant, capture, and review routes.

This is the best bounded fit because it fixes the current security and organization-management gap without expanding into a generic IAM platform.

## Chosen architecture

### Core model

- `memberships` remains the source of truth for tenant membership.
- `memberships.role` is expanded to:
  - `owner`
  - `admin`
  - `reviewer`
  - `photographer`
- `owner` remains bootstrap/system-compatible and is not user-assignable in Feature 070.
- Organization invites are stored in a new tenant-scoped invite table and accepted into `memberships`.
- Photographers and reviewers remain normal tenant members, not separate organization relationships.

### First-slice bounded decisions

- Feature 070 stays role-based, not capability-table based.
- `owner` stays distinct to preserve bootstrap compatibility.
- Feature 070 will not add owner-transfer or owner-promotion UX.
- Inviteable roles in Feature 070 are:
  - `admin`
  - `reviewer`
  - `photographer`
- Owner memberships are visible but not editable through the first-slice member-management UI/API.

### Project access model

- Tenant membership remains the broad project visibility boundary for Feature 070.
- Feature 070 does not redesign project assignment/work allocation.
- All tenant members can still list and open projects in the active tenant.
- Action permissions inside projects become role-gated.

## Exact role and permission matrix

### Tenant-wide actions

| Action | owner | admin | reviewer | photographer |
| --- | --- | --- | --- | --- |
| List tenant members and pending invites | yes | yes | no | no |
| Invite members by email | yes | yes | no | no |
| Assign invite role `admin` | yes | yes | no | no |
| Assign invite role `reviewer` | yes | yes | no | no |
| Assign invite role `photographer` | yes | yes | no | no |
| Assign role `owner` | no | no | no | no |
| Change non-owner member roles | yes | yes | no | no |
| Remove non-owner memberships | yes | yes | no | no |
| View owner memberships | yes | yes | no | no |
| Edit/remove owner memberships | no | no | no | no |
| Manage templates | yes | yes | no | no |
| Manage recurring profiles | yes | yes | no | no |
| Create tenant-owned organization projects | yes | yes | no | no |

### Project capture and review actions

| Action | owner | admin | reviewer | photographer |
| --- | --- | --- | --- | --- |
| View project/list project | yes | yes | yes | yes |
| Create one-off invites | yes | yes | no | yes |
| Revoke one-off invites | yes | yes | no | yes |
| Add recurring participants to project | yes | yes | no | yes |
| Create recurring project consent requests | yes | yes | no | yes |
| Upload assets / batch prepare | yes | yes | no | yes |
| Finalize uploaded assets | yes | yes | no | yes |
| Access review surfaces and review APIs | yes | yes | yes | no |
| Create review sessions | yes | yes | yes | no |
| Link/unlink faces or assignees | yes | yes | yes | no |
| Create manual faces | yes | yes | yes | no |
| Block faces | yes | yes | yes | no |
| Suppress/hide faces | yes | yes | yes | no |
| Initiate consent upgrade requests | yes | yes | yes | no |

### Interpretation

- `owner` and `admin` are full tenant managers and can perform both capture and review work.
- `photographer` is capture-oriented and cannot perform review-governance actions.
- `reviewer` is review-oriented and cannot perform capture-creation or upload actions.
- `photographer` cannot create tenant-owned organization projects.
- A person may still create projects in a different tenant where they are `owner` or `admin`; that is separate from the `photographer` role in an organization tenant.

This matrix is intentionally action-based. Project workflow state modeling is deferred.

---
## Exact membership and invite model

### New table

Create `public.tenant_membership_invites`.

Required columns:

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null references public.tenants(id) on delete restrict`
- `email text not null`
- `normalized_email text not null`
- `role text not null check (role in ('admin', 'reviewer', 'photographer'))`
- `status text not null check (status in ('pending', 'accepted', 'revoked', 'expired'))`
- `token_hash text not null unique`
- `invited_by_user_id uuid not null references auth.users(id) on delete restrict`
- `accepted_by_user_id uuid null references auth.users(id) on delete restrict`
- `revoked_by_user_id uuid null references auth.users(id) on delete restrict`
- `expires_at timestamptz not null`
- `last_sent_at timestamptz not null default now()`
- `accepted_at timestamptz null`
- `revoked_at timestamptz null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Indexes and constraints:

- partial unique index on `(tenant_id, normalized_email)` where `status = 'pending'`
- index on `(tenant_id, status, created_at desc)`
- index on `(tenant_id, normalized_email)`

### Invite state model

- `pending`
  - single active invite per tenant and normalized email
- `accepted`
  - invite consumed into membership or already-member acceptance
- `revoked`
  - invalidated by admin/owner action
- `expired`
  - pending invite that aged out and was marked stale by create/resend/accept logic

### Duplicate pending invite rule

Feature 070 will not create multiple parallel pending invites for the same tenant/email pair.

Create-or-resend behavior:

- Before create-or-refresh logic runs, any pending invite for the same tenant/email whose `expires_at <= now()` should be marked `expired`.
- If a pending invite already exists for `(tenant_id, normalized_email)`:
  - update the existing row in place
  - overwrite `role` with the latest requested role
  - rotate `token_hash`
  - refresh `expires_at`
  - update `last_sent_at`
  - keep the same invite `id`

This keeps the feature idempotent and avoids pending-invite fanout.

### Acceptance flow

#### New email / new account

1. Admin/owner creates invite by email.
2. Invite email delivers a join link.
3. Invite page requires authentication.
4. If the user does not yet have an account, they create one with the invited email.
5. After authentication, acceptance validates the authenticated email against the invite email.
6. Membership is inserted for the invited role.
7. Invite is marked accepted.

#### Existing email / existing account

1. Admin/owner creates invite by email.
2. Existing account signs in with that same email.
3. Acceptance validates email match.
4. If membership does not exist, insert it.
5. Mark invite accepted.

#### Already-member

Acceptance behavior:

- If the accepting authenticated user is already a member of the tenant:
  - do not insert a duplicate membership
  - mark the invite accepted with that user if still pending
  - return an idempotent `already_member` outcome

Invite-creation behavior:

- If the target email already belongs to a current tenant member, the create-invite service returns `already_member` and does not create a pending invite.

#### Revoked or expired invite

- Revoked invite cannot be accepted.
- Expired invite cannot be accepted.
- Acceptance marks stale pending invites as `expired` before returning the error outcome.

### Retry-safe acceptance

Acceptance should be implemented as a single transaction in a security-definer SQL function or equivalent server-side transaction boundary.

Acceptance steps:

1. Resolve invite by token hash and lock row.
2. Ensure status is `pending`.
3. If expired, mark `expired` and stop.
4. Resolve authenticated user from `auth.uid()`.
5. Resolve authenticated email from `auth.users`.
6. Compare normalized authenticated email to `normalized_email`.
7. If mismatch, stop with `invite_email_mismatch`.
8. If membership exists, return `already_member`.
9. Else insert membership with invite role.
10. Mark invite accepted with `accepted_by_user_id` and `accepted_at`.
11. Return tenant and membership summary.

Idempotent retry rules:

- repeating the same acceptance after success returns the same accepted/already-member outcome
- repeating after membership insert but before client response does not create duplicates

## Exact relationship between tenant membership, photographer role, and project access

- Photographers remain ordinary tenant members with role `photographer`.
- Reviewers remain ordinary tenant members with role `reviewer`.
- No second organization relationship is introduced.
- Project access remains additive on top of tenant membership.
- Feature 070 does not narrow project visibility by assignment.

### First-slice project creation/access rule

- `owner` and `admin` can create tenant-owned organization projects.
- `reviewer` cannot create projects.
- `photographer` cannot create tenant-owned organization projects.
- All tenant members can list and open projects in the active tenant.
- Action permissions within the project are then role-gated by helper checks.
- A user may still create projects in a separate personal tenant only if they are `owner` or `admin` there.

This is the smallest bounded fit because it avoids a project-assignment redesign while still aligning photographer and reviewer workflows with the requested product model.

---
## Exact active-tenant plan

### Chosen minimal design

Use a single server-validated HTTP-only cookie:

- `sc_active_tenant`

Optional supporting cookie for invited onboarding:

- `sc_pending_org_invite`

### Resolution behavior

Introduce a new tenant-resolution path that separates active-tenant selection from bootstrap:

- `resolveActiveTenantId(...)`
  - validates `sc_active_tenant` against current memberships
  - if exactly one membership exists, returns that tenant without requiring a cookie
  - if multiple memberships exist and the cookie is valid, returns that tenant
  - if multiple memberships exist and no valid cookie exists, raises `active_tenant_required`
  - if zero memberships exist, returns `null`

- `ensureTenantId(...)`
  - first tries `resolveActiveTenantId(...)`
  - if an active tenant is resolved, returns it
  - if zero memberships and `sc_pending_org_invite` is present, raises `pending_org_invite_acceptance_required`
  - if zero memberships and no pending invite cookie exists, calls the existing bootstrap RPC

### User behavior

Single-membership user:

- no selector required
- tenant resolves automatically

Multi-membership user:

- must choose an active tenant before entering protected workspace flows
- selection sets `sc_active_tenant`

Tenant switching:

- handled by a very small switcher UI in the protected header
- switch action posts selected tenant id to a route handler
- server validates membership before setting the cookie

### Minimal UI for active tenant

- dedicated page `/select-tenant` for the first-required choice when no active tenant is set
- small header switcher for later switching
- no broader account settings page

This is the smallest safe version because the cookie is never authoritative on its own; membership validation remains server-side on every resolution.

## Exact invite and onboarding flow

### Public route shape

- `GET /join/[token]`
  - public invite landing page
- `POST /join/[token]/accept`
  - authenticated acceptance action

### Auth interaction

Extend auth routes for invite-safe redirects:

- `POST /auth/login`
  - add optional `next` support
- add `POST /auth/sign-up`
  - invite-scoped signup path with optional `next`

Minimal invite UX:

- unauthenticated join page shows invite summary and two paths:
  - sign in with the invited email
  - create account with the invited email
- invite email field is fixed to the invited email in both flows
- on success, auth redirects back to `/join/[token]`
- if signup does not immediately create a session because email confirmation is required, show a confirmation-required state and complete acceptance only after the user returns authenticated

Authenticated join page behavior:

- if authenticated email does not match invite email:
  - show mismatch screen
  - offer sign out and retry
- if it matches:
  - show tenant name and invited role
  - show explicit "Join organization" confirmation button

### Why explicit acceptance is chosen

- safer than automatic join-on-page-load
- clearer for already-authenticated users with multiple org memberships
- keeps the acceptance write path behind an intentional POST

### Solving the auto-bootstrap conflict

When a user enters the org-invite onboarding flow:

- set `sc_pending_org_invite` before redirecting into login/signup
- if the authenticated user has zero memberships and that cookie is present:
  - protected layout and `ensureTenantId(...)` must not bootstrap a personal owner tenant
  - instead redirect to `/join/[token]`

After successful acceptance:

- clear `sc_pending_org_invite`
- set `sc_active_tenant` to the accepted tenant
- redirect to `/projects`

This preserves bootstrap compatibility for normal new users while preventing accidental personal-tenant creation during invited onboarding.

## Exact outbound email integration plan

### New email kind

Add a new typed outbound email kind:

- `tenant_membership_invite`

### Files to extend

- `src/lib/email/outbound/types.ts`
- `src/lib/email/outbound/registry.ts`
- `src/lib/email/outbound/jobs.ts`
- new renderer:
  - `src/lib/email/outbound/renderers/tenant-membership-invite.ts`

### Payload shape

`tenant_membership_invite` payload should include:

- `inviteId`
- `tenantId`
- `tenantName`
- `invitedEmail`
- `role`
- `inviteToken`
- `expiresAtIso`
- `inviterDisplayName`

The renderer should build the external accept URL using:

- `APP_ORIGIN`
- `src/lib/url/external-origin.ts`

### Dedupe and enqueue behavior

Dedupe key:

- `tenant_membership_invite:${inviteId}:${lastSentAtIso}`

This allows resends for the same invite row while still deduping immediate retries of the same enqueue attempt.

Enqueue points:

- create invite
- resend invite

Delivery pattern:

- enqueue typed job through the existing outbound email foundation
- optionally dispatch immediately using the same best-effort pattern already used by consent receipts
- do not call SMTP/provider code directly from invite feature code

## Exact server-side permission-helper and route-enforcement plan

### New DB helpers

Add new security-definer helpers:

- `app.current_user_membership_role(p_tenant_id uuid)`
- `app.current_user_can_manage_members(p_tenant_id uuid)`
- `app.current_user_can_create_projects(p_tenant_id uuid)`
- `app.current_user_can_capture_project(p_tenant_id uuid, p_project_id uuid)`
- `app.current_user_can_review_project(p_tenant_id uuid, p_project_id uuid)`

Keep and adapt existing helpers:

- `app.current_user_can_manage_templates(...)`
- `app.current_user_can_manage_recurring_profiles(...)`

These should continue to return true only for `owner` and `admin`.

### New app helpers

- `resolveTenantMembership(...)`
  - returns role and tenant-scoped booleans
- `resolveTenantPermissions(...)`
  - for members page, invite flows, template/profile management, project creation
- `resolveProjectPermissions(...)`
  - returns:
    - `canCapture`
    - `canReview`
    - `canCreateOneOffInvites`
    - `canCreateRecurringProjectConsentRequests`
    - `canUploadAssets`
    - `canInitiateConsentUpgradeRequests`

### Routes/services to harden first

#### Tenant and member-management

- new members list/invite/mutate APIs
- new join/accept APIs
- active-tenant switch API

#### Existing capture-phase routes

- `src/app/api/projects/route.ts`
- `src/app/api/projects/[projectId]/invites/route.ts`
- `src/app/api/projects/[projectId]/invites/[inviteId]/revoke/route.ts`
- `src/lib/projects/project-participants-route-handlers.ts`
- `src/lib/projects/project-participants-service.ts`
- `src/app/api/projects/[projectId]/assets/batch/prepare/route.ts`
- `src/app/api/projects/[projectId]/assets/batch/finalize/route.ts`
- `src/app/api/projects/[projectId]/assets/preflight/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/finalize/route.ts`

Required permission:

- capture-phase routes require `owner`, `admin`, or `photographer`

#### Existing review-phase routes

- `src/lib/projects/project-consent-upgrade-route-handlers.ts`
- `src/lib/projects/project-consent-upgrade-service.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/faces/[assetFaceId]/assignment/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/manual-faces/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/blocked-faces/[assetFaceId]/route.ts`
- `src/app/api/projects/[projectId]/assets/[assetId]/hidden-faces/[assetFaceId]/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/review-sessions/**`
- `src/app/api/projects/[projectId]/consents/[consentId]/assets/**`
- `src/app/api/projects/[projectId]/assets/[assetId]/preview-*`
- `src/app/api/projects/[projectId]/assets/[assetId]/whole-asset-*`

Required permission:

- review-phase routes require `owner`, `admin`, or `reviewer`

### Post-071 note

Feature 071 did not add role gating to upgrade or participant flows. Those routes remain first-pass hardening targets in Feature 070.

## Exact data mutation model for memberships

### Role changes

- Role updates apply only to non-owner memberships.
- Supported target roles:
  - `admin`
  - `reviewer`
  - `photographer`
- `owner` is not assignable or removable through Feature 070 UI/API.

### Membership removal model

Use hard delete for non-owner memberships in Feature 070.

Reasoning:

- simplest first slice
- fits the existing `(tenant_id, user_id)` primary key
- allows clean re-invite later
- avoids adding status complexity before audit/history features exist

Future audit/history can layer on later without blocking the first slice.

### Re-invite after removal

- because removal hard-deletes the membership row, later re-invite is just a new invite
- accepted or revoked historical invite rows remain as historical records
- acceptance creates a fresh membership row with the new role

## Exact UI and API boundary

### Admin/member-management UI

Add one small protected page:

- `/members`

Visible only to:

- `owner`
- `admin`

Page contents:

- active members list
- pending invites list
- invite form
- inline role-change control for non-owner members
- inline remove control for non-owner members
- pending invite resend action
- pending invite revoke action

### Active-tenant UI

- `/select-tenant`
  - required chooser when multi-membership user has no valid active tenant
- compact header switcher
  - only when user has more than one membership

### Minimal API boundary

- `GET /api/members`
  - list active members and pending invites for active tenant
- `POST /api/members/invites`
  - create or refresh invite
- `POST /api/members/invites/[inviteId]/resend`
  - resend pending invite
- `POST /api/members/invites/[inviteId]/revoke`
  - revoke pending invite
- `PATCH /api/members/[userId]`
  - update non-owner role
- `DELETE /api/members/[userId]`
  - remove non-owner membership
- `POST /join/[token]/accept`
  - accept invite
- `POST /api/tenants/active`
  - validate membership and set active-tenant cookie

This is sufficient for Feature 070 without expanding into a general settings platform.

## Security and reliability considerations

- Tenant scoping remains server-derived everywhere.
- `tenant_id` is never accepted from the client.
- Active tenant cookie is validated against memberships on every resolution.
- Member-management APIs must require `owner/admin` before any invite or mutation action.
- Review routes that use `createAdminClient()` must add role checks before elevation.
- Invite acceptance must validate authenticated email against invite email server-side.
- Invite tokens must be stored hashed, not plaintext.
- Invite creation/resend/acceptance must be idempotent and retry-safe.
- Pending invite uniqueness must prevent duplicate parallel invites.
- Revoked and expired invites must stop acceptance reliably.
- Membership creation must remain unique on `(tenant_id, user_id)`.
- Feature 070 should not weaken existing template/profile management restrictions.

## Edge cases

- Multi-org member with no chosen active tenant:
  - redirect to `/select-tenant`
- Invite accepted while logged into the wrong email:
  - show mismatch state, do not accept
- Duplicate invite submit:
  - update or reuse the single pending invite row
- Resend with changed role:
  - update the pending invite role, rotate token, resend
- Membership already exists:
  - create-invite returns `already_member`
  - accept returns idempotent `already_member`
- Membership removed then re-invited:
  - new invite and new membership row
- Signup that requires email confirmation before session creation:
  - invite remains pending
  - acceptance completes only after authenticated return to `/join/[token]`
- Owner bootstrap conflict during invited onboarding:
  - pending invite cookie suppresses bootstrap and routes user back to join flow
- Reviewer vs photographer on upgrade requests:
  - reviewers allowed
  - photographers forbidden
- Reviewer vs photographer on review routes:
  - reviewers allowed
  - photographers forbidden
- Reviewer vs photographer on upload/capture routes:
  - photographers allowed
  - reviewers forbidden
- Reviewer vs photographer on organization project creation:
  - owner/admin allowed
  - reviewer forbidden
  - photographer forbidden
- Same human across different tenants:
  - may still create projects in a separate personal tenant if they are `owner` or `admin` there
  - must not gain organization-project creation rights from having `photographer` role in another tenant

---

## Test plan

### Schema and service tests

- membership role constraint includes `reviewer`
- pending invite uniqueness on `(tenant_id, normalized_email)` for `status = 'pending'`
- invite create/update/resend service behavior
- invite accept transaction behavior
- non-owner membership role update behavior
- non-owner membership hard delete behavior

### Invite acceptance and idempotency tests

- new email signup then accept
- existing account accept into second tenant
- already-member invite create returns `already_member`
- duplicate pending invite reuses same row
- resend rotates token and updates role
- revoked invite cannot be accepted
- expired invite cannot be accepted
- accept while logged into wrong email fails
- retry after partial accept returns idempotent accepted/already-member result

### Active-tenant tests

- single-membership user resolves tenant automatically
- multi-membership user with no active cookie gets `active_tenant_required`
- multi-membership user with valid cookie resolves selected tenant
- invalid active-tenant cookie is ignored/rejected
- zero-membership user with pending invite cookie does not bootstrap
- zero-membership user without pending invite cookie still bootstraps as before

### Role-permission tests

- template and recurring profile routes:
  - reviewer blocked
  - photographer blocked
- project creation:
  - owner/admin allowed
  - reviewer blocked
  - photographer blocked
- cross-tenant role behavior:
  - user with `photographer` role in Organization A cannot create Organization A projects
  - same user can still create projects in Tenant B if they are `owner` or `admin` there
- one-off invite creation:
  - owner/admin/photographer allowed
  - reviewer blocked
- recurring project consent request creation:
  - owner/admin/photographer allowed
  - reviewer blocked
- asset upload/finalize:
  - owner/admin/photographer allowed
  - reviewer blocked
- review and linking routes:
  - owner/admin/reviewer allowed
  - photographer blocked
- consent upgrade request route:
  - owner/admin/reviewer allowed
  - photographer blocked

### Outbound email invite job tests

- new `tenant_membership_invite` payload parsing
- renderer output
- dedupe behavior for create vs resend
- enqueue on invite create
- enqueue on resend

### Minimal UI/route coverage

- `/members` visibility and action controls for owner/admin only
- `/select-tenant` required state for multi-membership users
- header switcher sets active tenant successfully
- `/join/[token]` mismatch state
- `/join/[token]` authenticated confirmation state

## Implementation phases

### Phase 1 - Schema, role model, and permission helpers

1. Add `reviewer` to membership role constraint.
2. Add invite table and indexes.
3. Add DB role/permission helpers.
4. Add app permission helpers.
5. Update existing template/profile helpers to understand the new role set.

### Phase 2 - Invite storage, acceptance, and outbound email integration

1. Add invite create/refresh/revoke/accept SQL or server transaction layer.
2. Add token hashing and join route loading.
3. Add `tenant_membership_invite` outbound email kind, renderer, and enqueue helpers.
4. Add invite create/resend routes.
5. Add authenticated accept route.

### Phase 3 - Member-management UI and API

1. Add `/members` page.
2. Add member list and pending invite list.
3. Add invite form.
4. Add inline role change and remove controls.
5. Add resend and revoke controls for pending invites.

### Phase 4 - Active-tenant handling

1. Add active-tenant resolution helper split.
2. Add `sc_active_tenant` cookie validation and setter route.
3. Add `/select-tenant` page.
4. Add header switcher.
5. Add pending invite cookie behavior to prevent bootstrap conflicts.

### Phase 5 - Project and review route enforcement

1. Harden project creation route so only `owner` and `admin` can create tenant-owned organization projects.
2. Harden capture-phase invite/participant/upload routes.
3. Harden review-phase upgrade/review/linking/manual-face routes.
4. Hide or disable UI affordances based on resolved permissions where needed.

### Phase 6 - Tests and verification

1. Add schema/service/idempotency tests.
2. Add active-tenant tests.
3. Add role-permission route tests.
4. Add invite email job tests.
5. Run targeted test set and lint.

## Scope boundaries

### Feature 070 implements now

- fixed-role tenant RBAC foundation
- `reviewer` role addition
- tenant membership invite storage and acceptance
- existing-account membership reuse by email
- bounded member-management UI/API
- minimal active-tenant selection and switching
- explicit server-side role gates for tenant, capture, and review actions
- outbound email foundation reuse for organization invites

### Follow-up features handle later

- owner transfer / owner promotion flows
- richer project assignment and work allocation
- project lifecycle state machine
- agency/client hierarchy
- broader org/account settings
- capability editor / enterprise IAM
- SSO
- billing/subscription
- advanced audit console
- one-off vs recurring identity merge

