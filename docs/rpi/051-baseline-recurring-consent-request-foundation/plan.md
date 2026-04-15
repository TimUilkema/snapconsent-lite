# Feature 051 - Baseline Recurring Consent Request Foundation - Plan

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
10. `docs/rpi/042-structured-consent-template-fields/plan.md`

Live code and schema verified for plan-critical boundaries:

- `supabase/migrations/20260407213000_042_structured_consent_template_fields.sql`
- `tests/feature-042-structured-consent-template-fields.test.ts`
- `src/components/profiles/profiles-shell.tsx`
- `src/lib/tokens/public-token.ts`
- `src/lib/url/paths.ts`
- `src/lib/email/send-receipt.ts`
- `messages/en.json`

Additional live project consent flow behavior remains grounded in the Feature 051 research document and the current repository implementation referenced there.

## Verified current planning boundary

- Recurring profiles are already a live tenant-scoped directory from Feature 050.
- `/profiles` already enforces owner and admin management with photographer read-only access.
- Profile email is already required in the recurring-profile directory flow, which makes baseline request creation viable without a separate contact-capture step.
- The current project consent stack is built around project-specific tables and assumptions: `subject_invites`, `subjects`, `consents`, `revoke_tokens`, and `consent_events`.
- Public project sign and revoke flows are transaction-oriented and rely on token hash lookup plus SQL-backed idempotent submit and revoke semantics.
- Feature 042 already established the structured signed-data pattern:
  - `scope` and `duration` are built-in structured fields.
  - custom fields live in the same `structured_fields_definition`.
  - signed submitted values are stored together in one immutable `structured_fields_snapshot jsonb`.
  - validation already exists in SQL for submitted structured-field values.
- Current reusable UI/rendering pieces are mostly lower-level:
  - template layout rendering is reusable.
  - base-field validation patterns are reusable.
  - the current public invite form wrapper is too project-specific to reuse directly without bounded extraction.
- Current receipt sending and token derivation helpers are partly reusable in pattern only:
  - token hashing is reusable.
  - current invite token derivation is project-specific.
  - current receipt email sender is project-oriented and needs a recurring-specific counterpart.

## Recommendation

Implement Feature 051 as a new parallel recurring-profile consent domain. Reuse the existing template system, structured-field validation, layout rendering, signed snapshot pattern, token hashing, transaction style, and safe public submit/revoke patterns. Do not reuse project tables directly and do not generalize the project consent backend in this cycle.

Concrete plan decisions:

- Add new recurring-profile request, signed-consent, revoke-token, and event tables.
- Keep `consent_kind` now with a single allowed value of `baseline` to preserve future additive evolution without changing table shape later.
- Require explicit template selection per request in Feature 051. Do not add a default baseline template rule yet.
- Store one immutable `structured_fields_snapshot jsonb` on the signed recurring-consent row. Do not split built-ins like `scope` and `duration` into separate relational columns.
- Make protected request creation idempotent and concurrency-safe. Return the existing pending request when applicable instead of creating duplicates.
- Do not add replace or reminder workflows in this cycle.
- Make initial request delivery copy-link only. Do not add initial request email sending in Feature 051.
- Send a best-effort recurring receipt email after successful sign, after the DB transaction commits.

## Chosen architecture

### Domain boundary

Feature 051 adds a recurring-profile baseline consent domain parallel to the existing project invite domain:

- protected staff creation of a baseline consent request
- public tokenized recurring sign page
- immutable signed recurring-consent record
- public tokenized recurring revoke flow
- derived baseline status on `/profiles`

The project invite system remains unchanged.

### Service and route shape

- Protected write entrypoint:
  - `POST /api/profiles/[profileId]/baseline-consent-request`
- Public recurring sign entrypoints:
  - `GET /rp/[token]`
  - `POST /rp/[token]/consent`
- Public recurring revoke entrypoints:
  - `GET /rr/[token]`
  - `POST /rr/[token]/revoke`

Recommended implementation split:

- route handlers stay thin and consistent with the existing repo style.
- protected request creation lives in a recurring-profile consent service under `src/lib/profiles/`.
- public sign and public revoke continue to rely on security-definer SQL functions for token validation, transactional writes, and idempotent duplicate handling.
- lower-level shared helpers are extracted only where reuse is already clearly bounded, such as structured-field form parsing or reusable public layout rendering.

### `/profiles` boundary

Feature 051 should not introduce a full profile detail or consent-history page. The smallest workable UI remains the directory list page, with real baseline state and real row actions.

## Exact scope boundary

### Becomes real in Feature 051

- baseline request creation for a recurring profile
- tokenized public recurring sign flow
- immutable signed recurring-consent storage
- public revoke flow for recurring signed consent
- real baseline state derivation on `/profiles`
- real row-level baseline request and copy-link actions on `/profiles`
- best-effort recurring receipt email after sign

### Remains deferred

- extra or specific recurring consent requests
- reminders and reminder scheduling
- initial outbound email sending for baseline requests
- replace and supersede UI for pending requests
- recurring consent history or profile detail redesign
- reporting-oriented denormalization
- project consent backend unification

### Placeholder actions on `/profiles`

- `Request baseline consent` becomes live as a per-row action.
- `Send reminder` remains disabled and explicitly deferred.
- `Request extra consent`, `Import profiles`, and `Sync directory` remain deferred.

## Exact schema/model plan

### Common schema direction

All new tables are additive. All rows are tenant-scoped. All server-side write paths derive `tenant_id` from authenticated context or token lookup, never from client input.

To support tenant-safe composite foreign keys, add unique constraints where needed on `(id, tenant_id)` for referenced tables such as `recurring_profiles`, request rows, and signed recurring-consent rows.

### `recurring_profile_consent_requests`

Purpose: one baseline signing request row for one recurring profile and one selected published template.

Columns:

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null`
- `profile_id uuid not null`
- `consent_kind text not null check (consent_kind in ('baseline'))`
- `consent_template_id uuid not null`
- `profile_name_snapshot text not null`
- `profile_email_snapshot text not null`
- `token_hash text not null unique`
- `status text not null check (status in ('pending','signed','expired','superseded','cancelled'))`
- `expires_at timestamptz not null`
- `created_by uuid not null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`
- `superseded_by_request_id uuid null`

Constraints and indexes:

- foreign key `(profile_id, tenant_id)` -> `recurring_profiles(id, tenant_id)`
- foreign key `consent_template_id` -> `consent_templates(id)`
- optional self-reference on `superseded_by_request_id`
- unique partial index on `(tenant_id, profile_id, consent_kind)` where `status = 'pending'`
- index on `(tenant_id, profile_id, created_at desc)`

Decisions:

- Include `consent_kind` now even though only `baseline` exists.
- Enforce at most one active pending baseline request per profile at the DB level.
- Do not expose replace or supersede workflow in Feature 051.
- Keep `superseded` status and `superseded_by_request_id` in the schema for forward-compatible lifecycle modeling, but only `pending`, `signed`, `expired`, and `cancelled` are actively used in this cycle.
- Request creation returns the existing active pending request when one already exists.

### `recurring_profile_consents`

Purpose: immutable signed recurring baseline consent row created from a request.

Columns:

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null`
- `profile_id uuid not null`
- `request_id uuid not null`
- `consent_kind text not null check (consent_kind in ('baseline'))`
- `consent_template_id uuid not null`
- `profile_name_snapshot text not null`
- `profile_email_snapshot text not null`
- `consent_text text not null`
- `consent_version text not null`
- `structured_fields_snapshot jsonb not null`
- `signed_at timestamptz not null default now()`
- `capture_ip inet null`
- `capture_user_agent text null`
- `revoked_at timestamptz null`
- `revoke_reason text null`
- `receipt_email_sent_at timestamptz null`
- `created_at timestamptz not null default now()`

Constraints and indexes:

- foreign key `(profile_id, tenant_id)` -> `recurring_profiles(id, tenant_id)`
- foreign key `(request_id, tenant_id)` -> `recurring_profile_consent_requests(id, tenant_id)`
- unique on `request_id`
- partial unique index on `(tenant_id, profile_id, consent_kind)` where `revoked_at is null`
- check that revoked rows cannot predate `signed_at`

Decisions:

- Keep one active signed baseline per profile at the DB level by unique partial index.
- Do not add separate built-in columns for `scope` or `duration`.
- Do not add a separate top-level `template_snapshot` column.
- Continue to store the authoritative immutable signed field capture in `structured_fields_snapshot`, which already carries the signed template field definition and submitted values pattern from Feature 042.

### Structured snapshot storage recommendation

Chosen option: keep one `structured_fields_snapshot jsonb` aligned with Feature 042.

Reasoning:

- matches the current template and signing architecture
- keeps built-ins and custom fields under one signed immutable structure
- reduces implementation drift between project signing and recurring signing
- preserves exact signed field definitions and values without introducing parallel storage models
- reporting can be handled later through JSONB queries, views, or additive denormalization if needed

Rejected for Feature 051: split built-ins into dedicated columns plus JSONB for custom fields. That would increase validation and storage complexity without being required for the first recurring baseline workflow.

### `recurring_profile_consent_revoke_tokens`

Purpose: one revoke token per signed recurring baseline consent.

Columns:

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null`
- `consent_id uuid not null`
- `token_hash text not null unique`
- `expires_at timestamptz not null`
- `consumed_at timestamptz null`
- `created_at timestamptz not null default now()`

Constraints and indexes:

- foreign key `(consent_id, tenant_id)` -> `recurring_profile_consents(id, tenant_id)`
- unique on `consent_id`

Decision:

- Use the same bounded pattern as existing revoke links: hashed stored token, explicit expiry, one active revoke token per signed row.

### `recurring_profile_consent_events`

Purpose: immutable event log for recurring baseline consent state changes.

Columns:

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null`
- `consent_id uuid not null`
- `event_type text not null check (event_type in ('granted','revoked'))`
- `payload jsonb not null default '{}'::jsonb`
- `created_at timestamptz not null default now()`

Constraints and indexes:

- foreign key `(consent_id, tenant_id)` -> `recurring_profile_consents(id, tenant_id)`
- index on `(tenant_id, consent_id, created_at asc)`

Decision:

- Keep event history narrow in Feature 051. Request creation and cancellation are modeled on the request row itself and do not need a separate event table yet.

## Exact structured-field snapshot plan

Recurring baseline signing reuses the same template structured-field definition model from `consent_templates`.

Template requirements for request creation:

- template must belong to the tenant
- template must be published
- template must remain signable even if later archived, once already linked to a request
- template must expose the structured field definition expected by the existing signing stack

Submitted value handling:

- public recurring sign POST parses submitted structured values from form data using the same bounded parsing rules as the current project sign flow
- submitted values are validated server-side against the template definition
- validation continues to treat built-in `scope` and `duration` as part of the same structured definition as custom fields

Signed snapshot shape:

- recurring signed rows store `structured_fields_snapshot` in the same overall pattern used by Feature 042:
  - `schemaVersion`
  - `templateSnapshot`
  - `definition`
  - `values`

Representation inside the snapshot:

- `values.scope` stores the signed built-in scope selection payload
- `values.duration` stores the signed built-in duration selection payload
- custom template-defined fields are stored alongside those built-ins inside `values`
- `definition` contains the signed field-definition structure as it existed when signed
- `templateSnapshot` captures the template field metadata needed to reconstruct what was signed later

The signed recurring-consent row must capture actual signed values, not just a template reference. That is the immutable audit record.

## Exact baseline-state derivation plan

Feature 051 should derive a single baseline state per profile for `/profiles`.

State rules:

- `signed`
  - profile has an active baseline consent row with `revoked_at is null`
- `pending`
  - no active signed baseline exists
  - profile has a baseline request row in `pending`
  - request is not expired
- `revoked`
  - no active signed baseline exists
  - no active pending baseline request exists
  - latest baseline consent row is revoked
- `missing`
  - none of the above

Precedence:

- `signed` overrides `pending`
- `pending` overrides `revoked`
- `revoked` overrides `missing`

Lifecycle consequences:

- if a revoked baseline exists and a new baseline request is issued, state becomes `pending`
- if a new baseline is signed after a prior revoked baseline, state becomes `signed`
- only one active pending request per profile is allowed
- only one active signed baseline per profile is allowed

`/profiles` should surface:

- baseline state badge
- small secondary latest-activity text in the same cell, such as signed date, revoked date, or pending expiry

No separate baseline summary cards are required in this cycle.

## Exact protected request-creation plan

### Route

- `POST /api/profiles/[profileId]/baseline-consent-request`

### Auth and authorization

- authenticated tenant member required
- owner or admin only
- photographer remains read-only
- tenant resolved server-side from auth and profile lookup

### Request body

- `consentTemplateId`

Decision:

- explicit template selection is required now
- do not introduce a default baseline template rule in Feature 051

### Idempotency

- `Idempotency-Key` header is required
- protected request creation stores or derives a stable result per tenant, profile, baseline kind, and idempotency key
- if the same request is retried after a lost response, the handler returns the same pending request result

### Create semantics

The protected service should, inside a transaction:

1. load the profile in the current tenant and reject archived profiles
2. verify owner or admin permission
3. validate the selected template belongs to the tenant and is published
4. opportunistically expire stale pending requests for the profile
5. if an active signed baseline exists, return a conflict and instruct the UI to show signed state instead of creating another request
6. if an active pending baseline request exists, return it instead of creating a duplicate
7. otherwise create a new pending request row with a deterministic public token derived from the new request id, store only the token hash, and return the copyable public URL

Decision:

- Feature 051 supports create and copy-existing-link only
- replace, cancel, and supersede actions are deferred

## Exact public sign flow plan

### Routes

- `GET /rp/[token]`
- `POST /rp/[token]/consent`

### Route behavior

GET should:

- hash the token server-side
- load the pending recurring request through a security-definer SQL function
- verify request status, expiry, and non-archived profile state
- load the linked template snapshot data needed for rendering
- render a recurring-specific public page wrapper using reusable layout and field-rendering components

POST should:

- re-validate token, request state, template state, and profile state inside SQL
- validate submitted base fields and structured field values
- create the signed recurring-consent row
- mark the request as `signed`
- create the revoke token row
- insert a `granted` event row
- return the signed result idempotently if the submit is retried

### Duplicate submit behavior

- duplicate public submits for the same valid request must safely return the already-created signed result
- no second recurring-consent row should be created for the same request

### Invalid link behavior

Recurring public sign pages should explicitly handle:

- invalid token
- expired request
- cancelled request
- superseded request
- already signed request
- archived profile

These states should render recurring-specific public status messaging through i18n keys, not generic crashes or raw DB errors.

### UI reuse boundary

- reuse the current template lookup, layout rendering, base-field validation patterns, and structured-field rendering/validation helpers
- do not reuse the current invite-specific `PublicConsentForm` wrapper unchanged because it hardcodes project invite route assumptions and project-specific UI behavior
- extract only the reusable inner pieces needed for recurring form rendering

## Exact public revoke flow plan

### Routes

- `GET /rr/[token]`
- `POST /rr/[token]/revoke`

### Behavior

GET should:

- hash the revoke token
- load the recurring signed consent through a security-definer SQL function
- validate token existence, expiry, and unconsumed status
- render a recurring-specific revoke confirmation page

POST should:

- re-validate token inside SQL
- mark the revoke token consumed
- set `revoked_at` and optional `revoke_reason` on the recurring signed-consent row
- insert a `revoked` event row
- return an idempotent revoked result when the same valid token is retried

### Consumed and invalid token behavior

- already consumed token should show an already-revoked outcome, not a server error
- expired token should render an expired state
- invalid token should render a not-found or invalid-link state

## Exact reuse boundary

### Reuse directly or with bounded extraction

- template lookup against `consent_templates`
- published-template validation rules
- structured-field definition model from Feature 042
- structured-field submitted-value validation
- layout rendering components
- base-field validation helpers
- token hashing helper
- SQL transaction style for public submit and revoke
- safe error shaping for public flows
- receipt-email sending infrastructure pattern

### Keep separate from project-specific backend

- `subject_invites`
- `subjects`
- `consents`
- `revoke_tokens`
- `consent_events`
- invite-token derivation tied to project and idempotency-key semantics
- project-specific RPCs and public route naming
- project-specific invite form wrapper and headshot-related behavior

## Exact `/profiles` page evolution

Feature 051 should keep the current directory-first shape and make baseline state real on the list page.

Recommended UI changes:

- add a real `Baseline consent` column to the profiles table
- show state badge plus secondary activity text
- for `missing` or `revoked` active profiles, show `Request baseline consent`
- for `pending` active profiles, show `Copy baseline link`
- for `signed`, show status only and no baseline-request action
- for archived profiles, baseline actions remain unavailable

Interaction shape:

- use a lightweight per-row expander or inline panel for template selection and request creation
- do not introduce a full-screen modal or new detail page for this cycle
- reuse existing row action patterns where possible

Deferred UI:

- `Send reminder` stays disabled
- no baseline-history drawer
- no list summary cards for baseline states in this cycle

## Receipt and delivery behavior

Feature 051 should create a baseline request and return a copyable public link only.

Decision:

- do not attempt initial request email sending in Feature 051
- after successful sign, attempt a best-effort recurring-specific receipt email that includes revoke information
- receipt sending happens after the signed DB transaction commits
- receipt failure must not roll back signing; log it and leave `receipt_email_sent_at` unset

## i18n plan

Feature 051 must use the existing i18n framework.

Requirements:

- no new hardcoded inline UI strings
- add new translation keys to `messages/en.json` and `messages/nl.json`
- localize all new UI chrome, labels, helper text, validation copy, empty states, status copy, public page titles, action labels, and error states
- do not translate stored template text, tenant-created profile values, or tenant-authored consent content

## Security and reliability considerations

- tenant is always derived server-side
- no client-provided tenant ids are trusted
- protected create flow is owner/admin only
- public sign and revoke stay SQL-backed and atomic
- duplicate public submit is safe and idempotent
- duplicate protected create is safe under retries and concurrency
- unique pending-request and active-signed-consent constraints are enforced at the DB level
- archived templates already linked to a request remain signable
- archived profiles cannot receive new requests
- archiving a profile should cancel any active pending baseline request in the same protected archival transaction or service flow
- stale pending requests should be treated as expired during read and create paths even without a scheduler
- receipt send is best-effort after commit

## Edge cases

- duplicate protected create after lost response returns the same pending request
- concurrent protected creates for the same profile collapse to one pending request through transaction logic plus DB uniqueness
- duplicate public submit returns the already-created signed result
- invalid, expired, cancelled, superseded, or already-signed request links render explicit recurring-specific states
- revoked baseline followed by a new request produces `pending`
- archived template after request issuance does not invalidate signing for that request
- stale `/profiles` state is corrected on refetch after create, sign, revoke, or archive actions
- receipt email failure does not affect signed record durability
- profile archived while a request is pending makes that request unusable and should cancel it server-side

## Test plan

Minimum test surface for Feature 051:

- migration tests for new tables, checks, and partial unique indexes
- schema tests for tenant-safe composite foreign keys
- tests that only one pending baseline request can exist per profile
- tests that only one active signed baseline can exist per profile
- tests that `structured_fields_snapshot` is required and stores the expected Feature 042-style shape
- service tests for protected create idempotency and concurrency
- service tests for create conflict when an active signed baseline exists
- service tests for baseline-state derivation
- public sign tests for duplicate submit handling
- public sign tests for invalid, expired, cancelled, and already-signed links
- public sign tests proving archived linked templates remain signable
- public revoke tests for invalid, expired, and consumed tokens
- public revoke tests for event logging and idempotent outcome
- route tests for owner/admin versus photographer access
- `/profiles` rendering tests for real baseline state and row actions
- i18n-backed rendering tests where new UI states depend on translated copy

## Implementation phases

1. Schema and SQL foundation
   - add new recurring consent tables, constraints, indexes, and RLS or security-definer functions
   - add tenant-safe composite uniqueness where required
2. Protected request creation
   - implement service helper and `POST /api/profiles/[profileId]/baseline-consent-request`
   - add deterministic recurring request token derivation and path helpers
3. Public recurring sign flow
   - implement recurring public request page and submit route
   - extract bounded shared form and structured-field helpers as needed
   - add best-effort recurring receipt send path
4. Public recurring revoke flow and `/profiles` integration
   - implement recurring revoke page and submit route
   - derive real baseline state in profile directory data
   - wire row-level request and copy-link UI
5. Tests and polish
   - add schema, service, route, and UI coverage
   - finish i18n messages and error-state polish

## Explicitly deferred follow-up cycles

- baseline request replacement and supersede UI
- reminder sending and reminder scheduling
- initial outbound request email delivery
- recurring consent history page
- extra or specific recurring consent request types
- reporting-focused denormalized baseline metrics
- project or recurring consent backend unification

## Concise implementation prompt

Implement Feature 051 as a parallel recurring-profile baseline consent domain. Add additive schema for recurring baseline request rows, signed recurring-consent rows, revoke tokens, and consent events. Reuse the existing `consent_templates` system, Feature 042 structured-field validation and signed snapshot pattern, public token hashing, layout rendering, and SQL-backed idempotent public submit and revoke semantics. Add protected owner/admin-only baseline request creation at `POST /api/profiles/[profileId]/baseline-consent-request` with explicit template selection, required `Idempotency-Key`, copy-link-only delivery, and one active pending baseline request per profile. Add recurring public sign routes at `/rp/[token]` and `/rp/[token]/consent`, recurring public revoke routes at `/rr/[token]` and `/rr/[token]/revoke`, best-effort recurring receipt sending after sign, and real baseline state plus row-level actions on `/profiles`. Keep the current project invite/consent backend unchanged, keep built-in `scope` and `duration` inside one immutable `structured_fields_snapshot jsonb`, and defer reminders, request replacement, initial outbound email, extra consent types, and profile history redesign.
