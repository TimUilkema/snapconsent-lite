# Feature 056 Plan: Recurring Profile Headshots and Matching Materialization Foundation

## Inputs and ground truth

- `AGENTS.md`
- `CONTEXT.md`
- `ARCHITECTURE.md`
- `docs/rpi/README.md`
- Feature 049-055 research and plan docs
- `docs/rpi/056-recurring-profile-headshots-and-matching-materialization-foundation/research.md`
- Targeted live verification of:
  - recurring profile directory and baseline consent flows
  - current consent headshot upload and replacement flows
  - face materialization helpers and direct single-asset materialization path
  - matching worker, reconcile, repair, compare, and preview code
  - `/profiles` and `/projects/[projectId]` UI surfaces
  - English and Dutch message files

Live code and schema remain the source of truth. This plan tightens one research assumption after targeted verification: current `assets` and `asset_face_materialization*` tables are project-scoped, so recurring profile headshots cannot reuse those tables unchanged as reusable tenant-level sources.

## Verified current planning boundary

### Preserved invariants

- Exact project face identity remains `asset_face_materialization_faces.id`.
- Current project assignee identity remains consent-scoped.
- Manual-over-auto precedence remains unchanged.
- Hidden, blocked, manual-face, and zero-face fallback behavior remain unchanged.
- The current async worker, continuation paging, compare fan-out, and repair model remain unchanged for project photo matching.
- Recurring profile headshots are a future matching source, not a direct project face assignee in Feature 056.

### Additional verified constraint that shapes the implementation

- `assets.project_id` is currently `not null`.
- `asset_face_materializations.project_id` and `asset_face_materialization_faces.project_id` are currently `not null`.
- Current upload/finalize helpers require a `projectId`.

That means Feature 056 should not try to force reusable recurring profile headshots into the project-asset tables as-is. The bounded path is a parallel recurring-profile headshot persistence model that reuses the provider/orchestration patterns from the current materialization code without redesigning project assets or exact-face tables.

## Recommendation

Implement Feature 056 as a dedicated recurring-profile headshot foundation with four additive parts:

1. Normalize recurring matching authorization on `recurring_profile_consents.face_match_opt_in`.
2. Add one-current-headshot profile tables that preserve replacement history and selected-face facts.
3. Materialize the uploaded profile headshot directly in-request using extracted shared detection/materialization helpers, with a minimal async repair job if the direct attempt times out or fails.
4. Add bounded UI on `/profiles` plus a read-only readiness badge on `/projects/[projectId]` for known profile participants.

This keeps the feature operational now, avoids widening exact-face assignee identity, and leaves a clean future seam for project-scoped replay through `reconcile_project`.

## Chosen architecture

### 1. Authorization anchor

Use the active baseline recurring consent as the sole authorization source for recurring profile matching.

- Upload or replace is allowed only when the profile has an active baseline recurring consent with `face_match_opt_in = true`.
- Readiness is server-derived from signed consent state plus current headshot state.
- Client toggles never grant matching authorization.

### 2. Dedicated recurring-profile headshot model

Add three additive tables instead of trying to reuse project-scoped asset materialization tables directly.

#### `public.recurring_profile_headshots`

Purpose: current and historical uploaded headshots for a recurring profile.

Required columns:

- `id uuid primary key`
- `tenant_id uuid not null`
- `profile_id uuid not null`
- `storage_bucket text not null`
- `storage_object_path text not null`
- `mime_type text`
- `byte_size bigint`
- `sha256 text`
- `image_width integer`
- `image_height integer`
- `selection_face_id uuid null`
- `selection_status text not null`
- `selection_reason text null`
- `materialization_status text not null default 'pending'`
- `materialized_at timestamptz null`
- `superseded_at timestamptz null`
- `created_by text not null`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

Constraints and indexes:

- partial unique index for one current row per profile: unique `(tenant_id, profile_id)` where `superseded_at is null`
- unique `(tenant_id, storage_object_path)` for idempotent finalize and duplicate click safety
- foreign key to `recurring_profiles(id, tenant_id)`

`selection_status` values for 056:

- `pending_materialization`
- `auto_selected`
- `manual_selected`
- `needs_face_selection`
- `no_face_detected`
- `unusable_headshot`

`materialization_status` values for 056:

- `pending`
- `completed`
- `repair_queued`
- `failed`

#### `public.recurring_profile_headshot_materializations`

Purpose: detector/materialization fact record for one headshot version.

Required columns:

- `id uuid primary key`
- `tenant_id uuid not null`
- `headshot_id uuid not null`
- `provider text not null`
- `provider_request_id text null`
- `usable_for_compare boolean not null`
- `unusable_reason text null`
- `face_count integer not null`
- `source_image_width integer null`
- `source_image_height integer null`
- `materialization_version integer not null default 1`
- `created_at timestamptz not null default now()`

Constraints:

- unique `(tenant_id, headshot_id, materialization_version)`
- foreign key to `recurring_profile_headshots(id, tenant_id)`

#### `public.recurring_profile_headshot_materialization_faces`

Purpose: persist all detected faces, even though only one becomes the canonical matching source.

Required columns:

- `id uuid primary key`
- `tenant_id uuid not null`
- `materialization_id uuid not null`
- `face_rank integer not null`
- `detection_probability double precision not null`
- `face_box jsonb not null`
- `embedding vector(...) not null`
- `created_at timestamptz not null default now()`

Constraints:

- unique `(materialization_id, face_rank)`
- foreign key to `recurring_profile_headshot_materializations(id, tenant_id)`

### 3. No denormalized pointer on `recurring_profiles` in 056

Do not add `current_headshot_id` or `matching_ready_state` columns to `recurring_profiles` now.

Reasons:

- current-row lookup is already covered by the partial unique index
- readiness depends on both consent and headshot facts
- keeping readiness derived avoids drift and retry complexity

### 4. Service and route additions

Add recurring-profile specific server routes and services rather than widening project consent routes.

Planned surfaces:

- `POST /api/profiles/[profileId]/headshot`
  - creates a pending headshot row and upload target
- `POST /api/profiles/[profileId]/headshot/[headshotId]/finalize`
  - finalizes upload, materializes directly, supersedes prior current row, returns derived readiness
- `POST /api/profiles/[profileId]/headshot/[headshotId]/select-face`
  - manual canonical face selection for ambiguous current headshots

Shared server helpers to add:

- `getActiveRecurringProfileMatchAuthorization(...)`
- `ensureRecurringProfileHeadshotMaterialization(...)`
- `selectRecurringProfileCanonicalFace(...)`
- `deriveRecurringProfileMatchingReadiness(...)`

## Exact scope boundary

### In scope now

- one current recurring profile headshot per profile
- upload and replace flow
- explicit matching authorization requirement
- direct request-time materialization for one uploaded headshot
- auto-selection of one canonical face when safe
- minimal manual face selection when auto-selection is ambiguous
- explicit server-derived readiness states
- `/profiles` UI for readiness, upload/replace, and face choice
- read-only participant readiness badge on `/projects/[projectId]`
- async repair fallback when direct materialization does not complete

### Explicitly unchanged in 056

- project exact-face ownership model
- consent-scoped assignee identity
- current compare tables and candidate persistence
- current worker fan-out and continuation design
- project asset preview lightbox interaction model
- project face-to-profile linking UX
- bulk or gallery headshot management

### Prepared for later, not implemented now

- project compare integration using ready profile headshots
- profile-backed candidates inside the asset preview lightbox
- project replay when a profile source changes
- source-type widening in compare/candidate persistence

## Exact authorization model

### Normalized authorization field

Add `face_match_opt_in boolean not null default false` to `public.recurring_profile_consents`.

Use it as a normalized server-side projection of the signed baseline recurring consent content.

### Consent rules

- Only the latest active signed baseline recurring consent may authorize profile headshot matching.
- `face_match_opt_in = true` is required for upload, replace, manual face selection, and `ready` state.
- Revoked baseline consent or baseline consent without opt-in yields `blocked_no_opt_in`.

### Existing signed baseline consents

Backfill existing rows to `false`.

Reason:

- earlier recurring consent flows did not persist an explicit reusable matching authorization field
- inferring true retroactively would over-authorize historical records

### Public recurring consent flow adjustment

The recurring public consent flow must start collecting and storing the opt-in without requiring a headshot at sign time.

Planned change:

- parameterize the current shared base-field validation so recurring baseline consent can allow `faceMatchOptIn = true` while `hasHeadshot = false`
- keep the project consent path unchanged, where immediate headshot capture can still be required by that flow

## Exact profile headshot data model

### Current row lookup

- current row = `recurring_profile_headshots` record with `superseded_at is null`
- historical rows remain queryable for audit/history

### Replacement history preservation

- replacement never updates the old row in place into the new file
- replacement inserts a new row and supersedes the previous current row in the same transaction after finalize succeeds
- materialization and selected-face facts stay attached to the historical row they came from

### Derived matching source identity

For 056, the profile matching source is logically:

- `profile_id`
- current `headshot_id`
- selected `selection_face_id`

This is not yet a project assignee identity. It is a future reusable source identity only.

## Exact materialization strategy

### Direct request-time materialization

`finalize` should:

1. validate tenant and matching authorization
2. finalize upload metadata
3. run direct materialization for that one headshot
4. persist detector truth
5. apply canonical-face selection
6. supersede the previous current row
7. return updated derived readiness

### Code reuse boundary

Do not copy provider logic.

Instead:

- extract the provider invocation and face-persistence orchestration now embedded in `ensureAssetFaceMaterialization(...)` into a shared lower-level helper
- keep existing project asset materialization behavior unchanged
- add `ensureRecurringProfileHeadshotMaterialization(...)` on top of that shared helper to persist into the new recurring-profile tables

### Detector truth persistence

- persist all detected faces on the headshot materialization
- do not collapse multi-face input down to a single persisted row
- only the selected canonical face becomes the future matching source

### Async repair fallback

If the direct materialization attempt times out, provider-calls fail transiently, or finalize returns before materialization completes:

- keep the new headshot row as current
- leave readiness non-ready
- set `materialization_status = 'repair_queued'`
- enqueue a new minimal job type such as `materialize_recurring_profile_headshot`

That job should:

- only materialize the headshot and recompute selection/readiness
- not start compare fan-out
- reuse the current matching queue leasing and idempotent retry patterns

This is a narrow repair extension, not a worker redesign.

## Exact canonical-face selection model

### Chosen option

Choose Option B: minimal manual face selection in 056.

Reason:

- ambiguous multi-face portraits are common enough that "replace only" would make the feature brittle
- a bounded chooser is much smaller than full preview/editor tooling
- it preserves the product assumption that the image is meant to represent one person

### Face ranking inputs

For each detected face, compute:

- `area_ratio`: face box area divided by image area
- `center_distance`: normalized distance from image center
- `confidence`: detector probability

Sort by:

1. larger `area_ratio`
2. smaller `center_distance`
3. larger `confidence`

### Auto-selection thresholds

Auto-select the top face when:

- there is exactly one detected face and:
  - `confidence >= 0.80`
  - `area_ratio >= 0.05`

or

- there are multiple detected faces and the top face meets all of:
  - `confidence >= 0.80`
  - `area_ratio >= 0.05`
  - and either:
    - `top.area_ratio >= second.area_ratio * 2.0`
    - or `top.area_ratio >= second.area_ratio * 1.5` and `top.center_distance + 0.15 <= second.center_distance`

### Non-auto outcomes

- zero detected faces: `no_face_detected`
- at least one face but top face below confidence or size minimum: `unusable_headshot`
- multiple plausible faces without a clear winner: `needs_face_selection`

### Manual selection rules

- allowed only on the current non-superseded headshot
- allowed only when the profile still has active `face_match_opt_in = true`
- selected face must belong to the current headshot materialization
- successful selection sets:
  - `selection_face_id`
  - `selection_status = 'manual_selected'`
  - `selection_reason = 'manual_override'`

## Exact readiness model

Readiness is derived server-side from consent state plus current headshot facts.

### States

- `blocked_no_opt_in`
- `missing_headshot`
- `materializing`
- `no_face_detected`
- `needs_face_selection`
- `unusable_headshot`
- `ready`

### Rules

- `blocked_no_opt_in`
  - no active baseline recurring consent
  - or latest active baseline consent has `face_match_opt_in = false`
- `missing_headshot`
  - authorized, but no current headshot row
- `materializing`
  - current headshot exists and `materialization_status in ('pending', 'repair_queued')`
- `no_face_detected`
  - completed materialization with zero faces
- `needs_face_selection`
  - completed materialization with multiple plausible faces and no manual selection
- `unusable_headshot`
  - completed materialization but no acceptable canonical face because of low-confidence or too-small detections
- `ready`
  - active baseline recurring consent with `face_match_opt_in = true`
  - current non-superseded headshot row exists
  - completed current materialization exists
  - `selection_face_id` exists
  - `selection_status in ('auto_selected', 'manual_selected')`

## Exact replacement behavior

- replacement reuses the same upload/finalize path as first upload
- new current row is created for the new file
- old current row is marked `superseded_at = now()`
- previous `ready` state never survives replacement
- selection and materialization are recomputed from the new file only

If direct materialization fails after replacement:

- keep the new row current
- show `materializing`
- queue repair
- preserve old row as historical evidence only

Future-facing rule to document now:

- later project auto-derived matches from an old profile source should be re-evaluated when the current headshot changes
- future manual project face links remain authoritative and must not be cleared automatically

## Exact `/profiles` UI evolution

### Profile list

Extend list data with a compact matching badge:

- `Ready`
- `Needs headshot`
- `Needs selection`
- `No opt-in`
- `No face`
- `Unusable`
- `Materializing`

This belongs beside the existing baseline consent state, not as a separate heavy panel.

### Profile detail panel

Extend the existing inline detail panel to show:

- current matching readiness state and helper text
- upload button when authorized with no headshot
- replace button when authorized with an existing headshot
- opt-in required message and follow-up action when blocked by missing authorization
- minimal face selection UI when state is `needs_face_selection`

### Minimal manual face chooser

Keep it bounded:

- show the uploaded headshot preview
- render detected face boxes read-only
- allow choosing one face from the detected set
- no crop editor, no manual face drawing, no box adjustment tools

### i18n

Add message keys under the existing namespaces, for example:

- `profiles.matching.*`
- `profiles.detail.matching.*`

Do not hardcode new UI strings.

## Exact `/projects/[projectId]` visibility decision

Include a lightweight read-only readiness badge now on known profile participant rows.

Why include it:

- it exposes whether a known participant already has a usable future match source
- it helps project coordinators understand why later profile-backed matching may or may not happen
- it does not widen assignee identity or add project matching actions

Scope:

- only on known profile participant rows
- no click-through matching action
- no lightbox or preview changes in 056

Suggested values:

- `Match source ready`
- `No match opt-in`
- `Needs headshot`
- `Needs review`
- `Materializing`

## Future integration seam with project matching

Feature 056 does not implement project compare integration, but it must document the seam clearly.

### Future trigger events

Later, enqueue project-scoped replay when:

- a profile transitions into `ready`
- a `ready` profile is added as a participant to a project
- a previously `ready` profile becomes not-ready because of replacement or opt-in revocation

### Chosen seam

Use `reconcile_project` as the future project-scoped replay seam.

Reason:

- it matches the desired "project-local replay" behavior
- it reuses the current queue, lease, retry, and bounded replay model
- it avoids inventing a second orchestration path

### What future integration will need later

- project replay enumeration must include ready recurring-profile sources
- those sources must be translated into project-local candidate/assignee context without making recurring profiles direct exact-face assignees
- candidate presentation in the lightbox can later distinguish:
  - direct project-consent candidates
  - profile-backed candidates that resolve to a project-local consent/participant context
  - blocked or no-consent states

Feature 056 only prepares this seam by producing a stable reusable profile source identity and readiness state.

## Security and reliability considerations

- derive tenant scope on the server only
- never trust client-provided tenant ids
- matching authorization must come from signed recurring consent state, not client toggles
- duplicate upload or replace clicks must be safe through idempotent insert/finalize handling
- do not supersede the old current headshot until the new finalized row exists
- direct materialization failure must degrade to non-ready plus repair, never silent success
- manual face selection must only target persisted faces from the current headshot
- project matching later must still honor manual-over-auto precedence and exact-face ownership
- historical headshot rows and materializations should remain auditable

## Edge cases

- Clear portrait with a tiny background face:
  - auto-select the dominant foreground face when the area dominance threshold is met.
- Two similarly plausible faces:
  - store all detected faces and require manual selection.
- No face detected:
  - mark `no_face_detected`; replacing the headshot is required.
- Low-quality single face:
  - mark `unusable_headshot`; manual selection is not enough.
- Duplicate replace clicks:
  - idempotent finalize plus one-current-row constraint should prevent double-current corruption.
- Baseline opt-in revoked after a profile was ready:
  - preserve the headshot history, but derived state becomes `blocked_no_opt_in`.
- Old materialization on a replaced headshot:
  - keep it as historical data only; it does not drive current readiness.
- Direct provider timeout:
  - return `materializing`, queue repair, and do not claim readiness.
- Profile is a project participant but not yet project-assignable:
  - project page may show readiness, but no project face assignment behavior changes.
- Future lightbox coexistence:
  - later profile-backed candidates must remain subordinate to current exact-face manual ownership rules.

## Test plan

### Schema and data integrity

- migration test for `recurring_profile_consents.face_match_opt_in` backfill
- one-current-headshot constraint per profile
- historical replacement preservation

### Server logic

- authorization lookup from active baseline recurring consent
- readiness derivation for every state
- direct materialization success path
- repair fallback path after timeout or transient provider error
- replacement behavior and supersede ordering
- manual face selection validation against current materialization only

### Selection logic

- one clear face auto-selects
- one small background face does not beat the dominant portrait
- two similarly plausible faces produce `needs_face_selection`
- zero faces produce `no_face_detected`
- low-confidence single face produces `unusable_headshot`

### UI

- `/profiles` list and detail render the derived readiness states
- upload/replace controls respect authorization state
- ambiguous headshots render the manual face chooser
- `/projects/[projectId]` known profile rows render the read-only readiness badge
- English and Dutch messages resolve via i18n keys

## Implementation phases

1. Authorization and schema foundation
   - add `face_match_opt_in` to recurring consents
   - add recurring profile headshot and materialization tables
   - update recurring baseline consent submission to persist normalized opt-in
2. Direct materialization and readiness services
   - extract shared detection/materialization helper
   - add recurring profile materialization path
   - add readiness derivation and replacement logic
   - add repair job type for profile headshot materialization fallback
3. Profile APIs and `/profiles` UI
   - add upload, finalize, and face-selection routes
   - extend `profile-directory-service` payloads
   - add readiness badge, helper text, and minimal chooser UI
4. Project participant visibility
   - extend participant service payload
   - render read-only readiness badge on known profile rows
5. Tests and i18n polish
   - add server tests, selection tests, UI tests, and new message keys

## Explicitly deferred follow-up cycles

- widening exact-face assignee identity beyond consent-scoped ownership
- profile-backed compare row persistence changes
- lightbox candidate trays for profile-backed sources
- automatic project replay when profile readiness changes
- match result review UI
- bulk upload or multi-headshot gallery management
- identity merge between recurring profiles and one-off signers

## Concise implementation prompt

Implement Feature 056 as an additive recurring-profile headshot foundation. Normalize recurring `face_match_opt_in` on signed baseline consents, add one-current-headshot plus materialization tables for recurring profiles, materialize uploaded headshots directly in-request with repair fallback, auto-select a canonical face when clearly dominant, allow minimal manual face selection when multiple plausible faces exist, derive readiness server-side, surface readiness and upload/replace controls on `/profiles`, add a read-only readiness badge for known profile participants on `/projects/[projectId]`, and keep exact-face ownership, consent-scoped assignee identity, asset preview UX, and the current async project matching architecture unchanged.
