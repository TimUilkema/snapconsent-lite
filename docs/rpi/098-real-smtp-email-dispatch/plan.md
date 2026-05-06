# Feature 098 Plan - Real SMTP email dispatch configuration

## Inputs and ground truth

Required inputs were read in order:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `docs/rpi/README.md`
5. `docs/rpi/SUMMARY.md`
6. `docs/rpi/PROMPTS.md`
7. `README_APP.md`
8. `docs/rpi/098-real-smtp-email-dispatch/research.md`

Targeted live-code verification was limited to:

- `src/lib/email/outbound/config.ts`
- `src/lib/email/outbound/smtp-transport.ts`
- `src/lib/email/outbound/transport.ts`
- `src/lib/email/outbound/jobs.ts`
- `src/lib/email/outbound/worker.ts`
- `src/lib/email/outbound/registry.ts`
- `src/lib/email/outbound/types.ts`
- `src/lib/email/outbound/consent-receipt-delivery.ts`
- `src/lib/email/outbound/tenant-membership-invite-delivery.ts`
- `src/app/api/internal/email/worker/route.ts`
- `src/lib/url/external-origin.ts`
- `src/lib/url/paths.ts`
- `.env.example`
- `README_APP.md`
- `package.json`
- `tests/feature-068-outbound-email-foundation.test.ts`
- `tests/feature-068-outbound-email-foundation-db.test.ts`

Current live code, migrations, and tests are the source of truth. Older RPI docs and summary text are context only.

## Targeted verification summary

The live outbound email foundation already exists and should be preserved. Typed jobs are enqueued through `src/lib/email/outbound/jobs.ts`, rendered through registry entries in `src/lib/email/outbound/registry.ts`, and dispatched by either immediate dispatch or `POST /api/internal/email/worker`.

The live email kinds are:

- `consent_receipt`
- `tenant_membership_invite`

The live SMTP boundary is `src/lib/email/outbound/smtp-transport.ts`. It currently calls Nodemailer with:

```ts
{
  host: config.smtpHost,
  port: config.smtpPort,
  secure: false,
  ignoreTLS: true,
}
```

This is appropriate for the current local unauthenticated SMTP sink, but it is not compatible with Gmail SMTP because Gmail requires authentication and TLS/STARTTLS.

The live config boundary is `src/lib/email/outbound/config.ts`. It currently supports only:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_FROM`
- `OUTBOUND_EMAIL_WORKER_TOKEN`

`README_APP.md` has two documented drift points to correct during implementation:

- It says current live app-managed email use is only the one-off consent receipt flow, but live code also sends tenant membership invite emails through the outbound foundation.
- It documents Inbucket for local sink mode, while `docs/rpi/SUMMARY.md` mentions Mailpit. Live app docs and `.env.example` use the Inbucket-style local SMTP sink settings.

No database schema change is needed. The existing job row already snapshots from/to/content, records provider message id, records failure code/message, and supports retry/dead/cancelled states.

## Chosen architecture

Choose Option B: add a minimal explicit selector, `EMAIL_TRANSPORT=local-sink|smtp`, while keeping the existing outbound foundation unchanged.

Rationale:

- It materially reduces accidental real email sends because authenticated external SMTP requires explicit opt-in.
- It keeps Gmail as configuration only.
- It preserves local sink as the default development path.
- It keeps all provider details inside `src/lib/email/outbound/`.
- It leaves the existing job model, renderers, registry, worker route, public token semantics, and APP_ORIGIN link generation untouched.

Do not add Gmail-specific code. Gmail is only the first development SMTP provider configured through generic SMTP env vars.

## Exact scope boundary

In scope:

- SMTP config parsing and validation in `src/lib/email/outbound/config.ts`.
- SMTP transport option construction in `src/lib/email/outbound/smtp-transport.ts`.
- Safe error message handling for provider/transport failures in `src/lib/email/outbound/jobs.ts` if needed.
- `.env.example` placeholder updates.
- `README_APP.md` updates for local sink mode and real SMTP development mode.
- Focused tests around config parsing, transport options, local sink defaults, Gmail-style settings, and error sanitization.

Out of scope:

- New email kinds.
- Migrating recurring consent receipt emails into the typed outbound registry.
- Sending one-off invite links by email if not already implemented.
- Sending recurring consent request links by email if not already implemented.
- Sending consent upgrade request links by email if not already implemented.
- SPF, DKIM, DMARC, production domain setup, or provider-specific production setup.
- Resend, SendGrid, Mailgun, SES, or any provider API.
- Supabase Auth email behavior.
- Public token route semantics.
- Consent audit semantics.
- Outbound email database schema changes or migrations.

## Environment variable contract

Preserve existing env vars:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_FROM`
- `OUTBOUND_EMAIL_WORKER_TOKEN`
- `APP_ORIGIN`

Add:

- `EMAIL_TRANSPORT`
- `SMTP_USER`
- `SMTP_PASSWORD`
- `SMTP_SECURE`
- `SMTP_REQUIRE_TLS`

Do not add `SMTP_REPLY_TO` in this slice. It is not required for Gmail development SMTP, and adding it would require extending message/transport behavior without a current product need. It can be added later behind the same outbound foundation.

### EMAIL_TRANSPORT

Allowed values:

- unset or empty: default to `local-sink`
- `local-sink`: unauthenticated local SMTP sink mode
- `smtp`: authenticated real SMTP mode

Any other value fails with `HttpError(500, "invalid_smtp_config", "Email transport configuration is invalid.")`.

### Local sink mode

Default mode:

```env
EMAIL_TRANSPORT=local-sink
SMTP_HOST=127.0.0.1
SMTP_PORT=54325
SMTP_FROM=receipts@snapconsent.local
```

If `EMAIL_TRANSPORT` is unset, the app behaves as `local-sink`.

Required:

- `SMTP_HOST`, default `127.0.0.1`
- `SMTP_PORT`, default `54325`
- `SMTP_FROM`, default `receipts@snapconsent.local`

Not allowed in local sink mode:

- non-empty `SMTP_USER`
- non-empty `SMTP_PASSWORD`
- explicitly configured `SMTP_SECURE`
- explicitly configured `SMTP_REQUIRE_TLS`

If any real-SMTP-only setting is present while `EMAIL_TRANSPORT` is unset or `local-sink`, fail with a safe config error telling the developer to set `EMAIL_TRANSPORT=smtp` for authenticated SMTP.

This avoids silently ignoring credentials or accidentally trying a real provider with local-sink TLS behavior.

### Real SMTP mode

Example for Gmail STARTTLS development mode:

```env
EMAIL_TRANSPORT=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
SMTP_USER=<GMAIL_ADDRESS>
SMTP_PASSWORD=<GMAIL_APP_PASSWORD>
SMTP_FROM="SnapConsent <GMAIL_ADDRESS>"
APP_ORIGIN=http://<LAN_OR_TUNNEL_HOST>:3000
```

Example for implicit TLS on port 465:

```env
EMAIL_TRANSPORT=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_REQUIRE_TLS=false
SMTP_USER=<GMAIL_ADDRESS>
SMTP_PASSWORD=<GMAIL_APP_PASSWORD>
SMTP_FROM="SnapConsent <GMAIL_ADDRESS>"
```

Required in `smtp` mode:

- non-empty `SMTP_HOST`
- integer `SMTP_PORT` from 1 through 65535
- non-empty `SMTP_FROM`
- non-empty `SMTP_USER`
- non-empty `SMTP_PASSWORD`
- encrypted SMTP delivery using either `SMTP_SECURE=true` or `SMTP_REQUIRE_TLS=true`

Defaults in `smtp` mode:

- `SMTP_SECURE`: defaults to `true` when `SMTP_PORT=465`, otherwise `false`
- `SMTP_REQUIRE_TLS`: defaults to `false` when `SMTP_SECURE=true`, otherwise `true`

Boolean parsing:

- Accept only `true` or `false`, case-insensitive, after trimming.
- Empty/unset means use the mode-specific default.
- Values such as `1`, `yes`, `on`, or any other string fail as invalid config.

Validation:

- If `SMTP_SECURE=false` and `SMTP_REQUIRE_TLS=false` in `smtp` mode, fail. Real SMTP mode must not authenticate over plaintext.
- `SMTP_FROM` may differ from `SMTP_USER` because production SMTP providers and authorized aliases commonly support that. `README_APP.md` should warn that Gmail may show or require the authenticated Gmail account or an authorized alias.
- Never validate or print the password value.

## OutboundEmailConfig changes

Update `OutboundEmailConfig` from:

```ts
type OutboundEmailConfig = {
  smtpHost: string;
  smtpPort: number;
  smtpFrom: string;
};
```

to:

```ts
type OutboundEmailTransportMode = "local-sink" | "smtp";

type OutboundEmailConfig = {
  emailTransport: OutboundEmailTransportMode;
  smtpHost: string;
  smtpPort: number;
  smtpFrom: string;
  smtpUser: string | null;
  smtpPassword: string | null;
  smtpSecure: boolean;
  smtpRequireTls: boolean;
};
```

The implementation may keep helper functions private inside `config.ts`, but tests should be able to exercise `getOutboundEmailConfig()` by temporarily setting `process.env`.

## SMTP transport behavior

### Local sink mode

For `emailTransport: "local-sink"`, preserve the current behavior:

```ts
nodemailer.createTransport({
  host: config.smtpHost,
  port: config.smtpPort,
  secure: false,
  ignoreTLS: true,
});
```

No `auth` object should be passed.

### Gmail STARTTLS mode on port 587

For:

```env
EMAIL_TRANSPORT=smtp
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_REQUIRE_TLS=true
SMTP_USER=<GMAIL_ADDRESS>
SMTP_PASSWORD=<GMAIL_APP_PASSWORD>
```

create:

```ts
nodemailer.createTransport({
  host: config.smtpHost,
  port: config.smtpPort,
  secure: false,
  requireTLS: true,
  ignoreTLS: false,
  auth: {
    user: config.smtpUser,
    pass: config.smtpPassword,
  },
});
```

### Implicit TLS mode on port 465

For:

```env
EMAIL_TRANSPORT=smtp
SMTP_PORT=465
SMTP_SECURE=true
SMTP_REQUIRE_TLS=false
```

create:

```ts
nodemailer.createTransport({
  host: config.smtpHost,
  port: config.smtpPort,
  secure: true,
  requireTLS: false,
  ignoreTLS: false,
  auth: {
    user: config.smtpUser,
    pass: config.smtpPassword,
  },
});
```

`ignoreTLS: true` must be used only for `local-sink`.

## Validation and failure behavior

Config errors should throw `HttpError(500, "invalid_smtp_config", "<safe message>")`.

Safe config messages should be specific enough for a developer to fix `.env.local`, but must not include env values. Examples:

- `SMTP port configuration is invalid.`
- `SMTP from configuration is invalid.`
- `SMTP auth configuration is required for real SMTP mode.`
- `SMTP TLS configuration is required for real SMTP mode.`
- `SMTP auth settings require EMAIL_TRANSPORT=smtp.`

Public-facing consent or invite flows should keep existing behavior: delivery helpers catch email failures and return queued-style statuses instead of surfacing SMTP details to the subject or member.

The internal worker route can return a normal JSON error for invalid configuration through existing `jsonError`, but the message must not include secrets.

## Error sanitization and logging plan

Current `jobs.ts` stores raw `Error.message` for non-`HttpError` failures. That is too permissive for SMTP provider failures because provider messages can include usernames, hosts, or connection details.

Update error handling so:

- `HttpError` code/message is preserved because these are app-authored safe messages.
- Non-`HttpError` transport/provider errors are stored as:
  - code: `outbound_email_dispatch_failed`, or a sanitized/allowlisted provider code if implementation chooses to preserve known codes such as `EAUTH` or `ECONNECTION`;
  - message: `Outbound email dispatch failed. Check server logs and SMTP configuration.`
- Do not store raw SMTP provider messages in `last_error_message`.
- Do not log SMTP password, username/password pairs, connection URLs, or raw config.
- Existing `outbound_email_after_send_failed` logging should use the same sanitizer for non-`HttpError` errors.

No new logging is required. If implementation adds debug logging during development, it must not be committed.

## Documentation plan

Update `.env.example` with placeholder-only values.

The committed defaults should keep local sink mode easy:

```env
EMAIL_TRANSPORT=local-sink
SMTP_HOST=127.0.0.1
SMTP_PORT=54325
SMTP_FROM=receipts@snapconsent.local
```

Add commented real SMTP placeholders:

```env
# Real authenticated SMTP for local development only:
# EMAIL_TRANSPORT=smtp
# SMTP_HOST=smtp.gmail.com
# SMTP_PORT=587
# SMTP_SECURE=false
# SMTP_REQUIRE_TLS=true
# SMTP_USER=<GMAIL_ADDRESS>
# SMTP_PASSWORD=<GMAIL_APP_PASSWORD>
# SMTP_FROM="SnapConsent <GMAIL_ADDRESS>"
```

Update `README_APP.md`:

- Keep the central outbound email foundation instructions.
- Document local sink mode as the default.
- Document that the local sink currently targets Inbucket-style local SMTP settings, not Mailpit.
- Correct the live supported flow list: one-off consent receipts and tenant membership invites are already app-managed outbound email jobs.
- Document real SMTP development mode with Gmail as an example only.
- Warn that Gmail app passwords belong only in `.env.local` or a local secret store and must not be committed, pasted into docs, screenshots, logs, or tests.
- Warn that Gmail is development-only and not suitable for production transactional sending.
- Explain that future production sending from `app@snapconsent.com` should use a custom-domain SMTP provider or transactional provider through configuration.
- Document that `APP_ORIGIN` controls email links and must be reachable from the device opening the email. For phone testing, use a LAN host or tunnel instead of `localhost`.
- Keep the worker endpoint example and note that it drains already queued jobs using the configured transport.

## Security and privacy considerations

- SMTP credentials remain server-only environment variables.
- Do not expose SMTP credentials through client components, Next public env vars, API responses, or logs.
- Do not add `NEXT_PUBLIC_` SMTP vars.
- Do not alter public token semantics for `/i`, `/r`, `/rp`, `/rr`, or `/join` links.
- Do not change tenant scoping. Jobs remain tenant-scoped rows with tenant-scoped dedupe keys.
- Do not change consent audit behavior. Email retry should only affect email job state.
- Do not treat tenant, project, workspace, or invite ids embedded in emails as authority. Tokens and server-side lookups remain authoritative.
- Gmail app passwords are secrets. Use only placeholders such as `<GMAIL_APP_PASSWORD>` in docs and tests.

## Retry and idempotency considerations

No job model changes are required.

Existing behavior remains:

- `(tenant_id, dedupe_key)` reduces duplicate queued jobs.
- Worker claims jobs under leases.
- Failed retryable sends return to `pending` with backoff.
- Exhausted sends become `dead`.
- Invite validation can cancel stale/superseded jobs.
- Rare duplicate sends remain possible if SMTP delivery succeeds and the process crashes before the job is marked sent. This feature does not change that risk.

Adding SMTP auth/TLS must not create duplicate consents, memberships, invites, revocations, or audit rows. Retries only resend email for an existing job.

## Edge cases

- `EMAIL_TRANSPORT=smtp` with missing `SMTP_USER` or `SMTP_PASSWORD`: fail config validation before SMTP send.
- `EMAIL_TRANSPORT=smtp` with plaintext settings (`SMTP_SECURE=false` and `SMTP_REQUIRE_TLS=false`): fail config validation.
- `EMAIL_TRANSPORT=local-sink` with SMTP credentials set: fail config validation and require explicit `EMAIL_TRANSPORT=smtp`.
- Invalid boolean strings: fail config validation.
- Invalid port, zero port, negative port, or port above 65535: fail config validation.
- Empty `SMTP_HOST` or `SMTP_FROM`: fail config validation.
- Gmail account/password problems: job dispatch should fail with sanitized stored error and retry according to existing job behavior.
- `APP_ORIGIN=localhost` while opening email on a phone: email is sent, but links will not work on that phone. This is a documentation/manual-validation issue, not a transport issue.
- Gmail visible sender may be the authenticated Gmail account or an authorized alias even if `SMTP_FROM` uses a display name.

## Test plan

Update `tests/feature-068-outbound-email-foundation.test.ts` with focused unit tests.

Add config parsing tests:

- `getOutboundEmailConfig` defaults to `local-sink`, `127.0.0.1`, `54325`, `receipts@snapconsent.local`, no auth, `smtpSecure=false`, `smtpRequireTls=false`.
- Local sink mode rejects `SMTP_USER` or `SMTP_PASSWORD` unless `EMAIL_TRANSPORT=smtp`.
- Invalid `EMAIL_TRANSPORT` fails with `invalid_smtp_config`.
- Invalid boolean values fail with `invalid_smtp_config`.
- Gmail-style STARTTLS config parses with `emailTransport="smtp"`, `smtpSecure=false`, `smtpRequireTls=true`, `smtpUser` set, and `smtpPassword` set.
- Port 465 SMTP config defaults or parses to `smtpSecure=true` and `smtpRequireTls=false`.
- SMTP mode rejects missing auth.
- SMTP mode rejects plaintext settings.

Add transport option tests with mocked Nodemailer:

- Local sink mode creates a transport with no `auth`, `secure:false`, and `ignoreTLS:true`.
- Gmail STARTTLS mode creates a transport with `auth`, `secure:false`, `requireTLS:true`, and `ignoreTLS:false`.
- Port 465 mode creates a transport with `auth`, `secure:true`, `requireTLS:false`, and `ignoreTLS:false`.
- Transport still forwards provider message id and message fields.

Add or update error sanitization tests:

- A non-`HttpError` thrown by a fake transport causes worker/dispatch failure to store a generic safe `last_error_message`, not the raw thrown message.
- The test raw message should include fake sensitive-looking text such as `<GMAIL_APP_PASSWORD>` and assert that it is not stored.
- Preserve existing membership invite cancellation tests, which rely on safe app-authored validation error messages.

Existing DB tests in `tests/feature-068-outbound-email-foundation-db.test.ts` should continue to pass. Add the sanitization DB assertion there if it needs real job persistence; otherwise keep it in the unit test with mocked dependencies only if practical.

Run after implementation:

- `npm run lint`
- `npx tsx --test tests/feature-068-outbound-email-foundation.test.ts tests/feature-068-outbound-email-foundation-db.test.ts`
- `npm test`

No `supabase db reset` is required unless implementation unexpectedly adds a migration. This plan expects no migration.

## Manual validation plan

Do not send real email automatically from tests or scripts.

### Local sink mode

1. Use local sink env defaults in `.env.local`.
2. Start Supabase local stack and the app.
3. Open the local sink UI documented in `README_APP.md`.
4. Submit a one-off test consent to a controlled address.
5. Verify the consent receipt arrives in the local sink.
6. Create or resend a tenant membership invite to a controlled address.
7. Verify the invite arrives in the local sink.
8. Call `POST /api/internal/email/worker` with `OUTBOUND_EMAIL_WORKER_TOKEN` and verify queued jobs drain.

### Gmail SMTP development mode

1. Configure only `.env.local` with placeholders replaced locally:
   - `EMAIL_TRANSPORT=smtp`
   - `SMTP_HOST=smtp.gmail.com`
   - `SMTP_PORT=587`
   - `SMTP_SECURE=false`
   - `SMTP_REQUIRE_TLS=true`
   - `SMTP_USER=<GMAIL_ADDRESS>`
   - `SMTP_PASSWORD=<GMAIL_APP_PASSWORD>`
   - `SMTP_FROM="SnapConsent <GMAIL_ADDRESS>"`
2. Set `APP_ORIGIN` to a browser/phone-reachable LAN or tunnel origin.
3. Restart the app so env changes are loaded.
4. Submit a low-risk test one-off consent to a developer-owned recipient address.
5. Verify receipt delivery and confirm the revoke link starts with `APP_ORIGIN` and opens `/r/[token]`.
6. Create or resend a test tenant membership invite to a developer-owned recipient address.
7. Verify invite delivery and confirm the join link starts with `APP_ORIGIN` and opens `/join/[token]`.
8. If a job is queued rather than immediately sent, call the internal worker endpoint with the configured worker token.
9. Do not paste credentials, provider logs, screenshots with secrets, or app passwords into docs, commits, issues, or PRs.

## Implementation phases

### Phase 1 - Config contract

- Add `EMAIL_TRANSPORT`, SMTP auth, and TLS fields to `OutboundEmailConfig`.
- Implement strict env parsing and safe validation in `config.ts`.
- Add config parsing tests.

### Phase 2 - Transport options

- Update `createSmtpOutboundEmailTransport` to branch on `emailTransport`.
- Preserve current local sink Nodemailer options.
- Add authenticated SMTP options for STARTTLS and implicit TLS.
- Add mocked Nodemailer tests for local sink, Gmail STARTTLS, and port 465 behavior.

### Phase 3 - Safe failure details

- Sanitize non-`HttpError` dispatch failure messages before storing/logging.
- Add regression coverage that fake secret-looking content is not stored in `last_error_message`.
- Preserve app-authored validation messages for cancellation paths.

### Phase 4 - Docs

- Update `.env.example` with local sink defaults and commented real SMTP placeholders only.
- Update `README_APP.md` for local sink, Gmail development SMTP, APP_ORIGIN, and current live supported app-managed email flows.

### Phase 5 - Verification

- Run targeted Feature 068 tests.
- Run lint.
- Run the full test suite if targeted tests and lint pass.
- Do not perform Gmail manual validation unless the developer intentionally configures local secrets and asks for it.

## Scope boundaries and non-goals

- Do not add route-local SMTP calls.
- Do not import Nodemailer outside the outbound email foundation.
- Do not add client-side email sending.
- Do not add or expose SMTP credentials through public env vars.
- Do not add Gmail-specific code paths, names, or product behavior.
- Do not change registered email payload schemas unless required by TypeScript compile fixes.
- Do not change public token paths or token authority.
- Do not change database schema.
- Do not change Supabase Auth email settings.
- Do not send real emails from automated tests.

## Implementation prompt

Implement Feature 098 by following `docs/rpi/098-real-smtp-email-dispatch/plan.md` as the implementation contract.

Before coding, read:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/098-real-smtp-email-dispatch/plan.md`

Keep deviations minimal. Implement in phases:

1. Config contract and parsing tests.
2. SMTP transport option construction and mocked Nodemailer tests.
3. Safe provider error handling and regression coverage.
4. `.env.example` and `README_APP.md` updates.
5. Targeted tests, lint, then full tests.

Do not include real SMTP credentials, do not send real email automatically, and keep Gmail as configuration only.
