# Feature 068 Plan - Outbound email foundation with local emulation and typed email jobs

## 1. Inputs and ground truth

Inputs reviewed in the required order:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `docs/rpi/README.md`
5. `docs/rpi/PROMPTS.md`
6. `docs/rpi/SUMMARY.md`
7. `docs/rpi/068-outbound-email-foundation-with-local-emulation-and-typed-email-jobs/research.md`

Path note:

- The repo does not contain root `PROMPTS.md` or `SUMMARY.md`.
- The live equivalents are `docs/rpi/PROMPTS.md` and `docs/rpi/SUMMARY.md`.

Targeted live verification used as current source of truth for plan-critical seams:

- `.env.example`
- `supabase/config.toml`
- `src/app/i/[token]/consent/route.ts`
- `src/app/rp/[token]/consent/route.ts`
- `src/app/api/internal/assets/worker/route.ts`
- `src/app/api/internal/matching/worker/route.ts`
- `src/lib/consent/submit-consent.ts`
- `src/lib/email/send-receipt.ts`
- `src/lib/email/templates/consent-receipt.ts`
- `src/lib/email/templates/recurring-consent-receipt.ts`
- `src/lib/invites/public-invite-context.ts`
- `src/lib/projects/project-consent-upgrade-service.ts`
- `src/lib/projects/project-participants-service.ts`
- `src/lib/recurring-consent/public-recurring-consent.ts`
- `src/lib/url/external-origin.ts`
- `supabase/migrations/20260422190000_069_consent_upgrade_governing_foundations.sql`
- `tests/feature-054-baseline-follow-up-actions.test.ts`
- `tests/feature-069-governing-foundations.test.ts`
- `tests/feature-069-public-upgrade-ui.test.ts`
- `tests/feature-069-upgrade-submit-foundation.test.ts`

Ground-truth conclusions that drive this plan:

- Live outbound email still exists only for one-off and recurring consent receipts.
- Receipt sending is still synchronous from public route handlers through `src/lib/email/send-receipt.ts`.
- The current `receipt=queued` fallback is not backed by a durable queue yet.
- Local development already has an SMTP mail sink story through Inbucket on `127.0.0.1:54325`.
- Email-safe absolute URLs already have an app-wide rule: relative path builder plus `buildExternalUrl(...)` backed by `APP_ORIGIN`.
- Feature 069 added durable request and upgrade semantics that future email kinds will need to honor, but it did not add a reusable outbound-email abstraction.
- The repo already uses token-protected internal worker routes, so adding an internal email worker fits existing architecture better than inventing a second async pattern.

## 2. Verified current boundary

This plan stays inside the smallest additive foundation needed to make outbound email reusable and retry-safe without redesigning messaging across the app.

Included now:

- one reusable server-side outbound email foundation
- one additive durable email-jobs table
- typed email-kind registry and renderer structure
- provider-neutral transport boundary
- SMTP transport using the existing local Inbucket wiring
- internal worker endpoint for retry and recovery
- email-safe absolute-link generation through existing path helpers plus `buildExternalUrl(...)`
- one migrated live adopter: one-off consent receipt

Explicitly deferred:

- recurring receipt migration
- invite, reminder, and follow-up email migration
- production provider rollout
- SPF, DKIM, DMARC, bounce handling, analytics, tracking, template CMS, campaign tooling
- a generic multi-channel notification system
- a separate attempts table
- a separate repair or replay endpoint

Feature 069 does not widen this scope. It only raises the importance of request-aware validation hooks for future email kinds.

## 3. Options considered

### Option A - Keep synchronous helper calls and just centralize templates

Pros:

- smallest code change
- no schema work

Cons:

- no durable queue state
- no truthful retry story
- business routes still depend on transport timing
- does not fit the repo's existing worker and recovery patterns

### Option B - Durable jobs with no immediate dispatch

Pros:

- durable from the start
- clean worker-based separation

Cons:

- slower user-visible feedback for the first adopter
- forces worker availability even for simple local use
- larger behavioral shift from the current receipt path than necessary

### Option C - Durable jobs plus immediate dispatch but no worker

Pros:

- bounded first migration
- preserves current fast-path behavior

Cons:

- "queued" still has no recovery path if the process dies after enqueue
- no automated retry or stale lease reclaim
- weaker fit with the repo's existing internal worker approach

### Option D - Durable jobs plus immediate dispatch plus internal worker fallback

Pros:

- keeps the domain action independent from delivery success
- makes "queued" and retry behavior real
- reuses the repo's existing internal worker pattern
- keeps business features transport-agnostic
- supports local SMTP now and a provider swap later

Cons:

- more moving parts than a pure synchronous helper
- needs one new table and worker endpoint

## 4. Recommendation

Choose Option D.

This matches the Feature 068 research recommendation with one plan-phase correction:

- include the internal email worker in the first slice
- do not include a separate reconcile or repair endpoint yet

Why this is the best bounded fit for the current repo:

- The app already has internal worker routes and durable async domain patterns, so email should align with that instead of remaining a special-case synchronous side effect.
- The current receipt flow already tolerates mail failure independently from the consent write, so durable jobs are a natural extension of live behavior.
- Immediate dispatch preserves the current "try now" UX while the worker makes recovery and retries real.
- One jobs table is enough for the first slice. A separate attempts table would add operational detail before the repo has multiple transports or operator tooling that needs it.

## 5. Chosen architecture

### 5.1 First-slice architecture

- Business route calls a server-only enqueue function with a typed email kind and typed payload.
- Enqueue renders and snapshots the message content for normal success cases, inserts or reuses a durable job row, and returns the canonical job.
- The route immediately tries to dispatch that job through the same central dispatch path the worker uses.
- If the immediate dispatch does not finish as `sent`, the route still succeeds and the job remains available for worker retry or lease reclaim.
- A token-protected internal worker endpoint claims due jobs in batches and dispatches them through the same path.

### 5.2 First migrated adopter

The exact first adopter is the one-off consent receipt path in `src/app/i/[token]/consent/route.ts`.

Why this slice is chosen:

- It is the smallest live email flow.
- It already has a stable typed template and existing domain write hook for `receipt_email_sent_at`.
- It proves the architecture without widening Feature 068 into upgrade requests, reminders, or recurring migration work.

Recurring receipt stays on the old helper in this feature and becomes the next obvious adopter after the foundation is proven.

## 6. Exact schema/model plan

Add one new table: `public.outbound_email_jobs`.

Columns:

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null references public.tenants(id) on delete cascade`
- `email_kind text not null`
- `status text not null`
- `dedupe_key text not null`
- `payload_json jsonb not null default '{}'::jsonb`
- `to_email text not null`
- `from_email text not null`
- `rendered_subject text null`
- `rendered_text text null`
- `rendered_html text null`
- `attempt_count integer not null default 0`
- `max_attempts integer not null default 5`
- `run_after timestamptz not null default now()`
- `locked_at timestamptz null`
- `lease_expires_at timestamptz null`
- `last_worker_id text null`
- `last_attempted_at timestamptz null`
- `provider_message_id text null`
- `last_error_code text null`
- `last_error_message text null`
- `sent_at timestamptz null`
- `cancelled_at timestamptz null`
- `dead_at timestamptz null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Checks:

- `status in ('pending', 'processing', 'sent', 'cancelled', 'dead')`
- `attempt_count >= 0`
- `max_attempts > 0`
- `jsonb_typeof(payload_json) = 'object'`
- `rendered_subject is not null and rendered_text is not null` is required before an actual send attempt, but not required for a terminal `dead` row created after enqueue-time rendering fails

Indexes and constraints:

- unique index on `(tenant_id, dedupe_key)`
- index on `(tenant_id, status, run_after, created_at)`
- index on `(tenant_id, status, lease_expires_at)`
- optional convenience index on `(tenant_id, email_kind, created_at desc)` if tests or local inspection show it helps; otherwise defer

Trigger:

- reuse the repo's normal `updated_at` touch pattern for updates

Why one table is enough now:

- the first slice only needs durable state, dedupe, retry count, lease metadata, and last error visibility
- the repo does not yet have operator tooling or provider integrations that justify a separate attempts log
- adding attempts later is additive and does not require changing the business-facing enqueue API

Why a separate attempts table is out of scope now:

- it adds schema, write volume, and query complexity before the app has more than one migrated email flow
- the first slice can answer all required product questions with `attempt_count`, `last_attempted_at`, and the current error fields

## 7. Exact job lifecycle, status, dedupe, and retry plan

Statuses:

- `pending`: durable and eligible once `run_after <= now()`
- `processing`: claimed by immediate dispatch or worker under a lease
- `sent`: transport succeeded and post-send hooks ran
- `cancelled`: terminal no-send state because the job is stale or no longer valid
- `dead`: terminal failure after max attempts or an explicitly permanent failure

Transitions:

- enqueue creates `pending` unless the same `(tenant_id, dedupe_key)` already exists
- immediate dispatch or worker claim moves `pending` to `processing`
- successful send moves `processing` to `sent`
- retryable failure moves `processing` back to `pending` with a later `run_after`
- stale-validation failure moves `processing` to `cancelled`
- permanent failure or retry exhaustion moves `processing` to `dead`
- expired `processing` lease can be reclaimed back into `processing` by a new claimer without a separate repair endpoint

Claim semantics:

- immediate dispatch and worker dispatch both call one shared claim function
- the claim update is conditional on either `status = 'pending' and run_after <= now()` or `status = 'processing' and lease_expires_at < now()`
- claiming sets `status = 'processing'`, `locked_at`, `lease_expires_at`, `last_worker_id`, `last_attempted_at`, and increments `attempt_count`
- if two callers race, only one update succeeds and the loser treats the job as already claimed

Lease and retry policy:

- lease duration: 5 minutes
- retry backoff by `attempt_count`: `1 minute`, `5 minutes`, `15 minutes`, `60 minutes`
- if a retryable failure occurs after the last allowed attempt, move the job to `dead`

Dedupe semantics:

- every email kind must define a deterministic `dedupe_key`
- first-slice receipt dedupe key: `consent_receipt:${consentId}`
- enqueue uses insert-or-fetch behavior so request retries or double submits do not create duplicate sends

Immediate-dispatch versus worker race handling:

- the request path enqueues first, then tries to claim that exact job id
- the worker claims only due jobs through the same update rules
- whichever path claims first sends
- the other path sees the row as already claimed or already terminal and does nothing

Partial failure rule:

- the domain action remains authoritative and succeeds independently from email delivery
- the email system records delivery state durably and retries separately

## 8. Exact renderer, template, and content plan

Chosen strategy:

- render subject, text, and html at enqueue time for normal cases
- store the rendered snapshot on the job row
- also store the typed payload JSON used to build the message

Why enqueue-time rendering is chosen:

- retries resend the same content instead of drifting with later data changes
- tests can assert deterministic stored output
- business routes do not need to keep feature-specific render logic inline
- it keeps the worker transport-focused instead of making it rebuild business state on every retry

Tradeoff accepted:

- enqueue-time rendering needs app-origin and template dependencies to be available at enqueue time
- the first slice accepts nullable rendered fields only so enqueue-time render failures can still be recorded as `dead` rows instead of disappearing silently

Content organization:

- keep per-kind content in centrally named renderer modules under `src/lib/email/outbound/renderers/`
- keep a typed registry in `src/lib/email/outbound/registry.ts`
- each email kind module owns:
  - payload type
  - dedupe-key builder
  - renderer
  - optional `validateBeforeSend`
  - optional `afterSend`

First-slice email kind:

- `consent_receipt`

Renderer contract:

- input: typed payload, app config, and any required domain-derived values
- output: `subject`, `text`, `html`

Template policy for the first slice:

- keep `html + text`
- reuse the current typed renderer style instead of adding a full template engine
- replace `toLocaleString()` usage with one deterministic helper that formats UTC timestamps as `YYYY-MM-DD HH:mm UTC`

## 9. Exact transport and config plan

Provider-neutral interface:

```ts
type OutboundEmailMessage = {
  from: string;
  to: string;
  subject: string;
  text: string;
  html?: string | null;
};

type OutboundEmailSendResult = {
  providerMessageId?: string | null;
};

interface OutboundEmailTransport {
  send(message: OutboundEmailMessage): Promise<OutboundEmailSendResult>;
}
```

First concrete transport:

- SMTP transport backed by `nodemailer`
- local development points at Inbucket through the existing `SMTP_HOST` and `SMTP_PORT`

Config in the first slice:

- keep `SMTP_HOST`
- keep `SMTP_PORT`
- keep `SMTP_FROM`
- add `OUTBOUND_EMAIL_WORKER_TOKEN`

Deliberate config non-decisions:

- do not add a transport-selector env yet
- do not introduce provider-specific rollout config yet
- do not force `app@snapconsent.com` in this feature; keep sender driven by `SMTP_FROM`, with the later provider rollout free to change that value without changing business code

## 10. Exact API, read/write, and worker plan

Planned central modules:

- `src/lib/email/outbound/types.ts`
- `src/lib/email/outbound/registry.ts`
- `src/lib/email/outbound/config.ts`
- `src/lib/email/outbound/transport.ts`
- `src/lib/email/outbound/smtp-transport.ts`
- `src/lib/email/outbound/timestamps.ts`
- `src/lib/email/outbound/jobs.ts`
- `src/lib/email/outbound/worker.ts`
- `src/lib/email/outbound/renderers/consent-receipt.ts`

Core server-only functions:

- `enqueueOutboundEmailJob(...)`
- `dispatchOutboundEmailJobById(...)`
- `dispatchClaimedOutboundEmailJob(...)`
- `runOutboundEmailWorker(...)`

Registry responsibilities:

- define the typed payload schema per email kind at compile time
- build `dedupe_key`
- render content
- optionally validate a job before send
- optionally run an idempotent post-send hook

Job service responsibilities:

- insert or reuse durable rows
- claim a specific job or a batch of due jobs
- update status, lease, retry, and terminal state
- expose only server-side entry points

Worker endpoint:

- add `POST /api/internal/email/worker`
- auth with `Authorization: Bearer <OUTBOUND_EMAIL_WORKER_TOKEN>`
- accept optional `{ batchSize?: number, workerId?: string }`
- return counts for `claimed`, `sent`, `retried`, `cancelled`, and `dead`

Why the worker is included now:

- without it, queued jobs are not actually recoverable after process death
- the repo already has this endpoint pattern for other durable background work
- it is the smallest addition that makes durable jobs operationally real

Why a separate repair endpoint is deferred:

- stale `processing` rows are already recoverable by lease expiry
- the first slice does not need operator-triggered replay or bulk reconciliation yet

## 11. Exact link and origin behavior

Rules:

- email links must use existing relative path builders plus `buildExternalUrl(...)`
- browser share and copy flows remain unchanged and continue using `window.location.origin`
- services that currently return relative public paths keep doing so

First-slice receipt behavior:

- the receipt renderer reuses `buildRevokePath(...)`
- it converts that relative path to an absolute email-safe URL with `buildExternalUrl(...)`

Future request-backed email behavior:

- upgrade-request and reminder emails should reuse the same live relative-path outputs already used by browser share flows
- the email foundation should not invent a second origin model or alternate URL builder

## 12. Exact first adoption slice

Included in Feature 068:

- add the outbound email jobs table and supporting code
- migrate the one-off consent receipt route to enqueue plus immediate dispatch
- update the one-off receipt template into the new renderer location and structure
- add the internal email worker endpoint and worker service
- add bounded tests for enqueue, dispatch, retry, and the migrated route

Deferred from Feature 068:

- recurring receipt migration
- migration of upgrade-request, project-invite, or reminder flows
- any UI for inspecting queued or failed emails

Route-level behavior for the first adopter:

- keep the existing domain submit flow unchanged
- after successful one-off consent creation, enqueue a `consent_receipt` job if the current route would have sent a receipt before
- immediately try to dispatch that job
- on synchronous success, run the post-send hook that marks `receipt_email_sent_at`
- on non-sent outcomes, keep the consent success path and preserve the current user-facing fallback behavior

## 13. Security and reliability considerations

Tenant scoping:

- every enqueue, claim, read, update, cancel, and send path carries `tenant_id`
- dedupe and due-job queries are tenant-scoped

Server-only authority:

- only server routes and server modules can enqueue or dispatch jobs
- the client never supplies sender configuration or send authority
- the client never directly dispatches email

Recipient authority:

- the first adopter takes recipient data from the saved consent write path, not from post-submit client authority
- future request-backed email kinds must derive recipients from server-validated request state

Idempotency and dedupe:

- one deterministic dedupe key per email kind
- insert-or-fetch semantics prevent duplicate rows from route retries
- post-send hooks must be idempotent

Worker auth:

- use a dedicated token env, not user auth
- match the repo's existing internal worker protection pattern

Stale request safety:

- the registry supports optional `validateBeforeSend`
- future request-backed jobs should cancel instead of send when the underlying request is no longer pending or no longer shareable

Transport independence:

- business features call the enqueue API and never import `nodemailer`
- SMTP stays behind the transport interface

## 14. Edge cases

- Duplicate enqueue race: handled by unique `(tenant_id, dedupe_key)` plus insert-or-fetch logic.
- Immediate-dispatch versus worker race: handled by one shared claim update and lease ownership.
- Request succeeds but send fails: domain action still succeeds; job moves to retry or terminal state.
- Job recorded but process dies before dispatch: worker or later request can reclaim after lease expiry or pick up pending work.
- Bad or missing `APP_ORIGIN`: receipt job can fail rendering or validation; record the failure durably and keep domain success independent.
- Stale request-backed jobs: future kinds use `validateBeforeSend` and transition to `cancelled`.
- Sender-address drift: sender continues to come from `SMTP_FROM`; misconfiguration is isolated to transport and job-state failure rather than business data corruption.
- Deterministic timestamp policy: all email rendering uses the new UTC formatter, never `toLocaleString()`.
- Tenant leakage: job payloads and renderers must only use tenant-scoped data already validated on the server.
- Overbuilding risk: keep the registry and transport contract email-specific; do not generalize into a multi-channel notification framework.

## 15. Test plan

Unit tests:

- renderer output for `consent_receipt`
- deterministic UTC timestamp formatting helper
- registry behavior for dedupe key and render contract
- SMTP transport contract using a mocked `nodemailer` transport

Service tests:

- enqueue dedupe behavior
- claim semantics for immediate-dispatch and worker races
- retry transition behavior and backoff scheduling
- terminal `dead` and `cancelled` transitions
- idempotent post-send hook behavior

Route and integration tests:

- one-off consent route sends through the new enqueue plus dispatch path on success
- one-off consent route preserves consent success when dispatch fails
- one-off consent route does not duplicate receipt jobs on retried submissions
- worker endpoint auth and batch dispatch behavior

Manual local verification:

- run local Supabase with Inbucket enabled
- submit a one-off consent locally
- verify the email lands in the Inbucket UI and the revoke link uses the configured `APP_ORIGIN`

## 16. Implementation phases

Phase 1 - Schema and foundation:

- add `outbound_email_jobs` migration
- add config, types, registry, transport, timestamp helper, and job service modules
- add one-off receipt renderer in the new structure

Phase 2 - Dispatch and worker:

- add claim, dispatch, retry, and lease-reclaim logic
- add `POST /api/internal/email/worker`
- add service-level tests for job lifecycle behavior

Phase 3 - First adopter migration:

- refactor `src/app/i/[token]/consent/route.ts` to enqueue and immediately dispatch the one-off receipt
- move `receipt_email_sent_at` updates behind the email-kind post-send hook
- keep recurring receipt on the old path for now

Phase 4 - Verification and cleanup:

- add route and integration tests
- verify local Inbucket flow manually
- remove only the one-off direct-send usage that the new foundation replaces

## 17. Scope boundaries

Feature 068 will implement now:

- a reusable server-only outbound email foundation
- one durable email jobs table
- SMTP-backed local/dev delivery through the existing Inbucket wiring
- typed per-kind renderers and central registry
- internal worker retry and recovery path
- one-off consent receipt as the first migrated adopter

This foundation should enable later without redesign:

- recurring consent receipt migration
- one-off upgrade-request emails
- recurring replacement-request emails
- user invite and photographer-pool invite emails
- reminders and follow-up emails that need stale-request validation

Still deferred after Feature 068:

- production provider rollout and sender-domain operations
- provider-specific metadata and webhooks
- operator UI for queue inspection or replay
- richer delivery analytics
- branding, CMS, or generalized notification-product features

## 18. Concise implementation prompt

Implement Feature 068 as one additive outbound-email foundation built around a single `outbound_email_jobs` table, a typed email-kind registry, enqueue-time rendering with stored subject/text/html snapshots, an SMTP transport using the existing `SMTP_*` configuration, and a token-protected internal email worker endpoint. Migrate only the one-off consent receipt route to this foundation in this feature. Keep domain success independent from email delivery, keep all enqueue and dispatch logic server-side and tenant-scoped, reuse existing relative path builders plus `buildExternalUrl(...)` for absolute email links, use deterministic UTC timestamp formatting in email templates, and keep recurring receipts plus all other future email kinds deferred.
