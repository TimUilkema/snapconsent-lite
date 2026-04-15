# Feature 053 Research: Recurring Consent History and Profile Detail

## Scope

Research the next bounded recurring-profiles slice after Features 050-052:

- add a protected recurring profile detail page
- make one profile's baseline consent lifecycle inspectable
- expose enough history to support current baseline management safely

This is not a reminder feature, not a generic audit console, and not a redesign of the project consent domain.

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
11. `docs/rpi/052-baseline-request-management/research.md`
12. `docs/rpi/052-baseline-request-management/plan.md`

### Live recurring-profile schema and migrations verified

- `supabase/migrations/20260414170000_050_recurring_profile_directory_foundation.sql`
- `supabase/migrations/20260414193000_051_baseline_recurring_consent_request_foundation.sql`
- `supabase/migrations/20260414210000_052_baseline_request_management.sql`
- `supabase/migrations/20260414211500_052_baseline_request_management_fix.sql`
- `supabase/migrations/20260414213000_052_baseline_request_management_replace_fix.sql`

### Live recurring-profile routes, services, and UI verified

- `src/app/(protected)/profiles/page.tsx`
- `src/components/profiles/profiles-shell.tsx`
- `src/components/navigation/protected-nav.tsx`
- `src/lib/profiles/profile-access.ts`
- `src/lib/profiles/profile-directory-service.ts`
- `src/lib/profiles/profile-consent-service.ts`
- `src/lib/profiles/profile-route-handlers.ts`
- `src/app/api/profiles/route.ts`
- `src/app/api/profiles/[profileId]/archive/route.ts`
- `src/app/api/profiles/[profileId]/baseline-consent-request/route.ts`
- `src/app/api/profiles/[profileId]/baseline-consent-request/[requestId]/cancel/route.ts`
- `src/app/api/profiles/[profileId]/baseline-consent-request/[requestId]/replace/route.ts`

### Live recurring public sign and revoke implementation verified

- `src/app/rp/[token]/page.tsx`
- `src/app/rp/[token]/consent/route.ts`
- `src/app/rr/[token]/page.tsx`
- `src/app/rr/[token]/revoke/route.ts`
- `src/components/public/public-recurring-consent-form.tsx`
- `src/lib/recurring-consent/public-recurring-consent.ts`
- `src/lib/recurring-consent/revoke-recurring-profile-consent.ts`
- `src/lib/email/send-receipt.ts`
- `src/lib/tokens/public-token.ts`
- `src/lib/url/paths.ts`

### Reused repo conventions verified

- `src/lib/http/errors.ts`
- `src/lib/tenant/resolve-tenant.ts`
- `src/lib/templates/template-service.ts`
- `messages/en.json`
- `messages/nl.json`

### Relevant live tests verified

- `tests/feature-051-baseline-recurring-consent-request-foundation.test.ts`
- `tests/feature-051-baseline-recurring-consent-request-routes.test.ts`
- `tests/feature-052-baseline-request-management.test.ts`
- `tests/feature-052-baseline-request-management-routes.test.ts`

## Verified current live history boundary after Feature 052

## 1. The live recurring-profile domain already stores more history than the protected UI shows

Feature 052 shipped a real recurring baseline request and signed-consent lifecycle. The protected UI has only one operational page today:

- `/profiles`

That page currently exposes:

- profile identity summary in the table
- derived baseline state badge
- one latest activity line
- one pending-request management panel
- one latest terminal request outcome line when the profile is back to `missing`

What it does not expose:

- a profile detail route
- a full request history list
- signed recurring consent history
- revoke history beyond the derived `revoked` badge
- protected visibility of raw consent events

The main Feature 053 question is therefore not whether history exists. It already exists. The question is how to expose it without turning `/profiles` into a history console.

## 2. Current request rows are the source of truth for request lifecycle history

Live table:

- `public.recurring_profile_consent_requests`

Live stored request fields relevant to history:

- `id`
- `tenant_id`
- `profile_id`
- `consent_kind`
- `consent_template_id`
- `profile_name_snapshot`
- `profile_email_snapshot`
- `token_hash`
- `status`
- `expires_at`
- `created_by`
- `created_at`
- `updated_at`
- `superseded_by_request_id`

Live statuses:

- `pending`
- `signed`
- `expired`
- `superseded`
- `cancelled`

Live lifecycle behavior:

- create request inserts `pending`
- public sign flips request to `signed`
- stale request touchpoints opportunistically flip `pending` to `expired`
- profile archive auto-cancels active pending requests
- explicit cancel flips `pending` to `cancelled`
- explicit replace flips old request to `superseded`, creates a new `pending` request, and writes `superseded_by_request_id`

Live protected exposure today via `listRecurringProfilesPageData(...)`:

- current pending request:
  - `id`
  - `expiresAt`
  - derived `consentPath`
  - `emailSnapshot`
  - `updatedAt`
- latest terminal request outcome while state is `missing`:
  - `status` in `cancelled | superseded | expired`
  - `changedAt`

Important live gap:

- `/profiles` does not expose prior request rows beyond that one latest terminal outcome
- protected UI does not show `created_at`, template choice, or supersession chain for prior requests

## 3. Current signed recurring-consent rows are the source of truth for signed and revoked history

Live table:

- `public.recurring_profile_consents`

Live stored fields relevant to history:

- `id`
- `tenant_id`
- `profile_id`
- `request_id`
- `consent_kind`
- `consent_template_id`
- `profile_name_snapshot`
- `profile_email_snapshot`
- `consent_text`
- `consent_version`
- `structured_fields_snapshot`
- `signed_at`
- `capture_ip`
- `capture_user_agent`
- `revoked_at`
- `revoke_reason`
- `receipt_email_sent_at`
- `created_at`

Live invariants:

- one signed row per request
- one active baseline consent per profile via partial unique index where `revoked_at is null`
- rows are immutable except revoke and receipt-tracking fields

Live protected exposure today:

- none directly

Live derived exposure today:

- `/profiles` shows `signed` or `revoked`
- `/profiles` shows one latest signed or revoked timestamp through `latestActivityAt`

Important live gap:

- admins cannot inspect which request produced the current signed baseline
- admins cannot review prior signed baseline rows after revoke and re-request cycles
- admins cannot see structured snapshot data, consent version, revoke reason, or receipt state in protected UI

## 4. Current consent-event rows exist but are not exposed in protected UI

Live table:

- `public.recurring_profile_consent_events`

Live stored fields:

- `id`
- `tenant_id`
- `consent_id`
- `event_type`
- `payload`
- `created_at`

Live event types:

- `granted`
- `revoked`

Live payload usage:

- `granted` stores request context such as `request_id`
- `revoked` stores revoke context such as `reason`

Live protected exposure today:

- none

Important live implication:

- the event table is already available for audit-oriented read models
- however, the current event set is narrow and mostly mirrors data already visible on the signed consent row

## 5. `/profiles` currently acts as both overview and management surface

Live `/profiles` behavior today:

- search and type filters
- list row identity and status
- baseline request creation from the row
- pending link copy or open from the row
- cancel and replace from the row
- archive profile from the row

Live result:

- the list is operational
- the list already carries more management detail than a durable overview page should hold
- there is no deeper destination for one-profile inspection

## 6. What is currently missing to make one-profile inspection usable

Today an admin cannot answer the following from the protected app without manual database inspection:

- what exact baseline requests has this profile had
- which request is current versus replaced versus cancelled
- which consent row is the active baseline, if any
- whether prior baseline consents were revoked and when
- whether the last lifecycle change was a request outcome or a consent outcome
- what consent version and structured snapshot were actually signed

That is the precise product gap for Feature 053.

## Current schema, routes, components, and helpers involved

### Schema and SQL

- `recurring_profiles`
- `recurring_profile_types`
- `recurring_profile_consent_requests`
- `recurring_profile_consents`
- `recurring_profile_consent_revoke_tokens`
- `recurring_profile_consent_events`
- `public.create_recurring_profile_baseline_request(...)`
- `public.cancel_recurring_profile_baseline_request(...)`
- `public.replace_recurring_profile_baseline_request(...)`
- `public.get_public_recurring_profile_consent_request(...)`
- `public.submit_public_recurring_profile_consent(...)`
- `public.get_public_recurring_profile_revoke_token(...)`
- `public.revoke_public_recurring_profile_consent(...)`

### Protected reads and management

- `src/app/(protected)/profiles/page.tsx`
- `src/components/profiles/profiles-shell.tsx`
- `src/lib/profiles/profile-directory-service.ts`
- `src/lib/profiles/profile-consent-service.ts`
- `src/lib/profiles/profile-access.ts`

### Protected mutation routes

- `POST /api/profiles/[profileId]/baseline-consent-request`
- `POST /api/profiles/[profileId]/baseline-consent-request/[requestId]/cancel`
- `POST /api/profiles/[profileId]/baseline-consent-request/[requestId]/replace`
- `POST /api/profiles/[profileId]/archive`

### Public recurring sign and revoke

- `/rp/[token]`
- `/rp/[token]/consent`
- `/rr/[token]`
- `/rr/[token]/revoke`

### Token and path helpers

- `deriveRecurringProfileConsentToken({ requestId })`
- `deriveRecurringProfileRevokeToken({ consentId })`
- `buildRecurringProfileConsentPath(token)`
- `buildRecurringProfileRevokePath(token)`

### Error, auth, and tenant conventions

- `HttpError`
- `jsonError`
- `resolveTenantId(...)`
- owner or admin management checks through `resolveProfilesAccess(...)`
- request mutations remain request-id-targeted for cancel and replace

## Options considered

## Option A: Keep everything on `/profiles` and expand the list with more inline history

Possible direction:

- add more columns
- add longer row panels
- add request history expansion inline
- add signed or revoked history inline

Pros:

- no new route
- reuses the existing operational page

Cons:

- pushes more state and history into an already overloaded list
- worsens row complexity and scroll depth
- makes request versus consent history harder to separate clearly
- increases stale row action risk because management and history stay compressed into list rows

Conclusion:

- reject

## Option B: Add `/profiles/[profileId]` as a focused detail and history surface, while keeping `/profiles` as the overview

Possible direction:

- keep `/profiles` as the directory and filter surface
- add `/profiles/[profileId]`
- move nuanced history and current-state inspection to the detail page
- keep current baseline actions available there

Pros:

- matches the current product problem directly
- bounds history to one profile instead of making the list denser
- keeps request lifecycle and signed consent lifecycle separable
- supports archived profiles and historical inspection without changing the directory model

Cons:

- adds one new protected route and view model
- requires a deliberate split of list versus detail responsibilities

Conclusion:

- recommend

## Option C: Build a merged generic lifecycle timeline or audit surface now

Possible direction:

- merge request rows, consent rows, and event rows into one generic timeline
- make the detail page mostly a raw event viewer

Pros:

- can look comprehensive
- may support later audit ambitions

Cons:

- exceeds the stated scope
- request lifecycle and consent lifecycle are related but not identical
- current event rows only cover `granted` and `revoked`, so a generic timeline still needs request-row modeling
- starts a generic timeline framework that the prompt explicitly says to defer

Conclusion:

- reject for Feature 053

## Recommended bounded feature scope

Feature 053 should implement the smallest coherent profile detail slice:

- add a protected detail route:
  - `/profiles/[profileId]`
- keep `/profiles` as the main directory and overview page
- make the detail page the preferred place for one-profile baseline inspection
- show current baseline summary and current management actions on the detail page
- show separate request history and baseline consent history sections
- do not introduce a generic merged event timeline

This is not a broad redesign. It is a one-profile read and manage surface built on the existing recurring-profile backend.

## Recommended detail-page structure

## 1. Profile summary header

Recommended contents:

- profile full name
- email
- type label, if any
- profile status badge
- baseline state badge
- back link to `/profiles`

Why it is needed:

- admins need immediate identity context before reading the history sections
- this is the right place to preserve the distinction between profile status and baseline consent status

## 2. Current baseline summary card

Recommended contents:

- derived baseline state
- latest baseline activity timestamp
- one sentence summary:
  - no request yet
  - pending until
  - signed at
  - revoked at
  - latest request cancelled or replaced or expired

Why it is needed:

- gives the current answer before the user reads the history lists
- preserves the existing derived-state model rather than inventing a new status taxonomy

## 3. Current management panel

Recommended contents by current state:

- `missing` or `revoked`
  - request baseline consent
- `pending`
  - copy active link
  - open active link
  - cancel pending request
  - replace pending request
  - show email snapshot and expiry
- `signed`
  - no baseline-request action
- archived profiles
  - read-only, no baseline-request actions

Why it is needed:

- the user explicitly wants current management actions from one place
- these actions already exist in the live backend and list UI
- a detail page without current actions would force admins back to the list for basic management

## 4. Request history section

Recommended section purpose:

- baseline request lifecycle history only

Recommended row fields:

- request status
- created at
- expires at
- latest lifecycle change at
- request email snapshot
- template name and version when available through join

Recommended ordering:

- newest first

Recommended size for the first slice:

- show the most recent 20 requests for the profile
- no pagination in Feature 053

Why this section is needed:

- request history is the only place admins can understand pending, cancelled, expired, and superseded behavior
- current list visibility is intentionally too thin for one-profile inspection

## 5. Baseline consent history section

Recommended section purpose:

- signed recurring baseline consent history only

Recommended row fields:

- signed at
- revoked at, if any
- template version
- request id linkage or request-created date if helpful for context
- email snapshot
- structured snapshot summary for core built-ins such as scope and duration when present

Recommended ordering:

- newest first

Recommended size for the first slice:

- show the most recent 20 signed consent rows for the profile
- no pagination in Feature 053

Why this section is needed:

- signed and revoked history is separate from request history
- this is where admins can inspect the active baseline consent, or prior baseline consents after revoke and re-request cycles

## 6. No standalone raw event timeline in the first slice

Recommendation:

- do not add a separate `Consent event timeline` section in Feature 053

Reasoning:

- `granted` and `revoked` events mostly duplicate signed and revoked timestamps already stored on consent rows
- request lifecycle is not represented in the event table, so a true unified history still needs request sections
- adding a third history section would drift toward a generic audit console

Recommended compromise:

- use the event table as backend audit truth when helpful
- keep the protected presentation model to two visible histories:
  - request history
  - signed consent history

## Recommended history and presentation model

Feature 053 should explicitly separate three backend concepts, but only present two primary history sections.

### Request lifecycle rows

Present as:

- dedicated `Request history`

Statuses to show:

- `pending`
- `signed`
- `expired`
- `cancelled`
- `superseded`

### Signed recurring consent rows

Present as:

- dedicated `Baseline consent history`

States to show:

- signed and still active
- signed and later revoked

### Consent events

Present as:

- not a standalone section in Feature 053

Use instead:

- to support audit correctness behind the scenes
- to populate future extensions if the product later needs a deeper audit/timeline view

This is the cleanest bounded model because it stays faithful to the live domain split instead of flattening everything into one pseudo-timeline.

## Recommended `/profiles` versus `/profiles/[profileId]` responsibility split

## `/profiles` should remain the overview page

Keep on the list page:

- search and filtering
- active or archived directory overview
- type, email, profile status, baseline badge, and one-line activity
- archive profile action
- link to open the detail page

Recommended list simplification once detail exists:

- keep lightweight quick actions only
- move nuanced pending-request management to detail

Recommended quick actions to keep on `/profiles`:

- `Request baseline consent` for `missing` or `revoked`
- `Copy baseline link` for `pending`

Recommended actions to prefer on detail:

- `Cancel request`
- `Replace request`
- history inspection

This keeps the list operational without making it the long-term home for lifecycle detail.

## `/profiles/[profileId]` should become the preferred one-profile management surface

Put on the detail page:

- current baseline summary
- current pending request panel
- latest active signed baseline visibility
- revoked baseline history
- request history
- baseline consent history
- the full current action surface

This is the smallest role split that addresses the current overload problem without redesigning the whole module.

## Recommended data model and query needs

## 1. Current tables already hold enough data for the first detail slice

Recommended answer:

- no new recurring-profile tables are required
- no new request or consent columns are clearly required

Why:

- request rows already store lifecycle state, snapshots, expiry, and supersession linkage
- signed rows already store signed, revoked, template version, and structured snapshot data
- event rows already store granted and revoked audit data if needed

## 2. Current indexes are likely sufficient for the bounded detail page

Current useful indexes already live:

- request history:
  - `(tenant_id, profile_id, created_at desc)`
- signed consent history:
  - `(tenant_id, profile_id, signed_at desc)`
- active pending uniqueness:
  - `(tenant_id, profile_id, consent_kind)` where `status = 'pending'`
- active signed uniqueness:
  - `(tenant_id, profile_id, consent_kind)` where `revoked_at is null`

Implication:

- a one-profile detail page can read request and consent history efficiently with existing indexes

## 3. Event history reads do not justify a new index in the first slice

Current event index:

- `(tenant_id, consent_id, created_at asc)`

For Feature 053:

- if the page does not ship a standalone merged event timeline, this is sufficient
- if the plan later insists on a merged profile-level event feed, revisit indexing then

## 4. The likely implementation need is a new detail read helper, not a schema migration

Recommended new server helper:

- `getRecurringProfileDetailPageData(...)`

Recommended responsibilities:

- validate tenant-scoped profile access
- load the profile row and type
- derive current baseline summary
- load newest request rows
- load newest signed consent rows
- optionally load event rows for the loaded consent ids if the plan needs them
- prepare detail-page-specific view models

## 5. `updated_at` remains acceptable for request terminal timestamps

Current live request rows do not have separate:

- `cancelled_at`
- `superseded_at`

For Feature 053:

- keep using `updated_at` for terminal request outcome timestamps
- do not add dedicated lifecycle timestamp columns unless the plan decides the copy or compliance story truly requires them

Because request rows are create-plus-lifecycle-transition only, `updated_at` is already meaningful enough for the bounded detail slice.

## Recommended navigation and URL structure

Recommended route:

- `/profiles/[profileId]`

Recommended list linking:

- profile name links to detail
- add an explicit row action or secondary link such as `View details` if needed

Recommended post-mutation behavior:

- detail-page mutations stay on the detail page and refresh server data
- list-page quick actions, if retained, may keep current inline behavior

Recommended deep-link strategy for Feature 053:

- no section hashes or query-param deep links required in the first slice
- add only if the plan finds a concrete user need

This keeps the navigation model small and predictable.

## Security and reliability considerations

- all detail reads remain tenant-scoped and server-side
- never trust client-provided `tenant_id`
- protect `/profiles/[profileId]` with the same membership model as `/profiles`
- keep owner or admin-only mutations server-authoritative
- archived profiles should remain viewable in detail for history inspection, but actions stay disabled
- current request mutations must continue targeting a specific `requestId`
- detail views must tolerate stale state caused by sign, revoke, cancel, replace, or archive races
- after any mutation, refresh the server-rendered detail state instead of trusting client caches
- do not expose revoke tokens to admins:
  - only hashed revoke tokens are stored
  - the detail page should not invent an admin revoke-link copy flow

## Edge cases

- profile archived after several requests and consents:
  - detail should stay readable
  - actions disabled
- pending request replaced while another admin has the detail page open:
  - refresh should show the new pending request and move the old row into request history
- request signed while the detail page still shows `pending`:
  - refresh should switch to `signed`
  - pending actions should disappear
- signed consent later revoked:
  - detail should show `revoked` current state when no newer active baseline exists
  - prior signed row remains in consent history
- revoked baseline followed by new pending request:
  - current state becomes `pending`
  - consent history still shows the revoked signed row
- profile editing remains unsupported:
  - request and consent rows keep their original snapshots
  - future editable profile values may differ from historical request or consent snapshots
- template archived after requests or signing:
  - detail joins should still work because linked template rows remain in the database

## Explicitly deferred work

- reminders and reminder scheduling
- outbound email workflows beyond the already-shipped sign receipt
- specific or extra consent requests
- profile editing
- headshots
- project-linking behavior
- import and sync
- export and reporting tooling
- generic audit console
- generic cross-domain timeline framework

## Open decisions for the plan phase

- Should `/profiles` keep `Request baseline consent` and `Copy baseline link` as quick actions, or should all baseline actions move to detail immediately?
- Should the detail page show a small structured snapshot summary on consent history rows, or defer that to a secondary expansion?
- Should the first detail page cap request and consent history at 20 rows, or show all rows if the counts stay small?
- Should the plan include a compact latest-activity strip sourced from both request and consent rows, or is the current summary card enough?
- Should the detail page show joined template name and version for request history only, or also surface template scope when useful?
- Is a standalone event list still unnecessary after concrete mockups, or is a very small recent-events block needed for support workflows?
- Should Feature 053 remove `Cancel request` and `Replace request` from the list page in the same slice, or keep them temporarily for continuity while making detail the preferred destination?

## Research conclusion

The smallest coherent Feature 053 is:

- add `/profiles/[profileId]`
- keep `/profiles` as the overview and directory page
- make the detail page the preferred place for current baseline inspection and management
- present request history separately from signed baseline consent history
- defer a standalone raw event timeline

That recommendation is grounded in the live implementation after Feature 052:

- request lifecycle history already exists in `recurring_profile_consent_requests`
- signed and revoked history already exists in `recurring_profile_consents`
- audit events already exist in `recurring_profile_consent_events`
- the current UI simply does not expose them beyond a thin derived summary on `/profiles`

Feature 053 should therefore be a focused detail-and-history read model, not a backend redesign and not a generic audit system.
