# Feature 055 Plan: Project Participants and Mixed Consent Intake

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
12. `docs/rpi/052-baseline-request-management/plan.md`
13. `docs/rpi/053-recurring-consent-history-and-profile-detail/research.md`
14. `docs/rpi/053-recurring-consent-history-and-inline-profile-detail/plan.md`
15. `docs/rpi/054-baseline-follow-up-actions/research.md`
16. `docs/rpi/054-baseline-follow-up-actions/plan.md`
17. `docs/rpi/055-project-participants-and-mixed-consent-intake/research.md`

Targeted live verification for plan-critical boundaries:

- `supabase/migrations/20260304210000_002_projects_invites_schema.sql`
- `supabase/migrations/20260305103000_003_consent_templates_submit.sql`
- `supabase/migrations/20260414193000_051_baseline_recurring_consent_request_foundation.sql`
- `supabase/migrations/20260414224500_054_baseline_follow_up_delivery_attempts.sql`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/app/api/projects/[projectId]/invites/route.ts`
- `src/app/api/projects/[projectId]/default-template/route.ts`
- `src/components/projects/create-invite-form.tsx`
- `src/components/projects/project-default-template-form.tsx`
- `src/lib/idempotency/invite-idempotency.ts`
- `src/lib/profiles/profile-consent-service.ts`
- `src/lib/profiles/profile-follow-up-service.ts`
- `src/lib/templates/template-service.ts`
- `src/lib/tokens/public-token.ts`
- `src/lib/url/paths.ts`
- `messages/en.json`
- `messages/nl.json`

Use the live repository schema and code as source of truth. Use Feature 055 research as the primary product synthesis. This plan does not reopen broad recurring-profile design questions already settled in Features 049-054.

## Verified current planning boundary

- The live project consent backend is still one-off and project-local:
  - `subject_invites`
  - `subjects`
  - `consents`
  - `revoke_tokens`
  - `consent_events`
- `/projects/[projectId]` is still invite-centric:
  - project metadata
  - project default template management
  - one-off invite creation
  - invite share and revoke controls
  - signed one-off consent details
  - matching and headshot controls tied to signed one-off consents
- One-off project signing is unchanged and should remain unchanged in Feature 055:
  - anonymous invite token until sign
  - project-local subject row created at sign time
  - project-local consent row created from the invite
- The recurring-profile module is already a real reusable identity and consent domain:
  - `recurring_profiles`
  - `recurring_profile_consent_requests`
  - `recurring_profile_consents`
  - recurring revoke tokens and events
  - recurring follow-up placeholder-delivery attempts
- The recurring request tables already model consent as context through `consent_kind`, currently restricted to `baseline`.
- The recurring module already has the server-side patterns Feature 055 needs:
  - idempotent protected request creation
  - tokenized public sign and revoke
  - immutable signed snapshots
  - request-targeted lifecycle logic
  - shared template lookup and project-independent token paths
- The project surface already has default-template semantics:
  - project invite create accepts explicit `consentTemplateId`
  - if omitted, it falls back to `projects.default_consent_template_id`
- There is no existing mixed-participation primitive:
  - no `project_participants`
  - no `project_profile_participants`
  - no project/profile request route
  - no automatic link between one-off `subjects` and `recurring_profiles`

Planning consequence:

- Feature 055 should add mixed participation additively.
- It should not redesign the one-off project consent backend.
- It should not collapse one-off signers and recurring profiles into one storage model.

## Recommendation

Implement Feature 055 as an additive bridge between the project domain and the recurring-profile consent backbone.

Concrete decisions:

- Add a new project/profile participation join table:
  - `project_profile_participants`
- Use `Participants` as the product and read-model concept on `/projects/[projectId]`, but keep storage split:
  - profile-backed participants in `project_profile_participants`
  - one-off invite/signer flow stays on `subject_invites -> subjects -> consents`
- Extend the recurring-profile request/sign/revoke tables with a new `project` consent context instead of creating a separate project-profile consent table family.
- Store project context directly on recurring request and signed rows through `project_id`.
- Do not store project-specific profile consent in the current one-off `consents` table.
- Reuse `projects.default_consent_template_id` as the default template source for project-specific profile requests.
- Allow explicit per-request template override for project-specific profile requests.
- Make the first project-profile request slice copy-link-first.
- Do not reuse placeholder delivery for project-profile initial requests in this cycle.
- Show baseline consent state for known profiles on the project page as informative context only.
- Keep one-off quick actions and public QR/invite flow unchanged.
- Keep one-off signers and recurring profiles fully separate when emails overlap.

## Chosen architecture

### Storage model

Feature 055 keeps two participant storage paths under one project-level read model.

Known profiles:

- new `project_profile_participants`
- recurring-profile request and signed-consent tables reused with `consent_kind = 'project'`

One-off project signers:

- unchanged `subject_invites`
- unchanged `subjects`
- unchanged `consents`

This is a read-model union, not a storage unification.

### Service and route shape

Recommended new protected project routes:

- `POST /api/projects/[projectId]/profile-participants`
- `POST /api/projects/[projectId]/profile-participants/[participantId]/consent-request`

Recommended new project-side server helpers:

- `src/lib/projects/project-participants-service.ts`
- `src/lib/projects/project-participants-route-handlers.ts`

Recommended recurring public flow direction:

- keep the existing recurring public route namespace:
  - `GET /rp/[token]`
  - `POST /rp/[token]/consent`
  - `GET /rr/[token]`
  - `POST /rr/[token]/revoke`
- extend those loaders and submit/revoke services to handle:
  - `consent_kind = 'baseline'`
  - `consent_kind = 'project'`

Reasoning:

- token and path helpers are already recurring-profile scoped, not baseline-only
- this avoids a second public profile-consent route family
- public pages can branch copy and headings from `consent_kind`

### Project page responsibility split

Keep `/projects` unchanged as list and project creation.

Evolve `/projects/[projectId]` into:

- a new `Participants` section
- the current asset section unchanged
- the current one-off invite functionality preserved, but framed as one participant subtype

Do not move project-specific participant work into `/profiles`.

## Exact scope boundary

### Real in Feature 055

- additive schema for project/profile participation
- participant read model on `/projects/[projectId]`
- separate presentation of:
  - known profiles
  - one-off signers and invite links
- add existing recurring profiles to a project
- create one project-specific request for one added profile
- project-scoped consent status for profile-backed participants
- project default template reuse for profile-backed project requests
- explicit per-request template override
- i18n-backed project UI for mixed participants

### Unchanged in Feature 055

- one-off public QR and invite flow
- one-off invite revoke behavior
- one-off signed project consent storage and rendering
- recurring baseline flows on `/profiles`
- recurring follow-up placeholder delivery behavior
- matching, headshots, and asset workflows tied to one-off project consents

### Deferred from Feature 055

- remove or archive profile participation from a project
- project-profile cancel, replace, reminder, or follow-up flows
- batch add or batch send
- reminders and scheduling
- real outbound project-profile request delivery
- facial matching redesign
- profile editing redesign
- generic participant CRM
- automatic one-off/profile linking
- central single-consent-table redesign

## Exact project/profile participation model

### Table

Add:

- `public.project_profile_participants`

### Columns

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null references public.tenants(id) on delete cascade`
- `project_id uuid not null`
- `recurring_profile_id uuid not null`
- `created_by uuid not null references auth.users(id) on delete restrict`
- `created_at timestamptz not null default now()`

### Foreign keys

- `(project_id, tenant_id)` -> `public.projects(id, tenant_id)` on delete restrict
- `(recurring_profile_id, tenant_id)` -> `public.recurring_profiles(id, tenant_id)` on delete restrict

### Indexes and uniqueness

- unique `(id, tenant_id)`
- unique `(tenant_id, project_id, recurring_profile_id)`
- index `(tenant_id, project_id, created_at desc)`
- index `(tenant_id, recurring_profile_id, created_at desc)`

### Decisions resolved

- Unique active participation per `(tenant_id, project_id, recurring_profile_id)` is required now.
- Feature 055 does not add remove-from-project or archive-from-project behavior.
- Because remove is deferred, the table can stay create-only with a plain unique constraint and no `archived_at`.
- Archived recurring profiles remain readable through the participant relation and stay visible on the project page.

### Add-participant route behavior

Recommended route:

- `POST /api/projects/[projectId]/profile-participants`

Recommended request body:

- `recurringProfileId`

Recommended auth:

- authenticated tenant member with access to the project, matching the current project invite boundary
- do not add owner/admin-only restriction for project participant actions in this slice

Recommended idempotency behavior:

- no `Idempotency-Key` required
- use unique constraint plus upsert-or-select behavior
- return `201` on fresh insert
- return `200` with the existing participant row when already linked

Reasoning:

- this is a create-only join
- the DB uniqueness naturally handles duplicate clicks and retries
- project operations today are not owner/admin-only

## Exact request/sign/revoke modeling direction

### Chosen direction

Project-specific profile requests extend the recurring-profile request/sign/revoke tables.

Do not add:

- `project_profile_consent_requests`
- `project_profile_consents`
- separate project-profile revoke-token or event tables

### Required schema changes

Alter `public.recurring_profile_consent_requests`:

- expand `consent_kind` check to:
  - `'baseline'`
  - `'project'`
- add `project_id uuid null`
- add `(project_id, tenant_id)` foreign key to `projects`
- add check constraint:
  - baseline rows require `project_id is null`
  - project rows require `project_id is not null`

Alter `public.recurring_profile_consents`:

- expand `consent_kind` check to:
  - `'baseline'`
  - `'project'`
- add `project_id uuid null`
- add `(project_id, tenant_id)` foreign key to `projects`
- add check constraint:
  - baseline rows require `project_id is null`
  - project rows require `project_id is not null`

### Uniqueness rules

Keep the current baseline uniqueness logic, but split it by context.

Requests:

- baseline pending unique:
  - `(tenant_id, profile_id, consent_kind)` where `consent_kind = 'baseline' and status = 'pending'`
- project pending unique:
  - `(tenant_id, profile_id, project_id, consent_kind)` where `consent_kind = 'project' and status = 'pending'`

Signed rows:

- baseline active signed unique:
  - `(tenant_id, profile_id, consent_kind)` where `consent_kind = 'baseline' and revoked_at is null`
- project active signed unique:
  - `(tenant_id, profile_id, project_id, consent_kind)` where `consent_kind = 'project' and revoked_at is null`

### Why `project_id` directly, not `project_profile_participant_id`

Decision:

- store `project_id` directly on request and signed rows
- do not store `project_profile_participant_id` in Feature 055

Reasoning:

- the participant join remains the authoritative project-membership record
- there is only one allowed participant row per project/profile pair
- `tenant_id + profile_id + project_id` is enough to derive project-specific consent state
- this avoids extra foreign-key complexity on every request and signed row in the first slice

### Protected request creation

Add a dedicated protected creation path for project-profile requests:

- route:
  - `POST /api/projects/[projectId]/profile-participants/[participantId]/consent-request`
- service:
  - project-side service under `src/lib/projects/`
- SQL function:
  - add a dedicated project request create RPC that writes to the recurring request table with `consent_kind = 'project'`

Recommended SQL function name:

- `public.create_recurring_profile_project_consent_request(...)`

Reasoning:

- project creation logic should be explicit about project scoping
- the underlying storage is shared, but the protected create semantics differ from baseline

### Public sign and revoke

Extend the recurring public request lookup, submit, and revoke functions so they remain request-row based but become kind-aware.

Required behavior:

- duplicate submit still returns the existing signed row
- revoke still consumes the revoke token and updates the signed row
- public project-profile consent stays project-scoped in meaning because the signed row carries `project_id`
- archived templates already linked to a request remain signable

### First-slice request management decision

Feature 055 is copy-link-first for project-profile requests.

Real now:

- create request
- return current link
- copy or open current link from the project page

Deferred:

- cancel
- replace
- reminder
- follow-up delivery attempts

Reasoning:

- mixed participation is the main product proof in this cycle
- the recurring follow-up seam exists, but reusing it here would expand scope beyond the smallest bridge

## Exact project-specific request creation behavior

### Route

- `POST /api/projects/[projectId]/profile-participants/[participantId]/consent-request`

### Auth

- authenticated tenant member required
- tenant derived server-side only
- project must exist in the tenant
- participant row must belong to the project and tenant
- do not add owner/admin-only restriction in this slice

### Request body

- `consentTemplateId?: string | null`

### Idempotency

- `Idempotency-Key` required

Recommended operation namespace:

- `create_project_profile_consent_request:${participantId}`

### Behavior

Inside a transaction or SQL-backed create function:

1. load and validate the project participant row in-tenant
2. reject archived recurring profiles for new request creation
3. resolve the project template:
   - explicit `consentTemplateId` if supplied
   - otherwise `projects.default_consent_template_id`
4. require a published visible template at request creation time
5. reject when an active signed project consent already exists for that profile in that project
6. return the existing active pending project request when one already exists
7. otherwise create one new pending recurring request row with:
   - `consent_kind = 'project'`
   - `project_id = current project`
   - profile name and email snapshot
   - linked concrete template id
8. return the copyable recurring public path

### Response shape

```json
{
  "request": {
    "id": "uuid",
    "participantId": "uuid",
    "profileId": "uuid",
    "projectId": "uuid",
    "consentTemplateId": "uuid",
    "status": "pending",
    "expiresAt": "ISO-8601",
    "consentPath": "/rp/..."
  }
}
```

### Status codes

- `201` on new request
- `200` on existing pending request replay
- `409` when active signed project consent already exists
- `409` when project default template is missing or archived and no explicit template was supplied

## Exact one-off coexistence model

One-off project signers remain fully on the current project backend.

Preserve:

- current QR/public invite flow
- current invite list and share actions
- current invite revoke behavior
- current one-off signed consent details
- current matching and headshot behavior tied to one-off project consents

Feature 055 does not add:

- one-off participant pre-registration rows
- forced profile conversion
- automatic sync from `subjects` into `recurring_profiles`

UI implication:

- one-off signers remain a participant subtype on the project page
- they are shown next to known profiles conceptually, but not unified in storage

## Exact template and default-template behavior

### Default source

Reuse `projects.default_consent_template_id` as the default source for profile-backed project requests.

### Override

Allow explicit per-request override in Feature 055.

### Resulting rule

Both of these may use the same project default by default:

- one-off project invites
- profile-backed project requests

But both remain request-scoped at the actual signed template level.

### Missing or archived default

If the project default is no longer a visible published template:

- show the same project default warning already used by the page
- require explicit template selection for the project-profile request
- do not create a request without a valid concrete template id

### Archived after issuance

If the request was already created and its linked template is later archived:

- keep the issued link signable
- preserve the same immutable snapshot semantics as current one-off and recurring flows

## Exact participant/read-model responsibilities

### Known profile participant read model

Source tables:

- `project_profile_participants`
- `recurring_profiles`
- `recurring_profile_consent_requests`
- `recurring_profile_consents`

Derived fields per known profile row:

- participant relation id
- profile identity:
  - full name
  - email
  - type label
  - profile status
- baseline consent state badge as informative context only
- project-specific consent state for this project:
  - `missing`
  - `pending`
  - `signed`
  - `revoked`
- current pending request summary when present:
  - request id
  - expires at
  - consent path
- latest project-specific activity timestamp

### One-off participant read model

Source tables:

- existing `subject_invites`
- existing `subjects`
- existing `consents`

Presentation stays close to the current project invite list:

- pending invite links
- signed one-off subjects
- consent details
- revoke/remove actions where already supported

### Baseline badge decision

Show baseline consent state on known profile rows as informative context only.

Do not use it to drive project-specific status or actions.

Reasoning:

- it is useful staff context
- it must remain visually secondary
- baseline consent does not satisfy project consent

## Exact `/projects/[projectId]` page evolution

### Top-level page shape

Keep the page structure bounded.

Add:

- new section anchor:
  - `Participants`

Keep:

- existing project summary header
- existing assets section

### Participants section

Recommended structure:

- `Participants`
- subsection `Known profiles`
- subsection `One-off signers and invite links`

### Known profiles subsection

Add:

- `Add existing profile` control
- list of added recurring profiles
- per-row project-specific consent status
- baseline badge as secondary context
- copy/open controls for current pending project request
- request action for rows without project consent

First-slice actions for known profile rows:

- `Add existing profile`
- `Create request`
- `Copy link`
- `Open link`

Do not add:

- cancel
- replace
- send reminder

### One-off subsection

Keep the current one-off invite surface essentially unchanged, but present it as the one-off participant area.

Preserve:

- current create-invite form
- current invite list
- current invite share and revoke actions
- current signed one-off consent details

### Sidebar / form placement

Keep the right-side form column and extend it minimally.

Recommended order:

1. project default template form
2. add existing profile form
3. create one-off invite form

This preserves the current page rhythm without redesigning the whole layout.

### Navigation labels

Update project section navigation to include:

- `Participants`
- `Assets`

Do not add more top-level anchors in this slice.

## Exact identity overlap edge case

Scenario:

- a recurring profile already exists
- staff still uses the normal one-off project QR/invite flow
- the signer enters the same business email as the existing profile

Decision for Feature 055:

- keep them separate
- do not auto-link
- do not auto-merge
- do not block the one-off sign flow
- do not create a manual review workflow in this cycle

Reasoning:

- one-off `subjects` are project-local by design
- email is too weak for safe automatic identity merge
- stale, shared, and role-based business inboxes make false positives likely
- the repository has no current audit-safe merge-review surface

Future room:

- a later manual suggestion or review queue may be acceptable
- not in Feature 055

## Security and reliability considerations

- tenant is always derived server-side
- never trust client-provided `tenant_id`
- adding a profile to a project is participation only, never signed consent
- baseline consent must not satisfy project-specific consent
- project-specific consent in one project must not satisfy another project
- one-off project consent and profile-backed project consent remain separate records
- duplicate add-profile is naturally idempotent through DB uniqueness
- project-profile request creation must require `Idempotency-Key`
- stale project pages must re-fetch after add or request creation
- archived profiles remain readable but block new project-specific request creation
- archived templates already linked to issued requests remain signable
- signed records remain immutable except revoke metadata
- parameterized query-builder or RPC APIs only
- project request creation should follow the same thin-route plus service pattern as current project and recurring flows

### Auth boundary decision

Project participant actions should follow the current project mutation boundary, not the recurring profile-management boundary.

That means:

- authenticated tenant member with project access can add a known profile to a project
- authenticated tenant member with project access can create a project-specific profile request
- Feature 055 does not require owner/admin role just because the identity comes from the profiles directory

Reasoning:

- the action is project participation and project consent collection
- it does not edit the recurring profile record itself
- current project invite creation is already available on that broader boundary

## Edge cases

- Duplicate add-profile clicks create only one join row.
- Adding a profile that already has baseline consent still shows project consent as missing until a project-specific request is signed.
- A profile with project consent in one project remains missing in another project until that other project gets its own request and signature.
- Archived profile already linked to a project remains visible and historically readable, but request actions are disabled.
- Template archived after request creation does not invalidate the issued project-profile link.
- One-off signer never becomes a profile and remains fully supported.
- Same-email overlap between a one-off signer and an existing recurring profile stays separate.
- Stale project page state after request creation, sign, or revoke must be corrected by server refresh.
- If project default template is missing and the UI was stale, request create should fail with an explicit template-selection error instead of creating an invalid request.
- If a pending project-specific request already exists and the user retries creation with another idempotency key, return the existing pending request rather than creating a second one.

## Test plan

Minimum real coverage for Feature 055:

### Schema and migration tests

- `project_profile_participants` uniqueness by `(tenant_id, project_id, recurring_profile_id)`
- recurring request tables accept both `baseline` and `project`
- baseline rows require `project_id is null`
- project rows require `project_id is not null`
- project pending-request uniqueness is per profile per project
- project active-signed uniqueness is per profile per project

### Service and route tests

- add-profile route inserts a participant row
- add-profile route returns existing participant row on duplicate add
- project-profile request create uses explicit template override when supplied
- project-profile request create falls back to `projects.default_consent_template_id` when no explicit template is supplied
- request create returns conflict when active signed project consent already exists
- request create returns existing pending project request on retry or concurrent duplicate
- archived profile blocks new project-profile request creation

### Public recurring flow tests

- project-kind request tokens load successfully through `/rp/[token]`
- project-kind submit writes a signed recurring consent row with `consent_kind = 'project'` and the correct `project_id`
- duplicate submit returns the existing signed row
- revoke works for project-kind recurring consent
- archived linked templates remain signable for already-issued project-kind requests

### Project page UI tests

- project detail shows `Participants`
- known profiles and one-off invite/signer content render as separate subsections
- known profile rows show baseline badge as informative context only
- one-off quick actions remain unchanged
- add existing profile form and project-profile request action use i18n-backed labels

### Edge-case tests

- same-email overlap between one-off signer and recurring profile stays separate
- archived profile linked to project remains visible
- project-specific consent in one project does not bleed into another project

## Implementation phases

1. Schema and recurring-context foundation
   - add `project_profile_participants`
   - extend recurring request and signed tables with project context
   - update recurring SQL functions and constraints for `consent_kind = 'project'`

2. Project participant service and routes
   - add project participant read and mutation services
   - implement add-profile route
   - implement project-profile request create route

3. Project page participant read model and UI
   - add `Participants` section
   - add known profiles subsection
   - reframe current invite surface as one-off participant subsection
   - add copy/open for current project-profile request links

4. Public project-profile sign and revoke support
   - extend recurring public request/revoke loaders and submit handlers for project context
   - add project-aware public copy and headings

5. Tests and i18n polish
   - schema, service, route, and public-flow coverage
   - English and Dutch message additions
   - page rendering and edge-case coverage

## Explicitly deferred follow-up cycles

- project participant removal or archival
- project-profile request cancel, replace, reminder, and follow-up
- placeholder delivery attempts for project-profile requests
- batch add or batch send
- facial matching redesign
- headshot/profile identity redesign
- import and sync
- automatic identity merge or link suggestion
- unified participant storage
- unified central consent table
- export or DAM redesign

## Concise implementation prompt

Implement Feature 055 as an additive mixed-participation bridge on `/projects/[projectId]`. Add a new `project_profile_participants` join table keyed by tenant, project, and recurring profile. Keep one-off project intake unchanged on `subject_invites -> subjects -> consents`, but add a new `Participants` section that shows `Known profiles` and `One-off signers and invite links` separately under one participant-oriented page model. Extend `recurring_profile_consent_requests` and `recurring_profile_consents` with `consent_kind = 'project'` plus `project_id`, keep project-specific profile consent out of the one-off `consents` table, and create project-profile requests through a protected route at `POST /api/projects/[projectId]/profile-participants/[participantId]/consent-request` with required `Idempotency-Key`, project-default-template fallback, and explicit per-request override support. Make the first profile-backed request slice copy-link-first, reuse the existing recurring public sign and revoke route family for project-kind requests, show baseline consent as informative context only on known profile rows, keep one-off invite actions unchanged, and do not auto-link one-off signers to recurring profiles even when emails overlap.
