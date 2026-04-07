# 042 Structured Consent Template Fields Plan

## Inputs and ground truth

### Inputs read for this plan

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/039-consent-form-template-editor/research.md`
- `docs/rpi/039-consent-form-template-editor/plan.md`
- `docs/rpi/042-structured-consent-template-fields/research.md`

### Live implementation rechecked

- `supabase/migrations/20260407150000_039_consent_form_template_editor.sql`
- `src/lib/templates/template-service.ts`
- `tests/feature-039-consent-form-template-editor.test.ts`
- `src/app/i/[token]/page.tsx`
- `src/components/public/public-consent-form.tsx`
- `src/app/i/[token]/consent/route.ts`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/lib/email/templates/consent-receipt.ts`

### Verified current boundary

The current live system already has these properties:

- Feature 039 is implemented, not just planned.
- `consent_templates` is a row-per-version table with `draft`, `published`, and `archived`.
- app-wide and tenant-owned templates coexist in the same table via nullable `tenant_id`.
- `subject_invites.consent_template_id` points to a concrete template version row.
- public signing snapshots `consent_text` and `consent_version` onto `consents`.
- signed-consent reproducibility currently depends on `consents`, not a live template lookup.
- the public form is still structurally hardcoded except for consent text and version.
- protected consent details currently show text, version, subject info, and biometric state, but no structured values.
- receipt email currently uses only consent text and version snapshots.

This plan extends that live implementation. It does not redesign the template system or replace the invite-to-version model.

## Options considered

### Option A: JSONB definition on `consent_templates` plus JSONB snapshot on `consents`

Keep the live Feature 039 row-per-version architecture and add:

- a bounded JSONB structured-field definition column on `consent_templates`
- an immutable JSONB structured snapshot column on `consents`

Why this wins:

- lowest migration risk
- fits the current version-row model cleanly
- keeps invites referencing concrete version rows
- keeps signed-consent auditability anchored on snapshots
- smallest bounded change that satisfies the product need

### Option B: normalized template field tables

Rejected because:

- it adds a second versioned table family immediately
- version copy and publish become heavier
- public render and submit need more joins
- it is more relationally pure, but larger than the bounded scope needs

### Option C: normalized consent-value tables

Rejected because:

- it makes the signing write path significantly heavier
- it still needs a separate snapshot strategy for exact field definitions and options
- it optimizes future reporting earlier than this feature requires

### Option D: split built-in relational columns plus custom JSONB

Rejected because:

- it creates two storage models for one bounded feature
- it complicates validation and rendering logic
- it adds schema surface area before there is evidence that built-ins need first-class query columns now

## Recommendation

Implement Option A.

- Add `structured_fields_definition jsonb` to `consent_templates`.
- Add `structured_fields_snapshot jsonb` to `consents`.
- Treat `scope` and `duration` as reserved built-in field definitions inside the bounded JSON schema.
- Validate all submitted structured values server-side against the invite-linked template version.
- Preserve legacy templates and consents by allowing those new columns to remain null on existing data.

Accepted tradeoffs:

- JSONB validation lives primarily in app and DB helper logic rather than in fully relational schema constraints.
- Reporting on scope and duration is deferred; no JSONB reporting indexes are added in this feature.
- Receipt email expansion is deferred to keep the implementation bounded.

## Chosen architecture

### Architecture summary

- `consent_templates` remains the canonical template version table.
- `subject_invites.consent_template_id` remains a concrete version-row FK.
- `projects.default_consent_template_id` remains a concrete version-row FK.
- `consent_templates.structured_fields_definition` stores the exact field definition for that template version.
- `consents.structured_fields_snapshot` stores the exact field definition plus submitted values as signed.
- public signing continues to authorize entirely from invite token to invite row to linked template version row.
- protected consent details render from the signed snapshot, not from the live template row.

### Live-implementation correction adopted in this plan

The current live Feature 039 helper code performs version creation and publish with multiple Supabase calls.

This feature will strengthen that path now by moving:

- next-version draft creation
- publish transition

into DB-side transactional functions called by the server helpers.

Reason:

- Feature 042 adds more template-state importance and more validation at publish time.
- the current multi-call publish flow can temporarily leave a family without a published version if a failure lands between archive and publish.
- this is the right time to close that reliability gap instead of layering more logic onto the current helper sequence

### Explicit decisions

- chosen design: JSONB definition on templates plus JSONB snapshot on consents
- built-ins remain semantically special, not physically split into separate relational storage
- every newly published template version after this feature must include valid built-in `scope` and `duration`
- legacy already-published templates without structured definitions are grandfathered
- any new draft created after this feature, including a new version draft created from a legacy template, is initialized with structured built-ins and must satisfy publish rules before publish
- draft edits remain last-write-wins in this feature
- receipt email content does not expand in this feature

## Exact schema changes

Create one new migration for schema extension and one new migration for DB helper functions.

### Table changes: `public.consent_templates`

Add:

- `structured_fields_definition jsonb null`

Add object-type check:

- `check (structured_fields_definition is null or jsonb_typeof(structured_fields_definition) = 'object')`

No JSONB index is added in this feature.

Reason:

- template selection is not filtered by structured-field contents
- reporting and analytics are out of scope

### Table changes: `public.consents`

Add:

- `structured_fields_snapshot jsonb null`

Add object-type check:

- `check (structured_fields_snapshot is null or jsonb_typeof(structured_fields_snapshot) = 'object')`

No JSONB index is added in this feature.

Reason:

- protected UI reads consents by project and invite relationships already
- reporting and filtering redesign is out of scope

### Helper DB functions

Add DB helper functions to support validation and atomic transitions:

- `app.validate_structured_fields_definition_for_publish(p_definition jsonb) returns jsonb`
- `app.validate_submitted_structured_field_values(p_definition jsonb, p_values jsonb) returns jsonb`
- `app.create_next_tenant_consent_template_version(p_template_id uuid) returns public.consent_templates`
- `app.publish_tenant_consent_template(p_template_id uuid) returns public.consent_templates`

Add `public.*` wrappers for the version-create and publish functions and grant execute to `authenticated`.

The validation helpers return normalized JSON, not just boolean success.

Reason:

- publish-time validation should not depend only on route code
- submitted-value validation should remain in the same atomic signing boundary as the consent insert
- version create and publish should lock and update template family rows transactionally

### Trigger updates

Extend the existing `app.enforce_consent_template_immutability()` trigger behavior so that when a draft transitions to `published`:

- `new.structured_fields_definition` must pass `app.validate_structured_fields_definition_for_publish`
- `new.structured_fields_definition` is replaced with the normalized JSON returned by that helper

This ensures publish-time definition validity even if a privileged client bypasses the intended route helper and attempts a direct row update.

### Backfill and compatibility

Existing rows:

- `structured_fields_definition = null`
- existing template IDs preserved

Existing consents:

- `structured_fields_snapshot = null`
- existing consent rows remain untouched

No invented scope or duration values are backfilled.

## Exact JSON shapes

### Template structured definition document

Column: `consent_templates.structured_fields_definition`

Null meaning:

- legacy template version with no structured field capture

Exact shape:

```json
{
  "schemaVersion": 1,
  "builtInFields": {
    "scope": {
      "fieldKey": "scope",
      "fieldType": "checkbox_list",
      "label": "Scope",
      "required": true,
      "orderIndex": 0,
      "options": [
        {
          "optionKey": "published_media",
          "label": "Published media",
          "orderIndex": 0
        }
      ]
    },
    "duration": {
      "fieldKey": "duration",
      "fieldType": "single_select",
      "label": "Duration",
      "required": true,
      "orderIndex": 1,
      "options": [
        {
          "optionKey": "one_year",
          "label": "1 year",
          "orderIndex": 0
        },
        {
          "optionKey": "two_years",
          "label": "2 years",
          "orderIndex": 1
        },
        {
          "optionKey": "three_years",
          "label": "3 years",
          "orderIndex": 2
        }
      ]
    }
  },
  "customFields": [
    {
      "fieldKey": "distribution_channel",
      "fieldType": "single_select",
      "label": "Distribution channel",
      "required": true,
      "orderIndex": 0,
      "helpText": "Where may we use the material?",
      "placeholder": null,
      "maxLength": null,
      "options": [
        {
          "optionKey": "website",
          "label": "Website",
          "orderIndex": 0
        }
      ]
    }
  ]
}
```

### Signed structured snapshot document

Column: `consents.structured_fields_snapshot`

Null meaning:

- legacy signed consent captured before structured fields existed or against a legacy template version

Exact shape:

```json
{
  "schemaVersion": 1,
  "templateSnapshot": {
    "templateId": "uuid",
    "templateKey": "tenant-template-abc123",
    "name": "Campaign Release",
    "version": "v2",
    "versionNumber": 2
  },
  "definition": {
    "schemaVersion": 1,
    "builtInFields": {
      "scope": {
        "fieldKey": "scope",
        "fieldType": "checkbox_list",
        "label": "Scope",
        "required": true,
        "orderIndex": 0,
        "options": [
          {
            "optionKey": "published_media",
            "label": "Published media",
            "orderIndex": 0
          }
        ]
      },
      "duration": {
        "fieldKey": "duration",
        "fieldType": "single_select",
        "label": "Duration",
        "required": true,
        "orderIndex": 1,
        "options": [
          {
            "optionKey": "one_year",
            "label": "1 year",
            "orderIndex": 0
          },
          {
            "optionKey": "two_years",
            "label": "2 years",
            "orderIndex": 1
          },
          {
            "optionKey": "three_years",
            "label": "3 years",
            "orderIndex": 2
          }
        ]
      }
    },
    "customFields": []
  },
  "values": {
    "scope": {
      "valueType": "checkbox_list",
      "selectedOptionKeys": ["published_media", "website"]
    },
    "duration": {
      "valueType": "single_select",
      "selectedOptionKey": "two_years"
    },
    "distribution_channel": {
      "valueType": "single_select",
      "selectedOptionKey": "website"
    },
    "notes": {
      "valueType": "text_input",
      "text": "Only for event recap"
    }
  }
}
```

### Value-shape rules

Checkbox-list field value:

```json
{
  "valueType": "checkbox_list",
  "selectedOptionKeys": ["option_a", "option_b"]
}
```

Single-select field value:

```json
{
  "valueType": "single_select",
  "selectedOptionKey": "option_a"
}
```

Text-input field value:

```json
{
  "valueType": "text_input",
  "text": "Plain user input"
}
```

Optional blank values are stored explicitly:

- optional checkbox list: empty `selectedOptionKeys`
- optional single select: `selectedOptionKey: null`
- optional text input: `text: null`

This keeps snapshot display deterministic and avoids guessing whether a field was omitted versus not present on the template.

## Built-in field rules

### `scope`

Definition rules:

- field key is always `scope`
- field type is always `checkbox_list`
- label is always `Scope`
- required is always `true`
- order index is always `0`
- options are editor-defined within the bounded option shape

Submit rules:

- signer must select at least one option
- signer may select multiple or all options
- selected option keys must all exist in the stored `scope.options[]`

### `duration`

Definition rules:

- field key is always `duration`
- field type is always `single_select`
- label is always `Duration`
- required is always `true`
- order index is always `1`
- options are fixed to exactly:
  - `one_year` => `1 year`
  - `two_years` => `2 years`
  - `three_years` => `3 years`

Submit rules:

- signer must select exactly one option
- selected option key must be one of the three canonical keys above

### Built-in publish rule

Every newly published template version after this feature must include both built-ins in a valid structured definition document.

Grandfathering rule:

- legacy already-published templates without `structured_fields_definition` remain valid and usable
- any new draft created after this feature is initialized with built-ins and must satisfy the new publish rules before publish succeeds

### Built-in representation inside JSON

Built-ins are represented inside the `builtInFields` object and are not part of `customFields`.

Reason:

- keeps them first-class semantically
- prevents accidental collisions with custom field keys
- keeps future built-in-specific validation bounded and explicit

## Custom field rules

### Supported custom field types

- `single_select`
- `checkbox_list`
- `text_input`

### Supported metadata now

Each custom field supports:

- `fieldKey`
- `fieldType`
- `label`
- `required`
- `orderIndex`
- `helpText`
- `placeholder`
- `maxLength`
- `options[]` where relevant

Each option supports:

- `optionKey`
- `label`
- `orderIndex`

### Excluded from scope

Do not add:

- conditional visibility logic
- nested or repeating fields
- dynamic validation rules
- field groups or sections
- inactive option state
- arbitrary rich-text field content

### Key rules

Field key and option key pattern:

- regex: `^[a-z][a-z0-9_]{1,63}$`

Additional rules:

- custom `fieldKey` values must be unique across `customFields`
- custom `fieldKey` values must not equal `scope` or `duration`
- option keys must be unique within their owning field

### Ordering rules

- built-ins are fixed first: `scope`, then `duration`
- custom fields render after built-ins, sorted by `orderIndex`
- server normalizes custom field `orderIndex` values from the submitted array order on draft save
- server normalizes option `orderIndex` values from the submitted array order on draft save

This avoids trusting raw client ordering blindly while still preserving explicit order in stored JSON.

## Validation and sanitization design

### Concrete limits

Draft-definition limits:

- max custom fields: `12`
- max scope options: `20`
- max options per custom select or checkbox field: `20`
- max field label length: `120`
- max option label length: `120`
- max help text length: `280`
- max placeholder length: `120`
- max field key length: `64`
- max option key length: `64`
- text-input `maxLength` allowed range: `1..500`
- default text-input `maxLength` when omitted: `200`
- max serialized `structured_fields_definition` payload size: `32768` bytes

Submit-value limits:

- max serialized structured submit payload size: `8192` bytes
- text input submitted length must be `<= field.maxLength`
- checkbox selections must not exceed the number of allowed options in the field

### Validation layers

#### Draft create and draft update

Validation lives in server helpers and route handlers.

Rules:

- `structured_fields_definition` may be null only for grandfathered pre-feature rows loaded from migration state
- all newly created drafts are initialized with a non-null starter definition
- custom field types must be one of the three allowed types
- `options[]` required for `single_select` and `checkbox_list`
- `options[]` must be absent or null for `text_input`
- `placeholder` and `maxLength` allowed only for `text_input`
- duration built-in shape is normalized to the canonical fixed definition
- scope built-in shape is normalized to fixed label, type, required flag, and order, while preserving its option list

#### Publish-time validation

Validation happens twice:

- server helper checks before calling publish
- DB publish path enforces again authoritatively via `app.validate_structured_fields_definition_for_publish`

Publish rules:

- `structured_fields_definition` must be a JSON object
- `schemaVersion` must equal `1`
- `builtInFields.scope` must exist and have at least one option
- `builtInFields.duration` must exist and match the canonical fixed option set exactly
- both built-ins must be `required: true`
- custom field keys and option keys must be unique and valid
- all label and payload limits must pass

#### Public submit-time validation

Validation order:

1. route parses fixed fields plus `structured__*` form keys
2. route normalizes obvious scalar and array shapes and enforces payload-size ceiling
3. route passes canonical structured values JSON into `submit_public_consent`
4. `submit_public_consent` validates against the invite-linked template version definition
5. `submit_public_consent` builds the normalized snapshot and inserts it atomically with the consent row

### Required-value rules

Required checkbox list:

- at least one allowed option selected

Required single select:

- exactly one allowed option selected

Required text input:

- trimmed non-empty string after normalization

Optional values:

- checkbox list may be empty
- single select may be null
- text input may be null after trimming

### Public-submit rejection rules

- unknown field keys are rejected
- unknown option keys are rejected
- client-provided labels are ignored
- duplicate option keys in a checkbox submission are normalized to unique values before validation
- text values are treated as plain text only
- text values are trimmed before requiredness checks
- text values containing null bytes are rejected

### Error codes

Protected draft and publish errors:

- `invalid_structured_fields_definition`
- `structured_fields_payload_too_large`
- `structured_scope_required`
- `invalid_structured_duration`
- `duplicate_structured_field_key`
- `duplicate_structured_option_key`
- `invalid_structured_text_limits`

Public submit errors:

- `invalid_structured_fields`
- `structured_field_required`
- `invalid_structured_field_value`
- `unknown_structured_field`
- `payload_too_large`

Public response shaping:

- route maps all structured-field public input errors to the existing generic invalid form state
- route keeps headshot-specific errors mapped to `headshot_required`
- no tenant, template, or option-label internals are exposed in public responses

## Versioning, immutability, and publish behavior

### Draft editing

Structured definitions can change only on drafts.

Editable on draft rows:

- `name`
- `description`
- `category`
- `body`
- `structured_fields_definition`

Not editable on published or archived rows:

- `structured_fields_definition`
- any built-in or custom field shape
- any option label or key

### New version creation

New version creation will be moved into `app.create_next_tenant_consent_template_version`.

Behavior:

- lock the template family rows
- if a draft already exists, return that draft
- otherwise create one new draft with the next `version_number`
- copy `name`, `description`, `category`, `body`, and `structured_fields_definition` from the source version
- if the source version has `structured_fields_definition is null`, initialize the new draft with a starter structured definition containing:
  - empty scope option list
  - canonical duration built-in
  - no custom fields

This makes old published templates grandfathered while ensuring all future draft work moves toward the structured model.

### Publish

Publish will be moved into `app.publish_tenant_consent_template`.

Behavior:

- lock all rows in the family
- validate the draft's `structured_fields_definition` authoritatively
- archive any currently published row in the family
- publish the target draft row
- return the published row

Publish remains idempotent:

- if the row is already published, return it unchanged

### Archive

Archive stays a simple state transition on one published row.

No unarchive action is added.

### Old invites and archived versions

The feature must preserve current live behavior:

- old invites continue using the exact linked version's definition
- archived versions referenced by old invites still render and sign correctly

No status filter is added to public invite lookups that would break invite-linked archived versions.

### Reliability decision

This feature will strengthen publish and version creation into DB-side transactional functions now.

Reason:

- the live Feature 039 multi-call helper sequence is the main reliability gap relevant to this feature
- structured-field publish rules make the template version row more semantically important
- fixing the atomicity boundary now is smaller than revisiting it later after more behavior depends on it

### Draft edit concurrency

Draft edits remain last-write-wins in this feature.

No optimistic concurrency token or ETag is added now.

Reason:

- it is not required for the immediate product need
- publish and version atomicity matter more than multi-admin draft conflict polish in this bounded increment

## Exact API and server validation changes

## Template management API

### `GET /api/templates`

Keep summary behavior mostly unchanged.

Optional addition:

- include `hasStructuredFields: boolean` for UI badges if useful

No full definition payload is needed in list responses.

### `POST /api/templates`

Create a new tenant draft template with:

- metadata fields as today
- starter `structured_fields_definition`

Request shape:

```json
{
  "name": "string",
  "description": "string|null",
  "category": "string|null",
  "body": "string"
}
```

Response shape:

- existing response shape, plus `structuredFieldsDefinition` in the nested template payload

### `GET /api/templates/[templateId]`

Extend the detail payload to return:

- `structuredFieldsDefinition`

### `PATCH /api/templates/[templateId]`

Accept draft metadata plus full structured definition document.

Request shape:

```json
{
  "name": "string",
  "description": "string|null",
  "category": "string|null",
  "body": "string",
  "structuredFieldsDefinition": {
    "schemaVersion": 1,
    "builtInFields": {},
    "customFields": []
  }
}
```

Server behavior:

- validate and normalize draft definition
- rewrite order indexes from array order
- normalize built-in labels and duration options
- persist normalized JSON on the draft row

### `POST /api/templates/[templateId]/versions`

Route behavior changes:

- still requires `Idempotency-Key`
- server helper continues idempotency handling in `idempotency_keys`
- actual next-version row creation happens inside the new DB function

### `POST /api/templates/[templateId]/publish`

Route behavior changes:

- server helper performs a preflight read for friendly errors
- actual publish state transition happens inside the new DB function
- function revalidates the structured definition authoritatively

### `POST /api/templates/[templateId]/archive`

No architectural change beyond carrying the new structured definition field as read-only on archived rows.

## Public invite read API

### `get_public_invite`

Extend both `app.get_public_invite` and `public.get_public_invite` to return:

- existing invite metadata
- `consent_text`
- `consent_version`
- `structured_fields_definition`

Legacy behavior:

- `structured_fields_definition = null`

Structured behavior:

- return the exact invite-linked template version's definition JSON

No status filter should be added for the template join.

## Public submit path

### Form payload encoding

Encode submitted structured values in normal form fields using a reserved prefix:

- `structured__scope`
- `structured__duration`
- `structured__custom_field_key`

Encoding rules:

- checkbox lists submit repeated entries with the same field name
- single-select submits one scalar value
- text input submits one scalar string

The route canonicalizes these raw form entries into JSON before calling the RPC.

### Route changes: `/i/[token]/consent`

Add route parsing for all `structured__*` fields.

Route responsibilities:

- normalize fixed fields
- normalize structured field map
- enforce raw structured payload size limit
- preserve current headshot checks
- pass canonical structured JSON into `submitConsent`
- map structured validation failures to generic invalid-form redirect state

### `submitConsent` helper changes

Extend the helper input with:

- `structuredFieldValues: Record<string, unknown> | null`

Pass through to RPC:

- `p_structured_field_values jsonb`

### `submit_public_consent` RPC changes

Extend both `app.submit_public_consent` and `public.submit_public_consent` signatures with:

- `p_structured_field_values jsonb default null`

Authoritative logic inside the RPC:

1. lock the invite row
2. read the invite-linked template row including `structured_fields_definition`
3. on duplicate consent for the invite, return the existing consent unchanged
4. if template definition is null:
   - require null or empty structured input
   - insert consent with `structured_fields_snapshot = null`
5. if template definition is present:
   - validate submitted values against that exact definition
   - build normalized `structured_fields_snapshot`
   - insert consent with that snapshot
6. continue the existing subject, revoke token, invite usage, event-log, and face-match logic

Duplicate-submit behavior:

- first successful write wins
- retries return the existing consent and preserve the first written structured snapshot unchanged

## Public rendering changes

### Legacy versus structured determination

Public page behavior:

- if `structured_fields_definition` is null, render the current legacy form path
- if `structured_fields_definition` is non-null, render the same overall form with an added structured fields section

### `PublicConsentForm` rendering

Keep current fixed sections:

- subject name
- subject email
- face-match opt-in and headshot upload
- consent text

Add a structured fields section for structured templates:

- built-in scope checkbox list
- built-in duration single-select dropdown
- custom fields rendered by type

No arbitrary field renderer beyond the three supported types is introduced.

## Protected app UI changes

## Template editor UI

### Create flow

Keep the current template-create entry flow lightweight.

Behavior:

- `POST /api/templates` creates the draft with the starter structured definition
- the create modal or form does not become a full builder
- after create, the existing detail/editor view remains the place where structured fields are configured

### Template detail and draft editor

Extend the live Feature 039 detail editor to support one bounded structured-fields section.

Editor sections:

- template metadata and consent body as today
- built-in `scope` editor
- built-in `duration` summary
- custom fields editor

#### Built-in `scope` editor

Allow editors to:

- add scope options
- edit scope option labels
- reorder scope options
- remove scope options while draft is still editable

Do not allow editors to:

- change field key
- change field type
- turn off required

#### Built-in `duration` editor

Show duration as a fixed required field with the canonical three options:

- `1 year`
- `2 years`
- `3 years`

No option editing is allowed.

Reason:

- the product requirement is bounded to exactly those three allowed values
- preventing edits keeps reporting and future enforcement predictable

#### Custom fields editor

Allow editors to:

- add a new field of type `single_select`, `checkbox_list`, or `text_input`
- edit `label`
- edit `required`
- edit `helpText`
- edit `placeholder` for text inputs
- edit `maxLength` for text inputs
- manage `options[]` for select and checkbox fields
- reorder custom fields

Do not allow:

- reserved keys `scope` or `duration`
- unsupported field types
- conditional rules
- nested groups
- rich text or HTML field content

### Template detail read-only states

Published and archived template versions should display structured definitions read-only.

This makes immutability visible in the UI and avoids suggesting that published definitions can be edited in place.

## Protected consent-details UI

### Data loading

Extend the protected project consent-details query to include:

- `consents.structured_fields_snapshot`

The UI must render from the signed snapshot only.

Do not read the current template definition to render signed structured values.

### Display approach

Render a new consent-details section after the current signed-consent metadata.

Order:

- subject name and email as today
- signed timestamp as today
- consent version as today
- biometric state as today
- structured values section
- consent text as today

Structured values section rendering:

- `Scope`: comma-separated or stacked list of selected option labels from the signed snapshot
- `Duration`: one selected label from the signed snapshot
- custom fields: label plus rendered signed value from the snapshot

Type-specific rendering:

- checkbox list: render selected labels only
- single select: render selected label
- text input: render plain text value

Legacy behavior:

- if `structured_fields_snapshot` is null, show no structured-values section or show a small "Legacy consent without structured values" note

### Receipt and email surfaces

No receipt or email template expansion is included in this feature.

Reason:

- the immediate product need is protected-app visibility
- the new snapshot shape is sufficient to support future email or receipt rendering without another schema change

## Compatibility and migration

### Existing templates

Existing published and archived templates with `structured_fields_definition = null` remain valid legacy templates.

Behavior:

- they can still be selected where currently allowed
- invites linked to them continue to render the legacy public form
- they do not get invented scope or duration data

### Existing invites

No invite migration is required.

Behavior:

- invites keep pointing to the same concrete template version row
- if that row has `structured_fields_definition = null`, public signing stays legacy
- if that row has a structured definition, public signing renders and validates against that exact definition
- archived versions referenced by old invites still render and sign correctly

### Existing consents

Existing rows keep `structured_fields_snapshot = null`.

Behavior:

- protected consent details treat them as legacy consents
- no backfill is attempted
- receipt rendering remains unchanged

### Project defaults and template selection

No schema redesign is needed for project defaults or invite selection.

Behavior:

- `projects.default_consent_template_id` still references a concrete template version row
- if staff choose a structured published version, future invites linked to that version inherit its exact structured definition through the existing invite-to-template link
- switching a project default later does not affect already-created invites

### Rollout rule

Rollout remains additive:

- legacy templates stay usable
- legacy consents stay readable
- newly published structured templates must satisfy the new built-in rules
- newly created drafts are initialized with structured built-ins

## Security and authorization

### Tenant and ownership rules

- tenant resolution remains server-derived from auth and database state
- no route accepts tenant ownership from client input
- tenant routes continue rejecting edits to app-wide templates
- structured definitions are stored only on the authoritative template row, never trusted from client after submit-time validation

### Public signing trust boundary

Public signing trusts only:

- invite token
- invite-linked template version row
- server-side template definition read

Public signing does not trust:

- template IDs from the browser
- field labels from the browser
- option labels from the browser
- client-provided definition JSON

### Authorization implications

Protected template APIs must continue enforcing:

- authenticated access
- tenant ownership
- draft-only mutability
- no mutation of published or archived versions

### Validation response safety

Public validation responses remain generic.

Do not leak:

- tenant existence
- template ownership
- internal field-definition structure beyond the existing invalid-form redirect

## Retry safety, concurrency, and partial failure

### Duplicate public submit

The consent write path remains invite-scoped and idempotent.

Behavior:

- duplicate submissions for the same invite return the first written consent
- the first written `structured_fields_snapshot` remains authoritative

### Partial failure after consent write

If the response is lost after a successful consent insert:

- a retry with the same invite reaches the duplicate path
- the existing consent row is returned
- no second consent row is created
- no second structured snapshot is written

### Stale or tampered public payloads

If the browser submits:

- unknown field keys
- missing required built-ins
- values from an older draft shape
- option labels instead of option keys

the submit RPC rejects the payload against the invite-linked stored definition.

### Concurrent draft edits

Draft edits remain last-write-wins in this feature.

No optimistic concurrency token is added now.

### Concurrent version creation

`app.create_next_tenant_consent_template_version` must lock the template family and remain idempotent per source template:

- if an open draft already exists, return it
- do not create two next-version drafts under race

### Concurrent publish

`app.publish_tenant_consent_template` must lock the template family and perform archive-plus-publish atomically.

This prevents:

- two rows becoming published
- a temporary no-published-version gap caused by mid-sequence failure

## Test plan

## Migration and compatibility tests

- migration applies cleanly on databases that already contain Feature 039 template, invite, and consent data
- existing templates remain readable with `structured_fields_definition = null`
- existing consents remain readable with `structured_fields_snapshot = null`
- existing invite-linked legacy templates still render the legacy public form

## Template-definition validation tests

- starter draft definition includes built-in `scope` and canonical `duration`
- draft update rejects invalid custom field type
- draft update rejects duplicate field keys
- draft update rejects duplicate option keys
- draft update rejects reserved custom keys `scope` and `duration`
- draft update rejects text-input options
- draft update rejects select or checkbox field without options
- draft update normalizes order indexes from submitted array order
- draft update normalizes duration back to the fixed canonical option set

## Publish validation tests

- publish rejects missing `scope`
- publish rejects empty `scope.options`
- publish rejects missing `duration`
- publish rejects non-canonical duration options
- publish rejects structured-definition payload over the size limit
- publish succeeds for a valid structured draft
- publish of legacy already-published row remains readable but no in-place structured mutation is allowed

## Public render tests

- public invite read returns `structured_fields_definition = null` for legacy templates
- public invite read returns the exact definition JSON for structured templates
- public page renders legacy mode when definition is null
- public page renders built-in scope, built-in duration, and custom fields when definition is present

## Public submit validation tests

- required `scope` rejects zero selections
- `scope` accepts multiple selections
- required `duration` rejects missing value
- `duration` rejects non-canonical option key
- custom single-select rejects unknown option key
- custom checkbox list rejects unknown option key
- required text input rejects blank trimmed value
- text input rejects over-max-length value
- payload rejects unknown field key
- payload rejects oversized structured submit payload
- legacy template rejects unexpected structured input

## Signed snapshot storage tests

- successful structured submit stores a normalized `structured_fields_snapshot`
- snapshot includes exact definition copy, template metadata, and normalized selected values
- duplicate retry preserves the first snapshot unchanged
- legacy submit stores `structured_fields_snapshot = null`

## Protected UI tests

- template detail editor loads and saves structured definitions for drafts
- published template detail shows structured definitions read-only
- project consent-details renders built-in structured values from the signed snapshot
- project consent-details renders custom field values from the signed snapshot
- project consent-details handles legacy null snapshot without crashing

## Authorization and isolation tests

- tenant user cannot edit app-wide template structured definitions
- tenant user cannot mutate another tenant's template structured definitions
- public submit ignores client-supplied template identifiers and validates only against the invite-linked version

## Reliability tests

- concurrent version-create requests return one draft version row
- concurrent publish requests preserve one published version row
- invites referencing archived versions still load and sign against the archived linked version

## Implementation phases

### Phase 1: schema and DB reliability boundary

- add `structured_fields_definition` to `consent_templates`
- add `structured_fields_snapshot` to `consents`
- add object-type checks
- add definition and submit validation helpers
- add transactional DB functions for version create and publish
- extend submit RPC to accept and persist structured values

### Phase 2: server helpers and API contracts

- update template service helpers for draft definition reads and writes
- route version-create and publish through the new DB functions
- extend template detail API payloads
- extend public invite read payloads
- extend public submit helper and route parsing

### Phase 3: public rendering and submit UX

- render structured fields in `PublicConsentForm`
- encode structured form values with the reserved field prefix
- preserve current headshot and biometric flow
- map structured submit failures into the existing invalid redirect state

### Phase 4: protected template editor UI

- add built-in `scope` editor
- add fixed `duration` display
- add bounded custom fields editor
- add draft-only edit behavior and published read-only behavior

### Phase 5: protected consent-details UI

- load `structured_fields_snapshot`
- render structured values from the snapshot
- handle legacy null snapshot cleanly

### Phase 6: tests and cleanup

- add migration and RPC coverage
- add template editor API and UI coverage
- add public render and submit coverage
- add protected consent-details coverage
- confirm existing Feature 039 tests still pass with the extended contracts

## Scope boundaries

Explicitly out of scope for this feature:

- duration-based expiry or automatic deactivation
- reporting or filtering redesign
- new reporting indexes for structured values
- receipt or email expansion
- guardian or multi-signer workflow redesign
- conditional or dynamic forms
- nested or repeating fields
- arbitrary validation DSLs
- biometric configuration redesign
- unrelated invite, auth, or project-flow redesign

## Concise implementation prompt

Implement Feature 042 on top of the live Feature 039 system by adding bounded structured consent fields to versioned templates and immutable signed snapshots to consents. Add `consent_templates.structured_fields_definition jsonb` and `consents.structured_fields_snapshot jsonb`, use reserved built-ins for `scope` and `duration`, keep custom fields limited to `single_select`, `checkbox_list`, and `text_input`, validate draft edits and publish-time definitions server-side plus DB-side, validate submitted structured values only against the invite-linked template version inside the public submit RPC, preserve idempotent invite-scoped consent writes, keep published versions immutable, keep legacy templates and consents compatible with null structured JSON, extend the public form and protected consent-details UI to render from the authoritative definition or signed snapshot, and strengthen version-create plus publish into DB-transactional functions so old invites, archived linked versions, and duplicate submit retries all remain safe and reproducible.
