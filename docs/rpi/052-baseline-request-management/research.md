# Feature 052 Research: Baseline Request Management

## Scope

Research the smallest coherent operational management slice for pending baseline recurring consent requests after Feature 051.

This feature is about managing pending baseline requests safely and clearly. It is not a reminder system, not a profile-history redesign, and not a new consent-kind feature.

## Inputs reviewed

### Required repo docs

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `docs/rpi/README.md`
5. `docs/rpi/049-recurring-profiles-and-consent-management-foundations/research.md`
6. `docs/rpi/049-recurring-profiles-and-consent-management-foundations/plan.md`
7. `docs/rpi/050-recurring-profile-directory-foundation/research.md`
8. `docs/rpi/050-recurring-profile-directory-foundation/plan.md`
9. `docs/rpi/051-baseline-recurring-consent-request-foundation/research.md`
10. `docs/rpi/051-baseline-recurring-consent-request-foundation/plan.md`

### Live schema and tests used as source of truth

- `supabase/migrations/20260414170000_050_recurring_profile_directory_foundation.sql`
- `supabase/migrations/20260414193000_051_baseline_recurring_consent_request_foundation.sql`
- `tests/feature-051-baseline-recurring-consent-request-foundation.test.ts`
- `tests/feature-051-baseline-recurring-consent-request-routes.test.ts`

### Live recurring-profile and baseline-request implementation reviewed

- `src/app/(protected)/profiles/page.tsx`
- `src/components/profiles/profiles-shell.tsx`
- `src/app/api/profiles/[profileId]/baseline-consent-request/route.ts`
- `src/lib/profiles/profile-access.ts`
- `src/lib/profiles/profile-route-handlers.ts`
- `src/lib/profiles/profile-directory-service.ts`
- `src/lib/profiles/profile-consent-service.ts`
- `src/app/rp/[token]/page.tsx`
- `src/app/rp/[token]/consent/route.ts`
- `src/app/rr/[token]/page.tsx`
- `src/app/rr/[token]/revoke/route.ts`
- `src/lib/recurring-consent/public-recurring-consent.ts`
- `src/lib/recurring-consent/revoke-recurring-profile-consent.ts`
- `src/lib/tokens/public-token.ts`
- `src/lib/url/paths.ts`
- `src/lib/email/send-receipt.ts`
- `src/lib/http/errors.ts`
- `src/lib/tenant/resolve-tenant.ts`
- `messages/en.json`
- `messages/nl.json`

## Verified current live baseline-request lifecycle

## 1. Current schema states versus actually used states

### Request row

Live table: `public.recurring_profile_consent_requests`

Implemented request statuses:

- `pending`
- `signed`
- `expired`
- `superseded`
- `cancelled`

Actually used in live code today:

- `pending`
  used when a request is created
- `signed`
  used when the public sign flow succeeds
- `expired`
  used opportunistically when a stale pending request is touched by create, public GET, or public submit
- `cancelled`
  used automatically when a profile is archived
- `superseded`
  present in schema, public status handling, and UI messaging branches, but not currently written by any live service or SQL path

Important live implication:

- the schema already anticipated replace or rotate behavior
- the shipped Feature 051 implementation did not actually add a replace or supersede operation

### Signed consent row

Live table: `public.recurring_profile_consents`

Current live signed baseline model:

- one signed row per request via unique `request_id`
- one active baseline consent per profile via partial unique index where `revoked_at is null`
- revocation updates the signed row in place with `revoked_at` and `revoke_reason`
- signed rows remain immutable audit records otherwise

### Revoke token and event rows

Live supporting tables:

- `public.recurring_profile_consent_revoke_tokens`
- `public.recurring_profile_consent_events`

Current event types:

- `granted`
- `revoked`

There is no separate request-event table. Request lifecycle is currently represented only on the request row itself.

## 2. How pending baseline requests are created today

Protected create entrypoint:

- `POST /api/profiles/[profileId]/baseline-consent-request`

Server-side flow:

1. route authenticates and resolves tenant server-side
2. route requires `Idempotency-Key`
3. `createBaselineConsentRequest(...)` enforces owner/admin access
4. service validates UUIDs and confirms the selected template is a visible published template
5. service derives a new request id and deterministic public token from `requestId`
6. service calls SQL RPC `public.create_recurring_profile_baseline_request(...)`

SQL create behavior:

- locks the profile row
- rejects missing or archived profiles
- rejects callers without recurring-profile management access
- validates the template is published and signable
- opportunistically expires stale pending baseline requests for the profile
- rejects creation if the profile already has an active signed baseline consent
- returns the existing pending request if one already exists
- otherwise inserts one new `pending` request row with:
  - `profile_name_snapshot`
  - `profile_email_snapshot`
  - `token_hash`
  - `expires_at`

Important live behavior:

- request creation is idempotent by header and also concurrency-safe at the DB layer
- if an active pending request already exists, the create path reuses it even when the caller supplies a different idempotency key
- because of that reuse behavior, there is currently no way to rotate the token or swap to a new request while one pending request remains active

## 3. What happens when a request is signed

Public sign entrypoints:

- `GET /rp/[token]`
- `POST /rp/[token]/consent`

Lookup behavior:

- public GET hashes the token and calls `public.get_public_recurring_profile_consent_request(...)`
- that RPC opportunistically expires the token row if it is stale
- it returns `can_sign = true` only when:
  - request status is `pending`
  - request is not expired
  - profile is active
  - template body, version, and structured definition remain available

Submit behavior:

- public submit locks the request row `for update`
- duplicate submit on an already `signed` request returns the existing consent row
- non-`pending` requests are rejected as unavailable
- expired pending requests are marked `expired` and rejected
- archived profile requests are rejected
- if an active signed baseline already exists for the profile, submit is rejected
- structured values are validated in SQL
- successful submit:
  - inserts the immutable recurring consent row
  - inserts a revoke token row
  - marks the request `signed`
  - inserts a `granted` event
  - returns the raw revoke token for receipt sending

Best-effort post-commit behavior:

- the route tries to send a recurring consent receipt email
- if receipt delivery succeeds, it marks `receipt_email_sent_at`
- if receipt delivery fails, the consent remains signed and the UI shows a queued/deferred receipt notice

Important live detail:

- the public form lets the signer edit name and email fields
- the SQL submit path validates those submitted values
- but the signed recurring consent row stores `profile_name_snapshot` and `profile_email_snapshot` from the request row, not the edited form values

That means the request snapshot is currently the authoritative identity snapshot for the signed recurring record.

## 4. What happens when a signed baseline consent is revoked

Public revoke entrypoints:

- `GET /rr/[token]`
- `POST /rr/[token]/revoke`

Revoke behavior:

- revoke uses a separate revoke token, not the request token
- repeated revoke is idempotent and returns an already-revoked outcome
- revocation does not mutate the request row
- revocation sets `revoked_at`, optionally `revoke_reason`, and writes a `revoked` event

Important live implication:

- request management and signed-consent revocation are already distinct domains in the recurring-profile module
- Feature 052 should preserve that separation

## 5. What happens when a profile is archived

Live profile model from Feature 050 is create-plus-archive only:

- there is no supported profile edit path
- DB triggers reject updates to `full_name`, `email`, and `profile_type_id`
- only the active -> archived transition is supported

Live archive interaction with baseline requests:

- `app.cancel_pending_recurring_profile_consent_requests()` runs after profile update
- when a profile changes from `active` to `archived`, all pending baseline requests for that profile are set to `cancelled`

Current effect:

- the pending public link becomes unusable immediately
- public request lookup will show the request as unavailable
- `/profiles` no longer shows a pending request for that archived profile

Important live implication:

- archive already behaves like an automatic cancel of pending baseline requests
- this behavior shipped in DB trigger form, not as a separate request-management service

## 6. Whether stale or expired requests are already handled

Stale pending requests are already handled, but only opportunistically.

Live write/read touch points:

- create RPC expires stale pending requests for the profile before deciding whether to reuse or create
- public GET expires the matching pending request if its token is stale
- public submit expires the matching pending request before rejecting it

Current `/profiles` behavior:

- `listRecurringProfilesPageData(...)` reads request rows directly
- derived `pending` state only counts rows whose `expires_at` is still in the future
- the list page therefore hides stale pending rows from derived state even if the row has not yet been updated from `pending` to `expired`

Important live implication:

- stale request state is partly normalized on reads and writes
- there is no scheduler or global cleanup job
- request-status visibility on `/profiles` is currently derived, not an authoritative lifecycle view

## Current schema, routes, components, and helpers involved

## Schema and SQL

- `recurring_profile_consent_requests`
- `recurring_profile_consents`
- `recurring_profile_consent_revoke_tokens`
- `recurring_profile_consent_events`
- `public.create_recurring_profile_baseline_request(...)`
- `public.get_public_recurring_profile_consent_request(...)`
- `public.submit_public_recurring_profile_consent(...)`
- `public.get_public_recurring_profile_revoke_token(...)`
- `public.revoke_public_recurring_profile_consent(...)`
- archive-trigger cancellation via `app.cancel_pending_recurring_profile_consent_requests()`

## Protected routes and services

- `POST /api/profiles/[profileId]/baseline-consent-request`
- `src/lib/profiles/profile-consent-service.ts`
- `src/lib/profiles/profile-route-handlers.ts`

## Public routes and services

- `/rp/[token]`
- `/rp/[token]/consent`
- `/rr/[token]`
- `/rr/[token]/revoke`
- `src/lib/recurring-consent/public-recurring-consent.ts`
- `src/lib/recurring-consent/revoke-recurring-profile-consent.ts`

## `/profiles` page and state derivation

- `src/app/(protected)/profiles/page.tsx`
- `src/components/profiles/profiles-shell.tsx`
- `src/lib/profiles/profile-directory-service.ts`

## Token and path helpers

- `deriveRecurringProfileConsentToken({ requestId })`
- `deriveRecurringProfileRevokeToken({ consentId })`
- `buildRecurringProfileConsentPath(token)`
- `buildRecurringProfileRevokePath(token)`

## Error, auth, and tenant conventions reused

- `HttpError`
- `jsonError`
- `resolveTenantId(...)`
- owner/admin recurring-profile management checks in `resolveProfilesAccess(...)`

## Operational gaps after Feature 051

## 1. There is no explicit cancel action

What exists now:

- archive auto-cancels pending requests
- there is no protected owner/admin action to cancel a pending request while keeping the profile active

Operational consequence:

- if a link was sent to the wrong person, staff cannot invalidate it without archiving the profile

## 2. There is no explicit replace or rotate action

What exists now:

- pending request creation always reuses the existing active pending request
- request token is deterministic from the request id
- there is no path that marks an existing pending request `superseded` and creates a new pending request

Operational consequence:

- staff cannot rotate a compromised or stale pending link
- staff cannot intentionally replace the current pending request with a new token
- the schema has `superseded` status and `superseded_by_request_id`, but the feature does not actually use them yet

## 3. Copy-link exists, but only as a pending-link panel

What exists now:

- `/profiles` shows `Copy baseline link` only when a pending request exists
- the panel exposes the current active URL plus copy/open actions

What is missing:

- no explicit distinction in the UI between:
  - copying the current active link
  - invalidating the current active link
  - replacing the current active link

Operational consequence:

- the current UI supports resend-by-copy only
- it does not support pending-request lifecycle management

## 4. Current versus prior request visibility is weak

What `/profiles` currently shows:

- derived baseline state badge
- one secondary activity line:
  - pending until
  - signed at
  - revoked at
  - missing

What it does not show:

- latest request status when it is `cancelled`, `expired`, or future `superseded`
- active request email snapshot
- whether the currently visible pending link is the original request or a replacement
- any reason a profile moved from pending back to missing

Operational consequence:

- after cancellation, expiry, or archive-driven cancellation, the list collapses back to `missing`
- admins cannot tell from the list whether a request never existed or existed and was cancelled

## 5. Email-change handling is not operationally supported

Current live fact:

- recurring profiles cannot be edited through supported code paths
- DB triggers reject updates to `full_name`, `email`, and `profile_type_id`

Current request snapshot model:

- request rows store immutable `profile_email_snapshot`
- signed consent rows reuse the request snapshot

Operational consequence:

- Feature 052 should not expand into general profile editing
- but it should define the intended behavior once an email-edit feature exists:
  - the old pending request should keep its original snapshot
  - replace should be the admin action that generates a new token and new request snapshot for the updated email

## 6. Archive behavior is safe, but not visible enough

Current live behavior is already safe:

- archive immediately cancels pending requests
- the public link becomes unusable

Current visibility gap:

- the archived profile row does not make the cancelled request visible
- the list simply stops showing a pending request

Operational consequence:

- Feature 052 does not need to change archive semantics
- it likely does need clearer request-state presentation after archive-triggered cancellation

## Options considered

## Option A: Keep Feature 051 as-is and defer all request management

Pros:

- zero schema or lifecycle expansion

Cons:

- leaves the main operational gap open
- wrong-recipient and compromised-link cases remain unresolved
- schema support for `cancelled` and `superseded` stays mostly unused

Recommendation:

- reject

## Option B: Add cancel only

Pros:

- smallest new lifecycle mutation
- solves "make current link unusable"

Cons:

- does not solve safe token rotation
- forces a two-step cancel then create flow for replacement
- makes sign-versus-replace race handling clumsier

Recommendation:

- not sufficient by itself

## Option C: Add cancel, then tell staff to create a new request manually

Pros:

- technically workable with existing create flow

Cons:

- split operation is not atomic
- stale UI can easily target the wrong current request
- race between cancel and create is more complex than one replace action
- user intent is really "replace this pending request", not "perform two separate lifecycle actions"

Recommendation:

- better than today, but still not the cleanest bounded feature

## Option D: Add bounded pending-request management on `/profiles`

Include:

- `Copy active link`
- `Cancel pending request`
- `Replace pending request`
- clearer request-state presentation on `/profiles`
- preserve current archive auto-cancel behavior

Defer:

- reminders
- outbound delivery
- full history page
- generic profile editing

Why this fits the live code best:

- reuses the existing list-first module entry point
- fills the real operational gap left by Feature 051
- uses statuses already modeled in schema
- keeps the feature centered on pending baseline requests only

Recommendation:

- recommend

## Recommended bounded feature scope

Feature 052 should include exactly this bounded management slice:

- keep current `Request baseline consent` behavior for `missing` and `revoked`
- keep current `Copy baseline link` behavior for active pending requests
- add an explicit owner/admin `Cancel request` action for active pending baseline requests
- add an explicit owner/admin `Replace request` action for active pending baseline requests
- make `/profiles` show current request status more clearly, including lightweight visibility for cancelled or superseded outcomes
- preserve current archive auto-cancel semantics

Feature 052 should not include:

- reminders
- initial outbound email sending
- extra consent request kinds
- full profile detail/history redesign
- general profile editing
- baseline template defaulting unless the replace UX truly requires a template choice

## Recommended request lifecycle transitions

## Existing transitions to preserve

- `pending -> signed`
- `pending -> expired`
- `pending -> cancelled` on profile archive
- `signed consent -> revoked`

## New transitions to add in Feature 052

- `pending -> cancelled`
  explicit admin cancel while profile remains active
- `pending -> superseded`
  explicit admin replace of the current pending request
- `superseded -> no further use`
  old link must become unusable immediately

## Semantics to keep distinct

### Copy active link

- same request row
- same token
- no lifecycle change
- no idempotency requirements beyond normal read behavior

### Cancel pending request

- target the current pending request
- request becomes unusable immediately
- no new request is created
- repeat cancel should be naturally idempotent

### Replace pending request

- target the current pending request
- atomically mark old request `superseded`
- atomically create a new pending request with a new request id and new token
- old link becomes unusable immediately
- retry after lost response should return the same replacement result via idempotency

## Recommended implementation rule for target selection

Prefer request-id-targeted lifecycle operations, not profile-only mutations.

Reason:

- stale `/profiles` UIs are likely in concurrent admin workflows
- targeting a specific current request id avoids accidentally cancelling or superseding a newer pending request created by another admin

## Recommended `/profiles` page evolution

Keep `/profiles` as the operational home for baseline request management.

Recommended row actions for active profiles:

- `missing` or `revoked`
  - `Request baseline consent`
- `pending`
  - `Copy baseline link`
  - `Cancel request`
  - `Replace request`
- `signed`
  - no baseline-request action
- archived profiles
  - no baseline-request actions

Recommended UI shape:

- extend the existing inline per-row panel rather than adding a detail page
- reuse the current pending link panel for copy/open
- add cancel and replace controls in that same row-level management area

Recommended lightweight request visibility:

- keep the baseline state badge
- make the secondary line more explicit about request lifecycle
- add enough current-request metadata to avoid ambiguity, likely:
  - active request expiry
  - active request email snapshot
  - latest request outcome when the profile is back to `missing`

Recommended minimal visibility goal:

- admins should be able to tell the difference between:
  - no request ever created
  - active pending request
  - request cancelled
  - request superseded
  - request signed

This can stay list-first. It does not require a full profile history page.

## What should be reused

- current request row lifecycle model and partial unique index
- deterministic request token derivation from request id
- public token invalidation semantics driven by request status
- protected route-handler pattern and `HttpError` shaping
- `Idempotency-Key` pattern already used for request creation
- `/profiles` list-first rendering and baseline-state derivation pattern
- archive-trigger cancellation behavior
- i18n framework and existing `profiles` namespace

## Security and reliability considerations

- keep all lifecycle transitions server-side
- derive tenant from auth or token context only
- never accept tenant id from the client
- preserve immutable signed recurring-consent records
- preserve separate revoke flow for signed consent
- use SQL row locking or equivalent atomic server logic for cancel and replace
- use parameterized query-builder or RPC APIs only

Recommended reliability rules:

- cancel should be naturally idempotent
- replace should require `Idempotency-Key`
- replace should return the already-created replacement request on retry
- stale UIs should not be able to cancel or replace a newer request silently
- old tokens must become unusable immediately after cancel or replace

## Edge cases

- duplicate cancel requests against the same pending request
- duplicate replace requests after lost response
- concurrent cancel and replace on the same request
- concurrent sign and cancel on the same request
- concurrent sign and replace on the same request
- concurrent archive and replace on the same request
- stale `/profiles` row acting on an old request id after another admin already replaced it
- stale expired requests that the list has hidden but SQL has not yet rewritten
- active signed baseline appearing while a replace or create retry is in flight
- archived profile with a formerly pending request that was auto-cancelled
- future profile email change while a pending request exists

Recommended intended behavior for email changes once editing exists:

- request rows keep their original email snapshot
- changing the profile email does not silently mutate an existing pending request
- replace is the admin action that should issue a new token tied to a fresh request snapshot

## Explicitly deferred work

- reminders and reminder scheduling
- outbound reminder delivery
- initial outbound request email sending
- extra or specific consent requests
- full request-history UI or profile timeline
- profile detail redesign
- general profile editing flow
- baseline template defaulting unless needed for replace ergonomics
- import and sync
- headshots, matching, or CompreFace integration

## Open decisions for the plan phase

- What exact protected route shape should cancel and replace use: profile-scoped, request-scoped, or both?
- Should replace require the current pending request id as a concurrency guard? Recommendation: yes.
- Should replace reuse the current request's template automatically, or reopen template selection? Recommendation: reuse the current template by default for the bounded slice.
- What is the smallest request visibility addition on `/profiles` that cleanly distinguishes `missing` from `cancelled` without becoming a history page?
- Should `/profiles` surface the request email snapshot in the pending panel so staff can verify they are copying the current link for the intended recipient?
- Should cancel and replace outcomes use `updated_at` as the lightweight lifecycle timestamp, or should the plan add dedicated `cancelled_at` and `superseded_at` fields? The current schema can likely stay additive-free if `updated_at` is sufficient.
- Should archive-trigger cancellation become explicitly visible in the list for archived rows, or is list visibility only needed for active profiles?

## Research conclusion

The live Feature 051 implementation already has the right foundation for Feature 052:

- one active pending baseline request per profile
- deterministic token hashing and public routes
- opportunistic expiry handling
- archive-driven cancellation
- list-first baseline state on `/profiles`

The real missing slice is bounded pending-request lifecycle management. The smallest coherent Feature 052 is:

- keep copy-current-link as-is
- add explicit cancel
- add explicit replace or supersede
- improve current request visibility on `/profiles`

That closes the main operational gap without drifting into reminders, extra consent kinds, or a full profile-history redesign.
