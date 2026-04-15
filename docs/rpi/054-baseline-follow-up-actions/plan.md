# Feature 054 Plan: Baseline Follow-up Actions with Placeholder Delivery

## Scope

Implement one bounded recurring-profile operational slice:

- state-aware manual follow-up for baseline recurring consent
- `Send reminder` when a valid active pending request already exists
- `Send new request` when no valid active pending request exists
- placeholder-only delivery recording
- honest `/profiles` inline detail feedback that no real email was sent

This cycle does not add SMTP sending, scheduling, batch send, multi-channel delivery, or a general communications system.

## Inputs and ground truth

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
14. `docs/rpi/053-recurring-consent-history-and-inline-profile-detail/plan.md`
15. `docs/rpi/054-baseline-follow-up-actions/research.md`

### Live code and schema re-verified for this plan

- `supabase/migrations/20260414170000_050_recurring_profile_directory_foundation.sql`
- `supabase/migrations/20260414193000_051_baseline_recurring_consent_request_foundation.sql`
- `supabase/migrations/20260414210000_052_baseline_request_management.sql`
- `supabase/migrations/20260414211500_052_baseline_request_management_fix.sql`
- `supabase/migrations/20260414213000_052_baseline_request_management_replace_fix.sql`
- `src/lib/profiles/profile-directory-service.ts`
- `src/lib/profiles/profile-consent-service.ts`
- `src/lib/profiles/profile-route-handlers.ts`
- `src/components/profiles/profiles-shell.tsx`
- `src/lib/email/send-receipt.ts`
- `src/lib/http/errors.ts`
- `src/lib/tokens/public-token.ts`
- `src/lib/url/paths.ts`

## Verified current planning boundary

### Current live recurring baseline states

The protected `/profiles` data model currently derives exactly four baseline states:

- `missing`
- `pending`
- `signed`
- `revoked`

`missing` can still carry a `latestRequestOutcome` of:

- `expired`
- `cancelled`
- `superseded`

### Current live request states

`public.recurring_profile_consent_requests` currently uses:

- `pending`
- `signed`
- `expired`
- `superseded`
- `cancelled`

Expired, cancelled, and superseded requests are terminal in live code. Public routes do not revive them.

### Current live operational surfaces

- Protected create route: `POST /api/profiles/[profileId]/baseline-consent-request`
- Protected cancel route: `POST /api/profiles/[profileId]/baseline-consent-request/[requestId]/cancel`
- Protected replace route: `POST /api/profiles/[profileId]/baseline-consent-request/[requestId]/replace`
- `/profiles` inline detail panel is the current home for baseline lifecycle actions
- Only receipt sending exists in email infrastructure; there is no baseline request delivery abstraction yet

### Current live action flags

The detail payload already exposes:

- `canRequestBaselineConsent`
- `canCopyBaselineLink`
- `canOpenBaselineLink`
- `canCancelPendingRequest`
- `canReplacePendingRequest`

The list row is still summary-only. `Send reminder` currently exists only as a disabled deferred action.

## Recommendation

Implement Option B from research: one state-aware manual follow-up feature.

Concrete recommendation:

- add one protected follow-up route
- keep lifecycle authority server-side
- reuse the current active pending request when valid
- create a new request when no valid active pending request exists
- never revive expired, cancelled, or superseded requests
- record placeholder delivery attempts in a dedicated table
- surface only the latest follow-up attempt in the inline detail panel
- keep all user-facing copy explicit that no real email was sent

This is the smallest slice that is operationally useful without drifting into real delivery infrastructure.

## Chosen architecture

### Route shape

Use one protected route:

- `POST /api/profiles/[profileId]/baseline-follow-up`

Do not split reminder and new-request into separate routes. The backend must choose based on current authoritative state.

### Service shape

Add a dedicated server-side follow-up service, for example:

- `src/lib/profiles/profile-follow-up-service.ts`

Primary responsibilities:

- validate auth and profile-management access
- re-read the current baseline/request state for the profile
- choose `reminder` vs `new_request`
- reuse the current active pending request or create a new one
- derive the correct current consent link
- invoke placeholder delivery dispatch
- persist the delivery attempt result
- return an authoritative payload for the UI

### Delivery seam

Add a small delivery abstraction under the recurring-profile domain, for example:

- `src/lib/profiles/profile-follow-up-delivery.ts`

This should not call `nodemailer` yet. It should accept the target request and follow-up action, resolve the current shareable link, and return a placeholder-mode result that can later be replaced by a real provider-backed implementation.

### UI home

Keep the feature in the expanded inline detail panel on `/profiles`.

- no collapsed-row CTA
- no separate detail page
- no batch surface

## Exact scope boundary

### Becomes real in Feature 054

- one server route for baseline follow-up
- server-side state-to-action decision logic
- reminder path for current active pending request
- new-request path when no valid active pending request exists
- dedicated placeholder delivery-attempt persistence
- latest follow-up attempt visibility in profile detail
- inline detail CTA and success/error feedback
- i18n-backed follow-up labels, helper text, and result copy

### Remains unchanged from Features 051-053

- baseline request create/cancel/replace routes and lifecycle semantics
- immutable signed recurring consent rows
- sign and revoke public flows
- current seven-day request expiry rule
- copy/open current link behavior
- request history and consent history structure
- project/event consent flow

### Explicitly deferred

- SMTP sending
- provider integrations
- provider configuration UI
- scheduled reminders
- reminder cadence rules
- batch follow-up
- SMS or other channels
- richer delivery analytics
- generic messaging platform work

## Exact state-to-action mapping

The follow-up route must derive action from live server state only.

| Authoritative state at click time | Follow-up action | Notes |
| --- | --- | --- |
| `pending` with active unexpired request | `reminder` | Reuse the current request and link. |
| `missing` with no request history | `new_request` | Create a fresh pending request. |
| `missing` with latest request `expired` | `new_request` | Expire remains terminal; create a new request. |
| `missing` with latest request `cancelled` | `new_request` | Cancelled remains terminal; create a new request. |
| `missing` with latest request `superseded` and no active pending request | `new_request` | Old superseded request stays terminal. |
| latest request `superseded` but a newer active pending request exists | `reminder` | Follow the active request, not the superseded one. |
| `revoked` with no active pending request | `new_request` | Active consent is gone; create a new request. |
| `signed` | no follow-up action | Follow-up is blocked because active baseline already exists. |
| archived profile | no follow-up action | Archived profiles cannot receive follow-up. |

Hard rule:

- expired, cancelled, and superseded requests are never revived
- follow-up never auto-replaces a valid active pending request

## Exact route and service plan

### Route

- `POST /api/profiles/[profileId]/baseline-follow-up`

### Auth and authorization

- authenticated session required
- tenant derived server-side from auth/session
- owner/admin only, reusing the same profile-management access rule as existing baseline request routes

### Request shape

Use no meaningful client body for lifecycle decisions.

- body: empty or omitted
- required header: `Idempotency-Key`

Rationale:

- the client should not send `action`, `requestId`, or `tenantId`
- stale UI hints must not drive lifecycle behavior
- the route re-derives the latest state before acting

### Response shape

Return one authoritative payload:

```json
{
  "followUp": {
    "action": "reminder",
    "deliveryMode": "placeholder",
    "deliveryStatus": "recorded",
    "request": {
      "id": "uuid",
      "profileId": "uuid",
      "status": "pending",
      "expiresAt": "ISO-8601",
      "consentPath": "/rp/...",
      "emailSnapshot": "person@example.com"
    },
    "deliveryAttempt": {
      "id": "uuid",
      "actionKind": "reminder",
      "status": "recorded",
      "attemptedAt": "ISO-8601"
    }
  }
}
```

`action` is the authoritative UI signal:

- `reminder`
- `new_request`

### Error shaping

Reuse `HttpError` and `jsonError`.

Expected codes:

- `invalid_idempotency_key` -> `400`
- `recurring_profile_not_found` -> `404`
- `recurring_profile_management_forbidden` -> `403`
- `recurring_profile_archived` -> `409`
- `baseline_consent_already_signed` -> `409`
- `baseline_follow_up_delivery_record_failed` -> `500`
- `baseline_follow_up_failed` -> `500` fallback

### Idempotency

`Idempotency-Key` is required.

Use a dedicated operation namespace, for example:

- `baseline_follow_up_recurring_profile_consent_request:${profileId}`

Behavior:

- same profile + same idempotency key returns the same follow-up payload
- duplicate clicks with the same key do not create extra requests or extra delivery-attempt rows
- duplicate clicks with different keys may create additional reminder attempts, but must not create a second active pending request

### Stale UI handling

The route must ignore stale client assumptions and re-evaluate current state at execution time.

Examples:

- if UI showed `missing` but another admin already created a pending request, respond with `reminder`
- if UI showed `pending` but the request just expired, create a new request and respond with `new_request`

## Exact delivery-attempt persistence plan

### Decision

Add a dedicated table:

- `public.recurring_profile_consent_request_delivery_attempts`

This is the smallest model that cleanly separates delivery from request lifecycle while still giving the UI an honest delivery trace.

### Exact columns

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null references public.tenants(id) on delete cascade`
- `profile_id uuid not null`
- `request_id uuid not null`
- `action_kind text not null check (action_kind in ('reminder', 'new_request'))`
- `delivery_mode text not null check (delivery_mode in ('placeholder'))`
- `status text not null check (status in ('recorded', 'failed'))`
- `target_email text not null`
- `error_code text null`
- `error_message text null`
- `created_by uuid not null references auth.users(id) on delete restrict`
- `created_at timestamptz not null default now()`

### Foreign keys

- `(profile_id, tenant_id)` -> `public.recurring_profiles (id, tenant_id)` on delete restrict
- `(request_id, tenant_id)` -> `public.recurring_profile_consent_requests (id, tenant_id)` on delete restrict

### Indexes

- unique `(id, tenant_id)`
- index `(tenant_id, profile_id, created_at desc)`
- index `(tenant_id, request_id, created_at desc)`

### RLS / policies

Match the current recurring-profile model:

- select for authenticated tenant members
- insert for authenticated owners/admins only
- no client-side delete
- no client-side update required for this cycle

### Multiple attempts

Yes. Multiple rows per request are supported now.

This is required for:

- repeated reminders
- retry with a different idempotency key
- future provider-backed delivery attempts

### UI read model

Only the latest attempt needs to be surfaced in this cycle.

Add a latest-attempt shape to the detail payload, for example:

- `baselineConsent.latestFollowUpAttempt`
  - `id`
  - `actionKind`
  - `deliveryMode`
  - `status`
  - `targetEmail`
  - `attemptedAt`
  - `errorCode`

Do not add a full delivery-attempt history panel yet.

## Exact placeholder delivery plan

### Delivery abstraction

Add a delivery function that receives:

- tenant-scoped request context
- action kind: `reminder` or `new_request`
- current consent path

Suggested return shape:

```ts
type FollowUpPlaceholderDispatchResult = {
  deliveryMode: "placeholder";
  status: "recorded";
};
```

For this cycle, placeholder dispatch means:

- the server resolved the correct current request and link
- the server recorded that a placeholder follow-up happened
- no email was actually sent

### Recorded vs failed

- `recorded`: placeholder dispatch completed and a `recorded` attempt row was persisted
- `failed`: the placeholder delivery step failed and the service successfully persisted a `failed` attempt row with error metadata

If the attempt row itself cannot be persisted:

- return an error
- do not claim the follow-up was recorded
- do not assume a failed attempt row exists

### Failure ordering

Keep request lifecycle and delivery lifecycle separate:

1. determine or create the correct current request
2. resolve the current link
3. persist the delivery attempt row
4. only then write the top-level idempotency payload

If attempt persistence fails after request creation:

- keep the request lifecycle change
- return an error
- do not claim anything was sent
- let the admin retry

This can cause a retry to behave like `reminder` against the newly active request instead of repeating the original `new_request` result. That is acceptable for this cycle because the admin intent is to obtain and share the current valid link, not to preserve a hidden first-send distinction.

### Future SMTP seam

Later SMTP or provider-backed delivery should be able to plug in by changing only the delivery implementation and expanding the attempt row fields, not by redesigning follow-up routing or request lifecycle rules.

## Exact request lifecycle reuse plan

### Reuse strategy

Do not reimplement baseline request lifecycle from scratch inside Feature 054.

Instead:

- extract or share the existing create/reuse logic from `profile-consent-service.ts`
- keep the current SQL-backed create behavior as the source of truth
- let follow-up call the same create/reuse path when it needs a new valid request

### Active pending request

If a valid active pending request exists:

- do not replace it
- do not extend its expiry
- do not mint a new token
- use `reminder`

### No valid active request

If no valid active pending request exists:

- use the existing baseline request creation logic
- let the existing create path expire stale pending rows opportunistically as it already does
- create a new pending request with the normal seven-day expiry

### Active signed baseline conflict

If an active non-revoked baseline consent exists:

- block follow-up
- return `baseline_consent_already_signed`

### Archived profile conflict

If the profile is archived:

- block follow-up
- return `recurring_profile_archived`

## Exact `/profiles` UI evolution

### Placement

Keep follow-up actions in the expanded inline detail panel only.

### Action visibility

In the detail payload, add one authoritative follow-up action field, for example:

- `actions.availableBaselineFollowUpAction: "reminder" | "new_request" | null`

Recommended visibility rules:

- `pending` with active pending request -> show `Send reminder`
- `missing` -> show `Send new request`
- `revoked` with no active pending request -> show `Send new request`
- `signed` -> show no follow-up button
- archived profile -> show no follow-up button

### Relationship to existing actions

- keep `Copy link` and `Open link` when a pending request exists
- keep `Cancel request` and `Replace request` for current request management
- replace the inline detail CTA label `Request baseline consent` with `Send new request` when follow-up is the primary operation

This keeps admin intent front and center without adding parallel buttons that do nearly the same thing.

### Latest attempt visibility

Show only one compact latest-attempt block in the current baseline section:

- latest follow-up timestamp
- action label
- placeholder delivery status
- manual-share helper text

Do not add a separate delivery history table yet.

## Exact user-facing wording and UX honesty

All new copy must use i18n keys in `messages/en.json` and `messages/nl.json`.

### Button labels

- `Send reminder`
- `Send new request`

### Success copy

For `reminder`:

- `Reminder recorded for the current request. Email delivery is not configured yet. Copy or open the link to share it manually.`

For `new_request`:

- `New request created and placeholder delivery recorded. Email delivery is not configured yet. Copy or open the new link to share it manually.`

### Latest attempt helper copy

- `Latest follow-up recorded in placeholder mode. Email delivery is not configured yet.`

### Error copy direction

- `Follow-up could not be recorded. No email was sent.`

### Explicit prohibition

Do not use copy that implies:

- an email was sent
- a reminder was delivered
- a provider accepted the message

`Recorded` is acceptable. `Sent` is not.

## Security and reliability considerations

- all state-to-action decisions stay server-side
- tenant id always comes from authenticated server context
- route remains owner/admin only
- request lifecycle and delivery lifecycle stay separate
- follow-up never revives expired/cancelled/superseded links
- follow-up never auto-replaces a valid active request
- active signed baseline blocks follow-up
- archived profiles block follow-up
- request creation must remain retry-safe
- duplicate clicks with the same idempotency key must be safe
- stale UI state must not control reuse vs creation
- placeholder delivery failure must not corrupt request lifecycle state
- no raw delivery claims in UI or API copy

## Edge cases

- Active pending request expires between page load and click.
  The route re-checks state and creates a new request if the pending request is no longer valid.

- UI shows `missing` but another admin already created a pending request.
  The route returns `reminder` for the active request.

- Revoked profile gets a new pending request created elsewhere right before follow-up.
  The route reuses that pending request and records a reminder.

- Placeholder attempt persistence fails after a new request was created.
  The new request stays valid. The route returns an error and the admin can retry.

- Follow-up races with signing.
  If sign wins first, the route should block with `baseline_consent_already_signed`. If follow-up wins first, the sign flow still uses the same current request.

- Follow-up races with cancel/replace.
  The route re-reads current state and follows the surviving active request, or creates a new one if none remains.

- Archived profile race.
  The route must reject follow-up once archive is authoritative, even if the page still showed an action.

- Duplicate follow-up clicks with the same idempotency key.
  Return the same payload.

- Duplicate follow-up clicks with different keys on an active pending request.
  Record separate reminder attempts, but do not create a second active request.

## Test plan

### Service tests

- `pending` -> `reminder` and request reuse
- `missing` -> `new_request`
- `revoked` with no pending -> `new_request`
- `expired` latest request -> `new_request`
- `cancelled` latest request -> `new_request`
- `superseded` latest request with newer active pending -> `reminder`
- `signed` -> blocked
- archived profile -> blocked
- expired/cancelled/superseded requests are never revived
- placeholder delivery attempt row is recorded with correct action kind and request id
- persistence failure after request creation returns an error without corrupting request lifecycle
- same idempotency key returns the same follow-up payload

### Route tests

- auth required
- owner/admin required
- `Idempotency-Key` required
- stale UI state does not control behavior
- response shape includes action, request, and delivery attempt
- error shaping uses expected status codes and error codes

### UI tests

- inline detail panel shows `Send reminder` only when active pending exists
- inline detail panel shows `Send new request` only when no valid active request exists and follow-up is allowed
- signed and archived profiles show no follow-up action
- success copy is honest about placeholder delivery
- latest attempt block renders from i18n-backed data

## Implementation phases

1. Persistence and domain foundation
   Add the delivery-attempt table, indexes, RLS policies, and detail-query support for latest attempt visibility.

2. Follow-up service and route
   Add the state-aware follow-up service, placeholder dispatch seam, protected route, and idempotent response handling.

3. `/profiles` inline detail UI
   Replace the primary inline create CTA with state-aware follow-up CTA, wire submission state, and render latest-attempt status.

4. Tests and i18n polish
   Add service, route, and UI tests, plus English and Dutch messages for buttons, helper text, success, and error states.

## Explicitly deferred follow-up cycles

- real SMTP sending
- provider credentials and configuration
- scheduled reminders
- follow-up cadence rules
- bulk follow-up
- delivery history page
- provider webhooks and bounce tracking
- delivery analytics
- extra consent kinds

## Concise implementation prompt

Implement Feature 054 as one protected, state-aware baseline follow-up flow on `/profiles` inline detail. Add `POST /api/profiles/[profileId]/baseline-follow-up` with required `Idempotency-Key`, choose `reminder` when an active pending request exists, otherwise create a new pending request with existing lifecycle rules, never revive expired/cancelled/superseded requests, persist a dedicated placeholder delivery attempt row in `public.recurring_profile_consent_request_delivery_attempts`, surface only the latest attempt in profile detail, replace the inline create CTA with `Send reminder` or `Send new request` as appropriate, and keep all UI/API messaging explicit that email delivery is not configured and nothing was actually sent.
