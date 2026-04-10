# 046 Template Editor Live Preview and Layout Builder Research

## Scope

Research how to extend the live Feature 039 and 042 template system so the protected template editor can:

- show a live consent-form preview while a draft is being edited
- let staff interact with that preview as if it were a form
- run preview-only validation without creating a consent or mutating invite state
- support drag/drop reordering of form fields
- let template-owned layout drive the public form order instead of keeping that order hardcoded

This research is intentionally bounded:

- reuse the existing row-per-version template architecture if possible
- preserve signed-consent auditability and immutable published template rows
- keep server-side validation authoritative for real public submissions
- avoid turning this into a full arbitrary page builder

## Inputs reviewed

### Required docs

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/039-consent-form-template-editor/research.md`
- `docs/rpi/039-consent-form-template-editor/plan.md`
- `docs/rpi/042-structured-consent-template-fields/research.md`
- `docs/rpi/042-structured-consent-template-fields/plan.md`

### Migrations

- `supabase/migrations/20260407150000_039_consent_form_template_editor.sql`
- `supabase/migrations/20260407213000_042_structured_consent_template_fields.sql`
- supporting earlier invite/template/signing migrations referenced by those features

### Live template and editor code

- `src/lib/templates/template-service.ts`
- `src/lib/templates/structured-fields.ts`
- `src/app/api/templates/route.ts`
- `src/app/api/templates/[templateId]/route.ts`
- `src/app/api/templates/[templateId]/versions/route.ts`
- `src/app/api/templates/[templateId]/publish/route.ts`
- `src/app/api/templates/[templateId]/archive/route.ts`
- `src/app/(protected)/templates/page.tsx`
- `src/app/(protected)/templates/[templateId]/page.tsx`
- `src/components/templates/template-create-form.tsx`
- `src/components/templates/template-detail-client.tsx`
- `src/components/templates/template-structured-fields-editor.tsx`

### Live project, public form, and submit code

- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/components/projects/create-invite-form.tsx`
- `src/components/projects/project-default-template-form.tsx`
- `src/components/projects/consent-structured-snapshot.tsx`
- `src/app/api/projects/[projectId]/default-template/route.ts`
- `src/app/api/projects/[projectId]/invites/route.ts`
- `src/lib/idempotency/invite-idempotency.ts`
- `src/app/i/[token]/page.tsx`
- `src/components/public/public-consent-form.tsx`
- `src/components/public/public-structured-fields.tsx`
- `src/app/i/[token]/consent/route.ts`
- `src/lib/consent/submit-consent.ts`
- `src/lib/invites/public-invite-context.ts`
- `src/app/api/public/invites/[token]/headshot/route.ts`
- `src/app/api/public/invites/[token]/headshot/[assetId]/finalize/route.ts`

### Tests

- `tests/feature-039-consent-form-template-editor.test.ts`
- `tests/feature-042-structured-consent-template-fields.test.ts`

## Current schema, code paths, routes, and components involved

### Template storage and lifecycle

- `public.consent_templates`
  - row-per-version
  - app-wide rows use `tenant_id is null`
  - tenant rows use `tenant_id = <tenant>`
  - states: `draft`, `published`, `archived`
  - structured fields live in `structured_fields_definition jsonb`
- `app.enforce_consent_template_immutability()`
  - draft rows editable
  - published rows immutable except archive transition
  - archived rows immutable
- `public.create_next_tenant_consent_template_version(uuid)`
  - DB-side next-version creation, reusing an existing draft if one already exists
- `public.publish_tenant_consent_template(uuid)`
  - DB-side publish transition with structured-definition validation

### Public render and submit authority

- `public.get_public_invite(token)`
  - returns `consent_text`, `consent_version`, `structured_fields_definition`
- `public.submit_public_consent(...)`
  - authoritative invite lookup and lock
  - authoritative structured-field validation
  - subject upsert
  - consent insert
  - optional headshot linkage
  - revoke token creation
  - invite `used_count` update
  - consent event insert

### Protected editor and project UI

- `/templates`
  - list tenant-manageable templates
  - show app templates read-only
  - create new tenant draft
- `/templates/[templateId]`
  - edit draft metadata, body, and structured fields
  - publish, archive, and create new version actions
- project page
  - chooses published templates for invite creation
  - sets a project default template
  - shows signed structured snapshot data on consent details

## Verified current behavior

## 1. Current live boundary of Features 039 and 042

### Feature 039 is live

What is live today:

- protected template list page exists
- protected template detail/editor page exists
- tenant `owner` and `admin` can create tenant drafts
- tenant `owner` and `admin` can edit drafts
- tenant `owner` and `admin` can create a new draft version from an existing family
- tenant `owner` and `admin` can publish a draft
- tenant `owner` and `admin` can archive a published version
- projects can store a specific published default template row
- invite creation requires a published template or a valid project default

### Feature 042 is live

What is live today:

- `structured_fields_definition` is stored directly on `consent_templates`
- built-in fields are `scope` and `duration`
- custom fields support `single_select`, `checkbox_list`, and `text_input`
- public invites render structured fields from the invite-linked published template version
- public submit validates structured values server-side and stores `structured_fields_snapshot`
- protected consent details render signed structured values from the snapshot

### What the current protected editor can edit

Draft-only editable today:

- template `name`
- template `category`
- template `description`
- template `body`
- `scope` option labels and order
- custom field list
- custom field labels
- custom field keys
- custom field types
- custom field required flags
- custom field help text
- custom text placeholders and max lengths
- custom select and checkbox options
- custom field order among custom fields only

Not editable today:

- any live preview
- any public-form layout metadata
- any system-field order
- `duration` options or order
- built-in placement relative to custom fields
- name/email placement
- face-match placement
- headshot placement
- consent text placement

### Publish flow today

- draft save uses `PATCH /api/templates/[templateId]`
- publish uses `POST /api/templates/[templateId]/publish`
- publish validates the structured definition for publish
- published rows are immutable
- later edits must create a new draft version row

### Preview today

There is no preview in the protected template editor.

There is also no shared "render form from template" abstraction for the whole public form. The only reusable field renderer already present is `PublicStructuredFieldsSection`, which renders structured fields only.

## 2. Current public consent form structure

### Exact live public form order

`src/components/public/public-consent-form.tsx` renders a single-column form in this order:

1. full name input
2. email input
3. structured fields section, if `structured_fields_definition` is present
   - `scope`
   - `duration`
   - custom fields in array order
4. face-match opt-in checkbox
5. headshot upload section, only when face match is checked
6. consent text block
7. submit button

### Which fields are fixed system fields today

Currently fixed in code:

- subject name
- subject email
- face-match opt-in
- headshot upload UI
- consent text block
- submit button placement

### Which fields come from `structured_fields_definition`

Currently template-driven through `structured_fields_definition`:

- built-in `scope`
- built-in `duration`
- all custom structured fields

### What is template-driven versus hardcoded today

Template-driven today:

- consent body text
- consent version label
- structured field definitions
- custom-field order within the structured section

Still hardcoded today:

- subject name field existence
- subject email field existence
- subject name and email order
- face-match and headshot section existence and placement
- consent text placement
- overall one-column section ordering

### Platform-required versus hardcoded

Platform-required in the current implementation:

- name is effectively required because the public route rejects short names and the RPC upserts `subjects.full_name`
- email is effectively required because the route rejects missing or invalid email and the RPC upserts subjects by email
- consent text display is effectively required because signing fails if the invite-linked template body or version is missing

Hardcoded but plausibly migratable to template-owned placement:

- subject name block placement
- subject email block placement
- face-match section placement
- consent text block placement

Platform-owned semantics that should likely stay server-controlled even if placement becomes template-controlled:

- requiredness of name and email
- invite-token authority
- biometric linkage and headshot rules
- real submit side effects

## 3. System-owned versus template-owned fields

### Current boundary

| Area | Current owner |
| --- | --- |
| Consent body text and version | Template row |
| Structured built-ins and custom fields | Template row |
| Subject name and email fields | System-owned and hardcoded |
| Face-match and headshot section | System-owned and hardcoded |
| Public form order/layout | Hardcoded in React |
| Real submission authority | Server RPC |

### What would be required to make fixed fields layout-managed

Name and email can become reorderable without becoming arbitrary custom fields if they are modeled as reserved system layout blocks.

Face-match and headshot can become layout-managed more safely as a single reserved block, because their semantics are coupled:

- checking face match changes validation rules
- headshot upload hits real asset APIs
- public submit links the headshot to the consent

Consent text can become a reserved layout block because its content is already template-owned. Only its placement is hardcoded.

### Recommended ownership split

- Keep semantic rules server-owned.
- Make placement template-owned.
- Do not turn name, email, face-match, or consent text into freeform custom fields.
- Use reserved layout block keys for those system-managed form blocks.

## 4. Current template definition model versus layout model

### What `structured_fields_definition` can do today

- store built-in `scope`
- store built-in `duration`
- store custom fields
- store option order within a field
- store custom-field array order

### What it cannot do today

- move `scope` below `duration`
- move custom fields above built-ins
- move name above or below email
- move name/email relative to structured fields
- move face-match or consent text
- model sections, groups, columns, or regions

### Current ordering rules

- built-ins are always returned by `getStructuredFieldsInOrder()` as `scope`, then `duration`
- custom fields always come after built-ins
- custom fields are ordered by array order and normalized `orderIndex`
- the editor only exposes move up and move down for custom fields

### Conclusion

The current `structured_fields_definition` model is a field-definition model, not a full form-layout model.

It is not enough on its own to support template-owned ordering of:

- name
- email
- face-match/headshot
- consent text
- built-ins relative to custom fields

## 5. Current protected editor fit for drag/drop

### What the current UI structure supports cleanly

- there is already a dedicated `TemplateStructuredFieldsEditor`
- draft state already lives in client state inside `TemplateDetailClient`
- custom fields are already array-based and normalized by array order
- editor actions already mutate local state and then persist the whole draft

### What is missing

- no drag/drop library is installed
- no combined list of all renderable form blocks exists
- built-ins and fixed public fields are not represented in one normalized editor list
- no preview pane exists

### Bounded implementation fit

The current editor is componentized enough to add a reorderable one-column list, but it needs a new state model for "all rendered blocks", not just custom structured fields.

No dependency in `package.json` suggests an existing sortable solution. Plan phase will need to choose between:

- adding a small drag/drop library, likely the cleanest path
- or implementing native drag handling, which is feasible but usually rougher for keyboard support and list-state ergonomics

## 6. Interactive preview reuse potential

### What can be reused today

- `PublicStructuredFieldsSection` is already a pure renderer for structured fields
- `getStructuredFieldsInOrder()` can still drive structured field ordering inside a shared renderer
- `ConsentStructuredSnapshot` proves that signed values can already render from a stable snapshot

### What cannot be reused directly today

`PublicConsentForm` is tightly coupled to the real public flow:

- it posts directly to `/i/[token]/consent`
- it owns real headshot upload calls
- it owns real submit behavior
- it uses local state that is not injected from outside
- it does not support preview mode or field-level error props
- it assumes the current hardcoded public order

### Recommended reuse direction

Do not duplicate the public form logic by building a second, editor-only form renderer.

Instead:

1. extract a shared "consent form block renderer" that can render:
   - reserved system blocks
   - built-ins
   - custom structured fields
   - consent text
2. keep separate shells for:
   - real public submit mode
   - protected preview mode
3. let the public shell own invite-token actions and real side effects
4. let the preview shell own local values, errors, and preview-only validate action

This is partial reuse, not direct reuse of the existing `PublicConsentForm` component as-is.

## 7. Validation reuse potential

### Current validation split

Client-side today:

- browser-required and basic HTML constraints for name, email, select, and text
- one local JS check that face-match cannot submit without a headshot asset id

Route-level today:

- trims and normalizes name and email
- rejects obviously invalid name and email
- parses `structured__*` fields into a payload map
- maps failures to global redirect states

DB/RPC authoritative today:

- validates invite availability
- validates headshot and biometric rules
- validates structured values against the invite-linked template definition
- writes the consent and related side effects atomically

### Important current limitation

The public form does not currently show rich inline field-error UI after a submit attempt.

Today the live public experience is mostly:

- native browser validation before submit
- or a redirected page-level error state after submit

That means there is not yet a reusable visual error system that the preview can simply adopt.

### Reuse opportunity already present

`app.validate_submitted_structured_field_values(p_definition jsonb, p_values jsonb)` already validates structured submit values against an arbitrary definition JSON. It is not tied to an invite row.

That makes it a good candidate for preview-side dry-run validation of structured fields.

### Validation options considered

#### Option A: client-only mirror

Pros:

- fast
- no extra route

Cons:

- high drift risk because current authoritative structured rules live in SQL
- still needs separate logic for name/email and biometric rules
- not trustworthy enough to claim "same validation"

#### Option B: server-backed dry-run only

Pros:

- strongest parity with real validation
- can reuse current DB validators for structured fields

Cons:

- every preview confirm becomes a network round trip
- still needs local state for immediate interaction

#### Option C: mixed model

Pros:

- local state for input interaction and basic instant clearing of errors
- protected preview-validate endpoint for preview confirm
- strongest bounded fit for "same rules" without side effects

Cons:

- still requires a small shared server validator for fixed system fields not covered by the SQL structured validator

### Recommended validation direction

Use Option C.

- Keep real public submit authority server-side in `submit_public_consent`.
- Add a protected, non-persistent preview-validate path.
- Reuse DB structured-field validators for structured values.
- Add a small shared server validator for fixed fields such as:
  - name requiredness
  - email shape
  - face-match requires mock headshot state, if preview supports that block interactively

## 8. Preview submit or confirm behavior

### What it should not do

Preview confirm should never call the real submit RPC.

The real submit path would create side effects:

- subject upsert
- consent row creation
- revoke token creation
- invite usage increment
- consent event insert
- optional headshot linkage
- receipt attempts

The headshot upload routes also create real assets and are not appropriate for preview mode.

### Bounded recommended behavior

Preview confirm should:

- validate the current draft definition plus current preview values
- highlight missing and invalid fields inside the preview
- return success only as "this preview is valid"
- not persist anything
- not create any real assets
- not call real submit code

This is a validate-only preview, not a simulated consent write.

## 9. Layout reordering scope

### Smallest useful interpretation of "layout"

Recommend v1 layout means:

- one column only
- vertical block ordering only
- drag/drop reorder of blocks in that single list
- no sections
- no columns
- no arbitrary containers
- no visual style builder

### Why one-column ordering is enough for now

It satisfies the requested UX:

- move email above name
- move built-ins relative to custom fields
- update the preview immediately

without forcing a larger schema or renderer redesign.

### Recommended reorderable block set

Recommended v1 blocks:

- `subject_name`
- `subject_email`
- `scope`
- `duration`
- each custom structured field by `fieldKey`
- `face_match_section`
- `consent_text`

Recommended fixed outside the layout list:

- page heading/project info
- final preview-only submit button in the editor preview shell
- final real submit button in the public shell

## 10. Built-ins and fixed fields under a layout model

### Built-ins today

`scope` and `duration` are structurally special today:

- reserved keys
- fixed built-in order
- `duration` has canonical fixed options
- public render helper always places them first

### Can they be visually repositioned later

Yes.

Their semantic rules do not require them to remain visually first. The current position is an implementation choice, not a hard domain requirement.

### Fixed public fields

Current fixed public fields can be modeled in layout metadata without turning them into arbitrary custom fields:

- `subject_name` remains required and server-owned
- `subject_email` remains required and server-owned
- `face_match_section` remains platform-owned but movable as one block
- `consent_text` remains required content but movable as one block

### What should probably remain coupled

`face_match` and `headshot` should likely remain one layout block in v1, not two independent blocks, because the headshot rules are coupled to the biometric toggle and real upload flow.

## 11. Draft-only editor implications

The current live lifecycle already supports the correct draft-only boundary.

Recommended behavior:

- layout changes are editable only on drafts
- layout metadata versions with the template row
- publish freezes the layout with the same immutable version row
- existing invites keep rendering the version row they already reference
- published templates remain immutable

No new lifecycle model is needed for this feature.

## 12. Preview state and editor state interaction

### Recommended state split

Keep two separate state domains in the editor:

- draft definition state
  - body
  - structured fields
  - layout metadata
- preview interaction state
  - current input values
  - touched fields
  - current validation errors

### Why they should be separate

Preview values are not template-definition data. They are temporary interaction state.

If they live inside draft state, every keystroke in the preview would contaminate template editing concerns.

### Recommended behavior on edits

- reorder actions should update draft layout state immediately
- preview should re-render from the updated layout immediately
- preview values should be keyed by stable field or block key, not by list index
- reorder should preserve preview values and errors
- deleting a field should remove its preview value and error state
- changing a field key or type should drop incompatible preview state for that field

## 13. Security and trust boundary

The trust boundary should remain unchanged:

- real public submission authority stays server-side
- invite token remains the public authority boundary
- tenant ownership and template-draft edit permissions stay enforced server-side
- preview is only a protected-editor convenience path
- preview validation must not be treated as public-submit authority

Client-side preview behavior is UX only.

Real submission still must validate against the invite-linked published template version on the server.

## 14. Compatibility and migration

### Can this be done with no schema change

Only partially.

Without schema change, the editor could add a live preview of the current hardcoded public order, but it could not persist template-owned ordering of:

- name
- email
- built-ins relative to custom fields
- face-match section
- consent text

That does not satisfy the requested product direction.

### Can this be done with an additive schema change

Yes. This is the recommended path.

Smallest compatible additive model:

- keep `structured_fields_definition` for field semantics
- add nullable layout metadata on `consent_templates`, for example `form_layout_definition jsonb`

### Does this require a larger redesign

No.

The current version-row template model, invite linkage, and immutable publish flow are already strong enough. The gap is layout metadata and shared rendering, not a fundamental data-model rewrite.

### Legacy-template compatibility

Existing templates can be supported safely by deriving a default layout when layout metadata is null:

1. `subject_name`
2. `subject_email`
3. structured fields in current live order
4. `face_match_section`
5. `consent_text`

If a template has no structured fields, the structured portion simply collapses out.

## 15. Options considered

## Option A: preview only, no persisted layout model

Pros:

- smallest UI-only change

Cons:

- does not let templates own public form order
- cannot support drag/drop as a real template capability
- leaves name/email and other fixed blocks permanently hardcoded

Assessment:

- too small for the requested feature

## Option B: overload `structured_fields_definition` to also store full layout

Possible direction:

- inject reserved pseudo-fields for system blocks
- use a single top-level order list inside `structured_fields_definition`

Pros:

- one template JSON document
- fewer columns

Cons:

- mixes field semantics with page layout
- forces system blocks like name and consent text into a field-definition structure that was designed for structured consent values
- muddies validation responsibilities
- makes built-ins and fixed blocks harder to reason about

Assessment:

- workable, but not clean

## Option C: separate layout metadata that references system blocks and structured fields

Possible direction:

- add `form_layout_definition jsonb` to `consent_templates`
- keep `structured_fields_definition` focused on field semantics
- layout references reserved system block keys plus structured field keys

Pros:

- clean separation of semantics and presentation
- additive to the existing version-row model
- lets name/email and consent text become reorderable without redefining them as arbitrary fields
- easiest way to give the template ownership of public block order

Cons:

- one extra JSON document to version and validate
- renderer must join layout items to definition items

Assessment:

- best bounded fit

## Recommended bounded direction

### Recommendation summary

Use Option C.

Keep the current Feature 039 and 042 backbone and add a small, explicit layout layer.

### Recommended data model direction

Add nullable layout metadata to `consent_templates`, for example:

```json
{
  "schemaVersion": 1,
  "blocks": [
    { "kind": "system", "key": "subject_name" },
    { "kind": "system", "key": "subject_email" },
    { "kind": "built_in", "key": "scope" },
    { "kind": "custom_field", "fieldKey": "audience" },
    { "kind": "built_in", "key": "duration" },
    { "kind": "system", "key": "face_match_section" },
    { "kind": "system", "key": "consent_text" }
  ]
}
```

Recommended rules:

- one-column order only
- each block appears at most once
- custom-field blocks must reference an existing custom field key
- built-in keys are reserved
- system block keys are reserved

### Recommended renderer direction

Extract a shared renderer that can take:

- template body
- structured field definition
- layout definition
- current values
- current errors
- mode flags such as `public` or `preview`

Then:

- the public shell keeps real POST and headshot behavior
- the protected preview shell keeps local values and preview-only validation

### Recommended preview validation direction

Add a protected dry-run preview validation path that:

- validates layout-definition integrity
- validates current structured definition for preview rendering
- validates preview values without persistence
- reuses DB structured submit validators where practical
- never calls `submit_public_consent`

### Recommended editor UX direction

- editor remains draft-first
- left side edits template definition and layout
- right side renders live preview
- drag/drop reorder mutates the draft layout immediately
- preview values persist across reorder by stable key
- preview confirm highlights missing and invalid fields without saving

## Risks and tradeoffs

- extracting a shared renderer is more work than adding a quick one-off preview, but it reduces long-term drift between preview and public render
- preview cannot safely reuse the real headshot upload flow, so that part of the form likely needs either a simulated state or a bounded exception in v1
- adding layout metadata creates another JSON document that needs validation and defaulting
- current public form does not yet have shared inline error UI, so preview and public form may need a new common field-error presentation layer
- keeping layout separate from signed consent snapshots is acceptable because template version rows are immutable, but exact historical render reconstruction would still depend on the version row remaining readable

## Edge cases for the plan phase

- legacy templates with no structured fields
- draft templates with invalid or incomplete structured definitions
- templates with null layout metadata that need default ordering
- required fields missing in preview
- built-ins reordered relative to custom fields
- deleting a field that currently has preview value state
- reorder while validation errors are visible
- many custom fields in a single-column list
- templates with no custom fields
- templates where `face_match_section` remains present but preview does not support real upload

## Explicit open decisions for the plan phase

1. Should the new layout metadata live in a separate column such as `form_layout_definition`, or as a new top-level sibling inside the existing template JSON contract?

2. Should v1 include `face_match_section` as a movable preview block now, or keep it fixed while still moving name, email, built-ins, custom fields, and consent text?

3. Should preview reuse the public renderer through one extracted shared component tree, or through a slightly thinner shared lower-level block renderer?

4. Should preview validation be:
   - client-only
   - protected server dry-run
   - or mixed local state plus protected dry-run

5. How much of fixed-field validation should be centralized into a shared server helper so preview and public submit do not drift?

6. Should preview support a simulated headshot state for face-match validation, or intentionally leave file-upload behavior out of preview v1?

7. Should inline field-level validation UI be added to the public form as part of the same feature so preview and public warnings match visually, or should preview get the new error presentation first and public submit catch up in the same refactor?

8. Should `consent_text` remain a required movable block, or stay visually fixed near the submit button even after other fields become layout-managed?

9. Should the final submit button itself stay outside layout metadata in v1? Recommended: yes.

10. Which drag/drop approach fits the repo best:
    - a small added library
    - or native drag handling

## Plan-phase starting point

The cleanest bounded starting point for planning is:

- keep the current row-per-version template model
- keep `structured_fields_definition` focused on field semantics and validation
- add a nullable one-column layout metadata layer on `consent_templates`
- default existing templates to the current hardcoded public order
- extract a shared consent-form renderer instead of duplicating public-form markup
- add a protected preview-only validate path
- keep all real submit authority and side effects in the existing server-side public submit flow

That path satisfies the requested live preview and layout goals with an additive extension, not a consent-system redesign.
