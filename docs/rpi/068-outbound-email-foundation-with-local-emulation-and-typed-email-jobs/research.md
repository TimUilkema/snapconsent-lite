# Feature 068 Research - Outbound email foundation with local emulation and typed email jobs

## 1. Inputs reviewed

Required repo guidance, in requested order:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/PROMPTS.md` (`PROMPTS.md` requested; live repo file is under `docs/rpi/`)
- `docs/rpi/SUMMARY.md` (`SUMMARY.md` requested; live repo file is under `docs/rpi/`)

Relevant prior RPI docs reviewed as context only:

- `docs/rpi/002-projects-invites/research.md`
- `docs/rpi/002-projects-invites/plan.md`
- `docs/rpi/007-origin-url-consistency/research.md`
- `docs/rpi/007-origin-url-consistency/plan.md`
- `docs/rpi/051-baseline-recurring-consent-request-foundation/research.md`
- `docs/rpi/051-baseline-recurring-consent-request-foundation/plan.md`
- `docs/rpi/052-baseline-request-management/research.md`
- `docs/rpi/052-baseline-request-management/plan.md`
- `docs/rpi/054-baseline-follow-up-actions/research.md`
- `docs/rpi/054-baseline-follow-up-actions/plan.md`
- `docs/rpi/055-project-participants-and-mixed-consent-intake/research.md`
- `docs/rpi/055-project-participants-and-mixed-consent-intake/plan.md`
- `docs/rpi/067-consent-scope-state-and-upgrade-requests/research.md`
- `docs/rpi/067-consent-scope-state-and-upgrade-requests/plan.md`
- `docs/rpi/069-consent-upgrade-flow-owner-reuse-and-prefill-refinement/plan.md`

Current live code, schema, config, and tests reviewed as source of truth:

- `README.md`
- `DEPLOYMENT.md`
- `.env.example`
- `package.json`
- `supabase/config.toml`
- `supabase/migrations/20260304210000_002_projects_invites_schema.sql`
- `supabase/migrations/20260414193000_051_baseline_recurring_consent_request_foundation.sql`
- `supabase/migrations/20260414224500_054_baseline_follow_up_delivery_attempts.sql`
- `supabase/migrations/20260422190000_069_consent_upgrade_governing_foundations.sql`
- `supabase/migrations/20260422200000_069_upgrade_submit_binding_and_supersedence.sql`
- `src/app/i/[token]/consent/route.ts`
- `src/app/rp/[token]/consent/route.ts`
- `src/app/i/[token]/page.tsx`
- `src/app/rp/[token]/page.tsx`
- `src/lib/email/send-receipt.ts`
- `src/lib/email/templates/consent-receipt.ts`
- `src/lib/email/templates/recurring-consent-receipt.ts`
- `src/lib/consent/submit-consent.ts`
- `src/lib/recurring-consent/public-recurring-consent.ts`
- `src/lib/invites/public-invite-context.ts`
- `src/lib/url/external-origin.ts`
- `src/lib/url/paths.ts`
- `src/lib/http/redirect-relative.ts`
- `src/components/projects/invite-actions.tsx`
- `src/components/projects/one-off-consent-upgrade-form.tsx`
- `src/components/projects/project-participants-panel.tsx`
- `src/components/public/public-consent-form.tsx`
- `src/components/public/public-recurring-consent-form.tsx`
- `src/lib/idempotency/invite-idempotency.ts`
- `src/lib/projects/project-consent-upgrade-service.ts`
- `src/lib/profiles/profile-follow-up-service.ts`
- `src/lib/profiles/profile-follow-up-delivery.ts`
- `src/lib/projects/project-participants-service.ts`
- `src/lib/matching/auto-match-jobs.ts`
- `tests/feature-054-baseline-follow-up-actions.test.ts`
- `tests/feature-054-baseline-follow-up-actions-routes.test.ts`
- `tests/feature-069-governing-foundations.test.ts`
- `tests/feature-069-public-upgrade-ui.test.ts`
- `tests/feature-069-upgrade-submit-foundation.test.ts`

## 2. Verified current behavior

### 2.1 What email sending exists today

Live app email sending exists only for consent receipt emails:

- One-off consent receipt from `src/app/i/[token]/consent/route.ts`
- Recurring baseline consent receipt from `src/app/rp/[token]/consent/route.ts`

No other app-managed outbound email flow was found in live code:

- no project invite email sender
- no recurring invite/reminder email sender
- no user invite flow implemented in app code
- no photographer pool invite flow implemented in app code

Feature 069 did add new live business flows that are email-adjacent but still not email-backed:

- one-off consent upgrade requests created through `src/lib/projects/project-consent-upgrade-service.ts`
- recurring project consent replacement requests created through `src/lib/projects/project-participants-service.ts`

Those flows currently:

- create durable request state server-side
- return a relative public path (`invitePath` or `consentPath`)
- rely on copy/open/share UI in the protected app
- do not enqueue or send email

There is no central outbound-email foundation yet. Current implementation is:

- route handler submits domain action
- route handler builds revoke URL
- route handler calls a receipt-specific mail helper directly
- route handler marks `receipt_email_sent_at` if send succeeds
- route handler swallows send failures and redirects with `receipt=queued`

This is partially centralized only at the helper level. Dispatch decisions remain embedded in feature routes.

### 2.2 Where content and transport live today

Current content organization:

- `src/lib/email/templates/consent-receipt.ts`
- `src/lib/email/templates/recurring-consent-receipt.ts`

Each template is a typed renderer function that returns:

- `subject`
- `text`
- `html`

Current transport organization:

- `src/lib/email/send-receipt.ts`

That file:

- imports `nodemailer` directly
- reads `SMTP_HOST`, `SMTP_PORT`, and `SMTP_FROM`
- constructs a raw SMTP transport inline
- sends HTML and text directly

There is no provider-independent transport boundary, no generic email job type, and no registry of email kinds.

Feature 069 did not change that. It added prefill and upgrade-context helpers for public consent pages, but no outbound-email abstraction.

### 2.3 Current receipt flow behavior

One-off consent flow:

- `submitConsent(...)` writes the consent and returns `revokeToken`
- route builds revoke URL with `buildExternalUrl(buildRevokePath(...))`
- route calls `sendConsentReceiptEmail(...)`
- route calls `markReceiptSent(...)` on success
- on any email failure, consent still succeeds and the user is redirected with `receipt=queued`

Recurring consent flow behaves the same way, with one extra lookup:

- it fetches tenant name through `createAdminClient().from("tenants").select("name")`
- then sends `sendRecurringConsentReceiptEmail(...)`
- then calls `markRecurringConsentReceiptSent(...)`
- failures are also tolerated

### 2.4 Current local development story

Live repo docs describe local email via Inbucket:

- `README.md` says local Supabase config uses Inbucket
- Inbucket UI: `http://127.0.0.1:54324`
- SMTP target for app mailer: `127.0.0.1:54325`

Live app defaults match that expectation:

- `.env.example` sets `SMTP_HOST=127.0.0.1`
- `.env.example` sets `SMTP_PORT=54325`
- `.env.example` sets `SMTP_FROM=receipts@snapconsent.local`

Live Supabase config evidence:

- `supabase/config.toml` has `[inbucket] enabled = true`
- `supabase/config.toml` exposes the Inbucket web UI
- `supabase/config.toml` includes commented `smtp_port = 54325`

Practical conclusion:

- local inspection of outgoing mail is already repo-supported through Inbucket
- the app-side mailer assumes raw SMTP access
- local email behavior is documented, but not abstracted behind a reusable app transport layer

### 2.5 Current origin and absolute-link rules

The current repo has a clear split:

- internal redirects stay relative via `src/lib/http/redirect-relative.ts`
- browser share/open URLs use `window.location.origin` in `src/components/projects/invite-actions.tsx`
- email/external URLs use `APP_ORIGIN` via `src/lib/url/external-origin.ts`

`buildExternalUrl(path)`:

- requires a leading slash
- validates `APP_ORIGIN`
- rejects missing or invalid protocol/origin values

Current reusable public path builders:

- `buildInvitePath`
- `buildRevokePath`
- `buildRecurringProfileConsentPath`
- `buildRecurringProfileRevokePath`

Feature 069 increased the number of live flows that rely on those path builders:

- one-off upgrade requests reuse normal invite paths via `buildInvitePath(...)`
- recurring project replacement requests reuse `buildRecurringProfileConsentPath(...)`

Current browser-share behavior is now duplicated across several UI surfaces:

- `src/components/projects/invite-actions.tsx`
- `src/components/projects/project-participants-panel.tsx`
- `src/components/profiles/profiles-shell.tsx`

The shared pattern is still consistent:

- services return relative public paths
- browser UI resolves those paths against `window.location.origin` for copy/open/share
- external email links should still be derived server-side from the same relative paths via `APP_ORIGIN`

This means outbound email should reuse the existing external-origin model, not invent a second one.

### 2.6 Current retry, idempotency, and delivery patterns

Relevant existing patterns:

- `idempotency_keys` table is used for business request replay safety
- invite creation uses deterministic token derivation plus idempotency replay
- one-off upgrade request creation reuses standard invite transport plus idempotency replay
- recurring project consent request creation is idempotent and now permits active current consent plus a pending replacement request
- recurring baseline follow-up actions create durable delivery-attempt rows
- face-match work uses durable queued jobs plus internal worker/reconcile/repair routes

What does not exist today:

- no generic outbound email jobs table
- no email attempts table
- no email worker route
- no generic delivery abstraction shared across features

Current receipt tracking is only:

- `consents.receipt_email_sent_at`
- `recurring_profile_consents.receipt_email_sent_at`

That is enough to mark success once, but not enough to support durable retries, queue draining, or later provider swap concerns.

Feature 069 strengthens that gap because the repo now has more server-recorded request flows whose delivery transport is still manual copy/share only:

- one-off pending upgrade requests
- recurring project pending replacement requests

### 2.7 Tests and docs that currently touch related behavior

Verified tests exist for:

- recurring follow-up placeholder delivery attempt recording
- route-level idempotency and auth handling around follow-up actions
- Feature 069 tests for one-off and recurring upgrade prefill, owner reuse, and pending-versus-active project consent semantics

No test coverage was found for:

- `src/lib/email/send-receipt.ts`
- receipt template rendering
- local SMTP transport behavior
- absolute email-link generation in mail helpers

The live docs assume local email verification is manual through Inbucket, not test-driven.

## 3. Current schema, routes, helpers, config, and components involved

### 3.1 Schema and RPCs

One-off consent receipt state:

- `public.consents.receipt_email_sent_at`
- `public.consents.superseded_at`
- `public.consents.superseded_by_consent_id`
- `public.revoke_tokens`
- `public.mark_consent_receipt_sent(...)`

Recurring consent receipt state:

- `public.recurring_profile_consents.receipt_email_sent_at`
- `public.recurring_profile_consents.superseded_at`
- `public.recurring_profile_consents.superseded_by_consent_id`
- `public.recurring_profile_consent_revoke_tokens`
- `public.mark_recurring_profile_consent_receipt_sent(...)`

Adjacent request lifecycle state that now matters for future email jobs:

- `public.project_consent_upgrade_requests`
- `public.recurring_profile_consent_requests` for project replacement requests

Feature 069 made current/history semantics explicit for one-off consent and active/current semantics stricter for recurring project consent. Future email jobs for upgrade/replacement flows will need to respect those lifecycle states.

Closest existing delivery pattern:

- `public.recurring_profile_consent_request_delivery_attempts`

It is explicitly domain-specific:

- action kinds are `reminder` or `new_request`
- delivery mode is only `placeholder`
- it does not model reusable email kinds, rendered content, transport, or retries

### 3.2 Routes and services

Current live routes that send email:

- `src/app/i/[token]/consent/route.ts`
- `src/app/rp/[token]/consent/route.ts`

Current domain service wrappers around receipt state:

- `src/lib/consent/submit-consent.ts`
- `src/lib/recurring-consent/public-recurring-consent.ts`

Current delivery placeholder pattern:

- `src/lib/profiles/profile-follow-up-service.ts`
- `src/lib/profiles/profile-follow-up-delivery.ts`

Current live non-email request/share flows that are strong future email candidates:

- `src/lib/projects/project-consent-upgrade-service.ts`
- `src/lib/projects/project-participants-service.ts`
- `src/lib/invites/public-invite-context.ts`
- `src/lib/recurring-consent/public-recurring-consent.ts`

Current durable worker pattern reference:

- `src/lib/matching/auto-match-jobs.ts`
- internal routes under `src/app/api/internal/matching/*`

### 3.3 URL and token helpers

Current external-link helpers:

- `src/lib/url/external-origin.ts`
- `src/lib/url/paths.ts`

Current browser-host link pattern:

- `src/components/projects/invite-actions.tsx`

Relevant public token conventions:

- invite and recurring public paths are token-based
- revoke URLs are public-token URLs
- token generation and hashing are already server-side and deterministic where needed

### 3.4 Config and local infra

Current env/config relevant to outbound mail:

- `.env.example`: `SMTP_HOST`, `SMTP_PORT`, `SMTP_FROM`, `APP_ORIGIN`
- `supabase/config.toml`: local Inbucket configuration
- `README.md`: local email verification instructions
- `DEPLOYMENT.md`: optional SMTP and `APP_ORIGIN` deployment notes

## 4. Current constraints and invariants

Verified repo constraints that the email foundation must preserve:

- email sending must stay server-side only
- tenant scope must stay authoritative on the server
- client input must never decide tenant identity or email dispatch authority
- public links in email must use `APP_ORIGIN`, not request host or browser host
- internal redirects should remain relative and unchanged
- idempotency patterns should match current repo practice
- additive change is preferred over a generic messaging-system redesign
- pending replacement requests must not demote the currently governing consent until the new sign succeeds

Additional live-code constraints:

- current public consent submissions must still succeed if email fails
- local development already expects Inbucket-based inspection
- the repo already has internal worker patterns for durable async work
- the repo already has a narrower delivery-attempt pattern for follow-up actions
- one-off upgrades now reuse the existing owner and explicitly supersede the prior consent only after successful signing
- recurring project replacements can now coexist as `active current consent + pending request`, so future email jobs must not collapse those states

## 5. Current gaps relative to the desired email foundation

The live app is missing the following pieces required by this feature goal:

- one central outbound email entry point
- typed email-job modeling across more than receipts
- transport abstraction independent from `nodemailer`
- durable retryable job state
- reusable per-email-kind organization outside business routes
- worker/retry path for recorded-but-unsent email
- consistent sender identity foundation for future `app@snapconsent.com`
- tests around renderers, dispatch contract, and link generation

Specific current pitfalls:

- receipt sending is route-local and duplicated across two public routes
- failure path says `receipt=queued`, but there is no actual queue to recover from
- current timestamp-only receipt state cannot answer how many attempts occurred or why they failed
- changing template code between first attempt and retry would be unmanaged because no job model exists
- date rendering currently uses `toLocaleString()` without explicit locale/timezone, so output can vary by host environment
- live one-off upgrade requests and recurring project replacement requests already exist as durable business events, but there is no first-class email transport for those flows
- the repo now has multiple relative-path share flows, but no central server-side seam that turns those paths into durable outbound-email work

## 6. Options considered

### Option A - Direct helper call with typed payload and no durable job table

Shape:

- centralize current mail helper into a generic service
- add typed email kind union and renderers
- keep send inline in request path
- no schema changes

### Option B - Durable email job table with typed payload and status on the job row

Shape:

- create a single `outbound_email_jobs` table
- enqueue typed jobs after domain writes succeed
- send from a central dispatcher
- track status, attempts, and error state on the job row
- no separate attempts table yet

### Option C - Durable email job table plus separate email attempts table

Shape:

- create `outbound_email_jobs`
- create `outbound_email_job_attempts`
- each send try records a separate attempt row
- worker updates both job and attempts

### Option D - Reuse the existing recurring follow-up delivery-attempt pattern

Shape:

- extend or mimic `recurring_profile_consent_request_delivery_attempts`
- treat email as a delivery mode on that pattern

### Option E - Durable email job table plus optional immediate dispatch and internal worker fallback

Shape:

- same core schema as Option B
- business features enqueue durable job records
- the caller may immediately try to dispatch the just-enqueued job for fast feedback
- a small internal worker drains pending/failed jobs later
- correctness depends on durable jobs, not on same-request delivery succeeding

## 7. Tradeoffs by option

### Option A - Direct helper only

Maintainability:

- better than today because kinds/renderers can be centralized
- still keeps delivery behavior tightly coupled to request handlers

Transport independence:

- possible, but shallow
- business features would still think in terms of "send now"

Local-first fit:

- good for Inbucket
- simple local manual verification

Retry/idempotency fit:

- weak
- if request succeeds and send fails, there is no durable unit of work to recover

Future provider swap:

- medium
- transport can be swapped, but failure handling remains primitive

Testability:

- renderer tests would improve
- dispatch/retry behavior remains hard to verify meaningfully

Rollout complexity:

- lowest

Risk of overbuilding:

- low

Main issue:

- does not satisfy the stated goal of a reusable typed email-job pattern in a durable, retry-safe sense
- especially weak for live upgrade/replacement request flows where request creation already succeeds independently from any future delivery

### Option B - Durable jobs only

Maintainability:

- good
- central registry of kinds and one durable unit of work

Transport independence:

- good
- transport boundary becomes clean

Local-first fit:

- good
- worker or manual drain can target local Inbucket SMTP

Retry/idempotency fit:

- good if job uniqueness and claim/update rules are designed carefully
- weaker observability than Option C

Future provider swap:

- good
- provider-specific message ids can live on the job row

Testability:

- good for queue semantics, renderers, and transport contract

Rollout complexity:

- moderate

Risk of overbuilding:

- still bounded

Main issue:

- needs a decision on whether retries/history on the job row are enough for first slice

### Option C - Durable jobs plus attempts

Maintainability:

- strongest observability
- more moving parts and more schema surface

Transport independence:

- strong

Local-first fit:

- fine, but heavier than necessary for local-only first transport

Retry/idempotency fit:

- strongest audit trail

Future provider swap:

- strong

Testability:

- strong, but more fixtures and more assertions

Rollout complexity:

- highest of the bounded options

Risk of overbuilding:

- highest
- likely ahead of current repo needs for the first email foundation slice

Main issue:

- good eventual shape if deep provider observability becomes important, but not clearly justified by current live complexity

### Option D - Reuse recurring follow-up delivery-attempts

Maintainability:

- poor fit
- current schema is tied to recurring-profile follow-up semantics

Transport independence:

- poor

Local-first fit:

- only for placeholder recording, not for real email foundation

Retry/idempotency fit:

- weak for generic email

Future provider swap:

- poor

Testability:

- awkward because the model is not generic

Rollout complexity:

- deceptively low at first, but high long term because it bends a domain-specific table into a generic email system

Risk of overbuilding:

- low

Main issue:

- this is not actually reusable email infrastructure

### Option E - Durable jobs plus immediate dispatch and worker fallback

Maintainability:

- good
- business features enqueue jobs through one central API

Transport independence:

- good

Local-first fit:

- strongest practical fit for this repo
- local submit flows can still appear immediate
- worker path remains available for recovery and retries

Retry/idempotency fit:

- good
- job recording happens before delivery
- worker covers the "request succeeded but send failed" case

Future provider swap:

- good

Testability:

- good
- central dispatcher and worker claim rules can be tested separately

Rollout complexity:

- moderate

Risk of overbuilding:

- medium, but still bounded if it avoids a separate attempts table and keeps scope to email only

Main issue:

- needs careful claim/idempotency design to avoid duplicate sends between same-request dispatch and worker dispatch

## 8. Recommended bounded direction

Recommend Option E as the best bounded fit for the live repo:

- durable typed email jobs
- one central server-only dispatch foundation
- local SMTP/Inbucket transport first
- optional immediate dispatch for the newly created job
- internal worker fallback for retries and recovery
- no separate generic attempts table in the first slice

### 8.1 Why this best fits the live architecture

It matches the repo better than Option A because:

- current receipt failure already wants a queue-like recovery story
- current `receipt=queued` UX is misleading without durable queued work
- future invite/reminder flows need more than "send inline and hope"
- Feature 069 added server-recorded upgrade/replacement request flows that are already durable business state with copy/share transport only

It is more bounded than Option C because:

- the repo does not yet need full notifications-platform observability
- current delivery-attempt history exists only where business audit mattered directly
- a first email foundation can keep `attempt_count` and last error state on the job row

It matches existing repo patterns because:

- durable async work commonly uses internal worker routes
- idempotent business operations are already normal
- public-link generation is already centralized

### 8.2 Recommended application shape

#### Central API

Introduce one server-only email module, for example under `src/lib/email/`:

- `enqueueOutboundEmail(...)`
- `dispatchOutboundEmailJob(...)`
- `dispatchPendingOutboundEmailJobs(...)`

Business features should only know:

- email kind
- typed payload
- optional idempotency/dedupe key

They should not know:

- SMTP details
- provider API details
- HTML/text transport quirks

#### Typed email kinds

Use a typed union such as:

- `consent_receipt`
- `recurring_consent_receipt`
- `project_consent_upgrade_request`
- `project_recurring_consent_request`
- later: `recurring_profile_invite`, `recurring_profile_invite_reminder`, `user_invite`, `photographer_pool_invite`

Each kind should have:

- typed payload interface
- recipient resolution rules
- subject/text/html renderer
- optional dedupe/idempotency strategy

#### Template/content organization

Prefer typed renderer functions, not a generic template engine.

Reason:

- this matches the existing codebase
- current templates are already simple code renderers
- it avoids overbuilding admin-editable or string-template infrastructure

Recommended first-slice content shape:

- keep both plain text and HTML
- keep per-kind renderer files
- keep escaping/link construction inside shared helpers where appropriate

Plain-text-only would be smaller, but current live receipts already send HTML plus text. Regressing to text-only adds churn without a clear gain.

#### Transport abstraction

Define a minimal provider-independent contract now:

- input: rendered message (`from`, `to`, `subject`, `text`, `html`)
- output: provider-neutral send result with optional provider message id

First transport:

- local SMTP transport backed by Nodemailer and current `SMTP_*` envs
- target local Inbucket in development

Deferred until later provider feature:

- provider-specific API client
- webhooks/bounces
- analytics/open tracking
- branding controls
- advanced provider metadata

#### Durable schema

Recommend one bounded jobs table now, for example `outbound_email_jobs`, with fields along these lines:

- `id`
- `tenant_id`
- `email_kind`
- `status` (`pending`, `processing`, `sent`, `failed`)
- `to_email`
- `payload_json`
- `idempotency_key` or `dedupe_key`
- `provider_message_id` nullable
- `attempt_count`
- `max_attempts`
- `run_after`
- `last_attempted_at`
- `last_error_code`
- `last_error_message`
- `sent_at`
- `created_by` nullable where appropriate
- `created_at`
- `updated_at`

Why no attempts table yet:

- bounded first slice
- enough to support retries and future provider swap
- aligns with repo preference for small PR-sized changes

### 8.3 Safe first-slice behavior

Recommended first live adoption:

- build the foundation
- migrate one existing email flow only
- choose one-off consent receipt as the first thin vertical slice

Why one-off consent receipt is the best sample:

- it already exists today
- it is simpler than recurring receipt
- it already depends on `APP_ORIGIN` plus revoke-path generation
- it proves public-token email links, local emulation, typed payloads, and failure tolerance

Best next adopters after the first sample:

- one-off consent upgrade request email, because Feature 069 already creates a durable pending request and relative invite path
- recurring project consent request or replacement email, because the live repo now has explicit `active + pending replacement` semantics and share/open link behavior but still no delivery transport

What to defer from the first slice:

- migrating every existing receipt flow at once
- adding all future invite/reminder types
- building an admin-facing email management surface

Recurring receipt should likely be the second adopter after the pattern is proven.

## 9. Risks and edge cases

### Duplicate sends from retries

Risk:

- same request retries enqueue duplicate jobs
- immediate dispatch and worker dispatch race each other

Need:

- tenant-scoped dedupe/idempotency key
- claim/update rules that make one job sent once
- unique constraints strong enough to recover duplicate enqueue races

### Request succeeds but send fails

Current live behavior already allows this for receipts.

Need:

- domain write must stay committed
- durable job must survive send failure
- user-facing status should reflect "queued/pending retry" only if that is now actually true

### Job recorded but dispatch path fails

Risk:

- process dies after enqueue
- local SMTP temporarily unavailable
- worker token/scheduler not configured yet

Need:

- worker path that can drain pending jobs later
- manual local workflow to invoke worker if scheduling is not set up

### Wrong absolute origin in emails

Risk:

- using request host, browser host, localhost, or a stale LAN IP in email links

Need:

- always use `buildExternalUrl(...)`
- never build email links from browser-origin helpers
- validate `APP_ORIGIN` centrally

### Public-token link safety

Risk:

- emails include public revoke or consent URLs
- wrong tenant/context data in payload could leak to the wrong recipient

Need:

- payload and links derived from authoritative server-side records only
- no tenant id or recipient authority accepted from client input

### Transport swap later

Risk:

- current business features might accidentally depend on Nodemailer specifics

Need:

- provider-neutral transport interface
- provider-specific env/config isolated behind transport implementation

### Template sprawl

Risk:

- content gets scattered back into route handlers and feature services

Need:

- per-kind renderer files
- one registry/entry point
- renderer tests

### Overbuilding into a notifications platform

Risk:

- adding generic channels, campaigns, preferences, or admin template editing now

Need:

- keep scope explicitly to outbound transactional email
- model only email kinds needed by current/future consent flows

### Tenant leakage

Risk:

- wrong tenant label, wrong project name, or wrong recipient email in message content

Need:

- tenant scoping on every enqueue/read/update query
- payload assembly from server-loaded domain rows

### Race conditions for repeated invite/reminder creation

Risk:

- future invite/reminder/upgrade-request features can create multiple equivalent emails in concurrent requests

Need:

- per-feature dedupe strategy decided at enqueue time
- do not assume one generic dedupe key works for every email kind

### Current-vs-pending lifecycle drift

Risk:

- a pending one-off upgrade request or recurring project replacement request can expire, be superseded, or stop being shareable after the job was recorded

Need:

- dispatch-time validation for request-backed email kinds
- status-aware cancellation or no-op behavior for stale request-link jobs

### Owner-reuse and recipient drift

Risk:

- Feature 069 now updates the same one-off subject or recurring profile in place during upgrade signing
- a queued email could target stale owner fields if payload assembly is careless

Need:

- recipient and content for request-backed email kinds must be derived from authoritative current request/owner records at enqueue time
- plan phase must decide whether render-time revalidation is needed before send

### Local-only assumptions leaking into production design

Risk:

- baking Inbucket-specific behavior into business logic
- keeping local sender defaults like `receipts@snapconsent.local` as the long-term contract

Need:

- local SMTP transport should be just one transport implementation
- sender identity should be configurable and future-ready for `app@snapconsent.com`

### Rendering consistency

Risk:

- current templates use `toLocaleString()`, which can vary by runtime locale/timezone

Need:

- explicit formatting policy for timestamps in emails
- decide whether rendered output is snapshotted at enqueue time or render-time only

## 10. Explicit open decisions for the plan phase

1. Should the first slice include an internal email worker endpoint immediately, or only the durable job table plus a manual dispatcher for the newly created job?

2. Should rendered `subject`/`text`/`html` be snapshotted onto the job at enqueue time, or rendered from typed payload at send time?

3. What exact status model and claim strategy should `outbound_email_jobs` use to prevent duplicate sends across immediate dispatch and worker dispatch?

4. What exact dedupe/idempotency policy should be required per email kind, and which kinds should allow replay vs strict one-send semantics?

5. Should the first migration slice update only one-off consent receipts, or both receipt flows if the shared implementation delta is truly small?

6. Should request-backed email jobs validate that a one-off upgrade request or recurring project replacement request is still pending/shareable at dispatch time, and if so how should stale jobs be cancelled or ignored?

7. Should env/config keep the current `SMTP_*` names for the first transport and add a higher-level transport selector, or introduce app-specific outbound-email env names immediately?

8. What sender-address contract should the foundation expose now: target future production sender `app@snapconsent.com`, with a local/dev fallback such as `app@snapconsent.local`?

9. What explicit timestamp formatting policy should outbound email use so local/dev/prod renders stay deterministic enough for tests and retries?

10. After the first receipt-based slice, should the second adopter be one-off upgrade-request emails or recurring project request/replacement emails?

## Recommendation summary

Build a small server-only outbound email foundation around durable typed email jobs, a provider-neutral transport interface, and a local SMTP/Inbucket transport first. Keep the first slice additive: one `outbound_email_jobs` table, typed per-kind renderer functions, optional immediate dispatch for the newly created job, and an internal worker fallback for retry/recovery. Feature 069 does not change that recommendation; it strengthens it by adding live one-off and recurring request/replacement flows that already have durable business state and relative public paths but still rely on manual copy/share transport. Do not build a generic notification platform, and do not add a separate email-attempts table unless the plan phase finds a concrete first-slice need.
