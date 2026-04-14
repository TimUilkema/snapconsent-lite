# Feature 049 Plan: Profiles Module Shell and Information Architecture

## Scope

This plan covers the first implementation slice of a broader recurring-profiles module:

- add a protected `Profiles` module entry point
- add a protected `/profiles` page
- establish page structure, copy, placeholders, and permission-aware shell behavior

This slice does not introduce the recurring-profile backend domain yet. It creates a real home for that domain in the protected app without implying that consent requests, reminders, import, or sync already work.

## Inputs and ground truth

### Required docs re-read

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/049-recurring-profiles-and-consent-management-foundations/research.md`

### Targeted live verification

- `src/app/(protected)/layout.tsx`
- `src/components/navigation/protected-nav.tsx`
- `src/app/(protected)/projects/page.tsx`
- `src/app/(protected)/templates/page.tsx`
- `src/app/(protected)/dashboard/page.tsx`
- `src/lib/tenant/resolve-tenant.ts`
- `src/lib/templates/template-service.ts`
- `messages/en.json`
- `messages/nl.json`
- `tests/feature-046-template-editor-live-preview-layout.test.ts`
- `tests/helpers/supabase-test-client.ts`

## Verified current planning boundary

- Protected auth and tenant bootstrapping already live in `src/app/(protected)/layout.tsx`.
- Primary nav lives in `src/components/navigation/protected-nav.tsx` and currently exposes `Dashboard`, `Projects`, and `Templates`.
- Template management already distinguishes `owner` and `admin` from `photographer` through server-side membership checks in `src/lib/templates/template-service.ts`.
- Protected list pages are server-rendered and use the existing `app-shell` and `content-card` layout patterns.
- Locale strings for nav and page copy live in `messages/en.json` and `messages/nl.json`.
- No recurring-profile schema, routes, or services exist yet.

Planning consequence:

- this slice should be a protected server-rendered page
- it should reuse the current protected layout and visual language
- it should not add fake APIs, fake persistence, or temporary schema

## Recommendation

Implement a shell-only `Profiles` module now, with real navigation and a real protected page, but no recurring-profile database tables yet.

Recommended product posture for this slice:

- `Profiles` is a new parallel module, separate from project or event consent
- the page is visible to all authenticated tenant members
- `owner` and `admin` see management-oriented placeholders
- `photographer` sees the shell in read-only mode
- all actions that would create data or send requests remain disabled or non-interactive

This gives the product a stable module surface without forcing premature backend commitments.

## Chosen architecture

### Route and layout

Add:

- `src/app/(protected)/profiles/page.tsx`

Reuse:

- `src/app/(protected)/layout.tsx` for auth and tenant bootstrap
- `src/components/navigation/protected-nav.tsx` for the primary nav surface
- existing page-shell classes such as `app-shell` and `content-card`

### Nav placement

Add `Profiles` to the protected nav between `Projects` and `Templates`.

Recommended order:

- `Dashboard`
- `Projects`
- `Profiles`
- `Templates`

Reasoning:

- `Profiles` is a core operational module, not a settings screen
- it should sit near `Projects`, while staying visibly distinct from project-scoped consent

### Data and rendering model

Use a fully server-rendered shell page with a small server-side view model.

Recommended page inputs:

- real server-derived membership role
- real server-derived capability flags:
  - `canViewProfiles`
  - `canManageProfiles`
- static shell metadata for cards, filters, columns, and placeholder actions

Do not add:

- schema reads for non-existent recurring-profile tables
- client-side fake state
- placeholder mutation routes
- optimistic UI

This is a server-driven stub pattern, not a fake data pattern.

### Permission-aware rendering

Add a small server-side access helper for the new module rather than reusing template-specific logic.

Recommended access model for this slice:

- `owner`: can view, can manage
- `admin`: can view, can manage
- `photographer`: can view, cannot manage

If membership lookup fails or returns no role, treat the page as unauthorized and redirect to `/projects`.

Reasoning:

- read-only visibility is useful for future project-adjacent staff awareness
- management remains aligned with the existing owner/admin pattern
- access stays server-authoritative

## Exact scope boundary

### In scope

- protected nav entry for `Profiles`
- protected `/profiles` page
- translated page title and explainer copy
- summary cards with placeholder counts
- disabled search and filter scaffold
- empty list or table scaffold
- empty state messaging
- placeholder CTA and row-action affordances
- read-only versus manage-capable shell rendering

### Visible but placeholder-only

- `Create profile`
- `Request baseline consent`
- `Resend baseline request`
- `Send reminder`
- `Request extra consent`
- `Archive profile`
- `Import profiles`
- `Sync directory`

### Explicitly out of scope

- recurring-profile schema
- recurring consent request schema
- recurring signed-consent schema
- public signing links for recurring profiles
- revoke handling for recurring-profile consent
- profile detail pages
- reminder backend
- import backend
- directory sync backend
- multiple headshots
- CompreFace or external profile matching integration
- project-linking behavior

## Exact UI and information architecture plan

### Page title and explainer

Title:

- `Profiles`

Primary explainer copy:

- recurring profiles are reusable people records for ongoing consent relationships
- baseline consent tracking here is separate from one-off project invites
- manual creation is the intended first entry mode in later slices

A short secondary note should explicitly say:

- project and event invite consent remains under `Projects`

### Header actions

For `owner` and `admin`:

- show a disabled primary `Create profile` button
- show a small inline note: `Manual creation arrives in the next slice.`

For `photographer`:

- hide the management CTA
- show a read-only note: `Profiles will be visible here once the directory foundation is added.`

### Summary cards

Show four compact summary cards:

- `Total profiles`
- `Baseline signed`
- `Baseline pending`
- `Needs follow-up`

Card values in this slice:

- display `0`
- include subdued helper text such as `No live profile data yet`

`Needs follow-up` should be the planned combined bucket for missing or revoked baseline consent, but in this slice it remains a shell-only label.

### Search and filter row

Render a disabled toolbar with:

- search input with placeholder `Search name or email`
- baseline status filter placeholder with options:
  - `All`
  - `Signed`
  - `Pending`
  - `Missing`
  - `Revoked`
- profile type filter placeholder labeled `Type`
- archived toggle placeholder labeled `Include archived`

All controls remain disabled in this slice.

Reasoning:

- the layout becomes legible now
- no client-side fake filtering logic is introduced

### Table scaffold

Render a standard table shell with these columns:

- `Name`
- `Type`
- `Email`
- `Baseline status`
- `Latest request`
- `Last consent activity`
- `Actions`

Initial body behavior:

- render no real rows
- render one empty-state row spanning all columns

Empty-state content should explain:

- this module is for recurring profiles managed at the tenant level
- baseline consent status will be tracked here later
- project invite consent is unchanged and still lives under `Projects`

### Empty-state actions and future action preview

Inside the empty state:

- show a disabled `Create profile` button for owner/admin
- show a disabled `Request baseline consent` button for owner/admin
- show a short read-only hint for photographer instead of buttons

Also show a compact `Planned profile actions` strip with disabled low-emphasis controls:

- `Resend baseline request`
- `Send reminder`
- `Request extra consent`
- `Archive profile`

This satisfies the shell requirement without pretending any row-level actions are live.

### Import and sync placement

Do not place `Import profiles` or `Sync directory` in the primary header action group.

Instead, render them in a secondary deferred section near the bottom of the page:

- section title: `Deferred foundation work`
- disabled buttons:
  - `Import profiles`
  - `Sync directory`
- small note:
  - bulk import and external directory sync are planned later and are not part of the initial foundation

Reasoning:

- users can see the intended expansion points
- the page does not imply these are part of the current foundation

### Right-side panel, modal, or inline detail behavior

Do not add:

- right-side detail panel
- modal triggers
- inline expansion rows

Keep this first slice to one page with static sections and disabled placeholders.

## Exact placeholder action plan

| Action | Visible now | State | Behavior in this slice | Reason |
| --- | --- | --- | --- | --- |
| `Create profile` | Yes for owner/admin | Disabled | No mutation, no modal | Manual creation is the next real backend cycle and should not be faked |
| `Request baseline consent` | Yes for owner/admin in empty state | Disabled | No request generation | A request flow requires a real profile and request model |
| `Resend baseline request` | Yes in planned-actions strip | Disabled | No behavior | Avoid implying delivery or request existence |
| `Send reminder` | Yes in planned-actions strip | Disabled | No behavior | Reminder workflows are explicitly deferred |
| `Request extra consent` | Yes in planned-actions strip | Disabled | No behavior | Specific consent requests require the parallel recurring-consent domain |
| `Archive profile` | Yes in planned-actions strip | Disabled | No behavior | Archiving needs a real profile record |
| `Import profiles` | Yes in deferred section | Disabled | No behavior | Import is intentionally deferred and should stay low-emphasis |
| `Sync directory` | Yes in deferred section | Disabled | No behavior | External sync is intentionally deferred and should stay low-emphasis |

Implementation note:

- use native disabled buttons or clearly non-interactive controls
- do not fire placeholder toasts
- do not show success states for non-existent actions

## Profile type handling in the shell

Recommended approach:

- visually anticipate a `Type` concept now
- treat it only as future lightweight metadata
- do not create a configurable type system in this slice
- do not let type drive workflow, validation, or permission logic

Concrete shell choices:

- include a `Type` table column
- include a disabled `Type` filter control
- do not hardcode tenant-defined type management UI
- do not pre-seed opinionated type values into the shell

Reasoning:

- the information architecture leaves room for employee, volunteer, consultant, member, ambassador, or similar labels later
- the first slice stays generic and does not overfit one customer pattern

## Security and reliability considerations

- Keep the route protected under `(protected)`.
- Keep tenant and role resolution server-side.
- Do not accept or trust client-provided tenant identifiers.
- Do not add any client-side business logic that implies real consent operations.
- Do not add placeholder APIs or server actions for non-existent mutations.
- Keep permission handling predictable:
  - owner/admin: manage-oriented shell
  - photographer: read-only shell
- Make disabled actions visibly unavailable so the UI does not imply emails were sent or requests were created.
- Keep copy explicit that recurring profiles are separate from project invite consent.

## Migration and compatibility story

Recommended answer:

- no schema changes in this slice
- no new migrations

Why this is safe:

- the page is a protected UI surface only
- it relies only on existing auth, membership, layout, and i18n foundations
- it does not create temporary data models that later need removal

Why it is not throwaway UI:

- route, nav placement, access helper, page copy, filters, columns, and action grouping all match the intended recurring-profile product model
- later cycles can replace placeholder counts and empty-state sections with real server data without changing the module structure

## Edge cases

- Tenant has no profiles yet: show the normal empty state. This will also be the only state in this slice.
- User is a photographer: allow page access, show read-only explanatory shell, suppress manage CTA.
- Membership lookup fails: redirect away rather than rendering an ambiguous partial page.
- Disabled actions must not show toasts, modals, or loading spinners.
- `Import profiles` and `Sync directory` must read as deferred, not half-supported.
- Future rows added later should fit the existing columns without redesigning the page shell.
- If future nested routes such as `/profiles/[profileId]` are added, nav active-state logic should already treat `/profiles/*` as active.

## Test plan

Minimum test surface for this shell cycle:

1. Nav behavior
   - update active-path coverage so `/profiles` and future nested `/profiles/...` routes are treated as active
   - verify the protected nav includes `Profiles`

2. Access helper behavior
   - verify `owner` and `admin` resolve to manage-capable access
   - verify `photographer` resolves to read-only access

3. Shell rendering
   - render the empty `Profiles` shell for a manage-capable user and verify:
     - page title and explainer copy
     - summary cards
     - disabled filter row
     - empty-state section
     - disabled placeholder actions
   - render the shell for a read-only user and verify:
     - read-only note appears
     - manage CTA does not appear

4. Compatibility
   - no migration test required because this slice introduces no schema changes

Implementation-friendly testing shape:

- extract pure renderable subcomponents where needed and verify with `renderToStaticMarkup`
- keep membership access logic testable without spinning up full Next routing

## Implementation phases

1. Navigation and access
   - add the `Profiles` nav item
   - add a small server-side access helper for recurring-profile shell permissions
   - update active-path handling for `/profiles`

2. Protected page shell
   - add `src/app/(protected)/profiles/page.tsx`
   - add translated page copy in `messages/en.json` and `messages/nl.json`
   - render the page header, explainer, summary cards, filter row, table scaffold, and empty state

3. Permission-aware placeholders
   - add owner/admin versus photographer rendering differences
   - add disabled action groups for create, request, reminder, archive, import, and sync
   - add the explicit deferred-work section for import and sync

4. Tests and polish
   - add nav and access tests
   - add shell render coverage
   - confirm no placeholder control implies a successful mutation

## Explicitly deferred follow-up cycles

- recurring profile directory foundation with real schema and manual create flow
- baseline recurring consent request foundation with tokenized public signing
- recurring-profile detail page and history timeline
- resend and replace request behavior
- targeted extra-consent requests
- reminder and delivery-attempt tracking
- bulk import
- external directory sync
- profile-to-project linking
- multiple headshots per profile
- future CompreFace or external profile identity integration

## Concise implementation prompt

Implement the first shell-only slice of Feature 049.

Add a protected `Profiles` nav item and a protected `/profiles` page that is fully server-rendered, uses the existing protected layout, and introduces no schema changes. The page should clearly present recurring profiles as a tenant-level module separate from project invite consent, show placeholder summary cards, disabled search and filter controls, an empty table scaffold, and permission-aware placeholder actions. `Owner` and `admin` should see manage-oriented disabled controls, while `photographer` should see a read-only shell. Show `Import profiles` and `Sync directory` only as low-emphasis disabled deferred actions, not as primary CTAs. Add matching locale strings and the minimum tests for nav, access, and shell rendering.
