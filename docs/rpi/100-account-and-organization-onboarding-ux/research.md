# Feature 100 - Account and Organization Onboarding UX Research

## 1. Title and Feature ID

Feature 100 - Account and Organization Onboarding UX.

This is research only. No application code, migrations, tests, Supabase config, auth templates, or message files were changed during this phase.

## 2. Inputs Reviewed

Required first-read inputs:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/SUMMARY.md`
- `docs/rpi/PROMPTS.md`
- `README_APP.md`
- `UNCODEXIFY.MD` for UI context

Prior RPI context reviewed:

- `docs/rpi/001-auth/`
- `docs/rpi/060-tenant-resolution-hardening/`
- `docs/rpi/068-outbound-email-foundation-with-local-emulation-and-typed-email-jobs/`
- `docs/rpi/070-tenant-rbac-and-organization-user-management-foundation/`
- `docs/rpi/088-organization-user-management-custom-role-enforcement/`
- `docs/rpi/089-organization-user-role-change-and-removal-custom-role-enforcement/`
- `docs/rpi/096-permission-cleanup-and-effective-access-ui/`
- `docs/rpi/098-real-smtp-email-dispatch/`
- `docs/rpi/099-active-tenant-current-user-membership-filtering/plan.md`

Live source-of-truth files inspected:

- `supabase/config.toml`
- `.env.example`
- `src/app/page.tsx`
- `src/app/login/page.tsx`
- `src/app/auth/login/route.ts`
- `src/app/auth/logout/route.ts`
- `src/app/auth/sign-up/route.ts`
- `src/app/(protected)/layout.tsx`
- `src/app/(protected)/dashboard/page.tsx`
- `src/app/select-tenant/page.tsx`
- `src/app/join/[token]/page.tsx`
- `src/app/join/[token]/accept/route.ts`
- `src/lib/supabase/server.ts`
- `src/lib/supabase/middleware.ts`
- `src/lib/tenant/resolve-tenant.ts`
- `src/lib/tenant/active-tenant.ts`
- `src/lib/tenant/active-tenant-route-handler.ts`
- `src/lib/tenant/member-management-route-utils.ts`
- `src/lib/tenant/member-management-service.ts`
- `src/lib/tenant/membership-invites.ts`
- `src/lib/email/outbound/`
- `src/lib/email/send-receipt.ts`
- `src/lib/url/external-origin.ts`
- `src/lib/url/paths.ts`
- `messages/en.json`
- `messages/nl.json`
- relevant migrations under `supabase/migrations/`
- relevant tests under `tests/`

Official Supabase documentation checked as external source:

- Supabase local email template configuration: https://supabase.com/docs/guides/local-development/customizing-email-templates
- Supabase Auth email template variables and hosted template management: https://supabase.com/docs/guides/auth/auth-email-templates
- Supabase Auth custom SMTP: https://supabase.com/docs/guides/auth/auth-smtp
- Supabase CLI config reference for Auth email, SMTP, templates, and Inbucket: https://supabase.com/docs/guides/local-development/cli/config
- Supabase Auth general configuration for Confirm Email behavior: https://supabase.com/docs/guides/auth/general-configuration

`.env.local` was not inspected.

## 3. Current Auth and Signup Behavior

Current public routes:

- `/` is a public homepage with links to `/login` and `/dashboard`.
- `/login` is a public sign-in page.
- `/join/[token]` is a public organization invite page.
- There is no standalone public create-account page such as `/create-account`, `/signup`, or `/sign-up`.

Current auth routes:

- `POST /auth/login` signs in with Supabase Auth email/password.
- `POST /auth/logout` signs out.
- `POST /auth/sign-up` creates a Supabase Auth account with email/password.

Current sign-up exposure:

- Sign-up exists only as a route handler and is currently surfaced from `/join/[token]`.
- The homepage does not expose account creation.
- `/login` does not show a create-account form or link.
- The invite sign-up form fixes the email to the invite-bound email through a hidden input and disabled display input.

Current auth callback/confirmation routes:

- There is no `/auth/callback`, `/auth/confirm`, `/confirm`, or equivalent route.
- There is no app route that calls `supabase.auth.exchangeCodeForSession(...)` or `supabase.auth.verifyOtp(...)`.
- Confirmation redirects are therefore owned by Supabase Auth defaults and the configured Auth URLs, not by app code.

Current redirect behavior:

- Login accepts a server-normalized relative `next` value and defaults to `/dashboard`.
- Invite login/sign-up post back to `/join/[token]` with `next`, `error_redirect`, and `pending_org_invite_token`.
- Sign-up redirects to `next` when Supabase returns a session.
- If Supabase does not return a session, sign-up redirects to `next?confirmation=1`.

Current error behavior:

- Login errors are generic and avoid raw Supabase error details.
- Sign-up maps known Supabase errors to `account_exists`, `weak_password`, `invalid_input`, or `sign_up_failed`.
- Invite page shows mapped auth and invite errors.

Current protected access behavior:

- `src/app/(protected)/layout.tsx` checks `supabase.auth.getUser()` and redirects unauthenticated users to `/login`.
- It does not explicitly inspect `user.email_confirmed_at`.
- With Supabase email confirmations enabled, Supabase Auth should normally prevent password sign-in before confirmation. A defensive app-level confirmed-email guard could still be considered in planning if Supabase sessions can exist for unconfirmed users in any local edge case.

Existing tests:

- There are tenant resolution tests in `tests/feature-060-tenant-resolution-hardening.test.ts`.
- There are active-tenant tests in `tests/feature-070-active-tenant-route.test.ts` and `tests/feature-099-active-tenant-current-user-membership-filtering.test.ts`.
- There are organization invite acceptance tests in `tests/feature-070-tenant-rbac-foundation.test.ts`.
- I did not find route/UI tests specifically for public homepage sign-up, `/login`, `/auth/sign-up`, Supabase email confirmation, or an auth callback.

## 4. Current Email Confirmation Behavior

Live local Supabase Auth config:

- `[auth] enable_signup = true`
- `[auth.email] enable_signup = true`
- `[auth.email] enable_confirmations = false`
- `[auth] site_url = "http://127.0.0.1:3000"`
- `[auth] additional_redirect_urls = ["https://127.0.0.1:3000"]`

Supabase docs state that `auth.email.enable_confirmations` controls whether users must confirm their email before signing in. The same docs state that with Confirm Email disabled, Supabase assumes email verification is not required and implicitly confirms the user's email.

Current conclusion:

- Email confirmation is currently disabled locally.
- Local sign-up can return a session immediately.
- The code already has a `confirmation=1` branch for when Supabase returns no session, but the local config does not currently exercise that branch.

Changes required to require confirmation before app access:

- Set `auth.email.enable_confirmations = true` in `supabase/config.toml` for local development.
- Configure hosted Supabase Auth "Confirm Email" on for production/staging.
- Add a public create-account flow that explains confirmation and does not assume immediate session.
- Prefer passing an explicit email redirect URL from `supabase.auth.signUp(...)`, likely via `options.emailRedirectTo`, so confirmation returns to a known SnapConsent page.
- Add app UI copy for "check your email" and "confirmed, now sign in" states.
- Consider a defensive protected-layout guard for unconfirmed sessions only if live Supabase behavior or tests show an unconfirmed session can reach the app.

Current confirmation redirect:

- No app-owned callback exists.
- With the current code, sign-up does not pass an explicit redirect URL to Supabase Auth.
- Supabase will use the Auth `site_url`/allow-list behavior and its confirmation URL.
- Because `site_url` is `http://127.0.0.1:3000`, but `.env.example` defaults `APP_ORIGIN` to `http://localhost:3000`, local plan work should align Auth redirect URLs with the app origin used for testing.

## 5. Current Supabase Auth SMTP Configuration

Current local Supabase Auth SMTP state:

- `[auth.email.smtp]` is present only as a commented example in `supabase/config.toml`.
- The commented example uses SendGrid-style placeholder values.
- No local Auth SMTP credentials are configured in committed files.
- `[inbucket] enabled = true`.
- `[inbucket] port = 54324`.
- `inbucket.smtp_port = 54325` is commented, although Supabase CLI docs list `inbucket.smtp_port` with default `54325` and say it exposes the SMTP server when set.

Official Supabase CLI config keys for Auth SMTP include:

- `auth.email.smtp.host`
- `auth.email.smtp.port`
- `auth.email.smtp.user`
- `auth.email.smtp.pass`
- `auth.email.smtp.admin_email`
- `auth.email.smtp.sender_name`

Current app-managed SMTP state:

- `.env.example` contains `EMAIL_TRANSPORT=local-sink`, `SMTP_HOST=127.0.0.1`, `SMTP_PORT=54325`, and `SMTP_FROM=receipts@snapconsent.local`.
- `.env.example` also has commented Gmail-style app outbound SMTP placeholders from Feature 098.
- `src/lib/email/outbound/config.ts` supports `EMAIL_TRANSPORT=local-sink|smtp`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`, and `SMTP_REQUIRE_TLS`.
- `src/lib/email/outbound/smtp-transport.ts` can use Gmail-style STARTTLS for app-managed product email when configured through `.env.local`.

Important split:

- Supabase Auth SMTP is configured under `supabase/config.toml` for local Auth or in hosted Supabase Auth settings/API for production.
- SnapConsent product email SMTP is configured through app server env vars read by `src/lib/email/outbound/`.
- These are separate consumers. They can use the same Gmail account/app password in local development, but they do not automatically share the same env vars or config keys.

Can local Supabase Auth send confirmation emails through Gmail SMTP?

- Supabase Auth supports custom SMTP generally.
- Local CLI config exposes Auth SMTP keys.
- Therefore local Supabase Auth confirmation emails should be able to use Gmail SMTP if `[auth.email.smtp]` is configured with `enabled = true`, Gmail host/port, `user`, `pass`, `admin_email`, and `sender_name`.
- Secrets must be referenced through environment substitution or local secret handling, not committed literal values.
- This still needs manual validation because the current repo has not configured local Auth SMTP, and local Supabase CLI behavior around Auth SMTP plus Inbucket should be verified after config changes.

Placeholder-only local Auth SMTP shape to research further in planning:

```toml
[auth.email.smtp]
enabled = true
host = "smtp.gmail.com"
port = 587
user = "env(SUPABASE_AUTH_SMTP_USER)"
pass = "env(SUPABASE_AUTH_SMTP_PASSWORD)"
admin_email = "env(SUPABASE_AUTH_SMTP_ADMIN_EMAIL)"
sender_name = "SnapConsent"
```

Do not use the app outbound `SMTP_*` variables directly unless the plan explicitly decides to duplicate values into both config consumers. Reusing the same Gmail account locally is acceptable; reusing the same env var names across two systems is a plan-phase decision and should avoid ambiguity.

Production direction:

- Hosted Supabase Auth SMTP should later be configured in the Supabase dashboard or Management API.
- Production sending from `app@snapconsent.com` requires a custom-domain SMTP or transactional provider with domain authentication.
- Gmail should remain local/development only.

Gmail risks and limitations:

- Gmail requires authentication and TLS/STARTTLS.
- Gmail app passwords require local secret handling and must never be committed.
- Sender identity may be the authenticated Gmail account or an authorized alias.
- Gmail sending limits and spam filtering make it unsuitable for production transactional Auth mail.
- If `APP_ORIGIN` or Supabase `site_url` points at `localhost`, confirmation links opened on another device will not work.

## 6. Current Supabase Auth Email Template Configuration

Current template state:

- No custom Auth template files are present under `supabase/templates/`.
- `supabase/config.toml` contains only commented examples for `[auth.email.template.invite]`.
- No `[auth.email.template.confirmation]` block is configured.
- Hosted/production Auth template configuration is not represented in the repo beyond docs comments.

Official Supabase local template docs:

- Local templates are configured in `supabase/config.toml` with `content_path` pointing to an HTML file.
- Available local Auth template types include `invite`, `confirmation`, `recovery`, `magic_link`, and `email_change`.
- Subject can be configured through `auth.email.template.<type>.subject`.

Template variables relevant to confirmation:

- `{{ .ConfirmationURL }}` - full verification URL.
- `{{ .Token }}` - OTP token.
- `{{ .TokenHash }}` - hashed token for custom verification links.
- `{{ .SiteURL }}` - configured Auth site URL.
- `{{ .RedirectTo }}` - redirect URL passed to Auth calls and allow-listed in Auth settings.
- `{{ .Data }}` - auth user metadata.
- `{{ .Email }}` - original email address.

Relevant template for this feature:

- `auth.email.template.confirmation` is the primary required template.
- Password recovery, magic link, email change, and Supabase Auth invite templates are out of scope unless future UX work touches those Auth flows.
- SnapConsent tenant membership invites are not Supabase Auth invites; they already use the product email kind `tenant_membership_invite`.

Can the confirmation email be fully SnapConsent-branded?

- Yes. Supabase Auth templates can set subject and HTML content.
- The confirmation email can use SnapConsent name, plain product wording, and simple branded HTML.
- It should avoid Supabase branding in user-facing copy.
- It should keep Auth-message content transactional, not marketing-heavy. Supabase Auth SMTP docs warn against promotional content and excessive CTA/marketing material in Auth messages.

Direct `ConfirmationURL` versus app-owned confirmation page:

- Smallest path: use `{{ .ConfirmationURL }}` directly and pass a redirect URL that lands back on a SnapConsent page such as `/login?confirmed=1` or a dedicated post-confirmation page.
- More controlled SSR path: create an app-owned `/auth/confirm` route using `{{ .TokenHash }}` and `type=email`, then call Supabase `verifyOtp` server-side before redirecting. Supabase docs describe this pattern for server-side endpoints because default links can return sessions in URL fragments that server routes cannot read.
- Recommendation for minimal Feature 100: keep Supabase Auth token ownership, but add an app-owned confirmation callback only if plan phase decides the "returned to app with session" UX is needed. For the smallest safe UX, direct `ConfirmationURL` plus sign-in-after-confirmation is enough.

Recommended subject:

- `Confirm your SnapConsent account`

Smallest safe branded template:

- A simple HTML file at `supabase/templates/confirmation.html`.
- One primary link using `{{ .ConfirmationURL }}`.
- Plain fallback text including the same URL.
- No Supabase wording.
- No marketing copy.
- No additional product links.

## 7. Branded Confirmation Email Strategy

Recommended option: Option A - Supabase Auth-owned confirmation with a branded Supabase Auth template.

Why Option A fits:

- Supabase Auth already owns account creation, confirmation tokens, token expiry, and verification.
- The requested feature is UI/UX onboarding, not an auth-token redesign.
- Official Supabase Auth templates and SMTP configuration support the desired branding/sender direction.
- Account confirmation is an Auth email, not a SnapConsent product email.

Option B is not recommended:

- Adding account confirmation as `outbound_email_jobs` would require the app to participate in Auth token generation/verification or Auth email hooks.
- That would expand scope into a security-sensitive custom auth system.
- The live app has no safe app-owned account confirmation mechanism today.

Option C is not recommended:

- Keeping default Supabase confirmation would fail the requested branded SaaS onboarding goal.
- It is only a fallback if local/hosted Auth template configuration fails during plan/implementation validation.

Recommended confirmation UX:

1. User opens `/create-account`.
2. User enters email and password.
3. `POST /auth/sign-up` calls Supabase Auth `signUp` with an explicit redirect URL.
4. User sees a "check your email" page/state.
5. Supabase Auth sends branded `auth.email.template.confirmation`.
6. User confirms through Supabase Auth.
7. User lands on a SnapConsent sign-in or confirmation-complete page.
8. After sign-in, if no membership exists, user is routed to organization setup.

## 8. Boundary Between Supabase Auth Emails and SnapConsent Product Email Jobs

Current product email foundation:

- `src/lib/email/outbound/` is the central app-managed outbound email foundation.
- Current registered email kinds are `consent_receipt` and `tenant_membership_invite`.
- Jobs are durable in `public.outbound_email_jobs`.
- Product email links use `APP_ORIGIN` through `src/lib/url/external-origin.ts`.

Current app-managed flows:

- One-off consent receipts use `consent_receipt`.
- Tenant membership invite create/resend uses `tenant_membership_invite`.

Current legacy email flow:

- Recurring consent receipt still uses `src/lib/email/send-receipt.ts` and legacy templates, not the typed registry.

Account confirmation:

- No `outbound_email_jobs` kind exists for account confirmation.
- No live code sends account confirmation email through SnapConsent product email.
- Account confirmation currently belongs to Supabase Auth configuration.

Docs drift:

- `README_APP.md` now correctly documents current app-managed jobs as one-off consent receipts and tenant membership invites.
- It documents product outbound SMTP, but it does not yet explain the additional Supabase Auth SMTP/template path for account confirmation.
- Feature 100 should update docs to describe two SMTP consumers:
  - Supabase Auth emails: sign-up confirmation, password reset, magic link, email change, and Auth-owned emails.
  - SnapConsent product emails: tenant membership invites, consent receipts, and future product email jobs.

Recommendation:

- Do not add account confirmation to `outbound_email_jobs`.
- Document the split clearly in `README_APP.md`.
- Defer custom product email template expansion, recurring receipt migration, or additional request/reminder email kinds to later RPI work.

## 9. Current No-Membership and Tenant Bootstrap Behavior

Current tenant resolution:

- `resolveTenantId(...)` loads memberships for the authenticated user.
- If the user has one membership, it returns that tenant.
- If the user has multiple memberships, it requires a valid `sc_active_tenant` cookie or throws `active_tenant_required`.
- If the user has zero memberships and a `sc_pending_org_invite` cookie, it throws `pending_org_invite_acceptance_required`.
- If the user has zero memberships and no pending invite cookie, it calls `ensure_tenant_for_current_user`.

Current bootstrap RPC:

- `app.ensure_tenant_for_current_user()` reads `auth.uid()`.
- If the user already has a membership, it returns the oldest tenant.
- If the user has no membership, it creates a tenant with a name derived from the user's email local part, falling back to `My Studio`.
- It inserts an `owner` membership for that user.

Current protected layout behavior:

- `src/app/(protected)/layout.tsx` calls `ensureTenantId(...)`.
- Therefore a normal authenticated user with no memberships is auto-bootstrapped into a tenant before seeing a setup page.
- If bootstrap fails, the layout renders an organization setup issue fallback.

Feature 099 effect:

- Current-user membership filtering is implemented in live code.
- Broad RLS-visible membership rows no longer affect active-tenant resolution or switcher options.
- This is compatible with onboarding, because no-membership detection now means no membership for the current authenticated user.

Current no-membership answer:

- There is no user-facing organization setup page.
- The app currently auto-creates a tenant.
- The user cannot choose organization name before tenant creation.

Recommended onboarding direction:

- Stop auto-bootstrap for the normal confirmed-user onboarding path.
- Route confirmed users with zero memberships and no pending invite to a new organization setup page.
- Reuse the tenant bootstrap invariant, but replace the implicit email-derived name with an explicit user-provided organization name.
- Keep pending invite behavior unchanged: pending invite cookie should still route to `/join/[token]`, not first-org setup.

Smallest safe backend design to evaluate in plan:

- Add a server-side setup action/RPC that creates the first tenant only when `auth.uid()` has no memberships.
- Input: organization name only.
- Output: tenant id.
- Insert owner membership for the current user.
- Set `sc_active_tenant` after success.
- Make the write retry-safe:
  - if a tenant/membership was created by a concurrent request, return the existing current membership instead of creating another tenant;
  - do not accept `tenant_id` from the client;
  - trim and validate the organization name server-side.

Reusing `ensure_tenant_for_current_user()` exactly is not enough because it does not accept a chosen organization name. Extending it or adding a sibling RPC is safer than bypassing the database bootstrap pattern in route-local code.

## 10. Current Organization Profile and Settings Support

Tenant schema:

- `public.tenants` has `id`, `name`, and `created_at`.
- I found no live columns for display name, legal name, logo, default language, contact email, controller details, or other organization profile fields.

Organization settings UI:

- There is no protected organization settings route.
- There is no tenant profile/settings page.
- Existing organization-facing UI is primarily `/members`, `/select-tenant`, and the active tenant switcher.

Tenant name update support:

- I did not find a live app service or route for updating `tenants.name`.
- I did not find a live RLS policy or RPC dedicated to tenant name updates.
- Owners/admins can manage members, custom roles, reviewer access, templates, profiles, projects, and media-library surfaces, but not a tenant profile page.

Minimal setup fields:

- Include only `organization name`.
- Store it in `tenants.name`.

Fields to defer:

- legal name
- display name separate from legal name
- logo
- default language
- contact email
- controller/legal details for consent templates
- address, billing, domain, or compliance profile fields

Role access for setup:

- First setup is a zero-membership flow, so normal owner/admin role checks do not exist yet.
- The authenticated, confirmed current user should become `owner` of the created tenant.
- After setup, future organization profile editing should require owner/admin or an explicit later capability. That broader settings UI is out of scope for Feature 100.

## 11. Current Organization Invite Acceptance Behavior

Current `/join/[token]` states:

- Invalid token: shows invalid invitation message.
- Pending valid invite, unauthenticated: shows both sign-in and create-account panels.
- Pending valid invite, logged in as invited email: shows ready-to-join state and `Join organization` POST.
- Pending valid invite, logged in as a different email: shows wrong-account state and sign-out action.
- Accepted/revoked/expired/non-acceptable invite: shows terminal state copy.
- `confirmation=1`: shows "check your email" confirmation-required guidance.
- `auth_error`: shows mapped auth errors.
- `error=mismatch|expired|revoked|invalid|signin_required|server`: shows mapped invite errors.

Invite-bound data available before auth:

- `getPublicTenantMembershipInvite(...)` returns invite id, tenant id, tenant name, invited email, role, status, expires at, and canAccept.
- This is public, token-scoped, and only available after the token hash resolves.

Wrong-account protection:

- The page compares `user.email` to `invite.email` for UI state.
- The acceptance RPC also validates the authenticated `auth.users.email` against the invite `normalized_email`.
- Wrong-email users cannot accept.

Post-auth return:

- Invite login and sign-up forms post `next=/join/[token]`.
- They include `pending_org_invite_token`.
- Auth routes set the `sc_pending_org_invite` cookie.
- Protected layout suppresses auto-bootstrap and routes pending-invite users back to `/join/[token]`.

Invite acceptance write:

- `POST /join/[token]/accept` requires an authenticated user.
- It calls `acceptTenantMembershipInvite(...)`.
- The SQL function locks the invite row, checks pending/expired/revoked, validates authenticated email, inserts membership with `on conflict do nothing`, marks invite accepted, and returns accepted/already-member.
- The route sets `sc_active_tenant`, clears `sc_pending_org_invite`, and redirects to `/projects`.

Current account-existence tailoring:

- `/join/[token]` does not check whether the invite-bound email already has a Supabase Auth account.
- It always shows both sign-in and create-account options to unauthenticated users.
- If the email already has an account and the user tries sign-up, `POST /auth/sign-up` maps the Supabase error to `account_exists`.

Expired/revoked/accepted behavior:

- Public invite lookup computes `expired` if pending and past `expires_at`.
- Acceptance marks expired pending invites as expired and throws an expired error.
- Revoked invites throw revoked.
- Repeated acceptance by the same already-member account returns `already_member`.

Missing tests:

- Existing tests cover create-or-refresh, existing-account acceptance, wrong-email rejection, revoked rejection, and already-member outcomes at service/RPC level.
- I did not find route/UI tests for the rendered `/join/[token]` states.
- I did not find tests for existing-account versus no-account tailored unauthenticated UI.

## 12. Account-Existence Tailoring Options and Security Analysis

Security rule:

- Do not build a generic account-existence lookup.
- Account-state tailoring may only happen after a valid invite token is resolved and only for that invite's bound normalized email.

Current safe ingredients:

- The invite token lookup already returns the invite-bound email after token validation.
- Server-side code can use service role or SQL security-definer functions to inspect `auth.users`.
- Existing create/resend invite SQL already performs `auth.users` lookup by normalized email to detect already-member outcomes.

Option 1 - Add account existence to public invite RPC:

- Extend `get_public_tenant_membership_invite` to return an account-state enum for the invite-bound email.
- Pros: one token-scoped lookup, no extra endpoint.
- Cons: the current public RPC is callable by anon, so this would disclose account existence to anyone with a valid invite token. That is acceptable only if treated as a token-scoped secret and kept generic in UI.

Option 2 - Add a server-only page loader check with service role:

- Keep the public RPC unchanged.
- In the Next.js `/join/[token]` server component, after the valid token is loaded, use a server-only admin helper to check whether `auth.users` contains the invite-bound normalized email.
- Pros: no new public account lookup endpoint; scope is tied to the page render and token.
- Cons: still reveals tailored UI to anyone holding the valid invite link.

Option 3 - Add an authenticated/unauthenticated route handler for account existence:

- Not recommended.
- Even if it accepts a token, it is easier to misuse as an enumeration endpoint.

Safest minimal recommendation:

- Use Option 2 or a carefully designed Option 1 in plan phase.
- Do the check server-side only.
- Restrict input to the already validated invite token.
- Never accept arbitrary email input.
- Return/use only a coarse enum such as `auth_account_known: true|false`.
- Prefer using the result only to choose the primary CTA and guidance copy, not to display "this email has an account" as a raw security fact.
- Keep fallback copy and error handling because account state can race between render and submit.

Race behavior:

- If account does not exist at render but exists by sign-up submit, show existing `account_exists` and guide to sign in.
- If account exists at render but is deleted or unavailable by sign-in, show generic invalid credentials.
- If a user signs up and confirmation is required, invite remains pending and the page shows confirmation-required guidance.

Service-role versus SQL:

- A service-role page helper is simpler and keeps the account lookup out of public SQL/RPC surface.
- A SQL security-definer RPC would need careful grants and output shaping.
- Plan phase should prefer server-only service-role helper unless tests or deployment constraints make it awkward.

## 13. Routing and UX State Analysis

Public sign-up from homepage:

- Add homepage entry to `/create-account`.
- `/create-account` should show email/password fields.
- On submit, route through existing or adjusted `POST /auth/sign-up`.
- With confirmation enabled, show check-email state and do not enter the protected app until confirmed/sign-in succeeds.

After sign-up before confirmation:

- Show a public check-email page/state.
- If sign-up was invite-started, keep the invite token in the redirect/cookie and tell the user to return after confirming.
- Do not call tenant bootstrap.

After email confirmation:

- Smallest UX: Supabase confirmation redirects to `/login?confirmed=1`; user signs in.
- More seamless UX: app-owned confirmation callback verifies token server-side and redirects to the intended route with a session. This is more work and should be chosen only if plan phase wants immediate authenticated return.

Confirmed user with no memberships:

- Route to new organization setup page unless a pending invite cookie exists.
- Organization setup creates the first tenant with user-provided name and owner membership.

Confirmed user with exactly one membership:

- Resolve tenant automatically and land in `/projects` or `/dashboard`.
- Existing app defaults often land in `/dashboard`, while invite acceptance redirects to `/projects`.
- For SaaS onboarding, `/projects` is the better post-setup target because it is the main work area.

Confirmed user with multiple memberships:

- Existing behavior requires `/select-tenant` unless `sc_active_tenant` is valid.
- Keep this unchanged.

User signs up from invite link:

- The invite-bound email remains fixed.
- If confirmation is required, show confirmation-required state on `/join/[token]`.
- After confirmation and sign-in, return to `/join/[token]`.
- If logged in as invited email, show accept invite.
- Accepting the invite creates membership and sets `sc_active_tenant`.

User signs up from homepage:

- No pending invite cookie.
- After confirmation/sign-in, zero-membership user should go to organization setup.

Pending invite cookies and `next` params:

- Existing `sc_pending_org_invite` behavior should be reused for invite-originated auth.
- Existing `next` support should be preserved but normalized as relative-only.
- For public create-account, use a safe relative `next` only if it is one of the onboarding destinations.

Expired invite after confirmation:

- User returns to `/join/[token]`.
- Public invite page shows expired/unavailable state.
- If user has no memberships and no valid pending invite, continuing to the app should route to organization setup, not silently bootstrap.

User creates account from invite but later logs in from homepage:

- If the pending invite cookie remains, protected layout redirects to `/join/[token]`.
- If the cookie is gone and the user has no memberships, route to organization setup.
- Invite remains pending until accepted or expired.

## 14. Recommended Minimal UX Flow

Recommended bounded flow:

1. Public homepage adds a create-account entry.
2. New `/create-account` page submits to `POST /auth/sign-up`.
3. Supabase Auth email confirmations are enabled.
4. Supabase Auth confirmation template is branded as SnapConsent.
5. Local Auth confirmation uses Supabase Auth SMTP configuration. It may point at Gmail SMTP for development if configured with local secrets.
6. After confirmation, the user signs in or lands on a confirmation-complete page.
7. Protected layout/tenant resolution routes zero-membership users to `/organization/setup`.
8. `/organization/setup` asks only for organization name.
9. Server-side setup creates a tenant and owner membership for the authenticated user.
10. Setup sets active tenant and redirects to `/projects`.
11. Invite page validates token first and tailors the primary unauthenticated action to sign-in or create-account based on token-scoped account existence.
12. Invite acceptance continues to use the existing RPC path and wrong-email checks.

## 15. Exact Scope Recommendation

In scope for implementation planning:

- Public create-account page.
- Homepage create-account link.
- Auth sign-up redirect/confirmation UX copy.
- Supabase Auth `enable_confirmations = true` for local config.
- Local branded confirmation template under `supabase/templates/`.
- Local `supabase/config.toml` template block for `auth.email.template.confirmation`.
- Documentation for hosted Supabase Auth template/SMTP setup.
- Documentation for Auth SMTP versus product outbound SMTP.
- Optional local Auth SMTP Gmail placeholders, with no secrets committed.
- No-membership organization setup page with organization name only.
- Server-side first-tenant setup action/RPC.
- Protected routing from zero-membership confirmed users to setup.
- Invite page account-state tailoring only after valid token lookup.
- English and Dutch i18n messages for new UI states.
- Focused tests for routing, setup, invite UI state selection, and backend setup behavior.

Out of scope:

- New RBAC, custom role, scoped permission, reviewer access, or photographer assignment behavior.
- Any redesign of `/members` or role administration.
- Account confirmation through `outbound_email_jobs`.
- Custom Auth token system.
- Password reset, magic link, email change, or Supabase Auth invite template expansion.
- Advanced organization profile/settings.
- Tenant legal/controller fields.
- Public consent `/i`, `/r`, `/rp`, or `/rr` semantics.
- Recurring consent receipt migration.
- Production email provider setup beyond documenting the path.

## 16. Risks and Edge Cases

Email confirmation config drift:

- Local `site_url`, additional redirect URLs, app `APP_ORIGIN`, and browser host can drift between `127.0.0.1`, `localhost`, LAN IPs, and tunnels.
- Plan should define one local default and document how to change it for phone testing.

Supabase Auth SMTP versus app SMTP confusion:

- Two SMTP consumers can be configured to the same Gmail account but require separate configuration.
- Docs must make this explicit.

Unconfirmed sessions:

- Supabase should block sign-in when confirmations are enabled.
- A defensive app guard can be considered if tests show an unconfirmed session can exist.

Invite account-state disclosure:

- Tailoring UI reveals a coarse account-existence signal to anyone holding a valid invite token.
- This should be accepted only because the token is already a bearer secret and the email is already displayed by the invite page.
- No generic endpoint should be created.

Concurrent organization setup:

- Double submit or two tabs can race.
- The setup write must be idempotent and return the existing tenant if another request already created membership.

Tenant bootstrap conflict:

- Existing `ensureTenantId` auto-bootstraps.
- Feature 100 must prevent implicit bootstrap before the user can choose organization name.
- Pending invite cookie behavior must continue to suppress bootstrap.

Partial failures:

- Account created but confirmation email fails: Supabase Auth owns retry/resend behavior; app should show resend guidance only if implementing a resend action.
- Organization tenant created but active tenant cookie set fails: user may hit active tenant resolution on next request; with one membership, it should resolve automatically.
- Invite accepted but redirect/cookie fails: repeated acceptance returns already-member and should be safe.

Expired invites:

- Invite may expire between render and sign-up/confirmation.
- UI should handle this gracefully and offer homepage/create-organization path after sign-in if no membership exists.

Email deliverability:

- Gmail local testing may fail due to app password, account policy, rate limits, or sender alias constraints.
- Production requires domain-authenticated provider setup.

## 17. Test Gaps

Existing coverage:

- Tenant resolution and no-bootstrap-when-pending-invite behavior: Feature 060/099 tests.
- Active tenant route validation: Feature 070 tests.
- Tenant membership invite create/accept/wrong-email/revoked/already-member behavior: Feature 070 tests.
- Product email renderer/config/SMTP behavior for outbound jobs: Feature 068/098 tests.
- Organization-user permission boundaries: Feature 088/089 tests.

Missing tests to add:

- Public homepage includes create-account entry.
- `/create-account` renders for unauthenticated users and redirects/handles authenticated users appropriately.
- `POST /auth/sign-up` passes an explicit email redirect URL when required.
- Sign-up with no session redirects to check-email state.
- Protected zero-membership user routes to organization setup instead of auto-bootstrap.
- Organization setup creates tenant with chosen name and owner membership.
- Organization setup is idempotent under retry/double-submit.
- Organization setup rejects empty/invalid names.
- Pending invite cookie still routes to `/join/[token]` instead of setup.
- Invite page existing-account state chooses sign-in primary CTA.
- Invite page no-account state chooses create-account primary CTA.
- Invite page wrong-account state remains.
- Invite accepted/revoked/expired states remain.
- Account-existence tailoring does not accept arbitrary email input.
- English and Dutch messages include new UI copy.

Integration/database-backed tests:

- First-tenant setup RPC/service with real memberships and RLS.
- Invite acceptance after sign-up/confirmation flow boundaries where practical.
- Token-scoped account existence helper, using real auth users.

Unit tests:

- Auth redirect URL construction.
- Organization name validation.
- Invite UI state derivation from invite/account/user state.
- Supabase Auth template file smoke validation may be limited to existence/config path checks.

Manual validation required:

- Enable local Supabase Auth email confirmations.
- Start local Supabase and verify confirmation email appears in Inbucket or Gmail SMTP depending config.
- Confirm the email has SnapConsent subject/body and no Supabase branding.
- Click confirmation link and verify redirect behavior.
- Confirm unconfirmed user cannot sign in/enter app.
- Confirm confirmed no-membership user reaches organization setup.
- Confirm local Gmail Auth SMTP works only with placeholder-derived local secrets in `.env.local` or equivalent secret store.

## 18. Open Decisions for Plan Phase

1. Should confirmation use direct `{{ .ConfirmationURL }}` with redirect to login, or an app-owned `/auth/confirm` callback using `{{ .TokenHash }}` and `verifyOtp`?
2. What exact local Auth site URL should be canonical: `http://127.0.0.1:3000`, `http://localhost:3000`, or `APP_ORIGIN`-matched documentation?
3. Should local Supabase Auth SMTP use Inbucket by default and Gmail only as an optional commented block?
4. Should Auth SMTP env placeholders use `SUPABASE_AUTH_SMTP_*` names to avoid confusion with app outbound `SMTP_*`?
5. Should protected layout defensively block `!user.email_confirmed_at`, or rely on Supabase Auth sign-in behavior?
6. Should no-membership routing change `ensureTenantId` globally, or add a new no-bootstrap resolver used only by protected layout?
7. Should first organization setup extend `ensure_tenant_for_current_user` with a name parameter or add a new RPC?
8. What is the exact setup route: `/organization/setup`, `/setup/organization`, or another existing naming pattern?
9. Should public create-account support a generic `next` param, or only known onboarding destinations?
10. Should invite account-existence tailoring be implemented in SQL public invite lookup or a server-only service-role page helper?
11. Should the invite UI show only one primary action plus a secondary fallback, or still show both panels with clearer guidance?
12. Should account-existence tailored copy avoid saying "account exists" directly and instead say "Sign in with this email"?
13. Should setup redirect to `/projects` or `/dashboard` after creating the first organization? Recommended: `/projects`.
14. Should a resend-confirmation action be included now, or deferred?

## 19. Final Recommendation

Choose Option A.

Keep account confirmation owned by Supabase Auth. Enable email confirmations, add a fully SnapConsent-branded Supabase Auth confirmation template, and document Supabase Auth SMTP separately from SnapConsent product outbound email jobs. Use Gmail SMTP for local Auth confirmation testing only if Supabase Auth SMTP is configured with local secrets and validated manually.

Implement onboarding as a small UI/UX feature: public create-account, check-email/confirmation guidance, no-membership organization setup with only organization name, and safer invite guidance based on token-scoped account state. Preserve all RBAC, custom-role, scoped-permission, reviewer-access, photographer-assignment, public consent token, and product email-job semantics.
