# Feature 053 Plan - Recurring Consent History and Inline Profile Detail on `/profiles`

## Inputs and ground truth

Documents reviewed in order:

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
13. `docs/rpi/053-recurring-consent-history-and-profile-detail/research.md`

Targeted live-code verification for plan-critical boundaries:

- `src/app/(protected)/profiles/page.tsx`
- `src/components/profiles/profiles-shell.tsx`
- `src/lib/profiles/profile-directory-service.ts`
- `src/lib/profiles/profile-consent-service.ts`
- current recurring public sign/revoke helpers and token/path helpers already used by Features 051-052
- current i18n message files, especially `messages/en.json`

Live code and schema remain the source of truth. This plan adapts the prior Feature 053 research away from a dedicated detail route and toward an inline expandable detail panel on `/profiles`.

## Verified current planning boundary

### Current `/profiles` behavior

- `/profiles` is still the only protected recurring-profile UI surface.
- `src/app/(protected)/profiles/page.tsx` server-renders the page and hands `listRecurringProfilesPageData(...)` output to `ProfilesShell`.
- `ProfilesShell` is a client component that already mixes collapsed directory rows with inline baseline actions.
- The current table shows profile summary, baseline badge, latest baseline activity line, status, updated time, and row actions.
- Current row actions already include baseline request creation or pending-request management plus profile archive.

### Current recurring baseline lifecycle visibility

- `src/lib/profiles/profile-directory-service.ts` derives collapsed-row baseline state from:
  - `recurring_profile_consent_requests`
  - `recurring_profile_consents`
- The list read model currently exposes only:
  - baseline state
  - active pending request summary
  - latest activity timestamp
  - latest terminal request outcome when state is otherwise missing
- The protected UI does not expose full request history or signed consent history.

### Current lifecycle write surface

- `src/lib/profiles/profile-consent-service.ts` already supports:
  - create baseline request
  - cancel pending request
  - replace pending request
- Existing write paths are server-side, tenant-scoped, and idempotent where appropriate.
- Public sign and revoke flows already exist and should remain unchanged in this feature.

### Current history sources in live schema

- `recurring_profile_consent_requests` stores request lifecycle history:
  - pending
  - signed
  - expired
  - cancelled
  - superseded
- `recurring_profile_consents` stores immutable signed rows plus revoke fields.
- `recurring_profile_consent_events` stores consent event truth for granted and revoked events.

### Planning implication

- Feature 053 is primarily a protected read-model and UI visibility feature.
- Request lifecycle history and signed-consent history are already present in storage.
- A merged generic timeline is still unnecessary for the smallest coherent slice.

## Recommendation

Implement Feature 053 as a one-page enhancement to `/profiles` with a lazy-loaded inline detail panel for one expanded profile at a time.

Concrete decisions:

- No `/profiles/[profileId]` route in this cycle.
- Use an explicit `View details` / `Hide details` toggle, not row-click expansion.
- Allow only one expanded row at a time.
- Lazy load detail/history only for the expanded profile.
- Keep request history and baseline consent history as separate sections.
- Move nuanced baseline lifecycle actions into the expanded detail area.
- Keep the event table out of the protected UI for this slice.
- Cap visible history to the latest 20 rows per section.
- Show a compact signed snapshot summary only for baseline built-in fields that are already easy to explain; defer full signed field inspection.

This keeps the list-first workflow intact, reduces current row-action clutter, and avoids overfetching every profile's history on the main directory read.

## Chosen architecture

### Main page architecture

- Keep `src/app/(protected)/profiles/page.tsx` as the main server entry point.
- Keep `listRecurringProfilesPageData(...)` focused on collapsed-row data.
- Add a new bounded protected read endpoint for one profile's detail panel data.
- Fetch detail data from the client only when a row is expanded.

### Why this architecture

Option A: eagerly load full detail/history for every visible row.

- Reject for this cycle.
- The current page already loads all request and consent rows just to derive collapsed state.
- Adding full history payloads for every visible row would make the page heavier and make the table harder to evolve.

Option B: lazy load detail for the expanded profile only.

- Choose this option.
- Best fit for one-page UX with bounded payload size.
- Lets the collapsed table stay fast and summary-focused.
- Matches the current client-shell structure.

Option C: server-render expanded row state via query params.

- Defer.
- It adds navigation/state complexity without enough benefit for a one-row inspection pattern.
- It can remain available for a future dedicated detail route if later needed.

### New server read model

Add a dedicated helper, for example:

- `getRecurringProfileDetailPanelData({ supabase, tenantId, userId, profileId })`

This helper should:

- resolve profile access using the existing profiles access model
- load one tenant-scoped recurring profile
- load the profile's baseline request history
- load the profile's baseline consent history
- derive current summary and allowed actions from server truth
- return a UI-oriented payload sized for inline rendering

### New protected read route

Add a bounded protected route, for example:

- `GET /api/profiles/[profileId]/detail`

Route behavior:

- derive user and tenant server-side
- perform the same tenant scoping and role checks as other protected profile routes
- return only the expanded panel payload for one profile
- return `404` for invalid or cross-tenant profile ids

## Exact `/profiles` inline expansion model

### Expansion behavior

- Expansion is triggered by an explicit `View details` toggle in the row.
- The toggle becomes `Hide details` when expanded.
- Clicking other row actions must not implicitly expand the row.
- Only one profile stays expanded at a time.
- Expanding a different row collapses the previously expanded row.

### Rendering model

- Render the expanded detail as a second table row immediately below the selected profile row.
- The detail row uses `colSpan={7}` and contains a padded panel with stacked sections.
- Keep the existing table and `overflow-x-auto` behavior so narrow layouts still work.
- On mobile, detail sections should stack vertically inside the expanded panel rather than trying to preserve a multi-column card layout.

### State model

- Expansion state is client-only inside `ProfilesShell`.
- Do not reflect expansion state in query params in this cycle.
- Do not persist expansion across full page refresh.
- Keep a clean seam so a future `/profiles/[profileId]` route can be added later without breaking the panel's internal section structure.

## Exact scope boundary

### Collapsed row

Keep the collapsed row focused on overview:

- profile name
- type
- email
- baseline badge
- latest activity line
- profile status
- updated timestamp
- `View details` toggle
- profile archive action if that remains acceptable as a directory-level action

### Expanded detail

Move lifecycle inspection and nuanced baseline management into the inline panel:

- current baseline summary
- current pending request panel when applicable
- request history section
- baseline consent history section
- baseline lifecycle actions:
  - request baseline consent
  - copy baseline link
  - open link
  - cancel request
  - replace request

### What should move out of the collapsed row

- Current baseline request/create panels should no longer be the main row action UI.
- Pending link copy/open/cancel/replace should move into expanded detail.
- This is the key decluttering change for `/profiles`.

### What stays deferred

- dedicated detail route
- reminders and reminder scheduling
- specific or extra consent requests
- profile editing
- generic audit or export tooling
- generic merged timeline
- full signed structured-field inspection

## Exact responsibility split on `/profiles`

### Collapsed row responsibilities

- provide scan-friendly directory overview
- surface current baseline state at a glance
- show most recent activity summary in one line
- expose low-friction access to detail inspection
- preserve archive as an optional directory-level action

### Expanded detail responsibilities

- explain one profile's current baseline lifecycle clearly
- show enough recent history to manage safely
- host stateful baseline lifecycle actions
- give the operator the current pending link and its expiry without bouncing to another route

This split keeps `/profiles` as both overview and inspection surface while preventing every row from carrying full lifecycle controls by default.

## Exact history presentation model

Keep history in two separate sections. Do not flatten them into a generic timeline.

### Section 1: Request history

Purpose:

- show request lifecycle attempts and outcomes
- answer "what was requested, when, and what happened to that request?"

Ordering and cap:

- newest first
- cap to latest 20 rows

Statuses shown:

- pending
- signed
- expired
- cancelled
- superseded

Fields shown per row:

- status badge
- created at
- expires at
- latest lifecycle change timestamp
  - `updated_at` for cancelled and superseded
  - `expires_at` when effectively expired
  - signed time when request status is signed if the row already carries it indirectly through request status, otherwise use request `updated_at` as the lifecycle change line and keep signed truth in the consent section
- request email snapshot
- template name and version snapshot if available through joined template metadata

Presentation notes:

- show the active pending request at the top of this section and also in the current summary area when present
- if the profile has no requests, show a small empty state

### Section 2: Baseline consent history

Purpose:

- show actual signed baseline consents and revoke outcomes
- answer "what baseline consent is or was in force?"

Ordering and cap:

- newest first by effective activity
- cap to latest 20 rows

Fields shown per row:

- signed at
- revoked at if present
- email snapshot
- template name and version snapshot
- revoke availability status as read-only history text, not an action

Structured snapshot visibility:

- show a compact summary only for the built-in baseline fields already familiar from the recurring consent form:
  - scope
  - duration
- if a consent row lacks enough structured snapshot data for a compact summary, show no summary rather than attempting a partial generic renderer
- defer full signed field inspection, custom structured fields, and raw payload viewers

### Why the sections stay separate

- request rows describe attempts and operational transitions
- consent rows describe actual granted baseline consents and revoke state
- merging them would obscure the difference between a failed request and an active or revoked consent

## Exact current baseline summary and action placement

### Current baseline summary block

The top of the expanded panel should summarize current server-derived state:

- profile identity summary:
  - full name
  - email
  - type
  - archived/active state
- current baseline state badge
- latest baseline activity line

Then conditionally show one of:

- pending request summary:
  - request email snapshot
  - expires at
  - current consent link
- active signed baseline summary:
  - signed at
  - template name/version
  - email snapshot
  - compact scope/duration summary when available
- latest revoked baseline summary:
  - signed at
  - revoked at
  - template name/version
  - email snapshot
- no-history summary:
  - clear "no baseline request or signed baseline consent yet" copy

### Action placement

Place baseline lifecycle actions in the expanded panel only.

Recommended action rules:

- `Request baseline consent`
  - visible when current state is `missing` or `revoked`
  - disabled when profile is archived or user is read-only
- `Copy baseline link`
  - visible when there is an active pending request
- `Open link`
  - visible when there is an active pending request
- `Cancel request`
  - visible when there is an active pending request and profile is manageable
- `Replace request`
  - visible when there is an active pending request and profile is manageable

Collapsed row quick actions:

- keep only `View details`
- optionally keep `Archive profile` in the row because it is a directory action rather than a lifecycle detail action
- remove baseline request/copy actions from the collapsed row to reduce clutter

## Exact read-model and data-loading plan

### Main list read model changes

Refine `listRecurringProfilesPageData(...)` so it remains summary-oriented.

Recommended changes:

- keep profile list, filters, summary, type data, and baseline templates
- keep only the minimum request/consent data needed to derive collapsed-row state
- avoid adding full per-profile history arrays to the main page payload

If practical during implementation, this feature can also tighten the current directory query shape so the collapsed table does not fetch more recurring request/consent data than it needs. That optimization is in scope only if it stays low-risk.

### Detail read model payload

The detail helper should return:

- profile summary
- current baseline summary
- active pending request panel data if applicable
- request history items
- consent history items
- action capability flags
- archived/read-only state flags for disabling controls

### Data dependencies

The detail helper will likely need:

- recurring profile row
- recurring profile type row if assigned
- recurring baseline request rows for the profile
- recurring baseline consent rows for the profile
- template metadata for the request/consent rows shown in history

The event table should not be required for first-pass UI rendering.

### Refresh model after mutations

After create/cancel/replace:

- continue using server-backed mutation routes
- call `router.refresh()` so collapsed-row state is refreshed from server truth
- if the same row remains expanded, re-fetch its detail payload after refresh or trigger the detail request again from the expanded state effect

The UI must never trust locally mutated request history as final truth because sign/revoke/cancel/replace races can complete elsewhere.

## Event table usage boundary

- `recurring_profile_consent_events` remains backend audit truth.
- Feature 053 should not render a standalone event section.
- Event-derived details may still remain indirectly reflected through consent-row revoke state and request lifecycle state.
- If an implementation helper needs event rows for a correctness edge case, keep that internal and do not expose it as a third history panel in this cycle.

## Security and reliability considerations

- All reads remain server-side and tenant-scoped.
- Never accept `tenant_id` from the client.
- Reuse the current protected route conventions and error handling style.
- Keep role checks explicit:
  - read visibility should match the existing Profiles access model
  - lifecycle mutations remain owner/admin only
- Archived profiles remain viewable in history mode but baseline actions must be disabled.
- Expanded detail must tolerate stale state after:
  - public sign
  - public revoke
  - cancel
  - replace
  - archive
- Cross-tenant or invalid profile ids must resolve to `404` rather than leaking existence.
- Keep write operations idempotent where they already are today; Feature 053 should not redesign mutation semantics.

## Edge cases

- Archived profile with several old requests and consents:
  - show history
  - disable create/cancel/replace actions
- Pending request replaced while expanded:
  - expanded panel should refresh from server truth and show the new pending request plus superseded history row
- Pending request signed while expanded:
  - pending controls disappear after refresh
  - current summary becomes signed
- Revoked baseline followed by a new pending request:
  - current summary shows pending
  - revoked consent remains in consent history
- Profile with no history at all:
  - show empty request history and empty consent history states
- Long histories:
  - cap to latest 20 rows per section
  - defer pagination or "show all"
- Narrow/mobile layout:
  - collapsed table remains horizontally scrollable
  - expanded panel sections stack vertically
- Multiple open rows causing clutter:
  - avoid by enforcing a single expanded row at a time

## Test plan

Minimum meaningful coverage for Feature 053:

### Service and route tests

- `getRecurringProfileDetailPanelData(...)` returns tenant-scoped detail for one profile
- request history is ordered newest first and capped correctly
- consent history is ordered newest first and capped correctly
- archived profiles return history but no enabled lifecycle actions
- cross-tenant or invalid profile ids return not found behavior

### UI tests

- `/profiles` expands only one row at a time
- `View details` toggles the detail panel below the correct row
- current summary block reflects missing, pending, signed, and revoked states
- request history renders expected statuses and empty state
- consent history renders signed and revoked entries and empty state
- action visibility follows current state rules
- archived profiles render read-only detail actions

### Mutation-refresh tests

- after create/cancel/replace from the expanded panel, the UI refreshes from server truth
- stale pending controls disappear when the server state changes to signed or revoked

### i18n tests

- new section titles, labels, empty states, badges, and action text come from translation keys
- add English and Dutch messages for all new UI copy

## Implementation phases

1. Detail read model and protected read route
   - add the one-profile detail helper
   - add the protected `GET` route
   - add service and route tests

2. `/profiles` inline expansion state and panel shell
   - add `View details` toggle
   - enforce one expanded row at a time
   - lazy-fetch detail data for the expanded profile
   - move baseline lifecycle actions into the panel shell

3. Current summary and history sections
   - add current baseline summary block
   - add request history section
   - add baseline consent history section
   - add empty states and mobile-safe layout

4. Mutation integration and refresh behavior
   - wire create/cancel/replace actions into the expanded panel
   - refresh collapsed and expanded state from server truth after mutation
   - verify archived/read-only behavior

5. i18n and polish
   - add translation keys in `messages/en.json` and `messages/nl.json`
   - refine badges, helper text, and loading/error states
   - add UI tests for the new panel behavior

## Explicitly deferred follow-up cycles

- dedicated `/profiles/[profileId]` route
- reminder workflows
- specific or extra consent requests
- profile editing
- full signed structured-field inspection
- generic audit timeline
- history pagination, exporting, or reporting
- headshots, matching, or import/sync work in the recurring-profile module

## Concise implementation prompt

Implement Feature 053 on `/profiles` as a lazy-loaded inline detail panel for one expanded profile at a time. Keep the collapsed row summary-focused, move baseline lifecycle actions into the expanded panel, add a protected one-profile detail read model and route, render separate `Request history` and `Baseline consent history` sections capped at 20 items each, keep event-table UI deferred, preserve server-side tenant scoping and current mutation flows, disable actions for archived or read-only users, and add i18n keys plus focused tests for detail loading, action visibility, and refresh-after-mutation behavior.
