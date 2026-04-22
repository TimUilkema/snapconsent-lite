# Feature 067 Research - Consent scope state, mixed-version scope semantics, and ad-hoc consent upgrade requests

## 1. Inputs reviewed

Required inputs, in order:

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- `docs/rpi/PROMPTS.md`
- `docs/rpi/SUMMARY.md`

Relevant prior RPI docs reviewed as context only:

- `docs/rpi/003-consent-templates/research.md`
- `docs/rpi/039-consent-form-template-editor/research.md`
- `docs/rpi/042-structured-consent-template-fields/research.md`
- `docs/rpi/043-simple-project-export-zip/research.md`
- `docs/rpi/044-asset-preview-linking-ux-improvements/research.md`
- `docs/rpi/045-asset-preview-unlinked-faces-and-hidden-face-suppression/research.md`
- `docs/rpi/046-template-editor-live-preview-and-layout-builder/research.md`
- `docs/rpi/047-manual-face-box-creation-in-asset-preview/research.md`
- `docs/rpi/049-recurring-profiles-and-consent-management-foundations/research.md`
- `docs/rpi/051-baseline-recurring-consent-request-foundation/research.md`
- `docs/rpi/052-baseline-request-management/research.md`
- `docs/rpi/054-baseline-follow-up-actions/research.md`
- `docs/rpi/055-project-participants-and-mixed-consent-intake/research.md`
- `docs/rpi/002-projects-invites/research.md`

Live code, schema, and tests reviewed as source of truth:

- `supabase/migrations/20260304210000_002_projects_invites_schema.sql`
- `supabase/migrations/20260407150000_039_consent_form_template_editor.sql`
- `supabase/migrations/20260407213000_042_structured_consent_template_fields.sql`
- `supabase/migrations/20260410210000_template_duration_options_and_public_invite_name.sql`
- `supabase/migrations/20260414193000_051_baseline_recurring_consent_request_foundation.sql`
- `supabase/migrations/20260415110000_055_project_participants_mixed_consent_foundation.sql`
- `supabase/migrations/20260415133000_055_project_participants_public_project_context.sql`
- `supabase/migrations/20260415210000_058_project_face_assignee_bridge.sql`
- `supabase/migrations/20260421110000_061_asset_assignee_links.sql`
- `src/lib/templates/structured-fields.ts`
- `src/lib/templates/template-service.ts`
- `src/components/consent/consent-form-layout-renderer.tsx`
- `src/components/public/public-consent-form.tsx`
- `src/components/public/public-recurring-consent-form.tsx`
- `src/lib/consent/submit-consent.ts`
- `src/lib/consent/revoke-consent.ts`
- `src/lib/idempotency/invite-idempotency.ts`
- `src/lib/invites/public-invite-context.ts`
- `src/lib/recurring-consent/public-recurring-consent.ts`
- `src/lib/recurring-consent/revoke-recurring-profile-consent.ts`
- `src/lib/projects/project-participants-service.ts`
- `src/components/projects/project-participants-panel.tsx`
- `src/app/(protected)/projects/[projectId]/page.tsx`
- `src/app/api/projects/[projectId]/assets/route.ts`
- `src/lib/matching/asset-preview-linking.ts`
- `src/lib/matching/project-face-assignees.ts`
- `src/lib/matching/photo-face-linking.ts`
- `src/lib/project-export/project-export.ts`
- `tests/feature-042-structured-consent-template-fields.test.ts`
- `tests/feature-043-simple-project-export-zip.test.ts`
- `tests/feature-051-baseline-recurring-consent-request-foundation.test.ts`
- `tests/feature-055-project-participants-foundation.test.ts`
- `tests/feature-058-project-local-assignee-bridge.test.ts`

## 2. Verified current behavior

### Consent templates and versions

- `consent_templates` is already a version-row model, not a separate "template family + version table" split.
- A template family is identified by `template_key`.
- Each concrete version row has its own `id`, `version`, `version_number`, `status`, `body`, `structured_fields_definition`, and `form_layout_definition`.
- Published rows are immutable. New versions are created as new rows in the same family.
- Existing invites and requests remain tied to the exact published row they were created against, even if that version is later archived.

### Structured field model

- Structured fields are defined in `StructuredFieldsDefinition`.
- Built-in fields are bounded to:
  - `scope`: required `checkbox_list`
  - `duration`: required `single_select`
- Both scope and duration options use stable machine keys: `optionKey`.
- Labels are presentation data, not the stable identifier.
- Current live code no longer hard-codes duration to the original three defaults at the DB boundary. Duration options are template-defined and versioned just like scope options.

### What is stored on signed consent today

For one-off project consent (`consents`):

- Immutable signing row stores `tenant_id`, `project_id`, `subject_id`, `invite_id`, `consent_template_id`, `consent_text`, `consent_version`, `face_match_opt_in`, `signed_at`, revoke fields, and `structured_fields_snapshot`.
- The signed row does **not** store an immutable snapshot of subject name/email. Those still live on `subjects`, which is unique by `(tenant_id, project_id, email)` and can update `full_name` on later submissions for the same email within the same project.
- `structured_fields_snapshot` is the important signed audit snapshot for this feature. It preserves:
  - `templateSnapshot` with template id/key/name/version/versionNumber
  - the exact field `definition`
  - normalized submitted `values`

For recurring consent (`recurring_profile_consents`):

- The same core audit pattern exists.
- Recurring rows additionally snapshot `profile_name_snapshot` and `profile_email_snapshot`.
- `structured_fields_snapshot` is required and stored on the signed row.
- Project-specific recurring consents are distinguished by `consent_kind = 'project'` plus `project_id`.

### Current live representation of scope values

- Selected scopes currently live in `structured_fields_snapshot.values.scope.selectedOptionKeys`.
- The exact scope universe that was shown at signing time lives in `structured_fields_snapshot.definition.builtInFields.scope.options`.
- There is no normalized per-scope table today for one-off consent.
- There is no normalized per-scope table today for recurring consent.
- There is no denormalized scope state on assets, assignees, exports, or preview rows today.
- Because the signed snapshot includes the exact definition, "newer scope absent from an older signed version" is already representable as "not collected / not requested in that version", not forced to `false`.

### Submission, retries, and immutability

- One-off public submit uses `submit_public_consent`.
- Duplicate submit on the same invite returns the first consent row and does not mutate the original snapshot.
- One-off consent is unique per invite (`consents.invite_id` is unique).
- One-off `subjects` are unique per `(tenant_id, project_id, email)`.
- Recurring public submit follows the same immutable-write and duplicate-return pattern through `submit_public_recurring_profile_consent`.
- Tests verify that optional structured fields are stored explicitly as `null` or empty arrays in the snapshot, so the snapshot already distinguishes "blank field in this version" from "field absent from this version".

### Current preview, grid, and export surfaces

- Asset preview already composes consent-facing owner data through `project_face_assignees`.
- That bridge supports both:
  - `project_consent` for one-off consents
  - `project_recurring_consent` for project-specific recurring consents
- `asset-preview-linking.ts` already has a reusable summarizer that flattens `structured_fields_snapshot` into display strings for one-off preview output.
- One-off preview summaries include structured snapshot text, but not machine-readable scope status.
- Recurring project assignee preview summaries do not currently include structured snapshot summary or scope state.
- The project asset API currently supports review filters, search, and a one-off-person filter keyed by `consentId`. It does not support scope filtering.
- Export already includes:
  - one-off consent JSON with `structuredFieldsSnapshot`
  - per-asset `linkedConsents` for one-off links
  - per-asset `linkedAssignees` for both one-off and recurring project assignees
- Export does not currently emit scope-level operational metadata.
- Export does not currently emit recurring project consent forms as first-class consent JSON; recurring project consent only appears through assignee metadata.

### Current revocation model

- One-off revocation is whole-consent only: `revoked_at`, `revoke_reason`, `consent_events`.
- Recurring revocation is also whole-consent only: `revoked_at`, `revoke_reason`, `recurring_profile_consent_events`.
- Current active-vs-revoked derivation is row-level, not per scope.
- There is no current concept of per-scope revocation state.

### Mixed-version behavior that already exists

- Mixed template versions are already first-class because invites/requests point at concrete template version rows and signed consents snapshot the exact definition used.
- Projects can therefore already contain:
  - multiple one-off consents signed from different template versions
  - multiple recurring project consents from different template versions across participants
- The live model does not currently corrupt missing newer scopes into `false`. The missing scope simply does not exist in the older signed definition snapshot.

## 3. Current schema, routes, helpers, and components involved

### Schema and migrations

- `20260304210000_002_projects_invites_schema.sql`
  - one-off consent base model: `subject_invites`, `subjects`, `consents`, `revoke_tokens`, `consent_events`
  - `subjects` unique by `(tenant_id, project_id, email)`
  - `consents` unique by `invite_id`
- `20260407150000_039_consent_form_template_editor.sql`
  - version-row lifecycle for `consent_templates`
  - publish/archive state and immutability enforcement
- `20260407213000_042_structured_consent_template_fields.sql`
  - `structured_fields_definition` on templates
  - `structured_fields_snapshot` on one-off consents
  - signed snapshot validation and normalization in `submit_public_consent`
- `20260410210000_template_duration_options_and_public_invite_name.sql`
  - template-defined duration options
- `20260414193000_051_baseline_recurring_consent_request_foundation.sql`
  - recurring request / signed consent / revoke token / events model
  - `structured_fields_snapshot` on recurring consents
- `20260415110000_055_project_participants_mixed_consent_foundation.sql`
  - `project_profile_participants`
  - recurring `consent_kind` split into `baseline` vs `project`
  - uniqueness scoped per project for project consent
- `20260415133000_055_project_participants_public_project_context.sql`
  - recurring public submit stores `project_id` and `consent_kind`
- `20260415210000_058_project_face_assignee_bridge.sql`
  - `project_face_assignees`
  - bridge from one-off and recurring project consent into a common project owner identity
- `20260421110000_061_asset_assignee_links.sql`
  - whole-asset links also move to assignee-based linking

### Template and structured field helpers

- `src/lib/templates/structured-fields.ts`
  - field definition types
  - stable `fieldKey` and `optionKey` semantics
  - snapshot shape used as signed audit payload
- `src/lib/templates/template-service.ts`
  - draft update, publish, archive, create-next-version behavior

### Public signing and revoke flows

- One-off:
  - `src/components/public/public-consent-form.tsx`
  - `src/lib/consent/submit-consent.ts`
  - `src/lib/consent/revoke-consent.ts`
  - `src/lib/idempotency/invite-idempotency.ts`
  - `src/lib/invites/public-invite-context.ts`
- Recurring:
  - `src/components/public/public-recurring-consent-form.tsx`
  - `src/lib/recurring-consent/public-recurring-consent.ts`
  - `src/lib/recurring-consent/revoke-recurring-profile-consent.ts`

### Project and asset surfaces

- `src/lib/projects/project-participants-service.ts`
  - current project recurring consent state derivation
  - project consent request creation
- `src/components/projects/project-participants-panel.tsx`
  - project participant UI showing missing/pending/signed/revoked project consent
- `src/app/(protected)/projects/[projectId]/page.tsx`
  - mixed one-off and recurring participant surfaces in the live project page
- `src/app/api/projects/[projectId]/assets/route.ts`
  - current project asset grid filter/read API
- `src/lib/matching/asset-preview-linking.ts`
  - asset preview owner composition
  - current signed structured snapshot summarization seam
- `src/lib/matching/project-face-assignees.ts`
  - common assignee identity for one-off and recurring project consent
- `src/lib/matching/photo-face-linking.ts`
  - current owner-state checks for linking behavior
- `src/lib/project-export/project-export.ts`
  - current export loading and shaping seam

### Components already rendering signed structured values

- `src/components/consent/consent-form-layout-renderer.tsx`
- `src/components/projects/consent-structured-snapshot.tsx`

### Tests that verify the live behavior

- `tests/feature-042-structured-consent-template-fields.test.ts`
  - immutable structured snapshot storage
  - duplicate submit behavior
  - archived-version invite behavior
- `tests/feature-043-simple-project-export-zip.test.ts`
  - export shape and current metadata boundaries
- `tests/feature-051-baseline-recurring-consent-request-foundation.test.ts`
  - recurring immutable sign/revoke flow
- `tests/feature-055-project-participants-foundation.test.ts`
  - project recurring consent context and uniqueness
- `tests/feature-058-project-local-assignee-bridge.test.ts`
  - assignee bridge, preview, export, recurring project owner state

## 4. Current constraints and invariants

- Tenant scoping is strict across all project, invite, consent, participant, preview, and export queries.
- Signed consent history is immutable and auditable through immutable rows plus event logs.
- Revocation does not delete signed history.
- Server-side validation and business logic are authoritative. Public tokens are resolved server-side and stored hashed.
- Template versions are auditable snapshots. Published versions are immutable.
- Mixed-version projects are already part of the live architecture and must be treated as normal.
- Current asset-facing owner identity is already mediated through `project_face_assignees`. That is the existing boundary between consent records and asset operations.
- One-off project consent and recurring project consent are distinct source models that converge only at the assignee layer.
- "Scope not present in the signed template version" is currently representable and should not be collapsed into `false` by default.
- Baseline recurring consent is not the same thing as project media-use consent. For asset eligibility inside a project, the relevant recurring source is `recurring_profile_consents` where `consent_kind = 'project'`.
- Retries are already part of the live system:
  - one-off invite creation is idempotent
  - recurring request creation is idempotent
  - duplicate public sign returns the first immutable row
  - revoke is idempotent

## 5. Current gaps relative to the requested feature

- There is no queryable per-scope truth layer today. Scope lives only inside signed JSON snapshots.
- Asset preview can show a flattened string summary of one-off structured values, but not a stable machine-readable scope-by-scope state.
- Asset preview does not currently expose structured scope state for recurring project consent owners.
- The project asset API cannot filter by scope such as `social-media`.
- Export cannot yet emit scope-level consent status for DAM/integration use.
- There is no live representation of `not_collected / not_requested in signed version` as an operational status, even though the signed snapshot already contains enough information to derive it.
- There is no live representation of future per-scope revocation.
- There are no precedence rules for "current effective scope state" when multiple immutable signed rows later exist for the same owner boundary.
- There is no ad-hoc upgrade-request workflow yet.
- One-off people filtering is still consent-row centric, while preview and asset linking have already moved to a broader assignee identity model.

### Addendum: one-off upgrade-path modeling and current one-off identity assumptions

The current one-off architecture can support "request updated consent" at the signing-transport level by issuing a **new standard invite** tied to a newer published template version:

- `subject_invites` already points at an exact `consent_template_id`
- `consents` is unique per invite, so a new invite naturally creates a new immutable signing event
- `submit_public_consent` already snapshots the exact template version and structured fields shown at signing time

So the current one-off architecture does support the **mechanics** of "please sign the newer form" without redesigning the public flow.

However, the current one-off architecture does **not** cleanly provide a first-class upgrade workflow by itself:

- `subject_invites` is an invite transport object, not a subject-centric request lifecycle object
- it does not explicitly reference:
  - the prior consent being superseded
  - the subject-level owner being updated
  - the target template family/version as an upgrade from an earlier signed version
  - request lifecycle semantics such as superseded/completed-as-upgrade

Current live one-off identity assumptions are still heavily consent-row-centric:

- the project page loads one-off signers through `subject_invites` with nested `consents`
- the consent detail UI opens by `openConsentId`
- the asset grid people filter is built from `consents` and filtered by repeated `consentId` query params
- one-off headshot, review-session, matchable-assets, and manual-link APIs are still rooted under `/projects/[projectId]/consents/[consentId]/...`
- one-off assignment routes still accept `identityKind = "project_consent"` plus `consentId`
- even after the assignee bridge was introduced, the one-off assignee row is still uniquely keyed by `consent_id`

Research conclusion for one-off upgrade-path modeling:

- A **new invite to a newer template version** is sufficient as the signing transport.
- If the future feature needs explicit "upgrade request" lifecycle tracking, a **thin distinct upgrade-request concept** would be architecturally cleaner than treating a raw invite as the whole workflow.
- That distinct concept can stay additive:
  - it can reference the one-off owner identity and prior consent
  - it can generate or point to a standard `subject_invites` token for actual signing
  - it does not require changing the public submit path

## 6. Options considered

### Option A - Keep one consent row per signing event and query the structured snapshot directly

Use `structured_fields_snapshot` as the only source for scope truth and derive all preview/filter/export state on demand from JSON.

### Option B - Keep one consent row per signing event and add immutable normalized per-scope rows

At sign time, write immutable per-scope rows alongside the signed consent row for each scope option that existed in that signed template definition. Store the stable option key, label snapshot, and whether the scope was selected.

### Option C - Keep one consent row per signing event and add only a derived/materialized operational scope-state layer

Leave signed rows unchanged and build a read model from snapshots for filtering, preview, and export. This could be a view, materialized view, or ordinary table maintained by server-side code/jobs.

### Option D - Hybrid additive model: immutable per-scope snapshot rows plus a derived effective-state layer

Persist immutable per-scope rows derived from the signed snapshot, then derive operational "effective scope state" from those rows plus whole-consent revocation and future per-scope revocation overlays.

### Option E - Redesign primary truth to one row per consent x scope

Move the primary storage model away from one signed consent event row and make scope rows the main source of truth.

## 7. Tradeoffs by option

| Option | Auditability | Mixed-version safety | Filtering / preview / export | Future per-scope revoke | Migration complexity | Risk to invariants |
| --- | --- | --- | --- | --- | --- | --- |
| A. Snapshot only | High for legal history, because signed snapshot remains canonical | High, because the definition snapshot already preserves version context | Low to medium. Preview is possible, but filtering and export logic become repeated JSON parsing across one-off and recurring tables | Low. Per-scope revoke would need a second layer later anyway | Low | Medium. Operational semantics stay implicit and easy to apply inconsistently |
| B. Immutable per-scope rows only | High, if rows are treated as a projection of the signed snapshot rather than a replacement | High, if rows are created only for options present in the signed definition | High for reads | Medium. Better base for future revoke, but still needs precedence and overlay rules | Medium | Medium. Safer than redesign, but still needs a derived effective model |
| C. Derived/materialized layer only | Medium to high. Canonical truth is safe, but the operational layer may be harder to audit unless rebuild rules are explicit | High, if derivation preserves absent scopes as `not_collected` | High for reads | Medium. Can add revoke overlay later | Medium | Medium. No extra immutable scope projection to inspect directly |
| D. Hybrid additive model | Highest. Canonical signed row remains primary, and immutable per-scope projection is inspectable | High. Missing newer scopes stay absent from the immutable projection and can surface as `not_collected` in the effective layer | High. Cleanest fit for preview, filter, export, and future DAM use | High. Allows later revoke overlays without mutating signed history | Medium to high | Lowest additive risk. Fits existing architecture without replacing core consent storage |
| E. Primary redesign to consent x scope rows | Medium at best unless the current signed snapshot model is duplicated anyway | Medium. Easy to accidentally flatten version semantics or over-normalize absent scopes | High for reads | High | High | High. Conflicts with current immutable versioned consent-event architecture |

Additional notes:

- Option A is the lightest change, but it pushes too much operational meaning into scattered JSON parsing.
- Option B is workable, but still leaves open how "current effective state" should be derived when there are multiple signed rows over time.
- Option C helps reads, but without an immutable per-scope projection it is harder to inspect exactly what was operationalized from a given signed event.
- Option D is the best fit for the current architecture because the live system already separates canonical signed history from operational assignee/read layers.
- Option E is not justified by the current codebase. The live schema already has a stable additive path.

## 8. Recommended bounded direction

Recommended direction:

- Keep immutable consent-event rows as canonical truth.
- Do **not** redesign primary storage to one row per scope x consent.
- Add an additive per-scope layer for operational use.

Recommended shape:

1. Preserve the current canonical signed rows:
   - `consents` for one-off project consent
   - `recurring_profile_consents` for recurring project consent

2. Add immutable signed per-scope projection rows generated from the signed snapshot at sign time:
   - one row for each scope option present in the signed template definition
   - stable key anchored to the signed `optionKey`
   - snapshot of label/order as signed-time presentation context
   - whether that scope was granted in that signing event
   - no row for scope options that did not exist in that signed version

3. Add a derived effective scope-state layer for reads:
   - keyed to the existing project owner/assignee boundary
   - able to express at least:
     - `granted`
     - `not_granted`
     - `revoked`
     - `not_collected`
   - `not_collected` must mean "this scope did not exist in the signed version that currently governs this owner boundary", not `false`

4. Use the existing `project_face_assignees` boundary as the operational join point for asset preview, asset filtering, and asset/export metadata.

5. Keep the scope model bounded to project-consent surfaces first:
   - one-off `consents`
   - recurring `recurring_profile_consents` where `consent_kind = 'project'`
   - baseline recurring consent should stay out of project media-use scope semantics unless a later requirement explicitly says otherwise

Why this is the safest bounded fit:

- The live system already captures exact signed scope truth in the immutable snapshot.
- Mixed template versions are already safe at the signed-history layer.
- Preview, filtering, and export now need operational queryability, not a rewrite of canonical history.
- Future per-scope revocation fits naturally as an overlay on top of immutable signed scope rows.
- The assignee bridge already gives the system a project-facing identity seam across one-off and recurring consent sources.

### Ad-hoc upgrade request flow

The live architecture suggests this should be modeled as a **new request to a newer template version**, not mutation of an old signed row.

For recurring project consent:

- Create a new `recurring_profile_consent_request` tied to the newer `consent_template_id`.
- Completion should create a new immutable `recurring_profile_consents` row.

For one-off project consent:

- The closest live pattern is to issue a new `subject_invites` row tied to the newer `consent_template_id`.
- Completion should create a new immutable `consents` row.
- Because one-off `subjects` are keyed by `(tenant_id, project_id, email)`, this path needs explicit precedence rules for which signed row governs current effective scope state.

Addendum refinement:

- For one-off consent, the signing transport can remain a standard invite.
- For workflow tracking, a distinct upgrade-request record would be cleaner if the product wants to show or manage:
  - pending upgrade state
  - relationship to the prior consent/version
  - retry/supersede/cancel semantics
  - future placeholder notification history
- That means the bounded path is:
  - keep `subject_invites` as the public signing token carrier
  - add a higher-level one-off upgrade-request record only if the workflow needs first-class lifecycle semantics
  - avoid mutating `subject_invites` into a broader request model

Recommended rule boundary for future plan work:

- Old signed rows remain immutable history.
- Upgrade completion creates a new immutable signing event.
- "Current effective scope state" should be derived, not backfilled into older rows.

Placeholder delivery for this cycle:

- Reuse existing request/invite creation patterns.
- Store enough request metadata to show pending status and copy/open the public path internally.
- Do not add real outbound email in this cycle.

### Effective-state identity boundary

Options considered against the live architecture:

- `consent row`
  - too narrow for upgrade flows, because each new version creates a new immutable row
- `subject-in-project`
  - good stable one-off owner boundary
- `recurring profile-in-project`
  - close, but the live project surface already has the more explicit `project_profile_participants` row
- `assignee`
  - good asset-link seam, but current assignee rows are still tied to concrete consent rows and are not stable across future re-signs
- `assignee + template family`
  - protects against family mixing, but still starts from an unstable asset-facing projection identity

Recommended boundary for effective operational scope state:

- a **project consent owner** identity, with variants:
  - one-off owner = `subjects.id` within the project
  - recurring owner = `project_profile_participants.id`
- and scope semantics grouped **within a template family** for derivation safety

Why this fits best:

- It is stable across multiple immutable signing events over time.
- It matches the two live source models:
  - one-off project subject
  - recurring project participant
- It is better than `consentId` for upgrade flows because a later version should update the same owner boundary, not create a brand-new operational person.
- It is better than `project_face_assignee_id` as the primary effective-state owner because assignees are asset-facing projections currently keyed to concrete consent rows.
- Preview, filtering, and export can still join through the current assignee seam:
  - asset links resolve to assignee
  - assignee resolves to project owner
  - project owner resolves to effective scope state

Recommendation detail:

- The effective-state owner should **not** be the consent row.
- The effective-state owner should **not** be the assignee row.
- The effective-state derivation should be keyed by a stable owner identity and should retain template-family provenance so cross-family scope-key collisions do not silently merge.

### Cross-version scope identity safety

Verified current behavior:

- `optionKey` is the live machine identifier used in:
  - template definitions
  - normalized submitted values
  - signed snapshots
  - label lookup helpers
- `create_next_tenant_consent_template_version` clones the prior version's `structured_fields_definition` into the new draft, which strongly suggests family-version continuity is expected.
- Current validation only enforces:
  - key pattern
  - key uniqueness within a single field definition
  - valid submitted values against the signed definition

Current live validation does **not** enforce:

- cross-version key stability within a template family
- prohibition on renaming an existing scope by changing its key
- prohibition on removing a key and later reintroducing it with different semantics
- any explicit retirement history for removed keys

Risk analysis:

- Rename by changing key:
  - the system will treat this as a new scope, not a renamed old scope
  - older signed rows will not map to the new key
- Removal:
  - older signed rows still preserve the retired key safely in their snapshot
  - future effective-state logic must decide whether the retired key remains visible in provenance-only output
- Reintroduction:
  - if a removed key returns later, the system will likely treat it as the same scope key, whether or not the meaning truly matches
- Semantic drift:
  - label edits are allowed and may be harmless copy changes
  - but label-only review cannot prove semantics stayed the same

Research conclusion:

- `optionKey` is already the de facto cross-version identifier for built-in scope options.
- That is safe only if template-family evolution treats the key as stable scope identity.
- Plan work should therefore enforce stronger family-level rules.

Recommended rule direction for plan work:

- within a template family, built-in scope `optionKey` should be treated as the durable scope identity
- adding new keys is allowed
- changing labels/order for an existing key is allowed
- changing the key for a continuing scope should be treated as a new scope, not a rename
- plan work should decide whether removal and later reintroduction of the same key is allowed, and if allowed, how it is audited

### Preview vs filter vs export semantics

These surfaces should not be treated as identical.

Preview:

- Preview is user-facing and should show **current effective state** for operational clarity.
- Preview should also preserve **signed provenance** for audit clarity.
- Recommended preview model:
  - current effective scope status by scope
  - provenance of which signed consent/version currently governs that effective status
  - optional signed-time snapshot summary or raw signed values where useful

Filter:

- Filtering is an operational read and should use **current effective state**, not a raw historical snapshot.
- A filter like `social-media = granted` should answer "is this owner currently eligible for this scope under the governing signed history and revocation rules?"
- Filters should not silently treat `not_collected` as `not_granted`.

Export / DAM:

- Export needs machine-readable operational metadata **and** provenance.
- Current export already carries canonical signed snapshot data for one-off consents, so additive scope metadata can sit alongside that without replacing it.
- Recommended machine-readable export output should include, at minimum:
  - current effective status per scope
  - source owner identity
  - source consent id and template version/family reference used for the effective-state derivation
  - signed-time state for the governing consent event
  - explicit `not_collected` where a requested scope did not exist on the governing signed version

Research recommendation:

- Preview: both effective state and signed provenance
- Filter: effective state only
- Export/DAM: both, with explicit provenance

### Backfill and rollout tradeoffs

Migration-time backfill:

- Pros:
  - all historical rows are populated before the feature goes live
  - no temporary mixed derived-state completeness
- Cons:
  - highest operational risk for a core-domain migration
  - hard to chunk, retry, or repair safely if the projection logic changes mid-rollout

Async backfill:

- Pros:
  - safer rollout for a core-domain additive model
  - easier to chunk by tenant/project/date and repair if issues are found
  - compatible with dual-writing new rows immediately
- Cons:
  - temporary period where historical completeness may vary
  - plan work must define readiness checks and repair tooling

Lazy derivation:

- Pros:
  - lower upfront migration cost
  - can populate only data that is actually read
- Cons:
  - inconsistent first-read behavior
  - harder to reason about completeness for exports and filters
  - higher risk of hidden bugs in a legal/core-domain feature

Read-time derivation only:

- Pros:
  - smallest schema change
  - simplest initial rollout
- Cons:
  - repeats JSON-derivation logic across operational surfaces
  - poorer queryability for filtering
  - highest long-term risk of semantic drift between preview, filter, and export implementations

Recommended rollout direction:

- Avoid a monolithic migration-time backfill as the primary rollout for this feature.
- Avoid read-time-only derivation as the permanent operational model.
- Safest bounded path:
  - additive schema first
  - synchronous projection for all new sign events
  - async backfill for historical rows
  - explicit repair/rebuild path for projection correctness

This matches the repo's existing bias toward immutable canonical writes plus additive operational read layers.

## 9. Risks and edge cases

- Older signed consents missing newer scopes:
  - must surface as `not_collected`, not `not_granted`
- `false` versus `undefined`:
  - `not_granted` should mean the option existed on the signed form and was not selected
  - `not_collected` should mean the option did not exist on that signed template version
- Multiple signed consents over time for the same owner boundary:
  - one-off: possible through multiple invites in the same project for the same subject email
  - recurring project consent: possible over time if a prior signed row is revoked/superseded and a newer request is completed
- Cross-family scope-key collision:
  - because `optionKey` is only validated within a definition today, the same key could appear in different template families with different meaning
  - effective-state derivation must not merge those semantics without an explicit family boundary
- Project-level mixed-version visibility:
  - grid and preview must avoid implying that all participants answered the same scope universe
- Future per-scope revocation:
  - must overlay immutable signed grant history rather than mutating the original signed rows
- Export ambiguity:
  - consumers need a stable status vocabulary and a distinction between `not_granted` and `not_collected`
- Filter ambiguity:
  - a scope filter must decide whether it returns only `granted`, or whether users can also filter for `revoked` / `not_collected`
- Duplicate and retry behavior:
  - request creation must stay idempotent
  - scope projection writes must not double-insert on duplicate submit replay
- Partial failures:
  - sign flow must not succeed with a consent row but fail to create the operational scope projection
  - if an asynchronous derived layer is used, plan work must define repair/rebuild behavior
- Tenant leakage:
  - scope read models must keep tenant and project scoping as strict as the source consent rows
- Public-token scope safety:
  - upgrade links and public sign flows must continue to resolve server-side from hashed tokens
- Legal and audit implications:
  - any change to "current effective scope state" rules can affect export semantics and UI interpretation of older signed history
- One-off subject mutation risk:
  - one-off signed consents do not snapshot subject name/email the way recurring consents do
  - this does not block scope-state work, but it matters when reasoning about later upgrade flows and audit presentation
- One-off workflow modeling risk:
  - using only raw invites for upgrade flows can lose the relationship between prior consent, pending upgrade intent, and eventual completion
  - this is manageable if signing transport stays invite-based but workflow lifecycle gets a thin higher-level request record

## 10. Explicit open decisions for the plan phase

- Decide the exact scope status vocabulary and API contract:
  - minimum recommended set is `granted`, `not_granted`, `revoked`, `not_collected`
- Decide whether the first implementation covers:
  - one-off project consent only
  - or one-off plus recurring project consent together
- Decide the persisted model:
  - immutable per-scope rows only
  - derived layer only
  - or the recommended hybrid
- Decide whether one-off upgrade workflow needs:
  - raw invite reissue only
  - or a thin upgrade-request record that points to a standard invite for signing
- Decide the stable effective-state owner abstraction:
  - likely project subject for one-off and project participant for recurring
  - and whether to materialize that as an explicit shared owner type
- Decide the effective-state precedence rule when multiple signed versions exist for the same owner boundary
- Decide the canonical matching key for cross-version scope identity:
  - likely `optionKey` within a template family
  - and whether plan work must enforce stronger cross-version key stability rules
- Decide whether effective-state derivation must always be scoped by template family to avoid cross-family key collisions
- Decide where scope-level metadata must appear first:
  - asset preview only
  - asset grid filter API
  - export metadata
  - or all three in the same slice
- Decide whether export/DAM metadata should be emitted from:
  - canonical consent JSON
  - linked assignee metadata
  - both
- Decide how future per-scope revocation will compose with whole-consent revocation without breaking immutable history
- Decide the upgrade-request surface:
  - one-off invite reissue pattern
  - recurring request reuse pattern
  - placeholder notification/outbox mechanics
- Decide migration and repair strategy for historical rows:
  - synchronous backfill in migration
  - background backfill
  - or lazy derivation plus repair tooling
- Decide rollout readiness rules:
  - whether scope filters/exports can run before historical backfill completes
  - and whether temporary read-time fallback is acceptable during rollout
