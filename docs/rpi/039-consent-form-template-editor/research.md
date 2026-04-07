# Consent Form Template Editor Research

Feature folder corrected to `039-consent-form-template-editor`.

## Scope

Research how to extend the current consent-template system so the app can support:

- standard app-wide templates maintained centrally by the application
- tenant-owned templates maintained by each organization
- use of those templates in projects
- reproducible, auditable signed consents tied to the template/version used at signing

This research is intentionally bounded. It focuses on extending the current model without redesigning the entire consent system or prematurely modeling the eventual "eligible templates per project, photographer picks later" workflow.

## Inputs reviewed

### Project docs

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/002-projects-invites/research.md`
- `docs/rpi/003-consent-templates/research.md`
- `docs/rpi/003-consent-templates/plan.md`
- `docs/rpi/006-headshot-consent/research.md`
- `docs/rpi/SUMMARY.md`

### Schema and RLS

- `supabase/migrations/20260304210000_002_projects_invites_schema.sql`
- `supabase/migrations/20260304211000_002_projects_invites_rls.sql`
- `supabase/migrations/20260304212000_002_projects_invites_idempotency.sql`
- `supabase/migrations/20260305000100_fix_submit_public_consent_ambiguity.sql`
- `supabase/migrations/20260305100000_003_consent_templates_schema.sql`
- `supabase/migrations/20260305101000_003_consent_templates_rls.sql`
- `supabase/migrations/20260305102000_003_consent_templates_seed.sql`
- `supabase/migrations/20260305103000_003_consent_templates_submit.sql`
- `supabase/migrations/20260305123000_fix_submit_public_consent_for_update.sql`
- `supabase/migrations/20260306100000_006_headshot_consent_schema.sql`
- `supabase/migrations/20260306101000_006_headshot_consent_submit_rpc.sql`
- `supabase/migrations/20260306103000_fix_submit_public_consent_headshot_ambiguity.sql`
- `supabase/migrations/20260307140000_optimize_rls_auth_function_calls.sql`

### Current code paths

- `src/app/api/projects/route.ts`
- `src/app/(protected)/projects/page.tsx`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/app/api/projects/[projectId]/invites/route.ts`
- `src/app/api/projects/[projectId]/invites/[inviteId]/revoke/route.ts`
- `src/app/i/[token]/page.tsx`
- `src/app/i/[token]/consent/route.ts`
- `src/app/api/public/invites/[token]/headshot/route.ts`
- `src/app/api/public/invites/[token]/headshot/[assetId]/finalize/route.ts`
- `src/components/projects/create-invite-form.tsx`
- `src/components/public/public-consent-form.tsx`
- `src/lib/idempotency/invite-idempotency.ts`
- `src/lib/invites/public-invite-context.ts`
- `src/lib/consent/submit-consent.ts`
- `src/lib/tenant/resolve-tenant.ts`
- `src/lib/tokens/public-token.ts`
- `src/lib/email/send-receipt.ts`
- `src/lib/email/templates/consent-receipt.ts`
- `src/lib/consent/constants.ts`

### Relevant tests

- `tests/feature-023-request-uri-safety.test.ts`
- `tests/feature-029-complete-bounded-matching-fanout.test.ts`

These tests are useful because they create `consent_templates` rows directly with a service-role client, which confirms there is no normal in-app template CRUD path today.

## Verified current behavior

## 1. Current state

### How consent templates are modeled today

Templates are currently modeled as a single global `public.consent_templates` table.

Current columns:

- `id uuid primary key`
- `template_key text not null`
- `version text not null`
- `body text not null`
- `status text not null default 'active' check (status in ('active', 'retired'))`
- `created_by uuid null`
- `created_at timestamptz not null`

Current constraints:

- `unique (template_key, version)`
- index on `(template_key, status)`

Current limitations:

- no `tenant_id`
- no human `name`
- no `description`
- no `category`
- no draft state
- no DB-level immutability trigger
- no explicit template-family table
- `version` is freeform `text`, not an internal numeric sequence

### Are templates global-only, tenant-only, or mixed?

Today they are global-only.

Evidence:

- `consent_templates` has no `tenant_id`
- RLS only grants authenticated `SELECT`
- project pages query all active templates with no tenant filter

### How versions are represented

Each version is its own row in `consent_templates`.

Current "family" identity is implicit:

- family-like key: `template_key`
- version-like value: `version`
- concrete version row identity: `id`

There is no separate template-family record. A template family is effectively "all rows with the same `template_key`".

### How a consent is currently linked to a template/version

There are two links today:

- `subject_invites.consent_template_id` points to a specific template row
- `consents` stores `consent_text` and `consent_version` snapshots copied at signing time

Important nuance:

- `consents` does **not** store a foreign key to `consent_templates`
- signed-consent reproducibility currently depends on the snapshot fields on `consents`, not on re-reading the template table later

### How templates are currently selected or used

#### Project/invite flow

- `src/app/(protected)/projects/[projectId]/page.tsx` loads all active template rows from `consent_templates`
- `src/components/projects/create-invite-form.tsx` renders a dropdown of those rows as `template_key version`
- `src/app/api/projects/[projectId]/invites/route.ts` accepts `consentTemplateId`
- if none is provided, the route falls back to:
  - `projects.default_consent_template_id`, if already set in DB
  - otherwise the latest active `gdpr-general` row by `version desc`
- `src/lib/idempotency/invite-idempotency.ts` validates that the chosen template row exists and is `active`, then stores `subject_invites.consent_template_id`

#### Public consent flow

- `src/app/i/[token]/page.tsx` calls RPC `get_public_invite`
- the current RPC joins `subject_invites` to `consent_templates` and returns:
  - `consent_text`
  - `consent_version`
- `src/components/public/public-consent-form.tsx` displays those values
- `src/app/i/[token]/consent/route.ts` calls `submitConsent()`
- `src/lib/consent/submit-consent.ts` calls RPC `submit_public_consent`
- the current RPC locks the invite row, re-reads the linked template row, then inserts `consents.consent_text` and `consents.consent_version`

### Is there already any template CRUD UI/API?

No.

Verified findings:

- there are no template management routes under `src/app/api/**`
- there is no template editor UI in `src/app/**` or `src/components/**`
- the only in-app template interaction is selecting an existing active row during invite creation
- app-wide templates are currently seeded and effectively maintained via migrations or service-role access

Also note:

- `src/lib/consent/constants.ts` still contains old hardcoded defaults, but it is currently unused by the live signing flow
- that file is stale historical residue, not the current source of truth

### Does the current system already snapshot template content/version onto signed consents?

Yes.

This is already one of the strongest current invariants:

- invite references a specific template row
- signing RPC copies `template.body` and `template.version` into `consents`
- receipt email uses the copied `consent_text` and `consent_version`
- project UI displays the copied `consent_text` and `consent_version` from the signed consent

So signed-consent auditability already depends on snapshots, not live template reads.

## 2. Current ownership, permissions, and tenant scoping

### Membership and tenant model

Current tenant model:

- `memberships(tenant_id, user_id, role)`
- roles are limited to `owner`, `admin`, `photographer`

Current code reality:

- app code checks membership existence
- app code does **not** currently enforce role-specific behavior for template use, project creation, invite creation, or consent operations
- there is no platform-admin concept anywhere in the current repo

This matters because "app-wide templates maintained centrally by the application" cannot be mapped onto an existing user-facing admin role today. Tenant roles are tenant-local only.

### Tenant scoping

Current tenant scoping is consistent and server-first:

- protected routes derive tenant with `current_tenant_id()` / `ensure_tenant_for_current_user()`
- protected queries explicitly filter `.eq("tenant_id", tenantId)`
- RLS for tenant tables is membership-based
- public routes never trust client-provided tenant/project IDs; they derive scope from the invite token or revoke token

### Current template visibility

Today:

- any authenticated user can `SELECT` from `consent_templates`
- no authenticated user can `INSERT`, `UPDATE`, or `DELETE` through normal RLS-governed clients
- public users do not have direct table access, but public RPCs can read template data through `security definer`

So templates are effectively "global read-only catalog for authenticated users".

## 3. Current versioning and immutability behavior

### What is already safe

Safe today:

- invite locks to one specific template row via `consent_template_id`
- signing copies body/version snapshot into `consents`
- revoke flow does not alter historical grant data
- receipt content is built from the consent snapshot

### What is not enforced today

Not enforced today:

- no DB rule prevents updating `consent_templates.body`
- no DB rule prevents reusing confusing `version` strings
- no draft workflow
- no published-vs-editable split
- no "current version" marker

Implication:

- signed consents remain reproducible because of the snapshot
- unsigned invites do **not** have the same protection if someone mutates a template row in place
- the future editor must not update published rows in place if auditability and predictability are the goal

### Current project reference behavior

`projects.default_consent_template_id` references a specific template row, not a family.

Important nuance:

- there is currently no UI or API that lets a user set or update `projects.default_consent_template_id`
- the field exists, but current product behavior mainly relies on explicit template selection in the invite form

## 4. Current editor scope in this repo

Today, the "template" only contains:

- legal/body text
- a family-like key (`template_key`)
- a version label (`version`)
- coarse status (`active` or `retired`)

The following are **not** currently template-driven:

- structured form fields
- configurable purposes/channels/scopes
- required declarations/checkboxes
- invite expiry defaults
- biometric consent wording/availability
- signer-role modeling
- template categories/types
- tenant ownership metadata

Specific examples:

- biometric/facial matching consent is currently hardcoded in `src/components/public/public-consent-form.tsx`
- biometric opt-in is stored on `consents.face_match_opt_in`
- invite expiry is currently fixed in `src/lib/idempotency/invite-idempotency.ts` (`+7 days`)

So the current repo does **not** have a generalized schema for a dynamic consent-form builder. It only has versioned text plus separate hardcoded consent-adjacent behavior.

## Current schema, code paths, and routes involved

### Core schema

- `public.memberships`
- `public.projects`
- `public.subject_invites`
- `public.consents`
- `public.revoke_tokens`
- `public.consent_events`
- `public.idempotency_keys`
- `public.consent_templates`

### Template-related migrations

- `20260305100000_003_consent_templates_schema.sql`
- `20260305101000_003_consent_templates_rls.sql`
- `20260305102000_003_consent_templates_seed.sql`
- `20260305103000_003_consent_templates_submit.sql`

### Protected flows

- create project: `src/app/api/projects/route.ts`
- project page and invite UI: `src/app/(protected)/projects/[projectId]/page.tsx`
- create invite: `src/app/api/projects/[projectId]/invites/route.ts`
- invite idempotency helper: `src/lib/idempotency/invite-idempotency.ts`
- invite revoke: `src/app/api/projects/[projectId]/invites/[inviteId]/revoke/route.ts`

### Public flows

- public invite page: `src/app/i/[token]/page.tsx`
- public consent submit route: `src/app/i/[token]/consent/route.ts`
- consent submit RPC wrapper: `src/lib/consent/submit-consent.ts`
- public invite scope helper for headshot routes: `src/lib/invites/public-invite-context.ts`

### Audit and downstream behavior

- receipt email source: `src/lib/email/send-receipt.ts`
- receipt rendering uses signed consent snapshot: `src/lib/email/templates/consent-receipt.ts`
- signed consent UI also renders snapshot text/version from `consents`

## Current constraints and invariants

These are the relevant constraints to preserve.

### Signed-consent immutability

- signed consents must stay reproducible from the snapshot stored in `consents`
- revocation must not delete or rewrite the original grant
- receipt email and later review should continue to show the exact signed text/version

### Tenant isolation

- tenant ID must stay server-derived
- tenant-scoped reads/writes must keep explicit tenant filters plus RLS protection
- template create/edit flows for tenant-owned templates must never accept tenant ID from the client

### Retry safety

- invite creation is idempotent via `idempotency_keys`
- public consent submit locks the invite row and behaves idempotently for re-submissions
- any template publishing/version-creation flow should also be safe under retries and concurrent edits

### Compatibility

- existing `subject_invites.consent_template_id` and `projects.default_consent_template_id` already point at `consent_templates.id`
- replacing `consent_templates` wholesale would create unnecessary migration risk
- extending the table is lower risk than replacing it

## Options considered

## Option A: Keep one `consent_templates` table and add ownership/scope

Model:

- keep one version-row table
- add ownership columns so rows can be app-wide or tenant-owned
- continue using row-per-version
- keep invites pointing to specific version rows

Possible shape:

- app-wide row: `tenant_id is null`
- tenant-owned row: `tenant_id = <tenant>`
- logical family: `(scope, template_key)`
- concrete version: row `id`

Pros:

- smallest extension of the current live model
- existing FKs keep working
- existing invite/signing flow barely changes
- no union queries across multiple tables
- easiest migration path

Cons:

- needs careful uniqueness rules because `tenant_id null` behaves differently
- needs stronger version/state semantics than today
- still lacks explicit fork lineage unless added later

Assessment:

- best fit for a bounded change

## Option B: Separate app-template and tenant-template tables

Model:

- one table for centrally maintained templates
- one table for tenant-owned templates
- project/invite selection reads a union of both

Pros:

- ownership is very explicit
- app-wide and tenant-owned permissions are separated structurally

Cons:

- existing `subject_invites.consent_template_id` and `projects.default_consent_template_id` would no longer point to a single target
- duplicated routes, queries, and policy logic
- harder to evolve later if a tenant copy starts from an app template

Assessment:

- unnecessarily disruptive for current scope

## Option C: App-template base plus tenant copy/fork model

Model:

- app-wide templates are canonical base families
- tenants can copy/fork them into tenant-owned families
- projects use either base or copied families

Pros:

- clean story for customization without mutating shared app templates
- useful future extensibility

Cons:

- introduces lineage/fork semantics before they are needed
- requires decisions on re-sync, divergence, inheritance, and UX
- larger than the immediate goal

Assessment:

- useful future extension, not the bounded starting point

## Recommended bounded direction

## Recommendation summary

Use **Option A**: keep one `consent_templates` table as the version table, extend it to support app-wide and tenant-owned rows, and keep signed-consent auditability anchored on consent snapshots.

Recommended principles:

- do not replace the current template table
- do not change invite/consent linkage away from specific version rows
- do not introduce a project-template eligibility system yet
- do not model signer-role workflows yet

## Ownership model

Recommended now:

- app-wide templates are visible to all tenants
- tenant-owned templates are visible only to members of that tenant
- tenant users can directly use app-wide templates
- tenant users can also create and maintain their own templates
- app-wide templates are editable only through a central application-managed path, not through tenant UI

Important constraint:

- there is no current platform-admin model
- plan phase must decide whether app-wide maintenance in this feature means:
  - internal/migration/service-role management only, or
  - a new explicit platform-admin surface

Bounded recommendation:

- do **not** add tenant-facing ability to edit app-wide rows
- defer fork/copy UX until later

## Template family vs version identity

Recommended now:

- keep `consent_templates` rows as version records
- treat family identity as a scoped key, not as a new table
- keep `subject_invites.consent_template_id` referencing a specific version row
- keep `projects.default_consent_template_id` as an optional convenience pointer to a specific version row

This is the smallest compatible model.

Why not add a separate family table now:

- the repo already behaves as "family = `template_key`, version = row"
- introducing a family table would create more migration churn than the current feature needs

One caution:

- current `version text` is weak for sequencing and ordering
- if the editor will auto-create successive versions, the system should not rely on lexicographic ordering of `version text`

## Versioning and immutability

Recommended now:

- editing a usable template should create a new version row
- published history must not be mutated in place
- invite selection should only allow usable published rows
- signed consents should keep storing `consent_text` and `consent_version` snapshot fields

Recommended state model:

- `draft`
- `published`
- `archived`

Why this is worth adding now:

- a template editor without drafts encourages accidental publication of half-finished text
- current `active/retired` is workable for seed data, but weak for user-managed editing

Compatibility approach:

- current `active` rows can map to `published`
- current `retired` rows can map to `archived`

## Project usage model

Smallest model that works now:

- no new project-template join table
- continue selecting a concrete template version when creating an invite
- keep `projects.default_consent_template_id` only as an optional convenience default

What that means in practice:

- a project can effectively use any visible published template at invite creation time
- the project does not need an explicit "eligible templates" model yet
- if a template is later updated, existing invites and consents remain unchanged
- future invites only use the new version if the user explicitly selects it or the project default is updated

This is predictable and bounded. It avoids hidden auto-upgrades.

## Template editor scope for this feature

Recommended current-scope meaning of "template editor":

- edit template metadata:
  - human name
  - optional description
  - optional category/type label
  - status/state
- edit consent body text
- create new versions
- publish/archive versions

Recommended to defer:

- arbitrary structured field schemas
- dynamic form-builder behavior
- template-driven purposes/channels/scopes
- template-driven required checkbox schemas
- template-driven invite expiry defaults
- template-driven biometric sections

Reason:

- none of those are modeled in the current repo
- adding them would turn this feature into a consent-system redesign, not a bounded template-editor feature

## Specialized templates

Recommended representation now:

- primarily different template content
- plus lightweight metadata for discovery/filtering

Examples:

- standard adult template: normal content + category/type metadata
- campaign-specific template: normal content + category/type metadata
- minor/parent template: content + category/type metadata, but **not** full signer-role workflow yet

Important limitation:

- the current public consent flow only captures one signer name/email
- so true minor/parent workflow support is not really implemented by template storage alone
- if a "minor/parent" template is added now, it should be treated as content classification, not proof that guardian-signature workflow exists

## Permissions and security

Recommended permission split:

- tenant template create/edit/publish/archive:
  - tenant `owner` and `admin`
- tenant template use in projects/invites:
  - tenant `owner`, `admin`, and `photographer`
- app-wide template management:
  - platform-admin or internal application-only path

Current gap:

- these role distinctions do not exist in live app code yet
- current app behavior is membership-based, not role-based

So the plan phase must explicitly decide whether to introduce role-aware authorization in this feature or keep the first cut membership-based and narrow only the new template-management routes.

## Compatibility and migration

The lowest-risk path is additive migration.

Recommended compatibility approach:

- reuse the existing `consent_templates` table
- backfill existing rows as app-wide templates
- preserve existing row IDs so current invites and project defaults remain valid
- keep `subject_invites.consent_template_id` unchanged
- keep `consents.consent_text` and `consent_version` unchanged

This allows rollout without breaking:

- current project page
- current invite creation flow
- current public invite page
- current signing RPC
- current receipt generation
- current signed-consent review UI

## Risks and tradeoffs

- `version text` is currently weak. Relying on string ordering for "latest version" will become fragile.
- There is no DB-enforced immutability on template rows today. A future editor must close that gap.
- There is no platform-admin model, so "centrally maintained app-wide templates" needs a deliberate management path decision.
- Minor/parent templates can be stored before signer-role workflow exists, but that can create product confusion if not clearly scoped.
- If drafts are skipped, every save becomes a publish event, which is risky for legal text.
- If projects keep a specific-version default, new versions do not automatically flow into future invites. That is safer, but less automatic.
- If a family-level project pointer is added now, future invites might silently switch versions, which is less predictable.

## Future extensibility (not current scope)

The model should leave room for these later without forcing them now.

- multiple eligible templates per project:
  - later add an explicit project-template assignment table
- photographer/operator selection from eligible templates:
  - later layer a chooser on top of project eligibility
- app-wide template fork/copy:
  - later add `source_template_id` or similar lineage metadata
- richer metadata:
  - categories, tags, audience, jurisdiction, purpose labels
- richer signer-role flows:
  - adult self-sign vs parent/guardian sign vs multi-party sign

None of that requires solving the full future UX in this feature, as long as:

- template versions remain separate immutable rows
- family identity remains stable within scope
- invites keep pointing at concrete versions
- signed consents keep storing immutable snapshots

## Open decisions for the plan phase

These are the key plan-phase decisions to make explicitly.

1. Ownership model
- Keep one `consent_templates` table with scoped ownership?
- If yes, how should scope be represented for app-wide vs tenant-owned rows?

2. Version identity
- Keep current `template_key + version` semantics only?
- Or add an internal numeric version sequence while keeping display labels?

3. State model
- Introduce `draft/published/archived` now?
- Or keep a simpler model and accept immediate publish semantics?

4. App-wide management path
- Are app-wide templates managed only via internal/migration/service-role paths in this feature?
- Or does this feature introduce a new platform-admin UI/API?

5. Project usage model
- Keep only invite-time selection plus optional project default version?
- Or expose project default management in the UI as part of this feature?

6. Direct use vs copy/fork
- Can tenants directly use app-wide templates without copying? Recommended: yes.
- Is copy/fork needed now? Recommended: no.

7. Specialized template semantics
- Are adult/minor/campaign variants only metadata + content in this feature?
- Or is any signer-role behavior in scope? Recommended: signer-role behavior is later scope.

8. Editor scope
- Is the editor body-text-and-metadata only?
- Or does the feature attempt structured fields, dynamic checkboxes, or biometric configuration? Recommended: defer those.

9. Authorization detail
- Should tenant template management be limited to `owner/admin` now?
- If so, where should that role check live, given the current app is mostly membership-based?

10. Migration strategy
- How should existing global rows be backfilled for any new scope/state/name/category columns?
- How should current `active/retired` values map to the new state model?

## Recommended plan-phase starting point

The cleanest bounded starting point for planning is:

- extend the existing `consent_templates` version-row table rather than replace it
- add app-wide vs tenant-owned scope to that table
- keep invites pointing to a specific version row
- keep signed consents storing snapshot text/version
- add draft/published/archived semantics for safe editing
- keep project usage minimal: invite-time selection plus optional specific-version default
- treat specialized templates as content + light metadata only
- defer fork/copy, project eligibility sets, and signer-role workflows

That direction satisfies the immediate product goal while preserving the current audit and versioning invariants with the smallest compatible model.
