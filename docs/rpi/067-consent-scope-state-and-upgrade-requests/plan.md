# Feature 067 Plan - Consent Scope State, Mixed-Version Scope Semantics, and Ad-Hoc Consent Upgrade Requests

## 1. Inputs and ground truth

Inputs reviewed for this plan phase:

1. `AGENTS.md`
2. `CONTEXT.md`
3. `ARCHITECTURE.md`
4. `docs/rpi/README.md`
5. `docs/rpi/PROMPTS.md`
6. `docs/rpi/SUMMARY.md`
7. `docs/rpi/067-consent-scope-state-and-upgrade-requests/research.md`
8. Targeted live verification of current schema, routes, helpers, and UI seams relevant to the locked implementation choices
9. `UNCODEXIFY.MD` for the UI-planning portion

Ground-truth note:

- The requested research path `docs/rpi/067-consent-scope-state-mixed-version-semantics-and-ad-hoc-consent-upgrade-requests/research.md` does not exist in the live repo.
- The live synthesized research source is `docs/rpi/067-consent-scope-state-and-upgrade-requests/research.md`.
- Current live code and schema remain the source of truth when research and code differ.

Key live files and migrations re-verified during planning:

- `supabase/migrations/20260304210000_002_projects_invites_schema.sql`
- `supabase/migrations/20260407213000_042_structured_consent_template_fields.sql`
- `supabase/migrations/20260414224500_054_baseline_follow_up_delivery_attempts.sql`
- `supabase/migrations/20260415110000_055_project_participants_mixed_consent_foundation.sql`
- `supabase/migrations/20260415210000_058_project_face_assignee_bridge.sql`
- `src/lib/templates/structured-fields.ts`
- `src/lib/templates/template-service.ts`
- `src/lib/consent/public-consent.ts`
- `src/lib/recurring-consent/public-recurring-consent.ts`
- `src/lib/recurring-consent/revoke-recurring-profile-consent.ts`
- `src/lib/projects/project-participants-service.ts`
- `src/lib/matching/project-face-assignees.ts`
- `src/lib/matching/asset-preview-linking.ts`
- `src/app/api/projects/[projectId]/assets/route.ts`
- `src/lib/project-export/project-export.ts`
- `src/lib/matching/auto-match-repair.ts`
- `src/app/api/internal/matching/repair/route.ts`
- `messages/en.json`
- `messages/nl.json`

## 2. Verified current planning boundary

Verified live facts that constrain the plan:

- `consents` and `recurring_profile_consents` are the canonical immutable signed-event records today.
- One-off public signing already inserts exactly one `consents` row per invite and anchors the subject via `subjects`.
- One-off subject identity is currently project-local through `subjects.id`, with uniqueness enforced by `(tenant_id, project_id, email)`.
- Recurring project consent is stored in `recurring_profile_consents` with `consent_kind = 'project'`.
- Structured scope selections are captured inside `structured_fields_snapshot`, including definition snapshot and submitted values.
- Built-in scope options already use `optionKey` as the machine identifier, but live validation only enforces shape and uniqueness within one field definition.
- Mixed template versions already exist in the architecture and draft-to-next-version cloning copies structured field definitions forward.
- `project_face_assignees` are tied to specific consent events, not to a stable project-level owner identity.
- Asset preview is already the best asset-facing seam for richer consent semantics.
- Project asset filtering is still one-off consent-centric and uses `consentId` today.
- Export already emits linked one-off consent metadata and linked assignee metadata, which is the cleanest additive seam for scope metadata.
- Recurring project request creation currently blocks if there is already an active signed project consent for the profile and project.

Planning boundary locked for this feature:

- Keep immutable signed-event rows as canonical truth.
- Keep the existing one-off and recurring public signing flows as the transport for signing.
- Add new schema and derived reads around the current model instead of replacing the model.
- Keep this feature scoped to project media-use consent for one-off and recurring project consent only.
- Do not implement per-scope revocation in this slice, but preserve a model that can support it.
- Do not redesign baseline recurring consent, matching, face ownership, assignee bridging, or whole-asset linking.
- Do not add real outbound email or a generic notification/outbox system.

## 3. Options considered

### Option A - Snapshot-only operational reads

Use only `structured_fields_snapshot` from canonical consent rows and derive all scope semantics at read time.

Why it was considered:

- Lowest schema change count.
- Canonical truth already exists in the signed snapshot.

Why it is not chosen:

- Mixed one-off and recurring reads become repetitive and fragile across preview, filtering, and export.
- Asset-grid filtering would depend on expensive repeated JSON extraction and cross-version comparison logic.
- Read-time only derivation makes backfill state invisible and makes repair harder to reason about.
- Future per-scope revocation and provenance queries would remain awkward.

### Option B - Immutable signed per-scope projection rows only

Keep canonical consent rows and write one immutable projection row per scope option present on the signed version.

Why it was considered:

- Preserves auditability while improving queryability.
- Keeps signed truth tied directly to the original event.

Why it is not sufficient alone:

- Operational surfaces still need repeated governing-event and family-catalog derivation logic.
- `not_collected` is not directly represented for scopes absent from the signed version.
- Filtering and export still need higher-level effective-state selection rules.

### Option C - Derived effective-state reads only

Keep canonical consent rows and build only a derived effective-state layer without storing immutable per-scope projection rows.

Why it was considered:

- Avoids an extra persisted projection table.
- Could centralize precedence logic.

Why it is not chosen:

- Loses a durable operational representation of what each signing event actually said per scope.
- Makes backfill, repair, and provenance debugging harder.
- Couples every future repair or semantics change to snapshot re-parsing.

### Option D - Hybrid additive model

Keep canonical consent rows, add immutable per-scope signed projection rows, and add a derived effective-state read layer for operational use.

Why it is chosen:

- Best fit for immutable audit history plus operational querying.
- Keeps signed-event truth separate from governing effective state.
- Supports `granted`, `not_granted`, `revoked`, and `not_collected` without mutating history.
- Fits preview, filtering, export, mixed-version handling, and future per-scope revocation.
- Supports bounded rollout with synchronous projection for new sign events and async backfill for historical rows.

### Option E - Redesign primary truth to one row per consent x scope

Make scope rows the primary canonical storage model.

Why it is rejected:

- Breaks the requested boundaries.
- Conflicts with the current legal/audit model based on immutable signed-event rows and signed snapshots.
- Adds unnecessary migration and architectural risk for a core-domain feature.

## 4. Recommendation

Implement the hybrid additive model:

1. Preserve `consents` and `recurring_profile_consents` as the canonical immutable signed-event rows.
2. Add immutable per-scope signed projection rows written from the signed snapshot for each new sign event.
3. Add a derived effective-state read layer keyed to a stable project owner boundary plus template family and scope key.
4. Use assignee rows only as the asset-facing join seam from linked assets into that owner-level effective state.
5. Keep cross-version scope identity anchored to `optionKey` within a template family, and tighten family-level validation rules in this feature.
6. Reuse standard one-off invite and recurring request signing transport for future upgrade signing rather than inventing a second signing path.

## 5. Chosen architecture

### Canonical truth

- `consents` remains the immutable canonical one-off signed event.
- `recurring_profile_consents` remains the immutable canonical recurring signed event.
- Signed snapshots remain the legal record of what was shown and what was selected at signing time.

### Immutable signed per-scope layer

- Add one immutable row per scope option that existed on the signed template version.
- Rows store the scope key, signed label snapshot, order, selected state, owner identity, and source consent provenance.
- This layer answers "what did this signing event say per scope?" without reparsing snapshots on every read.

### Effective-state layer

- Add a derived read layer that selects one governing signed event per owner plus template family.
- Join the governing event against a family scope catalog so later-added scopes can surface as `not_collected`.
- Apply whole-consent revocation to the governing event when computing effective operational state.

### Owner boundary

Effective state is not owned by the assignee row and not by the consent row.

Chosen owner boundary:

- One-off owner: `subjects.id`
- Recurring owner: `project_profile_participants.id`

Why this boundary is chosen:

- It is stable across multiple signing events over time.
- It matches the project-local identity the product already uses for one-off and recurring project participants.
- It supports preview, filtering, and export without making a concrete consent event the owner of effective state.
- It leaves room for future upgrade-signing and future per-scope revocation.
- It uses existing domain entities instead of introducing a new shared owner table that would need extra synchronization.

Implementation choice:

- Keep the owner abstraction implicit in schema via `owner_kind` plus nullable owner foreign keys.
- Do not introduce a new `project_consent_owners` table in this slice.

### Assignee join boundary

- `project_face_assignees` remains the asset-facing join seam.
- Asset-facing reads resolve assignee to the stable owner boundary and then join to effective scope state.
- Assignee rows do not own or persist effective scope state.

### Template family and cross-version scope identity

- Treat template family as the boundary for cross-version scope comparison.
- Treat built-in scope `optionKey` as the canonical scope identifier within a template family.
- Do not merge scope state across different template families even if they reuse the same `optionKey`.

## 6. Exact schema/model plan

### 6.1 New immutable projection table

Add a unified projection table for project consent scope selections across one-off and recurring project consent.

Recommended table name:

- `project_consent_scope_signed_projections`

Recommended columns:

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null`
- `project_id uuid not null`
- `owner_kind text not null check (owner_kind in ('one_off_subject', 'project_participant'))`
- `subject_id uuid null`
- `project_profile_participant_id uuid null`
- `source_kind text not null check (source_kind in ('project_consent', 'project_recurring_consent'))`
- `consent_id uuid null`
- `recurring_profile_consent_id uuid null`
- `template_id uuid not null`
- `template_key text not null`
- `template_version text not null`
- `template_version_number integer not null`
- `scope_option_key text not null`
- `scope_label_snapshot text not null`
- `scope_order_index integer not null`
- `granted boolean not null`
- `signed_at timestamptz not null`
- `created_at timestamptz not null default now()`

Constraints and foreign keys:

- Foreign key to `projects(id)` through `project_id`
- Foreign key to `subjects(id)` when `owner_kind = 'one_off_subject'`
- Foreign key to `project_profile_participants(id)` when `owner_kind = 'project_participant'`
- Foreign key to `consents(id)` when `source_kind = 'project_consent'`
- Foreign key to `recurring_profile_consents(id)` when `source_kind = 'project_recurring_consent'`
- Foreign key to `consent_templates(id)` through `template_id`
- Shape check enforcing exactly one owner foreign key and exactly one source foreign key based on `owner_kind` and `source_kind`

Uniqueness and idempotency indexes:

- Unique `(tenant_id, consent_id, scope_option_key)` where `consent_id is not null`
- Unique `(tenant_id, recurring_profile_consent_id, scope_option_key)` where `recurring_profile_consent_id is not null`

Read indexes:

- `(tenant_id, project_id, owner_kind, subject_id, template_key, signed_at desc)`
- `(tenant_id, project_id, owner_kind, project_profile_participant_id, template_key, signed_at desc)`
- `(tenant_id, project_id, template_key, scope_option_key)`
- `(tenant_id, project_id, consent_id)`
- `(tenant_id, project_id, recurring_profile_consent_id)`

### 6.2 Template-family scope catalog view

Add a family-scoped catalog view for currently recognized scope options.

Recommended view name:

- `project_consent_template_family_scope_catalog`

Purpose:

- Provide the comparison set used to compute `not_collected` for older governing versions.
- Keep comparison family-scoped, not global by raw `optionKey`.

View behavior:

- One row per template family plus scope option key.
- Source from the latest non-draft version in the family.
- Prefer the currently published version.
- If no published version exists but archived versions exist, use the highest version number archived version.
- Do not source from drafts.

Recommended columns:

- `tenant_id uuid null`
- `template_key text not null`
- `template_id uuid not null`
- `template_version text not null`
- `template_version_number integer not null`
- `scope_option_key text not null`
- `scope_label text not null`
- `scope_order_index integer not null`

### 6.3 Effective-state derived view

Add a derived read model for operational scope state.

Recommended view name:

- `project_consent_scope_effective_states`

Recommended key:

- `tenant_id`
- `project_id`
- `owner_kind`
- `owner id` via `subject_id` or `project_profile_participant_id`
- `template_key`
- `scope_option_key`

Recommended columns:

- `tenant_id uuid not null`
- `project_id uuid not null`
- `owner_kind text not null`
- `subject_id uuid null`
- `project_profile_participant_id uuid null`
- `template_key text not null`
- `scope_option_key text not null`
- `scope_label text not null`
- `scope_order_index integer not null`
- `effective_status text not null check (effective_status in ('granted', 'not_granted', 'revoked', 'not_collected'))`
- `signed_value_granted boolean null`
- `governing_source_kind text not null`
- `governing_consent_id uuid null`
- `governing_recurring_profile_consent_id uuid null`
- `governing_template_id uuid not null`
- `governing_template_version text not null`
- `governing_template_version_number integer not null`
- `governing_signed_at timestamptz not null`
- `governing_revoked_at timestamptz null`

Behavior:

- Select one governing signed event per owner plus template family.
- Expand against the family scope catalog for the governing family.
- Mark rows present on the governing signed version as `granted` or `not_granted`.
- Mark rows absent from the governing signed version but present in the family catalog as `not_collected`.
- If the governing event is revoked, convert signed-version scope rows to `revoked` and keep absent rows as `not_collected`.

### 6.4 Cross-version scope identity rules to enforce

Lock these rules in this feature:

- Built-in scope `optionKey` is the canonical family-level scope identity.
- Label-only edits across versions are allowed.
- Reordering across versions is allowed.
- Removing a scope from a later version is allowed.
- Reintroducing a previously removed key is allowed only if its meaning is unchanged.
- Reusing an old key for a different legal meaning is not allowed.
- Cross-family collisions do not merge operational state because all operational derivation is family-scoped by `template_key`.

Required validation additions:

- On publish and on create-next-version validation, compare the draft's built-in scope options to prior versions in the same `template_key`.
- Reject semantic drift where the same `optionKey` is reused for a materially different meaning.
- At minimum, require identical normalized labels for reintroduced keys in this slice, or force creation of a new key when meaning changes.
- Preserve current intra-definition uniqueness validation.

### 6.5 Recurring supersedence foundation

Targeted verification showed that recurring project upgrade-signing is currently blocked by the live uniqueness rule that allows only one active signed `recurring_profile_consents` row for `(tenant_id, profile_id, project_id, consent_kind = 'project')`.

To keep the feature future-safe for ad-hoc upgrade requests, include a minimal supersedence foundation now.

Recommended additions to `recurring_profile_consents`:

- `superseded_at timestamptz null`
- `superseded_by_consent_id uuid null references recurring_profile_consents(id)`

Recommended index changes:

- Update active signed uniqueness to treat active as `revoked_at is null and superseded_at is null`.
- Apply the same active-state interpretation anywhere the code or SQL currently treats active as only `revoked_at is null`.

Boundary note:

- This is not a recurring-consent redesign.
- It is a minimal shared-table foundation required so a future project-consent upgrade can create a second immutable signed recurring row without violating the current uniqueness model.
- Baseline recurring consent logic should keep behavior unchanged except that "active" now means "not revoked and not superseded".

### 6.6 Optional thin one-off upgrade workflow table

Include a thin workflow record for one-off upgrade requests in this feature.

Recommended table name:

- `project_consent_upgrade_requests`

Reason for inclusion:

- One-off signing transport can stay a standard new invite to the newer template version.
- A thin workflow row is still cleaner than treating a replacement invite itself as the whole upgrade lifecycle.
- It gives the system a place to track pending, completed, cancelled, expired, and superseded upgrade attempts without mutating prior consent records.

Recommended columns:

- `id uuid primary key default gen_random_uuid()`
- `tenant_id uuid not null`
- `project_id uuid not null`
- `subject_id uuid not null`
- `prior_consent_id uuid not null references consents(id)`
- `target_template_id uuid not null references consent_templates(id)`
- `target_template_key text not null`
- `invite_id uuid null references subject_invites(id)`
- `status text not null check (status in ('pending', 'signed', 'cancelled', 'expired', 'superseded'))`
- `created_by_user_id uuid not null`
- `completed_consent_id uuid null references consents(id)`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Recommended unique rule:

- At most one pending upgrade request per `(tenant_id, project_id, subject_id, target_template_id)`

Boundary:

- No real delivery attempts table for one-off upgrade requests in this slice.
- No generic request framework.
- This table exists only to support bounded lifecycle clarity and future UI visibility.

## 7. Exact write-path plan

### 7.1 New signing events

Projection writes should happen synchronously inside the existing server-authoritative signing path.

One-off path:

- Extend the SQL path behind `submit_public_consent`.
- After canonical consent insertion succeeds, parse the signed `structured_fields_snapshot`.
- Insert one projection row per scope option present on the signed version.

Recurring path:

- Extend the SQL path behind `submit_public_recurring_profile_consent`.
- Only apply to `consent_kind = 'project'` in this feature.
- After canonical recurring consent insertion succeeds, insert one projection row per scope option present on the signed version.

Why synchronous writes are chosen:

- Prevents a successful sign event from existing without its per-scope operational projection.
- Keeps new preview/filter/export behavior immediately consistent for newly signed records.
- Avoids eventual-consistency gaps for core-domain semantics.

### 7.2 Projection source of truth

Projection rows must be written from the signed snapshot, not from the current template table.

Source fields:

- `structured_fields_snapshot.definition.builtInFields.scope.options`
- `structured_fields_snapshot.values.scope.selectedOptionKeys`
- Canonical consent row metadata for signed time, revoked time, template id, version, and owner identity

Write rule:

- Insert one row for every scope option that existed on the signed version.
- Store `granted = true` when `selectedOptionKeys` contains the `optionKey`.
- Store `granted = false` when the option existed on the signed version but was not selected.
- Do not create rows for scopes that were not present on the signed version.

### 7.3 Idempotency and duplicate submit handling

One-off:

- Canonical one-off consent insertion is already naturally bounded by the existing invite model.
- Projection insertion must use `on conflict do nothing` against the per-consent unique index so duplicate submit replay cannot double-write scope rows.

Recurring:

- Recurring public submit already has duplicate handling.
- Projection insertion must also use `on conflict do nothing` against the per-recurring-consent unique index.

Result:

- Duplicate submit replay returns the canonical already-signed outcome and leaves projections stable.

### 7.4 Revocation writes

Whole-consent revocation remains on the canonical consent tables.

Write behavior in this slice:

- Do not mutate immutable signed projection rows on revocation.
- Effective-state reads derive `revoked` from the governing canonical row's `revoked_at`.
- Do not introduce per-scope revocation writes yet.

### 7.5 Upgrade-request creation

One-off upgrade-request creation in this slice:

- Create a `project_consent_upgrade_requests` row.
- Create or reuse a standard one-off invite pointing to the newer template version.
- Store the created invite on the workflow row.
- Do not send real email.
- Return the public consent path so UI can copy/open it.

Recurring upgrade-request creation in this slice:

- Do not add a new recurring workflow table yet.
- Reuse the current recurring project consent request transport pattern later.
- This plan only adds the recurring supersedence foundation so future upgrade-signing is possible.

Reason for the split:

- One-off lacks a current higher-level request lifecycle abstraction and benefits from a thin workflow row.
- Recurring project consent already has request infrastructure and should reuse that seam in a follow-up slice instead of duplicating it here.

## 8. Exact read/API plan

### 8.1 Governing-event precedence rules

Effective state must be derived by explicit precedence rules.

Chosen governing-event rule:

- Partition by `tenant_id + project_id + owner boundary + template_key`.
- Select the latest signed event by `signed_at desc`, then `created_at desc`, then `id desc` as a deterministic tie-breaker.
- Older signed events in the same family remain historical truth but no longer drive effective state once superseded by a later signed event.

Chosen status derivation rule:

- If the governing event contains the scope and `granted = true`, status is `granted`.
- If the governing event contains the scope and `granted = false`, status is `not_granted`.
- If the governing event is revoked and the scope existed on the governing version, status is `revoked`.
- If the scope exists in the family catalog but not on the governing signed version, status is `not_collected`.

Important non-rule:

- Do not fall back to older grants when the latest governing event is revoked.
- Revocation changes the effective operational state of the governing signed version; it does not reactivate older history.

### 8.2 Asset preview semantics

Preview should show effective state plus provenance.

Planned payload additions to asset preview data:

- `scopeStates: Array<...>` on linked-person details for one-off and recurring assignees

Each entry should include:

- `templateKey`
- `scopeKey`
- `label`
- `orderIndex`
- `status` with values `granted | not_granted | revoked | not_collected`
- `signedValueGranted` as `true | false | null`
- `governingTemplateId`
- `governingTemplateVersion`
- `governingTemplateVersionNumber`
- `governingConsentId` or `governingRecurringProfileConsentId`
- `governingSignedAt`
- `governingRevokedAt`

Preview rendering rule:

- Show the effective status.
- Show enough provenance to explain why the status is what it is.
- `not_collected` must be visually distinct from `not_granted`.

### 8.3 Project asset-grid filter semantics

Filtering should use effective state only.

Recommended API additions on `GET /api/projects/[projectId]/assets`:

- `scopeTemplateKey`
- `scopeKey`
- `scopeStatus`

Filter rules:

- Filters are family-scoped by `scopeTemplateKey`.
- `scopeKey` must be evaluated within that family only.
- Positive matches use effective-state rows only.
- `not_collected` is never treated as equivalent to `not_granted`.
- Existing `consentId` filtering remains unchanged in this slice.

Recommended default UI behavior:

- Filter by `scopeStatus = granted` unless the user explicitly chooses another status.

### 8.4 Export and DAM semantics

Export should emit effective state plus provenance while preserving raw signed snapshots.

One-off export additions:

- Keep existing canonical consent JSON unchanged as the signed legal snapshot.
- Add machine-readable `effectiveScopes` metadata with effective status and provenance.
- Add machine-readable `signedScopes` metadata for the governing signed event.

Recurring export additions:

- Add effective scope metadata plus provenance to `linkedAssignees`.
- Do not invent a new recurring canonical export object in this slice.

Recommended export fields for machine-readable scope metadata:

- `templateKey`
- `scopeKey`
- `label`
- `status`
- `signedValueGranted`
- `governingConsentSource`
- `governingConsentId`
- `governingTemplateId`
- `governingTemplateVersion`
- `governingSignedAt`
- `governingRevokedAt`

Why provenance is required:

- DAM and downstream integrations need to distinguish "not requested on signed version" from "explicitly not granted".
- Mixed-version projects otherwise become ambiguous in machine-readable output.

### 8.5 Backfill-aware read behavior

Temporary rollout fallback is allowed only while historical backfill is incomplete.

Fallback rule:

- New sign events must always rely on persisted projection rows.
- Historical reads may fall back to snapshot derivation only when a signed consent predates projection rollout and no projection rows exist yet.
- This fallback must be contained in server-side helpers, not spread across UI components.
- Once backfill and repair are complete, the fallback should remain only as a repair safety net, not as the primary path.

## 9. Exact UI/state plan

UI must stay minimal and consistent with the current project surfaces.

### 9.1 Asset preview

Add a scope-status section to the existing linked-person consent panel in asset preview.

Rendering rules:

- Show one ordered list of scopes for the governing family.
- Order by the family catalog order.
- Show a precise human-readable label for each status.
- Show a short provenance line below the list or within the panel metadata, not repeated on every row unless necessary.

Recommended status labels:

- `granted` -> "Granted"
- `not_granted` -> "Not granted"
- `revoked` -> "Revoked"
- `not_collected` -> "Not collected on signed version"

Preview provenance copy should communicate:

- governing template version
- signed date
- revoked date when relevant

### 9.2 Project asset-grid filter UI

Add an additive filter control, not a redesign of the asset-grid toolbar.

Recommended control shape:

- template-family selector
- scope selector populated from that family
- status selector defaulting to `granted`

Behavior:

- The filter applies against effective state only.
- It works for one-off and recurring assignees through the shared effective-state seam.
- If no family is selected, scope filtering is inactive.

### 9.3 Export UI

- No major export UI redesign.
- If the export surface already offers format or metadata hints, add a concise note that scope-level consent metadata is included.

### 9.4 i18n plan

Add new translation keys in both `messages/en.json` and `messages/nl.json`.

Likely namespaces:

- `projects.assetsList.*` for preview and filter labels
- existing consent detail namespaces only if reused by preview composition

Rule:

- No new hardcoded inline UI strings in components.

## 10. Upgrade-request scope boundary

Chosen boundary for this feature:

- Include one-off upgrade-request data-model foundation and internal creation flow.
- Do not add real outbound sending.
- Do not add a broad generic request/outbox framework.
- Do not add recurring upgrade-request workflow implementation yet.
- Do include recurring supersedence foundation now so recurring project upgrade-signing is not structurally blocked later.

Detailed decision:

- One-off upgrade path should use a thin `project_consent_upgrade_requests` workflow row plus a standard new invite to the newer template version.
- The public signing path for the upgrade remains the normal one-off consent form.
- Completion creates a new immutable `consents` row and new immutable scope projection rows.
- Future UI can show pending or completed upgrade state off the workflow row, but that UI is optional in this slice.

Out of scope for this slice:

- sending the invite
- reminder cadence
- generic request delivery attempts
- recurring upgrade-request UI

## 11. Security and reliability considerations

- Every new table and query must remain tenant-scoped on the server side.
- Do not accept tenant identity from client input for projections, effective-state reads, backfill, or upgrade-request creation.
- Public-token signing routes must continue to rely on the existing validated invite/request token path and derive all tenant/project context server-side.
- Projection writes must be performed in the same authoritative server-side transaction path as canonical consent insertion.
- Projection writes must be idempotent through unique indexes plus `on conflict do nothing`.
- Backfill and repair endpoints must be internal-token protected, resumable, and bounded by explicit batch size and cursor state.
- Effective-state queries must never merge across template families purely on shared `optionKey`.
- Export must use server-side derived effective state so client-side tampering cannot affect metadata.
- Partial failure handling must prefer canonical truth preservation:
  - if canonical signing fails, no projection rows should exist
  - if canonical signing succeeds, projection insertion must occur in the same transaction path or the request should fail and roll back
- Race conditions involving multiple upgrade requests or repeated sign attempts must be handled by unique constraints and deterministic governing-event precedence.

## 12. Edge cases

- Older signed consent missing a newer scope must yield `not_collected`, not `not_granted`.
- Revoked governing consent must yield `revoked` for scopes present on that governing version and `not_collected` for later-added scopes absent from that version.
- Multiple signed rows for one owner in the same family must resolve by the governing-event precedence rule only.
- One-off subject rename after earlier signing must not affect owner resolution because effective state is keyed by `subjects.id`, not by mutable display fields.
- Recurring participant without current project consent should continue to behave as unassignable where current product rules already require active project consent.
- Scope-key drift across template versions must be blocked by stronger family-level validation at publish time.
- Cross-family key collisions must remain isolated because effective state is keyed by `template_key`.
- Historical signed rows not yet backfilled must still render correctly through temporary server-side fallback derivation.
- Assets linked through `project_face_assignees` must resolve to the stable owner boundary before scope state is read.
- One-off upgrade-request retries must not create multiple pending upgrade workflow rows for the same subject and target template.
- If upgrade workflow creation succeeds but invite creation fails, the transaction must fail or the workflow row must be marked unusable; do not leave silent orphan pending rows.
- If recurring supersedence exists later, effective-state derivation must ignore superseded rows when selecting the governing active record.

## 13. Backfill / repair / rollout plan

Chosen rollout direction:

1. additive schema migration
2. synchronous projection writes for all new sign events
3. async backfill for historical rows
4. explicit repair and rebuild path
5. temporary server-side read fallback only while backfill is incomplete

### 13.1 Historical backfill

Backfill scope:

- one-off `consents` with project scope semantics
- `recurring_profile_consents` where `consent_kind = 'project'`

Backfill method:

- Implement a bounded internal repair service and route modeled after the current matching repair pattern.
- Process rows in batches by deterministic cursor.
- Parse signed snapshots and insert projection rows idempotently.

### 13.2 Repair and rebuild

Provide a replayable repair path that can:

- project missing rows
- rebuild projections for a bounded project or owner range if logic changes
- report cursor progress and `has_more`

Rule:

- Rebuild logic must never mutate canonical signed consent history.
- Projection rebuild may delete and recreate projection rows only in a tightly scoped internal repair path if required, but ordinary rollout should prefer idempotent insert-missing behavior.

### 13.3 Rollout readiness

Readiness rules:

- Preview can ship once effective-state helpers and preview fallbacks are in place.
- Asset-grid filtering should not ship without either completed backfill for the project set in scope or temporary server-side fallback strong enough to preserve correctness.
- Export scope metadata should not ship in a mode that silently omits historical scope data without explicit fallback.

Recommendation:

- Ship preview and export with guarded fallback if needed.
- Gate asset-grid scope filtering until backfill and repair are operationally verified.

### 13.4 Why other rollout options are not chosen

- Migration-time full backfill is too risky and hard to recover for a core-domain change.
- Permanent read-time-only derivation keeps complexity and performance cost on every operational read.
- Pure lazy derivation on first read creates inconsistent semantics across surfaces and makes correctness harder to audit.

## 14. Test plan

Required verification areas:

### Schema and migration tests

- projection table constraints and shape checks
- unique indexes for idempotent projection insertion
- recurring active uniqueness updated to account for supersedence
- upgrade-request uniqueness for pending one-off upgrades

### Signing and write-path tests

- one-off sign writes projection rows for every signed-version scope option
- recurring project sign writes projection rows for every signed-version scope option
- duplicate submit replay does not duplicate projection rows
- label snapshot and order snapshot are preserved from signed snapshot

### Effective-state derivation tests

- latest same-family signed event governs effective state
- `granted` versus `not_granted` is computed correctly
- `not_collected` is computed correctly for scopes introduced in later versions
- revoked governing event yields `revoked`
- revoked does not revive older grants
- cross-family key collisions do not merge state

### Read-surface tests

- asset preview payload contains scope states and provenance for one-off
- asset preview payload contains scope states and provenance for recurring project consent
- project asset-grid scope filtering matches effective status correctly
- `not_collected` filter behavior is distinct from `not_granted`
- export metadata includes effective scope state plus provenance

### Backfill and repair tests

- backfill projects historical one-off and recurring project rows correctly
- rerunning backfill is idempotent
- fallback derivation path matches persisted effective-state output
- repair can resume via cursor without duplicating rows

### Upgrade foundation tests

- one-off upgrade-request creation reuses standard invite transport
- one-off duplicate pending upgrade creation is blocked or reused deterministically
- completing one-off upgrade signing creates a new immutable consent row rather than mutating the prior row
- recurring supersedence foundation does not break current baseline or project active-consent logic

## 15. Implementation phases

### Phase 1 - Schema and validation foundations

- add `project_consent_scope_signed_projections`
- add family scope catalog and effective-state derived views
- add recurring supersedence columns and active-index updates
- add family-level scope-key validation rules
- add one-off `project_consent_upgrade_requests`

### Phase 2 - Synchronous projection writes for new sign events

- integrate one-off sign projection writes
- integrate recurring project sign projection writes
- verify idempotency and rollback behavior

### Phase 3 - Effective-state helpers and fallback path

- add server-side helpers for effective-state queries
- add bounded temporary fallback derivation for historical pre-backfill rows
- centralize precedence logic in one read layer

### Phase 4 - Backfill and repair path

- add internal repair route and service
- implement batched projection backfill for one-off and recurring project consents
- add progress, cursor, and idempotent replay behavior

### Phase 5 - Asset preview integration

- extend preview composition to include scope states and provenance
- add minimal preview UI and translation keys

### Phase 6 - Asset-grid scope filtering

- extend asset API filter contract
- implement effective-state filtering
- add minimal filter UI and translation keys

### Phase 7 - Export metadata integration

- add effective scope metadata plus provenance to export shaping
- preserve raw signed snapshot export content

### Phase 8 - One-off upgrade-request foundation

- add create flow for one-off upgrade requests
- create standard invite transport binding
- expose copy/open public path behavior without outbound email

### Phase 9 - Hardening and parity tests

- mixed-version correctness tests
- one-off and recurring parity checks
- rollout guardrails and repair verification

## 16. Scope boundaries

In scope:

- project media-use consent scope state for one-off project consent
- project media-use consent scope state for recurring project consent
- status vocabulary `granted`, `not_granted`, `revoked`, `not_collected`
- asset preview scope visibility
- project asset-grid scope filtering
- export and DAM-ready scope metadata
- one-off upgrade-request foundation
- recurring supersedence foundation needed for future project upgrade-signing

Out of scope:

- per-scope revocation implementation
- baseline recurring consent redesign
- generic consent-system rewrite
- generic request/outbox framework
- real email sending
- non-project consent surfaces
- cross-project global consent resolution
- matching redesign
- assignee bridge redesign
- whole-asset linking redesign
- legal-content redesign of consent templates

## 17. Concise implementation prompt

Implement Feature 067 additively against the current live architecture.

Keep `consents` and `recurring_profile_consents` as immutable canonical signed-event rows. Add a unified immutable projection table for per-scope signed state across one-off project consent and recurring project consent, keyed by stable project owner identity (`subjects.id` for one-off, `project_profile_participants.id` for recurring) plus template family and `optionKey`. Add a derived effective-state read layer that computes `granted`, `not_granted`, `revoked`, and `not_collected` from the latest governing signed event per owner plus template family, without ever mutating old signed rows or collapsing `not_collected` into `not_granted`. Use `project_face_assignees` only as the asset-facing join seam into owner-level effective state.

Write projection rows synchronously in the existing one-off and recurring public signing paths using the signed snapshot as source of truth, with idempotent unique constraints and `on conflict do nothing`. Add family-level validation that treats built-in scope `optionKey` as the canonical identity within a template family and blocks semantic drift across versions. Add minimal recurring supersedence foundation so future recurring project-consent upgrade signing is not blocked by the current active-signed uniqueness rule. Add a thin one-off `project_consent_upgrade_requests` workflow record that reuses standard invite transport and does not send real email.

Extend asset preview to show effective scope state plus provenance, extend the project asset API and UI to filter by family-scoped scope key plus status using effective state only, and extend export metadata to emit effective scope status plus provenance while preserving raw signed snapshot content. Roll out with additive schema, synchronous writes for new sign events, async internal backfill and repair for historical rows, bounded temporary server-side fallback derivation before backfill completion, and thorough tests for idempotency, mixed-version semantics, revocation, preview, filtering, export, and one-off versus recurring parity.
