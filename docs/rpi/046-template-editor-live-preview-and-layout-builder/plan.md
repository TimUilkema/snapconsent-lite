# 046 Template Editor Live Preview and Layout Builder Plan

## Inputs and ground truth

### Inputs read for this plan

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/046-template-editor-live-preview-and-layout-builder/research.md`

### Live implementation rechecked

- `src/components/templates/template-detail-client.tsx`
- `src/components/templates/template-structured-fields-editor.tsx`
- `src/components/public/public-consent-form.tsx`
- `src/components/public/public-structured-fields.tsx`
- `src/app/i/[token]/consent/route.ts`
- `src/lib/consent/submit-consent.ts`
- `src/lib/templates/template-service.ts`
- `src/lib/templates/structured-fields.ts`
- `supabase/migrations/20260407213000_042_structured_consent_template_fields.sql`

## Verified current boundary

- Templates are still row-per-version in `public.consent_templates`.
- Draft, published, and archived lifecycle is already implemented and enforced.
- `structured_fields_definition` already models built-ins plus custom structured fields.
- The protected template editor can edit draft metadata, body, scope options, and custom structured fields.
- The protected template editor has no preview today.
- The protected template editor has no layout model today.
- The public consent form is still ordered by hardcoded React markup:
  - name
  - email
  - structured fields
  - face-match
  - headshot upload
  - consent text
  - submit button
- Public submit authority already lives in `submit_public_consent`.
- Public submit semantics depend on field names and payload shape, not visual order.
- Signed consent auditability already depends on immutable published template rows plus the existing consent snapshot model.

This plan extends that live implementation. It does not redesign the invite, signing, or snapshot architecture.

## Options considered

### Option A: editor-only preview with no persisted layout metadata

Pros:

- smallest UI change

Cons:

- does not make the form template-owned
- cannot persist drag/drop order
- leaves public ordering permanently hardcoded

Assessment:

- rejected

### Option B: fold layout into `structured_fields_definition`

Pros:

- one JSON document on the template row

Cons:

- mixes field semantics with page layout
- does not cleanly represent system-owned blocks like name, email, and consent text
- makes validation and future maintenance harder

Assessment:

- rejected

### Option C: add separate layout metadata and extract a shared renderer

Pros:

- keeps `structured_fields_definition` focused on field semantics
- cleanly supports system-owned but movable blocks
- additive to the current row-per-version template architecture
- allows one shared render path for public and preview shells

Cons:

- adds one more versioned JSON document
- requires a renderer extraction instead of a quick preview-only component

Assessment:

- chosen

## Recommendation

Implement Option C.

- Keep `structured_fields_definition` as the field-definition model.
- Add a separate `form_layout_definition` model on `consent_templates`.
- Extract a shared one-column consent-form block renderer.
- Add a protected preview-only validate path.
- Keep real submit authority in the existing public submit flow and RPC.

## Chosen architecture

## Architecture summary

- `consent_templates` remains the canonical version-row table.
- `structured_fields_definition` remains the canonical structured field-definition document.
- Add `form_layout_definition jsonb` on `consent_templates` for one-column block order.
- Published and archived rows remain immutable.
- Draft rows can edit layout metadata together with structured definition metadata.
- Old invites keep pointing at concrete template version rows.
- Public rendering reads the invite-linked template row's:
  - `body`
  - `version`
  - `structured_fields_definition`
  - `form_layout_definition`
- Public submit remains invite-scoped and authoritative on the server.
- Preview runs through a protected, non-persistent dry-run validation path and never calls the real submit RPC.

## Explicit architecture decisions

- Chosen layout storage: separate `form_layout_definition` column on `consent_templates`
- Chosen layout scope: one column only
- Chosen layout controls: drag/drop reorder of blocks only
- No sections, groups, columns, tabs, or arbitrary page-builder controls
- `face_match_section` is movable in v1
- `consent_text` is movable in v1
- The final submit button stays outside layout metadata in v1
- Real headshot upload is out of scope for preview mode
- Preview uses simulated face-match and headshot state only

## Exact v1 scope boundary

## Included

- protected template editor live preview panel
- interactive preview inputs for:
  - subject name
  - subject email
  - structured built-ins
  - structured custom fields
  - face-match toggle
- preview-only confirm button that validates only
- field-level and block-level preview error display
- one-column drag/drop reorder of layout blocks
- template-owned stored order of rendered form blocks
- public form rendering updated to respect template layout metadata
- draft-only layout editing and versioning

## Explicitly out of scope

- full arbitrary page builder
- multi-column layout
- sections, groups, tabs, regions, or multi-page flows
- conditional visibility logic
- nested or repeating layout structures
- real preview submission
- real preview asset creation
- real preview headshot upload
- invite/auth flow redesign
- signed snapshot redesign
- receipt or email redesign

## Exact layout model

### Storage choice

Add:

- `public.consent_templates.form_layout_definition jsonb null`

Add object-type check:

- `form_layout_definition is null or jsonb_typeof(form_layout_definition) = 'object'`

### TypeScript model

Add a new helper module under `src/lib/templates/`, for example `form-layout.ts`, that defines:

- `FORM_LAYOUT_SCHEMA_VERSION = 1`
- `ConsentFormLayoutDefinition`
- `ConsentFormLayoutBlock`
- normalization and default-derivation helpers

### Exact JSON shape

```json
{
  "schemaVersion": 1,
  "blocks": [
    { "kind": "system", "key": "subject_name" },
    { "kind": "system", "key": "subject_email" },
    { "kind": "built_in", "key": "scope" },
    { "kind": "built_in", "key": "duration" },
    { "kind": "custom_field", "fieldKey": "audience" },
    { "kind": "custom_field", "fieldKey": "channels" },
    { "kind": "system", "key": "face_match_section" },
    { "kind": "system", "key": "consent_text" }
  ]
}
```

### Allowed block kinds and keys

System blocks:

- `subject_name`
- `subject_email`
- `face_match_section`
- `consent_text`

Built-in blocks:

- `scope`
- `duration`

Custom-field blocks:

- one block per custom field key in `structured_fields_definition.customFields`

### Ordering rules

- `blocks[]` array order is the rendered top-to-bottom order
- no nested structures
- no section wrappers
- no per-block width or style metadata
- no optional hidden blocks in v1

### Completeness and uniqueness rules

For a layout to be valid:

- each required system block appears exactly once
- each built-in block appears exactly once when structured definition exists
- each custom field appears exactly once
- no unknown system keys
- no duplicate system or built-in keys
- no duplicate custom field keys
- no stale custom field references

### Default/fallback derived layout

If `form_layout_definition` is null, derive this effective order:

1. `subject_name`
2. `subject_email`
3. `scope` if structured definition exists
4. `duration` if structured definition exists
5. custom fields in current `customFields` order
6. `face_match_section`
7. `consent_text`

This preserves current live behavior for old templates and old invites.

### Draft normalization behavior

On draft save and preview validation:

- validate the submitted layout against the submitted structured definition
- reject unknown or duplicate blocks
- reject missing required blocks
- reject stale custom-field references
- preserve the submitted order as-is if valid

No silent server reordering is done beyond structural normalization of a valid layout.

## Exact ownership model for blocks

## System-owned but layout-positionable blocks

- `subject_name`
- `subject_email`
- `face_match_section`
- `consent_text`

Rules:

- these remain system-owned semantically
- they are not arbitrary custom fields
- the template can choose where they appear in the one-column order

## Template-owned semantic fields

- built-in `scope`
- built-in `duration`
- all custom structured fields

Rules:

- built-ins can be reordered relative to each other and relative to custom fields
- custom fields keep their current semantic model
- layout order is separate from `orderIndex`

## Fixed outside the layout model in v1

- preview-only confirm button
- real public submit button
- page chrome and project heading

## Exact schema and DB plan

## Migration changes

Add one migration extending Feature 042.

### `public.consent_templates`

Add:

- `form_layout_definition jsonb null`

Add check:

- object type or null

### DB helper functions

Add:

- `app.build_form_layout_definition_starter(p_structured_fields_definition jsonb) returns jsonb`
- `app.normalize_form_layout_definition_internal(p_layout jsonb, p_structured_fields_definition jsonb) returns jsonb`
- `app.validate_form_layout_definition_for_draft(p_layout jsonb, p_structured_fields_definition jsonb) returns jsonb`
- `app.validate_form_layout_definition_for_publish(p_layout jsonb, p_structured_fields_definition jsonb) returns jsonb`

Behavior:

- derive required block set from the current structured definition
- validate schema version, array shape, keys, uniqueness, and completeness
- preserve submitted order when valid

### Trigger updates

Extend `app.enforce_consent_template_immutability()` so that:

- inserting a draft row auto-builds starter `form_layout_definition` if null
- updating a draft row requires non-null layout metadata
- draft updates validate `structured_fields_definition` and `form_layout_definition` together
- draft-to-published transition validates both for publish
- published and archived rows keep `form_layout_definition` immutable

### Version-create and publish RPC updates

Extend:

- `app.create_next_tenant_consent_template_version`
- `public.create_next_tenant_consent_template_version`
- `app.publish_tenant_consent_template`
- `public.publish_tenant_consent_template`

So they:

- copy `form_layout_definition` to new drafts
- return `form_layout_definition`
- validate layout on publish

### No consent schema changes

Do not add layout snapshot columns to `consents` in this feature.

Reason:

- layout does not change consent semantics
- published template rows are already immutable and invite-linked
- the current signed snapshot model remains intact

## Exact API contract changes

## `GET /api/templates/[templateId]`

Extend the response to include:

- `formLayoutDefinition`

Behavior:

- if the stored row has null layout, return a derived effective layout
- for draft rows this should normally be explicit after migration and update paths
- for legacy published rows this keeps read-only rendering compatible

### Response shape addition

```json
{
  "template": {
    "formLayoutDefinition": {
      "schemaVersion": 1,
      "blocks": []
    }
  }
}
```

## `PATCH /api/templates/[templateId]`

Extend the request to accept:

- `formLayoutDefinition`

Behavior:

- draft only
- validate candidate structured definition first
- validate candidate layout against the candidate structured definition
- persist both on the draft row

### Request shape addition

```json
{
  "name": "string",
  "description": "string|null",
  "category": "string|null",
  "body": "string",
  "structuredFieldsDefinition": {},
  "formLayoutDefinition": {
    "schemaVersion": 1,
    "blocks": []
  }
}
```

## `POST /api/templates`

Behavior change:

- new draft rows should include starter `formLayoutDefinition`

Response:

- include `formLayoutDefinition` in the returned template payload

## `POST /api/templates/[templateId]/versions`

Behavior change:

- copied drafts keep the source row's layout metadata when present
- if the source row has null layout, derive starter layout from the source structured definition

Response:

- include `formLayoutDefinition`

## `POST /api/templates/[templateId]/publish`

Behavior change:

- publish validates both:
  - `structured_fields_definition`
  - `form_layout_definition`

Published immutability remains unchanged.

## New protected preview validation endpoint

Add:

- `POST /api/templates/[templateId]/preview-validate`

Auth:

- authenticated
- current tenant `owner` or `admin`
- template must be visible in current tenant scope

Request shape:

```json
{
  "structuredFieldsDefinition": {},
  "formLayoutDefinition": {},
  "previewValues": {
    "subjectName": "string|null",
    "subjectEmail": "string|null",
    "faceMatchOptIn": true,
    "hasMockHeadshot": false,
    "structuredFieldValues": {}
  }
}
```

Response shape:

```json
{
  "valid": false,
  "configurationErrors": ["layout_invalid"],
  "fieldErrors": {
    "subject_name": "required",
    "subject_email": "invalid",
    "scope": "required",
    "face_match_section": "headshot_required"
  }
}
```

This endpoint is preview-only and non-persistent.

## Public API and RPC changes

### `public.get_public_invite`

Extend the result to include:

- `form_layout_definition`

### `submit_public_consent`

No signature change is required.

Reason:

- visual order does not affect the submitted payload shape
- field names and validation semantics stay the same

## Exact renderer strategy

## Chosen renderer direction

Extract shared rendering instead of duplicating the public form in the editor.

### New shared renderer layer

Add shared client components under a neutral area, for example `src/components/consent/`:

- `consent-form-layout-renderer.tsx`
- `consent-form-block-renderer.tsx`
- small block subcomponents if needed

Shared renderer inputs:

- `consentText`
- `consentVersion`
- `structuredFieldsDefinition`
- `formLayoutDefinition`
- current values
- current errors
- mode flags
- callbacks for value changes
- optional face-match preview state

### Public shell responsibilities

Keep in `PublicConsentForm`:

- real token-scoped form action
- real headshot upload/finalize logic
- hidden fields for real submit
- public translations
- final real submit button

Replace its hardcoded middle body with the shared renderer.

### Protected preview shell responsibilities

Add a new preview client component in the template editor that owns:

- transient preview values
- transient preview errors
- preview-only confirm action
- simulated face-match and headshot state
- final preview-only confirm button

It also uses the same shared renderer.

### Structured-field renderer reuse

`PublicStructuredFieldsSection` should not remain the primary renderer for v1.

Instead:

- extract or replace its field-input logic inside the shared block renderer
- reuse `getStructuredFieldByKey`, `getStructuredFieldsInOrder`, and related helpers from `structured-fields.ts`

## Exact preview behavior

## Preview state model

Keep preview state separate from draft template-definition state.

Draft state:

- `name`
- `category`
- `description`
- `body`
- `structuredFieldsDefinition`
- `formLayoutDefinition`

Preview state:

- `subjectName`
- `subjectEmail`
- `faceMatchOptIn`
- `hasMockHeadshot`
- structured field values keyed by `fieldKey`
- touched map
- field error map
- configuration error list

## Preview interaction behavior

- typing into the preview updates only preview state
- changing draft definition or layout re-renders the preview immediately
- preview values are preserved across reorder by stable block or field key
- deleting a custom field removes its preview value and preview error
- renaming a custom field drops the old preview value for the old key
- changing a custom field type drops incompatible prior preview value for that key

## Preview confirm behavior

- preview confirm never persists
- preview confirm never creates a consent
- preview confirm never mutates invite state
- preview confirm never creates assets
- preview confirm calls the protected preview-validate endpoint only
- validation result is rendered inline in the preview

## Preview layout behavior

- drag/drop reorder mutates draft layout state immediately
- preview updates immediately after reorder
- errors remain attached by key after reorder, not by old index

## Exact validation model

## Chosen model

Use a mixed model:

- local client validation for interaction convenience
- protected server dry-run validation for authoritative preview results

### Local client validation

Use for:

- clearing field errors when the user edits a field
- light browser-native constraints on name, email, text length, select requiredness
- immediate face-match and mock-headshot UX feedback

This is UX only.

### Protected dry-run validation

The new preview-validate route is the authoritative preview validation boundary.

It should:

1. validate candidate `structuredFieldsDefinition` with the shared TypeScript draft validator
2. validate candidate `formLayoutDefinition` against that candidate structured definition
3. if layout or definition is invalid, return configuration errors and skip field validation
4. validate structured field values through a DB-backed helper path
5. validate fixed blocks through a shared server helper

### Structured-field validation reuse

Add a small server helper path that reuses the existing DB validator:

- wrap `app.validate_submitted_structured_field_values` in a route-facing helper or public wrapper function for authenticated preview use

Reason:

- keeps structured-field preview validation aligned with the real authoritative rules

### Fixed-field shared validation

Add a shared server helper for fixed blocks, for example under `src/lib/consent/`:

- `validate-consent-base-fields.ts`

It should validate:

- `subject_name`
  - trimmed
  - minimum length 2
- `subject_email`
  - trimmed
  - basic email shape aligned with current public route behavior
- `face_match_section`
  - if face match enabled, mock headshot must be present

Use this helper in:

- the preview-validate route
- the public submit route before calling `submitConsent`

This reduces drift without changing the authoritative submit RPC.

### Preview validation is not public authority

Even after this feature:

- preview validation is convenience only
- real public submit remains authoritative on the server and invite-scoped

## Headshot and face-match preview scope

## Chosen bounded behavior

Include `face_match_section` in layout v1 as a movable system block.

Preview behavior:

- render the face-match block
- allow toggling face-match on and off
- show a simulated headshot status control instead of a real upload control
- allow preview to set `hasMockHeadshot = true/false`
- if face match is enabled and mock headshot is false, preview validation returns `headshot_required`

Explicitly do not do in preview:

- file picking
- signed upload URL creation
- asset row creation
- finalize route calls
- asset-consent linkage

Reason:

- keeps preview bounded
- preserves requested validation behavior
- avoids real side effects

## Drag/drop implementation plan

## Chosen implementation direction

Add a small sortable library rather than using raw native drag behavior.

Recommended library set:

- `@dnd-kit/core`
- `@dnd-kit/sortable`
- `@dnd-kit/utilities`

Reason:

- good fit for one-column sortable lists
- easier stable ids and keyboard support
- cleaner React state integration than manual HTML5 drag events

## Reorderable editor list

Add a new layout editor section in the template detail page that renders one sortable list containing:

- system blocks
- built-in blocks
- custom-field blocks

Each item shows:

- label
- block kind badge
- optional note when the block is system-owned

No nested lists.

## Stable sortable ids

Use derived ids:

- `system:subject_name`
- `system:subject_email`
- `built_in:scope`
- `built_in:duration`
- `custom_field:<fieldKey>`
- `system:face_match_section`
- `system:consent_text`

On drag end:

- reorder the `blocks[]` array
- persist into local `formLayoutDefinition` state
- do not mutate `structuredFieldsDefinition`

## Synchronization with structured-field edits

When custom fields change:

- add field:
  - insert a corresponding `custom_field` block after the last current structured-field block, or before `face_match_section` if there is no later structured block
- delete field:
  - remove the corresponding block
- rename field key:
  - update the corresponding block reference
- change field type:
  - keep the same block reference

This keeps layout and semantics synchronized without forcing the user to rebuild the block list manually.

## Compatibility and migration story

## Existing templates with null structured fields

Behavior:

- `structured_fields_definition` remains null
- `form_layout_definition` remains null unless a new draft version is created
- effective layout derives to:
  - subject name
  - subject email
  - face-match section
  - consent text

## Existing templates with structured fields but null layout metadata

Behavior:

- effective layout derives to the current live order
- public invites continue to render safely
- old published rows do not need backfill

## Existing published legacy templates

Behavior:

- remain immutable
- may keep null `form_layout_definition`
- editor read paths return derived effective layout for display
- creating a new draft version from one of these rows should materialize explicit starter layout on the new draft row

## Existing invites

Behavior:

- no invite migration
- existing invites keep the same template version id
- public render derives effective layout if the template row has null layout metadata
- public submit semantics remain unchanged

## Security and reliability considerations

## Security

- tenant-scoped template editing remains protected and server-derived
- preview-validate route is protected, not public
- no client-provided tenant id is trusted
- real consent submit authority remains in the invite-scoped public server flow
- preview convenience must not weaken public-submit validation

## Reliability

- layout draft saves remain retry-safe through normal PATCH semantics
- version create and publish continue using DB-side guarded functions
- layout validation joins publish-time validation so invalid layouts cannot become published
- preview validation performs no writes, so retries are harmless

## Partial-failure handling

- preview validate failures return errors only, with no side effects
- layout save failures do not mutate published rows
- version creation copies layout in the same DB-side version workflow as other template row data
- public submit remains unchanged in its idempotent duplicate-consent behavior

## Edge cases

- Legacy templates with null layout metadata:
  - derive effective default order
- Draft templates with incomplete structured definitions:
  - preview shows configuration errors and disables successful validation result
- Required fields missing in preview:
  - field-level errors return by stable block or field key
- Reorder while errors are visible:
  - errors stay attached by key after reorder
- Deleting a field with preview state:
  - drop its preview value and error state immediately
- Templates with no custom fields:
  - layout contains only system and built-in blocks
- Templates with many custom fields:
  - one-column list remains sortable and scrollable
- Built-ins moved relative to custom fields:
  - allowed in v1
- Preview of face-match block:
  - simulated only, never real upload or asset creation

## Test plan

## Migration and schema tests

- migration adds `form_layout_definition` cleanly
- null layout remains valid on legacy rows
- draft insert builds starter layout
- publish validation rejects malformed layout
- published rows keep layout immutable

## Layout helper tests

- default layout derivation for:
  - null structured definition
  - structured definition with no custom fields
  - structured definition with custom fields
- layout validation rejects:
  - duplicate blocks
  - unknown blocks
  - missing required blocks
  - stale custom-field references
- layout validation preserves valid custom ordering

## Template API and service tests

- `GET /api/templates/[templateId]` returns effective layout metadata
- `PATCH /api/templates/[templateId]` accepts and persists valid layout metadata
- draft save rejects invalid layout metadata
- create-version copies or derives layout correctly
- publish validates layout and structured definition together

## Renderer alignment tests

- shared renderer outputs the same block order for public and preview shells given the same layout
- derived default layout matches the current legacy public order
- built-ins reordered relative to custom fields render correctly
- system blocks reordered around structured fields render correctly

## Preview validation tests

- missing subject name returns a keyed error
- invalid subject email returns a keyed error
- missing required built-in values return keyed errors
- missing required custom values return keyed errors
- face match enabled without mock headshot returns `face_match_section` error
- invalid layout or invalid structured definition returns configuration errors and no side effects

## Preview side-effect tests

- preview validate creates no `consents`
- preview validate does not update `subject_invites.used_count`
- preview validate creates no `subjects`
- preview validate creates no `assets`

## Compatibility tests

- old templates with null layout still render through derived order
- old invites linked to templates with null layout still submit successfully
- archived invite-linked template versions still render and submit with derived or explicit layout

## UI tests

- drag/drop reorder updates local layout state
- saving after reorder persists the new order
- preview updates immediately after reorder
- deleting a field removes its preview value and block

## Implementation phases

### Phase 1: additive layout metadata and validation

- add `form_layout_definition` column and check constraint
- add DB starter and validation helpers
- extend immutability trigger
- extend version-create and publish DB functions

### Phase 2: template service and API contracts

- add TypeScript layout helpers and types
- extend `TemplateRow`, `TemplateDetail`, and related service mappings
- extend template create, read, update, version, and publish flows for layout metadata
- add preview-validate route contract

### Phase 3: shared renderer extraction

- extract shared consent-form block renderer
- move structured-field rendering into shared block components
- keep public shell behavior intact while switching to the shared renderer

### Phase 4: protected preview panel

- add preview state model
- add preview shell to the template editor page
- render live preview from current draft state

### Phase 5: layout editor and drag/drop

- add sortable one-column layout editor
- synchronize layout state with structured-field add, rename, and delete flows
- wire reorder into draft save payload

### Phase 6: preview validation and regression coverage

- add protected preview-validate route
- add shared fixed-field validation helper
- reuse DB structured validator in preview validation
- add migration, service, preview, renderer, compatibility, and no-side-effect tests

## Scope boundaries

This feature does not include:

- multi-column layout
- sections, groups, tabs, pages, or regions
- arbitrary page-builder controls
- conditional field visibility
- nested or repeating layout structures
- real file upload in preview
- public submit redesign
- consent snapshot redesign
- receipt or email redesign
- invite/auth workflow redesign

## Concise implementation prompt

Implement Feature 046 by extending the live Feature 039 and 042 template system with additive one-column layout metadata on `consent_templates`, not by redesigning the consent architecture. Add nullable `form_layout_definition jsonb` to template rows, validate it against the current structured definition, keep draft rows editable and published rows immutable, return effective derived layout for legacy rows with null metadata, and update template create, read, update, version, and publish flows to carry layout metadata. Extract a shared consent-form block renderer used by both the public consent form shell and a new protected template preview shell. Keep public submit authority in the existing invite-scoped submit route and RPC, add only a protected preview-validate route for non-persistent dry-run validation, simulate face-match and headshot state in preview without real uploads, support drag/drop reordering of a single one-column block list using a small sortable library, and cover layout validation, compatibility, preview no-side-effect behavior, and renderer alignment with focused tests.
