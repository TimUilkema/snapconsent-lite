# Feature 055 Research: Project Participants and Mixed Consent Intake

## Scope

Research the smallest coherent next product step for mixed participation inside one project:

- known recurring profiles can be added to a project
- one-off project signers can still sign through the existing QR/public invite flow
- project-specific consent can be requested from known profiles
- signed project consent remains project-scoped
- not every project signer becomes a recurring profile

This is research only. Live schema, migrations, routes, services, and UI are the source of truth.

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
14. `docs/rpi/053-recurring-consent-history-and-inline-profile-detail/plan.md`
15. `docs/rpi/054-baseline-follow-up-actions/research.md`
16. `docs/rpi/054-baseline-follow-up-actions/plan.md`

### Live schema and migrations verified

- `supabase/migrations/20260304210000_002_projects_invites_schema.sql`
- `supabase/migrations/20260304212000_002_projects_invites_idempotency.sql`
- `supabase/migrations/20260305100000_003_consent_templates_schema.sql`
- `supabase/migrations/20260305103000_003_consent_templates_submit.sql`
- `supabase/migrations/20260306100000_006_headshot_consent_schema.sql`
- `supabase/migrations/20260407213000_042_structured_consent_template_fields.sql`
- `supabase/migrations/20260414170000_050_recurring_profile_directory_foundation.sql`
- `supabase/migrations/20260414193000_051_baseline_recurring_consent_request_foundation.sql`
- `supabase/migrations/20260414210000_052_baseline_request_management.sql`
- `supabase/migrations/20260414224500_054_baseline_follow_up_delivery_attempts.sql`

### Live project, public, template, and recurring-profile code verified

- `src/app/(protected)/projects/page.tsx`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/app/api/projects/route.ts`
- `src/app/api/projects/[projectId]/invites/route.ts`
- `src/app/api/projects/[projectId]/invites/[inviteId]/revoke/route.ts`
- `src/app/api/projects/[projectId]/default-template/route.ts`
- `src/components/projects/create-invite-form.tsx`
- `src/components/projects/project-default-template-form.tsx`
- `src/components/projects/invite-actions.tsx`
- `src/app/i/[token]/page.tsx`
- `src/app/i/[token]/consent/route.ts`
- `src/app/r/[token]/page.tsx`
- `src/app/r/[token]/revoke/route.ts`
- `src/components/public/public-consent-form.tsx`
- `src/lib/idempotency/invite-idempotency.ts`
- `src/lib/invites/public-invite-context.ts`
- `src/lib/consent/submit-consent.ts`
- `src/lib/consent/revoke-consent.ts`
- `src/lib/templates/template-service.ts`
- `src/app/(protected)/profiles/page.tsx`
- `src/components/profiles/profiles-shell.tsx`
- `src/lib/profiles/profile-directory-service.ts`
- `src/lib/profiles/profile-consent-service.ts`
- `src/lib/profiles/profile-follow-up-service.ts`
- `src/lib/profiles/profile-follow-up-delivery.ts`
- `src/app/rp/[token]/page.tsx`
- `src/app/rp/[token]/consent/route.ts`
- `src/app/rr/[token]/revoke/route.ts`
- `src/lib/recurring-consent/public-recurring-consent.ts`
- `src/lib/http/errors.ts`
- `src/lib/tenant/resolve-tenant.ts`
- `src/lib/tokens/public-token.ts`
- `src/lib/url/paths.ts`

### Search verification

A repo search found no existing `project_participant*`, `project_profile*`, or similar mixed-participation primitives in `src/` or `supabase/`.

## Verified current live boundary

## 1. Projects still model one-off consent intake only

The live project consent model is still:

- `projects`
- `subject_invites`
- `subjects`
- `consents`
- `revoke_tokens`
- `consent_events`

Important live facts:

- `subjects.project_id` is required.
- `subjects` are unique by `(tenant_id, project_id, email)`.
- `consents.project_id`, `subject_id`, and `invite_id` are all required.
- `consents` are unique by `invite_id`.
- `subject_invites` are token rows, not person rows.

Current implication:

- a one-off project signer is still project-local only
- before signing, the system has an invite token, not a participant identity
- after signing, the signer becomes a project-local `subjects` row plus a project-local `consents` row

This is the strongest reason not to force one-off signers into a new shared participant table right now.

## 2. `/projects/[projectId]` is invite-centric, not participant-centric

The live project detail page currently does all of this inside one project:

- shows project metadata and counts
- manages the project default template
- creates one-off invites
- displays invite share and revoke controls
- renders signed one-off consent details
- exposes headshot and matching controls tied to signed project consents

What it does not have:

- a participant section
- any recurring-profile lookup or add-to-project action
- any profile-backed project consent status

Current implication:

- the project page can evolve into a mixed participant surface
- but today it is still organized around one-off invite issuance and signed project consents

## 3. Project invite creation already uses request-scoped templates

The current project invite flow is request-scoped and template-versioned:

- `POST /api/projects/[projectId]/invites` accepts `consentTemplateId`
- if omitted, the route falls back to `projects.default_consent_template_id`
- invite creation uses `createInviteWithIdempotency(...)`
- the created `subject_invites` row stores a concrete `consent_template_id`

Current implication:

- the app already supports project-level default-template semantics
- the app already treats the actual signable template as request-scoped, not project-global
- that same pattern can be reused for profile-backed project requests

## 4. Public one-off signing and revocation are stable and project-scoped

The live one-off project flow is:

1. protected user creates a project invite
2. share happens through `/i/[token]` and QR
3. public submit creates or reuses a project-local `subjects` row
4. public submit writes one project-local `consents` row
5. revoke happens through `/r/[token]`

Important live facts:

- public invite signing is anonymous and tokenized
- one-off signing currently captures name and email at sign time
- headshot and face-match opt-in are also project-consent concerns in the one-off flow

Current implication:

- the existing one-off project intake should be preserved as-is
- mixed participation must coexist with it, not replace it

## 5. Recurring profiles are a separate reusable identity domain

The live recurring-profile module now has:

- `recurring_profiles`
- `recurring_profile_types`
- `recurring_profile_consent_requests`
- `recurring_profile_consents`
- recurring revoke tokens and events
- recurring delivery attempts for baseline follow-up

The current `/profiles` surface is baseline-centric:

- reusable person directory
- baseline consent state
- baseline request create, cancel, replace, follow-up
- placeholder-only follow-up delivery recording

Current implication:

- recurring profiles are optional reusable identities
- they are not a replacement for the one-off project flow
- the live system already distinguishes reusable identity from one-off project subject identity

## 6. The recurring consent domain already models consent as context/kind

The live recurring tables already contain `consent_kind`, even though only `baseline` is implemented today.

That matters because:

- the live codebase already treats baseline consent as a consent context, not just a template choice
- Feature 049 explicitly anticipated later non-baseline requests
- the shipped schema already left room for additional recurring-profile request contexts

Current implication:

- project-specific profile requests should also be modeled as a distinct consent context/kind
- they should not be treated as "baseline, but with another template"

## 7. Templates and public form infrastructure are already shared

Both domains already reuse:

- `consent_templates`
- structured-field definitions
- form layout definitions
- token hashing and public route patterns
- immutable signed snapshots
- revoke semantics

Current implication:

- mixed participation does not require a new template engine
- it also does not require one central consent table
- the reusable layer is the template/sign/revoke infrastructure, not the current project tables

## 8. There is no current project/profile link

Live search and code review confirmed:

- no `project_participants` table
- no `project_profile_participants` table
- no project route that loads recurring profiles
- no automatic link between `subjects` and `recurring_profiles`

Current implication:

- adding a known profile to a project requires a new additive model
- email overlap alone is not a current identity-merge mechanism

## Options considered

## Option A: Force both known profiles and one-off signers into one shared project participant table now

Possible direction:

- create one `project_participants` table for everybody
- migrate one-off invite flows to create or sync participant rows
- make profile-backed and one-off people share the same storage model immediately

Why it is attractive:

- clean participant language
- one list model on paper

Why it is the wrong fit now:

- the live one-off flow does not have a person row before signing
- current invite, subject, and consent rows are already stable and project-specific
- syncing invite rows, subject rows, and signed consent rows into a new participant table is a redesign, not a bounded step

Recommendation:

- reject for Feature 055

## Option B: Reuse current `subject_invites`, `subjects`, and `consents` for known profiles

Possible direction:

- add a recurring profile to a project
- generate a normal project invite
- maybe try to backfill the invite or subject with profile identity later

Why it is attractive:

- current public project flow already works
- the signed output is already project-scoped

Why it is still the wrong fit:

- current one-off project invites are anonymous until sign
- `subjects` are project-local and keyed by project email, not reusable identity
- adding a profile to a project is not the same action as minting a one-off invite
- this would still blur targeting with signed consent creation

Recommendation:

- reject

## Option C: Add a project-profile join and reuse the recurring-profile request/sign/revoke backbone for project-scoped profile requests

Possible direction:

- add a new project/profile participation join
- keep one-off project intake on current project invite tables
- extend the recurring-profile request/consent domain with a new project-specific consent context/kind
- attach project context to those profile-backed requests and signed records

Why this fits the live repo best:

- preserves the existing one-off project invite flow completely
- preserves the existing recurring-profile baseline flow completely
- respects the live `consent_kind` boundary in recurring tables
- keeps signed project consent project-scoped by context instead of by pretending every signer is a project-local subject
- avoids a full consent-backend rewrite

Recommendation:

- recommend

## Option D: Add a project-profile join plus wholly separate project-profile request/consent tables

Possible direction:

- add `project_profile_participants`
- add parallel project-profile request, consent, revoke-token, and event tables

Why it is viable:

- very additive
- avoids altering live baseline recurring tables

Why it is not the best bounded default:

- duplicates the request/sign/revoke lifecycle the recurring-profile module already has
- ignores the live `consent_kind` seam that already exists for future non-baseline recurring requests
- creates more backend surface than necessary before the product proves it needs a second profile-anchored consent backend

Recommendation:

- reject as the default direction for Feature 055
- revisit only if the plan phase finds a concrete implementation blocker in extending the recurring-profile request context

## Recommended bounded project participation model

## 1. Use "participants" as a product/read-model concept, not a single storage table

Recommended product language:

- `Participants` is the umbrella concept on `/projects/[projectId]`

Recommended storage direction:

- keep known profile-backed participants and one-off signers separate in storage for now
- unify them only in project read models and UI sections

Why:

- this preserves the live one-off flow
- this preserves the live recurring-profile identity model
- this avoids premature table unification

## 2. Add a new project-profile join model

Recommended bounded entity:

- `project_profile_participants`

Recommended purpose:

- represent that a known recurring profile is part of a project
- represent targeting or participation only
- not represent signed consent

Recommended minimum fields:

- `id`
- `tenant_id`
- `project_id`
- `recurring_profile_id`
- `created_by`
- `created_at`

Recommended minimum invariant:

- unique active membership per `(tenant_id, project_id, recurring_profile_id)`

Important explicit rule:

- adding a profile to a project must not create a signed consent row
- it only creates participation or targeting state

## 3. Keep one-off project signers project-local

Recommended rule:

- keep `subject_invites -> subjects -> consents` unchanged for one-off project intake

That means:

- a one-off signer stays project-local
- not every one-off signer becomes a recurring profile
- there is no forced conversion path in this feature

This preserves the current event or on-site QR flow.

## 4. Project-specific requests for known profiles should be project-scoped in meaning and recurring-profile anchored in identity

Recommended direction:

- do not reuse current `subject_invites`, `subjects`, or `consents`
- extend the recurring-profile request/sign/revoke domain with a new consent context/kind for project-specific requests
- store the project relationship on those request and signed rows

Recommended context names for clarity:

- `baseline`
- `project`

This keeps the meaning clear:

- baseline consent is reusable tenant-level consent
- project consent is specific to one project

Why this fits the live repo:

- `recurring_profile_consent_requests` and `recurring_profile_consents` already carry `consent_kind`
- the recurring module already owns tokenized public signing, replacement, revoke, and placeholder follow-up behavior for known profiles
- project-specific profile requests are still profile-anchored identity flows, even though the signed meaning is project-scoped

## 5. Signed output for profile-backed project requests should remain project-scoped, but not in the current `consents` table

Recommended answer:

- yes, the signed output is project-scoped in meaning
- no, it should not be written into the current one-off `consents` table

Why:

- current `consents` rows require `subject_id` and `invite_id`
- those rows currently mean "signed result of one project invite"
- a profile-backed project request is not the same thing as a one-off public invite

Recommended interpretation:

- project-specific profile consent can live in the recurring-profile consent domain with project context
- that still preserves the product meaning that the consent is scoped to one project only

## Recommended distinction between participant types

## 1. Profile-backed project participant

Definition:

- a known recurring profile intentionally added to a project

Characteristics:

- reusable identity already exists in `/profiles`
- can have baseline consent state independently of project state
- can receive a project-specific request
- does not become project-consented merely by being added to the project

## 2. One-off project signer

Definition:

- a person who signs only inside the current project flow

Characteristics:

- identity is captured at sign time through the existing public invite form
- remains project-local in `subjects`
- may never become a recurring profile
- current QR/public flow stays valid for this case

## 3. Recommendation on shared concept versus separate models

Recommended answer:

- use one shared participant concept in UI and read models
- keep separate storage models in the first slice

Practical result on `/projects/[projectId]`:

- `Participants`
- under it, separate known profiles from one-off signers or clearly badge their origin

Do not:

- collapse both into one table now
- hide the difference between reusable profile identity and project-local signer identity

## Request, sign, and revoke modeling direction

## 1. Adding a profile to a project is not a signed consent

This must stay explicit:

- add to project = participation or targeting only
- signed consent exists only after the person signs through a request link

This matches the current live semantics in both existing domains:

- one-off project consent only exists after invite submission
- recurring baseline consent only exists after public recurring submission

## 2. Profile-backed project requests should reuse the recurring-profile tokenized signing pattern

Recommended behavior:

- protected project action creates a project-scoped profile request
- public tokenized form handles sign
- duplicate submit returns the existing signed row
- revoke uses the same additive revoke semantics

Why:

- the repo already has a safe recurring-profile public flow for known people
- this avoids making project-specific profile requests pretend to be one-off invites

## 3. Pending request management should stay request-targeted and idempotent

Recommended rule:

- duplicate create should be idempotent
- request management should target a specific request id
- stale project UIs should not silently act on a newer request

This follows the live recurring baseline request-management pattern.

## 4. Placeholder delivery remains a reusable seam, not a prerequisite for this feature

Live status today:

- recurring baseline follow-up only records placeholder delivery
- real outbound initial email is still out of scope

Recommended Feature 055 consequence:

- do not make real email delivery a prerequisite for profile-backed project requests
- reuse copy/open and placeholder-delivery seams for the first project-profile request slice

## Recommendation on whether a central single consent table is needed now

Recommended answer:

- no

Reasons grounded in live code:

- one-off project consents are still tightly coupled to `subject_invites`, `subjects`, matching, and project detail UI
- recurring profile consents are already a separate anchored identity domain with their own request and revoke lifecycle
- shared infrastructure already exists where it matters:
  - templates
  - structured fields
  - public token patterns
  - revoke semantics
  - idempotency patterns

The bounded move is additive modeling, not a polymorphic "all consents in one table" redesign.

## Recommendation on baseline consent as context vs template type

Recommended answer:

- baseline consent is a consent context/kind, not just a template choice
- project-specific profile consent should also have its own context/kind
- both should reuse the same `consent_templates` engine

Why this is already true in live code:

- recurring-profile requests already persist `consent_kind = 'baseline'`
- baseline is therefore already modeled as context, not just "whatever template happened to be used"

Recommended clarity going forward:

- `template` answers "what text and fields were signed"
- `context/kind` answers "what the signed consent means"
- `project` context should not be inferred only from template naming

## Templates in the mixed model

Recommended direction:

- keep using `consent_templates`
- keep request rows pointing at one concrete version row
- keep archived linked templates signable for already-issued links

Recommended project behavior:

- project default template should remain the default source for project-specific consent work
- both one-off invites and profile-backed project requests should be able to use that same project default
- the data model should still allow a different concrete template version per request when needed

Why:

- live project invites already allow per-request template choice
- auditability depends on concrete request-linked versions
- "same default by default, request-scoped version underneath" matches current project behavior best

## Recommended `/projects` responsibility split

## `/projects`

Keep as:

- project list and project creation

No major redesign is needed there in the first mixed-participation slice.

## `/projects/[projectId]`

Recommended future additions:

- a `Participants` section
- `Add existing profile` control
- list of profile-backed participants with:
  - profile identity
  - archived-profile indicator when relevant
  - baseline consent badge as informative context only
  - project-specific consent status
- the current one-off invite/QR area kept as a separate one-off intake surface
- the current signed one-off consent list kept visible

Recommended first organization:

- `Known profiles`
- `One-off signers and invite links`

This is clearer than one merged table.

## `/profiles`

Keep as:

- reusable identity directory
- baseline consent home
- profile-centric history and follow-up surface

Do not turn `/profiles` into the operational home for project-specific participant management. A profile detail view may later link out to projects, but projects should own project-specific participation.

## Security and reliability considerations

- tenant scope must remain server-derived on every new join, request, and signed row
- never accept `tenant_id` from the client
- duplicate add-profile-to-project should be naturally idempotent via a unique constraint
- duplicate profile-backed project request creation should use idempotency
- request lifecycle actions should remain request-targeted
- adding a profile to a project must not silently create consent
- baseline consent must not be treated as satisfying project-specific consent
- project-specific consent in one project must not satisfy another project
- archived recurring profiles should remain visible in projects for history, but new request actions should be blocked
- archived templates already linked to issued requests should remain signable
- signed records remain immutable; revocation stays additive
- stale project pages should refresh from server data after mutation

## Edge cases

## 1. Duplicate add-profile-to-project clicks

Recommended behavior:

- one join row only
- repeated add returns the existing participant relation

## 2. Adding a profile that already has baseline consent

Recommended behavior:

- show baseline as informative reusable status
- do not treat it as project-signed
- project-specific consent is still its own state

## 3. Profile has project-specific consent in one project but not another

Recommended behavior:

- keep states independent per project
- do not elevate project consent to tenant-wide reusable status

## 4. Archived profile already linked to a project

Recommended behavior:

- keep the participant relation and history visible
- block new project-specific requests while the profile is archived

## 5. Template archived after a project-specific profile request was created

Recommended behavior:

- keep the already-issued link signable
- preserve concrete template snapshot semantics exactly as current one-off and recurring flows do

## 6. One-off signer never becomes a profile

Recommended behavior:

- fully supported
- no conversion required

## 7. Existing recurring profile shares the same business email as a one-off project signer

Example:

- a recurring profile already exists
- a photographer still uses the standard one-off project QR flow
- the signer enters the same business email as the existing profile

Recommended bounded behavior:

- keep them separate
- do not auto-link
- do not auto-merge
- do not block the one-off sign flow

Why:

- current one-off signer identity is project-local by design
- business emails can be stale, shared, or reused
- the repo has no current safe merge-review workflow
- false positives are more dangerous than temporary duplication here

Recommended future posture:

- a later manual review hint or suggestion may be acceptable
- automatic identity merging should stay out of scope for Feature 055

## Explicitly deferred work

- facial matching redesign
- profile headshots or CompreFace integration
- asset-triggered request generation
- bulk project send
- reminders or scheduling for project-specific profile requests
- real outbound email delivery redesign
- generic participant CRM
- forced conversion of one-off signers to recurring profiles
- project export redesign
- DAM integration changes
- central single-consent-table redesign
- automatic profile linking or identity merging based on email overlap alone

## Recommended smallest coherent first implementation slice after research

The best bounded next slice is:

1. add known recurring profiles to a project through a new project/profile join
2. add a participant section to `/projects/[projectId]`
3. show known profiles and one-off signers separately in that project
4. allow creating one project-specific request for one added profile
5. keep the current QR/public one-off consent flow unchanged

This is the smallest slice that proves mixed participation without redesigning the one-off project backend.

## Open decisions for the plan phase

- Exact table and naming shape for the project/profile join:
  - `project_profile_participants`
  - or another equivalent name
- Exact recurring consent context name for project-specific profile requests:
  - `project`
  - or a more explicit project-specific variant
- Exact request row shape for project context:
  - whether to reference `project_id` directly
  - whether to also reference the project/profile join row
- Whether the first project-profile request action should default to `projects.default_consent_template_id` automatically, or require explicit selection when no default exists
- Whether `/projects/[projectId]` should show baseline consent badges for known profiles in the first slice, or keep the first display focused only on project participation plus project consent state
- Whether the first project page UX should use inline row actions, a small panel, or a compact participant drawer for profile-backed request creation
- Whether active project-specific profile requests should reuse the existing recurring follow-up placeholder-delivery seam immediately, or start with copy-link-only actions

## Research conclusion

The smallest coherent Feature 055 is an additive mixed-participation model:

- preserve the current one-off project invite flow for QR/public signers
- add a new project/profile participation join for known recurring profiles
- make it explicit that adding a profile to a project is not the same thing as signed consent
- model project-specific profile requests as a distinct consent context/kind, not merely another template choice
- reuse the recurring-profile request/sign/revoke backbone for profile-backed project requests
- keep one-off project signers and recurring profiles separate in storage, but present them together under a project-level `Participants` concept
- do not build a central single consent table now

That direction is bounded, additive, production-oriented, and consistent with the live repo after Features 049-054.
