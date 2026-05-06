# Feature 100 - Account and Organization Onboarding UX Plan

## 1. Title and Feature ID

Feature 100 - Account and Organization Onboarding UX.

This is the RPI plan phase only. Do not implement application code, migrations, templates, tests, messages, or Supabase config changes during this phase.

## 2. Inputs and Ground Truth

Required context read:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/SUMMARY.md`
- `docs/rpi/PROMPTS.md`
- `docs/rpi/100-account-and-organization-onboarding-ux/research.md`

Targeted live-code verification used:

- `supabase/config.toml`
- `.env.example`
- `README_APP.md`
- `UNCODEXIFY.MD`
- `src/app/page.tsx`
- `src/app/login/page.tsx`
- `src/app/auth/login/route.ts`
- `src/app/auth/logout/route.ts`
- `src/app/auth/sign-up/route.ts`
- `src/lib/supabase/server.ts`
- `src/lib/supabase/middleware.ts`
- `src/app/(protected)/layout.tsx`
- `src/app/(protected)/dashboard/page.tsx`
- `src/app/select-tenant/page.tsx`
- `src/app/join/[token]/page.tsx`
- `src/app/join/[token]/accept/route.ts`
- `src/lib/tenant/resolve-tenant.ts`
- `src/lib/tenant/active-tenant.ts`
- `src/lib/tenant/membership-invites.ts`
- `src/lib/tenant/member-management-route-utils.ts`
- `src/lib/tenant/member-management-service.ts`
- `src/lib/email/outbound/`
- `src/lib/url/external-origin.ts`
- `src/lib/url/paths.ts`
- `messages/en.json`
- `messages/nl.json`
- migrations for tenants, memberships, tenant bootstrap, and membership invites
- tests for tenant resolution, active tenant filtering, invite acceptance, and outbound email

Ground truth order for implementation:

1. Live code and migrations.
2. Live tests.
3. This plan.
4. Feature 100 research.
5. Older RPI docs.

`.env.local` must not be inspected. All SMTP examples must use placeholders only.

## 3. Targeted Verification Summary

Current auth and public routes:

- `/` is public and links to `/login` and `/dashboard`.
- `/login` is sign-in only.
- There is no `/create-account` route.
- `POST /auth/sign-up` exists and is currently used by `/join/[token]`.
- There is no app-owned `/auth/callback` or `/auth/confirm` route.
- No live code calls `exchangeCodeForSession` or `verifyOtp`.

Current confirmation configuration:

- `supabase/config.toml` has `auth.email.enable_confirmations = false`.
- Local `auth.site_url` is `http://127.0.0.1:3000`.
- `.env.example` has `APP_ORIGIN=http://localhost:3000`, so local Auth redirect docs/config should be aligned.
- No custom Supabase Auth confirmation template exists.
- `[auth.email.smtp]` is only a commented SendGrid-style example.
- Inbucket is enabled for local email viewing.

Current tenant resolution:

- `resolveTenantId` and `ensureTenantId` currently auto-bootstrap a zero-membership user through `public.ensure_tenant_for_current_user()`.
- The bootstrap RPC creates a tenant named from the auth email local part and inserts an owner membership.
- A `sc_pending_org_invite` cookie suppresses auto-bootstrap and routes users back to `/join/[token]`.
- Feature 099 current-user membership filtering is live.

Current invite acceptance:

- `/join/[token]` validates a token and renders invite details, terminal states, wrong-account state, and both sign-in/sign-up panels for unauthenticated users.
- Invite acceptance still validates authenticated email server-side in `accept_tenant_membership_invite`.
- No token-scoped account-existence tailoring exists today.

Current email foundation:

- SnapConsent product outbound email kinds are `consent_receipt` and `tenant_membership_invite`.
- Account confirmation is not an outbound email job.
- Product email SMTP env vars are `EMAIL_TRANSPORT` and `SMTP_*`; these are separate from Supabase Auth SMTP.

## 4. Chosen Architecture

Choose Option A: Supabase Auth-owned confirmation with a branded Supabase Auth template.

Architecture decisions:

- Supabase Auth remains responsible for signup confirmation token generation, expiry, verification, and redirect.
- SnapConsent adds a branded Supabase Auth confirmation template.
- SnapConsent enables/document local and hosted Supabase Auth email confirmation.
- SnapConsent documents Auth SMTP separately from product outbound SMTP.
- Account confirmation does not become an `outbound_email_jobs` kind.
- No app-owned auth-token table, custom token verification system, or password-reset/magic-link redesign is introduced.

This keeps Feature 100 a UI/UX onboarding slice and avoids broad auth or email-foundation redesign.

## 5. Exact Scope Boundary

In scope:

- Public `/create-account` page.
- Homepage create-account link.
- Sign-up check-email state.
- `POST /auth/sign-up` redirect adjustments for confirmation.
- Supabase local email confirmation enablement.
- Supabase Auth confirmation email template at `supabase/templates/confirmation.html`.
- Supabase Auth SMTP documentation and placeholder-only local config comments.
- `/organization/setup` page with Organization wording, an optional organization name field, and a default organization path for solo or fast-start users.
- First-organization creation backend path.
- No-membership routing to setup instead of implicit auto-bootstrap.
- Invite page guidance based on valid-token, invite-bound account state.
- English and Dutch i18n keys for new UI copy.
- Focused tests and manual validation docs.

Out of scope:

- Account confirmation through SnapConsent `outbound_email_jobs`.
- Custom Auth token verification or token tables.
- Password reset, magic link, email change, or Supabase Auth invite template redesign.
- RBAC, custom-role, scoped-permission, reviewer-access, photographer-assignment, project-permission, member-page, dashboard, or public consent flow redesign.
- Advanced organization settings, legal/controller fields, logo, billing, default language, contact email, or production DNS/SPF/DKIM/DMARC setup.
- New product email job kinds.

Product wording boundary:

- Use "Organization" for first-run onboarding.
- Do not use "Workspace" for first-run setup copy.
- Backend concepts can continue to use tenant terminology.
- Do not rename database tables, backend domain concepts, or project workspace semantics.

## 6. Confirmation Link Strategy

Choose strategy A: direct Supabase `{{ .ConfirmationURL }}`.

Exact behavior:

- `POST /auth/sign-up` passes `options.emailRedirectTo` to Supabase Auth.
- The redirect URL is an absolute URL for `/login?confirmed=1`.
- The confirmation template links to `{{ .ConfirmationURL }}`.
- Supabase Auth verifies the token and redirects to `/login?confirmed=1`.
- `/login?confirmed=1` shows a SnapConsent confirmation-complete message and a sign-in form.
- The user signs in with email/password after confirmation.

Exact local redirect URL:

- Canonical local app origin for Auth should be `http://localhost:3000`.
- Local `supabase/config.toml` should set `auth.site_url = "http://localhost:3000"`.
- Local `auth.additional_redirect_urls` should include the exact confirmation landing URL used by `emailRedirectTo`, at minimum `http://localhost:3000/login?confirmed=1`.

Implementation detail:

- Build `emailRedirectTo` from the request origin and the fixed path `/login?confirmed=1`.
- Do not include invite tokens or arbitrary `next` paths in `emailRedirectTo`.
- Invite-originated signups return after login through the existing `sc_pending_org_invite` cookie. After login defaults to `/dashboard`, the protected layout sees the pending invite cookie and redirects to `/join/[token]`.

Why not `/auth/confirm` now:

- Direct `{{ .ConfirmationURL }}` is the smallest safe path.
- It keeps Supabase Auth fully responsible for verification.
- The UX cost is that confirmation does not automatically create an app session; the user confirms and then signs in.
- That is acceptable for this feature and avoids introducing `verifyOtp` route behavior.

## 7. Public Create-Account Flow Plan

New route:

- Add `src/app/create-account/page.tsx`.

Unauthenticated page behavior:

- Render a compact SnapConsent account creation form with:
  - email
  - password
  - submit button
  - link back to `/login`
  - language switch
- Use existing visual language: normal labels, normal inputs, restrained cards, no marketing hero redesign.
- Form posts to `POST /auth/sign-up`.

Hidden form values:

- `next=/dashboard`
- `confirmation_redirect=/create-account`
- no `pending_org_invite_token`

Already authenticated page behavior:

- If the user is authenticated and `email_confirmed_at` is missing, show the check-email state and a sign-out action.
- If the user has a pending invite cookie, redirect to `/join/[token]`.
- If the user has zero memberships, redirect to `/organization/setup`.
- If the user has one membership, redirect to `/projects`.
- If the user has multiple memberships and no valid active tenant, redirect to `/select-tenant`.

Sign-up route adjustment:

- Keep `POST /auth/sign-up` as the shared route for public signup and invite signup.
- Add support for a `confirmation_redirect` form field.
- Normalize `next` and `confirmation_redirect` as relative paths only.
- Restrict signup redirects to known onboarding destinations:
  - `/dashboard`
  - `/projects`
  - `/create-account`
  - `/organization/setup`
  - `/select-tenant`
  - `/join/<token>`
- Default success `next` to `/dashboard`.
- Default no-session `confirmation_redirect` to `/create-account`.

Supabase response handling:

- If Supabase returns an error, map existing errors and redirect to the normalized error target.
- If Supabase returns a session for a confirmed user, redirect to `next`.
- If Supabase returns no session, redirect to `confirmation_redirect?confirmation=1`.
- If Supabase returns a session for an unconfirmed user due to local/config drift, sign out defensively and redirect to `confirmation_redirect?confirmation=1`.

Errors:

- Public create-account maps `auth_error` values to translated UI messages.
- Existing invite error mapping remains.
- Do not show raw Supabase error details.

## 8. Supabase Auth Confirmation Config Plan

Local `supabase/config.toml` changes:

- Change `auth.email.enable_confirmations = true`.
- Align `auth.site_url` with `.env.example` and docs:

```toml
[auth]
site_url = "http://localhost:3000"
additional_redirect_urls = ["http://localhost:3000/login?confirmed=1"]
```

- Keep signup enabled.
- Keep local Inbucket enabled by default.

Hosted/staging/production instructions:

- Enable Confirm Email in hosted Supabase Auth settings.
- Set the hosted Site URL to the deployed app origin, for example `https://app.snapconsent.com`.
- Add the deployed confirmation landing URL to allowed redirect URLs, for example `https://app.snapconsent.com/login?confirmed=1`.
- Configure the hosted confirmation email template and subject to match the committed local template.
- Configure hosted Auth SMTP with the production sender/provider when production email is ready.

Defensive app guard:

- Add a lightweight app-level guard for authenticated users with missing `email_confirmed_at` in:
  - protected layout
  - `/organization/setup`
  - `/create-account`
- The guard should not verify tokens. It should only prevent unconfirmed sessions from reaching tenant-scoped app flows if Supabase config or local behavior returns a session unexpectedly.
- Preferred behavior is redirect/show `/create-account?confirmation=1` with a sign-out option, not tenant bootstrap.

Why Supabase remains sufficient:

- Supabase Auth should block password sign-in before confirmation when Confirm Email is enabled.
- The app guard is a defense-in-depth UI boundary, not a replacement for Supabase Auth confirmation.

## 9. Branded Confirmation Template Plan

Add template:

- `supabase/templates/confirmation.html`

Configure local template:

```toml
[auth.email.template.confirmation]
subject = "Confirm your SnapConsent account"
content_path = "./supabase/templates/confirmation.html"
```

Subject:

- `Confirm your SnapConsent account`

Template variables:

- Use `{{ .ConfirmationURL }}` for the primary link.
- Optionally use `{{ .Email }}` in plain body copy.
- Do not use `{{ .TokenHash }}` or `{{ .Token }}` because this plan does not add `/auth/confirm`.

Content structure:

- SnapConsent name at top.
- One concise sentence explaining that the user should confirm their account.
- One primary link to `{{ .ConfirmationURL }}`.
- Plain fallback copy with the same URL.
- Short note that the link expires.
- No Supabase wording.
- No provider names.
- No promotional or marketing-heavy copy.

Example wording guidance, not final code:

- "Confirm your SnapConsent account"
- "Use the link below to confirm this email address and finish setting up your account."
- "If you did not create this account, you can ignore this email."

## 10. Supabase Auth SMTP Plan

Local default:

- Keep Inbucket/local email capture as the default development path.
- Do not enable real Auth SMTP by default.
- With local confirmations enabled, developers should first validate Auth confirmation in Inbucket.

Optional local Gmail Auth SMTP:

- Document a commented `[auth.email.smtp]` block in `supabase/config.toml`.
- Use `SUPABASE_AUTH_SMTP_*` env names to avoid confusion with product email `SMTP_*`.
- Do not reuse app product email env names.

Placeholder shape:

```toml
# [auth.email.smtp]
# enabled = true
# host = "env(SUPABASE_AUTH_SMTP_HOST)"
# port = 587
# user = "env(SUPABASE_AUTH_SMTP_USER)"
# pass = "env(SUPABASE_AUTH_SMTP_PASSWORD)"
# admin_email = "env(SUPABASE_AUTH_SMTP_ADMIN_EMAIL)"
# sender_name = "SnapConsent"
```

Add placeholder-only `.env.example` comments:

```env
# Optional Supabase Auth SMTP for Auth-owned emails such as signup confirmation.
# Keep separate from SnapConsent product email SMTP_* settings.
# SUPABASE_AUTH_SMTP_HOST=smtp.gmail.com
# SUPABASE_AUTH_SMTP_PORT=587
# SUPABASE_AUTH_SMTP_USER=<GMAIL_ADDRESS>
# SUPABASE_AUTH_SMTP_PASSWORD=<GMAIL_APP_PASSWORD>
# SUPABASE_AUTH_SMTP_ADMIN_EMAIL=<GMAIL_ADDRESS>
```

Hosted Supabase:

- Configure Auth SMTP in the Supabase dashboard or Management API, not through app product email env vars.
- Production should use a custom-domain sender/provider such as `app@snapconsent.com`.
- DNS/provider setup is out of scope for this feature.

Risks:

- Gmail app passwords and sender aliases are development-only.
- Gmail rate limits and account policies may block testing.
- Secrets must stay in `.env.local` or local secret stores and never in committed files.

## 11. Boundary With SnapConsent Product Email Jobs

Preserve the split:

- Supabase Auth emails:
  - signup confirmation
  - password reset
  - magic link
  - email change
  - other Auth-owned lifecycle emails
- SnapConsent product email jobs:
  - `tenant_membership_invite`
  - `consent_receipt`
  - future product emails such as request/reminder/revoke-link resend

Do not:

- Add `account_confirmation` to `OUTBOUND_EMAIL_KINDS`.
- Send account confirmation through `src/lib/email/outbound/`.
- Call app SMTP transport from Auth signup.
- Move password reset, magic link, or email change into product email jobs.

Docs should explicitly say that both systems can point at the same local Gmail mailbox for testing, but they are configured separately.

## 12. No-Membership Organization Setup Plan

New route:

- Add `src/app/organization/setup/page.tsx`.
- Add `src/app/organization/setup/create/route.ts` for form POST.

Routing policy:

- Authenticated confirmed users with zero memberships and no pending invite cookie route to `/organization/setup`.
- Pending invite cookie takes priority and routes to `/join/[token]`.
- Users with one membership keep existing automatic tenant behavior.
- Users with multiple memberships keep existing `/select-tenant` behavior.

First-run product behavior:

- The setup screen uses Organization language.
- The screen explains that the organization is where projects, consent records, and media will live.
- The user can enter an organization name and create it.
- The user can also continue with a safe default organization.
- Either path creates the required tenant behind the scenes, creates an owner membership, sets the active tenant, and redirects to `/projects`.
- The default organization name is `My organization`.
- Do not derive the default name from the email local part in the first-run setup path.
- Renaming/configuring the organization is deferred to Feature 101.

Prevent implicit auto-bootstrap:

- Update tenant resolution so normal app resolution does not auto-call `ensure_tenant_for_current_user` for zero-membership users.
- Introduce an explicit no-membership error code such as `organization_setup_required`.
- Keep the existing bootstrap RPC available for legacy recovery/tests, but do not use it in normal protected layout or API tenant resolution.
- Update protected layout to handle `organization_setup_required` by redirecting to `/organization/setup`.
- Update `/select-tenant` so zero memberships without pending invite redirects to `/organization/setup`, not `/dashboard`.

Recommended resolver shape:

- Add a resolver option or sibling helper that controls missing-membership behavior:
  - normal app behavior: throw `organization_setup_required`
  - explicit legacy/recovery behavior: bootstrap using the existing RPC
- Default exported `resolveTenantId` and `ensureTenantId` should use the normal app behavior after this feature so direct API calls cannot silently create an email-derived tenant.
- Tests that intentionally verify legacy bootstrap should opt into the legacy/recovery behavior.

## 13. First Organization Creation Backend Plan

Choose option B: add a sibling RPC/helper specifically for explicit first-organization setup.

Do not extend `ensure_tenant_for_current_user`.

New SQL RPC:

- `app.create_first_tenant_for_current_user(p_name text default null)`
- public wrapper `public.create_first_tenant_for_current_user(p_name text default null)`
- grant execute to `authenticated`

Return shape:

- `outcome text` with values:
  - `created`
  - `existing_membership`
- `tenant_id uuid`
- `tenant_name text`

Validation:

- Trim input server-side.
- If a non-empty name is provided, reject names shorter than 2 characters.
- If a non-empty name is provided, reject names longer than 120 characters.
- If the name is missing or whitespace-only, use the safe default name `My organization`.
- Store the chosen custom name or default name in `tenants.name`.
- Do not derive the default from the auth email local part in this RPC.
- Do not accept `tenant_id` from the client.

Idempotency and race safety:

- Use `auth.uid()` as authority.
- Acquire a transaction-scoped advisory lock keyed by the current user id before checking memberships.
- Re-check memberships inside the lock.
- If any membership exists, return the oldest existing tenant with `existing_membership`.
- If no membership exists, insert one tenant and one owner membership.
- Because the lock is per user, double submits and two tabs should return the same existing membership after the first transaction commits.

Route handler:

- `POST /organization/setup/create`
- Requires authenticated user.
- Requires `user.email_confirmed_at`.
- Checks pending invite cookie first; if present, redirects to `/join/[token]`.
- Reads an optional organization name from the form.
- Calls the new RPC with the optional organization name.
- If outcome is `created`, set `sc_active_tenant` to the returned tenant id.
- If outcome is `existing_membership`, set `sc_active_tenant` only if that user has exactly one membership or if the returned tenant is safe to activate; otherwise redirect to `/select-tenant`.
- Redirect success to `/projects`.

Partial failure behavior:

- If DB write succeeds but cookie setting or redirect response is lost, the next request sees the membership and resolves normally.
- Retried POST returns `existing_membership`, not a duplicate tenant.

## 14. Organization Setup UI Plan

Page route:

- `/organization/setup`

Fields:

- Optional organization name field.
- Field label: `Organization name`.
- Suggested title: `Set up your organization`.
- Suggested helper copy: `This is where your projects, consent records, and media will live. You can use SnapConsent by yourself or invite others later.`
- Suggested custom-name action: `Create organization`.
- Suggested default action: `Continue with default organization`.
- Default path creates `My organization`.
- Use copy that feels normal for solo users and teams.
- Do not use "Workspace" in this first-run setup flow.

Unauthenticated behavior:

- Redirect to `/login?next=%2Forganization%2Fsetup`.

Unconfirmed behavior:

- Redirect or render check-email state through `/create-account?confirmation=1`.
- Do not create tenant membership.

Pending invite behavior:

- If `sc_pending_org_invite` exists, redirect to `/join/[token]`.

Existing membership behavior:

- One membership: redirect `/projects`.
- Multiple memberships: redirect `/select-tenant`.

Validation messages:

- Too short.
- Too long.
- Generic server failure.
- Empty name is allowed only for the default/skip action. If the custom-name action submits an empty field, either treat it as default only if the selected action says so, or show a clear "Enter a name or continue with the default organization" message.

Loading/submitting state:

- Standard form submit button copy should include a pending label if implemented with a client component.
- A server-only form is acceptable; keep UI minimal.

i18n:

- Add `organizationSetup` namespace to English and Dutch.
- Add title, helper body, name label, custom-name submit, default submit, validation, and fallback error keys.
- Avoid hardcoded UI strings in the component.

Future organization management:

- Feature 100 does not add an organization settings/profile page.
- It should not block a later Organization Settings feature from allowing owners/admins to rename and configure the tenant.
- Add a future-work note for `Feature 101 - Organization Settings`:
  - owner/admin can rename organization
  - optional organization profile fields can be added later
  - member invites and advanced access management remain separate surfaces unless planned explicitly

## 15. Invite Acceptance UX Plan

Validate invite token first:

- Keep `getPublicTenantMembershipInvite(supabase, token)` as the first public lookup.
- If invalid or terminal, render existing invalid/accepted/revoked/expired states without account-state lookup.
- Only after a valid pending invite is loaded should account-state tailoring run.

Account-state implementation:

- Prefer a server-only helper, not a public endpoint.
- Add a new service-only SQL RPC for auth account existence:
  - `app.auth_account_exists_for_email(p_email text)`
  - public wrapper callable only by `service_role`
  - revoke from `anon` and `authenticated`
- Add `src/lib/tenant/invite-account-state.ts` with `server-only`.
- The helper takes the already-loaded invite object, not arbitrary request email.
- The helper calls the service-role-only RPC with `invite.email`.
- The result is a coarse enum:
  - `known_account`
  - `no_known_account`
  - `unknown`

Why not extend the public invite RPC:

- Extending `get_public_tenant_membership_invite` would put account existence in an anon-callable function.
- A server-only helper keeps the lookup off public API surfaces and still limits it to valid invite-page rendering.

Unauthenticated UI:

- If `known_account`, show sign-in as the primary action:
  - copy: "Sign in with this email to accept the invite."
  - keep email fixed to invite email.
  - include a secondary create-account fallback only as plain guidance if needed.
- If `no_known_account`, show create-account as the primary action:
  - copy: "Create an account with this email to accept the invite."
  - keep email fixed to invite email.
  - include a secondary sign-in fallback for races or prior account creation.
- If `unknown`, show both actions or a neutral fallback similar to current behavior.

Authenticated UI:

- Logged in as invited email: show accept invite.
- Logged in as different email: keep wrong-account guidance and sign-out action.

Race behavior:

- If account state changes between render and submit, existing auth error mapping handles it:
  - signup returns `account_exists` and guides to sign in.
  - signin failure remains generic invalid credentials.
- Invite acceptance remains server-authoritative and validates authenticated email.

## 16. Routing and State Plan

Homepage:

- Add create-account link to `/create-account`.
- Keep sign-in link.
- Do not redesign homepage broadly.

Create account:

- `/create-account` unauthenticated default: show form.
- Submit success with confirmations enabled: `/create-account?confirmation=1`.
- Submit success with session returned: `/dashboard`, then protected routing.
- Error: `/create-account?auth_error=<code>`.

Confirmation:

- Email link uses Supabase `{{ .ConfirmationURL }}`.
- Supabase redirects to `/login?confirmed=1`.
- Login page shows confirmation-complete message.
- User signs in.

After sign-in:

- Pending invite cookie: protected layout redirects to `/join/[token]`.
- Zero memberships: protected layout redirects to `/organization/setup`.
- One membership: normal app, usually `/projects` or requested protected path.
- Multiple memberships without valid active tenant: `/select-tenant`.
- Multiple memberships with valid active tenant: normal app.

Invite signup before confirmation:

- `/join/[token]` sign-up posts fixed invite email.
- `POST /auth/sign-up` sets `sc_pending_org_invite`.
- No session: redirect `/join/[token]?confirmation=1`.
- After confirmation: `/login?confirmed=1`.
- After login: `/dashboard` -> protected layout -> `/join/[token]`.
- User accepts invite and is redirected to `/projects`.

Invite expires before confirmation:

- User returns to `/join/[token]`.
- Join page shows expired/unavailable state.
- If the user later enters the protected app with no memberships and no usable pending invite path, route to `/organization/setup`.

Already authenticated visiting `/create-account`:

- Unconfirmed: show check-email/sign-out state.
- Confirmed with pending invite: redirect `/join/[token]`.
- Confirmed with zero memberships: redirect `/organization/setup`.
- Confirmed with one membership: redirect `/projects`.
- Confirmed with multiple memberships: redirect `/select-tenant` unless active tenant is already valid.

Already authenticated visiting `/organization/setup`:

- Unconfirmed: check-email/sign-out state.
- Pending invite: redirect `/join/[token]`.
- Zero memberships: show setup form with custom-name and default organization actions.
- One membership: redirect `/projects`.
- Multiple memberships: redirect `/select-tenant`.

## 17. Documentation Plan

Update `README_APP.md`:

- Add "Auth Email Confirmation" section.
- Document local confirmation via Inbucket.
- Document optional local Gmail Auth SMTP with placeholders only.
- Document hosted Supabase Auth confirmation/template/SMTP setup.
- Explain that Auth emails and SnapConsent product emails are different systems.
- Document that first-run onboarding uses "Organization" as the user-facing term while backend tenant terminology remains unchanged.
- Document that users can choose a name or continue with the default `My organization`.

Update Feature 100 docs:

- Keep this plan's future-work note for `Feature 101 - Organization Settings`.

Update `.env.example`:

- Add commented `SUPABASE_AUTH_SMTP_*` placeholder names.
- Keep existing product `EMAIL_TRANSPORT` and `SMTP_*` env vars unchanged.
- Do not add real SMTP credentials.

Update `supabase/config.toml`:

- Enable local email confirmations.
- Set local site URL/redirect URL to the canonical localhost route.
- Add confirmation template config.
- Add optional commented Auth SMTP Gmail placeholder block using `SUPABASE_AUTH_SMTP_*`.

Do not:

- Inspect `.env.local`.
- Document real Gmail credentials.
- Commit app passwords.

## 18. Security and Privacy Considerations

Tenant authority:

- Do not accept `tenant_id` from the client for organization setup.
- Derive current user from Supabase server auth.
- New first-organization RPC uses `auth.uid()`.
- Organization setup accepts only an optional name; default creation uses a server-owned default name.

Account-existence privacy:

- Do not create a generic account lookup route.
- Do not accept arbitrary email input for account-state checks.
- Only check account state after valid invite token lookup and only for the invite-bound email.
- Keep account-state helper server-only and service-role-only.
- Prefer soft CTA wording rather than raw "this account exists" copy.

Service role:

- Do not expose service role key to client code.
- Any service-role helper must live in server-only code.
- Tests/docs must use placeholders only.

Invite safety:

- Pending invite cookie does not create membership.
- Accepting invite still uses existing RPC and validates authenticated email.
- Wrong-account state remains.

Email confirmation:

- Supabase Auth owns token generation, expiry, verification, and redirect.
- The app guard only prevents unconfirmed sessions from entering app flows.

RBAC boundary:

- No changes to custom roles, scoped permissions, reviewer access, photographer assignment, project permissions, or role administration.

## 19. Edge Cases

Retries and double submit:

- Signup route may be retried; Supabase returns account-exists or confirmation behavior.
- Organization setup RPC uses a per-user advisory lock and returns existing membership on retry.
- Retrying either the custom-name action or default action after creation returns the existing tenant rather than changing the name.
- Invite acceptance remains idempotent through existing accepted/already-member handling.

Races:

- Account existence can change between invite render and auth submit; existing auth errors handle fallback.
- Invite can expire between render and accept; existing acceptance RPC returns expired.
- First-organization setup can race across tabs; advisory lock avoids duplicate first tenants.

Expired sessions:

- Unauthenticated setup/create-account flows redirect to login.
- Expired session during setup POST redirects to login with `next=/organization/setup`.

Partial failures:

- Auth account created but email not delivered: Supabase Auth owns resend/retry behavior; a resend action is deferred unless implementation discovers a small safe existing method.
- Organization tenant created but response lost: retry returns existing membership.
- Organization default creation creates `My organization`; later rename belongs to Feature 101, not retry-time mutation.
- Active tenant cookie set fails: one-membership users still resolve automatically on the next request.
- Invite accepted but redirect lost: repeated acceptance returns already-member.

Config drift:

- If Confirm Email is disabled, signup may return a session. The sign-up route and protected guard should prevent unconfirmed access where detectable, but local/hosted setup must be validated manually.
- `localhost` versus `127.0.0.1` drift can break redirects; use `http://localhost:3000` consistently for Feature 100 local docs/config.

## 20. Test Plan

Add/update unit tests:

- Signup redirect helper normalizes allowed `next` and `confirmation_redirect`.
- Signup no-session result redirects to confirmation route.
- Signup session result redirects to success `next`.
- Signup unconfirmed-session branch signs out/redirects to confirmation if testable.
- Organization name validation accepts trimmed valid names.
- Organization setup accepts missing/blank name only for the default action and resolves it to `My organization`.
- Organization custom-name action rejects too short and too long names.
- Invite account-state UI derivation chooses:
  - sign-in primary for `known_account`
  - create-account primary for `no_known_account`
  - fallback for `unknown`
- i18n key parity exists for new English and Dutch keys.

Add/update tenant resolution tests:

- Zero-membership confirmed user now throws `organization_setup_required` instead of bootstrapping in normal resolution.
- Pending invite cookie still throws/routes `pending_org_invite_acceptance_required`.
- One membership still resolves automatically.
- Multiple memberships still require active tenant selection.
- Legacy/recovery bootstrap behavior remains available only when explicitly opted into, if the helper keeps that option.

Add database-backed tests:

- `create_first_tenant_for_current_user` creates a tenant with the chosen trimmed name when a valid name is provided.
- `create_first_tenant_for_current_user` creates a tenant named `My organization` when no name is provided.
- It creates an owner membership for the current auth user.
- It returns existing membership on retry.
- It does not create another tenant when user already has membership.
- It rejects invalid custom names.
- Concurrent/double-submit behavior is covered where practical, at least by sequential retry and optional parallel calls.
- Service-role-only account-existence RPC returns true/false for invite-bound emails when called by service role.
- The account-existence RPC is not executable by anon/authenticated clients.

Add route/UI-oriented tests where existing test patterns allow:

- Homepage includes create-account entry.
- `/create-account` unauthenticated state renders expected form/copy.
- `/organization/setup` routes existing-member users away and zero-member users to setup state with both custom-name and default actions where practical.
- `/join/[token]` preserves wrong-account, accepted, revoked, expired, and invalid states.
- `/join/[token]` chooses existing-account sign-in primary CTA and no-account create-account primary CTA.

Existing tests to update:

- `tests/feature-060-tenant-resolution-hardening.test.ts` for no-membership behavior.
- `tests/feature-099-active-tenant-current-user-membership-filtering.test.ts` if helper signatures change.
- `tests/feature-070-tenant-rbac-foundation.test.ts` for invite account-state/RPC additions.
- Feature 068/098 outbound email tests should not need behavior changes because Auth SMTP is separate.

Do not attempt to unit-test real email delivery through Gmail.

## 21. Manual Validation Plan

Local Inbucket validation:

1. Start Supabase local stack after config/template changes.
2. Run `npm run dev`.
3. Open `http://localhost:3000/create-account`.
4. Create an account.
5. Confirm no protected app access before confirmation.
6. Open Inbucket at `http://127.0.0.1:54324`.
7. Verify the confirmation email subject is `Confirm your SnapConsent account`.
8. Verify the email is SnapConsent-branded and does not mention Supabase.
9. Click confirmation link.
10. Verify landing at `/login?confirmed=1`.
11. Sign in and verify zero-membership user routes to `/organization/setup`.
12. Continue with the default organization and verify redirect to `/projects`.
13. Repeat with another test user, enter a custom organization name, and verify redirect to `/projects`.

Optional local Gmail Auth SMTP validation:

1. Put placeholder-derived real values only in `.env.local` or local shell environment.
2. Uncomment/configure `[auth.email.smtp]` locally as documented.
3. Restart Supabase local stack.
4. Repeat signup and verify the confirmation email is sent by Gmail SMTP.
5. Do not commit credentials or screenshots containing credentials.

Invite validation:

1. Create a tenant membership invite for an existing auth account.
2. Open `/join/[token]` signed out and verify sign-in is primary.
3. Create invite for an email with no auth account.
4. Open `/join/[token]` signed out and verify create-account is primary.
5. Sign up from invite, confirm email, sign in, return to invite, and accept.
6. Verify wrong-account, expired, revoked, and accepted states still work.

## 22. Implementation Phases

Phase 1 - Auth confirmation configuration and docs:

- Update `supabase/config.toml`.
- Add `supabase/templates/confirmation.html`.
- Update `.env.example`.
- Update `README_APP.md`.
- Add/adjust tests that can smoke-check template/config presence if practical.

Phase 2 - Signup and create-account UX:

- Add `/create-account`.
- Update homepage link.
- Update `/login` confirmed/check-email/error copy.
- Update `POST /auth/sign-up` redirect handling and `emailRedirectTo`.
- Add English/Dutch messages and focused tests.

Phase 3 - No-membership setup:

- Add explicit first-organization SQL RPC migration with optional name and server default `My organization`.
- Update tenant resolution to stop implicit normal auto-bootstrap.
- Add `/organization/setup` page and POST route.
- Include both custom-name and default organization actions.
- Update protected layout and `/select-tenant` routing.
- Add database-backed setup and tenant-resolution tests.

Phase 4 - Invite UX tailoring:

- Add service-role-only account-existence RPC/helper.
- Update `/join/[token]` account-state derivation and unauthenticated UI.
- Preserve existing accept route.
- Add/update invite tests.

Phase 5 - Final verification:

- Run targeted tests after each phase.
- Run broader `npm test` if feasible.
- Run `npm run lint`.
- Run manual Supabase Auth/Inbucket validation.

## 23. Non-Goals

- No SnapConsent outbound email job for account confirmation.
- No custom Auth token verification route.
- No password reset, magic link, or email change redesign.
- No organization settings/profile beyond creating the first organization with a custom or default name.
- No custom-role, RBAC, reviewer, photographer, scoped-permission, or member-administration changes.
- No public consent token flow changes.
- No product email SMTP behavior changes beyond documenting the Auth/product SMTP boundary.
- No production domain authentication setup.
- No logo, legal name, contact email, controller details, default language, billing, or advanced organization profile fields.
- No Feature 101 implementation.

Future work:

- `Feature 101 - Organization Settings`
- Potential future scope:
  - owner/admin can rename organization
  - optional organization profile fields can be added later
  - member invites and advanced access management remain separate surfaces unless planned explicitly

## 24. Concise Implementation Prompt

Implement Feature 100 by following `docs/rpi/100-account-and-organization-onboarding-ux/plan.md` as the implementation contract.

Before coding, read:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/100-account-and-organization-onboarding-ux/plan.md`

Keep deviations minimal. Do not inspect `.env.local`. Use "Organization" for first-run onboarding copy, not "Workspace". Do not add account confirmation to SnapConsent outbound email jobs. Do not expand into Feature 101 organization settings. Preserve RBAC, custom roles, scoped permissions, reviewer access, photographer assignment, invite acceptance authorization, and public consent token behavior.

Implement in phases:

1. Auth confirmation config/template/docs.
2. Public create-account and sign-up confirmation UX.
3. Explicit no-membership organization setup with optional custom name and default `My organization` path.
4. Token-scoped invite account-state guidance.
5. Tests, lint, and manual Supabase Auth validation.

After each phase, run the relevant focused tests and fix failures before continuing. At the end, report changed files, any deviations from the plan, tests run, and manual validation status.
