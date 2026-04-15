# Feature 054 Research: Baseline Follow-up Actions with Placeholder Delivery

## Scope

Research the next bounded recurring-profiles operational slice after Features 051-053:

- manual follow-up actions for baseline recurring consent requests
- state-aware reuse of the current valid link versus creation of a new request
- placeholder-only delivery behavior for this cycle
- a backend delivery seam that can later be replaced by real SMTP or another provider
- honest UI feedback and bounded follow-up attempt visibility

This is not real outbound email sending, not scheduling, not batch operations, and not a generic communications platform.

## Inputs reviewed

### Required repo docs

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `docs/rpi/README.md`

### Prior recurring-profile RPI docs

5. `docs/rpi/049-recurring-profiles-and-consent-management-foundations/research.md`
6. `docs/rpi/049-recurring-profiles-and-consent-management-foundations/plan.md`
7. `docs/rpi/050-recurring-profile-directory-foundation/research.md`
8. `docs/rpi/050-recurring-profile-directory-foundation/plan.md`
9. `docs/rpi/051-baseline-recurring-consent-request-foundation/research.md`
10. `docs/rpi/051-baseline-recurring-consent-request-foundation/plan.md`
11. `docs/rpi/052-baseline-request-management/research.md`
12. `docs/rpi/052-baseline-request-management/plan.md`
13. `docs/rpi/053-recurring-consent-history-and-profile-detail/research.md`
14. `docs/rpi/053-recurring-consent-history-and-profile-detail/plan.md`
15. `docs/rpi/053-recurring-consent-history-and-inline-profile-detail/plan.md`
    - this is a live alias file that points to the actual 053 plan path above

### Live schema and migrations verified

- `supabase/migrations/20260414170000_050_recurring_profile_directory_foundation.sql`
- `supabase/migrations/20260414193000_051_baseline_recurring_consent_request_foundation.sql`
- `supabase/migrations/20260414210000_052_baseline_request_management.sql`
- `supabase/migrations/20260414211500_052_baseline_request_management_fix.sql`
- `supabase/migrations/20260414213000_052_baseline_request_management_replace_fix.sql`

### Live recurring-profile routes, services, and UI verified

- `src/app/(protected)/profiles/page.tsx`
- `src/components/profiles/profiles-shell.tsx`
- `src/lib/profiles/profile-access.ts`
- `src/lib/profiles/profile-directory-service.ts`
- `src/lib/profiles/profile-consent-service.ts`
- `src/lib/profiles/profile-route-handlers.ts`
- `src/app/api/profiles/route.ts`
- `src/app/api/profiles/[profileId]/archive/route.ts`
- `src/app/api/profiles/[profileId]/detail/route.ts`
- `src/app/api/profiles/[profileId]/baseline-consent-request/route.ts`
- `src/app/api/profiles/[profileId]/baseline-consent-request/[requestId]/cancel/route.ts`
- `src/app/api/profiles/[profileId]/baseline-consent-request/[requestId]/replace/route.ts`

### Live public recurring sign and revoke code verified

- `src/app/rp/[token]/page.tsx`
- `src/app/rp/[token]/consent/route.ts`
- `src/app/rr/[token]/page.tsx`
- `src/app/rr/[token]/revoke/route.ts`
- `src/lib/recurring-consent/public-recurring-consent.ts`
- `src/lib/recurring-consent/revoke-recurring-profile-consent.ts`

### Live helper and convention files verified

- `src/lib/tokens/public-token.ts`
- `src/lib/url/paths.ts`
- `src/lib/http/errors.ts`
- `src/lib/tenant/resolve-tenant.ts`
- `src/lib/idempotency/invite-idempotency.ts`
- `src/app/api/projects/[projectId]/invites/route.ts`
- `src/components/projects/invite-actions.tsx`
- `src/lib/email/send-receipt.ts`
- `messages/en.json`
- `messages/nl.json`

### Relevant tests verified

- `tests/feature-051-baseline-recurring-consent-request-foundation.test.ts`
- `tests/feature-051-baseline-recurring-consent-request-routes.test.ts`
- `tests/feature-052-baseline-request-management.test.ts`
- `tests/feature-052-baseline-request-management-routes.test.ts`
- `tests/feature-053-recurring-profile-detail.test.ts`
- `tests/feature-053-recurring-profile-detail-ui.test.ts`

## Verified live baseline/request/follow-up boundary after Feature 053

## 1. Live baseline states shown on `/profiles`

The protected recurring-profile UI derives exactly four baseline states in `deriveBaselineConsentSummary(...)` inside `src/lib/profiles/profile-directory-service.ts`:

- `missing`
- `pending`
- `signed`
- `revoked`

Current derivation order is:

1. active non-revoked baseline consent row -> `signed`
2. active non-expired pending baseline request row -> `pending`
3. latest revoked baseline consent row with no active signed or pending -> `revoked`
4. otherwise -> `missing`

Important live detail:

- `missing` is not just "no history".
- `missing` may still carry `latestRequestOutcome` when the latest terminal request outcome is:
  - `cancelled`
  - `superseded`
  - `expired`

That means the list and inline detail already distinguish "never requested" from "requested but no longer valid", even though both still map to baseline state `missing`.

## 2. Live request states and what is actually operational

The request table is `public.recurring_profile_consent_requests`.

The live schema allows these request statuses:

- `pending`
- `signed`
- `expired`
- `superseded`
- `cancelled`

All five are live and operational after Features 051-053:

- `pending`
  - created by `create_recurring_profile_baseline_request`
- `signed`
  - written by `submit_public_recurring_profile_consent`
- `expired`
  - written opportunistically on create, public GET, public POST, cancel, and replace when a stale pending row is touched
- `cancelled`
  - written by explicit cancel and by the archive trigger on profile archive
- `superseded`
  - written by explicit replace

Operational transitions now in live code:

- `pending -> signed`
- `pending -> expired`
- `pending -> cancelled`
- `pending -> superseded`

Terminal requests are not revived anywhere in live code.

## 3. Live baseline-request management behavior

Current protected baseline request flows are:

- create
  - `POST /api/profiles/[profileId]/baseline-consent-request`
- cancel
  - `POST /api/profiles/[profileId]/baseline-consent-request/[requestId]/cancel`
- replace
  - `POST /api/profiles/[profileId]/baseline-consent-request/[requestId]/replace`

Key live behavior from `src/lib/profiles/profile-consent-service.ts` and the SQL functions:

- baseline request creation requires `Idempotency-Key`
- create reuses an existing active pending request instead of creating a second one
- replace requires `Idempotency-Key`
- replace supersedes the targeted pending request and creates a new pending request with a new request id and token
- cancel is naturally idempotent
- archive auto-cancels pending requests through a trigger

Current expiry rule:

- requests are created and replaced with a 7 day expiry window via `getRecurringRequestExpiryIso()`
- copy or reminder-like behavior does not currently extend expiry

## 4. Live public behavior for request status

Public recurring consent GET and POST treat request status strictly:

- `pending` and not expired -> signable
- `signed` -> signed state shown, duplicate submit returns the existing consent row
- `expired` -> unavailable
- `cancelled` -> unavailable
- `superseded` -> unavailable

`src/app/rp/[token]/page.tsx` explicitly maps:

- `signed` -> signed message
- `expired` -> expired message
- `cancelled` or `superseded` -> unavailable message

That confirms the current lifecycle semantics are:

- signed/cancelled/superseded/expired links stay terminal
- there is no revive or reopen path

## 5. Live UI placement after Feature 053

After Feature 053 the main recurring-profile operational surface is still `/profiles`, but nuanced baseline actions now live in the inline detail panel.

Live behavior in `src/components/profiles/profiles-shell.tsx`:

- collapsed row:
  - summary-only
  - baseline badge
  - latest activity line
  - `View details`
  - archive profile action
- expanded inline detail panel:
  - current baseline summary
  - request history
  - baseline consent history
  - `Request baseline consent`
  - `Copy baseline link`
  - `Open link`
  - `Cancel request`
  - `Replace request`

Current follow-up gap:

- `Send reminder` still exists only as a disabled deferred action in the bottom deferred-work section
- there is no live request-delivery action at all

## 6. Live delivery-related helpers

There is currently no request-delivery service for recurring baseline requests.

What exists:

- request create returns a shareable path only
- UI exposes copy/open for the active link
- sign success sends a recurring receipt email through `sendRecurringConsentReceiptEmail(...)`

`src/lib/email/send-receipt.ts` is current live email infrastructure, but it only sends receipts after signing. It does not send or prepare baseline requests or reminders.

Important implication:

- request delivery is still entirely absent as a domain concept
- Feature 054 is the first cycle that needs a request-delivery abstraction
- receipt sending should not be treated as the same lifecycle as follow-up delivery

## 7. Live token, path, and error conventions

Current relevant helpers:

- request token derivation
  - `deriveRecurringProfileConsentToken({ requestId })`
- revoke token derivation
  - `deriveRecurringProfileRevokeToken({ consentId })`
- request path
  - `buildRecurringProfileConsentPath(token)` -> `/rp/[token]`
- revoke path
  - `buildRecurringProfileRevokePath(token)` -> `/rr/[token]`

Current protected route conventions:

- thin route handlers
- auth first
- tenant resolved server-side
- `HttpError` plus `jsonError(...)`
- idempotent writes persisted in `idempotency_keys`

Feature 054 should stay inside those exact conventions.

## Exact live state mapping relevant to follow-up

| Live condition | How it appears now | Correct next action for 054 |
| --- | --- | --- |
| Active signed baseline consent | baseline state `signed` | No follow-up action |
| Active pending baseline request | baseline state `pending` with `pendingRequest` | `Send reminder` using the current request |
| `missing` with no request history | baseline state `missing`, no `latestRequestOutcome` | `Send new request` |
| `missing` with latest request `expired` | baseline state `missing`, `latestRequestOutcome.status = 'expired'` | `Send new request` |
| `missing` with latest request `cancelled` | baseline state `missing`, `latestRequestOutcome.status = 'cancelled'` | `Send new request` |
| `missing` with latest request `superseded` and no active pending request | baseline state `missing`, `latestRequestOutcome.status = 'superseded'` | `Send new request` |
| `revoked` with no active pending request | baseline state `revoked` | `Send new request` |
| Active pending request exists even if older requests are superseded/cancelled/expired | baseline state `pending` | `Send reminder` against the current active pending request |
| Archived profile | profile status `archived` | No follow-up action |

Recommended explicit rule:

- `superseded` is not itself a follow-up target.
- If there is a newer active pending request, follow-up targets that newer request.
- If there is no active pending request, create a new request instead of trying to reason from the superseded row.

## Should expired links ever be revived

Recommended answer: no.

This matches live code and current semantics:

- expired requests are opportunistically written to `expired`
- cancelled requests remain terminal
- superseded requests remain terminal
- public routes treat all of those as unavailable

Feature 054 should preserve that model.

When there is no valid active pending request:

- create a new request row
- generate a new request token
- leave old requests unchanged

Do not:

- change `expired -> pending`
- change `cancelled -> pending`
- change `superseded -> pending`
- extend the `expires_at` of an old request as a side effect of reminder

`Send reminder` should be a delivery action only. It should not mutate request lifecycle or expiry.

## Options considered

## 1. Feature-scope options

### Option A - manual reminder for active pending requests only

Pros:

- smallest UI change
- no request creation logic needed

Cons:

- operationally weak
- does not solve the main admin problem once the latest link is expired, cancelled, or otherwise unavailable
- still forces admins to understand request-state internals

Recommendation:

- reject

### Option B - state-aware follow-up actions

Behavior:

- active valid pending request -> `Send reminder`
- no valid active request -> `Send new request`

Pros:

- aligns with admin intent: get the person a valid current link
- fits the existing recurring request lifecycle cleanly
- remains bounded

Cons:

- slightly broader than reminder-only
- needs a small request-decision layer and a delivery seam

Recommendation:

- recommend

### Option C - full follow-up system

Behavior examples:

- real email sending
- scheduling
- batch follow-up
- analytics

Pros:

- powerful long-term direction

Cons:

- far beyond the current bounded operational gap
- drifts into communications infrastructure work

Recommendation:

- reject for Feature 054

## 2. Delivery architecture options

### Option A - placeholder no-op service with no persistence

Pros:

- smallest code surface

Cons:

- no trace that a follow-up was attempted
- weak seam for later SMTP replacement
- weak user feedback after retries or partial failures

Recommendation:

- reject

### Option B - request-row follow-up fields

Examples:

- `last_follow_up_attempted_at`
- `follow_up_attempt_count`
- `last_follow_up_kind`

Pros:

- smaller than a new table

Cons:

- not a real attempt model
- poor fit for multiple reminders on one request
- poor fit for separating reminder attempts from new-request creation attempts
- mixes request lifecycle with delivery lifecycle

Recommendation:

- reject

### Option C - dedicated delivery-attempt persistence

Pros:

- keeps delivery lifecycle separate from request lifecycle
- supports multiple attempts per request
- supports honest UI status now
- gives a clean future seam for SMTP or another provider

Cons:

- adds one bounded table and read model

Recommendation:

- recommend

## Recommended bounded feature scope

Feature 054 should implement the smallest coherent state-aware follow-up slice:

- add one manual follow-up action path for baseline recurring consent
- choose the correct next action server-side:
  - reuse the current active pending request and treat it as a reminder
  - otherwise create a new request and treat it as a new request
- do not send real email
- run a placeholder-only delivery dispatch path
- persist a bounded delivery-attempt record
- show honest result messaging and latest attempt status in the inline detail panel on `/profiles`

This should not include:

- SMTP sending
- provider config
- scheduling
- batch actions
- a generic delivery platform
- request-history redesign beyond what Feature 053 already shipped

## Recommended state-to-action mapping

### `pending`

Recommended action:

- `Send reminder`

Behavior:

- use the active pending request unchanged
- do not replace it
- do not change `expires_at`
- do not create a new request
- record a placeholder delivery attempt tied to that request

### `missing`

Recommended action:

- `Send new request`

Behavior:

- create a new baseline request
- use the new request as the delivery target
- record a placeholder delivery attempt tied to that new request

If the user sees `missing` from stale data but another admin created a pending request moments earlier:

- the follow-up backend should reuse that active pending request instead of failing
- return that the effective action was a reminder against the current valid request

### `revoked` with no active pending request

Recommended action:

- `Send new request`

Behavior:

- create a new baseline request
- keep the revoked signed row untouched
- record placeholder delivery against the new pending request

### latest request `expired`

Recommended action:

- `Send new request`

Behavior:

- do not revive the expired row
- create a new request row
- record placeholder delivery against the new request

### latest request `cancelled`

Recommended action:

- `Send new request`

Behavior:

- do not uncancel the old row
- create a new request row
- record placeholder delivery against the new request

### latest request `superseded`

Recommended action:

- if there is an active pending request now -> `Send reminder`
- otherwise -> `Send new request`

Behavior:

- never act on the superseded row itself

### `signed`

Recommended action:

- none

Behavior:

- follow-up actions should not be shown
- if the user somehow posts a follow-up mutation after the profile becomes signed, return the existing `baseline_consent_already_signed` conflict

## Recommended route and service shape

## UI label versus backend command

Recommended split:

- UI labels stay state-specific and clear:
  - `Send reminder`
  - `Send new request`
- backend uses one server-authoritative follow-up command

Why:

- the user needs clear wording
- the backend needs to handle stale state safely

Recommended route:

- `POST /api/profiles/[profileId]/baseline-follow-up`

Recommended request shape:

- header:
  - `Idempotency-Key` required
- body:
  - `consentTemplateId?: string | null`
  - optional only when a new request may need template selection

Recommended response shape:

```json
{
  "followUp": {
    "action": "reminder",
    "request": {
      "id": "uuid",
      "status": "pending",
      "expiresAt": "2026-04-21T12:00:00.000Z",
      "consentPath": "/rp/..."
    },
    "requestReused": true,
    "requestCreated": false,
    "delivery": {
      "mode": "placeholder",
      "channel": "email",
      "status": "recorded",
      "sent": false,
      "attemptedAt": "2026-04-14T12:00:00.000Z"
    }
  }
}
```

or

```json
{
  "followUp": {
    "action": "new_request",
    "request": {
      "id": "uuid",
      "status": "pending",
      "expiresAt": "2026-04-21T12:00:00.000Z",
      "consentPath": "/rp/..."
    },
    "requestReused": false,
    "requestCreated": true,
    "delivery": {
      "mode": "placeholder",
      "channel": "email",
      "status": "recorded",
      "sent": false,
      "attemptedAt": "2026-04-14T12:00:00.000Z"
    }
  }
}
```

## Recommended internal flow

1. authenticate
2. resolve tenant server-side
3. lock and resolve the current baseline follow-up target server-side
4. if active signed baseline exists -> return conflict
5. if active pending request exists -> use it as reminder target
6. otherwise create a new baseline request using existing lifecycle logic
7. dispatch placeholder delivery
8. persist delivery attempt result
9. return request metadata plus honest placeholder status

## Recommended request-creation reuse

Re-use current request creation semantics where possible:

- keep `create_recurring_profile_baseline_request(...)` behavior as the canonical "create or reuse active pending" function
- do not use replace or supersede for ordinary follow-up
- only explicit replace should rotate a valid pending link

Important operational rule:

- Feature 054 follow-up should never silently invalidate an active valid link
- if there is already an active pending request, the follow-up action is reminder, not replacement

## Recommended template-selection rule

Current live code still requires explicit template selection when creating a baseline request. There is no default baseline template rule.

Recommended 054 behavior:

- if follow-up resolves to reminder:
  - no template selection
- if follow-up resolves to new request:
  - reuse the existing baseline request creation rule
  - allow template selection when needed

Plan-phase recommendation:

- keep template selection explicit for `Send new request`
- reuse the existing baseline template picker in the inline detail panel
- do not invent default-template management in Feature 054

If the plan wants to reduce clicks later, it can consider auto-selecting the last baseline template, but that is not required for the smallest coherent slice.

## Recommended placeholder delivery architecture

## 1. Add a dedicated delivery-attempt table

Recommended table shape:

- `public.recurring_profile_consent_request_delivery_attempts`

Recommended bounded columns:

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null references public.tenants(id) on delete cascade`
- `profile_id uuid not null`
- `request_id uuid not null`
- `action_kind text not null check (action_kind in ('reminder','new_request'))`
- `delivery_channel text not null check (delivery_channel in ('email'))`
- `delivery_mode text not null check (delivery_mode in ('placeholder'))`
- `status text not null check (status in ('recorded','failed'))`
- `recipient_email_snapshot text not null`
- `error_code text null`
- `error_message text null`
- `created_by uuid not null references auth.users(id) on delete restrict`
- `attempted_at timestamptz not null default now()`

Recommended keys and indexes:

- composite foreign key `(profile_id, tenant_id)` -> `recurring_profiles(id, tenant_id)`
- composite foreign key `(request_id, tenant_id)` -> `recurring_profile_consent_requests(id, tenant_id)`
- index on `(tenant_id, profile_id, attempted_at desc)`
- index on `(tenant_id, request_id, attempted_at desc)`

Why this is the right bounded model:

- it does not mutate request lifecycle
- it supports multiple reminders for one request
- it supports later real delivery backends without redesigning request tables
- it gives the UI something truthful to show now

## 2. Add a small delivery dispatch abstraction

Recommended new service boundary, for example:

- `src/lib/profiles/profile-follow-up-service.ts`
- or a smaller dedicated helper under `src/lib/email/` or `src/lib/delivery/`

Recommended internal interface shape:

- `dispatchRecurringBaselineFollowUp(...)`

Current implementation:

- `delivery_mode = 'placeholder'`
- no SMTP send
- persist attempt row
- return status `recorded`

Future implementation:

- same interface can call SMTP/provider code
- can update attempt status and add provider metadata later

## 3. Keep request lifecycle and delivery lifecycle separate

Recommended sequencing:

1. decide and prepare the correct request target first
2. commit request lifecycle change first
3. run placeholder delivery dispatch second
4. persist delivery-attempt result separately from request status

Why:

- request creation or reuse must remain correct even if delivery bookkeeping fails
- follow-up failure must not corrupt request lifecycle
- the admin still needs the valid link even if placeholder recording fails

## Recommended lifecycle and delivery model

## Reminder path

When an active pending request exists:

- no request lifecycle change
- no expiry extension
- no new request
- create one delivery-attempt row with:
  - `action_kind = 'reminder'`
  - `delivery_mode = 'placeholder'`
  - `status = 'recorded'` or `failed`

## New-request path

When there is no valid active pending request:

- create a new baseline request through the existing baseline request lifecycle
- then create one delivery-attempt row with:
  - `action_kind = 'new_request'`
  - `delivery_mode = 'placeholder'`
  - `status = 'recorded'` or `failed`

Do not:

- overwrite or revive old requests
- write delivery state onto the old expired/cancelled/superseded row as if it were still active

## Retry and idempotency model

Recommended:

- require `Idempotency-Key` on the new follow-up route
- store the result in existing `idempotency_keys`

Why:

- the route may create a new request
- the route may create a delivery-attempt row
- retries after lost response must not create multiple new requests or duplicate attempts

Recommended operation key:

- `baseline_follow_up:${profileId}`

The plan phase can refine the operation key if it wants to include more context, but it should stay profile-scoped and consistent with current conventions.

## Recommended UI placement and visibility

Recommended placement:

- expanded inline detail panel on `/profiles` only

Reasoning:

- Feature 053 already made the inline detail panel the one-profile inspection surface
- it already shows current baseline summary, request history, consent history, and current request actions
- putting follow-up there keeps the collapsed row summary-focused

Recommended UI changes:

- current active pending request section:
  - replace the deferred idea of reminder with a real `Send reminder` action
- current no-valid-request section:
  - show `Send new request`
  - reuse the existing template picker when creating a new request is required

Do not add:

- a new detail route just for this
- row-level multi-action clutter on the collapsed table
- a separate delivery dashboard

## Recommended UI status after placeholder follow-up

Recommended success/info messages:

- reminder path:
  - `Reminder recorded for the current request. Email delivery is not configured yet. Copy or open the link to share it manually.`
- new-request path:
  - `New request created and placeholder delivery recorded. Email delivery is not configured yet. Copy or open the new link to share it manually.`

Recommended failure message when request is valid but placeholder delivery bookkeeping fails:

- `A valid request is ready, but placeholder delivery could not be recorded. No email was sent. You can still copy or open the link and retry.`

Important UX rule:

- never say "email sent"
- never say "reminder sent"
- never use green success copy that implies real outbound delivery happened

## Recommended visibility of follow-up attempts

Keep it bounded.

Recommended first UI surface:

- show the latest follow-up attempt in the current baseline summary area or current request panel

Example fields:

- action kind
- attempted at
- status
- delivery mode label:
  - `Placeholder only`

Do not add a full delivery-history section in Feature 054 unless the plan phase finds it necessary. The request history and consent history from Feature 053 should remain the main history sections.

## Security and reliability considerations

- all follow-up logic stays server-side
- never trust client-provided tenant ids
- follow-up route remains owner/admin only
- do not change immutable signed consent rows
- do not revive terminal request rows
- keep request lifecycle and delivery lifecycle separate
- use parameterized Supabase query-builder or RPC APIs only
- require `Idempotency-Key` for the follow-up route

### Duplicate follow-up clicks

Recommended behavior:

- same idempotency key -> same result replay
- new idempotency key -> new reminder attempt or new request attempt, depending on server state

### Retry after lost response

Recommended behavior:

- return the same request and delivery result for the same idempotency key
- do not create a second request
- do not create a second attempt row

### Reminder while request is being signed

Recommended behavior:

- whichever transaction wins the request lock determines outcome
- if sign wins first, follow-up should observe no active pending request and either:
  - return signed conflict, or
  - if the product later wants a smoother path after revoke, still not create a new request while active signed exists

Practical recommendation:

- return the existing `baseline_consent_already_signed` conflict when the profile now has an active signed baseline

### Follow-up while request is being replaced or cancelled

Recommended behavior:

- use server-side locked state to choose the live target
- never act on a stale request id
- if another admin already replaced the request and a new pending request exists, follow-up should use that active pending request as reminder target

This is another reason to prefer one server-side follow-up command over separate reminder-only and new-request-only mutation routes.

### Stale or just-expired requests

Recommended behavior:

- opportunistically expire stale pending rows first
- if no active pending request remains, create a new request

### Archived profile races

Recommended behavior:

- if the profile becomes archived before follow-up prepares the request target, return `recurring_profile_archived`
- do not record delivery attempts for archived profiles

## Edge cases

- profile is `pending`, but the request expires between page load and click
  - server should create a new request instead of trying to remind on the expired row
- profile is `missing` in stale UI, but another admin already created a new pending request
  - server should reuse that pending request and treat the effective action as reminder
- profile is `revoked`, but another admin creates a new pending request just before follow-up
  - same rule: remind on the current valid request
- follow-up request creates a new request successfully, but placeholder attempt persistence fails
  - keep the new request valid
  - return partial-failure messaging
- follow-up request reuses an active pending request, but placeholder attempt persistence fails
  - keep the request valid
  - allow retry
- profile is archived with a formerly pending request
  - no follow-up action
  - latest request remains cancelled and visible through existing request history
- admin explicitly wants a new token even though a valid pending request exists
  - that remains `Replace request`, not follow-up

## Explicitly deferred work

- real SMTP sending
- third-party delivery provider integration
- delivery-provider configuration UI
- reminder scheduling
- cadence rules
- batch or multi-select follow-up
- SMS or other channels
- specific or extra consent requests
- profile editing
- generic communications platform
- advanced delivery analytics
- broad email infrastructure redesign

## Open decisions for the plan phase

- Should Feature 054 use one route `POST /api/profiles/[profileId]/baseline-follow-up` with state-aware branching, or two routes with more client-side branching? Recommendation: one route.
- Should `Send new request` always reuse the existing baseline template picker, or should it auto-select the latest baseline template when obvious? Recommendation: keep the picker for the smallest coherent slice.
- What exact table name and status enum names should the delivery-attempt model use?
- Should the initial UI show only the latest follow-up attempt, or the latest few attempts in the current request panel?
- Should the follow-up route accept an optional `currentRequestId` as a stale-state hint for logging or diagnostics, while still remaining server-authoritative?

## Research conclusion

The smallest operationally useful Feature 054 is not a reminder-only button. It is a state-aware manual follow-up slice:

- if a valid pending baseline request exists, `Send reminder` reuses that request unchanged
- if no valid pending request exists, `Send new request` creates a new request
- expired, cancelled, and superseded requests are never revived
- real email sending stays out of scope
- placeholder delivery gets its own bounded dispatch seam and delivery-attempt persistence
- the inline detail panel on `/profiles` remains the correct UI home

That keeps the recurring baseline request lifecycle clean, preserves Feature 051-053 invariants, and adds the first honest backend path for future delivery integration without pretending anything was actually sent.
