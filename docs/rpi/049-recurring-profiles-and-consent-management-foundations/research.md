# Feature 049 Research: Recurring Profiles and Consent Management Foundations

## Scope

Research a bounded new webapp module for tenant-managed recurring profiles.

The module should let a tenant:

- maintain reusable recurring people records inside the organization
- track baseline recurring consent centrally
- request additional specific consent later for particular campaigns or use cases
- preserve the existing project or event invite flow unchanged

This research is code-first. Live schema, routes, helpers, components, and tests are the source of truth. Prior RPI docs are useful context, not authority.

## Inputs reviewed

### Required repo docs

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`

### Prior RPI docs

- `docs/rpi/039-consent-form-template-editor/research.md`
- `docs/rpi/042-structured-consent-template-fields/research.md`
- `docs/rpi/044-asset-preview-linking-ux-improvements/research.md`
- `docs/rpi/045-asset-preview-unlinked-faces-and-hidden-face-suppression/research.md`
- `docs/rpi/046-template-editor-live-preview-and-layout-builder/research.md`
- `docs/rpi/047-manual-face-box-creation-in-asset-preview/research.md`
- `docs/rpi/048-block-person-assignment-for-faces-without-consent/research.md`

### Live schema and migrations

- `supabase/migrations/20260304210000_002_projects_invites_schema.sql`
- `supabase/migrations/20260304211000_002_projects_invites_rls.sql`
- `supabase/migrations/20260305100000_003_consent_templates_schema.sql`
- `supabase/migrations/20260305101000_003_consent_templates_rls.sql`
- `supabase/migrations/20260305120000_004_assets_schema.sql`
- `supabase/migrations/20260306100000_006_headshot_consent_schema.sql`
- `supabase/migrations/20260327120000_023_request_uri_safety.sql`
- `supabase/migrations/20260320140000_019_face_materialization_pipeline.sql`
- `supabase/migrations/20260403170000_031_face_level_photo_linking.sql`
- `supabase/migrations/20260404110000_032_face_review_sessions_and_derivatives.sql`
- `supabase/migrations/20260407150000_039_consent_form_template_editor.sql`
- `supabase/migrations/20260407213000_042_structured_consent_template_fields.sql`
- `supabase/migrations/20260410150000_046_template_editor_live_preview_layout.sql`
- `supabase/migrations/20260410190000_drop_template_category.sql`
- `supabase/migrations/20260410210000_template_duration_options_and_public_invite_name.sql`
- `supabase/migrations/20260409110000_045_asset_face_hidden_states.sql`
- `supabase/migrations/20260414110000_047_manual_asset_faces.sql`
- `supabase/migrations/20260414160000_048_asset_face_block_states.sql`

### Live protected and public code paths

- `src/app/(protected)/layout.tsx`
- `src/components/navigation/protected-nav.tsx`
- `src/app/(protected)/projects/page.tsx`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/app/(protected)/templates/page.tsx`
- `src/app/(protected)/templates/[templateId]/page.tsx`
- `src/app/api/projects/[projectId]/invites/route.ts`
- `src/app/api/projects/[projectId]/default-template/route.ts`
- `src/app/api/templates/route.ts`
- `src/app/api/templates/[templateId]/route.ts`
- `src/app/api/templates/[templateId]/publish/route.ts`
- `src/app/api/templates/[templateId]/versions/route.ts`
- `src/app/api/templates/[templateId]/archive/route.ts`
- `src/app/api/templates/[templateId]/preview-validate/route.ts`
- `src/app/i/[token]/page.tsx`
- `src/app/i/[token]/consent/route.ts`
- `src/app/r/[token]/page.tsx`
- `src/app/r/[token]/revoke/route.ts`
- `src/app/api/public/invites/[token]/headshot/route.ts`
- `src/app/api/public/invites/[token]/headshot/[assetId]/finalize/route.ts`
- `src/app/api/projects/[projectId]/consents/[consentId]/headshot/route.ts`

### Live helpers and components

- `src/lib/tenant/resolve-tenant.ts`
- `src/lib/idempotency/invite-idempotency.ts`
- `src/lib/invites/public-invite-context.ts`
- `src/lib/consent/submit-consent.ts`
- `src/lib/consent/revoke-consent.ts`
- `src/lib/consent/validate-consent-base-fields.ts`
- `src/lib/templates/template-service.ts`
- `src/lib/templates/structured-fields.ts`
- `src/lib/templates/form-layout.ts`
- `src/lib/templates/template-preview-validation.ts`
- `src/components/public/public-consent-form.tsx`
- `src/components/consent/consent-form-layout-renderer.tsx`
- `src/components/projects/create-invite-form.tsx`
- `src/components/projects/project-default-template-form.tsx`
- `src/lib/assets/create-asset.ts`
- `src/lib/assets/finalize-asset.ts`
- `src/lib/matching/face-materialization.ts`
- `src/lib/matching/consent-photo-matching.ts`
- `src/lib/matching/asset-preview-linking.ts`
- `src/lib/matching/photo-face-linking.ts`
- `src/lib/matching/manual-asset-faces.ts`
- `src/lib/project-export/project-export.ts`

### Relevant tests

- `tests/feature-039-consent-form-template-editor.test.ts`
- `tests/feature-042-structured-consent-template-fields.test.ts`
- `tests/feature-044-asset-preview-linking-ux-improvements.test.ts`
- `tests/feature-045-asset-preview-unlinked-faces-and-hidden-face-suppression.test.ts`
- `tests/feature-046-template-editor-live-preview-layout.test.ts`
- `tests/feature-047-manual-face-box-creation-in-asset-preview.test.ts`
- `tests/feature-048-block-person-assignment-for-faces-without-consent.test.ts`

## Verified current behavior and current live boundary

## 1. Current schema model

### Tenants and memberships

The app is tenant-scoped end to end.

Current live foundations:

- `public.tenants`
- `public.memberships`
- membership roles are `owner`, `admin`, and `photographer`
- `public.current_tenant_id()` resolves the oldest membership for the signed-in user
- `public.ensure_tenant_for_current_user()` creates a tenant and owner membership on first protected access if needed

`src/app/(protected)/layout.tsx` calls `ensureTenantId(...)` before rendering protected pages. `src/components/navigation/protected-nav.tsx` currently exposes only `Dashboard`, `Projects`, and `Templates`.

### Projects, invites, subjects, and consents

The current consent system is explicitly project-scoped.

Live table shape:

- `public.projects`
- `public.subject_invites`
- `public.subjects`
- `public.consents`
- `public.revoke_tokens`
- `public.consent_events`

Important current constraints:

- `subjects.project_id` is required
- `subjects` are unique by `(tenant_id, project_id, email)`
- `consents.project_id` is required
- `consents.subject_id` is required
- `consents.invite_id` is required
- `consents` are unique by `invite_id`
- `revoke_tokens` and `consent_events` both point to `consents`

Current live implication:

- a subject is not a tenant-wide reusable person record
- a subject is a project-local signer identity keyed by tenant plus project plus email
- a consent is not a generic person-consent artifact
- a consent is a signed result of one project invite

### Consent templates

Feature 039 and 042 are live.

Current `public.consent_templates` behavior:

- row-per-version model
- app-wide templates use `tenant_id is null`
- tenant-owned templates use `tenant_id = <tenant>`
- status is `draft`, `published`, or `archived`
- published rows are immutable except archive transition
- one published row per family and one draft row per family are enforced by unique indexes

Current template payload:

- `body`
- `structured_fields_definition`
- `form_layout_definition`
- `name`, `description`, `template_key`, `version`, `version_number`

Current live routing and service layer:

- protected list and detail pages under `src/app/(protected)/templates/**`
- management routes under `src/app/api/templates/**`
- server logic in `src/lib/templates/template-service.ts`
- structured field helpers in `src/lib/templates/structured-fields.ts`
- layout helpers in `src/lib/templates/form-layout.ts`

### Public signing and revocation

Current public invite flow:

1. `src/app/i/[token]/page.tsx` calls `public.get_public_invite`
2. the RPC reads `subject_invites` joined to `projects` and `consent_templates`
3. the page renders `PublicConsentForm`
4. `src/app/i/[token]/consent/route.ts` parses base fields and structured values
5. `src/lib/consent/submit-consent.ts` calls `public.submit_public_consent`
6. the RPC locks the invite row, validates availability, upserts the project-scoped subject, inserts the consent, creates a revoke token, writes a consent event, increments `used_count`, and returns a duplicate response on retry

Current public revoke flow:

- `src/app/r/[token]/page.tsx` renders a revoke form
- `src/app/r/[token]/revoke/route.ts` calls `revokeConsentByToken(...)`
- `public.revoke_public_consent` marks the revoke token consumed, updates `consents.revoked_at`, preserves history, and writes a `revoked` event

### Headshots and current matching identity

Current headshot and face-matching flows are consent-centric, not person-profile-centric.

Live facts:

- headshots are `assets` rows with `asset_type = 'headshot'`
- headshots are linked to consents through `asset_consent_links`
- `consents.face_match_opt_in` is stored on the signed consent row
- `list_current_project_consent_headshots(...)` returns the latest eligible headshot asset per consent within a project
- `loadCurrentProjectConsentHeadshots(...)` and `loadConsentHeadshotMaterialization(...)` are keyed by `consentId`
- replacing a headshot uses `/api/projects/[projectId]/consents/[consentId]/headshot`

Current exact-face identity:

- current face identity is `asset_face_materialization_faces.id`
- exact face links live in `asset_face_consent_links`
- hidden state lives in `asset_face_hidden_states`
- blocked state lives in `asset_face_block_states`
- manual faces reuse the same face table with `face_source = 'manual'`

Current export boundary:

- `src/lib/project-export/project-export.ts` exports consents, current materializations, faces, face links, and fallback links
- export has no recurring profile concept
- export still serializes real consent-linked data only

## 2. Current code paths, routes, and components involved

### Protected project-centric surfaces

- project list and project detail pages live under `src/app/(protected)/projects/**`
- the project detail page is the center of current invite creation, consent display, headshot display, and matching review
- `CreateInviteForm` and `ProjectDefaultTemplateForm` both work off project scope
- invite creation and default template selection both validate against the current tenant and current project

### Template reuse surfaces

- `template-service.ts` already centralizes published-template visibility and management checks
- `structured-fields.ts` and `form-layout.ts` already define reusable template metadata and render ordering rules
- `template-preview-validation.ts` already validates a would-be public form without persistence
- `public.get_public_invite` returns template name, text, structured fields, and form layout for the invite-linked version row

### Public person-facing surfaces

- `PublicConsentForm` and `ConsentFormLayoutRenderer` are already generic enough to render versioned template body plus structured fields and system blocks
- current public routes are still invite-shaped and project-shaped
- current headshot upload helpers assume the token resolves to a project invite context

### Matching and face assignment surfaces

- asset preview helpers load consent summaries and current headshots by consent id
- preview candidate lists only return signed, non-revoked project consents
- hidden, blocked, manual face, and exact-link states all preserve the exact-face model rather than introducing a generic person directory

## 3. What currently makes consent effectively one-off and project-bound

These are the strongest live one-off assumptions:

- `subject_invites` always belong to a project
- `subjects` always belong to a project
- `consents` always belong to a project and one invite
- headshot resolution is "current headshot for consent in project"
- matching workers, candidate reads, and preview summaries treat `consent_id` as the person identity for reusable face matching
- project detail pages are the operational home for invite issuance, signed consent visibility, headshots, and matching
- current public token resolution helpers return `tenantId`, `projectId`, and `consentTemplateId` from an invite row, not from a reusable person record

Result:

- the current system supports reusable template versions
- it does not support reusable tenant-managed people with an ongoing consent relationship

## 4. Reusable areas versus tightly coupled areas

### Reusable now

- tenant resolution and server-side auth boundary
- idempotency key pattern for retry-safe writes
- template versioning, structured fields, and layout model
- public token pattern for anonymous signing
- consent receipt and revoke-link semantics
- protected navigation and layout shell

### Tightly coupled to projects and invites

- `subjects`
- `subject_invites`
- `consents`
- headshot linkage via `asset_consent_links`
- matching and face assignment helpers keyed by `consent_id`
- project export and project detail reporting

Conclusion:

The recurring-profile module should reuse templates, public token signing patterns, and server-authoritative write patterns, but it should not try to stretch `subjects`, `subject_invites`, or `consents` into a reusable profile model.

## Product problem and target user flows

The current product is strong at one-off project or event capture:

- create a project
- choose a published template version
- issue a single-use invite
- collect one signed consent
- optionally attach a headshot and use matching inside that project

The missing product capability is a reusable tenant-level person directory with an ongoing consent relationship.

The target module should support recurring people such as:

- employees
- volunteers
- ambassadors
- spokespeople
- members
- board members
- any other person who has an ongoing relationship with the organization

It should stay generic and not become an HR or CRM redesign.

### Key tenant staff flows

- view a central list of recurring profiles for the tenant
- see baseline consent state at a glance: missing, pending, signed, revoked
- create or archive a recurring profile
- open a profile detail view and review baseline history
- generate or resend a baseline consent request
- later create an additional specific request for a campaign or use case
- see which requests are pending, signed, expired, or revoked

### Key recurring-profile owner flows

- open a tokenized public link
- review the organization, request context, and template version being requested
- sign a baseline recurring consent
- later open a different tokenized public link for a specific additional request
- revoke a previously signed recurring consent through a revoke link without deleting history

## Domain-model options considered

## Option A: Extend current `subjects` into tenant-wide recurring profiles

Possible direction:

- add recurring-profile fields directly onto `subjects`
- try to reuse `subjects` as both project-local signers and tenant-wide people

Why it looks tempting:

- `subjects` already represent the human signer
- `consents.subject_id` already points to a person row

Why it is a poor fit in the live repo:

- `subjects.project_id` is required today
- `subjects` are unique by `(tenant_id, project_id, email)`, not tenant-wide identity
- current public signing upserts subjects by project-scoped email
- changing `subjects` into a tenant-global entity would force schema, RLS, RPC, route, and export redesign across current flows
- it would blur the existing distinction between "one project signer row" and "reusable tenant-managed person"

Conclusion:

- Reject for this bounded cycle.
- Extending `subjects` would be a redesign of the current project consent model, not an additive feature.

## Option B: Create recurring profiles but reuse current `subject_invites` and `consents` directly

Possible direction:

- add `recurring_profiles`
- continue creating current `subject_invites` and `consents`
- possibly use a synthetic project or synthetic invite to represent baseline recurring consent

Why it looks tempting:

- current signing, revoke, and audit paths already exist
- current headshot logic already hangs off `consent_id`

Why it is still the wrong fit:

- current `consents` semantically mean "signed result of one project invite"
- `consents.invite_id` is required and unique
- `consents.project_id` is required
- `consent_events` and `revoke_tokens` are hard-linked to `consents`
- using fake project rows or fake invite rows would pollute reporting and operational behavior
- baseline recurring consent is not a project invite and should not pretend to be one

Conclusion:

- Reject for the bounded foundation.
- Reusing the current project tables directly would create semantic debt and make future separation harder.

## Option C: Add a new recurring-profile domain with its own request and signed-record tables, while reusing templates and tokenized public signing patterns

Possible direction:

- new `recurring_profiles` table
- new recurring-profile consent request table
- new recurring-profile signed consent table
- new recurring-profile revoke token and event tables
- continue using `consent_templates` version rows for what gets signed
- keep public tokenized signing and revoke UX as the trust boundary

Why this fits the live system best:

- preserves the current project flow completely
- keeps template version reuse intact
- keeps signed records auditable and immutable
- avoids fake projects, fake invites, and fake consents
- gives baseline and additional specific requests separate, independently revocable signed artifacts
- leaves room for later links between recurring profiles and project subjects without forcing that decision now

Conclusion:

- Recommended.

## Recommended bounded direction

## 1. Introduce a new recurring-profile domain

Recommend a new tenant-scoped entity, for example `recurring_profiles`.

Recommended profile purpose:

- reusable tenant-level person record
- central home for baseline recurring consent state
- future anchor for specific extra consent requests
- future anchor for profile-to-project relationships

Recommended profile characteristics:

- tenant-scoped
- server-created and server-updated only
- no client-provided tenant id
- archive instead of hard delete
- do not include matching or multiple-headshot behavior in the first foundation

Why `recurring_profiles` is better than extending `subjects`:

- it keeps recurring identity separate from current project signer rows
- it gives the module a stable tenant-level identity from day one
- it does not disturb current project uniqueness and RLS assumptions

## 2. Use a parallel recurring consent request and signed-record model

Recommend a new pair of core entities, conceptually:

- `recurring_profile_consent_requests`
- `recurring_profile_consents`

Plus supporting audit entities:

- recurring-profile revoke tokens
- recurring-profile consent events

Recommended relation:

- a request points to one concrete published `consent_templates.id`
- signing one request creates one immutable recurring-profile consent record
- one request produces at most one signed record
- revoke history is tracked separately and never deletes the signed record

Why not reuse `consents` directly:

- current `consents` are structurally and semantically project invite artifacts
- recurring baseline consent is an ongoing relationship artifact instead

## 3. Model baseline and additional specific consent as separate signed instances

Baseline recurring consent should not be a mutable profile flag and should not be an add-on blob attached to one consent row.

Recommended model:

- baseline consent is one request kind
- additional specific consent is another request kind
- both kinds use the same request and signed-record mechanics
- each signed result is its own immutable record with its own revoke lifecycle

Recommended request-kind model:

- `baseline`
- `specific`

Recommended specific-request metadata:

- `purpose_label`
- optional `purpose_key`
- optional `related_project_id`
- optional `campaign_ref`

This keeps the first design generic while leaving a clean extension point for future campaign or project-specific requests.

## 4. Reuse template versioning, structured fields, and layout logic

Recommend reusing the current live template stack exactly where it is already strong:

- `consent_templates` row-per-version model
- `structured_fields_definition`
- `form_layout_definition`
- published-row immutability
- archived-version signability for already-issued links

Recommended rule:

- recurring-profile requests should point to one concrete published template version row at request creation time
- public signing should snapshot consent text, template version, and structured field snapshot onto the recurring signed record
- archiving a template later should not invalidate already-issued recurring request links

This matches the current invite semantics and preserves auditability.

## 5. Keep person-facing signing on tokenized public flows

Recommend that the recurring-profile module be tenant-internal on the protected side, while actual signing remains anonymous and tokenized on the public side.

Why:

- matches the current trust boundary
- avoids auth redesign
- keeps security-sensitive validation server-side
- does not require the recurring profile owner to create an account

Recommended first real request behavior:

- generate a tokenized public link that staff can copy and share
- do not require a full reminder or notification engine in the foundation cycle

This keeps the first functional recurring-request cycle much smaller than "send reminders and manage delivery status".

## Recommended entities and likely states

## 1. Core entities

Recommended bounded foundation:

- `recurring_profiles`
- `recurring_profile_consent_requests`
- `recurring_profile_consents`
- recurring-profile revoke tokens
- recurring-profile consent events

Recommended later-only entities:

- request delivery attempts
- profile headshots
- profile-to-project linking
- external face-provider identities

## 2. Profile state

Recommended persisted profile status:

- `active`
- `archived`

Recommended derived baseline state shown in UI:

- `missing`
- `pending`
- `signed`
- `revoked`

Meaning:

- `missing`: no active signed baseline and no active pending baseline request
- `pending`: at least one active pending baseline request and no active signed baseline
- `signed`: latest effective baseline consent exists and is not revoked
- `revoked`: a baseline consent was previously signed and later revoked, with no newer active baseline replacing it

## 3. Request state

Recommended recurring request lifecycle:

- `pending`
- `signed`
- `expired`
- `cancelled`
- `superseded`

Recommended invariants:

- one request can produce at most one signed recurring consent
- duplicate submit returns the first signed record for that request
- at most one active pending baseline request per profile should exist at a time
- for specific requests, concurrency can be allowed later per purpose key, but the first cycle should stay conservative

## 4. Signed consent state

Recommended signed recurring consent lifecycle:

- active signed record
- revoked signed record via `revoked_at`

Important rule:

- revocation stops future processing
- revocation does not delete history
- baseline and specific requests revoke independently

## 5. Suggested audit payload

The new recurring signed record should snapshot at least:

- profile id
- profile display name snapshot
- profile email snapshot if present
- request kind
- purpose metadata for specific requests
- template id, key, name, version, version number
- consent text snapshot
- structured field snapshot
- signing metadata such as IP and user agent

This is slightly stronger than the current project flow, which does not fully snapshot subject name and email onto `consents`. It is worth doing correctly in the new domain from the start.

## Recommended first protected UI shell scope

## Module name

Recommended first protected tab name:

- `Profiles`

Why `Profiles` is preferred over `Subjects`:

- `subjects` is already a project-scoped technical term in the live schema
- the new module is specifically about reusable tenant-level records
- `Profiles` reads as product language rather than internal database language

`People` is a reasonable copy alternative later, but `Profiles` is the cleaner bounded starting point for the new module and route surface.

## First shell page recommendation

Recommended route:

- `/profiles`

Recommended shell contents:

- page header describing recurring profiles and baseline consent tracking
- summary cards with placeholder counts:
  - total profiles
  - baseline signed
  - baseline pending
  - baseline missing or revoked
- filter bar scaffold:
  - search
  - baseline state chips or tabs
  - archived toggle placeholder
- empty directory table or list with intended columns:
  - name
  - email
  - baseline state
  - latest request
  - latest signed or revoked date
- clear empty state CTA placeholders:
  - `Create profile`
  - `Request baseline consent`

Useful shell states:

- no profiles yet
- no permission to manage
- future feature placeholders for baseline request and specific request actions
- loading skeletons

Recommended shell boundary:

- navigation plus one list page only
- no real data writes yet
- no fake data persistence
- no attempt to implement request sending in the shell cycle

## Security, reliability, and bounded architecture direction

## 1. Keep the recurring module separate from project consent

What should remain separate:

- project invite issuance
- project-scoped `subjects`
- project-scoped `consents`
- project-scoped headshot linkage
- project-scoped matching and exact-face assignment

Why:

- the current project flow already works and has a clear trust boundary
- recurring profiles represent an ongoing tenant-level relationship, not a project invitation
- blending the two now would weaken clarity and make later extension harder

Recommended shared pieces instead of shared tables:

- template version rows
- structured field and form layout definitions
- public token pattern
- revoke semantics
- idempotent write patterns

## 2. Server-authoritative and idempotent writes

Recurring-profile writes should follow the same server-authoritative rules as the rest of the repo:

- derive tenant from auth or token context, never from client payload
- validate membership and permissions server-side
- validate template visibility server-side
- validate profile ownership server-side
- use idempotency keys for profile create and request create or resend flows
- make public signing idempotent by unique request-to-signed-record constraints

Recommended idempotent write boundaries:

- create profile
- archive profile
- create baseline request
- resend baseline request
- create specific request
- revoke signed recurring consent

## 3. Duplicate requests, retries, and resend races

Important cases the design must handle:

- client retries request creation after a lost response
- operator double-clicks "create baseline request"
- two operators try to create a baseline request for the same profile at the same time
- one operator resends while another replaces the pending request with a new token
- public signer double-submits after the first write already succeeded

Recommended bounded rules:

- use idempotency keys for create and resend actions
- enforce one active pending baseline request per profile
- make resend reuse the current pending request whenever possible
- treat explicit replace or regenerate as a separate action that supersedes the old request and invalidates its token
- enforce one signed recurring consent per request

## 4. Expired tokens and revoked records

The recurring module should preserve current public-link semantics:

- expired request tokens return an unavailable response
- invalid tokens return a not-found style response
- a signed recurring consent can later be revoked by revoke token
- revocation should not delete request or signed history
- revoking baseline consent should change the derived baseline state to `revoked` until a newer active baseline is signed
- revoking a specific request should affect only that specific signed instance, not the baseline state

## 5. Partial failures

The main partial-failure cases are:

- DB request row created but client never receives the response
- signed recurring consent written but client never sees success
- future delivery attempt succeeds or fails after the request row already exists

Recommended bounded handling:

- rely on idempotency keys to return the existing request payload when create or resend is retried
- rely on request-level uniqueness to return the same signed record on duplicate submit
- if future email or SMS delivery is added, persist the request row before delivery attempts and track delivery attempts separately

For the first functional recurring-request cycle, the simplest approach is still:

- create request row
- return a shareable tokenized link
- defer delivery automation

## 6. Missing permissions and stale UI

Recommended current-role fit without auth redesign:

- all tenant members may be allowed to view profile list data, subject to product confirmation
- only `owner` and `admin` should create, edit, archive, or request consents

This matches current template management more closely than inventing new roles.

Recommended stale UI handling:

- all mutations return the updated derived profile status or request status
- list and detail pages should refresh from server reads after mutation
- UI should never infer baseline state from client-only counters

## 7. Bounded architecture summary

Smallest coherent architecture:

- new recurring-profile tables and routes
- reuse current template stack
- reuse current public-form rendering concepts where practical
- reuse current public-link and revoke-link trust model
- keep project matching, headshots, and one-off project consent unchanged

This gives a stable foundation for recurring profiles without pulling matching or project workflows into the first cycle.

## Edge cases and invariants

### Invariants to preserve

- signed consent history is immutable
- revocation never deletes history
- every recurring profile row is tenant-scoped
- every recurring request row is tenant-scoped
- every recurring signed record is tenant-scoped
- baseline state shown in UI is derived from server-truth records, not client caches
- baseline and specific requests remain distinct signed artifacts
- existing project or event invite flow remains intact
- archived template versions already linked to issued requests remain signable
- face and matching systems continue to depend on current consent-linked project data only

### Important edge cases

- profile archived while a pending baseline request still exists
- profile has no email but staff still wants to copy a signing link manually
- baseline signed, then revoked, then re-requested and re-signed
- specific request issued while baseline is missing or revoked
- concurrent resend and sign
- request expires after UI loaded but before submit
- DB success followed by future delivery failure
- permission changes between page load and mutation

Recommended handling direction:

- archive should not delete historical requests or signed records
- copyable-link flows should not require an email address at the data-model level
- later signed baseline requests should supersede older revoked or missing state in derived UI status
- whether specific requests require active baseline should remain a plan-phase decision, not a schema assumption baked into the foundation

## Future extension points

## 1. Multiple headshots per recurring profile

Do not attach matching or headshots to recurring profiles in the foundation cycle.

Leave room for a later additive model such as:

- `recurring_profile_headshots`
- or a generic profile-to-asset link table for headshots

Why this is deferred:

- the current matching system is consent-centric and project-scoped
- moving headshots into the recurring foundation now would entangle this feature with matching redesign

## 2. Future CompreFace or external subject integration

Do not store a single provider-specific subject id directly on the profile row yet.

Prefer a later additive table such as:

- `recurring_profile_matching_identities`

Why:

- multiple providers may exist later
- provider identities may need rotation or reprovisioning
- some tenants may never enable profile-level matching

## 3. Profile-to-project usage later

Recurring profiles should be able to connect to project flows later, but that should be additive.

Likely later options:

- map a recurring profile to project-local subject rows
- allow invite creation from a profile
- show baseline state when creating a project invite

What should be deferred:

- deciding whether the later link is a nullable FK on `subjects` or a separate mapping table
- any redesign of current project detail or export logic

## 4. Targeted extra permission requests

The recommended `request_kind` plus optional purpose metadata is enough to support future targeted requests without redesign.

Examples:

- campaign-specific usage
- additional media channels
- region-specific usage
- project-specific exceptions

What should be deferred:

- campaign orchestration
- approval workflows
- multi-step request builders

## 5. Reminder workflows

The recurring foundation should allow reminders later, but not implement them now.

Recommended later additive pieces:

- request delivery attempts
- reminder scheduling
- reminder suppression after sign or revoke

The first functional request cycle should only need shareable links and request history.

## Recommended bounded implementation roadmap

## 1. Best immediate next cycle

Yes. A UI shell or navigation cycle is the best first implementation step after this research.

Why:

- module naming and information architecture are still new
- the repo currently has no recurring-profile route surface at all
- a shell cycle creates a safe place for later domain work without forcing schema decisions into the same PR

Recommended next cycle:

1. add `Profiles` to protected navigation
2. add `/profiles` protected page
3. render shell cards, placeholder filters, and empty states
4. keep the shell fully server-rendered and tenant-gated
5. do not add fake writes or temporary local persistence

## 2. Suggested later small RPI cycles

### Cycle A: Profiles shell and navigation

- add nav item and empty page shell
- permission-aware placeholder actions

### Cycle B: Recurring profile directory foundation

- add recurring profile schema
- add server-side list and create reads and writes
- add archive behavior
- show derived empty baseline status as `missing`

### Cycle C: Baseline request foundation

- add recurring request and signed-record schema
- add public tokenized baseline sign and revoke flow
- add copyable request link generation
- derive baseline states from real rows

### Cycle D: Profile detail and baseline history

- profile detail page
- timeline of requests and signed records
- resend or replace request actions

### Cycle E: Additional specific consent requests

- add `specific` request creation
- show specific request history separately from baseline
- preserve independent revoke behavior

### Cycle F: Follow-up and reminder readiness

- request history filters
- reminder placeholders or delivery-attempt model
- no broad notification engine yet

### Cycle G: Profile-to-project linking foundation

- add additive link from recurring profiles to project usage where valuable
- keep one-off project consent unchanged

### Cycle H: Profile headshots and matching integration

- multiple headshots per profile
- external provider identity binding
- any future CompreFace subject integration

## Explicit open decisions for the plan phase

- Should the protected module label be `Profiles` or `People`, even if the route remains `/profiles`?
- What is the minimum required recurring-profile identity data in v1: name only, name plus optional email, or name plus required email?
- Should all tenant members be allowed to view recurring profiles, or should view access also be limited to `owner` and `admin`?
- Should the first non-shell functional cycle support only copyable request links, or also immediate email delivery if a provider is configured?
- Should specific additional requests require an active baseline consent first, or remain independently issuable with only a UI warning?
- What exact uniqueness rule should v1 enforce for pending specific requests: one active pending request total, or one per purpose key?
- Should recurring signed records snapshot profile name and email directly on the record in addition to linking to `profile_id`? Recommendation: yes.
- Should archiving a profile cancel pending requests automatically, or should pending requests remain valid until explicitly cancelled or expired?
- When a pending request is resent, should the same token remain active, or should resend only update timestamps while a separate `replace link` action rotates the token?
- When project linkage is added later, should the first additive shape be a nullable link on `subjects` or a separate mapping table?

## Plan-phase starting point

The cleanest plan-phase baseline is:

- keep the current project consent system untouched
- add a new recurring-profile domain
- reuse `consent_templates` as the signable version source
- use a parallel recurring request and signed-record model
- keep public signing tokenized and anonymous
- make the next implementation cycle a `Profiles` shell and navigation change
