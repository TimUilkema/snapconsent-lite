# Feature 052 - Baseline Request Management - Plan

## Inputs and ground truth

Documents reviewed in required order:

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
11. `docs/rpi/052-baseline-request-management/research.md`

Targeted live verification for plan-critical boundaries:

- `supabase/migrations/20260414193000_051_baseline_recurring_consent_request_foundation.sql`
- `src/lib/profiles/profile-consent-service.ts`
- `src/lib/profiles/profile-route-handlers.ts`
- `src/lib/profiles/profile-directory-service.ts`
- `src/components/profiles/profiles-shell.tsx`
- `tests/feature-051-baseline-recurring-consent-request-foundation.test.ts`
- `tests/feature-051-baseline-recurring-consent-request-routes.test.ts`
- `src/lib/tokens/public-token.ts`
- `src/lib/url/paths.ts`
- `messages/en.json`

Use the live repo code and schema as source of truth. Features 049-052 research define the bounded product intent, but the shipped 050-051 implementation is authoritative for what exists now.

## Verified current planning boundary

- Feature 051 already shipped the recurring baseline request/sign/revoke domain as a parallel recurring-profile consent backend.
- The request table already supports `pending`, `signed`, `expired`, `cancelled`, and `superseded`, but only `pending`, `signed`, `expired`, and archive-driven `cancelled` are live operational states today.
- The only protected baseline-request mutation currently live is:
  - `POST /api/profiles/[profileId]/baseline-consent-request`
- That protected create flow is owner/admin only, requires `Idempotency-Key`, and reuses an existing active pending request instead of creating a second one.
- `/profiles` is already the operational entry point and already derives:
  - `missing`
  - `pending`
  - `signed`
  - `revoked`
- The current pending-row UI only supports:
  - copy current link
  - open current link
- Profile archive already auto-cancels pending baseline requests via DB trigger.
- Public recurring sign and revoke routes already treat non-pending request states as unavailable, so old links can become unusable without public route redesign.
- Recurring profiles remain create-plus-archive only. General profile editing is not a live boundary and should not be introduced by Feature 052.

Planning consequence:

- Feature 052 should add pending-request lifecycle operations, not redesign the recurring consent backend.
- The safest implementation shape is additive SQL functions plus route handlers and service-layer helpers, matching the existing repo pattern.
- The baseline state badge model should remain unchanged. Feature 052 should add request-outcome visibility, not invent a second top-level profile state taxonomy.

## Recommendation

Implement Feature 052 as the smallest coherent pending baseline request management slice:

- keep the existing create baseline request flow unchanged
- keep copy-current-link behavior unchanged
- add explicit owner/admin `Cancel request`
- add explicit owner/admin `Replace request`
- make replace request-scoped, concurrency-guarded, and idempotent
- improve `/profiles` request visibility enough to distinguish:
  - no request ever created
  - active pending request
  - latest request cancelled
  - latest request superseded
  - signed baseline consent

Do not add reminders, outbound delivery, profile editing, detail/history pages, or new consent kinds.

## Chosen architecture

### Lifecycle model reuse

Reuse the existing recurring baseline request table and signed-consent table:

- `recurring_profile_consent_requests`
- `recurring_profile_consents`

No new tables are required for Feature 052.

Reuse the existing request statuses:

- `pending`
- `signed`
- `expired`
- `cancelled`
- `superseded`

Feature 052 makes two existing statuses operationally reachable from protected staff actions:

- `cancelled`
- `superseded`

### Schema strategy

Do not add new request columns for this slice.

Decision:

- use existing `updated_at` as the lifecycle timestamp for cancelled and superseded visibility
- do not add `cancelled_at` or `superseded_at` in Feature 052

Reasoning:

- `updated_at` already exists on request rows
- the request row already has a touch trigger
- archive-trigger cancellation already updates `updated_at`
- the smallest list-first visibility upgrade does not justify new timestamp columns yet

Feature 052 still needs a migration, but it should be an additive SQL-function migration, not a table-shape migration.

### Mutation architecture

Use the same overall pattern as Feature 050 and Feature 051:

- thin route handlers
- service-layer helpers in `src/lib/profiles/`
- SQL-backed atomic lifecycle transitions for state changes that must be race-safe

Recommendation:

- add new security-definer SQL functions for cancel and replace
- wrap them in service helpers
- expose them through protected route handlers

Reasoning:

- current create and public sign/revoke flows already rely on SQL-backed row locking for correctness
- cancel and replace must serialize safely against:
  - public sign
  - concurrent cancel/replace
  - profile archive

### `/profiles` architecture

Keep `/profiles` as the only protected operational surface for this feature.

Do not add:

- `/profiles/[profileId]`
- history timeline page
- modal-heavy request management UI

Instead:

- keep the existing inline per-row panel pattern
- extend the pending-link panel into a small request-management panel
- add lightweight request-outcome visibility in the row itself

## Exact scope boundary

### Becomes real in Feature 052

- explicit protected cancel action for a specific pending baseline request
- explicit protected replace action for a specific pending baseline request
- atomic `pending -> superseded + new pending request` behavior
- request-id-targeted lifecycle enforcement
- improved row visibility for latest request outcome on `/profiles`
- pending panel visibility for active request email snapshot
- i18n-backed action labels, panel labels, and request-outcome copy

### Remains unchanged from Feature 051

- baseline request creation route and behavior
- copy-link semantics
- public recurring sign flow
- public recurring revoke flow
- signed recurring-consent immutability
- archive-trigger automatic cancellation of pending requests
- baseline state badge model:
  - `missing`
  - `pending`
  - `signed`
  - `revoked`

### Explicitly deferred

- reminders and reminder scheduling
- outbound reminder delivery
- initial outbound baseline-request email sending
- specific or extra consent requests
- full request history or detail page
- profile editing
- baseline template defaulting
- import and sync
- headshots and matching
- generic recurring-consent backend redesign

### Lifecycle states that become operationally visible now

Feature 052 should make these request outcomes visible on `/profiles`:

- active `pending`
- latest `cancelled`
- latest `superseded`
- latest `expired`

It should not add a separate request-history UI. Visibility stays lightweight and row-scoped.

## Exact request lifecycle and state-transition plan

## Copy active link

Product meaning:

- same request
- same token
- no lifecycle change

Technical behavior:

- no mutation route
- reuse the existing deterministic token derivation from request id
- keep the existing pending-link panel and copy/open behavior

## Cancel pending request

Target:

- a specific request id under a specific profile id

Transition:

- `pending -> cancelled`

Rules:

- only the current active pending request may be cancelled
- the targeted request id must still match the active pending request for that profile
- cancelling does not create a new request
- cancelling must make the old public link unusable immediately

Idempotency:

- cancel should be naturally idempotent
- repeated cancel against an already cancelled targeted request should return `200` with the existing cancelled request summary
- cancel should not require `Idempotency-Key`

Behavior by current targeted request status:

- `pending`
  - update to `cancelled`
  - return success
- `cancelled`
  - return success idempotently
- `signed`
  - return `409`
- `superseded`
  - return `409`
- `expired`
  - return `409`
- request missing or not in the profile or tenant
  - return `404`

Recommended conflict code:

- `baseline_consent_request_not_pending`

Reasoning:

- duplicate cancel should be safe
- stale UI should not silently succeed against a request that is no longer the active pending request for operational reasons other than a prior cancel

## Replace pending request

Target:

- a specific request id under a specific profile id

Transition:

- old request: `pending -> superseded`
- new request: insert one new `pending` request row
- write `superseded_by_request_id` on the old row

Rules:

- replace requires that the targeted request id still matches the current active pending request
- replace must be atomic:
  - old link stops working
  - new pending request exists
  - both happen in one transaction
- replace must reuse the current request's template automatically in this bounded slice
- replace should create the new request snapshot from the current profile row, not by cloning the old request snapshot

Reasoning for automatic template reuse:

- current user intent is token rotation, not request redesign
- reopening template selection would expand the feature beyond bounded request management
- the profile is already in a pending baseline workflow, so replacing the token should preserve the current template choice by default

Idempotency:

- replace should require `Idempotency-Key`
- a retry after lost response must return the same replacement payload
- use the existing `idempotency_keys` table pattern already used for create flows

Behavior by current targeted request status:

- `pending`
  - supersede old request
  - create new pending request
  - return new request payload
- `superseded`
  - return `409` unless the same replace request is being replayed through idempotency
- `cancelled`
  - return `409`
- `signed`
  - return `409`
- `expired`
  - return `409`
- request missing or not in the profile or tenant
  - return `404`

Additional guard:

- if an active signed baseline exists when replace runs, return the existing `baseline_consent_already_signed` conflict

## Race-handling model

Cancel and replace should use SQL row locking on:

- the targeted request row
- the profile row

This allows safe serialization against:

- public sign of the same pending request
- concurrent cancel and replace
- profile archive

Recommended locking behavior:

1. load and lock the profile row and targeted request row in the same transaction
2. opportunistically expire the targeted request if its expiry has passed
3. verify that the targeted request is still the current active pending request
4. apply cancel or replace transition

This preserves server-authoritative lifecycle transitions and avoids stale-UI mistakes.

## Exact protected route plan

## Route shape decision

Recommendation:

- keep the existing create route unchanged:
  - `POST /api/profiles/[profileId]/baseline-consent-request`
- add request-scoped lifecycle routes under the same namespace:
  - `POST /api/profiles/[profileId]/baseline-consent-request/[requestId]/cancel`
  - `POST /api/profiles/[profileId]/baseline-consent-request/[requestId]/replace`

This is a hybrid overall surface:

- create stays at the existing profile-scoped route for backward compatibility
- lifecycle mutations are request-scoped so the client must target a specific request id

Reasoning:

- request-scoped targeting is the most important correctness decision in Feature 052
- it prevents stale `/profiles` UIs from silently acting on a newer request
- it avoids renaming the existing create route just for stylistic consistency

## `POST /api/profiles/[profileId]/baseline-consent-request/[requestId]/cancel`

Auth:

- authenticated tenant member required
- owner/admin only
- photographer gets `403`

Request body:

- no body

Headers:

- no `Idempotency-Key` required

Success:

- `200`

Recommended payload:

```json
{
  "request": {
    "id": "uuid",
    "profileId": "uuid",
    "status": "cancelled",
    "updatedAt": "iso-timestamp"
  }
}
```

Failure shaping:

- `401` unauthenticated
- `403` unauthorized role or no tenant
- `404` profile or request not found in-tenant
- `409` targeted request is not cancellable because it is no longer the active pending request
- `500` unexpected failure

Recommended route/service error codes:

- `baseline_consent_request_not_found`
- `baseline_consent_request_not_pending`

## `POST /api/profiles/[profileId]/baseline-consent-request/[requestId]/replace`

Auth:

- authenticated tenant member required
- owner/admin only
- photographer gets `403`

Request body:

- no body in the bounded slice

Headers:

- `Idempotency-Key` required

Success:

- `201` on fresh replacement
- `200` on idempotent replay

Recommended payload:

```json
{
  "request": {
    "id": "new-request-uuid",
    "profileId": "uuid",
    "consentTemplateId": "uuid",
    "status": "pending",
    "expiresAt": "iso-timestamp",
    "consentPath": "/rp/...",
    "emailSnapshot": "person@example.com"
  },
  "replacedRequest": {
    "id": "old-request-uuid",
    "status": "superseded",
    "supersededByRequestId": "new-request-uuid",
    "updatedAt": "iso-timestamp"
  }
}
```

Failure shaping:

- `401` unauthenticated
- `403` unauthorized role or no tenant
- `400` missing or invalid `Idempotency-Key`
- `404` profile or request not found in-tenant
- `409` targeted request is no longer the active pending request
- `409` active signed baseline already exists
- `409` profile is archived
- `500` unexpected failure

Recommended route/service error codes:

- `baseline_consent_request_not_found`
- `baseline_consent_request_not_pending`
- `baseline_consent_already_signed`
- `recurring_profile_archived`

## SQL function plan

Add one new migration that introduces security-definer lifecycle functions and their public wrappers:

- `app.cancel_recurring_profile_baseline_request(...)`
- `public.cancel_recurring_profile_baseline_request(...)`
- `app.replace_recurring_profile_baseline_request(...)`
- `public.replace_recurring_profile_baseline_request(...)`

Recommended function responsibilities:

- resolve and lock the profile row and targeted request row
- verify owner/admin management rights from `auth.uid()`
- verify profile/request tenant alignment
- opportunistically expire stale pending requests where needed
- perform atomic lifecycle transitions
- return compact lifecycle result rows for the service layer

Do not move cancel or replace into TypeScript-only multi-step writes.

## Service-layer plan

Add service helpers in `src/lib/profiles/profile-consent-service.ts`:

- `cancelBaselineConsentRequest(...)`
- `replaceBaselineConsentRequest(...)`

Reuse from current create flow:

- `assertProfilesManager(...)`
- UUID validation
- idempotency read/write helpers for replace
- recurring token derivation and path building
- `HttpError` shaping

Recommended replace idempotency operation key:

- `replace_baseline_recurring_profile_consent_request:${requestId}`

## Exact `/profiles` page evolution

## Row action model

For active profiles:

- `missing`
  - `Request baseline consent`
- `revoked`
  - `Request baseline consent`
- `pending`
  - `Copy baseline link`
  - `Cancel request`
  - `Replace request`
- `signed`
  - no baseline-request action

For archived profiles:

- no baseline-request actions

## Pending panel evolution

Keep the existing inline expandable panel, but split it into two bounded cases.

### Request-create panel

Shown for:

- `missing`
- `revoked`

Behavior:

- unchanged from Feature 051

### Pending request-management panel

Shown for:

- `pending`

Contents:

- current active link input
- `Copy link`
- `Open link`
- active request expiry
- active request email snapshot
- `Cancel request`
- `Replace request`
- localized inline error states

Reasoning:

- wrong-recipient handling is operationally email-oriented
- showing the request email snapshot helps admins verify they are handling the correct pending request
- this adds operational clarity without adding a history page

## Row-level visibility decision

Keep the four existing baseline state badges:

- `missing`
- `pending`
- `signed`
- `revoked`

Do not add `cancelled` or `superseded` as primary baseline badge states.

Instead, expand the secondary text logic:

- `pending`
  - `Pending until {date}`
- `signed`
  - `Signed {date}`
- `revoked`
  - `Revoked {date}`
- `missing`
  - if the latest request outcome is `cancelled`, show `Latest request cancelled {date}`
  - if the latest request outcome is `superseded`, show `Latest request replaced {date}`
  - if the latest request outcome is `expired`, show `Latest request expired {date}`
  - otherwise show `No baseline consent request yet.`

This is the minimum visibility addition that satisfies the operational goal:

- no request ever created versus cancelled or superseded is distinguishable
- the list stays list-first
- no history UI is required

## Data model changes for page reads

Expand the `baselineConsent` view model in `profile-directory-service.ts` to include lightweight request metadata.

Recommended additions:

- `pendingRequest.emailSnapshot`
- `pendingRequest.updatedAt`
- `latestRequestOutcome`
  - `status`
  - `changedAt`

Request query changes:

- include `profile_email_snapshot`
- include `updated_at`
- include `superseded_by_request_id`

Derivation rule:

- keep baseline badge state derived exactly as in Feature 051
- layer latest request outcome on top only for list visibility

## Visibility decisions resolved explicitly

### Minimum request visibility

Decision:

- active pending request visibility plus one lightweight latest terminal request outcome

### Active request expiry

Decision:

- show it in both:
  - the row secondary line for `pending`
  - the pending management panel

### Active request email snapshot

Decision:

- show it in the pending management panel
- do not add a dedicated list column

### Latest non-pending outcome for rows back to `missing`

Decision:

- yes
- show only one latest request outcome line
- do not add multi-event history

### Archive-triggered cancellation visibility

Decision:

- use the same latest request outcome line when archived rows are visible
- do not add archive-specific request history UI

## Exact reuse boundary

### Reuse unchanged

- existing request table and signed-consent table
- deterministic request token derivation from request id
- public sign and revoke routes
- public invalid/unavailable handling for non-pending request states
- recurring profile access model
- route handler plus service-layer pattern
- `HttpError` and `jsonError`
- i18n framework and existing `profiles` namespace

### Reuse with additive changes

- `profile-consent-service.ts`
  add cancel and replace helpers
- `profile-route-handlers.ts`
  add cancel and replace route-handler helpers
- `profile-directory-service.ts`
  expand request selection and baseline view model
- `profiles-shell.tsx`
  extend pending panel and secondary visibility text

### New only in Feature 052

- cancel SQL function and public wrapper
- replace SQL function and public wrapper
- request-scoped protected lifecycle routes
- i18n keys for cancel, replace, and latest request outcome copy

## Security and reliability considerations

- tenant must remain server-derived only
- no client-provided tenant ids
- all lifecycle transitions remain server-side
- signed recurring consents remain immutable
- revoke flow remains separate from request lifecycle management
- cancel must be naturally idempotent
- replace must require `Idempotency-Key`
- old tokens must become unusable immediately after cancel or replace
- stale UIs must not silently act on a newer pending request
- request-id targeting is mandatory for correctness
- all mutations must be owner/admin only
- use SQL row locking for request/profile lifecycle transitions
- use parameterized query-builder or RPC APIs only

### Sign versus cancel

Recommended outcome:

- whichever transaction acquires the targeted request lock first wins
- if sign wins first, cancel sees `signed` and returns `409`
- if cancel wins first, sign sees unavailable request state and fails safely

### Sign versus replace

Recommended outcome:

- whichever transaction acquires the targeted request lock first wins
- if sign wins first, replace returns `409`
- if replace wins first, old token becomes `superseded` and public sign on that old link fails safely

### Archive versus replace

Recommended outcome:

- lock the profile row during replace
- if archive wins first, replace returns `recurring_profile_archived`
- if replace wins first, archive can still proceed and the existing archive trigger will cancel the new pending request

## Edge cases

- duplicate cancel requests should return the same cancelled request result
- duplicate replace requests after lost response should replay from idempotency
- concurrent cancel and replace on the same request should serialize by request lock
- concurrent sign and cancel should serialize by request lock
- concurrent sign and replace should serialize by request lock
- concurrent archive and replace should serialize by profile and request locks
- stale `/profiles` row using an old request id should receive `409`, not silently affect a newer request
- stale expired requests not yet rewritten in DB should be opportunistically expired before lifecycle decisions
- active signed baseline appearing while replace retry is in flight should return `baseline_consent_already_signed`
- archived profile with auto-cancelled pending request should remain safely uncopiable and unreplaceable
- future email-edit support should not mutate old request snapshots; replace should be the path that creates a new snapshot

## Test plan

Minimum real test surface for Feature 052:

### SQL and service behavior

- cancel transitions `pending -> cancelled`
- cancel idempotently returns an already cancelled request
- replace transitions:
  - old request `pending -> superseded`
  - new request inserted as `pending`
  - `superseded_by_request_id` written
- replace reuses the same template automatically
- replace generates a new request id and therefore a new token/path
- replace idempotency replay returns the same replacement payload
- cancel and replace reject stale or terminal targeted request ids with `409`

### Public token invalidation

- old token after cancel returns unavailable on public lookup or submit
- old token after replace returns unavailable on public lookup or submit
- new token after replace remains signable

### Access and route shaping

- unauthenticated cancel and replace requests return `401`
- photographer cancel and replace requests return `403`
- invalid request id or mismatched profile/request pair returns `404`
- missing `Idempotency-Key` on replace returns `400`

### `/profiles` rendering

- pending rows show copy, cancel, and replace actions
- pending panel shows active request email snapshot and expiry
- missing rows with no prior request still show the original `No baseline consent request yet.`
- missing rows with cancelled, superseded, or expired latest request show the correct secondary outcome line
- signed and revoked rows keep their existing primary visibility

### Concurrency coverage where practical

- replace after sign returns conflict
- cancel after sign returns conflict
- replace followed by archive leaves the new pending request cancelled by archive

If true concurrent integration tests are cumbersome in the current harness, at minimum add serialized conflict tests that prove the post-lock outcomes are correct.

## Implementation phases

1. SQL lifecycle foundation
   - add cancel and replace security-definer functions plus public wrappers
   - keep table shape unchanged
   - document exact conflict and idempotency semantics in the migration comments if helpful

2. Service layer and protected routes
   - add cancel and replace service helpers in `profile-consent-service.ts`
   - add cancel and replace route-handler helpers in `profile-route-handlers.ts`
   - add new request-scoped route files under `/api/profiles/[profileId]/baseline-consent-request/[requestId]/`

3. `/profiles` data and UI evolution
   - expand page-data derivation for latest request outcome and pending request metadata
   - extend the pending panel with cancel and replace actions
   - update row secondary text and i18n-backed visibility copy

4. Tests and polish
   - add SQL or integration lifecycle coverage
   - add route tests for new handlers
   - add `/profiles` rendering coverage
   - add English and Dutch message keys for new UI and errors

## Explicitly deferred follow-up cycles

- reminder sending and reminder scheduling
- initial outbound request email delivery
- full request history UI
- profile detail page
- general profile editing
- extra or specific consent request kinds
- baseline template defaults
- import and sync
- headshots, matching, or CompreFace integration
- recurring consent backend unification

## Concise implementation prompt

Implement Feature 052 as a bounded pending baseline request management slice on top of the live Feature 051 recurring-profile consent domain. Keep the existing baseline request creation route unchanged, but add request-scoped protected lifecycle routes for cancel and replace at `/api/profiles/[profileId]/baseline-consent-request/[requestId]/cancel` and `/api/profiles/[profileId]/baseline-consent-request/[requestId]/replace`. Make cancel naturally idempotent and make replace require `Idempotency-Key`, atomically supersede the targeted pending request, write `superseded_by_request_id`, and create a new pending request with a new token while reusing the same template automatically. Implement the lifecycle transitions in SQL-backed atomic functions, wrap them with service-layer helpers and thin route handlers, and keep signed recurring consents immutable and public revoke separate. Evolve `/profiles` in a list-first way by extending the existing pending panel with cancel and replace controls, showing active request email snapshot and expiry, and adding lightweight latest-request outcome visibility so rows can distinguish no request yet from cancelled, superseded, or expired requests without adding a detail or history page. Reuse the existing token/path helpers, owner/admin access model, i18n framework, and public sign/revoke flows.
