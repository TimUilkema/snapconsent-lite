# Feature 098 Research - Real SMTP email dispatch configuration

## Inputs reviewed

Required inputs reviewed first:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `docs/rpi/README.md`
5. `SUMMARY.md` - not present at repo root. The live equivalent is `docs/rpi/SUMMARY.md`, reviewed.
6. `PROMPTS.md` - not present at repo root. The live equivalent is `docs/rpi/PROMPTS.md`, reviewed.
7. `README_APP.md`
8. `docs/rpi/068-outbound-email-foundation-with-local-emulation-and-typed-email-jobs/research.md`
9. `docs/rpi/068-outbound-email-foundation-with-local-emulation-and-typed-email-jobs/plan.md`

Later RPI docs searched and reviewed as context where they mentioned outbound email, consent receipts, organization invites, recurring consent requests, revoke links, upgrade requests, or public links:

- `docs/rpi/SUMMARY.md`
- `docs/rpi/069-consent-upgrade-flow-owner-reuse-and-prefill-refinement/`
- `docs/rpi/070-tenant-rbac-and-organization-user-management-foundation/`
- `docs/rpi/071-consent-upgrade-flow-headshot-reuse-and-upgrade-ux-fixes/`
- `docs/rpi/072-project-staffing-photographer-scoped-capture-workspaces-and-bounded-project-workflow-permissions/`
- `docs/rpi/073-workspace-handoff-and-project-finalization-foundation/`
- `docs/rpi/074-project-release-package-and-media-library-placeholder/`
- `docs/rpi/075-project-correction-and-re-release-foundation/`
- `docs/rpi/076-correction-consent-intake-and-authorization-updates/`
- `docs/rpi/077-media-library-asset-safety-and-release-detail-review-context/`
- `docs/rpi/080-advanced-organization-access-management-foundation/`
- `docs/rpi/081-custom-role-definitions-and-scoped-role-assignment-foundation/`
- `docs/rpi/082-project-scoped-reviewer-assignments-and-enforcement/`
- `docs/rpi/084-custom-role-assignment-foundation/`
- `docs/rpi/086-custom-role-template-profile-enforcement/`
- `docs/rpi/087-tenant-level-admin-permission-consolidation/`
- `docs/rpi/088-organization-user-management-custom-role-enforcement/`
- `docs/rpi/090-role-administration-delegation/`
- `docs/rpi/092-capability-scope-semantics-and-permission-migration-map/`
- `docs/rpi/094-effective-scoped-permission-resolver-foundation/`
- `docs/rpi/095-operational-permission-resolver-enforcement/`
- `docs/rpi/096-permission-cleanup-and-effective-access-ui/`
- `docs/rpi/097-project-zip-export-cleanup/research.md`

Live implementation reviewed as source of truth:

- `src/lib/email/outbound/`
- `src/lib/email/send-receipt.ts`
- `src/lib/email/templates/`
- `src/app/api/internal/email/worker/route.ts`
- `src/app/i/[token]/consent/route.ts`
- `src/app/rp/[token]/consent/route.ts`
- `src/app/api/members/invites/route.ts`
- `src/app/api/members/invites/[inviteId]/resend/route.ts`
- `src/app/api/members/invites/[inviteId]/revoke/route.ts`
- `src/app/join/[token]/accept/route.ts`
- `src/lib/tenant/member-management-service.ts`
- `src/lib/tenant/membership-invites.ts`
- `src/lib/projects/project-consent-upgrade-service.ts`
- `src/lib/projects/project-participants-service.ts`
- `src/lib/profiles/profile-follow-up-service.ts`
- `src/lib/profiles/profile-follow-up-delivery.ts`
- `src/lib/consent/submit-consent.ts`
- `src/lib/recurring-consent/public-recurring-consent.ts`
- `src/lib/recurring-consent/revoke-recurring-profile-consent.ts`
- `src/lib/url/external-origin.ts`
- `src/lib/url/paths.ts`
- `.env.example`
- `.gitignore`
- `README_APP.md`
- `package.json`
- `supabase/config.toml`
- `supabase/migrations/20260422213000_068_outbound_email_foundation.sql`
- `supabase/migrations/20260423090000_070_tenant_rbac_membership_invites_foundation.sql`
- `supabase/migrations/20260423110000_070_tenant_membership_invite_flows.sql`
- `supabase/migrations/20260430180000_088_organization_user_invite_custom_role_enforcement.sql`
- `tests/feature-068-outbound-email-foundation.test.ts`
- `tests/feature-068-outbound-email-foundation-db.test.ts`
- `tests/feature-070-tenant-rbac-foundation.test.ts`
- `tests/feature-088-organization-user-read-list-and-invite-custom-role-enforcement.test.ts`

External references checked for Gmail SMTP facts:

- Gmail SMTP client settings: https://support.google.com/mail/answer/7104828
- Google app passwords: https://support.google.com/mail/answer/185833
- Gmail sending limits: https://support.google.com/mail/answer/22839
- Google Workspace SMTP server/app setup: https://support.google.com/a/answer/176600

`.env.local` exists but was not opened, to avoid reading local secrets.

## Verified Current Behavior

The live repo already has the Feature 068 outbound email foundation. Older Feature 068 research described a missing foundation; that is no longer current.

Current live code has:

- durable typed outbound email jobs in `public.outbound_email_jobs`;
- a typed email-kind registry in `src/lib/email/outbound/registry.ts`;
- payload types in `src/lib/email/outbound/types.ts`;
- enqueue, claim, dispatch, retry, cancel, and complete logic in `src/lib/email/outbound/jobs.ts`;
- a token-protected worker endpoint at `POST /api/internal/email/worker`;
- a Nodemailer-backed SMTP transport in `src/lib/email/outbound/smtp-transport.ts`;
- renderers for one-off consent receipts and tenant membership invites;
- delivery helpers that enqueue typed jobs and immediately try dispatch.

Live code differs from some older docs and README text:

- `README_APP.md` says "Current live use is the one-off consent receipt flow." Live code also sends tenant membership invite emails through the outbound foundation.
- `docs/rpi/SUMMARY.md` says local SMTP preview uses Mailpit. Live app docs and code use Inbucket/default SMTP sink settings.
- `supabase/config.toml` has Inbucket enabled, but `smtp_port = 54325` is commented. `.env.example` still points the app mailer at `127.0.0.1:54325`, so local sink availability should be manually verified when using Supabase CLI.
- The one-off consent receipt path uses the new foundation. The recurring consent receipt path still uses the legacy `src/lib/email/send-receipt.ts` helper directly.

## Current Email Foundation Architecture

Foundation files:

- `src/lib/email/outbound/types.ts`
- `src/lib/email/outbound/registry.ts`
- `src/lib/email/outbound/config.ts`
- `src/lib/email/outbound/jobs.ts`
- `src/lib/email/outbound/worker.ts`
- `src/lib/email/outbound/transport.ts`
- `src/lib/email/outbound/smtp-transport.ts`
- `src/lib/email/outbound/html.ts`
- `src/lib/email/outbound/timestamps.ts`
- `src/lib/email/outbound/consent-receipt-delivery.ts`
- `src/lib/email/outbound/tenant-membership-invite-delivery.ts`
- `src/lib/email/outbound/renderers/consent-receipt.ts`
- `src/lib/email/outbound/renderers/tenant-membership-invite.ts`

Email kinds are registered centrally through `OUTBOUND_EMAIL_KINDS` and registry entries. Live kinds are:

- `consent_receipt`
- `tenant_membership_invite`

Payloads are TypeScript typed in `OutboundEmailPayloadByKind`. Each registry entry provides:

- `buildDedupeKey`
- `getRecipient`
- `parsePayload`
- `render`
- optional `validateBeforeSend`
- optional `afterSend`

Messages are rendered at enqueue time and snapshotted on the job row as `rendered_subject`, `rendered_text`, and `rendered_html`. The job also stores `payload_json`.

Jobs are enqueued through:

- `enqueueOutboundEmailJob`
- `enqueueConsentReceiptEmailJob`
- `enqueueTenantMembershipInviteEmailJob`

Delivery wrappers used by feature code:

- `deliverConsentReceiptAfterSubmit`
- `deliverTenantMembershipInviteEmail`

Queued jobs are dispatched through:

- immediate dispatch with `dispatchOutboundEmailJobById`;
- batch dispatch with `runOutboundEmailWorker`;
- route access through `POST /api/internal/email/worker` using `OUTBOUND_EMAIL_WORKER_TOKEN`.

Database foundation:

- table: `public.outbound_email_jobs`
- statuses: `pending`, `processing`, `sent`, `cancelled`, `dead`
- unique constraint: `(tenant_id, dedupe_key)`
- indexes for due-job and lease queries
- RLS enabled and direct table access revoked from `public`, `anon`, and `authenticated`
- security-definer SQL helpers exposed through public RPC wrappers

SQL helpers:

- `enqueue_outbound_email_job`
- `claim_outbound_email_job_by_id`
- `claim_outbound_email_jobs`
- `complete_outbound_email_job`
- `fail_outbound_email_job`
- `cancel_outbound_email_job`

The TypeScript job service uses an admin Supabase client when no client is passed, requiring `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` server-side.

## Current Transport and Provider Behavior

The only live app-managed transport is SMTP via Nodemailer.

Current config shape:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_FROM`
- `OUTBOUND_EMAIL_WORKER_TOKEN`
- `APP_ORIGIN` for links

Defaults in `src/lib/email/outbound/config.ts`:

- `SMTP_HOST=127.0.0.1`
- `SMTP_PORT=54325`
- `SMTP_FROM=receipts@snapconsent.local`

Current transport implementation:

```ts
nodemailer.createTransport({
  host: config.smtpHost,
  port: config.smtpPort,
  secure: false,
  ignoreTLS: true,
})
```

That means current behavior is SMTP-to-local-sink compatible, but not Gmail-compatible. It does not configure authentication, STARTTLS, SSL, or `requireTLS`. It also does not accept username/password values.

Current behavior is best described as "SMTP transport configured for a local sink by default", not a no-op transport. It will attempt real SMTP delivery to whatever host and port are configured, but because it hardcodes `ignoreTLS: true` and no auth, it is currently suitable for unauthenticated local Inbucket-style SMTP, not Gmail SMTP.

Environment validation is local to `src/lib/email/outbound/config.ts`; there is no broader central env schema. The config validates `SMTP_PORT` and non-empty `SMTP_FROM`. It does not validate host emptiness, SMTP auth, secure mode, or TLS mode because those settings do not exist yet.

What is missing for Gmail SMTP:

- `SMTP_USER`
- `SMTP_PASSWORD`
- TLS/secure controls, likely `SMTP_SECURE` or `SMTP_REQUIRE_TLS`
- Nodemailer auth configuration
- `ignoreTLS` must not be hardcoded for real SMTP
- local sink mode must remain the easy default
- docs must explain that Gmail credentials are local `.env.local` only and never committed

## Current Supported Email Types and Gaps

Live flows that enqueue outbound email jobs:

- One-off consent receipt after `/i/[token]/consent` submit, through `deliverConsentReceiptAfterSubmit`.
- Tenant membership invite create/resend, through `createTenantMemberInvite`, `resendTenantMemberInvite`, and `deliverTenantMembershipInviteEmail`.

Expected product emails already in the foundation:

- consent receipts: partially yes. One-off receipt is in the foundation; recurring receipt still uses legacy direct helper.
- organization/member invite links: yes, through `tenant_membership_invite`.

Expected product emails not yet in the foundation:

- one-off consent invite links;
- one-off revoke-link resend emails;
- recurring consent request links;
- recurring revoke-link resend emails;
- recurring consent receipts;
- consent upgrade request links;
- recurring project consent replacement/upgrade request links;
- correction-specific request-link emails.

Flows that still show/copy/open links in UI and do not send email:

- one-off subject invite creation in project UI returns an `invitePath` and uses `InviteSharePanel`;
- one-off consent upgrade requests return a normal `/i/[token]` invite path;
- recurring baseline follow-up records a placeholder delivery attempt only;
- project recurring participant consent requests return a `/rp/[token]` path and use copy/open UI.

Flows relying on Supabase Auth rather than the outbound foundation:

- Supabase Auth email/password account behavior is configured under `[auth.email]` in `supabase/config.toml`.
- Local auth confirmations are disabled (`enable_confirmations = false`).
- App-managed tenant membership invites are not Supabase Auth invites; they are SnapConsent `tenant_membership_invites` plus `/join/[token]`.

Out of scope for Feature 098:

- adding new email kinds for all missing flows;
- redesigning invite/request token semantics;
- migrating recurring receipt content unless required by SMTP configuration, which research does not show;
- changing Supabase Auth email behavior.

## Current External Link Generation Behavior

Canonical external URL helper:

- `src/lib/url/external-origin.ts`

It:

- reads `APP_ORIGIN`;
- requires a valid `http:` or `https:` origin;
- requires paths passed to `buildExternalUrl` to start with `/`;
- returns `${origin}${path}`.

Canonical public path helpers:

- `buildInvitePath(token)` -> `/i/[token]`
- `buildRevokePath(token)` -> `/r/[token]`
- `buildRecurringProfileConsentPath(token)` -> `/rp/[token]`
- `buildRecurringProfileRevokePath(token)` -> `/rr/[token]`
- `buildTenantMembershipInvitePath(token)` -> `/join/[token]`

Email renderers use this pattern correctly for registered kinds:

- one-off consent receipt builds revoke URL with `buildExternalUrl(buildRevokePath(...))`;
- tenant membership invite builds join URL with `buildExternalUrl(buildTenantMembershipInvitePath(...))`.

Recurring receipt legacy route also uses `buildExternalUrl(buildRecurringProfileRevokePath(...))`, but it does so route-locally before calling `sendRecurringConsentReceiptEmail`.

Browser copy/open/share UI intentionally uses `window.location.origin`:

- one-off invite/share UI;
- recurring profile follow-up share UI;
- project participant pending request copy/open UI.

That split should remain: browser UI can use the browser host, while emails must use `APP_ORIGIN`. For Gmail-sent development emails to work on a phone, `APP_ORIGIN` must be set to a phone-reachable dev host such as a LAN IP or a tunnel URL, not `localhost`.

## Current Configuration and Secret Handling

Current outbound email env vars:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_FROM`
- `OUTBOUND_EMAIL_WORKER_TOKEN`
- `APP_ORIGIN`

Current package dependency:

- `nodemailer`

Current `.gitignore` ignores `.env*`, including `.env.local`. `.env.example` is committed and contains no SMTP password.

Recommended eventual configuration shape for this feature:

```env
EMAIL_TRANSPORT=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
SMTP_USER=<GMAIL_ADDRESS>
SMTP_PASSWORD=<GMAIL_APP_PASSWORD>
SMTP_FROM="SnapConsent <GMAIL_ADDRESS>"
# Optional:
SMTP_REPLY_TO=<REPLY_TO_EMAIL>
```

The exact names should be decided in plan phase, but generic SMTP names fit the existing repo better than Gmail-specific names. `SMTP_HOST`, `SMTP_PORT`, and `SMTP_FROM` already exist, so extending that family is preferable to introducing `GMAIL_*`.

Missing or invalid SMTP config should fail server-side during enqueue/dispatch and be recorded on `outbound_email_jobs` without exposing provider credentials or low-level SMTP detail to end users. For local development, default behavior should remain local sink mode unless a developer explicitly configures real SMTP.

`.env.example` should document placeholders only. It must not include a real account, real password, screenshot, or log line with credentials.

`README_APP.md` should document two modes:

- Local sink mode: no credentials, defaults to Inbucket/local SMTP sink.
- Real SMTP development mode: explicit opt-in with Gmail or another SMTP provider.

## Gmail SMTP Development Considerations

Official Google docs confirm:

- Gmail SMTP host is `smtp.gmail.com`.
- TLS/STARTTLS port is `587`.
- SSL port is `465`.
- SMTP requires authentication.
- Google app passwords require 2-Step Verification.
- For app/device SMTP setup, Google documents full email address plus app password for authentication.

Development `.env.local` should use placeholders like:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
SMTP_USER=<GMAIL_ADDRESS>
SMTP_PASSWORD=<GMAIL_APP_PASSWORD>
SMTP_FROM="SnapConsent <GMAIL_ADDRESS>"
APP_ORIGIN=http://<LAN_OR_TUNNEL_HOST>:3000
```

App password handling:

- Store only in `.env.local` or an equivalent local secret store.
- Never commit it.
- Never paste it into RPI docs, tests, screenshots, PRs, logs, or examples.
- Rotate/revoke it if it is exposed.
- Expect it to be revoked if the Google account password changes.

Gmail limitations:

- Gmail is acceptable for development smoke testing, not production transactional email.
- Personal Gmail has sending limits; Google documents a daily threshold around 500 messages/recipients for regular Gmail accounts.
- Google Workspace SMTP has different limits and recommends SMTP relay for organization/device/app sending.
- Spam filters may reject suspicious messages.
- Sender identity is tied to the authenticated Gmail/Workspace account and configured aliases. For development, expect the visible sender to be the Gmail account or an authorized alias, not arbitrary `app@snapconsent.com`.

Production direction:

- Keep Gmail as configuration only.
- Do not hardcode Gmail host, ports, auth behavior, or sender assumptions into feature flows.
- A later production sender such as `app@snapconsent.com` should be enabled by changing SMTP/provider env configuration, not by rewriting consent or invite flows.

## Security and Privacy Considerations

Confirmed server-only boundaries:

- SMTP config is read only in server modules under `src/lib/email/outbound/`.
- Feature routes enqueue through server code.
- No client component reads SMTP config.
- The service role key remains server-only.

Secrets:

- Current code does not log SMTP config values.
- Current code logs `outbound_email_after_send_failed` with job id, kind, error code, and message. A Gmail implementation should ensure SMTP passwords are never included in logged error messages.
- Dispatch error messages are stored in `last_error_message`; plan phase should decide whether to sanitize provider errors before storing them.

Tenant scoping:

- Job rows carry `tenant_id`.
- Dedupe is tenant-scoped.
- One-off receipt payload comes from the saved consent result.
- Tenant invite payload comes from tenant-scoped invite RPC/service output.
- Membership invite validation rechecks the invite row by tenant id before send.

Public token semantics:

- One-off consent signing remains `/i/[token]`.
- One-off revocation remains `/r/[token]`.
- Recurring signing remains `/rp/[token]`.
- Recurring revocation remains `/rr/[token]`.
- Organization invite acceptance remains `/join/[token]`.
- Email work must not treat tenant id, project id, or workspace id in a URL as authority. Tokens and server-side lookups remain authoritative.

Revocation links:

- One-off revoke links are token-protected and do not authorize by tenant/project id.
- Recurring revoke links are also token-protected.
- Feature 098 should not change revocation semantics or audit behavior.

End-user error disclosure:

- Consent and invite routes currently return success/queued style statuses rather than raw SMTP errors.
- This should be preserved; SMTP misconfiguration should not leak provider credentials or infrastructure detail to users.

## Retry and Idempotency Considerations

Email job idempotency:

- `outbound_email_jobs` has unique `(tenant_id, dedupe_key)`.
- `consent_receipt` dedupe is `consent_receipt:${consentId}`.
- `tenant_membership_invite` dedupe is `tenant_membership_invite:${inviteId}:${lastSentAtIso}` so resends can create a new send job and old jobs can be cancelled as superseded.

Claim and retry behavior:

- Jobs move from `pending` to `processing` under a lease.
- Immediate dispatch and worker dispatch use the same claim logic.
- Failed retryable sends return to `pending` with backoff.
- Non-retryable or exhausted sends move to `dead`.
- Validation failures can move a job to `cancelled`.
- Expired `processing` leases can be reclaimed.

Duplicate sends:

- The foundation reduces duplicate sends but cannot absolutely prevent every SMTP-level duplicate. A process can send successfully and crash before `complete_outbound_email_job` persists `sent`.
- Duplicate emails are acceptable within current transactional email semantics if rare; they must not create duplicate domain records or state changes.
- Post-send hooks must remain idempotent. `markReceiptSent` is timestamp-only on consent receipt state and is safe to repeat.

Domain idempotency:

- Consent submit, membership invite create/refresh, recurring request creation, and upgrade request creation already have independent idempotency/retry behavior.
- Email retries should only retry email delivery, not recreate consents, invites, memberships, or request rows.

## Testing and Validation Surface

Existing test coverage:

- renderer absolute URL generation for one-off receipt and tenant membership invite;
- deterministic outbound email UTC timestamp formatting;
- SMTP transport calls Nodemailer and forwards provider message id;
- worker requires a worker id;
- worker route rejects unauthorized requests;
- delivery helpers queue on dispatch failure without throwing;
- duplicate one-off receipt jobs dedupe and mark receipt sent;
- worker retries transport failures and later sends;
- tenant membership invite jobs dedupe by send timestamp and cancel stale jobs;
- organization invite permission and acceptance tests through Feature 070/088.

Testing gaps for Feature 098 implementation:

- SMTP config parsing for auth/TLS/secure settings;
- local sink transport remains unauthenticated and no-TLS by default;
- Gmail-style config passes correct Nodemailer options without sending real email;
- missing `SMTP_USER`/`SMTP_PASSWORD` fails clearly when real SMTP/auth mode is selected;
- no SMTP password appears in thrown/stored/logged error messages;
- `.env.example` and `README_APP.md` examples use placeholders only.

Recommended later tests:

- unit test `getOutboundEmailConfig` with local sink defaults;
- unit test real SMTP config with `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=587`, `SMTP_USER=<GMAIL_ADDRESS>`, `SMTP_PASSWORD=<GMAIL_APP_PASSWORD>`, `SMTP_REQUIRE_TLS=true`;
- mocked Nodemailer test that verifies `auth`, `secure`, `requireTLS`, and `ignoreTLS` options;
- regression test that local sink mode does not require auth;
- optional test that dispatch failure stores a sanitized error.

Manual validation after implementation:

- Local sink mode:
  - set `.env.local` to local defaults;
  - start Supabase local stack and app;
  - submit one-off consent and create/resend a member invite;
  - inspect Inbucket UI;
  - call `POST /api/internal/email/worker` with `OUTBOUND_EMAIL_WORKER_TOKEN`.
- Gmail SMTP mode:
  - configure Gmail SMTP only in `.env.local`;
  - set `APP_ORIGIN` to a phone/browser reachable origin;
  - create/resend a low-risk test membership invite or submit a test consent to a controlled recipient;
  - verify email delivery, links, and worker retry behavior;
  - do not paste credentials into logs or docs.
- Link correctness:
  - one-off receipt revoke link starts with `APP_ORIGIN` and opens `/r/[token]`;
  - organization invite link starts with `APP_ORIGIN` and opens `/join/[token]`;
  - if recurring receipt remains legacy, verify `/rr/[token]` still uses `APP_ORIGIN`.

Commands after implementation:

- `npm run lint`
- `npm test`
- targeted tests: `npx tsx --test tests/feature-068-outbound-email-foundation.test.ts tests/feature-068-outbound-email-foundation-db.test.ts`
- `supabase db reset` if migrations are added; research does not show a migration is required for a config-only transport update.

## Options Considered

### Option A - Configure the existing SMTP transport only, with docs/env updates

Fit:

- Strong fit if implemented as an extension of `src/lib/email/outbound/smtp-transport.ts` and `config.ts`.
- The job model, registry, renderer structure, worker, and current adopters can stay unchanged.

Amount of change:

- Small. Add SMTP auth/TLS config, tests, and docs.

Security impact:

- Good if credentials stay in server-only env vars and logs are sanitized.
- Must preserve local unauthenticated sink mode by default.

Production migration impact:

- Good if generic SMTP names are used.
- Future `app@snapconsent.com` can be configured through SMTP provider env values.

Testability:

- Good with mocked Nodemailer option assertions.

Recommendation:

- Recommended bounded path.

### Option B - Add a provider/transport selector while keeping the current foundation

Fit:

- Reasonable, but more than the immediate Gmail SMTP development need.
- Useful if the plan wants `EMAIL_TRANSPORT=local-sink|smtp` for explicit mode selection.

Amount of change:

- Small to moderate.

Security impact:

- Good if auth config is required only for `smtp` real-send mode.
- Reduces accidental real-send risk by making opt-in explicit.

Production migration impact:

- Good. A future provider API can be added behind the selector.

Testability:

- Good, but requires selector tests in addition to SMTP option tests.

Recommendation:

- Acceptable if plan phase wants an explicit opt-in guard. Keep it minimal and do not add non-SMTP providers now.

### Option C - Add Gmail-specific transport code

Fit:

- Poor fit. Gmail is a development provider, not a product dependency.

Amount of change:

- Small initially, but creates unnecessary coupling.

Security impact:

- Worse than generic SMTP because it invites Gmail-specific env names and assumptions into app code.

Production migration impact:

- Poor. Moving to `app@snapconsent.com` or a transactional provider would require code churn.

Testability:

- Easy to test, but tests would encode the wrong abstraction.

Recommendation:

- Do not choose.

### Option D - Replace the current outbound foundation

Fit:

- Very poor fit. The live foundation already matches the architecture rules.

Amount of change:

- Large and high risk.

Security impact:

- High risk of regressing tenant scoping, token handling, retries, and centralized email rules.

Production migration impact:

- Unnecessary churn.

Testability:

- Expensive. Existing Feature 068 and org invite tests would need broad rewrites.

Recommendation:

- Do not choose.

## Recommended Bounded Direction

The plan phase should choose Option A, or Option B only if an explicit transport selector is desired.

Smallest safe path:

- Keep the current outbound foundation.
- Extend `OutboundEmailConfig` with generic SMTP auth/TLS fields.
- Update `createSmtpOutboundEmailTransport` so local sink mode remains unauthenticated/no-TLS by default, while real SMTP mode can use auth and STARTTLS/SSL.
- Keep Gmail as configuration only.
- Do not add route-local SMTP side effects.
- Do not add Gmail-specific email kinds or code paths.
- Do not migrate every missing email flow in this feature.
- Update `.env.example` and `README_APP.md` with placeholder-only local sink and real SMTP examples.
- Add focused tests for config parsing and Nodemailer options.

Likely config direction:

- Preserve existing `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`.
- Add `SMTP_USER`, `SMTP_PASSWORD`, and one or both of `SMTP_SECURE`, `SMTP_REQUIRE_TLS`.
- Consider `EMAIL_TRANSPORT=local-sink|smtp` only if plan phase wants explicit send-mode control.
- Consider `SMTP_REPLY_TO` only if there is an immediate product need; otherwise defer.

Default behavior:

- Development should remain local sink mode by default.
- Real SMTP should require explicit local env changes.
- Missing auth in real SMTP mode should fail before attempting dispatch.

## Risks and Tradeoffs

- If `ignoreTLS: true` remains hardcoded, Gmail SMTP will fail or be insecure. This must change.
- If real SMTP mode is not explicit enough, a developer could accidentally send external mail while testing.
- If provider errors are stored or logged raw, they might include sensitive connection or username details. Error sanitization should be reviewed.
- If `APP_ORIGIN` is `localhost`, Gmail-sent emails opened on a phone will not work. Docs must be clear.
- Gmail rate limits and spam filtering make it unsuitable for production transactional mail.
- Gmail sender identity may not match a future `app@snapconsent.com` sender. Production must use a custom-domain SMTP provider or transactional provider with proper domain authentication.
- The recurring receipt still uses the legacy helper. It can benefit from SMTP config changes because the helper now uses the shared SMTP transport, but it remains outside the typed job registry.
- Local Inbucket docs may be slightly misleading if Supabase CLI does not expose SMTP port 54325 unless `smtp_port` is uncommented or enabled by default in the CLI version.

## Open Decisions for Plan Phase

1. Should Feature 098 add only auth/TLS fields to the existing SMTP transport, or also add an explicit `EMAIL_TRANSPORT` selector?
2. What exact env var names should be canonical for TLS mode: `SMTP_SECURE`, `SMTP_REQUIRE_TLS`, both, or another existing repo convention?
3. Should local sink mode be inferred from missing `SMTP_USER`/`SMTP_PASSWORD`, or should real SMTP require `EMAIL_TRANSPORT=smtp`?
4. Should dispatch store raw provider error messages, sanitized messages, or only error codes for SMTP failures?
5. Should `SMTP_FROM` be allowed to differ from `SMTP_USER` in development, or should docs warn that Gmail may require the authenticated account or an authorized alias?
6. Should `.env.example` include a commented Gmail block, or should Gmail details live only in `README_APP.md` to reduce accidental copy/paste?
7. Should Feature 098 include a small README correction for the Inbucket/Mailpit drift and the now-live organization invite email flow?
8. Should recurring consent receipts be migrated into the typed foundation in a later feature, or left as a legacy helper until another recurring email feature is planned?
9. Should tests assert that no password appears in stored `last_error_message`, or is config/transport unit coverage enough for this slice?
10. Should Gmail SMTP manual validation use a consent receipt, a member invite, or a synthetic job created only in a local console/script? The safest manual path is a controlled member invite or test consent to a developer-owned address.
