# 042 Structured Consent Template Fields Research

## Scope

Research how to extend the live Feature 039 consent-template system so template versions can define a bounded set of structured fields, the public signing flow can collect those values safely, and signed consents remain auditable and reproducible.

This research stays within the requested boundary:

- built-in fields: `scope` and `duration`
- custom field types:
  - single-select dropdown
  - checkbox list
  - text input
- no generic form-builder redesign
- no conditional logic, nested fields, multi-step forms, guardian workflow redesign, or duration-expiry enforcement

## Inputs reviewed

### Required project docs

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/003-consent-templates/research.md`
- `docs/rpi/003-consent-templates/plan.md`
- `docs/rpi/039-consent-form-template-editor/research.md`
- `docs/rpi/039-consent-form-template-editor/plan.md`

### Relevant migrations

- `supabase/migrations/20260304210000_002_projects_invites_schema.sql`
- `supabase/migrations/20260305000100_fix_submit_public_consent_ambiguity.sql`
- `supabase/migrations/20260305100000_003_consent_templates_schema.sql`
- `supabase/migrations/20260305101000_003_consent_templates_rls.sql`
- `supabase/migrations/20260305102000_003_consent_templates_seed.sql`
- `supabase/migrations/20260305103000_003_consent_templates_submit.sql`
- `supabase/migrations/20260305123000_fix_submit_public_consent_for_update.sql`
- `supabase/migrations/20260306100000_006_headshot_consent_schema.sql`
- `supabase/migrations/20260306101000_006_headshot_consent_submit_rpc.sql`
- `supabase/migrations/20260306103000_fix_submit_public_consent_headshot_ambiguity.sql`
- `supabase/migrations/20260407150000_039_consent_form_template_editor.sql`

### Relevant live code

- `src/lib/templates/template-service.ts`
- `src/app/api/templates/route.ts`
- `src/app/api/templates/[templateId]/route.ts`
- `src/app/api/templates/[templateId]/versions/route.ts`
- `src/app/api/templates/[templateId]/publish/route.ts`
- `src/app/api/templates/[templateId]/archive/route.ts`
- `src/app/(protected)/templates/page.tsx`
- `src/app/(protected)/templates/[templateId]/page.tsx`
- `src/components/templates/template-create-form.tsx`
- `src/components/templates/template-detail-client.tsx`
- `src/components/templates/template-status-badge.tsx`
- `src/app/api/projects/[projectId]/default-template/route.ts`
- `src/components/projects/project-default-template-form.tsx`
- `src/app/api/projects/[projectId]/invites/route.ts`
- `src/lib/idempotency/invite-idempotency.ts`
- `src/components/projects/create-invite-form.tsx`
- `src/app/i/[token]/page.tsx`
- `src/components/public/public-consent-form.tsx`
- `src/app/i/[token]/consent/route.ts`
- `src/lib/consent/submit-consent.ts`
- `src/lib/invites/public-invite-context.ts`
- `src/app/api/public/invites/[token]/headshot/route.ts`
- `src/app/api/public/invites/[token]/headshot/[assetId]/finalize/route.ts`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/lib/email/send-receipt.ts`
- `src/lib/email/templates/consent-receipt.ts`
- `src/lib/consent/constants.ts`
- `src/components/navigation/protected-nav.tsx`

### Relevant tests

- `tests/feature-039-consent-form-template-editor.test.ts`
- existing cross-feature tests that insert/read `consent_templates` rows directly

### Executed verification

- Ran `npm test -- tests/feature-039-consent-form-template-editor.test.ts`
- Result: pass
- Note: because of the current `package.json` script, this executed the full test suite plus the Feature 039 test file; 125/125 tests passed

## Verified current behavior

## 1. Current Feature 039 reality

### Status: Feature 039 is live, not just planned

Feature 039 is substantially implemented in the repo today.

Live implementation evidence:

- schema migration exists: `20260407150000_039_consent_form_template_editor.sql`
- protected template management pages exist under `src/app/(protected)/templates/**`
- template API routes exist under `src/app/api/templates/**`
- project default template route exists
- invite creation uses live template selection
- navigation includes `/templates`
- an integration test exists and passes

### What Feature 039 actually shipped

Current live capabilities:

- app-wide templates and tenant-owned templates coexist in one table
- templates remain row-per-version
- tenant managers can create tenant-owned draft templates
- tenant managers can edit drafts
- tenant managers can create a new draft version from an existing family
- tenant managers can publish drafts
- tenant managers can archive published versions
- project pages can set a specific-version default template
- invite creation requires explicit published template selection or a valid project default
- public signing uses the invite-linked template row and snapshots `consent_text` and `consent_version`

### What Feature 039 intended versus what is actually live

The implementation mostly matches the 039 plan, with a few real-world deltas:

- The plan wanted stronger transactional publish/version flows with family locking.
- The live `template-service.ts` implementation uses multiple Supabase calls plus unique indexes, not a single transactional DB function.
- The plan described archived template visibility more narrowly than the live RLS. Today archived app-wide rows are readable to authenticated users, and archived tenant rows are readable to tenant members.
- The plan called for broad lifecycle and route coverage. The repo has a good integration test for helper-level lifecycle and signing behavior, but not dedicated route-handler or UI tests for the template editor.

### Actual current `consent_templates` shape after Feature 039

Current columns:

- `id uuid primary key`
- `tenant_id uuid null references tenants(id)`
- `template_key text not null`
- `name text not null`
- `description text null`
- `category text null`
- `version text not null`
- `version_number integer not null`
- `status text not null check (status in ('draft', 'published', 'archived'))`
- `body text not null`
- `created_by uuid null`
- `created_at timestamptz not null`
- `updated_at timestamptz not null`
- `published_at timestamptz null`
- `archived_at timestamptz null`

Current indexing and uniqueness model:

- unique app-wide `(template_key, version_number)` where `tenant_id is null`
- unique tenant `(tenant_id, template_key, version_number)` where `tenant_id is not null`
- one app-wide draft per family
- one tenant draft per family
- one app-wide published per family
- one tenant published per family

### Are templates still row-per-version?

Yes.

There is still no separate template-family table. A family is effectively:

- app-wide: `tenant_id is null + template_key`
- tenant-owned: `tenant_id + template_key`

Each version is its own `consent_templates` row and `subject_invites.consent_template_id` points to one concrete version row.

### How draft, published, and archived are modeled today

- `draft`: editable in place
- `published`: immutable except archive transition
- `archived`: immutable

Immutability is enforced by `app.enforce_consent_template_immutability()` plus a trigger created in the 039 migration.

### App-wide versus tenant-owned behavior today

- app-wide rows use `tenant_id is null`
- tenant-owned rows use `tenant_id = <tenant>`
- app-wide template management is internal-only in practice
- tenant template management is available to `owner` and `admin`
- `photographer` can use published templates in project and invite flows but cannot manage templates

### Current 039 constraints and invariants

- invites point to specific version rows, not families
- project defaults point to specific version rows, not families
- invite creation only accepts published visible rows
- published rows are intended to be immutable
- old invites continue to reference their original template version row even after newer versions publish
- signed consents still snapshot text and version onto `consents`

## 2. Current public consent form shape

### How the public consent form is rendered today

Current render path:

1. `src/app/i/[token]/page.tsx`
2. calls public RPC `get_public_invite`
3. receives invite metadata plus `consent_text` and `consent_version`
4. renders `src/components/public/public-consent-form.tsx`

### What is template-driven today

Template-driven today:

- consent body text
- consent version label

Still hardcoded today:

- subject name input
- subject email input
- face-match opt-in checkbox
- headshot upload UX and validation
- overall public form structure

There is no current template-defined field rendering beyond text and version.

### How public form values are currently posted

Current submit path:

1. `PublicConsentForm` posts a standard HTML form to `/i/[token]/consent`
2. route parses `full_name`, `email`, `face_match_opt_in`, and `headshot_asset_id`
3. route calls `submitConsent()` in `src/lib/consent/submit-consent.ts`
4. `submitConsent()` calls public RPC `submit_public_consent`

Headshot upload is a parallel AJAX subflow before final submit:

- `POST /api/public/invites/[token]/headshot`
- `POST /api/public/invites/[token]/headshot/[assetId]/finalize`

### Where validation happens today

Client-side:

- HTML input constraints for name and email
- JS prevents submit if face-match opt-in is checked without a linked headshot asset

Route-level:

- trims and normalizes name and email
- basic invalid and empty checks
- basic `headshot_required` redirect behavior

RPC and database:

- authoritative invite lookup
- invite row lock
- expiry and used-count checks
- template existence check
- duplicate submission handling
- headshot and face-match integrity rules
- atomic consent insert and invite `used_count` update

### What must change for structured fields

To support template-defined structured fields without breaking the current flow:

- `get_public_invite` must return structured field definitions for the invite-linked template version
- the public page must render structured fields from that invite-linked template version, not from live draft data
- `/i/[token]/consent` must parse structured field submissions in addition to the current fixed inputs
- authoritative validation must still happen server-side against the invite-linked published template version
- client-supplied field labels, option labels, or tenant and template metadata must remain ignored

The current invite-token-based linkage is already the right authority boundary.

## 3. Current signed-consent snapshot model

### What is snapshotted onto `consents` today

Directly stored on `public.consents` today:

- `consent_text`
- `consent_version`
- `signed_at`
- `capture_ip`
- `capture_user_agent`
- `face_match_opt_in`
- `invite_id`
- `subject_id`
- `tenant_id`
- `project_id`

Related but not stored directly on `consents`:

- subject name and email live in `public.subjects`
- headshot linkage lives in `public.asset_consent_links`
- receipt state lives on `consents.receipt_email_sent_at`
- revoke token lives in `public.revoke_tokens`

### Important current audit nuance

`subject_name` is not currently snapshotted on `consents`.

`submit_public_consent` upserts the subject row by `(tenant_id, project_id, email)` and updates `subjects.full_name` on conflict. The protected consent-details UI then reads the current joined subject row, not a subject snapshot row on `consents`.

That means the current system is strongest on consent-text and version immutability, but weaker on signer-identity snapshotting.

### Is current reproducibility based on live template reads?

No.

Current reproducibility for the legal consent body is based on the snapshot stored in `consents`, not on re-reading `consent_templates`.

That same principle should apply to structured values.

### What must be snapshotted for structured fields

For auditability and reproducibility, storing only selected values is not enough.

Why selected values alone are insufficient:

- option labels may change in future versions
- option ordering may change
- custom-field labels may change
- a bare value like `website` or `2_years` is less useful without the signed field definition it belonged to
- future display surfaces should not need to reconstruct historical field semantics by reading live tables

Recommended audit rule:

- snapshot both:
  - the exact field definitions and options as signed
  - the exact selected values as signed

This mirrors the current `consent_text` snapshot strategy.

## 4. Where structured field definitions should live

## Option A: JSONB column(s) directly on `consent_templates`

Example direction:

- add one `structured_fields_definition jsonb` column on `consent_templates`
- store built-ins and custom fields in a bounded server-defined JSON shape

Pros:

- smallest additive migration
- fits the current row-per-version model well
- draft edit and new-version copy is simple because definitions live on the version row
- publish immutability is already enforced at row level by the existing trigger
- public invite render path only needs one row read
- signing RPC or helper only needs one template-version lookup

Cons:

- fewer DB-native constraints than normalized child tables
- server code must validate JSON structure carefully
- reporting across definitions is less relational

Versioning compatibility:

- very good
- the version row already is the unit of immutability and invite linkage

### Option B: normalized child tables

Example direction:

- `consent_template_fields`
- `consent_template_field_options`

Pros:

- stronger relational integrity for options and ordering
- easier SQL inspection of definition rows
- future field-level querying could be cleaner

Cons:

- more migration complexity
- more work to copy versions and preserve field ordering
- more joins in public render and submit paths
- more surface area for tenant and version bugs
- larger implementation than the immediate bounded need

Versioning compatibility:

- workable, but heavier because every version copy must duplicate child rows transactionally

### Option C: mixed model

Example direction:

- built-ins first-class columns or tables
- custom fields stored as JSONB

Pros:

- built-ins are easier to query directly
- custom remains flexible

Cons:

- split validation and storage rules
- two mental models
- more complex than necessary for the first bounded rollout

Versioning compatibility:

- acceptable, but the split model increases code paths in draft, edit, publish, and version copy

### Recommended bounded direction for definitions

Recommend Option A.

Use a single JSONB definition column on `consent_templates`, with built-ins represented as reserved field definitions inside that bounded schema.

Recommended shape conceptually:

- one server-defined object that includes:
  - built-in `scope`
  - built-in `duration`
  - `customFields[]`

Recommended reasons:

- it matches the live Feature 039 row-per-version architecture
- it keeps draft editing and version copying simple
- it avoids introducing a second versioned table family unless later requirements prove it necessary
- it is the smallest safe change that still supports auditable snapshotting

## 5. Where signed values should live

## Option A: built-in columns on `consents` plus JSONB for custom values

Example direction:

- `scope_option_keys text[]`
- `duration_key text`
- `custom_field_values jsonb`

Pros:

- built-in reads are simple
- future built-in reporting and filtering are easier
- compatible with legacy `consents`

Cons:

- still does not solve auditability by itself
- you still need an immutable snapshot of exact field definitions and options
- split storage for built-in versus custom values increases rendering logic

### Option B: one JSONB snapshot column for all structured values

Example direction:

- `structured_consent_snapshot jsonb`

Pros:

- strongest bounded fit for auditability and reproducibility
- simplest additive migration to the signing flow
- one source of truth for protected UI and future receipt rendering
- easiest to keep legacy `consents` compatible with nullable column behavior

Cons:

- later filtering and reporting are less straightforward than dedicated built-in columns
- SQL queries over scope and duration will be more verbose unless later indexed or materialized

### Option C: normalized consent-value child table(s)

Pros:

- strongest queryability for reporting
- clean relational model for field and value rows

Cons:

- heaviest migration and write-path change
- public signing insert becomes more complex
- audit snapshot still needs careful handling of exact labels and options
- overkill for the bounded current requirement

### Recommended bounded direction for signed values

Recommend Option B for the first cut:

- add one immutable `structured_consent_snapshot jsonb` column on `consents`
- store both:
  - the exact field definitions and options as signed
  - the selected values as signed

Why this wins now:

- it best preserves signed-consent reproducibility
- it keeps rollout additive for existing `consents`
- it avoids prematurely hardening a query model before the product actually needs reporting or filtering

Important follow-on note:

- if scope and duration reporting become a near-term product need, a later feature can add expression indexes or derived columns without redesigning the signing model

## 6. Built-in field semantics

### Scope

Recommended semantics:

- built-in field
- required on newly published structured templates
- checkbox list
- signer must select at least one option
- signer may select many options
- template editor defines the option list per template version

### Duration

Recommended semantics:

- built-in field
- required on newly published structured templates
- single-select dropdown
- allowed values bounded to exactly three stable internal values

### Should built-ins be stored differently from custom fields?

Recommended answer:

- definitions: built-ins should be semantically distinct inside the schema
- physical storage: they do not need a completely separate table or model in the first cut

In practice:

- use reserved built-in field keys and validation rules
- keep them in the same JSONB definition and snapshot document as custom fields

### Should built-in options use stable internal keys plus labels?

Yes.

For `scope`, each option should have:

- stable internal key
- display label
- order index

This prevents future label changes from destroying reporting and display reliability.

### Should duration use enum-like values instead of free text?

Yes.

Do not store `"1 year"` as the canonical value.

Use a stable internal key and a separate label.

The exact key format is still a plan-phase decision, but it should be permanent and non-localized.

### Should built-ins be mandatory on every published signable template?

Recommended answer:

- yes for newly published structured templates
- no retroactive backfill for legacy already-published templates

The clean additive rollout is:

- legacy published rows can remain simple
- any new template version created or republished after this feature should satisfy the built-in requirements before publish

## 7. Custom field model

### Minimum viable metadata

Each custom field definition should support:

- `key`
- `label`
- `type`
- `required`
- `orderIndex`
- `options[]` for select and checkbox types

Each option should support:

- `key`
- `label`
- `orderIndex`

### Bounded extras worth including now

Recommended to include now:

- `helpText` optional
- `placeholder` for text input optional
- `maxLength` for text input optional

Recommended to defer:

- active and inactive option state
- conditional logic
- arbitrary regex or validation DSL
- nested or repeating groups

Reason:

- drafts are already editable and versioned
- published rows are immutable
- the product need does not require a deeper form-designer model

## 8. Validation and sanitization

### Validation location

Client-side validation is not enough.

Recommended layered model:

- client: UX only
- route or server helper: parse and normalize form payload, enforce coarse limits
- DB or RPC, or an equivalent authoritative transactional server boundary: validate against the invite-linked template version and write the consent atomically

Because `submit_public_consent` is publicly executable today, authoritative structured-field validation cannot live only in the browser or in superficial route parsing.

### Minimum server-side rules

Checkbox list required:

- at least one allowed option must be selected

Dropdown required:

- exactly one allowed option must be selected

Text required:

- trimmed non-empty string

Unknown fields:

- reject unknown field keys

Unknown options:

- reject option keys not defined on the invite-linked template version

Tampered labels:

- ignore client-supplied labels entirely

### Text-input handling

Recommended handling:

- treat as plain text only
- trim server-side
- enforce max length server-side
- reject null bytes and control-character garbage
- never render as raw HTML

Current rendering surfaces already help here:

- React UI escapes by default
- receipt email template escapes HTML manually

### Limits worth enforcing

Plan phase should pick exact numeric limits, but bounded limits should exist for:

- total structured fields per template
- options per field
- label lengths
- internal key lengths
- text input max length
- total serialized payload size

These should be enforced on both template save and publish, and on consent submit.

### Error shaping

Recommended:

- safe validation codes like `invalid_structured_fields`, `required_field_missing`, `invalid_option`, `unknown_field`
- no leaking of internal tenant or template metadata in public responses

## 9. Versioning and immutability impact

### Current lifecycle fit

The live Feature 039 lifecycle is already compatible with structured fields:

- draft editing exists
- publish exists
- archive exists
- new version creation exists
- published rows are intended to be immutable

### Required behavior for structured fields

Recommended rules:

- field-definition changes happen only on drafts
- published field definitions are never edited in place
- changing fields, options, or labels requires a new draft or new version
- copied versions inherit the full field-definition set from the source version

### Older invites after later template changes

Old invites must still render the exact old field definitions.

The current architecture already supports this because:

- invite rows point to a concrete template version row
- public render and signing read from that linked row
- newer versions do not rewrite old invite references

### Archived versions and public signing

Older invites that reference archived versions should still render and sign the archived version they point to.

Current live behavior already does this because:

- public `get_public_invite` joins the invite-linked template row without a status filter
- `submit_public_consent` re-reads the invite-linked row without a status filter

That behavior is correct for reproducibility and should be preserved.

## 10. Invite and project usage impact

### Current state

- project defaults point to a specific template version row
- invite rows point to a specific template version row
- invite creation requires an explicit template or a valid default
- the old 003-style fallback to latest `gdpr-general` is gone

This is already the safer architecture for structured fields.

### Impact of structured fields

If a project default points to a version with structured fields:

- invite creation must persist that exact template version row as it already does today
- public invite render must receive that exact version's structured definition
- submit validation must use that exact version's definition

### Older invites referencing older versions

They must continue to show the exact older field set.

The live invite-to-version linkage already gives the right behavior here.

### Unsafe fallback behaviors

Current live behavior does not silently fall back to another template when no valid published template is available.

That is good and should remain true once structured fields exist.

## 11. Protected consent-details UI impact

### Current consent-details loading path

The protected project page currently loads invite rows plus nested consent rows and joined subjects:

- `subject_invites`
- nested `consents`
- joined `subjects`
- joined invite-linked template name and version

### What the protected UI currently renders

Current consent-details UI shows:

- subject name
- subject email
- signed timestamp
- consent version
- consent text
- facial matching enabled or disabled
- linked headshot state and preview where applicable

### Recommended bounded display approach for structured values

Recommended addition to the existing consent details panel:

- render built-ins first
- render custom values second
- read from the signed consent snapshot, not from the current template row

Recommended display:

- `Scope`: chips or bullet list of selected labels
- `Duration`: single label line
- `Custom fields`: simple definition list using signed labels and signed values

Recommended legacy behavior:

- if the consent has no structured snapshot, show nothing or a small "legacy consent without structured values" note

### Receipt, email, and other signed-consent surfaces

Current receipt email uses `consent_text` and `consent_version` snapshot values only.

Recommendation:

- not required in the first implementation if scope needs to stay tight
- but receipts should eventually include signed structured values, especially `scope` and `duration`, because they materially change what was granted

## 12. Compatibility and migration

### Existing templates

Recommended path:

- do not backfill invented scope or duration defaults into old template versions
- allow legacy templates to remain simple
- new and edited template versions gain structured definitions explicitly

Why no backfill:

- scope and duration are substantive consent terms
- inventing them retroactively would misrepresent what older consents actually granted

### Existing invites

- old invites referencing templates without structured definitions should continue to render the legacy form
- old invites referencing templates with structured definitions should render those fields once the feature ships

### Existing consents

- old consents will have null structured snapshot data
- protected UI must handle that as legacy data

### Clean additive migration path

Recommended migration style:

- add nullable JSONB definition column(s) to `consent_templates`
- add nullable JSONB snapshot column to `consents`
- update public render and submit paths to branch based on presence of a structured definition
- require built-ins only for newly published versions after rollout

## 13. Security and tenancy

### Tenant scoping

Structured definitions should inherit the same scoping as the template version row they belong to.

That means:

- app-wide template definitions remain on app-wide rows
- tenant-owned definitions remain on tenant-owned rows
- no client-supplied `tenant_id`

### Safe submit behavior

Never trust client-provided:

- tenant id
- template id for public signing
- field definitions
- option labels
- built-in allowed values

Public signing must derive authority from:

- invite token
- invite-linked `consent_template_id`
- server-fetched template version row

### Editing protections

Current Feature 039 already prevents tenant users from editing app-wide rows through normal routes. Structured-field editing should remain inside the same management boundary.

### Important public-submit rule

The server must reject structured values for any field or option that is not actually part of the invite's linked template version.

That is the core anti-tampering rule for this feature.

## 14. Retry safety, idempotency, and race conditions

### Duplicate public submission

Current submit RPC is idempotent on `consents.invite_id`.

Recommended structured-field behavior:

- the first successful write stores the full structured snapshot
- duplicate retries return the existing consent and existing snapshot unchanged

### Partial failure after consent row is written

Current behavior already tolerates this via the duplicate lookup on retry.

Structured fields should live inside the same atomic consent insert path so retries return the exact same signed values.

### Concurrent draft edits

Current Feature 039 draft updates are simple updates through the service layer. There is no optimistic concurrency token.

Implication:

- current behavior is effectively last-write-wins for draft edits

Plan phase should decide whether to keep that behavior or add `updated_at` or ETag style conflict detection.

### Publish race

Current `publishTenantTemplate()` is not a single DB transaction. It:

- reads the current published row
- archives it
- then publishes the draft

Implication:

- unique indexes help, but there is still a gap between operations
- if the publish flow fails after archiving the old published row, the family can transiently end up with no published row

This is already a live Feature 039 risk. Structured-field work should not worsen it, and plan phase should decide whether publish and version operations should move into DB-side transactional functions.

### Invite opened while a new version is published

This is already safe for invite-linked versions because:

- invites reference concrete version rows
- later publishes create or switch other rows, not the invite row's template id

### Stale or tampered client payload

For public signing, stale shape really means:

- a tampered form
- missing required values
- invalid option keys

The authoritative validator must reject this against the invite-linked version schema.

## 15. Options considered summary

### Definitions

- A direct JSONB on `consent_templates`: recommended
- B normalized child tables: heavier than current scope
- C mixed built-in relational plus custom JSONB: split model too early

### Signed values

- A built-in columns plus custom JSONB: useful later, but still needs a full audit snapshot
- B one immutable JSONB snapshot on `consents`: recommended bounded first step
- C normalized child rows: strongest queryability, too heavy now

## Recommended bounded direction

### Recommendation summary

Use the existing Feature 039 version-row architecture as the backbone.

Recommended first-cut model:

- `consent_templates` gets a bounded JSONB structured-field definition
- `consents` gets one immutable JSONB structured snapshot
- built-ins remain semantically special, but not physically split into a second schema system yet
- old template versions and old consents remain legacy-compatible

### Recommended definition model

On `consent_templates`, store:

- built-in `scope`
- built-in `duration`
- `customFields[]`

All inside one bounded JSONB definition document.

### Recommended signed snapshot model

On `consents`, store:

- exact signed field definitions and options
- exact signed selected values

All inside one immutable JSONB snapshot document.

### Recommended publish rule

For newly publishable structured templates:

- `scope` required
- `duration` required
- custom fields optional

Legacy already-published templates can remain simple.

### Recommended render and submit rule

- public form renders from invite-linked template version
- submit validates against invite-linked template version
- protected details and future receipts read from signed consent snapshot

This preserves auditability and avoids hidden coupling to live template data.

## Risks and tradeoffs

- JSONB definitions and snapshots push more validation responsibility into server code
- JSONB-only signed storage is less query-friendly if reporting requirements expand quickly
- the current live 039 publish and version flows are not fully transactional
- subject identity is not fully snapshotted today, which is a separate existing audit limitation
- older template versions will coexist in both legacy-simple and structured forms during rollout, so UI and submit code must handle both paths cleanly

## Explicit open decisions for the plan phase

1. Exact structured-definition JSON shape on `consent_templates`

2. Exact signed snapshot JSON shape on `consents`

3. Whether to keep signed structured storage JSONB-only, or add derived built-in columns immediately

4. Exact stable internal key format for:
   - scope options
   - duration values
   - custom fields
   - custom options

5. Exact minimum metadata to support now for custom fields:
   - `helpText`
   - `placeholder`
   - `maxLength`

6. Exact publish-time validation rules and numeric bounds:
   - max custom field count
   - max options per field
   - max label lengths
   - max text length
   - max payload size

7. Whether to add optimistic concurrency protection for draft edits in the same feature

8. Whether to strengthen publish and version creation into DB-side transactional functions now, since the live 039 helper path is not fully atomic

9. Whether receipt emails should include structured values in the first implementation or a follow-up

10. Whether to add JSONB expression indexes later for reporting or filtering on `scope` and `duration`

11. Whether newly published template versions must always include built-ins, while grandfathering all existing published rows

## Concise plan-phase starting point

The cleanest bounded next step is:

- keep Feature 039's row-per-version template model
- add a bounded JSONB structured-definition document to template rows
- add an immutable JSONB structured snapshot document to signed consents
- treat `scope` and `duration` as reserved built-ins with stable keys and stricter validation
- keep validation authoritative on the server against the invite-linked template version
- preserve legacy-simple templates and consents without backfilled invented values

That direction satisfies the immediate product need while preserving the current audit and versioning model with the smallest compatible change.
