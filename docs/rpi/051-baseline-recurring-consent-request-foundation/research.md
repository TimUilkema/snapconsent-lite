# Feature 051 Research: Baseline Recurring Consent Request Foundation

## Scope

Research the first real consent workflow inside the recurring profiles module:

- issue a baseline consent request for a recurring profile
- let the person sign through a tokenized public flow
- create an immutable signed recurring-consent record
- support revoke flow for that recurring signed record
- derive the profile's baseline consent state from real records

This research is code-first. Live schema, routes, helpers, components, and migrations are the source of truth. Features 049 and 050 define the recurring-profile module boundary, but do not override the live implementation.

## Inputs reviewed

### Required repo docs

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`

### Prior recurring-profile RPI docs

- `docs/rpi/049-recurring-profiles-and-consent-management-foundations/research.md`
- `docs/rpi/049-recurring-profiles-and-consent-management-foundations/plan.md`
- `docs/rpi/050-recurring-profile-directory-foundation/research.md`
- `docs/rpi/050-recurring-profile-directory-foundation/plan.md`

### Live recurring-profile implementation verified

- `supabase/migrations/20260414170000_050_recurring_profile_directory_foundation.sql`
- `src/app/(protected)/profiles/page.tsx`
- `src/components/profiles/profiles-shell.tsx`
- `src/lib/profiles/profile-access.ts`
- `src/lib/profiles/profile-directory-service.ts`
- `src/lib/profiles/profile-route-handlers.ts`
- `src/app/api/profiles/route.ts`
- `src/app/api/profiles/[profileId]/archive/route.ts`
- `src/app/api/profile-types/route.ts`
- `src/app/api/profile-types/[profileTypeId]/archive/route.ts`

### Live project consent flow, template, and revoke implementation verified

- `supabase/migrations/20260304210000_002_projects_invites_schema.sql`
- `supabase/migrations/20260304211000_002_projects_invites_rls.sql`
- `supabase/migrations/20260304212000_002_projects_invites_idempotency.sql`
- `supabase/migrations/20260305100000_003_consent_templates_schema.sql`
- `supabase/migrations/20260305103000_003_consent_templates_submit.sql`
- `supabase/migrations/20260305000100_fix_submit_public_consent_ambiguity.sql`
- `supabase/migrations/20260305123000_fix_submit_public_consent_for_update.sql`
- `supabase/migrations/20260407150000_039_consent_form_template_editor.sql`
- `supabase/migrations/20260407213000_042_structured_consent_template_fields.sql`
- `supabase/migrations/20260410150000_046_template_editor_live_preview_layout.sql`
- `supabase/migrations/20260410210000_template_duration_options_and_public_invite_name.sql`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/app/api/projects/[projectId]/invites/route.ts`
- `src/app/api/projects/[projectId]/invites/[inviteId]/revoke/route.ts`
- `src/app/api/projects/[projectId]/default-template/route.ts`
- `src/app/i/[token]/page.tsx`
- `src/app/i/[token]/consent/route.ts`
- `src/app/r/[token]/page.tsx`
- `src/app/r/[token]/revoke/route.ts`
- `src/components/projects/create-invite-form.tsx`
- `src/components/projects/invite-actions.tsx`
- `src/components/public/public-consent-form.tsx`
- `src/components/consent/consent-form-layout-renderer.tsx`
- `src/components/projects/consent-structured-snapshot.tsx`
- `src/lib/invites/public-invite-context.ts`
- `src/lib/consent/submit-consent.ts`
- `src/lib/consent/revoke-consent.ts`
- `src/lib/consent/validate-consent-base-fields.ts`
- `src/lib/idempotency/invite-idempotency.ts`
- `src/lib/templates/template-service.ts`
- `src/lib/templates/structured-fields.ts`
- `src/lib/templates/form-layout.ts`
- `src/lib/templates/template-preview-validation.ts`
- `src/lib/http/errors.ts`
- `src/lib/tenant/resolve-tenant.ts`
- `src/lib/tokens/public-token.ts`
- `src/lib/url/paths.ts`
- `src/lib/email/send-receipt.ts`

## Verified current live boundary

### 1. Feature 050 is live as a real tenant-scoped directory, not a consent workflow

Current recurring-profile module facts:

- `recurring_profile_types` and `recurring_profiles` are live tenant-scoped tables.
- `/profiles` is a protected server-rendered directory page.
- owner/admin can create and archive profiles and profile types.
- photographer is read-only.
- profile email is currently required in live code and schema.
- the page still treats consent actions as deferred placeholders.

Current implication:

- Feature 051 should build on a real recurring-profile directory.
- There is still no recurring-profile consent request, signed-consent, revoke-token, or event table.

### 2. The current signing domain is explicitly project-invite based

The live project consent model is:

- `projects`
- `subject_invites`
- `subjects`
- `consents`
- `revoke_tokens`
- `consent_events`

Important live constraints:

- `subject_invites.project_id` is required.
- `subjects.project_id` is required.
- `subjects` are unique by `(tenant_id, project_id, email)`.
- `consents.project_id`, `subject_id`, and `invite_id` are all required.
- `consents` are unique by `invite_id`.
- `revoke_tokens` are unique by `consent_id`.
- `consent_events` attach to `consent_id`.

Current implication:

- a subject is a project-local signer record, not a tenant-wide recurring person
- a consent is the signed result of one project invite
- revoke tokens and consent events are tied to that project consent record

### 3. Current public signing is RPC-backed and transaction-oriented

The live public project flow is:

1. `src/app/i/[token]/page.tsx` calls `public.get_public_invite`.
2. The RPC resolves `subject_invites` by hashed token and joins `projects` plus `consent_templates`.
3. The page renders `PublicConsentForm`.
4. `src/app/i/[token]/consent/route.ts` validates base fields, parses structured values from `FormData`, then calls `submitConsent(...)`.
5. `src/lib/consent/submit-consent.ts` calls `public.submit_public_consent`.
6. The RPC locks the invite row, validates token availability, validates structured fields, upserts the project-scoped `subjects` row, inserts `consents`, inserts `revoke_tokens`, writes a `granted` consent event, updates invite usage, and returns an existing consent on duplicate submit.

This matters for Feature 051 because the public submit path already depends on atomic row locking and duplicate-submit handling inside SQL, not on multi-step TypeScript writes.

### 4. Current public revoke is also consent-row specific

The live revoke flow is:

- `src/app/r/[token]/page.tsx` renders a public revoke form.
- `src/app/r/[token]/revoke/route.ts` calls `revokeConsentByToken(...)`.
- `src/lib/consent/revoke-consent.ts` calls `public.revoke_public_consent`.
- the RPC locks `revoke_tokens`, expires or rejects invalid tokens, marks the token consumed, updates `consents.revoked_at`, and writes a `revoked` event.

Current implication:

- revoke semantics are reusable as a pattern
- the live table and RPC shape are still tied to project `consents`

There is also a separate protected pending-invite removal path:

- `src/app/api/projects/[projectId]/invites/[inviteId]/revoke/route.ts` only revokes unused active invites
- it refuses invites that have already been used or are already inactive

Current implication:

- the live app already distinguishes "invalidate a pending request" from "revoke an already signed consent"
- Feature 051 should preserve that distinction in the recurring-profile domain instead of conflating them

### 5. Template lookup, rendering, structured validation, and snapshots are already reusable

Reusable live building blocks:

- `consent_templates` is a versioned signable source with immutable published and archived rows
- `src/lib/templates/template-service.ts` already resolves visible published templates per tenant
- `public.get_public_invite` already treats archived template rows as signable for already-issued links
- `src/lib/templates/structured-fields.ts` normalizes definitions and submitted values
- `src/lib/templates/form-layout.ts` normalizes layout and computes fallback layout
- `ConsentFormLayoutRenderer` already renders a layout-driven public consent form
- `submit_public_consent` already snapshots structured values as `{ templateSnapshot, definition, values }`

Current implication:

- recurring baseline consent should reuse `consent_templates`
- recurring signing should reuse the same structured-field and layout machinery
- recurring signed records should preserve the current snapshot pattern

### 6. Current public form component reuse has a limit

`src/components/public/public-consent-form.tsx` is only partially reusable:

- it is good at rendering name, email, structured fields, consent text, and acknowledgement
- it hardcodes project invite submit path `/i/[token]/consent`
- it hardcodes headshot upload endpoints under `/api/public/invites/[token]/headshot`
- it carries face-match and headshot upload behavior that Feature 051 does not need

Recommendation implication:

- reuse the renderer and field helpers
- do not reuse the current invite-specific public form wrapper unchanged

### 7. Current protected create flow and idempotency conventions are clear

Current protected route pattern:

- authenticate first
- resolve tenant server-side with `resolveTenantId(...)`
- validate body and headers in the route
- delegate to a service
- shape failures with `HttpError` and `jsonError`

Current idempotency pattern:

- `idempotency_keys` is tenant-scoped and keyed by `(tenant_id, operation, idempotency_key)`
- project invite creation uses `createInviteWithIdempotency(...)`
- template and recurring-profile creates also use the same pattern

Current implication:

- protected baseline-request creation should follow the same route and idempotency conventions

### 8. `/profiles` is ready for real baseline status, but not for a detail workflow yet

Current `/profiles` facts:

- it already lists real profile rows
- it already has owner/admin mutation affordances
- baseline actions are still disabled placeholders
- there is still no `/profiles/[profileId]` detail page

Current implication:

- Feature 051 can make baseline status real on the list page
- Feature 051 should stay list-first and avoid requiring a full detail/history page unless absolutely necessary

## Options considered

### Option A: Reuse `subject_invites`, `subjects`, and `consents` directly

Examples:

- issue baseline consent through `subject_invites`
- write signed baseline records into `consents`
- use fake or hidden projects to satisfy required foreign keys

Why it fails against live code:

- `subjects` and `consents` are structurally project-scoped
- current matching, headshot, export, and project detail screens all assume `consent_id` means project consent
- fake projects or fake invites would pollute reporting and semantics
- recurring profiles already exist as a separate tenant-level module

Recommendation:

- reject

### Option B: Add a new recurring-profile consent domain in parallel

Examples:

- `recurring_profile_consent_requests`
- `recurring_profile_consents`
- recurring revoke tokens
- recurring consent events

Why it fits live code best:

- preserves project flow unchanged
- keeps recurring profiles aligned with Feature 050
- reuses templates and public-signing patterns without faking projects
- keeps future recurring-profile consent behavior separate from matching and project exports

Recommendation:

- recommend

### Option C: Generalize the current consent backend now

Examples:

- abstract `consents` away from project semantics
- introduce polymorphic invite and consent tables now

Why it is too large now:

- current RPCs, table constraints, joins, public pages, and downstream matching flows are not generic
- a proper generalization would touch stable working features well beyond Feature 051
- the repo already has a working recurring-profile directory that does not need a generalized backend to proceed

Recommendation:

- reject for Feature 051

## Recommendation

Implement baseline recurring consent as a new parallel recurring-profile request/sign/revoke domain while reusing:

- `consent_templates` as the signable source
- layout and structured-field validation logic
- public token hashing and public route patterns
- SQL-transaction style submit and revoke logic
- protected route, `HttpError`, and idempotency conventions

Do not reuse project tables directly and do not generalize the existing project consent backend in this cycle.

## Proposed request, sign, and revoke model

### 1. Request row

Recommended table: `recurring_profile_consent_requests`

Recommended bounded fields:

- `id uuid primary key`
- `tenant_id uuid not null`
- `profile_id uuid not null references public.recurring_profiles(id)`
- `consent_kind text not null check (consent_kind in ('baseline'))`
- `consent_template_id uuid not null references public.consent_templates(id)`
- `profile_name_snapshot text not null`
- `profile_email_snapshot text not null`
- `token_hash text not null unique`
- `status text not null check (status in ('pending','signed','expired','superseded','cancelled'))`
- `expires_at timestamptz null`
- `created_by uuid not null`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`
- `superseded_by_request_id uuid null`

Recommended invariants:

- at most one active pending baseline request per profile
- one request signs at most once
- request creation must point to one concrete published `consent_templates.id`
- archived template rows already linked to a request remain signable

Recommended unique/index direction:

- unique partial index on `(tenant_id, profile_id, consent_kind)` where `status = 'pending'`
- index on `(tenant_id, profile_id, created_at desc)`
- index on `(tenant_id, token_hash)`

### 2. Signed row

Recommended table: `recurring_profile_consents`

Recommended bounded fields:

- `id uuid primary key`
- `tenant_id uuid not null`
- `profile_id uuid not null references public.recurring_profiles(id)`
- `request_id uuid not null unique references recurring_profile_consent_requests(id)`
- `consent_kind text not null check (consent_kind in ('baseline'))`
- `consent_template_id uuid not null`
- `template_snapshot jsonb not null`
- `profile_name_snapshot text not null`
- `profile_email_snapshot text not null`
- `consent_text text not null`
- `consent_version text not null`
- `structured_fields_snapshot jsonb null`
- `signed_at timestamptz not null default now()`
- `capture_ip inet null`
- `capture_user_agent text null`
- `revoked_at timestamptz null`
- `revoke_reason text null`
- `receipt_email_sent_at timestamptz null`
- `created_at timestamptz not null default now()`

Recommended invariants:

- unique on `request_id`
- partial unique index on `(tenant_id, profile_id, consent_kind)` where `revoked_at is null`
- signed records are never deleted
- revocation updates the signed row, but does not remove it

Recommended snapshot content:

- template id, key, name, version, version number
- profile name and email as signed
- consent text snapshot
- structured-field snapshot using the current `{ templateSnapshot, definition, values }` shape when structured fields exist

This is intentionally stronger than the current project flow, where subject name and email are not snapshotted directly on `consents`.

### 3. Revoke token row

Recommended table: `recurring_profile_consent_revoke_tokens`

Recommended shape:

- same core fields as current `revoke_tokens`
- one token per recurring signed consent
- hashed token only
- `expires_at`
- `consumed_at`

### 4. Consent event history

Recommended table: `recurring_profile_consent_events`

Recommended bounded scope:

- mirror the current `consent_events` pattern
- keep `event_type` to `granted` and `revoked` in Feature 051
- store request and revoke context in `payload`

Recommendation for request lifecycle audit:

- keep request creation, expiration, and supersede state on the request row in Feature 051
- defer a separate request-event table unless the plan phase finds a concrete UI or compliance need for it now

## Proposed derived baseline-state model

Recommended derived states:

- `missing`
- `pending`
- `signed`
- `revoked`

Recommended rules:

- `signed`: the profile has a non-revoked baseline row in `recurring_profile_consents`
- `pending`: no active signed baseline exists, and one pending baseline request exists
- `revoked`: no active signed baseline exists, no pending baseline request exists, and the latest baseline consent row is revoked
- `missing`: none of the above

Recommended precedence:

1. active signed baseline beats revoked history
2. pending baseline beats revoked history
3. revoked beats missing

Recommended bounded workflow rule:

- do not allow creating a new baseline request while an active signed baseline exists

That keeps `signed` versus `pending` ambiguity out of Feature 051.

Recommended behavior after revoked baseline:

- a new baseline request is allowed
- while that new request is pending, the derived state becomes `pending`
- after it is signed, the derived state becomes `signed`

## Recommended first staff workflow

Feature 051 should include:

- show real baseline status on `/profiles`
- allow owner/admin to create a baseline request for a profile in `missing` or `revoked`
- if a pending baseline request already exists, return and display that existing pending request instead of creating a second one
- allow staff to copy the public signing link for the current pending request

Feature 051 should defer:

- a separate resend mutation
- reminders backend
- email delivery for the initial request
- full request history UI
- full profile detail page

Reasoning:

- there is already no outbound delivery engine requirement for this cycle
- "copy link again" is enough for the first real workflow
- explicit replace or cancel of pending requests can be added in a later detail/history slice unless the plan phase decides compromised-link rotation is required immediately

## Recommended first person workflow

Feature 051 should use a dedicated recurring public route namespace, not `/i/[token]` and not `/r/[token]`.

Recommended behavior:

- tokenized public GET route loads request context plus template content
- public POST route submits the signature through a new recurring SQL RPC
- success returns to the recurring public page with a success state
- duplicate POST returns the original signed result
- invalid token returns an invalid-link state
- expired, superseded, cancelled, or already-consumed request links return an unavailable state
- revoke uses a dedicated recurring revoke route plus recurring revoke token

Receipt behavior:

- reuse the current best-effort receipt-email pattern after successful sign
- if receipt delivery fails after DB commit, the consent stays signed and UI should surface a queued or deferred receipt state just like the current flow

## What should be reused

Reuse directly or with light extraction:

- `consent_templates` visibility and published-template checks from `template-service.ts`
- `structured-fields.ts` validation and snapshot shape
- `form-layout.ts` and `ConsentFormLayoutRenderer`
- `validateConsentBaseFields(...)`
- `HttpError` and `jsonError`
- tenant resolution with `resolveTenantId(...)`
- `idempotency_keys` for protected request creation
- `hashPublicToken(...)` for stored token hashes
- best-effort receipt-email pattern after signing

Recommended extractions during implementation:

- move `parseStructuredFieldValues(formData)` out of `src/app/i/[token]/consent/route.ts` into a shared helper
- split the current public invite form wrapper into shared rendering pieces plus domain-specific wrappers

## What must remain separate

Do not reuse directly:

- `subject_invites`
- `subjects`
- `consents`
- `revoke_tokens`
- `consent_events`
- `public.get_public_invite`
- `public.submit_public_consent`
- `public.revoke_public_consent`
- project invite URL generation based on `deriveInviteToken(...)`
- project invite revoke route
- headshot upload and face-match paths tied to invite tokens
- project detail, matching, and export code keyed to project `consent_id`

These are not generic abstractions in the live repo. They are the current project consent backend.

## Recommended `/profiles` evolution for Feature 051

Recommended list-page changes:

- replace placeholder baseline status with real derived baseline status
- make `Request baseline consent` a live owner/admin action
- make the row action `Copy baseline link` when a pending request exists
- keep `Send reminder` as a disabled placeholder
- keep profile detail and history deferred

Recommended UI shape:

- keep `/profiles` as the operational entry point
- use a lightweight per-row request action with template selection
- avoid forcing a full `/profiles/[profileId]` detail workflow in Feature 051

## Security and reliability considerations

- derive tenant from auth on protected routes and from validated token context on public routes
- never accept tenant id from the client
- keep public submit and revoke in SQL-backed atomic operations
- require `Idempotency-Key` for protected baseline-request creation
- return existing pending request on duplicate create or concurrent create races
- enforce one active pending baseline request per profile
- enforce one active signed baseline consent per profile
- allow archived templates already linked to requests to remain signable
- keep revoke history immutable and additive
- treat receipt sending as best-effort after DB commit
- if profile archival remains possible with pending requests, the plan phase should decide whether archival auto-supersedes pending requests

## Edge cases to handle

- duplicate request creation after lost response
- two staff users create a baseline request for the same profile concurrently
- duplicate public submit after DB success but lost client response
- invalid, expired, cancelled, or superseded public request link
- revoked baseline followed by a new baseline request
- template archived after request issuance but before signing
- stale `/profiles` page showing `missing` while another browser has already created a pending request
- receipt email failure after successful recurring consent write
- profile archived while a pending baseline request exists

## Explicitly deferred work

- specific extra-consent requests
- reminders and reminder scheduling
- outbound delivery engine for initial request sending
- bulk import
- external directory sync
- headshots
- facial matching and CompreFace integration
- project-linking behavior
- generic cross-domain consent-backend redesign
- redesign of current project `subjects`, `subject_invites`, or `consents`
- full profile detail and history page, unless the plan phase finds it required for the smallest workable request UI

## Open decisions for the plan phase

- exact public route names for recurring sign and recurring revoke
- whether pending-request replace or cancel must ship in Feature 051, or can remain deferred while "copy existing link" covers resend
- whether profile archival should automatically supersede active pending baseline requests
- whether baseline request creation lives as an inline row expander, drawer, or another lightweight list-page affordance
- exact query shape for deriving baseline state and latest baseline activity efficiently on `/profiles`
- whether receipt email copy should get a recurring-profile-specific template or a lightly adapted variant of the current project receipt

## Research conclusion

The safest bounded architecture is a new recurring-profile consent request/sign/revoke domain that is parallel to the existing project invite domain. Reuse the existing template, layout, structured-field, public-token, error-shaping, and idempotency patterns. Do not reuse the project consent tables directly and do not generalize the existing project backend in Feature 051.

That gives the recurring profiles module its first real consent workflow while preserving the current project flow, auditability, tenant scoping, and public signing model.
